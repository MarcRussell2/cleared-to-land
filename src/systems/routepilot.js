// Route pilot: flies a mission's `route` (waypoints in the runway frame: through the notch, over the wires, up the
// harbour) and then hands the airplane to the stock Autoland for the final approach and landing. Autoland
// (src/systems/autopilot.js) is not edited: it only ever flies a straight line from the aim point, so the route's
// last waypoint should sit on (or near) the extended centreline at about the height of the approach path there.
//
// This is what proves, headless, that an obstacle or city mission can be flown at all (tools/fly-mission.mjs in
// the real page, tools/test-obstacles.mjs in Node); it is also what game.setAutopilot(true) uses when the
// scenario has a route. It writes ac.input directly, as Autoland does, so it never meets the flight control law.
//
// Route: [{ u, v, alt, kt?, over?, flap?, gear? }] - u/v in the runway frame of runways[0], alt the CG's height
// above the threshold elevation, kt the indicated airspeed to fly on the leg TO this waypoint (default Vref plus a
// margin), over: true to fly over the point before turning (a gate, a notch) instead of cutting the corner,
// flap/gear set on that leg. Heights are flown as straight lines between waypoints.
//
// The laws:
//   lateral   L1 guidance (the lateral acceleration 2 V^2 sin(eta) / L1 toward a point L1 ahead on the leg), as a
//             bank angle limited per aircraft, through Autoland's own roll and yaw-damper loops; fly-by corners
//             lead the turn by R tan(turn / 2);
//   vertical  the leg's slope as a vertical-speed feed-forward plus height error, turned into a pitch attitude
//             (flight path + the measured angle of attack, times cos(bank)), with a slow integrator;
//   speed     throttle PI plus a flight-path feed-forward (it takes thrust to climb), speedbrakes on the Condor
//             when it is fast at idle, stall protection as in Autoland.
// A route flown from mid-way (the autopilot switched on late) starts at the first waypoint still ahead.
import { KT, DEG, clamp, wrapPi } from '../config.js';
import { Autoland } from './autopilot.js';
import { vrefFor } from './scoring.js';

// Per aircraft: bank limit (deg), L1 period (s), pitch loop gains, throttle gains, vertical speed limits (m/s),
// the margin over Vref flown on the route (kt), and the approach flap handed to Autoland.
const TUNE = {
  skylark: { bank: 28, L1: 5.0, kp: 3.0, kd: 1.0, kt: 0.06, ki: 0.03, kg: 2.4, down: 5, up: 3.5, extra: 6, flap: 0.667 },
  trailblazer: { bank: 30, L1: 4.0, kp: 3.0, kd: 1.0, kt: 0.06, ki: 0.03, kg: 2.4, down: 6, up: 3.5, extra: 4, flap: 1 },
  condor: { bank: 25, L1: 7.0, kp: 4.5, kd: 2.5, kt: 0.035, ki: 0.012, kg: 2.0, down: 8, up: 7, extra: 12, flap: 0.75 },
  hornet: { bank: 30, L1: 6.0, kp: 4.5, kd: 2.5, kt: 0.035, ki: 0.012, kg: 1.5, down: 9, up: 9, extra: 10, flap: 1 },
};

export class RoutePilot {
  constructor(ac, world, sc) {
    this.ac = ac; this.world = world; this.sc = sc;
    this.def = ac.def;
    this.tune = TUNE[ac.def.id] || TUNE.skylark;
    this.vref = vrefFor(ac, sc);
    this.final = null;
    this.phase = 'route';
    const rw = world.runway;
    this.wps = [];
    if (rw && Array.isArray(sc.route)) {
      for (const w of sc.route) {
        const v = w.v || 0;
        this.wps.push({
          x: rw.threshold.x + rw.dir.x * w.u + rw.right.x * v, z: rw.threshold.z + rw.dir.z * w.u + rw.right.z * v,
          y: rw.elevation + w.alt, u: w.u, kt: w.kt, over: !!w.over, flap: w.flap, gear: w.gear,
        });
      }
      // switched on mid-way: skip what is already behind
      const dx = ac.pos.x - rw.threshold.x, dz = ac.pos.z - rw.threshold.z, u = dx * rw.dir.x + dz * rw.dir.z;
      while (this.wps.length && this.wps[0].u < u + 30) this.wps.shift();
    }
    this.i = 0;
    this.start = { x: ac.pos.x, z: ac.pos.z, y: ac.pos.y };
    this.thr0 = ac.input.throttle;
    this.g0 = ac.gs > 1 ? Math.atan2(ac.vs, ac.gs) : 0;
    this.alphaF = ac.aero.alpha || 0;
    this.pInt = 0; this.tInt = 0;
    if (!this.wps.length) this.handOver();
  }

  handOver() {
    const ac = this.ac, inp = ac.input;
    inp.spoiler = 0;
    if (this.def.spoilers && !this.world.carrier) inp.spoilerArmed = true;
    if (this.def.gearRetract) inp.gearCmd = 1;
    this.final = new Autoland(ac, this.world, this.sc);
    this.phase = 'final';
  }

  update(dt) {
    if (this.final) { this.final.update(dt); return; }
    const ac = this.ac, inp = ac.input, def = this.def, T = this.tune;
    const A = this.i === 0 ? this.start : this.wps[this.i - 1], B = this.wps[this.i];
    let dx = B.x - A.x, dz = B.z - A.z;
    const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const px = ac.pos.x - A.x, pz = ac.pos.z - A.z;
    const s = px * dx + pz * dz, e = px * -dz + pz * dx;      // along the leg, and right of it
    const V = Math.max(ac.gs, 15);
    // the corner: fly-by waypoints lead the turn onto the next leg
    const C = this.wps[this.i + 1];
    let lead = 0;
    if (C && !B.over) {
      const turn = Math.abs(wrapPi(Math.atan2(C.x - B.x, -(C.z - B.z)) - Math.atan2(dx, -dz)));
      const R = V * V / (9.81 * Math.tan(T.bank * DEG * 0.8));
      lead = Math.min(R * Math.tan(turn / 2), L * 0.45);
    }
    if (s >= L - lead) {
      this.i++;
      if (this.i >= this.wps.length) { this.phase = 'align'; this.alignStart = { x: B.x, z: B.z, y: B.y }; this.i = this.wps.length - 1; this.align(dt); return; }
      this.update(dt);
      return;
    }
    // ---- lateral: L1 toward a point ahead on the leg
    const L1 = clamp(T.L1 * V, 45, 650);
    const along = s + Math.max(Math.sqrt(Math.max(L1 * L1 - e * e, 0)), 0.3 * L1);
    const tx = A.x + dx * along - ac.pos.x, tz = A.z + dz * along - ac.pos.z;
    const eta = wrapPi(Math.atan2(tx, -tz) - ac.track);
    const bankCmd = clamp(Math.atan(2 * V * V * Math.sin(eta) / (L1 * 9.81)), -T.bank * DEG, T.bank * DEG);
    inp.roll = clamp(2.5 * (bankCmd - ac.euler.roll) + 0.8 * ac.omega.z, -1, 1);
    inp.yaw = clamp(1.5 * ac.aero.beta, -1, 1);
    // ---- vertical: the leg's straight line in height
    const f = clamp(s / L, 0, 1);
    const hDes = A.y + (B.y - A.y) * f;
    const vsDes = clamp(V * (B.y - A.y) / L + 0.25 * (hDes - ac.pos.y), -T.down, T.up);
    const tas = Math.max(ac.tas, 15);
    const gDes = Math.asin(clamp(vsDes / tas, -0.45, 0.45));
    this.alphaF += (ac.aero.alpha - this.alphaF) * Math.min(1, dt / 0.6);
    const vsErr = vsDes - ac.vs;
    this.pInt = clamp(this.pInt + 0.012 * vsErr * dt, -0.1, 0.1);
    let pitchCmd = gDes + this.alphaF * Math.cos(ac.euler.roll) + 0.012 * vsErr + this.pInt;
    // ---- speed
    const vT = (B.kt || this.vref + T.extra) * KT;
    const err = vT - ac.ias;
    this.tInt = clamp(this.tInt + T.ki * err * dt, -0.6, 0.6);
    let thr = clamp(this.thr0 + T.kt * err + this.tInt + T.kg * (gDes - this.g0), 0, 1);
    if (def.spoilers) inp.spoiler = thr < 0.03 && err < -8 * KT ? 1 : 0;
    // ---- configuration: what the leg asks for; the approach flap and the gear for the last leg
    if (B.flap != null) inp.flapCmd = B.flap;
    if (B.gear != null && def.gearRetract) inp.gearCmd = B.gear;
    if (this.i === this.wps.length - 1) {
      if (inp.flapCmd < T.flap && !ac.failures.has('flapsStuck')) inp.flapCmd = T.flap;
      if (def.gearRetract) inp.gearCmd = 1;
    }
    // ---- protection, as Autoland
    if (ac.aero.alpha > ac.aero.alphaStall - 3 * DEG) pitchCmd = Math.min(pitchCmd, ac.euler.pitch - 2 * DEG);
    if (ac.ias < this.vref * KT * 0.93) thr = Math.max(thr, 0.8);
    inp.throttle = thr;
    inp.pitch = clamp(T.kp * (pitchCmd - ac.euler.pitch) - T.kd * ac.omega.x, -1, 1);
  }
}
