// Float measurement: fly the trainer down to flare height with the autopilot, then hand it to the
// assisted control law with (a) no pitch input and (b) a light steady pull, and time the float.
import { Aircraft } from '../src/physics/aircraft.js';
import { SKYLARK } from '../src/aircraft/defs.js';
import { FlightControl } from '../src/systems/flightControl.js';
import { Autoland } from '../src/systems/autopilot.js';
import { KT, DEG, RAD, FPM } from '../src/config.js';
import { Vector3 } from 'three';

const env = { wind: (p, t, o) => o.set(0, 0, 0), ground: (x, z, o) => { o.y = 0; o.n.set(0, 1, 0); o.mu = 0.8; o.kind = 'runway'; o.vel.set(0, 0, 0); o.rough = 0; }, carrier: null };
const rw = { threshold: new Vector3(0, 0, 0), dir: new Vector3(0, 0, -1), right: new Vector3(1, 0, 0), aim: new Vector3(0, 0, -300), aimDistance: 300, heading: 0, length: 2600, elevation: 0, slope: 0 };
function run(pull, label) {
  const def = SKYLARK;
  const ac = new Aircraft(def);
  ac.pos.set(0, 900 * Math.tan(3 * DEG) + def.cgHeight, 600);
  ac.trim(0, def.speeds.Vref * KT, -3 * DEG, 1);
  const ap = new Autoland(ac, { runway: rw, carrier: null }, { scoring: { type: 'runway' }, spawn: {} });
  let t = 0, flareT = null, fcs = null;
  const inp = { kbRoll: 0, kbPitch: 0, yaw: 0, trim: 0, mouseYoke: false, mdx: 0, mdy: 0, boost: false, mouseSens: 0.5, pitch: 0, roll: 0 };
  let minAlt = 99;
  for (let i = 0; i < 60 * 60; i++) {
    if (flareT == null) {
      ap.update(1 / 60);
      if (ac.radioAlt < 5) { flareT = t; fcs = new FlightControl(ac, { controlMode: 'assist' }); ac.input.throttle = 0; inp.trim = ac.input.trim; }
    } else {
      inp.kbPitch = pull;
      fcs.update(1 / 60, inp, ac);
      ac.input.throttle = 0;
    }
    ac.step(1 / 60, env);
    t += 1 / 60;
    if (flareT != null) minAlt = Math.min(minAlt, ac.radioAlt);
    if (ac.stats.touchdown) break;
  }
  const td = ac.stats.touchdown;
  const float = td ? td.t - flareT : null;
  console.log(`${label}: flare handover at ${flareT?.toFixed(1)} s, ${(ac.ias / KT).toFixed(0)} kt; touchdown ${td ? `${(td.vs / FPM).toFixed(0)} fpm at ${(td.ias / KT).toFixed(0)} kt, pitch ${(td.pitch * RAD).toFixed(1)} deg, ${td.legs.join('+')}` : 'NONE'}; float ${float ? float.toFixed(1) + ' s' : '-'}`);
  return { float, td };
}
const a = run(0, 'hands off at idle ');
const b = run(0.35, 'light steady pull ');
const c = run(0.7, 'firm pull         ');
let fail = 0;
if (!(a.float != null && a.float < 4.5)) { console.log('  FAIL hands-off float should be under 4.5 s'); fail++; }
if (!(b.float != null && b.float < 7 && b.td.vs < 2.2)) { console.log('  FAIL light pull should touch down softly within 7 s'); fail++; }
if (!(c.td && (c.td.legs.includes('left') || c.td.legs.includes('right')))) { console.log('  FAIL firm pull should still land mains first'); fail++; }
console.log(fail ? `${fail} check(s) FAILED` : 'All checks passed');
process.exit(fail ? 1 : 0);
