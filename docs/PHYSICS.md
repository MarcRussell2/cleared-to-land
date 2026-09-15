# Flight model notes

All physics lives in `src/physics/`. SI units, radians. Body frame: forward = -Z,
up = +Y, right = +X (matches the meshes). Aero convention for rates and moments:
p roll-right, q pitch-up, r yaw-right, mapped as p = -ω.z, q = ω.x, r = -ω.y.

## Aerodynamics (`aero.js`)

Coefficient model with stability derivatives per aircraft (`aircraft/defs.js`).
The Skylark numbers come from the well-known Cessna 172 dataset (Roskam /
Napolitano); the others are scaled from public figures for their class.

**Lift curve with a real stall.** `wingCL(alpha)`:

- linear region `CL = CL0 + CLα·α` (flaps add to CL0 and lower the stall angle),
- a rounded peak (parabola of half-width `round`) so CLmax is reached smoothly,
- a stall break: a smoothstep blend of width `breakWidth` from the peak into a
  post-stall curve `0.9·sin(2α)·(1 + retention·(…))`. Sharp-stalling wings (trainer,
  bush plane) use a narrow break and low retention; the swept airliner and the
  fighter with its leading-edge extensions stall gently and late (30° for the Hornet).

Stall side effects, scaled by how far into the break you are: lift loss, a jump to
flat-plate drag, a nose-down pitching moment, buffet (random small moments and
camera shake), a wing drop (rolling moment with a per-flight random sign that
slowly varies), and 75% loss of aileron effectiveness. The stall warning fires
`warnMargin` (3–6°) before the break, i.e. a few knots above the stall.

Verified headless (`npm test`): holding altitude at idle, the Skylark warns at
47.6 kt, breaks at 44 kt and 16.7° AoA, then sinks at ~3,000 fpm with a 30° wing
drop. Glide ratio with the engine failed: 9.8:1 at 68 kt (POH: ~9:1).

**Other terms.** Induced drag `K·CL²` with a ground-effect reduction
`σ = (16h/b)² / (1 + (16h/b)²)` and a matching lift boost (this is what makes the
airplane float in the flare); flap, gear, spoiler and sideslip drag; side force
from sideslip; pitch damping, dihedral effect, roll damping, weathercock stability,
yaw damping, adverse yaw. Control moments use the dynamic pressure at the tail,
which includes propeller slipstream on the prop aircraft so the elevator and rudder
keep some authority at low speed with power on.

## Rigid body (`aircraft.js`)

Semi-implicit Euler at ~250 Hz sub-steps. Forces: aero (body), engine thrust with
offset moments (asymmetric thrust yaws the airliner, under-slung engines pitch up),
gravity, contacts, and the arresting wire. Angular: `ω̇ = I⁻¹(τ − ω×Iω)`, quaternion
integrated with body-frame increments.

**Engines.** Jets: first-order spool with a slower time constant below 55% (the
airliner needs ~4 s from idle), idle thrust, mild speed lapse, reverse thrust on
the ground. Props: power-limited thrust `min(T_static, P·η/V)` with a windmilling
drag term when failed.

**Landing gear.** Each leg is a spring-damper at the wheel bottom. Normal force
`k·pen + c·ṗen` with a hard stop past the oleo travel. Tire forces use a pseudo-slip
model (`μN·clamp(v/v_slip)`) lateral and longitudinal, limited by a friction
circle, with steering on the nose/tail wheel (fading with speed). Friction and
roughness come from the surface (asphalt 0.85, gravel 0.62, grass 0.55, deck 0.8).
A leg collapses above its load limit. Touchdown is the first wheel contact after
being airborne; re-contact after >0.3 s airborne is a bounce.

**Fuselage contact points** (nose, tail, wingtips, belly, nacelles) allow tail
strikes, prop strikes, belly landings and cartwheels, each with an impact-speed
threshold for "damage" vs "crash".

**Taildragger.** The bush plane's main wheels are ahead of the CG, so the ground
model produces the real directional instability (ground loop) and the nose-over
tendency under hard braking without any special code.

**Tailhook and wires.** The hook tip is a contact point (it can skip on the deck).
Each sub-step the tip's position in landing-area coordinates is compared with the
wire positions (50/62/74/86 m from the ramp, 12 m apart like a Nimitz-class deck);
crossing a wire with the tip within 0.45 m of the deck engages it. The wire then
applies a deceleration ramping to 28 m/s² (~2.9 g) opposite the deck-relative
velocity, acting at the hook so the nose is pulled down, until the aircraft is
stopped relative to the deck. Passing the last wire on the deck without engaging
is a bolter.

## Wind (`wind.js`)

Steady vector + gust factor (summed sines, 4–31 s periods) + direction wander +
3-axis turbulence that also varies with position, amplified below 60 m
(mechanical turbulence) + a power-law height gradient with a configurable extra
low-level shear. The reported wind in the HUD is the surface wind.

## Carrier deck (`world/carrier.js`)

The ship moves at 25 kt; the deck heaves, pitches and rolls with the sea state.
Ground queries transform into ship coordinates (yaw only, then the full transform
for the deck height and normal) and return the deck velocity so the tires roll
relative to the moving deck. A point behind the round-down below deck level is a
ramp strike. The meatball is a 3.5° glideslope to the hook touchdown point between
wires 2 and 3, 0.32° per cell.

## Handling pass (2026-09-10)

Marc's verdict on the first public build: too slow, too light, the airliner too delayed, the bush
plane "like a feather" that "flops around". Changes, all in `aircraft/defs.js` unless noted:

- **Keys** (`input.js`): full deflection in ~0.25 s instead of ~0.45 s, and they let go faster.
- **Command rates** (assist mode): pitch 5→7°/s and bank 30→42°/s on the Skylark, 6→8 / 40→52 on
  the Trailblazer, 2.5→4 / 12→20 on the Condor, 8→10 / 55→75 on the Hornet; tighter attitude gains.
- **Self-levelling halved** (`levelRate`): let go of the roll key and the airplane comes back to
  wings level at 4.5–9°/s instead of 7–14. You fly the wings level yourself; it still helps.
- **Trailblazer stability**: Cub-class numbers instead of trainer numbers. Weathercock `Cnb`
  0.058→0.08, yaw damping `Cnr` −0.09→−0.13, roll damping `Clp` −0.45→−0.50 with ailerons
  `Clda` 0.16→0.17 (so it settles without losing roll rate), pitch stiffness `Cma` −0.75→−0.9 and
  damping `Cmq` −10.5→−12.5, inertias up ~10% (struts, tundra tires). Values bracket published
  PA-18 / Husky derivative sets; the C172 set (Roskam/Napolitano) stays on the Skylark.
- **Surface actuation** (`controls.rate`, full travel per second): Skylark 4→5.5, Trailblazer
  4.5→6, Condor 2→3.2, Hornet 3→4. The airliner's hydraulics no longer feel like a delay line.
- **Jet spool**: Condor `tauUp` 1.6→1.05 s (`tauDown` 1.1→0.8), Hornet 1.1→0.8; the extra lag
  below 55% N1 (`aircraft.js`) is ×1.35 instead of ×1.7. Still slower than a prop, still a game.
- **Flare** (`flightControl.js`): below flare height with the power off, the pitch command moves at
  70% rate so a light pull stays a light pull. `test-flare.mjs` guards this (light pull → soft
  touchdown within 7 s).
- More control power on the Condor: `Cmde` 1.45→1.6, `Clda` 0.12→0.15.

`npm test` covers all of it: control signs, stall speeds, autoland for every aircraft, the assisted
control law's step responses (the level-after-release check now measures 12 s after release), the
flare float, and the carrier trap.

**Pitch sign convention (input side, 2026-09-10).** Positive pitch input = elevator up = nose up. The
DOWN arrow, the mouse pulled back and the stick pulled back all produce positive input (flight-stick
style); Settings > Invert pitch multiplies all three by -1 in `flightControl.js`.

## Yaw pass (2026-09-14)

Marc's complaint: "the planes are too unstable in the yaw, and the rudder is so strong that you could
turn the plane sideways and stall it." A headless harness reproduced both before anything was changed
(full rudder held at Vref with the wings held level, in the assisted mode players use):

| Before | steady sideslip | peak | peak alpha | stalled | bank / ailerons |
|---|---|---|---|---|---|
| Skylark | 30° (41° peak); 51° at full power | | 11° / 35° | no / **yes** at full power, rolled to 130° | 18° |
| Trailblazer | 39° | 56° | 33° | **yes**, 2.7 s after the pedal went in | 73° |
| Condor | 22° | 28° | 14° | no, but ailerons pinned at 100% and rolled to 71° | 71° / 100% |
| Hornet | 23° | 43° | 23° | no | 20° |

and a 1.2 s full roll input in assist mode swung the nose to 24° (Skylark) / 19° (Trailblazer) of
sideslip with the ailerons saturated: that nose swing on every bank input is what "unstable in yaw"
felt like. The Dutch roll itself was never divergent (assist-mode damping ratio 0.31 / 0.29 / 0.21 /
0.14 for Skylark / Trailblazer / Condor / Hornet, measured from the sideslip after a rudder doublet).

**What was wrong, in order of size.**

1. **Propwash boosted the rudder but not the fin.** The rudder term was multiplied by `qTail/qbar`
   (1.3 at approach power, 2-4 at full power and low speed, uncapped) while the weathercock `Cnb` and the
   yaw damping `Cnr` stayed on the freestream. Steady sideslip is `Cndr·δr / Cnb`, so power alone
   doubled to quadrupled it. The vertical tail sits in the slipstream as a whole; now the whole fin group
   (`Cnb`, `Cnr`, `Cndr`, `CYb`, `CYdr`, `Cldr`) rides on the tail's dynamic pressure, capped at 2.5×
   the freestream (`finPressureRatio`). Power now makes the tail stiffer and better damped, not looser.
2. **Adverse yaw.** Napolitano's C172 table gives `Cnδa = -0.053`, a plain-aileron figure (DATCOM adverse
   yaw is roughly `K·CL·Clδa` with `K ≈ -0.25`; at approach CL that is -0.05). The 172 has differential
   ailerons, which halve it, and Roskam's Cessna 182 approach value is -0.0216. With -0.053 the ailerons
   needed to hold the wings level in a slip yawed the airplane a further 10° into it, and every roll
   input kicked the nose 20° the other way. Skylark -0.053 → -0.026, Trailblazer -0.05 → -0.04.
3. **Two rudder derivatives had the wrong sign.** The game's positive rudder is trailing edge right; the
   tables' is trailing edge left. `Cndr` had been flipped, `CYdr` (+0.1) and `Cldr` (+0.0147 etc.) had
   not, so a right-rudder kick pushed the airplane right and rolled it right directly. Both are negative
   now: right pedal pushes the tail left and, with the fin above the CG, rolls the airplane left for a
   moment before the dihedral effect of the sideslip rolls it right.
4. **Rudder effectiveness at large deflection.** A plain flap loses effectiveness past ~10-12° (DATCOM
   K'); `rudderEffectiveness(δr)` = 1 − 0.35·smoothstep(10°, 35°, |δr|): 0.95 at 16° (Skylark), 0.83 at
   22° (Trailblazer), 0.77 at 25° (Condor), 0.69 at 30° (Hornet). Full pedal is still the strongest input,
   just not proportionally so.
5. **Lift in a slip.** Alpha is `atan(w/u)`, which under the independence principle for a yawed wing IS the
   sectional angle of attack (the stall correctly keys on it). The missing piece was that the spanwise
   velocity makes no lift: the wing sees `q·(u²+w²)/V² = q·cos²β`. Before, a slip *gained* lift at a fixed
   attitude; now it costs 6-7% at 15° and the airplane sinks, which is what a forward slip is for.
6. **Condor dihedral.** `Clb` -0.16 → -0.12 (trailing-edge flaps cut a swept wing's dihedral effect; the
   flaps-30 value). With -0.16 the ailerons could not hold full rudder and a pedal kick rolled the airliner
   over. The real 737 is genuinely marginal here (its "crossover speed"), so the Condor still uses most of
   its ailerons at the transient peak of a full-pedal kick (88%).
7. **Assist-mode rudder law** (`flightControl.js`). The old term `beta·coord` added weathercock stiffness
   without damping. It is now what a real yaw damper / turn coordinator does: rudder against the yaw rate
   in excess of a coordinated turn's `g·tan(φ)/V` (gain `yawDamp` = multiple of the airframe's own `Cnr`
   added: 1.0 props, 1.5 Condor, 2.0 Hornet, computed from the derivatives so it scales with speed), the
   same small sideslip term, and an aileron-rudder interconnect `ari` that cancels 80% of `Cnδa`. Authority
   ±35% of rudder, and it fades to 40% at full pedal, so a de-crab kick is the pilot's. Direct mode is the
   bare airframe, unchanged.
8. **Rudder keys**: Q/E reach full pedal in 0.4 s (was 0.29 s).
9. **Condor fin group ×1.65** (`Cnb` 0.15 → 0.25, `Cnr` −0.2 → −0.33, `Cndr` 0.12 → 0.20, ratio unchanged).
   Found after the first cut of this pass: with `Cndr` 0.12 and the roll-off, a single-engine full-thrust
   go-around could only be held straight above ~156 kt (~137 kt before the pass), and the One Engine
   challenge is flown at Vref 142. A 737-800's VMCA is ~110 kt, i.e. its rudder is far more powerful than
   the Condor's ever was. With 0.20 the Condor holds one engine at full thrust (113 kN) straight at 135 kt
   with 64% pedal and 3° of bank, and the hold stays inside full pedal down to ~128 kt. Weathercock and
   yaw damping scale with the rudder because it is the same fin: Dutch roll period 8.0 → 6.4 s, ζ 0.34 →
   0.39 in assist mode; full-pedal steady sideslip 12° → 16° (the `Cndr/Cnb` ratio is unchanged, the rest
   is the adverse-yaw and roll coupling), transient peak 23° → 22°, aileron peak unchanged at 88%.

**After** (same harness; assist mode, Vref, approach power unless noted):

| After | steady sideslip | peak | peak alpha | stalled | bank / ailerons | Dutch roll assist (period, ζ) | direct (pilot holds wings) |
|---|---|---|---|---|---|---|---|
| Skylark | 14° (13° full power) | 19° | 5.7° | no | 5° / 41% | 3.3 s, 0.48 (was 3.9 s, 0.31) | 15° slip, ζ 0.34 |
| Trailblazer | 18° (17° full power) | 22° | 9.8° | no | 5° / 40% | 3.1 s, 0.61 (was 3.4 s, 0.29) | 19°, ζ 0.43 |
| Condor | 16° (15° full power) | 22° | 7.7° | no | 8° / 88% peak | 6.4 s, 0.39 (was 8.1 s, 0.21) | 16°, ζ 0.26 |
| Hornet | 15° (18° full power) | 26° | 15° | no | 9° / 51% | 6.6 s, 0.28 (was 6.6 s, 0.14) | 15°, ζ 0.22 |

Roll-input nose swing: Skylark 24° → 9°, Trailblazer 19° → 9°, Condor 6° → 4°, Hornet 12° → 10°. A
right-rudder step now produces a leftward side acceleration and a brief left roll before the sideslip
rolls it right. Crosswind de-crab (nose on the runway, drift stopped with bank, steady): Skylark 15 kt at
82% pedal and 5° of bank (15 kt is exactly a 172's demonstrated crosswind, so full de-crab is right at
its limit, as it should be), Trailblazer 12 kt at 61%, Condor 17 kt at 34% and 3° of bank, Hornet 15 kt
at 27%. Ground steering unchanged (the steering code was not touched; `test-yaw.mjs` checks the sign on
all four, taildragger included).

**Reference points.** Linear full-rudder sideslip `Cndr·δr/Cnb` from the tables: C172 16° (flight-lab
steady-heading sideslips on the type typically top out at 12-16° with 50-70% aileron); the Condor's
15-16° at Vref matches a 737 near its crossover speed, where full rudder needs nearly all the roll
control (NTSB, USAir 427; Boeing raised the flaps-extended manoeuvring speeds 10 kt to stay above it).
Dutch roll floors: MIL-F-8785C Category C Level 1 wants ζ ≥ 0.08, ζ·ωn ≥ 0.15 rad/s, ωn ≥ 0.4 rad/s for
the bare airframe; every aircraft clears it in direct mode (ζ 0.22-0.43), and the assist mode sits where
yaw-damper-equipped aircraft do (0.3-0.6). Sources: Roskam, *Airplane Flight Dynamics* Part I (Cessna
182 approach derivatives, DATCOM K' and adverse-yaw estimates); Napolitano, *Aircraft Dynamics* (C172
set); MIL-F-8785C table for Dutch roll; NTSB AAR-99/01 (737 crossover speed); Etkin & Reid for the
independence principle and the coordinated-turn yaw rate.

**Single-engine go-around** (Condor, left engine dead, right at full thrust, 135 kt, flaps 30, gear
down): heading held with 64% right pedal and 2.9° of bank into the live engine, heading rate settled to
zero. The sim's VMCA-equivalent (full pedal, wings within 5°) is ~128 kt, well under Vref 142 and the
One Engine challenge's speeds; at approach thrust that challenge needs about a fifth of the pedal.

`tools/test-yaw.mjs` (in `npm test`) guards all of it: no stall and a bounded, in-band sideslip at full
rudder (assist and direct, approach and full power), Dutch roll damping floors and time-to-half, the
crosswind de-crab with pedal to spare, the rudder sign, the roll-input nose swing, the Condor's
single-engine hold at 135 kt, and ground steering.
