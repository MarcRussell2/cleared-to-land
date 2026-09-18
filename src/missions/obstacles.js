// New missions: obstacles. Each entry follows src/missions/README.md; ids are permanent.
// The obstacles themselves are built by src/world/obstacles.js from the `course` specs below (its header lists
// every kind); the routes are what RoutePilot flies to prove each mission can be landed (tools/fly-mission.mjs,
// tools/test-obstacles.mjs), and the tips tell a human the same technique.
//
// Hints get ctx = { ac, ra (ft), d (m to the threshold), t, u, v (runway frame, metres), mission }, where
// mission.next() is the next pending gate ({ name, dist }) or null. Return a string, or null for the game's usual
// hint. Hints name no keys (the touch layer would have to translate them).

// Moose Creek Notch: the gravel bar of Moose Creek (SITES.gravelbar, same valley, same bar) with its tree wall
// grown into a forest edge 40 m tall, three rows deep, and one notch cut through it 16 m left of the centreline.
// The ordinary scattered spruce are there too, all as course trees (one instanced draw, swept collision).
const NOTCH_V = -16, NOTCH_W = 30;
const notchbar = {
  id: 'notchbar', name: 'Moose Creek Notch', kind: 'bush',
  terrain: { style: 'mountain', seed: 61, size: 14000, res: 400, elevation: 520, waterLevel: 516, valleyWidth: 1400, trees: 0.9, treeArea: 4500, snowLine: 1900 },
  runways: [{ x: 0, z: 0, heading: 0, length: 340, width: 14, surface: 'gravel', elevation: 520, name: '36', nameRecip: '18', papi: false, ils: false, lights: false, windsock: true, markers: true, aimDistance: 50, flatWidth: 60, flatMargin: 120 }],
  course: {
    obstacles: [
      { kind: 'treeWall', u: -152, from: -110, to: 110, step: 9, scale: 1.5, rows: 3, rowGap: 13, jitter: 3, seed: 7, gap: { v: NOTCH_V, w: NOTCH_W } },
      // the valley's scattered spruce, where Moose Creek Bar has them (x -> v, z -> -u)
      ...[[-34, 260, 1.1], [45, 320, 1.2], [22, 420, 1.0], [-48, 470, 1.1], [-25, -420, 1.2], [40, -380, 1.1]].map(([x, z, s]) => ({ kind: 'tree', u: -z, v: x, scale: s })),
    ],
    // keep the decorative forest off the line through the notch and the drop to the bar
    clear: [{ u: -120, v: -10, r: 40 }, { u: -80, v: -4, r: 35 }],
  },
};

export const OBSTACLES_SITES = { notchbar };

// ------------------------------------------------------------------ 36: Power Lines
// Ridgefield (runway 36, 1,600 m, threshold 120 m). A 36 m line of lattice pylons crosses short final 600 m out,
// its lowest wire sagging to about 20 m over the centreline; a 10 m pole line runs along the road 230 m out.
// You start low under the murk, level at 25 m, and the wires are exactly where you are.
const powerLines = {
  id: 'power-lines', n: 36, title: 'Power Lines', group: 'obstacles', difficulty: 2, tags: ['obstacles', 'low'],
  aircraft: 'skylark', site: 'ridgefield', time: 7.8, vis: 4500,
  desc: 'Scud-running under the murk at 80 ft, and the county\'s 36-metre power line crosses short final 600 m out. Its lowest wire sags to 20 m over the centerline, which is below you now and above you in a minute. Get over it, then get down onto 1,600 m of runway.',
  tips: [
    'The pylons show up first. The moment you see them, climb: full power and a gentle pull, to about 50 m (160 ft). A Skylark climbs 500 feet a minute, not a thousand.',
    'Cross over the orange marker balls with a few metres to spare, then power back and let the nose come down onto a normal 3-degree final.',
    'There is a 10 m pole line along the road 230 m before the runway. Do not dive for the numbers: 1,600 m of runway will take a long landing.',
  ],
  wind: { rel: 25, speed: 8, turb: 0.2 }, weight: 'normal',
  spawn: { u: -2600, v: 0, alt: 20, gamma: 0, flap: 0.333, speedKt: 72, fixed: true },
  failures: [], scoring: { type: 'runway' },
  course: {
    obstacles: [
      { kind: 'powerline', type: 'hv', from: { u: -530, v: -900 }, to: { u: -670, v: 900 }, spans: 5, h: 36, sag: 5, markers: 60, name: 'the power lines' },
      { kind: 'powerline', type: 'pole', from: { u: -230, v: -550 }, to: { u: -230, v: 550 }, spans: 11, h: 10, name: 'the power lines along the road' },
    ],
  },
  // RoutePilot: climb over the wires early, cross 20 m above them, then join the 3-degree path.
  route: [
    { u: -1800, v: 0, alt: 46, kt: 70 },
    { u: -640, v: 0, alt: 47, kt: 68 },
    { u: -420, v: 0, alt: 38, kt: 64 },
  ],
  hint: (c) => {
    if (c.ac.onGround) return null;
    if (c.u < -660) {
      const agl = c.ra * 0.3048;
      if (agl < 38) return `Power lines in ${Math.round((-600 - c.u) / 10) * 10} m: climb above the pylon tops (120 ft) now.`;
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
  desc: 'The spruce in front of Moose Creek Bar have grown into a wall 40 metres tall and three rows deep, and the only way through is a notch 30 metres wide, 16 metres left of the strip. Go through it low, wings level, then drop onto 340 m of gravel. Over the top counts as not doing the mission.',
  tips: [
    'Full flap (F twice), 50 kt, and line up on the orange gate in the notch from a long way out. It is 16 m left of the centerline; your wings are 11 m.',
    'Through the gap at 10 to 20 metres above the ground, wings level. The crowns are widest at the bottom of the green, so low and centred is the safe line.',
    'Once through, a gentle right S-turn onto the gravel, power to idle, touch down early. Brake gently (Space) or it will nose over.',
  ],
  wind: { rel: 25, speed: 6, turb: 0.3 }, weight: 'normal',
  spawn: { u: -850, v: -12, hdg: 0, alt: 62, gamma: -3, flap: 1, speedKt: 52, fixed: true },
  failures: [], scoring: { type: 'bush' },
  course: {
    gates: [{ u: -165, v: NOTCH_V, y: 17, w: 26, h: 22, name: 'the notch', required: true }],
  },
  route: [
    { u: -520, v: NOTCH_V, alt: 34, kt: 52 },
    { u: -196, v: NOTCH_V, alt: 17, kt: 50, over: true },
    { u: -132, v: NOTCH_V, alt: 15, kt: 50, over: true },
    { u: -70, v: -3, alt: 10, kt: 49, over: true },
  ],
  hint: (c) => {
    if (c.ac.onGround) return null;
    if (c.u < -200) {
      const off = c.v - NOTCH_V;
      if (Math.abs(off) > 6) return `Line up on the notch: move ${Math.round(Math.abs(off))} m ${off > 0 ? 'left' : 'right'}, it is the gap with the orange gate.`;
      const agl = c.ra * 0.3048;
      if (c.u > -420 && agl > 26) return 'Too high for the notch: power back and get down to 15 m before the trees.';
      return 'On the notch. Wings level, 50 kt, down to 15 m above the ground.';
    }
    if (c.u < -120) return 'Through! Hold it level.';
    if (c.u < 0) return 'Gentle right onto the gravel, power to idle.';
    return null;
  },
};

// ------------------------------------------------------------------ 38: Harbour Cranes
// Harbor City's container port, on the bay 900 m east of the runway: a quay, five ship-to-shore cranes, a
// container ship alongside, a barque at anchor off the entrance. The harbour approach is flown low up the bay
// through two gates; the fourth crane has its boom lowered right across the lane (bottom 49 m above the water,
// its stays up to 60), then a left turn out of the harbour onto a four-kilometre final.
const HV = 955;   // the lane up the harbour, metres right of the runway centreline
const harborCranes = {
  id: 'harbor-cranes', n: 38, title: 'Harbour Cranes', group: 'obstacles', difficulty: 4, tags: ['obstacles', 'heavy'],
  aircraft: 'condor', site: 'harbor', time: 17.2, vis: 25000,
  desc: 'The scenic approach to Harbor City: up the container port at crane height, through the harbour gates, past a barque at anchor and a ship being loaded. One crane has its boom down right across the lane, 49 metres over the water with its stays above it. Over, under, or around; then turn left and land.',
  tips: [
    'Fly the lane up the harbour through both gates, 60 to 80 m over the water, flaps 30, gear down, about 160 kt. Small bank angles: your wingtips are 17 m out.',
    'The lowered boom: over it means 80 m or more, clear of its stays. Under it means below 35 m, because your fin is 9 m tall. Under it is worth 10 points.',
    'After the exit gate, turn left and climb gently onto the glideslope; you have about four kilometres. Arm the spoilers (K) and set autobrake (L).',
  ],
  wind: { rel: 70, speed: 8, turb: 0.15 }, weight: 'normal',
  spawn: { u: -8300, v: 1500, hdg: -25, alt: 70, gamma: 0, flap: 0.75, speedKt: 160, fixed: true },
  failures: [], scoring: { type: 'runway' },
  course: {
    obstacles: [
      { kind: 'quay', u: -5350, v: 820, w: 160, d: 2000, deck: 3, name: 'the quay' },
      { kind: 'containers', u: -5750, v: 800, rot: -90, cols: 9, rows: 12, tiers: 4, deck: 3, seed: 3 },
      { kind: 'containers', u: -4950, v: 790, rot: -90, cols: 7, rows: 10, tiers: 5, deck: 3, seed: 9 },
      { kind: 'crane', type: 'sts', u: -6130, v: 883, boom: 80, deck: 3 },
      { kind: 'crane', type: 'sts', u: -5930, v: 883, boom: 80, deck: 3 },
      { kind: 'crane', type: 'sts', u: -5480, v: 883, boom: 80, deck: 3, color: 'craneBlue' },
      { kind: 'crane', type: 'sts', u: -5150, v: 883, boom: 0, deck: 3, name: 'a container crane', boomName: 'the lowered crane boom' },
      { kind: 'crane', type: 'sts', u: -4750, v: 883, boom: 80, deck: 3, color: 'craneBlue' },
      { kind: 'ship', type: 'container', u: -6030, v: 918, rot: -90, length: 240, beam: 32, seed: 4, name: 'the container ship' },
      { kind: 'ship', type: 'tall', u: -6900, v: 1030, rot: -80, length: 72, beam: 11, name: 'the barque', mastName: 'the barque\'s masts' },
    ],
    gates: [
      { u: -6550, v: HV, y: 52, w: 120, h: 90, name: 'the harbour entrance', required: true },
      { u: -5128, v: HV, y: 16, w: 50, h: 26, name: 'under the boom', required: false, bonus: 10 },
      { u: -4500, v: HV, y: 52, w: 120, h: 90, name: 'the harbour exit', required: true },
    ],
  },
  // RoutePilot flies the lane over the boom, then the turn out of the harbour onto the ILS.
  route: [
    { u: -7150, v: HV, alt: 60, kt: 160 },
    { u: -6300, v: HV, alt: 64, kt: 160 },
    { u: -5500, v: HV, alt: 82, kt: 160 },
    { u: -4850, v: HV, alt: 82, kt: 160 },
    { u: -4400, v: HV, alt: 72, kt: 160 },
    { u: -2950, v: 0, alt: 150, kt: 150 },
    { u: -2350, v: 0, alt: 142, kt: 145 },
  ],
  hint: (c) => {
    if (c.ac.onGround) return null;
    const n = c.mission.next();
    if (c.u < -4450 && Math.abs(c.v - HV) > 60) return `Back to the lane up the harbour: ${Math.round(Math.abs(c.v - HV))} m ${c.v > HV ? 'left' : 'right'}.`;
    if (c.u < -5250 && c.u > -5900) return 'Lowered boom ahead: over it at 80 m, or under it below 35 m (your fin is 9 m tall).';
    if (n && n.gate && n.gate.required && n.dist < 1500) return `Next: ${n.gate.name}, ${Math.round(n.dist / 10) * 10} m.`;
    if (c.u > -4450 && c.u < -2400) return 'Out of the harbour: turn left onto the runway and climb gently to the glideslope.';
    return null;
  },
};

export const OBSTACLES_MISSIONS = [powerLines, theNotch, harborCranes];
