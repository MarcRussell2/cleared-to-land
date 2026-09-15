// The Condor 700: a 737-800 class narrow-body twin-jet. Circular fuselage with a
// pointed radome and upswept tail cone, low swept wing with blended winglets, two
// high-bypass turbofans slung under the wing on pylons (fan faces visible from the
// front, reverser sleeves that slide aft), swept tailplane and fin, retractable
// tricycle gear with twin wheels on every leg. Wingspan 34.3 m, length about 39 m.
//
// THE CONTRACT: the same as skylark.js - read that header first, it is the spec.
//   export function buildAirframe(def, ctx) -> { group, parts, anchors, bounds }
// Body frame: forward -Z, up +Y, right +X, metres, relative to the CG. Build to
// def.span; the wheels sit at def.gear[i].pos with def.gear[i].radius (order:
// nose, left main, right main).
//
// This aircraft's parts: elevator[2] (one per side), aileronL/R, rudder[1], flaps[4]
// (inboard and outboard per wing), spoilers[8] (four per wing, hinged at their front
// edge on the upper surface), reversers[2] (Mesh with userData.z0; position.z slides
// aft up to 0.9 m), legs[3] (RETRACTABLE: each has a pivot Group the engine folds -
// nose leg: axis 'x', angle -95 deg, folds forward; mains: axis 'z', angle +-88 deg,
// fold inboard), lights, landingLight, hideInCockpit.
// Its anchors: exhaust[2] (the jet pipes, one per engine in def.engines order, left
// then right, pointing +Z), eye, navLeft/Right, tail, beacon, landingLight,
// wingtipL/R, pitot. No props, no hook.
// Materials handed in ctx.materials: white, belly, blue, metal, dark, glass, tire.
// Budget at ctx.detail 'high': <= 60k triangles, <= 24 draw calls; no Math.random;
// name every material; no at* shader uniforms. Keep this header.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DEG } from '../../config.js';
import { lathe, rod, navLights, landingLight, measureBounds, shadowAll, anchor } from './common.js';

export function buildAirframe(def, ctx) {
  const { white, blue, belly, metal, dark, glass } = ctx.materials;
  const high = ctx.detail === 'high', low = ctx.detail === 'low';
  const segments = high ? 48 : low ? 16 : 28;
  const g = new THREE.Group(); g.name = 'condor';
  const parts = { flaps: [], elevator: [], rudder: [], spoilers: [], reversers: [], legs: [], hideInCockpit: [] };
  const anchors = {}, skin = [], glazing = [], paint = [], hardware = [];
  // Four static draws split at the cockpit visibility boundary. Vertex colours
  // retain the scheme without material groups (and therefore without extra draws).
  white.vertexColors = true; metal.vertexColors = true;
  const plain = new THREE.Color(1,1,1);
  const tint = (m, base = white) => new THREE.Color(m.color.r/base.color.r,m.color.g/base.color.g,m.color.b/base.color.b);
  const ink = tint(dark), stripe = tint(blue), grey = tint(belly);
  const metalInk = tint(dark,metal), metalGrey = tint(belly,metal);
  // The hidden skin needs painted upper panels and a metallic grey underside in
  // one draw. The vertex tint distinguishes the grey from white, blue and windows.
  const skinMaterial = new THREE.MeshStandardMaterial({color:white.color,vertexColors:true,roughness:.43});
  skinMaterial.name='condor:skin-paint-and-metal-belly';
  skinMaterial.onBeforeCompile=shader=>{
    shader.fragmentShader=shader.fragmentShader.replace('#include <metalnessmap_fragment>',
      '#include <metalnessmap_fragment>\n float condorBelly = step(0.15,vColor.r)*step(vColor.r,0.65)*(1.0-step(0.18,abs(vColor.r-vColor.b)));\n metalnessFactor = mix(metalnessFactor,0.6,condorBelly);');
  };
  skinMaterial.customProgramCacheKey=()=> 'condor-skin-metal-belly-1';
  const V = p => new THREE.Vector3(...p);
  function add(batch, geo, color = plain) {
    const flat = geo.index ? geo.toNonIndexed() : geo;
    for (const key of Object.keys(flat.attributes)) if (!['position','normal'].includes(key)) flat.deleteAttribute(key);
    const colors = new Float32Array(flat.attributes.position.count*3);
    for(let i=0;i<colors.length;i+=3) color.toArray(colors,i);
    flat.setAttribute('color',new THREE.BufferAttribute(colors,3));batch.push(flat);
    if(flat!==geo) geo.dispose();
  }
  function finish(batch, material, parent, name) {
    const mesh = new THREE.Mesh(mergeGeometries(batch,false),material);
    mesh.name=name;parent.add(mesh);batch.forEach(q=>q.dispose());return mesh;
  }
  function box(batch,size,pos,color=plain) { add(batch,new THREE.BoxGeometry(...size).translate(...pos),color); }
  function tube(batch,a,b,r,color=plain) {
    const m=rod(V(a),V(b),r,metal,low?6:10);m.updateMatrix();add(batch,m.geometry.applyMatrix4(m.matrix),color);
  }
  function oval(batch,size,pos,color=plain) { add(batch,new THREE.SphereGeometry(1,Math.max(...size)<.20?8:segments,Math.max(...size)<.20?6:low?8:16).scale(...size).translate(...pos),color); }
  function polygon(batch,points,color=plain) {
    const v=[];for(let i=1;i<points.length-1;i++)v.push(...points[0],...points[i],...points[i+1]);
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(v,3));geo.computeVertexNormals();add(batch,geo,color);
  }
  function prism(batch,outline,thickness,vertical=false,color=plain) {
    const shape=new THREE.Shape();outline.forEach(([a,b],i)=>i?shape.lineTo(a,b):shape.moveTo(a,b));shape.closePath();
    const geo=new THREE.ExtrudeGeometry(shape,{depth:thickness,bevelEnabled:false,steps:1});
    const p=geo.attributes.position;
    for(let i=0;i<p.count;i++){const a=p.getX(i),b=p.getY(i),t=p.getZ(i)-thickness/2;p.setXYZ(i,vertical?t:a,vertical?a:-t,b);}
    geo.computeVertexNormals();add(batch,geo,color);
  }
  // Circular section, drooped radome and rising APU cone. Paint boundaries use
  // angular strips of the SAME skin, avoiding intersecting scaled cylinders.
  const profile=[[-19.7,.025,-.35],[-19.5,.32,-.30],[-19,.76,-.20],[-18.3,1.15,-.10],[-17.4,1.46,0],[-16.4,1.70,0],[-14.5,1.9,0],[10.8,1.9,0],[12.5,1.79,.15],[14.5,1.43,.40],[16.5,.99,.72],[18,.55,1.0],[19.2,.23,1.17],[19.5,.16,1.2]];
  function section(z) {
    let i=0;while(i<profile.length-2&&profile[i+1][0]<z)i++;
    const a=profile[i],b=profile[i+1],f=(z-a[0])/(b[0]-a[0]);return [a[1]+(b[1]-a[1])*f,a[2]+(b[2]-a[2])*f];
  }
  const angles=Array.from({length:segments+1},(_,i)=>i*Math.PI*2/segments);
  for(const a of [Math.PI+.10,Math.PI+.24,2*Math.PI-.24,2*Math.PI-.10])angles.push(a);
  angles.sort((a,b)=>a-b);
  for(let j=0;j<angles.length-1;j++) {
    const a=angles[j],b=angles[j+1],mid=(a+b)/2,verts=[],normals=[],idx=[];
    for(let k=0;k<profile.length;k++) {
      const [z,r,y]=profile[k],prev=profile[Math.max(0,k-1)],next=profile[Math.min(profile.length-1,k+1)];
      for(const t of [a,b]){verts.push(r*Math.cos(t),y+r*Math.sin(t),z);const n=V([Math.cos(t),Math.sin(t),-(next[1]-prev[1]+Math.sin(t)*(next[2]-prev[2]))/(next[0]-prev[0])]).normalize();normals.push(...n.toArray());}
    }
    for(let k=0;k<profile.length-1;k++){const i=k*2;idx.push(i,i+1,i+3,i,i+3,i+2);}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));geo.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geo.setIndex(idx);
    add(skin,geo,Math.sin(mid)<-.237?grey:Math.sin(mid)<-.099?stripe:plain);
  }
  oval(skin,[2.03,.69,5.7],[0,-1.76,.75],grey);
  // Project every window/door vertex onto the actual tapered circular skin.
  function sidePoint(s,y,z,proud=.015) {const [r,c]=section(z);return [s*(Math.sqrt(Math.max(.001,r*r-(y-c)*(y-c)))+proud),y,z];}
  function sidePane(batch,s,outline,color=plain) {const q=outline.map(([z,y])=>sidePoint(s,y,z));polygon(batch,s<0?q.reverse():q,color);}
  for(const s of [-1,1]) {
    for(let i=0;i<60;i++) {
      const z=-13.9+i*.435;
      if([-13.7,11.6,.2,1.25].some(d=>Math.abs(z-d)<.40))continue;
      sidePane(skin,s,[[z-.125,.28],[z-.165,.32],[z-.165,.59],[z-.125,.64],[z+.125,.64],[z+.165,.59],[z+.165,.32],[z+.125,.28]],ink);
    }
    // Six eyebrow-less panes wrapping from the central windshield mullion to
    // the rear sliding-window frame. Subdivision follows the round nose skin.
    for(const outline of [
      [[-17.45,.72],[-16.55,.69],[-16.35,1.54],[-17.28,1.54]],
      [[-16.42,.46],[-15.57,.46],[-15.57,.88],[-16.32,.94]],
      [[-15.46,.46],[-14.86,.48],[-14.90,.85],[-15.46,.88]],
    ]) {
      const point=(u,v)=>{
        const a=outline[0],b=outline[1],c=outline[2],d=outline[3];
        const z=(a[0]*(1-u)+b[0]*u)*(1-v)+(d[0]*(1-u)+c[0]*u)*v;
        const t=(a[1]*(1-u)+b[1]*u)*(1-v)+(d[1]*(1-u)+c[1]*u)*v;
        const [r,y]=section(z);return [s*(r+.025)*Math.cos(t),y+(r+.025)*Math.sin(t),z];
      };
      for(let u=0;u<6;u++)for(let v=0;v<6;v++){
        const q=[point(u/6,v/6),point((u+1)/6,v/6),point((u+1)/6,(v+1)/6),point(u/6,(v+1)/6)];
        polygon(glazing,s>0?q.reverse():q);
      }
    }
    if(high) for(const [z,w,bot,top] of [[-13.7,.80,-1.05,1.13],[11.6,.8,-1.05,1.13],[.2,.60,-.4,.95],[1.25,.60,-.4,.95]]) {
      const q=[[z-w/2,bot+.12],[z-w/2,top-.12],[z-w/2+.12,top],[z+w/2-.12,top],[z+w/2,top-.12],[z+w/2,bot+.12],[z+w/2-.12,bot],[z-w/2+.12,bot]];
      // Subdivide long seams to follow the round fuselage rather than cut through it.
      for(let i=0;i<q.length;i++)for(let k=0;k<8;k++){
        const a=q[i],b=q[(i+1)%q.length],p=f=>sidePoint(s,a[1]+(b[1]-a[1])*f,a[0]+(b[0]-a[0])*f,.022);
        tube(skin,p(k/8),p((k+1)/8),.012,ink);
      }
      tube(skin,sidePoint(s,.05,z-.11,.035),sidePoint(s,.05,z+.11,.035),.025,grey);
    }
  }
  // Cambered foil with explicit section endpoints; fixed trailing edge stops at
  // the hinges. The break in chord creates the inboard Yehudi extension.
  function foil(batch,stations,color=plain) {
    const n=high?20:low?8:12,verts=[],idx=[],p=2*(n+1);
    for(const [x,y,le,te,t] of stations)for(const sign of [1,-1])for(let j=0;j<=n;j++){
      const f=sign>0?j/n:1-j/n;verts.push(x,y+t*Math.sin(Math.PI*Math.sqrt(f))*(sign>0?.72:-.28),le+(te-le)*f);
    }
    for(let k=0;k<stations.length-1;k++)for(let j=0;j<p;j++){const a=k*p+j,b=k*p+(j+1)%p;idx.push(a,b,b+p,a,b+p,a+p);}
    for(let j=1;j<p-1;j++){idx.push(0,j+1,j);const b=(stations.length-1)*p;idx.push(b,b+j,b+j+1);}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));geo.setIndex(idx);geo.computeVertexNormals();add(batch,geo,color);
  }
  const half=def.span/2, tip=half-.55;
  const chord=x=>x<tip*.28?7.2:7.2-5.7*(x-tip*.28)/(tip*.72);
  const height=x=>-1.35+x*Math.tan(6*DEG), quarter=x=>-1.7+x*Math.tan(25*DEG);
  const leading=x=>quarter(x)-chord(x)*.25, hinge=x=>quarter(x)+chord(x)*.49;
  // A fixed carrier aligns local X to the swept/dihedral hinge. Animation then
  // only replaces the child's X rotation; it cannot erase the hinge alignment.
  function hinged(name,a,b,build) {
    const carrier=new THREE.Group(),axis=V(b).sub(V(a)).normalize(),aft=V([0,0,1]);
    const up=aft.clone().cross(axis).normalize(),back=axis.clone().cross(up).normalize();
    carrier.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(axis,up,back));carrier.position.copy(V(a));g.add(carrier);
    const batch=[];build(batch,V(a).distanceTo(V(b)));return finish(batch,white,carrier,name);
  }
  for(const s of [-1,1]) {
    const xs=[0,1.9,tip*.28,8,12.9,tip].map(x=>s*x).sort((a,b)=>a-b);
    foil(paint,xs.map(x=>[x,height(Math.abs(x)),leading(Math.abs(x)),hinge(Math.abs(x)),chord(Math.abs(x))*.11]));
    for(const [inner,outer,type] of [[2.05,6.0,'flap'],[6.12,12.65,'flap'],[12.8,tip-.12,'aileron']]) {
      const ends=[s*inner,s*outer].sort((a,b)=>a-b),flap=type==='flap';
      const moving=hinged(type+':'+s+':'+inner,...ends.map(x=>[x,height(Math.abs(x))-(flap?.14:0),hinge(Math.abs(x))+.06]),(batch,w)=>{
        const c0=chord(Math.abs(ends[0]))*.25,c1=chord(Math.abs(ends[1]))*.25;
        foil(batch,[[0,0,.015,c0*(flap?.70:1),.08],[w,0,.015,c1*(flap?.70:1),.06]]);
        if(flap)foil(batch,[[0,-.075,c0*.76,c0*1.07,.05],[w,-.075,c1*.76,c1*1.07,.04]]);
      });
      if(flap){moving.rotation.x=30*DEG;parts.flaps.push(moving);}else parts[s<0?'aileronL':'aileronR']=moving;
    }
    const ends=[s*3.0,s*12.4].sort((a,b)=>a-b);
    // Four distinct panels share one straight front hinge and one moving draw.
    const sp=hinged('spoilers:'+s,...ends.map(x=>[x,height(Math.abs(x))+.24,hinge(Math.abs(x))-.80]),(batch,w)=>{
      for(let k=0;k<4;k++)box(batch,[w/4-.09,.045,.70],[(k+.5)*w/4,0,.35]);
    });parts.spoilers.push(sp);
    if(high)for(let k=0;k<7;k++) {
      const a=1.95+k*(tip-1.95)/7,b=a+(tip-1.95)/7-.05;
      const xs=[s*a,s*b].sort((a,b)=>a-b);
      foil(paint,xs.map(x=>[x,height(Math.abs(x))-.035,leading(Math.abs(x))-.075,leading(Math.abs(x))+.18,.07]),grey);
    }
    for(const x of [4.8,9.4])oval(paint,[.20,.24,1.5],[s*x,height(x)-.29,hinge(x)+.45],grey);
    // Curving, outward-canted winglet, lofted continuously from the wing tip.
    const wl=[ [tip,height(tip),quarter(tip)-.375,quarter(tip)+1.125,.13], [tip+.20,height(tip)+.22,quarter(tip)-.27,quarter(tip)+1.12,.11], [tip+.38,height(tip)+.65,quarter(tip)-.02,quarter(tip)+1.20,.09], [half,height(tip)+2.10,quarter(tip)+.83,quarter(tip)+1.55,.05], [half,height(tip)+2.4,quarter(tip)+1.08,quarter(tip)+1.65,.035] ];
    foil(paint,wl.slice(0,4).map(q=>[s*q[0],...q.slice(1)]).sort((a,b)=>a[0]-b[0]));
    foil(paint,(s<0?wl.slice(3).reverse():wl.slice(3)).map(q=>[s*q[0],...q.slice(1)]),stripe);
    // Swept tailplane, with separate elevators and true 7-degree dihedral.
    const ty=x=>1.1+x*Math.tan(7*DEG),tq=x=>13.45+x*Math.tan(30*DEG),tc=x=>3.8-2.3*x/6.9,th=x=>tq(x)+.47*tc(x);
    foil(paint,[0,s*3,s*6.9].sort((a,b)=>a-b).map(x=>[x,ty(Math.abs(x)),tq(Math.abs(x))-.25*tc(Math.abs(x)),th(Math.abs(x)),.28]));
    const es=[s*.7,s*6.9].sort((a,b)=>a-b);
    parts.elevator.push(hinged('elevator:'+s,...es.map(x=>[x,ty(Math.abs(x)),th(Math.abs(x))+.035]),(batch,w)=>foil(batch,[[0,0,0,tc(Math.abs(es[0]))*.27,.065],[w,0,0,tc(Math.abs(es[1]))*.27,.04]])));
  }
  // 38-degree leading edge, dorsal fillet, blue fin and a white diagonal flash.
  prism(paint,[[1.45,8.7],[1.85,10.8],[2.6,11.9],[8.8,16.74],[8.8,18.1],[1.5,16.0]],.22,true,stripe);
  for(const s of [-1,1])polygon(paint,[[s*.113,4.0,13.05],[s*.113,4.65,13.55],[s*.113,7.6,17.72],[s*.113,6.8,17.49]][s<0?'reverse':'slice']());
  const rudCarrier=new THREE.Group();rudCarrier.position.set(0,1.5,16.03);
  rudCarrier.rotation.x=Math.atan2(2.10,7.30);g.add(rudCarrier);
  const rud=[];prism(rud,[[0,0],[7.6,0],[7.6,.73],[.3,1.46],[0,1.35]],.14,true,stripe);
  parts.rudder.push(finish(rud,white,rudCarrier,'rudder'));
  // Open nacelles: rounded flattened-bottom inlet, dark throat, fan blades,
  // annular bypass outlet and core nozzle. No solid cap across either opening.
  def.engines.forEach((e,i)=>{
    const center=[e.pos.x,e.pos.y,e.pos.z];
    function nac(batch,profile,color=plain,flatten=false) {
      const geo=lathe(profile,segments);if(flatten){const p=geo.attributes.position;for(let j=0;j<p.count;j++)p.setY(j,Math.max(-.94,p.getY(j)));geo.computeVertexNormals();}
      geo.translate(...center);add(batch,geo,color);
    }
    nac(hardware,[[-2.20,1.04],[-2.13,1.15],[-1.94,1.22],[-.8,1.25],[.45,1.19]],metalGrey,true);
    nac(hardware,[[-1.76,.96],[-2.15,.97],[-2.25,1.015],[-2.20,1.09],[-2.10,1.15]],plain,true);
    nac(hardware,[[-2.15,.965],[-1.65,.91],[-1.35,.89]],metalInk,true);
    nac(hardware,[[.35,1.16],[1.8,.96],[2.15,.83],[2.15,.73],[1.75,.78]],metalInk);
    nac(hardware,[[1.2,.58],[2.45,.46],[2.65,.44],[2.65,.38],[2.35,.38]],plain);
    nac(hardware,[[1.7,.33],[2.55,.30],[2.94,.015]],metalInk);
    if(high){
      add(hardware,new THREE.CircleGeometry(.90,segments).rotateY(Math.PI).translate(e.pos.x,e.pos.y,e.pos.z-1.32),metalInk);
      for(let k=0;k<32;k++){
        const a=k*Math.PI/16,p=(r,t,z)=>[e.pos.x+r*Math.cos(t),e.pos.y+r*Math.sin(t),e.pos.z+z];
        polygon(hardware,[p(.25,a,-1.51),p(.88,a+.13,-1.43),p(.88,a+.23,-1.39),p(.30,a+.18,-1.49)].reverse(),plain);
      }
      nac(hardware,[[-1.98,.005],[-1.82,.15],[-1.49,.28]],plain);
    }
    const rev=[];add(rev,lathe([[-.65,1.195],[.50,1.11],[.65,1.055]],segments),metalGrey);
    const sleeve=finish(rev,metal,g,'reverser:'+i);sleeve.position.set(e.pos.x,e.pos.y,e.pos.z+1.05);sleeve.userData.z0=sleeve.position.z;parts.reversers.push(sleeve);
    const py=[];prism(py,[[.65,-1.5],[1.9,.5],[1.9,2.5],[.6,1.65]],.40,true);
    for(const geo of py){geo.translate(...center);paint.push(geo);}
    anchors.exhaust??=[];anchors.exhaust.push(anchor(e.pos.x,e.pos.y,e.pos.z+2.65,0,0,1,.45));
  });
  // APU pipe and dark bore remain with the exterior when the cabin disappears.
  add(hardware,lathe([[19.15,.17],[19.53,.16],[19.53,.125],[19.2,.125]],segments).translate(0,1.2,0));
  add(hardware,new THREE.CircleGeometry(.124,segments).translate(0,1.2,19.22),metalInk);
  def.gear.forEach((leg,i)=>{
    const pivot=new THREE.Group();pivot.name='gear:'+leg.name;pivot.position.set(leg.pos.x,-1.35,leg.pos.z);g.add(pivot);
    const strut=new THREE.Group();strut.position.y=leg.pos.y+1.35;pivot.add(strut);
    const batch=[],r=leg.radius,spacing=leg.main?.40:.255,width=leg.main?.34:.21;
    tube(batch,[0,0,0],[0,1.45,0],.10);
    tube(batch,[0,.85,0],[0,2.18,.08],.16);
    tube(batch,[-spacing,0,0],[spacing,0,0],.13);
    tube(batch,[0,1.92,.05],[0,.45,.42],.075);
    tube(batch,[0,.45,.42],[0,.20,0],.06);
    for(const s of [-1,1]){
      tube(batch,[s*.12,.34,.10],[s*.19,.62,.27],.035);
      tube(batch,[s*.19,.62,.27],[s*.14,.95,.12],.035);
      box(batch,[.055,leg.main?1.10:.80,leg.main?.65:1.0],[s*(leg.main?.32:.26),1.45,.09],metalGrey);
    }
    finish(batch,metal,strut,'gear:'+leg.name+':oleo-braces-doors');
    // Two tyres, both hubs and brake packs are one spinning mesh on the X axle.
    const wheels=[];
    for(const s of [-1,1]) {
      const profile=[[.48,-.5],[.78,-.5],[.95,-.32],[1,-.12],[1,.12],[.95,.32],[.78,.5],[.48,.5]].map(([rr,w])=>new THREE.Vector2(rr*r,w*width));
      add(wheels,new THREE.LatheGeometry(profile,segments).rotateZ(Math.PI/2).translate(s*spacing,0,0),ink);
      add(wheels,new THREE.CylinderGeometry(r*.49,r*.49,width*1.07,segments).rotateZ(Math.PI/2).translate(s*spacing,0,0),grey);
      for(let k=0;k<(high?8:4);k++){const a=k*Math.PI*2/(high?8:4);oval(wheels,[.015,r*.045,r*.045],[s*(spacing+width*.55),r*.31*Math.cos(a),r*.31*Math.sin(a)],ink);}
      add(wheels,new THREE.CylinderGeometry(r*.52,r*.52,.07,segments).rotateZ(Math.PI/2).translate(s*(spacing-width*.4),0,0),grey);
    }
    const wheel=finish(wheels,white,strut,'gear:'+leg.name+':twin-wheels');
    parts.legs.push({root:pivot,pivot,strut,wheels:[wheel],y0:strut.position.y,axis:leg.main?'z':'x',angle:leg.main?(leg.pos.x>0?1:-1)*88*DEG:-95*DEG});
    box(skin,[leg.main?1.4:.65,.025,leg.main?1.6:2.4],[leg.pos.x,leg.main?-1.50:-1.91,leg.pos.z],ink);
  });
  anchors.pitot=V([-1.6,-.6,-16.5]);tube(hardware,[-1.53,-.55,-15.95],anchors.pitot.toArray(),.025);
  const navL=V([-half,height(tip)+2.4,quarter(tip)+1.38]),navR=V([half,navL.y,navL.z]),navT=V([0,1.4,19.47]),navB=V([0,1.98,0]);
  oval(paint,[.10,.075,.16],navB.toArray(),new THREE.Color(.7,.015,.01));
  parts.lights=navLights(g,navL,navR,navT,navB);
  const light=V([0,-3.4,-12.6]);anchors.landingLight={position:light,target:V([0,-12,-120])};
  parts.landingLight=landingLight(g,light,anchors.landingLight.target,2500,{distance:900,angle:.3});
  for(const s of [-1,1])oval(hardware,[.17,.12,.035],[s*2.15,-1.06,leading(2.15)-.02]);
  anchors.eye=V([def.eye.x,def.eye.y,def.eye.z]);anchors.navLeft=navL;anchors.navRight=navR;anchors.tail=navT;anchors.beacon=navB;
  anchors.wingtipL=navL.clone();anchors.wingtipR=navR.clone();
  parts.hideInCockpit.push(finish(skin,skinMaterial,g,'cabin:skin-belly-cheatline-windows-doors'));
  parts.hideInCockpit.push(finish(glazing,glass,g,'cabin:six-flight-deck-panes'));
  finish(paint,white,g,'exterior:wings-tail-pylons-fairings');
  finish(hardware,metal,g,'exterior:nacelles-fans-nozzles-fittings');
  shadowAll(g);
  return {group:g,parts,anchors,bounds:measureBounds(g)};
}
