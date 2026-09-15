// Geometric detail bolted onto the aircraft: the small hardware that makes an
// airframe read as a real machine rather than a smooth shape.
//
// This is the shape half of the aircraft's look. `livery.js` paints them;
// `src/aircraft/models.js` owns the airframe itself - which downloaded model is used,
// the scale fitted to the physics definition's wingspan, the measured hinge lines, the
// part names and every animation. None of that is yours.
//
// Three of the four airframes are downloaded glTF models (Poly Pizza, CC-BY, credited
// in CREDITS.md) and cannot be replaced: no network, no new asset files, and the
// licence is tied to those models. Everything here is geometry added in code.
//
// BODY FRAME, ALWAYS: forward is -Z, up is +Y, right is +X, metres, relative to the
// centre of gravity.
//
// `detail(fit)` returns an array of Object3D. The engine parents them to the aircraft
// and hides them in the cockpit view along with the airframe. `fit` describes the
// airframe AS IT ACTUALLY ENDED UP after being scaled onto the wingspan - measured,
// not assumed:
//
//   id         'skylark' | 'trailblazer' | 'condor' | 'hornet'
//   span       wingspan, metres           length   nose to tail, metres
//   cgHeight   CG height above the wheels
//   nose, tail z of the nose (negative) and of the tail (positive)
//   belly, top y of the lowest and highest points
//   halfSpan   x of the wingtips
//
// Place everything off those numbers. The aeroplanes are very different sizes - the
// trainer measures nose -4.1 / tail 5.6 / top 3.1 / halfSpan 5.5, the bush biplane
// -2.7 / 3.8 / 1.3 / 5.3 - so a hard-coded position that suits one is inside the
// fuselage of another.
//
// `propellerBlades(fit, radius)` returns the blades and spinner for the aircraft that
// have a propeller. The engine spins that group and swaps it for a blur disc above
// about 70% rpm, so build blades that look right stopped and at idle, within `radius`.
//
// FIND THE SKIN BEFORE YOU BOLT ANYTHING TO IT. The box tells you how big the aeroplane
// is, not where its surfaces are, and detail placed off the box alone ends up sticking
// through the wings. `fit` carries probes that fire a ray at the real geometry and
// answer in the body frame:
//
//   fit.skinAbove(x, z)        the surface looking straight down at (x, z)
//   fit.skinBelow(x, z)        the surface looking straight up at (x, z)
//   fit.skinSide(y, z, side)   the surface looking inward from +1 (right) or -1 (left)
//   fit.probe(ox,oy,oz, dx,dy,dz)   a ray of your own
//
// Each returns `{ point, normal }` as THREE.Vector3s, or **null where there is nothing
// there** - off the wingtip, past the tail, above a low fuselage. Always check for null;
// a null means "do not put anything here", and it is also how you find an edge: sweep
// until the hits stop and that is the wingtip or the trailing edge.
//
// They are only present on a downloaded airframe. On the procedural fallback there are
// no probes at all, so guard with `if (fit.skinAbove)` and fall back to the box.
//
// A real sweep of the Skylark, so you can see what good data looks like - the wing top
// at three stations, rising outboard with dihedral, and the nulls where the chord ends:
//
//   x=1.6  z=-2.1:0.98  z=-1.4:1.00  z=-0.7:0.97   z=4.4:0.89 (that one is the tailplane)
//   x=2.8  z=-2.1:1.01  z=-1.4:1.03  z=-0.7:1.00
//   x=4.4  z=-2.1:1.07  z=-1.4:1.06
//
// Budget: this is drawn for every aircraft on screen, and a towered field parks six on
// the apron while you fly a seventh. A few hundred triangles each, materials shared
// from livery.js, and nothing that needs per-frame work. Nothing may overlap the parts
// the engine animates: control surfaces, gear legs, propeller, tailhook, reversers.
import * as THREE from 'three';
import { LIVERY } from './livery.js';

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, -1);

function rod(a, b, radius, material, sides = 5) {
  const direction = new THREE.Vector3().subVectors(b, a);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, direction.length(), sides),
    material,
  );
  mesh.position.copy(a).addScaledVector(direction, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
  return mesh;
}

function boxOnSkin(hit, width, height, length, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, length), material);
  mesh.quaternion.setFromUnitVectors(UP, hit.normal);
  mesh.position.copy(hit.point).addScaledVector(hit.normal, height * 0.5);
  return mesh;
}

function aerialOnSkin(hit, height, material) {
  const shape = new THREE.Shape();
  shape.moveTo(-height * 0.08, 0);
  shape.lineTo(height * 0.18, height);
  shape.lineTo(height * 0.05, height);
  shape.lineTo(0, height * 0.12);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height * 0.055,
    bevelEnabled: false,
  });
  geometry.translate(0, 0, -height * 0.0275);
  geometry.rotateY(Math.PI / 2);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.quaternion.setFromUnitVectors(UP, hit.normal);
  mesh.position.copy(hit.point).addScaledVector(hit.normal, height * 0.008);
  return mesh;
}

// Search from the root out. The final hit is the real tip; fittings are moved a
// little inboard from it so their footprint remains supported by wing skin.
function wingTipHit(fit, side, z, inboard = 0.03) {
  let last = null;
  for (let i = 4; i <= 40; i++) {
    const x = side * fit.halfSpan * i / 40;
    const hit = fit.skinAbove(x, z);
    if (hit) last = hit;
    else if (last) break;
  }
  if (!last) return null;
  return fit.skinAbove(last.point.x - side * fit.halfSpan * inboard, z);
}

// At an outboard station there is no fuselage to confuse the sweep. The last hit
// while moving aft is therefore the wing's real trailing edge.
function trailingEdgeHit(fit, x) {
  let last = null;
  const start = fit.nose * 0.32;
  const end = fit.tail * 0.7;
  for (let i = 0; i <= 48; i++) {
    const z = start + (end - start) * i / 48;
    const hit = fit.skinAbove(x, z);
    if (hit) last = hit;
  }
  return last;
}

function addTipFairings(group, fit, material, z, size) {
  for (const side of [-1, 1]) {
    const hit = wingTipHit(fit, side, z);
    if (!hit) continue;
    group.add(boxOnSkin(hit, size * 1.5, size * 0.34, size, material));
  }
}

function addStaticWicks(group, fit, material, stations, length, radius) {
  for (const side of [-1, 1]) {
    for (const station of stations) {
      const hit = trailingEdgeHit(fit, side * fit.halfSpan * station);
      if (!hit) continue;

      const start = hit.point.clone().addScaledVector(hit.normal, radius * 1.5);
      const aft = FORWARD.clone().negate().projectOnPlane(hit.normal).normalize();
      group.add(rod(start, start.clone().addScaledVector(aft, length), radius, material, 4));
    }
  }
}

function addPitot(group, hit, length, material) {
  if (!hit) return;

  const mount = hit.point.clone().addScaledVector(hit.normal, length * 0.04);
  const elbow = mount.clone().addScaledVector(hit.normal, length * 0.18);
  const forward = FORWARD.clone().projectOnPlane(hit.normal).normalize();
  group.add(rod(mount, elbow, length * 0.025, material, 5));
  group.add(rod(elbow, elbow.clone().addScaledVector(forward, length), length * 0.018, material, 5));
}

function skylark(fit, materials) {
  const group = new THREE.Group();
  const length = fit.length;

  const roof = fit.skinAbove(0, length * 0.09);
  if (roof) group.add(aerialOnSkin(roof, length * 0.025, materials.dark));

  addPitot(
    group,
    fit.skinBelow(-fit.halfSpan * 0.42, fit.nose * 0.19),
    length * 0.045,
    materials.metal,
  );
  addTipFairings(group, fit, materials.metal, fit.nose * 0.28, length * 0.025);
  addStaticWicks(group, fit, materials.dark, [0.7, 0.88], length * 0.04, length * 0.0014);
  return group;
}

function trailblazer(fit, materials) {
  const group = new THREE.Group();
  const length = fit.length;

  // The old interplane struts spanned box-derived heights and pierced both wings.
  // Small upper-wing fittings give the biplane scale without crossing either skin.
  for (const side of [-1, 1]) {
    for (const station of [0.38, 0.63]) {
      const hit = fit.skinAbove(side * fit.halfSpan * station, -length * 0.03);
      if (!hit) continue;
      group.add(boxOnSkin(hit, length * 0.007, length * 0.009, length * 0.022, materials.black));
    }
  }

  const roof = fit.skinAbove(0, length * 0.12);
  if (roof) group.add(aerialOnSkin(roof, length * 0.02, materials.black));
  addTipFairings(group, fit, materials.metal, -length * 0.03, length * 0.022);
  addStaticWicks(group, fit, materials.black, [0.74, 0.9], length * 0.035, length * 0.0013);
  return group;
}

function condor(fit, materials) {
  const group = new THREE.Group();
  const length = fit.length;

  // Flap-track fairings hang entirely below the measured lower wing surface.
  for (const side of [-1, 1]) {
    for (const station of [0.48, 0.69]) {
      const hit = fit.skinBelow(side * fit.halfSpan * station, length * 0.015);
      if (!hit) continue;
      group.add(boxOnSkin(
        hit,
        length * 0.009,
        length * 0.02,
        length * 0.045,
        materials.belly,
      ));
    }

    const tip = wingTipHit(fit, side, 0, 0.045);
    if (tip) {
      group.add(boxOnSkin(
        tip,
        length * 0.008,
        length * 0.04,
        length * 0.022,
        materials.blue,
      ));
    }
  }

  for (const z of [length * 0.12, length * 0.25]) {
    const hit = fit.skinAbove(0, z);
    if (hit) group.add(aerialOnSkin(hit, length * 0.013, materials.dark));
  }
  addStaticWicks(group, fit, materials.dark, [0.76, 0.9], length * 0.025, length * 0.0008);
  return group;
}

function hornet(fit, materials) {
  const group = new THREE.Group();
  const length = fit.length;

  for (const side of [-1, 1]) {
    for (const station of [0.46, 0.68]) {
      const hit = fit.skinBelow(side * fit.halfSpan * station, length * 0.2);
      if (!hit) continue;

      const pylonHeight = length * 0.025;
      group.add(boxOnSkin(
        hit,
        length * 0.018,
        pylonHeight,
        length * 0.05,
        materials.gray2,
      ));

      const railHit = {
        point: hit.point.clone().addScaledVector(hit.normal, pylonHeight),
        normal: hit.normal,
      };
      group.add(boxOnSkin(
        railHit,
        length * 0.014,
        length * 0.009,
        length * 0.11,
        materials.dark,
      ));
    }
  }

  const spine = fit.skinAbove(0, length * 0.16);
  if (spine) group.add(aerialOnSkin(spine, length * 0.018, materials.dark));

  const noseSide = fit.skinSide(fit.belly + (fit.top - fit.belly) * 0.34, fit.nose * 0.75, 1);
  if (noseSide) addPitot(group, noseSide, length * 0.045, materials.metal);
  addStaticWicks(group, fit, materials.dark, [0.76, 0.9], length * 0.03, length * 0.001);
  return group;
}

export function detail(fit) {
  // Probes only exist on loaded glTF airframes. There is no reliable skin to mount
  // detail on in the procedural fallback, so leaving it clean is the safe fallback.
  if (!fit.skinAbove || !fit.skinBelow || !fit.skinSide) return [];

  const build = { skylark, trailblazer, condor, hornet }[fit.id];
  return build ? [build(fit, LIVERY[fit.id]())] : [];
}

export function propellerBlades(fit, radius) {
  const materials = LIVERY[fit.id]();
  const group = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(-radius * 0.045, radius * 0.1);
  shape.lineTo(-radius * 0.075, radius * 0.76);
  shape.lineTo(-radius * 0.035, radius * 0.98);
  shape.lineTo(radius * 0.055, radius * 0.91);
  shape.lineTo(radius * 0.105, radius * 0.31);
  shape.lineTo(radius * 0.055, radius * 0.1);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: radius * 0.025,
    bevelEnabled: false,
  });
  geometry.translate(0, 0, -radius * 0.0125);

  for (const angle of [0, Math.PI]) {
    const blade = new THREE.Mesh(geometry, materials.dark);
    blade.rotation.set(0.15, 0, angle);
    group.add(blade);
  }

  const spinner = new THREE.Mesh(
    new THREE.ConeGeometry(radius * 0.17, radius * 0.42, 10),
    materials.metal,
  );
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.z = -radius * 0.18;
  group.add(spinner);
  return group;
}
