# Missions: the contract between the mission data and the engines

*Written 2026-09-17 for the missions expansion (new maps, weather, failures, obstacles, the city ladder,
the new home menu). Every field below is optional: a scenario that uses none of them behaves exactly as
the original twenty do, and those twenty are never edited by this work.*

## Where things live

| What | File | Owner |
|---|---|---|
| The original 20 challenges and 6 sites | `src/systems/scenarios.js` | unchanged; it appends the lists below |
| New sites (maps) | `src/missions/sites.js` (`NEW_SITES`) | maps |
| New missions, one file per area | `src/missions/{weather,failures,obstacles,city,maps}.js` | that area |
| The registry the game reads | `src/missions/index.js` (`NEW_SITES`, `NEW_MISSIONS`, `MISSION_GROUPS`) | shared, append-only |
| Weather model (wind overlay, storm events, state) | `src/systems/weather.js` (`Weather`) | weather |
| Weather look (rain, snow, dust, storm deck, lightning) | `src/art/weather-look.js` (`WeatherLook`) | weather (art bench rules) |
| Obstacles and gates (collision, clearance) | `src/world/obstacles.js` (`ObstacleField`) | obstacles |
| Body-frame probe points per aircraft | `src/aircraft/hulls.js` (`HULLS`) | obstacles |
| Obstacle / city look | `src/art/city-look.js` (reached through `src/art/terrain-look.js`) | obstacles/city |
| Failure effects that need no physics edit | `src/systems/failureEffects.js` (`FailureRuntime`) | failures |
| Failure catalogue and triggers | `src/systems/malfunctions.js` | failures |
| Per-mission runtime: gates, extra scoring lines, hints, status | `src/systems/mission.js` (`MissionRuntime`) | obstacles |
| Waypoint pilot for verification (and the debug autopilot) | `src/systems/routepilot.js` (`RoutePilot`) | obstacles |

**Never edit** `src/physics/*`, `src/aircraft/defs.js`, `src/systems/flightControl.js`, `src/systems/autopilot.js`
or `src/systems/scoring.js`: a separate flight-physics review owns them. Everything here wraps them.

## Ids

A mission `id` is permanent: it keys the pilot's saved bests and a public leaderboard board. It must match
`/^[a-z0-9][a-z0-9-]{0,23}$/` (lowercase, digits, hyphens, at most 24 characters). `n` continues from 21.

## Runway frame

Anything placed relative to the runway uses the runway frame of `site.runways[0]`: **u** metres along the
runway from the threshold (negative = out on the approach), **v** metres to the right of the centreline
(looking down the runway), **y** metres above the runway's threshold elevation. `src/missions/util.js`
has `rwToWorld(site, u, v, y)`.

## New scenario fields

```js
{
  group: 'storms',          // menu group id, see MISSION_GROUPS in index.js
  difficulty: 3,            // 1..5, shown in the menu
  weather: {                // null / absent = today's behaviour exactly
    preset: 'storm',        // 'clear' | 'overcast' | 'rain' | 'storm' | 'snow' | 'dust' | 'fog': defaults for the rest
    rain: 0.8, snow: 0, dust: 0,   // precipitation 0..1 (look + sound; rain > 0.3 wets asphalt)
    darkness: 0.6,          // overcast dimming 0..1
    ceiling: 180,           // cloud base, metres above the field (null = none)
    lightning: 0.5,         // 0..1, strikes per minute scale
    wet: true,              // runway contamination override
    seaState: 1.1,          // carrier deck and sea
    events: [               // scheduled happenings; `at` uses the failure trigger types below
      { type: 'microburst', at: { type: 'dist', value: 2500 }, strength: 1 },
      { type: 'gustFront', at: { type: 'alt', value: 400 }, shift: 70, speed: 25 },
    ],
  },
  course: {                 // obstacles and gates for THIS mission (a site may also carry a `course` of its own)
    obstacles: [ { kind: 'tower', shape: 'box', u: -2400, v: 60, w: 30, d: 30, h: 180, rot: 0, name: 'the Meridian Tower' } ],
    gates:     [ { u: -3000, v: 0, y: 120, w: 60, h: 40, name: 'Gate 1' } ],
  },
  route: [ { u: -6000, v: 900, alt: 450 }, { u: -2500, v: 0, alt: 160 } ],   // waypoints for RoutePilot and the HUD cue
  spawn: { u: -6500, v: 1200, hdg: -40, gamma: -3, alt: 500 },   // u/v/hdg/gamma are new; hdg is relative to the runway heading
  failures: [ { name: 'stuckThrottle', at: { type: 'alt', value: 900 }, arg: 0.7, silent: false } ],
  scoring: { type: 'runway', mission: { gates: 'required' }, belly: true },
  hint: (ctx) => ctx.ra > 300 ? 'Line up on the gap before the towers.' : null,   // ctx = { ac, ra, d, t, u, v, mission }
}
```

### Failure triggers (`at.type`)
`start`, `time` (s), `alt` (radio altitude, **feet**), `dist` (**metres** to the threshold / ramp), and new:
`touchdown`, `speed` (below this IAS in kt), `window` (`{from, to}` seconds, a seeded random time between),
`gate` (after gate index `value` is passed).

### Weather event types
`microburst` (downdraft core and outflow on the approach path: headwind gain, then sink, then tailwind),
`gustFront` (the wind swings `shift` degrees and rises to `speed` kt over a few seconds), `windShift`,
`turbBurst`, `squall` (rain and wind jump together), `visDrop` (visibility falls to `vis` metres).

### Visibility
*(Added by the maps area, 2026-09-18; the rule settled in the polish pass the same day. The weather area owns it.)*
A scenario's `vis`, and a `visDrop`'s `vis`, is the whole visibility: the number the sky and the weather model are
given (`weather.state.vis`), the one the briefing's kneeboard shows, and the one a mission's text names. The rain,
snow and dust the spec itself asks for are already in it; the weather look thickens the air only for precipitation
**above** the spec's own (a squall's rain, a storm cell's shaft): `m = 1 + 1.4 × (rain − the spec's rain) +
0.8 × (snow − the spec's snow) + 1.6 × (dust − the spec's dust)`, never below 1 (src/art/weather-look.js). What the
pilot sees is the 2%-contrast distance of the air the look draws, `3.912 / (clearExtinction(vis) × m)`;
`clearExtinction` (src/art/world-atmosphere.js) is exact at 900 m and below and draws the air clearer above that
(6,000 of `vis` is about 16 km of clear air), as it does for the original twenty. So at 900 m and below, `vis` is
exactly what the pilot sees (Whiteout: 900 m in the text, on the kneeboard and out of the window); above it, the
window is never worse than the number (Dust Wall: seven kilometres before the wall, 1,100 m after the drop).
tools/test-maps.mjs checks the maps missions against this formula.

## Engine interfaces (stubs exist; the owners fill them in)

- `new Weather(spec, { seed, wind, world, scenario, hud, audio, rig })`; `update(dt, t, ac)`; `addWind(p, t, out)`
  adds m/s to `out` (O(1), early-out; it runs per particle); `state` = `{ rain, snow, dust, darkness, ceiling, flash, ... }`.
- `new WeatherLook(scene, { spec, sky, quality, touch })`; `update(dt, state, { camera, t, sky, renderer, ac })`.
- `ObstacleField.plan(site, sc)` returns a resolved course (world-space volumes, gates, `keepOut` circles for the
  terrain's clutter) or null; `new ObstacleField(course, { terrain, site })`; `build(scene, { night, quality })`;
  `reset(ac)`; `hit(ac)` returns the name of what the airframe hit since the last call, or null; `update(dt, t, pos)`.
- `new FailureRuntime(ac, sc, { seed, hud, audio, rig, input, world, touch, game })`; `trigger(spec)`;
  `preStep(dt, ac, inp)` (after the flight control, before the physics step); `postStep(dt, ac)`;
  `action(name)` returns true when it consumed a key action; `sensed` / `display` for the HUD and cockpit.
- `new MissionRuntime(sc, { world, weather, failRt, hud, audio })`; `update(dt, t, ac)`;
  `hint(ctx)`; `status()`; `score(result, ac, approach)` returns the result with mission lines, clamped 0..100.
- `new RoutePilot(ac, world, sc)`; `update(dt)`: flies `sc.route`, then hands over to Autoland for the final.

## Determinism

Everything random draws from the flight seed (`game.flightSeed`, pinned by `window.CTL_WIND_SEED`) through
`makeRng(seed * k + c)` with its own constants: never `Math.random()`, and never extra draws from the rng that
`resolveScenario` uses, or pinned-seed replays of the original challenges change.

## The menu and free flight (`src/ui/menus.js`, `src/missions/free.js`)

The home menu (2026-09-18, "Three Doors") lists whatever `SCENARIOS`, `SITES` and `MISSION_GROUPS` contain; nothing in
it names a mission. What it reads from a mission:

- `group` (or a place in a group's `ids`) puts it in that group's rail entry and grid block; groups show in
  `MISSION_GROUPS` order, and a mission in no known group lands in a "More" block at the end. `missionOrder()` in
  `index.js` is the one order everything follows: the rail, the home screen's NEXT UP and the debrief's Next.
- `difficulty` (1..5) is drawn as pips. The original twenty have theirs in `src/ui/aircraft-catalog.js`
  (`CLASSIC_DIFFICULTY`), so `scenarios.js` stays untouched; that table's keys are also how the menu tells the original
  twenty from new missions, which carry a NEW tag until they are flown.
- The group `city` is drawn as a ladder: RUNG 1, 2, ... in menu order.
- The briefing shows `wind.rel` or `wind.dir` (turned into degrees off the landing direction), `weather` (preset,
  precipitation, ceiling, events), obstacles (`course`, or the site's `obstacleTrees` / `course`), the sea state on
  the carrier, and a failure's name unless `surprise` is set.
- A site with an id outside the original six gets a NEW tag in the free-flight builder.
- `aircraft: 'random'` files a mission under the airplanes `resolveScenario()` can draw (`RANDOM_AIRCRAFT` in
  `src/ui/aircraft-catalog.js`: Skylark, Condor, Trailblazer; never the Sea Hornet). Change both together.

**Free flight** is `buildFreeFlight(options, { sites, seed, missions })` in `src/missions/free.js` (`makeFreeFlight` in
`scenarios.js` delegates to it; `tools/test-free.mjs`, part of `npm test`, checks it). The options are saved as `ctl.free` and cleaned by `validateFreeOpts()` on every load,
so a stale site, aircraft or failure id falls back instead of throwing. The scenario it returns:

- `id: 'free'` (never logged, never on the leaderboard), `aircraft`, `site`, `time`, `vis`, `weight`, `spawn` (a bush
  strip starts close in, low over the trees: the Gravel Bar and the One-Way Strip 900 m out and 100 m up, as
  `resolveScenario()` forces for them, any other strip at most 1,500 m out), `scoring.type` from `site.kind`.
- `wind: { dir, speed, gust, turb, shear }`, `dir` absolute (the builder stores the wind relative to the landing
  direction, `windRel`). A gust equal to the wind speed means no gusts.
- `weather: { preset, rain, snow, dust, darkness, ceiling, lightning, events }` from the preset tiles and the Advanced
  drawer; the wind shear toggle adds `{ type: 'microburst', at: { type: 'dist', value: 2500 } }`; `seaState` only on
  the carrier.
- `failures`: only names whose catalogue entry has no `applies()` or whose `applies(def)` is true. The trigger is the
  entry's `freeAt` when it has one, else the moment the pilot picked: a seeded `window` when `shouldTrigger` supports
  it, otherwise an altitude worked out from the options and the start height (never `Math.random()`, always below
  where the flight starts: "on approach" is 60% of the start height, 72% on a bush strip, "short final" 300 ft or half
  of it). "Surprise me" deals one of them from the flight seed, with `silent: true`, and sets `surprise: true`.
- **`course: false`** when the pilot switched obstacles off. It means *no obstacles at all* for this flight: neither a
  mission course, nor the site's own `course` (the Gravel Bar's tree wall, since 2026-09-22), nor the site's
  `obstacleTrees` (the Gravel Bar's scattered spruce). `loadSite`
  in `main.js` honours it before anything is planned: it skips `ObstacleField.plan()` (so no course is built and the
  terrain keeps no clearings for one) and `terrain.addObstacleTrees()`. **Merge note:** keep both guards
  (`sc.course === false ? null : ObstacleField.plan(site, sc)` and `site.obstacleTrees && sc.course !== false`) when
  the obstacles work lands; a mission never sets `course: false`. The builder only offers the switch at a place that
  has something in the way.

Places the chosen aircraft cannot use are shown disabled with the reason: a runway shorter than the airplane needs
ashore (`runwayNeedAshore()` in `src/ui/aircraft-catalog.js`: `def.approach.runwayNeed`, except the Sea Hornet's, which
is its 200 m on the wires, so 1,500 m ashore), or the carrier without a hook. A pair a mission flies is always offered
(the Condor at Ridgefield's 1,600 m, "Short & Heavy"), marked "Tight".

## The obstacle engine (for course builders: the city ladder is built on it)

*Written 2026-09-18 with the three "In the way" missions (`src/missions/obstacles.js`: power-lines, the-notch,
harbor-cranes), which are its worked examples. The full reference for every kind is the header of
`src/world/obstacles.js`; this is the map. On 2026-09-22 all three, and the Gravel Bar's wall, moved to where the
runway begins (Marc: "the obstacle and then immediately the runway"); the design rule since is that an obstacle
mission's last obstacle stands at the threshold or the route from it IS the final, and the numbers a mission
needs (a wall's height against what the airplane can descend at idle, with and without a slip) are measured with a
scripted pilot before they are written - see the 2026-09-22 entry of `docs/CHANGELOG.md`.*

### The pieces

| Piece | File | What it does |
|---|---|---|
| Course resolution, collision, gates | `src/world/obstacles.js` | `plan()` turns `site.course` + `sc.course` (runway frame) into world volumes; `hit(ac)` after every physics step |
| The airframes' probe spheres | `src/aircraft/hulls.js` | `HULLS[id]`: nose, tail, fins, wing and tail surfaces, nacelles, flaps (they move with the flap), wheels while down |
| The look | `src/art/city-look.js` (through `terrain-look.js`) | draws every volume from its own numbers, instanced: 3-5 draws a course, plus the night lights |
| Gates, debrief lines, hints, HUD status | `src/systems/mission.js` | wraps `scoreLanding`'s result; required gates cap the points, bonus gates add |
| The route pilot | `src/systems/routepilot.js` | flies `sc.route`, then hands over to the stock Autoland on the final |
| The proof | `tools/fly-mission.mjs`, `tools/test-obstacles.mjs` | fly a mission headless (Node or the real page), stills, mid-flight compiles; the suite |

A scenario with no `course` (site or scenario) never constructs an `ObstacleField`: the original twenty are
untouched, and `tools/test-obstacles.mjs` checks that none of them builds one.

### A course

```js
course: {
  obstacles: [ { kind: 'tower', u: -2400, v: 60, w: 30, d: 30, h: 180, rot: 0, name: 'the Meridian Tower' }, ... ],
  gates: [ { u: -3000, v: 0, y: 120, w: 60, h: 40, name: 'Gate 1' },                        // required (default)
           { u: -1500, v: 0, y: 60, w: 40, h: 24, name: 'the arch', required: false, bonus: 10 } ],
  clear: [ { u: -120, v: -10, r: 40 } ],   // extra circles kept free of decorative forest and villages
}
```

- **Kinds**: `box`, `tower`, `block`, `cyl`, `mast` (optional guy wires), `cable` (one sagging wire), `powerline`
  (`hv` lattice pylons or `pole`s with their wires, marker balls), `bridge` (a deck you can fly under, optional
  suspension towers and cables), `crane` (`sts` ship-to-shore with a boom angle, or a `tower` crane), `ship`
  (`container` or `tall`), `quay`, `containers` (a yard), `tree` and `treeWall` (the bush strips' spruce, with a
  `gap` notch). Parameters: the header of `src/world/obstacles.js`.
- **Heights**: `h` is above the local ground (or the water for ships and quays); `y`, `y0`, `y1`, `top` and `base`
  are above the threshold elevation, **except a quay's `top`, which is above the water**, and `deck`, which sets
  any compound's base that far above the water (the harbor's `quay top: 4` and its cranes' `base: -4` are the same
  height only because Harbor City's water is 8 m below its threshold). A route's `alt` is the **CG's** height above
  the threshold elevation. The ground under an approach is rarely at the threshold's height (Harbor City's water is
  8 m below its threshold; Moose Creek's notch stood on ground 6 m above the bar until it moved onto the bar's own
  flat on 2026-09-22): quote heights in a description only after the suite prints them.
- **Names** read "Hit " + name in the debrief: give them their article (`'the lowered crane boom'`, `'a pylon'`).
- **A new kind** is one function in `BUILD` using the `Placer` (`box`, `beam`, `cyl`, `cap`, `wire`, `light`,
  `keep`); the look draws whatever volumes it makes, by their `look` (`building`, `plain`, `hull`, `container`,
  `steel`, `wire`, `marker`, `tree`, `trunk`, `truss`, `concrete`, `white`, `wood`, `insulator`), and the suite's
  "drawn = collides" check covers it with no new test code.
- **Gates** are markers (drawn, never solid), **flown in array order** (`ObstacleField.gatesStep`). *Since
  2026-09-22 none of the "In the way" missions uses one - Marc's rule is that the obstacle itself must force the
  line, with no easier option (The Notch's wall cannot be flown over onto the bar; the harbor is a basin of lowered
  booms the airliner starts inside) - and the harbor examples below are historical; the city ladder still scores
  its skybridges, gaps and the Needle's eye with gates.*
  - **passed** when the CG crosses the plane in the gate's direction inside the frame - also a gate already missed
    (a go-around mends a miss). One gate per crossing, the first in order not yet passed, so two gates on the same
    spot (an arch flown twice) take two passes. Gates before it that are still pending were skipped: missed now.
  - **missed** when the CG crosses the plane in its direction outside the frame but within `max(3 x w, 150 m)` of
    it - and only when the gate is **due** (every required gate before it passed or missed). A later gate's plane
    is ignored until then, so a circuit whose upwind leg crosses the final gate's plane does not miss it. Bonus
    gates never hold the sequence up.
  - Give the gates in the order they are flown, and never route an earlier leg through a later gate in that gate's
    direction (it would be passed early and the gates between marked skipped).
  A required gate missed or never reached caps the landing at `MISSION_CAP` (30) with the grade `MISSED GATE`; a
  bonus gate adds its points; the total is clamped to 100. The HUD status line reads `Gates 1/3 · the harbor exit
  1.2 km` (the next pending gate). Name a gate so "Through " + name reads well (`'the gap under the boom'`).
- **Near misses**: a pass within 5 m of an obstacle (a prim's `group`: one pylon, one crane, one tree) gets an
  in-flight callout ("3.2 m") once the airframe is past it, and the debrief quotes the closest pass under 15 m
  ("Closest shave"), not after a crash. The clearance is taken at each frame's pose (the hit test is swept, this
  is not): within a metre at 60 fps; at the harness's 25 fps and 150 kt, within about 1.5 m, never closer than true.
- **Hints**: `sc.hint(ctx)` is not asked while the stall warning sounds above the flare zone: the game's own stall
  hint shows instead.
- **A site of your own** (`OBSTACLES_SITES`, `CITY_SITES`): keep what only the mission is about in the mission's
  `course`, not the site's, so free flight, Autoland and the look and perf tools at that site meet nothing they
  cannot fly; mark a site that exists only for a mission `missionOnly: true` (the new home menu's free-flight
  picker leaves it out; Moose Creek Notch is one).

### Collision: what it is and is not

`main.js` calls `hit(ac)` right after `ac.step()`. Every probe sphere of the airframe is swept from the previous
frame's pose to this one against the volumes near the path (a 48 m grid, then per-cluster bounds), so nothing
tunnels even at 250 kt with the 0.1 s frame clamp: a 12 cm cable is caught, and a 0.6 m mast cannot slip between
two probes on the Condor's wing (the suite proves both). A hit calls the aircraft's public `crash('Hit ' + name)`.

The course is **not** in the physics ground query: radio altitude, ground effect, the flare law, Autoland's
flare, the callouts and altitude-triggered failures all still read the terrain, even under a crane boom or over a
rooftop, and nobody can land on a roof. The chase camera is not obstacle-aware either: it can pass through a wall
behind the airplane in a tight street (not a problem in the three missions; `src/camera.js` is shared).

Cost: `hit()` is 1-3 microseconds per frame on average on the dev i7 and 190 at worst (the Condor under the
harbor's boom); allow about three times that on a phone.

### The route pilot

`route: [{ u, v, alt, kt?, over?, flap?, gear?, bank? }]` - waypoints in the runway frame; heights flown as
straight lines between them, with a look-ahead so a change of slope is flown as a curve; `over: true` flies over
the point (a gate, a notch) instead of cutting the corner; `kt` is the indicated speed on the leg TO the point
(default Vref + 6/4/12/10 kt for the Skylark/Trailblazer/Condor/Hornet); `bank` raises the leg's bank limit
(default 30/32/25/30 degrees). After the last waypoint it joins the extended centreline and Autoland's own glide
path (3 degrees, 5 for the Trailblazer) and hands over once lined up, on the path, on speed and wings level for
3 s, or at the latest six seconds before the aim point. `game.setAutopilot(true)` uses it whenever the scenario
has a route. At the start of a flight it flies the whole route (a first leg may head away from the runway: a
downwind, a teardrop); switched on mid-flight it resumes at the leg the airplane is on, by progress along the
route and the airplane's track, not by `u`.

**The handover decides the landing.** Autoland (physics-owned, not edited, and nothing inside it is written) holds
the pitch it is handed and flies a proportional pitch loop, so the trim it inherits sets how the flare goes. The
Condor is handed the trim a stock approach starts with (Vref on the glide path, flaps 30), blended in during the
join: Harbor Cranes over ten seeds landed at 383-768 fpm (median 535) with the route's own trim and 189-679
(median 374) with the approach trim, against 283-529 (median 424) for a stock straight-in Autoland in the same
wind. The Skylark and the Trailblazer keep the spawn's trim (the approach trim made the Skylark land harder and the
Trailblazer float 150-200 m into Moose Creek's 340 m bar). The Condor still wants a straight final of 2 km or more
after the last obstacle for its best landings - and since 2026-09-22 Harbor Cranes does not give it one: its route
ends in an S-turn (`sCurve()` in util.js, two 1,147 m arcs, 27 degrees at 146 kt) that rolls out 400 m from the
threshold on the glide path, and the stock Autoland lands that crabbed in the mission's 70-degree wind (81 / 84 on
seeds 307 / 4271, the side-load and sink lines). That is the autopilot's landing, not the mission's ceiling.

What the suite proves it flies: the three missions on two seeds each; and, over a tower, a mast or a tree line
standing on the straight-in path, a descent of 7-10 degrees onto the final in the Condor (a 150 m tower, 7.5
degrees at 155 kt), the Skylark and the Trailblazer.

### Proving a mission

- `node tools/fly-mission.mjs <id> --node` - the flight in plain Node (real physics, terrain, field, runtime,
  pilots; no renderer). Seconds. `--seed N`, `--route JSON` (a deliberately bad line: prove the obstacle is real),
  `--pilot autoland` (straight in, obstacle-blind), `--track N` (a sample every N frames), `--set JSON`.
  `simulate(id, { scenario })` flies a scenario object that is not registered (a draft, a test course).
- `npm run web`, then `node tools/fly-mission.mjs <id>` - the same in the real page (headless Edge, the game's
  own `setAutopilot`); stills with `--shot DIR --at "u > -600@chase"` (cameras: chase, cockpit, tower, flyby,
  wing, or `view:u,v,h>u,v,h` for a fixed camera in the runway frame); `--render 5` draws every 5th frame and
  lists every shader program compiled after the first frame, with where (there must be none mid-flight).
  Edge ports: each worktree its own range (`--port`); `CTL_MISSION_DIR` is its scratch folder.
- `tools/test-obstacles.mjs` - add the new mission's flights to section 7 (landed on two seeds, and the wrong
  line crashing into what the mission is about); section 3 checks that the spawn is 40 m clear and that every
  point inside every gate can be flown wings level, section 4 that everything drawn is where it collides.

### Traps

- **Autoland is obstacle-blind**: a course that stands on the straight-in path needs a route, or every harness
  that flies it (looksheet, perf-probe, fly-mission) crashes. Conversely, keep the straight path blocked if the
  mission is about the obstacle: the suite's "wrong line" flights are how you know.
- **The spawn is above the terrain**, not above the course: a spawn inside a tower is a crash on the first frame.
- The decorative forest and villages are kept out of the course (`keepOut` circles, and along a route flown under
  45 m), but only in the look: collision is only ever the course's own volumes.
- **Draws**: a course is 3-5 instanced draws plus one light set at night, whatever its size (power-lines has
  1,226 volumes in 5 draws). Two "shadow primers" ride with the aircraft for the first half second and are then
  hidden: the engine compiles the world up front but not the shadow pass, so the first instanced caster to reach
  the sun's shadow box would otherwise compile a depth program mid-approach. A course without trees costs one
  extra program for that.
- **Culling a big course**: each of those draws is ONE InstancedMesh with one bounding sphere round the whole
  course, straight in the scene (the engine chunks only the terrain's own instanced meshes), so neither the camera
  nor the 180 m shadow box can skip part of it: fine for three missions of a kilometre or two, not for a city. A
  course spread over several kilometres should be drawn one InstancedMesh per district: a chunking step inside
  `buildCourse` (calling it once per district would share the program but add two shadow primers per call).
  `geom.js chunkInstanced` does not fit as it is: the course meshes carry per-instance attributes (`ctBox`,
  `ctSeed`, `ctTaper`) on the shared geometry, so a chunk needs its own geometry with those attributes re-packed.
- **Programs**: the limit is 70 with the cockpit showing, not just the chase view: harbor-cranes compiles 62 in the
  chase view and 67 once the Condor's cockpit has been shown. Count a new course with `perf-probe --camera cockpit`.
- **Leaderboard**: every new mission raises the most a career can score; the site's `src/games/lib/games.js`
  (`max`) and its Worker must follow, or careers above the cap are silently rejected. A site-session job: it was
  2,000 for the original twenty and went to **4,900** (49 x 100) with this expansion, Worker redeployed.

## The city ladder (Metro City and "The city", n 44-49)

*Written 2026-09-19 with the six missions of `src/missions/city.js`, on the engine above; revised the same week after
review (the Needle's line and cue, the arc law, the under-gates, the budget test).*

- **Metro City** (`CITY_SITES.metro`): the coast style, terrain seed 638 and `coastX` 500, found by scanning seeds for
  a coast that crosses the extended centerline (water under it 4 to 7.7 km out, land for the last 4 km). A 3,000 m
  runway heading north with ILS, lights and PAPI. Its course is the shared skyline: six generated districts (4,542
  buildings), Checkerboard Hill, the Harbor Bridge, Container Island, a sea wall. **Nothing in it touches the
  straight-in path** (the 3-degree path is 34 m clear at the closest, checked from 9 km out): free flight, Autoland,
  the looksheet and perf-probe fly it. Mission-only things (the avenue, the skybridges, the slalom towers, the
  Needle) live in the missions' courses.
- **Districts** grow round everything placed by hand: resolveCourse places the hand-placed kinds, then the gates, the
  `clear` circles and a low route's corridor, and only then the districts, which avoid all of those and the `carve`
  rectangles. A mission clears the SITE's blocks where its own towers stand with `carve` (its own districts are spared:
  Downtown's second row stands inside its carve), and gives that ground its own look with `ground` (`avenue`,
  `plaza`). A district adds coarse keep-out circles (230 m) for the forest instead of one per building (the terrain
  scans them linearly per tree), and no circle is kept out on the water.
- **The look** (`src/art/city-look.js`, its facade shader in `src/art/city-facades.js`) is the art department's:
  Codex's three passes of 2026-09-19 (briefs `docs/briefs/city/city-look.txt`, `city-look-2.txt` and
  `city-look-3.txt` for the day facades, with the correction `city-look-3b.txt`; all run). The header of
  city-look.js is the drawing contract, unchanged by those passes, which changed neither the flying nor the budget. `tools/test-obstacles.mjs` section 4 checks the
  contract (every drawn vertex inside its prim's volume, every prim's drawing filling it, over 17 kinds) and section 10
  the city's budget on every course a flight at Metro City builds (free flight and the six missions, at three tiers):
  at most 60 draws, 450k / 250k / 120k triangles a pass, and at most 6 programs of its own **counted by variant** (a
  material drawn with and without instance colours is two programs; the look compiles 3, and Checkerboard reaches 67
  of the scene's 70 with the cockpit shown). Shapes that cast a shadow are geometry: the shadow pass never runs a
  material's onBeforeCompile (the plain look's round frustums, the hill among them, are tapered geometry now).
- **Gates under something** (the skybridges, the bridge deck) are built by `underGate()`: the CG between a floor and
  the underside less the Condor's fin (`FIN`, 9.1 m; the hull's fin tops out at 9.02) and half a metre, so a crossing
  that takes the whole airplane under counts. (They used to stop 12 m under, and a clean pass 2-3 m under a skybridge
  scored MISSED GATE.) The tips and hints quote those heights from the same numbers (`altFt`, `raFt`).
- **Routes with arcs** (`arc: 'L' | 'R', r`): see the header of `src/systems/routepilot.js` for the arc law. The arcs
  have their own roll loop (a bank reference moved at no more than 15 degrees a second, tracked stiffly): the stock
  loop let a roll to 40 degrees overshoot to 46 and creep back, and the path loop chased the swing. Design the legs
  either side of an arc tangent to it; S-curves (`sCurve()` in city.js) are two arcs. Switched off and on inside an
  arc, RoutePilot keeps the arc's own circle (a chord from the airplane would cut inside it).
- **End a route on Autoland's path, including the CG height** (`onPath(u)` in city.js adds the Condor's 4.1 m), near
  Vref (146 kt), and let a level run under the path end where it meets it (`meetPath(alt)`). Handovers after short
  finals land firmer than a long straight-in, and Autoland lands crabbed, so a strong crosswind costs it about 20
  points whatever the route does: Checkerboard's wind is 11 kt from 25 degrees right (it was 12 gusting 18 from 50,
  where even a stock straight-in Autoland scored a median of 58 and RoutePilot 47, a third of its landings DAMAGED).
- **The Needle** (48, and 49's first gate): two lines through the same aim point. The pilot's is a 35-degree turn at
  150 kt in still air (NEEDLE_R 867 m) from the line the flight starts on; the tips describe it, and the HUD hint is a
  flight director on it (`needleCue`: a countdown to the roll, then the bank to hold, which the wind moves: 29-33
  degrees at the eye in both missions' winds). RoutePilot's is a 40-degree turn through the same eye (NEEDLE_R_AP
  723 m). The gap is 34 m: the Condor's probe footprint is 35.0 m wings level (winglets), 31.3 at 30 degrees, 29.9 at
  35, 28.2 at 40, 26.3 at 45, and its middle leans about a metre toward the low wing, so the gap's middle sits
  NEEDLE_LEAN inside the aim point and the gate frame is centred on the aim point. A 33 m gap left a pilot held to
  the Assist's 35 degrees about a metre at the 29-33 degrees the director asks for. **TIGHTEN LATER** (NEEDLE_GAP,
  NEEDLE_BANK, NEEDLE_AP_BANK in city.js) once the flight-physics review removes the Assist's bank limit.
- **What the suite proves** (`tools/test-city.mjs`): RoutePilot on ten seeds per mission (no crash, every gate on nine
  or more, a median of at least 60), the wrong line into each obstacle, the autopilot switched off and on 300 m
  before the eye, and a pilot who does only what the HUD hint says, never past 35 degrees: through the eye on every
  seed in the Needle's wind and on 8 of 10 in the Gauntlet's 18-kt gusts, where the Assist's limit leaves about a
  metre (RoutePilot, at 40 degrees, gets through on all of them).
- **Perf** (`tools/perf-probe.mjs`, the RTX 4080, 1920x1080, high, after the review fixes): Checkerboard in the chase
  view 357 fps median (p95 313), 132 draws (24 in the shadow pass), 456k triangles (112k shadow), 62 programs, GPU
  1.3 / 2.3 ms at p50 / p95; in the cockpit 345 fps median, p95 44 (GPU p95 22 ms: the spikes the stock heavy
  challenge's cockpit shows too), 116 draws, 398k triangles, 67 programs of the 70 allowed. Flown in the page, no
  city mission compiled a shader after its first 0.2 s. Checkerboard is in perf-probe's BUDGET_MATRIX (chase and
  cockpit): the scene the city's art pass is held to.
- **Measuring on the Intel proxy**: `--gpu intel` pins an adapter by a LUID that changes at every boot; perf-probe now
  refuses the run when the page renders on another vendor's GPU. Read the current LUIDs (dxgi EnumAdapters1) and pass
  `--gpu <high,low>`. The review measured the phone proxy that way (UHD 770, phone medium): Checkerboard 7.0 / 8.0 ms
  GPU at p50 / p95, 71 fps, loadSite 2,350 ms, against the stock heavy challenge's 7.0 / 9.2 ms, 56 fps, 1,912 ms.
