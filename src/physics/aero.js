// Coefficient-based aerodynamics with an honest stall.
//
// Body frame (matches the meshes): forward = -Z, up = +Y, right = +X.
// Aero convention for rates/moments: p = roll right, q = pitch up, r = yaw right.
//   p = -omega.z   q = omega.x   r = -omega.y
// Moments returned in aero convention (L roll-right, M pitch-up, N yaw-right);
// aircraft.js maps them onto body torques.
import { Vector3 } from 'three';
import { DEG, clamp, lerp, smoothstep } from '../config.js';

const UP = new Vector3(0, 1, 0);
const _vhat = new Vector3();
const _lift = new Vector3();

// Wing lift coefficient vs angle of attack with a rounded peak, a stall break,
// and a blend to flat-plate behaviour deep in the stall.
export function wingCL(alpha, def, flap, ice, out) {
  const st = def.stall;
  const a0 = def.CLa * (1 - 0.12 * ice);
  const cl0 = def.CL0 + def.flaps.dCL0 * flap - 0.08 * ice;
  const aS = st.alpha + def.flaps.dAlphaStall * flap - ice * 4 * DEG;
  const aSN = st.alphaNeg;
  const w = st.round;
  const brk = st.breakWidth;
  const ret = st.retention;

  let clLin;
  if (alpha > aS - w) {
    const d = alpha - aS;
    clLin = cl0 + a0 * aS - (a0 * w) / 2 - (a0 * d * d) / (2 * w);
  } else if (alpha < aSN + w) {
    const d = alpha - aSN;
    clLin = cl0 + a0 * aSN + (a0 * w) / 2 + (a0 * d * d) / (2 * w);
  } else {
    clLin = cl0 + a0 * alpha;
  }
  let sigma;
  if (alpha >= 0) sigma = smoothstep(aS + w * 0.5, aS + w * 0.5 + brk, alpha);
  else sigma = smoothstep(-(aSN - w * 0.5), -(aSN - w * 0.5) + brk * 1.5, -alpha);

  const fp = 0.9 * Math.sin(2 * alpha);
  const post = fp * (1 + ret * (1 - smoothstep(aS, aS + 30 * DEG, Math.abs(alpha))));
  const cl = (1 - sigma) * clLin + sigma * post;
  out.cl = cl;
  out.sigma = sigma;
  out.aS = aS;
  out.clMax = cl0 + a0 * aS - (a0 * w) / 2;
  return out;
}

const _wcl = { cl: 0, sigma: 0, aS: 0, clMax: 0 };

// Plain-flap effectiveness at large deflection (DATCOM K'): a rudder keeps its full per-degree power to
// about 10 deg, then the flow separates on the surface and each extra degree buys less: ~0.95 at 16 deg,
// ~0.83 at 22 deg, ~0.77 at 25 deg, ~0.69 at 30 deg. Full pedal is still the strongest input; it is
// just not proportionally so (yaw pass, 2026-09-14).
export function rudderEffectiveness(dr) {
  return 1 - 0.35 * smoothstep(10 * DEG, 35 * DEG, Math.abs(dr));
}

// The fin's share of the dynamic pressure: on the prop aircraft the vertical tail sits in the slipstream,
// so everything it makes (weathercock, yaw damping, rudder power, side force) scales with qTail, capped
// at 2.5x the freestream so power at walking pace cannot make the tail infinitely stiff.
export function finPressureRatio(qTail, qbar) {
  return qbar > 1 ? clamp(qTail / qbar, 0, 2.5) : 0;
}

// Ground effect: sigma -> 1 far from ground. h = wing height above ground, b = span.
export function groundEffectSigma(h, b) {
  const x = (16 * Math.max(h, 0.05)) / b;
  const x2 = x * x;
  return x2 / (1 + x2);
}

// Quick deterministic noise for buffet (needs no state)
function jitter(t, k) {
  return Math.sin(t * 31.7 * k) * Math.sin(t * 17.3 * k + 1.3) * Math.sin(t * 7.1 * k + 0.7);
}

export function computeAero(ac, out) {
  const def = ac.def, ctl = ac.ctl;
  const va = ac.vAirBody;
  const V = va.length();
  const rho = ac.rho;
  const S = def.S, b = def.span, c = def.chord;

  const u = -va.z, v = va.x, w = -va.y;
  // alpha is the angle of the flow in the wing's chord plane, atan(w/u). Under the independence principle
  // for a yawed wing that IS the sectional angle of attack, so the stall keys on it. What the spanwise
  // component v does not do is make lift: the wing only sees q*(u^2+w^2)/V^2 = q*cos^2(beta), so a slip
  // costs lift (and the airplane sinks) instead of gaining it (yaw pass, 2026-09-14).
  const alpha = Math.atan2(w, Math.max(u, 0.5));
  const beta = V > 1 ? Math.asin(clamp(v / V, -1, 1)) : 0;
  const qbar = 0.5 * rho * V * V;
  const cb2 = V > 1 ? clamp((u * u + w * w) / (V * V), 0, 1) : 1;   // cos^2(beta)
  const qTail = ac.qTail;               // dynamic pressure at the tail incl. propwash
  const kFin = finPressureRatio(qTail, qbar);
  const flap = ctl.flap;
  const ice = ac.ice;
  const sge = groundEffectSigma(ac.radioAlt + def.wingHeight, b);

  wingCL(alpha, def, flap, ice, _wcl);
  const sig = _wcl.sigma;
  const clWing = _wcl.cl;
  const aS = _wcl.aS;

  // Lift: wing + ground effect boost - spoilers
  let CL = clWing * (1 + def.geLift * (1 - sge)) - def.spoilerDCL * ctl.spoiler;

  // Drag
  const K = def.K * sge;
  const cfg = def.flaps.dCD0 * flap + def.CDgear * ctl.gear + def.CDspoiler * ctl.spoiler + def.CDbeta * beta * beta + ac.windmillDrag;
  const CDbase = def.CD0 + K * clWing * clWing + cfg;
  const CDstall = def.CD0 + 1.2 * Math.sin(alpha) * Math.sin(alpha) + cfg + 0.05;
  const CD = lerp(CDbase, CDstall, sig);

  // Side force (fin + fuselage; the fin group rides on the tail's dynamic pressure)
  const de = ctl.elevator * def.controls.elevatorMax;
  const da = ctl.aileron * def.controls.aileronMax;
  const dr = ctl.rudder * def.controls.rudderMax;
  const drEff = dr * rudderEffectiveness(dr);
  const CY = (def.CYb * beta + def.CYdr * drEff) * kFin;

  // Non-dimensional rates
  const V2 = Math.max(V, 3);
  const p = -ac.omega.z, q = ac.omega.x, r = -ac.omega.y;
  const ph = (p * b) / (2 * V2), qh = (q * c) / (2 * V2), rh = (r * b) / (2 * V2);

  // Stall side effects
  const deep = clamp((alpha - aS) / (10 * DEG), 0, 1);
  const buffet = clamp((alpha - (aS - 2.5 * DEG)) / (4 * DEG), 0, 1) * (V > 8 ? 1 : 0);
  const ailEff = 1 - 0.75 * sig;
  const t = ac.time;
  const jit = jitter(t, 1 + ac.stallBias * 0.1);

  // Moments (aero convention). The vertical tail's terms (weathercock Cnb, yaw damping Cnr, rudder Cndr and
  // the rudder's roll Cldr) all scale with kFin: before the yaw pass only the rudder term did, so power made
  // the rudder stronger without making the fin stiffer and full rudder at low speed put the airplane sideways.
  let Cm = def.Cm0 + def.Cma * alpha + def.Cmq * qh + def.Cmflap * flap + def.CmGE * (1 - sge) - 0.06 * deep + 0.03 * buffet * jit;
  let Cl = def.Clb * beta + def.Clp * ph + def.Clr * rh + def.Clda * da * ailEff + def.Cldr * drEff * kFin
    + def.stall.wingDrop * sig * ac.stallBias * (0.7 + 0.3 * Math.sin(t * 0.9)) + 0.02 * buffet * jitter(t + 3, 1.3);
  let Cn = (def.Cnb * beta + def.Cnr * rh + def.Cndr * drEff) * kFin + def.Cnp * ph + def.Cnda * da
    + 0.01 * buffet * jitter(t + 7, 0.8)
    - def.propYaw * ac.powerFrac * (1 - 0.6 * clamp(V / 50, 0, 1));   // P-factor / slipstream: nose left with power at low speed

  // Control pitch moment uses tail dynamic pressure (propwash helps at low speed)
  const Mctl = qTail * S * c * def.Cmde * de;

  // Forces in body frame
  if (V > 0.5) _vhat.copy(va).multiplyScalar(1 / V); else _vhat.set(0, 0, -1);
  _lift.copy(UP).addScaledVector(_vhat, -UP.dot(_vhat));
  if (_lift.lengthSq() < 1e-6) _lift.set(0, 1, 0); else _lift.normalize();

  out.F.set(0, 0, 0)
    .addScaledVector(_lift, qbar * cb2 * S * CL)
    .addScaledVector(_vhat, -qbar * S * CD)
    .add(new Vector3(qbar * S * CY, 0, 0));

  out.M = qbar * S * c * Cm + Mctl;
  out.L = qbar * S * b * Cl;
  out.N = qbar * S * b * Cn;

  out.alpha = alpha;
  out.beta = beta;
  out.CL = CL;
  out.CD = CD;
  out.qbar = qbar;
  out.V = V;
  out.stall = sig;
  out.deep = deep;
  out.buffet = buffet;
  out.alphaStall = aS;
  out.clMax = _wcl.clMax;
  out.warning = alpha > aS - def.stall.warnMargin && V > 14 && !(ac.wheelsOnGround && ac.gsRel < 20);
  out.groundEffect = 1 - sge;
  out.kFin = kFin;
  out.cosBeta2 = cb2;
  return out;
}

export function makeAeroOut() {
  return { F: new Vector3(), M: 0, L: 0, N: 0, alpha: 0, beta: 0, CL: 0, CD: 0, qbar: 0, V: 0, stall: 0, deep: 0, buffet: 0, alphaStall: 0.26, clMax: 1.5, warning: false, groundEffect: 0, kFin: 1, cosBeta2: 1 };
}

// Stall speed (TAS, m/s) for a given configuration and load factor
export function stallSpeed(def, mass, flap, ice = 0, rho = 1.225, n = 1) {
  wingCL(def.stall.alpha + def.flaps.dAlphaStall * flap - ice * 4 * DEG, def, flap, ice, _wcl);
  const clMax = _wcl.clMax;
  return Math.sqrt((2 * mass * 9.80665 * n) / (rho * def.S * clMax));
}
