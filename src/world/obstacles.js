// Obstacles and gates for a mission: city towers, bridges you fly under, power lines, cranes, ships' masts, tree
// walls with a notch, and the gates of a slalom. This file decides where they are and what counts as hitting
// them; src/art/city-look.js (reached through the art door, src/art/terrain-look.js) decides how they look, and
// draws every solid from the very numbers resolved here (tools/test-obstacles.mjs checks that it does).
//
// Why not terrain.obstacles: those are flat-topped columns in the ground query, so radio altitude reads the roof
// of anything underneath (ground effect, the assist flare, callouts, altitude-triggered failures and the chase
// camera all follow it), nothing can be flown UNDER, and the list is scanned linearly per contact point. Here the
// airframe is tested after each physics step with swept probe spheres (src/aircraft/hulls.js) against real
// volumes, through a grid, and a hit calls the aircraft's public crash() (main.js). The ground query and the
// physics are untouched: radio altitude still reads the terrain under a crane boom, as it should.
//
// ---- THE ENGINE, for anyone building courses on it (the city ladder does) ----
// Course spec, in the runway frame of site.runways[0]: u metres along the runway from the threshold (negative =
// on the approach), v metres right of the centreline, heights above the threshold elevation unless stated.
// A site's `course` and a scenario's `course` are merged (site first): { obstacles: [...], gates: [...],
// clear: [{ u, v, r }] }. Every obstacle has `kind`, a position, `rot` (degrees, clockwise seen from above; at 0
// its local +X points right of the runway and its local -Z down the runway) and an optional `name` (the crash
// reads "Hit " + name, so give it its article). Heights `h` are above the local ground (or the water for ships);
// `y0`/`y1`/`top` are above the threshold elevation. Kinds:
//   box       { u, v, w, d, h | y0,y1, rot, tilt, look, color, name }   any solid block (tilt: degrees about local Z)
//   tower     { u, v, w, d, h, rot, color, antenna, name }   an office tower: windows, roof, obstacle lights
//   block     { ...tower }   a lower building (warehouse, flats): the same facade, fewer lights
//   cyl       { u, v, r, r1, h | y0,y1, look, color, name }   vertical cylinder or frustum (a chimney, a pier)
//   mast      { u, v, h, r, guys, name }   radio mast / pole: lights at the top and half way, optional guy wires
//   cable     { a:{u,v,y}, b:{u,v,y}, r, sag, markers, name }   one sagging wire (a chain of capsules)
//   powerline { from:{u,v}, to:{u,v}, spans, h, sag, type:'hv'|'pole', markers, name }   pylons and their wires
//   bridge    { u, v, rot, length, deckY, deckW, deckT, towerH, name }   deck from local x -length/2..+length/2
//   crane     { type:'sts'|'tower', u, v, rot, boom, h, outreach, backreach, gauge, legSpan, jib, color, name }
//   ship      { type:'container'|'tall', u, v, rot, length, beam, seed, name }   bow along local +X, on the water
//   quay      { u, v, rot, w, d, top, name }   a concrete slab from the seabed to `top` (a pier, a quay)
//   containers{ u, v, rot, rows, cols, tiers, seed }   a container yard, one solid per stack
//   tree      { u, v, scale }   one obstacle spruce (the bush trees' look and size, OBSTACLE_TREE)
//   treeWall  { u, from, to, step, scale, rows, rowGap, jitter, gap:{v, w} }   rows across the approach with a notch
// Gates: { u, v, y, w, h, rot, name, required (default true), bonus (points, default 0; 5 for a bonus gate) }
// - a rectangle w x h centred y above the threshold elevation, flown through along rot (0 = down the runway).
// Gates are markers, not solids: the frame is drawn but never collides.
//
// Resolved course (plan() output): { prims, gates, lights, keepOut, center, radius }. A prim is one collision
// volume: { shape:'box', cx,cy,cz, hx,hy,hz, X,Y,Z (unit axes) } | { shape:'cyl', x,z, y0,y1, r0,r1 } |
// { shape:'cap', ax,ay,az, bx,by,bz, r }, plus { name, kind, look, color, group } and its bounds. The look draws
// each prim as it is (look: 'building' | 'plain' | 'hull' | 'container' | 'steel' | 'wire' | 'marker' | 'tree' |
// 'trunk' | 'truss' | 'concrete' | 'white'), and the kinds above only choose the numbers.
//
// Runtime: new ObstacleField(course, { terrain, site }); build(scene, { night, quality }); reset(ac) after the
// spawn; hit(ac) after every physics step (returns the name of what the airframe hit, or null; it also advances
// the gates and the near-miss record from the same swept segment); update(dt, t, pos) for the look (blinking
// lights); clearance(p) = { d, prim } the signed distance from a world point to the nearest solid.
//
// Deterministic: randomness (container colours, a tree's yaw) from makeRng(seed * k + c) of the course's own
// seed; never Math.random().
import * as THREE from 'three';
import { DEG, clamp, makeRng } from '../config.js';
import { Terrain } from './terrain.js';
import { siteFlats } from '../systems/scenarios.js';
import { hullProbes } from '../aircraft/hulls.js';
import * as look from '../art/terrain-look.js';

const CELL = 48;          // broadphase grid cell, metres
const NEAR = 15;          // near-miss bookkeeping reach beyond the hull, metres (the debrief quotes passes under 15 m)
const CLUSTER = 4;        // probes are tested in clusters binned on a grid this size in the body frame, metres
const GATE_REACH = 900;   // a gate plane crossed farther than this outside the frame is not "the gate"

// ---------------------------------------------------------------- resolving a course
// The runway frame of runways[0] (the same maths as Airport.point, available before the airport is built).
function runwayFrame(site) {
  const rw = site.runways ? site.runways[0] : null;
  const h = rw ? rw.heading * DEG : 0;
  const dir = { x: Math.sin(h), z: -Math.cos(h) }, right = { x: -dir.z, z: dir.x };
  const ox = rw ? rw.x : 0, oz = rw ? rw.z : 0, elev = rw ? rw.elevation : 0;
  return { h, dir, right, elev, at: (u, v) => ({ x: ox + dir.x * u + right.x * v, z: oz + dir.z * u + right.z * v }) };
}

// Unit axes of a local frame yawed psi (radians from the runway's right vector, clockwise from above) and
// tilted by `tilt` about its local Z (raising local +X).
function axes(psi, tilt = 0) {
  const cx = Math.cos(psi), sx = Math.sin(psi);
  if (!tilt) return { X: [cx, 0, sx], Y: [0, 1, 0], Z: [-sx, 0, cx] };
  const c = Math.cos(tilt), s = Math.sin(tilt);
  return { X: [cx * c, s, sx * c], Y: [-cx * s, c, -sx * s], Z: [-sx, 0, cx] };
}

function finishPrim(p) {
  let mnx, mxx, mny, mxy, mnz, mxz;
  if (p.shape === 'box') {
    const ex = Math.abs(p.X[0]) * p.hx + Math.abs(p.Y[0]) * p.hy + Math.abs(p.Z[0]) * p.hz;
    const ey = Math.abs(p.X[1]) * p.hx + Math.abs(p.Y[1]) * p.hy + Math.abs(p.Z[1]) * p.hz;
    const ez = Math.abs(p.X[2]) * p.hx + Math.abs(p.Y[2]) * p.hy + Math.abs(p.Z[2]) * p.hz;
    mnx = p.cx - ex; mxx = p.cx + ex; mny = p.cy - ey; mxy = p.cy + ey; mnz = p.cz - ez; mxz = p.cz + ez;
  } else if (p.shape === 'cyl') {
    const r = Math.max(p.r0, p.r1);
    mnx = p.x - r; mxx = p.x + r; mny = p.y0; mxy = p.y1; mnz = p.z - r; mxz = p.z + r;
  } else {
    mnx = Math.min(p.ax, p.bx) - p.r; mxx = Math.max(p.ax, p.bx) + p.r;
    mny = Math.min(p.ay, p.by) - p.r; mxy = Math.max(p.ay, p.by) + p.r;
    mnz = Math.min(p.az, p.bz) - p.r; mxz = Math.max(p.az, p.bz) + p.r;
  }
  p.min = [mnx, mny, mnz]; p.max = [mxx, mxy, mxz];
  p.sx = (mnx + mxx) / 2; p.sy = (mny + mxy) / 2; p.sz = (mnz + mxz) / 2;
  p.sr = Math.hypot(mxx - mnx, mxy - mny, mxz - mnz) / 2;
  return p;
}

// Everything a compound kind needs to place its parts: a local frame at (u, v) on the ground (or the water).
class Placer {
  constructor(course, fr, height, water) {
    this.c = course; this.fr = fr; this.height = height; this.water = water;
  }
  // A local frame: origin at runway (u, v), base height `base` (world y), yaw `rot` degrees.
  frame(u, v, rot = 0, base = null) {
    const o = this.fr.at(u, v);
    const y = base != null ? base : this.height(o.x, o.z);
    const psi = this.fr.h + (rot || 0) * DEG;
    const A = axes(psi);
    const at = (lx, ly, lz) => [o.x + A.X[0] * lx + A.Z[0] * lz, y + ly, o.z + A.X[2] * lx + A.Z[2] * lz];
    return { o: [o.x, y, o.z], psi, A, at };
  }
  push(p, meta) { Object.assign(p, meta); this.c.prims.push(finishPrim(p)); return p; }
  // Where a compound stands: `base` (above the threshold elevation) or `deck` (above the water), else the ground.
  baseOf(s) { return s.deck != null ? (this.water != null ? this.water : 0) + s.deck : s.base != null ? this.fr.elev + s.base : null; }
  // box centred at local (lx, ly, lz), size w (local X) x h (Y) x d (Z), tilted `tilt` degrees about local Z
  box(F, lx, ly, lz, w, h, d, meta, tilt = 0) {
    const [cx, cy, cz] = F.at(lx, ly, lz), A = axes(F.psi, tilt * DEG);
    return this.push({ shape: 'box', cx, cy, cz, hx: w / 2, hy: h / 2, hz: d / 2, X: A.X, Y: A.Y, Z: A.Z }, meta);
  }
  // box between two local points along its long axis (a boom, a girder), cross-section w x d
  beam(F, a, b, h, d, meta) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    // local frame of the beam: X along a->b, Z = the frame's Z made perpendicular, Y = Z x X
    const wa = F.at(...a), wb = F.at(...b);
    const X = [(wb[0] - wa[0]) / len, (wb[1] - wa[1]) / len, (wb[2] - wa[2]) / len];
    let Z = [F.A.Z[0], F.A.Z[1], F.A.Z[2]];
    const k = X[0] * Z[0] + X[1] * Z[1] + X[2] * Z[2];
    Z = [Z[0] - k * X[0], Z[1] - k * X[1], Z[2] - k * X[2]];
    const zn = Math.hypot(...Z) || 1; Z = Z.map((c) => c / zn);
    const Y = [Z[1] * X[2] - Z[2] * X[1], Z[2] * X[0] - Z[0] * X[2], Z[0] * X[1] - Z[1] * X[0]];
    return this.push({ shape: 'box', cx: (wa[0] + wb[0]) / 2, cy: (wa[1] + wb[1]) / 2, cz: (wa[2] + wb[2]) / 2, hx: len / 2, hy: h / 2, hz: d / 2, X, Y, Z }, meta);
  }
  cyl(F, lx, lz, y0, y1, r0, r1, meta) {
    const [x, , z] = F.at(lx, 0, lz);
    return this.push({ shape: 'cyl', x, z, y0: F.o[1] + y0, y1: F.o[1] + y1, r0, r1: r1 == null ? r0 : r1 }, meta);
  }
  cap(F, a, b, r, meta) {
    const wa = F.at(...a), wb = F.at(...b);
    return this.push({ shape: 'cap', ax: wa[0], ay: wa[1], az: wa[2], bx: wb[0], by: wb[1], bz: wb[2], r }, meta);
  }
  // a sagging wire between two WORLD points: a chain of capsules on a parabola, `sag` metres at mid-span
  wire(wa, wb, r, sag, meta, n = 0) {
    const len = Math.hypot(wb[0] - wa[0], wb[2] - wa[2]);
    n = n || clamp(Math.round(len / 22), 4, 24);
    const pt = (t) => [wa[0] + (wb[0] - wa[0]) * t, wa[1] + (wb[1] - wa[1]) * t - 4 * sag * t * (1 - t), wa[2] + (wb[2] - wa[2]) * t];
    let prev = pt(0);
    for (let i = 1; i <= n; i++) {
      const cur = pt(i / n);
      this.push({ shape: 'cap', ax: prev[0], ay: prev[1], az: prev[2], bx: cur[0], by: cur[1], bz: cur[2], r }, { ...meta });
      prev = cur;
    }
    return pt;
  }
  light(p, blink = false, color = 'red') { this.c.lights.push({ x: p[0], y: p[1], z: p[2], blink, color }); }
  keep(x, z, r) { this.c.keepOut.push({ x, z, r }); }
}

// Obstacle trees: the bush strips' spruce (OBSTACLE_TREE: 4.04 m crown radius at the foliage base, 25 m tall at
// scale 1, bare trunk below 8.375 m) as a trunk and a crown frustum. The look draws the real spruce over them.
const TREE_BASE = 8.375 / 25, TREE_TOP_R = 0.25;
function addTree(P, x, z, scale, name = 'a tree') {
  const y = P.height(x, z), R = look.OBSTACLE_TREE.radius * scale, H = look.OBSTACLE_TREE.height * scale;
  const group = P.c.groups++;
  P.push({ shape: 'cyl', x, z, y0: y - 1, y1: y + H * TREE_BASE, r0: 0.55 * scale, r1: 0.45 * scale }, { kind: 'tree', look: 'trunk', name, group, scale });
  P.push({ shape: 'cyl', x, z, y0: y + H * TREE_BASE, y1: y + H, r0: R, r1: TREE_TOP_R * scale }, { kind: 'tree', look: 'tree', name, group, scale, base: y });
  P.keep(x, z, R + 6);
}

const BUILD = {
  box(P, s) {
    const F = P.frame(s.u, s.v, s.rot);
    const ground = s.y0 != null ? P.fr.elev + s.y0 : F.o[1] - 1;
    const top = s.y1 != null ? P.fr.elev + s.y1 : s.top != null ? P.fr.elev + s.top : F.o[1] + (s.h || 10);
    P.box(F, 0, (ground + top) / 2 - F.o[1], 0, s.w || 10, top - ground, s.d || 10, { kind: s.kind, look: s.look || 'plain', color: s.color, name: s.name || 'a building', group: P.c.groups++ }, s.tilt || 0);
    P.keep(F.o[0], F.o[2], Math.hypot(s.w || 10, s.d || 10) / 2 + 15);
  },
  tower(P, s) {
    const F = P.frame(s.u, s.v, s.rot);
    // seat it on the lowest ground under its footprint, so no corner floats on a slope
    let base = F.o[1];
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const p = F.at(a * s.w / 2, 0, b * s.d / 2); base = Math.min(base, P.height(p[0], p[2])); }
    base -= 1;
    const top = s.top != null ? P.fr.elev + s.top : F.o[1] + s.h;
    const g = P.c.groups++;
    P.box(F, 0, (base + top) / 2 - F.o[1], 0, s.w, top - base, s.d, { kind: s.kind, look: 'building', color: s.color, name: s.name || (s.kind === 'block' ? 'a building' : 'a tower block'), group: g, floors: s.floors });
    const H = top - F.o[1];
    if (s.antenna) {
      P.cyl(F, 0, 0, H, H + s.antenna, 0.35, 0.2, { kind: 'mast', look: 'steel', color: 'steel', name: s.name || 'a rooftop mast', group: g });
      P.light(F.at(0, H + s.antenna + 0.5, 0), true);
    }
    if (s.kind !== 'block' || H > 45) for (const [a, b] of [[-1, -1], [1, 1]]) P.light(F.at(a * (s.w / 2 - 0.6), H + 0.6, b * (s.d / 2 - 0.6)), H > 120);
    P.keep(F.o[0], F.o[2], Math.hypot(s.w, s.d) / 2 + 20);
  },
  block(P, s) { BUILD.tower(P, s); },
  cyl(P, s) {
    const F = P.frame(s.u, s.v, 0);
    const y0 = s.y0 != null ? s.y0 + P.fr.elev - F.o[1] : -1, y1 = s.y1 != null ? s.y1 + P.fr.elev - F.o[1] : s.h;
    P.cyl(F, 0, 0, y0, y1, s.r, s.r1 != null ? s.r1 : s.r, { kind: s.kind, look: s.look || 'concrete', color: s.color, name: s.name || 'a chimney', group: P.c.groups++ });
    P.keep(F.o[0], F.o[2], s.r + 15);
  },
  mast(P, s) {
    const F = P.frame(s.u, s.v, s.rot);
    const r = s.r || 0.9, g = P.c.groups++, name = s.name || 'a radio mast';
    P.cyl(F, 0, 0, -1, s.h, r, r * 0.8, { kind: 'mast', look: 'truss', color: s.color || 'mast', name, group: g });
    P.light(F.at(0, s.h + 0.4, 0), true);
    if (s.h > 60) P.light(F.at(0, s.h * 0.5, 0), false);
    if (s.guys) for (let k = 0; k < 3; k++) {
      const a = k * 2 * Math.PI / 3 + 0.3, d = s.h * 0.45;
      for (const f of [0.45, 0.85]) P.cap(F, [0, s.h * f, 0], [Math.cos(a) * d, 0.3, Math.sin(a) * d], 0.06, { kind: 'mast', look: 'wire', name: 'a guy wire', group: g });
    }
    P.keep(F.o[0], F.o[2], (s.guys ? s.h * 0.45 : 0) + 12);
  },
  cable(P, s) {
    const a = P.fr.at(s.a.u, s.a.v), b = P.fr.at(s.b.u, s.b.v);
    const wa = [a.x, P.fr.elev + s.a.y, a.z], wb = [b.x, P.fr.elev + s.b.y, b.z];
    const g = P.c.groups++;
    const pt = P.wire(wa, wb, s.r || 0.12, s.sag || 0, { kind: 'cable', look: 'wire', name: s.name || 'a cable', group: g });
    if (s.markers) markers(P, pt, Math.hypot(wb[0] - wa[0], wb[2] - wa[2]), s.markers, g, s.name || 'a cable');
  },
  powerline(P, s) {
    const hv = (s.type || 'hv') === 'hv', n = s.spans || 1, H = s.h || (hv ? 36 : 10);
    const a = P.fr.at(s.from.u, s.from.v), b = P.fr.at(s.to.u, s.to.v);
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    // pylon local X across the line, local Z along it
    const X = { x: -dz / len, z: dx / len };
    const psi = Math.atan2(X.z, X.x);
    const name = s.name || 'the power lines', pname = hv ? 'a pylon' : 'a power pole';
    // where the wires hang from: the earth wire on the peak, the conductors under 2.2 m insulator strings at the arm tips
    const attach = hv ? [[0, H], [-6.5, H - 5.5 - 2.2], [6.5, H - 5.5 - 2.2], [-8, H - 12 - 2.2], [8, H - 12 - 2.2]] : [[-1.1, H - 0.35], [0, H + 0.15], [1.1, H - 0.35]];
    const tops = [];
    for (let i = 0; i <= n; i++) {
      const x = a.x + dx * i / n, z = a.z + dz * i / n, y = P.height(x, z);
      const F = { o: [x, y, z], psi, A: axes(psi), at: (lx, ly, lz) => [x + Math.cos(psi) * lx - Math.sin(psi) * lz, y + ly, z + Math.sin(psi) * lx + Math.cos(psi) * lz] };
      const g = P.c.groups++;
      if (hv) latticePylon(P, F, H, g, pname); else {
        P.cyl(F, 0, 0, -1, H + 0.3, 0.16, 0.12, { kind: 'pylon', look: 'wood', color: 'wood', name: pname, group: g });
        P.box(F, 0, H - 0.5, 0, 2.6, 0.12, 0.12, { kind: 'pylon', look: 'wood', color: 'wood', name: pname, group: g });
      }
      tops.push(attach.map(([ax, ay]) => F.at(ax, ay, 0)));
      P.keep(x, z, hv ? 16 : 6);
    }
    const g = P.c.groups++;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < attach.length; k++) {
        const wa = tops[i][k], wb = tops[i + 1][k];
        const span = Math.hypot(wb[0] - wa[0], wb[2] - wa[2]);
        const sag = (s.sag != null ? s.sag : hv ? 5 : 1.2) * (span / 350) * (span / 350) * (hv ? 1 : 12);
        const pt = P.wire(wa, wb, hv ? (k === 0 ? 0.1 : 0.14) : 0.06, Math.min(sag, span * 0.04), { kind: 'wire', look: 'wire', name, group: g });
        // aviation marker balls on the earth wire where it crosses an approach (they make it fair to see)
        if (k === 0 && s.markers) markers(P, pt, span, s.markers, g, name);
      }
    }
    // the corridor under the wires is kept clear of trees for the look (the wires are what is in the way)
    for (let t = 0; t <= len; t += 30) P.keep(a.x + dx * t / len, a.z + dz * t / len, hv ? 14 : 5);
  },
  bridge(P, s) {
    const F = P.frame(s.u, s.v, s.rot, P.baseOf(s));
    const L = s.length || 300, W = s.deckW || 22, T = s.deckT || 3.5, y = s.deckY || 30;
    const g = P.c.groups++, name = s.name || 'the bridge';
    P.box(F, 0, y + T / 2, 0, L, T, W, { kind: 'bridge', look: 'concrete', color: 'concrete', name, group: g });
    const th = s.towerH || 0;
    for (const e of [-1, 1]) {
      const x = e * L * 0.42;
      // piers from the ground (or the water) up to the deck; towers above it for a suspension bridge
      for (const z of [-W / 2 + 1.5, W / 2 - 1.5]) P.box(F, x, (y - 2) / 2 - 1, z, 4, y + 2, 3, { kind: 'bridge', look: 'concrete', color: 'concrete', name, group: g });
      if (th) {
        for (const z of [-W / 2 - 1, W / 2 + 1]) P.box(F, x, y + T + th / 2, z, 4, th, 3, { kind: 'bridge', look: 'concrete', color: 'concrete', name, group: g });
        P.box(F, x, y + T + th - 2, 0, 3, 3, W + 5, { kind: 'bridge', look: 'concrete', color: 'concrete', name, group: g });
        P.light(F.at(x, y + T + th + 0.5, 0), true);
      }
    }
    if (th) {
      for (const z of [-W / 2 - 1, W / 2 + 1]) {
        const top = (x) => F.at(x, y + T + th - 1, z);
        // main cable: from each tower top down to the deck at mid-span and out to the anchorages
        P.wire(top(-L * 0.42), top(L * 0.42), 0.45, th - 3, { kind: 'bridge', look: 'wire', name, group: g }, 16);
        for (let x = -L * 0.36; x <= L * 0.36; x += 18) {
          const t = (x + L * 0.42) / (L * 0.84), yc = y + T + th - 1 - 4 * (th - 3) * t * (1 - t);
          if (yc - (y + T) > 2) P.cap(F, [x, y + T, z], [x, yc, z], 0.08, { kind: 'bridge', look: 'wire', name, group: g });
        }
      }
    }
    for (let x = -L / 2; x <= L / 2; x += 40) { const p = F.at(x, 0, 0); P.keep(p[0], p[2], W); }
  },
  crane(P, s) { (s.type === 'tower' ? towerCrane : stsCrane)(P, s); },
  ship(P, s) { (s.type === 'tall' ? tallShip : containerShip)(P, s); },
  quay(P, s) {
    const F = P.frame(s.u, s.v, s.rot, P.water != null ? P.water : null);
    const top = s.top != null ? s.top : s.deck != null ? s.deck : 3, bottom = -(s.depth || 12);
    P.box(F, 0, (top + bottom) / 2, 0, s.w, top - bottom, s.d, { kind: 'quay', look: 'concrete', color: 'quay', name: s.name || 'the quay', group: P.c.groups++, ground: true });
    for (let x = -s.w / 2; x <= s.w / 2; x += 40) for (let z = -s.d / 2; z <= s.d / 2; z += 40) { const p = F.at(x, 0, z); P.keep(p[0], p[2], 30); }
  },
  containers(P, s) {
    const F = P.frame(s.u, s.v, s.rot, P.baseOf(s));
    const rng = makeRng((s.seed || 1) * 7919 + 211);
    const rows = s.rows || 4, cols = s.cols || 6, tiers = s.tiers || 4, g = P.c.groups++;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const n = 1 + Math.floor(rng() * tiers);
      if (rng() < 0.12) continue;
      P.box(F, (i - (cols - 1) / 2) * 13.4, n * 1.3 - 0.2, (j - (rows - 1) / 2) * 2.9, 12.2, n * 2.6 + 0.4, 2.44, { kind: 'containers', look: 'container', color: Math.floor(rng() * 8), name: s.name || 'a container stack', group: g });
    }
    const p = F.o; P.keep(p[0], p[2], Math.hypot(cols * 13.4, rows * 2.9) / 2 + 10);
  },
  tree(P, s) { const p = P.fr.at(s.u, s.v); addTree(P, p.x, p.z, s.scale || 1, s.name); },
  treeWall(P, s) {
    const rows = s.rows || 1, rng = makeRng((s.seed || 3) * 131 + 17);
    for (let r = 0; r < rows; r++) {
      const u = s.u - r * (s.rowGap || 14);
      const off = (r % 2) * (s.step || 8) / 2;
      for (let v = s.from + off, k = 0; v <= s.to; v += s.step || 8, k++) {
        const jv = v + (rng() - 0.5) * (s.jitter || 0) * 0.5, ju = u + (rng() - 0.5) * (s.jitter || 0);
        const sc = (s.scale || 1) * (1 + (rng() - 0.5) * 0.12);
        const R = look.OBSTACLE_TREE.radius * sc;
        // the notch: no trunk inside it, and no crown reaching into it either
        if (s.gap && Math.abs(jv - s.gap.v) < s.gap.w / 2 + R) continue;
        const p = P.fr.at(ju, jv);
        addTree(P, p.x, p.z, sc, s.name);
      }
    }
  },
};

// A lattice transmission tower: four legs tapering from an 8 m base to a 2 m shaft, horizontal rings and X
// bracing on every face, two crossarms and the earth-wire peak. Every member is a capsule (or a box for the
// arms), so it collides exactly as drawn: a wingtip can clip a brace.
function latticePylon(P, F, H, g, name) {
  const meta = { kind: 'pylon', look: 'steel', color: 'pylon', name, group: g };
  const half = (y) => (y < H - 14 ? 4 - 2.9 * (y / (H - 14)) : 1.1);
  const levels = [0, (H - 14) * 0.35, (H - 14) * 0.65, H - 14, H - 12, H - 5.5, H];
  for (let i = 0; i < levels.length - 1; i++) {
    const y0 = levels[i], y1 = levels[i + 1], a = half(y0), b = half(y1);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) P.cap(F, [sx * a, y0, sz * a], [sx * b, y1, sz * b], 0.16, meta);
    // X bracing on the four faces
    for (const face of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]]) {
      const [[x0, z0], [x1, z1]] = face;
      P.cap(F, [x0 * a, y0, z0 * a], [x1 * b, y1, z1 * b], 0.07, meta);
      P.cap(F, [x1 * a, y0, z1 * a], [x0 * b, y1, z0 * b], 0.07, meta);
    }
    // ring at the top of the panel
    if (i < levels.length - 1) for (const face of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]]) {
      const [[x0, z0], [x1, z1]] = face;
      P.cap(F, [x0 * b, y1, z0 * b], [x1 * b, y1, z1 * b], 0.08, meta);
    }
  }
  // crossarms: lower wider than upper, each a slim box; insulator strings hang from the tips
  for (const [y, w] of [[H - 12, 17], [H - 5.5, 14]]) {
    P.box(F, 0, y + 0.45, 0, w, 0.9, 1.3, meta);
    for (const x of [-w / 2 + 0.5, w / 2 - 0.5]) P.cap(F, [x, y, 0], [x, y - 2.2, 0], 0.18, { ...meta, look: 'insulator' });
  }
  P.light(F.at(0, H + 0.5, 0), false);
}

function markers(P, pt, span, every, g, name) {
  const n = Math.max(1, Math.round(span / every));
  for (let i = 1; i < n; i++) {
    const p = pt(i / n);
    P.push({ shape: 'cap', ax: p[0], ay: p[1] - 0.3, az: p[2], bx: p[0], by: p[1] - 0.3, bz: p[2], r: 0.6 }, { kind: 'marker', look: 'marker', color: i % 2, name, group: g });
  }
}

// A ship-to-shore container crane on its rails: two portal frames (rail gauge along local X, the seaward legs at
// +X), the backreach girder and machinery house landward, the A-frame, and the boom hinged at the seaward legs.
// `boom` is its angle above horizontal: 0 = lowered out over the water (working), 80 = raised (parked).
function stsCrane(P, s) {
  const F = P.frame(s.u, s.v, s.rot, P.baseOf(s));
  const H = s.h || 46, G = s.gauge || 30, S = s.legSpan || 18, out = s.outreach || 65, back = s.backreach || 24;
  const apex = H + (s.apex || 30), boom = (s.boom || 0) * DEG;
  const g = P.c.groups++, name = s.name || 'a container crane', color = s.color || 'crane';
  const steel = { kind: 'crane', look: 'plain', color, name, group: g };
  const stay = { kind: 'crane', look: 'wire', name, group: g };
  for (const x of [-G / 2, G / 2]) for (const z of [-S / 2, S / 2]) P.box(F, x, H / 2 - 0.5, z, 1.8, H + 1, 1.8, steel);
  for (const z of [-S / 2, S / 2]) P.box(F, 0, 9, z, G + 1.8, 2.2, 1.6, steel);                  // portal sill beams
  for (const x of [-G / 2, G / 2]) P.box(F, x, H - 0.5, 0, 2, 2.2, S + 1.8, steel);             // cross heads
  // girder: from the backreach end to the boom hinge, on top of the portal
  const hx = G / 2 + 2;
  P.box(F, (hx - G / 2 - back) / 2, H + 2, 0, hx + G / 2 + back, 4, 6, { ...steel, name: s.name ? s.name : 'a container crane' });
  P.box(F, -G / 2 - back + 8, H + 8, 0, 16, 8, 12, { ...steel, look: 'white', color: 'house' });   // machinery house
  // the boom: hinged at (hx, H+2), `out` metres long, raised by `boom`
  const bx = hx + Math.cos(boom) * out, by = H + 2 + Math.sin(boom) * out;
  P.beam(F, [hx, H + 2, 0], [bx, by, 0], 4, 6, { ...steel, kind: 'boom', name: s.boomName || 'the crane boom' });
  // A-frame: two legs up from the portal to the apex, a cross member on top
  for (const z of [-3.2, 3.2]) {
    P.cap(F, [G / 2 - 6, H + 4, z], [G / 2 - 1.5, apex, z * 0.5], 0.9, steel);
    P.cap(F, [-G / 2 + 2, H + 4, z], [G / 2 - 1.5, apex, z * 0.5], 0.7, steel);
  }
  P.box(F, G / 2 - 1.5, apex + 0.6, 0, 2.4, 1.6, 5.2, steel);
  // stays: apex to the boom at 55% and at the tip, apex to the backreach end
  for (const z of [-2.4, 2.4]) {
    for (const f of [0.55, 0.97]) P.cap(F, [G / 2 - 1.5, apex, z * 0.5], [hx + Math.cos(boom) * out * f, H + 4 + Math.sin(boom) * out * f, z], 0.28, stay);
    P.cap(F, [G / 2 - 1.5, apex, z * 0.5], [-G / 2 - back + 1, H + 4, z], 0.3, stay);
  }
  P.light(F.at(G / 2 - 1.5, apex + 1.8, 0), true);
  P.light(F.at(bx, by + 2.5, 0), boom > 0.5);
  P.light(F.at(-G / 2 - back + 1, H + 12.5, 0), false);
  for (let x = -G / 2 - back; x <= G / 2 + out * Math.cos(boom); x += 25) { const p = F.at(x, 0, 0); P.keep(p[0], p[2], 25); }
}

// A tower crane (the building-site kind): a lattice mast, the jib at `h` pointing along local +X, the counter-jib
// with its counterweight, the tower head with its pendant ropes, the cab.
function towerCrane(P, s) {
  const F = P.frame(s.u, s.v, s.rot, P.baseOf(s));
  const H = s.h || 60, J = s.jib || 60, CJ = s.counterJib || 18;
  const g = P.c.groups++, name = s.name || 'a tower crane';
  const steel = { kind: 'crane', look: 'truss', color: s.color || 'towercrane', name, group: g };
  P.box(F, 0, H / 2 - 0.5, 0, 2.2, H + 1, 2.2, steel);
  P.box(F, J / 2 + 1, H + 1.4, 0, J + 2, 2.4, 1.8, { ...steel, kind: 'boom', name: s.jibName || 'the crane jib' });
  P.box(F, -CJ / 2, H + 1, 0, CJ, 1.6, 3, steel);
  P.box(F, -CJ + 2.5, H - 1.2, 0, 4, 4.2, 3.2, { ...steel, look: 'concrete', color: 'concrete' });
  P.box(F, 0, H + 7, 0, 1.6, 10, 1.6, steel);
  P.box(F, 2.2, H - 1.4, 1.6, 2.4, 2.6, 2.2, { ...steel, look: 'white', color: 'house' });
  for (const f of [0.35, 0.75]) P.cap(F, [0, H + 12, 0], [J * f, H + 2.6, 0], 0.08, { kind: 'crane', look: 'wire', name, group: g });
  P.cap(F, [0, H + 12, 0], [-CJ + 1, H + 1.8, 0], 0.08, { kind: 'crane', look: 'wire', name, group: g });
  P.light(F.at(0, H + 12.6, 0), true);
  P.light(F.at(J + 1.5, H + 2.8, 0), false);
  for (let x = -CJ; x <= J; x += 20) { const p = F.at(x, 0, 0); P.keep(p[0], p[2], 18); }
}

// A hull along local X (bow at +X), height h centred at local y: the parallel body as one box and the bow as three
// narrowing steps over its last 14%, each a box drawn exactly as it collides.
function hullBoxes(P, F, L, B, h, y, meta) {
  const bl = 0.14 * L;
  P.box(F, -bl / 2, y, 0, L - bl, h, B, meta);
  [0.78, 0.52, 0.26].forEach((w, k) => P.box(F, L / 2 - bl + (k + 0.5) * bl / 3, y, 0, bl / 3, h, B * w, { ...meta }));
}

// A container ship alongside: hull (the parallel body and a stepped bow), deck stacks, the bridge
// superstructure aft with its radar mast, the funnel, the foremast.
function containerShip(P, s) {
  const F = P.frame(s.u, s.v, s.rot, P.water != null ? P.water : P.fr.elev);
  const L = s.length || 220, B = s.beam || 32, g = P.c.groups++, name = s.name || 'the ship';
  const rng = makeRng((s.seed || 5) * 5381 + 7);
  hullBoxes(P, F, L, B, 21, 1.5, { kind: 'ship', look: 'hull', color: s.color || 'hullBlue', name, group: g, water: F.o[1] });
  const bridgeX = -L / 2 + L * 0.17;
  // container bays forward of the bridge and one aft of it
  for (let x = bridgeX + 16; x < L / 2 - 22; x += 14.2) {
    const tiers = 3 + Math.floor(rng() * 4);
    P.box(F, x, 12 + tiers * 1.3, 0, 12.4, tiers * 2.6, B - 3, { kind: 'ship', look: 'container', color: Math.floor(rng() * 8), name: name, group: g });
  }
  P.box(F, bridgeX - 16, 12 + 3.9, 0, 12.4, 7.8, B - 3, { kind: 'ship', look: 'container', color: 3, name, group: g });
  P.box(F, bridgeX, 25, 0, 12, 26, B - 4, { kind: 'ship', look: 'white', color: 'house', name, group: g });            // accommodation block
  P.box(F, bridgeX + 2, 37, 0, 8, 3, B + 2, { kind: 'ship', look: 'white', color: 'house', name, group: g });         // bridge and wings
  P.box(F, bridgeX - 9, 28, 0, 6, 20, 6, { kind: 'ship', look: 'plain', color: 'funnel', name, group: g });          // funnel
  P.cyl(F, bridgeX + 1, 0, 38.5, 49, 0.45, 0.3, { kind: 'mast', look: 'steel', color: 'steel', name: s.mastName || "the ship's mast", group: g });
  P.cyl(F, L / 2 - 10, 0, 12, 30, 0.4, 0.3, { kind: 'mast', look: 'steel', color: 'steel', name: s.mastName || "the ship's mast", group: g });
  P.light(F.at(bridgeX + 1, 49.5, 0), false, 'white');
  P.light(F.at(L / 2 - 10, 30.5, 0), false, 'white');
}

// A three-masted barque at anchor: hull, three masts with their yards, the bowsprit, the stays between them.
function tallShip(P, s) {
  const F = P.frame(s.u, s.v, s.rot, P.water != null ? P.water : P.fr.elev);
  const L = s.length || 72, B = s.beam || 11, g = P.c.groups++, name = s.name || 'the tall ship';
  const mastName = s.mastName || "the ship's masts";
  hullBoxes(P, F, L, B, 9, 1, { kind: 'ship', look: 'hull', color: s.color || 'hullWhite', name, group: g, water: F.o[1] });
  const masts = [[L * 0.3, 44], [L * 0.02, 47], [-L * 0.26, 40]];
  for (const [x, h] of masts) {
    P.cyl(F, x, 0, 5, h, 0.45, 0.22, { kind: 'mast', look: 'wood', color: 'spar', name: mastName, group: g });
    for (const [f, w] of [[0.35, B * 1.7], [0.52, B * 1.5], [0.68, B * 1.25], [0.82, B * 1.0], [0.93, B * 0.75]]) {
      if (x < 0 && f > 0.8) continue;
      P.box(F, x, 5 + (h - 5) * f, 0, 0.5, 0.5, w, { kind: 'mast', look: 'wood', color: 'spar', name: mastName, group: g });
    }
    P.light(F.at(x, h + 0.3, 0), false, x > 0 ? 'white' : 'red');
  }
  // bowsprit and the stays forward and aft
  P.cap(F, [L / 2 - 2, 6, 0], [L / 2 + 16, 11, 0], 0.3, { kind: 'mast', look: 'wood', color: 'spar', name: mastName, group: g });
  const stay = { kind: 'mast', look: 'wire', name: mastName, group: g };
  P.cap(F, [masts[0][0], masts[0][1] - 1, 0], [L / 2 + 15, 10.8, 0], 0.06, stay);
  P.cap(F, [masts[1][0], masts[1][1] - 1, 0], [masts[0][0], 14, 0], 0.06, stay);
  P.cap(F, [masts[2][0], masts[2][1] - 1, 0], [masts[1][0], 14, 0], 0.06, stay);
  for (const [x, h] of masts) for (const z of [-B / 2, B / 2]) P.cap(F, [x, h * 0.8, 0], [x - 4, 5.5, z], 0.05, stay);
}

// Merge the site's and the scenario's course and resolve it. Pure: tools import it in Node.
export function resolveCourse(site, sc, opts = {}) {
  const specA = site && site.course, specB = sc && sc.course;
  if (!specA && !specB) return null;
  const obstacles = [...((specA && specA.obstacles) || []), ...((specB && specB.obstacles) || [])];
  const gatesIn = [...((specA && specA.gates) || []), ...((specB && specB.gates) || [])];
  const clear = [...((specA && specA.clear) || []), ...((specB && specB.clear) || [])];
  if (!obstacles.length && !gatesIn.length) return null;
  const fr = runwayFrame(site);
  const terrain = opts.terrain || new Terrain({ ...site.terrain, flats: siteFlats(site) });
  const height = (x, z) => terrain.height(x, z);
  const course = { prims: [], gates: [], lights: [], keepOut: [], groups: 0, seed: (site.terrain && site.terrain.seed) || 1, elev: fr.elev };
  const P = new Placer(course, fr, height, terrain.waterLevel);
  for (const s of obstacles) {
    const f = BUILD[s.kind];
    if (!f) throw new Error(`course: unknown obstacle kind "${s.kind}"`);
    f(P, s);
  }
  gatesIn.forEach((s, i) => {
    const p = fr.at(s.u, s.v), psi = fr.h + (s.rot || 0) * DEG;
    const n = [Math.sin(psi), 0, -Math.cos(psi)], r = [Math.cos(psi), 0, Math.sin(psi)];
    const bonusGate = s.required === false || s.bonus > 0;
    course.gates.push({
      i, name: s.name || `Gate ${i + 1}`, x: p.x, y: fr.elev + s.y, z: p.z, w: s.w, h: s.h, n, r, psi,
      required: s.required != null ? !!s.required : !bonusGate, bonus: s.bonus != null ? s.bonus : bonusGate ? 5 : 0,
    });
    course.keepOut.push({ x: p.x, z: p.z, r: s.w / 2 + 25 });
  });
  for (const c of clear) { const p = fr.at(c.u, c.v); course.keepOut.push({ x: p.x, z: p.z, r: c.r }); }
  // Where the route flies low (under 45 m above the ground), the look keeps the decorative forest out of the way:
  // a route that threads a notch must not be flown through trees that do not collide.
  if (sc && sc.route && site.runways) {
    let prev = null;
    for (const w of sc.route) {
      const p = fr.at(w.u, w.v || 0), y = fr.elev + w.alt;
      if (prev) {
        const len = Math.hypot(p.x - prev.x, p.z - prev.z);
        for (let t = 0; t <= len; t += 40) {
          const x = prev.x + (p.x - prev.x) * t / len, z = prev.z + (p.z - prev.z) * t / len, yy = prev.y + (y - prev.y) * t / len;
          if (yy - height(x, z) < 45) course.keepOut.push({ x, z, r: 30 });
        }
      }
      prev = { x: p.x, z: p.z, y };
    }
  }
  let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
  for (const p of course.prims) { mnx = Math.min(mnx, p.min[0]); mxx = Math.max(mxx, p.max[0]); mnz = Math.min(mnz, p.min[2]); mxz = Math.max(mxz, p.max[2]); }
  for (const gt of course.gates) { mnx = Math.min(mnx, gt.x - gt.w); mxx = Math.max(mxx, gt.x + gt.w); mnz = Math.min(mnz, gt.z - gt.w); mxz = Math.max(mxz, gt.z + gt.w); }
  course.center = [(mnx + mxx) / 2, (mnz + mxz) / 2];
  course.radius = Math.hypot(mxx - mnx, mxz - mnz) / 2;
  return course;
}

// ---------------------------------------------------------------- collision maths (all allocation-free)
// Squared distance between segments p(s) = P0 + s d1 and q(t) = Q0 + t d2, s, t in [0, 1].
function segSegDist2(p0x, p0y, p0z, p1x, p1y, p1z, q0x, q0y, q0z, q1x, q1y, q1z) {
  const d1x = p1x - p0x, d1y = p1y - p0y, d1z = p1z - p0z, d2x = q1x - q0x, d2y = q1y - q0y, d2z = q1z - q0z;
  const rx = p0x - q0x, ry = p0y - q0y, rz = p0z - q0z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z, e = d2x * d2x + d2y * d2y + d2z * d2z, f = d2x * rx + d2y * ry + d2z * rz;
  let s, t;
  if (a <= 1e-9 && e <= 1e-9) { s = 0; t = 0; }
  else if (a <= 1e-9) { s = 0; t = clamp(f / e, 0, 1); }
  else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-9) { t = 0; s = clamp(-c / a, 0, 1); }
    else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z, den = a * e - b * b;
      s = den > 1e-9 ? clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  const dx = rx + d1x * s - d2x * t, dy = ry + d1y * s - d2y * t, dz = rz + d1z * s - d2z * t;
  return dx * dx + dy * dy + dz * dz;
}

// Squared distance from point P to the segment AB.
function pointSegDist2(px, py, pz, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, l2 = dx * dx + dy * dy + dz * dz;
  let t = l2 > 1e-12 ? ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + dx * t - px, ey = ay + dy * t - py, ez = az + dz * t - pz;
  return ex * ex + ey * ey + ez * ez;
}

// A body-frame point (bx, by, bz) to the world at a pose, into out[j..j+2]: v' = p + v + 2w (q x v) + 2 q x (q x v).
function rotate(out, j, bx, by, bz, px, py, pz, qx, qy, qz, qw) {
  const tx = 2 * (qy * bz - qz * by), ty = 2 * (qz * bx - qx * bz), tz = 2 * (qx * by - qy * bx);
  out[j] = px + bx + qw * tx + (qy * tz - qz * ty);
  out[j + 1] = py + by + qw * ty + (qz * tx - qx * tz);
  out[j + 2] = pz + bz + qw * tz + (qx * ty - qy * tx);
}

// The hull's probes binned into clusters on a CLUSTER-metre grid in the body frame (the wheels in clusters of their
// own): { x, y, z, r, k: [probe indices], gear }, r covering every probe of the cluster with the flaps anywhere.
function clusterProbes(hull) {
  const bins = new Map(), np = hull.probes.length;
  const add = (k, p, gear) => {
    const key = (gear ? 'g' : 'p') + Math.floor(p.x / CLUSTER) + ',' + Math.floor(p.y / CLUSTER) + ',' + Math.floor(p.z / CLUSTER);
    let b = bins.get(key); if (!b) { b = { k: [], gear }; bins.set(key, b); }
    b.k.push(k);
  };
  hull.probes.forEach((p, k) => add(k, p, false));
  hull.gear.forEach((p, g) => add(np + g, p, true));
  const at = (k) => (k < np ? hull.probes[k] : hull.gear[k - np]);
  const out = [];
  for (const b of bins.values()) {
    let x = 0, y = 0, z = 0;
    for (const k of b.k) { const p = at(k); x += p.x; y += p.y + (p.fy || 0) / 2; z += p.z + (p.fz || 0) / 2; }
    x /= b.k.length; y /= b.k.length; z /= b.k.length;
    let r = 0;
    for (const k of b.k) {
      const p = at(k);
      r = Math.max(r, Math.hypot(p.x - x, p.y - y, p.z - z) + p.r, Math.hypot(p.x - x, p.y + (p.fy || 0) - y, p.z + (p.fz || 0) - z) + p.r);
    }
    out.push({ x, y, z, r, k: b.k, gear: b.gear });
  }
  return out;
}

// Does a sphere of radius r swept from A to B touch the prim?
export function sweptHit(p, ax, ay, az, bx, by, bz, r) {
  if (p.shape === 'cap') {
    const R = p.r + r;
    return segSegDist2(ax, ay, az, bx, by, bz, p.ax, p.ay, p.az, p.bx, p.by, p.bz) <= R * R;
  }
  if (p.shape === 'box') {
    // into the box's frame, then a slab test against the box grown by r (its corners are left square: at most
    // 0.4 r conservative there)
    const X = p.X, Y = p.Y, Z = p.Z;
    const ox = ax - p.cx, oy = ay - p.cy, oz = az - p.cz, dx = bx - ax, dy = by - ay, dz = bz - az;
    const o = [ox * X[0] + oy * X[1] + oz * X[2], ox * Y[0] + oy * Y[1] + oz * Y[2], ox * Z[0] + oy * Z[1] + oz * Z[2]];
    const d = [dx * X[0] + dy * X[1] + dz * X[2], dx * Y[0] + dy * Y[1] + dz * Y[2], dx * Z[0] + dy * Z[1] + dz * Z[2]];
    const h = [p.hx + r, p.hy + r, p.hz + r];
    let t0 = 0, t1 = 1;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]) < 1e-9) { if (o[k] < -h[k] || o[k] > h[k]) return false; continue; }
      let ta = (-h[k] - o[k]) / d[k], tb = (h[k] - o[k]) / d[k];
      if (ta > tb) { const q = ta; ta = tb; tb = q; }
      if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
      if (t0 > t1) return false;
    }
    return true;
  }
  // vertical cylinder / frustum: the part of the segment inside the grown height band, then the closest
  // horizontal approach to the axis, checked against the radius at that height
  const y0 = p.y0 - r, y1 = p.y1 + r, dy = by - ay;
  let t0 = 0, t1 = 1;
  if (Math.abs(dy) < 1e-9) { if (ay < y0 || ay > y1) return false; }
  else {
    let ta = (y0 - ay) / dy, tb = (y1 - ay) / dy;
    if (ta > tb) { const q = ta; ta = tb; tb = q; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  const ox = ax - p.x, oz = az - p.z, dx = bx - ax, dz = bz - az, dd = dx * dx + dz * dz;
  let tm = dd > 1e-9 ? clamp(-(ox * dx + oz * dz) / dd, t0, t1) : t0;
  for (let k = 0; k < 3; k++) {
    const t = k === 0 ? tm : k === 1 ? t0 : t1;
    const hx = ox + dx * t, hz = oz + dz * t, y = ay + dy * t;
    const f = p.y1 > p.y0 ? clamp((y - p.y0) / (p.y1 - p.y0), 0, 1) : 0;
    const R = p.r0 + (p.r1 - p.r0) * f + r;
    if (hx * hx + hz * hz <= R * R) return true;
  }
  return false;
}

// Signed distance from a point to the prim's surface (negative inside).
export function primDistance(p, x, y, z) {
  if (p.shape === 'cap') {
    const dx = p.bx - p.ax, dy = p.by - p.ay, dz = p.bz - p.az, l2 = dx * dx + dy * dy + dz * dz;
    const t = l2 > 1e-9 ? clamp(((x - p.ax) * dx + (y - p.ay) * dy + (z - p.az) * dz) / l2, 0, 1) : 0;
    return Math.hypot(x - p.ax - dx * t, y - p.ay - dy * t, z - p.az - dz * t) - p.r;
  }
  if (p.shape === 'box') {
    const ox = x - p.cx, oy = y - p.cy, oz = z - p.cz;
    const qx = Math.abs(ox * p.X[0] + oy * p.X[1] + oz * p.X[2]) - p.hx;
    const qy = Math.abs(ox * p.Y[0] + oy * p.Y[1] + oz * p.Y[2]) - p.hy;
    const qz = Math.abs(ox * p.Z[0] + oy * p.Z[1] + oz * p.Z[2]) - p.hz;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
  }
  const f = p.y1 > p.y0 ? clamp((y - p.y0) / (p.y1 - p.y0), 0, 1) : 0;
  const dr = Math.hypot(x - p.x, z - p.z) - (p.r0 + (p.r1 - p.r0) * f);
  const dv = y < p.y0 ? p.y0 - y : y > p.y1 ? y - p.y1 : -Math.min(y - p.y0, p.y1 - y);
  return dr > 0 && dv > 0 ? Math.hypot(dr, dv) : Math.max(dr, dv);
}

// ---------------------------------------------------------------- the runtime
export class ObstacleField {
  // Resolve the site's and the scenario's `course` into world space. Returns null when there is nothing to
  // place. The result carries `keepOut` circles the terrain uses to keep trees and villages out of it.
  static plan(site, sc) { return resolveCourse(site, sc); }

  constructor(course, { terrain = null, site = null } = {}) {
    this.course = course;
    this.terrain = terrain;
    this.site = site;
    this.prims = course.prims;
    this.gates = course.gates.map((g) => ({ ...g, state: 'pending', at: null }));
    this.events = [];          // { type: 'gate', gate, passed } and { type: 'close', name, d }: MissionRuntime reads and clears
    this.closestD = Infinity;  // the closest the airframe came to any solid this flight (metres, skin to surface)...
    this.closestName = '';     // ...and what it was (the near-miss line in the debrief)
    this.lastHit = null;       // { name, part } of the hit that ended the flight
    this.look = null;
    // broadphase: a uniform grid of cells holding prim indices
    this.grid = new Map();
    this.prims.forEach((p, i) => {
      const x0 = Math.floor(p.min[0] / CELL), x1 = Math.floor(p.max[0] / CELL), z0 = Math.floor(p.min[2] / CELL), z1 = Math.floor(p.max[2] / CELL);
      for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
        const k = ix * 100003 + iz;
        let a = this.grid.get(k); if (!a) { a = []; this.grid.set(k, a); }
        a.push(i);
      }
    });
    this.stamp = new Uint32Array(this.prims.length);
    this.tick = 0;
    this.cand = [];
    this.minD = new Float32Array(this.prims.length).fill(1e9);   // per prim: the closest pass so far
    this.prev = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, flap: 0, gear: 1 };
    this.probes = null;
  }

  build(scene, opts = {}) {
    this.look = look.buildCourse(this.prims, this.gates, { terrain: this.terrain, night: !!opts.night, quality: opts.quality, seed: this.course.seed, lights: this.course.lights });
    for (const o of this.look.objects) scene.add(o);
    return this.look;
  }

  reset(ac) {
    this.hull = hullProbes(ac.def);
    const n = this.hull.probes.length + this.hull.gear.length;
    this.w0 = new Float32Array(n * 3); this.w1 = new Float32Array(n * 3);
    this.clusters = clusterProbes(this.hull);
    this.c0 = new Float32Array(this.clusters.length * 3); this.c1 = new Float32Array(this.clusters.length * 3);
    this.remember(ac);
    for (const g of this.gates) { g.state = 'pending'; g.at = null; }
    this.events.length = 0; this.closestD = Infinity; this.closestName = ''; this.lastHit = null; this.minD.fill(1e9);
  }

  remember(ac) {
    const q = ac.quat, p = this.prev;
    p.x = ac.pos.x; p.y = ac.pos.y; p.z = ac.pos.z; p.qx = q.x; p.qy = q.y; p.qz = q.z; p.qw = q.w;
    p.flap = ac.ctl.flap; p.gear = ac.def.gearRetract ? ac.ctl.gear : 1;
  }

  // Body-frame probes to world at a pose (position, quaternion), into `out` (a retracted wheel is parked 100 km
  // up, where nothing is). v' = v + 2w (q x v) + 2 q x (q x v).
  place(out, px, py, pz, qx, qy, qz, qw, flap, gearOn) {
    const probes = this.hull.probes, gear = this.hull.gear, np = probes.length, n = np + gear.length;
    for (let k = 0, j = 0; k < n; k++, j += 3) {
      const b = k < np ? probes[k] : gear[k - np];
      const bx = b.x, by = k < np ? b.y + flap * (b.fy || 0) : b.y, bz = k < np ? b.z + flap * (b.fz || 0) : b.z;
      if (k >= np && !gearOn) { out[j] = px; out[j + 1] = py + 1e5; out[j + 2] = pz; continue; }
      const tx = 2 * (qy * bz - qz * by), ty = 2 * (qz * bx - qx * bz), tz = 2 * (qx * by - qy * bx);
      out[j] = px + bx + qw * tx + (qy * tz - qz * ty);
      out[j + 1] = py + by + qw * ty + (qz * tx - qx * tz);
      out[j + 2] = pz + bz + qw * tz + (qx * ty - qy * tx);
    }
  }

  // After each physics step: what did the airframe touch between the previous pose and this one? Also advances
  // the gates (the CG's path through their planes) and the near-miss record. Returns a name, or null.
  hit(ac) {
    if (!this.hull) this.reset(ac);
    const a = this.prev, b = ac.pos, R = this.hull.radius;
    this.gatesStep(a.x, a.y, a.z, b.x, b.y, b.z);
    // broadphase: prims in the cells the swept hull (plus the near-miss reach) touches, whose bounding sphere comes
    // within that reach of the CG's path
    const reach = R + NEAR;
    const x0 = Math.floor((Math.min(a.x, b.x) - reach) / CELL), x1 = Math.floor((Math.max(a.x, b.x) + reach) / CELL);
    const z0 = Math.floor((Math.min(a.z, b.z) - reach) / CELL), z1 = Math.floor((Math.max(a.z, b.z) + reach) / CELL);
    const cand = this.cand; cand.length = 0;
    const st = ++this.tick;
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const cell = this.grid.get(ix * 100003 + iz);
      if (!cell) continue;
      for (const i of cell) {
        if (this.stamp[i] === st) continue;
        this.stamp[i] = st;
        const p = this.prims[i];
        if (pointSegDist2(p.sx, p.sy, p.sz, a.x, a.y, a.z, b.x, b.y, b.z) <= (reach + p.sr) * (reach + p.sr)) cand.push(i);
      }
    }
    let hit = null;
    if (cand.length) {
      // narrow phase: every probe placed at the previous pose and this one, and the clusters' centres likewise; a
      // prim is tested against a cluster's probes only where their swept sphere comes near it
      const gearOn = !ac.def.gearRetract || ac.ctl.gear > 0.3, prevGear = !ac.def.gearRetract || a.gear > 0.3;
      const q = ac.quat;
      this.place(this.w0, a.x, a.y, a.z, a.qx, a.qy, a.qz, a.qw, a.flap, prevGear);
      this.place(this.w1, b.x, b.y, b.z, q.x, q.y, q.z, q.w, ac.ctl.flap, gearOn);
      const cls = this.clusters, c0 = this.c0, c1 = this.c1;
      for (let c = 0, j = 0; c < cls.length; c++, j += 3) {
        rotate(c0, j, cls[c].x, cls[c].y, cls[c].z, a.x, a.y, a.z, a.qx, a.qy, a.qz, a.qw);
        rotate(c1, j, cls[c].x, cls[c].y, cls[c].z, b.x, b.y, b.z, q.x, q.y, q.z, q.w);
      }
      const probes = this.hull.probes, gear = this.hull.gear, np = probes.length;
      const w0 = this.w0, w1 = this.w1;
      for (const i of cand) {
        const p = this.prims[i];
        let dmin = 1e9;
        for (let c = 0; c < cls.length; c++) {
          const C = cls[c], j = c * 3;
          if (C.gear && !(gearOn && prevGear)) continue;   // the wheels only count while they are down at both ends of the step
          // how close can any probe of this cluster have come? Two lower bounds, the tighter one wins: the prim's
          // bounding sphere against the cluster's swept sphere, and the prim's own signed distance at the cluster's
          // centre less the cluster's radius and how far it moved (the one that works for a 240 m hull or a quay)
          const mx = c1[j] - c0[j], my = c1[j + 1] - c0[j + 1], mz = c1[j + 2] - c0[j + 2];
          let lo = Math.sqrt(pointSegDist2(p.sx, p.sy, p.sz, c0[j], c0[j + 1], c0[j + 2], c1[j], c1[j + 1], c1[j + 2])) - C.r - p.sr;
          if (lo <= NEAR) lo = Math.max(lo, primDistance(p, c1[j], c1[j + 1], c1[j + 2]) - 1.05 * C.r - 1.1 * Math.sqrt(mx * mx + my * my + mz * mz));   // (1.05, 1.1: a frustum's distance is not quite 1-Lipschitz)
          const wantHit = !hit && lo <= 0, wantNear = !p.ground && lo < NEAR && lo < dmin;
          if (!wantHit && !wantNear) continue;
          for (const k of C.k) {
            const r = k < np ? probes[k].r : gear[k - np].r, jj = k * 3;
            const ax = w0[jj], ay = w0[jj + 1], az = w0[jj + 2], bx = w1[jj], by = w1[jj + 1], bz = w1[jj + 2];
            const d = primDistance(p, bx, by, bz) - r;   // this probe's clearance at this pose
            if (wantHit && !hit) {
              const ex = bx - ax, ey = by - ay, ez = bz - az;
              if (d <= 1.1 * Math.sqrt(ex * ex + ey * ey + ez * ez) + 0.02 && sweptHit(p, ax, ay, az, bx, by, bz, r)) {
                hit = p; this.lastHit = { name: p.name, part: k < np ? probes[k].part : gear[k - np].part };
              }
            }
            if (wantNear && d < dmin) dmin = d;
          }
        }
        if (!p.ground && dmin < this.minD[i]) {
          const was = this.minD[i];
          this.minD[i] = dmin;
          if (dmin < this.closestD) { this.closestD = dmin; this.closestName = p.name; }
          if (dmin < 5 && was >= 5 && !hit) this.events.push({ type: 'close', name: p.name, d: dmin });
        }
        if (hit) break;
      }
    }
    this.remember(ac);
    return hit ? hit.name : null;
  }

  // Gates: the CG's segment through each pending gate's plane, in the gate's direction.
  gatesStep(ax, ay, az, bx, by, bz) {
    for (const g of this.gates) {
      if (g.state !== 'pending') continue;
      const s0 = (ax - g.x) * g.n[0] + (az - g.z) * g.n[2], s1 = (bx - g.x) * g.n[0] + (bz - g.z) * g.n[2];
      if (!(s0 < 0 && s1 >= 0)) continue;
      const t = s0 / (s0 - s1);
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
      const lat = (x - g.x) * g.r[0] + (z - g.z) * g.r[2], up = y - g.y;
      const inside = Math.abs(lat) <= g.w / 2 && Math.abs(up) <= g.h / 2;
      if (!inside && (Math.abs(lat) > g.w / 2 + GATE_REACH || Math.abs(up) > g.h / 2 + GATE_REACH)) continue;
      g.state = inside ? 'passed' : 'missed';
      g.at = { lat, up };
      this.events.push({ type: 'gate', gate: g, passed: inside });
    }
  }

  // Signed distance from a world point to the nearest solid within `reach` metres ({ d: Infinity } if none).
  clearance(p, reach = 150) {
    let best = { d: Infinity, prim: null };
    const x0 = Math.floor((p.x - reach) / CELL), x1 = Math.floor((p.x + reach) / CELL), z0 = Math.floor((p.z - reach) / CELL), z1 = Math.floor((p.z + reach) / CELL);
    const st = ++this.tick;
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const cell = this.grid.get(ix * 100003 + iz);
      if (!cell) continue;
      for (const i of cell) {
        if (this.stamp[i] === st) continue;
        this.stamp[i] = st;
        const d = primDistance(this.prims[i], p.x, p.y, p.z);
        if (d < best.d) best = { d, prim: this.prims[i] };
      }
    }
    return best;
  }

  update(dt, t, pos) { if (this.look && this.look.update) this.look.update(dt, t, pos); }
}
