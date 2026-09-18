// New missions: maps. Each entry follows src/missions/README.md; ids are permanent.
//
// Five missions on the four new maps (src/missions/sites.js), menu group 'maps' ("Far places"), n 39-43:
//   hill-hop    Skylark, Kestrel Island: over the saddle, a 6.5-degree dive, stopped before the beach
//   beach-buzz  Condor, Paradise Bay: fifteen metres over the sunbathers, then on the numbers and stop
//   mesa-top    Trailblazer, Red Mesa: a 150 m cliff thirty metres before a 500 m strip, shear and chop at the rim
//   whiteout    Skylark, Frostbite Lake: snow, 900 m visibility, a crosswind on a runway of ice
//   dust-wall   Skylark, Red Mesa: a haboob on final, the visibility falls to a kilometre, gusty crosswind
// The weather's look and model come from the weather area (src/systems/weather.js, src/art/weather-look.js);
// these carry the spec, and the visibility and wind that matter to the flying are the scenario's own vis
// and wind (plus, for dust-wall, the rough air of the dust front, a turbBurst). Each one is landed by the stock
// Autoland on its straight path (tools/test-maps.mjs checks that path clears the terrain, and only just; the
// branch's commit messages carry the headless flights, with the weather model and without it).
// eslint-disable-next-line no-unused-vars
import { treeWall, rwToWorld } from './util.js';

const T = (...tags) => tags;

export const MAPS_MISSIONS = [
  {
    id: 'hill-hop', n: 39, group: 'maps', difficulty: 3, title: 'Hill Hop', tags: T('map', 'short', 'gusty'),
    aircraft: 'skylark', site: 'kestrel', time: 10.5, vis: 40000,
    desc: 'A 650 m strip with a hill in front of it and the sea behind it. Come up the valley, cross the saddle a few metres above the cars on the road, then dive at 6.5 degrees and get it stopped before the sunbathers.',
    tips: [
      'The saddle is the only gap in the ridge: about 80 m wide, right on the centreline. The hills either side are 100 m high.',
      'Over the ridge: throttle to idle and push. The PAPI is set at 6.5 degrees; two white, two red still means on the path, it just looks like a dive.',
      'The trade wind gusts through the col. Hold 62 kt and flare early: at 6.5 degrees you come down at 700 ft a minute, twice the usual. Then brake hard, the beach is 650 m away. Brakes: hold Space.',
    ],
    wind: { rel: 40, speed: 12, gust: 20, turb: 0.4 }, weight: 'normal',
    spawn: { dist: 1600, flap: 1.0 }, failures: [], scoring: { type: 'runway' },
    hint: (c) => (c.ac.onGround || c.ac.crashed ? null
      : c.d > 420 ? 'Line up on the saddle: the gap in the ridge, dead ahead. Stay on the PAPI.'
      : c.d > 180 ? 'Over the col: idle, and push over. Two white, two red.'
      : c.d > -60 ? 'Steep and fast down: start the flare early.'
      : null),
  },
  {
    id: 'beach-buzz', n: 40, group: 'maps', difficulty: 2, title: 'Beach Buzz', tags: T('map', 'heavy'),
    aircraft: 'condor', site: 'paradise', time: 16, vis: 40000,
    desc: 'Open sea, a strip of white sand, the coast road, a fence, and the runway. You cross the beach at about fifteen metres with the whole airliner; the people with cameras are there for exactly that. Then put it on the numbers and stop.',
    tips: [
      'Fly the ILS all the way down. Over the beach you will be 50 ft up with the wheels out; that is where the glideslope is, not a mistake.',
      'The aiming point is 200 m in. Flare at 30 ft, thrust to idle at the "retard" call, and do not float.',
      'Arm the spoilers (K) and set autobrake (L). Full reverse (hold R) after touchdown: heavy on 2,300 m.',
    ],
    wind: { rel: 25, speed: 10, gust: 16, turb: 0.2 }, weight: 'heavy',
    spawn: { dist: 2200, flap: 0.75 }, failures: [], scoring: { type: 'runway' },
    hint: (c) => (c.ac.onGround || c.ac.crashed ? null
      : c.d < 160 && c.d > 20 ? 'Sunbathers below. Stay on the glideslope: it is supposed to look this close.'
      : c.d < 900 ? 'Beach ahead. Hold the glideslope all the way; do not duck under it for the numbers.'
      : null),
  },
  {
    id: 'mesa-top', n: 41, group: 'maps', difficulty: 4, title: 'Mesa Top', tags: T('map', 'bush', 'gusty'),
    aircraft: 'trailblazer', site: 'redmesa', time: 8.3, vis: 60000,
    desc: 'A 500 m dirt strip on top of a 150 m sandstone cliff. The wind pours over the mesa and down its face, so the last hundred metres before the rim are shear and chop. Arrive on the path, cross the edge with a few metres to spare, and put it down.',
    tips: [
      'Stay on the 4.5-degree path until the rim. Close to the mesa the headwind drops away and the airspeed goes with it: below the path you will not climb out of that in a Trailblazer.',
      'Full flap (F twice), 5 kt above the usual 48 for the gusts, and a hand on the throttle over the edge.',
      'Over the lip: idle, three-point it, brake gently. Touch down in the first 100 m and 500 m is plenty.',
    ],
    wind: { rel: 0, speed: 14, gust: 22, turb: 0.55, shear: 0.7 }, weight: 'normal',
    spawn: { dist: 1400, flap: 1.0, speedKt: 53 }, failures: [], scoring: { type: 'bush', vref: 53 },
    hint: (c) => (c.ac.onGround || c.ac.crashed ? null
      : c.d > 150 ? 'Hold 53 kt on the 4.5° path. The rim is the obstacle: cross it high.'
      : c.d > 20 ? 'Sink and chop at the edge: a touch of power, do not dive at it.'
      : null),
  },
  {
    id: 'whiteout', n: 42, group: 'maps', difficulty: 4, title: 'Whiteout', tags: T('map', 'weather', 'crosswind'),
    aircraft: 'skylark', site: 'frostbite', time: 13, vis: 900,
    weather: { preset: 'snow', snow: 0.9 },
    desc: 'Snow blowing across a frozen lake, 900 metres of visibility, and a runway that is a ploughed strip of ice. The crosswind is only 10 knots; the problem is the grip, or the lack of it: whichever way the wheels touch down is the way the airplane keeps going.',
    tips: [
      'You will see nothing until about half a mile out, then the black spruce on both shores. Until then fly the PAPI and the edge lights; the cones come last.',
      'Crab into the wind all the way down and kick it straight only in the flare. On ice, a wheel that touches down sideways keeps going sideways.',
      'Braking does almost nothing on ice. Land slow, hold the nose up to use the drag, and steer with rudder (Q/E), not the brakes.',
    ],
    wind: { rel: 60, speed: 11, gust: 15, turb: 0.3 }, weight: 'normal',
    spawn: { dist: 1400, flap: 0.667 }, failures: [], scoring: { type: 'runway' },
  },
  {
    id: 'dust-wall', n: 43, group: 'maps', difficulty: 5, title: 'Dust Wall', tags: T('map', 'weather', 'crosswind', 'bush'),
    aircraft: 'skylark', site: 'redmesa', time: 17, vis: 6000,
    weather: { preset: 'dust', dust: 0.8, events: [
      { type: 'visDrop', at: { type: 'dist', value: 1500 }, vis: 1100, ramp: 8 },
      { type: 'turbBurst', at: { type: 'dist', value: 1500 }, turb: 0.3, dur: 12 },   // the front's rough air
    ] },
    desc: 'A haboob is coming over the mesa, and so are you. Gusts to 23 knots across a 500 m strip on a cliff top, and when the dust wall arrives the visibility goes from six kilometres to one. Get lined up while you can still see.',
    tips: [
      'The dust arrives on final and the mesa goes grey at about a mile. Before it does, line up and fix where the strip sits against the rim.',
      'Crab into the wind and carry 5 kt extra for the gusts. Cross the rim high rather than low: the cliff is 150 m straight down.',
      'In the flare, kick it straight with rudder (Q/E) and hold the upwind wing down. Keep flying it with the ailerons until it has stopped.',
    ],
    wind: { rel: -50, speed: 15, gust: 23, turb: 0.5 }, weight: 'normal',
    spawn: { dist: 2600, flap: 0.667 }, failures: [], scoring: { type: 'bush' },
    hint: (c) => (c.ac.onGround || c.ac.crashed ? null
      : c.d > 1500 ? 'The dust is coming. Line up now, while you can still see the strip against the rim.'
      : c.d > 150 ? 'Crab into the wind. Cross the rim high: the cliff is 150 m straight down.'
      : null),
  },
];

// Sites this area adds (same shape as SITES in src/systems/scenarios.js). Merged into SITES by index.js.
// (The four new maps are in src/missions/sites.js, NEW_SITES.)
export const MAPS_SITES = {};
