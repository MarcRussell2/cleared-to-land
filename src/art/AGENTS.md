# AGENTS.md — the art bench

You are the art department for CLEARED TO LAND, a browser flight game. The repository root's
`AGENTS.md` still applies and wins on any conflict; this file narrows the job.

## What you are here to do

**The look of the 3D world, and nothing else.** That was the owner's explicit decision:
the engine, the flight model and the world's layout are written and settled; you make
the picture. Sky, light, weather, water, ground, forests, pavement, buildings, the
carrier, smoke and spray — all yours.

The brief you are given says which part to work on. The direction, fixed by the owner,
is **real and atmospheric**: this should look like a flight simulator, not a cartoon.
Blue sky with honest haze, sun you can feel the angle of, weathered concrete, fields
with edges, a night you can see into. Not stylised, not neon, not "cinematic teal".

## Hard boundaries

1. **Only ever create or edit files in this directory (`src/art/`).** Everything else
   is read-only reference: read it to understand what you are drawing, never change it.
   In particular `src/world/`, `src/physics/`, `src/systems/`, `src/aircraft/`,
   `src/main.js`, `src/ui/` and `src/style.css` are not yours. If a change outside
   `src/art/` looks necessary, **say so in your answer and stop.** Files outside this
   directory are checked after every run and anything you touched will be reverted.
2. **The aircraft are in scope now** — their paint, not their shape. `src/art/livery.js`
   owns the material vocabulary, each aircraft's colours, the finish applied to the
   downloaded glTF airframes, the navigation lights and the propeller disc.
   `src/aircraft/` is still read-only: the models' dimensions, the measured hinge lines
   of their control surfaces, the part names and the animation are not yours.
   **Still not in scope:** the HUD, the menus, and any CSS.
3. **Never change what the world IS.** A height, a runway position, a surface friction,
   a light's meaning, an obstacle's size — those live in `src/world/` and the physics
   reads them. Where a shape here has a physical counterpart it is called out in the
   file (`OBSTACLE_TREE`, the obstacles returned by the aerodrome builders): if you
   change the drawing, change the number with it so the collision still matches.
4. **No new dependencies, no network, no binary assets.** No CDN, no downloaded font
   or texture, no image files, no base64 blobs. Everything is drawn in code: three.js
   geometry, materials, shaders, and canvas textures. The whole game ships as one HTML
   file and it stays that way.
5. **Deterministic.** Use `makeRng`, `noise2`, `fbm2` from `../config.js`, seeded from
   what you are given. Never `Math.random()` for anything that is part of the world —
   the same scenario has to build the same way every time, because that is how the
   screenshots that review your work are compared.
6. **Keep the exported names and shapes.** The engine calls these modules by name.
   `npm test` ends with `tools/test-art.mjs`, which checks every export and every
   palette entry the world reads. A rename is a black screen.

## Performance

The budget is 60 fps at 1920×1080 on a laptop with a real GPU, and the game also runs
on phones. `src/main.js` picks a quality tier and passes it down (`treeScale`,
`shadowSize`, whether the post-processing composer runs at all) — honour those knobs.
Bake static work once at build time into a texture or a merged geometry and blit it;
do not add per-frame work in a loop over thousands of objects. Instance anything there
are more than a few dozen of.

## How your work gets reviewed

You cannot see the game. The owner's harness flies eleven fixed scenes — menu, a plains
approach in the morning, a flare, a cockpit view, a coastal airport, late afternoon from
the tower, a carrier by day and by night, a mountain valley, a ridge strip and a fog
approach — and screenshots them at the same frame every time. Those pictures come back
to you as the next brief. So:

- Work on all conditions, not just the one in your head. Times of day run from 07:00 to
  22:30 and visibility from 700 m to 40 km; a change that looks wonderful at noon and
  black at dusk is not finished.
- In your answer, say what you changed and what it should now look like, so the
  screenshots can be checked against your intent.

## Where the contract is

`README.md` in this directory: what each module owns, what it is handed, and what it
must return. Read it before writing. Each file's own header is the detailed spec for
that file, and it is the specification — not a placeholder to be replaced wholesale.

## The world bench: sky, water, ground, forests, aerodrome, ship

The world's look is being rebuilt from the ground up (branch `visuals-world`), one brief
at a time, and the modules are split so that each brief is fenced to one or two files:

| Subject | Files |
|---|---|
| sky, sun, moon, haze, clouds, stars, fog | `world-atmosphere.js`, `sky.js` |
| sea and river | `world-water.js` |
| the ground mesh, its colours and material | `world-ground.js` |
| forests, hedgerows, the obstacle trees | `world-vegetation.js` |
| boulders, roads, villages | `world-props.js` |
| runway, pavement, markings, buildings, lights' look | `textures.js`, `airport-look.js`, `lights.js`, `palette.js` |
| the carrier | `carrier-look.js`, `textures.js` |

**The brief names the files you may edit. Touch nothing else, not even another file in
this directory.** `terrain-look.js` and `sky.js`'s export list are doors the world
comes through; their exports are frozen (`node tools/test-art.mjs` checks them, and you
can run that yourself — it needs no browser).

House rules, each one learned from a pass that went wrong:

1. **The file header is the specification.** Keep it and extend it; never replace it
   with a one-line summary. Someone reading only the header must know what the module
   is handed, what it returns, and the rules it follows.
2. **GLSL uniforms starting with `at` belong to the atmosphere.** `SkySystem.installFog()`
   merges `atSun`, `atZenith`, `atDay`, `atExtinction`… into every fog-enabled material
   in the scene. A material that declares one of those names itself fails to compile
   and the object disappears — and `npm test` cannot see it. Prefix your own uniforms
   by module (`gr` ground, `vg` vegetation, `wv` water, `sk` sky, `cl` clouds, `ap`
   aerodrome, `cv` carrier).
3. **Materials belong to a scene.** Never keep a material or an instanced geometry in a
   module-level cache: the next scenario gets a new scene and a new SkySystem, and a
   cached material carries the old fog uniforms into it. Textures (immutable canvases)
   may be cached, keyed by everything that built them.
4. **Name every material** (`material.name = 'world/ground'`), so a shader error in the
   console says which one failed.
5. Any material with `onBeforeCompile` sets `customProgramCacheKey` to a unique,
   versioned string, before the world is handed to the engine.
6. **Determinism**: `makeRng`, `noise2`, `fbm2` from `../config.js`, seeded from what you
   are handed. `Math.random()` is a test failure.
7. **Per frame**: no allocations, no `needsUpdate` except on animated buffers, no loops
   over thousands of objects. Camera-dependent choices go through `THREE.LOD` (the
   renderer calls its `update(camera)` itself) or a mesh's `onBeforeRender`; the engine
   will not add a per-frame call for you. Instanced meshes get `computeBoundingSphere()`
   after their matrices are set, so frustum culling works — do not set
   `frustumCulled = false` on something that has an extent.
8. **Budgets** (whole site, the scene alone, shadow pass included; `quality.js`):
   high ≤ 250 draw calls and ≤ 1.5 M triangles, medium ≤ 180 / 0.8 M, low ≤ 120 / 0.35 M.
   Read `WORLD_QUALITY.detail` and spend accordingly. The owner measures every pass with
   `tools/world-probe.mjs`; a pass that looks better and costs more is sent back.
9. **All conditions.** 07:00 to 22:30, 700 m to 40 km, five sites: plains, coast,
   two mountain valleys, open sea. Say in your answer what each scene should now look
   like, so the screenshots can be checked against your intent.
10. **Radiance budget.** The composer renders linear radiance without tone mapping and
    the bloom thresholds it at 0.92: sunlit white is about 0.8, the sky under 0.85
    except the sun disc, only lamps and glints may exceed 1. `node tools/sky-budget.mjs`
    checks the sky; a change that pushes a whole sky over the line veils every frame.
11. **Colours are linear.** `Color.setHSL` and hex colours resolve in three's linear
    working space: an HSL lightness of 0.19 is a mid green, not a dark one; a dark
    spruce is about 0.06. Author albedos as linear values.
12. **Level of detail is per instance, not per chunk.** A chunk-sized `THREE.LOD`
    switch puts billboards next to the camera and full trees at the horizon; measure
    the instance's own distance in the vertex shader and use `THREE.LOD` only to stop
    drawing a cell that is wholly out of range. And the probe's triangle count is
    submitted geometry: collapsed instances still cost vertex work.

## The aircraft (added 2026-09-14): airframes, cockpits, exhaust

Boundary 2 above is superseded for the aircraft: their SHAPE is now yours as well as
their paint. Three new areas of this directory are the art bench's, and the fence
around them is the same as everywhere else - only files under `src/art/`:

- **`airframes/<id>.js`** - the exterior of each aircraft, built in code:
  `buildAirframe(def, ctx) -> { group, parts, anchors, bounds }`. The contract - the
  part names the engine animates, the hinge conventions, the anchors it reads, the
  budget - is the header of `airframes/skylark.js` (the full text) and a compact form
  at the top of the other three. `airframes/common.js` holds the shared geometry
  helpers. Build to `def.span`, put the wheels where `def.gear` says, the eye at
  `def.eye`; never move the CG or a hinge to make a shape easier.
- **`cockpits/<id>.js`** - the interior seen from the cockpit camera:
  `buildCockpit(def, ctx) -> { group, parts, update(state), look }`. The contract is
  the header of `cockpits/skylark.js`; `cockpits/common.js` has the helpers and the
  placeholder every cockpit started from. `update(state)` is called every frame with
  the flight state; instruments move as meshes (needles, cards) or as canvas displays
  uploaded at most 20 times a second via `makeDisplay()` - never a texture upload per
  frame.
- **`effects.js`** - the LOOK of exhaust, tyre smoke, dust, spray, sparks and fire on
  top of the engine's particle system (`src/particles.js`, read-only: its header is
  the API).

Still read-only: `src/aircraft/` (which model ships, the glTF fit, the animation),
`src/cockpit.js` (the render path and the state object), `src/particles.js`,
`src/camera.js`, `src/main.js`. If the contract lacks something you need, say so in
your answer and stop; do not reach outside `src/art/`.

Three traps from earlier passes, which the engine now checks for:

1. **Keep every file's header.** It is the specification. Replacing it with dense
   one-line code broke the next pass; `npm test` now fails when a header goes missing.
2. **Do not declare shader uniforms named `at*`** (`atSun`, `atZenith`, ...).
   `SkySystem.installFog()` injects those into every fogged material, and a
   redeclaration is a shader that does not compile - an aircraft that is silently not
   drawn. Prefix anything of your own.
3. **Never cache materials across calls** in a module-level Map: a material belongs
   to one scene, and the sky patches it once per scenario; a survivor is patched twice
   and stops compiling. Cache textures only, and NAME every material
   (`material.name = 'skylark:xxx'`) so an error identifies itself.

Budgets at the high quality tier (honour `ctx.detail` below it): an exterior at most
60k triangles and 20 draw calls (the airliner 24: `docs/PERF.md` asked for 12, but six
control surfaces, three legs with a moving strut and a spinning wheel each and the
propeller are 13 draws before any static mesh; 20 is what merging everything else
leaves), an interior at most 80k triangles and 20 draw calls -
share materials, merge static geometry per material, keep a separate mesh only for
what moves. Procedural canvas textures at most 2048 px, drawn once and cached. No
per-frame allocations, no `Math.random` (the seeded helpers in `src/config.js`).
