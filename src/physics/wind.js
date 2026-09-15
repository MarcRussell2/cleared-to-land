// Wind: steady vector + gusts + direction wander + turbulence + height gradient.
import { Vector3 } from 'three';
import { DEG, KT, clamp } from '../config.js';

// Smooth 1D noise from summed sines; returns roughly -1..1
class SineNoise {
  constructor(seed, periods) {
    this.ph = [];
    this.w = [];
    let s = seed;
    for (const p of periods) {
      s = (s * 9301 + 49297) % 233280;
      this.ph.push((s / 233280) * Math.PI * 2);
      this.w.push((Math.PI * 2) / p);
    }
    this.n = periods.length;
  }
  at(t) {
    let v = 0;
    for (let i = 0; i < this.n; i++) v += Math.sin(t * this.w[i] + this.ph[i]);
    return v / Math.sqrt(this.n);
  }
}

export class Wind {
  constructor(opts = {}) {
    this.dirDeg = 0;      // direction the wind blows FROM
    this.speedKt = 0;     // steady speed at 10 m
    this.gustKt = 0;      // peak gust
    this.turb = 0;        // 0..1
    this.shear = 0;       // 0..1 extra low-level gradient
    this.seed = 1;
    this.set(opts);
    this._tmp = new Vector3();
  }
  set({ dir = this.dirDeg, speed = this.speedKt, gust = null, turb = this.turb, shear = this.shear, seed = this.seed } = {}) {
    this.dirDeg = dir;
    this.speedKt = speed;
    this.gustKt = gust == null ? speed : Math.max(gust, speed);
    this.turb = turb;
    this.shear = shear;
    this.seed = seed;
    this.gustNoise = new SineNoise(seed * 7 + 1, [4.1, 9.7, 17.3, 31]);
    this.dirNoise = new SineNoise(seed * 13 + 3, [6.3, 14.9, 40]);
    this.tx = new SineNoise(seed * 3 + 5, [0.9, 2.1, 4.7, 11]);
    this.ty = new SineNoise(seed * 5 + 7, [0.7, 1.7, 3.9, 9]);
    this.tz = new SineNoise(seed * 11 + 11, [1.1, 2.6, 5.3, 13]);
  }
  // Current gust-adjusted surface wind (for HUD / windsock)
  surface(t) {
    const g = (this.gustKt - this.speedKt) * (0.35 + 0.65 * clamp(this.gustNoise.at(t) * 0.8, -0.4, 1));
    const spd = Math.max(0, this.speedKt + g);
    const dir = this.dirDeg + 10 * this.turb * this.dirNoise.at(t) + (this.gustKt > this.speedKt ? 6 * this.dirNoise.at(t * 1.7) : 0);
    return { spd, dir };
  }
  heightFactor(h) {
    if (h < 10) return Math.pow(Math.max(h, 0.3) / 10, 0.18 + 0.25 * this.shear);
    return Math.min(1.6, Math.pow(h / 10, 0.10 + 0.08 * this.shear));
  }
  // Wind velocity vector (world, m/s) at position and time
  at(pos, t, out) {
    const { spd, dir } = this.surface(t);
    const psi = (dir + 180) * DEG; // blows toward dir+180
    const h = pos.y - (this.groundY || 0);
    const v = spd * KT * this.heightFactor(Math.max(h, 0));
    out.set(Math.sin(psi) * v, 0, -Math.cos(psi) * v);
    if (this.turb > 0) {
      // spatially varying: fold position into time argument
      const k = 0.02;
      const tt = t + (pos.x + pos.z) * k;
      const amp = this.turb * (1.5 + 0.15 * spd) * KT;
      const nearGround = h < 60 ? 1 + 0.5 * (1 - h / 60) : 1; // mechanical turbulence
      out.x += amp * this.tx.at(tt) * nearGround;
      out.y += amp * 0.6 * this.ty.at(tt + pos.z * k * 0.5) * nearGround;
      out.z += amp * this.tz.at(tt - pos.x * k * 0.5) * nearGround;
    }
    return out;
  }
}
