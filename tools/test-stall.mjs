// Stall checks (2026-09-15): the Stall Recovery start holds the airplane in the stall until the pilot pushes
// or adds power, in both control modes, and the aircraft keeps held stalls and flare-zone stalls apart from
// stalls on the approach (scoring.js reads those counters). Plain Node, no GPU.
import { Vector3 } from 'three';
import { Aircraft } from '../src/physics/aircraft.js';
import { AIRCRAFT } from '../src/aircraft/defs.js';
import { FlightControl } from '../src/systems/flightControl.js';
import { KT, DEG } from '../src/config.js';

let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };
const env = {
  wind: (p, t, o) => o.set(0, 0, 0),
  ground: (x, z, o) => { o.y = 0; o.n.set(0, 1, 0); o.mu = 0.8; o.kind = 'grass'; o.vel.set(0, 0, 0); o.rough = 0; },
  carrier: null,
};
const def = AIRCRAFT.skylark;

// The Stall Recovery spawn as main.js does it: slow, flaps 10, power off, held.
function entry(mode) {
  const ac = new Aircraft(def, { mass: def.mass });
  ac.pos.set(0, 200, 0);
  ac.trim(0, 56 * KT, -1.5 * DEG, 0.333, new Vector3());
  ac.input.throttle = 0; ac.input.trim = 0; for (const e of ac.engines) e.throttle = 0;
  ac.stallHold = true;
  ac._derive();
  const fcs = new FlightControl(ac, { controlMode: mode });
  const inp = { kbRoll: 0, kbPitch: 0, mouseYoke: false, mdx: 0, mdy: 0, mouseSens: 0.5, yaw: 0, trim: 0, boost: false, pitch: 0, roll: 0 };
  const run = { ac, fcs, inp, t: 0 };
  run.step = (seconds, each) => {
    for (let f = 0; f < Math.round(seconds * 60); f++) {
      if (each) each(run.t);
      fcs.update(1 / 60, inp, ac, 1);
      for (const e of ac.engines) e.throttle = ac.input.throttle;
      for (let s = 0; s < 4; s++) ac.step(1 / 240, env);
      run.t += 1 / 60;
    }
  };
  return run;
}

for (const mode of ['assist', 'direct']) {
  console.log(`\n== Stall Recovery start, ${mode} mode ==`);
  const s = entry(mode);
  let tBreak = null, stalled = 0;
  s.step(10, (t) => { if (tBreak == null && s.ac.aero.stall > 0.5) tBreak = t; if (s.ac.aero.stall > 0.3) stalled += 1 / 60; });
  check(tBreak != null && tBreak > 1.2 && tBreak < 5, `the wing breaks after an entry, not at once (${tBreak == null ? 'never' : tBreak.toFixed(2) + ' s'})`);
  check(stalled > 5, `with nobody touching anything it stays stalled (${stalled.toFixed(1)} of 10 s)`);
  check(s.ac.stallHold && !s.ac.crashed, 'still held after 10 s, and not crashed');
  check(s.ac.stats.stalls >= 1 && s.ac.stats.stallsHeld === s.ac.stats.stalls, `every stall while held is marked as held (${s.ac.stats.stallsHeld} of ${s.ac.stats.stalls})`);

  const p = entry(mode);
  p.step(4);
  if (mode === 'assist') p.inp.kbPitch = -0.7; else p.inp.pitch = -0.7;
  p.step(0.1);
  check(!p.ac.stallHold, 'pushing the nose down hands over the airplane');
  p.ac.input.throttle = 1;
  p.step(1.2);
  p.inp.kbPitch = 0; p.inp.pitch = 0;
  p.step(7);
  check(p.ac.aero.stall < 0.1 && p.ac.ias > 55 * KT, `after a push and full power it flies again (stall ${p.ac.aero.stall.toFixed(2)}, ${(p.ac.ias / KT).toFixed(0)} kt)`);

  const q = entry(mode);
  q.step(3);
  q.ac.input.throttle = 1;
  q.step(0.1);
  check(!q.ac.stallHold, 'adding power hands over the airplane too');
}

console.log('\n== Stall counters ==');
{
  const ac = new Aircraft(def, { mass: def.mass });
  ac.pos.set(0, 400, 0); ac.trim(0, 60 * KT, 0, 1, new Vector3());
  ac.input.throttle = 0; for (const e of ac.engines) e.throttle = 0; ac._derive();
  for (let i = 0; i < 240 * 6; i++) { ac.input.pitch = 1; ac.step(1 / 240, env); }
  check(ac.stats.stalls >= 1 && ac.stats.stallsLow === 0 && ac.stats.stallsHeld === 0, `a stall at 1,300 ft is a stall on the approach (stalls ${ac.stats.stalls}, in the flare zone ${ac.stats.stallsLow})`);
}
{
  const ac = new Aircraft(def, { mass: def.mass });
  ac.pos.set(0, def.cgHeight + 3, 0); ac.trim(0, 50 * KT, 0, 1, new Vector3());
  ac.input.throttle = 0; for (const e of ac.engines) e.throttle = 0; ac._derive();
  for (let i = 0; i < 240 * 4 && !ac.onGround; i++) { ac.input.pitch = 1; ac.step(1 / 240, env); }
  check(ac.stats.stallsLow === ac.stats.stalls, `a stall in the last few feet is part of the landing (stalls ${ac.stats.stalls}, in the flare zone ${ac.stats.stallsLow})`);
  check(ac.stats.stallWarnTimeLow > 0 && ac.stats.stallWarnTimeLow <= ac.stats.stallWarnTime + 1e-9, `the horn in the flare is kept apart (${ac.stats.stallWarnTimeLow.toFixed(2)} of ${ac.stats.stallWarnTime.toFixed(2)} s)`);
}

console.log(failures ? `\n${failures} stall check(s) FAILED` : '\nall stall checks passed');
process.exit(failures ? 1 : 0);
