// Headless carrier trap test: Hornet + moving deck + wires, flown by the game's Autoland.
import { Vector3 } from 'three';
import { Aircraft, makeGroundOut } from '../src/physics/aircraft.js';
import { HORNET } from '../src/aircraft/defs.js';
import { Carrier } from '../src/world/carrier.js';
import { Autoland } from '../src/systems/autopilot.js';
import { Wind } from '../src/physics/wind.js';
import { KT, FT, DEG, RAD, FPM, clamp } from '../src/config.js';

const seaState = +(process.argv[2] || 0.2);
const windKt = +(process.argv[3] || 8);
const carrier = new Carrier({ heading: 0, speedKt: 25, seaState });
const wind = new Wind({ dir: (carrier.landingHeading() * RAD + 360) % 360, speed: windKt, gust: windKt + 3, turb: 0.1 });
const env = {
  wind: (p, t, o) => wind.at(p, t, o),
  ground: (x, z, o) => { if (carrier.ground(x, z, o)) return; o.y = 0; o.n.set(0, 1, 0); o.mu = 0.1; o.kind = 'water'; o.vel.set(0, 0, 0); o.rough = 0; },
  carrier,
};
const ac = new Aircraft(HORNET);
const dist = +(process.argv[4] || 1700);
const td = carrier.tdWorld, dir = carrier.landDirWorld;
ac.pos.copy(td).addScaledVector(dir, -dist);
ac.pos.y = td.y + dist * Math.tan(3.5 * DEG) + 3;
ac.input.hookCmd = 1; ac.ctl.hook = 1;
ac.trim(carrier.landingHeading(), 135 * KT, -3.5 * DEG, 1, wind.at(ac.pos, 0, new Vector3()));
const world = { carrier, runway: null };
const ap = new Autoland(ac, world, { scoring: { type: 'carrier' }, spawn: {} });
let t = 0;
const dt = 1 / 60;
const dl = { u: 0, v: 0, h: 0, onDeck: false };
let lastLog = -1;
for (let i = 0; i < 60 * 120; i++) {
  carrier.update(dt);
  ap.update(dt);
  ac.step(dt, env);
  t += dt;
  for (const e of ac.events) console.log(`  ${t.toFixed(2)}s EVENT ${e.type} ${e.reason || e.wire || e.leg || ''} ${e.td ? Math.round(e.td.vs / FPM) + ' fpm legs=' + e.td.legs.join('+') + ' pitch=' + (e.td.pitch * RAD).toFixed(1) : ''}`);
  ac.events.length = 0;
  carrier.deckLocal(ac.pos, dl);
  const near = dl.u > -400 && dl.u < 260;
  const every = near ? 0.25 : 3;
  if (t - lastLog >= every) {
    lastLog = t;
    const legs = ac.legs.map((l) => `${l.name[0]}${l.contact ? Math.round(l.load / 1000) : '-'}`).join(' ');
    console.log(`${t.toFixed(2)}s u=${dl.u.toFixed(0)} v=${dl.v.toFixed(1)} h=${dl.h.toFixed(1)} ias=${(ac.ias / KT).toFixed(0)} vs=${(ac.vs / FPM).toFixed(0)} aoa=${(ac.aero.alpha * RAD).toFixed(1)} pitch=${(ac.euler.pitch * RAD).toFixed(1)} roll=${(ac.euler.roll * RAD).toFixed(1)} hdg=${((ac.euler.heading - carrier.landingHeading()) * RAD).toFixed(1)} thr=${ac.input.throttle.toFixed(2)} gsRel=${ac.gsRel.toFixed(1)} legs[${legs}] hook=${ac.hookPt.contact ? Math.round(ac.hookPt.load / 1000) : '-'} trap=${ac.trap.engaged ? 'ENG' : ac.trap.trapped ? 'TRAPPED' : ac.trap.boltered ? 'BOLTER' : '-'} p=${(-ac.omega.z).toFixed(2)} r=${(-ac.omega.y).toFixed(2)}`);
  }
  if (ac.crashed || ac.stopped) { console.log('END', ac.crashed ? 'CRASH ' + ac.crashReason : 'STOPPED', 'wire', ac.trap.wire, 'damage', ac.stats.damage); break; }
}
