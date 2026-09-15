// The Trailblazer: a two-seat STOL bush plane on tundra tyres, Piper Super Cub /
// Aviat Husky class. Strut-braced high wing with big slotted flaps, fabric-and-tube
// fuselage with a flat-sided cabin, tailwheel undercarriage with a sprung tailwheel,
// exposed exhaust stack under the cowl, huge low-pressure main tyres. Wingspan 10.7 m,
// length about 7 m. It is NOT a biplane (the downloaded model was, which is wrong
// for this aircraft).
//
// THE CONTRACT: the same as skylark.js - read that header first, it is the spec.
//   export function buildAirframe(def, ctx) -> { group, parts, anchors, bounds }
// Body frame: forward -Z, up +Y, right +X, metres, relative to the CG. Build to
// def.span; the wheels sit at def.gear[i].pos with def.gear[i].radius (order:
// left main, right main, tail).
//
// This aircraft's parts: elevator[1], aileronL/R, rudder[1], flaps[2], props[1]
// (engine 0), legs[3] (fixed gear: pivot null), lights, landingLight, hideInCockpit.
// Its anchors: exhaust[1] (the stack under the cowl, right side, pointing aft and
// down), eye, navLeft/Right, tail, beacon, landingLight, wingtipL/R, propHub[1], pitot.
// Materials handed in ctx.materials: yellow, black, metal, dark, glass, tire.
// Budget at ctx.detail 'high': <= 60k triangles, <= 20 draw calls; no Math.random;
// name every material; no at* shader uniforms. Keep this header.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rod, navLights, landingLight, measureBounds, shadowAll, anchor } from './common.js';

export function buildAirframe(def, ctx) {
  const { yellow, black, metal, glass, dark, tire } = ctx.materials;
  const high = ctx.detail === 'high', low = ctx.detail === 'low';
  const segments = low ? 12 : high ? 32 : 20;
  const g = new THREE.Group(); g.name = 'trailblazer';
  const parts = { flaps: [], elevator: [], rudder: [], props: [], legs: [], hideInCockpit: [] };
  const anchors = {};
  const paint = [], cabin = [], glazing = [], hardware = [];
  // Vertex tint folds the black scheme into the paint batches without material groups.
  // All painted moving surfaces share this same scene-owned material object.
  yellow.vertexColors = true;
  const white = new THREE.Color(1, 1, 1);
  const ink = black.color.clone();
  ink.r /= yellow.color.r; ink.g /= yellow.color.g; ink.b /= yellow.color.b;
  const V = p => new THREE.Vector3(...p);
  function add(batch, geo, tint = white) {
    const flat = geo.index ? geo.toNonIndexed() : geo;
    for (const key of Object.keys(flat.attributes)) if (!['position', 'normal'].includes(key)) flat.deleteAttribute(key);
    const colors = new Float32Array(flat.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) tint.toArray(colors, i);
    flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    batch.push(flat);
    if (flat !== geo) geo.dispose();
  }
  function finish(batch, material, parent, name) {
    const geo = mergeGeometries(batch, false);
    const mesh = new THREE.Mesh(geo, material); mesh.name = name; parent.add(mesh);
    for (const item of batch) item.dispose();
    return mesh;
  }
  function box(batch, size, pos, tint = white) {
    add(batch, new THREE.BoxGeometry(...size).translate(...pos), tint);
  }
  function tube(batch, a, b, radius, tint = white) {
    const m = rod(V(a), V(b), radius, metal, low ? 5 : 8);
    m.updateMatrix(); add(batch, m.geometry.applyMatrix4(m.matrix), tint);
  }
  function polygon(batch, points, tint = white) {
    // Convex panes and narrow scheme polygons, with explicit outward winding.
    const verts = [];
    for (let i = 1; i < points.length - 1; i++) verts.push(...points[0], ...points[i], ...points[i + 1]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); geo.computeVertexNormals(); add(batch, geo, tint);
  }
  function prism(batch, outline, thickness, vertical = false, tint = white) {
    const shape = new THREE.Shape(); outline.forEach(([a, b], i) => i ? shape.lineTo(a, b) : shape.moveTo(a, b)); shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, steps: 1, curveSegments: 8 });
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const a = p.getX(i), b = p.getY(i), t = p.getZ(i) - thickness / 2;
      if (vertical) p.setXYZ(i, t, a, b); else p.setXYZ(i, a, -t, b);
    }
    geo.computeVertexNormals(); add(batch, geo, tint);
  }
  function hull(batch, stations) {
    // Clockwise viewed aft: flat belly/sides, chamfered shoulders, rounded top deck.
    const rings = stations.map(([z, w, bottom, top]) => {
      const shoulder = top - (top - bottom) * 0.18;
      return [[-w,bottom,z],[w,bottom,z],[w,shoulder,z],[w*.8,top-.025,z],[w*.4,top,z],[-w*.4,top,z],[-w*.8,top-.025,z],[-w,shoulder,z]];
    });
    for (let s = 0; s < rings.length - 1; s++) for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8;
      polygon(batch, [rings[s][i], rings[s][j], rings[s+1][j], rings[s+1][i]]);
    }
    polygon(batch, rings[0].slice().reverse()); polygon(batch, rings.at(-1));
  }
  hull(paint, [[-3.48,.22,-.24,.31],[-3.23,.43,-.43,.47],[-2.65,.48,-.49,.53],[-1.65,.48,-.55,.49]]);
  hull(cabin, [[-1.65,.48,-.55,.25],[-1.2,.52,-.86,.22],[.8,.52,-.86,.22],[1.22,.43,-.68,.72],[2.6,.28,-.38,.55],[4.25,.105,-.15,.37],[4.8,.045,-.08,.28]]);
  // Tall tandem cabin: two flat windscreen panes, side doors and a glazed roof.
  const front = [[-.48,.26,-1.65],[0,.25,-1.77],[0,1.08,-.87],[-.49,1.06,-.82]];
  polygon(glazing, front.slice().reverse());
  polygon(glazing, front.map(([x,y,z]) => [-x,y,z]));
  for (const s of [-1,1]) {
    const pane = [[s*.525,.25,-1.22],[s*.5,1.05,-.8],[s*.5,1.05,.48],[s*.525,.25,.48]];
    polygon(glazing, s < 0 ? pane.slice().reverse() : pane);
    const rear = [[s*.525,.25,.54],[s*.5,1.05,.54],[s*.43,.72,1.2],[s*.48,.26,1.1]];
    polygon(glazing, s < 0 ? rear.slice().reverse() : rear);
    for (const [a,b] of [[pane[0],pane[1]],[pane[1],pane[2]],[pane[2],pane[3]],[pane[3],pane[0]],[rear[1],rear[2]],[rear[2],rear[3]]]) tube(cabin,a,b,.018);
    box(cabin,[.024,.85,1.55],[s*.528,-.29,-.38]);
    tube(cabin,[s*.548,-.05,.22],[s*.548,-.05,.36],.013,ink);
    // Lightning bolt follows the tapered slab side rather than cutting across it.
    const stripe = [[-1.5,.02,.499],[.75,-.12,.536],[.45,-.28,.536],[1.65,-.23,.397],[1.42,-.36,.419],[4.15,.06,.123],[1.1,-.52,.465],[1.3,-.36,.443],[.1,-.42,.536],[.35,-.25,.536],[-1.5,-.12,.499]].map(([z,y,x]) => [s*x,y,z]);
    // Triangulate this concave lightning outline explicitly using ShapeUtils.
    const tris = THREE.ShapeUtils.triangulateShape(stripe.map(p => new THREE.Vector2(p[2],p[1])), []);
    for (const tri of tris) { const p = tri.map(i => stripe[i]); polygon(cabin,s < 0 ? p.reverse() : p,ink); }
    box(paint,[.016,.29,1.18],[s*.484,-.06,-2.31],ink);
    if (high) {
      for (let j=0;j<7;j++) tube(paint,[s*.499,-.14,-2.65+j*.105],[s*.499,.05,-2.69+j*.105],.018,ink);
      for (const y of [-.25,.02,.29]) tube(cabin,[s*.431,y,1.24],[s*.109,.12+(y*.25),4.22],.009);
    }
  }
  polygon(glazing,[[-.48,1.075,-.8],[-.48,1.075,.54],[.48,1.075,.54],[.48,1.075,-.8]]);
  polygon(glazing,[[-.43,.73,1.21],[.43,.73,1.21],[.49,1.04,.56],[-.49,1.04,.56]]);
  tube(cabin,[0,.25,-1.77],[0,1.08,-.87],.019);
  tube(cabin,[-.49,1.075,-.82],[.49,1.075,-.82],.022);
  tube(cabin,[-.49,1.075,.54],[.49,1.075,.54],.022);

  const half = def.span / 2, wy = 1.05, le = -1.18, hinge = -.005;
  // Closed cambered wing section. The fixed wing ends BEFORE the separate controls.
  function foil(batch, x0, x1, z0, chord, y, thickness) {
    const n = 16, rings = [x0,x1].map(x => {
      const ring=[];
      for (const sign of [1,-1]) for (let j=0;j<=n;j++) {
        const f = sign > 0 ? j/n : 1-j/n;
        const t = thickness * Math.sin(Math.PI*Math.sqrt(f)) * (sign > 0 ? .7 : -.3);
        ring.push([x,y+t+.025*Math.sin(Math.PI*f),z0+chord*f]);
      }
      return ring;
    });
    for (let i=0;i<rings[0].length;i++) { const j=(i+1)%rings[0].length; polygon(batch,[rings[0][i],rings[0][j],rings[1][j],rings[1][i]]); }
    polygon(batch,rings[0].slice().reverse()); polygon(batch,rings[1]);
  }
  function control(name, x, y, z, width, chord) {
    const pivot = new THREE.Group(); pivot.name=name; pivot.position.set(x,y,z);
    const batch=[]; foil(batch,-width/2,width/2,.025,chord,0,.07);
    finish(batch,yellow,pivot,name+':panel'); g.add(pivot); return pivot;
  }
  for (const s of [-1,1]) {
    const a=Math.min(s*.5,s*(half-.09)), b=Math.max(s*.5,s*(half-.09));
    foil(paint,a,b,le,1.15,wy,.18);
    // Small rounded tip fairing, full chord beyond the aileron end.
    const tip = new THREE.SphereGeometry(1,low?8:16,8).scale(.09,.085,.825).translate(s*(half-.09),wy,-.355); add(paint,tip);
    box(paint,[.24,.013,.8],[s*.69,wy+.13,-.57],ink);
    const flp=control(s<0?'flapL':'flapR',s*1.85,wy-.075,hinge,2.58,.455); parts.flaps.push(flp);
    const ail=control(s<0?'aileronL':'aileronR',s*4.21,wy-.02,hinge,2.04,.455);
    parts[s<0?'aileronL':'aileronR']=ail;
    for (const x of [1,2.8]) tube(paint,[s*x,wy-.045,-.15],[s*x,wy-.075,.025],.016);
    const meet=[s*3.12,wy-.045,-.4];
    for (const z of [-1.08,.58]) {
      const start=[s*.48,-.68,z]; tube(paint,start,meet,.032);
      if (!low) tube(hardware,[(start[0]+meet[0])/2,(start[1]+meet[1])/2,(start[2]+meet[2])/2],[s*1.8,wy-.025,(z-.4)/2],.012);
    }
    if (!low) tube(hardware,[0,1.35,4.48],[s*1.43,.2,4.04],.008);
    if (high) for (let x=.9;x<half-.2;x+=.19) {
      polygon(paint,[[s*x,wy+.105,le+.11],[s*x,wy+.145,le+.17],[s*(x+.02),wy+.105,le+.22]]);
    }
  }
  const tailplane=[];
  prism(tailplane,[[-1.55,4.17],[-1.5,3.82],[-1.32,3.62],[0,3.42],[1.32,3.62],[1.5,3.82],[1.55,4.17]],.065);
  for (const geo of tailplane) { geo.translate(0,.2,0); paint.push(geo); }
  const elevator=new THREE.Group(); elevator.name='elevator'; elevator.position.set(0,.2,4.19);
  const ep=[]; prism(ep,[[-1.55,0],[-1.5,.35],[-1.3,.49],[-.15,.49],[-.15,.29],[.15,.29],[.15,.49],[1.3,.49],[1.5,.35],[1.55,0]],.055);
  box(ep,[.35,.009,.10],[.91,.033,.425],ink); finish(ep,yellow,elevator,'elevator:panel'); g.add(elevator); parts.elevator.push(elevator);
  prism(paint,[[.25,3.63],[.48,3.78],[1.45,4.11],[1.8,4.35],[1.9,4.55],[1.86,4.78],[.22,4.78]],.065,true);
  const rudder=new THREE.Group(); rudder.name='rudder'; rudder.position.set(0,.22,4.8);
  const rp=[]; prism(rp,[[0,0],[1.64,0],[1.67,.13],[1.6,.29],[1.42,.43],[.35,.48],[.1,.37],[0,.2]],.055,true);
  finish(rp,yellow,rudder,'rudder:panel'); g.add(rudder); parts.rudder.push(rudder);

  def.gear.forEach((leg,i) => {
    const root=new THREE.Group(); root.name='gear:'+leg.name; root.position.set(leg.pos.x,0,leg.pos.z);
    const strut=new THREE.Group(); strut.position.y=leg.pos.y; root.add(strut); g.add(root);
    const gear=[];
    if (leg.main) {
      const s=Math.sign(leg.pos.x);
      for (const [x,y,z] of [[s*.46,-.68,-1.15],[s*.46,-.7,-.05],[s*.42,-.64,.65]]) tube(gear,[x-leg.pos.x,y-leg.pos.y,z-leg.pos.z],[0,.025,0],.035);
      tube(gear,[0,0,0],[-s*.82,.12,0],.027);
      box(paint,[.16,.12,.3],[s*.46,-.68,-.85]);
      // Bungee sleeve at the inboard diagonal, merged with the moving hardware.
      tube(gear,[-s*.24,.10,0],[-s*.59,.18,0],.065);
    } else {
      for (let j=0;j<3;j++) tube(gear,[0,.42-j*.014,-.45],[0,.19-j*.014,-.09],.018);
      for (const s of [-1,1]) tube(gear,[0,.19,-.09],[s*.065,0,0],.018);
    }
    const hub=new THREE.CylinderGeometry(leg.radius*.27,leg.radius*.27,leg.main?.365:.13,16).rotateZ(Math.PI/2); add(gear,hub);
    finish(gear,metal,strut,'gear:'+leg.name+':tubes-and-hub');
    const wheel=new THREE.Group(); wheel.name='wheel:'+leg.name; strut.add(wheel);
    // Lathe axle stays local Y for the livery tread projection; rotate the Mesh to X.
    const r=leg.radius, w=leg.main?.36:.105;
    const profile=[new THREE.Vector2(r*.25,-w*.46),new THREE.Vector2(r*.58,-w*.5),new THREE.Vector2(r*.85,-w*.39),new THREE.Vector2(r*.98,-w*.18),new THREE.Vector2(r,0),new THREE.Vector2(r*.98,w*.18),new THREE.Vector2(r*.85,w*.39),new THREE.Vector2(r*.58,w*.5),new THREE.Vector2(r*.25,w*.46)];
    const wm=new THREE.Mesh(new THREE.LatheGeometry(profile,segments),tire); wm.rotation.z=Math.PI/2; wheel.add(wm);
    parts.legs[i]={root,pivot:null,strut,wheels:[wheel],axis:'x',angle:0,y0:leg.pos.y};
  });

  const prop=new THREE.Group(); prop.name='propeller'; prop.position.set(0,.05,-3.49);
  const blades=new THREE.Group(), bp=[];
  // Radial stations retain pitch twist, broad mid-blade chord and rounded narrow tips.
  for (const s of [-1,1]) {
    const rings=[[.13,.055,.65],[.3,.09,.48],[.62,.105,.27],[.87,.072,.17],[1,.018,.12]].map(([r,c,t]) => {
      return [[-c,-.009],[c,-.009],[c,.009],[-c,.009]].map(([x,z]) => [s*(x*Math.cos(t)-z*Math.sin(t)),s*r,x*Math.sin(t)+z*Math.cos(t)]);
    });
    for(let i=0;i<rings.length-1;i++) for(let j=0;j<4;j++) polygon(bp,[rings[i][j],rings[i][(j+1)%4],rings[i+1][(j+1)%4],rings[i+1][j]]);
    polygon(bp,rings.at(-1));
  }
  finish(bp,dark,blades,'propeller:twisted-blades');
  const disc=ctx.propDisc(def.engines[0].propRadius); disc.visible=false;
  prop.add(blades,disc); prop.userData={engine:0,disc,blades}; g.add(prop); parts.props.push(prop);
  add(hardware,new THREE.LatheGeometry([[-3.77,.002],[-3.72,.085],[-3.62,.145],[-3.48,.17]].map(([z,r]) => new THREE.Vector2(r,z)),segments).rotateX(Math.PI/2).translate(0,.05,0));
  const outlet=new THREE.Vector3(.43,-.98,-.87), direction=new THREE.Vector3(0,-.22,1).normalize();
  const pipeStart=low ? outlet.clone().addScaledVector(direction,-.42) : V([.38,-.42,-2.3]);
  const path=low ? new THREE.LineCurve3(pipeStart,outlet) : new THREE.CubicBezierCurve3(pipeStart,V([.56,-.91,-2.05]),outlet.clone().addScaledVector(direction,-.48),outlet);
  add(hardware,new THREE.TubeGeometry(path,low?1:18,.035,low?6:10,false));
  // Open outlet with an inset black bore; anchor lies on the actual cut plane.
  const bore=new THREE.CircleGeometry(.030,12);
  bore.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(V([0,0,1]),direction)));
  bore.translate(...outlet.clone().addScaledVector(direction,-.018).toArray()); add(paint,bore,ink);
  anchors.exhaust=[anchor(...outlet.toArray(),...direction.toArray(),.035)];
  const light=V([-2.18,wy+.015,le-.008]);
  box(paint,[.31,.115,.05],light.toArray(),ink);
  add(hardware,new THREE.SphereGeometry(.095,12,8).scale(1,.65,.22).translate(light.x,light.y,light.z-.03));
  anchors.pitot=V([-2.5,wy-.28,le-.22]);
  tube(hardware,[-2.5,wy-.02,-.9],[-2.5,wy-.28,-.9],.012);
  tube(hardware,[-2.5,wy-.28,-.9],anchors.pitot.toArray(),.014);
  const navL=V([-half,wy,-.36]),navR=V([half,wy,-.36]),navT=V([0,.55,5.28]),navB=V([0,1.91,4.55]);
  parts.lights=navLights(g,navL,navR,navT,navB);
  anchors.landingLight={position:light,target:V([-2.18,-2,-30])};
  parts.landingLight=landingLight(g,light,anchors.landingLight.target,150,{distance:300,angle:.4});
  anchors.eye=new THREE.Vector3(def.eye.x,def.eye.y,def.eye.z);
  anchors.navLeft=navL; anchors.navRight=navR; anchors.tail=navT; anchors.beacon=navB;
  anchors.wingtipL=navL.clone(); anchors.wingtipR=navR.clone(); anchors.propHub=[prop.position.clone()];
  finish(paint,yellow,g,'exterior:paint-and-trim');
  parts.hideInCockpit.push(finish(cabin,yellow,g,'cabin:fabric-doors-frames-and-stripe'));
  parts.hideInCockpit.push(finish(glazing,glass,g,'cabin:windshield-side-rear-and-skylight'));
  finish(hardware,metal,g,'exterior:metal');
  shadowAll(g);
  return {group:g,parts,anchors,bounds:measureBounds(g)};
}