// The Condor 700 flight deck: a 737-class airliner flown from the left seat. Two
// control YOKES (the pilot's rotates for roll and slides for pitch), rudder pedals, a
// centre pedestal with TWO thrust levers (reverse levers on top of them), speedbrake
// lever on the left, flap lever with a gated detent track on the right, a pair of
// stabiliser trim wheels either side of the pedestal that spin when the trim runs,
// the gear lever (a wheel-shaped knob) on the right of the centre panel with three
// green gear lights, autobrake selector, a glass cockpit: a PFD and an ND in front of
// each pilot (canvas displays), engine displays (N1, EGT, N2, fuel flow) in the centre,
// a glareshield with the mode control panel (heading/altitude/speed windows), an
// overhead panel, six windshield panes with thick posts, sun visors, two seats, a
// centre console. Night: panel flood lighting and lit displays.
//
// THE CONTRACT is the same as skylark.js - read that header first; it is the spec.
//   export function buildCockpit(def, ctx) -> { group, parts, update(state), look }
// Body frame, built around ctx.eye (= def.eye). Control signs as in common.js:
// elevator > 0 = yoke aft, aileron > 0 = yoke clockwise, rudder > 0 = right pedal
// forward, throttle 1 = levers forward, reverse > 0 = the reverse levers raised,
// trim > 0 = nose up (wheels roll aft). Gear lever down for gearCmd 1; the three
// gear lights follow gearLocked[] (nose, left, right); spoiler lever follows spoiler
// (and sits in ARM when spoilerArmed); autobrake selector shows OFF/MED/MAX.
// This aircraft's parts: yoke, pedalL, pedalR, throttle[2], flapLever, spoilerLever,
// gearLever, gearLights[3], trimWheel, pfd (a mesh with a canvas display), rpm[2],
// stallLight, panel, glareshield, seat, windshield.
// The PFD/ND are canvas textures uploaded at <= 20 Hz via makeDisplay() (never per
// frame); everything else moves as meshes. look: an airliner flight deck - the side
// window limits the turn.
// Budget at ctx.detail 'high': <= 80k triangles, <= 20 draw calls; no Math.random;
// name every material; no at* uniforms. Keep this header.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DEG, clamp, lerp } from '../../config.js';
import { mat, makeDisplay } from './common.js';

// All colours of paint, fabric and hardware share one vertex-colour material.
// Small moving fittings are baked from their named Groups into one dynamic mesh;
// their original vertices/normals and transform scratch storage are allocated once.
// The three independent gear lamps and shaker lamp retain their own materials.
export function buildCockpit(def, ctx) {
  const group = new THREE.Group(), parts = {};
  const low = ctx.detail === 'low', seg = low ? 12 : ctx.detail === 'high' ? 28 : 20;
  const grey = 0x717776, light = 0x9c9e94, dark = 0x202729, black = 0x101719;
  const metal = 0xa8b0ae, white = 0xdedfcf, fabric = 0x676b68;
  const solid = mat('condor:cockpit:paint-fabric-hardware', 0xffffff, {
    roughness: .78, metalness: .12, emissive: 0x645039, emissiveIntensity: 0,
    extra: { vertexColors: true },
  });
  const glass = mat('condor:cockpit:six-pane-glass', 0xb3c9cb, {
    transparent: true, opacity: .14, roughness: .15, side: THREE.DoubleSide,
  });
  const display = makeDisplay(2048, 1024, 20);
  display.texture.generateMipmaps = false;
  display.texture.minFilter = THREE.LinearFilter;
  const screenMat = new THREE.MeshBasicMaterial({name:'condor:cockpit:display-atlas', map:display.texture});
  const placard = makePlacards();
  const faceMat = mat('condor:cockpit:placard-atlas', 0xffffff, {
    emissive: 0xffffff, emissiveIntensity: .12, roughness: .9,
    extra: { map:placard, emissiveMap:placard },
  });
  const S = [], G = [], F = [], D = [], movingGeos = [], motions = [];
  let movingCount = 0;
  function add(batch, geometry, color = 0xffffff) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count*2),2));
    const rgb = new THREE.Color(color), colors = new Float32Array(g.attributes.position.count*3);
    for (let i=0;i<colors.length;i+=3) rgb.toArray(colors,i);
    g.setAttribute('color',new THREE.BufferAttribute(colors,3)); batch.push(g);
  }
  function box(b,x,y,z,w,h,d,col=dark,rx=0) {
    add(b,new THREE.BoxGeometry(w,h,d).rotateX(rx).translate(x,y,z),col);
  }
  function rod(b,a,c,r,col=metal) {
    const start=new THREE.Vector3(...a),end=new THREE.Vector3(...c),v=end.clone().sub(start);
    const geo=new THREE.CylinderGeometry(r,r,v.length(),low?6:10);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),v.normalize()));
    geo.translate(...start.add(end).multiplyScalar(.5).toArray());add(b,geo,col);
  }
  function ring(b,x,y,z,r,t=.004,col=dark,ry=0) {
    add(b,new THREE.TorusGeometry(r,t,low?4:6,seg).rotateY(ry).translate(x,y,z),col);
  }
  function quad(b,q,col=0xffffff) {
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(q.flat(),3));
    geo.setIndex([0,1,2,0,2,3]);geo.computeVertexNormals();add(b,geo,col);
  }
  function finish(b,m,name) {
    const geo=mergeGeometries(b,false);for(const g of b)g.dispose();
    const mesh=new THREE.Mesh(geo,m);mesh.name=name;group.add(mesh);return mesh;
  }
  function moving(name,x,y,z,build,parent=group) {
    const node=new THREE.Group();node.name=name;node.position.set(x,y,z);parent.add(node);
    const b=[];build(b);
    const geo=mergeGeometries(b,false);for(const g of b)g.dispose();
    motions.push({node,start:movingCount,p:geo.attributes.position.array.slice(),n:geo.attributes.normal.array.slice()});
    movingCount+=geo.attributes.position.count;movingGeos.push(geo);return node;
  }
  function rect(b,x,y,z,w,h,px,py,pw,ph,aw,ah,rx=0,ry=0) {
    const geo=new THREE.PlaneGeometry(w,h),uv=geo.attributes.uv;
    for(let i=0;i<uv.count;i++)uv.setXY(i,(px+uv.getX(i)*pw)/aw,1-(py+(1-uv.getY(i))*ph)/ah);
    geo.rotateX(rx).rotateY(ry).translate(x,y,z);add(b,geo);
  }
  function label(tile,x,y,z,w,h,rx=0,ry=0) {
    rect(F,x,y,z,w,h,tile%4*256+3,Math.floor(tile/4)*256+3,250,250,1024,1024,rx,ry);
  }
  const pz=ctx.eye.z-.8, top=ctx.eye.y-.1, floor=ctx.eye.y-1.1;
  // Six flat inner panes sit within the exterior nose envelope. The hidden
  // exterior uses curved projected panes; the inner forward pair meet on the
  // aircraft centreline, with continuous No.1/No.2 edges rather than an infill
  // spanning the captain's forward sight line.
  for(const side of [-1,1]) {
    const panes=[
      [[0,1.08,-17.40],[1.28,1.03,-16.45],[.97,1.72,-16.28],[0,1.78,-16.55]],
      [[1.28,1.03,-16.45],[1.52,.82,-15.52],[1.15,1.48,-15.52],[.97,1.72,-16.28]],
      [[1.52,.82,-15.46],[1.55,.86,-14.86],[1.17,1.47,-14.90],[1.15,1.48,-15.46]],
    ].map(q=>q.map(([x,y,z])=>[side*x,y,z]));
    for(const q of panes) {
      quad(G,q);
      for(let i=0;i<4;i++)rod(S,q[i],q[(i+1)%4],.032,light);
    }
    // Lower window liners and upper cheek panels close the shell without
    // putting opaque triangles inside any of the six window openings.
    for(const q of [
      [panes[1][0],panes[1][1],[side*1.50,.77,-15.52],[side*1.28,.77,-16.45]],
      [panes[2][0],panes[2][1],[side*1.50,.77,-14.86],[side*1.50,.77,-15.46]],
      [panes[1][3],panes[1][2],[side*1.20,1.85,-15.52],[side*.97,1.85,-16.28]],
      [panes[2][3],panes[2][2],[side*1.20,1.85,-14.90],[side*1.20,1.85,-15.46]],
    ]) { quad(S,q,light);quad(S,q.slice().reverse(),light); }
    rod(S,panes[0][2],panes[2][2],.023,metal);
    box(S,side*.62,1.70,-16.0,.46,.018,.21,0x626b60,-.18);
    rod(S,[side*.22,1.72,-16.06],[side*1.10,1.58,-15.73],.009,metal);
    // Wide sills, lower liners and a closed rear corner around each window.
    box(S,side*1.50,.50,-15.32,.10,.55,1.95,light);
    box(S,side*1.40,.82,-15.32,.24,.065,1.90,grey);
    box(S,side*1.38,1.14,-14.54,.15,.86,.20,light);
    rod(S,[side*1.33,.86,-15.81],[side*1.33,.95,-15.68],.014,metal);
    rod(S,[side*1.33,.95,-15.68],[side*1.23,.95,-15.68],.022,dark);
    box(S,side*1.40,.55,-15.00,.08,.23,.35,dark);
    box(S,side*1.345,.60,-15.00,.014,.15,.27,white);
    box(S,side*1.30,.70,-15.68,.23,.18,.18,dark);
    label(11,side*1.17,.705,-15.68,.15,.12,0,-side*Math.PI/2);
    for(let i=0;i<5;i++)box(S,side*1.32,.855,-15.1+i*.035,.11,.002,.004,black);
  }
  box(S,0,floor-.025,-15.37,2.95,.05,3.30,dark);
  for(let i=0;i<(low?12:30);i++)box(S,-1.36+i*(low?.24:.094),floor+.003,-15.42,.011,.003,2.95,0x454b4a);
  box(S,0,1.88,-14.84,2.5,.08,1.7,light);
  box(S,0,1.84,-15.88,1.94,.045,.58,light);
  box(S,0,1.06,-13.92,2.75,1.66,.08,grey);
  box(S,0,1.13,-13.98,.60,1.5,.04,dark);
  // Own nose top and wiper plenum: the exterior fuselage is hidden in this view.
  quad(S,[[-1.16,top-.02,pz-.1],[1.16,top-.02,pz-.1],[1.1,1.02,-17.42],[-1.1,1.02,-17.42]],dark);
  box(S,0,.89,-17.65,1.80,.16,.65,grey);
  for(const s of [-1,1]) {
    rod(S,[s*.64,1.075,-17.25],[s*.84,1.15,-16.85],.012,black);
    rod(S,[s*.84,1.15,-16.85],[s*.40,1.19,-16.78],.017,black);
  }
  box(S,0,top-.265,pz-.045,2.32,.53,.09,grey);
  box(S,0,top+.008,pz-.17,2.42,.055,.43,dark);
  box(S,0,top-.064,pz+.014,.94,.12,.085,grey);
  label(0,0,top-.055,pz+.059,.87,.115);
  for(let i=0;i<15;i++)box(S,-.42+i*.06,top-.102,pz+.070,.031,.017,.013,i%4===0?0x6e8977:black);
  for(const x of [-.33,-.04,.28]) {
    rod(S,[x,top-.079,pz+.06],[x,top-.079,pz+.085],.015,metal);
    box(S,x,top-.065,pz+.090,.003,.012,.003,white);
  }
  for(const side of [-1,1]) {
    label(1,side*.87,top-.045,pz+.035,.37,.085);
    box(S,side*.68,top-.06,pz+.013,.06,.043,.025,0xa77929);
  }
  // Standby magnetic compass, suspended just right of the captain's forward view.
  box(S,0,1.46,-16.46,.12,.085,.08,dark);
  label(2,0,1.46,-16.415,.10,.06);
  rod(S,[0,1.61,-16.46],[0,1.5,-16.46],.013,grey);
  // Main glass: outer PFDs, inner NDs and central engine display, recessed bezels.
  const screens=[[-.82,.995,.285,.29,0,0,512,512],[-.48,.995,.285,.29,512,0,512,512],
    [0,.96,.29,.30,1024,0,512,512],[.48,.995,.285,.29,512,0,512,512],[.82,.995,.285,.29,0,0,512,512]];
  for(const [x,y,w,h,px,py,pw,ph] of screens) {
    box(S,x,y,pz+.014,w+.035,h+.035,.038,black);
    rect(D,x,y,pz+.035,w,h,px+2,py+2,pw-4,ph-4,2048,1024);
    for(const dx of [-1,1])rod(S,[x+dx*w*.46,y-h*.56,pz+.025],[x+dx*w*.46,y-h*.56,pz+.046],.009,dark);
  }
  // Pedestal top slopes up to the two CDU keypads beneath the centre displays.
  box(S,0,.53,-15.35,.53,.52,1.50,grey);
  box(S,0,.79,-15.03,.55,.035,.82,dark);
  const cduAngle=-.70;
  for(let i=0;i<2;i++) {
    const x=(i-.5)*.265;
    box(S,x,.755,-15.85,.247,.033,.40,dark,cduAngle+Math.PI/2);
    rect(D,x,.83,-15.87,.218,.13,1536+i*256+2,2,252,252,2048,1024,cduAngle);
    label(3,x,.713,-15.772,.218,.165,cduAngle);
    for(let row=0;row<(low?3:5);row++)for(let col=0;col<6;col++) {
      const yy=.77-row*.021,zz=-15.81+row*.024;
      box(S,x-.09+col*.036,yy,zz,.022,.006,.018,0x3e4747,cduAngle+Math.PI/2);
    }
  }
  label(4,0,.812,-14.84,.45,.31,-Math.PI/2);
  for(const x of [-.18,.18])for(const z of [-14.73,-14.91])rod(S,[x,.815,z],[x,.842,z],.017,dark);
  label(5,.235,.811,-15.26,.073,.43,-Math.PI/2);
  label(6,-.225,.811,-15.30,.068,.40,-Math.PI/2);
  for(const side of [-1,1])label(14,side*.271,.60,-15.04,.20,.14,0,side*Math.PI/2);
  for(let i=0;i<9;i++)box(S,.245,.824,-15.46+i*.044,.04,.012,.008,metal);
  box(S,.215,.824,-15.27,.012,.012,.40,black);
  box(S,-.20,.824,-15.32,.011,.010,.35,black);
  // Both pilots' seats and the folded observer's seat, with stitched cushions,
  // harness straps, pedestal legs and separately readable armrests.
  for(const x of [-.57,.57,0]) {
    const observer=x===0,z=observer?-14.20:-15.02,w=observer?.40:.48;
    box(S,x,.62,z,w,.13,.48,fabric);
    box(S,x,.97,z+.24,w,.63,.105,fabric,-.11);
    box(S,x,1.30,z+.28,w*.65,.14,.09,fabric,-.11);
    box(S,x,.40,z,.15,.38,.17,metal);
    for(const side of [-1,1]) {
      rod(S,[x+side*w*.53,.60,z+.15],[x+side*w*.53,.86,z+.12],.019,dark);
      box(S,x+side*w*.53,.87,z-.015,.075,.055,.37,dark);
      box(S,x+side*.12,1.02,z+.173,.037,.44,.012,0x353d3d,-.11);
    }
    for(let i=0;i<6;i++)box(S,x-w*.40+i*w*.16,.691,z,.003,.002,.39,0x81847a);
    box(S,x+.065,.704,z+.04,.065,.02,.047,metal);
  }
  // The overhead is above/behind the eye and slopes down toward its front edge.
  const overhead=new THREE.Group();overhead.position.set(0,1.80,-15.10);overhead.rotation.x=.17;
  const overheadB=[];box(overheadB,0,0,0,.77,.065,1.04,grey);
  const rows=low?5:10,cols=low?5:8;
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++) {
    const x=-.32+c*.64/(cols-1),z=-.43+r*.86/(rows-1);
    box(overheadB,x,-.038,z,.058,.012,.060,dark);
    rod(overheadB,[x,-.043,z],[x+.006,-.068,z+.007],.005,metal);
    if((r+c)%3===0)box(overheadB,x,-.070,z,.018,.012,.019,white);
  }
  overhead.updateMatrix();for(const geo of overheadB){geo.applyMatrix4(overhead.matrix);S.push(geo);}
  label(7,0,1.746,-15.1,.69,.92,Math.PI/2+.17);
  // Controls. Each Group is a real pivot; the merged moving mesh follows it.
  function wheel(name,x) {
    rod(S,[x,floor+.03,-15.76],[x,.89,-15.73],.029,dark);
    return moving(name,x,.96,-15.67,b=>{
      rod(b,[0,0,-.095],[0,0,0],.029,dark);
      box(b,0,-.006,0,.10,.083,.048,dark);
      for(const side of [-1,1]) {
        rod(b,[side*.03,-.025,0],[side*.14,-.05,.008],.021,dark);
        rod(b,[side*.14,-.05,.008],[side*.177,.038,.012],.023,dark);
        rod(b,[side*.177,.038,.012],[side*.16,.095,.012],.023,dark);
        box(b,side*.163,.073,.037,.029,.03,.014,black);
        box(b,side*.163,.078,.046,.013,.006,.003,metal);
      }
      box(b,0,.049,.029,.074,.011,.009,metal);
      box(b,0,.005,.027,.063,.05,.002,white);
      for(let i=0;i<4;i++)box(b,0,.023-i*.012,.029,.049,.002,.001,grey);
    });
  }
  parts.yoke=wheel('captain-yoke',ctx.eye.x);parts.foYoke=wheel('first-officer-yoke',-ctx.eye.x);
  parts.yokeHome=parts.yoke.position.clone();
  for(const side of [-1,1]) {
    const name=side<0?'pedalL':'pedalR';
    parts[name]=moving(name,ctx.eye.x+side*.14,floor+.12,pz+.19,b=>{
      for(const x of [0,-2*ctx.eye.x]) {
        rod(b,[x,0,0],[x,.16,-.02],.016,metal);
        box(b,x,.17,0,.115,.145,.026,dark,-.22);
        for(let i=0;i<5;i++)box(b,x,.12+i*.023,.019,.104,.008,.007,metal,-.22);
      }
    });parts[name].userData.z0=parts[name].position.z;
  }
  parts.throttle=[];parts.reverseLevers=[];
  for(let i=0;i<2;i++) {
    const lever=moving('thrust-'+i,(i-.5)*.09,.82,-15.35,b=>{
      rod(b,[0,0,0],[0,.23,0],.013,metal);
      box(b,0,.235,0,.07,.055,.078,white);
      box(b,0,.246,.041,.006,.027,.002,black);
      if(i)box(b,.013,.246,.041,.006,.027,.002,black);
    });parts.throttle.push(lever);
    parts.reverseLevers.push(moving('reverse-'+i,0,.17,.045,b=>{
      rod(b,[0,0,0],[0,.045,.025],.009,dark);box(b,0,.052,.027,.061,.023,.032,dark);
    },lever));
  }
  function lever(name,x,z,height,col) {
    return moving(name,x,.823,z,b=>{rod(b,[0,0,0],[0,height,0],.009,metal);box(b,0,height,0,.052,.03,.042,col);});
  }
  parts.spoilerLever=lever('speedbrake',-.20,-15.37,.15,dark);
  parts.flapLever=lever('flap',.22,-15.25,.16,white);
  parts.trimWheel=moving('paired-stabiliser-trim-wheels',0,.70,-15.28,b=>{
    for(const x of [-.292,.292]) {
      ring(b,x,0,0,.145,.014,dark,Math.PI/2);
      for(let i=0;i<5;i++){const a=i*Math.PI*2/5;rod(b,[x,0,0],[x,Math.cos(a)*.135,Math.sin(a)*.135],.006,metal);}
      box(b,x,.138,0,.032,.013,.045,white);
      add(b,new THREE.TorusGeometry(.145,.015,6,seg/2,Math.PI*.32).rotateY(Math.PI/2).translate(x,0,0),0x548153);
      rod(b,[x,.06,.085],[x+(x<0?-.025:.025),.06,.085],.012,dark);
    }
  });
  parts.gearLever=moving('gear',.25,.975,pz+.055,b=>{
    rod(b,[0,0,0],[0,-.085,.03],.010,metal);
    ring(b,0,-.085,.032,.026,.009,white);
    rod(b,[-.018,-.085,.033],[.018,-.085,.033],.004,metal);
  });parts.gearLever.userData.y0=parts.gearLever.position.y;
  label(8,.25,.995,pz+.022,.11,.29);
  parts.autobrake=moving('autobrake',.26,.78,pz+.047,b=>{
    rod(b,[0,0,-.006],[0,0,.017],.018,dark);box(b,0,.010,.021,.007,.029,.005,white);
  });
  label(9,.26,.785,pz+.025,.13,.086);
  // Standby instruments and two little N1 needles are visible, not dummy nodes.
  const standby=[['asi',-.26,1.085],['alt',-.26,.985],['vsi',-.26,.885],['attitude',-.26,.785],['hdgCard',0,1.46]];
  for(const [name,x,y] of standby) {
    const z=name==='hdgCard'?-16.408:pz+.044;
    ring(S,x,y,z,.038,.004,dark);
    if(name!=='hdgCard')label(10,x,y,z-.002,.071,.071);
    parts[name]=moving(name,x,y,z+.003,b=>{
      box(b,0,.014,0,.003,.033,.002,white);
      if(name==='attitude')box(b,0,0,0,.044,.003,.002,0xd8ac46);
    });
  }
  parts.rpm=[];
  for(let i=0;i<2;i++) {
    const x=-.053+i*.106;
    label(10,x,.762,pz+.035,.073,.073);
    parts.rpm.push(moving('standby-N1-'+i,x,.762,pz+.043,b=>box(b,0,.013,0,.003,.032,.002,white)));
  }
  parts.gearLights=[];parts.gearLightMats=[];
  for(let i=0;i<3;i++) {
    const material=mat('condor:cockpit:gear-'+i,0x193d24,{emissive:0x32ff6a,emissiveIntensity:0});
    const lamp=new THREE.Mesh(new THREE.BoxGeometry(.021,.018,.006),material);
    lamp.position.set(.25+(i===0?0:i===1?-.026:.026),1.106-(i? .025:0),pz+.048);
    group.add(lamp);parts.gearLights.push(lamp);parts.gearLightMats.push(material);
  }
  const stallMat=mat('condor:cockpit:stick-shaker',0x492721,{emissive:0xff5737,emissiveIntensity:0});
  parts.stallLight=new THREE.Mesh(new THREE.BoxGeometry(.123,.023,.006),stallMat);
  parts.stallLight.position.set(-.62,top-.018,pz+.033);group.add(parts.stallLight);
  label(12,-.62,top-.040,pz+.037,.119,.016);
  // Extra live indications share the atlas and therefore cost no extra draw.
  rect(D,.25,1.15,pz+.046,.084,.023,0,768,256,64,2048,1024);
  rect(D,-.60,top-.066,pz+.038,.09,.026,256,768,256,64,2048,1024);
  rect(D,.405,.865,pz+.026,.080,.080,512,512,256,256,2048,1024);
  parts.panel=parts.glareshield=parts.seat=finish(S,solid,'structure-panels-seats-hardware');
  parts.windshield=finish(G,glass,'six-windshield-panes');
  finish(F,faceMat,'printed-faces-and-placards');
  parts.pfd=parts.nd=parts.engineDisplay=finish(D,screenMat,'all-flight-displays');
  const movingMesh=finish(movingGeos,solid,'batched-moving-controls-and-needles');
  const pos=movingMesh.geometry.attributes.position,norm=movingMesh.geometry.attributes.normal;
  pos.setUsage(THREE.DynamicDrawUsage);norm.setUsage(THREE.DynamicDrawUsage);
  // Fixed conservative bounds include every permitted lever throw and pedal stroke.
  movingMesh.geometry.boundingBox=new THREE.Box3(new THREE.Vector3(-1.2,.2,-16.6),new THREE.Vector3(1.2,1.65,-14.8));
  movingMesh.geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(0,.95,-15.7),1.65);
  const vp=new THREE.Vector3(),vn=new THREE.Vector3(),normalMatrix=new THREE.Matrix3();
  let state=null,lastSlow=-1e9,lastCdu=-1e9;
  const paint=c=>{
    drawPfd(c,state);
    if(state.t-lastSlow>=.1-1e-8){drawNavigation(c,state);drawEngines(c,state);drawIndicators(c,state);lastSlow=state.t;}
    if(state.t-lastCdu>=.5-1e-8){drawCdu(c,state,0);drawCdu(c,state,1);lastCdu=state.t;}
  };
  function update(s) {
    state=s;
    parts.yoke.rotation.z=parts.foYoke.rotation.z=-s.aileron*60*DEG;
    parts.yoke.position.z=parts.foYoke.position.z=parts.yokeHome.z+s.elevator*.08;
    parts.pedalR.position.z=parts.pedalR.userData.z0-s.rudder*.07;
    parts.pedalL.position.z=parts.pedalL.userData.z0+s.rudder*.07;
    for(let i=0;i<2;i++) {
      parts.throttle[i].rotation.x=(30-60*s.throttle[i])*DEG;
      parts.reverseLevers[i].rotation.x=-(s.onGround||s.wheelsOnGround?s.reverse:0)*65*DEG;
      parts.rpm[i].rotation.z=-clamp(s.n1[i],0,1)*270*DEG;
    }
    parts.flapLever.rotation.x=(-25+55*s.flapDetent/(def.flaps.detents.length-1))*DEG;
    parts.spoilerLever.rotation.x=(-25+50*(s.spoilerArmed&&s.spoiler<.05?.08:s.spoiler))*DEG;
    parts.trimWheel.rotation.x=s.trim*4;
    parts.gearLever.position.y=parts.gearLever.userData.y0-(s.gearCmd?.04:0);
    parts.autobrake.rotation.z=-s.autobrake/.7*110*DEG;
    parts.asi.rotation.z=-clamp(s.ias/400,0,1)*300*DEG;
    parts.alt.rotation.z=-(s.alt%1000)/1000*Math.PI*2;
    parts.vsi.rotation.z=(90-clamp(s.vs/6000,-1,1)*150)*DEG;
    parts.attitude.rotation.z=-s.roll*DEG;parts.attitude.position.y=.785-clamp(s.pitch,-25,25)*.0006;
    parts.hdgCard.rotation.z=s.heading*DEG;
    for(let i=0;i<3;i++)parts.gearLightMats[i].emissiveIntensity=s.gearLocked[i]?1.4:0;
    stallMat.emissiveIntensity=s.stallWarning&&Math.floor(s.t*4)%2===0?1.8:0;
    const night=1-clamp(s.dayness??(s.night?0:1),0,1);
    solid.emissiveIntensity=night*.14;faceMat.emissiveIntensity=.12+night*.58;
    // Only the local control hierarchy is traversed; the aircraft's world matrix
    // must not enter these body-frame vertex positions.
    for(let j=0;j<motions.length;j++) {
      const r=motions[j],node=r.node;node.updateMatrix();
      if(node.parent===group)node.matrixWorld.copy(node.matrix);
      else node.matrixWorld.multiplyMatrices(node.parent.matrixWorld,node.matrix);
      normalMatrix.getNormalMatrix(node.matrixWorld);
      for(let k=0;k<r.p.length;k+=3) {
        vp.fromArray(r.p,k).applyMatrix4(node.matrixWorld);pos.setXYZ(r.start+k/3,vp.x,vp.y,vp.z);
        vn.fromArray(r.n,k).applyMatrix3(normalMatrix);norm.setXYZ(r.start+k/3,vn.x,vn.y,vn.z);
      }
    }
    pos.needsUpdate=true;norm.needsUpdate=true;
    display.tick(s.t,paint);
  }
  // Initialize geometry before the first render without inventing a flight state.
  for(const r of motions) {
    r.node.updateMatrix();
    if(r.node.parent===group)r.node.matrixWorld.copy(r.node.matrix);
    else r.node.matrixWorld.multiplyMatrices(r.node.parent.matrixWorld,r.node.matrix);
    normalMatrix.getNormalMatrix(r.node.matrixWorld);
    for(let k=0;k<r.p.length;k+=3) {
      vp.fromArray(r.p,k).applyMatrix4(r.node.matrixWorld);pos.setXYZ(r.start+k/3,vp.x,vp.y,vp.z);
      vn.fromArray(r.n,k).applyMatrix3(normalMatrix);norm.setXYZ(r.start+k/3,vn.x,vn.y,vn.z);
    }
  }
  return {group,parts,update,look:{yaw:2.0,pitch:.9}};
}

// A single immutable 1024-square sheet, sixteen 256-square tiles. Labels and
// key legends use system fonts; no external assets or extra animated textures.
function makePlacards() {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1024;
  const c=canvas.getContext('2d');
  const titles=[
    ['COURSE     IAS / MACH       HEADING       ALTITUDE','  000        145            000          03000','FD   A/T ARM    N1  SPEED  VNAV   LNAV  VOR LOC  APP'],
    ['MASTER CAUTION','FLT CONT   ELEC   IRS','FUEL    OVHT / DET   ANTI ICE'],
    ['N    33    30','COMPASS'],
    ['INIT REF  RTE  CLB  CRZ  DES','MENU LEGS DEP ARR HOLD PROG','A B C D E F   1 2 3','G H I J K L   4 5 6','M N O P Q R   7 8 9','S T U V W X   . 0 +/-','Y Z  SP DEL / CLR'],
    ['VHF 1       ACTIVE      STANDBY','118.700       121.500','VHF 2       ACTIVE      STANDBY','122.800       124.850','ATC         1200         ALT'],
    ['FLAPS','UP','1','2','5','10','15','25','30','40'],
    ['SPEED','BRAKE','DOWN','ARMED','FLIGHT','DETENT','UP'],
    ['FUEL PUMPS       ELECTRICAL','GEN 1    BUS TIE    GEN 2','WINDOW HEAT     ANTI ICE','HYDRAULIC PUMPS','AIR CONDITIONING','PACK L     ISOL     PACK R','CABIN PRESSURIZATION','EXTERIOR LIGHTS'],
    ['LANDING GEAR','NOSE','LEFT     RIGHT','UP','OFF','DOWN'],
    ['AUTOBRAKE','OFF    MED    MAX'],
    ['0','8          2','6     4'],
    ['CREW OXYGEN','MASK / REGULATOR','PULL'],
    ['STICK SHAKER'],
    ['CONDOR 700','Cleared to Land'],
    ['STABILIZER TRIM','NOSE UP','TAKE OFF','NOSE DOWN'],
    ['STANDBY','KNOTS    FEET'],
  ];
  c.fillStyle='#3b4343';c.fillRect(0,0,1024,1024);
  for(let i=0;i<16;i++) {
    const x=i%4*256,y=Math.floor(i/4)*256,rows=titles[i];
    c.fillStyle=i===12?'#3f2018':i===2||i===10?'#111b1e':'#3b4343';c.fillRect(x,y,256,256);
    c.textAlign='center';c.textBaseline='middle';c.fillStyle='#e3e1c9';
    c.font=`${i===0?11:i===3?12:i===5?18:16}px monospace`;
    for(let j=0;j<rows.length;j++)c.fillText(rows[j],x+128,y+24+j*208/Math.max(1,rows.length-1),246);
    if(i===10){c.strokeStyle='#d4d9ce';c.lineWidth=2;c.beginPath();c.arc(x+128,y+128,115,0,Math.PI*2);c.stroke();}
  }
  const texture=new THREE.CanvasTexture(canvas);texture.name='condor:cockpit:placards';texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;return texture;
}

// Canvas helpers are module functions, so the 20 Hz callback does not construct
// closures, arrays, gradients or path objects every time it draws.
function line(c,x,y,u,v,color='#e9f0ef',width=2) {
  c.strokeStyle=color;c.lineWidth=width;c.beginPath();c.moveTo(x,y);c.lineTo(u,v);c.stroke();
}
function text(c,s,x,y,size=18,color='#e9f0ef',align='center') {
  c.fillStyle=color;c.font=`${size}px monospace`;c.textAlign=align;c.fillText(s,x,y);
}
function circle(c,x,y,r,color='#e9f0ef',width=2) {
  c.strokeStyle=color;c.lineWidth=width;c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.stroke();
}
function diamond(c,x,y,color='#e973f4') {
  c.strokeStyle=color;c.lineWidth=3;c.beginPath();c.moveTo(x,y-7);c.lineTo(x+7,y);c.lineTo(x,y+7);c.lineTo(x-7,y);c.closePath();c.stroke();
}
function drawPfd(c,s) {
  c.save();c.beginPath();c.rect(0,0,512,512);c.clip();
  c.fillStyle='#050d16';c.fillRect(0,0,512,512);
  // Attitude is clipped separately from the tapes and bank pointer.
  c.save();c.beginPath();c.rect(105,70,294,322);c.clip();
  c.translate(252,226);c.rotate(-s.roll*DEG);c.translate(0,s.pitch*5);
  c.fillStyle='#2774a4';c.fillRect(-600,-1200,1200,1200);
  c.fillStyle='#765234';c.fillRect(-600,0,1200,1200);line(c,-600,0,600,0);
  for(let p=-80;p<=80;p+=5)if(p) {
    const w=p%10===0?45:23,y=-p*5;line(c,-w,y,w,y);
    if(p%10===0){text(c,String(Math.abs(p)),-65,y+5,14);text(c,String(Math.abs(p)),65,y+5,14);}
  }
  c.restore();
  for(let bank=-60;bank<=60;bank+=10) {
    const a=bank*DEG,r=bank%30===0?141:149;
    line(c,252+Math.sin(a)*r,226-Math.cos(a)*r,252+Math.sin(a)*159,226-Math.cos(a)*159);
  }
  diamond(c,252+Math.sin(-s.roll*DEG)*150,226-Math.cos(-s.roll*DEG)*150,'#ffffff');
  line(c,186,226,230,226,'#ffd44b',5);line(c,274,226,318,226,'#ffd44b',5);
  line(c,230,226,230,236,'#ffd44b',4);line(c,274,226,274,236,'#ffd44b',4);
  // Flight-path angle from climb and true airspeed; drift from wind vector.
  const fpa=Math.atan2(s.vs/60,s.tas*1.68781)/DEG;
  const windAngle=(s.windDir-s.heading)*DEG;
  const drift=Math.atan2(-s.windSpeed*Math.sin(windAngle),Math.max(1,s.tas-s.windSpeed*Math.cos(windAngle)))/DEG;
  const fx=252+clamp(drift,-18,18)*5,fy=226+clamp(s.pitch-fpa,-25,25)*5;
  circle(c,fx,fy,9,'#89efb0');line(c,fx-23,fy,fx-9,fy,'#89efb0');line(c,fx+9,fy,fx+23,fy,'#89efb0');line(c,fx,fy-9,fx,fy-18,'#89efb0');
  c.fillStyle='#252e38';c.fillRect(10,70,84,322);c.fillRect(408,70,92,322);
  c.save();c.beginPath();c.rect(10,70,84,322);c.clip();
  const stall=lerp(s.vs1,s.vs0,clamp(s.flap,0,1));
  c.fillStyle='#e83640';c.fillRect(84,226+(s.ias-stall)*4,10,1000);
  for(let v=Math.floor(s.ias/10)*10-50;v<=s.ias+50;v+=10)if(v>=0) {
    const y=226+(s.ias-v)*4;line(c,73,y,84,y);text(c,String(v),67,y+6,19,'#ffffff','right');
  }
  diamond(c,85,226+(s.ias-s.vref)*4);c.restore();
  c.save();c.beginPath();c.rect(408,70,92,322);c.clip();
  for(let a=Math.floor(s.alt/100)*100-500;a<=s.alt+500;a+=100) {
    const y=226+(s.alt-a)*.36;line(c,409,y,419,y);text(c,String(a),494,y+6,17,'#ffffff','right');
  }
  c.restore();
  c.fillStyle='#02070b';c.fillRect(12,209,73,35);c.fillRect(410,209,90,35);
  text(c,String(Math.round(s.ias)),50,234,26);text(c,String(Math.round(s.alt)),497,234,22,'#ffffff','right');
  text(c,'VREF '+Math.round(s.vref),12,425,18,'#e973f4','left');
  text(c,'RA '+Math.round(Math.max(0,s.radioAlt)),252,420,24,'#ffffff');
  text(c,'VS '+(s.vs>=0?'+':'')+Math.round(s.vs),497,425,17,'#ffffff','right');
  text(c,String(Math.round(s.heading)%360).padStart(3,'0')+' MAG',252,474,24,'#ffffff');
  text(c,'IAS',49,56,16);text(c,'ALT',457,56,16);
  text(c,s.ils?'ILS':'',252,43,19,'#71e49d');
  if(s.ils) {
    for(let i=-2;i<=2;i++){circle(c,252+i*35,370,3);circle(c,386,225+i*35,3);}
    diamond(c,252+clamp(s.ilsLoc,-2.5,2.5)*35,370);
    diamond(c,386,225+clamp(s.ilsGs,-2.5,2.5)*35);
  }
  // Independent vertical-speed pointer at the right edge of the attitude.
  line(c,401,225,407,225-clamp(s.vs/2000,-1,1)*85,'#ffffff',3);
  c.restore();
}
function drawNavigation(c,s) {
  c.save();c.translate(512,0);c.beginPath();c.rect(0,0,512,512);c.clip();
  c.fillStyle='#030c12';c.fillRect(0,0,512,512);
  text(c,'HDG '+String(Math.round(s.heading)%360).padStart(3,'0')+' MAG',256,35,24,'#77e5a1');
  text(c,'GS '+Math.round(s.gs),22,64,18,'#ffffff','left');text(c,'TAS '+Math.round(s.tas),490,64,18,'#ffffff','right');
  circle(c,256,278,185);circle(c,256,278,93,'#536d70',1);
  for(let d=0;d<360;d+=5) {
    const a=(d-s.heading)*DEG,major=d%30===0;
    line(c,256+Math.sin(a)*185,278-Math.cos(a)*185,256+Math.sin(a)*(major?167:177),278-Math.cos(a)*(major?167:177));
    if(major)text(c,d===0?'N':d===90?'E':d===180?'S':d===270?'W':String(d/10),256+Math.sin(a)*148,284-Math.cos(a)*148,20);
  }
  const wa=(s.windDir-s.heading)*DEG,track=Math.atan2(-s.windSpeed*Math.sin(wa),Math.max(1,s.tas-s.windSpeed*Math.cos(wa)));
  line(c,256,278,256+Math.sin(track)*183,278-Math.cos(track)*183,'#79e7a5',2);
  line(c,256,262,244,288);line(c,244,288,256,281);line(c,256,281,268,288);line(c,268,288,256,262);
  text(c,'WIND '+Math.round(s.windDir)+' / '+Math.round(s.windSpeed),256,489,17);
  // No route, range or station identifier is supplied by the cockpit contract.
  c.restore();
}
function drawEngines(c,s) {
  c.save();c.translate(1024,0);c.beginPath();c.rect(0,0,512,512);c.clip();
  c.fillStyle='#040c13';c.fillRect(0,0,512,512);text(c,'ENGINE',256,30,20);
  for(let i=0;i<2;i++) {
    const x=139+i*234,n=clamp(s.n1[i],0,1),a=(-135+n*270)*DEG;
    c.strokeStyle='#e3e8e9';c.lineWidth=3;c.beginPath();c.arc(x,144,79,-225*DEG,45*DEG);c.stroke();
    c.strokeStyle='#75db94';c.lineWidth=5;c.beginPath();c.arc(x,144,86,-225*DEG,(-225+s.throttle[i]*270)*DEG);c.stroke();
    line(c,x,144,x+Math.sin(a)*72,144-Math.cos(a)*72,'#ffffff',3);
    text(c,(n*100).toFixed(1),x,189,30);text(c,'N1 %',x,229,18);
    text(c,s.failed[i]?'FAIL':s.reverse>0?'REV':'',x,62,22,s.failed[i]?'#ffb24c':'#71e5a1');
    text(c,'EGT',x,281,18);text(c,(s.egt[i]*100).toFixed(0)+' %',x,316,26);
    c.fillStyle='#29383d';c.fillRect(x-75,335,150,9);c.fillStyle='#d5e5dc';c.fillRect(x-75,335,clamp(s.egt[i],0,1)*150,9);
    text(c,'N2    --',x,394,18);text(c,'FF    --',x,434,18);
  }
  text(c,'EGT NORMALIZED',256,481,15,'#a8b8bc');c.restore();
}
function drawCdu(c,s,i) {
  c.save();c.translate(1536+i*256,0);c.fillStyle='#030c0c';c.fillRect(0,0,256,256);
  text(c,'APPROACH REF',128,29,19,'#ffffff');text(c,'CONDOR 700',128,53,13,'#a9b8ae');
  text(c,'FLAPS       VREF',128,88,17,'#ffffff');text(c,s.flapLabel+'       '+Math.round(s.vref),128,120,23,'#75e8a1');
  text(c,'RADIO ALT',128,155,15,'#ffffff');text(c,String(Math.round(Math.max(0,s.radioAlt)))+' FT',128,181,20,'#75e8a1');
  text(c,'<INDEX       REF>',128,233,16,'#ffffff');c.restore();
}
function drawIndicators(c,s) {
  c.fillStyle=s.gearTransit?'#cb3029':'#180e0c';c.fillRect(0,768,256,64);
  text(c,'GEAR TRANSIT',128,810,24,s.gearTransit?'#fff1d2':'#705749');
  c.fillStyle=s.spoilerArmed?'#28583e':'#091510';c.fillRect(256,768,256,64);
  text(c,'SPEEDBRAKE ARMED',384,807,20,s.spoilerArmed?'#b7f7b6':'#4b6658');
  c.save();c.translate(512,512);c.fillStyle='#061014';c.fillRect(0,0,256,256);
  circle(c,128,128,105);text(c,'FLAPS',128,213,20);
  for(let i=0;i<9;i++) {
    const a=(-135+i*270/8)*DEG;
    line(c,128+Math.sin(a)*91,128-Math.cos(a)*91,128+Math.sin(a)*103,128-Math.cos(a)*103);
  }
  const a=(-135+clamp(s.flap,0,1)*270)*DEG;
  line(c,124,128,124+Math.sin(a)*85,128-Math.cos(a)*85,'#ffffff',4);
  line(c,133,128,133+Math.sin(a)*76,128-Math.cos(a)*76,'#80dd9b',3);
  text(c,s.flapLabel,128,173,21,'#ffffff');c.restore();
}
