// Landing evaluation: points, grade, and the debrief line items.
import { KT, FT, FPM, RAD, clamp } from '../config.js';

export const GRADES = ['GREASED', 'SMOOTH', 'FIRM', 'HARD', 'DAMAGED', 'CRASH'];
export const CARRIER_GRADES = ['OK (underline)', 'OK', 'FAIR', 'NO GRADE', 'CUT', 'CRASH'];

function line(k, v, cls) { return { k, v, cls: cls || '' }; }

// Reference speed for the actual weight (Vref scales with the square root of mass)
export function vrefFor(ac, sc) {
  if (sc && sc.scoring && sc.scoring.vref) return sc.scoring.vref;
  return Math.round(ac.def.speeds.Vref * Math.sqrt(ac.mass / ac.def.mass));
}
const fpm = (vs) => Math.round(vs / FPM);

export function scoreLanding(ac, sc, approach) {
  const def = ac.def;
  const type = sc.scoring.type;
  const lines = [];
  let pts = 100;
  const st = ac.stats;
  const td = st.touchdown;
  const pen = (n, k, v, why) => { pts -= n; lines.push(line(k, v + (why ? `  (${why > 0 ? '-' : '+'}${Math.abs(why)})` : ''), n > 12 ? 'bad' : n > 0 ? 'warn' : 'good')); };

  if (ac.crashed) {
    lines.push(line('Result', 'CRASHED: ' + ac.crashReason, 'bad'));
    if (td) lines.push(line('Touchdown sink', fpm(td.vs) + ' fpm', 'bad'));
    if (st.stalls) lines.push(line('Stalls', String(st.stalls), 'bad'));
    return { points: 0, grade: type === 'carrier' ? CARRIER_GRADES[5] : 'CRASH', gradeIdx: 5, lines, headline: 'Crashed' };
  }
  if (!td) {
    lines.push(line('Result', 'Flight ended before touchdown', 'warn'));
    return { points: 0, grade: 'INCOMPLETE', gradeIdx: 4, lines, headline: 'No landing' };
  }

  if (type === 'carrier') return scoreCarrier(ac, sc, approach, lines);

  // ---- runway / bush ----
  const rw = approach.runway;
  const u = approach.tdU, v = approach.tdV;
  const lim = def.limits;
  const vs = td.vs;
  // sink rate
  let p = 0;
  if (vs <= lim.smoothVS) p = 0;
  else if (vs <= lim.firmVS) p = ((vs - lim.smoothVS) / (lim.firmVS - lim.smoothVS)) * 10;
  else if (vs <= lim.hardVS) p = 10 + ((vs - lim.firmVS) / (lim.hardVS - lim.firmVS)) * 20;
  else p = 30 + Math.min(20, (vs - lim.hardVS) * 8);
  pen(Math.round(p), 'Touchdown sink rate', `${fpm(vs)} fpm` + (vs <= lim.smoothVS * 0.6 ? '  greased it!' : vs <= lim.smoothVS ? '  smooth' : vs <= lim.firmVS ? '  firm' : vs <= lim.hardVS ? '  hard' : '  very hard'), Math.round(p));
  // position along the runway
  const aim = rw.aimDistance;
  const tol = type === 'bush' ? 25 : def.id === 'condor' ? 200 : 120;
  const along = u - aim;
  if (u < 0) pen(40, 'Touchdown point', `${Math.round(-u)} m SHORT of the runway`, 40);
  else if (u > rw.length) pen(50, 'Touchdown point', 'beyond the runway end', 50);
  else {
    const over = Math.max(0, Math.abs(along) - tol);
    const pp = Math.min(25, Math.round(over / (type === 'bush' ? 4 : 12)));
    pen(pp, 'Touchdown point', `${Math.round(u)} m from the threshold (${along >= 0 ? '+' : ''}${Math.round(along)} m from the aiming point)`, pp);
  }
  // centreline
  const ctol = def.id === 'condor' ? 3 : 2;
  const off = Math.abs(v);
  if (off > rw.width / 2) pen(30, 'Centerline', `${off.toFixed(1)} m off: OFF THE RUNWAY EDGE`, 30);
  else { const pp = Math.min(20, Math.round(Math.max(0, off - ctol) * 2.5)); pen(pp, 'Centerline', `${off.toFixed(1)} m ${v > 0 ? 'right' : 'left'}`, pp); }
  // side load / crab
  const side = Math.abs(td.vlat);
  { const pp = Math.min(25, Math.round(Math.max(0, side - 0.8) * 6)); pen(pp, 'Side load (crab)', `${(side / KT).toFixed(1)} kt drift` + (side > 3 ? '  tires screaming' : side > 1.5 ? '  scrubbed' : '  clean'), pp); }
  // bank
  const bank = Math.abs(td.roll * RAD);
  { const pp = Math.min(15, Math.round(Math.max(0, bank - 4) * 2)); pen(pp, 'Bank at touchdown', `${bank.toFixed(1)}°`, pp); }
  // speed
  const vref = vrefFor(ac, sc);
  const dv = td.ias / KT - vref;
  { const pp = Math.min(15, Math.round(Math.max(0, Math.abs(dv) - (def.id === 'trailblazer' ? 4 : 7)))); pen(pp, 'Speed at touchdown', `${(td.ias / KT).toFixed(0)} kt (Vref ${vref}, ${dv >= 0 ? '+' : ''}${dv.toFixed(0)})`, pp); }
  // attitude
  const noseFirst = td.legs.includes('nose') && !td.legs.some((l) => l === 'left' || l === 'right');
  if (noseFirst) pen(15, 'Attitude', 'NOSE WHEEL FIRST', 15);
  else if (def.id === 'trailblazer') {
    const three = td.legs.includes('tail');
    lines.push(line('Attitude', three ? 'Three-point landing' : 'Wheel landing', 'good'));
  } else lines.push(line('Attitude', `${(td.pitch * RAD).toFixed(1)}° pitch, mains first`, 'good'));
  if (st.tailstrike) pen(20, 'Damage', 'TAIL STRIKE', 20);
  if (st.propstrike) pen(30, 'Damage', 'PROPELLER STRIKE', 30);
  if (st.wingtip) pen(20, 'Damage', 'Wingtip scraped', 20);
  if (st.gearCollapse) pen(40, 'Damage', 'GEAR COLLAPSED', 40);
  if (st.belly) {
    if (sc.scoring.noseGear) {
      const noseTd = st.touchdowns.find((t) => t.body.includes('nose')) || null;
      const spd = approach.noseDownSpeed;
      const pp = spd == null ? 5 : Math.min(15, Math.round(Math.max(0, spd / KT - 80) / 3));
      pen(pp, 'Nose held off until', spd == null ? 'unknown' : `${(spd / KT).toFixed(0)} kt` + (spd / KT < 85 ? '  well done' : ''), pp);
      void noseTd;
    } else pen(50, 'Damage', 'BELLY LANDING (gear up)', 50);
  }
  if (st.bounces) pen(Math.min(24, st.bounces * 8), 'Bounces', String(st.bounces), Math.min(24, st.bounces * 8));
  // stalls
  const stalls = sc.scoring.stallStart ? Math.max(0, st.stalls - 1) : st.stalls;
  if (stalls) pen(Math.min(30, stalls * 15), 'Stalls on approach', String(stalls), Math.min(30, stalls * 15));
  else if (st.stallWarnTime > 2 && !sc.scoring.stallStart) pen(5, 'Stall warning', `${st.stallWarnTime.toFixed(1)} s of horn`, 5);
  // rollout
  if (approach.offRunway) pen(30, 'Rollout', 'LEFT THE RUNWAY', 30);
  else if (approach.overran) pen(40, 'Rollout', 'OVERRAN THE END', 40);
  else lines.push(line('Rollout', `stopped ${Math.round(approach.stopU)} m from the threshold, ${Math.round(rw.length - approach.stopU)} m remaining`, 'good'));
  if (st.goArounds) pen(st.goArounds * 5, 'Go-arounds', String(st.goArounds), st.goArounds * 5);
  // approach quality bonuses
  if (approach.gsSamples > 20) {
    const gsq = approach.gsErr / approach.gsSamples, lq = approach.locErr / approach.gsSamples, sq = approach.spdErr / approach.gsSamples / KT;
    const stable = gsq < 0.6 && lq < 0.6;
    lines.push(line('Approach', `glideslope ±${gsq.toFixed(1)} dots, lineup ±${lq.toFixed(1)} dots, speed ±${sq.toFixed(0)} kt` + (stable ? '  stable (+5)' : ''), stable ? 'good' : ''));
    if (stable) pts += 5;
    if (sq < 3) { pts += 3; lines.push(line('Speed control', 'within 3 kt (+3)', 'good')); }
  }
  if (sc.failures && sc.failures.length) { pts += 5; lines.push(line('Malfunction handled', sc.failures.map((f) => f.name).join(', ') + ' (+5)', 'good')); }
  pts = clamp(Math.round(pts), 0, 100);
  let gi;
  const realDamage = st.damage.filter((d) => !(sc.scoring.noseGear && d === 'Nose damage'));
  if (realDamage.length) gi = pts >= 45 ? 3 : 4;
  else gi = pts >= 92 ? 0 : pts >= 80 ? 1 : pts >= 65 ? 2 : pts >= 45 ? 3 : 4;
  if (vs > lim.hardVS && gi < 3) gi = 3;
  else if (vs > lim.firmVS && gi < 2) gi = 2;
  else if (vs > lim.smoothVS && gi < 1) gi = 1;
  const headline = gi === 0 ? 'Greased it. They did not even feel it.' : gi === 1 ? 'Smooth. Passengers are clapping.' : gi === 2 ? 'Firm but fine. That is a landing.' : gi === 3 ? 'That was a hard one. Inspection required.' : 'The airplane is bent.';
  return { points: pts, grade: GRADES[gi], gradeIdx: gi, lines, headline };
}

function scoreCarrier(ac, sc, ap, lines) {
  const st = ac.stats;
  const tr = ac.trap;
  let pts = 100;
  const pen = (n, k, v) => { pts -= n; lines.push(line(k, v + (n ? `  (-${n})` : ''), n > 12 ? 'bad' : n > 0 ? 'warn' : 'good')); };
  if (!tr.trapped) {
    lines.push(line('Result', tr.boltered ? 'Bolter: no wire' : 'Did not trap', 'bad'));
    if (st.touchdown) lines.push(line('Touchdown sink', fpm(st.touchdown.vs) + ' fpm', ''));
    return { points: 20, grade: 'BOLTER', gradeIdx: 4, lines, headline: 'No trap. Hook skip or too long.' };
  }
  const w = tr.wire;
  const wp = w === 3 ? 0 : w === 2 || w === 4 ? 10 : 25;
  pen(wp, 'Wire', `${w}-wire` + (w === 3 ? '  target' : w === 1 ? '  dangerously close to the ramp' : w === 4 ? '  long' : '  a little low'));
  if (ap.carrierSamples > 10) {
    const gs = ap.ballErr / ap.carrierSamples, lu = ap.lineupErr / ap.carrierSamples, aoa = ap.aoaErr / ap.carrierSamples;
    pen(Math.min(20, Math.round(Math.max(0, gs - 0.5) * 10)), 'Glideslope (ball)', `average ${gs.toFixed(1)} cells off` + (gs < 0.5 ? '  on the ball' : ''));
    pen(Math.min(15, Math.round(Math.max(0, lu - 3) * 2)), 'Lineup', `average ${lu.toFixed(1)} m off centerline`);
    pen(Math.min(15, Math.round(Math.max(0, aoa - 0.7) * 4)), 'Angle of attack', `average ${aoa.toFixed(1)}° from on-speed`);
    if (ap.lowAtRamp) pen(15, 'At the ramp', 'LOW: hook-to-ramp clearance under 2 m');
  }
  const td = st.touchdown;
  if (td && td.vs > ac.def.limits.hardVS) pen(10, 'Touchdown sink', `${fpm(td.vs)} fpm  hard even for a carrier`);
  else if (td) lines.push(line('Touchdown sink', `${fpm(td.vs)} fpm`, 'good'));
  if (Math.abs(td?.roll * RAD || 0) > 6) pen(8, 'Wings', `${(td.roll * RAD).toFixed(0)}° bank at touchdown`);
  if (st.bounces) pen(st.bounces * 5, 'Bounces', String(st.bounces));
  if (ac.stats.goArounds) pen(ac.stats.goArounds * 15, 'Bolters / wave-offs', String(ac.stats.goArounds));
  if (st.damage.length) pen(20, 'Damage', st.damage.join(', '));
  pts = clamp(Math.round(pts), 0, 100);
  const gi = pts >= 95 ? 0 : pts >= 85 ? 1 : pts >= 70 ? 2 : pts >= 50 ? 3 : 4;
  const headline = gi === 0 ? 'OK underline. The LSO has nothing to say.' : gi === 1 ? 'OK pass. Nice trap.' : gi === 2 ? 'Fair. A few deviations, but a safe pass.' : gi === 3 ? 'No grade. That was ugly but you are aboard.' : 'Cut pass. Unsafe deviations inside the wires.';
  return { points: pts, grade: CARRIER_GRADES[gi], gradeIdx: gi, lines, headline };
}
