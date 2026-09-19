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

## The obstacle engine (for course builders: the city ladder is built on it)

*Written 2026-09-18 with the three "In the way" missions (`src/missions/obstacles.js`: power-lines, the-notch,
harbor-cranes), which are its worked examples. The full reference for every kind is the header of
`src/world/obstacles.js`; this is the map.*

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
  are above the threshold elevation. A route's `alt` is the **CG's** height above the threshold elevation. The
  ground under an approach is rarely at the threshold's height (Moose Creek's notch stands 6 m above the bar,
  Harbor City's water is 8 m below its runway): quote heights in a description only after the suite prints them.
- **Names** read "Hit " + name in the debrief: give them their article (`'the lowered crane boom'`, `'a pylon'`).
- **A new kind** is one function in `BUILD` using the `Placer` (`box`, `beam`, `cyl`, `cap`, `wire`, `light`,
  `keep`); the look draws whatever volumes it makes, by their `look` (`building`, `plain`, `hull`, `container`,
  `steel`, `wire`, `marker`, `tree`, `trunk`, `truss`, `concrete`, `white`, `wood`, `insulator`), and the suite's
  "drawn = collides" check covers it with no new test code.
- **Gates** are markers (drawn, never solid): passed when the CG crosses the plane inside the frame in the gate's
  direction, missed when it crosses outside (within 900 m of the frame). A required gate missed or never reached
  caps the landing at `MISSION_CAP` (30) with the grade `MISSED GATE`; a bonus gate adds its points; the total is
  clamped to 100. The HUD status line reads `Gates 1/3 · the harbor exit 1.2 km`.

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
has a route.

What the suite proves it flies: the three missions on two seeds each; and, over a tower, a mast or a tree line
standing on the straight-in path, a descent of 7-10 degrees onto the final in the Condor (a 150 m tower, 7.5
degrees at 155 kt), the Skylark and the Trailblazer. Autoland's own Condor flare lands firm to hard (470-730 fpm)
whatever hands it over; it is physics-owned and not edited. Give the Condor a straight final of 2 km or more
after the last obstacle if its landing should score well.

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
  extra program for that (the harbor: 62 of the 70 allowed).
- **Leaderboard**: every new mission raises the most a career can score; the site's `src/games/lib/games.js`
  (`max: 2000`) and its Worker must follow, or careers above the cap are silently rejected. A site-session job.
