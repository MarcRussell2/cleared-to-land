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

// An S-curve for RoutePilot from (u0, v0) to (u1, v1), heading down the runway at both ends: two arcs of the same
// radius meeting halfway, the first turning toward the new side, at `bank` degrees at most (the arc law's own
// feed-forward decides the bank the radius needs; the limit only caps it). Radius (a^2 + b^2) / 2b for half-lengths
// a, b. (The city ladder keeps a copy of its own in city.js.)
export function sCurve(u0, v0, u1, v1, alt0, alt1, kt, bank) {
  const a = (u1 - u0) / 2, b = (v1 - v0) / 2, r = (a * a + b * b) / (2 * Math.abs(b));
  return [
    { u: u0 + a, v: v0 + b, alt: (alt0 + alt1) / 2, arc: b > 0 ? 'R' : 'L', r, kt, bank },
    { u: u1, v: v1, alt: alt1, arc: b > 0 ? 'L' : 'R', r, kt, bank },
  ];
}
