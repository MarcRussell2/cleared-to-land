// Camera rig: chase, cockpit, tower, fly-by, wing views with shake and free-look.
import * as THREE from 'three';
import { clamp, lerp, DEG, RAD, makeRng } from './config.js';

const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const ORBIT_MAX = 1.45;                  // rad: the chase camera swings 83 deg above or below the airplane (straight up or down would flip lookAt)
const GROUND_CLEAR = 0.6;                // m: how close to the surface the chase camera may sit (knee height: the view of the tyres meeting the runway)
const HEAD_YAW = 2.6, HEAD_PITCH = 1.0;  // rad: how far the drag turns your head in the cockpit and wing views
export const CAMERA_MODES = ['chase', 'cockpit', 'tower', 'flyby', 'wing'];
export const CAMERA_NAMES = { chase: 'Chase', cockpit: 'Cockpit', tower: 'Tower', flyby: 'Fly-by', wing: 'Wing' };

export class CameraRig {
  constructor(camera, input) {
    // The shake is turbulence felt through the airframe, so it is seeded with the
    // turbulence: setSeed() with the flight's wind seed makes a whole approach
    // repeatable, which is what the screenshot harness relies on.
    this.rng = makeRng(1);
    this.camera = camera;
    this.input = input;
    this.mode = 'chase';
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.shake = 0;
    this.impulse = 0;
    this.flybyPos = null;
    this.lookYaw = 0; this.lookPitch = 0;
    this.orbitYaw = 0; this.orbitPitch = 0; this.orbitZoom = 1;   // chase orbit, kept until reset (0 key)
    this.headYaw = 0; this.headPitch = 0;                          // cockpit / wing: where the drag left your head (new flight = straight ahead)
    this.headYawMax = HEAD_YAW; this.headPitchMax = HEAD_PITCH;     // per aircraft: the cockpit view sets them from the interior (a bubble canopy allows more than an airliner)
    this.viewZoom = 1;                                             // tower / fly-by: wheel zoom, narrows the field of view
    this._t = new THREE.Vector3(); this._t2 = new THREE.Vector3(); this._t3 = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler();
    this.initialized = false;
    this.time = 0;
  }
  setMode(m) { this.mode = m; this.initialized = false; this.flybyPos = null; }
  next() { const i = CAMERA_MODES.indexOf(this.mode); this.setMode(CAMERA_MODES[(i + 1) % CAMERA_MODES.length]); }
  setSeed(seed) { this.rng = makeRng(seed * 17 + 3); }
  // How far the head may turn in the cockpit view: the interior decides (src/art/cockpits/<id>.js `look`).
  setHeadLimits(yaw, pitch) { this.headYawMax = yaw ?? HEAD_YAW; this.headPitchMax = pitch ?? HEAD_PITCH; }

  reset() { this.initialized = false; this.flybyPos = null; this.impulse = 0; this.shake = 0; this.lookYaw = 0; this.lookPitch = 0; this.headYaw = 0; this.headPitch = 0; this.viewZoom = 1; }

  update(dt, ac, world) {
    this.time += dt;
    const cam = this.camera;
    const def = ac.def;
    const size = def.span;
    const inp = this.input;
    // free look target
    const fl = inp.freeLook;
    let tYaw = fl.x === 1 ? Math.PI : fl.x * Math.PI * 0.55;
    let tPitch = 0;
    if (inp.padConnected && (Math.abs(inp.lookX) > 0.05 || Math.abs(inp.lookY) > 0.05)) { tYaw = inp.lookX * Math.PI * 0.8; tPitch = -inp.lookY * 0.6; }
    const k = 1 - Math.exp(-dt * 8);
    this.lookYaw += (tYaw - this.lookYaw) * k;
    this.lookPitch += (tPitch - this.lookPitch) * k;

    // shake sources
    const rough = ac.wheelsOnGround ? (ac.legs.some((l) => l.contact && (l.kind === 'gravel' || l.kind === 'dirt' || l.kind === 'grass' || l.kind === 'sand' || l.kind === 'snow')) ? clamp(ac.gsRel / 15, 0, 1) * 0.5 : clamp(ac.gsRel / 60, 0, 1) * 0.08) : 0;
    const buffet = ac.aero.buffet * 0.6 + (ac.crashed ? 0 : 0);
    this.impulse = Math.max(0, this.impulse - dt * 3);
    this.shake = clamp(rough + buffet + this.impulse, 0, 1.5);

    const fwdH = this._t.copy(ac.fwd); fwdH.y = 0; if (fwdH.lengthSq() < 1e-4) fwdH.set(0, 0, -1); fwdH.normalize();
    const groundY = (x, z) => { world.ground(x, z, world._camG); return world._camG.y; };

    // The right-drag (or a touch drag on the right half), the wheel and the , . 0 keys mean something in every view.
    // They are taken here, once, so a drag made in one view never jumps the camera when you switch to another.
    const dragX = inp.orbitDX || 0, dragY = inp.orbitDY || 0, wheel = inp.orbitZoomDelta || 0, reset = !!inp.orbitReset;
    inp.orbitDX = 0; inp.orbitDY = 0; inp.orbitZoomDelta = 0; inp.orbitReset = false;
    if (this.mode === 'cockpit' || this.mode === 'wing') {
      // the drag turns your head and it stays turned (J / I / O and the pad stick still glance); 0 or a double tap looks straight ahead again
      const yawMax = this.mode === 'cockpit' ? this.headYawMax : HEAD_YAW, pitchMax = this.mode === 'cockpit' ? this.headPitchMax : HEAD_PITCH;
      this.headYaw = clamp(this.headYaw + dragX * 0.004, -yawMax, yawMax);
      this.headPitch = clamp(this.headPitch - dragY * 0.003, -pitchMax, pitchMax);
      if (reset) { this.headYaw = 0; this.headPitch = 0; }
    } else if (this.mode === 'tower' || this.mode === 'flyby') {
      // fixed viewpoints: the wheel (or a pinch) zooms the lens; 0 puts it back
      if (wheel) this.viewZoom = clamp(this.viewZoom * Math.exp(-wheel * 0.12), 1, 6);
      if (reset) this.viewZoom = 1;
    }

    if (this.mode === 'debug') {
      if (this.debugOffset) {
        cam.position.copy(this.debugOffset).applyQuaternion(ac.quat).add(ac.pos);
        const lk = this._t2.copy(this.debugLook || new THREE.Vector3()).applyQuaternion(ac.quat).add(ac.pos);
        cam.up.set(0, 1, 0);
        cam.lookAt(lk);
      }
      cam.updateProjectionMatrix();
      return;
    }
    if (this.mode === 'chase') {
      // orbit: the drag / , . keys swing the camera anywhere around the airplane, above or below it, and it stays there; wheel zooms; 0 puts it back behind the tail
      const back = size * 1.05 + 5, up = size * 0.28 + 2.2;
      const base = Math.atan2(up, back);
      this.orbitYaw += dragX * 0.004 + (inp.orbitKey || 0) * 1.7 * dt;
      this.orbitPitch = clamp(this.orbitPitch + dragY * 0.003, -ORBIT_MAX - base, ORBIT_MAX - base);
      if (wheel) this.orbitZoom = clamp(this.orbitZoom * Math.exp(wheel * 0.12), 0.45, 3);
      if (reset) { this.orbitYaw = 0; this.orbitPitch = 0; this.orbitZoom = 1; }
      const dist = back * this.orbitZoom;
      let elev = base + this.orbitPitch;
      const yaw = this.lookYaw + this.orbitYaw;
      const dir = this._t3.copy(fwdH).applyAxisAngle(UP, -yaw);
      // The ground: rather than lifting a low camera straight up (which would push it in under the airplane), slide it up around
      // the same sphere until it clears the surface. A camera dragged under the wheels ends up at knee height beside them.
      const floor = groundY(ac.pos.x - dir.x * dist * Math.cos(elev), ac.pos.z - dir.z * dist * Math.cos(elev)) + GROUND_CLEAR;
      const minElev = Math.asin(clamp((floor - ac.pos.y) / dist, -1, 1));
      if (elev < minElev) elev = Math.min(minElev, ORBIT_MAX);
      const desired = this._t2.copy(ac.pos).addScaledVector(dir, -dist * Math.cos(elev));
      desired.y += dist * Math.sin(elev);
      const minY = groundY(desired.x, desired.z) + GROUND_CLEAR;
      if (desired.y < minY) desired.y = minY;
      if (!this.initialized) { this.pos.copy(desired); this.initialized = true; }
      else this.pos.lerp(desired, 1 - Math.exp(-dt * 5));
      this.look.copy(ac.pos).addScaledVector(fwdH, size * 0.25).addScaledVector(UP, size * 0.04);
      cam.position.copy(this.pos);
      this.applyShake(cam.position, this.shake * 0.25);
      // the camera banks a little with the airplane, but not when it is nearly above or below it (lookAt would roll over)
      cam.up.copy(UP).lerp(ac.up, 0.18 * clamp(1.5 - Math.abs(elev) / 0.8, 0, 1)).normalize();
      cam.lookAt(this.look);
      cam.fov = 55;
    } else if (this.mode === 'cockpit') {
      // def.seatUp raises the head above the design eye the interior is built around: the seat moves, not the cabin
      const eye = this._t2.set(def.eye.x, def.eye.y + (def.seatUp || 0), def.eye.z).applyQuaternion(ac.quat).add(ac.pos);
      cam.position.copy(eye);
      cam.quaternion.copy(ac.quat);
      this._q.setFromAxisAngle(UP, -(this.lookYaw + this.headYaw));
      cam.quaternion.multiply(this._q);
      this._q.setFromAxisAngle(X, this.lookPitch + this.headPitch);
      cam.quaternion.multiply(this._q);
      // head shake as small rotations
      if (this.shake > 0.001) {
        const s = this.shake * 0.012;
        this._q.setFromEuler(this._e.set((this.rng() - 0.5) * s, (this.rng() - 0.5) * s, (this.rng() - 0.5) * s * 0.5));
        cam.quaternion.multiply(this._q);
      }
      cam.up.copy(UP);
      cam.fov = 68;
      this.initialized = true;
    } else if (this.mode === 'tower') {
      const tp = world.towerPos || world.defaultCam;
      cam.position.copy(tp);
      cam.up.copy(UP);
      cam.lookAt(ac.pos);
      const d = cam.position.distanceTo(ac.pos);
      cam.fov = clamp(clamp(Math.atan2(size * 2.2, d) * 2 * RAD, 3.5, 60) / this.viewZoom, 2, 60);
      this.initialized = true;
    } else if (this.mode === 'flyby') {
      const d = this.flybyPos ? this.flybyPos.distanceTo(ac.pos) : 1e9;
      const ahead = this.flybyPos ? this._t2.subVectors(ac.pos, this.flybyPos).dot(ac.vel) : 0;
      if (!this.flybyPos || d > 900 || (ahead > 0 && d > 250 && this.time - this.flybyT > 6)) {
        const p = ac.pos.clone().addScaledVector(ac.vel, 6).addScaledVector(ac.right, (this.rng() < 0.5 ? -1 : 1) * (size * 1.5 + 30));
        p.y += (this.rng() - 0.3) * size * 1.5;
        const minY = groundY(p.x, p.z) + 2.5;
        if (p.y < minY) p.y = minY;
        this.flybyPos = p;
        this.flybyT = this.time;
      }
      cam.position.copy(this.flybyPos);
      cam.up.copy(UP);
      cam.lookAt(ac.pos);
      const dd = cam.position.distanceTo(ac.pos);
      cam.fov = clamp(clamp(Math.atan2(size * 2.0, dd) * 2 * RAD, 18, 70) / this.viewZoom, 3, 70);
      this.initialized = true;
    } else if (this.mode === 'wing') {
      const p = this._t2.set(size * 0.42, size * 0.06 + 0.8, size * 0.08 + 1.5).applyQuaternion(ac.quat).add(ac.pos);
      cam.position.copy(p);
      cam.up.copy(ac.up);
      const lk = this._t.copy(ac.pos).addScaledVector(ac.fwd, size * 1.2).addScaledVector(ac.up, -size * 0.05);
      cam.lookAt(lk);
      if (this.headYaw || this.headPitch) {
        this._q.setFromAxisAngle(UP, -this.headYaw); cam.quaternion.multiply(this._q);
        this._q.setFromAxisAngle(X, this.headPitch); cam.quaternion.multiply(this._q);
      }
      cam.fov = 60;
      this.initialized = true;
    }
    cam.updateProjectionMatrix();
  }
  applyShake(v, amt) {
    if (amt < 0.0005) return;
    v.x += (this.rng() - 0.5) * amt;
    v.y += (this.rng() - 0.5) * amt;
    v.z += (this.rng() - 0.5) * amt;
  }
  bump(a) { this.impulse = Math.max(this.impulse, clamp(a, 0, 1.5)); }
}
