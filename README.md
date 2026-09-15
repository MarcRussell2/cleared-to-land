# Cleared to Land — Airplane Landing Challenges

*Every flight is the last three miles.*

Every flight starts on final approach. Your job is the last three miles: crosswinds,
a 60-tonne jet that does not want to slow down, engines that quit, a nose gear that
won't come out, a carrier deck that moves, gravel bars between the trees, and a stall
that behaves like the real thing.

## Play

**Double-click `PLAY.cmd`** (opens the game in an app window in Chrome or Edge),
or just open `CTL.html` in any modern browser. Nothing to install; the whole
game is that one file. Chrome or Edge recommended; use a real GPU if you have one.

Play it online at **https://goodmarc.com/cleared-to-land/** (same build).
On a phone or tablet, the same address: turn it sideways and the touch controls appear
(see "On a phone or tablet" below). Android: the browser menu's "Add to Home screen" installs
it as a full-screen landscape app.

Click a challenge, read the briefing, press **Fly**.

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
| 1–5, X, Tab | Cameras: chase, cockpit, tower, fly-by, wing; X/Tab = next |
| Right mouse drag | Swing the chase camera anywhere around the airplane, above or below it; it stays where you leave it (get down low and watch the wheels touch). In the cockpit and wing views it turns your head; in the tower and fly-by views the wheel zooms. Mouse wheel zooms the chase camera when the mouse is not captured |
| , / . and 0 | Orbit the camera left / right with keys; 0 puts it back behind the tail (or your head straight ahead) |
| J / I / O | Look left / right / back |
| M | Toggle the HUD |
| N | Toggle hints |
| P | Pause · Esc: menu (or release the mouse) |
| Mouse | Click the view for a mouse yoke (pull back = nose up); wheel = throttle, and past idle the wheel applies the brakes; Esc releases |
| Controls strip | The bottom edge shows the keys that matter right now and lights the one you press (Settings to hide) |
| Gamepad | Left stick flies, right stick rudder/look, triggers throttle, A gear, X/Y flaps, B brakes, LB hook, RB spoilers, D-pad trim, Start pause, Back next camera |

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
| CAM, ❚❚ (top right) | Next camera, pause |
| Left side, between the controls | Drag to swing the chase camera anywhere around the airplane (or turn your head in the cockpit and wing views), pinch to zoom, double-tap to put it back |
| Tilt the phone | Optional: Settings > Tilt to fly. However you are holding it when the flight starts is neutral; tilt it toward you for nose up, bank it to roll. TILT (bottom left) resets neutral. The stick still works |

The HUD is drawn smaller on a phone, hints and briefings name the buttons instead of keys, and
the graphics start one tier down (Settings > Graphics quality). If frames run long the game
scales its render resolution down by itself (the HUD stays sharp), then the shadows, the bloom
and the post-processing, and steps back up when there is room again; Settings can switch that
off. Phone calls and app switches pause the game.

Every challenge starts on short final, about 20 seconds from touchdown. Settings
lets you choose a medium or long approach instead.

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
Grades: CLEARED TO LAND · SMOOTH · FIRM · HARD · DAMAGED · CRASH. Best scores are saved in
the browser, each under the logbook name you give it: the first new best asks for a
name, the browser remembers it, and the debrief (or Settings) lets you change it.

## The 20 challenges

First Solo, Crosswind 15, Gusty, Heavy Metal, Short & Heavy, Dead Stick, No Flaps,
Nose Gear, One Engine, Jammed Elevator, Ice, Brake Failure, Fog, Slow Flight, Stall
Recovery, Carrier Qual, Night Trap, Bush: Gravel Bar, Bush: One-Way Strip, Roulette.
Plus **Free Flight** with your own aircraft, field, wind, time, visibility, weight
and malfunctions.

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
npm test           # headless: physics, control law, yaw, flare, carrier trap, camera, art contracts
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
