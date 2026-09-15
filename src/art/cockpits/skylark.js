// The Skylark 172 cockpit: a Cessna-172-class trainer flown from the left seat.
// Two control YOKES (the left one is the pilot's: it rotates for roll and slides in
// and out for pitch), rudder pedals with toe brakes, a centre pedestal below the
// panel with the push-pull THROTTLE and mixture knobs, the flap switch/indicator on
// the right of the panel, a big trim wheel on the pedestal, a six-pack of round
// instruments (airspeed, attitude, altimeter; turn coordinator, heading, vertical
// speed) in front of the pilot, engine gauges (RPM, oil, fuel) to the right, a row
// of rocker switches and circuit breakers along the bottom, a magneto key, a stall
// warning light, a glareshield with a compass on the windshield post, big flat
// windshield with a centre post, side windows with a wing strut visible outside, the
// high wing as a roof, two seats, and a door frame on each side. Fixed gear: no gear
// lever or gear lights.
//
// ================================ THE COCKPIT CONTRACT =================================
//
// This file is the interior of one aircraft, seen from the cockpit camera. It is the
// specification for whoever works here; keep this header.
//
//   export function buildCockpit(def, ctx) -> { group, parts, update(state), look, dispose? }
//
// COORDINATES: the aircraft's BODY FRAME (forward -Z, up +Y, right +X, metres,
// relative to the CG). The pilot's eye is at ctx.eye (= def.eye); build the panel about
// 0.65-0.8 m ahead of it, the seat behind it. The engine parents `group` to the
// aircraft, so it moves with the airframe; never set group.position.
//
// `ctx`: { materials, detail, eye, seed, anchors }
//   materials  LIVERY[def.id]() - the exterior vocabulary (glass, metal, dark, tire and
//              the paint colours). Make your own interior materials in THIS call - never
//              cached across calls - and NAME every one ('skylark:cockpit:xxx').
//   detail     'high' | 'medium' | 'low'. Fewer switches and segments on the lower tiers.
//   eye        THREE.Vector3, the pilot's eye (= def.eye)
//   anchors    the exterior airframe's anchors (wingtips, propHub...) for reference
//
// RENDERING FACTS: the interior is drawn on its own layer by a second camera with a
// 0.03 m near plane, AFTER the world, so nothing here need worry about the world's
// depth. Glass must be `transparent` with depthWrite false. The exterior's wings,
// struts, gear and propeller stay visible outside the windows (the fuselage skin is
// hidden); everything else outside the glass is yours to draw (window frames, sills,
// the cowl visible over the glareshield). The engine forces fog off and shadows off on
// every mesh here, and gives the scene's lights this layer, so standard materials are
// lit by the sun and the sky exactly as the exterior is; use state.sunDir (body frame)
// and state.dayness/state.night for anything of your own (panel flood lights at night).
//
// `update(state)` is called once per frame while the cockpit view is up, with the same
// object every time (read it, never keep a copy). Every value the game has:
//   t, dt                    seconds
//   elevator, aileron, rudder  where the control surfaces ARE, -1..1
//   pitchInput, rollInput, yawInput, trim   what the pilot commands, -1..1
//   throttle[i]              commanded lever position 0..1 per engine
//   throttleActual[i]        the engine's response (spool lag), rpm[i] 0..1 (props:
//                            0.25 idle..1), n1[i] (jets), egt[i] 0..1, failed[i], reverse 0..1
//   flap 0..1, flapCmd, flapDetent (index), flapLabel ('UP','10'...), flapDetents[], flapLabels[]
//   gear 0..1, gearCmd 0|1, gearRetract, gearLocked[3] (per leg: nose/left/right or
//                            left/right/tail in def.gear order), gearTransit
//   spoiler 0..1, spoilerArmed, hook 0..1, hookCmd, hasHook, hasSpoilers, brake 0..1,
//   autobrake (0, 0.35 med, 0.7 max), hasAutobrake
//   ias, tas, gs (knots), alt, radioAlt (feet), vs (feet/min), heading, pitch, roll, aoa,
//   beta (degrees), gload, vref, vs0, vs1 (knot bugs), onSpeedAoA (deg, fighter)
//   stallWarning, stall 0..1, onGround, wheelsOnGround, trapped, failures (a Set of
//   names: 'engine', 'engineLeft', 'flapsStuck', 'noseGear', 'gearStuck', 'hydraulics',
//   'brakes', 'elevatorJam', 'ice')
//   ils { gsDots, locDots } or null, ilsGs, ilsLoc; meatball or null
//   time (hours), dayness 0..1, night, sunDir (BODY frame), sunDirWorld,
//   windDir, windSpeed (deg, knots), headYaw, headPitch (where the pilot is looking)
//
// CONTROL SIGNS (see common.js): elevator > 0 = pulling (yoke toward the pilot);
// aileron > 0 = roll right (yoke clockwise); rudder > 0 = nose right (right pedal
// forward); throttle 1 = lever full forward; trim > 0 = nose up.
//
// `parts`: the named moving nodes, so the test can see them move: for this aircraft
// yoke, pedalL, pedalR, throttle[1], flapLever, trimWheel, asi, alt, vsi, turn, hdgCard,
// attitude, rpm[1], stallLight, panel, glareshield, seat, windshield.
//
// `look`: { yaw, pitch } in radians - how far the head may turn here. A high-wing
// cabin with side windows and a rear window lets you look well over your shoulder.
//
// BUDGET (ctx.detail 'high'): <= 80k triangles, <= 20 draw calls. Share materials and
// merge static geometry by material; separate meshes only for what moves. Instrument
// faces are procedural canvas textures (<= 2048 px) drawn ONCE; moving readings are
// needle/card meshes, or a canvas display uploaded at <= 20 Hz via makeDisplay() in
// common.js - never a texture upload per frame. No Math.random (makeRng with
// ctx.seed). No shader uniforms named at*. No per-frame allocations in update().
// =======================================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DEG, clamp } from '../../config.js';
import { mat } from './common.js';

// One immutable 4 x 4 atlas: six-pack, horizon, engine faces, radio stack and
// placards. Even the radios are painted once; the state has no tuning fields.
function instrumentAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 2048;
  const c = canvas.getContext('2d'), cell = 512;
  c.fillStyle = '#151819'; c.fillRect(0, 0, 2048, 2048);
  function tile(i, paint) {
    c.save(); c.translate((i % 4) * cell + 256, Math.floor(i / 4) * cell + 256);
    c.fillStyle = '#101516'; c.fillRect(-256, -256, 512, 512);
    c.strokeStyle = '#e2dec9'; c.fillStyle = '#e2dec9'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '26px sans-serif'; paint(); c.restore();
  }
  function line(x, y, xx, yy, color = '#e2dec9', width = 3) {
    c.strokeStyle = color; c.lineWidth = width; c.beginPath(); c.moveTo(x, y); c.lineTo(xx, yy); c.stroke();
  }
  function label(s, y, size = 24) { c.font = `${size}px sans-serif`; c.fillStyle = '#e2dec9'; c.fillText(s, 0, y); }
  function scale(min, max, step, angle, major = 2, radius = 206) {
    let j = 0;
    for (let v = min; v <= max + .001; v += step, j++) {
      const a = angle(v), big = j % major === 0;
      line(Math.sin(a) * radius, -Math.cos(a) * radius, Math.sin(a) * (radius - (big ? 25 : 12)), -Math.cos(a) * (radius - (big ? 25 : 12)));
      if (big) { c.font = '28px sans-serif'; c.fillStyle = '#e2dec9'; c.fillText(String(v), Math.sin(a) * (radius - 52), -Math.cos(a) * (radius - 52)); }
    }
  }
  function arc(a, b, r, color, width = 10) {
    c.strokeStyle = color; c.lineWidth = width; c.beginPath(); c.arc(0, 0, r, a - Math.PI / 2, b - Math.PI / 2); c.stroke();
  }
  tile(0, () => {
    const a = v => v / 220 * 300 * DEG;
    arc(a(42), a(85), 221, '#e8e5d7'); arc(a(49), a(129), 237, '#5a9b60'); arc(a(129), a(160), 237, '#dec054');
    line(Math.sin(a(160)) * 213, -Math.cos(a(160)) * 213, Math.sin(a(160)) * 247, -Math.cos(a(160)) * 247, '#e34c39', 7);
    scale(0, 220, 10, a); label('AIRSPEED', 64); label('KNOTS', 98, 21);
  });
  tile(1, () => {
    for (const d of [-60, -30, -20, -10, 0, 10, 20, 30, 60]) {
      const a = d * DEG; line(Math.sin(a) * 224, -Math.cos(a) * 224, Math.sin(a) * 200, -Math.cos(a) * 200);
    }
    label('ATTITUDE', 175, 21);
  });
  tile(2, () => {
    scale(0, 9.8, .2, v => v / 10 * Math.PI * 2, 5);
    label('ALT', -62); label('FEET', 65); c.fillStyle = '#514e42'; c.fillRect(77, -25, 98, 44);
    c.fillStyle = '#eee9d0'; c.font = '26px monospace'; c.fillText('29.92', 126, -2); label('1000', 103, 20);
  });
  tile(3, () => {
    label('TURN COORDINATOR', -113, 21); label('L       2 MIN       R', 91, 24);
    line(-170, 0, -120, 0); line(120, 0, 170, 0);
    c.strokeStyle = '#ded9bd'; c.lineWidth = 7; c.beginPath(); c.arc(0, -220, 365, 62 * DEG, 118 * DEG); c.stroke();
    line(-27, 134, -27, 157); line(27, 134, 27, 157); label('NO PITCH INFORMATION', 207, 17);
  });
  tile(4, () => {
    for (let d = 0; d < 360; d += 5) {
      const a = d * DEG, r = d % 30 === 0 ? 177 : 190;
      line(Math.sin(a) * 220, -Math.cos(a) * 220, Math.sin(a) * r, -Math.cos(a) * r);
      if (d % 30 === 0) { c.font = '32px sans-serif'; c.fillStyle = '#e2dec9'; c.save(); c.rotate(a); c.fillText(({0:'N',90:'E',180:'S',270:'W'})[d] || String(d / 10), 0, -149); c.restore(); }
    }
  });
  tile(5, () => {
    scale(-20, 20, 2, v => (-90 + v / 20 * 150) * DEG, 5);
    label('VERTICAL SPEED', -75, 23); label('100 FEET / MIN', 70, 21); label('UP', -125, 20); label('DOWN', 120, 20);
  });
  tile(6, () => {
    c.fillStyle = '#4f8098'; c.fillRect(-256, -256, 512, 256); c.fillStyle = '#825c3e'; c.fillRect(-256, 0, 512, 256);
    line(-256, 0, 256, 0, '#e6dfbd', 4);
    // 512 pixels spans .15 m: the ladder matches .0012 m per degree.
    for (let d = -40; d <= 40; d += 5) if (d) {
      const y = -d * .0012 / .15 * 512, w = d % 10 ? 30 : 65;
      line(-w, y, w, y); if (d % 10 === 0) { c.font = '17px sans-serif'; c.fillStyle = '#eee9db'; c.fillText(String(Math.abs(d)), w + 21, y); }
    }
  });
  tile(7, () => { scale(0, 30, 1, v => v / 30 * 270 * DEG, 5); arc(21 / 30 * 270 * DEG, 27 / 30 * 270 * DEG, 234, '#74a367'); label('RPM', 58); label('HOURS  1387.4', 111, 21); });
  const titles = ['OIL PRESS / TEMP', 'FUEL LEFT', 'FUEL RIGHT', 'AMPS / SUCTION'];
  for (let i = 0; i < 4; i++) tile(8 + i, () => {
    scale(0, 10, 1, v => (-120 + v * 24) * DEG, 2); label(titles[i], 100, 22);
    const a = (.3 + i * .12) * Math.PI - Math.PI / 2;
    line(0, 0, Math.sin(a) * 160, -Math.cos(a) * 160, '#e8dfc0', 8);
    if (i === 0 || i === 3) { line(0, 30, 90, -60, '#daa457', 6); label(i === 0 ? 'PSI      C' : 'A      IN HG', 142, 21); }
    else label('E       GAL       F', 146, 22);
  });
  tile(12, () => {
    for (let i = 0; i < 3; i++) {
      const y = -225 + i * 151;
      c.fillStyle = '#282c2b'; c.fillRect(-250, y, 500, 139); c.fillStyle = '#08130e'; c.fillRect(-225, y + 33, 450, 67);
      c.font = '18px sans-serif'; c.fillStyle = '#ddd7be'; c.fillText(['NAV / COMM 1','NAV / COMM 2','TRANSPONDER  ALT'][i], 0, y + 17);
      c.font = '34px monospace'; c.fillStyle = '#a9d39b'; c.fillText(['118.700  110.50','121.500  113.90','1200    FL 045'][i], 0, y + 67);
      c.font = '15px sans-serif'; c.fillStyle = '#ddd7be'; c.fillText('VOL / SQ                 STBY       TUNE', 0, y + 119);
    }
  });
  tile(13, () => { label('SKYLARK 172', -208, 31); label('MASTER  AVIONICS  PUMP  BCN  NAV  STRB  LAND  PITOT', -110, 16); label('CARB      THROTTLE      MIXTURE', -5, 23); label('PRIMER     OFF  R  L  BOTH  START', 96, 19); label('PANEL             CABIN             BREAKERS', 192, 20); });
  tile(14, () => { label('WING FLAPS', -220, 25); for (let i = 0; i < 4; i++) { label(['UP','10','20','30'][i], -130 + i * 88, 37); } });
  tile(15, () => { label('FUEL SELECTOR', -195, 27); label('BOTH', -91, 35); label('LEFT                   RIGHT', 5, 27); label('OFF', 121, 30); label('TRIM     TAKE OFF', 217, 20); });
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4; texture.generateMipmaps = true; texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
}

export function buildCockpit(def, ctx) {
  const group = new THREE.Group(), parts = {}, low = ctx.detail === 'low';
  const segments = low ? 16 : ctx.detail === 'high' ? 40 : 24;
  const solid = mat('skylark:cockpit:paint-upholstery-hardware', 0xffffff, { roughness: .77, metalness: .12, emissive: 0x604229, emissiveIntensity: 0, extra: { vertexColors: true } });
  const texture = instrumentAtlas();
  const faces = mat('skylark:cockpit:instrument-atlas', 0xffffff, { roughness: .85, emissive: 0xffffff, emissiveIntensity: .16, extra: { map: texture, emissiveMap: texture } });
  const glass = mat('skylark:cockpit:glass', 0xb7cdd0, { transparent: true, opacity: .14, roughness: .18, side: THREE.DoubleSide });
  const stallMat = mat('skylark:cockpit:stall', 0x742318, { emissive: 0xff3418, emissiveIntensity: 0 });
  const batches = { solid: [], faces: [], glass: [] };
  const cream = 0xada797, dark = 0x242728, panel = 0x65685f, leather = 0x62594b, metal = 0xa5aaa6, ivory = 0xe5dfbd;
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
  const S = batches.solid, pz = ctx.eye.z - .7, top = ctx.eye.y - .12;
  // Actual exterior windshield corners (its roof leading edge is z=-.67, not
  // -1.3). Keep that slope and the cowl junction; the panel nests just inside it.
  // Base corners on the RIGHT (+x), like the door corners below: the loop multiplies both
  // by `side`. With the pane on the left and the door on the right of the same loop pass,
  // the pane-to-door infill quad ran diagonally across the cabin in front of the eye.
  const wind = [[.63,.27,-1.94],[0,.29,-2.03],[0,.965,-.67],[.61,.955,-.65]];
  // Frame each edge once: 40 mm outer posts and one 30 mm centre post.
  rod(S, wind[1], wind[2], .015, cream);
  for (const side of [-1, 1]) {
    const pane = wind.map(([x,y,z]) => [x * side,y,z]); quad(batches.glass, pane);
    rod(S, pane[0], pane[3], .020, cream);
    rod(S, pane[3], pane[2], .010, cream);
    rod(S, [side*.60,top,pz-.19], [0,top,pz-.19], .010, dark);
    const door = [[side*.676,.235,-1.64],[side*.613,.95,-.63],[side*.625,.95,.30],[side*.693,.235,.30]];
    const rear = [[side*.693,.235,.37],[side*.625,.95,.37],[side*.545,.70,1.15],[side*.586,.28,1.15]];
    for (const points of [door, rear]) { quad(batches.glass, points); for (let i=0;i<4;i++) rod(S,points[i],points[(i+1)%4],.016,cream); }
    // Closed boxes are visible from either seat. The upper infill follows the
    // exterior sill exactly, including the triangular front door corner.
    box(S,side*.625,-.25,-.72,.09,.98,2.12,cream);
    function wall(points) {
      quad(S,points,cream); quad(S,points.slice().reverse(),cream);
    }
    wall([[side*.60,.24,-1.94],door[0],door[3],[side*.60,.24,.30]]);
    wall([pane[0],pane[3],door[1],door[0]]);
    box(S,side*.625,.265,-.67,.09,.06,1.94,cream);
    box(S,side*.625,-.25,.74,.09,.98,.82,cream);
    wall([[side*.625,.24,.30],door[3],door[2],rear[1]]);
    wall([[side*.625,.24,.30],rear[1],rear[0],[side*.625,.24,.37]]);
    wall([[side*.625,.24,.37],rear[0],rear[3],[side*.625,.24,1.15]]);
    wall([rear[1],[side*.62,.965,.37],[side*.545,.965,1.15],rear[2]]);
    wall([rear[3],rear[2],[side*.545,.965,1.27],[side*.625,-.74,1.27]]);
    box(S,side*.613,-.18,-.67,.075,.075,.53,leather);
    rod(S,[side*.601,.08,-1.01],[side*.601,.08,-.88],.012,metal);
    rod(S,[side*.599,-.04,-.92],[side*.578,-.095,-.85],.009,metal);
    rod(S,[side*.578,-.095,-.85],[side*.55,-.095,-.85],.017,dark);
    // A 70 mm vent, mounted farther forward on the door post, not beside the eye.
    rod(S,[side*.647,.36,-1.46],[side*.617,.36,-1.46],.035,cream);
    rod(S,[side*.617,.36,-1.46],[side*.613,.36,-1.46],.028,dark);
    rod(S,[side*.610,.34,-1.46],[side*.610,.38,-1.46],.003,metal);
    box(S,side*.34,.905,-.65,.42,.015,.22,0x706e5d,.18);
    // Lower door seam, pocket, lock and exposed latch screws.
    box(S,side*.614,-.47,-.35,.028,.22,.49,leather);
    for (const z of [-1.22,.15]) rod(S,[side*.611,.14,z],[side*.60,.14,z],.006,metal);
  }
  box(S,0,.985,.21,1.24,.045,1.72,cream);
  box(S,0,.985,1.18,1.24,.045,.24,cream);
  box(S,0,.944,.07,.12,.018,.09,ivory);
  box(S,0,-.765,-.17,1.23,.06,2.9,0x333634);
  for (let i=0;i<(low?10:26);i++) box(S,-.58+i*(low?.12:.046),-.731,-.36,.004,.002,2.4,0x424440);
  box(S,0,.105,1.29,1.27,1.72,.07,cream);
  // Cushions, rolled side bolsters, stitching and headrests are behind the eye.
  for (const x of [-.33,.33]) {
    for (const rear of [false,true]) {
      const z = rear ? .72 : -.40;
      box(S,x,-.39,z,.47,.15,.54,leather);
      box(S,x,-.02,z+.23,.46,.66,.105,leather,-.12);
      box(S,x,.39,z+.27,.25,.18,.10,leather);
      for (const dx of [-.15,.15]) { rod(S,[x+dx,.26,z+.24],[x+dx,.34,z+.27],.008,metal); box(S,x+dx,-.34,z,.038,.05,.47,cream); }
      if (!low) for (let k=0;k<5;k++) box(S,x-.16+k*.08,-.018,z+.291,.003,.52,.004,0x8b8070,-.12);
      box(S,x+.19,-.29,z+.04,.026,.035,.25,dark); box(S,x+.19,-.265,z+.12,.04,.014,.046,metal);
    }
  }
  // Panel front is +Z; leave all glazing apertures genuinely open.
  box(S,0,.155,pz-.035,1.19,.49,.065,panel);
  box(S,0,top-.019,pz-.09,1.22,.035,.22,dark);
  rod(S,[-.60,top-.02,pz+.017],[.60,top-.02,pz+.017],.016,dark);
  box(S,0,-.34,pz+.13,.17,.51,.24,panel);
  face(15,0,-.22,pz+.256,.15,.22,false);
  rod(S,[0,-.24,pz+.267],[.045,-.18,pz+.278],.012,dark);
  // 70 mm whiskey compass beneath the rail, with an open pilot-facing bezel.
  // Reuse the atlas compass rose as a cylindrical card: no new texture/material.
  const compass = new THREE.Group(); compass.name = 'compass';
  compass.position.set(0,.87,-.77);
  compass.rotation.y = Math.atan2(ctx.eye.x,ctx.eye.z+.77);
  group.add(compass);
  rod(S,[0,.955,-.69],[0,.902,-.77],.004,dark);
  const housing=[];
  add(housing,new THREE.CylinderGeometry(.035,.035,.064,segments,1,true,Math.PI/3,Math.PI*4/3),dark);
  rod(housing,[0,-.032,0],[0,-.028,0],.035,dark);
  rod(housing,[0,.028,0],[0,.032,0],.035,dark);
  box(housing,0,0,.033,.0015,.033,.0015,ivory);
  mesh(housing,solid,'compass:body-bracket-lubber-line',compass);
  const cardGeo=new THREE.CylinderGeometry(.028,.028,.037,segments,1,true);
  const cardUV=cardGeo.attributes.uv;
  for(let i=0;i<cardUV.count;i++) {
    const a=cardUV.getX(i)*Math.PI*2, r=.27+cardUV.getY(i)*.20;
    cardUV.setXY(i,.5+Math.sin(a)*r,.5+Math.cos(a)*r);
  }
  const cardBatch=[]; add(cardBatch,atlasGeo(cardGeo,4));
  parts.compassCard=mesh(cardBatch,faces,'compass:rotating-card',compass);
  const gx = ctx.eye.x, gy = .307, gap = .123, r = .052;
  const locations = [[gx-gap,gy],[gx,gy],[gx+gap,gy],[gx-gap,gy-gap],[gx,gy-gap],[gx+gap,gy-gap]];
  for (let i=0;i<6;i++) {
    const [x,y] = locations[i];
    if (i !== 1 && i !== 4) face(i,x,y,pz+.012,r*2);
    ring(S,x,y,pz+.014,r,.005);
    if (!low) for (const dx of [-1,1]) for (const dy of [-1,1]) disc(S,x+dx*.045,y+dy*.045,pz+.018,.0023,metal);
  }
  // Horizon disc sits behind a fixed opaque square with a circular aperture.
  // The square is behind all neighbouring instruments and hides full pitch travel.
  const mask = new THREE.Shape(); mask.moveTo(-.113,-.113); mask.lineTo(.113,-.113); mask.lineTo(.113,.113); mask.lineTo(-.113,.113); mask.closePath();
  const hole = new THREE.Path(); hole.absarc(0,0,.043,0,Math.PI*2,true); mask.holes.push(hole);
  add(S,new THREE.ShapeGeometry(mask,segments).translate(gx,gy,pz+.005),panel);
  parts.attitude = new THREE.Group(); parts.attitude.position.set(gx,gy,pz+.002); group.add(parts.attitude);
  const ball = new THREE.Mesh(atlasGeo(new THREE.CircleGeometry(.075,segments),6),faces); parts.attitude.add(ball);
  // Fixed bank scale is an annulus, so it cannot cover the sky/ground ball.
  add(batches.faces,atlasGeo(new THREE.RingGeometry(.044,.051,segments),1).translate(gx,gy,pz+.014));
  for (const side of [-1,1]) { box(S,gx+side*.024,gy,pz+.019,.031,.003,.002,0xe6bd58); box(S,gx+side*.009,gy-.003,pz+.019,.003,.008,.002,0xe6bd58); }
  disc(S,gx,gy,pz+.019,.003,ivory);
  parts.hdgCard = new THREE.Group(); parts.hdgCard.position.set(gx,gy-gap,pz+.013); group.add(parts.hdgCard);
  parts.hdgCard.add(new THREE.Mesh(atlasGeo(new THREE.CircleGeometry(r-.003,segments),4),faces));
  box(S,gx,gy-gap+.045,pz+.021,.003,.012,.002,ivory);
  // Small moving readings share ONE geometry buffer/draw. Their named Object3Ds
  // still carry the exact contract transforms. Only ~200 vertices are transformed
  // per frame; no texture changes, scene traversal, temporary vectors or allocation.
  const readings = [], needleGeos = [];
  function reading(name,x,y,z,geo,color=ivory) {
    const node = new THREE.Group(); node.name=name; node.position.set(x,y,z); group.add(node);
    const batch=[]; add(batch,geo,color); const g=batch[0];
    readings.push({node, start:needleGeos.reduce((n,a)=>n+a.attributes.position.count,0), source:g.attributes.position.array.slice()});
    needleGeos.push(g); return node;
  }
  function needle(name,x,y,length,z=pz+.023) {
    return reading(name,x,y,z,new THREE.PlaneGeometry(.0025,length).translate(0,length*.40,0));
  }
  parts.asi=needle('asi',gx-gap,gy,.042);
  parts.alt=needle('alt',gx+gap,gy,.043);
  parts.altThousands=needle('altThousands',gx+gap,gy,.029,pz+.025);
  parts.vsi=needle('vsi',gx+gap,gy-gap,.042);
  const airplane=[]; add(airplane,new THREE.PlaneGeometry(.060,.003),ivory); add(airplane,new THREE.PlaneGeometry(.003,.022).translate(0,.005,0),ivory);
  parts.turn=reading('turn',gx-gap,gy-gap,pz+.023,mergeGeometries(airplane,false)); for(const g of airplane)g.dispose();
  parts.slipBall=reading('slipBall',gx-gap,gy-gap-.030,pz+.025,new THREE.CircleGeometry(.0045,12),0x191b19);
  parts.rpm=[needle('rpm',.37,.302,.039)];
  parts.flapNeedle=reading('flapIndicator',.499,.031,pz+.029,new THREE.PlaneGeometry(.010,.0025),ivory);
  face(7,.37,.302,pz+.012,.098); ring(S,.37,.302,pz+.013,.05);
  for(let i=0;i<4;i++) { const x=.30+(i%2)*.14,y=.184-Math.floor(i/2)*.103; face(8+i,x,y,pz+.012,.081);ring(S,x,y,pz+.014,.042); }
  face(12,.075,.24,pz+.012,.215,.285,false);
  for(let i=0;i<3;i++) for(const x of [-.023,.172]) { rod(S,[x,.31-i*.091,pz+.018],[x,.31-i*.091,pz+.044],.013,dark); ring(S,x,.31-i*.091,pz+.044,.012,.002,metal); }
  face(13,-.22,-.025,pz+.013,.69,.14,false);
  face(14,.54,-.012,pz+.014,.066,.145,false);
  // Master and avionics retain named ON meshes. Other fixed switches are merged;
  // the landing rocker has the live hinge supplied by the game state.
  for(let i=0;i<8;i++) {
    const x=-.521+i*.063;
    box(S,x,.045,pz+.015,.043,.024,.012,dark);
    if(i>1 && i!==6) box(S,x,.045,pz+.026,.033,.020,.012,0xbbb9aa,-.23);
    if(i<2) {
      const b=[]; box(b,0,0,0,.033,.020,.012,i===0?0x913a29:0xbbb9aa);
      const rocker=mesh(b,solid,i===0?'master':'avionics'); rocker.position.set(x,.045,pz+.026); rocker.rotation.x=-.23;
      parts[i===0?'master':'avionics']=rocker;
    }
  }
  parts.landingLight=moving('landingLight',-.521+6*.063,.045,pz+.026,b=>box(b,0,0,0,.033,.020,.012,ivory));
  for(let i=0;i<(low?7:14);i++) rod(S,[.18+i*.027,-.093,pz+.014],[.18+i*.027,-.093,pz+.024],.006,dark);
  for(const x of [-.49,-.41]) rod(S,[x,-.092,pz+.014],[x,-.092,pz+.039],.011,dark);
  disc(S,-.51,-.027,pz+.016,.022,dark);
  rod(S,[-.51,-.027,pz+.018],[-.51,-.027,pz+.047],.004,metal);
  box(S,-.504,-.02,pz+.051,.011,.023,.004,metal);
  rod(S,[-.43,-.025,pz+.02],[-.43,-.025,pz+.051],.010,metal);
  for(const [x,color] of [[-.245,dark],[-.055,0xac3023]]) {
    rod(S,[x,-.038,pz+.015],[x,-.038,pz+.063],.005,metal);
    rod(S,[x,-.038,pz+.060],[x,-.038,pz+.080],.015,color);
  }
  parts.throttle=[moving('throttle',-.15,-.038,pz+.074,b=>{rod(b,[0,0,-.070],[0,0,0],.005,metal);rod(b,[0,0,0],[0,0,.023],.019,dark);})];
  parts.flapLever=moving('flapLever',.49,.024,pz+.029,b=>{rod(b,[0,0,0],[0,0,.040],.004,metal);box(b,0,0,.043,.031,.010,.012,ivory);});
  parts.trimWheel=moving('trimWheel',.105,-.36,pz+.31,b=>{
    add(b,new THREE.TorusGeometry(.074,.009,6,segments).rotateY(Math.PI/2),dark);
    for(let i=0;i<6;i++){const a=i*Math.PI/3;rod(b,[0,0,0],[0,Math.cos(a)*.07,Math.sin(a)*.07],.0035,metal);}
    box(b,.011,.069,0,.004,.011,.017,ivory);
  });
  box(S,.121,-.284,pz+.31,.007,.007,.026,0xdcb96b);
  function yoke(x,name) {
    return moving(name,x,-.075,pz+.26,b=>{
      rod(b,[0,0,-.28],[0,0,.012],.013,metal); box(b,0,0,.02,.062,.045,.04,dark);
      for(const side of [-1,1]) {
        const points=[[0,-.005,.025],[side*.075,-.025,.025],[side*.115,.006,.028],[side*.122,.065,.031],[side*.10,.086,.031]];
        for(let i=0;i<points.length-1;i++)rod(b,points[i],points[i+1],.012,dark);
        box(b,side*.112,.076,.042,.014,.009,.009,side<0?0x8c352b:metal);
      }
      box(b,0,.005,.042,.030,.016,.003,metal);
    });
  }
  parts.yoke=yoke(gx,'yoke'); parts.copilotYoke=yoke(.33,'copilotYoke'); parts.yokeHome=parts.yoke.position.clone();
  for(const [name,x] of [['pedalL',gx-.09],['pedalR',gx+.09]]) {
    parts[name]=moving(name,x,-.60,pz+.10,b=>{
      rod(b,[-.06,0,0],[.06,0,0],.009,metal);box(b,0,.052,-.015,.105,.088,.019,dark,-.26);
      for(let i=0;i<4;i++)box(b,0,.021+i*.02,-.001,.09,.004,.005,metal,-.26);
    });parts[name].userData.z0=parts[name].position.z;
  }
  // Co-pilot footwell has the same pedal geometry, baked at neutral.
  for(const x of [.24,.42])box(S,x,-.548,pz+.085,.105,.088,.019,dark,-.26);
  parts.stallLight=new THREE.Mesh(new THREE.BoxGeometry(.038,.012,.008),stallMat);parts.stallLight.position.set(gx,.392,pz+.018);group.add(parts.stallLight);
  for(let i=0;i<4;i++)box(S,.23+i*.055,.389,pz+.012,.036,.010,.004,i===0?0x76562d:0x302e27);
  const staticMesh=mesh(S,solid,'cabin-panel-seats-and-fittings');
  parts.panel=parts.glareshield=parts.seat=staticMesh;
  mesh(batches.faces,faces,'atlas-faces-radios-placards');
  parts.windshield=mesh(batches.glass,glass,'windshield-door-and-rear-glass');
  const needles=mesh(needleGeos,solid,'batched-moving-readings');
  needles.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
  // Moving readings remain within the panel, so culling uses a fixed safe bound.
  needles.geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(0,.18,pz+.025),.8);
  const positions=needles.geometry.attributes.position;
  function update(s) {
    parts.yoke.rotation.z=parts.copilotYoke.rotation.z=-s.aileron*60*DEG;
    parts.yoke.position.z=parts.copilotYoke.position.z=parts.yokeHome.z+s.elevator*.08;
    parts.pedalR.position.z=parts.pedalR.userData.z0-s.rudder*.07;
    parts.pedalL.position.z=parts.pedalL.userData.z0+s.rudder*.07;
    parts.throttle[0].position.z=pz+.074-clamp(s.throttle[0],0,1)*.06;
    parts.flapLever.rotation.x=(-25+55*s.flapDetent/3)*DEG;
    parts.flapNeedle.position.y=.031-clamp(s.flap,0,1)*.079;
    parts.trimWheel.rotation.x=s.trim*4;
    parts.asi.rotation.z=-clamp(s.ias/220,0,1)*300*DEG;
    parts.alt.rotation.z=-(s.alt%1000)/1000*Math.PI*2;
    parts.altThousands.rotation.z=-(s.alt%10000)/10000*Math.PI*2;
    parts.vsi.rotation.z=(90-clamp(s.vs/2000,-1,1)*150)*DEG;
    parts.turn.rotation.z=-clamp(s.beta/10,-1,1)*30*DEG;
    parts.slipBall.position.x=gx-gap+clamp(s.beta/10,-1,1)*.023;
    parts.hdgCard.rotation.z=s.heading*DEG;
    parts.compassCard.rotation.y=-s.heading*DEG;
    parts.attitude.rotation.z=-s.roll*DEG;
    parts.attitude.position.y=gy-clamp(s.pitch,-25,25)*.0012;
    parts.rpm[0].rotation.z=-clamp(s.rpm[0],0,1)*270*DEG;
    parts.landingLight.rotation.x=s.radioAlt<600?-.23:.23;
    stallMat.emissiveIntensity=s.stallWarning && Math.floor(s.t*4)%2===0?2:0;
    const darkness=1-clamp(s.dayness ?? (s.night?0:1),0,1);
    faces.emissiveIntensity=.16+darkness*.75;solid.emissiveIntensity=darkness*.16;
    for(let j=0;j<readings.length;j++) {
      const r=readings[j],n=r.node,a=r.source,co=Math.cos(n.rotation.z),si=Math.sin(n.rotation.z);
      for(let k=0;k<a.length;k+=3)positions.setXYZ(r.start+k/3,co*a[k]-si*a[k+1]+n.position.x,si*a[k]+co*a[k+1]+n.position.y,a[k+2]+n.position.z);
    }
    positions.needsUpdate=true;
  }
  return {group,parts,update,look:{yaw:2.6,pitch:1.0}};
}
