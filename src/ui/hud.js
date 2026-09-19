// Head-up display: tapes, attitude/flight-path indicator, AoA, engine, config, wind, ILS, meatball, messages.
//
// Failures (2026-09-17, src/systems/failureEffects.js) reach the HUD through two fields of the context:
//   ctx.sensed   what an instrument reads when it is lying (sensed.ias, m/s: an iced pitot); null = honest
//   ctx.display  what has failed, one object refilled by the failure runtime; null until something fails:
//     dark         the electrics are dead: every instrument goes (the ILS and the ball too, the status line with its
//                  distance, the radio altimeter's callouts), a torch-lit standby airspeed and altimeter stay
//     noBall       the carrier's lens is dark: no ball on the HUD either
//     caution      { level: 'caution'|'warning', text, blink }: the master caution (amber) or warning (red) light
//     annun        [{ text, cls }]: annunciators under it (L ENG FIRE, STAB TRIM, IAS DISAGREE)
//     cfg          [{ text, cls }]: extra lines in the config box (THR JAMMED 75%, TRIM MAN ND 1.2)
//     engNote[i]   'FIRE' / 'SURGE' in place of engine i's reading; engOff[i] says OFF rather than FAIL
//     iasFlag      a red IAS flag on the airspeed tape (the jet's two airspeeds disagree)
// setExtraKeys() adds the failure drills (fire handle, trim cutout, fuel cutoff) to the key strip while they apply.
import { KT, FT, FPM, DEG, RAD, clamp, wrap360 } from '../config.js';
import { touchify } from '../touch.js';

function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

// Performance (docs/PERF.md): every DOM write is a mutation even when the value is the same
// string, and one mutation per frame is one style recalc and one layout per frame - a couple of
// milliseconds on a phone. So nothing below touches the DOM unless the value changed, the moving
// parts move with transforms (no layout), and the numeric readouts refresh at 20 Hz.
const setText = (e, s) => { if (e.__t !== s) { e.__t = s; e.textContent = s; } };
const setHTML = (e, h) => { if (e.__h !== h) { e.__h = h; e.innerHTML = h; } };
const setStyle = (e, prop, v) => { const s = e.__s || (e.__s = {}); if (s[prop] !== v) { s[prop] = v; e.style[prop] = v; } };
const TEXT_PERIOD = 0.05;
const FMT_POS = { f: (v, big) => (big ? Math.round(v) : v), neg: false };
const FMT_NEG = { f: (v, big) => (big ? Math.round(v) : v), neg: true };

export class HUD {
  constructor(root) {
    this.root = el('div');
    this.root.id = 'hud';
    root.appendChild(this.root);
    const h = this.root;
    this.asi = this.tape('asi', 'IAS KT', 14);
    this.alt = this.tape('alt', 'ALT FT', 14);
    this.vsi = el('div', 'hud-box tape'); this.vsi.id = 'vsi';
    this.vsi.innerHTML = '<div class="label">V/S</div><div class="value" id="vsiv">0</div>';
    h.appendChild(this.vsi);
    this.hdg = el('div', 'hud-box tape'); this.hdg.id = 'hdg';
    this.hdg.innerHTML = '<div class="ticks" id="hdgticks"></div><div class="value" id="hdgv">000</div>';
    h.appendChild(this.hdg);
    this.hdgTicks = [];
    for (let i = 0; i < 12; i++) { const t = el('div', 'tick'); t.style.borderTop = 'none'; t.style.borderLeft = '1px solid rgba(159,247,200,0.35)'; t.style.top = '0'; t.style.left = '0'; t.style.height = '14px'; t.style.width = '30px'; t.style.paddingLeft = '3px'; this.hdg.firstChild.appendChild(t); this.hdgTicks.push(t); }
    this.hdgBug = el('div', 'bug'); this.hdgBug.style.top = '2px'; this.hdgBug.style.left = '0'; this.hdgBug.style.height = '8px'; this.hdgBug.style.width = '10px'; this.hdgBug.style.transform = 'translateX(-50%)'; this.hdg.appendChild(this.hdgBug);
    this.hdgV = this.hdg.querySelector('#hdgv');
    this.vsiV = this.vsi.querySelector('#vsiv');
    // ADI canvas
    this.adi = el('div'); this.adi.id = 'adi';
    this.adiCanvas = document.createElement('canvas'); this.adiCanvas.width = 520; this.adiCanvas.height = 520;
    this.adi.appendChild(this.adiCanvas); h.appendChild(this.adi);
    this.adiCtx = this.adiCanvas.getContext('2d');
    // AoA
    this.aoa = el('div', 'hud-box'); this.aoa.id = 'aoa';
    this.aoa.innerHTML = '<div class="label" style="position:absolute;top:4px;left:0;right:0;text-align:center;font-size:11px;color:var(--hud-dim);letter-spacing:0.1em">AOA</div><div class="bar"><div class="fill" id="aoafill"></div><div class="mark" id="aoastall">STALL</div><div class="mark" id="aoaon" style="border-color:#6ee7a8;color:#6ee7a8">ON SPD</div></div><div class="num" id="aoanum">0.0°</div>';
    h.appendChild(this.aoa);
    this.aoaFill = this.aoa.querySelector('#aoafill'); this.aoaStall = this.aoa.querySelector('#aoastall'); this.aoaOn = this.aoa.querySelector('#aoaon'); this.aoaNum = this.aoa.querySelector('#aoanum');
    this.textT = 1;   // readouts refresh every TEXT_PERIOD; starts due
    // engine
    this.eng = el('div', 'hud-box'); this.eng.id = 'eng';
    h.appendChild(this.eng);
    // config
    this.cfg = el('div', 'hud-box'); this.cfg.id = 'cfg'; h.appendChild(this.cfg);
    // wind
    this.wind = el('div', 'hud-box'); this.wind.id = 'wind';
    this.wind.innerHTML = '<svg class="arrow" viewBox="-25 -25 50 50"><g id="windarrow"><path d="M0,-20 L7,-6 L2,-6 L2,18 L-2,18 L-2,-6 L-7,-6 Z" fill="#9ff7c8"/></g><circle cx="0" cy="0" r="22" fill="none" stroke="rgba(159,247,200,0.3)"/></svg><div class="txt" id="windtxt"></div>';
    h.appendChild(this.wind);
    this.windArrow = this.wind.querySelector('#windarrow');
    this.windTxt = this.wind.querySelector('#windtxt');
    // g meter + status
    this.gm = el('div', 'hud-box'); this.gm.id = 'gmeter'; h.appendChild(this.gm);
    this.timer = el('div'); this.timer.id = 'timer'; h.appendChild(this.timer);
    // ILS
    this.gs = el('div'); this.gs.id = 'gs';
    this.gs.innerHTML = '<div class="scale"></div>' + [0.1, 0.3, 0.5, 0.7, 0.9].map((p) => `<div class="dot" style="top:${p * 100}%"></div>`).join('') + '<div class="needle" id="gsn"></div>';
    h.appendChild(this.gs);
    this.loc = el('div'); this.loc.id = 'loc';
    this.loc.innerHTML = '<div class="scale"></div>' + [0.1, 0.3, 0.5, 0.7, 0.9].map((p) => `<div class="dot" style="left:${p * 100}%"></div>`).join('') + '<div class="needle" id="locn"></div>';
    h.appendChild(this.loc);
    this.gsN = this.gs.querySelector('#gsn'); this.locN = this.loc.querySelector('#locn');
    // meatball
    this.ball = el('div'); this.ball.id = 'ball';
    this.ball.innerHTML = '<div class="datum l"></div><div class="datum r"></div><div class="cell" id="ballcell"></div><div class="wo"></div>';
    h.appendChild(this.ball);
    this.ballCell = this.ball.querySelector('#ballcell');
    // messages
    this.msg = el('div'); this.msg.id = 'msg'; h.appendChild(this.msg);
    this.stall = el('div'); this.stall.id = 'stall'; this.stall.textContent = 'STALL'; h.appendChild(this.stall);
    this.hint = el('div'); this.hint.id = 'hint'; h.appendChild(this.hint);
    this.calls = el('div'); this.calls.id = 'calls'; h.appendChild(this.calls);
    this.fails = el('div'); this.fails.id = 'failures'; h.appendChild(this.fails);
    this.msgT = 0; this.callT = 0;
    this.showHints = true;
    this.lastHint = '';
    // controls strip
    this.keysEl = el('div'); this.keysEl.id = 'keys'; h.appendChild(this.keysEl);
    this.keyStrip = true;
    this.keyItems = [];
    this.keyMode = '';
    // compact geometry (touch / small screens): setTape and the heading tape read these; see setCompact()
    this.tapeH = 210; this.hdgW = 300; this.compact = false; this.touch = false; this.adiShadow = true;
    this._engHtml = ''; this._cfgHtml = ''; this._gmHtml = ''; this._windHtml = '';
    // ---- failures (see the header) ----
    this.extraKeys = [];
    this.iasFlag = el('div', 'flag', 'IAS'); this.asi.box.appendChild(this.iasFlag);
    // the master caution / warning light and its annunciators, top left of centre
    this.mc = el('div'); this.mc.id = 'mc';
    this.mc.innerHTML = '<div class="light" id="mclight"></div><div class="annun" id="annun"></div>';
    h.appendChild(this.mc);
    this.mcLight = this.mc.querySelector('#mclight'); this.annun = this.mc.querySelector('#annun');
    this._mc = 0;
    // the standby airspeed and altimeter, lit by a torch, for when the electrics die (drawn at the readout rate)
    this.stby = el('div'); this.stby.id = 'stby';
    this.stbyCanvas = document.createElement('canvas'); this.stbyCanvas.width = 400; this.stbyCanvas.height = 200;
    this.stby.appendChild(this.stbyCanvas); h.appendChild(this.stby);
    this.stbyCtx = this.stbyCanvas.getContext('2d');
    this._dark = false;
    // (a cracked windshield is not the HUD's: src/cockpit.js lays it on the cockpit's own glass)
  }

  // The failure drills on the key strip while they apply: [[label, [[keycap, action]]], ...] (failureEffects.js).
  setExtraKeys(list) { this.extraKeys = list || []; this.keyMode = ''; }
  // A new flight: nothing has failed, before its first frame (a dark HUD left from the last flight would otherwise
  // swallow the new one's first callout). failureEffects.js calls it from its constructor.
  clearFailureDisplay() { this.failures(null, null, 0, 0, true); }

  // Touch / small-screen layout: smaller tapes and ADI, the side columns kept clear for the thumbs (style.css #hud.compact).
  setCompact(on) {
    const narrow = on && window.innerWidth < 720;
    this.compact = on;
    this.root.classList.toggle('compact', on);
    this.root.classList.toggle('narrow', narrow);
    this.tapeH = on ? 130 : 210;
    this.hdgW = on ? (narrow ? 180 : 220) : 300;
    this.adiShadow = !on;
  }

  // Build the strip for the aircraft and phase; each item: [label, [[keycap, action], ...]]
  buildKeys(def, mode) {
    const items = [
      ['pitch', [['↓', 'pitchUp'], ['↑', 'pitchDown']]],
      ['roll', [['←', 'rollLeft'], ['→', 'rollRight']]],
      [mode === 'ground' ? 'steer' : 'rudder', [['Q', 'yawLeft'], ['E', 'yawRight']]],
      ['throttle', [['W', 'thrUp'], ['S', 'thrDown']]],
    ];
    if (mode === 'ground') {
      items.push(['brakes', [['SPACE', 'brake']]]);
      if (def.engines[0].reverse) items.push(['reverse', [['R', 'reverse']]]);
    } else {
      items.push(['flaps', [['F', 'flapsDown'], ['V', 'flapsUp']]]);
      if (def.gearRetract) items.push(['gear', [['G', 'gear']]]);
      if (def.hook) items.push(['hook', [['H', 'hook']]]);
      if (def.spoilers) items.push(['spoilers', [['K', 'spoiler']]]);
      if (def.autobrake) items.push(['autobrake', [['L', 'autobrake']]]);
      items.push(['trim', [['T', 'trimUp'], ['Y', 'trimDown']]]);
    }
    const hot = items.length;
    for (const x of this.extraKeys) items.push(x);   // the failure drills, in both phases (fuel cutoff is a ground drill too)
    items.push(['camera', [['1–5', 'camNext']]]);
    items.push(['orbit', [[',', 'orbitLeft'], ['.', 'orbitRight']]]);
    items.push(['pause', [['P', 'pause']]]);
    this.keysEl.innerHTML = items.map(([label, caps], i) => `<span class="k${i >= hot && i < hot + this.extraKeys.length ? ' hot' : ''}">${caps.map(([c, a]) => `<kbd data-a="${a}">${c}</kbd>`).join('')}<span>${label}</span></span>`).join('');
    this.keyItems = [...this.keysEl.querySelectorAll('kbd')];
    this.keyMode = mode;
  }

  tape(id, label, nTicks) {
    const t = el('div', 'hud-box tape'); t.id = id;
    const ticks = el('div', 'ticks');
    const arr = [];
    for (let i = 0; i < nTicks; i++) { const k = el('div', 'tick'); k.style.top = '0'; ticks.appendChild(k); arr.push(k); }
    t.appendChild(ticks);
    t.appendChild(el('div', 'label', label));
    const v = el('div', 'value', '0'); t.appendChild(v);
    const bug = el('div', 'bug'); bug.style.top = '0'; t.appendChild(bug);
    const bug2 = el('div', 'bug'); bug2.style.top = '0'; bug2.style.background = '#ff5c5c'; t.appendChild(bug2);
    this.root.appendChild(t);
    return { box: t, ticks: arr, value: v, bug, bug2 };
  }

  // Ticks and bugs move with a transform (rounded to the pixel, as layout would have placed
  // them) so a scrolling tape never lays the HUD out; the value box refreshes with the readouts.
  setTape(t, val, step, pxPer, fmt, bugVal, bug2Val, textDue) {
    const H = this.tapeH, mid = H / 2;
    const first = Math.floor((val - mid / pxPer) / step) * step;
    for (let i = 0; i < t.ticks.length; i++) {
      const v = first + i * step;
      const y = mid - (v - val) * pxPer;
      const k = t.ticks[i];
      if (y < -8 || y > H + 8 || (v < 0 && !fmt.neg)) { setStyle(k, 'display', 'none'); continue; }
      setStyle(k, 'display', 'block');
      setStyle(k, 'transform', 'translateY(' + Math.round(y) + 'px)');
      setText(k, String(fmt.f(v)));
    }
    if (textDue) setText(t.value, String(fmt.f(val, true)));
    if (bugVal != null) { const y = mid - (bugVal - val) * pxPer; setStyle(t.bug, 'display', y > 0 && y < H ? 'block' : 'none'); setStyle(t.bug, 'transform', 'translateY(' + Math.round(y) + 'px) translateY(-50%)'); } else setStyle(t.bug, 'display', 'none');
    if (bug2Val != null) { const y = mid - (bug2Val - val) * pxPer; setStyle(t.bug2, 'display', y > 0 && y < H ? 'block' : 'none'); setStyle(t.bug2, 'transform', 'translateY(' + Math.round(y) + 'px) translateY(-50%)'); } else setStyle(t.bug2, 'display', 'none');
  }

  message(text, cls = '', dur = 3) { this.msg.textContent = text; this.msg.className = cls; this.msgT = dur; }
  // `advice`: a hint rather than an instrument's call. With the electrics dead (the HUD dark) only advice shows: the
  // radio altimeter's "50", "20" are an instrument, and it has no power.
  callout(text, dur = 1.2, advice = false) { if (this._dark && !advice) return; this.calls.textContent = text; this.calls.classList.add('on'); this.callT = dur; }
  setHint(text) { if (!this.showHints) { this.hint.textContent = ''; return; } if (text !== this.lastHint) { this.hint.textContent = (this.touch ? touchify(text) : text) || ''; this.lastHint = text; } }
  setFailures(list) { this.fails.innerHTML = list.map((f) => `<span class="f">${f}</span>`).join(''); }
  set visible(v) { this.root.classList.toggle('hidden', !v); }
  get visible() { return !this.root.classList.contains('hidden'); }

  update(ac, ctx, dt) {
    const def = ac.def;
    this.textT += dt;
    const textDue = this.textT >= TEXT_PERIOD;
    if (textDue) this.textT = 0;
    const fd = ctx.display || null, sensed = ctx.sensed || null;
    // an iced pitot: the tape shows what the instrument says, not what the airplane is doing
    const ias = (sensed && sensed.ias != null ? sensed.ias : ac.ias) / KT, alt = ac.alt / FT, vs = ac.vs / FPM;
    this.failures(ac, fd, ias, alt, textDue);
    const vsBug = def.speeds.Vs0 * Math.sqrt(ac.mass / def.mass) * (ac.ice ? 1.15 : 1) * (ac.ctl.flap < 0.5 ? def.speeds.Vs1 / def.speeds.Vs0 : 1);
    this.setTape(this.asi, ias, 10, 1.75, FMT_POS, ctx.vref || def.speeds.Vref, vsBug, textDue);
    this.setTape(this.alt, alt, 100, 0.21, FMT_NEG, null, null, textDue);
    if (textDue) {
      setText(this.vsiV, (vs > 0 ? '+' : '') + Math.round(vs / 10) * 10);
      setStyle(this.vsiV, 'color', vs < -1000 ? 'var(--bad)' : vs < -700 ? 'var(--warn)' : '');
    }
    // heading tape
    const hdg = ac.headingDeg;
    const W = this.hdgW, pxPerDeg = 3.6 * W / 300;
    const first = Math.floor((hdg - 40) / 10) * 10;
    for (let i = 0; i < this.hdgTicks.length; i++) {
      const v = first + i * 10;
      const x = W / 2 + (v - hdg) * pxPerDeg;
      const t = this.hdgTicks[i];
      if (x < 0 || x > W) { setStyle(t, 'display', 'none'); continue; }
      setStyle(t, 'display', 'block'); setStyle(t, 'transform', 'translateX(' + Math.round(x) + 'px)');
      const d = wrap360(v);
      setText(t, d === 0 ? 'N' : d === 90 ? 'E' : d === 180 ? 'S' : d === 270 ? 'W' : String(d / 10));
    }
    if (textDue) setText(this.hdgV, String(Math.round(hdg) % 360).padStart(3, '0'));
    if (ctx.runwayHeading != null) {
      let d = ((ctx.runwayHeading * RAD - hdg + 540) % 360) - 180;
      const x = W / 2 + d * pxPerDeg;
      setStyle(this.hdgBug, 'display', x > 0 && x < W ? 'block' : 'none');
      setStyle(this.hdgBug, 'transform', 'translateX(' + Math.round(x) + 'px) translateX(-50%)');
    } else setStyle(this.hdgBug, 'display', 'none');
    // AoA
    const a = ac.aero.alpha * RAD, aS = ac.aero.alphaStall * RAD;
    const top = aS + 5;
    setStyle(this.aoaFill, 'height', (clamp(a / top, 0, 1) * 100).toFixed(1) + '%');
    setStyle(this.aoaStall, 'bottom', (clamp(aS / top, 0, 1) * 100).toFixed(1) + '%');
    if (def.approach.onSpeedAoA) { setStyle(this.aoaOn, 'display', 'block'); setStyle(this.aoaOn, 'bottom', (clamp(def.approach.onSpeedAoA * RAD / top, 0, 1) * 100).toFixed(1) + '%'); } else setStyle(this.aoaOn, 'display', 'none');
    if (textDue) { setText(this.aoaNum, a.toFixed(1) + '°'); setStyle(this.aoaNum, 'color', ac.aero.warning ? 'var(--bad)' : ''); }
    this.aoa.classList.toggle('needed', !!def.approach.onSpeedAoA);   // narrow phones keep the AoA box only where it matters (the Hornet)
    const c = ac.ctl, inp = ac.input;
    const ra = ac.radioAlt / FT;
    if (textDue) {
      // engine
      const eng = ac.engines;
      const rows = [];
      const thr = ac.input.throttle;
      rows.push(`<div class="row"><span class="k">THR</span><div class="bar"><i style="width:${(thr * 100).toFixed(0)}%"></i></div><span class="v">${(thr * 100).toFixed(0)}%</span></div>`);
      eng.forEach((e, i) => {
        const pct = e.type === 'jet' ? e.rpm * 100 : e.rpm * 2700 / 27;
        const rev = e.thrust < -100;
        // a failure's word for this engine (FIRE, SURGE), or OFF for one shut down on purpose (handle, fuel cutoff)
        const note = fd ? fd.engNote[i] : '', off = !!(fd && fd.engOff[i]);
        const val = note || (off ? 'OFF' : e.failed ? 'FAIL' : rev ? 'REV' : e.type === 'jet' ? pct.toFixed(0) + '%' : (e.rpm * 2700).toFixed(0));
        const col = note === 'FIRE' || (e.failed && !off) ? 'color:var(--bad)' : note || off ? 'color:var(--warn)' : '';
        rows.push(`<div class="row${note === 'FIRE' ? ' fire' : ''}"><span class="k">${e.type === 'jet' ? 'N1' : 'RPM'}${eng.length > 1 ? ' ' + (i + 1) : ''}</span><div class="bar"><i class="${rev ? 'rev' : ''}" style="width:${clamp(pct, 0, 100).toFixed(0)}%"></i></div><span class="v" style="${col}">${val}</span></div>`);
      });
      setHTML(this.eng, rows.join(''));   // only touch the DOM when the text changes (phones)
      // config
      const flapIdx = def.flaps.detents.findIndex((d) => Math.abs(d - inp.flapCmd) < 0.01);
      const flapLbl = def.flaps.labels[flapIdx] ?? Math.round(inp.flapCmd * def.flaps.maxDeg);
      const moving = (x, y) => Math.abs(x - y) > 0.02;
      const items = [];
      items.push(`<div class="item ${moving(c.flap, inp.flapCmd) ? 'moving' : c.flap > 0 ? 'on' : 'off'}">FLAPS ${flapLbl}${moving(c.flap, inp.flapCmd) ? ' ▸' : ''}</div>`);
      if (def.gearRetract) items.push(`<div class="item ${moving(c.gear, inp.gearCmd ? 1 : 0) ? 'moving' : c.gear > 0.99 ? 'on' : 'off'}">GEAR ${moving(c.gear, inp.gearCmd ? 1 : 0) ? 'TRANSIT' : c.gear > 0.99 ? 'DOWN' : 'UP'}</div>`);
      if (def.hook) items.push(`<div class="item ${c.hook > 0.9 ? 'on' : 'off'}">HOOK ${c.hook > 0.9 ? 'DOWN' : c.hook > 0.05 ? '…' : 'UP'}</div>`);
      if (def.spoilers) items.push(`<div class="item ${c.spoiler > 0.5 ? 'on' : inp.spoilerArmed ? 'moving' : 'off'}">SPLR ${c.spoiler > 0.5 ? 'UP' : inp.spoilerArmed ? 'ARMED' : 'DOWN'}</div>`);
      if (def.autobrake) items.push(`<div class="item ${inp.autobrake ? 'on' : 'off'}">AUTOBRK ${inp.autobrake ? (inp.autobrake >= 0.6 ? 'MAX' : 'MED') : 'OFF'}</div>`);
      items.push(`<div class="item ${inp.brake > 0.05 ? 'on' : 'off'}">BRAKES ${inp.brake > 0.05 ? Math.round(inp.brake * 100) + '%' : 'OFF'}</div>`);
      items.push(`<div class="item ${Math.abs(inp.trim) > 0.02 ? 'on' : 'off'}">TRIM ${inp.trim > 0 ? 'NU' : 'ND'} ${Math.abs(inp.trim * 10).toFixed(1)}</div>`);
      if (ac.trap.trapped) items.push(`<div class="item on">TRAPPED ${ac.trap.wire}-WIRE</div>`);
      if (fd) for (const x of fd.cfg) items.push(`<div class="item ${x.cls}">${x.text}</div>`);   // THR JAMMED, TRIM MAN, GEAR UNSAFE
      setHTML(this.cfg, items.join(''));
      // wind
      if (ctx.wind) {
        const { spd, dir } = ctx.wind.surface(ctx.t);
        const rel = dir - hdg; // wind FROM relative to nose; arrow points where it blows (dir+180)
        const rot = 'rotate(' + (rel + 180).toFixed(1) + ')';
        if (this._windRot !== rot) { this._windRot = rot; this.windArrow.setAttribute('transform', rot); }
        const cross = spd * Math.sin(rel * DEG);
        const head = spd * Math.cos(rel * DEG);
        setHTML(this.windTxt, `${String(Math.round(wrap360(dir))).padStart(3, '0')}° / ${spd.toFixed(0)}<br>X ${Math.abs(cross).toFixed(0)}${cross > 0.5 ? 'R' : cross < -0.5 ? 'L' : ''}  ${head >= 0 ? 'H' : 'T'} ${Math.abs(head).toFixed(0)}`);
      }
      // g meter & status
      setHTML(this.gm, `<div class="g">${ac.gload.toFixed(1)} G</div><div>GS ${(ac.gs / KT).toFixed(0)} kt</div>${ra < 2500 ? `<div style="color:${ra < 100 ? '#fff' : ''}">RA ${Math.max(0, ra).toFixed(0)} ft</div>` : ''}`);
      setText(this.timer, ctx.status || '');
    }
    // ILS / meatball
    if (ctx.ils && ctx.ils.dist > 0 && !this._dark) {
      setStyle(this.gs, 'display', 'block'); setStyle(this.loc, 'display', 'block');
      setStyle(this.gsN, 'top', (50 - ctx.ils.gsDots * 9).toFixed(2) + '%');
      setStyle(this.locN, 'left', (50 + ctx.ils.locDots * 9).toFixed(2) + '%');
    } else { setStyle(this.gs, 'display', 'none'); setStyle(this.loc, 'display', 'none'); }
    if (ctx.meatball && ctx.meatball.inRange && !(fd && (fd.noBall || fd.dark))) {
      this.ball.classList.add('on');
      setStyle(this.ballCell, 'top', (50 - ctx.meatball.cells * 7).toFixed(2) + '%');
      this.ballCell.classList.toggle('red', ctx.meatball.cells < -2);
      this.ball.classList.toggle('waveoff', !!ctx.meatball.waveoff);
    } else this.ball.classList.remove('on');
    // stall
    this.stall.classList.toggle('on', !!ac.aero.warning && !ac.onGround);
    setText(this.stall, ac.aero.stall > 0.4 ? 'STALL' : def.engines[0].type === 'jet' && def.id === 'condor' ? 'STICK SHAKER' : 'STALL WARNING');
    // controls strip
    this.keysEl.classList.toggle('hidden', !this.keyStrip);
    if (this.keyStrip) {
      const mode = ac.wheelsOnGround ? 'ground' : 'air';
      if (mode !== this.keyMode || this.keyDef !== def) { this.keyDef = def; this.buildKeys(def, mode); }
      const keys = ctx.keys;
      const inp = ctx.input;
      for (const k of this.keyItems) {
        const a = k.dataset.a;
        let on = keys ? keys.has(a) : false;
        if (inp) {
          if (a === 'brake' && inp.brake > 0.05) on = true;
          if (a === 'pitchUp' && inp.pitch > 0.15) on = true; if (a === 'pitchDown' && inp.pitch < -0.15) on = true;
          if (a === 'rollRight' && inp.roll > 0.15) on = true; if (a === 'rollLeft' && inp.roll < -0.15) on = true;
        }
        k.classList.toggle('on', on);
      }
    }
    // messages
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) this.msg.textContent = ''; }
    if (this.callT > 0) { this.callT -= dt; if (this.callT <= 0) this.calls.classList.remove('on'); }
    if (!this._dark) this.drawADI(ac, ctx);   // (the attitude display is dark with the electrics)
  }

  // What has failed (see the header): the caution light and its annunciators, the flag on a lying airspeed tape, the
  // dark HUD with its standby instruments. DOM writes only on change.
  failures(ac, fd, ias, alt, textDue) {
    const dark = !!(fd && fd.dark);
    if (dark !== this._dark) { this._dark = dark; this.root.classList.toggle('dark', dark); }
    setStyle(this.iasFlag, 'display', fd && fd.iasFlag && !dark ? 'block' : 'none');
    // the master caution: flashing while its blink runs, then steady until the annunciators have all gone out.
    // As a number (0 off, 1 caution, 2 warning; +2 blinking), so a frame makes no string; the DOM changes with it.
    let mc = 0;
    if (fd) {
      const c = fd.caution, lit = c.blink > 0 || fd.annun.length;
      if (c.level && lit) mc = (c.level === 'warning' ? 2 : 1) + (c.blink > 0 ? 2 : 0);
    }
    if (mc !== this._mc) {
      this._mc = mc;
      const warn = mc === 2 || mc === 4;
      this.mcLight.className = mc ? `light ${warn ? 'warning' : 'caution'}${mc > 2 ? ' blink' : ''}` : 'light';
      setHTML(this.mcLight, mc ? `<span class="m">MASTER</span><span>${warn ? 'WARNING' : 'CAUTION'}</span>` : '');   // (a phone shows the second word only)
    }
    if (textDue) setHTML(this.annun, fd ? fd.annun.map((a) => `<span class="${a.cls}">${a.text}</span>`).join('') : '');
    if (dark && textDue) this.drawStandby(ac, ias, alt);
  }

  // The standby airspeed indicator and altimeter (a torch on two round steam gauges): what is left when the electrics
  // die. Canvas 2D, redrawn at the readout rate.
  drawStandby(ac, ias, alt) {
    const g = this.stbyCtx, def = ac.def, W = 400, H = 200, R = 84;
    g.clearRect(0, 0, W, H);
    const top = Math.max(def.speeds.Vne || 160, 100);
    const torch = this._torch || (this._torch = [100, 300].map((cx) => {
      // the torch: a warm pool of light that falls off toward the rim (made once)
      const lg = g.createRadialGradient(cx - 18, 82, 8, cx, 100, R + 14);
      lg.addColorStop(0, 'rgba(255,236,196,0.30)'); lg.addColorStop(0.7, 'rgba(255,220,170,0.12)'); lg.addColorStop(1, 'rgba(255,220,170,0)');
      return lg;
    }));
    const dial = (cx, draw) => {
      g.fillStyle = torch[cx < 200 ? 0 : 1]; g.beginPath(); g.arc(cx, 100, R + 14, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(14,14,13,0.92)'; g.beginPath(); g.arc(cx, 100, R, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(190,180,160,0.55)'; g.lineWidth = 3; g.stroke();
      g.save(); g.translate(cx, 100); draw(); g.restore();
    };
    const face = 'rgba(236,228,210,0.92)';
    // airspeed: 0 at the bottom, clockwise, full scale at Vne; the white and green arcs
    const aOf = (kt) => (-150 + 300 * clamp(kt / top, 0, 1)) * DEG;
    dial(100, () => {
      const arc = (a0, a1, col) => { g.strokeStyle = col; g.lineWidth = 6; g.beginPath(); g.arc(0, 0, R - 10, aOf(a0) - Math.PI / 2, aOf(a1) - Math.PI / 2); g.stroke(); };
      arc(def.speeds.Vs0, def.speeds.Vfe || def.speeds.Vs1 * 1.8, 'rgba(230,230,225,0.8)');
      arc(def.speeds.Vs1, (def.speeds.Vne || top) * 0.87, 'rgba(90,190,110,0.85)');
      g.strokeStyle = face; g.fillStyle = face; g.lineWidth = 2; g.font = '15px Consolas, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const step = top > 250 ? 50 : 20;
      for (let k = 0; k <= top; k += step / 2) {
        const a = aOf(k), s = Math.sin(a), c = -Math.cos(a), big = k % step === 0;
        g.beginPath(); g.moveTo(s * (R - 4), c * (R - 4)); g.lineTo(s * (R - (big ? 18 : 12)), c * (R - (big ? 18 : 12))); g.stroke();
        if (big && k > 0) g.fillText(String(k), s * (R - 32), c * (R - 32));
      }
      g.font = '12px Consolas, monospace'; g.fillText('KNOTS', 0, 30);
      const a = aOf(ias);
      g.strokeStyle = '#f4f0e6'; g.lineWidth = 4; g.beginPath(); g.moveTo(-Math.sin(a) * 12, Math.cos(a) * 12); g.lineTo(Math.sin(a) * (R - 12), -Math.cos(a) * (R - 12)); g.stroke();
      g.fillStyle = '#222'; g.beginPath(); g.arc(0, 0, 6, 0, Math.PI * 2); g.fill();
    });
    // altimeter: the long needle hundreds, the short one thousands, and a drum with the feet
    dial(300, () => {
      g.strokeStyle = face; g.fillStyle = face; g.lineWidth = 2; g.font = '16px Consolas, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (let k = 0; k < 50; k++) {
        const a = k / 50 * Math.PI * 2, s = Math.sin(a), c = -Math.cos(a), big = k % 5 === 0;
        g.beginPath(); g.moveTo(s * (R - 4), c * (R - 4)); g.lineTo(s * (R - (big ? 16 : 9)), c * (R - (big ? 16 : 9))); g.stroke();
        if (big) g.fillText(String(k / 5), s * (R - 30), c * (R - 30));
      }
      const ft = Math.max(-999, alt);
      g.fillStyle = 'rgba(0,0,0,0.9)'; g.fillRect(-30, 20, 60, 22); g.fillStyle = face; g.font = '15px Consolas, monospace';
      g.fillText(String(Math.round(ft / 10) * 10).padStart(4, ' '), 0, 32);
      const hand = (a, len, w) => { g.lineWidth = w; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.sin(a) * len, -Math.cos(a) * len); g.stroke(); };
      g.strokeStyle = '#f4f0e6'; hand((ft / 10000) * Math.PI * 2, R - 44, 6); hand(((ft % 1000) / 1000) * Math.PI * 2, R - 12, 3.5);
      g.fillStyle = '#222'; g.beginPath(); g.arc(0, 0, 6, 0, Math.PI * 2); g.fill();
    });
  }

  drawADI(ac, ctx) {
    const g = this.adiCtx, W = 520, H = 520, cx = W / 2, cy = H / 2;
    g.clearRect(0, 0, W, H);
    const pitch = ac.euler.pitch * RAD, roll = ac.euler.roll;
    const pxDeg = 11;
    g.save();
    g.beginPath(); g.arc(cx, cy, 250, 0, Math.PI * 2); g.clip();
    g.translate(cx, cy);
    g.rotate(roll); // roll right -> horizon rotates left... horizon tilts opposite to bank
    g.translate(0, pitch * pxDeg);
    g.lineWidth = 2.5;
    g.strokeStyle = 'rgba(159,247,200,0.95)';
    if (this.adiShadow) { g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 4; }   // canvas shadows are slow on phones
    // horizon
    g.beginPath(); g.moveTo(-400, 0); g.lineTo(-60, 0); g.moveTo(60, 0); g.lineTo(400, 0); g.stroke();
    g.font = '18px Consolas, monospace'; g.fillStyle = 'rgba(159,247,200,0.95)'; g.textAlign = 'center';
    for (let p = -30; p <= 30; p += 5) {
      if (p === 0) continue;
      const y = -p * pxDeg;
      const w = p % 10 === 0 ? 70 : 40;
      g.beginPath();
      if (p > 0) { g.moveTo(-w, y); g.lineTo(-20, y); g.moveTo(20, y); g.lineTo(w, y); g.moveTo(-w, y); g.lineTo(-w, y + 10); g.moveTo(w, y); g.lineTo(w, y + 10); }
      else { for (let x = -w; x < -20; x += 12) { g.moveTo(x, y); g.lineTo(x + 7, y); } for (let x = 20; x < w; x += 12) { g.moveTo(x, y); g.lineTo(x + 7, y); } g.moveTo(-w, y); g.lineTo(-w, y - 10); g.moveTo(w, y); g.lineTo(w, y - 10); }
      g.stroke();
      if (p % 10 === 0) { g.fillText(String(Math.abs(p)), -w - 18, y + 6); g.fillText(String(Math.abs(p)), w + 18, y + 6); }
    }
    // commanded pitch (assist mode)
    if (ctx.fcs) {
      const y = -(ctx.fcs.pitch * RAD - pitch) * pxDeg;
      g.strokeStyle = '#5ec8ff'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(-110, y); g.lineTo(-80, y); g.moveTo(80, y); g.lineTo(110, y); g.stroke();
    }
    g.restore();
    // roll scale
    g.save(); g.translate(cx, cy);
    g.strokeStyle = 'rgba(159,247,200,0.7)'; g.lineWidth = 2;
    for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const r = a * DEG; const len = a % 30 === 0 ? 16 : 9;
      g.beginPath(); g.moveTo(Math.sin(r) * 215, -Math.cos(r) * 215); g.lineTo(Math.sin(r) * (215 - len), -Math.cos(r) * (215 - len)); g.stroke();
    }
    if (ctx.fcs) {
      g.save(); g.rotate(ctx.fcs.bank);
      g.fillStyle = '#5ec8ff';
      g.beginPath(); g.moveTo(0, -224); g.lineTo(-7, -236); g.lineTo(7, -236); g.closePath(); g.fill();
      g.restore();
    }
    g.rotate(roll);
    g.fillStyle = '#9ff7c8';
    g.beginPath(); g.moveTo(0, -212); g.lineTo(-9, -196); g.lineTo(9, -196); g.closePath(); g.fill();
    g.restore();
    // aircraft symbol
    g.save(); g.translate(cx, cy);
    g.strokeStyle = '#fff'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(-70, 0); g.lineTo(-30, 0); g.lineTo(-30, 12); g.moveTo(30, 12); g.lineTo(30, 0); g.lineTo(70, 0); g.stroke();
    g.beginPath(); g.arc(0, 0, 3, 0, Math.PI * 2); g.fill();
    // flight path vector
    if (ac.gs > 3) {
      const trk = ac.track, hdg = ac.euler.heading;
      let dpsi = ((trk - hdg + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const gamma = Math.atan2(ac.vs, ac.gs);
      // relative to the nose, in body-ish frame: lateral angle and vertical angle
      const fx = clamp(dpsi * RAD * Math.cos(roll) + (gamma * RAD - pitch) * Math.sin(roll), -20, 20) * pxDeg;
      const fy = -clamp((gamma * RAD - pitch) * Math.cos(roll) - dpsi * RAD * Math.sin(roll), -20, 20) * pxDeg;
      g.strokeStyle = '#6ee7a8'; g.lineWidth = 2.5;
      g.beginPath(); g.arc(fx, fy, 10, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(fx - 26, fy); g.lineTo(fx - 10, fy); g.moveTo(fx + 10, fy); g.lineTo(fx + 26, fy); g.moveTo(fx, fy - 10); g.lineTo(fx, fy - 20); g.stroke();
      // glideslope reference mark (-3 deg) as a dashed line
      if (ctx.gsRef != null) {
        const gy = -(-ctx.gsRef * RAD - pitch) * pxDeg;
        g.setLineDash([6, 6]); g.strokeStyle = 'rgba(94,200,255,0.8)';
        g.beginPath(); g.moveTo(-120, gy); g.lineTo(-40, gy); g.moveTo(40, gy); g.lineTo(120, gy); g.stroke();
        g.setLineDash([]);
      }
    }
    // sideslip ball
    const beta = clamp(ac.aero.beta * RAD, -10, 10);
    g.fillStyle = Math.abs(beta) > 5 ? '#ffb347' : '#fff';
    g.beginPath(); g.arc(-beta * 5, 232, 6, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(-8, 222); g.lineTo(-8, 242); g.moveTo(8, 222); g.lineTo(8, 242); g.stroke();
    g.restore();
  }
}
