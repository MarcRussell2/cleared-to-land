// New missions: the city ladder ("The city", n 44-49), and Metro City, the site they are flown at. Each entry follows
// src/missions/README.md; ids are permanent. The obstacles are built by src/world/obstacles.js from the `course`
// specs below (its header lists every kind; `district`, `landmark`, `skybridge`, round and pier-standing towers and
// the bridge's parts were added for this ladder); the look is src/art/city-look.js, whose header is the drawing
// contract (and docs/briefs/city/city-look.txt the art brief). The routes are what RoutePilot flies to prove each
// mission lands (tools/fly-mission.mjs, tools/test-city.mjs); the tips tell a human the same technique.
//
// Hints get ctx = { ac, ra (ft), d (m to the threshold), t, u, v (runway frame, metres), mission }, where
// mission.next() is the next pending gate ({ gate, dist }) or null. They name no keys.
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
// skybridges and gates.
const BRIDGE = { u: -5700, v: 0, rot: 33.7, length: 1442, deckY: 60 };   // (west end on the shore at u -5300 v -600)
// its deck's underside above the threshold elevation (deckY is above the water, 4 m under the threshold), and the gate
// under it (47, 49)
const BRIDGE_UNDER = BRIDGE.deckY - 4, BRIDGE_GATE = 'the gap under the Harbor Bridge';
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
// A gate's name at the start of a hint.
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const OFFICE = (h) => ({ cls: 'office', facade: 'glass', roof: 'crown', lit: 0.35, height: h < 60 ? 'mid' : h < 150 ? 'high' : 'super' });
// Heights as the instruments read them. The altimeter reads the CG's height above the sea, which is SEA metres under
// the threshold; the radio altimeter reads the wheels' height, CG_H metres under the Condor's CG, above the water or the
// ground under it. Both in feet, rounded down to tens (a limit quoted as "below N ft" is then on the safe side).
const SEA = 4, CG_H = 4.1;
const altFt = (y, f = Math.floor) => f((y + SEA) / 0.3048 / 10) * 10;  // a CG height above the threshold elevation
const raFt = (y) => Math.floor((y + SEA - CG_H) / 0.3048 / 10) * 10;    // the same over the harbor
const aboutFt = (y) => Math.round((y + SEA) / 0.3048 / 50) * 50;        // a height to fly, on the altimeter, to 50 ft
// A gate under something (a skybridge, the bridge's deck): the CG between `low` and the underside less the Condor's fin
// (FIN metres above its CG; tools/test-city.mjs checks it against the hull) and half a metre, so a crossing that
// takes the whole airplane under the structure counts, and one that would hit it is outside the frame.
const FIN = 9.1;   // (the hull's fin tops out 9.02 m over the CG)
const underTop = (under) => under - FIN - 0.5;
const underGate = (u, v, low, under, w, name) => ({ u, v, y: (low + underTop(under)) / 2, w, h: underTop(under) - low, name });
// The Condor's probe footprint across its path, banked (metres, flaps 30, gear down; tools/test-city.mjs checks it).
const CONDOR_WIDTH = { 30: 31, 35: 30, 40: 28, 45: 26 };
const BRIDGE_GATE_TOP = underTop(BRIDGE_UNDER);

// ---- The Needle (48, 49): two round glass towers on a pier in the bay, NEEDLE_GAP apart, joined at the top by a
// skybridge. The gap is on a right turn onto the final, from a heading NEEDLE_TURN degrees left of the runway's to
// the runway's own. Two lines go through it, both through the same aim point (NEEDLE_AIM: where the CG crosses the
// gate) at the same heading there (NEEDLE_PSI):
//   - the pilot's: a steady turn of radius NEEDLE_R (NEEDLE_BANK, 35 degrees, at 150 kt in still air) that starts on
//     the line the flight starts on, passes the eye 45 degrees in and rolls out on the centerline 15 degrees later.
//     The spawn is on this line; the tips describe it, and the HUD hint is a flight director on it (needleCue: when
//     to roll, then the bank to hold - which the wind moves: the turn is into it, and the director asked for 29-33
//     degrees at the eye in both missions' winds). A pilot who flies exactly what the hint says, never past the
//     Assist's 35 degrees, went through the eye on 20 seeds of 20 in The Needle's wind (0.5-1.4 m to spare) and 16
//     of 20 in the Gauntlet's 18-kt gusts (tools/test-city.mjs flies it).
//   - RoutePilot's: a tighter turn through the same eye at NEEDLE_AP_BANK (40 degrees, radius NEEDLE_R_AP), for room:
//     banked 40 degrees the airliner is 1.7 m narrower than at 35. It starts on a parallel line 42 m to the right and
//     rolls out 5 m right of the centerline. Over 100 seeds it went through every time: 1.7 m to spare at the closest
//     in The Needle, 1.1 m in the Gauntlet.
// The Condor's probe footprint banked 0 / 30 / 35 / 40 / 45 degrees is 35.0 / 31.3 / 29.9 / 28.2 / 26.3 m wide
// (tools/test-city.mjs prints it and checks CONDOR_WIDTH), its middle about 1 m toward the low wing: so the gap's
// middle is placed NEEDLE_LEAN inside the turn from the aim point, and the gate (the frame drawn round the eye) is
// centred on the aim point - aiming at the middle of the frame is right. The gap is 34 m, 0.3 m less than the span
// and 1 m less than the airliner is wide wings level with its winglets (a 33 m gap left the Assist-limited pilot, who
// reaches the eye at 29-33 degrees, too little room: 1 m at 30). It leaves a window of 4.1 m at 35 degrees, 5.8 at 40.
// TIGHTEN LATER: once the flight-physics review removes the Assist's 35-degree bank limit, raise NEEDLE_BANK to 40,
// NEEDLE_AP_BANK to 45 and bring NEEDLE_GAP down to about 30 m (a 1.8 m window at 40 degrees, 3.7 at 45), and check
// the hint-following pilot in tools/test-city.mjs again with its bank limit raised; the tips, the hint and the
// description take their numbers from these constants.
const KT_MS = 0.514444, GRAV = 9.81;
const radiusFor = (bank, kt) => Math.pow(kt * KT_MS, 2) / (GRAV * Math.tan(bank * D2R));
const NEEDLE_GAP = 34, NEEDLE_TURN = 60, NEEDLE_PSI = -15, NEEDLE_KT = 150, NEEDLE_LEAN = 0.95;
const NEEDLE_BANK = 35, NEEDLE_R = Math.round(radiusFor(NEEDLE_BANK, NEEDLE_KT));           // 867 m
const NEEDLE_AP_BANK = 40, NEEDLE_R_AP = Math.round(radiusFor(NEEDLE_AP_BANK, NEEDLE_KT));  // 723 m
const NEEDLE_AIM = { u: -7250, v: Math.round(NEEDLE_R * (1 - Math.cos(NEEDLE_PSI * D2R)) * 100) / 100 };
const NEEDLE_TOWER_R = 12, NEEDLE_H = 185, NEEDLE_ALT = 75, EYE = 'the eye of the Needle';
// The right turn of radius R through the aim point at heading NEEDLE_PSI: its centre, where it starts (heading
// -NEEDLE_TURN) and where it ends (heading 0).
function needleTurn(R) {
  const p = NEEDLE_PSI * D2R, a = NEEDLE_TURN * D2R;
  const c = { u: NEEDLE_AIM.u - R * Math.sin(p), v: NEEDLE_AIM.v + R * Math.cos(p) };
  return { c, S: { u: c.u - R * Math.sin(a), v: c.v - R * Math.cos(a) }, E: { u: c.u, v: c.v - R } };
}
// Back along the run-in (heading -NEEDLE_TURN) from a point, d metres.
const runIn = (P, d) => ({ u: P.u - d * Math.cos(NEEDLE_TURN * D2R), v: P.v + d * Math.sin(NEEDLE_TURN * D2R) });
function needleCourse() {
  const p = NEEDLE_PSI * D2R, nu = -Math.sin(p), nv = Math.cos(p);   // the right-hand normal to the turn at the eye
  const cu = NEEDLE_AIM.u + NEEDLE_LEAN * nu, cv = NEEDLE_AIM.v + NEEDLE_LEAN * nv, off = NEEDLE_GAP / 2 + NEEDLE_TOWER_R;
  const L = { u: cu - off * nu, v: cv - off * nv }, R = { u: cu + off * nu, v: cv + off * nv };
  const style = { cls: 'landmark', facade: 'glass', roof: 'spire', lit: 0.6, height: 'super', landmark: 'needle' };
  return {
    obstacles: [
      { kind: 'quay', u: cu, v: cv, rot: NEEDLE_PSI, w: 110, d: 150, top: 4, depth: 12, name: 'the Needle\'s pier' },
      { kind: 'tower', round: true, u: L.u, v: L.v, w: 2 * NEEDLE_TOWER_R, h: NEEDLE_H, deck: 4, antenna: 25, name: 'the Needle', style },
      { kind: 'tower', round: true, u: R.u, v: R.v, w: 2 * NEEDLE_TOWER_R, h: NEEDLE_H, deck: 4, antenna: 25, name: 'the Needle', style },
      { kind: 'skybridge', a: L, b: R, y0: 118, y1: 134, d: 18, name: 'the Needle', style: { cls: 'skybridge', facade: 'glass', lit: 0.7, landmark: 'needle' } },
    ],
    // (the frame round the eye is centred on the aim point, NEEDLE_LEAN outside the gap's middle; 22 m wide, it is
    // wider than the room between the towers, which are what decide it)
    gates: [{ u: NEEDLE_AIM.u, v: NEEDLE_AIM.v, rot: NEEDLE_PSI, y: 72, w: 22, h: 60, bank: NEEDLE_BANK, name: EYE }],
  };
}
// RoutePilot's line through the Needle: a straight run-in on the start heading, then its 40-degree arc.
function needleRoute(alt, kt = NEEDLE_KT) {
  const { S, E } = needleTurn(NEEDLE_R_AP);
  return [
    { ...runIn(S, 1100), alt, kt },
    { u: S.u, v: S.v, alt, kt },
    { u: E.u, v: Math.round(E.v * 10) / 10, alt, arc: 'R', r: NEEDLE_R_AP, kt, bank: 45 },
  ];
}
// Where both missions start: on the pilot's line, 2.5 km before its turn begins (room to settle and line up).
const spawnOn = (path) => { const P = runIn(path.S, 2500); return { u: Math.round(P.u), v: Math.round(P.v) }; };
const NEEDLE_SPAWN = { ...spawnOn(needleTurn(NEEDLE_R)), hdg: -NEEDLE_TURN, alt: NEEDLE_ALT + 5, gamma: 0, flap: 0.75, speedKt: NEEDLE_KT, fixed: true };
// The pilot's line in numbers, for the tips: the roll starts where the cue says (needleCue: the roll's lead before
// the turn); from there the eye is `d` metres away and `b` degrees right of the nose; the roll-out is `out` metres of
// turn past the eye.
const NEEDLE_ROLL = (() => {
  const H = needleTurn(NEEDLE_R), V = NEEDLE_KT * KT_MS, a = -NEEDLE_TURN * D2R;
  const P = runIn(H.S, V * (0.4 * NEEDLE_BANK / 15 + 0.5));
  const du = NEEDLE_AIM.u - P.u, dv = NEEDLE_AIM.v - P.v;
  return { d: Math.hypot(du, dv), b: (Math.atan2(dv, du) - a) / D2R, out: NEEDLE_R * -NEEDLE_PSI * D2R };
})();
// The HUD's cue through the Needle (and a hand-flown pilot's): a flight director on the pilot's circle (radius
// NEEDLE_R through the aim point). On the run-in, `ahead` counts down to where the roll should start: the circle's
// start less the roll's lead (as RoutePilot leads its arcs: 40% of the roll at 15 degrees a second and its half-second
// lag). From there, `bank` is the bank the circle needs at this ground speed (NEEDLE_BANK in still air) plus a
// correction for being off it: NEEDLE_DIR.k degrees per metre outside, NEEDLE_DIR.kd per m/s drifting outward (the
// gains of RoutePilot's arc law, without its integral). The wind changes the ground speed round the turn, and the cue
// changes the bank with it; the room for that is why the pilot's circle needs a little less than the most bank the
// Assist allows. Reads the runway frame from the mission's world; allocation-free (one object, reused).
const NEEDLE_DIR = { k: 0.69, kd: 2.9, max: 10, rollRate: 15, rollLag: 0.5 };
// A pilot's circle through the aim point, radius R: its centre, its start and the run-in's direction.
function pilotPath(R) {
  const H = needleTurn(R), a0 = -NEEDLE_TURN * D2R;
  return { R, c: H.c, S: H.S, d0: { u: Math.cos(a0), v: Math.sin(a0) } };
}
const NEEDLE_PATH = pilotPath(NEEDLE_R);
const _cue = { bank: 0, ahead: 0, off: 0, d: 0 };
function needleCue(c, P = NEEDLE_PATH) {
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
  _cue.d = Math.hypot(NEEDLE_AIM.u - c.u, NEEDLE_AIM.v - c.v);
  return _cue;
}
// The hint while the eye is the next gate (both missions): hold the run-in until the roll, then the bank to hold.
function needleHint(c, P = NEEDLE_PATH) {
  const q = needleCue(c, P), bank = c.ac.euler.roll / D2R, want = Math.round(q.bank);
  if (q.ahead > 0) {
    if (Math.abs(q.off) > 30) return `Line up on the run-in, ${NEEDLE_TURN} degrees left of the runway: ${Math.round(Math.abs(q.off))} m ${q.off > 0 ? 'left' : 'right'}.`;
    return q.ahead > 60 ? `The Needle: hold this line and 250 ft. Roll right in ${Math.round(q.ahead / 50) * 50} m.` : 'Stand by to roll right.';
  }
  if (bank < want - 12) return `Roll right now: ${want} degrees.`;
  return want > NEEDLE_BANK + 2 ? `Bank ${want} degrees through the eye: tighter.` : `Bank ${want} degrees through the eye.`;
}
// (for the tests: the Needle's numbers)
export const NEEDLE = { fin: FIN, width: CONDOR_WIDTH, gap: NEEDLE_GAP, bank: NEEDLE_BANK, r: NEEDLE_R, apBank: NEEDLE_AP_BANK, rAp: NEEDLE_R_AP, aim: NEEDLE_AIM, psi: NEEDLE_PSI, turn: NEEDLE_TURN, lean: NEEDLE_LEAN, kt: NEEDLE_KT, eye: EYE, alt: NEEDLE_ALT, spawn: NEEDLE_SPAWN, roll: NEEDLE_ROLL, path: NEEDLE_PATH, dir: NEEDLE_DIR };

// ---- The slalom (46, 49): pairs of skyscrapers with a 56 m gap between them, each gap 60 m left or right of the
// centerline, 800 m apart. The towers either side of a gap reach the centerline, so a straight approach hits them.
const SLALOM_GAP = 56, SLALOM_TW = 32;
function slalomTowers(apexes, seed) {
  const rnd = rngOf(seed), obstacles = [], gates = [];
  apexes.forEach((a, i) => {
    const off = SLALOM_GAP / 2 + SLALOM_TW / 2;
    for (const e of [-1, 1]) {
      const h = Math.max(glide(a.u) + 70, 190) + 60 * rnd();
      obstacles.push({ kind: 'tower', u: a.u, v: a.v + e * off, w: SLALOM_TW, d: SLALOM_TW + 8 * rnd(), h, antenna: rnd() < 0.4 ? 18 : 0, name: 'a skyscraper', style: OFFICE(h) });
    }
    // (the gate: the middle 20 m of the 56 m gap, where even wings level clears the towers either side)
    gates.push({ u: a.u, v: a.v, y: a.y, w: 20, h: 50, name: `gap ${i + 1}` });
  });
  // the forest round them: more skyscrapers well off the line, between and beside the gaps
  const u0 = apexes[0].u - 500, u1 = apexes[apexes.length - 1].u + 500;
  for (let u = u0; u <= u1; u += 180 + 60 * rnd()) for (const e of [-1, 1]) {
    const v = e * (170 + 110 * rnd()), h = 120 + 150 * rnd();
    obstacles.push({ kind: 'tower', u, v, w: 30 + 20 * rnd(), d: 30 + 20 * rnd(), h, rot: (rnd() - 0.5) * 20, name: 'a skyscraper', style: OFFICE(h) });
  }
  return { obstacles, gates };
}

// ---- Grand Avenue (45, 49): office towers taller than the glide path on both sides of a 120 m street down the
// extended centerline, and skybridges across it, lower than the glide path, that you can only fly under.
function avenueCourse(u0, u1, bridges, seed) {
  const rnd = rngOf(seed), obstacles = [], gates = [];
  const tower = (u, len, e) => {
    const w = 38 + 26 * rnd(), h = Math.max(glide(u) + 45 + 60 * rnd(), 105 + 55 * rnd());
    obstacles.push({ kind: 'tower', u, v: e * (60 + w / 2), w, d: len, h, antenna: rnd() < 0.25 ? 20 : 0, name: 'an office tower', style: OFFICE(h) });
  };
  // a pair of towers holding each skybridge, then the rest of the street between cross streets
  const held = bridges.map((b) => b.u);
  for (const b of bridges) {
    for (const e of [-1, 1]) tower(b.u, 44, e);
    obstacles.push({ kind: 'skybridge', a: { u: b.u, v: -66 }, b: { u: b.u, v: 66 }, y0: b.y0, y1: b.y1, d: 26, name: b.name });
    // (the gate: from 12 m up to the underside less the fin, underGate(), 30 m before the skybridge's middle)
    gates.push(underGate(b.u - 30, 0, 12, b.y0, 90, `the gap under ${b.name}`));
  }
  for (const e of [-1, 1]) {
    for (let u = u0; u < u1;) {
      const len = 50 + 40 * rnd();
      if (!held.some((h) => Math.abs(u + len / 2 - h) < len / 2 + 22 + 26)) tower(u + len / 2, len, e);
      u += len + 26 + 10 * rnd();
    }
  }
  return { obstacles, gates };
}
const merge = (...cs) => ({
  obstacles: cs.flatMap((c) => c.obstacles || []), gates: cs.flatMap((c) => c.gates || []),
  carve: cs.flatMap((c) => c.carve || []), clear: cs.flatMap((c) => c.clear || []), ground: cs.flatMap((c) => c.ground || []),
});

// ------------------------------------------------------------------ 44: Checkerboard
// The Kai Tak approach: from the south-east over the harbor, heading 45 degrees left of the runway, straight at
// Checkerboard Hill; a right turn of radius CB_R starting 2.1 km out, CB_TURN_ALT up, rolls out on the centerline at u
// CB_E, 1,250 m from the threshold, on the glide path (91 m up). Flying on at the board is flying into the hill.
const CB_R = 1200, CB_E = -1250, CB_TURN_ALT = 122;
const CB_S = { u: CB_E - CB_R * Math.sin(45 * D2R), v: CB_R * (1 - Math.cos(45 * D2R)) };   // where the turn starts
const cbAt = (d) => ({ u: CB_S.u - d * Math.cos(45 * D2R), v: CB_S.v + d * Math.sin(45 * D2R) }); // d metres before it
const checkerboard = {
  id: 'checkerboard', n: 44, title: 'Checkerboard', group: 'city', difficulty: 3, tags: ['city', 'heavy', 'crosswind'],
  aircraft: 'condor', site: 'metro', time: 16.8, vis: 22000,
  desc: `Metro City's famous approach, done the old way: point the airliner at a checkerboard painted on a hill, then turn right 45 degrees at ${aboutFt(CB_TURN_ALT)} ft and find the runway that was hiding behind the apartment blocks. The turn ends ${-CB_E / 1000} kilometres from the threshold. The crosswind in it does not care.`,
  tips: [
    `Aim straight at the orange and white checkerboard, 150 kt, flaps 30, gear down, and come down to about ${aboutFt(CB_TURN_ALT)} ft on the altimeter by the time you cross the waterfront.`,
    `Two kilometres out, over the shore, roll right into a 25-degree bank and hold it: 45 degrees of turn puts you on a final ${-CB_E / 1000} km long, at about ${aboutFt(onPath(CB_E))} ft.`,
    'The wind is from the right and blows you wide in the turn: tighten it a little. And before the turn, not in it: Arm the spoilers (K) and set autobrake (L).',
  ],
  // (from 25 degrees right: 4.6 kt across and 10 along; 50 degrees at 12 gusting 18 had the stock Autoland, which
  // lands crabbed, scoring 58 straight in and RoutePilot 47 after the turn, a third of its landings DAMAGED)
  wind: { rel: 25, speed: 11, gust: 15, turb: 0.2 }, weight: 'normal',
  spawn: { u: Math.round(cbAt(4200).u), v: Math.round(cbAt(4200).v), hdg: -45, alt: 330, gamma: -3, flap: 0.75, speedKt: 150, fixed: true },
  failures: [], scoring: { type: 'runway' },
  course: {
    obstacles: [],
    gates: [
      { u: Math.round(cbAt(900).u), v: Math.round(cbAt(900).v), rot: -45, y: 160, w: 160, h: 90, name: 'the checkerboard line' },
      { u: -950, v: 0, y: 78, w: 90, h: 50, name: 'short final' },
    ],
  },
  route: [
    { u: Math.round(cbAt(1600).u), v: Math.round(cbAt(1600).v), alt: 205 },
    { u: CB_S.u, v: CB_S.v, alt: CB_TURN_ALT },
    { u: CB_E, v: 0, alt: onPath(CB_E), arc: 'R', r: CB_R, bank: 45, kt: 146 },
  ],
  hint: (c) => {
    if (c.ac.onGround) return null;
    const n = c.mission.next();
    // along the line to the checkerboard: distance to the turn and the height wanted
    const toTurn = (c.u - CB_S.u) * -Math.cos(45 * D2R) + (c.v - CB_S.v) * Math.sin(45 * D2R);
    if (n && n.gate.name === 'the checkerboard line') return `Fly at the checkerboard: turn in ${Math.max(0, Math.round(toTurn / 100) * 100)} m.`;
    if (c.u < CB_S.u + 120 && c.v > 150 && toTurn > -60) return toTurn > 250 ? `Turn right in ${Math.round(toTurn / 50) * 50} m, over the shore.` : 'Turn right now: 25 degrees of bank, and hold it.';
    if (c.u < CB_E && c.v > 12) return 'Keep turning right: 25 degrees, roll out on the centerline.';
    if (c.u < -300 && Math.abs(c.v) > 25) return `Line up: ${Math.round(Math.abs(c.v))} m ${c.v > 0 ? 'left' : 'right'} to the centerline.`;
    return null;
  },
};

// ------------------------------------------------------------------ 45: Downtown
// Grand Avenue: office towers along both sides of the extended centerline from 3.6 km out to 600 m, every one taller
// than the glide path at its feet, and two skybridges across the street: the first 3 km out with its underside 100 m
// up (the glide path is 178 m there), the second 2.2 km out at 82 m (the path: 136 m). Straight in on the glideslope
// meets the first skybridge; the way in is down the street under both, 66 m up, then onto the glideslope 800 m out.
const DT_BRIDGES = [{ u: -3000, y0: 100, y1: 200, name: 'the first skybridge' }, { u: -2200, y0: 82, y1: 160, name: 'the second skybridge' }];
const DT_ALT = 66;   // the route's height down the avenue (the CG, above the threshold elevation)
const downtownCourse = merge(
  // (the site's blocks cleared off the avenue and the row behind it; the avenue's own ground, the boulevard down the
  // centerline and its pavements, out to the towers' backs)
  { carve: [{ u0: -3800, u1: -350, v0: -340, v1: 340 }], ground: [{ u0: -3800, u1: -350, v0: -165, v1: 165, kind: 'avenue', keep: false }] },
  avenueCourse(-3600, -600, DT_BRIDGES, 45),
  // the second row behind the avenue: mid-rise offices on the carved blocks, with their own street grid
  { obstacles: [
    { kind: 'district', u0: -3700, u1: -700, v0: 165, v1: 340, block: 90, street: 22, h: [40, 95], seed: 451, style: { cls: 'office', facade: 'glass', roof: 'flat', lit: 0.35 } },
    { kind: 'district', u0: -3700, u1: -700, v0: -340, v1: -165, block: 90, street: 22, h: [40, 95], seed: 452, style: { cls: 'office', facade: 'glass', roof: 'flat', lit: 0.35 } },
  ] },
);
const downtown = {
  id: 'downtown', n: 45, title: 'Downtown', group: 'city', difficulty: 3, tags: ['city', 'heavy', 'low'],
  aircraft: 'condor', site: 'metro', time: 12.4, vis: 25000,
  desc: 'Metro Intl sits at the end of Grand Avenue, and the avenue has two skybridges across it: the first 100 metres up, the second 82. Every tower along the street is taller than you. Fly the last three kilometres down the street, below the rooftops, and land at the end of it.',
  tips: [
    `Down to ${altFt(DT_ALT, Math.round)} ft on the altimeter over the harbor and hold it: the skybridges' undersides are at ${altFt(DT_BRIDGES[0].y0)} and ${altFt(DT_BRIDGES[1].y0)} ft, and your fin stands 30 ft above you.`,
    'Stay in the middle of the avenue: it is 120 m wide and you are 34. Small bank angles only; the wind swirls between the towers.',
    `Under the second skybridge (below ${altFt(underTop(DT_BRIDGES[1].y0))} ft), hold your height until the glideslope comes down to meet you, ${Math.round(-meetPath(DT_ALT) / 100) * 100} m out, then fly it down. Arm the spoilers (K) and set autobrake (L).`,
  ],
  wind: { rel: -30, speed: 10, gust: 16, turb: 0.28 }, weight: 'normal',
  spawn: { u: -5000, v: 0, alt: 72, gamma: 0, flap: 0.75, speedKt: 150, fixed: true },
  failures: [], scoring: { type: 'runway' },
  course: downtownCourse,
  route: [
    { u: -4000, v: 0, alt: DT_ALT },
    { u: -3050, v: 0, alt: DT_ALT },
    { u: -2250, v: 0, alt: DT_ALT },
    { u: meetPath(DT_ALT), v: 0, alt: DT_ALT, kt: 146 },
  ],
  hint: (c) => {
    if (c.ac.onGround) return null;
    const agl = c.ra * 0.3048;
    if (c.u < DT_BRIDGES[1].u) {
      if (Math.abs(c.v) > 25) return `Back to the middle of the avenue: ${Math.round(Math.abs(c.v))} m ${c.v > 0 ? 'left' : 'right'}.`;
      // (heights as the altimeter reads them: above the sea, 4 m under the threshold; the fin stands 9 m over the middle)
      const b = c.u < DT_BRIDGES[0].u ? DT_BRIDGES[0] : DT_BRIDGES[1];
      return `Under ${b.name} in ${Math.round((b.u - c.u) / 10) * 10} m: stay below ${altFt(underTop(b.y0))} ft on the altimeter.`;
    }
    if (c.u < -900) return agl > 60 ? 'Hold your height: the glideslope will come down to you.' : 'Below the glideslope: hold it level until you meet it.';
    return null;
  },
};

// ------------------------------------------------------------------ 46: Slalom
// Three pairs of skyscrapers across the final, 800 m apart, 3.4, 2.6 and 1.8 km out; the gaps are 56 m wide, their
// middles 60 m right, left and right of the centerline, and flown at the glide path's height. RoutePilot flies arcs
// of 1,363 m radius (24 degrees of bank at 150 kt) through them, the gaps at the apexes.
const SL_APEX = [{ u: -3400, v: 60 }, { u: -2600, v: -60 }, { u: -1800, v: 60 }].map((a) => ({ ...a, y: Math.round(glide(a.u) - 8) }));
const slalomCourse = merge({ carve: [{ u0: -4300, u1: -1100, v0: -330, v1: 330 }], ground: [{ u0: -4300, u1: -1100, v0: -330, v1: 330, kind: 'plaza', keep: false }] }, slalomTowers(SL_APEX, 46));
const slalom = {
  id: 'slalom', n: 46, title: 'Slalom', group: 'city', difficulty: 4, tags: ['city', 'heavy'],
  aircraft: 'condor', site: 'metro', time: 18.9, vis: 30000,
  desc: 'Somebody built three pairs of skyscrapers across the final approach and left a gap in each, 60 metres right, then left, then right of the centerline. Weave the airliner through all three, 800 metres apart, on the glideslope. Then land as if nothing happened.',
  tips: [
    'Each gap is 56 m wide and you are 34. Be on the gap\'s side of the centerline before you reach it, not on your way there.',
    'A steady 25-degree bank, reversed smoothly halfway between two gaps, flies the curve. Roll early: a 150-ton airplane takes two seconds to roll.',
    'After the third gap, a gentle turn back onto the centerline: 1.4 km to go. Arm the spoilers (K) and set autobrake (L).',
  ],
  wind: { rel: 20, speed: 8, turb: 0.2 }, weight: 'normal',
  spawn: { u: -5600, v: 0, gamma: -3, flap: 0.75, speedKt: 150, fixed: true },
  failures: [], scoring: { type: 'runway' },
  course: slalomCourse,
  route: [
    { u: -4200, v: 0, alt: Math.round(glide(-4200) - 8) },
    ...sCurve(-4200, 0, SL_APEX[0].u, SL_APEX[0].v, glide(-4200) - 8, SL_APEX[0].y),
    ...sCurve(SL_APEX[0].u, SL_APEX[0].v, SL_APEX[1].u, SL_APEX[1].v, SL_APEX[0].y, SL_APEX[1].y),
    ...sCurve(SL_APEX[1].u, SL_APEX[1].v, SL_APEX[2].u, SL_APEX[2].v, SL_APEX[1].y, SL_APEX[2].y),
    ...sCurve(SL_APEX[2].u, SL_APEX[2].v, -1000, 0, SL_APEX[2].y, onPath(-1000), 146),
  ],
  hint: (c) => {
    if (c.ac.onGround) return null;
    const n = c.mission.next();
    if (n && /^gap/.test(n.gate.name)) {
      const want = SL_APEX.find((a) => a.u > c.u - 50);
      if (!want) return null;
      const off = c.v - want.v;
      if (n.dist < 450) return Math.abs(off) > 10 ? `${cap(n.gate.name)}: ${Math.round(Math.abs(off))} m ${off > 0 ? 'left' : 'right'}!` : `${cap(n.gate.name)}: on it, hold the bank.`;
      return `Next: ${n.gate.name}, 60 m ${want.v > 0 ? 'right' : 'left'} of the centerline, ${Math.round(n.dist / 10) * 10} m.`;
    }
    if (c.u < -300 && Math.abs(c.v) > 20) return `Back onto the centerline: ${Math.round(Math.abs(c.v))} m ${c.v > 0 ? 'left' : 'right'}.`;
    return null;
  },
};

// ------------------------------------------------------------------ 47: Under the Bridge
// The Harbor Bridge (the site's) crosses the final 5.7 km out, deck underside 56 m above the runway (60 over the
// water). The gate under it wants the airplane between 8 and 44 m (the fin reaches 9 m above the CG).
const underBridge = {
  id: 'under-bridge', n: 47, title: 'Under the Bridge', group: 'city', difficulty: 3, tags: ['city', 'heavy', 'low'],
  aircraft: 'condor', site: 'metro', time: 8.3, vis: 18000,
  desc: 'The Harbor Bridge gives ships 60 metres of clearance, and today one airliner. Fly under the deck at a hundred feet over the bay, then climb out over the city and find the glideslope. The main span is over a kilometre wide; the fin on top of you is nine metres tall.',
  tips: [
    `Down over the bay to 100 ft above the water well before the bridge, and hold it: under the deck means under ${raFt(BRIDGE_GATE_TOP)} ft on the radio altimeter.`,
    'Aim at the middle of the main span, wings level. Do not dip a wing: at 100 ft a 10-degree bank puts a wingtip 3 m closer to the water.',
    'Past the bridge, climb gently to 300 ft over the shore and hold it until the glideslope comes down to meet you, about 1.5 km out.',
  ],
  wind: { rel: -20, speed: 9, turb: 0.2 }, weight: 'normal',
  spawn: { u: -8300, v: 0, alt: 150, gamma: -2, flap: 0.75, speedKt: 150, fixed: true },
  failures: [], scoring: { type: 'runway' },
  course: { obstacles: [], gates: [underGate(BRIDGE.u, 0, 8, BRIDGE_UNDER, 150, BRIDGE_GATE)] },
  route: [
    { u: -7000, v: 0, alt: 70 },
    { u: -6250, v: 0, alt: 29 },
    { u: -5150, v: 0, alt: 29 },
    { u: -4200, v: 0, alt: 88 },
    { u: meetPath(100), v: 0, alt: 100, kt: 146 },
  ],
  hint: (c) => {
    if (c.ac.onGround) return null;
    const agl = c.ra;   // over the water the radio altimeter reads the height above the water
    if (c.u < BRIDGE.u) {
      if (Math.abs(c.v) > 80) return `Line up on the middle of the span: ${Math.round(Math.abs(c.v))} m ${c.v > 0 ? 'left' : 'right'}.`;
      if (c.u > -6600 && agl > raFt(BRIDGE_GATE_TOP) + 5) return `Too high for the bridge: down to 100 ft (${Math.round(agl)} ft).`;
      if (agl < 60) return 'Low over the water: a little power.';
      return c.u > -6600 ? 'Hold 100 ft, wings level.' : 'Down to 100 ft over the water before the bridge.';
    }
    if (c.u < -4000) return 'Through. Climb gently to 300 ft over the shore.';
    if (c.u < -1500) return 'Hold 300 ft: the glideslope comes down to meet you.';
    return null;
  },
};

// ------------------------------------------------------------------ 48: The Needle
const needle = {
  id: 'the-needle', n: 48, title: 'The Needle', group: 'city', difficulty: 5, tags: ['city', 'heavy'],
  aircraft: 'condor', site: 'metro', time: 19.4, vis: 30000,
  desc: `Two glass towers stand on a pier in the bay, ${NEEDLE_GAP} metres apart and joined at the top. Wings level, winglets and all, the airliner is 35 metres wide; banked ${NEEDLE_BANK} degrees it is ${CONDOR_WIDTH[NEEDLE_BANK]}. Turn onto final through the gap in a steady bank, then climb over the Harbor Bridge and land.`,
  tips: [
    `Hold the line you start on, ${NEEDLE_TURN} degrees left of the runway, at 150 kt, flaps 30 and 250 ft. The eye (the space under the skybridge) is off to your right: do not aim at it yet.`,
    `About ${Math.round(NEEDLE_ROLL.d / 50) * 50} m before the towers, with the eye ${Math.round(NEEDLE_ROLL.b)} degrees right of your nose, roll right into a steady turn of about ${NEEDLE_BANK} degrees: you go through the eye ${NEEDLE_TURN + NEEDLE_PSI} degrees into it. The hint counts down to the roll, then shows the bank to hold: the wind moves it.`,
    `Keep turning until the runway is ahead and roll out on the centerline, about ${Math.round(NEEDLE_ROLL.out / 10) * 10} m past the towers. Climb to 400 ft over the bridge, then fly the glideslope down. Arm the spoilers (K) and set autobrake (L).`,
  ],
  wind: { rel: 10, speed: 5, turb: 0.1 }, weight: 'normal',
  spawn: { ...NEEDLE_SPAWN },
  failures: [], scoring: { type: 'runway' },
  course: needleCourse(),
  route: [
    ...needleRoute(NEEDLE_ALT),
    { u: -6300, v: 0, alt: 112 },
    { u: -5000, v: 0, alt: 118 },
    { u: meetPath(122), v: 0, alt: 122, kt: 146 },
  ],
  hint: (c) => {
    if (c.ac.onGround) return null;
    const n = c.mission.next();
    if (n && n.gate.name === EYE) return needleHint(c);
    if (c.u < -5600 && c.u > -7100 && c.ra < 300) return Math.abs(c.v) > 15 ? `Roll out on the centerline (${Math.round(Math.abs(c.v))} m ${c.v > 0 ? 'left' : 'right'}), then climb to 400 ft over the bridge.` : 'Climb to 400 ft over the Harbor Bridge.';
    return null;
  },
};

// ------------------------------------------------------------------ 49: The Gauntlet
// At night in a storm: the Needle, under the Harbor Bridge, two slalom gaps (3.5 and 2.7 km out, flown below the
// glide path at 108 and 98 m), and the last 1.8 km down a short Grand Avenue under one skybridge (1.7 km out,
// underside 80 m up, the glide path 110 m there), then land. The weather spec is for the storm's look and model
// (built in another worktree); the wind below is what the physics flies today.
const GA_APEX = [{ u: -3500, v: 60, y: 108 }, { u: -2700, v: -60, y: 98 }];
const GA_BRIDGE = [{ u: -1700, y0: 80, y1: 140, name: 'the skybridge' }];
const gauntletCourse = merge(
  needleCourse(),
  { gates: [underGate(BRIDGE.u, 0, 8, BRIDGE_UNDER, 150, BRIDGE_GATE)] },
  { carve: [{ u0: -4300, u1: -350, v0: -340, v1: 340 }], ground: [{ u0: -4300, u1: -350, v0: -340, v1: 340, kind: 'avenue', keep: false }] },
  slalomTowers(GA_APEX, 49),
  avenueCourse(-1800, -560, GA_BRIDGE, 490),
);
const gauntlet = {
  id: 'gauntlet', n: 49, title: 'The Gauntlet', group: 'city', difficulty: 5, tags: ['city', 'heavy', 'night', 'storm'],
  aircraft: 'condor', site: 'metro', time: 21.8, vis: 7000,
  weather: { preset: 'storm', rain: 0.7, lightning: 0.5, darkness: 0.6 },
  desc: 'Four of the city\'s missions in one approach, at night, in a thunderstorm: through the Needle, under the Harbor Bridge, through two gaps in the towers and down Grand Avenue under the skybridge. Then land, with the rain coming sideways. Five gates, one airliner, no second go.',
  tips: [
    `It is four of the missions before this one, back to back: the Needle in a turn of about ${NEEDLE_BANK} degrees (the hint says when to roll and how far), the bridge under ${raFt(BRIDGE_GATE_TOP)} ft on the radio altimeter, the gaps in a 25-degree weave, the avenue under ${altFt(underTop(GA_BRIDGE[0].y0))} ft on the altimeter.`,
    'Fly the lights: the Needle\'s eye and every gap are framed in orange, the skybridge has red lights at its ends, the bridge deck is lit yellow.',
    'Gusts to 18 kt: small bank angles everywhere except in the eye, and do the checklist over the bay. Arm the spoilers (K) and set autobrake (L).',
  ],
  wind: { rel: 30, speed: 12, gust: 18, turb: 0.25 }, weight: 'normal',
  spawn: { ...NEEDLE_SPAWN },
  failures: [], scoring: { type: 'runway' },
  course: gauntletCourse,
  route: [
    ...needleRoute(NEEDLE_ALT),
    { u: -6300, v: 0, alt: 30 },
    { u: -5150, v: 0, alt: 30 },
    { u: -4300, v: 0, alt: 100 },
    ...sCurve(-4300, 0, GA_APEX[0].u, GA_APEX[0].v, 100, GA_APEX[0].y),
    ...sCurve(GA_APEX[0].u, GA_APEX[0].v, GA_APEX[1].u, GA_APEX[1].v, GA_APEX[0].y, GA_APEX[1].y),
    ...sCurve(GA_APEX[1].u, GA_APEX[1].v, -1900, 0, GA_APEX[1].y, 68),
    { u: -1730, v: 0, alt: 64 },
    { u: meetPath(64), v: 0, alt: 64, kt: 146 },
  ],
  hint: (c) => {
    if (c.ac.onGround) return null;
    const n = c.mission.next();
    if (!n) return null;
    const g = n.gate.name;
    if (g === EYE) return needleHint(c);
    if (g === BRIDGE_GATE) return c.ra > raFt(BRIDGE_GATE_TOP) ? 'Down to 100 ft over the water for the bridge.' : 'Under the bridge: hold 100 ft, wings level.';
    if (/^gap/.test(g)) { const a = GA_APEX[+g.slice(4) - 1]; const off = c.v - a.v; return n.dist < 450 && Math.abs(off) > 10 ? `${cap(g)}: ${Math.round(Math.abs(off))} m ${off > 0 ? 'left' : 'right'}!` : `${cap(g)}: 60 m ${a.v > 0 ? 'right' : 'left'} of the centerline, ${Math.round(n.dist / 10) * 10} m.`; }
    if (/skybridge/.test(g)) return Math.abs(c.v) > 25 ? `The avenue: ${Math.round(Math.abs(c.v))} m ${c.v > 0 ? 'left' : 'right'}.` : `Down the avenue: under the skybridge, below ${altFt(underTop(GA_BRIDGE[0].y0))} ft on the altimeter.`;
    return null;
  },
};

export const CITY_MISSIONS = [checkerboard, downtown, slalom, underBridge, needle, gauntlet];
