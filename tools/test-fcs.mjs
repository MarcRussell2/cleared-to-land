// Step responses of the assisted control law for each aircraft: bank command, pitch command, stall still possible.
import { Aircraft } from '../src/physics/aircraft.js';
import { AIRCRAFT_LIST } from '../src/aircraft/defs.js';
import { FlightControl } from '../src/systems/flightControl.js';
import { KT, DEG, RAD, clamp } from '../src/config.js';

const env = { wind: (p, t, o) => o.set(0, 0, 0), ground: (x, z, o) => { o.y = 0; o.n.set(0, 1, 0); o.mu = 0.8; o.kind = 'runway'; o.vel.set(0, 0, 0); o.rough = 0; }, carrier: null };
let failures = 0;
const check = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) failures++; };
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
for (const def of AIRCRAFT_LIST) {
  const mk = () => { const ac = new Aircraft(def); ac.pos.set(0, 400, 0); ac.trim(0, def.speeds.Vref * KT, 0, def.id === 'condor' ? 0.75 : 0.667); return ac; };
  const inp = { kbRoll: 0, kbPitch: 0, yaw: 0, trim: 0, mouseYoke: false, mdx: 0, mdy: 0, boost: false, mouseSens: 0.5, pitch: 0, roll: 0 };
  // --- bank: hold full right for 2 s, then release ---
  let ac = mk(); let fcs = new FlightControl(ac, { controlMode: 'assist' });
  let maxBank = 0, bankAt2 = 0, bankAt8 = 0;
  for (let i = 0; i < 60 * 16; i++) {
    inp.kbRoll = i < 120 ? 1 : 0;
    fcs.update(1 / 60, inp, ac);
    ac.step(1 / 60, env);
    const b = ac.euler.roll * RAD;
    if (i === 119) bankAt2 = b;
    if (b > maxBank) maxBank = b;
    if (i === 60 * 14 - 1) bankAt8 = b;
  }
  const expect = Math.min(def.fcs.bankRate * 2, def.fcs.maxBank);
  console.log(`${def.name}: bank after 2 s ${f1(bankAt2)} deg (cmd ${expect}), peak ${f1(maxBank)}, 12 s after release ${f1(bankAt8)} deg, alt ${f1(ac.alt)} m, ias ${f1(ac.ias / KT)}`);
  check(bankAt2 > expect * 0.6, `${def.short} rolls toward the commanded bank`);
  check(maxBank < expect * 1.25 + 3, `${def.short} bank overshoot within limits`);
  check(Math.abs(bankAt8) < (def.id === 'hornet' ? 6 : 4), `${def.short} levels itself after release (slow, deliberate: levelRate halved 2026-09-10)`);
  // --- pitch: hold nose-up for 1 s, then release ---
  ac = mk(); fcs = new FlightControl(ac, { controlMode: 'assist' });
  const p0 = ac.euler.pitch * RAD;
  let pMax = -99, pEnd = 0, cmd = 0;
  for (let i = 0; i < 60 * 5; i++) {
    inp.kbPitch = i < 60 ? 1 : 0;
    fcs.update(1 / 60, inp, ac);
    ac.step(1 / 60, env);
    const pch = ac.euler.pitch * RAD;
    if (pch > pMax) pMax = pch;
    pEnd = pch;
    cmd = fcs.cmdPitch * RAD;
  }
  console.log(`  pitch: start ${f1(p0)}, commanded ${f1(cmd)}, peak ${f1(pMax)}, after 4 s ${f1(pEnd)}, ias ${f1(ac.ias / KT)} kt`);
  check(Math.abs(pEnd - cmd) < (def.id === 'condor' ? 1.6 : 1.0), `${def.short} holds the commanded pitch within ${def.id === 'condor' ? 1.6 : 1} deg`);
  check(pMax - cmd < 2.0, `${def.short} pitch overshoot under 2 deg`);
  // --- the stall is still there: hold full nose-up at idle ---
  ac = mk(); fcs = new FlightControl(ac, { controlMode: 'assist' }); ac.input.throttle = 0;
  for (let i = 0; i < 60 * 25; i++) { inp.kbPitch = 1; fcs.update(1 / 60, inp, ac); ac.step(1 / 60, env); ac.input.throttle = 0; }
  console.log(`  full nose-up at idle: stalls ${ac.stats.stalls}, min ias ${f1(ac.stats.minIasAirborne / KT)} kt, alpha now ${f1(ac.aero.alpha * RAD)} deg`);
  check(ac.stats.stalls >= 1, `${def.short} can still be stalled in assist mode`);
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
