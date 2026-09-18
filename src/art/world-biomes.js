// The new maps' look beyond the ground (the missions expansion, 2026-09-17): the island's palms
// and dry scrub, the arctic's black spruce with snow on its boughs, the desert's and the arctic's
// boulders, and the props of three of the new sites (beach umbrellas and loungers, the fence and
// the coast road's cars at Paradise Bay, the terminal and the saddle road's cars at Kestrel Island,
// the ice-fishing shacks at Frostbite Lake). The ground itself is world-ground.js (biomeColor), the
// island's turquoise shallows are world-water.js (setShallows).
//
// How the world reaches this file (it is not a door of its own):
//   biomeForest(field, opts)  -> { objects, count }   world-vegetation.js buildForest() hands a new
//                                                     style here (BIOME_STYLES); same contract
//   biomeRocks(field)         -> InstancedMesh        world-props.js buildRocks() does the same; the
//                                                     terrain chunks it for culling
//   buildSiteProps(rw, place, kind, groundAt) -> { objects, obstacles }
//                             re-exported by airport-look.js and called by world/airport.js for a
//                             runway with `props`. rw and place(u, v, out) are as everywhere in
//                             airport-look.js; groundAt(x, z) is the terrain height (a beach is
//                             lower than the runway). Solid props return obstacles, like the
//                             aerodrome's buildings: {x, z, r, y, kind: 'structure', name}.
//
// `field` is the live Terrain, read-only (the list of what it offers is in world-ground.js's
// header); the new styles add `island`, `desert`, `arctic` (their parameters) and, for the arctic,
// lakeShore(x, z) (metres outside the frozen lake, negative on it).
//
// The house rules, as in every world module: materials named ('biome/...'), created per call and
// never cached (only the canvas textures are, keyed by what drew them); uniforms prefixed `bm`
// (the atmosphere's `at*` names are injected by the sky); customProgramCacheKey on every
// onBeforeCompile; seeded randomness only (makeRng, noise2 from ../config.js); instanced or merged
// geometry with bounding spheres, nothing frustumCulled = false; no lights. Colours are linear
// (BIOMES in palette.js).
//
// Vegetation level of detail is per instance, as in world-vegetation.js: each level's vertex
// shader collapses the instances outside its range (level 0 within 350 m on high, level 1 to
// 1500 m, camera-facing cards beyond), level meshes sit in 300 m / 1200 m cells under a THREE.LOD
// that stops drawing a cell wholly out of range, and the cards are one InstancedMesh per species
// that the terrain splits into chunks. Triangles per instance: palm 108/52/2, scrub 108/46/2,
// spruce 83/27/2. Cap: 24k trees on an island or round the lake, times the tier's treeScale.
import * as THREE from 'three';
import { clamp, smoothstep, lerp, makeRng, noise2 } from '../config.js';
import { mergeGeos } from '../geom.js';
import { BIOMES, FINISH } from './palette.js';
import { WORLD_QUALITY } from './quality.js';

// The terrain styles this file dresses (src/world/terrain.js).
export const BIOME_STYLES = new Set(['island', 'desert', 'arctic']);

// Where the woods are, 0..1: the island's stands of dry forest, and the spruce woodland round the frozen lake
// (thickest along the shore, thin up the hills). The trees below grow on these and the ground under them
// (world-ground.js biomeColor) darkens on the same masks, so a stand sits on its own shade and reads as a mass
// from a distance instead of as a scatter of dots. `shore` is field.lakeShore(x, z), already to hand.
export function islandStand(field, x, z) { return smoothstep(0.02, 0.24, field.forestNoise(x, z)); }
export function arcticWood(field, x, z, shore) {
  return smoothstep(-0.15, 0.2, field.forestNoise(x, z)) * (0.25 + 0.75 * (1 - smoothstep(500, 1700, shore)));
}

// ------------------------------------------------------------------ geometry helpers
// Merge parts {geo, colour} into one geometry with a per-vertex colour (linear [r,g,b] or a
// function (x, y, z, nx, ny, nz) -> [r,g,b] for colour that follows the shape: snow on the boughs).
function coloured(parts) {
  const geo = mergeGeos(parts.map((p) => p.geo));
  const pos = geo.attributes.position, nrm = geo.attributes.normal;
  const col = new Float32Array(pos.count * 3);
  let o = 0;
  for (const p of parts) {
    const n = p.geo.index ? p.geo.index.count : p.geo.attributes.position.count;
    for (let i = 0; i < n; i++, o++) {
      const c = typeof p.colour === 'function'
        ? p.colour(pos.getX(o), pos.getY(o), pos.getZ(o), nrm.getX(o), nrm.getY(o), nrm.getZ(o)) : p.colour;
      col[o * 3] = c[0]; col[o * 3 + 1] = c[1]; col[o * 3 + 2] = c[2];
    }
    p.geo.dispose();
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}
const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const hsl = (o, k = 0.5) => { const c = new THREE.Color().setHSL(o.h, o.s, o.l + (o.lVary || 0) * (k - 0.5)); return [c.r, c.g, c.b]; };

// A palm, 12 m tall at scale 1, leaning a little down +x: a curved, tapering trunk and a crown of
// seven fronds, each folded along its midrib and drooping in an arc; the lowest two are the old
// brown ones. 108 triangles (the forest budget is 110 a tree); level 1 keeps the silhouette in 52.
function palmGeometry(level) {
  const parts = [];
  const trunkC = lin(BIOMES.island.palmTrunk);
  const segs = level ? 2 : 3, sides = level ? 3 : 4, H = 11.2;
  const trunk = new THREE.CylinderGeometry(0.17, 0.26, H, sides, segs, true);
  const p = trunk.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) + H / 2) / H;
    p.setXYZ(i, p.getX(i) + 1.1 * t * t, p.getY(i) + H / 2, p.getZ(i));
  }
  trunk.computeVertexNormals();
  parts.push({ geo: trunk, colour: trunkC });
  const top = new THREE.Vector3(1.1, H, 0);
  const fronds = level ? 5 : 7, steps = level ? 2 : 3;
  const green = hsl(BIOMES.island.palmFrond, 0.55), dry = BIOMES.island.palmDry;
  for (let f = 0; f < fronds; f++) {
    const a = f * 2.39996 + 0.3, old = !level && f >= fronds - 2;
    const len = old ? 3.6 : 4.6, lift = old ? -0.9 : 0.35 - 0.12 * (f % 3);
    const dx = Math.cos(a), dz = Math.sin(a);
    const verts = [], idx = [];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, r = len * t;
      // an arc: up a little, then down past the horizontal toward the tip
      const y = r * lift - 1.9 * t * t * (old ? 1.6 : 1);
      const w = 0.75 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 0.05;
      const fold = level ? 0 : 0.28 * w;
      const cx = top.x + dx * r, cz = top.z + dz * r, cy = top.y + y;
      verts.push(cx, cy, cz);                                        // midrib
      verts.push(cx - dz * w, cy - fold, cz + dx * w);               // one edge, folded down
      verts.push(cx + dz * w, cy - fold, cz - dx * w);               // the other
      if (s) { const b = (s - 1) * 3, c = s * 3; idx.push(b, c, b + 1, c, c + 1, b + 1, b, b + 2, c, c, b + 2, c + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx); g.computeVertexNormals();
    parts.push({ geo: g, colour: old ? dry : green });
  }
  return coloured(parts);
}

// Dry tropical woodland (sea grape, gumbo-limbo, manchineel), 6 m tall at scale 1: a short trunk under a
// broad, low, irregular crown of five lobes (two on level 1) that is wider than it is tall and starts a metre
// and a half off the ground, so a stand closes into one bumpy canopy instead of a field of separate trees.
// The foliage normals point out of the crown as a whole, so it lights as one soft mass, a little darker
// underneath, rather than as facets. 108 triangles (the forest budget is 110 a tree), 46 on level 1.
const SCRUB_LOBES = [
  // x, y, z, and the radii
  [[0, 3.9, 0, 2.0, 1.5, 2.0], [1.5, 3.2, 0.4, 1.7, 1.3, 1.6], [-1.3, 3.4, 0.9, 1.6, 1.35, 1.7], [-0.5, 3.1, -1.5, 1.8, 1.25, 1.5], [0.9, 4.4, -0.6, 1.4, 1.1, 1.4]],
  [[0, 3.6, 0, 2.6, 1.8, 2.4], [0.9, 3.0, 0.5, 2.0, 1.4, 1.9]],
];
function scrubGeometry(level) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.09, 0.2, 2.3, level ? 3 : 4, 1, true);
  trunk.translate(0, 1.15, 0);
  parts.push({ geo: trunk, colour: lin(BIOMES.island.palmTrunk) });
  const base = hsl(BIOMES.island.scrubTree, 0.5), centre = new THREE.Vector3(0, 3.4, 0), v = new THREE.Vector3();
  SCRUB_LOBES[level ? 1 : 0].forEach(([lx, ly, lz, rx, ry, rz], j) => {
    const g = new THREE.IcosahedronGeometry(1, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + 0.2 * Math.sin(x * 5.1 + y * 3.7 + z * 4.3 + j * 1.3);
      p.setXYZ(i, x * k, y * k, z * k);
    }
    g.scale(rx, ry, rz);
    g.translate(lx, ly, lz);
    g.computeVertexNormals();
    const nrm = g.attributes.normal;
    for (let i = 0; i < p.count; i++) { v.set(p.getX(i), p.getY(i), p.getZ(i)).sub(centre).normalize(); nrm.setXYZ(i, v.x, v.y, v.z); }
    parts.push({ geo: g, colour: (x, y, z, nx, ny) => { const k = 0.62 + 0.38 * smoothstep(-0.8, 0.9, ny); return [base[0] * k, base[1] * k, base[2] * k]; } });
  });
  return coloured(parts);
}

// A black spruce, 14 m tall at scale 1: a narrow spire of drooping tiers with snow lying on their
// upper faces (vertex colour by the facet's slope).
function spruceGeometry(level) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.08, 0.2, 5, level ? 3 : 5);
  trunk.translate(0, 2.5, 0);
  parts.push({ geo: trunk, colour: [0.05, 0.04, 0.035] });
  const tiers = level ? 3 : 7, sides = level ? 5 : 9;
  const dark = hsl(BIOMES.arctic.spruce, 0.5), snow = BIOMES.arctic.snowOnTree;
  for (let j = 0; j < tiers; j++) {
    const t = j / (tiers - 1);
    const bottom = lerp(1.8, 11.6, t), top = lerp(4.4, 14, t), r = lerp(1.7, 0.35, t);
    const g = new THREE.ConeGeometry(r, top - bottom, sides, 1, true);
    g.rotateY(j * 0.9);
    g.translate(0, (bottom + top) / 2, 0);
    parts.push({ geo: g, colour: (x, y, z, nx, ny) => { const s = smoothstep(0.62, 0.95, ny) * 0.7; return [lerp(dark[0], snow[0], s), lerp(dark[1], snow[1], s), lerp(dark[2], snow[2], s)]; } });
  }
  return coloured(parts);
}

// ------------------------------------------------------------------ the far cards
const cards = new Map();
function cardTexture(species) {
  if (cards.has(species)) return cards.get(species);
  const S = 128, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rgb = (a, k = 1) => `rgb(${Math.round(255 * Math.pow(clamp(a[0] * k, 0, 1), 1 / 2.2))},${Math.round(255 * Math.pow(clamp(a[1] * k, 0, 1), 1 / 2.2))},${Math.round(255 * Math.pow(clamp(a[2] * k, 0, 1), 1 / 2.2))})`;
  if (species === 'palm') {
    g.strokeStyle = rgb(lin(BIOMES.island.palmTrunk)); g.lineWidth = 5;
    g.beginPath(); g.moveTo(60, 128); g.quadraticCurveTo(62, 60, 72, 30); g.stroke();
    const green = hsl(BIOMES.island.palmFrond, 0.55);
    for (let f = 0; f < 9; f++) {
      const a = -Math.PI + f * Math.PI / 8;
      g.strokeStyle = rgb(green, 0.8 + 0.3 * (f % 2)); g.lineWidth = 7;
      g.beginPath(); g.moveTo(72, 30);
      g.quadraticCurveTo(72 + Math.cos(a) * 30, 30 + Math.sin(a) * 22 - 8, 72 + Math.cos(a) * 50, 36 + Math.abs(Math.cos(a)) * 22);
      g.stroke();
    }
  } else if (species === 'scrub') {
    g.fillStyle = rgb(lin(BIOMES.island.palmTrunk)); g.fillRect(61, 90, 6, 38);
    const b = hsl(BIOMES.island.scrubTree, 0.5);
    for (let j = 0; j < 7; j++) { g.fillStyle = rgb(b, 0.8 + 0.08 * j); g.beginPath(); g.ellipse(64 + Math.cos(j * 2.4) * 22, 58 + Math.sin(j * 2.4) * 14, 28, 24, 0, 0, Math.PI * 2); g.fill(); }
  } else {
    const dark = hsl(BIOMES.arctic.spruce, 0.5), snow = BIOMES.arctic.snowOnTree;
    for (let j = 0; j < 7; j++) {
      const t = j / 6, y = lerp(116, 12, t), r = lerp(20, 4, t);
      g.fillStyle = rgb(dark, 1.4); g.beginPath(); g.moveTo(64, y - 22); g.lineTo(64 + r, y); g.lineTo(64 - r, y); g.closePath(); g.fill();
      g.fillStyle = rgb(snow); g.beginPath(); g.moveTo(64, y - 22); g.lineTo(64 + r * 0.7, y - 6); g.lineTo(64 - r * 0.5, y - 8); g.closePath(); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cards.set(species, t);
  return t;
}

// A level's material: instances outside [near, far) are collapsed to a point in the vertex shader
// (with a 30 m stagger so a row does not switch on one frame); a card faces the camera.
function rangeMaterial(name, extra, near, far, card = false) {
  const m = new THREE.MeshStandardMaterial({ ...FINISH.foliage, fog: true, ...extra });
  m.name = 'biome/' + name;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.bmNear = { value: near };
    shader.uniforms.bmFar = { value: far };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float bmNear, bmFar;
        float bmHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`)
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
        ${card ? `vec3 bmNo = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec3 bmView = cameraPosition - bmNo; bmView.y = 0.0; bmView /= max(length(bmView), 0.001);
        transformedNormal = mat3(viewMatrix) * normalize(vec3(0.0, 0.6, 0.0) + bmView * 0.4);` : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 bmOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float bmDist = distance(bmOrigin, cameraPosition) + (bmHash(bmOrigin.xz) - 0.5) * 30.0;
        float bmKeep = step(bmNear, bmDist) * step(bmDist, bmFar);
        ${card ? `vec3 bmTo = cameraPosition - bmOrigin;
        vec3 bmRight = vec3(bmTo.z, 0.0, -bmTo.x) / max(length(bmTo.xz), 0.001);
        transformed = bmRight * position.x + vec3(0.0, position.y, 0.0);` : ''}
        transformed *= bmKeep;`);
  };
  m.customProgramCacheKey = () => `ctl-biome-veg-v1-${card ? 'card' : 'mesh'}-${extra.side === THREE.DoubleSide ? 2 : 0}`;
  return m;
}

// ------------------------------------------------------------------ the forests
const SPECIES = {
  palm: { geo: palmGeometry, model: 12, card: 9, double: true, wide: 1 },
  scrub: { geo: scrubGeometry, model: 6, card: 9, double: false, wide: 1.5 },
  spruce: { geo: spruceGeometry, model: 14, card: 4.5, double: false, wide: 1 },
};

export function biomeForest(field, opts = {}) {
  const objects = [];
  const treeScale = clamp(opts.treeScale ?? 1, 0, 1);
  if (field.style === 'desert' || field.treeDensity <= 0 || !treeScale) return { objects, count: 0 };
  const detail = opts.detail || WORLD_QUALITY.detail;
  const high = detail === 'high', low = detail === 'low';
  const island = field.style === 'island';
  const area = Math.min(field.treeArea, 5400), rng = makeRng(field.seed * 131 + 17);
  const cell = island ? 15 : 18, water = field.waterLevel ?? -1e9;
  const cap = Math.floor(opts.maxTrees ?? 24000);
  const normal = new THREE.Vector3();
  const trees = [];
  // an island's trees only grow on the island: walk its bounding box, not the whole site
  const I = field.island;
  const x0 = I ? Math.max(-area, I.x - I.rx * 1.25) : -area, x1 = I ? Math.min(area, I.x + I.rx * 1.25) : area;
  const z0 = I ? Math.max(-area, I.z - I.rz * 1.25) : -area, z1 = I ? Math.min(area, I.z + I.rz * 1.25) : area;
  for (let x = x0; x < x1; x += cell) for (let z = z0; z < z1; z += cell) {
    const px = x + rng() * cell, pz = z + rng() * cell;
    const chance = rng(), size = rng(), angle = rng() * Math.PI * 2, tier = rng(), rank = rng();
    if (chance > 0.92) continue;                                // cheap early rejection: nothing is denser
    let species = null, height = 0, h;
    if (island) {
      // Palms crowd the back of every beach and dot the lowland; the dry forest grows in stands (islandStand)
      // with only a rare tree in the open scrub between them. The coast distance and the mask are cheap, so
      // they decide before the height is sampled.
      const dc = field.coastDistance ? field.coastDistance(px, pz) : 100;
      if (dc < 5) continue;
      const palm = 0.68 * smoothstep(6, 18, dc) * (1 - smoothstep(50, 140, dc)) + 0.012 * (1 - smoothstep(100, 500, dc));
      if (chance < palm) species = 'palm';
      else {
        const scrub = Math.min(0.8, field.treeDensity * (0.012 + 1.15 * islandStand(field, px, pz))) * smoothstep(20, 60, dc);
        if (chance < palm + scrub) species = 'scrub'; else continue;
      }
      h = field.height(px, pz);
      const d = h - water;
      if (d < 1.4 || (species === 'palm' && d > 25)) continue;
      height = species === 'palm' ? lerp(8, 15, size) : lerp(4.5, 9, size);
    } else {
      // Black spruce, an open woodland: thickest along the shore, in stands where the woodland noise says so,
      // thinning out up the hills to the treeline; never on the ice (arcticWood)
      const shore = field.lakeShore ? field.lakeShore(px, pz) : 1e3;
      if (shore < 16) continue;
      const wood = field.treeDensity * (0.05 + 0.85 * arcticWood(field, px, pz, shore));
      if (chance > wood) continue;
      h = field.height(px, pz);
      const rel = h - field.elevation;
      if (chance > wood * (1 - smoothstep(170, 260, rel))) continue;
      species = 'spruce'; height = lerp(8, 17, size) * lerp(1, 0.6, smoothstep(120, 240, rel));
    }
    if (field.nearFlat(px, pz, 16)) continue;
    if (field.normal(px, pz, normal).y < (island ? 0.72 : 0.78)) continue;
    trees.push({ x: px, z: pz, h, species, height, angle, tier, rank, lean: species === 'palm' ? size : 0 });
  }
  trees.sort((a, b) => a.rank - b.rank);
  const kept = trees.slice(0, cap).filter((t) => t.tier <= treeScale);
  const near = high ? 350 : low ? 120 : 220, far = high ? 1500 : low ? 500 : 900;
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion(), euler = new THREE.Euler(), colour = new THREE.Color();
  const instance = (geo, mat, list, origin, card) => {
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((t, i) => {
      const S = SPECIES[t.species], sc = t.height / S.model, wide = sc * S.wide * (0.9 + 0.2 * t.rank);
      position.set(t.x - origin.x, t.h - origin.y - 0.2, t.z - origin.z);
      scale.set(wide, sc, card ? sc : wide);
      euler.set(0, card ? 0 : t.angle, 0);
      rotation.setFromEuler(euler); matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(i, matrix);
      const k = 0.85 + 0.3 * t.rank;
      if (t.species === 'scrub') {
        // the dry forest is not one green: olive, grey-green and a fresher green, tree by tree
        const u = (t.angle * 7.31) % 1;
        mesh.setColorAt(i, colour.setRGB(k * (0.9 + 0.22 * u), k, k * (0.88 + 0.18 * (1 - u))));
      } else mesh.setColorAt(i, colour.setRGB(k * (0.97 + 0.06 * t.lean), k, k * (1.02 - 0.04 * t.lean)));
    });
    mesh.castShadow = !card && !low && mat.userData.shadow; mesh.receiveShadow = false;
    mesh.computeBoundingSphere();
    return mesh;
  };
  const cellsOf = (list, size) => {
    const map = new Map();
    for (const t of list) {
      const ix = Math.floor(t.x / size), iz = Math.floor(t.z / size), key = ix + ',' + iz;
      if (!map.has(key)) { const cx = (ix + 0.5) * size, cz = (iz + 0.5) * size; map.set(key, { x: cx, z: cz, y: field.height(cx, cz), list: [] }); }
      map.get(key).list.push(t);
    }
    return map.values();
  };
  const cull = (mesh, name, c, range) => {
    const lod = new THREE.LOD();
    lod.name = name;
    lod.position.set(c.x, c.y, c.z);
    lod.addLevel(mesh, 0);
    lod.addLevel(new THREE.Group(), range + mesh.boundingSphere.center.length() + mesh.boundingSphere.radius + 15, 0);
    objects.push(lod);
  };
  for (const species of Object.keys(SPECIES)) {
    const list = kept.filter((t) => t.species === species);
    if (!list.length) continue;
    const S = SPECIES[species], side = S.double ? THREE.DoubleSide : THREE.FrontSide;
    const geos = [S.geo(0), S.geo(1)];
    const mats = [rangeMaterial(species + '-lod0', { vertexColors: true, side }, 0, near), rangeMaterial(species + '-lod1', { vertexColors: true, side }, near, far)];
    mats[0].userData.shadow = true;
    // (300 m cells for level 0: its instances are also the shadow casters, and the shadow pass draws a
    // whole cell at full detail wherever the 180 m shadow box touches it)
    for (const c of cellsOf(list, 300)) cull(instance(geos[0], mats[0], c.list, c, false), `vegetation/${species}/lod0`, c, near);
    for (const c of cellsOf(list, 1200)) cull(instance(geos[1], mats[1], c.list, c, false), `vegetation/${species}/lod1`, c, far);
    const cardGeo = new THREE.PlaneGeometry(S.card, S.model);
    cardGeo.translate(0, S.model / 2, 0);
    const cardMat = rangeMaterial(species + '-card', { map: cardTexture(species), alphaTest: 0.5, side: THREE.DoubleSide }, far, 1e6, true);
    const cardsMesh = instance(cardGeo, cardMat, list, new THREE.Vector3(), true);
    cardsMesh.name = `vegetation/${species}/cards`;
    objects.push(cardsMesh);
  }
  return { objects, count: kept.length };
}

// ------------------------------------------------------------------ boulders
// The desert's rock fall at the foot of every cliff and a scatter on the floor; the arctic's
// boulders along the lake shore and on the slopes, snow on their tops. One InstancedMesh.
export function biomeRocks(field) {
  const desert = field.style === 'desert';
  const detail = WORLD_QUALITY.detail;
  const n = detail === 'high' ? 1400 : detail === 'medium' ? 900 : 450;
  const rng = makeRng(field.seed * 7 + 5);
  const geo = new THREE.DodecahedronGeometry(1.4, 0);
  // the rock's own colour in the vertex colours (snow on the arctic boulders' upper faces), so the
  // material stays white and the instance colour only varies the brightness
  const rock = lin(desert ? BIOMES.desert.boulder : BIOMES.arctic.boulder), snow = BIOMES.arctic.snowOnTree;
  const col = new Float32Array(geo.attributes.position.count * 3);
  for (let i = 0; i < geo.attributes.position.count; i++) {
    const s = desert ? 0 : smoothstep(0.45, 0.8, geo.attributes.normal.getY(i));
    col.set([lerp(rock[0], snow[0], s), lerp(rock[1], snow[1], s), lerp(rock[2], snow[2], s)], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, ...FINISH.rock });
  mat.name = desert ? 'biome/rocks-desert' : 'biome/rocks-arctic';
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.name = 'world/rocks';
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const e = new THREE.Euler(), normal = new THREE.Vector3(), c = new THREE.Color();
  const reach = Math.min(field.treeArea || 5000, 5000);
  let k = 0;
  for (let i = 0; i < n * 12 && k < n; i++) {
    const x = (rng() - 0.5) * 2 * reach, z = (rng() - 0.5) * 2 * reach, chance = rng(), size = rng(), a = rng(), b = rng(), tint = rng();
    if (field.nearFlat(x, z, 6)) continue;
    const slope = 1 - field.normal(x, z, normal).y;
    let want;
    if (desert) want = 0.9 * smoothstep(0.06, 0.2, slope) * (1 - smoothstep(0.32, 0.5, slope)) + 0.03;
    else { const shore = field.lakeShore ? field.lakeShore(x, z) : 100; want = (shore > 0 ? 0.6 * (1 - smoothstep(10, 80, shore)) : 0) + 0.25 * smoothstep(0.15, 0.35, slope) * (1 - smoothstep(0.5, 0.7, slope)) + 0.02; }
    if (chance > want) continue;
    const h = field.height(x, z), sc = desert ? 0.5 + size * size * 3.2 : 0.4 + size * size * 2.2;
    p.set(x, h + sc * 0.25, z);
    q.setFromEuler(e.set(a * 3, b * 6.3, (a - b) * 2));
    s.set(sc * (0.8 + 0.4 * a), sc * (0.55 + 0.3 * b), sc);
    m4.compose(p, q, s);
    mesh.setMatrixAt(k, m4);
    mesh.setColorAt(k, c.setScalar(0.8 + 0.4 * tint));
    k++;
  }
  mesh.count = k;
  mesh.castShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

// ------------------------------------------------------------------ site props
// One material for everything a site adds to the aerodrome (docs/PERF.md: at most 20 materials an
// aerodrome, and Paradise Bay's standard buildings already use 16): the colour of every prop is in its
// vertex colours, times an instance colour on the instanced ones (always set, so they share one program),
// and the finish is a painted one. Double-sided for the umbrellas' canopies.
function propMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, ...FINISH.painted, side: THREE.DoubleSide });
  m.name = 'biome/site-props';
  return m;
}
// a geometry in one colour (linear [r,g,b] or a hex), as coloured() does for a single part
const solidColour = (geo, c) => coloured([{ geo, colour: Array.isArray(c) ? c : lin(c) }]);

// Everything a site's props need, handed per call: a list of objects, a list of obstacles, the
// place() and ground helpers, an instancer for the small repeated things, and a box merger.
function propKit(rw, place, groundAt) {
  const objects = [], obstacles = [], tmp = new THREE.Vector3(), mat = propMaterial();
  const at = (u, v, onGround = true) => { place(u, v, tmp); if (onGround && groundAt) tmp.y = groundAt(tmp.x, tmp.z); return tmp; };
  const solid = (u, v, r, h, name) => { const p = at(u, v); obstacles.push({ x: p.x, z: p.z, r, y: p.y + h, kind: 'structure', name }); };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  // instances: [{u, v, rot, y, s: [sx, sy, sz], colour}] of one vertex-coloured geometry
  const instanced = (name, geo, list, shadow = false) => {
    if (!list.length) return null;
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, i) => {
      const p = at(it.u, it.v);
      q.setFromAxisAngle(up, -rw.heading + (it.rot || 0));
      sc.set(...(it.s || [1, 1, 1]));
      m4.compose(p.clone().setY(p.y + (it.y || 0)), q, sc);
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, col.set(it.colour ?? 0xffffff));
    });
    mesh.name = 'biome/' + name;
    mesh.castShadow = shadow; mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    objects.push(mesh);
    return mesh;
  };
  // static boxes, all merged into one draw: (colour, u, v, x, y, z, w, h, d, rot) in the runway frame, on
  // the ground at (u, v); `colour` a hex or a linear [r, g, b]
  const boxes = [];
  const box = (colour, u, v, x, y, z, w, h, d, rot = 0) => {
    const p = at(u, v);
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y + h / 2, z); g.rotateY(-rw.heading + rot); g.translate(p.x, p.y, p.z);
    boxes.push({ geo: g, colour: Array.isArray(colour) ? colour : lin(colour) });
  };
  const finish = () => {
    if (boxes.length) {
      const mesh = new THREE.Mesh(coloured(boxes), mat);
      mesh.name = 'biome/site-buildings'; mesh.castShadow = true; mesh.receiveShadow = true;
      objects.push(mesh);
    }
    return { objects, obstacles };
  };
  return { objects, obstacles, at, solid, instanced, box, finish, heading: rw.heading };
}

// Beach umbrellas (a pole and a shallow canopy) with a pair of loungers beside each: one draw each.
function beach(kit, spots, seed) {
  const I = BIOMES.island, rng = makeRng(seed);
  const canopy = new THREE.ConeGeometry(1.35, 0.55, 10, 1, true);
  canopy.translate(0, 2.25, 0);
  const pole = new THREE.CylinderGeometry(0.03, 0.03, 2.3, 4);
  pole.translate(0, 1.15, 0);
  const lounger = new THREE.BoxGeometry(0.62, 0.32, 1.9);
  lounger.translate(0, 0.16, 0);
  const umbrellas = [], poles = [], loungers = [];
  for (const [u, v] of spots) {
    const rot = (rng() - 0.5) * 0.5;
    umbrellas.push({ u, v, rot, colour: I.umbrellas[Math.floor(rng() * I.umbrellas.length)] });
    poles.push({ u, v });
    for (const side of [-1, 1]) loungers.push({ u: u + 0.4 * rng(), v: v + side * 0.95, rot: rot + (rng() - 0.5) * 0.3 });
  }
  kit.instanced('umbrellas', solidColour(canopy, [1, 1, 1]), umbrellas, true);
  kit.instanced('umbrella-poles', solidColour(pole, I.pole), poles);
  kit.instanced('loungers', solidColour(lounger, I.lounger), loungers);
}

// Parked or moving-looking cars: a body under a dark glass cabin (one geometry), instance-coloured
// (the cabin's vertex colour is dark enough that any paint leaves it glass); each one is solid.
function cars(kit, list, seed) {
  const I = BIOMES.island, rng = makeRng(seed);
  const body = new THREE.BoxGeometry(1.8, 0.8, 4.3); body.translate(0, 0.55, 0);
  const cabin = new THREE.BoxGeometry(1.6, 0.6, 2.2); cabin.translate(0, 1.25, -0.2);
  const geo = coloured([{ geo: body, colour: [1, 1, 1] }, { geo: cabin, colour: [0.012, 0.016, 0.022] }]);
  const bodies = [];
  for (const [u, v, rot] of list) {
    bodies.push({ u, v, rot, colour: I.cars[Math.floor(rng() * I.cars.length)] });
    kit.solid(u, v, 2.3, 1.6, 'a car');
  }
  kit.instanced('cars', geo, bodies, true);
}

export function buildSiteProps(rw, place, kind, groundAt) {
  const kit = propKit(rw, place, groundAt);
  const I = BIOMES.island;
  if (kind === 'paradise') {
    // the beach: two rows of umbrellas on the dry sand, a gap straight under the approach
    const rng = makeRng(911), spots = [];
    for (let v = -620; v <= 620; v += 34) {
      if (Math.abs(v) < 40) continue;
      spots.push([-92 + 6 * rng(), v + 8 * (rng() - 0.5)]);
      if (rng() < 0.6) spots.push([-76 + 5 * rng(), v + 12 + 8 * (rng() - 0.5)]);
    }
    beach(kit, spots, 912);
    // the coast road's traffic (solid), and the airport fence behind it with the famous sign
    cars(kit, [[-36, -420, Math.PI / 2], [-32, -210, -Math.PI / 2], [-36, -95, Math.PI / 2], [-32, 75, -Math.PI / 2 + 0.03], [-36, 260, Math.PI / 2], [-32, 505, -Math.PI / 2], [-36, 780, Math.PI / 2]], 913);
    for (let v = -150; v <= 150; v += 3) kit.box(I.fence, -22, v, 0, 0, 0, 0.08, 2.4, 0.08);
    kit.box(I.fence, -22, 0, 0, 2.3, 0, 0.05, 0.08, 300);
    kit.box(I.fence, -22, 0, 0, 1.2, 0, 0.04, 0.06, 300);
    kit.box(I.sign, -26, 34, 0, 1.8, 0, 0.12, 1.4, 3.2);
    for (const dv of [-1.3, 1.3]) kit.box(I.fence, -26, 34 + dv, 0, 0, 0, 0.1, 1.9, 0.1);
    // beach hotels either side of the approach, pastel walls, terracotta roofs, a glazed band per floor
    hotels(kit, [[10, -470, 46, 20, 19], [40, -700, 34, 22, 25], [15, 520, 52, 22, 22], [70, 760, 30, 18, 16]]);
  } else if (kind === 'kestrel') {
    // the little terminal and hangar beside the strip, white walls under terracotta
    const walls = 0xe8e2d6, glass = 0x223344;
    kit.box(walls, 390, 64, 0, 0, 0, 12, 6, 34); kit.solid(390, 64, 17, 8, 'the terminal');
    kit.box(I.roof, 390, 64, 0, 6, 0, 13, 1.2, 35);
    kit.box(glass, 390, 64, -6.05, 1, 0, 0.1, 2.4, 26);
    kit.box(walls, 530, 58, 0, 0, 0, 16, 7, 20); kit.solid(530, 58, 12, 8, 'the hangar');
    kit.box(I.roof, 530, 58, 0, 7, 0, 17, 0.8, 21);
    kit.box(0x55585c, 440, 31, 0, -0.52, 0, 38, 0.6, 180);   // the apron
    // cars on the road through the saddle: fly over them, not into them
    cars(kit, [[-252, -92, Math.PI / 2], [-248, -18, -Math.PI / 2], [-252, 47, Math.PI / 2], [-248, 160, -Math.PI / 2]], 921);
    // and the beach past the far end
    const rng = makeRng(922), spots = [];
    for (let v = -330; v <= 330; v += 42) if (Math.abs(v) > 60) spots.push([695 + 6 * rng(), v + 10 * (rng() - 0.5)]);
    beach(kit, spots, 923);
  } else if (kind === 'frostbite') {
    // ice-fishing shacks out on the lake, each a different paint under a dark roof, each solid
    const A = BIOMES.arctic, rng = makeRng(931);
    const hut = new THREE.BoxGeometry(2.4, 2.2, 3.0); hut.translate(0, 1.1, 0);
    const lid = new THREE.CylinderGeometry(0.1, 1.75, 0.7, 4); lid.rotateY(Math.PI / 4); lid.scale(1, 1, 1.25); lid.translate(0, 2.55, 0);
    // the roof's vertex colour is dark, so the instance's paint only tints it
    const geo = coloured([{ geo: hut, colour: [1, 1, 1] }, { geo: lid, colour: lin(A.shackRoof).map((c) => c * 0.5) }]);
    const huts = [];
    for (const [u, v] of [[330, 105], [372, 128], [790, -118], [-420, 170], [-520, 140], [1100, 160], [1480, -140]]) {
      huts.push({ u, v, rot: rng() * 3, colour: A.shacks[Math.floor(rng() * A.shacks.length)] });
      kit.solid(u, v, 2.3, 2.9, 'an ice-fishing shack');
    }
    kit.instanced('shacks', geo, huts, true);
  }
  return kit.finish();
}

// Beach hotels: [u, v, width along the beach, depth, height] in the runway frame. Walls in one
// pastel each, a dark glazed band per floor, a terracotta roof; each one solid. Boxes of the kit.
function hotels(kit, list) {
  const I = BIOMES.island, W = I.walls, rng = makeRng(941);
  const c = new THREE.Color();
  for (const [u, v, w, d, h] of list) {
    c.setHSL(W.h + rng() * W.hVary, W.s + rng() * W.sVary, W.l + rng() * W.lVary);
    kit.box([c.r, c.g, c.b], u, v, 0, 0, 0, w, h, d);
    for (let f = 1; f * 3.1 < h - 1; f++) kit.box(0x1e2a33, u, v, 0, f * 3.1 - 1.4, 0, w - 2, 1.2, d + 0.2);
    kit.box(I.roof, u, v, 0, h, 0, w + 0.6, 0.6, d + 0.6);
    kit.solid(u, v, Math.hypot(w, d) / 2, h + 1, 'a hotel');
  }
}
