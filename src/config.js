// Units and small math helpers. SI everywhere inside the sim; convert at the edges.
export const KT = 0.514444;       // m/s per knot
export const FT = 0.3048;         // m per foot
export const NM = 1852;           // m per nautical mile
export const FPM = FT / 60;       // m/s per foot-per-minute
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const G = 9.80665;
export const RHO0 = 1.225;

export function rhoAt(h) {
  const t = 1 - 2.2558e-5 * Math.max(0, Math.min(h, 11000));
  return RHO0 * Math.pow(t, 4.2559);
}

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const wrapPi = (a) => {
  a = a % (2 * Math.PI);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a < -Math.PI) a += 2 * Math.PI;
  return a;
};
export const wrap360 = (d) => ((d % 360) + 360) % 360;
export const sign = (x) => (x < 0 ? -1 : 1);

// Heading convention: 0 = north = -Z, 90 = east = +X (Three.js is Y-up).
export function headingToVec(psi, out) {
  out.set(Math.sin(psi), 0, -Math.cos(psi));
  return out;
}
export function vecToHeading(v) {
  return Math.atan2(v.x, -v.z);
}

// Deterministic pseudo random with a seed (mulberry32)
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 2D value noise (deterministic), returns -1..1
function hash2(ix, iz, seed) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296 * 2 - 1;
}
export function noise2(x, z, seed = 0) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz);
}
export function fbm2(x, z, octaves = 4, seed = 0, lac = 2.0, gain = 0.5) {
  let s = 0, a = 1, f = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    s += a * noise2(x * f, z * f, seed + i * 17);
    norm += a;
    a *= gain;
    f *= lac;
  }
  return s / norm;
}
