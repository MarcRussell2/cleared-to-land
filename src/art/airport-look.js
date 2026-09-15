// How an aerodrome looks: the pavement, the buildings, and everything standing
// around the runway.
//
// world/airport.js owns what the aerodrome IS — where the runway is, how long and
// how wide, the PAPI angles, where every light sits, the ILS geometry, the ground
// query the physics calls. This file owns how all of that is rendered.
//
// Two things are handed in rather than imported, so nothing here needs to know how
// a runway is laid out:
//
//   rw       the resolved runway: length, width, surface, heading (radians),
//            elevation, slope, name, nameRecip, aimDistance. Read-only.
//   place    place(u, v, out) -> out, the world point u metres along the runway
//            from the threshold and v metres to the right of the centreline,
//            already at the right height. Use it for everything you position.
//
// Where a builder draws something solid, it returns `obstacles` alongside the
// objects: {x, z, r, y, kind, name} records that world/airport.js registers with
// the physics. Whatever you draw, return an obstacle that matches it — a hangar
// you can fly through is worse than no hangar.
import * as THREE from 'three';
import { clamp, noise2 } from '../config.js';
import { mergeGeos } from '../geom.js';
import { PALETTE, FINISH } from './palette.js';
import { runwaySurface } from './textures.js';

// The runway surface itself. The mesh is built by airport.js (its shape has to
// follow the runway's slope exactly); this is what it is painted with.
export function runwayMaterial(rw) {
  const mat = new THREE.MeshStandardMaterial({
    map: runwaySurface(rw), ...FINISH.runway,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  mat.name = 'aerodrome/runway';
  // Grain under the wheels: a tiling aggregate texture at a 3 m repeat, faded out
  // beyond 250 m so the painted surface carries the runway from the approach and
  // the grain carries it in the flare. Uniforms prefixed `ap`.
  const grain = surfaceGrain(rw.surface);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.apGrain = { value: grain };
    shader.uniforms.apSize = { value: new THREE.Vector2(rw.length, rw.width) };
    shader.vertexShader = 'varying vec2 apUv;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\napUv = uv;');
    shader.fragmentShader = 'varying vec2 apUv; uniform sampler2D apGrain; uniform vec2 apSize;\n' + shader.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
        float apDist = length(vViewPosition);
        float apNear = 1.0 - smoothstep(120.0, 260.0, apDist);
        vec2 apMetres = apUv * apSize;
        float apG = texture2D(apGrain, apMetres / 3.0).r * 0.6 + texture2D(apGrain, apMetres / 0.7 + 0.37).r * 0.4;
        diffuseColor.rgb *= mix(1.0, 0.72 + 0.56 * apG, apNear);`);
  };
  mat.customProgramCacheKey = () => 'ctl-runway-v2';
  return mat;
}

// A 512 px periodic aggregate/gravel texture, grey around 0.5, cached per surface.
const grains = new Map();
function surfaceGrain(surface) {
  const key = surface === 'asphalt' ? 'asphalt' : 'loose';
  if (grains.has(key)) return grains.get(key);
  const S = 512, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S), d = img.data;
  const loose = key === 'loose';
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const periodic = (scale, seed) => {
      const u = x / S, v = y / S;
      return (1 - v) * ((1 - u) * noise2(x / scale, y / scale, seed) + u * noise2((x - S) / scale, y / scale, seed))
        + v * ((1 - u) * noise2(x / scale, (y - S) / scale, seed) + u * noise2((x - S) / scale, (y - S) / scale, seed));
    };
    const n = periodic(2.3, 41) * 0.55 + periodic(6.1, 43) * 0.3 + periodic(19, 47) * 0.25;
    const v = clamp(128 + n * (loose ? 70 : 48), 0, 255);
    const i = (y * S + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  grains.set(key, t);
  return t;
}

// Paved shoulders, the parallel taxiway, its turnoffs, the apron and the taxiway
// centreline. Paved runways only.
export function buildShoulders(rw, place) {
  const objects = [];
  const mat = new THREE.MeshStandardMaterial({ color: PALETTE.shoulder, ...FINISH.shoulder });
  // Metre-space pavement: slab repairs, oil stains and ragged grass at edges.
  // UVs hold physical dimensions, so the apron and narrow turnoffs share scale.
  mat.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec2 pavementUV;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\npavementUV=uv;');
    shader.fragmentShader='varying vec2 pavementUV;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      vec2 p=pavementUV;
      float stain=sin(p.x*0.17+sin(p.y*0.31))*sin(p.y*0.23+p.x*0.07);
      float slab=sin(floor(p.x/9.0)*1.7+floor(p.y/7.0)*2.3);
      vec2 seam=abs(fract(p/vec2(9.0,7.0))-0.5)*vec2(9.0,7.0);
      float joint=1.0-smoothstep(0.035,0.035+max(fwidth(p.x),fwidth(p.y)),min(seam.x,seam.y));
      diffuseColor.rgb*=1.0+0.14*slab+0.13*stain-0.17*joint;
    `);
  };
  mat.customProgramCacheKey=()=> 'ctl-pavement-v1';
  const tmp = new THREE.Vector3();
  const twyOffset = rw.width / 2 + 90;
  const add = (u0, u1, v0, v1, m = mat) => {
    const g = new THREE.PlaneGeometry(u1 - u0, v1 - v0, 4, 1);
    const p = g.attributes.position;
    const uv=g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      if(m===mat)uv.setXY(i,p.getX(i)+(u0+u1)/2,-p.getY(i)+(v0+v1)/2);
      place(p.getX(i) + (u0 + u1) / 2, -p.getY(i) + (v0 + v1) / 2, tmp);
      p.setXYZ(i, tmp.x, tmp.y + (m===mat ? 0.05 : 0.035), tmp.z);
    }
    g.computeVertexNormals();
    const mm = new THREE.Mesh(g, m);
    mm.receiveShadow = true;
    objects.push(mm);
    return mm;
  };
  // Flat visual shoulder lips: no change to runway height or ground queries.
  const fringe=new THREE.MeshStandardMaterial({color:0x72715a,...FINISH.shoulder,transparent:true,depthWrite:false});
  fringe.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec2 edgeUV;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nedgeUV=uv;');
    shader.fragmentShader='varying vec2 edgeUV;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float rough=0.12*sin(edgeUV.x*731.0)+0.08*sin(edgeUV.x*1931.0);
      diffuseColor.a*=smoothstep(0.0,0.30,edgeUV.y+rough)*smoothstep(0.0,0.30,1.0-edgeUV.y+rough);
    `);
  };
  fringe.customProgramCacheKey=()=> 'ctl-shoulder-edge-v1';
  for(const side of [-1,1]) {
    const edge=side*(rw.width/2+1.5);
    add(0,rw.length,edge-2.5,edge+2.5,fringe);
  }
  for(const edge of [twyOffset-12,twyOffset+12])add(0,rw.length,edge-1.7,edge+1.7,fringe);
  add(0, rw.length, twyOffset - 12, twyOffset + 12);
  for (const u of [40, rw.length * 0.5, rw.length - 40]) add(u - 12, u + 12, rw.width / 2, twyOffset);
  // apron
  add(rw.length * 0.35, rw.length * 0.62, twyOffset + 12, twyOffset + 170);
  add(rw.length * 0.35,rw.length * 0.62,twyOffset+168.5,twyOffset+172,fringe);
  // taxiway centreline (yellow) as a thin strip
  const yellow = new THREE.MeshStandardMaterial({ color: PALETTE.taxiLine, ...FINISH.paint });
  add(0, rw.length, twyOffset - 0.25, twyOffset + 0.25, yellow).position.y += 0.02;
  return objects;
}

// Hangars, T-hangars, terminal, tower, fuel farm and the aircraft parked on the
// apron. Returns { objects, obstacles, towerPos }; towerPos is where the tower
// camera sits, so keep it at the top of whatever you build for the tower.
//
// `parked(kind)` is supplied by airport.js and returns a finished, static model to
// stand on the apron: 'light' for a trainer, 'airliner' for a jet. The aircraft
// themselves are not part of the art bench, so this is the only way to reach them.
export function buildBuildings(rw, place, parked) {
  const objects = [], obstacles = [];
  const tmp = new THREE.Vector3();
  const B = PALETTE.buildings;
  const mat = new THREE.MeshStandardMaterial({ color: B.hangar, ...FINISH.building });
  const mat2 = new THREE.MeshStandardMaterial({ color: B.tHangar, ...FINISH.building });
  const roof = new THREE.MeshStandardMaterial({ color: B.roof, ...FINISH.building });
  const glass = new THREE.MeshStandardMaterial({ color: B.glass, ...FINISH.glass });
  // Surface relief/paint only: all details stay on the existing box envelope,
  // so the registered obstacles and the tower camera remain unchanged.
  for(const material of [mat,mat2,roof]) {
    material.onBeforeCompile=shader=>{
      shader.vertexShader='varying vec3 buildingP; varying vec3 buildingN;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nbuildingP=position; buildingN=normal;');
      shader.fragmentShader='varying vec3 buildingP; varying vec3 buildingN;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
        float roofFace=step(0.5,buildingN.y);
        float along=abs(buildingN.z)>0.5?buildingP.x:buildingP.z;
        float ribAA=max(0.04,fwidth(along));
        float rib=1.0-smoothstep(0.03,0.03+ribAA,abs(fract(along/0.75)-0.5)*0.75);
        float bay=step(abs(mod(along+7.0,14.0)-7.0),5.6);
        float door=bay*(1.0-step(2.0,buildingP.y))*(1.0-roofFace);
        float window=bay*step(2.1,buildingP.y)*(1.0-step(3.3,buildingP.y))*(1.0-roofFace);
        float roofPanel=0.5+0.5*sin(floor(buildingP.x/4.0)*2.1);
        diffuseColor.rgb*=1.0-0.12*rib-0.30*door+roofFace*(roofPanel*0.13-0.06);
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.09,0.15,0.18),window*0.75);
      `);
    };
    material.customProgramCacheKey=()=> 'ctl-building-bays-v1';
  }
  const twy = rw.width / 2 + 90;
  const addBox = (u, v, w, d, h, m) => {
    place(u, v, tmp);
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(tmp.x, tmp.y + h / 2, tmp.z);
    b.rotation.y = -rw.heading;
    b.castShadow = true; b.receiveShadow = true;
    objects.push(b);
    obstacles.push({ x: tmp.x, z: tmp.z, r: Math.max(w, d) * 0.5, y: tmp.y + h, kind: 'structure', name: 'a building' });
    return b;
  };
  // big hangars and a row of T-hangars
  addBox(rw.length * 0.40, twy + 215, 70, 50, 16, mat);
  addBox(rw.length * 0.47, twy + 215, 70, 50, 16, mat);
  for (let i = 0; i < 5; i++) addBox(rw.length * 0.28 + i * 16, twy + 190, 14, 22, 5.5, mat2);
  // terminal + tower
  addBox(rw.length * 0.58, twy + 200, 110, 30, 10, roof);
  addBox(rw.length * 0.58, twy + 220, 60, 12, 14, glass);
  // fuel farm
  for (let i = 0; i < 3; i++) {
    place(rw.length * 0.66 + i * 9, twy + 200, tmp);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 7, 14),
      new THREE.MeshStandardMaterial({ color: B.fuelTank, ...FINISH.metal }));
    c.position.set(tmp.x, tmp.y + 3.5, tmp.z); c.castShadow = true; objects.push(c);
  }
  place(rw.length * 0.53, twy + 250, tmp);
  const tw = new THREE.Group();
  tw.position.copy(tmp);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.8, 30, 10), mat);
  shaft.position.y = 15;
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 4.5, 5, 10), glass);
  cab.position.y = 32.5;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(6, 5.8, 1.2, 10), roof);
  cap.position.y = 35.6;
  shaft.castShadow = cab.castShadow = true;
  tw.add(shaft, cab, cap);
  objects.push(tw);
  obstacles.push({ x: tmp.x, z: tmp.z, r: 6, y: tmp.y + 36, kind: 'structure', name: 'the control tower' });
  const towerPos = tmp.clone().add(new THREE.Vector3(0, 34, 0));
  // parked aircraft on the apron
  const apron = [
    { kind: 'light', u: rw.length * 0.38, v: twy + 60, rot: 0.3 },
    { kind: 'light', u: rw.length * 0.38 + 16, v: twy + 60, rot: 0.1 },
    { kind: 'light', u: rw.length * 0.38 + 32, v: twy + 60, rot: -0.2 },
    { kind: 'light', u: rw.length * 0.38 + 48, v: twy + 60, rot: 0.15 },
  ];
  if (rw.length > 2000) {
    apron.push({ kind: 'airliner', u: rw.length * 0.55, v: twy + 120, rot: Math.PI / 2 + 0.1 });
    apron.push({ kind: 'airliner', u: rw.length * 0.60, v: twy + 120, rot: Math.PI / 2 - 0.05 });
  }
  if (parked) {
    // The parked models are the downloaded airframes at 47-100 meshes each; drawn
    // in full they were the single biggest draw-call sink in the game (six of them,
    // a few pixels each, a kilometre from the approach). They live under a LOD that
    // drops them entirely beyond a distance, and they cast no shadows: the shadow
    // camera is a 180 m box around the flying airplane and never reaches the apron.
    for (const p of apron) {
      const m = parked(p.kind);
      place(p.u, p.v, tmp);
      m.group.position.set(tmp.x, tmp.y + m.cgHeight - 0.05, tmp.z);
      m.group.rotation.y = -rw.heading + p.rot;
      const still = flattenParked(m.group);
      still.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      const lod = new THREE.LOD();
      lod.name = 'aerodrome/parked-' + p.kind;
      lod.position.copy(still.position);
      still.position.set(0, 0, 0);
      lod.addLevel(still, 0);
      lod.addLevel(new THREE.Group(), p.kind === 'airliner' ? 1800 : 900, 0.1);
      objects.push(lod);
    }
  }
  return { objects, obstacles, towerPos };
}

// A parked airframe is a downloaded model of 47-100 meshes. Standing still on the
// apron it needs none of that structure, so its meshes are baked into one mesh per
// material (world's transform applied, normals kept): a handful of draws instead
// of a hundred. Meshes with an array material or without normals are left alone.
function flattenParked(group) {
  group.updateMatrixWorld(true);
  const byMaterial = new Map();
  const keep = [];
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  group.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const geo = o.geometry;
    if (Array.isArray(o.material) || !geo.attributes.position || !geo.attributes.normal || o.isInstancedMesh || o.isSkinnedMesh) { keep.push(o); return; }
    const g = geo.clone();
    const local = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    g.applyMatrix4(local);
    if (!byMaterial.has(o.material)) byMaterial.set(o.material, []);
    byMaterial.get(o.material).push(g);
  });
  const out = new THREE.Group();
  out.position.copy(group.position);
  out.quaternion.copy(group.quaternion);
  out.scale.copy(group.scale);
  for (const [material, geos] of byMaterial) {
    const merged = mergeGeos(geos);
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = 'aerodrome/parked-part';
    out.add(mesh);
    for (const g of geos) g.dispose();
  }
  for (const o of keep) {
    const clone = o.clone();
    clone.matrix.copy(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    clone.matrix.decompose(clone.position, clone.quaternion, clone.scale);
    out.add(clone);
  }
  return out;
}

// A cabin, a stack of fuel drums and not much else: all a bush strip gets.
export function buildBushCamp(rw, place) {
  const objects = [], obstacles = [];
  const tmp = new THREE.Vector3();
  const C = PALETTE.bushCamp;
  place(rw.length * 0.55, rw.width / 2 + 40, tmp);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 8),
    new THREE.MeshStandardMaterial({ color: C.cabin, ...FINISH.timber }));
  cabin.position.set(tmp.x, tmp.y + 1.5, tmp.z); cabin.rotation.y = -rw.heading; cabin.castShadow = true;
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(4.3, 4.3, 8.4, 3),
    new THREE.MeshStandardMaterial({ color: C.roof, ...FINISH.timber }));
  roof.rotation.z = Math.PI / 2; roof.rotation.y = Math.PI / 2 - rw.heading;
  roof.position.set(tmp.x, tmp.y + 3 + 2.1, tmp.z); roof.castShadow = true;
  objects.push(cabin, roof);
  obstacles.push({ x: tmp.x, z: tmp.z, r: 5, y: tmp.y + 6, kind: 'structure', name: 'the cabin' });
  const drum = new THREE.MeshStandardMaterial({ color: C.drum, ...FINISH.painted });
  for (let i = 0; i < 4; i++) {
    place(rw.length * 0.55 + 8 + (i % 2) * 1.2, rw.width / 2 + 40 + Math.floor(i / 2) * 1.2, tmp);
    const d = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.9, 10), drum);
    d.position.set(tmp.x, tmp.y + 0.45, tmp.z); d.castShadow = true; objects.push(d);
  }
  return { objects, obstacles };
}

// The windsock. Returns { group, sock }: airport.js turns `sock` into the wind
// and droops it by wind speed every frame, so keep the sock a child that points
// down -Z at rest.
export function buildWindsock(rw, place) {
  const tmp = new THREE.Vector3();
  place(Math.min(350, rw.length * 0.35), rw.width / 2 + 60, tmp);
  const W = PALETTE.windsock;
  const g = new THREE.Group();
  g.position.copy(tmp);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 7, 6),
    new THREE.MeshStandardMaterial({ color: W.pole }));
  pole.position.y = 3.5;
  g.add(pole);
  const sock = new THREE.Group();
  sock.position.y = 7;
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.5, 3.6, 10, 1, true),
    new THREE.MeshStandardMaterial({ color: W.sock, side: THREE.DoubleSide }));
  cone.rotation.x = Math.PI / 2;
  cone.position.z = -1.8;
  const bands = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.4, 1.0, 10, 1, true),
    new THREE.MeshStandardMaterial({ color: W.band, side: THREE.DoubleSide }));
  bands.rotation.x = Math.PI / 2;
  bands.position.z = -2.2;
  sock.add(cone, bands);
  g.add(sock);
  return { group: g, sock };
}

// The little cones down the edge of an unpaved strip.
export function buildMarkers(rw, place) {
  const objects = [];
  const mat = new THREE.MeshStandardMaterial({ color: PALETTE.marker });
  const tmp = new THREE.Vector3();
  const geo = new THREE.ConeGeometry(0.35, 0.9, 6);
  for (let u = 0; u <= rw.length; u += 40) for (const s of [-1, 1]) {
    place(u, s * (rw.width / 2 + 1.5), tmp);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(tmp.x, tmp.y + 0.45, tmp.z);
    objects.push(m);
  }
  return objects;
}

// The housings the PAPI lamps sit in. `positions` are the lamp positions that
// airport.js worked out from the PAPI angles — draw around them, do not move them.
export function buildPapiBoxes(positions) {
  const boxMat = new THREE.MeshStandardMaterial({ color: PALETTE.papiBox });
  return positions.map((pos) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.7), boxMat);
    b.position.copy(pos).add(new THREE.Vector3(0, 0.3, 0));
    return b;
  });
}
