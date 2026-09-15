// Flight control laws between the pilot's inputs and the control surfaces.
//
// 'assist' (default): attitude command. Roll input commands a bank angle at a realistic rate and the
//   airplane levels itself when released; pitch input nudges the commanded pitch attitude, which is
//   held hands-off. A PD+I loop drives the surfaces, so a keyboard tap is a small, smooth change.
//   Trim keys nudge the commanded attitude (bounded). Rudder stays direct so crosswind technique works.
//   Stalls are NOT prevented: command more pitch than the wing can hold and it breaks like before.
// 'direct': raw surface deflection with keyboard authority limited to 75% (Shift = full) and trim
//   limited to +-45% of elevator travel.
import { DEG, RAD, KT, G, clamp } from '../config.js';

const approach = (c, t, d) => (t > c ? Math.min(c + d, t) : Math.max(c - d, t));
const STALL_HOLD_PAST = 5 * DEG;   // holdStall(): how far past the break the held angle of attack sits
const STALL_HOLD_GAIN = 12;        // holdStall(): elevator per radian of angle-of-attack error
const STALL_HOLD_ENTRY = 2.5;      // holdStall(): seconds over which the held angle of attack rises to the break

export class FlightControl {
  constructor(ac, settings) {
    this.settings = settings;
    this.resync(ac);
  }
  get mode() { return this.settings.controlMode || 'assist'; }
  resync(ac) {
    this.cmdPitch = ac.euler.pitch;
    this.cmdBank = 0;
    this.pitchInt = clamp(ac.ctl.elevator || ac.input.trim || 0, -0.6, 0.6);   // the integrator carries the trim (start from where the elevator is)
    this.lastTrim = null;
    this.lastMode = this.mode;
  }
  update(dt, inp, ac, invert = 1) {
    const def = ac.def, out = ac.input;
    if (this.mode !== this.lastMode) { this.resync(ac); this.lastMode = this.mode; }
    const yaw = inp.yaw;
    if (this.mode === 'direct') {
      const auth = inp.mouseYoke ? 1 : (inp.boost ? 1 : 0.75);
      out.pitch = clamp(inp.pitch * auth * invert, -1, 1);
      out.roll = clamp(inp.roll * auth, -1, 1);
      out.yaw = yaw;
      inp.trim = clamp(inp.trim, -0.45, 0.45);
      out.trim = inp.trim;
      this.holdStall(dt, inp, ac, invert);
      return;
    }
    const f = def.fcs;
    const onGround = ac.wheelsOnGround;
    // ---- commanded attitude ----
    const rollIn = inp.kbRoll, pitchIn = inp.kbPitch * invert;
    const mouseMoved = inp.mouseYoke && (inp.mdx !== 0 || inp.mdy !== 0);
    if (inp.mouseYoke) {
      this.cmdBank += inp.mdx * 0.10 * DEG * inp.mouseSens * 2;
      this.cmdPitch += inp.mdy * 0.04 * DEG * inp.mouseSens * 2 * invert;   // mouse back (down) = pull = nose up
    }
    if (Math.abs(rollIn) > 0.04) this.cmdBank += rollIn * f.bankRate * DEG * dt;
    else if (!mouseMoved) this.cmdBank = approach(this.cmdBank, 0, f.levelRate * DEG * dt);
    this.cmdBank = clamp(this.cmdBank, -f.maxBank * DEG, f.maxBank * DEG);
    // Low, power off: the pitch command moves at 70% rate. The flare is about precision, not snap (2026-09-10).
    const flare = !onGround && ac.radioAlt < f.flareH && ac.input.throttle < 0.25;
    this.cmdPitch += pitchIn * f.pitchRate * (flare ? 0.7 : 1) * DEG * dt;
    if (this.lastTrim != null) this.cmdPitch += (inp.trim - this.lastTrim) * 12 * DEG;
    this.lastTrim = inp.trim;
    // In the flare (low, power off) the airplane has to be held off deliberately: with no pull the
    // commanded attitude sinks slowly, so it settles onto the runway instead of skimming along in
    // ground effect until it stalls. Keep pulling and it holds off like a real flare.
    if (flare && Math.abs(pitchIn) < 0.04) this.cmdPitch = Math.max(this.cmdPitch - f.flareSink * DEG * dt, Math.min(this.cmdPitch, f.flareFloor * DEG));
    this.cmdPitch = clamp(this.cmdPitch, -15 * DEG, f.maxPitch * DEG);
    // ---- inner loops (gains scaled by dynamic pressure so the response feels the same at any speed) ----
    const V = Math.max(ac.ias, 8);
    const qr = clamp((V / (def.speeds.Vref * KT)) ** 2, 0.35, 3);
    const pitchErr = this.cmdPitch - ac.euler.pitch;
    // alpha awareness: the automatic pull backs off near the stall unless the pilot is deliberately hauling back
    const alphaMargin = ac.aero.alphaStall - 2.5 * DEG - ac.aero.alpha;
    const deliberate = pitchIn > 0.3;
    const nearStall = alphaMargin < 0 && !deliberate && !onGround;
    if (!nearStall) this.pitchInt = clamp(this.pitchInt + pitchErr * f.kiP * dt, -0.6, 0.6);
    else this.pitchInt = Math.max(this.pitchInt - 0.4 * dt, -0.6);
    let el = (pitchErr * f.kpP - ac.omega.x * f.kdP) / qr + this.pitchInt + pitchIn * f.ffP;
    if (nearStall) { el = Math.min(el, 0.15); this.cmdPitch = Math.min(this.cmdPitch, ac.euler.pitch); }
    const bankErr = this.cmdBank - ac.euler.roll;
    let ail = (bankErr * f.kpR + ac.omega.z * f.kdR) / qr + rollIn * f.ffR;   // roll rate p = -omega.z
    if (onGround) {
      // on the wheels: elevator direct (hold the nose off, taildragger technique), ailerons direct
      el = clamp(pitchIn * 0.9 + this.pitchInt * 0.4, -1, 1);
      ail = rollIn * 0.6;
      this.cmdPitch = ac.euler.pitch;
      this.cmdBank = 0;
    }
    out.pitch = clamp(el, -1, 1);
    out.roll = clamp(ail, -1, 1);
    out.trim = ac.failures.has('elevatorJam') ? clamp(el, -1, 1) : 0;
    // rudder: the pilot's pedals plus, in the air, what a real yaw damper / turn coordinator does (yaw pass,
    // 2026-09-14): rudder against the yaw rate in excess of a coordinated turn's g*tan(bank)/V (this is what
    // settles the Dutch roll; the old beta-only term added stiffness without damping), a little rudder toward
    // the relative wind, and an aileron-rudder interconnect that cancels most of the adverse yaw so a roll
    // input does not swing the nose the wrong way. Limited authority (+-35%), and it fades out as the pedals go
    // in (to 40% at full pedal, like a real damper's small authority), so a de-crab kick is the pilot's.
    let auto = 0;
    if (!onGround) {
      const Vt = Math.max(ac.tas, 8);
      const rCoord = (G * Math.tan(clamp(ac.euler.roll, -1.2, 1.2))) / Vt;   // yaw rate of a coordinated turn at this bank
      const rErr = -ac.omega.y - rCoord;                                     // r = -omega.y, yaw right positive
      const rud = def.Cndr * def.controls.rudderMax;
      const kYD = (f.yawDamp * Math.abs(def.Cnr) * def.span) / (2 * Vt * rud);      // rudder per rad/s: adds yawDamp x Cnr
      const kARI = (f.ari * -def.Cnda * def.controls.aileronMax) / rud;             // rudder per unit aileron
      auto = clamp(-kYD * rErr + f.coord * ac.aero.beta + kARI * out.roll, -0.35, 0.35) * (1 - 0.6 * Math.min(1, Math.abs(yaw)));
    }
    out.yaw = clamp(yaw + auto, -1, 1);
    this.holdStall(dt, inp, ac, invert);
  }

  // The Stall Recovery start (2026-09-15). The flight begins at a stall entry that "the previous pilot" keeps
  // holding - elevator back, the angle of attack held a few degrees past the break - until you push the nose
  // down or add power. Before this the trainer was dropped in already stalled and flew itself out of it in
  // under a second (its own stability plus the assist mode's stall protection), while the challenge title was
  // still on screen. While held, ac.stallHold is true and aircraft.js keeps those stalls out of the score.
  // Works in both control modes; the autopilot bypasses it.
  holdStall(dt, inp, ac, invert) {
    if (!ac.stallHold) { this.holdT = null; return; }
    const push = (inp.kbPitch || 0) * invert < -0.15 || (inp.pitch || 0) * invert < -0.15 || (inp.mouseYoke && (inp.mdy || 0) * invert < -0.5);
    if (push || ac.input.throttle > 0.15) {
      ac.stallHold = false; this.holdT = null;
      // take over from where the airplane is, with no leftover pull in the integrator (it would re-stall it)
      this.cmdPitch = ac.euler.pitch; this.cmdBank = ac.euler.roll; this.pitchInt = 0; this.lastTrim = null;
      return;
    }
    if (this.holdT == null) { this.holdT = 0; this.holdA0 = ac.aero.alpha; this.holdE0 = ac.ctl.elevator || 0; }
    this.holdT += dt;
    // the nose comes up over the first seconds (the horn, then the break) rather than being yanked into the stall
    const k = Math.min(1, this.holdT / STALL_HOLD_ENTRY);
    const target = this.holdA0 + (ac.aero.alphaStall + STALL_HOLD_PAST - this.holdA0) * k;
    ac.input.pitch = clamp((target - ac.aero.alpha) * STALL_HOLD_GAIN - ac.omega.x * 1.5 + this.holdE0 * (1 - k) + 0.45 * k, -0.2, 1);
    // direct mode has no wings-leveller of its own, so the previous pilot keeps the wings roughly level too, unless you roll
    if (this.mode === 'direct' && Math.abs(inp.roll || 0) < 0.1) ac.input.roll = clamp(-ac.euler.roll * 1.2 + ac.omega.z * 0.4, -1, 1);
  }
}
