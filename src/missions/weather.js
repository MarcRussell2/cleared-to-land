// New missions: weather. Each entry follows src/missions/README.md; ids are permanent.
// The weather itself (what the air does) is src/systems/weather.js; what it looks like is src/art/weather-look.js;
// what it sounds like is src/audio-weather.js. Each mission here is flown headless by tools/test-weather.mjs.
// eslint-disable-next-line no-unused-vars
import { treeWall, rwToWorld } from './util.js';

const T = (...tags) => tags;

// Mission hints read the live weather through ctx.mission.weather (src/systems/mission.js); null = the game's own.
const sinceFired = (m, type) => {
  const w = m && m.weather; if (!w) return 1e9;
  const e = w.events.find((x) => x.type === type && x.fired);
  return e ? w.t - e.firedAt : 1e9;
};

export const WEATHER_MISSIONS = [
  {
    id: 'squall', n: 21, title: 'Squall Line', group: 'storms', difficulty: 3, tags: T('weather', 'storm', 'crosswind'),
    aircraft: 'skylark', site: 'bayfield', time: 16.5, vis: 6000,
    desc: 'A line of storms is crossing the field and it gets there when you do. Half a mile out the gust front hits: the wind swings 60 degrees, jumps to 20 gusting 30, and the rain comes down in sheets on a runway that is already wet.',
    tips: [
      'Fly 68 kt, not 62: half the gust factor on top. That margin is what the gust front spends.',
      'When the front hits, the drift flips from left to right. Take the old crab out and put a new one in, early and small. Do not fight the gusts with big inputs.',
      'Wet runway, a third less grip: put it on the numbers, no float, then Brake gently (Space) and keep straight with rudder (Q/E).',
    ],
    wind: { rel: -15, speed: 8, gust: 12, turb: 0.25 }, weight: 'normal', spawn: { dist: 2400, flap: 0.667, speedKt: 68 },
    weather: {
      preset: 'rain', rain: 0.45, darkness: 0.45, ceiling: 380, lightning: 0.15, cells: 2, wet: true,
      events: [{ type: 'squall', at: { type: 'dist', value: 1000 }, shift: 60, speed: 20, gust: 30, rain: 0.95, darkness: 0.15, ramp: 5 }],
    },
    failures: [], scoring: { type: 'runway', vref: 67 },
    // the game's own hints say 62 kt; in this wind it is 68 (the stall warning and the flare stay the game's)
    hint: ({ mission, ra, ac }) => {
      if (ac.onGround || ac.aero.warning) return null;
      if (sinceFired(mission, 'squall') < 12 && ra > 10) return 'Gust front: the wind swung to your right. Re-crab into it, hold 68 kt, small corrections.';
      if (ra > 100) return 'Green circle on the numbers, 68 kt in this wind, PAPI two white two red. Pitch for speed, throttle for the descent.';
      if (ra > 15) return 'Short final: 68 kt through the gusts, small corrections, nose on the centerline.';
      return null;
    },
  },
  {
    id: 'microburst', n: 22, title: 'Microburst', group: 'storms', difficulty: 4, tags: T('weather', 'storm', 'heavy'),
    aircraft: 'condor', site: 'harbor', time: 15.5, vis: 9000,
    desc: 'A thunderstorm is parked on your final two and a half miles out, and it is about to drop a microburst on it. A few knots of free airspeed, then the floor falls out at 3,000 feet a minute and the wind swings round behind you. Fly through it or go around; there is no third option.',
    tips: [
      'Airspeed you did not ask for, under a rain shaft, is the warning, not a gift. Do not pull the power off for it.',
      'WINDSHEAR: thrust to the stops and pitch up toward 15 degrees until the sink stops, into the stick shaker if you have to. Do not chase the airspeed, do not touch flaps or gear.',
      'Once it climbs, lower the nose, bring the power back and ease down onto the glideslope. Or go around before the cell and come back: it rains itself out in about two minutes.',
    ],
    wind: { rel: 10, speed: 10, gust: 16, turb: 0.25 }, weight: 'normal', spawn: { dist: 7000, flap: 0.75, fixed: true },
    weather: {
      preset: 'storm', rain: 0.35, darkness: 0.4, ceiling: 520, lightning: 0.35, cells: 3, wet: true,
      events: [{ type: 'microburst', at: { type: 'dist', value: 6900 }, u: -4600, v: 120, strength: 1.25, outflow: 24, radius: 650, grow: 8, life: 100 }],
    },
    failures: [], scoring: { type: 'runway' },
    hint: ({ mission, d }) => {
      const w = mission && mission.weather; if (!w || !w.burst) return null;
      if (w.state.windshear) return 'WINDSHEAR: full thrust, pitch up toward 15 degrees until the sink stops. Do not chase the airspeed.';
      if (w.shearCount && w.t - w.shearLastT > 1 && w.t - w.shearLastT < 14 && d > 600) return 'Through it. Power back, lower the nose and ease down onto the glideslope, or go around.';
      const toCore = d - (-w.burst.u);
      if (toCore > 0 && toCore < 2600 && w.burstAmp(w.t) > 0.5) return 'Rain shaft ahead: a few free knots come first. Keep the power up; the sink comes next.';
      return null;
    },
  },
  {
    id: 'storm-trap', n: 23, title: 'Storm Trap', group: 'storms', difficulty: 3, tags: T('carrier', 'weather', 'storm'),
    aircraft: 'hornet', site: 'carrier', time: 13.5, vis: 5000,
    desc: 'Daytime, though you would not know it: a thunderstorm over the ship, an 800-foot cloud base, rain, and a wind gusting 21 knots on top of the ship\'s own 25. The deck rises and falls two metres, and the ball and the wind move with it. Catch a wire anyway.',
    tips: [
      'Hook, gear and full flaps are already down: check HOOK DOWN on the HUD. Hold 8 degrees AoA; the gusts will try to take it off you.',
      'Fly the ball\'s average: the deck heaves and the ball bounces with it. Chase every bounce and you will over-correct into the ramp.',
      'Small, quick throttle corrections. A red ball or the wave-off lights: full power, climb straight ahead, come around again.',
    ],
    wind: { rel: 0, speed: 13, gust: 21, turb: 0.3 }, weight: 'normal', spawn: { dist: 1800, hook: true, flap: 1.0 },
    weather: {
      preset: 'storm', rain: 0.6, darkness: 0.5, ceiling: 250, lightning: 0.4, cells: 3, seaState: 1.1,
      events: [{ type: 'turbBurst', at: { type: 'dist', value: 1100 }, turb: 0.3, dur: 7 }],
    },
    failures: [], scoring: { type: 'carrier' },
  },
  {
    id: 'night-storm', n: 24, title: 'Night Storm Trap', group: 'storms', difficulty: 5, tags: T('carrier', 'weather', 'storm'),
    aircraft: 'hornet', site: 'carrier', time: 22.5, vis: 3500,
    desc: 'Night Trap was the hardest thing in aviation. This is Night Trap in a thunderstorm: heavy rain on the canopy, a 650-foot ceiling, lightning that wrecks your night vision, and a deck pitching like it wants you off it. The ball is the only thing out there not lying to you.',
    tips: [
      'Lightning washes the picture out for a second. Keep flying the last ball you saw; do not react to the flash.',
      'The ramp rises and falls four metres. Fly the ball\'s average and let the ship come to you; never dive at the deck.',
      'If the wave-off lights flash: full power, hook stays down, climb straight ahead, and come around again.',
    ],
    wind: { rel: 5, speed: 16, gust: 24, turb: 0.35 }, weight: 'normal', spawn: { dist: 1800, hook: true, flap: 1.0 },
    weather: {
      preset: 'storm', rain: 0.9, darkness: 0.55, ceiling: 200, lightning: 0.6, cells: 3, seaState: 1.2,
      events: [{ type: 'turbBurst', at: { type: 'dist', value: 1300 }, turb: 0.25, dur: 6 }],
    },
    failures: [], scoring: { type: 'carrier' },
    hint: ({ mission, ac }) => {
      const w = mission && mission.weather;
      if (!w || ac.onGround || ac.trap.engaged || ac.trap.trapped) return null;
      return w.t - w.strikeT < 3 ? 'Lightning. Keep flying the last ball you saw; your eyes will come back.' : null;
    },
  },
  {
    id: 'thunder', n: 25, title: 'Thunderstorm', group: 'storms', difficulty: 2, tags: T('weather', 'storm', 'heavy'),
    aircraft: 'condor', site: 'harbor', time: 19.2, vis: 4000,
    desc: 'Dusk, a thunderstorm over the harbor, and a cloud base of 600 ft. You start inside the cloud with nothing outside but grey and lightning, so fly the ILS needles until the approach lights appear. Expect a few big bumps on the way down.',
    tips: [
      'In the cloud, fly the needles: glideslope on the right, localizer at the bottom. Keep both centered and do not go looking for the runway yet.',
      'The bumps will kick the airplane around: let them. Hold the attitude, make small corrections, and do not chase every jolt with the throttle.',
      'Arm the spoilers (K) and set autobrake (L). The runway is wet: touch down in the zone, not long.',
    ],
    wind: { rel: -25, speed: 12, gust: 20, turb: 0.3 }, weight: 'normal', spawn: { dist: 4500, flap: 0.75, fixed: true },
    weather: {
      preset: 'storm', rain: 0.7, darkness: 0.5, ceiling: 185, lightning: 0.5, cells: 3, wet: true,
      events: [
        { type: 'turbBurst', at: { type: 'dist', value: 3600 }, turb: 0.45, dur: 7 },
        { type: 'turbBurst', at: { type: 'alt', value: 350 }, turb: 0.35, dur: 5 },
      ],
    },
    failures: [], scoring: { type: 'runway' },
    hint: ({ mission, ac }) => {
      const w = mission && mission.weather; if (!w || w.state.ceilingY == null) return null;
      return ac.pos.y > w.state.ceilingY ? 'In the cloud: fly the ILS needles, not the window. Glideslope on the right, localizer at the bottom.' : null;
    },
  },
];

// Sites this area adds (same shape as SITES in src/systems/scenarios.js). Merged into SITES by index.js.
export const WEATHER_SITES = {};
