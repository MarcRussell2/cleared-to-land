// The ground itself: the terrain mesh and its colouring.
//
// src/world/terrain.js owns what the terrain IS - the heightfield, the ground query
// the physics calls every frame, the flattened areas around runways, the obstacle
// list. This file owns what the ground LOOKS like: how the heightfield is sampled
// into a mesh, its vertex colours, the ground material and its textures. Nothing in
// here may change a height, a surface type, a friction coefficient or an obstacle.
//
// Exports (read through terrain-look.js by the world; keep the names and shapes):
//   groundColor(field, h, slope, x, z, out)  -> out (THREE.Color), the vertex colour
//   buildGround(field, opts = {})            -> an Object3D holding the whole ground
//                                               (a Mesh, or a Group of chunked LOD
//                                               meshes); receiveShadow on
//   parcel(x, z)                             -> { edge, angle } of the farm parcel
//                                               grid, shared with the hedge placement
//
// Everything is handed a `field`, the live Terrain (src/world/terrain.js), and must
// treat it as read-only. What it offers:
//
//   size, res            the mesh's extent in metres and its grid resolution
//   seed                 deterministic seed; derive your own from it, never Math.random()
//   style                'plains' | 'coast' | 'mountain' | 'sea', and the new maps'
//                        'island' | 'desert' | 'arctic' (coloured by biomeColor below)
//   elevation            the site's field elevation in metres
//   waterLevel           sea/river level in metres, or null for no water
//   snowLine             metres AMSL where snow starts
//   treeDensity          0..1 from the site
//   treeArea             half-extent in metres over which trees are scattered
//   height(x, z)         ground height in metres
//   normal(x, z, out)    ground normal
//   riverAxis(z)         x of the river centreline (mountain valleys)
//   fieldNoise(x, z)     -1..1, the farm-field pattern
//   forestNoise(x, z)    -1..1, where woodland wants to be
//   nearFlat(x, z, m)    true inside a runway's flattened area - keep clutter out
//   island / desert / arctic   that style's parameters (null otherwise), and for the
//                        arctic lakeShore(x, z): metres outside the frozen lake (< 0 on it)
//
// The quality tier comes from ./quality.js (WORLD_QUALITY.detail: 'low' | 'medium' |
// 'high'); the engine sets it before the world is built. Honour it.
//
// The heightfield is analytic (field.height is a function, not a grid), so the mesh
// may sample it at any resolution: dense near the aerodrome, coarse far away.
// Polish 2b: exact 20 m samples are built once on first renderer LOD selection;
// indices are shared within this build only. Far shading keeps the site tint and
// broad detail, with parcel albedo baked at vertices. Near detail/relief execute
// only inside their original 400 m fade. All levels still receive shadows.
// Skirts are 2.5 m, single-sided; adjacent rims face opposite ways and only one
// LOD is visible, so a level boundary does not blend or double-draw its skirts.
import * as THREE from 'three';
import { smoothstep, lerp, makeRng, noise2 } from '../config.js';
import { PALETTE, FINISH, BIOMES } from './palette.js';
import { groundDetail } from './textures.js';
import { WORLD_QUALITY } from './quality.js';
import { islandStand, arcticWood } from './world-biomes.js';   // the new maps' woodland masks (trees and ground share them)

// Staggered parcels, shared by the ground shader and the hedge placement.
// Rotation avoids alignment with the terrain's fixed triangulation.
export function parcel(x, z) {
  const v = (z * 0.96 - x * 0.28) / 310;
  const u = (x * 0.96 + z * 0.28) / 420 + Math.floor(v) * 0.37;
  const fu = u - Math.floor(u), fv = v - Math.floor(v);
  const du=Math.min(fu,1-fu)*420,dv=Math.min(fv,1-fv)*310;
  return { edge: Math.min(du,dv), angle: du<dv ? Math.PI/2-Math.atan2(0.28,0.96) : -Math.atan2(0.28,0.96) };
}

// Layered linear albedos. Slope is 1 - normal.y, as in the original contract.
export function groundColor(field, h, slope, x, z, out) {
  if(BIOMES[field.style]) return biomeColor(field, h, slope, x, z, out);
  const P=PALETTE.ground, n=noise2(x/180,z/180,field.seed+33);
  const broad=noise2(x/850,z/850,field.seed+44), rel=h-field.elevation;
  const mix=(c,t)=>{out.r=lerp(out.r,c[0],t);out.g=lerp(out.g,c[1],t);out.b=lerp(out.b,c[2],t);};
  out.setRGB(...P.grass);
  out.r+=P.grassNoise[0]*n;out.g+=P.grassNoise[1]*n;out.b+=P.grassNoise[2]*n;
  const forest=field.forestNoise(x,z);
  mix(P.damp,(1-smoothstep(-8,5,rel))*0.45);
  if(field.style==='mountain') {
    mix(P.alpineLow,smoothstep(180,650,rel));
    mix(P.alpineHigh,smoothstep(field.snowLine-420,field.snowLine-100,h)*0.65);
    // Depositional fans on moderate slopes, then exposed faces; no farm noise.
    mix(P.scree,smoothstep(0.025,0.12,slope)*(1-smoothstep(0.16,0.30,slope))
      *smoothstep(80,360,rel)*(0.55+0.35*broad));
    mix(P.rock,smoothstep(0.09,0.38,slope));
    mix(P.forestFloor,smoothstep(0.22,0.45,forest)*(1-smoothstep(field.snowLine-350,field.snowLine-230,h)));
    const snowHeight=field.snowLine+85*broad+35*n;
    const pockets=(1-smoothstep(0.02,0.13,slope))*60;
    mix(P.snow,smoothstep(snowHeight-65-pockets,snowHeight+90,h)*(1-smoothstep(0.18,0.48,slope)));
    if(field.waterLevel!=null) {
      const bank=1-smoothstep(28,90+15*n,Math.abs(x-field.riverAxis(z)));
      mix(P.gravel,bank*(1-smoothstep(field.waterLevel+5,field.waterLevel+22,h)));
    }
  } else {
    mix(P.pasture,smoothstep(0.005,0.06,slope)*0.55);
    mix(P.ploughed,smoothstep(0.12,0.35,slope));
    mix(P.forestFloor,smoothstep(0.22,0.43,forest));
  }
  if(field.waterLevel!=null) {
    const d=h-field.waterLevel;
    if(field.style==='coast') mix(P.pasture,(1-smoothstep(4,12,d))*smoothstep(2,5,d));
    mix(P.sand,1-smoothstep(1.5,field.style==='coast'?5:2.8,d));
    mix(P.wetSand,1-smoothstep(0,1.5,d));
    mix(P.submerged,1-smoothstep(-4,0,d));
  }
  return out;
}

// The new maps (2026-09-17): a tropical island, red desert and canyon, snow round a
// frozen lake. Same layering as above, their own colours (BIOMES in palette.js); no
// farm parcels on any of them.
function biomeColor(field, h, slope, x, z, out) {
  const n=noise2(x/180,z/180,field.seed+33), broad=noise2(x/850,z/850,field.seed+44);
  const mix=(c,t)=>{out.r=lerp(out.r,c[0],t);out.g=lerp(out.g,c[1],t);out.b=lerp(out.b,c[2],t);};
  if(field.style==='island') {
    const B=BIOMES.island, d=h-(field.waterLevel??0);
    const m1=noise2(x/95,z/95,field.seed+45), m2=noise2(x/37,z/37,field.seed+46);
    // A Leeward island: dry olive scrub is the base; greener in the moist lowland and the hollows the broad
    // pattern picks out, burnt tan in patches (more of it up the hills), the dry forest's own shade under its
    // stands (the same mask the trees grow on, world-biomes.js islandStand), red earth where the slopes erode,
    // rock on the steep faces and knolls
    out.setRGB(B.scrub[0]+B.lushNoise[0]*n,B.scrub[1]+B.lushNoise[1]*n,B.scrub[2]+B.lushNoise[2]*n);
    mix(B.lush,(1-smoothstep(5,45,d))*smoothstep(-0.3,0.2,-broad)*0.55);
    mix(B.dryGrass,smoothstep(0.0,0.55,m1+0.35*broad)*smoothstep(4,30,d)*(0.45+0.3*smoothstep(30,120,d)));
    mix(B.woodFloor,islandStand(field,x,z)*smoothstep(3,10,d)*0.85);
    mix(B.soil,smoothstep(0.10,0.28,slope)*(0.35+0.35*m2)*smoothstep(4,15,d));
    mix(B.rock,Math.max(smoothstep(0.30,0.55,slope),smoothstep(0.55,0.85,m2)*smoothstep(25,70,d)*0.55));
    // the beach: dry coral sand above the swash, wet below it, the sandy seabed under the shallows
    mix(B.sand,1-smoothstep(2.4+0.5*n,3.5+0.5*n,d));
    mix(B.wetSand,(1-smoothstep(0.15,0.6,d))*smoothstep(-0.8,0,d));
    mix(B.seabed,1-smoothstep(-0.8,-0.2,d));
  } else if(field.style==='desert') {
    const B=BIOMES.desert, D=field.desert||{}, rel=h-(field.elevation+(D.floor??-150));
    out.setRGB(B.sand[0]+B.sandNoise[0]*n,B.sand[1]+B.sandNoise[1]*n,B.sand[2]+B.sandNoise[2]*n);
    const flat=1-smoothstep(0.06,0.18,slope);
    mix(B.dune,smoothstep(0.05,0.5,noise2(x/620,z/620,field.seed+48))*0.55*flat*(1-smoothstep(15,40,rel)));
    mix(B.wash,(1-smoothstep(-28,-8,rel))*flat);
    mix(B.scrub,smoothstep(0.35,0.85,noise2(x/40,z/40,field.seed+49))*0.35*flat*(1-smoothstep(25,45,rel)));
    // layered sandstone on the faces: paler and redder bands by height, varnish under the caprock
    const band=0.5+0.5*Math.sin(h/7.5+1.8*noise2(x/260,z/260,field.seed+50));
    const rock=[lerp(B.rock[0],B.rockLight[0],band*band),lerp(B.rock[1],B.rockLight[1],band*band),lerp(B.rock[2],B.rockLight[2],band*band)];
    mix(B.talus,smoothstep(0.10,0.22,slope)*(1-smoothstep(0.3,0.5,slope)));
    mix(rock,smoothstep(0.24,0.5,slope));
    // (a streak of it, not a smear of soot: at most a quarter, and the colour itself a dark red-brown)
    mix(B.varnish,smoothstep(0.45,0.8,slope)*smoothstep(0.1,0.6,noise2(x/90,z/90,field.seed+51))*0.25);
    mix(B.caprock,smoothstep(40,90,rel)*flat*(0.75+0.25*broad));
  } else {
    const B=BIOMES.arctic, shore=field.lakeShore?field.lakeShore(x,z):1e3;
    out.setRGB(B.snow[0]+0.02*n,B.snow[1]+0.02*n,B.snow[2]+0.015*n);
    mix(B.drift,smoothstep(-0.1,0.6,noise2(x/140,z/140,field.seed+52))*0.55);
    // the lake: snow-covered ice, wind-cleared in streaks along the wind, darker where it is clear and thick
    const lake=1-smoothstep(-25,0,shore);
    if(lake>0) {
      const scour=smoothstep(-0.05,0.4,noise2(x/260+z/900,z/180,field.seed+53));
      mix(B.ice,lake*scour*0.8);
      mix(B.iceDark,lake*scour*smoothstep(0.25,0.65,noise2(x/90,z/90,field.seed+54))*0.55);
    }
    // the spruce woods' floor (the same mask the trees grow on, world-biomes.js arcticWood), up to the treeline
    mix(B.underTrees,arcticWood(field,x,z,shore)*smoothstep(10,40,shore)*(1-smoothstep(150,260,h-field.elevation))*0.8);
    mix(B.scree,smoothstep(0.22,0.4,slope)*0.6);
    mix(B.rock,smoothstep(0.34,0.62,slope));
  }
  return out;
}

// 16 central tiles + 8 outer tiles: <=24 draws even without frustum culling.
// Central near grids are <=20 m on ALL tiers to honour runway flats. Only tiles
// intersecting the 4 km flight region get near grids. Renderer-owned LOD switches
// at 3 / 2.2 / 1.5 km (high / medium / low); one-time lazy build in LOD.update.
// High/medium mid grids: 80/100 m, far: 240/300 m. Low uses two levels,
// 20/160 m centrally. Outer tiles use only the far grid. Skirts share one draw.
export function buildGround(field, opts = {}) {
  const group=new THREE.Group();group.name='world/ground';
  if(field.style==='sea') return group;
  const tier=opts.detail || WORLD_QUALITY.detail;
  const high=tier==='high', low=tier==='low';
  const mid=high?80:low?160:100, far=high?240:low?480:300;
  const nearDistance=high?3000:low?1500:2200;
  const P=PALETTE.ground, detail=groundDetail(field.seed);
  const data=new Uint8Array(64*64*4), rng=makeRng(field.seed+601);
  for(let i=0;i<4096;i++) {
    const state=rng(), c=state<0.10?P.ploughed:state<0.25?P.crops[2]:P.crops[[0,1,5,6][Math.floor(rng()*4)]];
    const k=0.94+rng()*0.12;
    data.set([c[0]*k*255,c[1]*k*255,c[2]*k*255,state*255],i*4);
  }
  const parcels=new THREE.DataTexture(data,64,64);
  parcels.wrapS=parcels.wrapT=THREE.RepeatWrapping;
  parcels.magFilter=parcels.minFilter=THREE.NearestFilter;parcels.needsUpdate=true;
  function material(farOnly) {
    const mat=new THREE.MeshStandardMaterial({vertexColors:true,...FINISH.ground,fog:true});
    mat.name=farOnly?'world/ground-far':'world/ground';
    mat.userData.parcelMap=parcels;mat.userData.detailMap=detail;
    if(!farOnly)mat.addEventListener('dispose',()=>{parcels.dispose();detail.dispose();});
    // The new maps' desert and snow draw their near detail at a strength of their own (grass blades
    // on snow and sand read as litter at full strength): a separate program, the others unchanged.
    // The island keeps the full strength: its scrub is what that texture is for (and so it shares
    // the original program).
    const biome=!!BIOMES[field.style]&&field.style!=='island';
    // The desert's cliffs are layered sandstone, and a cliff is one or two rows of a 20 m mesh: its vertex
    // colours cannot carry the layers, so steep facets get their bands here, by height (three warped sines:
    // beds of uneven thickness with thin partings), paler and redder in turn. Desert only; its own program.
    // How steep comes from the interpolated vertex normal (the grid's finite differences span the drop), not
    // the facet: on a coarse tile a cliff crosses the grid diagonally, its triangles alternate between steep
    // and half-steep, and facet steepness drew that as a comb of V-shaped teeth along every far mesa.
    const strata=field.style==='desert'?`
        float grUp=dot(normalize(vNormal),normalize((viewMatrix*vec4(0.0,1.0,0.0,0.0)).xyz));
        float grSteep=smoothstep(0.35,0.7,1.0-abs(grUp));
        float grBand=clamp(0.5+0.32*sin(grWorld.y*0.45+grWide*6.0)+0.22*sin(grWorld.y*1.3+1.7)+0.14*sin(grWorld.y*3.1+grWide*9.0),0.0,1.0);
        diffuseColor.rgb*=mix(vec3(1.0),mix(vec3(0.83,0.79,0.77),vec3(1.12,1.09,1.04),grBand),grSteep);
      `:'';
    mat.customProgramCacheKey=()=> (farOnly?'ctl-ground-v3-far':'ctl-ground-v3')+(biome?'-biome':'')+(strata?'-strata':'');
    mat.onBeforeCompile=shader=>{
      shader.uniforms.grParcels={value:parcels};shader.uniforms.grDetail={value:detail};
      shader.uniforms.grEarth={value:new THREE.Color(...P.ploughed)};
      shader.uniforms.grTint={value:new THREE.Vector3(...(PALETTE.groundDetail[field.style+'Tint']||PALETTE.groundDetail.tint))};
      shader.vertexShader='attribute float farmland; varying float grFarm; varying vec3 grWorld;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\ngrFarm=farmland; grWorld=(modelMatrix*vec4(position,1.0)).xyz;');
      shader.fragmentShader=`uniform sampler2D grParcels;
        uniform sampler2D grDetail;
        uniform vec3 grEarth;
        uniform vec3 grTint;
        varying float grFarm; varying vec3 grWorld;
        `+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',farOnly?`#include <color_fragment>
        float grWide=texture2D(grDetail,mat2(0.8,-0.6,0.6,0.8)*grWorld.xz/90.0).r;
        diffuseColor.rgb*=grTint*(1.0+(grWide-0.5)*0.18);
        ${strata}
      `:`#include <color_fragment>
        vec2 grXZ=grWorld.xz;
        float grDistance=length(cameraPosition-grWorld);
        float grNear=1.0-smoothstep(100.0,400.0,grDistance);
        vec2 grUV=grXZ/8.0;
        float grFine=0.5;
        if(grNear>0.0) grFine=texture2D(grDetail,grUV).r;
        float grWide=texture2D(grDetail,mat2(0.8,-0.6,0.6,0.8)*grXZ/90.0).r;
        if(grFarm>0.001) {
        float grRow=(grXZ.y*0.96-grXZ.x*0.28)/310.0;
        vec2 grCell=vec2((grXZ.x*0.96+grXZ.y*0.28)/420.0+floor(grRow)*0.37,grRow);
        vec2 grF=fract(grCell),grMetres=min(grF,1.0-grF)*vec2(420.0,310.0);
        float grEdge=min(grMetres.x,grMetres.y);
        float grAA=max(0.35,max(fwidth(grCell.x)*420.0,fwidth(grCell.y)*310.0));
        vec4 grLookup=texture2D(grParcels,(floor(grCell)+0.5)/64.0);
        vec3 grCrop=grLookup.rgb;
        float grWet=dot(grF-0.5,vec2(0.12,-0.18))*(0.5+grLookup.a);
        grCrop*=1.0+grWet+(grWide-0.5)*0.16;
        float grHead=1.0-smoothstep(4.0,4.0+grAA,grEdge);
        float grBorder=1.0-smoothstep(0.8,0.8+grAA,grEdge);
        grCrop=mix(grCrop,grEarth,grHead*0.7);
        grCrop=mix(grCrop,grEarth*0.65,grBorder*0.55);
        float grAcross=grF.x*420.0;
        float grLane=abs(mod(grAcross+grLookup.a*19.0,27.0)-13.5);
        float grTracks=(1.0-smoothstep(0.25,0.25+grAA,abs(grLane-0.9)))
          *step(0.4,grLookup.a)*(1.0-grHead);
        grCrop=mix(grCrop,grEarth,grTracks*0.4);
        float grRows=sin(grAcross*2.4)*(1.0-smoothstep(0.5,2.0,fwidth(grAcross)*2.4));
        grCrop*=1.0+grRows*mix(0.015,0.045,grLookup.a);
        diffuseColor.rgb=mix(diffuseColor.rgb,grCrop,clamp(grFarm,0.0,1.0));
        }
        diffuseColor.rgb*=grTint*(1.0+(grWide-0.5)*0.18+(grFine-0.5)*0.65*grNear);
        ${strata}
      `).replace('(grFine-0.5)*0.65*grNear',biome?'(grFine-0.5)*0.32*grNear':'(grFine-0.5)*0.65*grNear')
        .replace('#include <normal_fragment_maps>',farOnly?'#include <normal_fragment_maps>':`#include <normal_fragment_maps>
        // Perturb the lighting normal, so real sun direction drives the relief.
        if(grNear>0.0) {
        vec2 grGradient=vec2(texture2D(grDetail,grUV+vec2(0.0009765625,0)).r-grFine,
          texture2D(grDetail,grUV+vec2(0,0.0009765625)).r-grFine);
        normal=normalize(normal+mat3(viewMatrix)*vec3(-grGradient.x,0.0,-grGradient.y)*grNear*0.65);
        }
      `);

    };
    return mat;
  }
  const mat=material(false), farMat=material(true);
  const indexCache=new Map();
  // Refine boundary edges to <=20 m even on coarse tiles: thin skirts cannot
  // conceal a mountain's 300 m chord. Interior vertices keep the original grid.
  // Cache topology (including the skirt indices) within this scene's build.
  function topology(nx,nz,w,d) {
    const key=[nx,nz,w,d].join(',');
    if(indexCache.has(key))return indexCache.get(key);
    const stride=nx+1,count=stride*(nz+1),points=[],edge=[],splits=new Map(),indices=[];
    const point=v=>v<count?[v%stride*w/nx,Math.floor(v/stride)*d/nz]:points[v-count];
    const append=(x,z)=>{points.push([x,z]);return count+points.length-1;};
    const rim=[];
    for(let i=0;i<nx;i++)rim.push(i);
    for(let j=0;j<nz;j++)rim.push(j*stride+nx);
    for(let i=nx;i>0;i--)rim.push(nz*stride+i);
    for(let j=nz;j>0;j--)rim.push(j*stride);
    for(let i=0;i<rim.length;i++) {
      const a=rim[i],b=rim[(i+1)%rim.length],pa=point(a),pb=point(b);
      const n=Math.ceil(Math.hypot(pb[0]-pa[0],pb[1]-pa[1])/20),chain=[a];
      for(let j=1;j<n;j++)chain.push(append(lerp(pa[0],pb[0],j/n),lerp(pa[1],pb[1],j/n)));
      edge.push(...chain);chain.push(b);
      splits.set(a+','+b,chain);splits.set(b+','+a,chain.slice().reverse());
    }
    function triangle(a,b,c) {
      const polygon=[];
      for(const [u,v] of [[a,b],[b,c],[c,a]]) {
        const chain=splits.get(u+','+v);
        if(chain)polygon.push(...chain.slice(0,-1));else polygon.push(u);
      }
      if(polygon.length===3){indices.push(a,b,c);return;}
      const pa=point(a),pb=point(b),pc=point(c);
      const centre=append((pa[0]+pb[0]+pc[0])/3,(pa[1]+pb[1]+pc[1])/3);
      for(let i=0;i<polygon.length;i++)indices.push(polygon[i],polygon[(i+1)%polygon.length],centre);
    }
    for(let j=0;j<nz;j++)for(let i=0;i<nx;i++) {
      const a=j*stride+i,b=a+1,c=a+stride,e=c+1;
      triangle(a,c,b);triangle(b,c,e);
    }
    const surface=count+points.length;
    for(let i=0;i<edge.length;i++) {
      const a=edge[i],b=edge[(i+1)%edge.length],v=surface+i,next=surface+(i+1)%edge.length;
      indices.push(a,b,v,b,next,v);
    }
    const result={points,edge,surface,index:new THREE.BufferAttribute(new Uint32Array(indices),1)};
    indexCache.set(key,result);return result;
  }
  const colour=new THREE.Color();
  function tile(x0,z0,w,d,spacing,farOnly=false) {
    const nx=Math.ceil(w/spacing), nz=Math.ceil(d/spacing), stride=nx+1;
    const count=stride*(nz+1), layout=topology(nx,nz,w,d);
    const {points,edge,surface,index}=layout, rim=edge.length,total=surface+rim;
    const positions=new Float32Array(total*3), colours=new Float32Array(total*3);
    const normals=new Float32Array(total*3), farms=new Float32Array(total);
    // Ghost ring supplies continuous finite-difference normals without four extra
    // analytic height calls per vertex; colours use these same normals.
    const heights=new Float32Array((nx+3)*(nz+3)), hs=nx+3, dx=w/nx,dz=d/nz;
    for(let j=-1;j<=nz+1;j++) for(let i=-1;i<=nx+1;i++)
      heights[(j+1)*hs+i+1]=field.height(x0+i*dx,z0+j*dz);
    for(let j=0;j<=nz;j++) for(let i=0;i<=nx;i++) {
      const v=j*stride+i,k=v*3,x=x0+i*dx,z=z0+j*dz,q=(j+1)*hs+i+1,h=heights[q];
      const gx=(heights[q+1]-heights[q-1])/(2*dx),gz=(heights[q+hs]-heights[q-hs])/(2*dz);
      const inv=1/Math.hypot(gx,1,gz),slope=1-inv;
      positions.set([i*dx-w/2,h,j*dz-d/2],k);normals.set([-gx*inv,inv,-gz*inv],k);
      groundColor(field,h,slope,x,z,colour);colours.set([colour.r,colour.g,colour.b],k);
      farms[v]=(field.style==='plains'||field.style==='coast')&&!field.nearFlat(x,z,20)
        ?(1-smoothstep(0.025,0.12,slope))*(1-smoothstep(180,420,h-field.elevation))
          *(1-smoothstep(0.12,0.36,field.forestNoise(x,z)))
          *(field.waterLevel==null?1:smoothstep(field.waterLevel+5,field.waterLevel+14,h)):0;
      if(farOnly && farms[v]>0.001) {
        const row=(z*0.96-x*0.28)/310;
        const u=(x*0.96+z*0.28)/420+Math.floor(row)*0.37;
        const cell=((Math.floor(row)%64+64)%64)*64+(Math.floor(u)%64+64)%64;
        const q=cell*4, wet=((u-Math.floor(u)-0.5)*0.12-(row-Math.floor(row)-0.5)*0.18)*(0.5+data[q+3]/255);
        for(let c=0;c<3;c++)colours[k+c]=lerp(colours[k+c],data[q+c]/255*(1+wet),farms[v]);
      }
    }
    for(let i=0;i<points.length;i++) {
      const v=count+i,k=v*3,x=x0+points[i][0],z=z0+points[i][1],h=field.height(x,z);
      const gx=(field.height(x+10,z)-field.height(x-10,z))/20;
      const gz=(field.height(x,z+10)-field.height(x,z-10))/20,inv=1/Math.hypot(gx,1,gz);
      positions.set([points[i][0]-w/2,h,points[i][1]-d/2],k);
      normals.set([-gx*inv,inv,-gz*inv],k);
      // Interpolate the existing grid albedo/mask, preserving the coarse look.
      const u=points[i][0]/dx,t=points[i][1]/dz,ix=Math.min(nx-1,Math.floor(u)),iz=Math.min(nz-1,Math.floor(t));
      const a=iz*stride+ix,b=a+1,c=a+stride,e=c+1,fu=u-ix,fv=t-iz;
      for(let ch=0;ch<3;ch++)colours[k+ch]=lerp(lerp(colours[a*3+ch],colours[b*3+ch],fu),lerp(colours[c*3+ch],colours[e*3+ch],fu),fv);
      farms[v]=lerp(lerp(farms[a],farms[b],fu),lerp(farms[c],farms[e],fu),fv);
    }
    for(let i=0;i<rim;i++) {
      const a=edge[i],v=surface+i;
      positions.set(positions.subarray(a*3,a*3+3),v*3);
      // Thin, opaque FrontSide rims; the neighbour faces the other way.
      positions[v*3+1]-=2.5;
      colours.set(colours.subarray(a*3,a*3+3),v*3);normals.set(normals.subarray(a*3,a*3+3),v*3);farms[v]=farms[a];
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.BufferAttribute(positions,3));
    geo.setAttribute('normal',new THREE.BufferAttribute(normals,3));
    geo.setAttribute('color',new THREE.BufferAttribute(colours,3));
    geo.setAttribute('farmland',new THREE.BufferAttribute(farms,1));geo.setIndex(index);
    geo.computeBoundingSphere();
    const mesh=new THREE.Mesh(geo,farOnly?farMat:mat);mesh.name=mesh.material.name;mesh.receiveShadow=true;mesh.castShadow=false;
    return mesh;
  }
  const half=field.size/2, core=Math.min(4000,half), step=core/2;
  function chunk(x,z,w,d,central) {
    if(w<=0||d<=0)return;
    const lod=new THREE.LOD();lod.name='world/ground/lod';lod.position.set(x+w/2,0,z+d/2);
    const canNear=central&&Math.hypot(Math.max(0,Math.abs(x+w/2)-w/2),Math.max(0,Math.abs(z+d/2)-d/2))<=4000;
    if(canNear) {
      const pending=new THREE.Group();pending.name='world/ground/pending';
      lod.addLevel(pending,0);
      lod.update=function(camera) {
        THREE.LOD.prototype.update.call(this,camera);
        if(this.getCurrentLevel()!==0)return;
        const mesh=tile(x,z,w,d,20);
        this.remove(pending);this.levels[0].object=mesh;this.add(mesh);
        // Renderer already updated the scene's matrices before calling LOD.update.
        mesh.updateMatrixWorld(true);mesh.matrixAutoUpdate=false;
        this.update=THREE.LOD.prototype.update;
      };
    }
    if(central)lod.addLevel(tile(x,z,w,d,mid),canNear?nearDistance:0);
    if(!central||!low||!canNear)lod.addLevel(tile(x,z,w,d,far,true),central?7000:0);
    group.add(lod);
  }
  for(let j=0;j<4;j++)for(let i=0;i<4;i++)chunk(-core+i*step,-core+j*step,step,step,true);
  const cuts=[-half,-core,core,half];
  for(let j=0;j<3;j++)for(let i=0;i<3;i++)if(i!==1||j!==1)
    chunk(cuts[i],cuts[j],cuts[i+1]-cuts[i],cuts[j+1]-cuts[j],false);
  return group;
}
