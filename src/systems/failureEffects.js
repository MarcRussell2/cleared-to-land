// Failure runtime: one per flight. It fires the scenario's failures when their triggers say so, announces
// them, and applies the effects that need NO flight-physics edit, from outside the aircraft:
//   preStep(dt, ac, inp)  runs after the flight control (and the debug autopilot) wrote ac.input and before
//                         the physics step: jammed or biased controls, runaway trim, a stuck throttle, stuck
//                         spoilers, flutter, per-engine partial power, per-leg faults, a hook that will not drop.
//   postStep(dt, ac)      runs after the step: `sensed` values for failed instruments (unreliable airspeed and
//                         the like), `display` switches for the HUD and the cockpit (dark panel, failed tapes).
// Failures the aircraft itself models (engine, engineLeft/Right, flapsStuck, gearStuck, noseGear, elevatorJam,
// hydraulics, brakes, ice) still go through malfunctions.applyFailure -> ac.fail(); never edit the physics.
//
// Randomness from the flight seed only (makeRng(seed * k + c)); never Math.random().
//
// SKELETON (2026-09-17): trigger + announce exactly as main.js did before; no new effects yet.
import { applyFailure, shouldTrigger } from './malfunctions.js';

export class FailureRuntime {
  constructor(ac, sc, { seed = 1, hud = null, audio = null, rig = null, input = null, world = null, touch = null, game = null, touchify = (s) => s } = {}) {
    this.ac = ac; this.sc = sc; this.seed = seed;
    this.hud = hud; this.audio = audio; this.rig = rig; this.input = input; this.world = world; this.touch = touch; this.game = game;
    this.touchify = touchify;
    this.pending = (sc.failures || []).map((f) => ({ ...f }));
    this.active = [];          // display names, for the HUD failure chips
    this.sensed = null;        // instrument readings that differ from the truth (null = instruments are honest)
    this.display = null;       // HUD / cockpit switches (null = everything works)
    this._hintTimer = null;
  }

  // Fire whatever is due. ctx = { t, distToThreshold } (the same context shouldTrigger always had).
  check(ac, ctx) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const f = this.pending[i];
      if (shouldTrigger(f, ac, ctx)) { this.pending.splice(i, 1); this.trigger(f); }
    }
  }

  trigger(spec) {
    const info = applyFailure(this.ac, spec);
    this.active.push(info.name);
    this.announce(info, spec);
    return info;
  }

  announce(info, spec) {
    const hud = this.hud, audio = this.audio;
    if (hud) { hud.setFailures(this.active); hud.message(info.msg, 'bad', 4); }
    if (audio) audio.beep(520, 0.4);
    if (info.hint && hud) {
      const hintText = this.touchify(info.hint);
      clearTimeout(this._hintTimer);
      this._hintTimer = setTimeout(() => hud.callout(hintText, 6), 800);
    }
    if (audio) audio.say('Warning. ' + info.name.toLowerCase(), true);
  }

  preStep(dt, ac, inp) { /* no effects yet */ }
  postStep(dt, ac) { /* no effects yet */ }
  action(name) { return false; }
  dispose() { clearTimeout(this._hintTimer); }
}
