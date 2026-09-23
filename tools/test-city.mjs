// The city ladder's test suite (plain Node, no GPU; part of `npm test`): Metro City and the six missions of "The city"
// (src/missions/city.js), on the obstacle engine (src/world/obstacles.js) and RoutePilot (src/systems/routepilot.js).
// The drawing contract and the city's draw and triangle budget are in tools/test-obstacles.mjs (sections 4 and 10).
//
// Since 2026-09-23 the ladder has NO GATES: each rung's line is forced by geometry, and this suite's job is to prove
// that - the intended line lands, and every other line ends in something. What it covers, in order:
//   1. the mission data: ids and n (44-49), the group, fields, 2-3 sentence descriptions, three tips (with touch
//      words for any key they name), resolving with a seeded rng; Metro City registered; no gates anywhere;
//   2. Metro City on its own: the straight-in 3-degree glide path is at least 30 m clear of everything, all the way
//      from 9 km out (free flight, Autoland and the look and perf tools fly it), and its districts generate the same
//      city twice, on land, off the runway;
//   3. each mission's course: resolves the same way twice, the spawn is 40 m clear, and the numbers the descriptions
//      quote are true: Downtown's gate buildings and its tall second row, the Slalom's canyon and its three slots,
//      the viaduct's deck, pylons and the mesh of stays over the deck (nowhere a wingspan fits), the Checkerboard's
//      corner of towers with the turn kept clear, the Crescents' walls;
//   4. the Needle: the gap (narrower than the 34.3 m span), the Condor's probe footprint banked 0-45 degrees (printed,
//      and the widths and fin height the texts quote), a perfect turn through it on the pilot's circle at 28, 30 and
//      35 degrees and on RoutePilot's at 40 clears it, wings level hits, and the window at 30 and 35 - for both eyes;
//   5. flights with the real physics (tools/fly-mission.mjs simulate(), the code the page runs): every mission flown by
//      RoutePilot on ten seeds - no crash, a landing every time, a median of at least 55 points - and the ways out:
//      straight in on the glideslope (the obstacle-blind Autoland), over, round, a full pull-up from the start;
//   6. the autopilot switched off and on inside the Needle's turn, 300 m before the eye: it keeps the arc and gets
//      through;
//   7. the Needle flown by a pilot who does only what the HUD hint says, never past the Assist's 35 degrees.
import { installDomStub } from './dom-stub.mjs';
installDomStub();
const THREE = await import('three');
const { DEG, KT, makeRng, clamp } = await import('../src/config.js');
const { AIRCRAFT } = await import('../src/aircraft/defs.js');
const { hullProbes } = await import('../src/aircraft/hulls.js');
const { ObstacleField } = await import('../src/world/obstacles.js');
const { SITES, SCENARIOS, resolveScenario, siteFlats } = await import('../src/systems/scenarios.js');
const { MISSION_GROUPS } = await import('../src/missions/index.js');
const { CITY_MISSIONS, CITY_SITES, NEEDLE } = await import('../src/missions/city.js');
const { RoutePilot } = await import('../src/systems/routepilot.js');
const { Terrain } = await import('../src/world/terrain.js');
const { touchify } = await import('../src/touch.js');
const { simulate } = await import('./fly-mission.mjs');

let checks = 0, fails = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log('FAIL ' + msg); } };
const say = (msg) => console.log('PASS ' + msg);
const byId = (id) => SCENARIOS.find((s) => s.id === id);
const site = SITES.metro;
const terrain = new Terrain({ ...site.terrain, flats: siteFlats(site) });
const rw = site.runways[0], H = rw.heading * DEG;
const W = (u, v, y = 0) => ({ x: rw.x + Math.sin(H) * u + Math.cos(H) * v, z: rw.z - Math.cos(H) * u + Math.sin(H) * v, y: rw.elevation + y });
const UV = (x, z) => ({ u: -(z - rw.z), v: x - rw.x });   // (heading north at the origin)
const glideCG = (u) => Math.max(0, (rw.aimDistance || 400) - u) * Math.tan(3 * DEG) + AIRCRAFT.condor.cgHeight;

// A stand-in aircraft for the field: pose (heading psi, bank phi: + right wing down), gear and flap state.
function fakeAc(id, x, y, z, psi = 0, phi = 0) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -psi, -phi, 'YXZ'));
  return { def: AIRCRAFT[id], pos: new THREE.Vector3(x, y, z), quat: q, ctl: { flap: 0.75, gear: 1 } };
}
// A full pull-up (full aft stick, full throttle, wings held level) from t0 seconds after the start.
const zoomAt = (t0) => (ac) => { let t = 0; const p0 = ac.euler.pitch; return { update(dt) { t += dt; const i = ac.input; i.roll = clamp(-2.0 * ac.euler.roll + 0.5 * ac.omega.z, -1, 1); i.yaw = clamp(1.5 * ac.aero.beta, -1, 1); if (t < t0) i.pitch = clamp(3 * (p0 - ac.euler.pitch) - 1.5 * ac.omega.x, -1, 1); else { i.throttle = 1; i.pitch = 1; } } }; };
// The eye of a crescent as a frame for the checks below: the aim point at the flight's height, heading psi.
const eyeOf = (gm) => { const p = W(gm.aim.u, gm.aim.v, NEEDLE.alt); return { x: p.x, y: p.y, z: p.z, psi: NEEDLE.psi * DEG + H, u: gm.aim.u, v: gm.aim.v }; };
// metres past the eye's plane (negative before it), for an airplane
const pastEyeBy = (ac, gm) => { const { u, v } = UV(ac.pos.x, ac.pos.z); const p = NEEDLE.psi * DEG; return (u - gm.aim.u) * Math.cos(p) + (v - gm.aim.v) * Math.sin(p); };

// ============================================================ 1. the mission data
{
  const BOARD_ID = /^[a-z0-9][a-z0-9-]{0,23}$/;
  const want = { checkerboard: 44, downtown: 45, slalom: 46, 'under-bridge': 47, 'the-needle': 48, gauntlet: 49 };
  ok(CITY_MISSIONS.length === 6, 'six city missions');
  ok(MISSION_GROUPS.some((g) => g.id === 'city'), 'the city group is in the menu groups');
  ok(CITY_SITES.metro && SITES.metro === CITY_SITES.metro && site.kind === 'airport' && site.terrain.style === 'coast', 'Metro City is registered, an airport on the coast style');
  ok(rw.length >= 2800 && rw.ils && rw.lights && rw.papi, `Metro Intl: a Condor-length runway with ILS, lights and PAPI (${rw.length} m)`);
  const ids = new Set();
  for (const s of SCENARIOS) { ok(!ids.has(s.id), `mission id ${s.id} is unique`); ids.add(s.id); }
  for (const sc of CITY_MISSIONS) {
    ok(BOARD_ID.test(sc.id), `${sc.id}: the id must be a leaderboard board id`);
    ok(want[sc.id] === sc.n, `${sc.id}: n is ${want[sc.id]}`);
    ok(SCENARIOS.includes(sc), `${sc.id}: registered in SCENARIOS`);
    ok(sc.group === 'city' && sc.difficulty >= 1 && sc.difficulty <= 5 && Array.isArray(sc.tags), `${sc.id}: group, difficulty, tags`);
    ok(sc.aircraft === 'condor' && sc.site === 'metro', `${sc.id}: the Condor at Metro City`);
    for (const k of ['title', 'desc', 'aircraft', 'site', 'time', 'vis', 'wind', 'weight', 'spawn', 'failures', 'scoring', 'route', 'course']) ok(sc[k] != null, `${sc.id}: has ${k}`);
    ok(!sc.course.gates || sc.course.gates.length === 0, `${sc.id}: no gates`);
    const sentences = sc.desc.split(/(?<=[.!?])\s+/).filter(Boolean).length;
    ok(sentences >= 2 && sentences <= 3, `${sc.id}: the description is 2-3 sentences (${sentences})`);
    ok(Array.isArray(sc.tips) && sc.tips.length === 3 && sc.tips.every((t) => typeof t === 'string' && t.length > 20), `${sc.id}: three tips`);
    for (const t of [...sc.tips, sc.desc]) {
      const namesKey = /\b(press|hold|tap)\s+[A-Z]\b|\([A-Z]\)|\bF twice\b|\bSpace\b|\([A-Z]\/[A-Z]\)/.test(t);
      if (namesKey) ok(touchify(t) !== t, `${sc.id}: "${t.slice(0, 60)}..." names a key and needs a TOUCH_WORDS entry`);
    }
    const rs = resolveScenario(sc, makeRng(4271), { approach: 'long' });
    ok(rs.spawn.u === sc.spawn.u && rs.spawn.v === sc.spawn.v && rs.scoring.type === 'runway' && rs.wind !== sc.wind, `${sc.id}: resolves with a seeded rng, the spawn fixed, the wind copied`);
    ok(typeof sc.hint === 'function', `${sc.id}: has a hint function`);
  }
  const g = byId('gauntlet');
  ok(g.weather && g.weather.preset === 'storm' && g.weather.rain >= 0.5 && g.time > 19.5, 'the Gauntlet is flown at night in a storm (its weather spec for the storm\'s look and model)');
  say('mission data: ids 44-49, fields, descriptions, tips, touch words, no gates; Metro City registered; the Gauntlet at night in a storm');
}

// ============================================================ 2. Metro City on its own
{
  const course = ObstacleField.plan(site, { id: 'free' });
  const again = ObstacleField.plan(site, { id: 'free' });
  ok(JSON.stringify(course.prims) === JSON.stringify(again.prims), 'Metro City builds the same city twice');
  const field = new ObstacleField(course);
  let worst = { d: Infinity };
  for (let u = -9000; u <= 0; u += 15) for (const v of [-18, 0, 18]) {
    const p = W(u, v, glideCG(u)); const r = field.clearance(p, 250);
    if (r.d < worst.d) worst = { d: r.d, u, v, name: r.prim && r.prim.name };
  }
  ok(worst.d > 30, `the straight-in glide path is at least 30 m clear of the city (closest ${worst.d.toFixed(1)} m, ${worst.name} at u ${worst.u})`);
  const water = terrain.waterLevel;
  const bld = course.prims.filter((p) => (p.kind === 'tower' || p.kind === 'block') && p.hint && p.hint.height && p.hint.cls !== 'industrial');
  let wet = 0, onStrip = 0;
  for (const p of bld) {
    if (terrain.height(p.cx, p.cz) < water + 1) wet++;
    const u = -(p.cz - rw.z), v = p.cx - rw.x;
    if (u > -300 && u < rw.length + 300 && Math.abs(v) < 420) onStrip++;
  }
  ok(bld.length > 3000 && wet === 0 && onStrip === 0, `the districts: ${bld.length} buildings, none on the water (${wet}) or the runway strip (${onStrip})`);
  const counts = { low: 0, mid: 0, high: 0, super: 0 };
  for (const p of bld) counts[p.hint.height]++;
  const tallest = Math.max(...bld.map((p) => p.max[1] - rw.elevation));
  say(`Metro City: ${course.prims.length} solids (${bld.length} generated buildings: ${Object.entries(counts).map(([k, n]) => n + ' ' + k).join(', ')}; tallest ${tallest.toFixed(0)} m), the glide path ${worst.d.toFixed(0)} m clear at the closest (${worst.name})`);
  const deck = course.prims.find((p) => p.kind === 'bridge-deck');
  const under = deck.cy - deck.hy - rw.elevation;
  ok(Math.abs(under - 56) < 0.5, `the Harbor Bridge's deck: underside 56 m above the runway, 60 m over the water (${under.toFixed(1)})`);
  const hill = course.prims.find((p) => p.kind === 'landmark' && p.look === 'hill');
  const hillTop = hill.y1 - rw.elevation;
  ok(hillTop > 110 && hillTop < 150, `Checkerboard Hill stands ${hillTop.toFixed(0)} m above the runway`);
  const board = course.prims.find((p) => p.look === 'checker');
  const nrm = board.Y[0] > 0 ? board.Y : board.Y.map((c) => -c);
  ok(nrm[0] > 0.4 && nrm[2] > 0.4, `the checkerboard faces the south-east, down the line of the turn (normal ${nrm.map((c) => c.toFixed(2)).join(', ')})`);
  const sq = board.hint && board.hint.squares;
  ok(sq && sq.every((n) => Number.isInteger(n)) && Math.abs(sq[0] * 10 - 2 * board.hz) < 0.01 && Math.abs(sq[1] * 10 - 2 * board.hx) < 0.01, `the board's hint names whole 10 m squares, [across, up] (${JSON.stringify(sq)} on ${(2 * board.hz).toFixed(0)} x ${(2 * board.hx).toFixed(0)} m)`);
}

// ============================================================ 3. the courses
const courseOf = (sc) => ObstacleField.plan(site, sc);
for (const sc of CITY_MISSIONS) {
  const course = courseOf(sc), again = courseOf(sc);
  ok(JSON.stringify(course.prims) === JSON.stringify(again.prims), `${sc.id}: the course resolves the same way twice`);
  ok(course.gates.length === 0, `${sc.id}: the course has no gates`);
  const field = new ObstacleField(course);
  const rs = resolveScenario(sc, makeRng(307), { approach: 'short' });
  const sp = rs.spawn, spY = sp.alt != null ? Math.max(terrain.height(W(sp.u, sp.v).x, W(sp.u, sp.v).z), rw.elevation) + sp.alt : rw.elevation + glideCG(sp.u);
  const clr = field.clearance({ ...W(sp.u, sp.v), y: spY }, 3000);
  ok(clr.d > 40, `${sc.id}: the spawn is at least 40 m from any solid (${clr.d.toFixed(0)} m)`);
  say(`${sc.id}: ${course.prims.length} solids, no gates, spawn ${clr.d.toFixed(0)} m clear (${clr.prim ? clr.prim.name : '-'})`);
}
{
  // Downtown: two gate buildings across the avenue, 500 m tall, undersides 100 and 82 m (both across the glide
  // path); every tower on the avenue taller than the path at its feet; the second row 200 m and more
  const sc = byId('downtown'), course = courseOf(sc);
  const sbs = course.prims.filter((p) => p.kind === 'skybridge').sort((a, b) => b.cz - a.cz);
  ok(sbs.length === 2, 'Downtown: two gate buildings across the avenue');
  const u0 = sbs.map((p) => ({ u: -(p.cz - rw.z), under: p.cy - p.hy - rw.elevation, top: p.cy + p.hy - rw.elevation }));
  ok(Math.abs(u0[0].under - 100) < 0.5 && Math.abs(u0[1].under - 82) < 0.5, `Downtown: the archways' undersides 100 and 82 m up (${u0.map((s) => s.under.toFixed(0)).join(', ')})`);
  ok(u0.every((s) => s.top >= 480), `Downtown: the gate buildings reach ${u0.map((s) => s.top.toFixed(0)).join(' and ')} m`);
  ok(u0.every((s) => glideCG(s.u) > s.under - 9 && glideCG(s.u) < s.top), `Downtown: both gate buildings stand across the glide path (the path at ${u0.map((s) => glideCG(s.u).toFixed(0)).join(', ')} m)`);
  const route = sc.route.filter((w) => w.u < -2100);
  ok(route.every((w) => w.alt + NEEDLE.fin + 0.5 <= 82), `Downtown: the route down the avenue stays under the second archway with the fin to spare (${route.map((w) => w.alt).join(', ')} m)`);
  const avenue = course.prims.filter((p) => p.name === 'an office tower' && Math.abs(p.cx - rw.x) < 140 && -(p.cz - rw.z) < -600 && -(p.cz - rw.z) > -3600);
  const shorter = avenue.filter((p) => p.max[1] - rw.elevation < glideCG(-(p.cz - rw.z)) + 20);
  ok(avenue.length > 40 && shorter.length === 0, `Downtown: every tower on the avenue is taller than the glide path at its feet (${avenue.length} towers, ${shorter.length} not)`);
  const second = course.prims.filter((p) => p.hint && p.hint.cls === 'office' && p.hint.roof === 'flat' && Math.abs(p.cx - rw.x) > 150 && Math.abs(p.cx - rw.x) < 360);
  const low = second.filter((p) => p.max[1] - rw.elevation < 190);
  ok(second.length > 40 && low.length === 0, `Downtown: the second row behind the avenue is 200 m and more (${second.length} buildings, ${low.length} under 190 m)`);
  say(`Downtown: gate buildings ${u0.map((s) => `${Math.round(-s.u)} m out, archway ${s.under.toFixed(0)} m, top ${s.top.toFixed(0)}`).join('; ')}; ${avenue.length} towers along the avenue above the path; ${second.length} in the tall second row`);
}
{
  // the Slalom: side walls 400 m and more, and the three cross-walls with their 56 m slots where the apexes say
  const sc = byId('slalom'), course = courseOf(sc);
  const side = course.prims.filter((p) => p.name === 'the canyon wall');
  ok(side.length >= 40 && side.every((p) => p.max[1] - rw.elevation >= 395), `Slalom: ${side.length} slabs of canyon wall, all 400 m and more`);
  for (const [i, a] of [[1, 60], [2, -60], [3, 60]]) {
    const walls = course.prims.filter((p) => p.name === `the wall at gap ${i}`).sort((p, q) => p.cx - q.cx);
    const left = walls[0].cx + walls[0].hx - rw.x, right = walls[1].cx - walls[1].hx - rw.x;
    ok(walls.length === 2 && Math.abs(left - (a - 28)) < 0.5 && Math.abs(right - (a + 28)) < 0.5 && walls.every((p) => p.max[1] - rw.elevation >= 395), `Slalom: gap ${i} is 56 m wide at v ${a} in a 400 m wall (${left.toFixed(1)}..${right.toFixed(1)})`);
  }
  say(`Slalom: a canyon of ${side.length} wall slabs and three slotted cross-walls`);
}
{
  // Under the Bridge: the viaduct's deck 70 m up, four pylons 300 m, and the mesh of stays over the deck: nowhere
  // between v -460 and 460, at 100 and 200 m up, is a stay more than 17 m away (a 34 m wingspan cannot fit)
  const sc = byId('under-bridge'), course = courseOf(sc), field = new ObstacleField(course);
  const deck = course.prims.find((p) => p.name === 'the viaduct');
  ok(deck && Math.abs(deck.cy - deck.hy - rw.elevation - 70) < 0.5, `Under the Bridge: the viaduct's underside is 70 m up (${deck ? (deck.cy - deck.hy - rw.elevation).toFixed(1) : '-'})`);
  const pylons = course.prims.filter((p) => p.name === 'a viaduct pylon');
  ok(pylons.length === 4 && pylons.every((p) => p.max[1] - rw.elevation >= 299), `Under the Bridge: four pylons 300 m tall (${pylons.length})`);
  const stays = course.prims.filter((p) => p.name === 'a viaduct stay');
  let holes = 0, worst = 0;
  // (the reachable part of it: from a start 450 m before at 45 m, a few hundred metres either side of the centreline
  // and up to 150 m, three times what a full pull-up from the start gains by the deck; higher up the fans converge on
  // their pylons and open, out of reach)
  for (let v = -220; v <= 220; v += 10) for (const y of [90, 150]) { const r = field.clearance(W(-1200, v, y), 100); if (r.d > 17) holes++; worst = Math.max(worst, r.d); }
  ok(stays.length >= 128 && holes === 0, `Under the Bridge: ${stays.length} stay segments make a mesh over the deck - the widest hole leaves ${worst.toFixed(1)} m to the nearest cable (a wingspan needs 17)`);
  const middle = field.clearance(W(-1200, 0, 48), 200);
  ok(middle.d > 15, `Under the Bridge: under the deck between the middle pylons is clear (${middle.d.toFixed(1)} m to ${middle.prim && middle.prim.name})`);
  say(`Under the Bridge: deck ${(deck.cy - deck.hy - rw.elevation).toFixed(0)} m, ${pylons.length} pylons, ${stays.length} stay segments, the widest hole in the mesh ${worst.toFixed(1)} m, under the deck ${middle.d.toFixed(0)} m clear`);
}
{
  // the Checkerboard: the corner is a district of 220-300 m towers, and the run-in, the turn and the final are clear
  const sc = byId('checkerboard'), course = courseOf(sc), field = new ObstacleField(course);
  const corner = course.prims.filter((p) => p.hint && p.hint.cls === 'office' && p.hint.roof === 'crown' && p.cx - rw.x > 100 && p.cx - rw.x < 950 && -(p.cz - rw.z) > -3400 && -(p.cz - rw.z) < -600);
  ok(corner.length > 60 && corner.every((p) => p.max[1] - rw.elevation >= 200), `Checkerboard: the corner is ${corner.length} towers, all 200 m and more`);
  const D = DEG, CB_R = 1200, CB_E = -1250, S = { u: CB_E - CB_R * Math.sin(45 * D), v: CB_R * (1 - Math.cos(45 * D)) };
  let worst = Infinity;
  for (let d = 2500; d >= 0; d -= 50) { const p = W(S.u - d * Math.cos(45 * D), S.v + d * Math.sin(45 * D), 122 + d * Math.tan(3 * D)); worst = Math.min(worst, field.clearance(p, 400).d); }
  for (let a = 0; a <= 45; a += 2) { const p = W(CB_E - CB_R * Math.sin((45 - a) * D), CB_R - CB_R * Math.cos((45 - a) * D), 122 - (122 - 91) * a / 45); worst = Math.min(worst, field.clearance(p, 400).d); }
  for (let u = CB_E; u <= -300; u += 50) worst = Math.min(worst, field.clearance(W(u, 0, glideCG(u)), 400).d);
  ok(worst > 60, `Checkerboard: the run-in, the turn and the final are clear (at least ${worst.toFixed(0)} m to anything)`);
  say(`Checkerboard: ${corner.length} towers fill the corner, the line is ${worst.toFixed(0)} m clear at the tightest`);
}
{
  // the Crescents: a wall of towers 300 m and more along both sides of the turn, and the Needle's own towers joined
  // all the way up
  for (const [id, gm] of [['the-needle', NEEDLE.geom], ['gauntlet', NEEDLE.gauntlet]]) {
    const course = courseOf(byId(id));
    const walls = course.prims.filter((p) => p.name === 'the Crescent');
    const slab = course.prims.find((p) => p.kind === 'skybridge' && p.name === 'the Needle');
    ok(walls.length >= 80 && walls.every((p) => p.max[1] - rw.elevation >= 295), `${id}: the Crescent is ${walls.length} towers, all 300 m and more`);
    ok(slab && slab.cy + slab.hy - rw.elevation >= 280 && slab.cy - slab.hy - rw.elevation > 110, `${id}: the Needle's towers are joined from ${slab ? (slab.cy - slab.hy - rw.elevation).toFixed(0) : '-'} m up to ${slab ? (slab.cy + slab.hy - rw.elevation).toFixed(0) : '-'}`);
    say(`${id}: ${walls.length} towers in the Crescent, the eye ${gm.aim.u} m out, a ${gm.mouth} m mouth`);
  }
}

// ============================================================ 4. the Needle (both eyes)
for (const [id, gm] of [['the-needle', NEEDLE.geom], ['gauntlet', NEEDLE.gauntlet]]) {
  const sc = byId(id), course = courseOf(sc), field = new ObstacleField(course);
  const g = eyeOf(gm);
  const towers = course.prims.filter((p) => p.shape === 'cyl' && p.name === 'the Needle' && p.look === 'building');
  ok(towers.length === 2, `${id}: two round towers`);
  const gap = Math.hypot(towers[0].x - towers[1].x, towers[0].z - towers[1].z) - towers[0].r0 - towers[1].r0;
  ok(Math.abs(gap - NEEDLE.gap) < 0.05 && gap < AIRCRAFT.condor.span, `${id}: the gap is ${gap.toFixed(2)} m, narrower than the Condor's ${AIRCRAFT.condor.span} m span`);
  const Hh = hullProbes(AIRCRAFT.condor), rows = [];
  for (const deg of [0, 15, 20, 25, 30, 35, 40, 45]) {
    const f = deg * DEG; let lo = Infinity, hi = -Infinity;
    for (const p of [...Hh.probes.map((q) => ({ x: q.x, y: q.y + 0.75 * (q.fy || 0), r: q.r })), ...Hh.gear]) {
      const lat = p.x * Math.cos(f) + p.y * Math.sin(f); lo = Math.min(lo, lat - p.r); hi = Math.max(hi, lat + p.r);
    }
    rows.push({ deg, w: hi - lo, mid: (hi + lo) / 2 });
  }
  const w = (d) => rows.find((r) => r.deg === d).w;
  if (id === 'the-needle') {
    ok(w(0) > gap && w(20) < gap && w(35) < gap - 3.5, `the Condor's footprint: ${rows.map((r) => `${r.deg} deg ${r.w.toFixed(1)} m`).join(', ')}: wider than the gap wings level, narrower banked 20 degrees or more`);
    ok([30, 35, 40, 45].every((d) => Math.abs(w(d) - NEEDLE.width[d]) < 0.6) && Math.abs(w(0) - 35) < 0.6, `the widths the texts quote (CONDOR_WIDTH ${JSON.stringify(NEEDLE.width)}, 35 wings level) match the hull`);
    const fin = Math.max(...Hh.probes.map((p) => Math.max(p.y, p.y + (p.fy || 0)) + p.r));
    ok(fin <= NEEDLE.fin && fin > NEEDLE.fin - 0.25, `the fin stands ${fin.toFixed(2)} m over the CG (FIN ${NEEDLE.fin} in city.js, at least that)`);
  }
  const psi = g.psi, nx = Math.cos(psi), nz = Math.sin(psi);
  const turn = (R, bank, off = 0) => {
    const Cx = g.x + R * nx, Cz = g.z + R * nz, ac = fakeAc('condor', 0, g.y, 0), e = new THREE.Euler();
    let hit = null;
    for (let k = 0; k <= 200; k++) {
      const th = psi - 0.25 + k * 0.5 / 200;
      ac.pos.set(Cx - (R + off) * Math.cos(th), g.y, Cz - (R + off) * Math.sin(th));
      ac.quat.setFromEuler(e.set(0, -th, -bank * DEG, 'YXZ'));
      if (k === 0) field.reset(ac);
      hit = hit || field.hit(ac);
    }
    return { hit, clear: field.closestD };
  };
  const res = [28, 30, 35].map((b) => ({ b, ...turn(NEEDLE.r, b) }));
  ok(res.every((r) => !r.hit), `${id}: the pilot's circle flown through the eye clears it at 28, 30 and 35 degrees of bank (${res.map((r) => `${r.b}: ${r.hit || r.clear.toFixed(2) + ' m'}`).join(', ')})`);
  const ap = turn(NEEDLE.rAp, NEEDLE.apBank);
  ok(!ap.hit && ap.clear > 2, `${id}: RoutePilot's circle at ${NEEDLE.apBank} degrees clears it by ${ap.hit || ap.clear.toFixed(2) + ' m'}`);
  const level = turn(NEEDLE.r, 0);
  ok(!!level.hit, `${id}: the same line wings level hits (${level.hit})`);
  const windowAt = (b) => { let lo = 0, hi = 0; for (let o = 0; o <= 4; o += 0.1) { if (turn(NEEDLE.r, b, o).hit) break; hi = o; } for (let o = 0; o <= 4; o += 0.1) { if (turn(NEEDLE.r, b, -o).hit) break; lo = o; } return { lo, hi }; };
  const w30 = windowAt(30), w35 = windowAt(35);
  ok(w30.lo + w30.hi >= 2 && w35.lo + w35.hi >= 3.5, `${id}: the window is ${(w30.lo + w30.hi).toFixed(1)} m at 30 degrees, ${(w35.lo + w35.hi).toFixed(1)} m at 35 (${w35.lo.toFixed(1)} inside, ${w35.hi.toFixed(1)} outside the line)`);
  say(`${id}: gap ${gap.toFixed(1)} m; the pilot's circle clears at 28/30/35 degrees by ${res.map((r) => r.clear.toFixed(2)).join('/')} m, RoutePilot's at ${NEEDLE.apBank} by ${ap.clear.toFixed(2)} m; window ${(w30.lo + w30.hi).toFixed(1)} m at 30, ${(w35.lo + w35.hi).toFixed(1)} m at 35; wings level: ${level.hit}`);
}

// ============================================================ 5. flights with the real physics
// RoutePilot on ten seeds each (the two named ones and 1-8): no crash, a landing every time, a median of at least 55
// points (the gate-free lines end low and short, and Autoland lands them firmer than a long straight-in); then the same
// seed flying the same flight, and the ways out.
const SEEDS = [307, 4271, 1, 2, 3, 4, 5, 6, 7, 8];
{
  const results = {};
  for (const sc of CITY_MISSIONS) {
    const rs = [];
    for (const seed of SEEDS) {
      const r = await simulate(sc.id, { seed });
      results[sc.id + seed] = r; rs.push(r);
      if (seed === 307 || seed === 4271) ok(!r.crashed && r.touchdown && r.gates.length === 0 && r.points >= 40, `${sc.id} RoutePilot seed ${seed}: lands, no gates (${r.crashed ? r.reason : r.points + ' ' + r.grade})`);
    }
    const crashed = rs.filter((r) => r.crashed).length, landed = rs.filter((r) => !r.crashed && r.touchdown).length;
    const pts = rs.map((r) => (r.crashed ? 0 : r.points)).sort((a, b) => a - b), med = (pts[4] + pts[5]) / 2;
    const fpm = rs.filter((r) => r.touchdown).map((r) => r.touchdown.fpm).sort((a, b) => a - b);
    // (the Gauntlet's bar is 50: at night in 18-kt gusts, off the lowest final of the ladder)
    const bar = sc.id === 'gauntlet' ? 50 : 55;
    ok(crashed === 0 && landed === SEEDS.length && med >= bar, `${sc.id}: RoutePilot over ${SEEDS.length} seeds - no crash (${crashed}), a landing every time (${landed}), median at least ${bar} (${med})`);
    const cl = rs.filter((r) => r.closest).map((r) => parseFloat(r.closest)).sort((a, b) => a - b);
    console.log(`PASS ${sc.id}: RoutePilot on ${SEEDS.length} seeds: ${landed}/${SEEDS.length} landed, points ${pts[0]}-${pts[pts.length - 1]} (median ${med}), touchdown ${fpm[0]}-${fpm[fpm.length - 1]} fpm${cl.length ? `, closest ${cl[0].toFixed(1)}-${cl[cl.length - 1].toFixed(1)} m` : ''}; seed 307 ${results[sc.id + 307].points} ${results[sc.id + 307].grade}, 4271 ${results[sc.id + 4271].points} ${results[sc.id + 4271].grade}`);
  }
  const again = await simulate('the-needle', { seed: 307 });
  ok(JSON.stringify(again) === JSON.stringify(results['the-needle307']), 'the same seed flies the same flight (the Needle)');
  // the ways out: every one must end in something
  const D = DEG, cb = { u: -1250 - 1200 * Math.sin(45 * D), v: 1200 * (1 - Math.cos(45 * D)) };
  const cbAt = (d) => ({ u: Math.round(cb.u - d * Math.cos(45 * D)), v: Math.round(cb.v + d * Math.sin(45 * D)) });
  const eyeLines = (gm) => {
    const T = gm.turn(NEEDLE.r), S = T.S, E = T.E;
    return [
      ['through the eye wings level', { route: [{ ...gm.runIn(S, 200), alt: NEEDLE.alt }, { u: gm.aim.u + 300 * Math.cos(-15 * D), v: gm.aim.v + 300 * Math.sin(-15 * D), alt: NEEDLE.alt, over: true }] }, /^Hit (the Crescent|the Needle)$/],
      ['straight on past the mouth', { route: [{ ...gm.runIn(S, -900), alt: NEEDLE.alt }] }, /^Hit the Crescent$/],
      ['a turn too tight, inside the eye', { route: [{ ...gm.runIn(S, 200), alt: NEEDLE.alt }, { ...S, alt: NEEDLE.alt }, { u: E.u - 250, v: E.v + 120, alt: NEEDLE.alt, arc: 'R', r: 600, bank: 45 }] }, /^Hit (the Crescent|the Needle)$/],
      ['a full pull-up from the start', { makePilot: zoomAt(0.5) }, /^Hit (the Crescent|the Needle)$/],
    ];
  };
  const wrong = [
    ['checkerboard', 'straight on at the board', { route: [{ ...cbAt(1600), alt: 205 }, { ...cb, alt: 122 }, { ...cbAt(-1900), alt: 60 }] }, /^Hit (Checkerboard Hill|the checkerboard)$/],
    ['checkerboard', 'direct to the runway from the start', { route: [{ u: -300, v: 0, alt: 40 }] }, /^Hit an office tower$/],
    ['checkerboard', 'the corner cut, a turn 300 m early', { route: [{ ...cbAt(1600), alt: 205 }, { ...cbAt(300), alt: 130 }, { u: -1050, v: 0, alt: 70, arc: 'R', r: 900, bank: 45, kt: 146 }] }, /^Hit an office tower$/],
    ['downtown', 'straight in on the glideslope (Autoland)', { pilot: 'autoland' }, /^Hit the first gate building$/],
    ['downtown', 'over the rooftops beside the avenue at 120 m', { route: [{ u: -4200, v: -250, alt: 120 }, { u: -900, v: -250, alt: 120 }, { u: -300, v: 0, alt: 40 }] }, /^Hit an office tower$/],
    ['downtown', 'over the rooftops beside the avenue at 300 m', { route: [{ u: -3900, v: -250, alt: 300 }, { u: -900, v: -250, alt: 300 }, { u: 100, v: 0, alt: 20 }] }, /^Hit an office tower$/],
    ['downtown', 'a full pull-up from the start', { makePilot: zoomAt(0.5) }, /^Hit /],
    ['slalom', 'straight in on the glideslope (Autoland)', { pilot: 'autoland' }, /^Hit the wall at gap 1$/],
    ['slalom', 'out through the side wall', { route: [{ u: -4000, v: 0, alt: 110 }, { u: -3000, v: -400, alt: 150 }, { u: -1000, v: 0, alt: 80 }] }, /^Hit the canyon wall$/],
    ['slalom', 'a full pull-up from the start', { makePilot: zoomAt(0.5) }, /^Hit the canyon wall$/],
    ['under-bridge', 'straight in on the glideslope (Autoland)', { pilot: 'autoland' }, /^Hit (the viaduct|a viaduct stay)$/],
    ['under-bridge', 'over the deck', { route: [{ u: -1500, v: 0, alt: 95 }, { u: -1100, v: 0, alt: 95, over: true }, { u: -500, v: 0, alt: 50 }] }, /^Hit a viaduct stay$/],
    ['under-bridge', 'a full pull-up from the start', { makePilot: zoomAt(0.5) }, /^Hit (the viaduct|a viaduct stay)$/],
    ...eyeLines(NEEDLE.geom).map((l) => ['the-needle', ...l]),
    ...eyeLines(NEEDLE.gauntlet).map((l) => ['gauntlet', ...l]),
  ];
  for (const [id, what, o, want] of wrong) {
    const r = await simulate(id, { seed: 307, ...o });
    ok(r.crashed && want.test(r.reason), `${id}: ${what} must end ${want} (got ${r.crashed ? r.reason : 'no crash: ' + r.points + ' ' + r.grade})`);
    console.log(`PASS ${id}: ${what} ends "${r.reason}" after ${r.t} s (${r.part})`);
  }
}

// ============================================================ 6. the autopilot switched off and on inside the turn
// game.setAutopilot(false) then (true) makes a fresh RoutePilot that resumes where the airplane is along the route.
// Inside the Needle's arc it must keep the arc's own circle (a chord from the airplane to the arc's end runs 40 m
// inside it, into the inner tower): switched 300 m before the eye, banked, it must still go through and land.
{
  const before = (gm, dist) => (ac) => { const d = pastEyeBy(ac, gm); return d < 0 && d > -dist; };
  for (const [id, gm, seed] of [['the-needle', NEEDLE.geom, 307], ['the-needle', NEEDLE.geom, 4], ['the-needle', NEEDLE.geom, 5], ['gauntlet', NEEDLE.gauntlet, 307]]) {
    const r = await simulate(id, { seed, resume: before(gm, 300) });
    ok(!!r.resumed && !r.crashed && r.touchdown, `${id} seed ${seed}: the autopilot switched off and on 300 m before the eye (at ${r.resumed ? r.resumed.t + ' s' : '-'}) still goes through and lands (${r.crashed ? r.reason : r.points + ' ' + r.grade})`);
    console.log(`PASS ${id} seed ${seed}: resumed at ${r.resumed && r.resumed.t} s, 300 m before the eye: ${r.crashed ? r.reason : r.points + ' ' + r.grade}, closest ${r.closest}`);
  }
}

// ============================================================ 7. the Needle flown the way the hint says
// A pilot who does what the HUD hint says and no more: holds the run-in line (steering for a point 600 m ahead on it,
// as a pilot lining up visually does) until "Roll right now", then the bank the hint shows, never past the Assist's
// 35 degrees, rounded to the degree it prints; 60 m past the eye the autopilot is switched on to take it home. It must go
// through the eye on every seed in The Needle's wind, and on at least 7 of 10 in the Gauntlet's 18-kt gusts.
{
  const HINT_CAP = 35;
  const hintPilot = (gm) => (ac, world, sc, mission) => {
    const rp = new RoutePilot(ac, world, sc), tgt = { x: 0, z: 0 }, ctx = { ac, ra: 0, d: 0, t: 0 };
    let cmd = 0, rolled = false, handed = null;
    return { update(dt) {
      if (handed) { handed.update(dt); return; }
      ctx.t += dt; ctx.ra = ac.radioAlt / 0.3048;
      if (pastEyeBy(ac, gm) > 60) { handed = new RoutePilot(ac, world, sc); handed.update(dt); return; }
      const h = mission.hint(ctx) || '';
      let m;
      if ((m = /Roll right now: (\d+)/.exec(h))) { cmd = Math.min(HINT_CAP, +m[1]); rolled = true; } else if ((m = /^Bank (\d+) degrees/.exec(h))) { cmd = Math.min(HINT_CAP, +m[1]); rolled = true; }
      if (!rolled) {
        const rw2 = world.runway, P = gm.path, dx = ac.pos.x - rw2.threshold.x, dz = ac.pos.z - rw2.threshold.z;
        const u = dx * rw2.dir.x + dz * rw2.dir.z, v = dx * rw2.right.x + dz * rw2.right.z;
        const s = (u - P.S.u) * P.d0.u + (v - P.S.v) * P.d0.v + 600, tu = P.S.u + P.d0.u * s, tv = P.S.v + P.d0.v * s;
        tgt.x = rw2.threshold.x + rw2.dir.x * tu + rw2.right.x * tv; tgt.z = rw2.threshold.z + rw2.dir.z * tu + rw2.right.z * tv;
        rp.steer(dt, tgt, rw2.elevation + NEEDLE.alt, 0, NEEDLE.kt * KT, 15);
      } else rp.steer(dt, tgt, world.runway.elevation + NEEDLE.alt, 0, NEEDLE.kt * KT, HINT_CAP, { sgn: 1, ff: cmd * DEG, corr: 0 });
    } };
  };
  for (const [id, gm, need] of [['the-needle', NEEDLE.geom, 10], ['gauntlet', NEEDLE.gauntlet, 7]]) {
    const rows = []; let through = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const r = await simulate(id, { seed, makePilot: hintPilot(gm), track: 5 });
      // through: past the eye's plane without hitting the Needle or the Crescent on the way (the crash, if any, came later)
      const reached = r.track.some((p) => (p.u - gm.aim.u) * Math.cos(-15 * DEG) + (p.v - gm.aim.v) * Math.sin(-15 * DEG) > 20);
      const passed = reached && !(r.crashed && /Needle|Crescent/.test(r.reason) && r.t < 60);
      if (passed) through++;
      rows.push(`${seed}: ${passed ? (r.crashed ? 'through, then ' + r.reason : 'through, ' + r.points) : r.reason || 'never reached the eye'}`);
    }
    ok(through >= need, `${id}: flown the way the hint says, never past 35 degrees, through the eye on at least ${need} of 10 seeds (${through}: ${rows.join('; ')})`);
    console.log(`PASS ${id}: flown the way the hint says (35 degrees at most): through the eye on ${through} of 10 seeds (${rows.join('; ')})`);
  }
}

console.log(fails ? `\n${fails} of ${checks} city checks FAILED` : `\nall ${checks} city checks passed`);
process.exit(fails ? 1 : 0);
