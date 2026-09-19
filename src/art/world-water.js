// The animated water: sea and river. Analytic sky reflection and sun glitter - no
// render target, no reflection camera, no bloom required.
//
// Contract with the world (src/world/terrain.js imports it through sky.js):
//   makeWater(size, level, sunDir) -> { mesh, material, setSun(dir, dayness, fogColor), tick(dt), seaState }
//   mesh is a horizontal plane of `size` metres at height `level`; the world adds it
//   to the terrain group. setSun() is called every frame with the sky's sun; tick()
//   advances the animation. `seaState` (0..1, default 0.35) may be set by the engine
//   later; it scales the chop and the whitecaps (water more than 60 m above sea level
//   is taken for a river or a lake and starts calm at 0.06). Keep both calls cheap: the sea is
//   the biggest surface on the carrier scenes and every pixel of it runs this shader.
//
// The reflection asks the shared atmosphere (world-atmosphere.js) for the sky colour
// in the reflected direction, so the sea and the sky can never disagree. The fog is
// installed the same way as on every other surface (material.fog = true and the
// standard fog chunks), which keeps distant water on the sky's radiance curve.
//
// How the waves work (world pass 4b): one 512 px tiling SLOPE map is baked once per
// seed - thirty seeded directional wave components with a deep-water spectrum,
// stored as the surface slopes (dh/dx, dh/dz) so that samples at different scales
// add linearly. Seeded phase modulation and a softer high-frequency tail break up
// straight crests in the bake. Four slope samples: 85 m swell (dominant wavelengths
// 30-60 m), 15 m / 23.7 m rotated chop, and 2.6 m ripple fading by 420 m. The existing
// swell sample warps the chop coordinates, breaking their repeating lattice without
// another fetch or shader noise. Rotated slopes are transformed back to world axes.
// Inland water suppresses swell and disables caps. The shader sums the
// slopes, builds the normal, and shades: Schlick Fresnel between the sky reflection
// and the water body, a sun highlight on the perturbed normal that widens and dims
// as its pixel footprint grows (so it never aliases into stripes), whitecaps where
// the chop slope is steep (rare flecks on one face), a soft distant moon band
// with resolved glitter only nearby. Four wave fetches, no loops, no
// per-pixel noise. Uniforms of this file start with `wv`; the atmosphere's `at`
// names come from atmosphereUniforms() and are overwritten by the sky's own at
// compile time (installFog), which is what keeps the sea in step with the sky.
// Shared atmosphere/fog LUT fetches are additional, unchanged. No depth is handed
// in: shelving shallows and hull foam remain the ground's and carrier's work.
// The one exception (the new maps, 2026-09-17): an island ('island' terrain style) hands itself to
// setShallows(field) once, before the first frame; the water bakes the depth under it into a small
// texture (384 px over the island and its shelf) and, behind the WV_SHALLOWS define, colours the body
// over the shallows turquoise - sand-pale at the waterline, darker over reef, fading into the deep
// colour off the shelf - and calms the swell, the chop and the whitecaps inside the reef, so the
// colour shows through instead of the sky's reflection. One more fetch there, none anywhere else;
// every other water is unchanged.
import * as THREE from 'three';
import { clamp, smoothstep, DEG, makeRng, noise2 } from '../config.js';
import { PALETTE, BIOMES } from './palette.js';
import { atmosphereGLSL, atmosphereUniforms, worldVertex, outputGLSL } from './world-atmosphere.js';

// The tiling slope map. Wave vectors are integer multiples of the tile frequency so
// the tile is seamless; amplitudes follow k^-2.3 (Phillips-like), so the slope is
// carried by the long waves and the short ones only texture them.
const slopeMaps = new Map();
function waveSlopeMap(seed) {
  if (slopeMaps.has(seed)) return slopeMaps.get(seed);
  const S = 512, rng = makeRng(seed);
  const main = rng() * Math.PI * 2;
  const waves = [];
  for (let i = 0; i < 30; i++) {
    const ang = main + (rng() - 0.5) * (i < 18 ? 1.9 : 3.6);
    const mag = 1.5 + rng() * rng() * 11;
    const nx = Math.round(Math.cos(ang) * mag), nz = Math.round(Math.sin(ang) * mag);
    if (!nx && !nz) continue;
    const k = Math.hypot(nx, nz);
    // Phillips-like: amplitude ~ k^-2.3, so the SLOPE falls with k and the surface is
    // swell-led with fine ripple on top, not a hatch of steep sub-metre facets.
    waves.push({ nx, nz, amp: Math.pow(k, -2.3) / (1 + k * k * 0.035) * (0.55 + rng() * 0.9), phase: rng() * Math.PI * 2 });
  }
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    let s = 0;
    // Periodic phase bending, baked only: curved, broken crests without tile seams.
    const bend = 0.65 * Math.sin(2 * Math.PI * (u + v) + main)
      + 0.35 * Math.sin(2 * Math.PI * (u - 2 * v) - main);
    for (const w of waves) s += w.amp * Math.sin(2 * Math.PI * (w.nx * u + w.nz * v) + w.phase + bend);
    h[y * S + x] = s;
  }
  // Slopes by central difference on the periodic grid, normalised to an RMS slope
  // of 0.12 for the tile; the shader scales each octave from there.
  const sx = new Float32Array(S * S), sz = new Float32Array(S * S);
  let rms = 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    sx[i] = (h[y * S + (x + 1) % S] - h[y * S + (x + S - 1) % S]) * S * 0.5;
    sz[i] = (h[((y + 1) % S) * S + x] - h[((y + S - 1) % S) * S + x]) * S * 0.5;
    rms += sx[i] * sx[i] + sz[i] * sz[i];
  }
  rms = Math.sqrt(rms / (S * S * 2)) || 1;
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    // Stored around 0.5: a byte of 255 decodes to a slope of +0.5.
    data[i * 4] = clamp(0.5 + clamp(sx[i] / rms * 0.12, -0.5, 0.5), 0, 1) * 255;
    data[i * 4 + 1] = clamp(0.5 + clamp(sz[i] / rms * 0.12, -0.5, 0.5), 0, 1) * 255;
    data[i * 4 + 2] = 128; data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true; tex.anisotropy = 4; tex.needsUpdate = true;
  slopeMaps.set(seed, tex);
  return tex;
}

export function makeWater(size, level, sun) {
  // Inland water (a river or a lake, well above sea level) is calm; the sea is not.
  const uniforms = { ...atmosphereUniforms(), wvTime: { value: 0 }, wvSea: { value: level > 60 ? 0.06 : 0.35 },
    wvDeep: { value: new THREE.Color(PALETTE.atmosphere.waterDeep) }, wvSlopes: { value: waveSlopeMap(7331) } };
  if (sun?.isVector3) uniforms.atSun.value.copy(sun);
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: worldVertex,
    fragmentShader: `varying vec3 vWorld; uniform float wvTime, wvSea; uniform vec3 wvDeep; uniform sampler2D wvSlopes; ${atmosphereGLSL}
      // A byte of 255 is a slope of +0.5 (see the bake).
      vec2 wvSlope(vec2 uv) { return texture2D(wvSlopes, uv).rg - 0.5; }
      #ifdef WV_SHALLOWS
      uniform sampler2D wvShallowMap; uniform vec4 wvShallowBox; uniform vec3 wvShallow, wvLagoon, wvReef;
      // the island's shallows: r = depth (0 at the waterline, 1 at 30 m or more), g = reef and weed; open sea
      // outside the baked square
      vec2 wvShallowAt(vec2 p) {
        vec2 uv = (p - wvShallowBox.xy) * wvShallowBox.zw;
        if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return vec2(1.0, 0.0);
        return texture2D(wvShallowMap, uv).rg;
      }
      vec3 wvShallowBody(vec3 deep, vec2 s, float day, float sunK) {
        vec3 c = mix(mix(wvShallow, wvLagoon, smoothstep(0.02, 0.3, s.x)), wvReef, s.y);
        // at a low sun the colour goes too: greyer as well as darker, like the land beside it
        c = mix(vec3(dot(c, vec3(0.3, 0.55, 0.15))), c, 0.3 + 0.7 * sunK);
        return mix(c * day, deep, smoothstep(0.25, 0.85, s.x));
      }
      #endif
      void main() {
        vec2 p = vWorld.xz;
        #ifdef WV_SHALLOWS
        // inside the reef the sea is calmer: a lower swell and chop, fewer whitecaps
        vec2 wvS = wvShallowAt(p);
        float wvCalm = 0.15 + 0.85 * smoothstep(0.1, 0.7, wvS.x);
        #endif
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 v = toCam / max(dist, 0.001);
        float rippleFade = 1.0 - smoothstep(120.0, 420.0, dist);
        float chopFade = 1.0 - smoothstep(500.0, 3200.0, dist);
        float swellFade = 1.0 - smoothstep(2500.0, 14000.0, dist);
        mat2 r1 = mat2(0.80, -0.60, 0.60, 0.80), r2 = mat2(0.31, 0.95, -0.95, 0.31);
        // Inland water has no 85 m swell; the chop and the ripple carry a river.
        vec2 swellMap = wvSlope(p / 85.0 + wvTime * vec2(0.0045, 0.0032));
        vec2 swell = swellMap * 0.90 * swellFade * smoothstep(0.08, 0.24, wvSea);
        // Continuous swell-driven phase drift: rotations alone still repeat.
        // Row-vector multiplication applies the inverse rotation to sampled slopes.
        vec2 chop = ((wvSlope(r1 * p / 15.0 + swellMap * 2.1 + wvTime * vec2(-0.028, 0.041)) * r1) * 0.40
          + (wvSlope(r2 * p / 23.7 - swellMap.yx * 1.7 + wvTime * vec2(0.021, 0.033)) * r2) * 0.35) * (0.4 + wvSea) * chopFade;
        vec2 ripple = (wvSlope(r2 * p / 2.6 + wvTime * vec2(0.11, -0.085)) * r2) * 0.18 * rippleFade;
        #ifdef WV_SHALLOWS
        swell *= 0.35 + 0.65 * wvCalm; chop *= 0.45 + 0.55 * wvCalm;
        #endif
        vec2 slope = swell + chop + ripple;
        vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
        vec3 r = reflect(-v, n);
        r.y = max(r.y, 0.015);
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
        vec3 sky = atmosphere(r);
        // The body: deep blue-green by day, near black at night, lighter on the crests.
        vec3 body = wvDeep * mix(0.025, 0.72, atDay);
        #ifdef WV_SHALLOWS
        // (the sand under a few metres of water is lit by the sun's height, not just by whether it is day:
        // at a low sun it darkens and greys with the land instead of glowing teal against a dusk coast)
        float wvSunK = smoothstep(0.0, 0.35, atSun.y);
        body = wvShallowBody(body, wvS, mix(0.025, 0.72, atDay) * (0.08 + 0.92 * wvSunK), wvSunK);
        #endif
        vec3 col = mix(body, sky, fres);
        // Sun glitter on the perturbed normal; the lobe widens and dims with the pixel
        // footprint so unresolved glints become a soft sheen instead of stripes.
        float s = max(dot(r, atSun), 0.0);
        float footprint = fwidth(s);
        float resolved = (1.0 - smoothstep(0.0004, 0.006, footprint)) * chopFade;
        float glitter = pow(s, mix(90.0, 520.0, resolved)) * mix(0.10, 2.2, resolved);
        col += atWarm * glitter * atDay * (1.0 - atWeather);
        // Whitecaps where the chop is steep, more of them in a rougher sea.
        // Use signed chop so both sides of every wave do not turn white.
        float steep = chop.x * 0.8 + chop.y * 0.6;
        float cap = smoothstep(0.085 + 0.03 * wvSea, 0.135 + 0.03 * wvSea, steep)
          * chopFade * smoothstep(0.12, 0.3, wvSea);
        #ifdef WV_SHALLOWS
        cap *= wvCalm;
        #endif
        col = mix(col, mix(vec3(0.02, 0.025, 0.03), vec3(0.55, 0.58, 0.60), atDay), cap * 0.75);
        // Broad vertical angular lobe becomes a soft band toward the moon. Far
        // water uses the flat reflection, preventing unresolved wave stripes.
        vec3 moonDelta = vec3(-v.x, v.y, -v.z) - atMoon;
        float moonBand = max(1.0 - dot(moonDelta.xz, moonDelta.xz) * 0.9 - moonDelta.y * moonDelta.y * 0.12, 0.0);
        float moon = pow(mix(moonBand, max(dot(r, atMoon), 0.0), rippleFade), mix(80.0, 320.0, rippleFade));
        col += vec3(0.035, 0.046, 0.065) * moon * mix(0.35, 1.0, rippleFade) * (1.0 - atDay) * (1.0 - atWeather);
        gl_FragColor = vec4(col, 1.0);
        ${outputGLSL}
      }` });
  mat.name = 'world/water';
  // Use the same material fog hook as standard surfaces, keeping the reflection
  // and distant water on the same radiance curve as the sky.
  mat.fog = true; Object.assign(uniforms, THREE.UniformsUtils.clone(THREE.UniformsLib.fog));
  mat.vertexShader = mat.vertexShader.replace('varying vec3 vWorld;', 'varying vec3 vWorld;\n#include <fog_pars_vertex>')
    .replace('gl_Position = projectionMatrix * viewMatrix * wp;', 'vec4 mvPosition=viewMatrix*wp; gl_Position=projectionMatrix*mvPosition;\n#include <fog_vertex>');
  mat.fragmentShader = mat.fragmentShader.replace(atmosphereGLSL, atmosphereGLSL + '\n#include <fog_pars_fragment>')
    .replace(outputGLSL, '#include <fog_fragment>\n' + outputGLSL);
  const geo = new THREE.PlaneGeometry(size, size); geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat); mesh.position.y = level; mesh.frustumCulled = false;
  mesh.name = 'world/water';
  return { mesh, material: mat,
    get seaState() { return uniforms.wvSea.value; },
    set seaState(s) { uniforms.wvSea.value = clamp(+s || 0, 0, 1); },
    setSun(dir, dayness) {
      uniforms.atSun.value.copy(dir); uniforms.atDay.value = dayness;
      uniforms.atLow.value = 1 - smoothstep(5 * DEG, 35 * DEG, Math.asin(clamp(dir.y, -1, 1)));
    },
    tick(dt) { uniforms.wvTime.value += dt; },
    // an island's turquoise shallows (the new maps; see the header): call once, before the first frame
    setShallows(field) { bakeShallows(field, uniforms, mat); } };
}

// The depth under the water round an island, baked once: r = depth / 30 m, g = reef patches in 2-15 m.
function bakeShallows(field, uniforms, mat) {
  const I = field.island;
  if (!I) return;
  const reach = (I.shelf || 500) * 2.4 + 200;
  const x0 = I.x - I.rx - reach, x1 = I.x + I.rx + reach, z0 = I.z - I.rz - reach, z1 = I.z + I.rz + reach;
  const N = 384, data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = x0 + (i + 0.5) / N * (x1 - x0), z = z0 + (j + 0.5) / N * (z1 - z0);
    const h = field.height(x, z) - (field.waterLevel || 0);
    const reef = smoothstep(0.1, 0.5, noise2(x / 150, z / 150, field.seed + 61)) * smoothstep(1.5, 4, -h) * (1 - smoothstep(10, 16, -h));
    const k = (j * N + i) * 4;
    data[k] = clamp(-h / 30, 0, 1) * 255; data[k + 1] = reef * 190; data[k + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true; tex.needsUpdate = true;
  const B = BIOMES.island;
  uniforms.wvShallowMap = { value: tex };
  uniforms.wvShallowBox = { value: new THREE.Vector4(x0, z0, 1 / (x1 - x0), 1 / (z1 - z0)) };
  uniforms.wvShallow = { value: new THREE.Vector3(...B.shallow) };
  uniforms.wvLagoon = { value: new THREE.Vector3(...B.lagoon) };
  uniforms.wvReef = { value: new THREE.Vector3(...B.reef) };
  mat.defines = { ...(mat.defines || {}), WV_SHALLOWS: '' };
  mat.needsUpdate = true;
}
