// The Sea Hornet cockpit: an F/A-18 class single-seat carrier fighter under a bubble
// canopy. A centre control STICK with a pistol grip, rudder pedals, a HOTAS twin
// THROTTLE on the left console (two levers side by side, moved together), a HUD glass
// above the glareshield with green symbology (airspeed, altitude, heading, the
// velocity vector, AoA bracket and the E-bracket for the approach, radar altitude),
// an up-front control below the HUD, two DDI screens (left and right, canvas
// displays with menus around the edge) and a MPCD lower centre, standby round
// instruments (airspeed, attitude, altimeter) between them, the gear handle with the
// wheel knob on the left of the panel with three green gear lights, the HOOK handle
// on the right, an AoA indexer (three lights: slow/on-speed/fast) on the left canopy
// bow, master caution, the canopy rail and frame all round, an ejection seat with
// headbox and harness, the canted DDI bezels, and the nose of the aircraft visible
// ahead over the glareshield. Night: the HUD and DDIs glow, the panel is flood-lit.
//
// THE CONTRACT is the same as skylark.js - read that header first; it is the spec.
//   export function buildCockpit(def, ctx) -> { group, parts, update(state), look }
// Body frame, built around ctx.eye (= def.eye). Control signs as in common.js:
// elevator > 0 = stick back (stick.rotation.x = +), aileron > 0 = stick right
// (stick.rotation.z = -), rudder > 0 = right pedal forward, throttle 1 = levers
// forward. Gear handle down for gearCmd 1, lights follow gearLocked[] (nose, left,
// right); hook handle down for hookCmd 1. The AoA indexer follows aoa against
// onSpeedAoA (8.1 deg): amber doughnut on speed, green chevron slow, red chevron fast.
// This aircraft's parts: stick, pedalL, pedalR, throttle[2], gearLever, gearLights[3],
// hookLever, hudGlass (a transparent mesh with a canvas display), asi, alt, vsi, turn,
// hdgCard, attitude, rpm[2], stallLight, panel, glareshield, seat, windshield.
// The HUD and DDIs are canvas textures uploaded at <= 20 Hz via makeDisplay() (never
// per frame). look: a bubble canopy - the head turns almost all the way round and
// far up.
// Budget at ctx.detail 'high': <= 80k triangles, <= 20 draw calls; no Math.random;
// name every material; no at* uniforms. Keep this header.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DEG, clamp } from '../../config.js';
import { mat, makeDisplay } from './common.js';

export function buildCockpit(def, ctx) {
  const group = new THREE.Group(), parts = {}, low = ctx.detail === 'low';
  const seg = low ? 12 : ctx.detail === 'high' ? 32 : 20;
  const ey = ctx.eye.y, ez = ctx.eye.z, pz = ez - .7, top = ey - .16;
  const dark = 0x181c1e, panel = 0x353b3e, metal = 0x89908c, ivory = 0xd3d4bd;
  const solid = mat('hornet:cockpit:structure', 0xffffff, { roughness: .78, metalness: .18, emissive: 0x9bbcac, emissiveIntensity: 0, extra: { vertexColors: true } });
  const glass = mat('hornet:cockpit:canopy', 0xa8bdc6, { transparent: true, opacity: .12, roughness: .12, side: THREE.DoubleSide });
  const atlas = faceAtlas();
  const faces = mat('hornet:cockpit:faces-placards', 0xffffff, { roughness: .9, emissive: 0xffffff, emissiveIntensity: .12, extra: { map: atlas, emissiveMap: atlas } });
  const display = makeDisplay(2048, 1024, 20);
  display.texture.generateMipmaps = false;
  display.texture.minFilter = THREE.LinearFilter;
  const screens = new THREE.MeshBasicMaterial({ name: 'hornet:cockpit:displays', map: display.texture });
  const hudMat = new THREE.MeshBasicMaterial({ name: 'hornet:cockpit:hud', map: display.texture, transparent: true, depthWrite: false });
  const S = [], F = [], G = [], D = [], movingFaces = [];
  function add(batch, geo, color = 0xffffff) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (batch !== F && batch !== D) {
      const c = new THREE.Color(color), a = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < a.length; i += 3) c.toArray(a, i);
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    }
    batch.push(g); if (g !== geo) geo.dispose(); return g;
  }
  function box(b, x, y, z, w, h, d, color = dark, rx = 0) { add(b, new THREE.BoxGeometry(w, h, d).rotateX(rx).translate(x, y, z), color); }
  function rod(b, a, end, r, color = metal) {
    const v = new THREE.Vector3(...a), w = new THREE.Vector3(...end), delta = w.clone().sub(v);
    const geo = new THREE.CylinderGeometry(r, r, delta.length(), low ? 6 : 10);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()));
    geo.translate(...v.add(w).multiplyScalar(.5).toArray()); add(b, geo, color);
  }
  function quad(b, points, color = 0xffffff) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0,0,1,0,1,1,0,1],2));
    g.setIndex([0,1,2,0,2,3]); g.computeVertexNormals(); add(b,g,color);
  }
  function ring(b,x,y,z,r,t=.003,color=dark) { add(b,new THREE.TorusGeometry(r,t,low?4:6,seg).translate(x,y,z),color); }
  function finish(b, material, name, parent = group) {
    const g = mergeGeometries(b, false); for (const geo of b) geo.dispose();
    const m = new THREE.Mesh(g, material); m.name = name; parent.add(m); return m;
  }
  function moving(name,x,y,z,build) {
    const n = new THREE.Group(); n.name = name; n.position.set(x,y,z); group.add(n);
    const b=[]; build(b); finish(b,solid,name+':geometry',n); return n;
  }
  function uvRect(g,x,y,w,h,aw=2048,ah=1024) {
    const uv=g.attributes.uv;
    for(let i=0;i<uv.count;i++) uv.setXY(i,(x+uv.getX(i)*w)/aw,1-(y+(1-uv.getY(i))*h)/ah);
    return g;
  }
  function tileGeo(g,tile) { return uvRect(g,(tile%4)*256+2,Math.floor(tile/4)*256+2,252,252,1024,1024); }
  function face(tile,x,y,z,w,h=w,round=false) {
    add(F,tileGeo(round?new THREE.CircleGeometry(w/2,seg):new THREE.PlaneGeometry(w,h),tile).translate(x,y,z));
  }
  // Match the real exterior's sill stations; the padded inner rail rises above it.
  const stations=[[-5.84,.62,.49,.90],[-5.45,.68,.49,1.08],[-4.9,.70,.50,1.10],[-4.35,.64,.51,.91],[-3.85,.47,.54,.49],[-3.51,.045,.58,.02]];
  for(let k=0;k<stations.length-1;k++) {
    const a=stations[k],b=stations[k+1];
    for(let j=0;j<seg;j++) {
      const p=(s,t)=>[s[1]*Math.cos(t),s[2]+s[3]*Math.sin(t),s[0]];
      quad(G,[p(a,j*Math.PI/seg),p(a,(j+1)*Math.PI/seg),p(b,(j+1)*Math.PI/seg),p(b,j*Math.PI/seg)]);
    }
    for(const side of [-1,1]) rod(S,[side*a[1],a[2],a[0]],[side*b[1],b[2],b[0]],.032,panel);
  }
  for(const side of [-1,1]) {
    box(S,side*.58,.70,-5.25,.055,.05,1.35,panel);
    box(S,side*.57,.19,-5.27,.08,.57,1.55,panel);
    box(S,side*.43,.32,-5.3,.23,.10,1.08,panel);
    box(S,side*.43,.377,-5.23,.208,.012,.88,dark);
    for(let i=0;i<(low?10:24);i++) {
      const x=side*(.365+(i%3)*.055),z=-5.72+Math.floor(i/3)*.092;
      box(S,x,.39,z,.025,.012,.026,panel);
      rod(S,[x,.398,z],[x,.420,z-.008],.003,metal);
    }
    for(let i=0;i<8;i++) box(S,side*.568,.718,-5.82+i*.16,.014,.003,.009,metal);
    rod(S,[side*.55,.64,-4.94],[side*.55,.64,-4.70],.012,metal);
  }
  // Three planar windscreen panes; bow endpoints follow the exterior envelope.
  const a=[-.31,.62,-6.55],b=[.31,.62,-6.55],c=[.30,1.285,-5.89],d=[-.30,1.285,-5.89];
  quad(G,[a,b,c,d]);
  for(const side of [-1,1]) {
    const lower=[side*.57,.49,-6.15],rear=[side*.62,.49,-5.89];
    const front=side<0?a:b,upper=side<0?d:c;
    quad(G,[front,lower,rear,upper]);
    rod(S,front,upper,.014,dark);rod(S,front,lower,.018,panel);rod(S,lower,rear,.025,panel);
  }
  for(let j=0;j<seg;j++) {
    const t=j*Math.PI/seg,u=(j+1)*Math.PI/seg;
    rod(S,[.636*Math.cos(t),.49+.914*Math.sin(t),-5.865],[.636*Math.cos(u),.49+.914*Math.sin(u),-5.865],.022,dark);
    // Structural arch aft of the pilot's head; no bar across the bubble roof.
    rod(S,[.64*Math.cos(t),.51+.91*Math.sin(t),-4.35],[.64*Math.cos(u),.51+.91*Math.sin(u),-4.35],.013,panel);
  }
  for(const x of [-.36,0,.36]) {
    const y=x===0?1.34:1.19;
    box(S,x,y,-5.82,.145,.065,.024,dark);
    box(S,x,y,-5.805,.127,.050,.002,0x819297);
    rod(S,[x,y+.025,-5.825],[x,y+.060,-5.865],.006,metal);
  }
  // The exterior hides its radome with the fuselage. Restore the visible upper deck.
  const nose=[[-8.7,.008,-.26],[-8.45,.18,-.10],[-7.9,.40,.17],[-7.15,.61,.39],[-6.5,.73,.48]];
  for(let i=0;i<nose.length-1;i++) {
    const n=nose[i],m=nose[i+1];
    quad(S,[[-n[1],n[2],n[0]],[n[1],n[2],n[0]],[m[1],m[2],m[0]],[-m[1],m[2],m[0]]],0x656e72);
  }
  box(S,0,-.07,-5.25,1.04,.045,1.95,dark);
  box(S,0,.52,pz-.055,1.05,.51,.10,panel);
  box(S,0,top-.008,pz-.115,1.08,.035,.28,dark);
  rod(S,[-.53,top,pz+.012],[.53,top,pz+.012],.012,dark);
  // Ejection seat: olive cushions, metal rails, webbing, headbox and striped handle.
  box(S,0,.23,ez+.18,.46,.12,.52,0x474b37);
  box(S,0,.57,ez+.43,.44,.66,.10,0x474b37,-.13);
  box(S,0,1.035,ez+.49,.29,.24,.15,dark);
  for(const side of [-1,1]) {
    rod(S,[side*.25,.06,ez+.48],[side*.25,1.09,ez+.52],.021,panel);
    box(S,side*.12,.65,ez+.359,.047,.52,.012,0x9e9b7f,-.13);
    box(S,side*.16,.301,ez+.15,.043,.015,.39,0x9e9b7f);
    box(S,side*.10,.36,ez+.30,.055,.048,.018,metal);
  }
  add(S,new THREE.TorusGeometry(.051,.009,6,seg).rotateX(Math.PI/2).translate(0,.32,ez-.04),0xd5ac35);
  for(let i=0;i<6;i++) { const t=i*Math.PI/3;box(S,.049*Math.cos(t),.328,ez-.04+.049*Math.sin(t),.014,.004,.011,dark); }
  // Stick positive X rotation carries its upward grip aft. Throttles use downward
  // cranks so the prescribed negative X rotation carries their grips forward.
  for(let i=0;i<5;i++) box(S,0,.02+i*.021,ez-.31,.16-i*.017,.021,.16-i*.017,dark);
  parts.stick=moving('stick',0,.10,ez-.31,b=>{
    rod(b,[0,0,0],[0,.26,0],.015,panel);box(b,0,.318,.011,.052,.135,.055,dark,-.16);
    box(b,0,.333,-.025,.024,.043,.012,metal);box(b,-.019,.363,.039,.014,.015,.009,0xa9332b);
    box(b,.015,.378,.036,.022,.012,.013,metal);box(b,.027,.350,.015,.014,.023,.023,panel);
  });
  for(const side of [-1,1]) {
    const n=moving(side<0?'pedalL':'pedalR',side*.14,.035,pz+.14,b=>{
      box(b,0,.045,0,.11,.14,.025,metal,-.30);box(b,0,-.030,.035,.12,.018,.08,dark);
      for(let j=0;j<4;j++)box(b,0,.003+j*.027,.018,.083,.005,.008,dark);
    }); n.userData.z0=n.position.z;parts[side<0?'pedalL':'pedalR']=n;
  }
  parts.throttle=[];
  for(let i=0;i<2;i++) {
    const x=-.475+i*.075;
    box(S,x,.397,ez-.02,.040,.015,.34,dark);
    box(S,x,.408,ez-.13,.046,.018,.018,metal);
    parts.throttle.push(moving('throttle:'+i,x,.54,ez-.02,b=>{
      rod(b,[0,0,0],[0,-.12,0],.009,metal);box(b,0,-.12,0,.065,.055,.10,dark);
      box(b,0,-.083,.010,.042,.012,.044,panel);rod(b,[0,-.15,.022],[0,-.18,.051],.006,metal);
      box(b,-.034,-.114,-.025,.012,.019,.026,ivory);
    }));
  }
  parts.gearLever=moving('gearLever',-.467,.60,pz+.032,b=>{
    rod(b,[0,0,0],[0,-.065,.035],.008,metal);ring(b,0,-.072,.042,.024,.006,ivory);
    rod(b,[-.019,-.072,.042],[.019,-.072,.042],.003,metal);
  });parts.gearLever.userData.y0=parts.gearLever.position.y;
  parts.hookLever=moving('hookLever',.468,.53,pz+.033,b=>{
    rod(b,[0,0,0],[0,-.075,.024],.007,metal);box(b,0,-.08,.025,.043,.038,.025,ivory);
    rod(b,[.009,-.069,.04],[.009,-.092,.04],.003,dark);rod(b,[.009,-.092,.04],[-.01,-.092,.04],.003,dark);
  });
  const flapSwitch=moving('flapSwitch',-.39,.39,ez-.47,b=>{rod(b,[0,0,0],[0,.045,0],.004,metal);box(b,0,.047,0,.022,.015,.022,ivory);});
  // Screens and their canted bezels share one atlas, one opaque draw.
  function screen(x,y,w,h,rect,cant=0) {
    const transform=new THREE.Matrix4().makeRotationY(cant);transform.setPosition(x,y,pz+.029);
    const frame=[];
    box(frame,0,0,-.015,w+.044,h+.044,.035,dark);
    for(let j=0;j<5;j++)for(const side of [-1,1]) {
      box(frame,(j-2)*w/5,side*(h/2+.013),.009,.022,.014,.010,panel);
      box(frame,side*(w/2+.013),(j-2)*h/5,.009,.014,.022,.010,panel);
    }
    for(const g of frame){g.applyMatrix4(transform);S.push(g);}
    add(D,uvRect(new THREE.PlaneGeometry(w,h),...rect).applyMatrix4(transform));
  }
  screen(-.285,.635,.245,.215,[514,2,508,508],.08);
  screen(.285,.635,.245,.215,[1026,2,508,508],-.08);
  screen(0,.365,.195,.148,[1538,2,508,508]);
  box(S,0,.670,pz+.012,.225,.21,.025,dark);
  add(D,uvRect(new THREE.PlaneGeometry(.185,.033),2,514,508,124).translate(0,.739,pz+.030));
  for(let i=0;i<12;i++) {
    const x=(i%3-1)*.043,y=.691-Math.floor(i/3)*.028;
    box(S,x,y,pz+.033,.033,.022,.013,panel);
    face(8,x,y,pz+.041,.025,.015);
  }
  for(const side of [-1,1])for(let j=0;j<3;j++) {
    add(S,new THREE.CylinderGeometry(.014,.014,.012,12).rotateX(Math.PI/2).translate(side*.097,.69-j*.045,pz+.036),dark);
  }
  // Console placards are horizontal, readable when looking down to either side.
  for(const side of [-1,1])add(F,tileGeo(new THREE.PlaneGeometry(.18,.28),side<0?9:10).rotateX(-Math.PI/2).translate(side*.43,.389,ez+.26));
  face(11,-.465,.701,pz+.013,.080,.052);face(12,.468,.617,pz+.013,.077,.043);
  face(13,0,top+.014,pz+.037,.090,.022);
  // One merged atlas mesh contains static faces AND independently transformed
  // needles/cards. Only their small position ranges change, never the texture.
  let faceVertices=0;
  function instrumentPart(name,x,y,z,geo,tile) {
    const node=new THREE.Group();node.name=name;node.position.set(x,y,z);group.add(node);
    const g=add(F,tileGeo(geo,tile));
    movingFaces.push({node,geo:g,local:g.attributes.position.array.slice(),offset:0});return node;
  }
  const positions=[[-.19,.468],[0,.478],[.19,.468],[-.29,.351],[.29,.351],[-.095,.257],[.095,.257]];
  const tiles=[0,1,2,3,4,5,5];
  for(let i=0;i<positions.length;i++) {
    const [x,y]=positions[i],r=i<3?.038:.031;
    face(tiles[i],x,y,pz+.014,r*2,r*2,true);ring(S,x,y,pz+.019,r,.004);
    for(const side of [-1,1])box(S,x+side*r*.82,y+r*.83,pz+.019,.004,.004,.003,metal);
  }
  function needle(name,x,y,length,z=pz+.026) {
    return instrumentPart(name,x,y,z,new THREE.PlaneGeometry(.0028,length).translate(0,length*.40,0),7);
  }
  parts.asi=needle('asi',-.19,.468,.029);parts.alt=needle('alt',.19,.468,.029);
  parts.altThousands=needle('altThousands',.19,.468,.019,pz+.029);
  parts.turn=needle('turn',-.29,.351,.024);parts.vsi=needle('vsi',.29,.351,.024);
  parts.rpm=[needle('rpm:0',-.095,.257,.023),needle('rpm:1',.095,.257,.023)];
  parts.hdgCard=instrumentPart('hdgCard',.405,.348,pz+.022,new THREE.CircleGeometry(.030,seg),6);
  ring(S,.405,.348,pz+.025,.031,.004);box(S,.405,.376,pz+.028,.002,.01,.002,ivory);
  // Ball lives in its own fixed frame. Its local Y is pitch travel, per contract.
  const attitudeFrame=new THREE.Group();attitudeFrame.position.set(0,.478,pz+.024);group.add(attitudeFrame);
  parts.attitude=instrumentPart('attitude',0,0,0,new THREE.CircleGeometry(.028,seg),14);
  attitudeFrame.add(parts.attitude);
  // Opaque aperture annulus conceals the edge of the sliding ball.
  add(S,new THREE.RingGeometry(.022,.037,seg).translate(0,.478,pz+.031),dark);
  box(S,-.012,.478,pz+.034,.014,.002,.002,ivory);box(S,.012,.478,pz+.034,.014,.002,.002,ivory);
  for(const g of F) {
    for(const item of movingFaces)if(item.geo===g)item.offset=faceVertices;
    faceVertices+=g.attributes.position.count;
  }
  const instrumentMesh=finish(F,faces,'standby-instruments-and-placards');
  instrumentMesh.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
  // Conservative fixed bounds include every needle rotation and horizon travel.
  instrumentMesh.geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(0,.5,-5.5),2);
  const temp=new THREE.Vector3(),matrix=new THREE.Matrix4();
  function syncInstruments() {
    const p=instrumentMesh.geometry.attributes.position;
    for(let i=0;i<movingFaces.length;i++) {
      const item=movingFaces[i],n=item.node;n.updateMatrix();matrix.copy(n.matrix);
      if(n===parts.attitude){attitudeFrame.updateMatrix();matrix.premultiply(attitudeFrame.matrix);}
      for(let j=0;j<item.local.length;j+=3) {temp.fromArray(item.local,j).applyMatrix4(matrix);p.setXYZ(item.offset+j/3,temp.x,temp.y,temp.z);}
    }
    p.needsUpdate=true;
  }
  // Seven independent emissive warning meshes: three gear, three AoA, one stall.
  function lamp(name,color,x,y,w,h,shape=0) {
    const m=mat('hornet:cockpit:'+name,0x18201a,{emissive:color,emissiveIntensity:0});
    let geo;
    if(shape===1)geo=new THREE.TorusGeometry(w/2,w*.16,6,seg);
    else if(shape===2||shape===3) {
      const sign=shape===2?1:-1,s=new THREE.Shape();
      s.moveTo(-w/2,-sign*h/2);s.lineTo(0,sign*h/2);s.lineTo(w/2,-sign*h/2);s.lineTo(w/2,-sign*h/2+sign*.005);s.lineTo(0,sign*(h/2-.005));s.lineTo(-w/2,-sign*h/2+sign*.005);s.closePath();geo=new THREE.ShapeGeometry(s);
    } else geo=new THREE.PlaneGeometry(w,h);
    const mesh=new THREE.Mesh(geo,m);mesh.name=name;mesh.position.set(x,y,pz+.042);group.add(mesh);return mesh;
  }
  parts.gearLights=[];parts.gearLightMats=[];
  for(let i=0;i<3;i++) {const l=lamp('gear:'+i,0x52ee76,-.465+(i-1)*.021,.653,.012,.012);parts.gearLights.push(l);parts.gearLightMats.push(l.material);}
  const indexer=[];
  box(S,-.405,.972,-5.925,.048,.135,.025,dark);
  for(let i=0;i<3;i++) {
    const l=lamp('aoa:'+i,i===0?0x5cf786:i===1?0xffbd43:0xff4131,-.405,1.013-i*.041,.025,.022,i===0?3:i===1?1:2);
    l.position.z=-5.906;indexer.push(l);
  }
  parts.stallLight=lamp('stall',0xff9c36,0,top+.013,.083,.018);
  // HUD is a 16 cm combiner only 25 cm ahead: enough angular field for an 8.1
  // degree approach vector. Pixel projection uses that exact optical distance.
  const hudZ=ez-.25;
  parts.hudGlass=new THREE.Mesh(uvRect(new THREE.PlaneGeometry(.16,.16),0,0,512,512),hudMat);
  parts.hudGlass.name='hud-combiner';parts.hudGlass.position.set(ctx.eye.x,ey,hudZ);group.add(parts.hudGlass);
  for(const side of [-1,1]) {
    rod(S,[side*.070,top,pz+.08],[side*.076,ey-.082,hudZ],.006,dark);
    rod(S,[side*.079,ey-.080,hudZ],[side*.079,ey+.080,hudZ],.003,metal);
  }
  box(S,0,top+.01,pz+.10,.14,.035,.13,dark);
  // Transit and hook status use spare atlas rectangles, with no extra lamp draw.
  add(D,uvRect(new THREE.PlaneGeometry(.049,.016),514,514,252,60).translate(-.467,.615,pz+.044));
  add(D,uvRect(new THREE.PlaneGeometry(.060,.018),770,514,252,60).translate(.468,.574,pz+.044));
  parts.panel=parts.glareshield=parts.seat=finish(S,solid,'tub-seat-panel-controls-and-canopy-frames');
  parts.windshield=finish(G,glass,'fixed-windscreen-and-bubble');
  finish(D,screens,'DDIs-MPCD-UFC-annunciators');
  let state;
  const draw=c=>drawDisplays(c,state);
  function update(s) {
    parts.stick.rotation.x=s.elevator*15*DEG;parts.stick.rotation.z=-s.aileron*15*DEG;
    parts.pedalR.position.z=parts.pedalR.userData.z0-s.rudder*.07;parts.pedalL.position.z=parts.pedalL.userData.z0+s.rudder*.07;
    for(let i=0;i<2;i++){parts.throttle[i].rotation.x=(30-60*s.throttle[i])*DEG;parts.rpm[i].rotation.z=-clamp(s.n1[i],0,1)*270*DEG;}
    parts.gearLever.position.y=parts.gearLever.userData.y0-(s.gearCmd?.04:0);
    parts.hookLever.rotation.x=(s.hookCmd?30:-30)*DEG;
    flapSwitch.rotation.x=(-25+50*s.flapDetent/Math.max(1,def.flaps.detents.length-1))*DEG;
    parts.asi.rotation.z=-clamp(s.ias/800,0,1)*300*DEG;
    parts.alt.rotation.z=-(s.alt%1000)/1000*Math.PI*2;parts.altThousands.rotation.z=-(s.alt%10000)/10000*Math.PI*2;
    parts.vsi.rotation.z=(90-clamp(s.vs/6000,-1,1)*150)*DEG;parts.turn.rotation.z=-clamp(s.beta/10,-1,1)*30*DEG;
    parts.hdgCard.rotation.z=s.heading*DEG;parts.attitude.rotation.z=-s.roll*DEG;parts.attitude.position.y=clamp(-s.pitch,-25,25)*.00020;
    for(let i=0;i<3;i++)parts.gearLightMats[i].emissiveIntensity=s.gearLocked[i]?1.4:0;
    const error=s.aoa-(s.onSpeedAoA||def.approach.onSpeedAoA);
    indexer[0].material.emissiveIntensity=error>.7?1.6:0;
    indexer[1].material.emissiveIntensity=Math.abs(error)<=.7?1.6:0;
    indexer[2].material.emissiveIntensity=error<-.7?1.6:0;
    parts.stallLight.material.emissiveIntensity=s.stallWarning&&Math.floor(s.t*4)%2===0?1.5:0;
    const night=1-clamp(s.dayness??1,0,1);solid.emissiveIntensity=night*.065;faces.emissiveIntensity=.10+night*.45;glass.opacity=.12+night*.07;
    syncInstruments();state=s;display.tick(s.t,draw);
  }
  syncInstruments();
  return {group,parts,update,look:{yaw:3.0,pitch:1.3}};
}

function line(c,x,y,u,v) {c.beginPath();c.moveTo(x,y);c.lineTo(u,v);c.stroke();}
function text(c,s,x,y,size=20) {c.font=`${size}px monospace`;c.fillText(s,x,y);}
function circle(c,x,y,r) {c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.stroke();}

// Immutable 1024 square, sixteen 256 px tiles. The white tile also paints all
// mechanical needles, letting their animated vertices share the placard draw.
function faceAtlas() {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1024;
  const c=canvas.getContext('2d');c.fillStyle='#101718';c.fillRect(0,0,1024,1024);
  const titles=['KNOTS','ATT','ALT FT','TURN','VSI x1000','N1 %','COMPASS','','ENT','FUEL / FLAPS','SENSORS / COMM','GEAR','HOOK','STALL','HORIZON','SEA HORNET'];
  for(let i=0;i<16;i++) {
    c.save();c.translate((i%4)*256+128,Math.floor(i/4)*256+128);
    c.fillStyle='#d1d8c4';c.strokeStyle='#d1d8c4';c.textAlign='center';c.lineWidth=2;
    if(i<=6) {
      circle(c,0,0,117);
      for(let j=0;j<40;j++) {
        const a=(i===4?-240+j*7.5:j*7.5)*DEG;
        line(c,Math.sin(a)*110,-Math.cos(a)*110,Math.sin(a)*(j%5?102:93),-Math.cos(a)*(j%5?102:93));
        if(j%5===0&&i!==1&&i!==3&&i!==6)text(c,String(i===0?j*20:i===2?j/4:i===4?Math.round((j-20)*.3):Math.round(j*2.5)),Math.sin(a)*77,-Math.cos(a)*77+5,17);
      }
      if(i===6)for(let d=0;d<360;d+=30){const a=d*DEG;text(c,d===0?'N':d===90?'E':d===180?'S':d===270?'W':String(d/10),Math.sin(a)*79,-Math.cos(a)*79+6,24);}
      else text(c,titles[i],0,48,19);
    } else if(i===7){c.fillRect(-128,-128,256,256);}
    else if(i===14) {
      c.fillStyle='#446d80';c.fillRect(-128,-128,256,128);c.fillStyle='#725b3c';c.fillRect(-128,0,256,128);
      line(c,-128,0,128,0);for(let p=-20;p<=20;p+=10)if(p)line(c,-35,-p*.914,35,-p*.914);
    } else {
      text(c,titles[i],0,-79,23);
      if(i===9){text(c,'AUTO HALF FULL',0,-25,19);text(c,'MIL  /  MAX',0,20,22);text(c,'FUEL   --',0,66,23);text(c,'PROBE  DUMP',0,105,20);}
      if(i===10){text(c,'RADAR  FLIR',0,-22,22);text(c,'COMM 1 / 2',0,20,23);text(c,'VOL  SQL  IFF',0,65,20);text(c,'OBOGS   ON',0,105,21);}
      if(i===11)text(c,'N   L   R',0,31,27);
      if(i===12)text(c,'DN',0,35,40);
      if(i===13){c.fillStyle='#f0be65';text(c,'STALL',0,28,55);}
      if(i===8)text(c,'•',0,28,42);
    }
    c.restore();
  }
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;return texture;
}

function drawDisplays(c,s) {
  c.clearRect(0,0,2048,1024);
  c.strokeStyle='#8cff9c';c.fillStyle='#8cff9c';c.lineWidth=2;c.textAlign='center';
  // Atlas HUD tile: waterline (256,256) is exactly the eye's forward ray.
  c.save();c.beginPath();c.rect(2,2,508,508);c.clip();
  const scale=.25/.16*512;
  for(let h=Math.floor(s.heading/10)*10-30;h<=s.heading+30;h+=10) {
    const x=256+(h-s.heading)*6;line(c,x,37,x,47);text(c,String((h+360)%360).padStart(3,'0'),x,28,17);
  }
  c.strokeRect(229,49,54,25);text(c,String(Math.round(s.heading)%360).padStart(3,'0'),256,68,20);
  c.strokeRect(10,204,81,30);text(c,String(Math.round(s.ias)),50,226,24);
  c.strokeRect(399,204,103,30);text(c,String(Math.round(s.alt)),450,226,23);text(c,'R '+Math.round(Math.max(0,s.radioAlt)),449,258,19);
  c.save();c.beginPath();c.rect(99,85,297,357);c.clip();c.translate(256,256);c.rotate(-s.roll*DEG);
  for(let p=-80;p<=80;p+=5) {
    const y=scale*Math.tan((s.pitch-p)*DEG);
    if(Math.abs(s.pitch-p)>40)continue;
    const w=p%10===0?69:40;
    line(c,-w,y,-19,y);line(c,19,y,w,y);
    if(p%10===0){text(c,String(p),-w-17,y+5,16);text(c,String(p),w+17,y+5,16);}
  }c.restore();
  line(c,235,256,249,256);line(c,249,256,256,261);line(c,256,261,263,256);line(c,263,256,277,256);
  const fx=256+scale*Math.tan(-s.beta*DEG),fy=256+scale*Math.tan(s.aoa*DEG);
  circle(c,fx,fy,9);line(c,fx-24,fy,fx-9,fy);line(c,fx+9,fy,fx+24,fy);line(c,fx,fy-9,fx,fy-19);
  const error=s.aoa-(s.onSpeedAoA||8.1),by=fy-clamp(error,-8,8)*12,bx=fx-40;
  line(c,bx,by-17,bx,by+17);line(c,bx,by-17,bx+12,by-17);line(c,bx,by,bx+9,by);line(c,bx,by+17,bx+12,by+17);
  text(c,'VS '+Math.round(s.vs),437,410,18);text(c,s.gload.toFixed(1)+' G',48,410,19);
  text(c,'AOA '+s.aoa.toFixed(1),256,457,20);
  if(s.ils) {
    line(c,256+clamp(s.ilsLoc,-2.5,2.5)*26,289,256+clamp(s.ilsLoc,-2.5,2.5)*26,330);
    line(c,232,309+clamp(s.ilsGs,-2.5,2.5)*20,280,309+clamp(s.ilsGs,-2.5,2.5)*20);
    text(c,'ILS',256,98,18);
  }
  text(c,s.hook>.9?'HOOK':'',77,478,20);text(c,s.gearTransit?'GEAR TRANS':s.gear>.99?'GEAR DN':'',368,478,19);c.restore();
  // Left engine, right HSI, lower MPCD. All upload with the HUD at 20 Hz.
  for(let page=0;page<3;page++) {
    c.save();c.translate(512+page*512,0);c.fillStyle='#04100c';c.fillRect(0,0,512,512);
    c.fillStyle='#95eaaa';c.strokeStyle='#95eaaa';c.lineWidth=2;
    for(let i=0;i<5;i++)for(const side of [-1,1]) {
      c.strokeRect(68+i*78,side<0?9:480,62,22);c.strokeRect(side<0?8:480,68+i*78,23,60);
    }
    text(c,page===0?'ENG':page===1?'HSI':'LANDING CHECK',256,62,23);
    if(page===0) {
      for(let i=0;i<2;i++) {
        const x=157+i*198;circle(c,x,161,58);
        const a=clamp(s.n1[i],0,1)*270*DEG;
        line(c,x,161,x+Math.sin(a)*49,161-Math.cos(a)*49);
        text(c,s.failed[i]?'FAIL':'N1',x,89,23);text(c,(s.n1[i]*100).toFixed(1),x,243,35);
        text(c,'EGT %',x,300,22);text(c,(s.egt[i]*100).toFixed(0),x,339,31);
      }
      text(c,'FUEL  --',256,413,28);text(c,'FF  --    N2  --',256,446,19);
    } else if(page===1) {
      circle(c,256,256,153);
      for(let d=0;d<360;d+=5) {
        const a=(d-s.heading)*DEG,r=d%30?145:135;
        line(c,256+Math.sin(a)*r,256-Math.cos(a)*r,256+Math.sin(a)*153,256-Math.cos(a)*153);
        if(d%30===0)text(c,d===0?'N':d===90?'E':d===180?'S':d===270?'W':String(d/10),256+Math.sin(a)*116,262-Math.cos(a)*116,21);
      }
      line(c,256,239,256,276);line(c,236,261,276,261);
      text(c,'HDG '+String(Math.round(s.heading)%360).padStart(3,'0'),256,95,22);
      text(c,'SHIP BRG  ---',256,441,21);
      if(s.ils){line(c,256+clamp(s.ilsLoc,-2.5,2.5)*25,200,256+clamp(s.ilsLoc,-2.5,2.5)*25,310);text(c,'ILS LOC',256,405,19);}
    } else {
      text(c,s.gearTransit?'GEAR   TRANSIT':s.gear>.99?'GEAR   DOWN':'GEAR   UP',256,138,26);
      text(c,'FLAPS  '+s.flapLabel,256,198,26);text(c,s.hook>.9?'HOOK   DOWN':'HOOK   UP',256,258,26);
      text(c,'AOA   '+s.aoa.toFixed(1),256,318,26);text(c,'VREF  '+Math.round(s.vref),256,378,26);
      text(c,'FUEL   --',256,437,23);
    }c.restore();
  }
  c.fillStyle='#08140d';c.fillRect(0,512,512,128);c.fillStyle='#a7f5ac';text(c,'COMM 1  ---   ILS '+(s.ils?'ON':'--'),256,589,29);
  c.fillStyle=s.gearTransit?'#cf352a':'#26130e';c.fillRect(512,512,256,64);
  c.fillStyle='#f2c8a0';text(c,'TRANSIT',640,554,30);
  c.fillStyle=s.hook>.9?'#287941':'#102015';c.fillRect(768,512,256,64);c.fillStyle='#b3efb1';text(c,'HOOK',896,554,30);
}
