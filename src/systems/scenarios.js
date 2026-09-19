// Sites (airports, carrier, bush strips) and the challenge list.
import { DEG } from '../config.js';
import { ALL_NEW_SITES, NEW_MISSIONS } from '../missions/index.js';
import { buildFreeFlight } from '../missions/free.js';

export const SITES = {
  bayfield: {
    id: 'bayfield', name: 'Bayfield Regional', kind: 'airport',
    terrain: { style: 'plains', seed: 11, size: 26000, res: 330, elevation: 0, trees: 0.35, treeArea: 7000 },
    runways: [{ x: 0, z: 0, heading: 0, length: 2600, width: 45, surface: 'asphalt', elevation: 0, name: '36', nameRecip: '18', papi: true, ils: true, lights: true, buildings: true, aimDistance: 300 }],
  },
  harbor: {
    id: 'harbor', name: 'Harbor City Intl', kind: 'airport',
    terrain: { style: 'coast', seed: 23, size: 26000, res: 330, elevation: 0, waterLevel: 0, coastX: 1400, trees: 0.25, treeArea: 7000 },
    runways: [{ x: 0, z: 0, heading: 0, length: 3200, width: 45, surface: 'asphalt', elevation: 8, name: '36', nameRecip: '18', papi: true, ils: true, lights: true, buildings: true, aimDistance: 400 }],
  },
  ridgefield: {
    id: 'ridgefield', name: 'Ridgefield Municipal', kind: 'airport',
    terrain: { style: 'plains', seed: 37, size: 22000, res: 300, elevation: 120, trees: 0.5, treeArea: 6000 },
    runways: [{ x: 0, z: 0, heading: 0, length: 1600, width: 30, surface: 'asphalt', elevation: 120, name: '36', nameRecip: '18', papi: true, ils: false, lights: true, buildings: true, approachLights: false, aimDistance: 250 }],
  },
  carrier: {
    id: 'carrier', name: 'CVN-68 at sea', kind: 'carrier',
    terrain: { style: 'sea', seed: 5, size: 30000, res: 40, waterLevel: 0, trees: 0 },
    carrier: { heading: 0, speedKt: 25, seaState: 0.25 },
  },
  gravelbar: {
    id: 'gravelbar', name: 'Moose Creek Bar', kind: 'bush',
    terrain: { style: 'mountain', seed: 61, size: 14000, res: 400, elevation: 520, waterLevel: 516, valleyWidth: 1400, trees: 0.9, treeArea: 4500, snowLine: 1900 },
    runways: [{ x: 0, z: 0, heading: 0, length: 340, width: 14, surface: 'gravel', elevation: 520, name: '36', nameRecip: '18', papi: false, ils: false, lights: false, windsock: true, markers: true, aimDistance: 50, flatWidth: 60, flatMargin: 120 }],
    // The wall: two staggered rows of ~24 m spruce right across short final, 150-170 m before the bar. There is
    // no way around it at this wingspan; you clear it and drop in. Scattered trees further out keep the valley honest.
    obstacleTrees: [
      ...treeWall(150, -52, 52, 6.5, 0.95, 4), ...treeWall(170, -66, 66, 8, 0.85, 5),
      { x: -34, z: 260, scale: 1.1 }, { x: 45, z: 320, scale: 1.2 }, { x: 22, z: 420, scale: 1.0 }, { x: -48, z: 470, scale: 1.1 }, { x: -25, z: -420, scale: 1.2 }, { x: 40, z: -380, scale: 1.1 },
    ],
  },
  oneway: {
    id: 'oneway', name: 'Eagle Ridge Strip', kind: 'bush',
    terrain: { style: 'mountain', seed: 83, size: 14000, res: 400, elevation: 900, valleyWidth: 1100, trees: 0.8, treeArea: 4500, snowLine: 2300 },
    runways: [{ x: 0, z: 0, heading: 0, length: 420, width: 16, surface: 'dirt', elevation: 900, slope: 0.09, name: '36', nameRecip: '18', papi: false, ils: false, lights: false, windsock: true, markers: true, aimDistance: 40, flatWidth: 70, flatMargin: 140, gsAngle: 4.5 }],
    obstacleTrees: [{ x: -30, z: 220, scale: 1.3 }, { x: 36, z: 300, scale: 1.2 }, { x: -50, z: 380, scale: 1.4 }],
  },
};

// Build terrain "flats" from runways so the ground is level around them
export function siteFlats(site) {
  return (site.runways || []).map((r) => {
    const cx = r.x + Math.sin(r.heading * DEG) * (r.length / 2), cz = r.z - Math.cos(r.heading * DEG) * (r.length / 2);
    const bush = site.kind === 'bush';
    return {
      x: cx, z: cz, heading: r.heading, halfLength: r.length / 2 + (bush ? 60 : 300), halfWidth: r.flatWidth || (bush ? 60 : 420),
      elevation: r.elevation + (r.slope || 0) * (r.length / 2), slope: r.slope || 0, margin: r.flatMargin || (bush ? 120 : 600), treeMargin: bush ? 25 : 200,
    };
  });
}

const T = (...tags) => tags;

// A row of obstacle trees across the approach path (x = across, z = along; the threshold is at z = 0
// and the approach comes from +z). Small alternating offsets so it reads as a treeline, not a fence.
function treeWall(z, from, to, step, scale, zJitter = 0) {
  const out = [];
  for (let x = from, k = 0; x <= to; x += step, k++) out.push({ x: x + (k % 2 ? 1.5 : -1.5), z: z + ((k % 3) - 1) * zJitter, scale: scale + 0.08 * Math.sin(k * 1.9) });
  return out;
}


export const SCENARIOS = [
  {
    id: 'solo', n: 1, title: 'First Solo', tags: T('tutorial'), aircraft: 'skylark', site: 'bayfield', time: 10, vis: 40000,
    desc: 'Calm morning, long runway, the trainer. Fly a 3-degree glidepath at 62 kt, flare at a few feet, and hold it off until the wheels kiss.',
    tips: ['Put the green flight-path circle on the runway numbers and keep it there.', 'Pitch for speed, throttle for the descent rate. Keep the PAPI two white / two red.', 'At 5 ft, throttle to idle and raise the nose slowly. Do not push it on.'],
    wind: { rel: 0, speed: 3 }, weight: 'normal', spawn: { dist: 900, flap: 0.667 }, failures: [], scoring: { type: 'runway' }, hints: true,
  },
  {
    id: 'xwind15', n: 2, title: 'Crosswind 15', tags: T('crosswind'), aircraft: 'skylark', site: 'bayfield', time: 15, vis: 30000,
    desc: '15 knots from 70 degrees off the nose. Crab into it on final, then in the flare kick the nose straight with rudder and drop the upwind wing.',
    tips: ['The runway will drift sideways if you fly with wings level and no crab.', 'Touch down on the upwind main wheel first with the nose pointing down the runway.', 'Side-load on the tires is scored: no crab at touchdown.'],
    wind: { rel: 70, speed: 15, gust: 18, turb: 0.15 }, weight: 'normal', spawn: { dist: 900, flap: 0.667 }, failures: [], scoring: { type: 'runway' },
  },
  {
    id: 'gusty', n: 3, title: 'Gusty', tags: T('crosswind', 'heavy'), aircraft: 'condor', site: 'harbor', time: 16.5, vis: 25000,
    desc: 'Coastal wind 22 gusting 32, 50 degrees off the runway, mechanical turbulence off the harbor. Add half the gust to your Vref and stay ahead of the airplane.',
    tips: ['Fly Vref + 5 (about 147 kt). Wind shear near the ground will steal airspeed on short final.', 'Small, early corrections. Big late ones roll you into the ground.', 'De-crab in the flare with rudder; keep wings nearly level in a big jet (engine pods are low).'],
    wind: { rel: -50, speed: 22, gust: 32, turb: 0.45, shear: 0.4 }, weight: 'normal', spawn: { dist: 2000, flap: 0.75 }, failures: [], scoring: { type: 'runway' },
  },
  {
    id: 'heavy', n: 4, title: 'Heavy Metal', tags: T('heavy'), aircraft: 'condor', site: 'harbor', time: 13, vis: 40000,
    desc: 'The airliner at maximum landing weight. Vref 148 kt, the engines take four seconds to spool, and 66 tonnes does not want to stop. Arm the spoilers and the autobrake.',
    tips: ['Press K to arm the spoilers, L for autobrake. Flaps 30 (press F four times), gear down early.', 'Flare at 30 ft radio altitude: 2-3 degrees of pitch, thrust to idle at the "retard" call.', 'Hold R for reverse thrust after touchdown until 60 kt. Do not exceed 10 degrees pitch on the runway.'],
    wind: { rel: 20, speed: 8 }, weight: 'heavy', spawn: { dist: 2000, flap: 0.75 }, failures: [], scoring: { type: 'runway' },
  },
  {
    id: 'short', n: 5, title: 'Short & Heavy', tags: T('heavy'), aircraft: 'condor', site: 'ridgefield', time: 11, vis: 30000,
    desc: 'A 1,600 m regional runway that was never meant for you. Touch down in the first 300 m, on speed, and use everything: spoilers, max autobrake, full reverse.',
    tips: ['Fly Vref exactly, not a knot more. Every knot of extra speed is 40 m of runway.', 'No float. Idle at 20 ft, touch down firmly at the aiming bars.', 'Full reverse (hold R) immediately, brakes to the stops.'],
    wind: { rel: 0, speed: 6 }, weight: 'normal', spawn: { dist: 1800, flap: 1.0 }, failures: [], scoring: { type: 'runway' },
  },
  {
    id: 'deadstick', n: 6, title: 'Dead Stick', tags: T('failure'), aircraft: 'skylark', site: 'bayfield', time: 17.5, vis: 30000,
    desc: 'The engine quits at 2,600 ft, four miles out. Best glide is 68 kt and you have one shot. Flaps only when the runway is made.',
    tips: ['Pitch for 68 kt immediately. Trim it (T/Y keys).', 'Aim for the first third of the runway, not the numbers. Add flaps when you are sure you will make it.', 'Slip (rudder one way, aileron the other) if you are too high. Never stretch a glide.'],
    wind: { rel: 0, speed: 4 }, weight: 'normal', spawn: { dist: 5000, alt: 620, flap: 0, speedKt: 75, fixed: true }, failures: [{ name: 'engine', at: { type: 'time', value: 4 } }], scoring: { type: 'runway' },
  },
  {
    id: 'noflaps', n: 7, title: 'No Flaps', tags: T('failure', 'heavy'), aircraft: 'condor', site: 'harbor', time: 9, vis: 30000,
    desc: 'Flap drive failure at flaps up. Vref jumps to 190 kt, the approach is flat and fast, and the airplane will float forever if you flare it like a normal landing.',
    tips: ['Fly 190 kt. Nose attitude will be higher than usual.', 'A very small flare. Let it touch down, then get the spoilers and reverse out immediately.', 'Watch the tail-strike pitch: 10 degrees.'],
    wind: { rel: 10, speed: 8 }, weight: 'normal', spawn: { dist: 2400, flap: 0, speedKt: 192 }, failures: [{ name: 'flapsStuck', at: { type: 'start' } }], scoring: { type: 'runway', vref: 190 },
  },
  {
    id: 'nosegear', n: 8, title: 'Nose Gear', tags: T('failure'), aircraft: 'condor', site: 'harbor', time: 14, vis: 30000,
    desc: 'The nose gear will not extend. Land on the mains, hold the nose off as long as the elevator lets you, then let it settle onto the nose as slowly as possible.',
    tips: ['Normal approach, normal flare, mains on first.', 'Keep pulling: the nose stays up until about 90 kt. Then it drops. Brakes only after the nose is down.', 'Do not use reverse thrust hard: it kills the elevator authority.'],
    wind: { rel: 0, speed: 5 }, weight: 'normal', spawn: { dist: 2000, flap: 0.75 }, failures: [{ name: 'noseGear', at: { type: 'start' }, arg: 0 }], scoring: { type: 'runway', noseGear: true },
  },
  {
    id: 'oneengine', n: 9, title: 'One Engine', tags: T('failure', 'heavy'), aircraft: 'condor', site: 'harbor', time: 12, vis: 30000,
    desc: 'At 800 ft the left engine fails. Asymmetric thrust yaws the nose left every time you add power. Rudder into the good engine and fly it down.',
    tips: ['When you add power, step on the right rudder. When you reduce power, take it out.', 'Use trim. Keep the ball (bottom of the attitude display) centered.', 'Go-around is possible but slow: full right rudder with full power.'],
    wind: { rel: 30, speed: 10 }, weight: 'normal', spawn: { dist: 2000, flap: 0.75 }, failures: [{ name: 'engineLeft', at: { type: 'time', value: 4 } }], scoring: { type: 'runway' },
  },
  {
    id: 'jammed', n: 10, title: 'Jammed Elevator', tags: T('failure'), aircraft: 'skylark', site: 'bayfield', time: 15, vis: 30000,
    desc: 'The elevator is jammed. Your only pitch controls are the trim wheel (slow) and the throttle (power up = nose up). Plan ahead; nothing happens quickly.',
    tips: ['Trim with T (nose up) and Y (nose down). It moves slowly: make small changes and wait.', 'Power controls the descent rate now. Slightly high and slightly fast is fine.', 'Flare with a burst of power at 10 ft, then cut it.'],
    wind: { rel: 0, speed: 4 }, weight: 'normal', spawn: { dist: 1500, flap: 0.333 }, failures: [{ name: 'elevatorJam', at: { type: 'start' } }], scoring: { type: 'runway' },
  },
  {
    id: 'ice', n: 11, title: 'Ice', tags: T('failure', 'stall'), aircraft: 'skylark', site: 'ridgefield', time: 8, vis: 12000,
    desc: 'You picked up wing ice in the clouds. Stall speed is up 10 knots, the stall comes without much warning, and the airplane is heavy and draggy. Fly a fast approach and a shallow flare.',
    tips: ['Approach at 80 kt, not 65. Use only 20 degrees of flap.', 'The stall warning margin is smaller with ice. Do not get slow in the flare.', 'Expect a wing to drop if it stalls. Recover with nose down and power.'],
    wind: { rel: 20, speed: 10, turb: 0.2 }, weight: 'heavy', spawn: { dist: 1000, flap: 0.667, speedKt: 80 }, failures: [{ name: 'ice', at: { type: 'start' } }], scoring: { type: 'runway', vref: 78 },
  },
  {
    id: 'brakes', n: 12, title: 'Brake Failure', tags: T('failure', 'heavy'), aircraft: 'condor', site: 'harbor', time: 18.5, vis: 30000,
    desc: 'Total brake failure. Spoilers and reverse thrust are all you have. Touch down on speed at the very start of the runway and keep the reversers in until it stops.',
    tips: ['Touch down early; a 3,200 m runway is barely enough without brakes.', 'Full reverse the moment the mains are on. Keep it in below 60 kt (your ears will hate it).', 'Steer with rudder pedals: nose-wheel steering still works.'],
    wind: { rel: 0, speed: 8 }, weight: 'normal', spawn: { dist: 2000, flap: 1.0 }, failures: [{ name: 'brakes', at: { type: 'start' } }], scoring: { type: 'runway' },
  },
  {
    id: 'fog', n: 13, title: 'Fog', tags: T('weather', 'heavy'), aircraft: 'condor', site: 'harbor', time: 7, vis: 700,
    desc: 'Visibility 700 metres. You will not see the runway until 200 ft. Fly the ILS needles (right side of the HUD) and trust them until the lights appear.',
    tips: ['Keep both needles centered: glideslope on the right, localizer at the bottom.', 'At 200 ft the approach lights appear. Do not chase them; keep the crab.', 'Flare on the radio altimeter callouts: 30, 20, 10.'],
    wind: { rel: -20, speed: 6 }, weight: 'normal', spawn: { dist: 2400, flap: 0.75 }, failures: [], scoring: { type: 'runway' },
  },
  {
    id: 'slow', n: 14, title: 'Slow Flight', tags: T('stall'), aircraft: 'skylark', site: 'bayfield', time: 16, vis: 30000,
    desc: 'You start at 5 knots above the stall with the horn already chirping, two miles out. Keep it flying: nose down a touch, power up, and land normally.',
    tips: ['The stall horn is your friend. If it sounds, lower the nose and add power.', 'Airspeed comes from pitch. Altitude comes from power. Especially here.', 'Do not raise flaps: you will sink.'],
    wind: { rel: 0, speed: 3 }, weight: 'normal', spawn: { dist: 1400, flap: 1.0, speedKt: 47, alt: 140, fixed: true }, failures: [], scoring: { type: 'runway' },
  },
  {
    id: 'stallrec', n: 15, title: 'Stall Recovery', tags: T('stall'), aircraft: 'skylark', site: 'bayfield', time: 14, vis: 30000,
    desc: 'You take over at 850 ft on final: power off, nose rising, the stall horn going, and the previous pilot still holding the yoke back. The wing breaks and stays broken until you act. Push the nose down and add power, level the wings, then fly the approach and land.',
    tips: ['Push the nose down first, then full power. Either one hands you the airplane.', 'Once the airspeed is back, ease the nose up to the horizon and level the wings. Pull too hard and it stalls again (a secondary stall).', 'A quick recovery costs 150 to 250 ft of your 850. Touching down at the stall is a good landing, not a fault.'],
    wind: { rel: 0, speed: 5 }, weight: 'normal', spawn: { dist: 2400, flap: 0.333, alt: 260, speedKt: 56, stall: true, fixed: true }, failures: [], scoring: { type: 'runway', stallStart: true },
  },
  {
    id: 'cq', n: 16, title: 'Carrier Qual', tags: T('carrier'), aircraft: 'hornet', site: 'carrier', time: 14, vis: 30000, seaState: 0.2,
    desc: 'Day, calm sea, 25 knots of wind over the deck. Hook down, flaps full, fly the ball at 8.1 degrees AoA down a 3.5 degree glideslope and catch the 3-wire. No flare.',
    tips: ['Press H for the hook, G for gear, F twice for full flaps. Set 8 degrees on the AoA gauge (the green mark).', 'Fly the ball (bottom center of the HUD): amber ball level with the green datum = on glideslope. Below = low. Red = dangerously low.', 'Full throttle the instant you touch down. If the hook misses, that is a bolter and you go around.'],
    wind: { rel: 0, speed: 8 }, weight: 'normal', spawn: { dist: 1700, hook: true, flap: 1.0 }, failures: [], scoring: { type: 'carrier' },
  },
  {
    id: 'night', n: 17, title: 'Night Trap', tags: T('carrier', 'weather'), aircraft: 'hornet', site: 'carrier', time: 22.5, vis: 15000, seaState: 0.8,
    desc: 'Pitch-black night, pitching deck, a moving ball. The hardest thing in aviation. Fly the ball, keep the lineup on the drop lights, do not spot the deck.',
    tips: ['The deck moves up and down 3 metres. Fly the ball average, not every bounce.', 'Lineup: the centerline lights and the vertical drop line below the ramp form a straight line when you are lined up.', 'If the wave-off lights flash: full power, hook stays down, go around.'],
    wind: { rel: 5, speed: 12, turb: 0.25 }, weight: 'normal', spawn: { dist: 1800, hook: true, flap: 1.0 }, failures: [], scoring: { type: 'carrier' },
  },
  {
    id: 'gravel', n: 18, title: 'Bush: Gravel Bar', tags: T('bush'), aircraft: 'trailblazer', site: 'gravelbar', time: 9.5, vis: 30000,
    desc: 'A 340 m gravel bar in a river valley, and a wall of spruce right across short final, 150 m before the bar. Come in high, clear the trees, then get it down and stopped in what is left.',
    tips: ['Full flap (F twice), 48 kt, and stay HIGH: the tree line is 24 m tall and there is no gap. Cross it with a few metres to spare.', 'Over the trees, power to idle and push the nose down. You want the wheels on the gravel in the first third of the bar.', 'Brake gently: heavy braking on a taildragger flips it onto its nose. Keep it straight with rudder.'],
    wind: { rel: 40, speed: 7, turb: 0.3 }, weight: 'normal', spawn: { dist: 900, flap: 1.0, alt: 115, fixed: true }, failures: [], scoring: { type: 'bush' },
  },
  {
    id: 'oneway', n: 19, title: 'Bush: One-Way Strip', tags: T('bush'), aircraft: 'trailblazer', site: 'oneway', time: 17, vis: 30000,
    desc: 'A dirt strip on a mountainside, sloping 9% uphill, in a box canyon. No go-around: the canyon wall is behind the far end. Uphill landings need power in the flare.',
    tips: ['Fly a steeper approach than usual (the strip slopes up, so it looks flatter than it is).', 'In the flare keep some power on: the uphill slope decelerates you fast.', 'Once you commit below 200 ft, you land. There is no going around.'],
    wind: { rel: 10, speed: 5, turb: 0.35 }, weight: 'normal', spawn: { dist: 900, flap: 1.0, alt: 110, fixed: true }, failures: [], scoring: { type: 'bush' },
  },
  {
    id: 'roulette', n: 20, title: 'Roulette', tags: T('failure', 'random'), aircraft: 'random', site: 'random', time: 'random', vis: 'random',
    desc: 'Random aircraft, random airport, random wind, random weather, and something will break on the way down. You will not be told what.',
    tips: ['Watch the instruments: engine gauges, config, airspeed.', 'When something breaks: fly the airplane first.'], wind: 'random', weight: 'random', spawn: { dist: 1500 }, failures: 'random', surprise: true, scoring: { type: 'runway' },
  },
];

// The missions expansion (2026-09-17): new maps and missions live in src/missions/ (see its README.md) and are
// appended here, so the twenty above and every id and order that depends on them stay exactly as they were.
Object.assign(SITES, ALL_NEW_SITES);
SCENARIOS.push(...NEW_MISSIONS);

const RANDOM_FAILS = ['engine', 'engineLeft', 'flapsStuck', 'noseGear', 'elevatorJam', 'brakes', 'hydraulics', 'ice'];

export const APPROACH_LENGTH = { short: 1, medium: 1.8, long: 3 };

export function resolveScenario(sc, rng = Math.random, settings = null) {
  const pick = (a) => a[Math.floor(rng() * a.length)];
  // Nested objects are copied: the gust line below used to write into the SCENARIOS entry itself, so the
  // second flight of a challenge inherited the first flight's gust (and its briefing showed it).
  const s = { ...sc, spawn: { ...sc.spawn }, scoring: { ...sc.scoring } };
  if (sc.wind && typeof sc.wind === 'object') s.wind = { ...sc.wind };
  if (sc.weather && typeof sc.weather === 'object') s.weather = { ...sc.weather, events: (sc.weather.events || []).map((e) => ({ ...e })) };
  const mult = APPROACH_LENGTH[settings?.approach] || 1;
  if (!s.spawn.fixed && s.spawn.dist) s.spawn.dist = Math.round(s.spawn.dist * mult);
  if (s.aircraft === 'random') s.aircraft = pick(['skylark', 'condor', 'skylark', 'trailblazer']);
  if (s.site === 'random') s.site = s.aircraft === 'trailblazer' ? pick(['gravelbar', 'ridgefield']) : pick(['bayfield', 'harbor', 'ridgefield']);
  if (s.time === 'random') s.time = 6 + rng() * 16;
  if (s.vis === 'random') s.vis = rng() < 0.25 ? 1500 + rng() * 3000 : 20000 + rng() * 20000;
  if (s.wind === 'random') s.wind = { rel: (rng() - 0.5) * 160, speed: 3 + rng() * 18, gust: 0, turb: rng() * 0.5 };
  if (s.wind.gust === 0 || s.wind.gust == null) s.wind.gust = s.wind.speed + rng() * 8;
  if (s.weight === 'random') s.weight = pick(['light', 'normal', 'heavy']);
  if (s.failures === 'random') {
    let f = pick(RANDOM_FAILS);
    if (s.aircraft !== 'condor' && (f === 'engineLeft' || f === 'hydraulics' || f === 'noseGear')) f = 'engine';
    if (s.aircraft === 'condor' && f === 'engine') f = 'engineLeft';
    if (f === 'engine') {
      // a total engine failure is only survivable from altitude: set up a dead-stick glide
      s.spawn = { ...s.spawn, dist: 6500, alt: 780, flap: 0, speedKt: s.aircraft === 'trailblazer' ? 60 : 75 };
      s.failures = [{ name: f, at: { type: 'time', value: 3 + rng() * 6 }, arg: 0 }];
    } else s.failures = [{ name: f, at: { type: 'alt', value: 400 + rng() * 800 }, arg: 0 }];
  }
  if (s.site === 'gravelbar' || s.site === 'oneway') { s.scoring.type = 'bush'; s.spawn.dist = 900; s.spawn.alt = 100; s.spawn.flap = 1; s.spawn.fixed = true; }
  if (s.aircraft === 'condor' && s.spawn.flap == null) s.spawn.flap = 0.75;
  if (s.spawn.flap == null) s.spawn.flap = s.aircraft === 'skylark' ? 0.667 : 1;
  return s;
}

// Free flight: options -> scenario lives in src/missions/free.js (weather, trouble, obstacles, a seeded surprise).
// `seed` only picks the "Surprise me" failure; main.js passes the flight's seed. The missions let a pair a mission flies
// (the Condor at Ridgefield) through the builder's runway check.
export function makeFreeFlight(o, seed = 1) {
  return buildFreeFlight(o, { sites: SITES, seed, missions: SCENARIOS });
}
