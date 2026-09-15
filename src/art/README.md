# The art bench

Everything in `src/art/` decides how the 3D world *looks*. Everything in `src/world/`
decides what it *is*. That line is the whole point of this directory, and it is what
makes it safe to hand the look to someone working on their own: no change in here can
move a runway, alter a friction coefficient, or make an airplane fly differently.

Read `AGENTS.md` next door before working here — it is the fence and the direction.

## The split, concretely

| Decision | Where it lives |
|---|---|
| How high the ground is at (x, z) | `world/terrain.js` |
| What colour that ground is, how finely it is meshed | `art/world-ground.js` |
| Where the runway is, how long, how much grip | `world/airport.js` |
| What the asphalt and its markings look like | `art/textures.js`, `art/airport-look.js` |
| Where each runway light sits and what it means | `world/airport.js` |
| What colour and size that light renders at | `art/palette.js`, `art/lights.js` |
| The deck outline the physics tests against | `world/carrier.js` |
| The paint on that deck | `art/textures.js`, `art/carrier-look.js` |
| Sun angle for a given time of day | `art/sky.js` |
| How bright, how hazy, what colour the sky is | `art/world-atmosphere.js`, `art/sky.js` |
| Where an obstacle tree stands | `world/terrain.js` (from the scenario) |
| What that tree looks like, and how big it is | `art/world-vegetation.js` (`OBSTACLE_TREE`) |
| Where a road runs, where a village sits | `world/airport.js` |
| What the road and the houses look like | `art/world-props.js` |
| An aircraft's size, hinge lines and animation | `aircraft/models.js` |
| What that aircraft is painted with | `art/livery.js` |

## The modules

The world reaches the art bench through two doors, `terrain-look.js` and `sky.js`,
whose exports are frozen. Behind them the work is split one module per subject so
that a brief can be fenced to one file.

**`palette.js`** — every colour and finish the world draws with, named, in one object.
The fastest way to change the whole mood. `PALETTE` holds colours (as `0xRRGGBB`,
`[r,g,b]` floats, `'#rrggbb'` canvas fills, or HSL parts where a colour varies per
instance); `FINISH` holds roughness/metalness per surface class so colour and finish
are chosen together. Every name in here is checked by `tools/test-art.mjs`: rename one
and the test tells you what reads it.

**`quality.js`** — the quality tier as the art bench sees it: `WORLD_QUALITY.detail`
is `'low' | 'medium' | 'high'`, set once per site before the world is built (the
SkySystem is constructed first and calls `setWorldQuality()` with what the engine
handed it; an explicit `detail` wins, otherwise the tier is read off the shadow map
size). Every world module reads it to decide how much geometry and shader work to
spend. The per-tier budgets are in its header.

**`textures.js`** — the procedural canvas textures: the tiling ground detail, the
runway surface with all its markings, the carrier deck. Nothing is loaded from a file;
the game ships as one HTML document. Draw deterministically.

**`world-atmosphere.js`** — the shading contract of the sky: the GLSL `atmosphere(d)`
("what colour is the sky in direction d") and `celestial(d)` (sun disc, glare, moon),
and `atmosphereUniforms()` that feed them. Included by the sky dome, the cloud layers,
the water's reflection and — through `SkySystem.installFog()` — by every fogged
material in the scene as its aerial perspective. All of its uniforms start with `at`,
and that prefix is reserved: no other module may declare a GLSL uniform with it.

**`sky.js`** — the atmosphere put to work: the sky dome, sun and moon and their colours
through the day, the directional and hemisphere lights, the fog installation, cloud
layers, stars, tone mapping. The biggest single lever on how the game looks. Its
contract with the engine:
`new SkySystem(scene, renderer, { time, visibility, azimuth, elevation, cloudCover, shadowSize, detail })`,
then `.set(time, visibility)`, `.update(aircraftPos, dt)` and `.setShadowSize(n)`, and
it must keep exposing `sunDir`, `sunElev`, `dayness`, `sun` and `fogColor`. It also
re-exports `makeWater` because the world imports it from here.

**`world-water.js`** — the animated water, sea and river: `makeWater(size, level, sun)`
returns `{ mesh, material, setSun(dir, dayness, fogColor), tick(dt) }`. Its reflection
asks the shared atmosphere for the sky colour, so sea and sky can never disagree.

**`terrain-look.js`** — the door the world comes through for the ground; a barrel over
the three modules below. `src/world/terrain.js` reads `groundColor`, `buildGround`,
`buildForest`, `OBSTACLE_TREE`, `buildObstacleTrees`, `buildRocks`, `buildRoad` and
`buildVillage` from it by name.

**`world-ground.js`** — the terrain mesh and its colouring. Handed the live `Terrain`
as a read-only `field` (its header lists every method available). The heightfield is
analytic, so the mesh may sample it at any resolution: dense near the aerodrome,
coarse far away, in chunks under `THREE.LOD` so the renderer picks the level by camera
distance with no help from the engine. `parcel(x, z)` is the farm-parcel grid the hedge
placement shares.

**`world-vegetation.js`** — the instanced forests, the hedgerows and the obstacle trees.
Forests and hedges are decoration and nothing collides with them, so their placement is
yours; the obstacle trees on the bush approaches DO collide, and their size is declared
in `OBSTACLE_TREE`. `buildForest(field, { treeScale, maxTrees, detail })` returns
`{ objects, count }`.

**`world-props.js`** — boulders, roads and villages. Where a road runs and where a
village sits is decided by `world/airport.js`; what they look like is decided here.

**`airport-look.js`** — the runway material, shoulders, taxiway and apron, buildings,
tower, windsock, bush camp, edge markers, PAPI housings. Handed the resolved runway and
a `place(u, v, out)` function that converts runway coordinates to world points, so
nothing here needs to know how a runway is laid out. Builders that draw something solid
return `obstacles` for `world/airport.js` to register with the physics — if you change
what you draw, change the obstacle to match. `buildBuildings` is also handed
`parked(kind)`, which returns a finished static aircraft model for the apron.

**`carrier-look.js`** — hull, flight deck, gallery, island, arresting wires, the IFLOLS
housing and the wake. Handed the live `Carrier` as read-only.

**`livery.js`** — how the aircraft are painted: the shared material vocabulary (paint,
glass, dark, tyre), each aircraft's colours, the colour of the hinged control surfaces
added on top of a downloaded model, the one pass over a loaded glTF airframe
(`dressGltf`), the navigation lights and the propeller disc. `src/aircraft/models.js`
keeps the shape, the scale fitted to the wingspan, the measured hinge lines, the part
names and the animation; this file keeps the finish. Note that three of the four
airframes are downloaded models with their own materials, so `dressGltf()` is where a
real paint job has to happen.

**`airframe.js`** — the hardware bolted onto the airframes (antennas, lights, pitot,
the propeller blades), placed against the fitted size and the raycast probes the
aircraft module hands it.

**`effects.js`** — tire smoke, water spray, sparks, crash fire and smoke. `Effects` is
constructed with the scene and driven by `update(dt, aircraft, model)`.

**`lights.js`** — how every point light in the game is drawn: the soft disc sprite and
the `LightSet` batch (runway lights, deck lights, nav lights, the meatball). Its
exports are used from outside this directory as well, so their names are frozen.

## Working here

- `npm run build` must succeed and `npm test` must pass. The last suite,
  `tools/test-art.mjs`, is this directory's contract: every export, every palette
  entry, the `at` uniform prefix, and a check that nothing here imports the physics,
  calls `Math.random()` or reads the wall clock. It runs in plain Node, so the art
  department can run it too: `node tools/test-art.mjs`.
- Everything must build the same way twice. Use `makeRng`, `noise2`, `fbm2` from
  `../config.js`, seeded from what you are handed. `Math.random()` in the world is a
  bug: it makes the screenshots that review this work impossible to compare.
- Honour the quality tier (`quality.js`). `src/main.js` passes `treeScale` and
  `shadowSize` down and turns the post-processing composer off on low; the same code
  runs on a phone.
- Both ends of the day. Scenarios run 07:00 to 22:30 and 700 m to 40 km visibility.

## Performance

The game must run at 60 fps at 1080p on a laptop with a real GPU and stay playable on
a phone, and today it does neither comfortably. The world is measured, not guessed:
`node tools/world-probe.mjs <out.json>` drives the same eleven scenes as the look sheet
and prints, per scene, the draw calls and triangles of the scene alone (shadow pass
included), the full composer frame, the number of shader programs, instances and
shadow casters, and everything the page logged — shader compile failures show up here
and nowhere else. Budgets per tier are in `quality.js`; the rules of thumb:

- terrain as chunks under `THREE.LOD`: dense near, coarse far, skirts against cracks
- everything there are dozens of is instanced, one draw per kind per level of detail,
  billboard impostors beyond a distance, bounding spheres computed so culling works
- the sky's per-pixel work is a few instructions: bake the gradient and the haze into
  small lookup textures at `set()` time
- water is one cheap normal-map style pass; clouds are a few textured sheets
- shadows: the ground receives; trees cast only near the aircraft on high
- textures are canvases of 2048 px or less, drawn once and cached
- nothing allocates per frame, nothing sets `needsUpdate` per frame except animated
  buffers, and materials are never cached across scenarios (textures may be)

## How the look is reviewed

The website repo has `tools/ctl-shots/looksheet.mjs`: eleven fixed scenes, flown by
autopilot to the same frame every time, screenshotted at 1920×1080, with a contact
sheet for a quick read. `lookdiff.mjs` compares two sheets and prints how far each
scene moved; `lookpairs.mjs` stacks before/after pairs. Turbulence and camera shake are
seeded from `window.CTL_WIND_SEED`, so with that pinned the same build shoots
identically twice and any difference between two sheets is a real change of look.
`tools/world-probe.mjs` here is the sheet's cost counterpart (`CTL_PROBE_QUALITY`
runs a scene at another tier), `tools/still-lab.mjs` renders one scene with a
JavaScript experiment applied first (composer off, a uniform zeroed, an object
hidden) to find which stage makes a scene look the way it does, `tools/sky-budget.mjs`
checks the sky's radiance and the aerial perspective in plain Node, and
`tools/looksheet.mjs` is a copy of the website harness that waits for the airframe
and gives the menu scene its update. The briefs of the 2026-09-14 rebuild are in
`docs/briefs/world/`.

scene moved. Turbulence and camera shake are seeded from `window.CTL_WIND_SEED`,
so with that pinned the same build shoots identically twice and any difference between
two sheets is a real change of look.

## The aircraft (added 2026-09-14)

The same split, applied to the aeroplanes. `src/aircraft/defs.js` is what an aircraft
IS to the physics (span, wheels, engines, eye, hinge throws); `src/aircraft/models.js`
decides which airframe ships, fits a downloaded glTF as the fallback and animates the
named parts. Everything visual is on the bench, one module per aircraft:

| Module | Handed | Must return |
|---|---|---|
| **`airframes/<id>.js`** | `def` (read-only physics definition), `ctx` = { `materials` from `LIVERY[id]()`, `detail` tier, `propDisc(r)`, `seed` } | `buildAirframe(def, ctx) -> { group, parts, anchors, bounds }` - the exterior at the origin in the body frame, built to `def.span` with the wheels at `def.gear[i].pos`; `parts` are the named hinges the engine rotates every frame (elevator[], aileronL/R, rudder[], flaps[], spoilers[], props[], hook, reversers[], legs[] with root/pivot/strut/wheels, lights, landingLight, hideInCockpit[]); `anchors` are body-frame points the engine reads (exhaust[] per engine with position/direction/radius, eye = def.eye, nav lights, landing light, wingtips, propHub[], hookPivot, pitot); `bounds` from `measureBounds()`. The full contract is the header of `airframes/skylark.js`. |
| **`airframes/common.js`** | - | the shared builders: `wingPanel`, `lathe`, `box`, `cyl`, `rod`, `surface` (a hinged panel), `vSurface` (a rudder), `wheel`, `navLights`, `landingLight`, `measureBounds`, `anchor`. |
| **`cockpits/<id>.js`** | `def`, `ctx` = { `materials`, `detail`, `eye` (= def.eye), `seed`, `anchors` (the exterior's) } | `buildCockpit(def, ctx) -> { group, parts, update(state), look }` - the interior around the eye in the body frame; `update(state)` moves the yoke or stick, pedals, levers, needles, cards, lights and displays from the flight state (every field listed in the header of `cockpits/skylark.js`); `look` = { yaw, pitch } head-turn limits in radians. The engine (`src/cockpit.js`) draws it on its own layer with a 0.03 m near plane after the world, forces fog and shadows off, and lights it with the scene's sun and sky. |
| **`cockpits/common.js`** | - | `mat`, `box`, `cyl`, `gauge` (face + needle), `makeDisplay(w, h, hz)` (a canvas texture uploaded at most hz times a second) and `placeholderCockpit()`, the plain moving interior every cockpit started from. |
| **`effects.js`** | `scene`, `{ seed }`; then every frame `update(dt, ac, model, env)` with the live aircraft (read-only), the model (`model.group` is the body frame in the world, `model.anchors.exhaust[]`), and `env` = { `windAt`, `t`, `camera`, `viewH`, `sky` } | the `Effects` class: which particle systems exist (`src/particles.js`), their textures, colours, rates, sizes, lifetimes, and when each emitter runs - exhaust per engine (idle haze, throttle puff, jet soot, the failed-engine stream), tyre smoke and dust, spray, sparks, crash fire. `reset()`. |

`src/particles.js` is the engine's and read-only: `ParticleSystem` (a pooled point
sprite system with wind advection, buoyancy, drag, size and opacity curves, optional
depth sorting, seeded jitter) and `Emitter` (rate-based, attached to a moving frame,
with sub-frame emission so a fast aircraft leaves a ribbon, not one puff per frame).
Its header is the API.

`npm test` (`tools/test-art.mjs`, last block) builds all four airframes and cockpits in
plain Node with a stand-in document (`tools/dom-stub.mjs`) and checks the exports, part
names, anchors, bounds, budgets, that a cockpit's controls move the right way with the
state, that the particle emitter interpolates within a frame and is deterministic, and
that nothing here uses `Math.random`, imports the physics or declares `at*` uniforms.

Stills of the aircraft and the interiors: the game repo's own `tools/surfshot.mjs`
(a copy of the website harness's with the cockpit state fed and draw calls counted):
`mode: 'cockpit'` with `headYaw`/`headPitch` for the interior, `deflect: true` to
move the controls, `cam`/`look` in the body frame for a close look at the airframe,
`eval` for an in-page count.
