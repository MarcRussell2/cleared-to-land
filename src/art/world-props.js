// Props on the ground: boulders, roads and villages.
//
// All decoration: nothing collides with any of it, so placement is yours. Where a
// road runs and where a village sits is decided by src/world/airport.js (they have to
// miss the runway and the approach); what they look like is decided here.
//
// Exports (read through terrain-look.js by the world; keep the names and shapes):
//   buildRocks(field)                              -> Object3D
//   buildRoad(field, ax, az, bx, bz, width = 7)    -> Object3D
//   buildVillage(field, cx, cz, count, spread)     -> Object3D[]
//
// Everything is handed a `field`, the live Terrain (src/world/terrain.js), and must
// treat it as read-only. What it offers:
//
//   size, res            the mesh's extent in metres and its grid resolution
//   seed                 deterministic seed; derive your own from it, never Math.random()
//   style                'plains' | 'coast' | 'mountain' | 'sea'
//   elevation            the site's field elevation in metres
//   waterLevel           sea/river level in metres, or null for no water
//   snowLine             metres AMSL where snow starts
//   treeDensity          0..1 from the site
//   treeArea             half-extent in metres over which trees are scattered
//   height(x, z)         ground height in metres
//   normal(x, z, out)    ground normal
//   riverAxis(z)         x of the river centreline (mountain valleys)
//   fieldNoise(x, z)     -1..1, the farm-field pattern
//   forestNoise(x, z)    -1..1, where woodland wants to be
//   nearFlat(x, z, m)    true inside a runway's flattened area - keep clutter out
//
// The quality tier comes from ./quality.js (WORLD_QUALITY.detail: 'low' | 'medium' |
// 'high'); the engine sets it before the world is built. Honour it.
import * as THREE from 'three';
import { makeRng } from '../config.js';
import { PALETTE, FINISH } from './palette.js';
import { WORLD_QUALITY } from './quality.js';
// The new maps' desert and arctic have boulders of their own: world-biomes.js.
import { BIOME_STYLES, biomeRocks } from './world-biomes.js';

// Boulders along the river of a mountain valley.
export function buildRocks(field) {
  if (BIOME_STYLES.has(field.style)) return biomeRocks(field);
  const rng = makeRng(field.seed * 7 + 3);
  const n = 700;
  const geo = new THREE.DodecahedronGeometry(1.4, 0);
  const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: PALETTE.rocks, ...FINISH.rock }), n);
  const mat4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  let k = 0;
  for (let i = 0; i < n * 4 && k < n; i++) {
    const z = (rng() - 0.5) * 7000, x = field.riverAxis(z) + (rng() - 0.5) * 220;
    const h = field.height(x, z);
    if (field.nearFlat(x, z, 4)) continue;
    const sc = 0.4 + rng() * 1.6;
    p.set(x, h + sc * 0.3, z);
    q.setFromEuler(new THREE.Euler(rng() * 3, rng() * 3, rng() * 3));
    s.set(sc, sc * 0.7, sc);
    mat4.compose(p, q, s);
    m.setMatrixAt(k++, mat4);
  }
  m.count = k;
  m.castShadow = true;
  m.frustumCulled = false;
  return m;
}

// A road: a ribbon laid over the terrain between two points.
export function buildRoad(field, ax, az, bx, bz, width = 7) {
  const len = Math.hypot(bx - ax, bz - az);
  const segs = Math.max(4, Math.round(len / 25));
  const dx = (bx - ax) / len, dz = (bz - az) / len;
  const rx = -dz, rz = dx;
  const verts = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    const y = field.height(x, z) + 0.12;
    verts.push(x - rx * width / 2, y, z - rz * width / 2, x + rx * width / 2, y, z + rz * width / 2);
    if (i < segs) { const b = i * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
    color: PALETTE.road, ...FINISH.ground, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  }));
  m.receiveShadow = true;
  return m;
}

// A village: instanced houses with pitched roofs on a loose grid.
export function buildVillage(field, cx, cz, count = 120, spread = 380) {
  const rng = makeRng(Math.round(cx + cz * 3) + field.seed);
  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  wallGeo.translate(0, 0.5, 0);
  const roofGeo = new THREE.CylinderGeometry(0.72, 0.72, 1, 3);
  roofGeo.rotateZ(Math.PI / 2); roofGeo.rotateY(Math.PI / 2);
  roofGeo.translate(0, 0.5 + 0.36, 0);
  const walls = new THREE.InstancedMesh(wallGeo, new THREE.MeshStandardMaterial({ ...FINISH.houseWall }), count);
  const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshStandardMaterial({ ...FINISH.houseRoof }), count);
  const mat4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  const W = PALETTE.village.wall, R = PALETTE.village.roof;
  let k = 0;
  for (let i = 0; i < count * 3 && k < count; i++) {
    const gx = Math.round((rng() - 0.5) * 6), gz = Math.round((rng() - 0.5) * 6);
    const x = cx + gx * (spread / 6) + (rng() - 0.5) * 20, z = cz + gz * (spread / 6) + (rng() - 0.5) * 20;
    if (field.nearFlat(x, z, 30)) continue;
    const h = field.height(x, z);
    if (field.waterLevel != null && h < field.waterLevel + 2) continue;
    const w = 7 + rng() * 6, d = 8 + rng() * 8, hh = 3 + rng() * 2.5;
    const rot = (Math.round(rng() * 3) * Math.PI) / 2 + (rng() - 0.5) * 0.2;
    p.set(x, h - 0.3, z); q.setFromAxisAngle(up, rot); s.set(w, hh, d);
    mat4.compose(p, q, s);
    walls.setMatrixAt(k, mat4);
    walls.setColorAt(k, c.setHSL(W.h + rng() * W.hVary, W.s + rng() * W.sVary, W.l + rng() * W.lVary));
    p.set(x, h - 0.3 + hh, z); s.set(w * 1.08, hh * 0.55, d * 1.05);
    mat4.compose(p, q, s);
    roofs.setMatrixAt(k, mat4);
    roofs.setColorAt(k, c.setHSL(R.h + rng() * R.hVary, R.s + rng() * R.sVary, R.l + rng() * R.lVary));
    k++;
  }
  walls.count = roofs.count = k;
  walls.castShadow = roofs.castShadow = true;
  walls.receiveShadow = true;
  return [walls, roofs];
}

