// The obstacle engine's test suite (plain Node, no GPU; part of `npm test`).
//
// What it covers, in order:
//   1. the collision maths of src/world/obstacles.js: swept spheres against boxes, cylinders and capsules, signed
//      distances, and no tunnelling at 250 kt with a 0.1 s frame (a 12 cm cable is caught by a 26 m step);
//   2. the hulls (src/aircraft/hulls.js): every vertex of every procedural airframe (src/art/airframes/*.js, the
//      ones that ship) lies inside a probe sphere or within HULL_TOL of one; no gap across the span a vertical cable
//      could slip through; no stray probe outside the airframe's box;
//   3. each obstacle mission's course: it resolves the same way twice, the spawn is clear, the numbers each
//      description quotes are true (printed), and every gate can be flown through anywhere inside its frame
//      (wings level, gear down) without touching anything - a gate is never a trap;
//   4. what is drawn IS what collides: src/art/city-look.js builds the course in Node and every instance of every
//      mesh is checked against the prim it claims to draw (centre, axes, size), every solid drawn exactly once -
//      for the three missions and for a course that uses every one of the engine's 14 kinds;
//   5. gates and the mission runtime: pass / miss / wrong-way detection, the debrief lines, the points cap for a
//      missed required gate, the bonus, the clamp, the HUD status line;
//   6. the mission data (ids, n, fields, tips, touch words) and that no original site or challenge builds a field;
//   7. flights with the real physics (tools/fly-mission.mjs simulate(), the same code the page runs): each mission
//      landed by RoutePilot on two seeds, deterministic, and a deliberately bad path crashing into what the mission
//      is about (so the challenge is real), plus the over-the-top line through the notch failing its gate;
//   8. RoutePilot over an obstacle on the glide path and then steeply down (7-10 degrees) to a landing, in the
//      Condor, the Skylark and the Trailblazer, and the same courses flown straight in hitting the obstacle.
import { installDomStub } from './dom-stub.mjs';
installDomStub();
const THREE = await import('three');
const { DEG, KT, makeRng } = await import('../src/config.js');
const { AIRCRAFT } = await import('../src/aircraft/defs.js');
const { HULLS, hullProbes } = await import('../src/aircraft/hulls.js');
const { ObstacleField, resolveCourse, sweptHit, primDistance } = await import('../src/world/obstacles.js');
const { MissionRuntime, MISSION_CAP } = await import('../src/systems/mission.js');
const { SITES, SCENARIOS, resolveScenario } = await import('../src/systems/scenarios.js');
const { MISSION_GROUPS } = await import('../src/missions/index.js');
const { OBSTACLES_MISSIONS, OBSTACLES_SITES } = await import('../src/missions/obstacles.js');
const { touchify } = await import('../src/touch.js');
const look = await import('../src/art/terrain-look.js');
const livery = await import('../src/art/livery.js');
const { simulate } = await import('./fly-mission.mjs');

let checks = 0, fails = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log('FAIL ' + msg); } };
const say = (msg) => console.log('PASS ' + msg);
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const IDS = ['skylark', 'trailblazer', 'condor', 'hornet'];

// ============================================================ 1. collision maths
{
  const cap = { shape: 'cap', ax: -50, ay: 20, az: 0, bx: 50, by: 20, bz: 0, r: 0.12 };
  // a probe of 0.3 m flying through the wire in ONE 26 m step (250 kt at the 0.1 s frame clamp)
  ok(sweptHit(cap, 0, 20.2, 13, 0, 20.2, -13, 0.3), 'a 0.3 m sphere swept 26 m through a 0.12 m cable must hit it');
  ok(!sweptHit(cap, 0, 20.5, 13, 0, 20.5, -13, 0.3), 'a sphere passing 0.5 m from a cable (0.42 m reach) must miss it');
  ok(!sweptHit(cap, 60, 20, 13, 60, 20, -13, 0.3), 'a sphere passing beyond the end of the cable must miss it');
  ok(near(primDistance(cap, 0, 21, 0), 0.88, 1e-9) && primDistance(cap, 0, 20, 0) < 0, 'capsule signed distance (0.88 m above it, negative inside)');
  // an oriented box yawed 30 degrees
  const a = 30 * DEG, box = { shape: 'box', cx: 0, cy: 10, cz: 0, hx: 5, hy: 10, hz: 2, X: [Math.cos(a), 0, Math.sin(a)], Y: [0, 1, 0], Z: [-Math.sin(a), 0, Math.cos(a)] };
  ok(sweptHit(box, -30, 5, 0, 30, 5, 0, 0.5), 'a sweep through the middle of a box must hit it');
  ok(!sweptHit(box, -30, 21, 0, 30, 21, 0, 0.5), 'a sweep 1 m over the top of a box must miss it');
  ok(sweptHit(box, -30, 20.3, 0, 30, 20.3, 0, 0.5), 'a sweep 0.3 m over the top with a 0.5 m probe must hit it');
  ok(near(primDistance(box, 0, 25, 0), 5, 1e-9) && near(primDistance(box, 0, 10, 0), -2, 1e-9), 'box signed distance (5 m above, -2 at the centre: the nearest face is 2 m away)');
  // a frustum: radius 6 at the bottom, 1 at the top
  const cyl = { shape: 'cyl', x: 0, z: 0, y0: 0, y1: 20, r0: 6, r1: 1 };
  ok(sweptHit(cyl, -20, 2, 0, 20, 2, 0, 0.3), 'a sweep low through a frustum must hit it');
  ok(!sweptHit(cyl, -20, 18, 4, 20, 18, 4, 0.3), 'a sweep 4 m off the axis near the top of a frustum (radius 2 there) must miss it');
  ok(sweptHit(cyl, -20, 18, 1.5, 20, 18, 1.5, 0.3), 'a sweep 1.5 m off the axis near the top must hit it');
  ok(!sweptHit(cyl, -20, 21, 0, 20, 21, 0, 0.3), 'a sweep over the top of a frustum must miss it');
  ok(near(primDistance(cyl, 10, 0, 0), 4, 1e-9), 'frustum signed distance at its foot');
  say('collision maths: swept box / cylinder / capsule and signed distances');
}

// A stand-in aircraft for the field: pose, gear and flap state, a def. (The field reads nothing else.)
function fakeAc(id, x, y, z, heading = 0) {
  const def = AIRCRAFT[id];
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -heading);
  return { def, pos: new THREE.Vector3(x, y, z), quat: q, ctl: { flap: 0, gear: 1 } };
}
{
  // the whole field: a 0.12 m cable across the approach 100 m out, 30 m up; a Condor at 250 kt with a 0.1 s frame.
  // (Bayfield's runway sits at the origin heading north: u = -z, v = x.)
  const f0 = new ObstacleField(resolveCourse(SITES.bayfield, { course: { obstacles: [{ kind: 'cable', a: { u: -100, v: -300, y: 30 }, b: { u: -100, v: 300, y: 30 }, r: 0.12, name: 'the test cable' }] } }));
  ok(f0.prims.length > 3 && f0.prims.every((q) => q.shape === 'cap'), 'a cable resolves to a chain of capsules');
  const mid = f0.prims[Math.floor(f0.prims.length / 2)], cableY = (mid.ay + mid.by) / 2;
  const step = 250 * KT * 0.1;
  const fly = (field, id, x, y) => {
    const ac = fakeAc(id, x, y, 100 + 2.5 * step);
    field.reset(ac);
    let hit = null;
    for (let i = 0; i < 6 && !hit; i++) { ac.pos.z -= step; hit = field.hit(ac); }
    return hit;
  };
  let hit = fly(f0, 'condor', 0, cableY + 0.5);
  ok(hit === 'the test cable', `a Condor at 250 kt (${step.toFixed(1)} m per frame) through a 12 cm cable must hit it (got ${hit}; part ${f0.lastHit && f0.lastHit.part})`);
  // the same flight with the cable 13 m under the CG (the gear hangs 4.1 m): nothing, and a near miss on record
  hit = fly(f0, 'condor', 0, cableY + 13);
  ok(hit === null, `the same cable 13 m under the CG must not be hit (got ${hit})`);
  ok(f0.closestD > 6 && f0.closestD < 10, `the near-miss record reads the closest pass (${f0.closestD.toFixed(1)} m)`);
  // a 0.6 m mast 16.4 m right of the flight path: inside the Condor's 17.15 m half-span, it must meet the outer wing
  const f1 = new ObstacleField(resolveCourse(SITES.bayfield, { course: { obstacles: [{ kind: 'mast', u: -100, v: 16.4, h: 60, r: 0.3, name: 'the test mast' }] } }));
  hit = fly(f1, 'condor', 0, f1.prims[0].y0 + 30);
  ok(hit === 'the test mast', `a 0.6 m mast 16.4 m off the centreline must hit the Condor's outer wing (got ${hit}; part ${f1.lastHit && f1.lastHit.part})`);
  hit = fly(f1, 'condor', 0, f1.prims[0].y0 + 70);
  ok(hit === null, `...and not when the wing passes 10 m over its top (got ${hit})`);
  // a wheel coming down between two frames is not a probe dropping from 100 km up
  const ac = fakeAc('condor', 0, 200, 400); ac.ctl.gear = 0;
  f1.reset(ac); ac.ctl.gear = 1; ac.pos.z -= step;
  ok(f1.hit(ac) === null, 'lowering the gear between two frames hits nothing');
  say(`no tunnelling: a ${step.toFixed(1)} m step through a 12 cm cable and past a mast is caught; the near-miss record works`);
}

// ============================================================ 2. hulls against the airframes that ship
const HULL_TOL = { skylark: 0.35, trailblazer: 0.35, condor: 0.4, hornet: 0.4 };
for (const id of IDS) {
  const def = AIRCRAFT[id];
  const H = hullProbes(def);
  ok(Array.isArray(HULLS[id]) && HULLS[id].length > 20, `HULLS.${id} must be a probe table`);
  ok(H.probes.every((p) => [p.x, p.y, p.z, p.r].every(Number.isFinite) && p.r > 0.05 && typeof p.part === 'string'), `${id}: every probe needs x, y, z, r > 0 and a part name`);
  ok(H.gear.length >= def.gear.length, `${id}: a probe for every wheel`);
  const m = await import(`../src/art/airframes/${id}.js`);
  const r = m.buildAirframe(def, { materials: livery.LIVERY[id](), detail: 'high', propDisc: livery.propDisc, seed: 7 });
  r.group.updateMatrixWorld(true);
  const all = [...H.probes, ...H.gear];
  const v = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), s = new THREE.Vector3();
  let worst = 0, worstAt = '', n = 0;
  const bb = new THREE.Box3();
  const test = (P, name) => {
    let best = Infinity;
    for (const p of all) { const d = Math.hypot(P.x - p.x, P.y - p.y, P.z - p.z) - p.r; if (d < best) { best = d; if (best < 0) break; } }
    n++;
    if (best > worst) { worst = best; worstAt = `${name} (${P.x.toFixed(2)}, ${P.y.toFixed(2)}, ${P.z.toFixed(2)})`; }
  };
  r.group.traverse((o) => {
    if (!o.isMesh || !o.visible || !o.geometry || !o.geometry.attributes.position) return;
    const pos = o.geometry.attributes.position, idx = o.geometry.index;
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); bb.expandByPoint(v); test(v, o.name); }
    // the middle of every sizeable triangle too (a big panel's interior is skin as much as its corners)
    const tri = idx ? idx.count / 3 : pos.count / 3;
    for (let t = 0; t < tri; t++) {
      const i0 = idx ? idx.getX(3 * t) : 3 * t, i1 = idx ? idx.getX(3 * t + 1) : 3 * t + 1, i2 = idx ? idx.getX(3 * t + 2) : 3 * t + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld); c.fromBufferAttribute(pos, i2).applyMatrix4(o.matrixWorld);
      if (a.distanceTo(b) + b.distanceTo(c) + c.distanceTo(a) < 1.5) continue;
      s.copy(a).add(b).add(c).multiplyScalar(1 / 3); test(s, o.name);
      s.copy(a).add(b).multiplyScalar(0.5); test(s, o.name);
      s.copy(b).add(c).multiplyScalar(0.5); test(s, o.name);
      s.copy(c).add(a).multiplyScalar(0.5); test(s, o.name);
    }
  });
  ok(worst <= HULL_TOL[id], `${id}: the airframe must lie inside its probes (worst ${worst.toFixed(2)} m outside, at ${worstAt}; allowed ${HULL_TOL[id]})`);
  // no stray probe: every probe centre inside the airframe's box grown by 1.2 m
  const grown = bb.clone().expandByScalar(1.2);
  const stray = H.probes.filter((p) => !grown.containsPoint(v.set(p.x, p.y, p.z)));
  ok(stray.length === 0, `${id}: ${stray.length} probe(s) outside the airframe's box (${stray.slice(0, 3).map((p) => p.part).join(', ')})`);
  // a vertical cable anywhere across the span meets a probe (no gap between two probes along the wing)
  let gap = -Infinity;
  for (let x = -def.span / 2 + 0.05; x <= def.span / 2 - 0.05; x += 0.05) {
    let best = Infinity;
    for (const p of H.probes) best = Math.min(best, Math.abs(p.x - x) - p.r);
    gap = Math.max(gap, best);
  }
  ok(gap < 0, `${id}: a vertical cable must meet a probe everywhere across the ${def.span} m span (worst gap ${gap.toFixed(2)} m)`);
  say(`${id}: ${H.probes.length} + ${H.gear.length} probes (radius ${H.radius.toFixed(1)} m); ${n} skin points, worst ${worst.toFixed(2)} m outside (${worstAt}); no gap across the span`);
}
{
  const flap = hullProbes(AIRCRAFT.condor).probes.filter((p) => p.part === 'flap');
  ok(flap.length > 8 && flap.every((p) => p.fy < -0.3 && p.fz < 0), 'the Condor\'s flap probes must hang down (and forward) with the flap');
}

// ============================================================ 3. the courses
const missionOf = (id) => SCENARIOS.find((s) => s.id === id);
function planned(sc) {
  const site = SITES[sc.site];
  const course = ObstacleField.plan(site, sc);
  return { site, course, field: course ? new ObstacleField(course, { site }) : null };
}
// The airframe placed with its CG at a world point, wings level, flying along heading psi: is it clear of every
// solid? (The swept test from 8 m before the point to 8 m past it.)
function clearAt(field, id, x, y, z, psi) {
  const ac = fakeAc(id, x - Math.sin(psi) * 8, y, z + Math.cos(psi) * 8, psi);
  ac.ctl.flap = AIRCRAFT[id].id === 'condor' ? 0.75 : 1;
  field.reset(ac);
  ac.pos.set(x + Math.sin(psi) * 8, y, z - Math.cos(psi) * 8);
  const hit = field.hit(ac);
  return hit;
}
for (const sc of OBSTACLES_MISSIONS) {
  const { site, course, field } = planned(sc);
  ok(!!course && course.prims.length + course.gates.length > 0, `${sc.id}: the course must resolve`);
  if (!course) continue;
  const again = ObstacleField.plan(site, sc);
  ok(JSON.stringify(again.prims) === JSON.stringify(course.prims) && JSON.stringify(again.lights) === JSON.stringify(course.lights), `${sc.id}: the course must resolve the same way twice`);
  ok(course.prims.every((p) => p.min.every(Number.isFinite) && p.max.every(Number.isFinite) && p.name), `${sc.id}: every prim needs finite bounds and a name`);
  // the spawn is well clear of everything
  const rs = resolveScenario(sc, makeRng(307), { approach: 'short' });
  const rw = site.runways[0], h = rw.heading * DEG, dir = { x: Math.sin(h), z: -Math.cos(h) }, right = { x: -dir.z, z: dir.x };
  const sp = rs.spawn, sx = rw.x + dir.x * sp.u + right.x * sp.v, sz = rw.z + dir.z * sp.u + right.z * sp.v;
  const clr = field.clearance({ x: sx, y: rw.elevation + sp.alt + 5, z: sz }, 3000);
  ok(clr.d > 40, `${sc.id}: the spawn must be at least 40 m from any solid (${clr.d.toFixed(0)} m)`);
  // every gate can be flown through anywhere inside its frame
  let traps = 0, tried = 0;
  for (const g of course.gates) {
    for (const fl of [-0.45, -0.2, 0, 0.2, 0.45]) for (const fu of [-0.45, -0.2, 0, 0.2, 0.45]) {
      const x = g.x + g.r[0] * fl * g.w, z = g.z + g.r[2] * fl * g.w, y = g.y + fu * g.h;
      tried++;
      const hit = clearAt(field, sc.aircraft, x, y, z, g.psi);
      if (hit) { traps++; if (traps < 4) console.log(`      ${sc.id}: ${g.name} at (${(fl * g.w).toFixed(1)}, ${(fu * g.h).toFixed(1)}) hits ${hit}`); }
    }
  }
  ok(traps === 0, `${sc.id}: every point inside every gate must be flyable wings level (${traps} of ${tried} hit something)`);
  say(`${sc.id}: ${course.prims.length} solids, ${course.gates.length} gates, ${course.lights.length} obstacle lights, ${course.keepOut.length} keep-out circles; spawn ${clr.d.toFixed(0)} m clear; ${tried} points inside the gates all flyable`);
}
// the numbers the descriptions quote
{
  const sc = missionOf('power-lines'), { site, course } = planned(sc);
  const wires = course.prims.filter((p) => p.kind === 'wire' && p.name === 'the power lines' && p.shape === 'cap' && (p.ax - 0) * (p.bx - 0) <= 0);
  // world x = v on this runway (heading 0 at the origin): the capsules that straddle the centreline
  const ys = wires.map((p) => { const f = -p.ax / (p.bx - p.ax || 1); const y = p.ay + (p.by - p.ay) * f; const z = p.az + (p.bz - p.az) * f; return { y, z }; });
  const { Terrain } = await import('../src/world/terrain.js');
  const { siteFlats } = await import('../src/systems/scenarios.js');
  const ter = new Terrain({ ...site.terrain, flats: siteFlats(site) });
  const agl = ys.map((q) => q.y - ter.height(0, q.z)).sort((a, b) => a - b);
  ok(agl.length >= 5, 'power-lines: five conductors cross the centreline');
  ok(agl[0] > 15.5 && agl[0] < 18.5, `power-lines: the lowest wire over the centreline hangs about 17 m above the ground (${agl[0].toFixed(1)})`);
  ok(agl[agl.length - 1] > 29 && agl[agl.length - 1] < 33, `power-lines: the earth wire over the centreline hangs about 31 m up (${agl[agl.length - 1].toFixed(1)})`);
  const cross = ys[0].z;
  ok(near(cross, 600, 30), `power-lines: the line crosses the centreline 600 m out (${cross.toFixed(0)} m)`);
  const sp = sc.spawn, spawnAgl = sp.alt;
  ok(Math.abs(spawnAgl - agl[0]) < 1.5, `power-lines: the start height (${spawnAgl} m) is the height of the lowest wires (${agl[0].toFixed(1)}): level flight meets them`);
  say(`power-lines: wires over the centreline ${agl.map((x) => x.toFixed(1)).join(' / ')} m above the ground, ${cross.toFixed(0)} m out; start at ${spawnAgl} m`);
}
{
  const sc = missionOf('the-notch'), { course } = planned(sc);
  const crowns = course.prims.filter((p) => p.look === 'tree' && Math.abs(p.z - 165) < 40);
  const nv = -16;
  const edge = Math.min(...crowns.map((p) => Math.abs(p.x - nv) - p.r0));
  const hMin = Math.min(...crowns.map((p) => p.y1 - p.base)), hMax = Math.max(...crowns.map((p) => p.y1 - p.base));
  const topMax = Math.max(...crowns.filter((p) => Math.abs(p.x - nv) < 45).map((p) => p.y1 - 520));
  ok(edge >= 14.9, `the-notch: the notch is at least 30 m wide between the crowns (${(2 * edge).toFixed(1)} m)`);
  ok(hMin > 34 && hMax < 41, `the-notch: the wall's spruce are about 37 m tall (${hMin.toFixed(1)}..${hMax.toFixed(1)})`);
  ok(topMax > 40 && topMax < 48, `the-notch: beside the notch the wall stands over 40 m above the bar (${topMax.toFixed(1)} m at its highest)`);
  ok(crowns.length > 60, `the-notch: three rows of spruce (${crowns.length} near the notch line)`);
  say(`the-notch: ${crowns.length} spruce in the wall, ${hMin.toFixed(0)}-${hMax.toFixed(0)} m tall, tops to ${topMax.toFixed(0)} m over the bar; notch ${(2 * edge).toFixed(1)} m wide at the crown base`);
}
{
  const sc = missionOf('harbor-cranes'), { course } = planned(sc);
  const boom = course.prims.find((p) => p.kind === 'boom' && p.name === 'the lowered crane boom');
  ok(!!boom, 'harbor-cranes: the lowered boom exists');
  if (boom) {
    const under = boom.min[1];   // world y; the water is at 0
    const tipV = boom.max[0];
    ok(under > 48 && under < 52, `harbor-cranes: the boom's underside is 50 m over the water (${under.toFixed(1)})`);
    ok(tipV > 1003 && tipV < 1012, `harbor-cranes: the boom's tip reaches just past the middle of the lane (v ${tipV.toFixed(0)})`);
    say(`harbor-cranes: lowered boom underside ${under.toFixed(1)} m over the water, tip at v ${tipV.toFixed(0)} (lane 1000)`);
  }
}

// ============================================================ 4. drawn = collides
// Every kind the engine offers, in one course (the three missions use only some of them; the city ladder uses the
// rest). The same course is flown in the page for stills of every kind (tools/fly-mission.mjs harbor-cranes --set).
const EVERY_KIND = { id: 'every-kind', site: 'harbor', course: {
  obstacles: [
    { kind: 'box', u: -3000, v: -60, w: 20, d: 10, h: 15, look: 'plain', color: 'concrete', tilt: 10 },
    { kind: 'tower', u: -2800, v: -150, w: 30, d: 30, h: 120, antenna: 12, name: 'the Meridian Tower' },
    { kind: 'tower', u: -2850, v: -220, w: 40, d: 24, h: 70, rot: 20, color: 2 },
    { kind: 'block', u: -2800, v: 150, w: 60, d: 25, h: 35 },
    { kind: 'cyl', u: -2600, v: -90, r: 4, r1: 2.5, h: 70 },
    { kind: 'mast', u: -2400, v: -120, h: 90, guys: true },
    { kind: 'cable', a: { u: -2200, v: -200, y: 22 }, b: { u: -2200, v: 200, y: 22 }, sag: 3, markers: 40 },
    { kind: 'powerline', type: 'hv', from: { u: -2000, v: -400 }, to: { u: -2000, v: 400 }, spans: 3, markers: 60 },
    { kind: 'powerline', type: 'pole', from: { u: -1900, v: -100 }, to: { u: -1900, v: 100 }, spans: 3 },
    { kind: 'bridge', u: -1500, v: 0, length: 300, deckY: 20, towerH: 40 },
    { kind: 'crane', type: 'tower', u: -1200, v: 120, h: 60, jib: 50, rot: 180 },
    { kind: 'crane', type: 'sts', u: -1000, v: 100, boom: 30 },
    { kind: 'quay', u: -800, v: 300, w: 60, d: 200, top: 3 },
    { kind: 'containers', u: -800, v: 70, rows: 4, cols: 3, tiers: 4 },
    { kind: 'ship', type: 'container', u: -600, v: 400, rot: 90, length: 200, beam: 30 },
    { kind: 'ship', type: 'tall', u: -600, v: -400, rot: 90 },
    { kind: 'tree', u: -500, v: 40, scale: 1 },
    { kind: 'treeWall', u: -400, from: -60, to: 60, step: 9, scale: 1.2, rows: 2, gap: { v: 0, w: 30 } },
  ],
  gates: [{ u: -1650, v: 0, y: 50, w: 60, h: 30, name: 'Gate 1' }],
} };
{
  const kinds = new Set(EVERY_KIND.course.obstacles.map((o) => o.kind));
  ok(kinds.size === 14, `the every-kind course uses all 14 kinds (${[...kinds].join(', ')})`);
}
{
  const m4 = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), ax = new THREE.Vector3();
  for (const sc of [...OBSTACLES_MISSIONS, EVERY_KIND]) {
    const { site, course } = planned(sc);
    const { Terrain } = await import('../src/world/terrain.js');
    const { siteFlats } = await import('../src/systems/scenarios.js');
    const terrain = new Terrain({ ...site.terrain, flats: siteFlats(site) });
    const built = look.buildCourse(course.prims, course.gates, { terrain, night: true, quality: 'high', seed: course.seed, lights: course.lights });
    ok(built && Array.isArray(built.objects) && typeof built.update === 'function', `${sc.id}: buildCourse must return { objects, update }`);
    const drawn = new Int32Array(course.prims.length);
    let bad = 0, gateBars = 0, lights = 0;
    const primers = [];
    const flag = (msg) => { bad++; if (bad < 6) console.log('      ' + sc.id + ': ' + msg); };
    for (const o of built.objects) {
      ok(!!o.name && (!o.material || !!o.material.name), `${sc.id}: every course object and material is named (${o.name})`);
      if (o.isPoints) { lights += o.geometry.drawRange.count === Infinity ? o.geometry.attributes.position.count : o.geometry.drawRange.count; continue; }
      if (!o.isInstancedMesh) { flag(`${o.name} is not instanced`); continue; }
      if (o.userData.primer) {
        // a shadow primer: one 1 mm instance on a solid's own geometry and material, casting, hidden after 0.5 s
        o.getMatrixAt(0, m4); m4.decompose(P, Q, S);
        ok(o.count === 1 && o.castShadow && S.x < 0.01 && built.objects.some((x) => x !== o && !x.userData.primer && x.geometry === o.geometry && x.material === o.material), `${sc.id}: ${o.name} is a 1 mm instance of a course mesh's own geometry and material`);
        primers.push(o);
        continue;
      }
      ok(o.frustumCulled !== false && !!o.boundingSphere, `${sc.id}: ${o.name} keeps its bounds for culling`);
      const prim = o.userData.prim;
      ok(prim && prim.length === o.count, `${sc.id}: ${o.name} carries the prim index of every instance`);
      for (let k = 0; k < o.count; k++) {
        o.getMatrixAt(k, m4);
        const i = prim[k];
        if (i < 0) { gateBars++; continue; }
        const p = course.prims[i];
        drawn[i]++;
        m4.decompose(P, Q, S);
        if (o.name === 'course/trees') {
          const want = p.base != null ? p.base : p.y0;
          if (!(near(P.x, p.x, 1e-3) && near(P.z, p.z, 1e-3) && near(P.y, want, 1e-3) && near(S.x, p.scale, 1e-4) && near(S.y, p.scale, 1e-4))) flag(`tree ${i} drawn at ${P.toArray().map((x) => x.toFixed(2))} x${S.x.toFixed(2)}, collides at ${p.x.toFixed(2)},${want.toFixed(2)},${p.z.toFixed(2)} x${p.scale}`);
          // and the spruce's collision size is OBSTACLE_TREE's
          if (!near(p.r0, look.OBSTACLE_TREE.radius * p.scale, 1e-6) || !near(p.y1 - want, look.OBSTACLE_TREE.height * p.scale, 1e-6)) flag(`tree ${i} collision size is not OBSTACLE_TREE x scale`);
        } else if (p.shape === 'box') {
          const e = m4.elements;
          const cols = [[e[0], e[1], e[2]], [e[4], e[5], e[6]], [e[8], e[9], e[10]]];
          const len = cols.map((c) => Math.hypot(...c));
          const size = [2 * p.hx, 2 * p.hy, 2 * p.hz], axes = [p.X, p.Y, p.Z];
          const okAxes = cols.every((c, j) => near(c[0] / len[j], axes[j][0], 1e-4) && near(c[1] / len[j], axes[j][1], 1e-4) && near(c[2] / len[j], axes[j][2], 1e-4));
          if (!(near(e[12], p.cx, 1e-3) && near(e[13], p.cy, 1e-3) && near(e[14], p.cz, 1e-3) && len.every((l, j) => near(l, size[j], 1e-3)) && okAxes)) flag(`box ${i} (${p.name}) drawn differently from its volume`);
        } else if (p.shape === 'cyl') {
          if (!(near(P.x, p.x, 1e-3) && near(P.z, p.z, 1e-3) && near(P.y, (p.y0 + p.y1) / 2, 1e-3) && near(S.y, p.y1 - p.y0, 1e-3) && near(S.x, p.r0, 1e-4) && near(S.z, p.r0, 1e-4))) flag(`cylinder ${i} (${p.name}) drawn differently from its volume`);
        } else {
          const ball = p.ax === p.bx && p.ay === p.by && p.az === p.bz;
          if (ball) { if (!(near(P.x, p.ax, 1e-3) && near(P.y, p.ay, 1e-3) && near(P.z, p.az, 1e-3) && near(S.x, p.r, 1e-4))) flag(`marker ${i} drawn differently`); continue; }
          const len = Math.hypot(p.bx - p.ax, p.by - p.ay, p.bz - p.az);
          ax.set(0, 1, 0).applyQuaternion(Q);
          const d = [(p.bx - p.ax) / len, (p.by - p.ay) / len, (p.bz - p.az) / len];
          if (!(near(P.x, (p.ax + p.bx) / 2, 1e-3) && near(P.y, (p.ay + p.by) / 2, 1e-3) && near(P.z, (p.az + p.bz) / 2, 1e-3) && near(S.y, len, 1e-3) && near(S.x, p.r, 1e-4) && near(Math.abs(ax.x * d[0] + ax.y * d[1] + ax.z * d[2]), 1, 1e-4))) flag(`tube ${i} (${p.name}) drawn differently from its capsule`);
        }
      }
    }
    // every solid drawn exactly once, except the trunks under a drawn spruce (the spruce model has its trunk)
    let missing = 0, twice = 0;
    course.prims.forEach((p, i) => { if (p.look === 'trunk') { if (drawn[i]) twice++; return; } if (drawn[i] === 0) missing++; else if (drawn[i] > 1) twice++; });
    ok(missing === 0 && twice === 0, `${sc.id}: every solid drawn exactly once (${missing} missing, ${twice} twice)`);
    ok(bad === 0, `${sc.id}: every drawn solid sits exactly on its collision volume (${bad} differ)`);
    ok(gateBars === course.gates.length * 4, `${sc.id}: four frame bars per gate (${gateBars})`);
    ok(lights === course.lights.length + course.gates.length * 4, `${sc.id}: the night lights are the course's obstacle lights and the gates' corners (${lights})`);
    // two primers, an instanced caster with instance colours and one without (the aerodrome's and the forest's kind);
    // they ride with the aircraft for the first half second, then hide for good
    ok(primers.length === 2 && primers.filter((o) => !!o.instanceColor).length === 1, `${sc.id}: two shadow primers, with and without instance colours (${primers.length})`);
    const acPos = new THREE.Vector3(123, 45, -678);
    built.update(0.04, 0.04, acPos);
    ok(primers.every((o) => o.visible && o.position.equals(acPos)), `${sc.id}: the shadow primers ride with the aircraft at the start`);
    // blinking rewrites the colour buffer only on a toggle
    built.update(0.1, 0.1, acPos); built.update(0.1, 0.9, acPos); built.update(0.1, 1.6, acPos);
    ok(primers.every((o) => !o.visible), `${sc.id}: the shadow primers are hidden after half a second`);
    say(`${sc.id}: ${built.objects.length - primers.length} draws (+${primers.length} shadow primers for 0.5 s), every one of ${course.prims.length} solids drawn on its own volume, ${gateBars} gate bars, ${lights} lights at night`);
    // by day: no lights object at all
    const day = look.buildCourse(course.prims, course.gates, { terrain, night: false, quality: 'high', seed: course.seed, lights: course.lights });
    ok(!day.objects.some((o) => o.isPoints), `${sc.id}: no light draw by day`);
    const dayDraws = day.objects.filter((o) => !o.userData.primer).length;
    ok(dayDraws <= 8, `${sc.id}: at most 8 draws for the whole course (${dayDraws})`);
  }
}

// ============================================================ 5. gates and the mission runtime
{
  const sc = { course: { gates: [{ u: -1000, v: 0, y: 50, w: 60, h: 40, name: 'Gate A' }, { u: -500, v: 0, y: 50, w: 60, h: 40, name: 'Gate B', required: false, bonus: 7 }] } };
  const course = resolveCourse(SITES.bayfield, sc);
  const f = new ObstacleField(course);
  const A = f.gates[0], B = f.gates[1];
  ok(A.required && !B.required && B.bonus === 7 && A.bonus === 0, 'gate defaults: required unless marked, bonus points');
  // wrong way through A: nothing
  f.gatesStep(0, 50, -1010, 0, 50, -990);
  ok(A.state === 'pending', 'flying a gate backwards does not count');
  // through A inside the frame
  f.gatesStep(0, 50, 1010 - 2000, 0, 55, 990 - 2000);
  f.gatesStep(10, 60, 1010 - 1000 - 1000 + 1000, 10, 60, 990 - 1000 - 1000 + 1000);
  // (the runway is at the origin heading north: u = -z)
  const g2 = new ObstacleField(course);
  g2.gatesStep(5, 55, 1010, 5, 55, 990);
  ok(g2.gates[0].state === 'passed', 'crossing inside the frame passes the gate');
  g2.gatesStep(40, 50, 510, 40, 50, 490);
  ok(g2.gates[1].state === 'missed', 'crossing the plane outside the frame misses the gate');
  const g3 = new ObstacleField(course);
  g3.gatesStep(1500, 50, 1010, 1500, 50, 990);
  ok(g3.gates[0].state === 'pending', 'crossing the plane far outside the frame (another part of the flight) is not the gate');
  // the runtime's account
  const world = { obstacles: g2, runway: null };
  const mr = new MissionRuntime({ ...sc, id: 't' }, { world });
  mr.update(0.04, 1, { pos: new THREE.Vector3(), crashed: false });
  ok(mr.passed === 1 && mr.bonus === 0, 'the runtime counts the pass');
  const acOk = { crashed: false, stats: { touchdown: { vs: 1 } } };
  const res = mr.score({ points: 88, grade: 'SMOOTH', gradeIdx: 1, lines: [{ k: 'x', v: 'y', cls: '' }], headline: 'h' }, acOk, {});
  ok(res.points === 88 && res.grade === 'SMOOTH', `a missed BONUS gate costs nothing (${res.points})`);
  ok(res.lines.some((l) => l.k === 'Gates' && l.v === '1/2') && res.lines.some((l) => l.k === 'Missed gate' && /Gate B/.test(l.v)), 'the debrief lists the gates and the missed one');
  // a missed REQUIRED gate caps the points
  const g4 = new ObstacleField(course);
  g4.gatesStep(40, 50, 1010, 40, 50, 990);
  g4.gatesStep(0, 50, 510, 0, 50, 490);
  const mr4 = new MissionRuntime({ ...sc, id: 't' }, { world: { obstacles: g4 } });
  mr4.update(0.04, 1, { pos: new THREE.Vector3(), crashed: false });
  const r4 = mr4.score({ points: 95, grade: 'GREASED', gradeIdx: 0, lines: [], headline: 'h' }, acOk, {});
  ok(r4.points === MISSION_CAP && r4.grade === 'MISSED GATE' && /Gate A/.test(r4.headline), `a missed required gate caps the landing at ${MISSION_CAP} and says which (${r4.points}, ${r4.grade})`);
  ok(r4.lines.some((l) => l.k === 'Gates' && l.v === '1/2 (+7)'), 'the bonus is on the gates line');
  // bonus: added, clamped at 100
  const g5 = new ObstacleField(course);
  g5.gatesStep(0, 50, 1010, 0, 50, 990); g5.gatesStep(0, 50, 510, 0, 50, 490);
  const mr5 = new MissionRuntime({ ...sc, id: 't' }, { world: { obstacles: g5 } });
  mr5.update(0.04, 1, { pos: new THREE.Vector3(), crashed: false });
  ok(mr5.score({ points: 90, grade: 'x', gradeIdx: 0, lines: [], headline: '' }, acOk, {}).points === 97, 'a bonus gate adds its points');
  ok(mr5.score({ points: 98, grade: 'x', gradeIdx: 0, lines: [], headline: '' }, acOk, {}).points === 100, 'the total is clamped at 100');
  ok(mr5.score({ points: 0, grade: 'CRASH', gradeIdx: 5, lines: [], headline: 'Crashed' }, { crashed: true, stats: {} }, {}).points === 0, 'a crash stays at 0 whatever the gates');
  // the closest shave: a line after a landing, none after a crash (which says what was hit)
  g5.closestD = 3.2; g5.closestName = 'the test crane';
  const shave = (r) => r.lines.some((l) => l.k === 'Closest shave' && /3\.2 m from the test crane/.test(l.v));
  ok(shave(mr5.score({ points: 90, grade: 'x', gradeIdx: 0, lines: [], headline: '' }, acOk, {})), 'a landing lists the closest shave');
  ok(!shave(mr5.score({ points: 0, grade: 'CRASH', gradeIdx: 5, lines: [], headline: 'Crashed' }, { crashed: true, stats: {} }, {})), 'a crash does not list a closest shave');
  // never reached: not flown, fails the mission
  const g6 = new ObstacleField(course);
  const mr6 = new MissionRuntime({ ...sc, id: 't' }, { world: { obstacles: g6 } });
  const r6 = mr6.score({ points: 80, grade: 'x', gradeIdx: 1, lines: [], headline: '' }, acOk, {});
  ok(r6.points === MISSION_CAP && r6.lines.some((l) => l.k === 'Not flown'), 'a required gate never reached fails the mission too');
  // the HUD status line
  mr6.pos = new THREE.Vector3(0, 50, 1500);
  ok(/^Gates 0\/2 · Gate A 500 m$/.test(mr6.status()), `status line "${mr6.status()}"`);
  const plain = new MissionRuntime({ id: 'solo' }, { world: {} });
  ok(plain.status() === '' && plain.hint({ ac: { pos: new THREE.Vector3() }, ra: 0, d: 0, t: 0 }) === null, 'a mission without a course adds no status and no hint');
  ok(plain.score({ points: 77, grade: 'g', gradeIdx: 1, lines: [], headline: '' }, acOk, {}).points === 77, 'a mission without a course scores exactly as scoreLanding');
  say('gates: pass, miss, wrong way, far away; the runtime: lines, cap, bonus, clamp, crash, status');
}

// ============================================================ 6. the mission data
{
  const BOARD_ID = /^[a-z0-9][a-z0-9-]{0,23}$/;
  const want = { 'power-lines': 36, 'the-notch': 37, 'harbor-cranes': 38 };
  ok(OBSTACLES_MISSIONS.length === 3, 'three obstacle missions');
  const ids = new Set();
  for (const s of SCENARIOS) { ok(!ids.has(s.id), `mission id ${s.id} is unique`); ids.add(s.id); }
  ok(MISSION_GROUPS.some((g) => g.id === 'obstacles'), 'the obstacles group is in the menu groups');
  for (const sc of OBSTACLES_MISSIONS) {
    ok(BOARD_ID.test(sc.id), `${sc.id}: the id must be a leaderboard board id`);
    ok(want[sc.id] === sc.n, `${sc.id}: n is ${want[sc.id]}`);
    ok(SCENARIOS.includes(sc), `${sc.id}: registered in SCENARIOS`);
    ok(sc.group === 'obstacles' && sc.difficulty >= 1 && sc.difficulty <= 5 && Array.isArray(sc.tags), `${sc.id}: group, difficulty, tags`);
    for (const k of ['title', 'desc', 'aircraft', 'site', 'time', 'vis', 'wind', 'weight', 'spawn', 'failures', 'scoring', 'route']) ok(sc[k] != null, `${sc.id}: has ${k}`);
    ok(AIRCRAFT[sc.aircraft] && SITES[sc.site], `${sc.id}: its aircraft and site exist`);
    const sentences = sc.desc.split(/(?<=[.!?])\s+/).filter(Boolean).length;
    ok(sentences >= 2 && sentences <= 3, `${sc.id}: the description is 2-3 sentences (${sentences})`);
    ok(Array.isArray(sc.tips) && sc.tips.length === 3 && sc.tips.every((t) => typeof t === 'string' && t.length > 20), `${sc.id}: three tips`);
    // a tip that names a key must read differently on a phone (src/touch.js TOUCH_WORDS)
    for (const t of [...sc.tips, sc.desc]) {
      const namesKey = /\b(press|hold|tap)\s+[A-Z]\b|\([A-Z]\)|\bF twice\b|\bSpace\b|\([A-Z]\/[A-Z]\)/.test(t);
      if (namesKey) ok(touchify(t) !== t, `${sc.id}: "${t.slice(0, 60)}..." names a key and needs a TOUCH_WORDS entry`);
    }
    const rs = resolveScenario(sc, makeRng(4271), { approach: 'long' });
    ok(rs.spawn.u === sc.spawn.u && rs.spawn.v === sc.spawn.v && rs.scoring.type === sc.scoring.type && rs.wind !== sc.wind, `${sc.id}: resolves with a seeded rng, the spawn fixed, the wind copied`);
    ok(typeof sc.hint === 'function', `${sc.id}: has a hint function`);
  }
  ok(OBSTACLES_SITES.notchbar && SITES.notchbar === OBSTACLES_SITES.notchbar && SITES.notchbar.kind === 'bush', 'the Moose Creek Notch site is registered');
  // nothing original grows a field
  const original = SCENARIOS.filter((s) => s.n >= 1 && s.n <= 20);
  ok(original.length === 20, 'the original twenty are still there');
  for (const s of original) {
    const site = SITES[s.site === 'random' ? 'bayfield' : s.site];
    ok(ObstacleField.plan(site, s) === null, `${s.id}: an original challenge builds no obstacle field`);
    ok(!s.route && !s.course, `${s.id}: an original challenge has no route or course`);
  }
  for (const id of ['bayfield', 'harbor', 'ridgefield', 'carrier', 'gravelbar', 'oneway']) ok(!SITES[id].course, `${id}: an original site has no course`);
  say('mission data: ids, n, fields, 2-3 sentence descriptions, three tips, touch words; the originals build no field');
}

// ============================================================ 7. flights with the real physics
{
  const results = [];
  const flights = [
    // [mission, options, expectation]
    ['power-lines', { seed: 307 }, 'land'], ['power-lines', { seed: 4271 }, 'land'],
    ['the-notch', { seed: 307 }, 'land'], ['the-notch', { seed: 4271 }, 'land'],
    ['harbor-cranes', { seed: 307 }, 'land'], ['harbor-cranes', { seed: 4271 }, 'land'],
    // the challenge is real: the obvious wrong lines end in the obstacle
    // (level at the start height: 17 m over the ground there, which is 4.5 m below the threshold)
    ['power-lines', { seed: 307, route: [{ u: -300, v: 0, alt: 12.5, kt: 72 }] }, 'Hit the power lines'],
    ['the-notch', { seed: 307, pilot: 'autoland' }, 'Hit a tree'],
    ['harbor-cranes', { seed: 307, route: [{ u: -7200, v: 1120, alt: 55 }, { u: -6550, v: 1000, alt: 48 }, { u: -5000, v: 1000, alt: 44 }] }, /^Hit (the lowered crane boom|a container crane)$/],
    // over the top of the notch: a landing, but not the mission
    ['the-notch', { seed: 307, route: [{ u: -520, v: -3, alt: 60, kt: 50 }, { u: -150, v: 0, alt: 56, kt: 50 }] }, 'missed'],
    // over the boom instead of under it: the mission without the bonus
    ['harbor-cranes', { seed: 307, route: [{ u: -7200, v: 1120, alt: 55 }, { u: -6550, v: 1000, alt: 70 }, { u: -5100, v: 1000, alt: 72 }, { u: -4400, v: 700, alt: 110, kt: 150 }, { u: -3700, v: 250, alt: 160, kt: 148 }, { u: -3000, v: 0, alt: 182, kt: 145 }, { u: -2600, v: 0, alt: 161, kt: 142 }] }, 'land-nobonus'],
  ];
  for (const [id, opts, expect] of flights) {
    const r = await simulate(id, opts);
    results.push(r);
    const tag = `${id} ${opts.pilot || (opts.route ? 'custom route' : 'RoutePilot')} seed ${opts.seed}`;
    const gates = r.gates.join(', ');
    if (expect === 'land' || expect === 'land-nobonus') {
      const allRequired = r.gates.every((g) => /: passed$/.test(g) || /under the boom/.test(g));
      ok(!r.crashed && r.touchdown && allRequired && r.points >= 50, `${tag}: must land with every required gate (${r.points} ${r.grade}; ${r.reason}; gates ${gates})`);
      if (expect === 'land-nobonus') ok(r.gates.some((g) => /under the boom: missed/.test(g)) && !r.lines.some((l) => /\(\+10\)/.test(l)), `${tag}: over the boom is the mission without the bonus`);
      console.log(`PASS ${tag}: ${r.points} ${r.grade}, touchdown ${r.touchdown ? `${r.touchdown.u} m in, ${r.touchdown.fpm} fpm, ${r.touchdown.kt} kt` : '-'}; ${gates || 'no gates'}; closest ${r.closest}`);
    } else if (expect === 'missed') {
      ok(!r.crashed && r.touchdown && r.points <= MISSION_CAP && r.grade === 'MISSED GATE', `${tag}: over the top lands but fails the mission (${r.points} ${r.grade}; ${gates})`);
      console.log(`PASS ${tag}: over the top ${r.points} ${r.grade} (${gates})`);
    } else {
      ok(r.crashed && (expect instanceof RegExp ? expect.test(r.reason) : r.reason === expect), `${tag}: the wrong line must end "${expect}" (got ${r.crashed ? r.reason : 'no crash: ' + r.points + ' ' + r.grade})`);
      console.log(`PASS ${tag}: the wrong line ends "${r.reason}" after ${r.t} s (${r.part})`);
    }
  }
  // determinism: the same flight twice is the same flight
  const again = await simulate('harbor-cranes', { seed: 307 });
  const first = results[4];
  ok(JSON.stringify({ ...again, frames: 0 }) === JSON.stringify({ ...first, frames: 0 }) && again.frames === first.frames, 'the same seed flies the same flight');
  // the gate order: the harbor route passes the entrance, the boom and the exit
  ok(/entrance: passed.*under the boom: passed.*exit: passed/.test(first.gates.join(' | ')), `harbor-cranes: RoutePilot takes the bonus under the boom (${first.gates.join(', ')})`);
}

// ============================================================ 8. RoutePilot: over an obstacle, then steeply down
// What the city ladder is built on: something tall standing on the straight-in glide path, flown over level and
// then a descent well steeper than 3 degrees onto the final, in each aircraft RoutePilot must fly. The same course
// flown straight in by Autoland (obstacle-blind) must hit the obstacle, or the test proves nothing.
{
  const base = { n: 0, title: 'Steep descent (test)', group: 'obstacles', difficulty: 3, tags: [], time: 12, vis: 30000, wind: { rel: 20, speed: 6, turb: 0.2 }, weight: 'normal', failures: [], scoring: { type: 'runway' } };
  const cases = [
    // a 150 m tower 2 km out on Bayfield's glide path (which is 120 m up there); over it at 175 m, then 108 m down in
    // 950 m (6.5 degrees) onto the glide path
    { minDeg: 6, sc: { ...base, id: 'steep-condor', aircraft: 'condor', site: 'bayfield', spawn: { u: -6500, v: 0, alt: 175, gamma: 0, flap: 0.75, speedKt: 155, fixed: true },
      course: { obstacles: [{ kind: 'tower', u: -2000, v: 0, w: 30, d: 30, h: 150, name: 'the test tower' }] },
      route: [{ u: -2150, v: 0, alt: 175, over: true }, { u: -1850, v: 0, alt: 175, over: true }, { u: -900, v: 0, alt: 67 }] }, hit: 'Hit the test tower' },
    // a 55 m mast 600 m out at Ridgefield (the glide path is 46 m there); over at 70 m, then 42 m down in 310 m
    { minDeg: 6, sc: { ...base, id: 'steep-skylark', aircraft: 'skylark', site: 'ridgefield', spawn: { u: -2400, v: 0, alt: 70, gamma: 0, flap: 0.333, speedKt: 70, fixed: true },
      course: { obstacles: [{ kind: 'mast', u: -600, v: 0, h: 55, r: 1, name: 'the test mast' }] },
      route: [{ u: -660, v: 0, alt: 70, over: true }, { u: -560, v: 0, alt: 70, over: true, flap: 1 }, { u: -250, v: 0, alt: 28, flap: 1 }] }, hit: 'Hit the test mast' },
    // a row of 55 m spruce 300 m out at Ridgefield (the Trailblazer's 5-degree glide path is 48 m up there); over at
    // 68 m, then 53 m down in 330 m onto the runway
    { minDeg: 8, sc: { ...base, id: 'steep-trailblazer', aircraft: 'trailblazer', site: 'ridgefield', spawn: { u: -1600, v: 0, alt: 68, gamma: 0, flap: 1, speedKt: 52, fixed: true },
      course: { obstacles: [{ kind: 'treeWall', u: -300, from: -60, to: 60, step: 9, scale: 2.2, rows: 1 }] },
      route: [{ u: -360, v: 0, alt: 68, over: true }, { u: -270, v: 0, alt: 68, over: true }, { u: 60, v: 0, alt: 15 }] }, hit: 'Hit a tree' },
  ];
  for (const { sc, minDeg, hit } of cases) {
    for (const seed of [307, 4271]) {
      const r = await simulate(sc.id, { scenario: sc, seed, track: 5 });
      // the steepest flight path held for a second on the way down (after the obstacle, before the handover)
      const leg = r.track.filter((p) => p.phase === 'route' && p.u > sc.route[1].u);
      let steep = 0;
      for (let i = 5; i < leg.length; i++) steep = Math.max(steep, -Math.max(...leg.slice(i - 5, i).map((p) => p.gam)));
      ok(!r.crashed && r.touchdown && r.points >= 50 && r.touchdown.u > 0, `${sc.id} seed ${seed}: over the obstacle and steeply down, then Autoland lands (${r.crashed ? r.reason : r.points + ' ' + r.grade}, touchdown ${r.touchdown ? r.touchdown.u + ' m in, ' + r.touchdown.fpm + ' fpm' : '-'})`);
      ok(steep >= minDeg, `${sc.id} seed ${seed}: the descent after the obstacle is steep (${steep.toFixed(1)} deg held for a second; wanted ${minDeg})`);
      console.log(`PASS ${sc.id} seed ${seed}: ${r.points} ${r.grade}, down at ${steep.toFixed(1)} deg after the obstacle, touchdown ${r.touchdown ? `${r.touchdown.u} m in, ${r.touchdown.fpm} fpm, ${r.touchdown.kt} kt` : '-'}`);
    }
    const straight = await simulate(sc.id, { scenario: sc, seed: 307, pilot: 'autoland' });
    ok(straight.crashed && straight.reason === hit, `${sc.id}: flown straight in by Autoland it must end "${hit}" (got ${straight.crashed ? straight.reason : 'no crash'})`);
  }
  say('RoutePilot: over a tower, a mast and a tree line, then 7-10 degrees down to a landing, in the Condor, Skylark and Trailblazer; straight in, each obstacle is hit');
}

console.log(fails ? `\n${fails} of ${checks} obstacle checks FAILED` : `\nall ${checks} obstacle checks passed`);
process.exit(fails ? 1 : 0);
