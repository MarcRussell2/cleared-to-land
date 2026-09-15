// Failure catalogue. Each entry: display name, what the pilot sees, and how to apply it.
export const FAILURES = {
  engine: { name: 'Engine failure', desc: 'All engines quit. Glide.', hint: 'Pitch for best glide speed and trim. Flaps only when the field is made.', msg: 'ENGINE FAILURE' },
  engineLeft: { name: 'Left engine failure', desc: 'The left engine fails; asymmetric thrust.', hint: 'Right rudder with power. Keep the ball centered.', msg: 'LEFT ENGINE FAILURE' },
  engineRight: { name: 'Right engine failure', desc: 'The right engine fails; asymmetric thrust.', hint: 'Left rudder with power. Keep the ball centered.', msg: 'RIGHT ENGINE FAILURE' },
  flapsStuck: { name: 'Flaps jammed', desc: 'Flaps freeze at their current position.', hint: 'Fly faster: add 15-25 kt to your reference speed, expect a long float.', msg: 'FLAPS JAMMED' },
  gearStuck: { name: 'Gear stuck', desc: 'Landing gear frozen in its current position.', hint: 'If it is up: belly landing, keep the nose up, idle before touchdown.', msg: 'GEAR FAILURE' },
  noseGear: { name: 'Nose gear unsafe', desc: 'The nose gear will not extend.', hint: 'Land on the mains, hold the nose off as long as possible.', msg: 'NOSE GEAR UNSAFE' },
  elevatorJam: { name: 'Jammed elevator', desc: 'Pitch only through trim (slow) and power.', hint: 'Trim with T/Y. Power up = nose up. Plan far ahead.', msg: 'ELEVATOR JAMMED' },
  hydraulics: { name: 'Hydraulic failure', desc: 'Slow controls, weak brakes, no spoilers, limited steering.', hint: 'Anticipate every input; land long and slow, brake early.', msg: 'HYDRAULIC FAILURE' },
  brakes: { name: 'Brake failure', desc: 'No wheel brakes.', hint: 'Touch down early, use reverse thrust and spoilers.', msg: 'BRAKES FAILED' },
  ice: { name: 'Wing icing', desc: 'Stall speed up, early stall, extra drag and weight.', hint: 'Fly 10-15 kt faster, partial flaps, shallow flare.', msg: 'WING ICE' },
};

export function applyFailure(ac, spec) {
  ac.fail(spec.name, spec.arg);
  return FAILURES[spec.name] || { name: spec.name, msg: spec.name.toUpperCase() };
}

// Trigger check: returns true when the failure should fire now
export function shouldTrigger(spec, ac, ctx) {
  const at = spec.at || { type: 'start' };
  switch (at.type) {
    case 'start': return true;
    case 'time': return ctx.t >= at.value;
    case 'alt': return ac.radioAlt / 0.3048 <= at.value && ctx.t > 1;
    case 'dist': return ctx.distToThreshold <= at.value;
    default: return false;
  }
}
