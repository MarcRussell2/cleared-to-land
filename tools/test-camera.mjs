// Camera test (2026-09-10): CameraRig driven through a fake aircraft and world. Checks that the chase orbit
// (a) goes under an airborne airplane, (b) on the ground slides down to knee height beside
// the wheels instead of under them, (c) 0 resets, (d) cockpit/wing head turn and reset,
// (e) a drag made in the tower view does not jump the chase view later.
import * as THREE from 'three';
import { CameraRig } from '../src/camera.js';

const fails = [];
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails.push(msg); };
const mkInput = () => ({ freeLook: { x: 0, y: 0 }, padConnected: false, lookX: 0, lookY: 0, orbitDX: 0, orbitDY: 0, orbitZoomDelta: 0, orbitKey: 0, orbitReset: false });
const mkAc = (y) => ({ def: { span: 10.7, eye: { x: 0, y: 1.1, z: 0.4 } }, pos: new THREE.Vector3(0, y, 0), fwd: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0), right: new THREE.Vector3(1, 0, 0), quat: new THREE.Quaternion(), vel: new THREE.Vector3(0, 0, -30), wheelsOnGround: false, legs: [], gsRel: 0, aero: { buffet: 0 }, crashed: false });
const world = { _camG: new THREE.Vector3(), ground(x, z, out) { out.set(x, 0, z); }, towerPos: new THREE.Vector3(200, 20, 100) };
const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.3, 60000);
const inp = mkInput();
const rig = new CameraRig(cam, inp);
const settle = (ac, n = 200) => { for (let i = 0; i < n; i++) rig.update(1 / 60, ac, world); };
const viewDir = () => new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
const looksAt = (ac) => viewDir().dot(ac.pos.clone().sub(cam.position).normalize());
const finite = () => [cam.position.x, cam.position.y, cam.position.z, cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w].every(Number.isFinite);

// --- default chase view
let ac = mkAc(80);
rig.setMode('chase'); rig.reset(); settle(ac);
const d0 = cam.position.distanceTo(ac.pos);
ok(cam.position.y > ac.pos.y && cam.position.z > ac.pos.z, `default chase sits behind and above (y=${cam.position.y.toFixed(1)} z=${cam.position.z.toFixed(1)}, dist ${d0.toFixed(1)} m)`);

// --- (a) drag down a lot while airborne: camera ends up well below the airplane, still looking at it
inp.orbitDY = -2000; settle(ac);   // mouse pushed forward (the game's existing sign: mouse down = camera up)
ok(cam.position.y < ac.pos.y - 0.9 * d0, `airborne drag-down puts the camera under the airplane (cam y ${cam.position.y.toFixed(1)} vs ac y ${ac.pos.y}, dist ${cam.position.distanceTo(ac.pos).toFixed(1)})`);
ok(looksAt(ac) > 0.98 && finite(), `still looking at the airplane from below (dot ${looksAt(ac).toFixed(3)})`);
const elevNow = Math.asin((cam.position.y - ac.pos.y) / cam.position.distanceTo(ac.pos));
ok(elevNow < -1.3 && elevNow > -1.5, `elevation clamps near -83 deg (${(elevNow * 180 / Math.PI).toFixed(1)} deg)`);

// --- (a2) drag up a lot: nearly overhead, no flip
inp.orbitDY = 6000; settle(ac);
const elevUp = Math.asin((cam.position.y - ac.pos.y) / cam.position.distanceTo(ac.pos));
ok(elevUp > 1.3 && elevUp < 1.5 && looksAt(ac) > 0.98 && finite(), `drag-up clamps near +83 deg (${(elevUp * 180 / Math.PI).toFixed(1)} deg), looking at the airplane`);

// --- (b) same drag-down with the airplane sitting on the runway (CG 1.0 m up): camera at knee height, full distance to the side
inp.orbitDY = -8000; ac = mkAc(1.0); ac.wheelsOnGround = true; settle(ac, 400);
const horiz = Math.hypot(cam.position.x - ac.pos.x, cam.position.z - ac.pos.z);
ok(cam.position.y > 0.55 && cam.position.y < 0.75, `on the ground the camera stops at knee height (y=${cam.position.y.toFixed(2)} m)`);
ok(horiz > 0.95 * d0, `...and stays out at full distance beside the airplane, not under it (horizontal ${horiz.toFixed(1)} m of ${d0.toFixed(1)})`);
ok(looksAt(ac) > 0.98 && finite(), `looking at the airplane from knee height (dot ${looksAt(ac).toFixed(3)})`);

// --- (b2) lift the airplane 3 m (flare height) with the orbit still pushed under: camera stays at knee height looking up at the wheels
ac = mkAc(4.0); settle(ac, 400);
ok(cam.position.y > 0.55 && cam.position.y < 0.75 && cam.position.y < ac.pos.y, `in the flare the camera waits at knee height under the wheel line (cam y ${cam.position.y.toFixed(2)}, ac y ${ac.pos.y})`);

// --- (c) reset puts it back behind the tail
inp.orbitReset = true; ac = mkAc(80); settle(ac, 400);
ok(Math.abs(cam.position.y - (80 + (0.28 * 10.7 + 2.2))) < 0.5 && cam.position.z > 0 && Math.abs(cam.position.x) < 0.1, `0 puts the chase camera back behind the tail (x=${cam.position.x.toFixed(2)} y=${cam.position.y.toFixed(1)} z=${cam.position.z.toFixed(1)})`);

// --- yaw direction: drag right -> the view direction turns right (camera swings to the airplane's left side)
inp.orbitDX = 300; settle(ac);
ok(cam.position.x < -1, `drag right swings the chase camera to the airplane's left side (x=${cam.position.x.toFixed(1)}), i.e. the view turns right`);
inp.orbitReset = true; settle(ac);

// --- (d) cockpit: drag right turns the head right, drag down looks down; reset straightens
rig.setMode('cockpit'); settle(ac);
const fwd0 = viewDir();
ok(fwd0.z < -0.99, `cockpit starts looking straight ahead (${fwd0.z.toFixed(3)})`);
inp.orbitDX = 400; settle(ac);
const fwdR = viewDir();
ok(fwdR.x > 0.5, `cockpit drag right looks right (view x=${fwdR.x.toFixed(2)})`);
inp.orbitDY = 300; settle(ac);
ok(viewDir().y < -0.4, `cockpit drag down looks down (view y=${viewDir().y.toFixed(2)})`);
inp.orbitDX = 100000; settle(ac);
ok(Math.abs(rig.headYaw) <= 2.6 + 1e-9 && finite(), `head yaw clamps at ${rig.headYaw.toFixed(2)} rad`);
inp.orbitReset = true; settle(ac);
ok(viewDir().z < -0.99 && Math.abs(viewDir().y) < 0.01, `0 looks straight ahead again in the cockpit`);

// --- wing view shares the head turn
rig.setMode('wing'); settle(ac);
const wing0 = viewDir().clone();
inp.orbitDX = -400; settle(ac);
ok(viewDir().x < wing0.x - 0.4, `wing view drag left looks left (view x ${wing0.x.toFixed(2)} -> ${viewDir().x.toFixed(2)})`);
inp.orbitReset = true; settle(ac);
ok(viewDir().distanceTo(wing0) < 0.01, `wing view reset restores the default look`);

// --- (e) tower: wheel zooms the lens; a drag there does not carry over to the chase view
rig.setMode('tower'); settle(ac);
const fovT = cam.fov;
inp.orbitZoomDelta = -5; settle(ac);
ok(cam.fov < fovT * 0.7, `tower wheel-up zooms in (fov ${fovT.toFixed(1)} -> ${cam.fov.toFixed(1)})`);
inp.orbitDX = 5000; inp.orbitDY = 5000; settle(ac);
ok(inp.orbitDX === 0 && inp.orbitDY === 0, `a drag in the tower view is consumed`);
rig.setMode('chase'); settle(ac, 400);
ok(Math.abs(cam.position.x) < 0.1 && cam.position.z > 0, `...and the chase view is unmoved afterwards (x=${cam.position.x.toFixed(2)})`);
ok(Math.abs(rig.orbitYaw) < 1e-9 && Math.abs(rig.orbitPitch) < 1e-9, `chase orbit still at zero after the tower drag`);

// --- new flight: head straightens, tower zoom resets, chase orbit is kept (by design)
inp.orbitDX = 300; settle(ac); rig.setMode('cockpit'); inp.orbitDX = 300; settle(ac); rig.reset(); rig.setMode('chase'); settle(ac, 400);
ok(rig.headYaw === 0 && rig.viewZoom === 1 && Math.abs(rig.orbitYaw - 1.2) < 1e-6, `reset(): head straight, zoom 1, chase orbit kept (${rig.orbitYaw.toFixed(2)} rad)`);

// --- (f) the seat (2026-09-15): the cockpit camera sits at the design eye raised by def.seatUp
ac = mkAc(80); ac.def.seatUp = 0.12;
rig.setMode('cockpit'); rig.reset(); settle(ac, 5);
ok(Math.abs(cam.position.y - (80 + 1.1 + 0.12)) < 1e-6 && Math.abs(cam.position.z - 0.4) < 1e-6, `cockpit eye is the design eye raised by seatUp (y ${cam.position.y.toFixed(3)}, want ${(80 + 1.1 + 0.12).toFixed(3)})`);
delete ac.def.seatUp; settle(ac, 5);
ok(Math.abs(cam.position.y - (80 + 1.1)) < 1e-6, `no seatUp: the camera sits at the design eye (y ${cam.position.y.toFixed(3)})`);

console.log(fails.length ? `\n${fails.length} FAILED` : '\nall camera checks passed');
process.exit(fails.length ? 1 : 0);
