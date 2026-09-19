// WEATHER LOOK - what storms, rain, snow, dust and lightning look like.
//
// Contract (the engine side is src/systems/weather.js, which this file must not import):
//   new WeatherLook(scene, { spec, sky, quality, touch })   built once per flight in loadSite, before the
//       shaders compile, and only when the scenario has a `weather` spec. `spec` is the RESOLVED spec (the
//       preset's defaults filled in: src/systems/weather.js resolveWeatherSpec, called by main.js). Everything
//       is built here, hidden where need be: anything created mid-flight compiles synchronously and stalls the
//       frame (three's compileAsync walks invisible objects too, so hidden meshes are compiled at the start).
//   update(dt, state, { camera, t, sky, renderer, ac, cameraMode })   every frame; no allocations, no
//       needsUpdate. `state` is Weather.state: { rain, snow, dust, darkness, ceiling, ceilingY, cloudTop, vis,
//       flash, bolt {on,x,z,y0,y1,variant,dist,cg}, strike, strikePower, shafts[4] {x,z,r,a}, nShafts, wind (m/s
//       at the aircraft), fieldY, kind }. `t` is SIM time (seconds since the flight began): nothing here reads a
//       clock.
//   dispose()   takes its meshes out of the scene and frees their buffers and the deck texture (not the
//               materials: see dispose() below)
//
// What it draws, and the rules each part follows:
//   precipitation   ONE instanced draw (rain streaks, snow flakes or blowing dust, chosen at build from the
//                   spec). The drops live in a box wrapped around the camera in the vertex shader: each drop's
//                   position is its seed times the box plus the fall (wind included) integrated on the CPU as
//                   one offset uniform, taken modulo the box around the camera. A streak runs from where the
//                   drop is to where it was, relative to the camera, over a short exposure, so rain seen from a
//                   fast airplane streams at the windscreen and rain seen from the tower falls. The mesh sits at
//                   the camera with a bounding sphere around it, so it is culled honestly and never frustum-
//                   culled out. Width never drops below ~1.3 pixels; a streak widened to that is made fainter by
//                   the same factor, so distant rain is a veil, not a hatch. The nearest drops fade out, further
//                   out the longer the lens (the tower's zoom), so no drop is ever magnified across the picture.
//   storm deck      the cloud base: ONE opaque plane at the ceiling (weather.ceiling metres above the field),
//                   following the camera, with a baked periodic belly texture (256 px, two samples). It replaces
//                   the sky's own cloud sheets (hidden: the deck would hide them anyway, and a third layer would
//                   break the sky budget in docs/PERF.md). It darkens with `darkness`, glows warm toward a low sun
//                   along the far edge, flashes from inside around each strike, and hazes into the shared
//                   atmosphere(d), so its far edge meets the sky dome without a seam. Seen from above its base
//                   (the camera inside the cloud) it is drawn as the cloud itself, never as a dark floor.
//   rain shafts     up to four vertical curtains under the storm cells and the microburst (state.shafts), one
//                   draw, cylindrical billboards from the ground into the deck, hazed like everything else.
//   lightning       the bolt: four pre-built jagged channels with branches in one geometry (seeded, fixed), one
//                   variant drawn at a time by draw range, as camera-facing ribbons at least two pixels wide,
//                   additive, from the cloud base to the ground where the model put the strike. The flash is not
//                   a light: it is an exposure and hemisphere-light spike, restored every frame from the values
//                   the sky set, plus the deck's own glow. With prefers-reduced-motion the flash is a third as
//                   bright and the bolt dimmer (the model already makes one strike ONE flash, never a strobe).
//   windshield      in the cockpit view only: beads of rain on the glass that sit, then run up and outward with
//                   the airflow (down at rest), one instanced draw in clip space, drawn last in the world pass so
//                   the cockpit interior (drawn after the world, src/cockpit.js) covers them everywhere but the
//                   glass.
//   darkness etc.   through SkySystem's existing objects, never by re-baking the sky per frame: the sky's lookup
//                   table is scaled ONCE at build for the storm's darkness (and tinted for dust), then per frame
//                   the sun, the hemisphere light and the exposure are set from the values the sky's set() left
//                   (never toggling a light's `visible`, which would recompile every program), and the shared
//                   atExtinction uniform carries the visibility: the model's (a visDrop), thicker only where more
//                   rain (or snow or dust) falls than the spec's own, which the scenario's `vis` already includes,
//                   and the whiteout inside the cloud above the ceiling (a ragged base 30 m deep). Inside the
//                   cloud atWeather is lifted to 1 as well, so the airlight has no horizon step (a false
//                   horizon in a whiteout); outside it is the sky's own value, rewritten every frame.
//
// House rules (src/art/AGENTS.md): every material is named `weather/...`; this module's GLSL uniforms start with
// `wx` (the at* names are the atmosphere's, read here through sky.uniforms, never declared); no material or
// geometry is cached at module level; randomness is makeRng with this file's own constants; no point or spot
// lights; colours are linear; only the bolt's core exceeds 1 (a lamp, for the bloom). Budget at the high tier:
// five draws at most (precipitation, deck, shafts, and the bolt and the glass only while they show), five
// programs, about 50k triangles of instanced quads.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, makeRng, KT } from '../config.js';
import { atmosphereGLSL, clearExtinction, worldVertex, outputGLSL, VISIBILITY_EXTINCTION } from './world-atmosphere.js';
import { WORLD_QUALITY, detailIndex } from './quality.js';

// The look's own palette (linear radiance / albedo).
const WX = {
  deckDark: [0.026, 0.029, 0.035], deckLight: [0.078, 0.083, 0.094],   // the belly of a storm deck in daylight
  flash: [0.78, 0.82, 1.0],                                             // lightning: cold white
  dust: [0.52, 0.39, 0.24], snow: [0.92, 0.94, 0.97],
  inCloudVis: 140,                                                      // metres of visibility inside the cloud
};

// The lens the precipitation's near fade is sized for (tan of half a 55-degree field of view); a longer lens
// pushes the fade out by the ratio (the tower's zoom).
const NORMAL_LENS = Math.tan(55 * Math.PI / 360);

// Drops per tier (low, medium, high); phones take 70 %.
const COUNTS = { rain: [4000, 7000, 11000], snow: [3000, 5000, 8000], dust: [1600, 2600, 4000] };
const KINDS = {
  //   box (m), fall (m/s), width (m), minimum streak (m), exposure (s), flutter (m), alpha, shape (0 streak, 1 flake,
  //   2 puff), low (1 = hugs the ground), streak (the longest motion blur, in the drop's own widths; 0 = no limit)
  // Snow's blur is held to six flake widths: at approach speed the exposure alone drew every flake as a 0.8 m
  // line, and the whole view read as a star field; short flakes show the speed as parallax instead.
  rain: { box: 56, fall: 8.5, width: 0.0045, len: 0.18, expo: 0.028, flutter: 0, alpha: 0.30, shape: 0, low: 0, streak: 0 },
  snow: { box: 44, fall: 1.1, width: 0.022, len: 0, expo: 0.022, flutter: 0.6, alpha: 0.55, shape: 1, low: 0, streak: 6 },
  dust: { box: 90, fall: -0.2, width: 0.9, len: 0, expo: 0.03, flutter: 2.5, alpha: 0.10, shape: 2, low: 1, streak: 0 },
};

const quad = (n) => {   // an instanced quad: corner.x across (-1, 1), corner.y along (0 head, 1 tail)
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  g.setAttribute('corner', new THREE.Float32BufferAttribute([-1, 0, 1, 0, -1, 1, 1, 1], 2));
  g.setIndex([0, 1, 2, 2, 1, 3]);
  g.instanceCount = n;
  return g;
};

// A periodic value noise field, baked once per flight (the deck's belly): R = broad lumps, G = fine detail.
function deckTexture(seed) {
  const S = 256, data = new Uint8Array(S * S * 4);
  const rng = makeRng(seed);
  const lattice = (p) => { const a = new Float32Array(p * p); for (let i = 0; i < a.length; i++) a[i] = rng(); return a; };
  const octave = (tab, p, x, y) => {   // bilinear, smoothstepped, periodic with period p cells over the tile
    const fx = (x / S) * p, fy = (y / S) * p;
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const x0 = ix % p, y0 = iy % p, x1 = (ix + 1) % p, y1 = (iy + 1) % p;
    const a = tab[y0 * p + x0], b = tab[y0 * p + x1], c = tab[y1 * p + x0], d = tab[y1 * p + x1];
    return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
  };
  const specs = [[4, 0.5], [8, 0.27], [16, 0.14], [32, 0.09]], fine = [[32, 0.55], [64, 0.45]];
  const tabs = specs.map(([p]) => lattice(p)), ftabs = fine.map(([p]) => lattice(p));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = 0; for (let k = 0; k < specs.length; k++) v += octave(tabs[k], specs[k][0], x, y) * specs[k][1];
    let f = 0; for (let k = 0; k < fine.length; k++) f += octave(ftabs[k], fine[k][0], x, y) * fine[k][1];
    const i = (y * S + x) * 4;
    data[i] = clamp(smoothstep(0.28, 0.78, v), 0, 1) * 255;
    data[i + 1] = clamp(f, 0, 1) * 255;
    data[i + 2] = 0; data[i + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, S, S);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true; tex.needsUpdate = true;
  return tex;
}

// Four lightning channels in one geometry: a jagged main stroke from the cloud base (y 1) to the ground (y 0)
// in units of the bolt's height, with a few branches that die out in the air. Returns { geometry, ranges }.
function boltGeometry(seed) {
  const rng = makeRng(seed);
  const A = [], B = [], C = [], W = [], idx = [], ranges = [];
  let v = 0;
  const seg = (a, b, w) => {
    for (const [cx, cy] of [[-1, 0], [1, 0], [-1, 1], [1, 1]]) { A.push(a[0], a[1], a[2]); B.push(b[0], b[1], b[2]); C.push(cx, cy); W.push(w); }
    idx.push(v, v + 1, v + 2, v + 2, v + 1, v + 3); v += 4;
  };
  const walk = (from, steps, dy, wander, w, branches) => {
    let p = from.slice(), hx = (rng() - 0.5) * wander, hz = (rng() - 0.5) * wander;
    for (let i = 0; i < steps && p[1] > 0; i++) {
      // a random walk with a persistent lean: lightning zig-zags but keeps a heading
      hx = hx * 0.55 + (rng() - 0.5) * wander; hz = hz * 0.55 + (rng() - 0.5) * wander;
      const q = [p[0] + hx, Math.max(0, p[1] - dy * (0.6 + rng() * 0.8)), p[2] + hz];
      if (i === steps - 1 && branches) q[1] = 0;
      seg(p, q, w);
      if (branches && i > 1 && i < steps - 4 && rng() < 0.22) walk(q, 3 + Math.floor(rng() * 5), dy * 0.8, wander * 1.3, w * 0.45, false);
      p = q;
    }
  };
  for (let k = 0; k < 4; k++) {
    const start = idx.length;
    walk([0, 1.04, 0], 26, 1 / 22, 0.11, 1, true);
    ranges.push({ start, count: idx.length - start });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(A.length), 3));
  g.setAttribute('aA', new THREE.Float32BufferAttribute(A, 3));
  g.setAttribute('aB', new THREE.Float32BufferAttribute(B, 3));
  g.setAttribute('corner', new THREE.Float32BufferAttribute(C, 2));
  g.setAttribute('aW', new THREE.Float32BufferAttribute(W, 1));
  g.setIndex(idx);
  return { geometry: g, ranges };
}

// Camera-facing ribbon from a to b (view space), `w` metres wide but never under `minPx` pixels; a ribbon widened
// to its pixel minimum is made fainter by the same factor (energy kept). Shared by the rain and the bolt.
const RIBBON_GLSL = `
  uniform float wxPix;
  float wxRibbon(vec3 a, vec3 b, vec2 corner, float w, float minPx, float capK, out vec3 pos, out vec2 sc, out float len) {
    float depth = max(0.05, -a.z);
    float wMin = depth * wxPix * minPx;
    float gain = w >= wMin ? 1.0 : w / wMin;
    w = max(w, wMin);
    vec3 ax = b - a; len = length(ax);
    ax = len > 1e-5 ? ax / len : vec3(0.0, -1.0, 0.0);
    vec3 sd = cross(ax, normalize(-a)); float sl = length(sd);
    sd = sl > 1e-4 ? sd / sl : vec3(1.0, 0.0, 0.0);
    float s = mix(-capK * w, len + capK * w, corner.y);
    pos = a + ax * s + sd * corner.x * 0.5 * w;
    sc = vec2(s / w, corner.x * 0.5);
    len /= w;
    return gain;
  }`;

export class WeatherLook {
  constructor(scene, { spec = null, sky = null, quality = 'high', touch = false } = {}) {
    this.scene = scene;
    this.spec = spec || {};
    this.sky = sky;
    this.quality = quality;
    this.touch = touch;
    const s = this.spec;
    const tier = detailIndex(WORLD_QUALITY.detail);
    const events = s.events || [];
    this.objects = [];
    this.soft = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const U = sky ? sky.uniforms : null;

    // --- what the sky set, before the weather touches it (restored and scaled from these every frame) ---
    this.base = sky ? { sun: sky.sun.intensity, sunOn: sky.sun.visible, hemi: sky.hemi.intensity, exposure: sky.renderer ? sky.renderer.toneMappingExposure : 1, weather: U ? U.atWeather.value : 0 } : null;
    this.baseRain = s.rain || 0; this.baseSnow = s.snow || 0; this.baseDust = s.dust || 0;
    // a flash is light added to the scene, and the night exposure (about 3x the day's) would multiply it again:
    // what the flash adds is scaled back by the exposure the sky chose, so a night strike is bright, not white
    this.flashK = this.base ? clamp(1.4 / Math.max(0.1, this.base.exposure), 0.35, 1) : 1;

    // --- the sky's lookup table, scaled once for the storm's darkness and tinted for dust ---
    if (U && ((s.darkness || 0) > 0 || (s.dust || 0) > 0)) this.shadeSky(U, s.darkness || 0, s.dust || 0);

    // --- precipitation: one instanced draw ---
    const hasSquall = events.some((e) => e.type === 'squall');
    const kind = (s.snow || 0) > 0 && (s.snow || 0) >= (s.rain || 0) ? 'snow'
      : (s.dust || 0) > 0 && (s.dust || 0) > (s.rain || 0) ? 'dust'
      : (s.rain || 0) > 0 || hasSquall ? 'rain' : null;
    this.kind = kind;
    if (kind && U) this.precip = this.buildPrecip(kind, Math.round(COUNTS[kind][tier] * (touch ? 0.7 : 1)));

    // --- the storm deck at the ceiling (replaces the sky's cloud sheets) ---
    if (s.ceiling != null && U) {
      this.deck = this.buildDeck(U);
      for (const c of sky.clouds || []) c.mesh.visible = false;
    }
    // --- rain shafts under the cells and the microburst ---
    if (U && ((s.cells || 0) > 0 || (s.lightning || 0) > 0 || events.some((e) => e.type === 'microburst'))) this.shafts = this.buildShafts(U);
    // --- the bolt ---
    if (U && (s.lightning || 0) > 0) this.bolt = this.buildBolt(U);
    // --- rain on the windscreen (cockpit view) ---
    if (kind === 'rain' || kind === 'snow') this.glass = this.buildGlass(kind, tier >= 2 && !touch ? 110 : 70);

    this.camPrev = new THREE.Vector3(); this.camVel = new THREE.Vector3(); this.haveCam = false;
    this.fallOff = new THREE.Vector3();
    this.drift = new THREE.Vector2();
    this.tint = new THREE.Color();
    this.inCloud = 0;
  }

  add(o) { this.scene.add(o); this.objects.push(o); return o; }

  // One pass over the sky's day table (and the representative colours read from it): darker for a storm, browner
  // for dust. The sky bakes it only in set() (flight start), so this is the state for the whole flight.
  shadeSky(U, dark, dust) {
    const k = 1 - 0.5 * clamp(dark, 0, 1);
    const tr = lerp(1, WX.dust[0] / 0.38, dust * 0.7), tg = lerp(1, WX.dust[1] / 0.38, dust * 0.7), tb = lerp(1, WX.dust[2] / 0.38, dust * 0.7);
    const tex = U.atLut.value, d = tex.image.data;
    const H = THREE.DataUtils;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = H.toHalfFloat(H.fromHalfFloat(d[i]) * k * tr);
      d[i + 1] = H.toHalfFloat(H.fromHalfFloat(d[i + 1]) * k * tg);
      d[i + 2] = H.toHalfFloat(H.fromHalfFloat(d[i + 2]) * k * tb);
    }
    tex.needsUpdate = true;
    for (const c of [U.atHorizon.value, U.atZenith.value]) { c.r *= k * tr; c.g *= k * tg; c.b *= k * tb; }
  }

  // ---------------------------------------------------------------- precipitation
  buildPrecip(kind, n) {
    const K = KINDS[kind];
    const geo = quad(n);
    const rng = makeRng(kind === 'rain' ? 7121 : kind === 'snow' ? 7243 : 7349);
    const seed = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) seed[i] = rng();
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), K.box);
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(-K.box, -K.box, -K.box), new THREE.Vector3(K.box, K.box, K.box));
    const uniforms = {
      wxOff: { value: new THREE.Vector3() }, wxFall: { value: new THREE.Vector3(0, -K.fall, 0) }, wxCamVel: { value: new THREE.Vector3() },
      wxBox: { value: K.box }, wxDensity: { value: 1 }, wxAlpha: { value: K.alpha }, wxExpo: { value: K.expo }, wxWidth: { value: K.width },
      wxLen: { value: K.len }, wxPix: { value: 0.001 }, wxShape: { value: K.shape }, wxFlutter: { value: K.flutter }, wxTime: { value: 0 },
      wxFieldY: { value: 0 }, wxLow: { value: K.low }, wxColor: { value: new THREE.Color() }, wxZoom: { value: 1 }, wxStreak: { value: K.streak },
    };
    const mat = new THREE.ShaderMaterial({
      name: 'weather/' + kind,
      uniforms, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, forceSinglePass: true,
      vertexShader: `
        attribute vec2 corner; attribute vec4 aSeed;
        uniform vec3 wxOff, wxFall, wxCamVel; uniform float wxBox, wxDensity, wxAlpha, wxExpo, wxWidth, wxLen, wxShape, wxFlutter, wxTime, wxFieldY, wxLow, wxZoom, wxStreak;
        varying vec2 vSC; varying float vLen, vA;
        ${RIBBON_GLSL}
        void main() {
          float spd = 0.8 + 0.4 * aSeed.w;
          vec3 p = aSeed.xyz * wxBox + wxOff * spd;
          if (wxFlutter > 0.0) {
            p.x += wxFlutter * sin(wxTime * (0.9 + aSeed.w) + aSeed.x * 43.0);
            p.z += wxFlutter * cos(wxTime * (0.7 + aSeed.y) + aSeed.z * 37.0);
            p.y += wxFlutter * 0.4 * sin(wxTime * (0.5 + aSeed.z) + aSeed.y * 29.0);
          }
          vec3 rel = mod(p - cameraPosition, wxBox) - 0.5 * wxBox;   // wrapped into the box around the camera
          vec3 world = cameraPosition + rel;
          float d = length(rel);
          float a = wxAlpha * step(fract(aSeed.w * 7.31 + aSeed.x * 3.7), wxDensity);
          // the near fade moves out with the lens's zoom: through the tower's long lens a drop two metres away
          // would be magnified into one bar across the whole picture
          a *= smoothstep(1.2 * wxZoom, 3.5 * wxZoom, d) * (1.0 - smoothstep(0.30 * wxBox, 0.47 * wxBox, d));
          a *= 1.0 - wxLow * smoothstep(wxFieldY + 20.0, wxFieldY + 110.0, world.y);
          // where the drop was, relative to the camera, one exposure ago
          vec3 vr = wxFall * spd - wxCamVel;
          vec3 head = (viewMatrix * vec4(world, 1.0)).xyz;
          vec3 back = mat3(viewMatrix) * vr;
          float bl = length(back);
          float w = wxWidth * (0.7 + 0.6 * aSeed.y);
          // the blur over the exposure, held to wxStreak widths where the kind asks for it (snow)
          float blur = bl * wxExpo;
          if (wxStreak > 0.0) blur = min(blur, wxStreak * w);
          vec3 tail = head - (bl > 1e-4 ? back / bl : vec3(0.0)) * (blur + wxLen);
          // a streak never reaches into the lens: its tail stays at least half the head's depth away (a drop
          // flying past the camera would otherwise swell into a bar across the screen)
          float hz = -head.z, tz = -tail.z, zmin = max(0.8, 0.5 * hz);
          if (tz < zmin && hz > tz) tail = mix(head, tail, clamp((hz - zmin) / (hz - tz), 0.0, 1.0));
          vec3 pos; float len;
          float gain = wxRibbon(head, tail, corner, w, 1.3, 0.5, pos, vSC, len);
          vLen = len;
          // a longer blur spreads the same light: fainter
          a *= gain * pow(clamp((wxLen / w + 1.0) / (len + 1.0), 0.12, 1.0), wxShape > 0.5 ? 0.5 : 0.35);
          vA = a;
          gl_Position = projectionMatrix * vec4(pos, 1.0);
          if (a <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 wxColor; uniform float wxShape;
        varying vec2 vSC; varying float vLen, vA;
        void main() {
          float along = vSC.x - clamp(vSC.x, 0.0, vLen);
          float r = length(vec2(along, vSC.y)) * 2.0;
          float body = wxShape < 0.5 ? 1.0 - smoothstep(0.1, 1.0, r) : wxShape < 1.5 ? 1.0 - smoothstep(0.35, 1.0, r) : pow(max(0.0, 1.0 - r), 2.0);
          float head = wxShape < 0.5 ? 0.55 + 0.45 * (1.0 - clamp(vSC.x / max(vLen, 1e-3), 0.0, 1.0)) : 1.0;
          float a = vA * body * head;
          if (a < 0.002) discard;
          gl_FragColor = vec4(wxColor, a);
          ${outputGLSL}
        }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'weather/' + kind;
    mesh.castShadow = mesh.receiveShadow = false;
    mesh.renderOrder = 5;
    mesh.visible = false;
    this.add(mesh);
    return { kind, K, mesh, uniforms };
  }

  // ---------------------------------------------------------------- the storm deck
  buildDeck(U) {
    const tex = deckTexture(5011);
    const uniforms = {
      ...U,
      wxDeckMap: { value: tex }, wxDrift: { value: new THREE.Vector2() }, wxDark: { value: (this.spec.darkness || 0) },
      wxFlash: { value: 0 }, wxFlashAt: { value: new THREE.Vector2() },
    };
    const mat = new THREE.ShaderMaterial({
      name: 'weather/deck',
      uniforms, side: THREE.DoubleSide, forceSinglePass: true,
      vertexShader: worldVertex,
      fragmentShader: `
        varying vec3 vWorld;
        uniform sampler2D wxDeckMap; uniform vec2 wxDrift, wxFlashAt; uniform float wxDark, wxFlash;
        ${atmosphereGLSL}
        void main() {
          vec3 ray = vWorld - cameraPosition;
          float dist = length(ray);
          vec3 d = ray / dist;
          vec2 uv = (vWorld.xz + wxDrift) / 3100.0;
          float lumps = texture2D(wxDeckMap, uv).r;
          float fine = texture2D(wxDeckMap, uv * 4.3 + vec2(0.37, 0.61)).g;
          float belly = clamp(lumps * 0.75 + fine * 0.35 - 0.05, 0.0, 1.0);
          vec3 col = mix(vec3(${WX.deckDark.join(', ')}), vec3(${WX.deckLight.join(', ')}), belly);
          // daylight through a thick cloud: dimmer with the storm's darkness, gone at night
          col *= atDay * mix(1.15, 0.55, wxDark) + 0.004;
          // a low sun under the far edge warms the belly on its side of the sky
          vec2 h = normalize(d.xz + vec2(1e-5)), sh = normalize(atSun.xz + vec2(1e-5));
          float toward = pow(max(dot(h, sh), 0.0), 5.0);
          col += atWarm * toward * atLow * atDay * smoothstep(2500.0, 14000.0, dist) * (0.10 + 0.08 * belly);
          // lightning lights the cloud from inside, brightest around the strike
          float fd = length(vWorld.xz - wxFlashAt);
          col += vec3(${WX.flash.join(', ')}) * wxFlash * (0.08 + 0.55 * exp(-fd / 2200.0)) * (0.55 + 0.6 * belly);
          // aerial perspective (and the whiteout inside the cloud), and the far edge becomes the sky itself.
          // Seen from above its base the deck is not a surface: the camera is inside the cloud, and a dark plane
          // below it would draw a false horizon across the whiteout. There it is simply more cloud.
          float haze = 1.0 - exp(-dist * atExtinction);
          float inside = smoothstep(0.0, 8.0, cameraPosition.y - vWorld.y);
          col = mix(col, atmosphere(d), max(max(haze, inside), smoothstep(15000.0, 23500.0, dist)));
          gl_FragColor = vec4(col, 1.0);
          ${outputGLSL}
        }`,
    });
    const plane = new THREE.PlaneGeometry(50000, 50000);
    plane.computeBoundingSphere();
    const mesh = new THREE.Mesh(plane, mat);
    mesh.name = 'weather/deck';
    mesh.rotation.x = -Math.PI / 2;
    mesh.castShadow = mesh.receiveShadow = false;
    mesh.visible = false;
    this.add(mesh);
    return { mesh, uniforms, tex };
  }

  // ---------------------------------------------------------------- rain shafts
  buildShafts(U) {
    const pos = [], corner = [], ix = [], index = [];
    for (let k = 0; k < 4; k++) {
      for (const [cx, cy] of [[-1, 0], [1, 0], [-1, 1], [1, 1]]) { pos.push(0, 0, 0); corner.push(cx, cy); ix.push(k); }
      const v = k * 4; index.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('corner', new THREE.Float32BufferAttribute(corner, 2));
    geo.setAttribute('aIdx', new THREE.Float32BufferAttribute(ix, 1));
    geo.setIndex(index);
    // the shafts stand within about 15 km of the field; the camera is always inside this sphere
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 30000);
    const shafts = [0, 1, 2, 3].map(() => new THREE.Vector4());
    const uniforms = { ...U, wxShaft: { value: shafts }, wxBase: { value: 0 }, wxTop: { value: 600 }, wxTime: { value: 0 }, wxFlash: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      name: 'weather/shafts',
      uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
      vertexShader: `
        attribute vec2 corner; attribute float aIdx;
        uniform vec4 wxShaft[4]; uniform float wxBase, wxTop;
        varying vec3 vWorld; varying vec2 vUV; varying float vA;
        void main() {
          vec4 S = aIdx < 0.5 ? wxShaft[0] : aIdx < 1.5 ? wxShaft[1] : aIdx < 2.5 ? wxShaft[2] : wxShaft[3];
          vec3 c = vec3(S.x, 0.0, S.y);
          vec2 to = cameraPosition.xz - c.xz; float tl = length(to);
          vec2 f = tl > 1.0 ? to / tl : vec2(0.0, 1.0);
          vec3 rt = vec3(f.y, 0.0, -f.x);
          vec3 w = vec3(c.x, mix(wxBase - 30.0, wxTop + 40.0, corner.y), c.z) + rt * corner.x * S.z;
          vWorld = w; vUV = corner; vA = S.w;
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
          if (S.w <= 0.001) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: `
        uniform float wxTime, wxFlash;
        varying vec3 vWorld; varying vec2 vUV; varying float vA;
        ${atmosphereGLSL}
        void main() {
          vec3 ray = vWorld - cameraPosition; float dist = length(ray); vec3 d = ray / dist;
          float across = 1.0 - vUV.x * vUV.x; across = across * (0.6 + 0.4 * across);
          // curtains: a few soft vertical bands that drift, heavier toward the middle
          float x = vUV.x * 3.1;
          float bands = 0.62 + 0.2 * sin(x * 5.3 + sin(x * 2.1 + wxTime * 0.05) * 1.7) + 0.18 * sin(x * 11.7 - vUV.y * 1.3 + wxTime * 0.08);
          float vert = smoothstep(0.0, 0.08, vUV.y) * (1.0 - smoothstep(0.82, 1.0, vUV.y));
          vec3 sky = atmosphere(d);
          vec3 col = sky * 0.48 + vec3(${WX.flash.join(', ')}) * wxFlash * 0.18;
          float haze = 1.0 - exp(-dist * atExtinction * 0.8);
          col = mix(col, sky, haze);
          float a = min(0.92, vA * across * bands * vert * 1.1);
          gl_FragColor = vec4(col, a);
          ${outputGLSL}
        }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'weather/shafts';
    mesh.castShadow = mesh.receiveShadow = false;
    mesh.visible = false;
    this.add(mesh);
    return { mesh, uniforms, shafts };
  }

  // ---------------------------------------------------------------- lightning
  buildBolt(U) {
    const { geometry, ranges } = boltGeometry(4801);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 30000);
    const uniforms = { ...U, wxBoltBase: { value: new THREE.Vector3() }, wxBoltH: { value: 300 }, wxBoltW: { value: 1.2 }, wxBoltI: { value: 0 }, wxPix: { value: 0.001 } };
    const mat = new THREE.ShaderMaterial({
      name: 'weather/bolt',
      uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, forceSinglePass: true,
      vertexShader: `
        attribute vec3 aA, aB; attribute vec2 corner; attribute float aW;
        uniform vec3 wxBoltBase; uniform float wxBoltH, wxBoltW;
        varying vec2 vSC; varying float vLen, vW; varying vec3 vWorld;
        ${RIBBON_GLSL}
        void main() {
          vec3 a = wxBoltBase + aA * wxBoltH, b = wxBoltBase + aB * wxBoltH;
          vWorld = a;
          vec3 av = (viewMatrix * vec4(a, 1.0)).xyz, bv = (viewMatrix * vec4(b, 1.0)).xyz;
          vec3 pos; float len;
          float gain = wxRibbon(av, bv, corner, wxBoltW * aW * 6.0, 2.2 + 2.0 * aW, 0.5, pos, vSC, len);
          vLen = len; vW = aW * gain;
          gl_Position = projectionMatrix * vec4(pos, 1.0);
        }`,
      fragmentShader: `
        uniform float wxBoltI;
        varying vec2 vSC; varying float vLen, vW; varying vec3 vWorld;
        ${atmosphereGLSL}
        void main() {
          float x = abs(vSC.y) * 2.0;
          float core = 1.0 - smoothstep(0.0, 0.3, x);
          float glow = (1.0 - x); glow *= glow;
          float dist = length(vWorld - cameraPosition);
          float through = exp(-dist * atExtinction * 0.45);   // a strike shows through rain much further than a hill
          vec3 col = vec3(${WX.flash.join(', ')}) * (core * 2.6 + glow * 0.45) * wxBoltI * vW * through;
          gl_FragColor = vec4(col, 1.0);
          ${outputGLSL}
        }`,
    });
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.name = 'weather/bolt';
    mesh.castShadow = mesh.receiveShadow = false;
    mesh.renderOrder = 6;
    mesh.visible = false;
    this.add(mesh);
    return { mesh, uniforms, ranges };
  }

  // ---------------------------------------------------------------- the windscreen
  buildGlass(kind, n) {
    const geo = quad(n);
    const rng = makeRng(kind === 'rain' ? 7477 : 7481);
    const seed = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) seed[i] = rng();
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3);
    const uniforms = { wxTime: { value: 0 }, wxAmt: { value: 0 }, wxFlow: { value: 0 }, wxAspect: { value: 1.7 }, wxColor: { value: new THREE.Color() }, wxSnow: { value: kind === 'snow' ? 1 : 0 } };
    const mat = new THREE.ShaderMaterial({
      name: 'weather/glass',
      uniforms, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide, forceSinglePass: true,
      vertexShader: `
        attribute vec2 corner; attribute vec4 aSeed;
        uniform float wxTime, wxAmt, wxFlow, wxAspect, wxSnow;
        varying vec2 vUV; varying float vA;
        float h1(float x) { return fract(sin(x * 91.3458) * 47453.5453); }
        void main() {
          float life = 2.2 + 3.4 * aSeed.w - 1.2 * wxFlow;
          float cyc = wxTime / life + aSeed.z;
          float ph = fract(cyc), k = floor(cyc);
          // a fresh spot each cycle; more drops show in heavier rain
          vec2 at = vec2(h1(aSeed.x * 17.0 + k * 1.37), h1(aSeed.y * 23.0 + k * 2.91)) * 2.0 - 1.0;
          at.y = at.y * 0.85 + 0.12;
          float on = step(h1(aSeed.w * 13.0 + k * 0.71), 0.25 + 0.75 * wxAmt);
          // a bead sits for a moment, then the airflow drives it up and outward (at rest it creeps down)
          float run = smoothstep(0.2, 0.95, ph) * (0.35 + 0.65 * aSeed.w);
          vec2 dir = mix(vec2(0.0, -0.08), normalize(vec2(at.x * 0.7, 1.0)) * (0.5 + 0.9 * aSeed.y), wxFlow);
          vec2 c = at + dir * run;
          float size = mix(0.010 + 0.022 * aSeed.y, 0.006 + 0.010 * aSeed.y, wxSnow);
          float stretch = 1.0 + 3.5 * wxFlow * run * (1.0 - wxSnow);
          vec2 al = normalize(dir + vec2(1e-4, 1e-4));
          vec2 sd = vec2(al.y, -al.x);   // to the right of the run: the quad winds counter-clockwise
          vec2 off = sd * corner.x * size + al * (corner.y * 2.0 - 1.0) * size * stretch;
          vUV = vec2(corner.x, corner.y * 2.0 - 1.0);
          vA = wxAmt * on * smoothstep(0.0, 0.06, ph) * (1.0 - smoothstep(0.78, 1.0, ph));
          gl_Position = vec4(c + off * vec2(1.0 / wxAspect, 1.0), 0.0, 1.0);
          if (vA <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 wxColor; uniform float wxSnow;
        varying vec2 vUV; varying float vA;
        void main() {
          float r = length(vUV);
          if (r > 1.0) discard;
          // a lens of water: the scene shows through, a darker rim, a bright caustic low and a glint high
          float body = 1.0 - smoothstep(0.7, 1.0, r);
          float rim = smoothstep(0.55, 0.92, r) * body;
          float caustic = smoothstep(0.2, 0.85, -vUV.y) * (1.0 - smoothstep(0.5, 0.95, r));
          float glint = 1.0 - smoothstep(0.0, 0.28, length(vUV - vec2(-0.28, 0.4)));
          vec3 col = mix(wxColor * 0.18, wxColor * 1.9, clamp(caustic + glint * 1.5, 0.0, 1.0));
          col = mix(col, wxColor * 0.12, rim);
          float a = vA * clamp(0.22 * body + 0.55 * rim + 0.5 * caustic + 0.7 * glint, 0.0, 0.85);
          col = mix(col, wxColor * 1.3, wxSnow);
          a = mix(a, vA * body * 0.7, wxSnow);
          gl_FragColor = vec4(col, a);
          ${outputGLSL}
        }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'weather/glass';
    mesh.castShadow = mesh.receiveShadow = false;
    mesh.renderOrder = 9990;
    mesh.visible = false;
    this.add(mesh);
    return { mesh, uniforms };
  }

  // ---------------------------------------------------------------- every frame
  update(dt, st, env) {
    if (!st || !env) return;
    const sky = env.sky || this.sky, cam = env.camera, R = env.renderer, ac = env.ac;
    if (!sky || !cam) return;
    const U = sky.uniforms, day = sky.dayness;
    const flash = st.flash * (this.soft ? 0.35 : 1), fk = flash * this.flashK;

    // --- light: the storm's darkness and the flash, from the values the sky set (never a `visible` toggle) ---
    const b = this.base, dk = clamp(st.darkness, 0, 1), deck = st.ceilingY != null;
    if (b) {
      if (b.sunOn) sky.sun.intensity = Math.max(0.0025, b.sun * (deck ? 0.1 + 0.25 * (1 - dk) * (1 - smoothstep(0.1, 0.35, dk)) : 1 - 0.85 * dk));
      sky.hemi.intensity = b.hemi * (deck ? 1.25 - 0.45 * dk : 1 - 0.3 * dk) + fk * lerp(1.1, 0.8, day);
      if (R) R.toneMappingExposure = b.exposure * (1 - 0.3 * dk * day) * (1 + 0.3 * flash);
    }

    // --- visibility: the model's, thicker where more falls than the spec's own, and white inside the cloud ---
    // A scenario's `vis` is the whole of it: the rain, snow and dust the spec itself asks for are already in that
    // number (the briefing and its kneeboard say it, the sky draws it), so only what arrives on top thickens the air
    // (a squall's rain, a storm cell's shaft). src/missions/README.md "Visibility"; tools/test-maps.mjs.
    const camY = cam.position.y;
    let ext = clearExtinction(st.vis) * (1 + 1.4 * Math.max(0, st.rain - this.baseRain) + 0.8 * Math.max(0, st.snow - this.baseSnow) + 1.6 * Math.max(0, st.dust - this.baseDust));
    let inCloud = 0;
    if (deck) {
      inCloud = smoothstep(st.ceilingY - 30, st.ceilingY + 12, camY) * (1 - smoothstep(st.cloudTop - 60, st.cloudTop + 60, camY));
      // geometric, so the first wisps of the base thin the view a little and only the cloud itself is white
      if (inCloud > 0) ext *= Math.pow(VISIBILITY_EXTINCTION / WX.inCloudVis / ext, inCloud * inCloud);
    }
    U.atExtinction.value = ext;
    // Inside the cloud there is no horizon: atmosphere(d) darkens the airlight below the horizon by (1 - atWeather)
    // (fog is exempt), which in a whiteout drew a sharp false horizon across the grey. The sky's own value
    // everywhere else, set every frame from what the sky chose.
    if (b) U.atWeather.value = b.weather + (1 - b.weather) * inCloud;
    this.inCloud = inCloud;

    // the light the rain and the glass catch: the sky near the horizon, and the flash
    const hz = U.atHorizon.value, tint = this.tint;
    tint.setRGB(hz.r, hz.g, hz.b).multiplyScalar(1.2 + 0.25 * (1 - dk)).addScalar(0.004);
    tint.r += WX.flash[0] * fk * 0.5; tint.g += WX.flash[1] * fk * 0.5; tint.b += WX.flash[2] * fk * 0.5;

    // --- the camera's own motion (the streaks are the rain's motion relative to it) ---
    const moving = env.cameraMode !== 'tower' && env.cameraMode !== 'flyby';
    if (moving && ac) this.camVel.copy(ac.vel);
    else if (this.haveCam && dt > 0) { this.camVel.subVectors(cam.position, this.camPrev).divideScalar(dt); if (this.camVel.lengthSq() > 22500) this.camVel.set(0, 0, 0); }
    else this.camVel.set(0, 0, 0);
    this.camPrev.copy(cam.position); this.haveCam = true;
    const pix = R ? 2 * Math.tan(cam.fov * Math.PI / 360) / Math.max(1, R.domElement.height) : 0.001;

    // --- precipitation ---
    const P = this.precip;
    if (P) {
      const amt = P.kind === 'rain' ? st.rain : P.kind === 'snow' ? st.snow : st.dust;
      P.mesh.visible = amt > 0.01;
      if (P.mesh.visible) {
        const u = P.uniforms, K = P.K, w = st.wind;
        // the fall, integrated: a change of wind never teleports the drops
        const drag = P.kind === 'rain' ? 0.9 : 1;
        const fx = w.x * drag, fz = w.z * drag, fy = -K.fall + Math.min(0, w.y) * 0.8;
        u.wxFall.value.set(fx, fy, fz);
        this.fallOff.x += fx * dt; this.fallOff.y += fy * dt; this.fallOff.z += fz * dt;
        u.wxOff.value.copy(this.fallOff);
        u.wxCamVel.value.copy(this.camVel);
        u.wxTime.value = env.t;
        u.wxPix.value = pix;
        // 1 at a 55-degree lens or wider; the tower's 3.5-degree lens (17) pushes the near fade past the box, so no
        // drop shows at all there (out of focus, as through a real long lens; the rain is the extinction's haze)
        u.wxZoom.value = clamp(NORMAL_LENS / Math.tan(cam.fov * Math.PI / 360), 1, 20);
        u.wxFieldY.value = st.fieldY;
        u.wxDensity.value = 0.2 + 0.8 * amt;
        u.wxAlpha.value = K.alpha * (0.45 + 0.55 * amt) * (1 - 0.6 * inCloud);
        const c = u.wxColor.value;
        if (P.kind === 'rain') c.copy(tint);
        else {
          const base = P.kind === 'snow' ? WX.snow : WX.dust;
          const l = (hz.r + hz.g + hz.b) / 3 * (P.kind === 'snow' ? 1.9 : 1.6) + 0.01;
          c.setRGB(base[0] * l, base[1] * l, base[2] * l);
        }
        P.mesh.position.copy(cam.position);
      }
    }

    // --- the deck ---
    const D = this.deck;
    if (D) {
      D.mesh.visible = deck;
      if (deck) {
        D.mesh.position.set(cam.position.x, st.ceilingY, cam.position.z);
        const u = D.uniforms;
        this.drift.x += (st.wind.x || 0) * 0.6 * dt; this.drift.y += (st.wind.z || 0) * 0.6 * dt;
        u.wxDrift.value.set(-this.drift.x, -this.drift.y);
        u.wxDark.value = dk;
        u.wxFlash.value = fk;
        u.wxFlashAt.value.set(st.bolt.x, st.bolt.z);
      }
    }

    // --- rain shafts ---
    const S = this.shafts;
    if (S) {
      let any = false;
      for (let i = 0; i < 4; i++) {
        const src = st.shafts[i], v = S.shafts[i];
        const a = i < st.nShafts ? clamp(src.a, 0, 1) : 0;
        v.set(src.x, src.z, src.r, a);
        if (a > 0.001) any = true;
      }
      S.mesh.visible = any;
      const u = S.uniforms;
      u.wxBase.value = st.fieldY; u.wxTop.value = deck ? st.ceilingY : st.fieldY + 900;
      u.wxTime.value = env.t; u.wxFlash.value = fk;
    }

    // --- the bolt ---
    const B = this.bolt;
    if (B) {
      const bt = st.bolt;
      B.mesh.visible = !!bt.on;
      if (bt.on) {
        const r = B.ranges[bt.variant & 3];
        B.mesh.geometry.setDrawRange(r.start, r.count);
        const u = B.uniforms;
        u.wxBoltBase.value.set(bt.x, bt.y0, bt.z);
        u.wxBoltH.value = Math.max(80, bt.y1 - bt.y0 + 60);
        u.wxBoltI.value = (0.6 + 1.4 * st.strikePower) * (this.soft ? 0.5 : 1) * clamp(flash * 2.5, 0.25, 1);
        u.wxPix.value = pix;
      }
    }

    // --- the windscreen ---
    const G = this.glass;
    if (G) {
      const amt = this.kind === 'snow' ? st.snow : st.rain;
      G.mesh.visible = env.cameraMode === 'cockpit' && amt > 0.02;
      if (G.mesh.visible) {
        const u = G.uniforms;
        u.wxTime.value = env.t;
        u.wxAmt.value = clamp(amt * 1.1, 0, 1) * (1 - inCloud * 0.3);
        u.wxFlow.value = ac ? clamp((ac.ias / KT - 25) / 70, 0, 1) : 0;
        u.wxAspect.value = cam.aspect || 1.7;
        u.wxColor.value.copy(tint);
        G.mesh.position.copy(cam.position);
      }
    }
  }

  // The buffers and the deck's texture go; the materials stay. A flight restarted while the last one's shaders
  // were still compiling leaves three's compileAsync polling those materials, and a disposed one has no program
  // left to ask (an uncaught TypeError). Nothing else in the engine disposes a material, and the next flight's
  // identical shaders reuse the same programs, so keeping them costs nothing.
  dispose() {
    for (const o of this.objects) {
      if (o.parent) o.parent.remove(o);
      o.geometry.dispose();
    }
    if (this.deck) this.deck.tex.dispose();
    this.objects.length = 0;
  }
}
