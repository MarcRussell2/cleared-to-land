// 6-DOF rigid-body aircraft: aero + engines + spring/damper gear with friction-circle
// tires + fuselage contact points + tailhook/arresting wires + failures.
//
// Body frame: forward = -Z, up = +Y, right = +X (same as the meshes).
// omega (body rad/s): pitch-up rate = +x, yaw-right rate = -y, roll-right rate = -z.
import { Vector3, Quaternion } from 'three';
import { computeAero, makeAeroOut, wingCL } from './aero.js';
import { G, DEG, RHO0, rhoAt, clamp, wrapPi } from '../config.js';

const FWD = new Vector3(0, 0, -1);
const UP = new Vector3(0, 1, 0);
const RIGHT = new Vector3(1, 0, 0);
const _q = new Quaternion();

export function makeGroundOut() {
  return { y: 0, n: new Vector3(0, 1, 0), mu: 0.8, kind: 'grass', vel: new Vector3(), rough: 0, name: '' };
}

function approach(cur, target, maxDelta) {
  const d = target - cur;
  if (d > maxDelta) return cur + maxDelta;
  if (d < -maxDelta) return cur - maxDelta;
  return target;
}

function rotateAboutAxis(v, axis, angle) {
  _q.setFromAxisAngle(axis, angle);
  return v.applyQuaternion(_q);
}

export class Aircraft {
  constructor(def, opts = {}) {
    this.def = def;
    this.mass = opts.mass || def.mass;
    this.pos = new Vector3();
    this.vel = new Vector3();
    this.quat = new Quaternion();
    this.qInv = new Quaternion();
    this.omega = new Vector3();

    // Commanded inputs
    this.input = {
      pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 0, flapCmd: 0, gearCmd: 1,
      hookCmd: 0, spoiler: 0, spoilerArmed: false, reverse: 0, trim: 0, autobrake: 0,
    };
    // Actual positions
    this.ctl = { elevator: 0, aileron: 0, rudder: 0, flap: 0, gear: def.gearRetract ? 1 : 1, hook: 0, spoiler: 0, steer: 0 };

    this.engines = def.engines.map((e, i) => ({ ...e, index: i, pos: new Vector3(e.pos.x, e.pos.y, e.pos.z), throttle: 0, thrust: 0, failed: false, rpm: 0 }));
    this.legs = def.gear.map((g) => ({
      ...g, pos: new Vector3(g.pos.x, g.pos.y, g.pos.z), ext: 1, stuckAt: null, contact: false, load: 0, comp: 0,
      wheelAngle: 0, collapsed: false, vlon: 0, vlat: 0, skid: 0, brakeInput: 0, impact: 0, kind: 'grass', wasContact: false,
    }));
    this.points = def.bodyPoints.map((p) => ({ ...p, pos: new Vector3(p.pos.x, p.pos.y, p.pos.z), contact: false, load: 0, comp: 0, vlon: 0, vlat: 0, impact: 0, skid: 0, kind: 'grass' }));
    this.hookPt = def.hook ? { name: 'hook', pos: new Vector3(), contact: false, load: 0, comp: 0, vlon: 0, vlat: 0, impact: 0, skid: 0, mu: 0.25, kind: 'grass' } : null;

    this.failures = new Set();
    this.events = [];
    this.aero = makeAeroOut();
    this.vAirWorld = new Vector3();
    this.vAirBody = new Vector3();
    this._wind = new Vector3();
    this.rho = RHO0;
    this.qTail = 0;
    this.ice = 0;
    this.windmillDrag = 0;
    this.powerFrac = 0;
    this.stallBias = 1;
    this.stallSign = Math.random() < 0.5 ? -1 : 1;
    this.time = 0;
    this.radioAlt = 1000; // unknown until the first step; assume high
    this.groundY = 0;
    this.groundKind = 'grass';
    this.groundVel = new Vector3();

    this.crashed = false;
    this.crashReason = null;
    this.onGround = false;
    this.wheelsOnGround = false;
    this.airborneTime = 10;
    this.groundTime = 0;
    this.stopped = false;
    this.trap = { engaged: false, wire: -1, trapped: false, boltered: false, t: 0 };
    this.hookPrevU = null;
    this.hookPrevH = 0;
    this.hookTipBody = new Vector3();
    this.hookTipWorld = new Vector3();

    this.stats = {
      maxG: 1, minG: 1, stallTime: 0, stallWarnTime: 0, stallWarnTimeLow: 0, stalls: 0, stallsLow: 0, stallsHeld: 0, bounces: 0, touchdown: null, touchdowns: [],
      maxLoad: 0, damage: [], tailstrike: false, propstrike: false, belly: false, gearCollapse: false,
      maxSink: 0, minIasAirborne: 1e9, goArounds: 0, flightTime: 0, wingtip: false,
    };
    this._stalledNow = false;
    this.stallHold = false;   // the Stall Recovery start: set by main.js spawn(), released by FlightControl.holdStall()

    this.euler = { heading: 0, pitch: 0, roll: 0 };
    this.fwd = new Vector3(0, 0, -1);
    this.up = new Vector3(0, 1, 0);
    this.right = new Vector3(1, 0, 0);
    this.ias = 0; this.tas = 0; this.gs = 0; this.vs = 0; this.gload = 1; this.alt = 0; this.gsRel = 0;
    this.accel = new Vector3();

    this._g = makeGroundOut();
    this._F = new Vector3(); this._T = new Vector3(); this._Fw = new Vector3();
    this._rw = new Vector3(); this._pw = new Vector3(); this._ow = new Vector3(); this._vc = new Vector3();
    this._f = new Vector3(); this._side = new Vector3(); this._Fc = new Vector3(); this._rc = new Vector3(); this._tw = new Vector3();
    this._vrel = new Vector3(); this._dq = new Quaternion(); this._ax = new Vector3(); this._velBefore = new Vector3();
    this._dl = { u: 0, v: 0, h: 0, onDeck: false };
  }

  // ---------- setup ----------
  // The flare zone: below this radio altitude (m) a stall or the stall horn belongs to the landing, not the approach
  // (scoring.js, 2026-09-15). The flare height of the control law, and never under 4 m.
  flareZone() { return Math.max(this.def.fcs.flareH || 0, 4); }

  setPose(pos, heading, pitch, roll) {
    this.pos.copy(pos);
    const qy = new Quaternion().setFromAxisAngle(UP, -heading);
    const qp = new Quaternion().setFromAxisAngle(RIGHT, pitch);
    const qr = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -roll);
    this.quat.copy(qy).multiply(qp).multiply(qr).normalize();
    this.omega.set(0, 0, 0);
    this._derive();
  }

  // Put the aircraft in steady flight: airspeed (m/s), flight path angle gamma (rad, negative = descending).
  trim(heading, tas, gamma, flap, windVec) {
    const def = this.def;
    this.ctl.flap = flap; this.input.flapCmd = flap;
    const rho = rhoAt(this.pos.y);
    const q = 0.5 * rho * tas * tas;
    const W = this.mass * G;
    const clNeed = (W * Math.cos(gamma)) / (q * def.S);
    // solve alpha
    const tmp = { cl: 0, sigma: 0, aS: 0, clMax: 0 };
    let lo = -6 * DEG, hi = def.stall.alpha + def.flaps.dAlphaStall * flap - 1 * DEG;
    let alpha = 0;
    for (let i = 0; i < 40; i++) {
      alpha = (lo + hi) / 2;
      wingCL(alpha, def, flap, this.ice, tmp);
      if (tmp.cl < clNeed) lo = alpha; else hi = alpha;
    }
    if (tmp.cl < clNeed - 0.05) alpha = hi; // can't make it; nearly stalled
    const CL = tmp.cl;
    const CD = def.CD0 + def.K * CL * CL + def.flaps.dCD0 * flap + def.CDgear * this.ctl.gear;
    const D = q * def.S * CD;
    const T = D + W * Math.sin(gamma);
    // throttle
    const live = this.engines.filter((e) => !e.failed);
    let thr = 0;
    if (live.length && T > 0) {
      const per = T / live.length;
      const e = live[0];
      if (e.type === 'jet') {
        const frac = clamp((per / e.maxThrust - e.idle) / (1 - e.idle), 0, 1);
        thr = Math.pow(frac, 1 / 1.25);
      } else {
        const P = (per * tas) / e.eta;
        thr = clamp((P / e.maxPower - 0.05) / 0.95, 0, 1);
        thr = Math.max(thr, clamp((per / e.staticThrust - 0.05) / 0.95, 0, 1) * 0.9);
      }
    }
    for (const e of this.engines) { e.throttle = thr; }
    this.input.throttle = thr;
    // elevator for Cm = 0
    const Cm = def.Cm0 + def.Cma * alpha + def.Cmflap * flap;
    const de = -Cm / def.Cmde;
    const trim = clamp(de / def.controls.elevatorMax, -0.9, 0.9);
    this.input.trim = trim;
    this.ctl.elevator = trim;
    // pose: pitch = gamma + alpha, velocity along gamma (relative to air) + wind
    const pitch = gamma + alpha;
    this.setPose(this.pos, heading, pitch, 0);
    const dir = new Vector3(Math.sin(heading) * Math.cos(gamma), Math.sin(gamma), -Math.cos(heading) * Math.cos(gamma));
    this.vel.copy(dir).multiplyScalar(tas);
    if (windVec) this.vel.add(windVec);
    this._derive();
    return { alpha, thr, trim, CL, T };
  }

  fail(name, arg) {
    this.failures.add(name);
    if (name === 'engine') for (const e of this.engines) e.failed = true;
    if (name === 'engineLeft') { const e = this.engines.find((x) => x.pos.x < -0.1) || this.engines[0]; e.failed = true; }
    if (name === 'engineRight') { const e = this.engines.find((x) => x.pos.x > 0.1) || this.engines[this.engines.length - 1]; e.failed = true; }
    if (name === 'noseGear') { const l = this.legs.find((x) => x.name === 'nose'); if (l) l.stuckAt = arg ?? 0; }
    if (name === 'gearStuck') { /* freezes at current */ }
    if (name === 'ice') this.ice = 1;
    this.events.push({ type: 'failure', name });
  }

  crash(reason) {
    if (this.crashed) return 0;
    this.crashed = true;
    this.crashReason = reason;
    this.events.push({ type: 'crash', reason });
    return 0;
  }

  // ---------- main step ----------
  step(dt, env) {
    if (dt <= 0) return;
    const n = Math.max(1, Math.min(12, Math.ceil(dt / 0.004)));
    const h = dt / n;
    for (let i = 0; i < n; i++) this._substep(h, env);
  }

  _substep(h, env) {
    const def = this.def;
    if (this.crashed) {
      // settle: simple damping so the wreck stops moving
      this.vel.multiplyScalar(Math.exp(-h * 1.5));
      this.omega.multiplyScalar(Math.exp(-h * 2));
      this.pos.addScaledVector(this.vel, h);
      env.ground(this.pos.x, this.pos.z, this._g);
      const floor = this._g.y + def.cgHeight * 0.6;
      if (this.pos.y < floor) { this.pos.y = floor; this.vel.y = 0; }
      this.time += h;
      this._derive();
      return;
    }
    this.time += h;
    this.stats.flightTime += h;
    this.qInv.copy(this.quat).invert();

    // Environment at CG
    const g = this._g;
    env.ground(this.pos.x, this.pos.z, g);
    this.groundY = g.y;
    this.groundKind = g.kind;
    this.groundVel.copy(g.vel);
    this.radioAlt = this.pos.y - g.y - def.cgHeight;
    this.rho = rhoAt(this.pos.y);
    env.wind(this.pos, this.time, this._wind);
    this.vAirWorld.subVectors(this.vel, this._wind);
    this.vAirBody.copy(this.vAirWorld).applyQuaternion(this.qInv);

    this._systems(h);

    // Aero
    computeAero(this, this.aero);
    const F = this._F.copy(this.aero.F);
    const T = this._T.set(this.aero.M, -this.aero.N, -this.aero.L);

    // Engines
    for (const e of this.engines) {
      const t = e.thrust;
      F.z -= t;
      T.x += -e.pos.y * t;
      T.y += e.pos.x * t;
    }

    // To world
    const Fw = this._Fw.copy(F).applyQuaternion(this.quat);
    this._velBefore.copy(this.vel);

    // Contacts
    this._contacts(h, env, Fw, T);
    if (this.crashed) return;
    this._hook(h, env, Fw, T);

    // G load (non-gravitational accel, body-up component)
    this.accel.copy(Fw).multiplyScalar(1 / this.mass);
    this.gload = this.accel.dot(this.up) / G;
    if (this.gload > this.stats.maxG) this.stats.maxG = this.gload;
    if (this.gload < this.stats.minG) this.stats.minG = this.gload;

    Fw.y -= this.mass * G;

    // Integrate linear
    this.vel.addScaledVector(Fw, h / this.mass);
    this.pos.addScaledVector(this.vel, h);

    // Integrate angular: I = diag(pitch, yaw, roll)
    const I = def.inertia;
    const ox = this.omega.x, oy = this.omega.y, oz = this.omega.z;
    const Ix = I.pitch, Iy = I.yaw, Iz = I.roll;
    // gyroscopic term omega x (I omega)
    const gx = oy * (Iz * oz) - oz * (Iy * oy);
    const gy = oz * (Ix * ox) - ox * (Iz * oz);
    const gz = ox * (Iy * oy) - oy * (Ix * ox);
    this.omega.x += ((T.x - gx) / Ix) * h;
    this.omega.y += ((T.y - gy) / Iy) * h;
    this.omega.z += ((T.z - gz) / Iz) * h;
    const om = this.omega.length();
    if (om > 8) this.omega.multiplyScalar(8 / om);
    if (om > 1e-9) {
      this._ax.copy(this.omega).multiplyScalar(1 / om);
      this._dq.setFromAxisAngle(this._ax, om * h);
      this.quat.multiply(this._dq).normalize();
    }

    this._derive();

    // Stall statistics
    const st = this.aero.stall;
    if (st > 0.3 && !this.onGround && this.tas > 12) { this.stats.stallTime += h; if (!this._stalledNow) { this._stalledNow = true; this.stats.stalls++; if (this.radioAlt < this.flareZone()) this.stats.stallsLow++; if (this.stallHold) this.stats.stallsHeld++; this.events.push({ type: 'stall' }); } }
    else if (st < 0.1 || this.onGround) this._stalledNow = false;
    if (this.aero.warning && !this.onGround) { this.stats.stallWarnTime += h; if (this.radioAlt < this.flareZone()) this.stats.stallWarnTimeLow += h; }
    if (!this.onGround) {
      if (this.ias < this.stats.minIasAirborne) this.stats.minIasAirborne = this.ias;
      if (-this.vs > this.stats.maxSink) this.stats.maxSink = -this.vs;
    }
    // Slowly varying wing-drop bias
    this.stallBias = this.stallSign * (0.7 + 0.3 * Math.sin(this.time * 0.37));

    // CG below ground (tunnelled)
    if (this.pos.y < g.y - 0.5) this.crash('Flew into the terrain');
  }

  // ---------- systems ----------
  _systems(h) {
    const inp = this.input, ctl = this.ctl, def = this.def, fl = this.failures;
    const hyd = fl.has('hydraulics') ? 0.35 : 1;
    const rate = def.controls.rate * hyd;

    let eCmd = clamp(inp.pitch + inp.trim, -1, 1);
    let eRate = rate;
    if (fl.has('elevatorJam')) { eCmd = clamp(inp.trim * 0.6, -0.4, 0.4); eRate = 0.12; }
    ctl.elevator = approach(ctl.elevator, eCmd, eRate * h);
    ctl.aileron = approach(ctl.aileron, inp.roll, rate * h);
    ctl.rudder = approach(ctl.rudder, inp.yaw, rate * h);
    const steerFade = clamp(1 - this.gs / def.controls.steerFade, 0.12, 1);
    ctl.steer = ctl.rudder * steerFade * (fl.has('hydraulics') && def.controls.steerHydraulic ? 0.3 : 1);

    if (!fl.has('flapsStuck')) ctl.flap = approach(ctl.flap, inp.flapCmd, h / def.flaps.time);
    if (def.gearRetract) {
      if (!fl.has('gearStuck')) ctl.gear = approach(ctl.gear, inp.gearCmd ? 1 : 0, h / def.gearRetract.time);
    } else ctl.gear = 1;
    for (const l of this.legs) l.ext = l.stuckAt != null ? l.stuckAt : ctl.gear;
    if (def.hook) ctl.hook = approach(ctl.hook, inp.hookCmd ? 1 : 0, h / def.hook.time);

    // Spoilers / speedbrakes
    let sp = inp.spoiler ? 1 : 0;
    if (def.spoilers && inp.spoilerArmed && this.wheelsOnGround && this.gsRel > 12) { sp = 1; inp.spoiler = 1; inp.spoilerArmed = false; this.events.push({ type: 'spoilers' }); }
    if (!def.spoilers || (fl.has('hydraulics') && def.spoilerHydraulic)) sp = 0;
    ctl.spoiler = approach(ctl.spoiler, sp, h / 0.8);

    // Brakes
    let br = clamp(inp.brake, 0, 1);
    if (inp.autobrake > 0 && this.wheelsOnGround && this.groundTime > 0.8 && br < 0.05) br = inp.autobrake;
    if (fl.has('brakes')) br = 0;
    if (fl.has('hydraulics')) br *= 0.45;
    for (const l of this.legs) l.brakeInput = l.brake ? br : 0;

    // Engines
    let propExtra = 0;
    for (const e of this.engines) {
      if (e.failed) {
        e.throttle = approach(e.throttle, 0, h / 3);
        e.thrust = 0;
        e.rpm = approach(e.rpm, e.type === 'prop' ? 0.15 * clamp(this.tas / 30, 0, 1) : 0, h / 4);
        continue;
      }
      if (e.type === 'jet') {
        const rev = inp.reverse > 0 && this.wheelsOnGround && e.reverse;
        const tgt = rev ? clamp(inp.reverse, 0, 1) : inp.throttle;
        const tau = tgt > e.throttle ? (e.throttle < 0.55 ? e.tauUp * 1.35 : e.tauUp) : e.tauDown;
        e.throttle += (tgt - e.throttle) * (1 - Math.exp(-h / tau));
        const thr = e.idle + (1 - e.idle) * Math.pow(clamp(e.throttle, 0, 1), 1.25);
        let t = thr * e.maxThrust * (1 - 0.12 * clamp(this.tas / 120, 0, 1));
        if (rev) t = -e.reverse * thr * e.maxThrust;
        e.thrust = t;
        e.rpm = thr;
      } else {
        e.throttle += (inp.throttle - e.throttle) * (1 - Math.exp(-h / e.tauUp));
        const thr = clamp(e.throttle, 0, 1);
        const P = e.maxPower * (0.03 + 0.97 * thr);
        const V = Math.max(this.tas, 1);
        let t = Math.min(e.staticThrust * (0.03 + 0.97 * thr), (P * e.eta) / V);
        // prop drag at idle and high speed
        t -= 0.5 * this.rho * V * V * e.propArea * 0.012 * (1 - thr);
        e.thrust = t;
        e.rpm = 0.25 + 0.75 * thr;
        propExtra += Math.max(0, (2 * t) / (this.rho * e.propArea));
      }
    }
    const V = this.vAirBody.length();
    this.qTail = 0.5 * this.rho * (V * V + def.propwash * propExtra);
    this.powerFrac = this.engines.some((e) => !e.failed) ? clamp(this.engines[0].throttle, 0, 1) : 0;
    this.windmillDrag = this.engines.some((e) => e.failed && e.type === 'prop') ? def.windmillCD : 0;
    if (fl.has('ice')) this.ice = 1;
  }

  // ---------- contacts ----------
  _contacts(h, env, Fw, Tb) {
    const def = this.def;
    let wheelContact = false, bodyContact = false;
    const mainsBefore = this.wheelsOnGround;
    for (const l of this.legs) {
      if (l.ext < 0.97) { l.contact = false; l.load = 0; continue; }
      const radius = l.collapsed ? l.radius * 0.35 : l.radius;
      const k = l.collapsed ? l.k * 0.03 : l.k;
      const c = l.collapsed ? l.c * 0.2 : l.c;
      const N = this._contactPoint(l, true, h, env, Fw, Tb, radius, k, c, l.maxTravel);
      if (this.crashed) return;
      if (N > 0) {
        wheelContact = true;
        if (N > this.stats.maxLoad) this.stats.maxLoad = N;
        if (N > l.maxLoad && !l.collapsed) {
          l.collapsed = true;
          this.stats.gearCollapse = true;
          this.stats.damage.push(l.name + ' gear collapsed');
          this.events.push({ type: 'gearCollapse', leg: l.name, load: N });
        }
      }
    }
    for (const p of this.points) {
      const N = this._contactPoint(p, false, h, env, Fw, Tb, 0, p.k || 150000 * (this.mass / 1000), p.c || 6000 * (this.mass / 1000), 0.3);
      if (this.crashed) return;
      if (N > 0) {
        bodyContact = true;
        if (p.contactFirst) {
          p.contactFirst = false;
          const gsp = this.gs;
          if (p.crashSpeed != null && gsp > p.crashSpeed) return this.crash(p.crashMsg || 'Struck the ground');
          if (p.maxImpact != null && p.impact > p.maxImpact) return this.crash(p.crashMsg || 'Struck the ground');
          // survivable damage
          if (p.name === 'tail') { this.stats.tailstrike = true; if (!this.stats.damage.includes('Tail strike')) { this.stats.damage.push('Tail strike'); this.events.push({ type: 'tailstrike' }); } }
          else if (p.name === 'nose') {
            const dmg = this.stats.damage;
            if (def.engines[0].type === 'prop') { this.stats.propstrike = true; if (!dmg.includes('Propeller strike')) dmg.push('Propeller strike'); for (const e of this.engines) e.failed = true; }
            else if (!dmg.includes('Nose damage')) dmg.push('Nose damage');
            if (p.impact > 1.5) this.events.push({ type: 'nosestrike' });
          } else if (p.name.startsWith('wingtip')) { this.stats.wingtip = true; if (!this.stats.damage.includes('Wingtip scraped')) this.stats.damage.push('Wingtip scraped'); this.events.push({ type: 'wingtip' }); }
          else if (p.name.startsWith('nacelle')) { if (!this.stats.damage.includes('Engine nacelle scraped')) this.stats.damage.push('Engine nacelle scraped'); this.events.push({ type: 'scrape', name: p.name }); }
          else { this.stats.belly = true; if (!this.stats.damage.includes('Belly landing')) { this.stats.damage.push('Belly landing'); this.events.push({ type: 'belly' }); } }
        }
      } else p.contactFirst = true;
    }
    if (this.hookPt && this.ctl.hook > 0.9) {
      const hk = def.hook;
      const ang = hk.angle * this.ctl.hook;
      this.hookTipBody.set(hk.pivot.x, hk.pivot.y - hk.length * Math.sin(ang), hk.pivot.z + hk.length * Math.cos(ang));
      this.hookPt.pos.copy(this.hookTipBody);
      // the hook swings up against a soft damper: it never transmits big loads to the airframe
      this._contactPoint(this.hookPt, false, h, env, Fw, Tb, 0, 12000, 1500, 1.5);
      if (this.crashed) return;
    } else if (this.hookPt) { this.hookPt.contact = false; this.hookPt.load = 0; }

    const onGroundNow = wheelContact || bodyContact;
    this.wheelsOnGround = wheelContact;
    if (wheelContact) {
      // gear damping against roll and yaw rates on the ground (oleo/tire compliance)
      Tb.z -= this.omega.z * def.inertia.roll * 1.5;
      Tb.y -= this.omega.y * def.inertia.yaw * 0.4;
    }
    if (!this.onGround && onGroundNow) {
      const td = {
        t: this.time, vs: -this._velBefore.y, pitch: this.euler.pitch, roll: this.euler.roll, heading: this.euler.heading,
        ias: this.ias, gs: this.gs, alpha: this.aero.alpha, pos: this.pos.clone(), airborne: this.airborneTime,
        legs: this.legs.filter((l) => l.contact).map((l) => l.name), body: this.points.filter((p) => p.contact).map((p) => p.name),
        vlat: 0, vlon: 0, kind: this._g.kind, gload: this.gload, flap: this.ctl.flap, gear: this.ctl.gear,
      };
      const main = this.legs.find((l) => l.contact && l.main) || this.legs.find((l) => l.contact);
      if (main) { td.vlat = main.vlat; td.vlon = main.vlon; td.kind = main.kind; }
      if (this.stats.touchdown && this.airborneTime > 0.3) {
        this.stats.bounces++;
        this.stats.touchdowns.push(td);
        this.events.push({ type: 'bounce', td });
      } else if (!this.stats.touchdown) {
        this.stats.touchdown = td;
        this.stats.touchdowns.push(td);
        this.events.push({ type: 'touchdown', td });
        if (td.vs > def.limits.crashVS) return this.crash('Hard landing: airframe broke up');
      }
      this.airborneTime = 0;
    }
    if (onGroundNow) { this.groundTime += h; this.airborneTime = 0; }
    else {
      const was = this.airborneTime;
      this.airborneTime += h; this.groundTime = 0;
      if (was < 0.3 && this.airborneTime >= 0.3 && this.stats.touchdown) this.events.push({ type: 'liftoff' });
    }
    this.onGround = onGroundNow;
    if (mainsBefore !== wheelContact && wheelContact) { /* wheels on */ }

    // Stopped?
    this._vrel.subVectors(this.vel, this.groundVel);
    this.gsRel = Math.hypot(this._vrel.x, this._vrel.z);
    if (onGroundNow && this.gsRel < 0.4 && this.groundTime > 1.5 && !this.stopped && this.stats.touchdown) {
      this.stopped = true;
      this.events.push({ type: 'stopped' });
    }
  }

  _contactPoint(cp, isWheel, h, env, Fw, Tb, radius, k, c, maxTravel) {
    const rw = this._rw.copy(cp.pos).applyQuaternion(this.quat);
    const pw = this._pw.copy(this.pos).add(rw);
    const g = this._g;
    env.ground(pw.x, pw.z, g);
    const bottom = pw.y - radius;
    const pen = g.y - bottom;
    cp.kind = g.kind;
    if (pen <= 0) { cp.contact = false; cp.load = 0; cp.comp = 0; cp.skid = 0; return 0; }
    if (g.kind === 'water') return this.crash('Went into the water');
    if (g.kind === 'ramp') return this.crash('Ramp strike');
    if (g.kind === 'obstacle') return this.crash('Hit ' + (g.name || 'an obstacle'));
    if (g.kind === 'structure') return this.crash('Hit ' + (g.name || 'a structure'));

    const ow = this._ow.copy(this.omega).applyQuaternion(this.quat);
    const vc = this._vc.copy(ow).cross(rw).add(this.vel).sub(g.vel);
    const n = g.n;
    const cdot = -vc.dot(n);
    let N = k * pen + c * cdot;
    if (pen > maxTravel) N += k * 10 * (pen - maxTravel);
    if (N < 0) N = 0;
    if (!cp.contact) cp.impact = cdot;
    cp.contact = true; cp.load = N; cp.comp = pen;

    const f = this._f.copy(FWD).applyQuaternion(this.quat);
    f.addScaledVector(n, -f.dot(n));
    if (f.lengthSq() < 1e-4) f.set(1, 0, 0);
    f.normalize();
    if (isWheel && cp.steer) rotateAboutAxis(f, n, -this.ctl.steer * cp.steer);
    const side = this._side.copy(f).cross(n);
    const vlon = vc.dot(f), vlat = vc.dot(side);
    let Flon, Flat;
    const mu = g.mu * (cp.mu || 1);
    if (isWheel) {
      // lateral tire force from slip angle (saturates at ~8 deg), velocity-based when nearly stopped
      const ref = Math.max(0.5, Math.abs(vlon) * 0.14);
      Flat = -mu * N * clamp(vlat / ref, -1, 1);
      const brake = cp.brakeInput || 0;
      // anti-skid brakes: about 70% of the peak friction, never locking the wheel
      Flon = -N * (0.015 * clamp(vlon / 0.4, -1, 1) + mu * 0.72 * brake * clamp(vlon / 1.5, -1, 1));
      if (g.rough) Flon -= N * 0.03 * g.rough * clamp(vlon / 0.4, -1, 1);
      cp.wheelAngle += (vlon / Math.max(radius, 0.05)) * h;
      cp.skid = clamp((Math.abs(vlat) - 1.8) / 3, 0, 1);
      // friction circle with steering priority (anti-skid keeps directional control)
      const fmax = mu * N * 1.05;
      if (Math.abs(Flat) > fmax) Flat = Math.sign(Flat) * fmax;
      const rem = Math.sqrt(Math.max(0, fmax * fmax - Flat * Flat));
      if (Math.abs(Flon) > rem) Flon = Math.sign(Flon) * rem;
    } else {
      const vt = Math.hypot(vlon, vlat);
      const sc = -(mu * 0.7 * N) / Math.max(vt, 0.6);
      Flon = sc * vlon; Flat = sc * vlat;
      cp.skid = vt > 3 ? 1 : 0;
      const fm = Math.hypot(Flon, Flat), fmax = mu * N * 1.05;
      if (fm > fmax) { const s = fmax / fm; Flon *= s; Flat *= s; }
    }
    cp.vlon = vlon; cp.vlat = vlat;
    const F = this._Fc.copy(n).multiplyScalar(N).addScaledVector(f, Flon).addScaledVector(side, Flat);
    Fw.add(F);
    const rc = this._rc.copy(rw); rc.y -= radius;
    const tw = this._tw.copy(rc).cross(F).applyQuaternion(this.qInv);
    Tb.add(tw);
    return N;
  }

  // ---------- tailhook / arresting wires ----------
  _hook(h, env, Fw, Tb) {
    const car = env.carrier;
    const def = this.def;
    if (!car || !def.hook) return;
    if (this.ctl.hook < 0.9) { this.hookPrevU = null; return; }
    const tip = this.hookTipWorld.copy(this.hookTipBody).applyQuaternion(this.quat).add(this.pos);
    const dl = this._dl;
    car.deckLocal(tip, dl);
    const tr = this.trap;
    if (tr.engaged) {
      tr.t += h;
      const vrel = this._vrel.subVectors(this.vel, car.vel);
      const sp = vrel.length();
      if (sp < 1.0) {
        tr.engaged = false; tr.trapped = true;
        this.events.push({ type: 'trapped', wire: tr.wire });
      } else {
        const dec = def.hook.decel * Math.min(tr.t / 0.5, 1);
        const F = this._Fc.copy(vrel).multiplyScalar((-this.mass * dec) / sp);
        Fw.add(F);
        // the cable load reaches the airframe through the hook structure: act between tip and pivot
        const hk = def.hook;
        const rc = this._rc.set(hk.pivot.x, (hk.pivot.y + this.hookTipBody.y) * 0.5, (hk.pivot.z + this.hookTipBody.z) * 0.5).applyQuaternion(this.quat);
        const tw = this._tw.copy(rc).cross(F).applyQuaternion(this.qInv);
        Tb.add(tw);
        // wire also keeps you on the deck and centred: kill vertical bounce, damp yaw and roll
        if (this.vel.y > 0) this.vel.y *= Math.exp(-h * 6);
        Tb.y -= this.omega.y * def.inertia.yaw * 4;
        Tb.z -= this.omega.z * def.inertia.roll * 4;
        if (this.wheelsOnGround) Tb.x -= this.omega.x * def.inertia.pitch * 2;
      }
    } else if (this.hookPrevU != null && !tr.trapped) {
      if (dl.onDeck) {
        for (let i = 0; i < car.wires.length; i++) {
          const wu = car.wires[i];
          if (this.hookPrevU < wu && dl.u >= wu && Math.abs(dl.v) < car.wireHalfWidth && dl.h < 0.45 && this.hookPrevH < 0.8) {
            tr.engaged = true; tr.wire = i + 1; tr.t = 0;
            this.events.push({ type: 'wire', wire: i + 1, dl: { u: dl.u, v: dl.v } });
            break;
          }
        }
        if (!tr.engaged && !tr.boltered && dl.u > car.wires[car.wires.length - 1] + 5 && dl.h < 3.5) {
          tr.boltered = true;
          this.stats.goArounds++;
          this.events.push({ type: 'bolter' });
        }
      }
    }
    this.hookPrevU = dl.onDeck || dl.u < 0 ? dl.u : null;
    this.hookPrevH = dl.h;
  }

  // ---------- derived state ----------
  _derive() {
    this.fwd.copy(FWD).applyQuaternion(this.quat);
    this.up.copy(UP).applyQuaternion(this.quat);
    this.right.copy(RIGHT).applyQuaternion(this.quat);
    const f = this.fwd;
    const e = this.euler;
    e.pitch = Math.asin(clamp(f.y, -1, 1));
    e.heading = Math.atan2(f.x, -f.z);
    // roll from right vector vs level-right
    const lrx = -f.z, lrz = f.x; // level right = cross(fwd, up) projected
    const ln = Math.hypot(lrx, lrz) || 1;
    const lRx = lrx / ln, lRz = lrz / ln;
    const lUx = -f.y * lRz, lUy = ln, lUz = f.y * lRx; // level up = cross(levelRight, fwd) (unnormalised ok)
    const lun = Math.hypot(lUx, lUy, lUz) || 1;
    const r = this.right;
    const cr = r.x * lRx + r.z * lRz;
    const sr = -(r.x * lUx + r.y * lUy + r.z * lUz) / lun;
    e.roll = Math.atan2(sr, cr);
    this.tas = this.vAirWorld.length();
    this.ias = this.tas * Math.sqrt(this.rho / RHO0);
    this.gs = Math.hypot(this.vel.x, this.vel.z);
    this.vs = this.vel.y;
    this.alt = this.pos.y;
  }

  get headingDeg() { return ((this.euler.heading * 180) / Math.PI + 360) % 360; }
  get track() { return Math.atan2(this.vel.x, -this.vel.z); }
  get flightPath() { return Math.atan2(this.vel.y, this.gs || 0.01); }
}
