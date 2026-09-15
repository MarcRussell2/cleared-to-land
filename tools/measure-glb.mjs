// Measure a downloaded model's outline in the game's body frame, to place the hinged control-surface
// panels (GLTF[].surfaces in src/aircraft/models.js). Applies the same rotate / scale-to-span / CG
// placement as AircraftModel.loadGltf, then prints, per material, the bounding box, and per region
// the unique vertices (rounded to 0.05 m). Read off the trailing-edge lines and write the numbers in.
//   node tools/measure-glb.mjs skylark            (also: trailblazer, condor, hornet)
//   node tools/measure-glb.mjs condor "v.mat === 0 && v.p.z > 12.5"     (extra region: a JS filter over {p, mat})
import { readFileSync } from 'node:fs';
import { Matrix4, Vector3, Quaternion, Euler } from 'three';
import { AIRCRAFT } from '../src/aircraft/defs.js';

const ROT = { skylark: 0, trailblazer: Math.PI / 2, condor: Math.PI, hornet: Math.PI / 2 };   // keep in step with GLTF[].rotY
const [name, extra] = process.argv.slice(2);
if (!name || !AIRCRAFT[name]) { console.log('usage: node tools/measure-glb.mjs <skylark|trailblazer|condor|hornet> ["filter"]'); process.exit(1); }
const def = AIRCRAFT[name];
const f = (v) => (Math.round(v * 20) / 20).toFixed(2);

const buf = readFileSync(new URL(`../assets/models/${name}.glb`, import.meta.url));
const jl = buf.readUInt32LE(12);
const json = JSON.parse(buf.toString('utf8', 20, 20 + jl));
const bin = buf.subarray(20 + jl + 8);
const acc = (i) => { const a = json.accessors[i], bv = json.bufferViews[a.bufferView]; const st = bv.byteStride || 12; const base = (bv.byteOffset || 0) + (a.byteOffset || 0); const o = []; for (let k = 0; k < a.count; k++) { const q = base + k * st; o.push([bin.readFloatLE(q), bin.readFloatLE(q + 4), bin.readFloatLE(q + 8)]); } return o; };
const world = new Map();
const visit = (i, par) => { const n = json.nodes[i]; const m = new Matrix4(); if (n.matrix) m.fromArray(n.matrix); else m.compose(new Vector3(...(n.translation || [0, 0, 0])), new Quaternion(...(n.rotation || [0, 0, 0, 1])), new Vector3(...(n.scale || [1, 1, 1]))); const w = par ? par.clone().multiply(m) : m; world.set(i, w); for (const c of n.children || []) visit(c, w); };
for (const r of json.scenes?.[0]?.nodes || json.nodes.map((_, i) => i)) visit(r, null);
const V = [];
for (const [i, w] of world) { const n = json.nodes[i]; if (n.mesh == null) continue; for (const pr of json.meshes[n.mesh].primitives) for (const [x, y, z] of acc(pr.attributes.POSITION)) V.push({ p: new Vector3(x, y, z).applyMatrix4(w), mat: pr.material ?? -1 }); }
// the game's placement (models.js loadGltf)
const rot = new Matrix4().makeRotationFromEuler(new Euler(0, ROT[name], 0));
for (const v of V) v.p.applyMatrix4(rot);
const box = () => { const mn = new Vector3(1e9, 1e9, 1e9), mx = new Vector3(-1e9, -1e9, -1e9); for (const v of V) { mn.min(v.p); mx.max(v.p); } return { mn, mx }; };
let b = box();
const sc = def.span / (b.mx.x - b.mn.x);
for (const v of V) v.p.multiplyScalar(sc);
b = box();
const c = b.mn.clone().add(b.mx).multiplyScalar(0.5), len = b.mx.z - b.mn.z;
const off = new Vector3(-c.x, -def.cgHeight - b.mn.y, -(b.mn.z + len * 0.42));
for (const v of V) v.p.add(off);
b = box();
const color = (mi) => { const cf = json.materials[mi]?.pbrMetallicRoughness?.baseColorFactor; return cf ? '#' + [0, 1, 2].map((i) => Math.round(Math.pow(cf[i], 1 / 2.2) * 255).toString(16).padStart(2, '0')).join('') : '?'; };
console.log(`${name}: ${V.length} verts, scale ${f(sc)}, nose z=${f(b.mn.z)} tail z=${f(b.mx.z)}, y[${f(b.mn.y)},${f(b.mx.y)}], half-span ${f(def.span / 2)}`);
const per = {};
for (const v of V) { const q = per[v.mat] || (per[v.mat] = { n: 0, mn: new Vector3(1e9, 1e9, 1e9), mx: new Vector3(-1e9, -1e9, -1e9) }); q.n++; q.mn.min(v.p); q.mx.max(v.p); }
for (const [mi, q] of Object.entries(per)) console.log(`  mat ${mi} ${json.materials[mi]?.name} ${color(+mi)}: n=${q.n} x[${f(q.mn.x)},${f(q.mx.x)}] y[${f(q.mn.y)},${f(q.mx.y)}] z[${f(q.mn.z)},${f(q.mx.z)}]`);
const uniq = (label, sel) => { const s = new Set(); for (const v of V) if (sel(v)) s.add(`${f(v.p.x)},${f(v.p.y)},${f(v.p.z)}`); console.log(`\n${label}: ${s.size} unique (x,y,z)\n  ` + [...s].sort().join('  ')); };
const hs = def.span / 2, zr = b.mx.z - 0.3 * len;
uniq(`WING TIPS |x| > ${f(0.85 * hs)}`, (v) => Math.abs(v.p.x) > 0.85 * hs);
uniq(`WING MID |x| in [${f(0.4 * hs)}, ${f(0.6 * hs)}]`, (v) => Math.abs(v.p.x) > 0.4 * hs && Math.abs(v.p.x) < 0.6 * hs);
uniq(`TAIL, off-centre (z > ${f(zr)}, |x| > 0.3)`, (v) => v.p.z > zr && Math.abs(v.p.x) > 0.3);
uniq(`FIN (z > ${f(zr)}, |x| < 0.3, upper half)`, (v) => v.p.z > zr && Math.abs(v.p.x) < 0.3 && v.p.y > b.mn.y + (b.mx.y - b.mn.y) * 0.5);
if (extra) uniq(`EXTRA ${extra}`, new Function('v', `return (${extra})`));
