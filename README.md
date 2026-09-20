# Cleared to Land — Airplane Landing Challenges

*Every flight is the last three miles.*

Every flight starts on final approach. Your job is the last three miles: crosswinds,
a 60-tonne jet that does not want to slow down, engines that quit, a nose gear that
won't come out, a carrier deck that moves, gravel bars between the trees, and a stall
that behaves like the real thing. Then thunderstorms, microbursts, whiteouts, power
lines across short final, and an airliner through a gap between two towers.

## Play

**Double-click `PLAY.cmd`** (opens the game in an app window in Chrome or Edge),
or just open `CTL.html` in any modern browser. Nothing to install; the whole
game is that one file. Chrome or Edge recommended; use a real GPU if you have one.

Play it online at **https://goodmarc.com/cleared-to-land/** (same build).
On a phone or tablet, the same address: turn it sideways and the touch controls appear
(see "On a phone or tablet" below). Android: the browser menu's "Add to Home screen" installs
it as a full-screen landscape app.

Go through the MISSIONS door, click a challenge, read the briefing, press **Fly**.

## Controls

Pitch is flight-stick style: pull back (down arrow, mouse toward you, stick back) to raise the nose.
Settings has an "Invert pitch" switch if you prefer the other way.

| Key | Action |
|-----|--------|
| Arrow keys | Pitch, flight-stick style (down arrow = pull back = nose up; up arrow = nose down) and roll |
| Q / E | Rudder |
| W / S | Throttle up / down (F1 idle, F4 full) |
| F / V | Flaps down / up one notch |
| G | Landing gear |
| Space or B (hold) | Wheel brakes |
| R (hold) | Reverse thrust (jets, on the ground) |
| K | Spoilers: arm before landing, or toggle speedbrake in flight |
| L | Autobrake (airliner): off / medium / max |
| H | Tailhook |
| T / Y (or Home/End) | Trim nose up / down |
| A / D / U | The emergency drills. They do nothing until something has broken. **A** is the fire handle: it shuts that engine down and puts the fire out (it also shuts down an engine left surging by a bird). **D** is the stabilizer trim cutout, which is the only thing that stops a runaway trim. **U** is the fuel cutoff: every engine off, levers to idle and the fuel gone 2.5 seconds later. Above 300 ft the cutoff asks first and you press again; in the flare, where the drill actually uses it, one press does it. Whichever one is on offer is named on the controls strip (and on a button on a phone) |
| 1–5, X, Tab | Cameras: chase, cockpit, tower, fly-by, wing; X/Tab = next |
| Right mouse drag | Swing the chase camera anywhere around the airplane, above or below it; it stays where you leave it (get down low and watch the wheels touch). In the cockpit and wing views it turns your head; in the tower and fly-by views the wheel zooms. Mouse wheel zooms the chase camera when the mouse is not captured |
| , / . and 0 | Orbit the camera left / right with keys; 0 puts it back behind the tail (or your head straight ahead) |
| J / I / O | Look left / right / back |
| M | Toggle the HUD |
| N | Toggle hints |
| P | Pause · Esc: menu (or release the mouse) |
| Mouse | Click the view for a mouse yoke (pull back = nose up); wheel = throttle, and past idle the wheel applies the brakes; Esc releases |
| Controls strip | The bottom edge shows the keys that matter right now and lights the one you press (Settings to hide) |
| Gamepad | Left stick flies, right stick rudder/look, triggers throttle, A gear, X/Y flaps, B brakes, LB hook, RB spoilers, D-pad trim, Start pause, Back next camera, right stick click = whichever emergency drill is on offer |

### On a phone or tablet

Touch controls switch on by themselves on a touch screen (Settings > Touch controls to force
them on or off). Landscape only: in portrait the game pauses and asks you to turn the phone.

| Control | What it does |
|---------|--------------|
| Right side of the screen | A dimmed stick rests there; touch anywhere on the right and it jumps under your thumb. Pull down = nose up, push up = nose down, left / right = bank. Same flight-stick convention as the keys; Settings > Invert pitch flips it. Settings > Stick puts it under the left thumb instead, with the throttle and rudder on the right |
| THR slider (left edge) | Throttle. It stays where you leave it |
| RUDDER slider (bottom left) | Rudder, and nose-wheel steering on the ground. Springs back to the middle |
| BRAKES, REV (bottom left, above the rudder) | Hold. Reverse thrust only on the jets |
| FLAPS ▼ ▲, GEAR, HOOK, SPLR, ABRK (top left) | Tap. Only the buttons the aircraft has are shown |
| TRIM ▲ ▼ (top left) | Hold to run the trim |
| FIRE, TRIM CUT, FUEL CUT (right side) | Only when something has broken, and only the drill that failure needs: top right with the default stick, lower right with the other layout. A red button means do it now |
| CAM, ❚❚ (top right) | Next camera, pause |
| Left side, between the controls | Drag to swing the chase camera anywhere around the airplane (or turn your head in the cockpit and wing views), pinch to zoom, double-tap to put it back |
| Tilt the phone | Optional: Settings > Tilt to fly. However you are holding it when the flight starts is neutral; tilt it toward you for nose up, bank it to roll. TILT (bottom left) resets neutral. The stick still works |

The HUD is drawn smaller on a phone, hints and briefings name the buttons instead of keys, and
the graphics start one tier down (Settings > Graphics quality). If frames run long the game
scales its render resolution down by itself (the HUD stays sharp), then the shadows, the bloom
and the post-processing, and steps back up when there is room again; Settings can switch that
off. Phone calls and app switches pause the game.

Most challenges start on short final, about 20 seconds from touchdown, and Settings
lets you choose a medium or long approach instead. A few start where the mission needs
them — out at the edge of a storm, up a valley, or already inside the cloud — and those
do not move.

**Control feel.** The default is *Assisted*: the arrow keys (or the mouse) command a
bank angle and a pitch attitude at realistic rates for the aircraft, the airplane
levels itself when you let go of roll, and it holds the pitch you leave it at. The
aerodynamics underneath are untouched: pull too much for the speed and it still
stalls, crosswinds still push you, energy still has to be managed. T/Y nudge the
held pitch. Assisted mode also has a yaw damper with turn coordination, like an
airliner's: it settles the tail-wagging after a gust or a rudder tap and keeps the
nose coordinated when you roll, and it fades out when you use the rudder yourself,
so a crosswind de-crab is still your own feet. *Direct* mode (Settings) gives raw
control surfaces, with keyboard authority limited to 75% (hold Shift for full) and
trim limited to a sane range.
Brakes are progressive with anti-skid; hold Space and they build up over about a
second and a half.

## How to land

1. **Pitch for airspeed, throttle for the descent rate.** Keep the airspeed on the
   blue bug (Vref). The red bug is the stall speed.
2. **Put the green flight-path circle on the touchdown point.** That circle shows
   where the airplane is actually going. Keep the PAPI lights (left of the runway)
   two white / two red, or the glideslope needle centered.
3. **Flare.** Over the threshold, throttle to idle, raise the nose a few degrees,
   and keep a light pull on as it slows: in Assisted mode the airplane settles
   onto the runway by itself if you stop pulling, holds off while you keep a
   gentle pull, and balloons and drops in if you haul back. Big jets: flare at
   30 ft, 2–3 degrees, do not exceed 10 degrees of pitch on the ground (tail strike).
4. **Crosswind.** Crab into the wind on final so the runway stays centered. In the
   flare, straighten the nose with rudder and lower the upwind wing. Touching down
   with the nose pointing sideways scrubs the tires and is scored.
5. **Carrier.** No flare. Hook down, full flaps, hold 8.1° angle of attack (green
   mark on the AoA gauge, about 135 kt), fly the ball (amber ball level with the
   green datum lights) down a 3.5° glideslope, and fly it into the deck. Full power
   at touchdown in case you bolter. Target the 3-wire.
6. **Bush.** Steep, slow, full flap. Over the trees, chop the power, three-point
   attitude. Brake gently: a taildragger flips if you stand on the brakes.
7. **Stall.** When the horn sounds, lower the nose and add power. If it breaks, the
   nose drops and a wing drops: nose down first, then power, then level the wings.
   Do not pull hard during the recovery (secondary stall).

## Scoring

Touchdown sink rate, distance from the aiming point, centerline, side load (crab),
bank, speed vs Vref, nose-wheel-first, tail/prop strikes, bounces, stalls on the
approach, rollout (stayed on the runway, stopped before the end), go-arounds, and
approach stability. Carrier passes are graded LSO-style: wire, ball, lineup, AoA.
Grades: CLEARED TO LAND · SMOOTH · FIRM · HARD · DAMAGED · CRASH. A mission with gates adds its
own lines: a required gate missed or never reached caps the landing at 30 with the grade MISSED
GATE, a bonus gate adds points, and a failure you dealt with properly (a belly landing you were
asked for) is not counted against you. Best scores are saved in
the browser, each under the logbook name you give it: the first new best asks for a
name, the browser remembers it, and the debrief (or Settings) lets you change it.

## The 49 challenges

Twelve groups, roughly in the order they stop being reasonable. The first twenty are
the original list; the rest arrived with the missions expansion.

| Group | Challenges |
|---|---|
| **Basics** | First Solo · Crosswind 15 · Gusty |
| **Heavy iron** | Heavy Metal · Short & Heavy · No Flaps · Fog |
| **Something broke** | Dead Stick · Nose Gear · One Engine · Jammed Elevator · Brake Failure · Ice |
| **The stall** | Slow Flight · Stall Recovery |
| **Boat** | Carrier Qual · Night Trap |
| **Bush** | Bush: Gravel Bar · Bush: One-Way Strip |
| **Storms** | Squall Line · Microburst · Storm Trap · Night Storm Trap · Thunderstorm |
| **Things break** | Stuck Throttle · Runaway Trim · Bird Strike · Unreliable Airspeed · Belly Landing · Engine Fire · Jammed Aileron · Dark Cockpit · One Wheel · No Ball |
| **In the way** | Power Lines · The Notch · Harbor Cranes |
| **The city** | Checkerboard · Downtown · Slalom · Under the Bridge · The Needle · The Gauntlet |
| **Far places** | Hill Hop · Beach Buzz · Mesa Top · Whiteout · Dust Wall |
| **Chaos** | Roulette |

Plus **Free Flight** with your own aircraft, field, wind, weather, time, visibility,
weight and malfunctions.

**Storms and weather.** Weather is now a model rather than a backdrop: precipitation,
an overcast that dims the world, a cloud base you fly down through on the needles,
lightning, a sea state for the ship, and scheduled events that happen to you on the
way down — a gust front that swings the wind sixty degrees half a mile out, a squall,
a turbulence burst, a visibility drop, and a microburst built on the standard
downburst model, which gives you a few knots of free airspeed and then takes three
thousand feet a minute of descent for it. It rains itself out in about two minutes,
so going around and coming back is a real choice rather than a polite fiction. Rain
wets the runway and takes about 40% of the grip with it.

**Things break.** Ten harder failures, all of them things you have to do something
about rather than things you merely endure: an engine fire, a throttle jammed at
climb power, a stabilizer trim running away nose down, a pitot tube icing over so the
airspeed lies to you slowly, a bird through the windshield and another down an engine,
a jammed aileron (roll with the rudder), a dead electrical system at night, a main
wheel that is simply gone, a gear that will not come out, and a carrier lens that has
gone dark so the LSO is all you have. Three of them need a drill: **A** the fire
handle, **D** the trim cutout, **U** the fuel cutoff. The keys are live only while the
failure that wants them is, and the game tells you which one it wants.

**Things in the way.** An obstacle engine carries towers, masts, power lines with
sagging wires and marker balls, bridges you fly under, cranes, ships, container yards
and tree walls, plus gates you have to fly through in order. Every probe point on the
airframe — nose, tail, fin, wings, nacelles, flaps, wheels — is swept from last frame's
pose to this one against everything near the path, so a twelve-centimetre cable is
caught at 250 kt and a mast cannot slip between two probes on the wing. Pass within
five metres of something and the game tells you how close; the debrief quotes the
closest shave. A missed gate caps the landing, and a go-around mends the miss.

**Four new places.** Kestrel Island is 650 m of asphalt behind a ridge, with a road
across the saddle you cross a few metres above the cars, and a beach at the far end.
Paradise Bay is an airliner field whose threshold sits sixty metres behind a public
beach and the coast road. Frostbite Lake is an ice runway ploughed on a frozen lake,
where whichever way the wheels are pointing is the way the airplane goes. Red Mesa is
a 500 m dirt strip on a 150 m sandstone cliff, with the wind pouring over the rim at
you. There is also Moose Creek Notch, a gravel bar behind a wall of spruce with one
gap in it, which exists only for the mission that flies through it.

**Metro City.** A ladder of six rungs, each less reasonable than the last, at a city
of four and a half thousand buildings with a harbour bridge, a checkerboard on a hill
and an avenue with skybridges across it. Point the airliner at the checkerboard and
turn right onto a runway hiding behind the apartment blocks; fly three kilometres down
Grand Avenue below the rooftops; weave through three pairs of skyscrapers; go under
the Harbor Bridge at a hundred feet with nine metres of fin above you; turn onto final
through a 34 m gap between two glass towers in a 35-degree bank when the airplane is
35 m across; and then do four of those in one approach, at night, in a thunderstorm.
Nothing the city builds stands on the straight-in path, so the ordinary approach to
Metro City is still an ordinary approach.

**The home screen** is three doors over the live airfield: AIRCRAFT (the hangar),
MISSIONS (the groups, with the city drawn as a ladder of rungs) and FREE FLIGHT, with
a quieter fourth for settings, controls and the logbook. Free flight is built in four
steps — aircraft, place, weather, trouble — and each one tells you what the choice
before it ruled out: a field too short for the airplane is greyed out with the reason,
and a place with nothing in the way says so. Weather is a preset (clear, overcast,
rain, thunderstorm, snow, dust storm, fog) with an Advanced drawer behind it for wind,
gusts, turbulence, wind shear, visibility, cloud base, precipitation, lightning and
the sea state; trouble is any malfunction the aircraft can have, at a moment you pick,
or Surprise me. Obstacles can be switched off entirely where there are any.

## Aircraft

- **Skylark 172** — light high-wing trainer. Stalls at 49 kt clean, 42 with flaps.
- **Trailblazer** — bush taildragger on tundra tires. Lands in 120 m, ground-loops if you let it.
- **Condor 700** — twin-jet airliner, 48–66 t. Spool lag, spoilers, reversers, autobrake.
- **Sea Hornet** — carrier fighter with a tailhook. On-speed AoA 8.1°.

## Building from source

```
npm install
npm run build      # -> CTL.html (single file) and dist/
npm run dev        # watch + dev server on http://127.0.0.1:8123
npm test           # headless: physics, control law, yaw, scoring, stall, flare, carrier trap,
                   #   camera, free flight, art contracts, weather, failures, the new maps,
                   #   the obstacle engine, the city ladder
npm run perf-probe # frame-time measurement on a real GPU (needs Microsoft Edge); see docs/PERF.md
```

The four aircraft are free CC-BY models from poly.pizza (see `CREDITS.md`),
bundled into the single file; everything else (terrain, airports, carrier, trees,
textures, sounds) is procedural. See `docs/PLAN.md` for the design and
`docs/PHYSICS.md` for the flight model.

Console helpers while flying (F12): `game.setAutopilot(true)` flies the approach and
lands for you (demo), `game.timeScale(4)` speeds up time, `game.debugView(x,y,z)`.

## Project layout, and contributing

- `src/physics/`, `src/systems/` - the flight model and the control laws (`docs/PHYSICS.md`). Numbers
  there come from real aerodynamics and are guarded by `npm test`; they are not tuned to make
  something look better.
- `src/world/` - what the world IS (heightfield, runways, the carrier, obstacles).
- `src/missions/` - the challenges themselves: one file per group, the places they fly to, and the
  free-flight builder. `src/missions/README.md` is the contract between the mission data and the
  engines that read it - the weather model, the obstacle field and its gates, the failure runtime,
  the mission runtime and the route pilot - and it is where a new mission starts.
- `src/art/` - what it LOOKS like: sky, ground, forests, water, aerodromes, the carrier, the airframes,
  the cockpit interiors, the effects. `src/art/README.md` is the contract between the two halves;
  every export there is checked by `tools/test-art.mjs`.
- `src/main.js`, `src/ui/`, `src/touch.js`, `src/camera.js`, `src/cockpit.js` - the game itself.
- `tools/` - build, packaging, the headless test suites, `perf-probe.mjs` (frame times, budgets),
  `cockpit-sheet.mjs` and `surfshot.mjs` (deterministic stills).
- `AGENTS.md` - the house rules for anyone, human or AI, working here. `docs/PLAN.md` is the design,
  `docs/PERF.md` the performance notes and budgets, `docs/CHANGELOG.md` what changed and when.

Pull requests are welcome. `npm test` and `npm run build` must pass (the CI workflow runs both), the
game must stay one self-contained HTML file with no external requests, and a change to the look
should come with before/after stills from the tools above.

## License

MIT (see `LICENSE`). Built with [three.js](https://threejs.org).
