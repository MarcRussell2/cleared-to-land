// Failures (2026-09-17, the missions expansion): the catalogue, the triggers, every effect of
// src/systems/failureEffects.js, and the ten 'breaks' missions (src/missions/failures.js) flown to a landing by
// scripted pilots that use exactly the technique each mission's tips describe. Plain Node, no GPU.
//
//   node tools/test-failures.mjs                 the checks (npm test runs this)
//   node tools/test-failures.mjs --fly <id>      one mission, flown and logged every second
//   node tools/test-failures.mjs --page <CTL.html> [port] [ids] [seed]
//                                                the same pilots in the real game in headless Edge (every mission's
//                                                real site, the game's own scoring): points and grade per mission
//
// The Node flights run the game's frame order (main.js frame()): the pilot writes ac.input (as the debug autopilot
// does, so the flight control is not involved), the failure runtime's preStep, the physics step, the triggers, the
// postStep, at a fixed 1/25 s like the screenshot harness. The runway is the real site's runway on flat ground; the
// carrier is the real carrier. The wind is the real Wind with the flight seed.
import { Vector3 } from 'three';
import { readFileSync } from 'node:fs';
import { spawn as spawnProcess, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Aircraft } from '../src/physics/aircraft.js';
import { Wind } from '../src/physics/wind.js';
import { AIRCRAFT } from '../src/aircraft/defs.js';
import { Carrier } from '../src/world/carrier.js';
import { SITES, SCENARIOS, resolveScenario } from '../src/systems/scenarios.js';
import { FAILURES, applyFailure, shouldTrigger } from '../src/systems/malfunctions.js';
import { FailureRuntime, EFFECT_NAMES, crackPattern } from '../src/systems/failureEffects.js';
import { FAILURES_MISSIONS } from '../src/missions/failures.js';
import { MissionRuntime } from '../src/systems/mission.js';
import { Alarms } from '../src/audio-alarms.js';
import { NEW_MISSIONS, MISSION_GROUPS } from '../src/missions/index.js';
import { scoreLanding, vrefFor } from '../src/systems/scoring.js';
import { FlightControl } from '../src/systems/flightControl.js';
import { touchify } from '../src/touch.js';
import { KEY_HELP } from '../src/input.js';
import { KT, FT, FPM, DEG, RAD, clamp, wrapPi, makeRng, headingToVec } from '../src/config.js';

// ---------------------------------------------------------------------------------------------------------------
// The scripted pilots. One class, the Autoland's airmanship (src/systems/autopilot.js, copied rather than wrapped so
// that each technique can change what it looks at and how it moves the controls), plus a technique per mission.
// It writes ac.input like the autopilot does; `io.act(name)` is a key press (fireHandle, trimCutout, fuelCutoff,
// flapsDown, spoiler, ...), which in the game goes through main.js action() exactly as a key would.
// Everything between the two PILOTS markers is also injected into the real game by --page: it may use only KT, FT,
// DEG, clamp, wrapPi and vrefFor (the page mode defines those), no imports.
// ==== PILOTS BEGIN ====
export class MissionPilot {
  constructor(ac, world, sc, rt, io = {}) {
    this.ac = ac; this.world = world; this.sc = sc; this.rt = rt; this.io = io;
    const def = ac.def;
    this.jet = def.engines[0].type === 'jet';
    this.kp = this.jet ? 4.5 : 3.0; this.kd = this.jet ? 2.5 : 1.0;
    this.phase = 'approach';
    this.pitchRef = ac.euler.pitch; this.pitchInt = 0; this.thrInt = 0; this.thr0 = ac.input.throttle;
    this.flareT = 0; this.pitch0 = 0;
    this.flareInc = ({ skylark: 8, trailblazer: 9, condor: 3.5, hornet: 0 }[def.id] || 6) * DEG;
    this.flareTime = this.jet ? 3.5 : 3.0;
    this.vref = vrefFor(ac, sc) * KT;
    this.t = 0; this.memo = {}; this.log = [];
    this.tech = TECHNIQUES[io.tech || sc.id] || TECHNIQUES.plain;
  }
  act(name) { this.log.push(`${this.t.toFixed(1)}s ${name}`); if (this.io.act) this.io.act(name); }
  // what the pilot reads on the airspeed tape (the lying one, if the pitot has iced)
  get iasShown() { return this.rt && this.rt.sensed ? this.rt.sensed.ias : this.ac.ias; }
  geometry() {
    const w = this.world, ac = this.ac, p = ac.pos;
    if (w.carrier) {
      const c = w.carrier, td = c.tdWorld, dir = c.landDirWorld, right = c.landRightWorld;
      const dx = p.x - td.x, dz = p.z - td.z;
      const dToAim = -(dx * dir.x + dz * dir.z), v = dx * right.x + dz * right.z;
      return { dToAim, v, hDes: td.y + dToAim * Math.tan(3.5 * DEG) + 3.6 - (this.aimLow || 0), hdg: c.landingHeading(), right, gs: 3.5 * DEG, flareH: 0, aimY: td.y };
    }
    const rw = w.runway, dx = p.x - rw.threshold.x, dz = p.z - rw.threshold.z;
    const u = dx * rw.dir.x + dz * rw.dir.z, v = dx * rw.right.x + dz * rw.right.z;
    const gs = rw.gsAngle ? rw.gsAngle * DEG : ac.def.approach.glideslope;
    const dToAim = rw.aimDistance - u;
    return { dToAim, v, hDes: rw.aim.y + Math.max(0, dToAim) * Math.tan(gs) + ac.def.cgHeight, hdg: rw.heading, right: rw.right, gs, flareH: ac.def.approach.flareHeight, aimY: rw.aim.y, u };
  }
  update(dt) {
    const ac = this.ac, def = ac.def, inp = ac.input, T = this.tech;
    this.t += dt;
    const g = this.geometry();
    if (def.hook) inp.hookCmd = 1;
    if (def.gearRetract) inp.gearCmd = 1;
    if (T.before) T.before(this, g, dt);
    // ---- lateral: track the centreline ----
    const xteRate = ac.vel.x * g.right.x + ac.vel.z * g.right.z;
    const trk = ac.gs > 2 ? wrapPi(ac.track - g.hdg) : 0;
    const rollCmd = clamp(-0.015 * g.v - 0.05 * xteRate - 1.0 * trk + (this.bankBias || 0), -0.4, 0.4);
    inp.roll = clamp(2.5 * (rollCmd - ac.euler.roll) + 0.8 * ac.omega.z, -1, 1);
    inp.yaw = clamp(1.5 * ac.aero.beta + (this.yawBias || 0), -1, 1);
    if (T.lateral) T.lateral(this, g, rollCmd, xteRate, trk, dt);
    // ---- vertical and speed ----
    let pitchCmd = ac.euler.pitch;
    const ias = T.ias ? T.ias(this) : this.iasShown;
    const speedErr = (this.vTarget || this.vref) - ias;
    if (this.phase === 'approach') {
      const closure = Math.max(ac.gs - (this.world.carrier ? this.world.carrier.speed : 0), 5);
      const vsDes = clamp(-closure * Math.tan(g.gs) + (this.world.carrier ? 0.25 : 0.15) * (g.hDes - ac.pos.y), -9, 3);
      const vsErr = vsDes - ac.vs;
      this.pitchInt = clamp(this.pitchInt + 0.004 * vsErr * dt, -0.12, 0.12);
      pitchCmd = this.pitchRef + 0.025 * vsErr + this.pitchInt;
      const kt = this.jet ? 0.035 : 0.06, ki = this.jet ? 0.012 : 0.03;
      this.thrInt = clamp(this.thrInt + ki * speedErr * dt, -0.5, 0.5);
      inp.throttle = clamp(this.thr0 + kt * speedErr + this.thrInt - 0.01 * vsErr, 0, 1);
      if (ac.aero.alpha > ac.aero.alphaStall - 3 * DEG) pitchCmd = Math.min(pitchCmd, ac.euler.pitch - 2 * DEG);   // the stall warning is honest
      if (ac.aero.warning) inp.throttle = Math.max(inp.throttle, 0.8);
      if (T.approach) pitchCmd = T.approach(this, g, pitchCmd, vsErr, speedErr, dt) ?? pitchCmd;
      if (g.flareH > 0 && ac.radioAlt < g.flareH) { this.phase = 'flare'; this.flareT = 0; this.pitch0 = ac.euler.pitch; }
      if (this.world.carrier && g.dToAim < 40 && ac.wheelsOnGround) { this.phase = 'rollout'; this.pitch0 = ac.euler.pitch; this.flareT = 0; }
    } else if (this.phase === 'flare') {
      this.flareT += dt;
      inp.throttle = Math.max(0, inp.throttle - dt * (this.jet ? 0.4 : 0.8));
      pitchCmd = this.pitch0 + this.flareInc * Math.min(this.flareT / this.flareTime, 1);
      if (def.limits.tailStrikePitch < 1) pitchCmd = Math.min(pitchCmd, def.limits.tailStrikePitch - 2 * DEG);
      if (T.flare) pitchCmd = T.flare(this, g, pitchCmd, dt) ?? pitchCmd;
    }
    if (ac.stats.touchdown && this.phase !== 'rollout' && this.phase !== 'bolter') { this.phase = 'rollout'; this.pitch0 = ac.euler.pitch; this.flareT = 0; }
    if (this.world.carrier && ac.trap.boltered && !ac.trap.engaged && !ac.trap.trapped) this.phase = 'bolter';
    if (this.phase === 'bolter') {
      inp.throttle = 1; pitchCmd = ac.radioAlt > 30 ? 8 * DEG : 10 * DEG;
      inp.roll = clamp(-2.0 * ac.euler.roll + 0.5 * ac.omega.z, -1, 1);
    } else if (this.phase === 'rollout') {
      this.flareT += dt;
      if (this.world.carrier) {
        inp.throttle = ac.trap.engaged || ac.trap.trapped ? 0 : 1;
        if (ac.trap.trapped) inp.brake = 1;
        pitchCmd = ac.trap.engaged || ac.trap.trapped ? this.pitch0 + (-1 * DEG - this.pitch0) * Math.min(this.flareT / 1.5, 1) : this.pitch0;
      } else {
        inp.throttle = 0;
        const derot = this.jet ? 4 : 1.5;
        pitchCmd = this.pitch0 + (-2 * DEG - this.pitch0) * Math.min(this.flareT / derot, 1);
        if (ac.groundTime > 1.5) inp.brake = 0.8;
        if (def.engines[0].reverse) inp.reverse = ac.gs > 25 ? 0.8 : 0;
        if (def.spoilers) inp.spoiler = 1;
      }
      const hdgErr = wrapPi(ac.euler.heading - g.hdg);
      inp.yaw = clamp(-0.05 * g.v - 0.1 * xteRate - 1.5 * hdgErr, -1, 1);
      inp.roll = clamp(-2.0 * ac.euler.roll + 0.5 * ac.omega.z, -1, 1);
      if (T.rollout) pitchCmd = T.rollout(this, g, dt, pitchCmd) ?? pitchCmd;
    }
    // pitchFF: the elevator a technique holds on top of the loop (the trim it flies without, see runaway-trim)
    inp.pitch = clamp(this.kp * (pitchCmd - ac.euler.pitch) - this.kd * ac.omega.x + (this.pitchFF || 0), -1, 1);
    if (T.after) T.after(this, g, dt);
    // io.human: only what a person at the keyboard has. The pedals move at the rudder keys' ramp (src/input.js: 0.4 s
    // to full, 1/6 s back), and on the wheels the ailerons get the assist mode's 60% (src/systems/flightControl.js).
    if (this.io.human) {
      const y = this.pedal ?? 0, want = inp.yaw;
      this.pedal = want > y ? Math.min(want, y + (y >= 0 ? 2.5 : 6) * dt) : Math.max(want, y - (y <= 0 ? 2.5 : 6) * dt);
      inp.yaw = this.pedal;
      if (ac.wheelsOnGround) inp.roll = clamp(inp.roll, -0.6, 0.6);
    }
  }
}

// A flare flown on the sink rate rather than a set pitch change: what a pilot does when the power is doing something
// unusual (cut, stuck, gone). The nose comes up until the descent slows to a few hundred feet a minute near the ground.
function sinkFlare(p, g, pitchCmd, dt, { k = 1.2, floor = 0.5 } = {}) {
  const ac = p.ac, h = Math.max(0, ac.radioAlt);
  const vsT = -clamp(floor + 0.22 * h, floor, 3.2);
  let pc = ac.euler.pitch + clamp(k * (vsT - ac.vs), -2, 4) * DEG;
  if (ac.def.limits.tailStrikePitch < 1) pc = Math.min(pc, ac.def.limits.tailStrikePitch - 2.5 * DEG);
  return pc;
}

// Each mission's technique, from its tips. A hook returns nothing to keep what the base pilot decided.
const TECHNIQUES = {
  plain: {},
  // Tips: flaps 40, gear down, speedbrake out (K twice); fly the glideslope with pitch and accept the speed; at 30 ft
  // cut the fuel (U); no reverse, brake hard.
  'stuck-throttle': {
    before(p) {
      const f = p.rt.get('stuckThrottle'), ac = p.ac, m = p.memo;
      if (!f) return;
      if (m.seen == null) m.seen = p.t;
      const since = p.t - m.seen;
      if (since > 1.5 && !m.flap) { m.flap = true; if (ac.input.flapCmd < 0.99) p.act('flapsDown'); }
      if (since > 2.5 && !m.k1) { m.k1 = true; p.act('spoiler'); }
      if (since > 3.2 && !m.k2) { m.k2 = true; p.act('spoiler'); }
      // the cut and the flare together: from here it is a glide onto the runway
      if (!f.cut && !ac.onGround && ac.radioAlt < 30 * FT) { p.act('fuelCutoff'); if (p.phase === 'approach') { p.phase = 'flare'; p.flareT = 0; p.pitch0 = ac.euler.pitch; } }
    },
    flare: (p, g, pc, dt) => sinkFlare(p, g, pc, dt),
  },
  // Tips: trim cutout the moment the clacker starts (D); hold the nose up with the stick and wind the trim back with T
  // (a slow manual wheel now); then an ordinary landing with the spoilers armed. The pilot flies with the whole trim in
  // its stick and the trim channel at zero, which is what the assist mode's stick does: full stick is all the elevator
  // there is, so a runaway past about half of it is more than the stick can hold (the scripted pilot gets no more
  // authority than a person does).
  'runaway-trim': {
    before(p, g, dt) {
      const ac = p.ac, m = p.memo, f = p.rt.get('runawayTrim');
      if (m.ff == null) { m.ff = ac.input.trim; m.trim = 0; }
      p.pitchFF = m.ff;
      if (p.t > 2 && !m.armed) { m.armed = true; p.act('spoiler'); }
      if (f) {
        if (m.heard == null) m.heard = p.t;
        if (!f.cut && p.t - m.heard > 2.5) p.act('trimCutout');
        if (f.cut && f.bias < -0.02) m.trim += (0.12 + Math.min(1.5, p.t - (m.wind ?? (m.wind = p.t))) * 0.15) * dt;   // holding T
      }
      ac.input.trim = m.trim;
    },
  },
  // Tips: fly the airplane first; left rudder through the surges or shut the engine down with the fire handle (A);
  // then the one-engine landing, rudder toward the good engine with power. This pilot rides out a few surges, then
  // secures the engine. Its rudder is the sideslip ball (what "rudder toward the good engine" comes to).
  'bird-strike': {
    before(p) {
      const f = p.rt.get('birdStrike'), m = p.memo;
      if (!f) return;
      if (m.hit == null) m.hit = p.t;
      if (!f.surge.shut && p.t - m.hit > 8) p.act('fireHandle');
    },
  },
  // Tips: pitch and power (1.5° nose up, throttle 24% = Vref at flaps 30, gear down); ground speed and the stall
  // warning are honest; do not chase the airspeed tape. This pilot never looks at the airspeed: the attitude is set,
  // and power (with a degree of pitch either way) holds the glideslope.
  'unreliable-ias': {
    approach(p, g, pc, vsErr, speedErr, dt) {
      const ac = p.ac, m = p.memo;
      m.pi = clamp((m.pi ?? 0) + 0.012 * vsErr * dt, -0.15, 0.15);
      ac.input.throttle = clamp(0.24 + 0.06 * vsErr + m.pi, 0, 1);
      if (ac.aero.warning) ac.input.throttle = Math.max(ac.input.throttle, 0.8);
      return 1.5 * DEG + clamp(0.4 * vsErr, -1.2, 1.2) * DEG;
    },
  },
  // Tips: flaps 40, Vref, ignore the gear horn; cut the fuel at about 50 ft (U); a gentle flare, wings level, no more
  // than a few degrees of nose-up (the pods touch first); rudder to keep it straight while it slides.
  'belly-landing': {
    before(p) {
      const f = p.rt.get('gearUp'), ac = p.ac, m = p.memo;
      if (!f) return;
      ac.input.gearCmd = 0;
      if (p.t > 2 && !m.flap) { m.flap = true; p.act('flapsDown'); }
      if (!f.cut && !ac.onGround && ac.radioAlt < 50 * FT) p.act('fuelCutoff');
    },
    flare: (p, g, pc, dt) => Math.min(sinkFlare(p, g, pc, dt, { floor: 0.45 }), 3 * DEG),
  },
  // Tips: steer with rudder (Q/E), small and early, the bank follows the yaw; hold a little left pedal against the
  // jam; flare as usual, and on the ground the rudder steers. The ailerons are whatever the jam says: this pilot's
  // roll is all pedal (bank error and roll rate into rudder; the sideslip that makes is what rolls it).
  'jammed-aileron': {
    lateral(p, g, rollCmd) {
      const ac = p.ac;
      if (ac.onGround) return;
      ac.input.roll = 0;
      ac.input.yaw = clamp(2.2 * (rollCmd - ac.euler.roll) + 0.9 * ac.omega.z - 0.9 * ac.omega.y * 0, -1, 1);
    },
  },
  // Tips: touch down on the right wheel first (a little right bank, left rudder to keep straight); keep turning the
  // stick right as it slows so the left wing stays up; right rudder when the stub digs in.
  'one-wheel': {
    lateral(p, g, rollCmd, xteRate, trk) {
      const ac = p.ac;
      if (ac.onGround || ac.radioAlt > 12 * FT) return;
      const hdgErr = wrapPi(ac.euler.heading - g.hdg);
      ac.input.roll = clamp(2.5 * (3 * DEG - ac.euler.roll) + 0.8 * ac.omega.z, -1, 1);
      ac.input.yaw = clamp(-2.5 * hdgErr - 0.04 * g.v - 0.08 * xteRate, -1, 1);
    },
    rollout(p, g, dt, pc) {
      const ac = p.ac;
      // the stick goes over to the right as far as it takes to keep the wings level, which is further and further
      ac.input.roll = clamp(8 * (2 * DEG - ac.euler.roll) + 1.2 * ac.omega.z, -1, 1);
      ac.input.brake = ac.gs < 12 ? 0.5 : 0;
      return ac.gs > 15 ? Math.max(pc, 5 * DEG) : pc;   // and the nose stays up: the wing lifts for as long as it flies
    },
  },
  // Tips: hook, gear, full flaps; on-speed AoA (8.1°) with pitch, the glide path with the throttle by the numbers
  // (the HUD altitude against the distance on the status line, which moves in 0.1 NM steps); what Paddles says, the
  // moment he says it; no flare, full power at touchdown. This pilot never reads the ball, and knows the glide path
  // only from the numbers, which it reads out of the tips themselves (so they are the numbers that were proven); the
  // geometry's hDes is not used.
  'no-ball': {
    approach(p, g, pc, vsErr, speedErr, dt) {
      const ac = p.ac, m = p.memo, c = p.world.carrier, lso = p.rt.lso;
      if (!m.nb) {
        const x = /1 NM (\d+) ft, half a mile (\d+) ft, over the ramp (\d+) ft/.exec((p.sc.tips || []).join(' '));
        if (!x) throw new Error('no-ball: the numbers are not in the tips');
        m.nb = [+x[3], +x[2], +x[1]];   // at 0, 0.5 and 1 NM
      }
      const nb = m.nb;
      // The status line: "0.7 NM to the ramp", one decimal. The moment it ticks over (0.3 to 0.2) the ramp is 0.25 NM
      // away; in between, the distance runs down at the closing speed. The numbers in between by eye, and at the same
      // rate beyond 1 NM.
      const dl = c.deckLocal(ac.pos, m.dl || (m.dl = { u: 0, v: 0, h: 0, onDeck: false }));
      const shown = Math.round(-dl.u / 1852 * 10) / 10, closure = Math.max(ac.gs - c.speed, 5);
      if (m.shown == null) m.r = shown * 1852;
      else if (shown !== m.shown) m.r = (shown + m.shown) / 2 * 1852;
      else m.r -= closure * dt;
      m.shown = shown; m.r = clamp(m.r, (shown - 0.05) * 1852, (shown + 0.05) * 1852);
      const nm = Math.max(0, m.r / 1852);
      const hT = (nm <= 0.5 ? nb[0] + (nb[1] - nb[0]) * nm / 0.5 : nb[1] + (nb[2] - nb[1]) * (nm - 0.5) / 0.5) * FT;
      const perM = (nb[2] - nb[0]) * FT / 1852;                        // the numbers' own descent, per metre flown
      const vsDes = clamp(-closure * perM + 0.15 * (hT - ac.alt), -5, 2), e = vsDes - ac.vs;
      m.hT = hT;   // (--fly prints it)
      // The glide path with the throttle, on top of the power it was trimmed with (p.thr0): the sink rate against the
      // one wanted, the power that takes (built up slowly), and a hand that eases off as the sink rate starts to change
      // (a jet's thrust comes late, so a pilot leads it). Paddles' calls go into the power, once each.
      if (m.ti == null) { m.ti = 0; m.p = ac.euler.pitch; m.acc = 0; }
      m.ti = clamp(m.ti + 0.025 * e * dt, -0.5, 0.5);
      if (lso && lso.t > (m.heard ?? -1)) {
        m.heard = lso.t;
        if (/Power!/.test(lso.call)) m.ti += 0.12; else if (/little power/.test(lso.call)) m.ti += 0.03; else if (/Power/.test(lso.call)) m.ti += 0.075;
        else if (/high/.test(lso.call)) m.ti -= /little/.test(lso.call) ? 0.03 : 0.06;
      }
      if (m.vs0 != null) m.acc += ((ac.vs - m.vs0) / dt - m.acc) * Math.min(1, dt / 0.5);
      m.vs0 = ac.vs;
      ac.input.throttle = clamp(p.thr0 + m.ti + 0.1 * e - 0.4 * m.acc, 0, 1);
      if (ac.aero.warning) ac.input.throttle = Math.max(ac.input.throttle, 0.9);
      // On-speed AoA with pitch: the attitude eased up or down as the AoA drifts off the ON SPD mark.
      const aerr = ac.aero.alpha - ac.def.approach.onSpeedAoA;
      m.p = clamp(m.p - 0.3 * aerr * dt, -2 * DEG, 12 * DEG);
      return m.p - 0.3 * aerr;
    },
  },
  // Tips: pull the fire handle (A); then the One Engine landing.
  'engine-fire': {
    before(p) {
      const f = p.rt.get('engineFire'), m = p.memo;
      if (!f) return;
      if (m.bell == null) m.bell = p.t;
      if (!f.out && p.t - m.bell > 3) p.act('fireHandle');
    },
  },
  // Tips: the standby airspeed and altimeter, the PAPI, the runway lights, flare by the edge lights. None of that needs
  // the HUD, and neither does this pilot: it flies the path (the PAPI's) and the true airspeed (the standby's).
  'dark-cockpit': {},
  // For the checks that a failure left alone ends badly: the same pilot, but it never touches the failure's key.
  ignore: {},
};
// ==== PILOTS END ====

// ---------------------------------------------------------------------------------------------------------------
// A mission flight in Node: the site's runway (flat ground) or the carrier, the real wind, main.js's frame order.
function makeRunway(site) {
  const d = site.runways[0];
  const heading = d.heading * DEG;
  const dir = headingToVec(heading, new Vector3());
  const right = new Vector3(-dir.z, 0, dir.x);
  const threshold = new Vector3(d.x, d.elevation, d.z);
  const aimDistance = d.aimDistance || Math.min(400, d.length * 0.15);
  const aim = threshold.clone().addScaledVector(dir, aimDistance); aim.y = d.elevation + (d.slope || 0) * aimDistance;
  return { ...d, heading, dir, right, threshold, aim, aimDistance, slope: d.slope || 0, surface: d.surface || 'asphalt' };
}
export function makeWorld(site, sc) {
  if (site.carrier) {
    const carrier = new Carrier({ ...site.carrier, seaState: sc.seaState ?? site.carrier.seaState, x: 0, z: 0 });
    const ground = (x, z, o) => { if (carrier.ground(x, z, o)) return; o.y = 0; o.n.set(0, 1, 0); o.mu = 0.1; o.kind = 'water'; o.vel.set(0, 0, 0); o.rough = 0; o.name = ''; };
    return { site, carrier, runway: null, ground };
  }
  const rw = makeRunway(site);
  const ground = (x, z, o) => {
    const dx = x - rw.threshold.x, dz = z - rw.threshold.z;
    const u = dx * rw.dir.x + dz * rw.dir.z, v = dx * rw.right.x + dz * rw.right.z;
    o.n.set(0, 1, 0); o.vel.set(0, 0, 0); o.name = '';
    if (u >= -5 && u <= rw.length + 5 && Math.abs(v) <= rw.width / 2 + 1) { o.y = rw.elevation + rw.slope * u; o.mu = rw.wet ? 0.5 : 0.85; o.kind = 'runway'; o.rough = 0; return; }
    o.y = rw.elevation; o.mu = 0.6; o.kind = 'grass'; o.rough = 0.3;
  };
  return { site, carrier: null, runway: rw, ground };
}
function spawn(ac, w, sc, wind) {
  const def = ac.def, sp = sc.spawn;
  const dist = sp.dist || 5000;
  let pos, heading, gsAngle;
  if (w.carrier) {
    const c = w.carrier;
    heading = c.landingHeading();
    pos = c.tdWorld.clone().addScaledVector(c.landDirWorld, -dist);
    gsAngle = 3.5 * DEG;
    pos.y = c.tdWorld.y + dist * Math.tan(gsAngle) + 3;
    ac.input.hookCmd = 1; ac.ctl.hook = 1;
  } else {
    const rw = w.runway;
    heading = rw.heading;
    const u = sp.u != null ? sp.u : -dist, v = sp.v != null ? sp.v : (sp.offset || 0);
    pos = rw.threshold.clone().addScaledVector(rw.dir, u).addScaledVector(rw.right, v);
    if (sp.hdg) heading += sp.hdg * DEG;
    gsAngle = (rw.gsAngle || (def.approach.glideslope * RAD)) * DEG;
    pos.y = rw.aim.y + (rw.aimDistance - u) * Math.tan(gsAngle) + def.cgHeight;
    if (sp.alt != null) { const g = { y: 0, n: new Vector3(), vel: new Vector3() }; w.ground(pos.x, pos.z, g); pos.y = Math.max(g.y, rw.elevation) + sp.alt; }
  }
  ac.pos.copy(pos);
  ac.input.gearCmd = sp.gear === false ? 0 : 1;
  ac.ctl.gear = ac.input.gearCmd;
  const flap = sp.flap ?? 0;
  const speed = (sp.speedKt || sc.scoring?.vref || def.speeds.Vref) * KT;
  const windVec = wind.at(pos, 0, new Vector3());
  const gamma = sp.gamma != null ? sp.gamma * DEG : sp.alt != null ? -1.5 * DEG : -gsAngle;
  ac.trim(heading, speed, gamma, flap, windVec);
  for (const e of ac.engines) e.throttle = ac.input.throttle;
  if (def.spoilers && !w.carrier && def.id === 'condor') ac.input.spoilerArmed = false;
  ac._derive();
}
function distTo(w, ac) {
  if (w.runway) { const rw = w.runway; const dx = ac.pos.x - rw.threshold.x, dz = ac.pos.z - rw.threshold.z; return -(dx * rw.dir.x + dz * rw.dir.z); }
  const dl = w.carrier.deckLocal(ac.pos, { u: 0, v: 0, h: 0, onDeck: false }); return -dl.u;
}

// The keys a pilot presses that are not failure actions (main.js action()): flaps, gear, spoilers.
function gameAction(ac, a) {
  const def = ac.def;
  if (a === 'flapsDown' || a === 'flapsUp') { const d = def.flaps.detents; let i = d.findIndex((x) => Math.abs(x - ac.input.flapCmd) < 0.01); if (i < 0) i = 0; i = clamp(i + (a === 'flapsDown' ? 1 : -1), 0, d.length - 1); ac.input.flapCmd = d[i]; }
  else if (a === 'gear' && def.gearRetract) ac.input.gearCmd = ac.input.gearCmd ? 0 : 1;
  else if (a === 'spoiler' && def.spoilers) {
    if (ac.wheelsOnGround) { ac.input.spoiler = ac.input.spoiler ? 0 : 1; ac.input.spoilerArmed = false; }
    else if (ac.input.spoilerArmed) { ac.input.spoilerArmed = false; ac.input.spoiler = 1; }
    else if (ac.input.spoiler) ac.input.spoiler = 0;
    else ac.input.spoilerArmed = true;
  }
}

export function flyMission(scBase, { seed = 307, logEvery = 0, maxT = 400, pilot = true, tech = null, human = false } = {}) {
  const sc = resolveScenario(scBase, makeRng(seed), { approach: 'short' });
  const site = SITES[sc.site];
  const w = makeWorld(site, sc);
  const def = AIRCRAFT[sc.aircraft];
  const ac = new Aircraft(def, { mass: def.massOptions[sc.weight] || def.mass });
  const rwHeading = w.runway ? w.runway.heading : w.carrier.landingHeading();
  const wd = sc.wind;
  const wind = new Wind();
  wind.set({ dir: wd.dir != null ? wd.dir : ((rwHeading * RAD + (wd.rel || 0)) + 720) % 360, speed: wd.speed || 0, gust: wd.gust, turb: wd.turb || 0, shear: wd.shear || 0, seed });
  wind.groundY = w.runway ? site.runways[0].elevation : 0;
  const env = { wind: (p, t, o) => wind.at(p, t, o), ground: w.ground, carrier: w.carrier };
  ac.stallSign = seed % 2 ? 1 : -1;
  spawn(ac, w, sc, wind);
  const inp = { yaw: 0, trim: ac.input.trim, throttle: ac.input.throttle, keys: new Set() };
  const rt = new FailureRuntime(ac, sc, { seed });
  const actions = [];
  const p = pilot ? new MissionPilot(ac, w, sc, rt, { act: (a) => actions.push(a), tech, human }) : null;
  const ap = { gsErr: 0, locErr: 0, spdErr: 0, gsSamples: 0, ballErr: 0, lineupErr: 0, aoaErr: 0, carrierSamples: 0, lowAtRamp: false, tdU: 0, tdV: 0, stopU: 0, offRunway: false, overran: false, noseDownSpeed: null, runway: w.runway };
  const dt = 1 / 25;
  let t = 0, endT = 0, done = false, nextLog = 0;
  const events = [];
  const mb = { cells: 0, inRange: false };
  while (!done && t < maxT) {
    t += dt;
    for (const a of actions.splice(0)) if (!rt.action(a)) gameAction(ac, a);
    if (p) p.update(dt);
    inp.trim = ac.input.trim; inp.throttle = ac.input.throttle;
    rt.preStep(dt, ac, inp);
    if (w.carrier) w.carrier.update(dt);
    ac.step(dt, env);
    for (const e of ac.events) { events.push({ t: +t.toFixed(2), type: e.type, info: e.reason || e.wire || e.leg || (e.td ? `${Math.round(e.td.vs / FPM)} fpm ${e.td.legs.join('+')}` : '') }); if (e.type === 'belly' || e.type === 'nosestrike') if (ap.noseDownSpeed == null) ap.noseDownSpeed = ac.gs; }
    ac.events.length = 0;
    rt.check(ac, { t, distToThreshold: distTo(w, ac) });
    rt.postStep(dt, ac);
    if (w.carrier) { const m = w.carrier.meatball(ac.pos, 3); Object.assign(mb, m); rt.meatball = m; logCarrier(ap, ac, m); }
    else logRunway(ap, ac, w.runway, sc);
    if (logEvery && t >= nextLog) { nextLog = t + logEvery; console.log(fmtState(t, ac, w, rt, p)); }
    if (ac.crashed) { endT += dt; if (endT > 3.5) done = true; }
    else if (ac.stopped) { endT += dt; if (endT > 2) done = true; }
    else if (ac.trap.trapped && ac.gsRel < 1) { endT += dt; if (endT > 2.5) done = true; }
  }
  if (w.runway) {
    const rw = w.runway, dx = ac.pos.x - rw.threshold.x, dz = ac.pos.z - rw.threshold.z;
    ap.stopU = dx * rw.dir.x + dz * rw.dir.z;
    const v = dx * rw.right.x + dz * rw.right.z;
    if (ac.stats.touchdown && !ac.crashed) { if (ap.stopU > rw.length + 2) ap.overran = true; else if (Math.abs(v) > rw.width / 2 + 1 || ap.stopU < -2) ap.offRunway = true; }
    if (ac.stats.touchdown) { const td = ac.stats.touchdown.pos, tx = td.x - rw.threshold.x, tz = td.z - rw.threshold.z; ap.tdU = tx * rw.dir.x + tz * rw.dir.z; ap.tdV = tx * rw.right.x + tz * rw.right.z; }
  }
  const result = rt.score(scoreLanding(ac, sc, ap), ac, ap);
  return { sc, ac, rt, pilot: p, result, events, t, ap, w };
}
function logRunway(ap, ac, rw, sc) {
  if (ac.onGround || ac.crashed) return;
  const dx = ac.pos.x - rw.threshold.x, dz = ac.pos.z - rw.threshold.z;
  const u = dx * rw.dir.x + dz * rw.dir.z, v = dx * rw.right.x + dz * rw.right.z;
  if (u < -100 && u > -2500) {
    const gsRef = rw.gsAngle || ac.def.approach.glideslope * RAD;
    const ang = Math.atan2(ac.pos.y - rw.aim.y, rw.aimDistance - u) * RAD;
    ap.gsErr += Math.abs(ang - gsRef) / 0.5; ap.locErr += Math.abs(Math.atan2(v, rw.aimDistance - u) * RAD) / 0.8; ap.gsSamples++;
    ap.spdErr += Math.abs(ac.ias - vrefFor(ac, sc) * KT);
  }
}
function logCarrier(ap, ac, mb) {
  if (ac.onGround || ac.crashed || !mb.inRange || mb.range > 1300 || mb.range < 30) return;
  ap.ballErr += Math.abs(mb.cells); ap.lineupErr += Math.abs(mb.dl.v); ap.aoaErr += Math.abs(ac.aero.alpha - ac.def.approach.onSpeedAoA) * RAD; ap.carrierSamples++;
  if (mb.dl.u > -15 && mb.dl.u < 0 && mb.dl.h < 5.5) ap.lowAtRamp = true;
}
function fmtState(t, ac, w, rt, p) {
  const d = distTo(w, ac);
  const sens = rt.sensed ? ` shown ${(rt.sensed.ias / KT).toFixed(0)}` : '';
  return `${t.toFixed(1).padStart(6)}s d=${d.toFixed(0).padStart(6)} ra=${(ac.radioAlt / FT).toFixed(0).padStart(5)}ft ias=${(ac.ias / KT).toFixed(0)}${sens} vs=${(ac.vs / FPM).toFixed(0).padStart(5)} pitch=${(ac.euler.pitch * RAD).toFixed(1)} roll=${(ac.euler.roll * RAD).toFixed(1)} beta=${(ac.aero.beta * RAD).toFixed(1)} thr=${ac.input.throttle.toFixed(2)} trim=${ac.input.trim.toFixed(2)} el=${ac.ctl.elevator.toFixed(2)} ail=${ac.ctl.aileron.toFixed(2)} rud=${ac.ctl.rudder.toFixed(2)} flap=${ac.ctl.flap.toFixed(2)} spl=${ac.ctl.spoiler.toFixed(1)} aoa=${(ac.aero.alpha * RAD).toFixed(1)}${p && p.memo.hT != null ? ` target=${(p.memo.hT / FT).toFixed(0)}ft alt=${(ac.alt / FT).toFixed(0)}ft` : ''} ${p ? p.phase : ''}${ac.crashed ? ' CRASH ' + ac.crashReason : ''}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The checks.
let fails = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fails++; };
const noFn = (k, v) => (typeof v === 'function' ? undefined : v);
const AIR = { wind: (p, t, o) => o.set(0, 0, 0), ground: (x, z, o) => { o.y = 0; o.n.set(0, 1, 0); o.mu = 0.85; o.kind = 'runway'; o.vel.set(0, 0, 0); o.rough = 0; o.name = ''; }, carrier: null };
function airborne(id, { kt = null, flap = null, alt = 500, gear = 1 } = {}) {
  const def = AIRCRAFT[id], ac = new Aircraft(def, { mass: def.mass });
  ac.pos.set(0, alt, 0); ac.ctl.gear = gear; ac.input.gearCmd = gear;
  ac.trim(0, (kt || def.speeds.Vref) * KT, -3 * DEG, flap ?? (id === 'condor' ? 0.75 : id === 'skylark' ? 0.667 : 1), new Vector3());
  for (const e of ac.engines) e.throttle = ac.input.throttle;
  ac._derive();
  return ac;
}
// main.js's frame order around a pilot that holds its inputs (or `each` writes them)
function run(ac, rt, seconds, each = null, inp = { yaw: 0, trim: 0 }) {
  const dt = 1 / 25;
  for (let i = 0, n = Math.round(seconds * 25); i < n; i++) {
    rt.tFlight = (rt.tFlight || 0) + dt;
    if (each) each(rt.tFlight, ac, inp);
    rt.preStep(dt, ac, inp);
    ac.step(dt, AIR);
    ac.events.length = 0;
    rt.check(ac, { t: rt.tFlight, distToThreshold: 1e9 });
    rt.postStep(dt, ac);
  }
}
const sentences = (s) => (s.match(/[.!?](\s|$)/g) || []).length;

function runChecks() {
  const t0 = Date.now();
  const defsBefore = JSON.stringify(AIRCRAFT, noFn);
  const scenariosBefore = JSON.stringify(SCENARIOS, noFn);

  console.log('== Catalogue ==');
  const OLD = { engine: 'ENGINE FAILURE', engineLeft: 'LEFT ENGINE FAILURE', engineRight: 'RIGHT ENGINE FAILURE', flapsStuck: 'FLAPS JAMMED', gearStuck: 'GEAR FAILURE', noseGear: 'NOSE GEAR UNSAFE', elevatorJam: 'ELEVATOR JAMMED', hydraulics: 'HYDRAULIC FAILURE', brakes: 'BRAKES FAILED', ice: 'WING ICE' };
  check(Object.entries(OLD).every(([k, m]) => FAILURES[k] && FAILURES[k].msg === m && !FAILURES[k].effect), 'the first ten failures keep their names, messages and in-model effects');
  check(Object.values(FAILURES).every((f) => ['name', 'desc', 'hint', 'msg'].every((k) => typeof f[k] === 'string' && f[k].length) && typeof f.applies === 'function'), `every entry has name, desc, hint, msg and applies(def) (${Object.keys(FAILURES).length} entries)`);
  const effects = Object.keys(FAILURES).filter((k) => FAILURES[k].effect);
  check(effects.length === EFFECT_NAMES.length && effects.every((k) => EFFECT_NAMES.includes(k)), `every effect entry has its runtime class and no class is orphaned (${effects.length})`);
  check(!effects.some((k) => Object.keys(OLD).includes(k)), 'no new name is one the flight model reacts to');
  const A = AIRCRAFT;
  check(!FAILURES.engineLeft.applies(A.skylark) && FAILURES.engineLeft.applies(A.condor), 'applies(): no left engine on a single');
  check(!FAILURES.gearStuck.applies(A.skylark) && !FAILURES.gearUp.applies(A.trailblazer) && FAILURES.gearUp.applies(A.condor), 'applies(): no retractable gear to jam on the fixed-gear airplanes');
  check(FAILURES.lensFail.applies(A.hornet) && !FAILURES.lensFail.applies(A.condor), 'applies(): only a hook aircraft has a lens to lose');
  check(FAILURES.electrical.applies(A.skylark) && !FAILURES.electrical.applies(A.condor), 'applies(): the electrical failure is the steam-gauge airplanes\' (the jets\' glass would need a standby bus)');
  check(FAILURES.pitotIce.silent && FAILURES.blownTire.silent && !FAILURES.engineFire.silent && FAILURES.engineFire.warning, 'silent and warning flags');

  console.log('\n== Triggers ==');
  const stub = { radioAlt: 500 * FT, ias: 100 * KT, stats: { touchdown: null } };
  check(shouldTrigger({ at: { type: 'start' } }, stub, { t: 0 }) && shouldTrigger({}, stub, { t: 0 }), 'start (and the default)');
  check(!shouldTrigger({ at: { type: 'time', value: 5 } }, stub, { t: 4.9 }) && shouldTrigger({ at: { type: 'time', value: 5 } }, stub, { t: 5 }), 'time');
  check(!shouldTrigger({ at: { type: 'alt', value: 600 } }, stub, { t: 0.5 }) && shouldTrigger({ at: { type: 'alt', value: 600 } }, stub, { t: 2 }) && !shouldTrigger({ at: { type: 'alt', value: 400 } }, stub, { t: 2 }), 'alt (feet, after the first second), unchanged');
  check(shouldTrigger({ at: { type: 'dist', value: 2000 } }, stub, { distToThreshold: 1999 }) && !shouldTrigger({ at: { type: 'dist', value: 2000 } }, stub, { distToThreshold: 2001 }), 'dist (metres), unchanged');
  check(!shouldTrigger({ at: { type: 'touchdown' } }, stub, { t: 9 }) && shouldTrigger({ at: { type: 'touchdown' } }, { ...stub, stats: { touchdown: {} } }, { t: 9 }), 'touchdown');
  check(!shouldTrigger({ at: { type: 'speed', value: 90 } }, stub, { t: 9 }) && shouldTrigger({ at: { type: 'speed', value: 110 } }, stub, { t: 9 }) && !shouldTrigger({ at: { type: 'speed', value: 110 } }, stub, { t: 0.5 }), 'speed (below this IAS, after the first second)');
  check(!shouldTrigger({ at: { type: 'window', from: 4, to: 9, when: 7 } }, stub, { t: 6.9 }) && shouldTrigger({ at: { type: 'window', from: 4, to: 9, when: 7 } }, stub, { t: 7 }), 'window fires at its drawn moment');
  check(!shouldTrigger({ at: { type: 'gate', value: 3 } }, stub, { t: 9, gatesPassed: 2 }) && shouldTrigger({ at: { type: 'gate', value: 3 } }, stub, { t: 9, gatesPassed: 3 }) && !shouldTrigger({ at: { type: 'gate', value: 1 } }, stub, { t: 9 }), 'gate (only when a mission counts gates)');
  check(!shouldTrigger({ at: { type: 'nonsense' } }, stub, { t: 99 }), 'an unknown type never fires');
  {
    const sc = { failures: [{ name: 'pitotIce', at: { type: 'window', from: 6, to: 16 } }] };
    const whens = [307, 307, 11, 42, 99, 500, 777].map((s) => new FailureRuntime(airborne('skylark'), sc, { seed: s }).pending[0].at.when);
    check(whens[0] === whens[1], `a window is drawn from the flight seed: the same seed, the same moment (${whens[0].toFixed(2)} s)`);
    check(whens.every((w) => w >= 6 && w <= 16) && new Set(whens.map((w) => w.toFixed(3))).size > 3, 'inside the window, and it varies with the seed');
    check(sc.failures[0].at.when === undefined, 'the scenario itself is not written to');
  }

  console.log('\n== Effects ==');
  {
    const ac = airborne('skylark'), rt = new FailureRuntime(ac, { failures: [] }, { seed: 1 });
    rt.trigger({ name: 'aileronJam', arg: 0.1 });
    ac.input.roll = -0.8; rt.preStep(0.04, ac, { yaw: 0 });
    check(ac.input.roll === 0.1 && ac.failures.has('aileronJam'), 'aileron jam: the stick says -0.8, the ailerons stay at the jam');
  }
  {
    const ac = airborne('skylark'), rt = new FailureRuntime(ac, { failures: [] }, { seed: 1 });
    rt.trigger({ name: 'rudderJam', arg: 0.3 });
    ac.input.yaw = 0; rt.preStep(0.04, ac, {});
    const air = ac.input.yaw;
    ac.wheelsOnGround = true;
    for (let i = 0; i < 60; i++) { ac.input.yaw = -0.5; rt.preStep(0.04, ac, {}); }
    check(Math.abs(air - 0.3) < 1e-9 && Math.abs(ac.input.yaw + 0.5) < 1e-6, `rudder hardover: ${air.toFixed(2)} in the air, the pedals' own ${ac.input.yaw.toFixed(2)} after 2 s on the wheels`);
  }
  {
    const ac = airborne('condor'), rt = new FailureRuntime(ac, { failures: [] }, { seed: 1 });
    rt.trigger({ name: 'runawayTrim', arg: -0.1 });
    ac.input.trim = 0.44;   // written once, then left alone (the autopilot does that): the runaway must not compound
    for (let i = 0; i < 75; i++) rt.preStep(0.04, ac, {});
    const f = rt.get('runawayTrim');
    check(Math.abs(f.bias + 0.3) < 1e-6 && Math.abs(ac.input.trim - (0.44 - 0.3)) < 1e-6, `runaway trim: -0.1/s for 3 s is -0.30 on top of the pilot's 0.44 (${ac.input.trim.toFixed(3)})`);
    check(rt.action('trimCutout') && !rt.action('trimCutout') && f.cut, 'the cutout (D) is taken once');
    for (let i = 0; i < 25; i++) rt.preStep(0.04, ac, {});
    check(Math.abs(f.bias + 0.3) < 1e-6, 'after the cutout it runs no further');
    let w = 0.44;
    for (let i = 0; i < 50; i++) { w += 0.2 * 0.04; ac.input.trim = w; rt.preStep(0.04, ac, {}); }   // the pilot winds 0.4 of trim
    check(Math.abs(f.bias - (-0.3 + 0.4 * 0.35)) < 1e-6 && Math.abs(ac.input.trim - (0.44 + f.bias)) < 1e-6, `the trim keys turn a slow manual wheel (0.4 of trim is ${(0.4 * 0.35).toFixed(2)} of runaway back)`);
  }
  {
    const ac = airborne('condor'), rt = new FailureRuntime(ac, { failures: [] }, { seed: 1 });
    rt.trigger({ name: 'stuckThrottle', arg: 0.7 });
    run(ac, rt, 1, (t, a) => { a.input.throttle = 0.1; });
    check(Math.abs(ac.input.throttle - 0.7) < 1e-9, 'stuck throttle: the lever says 0.1, the engines get 0.7');
    // the guard: at 1,600 ft a press only asks; it lapses after two seconds; a second press within them cuts
    const asked = rt.action('fuelCutoff') && !rt.fuelCut;
    run(ac, rt, 2.2, (t, a) => { a.input.throttle = 0.1; });
    const lapsed = rt.action('fuelCutoff') && !rt.fuelCut;
    check(asked && lapsed && rt.action('fuelCutoff') && rt.fuelCut && !rt.action('fuelCutoff'), `fuel cutoff (U) is guarded above 300 ft (a press asks, ${'"' + touchify('FUEL CUTOFF? PRESS U AGAIN') + '"'} on a phone; the question lapses after 2 s), a second press cuts, and it is taken once`);
    run(ac, rt, 1, (t, a) => { a.input.throttle = 0.9; });
    const spooling = ac.engines.every((e) => !e.failed && e.thrust > 0) && ac.input.throttle === 0;
    run(ac, rt, 2, (t, a) => { a.input.throttle = 0.9; });
    const rpm = ac.engines[0].rpm;
    run(ac, rt, 4, (t, a) => { a.input.throttle = 0.9; });
    check(spooling && ac.engines.every((e) => !e.failed && e.thrust === 0) && rt.display.engOff[0] && rt.display.engOff[1] && ac.engines[0].rpm < rpm * 0.5,
      `the engines spool down, then stop: no thrust, the gauges say OFF and run down (N1 ${(rpm * 100).toFixed(0)}% -> ${(ac.engines[0].rpm * 100).toFixed(0)}%), and a shutdown is not a failure (no smoke)`);
    check(AIRCRAFT.condor.engines[0].maxThrust > 0, '...on the aircraft\'s own copy of the engines, not the shared definition');
    const low = airborne('condor', { alt: 60 }), rl = new FailureRuntime(low, { failures: [] }, { seed: 1 });
    rl.trigger({ name: 'stuckThrottle', arg: 0.7 });
    run(low, rl, 0.2);
    check(low.radioAlt < 300 * FT && low.radioAlt > 100 * FT && rl.action('fuelCutoff') && rl.fuelCut, `below 300 ft (the flare, where the drill uses it) one press cuts (at ${(low.radioAlt / FT).toFixed(0)} ft)`);
  }
  {
    const ac = airborne('condor'), rt = new FailureRuntime(ac, { failures: [] }, { seed: 1 });
    rt.trigger({ name: 'enginePartial', engine: 'right', arg: 0.5 });
    check(ac.engines[1].maxThrust === AIRCRAFT.condor.engines[1].maxThrust / 2 && ac.engines[0].maxThrust === AIRCRAFT.condor.engines[0].maxThrust, 'partial power: the right engine\'s own copy at half, the left and the shared definition untouched');
    rt.dispose();
    check(ac.engines[1].maxThrust === AIRCRAFT.condor.engines[1].maxThrust, '...and put back on dispose');
  }
  {
    const ac = airborne('condor'), rt = new FailureRuntime(ac, { failures: [] }, { seed: 7 });
    rt.trigger({ name: 'engineSurge', engine: 'left', arg: 0.6 });
    let lo = 1, seen = 0;
    run(ac, rt, 12, (t, a) => { a.input.throttle = 0.5; const k = a.engines[0].maxThrust / AIRCRAFT.condor.engines[0].maxThrust; lo = Math.min(lo, k); if (k < 0.9) seen += 0.04; });
    check(lo < 0.45 && seen > 0.5 && seen < 9, `surge: the engine sags to ${(lo * 100).toFixed(0)}% for ${seen.toFixed(1)} of 12 s`);
    check(rt.action('fireHandle') && ac.engines[0].failed && ac.failures.has('engineLeft') && !ac.engines[1].failed, 'the fire handle (A) shuts that engine down, as the flight model\'s own engine failure');
  }
  {
    const ac = airborne('condor'), rt = new FailureRuntime(ac, { failures: [] }, { seed: 1 });
    rt.trigger({ name: 'engineFire', engine: 'left', burn: 20 });
    let seized = -1;
    run(ac, rt, 25, (t, a) => { a.input.throttle = 0.3; if (seized < 0 && a.engines[0].failed) seized = t; });
    check(seized > 9 && seized < 13 && ac.crashed && /Engine fire/.test(ac.crashReason), `a fire left alone: the engine seizes at ${seized.toFixed(1)} s and the wing goes at 20 s (${ac.crashReason})`);
    const b = airborne('condor'), rb = new FailureRuntime(b, { failures: [] }, { seed: 1 });
    rb.trigger({ name: 'engineFire', engine: 'left', burn: 20 });
    run(b, rb, 3, (t, a) => { a.input.throttle = 0.3; });
    const pulled = rb.action('fireHandle');
    run(b, rb, 25, (t, a) => { a.input.throttle = 0.3; });
    check(pulled && !b.crashed && b.engines[0].failed && !b.engines[1].failed && b.failures.has('engineLeft') && !rb._actions.length, 'the handle pulled at 3 s: engine off, fire out, no crash, the FIRE button gone');
  }
  {
    const ac = airborne('condor'), rt = new FailureRuntime(ac, { failures: [] }, { seed: 3 });
    rt.trigger({ name: 'birdStrike', engine: 'right', arg: 0.6, surge: 0.6 });
    const cp = crackPattern(makeRng(5));
    const inside = cp.paths.every((q) => q.pts.every((v) => Math.abs(v) < 1)) && cp.arcs.every((q) => q.every((v) => Math.abs(v) < 1));
    check(rt.display.crack === true && cp.paths.length > 10 && inside && JSON.stringify(cp) === JSON.stringify(crackPattern(makeRng(5))) && JSON.stringify(cp) !== JSON.stringify(crackPattern(makeRng(6))),
      `bird strike: the windshield cracks (${cp.paths.length} cracks, all inside the decal), the same crack for the same seed and another for another`);
    let lo = 1;
    run(ac, rt, 10, (t, a) => { a.input.throttle = 0.5; lo = Math.min(lo, a.engines[1].maxThrust / AIRCRAFT.condor.engines[1].maxThrust); });
    check(lo < 0.6 && ac.engines[0].maxThrust === AIRCRAFT.condor.engines[0].maxThrust, `...and the right engine surges down to ${(lo * 100).toFixed(0)}%, the left untouched`);
  }
  {
    const ac = airborne('condor'), rt = new FailureRuntime(ac, { failures: [] }, { seed: 1 });
    rt.trigger({ name: 'pitotIce', arg: 0.6, tau: 10 });
    check(rt.active.length === 0 && rt.display.caution.blink <= 0, 'unreliable airspeed is silent when it starts');
    run(ac, rt, 30, (t, a) => { a.input.pitch = clamp(3 * (1.5 * DEG - a.euler.pitch) - 2 * a.omega.x, -1, 1); a.input.roll = clamp(-2 * a.euler.roll + 0.5 * a.omega.z, -1, 1); a.input.throttle = 0.3; });
    check(rt.sensed.ias < ac.ias * 0.72 && ac.ias > 120 * KT, `after 30 s the tape reads ${(rt.sensed.ias / KT).toFixed(0)} kt; the airplane is doing ${(ac.ias / KT).toFixed(0)}`);
    check(rt.display.annun.some((a) => a.text === 'IAS DISAGREE') && rt.display.iasFlag, 'the jet notices: IAS DISAGREE');
  }
  {
    const ac = airborne('skylark'), rt = new FailureRuntime(ac, { failures: [] }, { seed: 1 });
    rt.trigger({ name: 'electrical' });
    check(rt.display.dark && rt.power === 0, 'electrical: the HUD goes dark and the power is off (the cockpit reads it)');
  }
  {
    const ac = airborne('condor'), rt = new FailureRuntime(ac, { failures: [] }, { seed: 1 });
    const down = ac.ctl.gear;
    rt.trigger({ name: 'gearUp' });   // before the first frame, as Free Flight deals it: the gear is up, not folding away
    const up = ac.ctl.gear === 0 && ac.legs.every((l) => l.ext === 0);
    const said = rt.action('gear');
    ac.input.gearCmd = 1; rt.preStep(0.04, ac, {});
    check(down === 1 && up && said && ac.input.gearCmd === 0, 'gear up: up from the start when it fires before the first frame, and G says GEAR UNSAFE instead of lowering it');
    const h = airborne('hornet'), rh = new FailureRuntime(h, { failures: [] }, { seed: 1 });
    h.input.hookCmd = 1; h.ctl.hook = 1;
    rh.trigger({ name: 'hookFail' });
    check(h.ctl.hook === 0 && rh.action('hook') && h.input.hookCmd === 0, 'hook failure: likewise up from the start, and H says so');
    const ctx = { ac, ra: 900, d: 5000, t: 3 };
    check(/belly landing/i.test(rt.hint(ctx)) && /\(press U\)/.test(rt.hint(ctx)), `...and its own hint where the game's would say "Gear down: press G" ("${rt.hint(ctx)}")`);
  }
  {
    // the first ten: exactly as before - no master caution light, no display object for the HUD
    const ac = airborne('condor'), rt = new FailureRuntime(ac, { failures: [] }, { seed: 1 });
    rt.trigger({ name: 'engineLeft' });
    run(ac, rt, 0.5, (t, a) => { a.input.throttle = 0.5; });
    check(rt.display === null && rt._display.caution.blink <= 0 && !rt._display.caution.level, 'the first ten failures light no master caution and leave the HUD\'s failure display alone');
  }
  {
    // two failures that both use the fire handle: one button, and it stays (with the next one's label) until both are done
    const ac = airborne('condor'), rt = new FailureRuntime(ac, { failures: [] }, { seed: 1 });
    rt.trigger({ name: 'engineFire', engine: 'left' });
    rt.trigger({ name: 'engineSurge', engine: 'right' });
    const o1 = rt.offers.map((o) => o.label).join(',');
    rt.action('fireHandle');
    const o2 = rt.offers.map((o) => o.label).join(',');
    rt.action('failDrill');   // (the one-button drill a gamepad would send)
    const o3 = rt.offers.length;
    check(o1 === 'FIRE' && o2 === 'ENG OFF' && o3 === 0 && rt.get('engineFire').out && rt.get('engineSurge').shut, `the fire handle on offer while anything needs it: ${o1} -> ${o2} -> nothing`);
  }
  {
    // One Wheel: a flight that ends with that wing still up does not say "0 kt"
    const ac = airborne('skylark'), rt = new FailureRuntime(ac, { failures: [] }, { seed: 1 });
    rt.trigger({ name: 'oneMainStuck', leg: 'left' });
    ac.stats.touchdown = { ias: 55 * KT, vs: -1, pitch: 0.1, legs: ['right'], pos: ac.pos.clone() };
    const r = rt.get('oneMainStuck').score({ points: 80, grade: 'OK', gradeIdx: 2, lines: [] }, ac, {}, rt);
    check(r.points === 80 && r.lines.length === 1 && /still up when the flight ended/.test(r.lines[0].v) && !/0 kt/.test(r.lines[0].v), `one wheel, flight ended before the stub touched: "${r.lines[0].k}: ${r.lines[0].v}"`);
  }
  {
    const sky = airborne('skylark'), rs = new FailureRuntime(sky, { failures: [] }, { seed: 1 });
    rs.trigger({ name: 'oneMainStuck', leg: 'left' });
    const L = sky.legs.find((l) => l.name === 'left');
    const con = airborne('condor'), rc = new FailureRuntime(con, { failures: [] }, { seed: 1 });
    rc.trigger({ name: 'oneMainStuck', leg: 'right' });
    check(L.wheelOff && L.radius < 0.06 && !L.brake && AIRCRAFT.skylark.gear[1].radius === 0.25, 'one main wheel: on the trainer the wheel is gone (a stub, no brake; models.js hides the wheel)');
    check(con.legs.find((l) => l.name === 'right').stuckAt === 0, '...on the airliner that leg stays up');
  }
  {
    const ac = airborne('skylark'), rt = new FailureRuntime(ac, { failures: [] }, { seed: 1 });
    rt.trigger({ name: 'blownTire', leg: 'right' });
    const L = ac.legs.find((l) => l.name === 'right');
    rt.preStep(0.04, ac, {});
    const before = L.radius;
    L.contact = true; L.load = 3000; ac.input.yaw = 0; ac.gs = 25;
    rt.preStep(0.04, ac, {});
    check(before === 0.25 && L.radius < 0.2 && !L.brake && ac.input.yaw > 0.1 && rt.active.includes('Blown tire'), `blown tire: nothing until it takes weight, then on the rim, no brake, pulling right (rudder ${ac.input.yaw.toFixed(2)})`);
  }
  {
    const fast = airborne('skylark', { kt: 84 }), rf = new FailureRuntime(fast, { failures: [] }, { seed: 1 });
    rf.trigger({ name: 'flutter', arg: 0.8 });
    const slow = airborne('skylark', { kt: 52 }), rsl = new FailureRuntime(slow, { failures: [] }, { seed: 1 });
    fast.step(0.004, AIR); slow.step(0.004, AIR);   // the airspeed is derived in the first step
    rsl.trigger({ name: 'flutter', arg: 0.8 });
    const spread = (ac, rt) => { let lo = 9, hi = -9; for (let i = 0; i < 100; i++) { ac.input.pitch = 0; rt.preStep(0.04, ac, {}); if (i > 60) { lo = Math.min(lo, ac.input.pitch); hi = Math.max(hi, ac.input.pitch); } } return hi - lo; };
    const sf = spread(fast, rf), ss = spread(slow, rsl);
    check(sf > 0.15 && ss < 0.01, `flutter: a buzz of ${sf.toFixed(2)} in pitch at 84 kt, ${ss.toFixed(3)} at 52 kt`);
  }
  {
    const ac = airborne('hornet'), rt = new FailureRuntime(ac, { failures: [] }, { seed: 1 });
    const mb = { inRange: true, cells: 1.3, waveoff: true, range: 900, dl: { u: 0, v: 0, h: 0 } };
    check(rt.lens(mb) === mb, 'lens: no failure, the true ball');
    rt.trigger({ name: 'lensFail' });
    const d = rt.lens(mb);
    check(d !== mb && !d.inRange && d.waveoff && mb.inRange, 'lens failure: a dark lens (the wave-off lights still work), the true ball untouched for the LSO and the score');
    rt.trigger({ name: 'hookFail' });
    ac.input.hookCmd = 1; rt.preStep(0.04, ac, {});
    check(ac.input.hookCmd === 0, 'hook failure: the hook stays up');
    rt.dispose();
  }
  {
    // the 3D lens: main.js hands the carrier the true ball; the failure puts its own updateLens on that carrier
    const carrier = new Carrier({ ...SITES.carrier.carrier, seaState: 0.3, x: 0, z: 0 });
    let got = null;
    const spy = (mb) => { got = mb; };
    carrier.updateLens = spy;
    const ac = airborne('hornet'), rt = new FailureRuntime(ac, { failures: [] }, { seed: 1, world: { carrier } });
    rt.trigger({ name: 'lensFail' });
    const mb = { inRange: true, cells: 1.3, waveoff: false, range: 900, dl: { u: -900, v: 0, h: 60 } };
    carrier.updateLens(mb, 1);
    const dark = got && got !== mb && !got.inRange;
    rt.dispose();
    carrier.updateLens(mb, 2);
    check(dark && got === mb && carrier.updateLens === spy, 'lens failure: the carrier\'s own lens is handed the dark ball (main.js untouched), and gets the true one back after the flight');
  }
  {
    // the debrief and the hints reach main.js through the mission runtime: hooked on the first check(), taken off after
    const game = { ap: null, mission: null };
    const ac = airborne('skylark'), sc = { id: 't', failures: [{ name: 'oneMainStuck', at: { type: 'start' }, leg: 'left' }], scoring: { type: 'runway' } };
    const rt = new FailureRuntime(ac, sc, { seed: 1, game });
    const m = game.mission = new MissionRuntime(sc, { failRt: rt });
    rt.check(ac, { t: 0, distToThreshold: 1e9 });
    ac.stats.touchdown = { ias: 55 * KT, vs: -1, pitch: 0.1, legs: ['right'], pos: ac.pos.clone() };
    const r = m.score({ points: 80, grade: 'OK', gradeIdx: 2, lines: [] }, ac, {});
    const again = rt.score(r, ac, {}), copy = rt.score({ ...r, lines: r.lines.slice() }, ac, {});
    check(r.lines.some((l) => /Left wing/.test(l.k)) && again === r && copy.lines.length === r.lines.length, 'the mission\'s score() runs the failures\' first, and once only (a copy the mission made of it is left as it is)');
    const g2 = { ap: null, mission: null }, a2 = airborne('condor');
    const s2 = { id: 't', failures: [{ name: 'gearUp' }] };
    const r2 = new FailureRuntime(a2, s2, { seed: 1, game: g2 });
    const m2 = g2.mission = new MissionRuntime(s2, { failRt: r2 });
    r2.check(a2, { t: 0, distToThreshold: 1e9 });
    const ctx = { ac: a2, ra: 900, d: 5000, t: 1 };
    const own = m2.hint(ctx);
    s2.hint = () => 'the mission\'s own';
    const first = m2.hint(ctx);
    rt.dispose(); r2.dispose();
    check(/belly landing/i.test(own) && first === 'the mission\'s own' && !Object.prototype.hasOwnProperty.call(m, 'score') && !Object.prototype.hasOwnProperty.call(m2, 'hint'), 'a failure\'s hint where the mission has none, the mission\'s first; both taken off on dispose');
  }
  {
    // dead electrics: the radio altimeter's calls stop (audio-alarms.js silence(); AudioSys.say() asks it), nothing else
    const alarms = new Alarms({ ready: false });
    const audio = { alarms, say() {}, beep() {} };
    const ac = airborne('skylark'), rt = new FailureRuntime(ac, { failures: [] }, { seed: 1, audio });
    const before = alarms.silence('50');
    rt.trigger({ name: 'electrical' });
    const during = alarms.silence('50') && alarms.silence('20') && !alarms.silence('Stall. Stall.') && !alarms.silence('Crash.');
    rt.dispose();
    check(!before && during && !alarms.silence('50'), 'electrical: the "50", "20" calls are silent while the power is off, the other voices are not, and all of it ends with the flight');
  }
  check(JSON.stringify(AIRCRAFT, noFn) === defsBefore, 'the shared aircraft definitions are never written to');

  // The scripted pilots below write ac.input like the autopilot, so they never go through the flight control; a player
  // always does. These fly the runaway trim the way a player has to: the flight control between the keys and the
  // surfaces, the cutout (D), the trim keys (T) on the Input, in both control modes. Loose bands on purpose: the flight
  // control is being rewritten, and what matters is that the runaway beats it and the cutout plus the wheel win it back.
  console.log('\n== Through the flight control (what a player has) ==');
  for (const mode of ['assist', 'direct']) {
    const fly = (cutAt) => {
      const ac = airborne('condor', { alt: 900 }), game = { ap: null };
      const rt = new FailureRuntime(ac, { failures: [] }, { seed: 1, game });
      const inp = { kbPitch: 0, kbRoll: 0, pitch: 0, roll: 0, yaw: 0, trim: 0, mouseYoke: false, mdx: 0, mdy: 0, boost: false, mouseSens: 0.5 };
      inp.trim = ac.input.trim;   // main.js starts the Input's trim where the spawn trimmed the airplane
      const fcs = game.fcs = new FlightControl(ac, { controlMode: mode });   // (main.js keeps it as game.fcs)
      const p0 = ac.euler.pitch, thr = ac.input.throttle, trim0 = inp.trim;
      let minP = 9, maxDev = 0, held = 0, wound = 0;
      const dt = 1 / 25;
      for (let t = dt; t < 24; t += dt) {
        if (t >= 1 && !rt.get('runawayTrim')) rt.trigger({ name: 'runawayTrim', arg: -0.12 });
        const f = rt.get('runawayTrim');
        if (cutAt != null && f && !f.cut && t >= cutAt) rt.action('trimCutout');
        // T held (src/input.js: 0.12/s, speeding up to 0.345/s over 1.5 s) while the wheel is still wound nose down
        if (f && f.cut && f.bias < -0.02) { held += dt; const r = 0.12 + Math.min(held, 1.5) * 0.15; inp.trim = clamp(inp.trim + r * dt, -1, 1); wound += r * dt; } else held = 0;
        // the stick: direct mode needs a hand on it (the auto-trim is main.js's, not here); assist holds the attitude by itself
        if (mode === 'direct') { inp.pitch = inp.kbPitch = clamp(3 * (p0 - ac.euler.pitch) - 1.5 * ac.omega.x, -1, 1); inp.roll = inp.kbRoll = clamp(-2 * ac.euler.roll + 0.5 * ac.omega.z, -1, 1); }
        ac.input.throttle = thr;
        fcs.update(dt, inp, ac, 1);
        rt.preStep(dt, ac, inp);
        ac.step(dt, AIR); ac.events.length = 0;
        rt.check(ac, { t, distToThreshold: 1e9 });
        rt.postStep(dt, ac);
        minP = Math.min(minP, ac.euler.pitch);
        if (t > 3) maxDev = Math.max(maxDev, Math.abs(ac.euler.pitch - p0));
      }
      return { minP: (minP - p0) * RAD, maxDev: maxDev * RAD, bias: rt.get('runawayTrim').bias, wound, trimInp: inp.trim - (rt.get('runawayTrim').held ?? trim0), crashed: ac.crashed };
    };
    const left = fly(null), cut = fly(3.5);
    check(left.minP < -8, `${mode}: left alone, the runaway beats the flight control: the nose goes ${left.minP.toFixed(0)}° down`);
    check(cut.bias > -0.05 && cut.maxDev < 6 && !cut.crashed, `${mode}: cut out at 2.5 s and wound back with T: the wheel is back to ${cut.bias.toFixed(2)} and the nose never more than ${cut.maxDev.toFixed(1)}° off`);
    check(Math.abs(cut.trimInp) < 0.02 && cut.wound > 0.3, `${mode}: the trim keys turn the wheel, not the electric trim (${cut.wound.toFixed(2)} of winding; the Input's own trim stays where the cutout left it, ${cut.trimInp.toFixed(2)} off)`);
  }

  console.log('\n== The ten missions ==');
  const ids = FAILURES_MISSIONS.map((m) => m.id);
  check(FAILURES_MISSIONS.length === 10 && FAILURES_MISSIONS.every((m, i) => m.n === 26 + i && m.group === 'breaks'), 'ten missions, n 26-35, group breaks');
  check(ids.every((id) => /^[a-z0-9][a-z0-9-]{0,23}$/.test(id)) && new Set(SCENARIOS.map((s) => s.id)).size === SCENARIOS.length, 'ids are board ids and unique across every scenario');
  check(ids.every((id) => SCENARIOS.some((s) => s.id === id) && NEW_MISSIONS.some((s) => s.id === id)) && MISSION_GROUPS.some((g) => g.id === 'breaks'), 'registered: in SCENARIOS and NEW_MISSIONS, and the menu has the group');
  for (const m of FAILURES_MISSIONS) {
    const def = AIRCRAFT[m.aircraft], site = SITES[m.site];
    const okFields = m.title && m.desc && m.tips && m.tips.length === 3 && m.difficulty >= 1 && m.difficulty <= 5 && Array.isArray(m.tags) && def && site && typeof m.time === 'number' && typeof m.vis === 'number' && m.wind && m.weight && m.spawn && m.failures.length && m.scoring;
    const okFail = m.failures.every((f) => FAILURES[f.name] && FAILURES[f.name].applies(def));
    const okType = site.kind === 'carrier' ? m.scoring.type === 'carrier' : m.scoring.type !== 'carrier';
    const s = sentences(m.desc);
    let resolved = null; try { resolved = resolveScenario(m, makeRng(307), { approach: 'short' }); } catch (e) { resolved = null; }
    check(okFields && okFail && okType && s >= 2 && s <= 3 && resolved, `${m.id}: fields, ${m.aircraft} at ${m.site}, ${m.failures.map((f) => f.name).join('+')} applies, ${s}-sentence brief, resolves`);
  }
  // Keys named in tips and hints are rewritten for the touch buttons.
  // (every string in the missions file, so the hints the missions make up in flight are covered too)
  const KEYREF = /\bpress [A-Z]\b|\((?:[A-Z]|Q\/E|Space)\)|\bhold [A-Z]\b|\bwith T\b|: [A-Z] twice/;
  const literals = [...readFileSync(new URL('../src/missions/failures.js', import.meta.url), 'utf8').matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1].replace(/\\'/g, '\''));
  const named = [...FAILURES_MISSIONS.flatMap((m) => m.tips), ...Object.values(FAILURES).map((f) => f.hint), ...literals].filter((t) => KEYREF.test(t));
  const missed = named.filter((t) => KEYREF.test(touchify(t)));
  check(named.length >= 10 && !missed.length, `every tip and hint that names a new key has its touch wording (${named.length} checked)${missed.length ? ': ' + missed[0] : ''}`);
  check(['A', 'D', 'U'].every((k) => KEY_HELP.some(([key]) => key.split(/[ /]+/).includes(k))), 'the Controls page lists A, D and U');

  console.log('\n== Each mission flown by its technique (seed 307) ==');
  const results = {};
  for (const m of FAILURES_MISSIONS) {
    const r = flyMission(m, { seed: 307 });
    results[m.id] = r;
    const carrier = SITES[m.site].kind === 'carrier';
    const ok = !r.ac.crashed && r.ac.stats.touchdown && (carrier ? r.ac.trap.trapped : r.ac.stopped) && r.result.points >= (carrier ? 60 : 70);
    check(ok, `${m.id}: ${r.ac.crashed ? 'CRASHED ' + r.ac.crashReason : `${r.result.points} ${r.result.grade}`}${carrier ? `, ${r.ac.trap.wire}-wire` : `, stopped ${r.ap.stopU.toFixed(0)} m in`} [${r.pilot.log.join(', ') || 'no keys'}]`);
  }
  const L = (id) => results[id].result.lines;
  check(results['stuck-throttle'].pilot.log.some((s) => /fuelCutoff/.test(s)) && results['stuck-throttle'].ac.engines.every((e) => e.thrust === 0 && !e.failed), 'stuck throttle: the fuel was cut and the engines are off');
  check(results['runaway-trim'].pilot.log.some((s) => /trimCutout/.test(s)), 'runaway trim: the cutout was used');
  check(results['engine-fire'].rt.get('engineFire').out && results['bird-strike'].rt.get('birdStrike').surge.shut, 'engine fire and bird strike: the handle was pulled');
  check(!L('belly-landing').some((l) => /BELLY LANDING/.test(l.v)) && L('belly-landing').some((l) => l.k === 'Belly landing' && l.cls === 'good'), 'belly landing: no gear-up penalty (scoring.belly), engines off before contact');
  check(L('one-wheel').some((l) => /wing held up until/.test(l.k)), 'one wheel: the debrief says how slowly the wing came down');
  check(results['unreliable-ias'].rt.sensed.ias < results['unreliable-ias'].ac.stats.touchdown.ias * 0.8, 'unreliable airspeed: the tape was well wrong by the flare, and the landing was flown anyway');
  check(results['no-ball'].rt.lso.t > 0, 'no ball: Paddles talked');
  {
    // No Ball is flown by the numbers in its tips alone (no ball, no glide path from the geometry): more seeds (the
    // gusts differ), with a keyboard's pedals
    const res = [11, 4271, 42, 901].map((seed) => flyMission(SCENARIOS.find((s) => s.id === 'no-ball'), { seed, human: true }));
    check(res.every((r) => !r.ac.crashed && r.ac.trap.trapped), `no ball, by the numbers, on four more seeds: ${res.map((r) => (r.ac.crashed ? 'CRASH ' + r.ac.crashReason : r.ac.trap.trapped ? `${r.ac.trap.wire}-wire ${r.result.points}` : 'no trap')).join(', ')}`);
  }

  console.log('\n== Left alone, a failure ends badly ==');
  {
    const r = flyMission(SCENARIOS.find((s) => s.id === 'engine-fire'), { seed: 307, tech: 'ignore' });
    check(r.ac.crashed && /Engine fire/.test(r.ac.crashReason), `engine fire, handle never pulled: ${r.ac.crashed ? r.ac.crashReason : 'survived?!'}`);
  }
  {
    const r = flyMission(SCENARIOS.find((s) => s.id === 'runaway-trim'), { seed: 307, tech: 'ignore' });
    check(r.ac.crashed || r.result.points < 40, `runaway trim, never cut out: ${r.ac.crashed ? r.ac.crashReason : r.result.points + ' ' + r.result.grade}`);
  }
  {
    const r = flyMission(SCENARIOS.find((s) => s.id === 'stuck-throttle'), { seed: 307, tech: 'ignore', maxT: 220 });
    check(r.ac.crashed || !r.ac.stats.touchdown || r.result.points < 50, `stuck throttle, no drag, no fuel cutoff: ${r.ac.crashed ? r.ac.crashReason : r.ac.stats.touchdown ? r.result.points + ' ' + r.result.grade : 'never got down'}`);
  }
  {
    const r = flyMission(SCENARIOS.find((s) => s.id === 'unreliable-ias'), { seed: 307, tech: 'ignore' });
    const good = results['unreliable-ias'];
    const fast = r.ac.stats.touchdown ? r.ac.stats.touchdown.ias / KT : 0;
    check(r.ac.crashed || fast > good.ac.stats.touchdown.ias / KT + 20, `unreliable airspeed, chasing the tape: ${r.ac.crashed ? r.ac.crashReason + ' (over 200 kt down final)' : `touched down at ${fast.toFixed(0)} kt`}, against ${(good.ac.stats.touchdown.ias / KT).toFixed(0)} kt flown by pitch and power`);
  }
  {
    const m = SCENARIOS.find((s) => s.id === 'belly-landing');
    // (a gear-up airliner sits on its engine pods and its tail, so without the flag it is the damage that costs)
    const r = flyMission({ ...m, scoring: { type: 'runway' } }, { seed: 307 });
    check(r.result.gradeIdx >= 3 && r.result.points < results['belly-landing'].result.points, `without scoring.belly the same belly landing is damage: ${r.result.points} ${r.result.grade} against ${results['belly-landing'].result.points} ${results['belly-landing'].result.grade}`);
  }
  check(JSON.stringify(SCENARIOS, noFn) === scenariosBefore, 'no flight wrote into the scenario list');
  check(JSON.stringify(AIRCRAFT, noFn) === defsBefore, 'no flight wrote into the aircraft definitions');
  console.log(`\n${fails ? fails + ' check(s) FAILED' : 'all failure checks passed'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  return fails;
}

// ---------------------------------------------------------------------------------------------------------------
// --page: the same pilots in the real game. Boots the built CTL.html in headless Edge, and for each mission starts it
// with the flight seed pinned, hands the airplane to the scripted pilot (as the debug autopilot: g.ap), steps
// frame(1/25) to the debrief and prints the game's own score. Edge is closed by its process id when done.
async function flyInPage(html, port = 9751, ids = null, seed = 307) {
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const pilots = src.slice(src.indexOf('// ==== PILOTS BEGIN ===='), src.indexOf('// ==== PILOTS END ====')).replace(/^export /gm, '');
  const prelude = 'const KT = 0.514444, FT = 0.3048, DEG = Math.PI / 180; const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);'
    + 'const wrapPi = (a) => { a = a % (2 * Math.PI); if (a > Math.PI) a -= 2 * Math.PI; if (a < -Math.PI) a += 2 * Math.PI; return a; };'
    + 'const vrefFor = (ac, sc) => (sc && sc.scoring && sc.scoring.vref ? sc.scoring.vref : Math.round(ac.def.speeds.Vref * Math.sqrt(ac.mass / ac.def.mass)));';
  const profile = `${tmpdir()}/ctl-failures-edge-${port}`;
  const edge = spawnProcess('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--edge-skip-compat-layer-relaunch', '--hide-scrollbars', '--allow-file-access-from-files', '--window-size=960,540', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = [];
  try {
    let page; for (let i = 0; i < 100 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch (e) { /* not up yet */ } if (!page) await sleep(200); }
    const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
    let id = 0; const pend = new Map(); const logs = [];
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else if (d.method === 'Runtime.consoleAPICalled' && /error|warn/.test(d.params.type)) logs.push(d.params.args.map((a) => a.value ?? a.description).join(' ')); else if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + JSON.stringify(d.params.exceptionDetails).slice(0, 400)); };
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600)); return r.result && r.result.result && r.result.result.value; };
    await send('Page.enable'); await send('Runtime.enable');
    await send('Page.navigate', { url: pathToFileURL(html).href });
    for (let i = 0; i < 150; i++) { if (await ev('!!window.game')) break; await sleep(100); }
    await sleep(1500);
    await ev(`${prelude}\n${pilots}\nwindow.__MissionPilot = MissionPilot; window.CTL_WIND_SEED = ${seed}; const g = window.game; g.loop = function(){}; const o = g.menus.showDebrief.bind(g.menus); g.menus.showDebrief = (r, sc, st) => { window.__result = r; o(r, sc, st); }; true`);
    for (const m of FAILURES_MISSIONS.filter((x) => !ids || ids.includes(x.id))) {
      const r = await ev(`(() => { const g = window.game; window.__result = null; g.startScenario(G.SCENARIOS.find((s) => s.id === ${JSON.stringify(m.id)})); g.compiling = false;
        const p = new window.__MissionPilot(g.ac, g.world, g.scenario, g.failRt, { act: (a) => g.action(a) });
        g.ap = { update: (dt) => p.update(dt) };
        let n = 0; for (; n < 12000 && g.state === 'flying'; n++) g.frame(1 / 25);
        const ac = g.ac, r = window.__result;
        return { id: ${JSON.stringify(m.id)}, frames: n, state: g.state, crashed: ac.crashed, reason: ac.crashReason || '', points: r && r.points, grade: r && r.grade, wire: ac.trap.wire, keys: p.log, lines: r ? r.lines.map((l) => l.k + ': ' + l.v) : null };
      })()`);
      out.push(r);
      console.log(JSON.stringify({ id: r.id, frames: r.frames, points: r.points, grade: r.grade, crashed: r.crashed, reason: r.reason, wire: r.wire, keys: r.keys }));
      for (const l of r.lines || []) console.log('    ' + l);
    }
    if (logs.length) { console.log('Console errors and warnings:'); console.log(logs.slice(0, 20).join('\n')); }
    ws.close();
  } finally {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' }); else edge.kill();
  }
  return out;
}

const MAIN = !!(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
if (MAIN) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--fly') {
    const sc = SCENARIOS.find((s) => s.id === argv[1]);
    const r = flyMission(sc, { seed: +(argv[2] || 307), logEvery: +(argv[3] || 1), tech: argv[4] || null });
    console.log(JSON.stringify({ id: sc.id, t: +r.t.toFixed(1), crashed: r.ac.crashed, reason: r.ac.crashReason, points: r.result.points, grade: r.result.grade }));
    for (const l of r.result.lines) console.log(`  ${l.k}: ${l.v}`);
    console.log('events', r.events.map((e) => `${e.t}:${e.type}${e.info ? '(' + e.info + ')' : ''}`).join(' '));
    if (r.pilot) console.log('pilot', r.pilot.log.join(', '));
  } else if (argv[0] === '--page') {
    const res = await flyInPage(argv[1], +(argv[2] || 9751), argv[3] && argv[3] !== 'all' ? argv[3].split(',') : null, +(argv[4] || 307));
    process.exit(res.every((r) => r.state === 'debrief' && !r.crashed) ? 0 : 1);
  } else process.exit(runChecks() ? 1 : 0);
}
