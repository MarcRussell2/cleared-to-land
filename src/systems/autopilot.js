// Automatic approach and landing controller. Used for testing every scenario end-to-end
// (game.setAutopilot(true) in the console). Works for runways and the carrier.
import { KT, DEG, RAD, clamp, wrapPi } from '../config.js';
import { vrefFor } from './scoring.js';

export class Autoland {
  constructor(ac, world, sc) {
    this.ac = ac; this.world = world; this.sc = sc;
    const def = ac.def;
    this.jet = def.engines[0].type === 'jet';
    this.kp = this.jet ? 4.5 : 3.0; this.kd = this.jet ? 2.5 : 1.0;
    this.phase = 'approach';
    this.pitchRef = ac.euler.pitch;
    this.pitchInt = 0; this.thrInt = 0;
    this.thr0 = ac.input.throttle;
    this.flareT = 0; this.pitch0 = 0;
    this.flareInc = ({ skylark: 8, trailblazer: 9, condor: 3.5, hornet: 0 }[def.id] || 6) * DEG;
    this.flareTime = this.jet ? 3.5 : 3.0;
    this.vref = vrefFor(ac, sc) * KT;
    this.t = 0;
    this.recovering = !!sc.spawn?.stall;
  }

  geometry() {
    const w = this.world, ac = this.ac, p = ac.pos;
    if (w.carrier) {
      const c = w.carrier;
      const td = c.tdWorld, dir = c.landDirWorld, right = c.landRightWorld;
      const dx = p.x - td.x, dz = p.z - td.z;
      const dToAim = -(dx * dir.x + dz * dir.z);
      const v = dx * right.x + dz * right.z;
      // glideslope line extended through the deck: no flare, no dive at the end
      return { dToAim, v, hDes: td.y + dToAim * Math.tan(3.5 * DEG) + 3.6, hdg: c.landingHeading(), right, gs: 3.5 * DEG, flareH: 0, aimY: td.y };
    }
    const rw = w.runway;
    const dx = p.x - rw.threshold.x, dz = p.z - rw.threshold.z;
    const u = dx * rw.dir.x + dz * rw.dir.z, v = dx * rw.right.x + dz * rw.right.z;
    const gs = (rw.gsAngle ? rw.gsAngle * DEG : ac.def.approach.glideslope);
    const dToAim = rw.aimDistance - u;
    return { dToAim, v, hDes: rw.aim.y + Math.max(0, dToAim) * Math.tan(gs) + ac.def.cgHeight, hdg: rw.heading, right: rw.right, gs, flareH: ac.def.approach.flareHeight, aimY: rw.aim.y, u };
  }

  update(dt) {
    const ac = this.ac, def = ac.def, inp = ac.input;
    this.t += dt;
    const g = this.geometry();
    const hAgl = ac.radioAlt;
    if (def.hook) { inp.hookCmd = 1; }
    if (def.gearRetract) inp.gearCmd = 1;
    if (this.recovering) {
      // stall recovery: nose down, full power, wings level
      inp.throttle = 1;
      inp.pitch = clamp(this.kp * (-2 * DEG - ac.euler.pitch) - this.kd * ac.omega.x, -1, 1);
      inp.roll = clamp(-2.0 * ac.euler.roll + 0.8 * ac.omega.z, -1, 1);
      inp.yaw = clamp(1.5 * ac.aero.beta, -1, 1);
      if (ac.ias > def.speeds.Vref * KT * 1.05 && ac.aero.stall < 0.05) { this.recovering = false; this.thr0 = 0.55; this.pitchRef = 2 * DEG; inp.flapCmd = 0.667; }
      return;
    }
    // lateral: track the centerline (crab handles wind)
    const xteRate = ac.vel.x * g.right.x + ac.vel.z * g.right.z;
    const trk = ac.gs > 2 ? wrapPi(ac.track - g.hdg) : 0;
    const rollCmd = clamp(-0.015 * g.v - 0.05 * xteRate - 1.0 * trk, -0.4, 0.4);
    inp.roll = clamp(2.5 * (rollCmd - ac.euler.roll) + 0.8 * ac.omega.z, -1, 1);
    inp.yaw = clamp(1.5 * ac.aero.beta, -1, 1);
    let pitchCmd = ac.euler.pitch;
    const speedErr = this.vref - ac.ias;
    const prop = !this.jet;
    if (this.phase === 'approach') {
      const closure = Math.max(ac.gs - (this.world.carrier ? this.world.carrier.speed : 0), 5);
      const carrierMode = false; // AoA/throttle method is less damped than pitch-for-path; keep the path method
      const vsDes = clamp(-closure * Math.tan(g.gs) + (this.world.carrier ? 0.25 : 0.15) * (g.hDes - ac.pos.y), -9, 3);
      const vsErr = vsDes - ac.vs;
      if (carrierMode) {
        // Navy technique: pitch holds on-speed AoA, throttle flies the glideslope
        const aoaErr = def.approach.onSpeedAoA - ac.aero.alpha;
        pitchCmd = ac.euler.pitch + 0.5 * aoaErr;
        this.thrInt = clamp(this.thrInt + 0.012 * vsErr * dt, -0.35, 0.35);
        const vAcc = ac.accel.y - 9.81;
        inp.throttle = clamp(this.thr0 + 0.03 * vsErr + this.thrInt - 0.03 * vAcc, 0, 1);
      } else {
        this.pitchInt = clamp(this.pitchInt + 0.004 * vsErr * dt, -0.12, 0.12);
        pitchCmd = this.pitchRef + 0.025 * vsErr + this.pitchInt;
        const kt = prop ? 0.06 : 0.035, ki = prop ? 0.03 : 0.012;
        this.thrInt = clamp(this.thrInt + ki * speedErr * dt, -0.5, 0.5);
        inp.throttle = clamp(this.thr0 + kt * speedErr + this.thrInt - 0.01 * vsErr, 0, 1);
      }
      if (ac.failures.has('engine')) {
        // dead stick: best glide with pitch; manage the path with flaps
        inp.throttle = 0;
        const glideKt = def.id === 'skylark' ? 68 : def.speeds.Vref;
        pitchCmd = this.pitchRef - 0.02 * (glideKt * KT - ac.ias);
        const steep = Math.atan2(ac.pos.y - g.aimY, Math.max(g.dToAim, 50));
        inp.flapCmd = steep > 6.5 * DEG ? 1 : steep > 5 * DEG ? 0.5 : 0;
      }
      // stall protection: nose down and power when slow
      if (ac.aero.alpha > ac.aero.alphaStall - 3 * DEG) pitchCmd = Math.min(pitchCmd, ac.euler.pitch - 2 * DEG);
      if (ac.ias < this.vref * 0.93 && !ac.failures.has('engine')) inp.throttle = Math.max(inp.throttle, 0.8);
      if (this.world.carrier && ac.ctl.flap < 0.95) inp.flapCmd = 1;
      if (g.flareH > 0 && hAgl < g.flareH) { this.phase = 'flare'; this.flareT = 0; this.pitch0 = ac.euler.pitch; }
      if (this.world.carrier && g.dToAim < 40 && ac.gs > 0 && ac.wheelsOnGround) { this.phase = 'rollout'; this.pitch0 = ac.euler.pitch; this.flareT = 0; }
    } else if (this.phase === 'flare') {
      this.flareT += dt;
      inp.throttle = Math.max(0, inp.throttle - dt * (this.jet ? 0.4 : 0.8));
      if (ac.failures.has('elevatorJam')) inp.throttle = 0.35;
      pitchCmd = this.pitch0 + this.flareInc * Math.min(this.flareT / this.flareTime, 1);
      if (def.limits.tailStrikePitch < 1) pitchCmd = Math.min(pitchCmd, def.limits.tailStrikePitch - 2 * DEG);
    }
    if (ac.stats.touchdown && this.phase !== 'rollout' && this.phase !== 'bolter') { this.phase = 'rollout'; this.pitch0 = ac.euler.pitch; this.flareT = 0; }
    if (this.world.carrier && ac.trap.boltered && !ac.trap.engaged && !ac.trap.trapped) this.phase = 'bolter';
    if (this.phase === 'bolter') {
      inp.throttle = 1;
      pitchCmd = ac.radioAlt > 30 ? 8 * DEG : 10 * DEG;
      inp.roll = clamp(-2.0 * ac.euler.roll + 0.5 * ac.omega.z, -1, 1);
    } else if (this.phase === 'rollout') {
      this.flareT += dt;
      if (this.world.carrier) {
        inp.throttle = ac.trap.engaged || ac.trap.trapped ? 0 : 1;
        if (ac.trap.trapped) inp.brake = 1;
        pitchCmd = ac.trap.engaged || ac.trap.trapped ? this.pitch0 + (-1 * DEG - this.pitch0) * Math.min(this.flareT / 1.5, 1) : this.pitch0;
      } else {
        inp.throttle = 0;
        const derot = def.id === 'trailblazer' ? 4 : this.jet ? 4 : 1.5;
        pitchCmd = this.pitch0 + ((def.id === 'trailblazer' ? 6 * DEG : -2 * DEG) - this.pitch0) * Math.min(this.flareT / derot, 1);
        if (ac.groundTime > 1.5) inp.brake = def.id === 'trailblazer' ? 0.35 : 0.8;
        if (def.engines[0].reverse) inp.reverse = ac.gs > 25 ? 0.8 : 0;
        if (def.spoilers) inp.spoiler = 1;
      }
      const hdgErr = wrapPi(ac.euler.heading - g.hdg);
      inp.yaw = clamp(-0.05 * g.v - 0.1 * xteRate - 1.5 * hdgErr, -1, 1);
      inp.roll = clamp(-2.0 * ac.euler.roll + 0.5 * ac.omega.z, -1, 1);
    }
    if (ac.failures.has('elevatorJam')) {
      // pitch with trim only
      inp.pitch = 0;
      inp.trim = clamp(inp.trim + 0.4 * (pitchCmd - ac.euler.pitch) * dt - 0.2 * ac.omega.x * dt, -1, 1);
    } else {
      inp.pitch = clamp(this.kp * (pitchCmd - ac.euler.pitch) - this.kd * ac.omega.x, -1, 1);
    }
  }
}
