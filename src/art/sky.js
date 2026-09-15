// Atmosphere, lighting, directional aerial perspective, procedural clouds and the sky
// dome. Radiance is linear and deliberately bounded for the existing ACES exposure.
//
// The shading contract (atmosphere(), its uniforms) is in world-atmosphere.js; the
// animated water is in world-water.js and re-exported here because the world imports
// makeWater from this file.
//
// Contract with the engine (src/main.js):
//   new SkySystem(scene, renderer, { time, visibility, azimuth, elevation, cloudCover, shadowSize, detail })
//   .set(time, visibility)         time of day 6.5..22.5 (decimal hours), visibility in metres (700..40000)
//   .update(aircraftPos, dt)       once per frame; installs the fog on first call
//   .setShadowSize(n)              the quality tier's shadow map size
//   .sunDir, .sunElev, .dayness, .sun, .fogColor   read by the world, the water and the HUD
// `detail` is the quality tier ('low' | 'medium' | 'high'); when the engine does not
// pass it, it is derived from shadowSize (see quality.js). The sky is built first, so
// this is where the tier reaches the rest of the art bench: the constructor calls
// setWorldQuality().
// Pass 1d: shallow ground airlight, seamless mist and preserved moonlit lighting.
// Two seeded cloud sheets use edge-eroded cumulus relief and thin stretched cirrus;
// rotated macro density suppresses tiling, with ragged bases and sunlit relief.
// Fine noise is baked into density/relief, never evaluated in a fragment shader.
// Zero-strength directional lights are hidden in set(); only the sun casts shadows.
// All animation reuses existing objects; no extra draws or per-frame baking.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, DEG, makeRng, noise2 } from '../config.js';
import { PALETTE } from './palette.js';
import { VISIBILITY_EXTINCTION, clearExtinction, atmosphereGLSL, atmosphereUniforms, worldVertex, outputGLSL } from './world-atmosphere.js';
import { setWorldQuality } from './quality.js';
export { makeWater } from './world-water.js';

// A periodic density/relief map, baked once. Opposite texture edges match.
function cloudTexture(seed, coverage, cirrus=false) {
  const S = 256, data = new Uint8Array(S * S * 4);
  const density = new Float32Array(S * S);
  const relief = new Float32Array(S * S);
  const rng=makeRng(seed);
  // Rounded overlapping lobes, with open sky between clusters. Relief is kept
  // separately from opacity so opaque cores still carry curved sunlit form.
  const clusters=6+Math.floor(rng()*5), wind=0.23;
  const cosine=Math.cos(wind),sine=Math.sin(wind);
  for(let cluster=0;cluster<clusters;cluster++) {
    const cx=rng()*S,cy=rng()*S,span=18+rng()*36;
    const count=4+Math.floor(rng()*11);
    for(let puff=0;puff<count;puff++) {
      const rx=7+19*rng()**2,ry=rx*(cirrus?0.16+rng()*0.16:0.8+rng()*0.5);
      const along=(rng()-0.5)*span*2,top=(rng()-0.5)*span*0.9;
      const reach=span+rx*2+ry*2;
      for(let y=Math.floor(cy-reach);y<=cy+reach;y++) for(let x=Math.floor(cx-reach);x<=cx+reach;x++) {
        const dx=x-cx,dy=y-cy;
        const u=dx*cosine+dy*sine,v=-dx*sine+dy*cosine;
        const r2=((u-along)/rx)**2+((v+top)/ry)**2;
        if(r2>1)continue;
        // One condensation boundary per cluster, with a small ragged fringe.
        // The sheet itself supplies the level base in world space.
        const base=cirrus?1:1-smoothstep(span*0.22,span*0.22+2.5,v);
        const shape=(1-smoothstep(0.12,1,r2))*base;
        const i=((y%S+S)%S)*S+(x%S+S)%S;
        density[i]=1-(1-density[i])*(1-shape);
        relief[i]=Math.max(relief[i],Math.sqrt(1-r2)*(0.65+rx/75)*base);
      }
    }
  }
  // Periodic fine detail: blend translated seeded noise at tile boundaries.
  // Two scales break smooth balloon edges; solid cores keep their broad mass.
  const periodic=(x,y,scale)=>{
    const tx=x/S,ty=y/S;
    return lerp(lerp(noise2(x*scale,y*scale,seed),noise2((x-S)*scale,y*scale,seed),tx),
      lerp(noise2(x*scale,(y-S)*scale,seed),noise2((x-S)*scale,(y-S)*scale,seed),tx),ty);
  };
  for(let y=0;y<S;y++) for(let x=0;x<S;x++) {
    const i=y*S+x;
    if(!cirrus && density[i]>0) {
      const edge=smoothstep(0.02,0.18,density[i])*(1-smoothstep(0.60,0.94,density[i]));
      const detail=periodic(x,y,0.38)*0.7+periodic(x,y,0.83)*0.3;
      density[i]=clamp(density[i]+detail*edge*0.65,0,1);
      relief[i]=Math.max(0,relief[i]+detail*edge*0.30);
    }
    density[i]=smoothstep(lerp(0.24,0.025,coverage),lerp(0.8,0.38,coverage),density[i]);
  }
  const sample = (x,y) => density[((y+S)%S)*S+(x+S)%S];
  const height = (x,y) => relief[((y+S)%S)*S+(x+S)%S];
  for (let y=0;y<S;y++) for (let x=0;x<S;x++) {
    const i=(y*S+x)*4;
    data[i]=sample(x,y)*255;
    data[i+1]=clamp(0.5+(height(x+1,y)-height(x-1,y))*2,0,1)*255;
    data[i+2]=clamp(0.5+(height(x,y+1)-height(x,y-1))*2,0,1)*255;
    data[i+3]=clamp(height(x,y),0,1)*255;
  }
  const tex = new THREE.DataTexture(data,S,S);
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  tex.magFilter=THREE.LinearFilter; tex.minFilter=THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps=true; tex.needsUpdate=true;
  return tex;
}

export class SkySystem {
  constructor(scene, renderer, opts = {}) {
    // The tier reaches the whole art bench from here (see quality.js): the sky is built first.
    setWorldQuality({ detail: opts.detail, shadowSize: opts.shadowSize });
    this.scene=scene; this.renderer=renderer; this.azimuth=opts.azimuth;
    this.sunDir=new THREE.Vector3();
    this.uniforms=atmosphereUniforms();
    this.sky=new THREE.Mesh(new THREE.SphereGeometry(28000,32,16),new THREE.ShaderMaterial({
      uniforms:this.uniforms, side:THREE.BackSide, depthWrite:false, depthTest:false,
      vertexShader:worldVertex,
      fragmentShader:`varying vec3 vWorld; ${atmosphereGLSL}
        void main(){ vec3 d=normalize(vWorld-cameraPosition); gl_FragColor=vec4(atmosphere(d)+celestial(d),1.0); ${outputGLSL} }`,
    }));
    this.sky.material.name='sky/dome';
    this.sky.renderOrder=-1000; this.sky.frustumCulled=false; scene.add(this.sky);
    this.sun=new THREE.DirectionalLight(0xffffff,3.4);
    this.sun.castShadow=true;
    const sc=this.sun.shadow.camera;
    sc.near=10; sc.far=1500; sc.left=sc.bottom=-90; sc.right=sc.top=90;
    this.sun.shadow.mapSize.set(opts.shadowSize||4096,opts.shadowSize||4096);
    this.sun.shadow.bias=-0.0004; this.sun.shadow.normalBias=0.4; this.sun.shadow.radius=2;
    this.setShadowSize=(n)=>{
      if(this.sun.shadow.mapSize.x===n)return;
      this.sun.shadow.mapSize.set(n,n);
      if(this.sun.shadow.map){this.sun.shadow.map.dispose();this.sun.shadow.map=null;}
    };
    this.sunTarget=new THREE.Object3D(); this.sun.target=this.sunTarget;
    this.hemi=new THREE.HemisphereLight(PALETTE.atmosphere.fill,PALETTE.atmosphere.groundFill,0.7);
    this.moon=new THREE.DirectionalLight(PALETTE.atmosphere.moon,0);
    this.moon.target=this.sunTarget;
    scene.add(this.sun,this.sunTarget,this.hemi,this.moon);
    this.fog=new THREE.FogExp2(PALETTE.atmosphere.horizon,0.0001);
    scene.fog=this.fog; scene.background=null;
    this.fogColor=new THREE.Color();
    this.stars=makeStars(this.uniforms);scene.add(this.stars);
    this.clouds=[];
    const coverage=opts.cloudCover??0.3, base=opts.elevation||0;
    if(coverage>0.02) for(const s of [{height:1200,scale:9500,seed:31,speed:3.5},{height:3100,scale:12500,seed:47,speed:6}]) {
      const mat=new THREE.ShaderMaterial({
        uniforms:{...this.uniforms, atCloudMap:{value:cloudTexture(s.seed,coverage,s.seed===47)},
          atCloudScale:{value:s.scale}, atDrift:{value:0}, atLayerHeight:{value:base+s.height},
          clCirrus:{value:s.seed===47?1:0},
          },
        transparent:true,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true,
        vertexShader:worldVertex,
        fragmentShader:`varying vec3 vWorld; uniform sampler2D atCloudMap;
          uniform float atCloudScale, atDrift, atLayerHeight, clCirrus; ${atmosphereGLSL}
          void main(){
            vec2 uv=(vWorld.xz+vec2(atDrift,atDrift*0.23))/atCloudScale;
            uv=mix(uv,uv*vec2(0.55,2.2),clCirrus);
            vec4 field=texture2D(atCloudMap,uv);
            // Rotate 40 degrees and change scale: the second field modulates
            // both density and its lighting gradient, not just the colour.
            mat2 rotation=mat2(0.766044,0.642788,-0.642788,0.766044);
            vec3 macro=texture2D(atCloudMap,rotation*uv*0.37+vec2(0.31,0.73)).rgb;
            float modulation=0.65+0.35*macro.r;
            float thickness=field.r*modulation;
            vec2 macroGradient=vec2(0.766044*(macro.g-0.5)+0.642788*(macro.b-0.5),
              -0.642788*(macro.g-0.5)+0.766044*(macro.b-0.5));
            vec2 gradient=(field.gb-0.5)*modulation+field.r*0.35*0.37*macroGradient;
            vec3 n=normalize(vec3(-gradient.x*5.0,0.45,-gradient.y*5.0));
            float above=smoothstep(atLayerHeight-100.0,atLayerHeight+100.0,cameraPosition.y);
            float lit=max(dot(n,atSun),0.0);
            float rim=(1.0-smoothstep(0.15,0.75,field.r))*smoothstep(0.2,0.85,lit);
            vec3 d=normalize(vWorld-cameraPosition);
            // At grazing angles the lobes rise above their shaded base; overhead
            // views from below keep the broad base, while relief lights its edges.
            float baseView=(1.0-above)*smoothstep(0.015,0.12,d.y);
            float form=smoothstep(0.25,0.88,lit)*mix(0.65,1.0,field.a);
            form*=1.0-baseView*smoothstep(0.35,0.85,field.r)*0.88;
            vec3 underside=vec3(0.23,0.25,0.28);
            vec3 top=vec3(0.82,0.80,0.75)*mix(vec3(1.0),atWarm,0.28);
            vec3 colour=mix(underside,top,clamp(form+rim*0.65,0.0,1.0))*atDay;
            colour=mix(colour,vec3(0.72,0.76,0.81)*atDay,clCirrus);
            colour+=atNight*0.28*(1.0-atDay);
            float distanceToCloud=length(vWorld-cameraPosition);
            float haze=1.0-exp(-distanceToCloud*atExtinction);
            colour=mix(colour,atmosphere(d),haze);
            float edge=1.0-smoothstep(22000.0,28000.0,distanceToCloud);
            float opacity=mix(smoothstep(0.04,0.65,thickness)*0.96,thickness*0.20,clCirrus);
            gl_FragColor=vec4(colour,opacity*edge*(1.0-atWeather));
            ${outputGLSL}
          }`,
      });
      mat.name=s.seed===31?'sky/clouds-low':'sky/clouds-high';
      const mesh=new THREE.Mesh(new THREE.PlaneGeometry(60000,60000),mat);
      mesh.rotation.x=-Math.PI/2;mesh.position.y=base+s.height;
      mesh.frustumCulled=false;scene.add(mesh);
      this.clouds.push({mesh,mat,speed:s.speed});
    }
    // Keep the established renderer settings; no composer/bloom changes.
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.set(opts.time??14,opts.visibility??30000);
    this.fogInstalled=false;
  }

  set(time,visibility) {
    this.time=time;this.visibility=Math.max(100,visibility);
    const e=Math.sin((time-6.5)/13*Math.PI)*62*DEG;
    const az=this.azimuth??lerp(80,280,clamp((time-6.5)/13,0,1))*DEG;
    this.sunElev=e;
    this.sunDir.set(Math.sin(az)*Math.cos(e),Math.sin(e),-Math.cos(az)*Math.cos(e));
    this.dayness=smoothstep(-6*DEG,6*DEG,e);
    const low=1-smoothstep(5*DEG,35*DEG,e);
    const weather=1-smoothstep(900,7000,this.visibility);
    const u=this.uniforms;
    u.atSun.value.copy(this.sunDir);u.atDay.value=this.dayness;u.atLow.value=low;u.atWeather.value=weather;
    u.atExtinction.value=clearExtinction(this.visibility);
    u.atLut.value.userData.bake();
    // 0.9*(2.3+0.5)/pi = 0.802 maximum diffuse white, below bloom's 0.92.
    this.sun.intensity=2.3*this.dayness*lerp(1,0.48,low)*lerp(1,0.08,weather);
    this.sun.visible=this.sun.intensity>0.002;
    this.sun.color.copy(u.atWarm.value);
    this.hemi.intensity=lerp(0.075,0.5,this.dayness)*lerp(1,1.15,weather);
    this.hemi.color.copy(u.atZenith.value);
    this.hemi.color.multiplyScalar(1/Math.max(0.001,this.hemi.color.r,this.hemi.color.g,this.hemi.color.b));
    this.hemi.groundColor.set(PALETTE.atmosphere.groundFill);
    this.moon.intensity=(1-this.dayness)*0.23*(1-weather*0.65);
    this.moon.visible=this.moon.intensity>0.002;   // a light at intensity 0 still costs every lit shader (docs/PERF.md section 5)
    this.stars.visible=this.dayness<0.5&&weather<0.9;
    this.fogColor.copy(u.atHorizon.value);
    this.fog.density=VISIBILITY_EXTINCTION/this.visibility;this.fog.color.copy(this.fogColor);
    this.renderer.toneMappingExposure=lerp(3.8,1.24,this.dayness)+low*this.dayness*0.08;

  }

  // Install on this world's fog-enabled materials once, after the world is built.
  // Fog is mixed in linear radiance BEFORE tone mapping in both render paths.
  installFog() {
    const seen=new Set();
    this.scene.traverse(object=>{
      const materials=Array.isArray(object.material)?object.material:[object.material];
      for(const material of materials){
        if(!material||!material.fog||seen.has(material))continue;
        seen.add(material);
        const previous=material.onBeforeCompile;
        const previousKey=material.customProgramCacheKey();
        material.onBeforeCompile=(shader,renderer)=>{
          previous.call(material,shader,renderer);
          Object.assign(shader.uniforms,this.uniforms);
          shader.vertexShader=shader.vertexShader.replace('#include <fog_pars_vertex>', '#include <fog_pars_vertex>\nvarying vec3 atRay;')
            .replace('#include <fog_vertex>', '#include <fog_vertex>\natRay = (vec4(mvPosition.xyz,0.0) * viewMatrix).xyz;');
          const declarations=shader.fragmentShader.includes('vec3 atmosphere(')?'':atmosphereGLSL;
          shader.fragmentShader=shader.fragmentShader.replace('#include <fog_pars_fragment>',`#include <fog_pars_fragment>\nvarying vec3 atRay;\n${declarations}`);
          // Adapted clear air retains 75% contrast at 4 km / 25 km visibility.
          // Dense weather uses this same exponential, with sky-lit LUT radiance.
          const fog=`float atDistance=length(atRay);
            float atAmount=1.0-exp(-atDistance*atExtinction);
            gl_FragColor.rgb=mix(gl_FragColor.rgb,atmosphere(normalize(atRay)),atAmount);`;
          shader.fragmentShader=shader.fragmentShader.replace('#include <fog_fragment>','');
          shader.fragmentShader=shader.fragmentShader.replace('#include <tonemapping_fragment>',fog+'\n#include <tonemapping_fragment>');
        };
        material.customProgramCacheKey=()=> previousKey+'-ctl-atmosphere-v6';
        material.needsUpdate=true;
      }
    });
  }

  update(acPos,dt=1/60) {
    if(!this.fogInstalled){this.installFog();this.fogInstalled=true;}
    this.sunTarget.position.copy(acPos);
    this.sun.position.copy(acPos).addScaledVector(this.sunDir,700);
    this.moon.position.copy(acPos).addScaledVector(this.uniforms.atMoon.value,700);
    this.sky.position.copy(acPos);this.stars.position.copy(acPos);
    for(const c of this.clouds){
      c.mesh.position.x=acPos.x;c.mesh.position.z=acPos.z;
      c.mat.uniforms.atDrift.value+=dt*c.speed;
    }
  }
}

function makeStars(uniforms){
  const n=1400,pos=new Float32Array(n*3),col=new Float32Array(n*3),rng=makeRng(9001);
  for(let i=0;i<n;i++){
    const y=0.04+rng()*0.96,a=rng()*Math.PI*2,r=Math.sqrt(1-y*y);
    pos.set([r*Math.cos(a)*20000,y*20000,r*Math.sin(a)*20000],i*3);
    const b=(0.18+Math.pow(rng(),4)*1.8)*smoothstep(0.04,0.25,y);
    col.set([b,b,b*(0.92+rng()*0.16)],i*3);
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));
  const mat=new THREE.PointsMaterial({size:1.6,sizeAttenuation:false,vertexColors:true,transparent:true,depthWrite:false,fog:false});
  mat.name='sky/stars';
  mat.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 atStarDirection;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\natStarDirection=normalize(position);');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 atStarDirection;\n'+atmosphereGLSL)
      .replace('#include <opaque_fragment>', `
        float atBrightness=dot(atmosphere(normalize(atStarDirection)),vec3(0.2126,0.7152,0.0722));
        diffuseColor.a *= (1.0-smoothstep(0.012,0.065,atBrightness))*(1.0-atWeather);
        diffuseColor.a *= smoothstep(0.08,0.32,atStarDirection.y);
        diffuseColor.a *= 1.0-smoothstep(0.18,0.5,length(gl_PointCoord-0.5));
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey=()=> 'sky-stars-v3';
  const stars=new THREE.Points(geo,mat);stars.frustumCulled=false;return stars;
}
