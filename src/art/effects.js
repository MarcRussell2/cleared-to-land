// The LOOK of everything that is smoke, dust, spray, sparks or fire: engine exhaust
// (idle haze, the puff when the throttle goes up, soot on a jet spooling, the stream
// from a failed engine), tyre smoke and dust on touchdown and in a skid, water spray,
// sparks from a scraping belly or hook, and the fire and black smoke of a crash.
//
// The mechanics live in src/particles.js (the engine's: pools, sub-frame emission,
// wind advection, curves). This file decides pool sizes, textures, colours, rates,
// sizes, lifetimes and WHEN each emitter runs - that is the art. Read the header of
// particles.js for the API; everything you configure is a plain number here.
//
// Contract with the engine (keep it):
//   new Effects(scene, { seed })
//   effects.update(dt, ac, model, env)   every frame while an aircraft exists
//     ac     the live aircraft (read-only): pos, quat, vel, legs[] (contact, skid,
//            kind, impact, pos, radius), points[] (contact, kind, pos), hookPt,
//            engines[] ({ type: 'prop'|'jet', throttle 0..1, rpm 0..1 (props: 0.25
//            idle .. 1; jets: n1 fraction), thrust N, failed }), failures (a Set),
//            crashed, gsRel (ground speed over the surface), groundTime, wheelsOnGround
//     model  the aircraft's model: model.group (position/quaternion = the body
//            frame in the world) and model.anchors.exhaust[] (one per engine:
//            { position, direction, radius } in the body frame)
//     env    { windAt(pos, t, out), t, camera, viewH, sky: { sun, hemi, moon, dayness } }
//   effects.reset()
//
// Deterministic: seeded through ParticleSystem; never Math.random.
import * as THREE from 'three';
import { clamp, lerp, makeRng } from '../config.js';
import { ParticleSystem } from '../particles.js';

// A soft, lumpy puff: a few overlapping blobs, drawn once and cached (textures may be
// cached across scenarios; materials may not - the systems are rebuilt per scene).
let _puff = null;
function puffTexture() {
  if (_puff) return _puff;
  if (typeof document === 'undefined') return null;
  const S = 128, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  const rng = makeRng(311);
  for (let i = 0; i < 9; i++) {
    const r = S * (0.16 + rng() * 0.16), x = S / 2 + (rng() - 0.5) * S * 0.36, y = S / 2 + (rng() - 0.5) * S * 0.36;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.55)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.22)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
  }
  _puff = new THREE.CanvasTexture(c);
  return _puff;
}

const _p = new THREE.Vector3(), _v = new THREE.Vector3(), _c = new THREE.Color();

export class Effects {
  constructor(scene, opts = {}) {
    const seed = opts.seed || 1;
    const puff = puffTexture();
    // the pools, one per look (no depth sorting: docs/PERF.md forbids it on the phone tiers, and
    // soft puffs with depthWrite off read fine unsorted)
    this.smoke = new ParticleSystem(scene, { max: 700, texture: puff, colorA: 0xb9bec2, colorB: 0xc9ced2, opacity: 0.5, buoyancy: 0.6, drag: 1.4, fadeIn: 0.1, fadeOut: 0.35, seed: seed + 1 });
    this.dust = new ParticleSystem(scene, { max: 700, texture: puff, colorA: 0x9a8560, colorB: 0xb3a07c, opacity: 0.45, buoyancy: 0.25, drag: 1.1, fadeIn: 0.1, fadeOut: 0.4, seed: seed + 2 });
    this.spray = new ParticleSystem(scene, { max: 500, texture: puff, colorA: 0xe8f4ff, colorB: 0xdfeeff, opacity: 0.55, buoyancy: -4, drag: 0.9, fadeIn: 0.05, fadeOut: 0.5, seed: seed + 3 });
    this.sparks = new ParticleSystem(scene, { max: 600, colorA: 0xffd28a, colorB: 0xff5a10, opacity: 1.5, buoyancy: -9, drag: 0.4, wind: 0.3, fadeIn: 0.02, fadeOut: 0.6, additive: true, lit: false, seed: seed + 4 });
    this.fire = new ParticleSystem(scene, { max: 400, texture: puff, colorA: 0xffb060, colorB: 0xff3a08, opacity: 1.2, buoyancy: 3.5, drag: 1.5, fadeIn: 0.1, fadeOut: 0.3, additive: true, lit: false, seed: seed + 5 });
    this.blackSmoke = new ParticleSystem(scene, { max: 900, texture: puff, colorA: 0x2a2624, colorB: 0x3d3a37, opacity: 0.7, buoyancy: 2.2, drag: 0.8, fadeIn: 0.15, fadeOut: 0.5, growPow: 0.7, seed: seed + 6 });
    // engine exhaust: one plume pool for all engines, a soot/failure pool
    this.exhaust = new ParticleSystem(scene, { max: 900, texture: puff, colorA: 0x8d939a, colorB: 0xb4b9be, opacity: 0.16, buoyancy: 0.35, drag: 2.2, fadeIn: 0.15, fadeOut: 0.3, seed: seed + 7 });
    this.soot = new ParticleSystem(scene, { max: 900, texture: puff, colorA: 0x3a3634, colorB: 0x6a6663, opacity: 0.55, buoyancy: 0.8, drag: 0.9, fadeIn: 0.1, fadeOut: 0.45, growPow: 0.8, seed: seed + 8 });
    this.all = [this.exhaust, this.soot, this.smoke, this.dust, this.spray, this.sparks, this.fire, this.blackSmoke];
    this.plumes = [];       // per engine: { plume, soot, prevThrottle, puff }
    this.model = null;
    this.crashT = 0;
    this.light = new THREE.Color(1, 1, 1);
  }

  // The engine's exhaust emitters are made once per model (the anchors are the model's).
  attach(model, ac) {
    if (this.model === model) return;
    this.model = model;
    for (const e of this.plumes) { e.plume.rate = 0; e.soot.rate = 0; }
    this.plumes = [];
    const anchors = (model.anchors && model.anchors.exhaust) || [];
    ac.engines.forEach((eng, i) => {
      const a = anchors[i] || anchors[0];
      if (!a) return;
      const prop = eng.type === 'prop';
      const plume = this.exhaust.emitter({ rate: 0, frame: model.group, anchor: a, speed: prop ? 3 : 12, speedSpread: 0.4, cone: prop ? 0.35 : 0.12, inherit: 0, life: prop ? 1.4 : 1.0, lifeJitter: 0.4, size0: prop ? 0.18 : 0.8, size1: prop ? 1.4 : 4.5, alpha: 1 });
      const soot = this.soot.emitter({ rate: 0, frame: model.group, anchor: a, speed: prop ? 2.5 : 9, speedSpread: 0.5, cone: prop ? 0.4 : 0.15, inherit: 0, life: prop ? 2.2 : 3.5, lifeJitter: 0.4, size0: prop ? 0.25 : 1.0, size1: prop ? 2.2 : 7, alpha: 1 });
      this.plumes.push({ plume, soot, prevThrottle: eng.throttle, puff: 0, prop, i, failedT: 0 });
    });
  }

  // What the engines put out: haze at idle, a plume with power, a puff of darker smoke
  // when the throttle comes up (a piston engine richening), soot on a jet's spool-up,
  // and a stream of it from a failed engine.
  engines(dt, ac) {
    for (const P of this.plumes) {
      const e = ac.engines[P.i];
      if (!e) continue;
      const thr = clamp(e.throttle, 0, 1);
      const dThr = (thr - P.prevThrottle) / Math.max(dt, 1e-3);
      P.prevThrottle = thr;
      if (dThr > 0.35) P.puff = Math.max(P.puff, clamp(dThr * 0.9, 0.3, 1));
      P.puff = Math.max(0, P.puff - dt * 1.6);
      if (e.failed) {
        // a dead engine: a fading stream of grey-black smoke for a while, then nothing
        P.failedT += dt;
        const s = clamp(1 - P.failedT / 14, 0, 1);
        P.plume.rate = 0;
        P.soot.set({ rate: 90 * s, size0: P.prop ? 0.3 : 1.2, size1: P.prop ? 2.6 : 8, alpha: 0.9 * s, tint: 0.2 });
        continue;
      }
      P.failedT = 0;
      if (P.prop) {
        const running = e.rpm > 0.2;
        P.plume.set({ rate: running ? lerp(28, 70, thr) : 0, alpha: lerp(0.9, 0.45, thr), size1: lerp(1.2, 1.9, thr), tint: lerp(0, 0.7, thr) });
        P.soot.set({ rate: P.puff > 0.05 ? 90 * P.puff : 0, alpha: 0.5 * P.puff, size0: 0.25, size1: 1.8, tint: 0.6 });
      } else {
        // jets: nearly clean; a faint haze at the pipe, darker on a spool-up
        const n1 = clamp(e.rpm, 0, 1);
        P.plume.set({ rate: lerp(20, 45, n1), alpha: lerp(0.35, 0.65, n1), size1: lerp(3.5, 5.5, n1), tint: 1 });
        P.soot.set({ rate: P.puff > 0.05 ? 60 * P.puff : 0, alpha: 0.45 * P.puff, size0: 0.8, size1: 6, tint: 0.7 });
      }
    }
  }

  update(dt, ac, model, env = {}) {
    if (ac && model) this.attach(model, ac);
    // the light on the smoke: the scene's sun and sky
    if (env.sky) {
      const sun = env.sky.sun, hemi = env.sky.hemi, moon = env.sky.moon;
      this.light.setRGB(0, 0, 0);
      if (sun) this.light.add(_c.copy(sun.color).multiplyScalar(sun.intensity * 0.15));
      if (hemi) this.light.add(_c.copy(hemi.color).multiplyScalar(hemi.intensity * 0.35));
      if (moon) this.light.add(_c.copy(moon.color).multiplyScalar(moon.intensity * 0.15));
      for (const s of this.all) s.setLight(this.light.r, this.light.g, this.light.b);
    }
    if (ac && !ac.crashed) {
      this.engines(dt, ac);
      // tire smoke / dust from skidding or hard contact
      for (const l of ac.legs) {
        if (!l.contact) continue;
        const skid = l.skid;
        const p = _p.copy(l.pos).applyQuaternion(ac.quat).add(ac.pos);
        p.y -= l.radius * 0.9;
        const v = _v.copy(ac.vel).multiplyScalar(0.15); v.y += 1.5;
        if (l.kind === 'gravel' || l.kind === 'dirt' || l.kind === 'sand' || l.kind === 'grass') {
          if (ac.gsRel > 6) this.dust.burst(p, v, 1 + Math.floor(ac.gsRel / 20), { spread: 0.4, velSpread: 1.5, life: 2.5, size0: 0.6 * (1 + skid), size1: 4 * (1 + skid) });
        } else if (skid > 0.05 && ac.gsRel > 4) {
          this.smoke.burst(p, v, skid > 0.5 ? 3 : 1, { spread: 0.3, velSpread: 1.2, life: 2.2, size0: 0.35 * (0.8 + skid), size1: 2.6 * (0.8 + skid) });
        }
        // touchdown puff
        if (l.impact > 1.2 && ac.groundTime < 0.15 && l.kind === 'runway') this.smoke.burst(p, v, 4, { spread: 0.5, velSpread: 2, life: 2.2, size0: 0.6, size1: 3.5 });
        if (l.kind === 'deck' && l.impact > 2 && ac.groundTime < 0.15) this.smoke.burst(p, v, 4, { spread: 0.5, velSpread: 2, life: 2.0, size0: 0.5, size1: 3 });
      }
      for (const p0 of ac.points) {
        if (!p0.contact || ac.gsRel < 3) continue;
        const p = _p.copy(p0.pos).applyQuaternion(ac.quat).add(ac.pos);
        const v = _v.copy(ac.vel).multiplyScalar(0.3);
        v.y += 3;
        if (p0.kind === 'runway' || p0.kind === 'deck') this.sparks.burst(p, v, 6, { spread: 0.25, velSpread: 4, life: 0.7, lifeJitter: 0.5, size0: 0.12, size1: 0.05 });
        else this.dust.burst(p, v, 3, { spread: 0.6, velSpread: 2, life: 2.5, size0: 0.8, size1: 4 });
      }
      if (ac.hookPt && ac.hookPt.contact && ac.gsRel > 3) {
        const p = _p.copy(ac.hookPt.pos).applyQuaternion(ac.quat).add(ac.pos);
        const v = _v.copy(ac.vel).multiplyScalar(0.2); v.y += 2;
        this.sparks.burst(p, v, 5, { spread: 0.2, velSpread: 3.5, life: 0.6, lifeJitter: 0.5, size0: 0.1, size1: 0.04 });
      }
    } else if (ac && ac.crashed) {
      for (const P of this.plumes) { P.plume.rate = 0; P.soot.rate = 0; }
      this.crashT += dt;
      if (this.crashT < 12) {
        const p = _p.copy(ac.pos);
        const v = _v.set(0, 6, 0);
        this.fire.burst(p, v, this.crashT < 3 ? 6 : 2, { spread: 2.5, velSpread: 2.5, life: 1.1, size0: 3 * (this.crashT < 1 ? 2 : 1), size1: 6 });
        this.blackSmoke.burst(p, v, 2, { spread: 2.5, velSpread: 2, life: this.crashT < 2 ? 4 : 6.5, size0: 4, size1: 22 });
      }
    }
    for (const s of this.all) s.update(dt, env);
  }
  reset() { for (const s of this.all) s.reset(); this.crashT = 0; this.model = null; this.plumes = []; }
}
