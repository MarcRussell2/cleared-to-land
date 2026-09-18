// Vegetation: the instanced forests, the hedgerows and the obstacle trees.
//
// Forests, hedgerows and scattered trees are decoration: nothing collides with them,
// so their placement is yours to change. The one exception is the obstacle trees on
// the bush approaches, which DO collide - see OBSTACLE_TREE below.
//
// Exports (read through terrain-look.js by the world; keep the names and shapes):
//   buildForest(field, opts)        -> { objects: Object3D[], count }
//                                      opts.treeScale (0..1, the quality tier's
//                                      thinning), opts.maxTrees (hard cap),
//                                      opts.detail ('low'|'medium'|'high', default
//                                      WORLD_QUALITY.detail)
//   OBSTACLE_TREE                   { radius, height } in metres at scale 1 - the
//                                      physics sizes the collision cylinder from it
//   buildObstacleTrees(field, list) -> Object3D[] (one per entry of list, in order)
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
//
// Implementation notes:
// Implementation: 2400 m chunks, two locally mixed species per chunk; merged,
// vertex-coloured branch/crown geometry near, two-triangle camera-facing cards far.
// Level of detail is per INSTANCE: each level's vertex shader collapses trees
// outside its range (level 0 within 350 m on high, level 1 to 1500 m, billboards
// beyond), so a tree next to the camera is always a full tree whatever chunk it
// sits in; THREE.LOD is only used to stop drawing a chunk's meshes when the whole
// cell is out of a level's range. Cells remain 600 m / 1200 m: doubling them
// submitted 1.01 M vs 0.238 M mountain triangles at the origin on phone medium
// before frustum culling, so the larger cells were rejected. Culling uses the
// computed sphere's centre offset + radius + range + 15 m stagger allowance,
// including vertical relief, with no hysteresis that could hide in-range trees.
// The billboards are one camera-facing InstancedMesh per species for the whole
// site; the engine subsequently splits these into spatial chunks.
// Density is capped BEFORE tier thinning, preserving survivors and their matrices.
// Caps: 900 trees/chunk plains/coast, 4800 mountain; global defaults 45k/65k.
// Mountain candidates use an 18 m grid, wooded wall to wall below the treeline.
// Triangles per instance: spruce/pine 240/46/2; oak/poplar 282/56/2;
// hedge 38. Small saplings at woodland margins share the broadleaf batches.
// The decorative forest extends to min(treeArea, 5400); farther ground carries
// woodland colour. Hedges switch per instance at 2 km high / 1.4 km medium /
// 0.9 km low to a two-triangle roof strip, preserving the 12 m segments and gates
// to 4 km at every tier. Far trees stay alive to the site edge and haze away.
// Card lighting uses a normal leaning 0.6 up / 0.4 toward the horizontal camera
// direction; real scene lights give the distant canopy sides at low sun.
// Startup: reject density before sampling candidate height once; probe woodland
// margins through a 50 m noise cache, and mountain slopes through a 72 m cache
// (exact normals near the slope threshold). Only visit parcels in the tree region.
// HSL is computed once per species, with scalar instance variation and treeline
// tint shared by all levels. Coastal lean, margin saplings and clearings remain.
// All resources are scene-owned; textures are cached module-wide by species.
// Uniforms of this module start with `vg`; the atmosphere's `at` names are
// injected by the sky and must not be declared here.
import * as THREE from 'three';
import { clamp, smoothstep, lerp, makeRng, noise2 } from '../config.js';
import { mergeGeos } from '../geom.js';
import { PALETTE, FINISH } from './palette.js';
import { parcel } from './world-ground.js';
import { WORLD_QUALITY } from './quality.js';
// The new maps' styles (island, desert, arctic) have forests of their own: world-biomes.js.
import { BIOME_STYLES, biomeForest } from './world-biomes.js';

const SPECIES = ['spruce', 'pine', 'oak', 'poplar'];
const CHUNK = 2400;

// mergeGeos intentionally copies only position/normal/uv: attach colours AFTER
// merging, preserving bark and tier variation in one material / one draw.
function colouredMerge(parts) {
  const geo = mergeGeos(parts.map(p => p.geo));
  const colours = [];
  for (const part of parts) {
    const n = part.geo.index ? part.geo.index.count : part.geo.attributes.position.count;
    const c = new THREE.Color(part.colour);
    for (let i = 0; i < n; i++) colours.push(c.r, c.g, c.b);
    part.geo.dispose();
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geo.computeBoundingSphere();
  return geo;
}

function treeGeometry(species, level) {
  const parts = [], conifer = species === 'spruce' || species === 'pine';
  const pine = species === 'pine', poplar = species === 'poplar';
  const add = (geo, colour = 0xffffff) => parts.push({ geo, colour });
  // All species fit a 20 m model height. Spruce foliage starts at 6.7 m.
  const trunk = new THREE.CylinderGeometry(0.12, 0.42, conifer ? 16 : 12, level ? 4 : 6);
  trunk.translate(0, conifer ? 8 : 6, 0);
  add(trunk, PALETTE.trees.bark);
  if (conifer) {
    const tiers = level ? 3 : 6, sides = level ? 5 : 18;
    for (let j = 0; j < tiers; j++) {
      const t = j / (tiers - 1);
      const bottom = lerp(pine ? 11 : 6.7, 17, t);
      const top = lerp(pine ? 16 : 12.8, 20, t);
      const radius = lerp(pine ? 3.8 : 2.8, 0.55, t);
      const g = new THREE.ConeGeometry(radius, top - bottom, sides);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const a = Math.atan2(p.getZ(i), p.getX(i));
        const k = 1 + 0.12 * Math.sin(a * 3 + j * 1.7);
        p.setXYZ(i, p.getX(i) * k, p.getY(i), p.getZ(i) * k);
      }
      g.rotateY(j * 0.73);
      g.translate(Math.sin(j * 2.1) * 0.28, (bottom + top) / 2, Math.cos(j * 1.6) * 0.18);
      g.computeVertexNormals();
      add(g, new THREE.Color().setScalar(lerp(0.66, 1, t)));
    }
  } else {
    if (!level) {
      for (let j = 0; j < 3; j++) {
        const limb = new THREE.CylinderGeometry(0.12, 0.24, 5, 4);
        limb.rotateZ(0.45 + j * 0.13); limb.rotateY(j * 2.1);
        limb.translate(Math.cos(j * 2.1), 10, Math.sin(j * 2.1));
        add(limb, PALETTE.trees.bark);
      }
    }
    const lobes = level ? 2 : 7;
    for (let j = 0; j < lobes; j++) {
      const crown = level ? new THREE.IcosahedronGeometry(1, 0) : new THREE.SphereGeometry(1, 5, 4);
      const a = j * 2.4, top = j === lobes - 1;
      crown.scale(poplar ? 2.0 : 3.2, poplar ? 4 : 3.4, poplar ? 1.8 : 2.8);
      crown.translate(top ? 0 : Math.cos(a) * (poplar ? 0.8 : 2),
        top ? (poplar ? 16 : 16.6) : 11 + (j % 3) * 1.3,
        top ? 0 : Math.sin(a) * (poplar ? 0.7 : 1.8));
      add(crown, new THREE.Color().setScalar(top ? 1 : 0.72 + (j % 3) * 0.09));
    }
  }
  return colouredMerge(parts);
}

const silhouettes = new Map();
function silhouette(species) {
  if (silhouettes.has(species)) return silhouettes.get(species);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const conifer = species === 'spruce' || species === 'pine';
  const pine = species === 'pine', poplar = species === 'poplar';
  const shade = ctx.createLinearGradient(30, 0, 100, 0);
  shade.addColorStop(0, PALETTE.trees.cardShade);
  shade.addColorStop(0.48, PALETTE.trees.cardMid);
  shade.addColorStop(1, PALETTE.trees.cardLight);
  ctx.fillStyle = PALETTE.trees.cardBark;
  ctx.fillRect(61, 36, 5, 91);
  ctx.fillStyle = shade;
  if (conifer) {
    for (let j = 0; j < 6; j++) {
      const t = j / 5, y = lerp(pine ? 55 : 83, 18, t), r = lerp(pine ? 36 : 28, 5, t);
      ctx.beginPath(); ctx.moveTo(64 + Math.sin(j * 2.1) * 2, j === 5 ? 1 : y - 32);
      for (let k = 0; k <= 12; k++) {
        const x = 64 + r * (1 - k / 6);
        ctx.lineTo(x, y - (k % 2) * 4 - Math.abs(k - 6) * 0.5);
      }
      ctx.closePath(); ctx.fill();
    }
  } else {
    for (let j = 0; j < 9; j++) {
      const a = j * 2.4;
      ctx.beginPath();
      ctx.ellipse(64 + Math.cos(a) * (poplar ? 8 : 21),
        29 + Math.sin(a) * (poplar ? 17 : 12), poplar ? 15 : 23, poplar ? 25 : 23, a * 0.08, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  silhouettes.set(species, map);
  return map;
}

function cardGeometry(species) {
  // A far card stands for a clump as much as a tree, so it is a little wider than
  // the crown it replaces; the forest then reads as a carpet from kilometres away.
  const width = (species === 'oak' ? 11 : species === 'pine' ? 9 : species === 'poplar' ? 6 : 7) * 1.4;
  const g = new THREE.PlaneGeometry(width, 20);
  g.translate(0, 10, 0);
  return g;
}

function material(name, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ ...FINISH.foliage, fog: true, ...extra });
  m.name = 'vegetation/' + name;
  return m;
}

// A level's material: the vertex shader measures each instance's distance to the
// camera and collapses the tree to a point outside [near, far), with a per-instance
// 30 m stagger so a row of trees does not switch level on one frame. Billboards
// (card = true) face the camera, with an up/view blended world normal transformed
// AFTER the instance normal matrix so nonuniform tree scale cannot skew lighting.
// `instanceMatrix` exists because these materials only ever sit on InstancedMeshes.
function rangeMaterial(name, extra, near, far, card = false) {
  const m = material(name, extra);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.vgNear = { value: near };
    shader.uniforms.vgFar = { value: far };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float vgNear, vgFar;
        float vgHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`)
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
        ${card ? `vec3 vgNormalOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec3 vgView = cameraPosition - vgNormalOrigin;
        vgView.y = 0.0;
        vgView /= max(length(vgView), 0.001);
        transformedNormal = mat3(viewMatrix) * normalize(vec3(0.0, 0.6, 0.0) + vgView * 0.4);` : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 vgOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float vgDist = distance(vgOrigin, cameraPosition) + (vgHash(vgOrigin.xz) - 0.5) * 30.0;
        float vgKeep = step(vgNear, vgDist) * step(vgDist, vgFar);
        ${card ? `vec3 vgTo = cameraPosition - vgOrigin;
        vec3 vgRight = vec3(vgTo.z, 0.0, -vgTo.x) / max(length(vgTo.xz), 0.001);
        transformed = vgRight * position.x + vec3(0.0, position.y, 0.0);` : ''}
        transformed *= vgKeep;`);
  };
  m.customProgramCacheKey = () => `ctl-vegetation-v2-${card ? 'card' : 'mesh'}`;
  return m;
}

function hedgeGeometry() {
  // Five cross sections form a lumpy, bevelled roof: 38 triangles, 12 m long.
  const vertices = [], indices = [];
  for (let i = 0; i < 5; i++) {
    const x = -6 + i * 3, roof = 2 + 0.18 * Math.sin(i * 2.1);
    vertices.push(x, -0.25, -1.5, x, roof - 0.45, -1.5, x, roof, 0,
      x, roof - 0.45, 1.5, x, -0.25, 1.5);
  }
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const a = i * 5 + j, b = a + 5;
    indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  indices.push(0, 2, 1, 0, 4, 2, 4, 3, 2, 20, 21, 22, 20, 22, 24, 24, 22, 23);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setIndex(indices); g.computeVertexNormals();
  const merged = mergeGeos([g]), colours = [];
  const p = merged.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const c = new THREE.Color(p.getY(i) > 1.7 ? PALETTE.trees.hedgeTop : PALETTE.trees.hedge);
    colours.push(c.r, c.g, c.b);
  }
  merged.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  return merged;
}

// Single seeded walk; all candidate appearance draws precede tier rejection.
// Per-chunk reservoir ranks are independent of treeScale AND maxTrees, avoiding
// the old cap-induced sweep of dense trees from just one side of the landscape.
export function buildForest(field, opts = {}) {
  if (BIOME_STYLES.has(field.style)) return biomeForest(field, opts);
  const objects = [];
  const treeScale = clamp(opts.treeScale ?? 1, 0, 1);
  // Mountain valleys are wooded wall to wall and their far trees are cheap cards.
  const maxTrees = Math.max(0, Math.floor(opts.maxTrees ?? (field.style === 'mountain' ? 65000 : 45000)));
  if (field.treeDensity <= 0 || !treeScale || !maxTrees || field.style === 'sea') return { objects, count: 0 };
  const detail = opts.detail || WORLD_QUALITY.detail;
  const high = detail === 'high', low = detail === 'low';
  const factor = high ? 1 : low ? 0.45 : 0.7;
  const mountain = field.style === 'mountain';
  const area = Math.min(field.treeArea, 5400), rng = makeRng(field.seed * 101 + 7);
  const chunks = new Map(), normal = new THREE.Vector3();
  // Only margin probes use the coarse cache; the woodland mask itself stays exact.
  const gridStep = 50, gridOrigin = Math.ceil(area / gridStep) + 3;
  const gridWidth = gridOrigin * 2 + 1;
  const marginNoise = new Float32Array(gridWidth * gridWidth).fill(NaN);
  const probe = (x, z) => {
    const ix = Math.round(x / gridStep), iz = Math.round(z / gridStep);
    const key = (ix + gridOrigin) * gridWidth + iz + gridOrigin;
    if (Number.isNaN(marginNoise[key])) marginNoise[key] = field.forestNoise(ix * gridStep, iz * gridStep);
    return marginNoise[key];
  };
  const colours = SPECIES.map(species => {
    const c = species === 'spruce' || species === 'pine' ? PALETTE.trees.conifer : PALETTE.trees.broadleaf;
    return new THREE.Color().setHSL(c.h + (species === 'pine' ? -0.025 : 0), c.s, c.l + c.lVary * 0.5);
  });
  const treelineColour = new THREE.Color(PALETTE.trees.treeline);
  const treeColour = new THREE.Color();
  // Slope is a broad landform test. Cache on 72 m centres, but resolve the exact
  // normal near the rejection threshold so cliff edges still remain unwooded.
  const slopeStep = 72, slopeOrigin = Math.ceil(area / slopeStep) + 1;
  const slopeWidth = slopeOrigin * 2 + 1;
  const slopes = new Float32Array(slopeWidth * slopeWidth).fill(NaN);
  const slopeAt = (x, z) => {
    if (!mountain) return field.normal(x, z, normal).y;
    const ix = Math.round(x / slopeStep), iz = Math.round(z / slopeStep);
    const key = (ix + slopeOrigin) * slopeWidth + iz + slopeOrigin;
    if (Number.isNaN(slopes[key])) slopes[key] = field.normal(ix * slopeStep, iz * slopeStep, normal).y;
    const y = slopes[key];
    return Math.abs(y - 0.65) < 0.08 ? field.normal(x, z, normal).y : y;
  };
  const chunkAt = (x, z) => {
    const ix = Math.floor(x / CHUNK), iz = Math.floor(z / CHUNK), key = ix + ',' + iz;
    if (!chunks.has(key)) {
      const cx = (ix + 0.5) * CHUNK, cz = (iz + 0.5) * CHUNK;
      chunks.set(key, { x: cx, z: cz, y: field.height(cx, cz), trees: [], hedges: [] });
    }
    return chunks.get(key);
  };
  const addTree = (x, z, h, chance, scale, angle, tier, rank, hedge = false) => {
    const forest = mountain ? 1 : field.forestNoise(x, z);
    const line = field.snowLine - 280 + noise2(x / 450, z / 450, field.seed + 306) * 100;
    if (field.nearFlat(x, z, 18)) return;
    let edge = 0;
    if (forest < 0.28 && !hedge) {
      if (probe(x + 50, z) > 0.28 || probe(x - 50, z) > 0.28 ||
          probe(x, z + 50) > 0.28 || probe(x, z - 50) > 0.28) edge = 0.16;
      else if (probe(x + 80, z) > 0.28 || probe(x - 80, z) > 0.28 ||
          probe(x, z + 80) > 0.28 || probe(x, z - 80) > 0.28) edge = 0.05;
    }
    const clearing = smoothstep(0.55, 0.72, noise2(x / 160, z / 160, field.seed + 609));
    const outerFade = 1 - smoothstep(area - 800, area, Math.max(Math.abs(x), Math.abs(z)));
    // Mountain valleys are wooded everywhere below the treeline, thinning near the
    // river and broken by clearings; on the plains and the coast woodland follows
    // field.forestNoise (the ground darkens its floor from the same field) with
    // singles scattered along the margins.
    const riverGap = mountain ? smoothstep(45, 120, Math.abs(x - field.riverAxis(z))) : 1;
    const wooded = mountain ? field.treeDensity * (0.55 + 0.45 * riverGap) * (1 - clearing * 0.8)
      : (forest >= 0.28 ? field.treeDensity * 1.4 * (1 - clearing) : edge);
    const accept = (hedge ? 1 : wooded) * outerFade;
    if (chance > accept) return;
    h ??= field.height(x, z); // exactly one centre sample, reused by hedge trees
    const alpine = smoothstep(line - 240, line, h);
    if (h >= line || chance > accept * (1 - alpine) ||
        (field.waterLevel != null && h < field.waterLevel + 3)) return;
    if (slopeAt(x, z) < 0.65) return;
    const chunk = chunkAt(x, z);
    // Two species per chunk limits draw calls while the combinations change across
    // the landscape. River-floor broadleaves replace the second conifer species.
    const mix = noise2(chunk.x / 1000, chunk.z / 1000, field.seed + 712);
    const river = mountain && Math.abs(x - field.riverAxis(z)) < 180 && h < field.elevation + 85;
    let species = mountain ? (river ? 'poplar' : 'spruce')
      : (scale < (field.style === 'coast' ? 0.60 : 0.16) ? 'pine' : mix > 0.25 ? 'poplar' : 'oak');
    if (hedge) species = mix > 0.25 ? 'poplar' : 'oak';
    const understory = !mountain && !hedge && forest < 0.32 && scale < 0.2;
    if (understory) species = mix > 0.25 ? 'poplar' : 'oak';
    const height = understory ? lerp(2.5, 4.5, scale / 0.2)
      : (species === 'spruce' || species === 'pine' ? lerp(10, 28, scale) : lerp(8, 22, scale)) * lerp(1, 0.48, alpine);
    chunk.trees.push({ x, z, h, height, angle, tier, rank, species, alpine,
      lean: field.style === 'coast' && field.waterLevel != null ? (1 - smoothstep(5, 65, h - field.waterLevel)) * 0.12 : 0 });
  };
  const cell = mountain ? 18 : 26;
  for (let x = -area; x < area; x += cell) for (let z = -area; z < area; z += cell) {
    const px = x + rng() * cell, pz = z + rng() * cell;
    const chance = rng(), scale = rng(), angle = rng() * Math.PI * 2, tier = rng(), rank = rng();
    addTree(px, pz, undefined, chance, scale, angle, tier, rank);
  }

  // Follow the shared parcel grid exactly in its orthonormal coordinates.
  // 12 m segments overlap slightly; whole 120-192 m runs thin together, so
  // quality reduction never turns a hedge into disconnected green beads.
  if (!mountain) {
    const segment = (u, v, along, run) => {
      const x = u * 0.96 - v * 0.28, z = u * 0.28 + v * 0.96;
      const chance = rng(), scale = rng(), angle = rng() * Math.PI * 2, tier = rng(), rank = rng();
      if (Math.abs(x) >= area || Math.abs(z) >= area) return;
      const p = parcel(x, z);
      const gatePeriod = 120 + 12 * (Math.abs(run) % 7);
      if (((along % gatePeriod) + gatePeriod) % gatePeriod < 12) return;
      if (p.edge >= 8 || field.forestNoise(x, z) >= 0.22) return;
      const h = field.height(x, z);
      if (h - field.elevation > 180 ||
          field.nearFlat(x, z, 26) || (field.waterLevel != null && h < field.waterLevel + 3)) return;
      const dx = Math.cos(p.angle) * 6, dz = -Math.sin(p.angle) * 6;
      if (field.nearFlat(x + dx, z + dz, 22) || field.nearFlat(x - dx, z - dz, 22)) return;
      const h0 = field.height(x - dx, z - dz), h1 = field.height(x + dx, z + dz);
      if (Math.abs(h1 - h0) > 3) return;
      const chunk = chunkAt(x, z);
      const runKeep = (noise2(run * 3.1, Math.floor(along / gatePeriod) * 2.7, field.seed + 812) + 1) / 2;
      if (runKeep < treeScale) chunk.hedges.push({ x, z, h: Math.min(h0, h1), angle: p.angle, rise: (h1 - h0) / 12 });
      if (Math.abs(Math.round(along / 12)) % (5 + Math.abs(run) % 6) === 0)
        addTree(x, z, h, chance, scale, angle, tier, rank, true);
    };
    const parcelReach = area * 1.24 + 12;
    const rows = Math.ceil(parcelReach / 310);
    for (let row = -rows; row <= rows; row++) {
      const v = row * 310;
      for (let u = -Math.ceil(parcelReach / 12) * 12; u < parcelReach; u += 12) segment(u + 6, v, u, row);
      for (let col = Math.floor(-parcelReach / 420 + row * 0.37); col <= Math.ceil(parcelReach / 420 + row * 0.37); col++) {
        const u = (col - row * 0.37) * 420;
        for (let dv = 0; dv < 310; dv += 12)
          segment(u, v + dv + 6, dv, row * 53 + col);
      }
    }
  }
  // Ranges per tier, metres from the camera; billboards take over beyond `far`.
  const near = high ? 350 : low ? 120 : 220, far = high ? 1500 : low ? 500 : 900;
  const resources = new Map();
  const getResources = (species) => {
    if (!resources.has(species)) resources.set(species, {
      geos: [treeGeometry(species, 0), treeGeometry(species, 1)],
      mats: [rangeMaterial(species + '-lod0', { vertexColors: true }, 0, near),
        rangeMaterial(species + '-lod1', { vertexColors: true }, near, far)],
    });
    return resources.get(species);
  };
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion(), euler = new THREE.Euler();
  const instance = (geo, mat, entries, origin, hedge, shadow, card = false) => {
    const mesh = new THREE.InstancedMesh(geo, mat, entries.length);
    entries.forEach((t, i) => {
      position.set(t.x - origin.x, t.h - origin.y, t.z - origin.z);
      if (hedge) {
        scale.set(1.025, 1 + Math.abs(t.rise) * 3, 1);
        euler.set(0, t.angle, 0);
      } else {
        const sc = t.height / 20, w = sc * (0.86 + t.rank * 0.28);
        scale.set(w, sc, card ? w : sc);
        // The card is turned to the camera by its shader, so it carries no rotation.
        euler.set(0, card ? 0 : t.angle, card ? 0 : t.lean, 'ZYX');
      }
      rotation.setFromEuler(euler); matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(i, matrix);
      if (!hedge) {
        treeColour.copy(colours[SPECIES.indexOf(t.species)])
          .multiplyScalar(0.82 + t.height / 28 * 0.25 + t.rank * 0.11)
          .lerp(treelineColour, t.alpine * 0.65);
        mesh.setColorAt(i, treeColour);
      }
    });
    mesh.castShadow = shadow; mesh.receiveShadow = false;
    mesh.computeBoundingSphere();
    return mesh;
  };
  let count = 0;
  const candidates = [];
  for (const chunk of chunks.values()) {
    chunk.trees.sort((a, b) => a.rank - b.rank);
    candidates.push(...chunk.trees.slice(0, mountain ? 4800 : 900).map((t) => ({ t, chunk })));
    chunk.trees = [];
  }
  candidates.sort((a, b) => a.t.rank - b.t.rank);
  // Cap before quality rejection: lower treeScale is strictly a subset.
  for (const { t, chunk } of candidates.slice(0, maxTrees)) if (t.tier <= treeScale) {
    chunk.trees.push(t); count++;
  }
  // A chunk's level meshes are drawn only while the chunk can hold a tree in that
  // level's range (THREE.LOD measures the chunk centre); inside a drawn mesh the
  // shader keeps exactly the instances in range.
  const cull = (mesh, name, cell, radius) => {
    const lod = new THREE.LOD();
    lod.name = name;
    lod.position.set(cell.x, cell.y, cell.z);
    lod.addLevel(mesh, 0);
    lod.addLevel(new THREE.Group(), radius + mesh.boundingSphere.center.length() + mesh.boundingSphere.radius + 15, 0);
    objects.push(lod);
  };
  // The level meshes live in cells smaller than the chunk (600 m for level 0,
  // 1200 m for level 1), so that only trees which can actually be in a level's
  // range are submitted at all; the rest of the chunk costs nothing.
  const cells = (entries, size) => {
    const map = new Map();
    for (const t of entries) {
      const ix = Math.floor(t.x / size), iz = Math.floor(t.z / size), key = ix + ',' + iz;
      if (!map.has(key)) { const cx = (ix + 0.5) * size, cz = (iz + 0.5) * size; map.set(key, { x: cx, z: cz, y: field.height(cx, cz), size, list: [] }); }
      map.get(key).list.push(t);
    }
    return map.values();
  };
  const farTrees = new Map();
  for (const chunk of chunks.values()) {
    for (const species of SPECIES) {
      const entries = chunk.trees.filter((t) => t.species === species);
      if (!entries.length) continue;
      const r = getResources(species);
      for (const cell of cells(entries, 600)) {
        cull(instance(r.geos[0], r.mats[0], cell.list, cell, false, !low), 'vegetation/' + species + '/lod0', cell, near);
      }
      for (const cell of cells(entries, 1200)) {
        cull(instance(r.geos[1], r.mats[1], cell.list, cell, false, false), 'vegetation/' + species + '/lod1', cell, far);
      }
      if (!farTrees.has(species)) farTrees.set(species, []);
      farTrees.get(species).push(...entries);
    }
  }
  // The far forest: one camera-facing card per tree, one draw per species for the
  // whole site, alive from `far` out to the horizon.
  const origin = new THREE.Vector3(0, 0, 0);
  for (const [species, entries] of farTrees) {
    const mat = rangeMaterial(species + '-billboard', { map: silhouette(species), alphaTest: 0.5, side: THREE.DoubleSide }, far, 1e6, true);
    const mesh = instance(cardGeometry(species), mat, entries, origin, false, false, true);
    mesh.name = 'vegetation/' + species + '/cards';
    objects.push(mesh);
  }
  let hedgeGeo, hedgeMat, hedgeFarGeo, hedgeFarMat;
  for (const chunk of chunks.values()) {
    if (chunk.hedges.length) {
      hedgeGeo ??= hedgeGeometry();
      hedgeMat ??= rangeMaterial('hedge', { vertexColors: true }, 0, 2000 * factor);
      if (!hedgeFarGeo) {
        hedgeFarGeo = new THREE.PlaneGeometry(12, 3);
        hedgeFarGeo.rotateX(-Math.PI / 2);
        hedgeFarGeo.translate(0, 1.8, 0);
        hedgeFarGeo.computeBoundingSphere();
        hedgeFarMat = rangeMaterial('hedge-far', { color: PALETTE.trees.hedgeTop, side: THREE.DoubleSide }, 2000 * factor, 4000);
      }
      cull(instance(hedgeGeo, hedgeMat, chunk.hedges, chunk, true, false),
        'vegetation/hedges', chunk, 2000 * factor);
      cull(instance(hedgeFarGeo, hedgeFarMat, chunk.hedges, chunk, true, false),
        'vegetation/hedges-far', chunk, 4000);
    }
  }
  return { objects, count };
}

// The collision cylinder encloses the LOD0 spruce, including its irregular whorls.
// At scale 1 the visible tree is 25 m tall; its lower 8.375 m is bare trunk.
export const OBSTACLE_TREE = { radius: 4.04, height: 25 };

export function buildObstacleTrees(field, list) {
  const geo = treeGeometry('spruce', 0);
  geo.scale(1.25, 1.25, 1.25);
  const mat = material('obstacle-spruce-lod0', { color: PALETTE.trees.obstacle, vertexColors: true });
  const rng = makeRng(field.seed * 101 + 903);
  return list.map(t => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(t.x, field.height(t.x, t.z), t.z);
    mesh.scale.setScalar(t.scale ?? 1);
    mesh.rotation.y = rng() * Math.PI * 2;
    mesh.castShadow = true;
    return mesh;
  });
}
