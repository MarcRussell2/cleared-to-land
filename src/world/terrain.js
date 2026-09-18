// Procedural terrain: the analytic heightfield (deterministic), the areas flattened
// around runways, the obstacle list and the ground query the physics calls.
//
// What the terrain LOOKS like is not here: the mesh, its colours, the forests, the
// rocks, the roads and the villages are all built by src/art/terrain-look.js. This
// file decides where things are and what they do; that one decides how they look.
//
// Styles: 'plains' (the default), 'coast', 'mountain', 'sea', and three from the missions
// expansion's new maps (2026-09-17; src/missions/sites.js has the sites that use them):
//   'island'  land with a radial falloff to a shallow shelf and the seabed (sea level is 0): a
//             tropical island, or a big one with a straight coast by the runway. Ridges, peaks and
//             "lows" are placed in the runway frame, so a ridge sits exactly where a mission needs it.
//   'arctic'  snowy hills round a frozen lake. The lake is solid (ice, not water): you can land on it.
//   'desert'  canyon country: a desert floor, buttes and mesas, and the mesa the strip sits on.
// Their parameters are the objects `island`, `arctic` and `desert` in site.terrain (each one is
// documented at its height function below), plus `rwFrame` {x, z, heading}: runway 0's threshold and
// heading, the frame (u metres along the runway, v to its right) the features are placed in. A site
// may also hand `runwayFlats`: explicit flats with a blend margin per side (m0 at the approach end,
// m1 at the far end, mv at the sides) instead of the airport/bush defaults from siteFlats(), which
// would level a ridge, a cliff or a beach the map needs right at the threshold. The four original
// styles, and every height they produce, are exactly as they were (tools/test-maps.mjs checks it).
import * as THREE from 'three';
import { fbm2, noise2, clamp, smoothstep, lerp, DEG, headingToVec } from '../config.js';
import { makeWater } from '../art/sky.js';
import * as look from '../art/terrain-look.js';
import { chunkInstanced, freeze } from '../geom.js';

// Defaults for a new-style site that gives no parameters of its own (free-form use; every site in
// src/missions/sites.js sets its own).
const ISLAND_DEFAULT = { x: 0, z: 800, rx: 2600, rz: 1600, wobble: 0.14, beach: 45, low: 14, hills: 150, shelf: 500, deep: 26 };
const ARCTIC_DEFAULT = { lake: { u: 0, halfLength: 3000, halfWidth: 700, wobble: 0.15 }, hills: 320 };
const DESERT_DEFAULT = { floor: -150, butte: 170 };

export class Terrain {
  constructor(opts = {}) {
    this.size = opts.size || 24000;
    this.res = opts.res || 360;
    this.seed = opts.seed || 1;
    this.style = opts.style || 'plains';
    this.waterLevel = opts.waterLevel ?? null;
    this.elevation = opts.elevation || 0;
    // (the new maps hand their own, explicit flats: see the header)
    this.flats = (opts.runwayFlats || opts.flats || []).map((f) => {
      const dir = headingToVec(f.heading * DEG, new THREE.Vector3());
      return { ...f, dir, right: new THREE.Vector3(-dir.z, 0, dir.x) };
    });
    this.obstacles = opts.obstacles ? opts.obstacles.slice() : [];
    // Circles ({x, z, r}) where no clutter grows: a mission course's towers, bridges and pylons (src/world/obstacles.js).
    this.keepOut = opts.keepOut ? opts.keepOut.slice() : [];
    this.treeDensity = opts.trees ?? 0.5;
    this.treeArea = opts.treeArea || 9000;
    this.snowLine = opts.snowLine || 1400;
    this.coastX = opts.coastX ?? 2500;
    this.valleyWidth = opts.valleyWidth || 900;
    // The new maps' parameters (null for every other style) and the runway frame they are placed in.
    this.island = this.style === 'island' ? { ...ISLAND_DEFAULT, ...(opts.island || {}) } : null;
    this.arctic = this.style === 'arctic' ? { ...ARCTIC_DEFAULT, ...(opts.arctic || {}) } : null;
    this.desert = this.style === 'desert' ? { ...DESERT_DEFAULT, ...(opts.desert || {}) } : null;
    const F = opts.rwFrame || {};
    const fh = (F.heading || 0) * DEG;
    this.frame = { x: F.x || 0, z: F.z || 0, dx: Math.sin(fh), dz: -Math.cos(fh) };
    this._u = 0; this._v = 0;
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
      case 'island': return this.islandHeight(x, z);
      case 'arctic': return this.arcticHeight(x, z);
      case 'desert': return this.desertHeight(x, z);
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
      if (f.m0 != null) {
        // an explicit flat (the new maps): its own blend margin at each end and at the sides
        const q = Math.hypot(outU / (u < 0 ? f.m0 : f.m1), outV / f.mv);
        if (q < 1) h = lerp(h, f.elevation + (f.slope || 0) * clamp(u, -f.halfLength, f.halfLength), 1 - smoothstep(0, 1, q));
        continue;
      }
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
    if (this.island || this.arctic || this.desert) this.surfaceOf(x, z, y, out);
  }

  // What the ground off the runway is made of on the new maps (the original styles are all grass).
  // Friction as for the runway surfaces of the same name (world/airport.js).
  surfaceOf(x, z, y, out) {
    if (this.arctic) {
      if (this.lakeShore(x, z) < 0) { out.kind = 'ice'; out.mu = 0.12; out.rough = 0.05; }
      else { out.kind = 'snow'; out.mu = 0.3; out.rough = 0.5; }
    } else if (this.desert) {
      if (y < this.elevation + (this.desert.floor ?? -150) + 20) { out.kind = 'sand'; out.mu = 0.5; out.rough = 0.6; }
      else { out.kind = 'dirt'; out.mu = 0.55; out.rough = 0.7; }
    } else if (this.island && y < 3.4) { out.kind = 'sand'; out.mu = 0.5; out.rough = 0.6; }
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
    for (const k of this.keepOut) { const dx = x - k.x, dz = z - k.z, r = k.r + margin; if (dx * dx + dz * dz < r * r) return true; }
    return false;
  }

  // ------------------------------------------------------------------ the new maps (2026-09-17)
  // Sets this._u (metres along runway 0 from its threshold; negative out on the approach) and this._v
  // (metres to the right of its centreline) for the world point (x, z). No allocation: it runs per sample.
  toFrame(x, z) {
    const F = this.frame, dx = x - F.x, dz = z - F.z;
    this._u = dx * F.dx + dz * F.dz;
    this._v = -dx * F.dz + dz * F.dx;
  }

  // "Lows": runway-frame rectangles {u0, u1, half, fade, max, keep} where the land is held down near `max`
  // metres (the valley an approach flies up, the level ground round a runway), fading out over `fade`
  // metres. `keep` (default 0.1) is the share of the relief above max that survives, so a low rolls
  // gently instead of being planed flat. Call after toFrame().
  applyLows(list, h) {
    for (const L of list) {
      const du = Math.max(L.u0 - this._u, this._u - L.u1, 0), dv = Math.max(Math.abs(this._v) - L.half, 0);
      const d = Math.hypot(du, dv);
      if (d < L.fade && h > L.max) h = lerp(h, L.max + (h - L.max) * (L.keep ?? 0.1), 1 - smoothstep(0, L.fade, d));
    }
    return h;
  }

  // 'island'. Heights are metres above sea level (the site's waterLevel is 0). site.terrain.island = {
  //   x, z, rx, rz   the island's centre (world) and radii; the coast is where the wobbled ellipse is 1
  //   wobble         0..0.3: how far the coast wanders, as a fraction of the radius
  //   calm           {x, z, r, fade}: the coast holds still within r of this point (a beach a map needs)
  //   beach          the beach's width: sand from the waterline up to 2.6 m, a berm behind it to 4.2 m
  //   low, hills     the lowland's rise and the height of the ridged hills further inland (m)
  //   peaks          [{x, z, r, h}] Gaussian hills;  far: [{x, z, r, h}] other islands on the horizon
  //   ridges         [{u, crest, side, half, wIn, wOut}] a ridge across the runway frame at u: `crest`
  //                  metres high at v = 0 (a saddle), rising to `side` beyond |v| = half; its flank is
  //                  wIn metres wide toward the threshold and wOut away from it
  //   lows           [{u0, u1, half, fade, max}], see applyLows()
  //   shelf, deep    the shallow shelf's width (m; turquoise water) and the seabed's depth beyond it
  // }
  islandHeight(x, z) {
    const I = this.island, s = this.seed;
    const d = this.coastDistance(x, z);
    let h;
    if (d > 0) {
      const bw = I.beach ?? 45;
      h = 2.6 * smoothstep(0, bw, d) + 1.6 * smoothstep(bw, bw + 25, d)
        + (I.low ?? 14) * smoothstep(bw + 20, bw + 520, d) * (0.6 + 0.4 * fbm2(x / 900, z / 900, 2, s + 4));
      const ridged = 1 - Math.abs(fbm2(x / 1700, z / 1700, 4, s + 2));
      h += (I.hills ?? 150) * smoothstep(bw + 60, bw + 1000, d) * ridged * ridged;
      if (I.peaks) for (const p of I.peaks) {
        const q = ((x - p.x) ** 2 + (z - p.z) ** 2) / (p.r * p.r);
        if (q < 9) h += p.h * Math.exp(-q) * smoothstep(0, 150, d);
      }
      h += (3 * fbm2(x / 230, z / 230, 3, s + 5) + 0.8 * fbm2(x / 55, z / 55, 2, s + 6)) * smoothstep(bw + 10, bw + 160, d);
      if (I.lows) h = this.applyLows(I.lows, h);
      if (I.ridges) for (const R of I.ridges) {
        const du = this._u - R.u, w = du > 0 ? R.wIn : R.wOut;
        if (Math.abs(du) > 3 * w) continue;
        const top = R.crest + (R.side - R.crest) * smoothstep(R.half, R.half * 2.6, Math.abs(this._v));
        const rh = (top + 1.2 * fbm2(x / 90, z / 90, 2, s + 12)) * Math.exp(-((du / w) ** 2)) * smoothstep(0, 80, d);
        if (rh > h) h = rh;
      }
    } else {
      const off = -d, shelf = I.shelf ?? 500;
      h = -2.8 * smoothstep(0, 70, off) - 5 * smoothstep(50, shelf, off)
        + 1.8 * fbm2(x / 160, z / 160, 3, s + 31) * smoothstep(40, 220, off) * (1 - smoothstep(shelf, shelf * 1.6, off))
        - (I.deep ?? 26) * smoothstep(shelf * 0.9, shelf * 2.4, off);
    }
    if (I.far) for (const f of I.far) {
      const q = ((x - f.x) ** 2 + (z - f.z) ** 2) / (f.r * f.r);
      if (q < 9) h = Math.max(h, -30 + (f.h + 30) * Math.exp(-q) * (0.8 + 0.2 * fbm2(x / 700, z / 700, 3, s + 41)));
    }
    return h;
  }

  // Metres from the island's coast, measured along the ray from its centre: positive inland, negative
  // out at sea. Also leaves the runway frame of (x, z) in _u/_v. (Island style only.)
  coastDistance(x, z) {
    const I = this.island;
    const px = x - I.x, pz = z - I.z;
    let wob = I.wobble ?? 0.12;
    if (I.calm) { const c = I.calm; wob *= smoothstep(c.r, c.r + (c.fade ?? 700), Math.hypot(x - c.x, z - c.z)); }
    const qe = Math.hypot(px / I.rx, pz / I.rz), k = 1 + wob * fbm2(x / 1300, z / 1300, 3, this.seed + 9);
    this.toFrame(x, z);
    // the coast along this ray is at R / k from the centre (R: the ellipse's radius that way)
    const R = qe > 1e-6 ? Math.hypot(px, pz) / qe : Math.min(I.rx, I.rz);
    return (1 - qe * k) * R / k;
  }

  // 'arctic'. The lake's surface is the site elevation, exactly. site.terrain.arctic = {
  //   lake     {u, halfLength, halfWidth, wobble}: the frozen lake, an ellipse on the runway's axis
  //            centred u metres along it (runway frame), its shore wandering by `wobble`
  //   islets   [{u, v, r, h}] rocky islands in it (runway frame)
  //   hills    the height of the snowy hills round it (m)
  //   lows     [{u0, u1, half, fade, max}] (heights absolute), see applyLows(): the approach beyond the lake
  // }
  arcticHeight(x, z) {
    const A = this.arctic, s = this.seed, e = this.elevation;
    const d = this.lakeShore(x, z);
    let h = e;
    if (d > 0) {
      const ridged = 1 - Math.abs(fbm2(x / 2300, z / 2300, 4, s + 2));
      h += 5 * smoothstep(0, 50, d) + 22 * smoothstep(30, 450, d) * (0.5 + 0.5 * fbm2(x / 700, z / 700, 2, s + 4))
        + (A.hills ?? 320) * smoothstep(150, 1600, d) * (0.2 + 0.8 * ridged * ridged)
        + (4 * fbm2(x / 260, z / 260, 3, s + 5) + fbm2(x / 60, z / 60, 2, s + 6)) * smoothstep(0, 120, d);
    }
    if (A.lows) h = this.applyLows(A.lows, h);
    if (A.islets) for (const it of A.islets) {
      const du = this._u - it.u, dv = this._v - it.v, q = Math.sqrt(du * du + dv * dv) / it.r;
      if (q < 1) h = Math.max(h, e + it.h * (1 - smoothstep(0.15, 1, q)) * (0.75 + 0.25 * fbm2(x / 60, z / 60, 2, s + 13)));
    }
    return h + smoothstep(7000, 13000, Math.hypot(x, z)) * (380 + 520 * Math.max(0, fbm2(x / 5000, z / 5000, 3, s + 21)));
  }

  // Metres outside the frozen lake's shore (negative: out on the ice). Also leaves _u/_v. (Arctic only.)
  lakeShore(x, z) {
    const L = this.arctic.lake;
    this.toFrame(x, z);
    const du = this._u - L.u, dv = this._v;
    const qe = Math.hypot(du / L.halfLength, dv / L.halfWidth), k = 1 + (L.wobble ?? 0.15) * fbm2(x / 900, z / 900, 3, this.seed + 9);
    const R = qe > 1e-6 ? Math.hypot(du, dv) / qe : Math.min(L.halfLength, L.halfWidth);
    return (qe * k - 1) * R / k;
  }

  // 'desert'. The site elevation is the top of the mesa the strip sits on. site.terrain.desert = {
  //   floor    the desert floor, metres relative to the site elevation (-150: the cliff is 150 m)
  //   mesa     {u0, u1, half, round, wobble, calm}: the strip's mesa, a rounded rectangle in the runway
  //            frame from u0 to u1 and half wide, its edge a cliff; `calm` metres round the approach
  //            end's centre the edge does not wander, so the drop is exactly where the map puts it
  //   buttes   [{u, v, r, h}] single cliff-sided buttes (runway frame), h above the floor
  //   butte    the height of the buttes and mesas the noise scatters everywhere else (0: none)
  //   canyon   {u, width, depth, meander}: a dry canyon across the approach at about u
  //   lows     [{u0, u1, half, fade}] runway-frame areas the noise's buttes keep out of
  // }
  desertHeight(x, z) {
    const D = this.desert, s = this.seed, e = this.elevation;
    const base = e + (D.floor ?? -150);
    this.toFrame(x, z);
    const u = this._u, v = this._v;
    // the floor: long swells, dune fields in patches, and the grain of it
    let h = base + 9 * fbm2(x / 2100, z / 2100, 3, s) + 2.5 * fbm2(x / 380, z / 380, 2, s + 1);
    const dune = 1 - Math.abs(Math.sin((x * 0.83 + z * 0.56) / 48 + 2.6 * fbm2(x / 420, z / 420, 2, s + 3)));
    h += 3.2 * dune * dune * smoothstep(0.05, 0.4, fbm2(x / 1600, z / 1600, 2, s + 8));
    if (D.canyon) {
      const C = D.canyon, a = Math.abs(u - (C.u + (C.meander ?? 260) * fbm2(v / 1400, 0.5, 2, s + 15)));
      if (a < C.width) h -= C.depth * (1 - smoothstep(C.width * 0.26, C.width * 0.5, a)) * (0.85 + 0.15 * fbm2(x / 200, z / 200, 2, s + 18));
    }
    const floor = h;
    // buttes and mesas from noise, stepped like layered sandstone, kept out of the lows
    if (D.butte) {
      let clear = 1;
      if (D.lows) for (const L of D.lows) {
        const du = Math.max(L.u0 - u, u - L.u1, 0), dv = Math.max(Math.abs(v) - L.half, 0);
        clear = Math.min(clear, smoothstep(0, L.fade, Math.hypot(du, dv)));
      }
      if (clear > 0) {
        const n = fbm2(x / 1900, z / 1900, 4, s + 2);
        const rock = 0.62 * smoothstep(0.27, 0.31, n) + 0.2 * smoothstep(0.19, 0.28, n) + 0.45 * smoothstep(0.42, 0.45, n);
        h += D.butte * rock * clear * (0.85 + 0.15 * fbm2(x / 300, z / 300, 2, s + 16));
      }
    }
    if (D.buttes) for (const B of D.buttes) {
      const sd = Math.hypot(u - B.u, v - B.v) - B.r * (1 + 0.14 * fbm2(x / 250, z / 250, 2, s + 17));
      if (sd < 130) h = Math.max(h, floor + B.h * (1 - this.mesaProfile(sd)));
    }
    if (D.mesa) {
      const M = D.mesa, rr = M.round ?? 100, hu = (M.u1 - M.u0) / 2;
      const qx = Math.abs(u - (M.u0 + hu)) - (hu - rr), qz = Math.abs(v) - (M.half - rr);
      let sd = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - rr;
      let wob = M.wobble ?? 40;
      if (M.calm) wob *= smoothstep(M.calm, M.calm * 2.5, Math.hypot(u - M.u0, v));
      sd += wob * fbm2(x / 350, z / 350, 3, s + 19);
      if (sd < 140) {
        const top = e + 0.6 * fbm2(x / 120, z / 120, 2, s + 20) * smoothstep(0, 60, -sd);
        h = Math.max(h, lerp(top, floor, this.mesaProfile(sd)));
      }
    }
    // the far horizon: more of the same, flat-topped
    const r = Math.hypot(x, z);
    if (r > 6500) {
      const n = fbm2(x / 3600, z / 3600, 3, s + 21);
      h += smoothstep(6500, 10500, r) * (140 + 260 * smoothstep(0.02, 0.08, n) + 120 * smoothstep(0.3, 0.34, n));
    }
    return h;
  }

  // 0 on a mesa's top, 1 at its foot: a near-vertical cliff (three quarters of the drop in 14 m)
  // and a talus slope below it. sd is the metres outside the edge.
  mesaProfile(sd) { return 0.74 * smoothstep(0, 14, sd) + 0.26 * smoothstep(8, 120, sd); }

  build(scene, opts = {}) {
    this.mesh = look.buildGround(this);
    this.group.add(this.mesh);
    if (this.waterLevel != null) {
      const water = makeWater(this.size * 1.5, this.waterLevel, opts.sun);
      this.water = water;
      this.group.add(water.mesh);
      // an island's shallows are turquoise: the water is handed the island to find its depth (new maps)
      if (this.island && water.setShallows) water.setShallows(this);
    }
    const forest = look.buildForest(this, opts);
    this.treeCount = forest.count;
    // Performance (docs/PERF.md): the art bench hands back whole-county instanced meshes; split
    // them into spatial chunks so the camera and the shadow camera can cull them. Same trees,
    // same places, same colours.
    for (const o of forest.objects) for (const c of (o.isInstancedMesh ? chunkInstanced(o) : [o])) this.group.add(c);
    // boulders: the mountain valleys' river, and the new maps' desert and arctic
    if (this.style === 'mountain' || this.desert || this.arctic) for (const c of chunkInstanced(look.buildRocks(this))) this.group.add(c);
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
