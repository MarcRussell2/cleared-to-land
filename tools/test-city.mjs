// The city ladder's test suite (plain Node, no GPU; part of `npm test`): Metro City and the six missions of "The city"
// (src/missions/city.js), on the obstacle engine (src/world/obstacles.js) and RoutePilot (src/systems/routepilot.js).
// The drawing contract and the city's draw and triangle budget are in tools/test-obstacles.mjs (sections 4 and 10).
//
// What it covers, in order:
//   1. the mission data: ids and n (44-49), the group, fields, 2-3 sentence descriptions, three tips (with touch
//      words for any key they name), resolving with a seeded rng; Metro City registered;
//   2. Metro City on its own: the straight-in 3-degree glide path is at least 30 m clear of everything, all the way
//      from 9 km out (free flight, Autoland and the look and perf tools fly it), and its districts generate the same
//      city twice, on land, off the runway;
//   3. each mission's course: resolves the same way twice, the spawn is 40 m clear, every point inside every gate can
//      be flown wings level (the Needle's: see 4), the numbers the descriptions quote are true, the gates under the
//      skybridges and the bridge stop the fin's height under their undersides, Downtown has its second row;
//   4. the Needle: the gap (narrower than the 34.3 m span), the Condor's probe footprint banked 0-45 degrees (printed,
//      and the widths and fin height the texts quote), a perfect turn through it on the pilot's circle at 28, 30 and
//      35 degrees and on RoutePilot's at 40 clears it, wings level hits, and the window at 30 and 35;
//   5. flights with the real physics (tools/fly-mission.mjs simulate(), the code the page runs): every mission flown by
//      RoutePilot on ten seeds - no crash, every gate on at least nine, a median of at least 60 points - and a
//      deliberately wrong line into what the mission is about;
//   6. the autopilot switched off and on inside the Needle's turn, 300 m before the eye: it keeps the arc and gets
//      through;
//   7. the Needle flown by a pilot who does only what the HUD hint says, never past the Assist's 35 degrees.
import { installDomStub } from './dom-stub.mjs';
installDomStub();
const THREE = await import('three');
const { DEG, KT, makeRng } = await import('../src/config.js');
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
const glideCG = (u) => Math.max(0, (rw.aimDistance || 400) - u) * Math.tan(3 * DEG) + AIRCRAFT.condor.cgHeight;

// A stand-in aircraft for the field: pose (heading psi, bank phi: + right wing down), gear and flap state.
function fakeAc(id, x, y, z, psi = 0, phi = 0) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -psi, -phi, 'YXZ'));
  return { def: AIRCRAFT[id], pos: new THREE.Vector3(x, y, z), quat: q, ctl: { flap: 0.75, gear: 1 } };
}
// Swept 16 m through a point, heading psi, bank phi: what does the airframe hit?
function sweep(field, x, y, z, psi, phi = 0, id = 'condor') {
  const ac = fakeAc(id, x - Math.sin(psi) * 8, y, z + Math.cos(psi) * 8, psi, phi);
  field.reset(ac);
  ac.pos.set(x + Math.sin(psi) * 8, y, z - Math.cos(psi) * 8);
  return field.hit(ac);
}

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
  say('mission data: ids 44-49, fields, descriptions, tips, touch words; Metro City registered; the Gauntlet at night in a storm');
}

// ============================================================ 2. Metro City on its own
{
  const course = ObstacleField.plan(site, { id: 'free' });
  const again = ObstacleField.plan(site, { id: 'free' });
  ok(JSON.stringify(course.prims) === JSON.stringify(again.prims), 'Metro City builds the same city twice');
  const field = new ObstacleField(course);
  // the straight-in path (the Condor's CG on it), from 9 km out to the threshold, with a wing either side
  let worst = { d: Infinity };
  for (let u = -9000; u <= 0; u += 15) for (const v of [-18, 0, 18]) {
    const p = W(u, v, glideCG(u)); const r = field.clearance(p, 250);
    if (r.d < worst.d) worst = { d: r.d, u, v, name: r.prim && r.prim.name };
  }
  ok(worst.d > 30, `the straight-in glide path is at least 30 m clear of the city (closest ${worst.d.toFixed(1)} m, ${worst.name} at u ${worst.u})`);
  // generated buildings: on land, off the runway strip
  const water = terrain.waterLevel;
  // (the generated buildings: Container Island's warehouses stand on its quay, on purpose)
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
  // the landmarks' numbers the missions quote
  const deck = course.prims.find((p) => p.kind === 'bridge-deck');
  const under = deck.cy - deck.hy - rw.elevation;
  ok(Math.abs(under - 56) < 0.5, `the Harbor Bridge's deck: underside 56 m above the runway, 60 m over the water (${under.toFixed(1)})`);
  const hill = course.prims.find((p) => p.kind === 'landmark' && p.look === 'hill');
  const hillTop = hill.y1 - rw.elevation;
  ok(hillTop > 110 && hillTop < 150, `Checkerboard Hill stands ${hillTop.toFixed(0)} m above the runway`);
  const board = course.prims.find((p) => p.look === 'checker');
  // the board faces the south-east of a runway heading north: its broad face's normal (the box's Y) points +x, +z
  const nrm = board.Y[0] > 0 ? board.Y : board.Y.map((c) => -c);
  ok(nrm[0] > 0.4 && nrm[2] > 0.4, `the checkerboard faces the south-east, down the line of the turn (normal ${nrm.map((c) => c.toFixed(2)).join(', ')})`);
  const sq = board.hint && board.hint.squares;
  ok(sq && sq.every((n) => Number.isInteger(n)) && Math.abs(sq[0] * 10 - 2 * board.hz) < 0.01 && Math.abs(sq[1] * 10 - 2 * board.hx) < 0.01, `the board's hint names whole 10 m squares, [across, up] (${JSON.stringify(sq)} on ${(2 * board.hz).toFixed(0)} x ${(2 * board.hx).toFixed(0)} m)`);
}

// ============================================================ 3. the courses
const courseOf = (sc) => ObstacleField.plan(site, sc);
for (const sc of CITY_MISSIONS) {
  const course = courseOf(sc), again = courseOf(sc);
  ok(JSON.stringify(course.prims) === JSON.stringify(again.prims) && JSON.stringify(course.gates) === JSON.stringify(again.gates), `${sc.id}: the course resolves the same way twice`);
  const field = new ObstacleField(course);
  const rs = resolveScenario(sc, makeRng(307), { approach: 'short' });
  const sp = rs.spawn, spY = sp.alt != null ? Math.max(terrain.height(W(sp.u, sp.v).x, W(sp.u, sp.v).z), rw.elevation) + sp.alt : rw.elevation + glideCG(sp.u);
  const clr = field.clearance({ ...W(sp.u, sp.v), y: spY }, 3000);
  ok(clr.d > 40, `${sc.id}: the spawn is at least 40 m from any solid (${clr.d.toFixed(0)} m)`);
  let traps = 0, tried = 0;
  for (const g of course.gates) {
    if (g.bank) continue;   // the Needle's eye: section 4
    for (const fl of [-0.45, -0.2, 0, 0.2, 0.45]) for (const fu of [-0.45, -0.2, 0, 0.2, 0.45]) {
      tried++;
      const hit = sweep(field, g.x + g.r[0] * fl * g.w, g.y + fu * g.h, g.z + g.r[2] * fl * g.w, g.psi);
      if (hit) { traps++; if (traps < 4) console.log(`      ${sc.id}: ${g.name} at (${(fl * g.w).toFixed(1)}, ${(fu * g.h).toFixed(1)}) hits ${hit}`); }
    }
  }
  ok(traps === 0, `${sc.id}: every point inside every gate can be flown wings level (${traps} of ${tried} hit something)`);
  say(`${sc.id}: ${course.prims.length} solids, ${course.gates.length} gates (${course.gates.map((g) => g.name).join(', ')}), spawn ${clr.d.toFixed(0)} m clear; ${tried} points inside the gates flyable`);
}
{
  // Downtown: each skybridge stands across the glide path (straight in on it hits the first), and its underside is
  // where the description says
  const sc = byId('downtown'), course = courseOf(sc);
  const sbs = course.prims.filter((p) => p.kind === 'skybridge').sort((a, b) => b.cz - a.cz);
  ok(sbs.length === 2, 'Downtown: two skybridges');
  const u0 = sbs.map((p) => ({ u: -(p.cz - rw.z), under: p.cy - p.hy - rw.elevation, top: p.cy + p.hy - rw.elevation }));
  ok(Math.abs(u0[0].under - 100) < 0.5 && Math.abs(u0[1].under - 82) < 0.5, `Downtown: the skybridges' undersides 100 and 82 m up (${u0.map((s) => s.under.toFixed(0)).join(', ')})`);
  ok(u0.every((s) => glideCG(s.u) > s.under - 9 && glideCG(s.u) < s.top), `Downtown: both skybridges stand across the glide path (the path at ${u0.map((s) => glideCG(s.u).toFixed(0)).join(', ')} m)`);
  const avenue = course.prims.filter((p) => p.name === 'an office tower' && Math.abs(p.cx - rw.x) < 140 && -(p.cz - rw.z) < -600 && -(p.cz - rw.z) > -3600);
  const shorter = avenue.filter((p) => p.max[1] - rw.elevation < glideCG(-(p.cz - rw.z)) + 20);
  ok(avenue.length > 40 && shorter.length === 0, `Downtown: every tower on the avenue is taller than the glide path at its feet (${avenue.length} towers, ${shorter.length} not)`);
  const second = course.prims.filter((p) => p.hint && p.hint.cls === 'office' && p.hint.roof === 'flat' && Math.abs(p.cx - rw.x) > 150);
  ok(second.length > 60, `Downtown: the second row of offices behind the avenue's towers stands (${second.length} buildings; the mission's carve spares its own districts)`);
  say(`Downtown: skybridges ${u0.map((s) => `${Math.round(-s.u)} m out, underside ${s.under.toFixed(0)} m (the path ${glideCG(s.u).toFixed(0)})`).join('; ')}; ${avenue.length} towers along the avenue, all above the path; ${second.length} offices in the row behind`);
}
{
  // every gate under something (a skybridge, the bridge deck) tops out the fin's height and half a metre under it
  const fin = Math.max(...hullProbes(AIRCRAFT.condor).probes.map((p) => Math.max(p.y, p.y + (p.fy || 0)) + p.r));
  let n = 0;
  for (const sc of CITY_MISSIONS) {
    const course = courseOf(sc);
    for (const g of course.gates) {
      if (!/under/.test(g.name)) continue;
      // the structure over the gate: the lowest underside of a skybridge or deck within 60 m of it
      const over = course.prims.filter((p) => (p.kind === 'skybridge' || p.kind === 'bridge-deck') && Math.hypot(p.cx - g.x, p.cz - g.z) < Math.max(60, p.hx + 5) && p.cy - p.hy > g.y);
      const under = Math.min(...over.map((p) => p.cy - p.hy)), top = g.y + g.h / 2;
      n++;
      ok(over.length && top + fin <= under - 0.4 && top + fin >= under - 1, `${sc.id}: ${g.name} tops out ${(under - top).toFixed(2)} m under the underside (the fin needs ${fin.toFixed(2)}, and the rest is the half metre)`);
    }
  }
  say(`the ${n} gates under skybridges and the bridge stop half a metre plus the fin (${fin.toFixed(2)} m) under the structure`);
}

// ============================================================ 4. the Needle
{
  const sc = byId('the-needle'), course = courseOf(sc), field = new ObstacleField(course);
  const g = course.gates[0];
  const towers = course.prims.filter((p) => p.shape === 'cyl' && p.name === 'the Needle' && p.look === 'building');
  ok(towers.length === 2, 'the Needle: two round towers');
  const gap = Math.hypot(towers[0].x - towers[1].x, towers[0].z - towers[1].z) - towers[0].r0 - towers[1].r0;
  ok(Math.abs(gap - NEEDLE.gap) < 0.05 && gap < AIRCRAFT.condor.span, `the Needle: the gap is ${gap.toFixed(2)} m, narrower than the Condor's ${AIRCRAFT.condor.span} m span`);
  // the probe footprint banked (horizontal width across the flight path, flaps 30, gear down), and the fin's top
  const Hh = hullProbes(AIRCRAFT.condor), rows = [];
  for (const deg of [0, 15, 20, 25, 30, 35, 40, 45]) {
    const f = deg * DEG; let lo = Infinity, hi = -Infinity;
    for (const p of [...Hh.probes.map((q) => ({ x: q.x, y: q.y + 0.75 * (q.fy || 0), r: q.r })), ...Hh.gear]) {
      const lat = p.x * Math.cos(f) + p.y * Math.sin(f); lo = Math.min(lo, lat - p.r); hi = Math.max(hi, lat + p.r);
    }
    rows.push({ deg, w: hi - lo, mid: (hi + lo) / 2 });
  }
  const w = (d) => rows.find((r) => r.deg === d).w;
  ok(w(0) > gap && w(20) < gap && w(35) < gap - 3.5, `the Condor's footprint: ${rows.map((r) => `${r.deg} deg ${r.w.toFixed(1)} m`).join(', ')}: wider than the gap wings level, narrower banked 20 degrees or more`);
  ok([30, 35, 40, 45].every((d) => Math.abs(w(d) - NEEDLE.width[d]) < 0.6) && Math.abs(w(0) - 35) < 0.6, `the widths the texts quote (CONDOR_WIDTH ${JSON.stringify(NEEDLE.width)}, 35 wings level) match the hull`);
  const fin = Math.max(...Hh.probes.map((p) => Math.max(p.y, p.y + (p.fy || 0)) + p.r));
  ok(fin <= NEEDLE.fin && fin > NEEDLE.fin - 0.25, `the fin stands ${fin.toFixed(2)} m over the CG (FIN ${NEEDLE.fin} in city.js, the under-gates' allowance, at least that)`);
  // a perfect turn through the eye, on each line: the pilot's circle (radius NEEDLE.r) and RoutePilot's (NEEDLE.rAp),
  // both through the gate's middle (the aim point) at the gate's heading, flown at a steady bank; the same wings level
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
  ok(res.every((r) => !r.hit), `the Needle: the pilot's circle flown through the eye clears it at 28, 30 and 35 degrees of bank (${res.map((r) => `${r.b}: ${r.hit || r.clear.toFixed(2) + ' m'}`).join(', ')})`);
  const ap = turn(NEEDLE.rAp, NEEDLE.apBank);
  ok(!ap.hit && ap.clear > 2, `the Needle: RoutePilot's circle at ${NEEDLE.apBank} degrees clears it by ${ap.hit || ap.clear.toFixed(2) + ' m'}`);
  const level = turn(NEEDLE.r, 0);
  ok(!!level.hit, `the Needle: the same line wings level hits (${level.hit})`);
  // the window: how far off the line the turn can be flown and still clear, at 30 and 35 degrees
  const windowAt = (b) => { let lo = 0, hi = 0; for (let o = 0; o <= 4; o += 0.1) { if (turn(NEEDLE.r, b, o).hit) break; hi = o; } for (let o = 0; o <= 4; o += 0.1) { if (turn(NEEDLE.r, b, -o).hit) break; lo = o; } return { lo, hi }; };
  const w30 = windowAt(30), w35 = windowAt(35);
  ok(w30.lo + w30.hi >= 2 && w35.lo + w35.hi >= 3.5, `the Needle: the window is ${(w30.lo + w30.hi).toFixed(1)} m at 30 degrees, ${(w35.lo + w35.hi).toFixed(1)} m at 35 (${w35.lo.toFixed(1)} inside, ${w35.hi.toFixed(1)} outside the line)`);
  say(`the Needle: gap ${gap.toFixed(1)} m; the pilot's circle clears at 28/30/35 degrees by ${res.map((r) => r.clear.toFixed(2)).join('/')} m, RoutePilot's at ${NEEDLE.apBank} by ${ap.clear.toFixed(2)} m; window ${(w30.lo + w30.hi).toFixed(1)} m at 30, ${(w35.lo + w35.hi).toFixed(1)} m at 35; wings level: ${level.hit}; the fin ${fin.toFixed(2)} m over the CG`);
}

// ============================================================ 5. flights with the real physics
// RoutePilot on ten seeds each (the two named ones and 1-8): no crash, every gate on at least nine of the ten, a median
// of at least 60 points; then the same seed flying the same flight, and the wrong lines.
const SEEDS = [307, 4271, 1, 2, 3, 4, 5, 6, 7, 8];
const gatesOk = (r) => r.gates.length > 0 && r.gates.every((x) => /: passed$/.test(x));
{
  const results = {};
  for (const sc of CITY_MISSIONS) {
    const rs = [];
    for (const seed of SEEDS) {
      const r = await simulate(sc.id, { seed });
      results[sc.id + seed] = r; rs.push(r);
      if (seed === 307 || seed === 4271) ok(!r.crashed && r.touchdown && gatesOk(r) && r.points >= 40, `${sc.id} RoutePilot seed ${seed}: lands with every gate (${r.crashed ? r.reason : r.points + ' ' + r.grade}; ${r.gates.join(', ')})`);
    }
    const crashed = rs.filter((r) => r.crashed).length, allGates = rs.filter((r) => !r.crashed && r.touchdown && gatesOk(r)).length;
    const pts = rs.map((r) => (r.crashed ? 0 : r.points)).sort((a, b) => a - b), med = (pts[4] + pts[5]) / 2;
    const fpm = rs.filter((r) => r.touchdown).map((r) => r.touchdown.fpm).sort((a, b) => a - b);
    ok(crashed === 0 && allGates >= 9 && med >= 60, `${sc.id}: RoutePilot over ${SEEDS.length} seeds - no crash (${crashed}), every gate on at least 9 (${allGates}), median at least 60 (${med})`);
    const cl = rs.filter((r) => r.closest).map((r) => parseFloat(r.closest)).sort((a, b) => a - b);
    console.log(`PASS ${sc.id}: RoutePilot on ${SEEDS.length} seeds: ${allGates}/${SEEDS.length} with every gate, points ${pts[0]}-${pts[pts.length - 1]} (median ${med}), touchdown ${fpm[0]}-${fpm[fpm.length - 1]} fpm${cl.length ? `, closest ${cl[0].toFixed(1)}-${cl[cl.length - 1].toFixed(1)} m` : ''}; seed 307 ${results[sc.id + 307].points} ${results[sc.id + 307].grade}, 4271 ${results[sc.id + 4271].points} ${results[sc.id + 4271].grade}`);
  }
  // the same seed flies the same flight
  const again = await simulate('the-needle', { seed: 307 });
  ok(JSON.stringify(again) === JSON.stringify(results['the-needle307']), 'the same seed flies the same flight (the Needle)');
  // the wrong lines: the challenge is real
  const D = DEG, cb = { u: -1250 - 1200 * Math.sin(45 * D), v: 1200 * (1 - Math.cos(45 * D)) };
  const cbAt = (d) => ({ u: Math.round(cb.u + d * Math.cos(45 * D)), v: Math.round(cb.v - d * Math.sin(45 * D)) });
  const eye = (id) => {
    const g = byId(id).course.gates[0], dir = { u: Math.cos(-15 * D), v: Math.sin(-15 * D) };
    return {
      route: [{ u: g.u - 1500 * dir.u, v: g.v - 1500 * dir.v, alt: 72 }, { u: g.u + 600 * dir.u, v: g.v + 600 * dir.v, alt: 72, over: true }],
      set: { spawn: { u: Math.round(g.u - 3000 * dir.u), v: Math.round(g.v - 3000 * dir.v), hdg: -15, alt: 75, gamma: 0, flap: 0.75, speedKt: 150, fixed: true } },
    };
  };
  const wrong = [
    ['checkerboard', 'straight on at the board, no turn', { route: [{ ...cbAt(-1600), alt: 205 }, { ...cb, alt: 122 }, { ...cbAt(1900), alt: 60 }] }, /^Hit (Checkerboard Hill|the checkerboard)$/],
    ['downtown', 'straight in on the glideslope (Autoland)', { pilot: 'autoland' }, /^Hit the first skybridge$/],
    ['slalom', 'straight in on the glideslope (Autoland)', { pilot: 'autoland' }, /^Hit a skyscraper$/],
    ['under-bridge', 'level at the deck\'s height', { route: [{ u: -7000, v: 0, alt: 70 }, { u: -5000, v: 0, alt: 58 }] }, /^Hit the Harbor Bridge$/],
    ['the-needle', 'through the eye wings level', eye('the-needle'), /^Hit the Needle$/],
    ['gauntlet', 'through the eye wings level', eye('gauntlet'), /^Hit the Needle$/],
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
  const g = byId('the-needle').course.gates[0];
  const before = (dist) => (ac, t, mission) => {
    const eyeG = mission.gates[0];
    return eyeG.state === 'pending' && (eyeG.x - ac.pos.x) * eyeG.n[0] + (eyeG.z - ac.pos.z) * eyeG.n[2] < dist;
  };
  void g;
  for (const [id, seed] of [['the-needle', 307], ['the-needle', 4], ['the-needle', 5], ['gauntlet', 307]]) {
    const r = await simulate(id, { seed, resume: before(300) });
    ok(!!r.resumed && !r.crashed && r.touchdown && gatesOk(r), `${id} seed ${seed}: the autopilot switched off and on 300 m before the eye (at ${r.resumed ? r.resumed.t + ' s' : '-'}) still goes through and lands (${r.crashed ? r.reason : r.points + ' ' + r.grade}; ${r.gates.join(', ')})`);
    console.log(`PASS ${id} seed ${seed}: resumed at ${r.resumed && r.resumed.t} s, 300 m before the eye: ${r.crashed ? r.reason : r.points + ' ' + r.grade}, closest ${r.closest}`);
  }
}

// ============================================================ 7. the Needle flown the way the hint says
// A pilot who does what the HUD hint says and no more: holds the run-in line (steering for a point 600 m ahead on it,
// as a pilot lining up visually does) until "Roll right now", then the bank the hint shows, never past the Assist's
// 35 degrees, rounded to the degree it prints; 60 m past the eye the autopilot is switched on to take it home. It must go
// through the eye on every seed in The Needle's wind, and on at least 7 of 10 in the Gauntlet's 18-kt gusts (with
// the 35-degree limit the room there is a metre; RoutePilot, at 40 degrees, always gets through).
{
  const HINT_CAP = 35;
  const hintPilot = (ac, world, sc, mission) => {
    const rp = new RoutePilot(ac, world, sc), tgt = { x: 0, z: 0 }, ctx = { ac, ra: 0, d: 0, t: 0 };
    let cmd = 0, rolled = false, handed = null;
    return { update(dt) {
      if (handed) { handed.update(dt); return; }
      ctx.t += dt; ctx.ra = ac.radioAlt / 0.3048;
      const eyeG = mission.gates[0];
      if (eyeG.state !== 'pending' && (ac.pos.x - eyeG.x) * eyeG.n[0] + (ac.pos.z - eyeG.z) * eyeG.n[2] > 60) { handed = new RoutePilot(ac, world, sc); handed.update(dt); return; }
      const h = mission.hint(ctx) || '';
      let m;
      if ((m = /Roll right now: (\d+)/.exec(h))) { cmd = Math.min(HINT_CAP, +m[1]); rolled = true; } else if ((m = /^Bank (\d+) degrees/.exec(h))) { cmd = Math.min(HINT_CAP, +m[1]); rolled = true; }
      if (!rolled) {
        const rw2 = world.runway, P = NEEDLE.path, dx = ac.pos.x - rw2.threshold.x, dz = ac.pos.z - rw2.threshold.z;
        const u = dx * rw2.dir.x + dz * rw2.dir.z, v = dx * rw2.right.x + dz * rw2.right.z;
        const s = (u - P.S.u) * P.d0.u + (v - P.S.v) * P.d0.v + 600, tu = P.S.u + P.d0.u * s, tv = P.S.v + P.d0.v * s;
        tgt.x = rw2.threshold.x + rw2.dir.x * tu + rw2.right.x * tv; tgt.z = rw2.threshold.z + rw2.dir.z * tu + rw2.right.z * tv;
        rp.steer(dt, tgt, rw2.elevation + NEEDLE.alt, 0, NEEDLE.kt * KT, 15);
      } else rp.steer(dt, tgt, world.runway.elevation + NEEDLE.alt, 0, NEEDLE.kt * KT, HINT_CAP, { sgn: 1, ff: cmd * DEG, corr: 0 });
    } };
  };
  for (const [id, need] of [['the-needle', 10], ['gauntlet', 7]]) {
    const rows = []; let through = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const r = await simulate(id, { seed, makePilot: hintPilot });
      const passed = /: passed$/.test(r.gates[0]) && !(r.crashed && /Needle/.test(r.reason));
      if (passed) through++;
      rows.push(`${seed}: ${passed ? (r.crashed ? 'through, then ' + r.reason : 'through, ' + r.points) : r.reason || r.gates[0]}`);
    }
    ok(through >= need, `${id}: flown the way the hint says, never past 35 degrees, through the eye on at least ${need} of 10 seeds (${through}: ${rows.join('; ')})`);
    console.log(`PASS ${id}: flown the way the hint says (35 degrees at most): through the eye on ${through} of 10 seeds (${rows.join('; ')})`);
  }
}

console.log(fails ? `\n${fails} of ${checks} city checks FAILED` : `\nall ${checks} city checks passed`);
process.exit(fails ? 1 : 0);
