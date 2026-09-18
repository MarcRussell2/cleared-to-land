// CITY LOOK - what mission obstacles look like: towers and blocks, bridges, cranes, masts, power lines,
// gates, their night obstacle lights.
//
// Contract (the world side is src/world/obstacles.js; it reaches this file through src/art/terrain-look.js):
//   buildCourse(volumes, gates, { terrain, night, quality, seed })  returns { objects: Object3D[], update(dt, t) }.
//       `volumes` are the resolved world-space obstacles ({ kind, shape, x, y0, y1, z, w, d, r, rot, name,
//       look }); what is drawn solid MUST match what collides (the OBSTACLE_TREE rule): draw from the same
//       numbers. Instanced or merged by material: a city has about 40-80 draw calls of headroom in total.
// House rules as src/art/AGENTS.md: named materials, no at* uniforms, no material cached at module level,
// seeded randomness only, no point or spot lights (obstacle lights are a LightSet).
//
// STUB (skeleton, 2026-09-17): draws nothing.

export function buildCourse(volumes, gates, opts = {}) {
  return { objects: [], update() {} };
}
