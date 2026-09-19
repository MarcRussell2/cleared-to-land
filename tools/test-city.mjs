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
//      be flown wings level (the Needle's: see 4), and the numbers the descriptions quote are true;
//   4. the Needle: the gap is 33 m (narrower than the 34.3 m span), the Condor's probe footprint banked 0-45 degrees
//      (printed), a perfect turn through it clears at 30, 35 and 40 degrees and wings level hits;
//   5. flights with the real physics (tools/fly-mission.mjs simulate(), the code the page runs): every mission landed
//      by RoutePilot on two seeds with every gate, and a deliberately wrong line into what the mission is about.
import { installDomStub } from './dom-stub.mjs';
installDomStub();
const THREE = await import('three');
const { DEG, makeRng } = await import('../src/config.js');
const { AIRCRAFT } = await import('../src/aircraft/defs.js');
const { hullProbes } = await import('../src/aircraft/hulls.js');
const { ObstacleField } = await import('../src/world/obstacles.js');
const { SITES, SCENARIOS, resolveScenario, siteFlats } = await import('../src/systems/scenarios.js');
const { MISSION_GROUPS } = await import('../src/missions/index.js');
const { CITY_MISSIONS, CITY_SITES } = await import('../src/missions/city.js');
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
  say(`Downtown: skybridges ${u0.map((s) => `${Math.round(-s.u)} m out, underside ${s.under.toFixed(0)} m (the path ${glideCG(s.u).toFixed(0)})`).join('; ')}; ${avenue.length} towers along the avenue, all above the path`);
}

// ============================================================ 4. the Needle
{
  const sc = byId('the-needle'), course = courseOf(sc), field = new ObstacleField(course);
  const g = course.gates[0];
  const towers = course.prims.filter((p) => p.shape === 'cyl' && p.name === 'the Needle' && p.look === 'building');
  ok(towers.length === 2, 'the Needle: two round towers');
  const gap = Math.hypot(towers[0].x - towers[1].x, towers[0].z - towers[1].z) - towers[0].r0 - towers[1].r0;
  ok(Math.abs(gap - 33) < 0.05 && gap < AIRCRAFT.condor.span, `the Needle: the gap is ${gap.toFixed(2)} m, narrower than the Condor's ${AIRCRAFT.condor.span} m span`);
  // the probe footprint banked (horizontal width across the flight path, flaps 30, gear down)
  const Hh = hullProbes(AIRCRAFT.condor), rows = [];
  for (const deg of [0, 25, 30, 35, 40, 45]) {
    const f = deg * DEG; let lo = Infinity, hi = -Infinity;
    for (const p of [...Hh.probes.map((q) => ({ x: q.x, y: q.y + 0.75 * (q.fy || 0), r: q.r })), ...Hh.gear]) {
      const lat = p.x * Math.cos(f) + p.y * Math.sin(f); lo = Math.min(lo, lat - p.r); hi = Math.max(hi, lat + p.r);
    }
    rows.push({ deg, w: hi - lo, mid: (hi + lo) / 2 });
  }
  const w = (d) => rows.find((r) => r.deg === d).w;
  ok(w(0) > gap && w(30) < gap && w(35) < gap - 2.5, `the Condor's footprint: ${rows.map((r) => `${r.deg} deg ${r.w.toFixed(1)} m`).join(', ')}: wider than the gap wings level, narrower banked 30 degrees or more`);
  // a perfect turn through the gap (the path the route and the gate are built on: through the gate's middle less the
  // 0.95 m lean, radius 836 m), flown at each bank, and the same line wings level
  const psi = g.psi, R = 836, nx = Math.cos(psi), nz = Math.sin(psi);
  const Gx = g.x - 0.95 * nx, Gz = g.z - 0.95 * nz, Cx = Gx + R * nx, Cz = Gz + R * nz;
  const turn = (bank, off = 0) => {
    const ac = fakeAc('condor', 0, g.y, 0), e = new THREE.Euler();
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
  const res = [30, 35, 40].map((b) => ({ b, ...turn(b) }));
  ok(res.every((r) => !r.hit), `the Needle: a perfect turn through the eye clears it at 30, 35 and 40 degrees of bank (${res.map((r) => `${r.b}: ${r.hit || r.clear.toFixed(2) + ' m'}`).join(', ')})`);
  const level = turn(0);
  ok(!!level.hit, `the Needle: the same line wings level hits (${level.hit})`);
  // the window at 35 degrees: how far off the line the turn can be flown and still clear
  let lo = 0, hi = 0;
  for (let o = 0; o <= 3; o += 0.1) { if (turn(35, o).hit) break; hi = o; }
  for (let o = 0; o <= 3; o += 0.1) { if (turn(35, -o).hit) break; lo = o; }
  ok(hi + lo >= 2.5, `the Needle: at 35 degrees the window is ${(hi + lo).toFixed(1)} m wide (${lo.toFixed(1)} m inside, ${hi.toFixed(1)} m outside the line)`);
  say(`the Needle: gap ${gap.toFixed(1)} m; clears at 30/35/40 degrees by ${res.map((r) => r.clear.toFixed(2)).join('/')} m; window at 35 degrees ${(hi + lo).toFixed(1)} m; wings level: ${level.hit}`);
}

// ============================================================ 5. flights with the real physics
{
  const results = {};
  for (const sc of CITY_MISSIONS) {
    for (const seed of [307, 4271]) {
      const r = await simulate(sc.id, { seed });
      results[sc.id + seed] = r;
      const all = r.gates.every((g) => /: passed$/.test(g));
      ok(!r.crashed && r.touchdown && all && r.points >= 40, `${sc.id} RoutePilot seed ${seed}: lands with every gate (${r.crashed ? r.reason : r.points + ' ' + r.grade}; ${r.gates.join(', ')})`);
      console.log(`PASS ${sc.id} seed ${seed}: ${r.points} ${r.grade}, touchdown ${r.touchdown ? `${r.touchdown.u} m in, ${r.touchdown.fpm} fpm, ${r.touchdown.kt} kt` : '-'}; gates ${r.gates.filter((g) => /passed$/.test(g)).length}/${r.gates.length}; closest ${r.closest}`);
    }
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

console.log(fails ? `\n${fails} of ${checks} city checks FAILED` : `\nall ${checks} city checks passed`);
process.exit(fails ? 1 : 0);
