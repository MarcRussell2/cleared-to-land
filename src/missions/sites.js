// New sites (maps). Same shape as SITES in src/systems/scenarios.js; ids are permanent.
// A site may also carry `course` (obstacles and gates present in every mission flown there).
//
// The four maps of the missions expansion (2026-09-17), each on a terrain style of its own
// (src/world/terrain.js has what the parameters mean, at each style's height function):
//   kestrel    Kestrel Island: a 650 m strip on a tropical island. A ridge with a road in its saddle
//              stands 250 m before the threshold; the far end is a white beach and the sea.
//   paradise   Paradise Bay Intl: an airliner field whose threshold sits 60 m behind a public beach
//              and the coast road; the approach is over open sea. 2,300 m.
//   frostbite  Frostbite Lake: a 1,200 m ice runway ploughed on a frozen lake among snowy hills.
//   redmesa    Red Mesa: a 500 m dirt strip on top of a mesa in canyon country; the cliff drops 150 m
//              thirty metres before the threshold.
// Every runway sits at the origin heading north like the original six (the far ring, the 20 m ground grid
// and the "leaving the area" check are origin-centred), and each terrain places its features in the runway
// frame, so a ridge or a cliff is exactly where the missions in src/missions/maps.js expect it.
// Runway fields beyond the originals: `props` (a set of site props drawn by src/art/world-biomes.js through
// src/art/airport-look.js: 'kestrel' | 'paradise' | 'frostbite') and `surroundings` ({roads, villages: [[u, v,
// count, spread]]} in the runway frame, instead of the default roads and villages). A road is {w, pts: [[u, v],
// ...]}, a polyline the site props draw draped on the ground (terrain-look's buildRoad draws its ribbon facing
// down, so from above it is never seen; see world-biomes.js), or the old [u0, v0, u1, v1, width] for that one.
// eslint-disable-next-line no-unused-vars
import { treeWall } from './util.js';
import { DEG } from '../config.js';

// The runway frame the terrain places its features in: runway 0's threshold and heading.
const frame = (r) => ({ x: r.x, z: r.z, heading: r.heading });

// A runway's flattened area, explicitly: `before` metres of level ground before the threshold and `after` past
// the far end, `width` either side of the centreline, then a blend back to the natural ground over m0 metres at
// the approach end, m1 at the far end and mv at the sides; `trees` is the clutter-free margin. (siteFlats() in
// src/systems/scenarios.js gives an airport 300 m before the threshold and a 600 m blend, which would level the
// ridge, the cliff and the beach these maps are about; the terrain takes these instead when a site hands them.)
export function runwayFlat(r, { before, after, width, m0, m1, mv, trees }) {
  const h = r.heading * DEG, dx = Math.sin(h), dz = -Math.cos(h), slope = r.slope || 0;
  const u0 = -before, u1 = r.length + after, uc = (u0 + u1) / 2;
  return {
    x: r.x + dx * uc, z: r.z + dz * uc, heading: r.heading, halfLength: (u1 - u0) / 2, halfWidth: width,
    elevation: r.elevation + slope * uc, slope, margin: Math.max(m0, m1, mv), m0, m1, mv, treeMargin: trees,
  };
}

// ---------------------------------------------------------------- Kestrel Island
// up the approach valley's left side, over the col (the cars on it are solid) and down to the terminal
const KESTREL_ROADS = [{ w: 6, pts: [[-1250, -190], [-800, -175], [-520, -140], [-360, -80], [-275, -30], [-250, 10], [-246, 60], [-205, 92], [-140, 105], [0, 100], [200, 100], [330, 95], [385, 85]] }];
// St Barth-inspired. You come in over the sea and up a green valley to a col between two hills; a road runs
// through the saddle (the cars on it are solid). Over the col the strip is right below you: a 6.5-degree PAPI,
// 650 m of asphalt, and a beach at the end of it.
const KESTREL_RW = {
  x: 0, z: 0, heading: 0, length: 650, width: 20, surface: 'asphalt', elevation: 5, name: '36', nameRecip: '18',
  papi: true, papiAngle: 6.5, gsAngle: 6.5, ils: false, lights: true, approachLights: false, windsock: true, aimDistance: 80,
  props: 'kestrel', taxiway: false,   // (no parallel taxiway: the apron beside the strip is the site's own)
  surroundings: {
    roads: KESTREL_ROADS,
    villages: [[-1300, -950, 80, 320], [-700, 900, 50, 260], [380, -620, 28, 160], [-1900, 400, 40, 260]],
  },
};

// ---------------------------------------------------------------- Paradise Bay Intl
// the coast road behind the beach (it turns inland where the coast bends away), the road along the field's far
// side and its spur to the terminal, and the road up to the hill town
const PARADISE_ROADS = [
  { w: 8, pts: [[-34, -720], [-34, 1080], [20, 1160], [120, 1205], [260, 1236]] },
  { w: 7, pts: [[-34, 700], [2700, 700]] }, { w: 6, pts: [[1334, 700], [1334, 372]] }, { w: 6, pts: [[-34, -700], [1500, -800]] },
];
// Princess Juliana-inspired. Open sea, a strip of white sand with a few umbrellas, the coast road, the airport
// fence, the threshold. Behind the field the island rises to green hills.
const PARADISE_RW = {
  x: 0, z: 0, heading: 0, length: 2300, width: 45, surface: 'asphalt', elevation: 4, name: '36', nameRecip: '18',
  papi: true, ils: true, lights: true, approachLights: false, buildings: true, aimDistance: 200,
  props: 'paradise',
  surroundings: {
    roads: PARADISE_ROADS,
    villages: [[900, -1150, 110, 420], [2100, 1300, 120, 440], [-40, -1150, 36, 220], [-40, 1150, 36, 220], [2900, -500, 70, 300]],
  },
};

// ---------------------------------------------------------------- Frostbite Lake
// An ice runway ploughed on a frozen lake, marked with cones, among low snowy hills and black spruce.
const FROST_RW = {
  x: 0, z: 0, heading: 0, length: 1200, width: 30, surface: 'ice', elevation: 180, name: '36', nameRecip: '18',
  papi: true, ils: false, lights: true, approachLights: false, windsock: true, markers: true, aimDistance: 180,
  props: 'frostbite',
};

// ---------------------------------------------------------------- Red Mesa
// A dirt strip on a mesa top in red canyon country. You fly at a 150 m wall of rock and land just past its
// edge. No trees anywhere.
const MESA_RW = {
  x: 0, z: 0, heading: 0, length: 500, width: 18, surface: 'dirt', elevation: 1480, name: '36', nameRecip: '18',
  papi: false, ils: false, lights: false, windsock: true, markers: true, aimDistance: 70, gsAngle: 4.5,
};

export const NEW_SITES = {
  kestrel: {
    id: 'kestrel', name: 'Kestrel Island', kind: 'airport',
    terrain: {
      style: 'island', seed: 131, size: 26000, res: 330, elevation: 5, waterLevel: 0, trees: 0.7, treeArea: 5000,
      rwFrame: frame(KESTREL_RW),
      // the terminal, the hangar and the apron beside the strip (world-biomes.js draws them), and the road
      clear: { spots: [{ u: 390, v: 64, r: 22 }, { u: 530, v: 58, r: 16 }, ...[370, 420, 470, 520].map((u) => ({ u, v: 31, r: 26 }))], roads: KESTREL_ROADS },
      // (the strip, narrow so the valley's sides stay steep; and a wider level shelf beside its middle for the
      // PAPI, 25 to 52 m left of the centreline, and the apron, the terminal and the hangar on the right, which
      // otherwise stood up to 2.5 m into the hillside. Both stop well clear of the saddle and the beach.)
      runwayFlats: [runwayFlat(KESTREL_RW, { before: 35, after: 25, width: 30, m0: 70, m1: 45, mv: 55, trees: 18 }),
        runwayFlat(KESTREL_RW, { before: -40, after: -90, width: 64, m0: 40, m1: 40, mv: 45, trees: 12 })],
      island: {
        x: -300, z: 650, rx: 2700, rz: 1350, wobble: 0.14, calm: { x: 0, z: -690, r: 380, fade: 650 }, beach: 40, low: 12, hills: 170,
        peaks: [{ x: -540, z: 240, r: 260, h: 150 }, { x: 580, z: 290, r: 300, h: 130 }, { x: -1600, z: 950, r: 650, h: 230 }, { x: 1300, z: 1050, r: 520, h: 170 }],
        ridges: [{ u: -240, crest: 32, side: 100, half: 80, wIn: 100, wOut: 140 }],
        lows: [{ u0: -2600, u1: -120, half: 200, fade: 300, max: 10 }, { u0: -120, u1: 760, half: 80, fade: 240, max: 7 }],
        shelf: 520, deep: 28, far: [{ x: 9000, z: -6500, r: 1600, h: 300 }, { x: -8500, z: 7000, r: 1100, h: 210 }],
      },
    },
    runways: [KESTREL_RW],
  },
  paradise: {
    id: 'paradise', name: 'Paradise Bay Intl', kind: 'airport',
    terrain: {
      style: 'island', seed: 157, size: 28000, res: 330, elevation: 4, waterLevel: 0, trees: 0.6, treeArea: 3600,
      rwFrame: frame(PARADISE_RW),
      // the beach hotels (world-biomes.js draws them) and the roads
      clear: { spots: [{ u: 10, v: -470, r: 29 }, { u: 40, v: -700, r: 24 }, { u: 15, v: 520, r: 32 }, { u: 70, v: 760, r: 21 }], roads: PARADISE_ROADS },
      runwayFlats: [runwayFlat(PARADISE_RW, { before: 15, after: 200, width: 330, m0: 25, m1: 400, mv: 350, trees: 150 })],
      island: {
        x: 400, z: -3880, rx: 6000, rz: 4000, wobble: 0.16, calm: { x: 0, z: 110, r: 1100, fade: 900 }, beach: 45, low: 10, hills: 260,
        peaks: [{ x: 2600, z: -2600, r: 900, h: 330 }, { x: -2400, z: -3600, r: 1000, h: 280 }, { x: 900, z: -5200, r: 1200, h: 380 }],
        lows: [{ u0: -200, u1: 2700, half: 650, fade: 450, max: 5 }],
        shelf: 700, deep: 30, far: [{ x: -6500, z: 11000, r: 1300, h: 820 }, { x: 9000, z: 9000, r: 1800, h: 260 }],
      },
    },
    runways: [PARADISE_RW],
  },
  frostbite: {
    id: 'frostbite', name: 'Frostbite Lake', kind: 'airport',
    terrain: {
      style: 'arctic', seed: 211, size: 26000, res: 330, elevation: 180, trees: 0.9, treeArea: 3800, snowLine: 150,
      rwFrame: frame(FROST_RW),
      runwayFlats: [runwayFlat(FROST_RW, { before: 200, after: 150, width: 60, m0: 200, m1: 200, mv: 150, trees: 40 })],
      arctic: {
        // a long, narrow lake: the spruce on its shores stands about 480 m either side of the runway, a dark line
        // down each side in clear air
        lake: { u: 300, halfLength: 3300, halfWidth: 480, wobble: 0.14 },
        islets: [{ u: -1700, v: 230, r: 90, h: 12 }, { u: 1850, v: -250, r: 120, h: 18 }, { u: -2600, v: -200, r: 70, h: 9 }],
        hills: 340, lows: [{ u0: -9000, u1: -2800, half: 420, fade: 900, max: 215 }],
      },
    },
    runways: [FROST_RW],
  },
  redmesa: {
    id: 'redmesa', name: 'Red Mesa', kind: 'bush',
    terrain: {
      style: 'desert', seed: 173, size: 26000, res: 330, elevation: 1480, trees: 0,
      rwFrame: frame(MESA_RW),
      runwayFlats: [runwayFlat(MESA_RW, { before: 6, after: 50, width: 24, m0: 14, m1: 60, mv: 40, trees: 20 })],
      desert: {
        floor: -150, butte: 190,
        // (the edge holds still only 60 m either side of the centreline, where the missions cross it; beyond
        // that the face wanders like the rest of it, so the mesa reads as rock rather than as a cake)
        mesa: { u0: -30, u1: 820, half: 175, round: 110, wobble: 55, calm: 60 },
        buttes: [{ u: -950, v: -760, r: 170, h: 185 }, { u: -2300, v: 950, r: 240, h: 150 }, { u: -1650, v: -1550, r: 120, h: 215 }, { u: 1500, v: 750, r: 300, h: 120 }],
        canyon: { u: -1350, width: 150, depth: 45, meander: 280 },
        lows: [{ u0: -6000, u1: 900, half: 360, fade: 700 }],
      },
    },
    runways: [MESA_RW],
  },
};
