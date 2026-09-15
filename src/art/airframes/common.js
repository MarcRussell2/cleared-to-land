// Geometry helpers shared by the four airframes in this directory.
//
// BODY FRAME, ALWAYS: forward is -Z, up is +Y, right is +X, metres, relative to the
// centre of gravity. Every helper here builds in that frame.
//
// Nothing in this file knows which aircraft it is drawing. The airframe modules
// (skylark.js, trailblazer.js, condor.js, hornet.js) compose these into an aeroplane
// and return the contract described in their headers and in ../README.md.
import * as THREE from 'three';
import { lerp } from '../../config.js';
import { navLights as liveryNavLights } from '../livery.js';

const UP = new THREE.Vector3(0, 1, 0);

// One wing half from the root (x = 0) to the tip (x = +-span). The quarter-chord line
// sits at z = rootZ at the root and sweeps/rises outboard. `taperStart` (0..1) holds the
// root chord constant to that fraction of the span before tapering to the tip chord.
// Sections are simple cambered aerofoils: top surface LE->TE then bottom TE->LE.
export function wingPanel({ rootChord, tipChord, span, sweep = 0, dihedral = 0, thick = 0.12, mirror = false, camber = 0.35, taperStart = 0, rootZ = 0, stations = null }) {
  const N = 9;
  const st = stations || [0, taperStart > 0 ? taperStart : 0.5, 1].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
  const verts = [], idx = [];
  const secs = [];
  const sgn = mirror ? -1 : 1;
  for (const s of st) {
    const c = s < taperStart ? rootChord : lerp(rootChord, tipChord, taperStart > 0 ? (s - taperStart) / (1 - taperStart) : s);
    const x = sgn * s * span;
    const y = s * span * Math.tan(dihedral);
    const zq = rootZ + s * span * Math.tan(sweep);
    const zle = zq - 0.25 * c;
    const sec = [];
    for (let k = 0; k <= N; k++) {
      const f = k / N;
      const t = thick * c * Math.sqrt(Math.max(f, 0.001)) * (1 - f) * 2.2 * (1 - 0.35 * f);
      sec.push([x, y + t + camber * thick * c * (1 - f) * f * 2, zle + c * f]);
    }
    for (let k = N; k >= 0; k--) {
      const f = k / N;
      const t = thick * c * Math.sqrt(Math.max(f, 0.001)) * (1 - f) * 2.2 * (1 - 0.35 * f);
      sec.push([x, y - t * 0.45 + camber * thick * c * (1 - f) * f * 2, zle + c * f]);
    }
    secs.push(sec);
  }
  const P = secs[0].length;
  for (const sec of secs) for (const p of sec) verts.push(...p);
  for (let s = 0; s < secs.length - 1; s++) {
    for (let k = 0; k < P; k++) {
      const a = s * P + k, b = s * P + ((k + 1) % P), c2 = (s + 1) * P + ((k + 1) % P), d = (s + 1) * P + k;
      if (mirror) idx.push(a, c2, b, a, d, c2); else idx.push(a, b, c2, a, c2, d);
    }
  }
  // tip cap and root cap (fans)
  const base = (secs.length - 1) * P;
  for (let k = 1; k < P - 1; k++) { if (mirror) idx.push(base, base + k, base + k + 1); else idx.push(base, base + k + 1, base + k); }
  const rb = 0;
  for (let k = 1; k < P - 1; k++) { if (mirror) idx.push(rb, rb + k + 1, rb + k); else idx.push(rb, rb + k, rb + k + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Body of revolution around Z. profile: [[z, r], ...] from nose (negative z) to tail.
// scaleY stretches it vertically (a deeper-than-wide cabin); tailLift = { from, k }
// raises the centreline aft of z = from by k per metre (an upswept rear fuselage).
export function lathe(profile, seg = 24, scaleY = 1, tailLift = 0) {
  const pts = profile.map(([z, r]) => new THREE.Vector2(Math.max(r, 0.001), z));
  const g = new THREE.LatheGeometry(pts, seg);
  g.rotateX(Math.PI / 2);
  g.rotateY(Math.PI);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    let y = p.getY(i) * scaleY;
    if (tailLift && z > tailLift.from) y += (z - tailLift.from) * tailLift.k;
    p.setY(i, y);
  }
  g.computeVertexNormals();
  return g;
}

export function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}
export function cyl(r1, r2, h, mat, seg = 12) { return new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat); }

// A cylinder from point a to point b.
export function rod(a, b, radius, material, sides = 6) {
  const direction = new THREE.Vector3().subVectors(b, a);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), sides), material);
  mesh.position.copy(a).addScaledVector(direction, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
  return mesh;
}

// A control surface hinged at its leading edge: the returned Group is the hinge (its
// origin on the hinge line at x, y, z); the panel extends from the hinge toward +Z (the
// trailing edge). The engine rotates the group about X (elevators, ailerons, flaps,
// spoilers) or about Y (rudders, which are built tall and thin - see vSurface).
export function surface(width, chord, thick, mat, x, y, z, rotY = 0) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  pivot.rotation.y = rotY;
  const m = box(width, thick, chord, mat, 0, 0, chord / 2);
  pivot.add(m);
  return pivot;
}
// A rudder: hinge line vertical at (x, y, z), panel extends toward +Z.
export function vSurface(height, chord, thick, mat, x, y, z) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  pivot.add(box(thick, height, chord, mat, 0, 0, chord / 2));
  return pivot;
}

// A wheel: tyre and hub, axle along X. The engine spins it about X (rotation.x).
export function wheel(r, w, hubMat, tireMat) {
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 18), tireMat);
  t.rotation.z = Math.PI / 2;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w * 1.05, 12), hubMat);
  hub.rotation.z = Math.PI / 2;
  g.add(t, hub);
  return g;
}

// Navigation lights at body-frame positions. What they look like is livery.js's
// business; where they sit is the airframe's. Returns the object update() blinks.
export function navLights(group, left, right, tail, top) {
  return liveryNavLights(group, { left, right, tail, top });
}

// The landing light: a spot the engine switches on below 600 ft with the gear down.
export function landingLight(group, position, target, max, { distance = 400, angle = 0.35 } = {}) {
  const ll = new THREE.SpotLight(0xfff2d0, 0, distance, angle, 0.5, 1);
  ll.position.copy(position);
  ll.target.position.copy(target);
  ll.userData.max = max;
  group.add(ll, ll.target);
  return ll;
}

// Measure a built airframe: the numbers the rest of the game places things by.
export function measureBounds(group) {
  group.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(group);
  const nose = b.min.z, tail = b.max.z;
  return { nose, tail, belly: b.min.y, top: b.max.y, halfSpan: Math.max(Math.abs(b.min.x), Math.abs(b.max.x)), length: tail - nose };
}

export function shadowAll(g) { g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); }

// A builder's anchors, with the one every aircraft must carry.
export function anchor(x, y, z, dx = 0, dy = 0, dz = 1, radius = 0) {
  return { position: new THREE.Vector3(x, y, z), direction: new THREE.Vector3(dx, dy, dz).normalize(), radius };
}
