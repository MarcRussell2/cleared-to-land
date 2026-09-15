# CLEARED TO LAND — Design & Build Plan

*Every flight is the last three miles.*

A 3D airplane **landing** game. Every level starts you on approach; the whole game
is the last three miles. Honest flight physics with a real stall, crosswinds that
push you off the centerline, heavy jets that don't want to slow down, systems that
fail on short final, carrier traps with a tailhook and four wires, and bush strips
where the runway is a gravel bar between the trees.

## 1. Goals

| Goal | What it means in the game |
|------|---------------------------|
| Landing is the game | Spawn on final at 2–8 NM. Score the touchdown, rollout, and stop. Go-arounds allowed. |
| Honest stall | Lift curve with a real CLmax and post-stall break. Slow down too much and the nose drops, a wing drops, controls go mushy, and the horn blares. Recovery needs nose-down + power. |
| Crosswind | Wind vector with gusts, turbulence, and a gradient near the ground. Crab on approach, de-crab in the flare, wing-low. Side load on touchdown is scored. |
| Heavy planes | 60-tonne twin jet: inertia, spool lag, Vref ~140 kt, spoilers, reverse thrust, autobrake, tail-strike pitch limit, long-landing penalty. |
| Malfunctions | Engine failure (dead-stick), flap failure, gear stuck, brake failure, hydraulic degradation, asymmetric thrust, jammed elevator (trim + power), wing icing (stall speed up). |
| Carrier | Moving ship, angled deck, pitching/heaving deck, tailhook, 4 arresting wires, meatball (IFLOLS), bolters, LSO grade. Day and night. |
| Bush | Short gravel/dirt strips, obstacles on approach, rough surfaces, slope, tundra tires. |
| Feel nice | Real sky/sun model, fog, water, shadows (helps judge height in the flare), bloom, animated gear/flaps/surfaces, tire smoke, sparks, gamepad support, synthesized engine/wind/horn audio, altitude callouts. |
| Seamless | Double-click `PLAY.cmd` (or `CTL.html`). No install. Also published as a web link. |

## 2. Technology

- **Three.js** (r169) for rendering, bundled with **esbuild** into a single self-contained HTML file.
- Plain JavaScript ES modules. No framework. Everything procedural (aircraft meshes, textures, terrain, audio) so the game is one file with zero external assets.
- Physics: custom 6-DOF rigid body (SI units internally) with a coefficient-based aero model, spring-damper landing gear, friction-circle tires, moving-deck ground query and arresting-wire model.
- Tests: `npm test` runs a headless Node harness that trims each aircraft, flies an automated approach, checks stall speeds and landing behaviour numerically.

Why not Unreal / Unity / Godot: those need account sign-ins and GUI editors that
can't be driven unattended, and visual iteration needs screenshots. The browser
build can be screenshotted and inspected at every step, runs on anything, and
can be published as a link. The physics module is engine-agnostic if a port is
ever wanted.

## 3. Folder layout

```
CTL/
  PLAY.cmd            double-click to play (opens CTL.html in an app window)
  CTL.html        the whole game in one file (built)
  README.md           controls, tips, how to build
  package.json
  docs/PLAN.md        this document
  docs/PHYSICS.md     flight model notes and sources
  tools/build.mjs     esbuild bundle + single-file packer + dev server
  tools/test-physics.mjs   headless physics tests / autopilot flights
  src/
    main.js           bootstrap, game state machine, main loop
    config.js         constants, units
    input.js          keyboard + gamepad -> control inputs
    camera.js         chase / cockpit / tower / fly-by cameras
    audio.js          Web Audio synth engine, wind, horns, callouts
    physics/aero.js       lift/drag/moment coefficient model incl. stall
    physics/aircraft.js   rigid body, gear, engine, systems, hook
    physics/wind.js       wind, gusts, turbulence, gradient
    aircraft/defs.js      aircraft data (4 types)
    aircraft/models.js    procedural meshes with animated parts
    world/terrain.js      heightmap terrain, trees
    world/airport.js      runways, markings, PAPI, lights, windsock
    world/carrier.js      ship, deck motion, wires, IFLOLS
    world/sky.js          sky, sun, fog, water
    world/effects.js      smoke, sparks, spray
    systems/scenarios.js  the challenge list
    systems/malfunctions.js
    systems/scoring.js    landing grading
    ui/hud.js, ui/menus.js
```

## 4. Aircraft roster

| Aircraft | Role | Mass | Vref | Notes |
|----------|------|------|------|-------|
| Skylark 172 | Light trainer | 1,050 kg | 62 kt | Forgiving, but stalls at 48 kt clean / 42 kt flaps. |
| Trailblazer | Bush plane with tundra tires | 800 kg | 48 kt | Big flaps, huge drag, lands in 120 m. |
| Condor 700 | Twin-jet airliner | 55–66 t | 135–145 kt | Spool lag, spoilers, reversers, autobrake, tail-strike limit. |
| Sea Hornet | Carrier fighter | 15 t | 135 kt | Tailhook, on-speed AoA 8°, 3.5° glideslope, no flare. |

## 5. Scenarios (challenges)

1. First Solo — calm, long runway, Skylark (tutorial with hints)
2. Crosswind 15 — 15 kt at 70° off the nose
3. Gusty — 22 kt gusting 32, turbulence
4. Heavy Metal — Condor at max landing weight, 2,000 m runway
5. Short & Heavy — Condor, 1,600 m runway, must use everything
6. Dead Stick — Skylark engine quits at 2,500 ft, glide to the runway
7. No Flaps — Condor flapless: fast, flat, floaty
8. Nose Gear — nose gear won't extend; hold the nose off
9. One Engine — Condor loses the left engine on short final
10. Jammed Elevator — pitch with trim and power only
11. Ice — wing icing; stall speed up 12 kt, horn is late
12. Brake Failure — reverse thrust and aero drag only
13. Fog — 600 m visibility, fly the ILS needles
14. Slow Flight — start 5 kt above stall, don't stall, land
15. Stall Recovery — take over at 850 ft while the previous pilot holds it stalled; recover, then land
16. Carrier Qual — day, calm sea
17. Night Trap — night, pitching deck
18. Bush: Gravel Bar — 350 m river bar, trees on final
19. Bush: One-Way Strip — uphill mountain strip, no go-around
20. Roulette — random aircraft, wind, and a random failure

Plus **Free Flight** (pick aircraft, airport, wind, weight, failures, time of day).

## 6. Scoring

Touchdown: vertical speed (fpm), distance from aiming point, centerline offset,
crab angle / side load, bank angle, speed vs Vref, nose-wheel-first, tail strike,
bounces. Rollout: stayed on the runway, stopped before the end, gear/tire damage.
Carrier: wire caught (3 is best), glideslope and lineup at the ramp, AoA on speed.
Grades: CLEARED TO LAND / SMOOTH / FIRM / HARD / DAMAGED / CRASH. Best score per scenario
saved locally, stamped with a logbook name the browser remembers (asked for on a new
best; changeable there or in Settings).

## 7. Build order

1. Scaffolding, build tool, physics core, headless tests — done
2. World, aircraft meshes, camera, HUD — fly and land the Skylark — done
3. Scoring, debrief, menu, scenarios — done
4. Wind/crosswind, heavy jet, malfunctions — done
5. Carrier (ship, deck motion, hook, wires, meatball), bush strips — done
6. Audio, effects, polish, gamepad, packaging (PLAY.cmd, single file), web publish — done

Verification: `npm test` (control signs, stall speeds, dynamic stall, autoland for all
four aircraft, glide ratio), `node tools/test-carrier.mjs [seaState] [windKt]` (full
carrier trap), and in-browser `game.setAutopilot(true)` runs of every scenario type.

## 9. Ideas for later

- Replay of the last 20 seconds from the tower camera after each landing.
- More airports (high-altitude, wet runway with lower friction, night airport).
- Floatplane on the river, helicopter-less; a tailwind/downwind landing challenge.
- Leaderboard export (copy score card as text).

## 8. Sources used

- Nimitz-class deck geometry (4 wires ~40 ft apart, 9° angled deck, ~658 ft landing area):
  https://dcs.man-sim.org/en/sc/02.nimitz/ , https://science.howstuffworks.com/aircraft-carrier4.htm
- F/A-18 carrier approach (on-speed 8.1° AoA, 3.5° glideslope, ~135–145 kt):
  https://www.aopa.org/news-and-media/all-news/2017/april/pilot/aircraft-carrier
- 737-800 landing (MLW 65,315 kg, Vref30 mid-130s to high-140s kt):
  https://aviationinfo.net/boeing-b737-800-approach-speeds-standard-approach-profile/
- Post-stall aero modelling (flat-plate blending, GA post-stall):
  https://m-selig.ae.illinois.edu/pubs/AnandaSelig-2016-AIAA-Paper-2016-3541-GA-PostStallModeling.pdf
- C172 stability derivatives: Roskam / Napolitano "Aircraft Dynamics" dataset (public domain numbers).

## 10. Changes after release (2026-09-10)

- Pitch is flight-stick style (down/back = nose up); Settings > Invert pitch swaps it.
- Handling pass (quicker, better damped, less self-levelling): `docs/PHYSICS.md`.
- Hinged control-surface panels on the downloaded models (`src/aircraft/surfaces.js`, measured hinge
  lines in `models.js`). The Trailblazer model is a biplane.
- Persistent orbit camera (right-drag / `,` `.` / wheel zoom / `0` reset), the whole sphere around the
  airplane down to knee height above the ground; the same drag turns your head in the cockpit and wing
  views and the wheel zooms the tower and fly-by views.
- Gravel Bar: a wall of spruce across short final; you clear it and drop in.
- Build stamp in the menu header; the site serves the game with no-cache.
- Deploy: `npm run web` writes the hosted copy (`web/`); how to host it is in `web/README-HOSTING.md`.
- Yaw pass (2026-09-14, branch `yaw`): the rudder can no longer put the airplane sideways or stall it, the
  assist mode has a real yaw damper / turn coordinator / aileron-rudder interconnect, two rudder derivatives
  had the wrong sign. Numbers and sources in `docs/PHYSICS.md`, player summary in `docs/CHANGELOG.md`,
  guarded by `tools/test-yaw.mjs`.
- The world's look rebuilt from the ground up (2026-09-14, branch `visuals-world`): a scattering
  sky with a radiance budget, chunked LOD terrain with real fields, shaped trees with per-instance
  levels of detail and hedgerows, a baked-wave sea, aerodromes and the carrier redrawn, every scene
  cheaper than before (the plains site 365 -> 138 draw calls, 4.8 M -> 0.4 M triangles). The art
  bench is split into fenced modules (`src/art/world-*.js`, `quality.js`); the cost is measured by
  `tools/world-probe.mjs`. Full account: `docs/CHANGELOG.md`.
- Phones and tablets (2026-09-10, evening): `src/touch.js` puts a floating stick, throttle and rudder sliders
  and the aircraft's buttons on screen when the device is a touch screen; the HUD gets a compact layout
  (`#hud.compact` in `style.css`); the whole left side of the screen is the stick, with a dimmed one resting
  where a thumb falls (2026-09-11: it used to be a narrow band in the corner and most of the left side was dead);
  Settings > Tilt to fly adds the phone's own attitude as a second source for pitch and roll;
  a visual pass on 2026-09-12 moved the THR and RUDDER labels out from under their own knobs, shrank the
  config strip to its text, gave the pause dialog a panel and put the touch controls on the HUD's border language;
  since that evening the stick sits under the right thumb by default, everything else under the left
  (Settings > Stick for the original side);
  hints and briefing tips are rewritten to name the buttons (`touchify`);
  quality tiers scale shadows, pixel ratio and forest density for touch devices, and a dynamic quality
  controller (since the 2026-09-14 performance pass, `docs/PERF.md`) scales the render resolution and the
  post-processing to the frame time; landscape is enforced with a rotate prompt; the web package carries a web-app manifest
  and icons so Android installs it as a full-screen landscape app. Verified headless with the website repo's
  `tools/ctl-shots/mobile.mjs` (touch emulation over the DevTools protocol).
- The aircraft, rebuilt (2026-09-14, branch `visuals-aircraft`): each airframe's exterior is a module on the
  art bench (`src/art/airframes/<id>.js`, `buildAirframe(def, ctx) -> { group, parts, anchors, bounds }`) with the
  downloaded glTF models kept as a per-aircraft fallback (`SHIPS` in `src/aircraft/models.js`); a cockpit interior
  per aircraft (`src/art/cockpits/<id>.js`, `buildCockpit(def, ctx) -> { group, parts, update(state), look }`) drawn
  by `src/cockpit.js` on its own render layer with a 0.03 m near plane, fed the flight state every frame, with
  per-aircraft head-turn limits; a particle engine (`src/particles.js`: pooled sprites, sub-frame emission from
  moving anchors, wind advection) under `src/art/effects.js`, which now owns the exhaust per engine (idle haze, the
  throttle puff, jet soot, a failed engine's stream) as well as tyre smoke, dust, spray, sparks and fire; the
  navigation lights as one `Points` per aircraft. `tools/test-art.mjs` builds all of it in Node and checks the
  contracts; the game repo's `tools/surfshot.mjs` shoots the interiors. Details: `docs/CHANGELOG.md`.
