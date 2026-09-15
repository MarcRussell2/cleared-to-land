// The Sea Hornet cockpit: an F/A-18 class single-seat carrier fighter under a bubble
// canopy. A centre control STICK with a pistol grip, rudder pedals, a HOTAS twin
// THROTTLE on the left console (two levers side by side, moved together), a HUD glass
// above the glareshield with green symbology (airspeed, altitude, heading, the
// velocity vector, AoA bracket and the E-bracket for the approach, radar altitude),
// an up-front control below the HUD, two DDI screens (left and right, canvas
// displays with menus around the edge) and a MPCD lower centre, standby round
// instruments (airspeed, attitude, altimeter) between them, the gear handle with the
// wheel knob on the left of the panel with three green gear lights, the HOOK handle
// on the right, an AoA indexer (three lights: slow/on-speed/fast) on the left canopy
// bow, master caution, the canopy rail and frame all round, an ejection seat with
// headbox and harness, the canted DDI bezels, and the nose of the aircraft visible
// ahead over the glareshield. Night: the HUD and DDIs glow, the panel is flood-lit.
//
// THE CONTRACT is the same as skylark.js - read that header first; it is the spec.
//   export function buildCockpit(def, ctx) -> { group, parts, update(state), look }
// Body frame, built around ctx.eye (= def.eye). Control signs as in common.js:
// elevator > 0 = stick back (stick.rotation.x = +), aileron > 0 = stick right
// (stick.rotation.z = -), rudder > 0 = right pedal forward, throttle 1 = levers
// forward. Gear handle down for gearCmd 1, lights follow gearLocked[] (nose, left,
// right); hook handle down for hookCmd 1. The AoA indexer follows aoa against
// onSpeedAoA (8.1 deg): amber doughnut on speed, green chevron slow, red chevron fast.
// This aircraft's parts: stick, pedalL, pedalR, throttle[2], gearLever, gearLights[3],
// hookLever, hudGlass (a transparent mesh with a canvas display), asi, alt, vsi, turn,
// hdgCard, attitude, rpm[2], stallLight, panel, glareshield, seat, windshield.
// The HUD and DDIs are canvas textures uploaded at <= 20 Hz via makeDisplay() (never
// per frame). look: a bubble canopy - the head turns almost all the way round and
// far up.
// Budget at ctx.detail 'high': <= 80k triangles, <= 20 draw calls; no Math.random;
// name every material; no at* uniforms. Keep this header.
import { placeholderCockpit } from './common.js';

export function buildCockpit(def, ctx) {
  return placeholderCockpit(def, ctx, {
    control: 'stick', engines: 2, hotas: true, gearLever: true, hook: true, hud: true,
    cabin: { halfWidth: 0.5, panelDist: 0.7, panelTop: 0.16, panelBottom: 0.5, roof: 0.5, floor: 1.0, wsTop: 0.4, wsSlope: 0.6, sideZ0: -6.1, sideZ1: -4.5 },
    look: { yaw: 3.0, pitch: 1.3 },
  });
}
