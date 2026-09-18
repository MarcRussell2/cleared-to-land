// The art bench contract.
//
// src/art/ is worked on independently of the rest of the game (see src/art/AGENTS.md).
// The engine calls these modules by name: a renamed export, a dropped palette entry
// or a changed return shape is a black screen or a crash on load, and neither shows
// up in the physics tests. This checks the shape of the contract, not the look.
//
// It runs in plain Node, so it can only import the modules and inspect them — no
// canvas, no WebGL. Anything that needs a real frame is checked by the look sheet
// in the website repo (tools/ctl-shots/looksheet.mjs).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(join(ROOT, 'src', p), 'utf8');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log(`FAIL ${msg}`); } };
const isFn = (m, name, where) => ok(typeof m[name] === 'function', `${where} must export a function ${name}()`);

// --- palette.js: every name the world reads ------------------------------------
const palette = await import('../src/art/palette.js');
const { PALETTE, FINISH } = palette;
ok(PALETTE && typeof PALETTE === 'object', 'palette.js must export PALETTE');
ok(FINISH && typeof FINISH === 'object', 'palette.js must export FINISH');

const REQUIRED_COLOURS = [
  'ground.sand', 'ground.snow', 'ground.alpineLow', 'ground.alpineHigh', 'ground.rock',
  'ground.grass', 'ground.grassNoise', 'ground.pasture', 'ground.ploughed',
  'ground.forestFloor', 'ground.mountainTint', 'ground.detailCompensation',
  'groundDetail.base', 'groundDetail.tint', 'groundDetail.blades', 'groundDetail.highlights',
  'trees.conifer', 'trees.broadleaf', 'trees.obstacle', 'rocks', 'road',
  'village.wall', 'village.roof',
  'runway.asphalt', 'runway.gravel', 'runway.sand', 'runway.dirt', 'runway.markings',
  'runway.bushEdge', 'runway.rubber', 'runway.joints', 'runway.ruts',
  'shoulder', 'taxiLine',
  'buildings.hangar', 'buildings.tHangar', 'buildings.roof', 'buildings.glass', 'buildings.fuelTank',
  'bushCamp.cabin', 'bushCamp.roof', 'bushCamp.drum',
  'windsock.pole', 'windsock.sock', 'windsock.band', 'marker', 'papiBox',
  'lights.edge', 'lights.edgeCaution', 'lights.threshold', 'lights.end', 'lights.centreline',
  'lights.approach', 'lights.taxiway', 'lights.papiWhite', 'lights.papiRed', 'lights.strobe',
  'lights.off', 'lights.size.runway', 'lights.size.papi', 'lights.dayOpacity', 'lights.nightOpacity',
  'deck.base', 'deck.lines', 'deck.foul', 'deck.wire', 'deck.hullNumber', 'deck.catapult', 'deck.elevator',
  'carrier.deckSide', 'carrier.hull', 'carrier.gallery', 'carrier.island', 'carrier.dome',
  'carrier.wire', 'carrier.lensBox', 'carrier.wake', 'carrier.wakeOpacity',
  'carrier.deckCentreline', 'carrier.deckEdge', 'carrier.dropLine', 'carrier.datum',
  'carrier.ball', 'carrier.ballLow', 'carrier.ballOff', 'carrier.waveoff',
  'carrier.deckLightSize', 'carrier.lensLightSize', 'carrier.deckDayOpacity', 'carrier.deckNightOpacity',
];
for (const path of REQUIRED_COLOURS) {
  const v = path.split('.').reduce((o, k) => (o == null ? o : o[k]), PALETTE);
  ok(v !== undefined, `PALETTE.${path} is missing`);
}

// Anything used as a LightSet colour or a vertex colour has to be three numbers in 0..1
// (the strobe is deliberately over 1, so it blows out through the bloom).
const RGB_TRIPLES = [
  'lights.edge', 'lights.edgeCaution', 'lights.threshold', 'lights.end', 'lights.centreline',
  'lights.approach', 'lights.taxiway', 'lights.papiWhite', 'lights.papiRed', 'lights.off',
  'carrier.deckCentreline', 'carrier.deckEdge', 'carrier.dropLine', 'carrier.datum',
  'carrier.ball', 'carrier.ballLow', 'carrier.ballOff', 'carrier.waveoff',
  'ground.sand', 'ground.snow', 'ground.alpineLow', 'ground.alpineHigh', 'ground.rock', 'ground.grass',
];
for (const path of RGB_TRIPLES) {
  const v = path.split('.').reduce((o, k) => (o == null ? o : o[k]), PALETTE);
  ok(Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && n >= 0 && n <= 1),
    `PALETTE.${path} must be three numbers in 0..1, got ${JSON.stringify(v)}`);
}

for (const name of ['ground', 'runway', 'shoulder', 'paint', 'foliage', 'rock', 'building',
  'houseWall', 'houseRoof', 'roof', 'glass', 'metal', 'painted', 'timber', 'steel', 'ship', 'fabric', 'deck']) {
  const f = FINISH[name];
  ok(f && typeof f.roughness === 'number' && typeof f.metalness === 'number',
    `FINISH.${name} must be { roughness, metalness }`);
}

// --- textures.js ----------------------------------------------------------------
const textures = await import('../src/art/textures.js');
for (const n of ['groundDetail', 'runwaySurface', 'carrierDeck']) isFn(textures, n, 'textures.js');

// --- terrain-look.js ------------------------------------------------------------
const terrainLook = await import('../src/art/terrain-look.js');
for (const n of ['groundColor', 'buildGround', 'buildForest', 'buildRocks', 'buildRoad', 'buildVillage', 'buildObstacleTrees', 'buildCourse']) {
  isFn(terrainLook, n, 'terrain-look.js');
}
ok(terrainLook.OBSTACLE_TREE && typeof terrainLook.OBSTACLE_TREE.radius === 'number' && typeof terrainLook.OBSTACLE_TREE.height === 'number',
  'terrain-look.js must export OBSTACLE_TREE { radius, height } — the physics sizes the collision from it');
ok(terrainLook.OBSTACLE_TREE.radius > 0.5 && terrainLook.OBSTACLE_TREE.radius < 20,
  `OBSTACLE_TREE.radius of ${terrainLook.OBSTACLE_TREE?.radius} m is not a tree`);
ok(terrainLook.OBSTACLE_TREE.height > 5 && terrainLook.OBSTACLE_TREE.height < 80,
  `OBSTACLE_TREE.height of ${terrainLook.OBSTACLE_TREE?.height} m is not a tree`);

// --- airport-look.js ------------------------------------------------------------
const airportLook = await import('../src/art/airport-look.js');
for (const n of ['runwayMaterial', 'buildShoulders', 'buildBuildings', 'buildBushCamp', 'buildWindsock', 'buildMarkers', 'buildPapiBoxes']) {
  isFn(airportLook, n, 'airport-look.js');
}

// --- carrier-look.js ------------------------------------------------------------
const carrierLook = await import('../src/art/carrier-look.js');
for (const n of ['buildDeck', 'buildHull', 'buildGallery', 'buildIsland', 'buildWires', 'buildLensHousing', 'buildWake']) {
  isFn(carrierLook, n, 'carrier-look.js');
}

// --- livery.js ------------------------------------------------------------------
const livery = await import('../src/art/livery.js');
for (const n of ['paint', 'glass', 'dark', 'tire', 'paintSurfaces', 'dressGltf', 'navLights', 'propDisc']) {
  isFn(livery, n, 'livery.js');
}
ok(livery.LIVERY && typeof livery.LIVERY === 'object', 'livery.js must export LIVERY');
// Each airframe asks for its colours by name; a missing key is an undefined material.
const LIVERY_KEYS = {
  skylark: ['white', 'blue', 'pant', 'metal', 'dark', 'glass', 'tire'],
  trailblazer: ['yellow', 'black', 'metal', 'dark', 'glass', 'tire'],
  condor: ['white', 'belly', 'blue', 'metal', 'dark', 'glass', 'tire'],
  hornet: ['gray', 'gray2', 'metal', 'dark', 'glass', 'tire'],
};
for (const [id, keys] of Object.entries(LIVERY_KEYS)) {
  const f = livery.LIVERY?.[id];
  ok(typeof f === 'function', `LIVERY.${id} must be a function returning the aircraft's materials`);
  if (typeof f !== 'function') continue;
  const mats = f();
  for (const k of keys) {
    ok(mats[k] && mats[k].isMaterial, `LIVERY.${id}() must return a material called ${k} - ${id}'s airframe asks for it by name`);
  }
}
// paintSurfaces must not mutate the hinge spec it is handed: those are measured facts.
const hinge = Object.freeze({ aileron: Object.freeze({ x0: 1, x1: 2 }), elevator: Object.freeze({ x0: 1 }) });
let painted = null;
try { painted = livery.paintSurfaces('hornet', hinge); } catch (e) { /* mutated a frozen spec */ }
ok(painted && painted !== hinge && painted.color !== undefined,
  'paintSurfaces() must return a coloured COPY of the hinge spec, never mutate it');
ok(hinge.aileron.x0 === 1, 'paintSurfaces() must leave the measured hinge lines alone');

// --- airframe.js ----------------------------------------------------------------
const airframe = await import('../src/art/airframe.js');
for (const n of ['detail', 'propellerBlades']) isFn(airframe, n, 'airframe.js');
// detail() is handed the airframe's fitted size and must place against it, not against
// hard-coded numbers: a Skylark and an airliner are wildly different sizes.
{
  const fits = [
    { id: 'skylark', span: 11, length: 8.2, cgHeight: 1.1, nose: -3.4, tail: 4.8, belly: -1.1, top: 1.5, halfSpan: 5.5 },
    { id: 'condor', span: 34, length: 37, cgHeight: 3.4, nose: -15, tail: 22, belly: -3.4, top: 6.4, halfSpan: 17 },
  ];
  for (const fit of fits) {
    let bits = null;
    try { bits = airframe.detail(fit); } catch (e) { ok(false, `airframe.detail() threw for the ${fit.id}: ${e.message}`); continue; }
    ok(Array.isArray(bits), `airframe.detail() must return an array of Object3D (${fit.id})`);
    if (!Array.isArray(bits)) continue;
    for (const o of bits) ok(o && o.isObject3D, `everything airframe.detail() returns must be an Object3D (${fit.id})`);
    // Nothing may be parked outside the aeroplane it is bolted to.
    const slack = 1.6;
    for (const o of bits) {
      ok(Math.abs(o.position.x) <= fit.halfSpan * slack + 1, `detail placed off the ${fit.id}'s wing (x=${o.position.x.toFixed(2)}, halfSpan ${fit.halfSpan})`);
      ok(o.position.z >= fit.nose * slack - 1 && o.position.z <= fit.tail * slack + 1, `detail placed off the ${fit.id}'s fuselage (z=${o.position.z.toFixed(2)})`);
    }
  }
  const blades = airframe.propellerBlades({ id: 'skylark' }, 0.95);
  ok(blades && blades.isObject3D, 'airframe.propellerBlades() must return an Object3D - models.js spins it');
}

// --- sky.js, effects.js, lights.js ----------------------------------------------
const sky = await import('../src/art/sky.js');
ok(typeof sky.SkySystem === 'function', 'sky.js must export the SkySystem class');
isFn(sky, 'makeWater', 'sky.js');
for (const m of ['set', 'update']) {
  ok(typeof sky.SkySystem.prototype[m] === 'function', `SkySystem must keep the ${m}() method — main.js calls it every frame`);
}
// setShadowSize is assigned on the instance, so it can only be checked in the source.
ok(/setShadowSize\s*=/.test(src('art/sky.js')), 'SkySystem must keep setShadowSize() — the quality tiers call it');
for (const field of ['sunDir', 'sunElev', 'dayness']) {
  ok(new RegExp(`this\\.${field}\\s*=`).test(src('art/sky.js')), `SkySystem must keep this.${field} — the world and the HUD read it`);
}

const effects = await import('../src/art/effects.js');
ok(typeof effects.Effects === 'function', 'effects.js must export the Effects class');
for (const m of ['update', 'reset']) {
  ok(typeof effects.Effects.prototype[m] === 'function', `Effects must keep the ${m}() method`);
}

const lights = await import('../src/art/lights.js');
isFn(lights, 'getDisc', 'lights.js');
ok(typeof lights.LightSet === 'function', 'lights.js must export the LightSet class');
for (const m of ['add', 'setColor', 'setPos', 'finish']) {
  ok(typeof lights.LightSet.prototype[m] === 'function', `LightSet must keep the ${m}() method`);
}

// --- the fence ------------------------------------------------------------------
// Nothing on the art bench may reach into the simulation. Importing the physics or
// the systems from here would make a "visuals only" change able to alter the flying.
const FORBIDDEN = /from\s+'\.\.\/(physics|systems|ui)\//;
for (const f of ['palette.js', 'textures.js', 'terrain-look.js', 'airport-look.js', 'carrier-look.js', 'sky.js', 'effects.js', 'lights.js', 'livery.js', 'airframe.js']) {
  ok(!FORBIDDEN.test(src(`art/${f}`)), `art/${f} must not import from physics/, systems/ or ui/`);
}
// Deterministic worlds: the art may not reach for the wall clock.
for (const f of ['terrain-look.js', 'airport-look.js', 'carrier-look.js']) {
  ok(!/Date\.now\(\)|performance\.now\(\)/.test(src(`art/${f}`)), `art/${f} must not read the clock — the world has to build the same way every time`);
}

// =============================================================================
// --- the world bench (branch visuals-world) -------------------------------------
// The world's look is split into modules so that one brief can be fenced to one
// file. The world reads everything through the two doors it always used
// (terrain-look.js, sky.js); these checks make sure the doors still open onto the
// same rooms, and that the new rooms follow the house rules.
{
  const identical = (a, b, what) => ok(a === b, `${what} must be the same function through the barrel and in its own module`);

  // quality.js: the tier every world module sizes itself by.
  const quality = await import('../src/art/quality.js');
  for (const n of ['setWorldQuality', 'detailFromShadowSize', 'detailIndex']) isFn(quality, n, 'quality.js');
  ok(Array.isArray(quality.DETAIL_LEVELS) && quality.DETAIL_LEVELS.join() === 'low,medium,high', 'quality.js DETAIL_LEVELS must be low, medium, high');
  ok(quality.WORLD_QUALITY && typeof quality.WORLD_QUALITY.detail === 'string', 'quality.js must export WORLD_QUALITY { detail }');
  ok(quality.setWorldQuality({ shadowSize: 2048 }).detail === 'medium', 'a 2048 shadow map reads as the medium tier');
  ok(quality.setWorldQuality({ shadowSize: 1024 }).detail === 'low', 'a 1024 shadow map reads as the low tier');
  ok(quality.setWorldQuality({ shadowSize: 1024, detail: 'high' }).detail === 'high', 'an explicit detail wins over the shadow map size');
  ok(quality.setWorldQuality({ shadowSize: 4096 }).detail === 'high', 'a 4096 shadow map reads as the high tier');
  ok(quality.detailIndex('low') === 0 && quality.detailIndex('high') === 2, 'detailIndex() must map low..high onto 0..2');

  // world-atmosphere.js: the shading contract shared by the dome, the clouds, the water and the fog.
  const atmo = await import('../src/art/world-atmosphere.js');
  ok(typeof atmo.VISIBILITY_EXTINCTION === 'number' && atmo.VISIBILITY_EXTINCTION > 0, 'world-atmosphere.js must export VISIBILITY_EXTINCTION');
  ok(typeof atmo.atmosphereGLSL === 'string' && /vec3\s+atmosphere\s*\(\s*vec3/.test(atmo.atmosphereGLSL), 'atmosphereGLSL must define vec3 atmosphere(vec3 d)');
  ok(typeof atmo.atmosphereGLSL === 'string' && /vec3\s+celestial\s*\(\s*vec3/.test(atmo.atmosphereGLSL), 'atmosphereGLSL must define vec3 celestial(vec3 d)');
  ok(typeof atmo.worldVertex === 'string' && typeof atmo.outputGLSL === 'string', 'world-atmosphere.js must export worldVertex and outputGLSL');
  isFn(atmo, 'atmosphereUniforms', 'world-atmosphere.js');
  const u = atmo.atmosphereUniforms();
  ok(u && typeof u === 'object' && Object.keys(u).length > 0, 'atmosphereUniforms() must return the uniform object');
  for (const k of Object.keys(u)) {
    ok(/^at[A-Z]/.test(k), `atmosphere uniform ${k} must start with "at" - installFog() merges these into every fogged material`);
    ok(u[k] && 'value' in u[k], `atmosphere uniform ${k} must be { value }`);
  }
  for (const k of ['atSun', 'atDay', 'atExtinction']) ok(k in u, `atmosphereUniforms() must keep ${k} - SkySystem.set() drives it`);

  // world-water.js, and sky.js must still hand out the same makeWater.
  const water = await import('../src/art/world-water.js');
  isFn(water, 'makeWater', 'world-water.js');
  identical(sky.makeWater, water.makeWater, 'makeWater');

  // The three ground modules and the terrain-look.js barrel.
  const ground = await import('../src/art/world-ground.js');
  const veg = await import('../src/art/world-vegetation.js');
  const props = await import('../src/art/world-props.js');
  for (const n of ['groundColor', 'buildGround', 'parcel']) { isFn(ground, n, 'world-ground.js'); identical(terrainLook[n], ground[n], n); }
  for (const n of ['buildForest', 'buildObstacleTrees']) { isFn(veg, n, 'world-vegetation.js'); identical(terrainLook[n], veg[n], n); }
  ok(veg.OBSTACLE_TREE === terrainLook.OBSTACLE_TREE, 'OBSTACLE_TREE must be the one object through the barrel');
  for (const n of ['buildRocks', 'buildRoad', 'buildVillage']) { isFn(props, n, 'world-props.js'); identical(terrainLook[n], props[n], n); }
  ok(ground.buildGround.length <= 2, 'buildGround(field, opts) takes the field and an optional opts');
  const p = ground.parcel(1234.5, -876.2);
  ok(p && typeof p.edge === 'number' && typeof p.angle === 'number', 'parcel(x, z) must return { edge, angle }');

  // House rules for every module that draws the world.
  const WORLD_FILES = ['sky.js', 'world-atmosphere.js', 'world-water.js', 'world-ground.js', 'world-vegetation.js', 'world-props.js',
    'terrain-look.js', 'airport-look.js', 'carrier-look.js', 'textures.js', 'lights.js', 'palette.js', 'quality.js',
    'city-look.js'];
  for (const f of WORLD_FILES) {
    const code = src(`art/${f}`);
    ok(!FORBIDDEN.test(code), `art/${f} must not import from physics/, systems/ or ui/`);
    ok(!/from\s+'\.\.\/(aircraft|main|camera|input|touch|audio)/.test(code), `art/${f} must not import the engine or the aircraft`);
    ok(!/\bMath\.random\s*\(/.test(code.replace(/\/\/.*$/gm, '')), `art/${f} must not call Math.random() - use makeRng/noise2/fbm2 so the world builds the same way twice`);
    ok(!/Date\.now\(\)|performance\.now\(\)/.test(code), `art/${f} must not read the clock`);
    // GLSL uniforms named at* belong to the atmosphere alone (the sky owns the fog installation).
    if (f !== 'world-atmosphere.js' && f !== 'sky.js') {
      for (const m of code.matchAll(/uniform\s+\w+\s+([^;]+);/g)) {
        for (const name of m[1].split(',').map((s) => s.trim().replace(/\[.*$/, ''))) {
          ok(!/^at[A-Z]/.test(name), `art/${f} declares a GLSL uniform "${name}": the at* prefix is reserved for the atmosphere (installFog injects those names into every fogged material)`);
        }
      }
    }
  }
  // The world must never reach the art bench through anything but the two doors.
  for (const f of ['world/terrain.js', 'world/airport.js', 'world/carrier.js', 'world/obstacles.js']) {
    const code = src(f);
    ok(!/from\s+'\.\.\/art\/world-/.test(code), `${f} must import the look through terrain-look.js / sky.js, not the world-* modules directly`);
  }

}

// ======================================================================================
// --- THE AIRCRAFT: airframes, cockpits, particles (2026-09-14, branch visuals-aircraft)
// ======================================================================================
// The airframe modules (src/art/airframes/<id>.js) and the cockpit modules
// (src/art/cockpits/<id>.js) are built here in plain Node with a stand-in document
// (tools/dom-stub.mjs) so canvas textures can be created without being drawn. These
// checks are the contract in skylark.js's header: the exports, the part names the engine
// animates, the anchors it reads, the bounds, the budgets, and that a cockpit's controls
// actually move when the state changes.
{
  const { installDomStub } = await import('./dom-stub.mjs');
  installDomStub();
  const THREE = await import('three');
  const { DEG } = await import('../src/config.js');
  const { AIRCRAFT } = await import('../src/aircraft/defs.js');
  const IDS = ['skylark', 'trailblazer', 'condor', 'hornet'];
  const V = (v) => v && v.isVector3;
  const isObj = (o) => !!(o && o.isObject3D);
  const arrOf = (a, n = 1) => Array.isArray(a) && a.length >= n && a.every(isObj);
  const triangles = (root) => { let n = 0; root.traverse((o) => { if (o.isMesh && o.geometry) { const g = o.geometry; n += g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0); } }); return Math.round(n); };
  const meshes = (root) => { let n = 0; root.traverse((o) => { if (o.isMesh) n++; }); return n; };
  const NO_RANDOM = /Math\.random\(/;   // the call, not the prose in a header that forbids it
  const unnamedMaterials = (root) => { const seen = new Set(); let n = 0; root.traverse((o) => { if (o.isMesh) for (const mm of (Array.isArray(o.material) ? o.material : [o.material])) if (mm && !seen.has(mm)) { seen.add(mm); if (!mm.name) n++; } }); return n; };
  const AT_UNIFORM = /uniform\s+\w+\s+at[A-Z]\w*/;

  // ---- airframes ----
  const livery = await import('../src/art/livery.js');
  const common = await import('../src/art/airframes/common.js');
  for (const n of ['wingPanel', 'lathe', 'box', 'cyl', 'rod', 'surface', 'vSurface', 'wheel', 'navLights', 'landingLight', 'measureBounds', 'anchor']) isFn(common, n, 'airframes/common.js');
  for (const id of IDS) {
    const file = `art/airframes/${id}.js`;
    const text = src(file);
    ok(!NO_RANDOM.test(text), `${file} must not use Math.random (makeRng with ctx.seed)`);
    ok(!FORBIDDEN.test(text), `${file} must not import from physics/, systems/ or ui/`);
    ok(!AT_UNIFORM.test(text), `${file} must not declare at* shader uniforms (the sky injects those)`);
    ok(/buildAirframe\(def, ctx\)/.test(text) && /BODY FRAME|Body frame/.test(text), `${file} must keep its contract header (buildAirframe(def, ctx), the body frame)`);
    const m = await import(`../src/art/airframes/${id}.js`);
    isFn(m, 'buildAirframe', file);
    if (typeof m.buildAirframe !== 'function') continue;
    const def = AIRCRAFT[id];
    let r = null;
    try { r = m.buildAirframe(def, { materials: livery.LIVERY[id](), detail: 'high', propDisc: livery.propDisc, seed: 7 }); }
    catch (e) { ok(false, `${file} buildAirframe() threw: ${e.message}`); continue; }
    ok(r && isObj(r.group), `${file} must return { group } as an Object3D`);
    ok(r && r.parts && typeof r.parts === 'object', `${file} must return parts`);
    ok(r && r.anchors && typeof r.anchors === 'object', `${file} must return anchors`);
    ok(r && r.bounds && typeof r.bounds.halfSpan === 'number', `${file} must return bounds`);
    if (!r || !r.parts || !r.anchors || !r.bounds) continue;
    const p = r.parts, a = r.anchors, b = r.bounds;
    ok(r.group.position.lengthSq() === 0, `${file} group must sit at the origin (the engine moves it)`);
    ok(arrOf(p.elevator), `${file} parts.elevator must be a non-empty array of Object3D`);
    ok(isObj(p.aileronL), `${file} parts.aileronL missing`);
    ok(isObj(p.aileronR), `${file} parts.aileronR missing`);
    ok(arrOf(p.rudder), `${file} parts.rudder must be a non-empty array`);
    ok(arrOf(p.flaps), `${file} parts.flaps must be a non-empty array`);
    ok(Array.isArray(p.legs) && p.legs.length === def.gear.length, `${file} parts.legs must have one entry per def.gear entry (${def.gear.length})`);
    if (Array.isArray(p.legs)) p.legs.forEach((L, i) => {
      ok(L && isObj(L.root) && isObj(L.strut) && Array.isArray(L.wheels) && L.wheels.length > 0 && typeof L.y0 === 'number', `${file} legs[${i}] must have root, strut, wheels[], y0`);
      if (L && L.root) ok(L.root.parent === r.group, `${file} legs[${i}].root must be a direct child of group (kept when a glTF is substituted)`);
      if (def.gearRetract) ok(L && isObj(L.pivot) && (L.axis === 'x' || L.axis === 'z') && typeof L.angle === 'number', `${file} legs[${i}] must have pivot/axis/angle (retractable gear)`);
    });
    const props = def.engines.filter((e) => e.type === 'prop').length;
    if (props) {
      ok(arrOf(p.props, props), `${file} parts.props must have one entry per prop engine`);
      if (arrOf(p.props)) for (const pr of p.props) { ok(pr.parent === r.group, `${file} props must be direct children of group`); ok(pr.userData && typeof pr.userData.engine === 'number' && isObj(pr.userData.disc) && isObj(pr.userData.blades), `${file} a prop needs userData { engine, disc, blades }`); }
      ok(Array.isArray(a.propHub) && a.propHub.length === props && a.propHub.every(V), `${file} anchors.propHub must have one Vector3 per prop engine`);
    }
    if (def.hook) { ok(isObj(p.hook) && p.hook.parent === r.group, `${file} parts.hook must exist and be a direct child of group`); ok(V(a.hookPivot), `${file} anchors.hookPivot missing`); }
    if (id === 'condor') { ok(arrOf(p.spoilers, 2), `${file} parts.spoilers missing`); ok(arrOf(p.reversers, 2) && p.reversers.every((m2) => typeof m2.userData.z0 === 'number'), `${file} parts.reversers need userData.z0`); }
    // one Points per aircraft (docs/PERF.md): six vertices, set(name, value) writes the blink attribute
    ok(p.lights && p.lights.points && p.lights.points.isPoints && p.lights.points.parent === r.group && typeof p.lights.set === 'function', `${file} parts.lights must be navLights(): { points, set } with the Points a direct child of group`);
    if (p.lights && p.lights.points) {
      ok(p.lights.points.geometry.attributes.position.count === 6 && p.lights.points.geometry.attributes.aOn, `${file} the nav lights must be six vertices with an aOn attribute`);
      p.lights.set('beacon', 1); ok(p.lights.points.geometry.attributes.aOn.array[3] === 1, `${file} lights.set('beacon', 1) must write the attribute`);
    }
    ok(isObj(p.landingLight) && p.landingLight.isSpotLight && typeof p.landingLight.userData.max === 'number', `${file} parts.landingLight must be a SpotLight with userData.max`);
    ok(arrOf(p.hideInCockpit), `${file} parts.hideInCockpit must list the fuselage/canopy (hidden in the cockpit view)`);
    ok(Array.isArray(a.exhaust) && a.exhaust.length === def.engines.length && a.exhaust.every((x) => V(x.position) && V(x.direction) && typeof x.radius === 'number'), `${file} anchors.exhaust must have { position, direction, radius } per engine`);
    if (Array.isArray(a.exhaust)) for (const x of a.exhaust) ok(x.direction.z > 0.5, `${file} exhaust must point mostly aft (+Z)`);
    ok(V(a.eye) && Math.hypot(a.eye.x - def.eye.x, a.eye.y - def.eye.y, a.eye.z - def.eye.z) < 1e-6, `${file} anchors.eye must equal def.eye`);
    for (const k of ['navLeft', 'navRight', 'tail', 'beacon', 'wingtipL', 'wingtipR', 'pitot']) ok(V(a[k]), `${file} anchors.${k} missing`);
    ok(a.landingLight && V(a.landingLight.position) && V(a.landingLight.target), `${file} anchors.landingLight needs position and target`);
    if (V(a.wingtipL) && V(a.wingtipR)) ok(a.wingtipL.x < 0 && a.wingtipR.x > 0 && Math.abs(a.wingtipR.x - def.span / 2) < def.span * 0.08, `${file} wingtips must sit at +-span/2 (${def.span / 2})`);
    ok(Math.abs(b.halfSpan - def.span / 2) < def.span * 0.1, `${file} bounds.halfSpan ${b.halfSpan?.toFixed(2)} must match the wingspan (${def.span / 2})`);
    ok(b.nose < 0 && b.tail > 0 && b.belly < 0 && b.top > 0, `${file} bounds must straddle the CG (nose ${b.nose}, tail ${b.tail}, belly ${b.belly}, top ${b.top})`);
    const tris = triangles(r.group);
    ok(tris <= 60000, `${file} exterior is ${tris} triangles; the budget is 60k`);
    ok(meshes(r.group) <= 60, `${file} has ${meshes(r.group)} meshes; merge static geometry per material (budget 20 draw calls, the airliner 24)`);
    const unnamed = unnamedMaterials(r.group);
    ok(unnamed === 0, `${file}: ${unnamed} mesh material(s) have no name - name them so a shader error identifies itself`);
  }

  // ---- cockpits ----
  const { makeCockpitState } = await import('../src/cockpit.js');
  const ccommon = await import('../src/art/cockpits/common.js');
  for (const n of ['mat', 'box', 'cyl', 'gauge', 'makeDisplay', 'placeholderCockpit']) isFn(ccommon, n, 'cockpits/common.js');
  for (const id of IDS) {
    const file = `art/cockpits/${id}.js`;
    const text = src(file);
    ok(!NO_RANDOM.test(text) && !NO_RANDOM.test(src('art/cockpits/common.js')), `${file} must not use Math.random`);
    ok(!FORBIDDEN.test(text), `${file} must not import from physics/, systems/ or ui/`);
    ok(!AT_UNIFORM.test(text), `${file} must not declare at* shader uniforms`);
    ok(/buildCockpit\(def, ctx\)/.test(text) && /CONTRACT/.test(text), `${file} must keep its contract header`);
    const m = await import(`../src/art/cockpits/${id}.js`);
    isFn(m, 'buildCockpit', file);
    if (typeof m.buildCockpit !== 'function') continue;
    const def = AIRCRAFT[id];
    let c = null;
    try { c = m.buildCockpit(def, { materials: livery.LIVERY[id](), detail: 'high', eye: new THREE.Vector3(def.eye.x, def.eye.y, def.eye.z), seed: 11, anchors: {} }); }
    catch (e) { ok(false, `${file} buildCockpit() threw: ${e.message}`); continue; }
    ok(c && isObj(c.group) && c.parts && typeof c.update === 'function', `${file} must return { group, parts, update }`);
    ok(c && c.look && typeof c.look.yaw === 'number' && c.look.yaw > 0.5 && c.look.yaw <= Math.PI && typeof c.look.pitch === 'number' && c.look.pitch > 0.3 && c.look.pitch <= Math.PI / 2, `${file} must return look { yaw, pitch } in radians`);
    if (!c || !c.parts || typeof c.update !== 'function') continue;
    const p = c.parts;
    const stickOrYoke = id === 'skylark' || id === 'condor' ? 'yoke' : 'stick';
    ok(isObj(p[stickOrYoke]), `${file} parts.${stickOrYoke} missing (${id} is a ${stickOrYoke} aircraft)`);
    for (const k of ['pedalL', 'pedalR', 'asi', 'alt', 'vsi', 'attitude', 'hdgCard', 'stallLight', 'panel', 'glareshield', 'seat', 'windshield']) ok(isObj(p[k]), `${file} parts.${k} missing`);
    ok(arrOf(p.throttle, def.engines.length), `${file} parts.throttle must have one lever per engine`);
    if (id !== 'hornet') ok(isObj(p.flapLever) && isObj(p.trimWheel), `${file} parts.flapLever and parts.trimWheel missing`);
    if (def.gearRetract) ok(isObj(p.gearLever) && arrOf(p.gearLights, 3), `${file} parts.gearLever and three gearLights missing`);
    if (def.hook) ok(isObj(p.hookLever), `${file} parts.hookLever missing`);
    if (id === 'condor') ok(isObj(p.spoilerLever) && isObj(p.pfd), `${file} parts.spoilerLever and parts.pfd missing`);
    if (id === 'hornet') ok(isObj(p.hudGlass), `${file} parts.hudGlass missing`);
    // it must MOVE: pull, roll, pedal, throttle, speed, gear
    const s = makeCockpitState();
    s.id = id; s.engineType = def.engines[0].type; s.gearRetract = !!def.gearRetract;
    const snap = (o) => (o ? [o.position.x, o.position.y, o.position.z, o.rotation.x, o.rotation.y, o.rotation.z] : null);
    const moved = (a1, b1) => !!a1 && !!b1 && a1.some((v, i) => Math.abs(v - b1[i]) > 1e-6);
    try {
      c.update(s);
      const ctl0 = snap(p[stickOrYoke]), pedR0 = snap(p.pedalR), pedL0 = snap(p.pedalL), thr0 = snap(p.throttle[0]), asi0 = snap(p.asi), gear0 = snap(p.gearLever);
      s.elevator = 0.8; c.update(s);
      const ctl1 = snap(p[stickOrYoke]);
      ok(moved(ctl0, ctl1), `${file}: the ${stickOrYoke} must move with the elevator`);
      if (stickOrYoke === 'yoke') ok(ctl1[2] > ctl0[2], `${file}: pulling (elevator > 0) must bring the yoke aft (+Z)`);
      else ok(ctl1[3] > ctl0[3], `${file}: pulling (elevator > 0) must tilt the stick back (rotation.x > 0)`);
      s.elevator = 0; s.aileron = 0.8; c.update(s);
      const ctl2 = snap(p[stickOrYoke]);
      ok(moved(ctl0, ctl2) && ctl2[5] < ctl0[5], `${file}: roll right (aileron > 0) must turn the ${stickOrYoke} clockwise (rotation.z < 0)`);
      s.aileron = 0; s.rudder = 0.8; c.update(s);
      ok(snap(p.pedalR)[2] < pedR0[2] && snap(p.pedalL)[2] > pedL0[2], `${file}: rudder > 0 must push the right pedal forward (-Z) and the left aft`);
      s.rudder = 0; s.throttle[0] = 1; s.throttle[1] = 1; c.update(s);
      ok(moved(thr0, snap(p.throttle[0])), `${file}: the throttle lever must move with the throttle`);
      s.ias = 100; c.update(s);
      ok(moved(asi0, snap(p.asi)) && p.asi.rotation.z < 0, `${file}: the airspeed needle must turn clockwise with speed`);
      if (def.gearRetract) { s.gearCmd = 0; c.update(s); ok(moved(gear0, snap(p.gearLever)), `${file}: the gear lever must move with gearCmd`); }
      s.stallWarning = true; s.t = 0.1; c.update(s); s.t = 0.2; c.update(s);
    } catch (e) { ok(false, `${file} update() threw: ${e.message}`); }
    const tris = triangles(c.group);
    ok(tris <= 80000, `${file} interior is ${tris} triangles; the budget is 80k`);
    ok(meshes(c.group) <= 70, `${file} has ${meshes(c.group)} meshes; merge static geometry per material (budget 20 draw calls)`);
    const unnamed = unnamedMaterials(c.group);
    ok(unnamed === 0, `${file}: ${unnamed} mesh material(s) have no name`);
    ok(c.group.position.lengthSq() === 0, `${file} group must sit at the origin (it is parented to the aircraft)`);
  }

  // ---- line of sight ----
  // The pilot must be able to see out: from the eye, rays through the windshield must not
  // meet an OPAQUE cockpit mesh within 2.5 m (a filler panel across the windshield opening
  // blacked out a whole forward view in one pass). Glass is transparent and is allowed;
  // thin posts may catch a ray or two, so 13 of 15 rays must be clear.
  for (const id of IDS) {
    const file = `art/cockpits/${id}.js`;
    const m = await import(`../src/art/cockpits/${id}.js`);
    const def = AIRCRAFT[id];
    let c = null;
    try { c = m.buildCockpit(def, { materials: livery.LIVERY[id](), detail: 'high', eye: new THREE.Vector3(def.eye.x, def.eye.y, def.eye.z), seed: 11, anchors: {} }); } catch (e) { continue; }
    if (!c || !c.group) continue;
    c.group.updateMatrixWorld(true);
    const opaque = []; c.group.traverse((o) => { if (o.isMesh && o.material && !(Array.isArray(o.material) ? o.material[0] : o.material).transparent) opaque.push(o); });
    const ray = new THREE.Raycaster(); ray.far = 2.5;
    const eye = new THREE.Vector3(def.eye.x, def.eye.y + (def.seatUp || 0), def.eye.z);   // where the camera is: the design eye raised by the seat
    let clear = 0, total = 0, blockers = new Set();
    for (const yawDeg of [-25, -12, 0, 12, 25]) for (const pitchDeg of [-2, 6, 14]) {
      const yaw = yawDeg * DEG, pitch = pitchDeg * DEG;
      const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      ray.set(eye, dir); total++;
      const hits = ray.intersectObjects(opaque, false);
      if (!hits.length) clear++; else blockers.add(`${hits[0].object.name || '?'} at ${hits[0].distance.toFixed(2)} m`);
    }
    ok(clear >= 13, `${file}: only ${clear}/${total} rays from the eye through the windshield are clear of opaque geometry within 2.5 m - something blocks the view: ${[...blockers].slice(0, 4).join('; ')}`);
  }

  // ---- particles ----
  const particles = await import('../src/particles.js');
  ok(typeof particles.ParticleSystem === 'function' && typeof particles.Emitter === 'function', 'particles.js must export ParticleSystem and Emitter');
  ok(!NO_RANDOM.test(src('particles.js')) && !NO_RANDOM.test(src('art/effects.js')), 'particles.js and art/effects.js must not use Math.random');
  {
    const scene = { add() {}, remove() {} };
    const mk = () => new particles.ParticleSystem(scene, { max: 64, seed: 3, drag: 0 });
    const frame = { position: new THREE.Vector3(0, 100, 0), quaternion: new THREE.Quaternion() };
    const run = (sys) => {
      const e = sys.emitter({ rate: 0, frame, anchor: { position: new THREE.Vector3(0, 0, 2), direction: new THREE.Vector3(0, 0, 1), radius: 0 }, speed: 0, speedSpread: 0, cone: 0, life: 5, lifeJitter: 0 });
      frame.position.set(0, 100, 0); sys.update(0.1, { t: 0 });          // primes the emitter (rate 0: nothing yet)
      e.rate = 100;
      frame.position.set(0, 100, -10); sys.update(0.1, { t: 0.1 });      // the frame moved 10 m in one frame
      const zs = []; for (let i = 0; i < sys.max; i++) if (sys.alpha[i] > 0 || sys.age[i] < sys.life[i]) zs.push(sys.pos[i * 3 + 2]);
      e.rate = 0;
      return zs;
    };
    const a = run(mk());
    ok(a.length >= 9 && a.length <= 11, `an emitter at 100/s must spawn ~10 particles in 0.1 s (got ${a.length})`);
    const lo = Math.min(...a), hi = Math.max(...a);
    ok(hi - lo > 6, `sub-frame emission must spread the particles along the frame's path (spread ${(hi - lo).toFixed(2)} m over a 10 m move) - not one puff per frame`);
    const b = run(mk());
    ok(a.length === b.length && a.every((z, i) => Math.abs(z - b[i]) < 1e-9), 'two systems with the same seed must emit identically (determinism)');
    const sys = mk(); frame.position.set(0, 0, 0);
    sys.burst(new THREE.Vector3(1, 2, 3), new THREE.Vector3(0, 1, 0), 5, { spread: 0.1, life: 1 });
    sys.update(0.5, { t: 0 });
    let alive = 0; for (let i = 0; i < sys.max; i++) if (sys.alpha[i] > 0) alive++;
    ok(alive === 5, `burst(5) must leave 5 live particles after 0.5 s (got ${alive})`);
    sys.update(1.0, { t: 0.5 });
    alive = 0; for (let i = 0; i < sys.max; i++) if (sys.alpha[i] > 0) alive++;
    ok(alive === 0, `particles must die at the end of their life (got ${alive} alive after 1.5 s of a 1 s life)`);
    ok(typeof sys.reset === 'function' && typeof sys.setLight === 'function' && typeof sys.dispose === 'function', 'ParticleSystem must keep reset(), setLight() and dispose()');
  }
  // the effects contract
  ok(/update\(dt, ac, model, env/.test(src('art/effects.js')), 'art/effects.js Effects.update must take (dt, ac, model, env)');
  ok(/anchors\.exhaust/.test(src('art/effects.js')), 'art/effects.js must read the exhaust anchors from the model');
  for (const f of ['airframes/common.js', 'cockpits/common.js', 'effects.js']) ok(!FORBIDDEN.test(src(`art/${f}`)), `art/${f} must not import from physics/, systems/ or ui/`);
}

console.log(fail ? `\n${fail} art contract check(s) FAILED (${pass} passed)` : `\nall ${pass} art contract checks passed`);
process.exit(fail ? 1 : 0);
