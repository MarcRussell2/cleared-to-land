// Probe spheres for obstacle collision, in the body frame of each aircraft (metres from the CG; forward -Z,
// up +Y, right +X): nose, tail, fin tops, wingtips and winglets, stabiliser tips, nacelles, and samples along
// the wing leading and trailing edges close enough that no mast or cable fits between them.
//
// These are NOT the physics contact points (def.bodyPoints in defs.js, which only meet the ground); they are
// read by src/world/obstacles.js after each step, swept from the previous frame's pose to this one. Measured
// from the procedural airframes that ship (src/art/airframes/*.js: the wing, fin and tailplane formulas are
// copied from there and named below) and cross-checked by tools/test-obstacles.mjs, which builds each airframe
// in Node, samples its surface and requires every sample to lie inside (or within a few decimetres of) a probe.
//
// Rules the table keeps:
//   - consecutive probes along a line overlap (spacing <= 1.4 x radius), so the union is a solid tube: a 2 m
//     mast cannot pass between two probes on the Condor's wing, and a 0.1 m cable cannot either;
//   - a probe's radius is about the local half-thickness plus a little: the Condor's wing root is 0.8 m deep,
//     its probes 0.78 m; the light wings 0.2 m deep, their probes about 0.45 m. A cable that misses the skin by
//     less than that counts as a hit: conservative by a few decimetres, never permissive;
//   - flap probes carry `fy`/`fz` (metres at full flap): added times ac.ctl.flap, so an extended flap is covered
//     where it hangs;
//   - wheels come from def.gear (hullProbes() below) and count only while the gear is down (ctl.gear > 0.3),
//     so a gear-up Condor can slip 1.5 m lower under a boom than a gear-down one.
//
// Export: HULLS[id] = [{ x, y, z, r, part, fy?, fz? }], and hullProbes(def) = { probes, gear, radius } where
// `gear` are the wheel and leg probes (with the leg index) and `radius` bounds every probe from the CG (the
// broadphase uses it).
import { DEG } from '../config.js';

// Evenly spaced probes from a to b (inclusive), radius r0 at a easing to r1 at b; spacing <= 1.4 x radius, or
// `step` metres where a fat tube must cover a skin at nearly its own radius (the waist between two spheres of
// radius r at spacing s is sqrt(r^2 - s^2/4)).
function run(out, a, b, r0, r1 = r0, part = '', extra = null, step = 0) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const n = Math.max(1, Math.ceil(len / (step || 1.4 * Math.min(r0, r1))));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, z: a[2] + (b[2] - a[2]) * t, r: r0 + (r1 - r0) * t, part };
    if (extra) Object.assign(p, typeof extra === 'function' ? extra(t) : extra);
    out.push(p);
  }
}
// Both sides: fn(s) with s = -1 (left) and +1 (right).
const both = (fn) => { fn(-1); fn(1); };
// Round to the centimetre: the table is data, and a readable one.
const tidy = (list) => list.map((p) => { const q = {}; for (const k in p) q[k] = typeof p[k] === 'number' ? Math.round(p[k] * 100) / 100 : p[k]; return q; });

// ---- Skylark 172 (skylark.js): high wing at y 0.98 + 1.5 deg dihedral, leading edge z -0.25 - 0.25 chord,
// chord 1.65 m tapering to 1.15 outboard, trailing edge (flaps, ailerons) to z ~0.99; one strut per side to 45%
// semispan; fin from the dorsal fillet (y 0.3, z 1.95) to its crown (y 1.99, z 3.76), rudder to z 4.48;
// tailplane +-1.8 m at y 0.12 from z 3.08 to 4.38; spinner at z -4.18 and a 0.95 m propeller. ----
function skylark() {
  const o = [];
  const half = 5.5, dih = Math.tan(1.5 * DEG), hy = (x) => 0.98 + x * dih;
  o.push({ x: 0, y: 0, z: -3.94, r: 0.98, part: 'propeller' });
  run(o, [0, -0.05, -3.1], [0, -0.05, -2.2], 0.72, 0.8, 'cowling');
  run(o, [0, -0.15, -1.5], [0, 0.05, 0.4], 1.0, 1.08, 'cabin');
  run(o, [0, 0.1, 1.2], [0, 0.2, 4.35], 0.85, 0.36, 'tailcone');
  run(o, [0, 0.75, 3.55], [0, 1.85, 4.1], 0.42, 0.36, 'fin');
  run(o, [0, 1.25, 2.9], [0, 0.55, 2.4], 0.34, 0.34, 'fin fillet');
  both((s) => {
    run(o, [s * 0.7, 1.05, -0.35], [s * 5.25, hy(5.25) + 0.05, -0.36], 0.45, 0.42, 'wing leading edge');
    run(o, [s * 0.7, 1.0, 0.45], [s * 5.25, hy(5.25), 0.4], 0.45, 0.42, 'wing trailing edge');
    o.push({ x: s * (half - 0.05), y: hy(half), z: -0.1, r: 0.55, part: 'wingtip' });
    run(o, [s * 0.57, -0.7, -0.48], [s * 2.45, hy(2.45) - 0.1, -0.35], 0.3, 0.3, 'strut');
    run(o, [s * 0.45, 0.13, 3.75], [s * 1.75, 0.13, 3.95], 0.38, 0.33, 'tailplane');
  });
  return tidy(o);
}

// ---- Trailblazer (trailblazer.js): high wing at y 1.05, leading edge z -1.18, chord 1.15 plus 0.46 m of flap
// and aileron behind the hinge (z -0.005), tips at +-5.35; two struts per side to (3.12, 1.0, -0.4); fin to
// (0, 1.9, 4.55), rudder to z 5.28; tailplane +-1.55 m at y 0.2; a 1.0 m propeller at z -3.49. ----
function trailblazer() {
  const o = [];
  const half = 5.35, wy = 1.05;
  o.push({ x: 0, y: 0.05, z: -3.49, r: 1.02, part: 'propeller' });
  run(o, [0, 0.0, -2.8], [0, -0.05, -1.95], 0.62, 0.72, 'cowling');
  run(o, [0, -0.25, -1.3], [0, 0.1, 0.3], 1.02, 1.0, 'cabin');
  run(o, [0, 0.1, 1.0], [0, 0.35, 4.75], 0.72, 0.35, 'tailcone');
  run(o, [0, 0.7, 4.1], [0, 1.75, 4.75], 0.42, 0.36, 'fin');
  o.push({ x: 0, y: 0.9, z: 5.1, r: 0.35, part: 'rudder' });
  both((s) => {
    run(o, [s * 0.6, wy + 0.05, -0.85], [s * (half - 0.2), wy + 0.05, -0.85], 0.42, 0.42, 'wing leading edge');
    run(o, [s * 0.6, wy, 0.05], [s * (half - 0.2), wy, 0.05], 0.42, 0.42, 'wing trailing edge');
    o.push({ x: s * (half - 0.1), y: wy, z: -0.4, r: 0.5, part: 'wingtip' });
    run(o, [s * 0.48, -0.68, -0.25], [s * 3.12, wy - 0.05, -0.4], 0.45, 0.4, 'struts');
    run(o, [s * 0.4, 0.2, 4.0], [s * 1.5, 0.2, 4.05], 0.38, 0.33, 'tailplane');
  });
  return tidy(o);
}

// ---- Condor 700 (condor.js): wing y(x) = -1.35 + x tan 6, quarter chord z(x) = -1.7 + x tan 25, chord 7.2 m
// to x = 4.65 tapering to 1.4 at the tip (x = 16.6), leading edge = quarter - chord/4; the flaps hinge near 74%
// chord and hang ~1.3 m under the trailing edge at full travel; winglets rise to (17.15, 2.79, 7.42); fin
// leading edge from (0, 2.6, 11.9) to (0, 8.8, 16.74), top to z 18.1, rudder to 19.53; tailplane
// y = 1.1 + x tan 7, quarter chord 13.45 + x tan 30, to +-6.9; nacelles at x +-5.6 from z -4.9 to 1.2,
// hanging to y -2.9; fuselage radius 1.95, nose -19.7, tail cone to 19.5. ----
function condor() {
  const o = [];
  const tip = 16.6;
  const chord = (x) => (x < tip * 0.28 ? 7.2 : 7.2 - 5.7 * (x - tip * 0.28) / (tip * 0.72));
  const wy = (x) => -1.35 + x * Math.tan(6 * DEG), q = (x) => -1.7 + x * Math.tan(25 * DEG);
  const le = (x) => q(x) - 0.25 * chord(x);
  run(o, [0, 0.35, -19.2], [0, 0.2, -17.6], 1.05, 1.5, 'nose');
  run(o, [0, -0.05, -16.2], [0, -0.05, 10.5], 2.12, 2.12, 'fuselage', null, 1.5);
  for (const x of [-0.8, 0.8]) run(o, [x, -1.6, -6.5], [x, -1.6, 7.5], 0.95, 0.95, 'belly fairing');
  run(o, [0, 0.3, 12.2], [0, 0.9, 18.9], 1.75, 0.6, 'tail cone');
  run(o, [0, 2.8, 12.6], [0, 8.4, 17.1], 0.9, 0.62, 'fin leading edge');
  run(o, [0, 3.2, 16.4], [0, 8.4, 18.6], 0.9, 0.62, 'fin trailing edge');
  run(o, [0, 3.0, 14.6], [0, 8.4, 17.85], 0.85, 0.6, 'fin');
  run(o, [0, 2.2, 10.2], [0, 3.0, 16.4], 0.75, 0.75, 'dorsal fin');
  run(o, [0, 1.8, 17.3], [0, 8.3, 19.35], 0.62, 0.55, 'rudder');
  both((s) => {
    run(o, [s * 2.3, -1.3, -3.2], [s * 2.3, -1.3, 5.2], 0.95, 0.95, 'wing root fairing');
    // leading edge at 12% chord, trailing edge at 84%, section by section between the planform's breaks; then the
    // flap line, which moves with the flaps (the flap is ~27% of the chord, rotating down 40 deg about its hinge)
    const at = (x, f, dy = 0.12) => [s * x, wy(x) + dy, le(x) + f * chord(x)];
    // (four lines where the chord is over 4 m, three from x = 9.5 to the tip: no point of the skin more than 0.4 m
    // outside a probe, checked by tools/test-obstacles.mjs)
    for (const [xa, xb, ra, rb, lines] of [[2.2, 4.65, 0.8, 0.78, 4], [4.65, 9.5, 0.72, 0.6, 4], [9.5, 13.0, 0.58, 0.5, 3], [13.0, tip - 0.1, 0.5, 0.45, 3]]) {
      for (let k = 0; k < lines; k++) {
        const f = 0.1 + 0.78 * k / (lines - 1), dy = 0.1 + 0.1 * Math.sin(Math.PI * f);
        run(o, at(xa, f, dy), at(xb, f, dy), ra, rb, k === 0 ? 'wing leading edge' : k === lines - 1 ? 'wing trailing edge' : 'wing');
      }
    }
    for (const [xa, xb] of [[2.2, 4.65], [4.65, 12.6]]) {
      run(o, at(xa, 0.95, -0.15), at(xb, 0.95, -0.15), 0.6, 0.5, 'flap', (t) => {
        const c = chord(xa + (xb - xa) * t) * 0.22;
        return { fy: -c * Math.sin(40 * DEG), fz: -c * (1 - Math.cos(40 * DEG)) };
      });
    }
    // the inboard flap's drooped root, hanging under the trailing edge beside the fuselage
    run(o, [s * 1.9, -1.8, 4.6], [s * 5.8, -1.4, 5.5], 0.6, 0.55, 'flap', { fy: -1.2, fz: -0.35 });
    // the canoe fairings over the flap tracks, hanging under the trailing edge
    for (const x of [4.8, 9.4]) { const h = q(x) + 0.49 * chord(x) + 0.45; run(o, [s * x, wy(x) - 0.29, h - 1.3], [s * x, wy(x) - 0.29, h + 1.4], 0.38, 0.38, 'flap track fairing'); }
    // blended winglet: from the tip up and aft to its top
    run(o, [s * 16.75, wy(16.6) + 0.15, q(16.6) + 0.35], [s * 17.1, wy(16.6) + 2.15, q(16.6) + 1.3], 0.55, 0.42, 'winglet');
    // engine: fan face to nozzle, and the pylon up to the wing
    run(o, [s * 5.6, -1.75, -4.6], [s * 5.6, -1.75, 0.9], 1.3, 1.05, 'engine nacelle');
    run(o, [s * 5.6, -0.55, -1.0], [s * 5.6, -0.45, 2.8], 0.55, 0.55, 'engine pylon');
    // tailplane and elevator: y 1.1 + x tan 7, quarter chord 13.45 + x tan 30, chord 3.8 tapering to 1.5
    const ty = (x) => 1.1 + x * Math.tan(7 * DEG), tq = (x) => 13.45 + x * Math.tan(30 * DEG), tc = (x) => 3.8 - 2.3 * x / 6.9;
    run(o, [s * 1.2, ty(1.2) + 0.1, tq(1.2) - 0.25 * tc(1.2) + 0.5], [s * 6.75, ty(6.75) + 0.05, tq(6.75) - 0.25 * tc(6.75) + 0.4], 0.72, 0.42, 'tailplane');
    run(o, [s * 1.2, ty(1.2) + 0.05, tq(1.2) + 0.55 * tc(1.2)], [s * 6.75, ty(6.75) + 0.05, tq(6.75) + 0.55 * tc(6.75)], 0.6, 0.42, 'elevator');
  });
  return tidy(o);
}

// ---- Sea Hornet (hornet.js): low wing at y -0.20, trapezoid from the LEX to +-6.15 (leading edge z ~ -1.4 at
// the root, 0.6 at the tip; trailing edge 3.7), twin fins canted out to (+-2.42, 3.90, 5.28..6.84), stabilators
// to +-3.98 at y -0.26 from z 5.3 to 8.51, nose -8.7, nozzles to 8.6, hook to 9.55. ----
function hornet() {
  const o = [];
  run(o, [0, -0.3, -8.3], [0, -0.1, -6.6], 0.5, 0.95, 'radome');
  for (const x of [-0.75, 0.75]) run(o, [x, -0.3, -8.0], [x, -0.3, -7.2], 0.58, 0.58, 'nose chine');
  run(o, [0, 0.1, -5.6], [0, 0.0, 7.4], 1.45, 1.45, 'fuselage', null, 1.0);
  both((s) => {
    run(o, [s * 1.5, -0.2, -0.9], [s * 6.0, -0.2, 1.05], 0.55, 0.45, 'wing leading edge');
    run(o, [s * 1.5, -0.2, 2.9], [s * 6.0, -0.2, 3.1], 0.55, 0.45, 'wing trailing edge');
    run(o, [s * 1.4, -0.2, 1.1], [s * 5.9, -0.2, 2.1], 0.55, 0.45, 'wing');
    run(o, [s * 1.45, -0.15, 0.1], [s * 5.95, -0.2, 1.55], 0.55, 0.45, 'wing');
    run(o, [s * 1.15, 0.2, -5.4], [s * 1.4, 0.0, -1.2], 0.55, 0.55, 'leading-edge extension');
    run(o, [s * 1.2, -1.0, -3.7], [s * 1.2, -1.0, 3.0], 0.55, 0.55, 'intake');
    run(o, [s * 1.2, -0.3, 3.3], [s * 3.65, -0.3, 3.3], 0.42, 0.42, 'flap', { fy: -0.6, fz: -0.2 });
    // fins canted out 20 deg: leading edge from (1.36, 0.82, 3.04) to the tip (2.47, 3.88, 5.28..6.23), rudder to 7.1
    run(o, [s * 1.4, 1.0, 3.2], [s * 2.42, 3.75, 5.4], 0.5, 0.42, 'fin leading edge');
    run(o, [s * 1.4, 1.0, 4.9], [s * 2.42, 3.75, 6.1], 0.5, 0.42, 'fin');
    run(o, [s * 1.45, 1.1, 6.6], [s * 2.4, 3.7, 6.8], 0.5, 0.42, 'rudder');
    run(o, [s * 2.77, -0.75, 0.55], [s * 2.77, -0.75, 1.8], 0.42, 0.42, 'weapons pylon');
    run(o, [s * 1.3, -0.26, 6.3], [s * 3.85, -0.26, 7.3], 0.5, 0.42, 'stabilator');
    run(o, [s * 1.2, -0.26, 8.0], [s * 3.8, -0.28, 8.4], 0.42, 0.4, 'stabilator trailing edge');
    o.push({ x: s * 0.7, y: -0.3, z: 8.3, r: 0.7, part: 'nozzle' });
  });
  o.push({ x: 0, y: -0.7, z: 9.1, r: 0.45, part: 'hook' });
  return tidy(o);
}

export const HULLS = { skylark: skylark(), trailblazer: trailblazer(), condor: condor(), hornet: hornet() };

// The probe set for one flight: the table plus the wheels from def.gear (a probe at each wheel and one partway
// up its leg), and the radius of the whole set from the CG, for the broadphase.
export function hullProbes(def) {
  const probes = HULLS[def.id] || fallback(def);
  const gear = [];
  def.gear.forEach((g, i) => {
    const r = g.radius + (def.id === 'condor' && g.main ? 0.35 : 0.08);
    gear.push({ x: g.pos.x, y: g.pos.y, z: g.pos.z, r, part: g.name + ' wheel', leg: i });
    // the leg, from the wheel up to where it meets the airframe
    const top = def.gearRetract ? g.pos.y * 0.35 : g.pos.y * 0.5, rl = def.gearRetract ? 0.42 : 0.28;
    const n = Math.max(1, Math.ceil((g.pos.y - top) / -(1.4 * rl)));
    for (let k = 1; k <= n; k++) gear.push({ x: g.pos.x * (1 - 0.15 * k / n), y: g.pos.y + (top - g.pos.y) * k / n, z: g.pos.z, r: rl, part: g.name + ' gear leg', leg: i });
  });
  let radius = 0;
  for (const p of probes) radius = Math.max(radius, Math.hypot(p.x, p.y + Math.min(0, p.fy || 0), p.z + Math.max(0, p.fz || 0)) + p.r);
  for (const p of gear) radius = Math.max(radius, Math.hypot(p.x, p.y, p.z) + p.r);
  return { probes, gear, radius };
}

// An aircraft without a table (a future one): its physics points, fattened, and a line along the span. None of
// the four above uses it.
function fallback(def) {
  const o = [];
  for (const p of def.bodyPoints) o.push({ x: p.pos.x, y: p.pos.y, z: p.pos.z, r: 1, part: p.name });
  const h = def.span / 2;
  run(o, [-h, def.wingHeight || 0, 0], [h, def.wingHeight || 0, 0], 0.8, 0.8, 'wing');
  return tidy(o);
}
