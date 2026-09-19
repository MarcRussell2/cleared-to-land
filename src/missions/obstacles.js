// New missions: obstacles ("In the way", n 36-38). Each entry follows src/missions/README.md; ids are permanent.
// The obstacles themselves are built by src/world/obstacles.js from the `course` specs below (its header lists every
// kind); the routes are what RoutePilot flies to prove each mission can be landed (tools/fly-mission.mjs,
// tools/test-obstacles.mjs), and the tips tell a human the same technique.
//
// Hints get ctx = { ac, ra (ft), d (m to the threshold), t, u, v (runway frame, metres), mission }, where
// mission.next() is the next pending gate ({ gate, dist }) or null. Return a string, or null for the game's usual
// hint. Hints name no keys (the touch layer would have to translate them).
//
// Heights in a course and a route are metres above the threshold elevation (the local ground under an approach is
// rarely at that height: Moose Creek's notch stands on ground 6 m above the bar, Harbor City's water is 8 m below
// its threshold). tools/test-obstacles.mjs prints the numbers each description quotes, and checks them.

// ------------------------------------------------------------------ the Moose Creek Notch site
// The gravel bar of Moose Creek (SITES.gravelbar: the same valley, bar and scattered spruce), with its tree wall
// grown into a forest edge: three rows of spruce half again as tall as the bar's (37 m, on ground 5-7 m above the
// bar), 220 m wide, and one notch cut through it 16 m left of the centreline. All of it is course trees: one
// instanced draw, swept collision against the trunk and the crown as drawn.
const NOTCH_V = -16, NOTCH_W = 30, NOTCH_U = -152;
const notchbar = {
  id: 'notchbar', name: 'Moose Creek Notch', kind: 'bush',
  terrain: { style: 'mountain', seed: 61, size: 14000, res: 400, elevation: 520, waterLevel: 516, valleyWidth: 1400, trees: 0.9, treeArea: 4500, snowLine: 1900 },
  runways: [{ x: 0, z: 0, heading: 0, length: 340, width: 14, surface: 'gravel', elevation: 520, name: '36', nameRecip: '18', papi: false, ils: false, lights: false, windsock: true, markers: true, aimDistance: 50, flatWidth: 60, flatMargin: 120 }],
  course: {
    obstacles: [
      { kind: 'treeWall', u: NOTCH_U, from: -110, to: 110, step: 9, scale: 1.5, rows: 3, rowGap: 13, jitter: 3, seed: 7, gap: { v: NOTCH_V, w: NOTCH_W } },
      // the valley's scattered spruce, where Moose Creek Bar has them (its x -> v, z -> -u)
      ...[[-34, 260, 1.1], [45, 320, 1.2], [22, 420, 1.0], [-48, 470, 1.1], [-25, -420, 1.2], [40, -380, 1.1]].map(([x, z, s]) => ({ kind: 'tree', u: -z, v: x, scale: s })),
    ],
    // keep the decorative forest off the line through the notch and the drop to the bar
    clear: [{ u: -120, v: -10, r: 40 }, { u: -80, v: -4, r: 35 }],
  },
};

export const OBSTACLES_SITES = { notchbar };

// ------------------------------------------------------------------ 36: Power Lines
// Ridgefield (runway 36, 1,600 m, threshold elevation 120 m, the ground a few metres lower out on the approach).
// A line of 36 m lattice pylons crosses short final 600 m out, diagonally; mid-span over the centreline its lowest
// conductors hang 17 m above the ground and its earth wire 31 m. A 10 m pole line runs along the road 230 m out.
// The start is level at 17 m, the height of the lowest wires: stay there and you meet them.
const powerLines = {
  id: 'power-lines', n: 36, title: 'Power Lines', group: 'obstacles', difficulty: 2, tags: ['obstacles', 'low'],
  aircraft: 'skylark', site: 'ridgefield', time: 7.8, vis: 4500,
  desc: 'Scud-running at 55 ft under the morning murk, and the county\'s high-voltage line crosses short final 600 m out, 36-metre pylons and all. Its wires sag to between 17 and 31 m over the centerline, so the lowest one is exactly where you are. Get over the top, then get down onto 1,600 m of runway.',
  tips: [
    'Climb as soon as you see the pylons: full power and a gentle pull, up to about 150 ft. A Skylark climbs 500 feet a minute, so start early.',
    'Cross the wires where the orange marker balls are, with room to spare, then power back and let the nose come down onto a normal 3-degree final.',
    'A 10 m pole line runs along the road 230 m before the runway. Do not dive for the numbers: 1,600 m of runway will take a long landing.',
  ],
  wind: { rel: 25, speed: 8, turb: 0.2 }, weight: 'normal',
  spawn: { u: -2600, v: 0, alt: 17, gamma: 0, flap: 0.333, speedKt: 72, fixed: true },
  failures: [], scoring: { type: 'runway' },
  course: {
    obstacles: [
      { kind: 'powerline', type: 'hv', from: { u: -530, v: -900 }, to: { u: -670, v: 900 }, spans: 5, h: 36, sag: 5, markers: 60, name: 'the power lines' },
      { kind: 'powerline', type: 'pole', from: { u: -230, v: -550 }, to: { u: -230, v: 550 }, spans: 11, h: 10, name: 'the power lines along the road' },
    ],
  },
  // RoutePilot: climb over the wires early, cross well above them, then join the 3-degree path.
  route: [
    { u: -1800, v: 0, alt: 46, kt: 70 },
    { u: -640, v: 0, alt: 47, kt: 68 },
    { u: -420, v: 0, alt: 38, kt: 64 },
  ],
  hint: (c) => {
    if (c.ac.onGround) return null;
    if (c.u < -620) {
      const agl = c.ra * 0.3048;
      if (agl < 38) return `Power lines in ${Math.round((-600 - c.u) / 10) * 10} m: climb to 150 ft, above the pylon tops, now.`;
      return 'Hold this height until you are over the wires and their orange marker balls.';
    }
    if (c.u < -260) return 'Over the wires. Now down to a normal final, and mind the pole line by the road.';
    return null;
  },
};

// ------------------------------------------------------------------ 37: The Notch
const theNotch = {
  id: 'the-notch', n: 37, title: 'The Notch', group: 'obstacles', difficulty: 4, tags: ['obstacles', 'bush'],
  aircraft: 'trailblazer', site: 'notchbar', time: 8.6, vis: 30000,
  desc: 'The spruce in front of Moose Creek Bar have grown into a wall 40 metres tall and three rows deep, and the only way through is a notch 30 metres wide, 16 metres left of the strip. Go through it low with the wings level, then drop onto 340 m of gravel. Over the top counts as not doing the mission.',
  tips: [
    'Full flap (F twice), 50 kt, and line up on the orange gate in the notch from a long way out. It is 16 m left of the centerline; your wings are 11 m.',
    'Through the gap at 25 to 50 ft above the ground, wings level. The crowns are widest at the bottom of the green, so low and centred is the safe line.',
    'Once through, a gentle S-turn to the right onto the gravel, power to idle, touch down early. Brake gently (Space) or it will nose over.',
  ],
  wind: { rel: 25, speed: 6, turb: 0.3 }, weight: 'normal',
  spawn: { u: -850, v: -12, alt: 62, gamma: -3, flap: 1, speedKt: 52, fixed: true },
  failures: [], scoring: { type: 'bush' },
  course: {
    gates: [{ u: NOTCH_U - 13, v: NOTCH_V, y: 17, w: 20, h: 16, name: 'the notch', required: true }],
  },
  route: [
    { u: -520, v: NOTCH_V, alt: 34, kt: 52 },
    { u: -200, v: NOTCH_V, alt: 21, kt: 50, over: true },
    { u: -146, v: NOTCH_V, alt: 18.5, kt: 50, over: true },
    { u: -100, v: -10, alt: 15, kt: 49 },
    { u: -40, v: 0, alt: 9.5, kt: 48 },
  ],
  // The line to the notch: 12 m over the ground at the wall, and a 4-degree slope back from it.
  hint: (c) => {
    if (c.ac.onGround) return null;
    // (the wall's three rows stand from about u -184 to -146, crowns included)
    if (c.u < -186) {
      const off = c.v - NOTCH_V;
      if (Math.abs(off) > 6) return `Line up on the notch: ${Math.round(Math.abs(off))} m ${off > 0 ? 'left' : 'right'}. It is the gap with the orange gate.`;
      const agl = c.ra * 0.3048, want = 12 + (NOTCH_U - 13 - c.u) * 0.07;
      if (agl > want + 12) return 'High for the notch: power back and come down, 15 m over the ground at the trees.';
      if (agl < want - 8) return 'Low: a little power. The ground rises toward the trees.';
      return 'On the notch. Wings level, 50 kt, 15 m over the ground at the trees.';
    }
    if (c.u < -146) return 'In the notch. Wings level, hold it steady.';
    if (c.u < -120) return 'Through! Hold it level.';
    if (c.u < 0) return 'Gentle S-turn right onto the gravel, power to idle.';
    return null;
  },
};

// ------------------------------------------------------------------ 38: Harbor Cranes
// Harbor City's container port, on the coast 900 m east of the runway and six kilometres out: a quay 1.3 km long,
// five ship-to-shore cranes, container stacks, a container ship alongside, a barque at anchor off the entrance.
// The approach is flown up the harbor along a lane 1 km right of the runway, through the entrance and exit gates.
// The fourth crane has its boom lowered right across the lane (its underside 50 m above the water, its stays above
// it, its tip 7 m past the middle of the lane); under it is a bonus gate. Then a left turn out of the harbor onto
// a final of about four kilometres.
const LANE = 1000;           // the lane up the harbor, metres right of the runway centreline
const QUAY_FACE = 930;       // the quay's seaward face
const BOOM_U = -5500;        // the crane with its boom lowered across the lane
const harborCranes = {
  id: 'harbor-cranes', n: 38, title: 'Harbor Cranes', group: 'obstacles', difficulty: 4, tags: ['obstacles', 'heavy'],
  aircraft: 'condor', site: 'harbor', time: 17.2, vis: 25000,
  desc: 'The scenic approach to Harbor City: up the container port at crane height, through the harbor gates, past a ship being loaded. One crane has its boom down right across the lane, 50 metres over the water with its stays above it. Over, under or around it; then turn left and land on 3,200 m of runway.',
  tips: [
    'Fly the lane up the harbor through both gates, 200 ft over the water, flaps 30, gear down, about 150 kt. Small bank angles: your wingtips are 17 m out.',
    'The lowered boom: over it means 300 ft or more, clear of its stays; under it means 100 ft or less, because your fin is 9 m tall. Under it is worth 10 points.',
    'After the exit gate, turn left and climb gently to 500 ft; the glideslope comes down to meet you about four kilometres out. Arm the spoilers (K) and set autobrake (L).',
  ],
  wind: { rel: 70, speed: 8, turb: 0.15 }, weight: 'normal',
  spawn: { u: -8000, v: 1320, hdg: -12, alt: 60, gamma: 0, flap: 0.75, speedKt: 150, fixed: true },
  failures: [], scoring: { type: 'runway' },
  course: {
    obstacles: [
      { kind: 'quay', u: -5750, v: QUAY_FACE - 50, w: 100, d: 1300, top: 4, name: 'the quay' },
      { kind: 'containers', u: -6050, v: 855, rot: -90, cols: 9, rows: 10, tiers: 4, base: -4, seed: 3 },
      { kind: 'containers', u: -5250, v: 855, rot: -90, cols: 7, rows: 10, tiers: 5, base: -4, seed: 9 },
      { kind: 'crane', type: 'sts', u: -6250, v: 900, boom: 80, base: -4 },
      { kind: 'crane', type: 'sts', u: -6000, v: 900, boom: 80, base: -4 },
      { kind: 'crane', type: 'sts', u: -5750, v: 900, boom: 80, base: -4, color: 'craneBlue' },
      { kind: 'crane', type: 'sts', u: BOOM_U, v: 900, boom: 0, outreach: 90, base: -4, name: 'a container crane', boomName: 'the lowered crane boom' },
      { kind: 'crane', type: 'sts', u: -5250, v: 900, boom: 80, base: -4, color: 'craneBlue' },
      { kind: 'ship', type: 'container', u: -6120, v: QUAY_FACE + 17, rot: -90, length: 240, beam: 30, seed: 4, name: 'the container ship' },
      { kind: 'ship', type: 'tall', u: -6750, v: 1150, rot: -80, length: 72, beam: 11, name: 'the barque', mastName: 'the barque\'s masts' },
    ],
    gates: [
      { u: -6550, v: LANE, y: 52, w: 120, h: 90, name: 'the harbor entrance', required: true },
      { u: BOOM_U, v: LANE, y: 18, w: 40, h: 24, name: 'under the boom', required: false, bonus: 10 },
      { u: -5100, v: LANE, y: 52, w: 120, h: 90, name: 'the harbor exit', required: true },
    ],
  },
  // RoutePilot: the lane at 60 m, down to 20 m over the water for the boom (the bonus), back up, then out of the
  // harbor with a left turn and a climb onto the glideslope.
  route: [
    { u: -7200, v: 1120, alt: 55, kt: 150 },
    { u: -6550, v: LANE, alt: 50, kt: 150 },
    { u: -5700, v: LANE, alt: 22, kt: 150 },
    { u: -5350, v: LANE, alt: 22, kt: 150 },
    { u: -5100, v: LANE, alt: 40, kt: 150 },
    { u: -4400, v: 700, alt: 110, kt: 150 },
    { u: -3700, v: 250, alt: 160, kt: 148 },
    { u: -3000, v: 0, alt: 182, kt: 145 },
    { u: -2600, v: 0, alt: 161, kt: 142 },
  ],
  hint: (c) => {
    if (c.ac.onGround) return null;
    const n = c.mission.next();
    if (c.u > -6700 && c.u < -5100 && Math.abs(c.v - LANE) > 60) return `Back to the lane up the harbor: ${Math.round(Math.abs(c.v - LANE))} m ${c.v > LANE ? 'left' : 'right'}.`;
    if (c.u > -6000 && c.u < BOOM_U) return 'Lowered boom ahead: over it at 300 ft, or under it below 100 ft (your fin is 9 m tall).';
    if (n && n.gate.required && n.dist < 1500) return `Next: ${n.gate.name}, ${Math.round(n.dist / 10) * 10} m.`;
    if (c.u > -5100 && c.u < -2600 && Math.abs(c.v) > 30) return 'Out of the harbor: turn left onto the runway and climb gently to 500 ft.';
    return null;
  },
};

export const OBSTACLES_MISSIONS = [powerLines, theNotch, harborCranes];
