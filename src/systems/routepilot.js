// Route pilot: flies a mission's `route` (waypoints in the runway frame: over the wires, through the notch, up the
// harbor, between the towers) and then hands the airplane to the stock Autoland for the final approach and landing.
// Autoland (src/systems/autopilot.js) is not edited: it only ever flies a straight line from the aim point, so this
// pilot flies the route, then joins that line (the extended centreline and Autoland's own glide path) and hands
// over once it is established on it.
//
// This is what proves, headless, that an obstacle or city mission can be flown at all (tools/fly-mission.mjs in the
// real page and in Node, tools/test-obstacles.mjs); it is also what game.setAutopilot(true) uses when the scenario
// has a route. It writes ac.input directly, as Autoland does, so it never meets the flight control law (and does
// not care what the flight-physics review does to it).
//
// Route: [{ u, v, alt, kt?, over?, flap?, gear?, bank? }]
//   u, v   runway frame of runways[0] (u metres along the runway from the threshold, negative out on the approach;
//          v metres right of the centreline)
//   alt    the CG's height above the threshold elevation at the waypoint; heights are flown as straight lines
//          between waypoints (the first leg starts where the airplane is)
//   kt     indicated airspeed on the leg TO this waypoint (default Vref plus a per-aircraft margin)
//   over   true: fly over the point before turning (a gate, a notch) instead of cutting the corner
//   flap   flap lever (0..1) from the start of the leg to this waypoint; gear likewise (0 up, 1 down)
//   bank   bank limit on this leg, degrees (default per aircraft); a slalom may ask for more
// After the last waypoint: `join` - L1 onto the extended centreline, and down (or up) onto Autoland's glide path
// (hDes = aim + distance x tan(glideslope) + CG height) at Vref; hand over when lined up (|v| and track error
// small, on the path, on speed, wings level, for three seconds), or at the latest six seconds before the aim point
// or near the flare height (or on touchdown).
//
// The laws:
//   lateral   L1 guidance (lateral acceleration 2 V^2 sin(eta) / L1 toward a point L1 ahead on the line), as a
//             bank angle limited per aircraft, through the same roll and yaw-damper loops as Autoland; fly-by
//             corners lead the turn by R tan(turn / 2);
//   vertical  the route's height as a vertical-speed feed-forward (its slope over the next `la` seconds, so a
//             waypoint's change of slope is flown as a curve that starts just before it) plus kh x the height error,
//             turned into a pitch attitude (flight path + the slowly filtered angle of attack x cos(bank)) plus a
//             proportional and integral term on the flight-path error;
//   speed     throttle PI plus a flight-path feed-forward (it takes thrust to climb), speedbrakes on the Condor
//             when it is fast at idle, stall protection as in Autoland (with a jammed elevator both pitch with the
//             trim alone).
// The handover is what decides the landing: Autoland (not edited) holds the pitch it is handed as its reference and
// flies a proportional pitch loop, so the elevator trim it inherits sets how far its pitch lags in the flare.
//   - The Condor gets the trim a stock approach starts with (main.js spawn(): trimmed at Vref on the glide path with
//     the approach flap), blended in during the join. The route's trim was set at the spawn's 150 kt: Harbor Cranes
//     over ten seeds landed at 383-768 fpm (median 535) with it, and at 189-679 (median 374) with the approach trim,
//     against 283-529 (median 424) for a stock straight-in Autoland in the same wind (2026-09-18).
//   - The Skylark and the Trailblazer keep the spawn's trim: with the approach trim the Skylark landed harder (Power
//     Lines median 196 -> 429 fpm, the same as a stock straight-in) and the Trailblazer floated 150-200 m into the
//     340 m bar instead of about 50 m.
//   - Autoland's own internal state is never written (it used to be handed a pitch reference; ten seeds of each
//     mission landed as well or better without it: The Notch median 485 -> 321 fpm).
// A route engaged mid-flight (the autopilot switched on late) resumes at the leg the airplane is on, by progress
// along the route; at the start of a flight the whole route is flown, even a leg that heads away from the runway.
// Deterministic: no randomness at all.
import { KT, DEG, clamp, wrapPi } from '../config.js';
import { Aircraft } from '../physics/aircraft.js';
import { Autoland } from './autopilot.js';
import { vrefFor } from './scoring.js';

// Per aircraft: bank limit (deg), L1 period (s), pitch loop gains, throttle gains, vertical speed limits (m/s),
// the margin over Vref flown on the route (kt), the approach flap for the final, the join tolerances (lateral
// metres, track degrees, height metres), and apTrim: hand over with the stock approach's trim (see above).
const TUNE = {
  skylark: { bank: 30, L1: 5.0, kp: 3.0, kd: 1.0, kt: 0.06, ki: 0.03, kg: 2.4, down: 5, up: 3.5, extra: 6, flap: 0.667, jv: 6, jt: 5, jh: 4, kh: 0.25, la: 2.5, ta: 3, gp: 1.0, gi: 0.3, apTrim: false },
  trailblazer: { bank: 32, L1: 4.0, kp: 3.0, kd: 1.0, kt: 0.06, ki: 0.03, kg: 2.4, down: 6, up: 3.5, extra: 4, flap: 1, jv: 4, jt: 6, jh: 3, kh: 0.3, la: 2, ta: 3, gp: 1.0, gi: 0.3, apTrim: false },
  condor: { bank: 25, L1: 7.0, kp: 4.5, kd: 2.5, kt: 0.035, ki: 0.012, kg: 2.0, down: 8, up: 7, extra: 12, flap: 0.75, jv: 10, jt: 4, jh: 8, kh: 0.15, la: 3, ta: 4, gp: 1.0, gi: 0.2, apTrim: true },
  hornet: { bank: 30, L1: 6.0, kp: 4.5, kd: 2.5, kt: 0.035, ki: 0.012, kg: 1.5, down: 9, up: 9, extra: 10, flap: 1, jv: 10, jt: 4, jh: 8, kh: 0.2, la: 2.5, ta: 3, gp: 1.0, gi: 0.2, apTrim: false },
};
const TRIM_RATE = 0.05;   // trim units per second while blending to the approach trim in the join
const RESUME_PENALTY = 1500;   // metres added to a leg that runs against the airplane's track when resuming

// The trim a stock approach starts with (main.js spawn(): trimmed at Vref on the glide path with the approach flap),
// from a scratch airframe of the same mass. Computed once, at the start of the join.
function approachTrim(ac, rw, vrefKt, flap) {
  const s = new Aircraft(ac.def, { mass: ac.mass });
  s.pos.set(rw.threshold.x, rw.elevation + 150, rw.threshold.z);
  const gs = rw.gsAngle ? rw.gsAngle * DEG : ac.def.approach.glideslope;
  return s.trim(rw.heading, vrefKt * KT, -gs, flap, null).trim;
}

export class RoutePilot {
  constructor(ac, world, sc) {
    this.ac = ac; this.world = world; this.sc = sc;
    this.def = ac.def;
    this.tune = TUNE[ac.def.id] || TUNE.skylark;
    this.vref = vrefFor(ac, sc);
    this.final = null;
    this.phase = 'route';
    this.t = 0;
    const rw = this.rw = world.runway || null;
    this.wps = [];
    if (rw && Array.isArray(sc.route)) {
      for (const w of sc.route) {
        const v = w.v || 0;
        this.wps.push({
          x: rw.threshold.x + rw.dir.x * w.u + rw.right.x * v, z: rw.threshold.z + rw.dir.z * w.u + rw.right.z * v,
          y: rw.elevation + w.alt, u: w.u, kt: w.kt, over: !!w.over, flap: w.flap, gear: w.gear, bank: w.bank,
        });
      }
      // switched on mid-flight (not at the start of a flight): resume where the airplane is along the route
      if (ac.time > 1) this.wps = this.wps.slice(this.resumeAt());
    }
    this.i = 0;
    this.start = { x: ac.pos.x, z: ac.pos.z, y: ac.pos.y };
    this.thr0 = ac.input.throttle;
    this.g0 = ac.gs > 1 ? Math.atan2(ac.vs, ac.gs) : 0;
    this.alphaF = ac.aero.alpha || 0;
    this.pInt = 0; this.tInt = 0;
    this.trimApp = undefined;                     // the approach trim (apTrim aircraft), computed when the join starts
    this.dbg = { hDes: 0, vsDes: 0, pitchCmd: 0, gDes: 0 };
    if (!rw) this.handOver();                     // the carrier: nothing to route, Autoland flies it
    else if (!this.wps.length) this.phase = 'join';
  }

  // Runway frame of the airplane: { u, v } (reused object).
  uv() {
    const rw = this.rw, p = this.ac.pos, o = this._uv || (this._uv = { u: 0, v: 0 });
    const dx = p.x - rw.threshold.x, dz = p.z - rw.threshold.z;
    o.u = dx * rw.dir.x + dz * rw.dir.z; o.v = dx * rw.right.x + dz * rw.right.z;
    return o;
  }

  // Where to join a route already under way: the index of the first waypoint to fly (wps.length: none, straight to
  // the join). Each candidate costs its horizontal distance plus RESUME_PENALTY x (1 - cos) / 2 of the angle between
  // its direction and the airplane's track (nothing for a leg flown the airplane's way, the whole penalty for one
  // flown against it): the first waypoint itself (the route has not begun), every leg the airplane has not passed the
  // end of (resume at that leg's end), and the join (only once past the last waypoint: the distance to the extended
  // centreline, along the runway heading). The cheapest wins.
  resumeAt() {
    const p = this.ac.pos, w = this.wps, n = w.length, rw = this.rw;
    if (!n) return 0;
    const tx = Math.sin(this.ac.track), tz = -Math.cos(this.ac.track);
    const turn = (dx, dz) => RESUME_PENALTY * (1 - (dx * tx + dz * tz) / (Math.hypot(dx, dz) || 1)) / 2;
    let best = 0, bestCost = Math.hypot(w[0].x - p.x, w[0].z - p.z) + turn(w[0].x - p.x, w[0].z - p.z);
    let past = n === 1 && (w[0].x - p.x) * tx + (w[0].z - p.z) * tz < 0;
    for (let j = 1; j < n; j++) {
      const a = w[j - 1], b = w[j];
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
      const s = ((p.x - a.x) * dx + (p.z - a.z) * dz) / L;
      if (s >= L) { if (j === n - 1) past = true; continue; }
      const c = Math.max(s, 0) / L;
      const cost = Math.hypot(a.x + dx * c - p.x, a.z + dz * c - p.z) + turn(dx, dz);
      if (cost < bestCost) { bestCost = cost; best = j; }
    }
    if (past) {
      const { v } = this.uv();
      if (Math.abs(v) + turn(rw.dir.x, rw.dir.z) < bestCost) best = n;
    }
    return best;
  }

  handOver() {
    const ac = this.ac, inp = ac.input;
    inp.spoiler = 0;
    if (this.def.spoilers && !this.world.carrier) inp.spoilerArmed = true;
    if (this.def.gearRetract) inp.gearCmd = 1;
    if (inp.flapCmd < this.tune.flap - 1e-3 && !ac.failures.has('flapsStuck')) inp.flapCmd = this.tune.flap;
    if (this.trimApp != null && !ac.failures.has('elevatorJam') && !ac.onGround) inp.trim = this.trimApp;
    // Autoland takes the airplane as it is (its pitch reference is the pitch this instant): the join makes that a
    // steady state on its glide path, and nothing inside Autoland is written.
    this.final = new Autoland(ac, this.world, this.sc);
    this.phase = 'final';
  }

  update(dt) {
    this.t += dt;
    if (this.final) { this.final.update(dt); return; }
    const ac = this.ac;
    if (ac.onGround || ac.stats.touchdown) { this.handOver(); this.final.update(dt); return; }
    if (this.phase === 'join') { this.join(dt); return; }
    const T = this.tune, wps = this.wps, n = wps.length;
    // the active leg: from the previous waypoint (or where the airplane was when the route started) to wps[i];
    // it is done once the airplane's projection onto it passes its end
    let A, B, L, dx, dz, s;
    for (;;) {
      A = this.i === 0 ? this.start : wps[this.i - 1]; B = wps[this.i];
      dx = B.x - A.x; dz = B.z - A.z; L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
      s = (ac.pos.x - A.x) * dx + (ac.pos.z - A.z) * dz;
      if (s < L) break;
      this.i++;
      if (this.i >= n) { this.phase = 'join'; this.join(dt); return; }
    }
    // the lateral target: L1 metres ahead along the route from the airplane's projection, carried round a fly-by
    // corner onto the next leg (so the turn starts early and flies a smooth arc), held on the leg's own line past
    // a fly-over waypoint or the last one
    const V = Math.max(ac.gs, 15), L1 = clamp(T.L1 * V, 45, 650);
    const e = (ac.pos.x - A.x) * -dz + (ac.pos.z - A.z) * dx;
    let rem = Math.max(Math.sqrt(Math.max(L1 * L1 - e * e, 0)), 0.3 * L1);
    let k = this.i, ss = s, a = A, b = B, ll = L, ux = dx, uz = dz;
    for (;;) {
      if (ss + rem <= ll || b.over || k === n - 1) break;
      rem -= Math.max(0, ll - ss); k++; ss = 0;
      a = b; b = wps[k]; ux = b.x - a.x; uz = b.z - a.z; ll = Math.hypot(ux, uz) || 1; ux /= ll; uz /= ll;
    }
    const tgt = this._tgt || (this._tgt = { x: 0, z: 0 });
    tgt.x = a.x + ux * (ss + rem); tgt.z = a.z + uz * (ss + rem);
    // the vertical target: the route's height (straight lines between the waypoints) here and `la` seconds ahead,
    // so a change of slope at a waypoint is flown as a curve that starts just before it
    const hNow = A.y + (B.y - A.y) * clamp(s / L, 0, 1);
    let rh = V * T.la, hA;
    for (k = this.i, ss = Math.max(s, 0), a = A, b = B, ll = L; ;) {
      if (ss + rh <= ll || k === n - 1) { hA = a.y + (b.y - a.y) * clamp((ss + rh) / ll, 0, 1); break; }
      rh -= Math.max(0, ll - ss); k++; ss = 0;
      a = b; b = wps[k]; ll = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    }
    this.steer(dt, tgt, hNow, (hA - hNow) / T.la, (B.kt || this.vref + T.extra) * KT, B.bank || T.bank);
    // configuration: what the leg asks for
    const inp = ac.input;
    if (B.flap != null && !ac.failures.has('flapsStuck')) inp.flapCmd = B.flap;
    if (B.gear != null && this.def.gearRetract) inp.gearCmd = B.gear;
  }

  // After the route: onto the extended centreline and Autoland's glide path, then hand over - once the airplane has
  // been lined up, on the path, on speed and wings level for a couple of seconds (Autoland keeps the pitch and the
  // throttle it is handed as its references, so a steady handover is a smooth one). At the latest six seconds
  // before the aim point, or when the flare height is near.
  join(dt) {
    const ac = this.ac, rw = this.rw, T = this.tune, def = this.def;
    const { u, v } = this.uv();
    const gs = rw.gsAngle ? rw.gsAngle * DEG : def.approach.glideslope;
    const dToAim = rw.aimDistance - u;
    const hDes = rw.aim.y + Math.max(0, dToAim) * Math.tan(gs) + def.cgHeight;
    const trkErr = Math.abs(wrapPi(ac.track - rw.heading)) / DEG;
    const vsPath = -Math.max(ac.gs, 15) * Math.tan(gs);
    const lined = Math.abs(v) < T.jv && trkErr < T.jt && Math.abs(ac.pos.y - hDes) < T.jh && Math.abs(ac.euler.roll) < 5 * DEG &&
      Math.abs(ac.vs - vsPath) < 0.8 && Math.abs(ac.omega.x) < 0.02 && Math.abs(ac.ias - this.vref * KT) < 6 * KT;
    this.steady = lined ? (this.steady || 0) + dt : 0;
    const late = dToAim < 6 * Math.max(ac.gs, 15) || ac.radioAlt < 2 * Math.max(def.approach.flareHeight, 2);
    if (this.steady > 3 || late) { this.handOver(); this.final.update(dt); return; }
    // the lateral target: L1 ahead on the extended centreline
    const V = Math.max(ac.gs, 15), L1 = clamp(T.L1 * V, 45, 650);
    const tgt = this._tgt || (this._tgt = { x: 0, z: 0 });
    const along = u + Math.max(Math.sqrt(Math.max(L1 * L1 - v * v, 0)), 0.3 * L1);
    tgt.x = rw.threshold.x + rw.dir.x * along; tgt.z = rw.threshold.z + rw.dir.z * along;
    this.steer(dt, tgt, hDes, dToAim > 0 ? -V * Math.tan(gs) : 0, this.vref * KT, T.bank);
    const inp = ac.input;
    if (def.gearRetract) inp.gearCmd = 1;
    if (inp.flapCmd < T.flap - 1e-3 && !ac.failures.has('flapsStuck')) inp.flapCmd = T.flap;
    // the approach trim (apTrim aircraft), blended in while the airplane settles onto the path
    if (this.trimApp === undefined) this.trimApp = T.apTrim ? approachTrim(ac, rw, this.vref, ac.failures.has('flapsStuck') ? ac.ctl.flap : T.flap) : null;
    if (this.trimApp != null && !ac.failures.has('elevatorJam')) inp.trim += clamp(this.trimApp - inp.trim, -TRIM_RATE * dt, TRIM_RATE * dt);
  }

  // One step of the three laws: steer for the point `tgt` ({ x, z }: pure pursuit, the lateral acceleration
  // 2 V^2 sin(eta) / distance), hold the path's height hDes with vsPath (m/s) as the feed-forward and kh as the
  // correction, fly vT (m/s indicated), bank at most bankLim degrees.
  steer(dt, tgt, hDes, vsPath, vT, bankLim) {
    const ac = this.ac, inp = ac.input, def = this.def, T = this.tune;
    const V = Math.max(ac.gs, 15);
    // ---- lateral
    const tx = tgt.x - ac.pos.x, tz = tgt.z - ac.pos.z, dist = Math.max(Math.hypot(tx, tz), 20);
    const eta = wrapPi(Math.atan2(tx, -tz) - ac.track);
    const bl = bankLim * DEG;
    const bankCmd = clamp(Math.atan(2 * V * V * Math.sin(eta) / (dist * 9.81)), -bl, bl);
    inp.roll = clamp(2.5 * (bankCmd - ac.euler.roll) + 0.8 * ac.omega.z, -1, 1);
    inp.yaw = clamp(1.5 * ac.aero.beta, -1, 1);
    // ---- vertical: the line's height, with its slope as the feed-forward. The pitch attitude is the wanted flight
    // path plus the trim angle of attack (filtered slowly: a fast filter follows the airplane's own pitching and
    // turns the loop into an oscillator), plus a proportional and integral term on the flight-path error.
    const vsDes = clamp(vsPath + T.kh * (hDes - ac.pos.y), -T.down, T.up);
    const tas = Math.max(ac.tas, 15);
    const gDes = Math.asin(clamp(vsDes / tas, -0.45, 0.45)), gam = Math.asin(clamp(ac.vs / tas, -0.9, 0.9));
    this.alphaF += (ac.aero.alpha - this.alphaF) * Math.min(1, dt / T.ta);
    const gErr = gDes - gam;
    this.pInt = clamp(this.pInt + T.gi * gErr * dt, -0.1, 0.1);
    let pitchCmd = gDes + this.alphaF * Math.cos(ac.euler.roll) + T.gp * gErr + this.pInt;
    // ---- speed
    const err = vT - ac.ias;
    this.tInt = clamp(this.tInt + T.ki * err * dt, -0.6, 0.6);
    let thr = clamp(this.thr0 + T.kt * err + this.tInt + T.kg * (gDes - this.g0), 0, 1);
    if (def.spoilers) inp.spoiler = thr < 0.03 && err < -8 * KT ? 1 : 0;
    // ---- protection, as Autoland
    if (ac.aero.alpha > ac.aero.alphaStall - 3 * DEG) pitchCmd = Math.min(pitchCmd, ac.euler.pitch - 2 * DEG);
    if (ac.ias < this.vref * KT * 0.93) thr = Math.max(thr, 0.8);
    inp.throttle = thr;
    if (ac.failures.has('elevatorJam')) {
      // pitch with the trim alone, as Autoland does
      inp.pitch = 0;
      inp.trim = clamp(inp.trim + 0.4 * (pitchCmd - ac.euler.pitch) * dt - 0.2 * ac.omega.x * dt, -1, 1);
    } else {
      inp.pitch = clamp(T.kp * (pitchCmd - ac.euler.pitch) - T.kd * ac.omega.x, -1, 1);
    }
    const dbg = this.dbg;   // (for tools/fly-mission.mjs --track --debug; one object, reused every frame)
    dbg.hDes = hDes; dbg.vsDes = vsDes; dbg.pitchCmd = pitchCmd; dbg.gDes = gDes;
  }
}
