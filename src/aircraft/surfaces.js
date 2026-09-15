// Hinged control-surface panels for the downloaded aircraft models.
//
// The Poly Pizza models are single meshes with nothing that moves, so the game adds thin panels along
// their real trailing edges (positions measured from the meshes; see GLTF[].surfaces in models.js) and
// hinges them exactly like the procedural airframe's surfaces. models.js update() then drives them
// unchanged: hinge.rotation.x for elevator / ailerons / flaps / spoilers, hinge.rotation.y for rudders.
// Body frame: forward = -Z, up = +Y, right = +X. Every panel extends from its hinge toward +Z (the TE),
// except spoilers, which are hinged at their front edge on the upper surface.
import * as THREE from 'three';

const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();
const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 });

function finish(outer, hinge, box) {
  box.castShadow = true; box.receiveShadow = true;
  hinge.add(box); outer.add(hinge);
  return { outer, hinge };
}

// Horizontal panel. Hinge line starts at (x0, y, z) and runs outboard to x1 with dy/dx (dihedral) and
// dz/dx (sweep). side = -1 mirrors it to the left wing but keeps the hinge axis pointing +X, so a given
// rotation.x deflects both sides the same way (the caller flips the sign for ailerons).
export function hPanel({ x0, x1, y, z, chord, dihedral = 0, sweep = 0, thick = 0.06, color = 0xdddddd, side = 1 }) {
  const w = Math.abs(x1 - x0), cx = (x0 + x1) / 2;
  const outer = new THREE.Group();
  outer.position.set(side * cx, y + dihedral * (cx - x0), z + sweep * (cx - x0));
  _x.set(1, side * dihedral, side * sweep).normalize();
  _z.set(0, 0, 1).addScaledVector(_x, -_x.z).normalize();
  _y.crossVectors(_z, _x).normalize();
  outer.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, thick, chord), mat(color));
  box.position.z = chord / 2;
  return finish(outer, new THREE.Group(), box);
}

// Vertical panel (rudder). Hinge line starts at (x, y0, z) and runs up to y1 with dz/dy (rake, + = leans
// back) and dx/dy (cant, + = leans outboard; use with side = -1 for the other fin of a twin tail).
export function vPanel({ x = 0, y0, y1, z, chord, rake = 0, cant = 0, thick = 0.06, color = 0xdddddd, side = 1 }) {
  const h = y1 - y0, cy = (y0 + y1) / 2;
  const outer = new THREE.Group();
  outer.position.set(side * (x + cant * (cy - y0)), cy, z + rake * (cy - y0));
  _y.set(side * cant, 1, rake).normalize();
  _z.set(0, 0, 1).addScaledVector(_y, -_y.z).normalize();
  _x.crossVectors(_y, _z).normalize();
  outer.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
  const box = new THREE.Mesh(new THREE.BoxGeometry(thick, h, chord), mat(color));
  box.position.z = chord / 2;
  return finish(outer, new THREE.Group(), box);
}

// cfg: { color, aileron, flaps: [...], elevator, rudder | rudders: [...], spoilers: [...] } (see models.js)
// Returns { group, parts } where parts has the same keys models.js update() expects.
export function buildSurfaces(cfg) {
  const group = new THREE.Group();
  const parts = {};
  const color = cfg.color ?? 0xdddddd;
  const both = (spec, fn) => [1, -1].map((side) => {
    const s = { color, ...spec, side };
    if (side === -1 && spec.left) { s.z += spec.left.dz || 0; s.y += spec.left.dy || 0; s.x0 += spec.left.dx || 0; s.x1 += spec.left.dx || 0; }
    const p = fn(s); group.add(p.outer); return p.hinge;
  });
  if (cfg.aileron) { const [r, l] = both(cfg.aileron, hPanel); parts.aileronR = r; parts.aileronL = l; }
  if (cfg.extraAilerons) for (const spec of cfg.extraAilerons) { const [r, l] = both(spec, hPanel); parts.aileronR2 = r; parts.aileronL2 = l; }
  if (cfg.flaps) parts.flaps = cfg.flaps.flatMap((s) => both(s, hPanel));
  if (cfg.elevator) parts.elevator = both(cfg.elevator, hPanel);
  if (cfg.spoilers) parts.spoilers = cfg.spoilers.flatMap((s) => both(s, hPanel));
  if (cfg.rudder) {
    if (cfg.rudder.twin) parts.rudder = both(cfg.rudder, vPanel);
    else { const p = vPanel({ color, ...cfg.rudder }); group.add(p.outer); parts.rudder = [p.hinge]; }
  }
  return { group, parts };
}
