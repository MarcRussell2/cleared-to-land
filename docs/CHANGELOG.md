# Changelog

Newest first. Player-facing lines first in each entry, then the developer notes. The flight-model
details behind each entry live in `docs/PHYSICS.md`.

## 2026-09-23 - the city without gates

Build **2026-09-23T20:10:06Z**, **LIVE** (deployed 2026-09-24 11:29 MDT on Marc's "deploy"; `npm test` green, six
checks green, then Harbor Cranes and the Needle flown headless on the live page and landed). Marc: "continue" - the rule from the day before ("no boxes; force the obstacle because there is
no other easier way"), applied to the last place that still used gates: the six rungs of the city.

- **Checkerboard.** The inside of the corner is a new district of 220-300 m towers, kept 130 m clear
  of the run-in, the turn and the final. Cutting the corner, turning early or heading straight for the
  runway from the start is a wall; flying on at the board is still the hill. The start is 2.5 km before
  the turn instead of 4.2.
- **Downtown.** The two skybridges are gate buildings now, 500 m tall with an archway each (100 m and
  82 m up), and the second row behind the avenue is 200-320 m. You start 700 m short of the avenue at
  220 ft. There is no over and no round: under both archways, then up onto the glideslope.
- **Slalom.** A canyon of 400 m walls 288 m apart, with three cross-walls and one 56 m slot in each,
  60 m right, left and right of the centerline. You start inside it at 370 ft; the slots are the only
  way through.
- **Under the Bridge.** Not the Harbor Bridge any more: the Coast Road's viaduct 1.2 km out, a deck
  70 m up, four 300 m pylons and a mesh of stays over the deck from end to end. You start 450 m short
  of it at 150 ft; under the deck between the middle pylons is the only way.
- **The Needle.** The eye is exactly what it was (34 m between the towers, flown banked 35 degrees),
  but it stands at the end of the Crescent: a curved canyon of 300 m towers on the waterfront 1.9 km
  out that narrows to the gap and opens again onto the final. You start inside the Crescent, 800 m
  short of the turn, at 250 ft.
- **The Gauntlet.** The Crescent out in the bay (the eye 7 km out, a 1.6 km mouth), the Harbor Bridge
  under or over, a canyon with two slots that runs on into Grand Avenue and its gate building, at
  night in the storm.
- No gates anywhere in the game now: no gate count on the HUD, no MISSED GATE, no bonus. A landing is
  a landing; a wrong line is a crash.

### Developer notes

- `src/missions/city.js` rewritten around geometry: `needleGeom(aimU, mouth)` (the eye, the turns, the
  director's circle, the start, "past the eye"), `crescent()`, `canyon()`, `avenueCourse()` with
  `GATE_TOP` slabs, `viaduct()` (a `box` deck, `tower` pylons, 128 `cable` stays whose fans cross),
  `cbCourse()` (a district in the corner plus `clear` circles along the line), `tallRow()`. Hints read the
  geometry (`pastEye`, `slotHint`, `gateHint`), not `mission.next()`. Nothing in the engine changed.
- `tools/test-city.mjs` (305 checks): the courses' numbers (the archways and their 500 m tops, the
  canyon's slots to the metre, the viaduct's mesh sampled at 90 and 150 m over the reachable 440 m of
  deck - nowhere a wingspan fits, the corner's towers with the line 137 m clear), the Needle's geometry
  for both eyes, RoutePilot on ten seeds per rung (a landing every time; medians 61 / 63.5 / 75 / 86.5 /
  91.5 / 76.5), 21 wrong lines that all end in a "Hit" (straight in on the glideslope, over, round, a
  full pull-up from the start, wings level through the eye, a turn too tight, straight past the mouth),
  the autopilot resumed 300 m before the eye, and the hint-following pilot: 10 of 10 through the Needle's
  eye, 7 of 10 through the Gauntlet's in its gusts.
- Two things learned: RoutePilot needs a straight to settle onto its own circle after a start on the
  pilot's line (600 m in the Needle's 5 kt, 1,600 in the Gauntlet's 18-kt gusts - the Crescents' mouths
  are that long for it), and an eye must stand well before anything that has to be flown low right
  after it (the Gauntlet's moved from 6.5 to 7 km out when a pilot handed over at the eye hit the bridge).

## 2026-09-22 (evening) - Harbor Cranes: the basin

Build **2026-09-22T21:29:42Z**, shipped inside build 2026-09-23T20:10:06Z (**LIVE** 2026-09-24 11:29 MDT, after a
two-day wait on the server). Marc: "do the harbor next, no gates".

- **Harbor Cranes** has no gates and no choice of line. It is a container basin now: two quays 170 m
  apart, five ship-to-shore cranes on each, every boom lowered to 50 m over the water and reaching
  past the middle of the basin from both sides, a ship alongside each quay. You start inside it,
  100 m before the first boom, at 100 ft and 150 kt. There is no climbing out: the fin has to stay
  under the booms, and above them each crane's stays block the way up to about 180 ft, so getting
  out means gaining 80 ft between two cranes a second and a half apart, which an airliner cannot
  (eight timed full pull-ups all end in a boom or a stay). There is no room to turn either: the quays
  are 85 m out and a 40-degree bank moves the airliner 150 m sideways only after 500 m. So it is the
  lane to the end of the basin, then the S-turn onto the 400 m final as before.

### Developer notes

- `src/missions/obstacles.js` (the basin: two quays, ten cranes with `boom: 0` and 105 m of outreach,
  the mole's cranes at `rot: 180`, four container yards, two ships; the route up the basin at 24 m)
  and `tools/test-obstacles.mjs` (ten booms every 100-125 m all across v 1185, undersides 50 m over
  the water, no gates, the start 100 m before the first; the ways out flown: a climb-out route, the
  obstacle-blind Autoland, a drift out over the mole, and eight pull-ups timed 0.5 to 4 s after the
  start - every one a "Hit"). RoutePilot 79 / 69, passing the booms with 4.5-4.9 m to spare.
- Of the three "In the way" missions none has a gate now; the gate engine stays for the city ladder.

## 2026-09-22 (later) - no boxes: the obstacle is the rule

Build **2026-09-22T20:11:46Z**, live the same afternoon. Marc, playing the morning's build: Power Lines
"you spawn really far and low", and The Notch "shouldn't have a box that you're supposed to fly
through ... force the user to fly through the obstacle because there's no other easier way to do it".

- **The Notch.** No gate. The spruce are giants now, 85 m tall, and the notch in their canopy is
  28 m left of the strip, with the crown of the tree beside the centerline covering the whole strip:
  through the notch is the only way onto the bar. Over the top there is no bar left (from 90 m up
  the Trailblazer touches 340 m in, and even a full slip touches 260 m in and overruns); straight
  in is a tree; round the end is 120 m of side-step with nowhere to do it. Out of the notch: a
  jink right onto the gravel, idle, and down by the 170 m mark.
- **Power Lines.** The start is an ordinary approach, 900 m out on the glideslope, instead of
  2.6 km out at 50 ft. The glideslope runs through the wires at the threshold, so the mission is
  the decision: over the top at 130 ft and a dive, or under at 35 ft after a four-metre slot over
  the pole line by the road.

### Developer notes

- `src/missions/obstacles.js` (the two missions; the Moose Creek Notch site's aim point 170 m and
  one scattered spruce moved off the run-in) and `tools/test-obstacles.mjs` (the-notch: no gate, an
  85 m wall whose last row covers the strip, over the top must end off the bar; power-lines: the
  start on the glideslope, a level run at wire height, the spawn's clearance from the path height).
  Nothing else. `npm test` green, all suites; both flown in the real page.
- The rule, from Marc: an obstacle mission's obstacle forces the line by itself - no gate - and
  the proof is the wrong lines ending badly (`tools/test-obstacles.mjs` section 7), not a box the
  pilot must cross. Harbor Cranes (three gates) and the city ladder (gates everywhere) still use
  boxes; their rework waits on his word (an idea for the harbor: a basin with cranes on both quays,
  every boom lowered, and the airliner started under the first one - it cannot climb out between
  booms, so the lane is the only way).

## 2026-09-22 - the obstacle, then the runway

Build **2026-09-22T18:16:13Z**, live the same day. Four missions and five failures rearranged so the
thing in the way is where the runway begins, on Marc's word after playing them: "it should be the
obstacle and then immediately the runway".

- **Bush: Gravel Bar.** The wall of spruce stands at the end of the gravel now - 35 m tall, no gap,
  the strip starting at the foot of the trees - instead of 150 m before it. Idle and full flap bring
  the Trailblazer down at 13 degrees from the crossing, which is 180 m of the 340 gone before the
  wheels touch; a forward slip (rudder one way, aileron the other) makes it 130. The aiming mark is
  130 m in. Free flight at the bar has the same wall (the Obstacles switch removes it). Four pips.
- **The Notch.** The forest edge stands right at the threshold, 40 m tall. Out of the notch the bar
  is already under you, 16 m to your right: a jink, idle, and down. Five pips.
- **Harbor Cranes.** The container port is 2.4 to 3.9 km out instead of 5 to 7, and there is no
  straight final after it: out of the exit gate it is an S-turn at 150 ft, 27 degrees of bank each
  way, that rolls out on the centerline 400 m from the threshold with the glideslope meeting you.
- **Power Lines.** The pylons cross 120 m before the threshold instead of 600. Over the top means
  130 ft over the numbers and getting down from there; under means 35 ft between the pylons; the
  glideslope itself runs through the wires. Three pips.
- **Things break.** No long run-in before the trouble: the engine fire bell goes at 600 ft two miles
  out (was 1,100 ft and four), and the belly landing, runaway trim, bird strike and unreliable
  airspeed start 2.6 to 5.2 km out instead of 5 to 7.2.

### Developer notes

- Mission data and tests only: `src/missions/{obstacles,failures,util}.js`, `SITES.gravelbar` and the
  Gravel Bar's text in `src/systems/scenarios.js`, `CLASSIC_DIFFICULTY`, `tools/test-obstacles.mjs`.
  Nothing in `src/physics/`, `defs.js`, `flightControl.js`, `autopilot.js` or `scoring.js`.
- The Gravel Bar's wall is a course on the site (the obstacle engine: solid, swept, and not in the
  ground query, so the radio altimeter reads the bar under it), no longer `obstacleTrees` in the
  terrain; it is the one original site with a `course`, and Bush: Gravel Bar the one original
  challenge that builds an `ObstacleField`. Its aim point is 130 m (Moose Creek Notch's 120).
- Sizing was measured, not guessed: a scripted pilot flew the Trailblazer over walls of 27, 32, 37
  and 42 m at the threshold, at idle holding Vref, with and without a full forward slip (the model's
  slip is `CDbeta` drag plus the cos^2 lift loss in `aero.js`; full pedal steepens the idle descent
  from 13 to 16-18 degrees). Harbor City's coast was probed (v 945-1085 along the approach) before
  the harbor moved, so the ships still float.
- `sCurve()` (two tangent arcs for RoutePilot) lives in `src/missions/util.js` now; the harbor's exit
  is one. `npm test` green, all suites; the three obstacle missions, the Gravel Bar and the five
  failures were then flown in the real page.

## 2026-09-19/20 - twenty-nine new challenges: storms, harder failures, things in the way, a city, four new places

Build **2026-09-20T02:25:02Z**. The challenge list goes from 20 to **49**, in five new groups, and
the home screen is rebuilt around them. The original twenty are untouched - same flights, same
numbers, same scores.

- **Storms** (5). Weather is a model now, not a backdrop: rain, snow and dust, an overcast that
  dims the world, a cloud base you come down through on the needles, lightning that costs you your
  night vision, a sea state for the ship - and things that happen to you on the way down. A squall
  line's gust front swings the wind 60 degrees half a mile out. A microburst gives you a few free
  knots and then takes three thousand feet a minute for them; it rains itself out in about two
  minutes, so going around and coming back is a real choice. Rain wets the runway and about 40% of
  the grip goes with it.
- **Things break** (10). Ten failures you have to *do* something about: an engine fire, a throttle
  jammed at climb power, a stabilizer trim running away nose down, a pitot tube icing over so the
  airspeed lies to you slowly, a bird through the windshield and another down an engine, a jammed
  aileron, the whole electrical system dying at night, a main wheel that is simply gone, a gear
  that will not come out, and a carrier lens gone dark. Three new keys go with them - **A** the
  fire handle, **D** the trim cutout, **U** the fuel cutoff - live only while the failure that
  wants them is, and named on the controls strip, on a phone button, and on a gamepad's right-stick
  click. The cutoff asks twice above 300 ft and once in the flare, where the drill actually uses it.
- **In the way** (3). Power lines across short final, a 30 m notch in a wall of spruce, and a
  lowered crane boom over the harbour lane. Things in the way are solid now: every probe point on
  the airframe is swept from last frame to this one, so a 12 cm cable is caught at 250 kt. Pass
  within five metres of something and you are told how close; the debrief quotes the closest shave.
- **The city** (6). Metro City, and a ladder of six rungs: aim at a checkerboard on a hill and turn
  right onto a runway that was hiding behind the apartment blocks; fly three kilometres down Grand
  Avenue below the rooftops and under two skybridges; weave through three pairs of skyscrapers;
  go under the Harbor Bridge at a hundred feet with nine metres of fin above you; turn onto final
  through a 34 m gap between two glass towers in a 35-degree bank, in an airliner 35 m across; then
  do four of those in one approach, at night, in a thunderstorm. The ordinary approach to Metro
  City is still an ordinary approach - nothing the city builds stands on the straight-in path.
- **Far places** (5). Kestrel Island: 650 m behind a ridge, over a road you cross a few metres
  above the cars. Paradise Bay: an airliner across a public beach at fifteen metres. Frostbite
  Lake: a ploughed ice runway where whichever way the wheels point is the way you go. Red Mesa:
  500 m of dirt on top of a 150 m cliff, with a haboob coming over the rim in the last of them.
- **A new home screen.** Three doors over the live airfield - AIRCRAFT, MISSIONS, FREE FLIGHT - and
  a quieter fourth for settings, controls and the logbook. Missions are grouped, tagged NEW until
  you fly them and rated one to five pips; the city is drawn as a ladder. Free flight is a
  four-step builder (aircraft, place, weather, trouble) that tells you what each choice rules out:
  a field too short for the airplane is greyed out with the reason, weather is a preset with an
  advanced drawer behind it, a failure can be set to fire when you choose or dealt at random, and
  obstacles can be switched off where there are any. Keyboard and gamepad work all of it.
- **Scoring.** A mission with gates says so: a required gate missed or never reached caps the
  landing at 30 with the grade MISSED GATE, a bonus gate adds, and a go-around mends a miss. A
  failure you were asked to land with - a belly landing - is not counted against you.

### Developer notes

- **Nothing in `src/physics/`, `src/aircraft/defs.js`, `flightControl.js`, `autopilot.js` or
  `scoring.js` was edited.** Every new system wraps them from outside: `src/systems/weather.js`
  (the model; the look is `src/art/weather-look.js`, the sound `src/audio-weather.js`),
  `src/world/obstacles.js` (courses, swept collision against the hulls in
  `src/aircraft/hulls.js`, gates), `src/systems/failureEffects.js` (failures needing no physics
  edit, and their drills), `src/systems/mission.js` (gates, hints, HUD status, extra debrief lines)
  and `src/systems/routepilot.js` (waypoints and arcs in the runway frame, handing over to the
  stock Autoland on the final, because Autoland is obstacle-blind). The missions themselves are
  `src/missions/`, one file per group; `src/missions/README.md` is the contract and `docs/PLAN.md`
  §11 the summary.
- Everything random draws from the flight seed, never `Math.random()` and never an extra draw from
  the rng `resolveScenario()` uses, so pinned-seed replays of the old challenges are unchanged.
- Metro City's look is three Codex art passes on `src/art/city-look.js` and `city-facades.js`,
  fenced as the rest of the art bench is, against the drawing contract in that file's header and a
  budget the suite enforces (at most 60 draws, 450k/250k/120k triangles a pass, 6 programs counted
  by variant). Neither the flying nor the budget moved across the passes.
- Checks: `npm test` runs 822 art, 77 weather, 254 maps, 467 obstacle and 266 city checks alongside
  the physics, flight-control, yaw, scoring, stall, flare, carrier-trap, camera, free-flight and
  failure suites. All 49 challenges were then flown headless in the real page with no console
  errors, and the twenty originals came out frame for frame identical to the previous live build at
  seed 307.
- The leaderboard cap moved with the list: a career is now at most 4,900 (49 x 100). The site owns
  that registry and its Worker; both were raised and redeployed the same day.

## 2026-09-15 - taller seats, a stall you can feel, full-stall landings

- **Seats.** In the cockpit view the pilot sits higher in all four aircraft: 10 cm in the trainer and the bush
  plane, 8 cm in the airliner and the fighter (`seatUp` in `src/aircraft/defs.js`). The cabin stays where it is,
  so you see more over the nose. Headroom and the windshield view were measured from the new eye, and the art
  suite's line-of-sight check now looks from it.
- **Stall Recovery.** It starts closer and lower, at 850 ft and about 2.7 km out: power off, nose rising, the horn going, and the
  previous pilot still holding the yoke back, so the wing breaks about 2.5 s in and stays broken until you push
  the nose down or add power (`FlightControl.holdStall`). The old start dropped the trainer in fully stalled and
  it flew itself out in under a second, before anyone saw it. The held stall is not scored against you.
- **Landing at the stall is not a fault.** A slow touchdown no longer costs points, only a fast one does, and a
  stall or the stall horn inside the flare zone counts as part of the landing rather than a stall on the
  approach. The debrief says "held off to the stall" when you did, and the horn in the flare no longer brings
  up the "lower the nose" hint.
- Tests: `tools/test-scoring.mjs`, `tools/test-stall.mjs`, and a seat check in `tools/test-camera.mjs`.

## 2026-09-14 - the game is called Cleared to Land

The working title is gone: every string, storage key, file name and the web address
now carry the name Cleared to Land (CTL for short; airplane landing challenges). Saved settings,
best scores and the logbook name carry over on the first load; old links to the previous
address redirect.

## 2026-09-14 - aircraft, cockpits and exhaust (branch visuals-aircraft)

The aircraft get a visual rebuild from the ground up, with the art department (Codex)
doing every piece of visual art behind contracts the engine defines, and the engine
side providing the machinery: airframes as art modules, cockpit interiors for the
first-person view, and a particle engine for exhaust and effects.

### Engine contracts

- **Airframes** (`src/art/airframes/{skylark,trailblazer,condor,hornet}.js`, helpers in
  `common.js`): `buildAirframe(def, ctx) -> { group, parts, anchors, bounds }`. The
  procedural aircraft moved here from `src/aircraft/models.js`, which keeps loading, the
  glTF fit and fallback (`SHIPS` says which model ships per aircraft;
  `window.CTL_NO_GLTF` / `window.CTL_GLTF` force one or the other), the hinged
  panels for glTF models and the animation of the named parts. `parts` are the movable
  nodes with documented hinge conventions (elevator/ailerons/rudder/flaps/spoilers/
  props/hook/reversers/legs/lights/landingLight/hideInCockpit); `anchors` are body-frame
  points the engine reads (an exhaust per engine with direction and radius, the eye,
  the lights, wingtips, prop hubs, hook pivot, pitot). The refactor was shot before and
  after with the look sheet: nine of eleven scenes byte-identical, the rest inside the
  harness noise floor.
- **Particles** (`src/particles.js`): `ParticleSystem` (a pooled `Points` with per-
  particle age, velocity, wind advection through `Wind.at`, buoyancy, drag toward the
  air, size and opacity curves, per-sprite rotation, a two-colour tint, optional back-
  to-front sorting) and `Emitter` (rate-based, attached to a moving frame, sub-frame
  emission interpolated between the frame's last and current position so a fast
  aircraft leaves a ribbon rather than one puff per frame). Seeded; no `Math.random`.
  Only live particles are stepped and drawn (a live list feeds the index buffer), the
  `Points` is invisible when nothing is alive and its bounding sphere is refitted each
  frame so it culls.
- **Effects** (`src/art/effects.js`) now owns only the look, on top of the particle
  engine: an exhaust plume per engine from the airframe's anchors (idle haze, a darker
  puff when the throttle comes up, soot on a jet's spool-up, a fading stream from a
  failed engine), tyre smoke and dust, spray, sparks, crash fire and black smoke. The
  sprites are lit by the scene's sun and sky (`setLight`), so smoke is dark at night.
  `update(dt, ac, model, env)` gets the wind, time, camera, lens scale and sky from
  `main.js`.
- **Cockpits** (`src/art/cockpits/<id>.js`, helpers and the placeholder in
  `common.js`): `buildCockpit(def, ctx) -> { group, parts, update(state), look }`.
  `src/cockpit.js` (`CockpitView`) builds the interior for the current aircraft, hangs
  it on the model, fills a state object every frame (control surface positions and the
  pilot's inputs, throttles and engine readings, flap detent, gear and locks, spoilers,
  hook, brakes, trim, airspeeds, altitudes, vertical speed, attitude, AoA, stall, ILS
  and meatball, time of day and the sun direction in the body frame) and draws the
  interior on render layer 1 with a second camera (near 0.03 m, far 60 m) after the
  world with the depth cleared - a `Pass` before the bloom in the composer, a second
  `render` in the direct path on low quality. Fog and shadows are forced off on the
  interior; the scene's lights are given the layer. The exterior's fuselage skin is
  hidden in the cockpit view, wings/struts/gear/propeller stay visible outside the
  windows. Each cockpit declares its own head-turn limits (`look`), applied through
  `CameraRig.setHeadLimits`. The placeholder interiors move correctly (yoke or stick,
  pedals, throttles, flap/gear/hook/spoiler levers, trim wheel, six-pack needles,
  attitude ball, gear and stall lights, a 20 Hz canvas PFD on the Condor and HUD glass
  on the Hornet), proving the path on both render paths before any art.
- **Navigation lights**: one `Points` per aircraft with six vertices and per-vertex
  colour, size and on/off attributes; the blink is written into the attribute
  (`docs/PERF.md`: six draws per aircraft became one).

### Tests and tooling

- `tools/test-art.mjs` gained a block that builds all four airframes and cockpits in
  plain Node (`tools/dom-stub.mjs` stands in for the document) and checks exports,
  part names, anchors, bounds, budgets, that the controls move the right way with the
  state, particle sub-frame emission and determinism, and the fences (no `Math.random`,
  no physics imports, no `at*` uniforms, headers kept).
- `tools/surfshot.mjs`: the game repo's copy of the website harness's still shooter,
  feeding the cockpit its state after a mode switch, counting draw calls and triangles
  per group, printing console errors, with an in-page `eval` for probes.

### The art passes (Codex, the art department), in order

| # | Brief | Result |
|---|---|---|
| 1 | Trailblazer exterior: a Cub/Husky-class bush plane, not a biplane | First attempt declined the 12-draw budget with the right arithmetic (six surfaces + three legs x strut/wheel + prop = 13 before any static mesh); budget set to 20 (airliner 24). Second attempt: kept. 19 draws, 6.4k tris. `SHIPS.trailblazer = 'procedural'`. |
| 2 | Skylark exterior: a 172-class trainer | Kept. 19 draws, 17.8k tris. `SHIPS.skylark = 'procedural'`. |
| 3 | Condor exterior: a 737-class twin-jet | Kept. 24 draws, 54.1k tris (eight spoilers as two meshes, twin wheels as one). `SHIPS.condor = 'procedural'`. |
| 4 | Hornet exterior: an F/A-18-class carrier fighter | First cut (after the quota reset at 20:12): within budget but a tubular fuselage with a block intake and no LEX; not shipped. |
| 4b | Hornet fix: wide flat body, LEX, scoop intakes, real wing chord | Kept. 20 draws, 15.7k tris. `SHIPS.hornet = 'procedural'`: all four aircraft ship from the bench. |
| 5 | Skylark cockpit interior | First cut: an excellent panel (six-pack on one 2048 atlas, radios, engine gauges, switches, both yokes, pedals, throttle, flap switch, trim, seats); but heavy pillars across the view, the pilot's door missing from the eye, a metre-wide vent, a cube of a compass. 17 draws, 18.9k tris. |
| 5b | Skylark cockpit fix (pillars, door, vent, compass) | Fixed those four, but blacked out the windshield: a pane-to-door infill quad ran across the cabin in front of the eye. A line-of-sight check was added to `tools/test-art.mjs` (rays from the eye through the windshield must meet no opaque mesh within 2.5 m). |
| 5c | The blackout | Codex could not run it: the account's usage limit again (retry 01:18 on the 15th). The cause was a sign bug in the corner table (`wind` held the windshield corners on the left while the loop mirrored them with `side`; the door corners were on the right), fixed engine-side as a one-line correction; the line-of-sight check passes, the three head positions were re-shot. 19 draws, 19.4k tris. |
| 6 | Trailblazer cockpit interior | Kept (after the 01:18 reset): the Cub front seat - sparse panel on one 1024 atlas, tube frame and fabric walls, throttle quadrant and Johnson bar on the left wall, low door windows, rear seat, skylight. 20 draws, 12.8k tris; line of sight clear. |
| 7 | Condor flight deck | Kept (after the 06:20 reset, in the renamed repo): PFD/ND/engine display/two CDUs on one 2048x1024 canvas at <= 20 Hz, a placard atlas, the MCP glareshield, six panes, both yokes, thrust levers with reverse handles, speedbrake/flap levers, paired trim wheels, gear lever with lights, autobrake. 9 draws, 15.0k tris; placeholder flag dropped; line of sight clear. |
| 8 | Hornet cockpit | Kept: Codex wrote the whole file (HUD on its combiner with heading tape, boxes, ladder, velocity vector, AoA bracket and HOOK/GEAR cues; UFC keypad; AoA indexer on the canopy bow; mirrors; consoles with the gear handle and hook handle; standby instruments; ejection seat) and the quota ran out before it could run the suite or answer - the suite passes on the file (742 checks, line of sight clear). 20 draws, 14.0k tris. Open: the two DDIs read unlit in the stills. |
| 9 | Exhaust and effects look | Not run: the quota ran out again after pass 8 (retry 11:20). The engine-side exhaust (haze, throttle puff, jet soot, failure stream) ships with placeholder numbers. |
| 10 | Livery/finish | Not run (quota). Notes for it from the reviews: the registration lettering reads mirrored on the right side of the procedural airframes; the Condor's grey belly renders near-black from below; the white upper surfaces blow out at midday. |

Review stills of every pass, and the before/after look sheets, are under the scratch
folder named in the session report (not in the repository).

### Docs

`src/art/AGENTS.md` and `src/art/README.md` carry the aircraft sections (scope, the
three traps, the budgets from `docs/PERF.md`).

## 2026-09-14 - the world rebuilt (branch visuals-world)

A complete redo of how the 3D world looks - sky, ground, forests, water, aerodromes,
the carrier - with the art department (Codex) drawing and the owner's session
writing the contracts, briefs and integration. Direction: real and atmospheric.
The engine (`src/main.js`), the world's layout (`src/world/`), the physics and the
aircraft are untouched; every change is inside `src/art/`, `tools/` and the docs.

**Structure.** `terrain-look.js` is now a barrel over `world-ground.js`,
`world-vegetation.js` and `world-props.js`; `sky.js` keeps `SkySystem` and
re-exports `makeWater` from `world-water.js`; the shared sky shading contract
(`atmosphere(d)`, its `at*` uniforms) lives in `world-atmosphere.js`; `quality.js`
holds the tier (`WORLD_QUALITY.detail`, set by the SkySystem from an explicit
`detail` or the shadow map size). `tools/test-art.mjs` gained a world-bench block:
barrel identity, the `at` uniform prefix, no `Math.random`, no clock, no engine
imports, and the two doors the world may use. Pixel-neutral (lookdiff 0.000).

**Sky (art department, passes 1-1c).** A Rayleigh/Mie scattering lookup baked at
`set()`, `atmosphere()` as two texture fetches; a radiance budget - the composer
renders linear radiance without tone mapping and the bloom thresholds it at 0.92,
so sunlit white lands at ~0.8 (sun 2.3, fill 0.5) and the exposure is 1.2 by day,
3.8 at night; runway markings no longer glow. Aerial perspective is Koschmieder
eased for the eye (`clearExtinction`: 3.912/(3 V) in clear air, full in weather),
darker for ground-bound rays, continuous through the horizon in fog. Cumulus with
lit tops and shaded bases from seeded clusters with a period-breaking second
sample; stars faded by the sky's own brightness; a night with a findable horizon.
`tools/sky-budget.mjs` bakes the sheet's conditions in Node and fails when a
daytime sky peaks above 0.9 or the aerial perspective keeps under 65% at 4 km.

**Ground (art department, pass 2).** Sixteen 2 km chunks plus outer tiles under
`THREE.LOD` with skirts (20 m near, 80/240 m mid/far on high), one shared
material with the farm parcels, headlands, tractor tracks, wet/dry variation and
a cheap micro-relief term; site-specific colouring (the plains' farm noise no
longer paints the mountains: meadow floor, gravel banks, slope rock, scree,
broken snow; dry and wet sand on the coast); a 1024 px periodic ground detail.

**Vegetation (art department pass 3, then here).** Spruce, pine, oak and poplar at
240-282 / 46-56 / 4 triangles; hedgerows as continuous hedges with gates and
hedge trees (the flat "green slugs" are gone); ragged woodland margins. Level of
detail is per instance in the vertex shader (level 0 within 350 m, level 1 to
1500 m, staggered per instance) with `THREE.LOD` only culling 600 m / 1200 m
cells; the far forest is one camera-facing card mesh per species. Mountain
valleys are wooded wall to wall below the treeline (18 m cells, 65k trees).
Spruce are dark: HSL lightness is linear in three's working space, so the old
0.19 was mint.

**Water (here, pass 4).** One 512 px tiling slope map baked per seed from thirty
wave components on a Phillips-like spectrum, sampled at 85 m / 15 m + 23 m / 2.6 m
with distance fades; Fresnel to the shared atmosphere, footprint-aware glitter,
rare whitecaps by `seaState` (water above 60 m is a calm river), the moon's glade.

**Aerodromes (here, pass 5).** The six parked airframes are baked to one mesh per
material, sit under a LOD and cast no shadows - the plains site fell from 392 to
138 draw calls, the flare from 374 to 162; a 3 m aggregate grain under the wheels;
light sprites sized by distance with a hard core and soft halo.

**Carrier (here, pass 6).** Non-skid, tie-downs, rubber, elevator outlines,
catapult tracks and a no-step band on the deck; boot-topping, rust and plating on
the hull; a merged gallery of sponsons and catwalks; a stepped island with glazed
bridge bands that glow at night, a lattice mast, radomes and a beacon; a drawn wake.

**Cost, scene alone with shadow pass, high tier (baseline -> now).** Plains
365 calls / 4.77 M triangles -> 138 / 0.41 M; flare 355 / 4.77 M -> 162 / 0.39 M;
coast 447 / 2.47 M -> 244 / 0.67 M; tower 206 / 2.45 M -> 218 / 0.30 M; mountain
160 / 5.64 M -> 195 / 1.16 M; ridge 114 / 5.63 M -> 150 / 1.15 M; carrier 102 /
7 k -> 103 / 4 k; fog 443 / 2.46 M -> 225 / 0.44 M. Medium tier at the plains
134 / 0.32 M, low 107 / 0.10 M. No shader errors on any scene at any tier.

**Tools.** `tools/world-probe.mjs` (per-scene draw calls, triangles, programs,
instances, console, a per-root breakdown, a tier override), `tools/still-lab.mjs`
(one scene with a JavaScript experiment applied before the capture),
`tools/sky-budget.mjs`, `tools/looksheet.mjs` (a copy of the website harness that
waits for the airframe and gives the menu its update). The art briefs are kept in
`docs/briefs/world/` for reruns.

**Open.** The tower scene (a 3.5-degree lens over ground 4-8 km away) stays hazier
than the other scenes; the sea's chop shows a faint lattice at mid distance; the
cumulus are smooth-lobed; the hedge line vanishes beyond 2 km; the far forest
cards are lit as flat ground. `mobile.mjs` at 1088x430 is checked separately.

## 2026-09-14 (evening) - the merged art measured (branch perf)

- Every "Fly" no longer waits 2.5 s for a downloaded airframe that never comes: three airframes ship
  as procedural models now, and the start-up compile only waits for the ones that ship as glTF.
- The cockpit interior is drawn from a scene of its own straight to the canvas after the composer:
  through the composer it re-walked the whole world and made three.js resolve the multisampled
  HalfFloat target a second time (11-12 ms of GPU per frame at the phone's high tier, +3-4 ms of
  CPU at phone speed). On the mobile stand-in the cockpit view went from 46 to 69 fps at medium and
  from 20 to 30 at high, within a millisecond of the chase view.
- Housekeeping: the cockpit interior's readings are gathered only in the cockpit view; the quality
  controller's run-time shadow map no longer decides the next world's detail level (the tier does);
  the parked-aircraft merge steps aside where the art bench has already flattened the model.
- Developer notes: `npm run perf-probe` waits on the engine's `compiling` flag, times the cockpit
  feed, classifies the new modules' names (world/ground, vegetation/*, aerodrome/parked-*) and has
  `--matrix p3-desktop|p3-phone|p3-proxy` and a `cellgate` ablation; `tools/perf-phase3.mjs` writes
  the section-9 tables; `tools/looksheet-inject.mjs` is the website harness's look sheet with a
  JavaScript injection hook (`CTL_LOOK_INJECT`, sharp via `CTL_SHARP`) so an engine switch
  can be diffed sheet against sheet. Numbers and the art-owner findings: `docs/PERF.md` section 9.

## 2026-09-14 - performance pass (branch perf)

- Phones: the same picture at two to three times the frame rate. On the mobile stand-in (an Intel
  UHD 770 pinned as the GPU, the CPU throttled to a third, the phone's own viewport and touch
  path) the plains approach at medium went from 24 to 70 fps, low from 44 to 78, high from 18 to
  25; the coast at medium, which was CPU-bound at 25 fps, is now GPU-bound past 50. The forest
  is no longer transformed twice in full every frame (it is chunked so the camera and the shadow
  camera can cull it), the six aircraft parked on an apron cost a handful of draws each instead
  of 29 to 71 and no longer put six dead spot lights into every shader, and the HUD only touches
  the page when a value changes.
- Graphics quality is now a controller, not two one-way steps: if frames run long the render
  resolution scales down first (the HUD is drawn by the page and stays sharp), then the shadow
  map, then the bloom, then the post-processing, and it steps back up when there is room. It is on
  for every device (Settings can switch it off); on a fast GPU it never triggers.
- A phone's medium tier draws straight to the screen (no bloom): the post-processing composer was
  the single biggest cost on a mobile-class GPU (13 ms of MSAA on a 16-bit target and 7 ms of bloom
  out of a 30 ms frame). The phone high tier keeps it with 2x MSAA and a half-resolution bloom.
  The desktop high tier is unchanged.
- A flight no longer freezes for a second or two at "Fly": the new world's shaders compile in the
  background (KHR_parallel_shader_compile) and the flight starts at t = 0 on a rendered frame.
- Desktop: the PC was never short of frame rate (the RTX 4080 draws a 1080p frame in 1.5 ms of
  GPU and 2 ms of CPU, now 1 ms); the CPU per frame halved anyway. See `docs/PERF.md` for what
  can make a PC feel slow (which adapter the browser renders on, which adapter the monitor is
  plugged into, the 60 Hz 4K screen).
- **`npm run perf-budget`** (added after the merge): the art-bench budgets of `docs/PERF.md` section 5
  as pass/fail. It flies the plains, coast, carrier-night, mountain and fog scenes with the chase and the
  cockpit camera and prints one row per owner and metric (measured, budget, ok / BREACH / info), exit 1 on
  any breach; never part of `npm test` (it needs a GPU). Owners are classified from the engine's groups
  plus the names and layers the visuals branches use (`parked:*`, `cockpit:*` / render layer 1, instanced
  meshes under the terrain group, particle point clouds), so it reads the new art modules
  (`src/art/airframes/*`, `src/art/cockpits/*`, `src/particles.js` + `effects.js`, `src/art/world-*.js`)
  without knowing their names. The GPU-millisecond rows are asserted on the Intel stand-in
  (`-- --gpu intel --phone --cpu 3 --quality medium`) and printed as info elsewhere. Against `main`
  before the new art lands (45 of 246 structural checks; the GPU rows all pass at phone medium: plains
  12.3 ms, coast 8.0, carrier 3.5, mountain 15.2 of 16) it lists what the art branches still owe: the
  flying airframes at 29-71 draws (budget 20, airliner 24); vegetation triangles in view 1.37-1.49M on
  the plains (budget 1.2M) and 1.5-1.6M on the mountain at phone medium (budget 1.0M: the 45,000 cap
  must scale with the tier); the particle systems drawing all 4,100 points while idle; the moon left
  visible at intensity 0 by day; textures at 12.0-12.8 MB per airfield (the 4096x512 runway alone is
  11.2 MB) and 23.4 MB at the carrier (the deck) against 12; and the propeller disc, a transparent
  DoubleSide material without `forceSinglePass`, which makes three.js set `needsUpdate` twice per
  frame (~5,700 sets in 8 s) and re-key its program every frame. One program still compiles mid-flight
  on the mountain (a shadow depth-material variant meeting its first caster; a one-frame hitch).
- Developer notes: `tools/perf-probe.mjs` (`npm run perf-probe`) measures the game on a real GPU
  with the real animation loop - frame-time percentiles, CPU parts, GPU timer queries per pass,
  draw counts, heap churn, DOM layouts, start-up stalls, CPU and allocation profiles, a scene
  census, ablations, phone emulation and an adapter pin. `docs/PERF.md` holds the baseline, the
  price list, the requirements for the art bench (numeric budgets per module: the visuals
  branches bake them into their briefs) and the after-table. Engine changes: `geom.js`
  (`chunkInstanced`, `mergeParts`, `freeze`), `world/terrain.js` (chunks, frozen matrices),
  `world/airport.js` (parked aircraft: lights stripped, nav lights merged, meshes merged per
  material once the glTF is in, frozen aerodrome), `main.js` (`qualityProfile` per device with
  `msaa`/`bloomScale`/`soft`, `applyLevel`, `autoQuality`, `startCompile`, no per-frame
  allocations), `ui/hud.js` (change-only DOM writes, transforms instead of layout, 20 Hz
  readouts), `camera.js` (scratch objects). `npm test` unchanged and green; the look sheet diff
  against the baseline is within the same-build noise floor.

## 2026-09-14 - yaw pass (branch yaw)

- The rudder no longer turns the airplane sideways: full pedal now settles at a realistic sideslip
  (Skylark about 14 deg, bush plane 18, airliner 16, fighter 15) instead of 30-65 deg, and it can no
  longer stall the wing on its own. A slip now costs a little lift, as it should, instead of adding some.
- Rolling no longer swings the nose the wrong way: in Assisted mode an aileron-rudder interconnect
  cancels most of the adverse yaw (a full roll input used to put the light aircraft 19-24 deg into
  sideslip; now about 9), and a proper yaw damper with turn coordination settles the tail-wagging after
  a gust or a rudder tap in about one swing (damping ratio Skylark 0.31 -> 0.48, bush plane 0.29 -> 0.61,
  airliner 0.21 -> 0.39, fighter 0.14 -> 0.28). The damper fades to 40% while you press the pedals, so a
  de-crab kick is still all yours. Direct mode is still the bare airframe.
- The airliner no longer rolls over from a rudder kick: its ailerons can hold the wings level at full
  rudder (88% of the ailerons at the transient peak; before, they were pinned at 100% and it rolled to
  70 deg), and its rudder now holds a single-engine full-thrust go-around straight at 135 kt with 64%
  pedal and 3 deg of bank (before this pass that took about 137 kt and the first cut of the pass had
  pushed it to 156; the sim's VMCA-equivalent is now about 128 kt).
- The rudder keys (Q/E) take 0.4 s to reach full pedal instead of 0.3 s; taps are nudges.
- A right-rudder kick now pushes the airplane left and rolls it left for a moment before the sideslip
  rolls it right, like the real thing (two derivatives carried the wrong sign convention).
- Developer notes: the fin group (`Cnb`, `Cnr`, `Cndr`, `CYb`, `CYdr`, `Cldr`) now rides on the tail's
  dynamic pressure (capped at 2.5x freestream), so propwash stiffens the fin as much as it powers the
  rudder; rudder effectiveness rolls off at large deflection (DATCOM K'); wing lift scales with cos^2 of
  the sideslip; `CYdr`/`Cldr` signs fixed; Skylark/Trailblazer `Cnda` reduced to differential-aileron
  values; Condor `Clb` -0.16 -> -0.12 (flaps-30 value) and its fin group x1.65 (`Cnb` 0.25, `Cnr` -0.33,
  `Cndr` 0.20, same ratio) for the engine-out case. New guard `tools/test-yaw.mjs` in `npm test`,
  including the Condor single-engine hold.
