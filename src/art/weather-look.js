// WEATHER LOOK - what storms, rain, snow, dust and lightning look like.
//
// Contract (the engine side is src/systems/weather.js, which this file must not import):
//   new WeatherLook(scene, { spec, sky, quality, touch })   built once per flight in loadSite, before the
//       shaders compile, and only when the scenario has a `weather` spec. Build everything here (hidden if
//       need be): anything created mid-flight compiles synchronously and stalls the frame.
//   update(dt, state, { camera, t, sky, renderer, ac })   every frame; no allocations, no needsUpdate.
//       `state` is Weather.state: { rain, snow, dust, darkness, ceiling, flash, vis, windshear }.
//   dispose()
// House rules (src/art/AGENTS.md): name every material; no GLSL uniform named at*; never cache materials at
// module level; seeded randomness from the sim, never Math.random or a clock; no point or spot lights (a
// lightning flash is an exposure / hemisphere spike, restored afterwards); precipitation is ONE draw that
// wraps around the camera in the vertex shader, not the particle system (its budget is spent).
//
// STUB (skeleton, 2026-09-17): draws nothing.

export class WeatherLook {
  constructor(scene, { spec = null, sky = null, quality = 'high', touch = false } = {}) {
    this.scene = scene;
    this.spec = spec;
    this.sky = sky;
    this.quality = quality;
    this.touch = touch;
  }
  update(dt, state, env) { /* stub */ }
  dispose() { /* stub */ }
}
