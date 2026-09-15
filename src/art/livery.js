// How the aircraft look: paint, glass, metal, tyres, the downloaded models' finish,
// the navigation lights and the propeller disc.
//
// The split with src/aircraft/ is the same one the world uses. `models.js` owns what
// an aircraft IS as far as the game is concerned: which downloaded model it uses, how
// that model is rotated and scaled onto the physics definition, where the hinge lines
// of its control surfaces are, what the parts are called and how they animate. This
// file owns what all of that is painted with.
//
// Nothing in here may change a dimension, a hinge line, a part name or an animation.
// The aircraft are flown by numbers in `aircraft/defs.js` and drawn at a scale fitted
// to the wingspan; a paint job cannot alter either.
//
// Three of the four airframes are downloaded glTF models (Poly Pizza, CC-BY — see
// CREDITS.md) with their own materials. `dressGltf()` is the one pass over a loaded
// model, and it is where a real paint job belongs. There is also a full set of
// procedural airframes used when glTF is switched off (`window.CTL_NO_GLTF`, and
// the low end if a model fails to load); those are built from the same material
// vocabulary, so a change here shows up in both.
import * as THREE from 'three';
import { getDisc } from './lights.js';
import { PALETTE } from './palette.js';

// No UV assumptions: three of the source files have no texture coordinates at all.
// Coordinates are projected in the aircraft frame, never the world frame, so paint
// follows the aeroplane. Only material uniforms change; vertex positions do not.
const COLOURS = {
  skylark: { white: 0xf2f3f0, blue: 0x2a5fb0, pant: 0xf2f3f0 },
  trailblazer: { yellow: 0xf2c21b, black: 0x242522 },
  condor: { white: 0xf4f5f4, belly: 0x9aa3ab, blue: 0x1e4f9a },
  hornet: { gray: 0x8a949c, gray2: 0x6f7a83 },
};
const REGISTRATION = { skylark: 'N172GS', trailblazer: 'N48TB', condor: 'N700GC', hornet: 'NAVY  207' };
// Textures are cached for the life of the page; MATERIALS DELIBERATELY ARE NOT.
// SkySystem.installFog() patches every fogged material in its scene, and a new
// SkySystem is built for every scenario, so a material shared between two scenarios
// gets patched twice and its shader stops compiling - which means an aircraft that is
// simply not drawn. Materials are cheap here: three.js keys compiled programs by
// customProgramCacheKey(), so two materials with the same key still share one program.
const registrations = new Map();
const sceneSkies = new WeakMap();
function registration(id) {
  if (registrations.has(id)) return registrations.get(id);
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 512, 128);
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 72px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(REGISTRATION[id], 256, 64, 480);
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  registrations.set(id, texture);
  return texture;
}

// Read the existing analytic sky's public material uniforms. No cube-camera render,
// no frozen blue environment at night. A scene lookup is cached, not a scene walk
// per glass pane. The fallback is only for consumers without a SkySystem.
//
// These are deliberately prefixed `ac` rather than reusing the sky's own `at` names.
// SkySystem.installFog() patches EVERY fogged material in the scene - the aircraft
// included - and injects its own `uniform vec3 atSun, atZenith, ...` block. Declaring
// the same names here made the fragment shader fail to compile with a redefinition
// error, and an aircraft whose shader does not compile is simply not drawn. If you add
// more uniforms in this file, keep them under a prefix of their own.
const SKY_SOURCE = {
  acSun: 'atSun', acZenith: 'atZenith', acHorizon: 'atHorizon', acWarm: 'atWarm',
  acNight: 'atNight', acDay: 'atDay', acLow: 'atLow', acWeather: 'atWeather',
};
function skyUniforms() {
  const p = PALETTE.atmosphere;
  return {
    acSun: { value: new THREE.Vector3(0, 1, 0) },
    acZenith: { value: new THREE.Color(p.zenith) }, acHorizon: { value: new THREE.Color(p.horizon) },
    acWarm: { value: new THREE.Color(p.warm) }, acNight: { value: new THREE.Color(p.night) },
    acDay: { value: 1 }, acLow: { value: 0 }, acWeather: { value: 0 },
  };
}
const reflectedSky = `
 uniform vec3 acSun, acZenith, acHorizon, acWarm, acNight;
 uniform float acDay, acLow, acWeather;
 vec3 aircraftSky(vec3 d) {
   float h = pow(clamp(d.y, 0.0, 1.0), 0.42);
   vec3 horizon = mix(acHorizon, acWarm, pow(max(dot(d, acSun), 0.0), 8.0)*acLow*0.75);
   vec3 sky = mix(acNight*mix(2.8, 0.45, h), mix(horizon, acZenith, h), acDay);
   vec3 mist = mix(acNight*2.0, acHorizon*0.83, acDay);
   sky = mix(sky, mist*(0.96+0.04*max(d.y, 0.0)), acWeather);
   return mix(sky*0.32, sky, smoothstep(-0.12, 0.08, d.y));
 }
`;

function finishMaterial(material, { id = 'skylark', kind = 'paint', imported = false } = {}) {
  // Named so a shader-compile error in the console says which material it was.
  if (!material.name) material.name = `${id}:${kind}${imported ? ':gltf' : ''}`;
  const projection = { value: new THREE.Matrix4() };
  const sky = skyUniforms();
  const reg = { value: null };
  // Fallback meshes are authored in metres, centred approximately at the CG.
  const dimensions = { skylark: [11, 5, 10], trailblazer: [10.7, 4, 9], condor: [34, 13, 40], hornet: [12.4, 7, 18] }[id];
  const fallback = new THREE.Matrix4().makeScale(1/dimensions[0], 1/dimensions[1], 1/dimensions[2]);
  fallback.setPosition(0, 0.35, 0.42);
  projection.value.copy(fallback);
  material.onBeforeRender = (renderer, scene, camera, geometry, object) => {
    let source = sceneSkies.get(scene);
    if (!source) {
      source = scene.children.find(o => o.material?.uniforms?.atZenith)?.material.uniforms;
      if (source) sceneSkies.set(scene, source);
    }
    if (source) for (const key in sky) { const from = source[SKY_SOURCE[key]]; if (from) sky[key].value = from.value; }
  };
  material.customProgramCacheKey = () => `aircraft-finish-4-${id}-${kind}-${imported}`;
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, sky, { aircraftProjection: projection, aircraftRegistration: reg });
    if (kind === 'paint') reg.value = registration(id);
    shader.vertexShader = (imported ? 'attribute vec3 aircraftCoord;\n' : '') + 'uniform mat4 aircraftProjection; varying vec3 aircraftP; varying vec3 aircraftLocal; varying vec3 aircraftN;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      aircraftP = ${imported ? 'aircraftCoord' : '(aircraftProjection * vec4(position, 1.0)).xyz'};
      aircraftLocal = position;
      aircraftN = normal;
    `);
    shader.fragmentShader = `varying vec3 aircraftP; varying vec3 aircraftLocal; varying vec3 aircraftN;
      uniform sampler2D aircraftRegistration;
      ${reflectedSky}
      // Pixel footprint fades fine features before they can shimmer in a long lens.
      float seam(float x, float width) {
        float aa = max(fwidth(x), 0.00001);
        return (1.0-smoothstep(width, width+aa, abs(fract(x+0.5)-0.5)))
          * (1.0-smoothstep(0.08, 0.3, aa));
      }
    ` + shader.fragmentShader;
    let colour = '';
    if (kind === 'paint') colour = `
      vec3 p = aircraftP;
      vec3 face = abs(normalize(cross(dFdx(p), dFdy(p))));
      float sideFace = smoothstep(0.55, 0.85, face.x);
      vec2 panel = mix(p.xz*vec2(13.0, 17.0), p.zy*vec2(17.0, 9.0), sideFace);
      float lines = max(seam(panel.x, 0.007), seam(panel.y, 0.006));
      float rivets = seam(panel.x+0.026, 0.010)*seam(panel.y*12.0, 0.09);
      float finishVariation = sin(panel.x*2.1)*sin(panel.y*1.7);
      // A slight root scuff and underside service grime, not an all-over dirt wash.
      float rootWear = exp(-pow((abs(p.x)-0.075)*40.0, 2.0))*exp(-pow((p.z-0.43)*9.0, 2.0));
      float underside = (1.0-smoothstep(0.16, 0.32, p.y))*exp(-pow((p.z-0.48)*5.0, 2.0));
      diffuseColor.rgb *= 1.0 - 0.12*lines - 0.09*rivets + 0.008*finishVariation - 0.025*rootWear - 0.025*underside;
      // One aft-fuselage marking on either side, with outward-facing lettering.
      vec2 label = vec2((p.z-0.66)*sign(p.x)/0.23+0.5, (p.y-${imported ? { skylark: 0.34, trailblazer: 0.43, condor: 0.54, hornet: 0.39 }[id] : 0.39})/0.065+0.5);
      float inside = step(0.0,label.x)*step(label.x,1.0)*step(0.0,label.y)*step(label.y,1.0);
      float legible = 1.0-smoothstep(0.015,0.055,max(fwidth(label.x),fwidth(label.y)));
      float ink = texture2D(aircraftRegistration, clamp(label,0.0,1.0)).a*inside*sideFace*legible*(1.0-smoothstep(0.09,0.13,abs(p.x)));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.055,0.072,0.085), ink*0.85);
      ${id === 'condor' && imported ? `
      // The source combines nacelles and wing paint. Isolate the intake lip in
      // body coordinates rather than making the whole white wing metallic.
      float nacelle = (1.0-smoothstep(0.035,0.05,abs(abs(p.x)-0.205)))
        *(1.0-smoothstep(0.35,0.40,p.y))*smoothstep(0.23,0.27,p.y);
      float intakeLip = nacelle*(1.0-smoothstep(0.008,0.018,abs(p.z-0.36)));
      diffuseColor.rgb = mix(diffuseColor.rgb,vec3(0.40,0.44,0.47),intakeLip);
      ` : ''}
    `;
    if (kind === 'rubber' || kind === 'mixedDark') colour = `
      // Cylindrical fallback tyres have local Y axles; imported wheels have body X axles.
      vec3 q = ${imported ? 'aircraftP' : 'aircraftLocal'};
      float sidewall = ${imported ? 'smoothstep(0.65,0.9,abs(normalize(cross(dFdx(q),dFdy(q))).x))' : 'smoothstep(0.65,0.9,abs(aircraftN.y))'};
      float tread = seam(${imported ? 'q.z*180.0' : 'atan(q.z,q.x)*18.0/3.14159265'},0.09);
      float ribs = seam(${imported ? 'q.y*100.0' : 'length(q.xz)*22.0'},0.055);
      float rubberMask = ${kind === 'mixedDark' ? '1.0-smoothstep(0.22,0.34,aircraftP.y)' : '1.0'};
      diffuseColor.rgb *= 1.0 + rubberMask*(0.15*sidewall-0.28*mix(tread,ribs,sidewall));
    `;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + colour);
    if (kind === 'paint') shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
      #include <roughnessmap_fragment>
      roughnessFactor = clamp(roughnessFactor + 0.035*lines + 0.018*finishVariation + 0.06*rootWear, 0.0, 1.0);
      ${id === 'condor' && imported ? 'roughnessFactor = mix(roughnessFactor,0.28,intakeLip);' : ''}
    `);
    if (kind === 'paint' && id === 'condor' && imported) shader.fragmentShader = shader.fragmentShader.replace('#include <metalnessmap_fragment>', `
      #include <metalnessmap_fragment>
      metalnessFactor = mix(metalnessFactor,0.8,intakeLip);
    `);
    if (['glass', 'metal', 'mixedDark'].includes(kind)) shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      vec3 worldNormal = inverseTransformDirection(normal, viewMatrix);
      vec3 viewDir = inverseTransformDirection(normalize(vViewPosition), viewMatrix);
      vec3 reflected = reflect(-viewDir, worldNormal);
      float fresnel = pow(1.0-clamp(dot(normal,normalize(vViewPosition)),0.0,1.0),5.0);
      float reflectionMask = ${kind === 'mixedDark' ? 'smoothstep(0.34,0.43,aircraftP.y)' : '1.0'};
      outgoingLight = mix(outgoingLight, aircraftSky(reflected), reflectionMask*${kind === 'metal' ? '(0.24+0.38*fresnel)' : '(0.32+0.66*fresnel)'});
      #include <opaque_fragment>
    `);
  };
  return material;
}

export const paint = (color, o = {}) => finishMaterial(new THREE.MeshStandardMaterial({
  color, roughness: o.rough ?? 0.6, metalness: o.metal ?? 0.1, ...o.extra,
}));
export const glass = () => finishMaterial(new THREE.MeshStandardMaterial({ color: 0x1b2a3a, roughness: 0.12, metalness: 0.05 }), { kind: 'glass' });
export const dark = () => new THREE.MeshStandardMaterial({ color: 0x292d31, roughness: 0.72, metalness: 0.1, name: 'aircraft:dark' });
export const tire = () => finishMaterial(new THREE.MeshStandardMaterial({ color: 0x242524, roughness: 0.94, metalness: 0 }), { kind: 'rubber' });

function materials(id) {
  const out = {};
  for (const [key, color] of Object.entries(COLOURS[id])) out[key] = finishMaterial(new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 }), { id });
  out.metal = finishMaterial(new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.32, metalness: 0.78 }), { id, kind: 'metal' });
  out.glass = glass(); out.dark = dark(); out.tire = tire();
  if (id === 'hornet') out.dark = finishMaterial(new THREE.MeshStandardMaterial({ color: 0x393b3d, roughness: 0.43, metalness: 0.7 }), { id, kind: 'metal' });
  if (id === 'condor') out.belly = finishMaterial(new THREE.MeshStandardMaterial({ color: COLOURS.condor.belly, roughness: 0.38, metalness: 0.6 }), { id, kind: 'metal' });
  return out;
}
export const LIVERY = {
  skylark: () => materials('skylark'), trailblazer: () => materials('trailblazer'),
  condor: () => materials('condor'), hornet: () => materials('hornet'),
};

export function paintSurfaces(id, spec) {
  const c = COLOURS[id];
  if (!c) return { ...spec };
  const color = c.white ?? c.yellow ?? c.gray;
  const out = { ...spec, color };
  if (spec.elevator) out.elevator = { ...spec.elevator, color };
  if (spec.rudder) out.rudder = { ...spec.rudder, color: id === 'hornet' ? c.gray2 : id === 'condor' || id === 'skylark' ? c.blue : color };
  return out;
}

// Source-material names are read from the shipped GLBs. Several dark primitives
// combine tyres and windows; a height mask separates rubber from reflected glass.
const SOURCE = {
  skylark: { White: 'white', Red: 'blue', Gray: 'metal', Black: 'mixedDark' },
  // mat23 includes the underwing trim; matte black prevents a blue sky cast.
  trailblazer: { mat12: 'yellow', mat23: 'black', mat16: 'glass', mat21: 'metal', mat17: 'metal', mat14: 'black', mat20: 'black', mat22: 'metal' },
  condor: { mat21: 'white', mat23: 'mixedDark', mat5: 'blue', mat15: 'metal', mat22: 'metal', mat17: 'rubber' },
  hornet: { mat17: 'gray2', mat3: 'glass', mat15: 'gray2', mat21: 'gray', mat23: 'mixedDark', mat13: 'metal', mat8: 'gray2', mat12: 'metal' },
};
export function dressGltf(root, id) {
  // One material per role for THIS model, rebuilt per load (see the note above).
  const dressed = new Map();
  if (!SOURCE[id]) return root;
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert();
  const yaw = new THREE.Matrix4().makeRotationY({ skylark: 0, trailblazer: Math.PI/2, condor: Math.PI, hornet: Math.PI/2 }[id]);
  const bounds = new THREE.Box3(), point = new THREE.Vector3();
  const meshes = [];
  root.traverse(m => {
    if (!m.isMesh || !m.geometry?.attributes.position) return;
    const transform = yaw.clone().multiply(inverse).multiply(m.matrixWorld);
    const positions = m.geometry.attributes.position;
    for (let i=0; i<positions.count; i++) bounds.expandByPoint(point.fromBufferAttribute(positions,i).applyMatrix4(transform));
    meshes.push({ m, transform });
  });
  if (!meshes.length) return root;
  const size = bounds.getSize(new THREE.Vector3()), centre = bounds.getCenter(new THREE.Vector3());
  const normalize = new THREE.Matrix4().makeScale(1/Math.max(size.x,0.001),1/Math.max(size.y,0.001),1/Math.max(size.z,0.001));
  normalize.multiply(new THREE.Matrix4().makeTranslation(-centre.x,-bounds.min.y,-bounds.min.z));
  for (const { m, transform } of meshes) {
    // Add only paint coordinates. Positions, normals, indices, UVs, transforms and
    // bounding volumes remain untouched, including meshes sharing a material.
    const projection = normalize.clone().multiply(transform);
    const positions = m.geometry.attributes.position;
    const coords = new Float32Array(positions.count*3);
    for (let i=0; i<positions.count; i++) {
      point.fromBufferAttribute(positions,i).applyMatrix4(projection).toArray(coords,i*3);
    }
    m.geometry.setAttribute('aircraftCoord', new THREE.BufferAttribute(coords,3));
    m.castShadow = true; m.receiveShadow = true;
    const apply = source => {
      if (!source) return source;
      // Avoid interpreting a propeller blade as a high cabin window.
      const prop = /propeller/i.test(m.name) || /propeller/i.test(m.parent?.name || '');
      const role = prop && source.name === 'Black' ? 'dark' : SOURCE[id][source.name];
      if (!role) return source;
      const key = id+':'+role;
      if (!dressed.has(key)) {
        const base = materials(id);
        const mat = (base[role] || (role === 'rubber' ? base.tire : base.dark)).clone();
        mat.side = THREE.FrontSide;
        mat.name = key;
        const kind = ['glass','metal','mixedDark','rubber'].includes(role) ? role : role === 'dark' ? 'plain' : 'paint';
        if (role === 'mixedDark') { mat.color.set(0x242a2e); mat.roughness = 0.55; }
        dressed.set(key, finishMaterial(mat, { id, kind, imported: true }));
      }
      return dressed.get(key);
    };
    m.material = Array.isArray(m.material) ? m.material.map(apply) : apply(m.material);
  }
  return root;
}

// The navigation lights: ONE Points object per aircraft with six vertices (left, right,
// tail, beacon, two strobes), a per-vertex colour, pixel size and on/off attribute, and
// one small shader. Pixel sizes are independent of range, zoom or the parent's scale;
// depth testing still hides a light behind the airframe. The blink is written into the
// `aOn` attribute by `set(name, value)` - never by a material property, so parked
// aircraft can share the program and each keeps its own timing (docs/PERF.md: six
// draws per aircraft became one).
const NAV_NAMES = ['left', 'right', 'tail', 'beacon', 'strobeL', 'strobeR'];
const NAV_COLOURS = [0xff3030, 0x30ff60, 0xffffff, 0xff3030, 0xffffff, 0xffffff];
const NAV_SIZES = [5, 5, 4, 6, 7, 7];
export function navLights(group, positions) {
  const at = [positions.left, positions.right, positions.tail, positions.top, positions.left, positions.right];
  const pos = new Float32Array(18), col = new Float32Array(18), size = new Float32Array(6), on = new Float32Array(6);
  const c = new THREE.Color();
  for (let i = 0; i < 6; i++) {
    pos[i * 3] = at[i].x; pos[i * 3 + 1] = at[i].y; pos[i * 3 + 2] = at[i].z;
    c.set(NAV_COLOURS[i]); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    size[i] = NAV_SIZES[i]; on[i] = i < 3 ? 1 : 0;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const onAttr = new THREE.BufferAttribute(on, 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aOn', onAttr);
  const mat = new THREE.ShaderMaterial({
    name: 'aircraft:navLights',
    uniforms: { map: { value: getDisc() }, uDpr: { value: 1 } },
    vertexShader: `attribute vec3 aColor; attribute float aSize; attribute float aOn; uniform float uDpr;
      varying vec3 vC; varying float vOn;
      void main() { vC = aColor; vOn = aOn; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uDpr; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D map; varying vec3 vC; varying float vOn;
      void main() { if (vOn <= 0.001) discard; vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC, t.a * vOn); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, toneMapped: false, fog: false,
  });
  mat.onBeforeRender = (renderer) => { mat.uniforms.uDpr.value = renderer.getPixelRatio(); };
  const points = new THREE.Points(geo, mat);
  points.name = 'navLights';
  points.frustumCulled = false;   // six pixels on a moving aircraft: not worth a sphere
  group.add(points);
  const index = Object.fromEntries(NAV_NAMES.map((n, i) => [n, i]));
  return {
    points, names: NAV_NAMES,
    // value 0..1: the light's brightness this frame (the beacon idles at 0.05, the strobes at 0)
    set(name, value) { const i = index[name]; if (i === undefined || on[i] === value) return; on[i] = value; onAttr.needsUpdate = true; },
  };
}

let propTexture;
function blurredProp() {
  if (propTexture) return propTexture;
  const size = 128, data = new Uint8Array(size*size*4);
  for (let y=0; y<size; y++) for (let x=0; x<size; x++) {
    const u=(x+0.5)/size*2-1, v=(y+0.5)/size*2-1;
    const r=Math.hypot(u,v), angle=Math.atan2(v,u);
    const edge=Math.max(0,Math.min(1,(1-r)/0.12));
    const density=(0.12+0.68*Math.exp(-r*r*4))*(0.82+0.18*Math.cos(angle*2+r*5));
    const i=(y*size+x)*4;
    data[i]=data[i+1]=data[i+2]=105;
    data[i+3]=Math.round(255*density*edge);
  }
  propTexture = new THREE.DataTexture(data,size,size);
  propTexture.colorSpace = THREE.SRGBColorSpace;
  propTexture.magFilter = THREE.LinearFilter; propTexture.minFilter = THREE.LinearMipmapLinearFilter;
  propTexture.generateMipmaps = true; propTexture.needsUpdate = true;
  return propTexture;
}
export function propDisc(radius) {
  return new THREE.Mesh(new THREE.CircleGeometry(radius,64), new THREE.MeshBasicMaterial({
    map: blurredProp(), color: 0xffffff, transparent: true, opacity: 0.2,
    side: THREE.DoubleSide, depthWrite: false, forceSinglePass: true, name: 'aircraft:propDisc',   // without forceSinglePass a transparent DoubleSide material is re-keyed twice per frame (docs/PERF.md section 5)
  }));
}
