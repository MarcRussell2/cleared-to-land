// Weather: storms, squalls, microbursts, gust fronts, snow and dust, driven by the scenario's `weather` spec
// (src/missions/README.md). This is the MODEL: what the air does and what the pilot is told. How it looks is
// src/art/weather-look.js, which reads `state` and nothing else.
//
// The flight-physics wind (src/physics/wind.js) is not edited. Weather works on it from outside in two ways:
//   - update() may ramp the Wind object's public fields (speedKt, gustKt, dirDeg, turb, shear) for slow changes
//     such as a gust front; the HUD wind box, the windsock and the cockpit follow automatically;
//   - addWind() adds a local overlay in m/s (a microburst's downdraft and outflow) on top of Wind.at(). main.js
//     calls it for the aircraft (every physics sub-step) and for every live particle, so it must be O(1) with an
//     early exit when nothing is active.
// Randomness comes from the flight seed only (makeRng(seed * k + c)); never Math.random().
//
// STUB (skeleton, 2026-09-17): no weather yet. A scenario without `weather` never constructs one.

export class Weather {
  constructor(spec, { seed = 1, wind = null, world = null, scenario = null, hud = null, audio = null, rig = null } = {}) {
    this.spec = spec || {};
    this.seed = seed;
    this.wind = wind;
    this.world = world;
    this.scenario = scenario;
    this.hud = hud; this.audio = audio; this.rig = rig;
    // What the look, the sound and the HUD read. One object, refilled; nothing else is exported per frame.
    this.state = { rain: 0, snow: 0, dust: 0, darkness: 0, ceiling: null, flash: 0, vis: null, windshear: false };
  }
  update(dt, t, ac) { /* stub */ }
  addWind(p, t, out) { return out; }
}
