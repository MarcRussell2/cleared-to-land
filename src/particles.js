// A pooled particle engine for smoke, dust, spray, sparks and fire.
//
// One ParticleSystem is one THREE.Points with a fixed-size pool; the CPU steps every
// live particle each frame (age, velocity, drag toward the ambient air, buoyancy,
// size and opacity curves) and uploads three small attributes. The art bench
// (src/art/effects.js) decides what each system looks like and when it emits; this
// file only knows how to move sprites about. Deterministic: every bit of jitter comes
// from a seeded makeRng, never Math.random, so two runs of the same flight emit the
// same puffs.
//
//   const sys = new ParticleSystem(scene, {
//     max: 600,              pool size (also the most that can be alive at once)
//     texture: tex | null,   the sprite (default: the soft disc from art/lights.js)
//     additive: false,       additive blending (fire, sparks) or normal (smoke, dust)
//     sort: false,           depth-sort normal-blended sprites back to front
//     colorA: 0xffffff,      sprite tint at the start of life ...
//     colorB: colorA,        ... and at the end (fire -> soot: orange -> grey)
//     opacity: 1,            overall alpha multiplier
//     buoyancy: 0,           m/s^2 upward (negative = falls: spray, sparks)
//     drag: 0.5,             1/s: how fast a particle's velocity relaxes to the air's
//     wind: 1,               how much of the wind the ambient air carries (0 = still)
//     fadeIn: 0.15,          fraction of life spent fading in ...
//     fadeOut: 0.5,          ... and the fraction at which the fade-out starts
//     growPow: 1,            size curve shape: size = lerp(size0, size1, t^growPow)
//     lit: true,             multiply the tint by the scene light (setLight) - smoke
//                            goes dark at night; false for things that glow
//     seed: 1,
//   });
//   sys.burst(pos, vel, count, { spread, velSpread, life, lifeJitter, size0, size1, tint, alpha })
//   const e = sys.emitter({ ... });    see Emitter below
//   sys.update(dt, env);                env = { windAt(pos, t, out), t, camera, viewH }
//   sys.setLight(r, g, b);              scene light, applied when lit: true
//   sys.reset();
//
// Emitters are attached to a moving frame - the aircraft - and emit at a rate. They
// interpolate the emission point between the frame's previous and current position
// (sub-frame emission), so a 140-knot aircraft leaves a continuous ribbon rather than
// one puff per frame ("golf balls").
//
//   const e = sys.emitter({
//     rate: 40,                    particles per second (0 = off)
//     frame: object3d | null,      whose position/quaternion take the anchor to world
//     anchor: { position, direction, radius },   in the frame's own coordinates
//     speed: 2, speedSpread: 0.5,  along the anchor's direction, m/s (in the AIR)
//     cone: 0.2,                   half-angle of the emission cone, rad
//     inherit: 0,                  fraction of the frame's velocity the particle keeps
//     life: 1.5, lifeJitter: 0.4,  seconds, +- fraction
//     size0: 0.3, size1: 1.2,      sprite size at birth and at death, metres
//     tint: 0, alpha: 1,
//   });
//   e.rate = 0;  e.set({ speed: 4 });   change anything between frames
//
// Sizes are world metres: a sprite of size s covers about s metres at the particle,
// whatever the resolution. Nothing here allocates per frame after construction.
import * as THREE from 'three';
import { makeRng, clamp, lerp } from './config.js';
import { getDisc } from './art/lights.js';

const _p = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _d = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();

const VERT = `
attribute float aSize; attribute float aAlpha; attribute float aTint; attribute float aRot;
uniform float uScale;
varying float vA; varying float vT; varying float vR;
void main() {
  vA = aAlpha; vT = aTint; vR = aRot;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // aSize is a diameter in metres: project it to pixels at this depth
  gl_PointSize = aSize * uScale / max(-mv.z, 0.5);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform vec3 colorA, colorB, uLight; uniform sampler2D map; uniform float opacity;
varying float vA; varying float vT; varying float vR;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float s = sin(vR), k = cos(vR);
  vec2 uv = vec2(c.x * k - c.y * s, c.x * s + c.y * k) + 0.5;
  vec4 t = texture2D(map, uv);
  vec3 col = mix(colorA, colorB, vT) * uLight;
  gl_FragColor = vec4(col, t.a * vA * opacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class ParticleSystem {
  constructor(scene, opts = {}) {
    const o = { max: 500, texture: null, additive: false, sort: false, colorA: 0xffffff, colorB: null, opacity: 1, buoyancy: 0, drag: 0.5, wind: 1, fadeIn: 0.15, fadeOut: 0.5, growPow: 1, lit: true, seed: 1, ...opts };
    this.opts = o;
    this.max = o.max;
    this.rng = makeRng(o.seed);
    const n = o.max;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n).fill(1e9);
    this.life = new Float32Array(n).fill(1);
    this.size0 = new Float32Array(n);
    this.size1 = new Float32Array(n);
    this.alpha0 = new Float32Array(n);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.tint = new Float32Array(n);
    this.rot = new Float32Array(n);
    this.spin = new Float32Array(n);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aTint', new THREE.BufferAttribute(this.tint, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    // The live list: only these slots are stepped and drawn each frame (docs/PERF.md: no
    // loop over dead slots, no draw when nothing is alive). The index buffer is the live
    // list, so the GPU never touches a dead sprite either.
    this.live = new Int32Array(n); this.liveN = 0; this.isLive = new Uint8Array(n);
    this.order = new Uint16Array(n);
    this.dist = new Float32Array(n);
    this.index = new THREE.BufferAttribute(this.order, 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setIndex(this.index);
    this.geo.setDrawRange(0, 0);
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    const texture = o.texture || (typeof document !== 'undefined' ? getDisc() : null);
    this.mat = new THREE.ShaderMaterial({
      name: 'particles',
      uniforms: {
        colorA: { value: new THREE.Color(o.colorA) }, colorB: { value: new THREE.Color(o.colorB ?? o.colorA) },
        uLight: { value: new THREE.Color(1, 1, 1) }, map: { value: texture }, opacity: { value: o.opacity }, uScale: { value: 1080 },
      },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: true, fog: false,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = true;      // the bounding sphere is refitted to the live particles every update
    this.points.visible = false;           // no draw call while nothing is alive
    this.points.renderOrder = o.additive ? 12 : 10;
    this.points.name = 'particles';
    scene.add(this.points);
    this.next = 0;
    this.alive = 0;
    this.emitters = [];
    this.frameCount = 0;
  }
  setLight(r, g, b) { if (this.opts.lit) this.mat.uniforms.uLight.value.setRGB(r, g, b); }
  // One particle. p, v are Vector3 (world); o: { life, size0, size1, tint, alpha, age }
  spawn(p, v, o) {
    const i = this.next; this.next = (this.next + 1) % this.max;
    const age = o.age || 0;
    this.pos[i * 3] = p.x + v.x * age; this.pos[i * 3 + 1] = p.y + v.y * age; this.pos[i * 3 + 2] = p.z + v.z * age;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.age[i] = age;
    this.life[i] = Math.max(o.life ?? 1, 0.05);
    this.size0[i] = o.size0 ?? 0.5; this.size1[i] = o.size1 ?? this.size0[i];
    this.alpha0[i] = o.alpha ?? 1;
    this.tint[i] = o.tint ?? 0;
    this.rot[i] = this.rng() * Math.PI * 2;
    this.spin[i] = (this.rng() - 0.5) * 1.2;
    this.size[i] = this.size0[i]; this.alpha[i] = 0;
    if (!this.isLive[i]) { this.isLive[i] = 1; this.live[this.liveN++] = i; }   // a ring overwrite is already listed
    this.alive = 1;
    return i;
  }
  // A burst at a world point: count particles with jittered position, velocity and life.
  burst(p, v, count, o = {}) {
    const spread = o.spread ?? 0.3, vs = o.velSpread ?? 1, lj = o.lifeJitter ?? 0.3;
    for (let k = 0; k < count; k++) {
      _p.set(p.x + (this.rng() - 0.5) * 2 * spread, p.y + (this.rng() - 0.5) * 2 * spread, p.z + (this.rng() - 0.5) * 2 * spread);
      _v.set(v.x + (this.rng() - 0.5) * 2 * vs, v.y + (this.rng() - 0.5) * 2 * vs, v.z + (this.rng() - 0.5) * 2 * vs);
      this.spawn(_p, _v, { life: (o.life ?? 1) * (1 + (this.rng() - 0.5) * 2 * lj), size0: o.size0, size1: o.size1, tint: o.tint, alpha: o.alpha });
    }
  }
  emitter(cfg) { const e = new Emitter(this, cfg); this.emitters.push(e); return e; }
  update(dt, env = {}) {
    this.frameCount++;
    for (const e of this.emitters) e.update(dt, env);
    if (!this.alive) return;
    const o = this.opts;
    const dragK = 1 - Math.exp(-o.drag * dt);
    const windAt = env.windAt, t = env.t || 0;
    // step the live list only, swap-removing the dead; fit a bounding sphere to what is left
    let n = this.liveN, k = 0, maxSize = 0;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    while (k < n) {
      const i = this.live[k];
      this.age[i] += dt;
      const u = this.age[i] / this.life[i];
      if (u >= 1) { this.alpha[i] = 0; this.age[i] = 1e9; this.isLive[i] = 0; this.live[k] = this.live[--n]; continue; }
      const i3 = i * 3;
      // ambient air: the wind at this point (or still air), the velocity relaxes toward it
      _w.set(0, 0, 0);
      if (windAt && o.wind) { _p.set(this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2]); windAt(_p, t, _w); _w.multiplyScalar(o.wind); }
      this.vel[i3] += (_w.x - this.vel[i3]) * dragK;
      this.vel[i3 + 1] += (_w.y - this.vel[i3 + 1]) * dragK + o.buoyancy * dt;
      this.vel[i3 + 2] += (_w.z - this.vel[i3 + 2]) * dragK;
      const x = (this.pos[i3] += this.vel[i3] * dt), y = (this.pos[i3 + 1] += this.vel[i3 + 1] * dt), z = (this.pos[i3 + 2] += this.vel[i3 + 2] * dt);
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      const g = o.growPow === 1 ? u : Math.pow(u, o.growPow);
      const size = this.size[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * g;
      if (size > maxSize) maxSize = size;
      const fi = o.fadeIn > 0 ? clamp(u / o.fadeIn, 0, 1) : 1;
      const fo = u > o.fadeOut ? 1 - (u - o.fadeOut) / (1 - o.fadeOut) : 1;
      this.alpha[i] = this.alpha0[i] * fi * fo;
      this.rot[i] += this.spin[i] * dt;
      k++;
    }
    this.liveN = n;
    if (!n) { this.alive = 0; this.points.visible = false; this.geo.setDrawRange(0, 0); return; }
    // the index buffer is the live list (sorted back to front only when asked: docs/PERF.md says not on phones)
    if (o.sort && env.camera) this.sortBack(env.camera);
    else { for (let j = 0; j < n; j++) this.order[j] = this.live[j]; }
    this.index.needsUpdate = true;
    this.geo.setDrawRange(0, n);
    const s = this.geo.boundingSphere;
    s.center.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    s.radius = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2 + maxSize;
    this.points.visible = true;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aTint.needsUpdate = true;
    this.geo.attributes.aRot.needsUpdate = true;
    if (env.viewH) this.mat.uniforms.uScale.value = env.viewH;
  }
  // Back-to-front for normal blending over the live list, farthest first. Costs a sort
  // per frame: off by default and not for the phone tiers.
  sortBack(camera) {
    const c = camera.position, n = this.liveN;
    for (let j = 0; j < n; j++) {
      const i = this.live[j];
      const dx = this.pos[i * 3] - c.x, dy = this.pos[i * 3 + 1] - c.y, dz = this.pos[i * 3 + 2] - c.z;
      this.dist[i] = dx * dx + dy * dy + dz * dz;
      this.order[j] = i;
    }
    const d = this.dist;
    this.order.subarray(0, n).sort((a, b) => d[b] - d[a]);
  }
  reset() {
    this.age.fill(1e9); this.alpha.fill(0); this.isLive.fill(0); this.liveN = 0;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.setDrawRange(0, 0);
    this.alive = 0; this.points.visible = false;
    for (const e of this.emitters) e.reset();
  }
  dispose() { this.points.parent?.remove(this.points); this.geo.dispose(); this.mat.dispose(); }
}

export class Emitter {
  constructor(sys, cfg) {
    this.sys = sys;
    this.rate = 0; this.frame = null; this.anchor = null; this.speed = 1; this.speedSpread = 0.3; this.cone = 0.2; this.inherit = 0;
    this.life = 1; this.lifeJitter = 0.3; this.size0 = 0.3; this.size1 = 1; this.tint = 0; this.alpha = 1; this.radius = null;
    this.set(cfg);
    this.accum = 0;
    this.prev = new THREE.Vector3(); this.cur = new THREE.Vector3(); this.dir = new THREE.Vector3(0, 0, 1); this.frameVel = new THREE.Vector3();
    this.primed = false;
  }
  set(cfg) { Object.assign(this, cfg); return this; }
  reset() { this.primed = false; this.accum = 0; }
  // The anchor in world space now (position, direction), from the frame's position/quaternion.
  worldAnchor(pos, dir) {
    const a = this.anchor;
    if (this.frame) {
      pos.copy(a.position).applyQuaternion(this.frame.quaternion).add(this.frame.position);
      dir.copy(a.direction).applyQuaternion(this.frame.quaternion);
    } else { pos.copy(a.position); dir.copy(a.direction); }
  }
  update(dt, env) {
    if (!this.anchor) return;
    this.worldAnchor(this.cur, this.dir);
    if (!this.primed || dt <= 0) { this.prev.copy(this.cur); this.primed = true; if (dt <= 0) return; }
    this.frameVel.subVectors(this.cur, this.prev).multiplyScalar(1 / dt);
    if (this.rate > 0) {
      this.accum += this.rate * dt;
      const n = Math.floor(this.accum);
      if (n > 0) {
        this.accum -= n;
        const sys = this.sys, rng = sys.rng;
        const r = this.radius ?? this.anchor.radius ?? 0;
        // a basis across the direction, for the cone and the outlet radius
        _a.set(0, 1, 0); if (Math.abs(_a.dot(this.dir)) > 0.9) _a.set(1, 0, 0);
        _b.crossVectors(this.dir, _a).normalize(); _a.crossVectors(_b, this.dir).normalize();
        for (let k = 0; k < n; k++) {
          const f = (k + 0.5) / n;                       // when in the frame this one left
          _p.lerpVectors(this.prev, this.cur, f);
          const ang = rng() * Math.PI * 2, rr = Math.sqrt(rng()) * r;
          _p.addScaledVector(_a, Math.cos(ang) * rr).addScaledVector(_b, Math.sin(ang) * rr);
          const sp = this.speed * (1 + (rng() - 0.5) * 2 * this.speedSpread);
          const ca = (rng() - 0.5) * 2 * this.cone, cb = (rng() - 0.5) * 2 * this.cone;
          _v.copy(this.dir).addScaledVector(_a, ca).addScaledVector(_b, cb).normalize().multiplyScalar(sp);
          _v.addScaledVector(this.frameVel, this.inherit);
          sys.spawn(_p, _v, { life: this.life * (1 + (rng() - 0.5) * 2 * this.lifeJitter), size0: this.size0, size1: this.size1, tint: this.tint, alpha: this.alpha, age: dt * (1 - f) });
        }
      }
    } else this.accum = 0;
    this.prev.copy(this.cur);
  }
}
