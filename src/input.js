// Keyboard + gamepad + mouse-yoke input, producing smooth control axes and one-shot actions.
import { clamp } from './config.js';

// Pitch is flight-stick style (Marc's call, 2026-09-10): DOWN arrow / mouse back / stick back = pull = nose up,
// UP arrow / mouse forward / stick forward = push = nose down. Settings > "Invert pitch" swaps it.
const KEYMAP = {
  ArrowDown: 'pitchUp', ArrowUp: 'pitchDown', ArrowLeft: 'rollLeft', ArrowRight: 'rollRight',
  KeyQ: 'yawLeft', KeyE: 'yawRight', KeyZ: 'yawLeft', KeyC: 'yawRight',
  KeyW: 'thrUp', KeyS: 'thrDown', Equal: 'thrUp', Minus: 'thrDown', NumpadAdd: 'thrUp', NumpadSubtract: 'thrDown',
  Space: 'brake', KeyB: 'brake', KeyR: 'reverse',
  KeyF: 'flapsDown', KeyV: 'flapsUp', KeyG: 'gear', KeyH: 'hook', KeyK: 'spoiler', KeyL: 'autobrake',
  Home: 'trimUp', End: 'trimDown', Numpad7: 'trimUp', Numpad1: 'trimDown', KeyT: 'trimUp', KeyY: 'trimDown',
  Digit1: 'cam1', Digit2: 'cam2', Digit3: 'cam3', Digit4: 'cam4', Digit5: 'cam5', KeyX: 'camNext',
  KeyP: 'pause', Escape: 'menu', KeyM: 'hudToggle', KeyN: 'hintToggle', F1: 'thrIdle', F4: 'thrFull', Tab: 'camNext',
  KeyJ: 'lookLeft', KeyI: 'lookRight', KeyO: 'lookBack', ShiftLeft: 'boost', ShiftRight: 'boost',
  Comma: 'orbitLeft', Period: 'orbitRight', Digit0: 'orbitReset', Numpad0: 'orbitReset',
};
const ONESHOT = new Set(['flapsDown', 'flapsUp', 'gear', 'hook', 'spoiler', 'autobrake', 'cam1', 'cam2', 'cam3', 'cam4', 'cam5', 'camNext', 'pause', 'menu', 'hudToggle', 'hintToggle', 'thrIdle', 'thrFull', 'orbitReset']);
// While a menu is on screen (the home screen, pause, the debrief) these keys belong to the page: Tab moves the focus,
// Space and the arrows work the buttons, Esc goes back, P resumes. They are neither swallowed nor queued as flight
// actions (a queued Esc or P used to pause the flight again the moment it resumed). main.js sets `menuOpen`.
const MENU_KEYS = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape', 'KeyP']);

export class Input {
  constructor() {
    this.keys = new Set();
    this.actions = [];
    this.pitch = 0; this.roll = 0; this.yaw = 0;
    this.throttle = 0; this.brake = 0; this.reverse = 0;
    this.trim = 0;
    this.enabled = true;
    this.mouseYoke = false;
    this.mouseSens = 0.5;
    this.mdx = 0; this.mdy = 0;
    this.kbPitch = 0; this.kbRoll = 0;
    this.boost = false;
    this.wheelBrake = 0;
    this.keyBrake = 0;
    this.mx = 0; this.my = 0;
    this.padPitch = 0; this.padRoll = 0; this.padYaw = 0; this.padThr = null; this.padBrake = 0;
    this.sens = 1;
    this.lookX = 0; this.lookY = 0;
    this._padButtons = [];
    this.padConnected = false;
    this.freeLook = { x: 0, y: 0 };
    this._trimRepeat = 0;
    // touch controls (touch.js): stick axes and the rudder slider; buttons reuse this.keys / this.actions
    this.touchPitch = 0; this.touchRoll = 0; this.touchYaw = 0;
    this.tiltPitch = 0; this.tiltRoll = 0;   // phone tilt, when Settings > Tilt to fly is on
    this.lastPointerType = 'mouse';
    // camera drag: accumulated right-drag movement, wheel zoom clicks, key direction, reset flag (camera.js consumes them every frame:
    // chase = orbit anywhere around the airplane, cockpit / wing = turn your head, tower / fly-by = zoom)
    this.orbitDX = 0; this.orbitDY = 0; this.orbitZoomDelta = 0; this.orbitKey = 0; this.orbitReset = false; this.orbitDrag = false;

    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
      const a = KEYMAP[e.code];
      if (!a) return;
      if (this.menuOpen && MENU_KEYS.has(e.code) && this.menuOpen()) return;
      e.preventDefault();
      if (e.repeat) return;
      this.keys.add(a);
      if (ONESHOT.has(a)) this.actions.push(a);
      if (a === 'trimUp' || a === 'trimDown') this._trimRepeat = 0;
    });
    window.addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (a) { this.keys.delete(a); if (!(this.menuOpen && MENU_KEYS.has(e.code) && this.menuOpen())) e.preventDefault(); }   // Space activates a menu button on keyup
    });
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('gamepadconnected', () => { this.padConnected = true; });
    window.addEventListener('gamepaddisconnected', () => { this.padConnected = false; });
  }

  attachMouse(canvas) {
    canvas.addEventListener('pointerdown', (e) => { this.lastPointerType = e.pointerType || 'mouse'; });
    canvas.addEventListener('click', () => {
      if (!this.enabled || this.lastPointerType === 'touch') return;   // a finger cannot use a pointer-locked yoke
      if (document.pointerLockElement !== canvas) {
        try { const p = canvas.requestPointerLock?.(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* not available (e.g. embedded) */ }
      }
    });
    // right mouse button: orbit the chase camera (works with or without the yoke's pointer lock)
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => { if (e.button === 2) { this.orbitDrag = true; e.preventDefault(); } });
    window.addEventListener('mouseup', (e) => { if (e.button === 2) this.orbitDrag = false; });
    document.addEventListener('pointerlockchange', () => {
      this.mouseYoke = document.pointerLockElement === canvas;
      if (!this.mouseYoke) { this.mx = 0; this.my = 0; }
    });
    canvas.addEventListener('mousemove', (e) => {
      if (this.orbitDrag || (e.buttons & 2)) { this.orbitDX += e.movementX; this.orbitDY += e.movementY; return; }
      if (!this.mouseYoke) return;
      this.mx = clamp(this.mx + e.movementX * 0.0022 * this.mouseSens, -1, 1);
      this.my = clamp(this.my + e.movementY * 0.0022 * this.mouseSens, -1, 1);
      this.mdx += e.movementX; this.mdy += e.movementY;
    });
    canvas.addEventListener('wheel', (e) => {
      if (!this.mouseYoke) { this.orbitZoomDelta += Math.sign(e.deltaY); e.preventDefault(); return; }   // mouse not captured: zoom the chase camera
      // wheel down: throttle back; past idle it applies the brakes progressively. Wheel up: brakes off first, then throttle.
      if (e.deltaY > 0) {
        if (this.throttle > 0.001) this.throttle = clamp(this.throttle - 0.05, 0, 1);
        else this.wheelBrake = clamp(this.wheelBrake + 0.125, 0, 1);
      } else if (e.deltaY < 0) {
        if (this.wheelBrake > 0.001) this.wheelBrake = clamp(this.wheelBrake - 0.125, 0, 1);
        else this.throttle = clamp(this.throttle + 0.05, 0, 1);
      }
      e.preventDefault();
    }, { passive: false });
  }

  releaseMouse() {
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  has(a) { return this.keys.has(a); }

  // Pull queued one-shot actions
  drain() { const a = this.actions; this.actions = []; return a; }

  _pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) if (p && p.connected) { gp = p; break; }
    if (!gp) { this.padConnected = false; this.padThr = null; return; }
    this.padConnected = true;
    const dz = (v) => (Math.abs(v) < 0.08 ? 0 : (v - Math.sign(v) * 0.08) / 0.92);
    const ax = gp.axes;
    this.padRoll = dz(ax[0] || 0);
    this.padPitch = dz(ax[1] || 0);      // push forward = nose down = negative pitch input
    this.padYaw = dz(ax[2] || 0);
    // triggers: RT (button 7) throttle up, LT (button 6) throttle down
    const rt = gp.buttons[7]?.value || 0, lt = gp.buttons[6]?.value || 0;
    this.padThrDelta = (rt - lt);
    this.padBrake = gp.buttons[1]?.pressed ? 1 : 0; // B
    const bt = (i) => !!gp.buttons[i]?.pressed;
    const prev = this._padButtons;
    const now = gp.buttons.map((b) => b.pressed);
    const edge = (i) => now[i] && !prev[i];
    if (edge(0)) this.actions.push('gear');      // A
    if (edge(2)) this.actions.push('flapsDown'); // X
    if (edge(3)) this.actions.push('flapsUp');   // Y
    if (edge(4)) this.actions.push('hook');      // LB
    if (edge(5)) this.actions.push('spoiler');   // RB
    if (edge(9)) this.actions.push('pause');     // Start
    if (edge(8)) this.actions.push('camNext');   // Back
    if (edge(12)) this.trim = clamp(this.trim - 0.03, -1, 1); // dpad up = trim nose down
    if (edge(13)) this.trim = clamp(this.trim + 0.03, -1, 1); // dpad down = trim nose up
    if (bt(14)) this.padYaw = -1; if (bt(15)) this.padYaw = 1; // dpad left/right rudder
    this.padReverse = bt(10) ? 1 : 0; // left stick click
    // right stick look
    this.lookX = dz(ax[2] || 0); this.lookY = dz(ax[3] || 0);
    this._padButtons = now;
  }

  update(dt) {
    this._pollPad();
    const k = this.keys;
    const ramp = (cur, target, up, down) => {
      if (target !== 0) return clamp(cur + Math.sign(target) * up * dt, -1, 1);
      if (cur > 0) return Math.max(0, cur - down * dt);
      if (cur < 0) return Math.min(0, cur + down * dt);
      return 0;
    };
    let pT = (k.has('pitchUp') ? 1 : 0) - (k.has('pitchDown') ? 1 : 0);
    let rT = (k.has('rollRight') ? 1 : 0) - (k.has('rollLeft') ? 1 : 0);
    let yT = (k.has('yawRight') ? 1 : 0) - (k.has('yawLeft') ? 1 : 0);
    this.kPitch = ramp(this.kPitch || 0, pT, 3.8 * this.sens, 8);
    this.kRoll = ramp(this.kRoll || 0, rT, 4.2 * this.sens, 8);
    this.kYaw = ramp(this.kYaw || 0, yT, 2.5, 6);   // rudder keys: 0.4 s to full pedal (was 0.29 s), so a tap is a nudge; release unchanged

    // combine sources: keyboard + gamepad + mouse yoke (largest magnitude wins per axis)
    const pick = (...vals) => vals.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
    this.kbPitch = clamp(pick(this.kPitch, this.padPitch, this.touchPitch, this.tiltPitch), -1, 1);   // stick forward (negative) = nose down, like the arrows; touch stick and phone tilt the same
    this.kbRoll = clamp(pick(this.kRoll, this.padRoll, this.touchRoll, this.tiltRoll), -1, 1);
    this.pitch = clamp(pick(this.kbPitch, this.mouseYoke ? this.my : 0), -1, 1);
    this.roll = clamp(pick(this.kbRoll, this.mouseYoke ? this.mx : 0), -1, 1);
    this.yaw = clamp(pick(this.kYaw, this.padYaw, this.touchYaw), -1, 1);
    this.boost = k.has('boost');

    // throttle
    if (k.has('thrUp')) { this.throttle = clamp(this.throttle + 0.45 * dt, 0, 1); this.wheelBrake = 0; }
    if (k.has('thrDown')) this.throttle = clamp(this.throttle - 0.45 * dt, 0, 1);
    if (this.padThrDelta) this.throttle = clamp(this.throttle + this.padThrDelta * 0.6 * dt, 0, 1);
    for (const a of this.actions) { if (a === 'thrIdle') this.throttle = 0; if (a === 'thrFull') { this.throttle = 1; this.wheelBrake = 0; } }

    // brakes (progressive: about 1.5 s to full) / reverse (hold)
    const bT = k.has('brake') || this.padBrake ? 1 : 0;
    this.keyBrake = bT ? Math.min(1, this.keyBrake + 0.7 * dt) : Math.max(0, this.keyBrake - 2.5 * dt);
    this.brake = Math.max(this.keyBrake, this.wheelBrake);
    const rvT = k.has('reverse') || this.padReverse ? 1 : 0;
    this.reverse = rvT ? Math.min(1, this.reverse + 1.5 * dt) : Math.max(0, this.reverse - 3 * dt);

    // trim (hold to run)
    if (k.has('trimUp') || k.has('trimDown')) {
      this._trimRepeat += dt;
      const rate = 0.12 + Math.min(this._trimRepeat, 1.5) * 0.15;
      if (k.has('trimUp')) this.trim = clamp(this.trim + rate * dt, -1, 1);
      if (k.has('trimDown')) this.trim = clamp(this.trim - rate * dt, -1, 1);
    }
    // free look with keys
    const lx = (k.has('lookRight') ? 1 : 0) - (k.has('lookLeft') ? 1 : 0);
    this.freeLook.x = k.has('lookBack') ? 1 : lx * 0.5;
    // orbit with keys (held) and the reset one-shot
    this.orbitKey = (k.has('orbitRight') ? 1 : 0) - (k.has('orbitLeft') ? 1 : 0);
    for (const a of this.actions) if (a === 'orbitReset') this.orbitReset = true;
  }

  reset() {
    this.pitch = this.roll = this.yaw = 0;
    this.kPitch = this.kRoll = this.kYaw = 0;
    this.throttle = 0; this.brake = 0; this.keyBrake = 0; this.wheelBrake = 0; this.reverse = 0; this.trim = 0;
    this.mx = this.my = 0; this.mdx = this.mdy = 0;
    this.touchPitch = this.touchRoll = this.touchYaw = 0;
    this.tiltPitch = this.tiltRoll = 0;
    this.actions = [];
  }
}

export const KEY_HELP = [
  ['Arrows', 'Pitch: down = pull (nose up), up = push (nose down) / Roll'],
  ['Q / E', 'Rudder'],
  ['W / S', 'Throttle up / down'],
  ['F1 / F4', 'Throttle idle / full'],
  ['F / V', 'Flaps down / up'],
  ['G', 'Landing gear'],
  ['Space or B', 'Wheel brakes (hold)'],
  ['R', 'Reverse thrust (hold, jets on ground)'],
  ['K', 'Spoilers / speedbrake (arm or toggle)'],
  ['L', 'Autobrake (airliner)'],
  ['H', 'Tailhook'],
  ['T / Y  (Home/End)', 'Trim nose up / down'],
  ['1 – 5, X, Tab', 'Camera views / next view'],
  ['J / I / O', 'Look left / right / back'],
  ['M', 'Toggle HUD'],
  ['N', 'Toggle hints'],
  ['P', 'Pause'],
  ['Esc', 'Menu / release mouse'],
  ['Mouse', 'Click the view: move to bank, pull back for nose up, wheel = throttle, wheel past idle = brakes'],
  ['Right-drag', 'Swing the chase camera anywhere around the airplane, above or below it; it stays where you leave it (get down low and watch the wheels touch). In the cockpit and wing views it turns your head. Wheel = zoom when the mouse is not captured'],
  [', / .  and 0', 'Orbit the camera left / right with keys; 0 puts it back behind the tail (or your head straight ahead)'],
  ['Shift', 'Full control authority in Direct mode'],
  ['Gamepad', 'Sticks fly, triggers throttle, A gear, X/Y flaps, B brakes, LB hook, RB spoilers, D-pad trim'],
];
