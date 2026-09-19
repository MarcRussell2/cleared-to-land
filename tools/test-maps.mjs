// The new maps (the missions expansion, 2026-09-17/18): Kestrel Island, Paradise Bay Intl, Frostbite Lake and
// Red Mesa, their terrain styles ('island', 'arctic', 'desert'), the runway surfaces 'snow' and 'ice', and the
// five missions flown there (src/missions/maps.js). Plain Node, no GPU. What it checks:
//   - the six original sites' heights are exactly what they were before the new styles went in (a digest of
//     162 samples per site, taken from the pre-missions terrain.js), and their ground is still all grass;
//   - each new map has the feature its missions are about, where they expect it: Kestrel's saddle and the beach
//     past the far end, Paradise Bay's beach and sea just short of the threshold, Frostbite's lake of ice, Red
//     Mesa's cliff right before the threshold; and the runway flat is flat under every runway;
//   - the straight glidepath each mission is flown on (the runway's PAPI angle, or the aircraft's glideslope)
//     clears the ground and every solid prop from the longest spawn to the threshold, and clears the saddle and
//     the rim by only a few metres (the challenge is real, and fair: Autoland lands every one of them);
//   - friction: packed snow and lake ice brake at about a third and an eighth of dry asphalt;
//   - the missions' data: ids, n, group, fields, tips that name keys have a touch wording; the visibility each
//     briefing names is the kneeboard's `vis` and what the pilot sees through the weather (src/missions/README.md
//     "Visibility"); Hill
//     Hop's push-over hint comes only once the col is behind, where taking it at its word still clears the ridge;
//   - the look builds in Node: the biome forests, boulders and site props, with named materials and budgets.
import { installDomStub } from './dom-stub.mjs';
installDomStub();
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

const { Terrain } = await import('../src/world/terrain.js');
const { SITES, SCENARIOS, siteFlats, resolveScenario } = await import('../src/systems/scenarios.js');
const { AIRCRAFT } = await import('../src/aircraft/defs.js');
const { MAPS_MISSIONS } = await import('../src/missions/maps.js');
const { NEW_SITES } = await import('../src/missions/sites.js');
const { touchify } = await import('../src/touch.js');
const { makeRng, DEG, headingToVec } = await import('../src/config.js');
const biomes = await import('../src/art/world-biomes.js');
const { clearExtinction, VISIBILITY_EXTINCTION } = await import('../src/art/world-atmosphere.js');
const { WORLD_QUALITY } = await import('../src/art/quality.js');

let failures = 0, passes = 0;
const VERBOSE = !!process.env.VERBOSE;
const ok = (cond, msg) => { if (cond) { passes++; if (VERBOSE) console.log("  ok   " + msg); } else { failures++; console.log("  FAIL " + msg); } };
const section = (s) => console.log('\n== ' + s + ' ==');
const terrainOf = (site) => new Terrain({ ...site.terrain, flats: siteFlats(site) });
const groundOut = () => ({ y: 0, n: new THREE.Vector3(), mu: 0, kind: '', vel: new THREE.Vector3(), rough: 0, name: '' });

// ------------------------------------------------------------------ 1. the original six are untouched
section('the original sites');
{
  // The sample points and the digests were taken from the pre-missions terrain.js (main f51b33c).
  const pts = [];
  for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) pts.push([i * 1500 + 37, j * 1500 - 11]);
  for (const u of [-1200, -600, -300, -120, -40, 0, 300, 900, 2000]) for (const v of [-900, -450, -140, -60, 0, 60, 140, 450, 900]) pts.push([v + 0.5, -u + 0.25]);
  const REF = {
    bayfield: ['80a9e864', 217.911], harbor: ['ce7c5905', 1184.965], ridgefield: ['bc063b93', 19515.525],
    carrier: ['6dacaac5', -4050.0], gravelbar: ['e3625f93', 158834.653], oneway: ['71056238', 218238.806],
  };
  const fnv = (arr) => {
    let h = 0x811c9dc5;
    for (const v of arr) {
      const s = String(Math.round(v * 1000));
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
      h ^= 44; h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };
  const g = groundOut();
  for (const [id, [digest, sum]] of Object.entries(REF)) {
    const T = terrainOf(SITES[id]);
    const hs = pts.map(([x, z]) => +T.height(x, z).toFixed(5));
    const got = fnv(hs), s = hs.reduce((a, b) => a + b, 0);
    ok(got === digest, `${id}: heights unchanged (digest ${got}, want ${digest}; sum ${s.toFixed(3)}, want ${sum})`);
    let grass = 0, dry = 0;
    for (const [x, z] of pts) { T.ground(x, z, g); if (g.kind === 'water') continue; dry++; if (g.kind === 'grass' && g.mu === 0.55 && g.rough === 0.8) grass++; }
    ok(grass === dry, `${id}: every dry sample is still grass, mu 0.55 (${grass}/${dry})`);
    ok(!T.island && !T.arctic && !T.desert, `${id}: no new-style parameters on an original style`);
  }
  console.log('  six original sites: heights and ground as before');
}

// ------------------------------------------------------------------ 2. the new maps' features
section('the new maps');
const NEW = ['kestrel', 'paradise', 'frostbite', 'redmesa'];
const T = {};
for (const id of NEW) {
  const site = SITES[id];
  ok(!!site && NEW_SITES[id] === site, `${id} is registered in SITES`);
  T[id] = terrainOf(site);
}
// runway frame -> world (every new runway sits at the origin heading north, like the originals)
const at = (id, u, v) => { const rw = SITES[id].runways[0], d = headingToVec(rw.heading * DEG, new THREE.Vector3()); return { x: rw.x + d.x * u - d.z * v, z: rw.z + d.z * u + d.x * v }; };
const H = (id, u, v = 0) => { const p = at(id, u, v); return T[id].height(p.x, p.z); };
const G = (id, u, v = 0) => { const p = at(id, u, v), g = groundOut(); T[id].ground(p.x, p.z, g); return g; };
for (const id of NEW) {
  const rw = SITES[id].runways[0];
  ok(rw.x === 0 && rw.z === 0 && rw.heading === 0, `${id}: runway 0 at the origin heading north (the far ring and the 20 m ground grid are origin-centred)`);
  let worst = 0;
  for (let u = -2; u <= rw.length + 2; u += 7) for (const v of [-rw.width / 2 - 1, 0, rw.width / 2 + 1]) worst = Math.max(worst, Math.abs(H(id, u, v) - rw.elevation));
  ok(worst < 0.05, `${id}: the ground under the runway is flat at ${rw.elevation} m (worst ${worst.toFixed(3)} m)`);
  // same site, same terrain, every time
  const T2 = terrainOf(SITES[id]);
  let same = true;
  for (let i = 0; i < 40; i++) { const x = (i * 977) % 9000 - 4500, z = (i * 613) % 9000 - 4500; if (T2.height(x, z) !== T[id].height(x, z)) same = false; }
  ok(same, `${id}: deterministic`);
}
{
  // Kestrel Island: the saddle 240 m short of the threshold, the hills either side, the beach past the far end
  const crest = H('kestrel', -240), side = Math.min(H('kestrel', -240, -260), H('kestrel', -240, 260));
  ok(crest > 26 && crest < 40, `kestrel: the saddle's crest is ${crest.toFixed(1)} m (26..40)`);
  ok(side > 80, `kestrel: the hills either side of the saddle stand ${side.toFixed(0)} m (> 80)`);
  ok(H('kestrel', -120) < 12 && H('kestrel', -40) < 7, `kestrel: the ground falls to the threshold (${H('kestrel', -120).toFixed(1)} m at 120 m out, ${H('kestrel', -40).toFixed(1)} m at 40 m)`);
  // the PAPI (25 to 52 m left, 80 m in) and the apron, terminal and hangar (right) stand on level ground
  let shelf = 0;
  for (const [u, v] of [[80, -25], [80, -34], [80, -43], [80, -52], [350, 12], [350, 50], [530, 12], [530, 50], [390, 64], [530, 58]]) shelf = Math.max(shelf, Math.abs(H('kestrel', u, v) - 5));
  ok(shelf < 0.05, `kestrel: the PAPI and the apron stand on level ground (worst ${shelf.toFixed(2)} m off)`);
  const beach = G('kestrel', 700), sea = G('kestrel', 780);
  ok(beach.kind === 'sand', `kestrel: sand 50 m past the far end (${beach.kind}, ${beach.y.toFixed(1)} m)`);
  ok(sea.kind === 'water', `kestrel: the sea 130 m past the far end (${sea.kind})`);
  ok(G('kestrel', -2600).kind === 'water', 'kestrel: the approach starts over the sea');
  // Paradise Bay: sea, beach, road, fence, threshold
  ok(G('paradise', -160).kind === 'water', `paradise: the sea 160 m short of the threshold (${G('paradise', -160).kind})`);
  const pb = G('paradise', -90);
  ok(pb.kind === 'sand', `paradise: the public beach 90 m short (${pb.kind}, ${pb.y.toFixed(1)} m)`);
  ok(Math.abs(H('paradise', -34) - 4) < 1.2, `paradise: the coast road 34 m short is at the field's level (${H('paradise', -34).toFixed(2)} m)`);
  ok(H('paradise', -1000) < -8, `paradise: open sea on the approach (${H('paradise', -1000).toFixed(1)} m at 1 km)`);
  // Frostbite Lake: ice all round the runway and down the approach, snowy hills beyond
  for (const [u, v] of [[-1500, 0], [-400, 0], [600, 300], [1500, -400]]) { const g = G('frostbite', u, v); ok(g.kind === 'ice' && g.mu < 0.15, `frostbite: lake ice at (${u}, ${v}) (${g.kind}, mu ${g.mu})`); }
  let hill = 0;
  for (let v = -3500; v <= 3500; v += 250) hill = Math.max(hill, H('frostbite', 0, v) - 180);
  ok(hill > 200, `frostbite: hills rise ${hill.toFixed(0)} m above the lake within 3.5 km`);
  ok(G('frostbite', 0, 2500).kind === 'snow', 'frostbite: snow on the land');
  // Red Mesa: a 150 m cliff right before the threshold, the strip on top
  const rim = H('redmesa', -25), below = H('redmesa', -60), floor = H('redmesa', -200);
  ok(Math.abs(rim - 1480) < 0.5, `redmesa: the mesa top reaches ${-25} m (${rim.toFixed(1)} m)`);
  ok(1480 - below > 80, `redmesa: 35 m past the rim the ground is ${(1480 - below).toFixed(0)} m down (a cliff, not a slope)`);
  ok(1480 - floor > 135 && 1480 - floor < 170, `redmesa: the canyon floor is ${(1480 - floor).toFixed(0)} m below the strip (about 150)`);
  ok(H('redmesa', 700, 0) > 1478, 'redmesa: the mesa runs on past the far end');
  ok(SITES.redmesa.terrain.trees === 0, 'redmesa: no trees');
}

// ------------------------------------------------------------------ 3. surfaces
section('snow and ice');
{
  const src = readFileSync(new URL('../src/world/airport.js', import.meta.url), 'utf8');
  const mu = (s) => { const m = new RegExp(`s === '${s}'\\) \\{ out\\.mu = ([0-9.]+); out\\.kind = '${s}'`).exec(src); return m ? +m[1] : null; };
  ok(mu('snow') >= 0.25 && mu('snow') <= 0.35, `airport.js: a packed-snow runway brakes at mu ${mu('snow')} (0.25..0.35)`);
  ok(mu('ice') >= 0.1 && mu('ice') <= 0.15, `airport.js: an ice runway brakes at mu ${mu('ice')} (0.10..0.15)`);
  ok(/out\.mu = rw\.wet \? 0\.5 : 0\.85; out\.kind = 'runway'/.test(src) && /s === 'gravel'\) \{ out\.mu = 0\.62/.test(src) && /s === 'sand'\) \{ out\.mu = 0\.5;/.test(src) && /else \{ out\.mu = 0\.55; out\.kind = 'dirt'/.test(src), 'airport.js: the four original surfaces keep their friction');
  for (const f of ['../src/camera.js', '../src/art/effects.js']) ok(/'snow'/.test(readFileSync(new URL(f, import.meta.url), 'utf8')), `${f.slice(7)} knows packed snow is rough ground`);
  ok(/if \(night && rw\.surface === 'asphalt' && rw\.taxiway !== false\)/.test(src), 'airport.js: a runway with taxiway: false (Kestrel) has no taxiway lights either');
}

// ------------------------------------------------------------------ 4. the missions
section('the missions');
const ID = /^[a-z0-9][a-z0-9-]{0,23}$/;
const WANT = { 'hill-hop': 39, 'beach-buzz': 40, 'mesa-top': 41, whiteout: 42, 'dust-wall': 43 };
ok(MAPS_MISSIONS.length === 5, `five map missions (${MAPS_MISSIONS.length})`);
for (const sc of MAPS_MISSIONS) {
  const tag = sc.id;
  ok(ID.test(sc.id), `${tag}: id is a valid, permanent board id`);
  ok(WANT[sc.id] === sc.n, `${tag}: n ${sc.n} (want ${WANT[sc.id]})`);
  ok(SCENARIOS.filter((s) => s.id === sc.id).length === 1 && SCENARIOS.includes(sc), `${tag}: in SCENARIOS exactly once`);
  ok(sc.group === 'maps', `${tag}: group 'maps'`);
  ok(Number.isInteger(sc.difficulty) && sc.difficulty >= 1 && sc.difficulty <= 5, `${tag}: difficulty 1..5`);
  ok(Array.isArray(sc.tags) && sc.tags.length > 0, `${tag}: tags`);
  ok(!!AIRCRAFT[sc.aircraft], `${tag}: aircraft ${sc.aircraft} exists`);
  ok(NEW.includes(sc.site), `${tag}: flown at a new map (${sc.site})`);
  for (const k of ['title', 'desc', 'time', 'vis', 'wind', 'weight', 'spawn', 'failures', 'scoring']) ok(sc[k] != null, `${tag}: has ${k}`);
  const sentences = sc.desc.split(/(?<=[.!?])\s+/).filter(Boolean).length;
  ok(sentences >= 2 && sentences <= 3, `${tag}: the description is 2-3 sentences (${sentences})`);
  ok(Array.isArray(sc.tips) && sc.tips.length === 3, `${tag}: three tips`);
  // a tip that names a key must read differently on a phone (src/touch.js TOUCH_WORDS)
  for (const tip of sc.tips) {
    const namesKey = /\((?:[A-Z]|[A-Z]\/[A-Z]|hold [A-Z]|[A-Z] twice)\)|\bSpace\b|\bpress [A-Z]\b/.test(tip);
    if (namesKey) ok(touchify(tip) !== tip && !/\((?:[A-Z]|[A-Z]\/[A-Z])\)|\bSpace\b/.test(touchify(tip)), `${tag}: the tip "${tip.slice(0, 40)}..." has a touch wording`);
  }
  const type = SITES[sc.site].kind === 'bush' ? 'bush' : 'runway';
  ok(sc.scoring.type === type, `${tag}: scoring '${sc.scoring.type}' suits a ${SITES[sc.site].kind} site`);
  const r = resolveScenario(sc, makeRng(307), { approach: 'long' });
  ok(r.aircraft === sc.aircraft && r.site === sc.site && r.wind !== sc.wind && typeof r.wind.gust === 'number', `${tag}: resolves (and leaves the base scenario alone)`);
  if (sc.weather) {
    ok(['snow', 'dust'].includes(sc.weather.preset), `${tag}: weather preset ${sc.weather.preset}`);
    for (const e of sc.weather.events || []) ok(['visDrop', 'turbBurst', 'gustFront', 'windShift'].includes(e.type) && e.at && e.at.type, `${tag}: weather event ${e.type} with a trigger`);
  }
}
// What the pilot sees (README "Visibility"): the sky's air for `vis` (clearExtinction: exact at 900 m and below,
// clearer above). The snow and dust a mission asks for are already in its `vis`: the weather look thickens the air
// only for precipitation above the spec's own (src/art/weather-look.js; change both together).
const seenVis = (vis) => VISIBILITY_EXTINCTION / clearExtinction(vis);
// the kneeboard's wording of a visibility (src/ui/menus.js visText)
const card = (v) => (v >= 9500 ? `${Math.round(v / 1000)} km` : v >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, '')} km` : `${Math.round(v / 50) * 50} m`);
{
  const wo = MAPS_MISSIONS.find((s) => s.id === 'whiteout'), dw = MAPS_MISSIONS.find((s) => s.id === 'dust-wall');
  const a = seenVis(wo.vis);
  ok(wo.weather.snow >= 0.8 && Math.abs(a - 900) < 1 && card(wo.vis) === '900 m' && /900 metres of visibility/.test(wo.desc), `whiteout: heavy snow; the briefing's 900 metres, the kneeboard's ${card(wo.vis)} and the ${a.toFixed(0)} m the pilot sees agree`);
  const drop = dw.weather.events.find((e) => e.type === 'visDrop');
  const b0 = seenVis(dw.vis), b1 = seenVis(drop.vis);
  ok(card(dw.vis) === '7 km' && b0 >= 7000 && b1 > 950 && b1 < 1200 && /from seven kilometres to one/.test(dw.desc), `dust-wall: the kneeboard's ${card(dw.vis)} and "from seven kilometres to one" (the pilot sees at least ${(b0 / 1000).toFixed(0)} km before the wall, ${(b1 / 1000).toFixed(2)} km after the drop)`);
  // every other map mission is in clear air: its vis is what the sky draws, and the text names no visibility
  for (const sc of MAPS_MISSIONS) if (!sc.weather) ok(sc.vis >= 30000 && !/visibility/.test(sc.desc), `${sc.id}: clear air (vis ${sc.vis})`);
}
ok(SITES.frostbite.runways[0].surface === 'ice', 'whiteout: the runway is ice');
ok(MAPS_MISSIONS.find((s) => s.id === 'dust-wall').weather.events.some((e) => e.type === 'visDrop' && e.at.type === 'dist'), 'dust-wall: the visibility drops on final');

// ------------------------------------------------------------------ 5. the glidepath is clear, and only just
section('the glidepath');
// Solid props (the cars on the roads, the terminal, the shacks) come from the look's builder, as in the game.
function resolvedRunway(site) {
  const d = site.runways[0], heading = d.heading * DEG, dir = headingToVec(heading, new THREE.Vector3());
  const right = new THREE.Vector3(-dir.z, 0, dir.x), threshold = new THREE.Vector3(d.x, d.elevation, d.z);
  return { ...d, heading, dir, right, threshold, slope: d.slope || 0, aimDistance: d.aimDistance || Math.min(400, d.length * 0.15) };
}
for (const sc of MAPS_MISSIONS) {
  const site = SITES[sc.site], rw = resolvedRunway(site), def = AIRCRAFT[sc.aircraft], id = sc.site;
  const place = (u, v, out) => out.copy(rw.threshold).addScaledVector(rw.dir, u).addScaledVector(rw.right, v).setY(rw.elevation + rw.slope * u);
  const props = rw.props ? biomes.buildSiteProps(rw, place, rw.props, (x, z) => T[id].height(x, z)).obstacles : [];
  const gs = rw.gsAngle ? rw.gsAngle * DEG : def.approach.glideslope;
  const far = sc.spawn.dist * (sc.spawn.fixed ? 1 : 3);   // the longest approach setting
  let worst = { c: 1e9, u: 0 }, nearWorst = 1e9;
  for (let u = -far; u <= -40; u += 5) {
    const wheels = rw.elevation + (rw.aimDistance - u) * Math.tan(gs);   // the wheels ride the path; the CG is above it
    for (const v of [-12, 0, 12]) {
      const p = at(id, u, v);
      let top = Math.max(T[id].height(p.x, p.z), T[id].waterLevel ?? -1e9);
      for (const o of props) if ((p.x - o.x) ** 2 + (p.z - o.z) ** 2 < (o.r + 6) ** 2) top = Math.max(top, o.y);
      const c = wheels - top;
      if (c < worst.c) worst = { c, u, v };
      if (u > -400 && c < nearWorst) nearWorst = c;
    }
  }
  ok(worst.c > 3, `${sc.id}: the ${(gs / DEG).toFixed(1)}-degree path clears everything from ${far} m out by ${worst.c.toFixed(1)} m (tightest at u ${worst.u})`);
  if (sc.id === 'hill-hop') {
    ok(nearWorst < 15, `hill-hop: ...and crosses the saddle and its road only ${nearWorst.toFixed(1)} m up (the challenge)`);
    // The hint says "idle, and push over": never before the col (240 m out), and wherever it shows, a pilot who
    // pushes into a 12-degree dive from the path and holds it for 100 m (or down to 100 m out, where the next hint
    // says to flare) still clears the ground and the cars by 3 m.
    const crest = -site.terrain.island.ridges[0].u, flying = { onGround: false, crashed: false };
    const push = (d) => /push over/.test(sc.hint({ ac: flying, d, ra: 50, t: 0 }) || '');
    let early = 0, shown = 0, dive = { c: 1e9, d: 0 };
    for (let d = 1600; d >= 0; d -= 5) {
      if (!push(d)) continue;
      shown++; if (d > crest) early++;
      const h0 = rw.elevation + (rw.aimDistance + d) * Math.tan(gs);
      for (let d1 = d; d1 >= Math.max(d - 100, 100); d1 -= 5) {
        let top = -1e9;
        for (const v of [-12, 0, 12]) {
          const p = at(id, -d1, v);
          top = Math.max(top, T[id].height(p.x, p.z));
          for (const o of props) if ((p.x - o.x) ** 2 + (p.z - o.z) ** 2 < (o.r + 6) ** 2) top = Math.max(top, o.y);
        }
        const c = h0 - (d - d1) * Math.tan(12 * DEG) - top;
        if (c < dive.c) dive = { c, d };
      }
    }
    ok(shown > 0 && early === 0, `hill-hop: the push-over hint shows only once the col (${crest} m out) is behind (${early} of ${shown} samples early)`);
    ok(dive.c > 3, `hill-hop: pushing into a 12-degree dive where the hint says so clears everything by ${dive.c.toFixed(1)} m (tightest from ${dive.d} m out)`);
  }
  if (sc.id === 'mesa-top' || sc.id === 'dust-wall') {
    const rim = rw.elevation + (rw.aimDistance + 30) * Math.tan(gs) - H('redmesa', -30);
    ok(rim > 3 && rim < 12, `${sc.id}: the wheels cross the rim ${rim.toFixed(1)} m up`);
  }
}

// ------------------------------------------------------------------ 6. the look builds
section('the look');
{
  // The woods: Kestrel's dry forest grows in stands with a narrow edge (a wood, or open scrub, rarely in between),
  // and both shores of Frostbite's lake carry a band of spruce whatever the woodland noise says.
  let land = 0, full = 0, part = 0;
  const I = T.kestrel.island;
  for (let x = I.x - I.rx; x < I.x + I.rx; x += 40) for (let z = I.z - I.rz; z < I.z + I.rz; z += 40) {
    if (T.kestrel.height(x, z) < 5) continue;
    land++; const s = biomes.islandStand(T.kestrel, x, z); if (s > 0.99) full++; else if (s > 0.01) part++;
  }
  ok(full / land > 0.18 && full / land < 0.4 && part / land < 0.15, `kestrel: woods on ${(100 * full / land).toFixed(0)}% of the land, the edge of a stand on ${(100 * part / land).toFixed(0)}%`);
  let band = 1;
  for (let i = 0; i < 400; i++) {
    const x = (i * 977) % 12000 - 6000, z = (i * 613) % 12000 - 6000, s = T.frostbite.lakeShore(x, z);
    if (s > 16 && s < 60) band = Math.min(band, biomes.arcticWood(T.frostbite, x, z, s));
  }
  ok(band > 0.99, `frostbite: the spruce is at full density within 60 m of every shore (lowest ${band.toFixed(2)})`);

  const named = (objs) => { let n = 0, bad = 0; for (const o of objs) o.traverse((m) => { if (m.material) { n++; if (!m.material.name) bad++; } }); return { n, bad }; };
  for (const detail of ['high', 'low']) {
    WORLD_QUALITY.detail = detail;
    for (const id of ['kestrel', 'paradise', 'frostbite']) {
      const f = biomes.biomeForest(T[id], { treeScale: detail === 'low' ? 0.35 : 1, detail });
      const m = named(f.objects);
      ok(f.count > 1000, `${id} (${detail}): a forest of ${f.count} trees`);
      ok(m.n > 0 && m.bad === 0, `${id} (${detail}): every forest material is named`);
      let frust = 0; for (const o of f.objects) o.traverse((x) => { if (x.frustumCulled === false) frust++; });
      ok(frust === 0, `${id} (${detail}): nothing in the forest is drawn without culling`);
      // docs/PERF.md: a tree is at most 110 triangles
      let fat = 0; for (const o of f.objects) o.traverse((x) => { if (x.isInstancedMesh) { const g = x.geometry, t = (g.index ? g.index.count : g.attributes.position.count) / 3; if (t > 110) fat = Math.max(fat, t); } });
      ok(fat === 0, `${id} (${detail}): every tree is 110 triangles or fewer${fat ? ' (one is ' + fat + ')' : ''}`);
      ok(f.count <= 24000, `${id} (${detail}): the forest is capped (${f.count} <= 24000)`);
    }
    ok(biomes.biomeForest(T.redmesa, { treeScale: 1, detail }).count === 0, `redmesa (${detail}): no trees in the desert`);
    for (const id of ['redmesa', 'frostbite']) {
      const r = biomes.biomeRocks(T[id]);
      ok(r.isInstancedMesh && r.count > 100 && r.material.name.startsWith('biome/'), `${id} (${detail}): ${r.count} boulders, one instanced draw`);
    }
  }
  WORLD_QUALITY.detail = 'high';
  for (const id of ['kestrel', 'paradise', 'frostbite']) {
    const rw = resolvedRunway(SITES[id]);
    const place = (u, v, out) => out.copy(rw.threshold).addScaledVector(rw.dir, u).addScaledVector(rw.right, v).setY(rw.elevation);
    const p = biomes.buildSiteProps(rw, place, rw.props, (x, z) => T[id].height(x, z));
    const m = named(p.objects), mats = new Set();
    const props = p.objects.filter((o) => o.name !== 'biome/roads'), road = p.objects.find((o) => o.name === 'biome/roads');
    for (const o of props) o.traverse((x) => { if (x.material) mats.add(x.material); });
    ok(m.bad === 0 && p.objects.length <= 7, `${id}: site props are ${p.objects.length} draws, every material named`);
    ok(mats.size === 1, `${id}: site props share one material, the roads another (${mats.size} + ${road ? 1 : 0}; the aerodrome's budget is 20)`);
    let noColour = 0; for (const o of props) if (!o.geometry.attributes.color) noColour++;
    ok(noColour === 0, `${id}: every prop geometry carries the vertex colours its material reads`);
    ok(p.obstacles.every((o) => o.kind === 'structure' && o.r > 0 && o.y > rw.elevation - 5 && o.name), `${id}: ${p.obstacles.length} solid props, each a named structure`);
    if (id === 'paradise') { const um = p.objects.find((o) => o.name === 'biome/umbrellas'); ok(um && um.count >= 6 && um.count <= 12, `paradise: a few umbrellas on the public beach (${um ? um.count : 0}; the brief: a few at most)`); }
    // the site's own roads: drawn at all, facing up (the terrain-look ribbon faces down and is culled from above),
    // on the ground and not under it (the analytic height or the 20 m ground mesh, whichever is higher), not in the sea
    const want = ((rw.surroundings && rw.surroundings.roads) || []).filter((r) => r.pts).length;
    ok(!want || !!road, `${id}: its ${want} road(s) are drawn`);
    if (road) {
      const P = road.geometry.attributes.position, I = road.geometry.index;
      let down = 0, sunk = 0, wet = 0, far = 0;
      const mesh20 = (x, z) => { const i = Math.floor(x / 20), j = Math.floor(z / 20), fx = x / 20 - i, fz = z / 20 - j, h = (a, b) => T[id].height(a * 20, b * 20);
        return fx + fz <= 1 ? h(i, j) + (h(i + 1, j) - h(i, j)) * fx + (h(i, j + 1) - h(i, j)) * fz : h(i + 1, j + 1) + (h(i, j + 1) - h(i + 1, j + 1)) * (1 - fx) + (h(i + 1, j) - h(i + 1, j + 1)) * (1 - fz); };
      for (let t = 0; t < I.count; t += 3) {
        const a = I.getX(t), b = I.getX(t + 1), c = I.getX(t + 2);
        const ax = P.getX(b) - P.getX(a), az = P.getZ(b) - P.getZ(a), bx = P.getX(c) - P.getX(a), bz = P.getZ(c) - P.getZ(a);
        if (az * bx - ax * bz <= 0) down++;
        // the middle of each triangle, where the ground mesh is least likely to agree with its corners
        const x = (P.getX(a) + P.getX(b) + P.getX(c)) / 3, z = (P.getZ(a) + P.getZ(b) + P.getZ(c)) / 3, y = (P.getY(a) + P.getY(b) + P.getY(c)) / 3;
        if (y < Math.max(T[id].height(x, z), mesh20(x, z)) - 0.05) sunk++;
        if (y < (T[id].waterLevel ?? -1e9) + 0.5) wet++;
      }
      for (let i = 0; i < P.count; i++) if (Math.abs(P.getY(i) - T[id].height(P.getX(i), P.getZ(i))) > 1.5) far++;
      ok(down === 0, `${id}: every road triangle faces up (${down} of ${I.count / 3} face down)`);
      ok(sunk === 0 && far === 0, `${id}: the roads lie on the ground (${sunk} triangles sunk under it, ${far} vertices over 1.5 m off it)`);
      ok(wet === 0, `${id}: no road runs into the sea (${wet} triangles at the waterline)`);
    }
  }
}

console.log(`\n${failures ? 'FAILED: ' + failures + ' map check(s)' : 'all ' + passes + ' map checks passed'}`);
if (failures) process.exit(1);
