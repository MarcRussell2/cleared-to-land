// Helpers for mission and site data. Pure: no three.js scene, no DOM (tools import this in Node).
import { DEG } from '../config.js';

// A row of obstacle trees across the approach path (x = across, z = along; the threshold is at z = 0
// and the approach comes from +z). Small alternating offsets so it reads as a treeline, not a fence.
// (The same helper as in scenarios.js, which this directory must not import: scenarios.js imports us.)
export function treeWall(z, from, to, step, scale, zJitter = 0) {
  const out = [];
  for (let x = from, k = 0; x <= to; x += step, k++) out.push({ x: x + (k % 2 ? 1.5 : -1.5), z: z + ((k % 3) - 1) * zJitter, scale: scale + 0.08 * Math.sin(k * 1.9) });
  return out;
}

// Runway frame -> world. u along the runway from the threshold (negative on the approach), v to the right of
// the centreline, y above the threshold elevation. Uses site.runways[0], like the rest of the game.
export function rwToWorld(site, u, v, y = 0, out = { x: 0, y: 0, z: 0 }) {
  const rw = site.runways[0];
  const h = rw.heading * DEG, dx = Math.sin(h), dz = -Math.cos(h);   // headingToVec
  const rx = -dz, rz = dx;                                          // right = (-dir.z, 0, dir.x)
  out.x = rw.x + dx * u + rx * v;
  out.z = rw.z + dz * u + rz * v;
  out.y = rw.elevation + y;
  return out;
}
