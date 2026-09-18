// New missions: failures that make the airplane hard to fly (group 'breaks', n 26-35). Each entry follows
// src/missions/README.md; ids are permanent (they key the pilot's bests and a public leaderboard board).
//
// The failures themselves are src/systems/malfunctions.js (catalogue, triggers) and src/systems/failureEffects.js
// (what they do, from outside the flight model). A mission's `hint(ctx)` reads that runtime through
// ctx.mission.failRt; everything here is plain data otherwise. Every mission is flown to a landing by a scripted
// pilot using the technique its tips describe: tools/test-failures.mjs.
// eslint-disable-next-line no-unused-vars
import { treeWall, rwToWorld } from './util.js';

const T = (...tags) => tags;
const rt = (ctx) => (ctx && ctx.mission && ctx.mission.failRt) || null;
const fx = (ctx, name) => { const r = rt(ctx); return r ? r.get(name) : null; };

export const FAILURES_MISSIONS = [
  {
    id: 'stuck-throttle', n: 26, group: 'breaks', difficulty: 3, title: 'Stuck Throttle', tags: T('failure', 'heavy'),
    aircraft: 'condor', site: 'harbor', time: 15.5, vis: 30000,
    desc: 'Levelling off at 1,300 ft the throttles jam at 75%, which is most of climb power, and stay there. The airliner does not want to come down and nothing on the pedestal will take the power off. Hang out every bit of drag it has, fly it down fast, and cut the fuel over the runway.',
    tips: [
      'Flaps 40 (press F once more), gear down, and the speedbrake out: press K twice. That is all the drag there is.',
      'Fly the glideslope with pitch and accept about 165 kt. The speed will not come back until the engines stop.',
      'At 30 ft cut the fuel (press U) and flare: the engines are gone in two seconds. No reverse after that, so brake hard (Space).',
    ],
    wind: { rel: 0, speed: 10, turb: 0.1 }, weight: 'normal',
    spawn: { dist: 7000, alt: 400, flap: 0.75, speedKt: 160, fixed: true },
    failures: [{ name: 'stuckThrottle', at: { type: 'time', value: 4 }, arg: 0.75 }],
    scoring: { type: 'runway' },
    hint: (ctx) => {
      const f = fx(ctx, 'stuckThrottle');
      if (!f || ctx.ac.onGround) return f && f.cut && ctx.ac.onGround ? 'Brakes: hold Space. No reverse with the engines off.' : null;
      if (f.cut) return 'Engines off. Flare gently and let it settle.';
      if (ctx.ra < 80) return 'Cut the fuel at 30 ft: press U.';
      if (ctx.ac.ctl.flap < 0.95) return 'Flaps 40: press F. Then the speedbrake: K twice.';
      if (ctx.ac.ctl.spoiler < 0.5) return 'Speedbrake out: press K (twice if it only arms).';
      return 'Fly the glideslope with pitch. Fast is fine; high is not.';
    },
  },
  {
    id: 'runaway-trim', n: 27, group: 'breaks', difficulty: 3, title: 'Runaway Trim', tags: T('failure', 'heavy'),
    aircraft: 'condor', site: 'bayfield', time: 11, vis: 25000,
    desc: 'At about 1,000 ft on the ILS the stabilizer trim starts running nose down by itself, with a clatter you will learn to hate. The elevator can hold it for about five seconds. Cut it out, hold the nose up, and wind it back by hand.',
    tips: [
      'Trim cutout the moment you hear the clacker: press D. Every second you wait is more nose-down trim to fight.',
      'Then hold the nose up with the stick and wind the trim back with T. It is a manual wheel now, and slow.',
      'The ILS still works. Once the nose sits right again it is an ordinary landing: flaps 30, Vref 142, spoilers armed (K).',
    ],
    wind: { rel: -15, speed: 8 }, weight: 'normal',
    spawn: { dist: 6200, flap: 0.75, fixed: true },
    failures: [{ name: 'runawayTrim', at: { type: 'time', value: 6 }, arg: -0.12 }],
    scoring: { type: 'runway' },
    hint: (ctx) => {
      const f = fx(ctx, 'runawayTrim');
      if (!f || ctx.ac.onGround) return null;
      if (!f.cut) return 'Trim runaway: press D for the cutout. Now.';
      if (f.bias < -0.12) return 'Hold the nose up and wind the trim back: hold T.';
      return null;
    },
  },
  {
    id: 'bird-strike', n: 28, group: 'breaks', difficulty: 3, title: 'Bird Strike', tags: T('failure', 'heavy'),
    aircraft: 'condor', site: 'harbor', time: 17.5, vis: 30000,
    desc: 'Geese over the harbour at 800 ft. One comes through the windshield (it holds, just) and one goes down the right engine, which keeps running, badly: it surges and bangs every few seconds and gives you about 60% when it feels like it.',
    tips: [
      'Fly the airplane first: wings level, nose on the glideslope. The windshield is cracked, not gone, and the HUD still works.',
      'Each surge yaws you toward the right engine: left rudder (Q). Or shut it down with the fire handle (press A) and fly one engine.',
      'On one engine: rudder toward the good engine whenever you add power. Flaps 30, Vref 142, and 3,200 m of runway.',
    ],
    wind: { rel: 20, speed: 9, turb: 0.15 }, weight: 'normal',
    spawn: { dist: 5200, flap: 0.75, fixed: true },
    failures: [{ name: 'birdStrike', at: { type: 'alt', value: 800 }, engine: 'right', arg: 0.6, surge: 0.6 }],
    scoring: { type: 'runway' },
    hint: (ctx) => {
      const f = fx(ctx, 'birdStrike');
      if (!f || ctx.ac.onGround) return null;
      if (!f.surge.shut && !ctx.ac.engines[f.surge.i].failed) return 'Surging right engine: left rudder (Q) through the surges, or shut it down: press A.';
      return 'One engine: rudder toward the good engine with power. Vref 142.';
    },
  },
  {
    id: 'unreliable-ias', n: 29, group: 'breaks', difficulty: 4, title: 'Unreliable Airspeed', tags: T('failure', 'heavy'),
    aircraft: 'condor', site: 'bayfield', time: 8, vis: 9000,
    desc: 'Somewhere on this approach the pitot tube ices over and the airspeed starts to read low, a little at a time, and by the time IAS DISAGREE comes up it has been lying for a while. Believe it and you will push the nose down, add power, and arrive very fast and very late. Fly the numbers you know instead.',
    tips: [
      'Pitch and power: 1.5° nose up with the throttle at 24% holds Vref (142) at flaps 30 with the gear down. Fly that.',
      'Ground speed (top left, under the G) plus the headwind is your airspeed. The stall warning and the AoA still tell the truth.',
      'When the airspeed and the ground speed stop agreeing, the airspeed is the one lying.',
    ],
    wind: { rel: 0, speed: 12, turb: 0.15 }, weight: 'normal',
    spawn: { dist: 7200, flap: 0.75, fixed: true },
    failures: [{ name: 'pitotIce', at: { type: 'window', from: 6, to: 16 }, arg: 0.6, tau: 22 }],
    scoring: { type: 'runway' },
    hint: (ctx) => {
      const f = fx(ctx, 'pitotIce');
      if (ctx.ac.onGround) return null;
      if (!f) return 'Note the numbers while the airspeed is honest: 142 kt, about 1.5° nose up, throttle near 24%.';
      if (ctx.ra < 60) return 'Flare as usual: the stall warning still tells the truth.';
      return 'Pitch and power: 1.5° nose up, throttle near 24%. Ground speed plus the headwind is your airspeed.';
    },
  },
  {
    id: 'belly-landing', n: 30, group: 'breaks', difficulty: 3, title: 'Belly Landing', tags: T('failure', 'heavy'),
    aircraft: 'condor', site: 'harbor', time: 13.5, vis: 30000,
    desc: 'The gear will not come down, the alternate extension did nothing, and nobody has foamed the runway. Put the airliner on its belly on runway 36: slow, level, and with the engines already off.',
    tips: [
      'Flaps 40 (press F once more) and fly Vref 142. The gear horn will complain all the way down; let it.',
      'Cut the fuel at about 50 ft (press U). Belly landings catch fire when the engines are still turning.',
      'Flare to a gentle touchdown, wings level: the engine pods touch first. Keep it straight with rudder (Q/E) until it stops.',
    ],
    wind: { rel: 0, speed: 7 }, weight: 'normal',
    spawn: { dist: 5000, flap: 0.75, gear: false, fixed: true },
    failures: [{ name: 'gearUp', at: { type: 'start' } }],
    scoring: { type: 'runway', belly: true },
    hint: (ctx) => {
      const f = fx(ctx, 'gearUp');
      if (!f) return null;
      if (ctx.ac.onGround) return 'Keep it straight with rudder (Q/E). It stops by itself.';
      if (ctx.ac.ctl.flap < 0.95) return 'Flaps 40: press F. Gear stays up.';
      if (!f.cut && ctx.ra < 120) return 'Cut the fuel at 50 ft: press U.';
      if (f.cut) return 'Engines off. Wings level, flare gently onto the belly.';
      return 'Belly landing: Vref 142, glideslope, wings level. Ignore the gear horn.';
    },
  },
  {
    id: 'engine-fire', n: 31, group: 'breaks', difficulty: 3, title: 'Engine Fire', tags: T('failure', 'heavy'),
    aircraft: 'condor', site: 'bayfield', time: 19, vis: 30000,
    desc: 'The fire bell goes at 1,100 ft: left engine fire. You have about thirty seconds before the wing stops being a wing. Pull the handle, then fly the rest of it on one engine.',
    tips: [
      'Pull the fire handle: press A. The engine stops, the bell stops, and the fire goes out.',
      'Then it is the One Engine landing: right rudder (E) whenever you add power, and keep the ball centred.',
      'Vref 142 with flaps 30, and do not get slow. 2,600 m of runway and one reverser (hold R) is plenty.',
    ],
    wind: { rel: 10, speed: 8 }, weight: 'normal',
    spawn: { dist: 6600, flap: 0.75, fixed: true },
    failures: [{ name: 'engineFire', at: { type: 'time', value: 5 }, engine: 'left', burn: 32 }],
    scoring: { type: 'runway' },
    hint: (ctx) => {
      const f = fx(ctx, 'engineFire');
      if (!f || ctx.ac.onGround) return null;
      if (!f.out) return 'ENGINE FIRE: pull the fire handle, press A.';
      return 'One engine: right rudder (E) with power, ball centred. Vref 142.';
    },
  },
  {
    id: 'jammed-aileron', n: 32, group: 'breaks', difficulty: 4, title: 'Jammed Aileron', tags: T('failure'),
    aircraft: 'skylark', site: 'ridgefield', time: 10.5, vis: 30000,
    desc: 'The aileron cable has jammed with a little right roll in it, and the stick does nothing sideways. Roll with the rudder: yaw the nose and the wing follows a second later. 1,600 m of runway and a light breeze from the right.',
    tips: [
      'Steer with rudder (Q/E). Small, early pedal: the bank arrives about a second after the yaw.',
      'The jam leans you right all the time, so expect to hold a little left pedal all the way down.',
      'Flare as usual. On the ground the rudder steers the nosewheel as it always does.',
    ],
    wind: { rel: 30, speed: 6, turb: 0.1 }, weight: 'normal',
    spawn: { dist: 2600, flap: 0.667, fixed: true },
    failures: [{ name: 'aileronJam', at: { type: 'time', value: 1.5 }, arg: 0.06 }],
    scoring: { type: 'runway' },
    hint: (ctx) => (ctx.ac.onGround ? null : 'Roll with rudder (Q/E): yaw first, the bank follows. A little left pedal holds the jam.'),
  },
  {
    id: 'dark-cockpit', n: 33, group: 'breaks', difficulty: 3, title: 'Dark Cockpit', tags: T('failure', 'night'),
    aircraft: 'skylark', site: 'bayfield', time: 21.5, vis: 25000,
    desc: 'Night, two miles out, and the alternator dies with the battery right behind it. The HUD goes, the panel lights go, the landing light goes. What is left: a torch on the airspeed and the altimeter, and the runway lights.',
    tips: [
      'The torch lights the standby airspeed and altimeter at the bottom: 62 kt, and Bayfield is at sea level, so the altimeter is your height.',
      'Fly the PAPI: two white, two red. The approach and edge lights draw the runway for you.',
      'No landing light: start the flare when the edge lights spread wide either side of the nose, then hold it off.',
    ],
    wind: { rel: -20, speed: 5 }, weight: 'normal',
    spawn: { dist: 3800, flap: 0.667, fixed: true },
    failures: [{ name: 'electrical', at: { type: 'time', value: 6 } }],
    scoring: { type: 'runway' },
    hint: (ctx) => {
      if (!fx(ctx, 'electrical')) return null;   // until the lights go, the usual help
      if (ctx.ac.onGround) return 'Brakes: hold Space. Keep the centerline with rudder (Q/E).';
      if (ctx.ra > 100) return 'No HUD: 62 kt on the standby airspeed, the PAPI two white and two red.';
      if (ctx.ra > 15) return 'Short final: 62 kt, wings level on the approach lights, aim at the first edge lights.';
      return 'Flare as the edge lights spread wide: throttle idle, nose up slowly, hold it off.';
    },
  },
  {
    id: 'one-wheel', n: 34, group: 'breaks', difficulty: 4, title: 'One Wheel', tags: T('failure'),
    aircraft: 'skylark', site: 'bayfield', time: 12, vis: 30000,
    desc: 'The tower watched your left main wheel roll off into the grass as you left, and what is left is a stub. Land on the right wheel, hold the left wing up for as long as it flies, and keep it on the runway when the stub touches.',
    tips: [
      'Touch down on the right wheel first: a little right bank, left rudder to keep the nose straight.',
      'After touchdown keep turning the stick right as it slows: the longer the left wing stays up, the better. The debrief says how slow.',
      'When the stub drops it digs in and swings you left: right rudder (E), and plenty of it.',
    ],
    wind: { rel: 40, speed: 7, turb: 0.1 }, weight: 'normal',
    spawn: { dist: 1600, flap: 0.667, fixed: true },
    failures: [{ name: 'oneMainStuck', at: { type: 'start' }, leg: 'left' }],
    scoring: { type: 'runway' },
    hint: (ctx) => {
      if (!ctx.ac.onGround) return ctx.ra < 40 ? 'Right wheel first: a little right bank, left rudder to keep straight.' : 'Normal approach, 62 kt. Plan to touch down on the right wheel.';
      return 'Stick right to hold the left wing up; right rudder (E) when the stub digs in.';
    },
  },
  {
    id: 'no-ball', n: 35, group: 'breaks', difficulty: 5, title: 'No Ball', tags: T('failure', 'carrier'),
    aircraft: 'hornet', site: 'carrier', time: 16, vis: 30000, seaState: 0.3,
    desc: 'The carrier\'s landing lens is dark: no ball, no datum lights, nothing to fly but the numbers. Paddles can still see you and will talk you down. Fly on-speed, fly the numbers, and do what the LSO says the moment he says it.',
    tips: [
      'Hook, gear and full flaps are already down. Hold on-speed with power: 8.1° AoA (the green ON SPD mark), about 135 kt.',
      'Fly the path by the numbers with small pitch changes: 1 NM from the ramp 460 ft, half a mile 270 ft, over the ramp 85 ft.',
      '"Power" means power now; "a little high" means ease it down. No flare, and full throttle the instant you touch.',
    ],
    wind: { rel: 0, speed: 8 }, weight: 'normal',
    spawn: { dist: 2600, hook: true, flap: 1.0, fixed: true },
    failures: [{ name: 'lensFail', at: { type: 'start' } }],
    scoring: { type: 'carrier' },
    hint: (ctx) => {
      const ac = ctx.ac;
      if (ac.onGround) return null;   // the deck's own hints (full power until the wire has you)
      if (ctx.d > 400) return 'No ball: on-speed AoA with power; the altimeter against the numbers: 1 NM 460 ft, ½ NM 270 ft, the ramp 85 ft.';
      return 'Do what Paddles says, now. No flare: fly it into the deck.';
    },
  },
];

// Sites this area adds (same shape as SITES in src/systems/scenarios.js). Merged into SITES by index.js.
export const FAILURES_SITES = {};
