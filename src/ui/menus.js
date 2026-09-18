// Menus: "Three Doors" (Marc's pick, 2026-09-17). The home screen is three tall doors over the live airfield -
// AIRCRAFT, MISSIONS, FREE FLIGHT - and a quieter fourth for SETTINGS. Behind them: the mission browser (groups
// from src/missions/index.js MISSION_GROUPS, never a hard-coded list), the hangar, the stepped free-flight builder
// (options -> scenario in src/missions/free.js), settings, controls and the logbook; then pause and the debrief.
//
// Plain DOM strings: show() replaces the overlay's content and every page is rebuilt from the game's state. Clicks,
// inputs and keys are delegated from the overlay (one listener each), so a page only declares what its buttons do.
//
// The test harnesses (the website's tools/ctl-shots) rely on: #btn-fly clickable straight after boot and starting a
// flight; .tab[data-tab="challenges" | "controls" | "settings"] on the home screen (and in every page's header);
// #btn-resume in the pause; game.startScenario / startFree. Keep them.
import { SCENARIOS, SITES } from '../systems/scenarios.js';
import { AIRCRAFT_LIST, AIRCRAFT } from '../aircraft/defs.js';
import { FAILURES } from '../systems/malfunctions.js';
import { KEY_HELP } from '../input.js';
import { touchify } from '../touch.js';
import { readBoard, pilotName } from '../systems/leaderboard.js';
import { MISSION_GROUPS, missionOrder } from '../missions/index.js';
import { WEATHER_PRESETS, weatherPreset, TIME_PRESETS, START_PRESETS, TURB_LEVELS, turbLevel, WHEN, WEIGHTS, LIMITS, siteUsable, failureApplies, siteHasObstacles, applyWeatherPreset, landingHeading } from '../missions/free.js';
import { sil, aircraftInfo, difficultyOf, isClassicMission, CLASSIC_SITES, siteLine } from './aircraft-catalog.js';

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
// The top three get a tint on the board, the rest nothing.
function cleanRowClass(i) { return i < 3 ? 'place p' + (i + 1) : ''; }
function attr(s) { return esc(s).replace(/"/g, '&quot;'); }
const pad2 = (n) => String(n).padStart(2, '0');
const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
const wrap180 = (d) => { const x = ((d % 360) + 540) % 360 - 180; return x === -180 ? 180 : x; };

// The build stamp: the website copy carries it in <meta name="ctl-build">; the local copy uses the bundle time.
const BUILD_LABEL = (() => {
  try {
    const m = typeof document !== 'undefined' ? document.querySelector('meta[name="ctl-build"]') : null;
    const s = (m && m.content) || (typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '');
    return s ? s.replace('T', ' ').slice(0, 16) + 'Z' : '';
  } catch (e) { return ''; }
})();

/* ------------------------------------------------------------------ data helpers */

// A grade (runway or carrier) -> the colour family it is drawn in.
const GRADE_FAMILY = {
  GREASED: 'GREASED', 'OK (underline)': 'GREASED', SMOOTH: 'SMOOTH', OK: 'SMOOTH', FIRM: 'FIRM', FAIR: 'FIRM',
  HARD: 'HARD', 'NO GRADE': 'HARD', DAMAGED: 'DAMAGED', CUT: 'DAMAGED', BOLTER: 'DAMAGED', INCOMPLETE: 'DAMAGED', CRASH: 'CRASH',
};
const gradeFamily = (g) => GRADE_FAMILY[g] || 'DAMAGED';

const OTHER_GROUP = { id: 'more', title: 'More', ids: [] };
const GROUP_BLURB = {
  all: 'Every landing, grouped the way they get harder.',
  basics: 'The trainer and the airliner on good days.',
  heavy: 'Sixty tonnes, short runways, no flaps, no visibility.',
  broke: 'Something fails on the way down. Fly it anyway.',
  stall: 'Low and slow, on purpose.',
  boat: 'The Sea Hornet and a pitching deck.',
  bush: 'Gravel bars and canyon strips in the Trailblazer.',
  storms: 'Squalls, microbursts, whiteouts and dust.',
  breaks: 'Harder failures: fire, trim, instruments, wheels.',
  obstacles: 'Trees, wires, towers and hills in the way.',
  city: 'A ladder of rungs, each more ridiculous than the last.',
  maps: 'New places to put it down.',
  chaos: 'Random everything. You will not be told.',
  more: 'Everything else.',
};
function groupOf(sc) {
  return MISSION_GROUPS.find((g) => (g.ids || []).includes(sc.id)) || MISSION_GROUPS.find((g) => g.id === sc.group) || OTHER_GROUP;
}
const scById = (id) => SCENARIOS.find((s) => s.id === id) || null;
const numOf = (sc) => pad2(sc.n != null ? sc.n : SCENARIOS.indexOf(sc) + 1);
const acName = (id) => (id === 'random' ? 'Random aircraft' : AIRCRAFT[id] ? AIRCRAFT[id].name : String(id));
const acShort = (id) => (id === 'random' ? 'Any aircraft' : AIRCRAFT[id] ? AIRCRAFT[id].short || AIRCRAFT[id].name : String(id));
const siteName = (id) => (id === 'random' ? 'Random place' : SITES[id] ? SITES[id].name : String(id));
const siteShort = (id) => (id === 'random' ? 'Anywhere' : SITES[id] ? SITES[id].short || SITES[id].name.replace(/\s+(Regional|Intl|International|Municipal|at sea)$/i, '') : String(id));
const isCarrierSite = (site) => !!site && (site.kind === 'carrier' || (!site.runways && !!site.carrier));

function visText(v) {
  if (v === 'random') return 'Random';
  if (typeof v !== 'number') return '—';
  if (v >= 9500) return `${Math.round(v / 1000)} km`;
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')} km`;
  return `${Math.round(v / 50) * 50} m`;
}
// Wind for a briefing: relative to the landing direction whether the mission gives `rel` or an absolute `dir`.
function windText(sc) {
  const w = sc.wind;
  if (w === 'random') return 'Random';
  if (!w || !(w.speed > 0.5)) return 'Calm';
  const spd = Math.round(w.speed);
  const g = w.gust && w.gust > w.speed + 0.5 ? `G${Math.round(w.gust)}` : '';
  let rel = w.rel;
  if (rel == null && w.dir != null && SITES[sc.site]) rel = wrap180(w.dir - landingHeading(SITES[sc.site]));
  let side;
  if (rel == null) side = w.dir != null ? `from ${String(Math.round(w.dir)).padStart(3, '0')}°` : '';
  else if (Math.abs(rel) < 3) side = 'on the nose';
  else if (Math.abs(rel) > 175) side = 'from behind';
  else side = `${Math.abs(Math.round(rel))}° ${rel > 0 ? 'right' : 'left'}`;
  return `${spd}${g} kt ${side}`.trim();
}
const EVENT_NAMES = { microburst: 'Microburst', gustFront: 'Gust front', windShift: 'Wind shift', turbBurst: 'Turbulence', squall: 'Squall', visDrop: 'Visibility drop' };
function failText(sc) {
  if (sc.surprise) return 'Surprise';
  if (sc.failures === 'random') return 'Random';
  if (!sc.failures || !sc.failures.length) return 'None';
  return sc.failures.map((f) => (FAILURES[f.name] && FAILURES[f.name].name) || f.name).join(', ');
}
function obstaclesText(sc) {
  const c = sc.course && typeof sc.course === 'object' ? sc.course : null;
  const site = SITES[sc.site];
  const n = c ? ((c.obstacles || []).length + (c.gates || []).length) : 0;
  if (n) return c.gates && c.gates.length ? `${(c.obstacles || []).length} obstacles, ${c.gates.length} gates` : `${n} on the approach`;
  if (sc.course !== false && site && site.obstacleTrees && site.obstacleTrees.length) return 'Trees on short final';
  if (sc.course !== false && site && site.course) return 'A course of its own';
  return '';
}

const pips = (d) => `<span class="pips d${d}" aria-label="difficulty ${d} of 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= d ? 'f' : ''}"></i>`).join('')}</span>`;
const CHEV_L = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 L5 8 L10 13"/></svg>';
const CHEV_R = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M5 2 L10 7 L5 12"/></svg>';
const GO = '<span class="door-go" aria-hidden="true"><svg viewBox="0 0 18 18"><path d="M6 3 L12 9 L6 15"/></svg></span>';

// Weather tile icons (24x24, stroked).
const ICON = {
  clear: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M5.3 18.7L7 17M17 7l1.7-1.7"/>',
  overcast: '<path d="M6.5 16.5h11a3.8 3.8 0 0 0 .3-7.6 5.6 5.6 0 0 0-10.7-1.2A4.4 4.4 0 0 0 6.5 16.5z"/><path d="M4 20.5h16"/>',
  rain: '<path d="M6.5 13h11a3.6 3.6 0 0 0 .3-7.2 5.4 5.4 0 0 0-10.3-1.1A4.2 4.2 0 0 0 6.5 13z"/><path d="M8.5 16l-1.3 3.5M12.5 16l-1.3 3.5M16.5 16l-1.3 3.5"/>',
  storm: '<path d="M6.5 13h11a3.6 3.6 0 0 0 .3-7.2 5.4 5.4 0 0 0-10.3-1.1A4.2 4.2 0 0 0 6.5 13z"/><path d="M12.8 14.5l-2.6 4h3.2l-2.2 4"/>',
  snow: '<path d="M6.5 13h11a3.6 3.6 0 0 0 .3-7.2 5.4 5.4 0 0 0-10.3-1.1A4.2 4.2 0 0 0 6.5 13z"/><path d="M8 16.5v.01M12 16.5v.01M16 16.5v.01M10 20v.01M14 20v.01" stroke-width="2.6"/>',
  dust: '<path d="M3 7.5h10.5a2.4 2.4 0 1 0-2.4-2.4M3 12h14.5a2.8 2.8 0 1 1-2.8 2.8M3 16.5h7"/><path d="M14 19.5v.01M19 11v.01M9 20v.01" stroke-width="2.4"/>',
  fog: '<path d="M4 7h16M3 11h18M5 15h14M7 19h10"/>',
};

// Visibility slider: logarithmic, 200 m .. 40 km, so the low end (where it matters) is not a few pixels wide.
const VIS_MIN = 200, VIS_MAX = 40000;
const visToSlider = (v) => Math.round(100 * Math.log(Math.max(VIS_MIN, Math.min(VIS_MAX, v)) / VIS_MIN) / Math.log(VIS_MAX / VIS_MIN));
const sliderToVis = (s) => { const v = VIS_MIN * Math.pow(VIS_MAX / VIS_MIN, s / 100); return v < 1000 ? Math.round(v / 50) * 50 : v < 10000 ? Math.round(v / 100) * 100 : Math.round(v / 1000) * 1000; };
const seaWord = (s) => (s < 0.3 ? 'calm' : s < 0.7 ? 'moderate' : s < 1.1 ? 'rough' : 'storm');
const FREE_STEPS = ['aircraft', 'place', 'weather', 'trouble', 'fly'];

export class Menus {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.overlay = document.createElement('div');
    this.overlay.className = 'overlay';
    root.appendChild(this.overlay);
    this.page = 'home';
    this.selected = null;        // the mission in the missions dock (and NEXT UP once the pilot has picked one)
    this.picked = false;         // true once the pilot chose a mission himself this session
    this.cat = 'all';            // missions: the category in the rail
    this.acFilter = 'all';       // missions: the aircraft chip
    this.acSel = null;           // hangar: the highlighted airplane
    this.freeStep = 'aircraft';  // free flight: the pane on show
    this.advOpen = null;         // free flight: the Advanced drawer (null = its default for the screen)
    this.after = null;           // where showMain() lands after a flight ('missions' | 'briefing' | 'free' | null = home)
    this.act = {};               // this page's buttons by id
    this.onBack = null;          // Esc / the back chevron
    this.onInputs = null;        // this page's input/change handler
    this.kb = false;             // the last thing the pilot touched was the keyboard (focus is restored after a rebuild)
    this.overlay.addEventListener('click', (e) => this.onClick(e));
    this.overlay.addEventListener('input', (e) => this.onInputs && this.onInputs(e, false));
    this.overlay.addEventListener('change', (e) => this.onInputs && this.onInputs(e, true));
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('pointerdown', () => { this.kb = false; }, { capture: true, passive: true });
  }

  show(html, look = 'inner') {
    const key = this.kb ? focusKey(document.activeElement, this.overlay) : null;
    this.act = {}; this.onInputs = null;
    this.overlay.className = 'overlay pg-' + look;
    this.overlay.innerHTML = html;
    this.game.input.releaseMouse();
    if (this.kb) {
      const el = (key && this.overlay.querySelector(key)) || this.overlay.querySelector('[data-autofocus]');
      if (el && el.focus) el.focus({ preventScroll: false });
    }
  }
  hide() { this.overlay.classList.add('hidden'); this.overlay.innerHTML = ''; this.page = null; }
  get visible() { return !this.overlay.classList.contains('hidden'); }
  q(sel) { return this.overlay.querySelector(sel); }
  qa(sel) { return [...this.overlay.querySelectorAll(sel)]; }

  /* ------------------------------------------------------------- navigation */

  go(tab) {
    switch (tab) {
      case 'home': return this.showHome();
      case 'aircraft': return this.showAircraft();
      case 'challenges': case 'missions': return this.showMissions();
      case 'free': return this.showFree();
      case 'logbook': return this.showLogbook();
      case 'controls': return this.showControls();
      case 'settings': return this.showSettings();
      default: return this.showHome();
    }
  }

  // The game calls this at boot and after a flight (toMenu). A debrief button may have asked for a page.
  showMain() {
    const a = this.after; this.after = null;
    if (a === 'briefing' && scById(this.selected)) return this.showBriefingPage();
    if (a === 'missions') return this.showMissions();
    if (a === 'free') return this.showFree();
    return this.showHome();
  }
  showBriefing(sc) { this.selected = sc.id; this.picked = true; this.showBriefingPage(); }

  onClick(e) {
    const b = e.target.closest('button, [data-go], [data-tab]');
    if (!b || !this.overlay.contains(b) || b.disabled || b.getAttribute('aria-disabled') === 'true') return;
    if (b.id && this.act[b.id]) { this.act[b.id](b, e); return; }
    const d = b.dataset;
    if (d.tab) { this.go(d.tab); return; }
    if (d.go === 'back') { if (this.onBack) this.onBack(); return; }
    if (d.go) { this.go(d.go); return; }
    if (this.act.any) this.act.any(b, e);
  }

  onKey(e) {
    if (!this.visible) return;
    if (['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(e.key)) this.kb = true;
    const t = e.target, tag = t && t.tagName;
    const field = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
    if (e.key === 'Escape') {
      e.preventDefault();
      if (field && this.overlay.contains(t)) { t.blur(); return; }
      if (this.onBack) this.onBack();
      return;
    }
    if (field || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'KeyP' && this.page === 'pause') { e.preventDefault(); this.game.resume(); return; }
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (dir && !(t && t.closest && t.closest('[data-arrows]'))) { e.preventDefault(); this.moveFocus(dir); }
  }

  // Arrow keys: the nearest focusable thing in that direction (doors, cards, tiles, chips, the step bar).
  moveFocus([dx, dy]) {
    const all = this.qa('button:not([disabled]), [tabindex="0"], input, select').filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    if (!all.length) return;
    const cur = this.overlay.contains(document.activeElement) ? document.activeElement : null;
    if (!cur) { (this.q('[data-autofocus]') || all[0]).focus(); return; }
    const a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, bestScore = Infinity;
    for (const el of all) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect(), bx = r.left + r.width / 2, by = r.top + r.height / 2;
      const along = (bx - ax) * dx + (by - ay) * dy;
      if (along <= 4) continue;
      const across = Math.abs((bx - ax) * dy) + Math.abs((by - ay) * dx);
      const score = along + across * 2.2;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) { best.focus(); best.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }

  // The header of every page behind the doors: back to the doors, the three paths, the quiet links.
  bar(active) {
    const path = (id, label) => `<button class="path tab ${active === id ? 'on' : ''}" data-tab="${id}" ${active === id ? 'aria-current="page"' : ''}>${label}</button>`;
    const quiet = (id, label) => `<button class="tab ${active === id ? 'on' : ''}" data-tab="${id}" ${active === id ? 'aria-current="page"' : ''}>${label}</button>`;
    return `<header class="bar">
      <button class="brand sm" data-go="home" aria-label="Back to the home screen"><span class="chev">${CHEV_L}</span><span class="bt">Cleared to Land</span></button>
      <nav class="paths">${path('aircraft', 'Aircraft')}${path('challenges', 'Missions')}${path('free', 'Free flight')}</nav>
      <nav class="quiet">${quiet('logbook', 'Logbook')}${quiet('controls', 'Controls')}${quiet('settings', 'Settings')}</nav>
    </header>`;
  }
  // The header for pages opened over a flight (pause > settings / controls): only the way back.
  soloBar(title, backLabel = 'Back to the flight') {
    return `<header class="bar solo">
      <button class="brand sm" data-go="back" data-autofocus><span class="chev">${CHEV_L}</span><span class="bt">${esc(backLabel)}</span></button>
      <div class="bar-title">${esc(title)}</div>
    </header>`;
  }
  inputNote() {
    return this.game.input.padConnected ? 'Gamepad connected' : this.game.touchActive ? 'Touch controls' : 'Keyboard · Mouse yoke · Gamepad';
  }

  /* ------------------------------------------------------------- missions data */

  order() { return missionOrder(SCENARIOS); }
  bestOf(id) { const b = (this.game.best || {})[id]; return b && typeof b === 'object' ? b : null; }
  // NEXT UP: the mission the pilot picked, else the first one never flown in menu order.
  nextUp() {
    const order = this.order();
    if (this.picked && scById(this.selected)) return scById(this.selected);
    return order.find((s) => !this.bestOf(s.id)) || scById(this.selected) || order[0];
  }
  selectedMission() {
    let sc = scById(this.selected);
    if (!sc) { sc = this.nextUp(); this.selected = sc.id; }
    return sc;
  }
  careerTotal() { return Object.values(this.game.best || {}).reduce((a, x) => a + (x && typeof x.points === 'number' ? x.points : 0), 0); }

  /* ------------------------------------------------------------- home: the doors */

  showHome() {
    this.page = 'home';
    this.onBack = null;
    const order = this.order();
    const flown = order.filter((s) => this.bestOf(s.id));
    const greased = flown.filter((s) => gradeFamily(this.bestOf(s.id).grade) === 'GREASED').length;
    const fresh = order.filter((s) => !isClassicMission(s.id) && !this.bestOf(s.id)).length;
    const strip = order.map((s) => { const b = this.bestOf(s.id); return `<i class="${b ? 'g-' + gradeFamily(b.grade) : !isClassicMission(s.id) ? 'nw' : ''}"></i>`; }).join('');
    const next = this.nextUp();
    const fleet = AIRCRAFT_LIST.map((a) => `<figure>${sil(a.id)}<figcaption>${esc(a.short || a.name)}</figcaption></figure>`).join('');
    const f = this.freeSummary(this.game.freeOpts);
    const s = this.game.settings;
    const row = (k, v, cls = '') => `<div class="${cls}"><dt>${k}</dt><dd>${esc(v)}</dd></div>`;
    const touch = this.game.touchActive;
    const fs = touch && this.game.canFullscreen() ? '<button class="tab" id="btn-fs">Full screen</button>' : '';
    const pilot = this.game.pilot;
    const first = order[0], last = order[order.length - 1];
    this.show(`<div class="home-wrap">
      <header class="top">
        <div class="brand"><span class="bt">Cleared to Land</span><span class="bs">Airplane landing challenges</span></div>
        <nav class="quiet"><button class="tab" data-tab="logbook">Logbook</button><button class="tab" data-tab="controls">Controls</button>${fs}</nav>
      </header>
      <main class="doors">
        <div class="door">
          <button class="door-link tab" data-tab="aircraft" aria-label="Aircraft: pick an airplane"></button>
          <div class="door-no"><span>01</span></div>
          <div class="door-detail"><div class="fleet">${fleet}</div></div>
          <div class="door-foot"><h2 class="door-title">Aircraft</h2><p class="door-copy">Pick an airplane. Its missions follow.</p>${GO}</div>
        </div>
        <div class="door is-focus">
          <button class="door-link tab" data-tab="challenges" aria-label="Missions: ${flown.length} of ${order.length} flown" data-autofocus></button>
          <div class="door-no"><span>02</span>${fresh ? `<span class="new">${fresh} NEW</span>` : ''}</div>
          <div class="door-detail"><div class="prog">
            <div class="prog-big"><b>${flown.length}</b><span><em>of</em> ${order.length} flown</span></div>
            <div class="strip" style="grid-template-columns:repeat(${order.length},1fr)">${strip}</div>
            <div class="prog-meta"><span>Career <b>${fmtInt(this.careerTotal())}</b></span><span><b>${greased}</b> greased</span></div>
            <div class="nextup">
              <div class="nu-l"><span class="nu-k">${this.picked ? 'Selected' : flown.length ? 'Next up' : 'Start here'}</span><span class="nu-t"><em>${numOf(next)}</em> ${esc(next.title)}</span></div>
              <button class="btn fly nu-fly" id="btn-fly" aria-label="Fly ${attr(next.title)}">Fly</button>
            </div>
          </div></div>
          <div class="door-foot"><h2 class="door-title">Missions</h2><p class="door-copy">From ${esc(first.title)} to ${esc(last.title)}.</p>${GO}</div>
        </div>
        <div class="door">
          <button class="door-link tab" data-tab="free" aria-label="Free flight: ${attr(f.aircraft)} at ${attr(f.place)}"></button>
          <div class="door-no"><span>03</span></div>
          <div class="door-detail"><dl class="last">
            <div class="last-h">Last setup</div>
            ${row('Aircraft', f.aircraft)}${row('Place', f.place)}${row('Weather', f.weather)}${row('Wind', f.wind, 'ph-hide')}${row('Time', f.time, 'ph-hide')}${row('Trouble', f.trouble)}
          </dl></div>
          <div class="door-foot"><h2 class="door-title">Free Flight</h2><p class="door-copy">Any plane, any place, any weather.</p>${GO}</div>
        </div>
        <div class="door door-set">
          <button class="door-link tab" data-tab="settings" aria-label="Settings: controls, graphics, sound, your logbook name"></button>
          <div class="door-no"><span>04</span></div>
          <div class="door-detail"><dl class="last set">
            ${row('Graphics', s.quality || 'high')}${row('Controls', (s.controlMode || 'assist') === 'assist' ? 'Assisted' : 'Direct')}${row('Start', ({ short: 'Short final', medium: 'Medium', long: 'Long' })[s.approach] || 'Short final', 'ph-hide')}${row('Camera', s.camera || 'chase', 'ph-hide')}
          </dl></div>
          <div class="door-foot"><h2 class="door-title">Settings</h2><p class="door-copy">Controls, graphics, sound, your logbook name.</p></div>
        </div>
      </main>
      <footer class="foot">
        <span><button class="foot-pilot" data-tab="settings">Pilot <b>${pilot ? esc(pilot) : 'not named'}</b></button><span class="ph-hide"> &nbsp;·&nbsp; ${this.inputNote()}</span></span>
        <span>${BUILD_LABEL ? 'Build ' + BUILD_LABEL : ''}</span>
      </footer>
    </div>`, 'home');
    this.act['btn-fly'] = () => { const sc = this.nextUp(); this.selected = sc.id; this.game.startScenario(sc); };
    this.act['btn-fs'] = () => this.game.fullscreen();
  }

  /* ------------------------------------------------------------- missions */

  // The missions the rail and grid show, in menu order, with the aircraft chip applied. A random-aircraft
  // mission (Roulette) belongs to every airplane.
  filtered() {
    const f = this.acFilter;
    return this.order().filter((s) => f === 'all' || s.aircraft === f || s.aircraft === 'random');
  }
  groupsShown(list) {
    const groups = [...MISSION_GROUPS, OTHER_GROUP];
    return groups.map((g) => ({ g, list: list.filter((s) => groupOf(s) === g) })).filter((x) => x.list.length);
  }

  showMissions() {
    this.page = 'missions';
    this.onBack = () => this.showHome();
    const list = this.filtered();
    const groups = this.groupsShown(list);
    if (this.cat !== 'all' && !groups.some((x) => x.g.id === this.cat)) this.cat = 'all';
    const shown = this.cat === 'all' ? list : list.filter((s) => groupOf(s).id === this.cat);
    // keep the dock on something the grid shows
    if (!shown.some((s) => s.id === this.selected)) {
      const next = shown.find((s) => !this.bestOf(s.id)) || shown[0];
      if (next) this.selected = next.id; else this.selectedMission();
    }
    const count = (l) => `${l.filter((s) => this.bestOf(s.id)).length}/${l.length}`;
    let rail = `<button class="cat all ${this.cat === 'all' ? 'on' : ''}" data-cat="all"><span class="cn">All missions</span><span class="cc">${count(list)}</span></button><hr>`;
    let inNew = false;
    for (const { g, list: l } of groups) {
      const isNew = l.every((s) => !isClassicMission(s.id));
      if (isNew && !inNew) rail += '<div class="cats-h nw">New missions</div>';
      else if (!isNew && inNew) rail += '<hr>';
      inNew = isNew;
      rail += `<button class="cat ${this.cat === g.id ? 'on' : ''}" data-cat="${attr(g.id)}"><span class="cn">${esc(g.title)}</span><span class="cc">${count(l)}</span></button>`;
    }
    const chip = (id) => (id === 'all'
      ? `<button class="chip all ${this.acFilter === 'all' ? 'on' : ''}" data-acf="all" aria-pressed="${this.acFilter === 'all'}"><span class="lbl">All aircraft</span></button>`
      : `<button class="chip ${this.acFilter === id ? 'on' : ''}" data-acf="${id}" title="${attr(AIRCRAFT[id].name)}" aria-label="${attr(AIRCRAFT[id].name)}" aria-pressed="${this.acFilter === id}">${sil(id)}<span class="lbl">${esc(acShort(id))}</span></button>`);
    const grp = this.cat === 'all' ? null : groups.find((x) => x.g.id === this.cat).g;
    const flownShown = shown.filter((s) => this.bestOf(s.id));
    const pts = flownShown.reduce((a, s) => a + (this.bestOf(s.id).points || 0), 0);
    let grid = `<div class="tool"><h1>${esc(grp ? grp.title : 'All missions')}<span class="sub"><b>${flownShown.length}</b> of ${shown.length} flown &nbsp;·&nbsp; ${grp ? 'points' : 'career'} <b>${fmtInt(grp || this.acFilter !== 'all' ? pts : this.careerTotal())}</b></span></h1>
      <p class="blurb">${esc((grp && grp.blurb) || GROUP_BLURB[grp ? grp.id : 'all'] || '')}</p>
      <div class="chips">${['all', ...AIRCRAFT_LIST.map((a) => a.id)].map(chip).join('')}</div></div>`;
    const show = grp ? groups.filter((x) => x.g === grp) : groups;
    if (!show.length) grid += `<p class="empty">No mission flies the ${esc(acName(this.acFilter))} yet. Free flight takes it anywhere.</p>`;
    for (const { g, list: l } of show) {
      const isNew = l.every((s) => !isClassicMission(s.id));
      grid += `<h3 class="gh">${esc(g.title)}${isNew ? ' <span class="new">NEW</span>' : ''} <span class="gc">${count(l)}</span></h3>`;
      const ladder = g.id === 'city';
      const all = ladder ? this.order().filter((s) => groupOf(s) === g) : null;
      grid += `<div class="cards">${l.map((s) => this.card(s, ladder ? all.indexOf(s) + 1 : 0)).join('')}</div>`;
    }
    this.show(`<div class="app app-mis">${this.bar('challenges')}
      <main class="mis">
        <aside class="cats" aria-label="Mission groups">${rail}</aside>
        <section class="mgrid" id="mgrid">${grid}</section>
      </main>
      <div class="dock" id="dock">${this.dock(this.selectedMission())}</div>
    </div>`);
    const sel = this.q('.card.sel');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
    this.bindMissionActs();
    this.act.any = (b) => {
      const d = b.dataset;
      if (d.cat) { this.cat = d.cat; this.showMissions(); const g = this.q('#mgrid'); if (g) g.scrollTop = 0; return; }
      if (d.acf) { this.acFilter = d.acf; this.showMissions(); return; }
      if (d.id) this.select(d.id);
    };
  }
  bindMissionActs() {
    this.act['btn-fly'] = () => { const sc = this.selectedMission(); this.game.startScenario(sc); };
    this.act['btn-brief'] = () => this.showBriefingPage();
  }
  // Select a card without rebuilding the page (the grid keeps its scroll, the focus stays put).
  select(id) {
    const sc = scById(id); if (!sc) return;
    this.selected = id; this.picked = true;
    this.qa('.card.sel').forEach((c) => { c.classList.remove('sel'); c.setAttribute('aria-pressed', 'false'); });
    const c = this.q(`.card[data-id="${CSS.escape(id)}"]`);
    if (c) { c.classList.add('sel'); c.setAttribute('aria-pressed', 'true'); }
    const dock = this.q('#dock'); if (dock) dock.innerHTML = this.dock(sc);
  }

  card(sc, rung) {
    const b = this.bestOf(sc.id);
    const fam = b ? gradeFamily(b.grade) : null;
    const crash = fam === 'CRASH';
    const cls = ['card', b ? (crash ? 'crash' : 'gc-' + fam) : 'none', sc.id === this.selected ? 'sel' : '', rung ? 'ladder' : ''].join(' ');
    let best;
    if (!b) best = '<span class="c-best none"><b>—</b><em>Not flown</em></span>';
    else if (crash) best = '<span class="c-best crash"><b>CRASH</b><em>0 points</em></span>';
    else best = `<span class="c-best"><b>${b.points}</b><em>${esc(b.grade)}</em></span>`;
    const tag = rung ? ` <span class="rung">RUNG ${rung}</span>` : !isClassicMission(sc.id) && !b ? ' <span class="new">NEW</span>' : '';
    const w = b && !crash ? ` style="--w:${Math.max(3, Math.min(100, b.points))}%"` : '';
    return `<button class="${cls}"${w} data-id="${attr(sc.id)}" aria-pressed="${sc.id === this.selected}">
      <span class="c-no">${numOf(sc)}${tag}</span>${pips(difficultyOf(sc))}
      <span class="c-title">${esc(sc.title)}</span>${best}
      <span class="c-sub">${esc(acShort(sc.aircraft))} · ${esc(siteShort(sc.site))}</span>
    </button>`;
  }

  bestFact(sc) {
    const b = this.bestOf(sc.id);
    if (!b) return '<span class="nf">Not flown</span>';
    const fam = gradeFamily(b.grade);
    if (fam === 'CRASH') return '<span class="gc-CRASH">Crash</span>';
    return `<span class="gc-${fam}">${b.points} ${esc(b.grade)}</span>${b.name ? ` <small>${esc(b.name)}</small>` : ''}`;
  }

  dock(sc) {
    return `<div class="dock-id"><div class="dock-eyebrow">Mission ${numOf(sc)} · ${esc(groupOf(sc).title)}</div><h2 class="dock-title">${esc(sc.title)}</h2></div>
      <div class="facts">
        <div class="fact"><div class="fl">Aircraft</div><div class="fv">${esc(acName(sc.aircraft))}</div></div>
        <div class="fact"><div class="fl">Place</div><div class="fv">${esc(siteName(sc.site))}</div></div>
        <div class="fact"><div class="fl">Difficulty</div><div class="fv">${pips(difficultyOf(sc))}</div></div>
        <div class="fact"><div class="fl">Best</div><div class="fv g">${this.bestFact(sc)}</div></div>
      </div>
      <div class="acts"><button class="btn ghost" id="btn-brief">Briefing</button><button class="btn fly" id="btn-fly" aria-label="Fly ${attr(sc.title)}">Fly</button></div>`;
  }

  /* ------------------------------------------------------------- the briefing */

  showBriefingPage() {
    const sc = this.selectedMission();
    this.page = 'briefing';
    this.onBack = () => this.showMissions();
    const ac = sc.aircraft === 'random' ? null : AIRCRAFT[sc.aircraft];
    const site = sc.site === 'random' ? null : SITES[sc.site];
    const wx = sc.weather && typeof sc.weather === 'object' ? sc.weather : null;
    const kv = (k, v, cls = '') => `<div class="${cls}"><b>${k}</b><span>${esc(v)}</span></div>`;
    let board = kv('Wind', windText(sc)) + kv('Visibility', visText(sc.vis)) + kv('Time', sc.time === 'random' ? 'Random' : fmtTime(sc.time))
      + kv('Weight', sc.weight === 'random' ? 'Random' : sc.weight) + kv('Vref', ac ? `${(sc.scoring && sc.scoring.vref) || ac.speeds.Vref} kt` : '—')
      + kv('Malfunction', failText(sc));
    if (wx) {
      const p = WEATHER_PRESETS.find((w) => w.id === wx.preset);
      const bits = [p ? p.name : wx.preset || 'Weather'];
      if (wx.rain > 0.05) bits.push('rain'); if (wx.snow > 0.05) bits.push('snow'); if (wx.dust > 0.05) bits.push('dust'); if (wx.lightning > 0.05) bits.push('lightning');
      board += kv('Weather', [...new Set(bits)].join(', '));
      board += kv('Cloud base', wx.ceiling != null ? `${fmtInt(wx.ceiling / 0.3048 / 100) * 100} ft` : 'High');
      const ev = (wx.events || []).map((e) => EVENT_NAMES[e.type] || e.type);
      if (ev.length) board += kv('Expect', [...new Set(ev)].join(', '));
    }
    const obs = obstaclesText(sc);
    if (obs) board += kv('Obstacles', obs);
    if ((sc.seaState != null || (wx && wx.seaState != null)) && isCarrierSite(site)) board += kv('Sea', seaWord(wx && wx.seaState != null ? wx.seaState : sc.seaState));
    const tips = (sc.tips || []).map((t) => `<li>${esc(this.game.touchActive ? touchify(t) : t)}</li>`).join('');
    const start = ({ short: 'short final', medium: 'medium final', long: 'long final' })[this.game.settings.approach] || 'short final';
    const info = ac ? aircraftInfo(ac) : null;
    const side = info ? `<aside class="brief-ac">
        <div class="ba-art">${sil(info.id)}<div class="span"><span>${info.span.toFixed(1)} m</span></div></div>
        <div class="plane-cat">${esc(info.category)}</div>
        <h2>${esc(info.name)}</h2>
        <p>${esc(info.description)}</p>
        <dl class="extra">${[['Vref', `${info.vref} kt`], ['Weight', info.massText], ...info.facts].map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      </aside>` : `<aside class="brief-ac"><div class="plane-cat">Random aircraft</div><h2>Any of the four</h2><p>The airplane, the place and the weather are drawn when you press Fly.</p></aside>`;
    this.show(`<div class="app app-brief">${this.bar('challenges')}
      <main class="brief">
        <div class="brief-main">
          <button class="backlink" data-go="back">${CHEV_L}<span>All missions</span></button>
          <div class="eyebrow">Mission ${numOf(sc)} · ${esc(groupOf(sc).title)} · ${esc(acName(sc.aircraft))} · ${esc(siteName(sc.site))}</div>
          <h1>${esc(sc.title)}</h1>
          <div class="brief-meta">${pips(difficultyOf(sc))}<span class="bestline">${this.bestOf(sc.id) ? `Best ${this.bestFact(sc)}` : 'Not flown yet'} · start ${start}</span></div>
          <p class="lead">${esc(sc.desc || '')}</p>
          <div class="kneeboard">${board}</div>
          ${tips ? `<h3 class="sh">Checklist</h3><ul class="checklist">${tips}</ul>` : ''}
        </div>
        ${side}
      </main>
      <div class="dock">
        <div class="dock-id"><div class="dock-eyebrow">Briefing · mission ${numOf(sc)}</div><h2 class="dock-title">${esc(sc.title)}</h2></div>
        <div class="facts"></div>
        <div class="acts"><button class="btn ghost" data-go="back">Back</button><button class="btn fly" id="btn-fly" data-autofocus aria-label="Fly ${attr(sc.title)}">Fly</button></div>
      </div>
    </div>`);
    this.act['btn-fly'] = () => this.game.startScenario(sc);
  }

  /* ------------------------------------------------------------- the hangar */

  showAircraft() {
    this.page = 'aircraft';
    this.onBack = () => this.showHome();
    if (!this.acSel || !AIRCRAFT[this.acSel]) { const sc = scById(this.selected); this.acSel = sc && AIRCRAFT[sc.aircraft] ? sc.aircraft : AIRCRAFT_LIST[0].id; }
    const pct = (v) => Math.max(4, Math.min(100, v)).toFixed(1) + '%';
    const massPct = (kg) => ((Math.log(kg) - Math.log(500)) / (Math.log(70000) - Math.log(500))) * 100;
    const stat = (l, w, v) => `<div class="stat"><span class="sl">${l}</span><span class="sb"><b style="width:${pct(w)}"></b></span><span class="sv">${v}</span></div>`;
    const cards = AIRCRAFT_LIST.map((def) => {
      const a = aircraftInfo(def);
      const mine = this.order().filter((s) => s.aircraft === a.id);
      const fl = mine.filter((s) => this.bestOf(s.id));
      const best = Math.max(0, ...fl.map((s) => this.bestOf(s.id).points || 0));
      const work = `<div class="stat"><span class="sl">Workload</span><span class="wp">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= a.work ? 'f' : ''}"></i>`).join('')}</span><span class="sv">${a.work} / 5</span></div>`;
      const sel = a.id === this.acSel;
      return `<article class="plane ${sel ? 'sel' : ''}" data-plane="${a.id}">
        <button class="plane-hit" data-acsel="${a.id}" aria-label="${attr(a.name)}" aria-pressed="${sel}"></button>
        <div class="plane-art">${sil(a.id)}<div class="span"><span>${a.span.toFixed(1)} m</span></div></div>
        <div class="plane-cat">${esc(a.category)}</div>
        <h2>${esc(a.name)}</h2>
        <p>${esc(a.blurb)}</p>
        <div class="stats">
          ${stat('Vref', (a.vref / 150) * 100, a.vref + ' kt')}
          ${stat('Weight', massPct(a.mass), a.massText)}
          ${stat('Span', (a.span / 36) * 100, a.span.toFixed(1) + ' m')}
          ${work}
        </div>
        <dl class="extra">${a.facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
        <div class="plane-prog"><span><b>${fl.length}</b> of ${mine.length} flown</span><span>${fl.length ? `best <b>${best}</b>` : 'not flown yet'}</span></div>
        <div class="plane-acts">
          <button class="btn ${sel ? 'fly' : 'line'}" data-acm="${a.id}" ${sel ? 'data-autofocus' : ''}>Missions · ${mine.length}</button>
          <button class="btn ghost" data-acfree="${a.id}">Free flight</button>
        </div>
      </article>`;
    }).join('');
    this.show(`<div class="app app-hangar">${this.bar('aircraft')}
      <main class="hangar">
        <div class="hangar-head"><h1>Choose your aircraft</h1><p>Missions and free flight<br>follow the airplane you pick</p></div>
        <div class="planes">${cards}</div>
      </main>
    </div>`);
    this.act.any = (b) => {
      const d = b.dataset;
      if (d.acsel) { this.acSel = d.acsel; this.showAircraft(); return; }
      if (d.acm) { this.acSel = d.acm; this.acFilter = d.acm; this.cat = 'all'; const l = this.filtered(); const n = l.find((s) => !this.bestOf(s.id)) || l[0]; if (n) this.selected = n.id; this.showMissions(); return; }
      if (d.acfree) { this.acSel = d.acfree; this.game.setFreeOpts({ ...this.game.freeOpts, aircraft: d.acfree }); this.showFree('place'); }
    };
  }

  /* ------------------------------------------------------------- free flight */

  freeSummary(o) {
    const def = AIRCRAFT[o.aircraft], site = SITES[o.site], w = weatherPreset(o.weather);
    const rel = Math.round(o.windRel || 0);
    const side = Math.abs(rel) < 3 ? '' : `${Math.abs(rel)}°${rel < 0 ? 'L' : 'R'} `;
    const tp = TIME_PRESETS.find((p) => Math.abs(p.t - o.time) < 0.26);
    const start = site && site.kind === 'bush' ? 'Bush, 900 m' : (START_PRESETS.find((p) => p.dist === o.dist) || { name: `${(o.dist / 1000).toFixed(1)} km` }).name;
    return {
      aircraft: def ? def.name : o.aircraft,
      place: site ? site.name : o.site,
      weather: w.name,
      tod: tp ? tp.name : fmtTime(o.time),
      time: `${fmtTime(o.time)}${tp ? ' ' + tp.name.toLowerCase() : ''}`,
      wind: o.windSpeed < 1 ? 'Calm' : `${side}${o.windSpeed}${o.windGust > o.windSpeed ? 'G' + o.windGust : ''} kt`,
      vis: visText(o.vis),
      weight: o.weight,
      start,
      trouble: o.surprise ? 'Surprise me' : o.failures && o.failures.length ? o.failures.map((k) => (FAILURES[k] ? FAILURES[k].name : k)).join(', ') : 'None',
    };
  }
  commitFree() {
    this.free = { ...(this.game.setFreeOpts ? this.game.setFreeOpts(this.free) : (this.game.freeOpts = this.free)) };
  }

  showFree(step) {
    if (step && FREE_STEPS.includes(step)) this.freeStep = step;
    this.page = 'free';
    this.onBack = () => this.showHome();
    this.free = { ...this.game.freeOpts };
    this.renderFree();
  }

  renderFree(keepScroll = true) {
    const stage = this.q('#stage');
    const top = keepScroll && stage && this.page === 'free' ? stage.scrollTop : 0;
    const adv = this.q('.adv'); if (adv) this.advOpen = adv.open;
    this.show(`<div class="app app-free">${this.bar('free')}
      <main class="free">
        <nav class="steps" id="steps" aria-label="Free flight steps">${this.freeSteps()}</nav>
        <div class="stage" id="stage">${this.freePane()}</div>
      </main>
    </div>`);
    const st = this.q('#stage'); if (st) st.scrollTop = top;
    this.bindFree();
  }

  freeSteps() {
    const f = this.freeSummary(this.free);
    const steps = [['aircraft', 'Aircraft', f.aircraft], ['place', 'Place', f.place], ['weather', 'Weather', `${f.weather} · ${f.tod}`], ['trouble', 'Trouble', f.trouble]];
    return steps.map(([id, l, v], i) => `<button class="step ${this.freeStep === id ? 'on' : ''}" data-step="${id}" ${this.freeStep === id ? 'aria-current="step" data-autofocus' : ''}><span class="sn">${i + 1}</span><span class="sl">${l}</span><span class="sv">${esc(v)}</span></button>`).join('')
      + `<button class="btn fly step-fly" id="btn-free-fly">Fly<small>${this.freeStep === 'fly' ? 'Ready' : 'From any step'}</small></button>`;
  }

  freePane() {
    const o = this.free, def = AIRCRAFT[o.aircraft], site = SITES[o.site];
    const NEXT = { aircraft: 'place', place: 'weather', weather: 'trouble', trouble: 'fly' };
    const head = (h, sub) => `<div class="blk-h"><h2>${h}</h2><span>${sub}</span>${NEXT[this.freeStep] ? `<button class="next" data-step="${NEXT[this.freeStep]}">Next: ${NEXT[this.freeStep] === 'fly' ? 'review' : NEXT[this.freeStep]}${CHEV_R}</button>` : ''}</div>`;
    const seg = (key, opts, cur, disabled = false) => `<div class="seg" role="group">${opts.map((p) => `<button class="${cur === p.id ? 'on' : ''}" data-set="${key}" data-v="${attr(p.id)}" aria-pressed="${cur === p.id}" ${disabled ? 'disabled' : ''}>${esc(p.name)}${p.small ? `<small>${esc(p.small)}</small>` : ''}</button>`).join('')}</div>`;
    const toggle = (key, label, sub, on, disabled = false) => `<button class="toggle ${on ? 'on' : ''}" data-tog="${key}" aria-pressed="${!!on}" ${disabled ? 'disabled' : ''}><span class="tl">${label}<small>${sub}</small></span><span class="sw"></span></button>`;
    switch (this.freeStep) {
      case 'aircraft': {
        const tiles = AIRCRAFT_LIST.map((a) => { const i = aircraftInfo(a); return `<button class="tile ac ${o.aircraft === a.id ? 'on' : ''}" data-set="aircraft" data-v="${a.id}" aria-pressed="${o.aircraft === a.id}">${sil(a.id)}<span><span class="tn">${esc(i.name)}</span><br><span class="tk">${esc(i.category)} · Vref ${i.vref} kt</span></span></button>`; }).join('');
        const weights = WEIGHTS.filter((w) => def.massOptions && def.massOptions[w]).map((w) => ({ id: w, name: w, small: def.massOptions[w] >= 10000 ? `${(def.massOptions[w] / 1000).toFixed(0)} t` : `${fmtInt(def.massOptions[w])} kg` }));
        return `<div class="blk">${head('Aircraft', 'Places it cannot use are greyed out on the next step.')}<div class="tiles t4">${tiles}</div></div>
          <div class="blk narrow"><div class="blk-h"><h3>Weight</h3></div>${seg('weight', weights, o.weight)}</div>`;
      }
      case 'place': {
        const ids = Object.keys(SITES);
        const tiles = ids.map((id) => {
          const s = SITES[id], u = siteUsable(s, def), fresh = !CLASSIC_SITES.includes(id);
          return `<button class="tile ${o.site === id ? 'on' : ''} ${u.ok ? '' : 'off'}" data-set="site" data-v="${attr(id)}" aria-pressed="${o.site === id}" ${u.ok ? '' : `aria-disabled="true" title="${attr(u.reason)}"`}>${fresh ? '<span class="new">NEW</span>' : ''}<span class="tn">${esc(s.name)}</span><span class="tk">${esc(siteLine(s))}</span>${u.ok ? '' : `<span class="why">${esc(u.reason)}</span>`}</button>`;
        }).join('');
        const bush = site && site.kind === 'bush';
        const starts = START_PRESETS.map((p) => ({ id: String(p.dist), name: p.name, small: `${p.dist / 1000} km` }));
        const hasObs = siteHasObstacles(site);
        const usable = ids.filter((id) => siteUsable(SITES[id], def).ok).length;
        return `<div class="blk">${head('Place', `${ids.length} places. The ${esc(def.short || def.name)} can use ${usable}.`)}<div class="tiles t6">${tiles}</div></div>
          <div class="two">
            <div class="blk"><div class="blk-h"><h3>Start</h3>${bush ? '<span>Bush strips start 900 m out, over the trees</span>' : ''}</div>${seg('dist', starts, bush ? '' : String(o.dist), bush)}</div>
            <div class="blk"><div class="blk-h"><h3>Obstacles</h3></div>${hasObs ? toggle('obstacles', o.obstacles ? 'Obstacles on' : 'Obstacles off', 'Trees, towers and wires on the approach', o.obstacles) : toggle('obstacles', 'None here', 'This place has nothing in the way', false, true)}</div>
          </div>`;
      }
      case 'weather': {
        const presets = WEATHER_PRESETS.map((w) => `<button class="preset ${o.weather === w.id ? 'on' : ''}" data-set="weather" data-v="${w.id}" aria-pressed="${o.weather === w.id}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[w.id] || ICON.clear}</svg><span class="pn">${esc(w.name)}</span><span class="ps">${esc(w.sub)}</span></button>`).join('');
        const tod = TIME_PRESETS.map((p) => ({ id: String(p.t), name: p.name, small: fmtTime(p.t) }));
        const curT = TIME_PRESETS.find((p) => Math.abs(p.t - o.time) < 0.26);
        const open = this.advOpen == null ? (typeof window !== 'undefined' && window.innerHeight > 560) : this.advOpen;
        return `<div class="blk">${head('Weather', 'Pick a preset. Advanced fine-tunes it.')}<div class="presets">${presets}</div></div>
          <div class="blk"><div class="blk-h"><h3>Time of day</h3></div>${seg('time', tod, curT ? String(curT.t) : '')}</div>
          <details class="adv" ${open ? 'open' : ''}><summary>${CHEV_R}Advanced<span class="hint">Wind · visibility · cloud · sea · exact time and start</span></summary>
            <div class="adv-body">${this.freeAdvanced()}</div>
          </details>`;
      }
      case 'trouble': {
        const avail = Object.keys(FAILURES).filter((k) => failureApplies(FAILURES[k], def));
        const chips = avail.map((k) => `<button class="fail ${o.failures.includes(k) ? 'on' : ''}" data-fail="${attr(k)}" aria-pressed="${o.failures.includes(k)}" ${o.surprise ? 'disabled' : ''} title="${attr(FAILURES[k].desc || '')}">${esc(FAILURES[k].name || k)}</button>`).join('');
        return `<div class="blk">${head('Trouble', 'Pick any number, or let it surprise you.')}<div class="fails">${chips}</div></div>
          <div class="two">
            <div class="blk"><div class="blk-h"><h3>Surprise me</h3></div>${toggle('surprise', 'Surprise me', 'Something breaks. You are not told what.', o.surprise)}</div>
            <div class="blk"><div class="blk-h"><h3>When</h3></div>${seg('when', WHEN, o.when)}</div>
          </div>`;
      }
      default: {
        const f = this.freeSummary(o);
        const it = (k, v) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`;
        return `<div class="blk"><div class="blk-h"><h2>Ready</h2><span>Everything you did not touch stays as it was.</span></div>
          <div class="ready"><dl>${it('Aircraft', f.aircraft)}${it('Weight', f.weight)}${it('Place', f.place)}${it('Start', f.start)}${it('Time', f.time)}${it('Weather', f.weather)}${it('Wind', f.wind)}${it('Visibility', f.vis)}${it('Trouble', f.trouble)}</dl>
            <button class="btn fly" id="btn-free-go" data-autofocus>Fly</button></div></div>`;
      }
    }
  }

  freeAdvanced() {
    const o = this.free, site = SITES[o.site];
    const carrier = isCarrierSite(site), bush = site && site.kind === 'bush';
    const range = (key, label, min, max, step, val, out, off = false, note = '') => `<div class="ctl ${off ? 'off' : ''}"><div class="ctl-h"><label for="r-${key}">${label}${off && note ? `<span class="why"> · ${note}</span>` : ''}</label><output id="o-${key}">${out}</output></div>
      <input type="range" id="r-${key}" min="${min}" max="${max}" step="${step}" value="${val}" data-range="${key}" ${off ? 'disabled' : ''} style="--v:${(((val - min) / (max - min)) * 100).toFixed(1)}%"></div>`;
    const turbSeg = `<div class="seg" role="group">${TURB_LEVELS.map((t) => `<button class="${turbLevel(o.turb).id === t.id ? 'on' : ''}" data-set="turb" data-v="${t.v}" aria-pressed="${turbLevel(o.turb).id === t.id}">${t.name}</button>`).join('')}</div>`;
    const gustAbove = Math.max(0, o.windGust - o.windSpeed);
    return `<div class="dialbox">${this.dial()}</div>
      <div>${range('windSpeed', 'Wind speed', LIMITS.windSpeed[0], LIMITS.windSpeed[1], 1, o.windSpeed, this.fmtOut('windSpeed', o.windSpeed))}
        ${range('gust', 'Gusts', 0, LIMITS.gustAbove[1], 1, gustAbove, this.fmtOut('gust', gustAbove))}
        <div class="ctl"><div class="ctl-h"><label>Turbulence</label></div>${turbSeg}</div>
        <div class="ctl"><button class="toggle ${o.microburst ? 'on' : ''}" data-tog="microburst" aria-pressed="${o.microburst}"><span class="tl">Wind shear<small>Microburst on short final</small></span><span class="sw"></span></button></div></div>
      <div>${range('vis', 'Visibility', 0, 100, 1, visToSlider(o.vis), this.fmtOut('vis', o.vis))}
        ${range('ceilingFt', 'Cloud ceiling', LIMITS.ceilingFt[0], LIMITS.ceilingFt[1], 100, o.ceilingFt == null ? LIMITS.ceilingFt[1] : o.ceilingFt, this.fmtOut('ceilingFt', o.ceilingFt))}
        ${range('seaState', 'Sea state', LIMITS.seaState[0], LIMITS.seaState[1], 0.05, o.seaState, this.fmtOut('seaState', o.seaState), !carrier, 'carrier only')}</div>
      <div>${range('time', 'Time of day', LIMITS.time[0], LIMITS.time[1], 0.25, o.time, this.fmtOut('time', o.time))}
        ${range('dist', 'Start distance', LIMITS.dist[0], LIMITS.dist[1], 100, o.dist, this.fmtOut('dist', o.dist), bush, 'fixed on a bush strip')}</div>`;
  }

  fmtOut(key, v) {
    switch (key) {
      case 'windSpeed': return `${v}<small>kt</small>`;
      case 'gust': return v > 0 ? `G${this.free.windSpeed + v}<small>kt</small>` : 'none';
      case 'vis': { const t = visText(v); const [n, u] = t.split(' '); return `${n}<small>${u}</small>`; }
      case 'ceilingFt': return v == null || v >= LIMITS.ceilingFt[1] ? 'none' : `${fmtInt(v)}<small>ft</small>`;
      case 'seaState': return `${(+v).toFixed(1)}<small>${seaWord(+v)}</small>`;
      case 'time': return fmtTime(+v);
      case 'dist': return `${(v / 1000).toFixed(1)}<small>km</small>`;
      default: return String(v);
    }
  }

  // The wind dial: where the wind comes FROM relative to the nose (drag it, or arrow keys when focused).
  dial() {
    const o = this.free;
    const rel = o.windRel || 0, spd = o.windSpeed || 0;
    const a = (rel * Math.PI) / 180, sx = Math.sin(a), cy = Math.cos(a);
    const P = (r) => [+(r * sx).toFixed(1), +(-r * cy).toFixed(1)];
    const [x1, y1] = P(84), tip = P(36), d = [-sx, cy], pp = [cy, sx];
    const b = [tip[0] - 13 * d[0], tip[1] - 13 * d[1]];
    const headPts = `${tip[0]},${tip[1]} ${(b[0] + 6 * pp[0]).toFixed(1)},${(b[1] + 6 * pp[1]).toFixed(1)} ${(b[0] - 6 * pp[0]).toFixed(1)},${(b[1] - 6 * pp[1]).toFixed(1)}`;
    let ticks = '';
    for (let i = 0; i < 36; i++) {
      const t = (i * 10 * Math.PI) / 180, big = i % 9 === 0, r0 = big ? 80 : 86;
      ticks += `<line x1="${(r0 * Math.sin(t)).toFixed(1)}" y1="${(-r0 * Math.cos(t)).toFixed(1)}" x2="${(92 * Math.sin(t)).toFixed(1)}" y2="${(-92 * Math.cos(t)).toFixed(1)}" stroke="${big ? 'rgba(255,255,255,.45)' : 'rgba(255,255,255,.16)'}" stroke-width="${big ? 1.6 : 1}"/>`;
    }
    const g0 = ((rel - 18) * Math.PI) / 180, g1 = ((rel + 18) * Math.PI) / 180;
    const arc = `M${(92 * Math.sin(g0)).toFixed(1)} ${(-92 * Math.cos(g0)).toFixed(1)} A92 92 0 0 1 ${(92 * Math.sin(g1)).toFixed(1)} ${(-92 * Math.cos(g1)).toFixed(1)}`;
    const head = Math.round(spd * Math.cos(a)), cross = Math.round(spd * Math.abs(Math.sin(a)));
    const from = Math.abs(rel) < 3 ? 'On the <b>nose</b>' : Math.abs(rel) > 177 ? 'From <b>behind</b>' : `From <b>${Math.abs(rel)}° ${rel > 0 ? 'right' : 'left'}</b> of the nose`;
    return `<div class="dial" tabindex="0" role="slider" aria-label="Wind direction relative to the nose" aria-valuemin="-180" aria-valuemax="180" aria-valuenow="${rel}" aria-valuetext="${Math.abs(rel)} degrees ${rel >= 0 ? 'right' : 'left'}" data-arrows>
      <svg viewBox="-100 -100 200 200" aria-hidden="true">
        <circle r="92" fill="rgba(8,12,18,.6)" stroke="rgba(255,255,255,.14)"/>${ticks}
        <path d="${arc}" fill="none" stroke="rgba(159,247,200,.35)" stroke-width="7"/>
        <rect x="-8" y="-52" width="16" height="104" rx="1" fill="rgba(255,255,255,.06)" stroke="rgba(255,255,255,.35)"/>
        <path d="M0 -44 V44" stroke="rgba(255,255,255,.35)" stroke-dasharray="6 6"/>
        <text x="0" y="-60" text-anchor="middle" fill="#8b98a8" font-family="Share Tech Mono, monospace" font-size="11" letter-spacing="2">NOSE</text>
        <line x1="${x1}" y1="${y1}" x2="${(tip[0] - 10 * d[0]).toFixed(1)}" y2="${(tip[1] - 10 * d[1]).toFixed(1)}" stroke="#9ff7c8" stroke-width="3"/>
        <polygon points="${headPts}" fill="#9ff7c8"/>
        <circle cx="${x1}" cy="${y1}" r="9" fill="#e9fff3" stroke="#9ff7c8" stroke-width="3"/>
      </svg>
      <div class="dl">${from}<br><b>${Math.abs(head)}</b> kt ${head >= 0 ? 'head' : 'tail'} · <b>${cross}</b> kt cross</div></div>`;
  }

  bindFree() {
    const fly = () => { this.commitFree(); this.game.startFree(); };
    this.act['btn-free-fly'] = fly;
    this.act['btn-free-go'] = fly;
    this.act.any = (b) => {
      const d = b.dataset, o = this.free;
      if (d.step) { this.freeStep = d.step; this.renderFree(false); return; }
      if (d.set) {
        const k = d.set, v = d.v;
        if (k === 'site' && b.getAttribute('aria-disabled') === 'true') return;
        if (k === 'weather') applyWeatherPreset(o, v);
        else if (k === 'time' || k === 'dist' || k === 'turb') o[k] = +v;
        else o[k] = v;
        this.commitFree(); this.renderFree(); return;
      }
      if (d.tog) { o[d.tog] = !o[d.tog]; this.commitFree(); this.renderFree(); return; }
      if (d.fail) { const f = d.fail; o.failures = o.failures.includes(f) ? o.failures.filter((x) => x !== f) : [...o.failures, f]; this.commitFree(); this.renderFree(); }
    };
    this.onInputs = (e, done) => {
      const r = e.target.closest('[data-range]'); if (!r) return;
      const k = r.dataset.range, v = +r.value, o = this.free;
      r.style.setProperty('--v', (((v - +r.min) / (+r.max - +r.min)) * 100).toFixed(1) + '%');
      if (k === 'windSpeed') { const above = Math.max(0, o.windGust - o.windSpeed); o.windSpeed = v; o.windGust = v + above; }
      else if (k === 'gust') o.windGust = o.windSpeed + v;
      else if (k === 'vis') o.vis = sliderToVis(v);
      else if (k === 'ceilingFt') o.ceilingFt = v >= LIMITS.ceilingFt[1] ? null : v;
      else o[k] = v;
      const out = this.q('#o-' + k);
      if (out) out.innerHTML = this.fmtOut(k, k === 'vis' ? o.vis : k === 'ceilingFt' ? o.ceilingFt : v);
      if (k === 'windSpeed') { const g = this.q('#o-gust'); if (g) g.innerHTML = this.fmtOut('gust', Math.max(0, o.windGust - o.windSpeed)); this.redrawDial(); }
      if (done) { this.commitFree(); const s = this.q('#steps'); if (s) { s.innerHTML = this.freeSteps(); } }
    };
    const dial = this.q('.dial');
    if (dial) {
      const setFrom = (ev) => {
        const r = dial.querySelector('svg').getBoundingClientRect();
        const x = ev.clientX - (r.left + r.width / 2), y = ev.clientY - (r.top + r.height / 2);
        if (Math.hypot(x, y) < 6) return;
        this.free.windRel = Math.round(wrap180((Math.atan2(x, -y) * 180) / Math.PI) / 5) * 5;
        this.redrawDial();
      };
      let dragging = false;
      dial.addEventListener('pointerdown', (ev) => { dragging = true; try { dial.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ } setFrom(ev); ev.preventDefault(); });
      dial.addEventListener('pointermove', (ev) => { if (dragging) setFrom(ev); });
      const end = () => { if (!dragging) return; dragging = false; this.commitFree(); };
      dial.addEventListener('pointerup', end); dial.addEventListener('pointercancel', end);
      dial.addEventListener('keydown', (ev) => {
        const step = ev.shiftKey ? 15 : 5;
        const dv = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step }[ev.key];
        if (dv == null) return;
        ev.preventDefault();
        this.free.windRel = Math.round(wrap180(this.free.windRel + dv));
        this.redrawDial(); this.commitFree();
      });
    }
  }
  redrawDial() {
    const box = this.q('.dialbox'); if (!box) return;
    const focused = box.contains(document.activeElement);
    const old = box.querySelector('.dial');
    // swap the drawing only, so an ongoing pointer capture on .dial survives
    const tmp = document.createElement('div'); tmp.innerHTML = this.dial();
    const neu = tmp.firstElementChild;
    old.innerHTML = neu.innerHTML;
    for (const a of ['aria-valuenow', 'aria-valuetext']) old.setAttribute(a, neu.getAttribute(a));
    if (focused) old.focus();
  }

  /* ------------------------------------------------------------- the logbook */

  /**
   * The leaderboard. Two tables: every pilot's career total, and the top ten on one mission (the one selected in
   * the missions page, changeable here).
   *
   * This replaces what the game used to show, which was a single line per challenge
   * naming whoever last beat it — Marc's point being that one name is not a board.
   * Rows are fetched, so the screen paints immediately with "reading…" and fills in;
   * with no network it falls back to this machine's own bests and says so.
   */
  showLogbook(back) {
    this.page = 'logbook';
    this.onBack = back || (() => this.showHome());
    const sc = this.selectedMission();
    const pilot = this.game.pilot || '';
    const best = this.game.best || {};
    const flown = SCENARIOS.filter((s) => best[s.id]).length;
    const opts = this.order().map((s) => `<option value="${attr(s.id)}" ${s.id === sc.id ? 'selected' : ''}>${numOf(s)} · ${esc(s.title)}</option>`).join('');
    const body = `
      <div class="eyebrow">Logbook</div>
      <h1>The board</h1>
      <p class="lead">Your career is every mission's best added up &mdash; ${fmtInt(this.careerTotal())} points from ${flown} of ${SCENARIOS.length} missions.</p>
      <div class="pilot">
        <label for="lb-pilot">Logbook name</label>
        <input id="lb-pilot" type="text" maxlength="16" value="${attr(pilot)}" placeholder="your name" autocomplete="off" autocapitalize="words" spellcheck="false">
        <button class="btn small" id="btn-lb-pilot">Save</button>
        <span class="note">Shared with the games on goodmarc.com, so you type it once.</span>
      </div>
      <div class="boards">
        <section><h2>Career</h2><div class="board" id="board-career"><p class="note">Reading the board&hellip;</p></div></section>
        <section><h2><select id="lb-mission" aria-label="Mission board">${opts}</select></h2><div class="board" id="board-one"><p class="note">Reading the board&hellip;</p></div></section>
      </div>`;
    this.show(`<div class="app app-page">${back ? this.soloBar('Logbook') : this.bar('logbook')}<main class="page"><div class="page-inner">${body}</div></main></div>`);
    this.act['btn-lb-pilot'] = () => {
      const input = this.q('#lb-pilot');
      const saved = this.game.setPilot(input ? input.value : '');
      if (input) input.value = saved;
      this.showLogbook(back);
    };
    this.onInputs = (e, done) => {
      if (done && e.target.id === 'lb-mission') { this.selected = e.target.value; this.fillBoard('#board-one', e.target.value); }
    };
    const inp = this.q('#lb-pilot');
    if (inp) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.act['btn-lb-pilot'](); } });
    this.fillBoard('#board-career', '');
    this.fillBoard('#board-one', sc.id);
  }

  /** Fetch one board and paint it. Never throws into the menu. */
  fillBoard(sel, board) {
    const node = this.q(sel);
    if (!node) return;
    const local = () => this.localRows(board);
    readBoard(board, local).then(({ rows, source }) => {
      const live = this.q(sel);           // the pilot may have changed tab meanwhile
      if (!live) return;
      if (!rows.length) {
        live.innerHTML = `<p class="note">${source === 'world' ? 'Nobody has flown this yet.' : 'Not flown on this machine yet.'}</p>`;
        return;
      }
      live.innerHTML = `<table class="lb">
        <thead><tr><th>#</th><th>Pilot</th><th class="n">Points</th><th class="n">${board ? 'Grade' : 'Flown'}</th></tr></thead>
        <tbody>${rows.map((r, i) => `<tr class="${cleanRowClass(i)}">
          <td class="n">${i + 1}</td>
          <td>${esc(r.name)}</td>
          <td class="n">${r.score}</td>
          <td class="n">${esc(String(board ? (r.grade || '-') : (r.flown != null ? r.flown : '-')))}</td>
        </tr>`).join('')}</tbody>
      </table>
      <p class="note">${source === 'world' ? 'Everyone who has flown it.' : 'This machine only - the shared board is not reachable right now.'}</p>`;
    }).catch(() => {
      const live = this.q(sel);
      if (live) live.innerHTML = '<p class="note">The board could not be read.</p>';
    });
  }

  /** The offline fallback: what this machine knows, shaped like the API's rows. */
  localRows(board) {
    const best = this.game.best || {};
    const name = pilotName.get() || 'YOU';
    if (board) {
      const b = best[board];
      return b ? [{ name, score: b.points, grade: b.grade }] : [];
    }
    const ids = Object.keys(best);
    if (!ids.length) return [];
    return [{ name, score: ids.reduce((a, id) => a + (best[id].points || 0), 0), flown: ids.length }];
  }

  /* ------------------------------------------------------------- debrief */

  showDebrief(result, sc, stats) {
    this.page = 'debrief';
    const free = sc.id === 'free';
    const toMenu = () => { if (free) this.after = 'free'; else { this.selected = sc.id; this.after = 'missions'; } this.game.toMenu(); };
    this.onBack = toMenu;
    const lines = result.lines.map((l) => `<div><span class="k">${esc(l.k)}</span><span class="v ${l.cls}">${esc(l.v)}</span></div>`).join('');
    const pilot = this.game.pilot || '';
    const b = stats.best;
    const standing = b && !stats.newBest ? `<span class="bestline">Best <b>${b.points} · ${esc(b.grade)}</b>${b.name ? ` · ${esc(b.name)}` : ''}</span>` : '';
    // a new best asks who flew it. The name stays in this browser and is stamped on the next bests by itself; Save keeps a changed one.
    const who = stats.newBest ? `<div class="pilot"><label for="pilot-name">Logbook name</label><input id="pilot-name" type="text" maxlength="16" value="${attr(pilot)}" placeholder="your name" autocomplete="off" autocapitalize="words" spellcheck="false"><button class="btn small" id="btn-pilot">Save</button><span class="note" id="pilot-note">${pilot ? 'This browser remembers it. Change it to log the flight under another name.' : 'Type it once; this browser remembers it for your next best.'}</span></div>` : '';
    const fam = gradeFamily(result.grade);
    this.show(`<div class="app app-deb">
      <header class="bar solo"><span class="brand sm static"><span class="bt">Cleared to Land</span></span><div class="bar-title">Logbook entry</div></header>
      <main class="deb">
        <section class="deb-score">
          <div class="eyebrow">Debrief · ${free ? 'Free flight' : `Mission ${numOf(sc)}`} · ${esc(sc.title)}</div>
          <div class="stamp g${result.gradeIdx} gc-${fam}">${esc(result.grade)}</div>
          <div class="scoreline"><span class="pts">${result.points}<small> / 100</small></span>${stats.newBest ? '<span class="newbest">NEW BEST</span>' : ''}${standing}</div>
          ${who}
          <p class="lead">${esc(result.headline)}</p>
        </section>
        <section class="deb-ledger"><h3 class="sh">The ledger</h3><div class="ledger">${lines}</div></section>
      </main>
      <div class="dock">
        <div class="dock-id"><div class="dock-eyebrow">${free ? 'Free flight' : `Mission ${numOf(sc)} · ${esc(groupOf(sc).title)}`}</div><h2 class="dock-title">${esc(sc.title)}</h2></div>
        <div class="facts"></div>
        <div class="acts">
          <button class="btn quiet" id="btn-menu">${free ? 'Free flight' : 'Missions'}</button>
          ${stats.next && !free ? `<button class="btn ghost" id="btn-next">Next: ${esc(stats.next.title)}</button>` : ''}
          <button class="btn fly" id="btn-retry" data-autofocus>Fly again</button>
        </div>
      </div>
    </div>`, 'debrief');
    this.act['btn-retry'] = () => this.game.retry();
    this.act['btn-next'] = () => { this.selected = stats.next.id; this.picked = true; this.after = 'briefing'; this.game.toMenu(); };
    this.act['btn-menu'] = toMenu;
    if (stats.newBest) {
      const inp = this.q('#pilot-name'), note = this.q('#pilot-note');
      const save = () => {
        const name = this.game.setPilot(inp.value);
        this.game.nameBest(sc.id, name);
        inp.value = name;
        note.textContent = name ? `Saved. ${name} is in the logbook.` : 'Saved without a name.';
      };
      this.act['btn-pilot'] = save;
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); inp.blur(); } });
      if (!pilot && !this.game.touchActive) inp.focus();
    }
  }

  /* ------------------------------------------------------------- pause */

  showPause() {
    this.page = 'pause';
    this.onBack = () => this.game.resume();
    const sc = this.game.scenario;
    this.show(`<div class="pause"><div class="pausebox">
      <div class="eyebrow">${sc ? esc(sc.id === 'free' ? 'Free flight' : `Mission ${numOf(sc)} · ${sc.title}`) : ''}</div>
      <h1>Paused</h1>
      <div class="pause-main">
        <button class="btn fly" id="btn-resume" data-autofocus>Resume</button>
        <button class="btn ghost" id="btn-restart">Restart</button>
        <button class="btn ghost" id="btn-end">End flight</button>
      </div>
      <div class="pause-more">
        <button class="btn quiet" id="btn-controls">Controls</button>
        <button class="btn quiet" id="btn-settings">Settings</button>
        <button class="btn quiet" id="btn-menu">Menu</button>
      </div>
      <p class="pause-note">Esc or P resumes</p>
    </div></div>`, 'pause');
    this.act['btn-resume'] = () => this.game.resume();
    this.act['btn-restart'] = () => this.game.retry();
    this.act['btn-end'] = () => this.game.endFlight();
    this.act['btn-controls'] = () => this.showControls(() => this.showPause());
    this.act['btn-settings'] = () => this.showSettings(() => this.showPause());
    this.act['btn-menu'] = () => { this.after = null; this.game.toMenu(); };
  }

  /* ------------------------------------------------------------- controls */

  showControls(back) {
    this.page = 'controls';
    this.onBack = back || (() => this.showHome());
    const stickSide = (this.game.settings.stickSide || 'right') === 'right' ? 'right' : 'left';
    const otherSide = stickSide === 'right' ? 'left' : 'right';
    const touchSheet = this.game.touchActive ? `
      <h2>On a phone or tablet</h2>
      <div class="keys">
        <div><span>Pitch and roll: touch anywhere on the ${stickSide} side of the screen and the stick jumps under your thumb (it rests there dimmed until you do). Pull down = nose up, push up = nose down, left / right = bank</span><b>STICK</b></div>
        <div><span>Or fly by tilting the phone itself: Settings > Tilt to fly. However you are holding it when the flight starts is neutral; TILT at the bottom left makes wherever you are holding it now the new neutral. The stick still works</span><b>TILT</b></div>
        <div><span>Throttle: the slider on the ${otherSide} edge. It stays where you leave it</span><b>THR</b></div>
        <div><span>Rudder, and nose-wheel steering on the ground: the slider at the bottom ${otherSide}. It springs back to the middle</span><b>RUDDER</b></div>
        <div><span>Wheel brakes and reverse thrust (jets): hold the buttons at the bottom left</span><b>BRAKES · REV</b></div>
        <div><span>Flaps, gear, hook, spoilers, autobrake: tap the buttons at the top left. Trim: hold</span><b>FLAPS ▼ ▲ · GEAR · TRIM</b></div>
        <div><span>Next camera and pause: top right</span><b>CAM · ❚❚</b></div>
        <div><span>Swing the chase camera anywhere around the airplane, above or below: drag on the ${otherSide} side of the screen, between the controls. Pinch to zoom. In the cockpit and wing views the drag turns your head. Double-tap to put it back</span><b>VIEW</b></div>
      </div>
      <h2>Keyboard</h2>` : '';
    const sheet = `
      <div class="eyebrow">Controls</div>
      <h1>Hands on</h1>${touchSheet}
      <div class="keys">${KEY_HELP.map(([k, v]) => `<div><span>${esc(v)}</span><b>${esc(k)}</b></div>`).join('')}</div>
      <h2>How to land</h2>
      <p>Pitch controls airspeed, throttle controls the descent rate. Put the green flight-path circle on the touchdown point. Keep the PAPI lights two white, two red (or the glideslope needle centered). Cross the threshold at Vref, throttle to idle, raise the nose just enough to stop the descent, and let the wheels find the runway. Keep it straight with rudder, then brake.</p>
      <p>Crosswind: point the nose into the wind (crab) so the runway stays centered; in the flare, straighten the nose with rudder and lower the upwind wing. Carrier: no flare. Fly the ball to the deck at on-speed angle of attack.</p>
      <div class="actions"><button class="btn ghost" id="btn-back" data-go="back">${back ? 'Back' : 'Done'}</button></div>
      <div class="credit">Aircraft models from poly.pizza (CC-BY 3.0): Small Airplane by Vojtěch Balák · Airplane 3268 by Remy Tauziac · Biplane and Fighter jet by their authors (see CREDITS.md). Everything else is procedural. Built with three.js.</div>`;
    this.show(`<div class="app app-page">${back ? this.soloBar('Controls') : this.bar('controls')}<main class="page"><div class="page-inner">${sheet}</div></main></div>`, back ? 'over' : 'inner');
  }

  /* ------------------------------------------------------------- settings */

  showSettings(back) {
    this.page = 'settings';
    this.onBack = back || (() => this.showHome());
    const s = this.game.settings;
    const sheet = `
      <div class="eyebrow">Settings</div>
      <h1>Setup</h1>
      <div class="form">
        <label class="field"><span>Start the approach</span><select id="s-approach"><option value="short">Short final (about 20 s to touchdown)</option><option value="medium">Medium (about 40 s)</option><option value="long">Long (about a minute)</option></select></label>
        <label class="field"><span>Graphics quality</span><select id="s-quality"><option value="high">High (shadows, bloom, MSAA)</option><option value="medium">Medium</option><option value="low">Low (fast)</option></select></label>
        <label class="field"><span>Control feel</span><select id="s-control"><option value="assist">Assisted: keys/mouse command attitude, plane levels itself</option><option value="direct">Direct: raw control surfaces (gamepad, purists)</option></select></label>
        <label class="field"><span>Mouse yoke sensitivity</span><input type="range" id="s-msens" min="0.15" max="1.5" step="0.05" value="${s.mouseSens ?? 0.5}"><span class="v" id="s-msens-v">${(s.mouseSens ?? 0.5).toFixed(2)}</span></label>
        <label class="field"><span>Keyboard sensitivity</span><input type="range" id="s-sens" min="0.4" max="1.6" step="0.1" value="${s.sensitivity}"><span class="v" id="s-sens-v">${s.sensitivity.toFixed(1)}</span></label>
        <label class="field"><span>Auto-trim (holds the pitch you leave it at)</span><input type="checkbox" id="s-autotrim" ${s.autoTrim ? 'checked' : ''}></label>
        <label class="field"><span>Invert pitch (${this.game.touchActive ? 'stick forward' : 'up arrow / mouse forward'} raises the nose)</span><input type="checkbox" id="s-invert" ${s.invert ? 'checked' : ''}></label>
        <label class="field"><span>Master volume</span><input type="range" id="s-vol" min="0" max="1" step="0.05" value="${s.volume}"><span class="v" id="s-vol-v">${Math.round(s.volume * 100)}%</span></label>
        <label class="field"><span>Voice callouts</span><input type="checkbox" id="s-voice" ${s.voice ? 'checked' : ''}></label>
        <label class="field"><span>Hints during flight</span><input type="checkbox" id="s-hints" ${s.hints ? 'checked' : ''}></label>
        <label class="field"><span>Controls strip at the bottom</span><input type="checkbox" id="s-keystrip" ${s.keyStrip !== false ? 'checked' : ''}></label>
        <label class="field"><span>Touch controls (on-screen stick, throttle, buttons)</span><select id="s-touch"><option value="auto">Auto: phones and tablets</option><option value="on">Always on</option><option value="off">Off</option></select></label>
        <label class="field"><span>Stick for pitch and roll (phone)</span><select id="s-stick"><option value="right">Right thumb, everything else on the left</option><option value="left">Left thumb, throttle and rudder on the right</option></select></label>
        <label class="field"><span>Tilt to fly (phone: bank and tilt it instead of using the stick)</span><input type="checkbox" id="s-tilt" ${s.tilt ? 'checked' : ''}></label>
        <label class="field"><span>Lower the graphics automatically when the frame rate drops</span><input type="checkbox" id="s-autoq" ${this.game.autoQualityOn ? 'checked' : ''}></label>
        <label class="field"><span>Starting camera</span><select id="s-cam"><option value="chase">Chase</option><option value="cockpit">Cockpit</option><option value="tower">Tower</option></select></label>
        <label class="field"><span>Logbook name (a new best is logged under it)</span><input type="text" id="s-pilot" maxlength="16" value="${attr(this.game.pilot || '')}" placeholder="your name" autocomplete="off" autocapitalize="words" spellcheck="false"></label>
      </div>
      <div class="also"><span>Also here</span><button class="tab" data-go="${back ? 'controls-over' : 'controls'}">Controls ${CHEV_R}</button><button class="tab" data-go="${back ? 'logbook-over' : 'logbook'}">Logbook ${CHEV_R}</button></div>
      <div class="actions"><button class="btn fly" id="btn-back">Done</button><span class="note">Saved as you change it.</span></div>`;
    this.show(`<div class="app app-page">${back ? this.soloBar('Settings') : this.bar('settings')}<main class="page page-set"><div class="page-inner">${sheet}</div></main></div>`, back ? 'over' : 'inner');
    this.q('#s-quality').value = s.quality;
    this.q('#s-cam').value = s.camera;
    this.q('#s-approach').value = s.approach || 'short';
    this.q('#s-control').value = s.controlMode || 'assist';
    this.q('#s-touch').value = s.touch || 'auto';
    this.q('#s-stick').value = s.stickSide || 'right';
    const fmt = { 's-msens': (x) => x.toFixed(2), 's-sens': (x) => x.toFixed(1), 's-vol': (x) => Math.round(x * 100) + '%' };
    const paint = (i) => { if (i.type === 'range') i.style.setProperty('--v', (((+i.value - +i.min) / (+i.max - +i.min)) * 100).toFixed(1) + '%'); };
    this.qa('input[type=range]').forEach(paint);
    const save = () => {
      s.quality = this.q('#s-quality').value; s.sensitivity = +this.q('#s-sens').value; s.mouseSens = +this.q('#s-msens').value; s.volume = +this.q('#s-vol').value;
      s.voice = this.q('#s-voice').checked; s.hints = this.q('#s-hints').checked; s.invert = this.q('#s-invert').checked; s.camera = this.q('#s-cam').value;
      s.approach = this.q('#s-approach').value; s.autoTrim = this.q('#s-autotrim').checked; s.keyStrip = this.q('#s-keystrip').checked; s.controlMode = this.q('#s-control').value;
      s.touch = this.q('#s-touch').value; s.autoQuality = this.q('#s-autoq').checked; s.tilt = this.q('#s-tilt').checked; s.stickSide = this.q('#s-stick').value;
      this.game.setPilot(this.q('#s-pilot').value);
      this.game.applySettings();
    };
    this.onInputs = (e, done) => {
      const i = e.target;
      if (fmt[i.id]) { const v = this.q('#' + i.id + '-v'); if (v) v.textContent = fmt[i.id](+i.value); paint(i); }
      if (done) save();
    };
    const leave = () => { save(); if (back) back(); else this.showHome(); };
    this.onBack = leave;
    this.act['btn-back'] = leave;
    this.act.any = (b) => {
      const g = b.dataset.go;
      if (g === 'controls-over') { save(); this.showControls(() => this.showSettings(back)); }
      else if (g === 'logbook-over') { save(); this.showLogbook(() => this.showSettings(back)); }
    };
  }
}

// A selector that finds "the same" element after a rebuild: its id, else its data-* attributes.
function focusKey(el, root) {
  if (!el || !root || !root.contains(el) || el === root) return null;
  if (el.id) return '#' + CSS.escape(el.id);
  const parts = [...el.attributes].filter((a) => a.name.startsWith('data-') && a.name !== 'data-autofocus').map((a) => `[${a.name}="${CSS.escape(a.value)}"]`);
  return parts.length ? el.tagName.toLowerCase() + parts.join('') : null;
}

export function fmtTime(t) { const h = Math.floor(t), m = Math.round((t - h) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }
