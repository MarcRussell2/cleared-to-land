// The atmosphere's shading contract: the one GLSL function the whole world uses to
// ask "what colour is the sky in direction d?", and the uniforms that feed it.
//
// It is included in the sky dome, the cloud layers, the water's reflection and - by
// SkySystem.installFog() - in EVERY fog-enabled material in the scene, where it
// supplies the aerial perspective. That is why it lives in its own file: change it
// here and every surface, the sky and the sea move together.
//
// Rules:
//   - every uniform declared here starts with `at` (atSun, atZenith, ...). Because
//     installFog() merges these uniforms into every fogged material, no other
//     module may declare a GLSL uniform with that prefix: a collision fails the
//     shader compile and the object vanishes. tools/test-art.mjs checks this.
//   - atmosphere(d) must stay cheap: it runs per fragment on every surface. Bake
//     what you can into small textures at SkySystem.set() time (a lookup texture is
//     a uniform like any other, `atLut` say) and keep the per-pixel work to a few
//     instructions.
//   - keep the exported names: atmosphereGLSL, atmosphereUniforms(), worldVertex,
//     outputGLSL, VISIBILITY_EXTINCTION. SkySystem and world-water.js read them.
//     clearExtinction(visibility) returns the shared shader extinction in metres.
//
// atmosphere(d)  radiance of the sky in unit direction d (linear, before tone mapping)
// celestial(d)   the sun disc and glare, the moon; added on top of atmosphere() by
//                the dome only
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Pass 1d: bounded daylight, continuous mist and darker shallow ground airlight.
// The ground transition resolves tower rays 0.3–0.6 degrees below the horizon;
// clear extinction, sky above the horizon and night radiance remain unchanged.
// Two 128x64 half-float tables retain night precision without byte banding.
// Daylight stays below 0.85 linear; only celestial() supplies the bright disc.
// Optical columns still determine sunlight transmission; the sky profile is
// art-directed separately so horizon airlight cannot trigger scene-wide bloom.
// Coordinates are sqrt((1-cos(scatter))/2), elevation (-0.25..1); forward
// scattering gets more samples. No noise, integration or powers on fogged pixels.
// Each uniform set owns its textures; userData.bake is called only by set().
// Meteorological visibility: 2% contrast remains at V metres (Koschmieder).
export const VISIBILITY_EXTINCTION = 3.912;
export function clearExtinction(visibility) {
  const v=Math.max(100,visibility);
  const t=Math.min(1,Math.max(0,(v-900)/(7000-900)));
  const weather=1-t*t*(3-2*t); // exactly the atWeather curve
  // Consistency pass: 3.0 (was 2.2) - the tower's 3.5-degree lens over ground 4-8 km
  // away still read milky at 2.2; the sky-budget check keeps the limits.
  return VISIBILITY_EXTINCTION/v*((1-weather)/3.0+weather);
}

export const atmosphereGLSL = `
 uniform vec3 atSun, atZenith, atHorizon, atWarm, atNight, atMoon;
 uniform float atDay, atLow, atWeather, atExtinction, atHaze;
 uniform sampler2D atLut, atLutNight;
 vec3 atmosphere(vec3 d) {
   float y=clamp((d.y+0.25)*0.8,0.0,1.0)*0.984375+0.0078125;
   vec2 uv=vec2(sqrt(clamp(0.5-0.5*dot(d,atSun),0.0,1.0))*0.9921875+0.00390625,y);
   vec2 nm=vec2(sqrt(clamp(0.5-0.5*dot(d,atMoon),0.0,1.0))*0.9921875+0.00390625,y);
   // Smooth shadowed ground airlight; fog and the established night are exempt.
   float ground=1.0-0.45*smoothstep(0.0,0.008,-d.y)*(1.0-atWeather);
   return texture2D(atLut,uv).rgb*ground+texture2D(atLutNight,nm).rgb;
 }
 vec3 celestial(vec3 d) {
   float s=1.0-dot(d,atSun), m=1.0-dot(d,atMoon);
   float disc=1.0-smoothstep(0.0000101,0.0000113,s);
   float lunar=1.0-smoothstep(0.0000095,0.000012,m);
   float corona=atHaze/(atHaze+max(s,0.0));
   vec3 solar=atWarm*(disc*7.0+corona*corona*0.16)*atDay;
   vec3 moon=vec3(0.64,0.72,0.86)*(lunar*0.65+0.000012/(0.0003+max(m,0.0)))*(1.0-atDay);
   return (solar+moon)*(1.0-atWeather);
 }
`;
export function atmosphereUniforms() {
  const c=PALETTE.atmosphere;
  const table=()=>{
    const t=new THREE.DataTexture(new Uint16Array(128*64*4),128,64,THREE.RGBAFormat,THREE.HalfFloatType);
    t.minFilter=t.magFilter=THREE.LinearFilter;
    t.generateMipmaps=false;
    return t;
  };
  const u={
    atSun:{value:new THREE.Vector3(0,1,0)}, atMoon:{value:new THREE.Vector3(-3,4,2).normalize()},
    atZenith:{value:new THREE.Color(c.zenith)}, atHorizon:{value:new THREE.Color(c.horizon)},
    atWarm:{value:new THREE.Color(c.warm)}, atNight:{value:new THREE.Color(c.night)},
    atDay:{value:1}, atLow:{value:0}, atWeather:{value:0},
    atExtinction:{value:clearExtinction(30000)}, atHaze:{value:0.0002},
    atLut:{value:table()}, atLutNight:{value:table()},
  };
  u.atLut.value.userData.bake=()=>{
    const day=u.atDay.value, weather=u.atWeather.value, sy=u.atSun.value.y;
    const aerosol=0.018+Math.min(0.12,u.atExtinction.value*260);
    const sunPath=1/Math.sqrt(Math.max(0,sy)*Math.max(0,sy)+0.0018);
    const beta=[0.055,0.13,0.30]; // wavelength-dependent Rayleigh optical columns
    const direct=beta.map(b=>Math.exp(-(b*0.65+aerosol)*Math.max(0,sunPath-1)));
    u.atWarm.value.setRGB(direct[0],direct[1],direct[2]);
    u.atWarm.value.multiplyScalar(1/Math.max(0.001,direct[0]));
    u.atHaze.value=0.00012+aerosol*0.008;
    const data=u.atLut.value.image.data, night=u.atLutNight.value.image.data;
    const twilight=Math.exp(-Math.pow((Math.asin(sy)*180/Math.PI+4)/6,2))*(1-day);
    const low=u.atLow.value;
    const zenith=[0.055+0.045*low,0.125+0.005*low,0.21-0.045*low];
    const horizonColour=[0.44-0.08*low,0.49-0.16*low,0.54-0.23*low];
    for(let y=0;y<64;y++){
      const elevation=y/63*1.25-0.25;
      const positive=Math.max(0,elevation);
      const up=positive*positive/(positive+0.01); // zero slope into the horizon
      const shoulder=Math.exp(-up/0.18);
      const horizon=Math.exp(-up/0.045);
      // No negative-row step. Ground darkening is smooth in atmosphere(d).
      for(let x=0;x<128;x++){
        const mu=1-2*(x/127)**2;
        const angle=Math.acos(Math.max(-1,Math.min(1,mu)));
        const cone=Math.max(0,1-(angle/(25*Math.PI/180))**2);
        const aureole=cone*cone;
        const i=(y*128+x)*4;
        for(let k=0;k<3;k++){
          const profile=zenith[k]+(horizonColour[k]-zenith[k]-0.055)*shoulder+0.055*horizon;
          // A pale transition above the warm dusk horizon; the overhead stays blue-grey.
          const pale=low*[0.045,0.04,0.035][k]*Math.exp(-(((up-0.19)/0.10)**2));
          const solar=0.30*aureole*(0.35+0.65*direct[k]);
          const clear=day*Math.min(0.84,profile+pale+solar)
            +twilight*[0.035,0.065,0.13][k]*(0.3+up);
          const sunHeight=Math.max(0,sy);
          // Linear through elevation zero: dense mist has no horizon or sun band.
          const mist=day*([0.235,0.26,0.285][k]+0.065*sunHeight+0.045*elevation);
          data[i+k]=THREE.DataUtils.toHalfFloat(Math.max(0,clear*(1-weather)+mist*weather));
          const n=(1-day)*[0.007,0.010,0.016][k]*(0.65+0.65*Math.exp(-Math.abs(elevation)*4)+0.32/(1.15-0.65*mu));
          night[i+k]=THREE.DataUtils.toHalfFloat(n*(1-weather*0.5));
        }
        data[i+3]=night[i+3]=THREE.DataUtils.toHalfFloat(1);
      }
    }
    // Representative radiances also remain available to light/fog consumers.
    const read=(color,x,y)=>{const i=(y*128+x)*4; color.setRGB(...[0,1,2].map(k=>THREE.DataUtils.fromHalfFloat(data[i+k])+THREE.DataUtils.fromHalfFloat(night[i+k])));};
    read(u.atZenith.value,90,63); read(u.atHorizon.value,90,13);
    u.atNight.value.setRGB(0.007,0.010,0.016);
    u.atLut.value.needsUpdate=true;u.atLutNight.value.needsUpdate=true;
  };
  u.atLut.value.userData.bake(); // valid textures even before the world's first update
  return u;
}
export const worldVertex = `
 varying vec3 vWorld;
 void main() {
   vec4 wp = modelMatrix * vec4(position, 1.0);
   vWorld = wp.xyz;
   gl_Position = projectionMatrix * viewMatrix * wp;
 }`;
export const outputGLSL = `
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
`;
