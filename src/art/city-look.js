// CITY LOOK - what mission obstacles look like: towers and blocks, bridges, cranes, masts, pylons and their
// wires, ships, container stacks, the obstacle spruce of a tree wall, the gates, and their night obstacle lights.
//
// Contract (the world side is src/world/obstacles.js; it reaches this file through src/art/terrain-look.js):
//   buildCourse(prims, gates, { terrain, night, quality, seed, lights })  returns
//       { objects: Object3D[], update(dt, t) }.
//   `prims` are the resolved world-space collision volumes (see the header of src/world/obstacles.js):
//       { shape: 'box', cx,cy,cz, hx,hy,hz, X,Y,Z }   an oriented box (X, Y, Z its unit axes)
//       { shape: 'cyl', x,z, y0,y1, r0,r1 }            a vertical cylinder or frustum
//       { shape: 'cap', ax,ay,az, bx,by,bz, r }        a capsule (a wire, a lattice member, a stay; a == b is a ball)
//     each with { look, color, kind, name, group }. `gates` are { x,y,z, w,h, r (right), n (through), psi }.
//     `lights` are { x,y,z, blink, color } obstacle lights (drawn at night only, the tall ones blinking).
//   What is drawn solid IS what collides (the OBSTACLE_TREE rule): every solid here is drawn from its prim's own
//   numbers - a box from its centre, axes and half extents, a cylinder from its radii and heights, a capsule as
//   a tube between its two points with its radius - and every InstancedMesh carries userData.prim, the prim
//   index of each instance (-1 for the gate frames, which are markers and never collide), so
//   tools/test-obstacles.mjs can check the drawing against the volumes. The one liberty: thin members (wires,
//   lattice, stays) are widened in the vertex shader to at least about one pixel at a distance, so a power line
//   stays a visible dark line at 2 km instead of vanishing under the pixel grid; up close they are true size.
//   Obstacle trees are the bush strips' spruce (world-vegetation.js buildObstacleTrees, the OBSTACLE_TREE look)
//   instanced, standing over their trunk-and-crown prims.
//
// Draw calls: one InstancedMesh per geometry - boxes, cylinders, tubes, marker balls, trees - sharing ONE
// material and program (course/solids) except the trees, plus one LightSet at night: 6 draws for a whole
// course, a few more in the shadow pass. The per-instance attributes decide the finish:
//   ctBox   vec4  size in metres (x, y, z) and the style: 0 plain, 1 office facade, 2 container stack,
//                 3 gate stripes, 4 ship's hull (drawn as its box, like everything: the world steps the bow), 5 painted lattice, 6 house /
//                 superstructure (small windows), 7 wood, 8 wire, 9 steel member (8 and 9 are the thin ones)
//   ctSeed  float per-instance variation (windows, container colours); for a hull, its waterline above the keel
//   (the shader's local coordinates run from the box's lower corner, in metres: windows, tiers and the waterline
//   are measured from the base)
//   ctTaper float top radius / bottom radius of a frustum (1 for everything else)
// House rules (src/art/AGENTS.md): every material named; uniforms prefixed `ct` (never `at`, which is the
// atmosphere's); no material cached at module level (built per call, per scene); customProgramCacheKey with
// every onBeforeCompile; seeded randomness only (makeRng from the course seed); no point or spot lights; linear
// colours; nothing allocated per frame - update() only rewrites the lights' colours when a blinker toggles.
import * as THREE from 'three';
import { makeRng } from '../config.js';
import { LightSet } from './lights.js';
import { buildObstacleTrees } from './world-vegetation.js';
import { WORLD_QUALITY } from './quality.js';

// The course's colours, linear albedos (sunlit white is about 0.8). Kept here rather than in palette.js so the
// mission look can grow without touching the world's colour book; the names are what the world asks for.
const COLORS = {
  concrete: [0.33, 0.325, 0.31], quay: [0.29, 0.285, 0.27], steel: [0.30, 0.31, 0.32], pylon: [0.36, 0.37, 0.38],
  mast: [0.62, 0.10, 0.04], wood: [0.13, 0.085, 0.05], spar: [0.16, 0.10, 0.055], wire: [0.035, 0.035, 0.037],
  insulator: [0.30, 0.32, 0.30], crane: [0.58, 0.12, 0.025], craneBlue: [0.04, 0.12, 0.30], craneWhite: [0.66, 0.66, 0.64],
  towercrane: [0.62, 0.42, 0.03], house: [0.66, 0.66, 0.64], funnel: [0.40, 0.05, 0.03],
  hullBlue: [0.025, 0.05, 0.12], hullWhite: [0.62, 0.62, 0.60], hullRed: [0.30, 0.04, 0.03],
  markers: [[0.85, 0.24, 0.02], [0.78, 0.78, 0.76]], gate: [0.88, 0.20, 0.02], gateWhite: [0.80, 0.80, 0.78],
  buildings: [[0.30, 0.30, 0.29], [0.36, 0.33, 0.28], [0.20, 0.23, 0.26], [0.42, 0.40, 0.36], [0.26, 0.20, 0.16], [0.14, 0.16, 0.18]],
  containers: [[0.04, 0.16, 0.34], [0.42, 0.05, 0.03], [0.05, 0.20, 0.07], [0.60, 0.20, 0.03], [0.28, 0.28, 0.28], [0.58, 0.44, 0.05], [0.60, 0.60, 0.58], [0.20, 0.08, 0.04]],
};
const STYLE = { plain: 0, concrete: 0, quay: 0, building: 1, container: 2, gate: 3, hull: 4, truss: 5, white: 6, wood: 7, wire: 8, steel: 9, insulator: 9, marker: 0, trunk: 7 };
const THIN = new Set(['wire', 'steel', 'insulator']);

function colorOf(p, i) {
  const c = p.color;
  if (p.look === 'building') return typeof c === 'number' ? COLORS.buildings[c % COLORS.buildings.length] : COLORS[c] || COLORS.buildings[(p.group * 7 + 3) % COLORS.buildings.length];
  if (p.look === 'container') return COLORS.containers[(typeof c === 'number' ? c : i) % 8];
  if (p.look === 'marker') return COLORS.markers[(c || 0) % 2];
  if (p.look === 'wire') return COLORS.wire;
  if (p.look === 'insulator') return COLORS.insulator;
  if (p.look === 'trunk' || p.look === 'wood') return COLORS[c] || COLORS.wood;
  return (typeof c === 'string' && COLORS[c]) || COLORS.concrete;
}

// The one material every solid of the course is drawn with. Its uniforms belong to it (never shared between
// scenes): ctNight 0/1, ctWire the thin members' minimum half-width per metre of distance, ctPal the container
// colours. Styles are chosen per instance (ctBox.w).
function solidsMaterial(night) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, metalness: 0.04 });
  m.name = 'course/solids';
  const uniforms = {
    ctNight: { value: night ? 1 : 0 },
    ctWire: { value: 0.0006 },
    ctPal: { value: COLORS.containers.map((c) => new THREE.Vector3(...c)) },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 ctBox;
attribute float ctSeed;
attribute float ctTaper;
uniform float ctWire;
varying vec3 ctLocal;
varying vec3 ctNrm;
varying vec2 ctInfo;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
ctLocal = (position + 0.5) * ctBox.xyz;   // metres from the box's lower corner (windows and tiers start at the base)
ctNrm = normal;
ctInfo = vec2(ctBox.w, ctSeed);
transformed.xz *= mix(1.0, ctTaper, clamp(position.y + 0.5, 0.0, 1.0));
#ifdef USE_INSTANCING
if (ctBox.w > 7.5) {
  vec4 ctCentre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float ctRadius = length(instanceMatrix[0].xyz);
  transformed.xz *= max(1.0, ctWire * (ctBox.w > 8.5 ? 0.7 : 1.0) * max(-ctCentre.z, 1.0) / max(ctRadius, 1e-3));
}
#endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float ctNight;
uniform vec3 ctPal[8];
varying vec3 ctLocal;
varying vec3 ctNrm;
varying vec2 ctInfo;
float ctHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float ctGloss = 0.0;
vec3 ctEmit = vec3(0.0);
{
  float style = floor(ctInfo.x + 0.5), seed = ctInfo.y;
  vec3 n = ctNrm, p = ctLocal;
  bool side = abs(n.y) < 0.5;
  if (style == 1.0 || style == 6.0) {
    // facade: storeys and window bays; roofs darker with a lighter parapet
    float fh = style == 1.0 ? 3.6 : 2.8, bw = style == 1.0 ? 3.2 : 2.4;
    float s = abs(n.x) > 0.5 ? p.z : p.x;
    vec2 cell = vec2(s / bw, p.y / fh);
    vec2 f = fract(cell);
    float win = step(0.14, f.x) * step(f.x, 0.86) * step(0.30, f.y) * step(f.y, 0.86);
    if (style == 6.0) win *= step(0.62, f.y + 0.2);
    float aa = clamp(1.6 - 2.2 * max(fwidth(cell.x), fwidth(cell.y)), 0.0, 1.0);
    vec3 glass = vec3(0.045, 0.055, 0.065) * (0.8 + 0.4 * ctHash(floor(cell) + seed));
    if (side) {
      diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb, glass, 0.55), 1.0 - aa);
      diffuseColor.rgb = mix(diffuseColor.rgb, glass, win * aa);
      ctGloss = mix(0.45, win, aa);   // (far away, where the windows are finer than a pixel, the facade keeps half the sheen)
      float lit = step(0.6, ctHash(floor(cell) * 1.37 + seed * 3.1));
      vec3 lamp = mix(vec3(1.0, 0.72, 0.42), vec3(0.75, 0.82, 0.9), step(0.8, ctHash(floor(cell) + 7.7)));
      // at night a lit window glows; where the windows get finer than a pixel the facade fades to their average
      // glow instead of sparkling
      ctEmit = lamp * ctNight * mix(0.09, 0.45 * win * lit, aa);
    } else if (n.y > 0.5) {
      diffuseColor.rgb *= 0.62;
    }
  } else if (style == 2.0) {
    // container stacks: every container (a 2.6 m tier by a 2.44 m row) its own colour, ribbed along its length,
    // dark seams between them; the ribs and seams fade out where they get finer than a pixel (no moire at range)
    vec2 q = vec2(p.y / 2.6, p.z / 2.44);
    diffuseColor.rgb = ctPal[int(mod(floor(ctHash(floor(q) + seed) * 8.0), 8.0))];
    float fr = clamp(1.0 - 2.0 * fwidth(p.x / 0.3), 0.0, 1.0);
    float rib = abs(n.z) > 0.5 ? mix(0.93, 0.86 + 0.14 * step(0.5, fract(p.x / 0.3)), fr) : 0.92;
    vec2 fq = fract(q), wq = fwidth(q);
    float seam = min(smoothstep(0.0, 0.05 + wq.x, fq.x), abs(n.x) > 0.5 ? smoothstep(0.0, 0.04 + wq.y, fq.y) : 1.0);
    seam = mix(0.85, seam, clamp(1.0 - 2.5 * max(wq.x, wq.y), 0.0, 1.0));
    diffuseColor.rgb *= rib * mix(0.35, 1.0, seam);
  } else if (style == 3.0) {
    // gate frames: orange and white bands along the bar, lit a little so they read at dusk
    float band = step(0.5, fract((p.x + p.y + p.z) / 5.0));
    diffuseColor.rgb = mix(vec3(0.88, 0.20, 0.02), vec3(0.80, 0.80, 0.78), band);
    ctEmit = diffuseColor.rgb * (0.18 + 0.5 * ctNight);
  } else if (style == 4.0) {
    // hull: anti-fouling red below the waterline (seed = its local height), a white boot-top, the paint above,
    // and the deck on top (wood on a white hull, deck green on a dark one)
    if (n.y > 0.5) diffuseColor.rgb = diffuseColor.r > 0.4 ? vec3(0.30, 0.20, 0.11) : vec3(0.10, 0.14, 0.11);
    else if (n.y > -0.5) {
      float above = p.y - seed;
      if (above < 0.0) diffuseColor.rgb = vec3(0.30, 0.045, 0.03);
      else if (above < 0.7) diffuseColor.rgb = vec3(0.70, 0.70, 0.68);
    }
  } else if (style == 5.0) {
    // painted lattice: diagonal members lighter, the gaps between them shadowed
    float s = abs(n.x) > 0.5 ? p.z : p.x;
    float a = abs(fract((s + p.y) / 2.2) - 0.5), b = abs(fract((s - p.y) / 2.2) - 0.5);
    float member = max(step(0.42, a), step(0.42, b));
    float aa = clamp(1.4 - 3.0 * fwidth(p.y), 0.0, 1.0);
    diffuseColor.rgb *= mix(0.62, mix(0.25, 1.0, member), aa);
  } else if (style == 7.0) {
    diffuseColor.rgb *= 0.85 + 0.15 * fract(sin(p.y * 3.1 + seed) * 43.7);
  } else if (style < 0.5) {
    // plain concrete and paint: weathered darker near the ground, lighter on top
    diffuseColor.rgb *= n.y > 0.5 ? 1.08 : 0.9 + 0.1 * smoothstep(0.0, 12.0, p.y);
  }
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.18, ctGloss);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += ctEmit;
// by day the glass gives back a little of the sky, most at a glancing angle (a modest stand-in for a reflection:
// the facade reads as glass, not as holes); the fog is applied after this, like to everything else
if (ctGloss > 0.0) {
  float ctF = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
  totalEmissiveRadiance += ctGloss * (1.0 - ctNight) * mix(0.06, 0.55, ctF) * vec3(0.30, 0.36, 0.44);
}`);
  };
  m.customProgramCacheKey = () => 'ctl-course-solids-v5';
  return m;
}

export function buildCourse(prims, gates, opts = {}) {
  const night = !!opts.night, detail = WORLD_QUALITY.detail || opts.quality || 'high';
  const rng = makeRng(((opts.seed || 1) * 977 + 4513) >>> 0);
  const mat = solidsMaterial(night);
  const lists = { box: [], cyl: [], tube: [], ball: [], tree: [] };
  prims.forEach((p, i) => {
    if (p.look === 'tree') lists.tree.push(i);
    else if (p.look === 'trunk') { /* the spruce over the crown draws its trunk */ }
    else if (p.shape === 'box') lists.box.push(i);
    else if (p.shape === 'cyl') lists.cyl.push(i);
    else if (p.ax === p.bx && p.ay === p.by && p.az === p.bz) lists.ball.push(i);
    else lists.tube.push(i);
  });
  const gateBars = [];
  for (const g of gates) {
    const t = Math.min(2.2, Math.max(0.6, g.w / 45));
    const up = [0, 1, 0], Z = [-g.r[2], 0, g.r[0]];
    const at = (lx, ly) => [g.x + g.r[0] * lx, g.y + ly, g.z + g.r[2] * lx];
    gateBars.push({ c: at(0, g.h / 2 + t / 2), s: [g.w + 2 * t, t, t], X: g.r, Y: up, Z });
    gateBars.push({ c: at(0, -g.h / 2 - t / 2), s: [g.w + 2 * t, t, t], X: g.r, Y: up, Z });
    for (const e of [-1, 1]) gateBars.push({ c: at(e * (g.w / 2 + t / 2), 0), s: [t, g.h + 2 * t, t], X: g.r, Y: up, Z });
  }
  const objects = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
  const Xv = new THREE.Vector3(), Yv = new THREE.Vector3(), Zv = new THREE.Vector3(), Yup = new THREE.Vector3(0, 1, 0);

  // One InstancedMesh per geometry, with the three per-instance attributes and the prim index of every instance.
  function batch(name, geo, count, fill, cast) {
    if (!count) return null;
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.name = name;
    const box = new Float32Array(count * 4), seed = new Float32Array(count), taper = new Float32Array(count).fill(1);
    const prim = new Int32Array(count).fill(-1);
    for (let k = 0; k < count; k++) {
      const r = fill(k, m4, col);
      mesh.setMatrixAt(k, m4); mesh.setColorAt(k, col);
      box[k * 4] = r.size[0]; box[k * 4 + 1] = r.size[1]; box[k * 4 + 2] = r.size[2]; box[k * 4 + 3] = r.style;
      seed[k] = r.seed || 0; if (r.taper != null) taper[k] = r.taper; prim[k] = r.prim;
    }
    geo.setAttribute('ctBox', new THREE.InstancedBufferAttribute(box, 4));
    geo.setAttribute('ctSeed', new THREE.InstancedBufferAttribute(seed, 1));
    geo.setAttribute('ctTaper', new THREE.InstancedBufferAttribute(taper, 1));
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.userData.prim = prim;
    mesh.castShadow = cast; mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    objects.push(mesh);
    return mesh;
  }

  // ---- boxes: buildings, girders, booms, hulls, quays, container stacks, and the gate frames (prim -1)
  const nb = lists.box.length;
  batch('course/boxes', new THREE.BoxGeometry(1, 1, 1), nb + gateBars.length, (k, M, c) => {
    if (k >= nb) {
      const b = gateBars[k - nb];
      Xv.fromArray(b.X); Yv.fromArray(b.Y); Zv.fromArray(b.Z);
      M.makeBasis(Xv, Yv, Zv).scale(sc.set(...b.s)).setPosition(b.c[0], b.c[1], b.c[2]);
      c.setRGB(1, 1, 1);
      return { size: b.s, style: STYLE.gate, prim: -1 };
    }
    const i = lists.box[k], p = prims[i];
    Xv.fromArray(p.X); Yv.fromArray(p.Y); Zv.fromArray(p.Z);
    M.makeBasis(Xv, Yv, Zv).scale(sc.set(2 * p.hx, 2 * p.hy, 2 * p.hz)).setPosition(p.cx, p.cy, p.cz);
    c.setRGB(...colorOf(p, i));
    const style = STYLE[p.look] != null ? STYLE[p.look] : 0;
    // a hull's seed is its waterline above the keel (the shader paints below it)
    return { size: [2 * p.hx, 2 * p.hy, 2 * p.hz], style, seed: style === 4 ? (p.water || 0) - (p.cy - p.hy) : rng() * 100, prim: i };
  }, true);

  // ---- cylinders and frustums: masts, poles, chimneys, the ships' masts
  const seg = detail === 'low' ? 6 : 10;
  batch('course/cylinders', new THREE.CylinderGeometry(1, 1, 1, seg, 1, false), lists.cyl.length, (k, M, c) => {
    const i = lists.cyl[k], p = prims[i];
    M.makeScale(p.r0, p.y1 - p.y0, p.r0).setPosition(p.x, (p.y0 + p.y1) / 2, p.z);
    c.setRGB(...colorOf(p, i));
    const style = p.look === 'truss' ? 5 : p.look === 'wood' ? 7 : p.look === 'steel' ? 0 : STYLE[p.look] || 0;
    return { size: [p.r0, p.y1 - p.y0, p.r0], style, seed: rng() * 100, taper: p.r0 > 0 ? p.r1 / p.r0 : 1, prim: i };
  }, true);

  // ---- tubes: wires, lattice members, stays and spars, from a to b with their radius
  batch('course/tubes', new THREE.CylinderGeometry(1, 1, 1, detail === 'low' ? 4 : 6, 1, true), lists.tube.length, (k, M, c) => {
    const i = lists.tube[k], p = prims[i];
    v.set(p.bx - p.ax, p.by - p.ay, p.bz - p.az);
    const len = v.length();
    q.setFromUnitVectors(Yup, v.multiplyScalar(1 / len));
    M.compose(v.set((p.ax + p.bx) / 2, (p.ay + p.by) / 2, (p.az + p.bz) / 2), q, sc.set(p.r, len, p.r));
    c.setRGB(...colorOf(p, i));
    const thin = THIN.has(p.look) || p.r < 0.2;
    return { size: [p.r, len, p.r], style: p.look === 'wire' ? 8 : thin ? 9 : p.look === 'wood' ? 7 : 0, prim: i };
  }, true);

  // ---- marker balls on the wires
  batch('course/markers', new THREE.SphereGeometry(1, 10, 8), lists.ball.length, (k, M, c) => {
    const i = lists.ball[k], p = prims[i];
    M.makeScale(p.r, p.r, p.r).setPosition(p.ax, p.ay, p.az);
    c.setRGB(...colorOf(p, i));
    return { size: [p.r, p.r, p.r], style: 0, prim: i };
  }, false);

  // ---- obstacle spruce, instanced (the look and size of OBSTACLE_TREE), over each crown prim
  if (lists.tree.length && opts.terrain) {
    const proto = buildObstacleTrees(opts.terrain, [{ x: 0, z: 0, scale: 1 }])[0];
    const trees = new THREE.InstancedMesh(proto.geometry, proto.material, lists.tree.length);
    trees.name = 'course/trees';
    const prim = new Int32Array(lists.tree.length);
    lists.tree.forEach((i, k) => {
      const p = prims[i], s = p.scale || 1;
      q.setFromAxisAngle(Yup, rng() * Math.PI * 2);
      m4.compose(v.set(p.x, p.base != null ? p.base : p.y0 - 8.375 * s, p.z), q, sc.set(s, s, s));
      trees.setMatrixAt(k, m4);
      prim[k] = i;
    });
    trees.instanceMatrix.needsUpdate = true;
    trees.userData.prim = prim;
    trees.castShadow = true; trees.receiveShadow = true;
    trees.computeBoundingSphere();
    objects.push(trees);
  }

  // ---- obstacle lights: red, the tall ones blinking; white anchor and mast lights on ships; the gates' corners.
  // Night only: by day they would be dots nobody sees, and a draw nobody needs.
  let blink = null, set = null, on = true;
  const L = opts.lights || [];
  if (night && (L.length || gates.length)) {
    set = new LightSet(L.length + gates.length * 4 + 1, 7, 1);
    set.mat.name = 'course/obstacle-lights'; set.points.name = 'course/obstacle-lights';
    blink = [];
    for (const l of L) {
      const w = l.color === 'white';
      const i = set.add(l.x, l.y, l.z, w ? 1.2 : 1.6, w ? 1.15 : 0.1, w ? 1.0 : 0.05);
      if (l.blink && i >= 0) blink.push(i);
    }
    for (const g of gates) for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      set.add(g.x + g.r[0] * a * g.w / 2, g.y + b * g.h / 2, g.z + g.r[2] * a * g.w / 2, 1.3, 0.75, 0.2);
    }
    set.finish();
    objects.push(set.points);
  }
  return {
    objects,
    // Sim time in, the tall lights' 0.8 s on / 0.7 s off; the colour buffer is rewritten only when they toggle.
    update(dt, t) {
      if (!blink || !blink.length) return;
      const now = (t % 1.5) < 0.8;
      if (now === on) return;
      on = now;
      for (const i of blink) set.setColor(i, now ? 1.6 : 0.12, now ? 0.1 : 0.01, now ? 0.05 : 0.0);
    },
  };
}
