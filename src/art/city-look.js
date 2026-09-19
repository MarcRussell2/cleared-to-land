// CITY LOOK - what mission obstacles and Metro City look like: towers and blocks (square and round), skybridges,
// the Harbor Bridge, Checkerboard Hill and its board, cranes, masts, pylons and their wires, ships, container
// stacks, the obstacle spruce of a tree wall, the gates, the city's ground (streets, the avenue, plazas, an island's
// apron) and their night lights.
//
// THIS HEADER IS THE DRAWING CONTRACT. The world side is src/world/obstacles.js (read its header for the kinds); it
// reaches this file through src/art/terrain-look.js. The art brief is docs/briefs/city/city-look.txt. The contract
// is checked by tools/test-obstacles.mjs sections 4 and 10 (plain Node, no GPU: `node tools/test-obstacles.mjs`).
//
// ---- What buildCourse is handed
//   buildCourse(prims, gates, { terrain, night, quality, seed, lights, ground })  returns
//       { objects: Object3D[], update(dt, t, pos) }   (pos: the aircraft's position, for the shadow primers below)
//   It is called once per flight, before the shaders compile; nothing may be created later.
//   `prims`: the resolved collision volumes, world space (metres; y up; the runway's threshold is near the origin):
//       { shape: 'box', cx,cy,cz, hx,hy,hz, X,Y,Z }   an oriented box: centre, half extents, unit axes (X,Y,Z is
//                                                      right-handed; Y is up for every building)
//       { shape: 'cyl', x,z, y0,y1, r0,r1 }            a vertical cylinder or frustum (radius r0 at y0, r1 at y1)
//       { shape: 'cap', ax,ay,az, bx,by,bz, r }        a capsule (a wire, a lattice member, a stay; a == b: a ball)
//     and on every prim: kind, look, name, group (one obstacle: all the prims of one tower, crane, bridge share it),
//     color (a palette name or index, may be undefined), hint (the look hints below, may be undefined), and a few
//     kind-specific numbers (a tree's scale and base, a hull's waterline `water`).
//   kind (what it is):  tower, block (buildings), skybridge, landmark (Checkerboard Hill: its hill and its board),
//     bridge-deck, bridge-pier, bridge-tower, bridge-anchor, cable (the bridge's main cables and hangers), crane, boom,
//     mast, pylon, wire, marker, ship, containers, quay, tree, box, cyl, and whatever a mission names its own `box`es.
//   look (how the plain look draws it): building, plain, concrete, hull, container, steel, wire, marker, tree, trunk,
//     truss, white, wood, insulator, hill, checker.
//   hint (the city's look hints; every generated building has one, shared by all buildings of a kind):
//       cls      'residential' | 'office' | 'industrial' | 'landmark' | 'skybridge'
//       facade   'concrete' (flats: small windows, balconies) | 'glass' (curtain wall) | 'shed' (cladding)
//       roof     'plant' (rooftop plant and water tanks) | 'crown' (a lit crown, an office tower's top) | 'flat' |
//                'spire' (the Needle)
//       lit      0..1, the fraction of windows lit at night
//       height   'low' (< 25 m) | 'mid' (< 60) | 'high' (< 150) | 'super' (taller)
//       landmark 'needle' (the Needle's towers and skybridge) | 'checkerboard'; part 'hill' | 'board' (with squares
//                [across, up]); bridge: { part: 'deck' | 'pier' | 'tower' | 'portal' | 'anchor' | 'main-cable' |
//                'hanger', bridge: 'suspension', paint }
//   `gates`: { x,y,z, w,h, r (unit right), n (unit through), psi, name, required, bonus, bank } - markers, never solid.
//   `lights`: { x,y,z, blink, color: 'red' | 'white' | 'amber' } obstacle lights, floodlights, bridge lamps.
//   `ground`: areas drawn flat on the ground, never solid, in drawing order (first drawn wins where two overlap):
//       { kind: 'city' | 'avenue' | 'plaza' | 'apron', x,z (the rectangle's corner), ux,uz / vx,vz (unit vectors
//         along its two sides), lu, lv (their lengths), y (a fixed height: an island's apron) or null (draped on the
//         terrain), grid: { x,z (origin), p, q (unit axes), pitchP, pitchQ (block pitch), street (width) } for a
//         district's street grid (blocks centred on the grid points, streets half a pitch off them) or null,
//         skip: [rectangles, same form] cells not to draw (where a mission carved the site's blocks away) }
//   `terrain`: the live Terrain (height(x, z), waterLevel...); read only. `seed`: the course's seed (makeRng).
//   `quality`/WORLD_QUALITY.detail: 'high' | 'medium' | 'low'.
//
// ---- What must be true of what it returns (tools/test-obstacles.mjs checks all of it)
//   1. WHAT IS DRAWN SOLID IS WHAT COLLIDES. Draw every solid from its prim's own numbers. Detail may be added INSIDE
//      a volume (a crown, setbacks, balconies, a rooftop plant box - within 0.5 m + 2% of each side), and the drawing
//      of each prim must fill its volume (reach every face within the same tolerance): an airplane that clears the
//      drawing clears the volume, and one that hits the drawing hits the volume. Every solid is drawn (the trunks under
//      a drawn spruce excepted).
//   2. Every mesh that draws solids says which: an InstancedMesh carries userData.prim (Int32Array, the prim index of
//      each instance), a merged Mesh a vertex attribute `ctPrim` (the prim index of each vertex). Markers and
//      decoration (the gate frames: prim -1; the ground: userData.decor = true) are never solid; the ground lies on
//      the terrain (within 1.5 m of it) or at its area's `y`.
//   3. Obstacle trees are the bush strips' spruce (world-vegetation.js buildObstacleTrees, the OBSTACLE_TREE size),
//      placed at their crown prim's x, z, base and scale.
//   4. Night: the lights (and lit windows) only when `night`; no light object by day. Every light in `lights` and the
//      four corners of every gate are drawn (more are welcome within the budget: street lamps, window glow).
//   4b. Gates stay visible markers: the plain look's four bars a gate (instances with prim -1), or a decoration mesh
//      named with "gate" in it.
//   5. Budgets for the whole course (tools/test-obstacles.mjs section 10 measures Metro City with The Gauntlet's
//      course, the biggest): at most 60 draws by day (+1 for the lights at night) and, submitted per pass counting
//      every instance, 450k triangles at high, 250k at medium, 120k at low; canvas textures at most 8 MB in all; at
//      most 6 programs of its own. (The plain look below: 5 draws by day, 6 at night, 138k / 88k / 69k triangles.)
//   6. The shadow primers (below) stay: two 1 mm instanced casters, with and without instance colours.
//
// ---- The plain look (this file as the city ladder left it: the brief asks the art department to replace it)
// Draw calls: one InstancedMesh per geometry - boxes, cylinders, tubes, marker balls, trees - sharing ONE material
// and program (course/solids) except the trees; one draped Mesh for the ground (course/ground); one LightSet at night.
// Plus, for the first half second of a flight only, two 1 mm "shadow primers" (instanced casters with and without
// instance colours) riding with the aircraft (userData.primer), so the shadow pass compiles both instanced depth
// programs in the first frame, and not when the course or the aerodrome first reaches the sun's shadow box
// mid-approach (the engine's up-front compile does not cover the shadow pass); then they are hidden for good.
// Every InstancedMesh is one bounding sphere round the whole course: nothing is culled by district; a box is 12
// triangles, so drawing all 4,500 buildings of Metro City in every pass is 55k triangles in one draw (see the perf
// numbers in docs/briefs/city/city-look.txt, measured with tools/perf-probe.mjs).
// The per-instance attributes decide the finish:
//   ctBox   vec4  size in metres (x, y, z) and the style: 0 plain, 1 glass office facade, 2 container stack,
//                 3 gate stripes, 4 ship's hull, 5 painted lattice, 6 house / flats (small windows), 7 wood, 8 wire,
//                 9 steel member (8 and 9 are the thin ones), 10 round glass facade, 11 hill, 12 checkerboard,
//                 13 shed cladding
//   ctSeed  float per-instance variation (windows, container colours); for a hull, its waterline above the keel
//   ctTaper float top radius / bottom radius of a frustum (1 for everything else)
//   ctLit   float the fraction of its windows lit at night (the hint's `lit`; 0.4 without one)
//   (the shader's local coordinates run from the box's lower corner, in metres: windows, tiers and the waterline
//   are measured from the base)
// House rules (src/art/AGENTS.md): every material named; uniforms prefixed `ct` (never `at`, which is the
// atmosphere's); no material cached at module level (built per call, per scene); customProgramCacheKey with every
// onBeforeCompile; seeded randomness only (makeRng from the course seed); no point or spot lights; linear colours,
// sunlit white about 0.8, nothing but lamps above 1; nothing allocated per frame - update() only rewrites the
// lights' colours when a blinker toggles (and moves the two shadow primers during the first half second).
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
  // (gate frames: a face square to a low sun lights to about 1.45 x its albedo here - measured on the harbor's
  // entrance gate at 17:12 - so the white is 0.55 to stay at sunlit white's 0.8, under the 0.92 bloom threshold)
  markers: [[0.85, 0.24, 0.02], [0.78, 0.78, 0.76]], gate: [0.72, 0.16, 0.02], gateWhite: [0.55, 0.55, 0.53],
  buildings: [[0.30, 0.30, 0.29], [0.36, 0.33, 0.28], [0.20, 0.23, 0.26], [0.42, 0.40, 0.36], [0.26, 0.20, 0.16], [0.14, 0.16, 0.18]],
  // the city's buildings by facade: weathered concrete and tile for the flats, aluminium and dark frames for the
  // offices, cladding for the sheds; the Needle's glass
  flats: [[0.36, 0.34, 0.30], [0.42, 0.40, 0.36], [0.30, 0.30, 0.29], [0.40, 0.36, 0.30], [0.33, 0.35, 0.36], [0.45, 0.43, 0.40]],
  offices: [[0.20, 0.23, 0.26], [0.16, 0.19, 0.22], [0.26, 0.27, 0.28], [0.12, 0.14, 0.17], [0.30, 0.30, 0.29], [0.18, 0.20, 0.20]],
  shed: [0.30, 0.31, 0.32], needle: [0.22, 0.26, 0.30],
  // Checkerboard Hill: grass and rock, and the board's orange and white (the white under sunlit white)
  hill: [0.07, 0.10, 0.045], rock: [0.20, 0.19, 0.17], checker: [0.66, 0.13, 0.025], checkerWhite: [0.58, 0.58, 0.56],
  // weathered shipping-line paint: navy, grey, rust red, brown, orange, off-white, green, ochre (in the order of
  // CONTAINER_SHARE, most common first; a real yard is mostly two or three lines' colours)
  containers: [[0.055, 0.12, 0.22], [0.25, 0.25, 0.24], [0.28, 0.075, 0.045], [0.17, 0.085, 0.05], [0.38, 0.15, 0.045], [0.48, 0.48, 0.46], [0.075, 0.15, 0.095], [0.38, 0.30, 0.09]],
};
const CONTAINER_SHARE = [0.30, 0.22, 0.18, 0.10, 0.07, 0.06, 0.04, 0.03];
const CONTAINER_MEAN = [0, 1, 2].map((k) => COLORS.containers.reduce((s, c, i) => s + c[k] * CONTAINER_SHARE[i], 0));
const STYLE = { plain: 0, concrete: 0, quay: 0, building: 1, container: 2, gate: 3, hull: 4, truss: 5, white: 6, wood: 7, wire: 8, steel: 9, insulator: 9, marker: 0, trunk: 7, hill: 11, checker: 12 };
const FACADE = { glass: 1, concrete: 6, shed: 13 };
const THIN = new Set(['wire', 'steel', 'insulator']);

function colorOf(p, i) {
  const c = p.color, h = p.hint;
  if (p.look === 'building') {
    if (h && h.landmark === 'needle') return COLORS.needle;
    if (h && h.facade) {
      const pal = h.facade === 'glass' ? COLORS.offices : h.facade === 'shed' ? [COLORS.shed] : COLORS.flats;
      return pal[(typeof c === 'number' ? c : p.group * 7 + 3) % pal.length];
    }
    return typeof c === 'number' ? COLORS.buildings[c % COLORS.buildings.length] : COLORS[c] || COLORS.buildings[(p.group * 7 + 3) % COLORS.buildings.length];
  }
  if (p.look === 'container') return COLORS.containers[(typeof c === 'number' ? c : i) % 8];
  if (p.look === 'marker') return COLORS.markers[(c || 0) % 2];
  if (p.look === 'wire') return COLORS.wire;
  if (p.look === 'insulator') return COLORS.insulator;
  if (p.look === 'trunk' || p.look === 'wood') return COLORS[c] || COLORS.wood;
  if (p.look === 'hill') return COLORS.hill;
  if (p.look === 'checker') return COLORS.checker;
  return (typeof c === 'string' && COLORS[c]) || COLORS.concrete;
}
// a building's facade style from its hint (the plain office facade without one, as before)
const facadeOf = (p) => (p.hint && FACADE[p.hint.facade]) || STYLE[p.look] || 0;
const litOf = (p) => (p.hint && p.hint.lit != null ? p.hint.lit : 0.4);

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
    ctPalMean: { value: new THREE.Vector3(...CONTAINER_MEAN) },
    ctGate: { value: [new THREE.Vector3(...COLORS.gate), new THREE.Vector3(...COLORS.gateWhite)] },
    ctHill: { value: [new THREE.Vector3(...COLORS.hill), new THREE.Vector3(...COLORS.rock)] },
    ctCheck: { value: [new THREE.Vector3(...COLORS.checker), new THREE.Vector3(...COLORS.checkerWhite)] },
  };
  // the palette's cumulative shares, for the shader's weighted pick (baked in as constants)
  let acc = 0;
  const cut = CONTAINER_SHARE.slice(0, 7).map((s) => (acc += s).toFixed(3));
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 ctBox;
attribute float ctSeed;
attribute float ctTaper;
attribute float ctLit;
uniform float ctWire;
varying vec3 ctLocal;
varying vec3 ctNrm;
varying vec3 ctInfo;
varying vec3 ctSize;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
// a frustum's side leans in: tilt its normals up to match (the instance's scale then carries the slope)
if (abs(normal.y) < 0.5) objectNormal.y += 1.0 - ctTaper;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
ctLocal = (position + 0.5) * ctBox.xyz;   // metres from the box's lower corner (windows and tiers start at the base)
ctNrm = normal;
ctInfo = vec3(ctBox.w, ctSeed, ctLit);
ctSize = ctBox.xyz;
transformed.xz *= mix(1.0, ctTaper, clamp(position.y + 0.5, 0.0, 1.0));
#ifdef USE_INSTANCING
if (ctBox.w > 7.5 && ctBox.w < 9.5) {
  vec4 ctCentre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float ctRadius = length(instanceMatrix[0].xyz);
  transformed.xz *= max(1.0, ctWire * (ctBox.w > 8.5 ? 0.7 : 1.0) * max(-ctCentre.z, 1.0) / max(ctRadius, 1e-3));
}
#endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float ctNight;
uniform vec3 ctPal[8];
uniform vec3 ctPalMean;
uniform vec3 ctGate[2];
uniform vec3 ctHill[2];
uniform vec3 ctCheck[2];
varying vec3 ctLocal;
varying vec3 ctNrm;
varying vec3 ctInfo;
varying vec3 ctSize;
float ctHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float ctNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(ctHash(i), ctHash(i + vec2(1.0, 0.0)), f.x), mix(ctHash(i + vec2(0.0, 1.0)), ctHash(i + 1.0), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float ctGloss = 0.0;
float ctMatte = 0.0;
vec3 ctEmit = vec3(0.0);
{
  float style = floor(ctInfo.x + 0.5), seed = ctInfo.y, litFrac = ctInfo.z;
  vec3 n = ctNrm, p = ctLocal;
  bool side = abs(n.y) < 0.5;
  if (style == 1.0 || style == 6.0 || style == 10.0) {
    // facade: storeys and window bays; roofs darker with a lighter parapet. Flats (6): lower storeys, small windows.
    // Round (10): the bays run round the circumference.
    float fh = style == 6.0 ? 2.8 : 3.6, bw = style == 6.0 ? 2.4 : 3.2;
    float s = style == 10.0 ? atan(n.z, n.x) * ctSize.x : abs(n.x) > 0.5 ? p.z : p.x;
    vec2 cell = vec2(s / bw, p.y / fh);
    vec2 f = fract(cell);
    float win = step(0.14, f.x) * step(f.x, 0.86) * step(0.30, f.y) * step(f.y, 0.86);
    if (style == 6.0) win *= step(0.62, f.y + 0.2);
    float aa = clamp(1.6 - 2.2 * max(fwidth(cell.x), fwidth(cell.y)), 0.0, 1.0);
    vec3 glass = vec3(0.045, 0.055, 0.065) * (0.8 + 0.4 * ctHash(floor(cell) + seed));
    if (side) {
      diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb, glass, 0.55), 1.0 - aa);
      diffuseColor.rgb = mix(diffuseColor.rgb, glass, win * aa);
      ctGloss = mix(0.45, win, aa) * (style == 6.0 ? 0.6 : 1.0);   // (far away, where the windows are finer than a pixel, the facade keeps half the sheen)
      float lit = step(1.0 - litFrac, ctHash(floor(cell) * 1.37 + seed * 3.1));
      vec3 lamp = mix(vec3(1.0, 0.72, 0.42), vec3(0.75, 0.82, 0.9), step(0.8, ctHash(floor(cell) + 7.7)));
      // at night a lit window glows; where the windows get finer than a pixel the facade fades to their average
      // glow instead of sparkling
      ctEmit = lamp * ctNight * mix(0.2 * litFrac, 0.45 * win * lit, aa);
    } else if (n.y > 0.5) {
      diffuseColor.rgb *= 0.62;
    }
  } else if (style == 2.0) {
    // container stacks (a 2.6 m tier by a 2.44 m row): a run of three rows shares one line's colour, with one box in
    // four an odd one out, from a muted palette weighted to navy, grey and rust (CONTAINER_SHARE); ribbed along the
    // length, dark seams between boxes. Where a box gets smaller than about three pixels the stack fades to the
    // palette's average colour, and the ribs and seams fade out, so a yard at range is a quiet block, not confetti.
    vec2 q = vec2(p.y / 2.6, p.z / 2.44), cq = floor(q);
    float h = ctHash(vec2(floor(cq.y / 3.0) + 0.37, seed));
    if (ctHash(cq + seed * 1.7 + 11.0) < 0.25) h = ctHash(cq + seed + 5.3);
    int ci = h < ${cut[0]} ? 0 : h < ${cut[1]} ? 1 : h < ${cut[2]} ? 2 : h < ${cut[3]} ? 3 : h < ${cut[4]} ? 4 : h < ${cut[5]} ? 5 : h < ${cut[6]} ? 6 : 7;
    vec2 fq = fract(q), wq = fwidth(q);
    diffuseColor.rgb = mix(ctPal[ci], ctPalMean, clamp(3.0 * max(wq.x, wq.y) - 0.8, 0.0, 1.0));
    float fr = clamp(1.0 - 2.0 * fwidth(p.x / 0.3), 0.0, 1.0);
    float rib = abs(n.z) > 0.5 ? mix(0.93, 0.86 + 0.14 * step(0.5, fract(p.x / 0.3)), fr) : 0.92;
    float seam = min(smoothstep(0.0, 0.05 + wq.x, fq.x), abs(n.x) > 0.5 ? smoothstep(0.0, 0.04 + wq.y, fq.y) : 1.0);
    seam = mix(0.85, seam, clamp(1.0 - 2.5 * max(wq.x, wq.y), 0.0, 1.0));
    diffuseColor.rgb *= rib * mix(0.35, 1.0, seam);
  } else if (style == 3.0) {
    // gate frames: orange and white bands along the bar, matte (a painted marker has no sheen: at a grazing sun a
    // glossier white read brighter), the white at 0.55 (see COLORS), a touch of their own light by day (0.04)
    // and a glow at night
    float band = step(0.5, fract((p.x + p.y + p.z) / 5.0));
    diffuseColor.rgb = mix(ctGate[0], ctGate[1], band);
    ctEmit = diffuseColor.rgb * (0.04 + 0.5 * ctNight);
    ctMatte = 1.0;
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
  } else if (style == 11.0) {
    // the hill: grass, with rock where the noise says so and on the crown (a frustum: its side is all slope)
    float ang = atan(n.z, n.x) * ctSize.x;
    float rk = ctNoise(vec2(ang, p.y) / 18.0) * 0.65 + ctNoise(vec2(ang, p.y) / 5.0) * 0.35;
    float rockiness = smoothstep(0.52, 0.68, rk + 0.25 * smoothstep(0.55, 1.0, p.y / max(ctSize.y, 1.0)));
    diffuseColor.rgb = mix(ctHill[0] * (0.85 + 0.3 * ctNoise(vec2(ang, p.y) / 9.0)), ctHill[1], rockiness);
    ctMatte = 1.0;
  } else if (style == 12.0) {
    // the checkerboard: 10 m squares on the board's broad faces (its local Y faces), a grey frame round the edges
    if (abs(n.y) > 0.5) {
      float par = mod(floor(p.x / 10.0) + floor(p.z / 10.0), 2.0);
      diffuseColor.rgb = mix(ctCheck[0], ctCheck[1], par);
      float edge = min(min(p.x, ctSize.x - p.x), min(p.z, ctSize.z - p.z));
      diffuseColor.rgb = mix(vec3(0.25), diffuseColor.rgb, step(1.2, edge));
      ctEmit = diffuseColor.rgb * 0.35 * ctNight;   // floodlit at night
    } else diffuseColor.rgb = vec3(0.22, 0.22, 0.21);
    ctMatte = 1.0;
  } else if (style == 13.0) {
    // shed cladding: vertical ribs, a band of high windows, a pale roof
    if (side) {
      float s = abs(n.x) > 0.5 ? p.z : p.x;
      diffuseColor.rgb *= 0.86 + 0.14 * step(0.5, fract(s / 0.9));
      float band = step(ctSize.y - 3.5, p.y) * step(p.y, ctSize.y - 1.5) * step(0.2, fract(s / 6.0));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.06, 0.07), band);
      ctEmit = vec3(1.0, 0.8, 0.5) * 0.25 * band * ctNight * litFrac * 4.0;
    } else if (n.y > 0.5) diffuseColor.rgb *= 1.15;
  } else if (style < 0.5) {
    // plain concrete and paint: weathered darker near the ground, lighter on top
    diffuseColor.rgb *= n.y > 0.5 ? 1.08 : 0.9 + 0.1 * smoothstep(0.0, 12.0, p.y);
  }
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(mix(roughnessFactor, 0.18, ctGloss), 1.0, ctMatte);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += ctEmit;
// by day the glass gives back a little of the sky, most at a glancing angle (a modest stand-in for a reflection:
// the facade reads as glass, not as holes); the fog is applied after this, like to everything else
if (ctGloss > 0.0) {
  float ctF = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
  totalEmissiveRadiance += ctGloss * (1.0 - ctNight) * mix(0.06, 0.55, ctF) * vec3(0.30, 0.36, 0.44);
}`);
  };
  m.customProgramCacheKey = () => 'ctl-course-solids-v7';
  return m;
}

// ---- the city's ground: streets, the avenue, plazas, an island's apron. One mesh (course/ground), never solid.
// Each area is a grid of cells about `step` metres; a cell is drawn unless an earlier area covers its middle, it is in
// one of the area's `skip` rectangles, or (draped areas) any of its corners is on the water or its edge. Vertices sit
// 0.3 m over the terrain (or at the area's `y`); the vertex shader lifts them a little more with distance (0.5 m per
// kilometre), where the terrain's own mesh is coarser than the analytic height the drape follows.
const GROUND_KIND = { city: 0, avenue: 1, plaza: 2, apron: 3 };
function inRect(r, x, z) {
  const dx = x - r.x, dz = z - r.z, a = dx * r.ux + dz * r.uz, b = dx * r.vx + dz * r.vz;
  return a >= 0 && a <= r.lu && b >= 0 && b <= r.lv;
}
function groundMaterial(night) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
  m.name = 'course/ground';
  const uniforms = { ctNight: { value: night ? 1 : 0 } };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 ctGrid;
attribute vec2 ctKind;
varying vec4 ctG;
varying vec2 ctK;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
ctG = ctGrid; ctK = ctKind;
transformed.y += 0.0005 * distance(transformed, cameraPosition);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float ctNight;
varying vec4 ctG;
varying vec2 ctK;
float ctGHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 ctGEmit = vec3(0.0);
{
  float kind = floor(ctK.x + 0.5), street = ctK.y;
  vec2 lp = ctG.xy, pitch = max(ctG.zw, vec2(1.0));
  vec3 asphalt = vec3(0.038, 0.038, 0.040), walk = vec3(0.16, 0.155, 0.145), plot = vec3(0.12, 0.118, 0.11);
  if (kind < 0.5) {
    // a district: streets half a pitch off the block centres, a 3 m pavement each side, the plots between
    vec2 f = abs(fract(lp / pitch - 0.5) - 0.5) * pitch;            // metres from the nearest street's middle
    float d = min(f.x, f.y);
    diffuseColor.rgb = d < street * 0.5 ? asphalt : d < street * 0.5 + 3.0 ? walk : plot;
    diffuseColor.rgb *= 0.9 + 0.2 * ctGHash(floor(lp / pitch + 0.5));
    ctGEmit = vec3(1.0, 0.62, 0.26) * 0.035 * ctNight * (1.0 - smoothstep(street * 0.5, street * 0.5 + 4.0, d));
  } else if (kind < 1.5) {
    // the avenue: a boulevard down lp.y = 0 (six lanes, a median), pavements, then paving
    float v = abs(lp.y);
    diffuseColor.rgb = v < 2.5 ? vec3(0.07, 0.09, 0.05) : v < 57.0 ? asphalt : v < 64.0 ? walk : plot;
    float lane = abs(fract((v - 2.5) / 9.0) - 0.5) * 9.0;
    if (v > 2.5 && v < 57.0 && lane < 0.08 && fract(lp.x / 12.0) < 0.5) diffuseColor.rgb = vec3(0.55);
    ctGEmit = vec3(1.0, 0.62, 0.26) * 0.05 * ctNight * step(2.5, v) * (1.0 - smoothstep(57.0, 66.0, v));
  } else if (kind < 2.5) {
    // a plaza: pale paving on an 8 m grid
    vec2 f = abs(fract(lp / 8.0) - 0.5);
    diffuseColor.rgb = walk * (0.92 + 0.08 * step(0.47, max(f.x, f.y)));
    ctGEmit = vec3(1.0, 0.7, 0.35) * 0.02 * ctNight;
  } else {
    // an apron: concrete slabs with dark joints
    vec2 f = abs(fract(lp / 20.0) - 0.5);
    diffuseColor.rgb = vec3(0.2, 0.2, 0.19) * (0.94 + 0.06 * ctGHash(floor(lp / 20.0))) * (1.0 - 0.3 * step(0.49, max(f.x, f.y)));
    ctGEmit = vec3(1.0, 0.8, 0.55) * 0.03 * ctNight;
  }
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += ctGEmit;`);
  };
  m.customProgramCacheKey = () => 'ctl-course-ground-v1';
  return m;
}

function buildGroundMesh(areas, terrain, detail, night) {
  const step = detail === 'low' ? 60 : detail === 'medium' ? 40 : 25;
  const water = terrain && terrain.waterLevel != null ? terrain.waterLevel : -1e9;
  const pos = [], nrm = [], grid = [], kind = [], idx = [];
  const n = new THREE.Vector3();
  areas.forEach((a, ai) => {
    const nu = Math.max(1, Math.ceil(a.lu / step)), nv = Math.max(1, Math.ceil(a.lv / step));
    const du = a.lu / nu, dv = a.lv / nv, k = GROUND_KIND[a.kind] != null ? GROUND_KIND[a.kind] : 2;
    const base = pos.length / 3, h = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const x = a.x + a.ux * i * du + a.vx * j * dv, z = a.z + a.uz * i * du + a.vz * j * dv;
      const y = a.y != null ? a.y : terrain.height(x, z);
      h.push(y);
      pos.push(x, y + (a.y != null ? 0.05 : 0.3), z);
      if (a.y == null) { terrain.normal(x, z, n); nrm.push(n.x, n.y, n.z); } else nrm.push(0, 1, 0);
      // the pattern's own coordinates: along and across the street grid (from its origin), or the area's (from its middle)
      let lp, lq;
      if (a.grid) { const gx = x - a.grid.x, gz = z - a.grid.z; lp = gx * a.grid.p[0] + gz * a.grid.p[1]; lq = gx * a.grid.q[0] + gz * a.grid.q[1]; }
      else { lp = i * du - a.lu / 2; lq = j * dv - a.lv / 2 + (a.kind === 'avenue' ? 0 : 0); }
      if (a.kind === 'avenue') { const cx = a.x + a.vx * a.lv / 2, cz = a.z + a.vz * a.lv / 2; lq = (x - cx) * a.vx + (z - cz) * a.vz; }
      grid.push(lp, lq, a.grid ? a.grid.pitchP : 0, a.grid ? a.grid.pitchQ : 0);
      kind.push(k, a.grid ? a.grid.street : 18);
    }
    const row = nu + 1;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const cx = a.x + a.ux * (i + 0.5) * du + a.vx * (j + 0.5) * dv, cz = a.z + a.uz * (i + 0.5) * du + a.vz * (j + 0.5) * dv;
      let covered = false;
      for (let e = 0; e < ai && !covered; e++) covered = inRect(areas[e], cx, cz);
      for (let e = 0; e < (a.skip || []).length && !covered; e++) covered = inRect(a.skip[e], cx, cz);
      if (covered) continue;
      const q = [j * row + i, j * row + i + 1, (j + 1) * row + i + 1, (j + 1) * row + i];
      if (a.y == null && q.some((v) => h[v] < water + 0.5)) continue;
      // (the triangles face up: (0, 3, 1) and (1, 3, 2) wind anticlockwise seen from above)
      idx.push(base + q[0], base + q[3], base + q[1], base + q[1], base + q[3], base + q[2]);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('ctGrid', new THREE.Float32BufferAttribute(grid, 4));
  geo.setAttribute('ctKind', new THREE.Float32BufferAttribute(kind, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, groundMaterial(night));
  mesh.name = 'course/ground';
  mesh.receiveShadow = true; mesh.castShadow = false;
  mesh.userData.decor = true;
  return mesh;
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

  // One InstancedMesh per geometry, with the four per-instance attributes and the prim index of every instance.
  function batch(name, geo, count, fill, cast) {
    if (!count) return null;
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.name = name;
    const box = new Float32Array(count * 4), seed = new Float32Array(count), taper = new Float32Array(count).fill(1), lit = new Float32Array(count).fill(0.4);
    const prim = new Int32Array(count).fill(-1);
    for (let k = 0; k < count; k++) {
      const r = fill(k, m4, col);
      mesh.setMatrixAt(k, m4); mesh.setColorAt(k, col);
      box[k * 4] = r.size[0]; box[k * 4 + 1] = r.size[1]; box[k * 4 + 2] = r.size[2]; box[k * 4 + 3] = r.style;
      seed[k] = r.seed || 0; if (r.taper != null) taper[k] = r.taper; if (r.lit != null) lit[k] = r.lit; prim[k] = r.prim;
    }
    geo.setAttribute('ctBox', new THREE.InstancedBufferAttribute(box, 4));
    geo.setAttribute('ctSeed', new THREE.InstancedBufferAttribute(seed, 1));
    geo.setAttribute('ctTaper', new THREE.InstancedBufferAttribute(taper, 1));
    geo.setAttribute('ctLit', new THREE.InstancedBufferAttribute(lit, 1));
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.userData.prim = prim;
    mesh.castShadow = cast; mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    objects.push(mesh);
    return mesh;
  }

  // ---- boxes: buildings, skybridges, girders, booms, hulls, quays, container stacks, the bridge's deck and towers,
  // the checkerboard, and the gate frames (prim -1)
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
    const style = p.look === 'building' ? facadeOf(p) : STYLE[p.look] != null ? STYLE[p.look] : 0;
    // a hull's seed is its waterline above the keel (the shader paints below it)
    return { size: [2 * p.hx, 2 * p.hy, 2 * p.hz], style, seed: style === 4 ? (p.water || 0) - (p.cy - p.hy) : rng() * 100, lit: litOf(p), prim: i };
  }, true);

  // ---- cylinders and frustums: masts, poles, chimneys, the ships' masts, round towers, the hill
  const seg = detail === 'low' ? 6 : 10;
  const segRound = detail === 'low' ? 12 : detail === 'medium' ? 16 : 24;
  // (round buildings and the hill need more sides than a mast: a separate geometry, the same material)
  const roundish = (p) => p.look === 'building' || p.look === 'hill';
  const cylFill = (list) => (k, M, c) => {
    const i = list[k], p = prims[i];
    M.makeScale(p.r0, p.y1 - p.y0, p.r0).setPosition(p.x, (p.y0 + p.y1) / 2, p.z);
    c.setRGB(...colorOf(p, i));
    const style = p.look === 'building' ? 10 : p.look === 'hill' ? 11 : p.look === 'truss' ? 5 : p.look === 'wood' ? 7 : p.look === 'steel' ? 0 : STYLE[p.look] || 0;
    return { size: [p.r0, p.y1 - p.y0, p.r0], style, seed: rng() * 100, taper: p.r0 > 0 ? p.r1 / p.r0 : 1, lit: litOf(p), prim: i };
  };
  const thinCyl = lists.cyl.filter((i) => !roundish(prims[i])), fatCyl = lists.cyl.filter((i) => roundish(prims[i]));
  batch('course/cylinders', new THREE.CylinderGeometry(1, 1, 1, seg, 1, false), thinCyl.length, cylFill(thinCyl), true);
  batch('course/rounds', new THREE.CylinderGeometry(1, 1, 1, segRound, 1, false), fatCyl.length, cylFill(fatCyl), true);

  // ---- tubes: wires, lattice members, stays and spars, the bridge's cables, from a to b with their radius
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

  // ---- the ground: streets, the avenue, plazas, aprons (never solid)
  if (opts.ground && opts.ground.length && opts.terrain) objects.push(buildGroundMesh(opts.ground, opts.terrain, detail, night));

  // ---- shadow primers. The shadow pass compiles a depth program for each kind of instanced caster (with or without
  // instance colours) the first time one enters the sun's shadow box, and the engine compiles the world up front
  // (compileAsync in main.js startCompile) without the shadow pass: a course that starts away from everything else
  // instanced (the harbor's, over open water) had that compile 7 s into the flight. One 1 mm instance per kind rides
  // with the aircraft for the first half second (update() moves it), so the program is compiled in the first frame
  // with the rest of the world, and is then hidden for good. Each shares a course mesh's geometry and material and
  // draws nothing anyone can see.
  // Both kinds are primed whatever the course has: the aerodrome's and the forest's instanced casters (no instance
  // colours) otherwise compile theirs when the runway reaches the shadow box, on short final (Harbor City: 2 s before
  // touchdown). A course without trees pays one extra program for that (course/solids without instance colours),
  // compiled up front with everything else.
  const primers = [];
  const casters = objects.filter((o) => o.isInstancedMesh && o.castShadow);
  for (const colour of [true, false]) {
    if (!casters.length) break;
    const o = casters.find((c) => !!c.instanceColor === colour) || casters[0];
    const p = new THREE.InstancedMesh(o.geometry, o.material, 1);
    p.name = 'course/shadow-primer';
    p.setMatrixAt(0, m4.makeScale(1e-3, 1e-3, 1e-3));
    if (colour) p.setColorAt(0, col.setRGB(0, 0, 0));
    p.castShadow = true; p.receiveShadow = o.receiveShadow;
    p.userData.primer = true;
    p.computeBoundingSphere();
    primers.push(p);
    objects.push(p);
  }
  let priming = primers.length > 0;

  // ---- obstacle lights: red, the tall ones blinking; white anchor and mast lights on ships, and the floodlights on
  // the checkerboard; amber (sodium) lamps on the bridge deck; the gates' corners. Night only: by day they would be
  // dots nobody sees, and a draw nobody needs.
  let blink = null, set = null, on = true;
  const L = opts.lights || [];
  if (night && (L.length || gates.length)) {
    set = new LightSet(L.length + gates.length * 4 + 1, 7, 1);
    set.mat.name = 'course/obstacle-lights'; set.points.name = 'course/obstacle-lights';
    blink = [];
    for (const l of L) {
      const i = l.color === 'white' ? set.add(l.x, l.y, l.z, 1.2, 1.15, 1.0) : l.color === 'amber' ? set.add(l.x, l.y, l.z, 1.4, 0.72, 0.25) : set.add(l.x, l.y, l.z, 1.6, 0.1, 0.05);
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
    // Sim time in, the tall lights' 0.8 s on / 0.7 s off; the colour buffer is rewritten only when they toggle. `pos`
    // (the aircraft) places the shadow primers for the first half second of the flight.
    update(dt, t, pos) {
      if (priming) {
        if (t < 0.5 && pos) for (const p of primers) p.position.copy(pos);
        else { for (const p of primers) p.visible = false; priming = false; }
      }
      if (!blink || !blink.length) return;
      const now = (t % 1.5) < 0.8;
      if (now === on) return;
      on = now;
      for (const i of blink) set.setColor(i, now ? 1.6 : 0.12, now ? 0.1 : 0.01, now ? 0.05 : 0.0);
    },
  };
}
