// Small geometry helpers shared by the world, the aircraft and the art bench.
import * as THREE from 'three';

// Merge a list of geometries into one non-indexed buffer (position/normal/uv only).
export function mergeGeos(geos) {
  const parts = geos.map((g) => g.index ? g.toNonIndexed() : g);
  let count = 0;
  for (const g of parts) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3);
    if (g.attributes.normal) nrm.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

// ---------------------------------------------------------------- performance helpers (2026-09-14)
// Measured in docs/PERF.md: an InstancedMesh with frustumCulled = false costs its whole instance
// count in the main pass AND in the shadow pass, whatever is on screen. Split it into spatial
// chunks (cells x cells over the instances' XZ extent) that share the geometry and material and
// keep every instance's matrix and colour, so both cameras can cull them and the picture is the
// same. Small sets are not split, only given a bounding sphere so they can be culled at all.
export function chunkInstanced(mesh, cells = 0) {
  if (!mesh || !mesh.isInstancedMesh) return mesh ? [mesh] : [];
  const n = mesh.count;
  if (n < 600) { mesh.frustumCulled = true; mesh.computeBoundingSphere(); return [mesh]; }
  // ~400 instances per chunk: the shadow camera is a 180 m box, and a chunk's bounding sphere
  // has to be small enough for most chunks to miss it (4x4 over 14 km left 80% of the forest
  // in the shadow pass; 7x7 leaves a tenth).
  if (!cells) cells = Math.max(2, Math.min(12, Math.round(Math.sqrt(n / 400))));
  const m = new THREE.Matrix4(), e = m.elements;
  const xs = new Float32Array(n), zs = new Float32Array(n);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    mesh.getMatrixAt(i, m);
    xs[i] = e[12]; zs[i] = e[14];
    if (e[12] < minX) minX = e[12]; if (e[12] > maxX) maxX = e[12];
    if (e[14] < minZ) minZ = e[14]; if (e[14] > maxZ) maxZ = e[14];
  }
  const sx = (maxX - minX) / cells || 1, sz = (maxZ - minZ) / cells || 1;
  const buckets = [];
  for (let i = 0; i < cells * cells; i++) buckets.push([]);
  for (let i = 0; i < n; i++) {
    const cx = Math.min(cells - 1, Math.floor((xs[i] - minX) / sx)), cz = Math.min(cells - 1, Math.floor((zs[i] - minZ) / sz));
    buckets[cz * cells + cx].push(i);
  }
  const out = [], color = new THREE.Color();
  for (const idx of buckets) {
    if (!idx.length) continue;
    const c = new THREE.InstancedMesh(mesh.geometry, mesh.material, idx.length);
    for (let k = 0; k < idx.length; k++) {
      mesh.getMatrixAt(idx[k], m); c.setMatrixAt(k, m);
      if (mesh.instanceColor) { mesh.getColorAt(idx[k], color); c.setColorAt(k, color); }
    }
    c.castShadow = mesh.castShadow; c.receiveShadow = mesh.receiveShadow;
    c.renderOrder = mesh.renderOrder; c.layers.mask = mesh.layers.mask; c.name = mesh.name;
    c.frustumCulled = true;
    c.computeBoundingSphere();
    out.push(c);
  }
  mesh.dispose();
  return out;
}

// Merge a list of { geometry, matrix } into one non-indexed geometry: positions are transformed
// by the matrix, normals rotated, every other attribute copied (a part that lacks one gets
// zeros). Used to fold a static model's meshes into one draw per material.
export function mergeParts(parts) {
  const list = parts.map((p) => ({ g: p.geometry.index ? p.geometry.toNonIndexed() : p.geometry, m: p.matrix }));
  const names = new Map();
  for (const { g } of list) for (const k in g.attributes) if (!names.has(k)) names.set(k, g.attributes[k].itemSize);
  let count = 0;
  for (const { g } of list) count += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  const nm = new THREE.Matrix3(), v = new THREE.Vector3();
  for (const [name, size] of names) {
    const arr = new Float32Array(count * size);
    let o = 0;
    for (const { g, m } of list) {
      const a = g.attributes[name], n = g.attributes.position.count;
      if (a && a.itemSize === size) {
        if (name === 'position') { for (let i = 0; i < n; i++) { v.fromBufferAttribute(a, i).applyMatrix4(m); v.toArray(arr, (o + i) * 3); } }
        else if (name === 'normal') { nm.getNormalMatrix(m); for (let i = 0; i < n; i++) { v.fromBufferAttribute(a, i).applyMatrix3(nm).normalize(); v.toArray(arr, (o + i) * 3); } }
        else { for (let i = 0; i < n; i++) for (let c = 0; c < size; c++) arr[(o + i) * size + c] = a.getComponent(i, c); }
      }
      o += n;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

// A static object never needs its matrices recomposed: compute them once and switch the
// automatic update off for the whole subtree (`except` keeps listed objects live).
export function freeze(obj, except = null) {
  obj.updateMatrixWorld(true);
  obj.traverse((o) => { if (!except || !except.has(o)) o.matrixAutoUpdate = false; });
  return obj;
}
