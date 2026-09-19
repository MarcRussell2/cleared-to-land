// Free flight: the options the menu's builder edits (saved as ctl.free) and the one function that turns them into a
// scenario (src/missions/README.md). Pure: no DOM, no three.js scene, importable in Node (tools/test-free.mjs, run by
// npm test).
//
// The site list is passed in rather than imported: src/systems/scenarios.js imports this file (its makeFreeFlight
// delegates here) and owns SITES, so importing it back would be a cycle.
//
// Rules the output keeps:
//   - id 'free': free flight never reaches the logbook or the leaderboard (main.js finish() skips it).
//   - Deterministic: the only randomness is the "Surprise me" pick, drawn from the flight seed passed in, and the
//     failure trigger comes from the options (or a seeded 'window' trigger when the failure code supports it).
//   - Never throws on stale options: validateFreeOpts() is run on everything loaded from storage, and
//     buildFreeFlight() falls back to the first usable site and aircraft rather than reading undefined.
import { AIRCRAFT } from '../aircraft/defs.js';
import { FAILURES, shouldTrigger } from '../systems/malfunctions.js';
import { makeRng, clamp, FT, DEG } from '../config.js';
import { runwayNeedAshore } from '../ui/aircraft-catalog.js';

// Weather presets. Picking one sets the wind, gusts, turbulence, shear, visibility and cloud base below; the
// Advanced drawer then fine-tunes those. rain/snow/dust/darkness/lightning go straight into the weather spec.
export const WEATHER_PRESETS = [
  { id: 'clear', name: 'Clear', sub: 'CAVOK', wind: 8, gust: 0, turb: 0, microburst: false, vis: 40000, ceilingFt: null, clouds: 0.15, rain: 0, snow: 0, dust: 0, darkness: 0, lightning: 0 },
  { id: 'overcast', name: 'Overcast', sub: 'OVC 2,500 ft', wind: 10, gust: 5, turb: 0.15, microburst: false, vis: 15000, ceilingFt: 2500, clouds: 0.9, rain: 0, snow: 0, dust: 0, darkness: 0.3, lightning: 0 },
  { id: 'rain', name: 'Rain', sub: 'Vis 5 km, RA', wind: 14, gust: 8, turb: 0.15, microburst: false, vis: 5000, ceilingFt: 1500, clouds: 0.85, rain: 0.6, snow: 0, dust: 0, darkness: 0.45, lightning: 0 },
  { id: 'storm', name: 'Thunderstorm', sub: 'CB, gusts, shear', wind: 18, gust: 12, turb: 0.35, microburst: true, vis: 4000, ceilingFt: 1200, clouds: 0.95, rain: 0.9, snow: 0, dust: 0, darkness: 0.7, lightning: 0.5 },
  { id: 'snow', name: 'Snow', sub: 'Vis 1.5 km, SN', wind: 12, gust: 6, turb: 0.15, microburst: false, vis: 1500, ceilingFt: 800, clouds: 0.85, rain: 0, snow: 0.7, dust: 0, darkness: 0.4, lightning: 0 },
  { id: 'dust', name: 'Dust storm', sub: 'Vis 800 m, DU', wind: 24, gust: 10, turb: 0.35, microburst: false, vis: 800, ceilingFt: 3000, clouds: 0.3, rain: 0, snow: 0, dust: 0.8, darkness: 0.35, lightning: 0 },
  { id: 'fog', name: 'Fog', sub: 'Vis 400 m', wind: 3, gust: 0, turb: 0, microburst: false, vis: 400, ceilingFt: 200, clouds: 0, rain: 0, snow: 0, dust: 0, darkness: 0.2, lightning: 0 },
];
export const weatherPreset = (id) => WEATHER_PRESETS.find((w) => w.id === id) || WEATHER_PRESETS[0];

// Times of day, in hours. Kept inside the sky's range (6.5 - 22.5); dusk is just past the lights-on time (19.5).
export const TIME_PRESETS = [
  { id: 'dawn', name: 'Dawn', t: 6.5 }, { id: 'morning', name: 'Morning', t: 9 }, { id: 'noon', name: 'Noon', t: 12.5 },
  { id: 'afternoon', name: 'Afternoon', t: 16 }, { id: 'dusk', name: 'Dusk', t: 19.75 }, { id: 'night', name: 'Night', t: 22.5 },
];
export const timePreset = (t) => TIME_PRESETS.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));

// Where the flight starts, metres to the threshold (or the carrier's ramp). A bush strip always starts close in and
// high over the trees: resolveScenario() puts every flight at the two original strips 900 m out and 100 m up
// (FIXED_BUSH_START mirrors that here, so the failure trigger is worked out from where the flight really starts), and
// the builder caps any other bush strip at 1,500 m.
export const START_PRESETS = [
  { id: 'short', name: 'Short final', dist: 2000 }, { id: 'final', name: 'Final', dist: 5000 },
  { id: 'long', name: 'Long final', dist: 8000 }, { id: 'far', name: 'Far out', dist: 12000 },
];
export const TURB_LEVELS = [
  { id: 'none', name: 'None', v: 0 }, { id: 'light', name: 'Light', v: 0.15 }, { id: 'moderate', name: 'Moderate', v: 0.35 }, { id: 'severe', name: 'Severe', v: 0.6 },
];
export const turbLevel = (v) => TURB_LEVELS.reduce((a, b) => (Math.abs(b.v - v) < Math.abs(a.v - v) ? b : a));
export const WHEN = [
  { id: 'start', name: 'At start' }, { id: 'approach', name: 'On approach' }, { id: 'short', name: 'Short final' }, { id: 'any', name: 'Any time' },
];
export const WEIGHTS = ['light', 'normal', 'heavy'];
const FIXED_BUSH_START = { gravelbar: { dist: 900, alt: 100 }, oneway: { dist: 900, alt: 100 } };

export const LIMITS = {
  windSpeed: [0, 40], gustAbove: [0, 25], turb: [0, 1], time: [6, 22.5], vis: [200, 40000], ceilingFt: [200, 10000],
  seaState: [0, 1.5], dist: [600, 12000], windRel: [-180, 180],
};

// The heading an approach to this site flies (degrees): the primary runway, or the carrier's angled deck.
export function landingHeading(site) {
  if (site && site.runways && site.runways[0]) return site.runways[0].heading || 0;
  if (site && site.carrier) return (site.carrier.heading || 0) - 9;
  return 0;
}

// Can this airplane land at this place? { ok, reason, tight }. The carrier needs a tailhook; a runway must be as long as
// the airplane needs ashore (src/ui/aircraft-catalog.js runwayNeedAshore: defs.js's runwayNeed, except the Sea Hornet,
// whose 200 m is its stop on the wires). A pair a mission flies is always allowed, marked tight when the runway is
// short of the need (the Condor at Ridgefield, "Short & Heavy"): pass `sites` and `missions` for that.
export function siteUsable(site, def, { sites = null, missions = null } = {}) {
  if (!site || !def) return { ok: false, reason: 'Unknown' };
  if (site.kind === 'carrier' || (!site.runways && site.carrier)) return def.hook ? { ok: true, reason: '' } : { ok: false, reason: 'Needs a tailhook' };
  const rw = site.runways && site.runways[0];
  const need = runwayNeedAshore(def);
  if (rw && rw.length < need) {
    const flown = !!(sites && Array.isArray(missions) && missions.some((m) => m && m.aircraft === def.id && sites[m.site] === site));
    if (flown) return { ok: true, reason: '', tight: `Tight: needs ${fmtInt(need)} m` };
    return { ok: false, reason: `Too short: needs ${fmtInt(need)} m` };
  }
  return { ok: true, reason: '' };
}

// Does a failure make sense on this airplane? A catalogue entry may carry applies(def); without it, it always does.
export function failureApplies(entry, def) {
  if (!entry || typeof entry.applies !== 'function') return true;
  try { return !!entry.applies(def); } catch (e) { return false; }
}

// Obstacles present at a place (trees on short final, a course of its own): only then is the toggle offered.
export function siteHasObstacles(site) {
  return !!(site && ((site.obstacleTrees && site.obstacleTrees.length) || (site.course && ((site.course.obstacles && site.course.obstacles.length) || (site.course.gates && site.course.gates.length)))));
}

const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const wrap180 = (d) => { const x = ((d % 360) + 540) % 360 - 180; return x === -180 ? 180 : x; };

// Clean a saved (or harness-written) options object: every key present, every id known, every number in range.
// `raw` may be anything JSON.parse can return. Old saves carry an absolute `windDir`; it becomes `windRel`.
// `missions` (SCENARIOS) lets a pair a mission flies through siteUsable() even when the runway is short of the need.
export function validateFreeOpts(raw, { defaults, sites, aircraft = AIRCRAFT, failures = FAILURES, missions = null } = {}) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const d = defaults || {};
  const o = {};
  const siteIds = Object.keys(sites || {});
  const acIds = Object.keys(aircraft);
  o.aircraft = acIds.includes(r.aircraft) ? r.aircraft : acIds.includes(d.aircraft) ? d.aircraft : acIds[0];
  const def = aircraft[o.aircraft];
  o.site = siteIds.includes(r.site) ? r.site : siteIds.includes(d.site) ? d.site : siteIds[0];
  const usable = (id) => sites[id] && siteUsable(sites[id], def, { sites, missions }).ok;
  if (sites && sites[o.site] && !usable(o.site)) {
    const first = [d.site, ...siteIds].find(usable);
    if (first) o.site = first;
  }
  const site = sites ? sites[o.site] : null;
  o.weather = WEATHER_PRESETS.some((w) => w.id === r.weather) ? r.weather : weatherPreset(d.weather).id;
  let rel = num(r.windRel, NaN);
  if (!Number.isFinite(rel) && typeof r.windDir === 'number' && Number.isFinite(r.windDir)) rel = r.windDir - landingHeading(site);
  if (!Number.isFinite(rel)) rel = num(d.windRel, 0);
  o.windRel = Math.round(wrap180(rel));
  o.windSpeed = Math.round(clamp(num(r.windSpeed, num(d.windSpeed, 8)), ...LIMITS.windSpeed));
  o.windGust = Math.round(clamp(num(r.windGust, num(d.windGust, o.windSpeed)), o.windSpeed, o.windSpeed + LIMITS.gustAbove[1]));
  o.turb = +clamp(num(r.turb, num(d.turb, 0)), ...LIMITS.turb).toFixed(2);
  o.microburst = typeof r.microburst === 'boolean' ? r.microburst : !!d.microburst;
  o.time = +clamp(num(r.time, num(d.time, 12)), ...LIMITS.time).toFixed(2);
  o.vis = Math.round(clamp(num(r.vis, num(d.vis, 30000)), ...LIMITS.vis));
  const ceil = r.ceilingFt === null ? null : num(r.ceilingFt, d.ceilingFt == null ? null : num(d.ceilingFt, null));
  o.ceilingFt = ceil == null || ceil >= LIMITS.ceilingFt[1] ? null : Math.round(clamp(ceil, LIMITS.ceilingFt[0], LIMITS.ceilingFt[1]));
  o.seaState = +clamp(num(r.seaState, num(d.seaState, 0.3)), ...LIMITS.seaState).toFixed(2);
  o.weight = WEIGHTS.includes(r.weight) && def.massOptions && def.massOptions[r.weight] ? r.weight : 'normal';
  o.dist = Math.round(clamp(num(r.dist, num(d.dist, 5000)), ...LIMITS.dist));
  o.obstacles = typeof r.obstacles === 'boolean' ? r.obstacles : d.obstacles !== false;
  const fl = Array.isArray(r.failures) ? r.failures : [];
  o.failures = [...new Set(fl.filter((f) => typeof f === 'string' && failures[f] && failureApplies(failures[f], def)))];
  o.surprise = typeof r.surprise === 'boolean' ? r.surprise : !!d.surprise;
  o.when = WHEN.some((w) => w.id === r.when) ? r.when : WHEN.some((w) => w.id === d.when) ? d.when : 'approach';
  return o;
}

// Apply a weather preset to the options (the builder calls it when a preset tile is picked).
export function applyWeatherPreset(o, id) {
  const w = weatherPreset(id);
  o.weather = w.id;
  o.windSpeed = w.wind; o.windGust = w.wind + w.gust; o.turb = w.turb; o.microburst = w.microburst;
  o.vis = w.vis; o.ceilingFt = w.ceilingFt;
  return o;
}

// Is the seeded 'window' trigger ({from, to} seconds) understood by this build's failure code? Asked, not assumed:
// the failures work adds it, and until then an altitude trigger worked out from the options stands in.
export function windowTriggerSupported() {
  try { return shouldTrigger({ name: 'probe', at: { type: 'window', from: 0, to: 0 } }, { radioAlt: 1e6 }, { t: 1e6, distToThreshold: 1e9 }) === true; } catch (e) { return false; }
}

// A small stable hash of the options, for the "any time" trigger when no seeded window exists.
function optsHash(o) {
  const s = [o.aircraft, o.site, o.weather, o.windRel, o.windSpeed, o.windGust, o.time, o.vis, o.dist, (o.failures || []).join('+'), o.when].join('|');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

// Roughly how high (ft) and how long before the threshold (s) the flight starts.
function startProfile(site, def, spawn, bush) {
  const carrier = site.kind === 'carrier' || (!site.runways && site.carrier);
  const rw = site.runways ? site.runways[0] : null;
  const dist = spawn.dist;
  let heightM;
  if (bush) heightM = spawn.alt != null ? spawn.alt : 100 + (dist - 900) * 0.09;
  else if (carrier) heightM = dist * Math.tan(3.5 * DEG) + 3;
  else heightM = (dist + ((rw && rw.aimDistance) || 300)) * Math.tan(rw && rw.gsAngle ? rw.gsAngle * DEG : def.approach.glideslope);
  const secs = dist / Math.max(20, def.speeds.Vref * 0.514444);
  return { ft: heightM / FT, secs };
}

// Every altitude trigger sits below the start height (at most 85% of it), so no failure the pilot asked for "on
// approach" or "on short final" fires in the first second. "On approach" is 60% of the start height (72% on a bush
// strip, which starts only about 330 ft up), capped at 1,500 ft; "short final" is 300 ft or half the start height.
function failureTrigger(when, o, prof, useWindow, bush) {
  const ft = prof.ft, T = prof.secs;
  const below = (v) => Math.round(Math.max(60, Math.min(v, ft * 0.85)));
  switch (when) {
    case 'start': return { type: 'time', value: 3 };
    case 'short': return { type: 'alt', value: below(Math.min(300, ft * 0.5)) };
    case 'any':
      if (useWindow) return { type: 'window', from: 3, to: Math.max(6, Math.round(T * 0.85)) };
      return { type: 'alt', value: below(ft * (0.2 + 0.6 * optsHash(o))) };
    case 'approach':
    default:
      // an altitude, even where a seeded window exists: "on approach" promises above short final and below the start,
      // and a time window cannot keep that promise on a short bush approach (2026-09-18, merge with the failures work)
      return { type: 'alt', value: below(Math.min(1500, ft * (bush ? 0.72 : 0.6))) };
  }
}

// A catalogue entry may say when it happens in free flight (`freeAt`: a tyre bursts on touchdown, a gear that will not
// come down is known from the start); otherwise the moment the pilot picked. A seeded window this build cannot fire
// becomes a plain time trigger at its start.
function freeTrigger(entry, at, useWindow) {
  const f = entry && entry.freeAt && typeof entry.freeAt === 'object' ? { ...entry.freeAt } : null;
  if (!f) return { ...at };
  if (f.type === 'window' && !useWindow) return { type: 'time', value: f.from || 0 };
  return f;
}

// options -> scenario (src/missions/README.md). `seed` only picks the "Surprise me" failure.
export function buildFreeFlight(opts, { sites, aircraft = AIRCRAFT, failures = FAILURES, seed = 1, defaults = null, missions = null } = {}) {
  const o = validateFreeOpts(opts, { defaults: defaults || opts, sites, aircraft, failures, missions });
  const site = sites[o.site], def = aircraft[o.aircraft];
  const carrier = site.kind === 'carrier' || (!site.runways && !!site.carrier);
  const bush = site.kind === 'bush';
  const w = weatherPreset(o.weather);
  const dir = (((landingHeading(site) + o.windRel) % 360) + 360) % 360;
  const spawn = { dist: o.dist, hook: carrier, flap: o.aircraft === 'condor' ? 0.75 : o.aircraft === 'skylark' ? 0.667 : 1, fixed: true };
  if (bush && FIXED_BUSH_START[o.site]) { spawn.dist = FIXED_BUSH_START[o.site].dist; spawn.alt = FIXED_BUSH_START[o.site].alt; }
  else if (bush) { spawn.dist = Math.min(o.dist, 1500); spawn.alt = 100 + (spawn.dist - 900) * 0.09; }
  const prof = startProfile(site, def, spawn, bush);
  const useWindow = windowTriggerSupported();
  let names = o.failures.slice();
  if (o.surprise) {
    const pool = Object.keys(failures).filter((k) => failureApplies(failures[k], def));
    const rng = makeRng((Math.abs(Math.round(seed)) || 1) * 131 + 17);
    names = pool.length ? [pool[Math.floor(rng() * pool.length)]] : [];
  }
  const at = failureTrigger(o.when, o, prof, useWindow, bush);
  const sc = {
    id: 'free', n: 0, title: 'Free Flight', tags: ['free'],
    aircraft: o.aircraft, site: o.site, time: o.time, vis: o.vis, clouds: w.clouds,
    desc: `${def.name} at ${site.name}. ${w.name}, your own conditions.`, tips: [],
    // A gust of 0 would be re-rolled by resolveScenario(); equal to the wind speed it means "no gusts" to the Wind.
    wind: { dir, speed: o.windSpeed, gust: Math.max(o.windGust, o.windSpeed, 0.001), turb: o.turb, shear: o.microburst ? 0.4 : 0 },
    weather: {
      preset: w.id, rain: w.rain, snow: w.snow, dust: w.dust, darkness: w.darkness,
      ceiling: o.ceilingFt == null ? null : Math.round(o.ceilingFt * FT), lightning: w.lightning,
      events: o.microburst ? [{ type: 'microburst', at: { type: 'dist', value: 2500 } }] : [],
      ...(carrier ? { seaState: o.seaState } : {}),
    },
    weight: o.weight,
    spawn,
    failures: names.map((name) => ({ name, at: freeTrigger(failures[name], at, useWindow), arg: 0, ...(o.surprise ? { silent: true } : {}) })),
    surprise: !!o.surprise,
    scoring: { type: carrier ? 'carrier' : bush ? 'bush' : 'runway' },
  };
  if (carrier) sc.seaState = o.seaState;
  if (o.obstacles === false) sc.course = false;
  return sc;
}
