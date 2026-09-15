// Headless physics checks: control signs, stall speeds, trimmed approach + autoland for each aircraft.
// Run: npm test
import { Vector3 } from 'three';
import { Aircraft, makeGroundOut } from '../src/physics/aircraft.js';
import { stallSpeed } from '../src/physics/aero.js';
import { AIRCRAFT_LIST } from '../src/aircraft/defs.js';
import { KT, FT, DEG, RAD, FPM, clamp } from '../src/config.js';

const env = {
  wind: (pos, t, out) => out.set(0, 0, 0),
  ground: (x, z, out) => { out.y = 0; out.n.set(0, 1, 0); out.mu = 0.8; out.kind = 'runway'; out.vel.set(0, 0, 0); out.rough = 0; },
  carrier: null,
};

let failures = 0;
function check(cond, msg) {
  console.log((cond ? '  ok   ' : '  FAIL ') + msg);
  if (!cond) failures++;
}
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);

// ---------- 1. control sign checks ----------
console.log('\n== Control sign checks (Skylark, 70 kt level) ==');
{
  const def = AIRCRAFT_LIST[0];
  const mk = () => { const ac = new Aircraft(def); ac.pos.set(0, 300, 0); ac.trim(0, 70 * KT, 0, 0); return ac; };
  let ac = mk(); ac.input.pitch = 0.8; for (let i = 0; i < 30; i++) ac.step(1 / 60, env);
  check(ac.omega.x > 0.05, `pull -> pitch up (q=${ac.omega.x.toFixed(3)})`);
  ac = mk(); ac.input.roll = 0.8; for (let i = 0; i < 30; i++) ac.step(1 / 60, env);
  check(-ac.omega.z > 0.05 && ac.euler.roll > 0.02, `right stick -> roll right (p=${(-ac.omega.z).toFixed(3)}, roll=${(ac.euler.roll * RAD).toFixed(1)} deg)`);
  ac = mk(); ac.input.yaw = 0.8; for (let i = 0; i < 30; i++) ac.step(1 / 60, env);
  check(-ac.omega.y > 0.01, `right rudder -> yaw right (r=${(-ac.omega.y).toFixed(3)})`);
  ac = mk(); ac.input.throttle = 1; for (let i = 0; i < 120; i++) ac.step(1 / 60, env);
  check(ac.tas > 70 * KT + 1, `full throttle -> accelerates (tas ${f1(ac.tas / KT)} kt after 2 s)`);
  // sideslip weathercock: fly with a crosswind gust and see the nose turn into it
  ac = mk(); const w = { ...env, wind: (p, t, o) => o.set(8, 0, 0) };
  for (let i = 0; i < 60; i++) ac.step(1 / 60, w);
  // wind from the west (blowing +x): relative wind from the left -> nose should yaw left (negative heading)
  check(ac.euler.heading < -0.01, `weathercock into wind (heading ${(ac.euler.heading * RAD).toFixed(2)} deg)`);
}

// ---------- 2. stall speeds ----------
console.log('\n== Stall speeds (analytic, 1 g, sea level) ==');
for (const def of AIRCRAFT_LIST) {
  const vs1 = stallSpeed(def, def.mass, 0) / KT;
  const vs0 = stallSpeed(def, def.mass, 1) / KT;
  console.log(`  ${def.name.padEnd(14)} clean ${f1(vs1)} kt (target ${def.speeds.Vs1})   full flap ${f1(vs0)} kt (target ${def.speeds.Vs0})`);
  check(Math.abs(vs1 - def.speeds.Vs1) < 5, `${def.short} clean stall within 5 kt`);
  check(Math.abs(vs0 - def.speeds.Vs0) < 5, `${def.short} flap stall within 5 kt`);
}

// ---------- 3. dynamic stall: hold altitude at idle until it breaks ----------
console.log('\n== Dynamic stall (altitude hold, idle power) ==');
for (const def of AIRCRAFT_LIST) {
  const ac = new Aircraft(def);
  ac.pos.set(0, 600, 0);
  const flap = def.id === 'hornet' ? 1 : 0.667;
  ac.trim(0, def.speeds.Vref * KT * 1.15, 0, flap);
  ac.input.throttle = 0;
  let warnIas = null, breakIas = null, breakAlpha = null, maxAlpha = 0, wingDropRoll = 0;
  let stalledAt = null;
  for (let i = 0; i < 60 * 90; i++) {
    // altitude hold: pitch to keep vs = 0 (will pull into the stall)
    const vsErr = 0 - ac.vs;
    ac.input.pitch = clamp(0.12 * vsErr - 0.6 * ac.omega.x + (600 - ac.pos.y) * 0.01, -1, 1);
    ac.input.roll = clamp(-2.0 * ac.euler.roll + 0.5 * ac.omega.z, -1, 1);
    ac.step(1 / 60, env);
    if (ac.aero.warning && warnIas == null) warnIas = ac.ias / KT;
    if (ac.aero.stall > 0.5 && breakIas == null) { breakIas = ac.ias / KT; breakAlpha = ac.aero.alpha * RAD; stalledAt = i; }
    if (ac.aero.alpha > maxAlpha) maxAlpha = ac.aero.alpha;
    if (stalledAt != null) {
      wingDropRoll = Math.max(wingDropRoll, Math.abs(ac.euler.roll));
      if (i > stalledAt + 60 * 3) break;
    }
    if (ac.crashed) break;
  }
  const vsRef = stallSpeed(def, def.mass, flap) / KT;
  console.log(`  ${def.name.padEnd(14)} warn ${warnIas ? f1(warnIas) : '-'} kt   break ${breakIas ? f1(breakIas) : '-'} kt at alpha ${breakAlpha ? f1(breakAlpha) : '-'}  (1g Vs ${f1(vsRef)})  sink after break ${f1(-ac.vs / FPM)} fpm, roll ${f1(wingDropRoll * RAD)} deg`);
  check(breakIas != null, `${def.short} actually stalls when held level at idle`);
  const tol = 6 + def.stall.breakWidth * RAD;
  if (breakIas != null) check(breakIas < vsRef + 6 && breakIas > vsRef - tol, `${def.short} break speed near 1g stall speed`);
  if (warnIas != null && breakIas != null) check(warnIas > breakIas, `${def.short} warning comes before the break (${f1(warnIas - breakIas)} kt margin)`);
}

// ---------- 4. autoland ----------
console.log('\n== Autoland on a flat runway (threshold at z=0, heading north) ==');
function autoland(def, opts = {}) {
  const ac = new Aircraft(def, { mass: opts.mass });
  const ap = def.approach;
  const dist = opts.dist || 4000;
  const gs = ap.glideslope;
  const aim = ap.aimDistance;
  ac.pos.set(0, (dist + aim) * Math.tan(gs) + def.cgHeight, dist);
  const flap = opts.flap ?? (def.id === 'condor' ? 0.75 : 1);
  ac.input.gearCmd = 1; ac.ctl.gear = 1;
  const vref = (opts.vref || def.speeds.Vref) * KT;
  if (def.hook) { ac.input.hookCmd = 1; ac.ctl.hook = 1; }
  ac.trim(0, vref, -gs, flap);
  if (opts.fail) ac.fail(opts.fail);
  let phase = 'approach';
  let flareT = 0;
  const log = [];
  let t = 0;
  let touchdownZ = null;
  const jet = def.engines[0].type === 'jet';
  const kp = jet ? 4.5 : 3.0, kd = jet ? 2.5 : 1.0;   // pitch attitude inner loop
  const pitchRef0 = ac.euler.pitch;
  let pitchInt = 0, thrInt = 0;
  const thr0 = ac.input.throttle;
  let pitch0 = 0;
  const flareInc = { skylark: 8, trailblazer: 9, condor: 3.5, hornet: 0 }[def.id] * DEG;
  const flareTime = jet ? 3.5 : 3.0;
  for (let i = 0; i < 60 * 240; i++) {
    const dt = 1 / 60; t += dt;
    const dToAim = ac.pos.z + aim; // distance to aiming point along -z
    const hAgl = ac.radioAlt;
    const speedErr = vref - ac.ias;
    // lateral: hold x = 0
    const xte = ac.pos.x;
    const rollCmd = clamp(-0.02 * xte - 0.06 * ac.vel.x - 1.0 * ac.euler.heading, -0.35, 0.35);
    ac.input.roll = clamp(2.5 * (rollCmd - ac.euler.roll) + 0.8 * ac.omega.z, -1, 1);
    ac.input.yaw = clamp(1.5 * ac.aero.beta, -1, 1);
    let pitchCmd = ac.euler.pitch;
    if (phase === 'approach') {
      const hDes = Math.max(0, dToAim) * Math.tan(gs) + def.cgHeight;
      const vsDes = clamp(-ac.gs * Math.tan(gs) + 0.15 * (hDes - ac.pos.y), -8, 3);
      const vsErr = vsDes - ac.vs;
      pitchInt = clamp(pitchInt + 0.004 * vsErr * dt, -0.1, 0.1);
      pitchCmd = pitchRef0 + 0.025 * vsErr + pitchInt;
      thrInt = clamp(thrInt + 0.01 * speedErr * dt, -0.3, 0.3);
      ac.input.throttle = clamp(thr0 + 0.03 * speedErr + thrInt - 0.01 * vsErr, 0, 1);
      if (hAgl < ap.flareHeight && ap.flareHeight > 0) { phase = 'flare'; flareT = 0; pitch0 = ac.euler.pitch; }
    } else if (phase === 'flare') {
      flareT += dt;
      ac.input.throttle = Math.max(0, ac.input.throttle - dt * (jet ? 0.4 : 0.8));
      pitchCmd = pitch0 + flareInc * Math.min(flareT / flareTime, 1);
      if (def.limits.tailStrikePitch < 1) pitchCmd = Math.min(pitchCmd, def.limits.tailStrikePitch - 2 * DEG);
    }
    if (ac.stats.touchdown && phase !== 'rollout') { phase = 'rollout'; touchdownZ = ac.stats.touchdown.pos.z; pitch0 = ac.euler.pitch; flareT = 0; }
    if (phase === 'rollout') {
      flareT += dt;
      ac.input.throttle = 0;
      pitchCmd = pitch0 + (-2 * DEG - pitch0) * Math.min(flareT / (jet ? 4 : 1.5), 1);
      if (ac.groundTime > 1.5) ac.input.brake = 0.8;
      if (def.engines[0].reverse) ac.input.reverse = ac.gs > 25 ? 0.8 : 0;
      if (def.spoilers) ac.input.spoiler = 1;
      ac.input.yaw = clamp(-0.05 * ac.pos.x - 0.1 * ac.vel.x - 1.5 * ac.euler.heading, -1, 1);
    }
    ac.input.pitch = clamp(kp * (pitchCmd - ac.euler.pitch) - kd * ac.omega.x, -1, 1);
    ac.step(dt, env);
    if (i % 120 === 0 && phase === 'approach') log.push(`t=${t.toFixed(0)}s h=${f1(hAgl / FT)}ft ias=${f1(ac.ias / KT)} vs=${f1(ac.vs / FPM)} thr=${f1(ac.input.throttle * 100)}% a=${f1(ac.aero.alpha * RAD)}`);
    if (ac.crashed || ac.stopped) break;
  }
  const td = ac.stats.touchdown;
  return { ac, td, log, touchdownZ, phase, t };
}
for (const def of AIRCRAFT_LIST) {
  const r = autoland(def);
  const { ac, td } = r;
  console.log(`  ${def.name}:`);
  for (const l of r.log.slice(0, 3)) console.log('     ' + l);
  if (td) {
    console.log(`     touchdown: vs ${f1(td.vs / FPM)} fpm, ias ${f1(td.ias / KT)} kt, pitch ${f1(td.pitch * RAD)} deg, ${f1(-td.pos.z)} m past threshold, legs ${td.legs.join('+')}`);
    console.log(`     rollout: stopped=${ac.stopped} at ${f1(-ac.pos.z)} m, crashed=${ac.crashed} ${ac.crashReason || ''}, bounces ${ac.stats.bounces}, damage [${ac.stats.damage.join(', ')}], maxG ${f1(ac.stats.maxG)}`);
    check(td.vs < def.limits.hardVS, `${def.short} touchdown softer than hard limit`);
    check(ac.stopped && !ac.crashed, `${def.short} stopped on the runway without crashing`);
    check(-ac.pos.z < (def.id === 'hornet' ? 4000 : def.approach.runwayNeed + 900), `${def.short} rollout length reasonable (${f1(-ac.pos.z)} m)`);
  } else {
    console.log(`     no touchdown; phase ${r.phase}, crashed=${ac.crashed} ${ac.crashReason || ''}, t=${f1(r.t)} alt=${f1(ac.alt)} ias=${f1(ac.ias / KT)}`);
    check(false, `${def.short} reached the runway`);
  }
}

// ---------- 5. dead-stick glide ratio ----------
console.log('\n== Glide (engine failed, Skylark, 68 kt, flaps up) ==');
{
  const def = AIRCRAFT_LIST[0];
  const ac = new Aircraft(def);
  ac.pos.set(0, 1000, 0);
  ac.trim(0, 68 * KT, -4 * DEG, 0);
  ac.fail('engine');
  ac.input.throttle = 0;
  let z0 = ac.pos.z, h0 = ac.pos.y;
  for (let i = 0; i < 60 * 40; i++) {
    const err = 68 * KT - ac.ias;
    ac.input.pitch = clamp(-0.05 * err - 0.7 * ac.omega.x, -1, 1); // hold speed with pitch
    ac.input.roll = clamp(-2.0 * ac.euler.roll + 0.5 * ac.omega.z, -1, 1);
    ac.step(1 / 60, env);
  }
  const ratio = Math.abs(ac.pos.z - z0) / (h0 - ac.pos.y);
  console.log(`  glide ratio ${f1(ratio)}:1 at ${f1(ac.ias / KT)} kt, sink ${f1(-ac.vs / FPM)} fpm`);
  check(ratio > 7 && ratio < 12, 'glide ratio between 7 and 12 (C172 book ~9)');
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
