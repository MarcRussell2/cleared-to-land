// Failure runtime: one per flight. It fires the scenario's failures when their triggers say so, announces
// them, and applies the effects that need NO flight-physics edit, from outside the aircraft:
//   preStep(dt, ac, inp)  runs after the flight control (and the debug autopilot) wrote ac.input and before
//                         the physics step: jammed or biased controls, runaway trim, a stuck throttle, flutter,
//                         per-engine partial power, per-leg faults, a hook that will not drop.
//   postStep(dt, ac)      runs after the step: `sensed` values for failed instruments (unreliable airspeed),
//                         `display` switches for the HUD and the cockpit (dark panel, no ball, a cracked
//                         windshield, the master caution), fire and smoke, the alarms.
//   action(name)          the keys that deal with a failure: fireHandle (A), trimCutout (D), fuelCutoff (U).
//   score(result, ...)    what a failure changes in the debrief (a belly landing asked for is not a fault), and
//   hint(ctx)             a failure's own hint: both reach main.js through the mission runtime (hookMission).
//   lens(mb)              the ball the carrier's lens shows (dark when it has failed; the LSO still sees the truth).
// main.js is the skeleton's: nothing here needs a line of its own there.
// Failures the aircraft itself models (engine, engineLeft/Right, flapsStuck, gearStuck, noseGear, elevatorJam,
// hydraulics, brakes, ice) still go through malfunctions.applyFailure -> ac.fail(); never edit the physics. The new
// ones (catalogue entries with `effect: true`) are the classes below; ac.fail() still records their names in
// ac.failures, so every reader of that Set (the hints, the cockpit) sees them.
//
// How an override works. The flight control rewrites ac.input.pitch/roll/yaw/throttle every frame, but the debug
// autopilot leaves trim alone and a scripted pilot may leave anything alone, so an override that ADDS to a channel
// must not add to its own last output. `_read()` takes the value somebody else wrote this frame, or, if nobody did,
// the value before our last change; the effects work on that copy (`w`) and `_write()` puts it back.
//
// Randomness from the flight seed only (makeRng(seed * 7919 + ...)); never Math.random(), never the rng that
// resolveScenario draws from. Nothing here allocates per frame after a failure has started (text is made again only
// when what it says changes; the one-off bursts - a strike, a burst tire - allocate when they happen).
import { applyFailure, shouldTrigger, FAILURES } from './malfunctions.js';
import { scoreLanding } from './scoring.js';
import { makeRng, clamp, lerp, KT, FT, DEG, RAD } from '../config.js';

const CHANNELS = ['pitch', 'roll', 'yaw', 'trim', 'throttle'];
const SEED_K = 7919, SEED_C = 211;   // this runtime's own stream: makeRng(seed * SEED_K + SEED_C + n)

// Which engine a spec means: an index, 'left'/'right', or by default the left one (the first one on a single).
function engineIndex(ac, spec) {
  const w = spec.engine ?? spec.side;
  if (typeof w === 'number') return clamp(w | 0, 0, ac.engines.length - 1);
  if (w === 'right') { const i = ac.engines.findIndex((e) => e.pos.x > 0.1); return i >= 0 ? i : ac.engines.length - 1; }
  const i = ac.engines.findIndex((e) => e.pos.x < -0.1);
  return i >= 0 ? i : 0;
}
function sideName(ac, i) { const x = ac.engines[i].pos.x; return ac.engines.length < 2 ? '' : x < -0.1 ? 'LEFT ' : x > 0.1 ? 'RIGHT ' : ''; }
function legIndex(ac, spec, rng) {
  const s = spec.leg ?? spec.side ?? (rng() < 0.5 ? 'left' : 'right');
  const i = ac.legs.findIndex((l) => l.name === s);
  return i >= 0 ? i : ac.legs.findIndex((l) => l.main);
}
// Spark bursts made every few frames while a stub or a rim scrapes (made once: nothing allocates per frame)
const SPARKS_STUB = { spread: 0.12, velSpread: 3, life: 0.55, lifeJitter: 0.5, size0: 0.1, size1: 0.04 };
const SPARKS_RIM = { spread: 0.1, velSpread: 3, life: 0.5, lifeJitter: 0.5, size0: 0.1, size1: 0.04 };
// A slow, smooth wander in -1..1 from two sines with seeded phases (no allocation, no state).
function wander(t, a, b) { return 0.6 * Math.sin(0.31 * t + a) + 0.4 * Math.sin(0.83 * t + b); }

// ------------------------------------------------------------------------------------------------------------------
// The effects. Each: constructor(rt, spec, ac), start(), pre(dt, ac, inp, w), post(dt, ac), action(name) -> bool,
// score(result, ac, approach) -> result, dispose(). Only what a class defines is called.

// The ailerons stick at a small deflection; the stick does nothing in roll. In the assist mode the flight control's
// yaw damper and aileron-rudder interconnect would go on adding rudder for a stick that moves nothing, so the rudder
// is the pilot's pedal alone (a real trainer has neither); the autopilot and a scripted pilot keep their own rudder.
class AileronJam {
  constructor(rt, spec) { this.rt = rt; this.jam = clamp(spec.arg ?? 0.08, -1, 1); }
  pre(dt, ac, inp, w) {
    w.roll = this.jam;
    if (this.rt.fcsFlying() && inp) w.yaw = clamp(inp.yaw || 0, -1, 1);
  }
}

// The rudder runs over to `arg` (default 0.3 of full) and holds there in the air, the pedals still moving it a
// little; on the wheels it lets go over a second and a half so nosewheel steering is not stuck with it.
class RudderJam {
  constructor(rt, spec) { this.bias = clamp(spec.arg ?? 0.3, -1, 1); this.free = 0; }
  pre(dt, ac, inp, w) {
    this.free = ac.wheelsOnGround ? Math.min(1, this.free + dt / 1.5) : Math.max(0, this.free - dt / 3);
    const k = this.free;
    w.yaw = clamp(this.bias * (1 - k) + w.yaw * (0.4 + 0.6 * k), -1, 1);
  }
}

// The pitch trim motor runs away (default nose down, 0.1 of elevator travel per second) until the pilot hits the
// cutout (D). After that the trim is a manual wheel: the trim keys wind the runaway back at a third of their speed,
// and nothing else they did before (the assist mode's attitude nudge, direct mode's electric trim) happens.
class RunawayTrim {
  constructor(rt, spec) { this.rt = rt; this.rate = spec.arg ?? -0.1; this.limit = spec.limit ?? 0.95; this.bias = 0; this.cut = false; this.held = null; this.lastW = null; this.heldW = 0; }
  start() { this.rt.setAction('trimCutout', 'TRIM CUT', 'trim cutout', 'D', true, this); this.rt.annun('STAB TRIM', 'bad'); }
  pre(dt, ac, inp, w) {
    if (!this.cut) this.bias = clamp(this.bias + this.rate * dt, -this.limit, this.limit);
    else if (this.rt.fcsFlying() && inp) {
      // The pilot's trim keys live in the Input (the assist mode nudges its attitude with them, direct mode uses them
      // as electric trim): each frame's movement turns the manual wheel instead, and the Input is put back. It is held
      // clear of the stops (the Input's +-1; direct mode's +-0.45), or a pilot who had trimmed to a stop - holding T
      // against the runaway, say - could not wind that way at all.
      const fcs = this.rt.game.fcs, direct = !!(fcs && fcs.mode === 'direct'), now = inp.trim || 0;
      let d = 0;
      if (this.held == null) {
        this.held = clamp(now, direct ? -0.4 : -0.9, direct ? 0.4 : 0.9);
        // direct mode: that trim is on the elevator, so what the hold takes off it goes onto the wheel (no jump)
        if (direct) this.bias = clamp(this.bias + now - this.held, -this.limit, this.limit);
        // assist mode: the flight control reads the trim keys as a change of the Input's trim from the last frame, so
        // it is told where the Input now sits, or it would take the hold for a trim input and nudge the attitude
        else if (fcs && 'lastTrim' in fcs) fcs.lastTrim = this.held;
      } else d = now - this.held;
      inp.trim = this.held;
      this.bias = clamp(this.bias + d * 0.35, -this.limit, this.limit);
      if (direct) w.trim = this.held + d;   // (the flight control copied the Input before the hold)
    } else {
      // an autopilot or a scripted pilot writes the trim channel itself: its movement turns the wheel
      if (this.lastW == null) { this.lastW = w.trim; this.heldW = w.trim; }
      const d = w.trim - this.lastW;
      this.lastW = w.trim;
      this.bias = clamp(this.bias + d * 0.35, -this.limit, this.limit);
      w.trim = this.heldW;
    }
    w.trim = clamp(w.trim + this.bias, -1.5, 1.5);
  }
  post(dt) {
    if (!this.cut) { this.rt.sound.clacker = 1; this.rt.cfgLine('STAB TRIM ▾ RUNAWAY', 'bad'); return; }
    // the wheel's position in the config box, in the trim line's own units; the text is made again only when it changes
    const k = Math.round(this.bias * 100);
    if (k !== this._k) { this._k = k; this._txt = `TRIM MAN ${k > 0 ? 'NU' : 'ND'} ${(Math.abs(k) / 10).toFixed(1)}`; }
    this.rt.cfgLine(this._txt, Math.abs(this.bias) > 0.15 ? 'moving' : 'on');
  }
  action(name) {
    if (name !== 'trimCutout' || this.cut) return false;
    this.cut = true;
    this.rt.clearAction('trimCutout', this);
    this.rt.clearAnnun('STAB TRIM');
    this.rt.say('Trim cutout.', 'TRIM CUTOUT', '');
    this.rt.later(this.rt.touchify('Manual trim: wind it back with T.'), 1.2);
    return true;
  }
}

// The throttles jam at `arg` (default: wherever the lever is when it happens). Fuel cutoff (U, the runtime's own
// cutFuel()) takes the lever to idle for the spool-down and then shuts every engine down (no reverse after that).
class StuckThrottle {
  constructor(rt, spec, ac) { this.rt = rt; this.jam = spec.arg != null ? clamp(spec.arg, 0, 1) : clamp(ac.input.throttle, 0, 1); this.txt = `THR JAMMED ${Math.round(this.jam * 100)}%`; }
  start() { this.rt.setAction('fuelCutoff', 'FUEL CUT', 'fuel cutoff', 'U', true, this); }
  get cut() { return this.rt.fuelCut; }
  pre(dt, ac, inp, w) { if (!this.rt.fuelCut) w.throttle = this.jam; }
  post() { if (!this.rt.fuelCut) this.rt.cfgLine(this.txt, 'bad'); }
  action(name) { return name === 'fuelCutoff' && this.rt.cutFuel(); }
}

// An engine gives `arg` (default 0.5) of its power. Per-instance numbers only (ac.def is shared: never touched);
// the gauges are told the same after the step.
class EnginePartial {
  constructor(rt, spec, ac) { this.rt = rt; this.i = engineIndex(ac, spec); this.f = clamp(spec.arg ?? 0.5, 0, 1); this.e = ac.engines[this.i]; this.orig = { maxThrust: this.e.maxThrust, maxPower: this.e.maxPower, staticThrust: this.e.staticThrust }; }
  start() { this.apply(this.f); }
  apply(k) { const e = this.e, o = this.orig; if (e.type === 'jet') e.maxThrust = o.maxThrust * k; else { e.maxPower = o.maxPower * k; e.staticThrust = o.staticThrust * k; } }
  post() { if (!this.e.failed) this.e.rpm *= 0.4 + 0.6 * this.f; }
  dispose() { this.apply(1); }
}

// An engine surges: every few seconds (seeded) its power sags to 1 - arg (default 0.6) with a bang, holds, and comes
// back. The fire handle (A) shuts it down for good.
class EngineSurge {
  constructor(rt, spec, ac, n) {
    this.rt = rt; this.i = engineIndex(ac, spec); this.sev = clamp(spec.arg ?? 0.6, 0, 1); this.base = clamp(spec.base ?? 1, 0, 1);
    this.e = ac.engines[this.i]; this.orig = { maxThrust: this.e.maxThrust, maxPower: this.e.maxPower, staticThrust: this.e.staticThrust };
    this.rng = makeRng(rt.seed * SEED_K + SEED_C + 31 + n);
    this.next = 1 + this.rng() * 2; this.t = 0; this.dip = 0; this.hold = 0; this.k = 1; this.shut = false;
  }
  start() { this.rt.setAction('fireHandle', 'ENG OFF', 'engine off', 'A', false, this); }
  pre(dt, ac) {
    if (this.shut || this.e.failed) return;
    this.t += dt;
    if (this.t >= this.next) {                              // a surge: bang, sag, hold, recover
      this.hold = 0.5 + this.rng() * 1.2; this.next = this.t + this.hold + 1.8 + this.rng() * 3.5; this.dip = 1;
      this.rt.sound.bang = Math.max(this.rt.sound.bang, 0.5 + 0.5 * this.sev); this.rt.bump(0.35 + 0.4 * this.sev);
    }
    if (this.hold > 0) this.hold -= dt; else this.dip = Math.max(0, this.dip - dt / 0.8);
    this.k = this.base * (1 - this.sev * this.dip);
    const e = this.e, o = this.orig;
    if (e.type === 'jet') e.maxThrust = o.maxThrust * this.k; else { e.maxPower = o.maxPower * this.k; e.staticThrust = o.staticThrust * this.k; }
  }
  post() {
    if (this.shut || this.e.failed) return;
    this.e.rpm *= 0.35 + 0.65 * this.k;
    this.rt.engNote(this.i, this.dip > 0.3 ? 'SURGE' : '');
    this.rt.shake = Math.max(this.rt.shake, 0.06 + 0.1 * this.sev);
  }
  action(name) {
    if (name !== 'fireHandle' || this.shut || this.e.failed) return false;
    this.shut = true; this.rt.shutEngine(this.i);
    this.rt.clearAction('fireHandle', this);
    this.rt.say(`${sideName(this.rt.ac, this.i).toLowerCase()}engine shut down.`, `${sideName(this.rt.ac, this.i)}ENGINE SHUT DOWN`, '');
    return true;
  }
  dispose() { const e = this.e, o = this.orig; e.maxThrust = o.maxThrust; e.maxPower = o.maxPower; e.staticThrust = o.staticThrust; }
}

// Fire. It grows from the moment it starts; `spec.burn` seconds later (default 32) the wing (or the cabin, on a
// single) is gone: a crash. At about 55% of that the engine itself seizes. The fire handle (A) shuts the engine
// down (the aircraft's own engine failure, so everything that knows about a dead engine knows) and puts it out.
// The flames and the smoke are the art bench's own particle pools (src/art/effects.js: fire, soot, blackSmoke),
// driven through their public emitter API from here; effects.js itself is not edited. Four emitters on the burning
// engine, all at rest in the air behind it (inherit 0), so at approach speed they draw a trail rather than a ball:
// a short yellow core at the nacelle, a longer orange flame around it, dense black smoke, and a grey trail that
// spreads behind (black alone disappears against a field seen from above; the grey reads on grass and on sky).
class EngineFire {
  constructor(rt, spec, ac) { this.rt = rt; this.i = engineIndex(ac, spec); this.burn = spec.burn ?? 32; this.t = 0; this.out = false; this.outT = 0; this.em = null; this.seized = false; }
  start() {
    this.rt.setAction('fireHandle', 'FIRE', 'fire handle', 'A', true, this);
    this.rt.annun(`${sideName(this.rt.ac, this.i)}ENG FIRE`, 'bad');
    this.emitters();
  }
  emitters() {
    const fx = this.rt.world && this.rt.world.effects, model = this.rt.game && this.rt.game.model;
    if (!fx || !model || !fx.fire || !fx.blackSmoke || !fx.soot) return;
    const e = this.rt.ac.engines[this.i];
    const jet = e.type === 'jet', R = jet ? 1 : 0.45, frame = model.group;
    // from the back of the nacelle (a jet) or out of the cowling (a prop), streaming aft and a little up
    const ex = model.anchors && model.anchors.exhaust && model.anchors.exhaust[this.i];
    const pos = ex ? ex.position.clone() : e.pos.clone();
    if (jet) pos.z -= 1.0;
    const anchor = { position: pos, direction: pos.clone().set(0, 0.12, 1).normalize(), radius: jet ? 0.55 : 0.3 };
    const base = { rate: 0, frame, anchor, inherit: 0 };
    this.em = {
      core: fx.fire.emitter({ ...base, speed: 4, speedSpread: 0.4, cone: 0.15, life: 0.12, lifeJitter: 0.3, size0: 0.5 * R, size1: 1.0 * R, tint: 0, alpha: 0.7 }),
      flame: fx.fire.emitter({ ...base, speed: 6, speedSpread: 0.5, cone: 0.25, life: 0.22, lifeJitter: 0.4, size0: 0.8 * R, size1: 1.8 * R, tint: 0.85, alpha: 0.5 }),
      black: fx.blackSmoke.emitter({ ...base, speed: 5, speedSpread: 0.5, cone: 0.25, life: 3, lifeJitter: 0.35, size0: 1.2 * R, size1: 7 * R, alpha: 1 }),
      grey: fx.soot.emitter({ ...base, speed: 4, speedSpread: 0.5, cone: 0.3, life: 4.5, lifeJitter: 0.3, size0: 2 * R, size1: 12 * R, tint: 1, alpha: 0.9 }),
    };
  }
  get severity() { return clamp(0.25 + 0.75 * this.t / this.burn, 0, 1); }
  pre(dt, ac) {
    if (this.out) return;
    this.t += dt;
    if (!this.seized && this.t > this.burn * 0.55) { this.seized = true; this.rt.shutEngine(this.i); this.rt.say('', `${sideName(ac, this.i)}ENGINE SEIZED`, 'bad'); }
    if (this.t >= this.burn && !ac.crashed) ac.crash(ac.engines.length > 1 ? 'Engine fire: the wing burned through' : 'Engine fire: it reached the cabin');
  }
  post(dt, ac) {
    const m = this.em;
    if (this.out) {
      // the handle pulled: the flame is gone at once, the smoke thins out over a few seconds
      this.outT += dt;
      if (m) { const k = clamp(1 - this.outT / 6, 0, 1); m.core.rate = 0; m.flame.rate = 0; m.black.rate = 30 * k * k; m.grey.rate = 30 * k; m.grey.alpha = 0.6 * k; }
      return;
    }
    const s = this.severity, on = ac.crashed ? 0 : 1, R = ac.engines[this.i].type === 'jet' ? 1 : 0.45;
    if (m) {   // (fields written directly: Emitter.set() would take a new object every frame)
      m.core.rate = on * (320 + 160 * s); m.core.size1 = 1.0 * R * (0.8 + 0.4 * s);
      m.flame.rate = on * (160 + 120 * s); m.flame.size1 = 1.8 * R * (0.7 + 0.7 * s); m.flame.life = 0.16 + 0.16 * s;
      m.black.rate = on * (50 + 70 * s);
      m.grey.rate = on * (25 + 30 * s);
    }
    this.rt.sound.bell = 1;
    this.rt.engNote(this.i, 'FIRE');
    this.rt.warnLight = true;
    if (s > 0.6) this.rt.shake = Math.max(this.rt.shake, 0.08 * s);
  }
  action(name) {
    if (name !== 'fireHandle' || this.out) return false;
    this.out = true;
    this.rt.shutEngine(this.i, true);
    this.rt.clearAction('fireHandle', this); this.rt.clearAnnun(`${sideName(this.rt.ac, this.i)}ENG FIRE`);
    this.rt.say('Fire handle pulled. Fire out.', 'FIRE OUT', '');
    return true;
  }
  dispose() { if (this.em) for (const k in this.em) this.em[k].rate = 0; }
}

// Bird strike: a thud, feathers, the windshield cracks (a decal on the pane in front of the pilot, drawn by
// src/cockpit.js from crackPattern() below; the runtime asked for it to be made at the start of the flight, so the
// strike costs a canvas upload and no shader compile), and the bird that went down an engine leaves it at `arg`
// (default 0.75) of its power and surging. A surge you can shut down with the fire handle (A).
class BirdStrike {
  constructor(rt, spec, ac, n) {
    this.rt = rt; this.spec = spec;
    this.surge = new EngineSurge(rt, { engine: spec.engine ?? 'left', arg: spec.surge ?? 0.55, base: spec.arg ?? 0.75 }, ac, n + 1);
  }
  start() {
    const rt = this.rt, ac = rt.ac;
    rt.sound.thud = 1.8; rt.bump(1.2);
    rt.display.crack = true;
    const cv = rt.game && rt.game.cockpitView;
    if (cv && cv.showCrack) cv.showCrack(crackPattern(makeRng(rt.seed * SEED_K + SEED_C + 7)));
    const fx = rt.world && rt.world.effects;
    if (fx && fx.smoke) {   // feathers and down: a light burst at the nose, carried off by the airflow
      const p = ac.pos.clone().addScaledVector(ac.fwd, ac.def.span * 0.35).addScaledVector(ac.up, 0.6), v = ac.vel.clone().multiplyScalar(0.55);
      fx.smoke.burst(p, v, 26, { spread: 1.2, velSpread: 5, life: 1.8, size0: 0.3, size1: 1.6, alpha: 0.9 });
      if (fx.dust) fx.dust.burst(p, v, 8, { spread: 0.8, velSpread: 4, life: 1.2, size0: 0.15, size1: 0.6 });
    }
    this.surge.start();
  }
  pre(dt, ac, inp, w) { this.surge.pre(dt, ac, inp, w); }
  post(dt, ac) { this.surge.post(dt, ac); }
  action(name) { return this.surge.action(name); }
  dispose() { this.surge.dispose(); }
}

// The pitot ices: the airspeed reads low, sliding to `arg` (default 0.62) of the truth over ~`tau` s with a slow
// wander, and nothing says so. The flight model, the stall warning, the flight control and the score keep the true
// value; the HUD tape and the cockpit's airspeed show `sensed.ias`. A jet has two airspeed systems to compare, so
// once they disagree by more than 12 kt for 4 s it says IAS DISAGREE; a light airplane never does.
class PitotIce {
  constructor(rt, spec) { this.rt = rt; this.f = clamp(spec.arg ?? 0.62, 0.2, 1.2); this.tau = spec.tau ?? 18; this.t = 0; this.dis = 0; this.said = false; const r = makeRng(rt.seed * SEED_K + SEED_C + 53); this.a = r() * 6.28; this.b = r() * 6.28; }
  start() { this.rt.sensedOn(); }
  post(dt, ac) {
    this.t += dt;
    const ramp = 1 - Math.exp(-this.t / this.tau);
    const s = ac.ias * (1 - (1 - this.f) * ramp) + wander(this.t, this.a, this.b) * 3 * KT * ramp;
    this.rt.sensed.ias = Math.max(0, s);
    if (ac.def.engines[0].type === 'jet') {
      this.dis = Math.abs(s - ac.ias) > 12 * KT ? this.dis + dt : 0;
      if (this.dis > 4 && !this.said) { this.said = true; this.rt.caution('caution', 'IAS DISAGREE'); this.rt.annun('IAS DISAGREE', 'warn'); this.rt.display.iasFlag = true; this.rt.activeName('IAS disagree'); }
    }
  }
}

// The electrics die: the HUD goes dark but for a standby airspeed and altimeter (and the status line with its
// distance, which is a DME), the panel loses its lights (src/cockpit.js dims every interior light to what daylight
// alone would give it while s.power is 0) and its radio faces go blank, the ILS needles drop, the radio altimeter's
// calls stop (audio-alarms.js silence(), hud.js callout()), the landing light and the navigation lights go out.
// The airplane's own steam gauges and the stall horn need no electricity, so they carry on.
class Electrical {
  constructor(rt) { this.rt = rt; this.light = null; this.max = 0; this.nav = null; }
  start() {
    const rt = this.rt;
    rt.display.dark = true; rt.power = 0;
    if (rt.audio && rt.audio.alarms) rt.audio.alarms.dark = true;
    const m = rt.game && rt.game.model, p = m && m.parts;
    // models.js sets the landing light's intensity to userData.max below 600 ft with the gear down: max 0 keeps it
    // dark without hiding the light (a light switched invisible recompiles every lit shader in the scene)
    const L = p && p.landingLight;
    if (L && L.userData) { this.light = L; this.max = L.userData.max; L.userData.max = 0; }
    // the navigation lights, beacon and strobes are one Points object (not a light: hiding it recompiles nothing)
    const nav = p && p.lights && p.lights.points;
    if (nav) { this.nav = nav; nav.visible = false; }
  }
  dispose() {
    if (this.light) this.light.userData.max = this.max; if (this.nav) this.nav.visible = true;
    if (this.rt.audio && this.rt.audio.alarms) this.rt.audio.alarms.dark = false;
  }
}

// The gear will not come down (or up: it goes up and stays there). Belly landing: the mission's scoring.belly says
// that is the job, not a fault (scoreBelly below); the fuel cutoff (U, the runtime's cutFuel()) is part of the drill.
// Fired before the first frame (a 'start' trigger, as Free Flight deals it) the gear is simply up from the start
// rather than seen folding away; G says it is unsafe instead of the usual GEAR DOWN.
class GearUp {
  constructor(rt) { this.rt = rt; }
  start() {
    const ac = this.rt.ac;
    if (this.rt.t === 0) { ac.input.gearCmd = 0; ac.ctl.gear = 0; for (const l of ac.legs) if (l.stuckAt == null) l.ext = 0; }
    this.rt.setAction('fuelCutoff', 'FUEL CUT', 'fuel cutoff', 'U', false, this);
  }
  get cut() { return this.rt.fuelCut; }
  pre(dt, ac) { ac.input.gearCmd = 0; }
  post() { this.rt.cfgLine('GEAR UNSAFE', 'bad'); }
  action(name) {
    if (name === 'gear') { this.rt.say('', 'GEAR UNSAFE: IT WILL NOT COME DOWN', 'bad'); return true; }
    return name === 'fuelCutoff' && this.rt.cutFuel();
  }
  // (Free Flight has no mission hint, and the game's own would say "Gear down: press G")
  hint(ctx) { return ctx.ac.onGround ? null : 'Gear up for good: belly landing. Full flaps, slow, wings level, cut the fuel (press U) in the flare.'; }
}

// scoring.belly (a mission that asks for a belly landing; this area owns the flag): the landing is scored again with
// the belly taken off the damage list, and so is everything a gear-up airliner touches on the way down - the engine
// pods first, then the nose as it comes down, and the tail if it sits back - since a belly landing asked for is the
// job, not a fault. One line says whether the engines were still running when it touched (a fire risk: -10).
// scoring.js is not edited: it is handed a view of the aircraft whose stats say so.
const BELLY_EXCUSED = ['Belly landing', 'Engine nacelle scraped', 'Tail strike', 'Nose damage'];
export function scoreBelly(result, ac, approach, sc, running) {
  if (ac.crashed || !ac.stats.touchdown) return result;
  const st = ac.stats;
  const view = Object.create(ac);
  view.stats = { ...st, belly: false, tailstrike: false, damage: st.damage.filter((d) => !BELLY_EXCUSED.includes(d)) };
  const r = scoreLanding(view, sc, approach);
  if (!st.belly && !st.damage.includes('Engine nacelle scraped')) return result;   // it landed on its wheels after all
  for (const l of r.lines) if (l.k === 'Attitude') { l.v = `${(st.touchdown.pitch * RAD).toFixed(1)}° pitch, on the belly`; l.cls = 'good'; }
  let pts = r.points;
  r.lines.push({ k: 'Belly landing', v: running ? 'engines still running when it touched  (-10)' : 'engines shut down before contact', cls: running ? 'warn' : 'good' });
  if (running) pts -= 10;
  r.points = clamp(Math.round(pts), 0, 100);
  return r;
}

// One main wheel is not there. A retractable leg stays up (stuckAt 0: that side lands on its engine pod or wing); on
// fixed gear the wheel came off and the leg ends in a stub: it touches lower down, scrapes instead of rolling (and
// throws sparks), pulls the nose toward its side, and has no brake. models.js hides the tire (leg.wheelOff); the
// fairing stays, its lower edge where the stub touches. score() says how slow the wing was held up. The pull is a
// rudder bias: the stand-in for a per-leg rolling drag the flight model does not have.
class OneMainStuck {
  constructor(rt, spec, ac) {
    this.rt = rt; this.i = legIndex(ac, { leg: spec.leg ?? 'left' }, makeRng(1)); this.leg = ac.legs[this.i];
    this.side = this.leg.pos.x < 0 ? -1 : 1; this.heldTo = null; this.pull = spec.pull ?? 0.3; this.t = 0;
    this.tip = ac.points.find((p) => p.name === (this.side < 0 ? 'wingtipL' : 'wingtipR')) || null;
    this.nacelle = ac.points.find((p) => p.name === (this.side < 0 ? 'nacelleL' : 'nacelleR')) || null;
  }
  start() {
    const l = this.leg, ac = this.rt.ac;
    if (ac.def.gearRetract) l.stuckAt = 0;
    else { l.radius *= 0.2; l.mu = 0.55; l.brake = false; l.wheelOff = true; }
  }
  pre(dt, ac, inp, w) {
    if (!this.leg.contact || this.leg.stuckAt === 0) return;
    const load = clamp(this.leg.load / (ac.mass * 9.81 * 0.5), 0, 1.2);
    w.yaw = clamp(w.yaw + this.side * this.pull * load * clamp(ac.gs / 12, 0.25, 1), -1, 1);
  }
  post(dt, ac) {
    const l = this.leg;
    if (l.wheelOff && l.contact && ac.gsRel > 4) {   // the bare axle in its fairing, scraping: sparks (effects.js's own pool)
      const fx = this.rt.world && this.rt.world.effects;
      this.t += dt;
      if (fx && fx.sparks && this.t > 0.05) {
        this.t = 0;
        const p = this.rt._v.copy(l.pos).applyQuaternion(ac.quat).add(ac.pos); p.y -= l.radius;
        const v = this.rt._v2.copy(ac.vel).multiplyScalar(0.25); v.y += 1.5;
        fx.sparks.burst(p, v, 4, SPARKS_STUB);
      }
    }
    if (this.heldTo != null || !ac.stats.touchdown) return;
    const tip = this.tip, nacelle = this.nacelle;
    if (l.contact || (tip && tip.contact) || (nacelle && nacelle.contact) || ac.stopped) this.heldTo = ac.gs;
  }
  score(result, ac, approach, rt) {
    if (ac.crashed || !ac.stats.touchdown) return result;
    let r = result;
    const nac = 'Engine nacelle scraped';
    if (ac.def.gearRetract && ac.stats.damage.includes(nac)) {   // on a jet the pod on that side is what it lands on
      const view = Object.create(ac);
      view.stats = { ...ac.stats, damage: ac.stats.damage.filter((d) => d !== nac) };
      r = scoreLanding(view, rt.sc, approach);
      r.lines.push({ k: 'Engine pod', v: 'scraped on the missing gear\'s side (expected)', cls: 'good' });
    }
    // The wheel's spring rolls the airplane onto the stub within a second or two of touching down (the ailerons cannot
    // hold a wheel's worth of weight), so what the pilot controls is how slowly that happens: land at the stall.
    const wing = this.side < 0 ? 'Left' : 'Right';
    // (a flight ended with that wing still up - a touch and go, or End flight while still rolling on one wheel - says so)
    if (this.heldTo == null) { r.lines.push({ k: `${wing} wing`, v: 'still up when the flight ended', cls: '' }); return r; }
    const v = this.heldTo / KT, vs0 = ac.def.speeds.Vs0 * Math.sqrt(ac.mass / ac.def.mass);
    const pp = Math.min(10, Math.round(Math.max(0, v / vs0 - 1.05) * 40));
    r.lines.push({ k: `${wing} wing held up until`, v: `${v.toFixed(0)} kt` + (pp ? `  (-${pp})` : '  nicely done'), cls: pp > 6 ? 'warn' : 'good' });
    r.points = clamp(r.points - pp, 0, 100);
    return r;
  }
}

// A main tire bursts the first time its wheel takes weight (or at once, if already rolling): a bang, the wheel runs
// on the rim (smaller, less grip, no brake), and it drags the nose toward its side (a rudder bias, as above).
class BlownTire {
  constructor(rt, spec, ac) { this.rt = rt; this.i = legIndex(ac, spec, makeRng(rt.seed * SEED_K + SEED_C + 71)); this.leg = ac.legs[this.i]; this.side = this.leg.pos.x < 0 ? -1 : 1; this.gone = false; this.t = 0; this.pull = spec.pull ?? 0.22; }
  pre(dt, ac, inp, w) {
    const l = this.leg;
    if (!this.gone && l.contact && l.load > 0) this.burst(ac);
    if (!this.gone || !l.contact) return;
    w.yaw = clamp(w.yaw + this.side * this.pull * clamp(ac.gs / 25, 0.2, 1), -1, 1);
  }
  burst(ac) {
    const l = this.leg;
    this.gone = true; l.radius *= 0.55; l.mu = (l.mu || 1) * 0.6; l.brake = false;
    const rt = this.rt;
    rt.sound.bang = 1.2; rt.bump(0.6);
    rt.say('', `${l.name.toUpperCase()} TIRE BURST`, 'warn');
    rt.activeName('Blown tire');
    const fx = rt.world && rt.world.effects;
    if (fx && fx.smoke) {
      const p = l.pos.clone().applyQuaternion(ac.quat).add(ac.pos), v = ac.vel.clone().multiplyScalar(0.3);
      fx.smoke.burst(p, v, 14, { spread: 0.5, velSpread: 3, life: 2.5, size0: 0.6, size1: 4 });
    }
  }
  post(dt, ac) {
    if (!this.gone || !this.leg.contact || ac.gsRel < 4) return;
    const fx = this.rt.world && this.rt.world.effects;
    this.t += dt;
    if (fx && fx.sparks && this.t > 0.05) {   // the rim on the asphalt
      this.t = 0;
      const p = this.rt._v.copy(this.leg.pos).applyQuaternion(ac.quat).add(ac.pos); p.y -= this.leg.radius;
      const v = this.rt._v2.copy(ac.vel).multiplyScalar(0.2); v.y += 1.5;
      fx.sparks.burst(p, v, 3, SPARKS_RIM);
    }
  }
}

// Flutter: a buzz through the stick and the airframe that grows with airspeed above `onset` (default 1.12 Vref) and
// fades below it. Small seeded noise on pitch and roll (the actuators filter it into a shudder), shake, a hum.
class Flutter {
  constructor(rt, spec, ac) { this.rt = rt; this.sev = clamp(spec.arg ?? 0.7, 0, 1); this.onset = (spec.onset ?? ac.def.speeds.Vref * 1.12) * KT; this.t = 0; const r = makeRng(rt.seed * SEED_K + SEED_C + 97); this.p = [r() * 6.28, r() * 6.28, r() * 6.28, r() * 6.28]; this.level = 0; }
  pre(dt, ac, inp, w) {
    this.t += dt;
    const target = this.sev * clamp((ac.ias - this.onset * 0.92) / (this.onset * 0.2), 0, 1);
    this.level += (target - this.level) * Math.min(1, dt * 1.5);
    const t = this.t, L = this.level, p = this.p;
    w.pitch = clamp(w.pitch + L * 0.22 * (Math.sin(t * 47 + p[0]) * 0.7 + Math.sin(t * 29 + p[1]) * 0.3), -1, 1);
    w.roll = clamp(w.roll + L * 0.3 * (Math.sin(t * 53 + p[2]) * 0.7 + Math.sin(t * 31 + p[3]) * 0.3), -1, 1);
  }
  post() { this.rt.shake = Math.max(this.rt.shake, this.level * 0.45); this.rt.sound.buzz = Math.max(this.rt.sound.buzz, this.level); if (this.level > 0.1) this.rt.cfgLine('FLUTTER: SLOW DOWN', 'bad'); }
}

// The carrier's lens goes dark: the HUD ball and the 3D lens show nothing, while the LSO, who can see where you are,
// talks you down more often than usual. Paddles judges the trend, not the deck's every heave (the ball is smoothed
// over a second and a half), and in close only says what matters. The 3D lens: main.js hands the carrier's
// updateLens() the true ball every frame, so start() puts this flight's own updateLens on that carrier instance, which
// passes the ball through rt.lens() first (dark), and dispose() takes it off again; carrier.js is not edited.
class LensFail {
  constructor(rt) { this.rt = rt; this.said = -10; this.last = ''; this.cells = null; this.lensHook = null; }
  start() {
    const rt = this.rt;
    rt.display.noBall = true;
    // the green datum bars go dark with the ball (carrier.js lights them once and never writes them again)
    const cv = rt.world && rt.world.carrier;
    if (cv && cv.lensSet && cv.datum) for (const i of cv.datum) cv.lensSet.setColor(i, 0, 0, 0);
    if (cv && typeof cv.updateLens === 'function') {
      const own = Object.prototype.hasOwnProperty.call(cv, 'updateLens'), orig = cv.updateLens;
      cv.updateLens = (mb, t) => orig.call(cv, rt.lens(mb), t);
      this.lensHook = { cv, own, orig };
    }
    if (rt.game && rt.game.calloutState) rt.game.calloutState.rogerBall = true;   // nobody will call the ball
    rt.later('Paddles contact. The lens is down. Fly your numbers, I will talk you in.', 0.3, true);
  }
  post(dt, ac) {
    const rt = this.rt, g = rt.game, mb = rt.meatball || (g && g.meatball);
    if (!mb || !mb.inRange || ac.onGround || ac.crashed) { this.cells = null; return; }
    this.cells = this.cells == null ? mb.cells : this.cells + (mb.cells - this.cells) * Math.min(1, dt / 1.5);
    const t = g ? g.t : rt.t, cs = (g && g.calloutState) || this.cs || (this.cs = {});
    if (t - this.said < 2.6 || (cs.gsSaid && t - cs.gsSaid < 1.5) || mb.range > 1500) return;
    const c = this.cells, close = mb.range < 300;
    let call = '';
    if (c < -1.4) call = c < -2.4 ? 'Power! Power!' : 'Power.';
    else if (c < -0.8) call = 'A little power.';
    else if (c > 1.8) call = close ? 'Don\'t go high.' : 'You are high. Ease it down.';
    else if (c > 0.9 && !close) call = 'A little high.';
    else if (Math.abs(mb.dl.v) > 6) call = mb.dl.v > 0 ? 'Come left.' : 'Come right.';
    else if (close) call = 'Keep it coming.';
    else if (t - this.said > 6) call = 'Looking good.';
    if (!call || (call === this.last && t - this.said < 5)) return;
    this.said = t; this.last = call; cs.gsSaid = t;
    rt.lso.call = call; rt.lso.t = t;
    rt.say(call, '', '', true);
    if (rt.hud) rt.hud.callout(call.replace(/\.$/, '').toUpperCase(), 1.6);
  }
  dispose() {
    const h = this.lensHook;
    if (!h) return;
    if (h.own) h.cv.updateLens = h.orig; else delete h.cv.updateLens;
    this.lensHook = null;
  }
}

// The hook will not come down: up from the start if it fires before the first frame (as GearUp), H says so.
class HookFail {
  constructor(rt) { this.rt = rt; }
  start() { const ac = this.rt.ac; if (this.rt.t === 0) { ac.input.hookCmd = 0; ac.ctl.hook = 0; } }
  pre(dt, ac) { ac.input.hookCmd = 0; }
  action(name) { if (name !== 'hook') return false; this.rt.say('', 'HOOK UNSAFE: IT WILL NOT COME DOWN', 'bad'); return true; }
  hint(ctx) { return ctx.ac.onGround ? null : 'No hook, no trap: fly the pass, touch down, full power and take the bolter.'; }
}

const EFFECTS = {
  aileronJam: AileronJam, rudderJam: RudderJam, runawayTrim: RunawayTrim, stuckThrottle: StuckThrottle,
  enginePartial: EnginePartial, engineSurge: EngineSurge, engineFire: EngineFire, birdStrike: BirdStrike,
  pitotIce: PitotIce, electrical: Electrical, gearUp: GearUp, oneMainStuck: OneMainStuck, blownTire: BlownTire,
  flutter: Flutter, lensFail: LensFail, hookFail: HookFail,
};
export const EFFECT_NAMES = Object.keys(EFFECTS);

// A cracked windshield, as data: src/cockpit.js draws it into the decal it lays on the pane in front of the pilot.
// Unit coordinates with the impact at (0, 0) and the decal's edges at +-1 (y down, as on a canvas): a frosted star
// at the impact, long radial cracks that wander and fork and die out before the decal's edge, a few arcs between
// them, and a smear of the bird. Plain numbers, no DOM, so it is tested in Node. Seeded: the same flight, the same crack.
export function crackPattern(rng) {
  const paths = [], arcs = [];
  const n = 11 + Math.floor(rng() * 5);
  for (let i = 0; i < n; i++) {
    let a = (i / n) * Math.PI * 2 + (rng() - 0.5) * 0.45, x = 0, y = 0;
    const len = 0.22 + rng() * (i % 3 === 0 ? 0.68 : 0.42);
    const pts = [0, 0];
    for (let l = 0; l < len;) {
      const step = 0.025 + rng() * 0.045; l += step;
      a += (rng() - 0.5) * 0.32;
      x += Math.cos(a) * step; y += Math.sin(a) * step;
      pts.push(x, y);
      if (rng() < 0.12) {   // a fork
        const b = a + (rng() < 0.5 ? -1 : 1) * (0.35 + rng() * 0.4), fl = 0.05 + rng() * 0.15;
        paths.push({ pts: [x, y, x + Math.cos(b) * fl, y + Math.sin(b) * fl], w: 0.8 });
      }
    }
    paths.push({ pts, w: 1 + rng() * 0.8 });
  }
  for (let k = 0; k < 3; k++) {
    const r = 0.05 + k * (0.05 + rng() * 0.035);
    const a0 = rng() * 6.28, a1 = a0 + 0.8 + rng() * 2.2;
    const pts = [];
    for (let a = a0; a <= a1; a += 0.2) { const rr = r * (0.9 + rng() * 0.2); pts.push(Math.cos(a) * rr, Math.sin(a) * rr); }
    arcs.push(pts);
  }
  return { paths, arcs, smear: { rx: 0.2, ry: 0.11, rot: (rng() * 40 - 20) * DEG, dy: 0.02 } };
}

// ------------------------------------------------------------------------------------------------------------------
export class FailureRuntime {
  constructor(ac, sc, { seed = 1, hud = null, audio = null, rig = null, input = null, world = null, touch = null, game = null, touchify = (s) => s } = {}) {
    this.ac = ac; this.sc = sc; this.seed = seed;
    this.hud = hud; this.audio = audio; this.rig = rig; this.input = input; this.world = world; this.touch = touch; this.game = game;
    this.touchify = touchify;
    // `at` is copied too: a 'window' trigger writes the moment it drew into it, and the scenario is shared
    this.pending = (sc.failures || []).map((f) => ({ ...f, at: f.at ? { ...f.at } : { type: 'start' } }));
    // Free Flight deals every failure a random altitude and an arg of 0 (scenarios.js makeFreeFlight, which suits the
    // first ten). The new ones take their own defaults there, and the moment the catalogue gives them (freeAt).
    if (sc.id === 'free') for (const f of this.pending) {
      const c = FAILURES[f.name];
      if (!c || !c.effect) continue;
      delete f.arg;
      if (c.freeAt) f.at = { ...c.freeAt };
    }
    const rng = makeRng(seed * SEED_K + SEED_C);
    for (const f of this.pending) if (f.at.type === 'window') { const a = f.at.from || 0, b = f.at.to ?? a; f.at.when = a + rng() * Math.max(0, b - a); }
    this.active = [];          // display names, for the HUD failure chips
    this.sensed = null;        // instrument readings that differ from the truth (null = instruments are honest)
    this.display = null;       // HUD / cockpit switches (null = everything works)
    this.fx = [];              // the running effects (the classes above)
    this.t = 0;
    this.power = 1;            // electrical power, for the cockpit (0 = dead)
    this.fuelCut = false;      // the fuel cutoff (cutFuel): the levers to idle, and 2.5 s later the engines stop
    this.fuelCutT = 0;
    this.runAtContact = null;  // were the engines running at the first touch of the ground? (scoring.belly)
    this._offRpm = [0, 0, 0, 0];   // what the gauges of an engine shut off by the fuel cutoff read as it runs down
    this._due = [];            // callouts due on SIM time ({ delay, at, text, voice, hint }): postStep says them, so they
                               // wait out a pause and land on time in a stepped harness (a wall-clock timer did neither)
    this._shadow = {}; for (const k of CHANNELS) this._shadow[k] = { base: 0, out: NaN };
    this._w = { pitch: 0, roll: 0, yaw: 0, trim: 0, throttle: 0 };
    this._sensed = { ias: 0 };
    this._display = {
      dark: false, noBall: false, crack: false, iasFlag: false,
      caution: { level: '', text: '', blink: 0 }, annun: [], cfg: [], engNote: ['', '', '', ''], engOff: [false, false, false, false],
    };
    this._actions = [];        // [{ a, label, name, key, hot }] for the touch buttons and the key strip
    this._actionsKey = '';
    this.sound = { bell: 0, clacker: 0, buzz: 0, bang: 0, thud: 0 };
    this.shake = 0; this.warnLight = false;
    this._v = ac.pos.clone(); this._v2 = ac.pos.clone();
    this._dark = { inRange: false, cells: 0, waveoff: false, range: 0, dl: null, dev: 0 };
    this.meatball = null;      // a harness without main.js hands the true ball in here (main.js keeps game.meatball)
    this.lso = { call: '', t: -10 };   // Paddles' last call (the lens failure): what a scripted pilot listens to
    this._fuelArmT = 0;        // the fuel cutoff's guard: > 0 while a first press above 300 ft waits for the second
    this._lines = new WeakSet();   // the debrief lines score() has handed back (it applies itself once per result)
    this._mission = null;      // the mission runtime this one has hooked into (hookMission)
    if (game && game.cockpitView) {
      const cv = game.cockpitView;
      cv.failView = this;
      // a bird strike cracks the windshield, dead electrics blank the radio faces: what they draw is made now, not yet
      // showing, so it compiles with the rest of the interior
      if (this.pending.some((f) => f.name === 'birdStrike') && cv.prepareCrack) cv.prepareCrack(ac.def, makeRng(seed * SEED_K + SEED_C + 13));
      if (this.pending.some((f) => f.name === 'electrical') && cv.prepareDeadDisplays) cv.prepareDeadDisplays(ac.def);
    }
    if (touch && touch.setFailureButtons) touch.setFailureButtons([]);
    if (hud && hud.setExtraKeys) hud.setExtraKeys([]);
    if (hud && hud.clearFailureDisplay) hud.clearFailureDisplay();
  }

  // main.js makes the mission runtime right after this one and asks it, not this, for the debrief and the hints. On the
  // first check() this runtime puts its own score() and hint() in front of that instance's (mission.js is not edited):
  // the mission's lines come on top of what the failures changed (a belly landing asked for is not damage), and its
  // hints come first, this runtime's (a failure's own, where the game's would mislead: "Gear down: press G" with the
  // gear gone) only where it has none. dispose() takes them off again.
  hookMission() {
    const m = this.game && this.game.mission;
    if (!m || this._mission || typeof m.score !== 'function') return;
    const own = (k) => Object.prototype.hasOwnProperty.call(m, k);
    const score = m.score, hint = m.hint;
    this._mission = { m, score, hint, ownScore: own('score'), ownHint: own('hint') };
    m.score = (result, ac, approach) => score.call(m, this.score(result, ac, approach), ac, approach);
    if (typeof hint === 'function') m.hint = (ctx) => hint.call(m, ctx) || this.hint(ctx);
  }

  // Is the pilot flying through the flight control (not the debug autopilot, not a scripted pilot)?
  fcsFlying() { return !!(this.game && !this.game.ap); }
  // A running effect by failure name (mission hints and the scripted pilots read its state), or null.
  get(name) { for (const f of this.fx) if (f.name === name) return f; return null; }
  // Has this failure fired yet (effect or not)?
  fired(name) { return this.ac.failures.has(name); }

  // Fire whatever is due. ctx = { t, distToThreshold } from main.js; the gate count comes from the mission runtime.
  check(ac, ctx) {
    if (!this._mission && this.game && this.game.mission) this.hookMission();
    if (this.game && this.game.mission && this.game.mission.gatesPassed != null) ctx.gatesPassed = this.game.mission.gatesPassed;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const f = this.pending[i];
      if (shouldTrigger(f, ac, ctx)) { this.pending.splice(i, 1); this.trigger(f); }
    }
  }

  trigger(spec) {
    const info = applyFailure(this.ac, spec);
    const E = EFFECTS[spec.name];
    const silent = spec.silent ?? info.silent;
    if (E) this.display = this._display;   // (the first ten leave the HUD and the cockpit exactly as they were)
    if (!silent) this.active.push(info.name);
    if (E) {
      const fx = new E(this, spec, this.ac, this.fx.length * 10);
      fx.name = spec.name;
      this.fx.push(fx);
      if (fx.start) fx.start();
    }
    if (!silent) this.announce(info, spec);
    else if (this.hud) this.hud.setFailures(this.active);
    return info;
  }

  announce(info, spec) {
    const hud = this.hud, audio = this.audio;
    if (hud) { hud.setFailures(this.active); hud.message(info.msg, 'bad', 4); }
    // the new failures light the master caution (or warning) with its chime; the first ten keep their beep and nothing more
    if (info.effect) this.caution(info.warning ? 'warning' : 'caution', info.msg);
    else if (audio) audio.beep(520, 0.4);
    if (info.hint && hud) {
      // 0.8 s after the warning; a newer failure's hint replaces one still waiting
      for (let i = this._due.length - 1; i >= 0; i--) if (this._due[i].hint) this._due.splice(i, 1);
      this._due.push({ delay: 0.8, at: null, text: this.touchify(info.hint), voice: false, hint: true });
    }
    if (audio && this.power) audio.say('Warning. ' + info.name.toLowerCase(), true);
  }

  // The master caution (amber) or warning (red): it flashes for a few seconds with its chime or bell.
  caution(level, text) {
    const c = this._display.caution;
    c.level = level; c.text = text; c.blink = 4;
    this.display = this._display;
    if (this.audio && this.audio.alarms && this.power) this.audio.alarms.chime(level === 'warning' ? 2 : 1);
  }
  annun(text, cls) { const a = this._display.annun; if (!a.some((x) => x.text === text)) a.push({ text, cls }); this.display = this._display; }
  clearAnnun(text) { const a = this._display.annun; const i = a.findIndex((x) => x.text === text); if (i >= 0) a.splice(i, 1); }
  cfgLine(text, cls) { const c = this._display.cfg; if (this._cfgN < c.length) { c[this._cfgN].text = text; c[this._cfgN].cls = cls; } else c.push({ text, cls }); this._cfgN++; }
  engNote(i, s) { this._display.engNote[i] = s; }
  bump(a) { if (this.rig) this.rig.bump(a); }
  sensedOn() { this.sensed = this._sensed; this._sensed.ias = this.ac.ias; }
  activeName(n) { if (!this.active.includes(n)) this.active.push(n); if (this.hud) this.hud.setFailures(this.active); }
  // Speech, a HUD message, or both ('' skips one). Priority speech cuts off what was being said.
  say(voice, msg, cls = '', priority = false) {
    if (msg && this.hud) this.hud.message(msg, cls, 3);
    if (voice && this.audio && this.power) this.audio.say(voice, priority);
  }
  // A callout `s` seconds of flight from now (advice, so it shows on a dark HUD too); `voice`: said as well (Paddles
  // on the radio). Sim time: postStep() says it when it is due.
  later(text, s, voice = false) { this._due.push({ delay: s, at: null, text, voice, hint: false }); }
  _sayDue() {
    const q = this._due;
    for (let i = 0; i < q.length;) {
      const c = q[i];
      // counted from the end of the frame it was queued in: the frame whose picture first shows the failure
      if (c.at == null) c.at = this.t + c.delay;
      if (this.t + 1e-9 < c.at) { i++; continue; }
      q.splice(i, 1);
      if (c.hint) { if (this.hud) this.hud.callout(c.text, 6, true); }   // (true: advice, shown on a dark HUD too)
      else if (c.voice) { if (this.audio) this.audio.say(c.text, true); if (this.hud) this.hud.callout(c.text.split('.')[0].toUpperCase(), 3, true); }
      else if (this.hud) this.hud.callout(c.text, 5, true);
    }
  }

  // The keys that deal with a failure, offered on the touch bar and the key strip while they are still to be used.
  // Each effect offers its own (owner); two effects can offer the same action (an engine fire and a bird strike's
  // surging engine both use the fire handle), and the button stays, with the next one's label, until neither needs
  // it. clearAction(a) without an owner takes every offer of it away (the fuel cutoff, which serves them all at once).
  setAction(a, label, name, key, hot, owner = null) {
    if (!this._actions.some((x) => x.a === a && x.owner === owner)) this._actions.push({ a, label, name, key, hot, owner });
    this._syncActions();
  }
  clearAction(a, owner) {
    for (let i = this._actions.length - 1; i >= 0; i--) if (this._actions[i].a === a && (owner === undefined || this._actions[i].owner === owner)) this._actions.splice(i, 1);
    this._syncActions();
  }
  // What is on offer: one entry per action, the first offer's label (made only when an offer comes or goes).
  get offers() {
    const out = [];
    for (const x of this._actions) if (!out.some((o) => o.a === x.a)) out.push(x);
    return out;
  }
  _syncActions() {
    const list = this.offers;
    const k = list.map((x) => x.a + x.label + x.hot).join('|');
    if (k === this._actionsKey) return;
    this._actionsKey = k;
    if (this.touch && this.touch.setFailureButtons) this.touch.setFailureButtons(list);
    if (this.hud && this.hud.setExtraKeys) this.hud.setExtraKeys(list.map((x) => [x.name, [[x.key, x.a]]]));
  }

  // Engines: one shut down by a handle (it becomes the aircraft's own engine failure, so the flight model, the hints
  // and the autopilot know), or all of them by the fuel cutoff.
  shutEngine(i, handle = false) {
    const ac = this.ac, e = ac.engines[i];
    if (!e || e.failed) return;
    if (ac.engines.length > 1) ac.fail(e.pos.x < -0.1 ? 'engineLeft' : e.pos.x > 0.1 ? 'engineRight' : 'engine');
    else ac.fail('engine');
    e.failed = true;
    if (handle) this._display.engOff[i] = true;
  }
  // The fuel cutoff (U): the levers go to idle at once (the engines spool down) and 2.5 s later every engine stops. A
  // shutdown, not a failure: the engines' own numbers go to zero (per-instance copies; ac.def is never touched) rather
  // than `failed`, so the particle effects do not stream a failed engine's smoke behind a deliberate shutdown, and the
  // gauges say OFF and run down (preStep, postStep). Offered by the stuck throttle and the gear-up belly landing.
  // The levers are guarded, as real ones are: below 300 ft (and on the ground), where the drill uses it, one press
  // does it; higher up a press only asks, and a second one within two seconds cuts. A U pressed by mistake on the
  // approach (it sits between the trim keys and the look keys) does not turn the airliner into a glider.
  cutFuel() {
    if (this.fuelCut) return false;
    const ac = this.ac, low = ac.onGround || ac.wheelsOnGround || ac.radioAlt < 300 * FT;
    if (!low && !(this._fuelArmT > 0)) {
      this._fuelArmT = 2;
      this.say('', this.touchify('FUEL CUTOFF? PRESS U AGAIN'), 'warn');
      return true;
    }
    this._fuelArmT = 0;
    this.fuelCut = true; this.fuelCutT = 0;
    this.clearAction('fuelCutoff');
    this.say('Fuel cutoff.', 'FUEL CUTOFF', '');
    return true;
  }

  // ---- per frame ----
  _read(ac, k) { const s = this._shadow[k]; return ac.input[k] === s.out ? s.base : ac.input[k]; }
  preStep(dt, ac, inp) {
    if (!this.fx.length) return;
    const w = this._w;
    for (const k of CHANNELS) w[k] = this._read(ac, k);
    const base = this._base || (this._base = {});
    for (const k of CHANNELS) base[k] = w[k];
    for (const f of this.fx) if (f.pre) f.pre(dt, ac, inp, w);
    if (this.fuelCut) {
      // (last, so a surge or a partial-power effect cannot put the power back)
      this.fuelCutT += dt;
      w.throttle = 0;
      if (this.fuelCutT > 2.5) for (let i = 0; i < ac.engines.length; i++) {
        const e = ac.engines[i];
        if (!this._display.engOff[i]) { this._display.engOff[i] = true; this._offRpm[i] = e.rpm; }
        e.maxThrust = 0; e.maxPower = 0; e.staticThrust = 0;
      }
    }
    for (const k of CHANNELS) { const s = this._shadow[k]; s.base = base[k]; s.out = w[k]; ac.input[k] = w[k]; }
  }
  postStep(dt, ac) {
    this.t += dt;
    if (this._due.length) this._sayDue();
    if (this.runAtContact == null && ac.stats.touchdown) this.runAtContact = !(this.fuelCut && this.fuelCutT > 2.5) && ac.engines.some((e) => !e.failed);
    if (!this.fx.length && !this.display) return;
    if (this._fuelArmT > 0) this._fuelArmT -= dt;
    const d = this._display, snd = this.sound;
    snd.bell = 0; snd.clacker = 0; snd.buzz = 0;
    this.shake = 0; this.warnLight = false; this._cfgN = 0;
    for (let i = 0; i < d.engNote.length; i++) d.engNote[i] = '';
    for (const f of this.fx) if (f.post) f.post(dt, ac);
    if (this.fuelCut) {
      this.cfgLine('FUEL CUTOFF', 'bad');
      // an engine the fuel cutoff stopped runs down on the gauges (the flight model's rpm follows the lever, which only
      // the gauges, the sound and the exhaust read: a jet to nothing, a propeller to a windmill)
      for (let i = 0; i < ac.engines.length; i++) {
        const e = ac.engines[i];
        if (!d.engOff[i] || e.failed) continue;
        const to = e.type === 'prop' ? 0.15 * clamp(ac.tas / 30, 0, 1) : 0;
        this._offRpm[i] += (to - this._offRpm[i]) * Math.min(1, dt / 4);
        e.rpm = this._offRpm[i];
      }
    }
    d.cfg.length = this._cfgN;
    if (d.caution.blink > 0) d.caution.blink -= dt;
    if (this.warnLight) { d.caution.level = 'warning'; if (d.caution.blink <= 0) d.caution.blink = 0.5; }
    if (this.shake > 0 && !ac.crashed) this.bump(this.shake);
    if (this.audio && this.audio.alarms) { this.audio.alarms.update(dt, ac.crashed ? null : snd); }
    snd.bang = 0; snd.thud = 0;
  }
  // A key action. 'failDrill' is whichever drill is on offer first: one button for them all, a gamepad's right stick
  // click (src/input.js).
  action(name) {
    if (name === 'failDrill') { const o = this.offers[0]; return !!o && this.action(o.a); }
    for (const f of this.fx) if (f.action && f.action(name)) return true;
    return false;
  }
  // A failure's own hint where the mission has none (hookMission), or null. Not while the stall warning sounds above
  // the flare: the game's own hint then is the one that matters.
  hint(ctx) {
    const ac = ctx.ac;
    if (!this.fx.length || ac.crashed || (ac.aero.warning && !ac.onGround && ac.radioAlt > ac.flareZone())) return null;
    for (const f of this.fx) if (f.hint) { const h = f.hint(ctx); if (h) return h; }
    return null;
  }
  // The landing result with what the failures change (the mission runtime's score() calls this first: hookMission).
  // Applied once: a result that already carries lines this handed back (a copy the mission made of it) comes back as
  // it is, so a mission runtime that also calls this itself cannot count a failure twice.
  score(result, ac, approach) {
    if (result.lines.some((l) => this._lines.has(l))) return result;
    let r = result;
    if (this.sc.scoring && this.sc.scoring.belly && this.sc.scoring.type !== 'carrier') r = scoreBelly(r, ac, approach, this.sc, this.runAtContact !== false);
    for (const f of this.fx) if (f.score) r = f.score(r, ac, approach, this);
    // scoring.js names the failures by their keys ("stuckThrottle"); for a flight with one of the new ones the line says
    // their names instead ("Stuck throttle"). The original twenty's debriefs are left exactly as they were.
    const fs = this.sc.failures || [];
    if (fs.some((f) => FAILURES[f.name] && FAILURES[f.name].effect)) {
      for (const l of r.lines) if (l.k === 'Malfunction handled') l.v = fs.map((f) => (FAILURES[f.name] ? FAILURES[f.name].name : f.name)).join(', ') + ' (+5)';
    }
    for (const l of r.lines) this._lines.add(l);
    return r;
  }
  // The ball the lens shows. The true one goes to the scoring, the callouts and the LSO; with the lens failed the
  // cells are dark (the wave-off lights are the LSO's and still work).
  lens(mb) {
    if (!this._display.noBall || !mb) return mb;
    const o = this._dark; o.waveoff = mb.waveoff; o.range = mb.range; o.dl = mb.dl;
    return o;
  }
  dispose() {
    this._due.length = 0;
    for (const f of this.fx) if (f.dispose) f.dispose();
    const mh = this._mission;
    if (mh) {
      if (mh.ownScore) mh.m.score = mh.score; else delete mh.m.score;
      if (mh.ownHint) mh.m.hint = mh.hint; else delete mh.m.hint;
      this._mission = null;
    }
    if (this.game && this.game.cockpitView && this.game.cockpitView.failView === this) this.game.cockpitView.failView = null;
    if (this.touch && this.touch.setFailureButtons) this.touch.setFailureButtons([]);
    if (this.hud && this.hud.setExtraKeys) this.hud.setExtraKeys([]);
  }
}
