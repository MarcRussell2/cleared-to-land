// Yaw pass guards (2026-09-14). For every aircraft:
//   (a) full rudder held at Vref with the wings level cannot stall the wing, and the sideslip it produces
//       settles to a bounded, realistic value (a C172 holds 12-16 deg at full rudder; an airliner less);
//   (b) the Dutch roll after a rudder doublet is damped: assist mode like an airplane with a yaw damper,
//       direct mode at least MIL-F-8785C Level 1 (zeta >= 0.08) with margin;
//   (c) a crosswind at Vref can still be de-crabbed with rudder to spare (the crosswind challenges need it);
//   (d) right pedal still yaws right and a roll input no longer swings the nose 20 deg the other way;
//   (e) ground steering is unchanged: right rudder on the runway turns the nose right, taildragger included.
// Run: npm test (or node tools/test-yaw.mjs)
import { Aircraft } from '../src/physics/aircraft.js';
import { AIRCRAFT_LIST } from '../src/aircraft/defs.js';
import { FlightControl } from '../src/systems/flightControl.js';
import { KT, DEG, RAD, clamp, wrapPi } from '../src/config.js';

const flat = (x, z, o) => { o.y = 0; o.n.set(0, 1, 0); o.mu = 0.8; o.kind = 'runway'; o.vel.set(0, 0, 0); o.rough = 0; };
const calm = { wind: (p, t, o) => o.set(0, 0, 0), ground: flat, carrier: null };
let failures = 0;
const check = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) failures++; };
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const f2 = (x) => (Math.round(x * 100) / 100).toFixed(2);
const dt = 1 / 60;
const mkInp = () => ({ kbRoll: 0, kbPitch: 0, yaw: 0, trim: 0, mouseYoke: false, mdx: 0, mdy: 0, boost: false, mouseSens: 0.5, pitch: 0, roll: 0 });
// the rudder keys ramp in input.js (2.5/s up, 6/s down); reproduce it so the test sees what the player sends
const ramp = (cur, target) => (target !== 0 ? clamp(cur + Math.sign(target) * 2.5 * dt, -1, 1) : cur > 0 ? Math.max(0, cur - 6 * dt) : Math.min(0, cur + 6 * dt));

// per-class expectations: steady full-rudder sideslip band (deg) and the crosswind the class must de-crab (kt)
const CLASS = {
  skylark: { flap: 0.667, band: [10, 22], xwind: 15 },
  trailblazer: { flap: 0.667, band: [12, 26], xwind: 12 },
  condor: { flap: 0.75, band: [8, 22], xwind: 17 },
  hornet: { flap: 1, band: [10, 26], xwind: 15 },
};

function trimmed(def, speedKt, flap, power, windVec) {
  const ac = new Aircraft(def);
  ac.pos.set(0, 400, 0);
  ac.stallSign = 1;
  ac.trim(0, speedKt * KT, power === 'level' ? 0 : -3 * DEG, flap, windVec);
  if (power === 'full') { ac.input.throttle = 1; for (const e of ac.engines) e.throttle = 1; }
  return ac;
}

// Dutch roll from a trace: strip the steady offset, find alternating peaks, log decrement -> zeta, period
function dutchRoll(ts, raw) {
  const tail = raw.slice(Math.floor(raw.length * 0.8));
  const off = tail.reduce((a, b) => a + b, 0) / Math.max(1, tail.length);
  const xs = raw.map((x) => x - off);
  const p = [];
  for (let i = 2; i < xs.length - 2; i++) {
    if ((xs[i] > xs[i - 1] && xs[i] >= xs[i + 1] && xs[i] > 0.02) || (xs[i] < xs[i - 1] && xs[i] <= xs[i + 1] && xs[i] < -0.02)) p.push({ t: ts[i], x: xs[i] });
  }
  if (p.length < 3) return { period: null, zeta: p.length <= 1 ? 1 : null, halfT: 0, peaks: p.length, amp: p[0]?.x ?? 0 };   // no second swing: overdamped
  const per = [], dec = [];
  for (let i = 2; i < Math.min(p.length, 8); i++) { per.push(p[i].t - p[i - 2].t); dec.push(Math.log(Math.abs(p[i - 2].x / p[i].x))); }
  const period = per.reduce((a, b) => a + b, 0) / per.length;
  const delta = dec.reduce((a, b) => a + b, 0) / dec.length;
  const zeta = delta / Math.sqrt(4 * Math.PI * Math.PI + delta * delta);
  return { period, zeta, halfT: delta > 0 ? (period * Math.LN2) / delta : Infinity, peaks: p.length, amp: p[0].x };
}

for (const def of AIRCRAFT_LIST) {
  const C = CLASS[def.id];
  const vref = def.speeds.Vref;
  console.log(`\n== ${def.name} ==`);

  // ---------- (a) full rudder held, wings level ----------
  for (const [label, power, mode] of [['approach power, assist', 'approach', 'assist'], ['full power, assist', 'full', 'assist'], ['approach power, direct (pilot holds wings + pitch)', 'approach', 'direct']]) {
    const ac = trimmed(def, vref, C.flap, power);
    const fcs = new FlightControl(ac, { controlMode: 'assist' });
    const inp = mkInp(); inp.trim = ac.input.trim;
    const thr = ac.input.throttle, pitch0 = ac.euler.pitch;
    let kYaw = 0, maxStall = 0, warn = false, peakBeta = 0, peakBank = 0, peakAil = 0, minV = 1e9;
    const betas = [];
    for (let i = 0; i < 12 * 60; i++) {
      kYaw = ramp(kYaw, 1);
      if (mode === 'assist') { inp.yaw = kYaw; fcs.update(dt, inp, ac); }
      else {
        ac.input.yaw = kYaw;
        ac.input.roll = clamp(-2.0 * ac.euler.roll + 0.5 * ac.omega.z, -1, 1);
        ac.input.pitch = clamp(2.5 * (pitch0 - ac.euler.pitch) - 1.0 * ac.omega.x, -1, 1);
      }
      ac.input.throttle = thr;
      ac.step(dt, calm);
      const b = ac.aero.beta * RAD;
      maxStall = Math.max(maxStall, ac.aero.stall);
      warn = warn || ac.aero.warning;
      if (Math.abs(b) > Math.abs(peakBeta)) peakBeta = b;
      peakBank = Math.max(peakBank, Math.abs(ac.euler.roll * RAD));
      peakAil = Math.max(peakAil, Math.abs(ac.ctl.aileron));
      minV = Math.min(minV, ac.ias / KT);
      if (i >= 9 * 60) betas.push(b);
    }
    const steady = betas.reduce((a, b) => a + b, 0) / betas.length;
    console.log(`  full rudder, ${label}: steady beta ${f1(steady)} deg (peak ${f1(peakBeta)}), stall ${f2(maxStall)}, warning ${warn}, min ias ${f1(minV)} kt, peak bank ${f1(peakBank)} deg, peak aileron ${f2(peakAil)}`);
    check(maxStall < 0.1, `${def.short} full rudder (${label}) does not stall the wing`);
    check(steady < 0 && -steady >= C.band[0] && -steady <= C.band[1], `${def.short} steady sideslip ${f1(-steady)} deg within ${C.band[0]}-${C.band[1]} (right pedal -> relative wind from the left)`);
    check(Math.abs(peakBeta) < C.band[1] + 8, `${def.short} sideslip overshoot bounded (peak ${f1(Math.abs(peakBeta))} deg)`);
    if (mode === 'assist') {
      check(peakBank < 15, `${def.short} rudder alone does not roll it past 15 deg in assist mode (${f1(peakBank)} deg)`);
      check(peakAil < 0.95, `${def.short} ailerons can hold the wings level at full rudder (${Math.round(peakAil * 100)}% used)`);
      if (power === 'approach') check(!warn, `${def.short} no stall warning from full rudder at Vref`);
    }
  }

  // ---------- (b) Dutch roll after a rudder doublet ----------
  for (const [mode, floor, halfMax] of [['assist', 0.25, 4], ['direct', 0.12, 8]]) {
    const ac = trimmed(def, vref, C.flap, 'approach');
    const fcs = new FlightControl(ac, { controlMode: 'assist' });
    const inp = mkInp(); inp.trim = ac.input.trim;
    const thr = ac.input.throttle, pitch0 = ac.euler.pitch;
    const ts = [], bs = [];
    for (let i = 0; i < 30 * 60; i++) {
      const t = i * dt;
      const yaw = t < 0.6 ? 0.6 : t < 1.2 ? -0.6 : 0;
      if (mode === 'assist') { inp.yaw = yaw; fcs.update(dt, inp, ac); }
      else {
        ac.input.yaw = yaw;
        ac.input.roll = clamp(-2.0 * ac.euler.roll + 0.5 * ac.omega.z, -1, 1);
        ac.input.pitch = clamp(2.5 * (pitch0 - ac.euler.pitch) - 1.0 * ac.omega.x, -1, 1);
      }
      ac.input.throttle = thr;
      ac.step(dt, calm);
      if (t > 1.4) { ts.push(t); bs.push(ac.aero.beta * RAD); }
    }
    const d = dutchRoll(ts, bs);
    console.log(`  Dutch roll (${mode}): period ${d.period ? f1(d.period) + ' s' : '-'}, zeta ${d.zeta != null ? f2(d.zeta) : '-'}, amplitude halves in ${d.halfT === Infinity ? 'never' : f1(d.halfT) + ' s'} (${d.peaks} swings, first ${f1(d.amp)} deg)`);
    check(d.zeta != null && d.zeta >= floor, `${def.short} Dutch roll damping ratio >= ${floor} in ${mode} mode`);
    check(d.halfT <= halfMax, `${def.short} Dutch roll amplitude halves within ${halfMax} s in ${mode} mode`);
  }

  // ---------- (c) crosswind de-crab: hold the runway heading with rudder, stop the drift with bank ----------
  {
    const xw = C.xwind * KT;
    const env = { wind: (p, t, o) => o.set(xw, 0, 0), ground: flat, carrier: null };   // from the left (west), aircraft heading north
    const ac = trimmed(def, vref, C.flap, 'approach', { x: xw, y: 0, z: 0 });
    const thr0 = ac.input.throttle, pitch0 = ac.euler.pitch;
    let maxStall = 0, yawInt = 0;
    const hs = [], ds = [], rs = [], bs = [], banks = [];
    for (let i = 0; i < 30 * 60; i++) {
      const hdgErr = wrapPi(ac.euler.heading);
      yawInt = clamp(yawInt - 1.0 * hdgErr * dt, -1, 1);   // a pilot holds the nose ON the runway: the integral trims out the weathercock
      ac.input.yaw = clamp(-6.0 * hdgErr - 2.0 * -ac.omega.y + yawInt, -1, 1);   // (a stiffer integral limit-cycles on the jets' 8 s Dutch roll)
      const bankCmd = clamp(-0.06 * ac.vel.x - 0.01 * ac.pos.x, -20 * DEG, 20 * DEG);
      ac.input.roll = clamp(2.5 * (bankCmd - ac.euler.roll) + 0.8 * ac.omega.z, -1, 1);
      ac.input.pitch = clamp(2.5 * (pitch0 - ac.euler.pitch) - 1.0 * ac.omega.x, -1, 1);
      ac.input.throttle = clamp(thr0 + 0.03 * (vref * KT - ac.ias), 0, 1);
      ac.step(dt, env);
      maxStall = Math.max(maxStall, ac.aero.stall);
      if (i >= 25 * 60) { hs.push(ac.euler.heading * RAD); ds.push(ac.vel.x); rs.push(ac.ctl.rudder); bs.push(ac.aero.beta * RAD); banks.push(ac.euler.roll * RAD); }
    }
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const hdg = mean(hs), drift = mean(ds), rud = mean(rs), bank = mean(banks);
    const need = Math.asin(xw / ac.tas) * RAD;
    console.log(`  de-crab ${C.xwind} kt crosswind (last 5 s): heading ${f1(hdg)} deg, drift ${f2(drift)} m/s, beta ${f1(mean(bs))} (needs ${f1(need)}), rudder ${Math.round(rud * 100)}%, bank ${f1(bank)} deg, ias ${f1(ac.ias / KT)} kt`);
    check(Math.abs(hdg) < 1.5 && Math.abs(drift) < 0.6, `${def.short} holds the runway heading with no drift in a ${C.xwind} kt crosswind`);
    check(Math.abs(rud) <= 0.9, `${def.short} has rudder to spare in the de-crab (${Math.round(Math.abs(rud) * 100)}% used)`);
    check(maxStall < 0.1 && Math.abs(bank) < 15, `${def.short} de-crab needs a sane wing-low bank and no stall`);
  }

  // ---------- (d) rudder sign and adverse yaw on a roll input ----------
  {
    let ac = trimmed(def, vref, C.flap, 'level');
    ac.input.yaw = 1;
    for (let i = 0; i < 30; i++) ac.step(dt, calm);
    check(-ac.omega.y > 0.02 && ac.euler.heading > 0 && ac.aero.beta < 0, `${def.short} right pedal -> nose right (r ${f2(-ac.omega.y)} rad/s, beta ${f1(ac.aero.beta * RAD)} deg)`);
    ac = trimmed(def, vref, C.flap, 'approach');
    const fcs = new FlightControl(ac, { controlMode: 'assist' });
    const inp = mkInp(); inp.trim = ac.input.trim;
    const thr = ac.input.throttle;
    let peakBeta = 0;
    for (let i = 0; i < 8 * 60; i++) {
      inp.kbRoll = i < 72 ? 1 : 0;
      fcs.update(dt, inp, ac); ac.input.throttle = thr; ac.step(dt, calm);
      peakBeta = Math.max(peakBeta, Math.abs(ac.aero.beta * RAD));
    }
    check(peakBeta < 13, `${def.short} a 1.2 s full roll input swings the nose less than 13 deg of sideslip (${f1(peakBeta)} deg)`);
  }

  // ---------- (f) Condor: single-engine go-around must stay holdable straight at the challenge's speeds ----------
  if (def.id === 'condor') {
    const ac = new Aircraft(def);
    ac.pos.set(0, 400, 0); ac.stallSign = 1;
    ac.input.gearCmd = 1; ac.ctl.gear = 1;
    ac.trim(0, 135 * KT, 0, 0.75);
    ac.fail('engineLeft');        // left engine dead, right engine to full thrust: the nose wants to go left
    let yawInt = 0, maxStall = 0;
    const hs = [], rs = [], banks = [], rates = [];
    for (let i = 0; i < 25 * 60; i++) {
      const hdgErr = wrapPi(ac.euler.heading);
      yawInt = clamp(yawInt - 1.0 * hdgErr * dt, -1, 1);
      ac.input.yaw = clamp(-6.0 * hdgErr - 2.0 * -ac.omega.y + yawInt, -1, 1);
      const bankCmd = clamp(-0.06 * ac.vel.x - 0.01 * ac.pos.x, -5 * DEG, 5 * DEG);   // up to 5 deg into the live engine
      ac.input.roll = clamp(2.5 * (bankCmd - ac.euler.roll) + 0.8 * ac.omega.z, -1, 1);
      ac.input.pitch = clamp(-0.05 * (135 * KT - ac.ias) - 0.7 * ac.omega.x, -1, 1);   // hold 135 kt with pitch
      ac.input.throttle = 1;
      ac.step(dt, calm);
      maxStall = Math.max(maxStall, ac.aero.stall);
      if (i >= 20 * 60) { hs.push(ac.euler.heading * RAD); rs.push(ac.ctl.rudder); banks.push(ac.euler.roll * RAD); rates.push(-ac.omega.y * RAD); }
    }
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const hdg = mean(hs), rud = mean(rs), bank = mean(banks), rate = mean(rates);
    console.log(`  single-engine go-around at 135 kt (right engine ${Math.round(ac.engines[1].thrust / 1000)} kN, left dead): heading ${f1(hdg)} deg, heading rate ${f2(rate)} deg/s, pedal ${Math.round(rud * 100)}%, bank ${f1(bank)} deg, ias ${f1(ac.ias / KT)} kt`);
    check(Math.abs(hdg) < 2 && Math.abs(rate) < 0.3, `${def.short} holds heading straight on one engine at full thrust at 135 kt`);
    check(rud > 0 && rud <= 0.9, `${def.short} does it with pedal to spare (${Math.round(rud * 100)}% right rudder)`);
    check(Math.abs(bank) <= 5.5 && maxStall < 0.1, `${def.short} wings within 5 deg and no stall in the single-engine hold`);
  }

  // ---------- (e) ground steering ----------
  {
    const ac = new Aircraft(def);
    ac.pos.set(0, def.cgHeight, 0);
    ac.setPose(ac.pos, 0, 0, 0);
    ac.vel.set(0, 0, -15 * KT);
    ac.input.gearCmd = 1; ac.ctl.gear = 1;
    for (let i = 0; i < 3.5 * 60; i++) { ac.input.yaw = i < 30 ? 0 : 0.6; ac.input.throttle = 0; ac.step(dt, calm); }
    // the airliner's pedals only move the nosewheel 8 deg (the tiller is not modelled), so it turns slowly
    check(ac.wheelsOnGround && ac.euler.heading * RAD > 2, `${def.short} right rudder on the runway at 15 kt turns the nose right (${f1(ac.euler.heading * RAD)} deg after 3 s)`);
  }
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
