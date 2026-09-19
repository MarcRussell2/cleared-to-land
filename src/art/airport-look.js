// How an aerodrome looks: the pavement, the buildings, and everything standing
// around the runway.
// CTL pass 5b: static architecture and pavement merge by material; props do not
// cast shadows. Details fit existing envelopes; new solids register obstacles.
// Builders retain their public return shapes; only textures survive scene changes.
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
import { runwaySurface, frozenRunwaySurface } from './textures.js';
import { LightSet } from './lights.js';
import { WORLD_QUALITY } from './quality.js';
// The new maps' site props (beach, terminal, shacks: world/airport.js calls it for a runway with `props`).
export { buildSiteProps } from './world-biomes.js';

// Bake static meshes by material and shadow policy; parked LODs stay separate.
function batchStatic(objects) {
  const buckets = new Map(), result = [];
  for (const o of objects) {
    if (!o.isMesh || o.isInstancedMesh) { result.push(o); continue; }
    o.updateMatrix();
    const key = o.material.uuid + '/' + o.castShadow;
    if (!buckets.has(key)) buckets.set(key, { material: o.material, shadow: o.castShadow, geos: [] });
    buckets.get(key).geos.push(o.geometry.clone().applyMatrix4(o.matrix));
  }
  for (const { material, shadow, geos } of buckets.values()) {
    const geo = mergeGeos(geos);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = material.name; mesh.castShadow = shadow; mesh.receiveShadow = true;
    result.push(mesh);
    for (const g of geos) g.dispose();
  }
  return result;
}
function namedMaterial(name, color, finish = FINISH.building) {
  const m = new THREE.MeshStandardMaterial({ color, ...finish });
  m.name = 'aerodrome/' + name;
  return m;
}

// The runway surface itself. The mesh is built by airport.js (its shape has to
// follow the runway's slope exactly); this is what it is painted with.
export function runwayMaterial(rw) {
  const mat = new THREE.MeshStandardMaterial({
    map: rw.surface === 'ice' || rw.surface === 'snow' ? frozenRunwaySurface(rw) : runwaySurface(rw), ...FINISH.runway,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  mat.name = 'aerodrome/runway';
  if (rw.surface === 'ice') mat.roughness = 0.42;   // the new maps' lake ice: a sheen the sun can catch
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
  const mat = namedMaterial('pavement', PALETTE.shoulder, FINISH.shoulder);
  // Metre-space pavement: slab repairs, oil stains and ragged grass at edges.
  // UVs hold physical dimensions, so the apron and narrow turnoffs share scale.
  mat.onBeforeCompile=shader=>{
    shader.uniforms.apLayout = { value: new THREE.Vector2(rw.length, rw.width / 2 + 90) };
    shader.uniforms.apPaint = { value: new THREE.Color(PALETTE.taxiLine) };
    shader.vertexShader='varying vec2 pavementUV;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\npavementUV=uv;');
    shader.fragmentShader='uniform vec2 apLayout; uniform vec3 apPaint; varying vec2 pavementUV;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      vec2 p=pavementUV;
      float stain=sin(p.x*0.17+sin(p.y*0.31))*sin(p.y*0.23+p.x*0.07);
      float slab=sin(floor(p.x/9.0)*1.7+floor(p.y/7.0)*2.3);
      vec2 seam=abs(fract(p/vec2(9.0,7.0))-0.5)*vec2(9.0,7.0);
      float joint=1.0-smoothstep(0.035,0.035+max(fwidth(p.x),fwidth(p.y)),min(seam.x,seam.y));
      diffuseColor.rgb*=1.0+0.14*slab+0.13*stain-0.17*joint;
      float aa=max(0.035,max(fwidth(p.x),fwidth(p.y)));
      float taxi=abs(p.y-apLayout.y);
      float edge=min(abs(taxi-10.3),abs(taxi-10.8));
      float paint=1.0-smoothstep(0.08,0.08+aa,edge);
      paint=max(paint,1.0-smoothstep(0.18,0.18+aa,taxi));
      float turn=min(abs(p.x-40.0),min(abs(p.x-apLayout.x*0.5),abs(p.x-apLayout.x+40.0)));
      paint=max(paint,(1.0-smoothstep(0.16,0.16+aa,turn))*step(p.y,apLayout.y));
      float hold=min(abs(p.y-(apLayout.y-65.0)),abs(p.y-(apLayout.y-64.3)));
      paint=max(paint,(1.0-smoothstep(0.12,0.12+aa,hold))*step(turn,11.0));
      float stand=abs(mod(p.x-apLayout.x*0.38+8.0,16.0)-8.0);
      float apron=step(apLayout.x*0.35,p.x)*step(p.x,apLayout.x*0.62);
      float lead=(1.0-smoothstep(0.13,0.13+aa,stand))*step(apLayout.y+20.0,p.y)*step(p.y,apLayout.y+67.0);
      float stop=(1.0-smoothstep(0.14,0.14+aa,abs(p.y-apLayout.y-60.0)))*step(stand,4.0);
      float parkingBox=min(abs(stand-6.0),abs(p.y-apLayout.y-68.0));
      float boxPaint=(1.0-smoothstep(0.10,0.10+aa,parkingBox))*step(apLayout.y+52.0,p.y)*step(p.y,apLayout.y+68.0)*step(stand,6.0);
      paint=max(paint,apron*max(boxPaint,max(lead,stop)));
      diffuseColor.rgb=mix(diffuseColor.rgb,apPaint,paint*0.82);
    `);
  };
  mat.customProgramCacheKey=()=> 'ctl-pavement-v2';
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
  for(const side of [-1,1]) {
    const inner=side*rw.width/2,outer=side*(rw.width/2+2.5);
    add(0,rw.length,Math.min(inner,outer),Math.max(inner,outer));
  }
  // Flat visual shoulder lips: no change to runway height or ground queries.
  const fringe=new THREE.MeshStandardMaterial({color:0x72715a,...FINISH.shoulder,transparent:true,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true});
  fringe.name = 'aerodrome/shoulder-fringe';
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
  // (the new maps: a runway with `taxiway: false` - Kestrel Island's strip, whose apron is the site's own, on a
  // hillside the parallel taxiway would cut through - keeps only its shoulders)
  if (rw.taxiway === false) return batchStatic(objects);
  for(const edge of [twyOffset-12,twyOffset+12])add(0,rw.length,edge-1.7,edge+1.7,fringe);
  add(0, rw.length, twyOffset - 12, twyOffset + 12);
  for (const u of [40, rw.length * 0.5, rw.length - 40]) add(u - 12, u + 12, rw.width / 2, twyOffset);
  // apron
  add(rw.length * 0.35, rw.length * 0.62, twyOffset + 12, twyOffset + 170);
  add(rw.length * 0.35,rw.length * 0.62,twyOffset+168.5,twyOffset+172,fringe);
  return batchStatic(objects);
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
  const mat = namedMaterial('hangar', B.hangar);
  const mat2 = namedMaterial('t-hangar', B.tHangar);
  const roof = namedMaterial('roof-trim', B.roof);
  const glass = namedMaterial('glazing', B.glass, FINISH.glass);
  const tank = namedMaterial('fuel-equipment', B.fuelTank, FINISH.metal);
  const twy = rw.width / 2 + 90;
  // Local X/Z match the original building boxes, preserving every footprint.
  const box = (u,v,x,y,z,w,h,d,m,cast=true) => {
    place(u,v,tmp);
    const g = new THREE.BoxGeometry(w,h,d);
    g.translate(x,y,z); g.rotateY(-rw.heading); g.translate(tmp.x,tmp.y,tmp.z);
    const mesh = new THREE.Mesh(g,m); mesh.castShadow=cast; objects.push(mesh);
  };
  const solid = (u,v,r,h,name) => {
    place(u,v,tmp); obstacles.push({x:tmp.x,z:tmp.z,r,y:tmp.y+h,kind:'structure',name});
  };
  const cylinder = (u,v,y,rt,rb,h,m,n=12,cast=false) => {
    place(u,v,tmp);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,n),m);
    mesh.position.set(tmp.x,tmp.y+y,tmp.z);mesh.castShadow=cast;objects.push(mesh);
  };
  const hangar = (u,v,w,d,h,m,bays) => {
    solid(u,v,Math.max(w,d)/2,h,'a building');
    box(u,v,0,(h-1.5)/2,0,w,h-1.5,d,m);
    // Shallow pitched roof, bounded by the original height and footprint.
    const shape = new THREE.Shape();
    shape.moveTo(-w/2,0);shape.lineTo(0,1.5);shape.lineTo(w/2,0);shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape,{depth:d,bevelEnabled:false,steps:1});
    g.translate(0,h-1.5,-d/2);g.rotateY(-rw.heading);place(u,v,tmp);g.translate(tmp.x,tmp.y,tmp.z);
    const mesh = new THREE.Mesh(g,roof);mesh.castShadow=true;objects.push(mesh);
    for(let i=0;i<bays;i++) {
      const x=(i+0.5)*w/bays-w/2;
      box(u,v,x,(h-3)/2,-d/2+0.12,w/bays-1.2,h-3,0.2,roof);
      box(u,v,x,h-2.6,-d/2+0.12,w/bays-0.4,0.45,0.22,tank);
      box(u,v,x,h-4,-d/2+0.03,w/bays-2,0.65,0.04,glass);
      for(let j=1;j<4;j++) box(u,v,x-w/bays/2+j*w/bays/4,(h-3)/2,-d/2+0.04,0.06,h-3,0.08,m);
    }
    box(u,v,0,h-0.5,0,w*0.6,0.25,0.7,roof);
  };
  hangar(rw.length*0.40,twy+215,70,50,16,mat,3);
  hangar(rw.length*0.47,twy+215,70,50,16,mat,3);
  for(let i=0;i<5;i++) hangar(rw.length*0.28+i*16,twy+190,14,22,5.5,mat2,1);
  const terminal=rw.length*0.58;
  solid(terminal,twy+200,55,10,'a building');
  box(terminal,twy+200,0,5,2,110,10,26,mat);
  box(terminal,twy+200,0,3.7,-11.1,104,5.8,0.2,glass);
  box(terminal,twy+200,0,7,-13,110,0.5,4,roof);
  for(let x=-50;x<=50;x+=10) box(terminal,twy+200,x,3.3,-14,0.25,6.6,0.25,tank);
  solid(terminal,twy+220,30,14,'a building');
  box(terminal,twy+220,0,7,0,60,14,12,mat2);
  box(terminal,twy+220,0,11,-5.95,58,2,0.2,glass);
  for(let i=0;i<3;i++) {
    const u=rw.length*0.66+i*9,v=twy+200;
    cylinder(u,v,3.5,3.2,3.2,7,tank);
    solid(u,v,4.3,7,'a fuel tank and bund');
    for(const side of [-1,1]) {
      box(u,v,side*3.8,0.4,0,0.3,0.8,8,roof,false);
      box(u,v,0,0.4,side*3.8,8,0.8,0.3,roof,false);
    }
    box(u,v,2.5,1.2,0,0.18,2.4,0.18,tank,false);
  }
  const tu=rw.length*0.53,tv=twy+250;
  cylinder(tu,tv,15,2.2,2.8,30,mat,10,true);
  cylinder(tu,tv,31.8,5.3,4.5,3.6,glass,8,true);
  cylinder(tu,tv,33.8,5.7,5.5,0.4,roof,8,true);
  cylinder(tu,tv,29.9,5.8,5.8,0.35,roof,8,true);
  for(let i=0;i<8;i++) {
    const a=i*Math.PI/4,x=Math.sin(a)*5.2,z=Math.cos(a)*5.2;
    box(tu,tv,x,31.8,z,0.16,3.6,0.16,roof);
    box(tu,tv,x*1.08,30.55,z*1.08,0.10,1.0,0.10,tank);
  }
  // Octagonal railing uses an open cylinder, no transparent double pass.
  place(tu,tv,tmp);
  const railGeo=new THREE.CylinderGeometry(5.65,5.65,0.10,8,1,true);
  railGeo.translate(tmp.x,tmp.y+31,tmp.z);
  objects.push(new THREE.Mesh(railGeo,tank));
  cylinder(tu,tv,34.85,0.07,0.09,1.7,roof);
  cylinder(tu,tv,35.8,0.22,0.22,0.4,tank);
  solid(tu,tv,6,36,'the control tower');
  place(tu,tv,tmp);
  const towerPos=tmp.clone().add(new THREE.Vector3(0,34,0));
  // Equipment and lamps stay off the movement areas. New solids have records.
  const lamps=new LightSet(4,6,0.8);
  lamps.mat.name='aerodrome/apron-lamps';lamps.points.name='aerodrome/apron-lamps';
  const vehicleCount=WORLD_QUALITY.detail==='low'?0:3;
  const vehicles=new THREE.InstancedMesh(new THREE.BoxGeometry(2,1.1,3.8),tank,vehicleCount);
  const cabs=new THREE.InstancedMesh(new THREE.BoxGeometry(1.8,0.7,1.5),glass,vehicleCount);
  vehicles.name='aerodrome/service-vehicles';cabs.name='aerodrome/service-cabs';
  const vehicleMatrix=new THREE.Matrix4(),vehicleRotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-rw.heading);
  const unitScale=new THREE.Vector3(1,1,1),cabOffset=new THREE.Vector3(0,0,0.8).applyQuaternion(vehicleRotation);
  for(let i=0;i<3;i++) {
    const u=rw.length*(0.37+i*0.11),v=twy+165;
    cylinder(u,v,4.5,0.09,0.15,9,roof,6);
    box(u,v,0,8.8,0,2.2,0.25,0.6,tank,false);
    solid(u,v,1.2,9,'an apron lamp');
    place(u,v,tmp);lamps.add(tmp.x,tmp.y+9,tmp.z,1,0.85,0.6);
    if(WORLD_QUALITY.detail!=='low') {
      place(u+8,v-5,tmp);tmp.y+=0.55;
      vehicleMatrix.compose(tmp,vehicleRotation,unitScale);vehicles.setMatrixAt(i,vehicleMatrix);
      tmp.add(cabOffset);tmp.y+=0.8;
      vehicleMatrix.compose(tmp,vehicleRotation,unitScale);cabs.setMatrixAt(i,vehicleMatrix);
      for(const side of [-1,1])for(const z of [-1.2,1.2])box(u+8,v-5,side*0.88,0.3,z,0.3,0.6,0.65,roof,false);
      solid(u+8,v-5,2.2,1.7,'a service vehicle');
    }
  }
  if(vehicleCount) {
    vehicles.computeBoundingSphere();cabs.computeBoundingSphere();objects.push(vehicles,cabs);
  }
  // Static beacon point: animation needs a simulation-time input from the engine.
  place(tu,tv,tmp);lamps.add(tmp.x,tmp.y+36,tmp.z,0.15,1,0.3);lamps.finish();
  objects.push(lamps.points);
  // The sky injects atDay into fogged materials; use it, never redeclare it.
  const lightCompile=lamps.mat.onBeforeCompile;
  lamps.mat.onBeforeCompile=shader=>{
    lightCompile(shader);
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',
      'diffuseColor.a *= 1.0 - smoothstep(0.05,0.55,atDay);\n#include <opaque_fragment>');
  };
  lamps.mat.customProgramCacheKey=()=> 'ctl-apron-lamps-v1';
  // Fence posts are instanced; mesh is alpha tested procedural chain-link.
  const fu0=rw.length*0.26,fu1=rw.length*0.68,fv=twy+275;
  const count=Math.ceil((fu1-fu0)/4)+1;
  const posts=new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045,0.045,2,5),roof,count);
  posts.name='aerodrome/fence-posts';
  const matrix=new THREE.Matrix4();
  for(let i=0;i<count;i++) {
    const u=fu0+(fu1-fu0)*i/(count-1);place(u,fv,tmp);
    matrix.makeTranslation(tmp.x,tmp.y+1,tmp.z);posts.setMatrixAt(i,matrix);
    solid(u,fv,0.08,2,'a fence post');
  }
  posts.computeBoundingSphere();objects.push(posts);
  const fence=namedMaterial('fence',B.roof);
  fence.side=THREE.DoubleSide;fence.alphaTest=0.5;
  fence.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec2 apFence;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\napFence=uv;');
    shader.fragmentShader='varying vec2 apFence;\n'+shader.fragmentShader.replace('#include <alphatest_fragment>',
      'vec2 apWire=abs(fract(vec2(apFence.x+apFence.y,apFence.x-apFence.y)*8.0)-0.5);\nif(min(apWire.x,apWire.y)>0.045) discard;\n#include <alphatest_fragment>');
  };
  fence.customProgramCacheKey=()=> 'ctl-fence-v1';
  const fg=new THREE.PlaneGeometry(fu1-fu0,2),fp=fg.attributes.position;
  for(let i=0;i<fp.count;i++) {
    const u=fp.getX(i)+(fu0+fu1)/2,y=fp.getY(i)+1;
    fg.attributes.uv.setXY(i,u-fu0,y);place(u,fv,tmp);fp.setXYZ(i,tmp.x,tmp.y+y,tmp.z);
  }
  fg.computeVertexNormals();objects.push(new THREE.Mesh(fg,fence));
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
  return { objects: batchStatic(objects), obstacles, towerPos };
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

// Bush camp: a log cabin and porch inside the original 5 m / 6 m envelope,
// fuel cache, cold fire ring, tent and (on gravel) a beached boat.
export function buildBushCamp(rw, place) {
  const objects=[],obstacles=[],tmp=new THREE.Vector3(),C=PALETTE.bushCamp;
  const timber=namedMaterial('cabin-timber',C.cabin,FINISH.timber);
  const roof=namedMaterial('camp-roof',C.roof,FINISH.timber);
  const drum=namedMaterial('camp-fuel',C.drum,FINISH.painted);
  const glass=namedMaterial('camp-window',PALETTE.buildings.glass,FINISH.glass);
  const u=rw.length*0.55,v=rw.width/2+40;
  const add=(geo,m,du,dv,y,cast=false)=>{
    place(u+du,v+dv,tmp);geo.rotateY(-rw.heading);
    geo.translate(tmp.x,tmp.y+y,tmp.z);
    const mesh=new THREE.Mesh(geo,m);mesh.castShadow=cast;objects.push(mesh);
  };
  const box=(x,y,z,w,h,d,m,cast=true)=>{
    const geo=new THREE.BoxGeometry(w,h,d);geo.translate(x,y,z);add(geo,m,0,0,0,cast);
  };
  const solid=(du,dv,r,h,name)=>{
    place(u+du,v+dv,tmp);obstacles.push({x:tmp.x,z:tmp.z,r,y:tmp.y+h,kind:'structure',name});
  };
  solid(0,0,5,6,'the cabin');
  box(0,1.5,0.8,6,3,5.6,timber);
  // Log courses modelled into the wall, all within the cabin footprint.
  for(let y=0.2;y<3;y+=0.32) for(const side of [-1,1]) {
    box(side*2.9,y,0.8,0.2,0.22,5.6,timber);
    box(0,y,side<0?-1.96:3.56,5.8,0.22,0.1,timber);
  }
  const shape=new THREE.Shape();shape.moveTo(-3,0);shape.lineTo(0,1.8);shape.lineTo(3,0);shape.closePath();
  const rg=new THREE.ExtrudeGeometry(shape,{depth:7.8,steps:1,bevelEnabled:false});
  rg.translate(0,3,-4);add(rg,roof,0,0,0,true);
  box(0,0.18,-3,6,0.36,2,timber);
  for(const x of [-2.7,2.7])box(x,1.5,-3.7,0.16,3,0.16,timber);
  box(-0.8,1.7,-2.04,1.3,1.1,0.04,glass);
  box(1.3,1.1,-2.06,1.1,2.2,0.08,roof);
  box(-0.8,1.7,-2.08,0.08,1.1,0.04,timber);
  box(-0.8,1.7,-2.08,1.3,0.08,0.04,timber);
  const pipe=new THREE.CylinderGeometry(0.12,0.12,2.6,8);pipe.translate(1.5,4.7,1);
  add(pipe,roof,0,0,0,true);
  for(let i=0;i<4;i++) {
    const du=8+(i%2)*1.2,dv=Math.floor(i/2)*1.2;
    add(new THREE.CylinderGeometry(0.4,0.4,0.9,10),drum,du,dv,0.45);
    add(new THREE.CylinderGeometry(0.415,0.415,0.09,10),roof,du,dv,0.72);
    solid(du,dv,0.42,0.9,'a fuel drum');
  }
  for(let i=0;i<10;i++) {
    const a=i*Math.PI/5;
    add(new THREE.DodecahedronGeometry(0.22),roof,-7+Math.cos(a)*0.8,Math.sin(a)*0.8,0.15);
  }
  solid(-7,0,1,0.4,'a fire ring');
  const tentShape=new THREE.Shape();tentShape.moveTo(-1.3,0);tentShape.lineTo(0,1.7);tentShape.lineTo(1.3,0);tentShape.closePath();
  const tent=new THREE.ExtrudeGeometry(tentShape,{depth:3,steps:1,bevelEnabled:false});tent.translate(0,0,-1.5);
  add(tent,timber,-8,6,0);solid(-8,6,2,1.7,'a tent');
  if(rw.surface==='gravel') {
    // Open gunwales, pointed bow and recessed dark interior.
    const hull=new THREE.CylinderGeometry(1,0.7,0.55,6,1,true);hull.scale(0.8,1,2.6);
    add(hull,drum,10,-12,0.3);
    const floor=new THREE.CylinderGeometry(0.72,0.72,0.08,6);floor.scale(0.8,1,2.6);
    add(floor,roof,10,-12,0.10);solid(10,-12,2.6,0.6,'a beached boat');
  }
  return {objects:batchStatic(objects),obstacles};
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
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 7, 6, 8),
    namedMaterial('windsock-pole', W.pole));
  const poleP=pole.geometry.attributes.position;
  for(let i=0;i<poleP.count;i++) {
    const y=poleP.getY(i)+3.5;
    poleP.setX(i,poleP.getX(i)+0.18*Math.sin(y/7*Math.PI));
  }
  pole.geometry.computeVertexNormals();
  pole.position.y = 3.5;
  g.add(pole);
  const sock = new THREE.Group();
  sock.position.y = 7;
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.5, 3.6, 10, 1, true),
    namedMaterial('windsock-fabric', W.sock, {side:THREE.DoubleSide}));
  cone.rotation.x = Math.PI / 2;
  cone.position.z = -1.8;
  const bands = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.4, 1.0, 10, 1, true),
    namedMaterial('windsock-band', W.band, {side:THREE.DoubleSide}));
  bands.rotation.x = Math.PI / 2;
  bands.position.z = -2.2;
  sock.add(cone, bands);
  g.add(sock);
  return { group: g, sock };
}

// The little cones down the edge of an unpaved strip.
export function buildMarkers(rw, place) {
  const mat=namedMaterial('marker-orange',PALETTE.windsock.sock,FINISH.paint);
  const band=namedMaterial('marker-reflector',PALETTE.marker,FINISH.paint);
  const count=(Math.floor(rw.length/40)+1)*2;
  const cones=new THREE.InstancedMesh(new THREE.ConeGeometry(0.35,0.9,8),mat,count);
  const bands=new THREE.InstancedMesh(new THREE.CylinderGeometry(0.105,0.175,0.18,8),band,count);
  const tmp=new THREE.Vector3(),matrix=new THREE.Matrix4();let i=0;
  for(let u=0;u<=rw.length;u+=40)for(const side of [-1,1]) {
    place(u,side*(rw.width/2+1.5),tmp);
    matrix.makeTranslation(tmp.x,tmp.y+0.45,tmp.z);cones.setMatrixAt(i,matrix);
    matrix.makeTranslation(tmp.x,tmp.y+0.54,tmp.z);bands.setMatrixAt(i++,matrix);
  }
  cones.computeBoundingSphere();bands.computeBoundingSphere();
  return [cones,bands];
}

// The housings the PAPI lamps sit in. `positions` are the lamp positions that
// airport.js worked out from the PAPI angles — draw around them, do not move them.
export function buildPapiBoxes(positions) {
  const boxMat = namedMaterial('papi-housing', PALETTE.papiBox);
  return batchStatic(positions.map((pos) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.7), boxMat);
    b.position.copy(pos).add(new THREE.Vector3(0, 0.3, 0));
    return b;
  }));
}
