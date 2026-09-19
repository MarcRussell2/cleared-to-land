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
// Route: [{ u, v, alt, kt?, over?, flap?, gear?, bank?, arc?, r? }]
//   u, v   runway frame of runways[0] (u metres along the runway from the threshold, negative out on the approach;
//          v metres right of the centreline)
//   alt    the CG's height above the threshold elevation at the waypoint; heights are flown as straight lines
//          between waypoints (the first leg starts where the airplane is)
//   kt     indicated airspeed on the leg TO this waypoint (default Vref plus a per-aircraft margin)
//   over   true: fly over the point before turning (a gate, a notch) instead of cutting the corner
//   flap   flap lever (0..1) from the start of the leg to this waypoint; gear likewise (0 up, 1 down)
//   bank   bank limit on this leg, degrees (default per aircraft; an arc leg's default is 20 more)
//   arc    'L' | 'R': the leg TO this waypoint is a circular arc of radius r (metres) turning that way (the shorter
//          arc from the previous waypoint; design the legs either side tangent to it). An arc is flown on its own
//          law (below), not pure pursuit: the Needle's eye leaves the airliner a 5.8 m window at 40 degrees of bank.
// After the last waypoint: `join` - L1 onto the extended centreline, and down (or up) onto Autoland's glide path
// (hDes = aim + distance x tan(glideslope) + CG height) at Vref; hand over when lined up (|v| and track error
// small, on the path, on speed, wings level, for three seconds), or at the latest six seconds before the aim point
// or near the flare height (or on touchdown).
//
// The laws:
//   lateral   L1 guidance (lateral acceleration 2 V^2 sin(eta) / L1 toward a point L1 ahead on the line), as a
//             bank angle limited per aircraft, through the same roll and yaw-damper loops as Autoland; fly-by
//             corners lead the turn by R tan(turn / 2) (never onto an arc: the target is held on the line up to it);
//   arcs      (the city's turns, 2026-09-19; reworked 2026-09-18 after review) the bank the radius needs at this
//             ground speed, atan(V^2 / g r), plus a correction for being off the circle (ARC_LAW: k per metre
//             outside, kd per m/s drifting outward, an integral), started ahead of the arc by ARC_LAW.half of the roll
//             (at the rate below) and the roll's lag (TUNE.rollLag), on the feed-forward alone until the arc begins.
//             The arc's own roll loop: a bank reference moved toward that command at no more than ARC_LAW.rate (15
//             degrees a second, a roll the airliner can follow), tracked stiffly with its roll rate fed forward and an
//             integral near it. The stock loop (the one Autoland uses) let a roll to 40 degrees overshoot to 46 and
//             creep back over five seconds, and the path loop chased the swing: with it the Needle's eye was passed
//             off by up to 2 m and bank 30-38 instead of 36 (one seed in thirty hit the tower). Also a firmer turn
//             coordinator (a quick roll to 35 degrees in the airliner skidded 5 degrees on the stock gain), and the
//             pull the turn needs fed forward and closed on the load factor (TUNE.nStick: the stick per extra g; the
//             attitude loop alone only pulled once the airplane sank). A route ending in an arc hands over to the
//             join half a roll early, so the roll-out ends on the centerline. Measured on the Needle's 40-degree arc
//             (its 34 m gap) over 100 seeds: the eye passed every time, 1.7 m to spare at the closest (median 2.3),
//             bank 37-42 there; the Gauntlet's, in 18-kt gusts: every time, 1.1 m at the closest (median 1.8); switched
//             off and on 300 m before the eye, 20 seeds of 20, 1.0 m at the closest. The gains are the Condor's; the
//             others get them scaled by their roll rate, unproven on arcs;
//   vertical  the route's height as a vertical-speed feed-forward (its slope over the next `la` seconds, so a
//             waypoint's change of slope is flown as a curve that starts just before it) plus kh x the height error,
//             turned into a pitch attitude (flight path + the slowly filtered 1-g angle of attack, alpha x cos(bank),
//             which is the attitude of a level turn whatever the bank) plus a proportional and integral term on the
//             flight-path error; the pitch damper leaves alone the steady nose-up rate of a banked turn. (Those two
//             were added for the city's arcs but act on every leg: they moved Harbor Cranes' seed-307 landing from 93
//             points to 92 and seed 4271's from 64 to 63, and nothing else the suite flies;)
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
// along the route (an arc measured along its own circle); at the start of a flight the whole route is flown, even a
// leg that heads away from the runway. Resumed inside an arc, the arc keeps its circle (tools/test-city.mjs switches
// the autopilot off and on 300 m before the Needle's eye, in the bank, and it must still go through), and a pilot
// switched on mid-flight starts bumpless: its pitch and throttle integrals start where the airplane already is.
// Deterministic: no randomness at all.
import { KT, DEG, clamp, wrapPi } from '../config.js';
import { Aircraft } from '../physics/aircraft.js';
import { Autoland } from './autopilot.js';
import { vrefFor } from './scoring.js';

// Per aircraft: bank limit (deg), L1 period (s), pitch loop gains, throttle gains, vertical speed limits (m/s),
// the margin over Vref flown on the route (kt), the approach flap for the final, the join tolerances (lateral
// metres, track degrees, height metres), apTrim: hand over with the stock approach's trim (see above), roll: the
// rate it rolls at full aileron on the approach (deg/s, measured) and how long the roll takes to start (s), for
// leading into and out of arcs, and nStick: the
// stick it takes to pull one more g on the approach (measured over the first two seconds of a step, at 150 / 68 kt).
const TUNE = {
  skylark: { bank: 30, L1: 5.0, kp: 3.0, kd: 1.0, kt: 0.06, ki: 0.03, kg: 2.4, down: 5, up: 3.5, extra: 6, flap: 0.667, jv: 6, jt: 5, jh: 4, kh: 0.25, la: 2.5, ta: 3, gp: 1.0, gi: 0.3, apTrim: false, roll: 40, rollLag: 0.2, nStick: 0.35 },
  trailblazer: { bank: 32, L1: 4.0, kp: 3.0, kd: 1.0, kt: 0.06, ki: 0.03, kg: 2.4, down: 6, up: 3.5, extra: 4, flap: 1, jv: 4, jt: 6, jh: 3, kh: 0.3, la: 2, ta: 3, gp: 1.0, gi: 0.3, apTrim: false, roll: 45, rollLag: 0.2, nStick: 0.35 },
  condor: { bank: 25, L1: 7.0, kp: 4.5, kd: 2.5, kt: 0.035, ki: 0.012, kg: 2.0, down: 8, up: 7, extra: 12, flap: 0.75, jv: 10, jt: 4, jh: 8, kh: 0.15, la: 3, ta: 4, gp: 1.0, gi: 0.2, apTrim: true, roll: 17, rollLag: 0.5, nStick: 0.75 },
  hornet: { bank: 30, L1: 6.0, kp: 4.5, kd: 2.5, kt: 0.035, ki: 0.012, kg: 1.5, down: 9, up: 9, extra: 10, flap: 1, jv: 10, jt: 4, jh: 8, kh: 0.2, la: 2.5, ta: 3, gp: 1.0, gi: 0.2, apTrim: false, roll: 60, rollLag: 0.2, nStick: 0.3 },
};
const TRIM_RATE = 0.05;   // trim units per second while blending to the approach trim in the join
const RESUME_PENALTY = 1500;   // metres added to a leg that runs against the airplane's track when resuming
// Arc legs (the city's turns): the cross-track law's gains - bank (rad) per metre outside the arc (k), per m/s of
// drift outward (kd), the integral's rate and limit (ki, iMax) - the least lead (s) into or out of an arc, the turn
// coordinator (yaw per rad of sideslip, rudder per aileron), the load-factor loop (kn), and the arc's roll loop: the
// bank reference's most rate (deg/s) and approach gain (kr, 1/s), the share of the aircraft's own roll rate fed
// forward (ffk: the Condor rolls about 28 degrees a second per unit of aileron at 150 kt, not the 17 its full roll
// averages), the stiffness on the reference (rk per rad, rd per rad/s, ri per rad s), and the lead into an arc as a
// share of the roll (half) and of the roll's lag (lag). One object, read as the airplane flies: the tuning harnesses
// change it in place.
export const ARC_LAW = { k: 0.012, kd: 0.05, ki: 0.0025, iMax: 5 * DEG, lead: 0.5, yaw: 5, yawFF: 0.15, pullLead: 0, kn: 3, rate: 15, kr: 1.5, ffk: 0.5, rk: 10, rd: 4, ri: 4, half: 0.4, lag: 1 };
const G = 9.81;

// A leg from A ({x, z, y}) to the waypoint B: a straight line, or (B.arc 'L' / 'R') the circular arc of radius B.r
// turning that way from A to B (the shorter arc; a radius under half the chord is raised to it). L is its length;
// at(s, out) the point s metres along it; proj(x, z, out) = { s: progress, e: cross-track error (metres right of a
// line; metres outside an arc) }.
function makeLeg(A, B) {
  const dx = B.x - A.x, dz = B.z - A.z, c = Math.hypot(dx, dz) || 1;
  if (!B.arc) {
    const ux = dx / c, uz = dz / c;
    return {
      arc: 0, A, B, L: c, ux, uz,
      at(s, o) { o.x = A.x + ux * s; o.z = A.z + uz * s; return o; },
      proj(x, z, o) { o.s = (x - A.x) * ux + (z - A.z) * uz; o.e = (x - A.x) * -uz + (z - A.z) * ux; return o; },
    };
  }
  // world x/z: heading 0 is -z, a right turn winds the angle atan2(z - cz, x - cx) upward (sgn +1)
  const sgn = B.arc === 'R' ? 1 : -1, r = Math.max(B.r || 1000, c / 2 + 1e-3);
  const hh = Math.sqrt(Math.max(r * r - c * c / 4, 0));
  const cx = (A.x + B.x) / 2 + sgn * hh * (-dz / c), cz = (A.z + B.z) / 2 + sgn * hh * (dx / c);
  const th0 = Math.atan2(A.z - cz, A.x - cx), th1 = Math.atan2(B.z - cz, B.x - cx);
  const sweep = ((sgn * (th1 - th0)) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  const mid = th0 + sgn * sweep / 2;
  return {
    arc: sgn, A, B, L: r * sweep, cx, cz, r,
    at(s, o) { const th = th0 + sgn * s / r; o.x = cx + r * Math.cos(th); o.z = cz + r * Math.sin(th); return o; },
    // progress measured from the arc's middle, so it is continuous everywhere except opposite that
    proj(x, z, o) { o.s = (sgn * wrapPi(Math.atan2(z - cz, x - cx) - mid) + sweep / 2) * r; o.e = Math.hypot(x - cx, z - cz) - r; return o; },
  };
}

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
    let from = null;   // where the first leg starts, when not at the airplane (an arc resumed into)
    if (rw && Array.isArray(sc.route)) {
      for (const w of sc.route) {
        const v = w.v || 0;
        this.wps.push({
          x: rw.threshold.x + rw.dir.x * w.u + rw.right.x * v, z: rw.threshold.z + rw.dir.z * w.u + rw.right.z * v,
          y: rw.elevation + w.alt, u: w.u, kt: w.kt, over: !!w.over, flap: w.flap, gear: w.gear, bank: w.bank,
          arc: w.arc === 'L' || w.arc === 'R' ? w.arc : null, r: w.r,
        });
      }
      // switched on mid-flight (not at the start of a flight): resume where the airplane is along the route. A
      // straight leg resumed into runs from the airplane; an ARC keeps its own circle - its leg still runs from the
      // waypoint before it - and the arc law closes whatever offset the airplane has from it (a chord from the
      // airplane to the arc's end cuts inside the circle: 40 m inside it on the Needle's turn, into the inner tower).
      if (ac.time > 1) {
        const k = this.resumeAt();
        if (k > 0 && k < this.wps.length && this.wps[k].arc) from = this.wps[k - 1];
        this.wps = this.wps.slice(k);
      }
    }
    this.i = 0;
    this.start = from ? { x: from.x, z: from.z, y: from.y } : { x: ac.pos.x, z: ac.pos.z, y: ac.pos.y };
    this.legs = [];                               // makeLeg() for each leg, built as the route is flown
    this._pr = { s: 0, e: 0 }; this._pt = { x: 0, z: 0 };
    this.eInt = 0;                                // the arc law's integral (rad)
    this.thr0 = ac.input.throttle;
    this.g0 = ac.gs > 1 ? Math.atan2(ac.vs, ac.gs) : 0;
    // (the 1-g angle of attack, see steer(): the angle of attack over the load factor, so a pilot switched on in a
    // turn pulling harder than a level turn does not start from a nose-high attitude and climb out of it)
    this.alphaF = (ac.aero.alpha || 0) / Math.max(ac.gload || 1, 0.5);
    this.pInt = 0; this.tInt = 0; this.rInt = 0; this.bankRef = null;
    this.bumpless = ac.time > 1;                  // switched on mid-flight: see steer()
    this.trimApp = undefined;                     // the approach trim (apTrim aircraft), computed when the join starts
    this.dbg = { hDes: 0, vsDes: 0, pitchCmd: 0, gDes: 0, bankCmd: 0, xte: NaN };
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
  // centreline, along the runway heading). The cheapest wins. A leg is measured by its own geometry (makeLeg): an
  // arc by the distance off its circle and its direction where the airplane is along it. Called once, when the pilot
  // is switched on.
  resumeAt() {
    const p = this.ac.pos, w = this.wps, n = w.length, rw = this.rw;
    if (!n) return 0;
    const tx = Math.sin(this.ac.track), tz = -Math.cos(this.ac.track);
    const turn = (dx, dz) => RESUME_PENALTY * (1 - (dx * tx + dz * tz) / (Math.hypot(dx, dz) || 1)) / 2;
    let best = 0, bestCost = Math.hypot(w[0].x - p.x, w[0].z - p.z) + turn(w[0].x - p.x, w[0].z - p.z);
    let past = n === 1 && (w[0].x - p.x) * tx + (w[0].z - p.z) * tz < 0;
    const o = { s: 0, e: 0 }, q = { x: 0, z: 0 }, q2 = { x: 0, z: 0 };
    for (let j = 1; j < n; j++) {
      const g = makeLeg(w[j - 1], w[j]);
      const s = g.proj(p.x, p.z, o).s;
      if (s >= g.L) { if (j === n - 1) past = true; continue; }
      const c = clamp(s, 0, g.L - 1);
      g.at(c, q); g.at(c + 1, q2);   // the closest point on the leg, and the leg's direction there
      const cost = Math.hypot(q.x - p.x, q.z - p.z) + turn(q2.x - q.x, q2.z - q.z);
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
    const pr = this._pr;
    let leg, s;
    for (;;) {
      leg = this.leg(this.i);
      s = leg.proj(ac.pos.x, ac.pos.z, pr).s;
      if (s < leg.L) break;
      this.i++; this.eInt = 0;
      if (this.i >= n) { this.phase = 'join'; this.join(dt); return; }
    }
    const A = leg.A, B = leg.B, L = leg.L;
    const V = Math.max(ac.gs, 15), L1 = clamp(T.L1 * V, 45, 650);
    // a route that ends in an arc (a turn onto the final) rolls out ahead of the arc's end, as a turn onto the
    // centerline should: the join takes over half a roll's time early
    if (leg.arc && this.i === n - 1 && L - s < V * (0.5 * Math.atan(V * V / (G * leg.r)) / (T.roll * DEG) + T.rollLag)) {
      this.i = n; this.phase = 'join'; this.join(dt); return;
    }
    // Which law steers: an arc's own (feed-forward bank plus cross-track correction) on an arc leg, and from the lead
    // before one begins; the pure pursuit below on a straight leg, and from the lead before an arc
    // ends onto one.
    // (the lead: half the time the roll between this leg's bank and the next one's takes, as distance flown)
    const next = this.i + 1 < n ? this.leg(this.i + 1) : null;
    const rr = Math.min(ARC_LAW.rate, T.roll);
    const lead = V * Math.max(ARC_LAW.lead, ARC_LAW.half * Math.abs(this.bankOf(next, V) - this.bankOf(leg, V)) / (rr * DEG) + ARC_LAW.lag * T.rollLag);
    let arcLeg = null;
    if (leg.arc && !(L - s < lead && next && !next.arc)) arcLeg = L - s < lead && next && next.arc ? next : leg;
    else if (!leg.arc && next && next.arc && L - s < lead) arcLeg = next;
    const tgt = this._tgt || (this._tgt = { x: 0, z: 0 });
    let arc = null;
    if (arcLeg) arc = this.arcState(arcLeg, dt);
    else {
      // the lateral target: L1 metres ahead along the route from the airplane's projection, carried round a fly-by
      // corner onto the next leg (so the turn starts early and flies a smooth arc), held on the leg's own line past
      // a fly-over waypoint or the last one
      const e = leg.arc ? 0 : pr.e;
      let rem = Math.max(Math.sqrt(Math.max(L1 * L1 - e * e, 0)), 0.3 * L1);
      let k = this.i, ss = s, lg = leg;
      for (;;) {
        // (never round a corner onto an arc: the arc law flies that turn, from its start)
        if (ss + rem <= lg.L || lg.B.over || k === n - 1 || this.leg(k + 1).arc) break;
        rem -= Math.max(0, lg.L - ss); k++; ss = 0; lg = this.leg(k);
      }
      lg.at(Math.min(ss + rem, lg.arc ? lg.L : Infinity), tgt);
    }
    // the vertical target: the route's height (straight lines between the waypoints) here and `la` seconds ahead,
    // so a change of slope at a waypoint is flown as a curve that starts just before it
    const hNow = A.y + (B.y - A.y) * clamp(s / L, 0, 1);
    let rh = V * T.la, hA;
    for (let k = this.i, ss = Math.max(s, 0), lg = leg; ;) {
      if (ss + rh <= lg.L || k === n - 1) { hA = lg.A.y + (lg.B.y - lg.A.y) * clamp((ss + rh) / lg.L, 0, 1); break; }
      rh -= Math.max(0, lg.L - ss); k++; ss = 0; lg = this.leg(k);
    }
    this.steer(dt, tgt, hNow, (hA - hNow) / T.la, (B.kt || this.vref + T.extra) * KT, (arcLeg ? arcLeg.B.bank : B.bank) || (arcLeg ? T.bank + 20 : T.bank), arc);
    // configuration: what the leg asks for
    const inp = ac.input;
    if (B.flap != null && !ac.failures.has('flapsStuck')) inp.flapCmd = B.flap;
    if (B.gear != null && this.def.gearRetract) inp.gearCmd = B.gear;
  }

  // The steady bank leg g needs at ground speed V (0 on a straight leg; + right).
  bankOf(g, V) { return g && g.arc ? g.arc * Math.atan(V * V / (G * g.r)) : 0; }

  // Leg i (cached): from the start (i = 0) or waypoint i - 1 to waypoint i.
  leg(i) {
    let g = this.legs[i];
    if (!g) g = this.legs[i] = makeLeg(i === 0 ? this.start : this.wps[i - 1], this.wps[i]);
    return g;
  }

  // The arc law's inputs for arc leg g: which way it turns, the bank its radius needs at this ground speed, and the
  // bank to add for being off it (e metres outside, drifting outward at edot m/s, and the integral of e). Reused.
  arcState(g, dt) {
    const ac = this.ac, o = this._arc || (this._arc = { sgn: 1, ff: 0, corr: 0, e: 0 });
    const rx = ac.pos.x - g.cx, rz = ac.pos.z - g.cz, d = Math.hypot(rx, rz) || 1;
    const e = d - g.r, edot = (ac.vel.x * rx + ac.vel.z * rz) / d;
    const vg2 = ac.vel.x * ac.vel.x + ac.vel.z * ac.vel.z;
    o.sgn = g.arc; o.ff = Math.atan(vg2 / (G * g.r)); o.e = e;
    // before the arc begins (the roll leading into it) the airplane is on the line to it, not off the circle: the
    // feed-forward alone, or the correction would read the tangent's approach as a drift inward and hold the roll off
    if (g.proj(ac.pos.x, ac.pos.z, this._pr2 || (this._pr2 = { s: 0, e: 0 })).s < 0) { o.corr = 0; return o; }
    this.eInt = clamp(this.eInt + ARC_LAW.ki * e * dt, -ARC_LAW.iMax, ARC_LAW.iMax);
    o.corr = ARC_LAW.k * e + ARC_LAW.kd * edot + this.eInt;
    return o;
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
  steer(dt, tgt, hDes, vsPath, vT, bankLim, arc = null) {
    const ac = this.ac, inp = ac.input, def = this.def, T = this.tune;
    const V = Math.max(ac.gs, 15);
    // ---- lateral: on an arc, the bank its radius needs plus the correction for being off it (arcState); else pure
    // pursuit of the target point
    const bl = bankLim * DEG;
    let bankCmd;
    if (arc) bankCmd = clamp(arc.sgn * (arc.ff + arc.corr), -bl, bl);
    else {
      const tx = tgt.x - ac.pos.x, tz = tgt.z - ac.pos.z, dist = Math.max(Math.hypot(tx, tz), 20);
      const eta = wrapPi(Math.atan2(tx, -tz) - ac.track);
      bankCmd = clamp(Math.atan(2 * V * V * Math.sin(eta) / (dist * 9.81)), -bl, bl);
    }
    if (arc) {
      // (the arc's own roll loop: a bank reference moved toward the command at no more than ARC_LAW.rate - a roll the
      // airliner can follow - and tracked stiffly, its roll rate fed forward, with an integral near it: the stock loop
      // below lets a roll to 40 degrees overshoot to 46 and creep, and the path loop then chases the swing. The gains
      // were measured on the Condor, scaled for the others by their roll rate: only the Condor is proven on arcs.)
      const rs = 17 / T.roll;
      if (this.bankRef == null) this.bankRef = ac.euler.roll;
      const refRate = clamp(ARC_LAW.kr * (bankCmd - this.bankRef), -ARC_LAW.rate * DEG, ARC_LAW.rate * DEG);
      this.bankRef += refRate * dt;
      const err = this.bankRef - ac.euler.roll, rate = -ac.omega.z;
      if (Math.abs(err) < 3 * DEG) this.rInt = clamp(this.rInt + rs * ARC_LAW.ri * err * dt, -0.3, 0.3);
      inp.roll = clamp(ARC_LAW.ffk * refRate / (T.roll * DEG) + rs * (ARC_LAW.rk * err + ARC_LAW.rd * (refRate - rate)) + this.rInt, -1, 1);
    } else {
      this.rInt = 0; this.bankRef = null;
      inp.roll = clamp(2.5 * (bankCmd - ac.euler.roll) + 0.8 * ac.omega.z, -1, 1);
    }
    const rollRate = -ac.omega.z;   // (d roll / dt: the body roll rate, its sign as the damper above uses it)
    // (on an arc, a firmer turn coordinator: a quick roll to 35 degrees in the airliner skidded 5 degrees on the stock
    // gain, and a skid in a bank is lift lost; plus rudder with the aileron against its adverse yaw)
    inp.yaw = clamp((arc ? ARC_LAW.yaw : 1.5) * ac.aero.beta + (arc ? ARC_LAW.yawFF * inp.roll : 0), -1, 1);
    // ---- vertical: the line's height, with its slope as the feed-forward. The pitch attitude is the wanted flight
    // path plus the trim angle of attack (filtered slowly: a fast filter follows the airplane's own pitching and
    // turns the loop into an oscillator), plus a proportional and integral term on the flight-path error.
    const vsDes = clamp(vsPath + T.kh * (hDes - ac.pos.y), -T.down, T.up);
    const tas = Math.max(ac.tas, 15);
    const gDes = Math.asin(clamp(vsDes / tas, -0.45, 0.45)), gam = Math.asin(clamp(ac.vs / tas, -0.9, 0.9));
    // (the filter follows the angle of attack scaled to 1 g, alpha x cos(bank): in a steady level turn the pitch
    // attitude is the flight path plus the 1-g alpha, whatever the bank, and filtering the raw alpha let the target
    // sag by a quarter of alpha while the bank came in, so the turn lost lift and swung wide)
    this.alphaF += (ac.aero.alpha * Math.cos(ac.euler.roll) - this.alphaF) * Math.min(1, dt / T.ta);
    const gErr = gDes - gam;
    // (switched on mid-flight, the first step is bumpless: the integrals start where the pitch and the throttle
    // already are, so the airplane is not pitched up or down by a controller starting cold - in a 40-degree turn a
    // cold start pitched it up 3 degrees, the climb tightened the turn, and the Needle's eye was passed 1.5 m inside)
    if (this.bumpless) this.pInt = clamp(ac.euler.pitch - (gDes + this.alphaF + T.gp * gErr), -0.1, 0.1);
    this.pInt = clamp(this.pInt + T.gi * gErr * dt, -0.1, 0.1);
    let pitchCmd = gDes + this.alphaF + T.gp * gErr + this.pInt;
    // ---- speed
    const err = vT - ac.ias;
    if (this.bumpless) { this.tInt = clamp(-(T.kt * err + T.kg * (gDes - this.g0)), -0.6, 0.6); this.bumpless = false; }
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
      // (the damper leaves alone the steady nose-up rate a banked turn has, (g / V) sin(bank) tan(bank): damping
      // that would push the nose down and widen every turn)
      const cr = Math.cos(ac.euler.roll), qTurn = cr > 0.2 ? (G / Math.max(ac.tas, 15)) * (1 - cr * cr) / cr : 0;
      // (and on an arc, the pull the turn needs fed forward: the attitude loop only pulls once the airplane sinks)
      // (from the bank it will have in a moment, at this roll rate: the pull takes a second to build too)
      const cb = Math.cos(clamp(Math.abs(ac.euler.roll + ARC_LAW.pullLead * rollRate), 0, 1.2));
      // plus a loop on the load factor itself (a level turn at this bank), which damps the swing in g that otherwise
      // tightens and widens the turn by turns
      const pull = arc && cb > 0.4 ? T.nStick * (1 / cb - 1) + ARC_LAW.kn * T.nStick * (1 / Math.max(cr, 0.4) - ac.gload) : 0;
      inp.pitch = clamp(T.kp * (pitchCmd - ac.euler.pitch) - T.kd * (ac.omega.x - qTurn) + pull, -1, 1);
    }
    const dbg = this.dbg;   // (for tools/fly-mission.mjs --track --debug; one object, reused every frame)
    dbg.hDes = hDes; dbg.vsDes = vsDes; dbg.pitchCmd = pitchCmd; dbg.gDes = gDes; dbg.bankCmd = bankCmd; dbg.xte = arc ? arc.e : NaN;
  }
}
