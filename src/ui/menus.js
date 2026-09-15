// Menus: a flight list down the left, a kneeboard briefing on the right. Debrief as a logbook entry.
import { SCENARIOS, SITES } from '../systems/scenarios.js';
import { AIRCRAFT_LIST, AIRCRAFT } from '../aircraft/defs.js';
import { FAILURES } from '../systems/malfunctions.js';
import { KEY_HELP } from '../input.js';
import { touchify } from '../touch.js';

const GROUPS = [
  ['Basics', ['solo', 'xwind15', 'gusty']],
  ['Heavy iron', ['heavy', 'short', 'noflaps', 'fog']],
  ['Something broke', ['deadstick', 'nosegear', 'oneengine', 'jammed', 'brakes', 'ice']],
  ['The stall', ['slow', 'stallrec']],
  ['Boat', ['cq', 'night']],
  ['Bush', ['gravel', 'oneway']],
  ['Chaos', ['roulette']],
];

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
function attr(s) { return esc(s).replace(/"/g, '&quot;'); }

// The build stamp: the website copy carries it in <meta name="ctl-build">; the local copy uses the bundle time.
const BUILD_LABEL = (() => {
  try {
    const m = typeof document !== 'undefined' ? document.querySelector('meta[name="ctl-build"]') : null;
    const s = (m && m.content) || (typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '');
    return s ? s.replace('T', ' ').slice(0, 16) + 'Z' : '';
  } catch (e) { return ''; }
})();

export class Menus {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.overlay = document.createElement('div');
    this.overlay.className = 'overlay';
    root.appendChild(this.overlay);
    this.selected = SCENARIOS[0].id;
    this.tab = 'challenges';
  }
  show(html) { this.overlay.innerHTML = html; this.overlay.classList.remove('hidden'); this.game.input.releaseMouse(); }
  hide() { this.overlay.classList.add('hidden'); this.overlay.innerHTML = ''; }
  get visible() { return !this.overlay.classList.contains('hidden'); }
  q(sel) { return this.overlay.querySelector(sel); }
  qa(sel) { return [...this.overlay.querySelectorAll(sel)]; }

  frame(tab, railHtml, sheetHtml) {
    const pad = this.game.input.padConnected;
    const touch = this.game.touchActive;
    const fs = touch && this.game.canFullscreen() ? '<button class="btn small quiet" id="btn-fs">Full screen</button>' : '';
    return `<div class="shell">
      <header class="top">
        <div class="brand">CLEARED TO LAND<small>AIRPLANE LANDING CHALLENGES</small></div>
        <nav class="tabs">
          <button class="tab ${tab === 'challenges' ? 'active' : ''}" data-tab="challenges">Challenges</button>
          <button class="tab ${tab === 'free' ? 'active' : ''}" data-tab="free">Free flight</button>
          <button class="tab ${tab === 'controls' ? 'active' : ''}" data-tab="controls">Controls</button>
          <button class="tab ${tab === 'settings' ? 'active' : ''}" data-tab="settings">Settings</button>
        </nav>
        <div class="topnote">${pad ? 'GAMEPAD CONNECTED' : touch ? 'TOUCH CONTROLS' : 'KEYBOARD · MOUSE YOKE (CLICK THE VIEW) · GAMEPAD'}${BUILD_LABEL ? ' · BUILD ' + BUILD_LABEL : ''}</div>${fs}
      </header>
      <div class="split">
        <aside class="rail">${railHtml}</aside>
        <section class="sheet"><div class="sheet-inner">${sheetHtml}</div></section>
      </div>
    </div>`;
  }
  bindTabs() {
    const fs = this.q('#btn-fs'); if (fs) fs.addEventListener('click', () => this.game.fullscreen());
    this.qa('.tab').forEach((t) => t.addEventListener('click', () => {
      const tab = t.dataset.tab;
      if (tab === 'challenges') this.showMain();
      else if (tab === 'free') this.showFree();
      else if (tab === 'controls') this.showControls();
      else this.showSettings();
    }));
  }

  rail() {
    const best = this.game.best;
    return GROUPS.map(([name, ids]) => `<h4>${name}</h4>` + ids.map((id) => {
      const s = SCENARIOS.find((x) => x.id === id);
      const b = best[s.id];
      const ac = s.aircraft === 'random' ? 'random' : AIRCRAFT[s.aircraft].short;
      return `<button class="row ${this.selected === s.id ? 'active' : ''}" data-id="${s.id}">
        <span class="num">${String(s.n).padStart(2, '0')}</span>
        <span class="ttl">${esc(s.title)}<small>${ac} · ${s.site === 'random' ? 'random field' : SITES[s.site].name}</small></span>
        <span class="best ${b ? '' : 'none'}">${b ? `${b.points} ${b.grade}${b.name ? `<small>${esc(b.name)}</small>` : ''}` : '—'}</span>
      </button>`;
    }).join('')).join('');
  }

  briefing(sc) {
    const ac = sc.aircraft === 'random' ? null : AIRCRAFT[sc.aircraft];
    const site = sc.site === 'random' ? null : SITES[sc.site];
    const wind = sc.wind === 'random' ? 'random' : `${sc.wind.speed}${sc.wind.gust && sc.wind.gust > sc.wind.speed ? `G${sc.wind.gust}` : ''} kt ${sc.wind.rel != null ? (sc.wind.rel === 0 ? 'on the nose' : `${Math.abs(sc.wind.rel)}° ${sc.wind.rel > 0 ? 'right' : 'left'}`) : ''}`;
    const fails = sc.surprise ? 'surprise' : sc.failures.length ? sc.failures.map((f) => FAILURES[f.name]?.name || f.name).join(', ') : 'none';
    const b = this.game.best[sc.id];
    const vis = sc.vis === 'random' ? 'random' : sc.vis >= 10000 ? `${(sc.vis / 1000).toFixed(0)} km` : `${sc.vis} m`;
    const time = sc.time === 'random' ? 'random' : fmtTime(sc.time);
    return `
      <div class="eyebrow">Challenge ${String(sc.n).padStart(2, '0')} · ${ac ? ac.name : 'random aircraft'} · ${site ? site.name : 'random field'}</div>
      <h1>${esc(sc.title)}</h1>
      <p class="lead">${esc(sc.desc)}</p>
      <div class="kneeboard">
        <div><b>Wind</b><span>${wind}</span></div>
        <div><b>Visibility</b><span>${vis}</span></div>
        <div><b>Time</b><span>${time}</span></div>
        <div><b>Weight</b><span>${sc.weight}</span></div>
        <div><b>Vref</b><span>${ac ? (sc.scoring?.vref || ac.speeds.Vref) + ' kt' : '—'}</span></div>
        <div><b>Malfunction</b><span>${fails}</span></div>
      </div>
      <ul class="checklist">${sc.tips.map((t) => `<li>${esc(this.game.touchActive ? touchify(t) : t)}</li>`).join('')}</ul>
      <div class="actions">
        <button class="btn primary" id="btn-fly">Fly</button>
        <span class="bestline">${b ? `BEST <b>${b.points} · ${b.grade}</b>${b.name ? ` · ${esc(b.name)}` : ''}` : 'NOT FLOWN YET'} · start ${({ short: 'short final', medium: 'medium final', long: 'long final' })[this.game.settings.approach] || 'short final'}</span>
      </div>
      ${ac ? `<h2>${ac.name}</h2><p>${esc(ac.description)}</p>` : ''}`;
  }

  showMain() {
    this.tab = 'challenges';
    const sc = SCENARIOS.find((s) => s.id === this.selected) || SCENARIOS[0];
    this.show(this.frame('challenges', this.rail(), this.briefing(sc)));
    this.bindTabs();
    this.qa('.row').forEach((r) => r.addEventListener('click', () => { this.selected = r.dataset.id; this.showMain(); }));
    this.qa('.row').forEach((r) => r.addEventListener('dblclick', () => this.game.startScenario(SCENARIOS.find((s) => s.id === r.dataset.id))));
    this.q('#btn-fly').addEventListener('click', () => this.game.startScenario(sc));
    const active = this.q('.row.active'); if (active) active.scrollIntoView({ block: 'nearest' });
  }
  showBriefing(sc) { this.selected = sc.id; this.showMain(); }

  showDebrief(result, sc, stats) {
    const lines = result.lines.map((l) => `<div><span class="k">${esc(l.k)}</span><span class="v ${l.cls}">${esc(l.v)}</span></div>`).join('');
    const pilot = this.game.pilot || '';
    const b = stats.best;
    const standing = b && !stats.newBest ? `<span class="bestline">BEST <b>${b.points} · ${b.grade}</b>${b.name ? ` · ${esc(b.name)}` : ''}</span>` : '';
    // a new best asks who flew it. The name stays in this browser and is stamped on the next bests by itself; Save keeps a changed one.
    const who = stats.newBest ? `<div class="pilot"><label for="pilot-name">Logbook name</label><input id="pilot-name" type="text" maxlength="16" value="${attr(pilot)}" placeholder="your name" autocomplete="off" autocapitalize="words" spellcheck="false"><button class="btn small" id="btn-pilot">Save</button><span class="note" id="pilot-note">${pilot ? 'This browser remembers it. Change it to log the flight under another name.' : 'Type it once; this browser remembers it for your next best.'}</span></div>` : '';
    this.show(`<div class="shell">
      <header class="top"><div class="brand">CLEARED TO LAND<small>LOGBOOK</small></div><div class="topnote">${esc(sc.title).toUpperCase()}</div></header>
      <div class="split">
        <aside class="rail">${this.rail()}</aside>
        <section class="sheet"><div class="sheet-inner">
          <div class="eyebrow">Debrief · ${esc(sc.title)}</div>
          <div class="stamp g${result.gradeIdx}">${esc(result.grade)}</div>
          <div class="scoreline"><span class="pts">${result.points}<small> / 100</small></span>${stats.newBest ? '<span class="newbest">NEW BEST</span>' : ''}${standing}</div>
          ${who}
          <p class="lead">${esc(result.headline)}</p>
          <div class="ledger">${lines}</div>
          <div class="actions">
            <button class="btn primary" id="btn-retry">Fly again</button>
            ${stats.next ? `<button class="btn" id="btn-next">Next: ${esc(stats.next.title)}</button>` : ''}
            <button class="btn quiet" id="btn-menu">Flight list</button>
          </div>
        </div></section>
      </div></div>`);
    this.q('#btn-retry').addEventListener('click', () => this.game.retry());
    if (stats.next) this.q('#btn-next').addEventListener('click', () => { this.selected = stats.next.id; this.game.toMenu(); });
    this.q('#btn-menu').addEventListener('click', () => this.game.toMenu());
    const bindRows = () => this.qa('.row').forEach((r) => r.addEventListener('click', () => { this.selected = r.dataset.id; this.game.toMenu(); }));
    bindRows();
    if (stats.newBest) {
      const inp = this.q('#pilot-name'), note = this.q('#pilot-note');
      const save = () => {
        const name = this.game.setPilot(inp.value);
        this.game.nameBest(sc.id, name);
        inp.value = name;
        note.textContent = name ? `Saved. ${name} is in the logbook.` : 'Saved without a name.';
        this.q('.rail').innerHTML = this.rail();
        bindRows();
      };
      this.q('#btn-pilot').addEventListener('click', save);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); inp.blur(); } });
      if (!pilot && !this.game.touchActive) inp.focus();
    }
  }

  showPause() {
    this.show(`<div class="pause"><div class="pausebox">
      <h1>PAUSED</h1>
      <div class="actions" style="justify-content:center">
        <button class="btn primary" id="btn-resume">Resume</button>
        <button class="btn" id="btn-restart">Restart</button>
        <button class="btn" id="btn-end">End flight</button>
        <button class="btn quiet" id="btn-controls">Controls</button>
        <button class="btn quiet" id="btn-settings">Settings</button>
        <button class="btn quiet" id="btn-menu">Flight list</button>
      </div></div></div>`);
    this.q('#btn-resume').addEventListener('click', () => this.game.resume());
    this.q('#btn-restart').addEventListener('click', () => this.game.retry());
    this.q('#btn-end').addEventListener('click', () => this.game.endFlight());
    this.q('#btn-controls').addEventListener('click', () => this.showControls(() => this.showPause()));
    this.q('#btn-settings').addEventListener('click', () => this.showSettings(() => this.showPause()));
    this.q('#btn-menu').addEventListener('click', () => this.game.toMenu());
  }

  showControls(back) {
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
      <div class="actions"><button class="btn" id="btn-back">${back ? 'Back' : 'Flight list'}</button></div>
      <div class="credit">Aircraft models from poly.pizza (CC-BY 3.0): Small Airplane by Vojtěch Balák · Airplane 3268 by Remy Tauziac · Biplane and Fighter jet by their authors (see CREDITS.md). Everything else is procedural. Built with three.js.</div>`;
    this.show(back ? `<div class="shell"><div class="split" style="grid-template-columns:1fr"><section class="sheet"><div class="sheet-inner">${sheet}</div></section></div></div>` : this.frame('controls', this.rail(), sheet));
    if (!back) { this.bindTabs(); this.qa('.row').forEach((r) => r.addEventListener('click', () => { this.selected = r.dataset.id; this.showMain(); })); }
    this.q('#btn-back').addEventListener('click', () => (back ? back() : this.showMain()));
  }

  showSettings(back) {
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
      <div class="actions"><button class="btn primary" id="btn-back">Done</button></div>`;
    this.show(back ? `<div class="shell"><div class="split" style="grid-template-columns:1fr"><section class="sheet"><div class="sheet-inner">${sheet}</div></section></div></div>` : this.frame('settings', this.rail(), sheet));
    if (!back) { this.bindTabs(); this.qa('.row').forEach((r) => r.addEventListener('click', () => { this.selected = r.dataset.id; this.showMain(); })); }
    this.q('#s-quality').value = s.quality;
    this.q('#s-cam').value = s.camera;
    this.q('#s-approach').value = s.approach || 'short';
    this.q('#s-control').value = s.controlMode || 'assist';
    this.q('#s-touch').value = s.touch || 'auto';
    this.q('#s-stick').value = s.stickSide || 'right';
    const live = (id, fmt) => { const i = this.q('#' + id), v = this.q('#' + id + '-v'); if (v) i.addEventListener('input', () => (v.textContent = fmt(+i.value))); };
    live('s-msens', (x) => x.toFixed(2)); live('s-sens', (x) => x.toFixed(1)); live('s-vol', (x) => Math.round(x * 100) + '%');
    const save = () => {
      s.quality = this.q('#s-quality').value; s.sensitivity = +this.q('#s-sens').value; s.mouseSens = +this.q('#s-msens').value; s.volume = +this.q('#s-vol').value;
      s.voice = this.q('#s-voice').checked; s.hints = this.q('#s-hints').checked; s.invert = this.q('#s-invert').checked; s.camera = this.q('#s-cam').value;
      s.approach = this.q('#s-approach').value; s.autoTrim = this.q('#s-autotrim').checked; s.keyStrip = this.q('#s-keystrip').checked; s.controlMode = this.q('#s-control').value;
      s.touch = this.q('#s-touch').value; s.autoQuality = this.q('#s-autoq').checked; s.tilt = this.q('#s-tilt').checked; s.stickSide = this.q('#s-stick').value;
      this.game.setPilot(this.q('#s-pilot').value);
      this.game.applySettings();
    };
    this.qa('select, input').forEach((i) => i.addEventListener('change', save));
    this.q('#btn-back').addEventListener('click', () => { save(); back ? back() : this.showMain(); });
  }

  showFree() {
    const f = this.game.freeOpts;
    const acOpts = AIRCRAFT_LIST.map((a) => `<option value="${a.id}">${a.name} — ${a.category}</option>`).join('');
    const siteOpts = Object.values(SITES).map((s) => `<option value="${s.id}">${s.name} (${s.kind})</option>`).join('');
    const failOpts = Object.entries(FAILURES).map(([k, v]) => `<label><input type="checkbox" class="f-fail" value="${k}" ${f.failures.includes(k) ? 'checked' : ''}> ${v.name}</label>`).join('');
    const sheet = `
      <div class="eyebrow">Free flight</div>
      <h1>Your conditions</h1>
      <div class="form">
        <label class="field"><span>Aircraft</span><select id="f-ac">${acOpts}</select></label>
        <label class="field"><span>Field</span><select id="f-site">${siteOpts}</select></label>
        <label class="field"><span>Wind from</span><input type="range" id="f-wdir" min="0" max="359" step="5" value="${f.windDir}"><span class="v" id="f-wdir-v">${f.windDir}°</span></label>
        <label class="field"><span>Wind speed</span><input type="range" id="f-wspd" min="0" max="40" step="1" value="${f.windSpeed}"><span class="v" id="f-wspd-v">${f.windSpeed} kt</span></label>
        <label class="field"><span>Gusts to</span><input type="range" id="f-wgst" min="0" max="55" step="1" value="${f.windGust}"><span class="v" id="f-wgst-v">${f.windGust} kt</span></label>
        <label class="field"><span>Turbulence</span><input type="range" id="f-turb" min="0" max="1" step="0.05" value="${f.turb}"><span class="v" id="f-turb-v">${f.turb}</span></label>
        <label class="field"><span>Time of day</span><input type="range" id="f-time" min="5" max="23.5" step="0.5" value="${f.time}"><span class="v" id="f-time-v">${fmtTime(f.time)}</span></label>
        <label class="field"><span>Visibility</span><input type="range" id="f-vis" min="400" max="40000" step="200" value="${f.vis}"><span class="v" id="f-vis-v">${f.vis} m</span></label>
        <label class="field"><span>Sea state (carrier)</span><input type="range" id="f-sea" min="0" max="1" step="0.05" value="${f.seaState}"><span class="v" id="f-sea-v">${f.seaState}</span></label>
        <label class="field"><span>Weight</span><select id="f-weight"><option value="light">Light</option><option value="normal">Normal</option><option value="heavy">Heavy</option></select></label>
        <label class="field"><span>Start distance</span><input type="range" id="f-dist" min="600" max="12000" step="100" value="${f.dist}"><span class="v" id="f-dist-v">${f.dist} m</span></label>
        <div class="field full"><span>Malfunctions (at a random moment on the approach)</span><div class="checks">${failOpts}</div></div>
      </div>
      <div class="actions"><button class="btn primary" id="btn-fly">Fly</button></div>`;
    this.show(this.frame('free', this.rail(), sheet));
    this.bindTabs();
    this.qa('.row').forEach((r) => r.addEventListener('click', () => { this.selected = r.dataset.id; this.showMain(); }));
    this.q('#f-ac').value = f.aircraft; this.q('#f-site').value = f.site; this.q('#f-weight').value = f.weight;
    const bind = (id, fmt) => { const i = this.q('#' + id), v = this.q('#' + id + '-v'); if (v) i.addEventListener('input', () => (v.textContent = fmt(+i.value))); };
    bind('f-wdir', (x) => x + '°'); bind('f-wspd', (x) => x + ' kt'); bind('f-wgst', (x) => x + ' kt'); bind('f-turb', (x) => x); bind('f-vis', (x) => x + ' m'); bind('f-sea', (x) => x); bind('f-dist', (x) => x + ' m');
    bind('f-time', fmtTime);
    const read = () => {
      f.aircraft = this.q('#f-ac').value; f.site = this.q('#f-site').value; f.windDir = +this.q('#f-wdir').value; f.windSpeed = +this.q('#f-wspd').value;
      f.windGust = +this.q('#f-wgst').value; f.turb = +this.q('#f-turb').value; f.time = +this.q('#f-time').value; f.vis = +this.q('#f-vis').value; f.seaState = +this.q('#f-sea').value;
      f.weight = this.q('#f-weight').value; f.dist = +this.q('#f-dist').value; f.failures = this.qa('.f-fail:checked').map((c) => c.value);
    };
    this.qa('select, input').forEach((i) => i.addEventListener('change', read));
    this.q('#btn-fly').addEventListener('click', () => { read(); this.game.startFree(); });
  }
}

export function fmtTime(t) { const h = Math.floor(t), m = Math.round((t - h) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }
