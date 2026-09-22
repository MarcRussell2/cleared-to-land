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
    world/obstacles.js    course resolution, swept collision, gates
    world/sky.js          sky, sun, fog, water
    world/effects.js      smoke, sparks, spray
    systems/scenarios.js  the original 20 challenges and 6 sites
    systems/malfunctions.js
    systems/weather.js    storms, squalls, microbursts, snow, dust (the model)
    systems/failureEffects.js  failures that need no physics edit, and their drills
    systems/mission.js    per-mission runtime: gates, extra scoring, hints, status
    systems/routepilot.js waypoint pilot; hands over to Autoland on the final
    systems/scoring.js    landing grading
    missions/             challenges 21-49, the new places, the free-flight builder
    art/                  what the world LOOKS like (src/art/README.md is its contract)
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

49 of them, in the menu's twelve groups (`MISSION_GROUPS` in `src/missions/index.js`, which is the
one order the rail, the home screen and the debrief's Next all follow). 1–20 are the original list
in `src/systems/scenarios.js`, untouched; 21–49 came with the missions expansion (§11) and live one
file per group under `src/missions/`. The number is the mission's permanent `n`.

**Basics**
- **1** First Solo — calm, long runway, Skylark (tutorial with hints)
- **2** Crosswind 15 — 15 kt at 70° off the nose
- **3** Gusty — 22 kt gusting 32, turbulence

**Heavy iron**
- **4** Heavy Metal — Condor at max landing weight, 2,000 m runway
- **5** Short & Heavy — Condor, 1,600 m runway, must use everything
- **7** No Flaps — Condor flapless: fast, flat, floaty
- **13** Fog — 600 m visibility, fly the ILS needles

**Something broke**
- **6** Dead Stick — Skylark engine quits at 2,500 ft, glide to the runway
- **8** Nose Gear — nose gear won't extend; hold the nose off
- **9** One Engine — Condor loses the left engine on short final
- **10** Jammed Elevator — pitch with trim and power only
- **12** Brake Failure — reverse thrust and aero drag only
- **11** Ice — wing icing; stall speed up 12 kt, horn is late

**The stall**
- **14** Slow Flight — start 5 kt above stall, don't stall, land
- **15** Stall Recovery — take over at 850 ft while the previous pilot holds it stalled; recover, then land

**Boat**
- **16** Carrier Qual — day, calm sea
- **17** Night Trap — night, pitching deck

**Bush**
- **18** Bush: Gravel Bar — 350 m river bar, trees on final
- **19** Bush: One-Way Strip — uphill mountain strip, no go-around

**Storms** (`src/missions/weather.js`)
- **21** Squall Line — the gust front hits half a mile out: 60° shift, 20 gusting 30, wet runway
- **22** Microburst — a downburst parked on the approach 2.5 km out; fly through it or go around
- **23** Storm Trap — a thunderstorm over the ship, 800 ft ceiling, the deck heaving two metres
- **24** Night Storm Trap — Night Trap plus the storm, the lightning and a four-metre ramp
- **25** Thunderstorm — start inside the cloud at dusk; fly the ILS out of it

**Things break** (`src/missions/failures.js`)
- **26** Stuck Throttle — throttles jam at 75%; hang out every bit of drag, cut the fuel over the runway
- **27** Runaway Trim — the stabilizer runs nose down; cutout, hold, wind it back
- **28** Bird Strike — one through the windshield, one down an engine that surges from then on
- **29** Unreliable Airspeed — the pitot ices over and the IAS lies, slowly
- **30** Belly Landing — the gear will not come out; slow, level, engines already off
- **31** Engine Fire — fire bell at 1,100 ft; pull the handle, land on one
- **32** Jammed Aileron — nothing from the stick sideways; roll with the rudder
- **33** Dark Cockpit — alternator and battery die at night: a torch and the runway lights
- **34** One Wheel — the left main is a stub; hold the wing up while it flies
- **35** No Ball — the carrier's lens is dark; the LSO is all you have

**In the way** (`src/missions/obstacles.js`)
- **36** Power Lines — a high-voltage crossing on short final, the lowest wire at 17 m
- **37** The Notch — a 30 m gap in a 40 m spruce wall, then 340 m of gravel
- **38** Harbor Cranes — up the container port at crane height, under a lowered boom

**The city** (`src/missions/city.js`, at Metro City)
- **44** Checkerboard — aim at a board on a hill, turn 45° right onto a hidden runway
- **45** Downtown — three kilometres down Grand Avenue below the rooftops, under two skybridges
- **46** Slalom — three pairs of skyscrapers, 800 m apart, on the glideslope
- **47** Under the Bridge — under the Harbor Bridge deck at a hundred feet
- **48** The Needle — onto final through a 34 m gap between two towers, in a 35° bank
- **49** The Gauntlet — four of the above in one approach, at night, in a thunderstorm

**Far places** (`src/missions/maps.js`)
- **39** Hill Hop — over the col at Kestrel Island, then 6.5° down onto 650 m
- **40** Beach Buzz — the airliner across Paradise Bay's beach at fifteen metres
- **41** Mesa Top — 500 m of dirt on a 150 m cliff, in the shear pouring over the rim
- **42** Whiteout — 900 m visibility, blowing snow, a ploughed ice runway
- **43** Dust Wall — a haboob across the mesa strip: seven kilometres to one

**Chaos**
- **20** Roulette — random aircraft, wind, and a random failure

Plus **Free Flight** (aircraft, place, a weather preset and its advanced drawer, time of day,
visibility, cloud base, weight, where the approach starts, any malfunction the aircraft can have
and when it fires, and obstacles on or off).

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
- Floatplane on the river, helicopter-less; a tailwind/downwind landing challenge.
- Leaderboard export (copy score card as text).

Built since this list was written: **more airports** — six new places in §11, including a
high-altitude strip (Red Mesa, 1,480 m), runways wet enough to lose 40% of their grip (the storms)
and one made of ice (Frostbite Lake); and the **shared leaderboards** (a career board and one per
challenge, `src/systems/leaderboard.js`, live 2026-09-17).

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
- Gravel Bar: a wall of spruce at the end of the gravel (35 m, no gap, since 2026-09-22; 24 m and 150 m out
  before that); you clear it and get down in what is left, with a slip.
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

## 11. The missions expansion (2026-09-19)

Twenty-nine new challenges (21–49) in five new groups, six new places and a new home screen. The
rule the whole thing was built under: **nothing in `src/physics/`, `src/aircraft/defs.js`,
`flightControl.js`, `autopilot.js` or `scoring.js` was edited.** Every new system wraps them from
outside, and the original twenty are byte-for-byte the flights they always were (the suites fly
them at a pinned seed and compare). `src/missions/README.md` is the contract: the scenario fields,
the runway frame every course and route is written in, the engine interfaces, and the determinism
rule (everything random draws from the flight seed, never `Math.random()`, and never an extra draw
from the rng `resolveScenario()` uses, or a pinned-seed replay of an old challenge changes).

- **The weather model** (`src/systems/weather.js`). A scenario's `weather` spec gives
  precipitation, overcast darkness, a cloud base, lightning, a sea state, and scheduled *events* on
  the approach: a gust front, a squall, a wind shift, a turbulence burst, a visibility drop, and a
  microburst (the Oseguera–Bowles analytic downburst — a Gaussian core whose downdraft is zero at
  the ground and grows with height, with a continuity-satisfying outflow peaking 30–100 m up; it
  rains itself out, so going around and coming back is a real choice). It never edits the physics
  wind: it ramps the `Wind` object's public fields for slow changes and adds a local overlay in m/s
  through `addWind()` for the rest, O(1) with an early exit because it runs per particle. A spec
  with no events writes nothing at all. The look is `src/art/weather-look.js` and the sound
  `src/audio-weather.js`; both read `state` and nothing else. Visibility has one meaning everywhere
  (`src/missions/README.md` § Visibility): the number in the text is the number on the kneeboard is
  the number out of the window.
- **The obstacle engine** (`src/world/obstacles.js`). `plan()` turns a site's and a mission's
  `course` — towers, blocks, masts and guy wires, sagging cables, power lines with marker balls,
  bridges you fly under, cranes, ships, quays, container yards, tree walls — from the runway frame
  into world volumes; the look draws each one from the same numbers (3–5 instanced draws for a whole
  course) and `tools/test-obstacles.mjs` proves *what is drawn solid is what collides*. Collision is
  **swept**: every probe sphere of the airframe (`src/aircraft/hulls.js`: nose, tail, fins, wing and
  tail surfaces, nacelles, flaps that move with the flap, wheels while down) is swept from the
  previous frame's pose to this one against the volumes near the path, through a 48 m grid and
  per-cluster bounds, so nothing tunnels at 250 kt with the 0.1 s frame clamp — a 12 cm cable is
  caught, and a 0.6 m mast cannot slip between two probes on the Condor's wing. 1–3 µs a frame on
  average. The course is deliberately **not** in the physics ground query: radio altitude, ground
  effect, the flare law and the callouts all still read the terrain, and nobody lands on a roof.
- **Gates** are markers, never solid, flown in array order: passed when the CG crosses the plane
  inside the frame, missed when it crosses outside it and the gate is due, and a go-around mends a
  miss. A required gate missed caps the landing at 30 with the grade MISSED GATE; a bonus gate adds.
  A pass within 5 m of an obstacle gets a callout, and the debrief quotes the closest shave.
- **RoutePilot** (`src/systems/routepilot.js`). Waypoints in the runway frame with optional arcs,
  speeds and bank limits; it flies the route, joins the extended centreline and Autoland's glide
  path, and hands over once lined up, on path, on speed and level — or six seconds before the aim
  point at the latest. It exists because Autoland is obstacle-blind: it is what `game.setAutopilot`
  uses at a mission with a route, and it is how every course is proved flyable headless.
- **The mission runtime** (`src/systems/mission.js`) wraps `scoreLanding`'s result with gate lines,
  a failure's own scoring, the HUD status line and the per-mission hint.
- **The failure runtime** (`src/systems/failureEffects.js`) applies every failure that needs no
  physics edit — jammed or biased controls, runaway trim, a stuck throttle, partial engine power,
  a leg fault, iced instruments, a dark panel, fire and smoke — from outside the aircraft, between
  the flight control and the physics step. Three of them need the pilot to do a drill: the fire
  handle (A), the trim cutout (D) and the fuel cutoff (U), offered on the controls strip, on a
  phone button, and on a gamepad's right-stick click.
- **The new home screen**, "Three Doors" (`src/ui/menus.js`): three tall doors over the live
  airfield — AIRCRAFT, MISSIONS, FREE FLIGHT — and a quieter fourth for settings, controls and the
  logbook. It lists whatever the registries contain and names no mission; the mission browser is
  built from `MISSION_GROUPS`, the city group is drawn as a ladder of rungs, and difficulty is pips.
  Free flight became a four-step builder over `src/missions/free.js` (a pure module, no DOM, tested
  in Node), which tells you what each choice rules out and can switch obstacles off entirely.
- **The art bench's city** (`src/art/city-look.js`, facade shader in `src/art/city-facades.js`,
  fenced by `src/art/AGENTS.md` as the rest of the bench is). Three Codex passes built Metro City's
  look — curtain walls, painted flats and roofs, a carpet of lit windows at night, the avenue's
  lamps, then the day facades — against a drawing contract in the file's header and a budget the
  suite enforces: at most 60 draws, 450k/250k/120k triangles a pass, 6 programs counted by variant.
  Neither the flying nor the budget changed across the passes.
- **Proving it.** `npm test` grew `test-weather`, `test-failures`, `test-maps`, `test-obstacles`,
  `test-city` and `test-free`, all plain Node with real physics and no renderer;
  `tools/fly-mission.mjs` flies one mission either in Node or in the real page (headless Edge,
  the game's own autopilot), takes stills from named cameras and lists any shader compiled after
  the first frame — there must be none mid-flight.
