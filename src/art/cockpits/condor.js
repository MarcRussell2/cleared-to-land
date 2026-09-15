// The Condor 700 flight deck: a 737-class airliner flown from the left seat. Two
// control YOKES (the pilot's rotates for roll and slides for pitch), rudder pedals, a
// centre pedestal with TWO thrust levers (reverse levers on top of them), speedbrake
// lever on the left, flap lever with a gated detent track on the right, a pair of
// stabiliser trim wheels either side of the pedestal that spin when the trim runs,
// the gear lever (a wheel-shaped knob) on the right of the centre panel with three
// green gear lights, autobrake selector, a glass cockpit: a PFD and an ND in front of
// each pilot (canvas displays), engine displays (N1, EGT, N2, fuel flow) in the centre,
// a glareshield with the mode control panel (heading/altitude/speed windows), an
// overhead panel, six windshield panes with thick posts, sun visors, two seats, a
// centre console. Night: panel flood lighting and lit displays.
//
// THE CONTRACT is the same as skylark.js - read that header first; it is the spec.
//   export function buildCockpit(def, ctx) -> { group, parts, update(state), look }
// Body frame, built around ctx.eye (= def.eye). Control signs as in common.js:
// elevator > 0 = yoke aft, aileron > 0 = yoke clockwise, rudder > 0 = right pedal
// forward, throttle 1 = levers forward, reverse > 0 = the reverse levers raised,
// trim > 0 = nose up (wheels roll aft). Gear lever down for gearCmd 1; the three
// gear lights follow gearLocked[] (nose, left, right); spoiler lever follows spoiler
// (and sits in ARM when spoilerArmed); autobrake selector shows OFF/MED/MAX.
// This aircraft's parts: yoke, pedalL, pedalR, throttle[2], flapLever, spoilerLever,
// gearLever, gearLights[3], trimWheel, pfd (a mesh with a canvas display), rpm[2],
// stallLight, panel, glareshield, seat, windshield.
// The PFD/ND are canvas textures uploaded at <= 20 Hz via makeDisplay() (never per
// frame); everything else moves as meshes. look: an airliner flight deck - the side
// window limits the turn.
// Budget at ctx.detail 'high': <= 80k triangles, <= 20 draw calls; no Math.random;
// name every material; no at* uniforms. Keep this header.
import { placeholderCockpit } from './common.js';

export function buildCockpit(def, ctx) {
  return placeholderCockpit(def, ctx, {
    control: 'yoke', engines: 2, gearLever: true, spoilers: true, efis: true, pedestalX: 0.5,
    cabin: { halfWidth: 1.15, panelDist: 0.8, panelTop: 0.1, panelBottom: 0.6, roof: 0.45, floor: 1.1, wsTop: 0.4, wsSlope: 0.55, sideZ0: -16.1, sideZ1: -14.6 },
    look: { yaw: 2.0, pitch: 0.9 },
  });
}
