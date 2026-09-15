// Helpers shared by the four cockpits in this directory, and the plain placeholder
// interior every cockpit starts from: boxes and cylinders in the right places that
// MOVE correctly (yoke or stick, pedals, throttles, flap and gear levers, trim wheel,
// a six-pack of needle instruments, gear and warning lights). The placeholder proves
// the render path and the state feed; the real interiors replace it file by file.
//
// COORDINATES: the cockpit is built in the aircraft's BODY FRAME (forward -Z, up +Y,
// right +X, metres, relative to the CG), around the pilot's eye at ctx.eye
// (= def.eye). The pilot looks toward -Z. An instrument face that the pilot reads
// therefore faces +Z. A needle is a mesh pointing +Y at rest and rotates about Z:
// rotation.z NEGATIVE turns it clockwise as the pilot sees it.
//
// CONTROL SIGNS (state values are -1..1):
//   elevator > 0  = the pilot is pulling: yoke slides toward +Z (aft), stick tilts
//                   back: stick.rotation.x = +elevator * throw
//   aileron > 0   = roll right: yoke.rotation.z = -aileron * throw (clockwise);
//                   stick.rotation.z = -aileron * throw (top of the stick to the right)
//   rudder > 0    = nose right = right pedal forward: pedalR.position.z = -rudder * travel,
//                   pedalL.position.z = +rudder * travel
//   throttle 0..1 = lever forward (toward -Z) with power: lever.rotation.x = lerp(+30 deg, -30 deg, throttle)
//   flap          = detent index 0..n-1 down the quadrant; gear lever down = position.y low
//   trim > 0      = nose up: the trim wheel rolls aft: wheel.rotation.x = +trim * 4 rad
//
// DISPLAYS: makeDisplay(w, h, hz) returns a canvas-backed texture with a rate-limited
// tick(t, draw) - the texture is uploaded at most hz times a second, never per frame.
// Needles are the cheap way: a rotating mesh costs nothing per frame.
import * as THREE from 'three';
import { DEG, clamp, lerp } from '../../config.js';

export function mat(name, color, o = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: o.roughness ?? 0.7, metalness: o.metalness ?? 0.1, ...(o.extra || {}) });
  m.name = name;
  if (o.emissive != null) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.emissiveIntensity ?? 1; }
  if (o.transparent) { m.transparent = true; m.opacity = o.opacity ?? 0.3; m.depthWrite = false; }
  if (o.side) m.side = o.side;
  // a transparent DoubleSide material is otherwise drawn as two passes and re-keys its shader every
  // frame (docs/PERF.md 9.3: 11-17k needsUpdate sets per 8 s from the placeholder glass)
  if (m.transparent && m.side === THREE.DoubleSide) m.forceSinglePass = true;
  return m;
}
export function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}
export function cyl(r1, r2, h, material, seg = 16) { return new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), material); }

// A round instrument: a face (a short cylinder pointing +Z at the pilot) with a
// needle. Returns { group, needle }. angle(value) is the caller's business.
export function gauge(radius, faceMat, needleMat, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const face = cyl(radius, radius, 0.01, faceMat, 20);
  face.rotation.x = Math.PI / 2;
  g.add(face);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, radius * 0.06, 6, 20), needleMat);
  rim.position.z = 0.005;
  g.add(rim);
  const needle = new THREE.Group();
  needle.position.z = 0.008;
  needle.add(box(radius * 0.08, radius * 0.9, 0.002, needleMat, 0, radius * 0.4, 0));
  g.add(needle);
  return { group: g, needle };
}

// A canvas display (PFD, ND, HUD symbology) uploaded at most hz times a second.
export function makeDisplay(w, h, hz = 20) {
  const has = typeof document !== 'undefined';
  const canvas = has ? document.createElement('canvas') : null;
  if (canvas) { canvas.width = w; canvas.height = h; }
  const ctx = canvas ? canvas.getContext('2d') : null;
  const texture = canvas ? new THREE.CanvasTexture(canvas) : new THREE.Texture();
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  let last = -1e9;
  return {
    canvas, ctx, texture, w, h, hz,
    tick(t, draw) {
      if (!ctx || t - last < 1 / hz) return false;
      last = t;
      draw(ctx, w, h, t);
      texture.needsUpdate = true;
      return true;
    },
  };
}

// The placeholder interior. spec:
//   control    'yoke' | 'stick'
//   engines    1 | 2
//   hotas      throttle on a left console (fighter) rather than a centre pedestal
//   gearLever  retractable gear
//   hook, spoilers, autobrake   the extra levers
//   efis       a canvas PFD instead of the six-pack
//   hud        a HUD glass with canvas symbology
//   cabin      { halfWidth, panelDist, panelTop (below the eye), panelBottom, roof, floor, wsTop, wsSlope, sideZ0, sideZ1 }
//   look       { yaw, pitch } head-turn limits, radians
export function placeholderCockpit(def, ctx, spec) {
  const eye = ctx.eye;
  const id = def.id;
  const c = spec.cabin;
  const M = ctx.materials;
  const panelMat = mat(`${id}:cockpit:panel`, 0x2a2c2e, { roughness: 0.85 });
  const trimMat = mat(`${id}:cockpit:trim`, 0x4a4d50, { roughness: 0.6, metalness: 0.3 });
  const faceMat = mat(`${id}:cockpit:face`, 0x0c0d0e, { roughness: 0.5 });
  const needleMat = mat(`${id}:cockpit:needle`, 0xf2f2f0, { roughness: 0.5 });
  const glassMat = mat(`${id}:cockpit:glass`, 0x9fc4de, { roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.16, side: THREE.DoubleSide });
  const seatMat = mat(`${id}:cockpit:seat`, 0x3d3a36, { roughness: 0.95 });
  const skinMat = mat(`${id}:cockpit:skin`, 0x8a8d90, { roughness: 0.6, metalness: 0.4, side: THREE.DoubleSide });
  const group = new THREE.Group();
  const parts = {};
  const ex = eye.x, ey = eye.y, ez = eye.z;
  const half = c.halfWidth;
  const pz = ez - c.panelDist;                      // the panel's face (z)
  const pTop = ey - c.panelTop, pBot = ey - c.panelBottom;
  // floor, roof, rear bulkhead, side walls (the inside of the skin)
  group.add(box(half * 2, 0.02, c.sideZ1 - c.sideZ0 + 0.6, skinMat, 0, ey - c.floor, (c.sideZ0 + c.sideZ1) / 2));
  group.add(box(half * 2, 0.02, c.sideZ1 - c.sideZ0 + 0.3, skinMat, 0, ey + c.roof, (c.sideZ0 + c.sideZ1) / 2 + 0.2));
  group.add(box(half * 2, c.roof + c.floor, 0.02, skinMat, 0, ey + (c.roof - c.floor) / 2, c.sideZ1 + 0.3));
  for (const s of [-1, 1]) {
    // side wall below the window sill, and the window above it
    group.add(box(0.02, c.floor - 0.25, c.sideZ1 - c.sideZ0 + 0.6, skinMat, s * half, ey - 0.25 - (c.floor - 0.25) / 2, (c.sideZ0 + c.sideZ1) / 2));
    const win = box(0.01, c.roof + 0.25, c.sideZ1 - c.sideZ0, glassMat, s * half, ey + (c.roof - 0.25) / 2, (c.sideZ0 + c.sideZ1) / 2);
    win.name = 'sideWindow'; group.add(win);
    // a window post at the front of the side window
    group.add(box(0.04, c.roof + 0.25, 0.04, skinMat, s * half, ey + (c.roof - 0.25) / 2, c.sideZ0));
  }
  // instrument panel + glareshield
  const panel = box(half * 2 - 0.04, pBot - pTop, 0.06, panelMat, 0, (pTop + pBot) / 2, pz - 0.03);
  group.add(panel); parts.panel = panel;
  const glare = box(half * 2, 0.03, 0.28, panelMat, 0, pTop + 0.015, pz - 0.12);
  group.add(glare); parts.glareshield = glare;
  // windshield: from the glareshield up and back to the roof
  const wsH = Math.hypot(c.wsTop - (c.panelTop - 0.03), c.wsSlope);
  const ws = box(half * 2, wsH, 0.01, glassMat, 0, ey + (c.wsTop - c.panelTop) / 2, pz - 0.12 + c.wsSlope / 2);
  ws.rotation.x = Math.atan2(c.wsSlope, c.wsTop + c.panelTop);
  ws.name = 'windshield';
  group.add(ws); parts.windshield = ws;
  // seat
  const seat = new THREE.Group();
  seat.add(box(0.5, 0.08, 0.5, seatMat, ex, ey - 0.62, ez + 0.28));
  seat.add(box(0.5, 0.7, 0.08, seatMat, ex, ey - 0.25, ez + 0.5));
  group.add(seat); parts.seat = seat;
  // ----- primary flight control -----
  if (spec.control === 'yoke') {
    const yoke = new THREE.Group();
    yoke.position.set(ex, ey - 0.36, pz + 0.42);
    const shaft = cyl(0.015, 0.015, 0.5, trimMat, 8); shaft.rotation.x = Math.PI / 2; shaft.position.z = -0.25; yoke.add(shaft);
    const hub = box(0.06, 0.08, 0.05, trimMat, 0, 0, 0); yoke.add(hub);
    for (const s of [-1, 1]) {
      yoke.add(box(0.13, 0.03, 0.03, trimMat, s * 0.09, 0.05, 0));
      const grip = cyl(0.018, 0.018, 0.16, seatMat, 8); grip.position.set(s * 0.16, 0.12, 0); yoke.add(grip);
    }
    group.add(yoke); parts.yoke = yoke; parts.yokeHome = yoke.position.clone();
  } else {
    const stick = new THREE.Group();
    stick.position.set(ex, ey - 0.75, ez - 0.35);
    const rodM = cyl(0.016, 0.02, 0.36, trimMat, 8); rodM.position.y = 0.18; stick.add(rodM);
    const grip = box(0.05, 0.14, 0.06, seatMat, 0, 0.42, 0.01); stick.add(grip);
    group.add(stick); parts.stick = stick;
  }
  // pedals
  for (const s of [-1, 1]) {
    const p = box(0.1, 0.16, 0.02, trimMat, ex + s * 0.16, ey - 0.85, pz + 0.15);
    p.rotation.x = -0.4;
    group.add(p);
    if (s < 0) parts.pedalL = p; else parts.pedalR = p; p.userData.z0 = p.position.z;
  }
  // ----- throttles and levers -----
  const n = spec.engines;
  parts.throttle = [];
  if (spec.hotas) {
    // left console
    const console = box(0.22, 0.05, 0.5, panelMat, ex - 0.42, ey - 0.62, ez - 0.05);
    group.add(console);
    for (let i = 0; i < n; i++) {
      const lever = new THREE.Group(); lever.position.set(ex - 0.45 + i * 0.05, ey - 0.6, ez - 0.05);
      lever.add(cyl(0.012, 0.012, 0.16, trimMat, 8).translateY(0.08));
      lever.add(box(0.045, 0.05, 0.06, seatMat, 0, 0.17, 0));
      group.add(lever); parts.throttle.push(lever);
    }
  } else {
    const ped = box(0.22, 0.28, 0.42, panelMat, spec.pedestalX ?? 0, ey - 0.62, pz + 0.45);
    group.add(ped);
    for (let i = 0; i < n; i++) {
      const x = (spec.pedestalX ?? 0) + (n === 1 ? -0.03 : (i - 0.5) * 0.06);
      const lever = new THREE.Group(); lever.position.set(x, ey - 0.48, pz + 0.38);
      lever.add(cyl(0.01, 0.01, 0.14, trimMat, 8).translateY(0.07));
      lever.add(box(0.035, 0.035, 0.035, faceMat, 0, 0.15, 0));
      group.add(lever); parts.throttle.push(lever);
    }
    // flap lever at the right of the pedestal, gear lever on the panel
    const flap = new THREE.Group(); flap.position.set((spec.pedestalX ?? 0) + 0.08, ey - 0.48, pz + 0.5);
    flap.add(cyl(0.008, 0.008, 0.12, trimMat, 6).translateY(0.06)); flap.add(box(0.03, 0.02, 0.05, needleMat, 0, 0.12, 0));
    group.add(flap); parts.flapLever = flap;
    const trim = cyl(0.05, 0.05, 0.02, seatMat, 16); trim.rotation.z = Math.PI / 2; trim.position.set((spec.pedestalX ?? 0) - 0.08, ey - 0.5, pz + 0.55);
    group.add(trim); parts.trimWheel = trim;
    if (spec.spoilers) { const sp = new THREE.Group(); sp.position.set((spec.pedestalX ?? 0) - 0.1, ey - 0.48, pz + 0.38); sp.add(cyl(0.008, 0.008, 0.12, trimMat, 6).translateY(0.06)); sp.add(box(0.03, 0.03, 0.03, faceMat, 0, 0.12, 0)); group.add(sp); parts.spoilerLever = sp; }
  }
  if (spec.gearLever) {
    const gear = new THREE.Group(); gear.position.set(ex + 0.42, pBot + 0.16, pz + 0.02);
    gear.add(cyl(0.008, 0.008, 0.1, trimMat, 6).translateY(-0.05)); gear.add(cyl(0.02, 0.02, 0.02, needleMat, 10).translateY(-0.11));
    gear.userData.y0 = gear.position.y;
    group.add(gear); parts.gearLever = gear;
  }
  if (spec.hook) {
    const hk = new THREE.Group(); hk.position.set(ex + 0.35, pBot + 0.1, pz + 0.02);
    hk.add(cyl(0.008, 0.008, 0.08, trimMat, 6).translateY(-0.04)); hk.add(box(0.02, 0.02, 0.02, needleMat, 0, -0.09, 0));
    group.add(hk); parts.hookLever = hk;
  }
  // ----- instruments -----
  const R = 0.042, gap = 0.1;
  const gx = ex, gy = pTop - 0.075;
  const mk = (i, j) => gauge(R, faceMat, needleMat, gx + (i - 1) * gap, gy - j * gap, pz + 0.002);
  const asi = mk(0, 0), att = mk(1, 0), alt = mk(2, 0), tc = mk(0, 1), hdg = mk(1, 1), vsi = mk(2, 1);
  for (const g of [asi, att, alt, tc, hdg, vsi]) group.add(g.group);
  parts.asi = asi.needle; parts.alt = alt.needle; parts.vsi = vsi.needle; parts.turn = tc.needle; parts.hdgCard = hdg.needle;
  // attitude: a two-tone disc that banks and slides
  att.needle.visible = false;
  const ball = new THREE.Group(); ball.position.z = 0.006;
  const skyMat = mat(`${id}:cockpit:attSky`, 0x4f8fd0, { roughness: 0.6 }), gndMat = mat(`${id}:cockpit:attGround`, 0x8a5a2a, { roughness: 0.7 });
  ball.add(box(R * 1.7, R * 0.85, 0.002, skyMat, 0, R * 0.42, 0)); ball.add(box(R * 1.7, R * 0.85, 0.002, gndMat, 0, -R * 0.42, 0));
  const mask = new THREE.Group(); mask.add(ball); att.group.add(mask);
  parts.attitude = ball;
  // engine gauges to the right
  parts.rpm = [];
  for (let i = 0; i < n; i++) { const g = gauge(R * 0.8, faceMat, needleMat, gx + 0.32 + i * 0.08, gy, pz + 0.002); group.add(g.group); parts.rpm.push(g.needle); }
  // lights: gear (3) and stall
  parts.gearLights = []; parts.gearLightMats = [];
  if (spec.gearLever) for (let i = 0; i < 3; i++) {
    const lm = mat(`${id}:cockpit:gearLight${i}`, 0x1a2a1a, { emissive: 0x00ff40, emissiveIntensity: 0 });
    const l = box(0.014, 0.014, 0.006, lm, ex + 0.42 + (i - 1) * 0.02, pBot + 0.28, pz + 0.003);
    group.add(l); parts.gearLights.push(l); parts.gearLightMats.push(lm);
  }
  const stallMat = mat(`${id}:cockpit:stallLight`, 0x2a1a1a, { emissive: 0xff3030, emissiveIntensity: 0 });
  const stallL = box(0.03, 0.012, 0.006, stallMat, gx, pTop - 0.02, pz + 0.003);
  group.add(stallL); parts.stallLight = stallL;
  // optional EFIS / HUD displays (canvas, rate limited)
  let display = null, hud = null;
  if (spec.efis) {
    display = makeDisplay(512, 384, 20);
    const dmat = new THREE.MeshBasicMaterial({ map: display.texture, name: `${id}:cockpit:pfd` });
    const pfd = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.165), dmat);
    pfd.position.set(gx, gy - 0.05, pz + 0.004);
    for (const g of [asi, att, alt, tc, hdg, vsi]) g.group.visible = false;
    group.add(pfd); parts.pfd = pfd;
  }
  if (spec.hud) {
    hud = makeDisplay(256, 256, 20);
    const hmat = new THREE.MeshBasicMaterial({ map: hud.texture, transparent: true, opacity: 0.9, depthWrite: false, name: `${id}:cockpit:hud` });
    const glassH = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), hmat);
    glassH.position.set(ex, ey + 0.02, pz - 0.05);
    group.add(glassH); parts.hudGlass = glassH;
  }
  // ----- update -----
  const flapN = def.flaps.detents.length;
  const update = (s) => {
    if (parts.yoke) { parts.yoke.rotation.z = -s.aileron * 60 * DEG; parts.yoke.position.z = parts.yokeHome.z + s.elevator * 0.08; }
    if (parts.stick) { parts.stick.rotation.x = s.elevator * 18 * DEG; parts.stick.rotation.z = -s.aileron * 18 * DEG; }
    parts.pedalR.position.z = parts.pedalR.userData.z0 - s.rudder * 0.07;
    parts.pedalL.position.z = parts.pedalL.userData.z0 + s.rudder * 0.07;
    for (let i = 0; i < parts.throttle.length; i++) parts.throttle[i].rotation.x = lerp(30 * DEG, -30 * DEG, s.reverse > 0 ? 0 : s.throttle[i]);
    if (parts.flapLever) parts.flapLever.rotation.x = lerp(-25 * DEG, 30 * DEG, flapN > 1 ? s.flapDetent / (flapN - 1) : 0);
    if (parts.gearLever) parts.gearLever.position.y = parts.gearLever.userData.y0 - (s.gearCmd ? 0.04 : 0);
    if (parts.hookLever) parts.hookLever.rotation.x = s.hookCmd ? 30 * DEG : -30 * DEG;
    if (parts.spoilerLever) parts.spoilerLever.rotation.x = lerp(-25 * DEG, 25 * DEG, s.spoiler);
    if (parts.trimWheel) parts.trimWheel.rotation.x = s.trim * 4;
    parts.asi.rotation.z = -clamp(s.ias / 220, 0, 1) * 300 * DEG;
    parts.alt.rotation.z = -((s.alt % 1000) / 1000) * Math.PI * 2;
    parts.vsi.rotation.z = (90 - clamp(s.vs / 2000, -1, 1) * 150) * DEG;
    parts.turn.rotation.z = -clamp(s.beta / 10, -1, 1) * 30 * DEG;
    parts.hdgCard.rotation.z = s.heading * DEG;
    parts.attitude.rotation.z = -s.roll * DEG;
    parts.attitude.position.y = clamp(-s.pitch, -25, 25) * 0.0012;
    for (let i = 0; i < parts.rpm.length; i++) parts.rpm[i].rotation.z = -clamp(s.engineType === 'jet' ? s.n1[i] : s.rpm[i], 0, 1) * 270 * DEG;
    for (let i = 0; i < parts.gearLightMats.length; i++) parts.gearLightMats[i].emissiveIntensity = s.gearLocked[i] ? 1.5 : 0;
    stallMat.emissiveIntensity = s.stallWarning && (Math.floor(s.t * 4) % 2 === 0) ? 2 : 0;
    if (display) display.tick(s.t, (g, w, h) => {
      g.fillStyle = '#0a0e12'; g.fillRect(0, 0, w, h);
      g.save(); g.translate(w / 2, h / 2); g.rotate(-s.roll * DEG); g.translate(0, s.pitch * 4);
      g.fillStyle = '#3f7fc4'; g.fillRect(-w, -h * 2, w * 2, h * 2); g.fillStyle = '#7a5230'; g.fillRect(-w, 0, w * 2, h * 2);
      g.restore();
      g.fillStyle = '#e8eef2'; g.font = 'bold 40px sans-serif'; g.textAlign = 'left';
      g.fillText(Math.round(s.ias) + ' KT', 16, 60); g.textAlign = 'right'; g.fillText(Math.round(s.alt) + ' FT', w - 16, 60);
      g.textAlign = 'center'; g.fillText(String(Math.round(s.heading) % 360).padStart(3, '0'), w / 2, h - 20);
      g.fillStyle = '#ffd23f'; g.fillRect(w / 2 - 60, h / 2 - 3, 120, 6);
    });
    if (hud) hud.tick(s.t, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = '#7dff9a'; g.fillStyle = '#7dff9a'; g.lineWidth = 3; g.font = 'bold 22px monospace';
      g.textAlign = 'left'; g.fillText(Math.round(s.ias) + '', 20, 130); g.textAlign = 'right'; g.fillText(Math.round(s.radioAlt) + 'R', w - 20, 130);
      g.textAlign = 'center'; g.fillText(String(Math.round(s.heading) % 360).padStart(3, '0'), w / 2, 30);
      g.save(); g.translate(w / 2, h / 2); g.rotate(-s.roll * DEG); g.translate(0, s.pitch * 5);
      g.beginPath(); g.moveTo(-100, 0); g.lineTo(-30, 0); g.moveTo(30, 0); g.lineTo(100, 0); g.stroke(); g.restore();
      g.beginPath(); g.arc(w / 2, h / 2, 10, 0, Math.PI * 2); g.stroke();
      g.fillText('AOA ' + s.aoa.toFixed(1), w / 2, h - 20);
    });
  };
  return { group, parts, update, look: spec.look, placeholder: true };   // placeholder: the engine shows the exterior-only cockpit view instead of drawing this
}
