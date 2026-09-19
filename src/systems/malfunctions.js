// Failure catalogue. Each entry: display name, what the pilot sees, and how to apply it.
//
// Fields (2026-09-17, the missions expansion; the first ten entries keep their text and their effects):
//   name, desc, hint, msg   what the briefing, the callout and the warning say
//   applies(def)            can this aircraft have it at all (Free Flight lists only these: a single-engine airplane
//                           has no left engine, a fixed-gear one no gear to jam, only a hook aircraft a lens to lose)
//   silent                  true: no warning, no chime, no voice; the pilot has to notice (the airspeed quietly lying,
//                           a tire that announces itself with a bang)
//   effect                  true: applied from outside the flight model by src/systems/failureEffects.js (jams,
//                           runaways, a stuck throttle, fire, bird strike, sensors, electrics, gear, tires, flutter, the
//                           carrier's lens). Absent: the aircraft models it itself through ac.fail().
//   action                  the key action that deals with it, if there is one (fireHandle, trimCutout, fuelCutoff)
//   warning                 true: a red master WARNING and the fire bell rather than the amber caution chime
//   freeAt                  the moment it happens in Free Flight, where every failure is otherwise dealt a random
//                           altitude (a tire bursts on touchdown, a gear that will not come down is known from the start)
// New names must not collide with the ones src/physics/aircraft.js checks (engine, engineLeft, engineRight, noseGear,
// gearStuck, flapsStuck, elevatorJam, hydraulics, brakes, ice): those names have effects inside the flight model.
const ALL = () => true;
const TWIN = (d) => d.engines.length > 1;
const RETRACT = (d) => !!d.gearRetract;
export const FAILURES = {
  engine: { name: 'Engine failure', desc: 'All engines quit. Glide.', hint: 'Pitch for best glide speed and trim. Flaps only when the field is made.', msg: 'ENGINE FAILURE', applies: ALL },
  engineLeft: { name: 'Left engine failure', desc: 'The left engine fails; asymmetric thrust.', hint: 'Right rudder with power. Keep the ball centered.', msg: 'LEFT ENGINE FAILURE', applies: TWIN },
  engineRight: { name: 'Right engine failure', desc: 'The right engine fails; asymmetric thrust.', hint: 'Left rudder with power. Keep the ball centered.', msg: 'RIGHT ENGINE FAILURE', applies: TWIN },
  flapsStuck: { name: 'Flaps jammed', desc: 'Flaps freeze at their current position.', hint: 'Fly faster: add 15-25 kt to your reference speed, expect a long float.', msg: 'FLAPS JAMMED', applies: ALL },
  gearStuck: { name: 'Gear stuck', desc: 'Landing gear frozen in its current position.', hint: 'If it is up: belly landing, keep the nose up, idle before touchdown.', msg: 'GEAR FAILURE', applies: RETRACT },
  noseGear: { name: 'Nose gear unsafe', desc: 'The nose gear will not extend.', hint: 'Land on the mains, hold the nose off as long as possible.', msg: 'NOSE GEAR UNSAFE', applies: (d) => d.gear.some((g) => g.name === 'nose') },
  elevatorJam: { name: 'Jammed elevator', desc: 'Pitch only through trim (slow) and power.', hint: 'Trim with T/Y. Power up = nose up. Plan far ahead.', msg: 'ELEVATOR JAMMED', applies: ALL },
  hydraulics: { name: 'Hydraulic failure', desc: 'Slow controls, weak brakes, no spoilers, limited steering.', hint: 'Anticipate every input; land long and slow, brake early.', msg: 'HYDRAULIC FAILURE', applies: (d) => d.engines[0].type === 'jet' },
  brakes: { name: 'Brake failure', desc: 'No wheel brakes.', hint: 'Touch down early, use reverse thrust and spoilers.', msg: 'BRAKES FAILED', applies: ALL },
  ice: { name: 'Wing icing', desc: 'Stall speed up, early stall, extra drag and weight.', hint: 'Fly 10-15 kt faster, partial flaps, shallow flare.', msg: 'WING ICE', applies: ALL },

  // ---- the missions expansion: effects applied from outside the flight model (src/systems/failureEffects.js) ----
  aileronJam: { name: 'Aileron jam', desc: 'The ailerons stick a little off center and the stick does nothing sideways.', hint: 'Roll with rudder (Q/E): yaw first, the bank follows a second later. Small and early.', msg: 'AILERONS JAMMED', applies: ALL, effect: true },
  rudderJam: { name: 'Rudder hardover', desc: 'The rudder runs partly over to one side and stays there until the wheels are down.', hint: 'Hold the wings level against it with aileron and opposite pedal. It lets go on the ground.', msg: 'RUDDER HARDOVER', applies: ALL, effect: true },
  runawayTrim: { name: 'Runaway trim', desc: 'The pitch trim runs away nose down until it is cut out.', hint: 'Trim cutout now (press D), hold the nose up, then wind the trim back with T.', msg: 'TRIM RUNAWAY', applies: ALL, effect: true, action: 'trimCutout' },
  stuckThrottle: { name: 'Stuck throttle', desc: 'The throttles jam where they are: no more, no less.', hint: 'Burn the extra energy with drag: flaps, gear, speedbrake. Cut the fuel (press U) in the flare.', msg: 'THROTTLE JAMMED', applies: ALL, effect: true, action: 'fuelCutoff' },
  enginePartial: { name: 'Partial power', desc: 'An engine gives about half of what the lever asks for.', hint: 'Less climb, and on a twin a yaw toward the weak side. Stay high and steep.', msg: 'ENGINE POWER LOSS', applies: ALL, effect: true },
  engineSurge: { name: 'Surging engine', desc: 'An engine surges and sags every few seconds.', hint: 'Fly through the surges with rudder and pitch. Shut it down (press A) if it gets worse.', msg: 'ENGINE SURGE', applies: ALL, effect: true, action: 'fireHandle' },
  engineFire: { name: 'Engine fire', desc: 'An engine catches fire, and it gets worse until the fire handle is pulled.', hint: 'Pull the fire handle (press A): it shuts that engine down and puts the fire out.', msg: 'ENGINE FIRE', applies: ALL, effect: true, action: 'fireHandle', warning: true },
  birdStrike: { name: 'Bird strike', desc: 'A bird through the windshield and one down an engine.', hint: 'Fly the airplane first. The damaged engine surges: shut it down (press A) if it bothers you.', msg: 'BIRD STRIKE', applies: ALL, effect: true, action: 'fireHandle' },
  pitotIce: { name: 'Unreliable airspeed', desc: 'The pitot tube ices up and the airspeed reads low. Nothing tells you.', hint: 'Fly pitch and power. Ground speed and the stall warning still tell the truth.', msg: 'IAS DISAGREE', applies: ALL, effect: true, silent: true, freeAt: { type: 'window', from: 8, to: 40 } },
  electrical: { name: 'Electrical failure', desc: 'The electrics die: no HUD, no panel lights, no landing light. A standby airspeed and altimeter remain.', hint: 'A torch on the standby airspeed and altimeter. Fly the runway lights and the PAPI.', msg: 'ELECTRICAL FAILURE', applies: (d) => d.engines[0].type === 'prop', effect: true },
  gearUp: { name: 'Gear will not extend', desc: 'The landing gear stays up whatever you do.', hint: 'Belly landing: full flaps, slow, wings level, cut the fuel (press U) in the flare.', msg: 'GEAR UNSAFE', applies: RETRACT, effect: true, action: 'fuelCutoff', freeAt: { type: 'start' } },
  oneMainStuck: { name: 'One main wheel missing', desc: 'One main wheel is not there to land on.', hint: 'Land on the good wheel, hold the other wing up with aileron while it flies, rudder against the swerve.', msg: 'MAIN GEAR UNSAFE', applies: ALL, effect: true, freeAt: { type: 'start' } },
  blownTire: { name: 'Blown tire', desc: 'A main tire bursts on touchdown and pulls toward its side.', hint: 'Keep it straight with rudder against the pull, and brake gently.', msg: 'TIRE BURST', applies: ALL, effect: true, silent: true, freeAt: { type: 'touchdown' } },
  flutter: { name: 'Control flutter', desc: 'A control surface buzzes and shakes the airplane, worse the faster you go.', hint: 'Slow down: the buzz fades near Vref. Small, firm inputs.', msg: 'FLUTTER', applies: ALL, effect: true },
  lensFail: { name: 'Lens failure', desc: 'The carrier\'s landing lens is dark: no ball. The LSO talks you down.', hint: 'No ball: hold 8.1° AoA, fly the numbers, and do what Paddles says. POWER means now.', msg: 'LENS INOP', applies: (d) => !!d.hook, effect: true, freeAt: { type: 'start' } },
  hookFail: { name: 'Hook failure', desc: 'The tailhook will not come down.', hint: 'No hook, no trap. Fly the pass and take the bolter.', msg: 'HOOK UNSAFE', applies: (d) => !!d.hook, effect: true, freeAt: { type: 'start' } },
};

export function applyFailure(ac, spec) {
  ac.fail(spec.name, spec.arg);
  return FAILURES[spec.name] || { name: spec.name, msg: spec.name.toUpperCase() };
}

// Trigger check: returns true when the failure should fire now.
//   ctx = { t, distToThreshold, gatesPassed }   (gatesPassed only when a mission runtime counts gates)
//   'start'                  at once (the default)
//   'time'      value        seconds since the flight started
//   'alt'       value        radio altitude, FEET, once t > 1
//   'dist'      value        METRES to the threshold (or the carrier's ramp)
//   'touchdown'              the first touch of anything on the ground
//   'speed'     value        below this indicated airspeed (the true one, kt), once t > 1
//   'window'    from, to     a random moment between the two times (s): the runtime draws it from the flight seed
//                            into `at.when` (failureEffects.js), so a pinned seed replays it; until then, `from`
//   'gate'      value        once a mission has counted this many gates
export function shouldTrigger(spec, ac, ctx) {
  const at = spec.at || { type: 'start' };
  switch (at.type) {
    case 'start': return true;
    case 'time': return ctx.t >= at.value;
    case 'alt': return ac.radioAlt / 0.3048 <= at.value && ctx.t > 1;
    case 'dist': return ctx.distToThreshold <= at.value;
    case 'touchdown': return !!ac.stats.touchdown;
    case 'speed': return ctx.t > 1 && ac.ias / 0.514444 < at.value;
    case 'window': return ctx.t >= (at.when != null ? at.when : at.from || 0);
    case 'gate': return ctx.gatesPassed != null && ctx.gatesPassed >= at.value;
    default: return false;
  }
}
