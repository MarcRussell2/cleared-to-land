/**
 * The shared leaderboard — Cleared to Land's half of it.
 *
 * The game keeps one best per challenge in `ctl.best`, and until now the menu showed
 * that single line: whoever last beat it, with their name. Marc's note was that this
 * is not a leaderboard. So there are two boards now, both public and both shared with
 * the rest of goodmarc.com:
 *
 *   the career board   every pilot's total across every challenge (49 of them since the
 *                      missions expansion, so a career tops out at 4,900)
 *   per challenge      a top ten for each one, on its own sub-board
 *
 * It talks to `/api/scores` — a small score service on the same origin as the site (the
 * game is served from goodmarc.com/cleared-to-land/), so no CORS and no key. The
 * site repo owns that service and its registry; this file is the game's own small
 * client and deliberately duplicates nothing but the wire format.
 *
 * Everything degrades: with no network, or before the Worker exists, the game keeps
 * its own bests exactly as it always has and the boards just say so.
 */

const API = '/api/scores';
const GAME = 'cleared-to-land';
const QUEUE = 'ctl.queue';
const NAME_MAX = 16;

/* ------------------------------------------------------------------- storage */

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch (e) {
    return fallback;
  }
}

function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private window */ }
}

/**
 * The same cleaning the site and the Worker apply. Kept identical on purpose: a name
 * that survives here must survive there, or a pilot's board row would quietly differ
 * from the name on their own screen.
 */
export function cleanName(raw) {
  return String(raw == null ? '' : raw)
    .replace(/[\u0000-\u001f\u007f<>&"']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}

/**
 * One name for the whole domain. The arcade games keep theirs under
 * `gm-arcade.player`; this game has always kept `ctl.pilot`. Both are written, and a
 * name set on either side is picked up by the other, so a pilot types it once.
 */
export const pilotName = {
  get() {
    try {
      const own = cleanName(localStorage.getItem('ctl.pilot') || '');
      if (own) return own;
      const arcade = localStorage.getItem('gm-arcade.player');
      return arcade ? cleanName(JSON.parse(arcade)) : '';
    } catch (e) {
      return '';
    }
  },
  set(value) {
    const clean = cleanName(value);
    try {
      if (clean) localStorage.setItem('ctl.pilot', clean);
      else localStorage.removeItem('ctl.pilot');
      localStorage.setItem('gm-arcade.player', JSON.stringify(clean));
    } catch (e) { /* private window */ }
    return clean;
  },
};

/* ---------------------------------------------------------------- submitting */

/**
 * Publish a pilot's standing: the career total, plus the challenge just flown.
 *
 * Called with the whole `best` map rather than one result, because the career number
 * is a sum over it and re-deriving it is cheaper than tracking it. Sending both in one
 * request keeps it to a single POST per new best.
 */
export function publish(best, pilot, justFlown = null) {
  const name = cleanName(pilot);
  if (!name) return;                       // nothing to sign it with; keep it local

  const ids = Object.keys(best || {});
  if (ids.length === 0) return;

  let total = 0;
  let topGrade = '';
  let topPoints = -1;
  for (const id of ids) {
    const b = best[id];
    if (!b || typeof b.points !== 'number') continue;
    total += b.points;
    if (b.points > topPoints) { topPoints = b.points; topGrade = b.grade || ''; }
  }

  const scores = [{ game: GAME, name, score: total, flown: ids.length, grade: topGrade }];

  if (justFlown && best[justFlown]) {
    const b = best[justFlown];
    scores.push({ game: GAME, board: justFlown, name, score: b.points, grade: b.grade || '' });
  }

  // The site's own board for this game reads the arcade's local store when the API is
  // unreachable, so mirror the career row there too — otherwise the Cleared to Land
  // panel on goodmarc.com/games/ would sit empty for a pilot who has flown plenty.
  mirrorLocally(name, total, ids.length, topGrade);

  const queue = load(QUEUE, []);
  save(QUEUE, (Array.isArray(queue) ? queue : []).concat(scores).slice(-40));
  drain();
}

function mirrorLocally(name, score, flown, grade) {
  const key = 'gm-arcade.scores.' + GAME;
  const list = load(key, []);
  const rows = (Array.isArray(list) ? list : []).filter(
    (r) => cleanName(r.name).toLowerCase() !== name.toLowerCase()
  );
  rows.push({ name, score, flown, grade, at: Date.now() });
  rows.sort((a, b) => (b.score || 0) - (a.score || 0));
  save(key, rows.slice(0, 12));
}

let sending = false;

/** Send whatever is queued. One request, no retry timer — the next best is the retry. */
export async function drain() {
  if (sending) return;
  const list = load(QUEUE, []);
  if (!Array.isArray(list) || list.length === 0) return;
  sending = true;
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scores: list.slice(-10) }),
    });
    if (!res.ok) return;
    const data = await res.json().catch(() => null);
    if (data && data.ok) save(QUEUE, []);
  } catch (e) {
    /* offline, or no Worker yet: the queue keeps */
  } finally {
    sending = false;
  }
}

/* ------------------------------------------------------------------ reading */

const cache = new Map();
const TTL = 30000;

/**
 * A board's rows. `board` is '' for the career table or a challenge id for one
 * challenge. Resolves to `{ rows, source }` — "world" when the API answered, "browser"
 * when it did not and these are this machine's own bests.
 */
export async function readBoard(board = '', localFallback = null) {
  const hit = cache.get(board);
  if (hit && Date.now() - hit.at < TTL) return hit.value;

  let value = null;
  try {
    const q = board ? `${API}?game=${GAME}&board=${encodeURIComponent(board)}` : `${API}?game=${GAME}`;
    const res = await fetch(q, { headers: { accept: 'application/json' } });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data && Array.isArray(data.rows)) {
        value = { rows: data.rows.map((r) => ({ ...r, name: cleanName(r.name) || 'ANON' })), source: 'world' };
      }
    }
  } catch (e) {
    /* fall through */
  }

  if (!value) value = { rows: localFallback ? localFallback() : [], source: 'browser' };
  cache.set(board, { at: Date.now(), value });
  return value;
}

/** Forget what was fetched — called after a new best so the pilot sees themselves move. */
export function forget() {
  cache.clear();
}
