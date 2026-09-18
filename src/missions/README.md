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
  hint: (ctx) => ctx.ra > 300 ? 'Line up on the gap before the towers.' : null,   // ctx = { ac, ra, d, t, mission }
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
- `ObstacleField.plan(site, sc)` returns a resolved course (world-space volumes, gates, `keepOut` rectangles for the
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

**Free flight** is `buildFreeFlight(options, { sites, seed })` in `src/missions/free.js` (`makeFreeFlight` in
`scenarios.js` delegates to it). The options are saved as `ctl.free` and cleaned by `validateFreeOpts()` on every load,
so a stale site, aircraft or failure id falls back instead of throwing. The scenario it returns:

- `id: 'free'` (never logged, never on the leaderboard), `aircraft`, `site`, `time`, `vis`, `weight`, `spawn` (a bush
  strip starts close in, at most 1,500 m out, low over the trees), `scoring.type` from `site.kind`.
- `wind: { dir, speed, gust, turb, shear }`, `dir` absolute (the builder stores the wind relative to the landing
  direction, `windRel`). A gust equal to the wind speed means no gusts.
- `weather: { preset, rain, snow, dust, darkness, ceiling, lightning, events }` from the preset tiles and the Advanced
  drawer; the wind shear toggle adds `{ type: 'microburst', at: { type: 'dist', value: 2500 } }`; `seaState` only on
  the carrier.
- `failures`: only names whose catalogue entry has no `applies()` or whose `applies(def)` is true. The trigger is the
  entry's `freeAt` when it has one, else the moment the pilot picked: a seeded `window` when `shouldTrigger` supports
  it, otherwise an altitude worked out from the options (never `Math.random()`). "Surprise me" deals one of them from
  the flight seed, with `silent: true`, and sets `surprise: true`.
- **`course: false`** when the pilot switched obstacles off. It means *no obstacles at all* for this flight: neither a
  mission course, nor the site's own `course`, nor the site's `obstacleTrees` (the Gravel Bar's tree wall). The engine
  honours it where the world is built (`loadSite` in `main.js` and `ObstacleField.plan`); the builder only offers the
  switch at a place that has something in the way.

Places the chosen aircraft cannot use are shown disabled with the reason: a runway shorter than
`def.approach.runwayNeed`, or the carrier without a hook.
