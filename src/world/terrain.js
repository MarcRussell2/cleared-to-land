// Procedural terrain: the analytic heightfield (deterministic), the areas flattened
// around runways, the obstacle list and the ground query the physics calls.
//
// What the terrain LOOKS like is not here: the mesh, its colours, the forests, the
// rocks, the roads and the villages are all built by src/art/terrain-look.js. This
// file decides where things are and what they do; that one decides how they look.
import * as THREE from 'three';
import { fbm2, noise2, clamp, smoothstep, lerp, DEG, headingToVec } from '../config.js';
import { makeWater } from '../art/sky.js';
import * as look from '../art/terrain-look.js';
import { chunkInstanced, freeze } from '../geom.js';

export class Terrain {
  constructor(opts = {}) {
    this.size = opts.size || 24000;
    this.res = opts.res || 360;
    this.seed = opts.seed || 1;
    this.style = opts.style || 'plains';
    this.waterLevel = opts.waterLevel ?? null;
    this.elevation = opts.elevation || 0;
    this.flats = (opts.flats || []).map((f) => {
      const dir = headingToVec(f.heading * DEG, new THREE.Vector3());
      return { ...f, dir, right: new THREE.Vector3(-dir.z, 0, dir.x) };
    });
    this.obstacles = opts.obstacles ? opts.obstacles.slice() : [];
    this.treeDensity = opts.trees ?? 0.5;
    this.treeArea = opts.treeArea || 9000;
    this.snowLine = opts.snowLine || 1400;
    this.coastX = opts.coastX ?? 2500;
    this.valleyWidth = opts.valleyWidth || 900;
    this.group = new THREE.Group();
    this.tmpN = new THREE.Vector3();
    this.treeCount = 0;
  }

  riverAxis(z) { return 500 * fbm2(z / 3500, this.seed * 0.11, 2, this.seed + 3) + 260 + 80 * fbm2(z / 700, 0, 2, this.seed + 8); }

  rawHeight(x, z) {
    const s = this.seed;
    const e = this.elevation;
    switch (this.style) {
      case 'sea':
        return -25;
      case 'coast': {
        const coast = this.coastX + 700 * fbm2(z / 2500 + 3.1, s * 0.37, 3, s + 9);
        const d = coast - x; // positive = inland
        const land = smoothstep(-150, 900, d);
        const hills = (35 + 60 * smoothstep(1500, 6000, d)) * (0.5 + 0.5 * fbm2(x / 2200, z / 2200, 4, s));
        const detail = 6 * fbm2(x / 400, z / 400, 3, s + 5) + 1.2 * fbm2(x / 60, z / 60, 2, s + 6);
        const far = smoothstep(7000, 13000, Math.hypot(x, z)) * (350 + 450 * Math.max(0, fbm2(x / 5000, z / 5000, 3, s + 21)));
        const seabed = -18 - 25 * smoothstep(-150, -1800, d);
        return lerp(seabed, e + hills + detail + far, land);
      }
      case 'mountain': {
        const axis = 500 * fbm2(z / 3500, s * 0.11, 2, s + 3);
        const dd = Math.abs(x - axis);
        const wall = smoothstep(this.valleyWidth * 0.5, this.valleyWidth * 0.5 + 2200, dd);
        const ridge = 1500 * (0.55 + 0.45 * fbm2(x / 1800, z / 1800, 4, s + 2));
        const floor = 12 * fbm2(x / 500, z / 500, 3, s + 7) + 1.5 * fbm2(x / 70, z / 70, 2, s + 4) + 0.03 * Math.abs(dd);
        const boxEnd = smoothstep(-2500, -6500, z) * 900; // valley closes to the north
        const river = 1 - smoothstep(0, 70, Math.abs(x - this.riverAxis(z)));
        return e + floor + wall * ridge + boxEnd - 4.5 * river;
      }
      default: {
        const hills = 22 * fbm2(x / 3000, z / 3000, 4, s) + 7 * fbm2(x / 700, z / 700, 3, s + 5) + 1.2 * fbm2(x / 80, z / 80, 2, s + 6);
        const far = smoothstep(8000, 14000, Math.hypot(x, z)) * (300 + 500 * Math.max(0, fbm2(x / 5000, z / 5000, 3, s + 21)));
        return e + hills + far;
      }
    }
  }

  height(x, z) {
    let h = this.rawHeight(x, z);
    for (const f of this.flats) {
      const dx = x - f.x, dz = z - f.z;
      const u = dx * f.dir.x + dz * f.dir.z;
      const v = dx * f.right.x + dz * f.right.z;
      const outU = Math.max(0, Math.abs(u) - f.halfLength);
      const outV = Math.max(0, Math.abs(v) - f.halfWidth);
      const out = Math.hypot(outU, outV);
      if (out < f.margin) {
        const w = 1 - smoothstep(0, f.margin, out);
        const hf = f.elevation + (f.slope || 0) * clamp(u, -f.halfLength, f.halfLength);
        h = lerp(h, hf, w);
      }
    }
    return h;
  }

  normal(x, z, out) {
    const d = 1.5;
    const hx = this.height(x + d, z) - this.height(x - d, z);
    const hz = this.height(x, z + d) - this.height(x, z - d);
    out.set(-hx / (2 * d), 1, -hz / (2 * d)).normalize();
    return out;
  }

  isWater(y) { return this.waterLevel != null && y < this.waterLevel; }

  // Ground query: fills out {y, n, mu, kind, vel, rough}
  ground(x, z, out) {
    for (const o of this.obstacles) {
      const dx = x - o.x, dz = z - o.z;
      if (dx * dx + dz * dz < o.r * o.r) {
        out.y = o.y;
        out.n.set(0, 1, 0);
        out.mu = 0.9;
        out.kind = o.kind || 'obstacle';
        out.name = o.name || 'a tree';
        out.vel.set(0, 0, 0);
        out.rough = 0;
        return;
      }
    }
    let y = this.height(x, z);
    if (this.waterLevel != null && y < this.waterLevel - 0.05) {
      out.y = this.waterLevel;
      out.n.set(0, 1, 0);
      out.mu = 0.1; out.kind = 'water'; out.rough = 0;
      out.vel.set(0, 0, 0);
      return;
    }
    out.y = y;
    this.normal(x, z, out.n);
    out.mu = 0.55;
    out.kind = 'grass';
    out.rough = 0.8;
    out.vel.set(0, 0, 0);
  }

  // The two noise fields the look reads to decide where farmland and woodland go.
  fieldNoise(x, z) { return noise2(x / 350, z / 350, this.seed + 55); }
  forestNoise(x, z) { return fbm2(x / 900, z / 900, 3, this.seed + 77); }

  // True inside a runway's flattened area (plus a margin): nothing gets scattered there.
  nearFlat(x, z, margin) {
    for (const f of this.flats) {
      const dx = x - f.x, dz = z - f.z;
      const u = dx * f.dir.x + dz * f.dir.z;
      const v = dx * f.right.x + dz * f.right.z;
      const m = f.treeMargin ?? f.margin * 0.6;
      if (Math.abs(u) < f.halfLength + m + margin && Math.abs(v) < f.halfWidth + m * 0.5 + margin) return true;
    }
    return false;
  }

  build(scene, opts = {}) {
    this.mesh = look.buildGround(this);
    this.group.add(this.mesh);
    if (this.waterLevel != null) {
      const water = makeWater(this.size * 1.5, this.waterLevel, opts.sun);
      this.water = water;
      this.group.add(water.mesh);
    }
    const forest = look.buildForest(this, opts);
    this.treeCount = forest.count;
    // Performance (docs/PERF.md): the art bench hands back whole-county instanced meshes; split
    // them into spatial chunks so the camera and the shadow camera can cull them. Same trees,
    // same places, same colours.
    for (const o of forest.objects) for (const c of (o.isInstancedMesh ? chunkInstanced(o) : [o])) this.group.add(c);
    if (this.style === 'mountain') for (const c of chunkInstanced(look.buildRocks(this))) this.group.add(c);
    scene.add(this.group);
    freeze(this.group);   // nothing on the ground ever moves: matrices composed once
    return this.group;
  }

  addRoad(ax, az, bx, bz, width = 7) {
    const m = look.buildRoad(this, ax, az, bx, bz, width);
    this.group.add(m);
    freeze(m);
    return m;
  }

  addVillage(cx, cz, count = 120, spread = 380) {
    for (const o of look.buildVillage(this, cx, cz, count, spread)) { this.group.add(o); freeze(o); }
  }

  // Big single trees that count as obstacles (bush strips). The art draws them; the
  // collision cylinder is sized from what the art says it drew.
  addObstacleTrees(list) {
    const meshes = look.buildObstacleTrees(this, list);
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      this.group.add(meshes[i]);
      freeze(meshes[i]);
      const sc = t.scale || 1;
      this.obstacles.push({
        x: t.x, z: t.z,
        r: look.OBSTACLE_TREE.radius * sc,
        y: this.height(t.x, t.z) + look.OBSTACLE_TREE.height * sc,
        name: 'a tree', kind: 'obstacle',
      });
    }
  }
}
