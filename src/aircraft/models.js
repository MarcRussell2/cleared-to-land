// The aircraft as the engine sees them: which airframe ships for each aircraft, how a
// downloaded glTF fallback is fitted onto the physics definition, the part names and
// the animation of every moving piece (surfaces, gear, props, hook, reversers, lights).
//
// The SHAPE of each aircraft lives on the art bench, one module per aircraft:
//   src/art/airframes/{skylark,trailblazer,condor,hornet}.js
// each exporting buildAirframe(def, ctx) -> { group, parts, anchors, bounds }. The
// contract (part names, hinge conventions, anchors) is the header of skylark.js and
// src/art/README.md. This file only consumes it.
//
// Body frame: forward = -Z, up = +Y, right = +X. All dimensions in metres, relative to the CG.
import * as THREE from 'three';
import { DEG, clamp } from '../config.js';
import { LIVERY, paintSurfaces, dressGltf, propDisc } from '../art/livery.js';
import { detail as airframeDetail } from '../art/airframe.js';
import { buildAirframe as buildSkylark } from '../art/airframes/skylark.js';
import { buildAirframe as buildTrailblazer } from '../art/airframes/trailblazer.js';
import { buildAirframe as buildCondor } from '../art/airframes/condor.js';
import { buildAirframe as buildHornet } from '../art/airframes/hornet.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildSurfaces } from './surfaces.js';
import skylarkGlb from '../../assets/models/skylark.glb';
import trailblazerGlb from '../../assets/models/trailblazer.glb';
import condorGlb from '../../assets/models/condor.glb';
import hornetGlb from '../../assets/models/hornet.glb';

const BUILDERS = { skylark: buildSkylark, trailblazer: buildTrailblazer, condor: buildCondor, hornet: buildHornet };

// Which airframe each aircraft SHIPS with: 'procedural' (the art bench's model) or
// 'gltf' (the downloaded model below, dressed by livery.js, with hinged panels added).
// The procedural airframe is always built first - it carries the gear, propeller, hook
// and lights in both cases - and is what you get if a glTF fails to load.
// window.CTL_NO_GLTF forces 'procedural' for all four; window.CTL_GLTF forces 'gltf'.
export const SHIPS = { skylark: 'procedural', trailblazer: 'procedural', condor: 'procedural', hornet: 'procedural' };

// Downloaded aircraft models (Poly Pizza, CC-BY 3.0; see CREDITS.md). rot* orient the nose to -Z and the top to +Y;
// the wingspan is fitted to the physics definition, the lowest point is put at wheel-bottom height.
// surfaces: hinged panels built along each model's REAL trailing edges (measured from the meshes with a
// one-off script, body frame, metres). The models have no moving parts of their own. Panels sit at the
// trailing edge and extend behind it, so they read as flaps/ailerons even undeflected. `left` holds
// per-side offsets where a model is not symmetric (the airliner's left wing sits ~2.1 m further aft).
const GLTF = {
  skylark: { url: skylarkGlb, rotY: 0, y: 0, z: 0, hideGear: true, hideProp: false, hideGltfProp: true, surfaces: {
    aileron: { x0: 3.2, x1: 5.3, y: 0.92, z: -0.66, chord: 0.38, sweep: -0.15, dihedral: 0.03, thick: 0.06 },
    flaps: [{ x0: 1.2, x1: 3.0, y: 0.88, z: -0.62, chord: 0.42, thick: 0.06 }],
    elevator: { x0: 0.35, x1: 2.2, y: 0.9, z: 5.02, chord: 0.36, sweep: -0.18, dihedral: 0.05, thick: 0.05 },
    rudder: { x: 0, y0: 1.3, y1: 3.1, z: 5.18, chord: 0.4, rake: 0.2, thick: 0.05 },
  } },
  trailblazer: { url: trailblazerGlb, rotY: Math.PI / 2, y: 0, z: 0, hideGear: true, hideProp: false, discOnly: true, surfaces: {
    // a biplane: ailerons on both wings, flaps on both, so you can see them from any side
    aileron: { x0: 3.4, x1: 5.2, y: 0.9, z: 0.05, chord: 0.45, thick: 0.06 },
    flaps: [{ x0: 1.2, x1: 3.2, y: 0.9, z: 0.05, chord: 0.45, thick: 0.06 }, { x0: 1.2, x1: 3.2, y: -1.0, z: 0.05, chord: 0.45, thick: 0.06 }],
    elevator: { x0: 0.5, x1: 1.38, y: -0.28, z: 3.18, chord: 0.3, sweep: 0.03, thick: 0.05 },
    rudder: { x: 0.07, y0: 0.2, y1: 1.28, z: 3.68, chord: 0.35, rake: -0.4, thick: 0.05 },
    extraAilerons: [{ x0: 3.4, x1: 5.2, y: -1.0, z: 0.05, chord: 0.45, thick: 0.06 }],
  } },
  condor: { url: condorGlb, rotY: Math.PI, y: 0, z: 0, hideGear: false, hideProp: false, surfaces: {
    aileron: { x0: 12.0, x1: 16.0, y: 1.35, z: 1.73, chord: 1.0, sweep: 0.047, thick: 0.14, left: { dz: 2.1 } },
    flaps: [
      { x0: 3.6, x1: 5.2, y: 1.0, z: 3.86, chord: 1.6, sweep: -0.33, thick: 0.14, left: { dz: 2.1 } },
      { x0: 8.6, x1: 10.2, y: 1.25, z: 2.21, chord: 1.5, sweep: -0.33, dihedral: 0.05, thick: 0.14, left: { dz: 2.1 } },
    ],
    spoilers: [{ x0: 8.6, x1: 10.2, y: 2.05, z: -0.2, chord: 1.0, sweep: -0.33, dihedral: 0.05, thick: 0.08, left: { dz: 2.1 } }],
    elevator: { x0: 1.9, x1: 4.8, y: 2.2, z: 16.25, chord: 0.8, sweep: -0.22, dihedral: 0.03, thick: 0.12 },
    rudder: { x: 0.7, y0: 3.6, y1: 7.2, z: 16.0, chord: 0.7, rake: -0.09, thick: 0.12 },
  } },
  hornet: { url: hornetGlb, rotY: Math.PI / 2, y: 0, z: 0, hideGear: true, hideProp: false, surfaces: {
    aileron: { x0: 3.2, x1: 5.3, y: 0.28, z: 2.5, chord: 0.5, sweep: -0.065, dihedral: -0.16, thick: 0.07 },
    flaps: [{ x0: 1.5, x1: 3.0, y: 0.55, z: 2.46, chord: 0.9, sweep: -0.03, dihedral: -0.16, thick: 0.07 }],
    elevator: { x0: 1.6, x1: 3.2, y: 0.3, z: 4.55, chord: 0.6, sweep: -0.05, dihedral: -0.3, thick: 0.06 },
    rudder: { x: 0.22, y0: 1.8, y1: 3.8, z: 5.0, chord: 0.5, rake: -0.05, thick: 0.08 },
  } },
};
let _loader = null;
export function useGltfModels() { return !window.CTL_NO_GLTF; }
export function shipsGltf(id) {
  if (window.CTL_NO_GLTF) return false;
  if (window.CTL_GLTF) return true;
  return SHIPS[id] === 'gltf';
}

// ------------------------------------------------------------------
// opts.detail: 'high' | 'medium' | 'low' (the quality tier, passed to the airframe builder)
export function buildModel(def, opts = {}) {
  const build = BUILDERS[def.model === 'bush' ? 'trailblazer' : def.model === 'airliner' ? 'condor' : def.model === 'fighter' ? 'hornet' : def.id] || BUILDERS[def.id] || buildSkylark;
  return new AircraftModel(def, build, opts).finish();
}

class AircraftModel {
  constructor(def, build, opts = {}) {
    this.def = def;
    this.group = new THREE.Group();
    this.t = 0;
    this.propAngle = 0;
    this.cockpit = false;
    const ctx = { materials: LIVERY[def.id](), detail: opts.detail || 'high', propDisc, seed: 7 };
    const built = build(def, ctx);
    this.airframe = built.group;
    this.group.add(this.airframe);
    this.parts = built.parts;
    this.anchors = built.anchors;
    this.bounds = built.bounds;
    this.legs = built.parts.legs || [];            // {root, pivot, strut, wheels:[], axis, angle, y0} per def.gear entry
    this.hide = [...(built.parts.hideInCockpit || [])];   // parts hidden in the cockpit view
    this.procedural = true;
  }
  finish() {
    const cfg = GLTF[this.def.id];
    if (cfg && shipsGltf(this.def.id)) this.loadGltf(cfg);
    return this;
  }
  // Parts that stay when a downloaded model replaces the procedural airframe
  keepSet() {
    const keep = new Set();
    for (const L of this.legs) if (L && L.root) keep.add(L.root);
    const p = this.parts;
    if (p.props) for (const pr of p.props) keep.add(pr);
    if (p.hook) keep.add(p.hook);
    if (p.lights) { if (p.lights.points) keep.add(p.lights.points); else for (const k in p.lights) keep.add(p.lights[k]); }
    if (p.landingLight) { keep.add(p.landingLight); keep.add(p.landingLight.target); }
    return keep;
  }
  loadGltf(cfg) {
    if (!_loader) _loader = new GLTFLoader();
    _loader.load(cfg.url, (gltf) => {
      const root = gltf.scene;
      const wrap = new THREE.Group();
      root.rotation.set(cfg.preX || 0, cfg.preY || 0, cfg.preZ || 0);   // in the model's native frame (fix its up axis)
      wrap.add(root);
      wrap.rotation.set(cfg.rotX || 0, cfg.rotY || 0, cfg.rotZ || 0);   // then yaw the nose to -Z
      wrap.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(wrap);
      const size = box.getSize(new THREE.Vector3());
      const scale = this.def.span / Math.max(size.x, 0.01);
      wrap.scale.setScalar(scale);
      wrap.updateMatrixWorld(true);
      const box2 = new THREE.Box3().setFromObject(wrap);
      const c = box2.getCenter(new THREE.Vector3());
      // centre laterally, put the CG about 42% back from the nose, lowest point at wheel-bottom height
      const len = box2.max.z - box2.min.z;
      wrap.position.x = -c.x;
      wrap.position.z = -(box2.min.z + len * 0.42) + (cfg.z || 0);
      wrap.position.y = -this.def.cgHeight - box2.min.y + (cfg.y || 0);
      dressGltf(root, this.def.id);
      const keep = this.keepSet();
      for (const ch of this.airframe.children) if (!keep.has(ch)) ch.visible = false;
      if (cfg.hideGear) for (const L of this.legs) if (L && L.root) L.root.visible = false;
      if (cfg.hideProp && this.parts.props) for (const pr of this.parts.props) pr.visible = false;
      // A downloaded propeller is a static lump of geometry. Where the model keeps it as
      // its own node, hide it and let the procedural propeller spin in its place; where
      // it is baked into one merged mesh, show only the blur disc over it.
      if (cfg.hideGltfProp) root.traverse((o) => { if (/prop/i.test(o.name)) o.visible = false; });
      if (cfg.discOnly && this.parts.props) for (const pr of this.parts.props) pr.userData.discOnly = true;
      this.gltfCfg = cfg;
      // the model has no moving parts: add measured hinged panels and let update() drive those instead
      if (cfg.surfaces) {
        const s = buildSurfaces(paintSurfaces(this.def.id, cfg.surfaces));
        this.group.add(s.group);
        Object.assign(this.parts, s.parts);
        this.gltfSurfaces = s.group;
      }
      this.hide = [wrap];
      this.group.add(wrap);
      this.gltfRoot = wrap;
      this.procedural = false;
      const fit = {
        id: this.def.id, span: this.def.span, cgHeight: this.def.cgHeight,
        nose: box2.min.z + wrap.position.z, tail: box2.max.z + wrap.position.z,
        belly: box2.min.y + wrap.position.y, top: box2.max.y + wrap.position.y,
        halfSpan: (box2.max.x - box2.min.x) / 2,
      };
      fit.length = fit.tail - fit.nose;
      // Where the skin actually IS. A bounding box cannot tell you the height of the
      // wing at a point, so detail placed off the box alone ends up inside or through
      // the airframe. These fire a ray at the real geometry and answer in the BODY
      // FRAME (forward -Z, up +Y, right +X, relative to the CG), whatever the aircraft
      // is doing at the time: the ray is taken into world space and the hit brought
      // back, so they are as valid in flight as they are at load.
      {
        const ray = new THREE.Raycaster();
        const reach = fit.length * 4 + 20;
        const o = new THREE.Vector3(), d = new THREE.Vector3(), inv = new THREE.Matrix4();
        const shoot = (ox, oy, oz, dx, dy, dz) => {
          this.group.updateMatrixWorld(true);
          o.set(ox, oy, oz).applyMatrix4(this.group.matrixWorld);
          d.set(dx, dy, dz).normalize().transformDirection(this.group.matrixWorld);
          ray.set(o, d);
          ray.far = reach * 2;
          const hits = ray.intersectObject(wrap, true);
          if (!hits.length) return null;
          const h = hits[0];
          inv.copy(this.group.matrixWorld).invert();
          const point = h.point.clone().applyMatrix4(inv);
          const normal = (h.face
            ? h.face.normal.clone().transformDirection(h.object.matrixWorld)
            : new THREE.Vector3(0, 1, 0)).transformDirection(inv).normalize();
          return { point, normal };
        };
        // The skin looking straight down at (x, z), straight up at (x, z), and inward
        // from a side at (y, z). null where there is nothing there - off the wingtip,
        // past the tail - so always check.
        fit.skinAbove = (x, z) => shoot(x, fit.top + reach, z, 0, -1, 0);
        fit.skinBelow = (x, z) => shoot(x, fit.belly - reach, z, 0, 1, 0);
        fit.skinSide = (y, z, side = 1) => shoot(side * (fit.halfSpan + reach), y, z, -side, 0, 0);
        fit.probe = shoot;
      }
      this.fit = fit;
      const bits = airframeDetail(fit);
      if (bits && bits.length) {
        const g = new THREE.Group();
        for (const o of bits) g.add(o);
        g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        this.group.add(g);
        this.hide.push(g);
        this.detail = g;
      }
      // move the propeller to the model's nose
      if (this.parts.props) for (const pr of this.parts.props) { pr.position.z = box2.min.z + wrap.position.z + 0.12; pr.position.y = (cfg.propY ?? pr.position.y); }
      if (this.cockpit) wrap.visible = false;
    }, undefined, (err) => console.warn('model load failed, keeping procedural', err));
  }
  setCockpitView(on) {
    if (on === this.cockpit) return;
    this.cockpit = on;
    for (const h of this.hide) h.visible = !on;
  }
  update(ac, dt) {
    this.t += dt;
    const c = ac.ctl, p = this.parts, def = this.def;
    const cm = def.controls;
    if (p.elevator) for (const e of p.elevator) e.rotation.x = -c.elevator * cm.elevatorMax;
    if (p.aileronL) p.aileronL.rotation.x = c.aileron * cm.aileronMax;
    if (p.aileronR) p.aileronR.rotation.x = -c.aileron * cm.aileronMax;
    if (p.aileronL2) p.aileronL2.rotation.x = c.aileron * cm.aileronMax;
    if (p.aileronR2) p.aileronR2.rotation.x = -c.aileron * cm.aileronMax;
    if (p.rudder) for (const r of p.rudder) r.rotation.y = c.rudder * cm.rudderMax;
    if (p.flaps) for (const f of p.flaps) f.rotation.x = c.flap * def.flaps.maxDeg * DEG;
    if (p.spoilers) for (const s of p.spoilers) s.rotation.x = -c.spoiler * 50 * DEG;
    if (p.hook) p.hook.rotation.x = c.hook * def.hook.angle;
    if (p.reversers) for (const r of p.reversers) r.position.z = r.userData.z0 + 0.9 * (ac.input.reverse > 0 && ac.wheelsOnGround ? 1 : 0) * clamp(ac.engines[0].throttle * 2, 0, 1);
    // gear
    for (let i = 0; i < this.legs.length; i++) {
      const L = this.legs[i], leg = ac.legs[i];
      if (!L || !leg) continue;
      if (L.pivot) {
        const a = (1 - leg.ext) * L.angle;
        if (L.axis === 'x') L.pivot.rotation.x = a; else L.pivot.rotation.z = a;
      }
      if (L.strut) L.strut.position.y = L.y0 + Math.min(leg.comp, leg.maxTravel * 1.2) * (leg.collapsed ? 0.3 : 1);
      for (const w of L.wheels) w.rotation.x = -leg.wheelAngle;
      if (L.pivot) L.pivot.visible = (leg.ext > 0.02 || !def.gearRetract) && !(this.gltfCfg && this.gltfCfg.hideGear);
    }
    // props
    if (p.props) for (const pr of p.props) {
      const e = ac.engines[pr.userData.engine] || ac.engines[0];
      this.propAngle += e.rpm * 2400 / 60 * 2 * Math.PI * dt * 0.25;
      pr.rotation.z = this.propAngle;
      if (pr.userData.disc) pr.userData.disc.material.opacity = clamp(e.rpm - 0.2, 0, 0.35);
      if (pr.userData.blades) pr.userData.blades.visible = !pr.userData.discOnly && e.rpm < 0.7;
    }
    // lights
    if (p.lights) {
      const l = p.lights;
      const blink = (this.t % 1.0) < 0.12;
      const strobe = (this.t % 1.4) < 0.05 || ((this.t + 0.12) % 1.4) < 0.05;
      if (l.set) {
        // one Points per aircraft (docs/PERF.md): the blink is written into the vertex attribute
        l.set('beacon', blink ? 1 : 0.05); l.set('strobeL', strobe ? 1 : 0); l.set('strobeR', strobe ? 1 : 0);
      } else {
        l.beacon.material.opacity = blink ? 1 : 0.05;
        l.strobeL.material.opacity = strobe ? 1 : 0;
        l.strobeR.material.opacity = strobe ? 1 : 0;
      }
    }
    if (p.landingLight) p.landingLight.intensity = (ac.ctl.gear > 0.9 && ac.radioAlt < 600) ? p.landingLight.userData.max : 0;
    this.group.position.copy(ac.pos);
    this.group.quaternion.copy(ac.quat);
  }
}
