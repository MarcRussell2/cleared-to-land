// The Sea Hornet: an F/A-18 class twin-engine carrier fighter. Bubble canopy over a
// single seat, leading-edge extensions (LEX) running from the wing root up the sides
// of the cockpit, two rectangular intakes under the LEX, a low-set trapezoidal wing
// with folding outer panels (a hinge line and fold fairings, wings shown spread),
// twin outward-canted fins with rudders, all-moving stabilators, twin afterburning
// jet pipes at the tail, a tailhook under the tail between them, and a stout
// retractable tricycle gear built for the deck (twin nose wheels, catapult
// launch bar). Wingspan 12.3 m, length about 17 m.
//
// THE CONTRACT: the same as skylark.js - read that header first, it is the spec.
//   export function buildAirframe(def, ctx) -> { group, parts, anchors, bounds }
// Body frame: forward -Z, up +Y, right +X, metres, relative to the CG. Build to
// def.span; the wheels sit at def.gear[i].pos with def.gear[i].radius (order:
// nose, left main, right main).
//
// This aircraft's parts: elevator[2] (the stabilators: one Group per side, pivot on
// the stabilator's own axis), aileronL/R, rudder[2] (one per fin, hinge along the
// fin's own axis), flaps[2], hook (pivot at def.hook.pivot, shank +Z by
// def.hook.length), legs[3] (RETRACTABLE, pivot Groups: nose axis 'x' angle -95 deg
// folds forward; mains axis 'x' angle +95 deg fold aft), lights, landingLight,
// hideInCockpit (the canopy MUST be in it - the pilot sits under it).
// Its anchors: exhaust[2] (the jet pipes, def.engines order left then right,
// pointing +Z), eye, navLeft/Right, tail, beacon, landingLight, wingtipL/R,
// hookPivot, pitot. No props, no spoilers, no reversers.
// Materials handed in ctx.materials: gray, gray2, metal, dark, glass, tire.
// Budget at ctx.detail 'high': <= 60k triangles, <= 20 draw calls; no Math.random;
// name every material; no at* shader uniforms. Keep this header.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DEG } from '../../config.js';
import { lathe, navLights, landingLight, measureBounds, shadowAll, anchor } from './common.js';

export function buildAirframe(def, ctx) {
  const { gray, gray2, dark, glass, tire, metal } = ctx.materials;
  const high = ctx.detail === 'high', low = ctx.detail === 'low';
  const segments = high ? 40 : low ? 16 : 24;
  const g = new THREE.Group(); g.name = 'hornet';
  const parts = { flaps: [], elevator: [], rudder: [], legs: [], hideInCockpit: [] };
  const anchors = {}, skin = [], paint = [], hardware = [], glazing = [];
  // Four static draws, split by cockpit visibility. Vertex tint keeps the tactical
  // greys and metal fittings in their batches without adding material groups.
  gray.vertexColors = true; metal.vertexColors = true; tire.vertexColors = true;
  glass.side = THREE.FrontSide;
  if (glass.transparent) glass.forceSinglePass = true;
  const white = new THREE.Color(1, 1, 1);
  const tint = (m, base = gray) => new THREE.Color(m.color.r / base.color.r, m.color.g / base.color.g, m.color.b / base.color.b);
  const upper = tint(gray2), ink = tint(dark);
  const soot = new THREE.Color(.025, .028, .03);
  const steel = tint(dark, metal), gearPaint = tint(gray, metal);
  const V = p => new THREE.Vector3(...p);
  function add(batch, geo, color = white) {
    const flat = geo.index ? geo.toNonIndexed() : geo;
    for (const key of Object.keys(flat.attributes)) if (!['position', 'normal'].includes(key)) flat.deleteAttribute(key);
    const colors = new Float32Array(flat.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
    flat.setAttribute('color', new THREE.BufferAttribute(colors, 3)); batch.push(flat);
    if (flat !== geo) geo.dispose();
  }
  function finish(batch, material, parent, name) {
    const mesh = new THREE.Mesh(mergeGeometries(batch, false), material);
    mesh.name = name; parent.add(mesh); batch.forEach(q => q.dispose()); return mesh;
  }
  function box(batch, size, pos, color = white) {
    add(batch, new THREE.BoxGeometry(...size).translate(...pos), color);
  }
  function tube(batch, a, b, radius, color = white, endRadius = radius) {
    const direction = V(b).sub(V(a));
    const geo = new THREE.CylinderGeometry(endRadius, radius, direction.length(), low ? 6 : 10);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V([0, 1, 0]), direction.normalize()));
    geo.translate(...V(a).add(V(b)).multiplyScalar(.5).toArray()); add(batch, geo, color);
  }
  function polygon(batch, points, color = white) {
    const verts = [];
    for (let i = 1; i < points.length - 1; i++) verts.push(...points[0], ...points[i], ...points[i + 1]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.computeVertexNormals(); add(batch, geo, color);
  }
  function prism(batch, outline, thickness, vertical = false, color = white, transform = null) {
    const shape = new THREE.Shape();
    outline.forEach(([a, b], i) => i ? shape.lineTo(a, b) : shape.moveTo(a, b)); shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, steps: 1 });
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const a = p.getX(i), b = p.getY(i), t = p.getZ(i) - thickness / 2;
      p.setXYZ(i, vertical ? t : a, vertical ? a : -t, b);
    }
    geo.computeVertexNormals(); if (transform) geo.applyMatrix4(transform); add(batch, geo, color);
  }
  // Smooth closed foil, ordered from negative X to positive X. Explicit leading
  // and trailing edges avoid the quarter-chord/sweep ambiguity of wingPanel().
  function foil(batch, stations, color = white) {
    const n = high ? 20 : low ? 8 : 12, verts = [], idx = [], ring = 2 * (n + 1);
    for (const [x, y, le, te, thickness] of stations) for (const sign of [1, -1]) for (let j = 0; j <= n; j++) {
      const f = sign > 0 ? j / n : 1 - j / n;
      verts.push(x, y + thickness * Math.sin(Math.PI * Math.sqrt(f)) * (sign > 0 ? .65 : -.35), le + (te - le) * f);
    }
    for (let k = 0; k < stations.length - 1; k++) for (let j = 0; j < ring; j++) {
      const a = k * ring + j, b = k * ring + (j + 1) % ring;
      idx.push(a, b, b + ring, a, b + ring, a + ring);
    }
    for (let j = 1; j < ring - 1; j++) {
      idx.push(0, j + 1, j); const b = (stations.length - 1) * ring;
      idx.push(b, b + j, b + j + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); geo.setIndex(idx);
    geo.computeVertexNormals(); add(batch, geo, color);
  }
  // Rounded rectangular sections: broad level deck and belly, soft chine corners.
  // A low cockpit sill leaves the pilot's eye inside the bubble, above the skin.
  function hull(batch, stations, offsetX = 0, twoTone = true, power = .48) {
    const verts = [], idx = [];
    for (const [z, w, bottom, top, centerX = offsetX] of stations) for (let j = 0; j <= segments; j++) {
      const a = j / segments * 2 * Math.PI, sn = Math.sin(a), cs = Math.cos(a);
      const y = (top + bottom) / 2 + (top - bottom) * .5 * Math.sign(sn) * Math.pow(Math.abs(sn), power);
      verts.push(centerX + w * Math.sign(cs) * Math.pow(Math.abs(cs), power), y, z);
    }
    for (let k = 0; k < stations.length - 1; k++) for (let j = 0; j < segments; j++) {
      const a = k * (segments + 1) + j, b = a + segments + 1;
      idx.push(a, a + 1, b + 1, a, b + 1, b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    const start = batch.length; add(batch, geo);
    if (twoTone) {
      const flat = batch[start], p = flat.attributes.position, c = flat.attributes.color;
      for (let i = 0; i < p.count; i++) {
        const z = p.getZ(i), y = p.getY(i);
        const color = z < -6.9 ? upper.clone().multiplyScalar(z < -8.25 ? .65 : .90) : y > .05 ? upper : white;
        c.setXYZ(i, color.r, color.g, color.b);
      }
    }
  }
  hull(skin, [[-8.7,.008,-.28,-.26],[-8.45,.18,-.42,-.10],[-7.9,.40,-.58,.17],[-7.15,.61,-.70,.39],
    [-6.5,.73,-.79,.48],[-5.4,.89,-.87,.48],[-4.1,.94,-.90,.51],[-3,.95,-.90,.50],
    [-1.5,.95,-.90,.50],[.5,1.10,-.87,.60],[2,1.26,-.85,.72],[4.7,1.38,-.79,.84],
    [6.3,1.22,-.73,.77],[7.15,.99,-.68,.50],[7.62,.65,-.55,.22],[7.72,.01,-.28,-.26]]);
  // Low broad spine joins the cockpit deck to the shoulders beneath both fins.
  hull(skin, [[-3.6,.40,.43,.60],[-2.8,.70,.46,.72],[1.8,.86,.55,.94],
    [4.8,.94,.65,.91],[6.5,.72,.44,.72],[7.35,.40,.13,.35],[7.55,.01,.12,.14]]);
  // Canopy is two open-bottom shells, with continuous curved normals and no
  // duplicate inner faces. The fixed windscreen ends at the separate canopy bow.
  function bubble(stations) {
    const verts = [], idx = [], n = segments / 2;
    for (const [z, w, base, height] of stations) for (let j = 0; j <= n; j++) {
      const a = Math.PI * j / n;
      verts.push(w * Math.cos(a), base + height * Math.sin(a), z);
    }
    for (let k = 0; k < stations.length - 1; k++) for (let j = 0; j < n; j++) {
      const a = k * (n + 1) + j, b = a + n + 1; idx.push(a, a + 1, b + 1, a, b + 1, b);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(idx); geo.computeVertexNormals(); add(glazing, geo);
  }
  bubble([[-6.82,.06,.47,.04],[-6.60,.35,.48,.29],[-6.15,.57,.49,.66],[-5.89,.62,.49,.88]]);
  bubble([[-5.84,.62,.49,.90],[-5.45,.68,.49,1.08],[-4.9,.70,.50,1.10],[-4.35,.64,.51,.91],[-3.85,.47,.54,.49],[-3.51,.045,.58,.02]]);
  for (const [z, w, base, h] of [[-5.865,.636,.49,.914],[-3.58,.18,.56,.11]]) {
    for (let j = 0; j < segments / 2; j++) {
      const p = a => [w * Math.cos(a), base + h * Math.sin(a), z];
      tube(skin, p(j * 2 * Math.PI / segments), p((j + 1) * 2 * Math.PI / segments), .026, upper);
    }
  }
  for (const s of [-1, 1]) {
    const sill = [[s*.06,.48,-6.82],[s*.57,.49,-6.15],[s*.65,.49,-5.86],[s*.70,.50,-4.9],[s*.64,.51,-4.35],[s*.47,.54,-3.85],[s*.045,.59,-3.51]];
    for (let i = 0; i < sill.length - 1; i++) tube(skin, sill[i], sill[i + 1], .035, upper);
  }
  const half = def.span / 2, wy = -.20, trailing = 3.70, hinge = 2.56;
  const leading = x => -1.50 + (x - .95) * Math.tan(22 * DEG);
  for (const s of [-1, 1]) {
    // Exposed thin LEX: the inboard edge enters the chine, the outboard edge
    // spreads .9 m beyond the root. Its forward point meets the canopy-side deck.
    const lex = [[s*.87,-5.65],[s*1.00,-5.50],[s*1.14,-4.65],[s*1.40,-3.45],
      [s*1.70,-2.25],[s*1.85,-1.50],[s*.91,-1.24],[s*.86,-3.4]];
    const lexBatch = [];
    prism(lexBatch, lex, .065, false, upper);
    for (const geo of lexBatch) {
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const f = THREE.MathUtils.clamp((p.getZ(i) + 5.5) / 4, 0, 1);
        const droop = Math.max(0, Math.abs(p.getX(i)) - .95) * .055;
        p.setY(i, p.getY(i) + .24 - .40*f - droop);
      }
      geo.computeVertexNormals(); paint.push(geo);
    }
    // Rounded rectangular mouths are open ahead of the ducts. The splitter gap
    // remains visible between each scoop and the central body's sidewall.
    const x = s * 1.43, front = -3.60, back = -2.22;
    const rim = [[-.30,-.45],[.30,-.45],[.375,-.375],[.375,.375],
      [.30,.45],[-.30,.45],[-.375,.375],[-.375,-.375]];
    const mouth = rim.map(([dx,dy])=>[x+dx,-.90+dy,front]);
    const inner = rim.map(([dx,dy])=>[x+dx*.84,-.90+dy*.84,back]);
    polygon(paint, inner.slice().reverse(), soot);
    for (let j = 0; j < mouth.length; j++) {
      const k = (j + 1) % mouth.length;
      polygon(paint, [mouth[j],inner[j],inner[k],mouth[k]], ink);
      tube(paint, mouth[j], mouth[k], .032, upper);
    }
    box(paint,[.035,.96,1.46],[s*1.005,-.90,-2.96],upper);
    // Exterior walls start at the lip; the dark throat is recessed 1.38 m aft.
    // Match the mouth outline here so no solid body blocks the aperture.
    const ductRings = [mouth,
      rim.map(([dx,dy])=>[x+dx*1.12,-.88+dy*1.08,back+.03]),
      rim.map(([dx,dy])=>[s*1.23+dx*1.45,-.68+dy*1.25,.7]),
      rim.map(([dx,dy])=>[s*.88+dx*1.55,-.36+dy*1.28,3.8]),
      rim.map(([dx,dy])=>[s*.70+dx*1.47,-.30+dy*1.22,6.3])];
    for (let k = 0; k < ductRings.length-1; k++) for (let j = 0; j < rim.length; j++) {
      const n = (j+1)%rim.length;
      polygon(paint,[ductRings[k][j],ductRings[k][n],ductRings[k+1][n],ductRings[k+1][j]]);
    }
    // Twin engine lobes stay on the nozzle axes, with the spine bridging above.
    const trunk = lathe([[2.8,.55],[4.5,.58],[6.1,.57],[7.45,.57],[7.67,.54]],segments,.95).translate(s*.70,-.30,0);
    add(paint,trunk);
    // Wing fixed geometry stops at the control hinges. Overall LE sweep is 22
    // degrees and the complete trailing edge is straight across the spread wing.
    const xs = [.95,2.0,half*.60,half-.09].map(x=>s*x).sort((a,b)=>a-b);
    foil(paint,xs.map(x=>[x,wy,leading(Math.abs(x))+.30,hinge-.025,(trailing-leading(Math.abs(x)))*.06]));
    const droop = 18 * DEG;
    const leadingFlap = [];
    foil(leadingFlap,xs.map(x=>[x,wy,leading(Math.abs(x)),leading(Math.abs(x))+.30,.045]),upper);
    for (const geo of leadingFlap) {
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const hingeZ = leading(Math.abs(p.getX(i))) + .30;
        const dz = p.getZ(i) - hingeZ, dy = p.getY(i) - wy;
        p.setXYZ(i, p.getX(i), wy + dy*Math.cos(droop) + dz*Math.sin(droop), hingeZ + dz*Math.cos(droop) - dy*Math.sin(droop));
      }
      geo.computeVertexNormals(); paint.push(geo);
    }
    const fold = half * .60;
    tube(paint,[s*fold,wy+.04,leading(fold)+.1],[s*fold,wy+.105,hinge-.03],.012,ink);
    box(paint,[.105,.085,.48],[s*fold,wy+.10,leading(fold)+.62],upper);
    function control(name, inner, outer, flap) {
      const pivot = new THREE.Group(); pivot.name = name;
      pivot.position.set(s*(inner+outer)/2,wy,hinge); const batch = [];
      foil(batch,[-(outer-inner)/2,(outer-inner)/2].map(x=>[x,0,.018,trailing-hinge,.064]));
      if (high) box(batch,[(outer-inner)*.6,.008,.075],[0,.032,trailing-hinge-.12],upper);
      finish(batch,gray,pivot,name+':panel');g.add(pivot);
      if (flap) parts.flaps.push(pivot); else parts[s<0?'aileronL':'aileronR']=pivot;
    }
    control('flap:'+s,1.12,fold-.04,true);
    control('aileron:'+s,fold+.04,half-.10,false);
    // Spread wingtip launch rails, with the small rail body only at high detail.
    box(paint,[.095,.11,2.08],[s*(half-.025),wy,1.78],upper);
    if (high) {
      hull(paint,[[.56,.018,wy-.075,wy-.025],[.76,.095,wy-.14,wy+.04],[2.6,.085,wy-.14,wy+.04],[2.88,.02,wy-.075,wy-.025]],s*(half-.025),false);
      for (const z of [1.0,2.3]) box(paint,[.14,.10,.16],[s*(half-.025),wy-.12,z],ink);
    }
    // A deep, tapered weapons pylon at 45% semispan; no external stores.
    prism(paint,[[-.32,-.33],[-.48,-.16],[-.94,.40],[-.96,1.96],[-.76,2.26],[-.32,2.39]],.15,true,upper,
      new THREE.Matrix4().makeTranslation(s*half*.45,0,0));
    tube(hardware,[s*half*.45,-.96,.51],[s*half*.45,-.96,1.82],.045,steel);
    // Whole stabilators rotate about the fuselage-side trunnion.
    const stab = new THREE.Group();stab.name='stabilator:'+s;stab.position.set(s*1.18,-.24,6.43);
    const sb=[];
    foil(sb,[0,1.6,2.80].map(x=>[s*x,-x*.035,-1.13+x*Math.tan(35*DEG),1.94+x*.05,.13-x*.025]).sort((a,b)=>a[0]-b[0]));
    finish(sb,gray,stab,'stabilator:'+s+':surface');g.add(stab);parts.elevator.push(stab);
    // Fin geometry and rudder share an outward-canted local frame. The rudder
    // hinge is local Y (engine rotation.y); its entire panel is aft of that line.
    const finMatrix = new THREE.Matrix4().makeRotationZ(-s*20*DEG);
    finMatrix.setPosition(s*1.36,.82,3.72);
    prism(paint,[[0,-.68],[.45,-.52],[3.26,1.56],[3.18,2.51],[.18,2.51],[0,2.15]],.12,true,upper,finMatrix);
    const rud = new THREE.Group();rud.name='rudder:'+s;rud.rotation.z=-s*20*DEG;
    rud.position.copy(V([0,.40,2.54]).applyMatrix4(finMatrix));
    const rb=[];prism(rb,[[0,0],[2.76,0],[2.65,.58],[.16,.84],[0,.68]],.075,true,upper);
    finish(rb,gray,rud,'rudder:'+s+':panel');g.add(rud);parts.rudder.push(rud);
    prism(paint,[[0,-1.02],[.31,-.39],[.42,1.64],[0,2.91]],.43,true,upper,finMatrix);
    // Open afterburner: outer ring of overlapping petals and an inward-facing
    // jet pipe. The inset disk is well upstream of the exit, never a capped tube.
    const ex = s*.70, ey=-.30;
    add(hardware,lathe([[7.47,.56],[7.63,.58],[7.79,.56]],segments).translate(ex,ey,0),steel);
    const petals = high ? 24 : low ? 12 : 16;
    for (let j=0;j<petals;j++) {
      const a=j/petals*2*Math.PI,b=(j+.93)/petals*2*Math.PI;
      const p=(t,r,z)=>[ex+r*Math.cos(t),ey+r*Math.sin(t),z];
      polygon(hardware,[p(a,.56,7.77),p(b,.56,7.77),p(b,.43,8.60),p(a,.43,8.60)],j%2?steel:steel.clone().multiplyScalar(.78));
      polygon(hardware,[p(a,.405,8.60),p(b,.405,8.60),p(b,.37,7.42),p(a,.37,7.42)],soot);
      polygon(hardware,[p(a,.43,8.60),p(b,.43,8.60),p(b,.405,8.60),p(a,.405,8.60)],steel);
    }
    add(hardware,new THREE.CircleGeometry(.37,segments).translate(ex,ey,7.42),soot);
    for (const z of [7.65,8.12]) add(hardware,new THREE.TorusGeometry(z<8?.38:.398,.018,6,segments).translate(ex,ey,z),steel);
  }
  box(hardware,[.24,.18,.52],[0,-.64,8.08],steel);
  // Hook is a direct child; the centre of its shoe is exactly one shank length
  // aft of the prescribed pivot. Positive X deployment lowers the shoe.
  const hook = new THREE.Group();hook.name='arrestor-hook';
  hook.position.set(def.hook.pivot.x,def.hook.pivot.y,def.hook.pivot.z);
  const hb=[], length=def.hook.length;
  tube(hb,[0,0,0],[0,0,length],.085,steel,.045);
  tube(hb,[0,.10,.08],[0,.12,1.14],.075,gearPaint,.05);
  tube(hb,[0,.12,1.14],[0,.015,1.62],.033);
  prism(hb,[[.06,length-.15],[.04,length+.10],[-.13,length+.15],[-.23,length-.06],[-.22,length-.31],[-.13,length-.32],[-.14,length-.12]],.16,true,steel);
  tube(hb,[-.14,0,0],[.14,0,0],.11,gearPaint);
  finish(hb,metal,hook,'hook:shank-damper-and-shoe');g.add(hook);parts.hook=hook;
  def.gear.forEach((leg,i)=>{
    const pivot=new THREE.Group();pivot.name='gear:'+leg.name;
    pivot.position.set(leg.pos.x,leg.pos.y+1.5,leg.pos.z);
    const strut=new THREE.Group();strut.position.y=-1.5;pivot.add(strut);g.add(pivot);
    const gb=[], main=leg.main,s=Math.sign(leg.pos.x)||1;
    tube(gb,[0,.12,0],[0,1.45,-.13],main?.11:.095,gearPaint);
    tube(gb,[0,.05,0],[0,.62,-.04],main?.073:.064);
    tube(gb,[-(main?.20:.30),0,0],[(main?.20:.30),0,0],.065);
    tube(gb,[0,.34,0],[-s*.36,1.20,-.12],.043,gearPaint);
    tube(gb,[-s*.36,1.20,-.12],[0,1.42,-.13],.05,gearPaint);
    box(gb,[main?.37:.25,.78,.055],[main?-s*.19:.17,.99,-.21],gearPaint);
    if (high) {
      for (const dx of [-.065,.065]) {
        tube(gb,[dx,.22,.04],[dx,.43,.22],.022,steel);
        tube(gb,[dx,.43,.22],[dx,.71,.04],.022,steel);
      }
      if (!main) {
        tube(gb,[-.10,.30,-.06],[-.10,-.03,-.65],.036,gearPaint);
        tube(gb,[.10,.30,-.06],[.10,-.03,-.65],.036,gearPaint);
        tube(gb,[-.17,-.03,-.65],[.17,-.03,-.65],.045,steel);
      }
    }
    if (!main) {
      box(gb,[.18,.15,.12],[0,.15,-.24],steel);
      add(gb,new THREE.CircleGeometry(.061,12).rotateY(Math.PI).translate(0,.15,-.305));
    }
    finish(gb,metal,strut,'gear:'+leg.name+':oleo-braces-door');
    // One spinning mesh per axle, including BOTH nose tyres and their hubs.
    // Keep local Y as the tyre shader's axle, rotate the mesh's geometry frame
    // under a Group whose X axis is the engine's wheel-spin axis.
    const wheels=new THREE.Group();wheels.name='wheel:'+leg.name;strut.add(wheels);
    const wb=[],r=leg.radius,w=main?.26:.16;
    for(const dx of main?[0]:[-.19,.19]) {
      const profile=[[r*.43,-w*.5],[r*.72,-w*.52],[r*.93,-w*.37],[r,-w*.10],[r,w*.10],[r*.93,w*.37],[r*.72,w*.52],[r*.43,w*.5]];
      add(wb,new THREE.LatheGeometry(profile.map(p=>new THREE.Vector2(...p)),segments).translate(0,dx,0));
      add(wb,new THREE.CylinderGeometry(r*.44,r*.44,w*1.02,low?10:20).translate(0,dx,0),tint(metal,tire));
    }
    const wm=finish(wb,tire,wheels,'wheel:'+leg.name+':tyres-and-hubs');wm.rotation.z=-Math.PI/2;
    parts.legs[i]={root:pivot,pivot,strut,wheels:[wheels],axis:'x',angle:(main?95:-95)*DEG,y0:-1.5};
  });
  anchors.pitot=V([.46,-.21,-8.20]);
  tube(skin,[.50,-.18,-7.69],anchors.pitot.toArray(),.012,ink);
  const navL=V([-half,wy,1.55]),navR=V([half,wy,1.55]),navT=V([0,-.12,8.30]),navB=V([0,.99,1.85]);
  box(paint,[.12,.065,.16],navB.toArray(),ink);
  box(hardware,[.12,.11,.18],navT.toArray(),steel);
  parts.lights=navLights(g,navL,navR,navT,navB);
  anchors.landingLight={position:V([0,-1.90,-4.905]),target:V([0,-6,-60])};
  parts.landingLight=landingLight(g,anchors.landingLight.position,anchors.landingLight.target,600,{distance:500,angle:.3});
  anchors.exhaust=def.engines.map(e=>anchor(e.pos.x,e.pos.y,8.60,0,0,1,.405));
  anchors.eye=V([def.eye.x,def.eye.y,def.eye.z]);
  anchors.navLeft=navL;anchors.navRight=navR;anchors.tail=navT;anchors.beacon=navB;
  anchors.wingtipL=navL.clone();anchors.wingtipR=navR.clone();
  anchors.hookPivot=hook.position.clone();
  finish(paint,gray,g,'exterior:LEX-wings-intakes-trunks-fins-and-pylons');
  finish(hardware,metal,g,'exterior:nozzles-and-hardware');
  parts.hideInCockpit.push(finish(skin,gray,g,'cockpit-hidden:fuselage-spine-radome-and-canopy-frames'));
  parts.hideInCockpit.push(finish(glazing,glass,g,'cockpit-hidden:fixed-windscreen-and-bubble-canopy'));
  shadowAll(g);
  return {group:g,parts,anchors,bounds:measureBounds(g)};
}
