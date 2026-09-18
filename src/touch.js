// Touch controls for phones and tablets (2026-09-10).
//
// Layout (landscape): the LEFT side (48% of the width, everything below the top button row) is a floating stick —
// touch ANYWHERE there and a stick appears under the thumb; a dimmed one rests at the home position so a thumb knows
// where to go. (Until 2026-09-11 the zone was a narrow band in the lower-left corner: on a phone-sized screen most
// of the left side did nothing and a drag past 40% of the width moved the camera instead. That is the bug Marc hit.)
// Pull DOWN = nose up; pull DOWN = nose up, push UP = nose down (flight-stick style, same as the arrows and the mouse yoke;
// Settings > Invert pitch flips it), left/right = roll. The RIGHT edge is the throttle slider (it stays where
// you leave it). The RUDDER slider sits at the bottom right and springs back to centre; on the ground it steers.
// BRAKES and REV (jets) are hold buttons at the bottom left. Flaps / gear / hook / spoilers / autobrake are tap
// buttons at the top left, TRIM is a pair of hold buttons next to them, CAM and pause are at the top right.
// Dragging on the right side spins the chase camera anywhere around the airplane (like the right mouse button) or
// turns your head in the cockpit and wing views, pinching zooms, a double-tap puts it back.
//
// Settings > "Tilt to fly" adds the phone's own tilt as a second source for pitch and roll (TiltControl below):
// the attitude when the flight starts is the neutral one, tilting the far edge down is nose down, banking the phone
// rolls. The stick still works at the same time (largest deflection wins) and TILT recentres.
//
// Everything feeds the existing Input: analog axes go to input.touchPitch/touchRoll/touchYaw (combined with the
// keys and the gamepad by Input.update), the throttle is set directly like the mouse wheel does, hold buttons
// add/remove the same action names the keyboard uses in input.keys, tap buttons queue one-shot actions.
// SIDES (2026-09-12): Marc flies with the stick under his RIGHT thumb, so that is the default. The stick zone is then
// the right side of the screen, and the throttle (left edge), rudder (bottom left), BRAKES / REV / TILT (a row just
// above the rudder) and flaps / gear / trim (top left) are all under the left thumb, with the camera drag on the left
// side between them. Settings > Stick puts it back under the left thumb, the layout described above.
// body.stick-right is the one switch (main.js sets it, style.css mirrors the positions, homeStick() follows).
import { clamp } from './config.js';

// Is this most likely a touch device? Coarse primary pointer or no hover, plus real touch points.
export function touchLikely() {
  try {
    if (typeof navigator === 'undefined' || typeof matchMedia !== 'function') return false;
    const pts = navigator.maxTouchPoints || 0;
    if (!pts) return false;
    return matchMedia('(pointer: coarse)').matches || matchMedia('(hover: none)').matches;
  } catch (e) { return false; }
}

// Hints and briefing tips name keyboard keys; on touch they should name the buttons. Longest phrases first.
const TOUCH_WORDS = [
  ['Press K to arm the spoilers, L for autobrake.', 'Tap SPLR to arm the spoilers, ABRK for autobrake.'],
  ['Arm the spoilers (K) and set autobrake (L).', 'Arm the spoilers (SPLR) and set autobrake (ABRK).'],
  ['Press H for the hook, G for gear, F twice for full flaps.', 'Tap HOOK, GEAR, and FLAPS ▼ twice for full flaps.'],
  ['Hook down: press H. Gear: G. Flaps full: F twice.', 'Hook down: tap HOOK. Gear: tap GEAR. Flaps full: FLAPS ▼ twice.'],
  ['Trim with T (nose up) and Y (nose down).', 'Trim with the TRIM buttons.'],
  ['Trim it (T/Y keys).', 'Trim it (TRIM buttons).'],
  ['Trim with T/Y.', 'Trim with the TRIM buttons.'],
  ['Trim (T/Y).', 'Trim (TRIM buttons).'],
  ['(press F four times)', '(tap FLAPS ▼ four times)'],
  ['press F until FLAPS 30', 'tap FLAPS ▼ until FLAPS 30'],
  ['Full flap (F twice)', 'Full flap (FLAPS ▼ twice)'],
  ['Full flaps: press F.', 'Full flaps: tap FLAPS ▼.'],
  ['Add flaps: press F', 'Add flaps: tap FLAPS ▼'],
  ['Gear down: press G.', 'Gear down: tap GEAR.'],
  ['Hold R for reverse thrust', 'Hold REV for reverse thrust'],
  ['Full reverse (hold R)', 'Full reverse (hold REV)'],
  ['brakes with Space (or autobrake)', 'BRAKES (or autobrake)'],
  ['Brakes: hold Space.', 'Brakes: hold BRAKES.'],
  ['Brake gently (Space)', 'Brake gently (BRAKES)'],
  ['rudder (Q/E)', 'the rudder slider'],
  ['push the nose down (up arrow), full throttle (W)', 'push the stick forward, throttle full'],
  // the failure drills (2026-09-17): FIRE / ENG OFF, TRIM CUT and FUEL CUT appear on the touch bar when they apply
  ['Pull the fire handle (press A)', 'Pull the fire handle (tap FIRE)'],
  ['Pull the fire handle: press A.', 'Pull the fire handle: tap FIRE.'],
  ['pull the fire handle, press A.', 'pull the fire handle: tap FIRE.'],
  ['with the fire handle (press A)', 'with the ENG OFF button'],
  ['hut it down (press A)', 'hut it down (tap ENG OFF)'],
  ['hut it down: press A.', 'hut it down: tap ENG OFF.'],
  ['(press D)', '(tap TRIM CUT)'],
  ['press D', 'tap TRIM CUT'],
  ['wind the trim back with T.', 'wind the trim back with TRIM ▲.'],
  ['wind the trim back: hold T.', 'wind the trim back: hold TRIM ▲.'],
  ['then T / Y wind it by hand', 'then the TRIM buttons wind it by hand'],
  ['(press U)', '(tap FUEL CUT)'],
  ['press U', 'tap FUEL CUT'],
  ['(press F once more)', '(tap FLAPS ▼ once more)'],
  ['Flaps 40: press F.', 'Flaps 40: tap FLAPS ▼.'],
  ['press K twice', 'tap SPLR twice'],
  ['the speedbrake: K twice.', 'the speedbrake: SPLR twice.'],
  ['Speedbrake out: press K', 'Speedbrake out: tap SPLR'],
  ['spoilers armed (K)', 'spoilers armed (SPLR)'],
  ['brake hard (Space)', 'brake hard (BRAKES)'],
  ['left rudder (Q)', 'left rudder'],
  ['right rudder (E)', 'right rudder'],
  ['one reverser (hold R)', 'one reverser (hold REV)'],
];
export function touchify(text) {
  if (!text) return text;
  let s = String(text);
  for (const [from, to] of TOUCH_WORDS) if (s.includes(from)) s = s.split(from).join(to);
  return s;
}

const TAP_LABELS = { flapsDown: 'FLAPS ▼', flapsUp: 'FLAPS ▲', gear: 'GEAR', hook: 'HOOK', spoiler: 'SPLR', autobrake: 'ABRK' };

function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

// Stick response: a small dead zone, then a gentle expo so the first millimetres are fine control.
function curve(v) {
  const dz = 0.06;
  const a = Math.abs(v);
  if (a < dz) return 0;
  const s = Math.min(1, (a - dz) / (1 - dz));
  return Math.sign(v) * s * (0.45 + 0.55 * s);
}

export class TouchControls {
  constructor(root, input, game) {
    this.input = input;
    this.game = game;
    this.R = 46;                 // stick radius, CSS px (the base in style.css is 2R)
    this.ptr = new Map();        // pointerId -> { kind, ... }
    this.held = new Set();       // action names currently held through buttons
    this.visible = false;
    this.def = null;
    this.root = el('div', 'hidden');
    this.root.id = 'touch';
    this.root.innerHTML = `
      <div class="tz tz-stick" data-z="stick"></div>
      <div class="tz tz-look" data-z="look"></div>
      <div class="tstick" id="tstick"><div class="base"></div><div class="knob"></div><span class="lbl">FLY</span></div>
      <div class="tbar tb-left" id="tb-left"></div>
      <div class="tbar tb-right" id="tb-right"><button class="tb" data-tap="camNext">CAM</button><button class="tb" data-tap="pause">❚❚</button></div>
      <div class="tthr" id="tthr" data-z="thr"><div class="track"><div class="fill"></div><div class="knob"></div></div><span class="lbl">THR</span><span class="val" id="tthrv">0%</span></div>
      <div class="trud" id="trud" data-z="rud"><div class="track"><span class="l">RUDDER</span><div class="knob"></div></div></div>
      <div class="tbar tb-bottom" id="tb-bottom"><button class="tb hold" data-hold="brake">BRAKES</button><button class="tb hold" id="trev" data-hold="reverse">REV</button></div>`;
    root.appendChild(this.root);
    this.stick = this.root.querySelector('#tstick');
    this.stickKnob = this.stick.querySelector('.knob');
    this.thr = this.root.querySelector('#tthr');
    this.thrTrack = this.thr.querySelector('.track');
    this.thrFill = this.thr.querySelector('.fill');
    this.thrKnob = this.thr.querySelector('.knob');
    this.thrVal = this.thr.querySelector('.val');
    this.rud = this.root.querySelector('#trud');
    this.rudTrack = this.rud.querySelector('.track');
    this.rudKnob = this.rud.querySelector('.knob');
    this.left = this.root.querySelector('#tb-left');
    this.rev = this.root.querySelector('#trev');
    this.lastTap = 0;
    this.thrDragging = false;
    this.tilt = new TiltControl(input);
    window.addEventListener('resize', () => this.homeStick());

    const r = this.root;
    r.addEventListener('contextmenu', (e) => e.preventDefault());
    r.addEventListener('pointerdown', (e) => this.onDown(e));
    r.addEventListener('pointermove', (e) => this.onMove(e));
    r.addEventListener('pointerup', (e) => this.onUp(e));
    r.addEventListener('pointercancel', (e) => this.onUp(e));
    r.addEventListener('lostpointercapture', (e) => this.onUp(e));
    window.addEventListener('blur', () => this.releaseAll());
  }

  // ---- show / hide ----
  show(def) {
    if (def !== this.def) { this.def = def; this.buildButtons(def); }
    this.visible = true;
    this.root.classList.remove('hidden');
    this.syncThrottle();
    this.homeStick();
  }
  hide() {
    this.visible = false;
    this.root.classList.add('hidden');
    this.releaseAll();
  }
  reset() { this.releaseAll(); this.syncThrottle(); this.homeStick(); }

  // Park the (dimmed) stick where a left thumb naturally lands, so the control can be seen before it is touched.
  homeStick() {
    const z = this.root.querySelector('.tz-stick');
    if (!z || !this.visible) return;
    const r = z.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const R = this.R;
    const inset = Math.max(R + 6, Math.min(r.width * 0.26, r.width - R - 6));
    this.homeX = document.body.classList.contains('stick-right') ? r.right - inset : r.left + inset;   // toward the outer edge, where the thumb is
    this.homeY = r.top + Math.max(R + 6, Math.min(r.height * 0.68, r.height - R - 44));   // below the side tapes, above the bottom row
    if (!this.stick.classList.contains('on')) {
      this.stick.style.left = this.homeX + 'px';
      this.stick.style.top = this.homeY + 'px';
      this.stick.classList.add('rest');
    }
  }

  buildButtons(def) {
    const b = [['flapsDown'], ['flapsUp']];
    if (def.gearRetract) b.push(['gear']);
    if (def.hook) b.push(['hook']);
    if (def.spoilers) b.push(['spoiler']);
    if (def.autobrake) b.push(['autobrake']);
    const html = b.map(([a]) => `<button class="tb" data-tap="${a}">${TAP_LABELS[a]}</button>`).join('')
      + `<button class="tb hold" data-hold="trimUp">TRIM ▲</button><button class="tb hold" data-hold="trimDown">TRIM ▼</button>`;
    this.left.innerHTML = html;
    this.rev.style.display = def.engines[0].reverse ? '' : 'none';
  }
  // The failure drills (src/systems/failureEffects.js): FIRE / ENG OFF (the fire handle), TRIM CUT, FUEL CUT, each
  // shown only while its failure is on and it has not been used; list = [{ a: action, label, hot }]. Their own bar
  // (style.css #tb-fail), so the buttons the airplane always has do not move.
  setFailureButtons(list) {
    if (!this.failBar) { this.failBar = el('div', 'tbar tb-fail'); this.failBar.id = 'tb-fail'; this.root.appendChild(this.failBar); }
    this.failBar.innerHTML = list.map((b) => `<button class="tb${b.hot ? ' hot' : ''}" data-tap="${b.a}">${b.label}</button>`).join('');
    this.failBar.classList.toggle('none', !list.length);
  }
  // TILT (recentre) appears with the bottom-left holds only while tilt-to-fly is on
  setTiltButton(on) {
    let b = this.root.querySelector('#ttilt');
    if (on && !b) {
      b = el('button', 'tb tilt', 'TILT');
      b.id = 'ttilt';
      b.dataset.tap = 'tiltZero';
      this.root.querySelector('#tb-bottom').appendChild(b);
    } else if (!on && b) b.remove();
  }

  // ---- pointer plumbing ----
  onDown(e) {
    if (!this.visible) return;
    const t = e.target.closest ? e.target.closest('[data-tap],[data-hold],[data-z]') : null;
    if (!t) return;
    e.preventDefault();
    try { t.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
    if (t.dataset.tap) {
      if (t.dataset.tap === 'tiltZero') this.tilt.zero(); else this.input.actions.push(t.dataset.tap);
      t.classList.add('on');
      this.ptr.set(e.pointerId, { kind: 'tap', el: t });
      return;
    }
    if (t.dataset.hold) {
      const a = t.dataset.hold;
      this.input.keys.add(a); this.held.add(a);
      if (a === 'trimUp' || a === 'trimDown') this.input._trimRepeat = 0;
      t.classList.add('on');
      this.ptr.set(e.pointerId, { kind: 'hold', el: t, a });
      return;
    }
    const z = t.dataset.z;
    if (z === 'stick') {
      const zr = t.getBoundingClientRect(), R = this.R;
      const cx = clamp(e.clientX, zr.left + R, Math.max(zr.left + R, zr.right - R));
      const cy = clamp(e.clientY, zr.top + R, Math.max(zr.top + R, zr.bottom - R));
      this.stick.style.left = cx + 'px'; this.stick.style.top = cy + 'px';
      this.stick.classList.add('on');
      this.stick.classList.remove('rest');
      this.stickKnob.style.transform = 'translate(-50%, -50%)';
      this.ptr.set(e.pointerId, { kind: 'stick', cx, cy });
      this.moveStick(this.ptr.get(e.pointerId), e);
    } else if (z === 'thr') {
      this.ptr.set(e.pointerId, { kind: 'thr' });
      this.thrDragging = true;
      this.moveThrottle(e);
    } else if (z === 'rud') {
      this.ptr.set(e.pointerId, { kind: 'rud' });
      this.rud.classList.add('on');
      this.moveRudder(e);
    } else if (z === 'look') {
      const now = performance.now();
      const looks = [...this.ptr.values()].filter((p) => p.kind === 'look');
      const p = { kind: 'look', x: e.clientX, y: e.clientY, moved: 0 };
      this.ptr.set(e.pointerId, p);
      if (looks.length === 1) { const o = looks[0]; this.pinch = Math.hypot(o.x - p.x, o.y - p.y); }
      if (looks.length === 0) {
        if (now - this.lastTap < 350) { this.input.orbitReset = true; this.lastTap = 0; } else this.lastTap = now;
      }
    }
  }
  onMove(e) {
    const p = this.ptr.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    if (p.kind === 'stick') this.moveStick(p, e);
    else if (p.kind === 'thr') this.moveThrottle(e);
    else if (p.kind === 'rud') this.moveRudder(e);
    else if (p.kind === 'look') {
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.moved += Math.abs(dx) + Math.abs(dy);
      p.x = e.clientX; p.y = e.clientY;
      const looks = [...this.ptr.values()].filter((q) => q.kind === 'look');
      if (looks.length >= 2) {
        const d = Math.hypot(looks[0].x - looks[1].x, looks[0].y - looks[1].y);
        if (this.pinch) this.input.orbitZoomDelta += (this.pinch - d) / 40;   // fingers apart = closer
        this.pinch = d;
      } else {
        this.input.orbitDX += dx * 1.6; this.input.orbitDY += dy * 1.6;   // camera.js decides what a drag means in the current view
      }
    }
  }
  onUp(e) {
    const p = this.ptr.get(e.pointerId);
    if (!p) return;
    this.ptr.delete(e.pointerId);
    if (p.kind === 'tap') p.el.classList.remove('on');
    else if (p.kind === 'hold') { this.input.keys.delete(p.a); this.held.delete(p.a); p.el.classList.remove('on'); }
    else if (p.kind === 'stick') this.endStick();
    else if (p.kind === 'thr') { this.thrDragging = false; }
    else if (p.kind === 'rud') { this.input.touchYaw = 0; this.rudKnob.style.transform = 'translate(-50%, -50%)'; this.rud.classList.remove('on'); }
    else if (p.kind === 'look') { if (p.moved > 12) this.lastTap = 0; this.pinch = 0; }
  }
  releaseAll() {
    for (const p of this.ptr.values()) { if (p.el) p.el.classList.remove('on'); }
    this.ptr.clear();
    for (const a of this.held) this.input.keys.delete(a);
    this.held.clear();
    this.endStick();
    this.input.touchYaw = 0; this.rudKnob.style.transform = 'translate(-50%, -50%)'; this.rud.classList.remove('on');
    this.thrDragging = false; this.pinch = 0;
  }

  // ---- the controls ----
  moveStick(p, e) {
    const R = this.R;
    let dx = e.clientX - p.cx, dy = e.clientY - p.cy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    this.stickKnob.style.transform = `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px))`;
    this.input.touchRoll = curve(dx / R);
    this.input.touchPitch = curve(dy / R);     // thumb pulled down the screen = pull = nose up
  }
  endStick() {
    this.stick.classList.remove('on');
    this.stickKnob.style.transform = 'translate(-50%, -50%)';
    this.input.touchRoll = 0; this.input.touchPitch = 0;
    this.homeStick();
  }
  moveThrottle(e) {
    const r = this.thrTrack.getBoundingClientRect();
    const pad = 14;
    const v = clamp((r.bottom - pad - e.clientY) / Math.max(1, r.height - 2 * pad), 0, 1);
    this.input.throttle = v;
    this.input.wheelBrake = 0;
    this.drawThrottle(v);
  }
  drawThrottle(v) {
    this.thrFill.style.height = (v * 100).toFixed(1) + '%';
    this.thrKnob.style.bottom = (v * 100).toFixed(1) + '%';
    const pct = Math.round(v * 100) + '%';
    if (this.thrVal.textContent !== pct) this.thrVal.textContent = pct;   // only touch the DOM when it changes
  }
  syncThrottle() { this.drawThrottle(clamp(this.input.throttle || 0, 0, 1)); }
  moveRudder(e) {
    const r = this.rudTrack.getBoundingClientRect();
    const range = Math.max(1, r.width / 2 - 22);
    const v = clamp((e.clientX - (r.left + r.width / 2)) / range, -1, 1);
    this.input.touchYaw = v;
    this.rudKnob.style.transform = `translate(calc(-50% + ${(v * range).toFixed(1)}px), -50%)`;
  }

  // per frame: keep the throttle knob on the real throttle (keys, wheel, F1/F4, autoland all move it)
  update() {
    if (!this.visible || this.thrDragging) return;
    this.drawThrottle(clamp(this.input.throttle || 0, 0, 1));
  }
}

// ---- Tilt to fly (optional; Settings > "Tilt to fly") ------------------------------------------------------
// The phone's own attitude as a second source for pitch and roll. The attitude when a flight starts (or when TILT
// is tapped) is neutral; everything is measured from there, so it works however the phone is being held. The device
// axes are rotated into the screen's frame with screen.orientation.angle, so it behaves the same in either landscape.
// Full deflection at TILT_P / TILT_R degrees from neutral, with the same expo the thumb stick uses.
const TILT_P = 22, TILT_R = 26;
export class TiltControl {
  constructor(input) {
    this.input = input;
    this.on = false;
    this.ref = null;
    this.seen = false;                       // has a real reading arrived? (a phone with no sensor never fires)
    this.handler = (e) => this.onOrient(e);
  }
  get supported() { return typeof window !== 'undefined' && !!window.DeviceOrientationEvent; }
  // iOS needs the permission asked from inside a user gesture - the Settings toggle is one.
  async enable() {
    if (this.on) return true;
    if (!this.supported) return false;
    try {
      const D = window.DeviceOrientationEvent;
      if (typeof D.requestPermission === 'function' && (await D.requestPermission()) !== 'granted') return false;
    } catch (e) { return false; }
    window.addEventListener('deviceorientation', this.handler);
    this.on = true; this.ref = null; this.seen = false;
    return true;
  }
  disable() {
    if (!this.on) return;
    window.removeEventListener('deviceorientation', this.handler);
    this.on = false; this.ref = null; this.seen = false;
    this.input.tiltPitch = 0; this.input.tiltRoll = 0;
  }
  zero() { this.ref = null; }                // the next reading becomes the new neutral
  onOrient(e) {
    if (e.beta == null || e.gamma == null) return;
    this.seen = true;
    let a = 0;
    try { a = (screen.orientation && screen.orientation.angle) || window.orientation || 0; } catch (err) { a = 0; }
    const r = a * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    const ty = e.beta * c + e.gamma * s;     // tilted toward / away from the player
    const tx = e.gamma * c - e.beta * s;     // banked left / right
    if (!this.ref) { this.ref = { x: tx, y: ty }; }
    let dy = ty - this.ref.y, dx = tx - this.ref.x;
    if (dy > 180) dy -= 360; else if (dy < -180) dy += 360;
    if (dx > 180) dx -= 360; else if (dx < -180) dx += 360;
    this.input.tiltPitch = curve(clamp(dy / TILT_P, -1, 1));   // phone pulled toward you = nose up, like the thumb stick
    this.input.tiltRoll = curve(clamp(dx / TILT_R, -1, 1));
  }
}
