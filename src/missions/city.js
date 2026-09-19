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
const ISLAND = { u: -6250, v: 925, w: 750, d: 700 };                     // Container Island, the bridge's east end
const CHECKER = { u: -700, v: -900 };                                     // Checkerboard Hill

const metroCourse = {
  obstacles: [
    // ---- the landmarks
    { kind: 'landmark', type: 'checkerboard', u: CHECKER.u, v: CHECKER.v, rot: 45, h: 110, r: 170, rTop: 60, boardW: 110, boardH: 95, name: 'Checkerboard Hill', boardName: 'the checkerboard' },
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

// ---- The Needle (48, 49): two round glass towers on a pier in the bay, 33 m apart, joined by a skybridge at the top.
// The gap is on a right turn onto the final: a steady turn of radius NEEDLE_R from a heading NEEDLE_TURN degrees left
// of the runway's reaches it 25 degrees in (heading NEEDLE_PSI there) and rolls out on the centerline 220 m later. The Condor's probe footprint
// banked 30 / 35 / 40 / 45 degrees is 31.3 / 29.9 / 28.2 / 26.3 m wide (wings level 35.0; tools/test-city.mjs
// prints it), and its middle sits about 1 m toward the low wing: so a 33 m gap takes 30 degrees of bank at the least,
// with a window of 1.7 m for the airplane's center then, 3.2 m at 35. That is the most the Assist law allows today.
// TIGHTEN LATER: once the flight-physics review removes the Assist's 35-degree bank limit, NEEDLE_GAP can come down
// to about 29 m (passable at 40 degrees and more) or 25 m (45); RoutePilot then needs NEEDLE_R for that bank at 150 kt
// (R = V^2 / (g tan bank)), and the tips and the description their numbers.
const NEEDLE_GAP = 33, NEEDLE_R = 836, NEEDLE_PSI = -15, NEEDLE_TURN = 60;
const NEEDLE_G = { u: -7250, v: NEEDLE_R * (1 - Math.cos(NEEDLE_PSI * D2R)) };   // where the turn's path meets the gap
const NEEDLE_TOWER_R = 12, NEEDLE_H = 185;
function needleCourse() {
  const p = NEEDLE_PSI * D2R, nu = -Math.sin(p), nv = Math.cos(p);   // the right-hand normal to the turn at the gap
  // the gap's middle sits 0.95 m inside the turn from the path: banked, the fin and the winglets lean into the turn,
  // so the airplane's footprint sits about a metre toward its low wing
  const cu = NEEDLE_G.u + 0.95 * nu, cv = NEEDLE_G.v + 0.95 * nv, off = NEEDLE_GAP / 2 + NEEDLE_TOWER_R;
  const L = { u: cu - off * nu, v: cv - off * nv }, R = { u: cu + off * nu, v: cv + off * nv };
  const style = { cls: 'landmark', facade: 'glass', roof: 'spire', lit: 0.6, height: 'super', landmark: 'needle' };
  return {
    obstacles: [
      { kind: 'quay', u: cu, v: cv, rot: NEEDLE_PSI, w: 110, d: 150, top: 4, depth: 12, name: 'the Needle\'s pier' },
      { kind: 'tower', round: true, u: L.u, v: L.v, w: 2 * NEEDLE_TOWER_R, h: NEEDLE_H, deck: 4, antenna: 25, name: 'the Needle', style },
      { kind: 'tower', round: true, u: R.u, v: R.v, w: 2 * NEEDLE_TOWER_R, h: NEEDLE_H, deck: 4, antenna: 25, name: 'the Needle', style },
      { kind: 'skybridge', a: L, b: R, y0: 118, y1: 134, d: 18, name: 'the Needle', style: { cls: 'skybridge', facade: 'glass', lit: 0.7, landmark: 'needle' } },
    ],
    gates: [{ u: cu, v: cv, rot: NEEDLE_PSI, y: 72, w: 22, h: 60, bank: 35, name: 'the eye of the Needle' }],
  };
}
// RoutePilot's line through the Needle: a straight run-in heading 30 degrees left of the runway, then the arc.
function needleRoute(alt, kt = 150) {
  const p = NEEDLE_PSI * D2R, c = { u: NEEDLE_G.u - NEEDLE_R * Math.sin(p), v: NEEDLE_G.v + NEEDLE_R * Math.cos(p) };
  const a = NEEDLE_TURN * D2R;
  const S = { u: c.u - NEEDLE_R * Math.sin(a), v: c.v - NEEDLE_R * Math.cos(a) };   // heading -NEEDLE_TURN here
  const E = { u: c.u, v: c.v - NEEDLE_R };                                           // heading 0, v = 0
  return [
    { u: S.u - 1100 * Math.cos(a), v: S.v + 1100 * Math.sin(a), alt, kt },
    { u: S.u, v: S.v, alt, kt },
    { u: E.u, v: Math.round(E.v * 10) / 10, alt, arc: 'R', r: NEEDLE_R, kt, bank: 45 },
  ];
}

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
    // (the gate: from 12 m up to 12 m under the skybridge's underside - the fin stands 9 m over the airplane's middle)
    gates.push({ u: b.u - 30, v: 0, y: b.y0 / 2, w: 90, h: b.y0 - 24, name: `the gap under ${b.name}` });
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
// Checkerboard Hill; a right turn of radius CB_R starting 2.1 km out rolls out on the centerline at u CB_E, 1,250 m
// from the threshold, 90 m up. Flying on at the board is flying into the hill.
const CB_R = 1200, CB_E = -1250;
const CB_S = { u: CB_E - CB_R * Math.sin(45 * D2R), v: CB_R * (1 - Math.cos(45 * D2R)) };   // where the turn starts
const cbAt = (d) => ({ u: CB_S.u - d * Math.cos(45 * D2R), v: CB_S.v + d * Math.sin(45 * D2R) }); // d metres before it
const checkerboard = {
  id: 'checkerboard', n: 44, title: 'Checkerboard', group: 'city', difficulty: 3, tags: ['city', 'heavy', 'crosswind'],
  aircraft: 'condor', site: 'metro', time: 16.8, vis: 22000,
  desc: 'Metro City\'s famous approach, done the old way: point the airliner at a checkerboard painted on a hill, then turn right 45 degrees at 400 ft and find the runway that was hiding behind the apartment blocks. The turn ends a kilometre from the threshold. The crosswind in it does not care.',
  tips: [
    'Aim straight at the orange and white checkerboard, 150 kt, flaps 30, gear down, and come down to about 400 ft by the time you cross the waterfront.',
    'Two kilometres out, over the shore, roll right into a 25-degree bank and hold it: 45 degrees of turn puts you on a one-kilometre final at 250 ft.',
    'The wind is from the right and blows you wide in the turn: tighten it a little. And before the turn, not in it: Arm the spoilers (K) and set autobrake (L).',
  ],
  wind: { rel: 50, speed: 12, gust: 18, turb: 0.25 }, weight: 'normal',
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
    { u: CB_S.u, v: CB_S.v, alt: 122 },
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
const downtownCourse = merge(
  // (the site's blocks cleared off the avenue's ground, which is the avenue: a boulevard down the centerline)
  { carve: [{ u0: -3800, u1: -350, v0: -340, v1: 340 }], ground: [{ u0: -3800, u1: -350, v0: -340, v1: 340, kind: 'avenue', keep: false }] },
  avenueCourse(-3600, -600, DT_BRIDGES, 45),
  // the second row behind the avenue: mid-rise offices on the carved blocks
  { obstacles: [
    { kind: 'district', u0: -3700, u1: -700, v0: 170, v1: 330, block: 90, street: 22, h: [40, 95], seed: 451, style: { cls: 'office', facade: 'glass', roof: 'flat', lit: 0.35 } },
    { kind: 'district', u0: -3700, u1: -700, v0: -330, v1: -170, block: 90, street: 22, h: [40, 95], seed: 452, style: { cls: 'office', facade: 'glass', roof: 'flat', lit: 0.35 } },
  ] },
);
const downtown = {
  id: 'downtown', n: 45, title: 'Downtown', group: 'city', difficulty: 3, tags: ['city', 'heavy', 'low'],
  aircraft: 'condor', site: 'metro', time: 12.4, vis: 25000,
  desc: 'Metro Intl sits at the end of Grand Avenue, and the avenue has two skybridges across it: the first 100 metres up, the second 82. Every tower along the street is taller than you. Fly the last three kilometres down the street, below the rooftops, and land at the end of it.',
  tips: [
    'Down to 230 ft on the altimeter over the harbor and hold it: the skybridges\' undersides are at 340 and 280 ft, and your fin stands 30 ft above you.',
    'Stay in the middle of the avenue: it is 120 m wide and you are 34. Small bank angles only; the wind swirls between the towers.',
    'Under the second skybridge (below 240 ft), hold your height until the glideslope comes down to meet you, 800 m out, then fly it down. Arm the spoilers (K) and set autobrake (L).',
  ],
  wind: { rel: -30, speed: 10, gust: 16, turb: 0.28 }, weight: 'normal',
  spawn: { u: -5000, v: 0, alt: 72, gamma: 0, flap: 0.75, speedKt: 150, fixed: true },
  failures: [], scoring: { type: 'runway' },
  course: downtownCourse,
  route: [
    { u: -4000, v: 0, alt: 66 },
    { u: -3050, v: 0, alt: 66 },
    { u: -2250, v: 0, alt: 66 },
    { u: meetPath(66), v: 0, alt: 66, kt: 146 },
  ],
  hint: (c) => {
    if (c.ac.onGround) return null;
    const agl = c.ra * 0.3048;
    if (c.u < DT_BRIDGES[1].u) {
      if (Math.abs(c.v) > 25) return `Back to the middle of the avenue: ${Math.round(Math.abs(c.v))} m ${c.v > 0 ? 'left' : 'right'}.`;
      // (heights as the altimeter reads them: above the sea, 4 m under the threshold; the fin stands 9 m over the middle)
      const b = c.u < DT_BRIDGES[0].u ? DT_BRIDGES[0] : DT_BRIDGES[1];
      return `Under ${b.name} in ${Math.round((b.u - c.u) / 10) * 10} m: stay below ${Math.floor((b.y0 + 4 - 12) / 0.3048 / 10) * 10} ft on the altimeter.`;
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
    'Down over the bay to 100 ft above the water well before the bridge, and hold it: under the deck means under 150 ft on the radio altimeter.',
    'Aim at the middle of the main span, wings level. Do not dip a wing: at 100 ft a 10-degree bank puts a wingtip 3 m closer to the water.',
    'Past the bridge, climb gently to 300 ft over the shore and hold it until the glideslope comes down to meet you, about 1.5 km out.',
  ],
  wind: { rel: -20, speed: 9, turb: 0.2 }, weight: 'normal',
  spawn: { u: -8300, v: 0, alt: 150, gamma: -2, flap: 0.75, speedKt: 150, fixed: true },
  failures: [], scoring: { type: 'runway' },
  course: { obstacles: [], gates: [{ u: BRIDGE.u, v: 0, y: 26, w: 150, h: 36, name: 'the gap under the Harbor Bridge' }] },
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
      if (c.u > -6600 && agl > 155) return `Too high for the bridge: down to 100 ft (${Math.round(agl)} ft).`;
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
  desc: 'Two glass towers stand on a pier in the bay, 33 metres apart and joined at the top. Your wingspan is 34.3 metres; banked 35 degrees the airliner is 30 metres wide. Turn onto final through the gap in a steady bank, then climb over the Harbor Bridge and land.',
  tips: [
    'Line up on the gap from a long way out, 150 kt, flaps 30, 250 ft. The eye is the space under the skybridge: aim for its middle.',
    'About 200 m before the towers, roll right to 35 degrees (the Assist\'s full bank) and keep turning: the gap is halfway round a 30-degree turn onto the final.',
    'Roll out on the centerline, climb to 400 ft over the bridge, then fly the glideslope down. Arm the spoilers (K) and set autobrake (L).',
  ],
  wind: { rel: 10, speed: 5, turb: 0.1 }, weight: 'normal',
  spawn: (() => { const r = needleRoute(75); return { u: Math.round(r[0].u - 1400 * Math.cos(NEEDLE_TURN * D2R)), v: Math.round(r[0].v + 1400 * Math.sin(NEEDLE_TURN * D2R)), hdg: -NEEDLE_TURN, alt: 80, gamma: 0, flap: 0.75, speedKt: 150, fixed: true }; })(),
  failures: [], scoring: { type: 'runway' },
  course: needleCourse(),
  route: [
    ...needleRoute(75),
    { u: -6300, v: 0, alt: 112 },
    { u: -5000, v: 0, alt: 118 },
    { u: meetPath(122), v: 0, alt: 122, kt: 146 },
  ],
  hint: (c) => {
    if (c.ac.onGround) return null;
    const n = c.mission.next();
    if (n && n.gate.name === 'the eye of the Needle') {
      const bank = c.ac.euler.roll / D2R;
      if (n.dist > 450) return `The Needle in ${Math.round(n.dist / 50) * 50} m: line up on the eye, 250 ft.`;
      if (n.dist > 190) return 'Roll right: 35 degrees, now.';
      return bank < 28 ? `More bank: ${Math.round(bank)} degrees, you need 30.` : 'Hold the bank. Hold it.';
    }
    if (c.u < -5600 && c.u > -7100 && c.ra < 300) return 'Climb to 400 ft over the Harbor Bridge.';
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
  { gates: [{ u: BRIDGE.u, v: 0, y: 26, w: 150, h: 36, name: 'the gap under the Harbor Bridge' }] },
  { carve: [{ u0: -4300, u1: -350, v0: -340, v1: 340 }], ground: [{ u0: -4300, u1: -350, v0: -340, v1: 340, kind: 'avenue', keep: false }] },
  slalomTowers(GA_APEX, 49),
  avenueCourse(-1800, -560, GA_BRIDGE, 490),
);
const gauntlet = {
  id: 'gauntlet', n: 49, title: 'The Gauntlet', group: 'city', difficulty: 5, tags: ['city', 'heavy', 'night', 'storm'],
  aircraft: 'condor', site: 'metro', time: 21.8, vis: 7000,
  weather: { preset: 'storm', rain: 0.7, lightning: 0.5, darkness: 0.6 },
  desc: 'All of it, in one approach, at night, in a thunderstorm: through the Needle, under the Harbor Bridge, through two gaps in the towers and down Grand Avenue under the skybridge. Then land, with the rain coming sideways. Five gates, one airliner, no second go.',
  tips: [
    'It is the four missions before this one back to back: the Needle at 35 degrees of bank, the bridge under 150 ft, the gaps in a 25-degree weave, the avenue under 240 ft.',
    'Fly the lights: the Needle\'s eye and every gap are framed in orange, the skybridge has red lights at its ends, the bridge deck is lit yellow.',
    'Gusts to 18 kt: small bank angles everywhere except in the eye, and do the checklist over the bay. Arm the spoilers (K) and set autobrake (L).',
  ],
  wind: { rel: 30, speed: 12, gust: 18, turb: 0.25 }, weight: 'normal',
  spawn: (() => { const r = needleRoute(75); return { u: Math.round(r[0].u - 1400 * Math.cos(NEEDLE_TURN * D2R)), v: Math.round(r[0].v + 1400 * Math.sin(NEEDLE_TURN * D2R)), hdg: -NEEDLE_TURN, alt: 80, gamma: 0, flap: 0.75, speedKt: 150, fixed: true }; })(),
  failures: [], scoring: { type: 'runway' },
  course: gauntletCourse,
  route: [
    ...needleRoute(75),
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
    if (g === 'the eye of the Needle') return n.dist > 450 ? 'The Needle first: line up on the eye, 250 ft.' : n.dist > 190 ? 'Roll right: 35 degrees, now.' : 'Hold the bank.';
    if (g === 'the gap under the Harbor Bridge') return c.ra > 155 ? 'Down to 100 ft over the water for the bridge.' : 'Under the bridge: hold 100 ft, wings level.';
    if (/^gap/.test(g)) { const a = GA_APEX[+g.slice(4) - 1]; const off = c.v - a.v; return n.dist < 450 && Math.abs(off) > 10 ? `${cap(g)}: ${Math.round(Math.abs(off))} m ${off > 0 ? 'left' : 'right'}!` : `${cap(g)}: 60 m ${a.v > 0 ? 'right' : 'left'} of the centerline, ${Math.round(n.dist / 10) * 10} m.`; }
    if (/skybridge/.test(g)) return Math.abs(c.v) > 25 ? `The avenue: ${Math.round(Math.abs(c.v))} m ${c.v > 0 ? 'left' : 'right'}.` : 'Down the avenue: under the skybridge, below 240 ft on the altimeter.';
    return null;
  },
};

export const CITY_MISSIONS = [checkerboard, downtown, slalom, underBridge, needle, gauntlet];
