// The Skylark 172: a four-seat, strut-braced high-wing trainer of the Cessna 172 class.
// Single piston engine, two-blade propeller, fixed tricycle gear with wheel pants,
// swept fin, all-flying-looking elevator behind a fixed tailplane. Wingspan 11.0 m,
// length about 8.3 m.
//
// ================================ THE AIRFRAME CONTRACT ================================
//
// This file is the SHAPE of one aircraft. It is the specification for whoever works
// here; keep this header, it is not a placeholder to be replaced.
//
// BODY FRAME, ALWAYS: forward is -Z, up is +Y, right is +X, metres, relative to the
// centre of gravity (CG). The CG sits at the origin; the wheels are where the physics
// says they are: `def.gear[i].pos` (a leg's hub) and `def.gear[i].radius`. The engine
// scales nothing - what you build is the size it is drawn at, so build to `def.span`.
//
//   export function buildAirframe(def, ctx) -> { group, parts, anchors, bounds }
//
// `def` is the physics definition (read-only; see src/aircraft/defs.js): span, gear,
// engines (with pos and propRadius for props), hook (pivot, length), eye, controls.
// `ctx`: { materials, detail, disc, propDisc, seed }
//   materials   LIVERY[def.id]() from ../livery.js - paint, glass, dark, tire, metal
//               and the aircraft's own colours (the Skylark: white, blue, pant).
//               Build every mesh from these or from materials you make in THIS call
//               (never cached across calls: a material belongs to one scene, and
//               the sky patches every fogged material once per scenario).
//   detail      'high' | 'medium' | 'low' - the quality tier. Drop segment counts and
//               small fittings on medium/low; keep the silhouette.
//   propDisc(r) the blurred propeller disc mesh (from livery.js), for prop aircraft.
//   seed        an integer for makeRng, if anything needs deterministic variety.
//
// RETURN `group`: one THREE.Group holding the whole exterior, at the origin, unrotated.
// The engine parents it to the aircraft and moves that; never set group.position.
//
// RETURN `parts`: the named movable nodes the engine animates every frame. The engine
// sets rotations on these Groups - build each so that its origin is the hinge line and
// the panel extends toward the trailing edge (+Z for horizontal surfaces, +Z for
// rudders). Signs: rotation.x positive = trailing edge DOWN (a flap deploying).
//
//   elevator   Group[]  hinge along +X; rotation.x = -elevator * elevatorMax
//   aileronL   Group    left wing (x < 0); rotation.x = +aileron * aileronMax
//   aileronR   Group    right wing; rotation.x = -aileron * aileronMax
//   rudder     Group[]  hinge along +Y; rotation.y = rudder * rudderMax
//   flaps      Group[]  rotation.x = flap * flaps.maxDeg (both wings, inner to outer)
//   spoilers   Group[]  (optional) hinged at their FRONT edge on the upper surface,
//                       panel extends +Z; rotation.x = -spoiler * 50 deg (edge UP)
//   props      Group[]  (prop aircraft) one per engine, hub on the propeller axis;
//                       rotation.z spins it. userData: { engine: i, disc, blades }.
//                       `blades` is the Group with the blade meshes (shown below ~70%
//                       rpm), `disc` the propDisc mesh (opacity follows rpm).
//   hook       Group    (carrier aircraft) pivot at def.hook.pivot, the shank extends
//                       +Z by def.hook.length; rotation.x = hook * def.hook.angle
//   reversers  Mesh[]   (optional, jets) translating sleeves; position.z slides aft
//                       from userData.z0 by up to 0.9 m
//   legs       [...]    one entry PER def.gear ENTRY, SAME ORDER. Each:
//               { root, pivot, strut, wheels, axis, angle, y0 }
//               root   the Group holding the whole leg (a direct child of `group`)
//               pivot  (retractable gear) the Group the leg folds about; the engine
//                      sets pivot.rotation[axis] = (1 - ext) * angle; null if fixed
//               strut  the Group that telescopes: position.y = y0 + compression
//               wheels Group[] spun about X by the wheel angle
//   lights     { left, right, tail, beacon, strobeL, strobeR } from navLights()
//              (common.js) - the engine blinks beacon and strobes by opacity
//   landingLight SpotLight with userData.max (see landingLight() in common.js)
//   hideInCockpit Object3D[] everything that must vanish in the cockpit view because
//              the camera is inside it: fuselage, cabin glass, canopy, stripes. Wings,
//              struts, engine, gear, tail and propeller STAY - they are seen out of
//              the windows.
//
// legs, props, hook, the lights and the landing light must be direct children of
// `group`: when a downloaded glTF airframe is substituted for this one those are kept
// and every other child is hidden.
//
// RETURN `anchors`: body-frame points the engine needs (THREE.Vector3 positions, unit
// directions; anchor() in common.js builds one):
//   exhaust[]  one per def.engines entry, same order: { position, direction, radius }
//              where the exhaust gas leaves the airframe (the stack outlet, the jet
//              pipe) and which way it goes (mostly +Z, a little down and out)
//   eye        the pilot's eye = def.eye, copied (the cockpit is built around it)
//   navLeft, navRight, tail, beacon   where the lights are
//   landingLight { position, target }
//   wingtipL, wingtipR   the tips
//   propHub[]  (prop aircraft) the propeller hub, one per engine
//   hookPivot  (carrier aircraft)
//   pitot      the pitot tube
//
// RETURN `bounds`: { nose, tail, belly, top, halfSpan, length } measured from the
// group (measureBounds() in common.js).
//
// BUDGET (ctx.detail === 'high'): <= 60k triangles, <= 20 draw calls (the airliner 24):
// about four merged static meshes (one per material), six control surfaces, six for the
// three gear legs (a moving strut and a spinning wheel each), the propeller and the
// lights. Share materials; merge static geometry per material; a separate mesh only
// where something moves.
// No per-frame work, no Math.random (makeRng from ../../config.js with ctx.seed).
// Name every material you create (material.name = 'skylark:xxx') so a shader error
// says where it came from. Do not declare shader uniforms named at*: the sky injects
// those into every fogged material.
// ======================================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DEG } from '../../config.js';
import { rod, navLights, landingLight, measureBounds, shadowAll, anchor } from './common.js';

export function buildAirframe(def, ctx) {
  const { white, blue, dark, glass, metal, tire } = ctx.materials;
  const high = ctx.detail === 'high', low = ctx.detail === 'low';
  const segments = high ? 32 : low ? 12 : 20;
  const g = new THREE.Group(); g.name = 'skylark';
  const parts = { flaps: [], elevator: [], rudder: [], props: [], legs: [], hideInCockpit: [] };
  const anchors = {}, paint = [], cabin = [], glazing = [], hardware = [];
  // Four static draws, split at the cockpit visibility boundary. Blue trim and
  // dark recesses use vertex tint on the same scene-owned white paint material.
  white.vertexColors = true;
  const plain = new THREE.Color(1, 1, 1);
  function tint(mat) {
    return new THREE.Color(mat.color.r / white.color.r, mat.color.g / white.color.g, mat.color.b / white.color.b);
  }
  const stripe = tint(blue), ink = tint(dark), alloy = tint(metal);
  const V = p => new THREE.Vector3(...p);
  function add(batch, geo, color = plain) {
    const flat = geo.index ? geo.toNonIndexed() : geo;
    for (const key of Object.keys(flat.attributes)) if (!['position', 'normal'].includes(key)) flat.deleteAttribute(key);
    const colors = new Float32Array(flat.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
    flat.setAttribute('color', new THREE.BufferAttribute(colors, 3)); batch.push(flat);
    if (flat !== geo) geo.dispose();
  }
  function finish(batch, mat, parent, name) {
    const mesh = new THREE.Mesh(mergeGeometries(batch, false), mat);
    mesh.name = name; parent.add(mesh); batch.forEach(geo => geo.dispose()); return mesh;
  }
  function box(batch, size, pos, color = plain) {
    add(batch, new THREE.BoxGeometry(...size).translate(...pos), color);
  }
  function tube(batch, a, b, radius, color = plain) {
    const mesh = rod(V(a), V(b), radius, metal, low ? 6 : 10);
    mesh.updateMatrix(); add(batch, mesh.geometry.applyMatrix4(mesh.matrix), color);
  }
  function ellipsoid(batch, size, pos, color = plain) {
    add(batch, new THREE.SphereGeometry(1, segments, low ? 6 : 12).scale(...size).translate(...pos), color);
  }
  function polygon(batch, points, color = plain) {
    const verts = [];
    for (let i = 1; i < points.length - 1; i++) verts.push(...points[0], ...points[i], ...points[i+1]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); geo.computeVertexNormals(); add(batch, geo, color);
  }
  function prism(batch, outline, thickness, vertical = false, color = plain) {
    const shape = new THREE.Shape(); outline.forEach(([a,b],i) => i ? shape.lineTo(a,b) : shape.moveTo(a,b)); shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, steps: 1 });
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const a=p.getX(i), b=p.getY(i), t=p.getZ(i)-thickness/2;
      if (vertical) p.setXYZ(i,t,a,b); else p.setXYZ(i,a,-t,b);
    }
    geo.computeVertexNormals(); add(batch,geo,color);
  }
  // Rounded aluminium sections with a flat floor. Lower cabin stops at the
  // window sills; no opaque full-height hull sits behind the glazing.
  function hull(batch, stations) {
    const verts=[], indices=[], n=segments;
    for (const [z,w,bottom,top] of stations) for (let j=0;j<n;j++) {
      const a=2*Math.PI*j/n;
      const sin=Math.sin(a);
      // The cabin has a broad sill/deck, not an elliptical crown underneath
      // floating windows. Aft of the rear pane it rounds back into the tail.
      const cabinDeck=batch===cabin && z<=1.68;
      const y=cabinDeck && sin>=0 ? top : Math.max(bottom,(top+bottom)/2+(top-bottom)/2*sin*1.08);
      verts.push(w*Math.cos(a),y,z);
    }
    for (let k=0;k<stations.length-1;k++) for(let j=0;j<n;j++) {
      const a=k*n+j,b=k*n+(j+1)%n,c=b+n,d=a+n;
      indices.push(a,b,c,a,c,d);
    }
    for(let j=1;j<n-1;j++) { indices.push(0,j+1,j); const b=(stations.length-1)*n; indices.push(b,b+j,b+j+1); }
    const geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3)); geo.setIndex(indices); geo.computeVertexNormals(); add(batch,geo);
  }
  hull(paint,[[-3.91,.26,-.27,.28],[-3.78,.46,-.42,.43],[-3.42,.56,-.49,.48],[-2.7,.60,-.56,.48],[-1.92,.64,-.64,.30]]);
  hull(cabin,[[-1.92,.64,-.64,.30],[-1.4,.69,-.91,.22],[.55,.69,-.95,.22],[1.18,.58,-.76,.27],[1.68,.49,-.58,.55],[2.6,.34,-.35,.44],[3.65,.18,-.20,.32],[4.35,.075,-.13,.21],[4.50,.008,-.04,.08]]);
  // Cowl cheeks and inset air intakes flank the nose bowl.
  for(const s of [-1,1]) {
    ellipsoid(paint,[.18,.22,.65],[s*.43,-.035,-3.12]);
    ellipsoid(paint,[.155,.105,.021],[s*.29,.045,-3.805],ink);
    if(high) for(let i=0;i<4;i++) box(paint,[.009,.095,.023],[s*.603,-.16,-2.36+i*.07],ink);
  }
  // Two sloping windscreen panes wrap around a narrow central mullion.
  const wind=[[-.63,.27,-1.94],[0,.29,-2.03],[0,.965,-.67],[-.61,.955,-.65]];
  polygon(glazing,wind.slice().reverse()); polygon(glazing,wind.map(([x,y,z])=>[-x,y,z]));
  tube(cabin,[0,.29,-2.03],[0,.965,-.67],.017);
  for(const s of [-1,1]) {
    const door=[[s*.676,.235,-1.64],[s*.613,.95,-.63],[s*.625,.95,.30],[s*.693,.235,.30]];
    const rear=[[s*.693,.235,.37],[s*.625,.95,.37],[s*.545,.70,1.15],[s*.586,.28,1.15]];
    polygon(glazing,s<0?door.slice().reverse():door); polygon(glazing,s<0?rear.slice().reverse():rear);
    for(const pane of [door,rear]) for(let i=0;i<pane.length;i++) tube(cabin,pane[i],pane[(i+1)%pane.length],.018);
    tube(cabin,[s*.63,.27,-1.94],[s*.61,.955,-.65],.024);
    // Door outline follows the curved lower skin; a fine dark seam and handle.
    if(high) {
      tube(cabin,[s*.687,.20,-1.42],[s*.60,-.68,-1.32],.008,ink);
      tube(cabin,[s*.60,-.68,-1.32],[s*.60,-.70,.28],.008,ink);
      tube(cabin,[s*.60,-.70,.28],[s*.687,.20,.28],.008,ink);
      tube(cabin,[s*.701,.13,.02],[s*.701,.13,.18],.014,alloy);
    }
    // Cheatline follows the changing cross section, then climbs into the fin fillet.
    const track=[[-1.88,.655,-.02],[-1.4,.697,-.04],[.55,.697,-.04],[1.18,.588,.02],[1.68,.497,.12],[2.6,.347,.23],[3.65,.187,.29],[4.22,.107,.28]];
    for(let i=0;i<track.length-1;i++) {
      const [z,x,y]=track[i], [zz,xx,yy]=track[i+1];
      const q=[[s*x,y-.065,z],[s*x,y+.065,z],[s*xx,yy+.04,zz],[s*xx,yy-.04,zz]];
      polygon(cabin,s<0?q.slice().reverse():q,stripe);
    }
  }
  polygon(glazing,[[-.545,.705,1.16],[.545,.705,1.16],[.48,.565,1.67],[-.48,.565,1.67]]);
  tube(cabin,[-.545,.705,1.16],[.545,.705,1.16],.022);
  tube(cabin,[-.48,.565,1.67],[.48,.565,1.67],.022);
  box(cabin,[1.24,.055,1.03],[0,.94,-.14]);

  const half=def.span/2, wy=.98, wz=-.25, dihedral=Math.tan(1.5*DEG);
  const chord=x=>1.65-.50*Math.max(0,(Math.abs(x)/half-.45)/.55);
  const height=x=>wy+Math.abs(x)*dihedral;
  // Smooth cambered sections truncated at the control hinge, rather than a
  // complete wing hidden underneath overlapping moving boxes.
  function foil(batch, stations) {
    const n=high?20:low?8:12, verts=[], idx=[];
    for(const [x,y,le,te,t] of stations) for(const sign of [1,-1]) for(let j=0;j<=n;j++) {
      const f=sign>0?j/n:1-j/n;
      verts.push(x,y+t*Math.sin(Math.PI*Math.sqrt(f))*(sign>0?.72:-.28),le+(te-le)*f);
    }
    const p=2*(n+1);
    for(let k=0;k<stations.length-1;k++) for(let j=0;j<p;j++) {
      const a=k*p+j,b=k*p+(j+1)%p,c=b+p,d=a+p; idx.push(a,b,c,a,c,d);
    }
    for(let j=1;j<p-1;j++){idx.push(0,j+1,j);const b=(stations.length-1)*p;idx.push(b,b+j,b+j+1);}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));geo.setIndex(idx);geo.computeVertexNormals();add(batch,geo);
  }
  function control(name,s,inner,outer,flap) {
    const center=s*(inner+outer)/2, pivot=new THREE.Group(); pivot.name=name;
    pivot.position.set(center,height(center)-(flap?.065:.015),.55);
    const batch=[], ends=[s*inner,s*outer].sort((a,b)=>a-b);
    foil(batch,ends.map(x=>[x-center,height(x)-height(center),.02,wz+.75*chord(x)-.55,.055]));
    finish(batch,white,pivot,name+':panel');g.add(pivot);return pivot;
  }
  for(const s of [-1,1]) {
    const xs=[0,.7,half*.45,3.15,half-.14].map(x=>s*x).sort((a,b)=>a-b);
    foil(paint,xs.map(x=>[x,height(x),wz-.25*chord(x),.535,.17]));
    const tipXs=[s*(half-.14),s*(half-.055),s*half].sort((a,b)=>a-b);
    foil(paint,tipXs.map(x=>[x,height(x)-.045*(Math.abs(x)-(half-.14))/.14,wz-.25*chord(x),wz+.75*chord(x),.105]));
    const flap=control(s<0?'flapL':'flapR',s,.76,3.10,true);parts.flaps.push(flap);
    parts[s<0?'aileronL':'aileronR']=control(s<0?'aileronL':'aileronR',s,3.15,half-.16,false);
    // Single streamlined lift strut: an elliptical section with end cuffs.
    const a=V([s*.57,-.70,-.48]),b=V([s*half*.45,height(half*.45)-.04,-.35]);
    const geo=new THREE.CylinderGeometry(1,1,a.distanceTo(b),low?6:12).scale(.033,1,.082);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V([0,1,0]),b.clone().sub(a).normalize()));
    geo.translate(...a.clone().add(b).multiplyScalar(.5).toArray());add(paint,geo);
    for(const p of [a,b]) ellipsoid(paint,[.10,.08,.16],p.toArray());
    if(high) {
      ellipsoid(hardware,[.065,.018,.065],[s*1.12,height(1.12)+.12,-.19]);
      for(const x of [1.10,2.75]) tube(hardware,[s*x,height(x)-.035,.43],[s*x,height(x)-.08,.60],.012);
    }
  }
  const tp=[]; prism(tp,[[-1.8,3.90],[-1.76,3.55],[-1.55,3.36],[0,3.08],[1.55,3.36],[1.76,3.55],[1.8,3.90]],.07);
  for(const geo of tp){geo.translate(0,.12,0);paint.push(geo);}
  const elevator=new THREE.Group();elevator.name='elevator';elevator.position.set(0,.12,3.92);
  const ep=[];prism(ep,[[-1.8,0],[-1.78,.32],[-1.62,.46],[-.18,.46],[-.18,.26],[.18,.26],[.18,.46],[1.62,.46],[1.78,.32],[1.8,0]],.05);
  if(high) box(ep,[.40,.006,.08],[.9,.029,.405],stripe);
  finish(ep,white,elevator,'elevator:panel');g.add(elevator);parts.elevator.push(elevator);
  // Swept leading edge, rounded fin crown and long dorsal fillet; vertical hinge
  // stays on Y and all rudder geometry is aft of it.
  prism(paint,[[.30,1.95],[.42,2.42],[.62,2.88],[1.66,3.40],[1.91,3.58],[1.99,3.76],[1.98,4.03],[.20,4.03]],.09,true,stripe);
  const rudder=new THREE.Group();rudder.name='rudder';rudder.position.set(0,.20,4.05);
  const rp=[];prism(rp,[[0,0],[1.78,0],[1.75,.14],[1.62,.27],[.20,.43],[0,.34]],.065,true,stripe);
  if(high) box(rp,[.072,.37,.095],[0,.46,.365]);
  finish(rp,white,rudder,'rudder:panel');g.add(rudder);parts.rudder.push(rudder);

  def.gear.forEach((leg,i)=>{
    const root=new THREE.Group();root.name='gear:'+leg.name;root.position.set(leg.pos.x,0,leg.pos.z);
    const strut=new THREE.Group();strut.position.y=leg.pos.y;root.add(strut);g.add(root);
    const batch=[],r=leg.radius,s=Math.sign(leg.pos.x);
    if(leg.main) {
      // Broad, tapered spring-steel blade, bending progressively down to the axle.
      const outline=[[0,.08],[-s*.12,.18],[-s*.35,.43],[-s*.73,.61],[-s*.82,.59],[-s*.41,.34],[-s*.20,.10],[0,-.025]];
      const geoBatch=[];prism(geoBatch,outline,.14);
      for(const geo of geoBatch){geo.rotateX(-Math.PI/2);geo.translate(0,0,-.015);batch.push(geo);}
    } else {
      tube(batch,[0,.08,0],[0,.69,-.12],.044,alloy);
      tube(batch,[0,.39,-.06],[0,.70,-.12],.063);
      tube(batch,[.05,.22,-.04],[.10,.34,.085],.018,alloy);
      tube(batch,[.10,.34,.085],[.05,.46,-.085],.018,alloy);
    }
    // Pant is an open-bottom upper fairing; the lower tyre remains exposed.
    const pantGeo=new THREE.SphereGeometry(1,segments,low?6:12,0,Math.PI*2,0,Math.PI*.62);
    pantGeo.scale(r*.58,r*.88,r*1.85).translate(0,r*.16,.035);add(batch,pantGeo);
    add(batch,new THREE.CylinderGeometry(r*.47,r*.47,r*.67,segments).rotateZ(Math.PI/2),alloy);
    finish(batch,white,strut,'gear:'+leg.name+':spring-pant-hub');
    const wheel=new THREE.Group();wheel.name='wheel:'+leg.name;strut.add(wheel);
    const w=r*.60;
    const profile=[[.43,-.47],[.73,-.50],[.94,-.33],[1,-.12],[1,.12],[.94,.33],[.73,.50],[.43,.47]].map(([rr,ww])=>new THREE.Vector2(rr*r,ww*w));
    const tyre=new THREE.Mesh(new THREE.LatheGeometry(profile,segments),tire);tyre.rotation.z=Math.PI/2;wheel.add(tyre);
    parts.legs[i]={root,pivot:null,strut,wheels:[wheel],axis:'x',angle:0,y0:leg.pos.y};
  });

  const prop=new THREE.Group();prop.name='propeller';prop.position.set(0,0,-3.94);
  const blades=new THREE.Group(),bp=[],radius=def.engines[0].propRadius;
  for(const s of [-1,1]) {
    const rings=[[.14,.044,.67],[.32,.085,.48],[.65,.09,.28],[.90,.051,.17],[1,.012,.12]].map(([r,c,t])=>
      [[-c,-.008],[c,-.008],[c,.008],[-c,.008]].map(([x,z])=>[s*(x*Math.cos(t)-z*Math.sin(t)),s*r*radius,x*Math.sin(t)+z*Math.cos(t)]));
    for(let i=0;i<rings.length-1;i++) for(let j=0;j<4;j++) polygon(bp,[rings[i][j],rings[i][(j+1)%4],rings[i+1][(j+1)%4],rings[i+1][j]]);
    polygon(bp,rings.at(-1));
  }
  finish(bp,dark,blades,'propeller:twisted-blades');
  const disc=ctx.propDisc(radius);disc.visible=false;prop.add(blades,disc);prop.userData={engine:0,disc,blades};g.add(prop);parts.props.push(prop);
  add(hardware,new THREE.LatheGeometry([[-4.18,.001],[-4.14,.085],[-4.06,.153],[-3.94,.185]].map(([z,r])=>new THREE.Vector2(r,z)),segments).rotateX(Math.PI/2));
  const outlet=V([.43,-.74,-2.77]),direction=V([.10,-.45,1]).normalize();
  const start=V([.40,-.43,-3.18]);
  const path=new THREE.CubicBezierCurve3(start,V([.44,-.65,-3.15]),outlet.clone().addScaledVector(direction,-.16),outlet);
  add(hardware,new THREE.TubeGeometry(path,low?4:12,.03,low?6:10,false));
  const bore=new THREE.CircleGeometry(.026,low?6:12);
  bore.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V([0,0,1]),direction));bore.translate(...outlet.clone().addScaledVector(direction,-.012).toArray());add(paint,bore,ink);
  anchors.exhaust=[anchor(...outlet.toArray(),...direction.toArray(),.03)];
  const light=V([0,-.20,-4.0]);
  ellipsoid(paint,[.12,.085,.07],[0,-.20,-3.94],ink);
  ellipsoid(hardware,[.088,.06,.012],light.toArray());
  anchors.pitot=V([-2.3,height(2.3)-.23,-.94]);
  tube(hardware,[-2.3,height(2.3)-.02,-.46],[-2.3,height(2.3)-.23,-.46],.013);
  tube(hardware,[-2.3,height(2.3)-.23,-.46],anchors.pitot.toArray(),.012);
  const navL=V([-half,height(half)-.045,-.25]),navR=V([half,height(half)-.045,-.25]);
  const navT=V([0,.49,4.48]),navB=V([0,2.0,3.78]);
  parts.lights=navLights(g,navL,navR,navT,navB);
  anchors.landingLight={position:light,target:V([0,-1.5,-30])};
  parts.landingLight=landingLight(g,light,anchors.landingLight.target,200,{distance:400,angle:.35});
  anchors.eye=new THREE.Vector3(def.eye.x,def.eye.y,def.eye.z);
  anchors.navLeft=navL;anchors.navRight=navR;anchors.tail=navT;anchors.beacon=navB;
  anchors.wingtipL=navL.clone();anchors.wingtipR=navR.clone();anchors.propHub=[prop.position.clone()];
  finish(paint,white,g,'exterior:cowl-wings-struts-tail-and-trim');
  parts.hideInCockpit.push(finish(cabin,white,g,'cabin:skin-doors-frames-and-cheatline'));
  parts.hideInCockpit.push(finish(glazing,glass,g,'cabin:windshield-door-rear-glass'));
  finish(hardware,metal,g,'exterior:spinner-exhaust-and-fittings');
  shadowAll(g);
  return {group:g,parts,anchors,bounds:measureBounds(g)};
}
