// The cockpit view: builds the interior for the current aircraft from the art bench
// (src/art/cockpits/<id>.js), feeds it the flight state every frame, and draws it in
// front of the world with its own near plane.
//
// Why a second pass: the world camera runs near 0.3 m / far 60 km, and a panel 0.6 m
// from the eye would z-fight or clip at that near plane. The interior lives on render
// LAYER 1, which the world camera never sees; a second camera (near 0.03 m, far 60 m,
// same pose and fov as the world camera) draws it after the world with the depth
// buffer cleared, so the interior is always in front. Works through the composer
// (a Pass inserted before the bloom) and in the direct path on low quality.
//
// The interior sits in a scene of its own on a proxy that carries the aircraft
// model's world matrix, so it moves with the airframe, and it is only visible (and
// only updated) in the cockpit camera mode. Copies of the world's lights follow the
// originals every frame; the interior casts and receives no shadows - the shadow
// camera is the world's and the fuselage would put the whole panel in shade anyway.
// (It used to hang on the model group and be drawn from the world scene through a
// layer filter and a composer pass; see the note above CockpitView for why not.)
import * as THREE from 'three';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { DEG, RAD, KT, FT, FPM, clamp } from './config.js';
import { LIVERY } from './art/livery.js';
import { buildCockpit as buildSkylark } from './art/cockpits/skylark.js';
import { buildCockpit as buildTrailblazer } from './art/cockpits/trailblazer.js';
import { buildCockpit as buildCondor } from './art/cockpits/condor.js';
import { buildCockpit as buildHornet } from './art/cockpits/hornet.js';

export const COCKPIT_LAYER = 1;
const BUILDERS = { skylark: buildSkylark, trailblazer: buildTrailblazer, condor: buildCondor, hornet: buildHornet };

// The state handed to cockpit.update() every frame. Allocated once; the same object is
// updated in place, so a cockpit may keep a reference but must not keep a copy.
export function makeCockpitState() {
  return {
    t: 0, dt: 0, id: '', engineType: 'prop',
    elevator: 0, aileron: 0, rudder: 0,              // where the surfaces actually are, -1..1
    pitchInput: 0, rollInput: 0, yawInput: 0, trim: 0, // what the pilot is commanding, -1..1
    throttle: [0, 0], throttleActual: [0, 0], rpm: [0, 0], n1: [0, 0], egt: [0, 0], failed: [false, false], reverse: 0,
    flap: 0, flapCmd: 0, flapDetent: 0, flapLabel: 'UP', flapDetents: [0, 1], flapLabels: ['UP', 'DN'],
    gear: 1, gearCmd: 1, gearRetract: false, gearLocked: [true, true, true], gearTransit: false,
    spoiler: 0, spoilerArmed: false, hook: 0, hookCmd: 0, hasHook: false, hasSpoilers: false,
    brake: 0, autobrake: 0, hasAutobrake: false,
    ias: 0, tas: 0, gs: 0, alt: 0, radioAlt: 0, vs: 0, heading: 0, pitch: 0, roll: 0, aoa: 0, beta: 0, gload: 1,
    vref: 0, vs0: 0, vs1: 0, onSpeedAoA: 0,
    stallWarning: false, stall: 0, onGround: false, wheelsOnGround: false, trapped: false,
    failures: null,
    power: 1,                                          // electrical power, 0 = dead (src/systems/failureEffects.js; see update())
    ils: null, ilsGs: 0, ilsLoc: 0, meatball: null,
    time: 12, dayness: 1, night: false, sunDir: new THREE.Vector3(0, 1, 0), sunDirWorld: new THREE.Vector3(0, 1, 0),
    windDir: 0, windSpeed: 0,
    headYaw: 0, headPitch: 0,
  };
}

class CockpitPass extends Pass {
  constructor(scene, camera) { super(); this.scene = scene; this.camera = camera; this.needsSwap = false; this.enabled = false; }
  render(renderer, writeBuffer, readBuffer) {
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = oldAutoClear;
  }
}

// Performance (docs/PERF.md section 9): the interior is drawn from a scene of its OWN, not from
// the world scene with a layer filter, and straight to the canvas after the composer rather than
// through a composer pass. Measured on the mobile stand-in, the layer filter still walked every
// object in the world a second time (+3-4 ms of CPU per frame on the plains at phone speed), and
// a second render() into the composer's multisampled HalfFloat target made three.js resolve that
// target a second time (11-12 ms of GPU per frame at the phone's high tier, on every site). The
// interior's scene holds a proxy that carries the aircraft model's world matrix (so the interior
// still moves with the airframe) and copies of the world's sun, sky and moon lights, refreshed
// every frame; on the canvas the renderer's own tone mapping applies, the same curve the world
// gets from the output pass. The CockpitPass remains for reference but is not used.
export class CockpitView {
  constructor(renderer, scene, camera) {
    this.renderer = renderer; this.scene = scene; this.worldCam = camera;
    this.camera = new THREE.PerspectiveCamera(camera.fov, camera.aspect, 0.03, 60);
    this.camera.layers.set(COCKPIT_LAYER);
    this.pass = new CockpitPass(scene, this.camera);
    this.own = new THREE.Scene();                      // the interior's scene: the proxy and the light copies
    this.own.matrixWorldAutoUpdate = true;
    this.proxy = new THREE.Object3D();                 // stands in for the aircraft model: matrix = the model's world matrix
    this.proxy.matrixAutoUpdate = false;
    this.own.add(this.proxy);
    this.lights = {
      sun: new THREE.DirectionalLight(0xffffff, 0), hemi: new THREE.HemisphereLight(0xffffff, 0x000000, 0), moon: new THREE.DirectionalLight(0xffffff, 0),
    };
    for (const l of Object.values(this.lights)) { l.layers.enable(COCKPIT_LAYER); this.own.add(l); if (l.target) this.own.add(l.target); }
    this.cockpit = null;
    this.model = null;
    this.state = makeCockpitState();
    this.active = false;
    this._q = new THREE.Quaternion();
    this.failView = null;      // the flight's FailureRuntime (it sets and clears this itself): sensed readings, power
    this.crack = null;         // the cracked-windshield decal (prepareCrack / showCrack), per interior
    this._dim = null;          // without electrical power: the interior's lit materials and what the art set them to
  }
  // Remember this world's lights, so the interior's copies can follow them every frame.
  attachScene(scene) {
    this.scene = scene; this.pass.scene = scene;
    this.worldLights = { sun: null, hemi: null, moon: null };
    scene.traverse((o) => {
      if (!o.isLight) return;
      if (o.isHemisphereLight && !this.worldLights.hemi) this.worldLights.hemi = o;
      else if (o.isDirectionalLight && o.castShadow && !this.worldLights.sun) this.worldLights.sun = o;
      else if (o.isDirectionalLight && !this.worldLights.moon) this.worldLights.moon = o;
    });
  }
  clear() {
    if (this.cockpit && this.cockpit.group.parent) this.cockpit.group.parent.remove(this.cockpit.group);
    if (this.cockpit && this.cockpit.dispose) this.cockpit.dispose();
    if (this.crack) { this.crack.mesh.geometry.dispose(); this.crack.mat.dispose(); this.crack.tex.dispose(); this.crack = null; }
    this._dim = null;
    this.cockpit = null; this.model = null; this.active = false; this.pass.enabled = false;
  }
  // Build the interior for this aircraft and hang it on the model.
  build(def, model, { detail = 'high' } = {}) {
    this.clear();
    const build = BUILDERS[def.id];
    if (!build) return null;
    const ctx = { materials: LIVERY[def.id](), detail, eye: new THREE.Vector3(def.eye.x, def.eye.y, def.eye.z), seed: 11, anchors: model.anchors || {} };
    const c = build(def, ctx);
    if (c.placeholder) { if (c.dispose) c.dispose(); return null; }   // no real interior for this aircraft yet: the cockpit view stays the exterior-only view
    c.group.name = 'cockpit:' + def.id;
    c.group.traverse((o) => {
      o.layers.set(COCKPIT_LAYER);
      if (o.isMesh || o.isPoints || o.isLine) {
        o.castShadow = false; o.receiveShadow = false;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) if (m) {
          m.fog = false; if (!m.name) m.name = `cockpit:${def.id}:unnamed`;
          if (m.transparent && m.side === THREE.DoubleSide) m.forceSinglePass = true;   // PERF.md 9.3: no two-pass transparency
        }
      }
    });
    c.group.visible = false;
    this.proxy.add(c.group);   // in the interior's own scene, at the model's world transform (see sync)
    this.cockpit = c; this.model = model;
    const s = this.state;
    s.id = def.id; s.engineType = def.engines[0].type; s.gearRetract = !!def.gearRetract; s.hasHook = !!def.hook; s.hasSpoilers = !!def.spoilers; s.hasAutobrake = !!def.autobrake;
    s.flapDetents = def.flaps.detents; s.flapLabels = def.flaps.labels; s.onSpeedAoA = def.approach.onSpeedAoA ? def.approach.onSpeedAoA * RAD : 0;
    return c;
  }
  get look() { return (this.cockpit && this.cockpit.look) || null; }
  // Fill the state from the live aircraft and drive the interior. Only while the
  // cockpit camera is up: the interior is invisible otherwise and nothing moves.
  update(dt, ac, rig, world, extra = {}) {
    if (!this.cockpit || rig.mode !== 'cockpit') return;
    const s = this.state, def = ac.def, c = ac.ctl, inp = ac.input;
    s.t += dt; s.dt = dt;
    s.elevator = c.elevator; s.aileron = c.aileron; s.rudder = c.rudder;
    s.pitchInput = inp.pitch; s.rollInput = inp.roll; s.yawInput = inp.yaw; s.trim = inp.trim;
    for (let i = 0; i < 2; i++) {
      const e = ac.engines[i] || ac.engines[0];
      s.throttle[i] = inp.throttle; s.throttleActual[i] = e.throttle; s.rpm[i] = e.rpm; s.n1[i] = e.type === 'jet' ? e.rpm : 0;
      s.egt[i] = e.failed ? 0 : clamp(0.25 + 0.7 * e.throttle, 0, 1); s.failed[i] = !!e.failed;
    }
    s.reverse = inp.reverse > 0 && ac.wheelsOnGround ? clamp(inp.reverse, 0, 1) : 0;
    s.flap = c.flap; s.flapCmd = inp.flapCmd;
    let di = def.flaps.detents.findIndex((d) => Math.abs(d - inp.flapCmd) < 0.01); if (di < 0) di = 0;
    s.flapDetent = di; s.flapLabel = def.flaps.labels[di] || String(Math.round(inp.flapCmd * def.flaps.maxDeg));
    s.gear = c.gear; s.gearCmd = inp.gearCmd ? 1 : 0;
    for (let i = 0; i < 3; i++) { const l = ac.legs[i]; s.gearLocked[i] = l ? l.ext > 0.985 : false; }
    s.gearTransit = def.gearRetract ? Math.abs(c.gear - s.gearCmd) > 0.02 : false;
    s.spoiler = c.spoiler; s.spoilerArmed = !!inp.spoilerArmed; s.hook = c.hook; s.hookCmd = inp.hookCmd ? 1 : 0;
    s.brake = inp.brake; s.autobrake = inp.autobrake || 0;
    s.ias = ac.ias / KT; s.tas = ac.tas / KT; s.gs = ac.gs / KT; s.alt = ac.alt / FT; s.radioAlt = ac.radioAlt / FT; s.vs = ac.vs / FPM;
    s.heading = ac.headingDeg; s.pitch = ac.euler.pitch * RAD; s.roll = ac.euler.roll * RAD;
    s.aoa = ac.aero.alpha * RAD; s.beta = ac.aero.beta * RAD; s.gload = ac.gload;
    s.vref = extra.vref || def.speeds.Vref;
    s.vs0 = def.speeds.Vs0 * Math.sqrt(ac.mass / def.mass); s.vs1 = def.speeds.Vs1 * Math.sqrt(ac.mass / def.mass);
    s.stallWarning = !!ac.aero.warning && !ac.onGround; s.stall = ac.aero.stall;
    s.onGround = ac.onGround; s.wheelsOnGround = ac.wheelsOnGround; s.trapped = !!(ac.trap && ac.trap.trapped);
    s.failures = ac.failures;
    s.ils = extra.ils || null; s.ilsGs = extra.ils ? extra.ils.gsDots : 0; s.ilsLoc = extra.ils ? extra.ils.locDots : 0;
    s.meatball = extra.meatball || null;
    const sky = world && world.sky;
    if (sky) {
      s.time = sky.time; s.dayness = sky.dayness; s.night = sky.dayness < 0.5;
      s.sunDirWorld.copy(sky.sunDir);
      s.sunDir.copy(sky.sunDir).applyQuaternion(this._q.copy(ac.quat).invert());
    }
    if (extra.wind) { s.windDir = extra.wind.dir; s.windSpeed = extra.wind.spd; }
    s.headYaw = rig.headYaw; s.headPitch = rig.headPitch;
    // Failures (src/systems/failureEffects.js sets this.failView per flight): the instruments get what they would
    // read, not the truth - an iced pitot's airspeed, no ball from a dark lens - and s.power.
    const fv = this.failView;
    s.power = fv ? fv.power : 1;
    if (fv) {
      if (fv.sensed && fv.sensed.ias != null) s.ias = fv.sensed.ias / KT;
      if (fv.display && fv.display.noBall) s.meatball = null;
    }
    // With the electrics dead the panel lights go out. The interiors light their panels (emissive) by the time of
    // day and know nothing of power, so what the art sets is scaled here, after its update, by what daylight alone
    // would give the panel (dayness squared: all of it by day, none at night), and put back before the next update so
    // the art always starts from its own numbers. Uniform writes only: nothing recompiles.
    const dim = !s.power ? this._dimmer() : null;
    if (dim) for (let i = 0; i < dim.mats.length; i++) dim.mats[i].emissiveIntensity = dim.set[i];
    this.cockpit.update(s);
    if (dim) {
      const k = clamp(sky ? sky.dayness : 1, 0, 1) ** 2;
      for (let i = 0; i < dim.mats.length; i++) { const m = dim.mats[i]; dim.set[i] = m.emissiveIntensity; m.emissiveIntensity *= k; }
    }
    if (this.crack && this.crack.on) this.crack.mat.color.setScalar(0.3 + 0.7 * clamp(sky ? sky.dayness : 1, 0, 1));
  }
  // Every lit material of the interior (collected once, the first time the power is off).
  _dimmer() {
    if (this._dim) return this._dim;
    const mats = [];
    this.cockpit.group.traverse((o) => {
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of ms) if (m && typeof m.emissiveIntensity === 'number' && !mats.includes(m) && (!this.crack || m !== this.crack.mat)) mats.push(m);
    });
    this._dim = { mats, set: new Float32Array(mats.length) };
    for (let i = 0; i < mats.length; i++) this._dim.set[i] = mats[i].emissiveIntensity;
    return this._dim;
  }

  // ---- a cracked windshield (a bird strike: src/systems/failureEffects.js) ----
  // A decal laid on the windshield pane straight ahead of the pilot: a ray from the eye (raised by def.seatUp, as the
  // camera is) a few degrees up and to one side finds parts.windshield, and the decal lies on the glass there, a few
  // millimetres inside it, drawn after it; the glareshield and the posts, nearer the eye, hide what overhangs the
  // pane. prepareCrack() makes it at the start of a flight that has a bird strike in it, blank and visible, so it
  // compiles with the rest of the interior; showCrack() draws the crack into it (one canvas upload, no compile).
  // It is not lit: its colour follows the daylight (update()), so a crack glints by day and is a dark web at night.
  prepareCrack(def, rng) {
    const c = this.cockpit;
    if (!c || this.crack || typeof document === 'undefined') return;
    const S = 1024, canvas = document.createElement('canvas');
    canvas.width = canvas.height = S;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    mat.name = 'cockpit:crack'; mat.fog = false; mat.forceSinglePass = true;
    const size = def.id === 'condor' ? 0.95 : 0.75;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    mesh.name = 'crack'; mesh.renderOrder = 8; mesh.layers.set(COCKPIT_LAYER);
    mesh.castShadow = false; mesh.receiveShadow = false;
    // where the ray from the eye meets the windshield, in the interior's own (body) frame
    const eye = new THREE.Vector3(def.eye.x, def.eye.y + (def.seatUp || 0), def.eye.z);
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler((5 + rng() * 4) * DEG, (rng() - 0.5) * 14 * DEG, 0, 'YXZ'));
    const hit = this._rayWindshield(c, eye, dir);
    const n = new THREE.Vector3(0, 0, 1);
    if (hit) { mesh.position.copy(hit.point); n.copy(hit.normal); if (n.dot(dir) > 0) n.negate(); }
    else mesh.position.copy(eye).addScaledVector(dir, 0.7);
    mesh.position.addScaledVector(n, 0.004);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    mesh.rotateZ(rng() * Math.PI * 2);
    c.group.add(mesh);
    this.crack = { mesh, mat, tex, canvas, on: false };
  }
  // The nearest triangle of the windshield along a ray (both in the interior group's frame), or null.
  _rayWindshield(c, eye, dir) {
    const ws = c.parts && c.parts.windshield;
    if (!ws || !ws.geometry || !ws.geometry.attributes.position) return null;
    const m = new THREE.Matrix4();
    for (let o = ws; o && o !== c.group; o = o.parent) { o.updateMatrix(); m.premultiply(o.matrix); }
    const pos = ws.geometry.attributes.position, idx = ws.geometry.index;
    const ray = new THREE.Ray(eye, dir.clone().normalize());
    const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), p = new THREE.Vector3();
    let best = null;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i + 2 < n; i += 3) {
      const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(m); b.fromBufferAttribute(pos, i1).applyMatrix4(m); d.fromBufferAttribute(pos, i2).applyMatrix4(m);
      if (!ray.intersectTriangle(a, b, d, false, p)) continue;
      const dist = p.distanceTo(eye);
      if (dist < 0.15 || (best && dist >= best.dist)) continue;
      best = { dist, point: p.clone(), normal: new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize() };
    }
    return best;
  }
  // Draw the crack (failureEffects.js crackPattern(): unit coordinates, the impact at 0, the decal's edges at +-1).
  showCrack(pattern) {
    const k = this.crack;
    if (!k || !pattern) return;
    const S = k.canvas.width, g = k.canvas.getContext('2d'), h = S / 2, sc = h * 0.98;
    const X = (v) => h + v * sc;
    g.clearRect(0, 0, S, S);
    // the smear of the bird, and a frosted star where it hit
    const sm = pattern.smear;
    g.save(); g.translate(h, X(sm.dy)); g.rotate(sm.rot); g.scale(1, sm.ry / sm.rx);
    let grd = g.createRadialGradient(0, 0, 0, 0, 0, sm.rx * sc);
    grd.addColorStop(0, 'rgba(58,44,36,0.62)'); grd.addColorStop(0.5, 'rgba(92,76,62,0.3)'); grd.addColorStop(1, 'rgba(120,104,90,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(0, 0, sm.rx * sc, 0, Math.PI * 2); g.fill(); g.restore();
    grd = g.createRadialGradient(h, h, 0, h, h, 0.09 * sc);
    grd.addColorStop(0, 'rgba(236,242,246,0.55)'); grd.addColorStop(0.6, 'rgba(226,234,240,0.14)'); grd.addColorStop(1, 'rgba(226,234,240,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(h, h, 0.09 * sc, 0, Math.PI * 2); g.fill();
    // the cracks: a dark edge under a bright one, as a crack in laminated glass catches the light
    const stroke = (pts, w, style, dx, dy) => {
      g.strokeStyle = style; g.lineWidth = w; g.beginPath();
      for (let i = 0; i < pts.length; i += 2) { const x = X(pts[i]) + dx, y = X(pts[i + 1]) + dy; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
    };
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const pass of [['rgba(6,8,10,0.5)', 1.35, 2, 2.6], ['rgba(240,245,248,0.88)', 1, 0, 0]]) {
      for (const q of pattern.paths) stroke(q.pts, q.w * 2.8 * pass[1], pass[0], pass[2], pass[3]);
      for (const a of pattern.arcs) stroke(a, 2.2 * pass[1], pass[0], pass[2], pass[3]);
    }
    k.tex.needsUpdate = true;
    k.on = true;
  }
  // Called from render(): decide whether the interior draws this frame (the cockpit
  // camera mode, with an interior built) and copy the world camera's pose so the
  // interior lines up with the view.
  sync(on) {
    const active = !!this.cockpit && !!on;
    if (this.cockpit) this.cockpit.group.visible = active;
    this.active = active;   // the composer pass stays off: the interior is drawn by renderDirect() after the composer
    if (!active) return;
    const w = this.worldCam, c = this.camera;
    c.position.copy(w.position); c.quaternion.copy(w.quaternion); c.up.copy(w.up);
    if (c.fov !== w.fov || c.aspect !== w.aspect) { c.fov = w.fov; c.aspect = w.aspect; c.updateProjectionMatrix(); }
    c.updateMatrixWorld();
    // the proxy takes the aircraft's world transform; the light copies take this frame's sun, sky and moon
    if (this.model) { this.model.group.updateMatrixWorld(); this.proxy.matrix.copy(this.model.group.matrixWorld); this.proxy.matrixWorldNeedsUpdate = true; }
    const W = this.worldLights || {}, L = this.lights;
    const follow = (copy, src) => {
      if (!src) { copy.intensity = 0; return; }
      copy.color.copy(src.color); copy.intensity = src.intensity; copy.visible = src.visible;
      copy.position.copy(src.position);
      if (copy.target && src.target) copy.target.position.copy(src.target.position);
    };
    follow(L.sun, W.sun); follow(L.moon, W.moon);
    if (W.hemi) { L.hemi.color.copy(W.hemi.color); L.hemi.groundColor.copy(W.hemi.groundColor); L.hemi.intensity = W.hemi.intensity; L.hemi.visible = W.hemi.visible; } else L.hemi.intensity = 0;
  }
  // Draw the interior over the finished world frame, on the canvas, from the interior's own scene.
  renderDirect(renderer) {
    if (!this.active) return;
    const old = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    renderer.clearDepth();
    renderer.render(this.own, this.camera);
    renderer.autoClear = old;
  }
}
