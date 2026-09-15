// The Trailblazer cockpit: a Super Cub / Husky class bush plane, flown solo from the
// front seat of a narrow tandem cabin. A floor-mounted control STICK between the
// knees, rudder pedals with heel brakes, the THROTTLE on the left sidewall (a quadrant
// lever, not a push-pull), the flap handle on the left floor (a Johnson bar: pull up
// through its notches), a trim crank/lever on the left wall, a minimal panel: airspeed,
// altimeter, a turn-and-slip, a compass, tachometer, oil gauges, a few toggle switches
// and a magneto key - no attitude indicator worth the name. Tube-frame structure
// visible inside fabric walls, a big windshield with a sloping skylight above, side
// windows that come down low so the wheels are in view, the wing root and struts just
// outside, the rear seat behind the pilot. Fixed gear: no gear lever or gear lights.
//
// THE CONTRACT is the same as skylark.js - read that header first; it is the spec.
//   export function buildCockpit(def, ctx) -> { group, parts, update(state), look }
// Body frame, built around ctx.eye (= def.eye). Control signs as in common.js:
// elevator > 0 = stick back (stick.rotation.x = +), aileron > 0 = stick right,
// rudder > 0 = right pedal forward, throttle 1 = lever forward, trim > 0 = nose up.
// This aircraft's parts: stick, pedalL, pedalR, throttle[1], flapLever, trimWheel, asi,
// alt, vsi, turn, hdgCard, attitude, rpm[1], stallLight, panel, glareshield, seat,
// windshield. look: a bubble-like cabin; the head turns far.
// Budget at ctx.detail 'high': <= 80k triangles, <= 20 draw calls; instrument faces
// drawn once; readings by needle meshes or makeDisplay() at <= 20 Hz; no Math.random;
// name every material; no at* uniforms. Keep this header.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DEG, clamp, makeRng } from '../../config.js';
import { mat } from './common.js';

// Four by four immutable tiles: instruments, sight gauges and cockpit placards.
function instrumentAtlas() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
  const c = canvas.getContext('2d');
  c.fillStyle = '#171b19'; c.fillRect(0,0,1024,1024);
  for (let tile=0;tile<16;tile++) {
    c.save(); c.translate(tile%4*256+128,Math.floor(tile/4)*256+128);
    c.textAlign='center'; c.textBaseline='middle'; c.fillStyle='#ddd7bc'; c.strokeStyle='#ddd7bc';
    const line=(x,y,u,v,color='#ddd7bc',w=2)=>{c.strokeStyle=color;c.lineWidth=w;c.beginPath();c.moveTo(x,y);c.lineTo(u,v);c.stroke();};
    const label=(s,y,size=13)=>{c.font=`${size}px sans-serif`;c.fillStyle='#ddd7bc';c.fillText(s,0,y);};
    const scale=(max,step,angle)=>{for(let v=0;v<max;v+=step){const a=angle(v);line(Math.sin(a)*112,-Math.cos(a)*112,Math.sin(a)*101,-Math.cos(a)*101);label('',0);c.fillText(String(v),Math.sin(a)*83,-Math.cos(a)*83);}};
    if(tile===0) {
      const a=v=>v/160*300*DEG;
      for(const [lo,hi,r,col] of [[35,80,117,'#ddd7bc'],[42,80,123,'#649563']]){c.strokeStyle=col;c.lineWidth=5;c.beginPath();c.arc(0,0,r,a(lo)-Math.PI/2,a(hi)-Math.PI/2);c.stroke();}
      line(Math.sin(a(130))*103,-Math.cos(a(130))*103,Math.sin(a(130))*125,-Math.cos(a(130))*125,'#cc4939',4);
      scale(161,20,a);label('AIRSPEED',38);label('KNOTS',56,11);
    } else if(tile===1){scale(10,1,v=>v/10*Math.PI*2);label('ALT / FEET',42);label('29.92',66,12);}
    else if(tile===2){label('TURN & SLIP',-64);label('L    2 MIN    R',47);c.fillStyle='#a5a58c';c.fillRect(-65,70,130,16);line(-18,67,-18,89);line(18,67,18,89);}
    else if(tile===3){for(let v=-2000;v<=2000;v+=500){const a=(-90+v/2000*150)*DEG;line(Math.sin(a)*112,-Math.cos(a)*112,Math.sin(a)*100,-Math.cos(a)*100);label('',0);c.fillText(String(Math.abs(v)/1000),Math.sin(a)*80,-Math.cos(a)*80);}label('VERT SPEED',-25,12);label('1000 FT/MIN',27,11);}
    else if(tile===4){scale(31,5,v=>v/30*270*DEG);label('RPM',38);label('x 100',57,11);}
    else if(tile===5){for(let v=0;v<360;v+=30){const a=-v*DEG;line(Math.sin(a)*115,-Math.cos(a)*115,Math.sin(a)*102,-Math.cos(a)*102);label('',0);c.fillText(v%90===0?['N','E','S','W'][v/90]:String(v/10),Math.sin(a)*82,-Math.cos(a)*82);} }
    else if(tile===6||tile===7){scale(tile===6?101:251,tile===6?20:50,v=>v/(tile===6?100:250)*270*DEG);label(tile===6?'OIL PSI':'OIL TEMP F',42,12);line(0,0,75,-20);}
    else if(tile===8){label('FUEL',-99);label('GAL',103);c.fillStyle='#8b8060';c.fillRect(-16,-75,32,150);c.fillStyle='#bb983f';c.fillRect(-10,-12,20,85);for(let i=0;i<5;i++)line(-40,-70+i*35,40,-70+i*35);}
    else { const words={9:['MAGNETOS','OFF  R  L  BOTH','MASTER   LIGHTS','START   CABIN HEAT'],10:['THROTTLE','FWD  FULL','MIXTURE','CARB HEAT'],11:['FLAPS','UP','20','40'],12:['TRIM','NOSE UP','TAKE OFF','NOSE DOWN'],13:['TRAILBLAZER','NO SMOKING','FASTEN HARNESS','CHECK FUEL'],14:['STALL','WARNING'],15:['FUEL SELECTOR','LEFT   BOTH   RIGHT','OFF']}[tile];words.forEach((s,i)=>label(s,-85+i*54,14)); }
    c.restore();
  }
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  texture.anisotropy=4;texture.generateMipmaps=true;texture.minFilter=THREE.LinearMipmapLinearFilter;
  return texture;
}

export function buildCockpit(def, ctx) {
  const group=new THREE.Group(),parts={},low=ctx.detail==='low';
  const segments=low?16:ctx.detail==='high'?40:24;
  const solid=mat('trailblazer:cockpit:paint-fabric-hardware',0xffffff,{roughness:.85,metalness:.08,emissive:0x614124,emissiveIntensity:0,extra:{vertexColors:true}});
  const texture=instrumentAtlas();
  const faces=mat('trailblazer:cockpit:atlas',0xffffff,{roughness:.85,emissive:0xffffff,emissiveIntensity:0,extra:{map:texture,emissiveMap:texture}});
  const glass=mat('trailblazer:cockpit:glass',0xbac9c4,{transparent:true,opacity:.12,roughness:.18,side:THREE.DoubleSide});
  const stallMat=mat('trailblazer:cockpit:stall',0x76251a,{emissive:0xff3820,emissiveIntensity:0});
  const batches={solid:[],faces:[],glass:[]};
  const dark=0x252923,metal=0x99998a,ivory=0xdad5b9,green=0x465348,fabric=0x8c8870,leather=0x514c3d;
  function add(batch, geo, color = 0xffffff) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const rgb = new THREE.Color(color), colors = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) rgb.toArray(colors, i);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3)); batch.push(g);
    if (g !== geo) geo.dispose();
  }
  function box(batch, x, y, z, w, h, d, color = dark, rx = 0) {
    add(batch, new THREE.BoxGeometry(w, h, d).rotateX(rx).translate(x, y, z), color);
  }
  function rod(batch, a, b, radius, color = dark) {
    const av = new THREE.Vector3(...a), bv = new THREE.Vector3(...b), delta = bv.clone().sub(av);
    const geo = new THREE.CylinderGeometry(radius, radius, delta.length(), low ? 6 : 10);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()));
    geo.translate(...av.add(bv).multiplyScalar(.5).toArray()); add(batch, geo, color);
  }
  function disc(batch, x, y, z, r, color = dark) { add(batch, new THREE.CircleGeometry(r, segments).translate(x, y, z), color); }
  function ring(batch, x, y, z, r, tube = .004, color = dark) { add(batch, new THREE.TorusGeometry(r, tube, low ? 4 : 8, segments).translate(x, y, z), color); }
  function quad(batch, points, color = 0xffffff) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals(); add(batch, g, color);
  }
  function atlasGeo(geo, tile) {
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, ((tile % 4) + .02 + uv.getX(i) * .96) / 4, (3 - Math.floor(tile / 4) + .02 + uv.getY(i) * .96) / 4);
    return geo;
  }
  function face(tile, x, y, z, w, h = w, round = true) {
    const geo = round ? new THREE.CircleGeometry(w / 2, segments) : new THREE.PlaneGeometry(w, h);
    add(batches.faces, atlasGeo(geo, tile).translate(x, y, z));
  }
  function mesh(batch, material, name, parent = group) {
    const geometry = mergeGeometries(batch, false); for (const g of batch) g.dispose();
    const m = new THREE.Mesh(geometry, material); m.name = name; parent.add(m); return m;
  }
  function moving(name, x, y, z, build) {
    const node = new THREE.Group(); node.name = name; node.position.set(x, y, z); group.add(node);
    const batch = []; build(batch); mesh(batch, solid, name + ':geometry', node); return node;
  }

  const S=batches.solid,pz=ctx.eye.z-.75,top=ctx.eye.y-.14;
  // Glazing follows the shipped exterior exactly; inner rails make a .8 m workspace.
  const wind=[[.48,.26,-1.65],[0,.25,-1.77],[0,1.08,-.87],[.49,1.06,-.82]];
  // The welded post sits beside the pane seam, leaving the centreline sight clear.
  rod(S,[.019,.25,-1.77],[.019,1.08,-.87],.014,green);
  function frame(points,r=.013){for(let i=0;i<points.length;i++)rod(S,points[i],points[(i+1)%points.length],r,green);}
  for(const side of [-1,1]) {
    const pane=wind.map(([x,y,z])=>[side*x,y,z]);quad(batches.glass,pane);rod(S,pane[0],pane[3],.017,green);rod(S,pane[2],pane[3],.012,green);
    const door=[[side*.525,.25,-1.22],[side*.5,1.05,-.8],[side*.5,1.05,.48],[side*.525,.25,.48]];
    const rear=[[side*.525,.25,.54],[side*.5,1.05,.54],[side*.43,.72,1.2],[side*.48,.26,1.1]];
    for(const q of [door,rear]){quad(batches.glass,q);frame(q);}
    quad(batches.glass,[pane[0],pane[3],door[1],door[0]]);
    box(S,side*.425,-.265,-.10,.045,.87,2.50,fabric);
    for(const z of [-1.22,.48,1.10])rod(S,[side*.397,-.69,z],[side*.397,.23,z],.013,green);
    rod(S,[side*.397,.23,-1.3],[side*.397,.23,1.13],.017,green);
    rod(S,[side*.397,-.66,-1.22],[side*.397,.22,.48],.012,green);
    rod(S,[side*.397,-.66,.48],[side*.397,.22,1.1],.012,green);
    box(S,side*.393,-.35,.37,.015,.22,.35,leather);
    rod(S,[side*.39,.17,-.10],[side*.36,.17,.02],.009,metal);
    box(S,side*.393,.03,-.37,.026,.022,.32,leather);
    // Sight gauge at each wing root, tilted toward the centreline eye.
    const fg=atlasGeo(new THREE.PlaneGeometry(.045,.17),8);fg.rotateY(-side*.8).translate(side*.43,.88,-.72);add(batches.faces,fg);
    rod(S,[side*.46,.78,-.74],[side*.46,.98,-.74],.007,green);
    for(const z of [-.8,.54])rod(S,[side*.49,1.055,z],[side*.39,.23,z],.012,green);
  }
  const roof=[[-.48,1.075,-.8],[-.48,1.075,.54],[.48,1.075,.54],[.48,1.075,-.8]];
  quad(batches.glass,roof);frame(roof);
  quad(batches.glass,[[-.43,.73,1.21],[.43,.73,1.21],[.49,1.04,.56],[-.49,1.04,.56]]);
  rod(S,[-.48,1.06,-.8],[.48,1.06,.54],.010,green);
  box(S,0,-.715,-.10,.84,.035,2.55,dark);box(S,0,-.02,1.22,.85,1.45,.035,fabric);
  for(const z of [-.25,.64]) {
    box(S,0,-.32,z,.43,.13,.46,leather);box(S,0,-.04,z+.23,.43,.53,.065,leather,-.12);
    for(const x of [-.17,.17]){rod(S,[x,-.69,z-.19],[x,-.38,z+.19],.012,green);box(S,x,-.246,z,.028,.012,.40,fabric);box(S,x,.015,z+.275,.027,.43,.009,fabric,-.12);}
    box(S,.09,-.235,z+.04,.055,.018,.036,metal);
    for(let i=0;i<5;i++)box(S,-.16+i*.08,-.015,z+.27,.002,.39,.004,0x736c54,-.12);
  }
  // Boot cowl falls to the existing exterior junction; no overhanging glareshield.
  box(S,0,top-.17,pz-.021,.77,.34,.042,0x4a5149);
  quad(S,[[-.385,top,pz],[.385,top,pz],[.48,.26,-1.65],[-.48,.26,-1.65]],green);
  rod(S,[-.385,top,pz],[.385,top,pz],.009,dark);
  const rng=makeRng(ctx.seed??11);
  for(let i=0;i<(low?20:85);i++){const x=(rng()-.5)*.73,y=top-.33+rng()*.30;box(S,x,y,pz+.001,.003+rng()*.009,.001,.001,0x727769);}
  for(let i=0;i<14;i++)box(S,-.32+i*.049,-.695,-.30,.009,.002,1.8,0x57574c);
  function instrument(tile,x,y,r){face(tile,x,y,pz+.004,r*2);ring(S,x,y,pz+.007,r,.003,dark);for(const dx of [-1,1])for(const dy of [-1,1])disc(S,x+dx*r*.85,y+dy*r*.85,pz+.009,.0019,metal);}
  instrument(0,-.18,.276,.049);instrument(1,0,.276,.049);instrument(4,.18,.276,.049);
  instrument(2,-.10,.159,.042);instrument(3,.10,.159,.035);instrument(6,-.285,.168,.030);instrument(7,.285,.168,.030);
  function needle(name,x,y,len,z=pz+.014){return moving(name,x,y,z,b=>{box(b,0,len*.4,0,.0023,len,.0015,ivory);disc(b,0,0,.001,.004,metal);});}
  parts.asi=needle('asi',-.18,.276,.039);parts.alt=needle('alt',0,.276,.040);
  parts.altThousands=needle('altThousands',0,.276,.025,pz+.018);
  parts.rpm=[needle('rpm',.18,.276,.039)];parts.vsi=needle('vsi',.10,.159,.027);
  parts.turn=needle('turn',-.10,.159,.022);
  parts.attitude=moving('attitude',-.10,.166,pz+.018,b=>{box(b,0,0,0,.039,.002,.001,ivory);box(b,0,.003,0,.002,.012,.001,ivory);});
  parts.slipBall=moving('slipBall',-.10,.133,pz+.018,b=>disc(b,0,0,0,.0035,dark));
  // Vertical compass card and fixed lubber line on the centre windshield post.
  const compassY=.70,compassZ=-1.13;
  ring(S,0,compassY,compassZ,.038,.005,dark);box(S,0,compassY,compassZ-.014,.078,.078,.018,dark);
  rod(S,[0,.78,-1.19],[0,.74,compassZ],.008,green);
  parts.hdgCard=new THREE.Group();parts.hdgCard.position.set(0,compassY,compassZ);group.add(parts.hdgCard);
  parts.hdgCard.add(new THREE.Mesh(atlasGeo(new THREE.CircleGeometry(.034,segments),5),faces));
  box(S,0,compassY+.032,compassZ+.005,.002,.013,.002,ivory);
  face(9,0,.065,pz+.006,.36,.065,false);face(13,.282,.276,pz+.006,.082,.07,false);
  for(let i=0;i<4;i++){const x=-.09+i*.06;disc(S,x,.041,pz+.010,.006,dark);rod(S,[x,.041,pz+.012],[x,.052,pz+.029],.0025,metal);}
  disc(S,-.26,.060,pz+.012,.018,dark);rod(S,[-.26,.06,pz+.015],[-.26,.06,pz+.034],.003,metal);box(S,-.254,.066,pz+.038,.015,.015,.004,metal);
  for(const [x,col] of [[.23,0x8b3629],[.29,dark]])rod(S,[x,.057,pz+.01],[x,.057,pz+.033],.010,col);
  // Front and rear floor pivots. Each whole control is a single coloured mesh.
  function stick(name,z){return moving(name,0,-.69,z,b=>{rod(b,[0,0,0],[0,.34,0],.012,green);rod(b,[0,.34,0],[0,.45,.008],.018,dark);box(b,0,.416,-.016,.021,.022,.008,metal);});}
  parts.stick=stick('stick',-.88);parts.rearStick=stick('rearStick',.05);
  for(const [name,x] of [['pedalL',-.14],['pedalR',.14]]) {
    parts[name]=moving(name,x,-.60,-1.18,b=>{rod(b,[0,.20,-.045],[0,.06,0],.009,green);rod(b,[-.055,.065,0],[.055,.065,0],.010,metal);box(b,0,.061,.007,.10,.04,.012,dark);box(b,0,-.045,.045,.055,.018,.075,metal);});
    parts[name].userData.z0=-1.18;
    // Tandem rear pedals sit either side of the front seat, fixed at neutral.
    rod(S,[x,-.40,-.24],[x,-.54,-.18],.009,green);box(S,x,-.54,-.18,.10,.04,.015,metal);box(S,x,-.645,-.13,.055,.018,.075,metal);
  }
  box(S,-.377,-.15,-.65,.04,.12,.28,dark);
  parts.throttle=[moving('throttle',-.345,-.16,-.65,b=>{
    // Downward arm: negative X rotation puts the grip FORWARD (-Z).
    rod(b,[0,0,0],[0,-.13,0],.008,metal);rod(b,[0,-.13,0],[.036,-.13,0],.020,dark);
  })];
  for(const [z,col] of [[-.49,0xa63726],[-.39,dark]]){rod(S,[-.39,-.10,z],[-.31,-.10,z],.006,metal);rod(S,[-.31,-.10,z],[-.29,-.10,z],.015,col);}
  const sideLabel=atlasGeo(new THREE.PlaneGeometry(.18,.10),10).rotateY(Math.PI/2).translate(-.395,.075,-.59);add(batches.faces,sideLabel);
  parts.flapLever=moving('flapLever',-.28,-.66,-.34,b=>{rod(b,[0,0,0],[0,.25,-.33],.010,metal);rod(b,[0,.25,-.33],[0,.30,-.395],.016,dark);rod(b,[0,.30,-.395],[0,.312,-.411],.008,ivory);});
  for(const a of [-25,2.5,30]){const r=a*DEG;box(S,-.30,-.66+.25*Math.cos(r)+.33*Math.sin(r),-.34+.25*Math.sin(r)-.33*Math.cos(r),.022,.010,.017,metal);}
  parts.trimWheel=moving('trimWheel',-.367,.13,-.82,b=>{add(b,new THREE.TorusGeometry(.039,.005,6,segments).rotateY(Math.PI/2),dark);rod(b,[0,-.036,0],[0,.036,0],.004,metal);rod(b,[0,.033,0],[.027,.033,0],.007,ivory);});
  for(const [tile,y,z] of [[11,-.43,-.48],[12,.23,-.82]])add(batches.faces,atlasGeo(new THREE.PlaneGeometry(.09,.13),tile).rotateY(Math.PI/2).translate(-.396,y,z));
  face(15,0,-.48,1.195,.25,.10,false);
  parts.stallLight=new THREE.Mesh(new THREE.SphereGeometry(.006,12,8),stallMat);parts.stallLight.scale.set(1.7,1,.6);parts.stallLight.position.set(0,top-.015,pz+.012);group.add(parts.stallLight);
  parts.panel=parts.glareshield=parts.seat=mesh(S,solid,'cabin-panel-seats-fittings');
  mesh(batches.faces,faces,'instrument-faces-and-placards');parts.windshield=mesh(batches.glass,glass,'windshield-doors-skylight');
  function update(s) {
    parts.stick.rotation.x=parts.rearStick.rotation.x=s.elevator*18*DEG;
    parts.stick.rotation.z=parts.rearStick.rotation.z=-s.aileron*18*DEG;
    parts.pedalR.position.z=-1.18-s.rudder*.07;parts.pedalL.position.z=-1.18+s.rudder*.07;
    parts.throttle[0].rotation.x=(30-60*s.throttle[0])*DEG;
    parts.flapLever.rotation.x=(-25+55*s.flapDetent/(def.flaps.detents.length-1))*DEG;
    parts.trimWheel.rotation.x=s.trim*4;
    parts.asi.rotation.z=-clamp(s.ias/160,0,1)*300*DEG;
    parts.alt.rotation.z=-(s.alt%1000)/1000*Math.PI*2;
    parts.altThousands.rotation.z=-(s.alt%10000)/10000*Math.PI*2;
    parts.vsi.rotation.z=(90-clamp(s.vs/2000,-1,1)*150)*DEG;
    parts.turn.rotation.z=-clamp(s.beta/10,-1,1)*30*DEG;
    parts.attitude.rotation.z=-s.roll*DEG;
    parts.slipBall.position.x=-.10+clamp(s.beta/10,-1,1)*.014;
    parts.hdgCard.rotation.z=s.heading*DEG;parts.rpm[0].rotation.z=-clamp(s.rpm[0],0,1)*270*DEG;
    stallMat.emissiveIntensity=s.stallWarning&&Math.floor(s.t*4)%2===0?1.4:0;
    const night=1-clamp(s.dayness??(s.night?0:1),0,1);
    faces.emissiveIntensity=night*.42;solid.emissiveIntensity=night*.045;
  }
  return {group,parts,update,look:{yaw:2.8,pitch:1.1}};
}
