// New missions: the city ladder ("The city", n 44-49), and Metro City, the site they are flown at. Each entry follows
// src/missions/README.md; ids are permanent. The obstacles are built by src/world/obstacles.js from the `course`
// specs below (its header lists every kind; `district`, `landmark`, `skybridge`, round and pier-standing towers and
// the bridge's parts were added for this ladder); the look is src/art/city-look.js, whose header is the drawing
// contract (and docs/briefs/city/city-look.txt the art brief). The routes are what RoutePilot flies to prove each
// mission lands (tools/fly-mission.mjs, tools/test-city.mjs); the tips tell a human the same technique.
//
// NO GATES (2026-09-23). Marc's rule: "you shouldn't have a box that you're supposed to fly through ... force the
// user to fly through the obstacle because there's no other easier way". Every rung's line is forced by what stands
// around it - a corner full of towers, gate buildings across the avenue, a walled canyon, a viaduct with a mesh of
// stays over its deck, a crescent of towers that narrows to the Needle's eye - and by a start too low and too close
// to climb over any of it. tools/test-city.mjs flies the ways out (over, round, straight on, a pull-up, the
// obstacle-blind Autoland) and every one must end in something. The gate engine stays in src/world/obstacles.js for
// whoever needs it; nothing here uses it.
//
// Hints get ctx = { ac, ra (ft), d (m to the threshold), t, u, v (runway frame, metres), mission }. They name no keys.
//
// Heights in a course and a route are metres above the threshold elevation (4 m above the harbor): the ground under
// the approach stands 8 to 19 m above the runway, and the harbor is 4 m below it.

// ------------------------------------------------------------------ Metro City
// A harbor city on the coast style (terrain seed 638: the coast bends so that the extended centerline crosses a bay).
// The runway, 3,000 m, runs north along the waterfront on the leveled strip the terrain makes for it (the "reclaimed
// land": the harbor is 600 m to its right). Out on the approach, runway frame (u along the runway from the threshold,
// negative out on the approach; v right of the centerline):
//   u 0 .. -3,900      the city under the final: apartment blocks, capped 30 m under the glide path near it
//   u -4,000 .. -7,700 the bay: the centerline crosses water, the west shore 160-340 m left of it
//   u -5,700           the Harbor Bridge, a suspension bridge from the west shore to Container Island, its main span
//                      centered on the centerline, deck 60 m over the water
//   u beyond -7,700    land again, the far hills rising fast to the west
// Checkerboard Hill stands 900 m left of short final, 700 m out, its board facing the south-east: the Kai Tak turn.
// The site's own course is the skyline every mission shares and nothing a straight-in approach meets (free flight,
// Autoland, the look and perf tools fly it); each mission's course carves out what it needs and adds its own towers,
// walls and canyons.
const BRIDGE = { u: -5700, v: 0, rot: 33.7, length: 1442, deckY: 60 };   // (west end on the shore at u -5300 v -600)
const ISLAND = { u: -6250, v: 925, w: 750, d: 700 };                     // Container Island, the bridge's east end
const CHECKER = { u: -700, v: -900 };                                     // Checkerboard Hill

const metroCourse = {
  obstacles: [
    // ---- the landmarks
    { kind: 'landmark', type: 'checkerboard', u: CHECKER.u, v: CHECKER.v, rot: 45, h: 110, r: 170, rTop: 60, boardW: 110, boardH: 90, name: 'Checkerboard Hill', boardName: 'the checkerboard' },
    { kind: 'bridge', u: BRIDGE.u, v: BRIDGE.v, rot: BRIDGE.rot, length: BRIDGE.length, deckY: BRIDGE.deckY, deckW: 30, deckT: 4, towerH: 150, towerW: 9, towerD: 7, deck: 0, anchors: true, lamps: 60, piers: [-690, -630, 630, 690], name: 'the Harbor Bridge', style: { bridge: 'suspension', paint: 'grey' } },
    // Container Island: the terminal at the bridge's east end
    { kind: 'quay', u: ISLAND.u, v: ISLAND.v, w: ISLAND.w, d: ISLAND.d, top: 4, depth: 14, name: 'Container Island' },
    { kind: 'containers', u: -6380, v: 900, rot: -90, cols: 14, rows: 12, tiers: 4, deck: 4, seed: 11 },
    { kind: 'containers', u: -6050, v: 1060, rot: -90, cols: 10, rows: 10, tiers: 5, deck: 4, seed: 12 },
    { kind: 'crane', type: 'sts', u: -6450, v: 1270, boom: 80, deck: 4, color: 'craneBlue' },
    { kind: 'crane', type: 'sts', u: -6200, v: 1270, boom: 80, deck: 4 },
    { kind: 'crane', type: 'sts', u: -5950, v: 1270, boom: 80, deck: 4, color: 'craneBlue' },
    { kind: 'tower', u: -6520, v: 640, w: 90, d: 60, h: 18, deck: 4, name: 'a warehouse', lights: 0, style: { cls: 'industrial', facade: 'shed', roof: 'flat', lit: 0.1, height: 'low' } },
    { kind: 'tower', u: -5980, v: 640, w: 70, d: 50, h: 14, deck: 4, name: 'a warehouse', lights: 0, style: { cls: 'industrial', facade: 'shed', roof: 'flat', lit: 0.1, height: 'low' } },
    // the sea wall along the runway strip's harbor side
    { kind: 'quay', u: 1500, v: 560, w: 60, d: 3700, top: 4, depth: 10, name: 'the sea wall' },
    // ---- the districts
    // under the final: low apartment blocks, 30 m under the 3-degree glide path, none over 45 m
    { kind: 'district', u0: -3900, u1: -950, v0: -380, v1: 130, block: 85, street: 22, h: [18, 45], glide: 30, glideV: 420, seed: 1, style: { cls: 'residential', facade: 'concrete', roof: 'plant', lit: 0.45 } },
    // the waterfront between the final and the harbor: under the Kai Tak turn, none over 45 m
    { kind: 'district', u0: -3700, u1: -700, v0: 130, v1: 700, block: 80, street: 20, h: [20, 45], glide: 30, glideV: 420, seed: 2, style: { cls: 'residential', facade: 'concrete', roof: 'plant', lit: 0.5 } },
    // Kowloon: the dense old town west of the final, taller away from it
    { kind: 'district', u0: -4300, u1: -250, v0: -2700, v1: -380, rot: 8, block: 95, street: 20, h: [28, 110], peak: { u: -2800, v: -1900, r: 1700 }, glide: 30, glideV: 420, seed: 3, style: { cls: 'residential', facade: 'concrete', roof: 'plant', lit: 0.45 } },
    // downtown: the office towers of the skyline, on the bay's west shore
    { kind: 'district', u0: -5600, u1: -4300, v0: -2600, v1: -420, rot: -6, block: 115, blockV: 105, street: 26, h: [70, 280], peak: { u: -4900, v: -1300, r: 1300 }, seed: 4, lots: 1, setback: 10, style: { cls: 'office', facade: 'glass', roof: 'crown', lit: 0.3 } },
    // the north side, west of the runway
    { kind: 'district', u0: -250, u1: 3300, v0: -2600, v1: -1050, block: 100, street: 22, h: [22, 75], seed: 5, style: { cls: 'residential', facade: 'concrete', roof: 'plant', lit: 0.4 } },
    // the far shore of the bay and the foot of the hills
    { kind: 'district', u0: -7600, u1: -5600, v0: -2600, v1: -380, rot: 14, block: 105, street: 22, h: [20, 70], steep: 8, seed: 6, style: { cls: 'residential', facade: 'concrete', roof: 'plant', lit: 0.4 } },
  ],
  // the island's apron (drawn flat on the ground, never solid)
  ground: [
    { u0: ISLAND.u - ISLAND.d / 2 + 5, u1: ISLAND.u + ISLAND.d / 2 - 5, v0: ISLAND.v - ISLAND.w / 2 + 5, v1: ISLAND.v + ISLAND.w / 2 - 5, kind: 'apron', keep: false, deck: 4 },
  ],
};

const metro = {
  id: 'metro', name: 'Metro City Intl', kind: 'airport',
  terrain: { style: 'coast', seed: 638, size: 26000, res: 330, elevation: 4, waterLevel: 0, coastX: 500, trees: 0.25, treeArea: 7000 },
  runways: [{ x: 0, z: 0, heading: 0, length: 3000, width: 45, surface: 'asphalt', elevation: 4, name: '36', nameRecip: '18', papi: true, ils: true, lights: true, buildings: true, aimDistance: 400 }],
  course: metroCourse,
};

export const CITY_SITES = { metro };

// ------------------------------------------------------------------ helpers (pure data, deterministic)
const D2R = Math.PI / 180;
// The 3-degree glide path's height above the threshold elevation at u (aim point 400 m in), and where Autoland flies
// the Condor's CG on it (4.1 m higher): a route ends on that, near Vref, for a steady handover.
const glide = (u) => Math.max(0, 400 - u) * Math.tan(3 * D2R);
const onPath = (u) => Math.round((glide(u) + 4.1) * 10) / 10;
// where a level run at `alt` (a CG height) under the glide path meets it
const meetPath = (alt) => Math.round(400 - (alt - 4.1) / Math.tan(3 * D2R));
// A small deterministic generator for the missions' own towers (not the flight's: the course is the same every time).
function rngOf(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
// An S-curve for RoutePilot from (u0, v0) to (u1, v1), heading down the runway at both ends: two arcs of the same
// radius meeting halfway, the first turning toward the new side. Radius (a^2 + b^2) / 2b for half-lengths a, b.
function sCurve(u0, v0, u1, v1, alt0, alt1, kt) {
  const a = (u1 - u0) / 2, b = (v1 - v0) / 2, r = (a * a + b * b) / (2 * Math.abs(b));
  return [
    { u: u0 + a, v: v0 + b, alt: (alt0 + alt1) / 2, arc: b > 0 ? 'R' : 'L', r, kt },
    { u: u1, v: v1, alt: alt1, arc: b > 0 ? 'L' : 'R', r, kt },
  ];
}
const OFFICE = (h) => ({ cls: 'office', facade: 'glass', roof: 'crown', lit: 0.35, height: h < 60 ? 'mid' : h < 150 ? 'high' : 'super' });
// Heights as the instruments read them. The altimeter reads the CG's height above the sea, which is SEA metres under
// the threshold; the radio altimeter reads the wheels' height, CG_H metres under the Condor's CG, above the water or the
// ground under it. Both in feet, rounded down to tens (a limit quoted as "below N ft" is then on the safe side).
const SEA = 4, CG_H = 4.1;
const altFt = (y, f = Math.floor) => f((y + SEA) / 0.3048 / 10) * 10;  // a CG height above the threshold elevation
const raFt = (y) => Math.floor((y + SEA - CG_H) / 0.3048 / 10) * 10;    // the same over the harbor
const aboutFt = (y) => Math.round((y + SEA) / 0.3048 / 50) * 50;        // a height to fly, on the altimeter, to 50 ft
// The Condor's fin stands FIN metres over its CG (tools/test-city.mjs checks it against the hull): the CG must be that
// and half a metre under anything it flies under.
const FIN = 9.1;
const underTop = (under) => under - FIN - 0.5;
// The Condor's probe footprint across its path, banked (metres, flaps 30, gear down; tools/test-city.mjs checks it).
const CONDOR_WIDTH = { 30: 31, 35: 30, 40: 28, 45: 26 };
const merge = (...cs) => ({
  obstacles: cs.flatMap((c) => c.obstacles || []), gates: [],
  carve: cs.flatMap((c) => c.carve || []), clear: cs.flatMap((c) => c.clear || []), ground: cs.flatMap((c) => c.ground || []),
});

// ---- The Needle (48, and the Gauntlet's first obstacle): two round glass towers NEEDLE_GAP apart, joined all the way
// up, on a right turn onto the final from a heading NEEDLE_TURN degrees left of the runway's. Two lines go through
// the eye, both through the same aim point at the same heading there (NEEDLE_PSI):
//   - the pilot's: a steady turn of radius NEEDLE_R (NEEDLE_BANK, 35 degrees, at 150 kt in still air) that starts on
//     the line the flight starts on, passes the eye 45 degrees in and rolls out on the centerline 15 degrees later.
//     The tips describe it, and the HUD hint is a flight director on it (the cue: when to roll, then the bank to
//     hold, which the wind moves).
//   - RoutePilot's: a tighter turn through the same eye at NEEDLE_AP_BANK (40 degrees, radius NEEDLE_R_AP), for room:
//     banked 40 degrees the airliner is 1.7 m narrower than at 35. It starts on a parallel line 42 m to the right,
//     which is why the walled run-in before the turn is long: it needs the straight to settle on its own line
//     (600 m is enough in the Needle's 5 kt; the Gauntlet's 18-kt gusts want 1,600).
// The Condor's probe footprint banked 0 / 30 / 35 / 40 / 45 degrees is 35.0 / 31.3 / 29.9 / 28.2 / 26.3 m wide, its
// middle about 1 m toward the low wing: so the gap's middle is placed NEEDLE_LEAN inside the turn from the aim point.
// What makes the eye the only way (2026-09-23): the CRESCENT, a canyon of towers NEEDLE_H tall along the turn, its
// walls narrowing from `wide` at the mouth to the Needle's own towers at the eye and widening again to the roll-out,
// with a straight walled run-in `mouth` metres long before the turn, and the start low (NEEDLE_ALT + 5) inside the
// run-in. Straight on, wings level through the eye, a turn too tight or too wide, a pull-up: all end in the Crescent
// (tools/test-city.mjs). The geometry is a function of where the eye stands: needleGeom(aimU, mouth).
const KT_MS = 0.514444, GRAV = 9.81;
const radiusFor = (bank, kt) => Math.pow(kt * KT_MS, 2) / (GRAV * Math.tan(bank * D2R));
const NEEDLE_GAP = 34, NEEDLE_TURN = 60, NEEDLE_PSI = -15, NEEDLE_KT = 150, NEEDLE_LEAN = 0.95;
const NEEDLE_BANK = 35, NEEDLE_R = Math.round(radiusFor(NEEDLE_BANK, NEEDLE_KT));           // 867 m
const NEEDLE_AP_BANK = 40, NEEDLE_R_AP = Math.round(radiusFor(NEEDLE_AP_BANK, NEEDLE_KT));  // 723 m
const NEEDLE_TOWER_R = 12, NEEDLE_H = 300, NEEDLE_ALT = 75, EYE = 'the eye of the Needle';
const NEEDLE_DIR = { k: 0.69, kd: 2.9, max: 10, rollRate: 15, rollLag: 0.5 };
// The flight director through the eye, on the pilot's circle P ({ R, c, S, d0, aim }): on the run-in, `ahead` counts
// down to where the roll should start (the circle's start less the roll's lead, as RoutePilot leads its arcs: 40% of
// the roll at 15 degrees a second and its half-second lag). From there, `bank` is the bank the circle needs at this
// ground speed (NEEDLE_BANK in still air) plus a correction for being off it: NEEDLE_DIR.k degrees per metre outside,
// NEEDLE_DIR.kd per m/s drifting outward (the gains of RoutePilot's arc law, without its integral). Reads the runway
// frame from the mission's world; allocation-free (one object, reused).
const _cue = { bank: 0, ahead: 0, off: 0, d: 0 };
function needleCue(c, P) {
  const ac = c.ac, rw = c.mission.world && c.mission.world.runway;
  const vx = ac.vel.x, vz = ac.vel.z;
  const vu = rw ? vx * rw.dir.x + vz * rw.dir.z : -vz, vv = rw ? vx * rw.right.x + vz * rw.right.z : vx;
  const vg = Math.max(Math.hypot(vu, vv), 20);
  const along = (c.u - P.S.u) * P.d0.u + (c.v - P.S.v) * P.d0.v;   // metres past the circle's start (- before it)
  _cue.off = (c.u - P.S.u) * -P.d0.v + (c.v - P.S.v) * P.d0.u;      // metres right of the run-in line
  const ff = Math.atan(vg * vg / (GRAV * P.R)) / D2R;
  _cue.ahead = -along - vg * (0.4 * ff / NEEDLE_DIR.rollRate + NEEDLE_DIR.rollLag);
  const ru = c.u - P.c.u, rv = c.v - P.c.v, r = Math.max(Math.hypot(ru, rv), 1);
  const corr = along > 0 ? NEEDLE_DIR.k * (r - P.R) + NEEDLE_DIR.kd * (vu * ru + vv * rv) / r : 0;
  _cue.bank = ff + Math.max(-NEEDLE_DIR.max, Math.min(NEEDLE_DIR.max, corr));
  _cue.d = Math.hypot(P.aim.u - c.u, P.aim.v - c.v);
  return _cue;
}
// The hint until the eye: hold the run-in until the roll, then the bank to hold.
function needleHint(c, P) {
  const q = needleCue(c, P), bank = c.ac.euler.roll / D2R, want = Math.round(q.bank);
  if (q.ahead > 0) {
    if (Math.abs(q.off) > 30) return `Line up on the run-in, ${NEEDLE_TURN} degrees left of the runway: ${Math.round(Math.abs(q.off))} m ${q.off > 0 ? 'left' : 'right'}.`;
    return q.ahead > 60 ? `The Needle: hold this line and 250 ft down the Crescent. Roll right in ${Math.round(q.ahead / 50) * 50} m.` : 'Stand by to roll right.';
  }
  if (bank < want - 12) return `Roll right now: ${want} degrees.`;
  return want > NEEDLE_BANK + 2 ? `Bank ${want} degrees through the eye: tighter.` : `Bank ${want} degrees through the eye.`;
}
// The Needle's geometry for an eye whose aim point stands at u = aimU, with a straight walled run-in `mouth` metres
// long before the turn: the aim point, the turns (the right turn of radius R through the aim point at heading
// NEEDLE_PSI: its centre, where it starts (heading -NEEDLE_TURN) and where it ends (heading 0)), the run-in, the
// pilot's circle for the director, the roll numbers the tips quote, the start, and whether a point is past the eye.
function needleGeom(aimU, mouth) {
  const aim = { u: aimU, v: Math.round(NEEDLE_R * (1 - Math.cos(NEEDLE_PSI * D2R)) * 100) / 100 };
  const turn = (R) => {
    const p = NEEDLE_PSI * D2R, a = NEEDLE_TURN * D2R;
    const c = { u: aim.u - R * Math.sin(p), v: aim.v + R * Math.cos(p) };
    return { c, S: { u: c.u - R * Math.sin(a), v: c.v - R * Math.cos(a) }, E: { u: c.u, v: c.v - R } };
  };
  const runIn = (P, d) => ({ u: P.u - d * Math.cos(NEEDLE_TURN * D2R), v: P.v + d * Math.sin(NEEDLE_TURN * D2R) });
  const H = turn(NEEDLE_R), a0 = -NEEDLE_TURN * D2R;
  const path = { R: NEEDLE_R, c: H.c, S: H.S, d0: { u: Math.cos(a0), v: Math.sin(a0) }, aim };
  // the pilot's line in numbers, for the tips: the roll starts where the cue says; from there the eye is `d` metres
  // away and `b` degrees right of the nose; the roll-out is `out` metres of turn past the eye
  const V = NEEDLE_KT * KT_MS, Pr = runIn(H.S, V * (0.4 * NEEDLE_BANK / 15 + 0.5));
  const du = aim.u - Pr.u, dv = aim.v - Pr.v;
  const roll = { d: Math.hypot(du, dv), b: (Math.atan2(dv, du) - a0) / D2R, out: NEEDLE_R * -NEEDLE_PSI * D2R };
  const psi = NEEDLE_PSI * D2R;
  const pastEye = (c) => (c.u - aim.u) * Math.cos(psi) + (c.v - aim.v) * Math.sin(psi) > 0;
  // where the mission starts: on the pilot's line, inside the walled run-in, mouth + 200 m before the turn
  const sp = runIn(H.S, mouth + 200);
  const spawn = { u: Math.round(sp.u), v: Math.round(sp.v), hdg: -NEEDLE_TURN, alt: NEEDLE_ALT + 5, gamma: 0, flap: 0.75, speedKt: NEEDLE_KT, fixed: true };
  return { aim, turn, runIn, path, roll, pastEye, spawn, mouth, hint: (c) => needleHint(c, path), cue: (c) => needleCue(c, path) };
}
// The Crescent: towers NEEDLE_H tall (with a little jitter) along the pilot's circle, inside and outside it, the offset
// narrowing from `wide` at the mouth to the Needle's own towers at the eye and widening again to the roll-out; the
// straight run-in before the turn walled the same way; and 200 m of wall along the runway heading past the roll-out.
// Plus the eye itself: the two round towers, joined by a slab from 118 m to the top, on a pier.
function crescent(gm, wide = { in: 110, out: 80 }) {
  const obstacles = [], T = gm.turn(NEEDLE_R), c = T.c, R = NEEDLE_R;
  const eyeH = -NEEDLE_TURN + 45;   // the heading at the eye, 45 degrees into the turn
  const at = (hd, r) => ({ u: c.u + r * Math.sin(hd * D2R), v: c.v - r * Math.cos(hd * D2R) });
  const wall = (pts) => pts.forEach((p, i) => obstacles.push({ kind: 'tower', u: p.u, v: p.v, w: 32, d: 32, rot: p.rot || 0, top: NEEDLE_H + ((i * 37) % 5) * 8, base: 0, name: 'the Crescent', style: OFFICE(300), lights: 1 }));
  const towerOff = NEEDLE_GAP / 2 + NEEDLE_TOWER_R + 16;   // the wall's centre line beside the eye's towers
  const width = (hd) => { const f = Math.min(1, Math.abs(hd - eyeH) / 45); return { in: towerOff + (wide.in - towerOff) * f, out: towerOff + (wide.out - towerOff) * f }; };
  const inner = [], outer = [], step = 40 / R / D2R;
  for (let hd = -NEEDLE_TURN; hd <= 0.01; hd += step) {
    if (Math.abs(hd - eyeH) < 2.2) continue;   // the eye's own towers stand there
    const w = width(hd);
    inner.push({ ...at(hd, R - w.in), rot: hd }); outer.push({ ...at(hd, R + w.out), rot: hd });
  }
  const a = NEEDLE_TURN * D2R, d0 = { u: Math.cos(-a), v: Math.sin(-a) }, n = { u: Math.cos(-a + Math.PI / 2), v: Math.sin(-a + Math.PI / 2) };
  for (let t = 40; t <= gm.mouth; t += 40) {
    inner.push({ u: T.S.u - d0.u * t + n.u * wide.in, v: T.S.v - d0.v * t + n.v * wide.in, rot: -NEEDLE_TURN });
    outer.push({ u: T.S.u - d0.u * t - n.u * wide.out, v: T.S.v - d0.v * t - n.v * wide.out, rot: -NEEDLE_TURN });
  }
  for (let t = 40; t <= 200; t += 40) { inner.push({ u: T.E.u + t, v: T.E.v + wide.in }); outer.push({ u: T.E.u + t, v: T.E.v - wide.out }); }
  wall(inner); wall(outer);
  const p = NEEDLE_PSI * D2R, nu = -Math.sin(p), nv = Math.cos(p);   // the right-hand normal to the turn at the eye
  const cu = gm.aim.u + NEEDLE_LEAN * nu, cv = gm.aim.v + NEEDLE_LEAN * nv, off = NEEDLE_GAP / 2 + NEEDLE_TOWER_R;
  const L = { u: cu - off * nu, v: cv - off * nv }, Rt = { u: cu + off * nu, v: cv + off * nv };
  const style = { cls: 'landmark', facade: 'glass', roof: 'spire', lit: 0.6, height: 'super', landmark: 'needle' };
  obstacles.push({ kind: 'quay', u: cu, v: cv, rot: NEEDLE_PSI, w: 110, d: 150, top: 4, depth: 12, name: 'the Needle\'s pier' });
  obstacles.push({ kind: 'tower', round: true, u: L.u, v: L.v, w: 2 * NEEDLE_TOWER_R, h: NEEDLE_H, deck: 4, antenna: 25, name: 'the Needle', style });
  obstacles.push({ kind: 'tower', round: true, u: Rt.u, v: Rt.v, w: 2 * NEEDLE_TOWER_R, h: NEEDLE_H, deck: 4, antenna: 25, name: 'the Needle', style });
  obstacles.push({ kind: 'skybridge', a: L, b: Rt, y0: 118, y1: NEEDLE_H - 10, d: 18, name: 'the Needle', style: { cls: 'skybridge', facade: 'glass', lit: 0.7, landmark: 'needle' } });
  return { obstacles };
}
// RoutePilot's line through the Needle: a straight run-in on the start heading down the walled mouth, then its
// 40-degree arc.
function needleRoute(gm, alt, kt = NEEDLE_KT) {
  const { S, E } = gm.turn(NEEDLE_R_AP);
  return [
    { ...gm.runIn(S, gm.mouth), alt, kt },
    { u: S.u, v: S.v, alt, kt },
    { u: E.u, v: Math.round(E.v * 10) / 10, alt, arc: 'R', r: NEEDLE_R_AP, kt, bank: 45 },
  ];
}
// The hints after the eye, shared by the Needle and the Gauntlet's first leg.
const rollOutHint = (c, gm, then) => {
  const T = gm.turn(NEEDLE_R);
  if (c.u < T.E.u + 300) return Math.abs(c.v) > 15 ? `Roll out on the centerline: ${Math.round(Math.abs(c.v))} m ${c.v > 0 ? 'left' : 'right'}.` : `Through. Roll out on the centerline${then ? `, ${then}` : ''}.`;
  return null;
};

// ---- A walled canyon (46, 49): slabs SL_H tall along both sides, CANYON_HW either side of the centerline, and a
// cross-wall at each apex with one slot SL_GAP wide in it, `apex.v` off the centerline. The airliner (35 m across)
// cannot pass an 8 m joint, climb out over 400 m from 110 m, or turn out of a 288 m street at 150 kt.
const CANYON_HW = 144, SL_H = 400, SL_GAP = 56;
function canyon(u0, u1, apexes, seed) {
  const rnd = rngOf(seed), obstacles = [];
  for (const e of [-1, 1]) for (let u = u0; u < u1; u += 126) obstacles.push({ kind: 'tower', u: u + 60, v: e * (CANYON_HW + 16), w: 32, d: 120, h: SL_H + 40 * rnd(), base: 0, name: 'the canyon wall', style: OFFICE(400), lights: 1 });
  apexes.forEach((a, i) => {
    const l = a.v - SL_GAP / 2, r = a.v + SL_GAP / 2;
    obstacles.push({ kind: 'tower', u: a.u, v: (-CANYON_HW + l) / 2, w: l + CANYON_HW, d: 32, h: SL_H, base: 0, name: `the wall at gap ${i + 1}`, style: OFFICE(400) });
    obstacles.push({ kind: 'tower', u: a.u, v: (r + CANYON_HW) / 2, w: CANYON_HW - r, d: 32, h: SL_H, base: 0, name: `the wall at gap ${i + 1}`, style: OFFICE(400) });
  });
  return { obstacles };
}
// The hint through a canyon's slots: the next one by u.
function slotHint(c, apexes) {
  const a = apexes.find((x) => x.u > c.u - 40);
  if (!a) return null;
  const i = apexes.indexOf(a) + 1, off = c.v - a.v, dist = a.u - c.u;
  if (dist < 450) return Math.abs(off) > 10 ? `Gap ${i}: ${Math.round(Math.abs(off))} m ${off > 0 ? 'left' : 'right'}!` : `Gap ${i}: on it, hold the bank.`;
  return `Next: gap ${i}, 60 m ${a.v > 0 ? 'right' : 'left'} of the centerline, ${Math.round(dist / 10) * 10} m.`;
}

// ---- Grand Avenue (45, 49): office towers taller than the glide path on both sides of a 120 m street down the
// extended centerline, and GATE BUILDINGS across it - a slab from the underside you fly under up to GATE_TOP, held by
// two towers as tall - that you can only fly under.
const GATE_TOP = 500;
function avenueCourse(u0, u1, gates, seed) {
  const rnd = rngOf(seed), obstacles = [];
  const tower = (u, len, e, h) => {
    const w = 38 + 26 * rnd(), hh = h || Math.max(glide(u) + 45 + 60 * rnd(), 105 + 55 * rnd());
    obstacles.push({ kind: 'tower', u, v: e * (60 + w / 2), w, d: len, h: hh, antenna: !h && rnd() < 0.25 ? 20 : 0, name: h ? 'a gate building' : 'an office tower', style: OFFICE(hh) });
  };
  const held = gates.map((b) => b.u);
  for (const b of gates) {
    for (const e of [-1, 1]) tower(b.u, 44, e, GATE_TOP);
    obstacles.push({ kind: 'skybridge', a: { u: b.u, v: -66 }, b: { u: b.u, v: 66 }, y0: b.y0, y1: GATE_TOP, d: 26, name: b.name });
  }
  for (const e of [-1, 1]) {
    for (let u = u0; u < u1;) {
      const len = 50 + 40 * rnd();
      if (!held.some((h) => Math.abs(u + len / 2 - h) < len / 2 + 22 + 26)) tower(u + len / 2, len, e);
      u += len + 26 + 10 * rnd();
    }
  }
  return { obstacles };
}
// the tall second row behind an avenue's or a canyon's walls, so that "over the rooftops beside it" is no way either
const tallRow = (u0, u1, v0, v1, seed) => ({ kind: 'district', u0, u1, v0, v1, block: 90, street: 22, h: [200, 320], seed, style: { cls: 'office', facade: 'glass', roof: 'flat', lit: 0.35 } });
// the hint under a gate building: the altimeter reads above the sea, 4 m under the threshold; the fin stands 9 m up
const gateHint = (c, g, what) => `Under ${what} in ${Math.round((g.u - c.u) / 10) * 10} m: stay below ${altFt(underTop(g.y0))} ft on the altimeter.`;

// ------------------------------------------------------------------ 44: Checkerboard
// The Kai Tak approach: from the south-east over the harbor, heading 45 degrees left of the runway, straight at
// Checkerboard Hill; a right turn of radius CB_R starting 2.1 km out, CB_TURN_ALT up, rolls out on the centerline at u
// CB_E, 1,250 m from the threshold, on the glide path (91 m up). Flying on at the board is flying into the hill. What
// makes the turn the only way (2026-09-23): the inside of the corner - the waterfront between the run-in and the
// final - is a district of office towers 220-300 m tall, taller than the flight, kept 130 m clear of the run-in, the
// turn and the final; cutting the corner, turning early, or heading straight for the runway from the start is a wall.
const CB_R = 1200, CB_E = -1250, CB_TURN_ALT = 122;
const CB_S = { u: CB_E - CB_R * Math.sin(45 * D2R), v: CB_R * (1 - Math.cos(45 * D2R)) };   // where the turn starts
const cbAt = (d) => ({ u: CB_S.u - d * Math.cos(45 * D2R), v: CB_S.v + d * Math.sin(45 * D2R) }); // d metres before it
const CB_C = { u: CB_E, v: CB_R };   // the turn's centre
function cbCourse() {
  const clear = [];
  for (let d = 2800; d >= 0; d -= 80) clear.push({ ...cbAt(d), r: 130 });
  for (let a = 0; a <= 45; a += 3) clear.push({ u: CB_C.u - CB_R * Math.sin((45 - a) * D2R), v: CB_C.v - CB_R * Math.cos((45 - a) * D2R), r: 130 });
  for (let u = CB_E; u <= 0; u += 80) clear.push({ u, v: 0, r: 130 });
  return {
    carve: [{ u0: -4000, u1: -600, v0: 100, v1: 950 }],
    clear,
    obstacles: [{ kind: 'district', u0: -3300, u1: -700, v0: 130, v1: 900, block: 85, street: 22, h: [220, 300], seed: 441, lots: 1, setback: 6, style: { cls: 'office', facade: 'glass', roof: 'crown', lit: 0.35 } }],
  };
}
const checkerboard = {
  id: 'checkerboard', n: 44, title: 'Checkerboard', group: 'city', difficulty: 3, tags: ['city', 'heavy', 'crosswind'],
  aircraft: 'condor', site: 'metro', time: 16.8, vis: 22000,
  desc: `Metro City's famous approach, done the old way: point the airliner at a checkerboard painted on a hill, then turn right 45 degrees at ${aboutFt(CB_TURN_ALT)} ft and find the runway that was hiding behind the towers. The inside of the corner is a new district of 300-metre towers, so there is no cutting it; the hill is the other way. The turn ends ${-CB_E / 1000} kilometres from the threshold, and the crosswind in it does not care.`,
  tips: [
    `Aim straight at the orange and white checkerboard, 150 kt, flaps 30, gear down, and come down to about ${aboutFt(CB_TURN_ALT)} ft on the altimeter by the time you cross the waterfront.`,
    `Two kilometres out, over the shore, roll right into a 25-degree bank and hold it: 45 degrees of turn puts you on a final ${-CB_E / 1000} km long, at about ${aboutFt(onPath(CB_E))} ft. Tighter than that is the towers; wider is the hill.`,
    'The wind is from the right and blows you wide in the turn: tighten it a little. And before the turn, not in it: Arm the spoilers (K) and set autobrake (L).',
  ],
  wind: { rel: 25, speed: 11, gust: 15, turb: 0.2 }, weight: 'normal',
  spawn: { u: Math.round(cbAt(2500).u), v: Math.round(cbAt(2500).v), hdg: -45, alt: 250, gamma: -3, flap: 0.75, speedKt: 150, fixed: true },
  failures: [], scoring: { type: 'runway' },
  course: merge(cbCourse()),
  route: [
    { u: Math.round(cbAt(1600).u), v: Math.round(cbAt(1600).v), alt: 205 },
    { u: CB_S.u, v: CB_S.v, alt: CB_TURN_ALT },
    { u: CB_E, v: 0, alt: onPath(CB_E), arc: 'R', r: CB_R, bank: 45, kt: 146 },
  ],
  hint: (c) => {
    if (c.ac.onGround) return null;
    const toTurn = (c.u - CB_S.u) * -Math.cos(45 * D2R) + (c.v - CB_S.v) * Math.sin(45 * D2R);
    if (toTurn > 700) return `Fly at the checkerboard: turn in ${Math.round(toTurn / 100) * 100} m. The towers on your right are the corner: do not cut it.`;
    if (c.u < CB_S.u + 120 && c.v > 150 && toTurn > -60) return toTurn > 250 ? `Turn right in ${Math.round(toTurn / 50) * 50} m, over the shore.` : 'Turn right now: 25 degrees of bank, and hold it.';
    if (c.u < CB_E && c.v > 12) return 'Keep turning right: 25 degrees, roll out on the centerline.';
    if (c.u < -300 && Math.abs(c.v) > 25) return `Line up: ${Math.round(Math.abs(c.v))} m ${c.v > 0 ? 'left' : 'right'} to the centerline.`;
    return null;
  },
};

// ------------------------------------------------------------------ 45: Downtown
// Grand Avenue: office towers along both sides of the extended centerline from 3.6 km out to 600 m, every one taller
// than the glide path at its feet, and two GATE BUILDINGS across the street, 500 m tall, with their undersides 100 m
// and 82 m up (the glide path is 178 and 136 m there). The start is 700 m before the avenue, 66 m up over the bay:
// straight in on the glideslope meets the first gate building, there is no climbing over 500 m, and beside the avenue
// the second row is 200-320 m. The way in is down the street under both, 66 m up, then up onto the glideslope.
const DT_GATES = [{ u: -3000, y0: 100, name: 'the first gate building' }, { u: -2200, y0: 82, name: 'the second gate building' }];
const DT_ALT = 66;   // the route's height down the avenue (the CG, above the threshold elevation)
const downtown = {
  id: 'downtown', n: 45, title: 'Downtown', group: 'city', difficulty: 4, tags: ['city', 'heavy', 'low'],
  aircraft: 'condor', site: 'metro', time: 12.4, vis: 25000,
  desc: 'Metro Intl sits at the end of Grand Avenue, and somebody built two gate buildings across it, 500 metres tall, with an archway each: the first 100 metres up, the second 82. You start 700 m short of the avenue, 220 ft over the bay, too low to climb over anything. Down the street under both, then up onto the glideslope and land.',
  tips: [
    `Hold ${altFt(DT_ALT, Math.round)} ft on the altimeter down the avenue: the archways' undersides are at ${altFt(DT_GATES[0].y0)} and ${altFt(DT_GATES[1].y0)} ft, and your fin stands 30 ft above you.`,
    'Stay in the middle of the avenue: it is 120 m wide and you are 34. Small bank angles only; the wind swirls between the towers.',
    `Under the second archway (below ${altFt(underTop(DT_GATES[1].y0))} ft), climb gently onto the glideslope, which is ${altFt(onPath(-1400), Math.round)} ft at 1.4 km, and fly it down. Arm the spoilers (K) and set autobrake (L).`,
  ],
  wind: { rel: -30, speed: 10, gust: 16, turb: 0.28 }, weight: 'normal',
  spawn: { u: -4300, v: 0, alt: DT_ALT, gamma: 0, flap: 0.75, speedKt: 150, fixed: true },
  failures: [], scoring: { type: 'runway' },
  course: merge(
    { carve: [{ u0: -3800, u1: -350, v0: -340, v1: 340 }], ground: [{ u0: -3800, u1: -350, v0: -165, v1: 165, kind: 'avenue', keep: false }] },
    avenueCourse(-3600, -600, DT_GATES, 45),
    { obstacles: [tallRow(-3700, -700, 165, 340, 451), tallRow(-3700, -700, -340, -165, 452)] },
  ),
  route: [
    { u: -4000, v: 0, alt: DT_ALT },
    { u: -3050, v: 0, alt: DT_ALT },
    { u: -2200, v: 0, alt: DT_ALT, over: true },
    { u: -1400, v: 0, alt: onPath(-1400), kt: 146 },
  ],
  hint: (c) => {
    if (c.ac.onGround) return null;
    if (c.u < DT_GATES[1].u) {
      if (Math.abs(c.v) > 25) return `Back to the middle of the avenue: ${Math.round(Math.abs(c.v))} m ${c.v > 0 ? 'left' : 'right'}.`;
      return gateHint(c, c.u < DT_GATES[0].u ? DT_GATES[0] : DT_GATES[1], c.u < DT_GATES[0].u ? 'the first archway' : 'the second archway');
    }
    if (c.u < -1400) return 'Through. Climb gently onto the glideslope and fly it down.';
    return null;
  },
};

// ------------------------------------------------------------------ 46: Slalom
// A canyon down the final from 4.6 km out to 1.5 km, 400 m walls 288 m apart, with three cross-walls 800 m apart and a
// 56 m slot in each, 60 m right, left and right of the centerline. The start is inside the canyon, 110 m up, below
// the glide path: straight in on the glideslope hits the first wall, there is no climbing out, and the side walls
// are the only other thing to hit. RoutePilot flies arcs of 1,363 m radius (24 degrees of bank at 150 kt) through
// the slots, level at 110 m, then up onto the path.
const SL_APEX = [{ u: -3400, v: 60 }, { u: -2600, v: -60 }, { u: -1800, v: 60 }];
const SL_ALT = 110;
const slalom = {
  id: 'slalom', n: 46, title: 'Slalom', group: 'city', difficulty: 4, tags: ['city', 'heavy'],
  aircraft: 'condor', site: 'metro', time: 18.9, vis: 30000,
  desc: 'Somebody built a canyon down the final approach: 400-metre walls either side of a street 288 m wide, three walls across it, and one slot in each, 56 m wide, 60 metres right, then left, then right of the centerline. You start inside it at 370 ft and 150 kt. Weave the airliner through all three, then land as if nothing happened.',
  tips: [
    'Each slot is 56 m wide and you are 34. Be on the slot\'s side of the centerline before you reach it, not on your way there.',
    `Hold ${altFt(SL_ALT, Math.round)} ft on the altimeter and a steady 25-degree bank, reversed smoothly halfway between two slots. Roll early: a 150-ton airplane takes two seconds to roll.`,
    'After the third slot, a gentle turn back onto the centerline and up onto the glideslope: 1.4 km to go. Arm the spoilers (K) and set autobrake (L).',
  ],
  wind: { rel: 20, speed: 8, turb: 0.2 }, weight: 'normal',
  spawn: { u: -4800, v: 0, alt: SL_ALT, gamma: 0, flap: 0.75, speedKt: 150, fixed: true },
  failures: [], scoring: { type: 'runway' },
  course: merge({ carve: [{ u0: -4800, u1: -1300, v0: -330, v1: 330 }], ground: [{ u0: -4700, u1: -1400, v0: -330, v1: 330, kind: 'plaza', keep: false }] }, canyon(-4600, -1500, SL_APEX, 46)),
  route: [
    { u: -4300, v: 0, alt: SL_ALT },
    ...sCurve(-4300, 0, SL_APEX[0].u, SL_APEX[0].v, SL_ALT, SL_ALT),
    ...sCurve(SL_APEX[0].u, SL_APEX[0].v, SL_APEX[1].u, SL_APEX[1].v, SL_ALT, SL_ALT),
    ...sCurve(SL_APEX[1].u, SL_APEX[1].v, SL_APEX[2].u, SL_APEX[2].v, SL_ALT, SL_ALT),
    ...sCurve(SL_APEX[2].u, SL_APEX[2].v, -1000, 0, SL_ALT, onPath(-1000), 146),
  ],
  hint: (c) => {
    if (c.ac.onGround) return null;
    const h = slotHint(c, SL_APEX);
    if (h) return h;
    if (c.u < -300 && Math.abs(c.v) > 20) return `Back onto the centerline: ${Math.round(Math.abs(c.v))} m ${c.v > 0 ? 'left' : 'right'}.`;
    return null;
  },
};

// ------------------------------------------------------------------ 47: Under the Bridge
// The Coast Road's viaduct crosses the final 1.2 km out: a cable-stayed bridge a kilometre long, its deck 70 m up,
// four pylons 300 m tall at v -300, -100, 100 and 300, and from each a fan of stays to the deck 20 to 160 m either side
// of it - the fans from neighbouring pylons cross, so above the deck the air is a mesh of cables up to the pylon
// tops. The start is 450 m before it, 45 m up: over the deck is a stay, climbing over 300 m is not on, and round the
// ends is a kilometre of side-step in 450 m. Under the deck between the middle pylons (200 m apart) is the only way,
// then a low final: the glideslope comes down to meet you 800 m out.
const CG_U = -1200, CG_DECK = 70, CG_PYLON = 300;
function viaduct() {
  const obstacles = [{ kind: 'box', u: CG_U, v: 0, w: 1000, d: 30, y0: CG_DECK, y1: CG_DECK + 4, look: 'concrete', name: 'the viaduct' }];
  for (const v of [-300, -100, 100, 300]) {
    obstacles.push({ kind: 'tower', u: CG_U, v, w: 10, d: 10, top: CG_PYLON, name: 'a viaduct pylon', style: { cls: 'landmark', facade: 'concrete', height: 'super' } });
    for (const z of [-12, 12]) for (const e of [-1, 1]) for (let k = 1; k <= 8; k++) obstacles.push({ kind: 'cable', a: { u: CG_U + z, v, y: CG_PYLON - 2 }, b: { u: CG_U + z, v: v + e * k * 20, y: CG_DECK + 4 }, r: 0.15, name: 'a viaduct stay' });
  }
  for (const v of [-500, -400, -200, 200, 400, 500]) obstacles.push({ kind: 'box', u: CG_U, v, w: 6, d: 8, y0: -20, y1: CG_DECK, look: 'concrete', name: 'a viaduct pier' });
  return { obstacles };
}
const underBridge = {
  id: 'under-bridge', n: 47, title: 'Under the Bridge', group: 'city', difficulty: 3, tags: ['city', 'heavy', 'low'],
  aircraft: 'condor', site: 'metro', time: 8.3, vis: 18000,
  desc: 'The Coast Road crosses the final approach on a viaduct 1.2 km out: a deck 70 metres up, four pylons 300 metres tall, and a mesh of stays above the deck from one end to the other. You start 450 m short of it at 150 ft, too low and too close for anything but under. Under the deck between the middle pylons, then a low final.',
  tips: [
    `Under the deck means under ${raFt(underTop(CG_DECK))} ft on the radio altimeter: your fin stands 30 ft above you. Aim between the two middle pylons, 200 m apart.`,
    'Wings level through it. Do not dip a wing: at 150 ft a 10-degree bank puts a wingtip 3 m closer to the pylon.',
    'Past the viaduct, hold your height: the glideslope comes down to meet you 800 m out. Arm the spoilers (K) and set autobrake (L).',
  ],
  wind: { rel: -20, speed: 9, turb: 0.2 }, weight: 'normal',
  spawn: { u: -1650, v: 0, alt: 45, gamma: 0, flap: 0.75, speedKt: 150, fixed: true },
  failures: [], scoring: { type: 'runway' },
  course: merge({ carve: [{ u0: -1400, u1: -1000, v0: -520, v1: 520 }] }, viaduct()),
  route: [
    { u: -1500, v: 0, alt: 48 },
    { u: -1150, v: 0, alt: 48, over: true },
    { u: -700, v: 0, alt: 58, kt: 146 },
  ],
  hint: (c) => {
    if (c.ac.onGround) return null;
    if (c.u < CG_U) {
      if (Math.abs(c.v) > 60) return `Between the middle pylons: ${Math.round(Math.abs(c.v))} m ${c.v > 0 ? 'left' : 'right'}.`;
      if (c.ra > raFt(underTop(CG_DECK)) + 5) return `Too high for the deck: down to ${raFt(underTop(CG_DECK))} ft (${Math.round(c.ra)} ft).`;
      return `Under the viaduct in ${Math.round((CG_U - c.u) / 10) * 10} m: wings level, below ${raFt(underTop(CG_DECK))} ft.`;
    }
    if (c.u < -800) return 'Through. Hold your height: the glideslope comes down to meet you.';
    return null;
  },
};

// ------------------------------------------------------------------ 48: The Needle
const NG = needleGeom(-1900, 600);
const needle = {
  id: 'the-needle', n: 48, title: 'The Needle', group: 'city', difficulty: 5, tags: ['city', 'heavy'],
  aircraft: 'condor', site: 'metro', time: 19.4, vis: 30000,
  desc: `Two glass towers stand on the waterfront, ${NEEDLE_GAP} metres apart and joined all the way up, at the end of the Crescent: a curved canyon of 300-metre towers that narrows to the gap. Wings level the airliner is 35 metres wide; banked ${NEEDLE_BANK} degrees it is ${CONDOR_WIDTH[NEEDLE_BANK]}. You start inside the Crescent, turn onto final through the eye in a steady bank, roll out and land.`,
  tips: [
    `Hold the line you start on, ${NEEDLE_TURN} degrees left of the runway, at 150 kt, flaps 30 and 250 ft, down the middle of the Crescent. The eye (the archway under the towers) is off to your right: do not aim at it yet.`,
    `About ${Math.round(NG.roll.d / 50) * 50} m before the towers, with the eye ${Math.round(NG.roll.b)} degrees right of your nose, roll right into a steady turn of about ${NEEDLE_BANK} degrees: you go through the eye ${NEEDLE_TURN + NEEDLE_PSI} degrees into it. The hint counts down to the roll, then shows the bank to hold: the wind moves it.`,
    `Keep turning until the runway is ahead and roll out on the centerline, about ${Math.round(NG.roll.out / 10) * 10} m past the towers. Hold 250 ft; the glideslope comes down to meet you a kilometre out. Arm the spoilers (K) and set autobrake (L).`,
  ],
  wind: { rel: 10, speed: 5, turb: 0.1 }, weight: 'normal',
  spawn: { ...NG.spawn },
  failures: [], scoring: { type: 'runway' },
  course: merge({ carve: [{ u0: -2950, u1: -1300, v0: -200, v1: 1050 }] }, crescent(NG)),
  route: [
    ...needleRoute(NG, NEEDLE_ALT),
    { u: -1400, v: 0, alt: NEEDLE_ALT },
    { u: meetPath(NEEDLE_ALT), v: 0, alt: NEEDLE_ALT, kt: 146 },
  ],
  hint: (c) => {
    if (c.ac.onGround) return null;
    if (!NG.pastEye(c)) return NG.hint(c);
    return rollOutHint(c, NG, 'hold 250 ft: the glideslope comes down to meet you');
  },
};

// ------------------------------------------------------------------ 49: The Gauntlet
// At night in a storm: the Crescent and the Needle out in the bay (the eye 7 km out, 1.3 km before the bridge so a
// pilot handed over at the eye can get down for it; the walls on piers; a 1.6 km mouth for RoutePilot to settle in
// the gusts), the Harbor Bridge (under it at 100 ft, or over the middle of its span
// above the main cable), then a canyon from 4.2 km with two slots (3.5 and 2.7 km out) whose walls run on into Grand
// Avenue and its gate building 1.7 km out (underside 80 m), and land. The tall second rows either side of the canyon
// and the avenue leave no way round. The weather spec is for the storm's look and model; the wind below is what the
// physics flies.
const GG = needleGeom(-7000, 1600);
const GA_APEX = [{ u: -3500, v: 60 }, { u: -2700, v: -60 }];
const GA_GATES = [{ u: -1700, y0: 80, name: 'the gate building' }];
const gauntlet = {
  id: 'gauntlet', n: 49, title: 'The Gauntlet', group: 'city', difficulty: 5, tags: ['city', 'heavy', 'night', 'storm'],
  aircraft: 'condor', site: 'metro', time: 21.8, vis: 7000,
  weather: { preset: 'storm', rain: 0.7, lightning: 0.5, darkness: 0.6 },
  desc: 'Four of the city\'s missions in one approach, at night, in a thunderstorm: through the Needle at the end of its Crescent, past the Harbor Bridge, through two slots in a canyon and down Grand Avenue under its gate building. Then land, with the rain coming sideways. One airliner, no second go.',
  tips: [
    `It is the missions before this one, back to back: the Needle in a turn of about ${NEEDLE_BANK} degrees (the hint says when to roll and how far), the bridge under ${raFt(underTop(BRIDGE.deckY - 4))} ft on the radio altimeter or over the middle of its span, the slots in a 25-degree weave at ${altFt(100, Math.round)} ft, the avenue under ${altFt(underTop(GA_GATES[0].y0))} ft on the altimeter.`,
    'Fly the lights: the Crescent and the canyon walls are lit, the gate building has red lights under its arch, the bridge deck is lit yellow.',
    'Gusts to 18 kt: small bank angles everywhere except in the eye, and do the checklist over the bay. Arm the spoilers (K) and set autobrake (L).',
  ],
  wind: { rel: 30, speed: 12, gust: 18, turb: 0.25 }, weight: 'normal',
  spawn: { ...GG.spawn },
  failures: [], scoring: { type: 'runway' },
  course: merge(
    { carve: [{ u0: -8900, u1: -6400, v0: -200, v1: 1350 }, { u0: -4400, u1: -350, v0: -700, v1: 700 }], ground: [{ u0: -4300, u1: -350, v0: -165, v1: 165, kind: 'avenue', keep: false }] },
    crescent(GG),
    canyon(-4200, -1850, GA_APEX, 49),
    avenueCourse(-1800, -560, GA_GATES, 490),
    { obstacles: [tallRow(-4300, -600, 190, 700, 491), tallRow(-4300, -600, -700, -190, 492)] },
  ),
  route: [
    ...needleRoute(GG, NEEDLE_ALT),
    { u: -6300, v: 0, alt: 40 },
    { u: -5150, v: 0, alt: 30 },
    { u: -4300, v: 0, alt: 100 },
    ...sCurve(-4300, 0, GA_APEX[0].u, GA_APEX[0].v, 100, 100),
    ...sCurve(GA_APEX[0].u, GA_APEX[0].v, GA_APEX[1].u, GA_APEX[1].v, 100, 100),
    ...sCurve(GA_APEX[1].u, GA_APEX[1].v, -1900, 0, 100, 68),
    { u: -1700, v: 0, alt: 64, over: true },
    { u: -1100, v: 0, alt: onPath(-1100), kt: 146 },
  ],
  hint: (c) => {
    if (c.ac.onGround) return null;
    if (!GG.pastEye(c)) return GG.hint(c);
    if (c.u < -6400) return rollOutHint(c, GG, 'down to 100 ft for the bridge');
    if (c.u < BRIDGE.u) return c.ra > raFt(underTop(BRIDGE.deckY - 4)) ? 'The Harbor Bridge: under it at 100 ft over the water, or over the middle of the span above the cable.' : 'Under the bridge: hold 100 ft, wings level.';
    if (c.u < -4200) return `The canyon ahead: ${altFt(100, Math.round)} ft, the middle of the street.`;
    const h = c.u < GA_APEX[1].u + 40 ? slotHint(c, GA_APEX) : null;
    if (h) return h;
    if (c.u < GA_GATES[0].u) return Math.abs(c.v) > 25 ? `The avenue: ${Math.round(Math.abs(c.v))} m ${c.v > 0 ? 'left' : 'right'}.` : gateHint(c, GA_GATES[0], 'the gate building');
    if (c.u < -900) return 'Through. Hold your height: the glideslope comes down to meet you.';
    return null;
  },
};

// (for the tests: the Needle's numbers and geometry - the standalone rung's, and the Gauntlet's crescent)
export const NEEDLE = { fin: FIN, width: CONDOR_WIDTH, gap: NEEDLE_GAP, bank: NEEDLE_BANK, r: NEEDLE_R, apBank: NEEDLE_AP_BANK, rAp: NEEDLE_R_AP, aim: NG.aim, psi: NEEDLE_PSI, turn: NEEDLE_TURN, lean: NEEDLE_LEAN, kt: NEEDLE_KT, eye: EYE, alt: NEEDLE_ALT, h: NEEDLE_H, spawn: NG.spawn, roll: NG.roll, path: NG.path, dir: NEEDLE_DIR, geom: NG, gauntlet: GG };

export const CITY_MISSIONS = [checkerboard, downtown, slalom, underBridge, needle, gauntlet];
