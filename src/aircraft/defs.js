// Aircraft definitions. SI units, angles in radians unless the name says Deg.
// Body frame: forward = -Z, up = +Y, right = +X. Positions are relative to the CG.
import { DEG, KT } from '../config.js';

// Rudder sign convention: the game's positive rudder is trailing edge RIGHT (right pedal, nose yaws right),
// the opposite of the Roskam / Napolitano tables (positive = trailing edge left). Cndr was flipped when the
// numbers came in; CYdr and Cldr were not, so until the yaw pass (2026-09-14) a right-rudder kick pushed the
// airplane to the right and rolled it right directly. Right pedal pushes the tail LEFT: CYdr < 0, and with
// the fin above the CG that force rolls the airplane LEFT: Cldr < 0 (the dihedral effect of the resulting
// sideslip is what rolls it right a moment later, as on the real airplane).
function base(o) {
  const d = {
    CYdr: -0.1, CDbeta: 0.15, spoilerDCL: 0, CDspoiler: 0, geLift: 0.22, CmGE: -0.025, windmillCD: 0.012,
    propwash: 0, spoilers: false, spoilerHydraulic: false, gearRetract: null, hook: null, autobrake: false, propYaw: 0,
    ...o,
  };
  // yawDamp: yaw damping the assist mode adds through the rudder, as a multiple of the airframe's own Cnr
  // (1 = doubles it). ari: fraction of the ailerons' adverse yaw the assist mode cancels with rudder.
  // coord: rudder per radian of sideslip. All three fade out as the pilot's own pedal input comes in.
  d.fcs = { maxBank: 55, bankRate: 30, levelRate: 12, pitchRate: 5, maxPitch: 20, kpP: 2.6, kdP: 1.0, kiP: 0.7, kpR: 3.6, kdR: 0.5, ffR: 0.35, ffP: 0.12, coord: 1.2, yawDamp: 1.0, ari: 0.8, flareH: 6, flareSink: 1.2, flareFloor: 1.5, ...(o.fcs || {}) };
  d.K = 1 / (Math.PI * d.e * ((d.span * d.span) / d.S));
  d.stall.round = d.stall.round ?? 2.5 * DEG;
  d.stall.warnMargin = d.stall.warnMargin ?? 3.5 * DEG;
  // CG height above ground with wheels on the ground (uncompressed)
  const main = d.gear.find((g) => g.main);
  d.cgHeight = -(main.pos.y - main.radius);
  return d;
}

export const SKYLARK = base({
  id: 'skylark', name: 'Skylark 172', short: 'Skylark', category: 'Light trainer', model: 'skylark',
  description: 'Four-seat trainer. Forgiving, slow, and honest. Clean stall 49 kt, 42 kt with full flaps. Approach at 62 kt, throttle to idle over the numbers, flare at 5 ft and keep pulling gently until it settles.',
  mass: 1050, massOptions: { light: 850, normal: 1050, heavy: 1110 },
  S: 16.2, span: 11.0, chord: 1.5, e: 0.75, wingHeight: 1.2,
  inertia: { roll: 1285, pitch: 1825, yaw: 2667 },
  CL0: 0.33, CLa: 5.0, CD0: 0.031, CDgear: 0, geLift: 0.12,
  stall: { alpha: 16 * DEG, alphaNeg: -12 * DEG, breakWidth: 3.5 * DEG, retention: 0.55, wingDrop: 0.05 },
  flaps: { maxDeg: 30, dCL0: 0.72, dCD0: 0.085, dAlphaStall: -3.5 * DEG, time: 6, detents: [0, 0.333, 0.667, 1], labels: ['UP', '10', '20', '30'] },
  Cm0: 0.035, Cma: -0.95, Cmq: -12.4, Cmde: 1.28, Cmflap: -0.12,
  // Napolitano's C172 set, except Cnda: the table's -0.053 is a plain-aileron figure (DATCOM adverse yaw
  // K*CL*Clda with K ~ -0.25 at approach CL); the 172 has differential ailerons, which halve it, and Roskam's
  // Cessna 182 approach value is -0.0216. -0.026 keeps the nose from swinging 20 deg on every roll input.
  CYb: -0.31, Clb: -0.089, Clp: -0.47, Clr: 0.096, Clda: 0.178, Cldr: -0.0147,
  Cnb: 0.065, Cnp: -0.03, Cnr: -0.099, Cnda: -0.026, Cndr: 0.0657,
  controls: { elevatorMax: 25 * DEG, aileronMax: 20 * DEG, rudderMax: 16 * DEG, rate: 5.5, steerFade: 45 },
  engines: [{ type: 'prop', pos: { x: 0, y: 0, z: -1.9 }, maxPower: 120000, eta: 0.8, staticThrust: 2300, propArea: 2.8, tauUp: 0.35, tauDown: 0.3, propRadius: 0.95 }],
  propwash: 0.55, propYaw: 0.004,
  fcs: { maxBank: 55, bankRate: 42, levelRate: 6, pitchRate: 7, maxPitch: 20, kpP: 3.0, kdP: 1.1, kpR: 4.2, kdR: 0.6 },
  gear: [
    { name: 'nose', main: false, pos: { x: 0, y: -1.28, z: -1.55 }, radius: 0.2, k: 26000, c: 2400, maxTravel: 0.18, brake: false, steer: 10 * DEG, maxLoad: 16000 },
    { name: 'left', main: true, pos: { x: -1.3, y: -1.25, z: 0.25 }, radius: 0.25, k: 56000, c: 6000, maxTravel: 0.22, brake: true, steer: 0, maxLoad: 32000 },
    { name: 'right', main: true, pos: { x: 1.3, y: -1.25, z: 0.25 }, radius: 0.25, k: 56000, c: 6000, maxTravel: 0.22, brake: true, steer: 0, maxLoad: 32000 },
  ],
  bodyPoints: [
    { name: 'nose', pos: { x: 0, y: -0.75, z: -2.45 }, maxImpact: 4.0, crashMsg: 'Nosed into the ground' },
    { name: 'tail', pos: { x: 0, y: -0.4, z: 4.6 }, maxImpact: 4.0 },
    { name: 'wingtipL', pos: { x: -5.5, y: 0.95, z: -0.2 }, crashSpeed: 12, maxImpact: 3, crashMsg: 'Wing struck the ground and cartwheeled' },
    { name: 'wingtipR', pos: { x: 5.5, y: 0.95, z: -0.2 }, crashSpeed: 12, maxImpact: 3, crashMsg: 'Wing struck the ground and cartwheeled' },
    { name: 'belly', pos: { x: 0, y: -0.95, z: 0.2 }, maxImpact: 4.5, crashMsg: 'Fuselage crushed' },
  ],
  speeds: { Vs1: 49, Vs0: 42, Vref: 62, Vapp: 66, Vfe: 85, Vne: 160 },
  limits: { crashVS: 7.0, hardVS: 3.0, firmVS: 1.8, smoothVS: 1.0, tailStrikePitch: 99, maxSide: 4 },
  eye: { x: -0.35, y: 0.55, z: -1.0 },
  // seatUp (m): how far the pilot's head sits above `eye`, the design eye the cockpit interior is built around.
  // The cabin stays put and the head rises, like raising the seat (2026-09-15: "a bit taller in all the planes").
  // Headroom and the windshield view were measured from the raised eye; tools/test-art.mjs checks the view from it.
  seatUp: 0.10,
  approach: { glideslope: 3 * DEG, flareHeight: 5, aimDistance: 300, runwayNeed: 500 },
});

export const TRAILBLAZER = base({
  id: 'trailblazer', name: 'Trailblazer', short: 'Trailblazer', category: 'Bush plane (taildragger)', model: 'bush',
  description: 'STOL taildragger on tundra tires. 40 degrees of flap, lands at 45 kt in 120 m. Directionally unstable on the ground: keep it straight with rudder or it will ground-loop.',
  mass: 800, massOptions: { light: 680, normal: 800, heavy: 900 },
  S: 16.6, span: 10.7, chord: 1.6, e: 0.72, wingHeight: 1.6,
  inertia: { roll: 1150, pitch: 1400, yaw: 2050 },
  CL0: 0.36, CLa: 4.6, CD0: 0.046, CDgear: 0,
  stall: { alpha: 17 * DEG, alphaNeg: -12 * DEG, breakWidth: 4 * DEG, retention: 0.6, wingDrop: 0.045 },
  flaps: { maxDeg: 40, dCL0: 0.92, dCD0: 0.13, dAlphaStall: -4 * DEG, time: 2.5, detents: [0, 0.5, 1], labels: ['UP', '20', '40'] },
  Cm0: 0.04, Cma: -0.9, Cmq: -12.5, Cmde: 1.3, Cmflap: -0.13,
  CYb: -0.34, Clb: -0.075, Clp: -0.50, Clr: 0.1, Clda: 0.17, Cldr: -0.012,
  Cnb: 0.08, Cnp: -0.03, Cnr: -0.13, Cnda: -0.04, Cndr: 0.085,   // Cnda: Cub-class adverse yaw, DATCOM K*CL*Clda at full-flap CL
  controls: { elevatorMax: 28 * DEG, aileronMax: 22 * DEG, rudderMax: 22 * DEG, rate: 6.0, steerFade: 30 },
  engines: [{ type: 'prop', pos: { x: 0, y: 0.05, z: -1.8 }, maxPower: 135000, eta: 0.8, staticThrust: 2700, propArea: 3.1, tauUp: 0.3, tauDown: 0.3, propRadius: 1.0 }],
  propwash: 0.6, propYaw: 0.005,
  fcs: { maxBank: 60, bankRate: 52, levelRate: 7, pitchRate: 8, maxPitch: 22, flareH: 5, flareSink: 1.2, flareFloor: 6, kpR: 4.0, kdR: 0.75, kpP: 2.9 },
  gear: [
    { name: 'left', main: true, pos: { x: -1.0, y: -1.2, z: -0.5 }, radius: 0.44, k: 30000, c: 4200, maxTravel: 0.3, brake: true, steer: 0, maxLoad: 30000, mu: 1.05 },
    { name: 'right', main: true, pos: { x: 1.0, y: -1.2, z: -0.5 }, radius: 0.44, k: 30000, c: 4200, maxTravel: 0.3, brake: true, steer: 0, maxLoad: 30000, mu: 1.05 },
    { name: 'tail', main: false, pos: { x: 0, y: -0.45, z: 4.3 }, radius: 0.13, k: 14000, c: 1400, maxTravel: 0.12, brake: false, steer: -28 * DEG, maxLoad: 12000 },
  ],
  bodyPoints: [
    { name: 'nose', pos: { x: 0, y: -0.55, z: -2.35 }, maxImpact: 4.0, crashMsg: 'Nosed over' },
    { name: 'tail', pos: { x: 0, y: -0.3, z: 4.75 }, maxImpact: 4.5 },
    { name: 'wingtipL', pos: { x: -5.3, y: 0.85, z: -0.1 }, crashSpeed: 10, maxImpact: 3, crashMsg: 'Wing dug in and cartwheeled' },
    { name: 'wingtipR', pos: { x: 5.3, y: 0.85, z: -0.1 }, crashSpeed: 10, maxImpact: 3, crashMsg: 'Wing dug in and cartwheeled' },
    { name: 'belly', pos: { x: 0, y: -0.8, z: 0.3 }, maxImpact: 4.5, crashMsg: 'Fuselage crushed' },
  ],
  speeds: { Vs1: 42, Vs0: 36, Vref: 48, Vapp: 52, Vfe: 80, Vne: 130 },
  limits: { crashVS: 7.5, hardVS: 3.2, firmVS: 2.0, smoothVS: 1.1, tailStrikePitch: 99, maxSide: 3.5 },
  eye: { x: 0, y: 0.5, z: -0.6 },
  seatUp: 0.10,
  approach: { glideslope: 5 * DEG, flareHeight: 4, aimDistance: 60, runwayNeed: 150 },
});

export const CONDOR = base({
  id: 'condor', name: 'Condor 700', short: 'Condor', category: 'Twin-jet airliner', model: 'airliner',
  description: '60-tonne narrow-body. Engines take seconds to spool, so stay ahead of it. Vref 140 kt flaps 30. Arm spoilers, flare at 30 ft, thrust to idle, reverse and brake. Pitch above 10 degrees on the runway is a tail strike.',
  mass: 58000, massOptions: { light: 48000, normal: 58000, heavy: 66000 },
  S: 124.6, span: 34.3, chord: 3.9, e: 0.8, wingHeight: 2.0,
  inertia: { roll: 1.25e6, pitch: 3.0e6, yaw: 3.95e6 },
  CL0: 0.22, CLa: 5.5, CD0: 0.022, CDgear: 0.02, CDspoiler: 0.06, spoilerDCL: 0.55,
  stall: { alpha: 15 * DEG, alphaNeg: -11 * DEG, breakWidth: 7 * DEG, retention: 0.8, wingDrop: 0.03, warnMargin: 3 * DEG },
  flaps: { maxDeg: 40, dCL0: 1.05, dCD0: 0.105, dAlphaStall: -3 * DEG, time: 24, detents: [0, 0.125, 0.375, 0.625, 0.75, 1], labels: ['UP', '5', '15', '25', '30', '40'] },
  Cm0: 0.06, Cma: -1.25, Cmq: -23, Cmde: 1.6, Cmflap: -0.28,
  // Clb: -0.12 is the flaps-30 value (trailing-edge flaps cut a swept wing's dihedral effect); with -0.16 the
  // ailerons could not hold the wings level at full rudder and a pedal kick rolled the airliner over.
  // Fin group x1.65 (Cnb 0.15 -> 0.25, Cnr -0.2 -> -0.33, Cndr 0.12 -> 0.20, same Cndr/Cnb ratio): the
  // rudder has to hold a single-engine full-thrust go-around straight at the One Engine challenge's speeds.
  // With 0.12 (and the large-deflection roll-off) that only worked above ~156 kt; a 737-800 manages ~110 kt
  // (VMCA) with 5 deg of bank, and 0.20 gets the Condor there at 65% pedal at 135 kt. Weathercock and yaw
  // damping scale with it because it is the same fin.
  CYb: -0.7, Clb: -0.12, Clp: -0.45, Clr: 0.15, Clda: 0.15, Cldr: -0.02,
  Cnb: 0.25, Cnp: -0.05, Cnr: -0.33, Cnda: -0.02, Cndr: 0.20,
  controls: { elevatorMax: 20 * DEG, aileronMax: 20 * DEG, rudderMax: 25 * DEG, rate: 3.2, steerFade: 60, steerHydraulic: true },
  engines: [
    { type: 'jet', pos: { x: -5.6, y: -1.7, z: -2.0 }, maxThrust: 121000, idle: 0.06, tauUp: 1.05, tauDown: 0.8, reverse: 0.42 },
    { type: 'jet', pos: { x: 5.6, y: -1.7, z: -2.0 }, maxThrust: 121000, idle: 0.06, tauUp: 1.05, tauDown: 0.8, reverse: 0.42 },
  ],
  spoilers: true, spoilerHydraulic: true, autobrake: true,
  fcs: { maxBank: 35, bankRate: 20, levelRate: 4.5, pitchRate: 4, maxPitch: 18, flareH: 12, flareSink: 0.8, flareFloor: 2, kpP: 4.2, kdP: 3.2, kiP: 1.2, kpR: 5.5, kdR: 1.0, ffR: 0.6, ffP: 0.1, yawDamp: 1.5 },   // airliners fly with a yaw damper
  gearRetract: { time: 11 },
  gear: [
    { name: 'nose', main: false, pos: { x: 0, y: -3.55, z: -12.6 }, radius: 0.34, k: 650000, c: 90000, maxTravel: 0.45, brake: false, steer: 8 * DEG, maxLoad: 800000 },
    { name: 'left', main: true, pos: { x: -2.9, y: -3.55, z: 1.3 }, radius: 0.56, k: 1.05e6, c: 210000, maxTravel: 0.45, brake: true, steer: 0, maxLoad: 1.25e6 },
    { name: 'right', main: true, pos: { x: 2.9, y: -3.55, z: 1.3 }, radius: 0.56, k: 1.05e6, c: 210000, maxTravel: 0.45, brake: true, steer: 0, maxLoad: 1.25e6 },
  ],
  bodyPoints: [
    { name: 'nose', pos: { x: 0, y: -2.6, z: -15.5 }, maxImpact: 4.5, crashMsg: 'Nose crushed' },
    { name: 'tail', pos: { x: 0, y: -1.55, z: 16.5 }, maxImpact: 5 },
    { name: 'wingtipL', pos: { x: -17.0, y: 0.2, z: 3.5 }, crashSpeed: 25, maxImpact: 3, crashMsg: 'Wing struck the ground' },
    { name: 'wingtipR', pos: { x: 17.0, y: 0.2, z: 3.5 }, crashSpeed: 25, maxImpact: 3, crashMsg: 'Wing struck the ground' },
    { name: 'nacelleL', pos: { x: -5.6, y: -2.95, z: -2.5 }, maxImpact: 4 },
    { name: 'nacelleR', pos: { x: 5.6, y: -2.95, z: -2.5 }, maxImpact: 4 },
    { name: 'belly', pos: { x: 0, y: -2.45, z: 0.5 }, maxImpact: 4.5, crashMsg: 'Fuselage crushed' },
  ],
  speeds: { Vs1: 135, Vs0: 110, Vref: 142, Vapp: 147, Vfe: 175, Vle: 270, Vne: 340 },
  limits: { crashVS: 6.5, hardVS: 3.0, firmVS: 1.8, smoothVS: 0.9, tailStrikePitch: 10.5 * DEG, maxSide: 6 },
  eye: { x: -0.5, y: 1.35, z: -15.3 },
  seatUp: 0.08,   // higher and the top of the windshield frame starts to cut the view up the approach
  approach: { glideslope: 3 * DEG, flareHeight: 9, aimDistance: 400, runwayNeed: 1700 },
});

export const HORNET = base({
  id: 'hornet', name: 'Sea Hornet', short: 'Hornet', category: 'Carrier fighter', model: 'fighter',
  description: 'Carrier jet with a tailhook. Fly on-speed at 8.1 degrees AoA (about 135 kt), keep the ball centered on a 3.5 degree glideslope, do NOT flare: fly it into the deck and catch the 3-wire. Throttle to full at touchdown in case you bolter.',
  mass: 15000, massOptions: { light: 13500, normal: 15000, heavy: 16500 },
  S: 37.2, span: 12.3, chord: 3.5, e: 0.7, wingHeight: 1.2,
  inertia: { roll: 31000, pitch: 205000, yaw: 230000 },
  CL0: 0.1, CLa: 3.6, CD0: 0.026, CDgear: 0.018, CDspoiler: 0.05, spoilerDCL: 0.1,
  stall: { alpha: 30 * DEG, alphaNeg: -14 * DEG, breakWidth: 8 * DEG, retention: 0.9, wingDrop: 0.03, warnMargin: 6 * DEG, round: 4 * DEG },
  flaps: { maxDeg: 45, dCL0: 0.72, dCD0: 0.075, dAlphaStall: -5 * DEG, time: 2.5, detents: [0, 0.5, 1], labels: ['AUTO', 'HALF', 'FULL'] },
  Cm0: 0.005, Cma: -0.45, Cmq: -9, Cmde: 1.05, Cmflap: -0.1,
  CYb: -0.8, Clb: -0.08, Clp: -0.32, Clr: 0.08, Clda: 0.15, Cldr: -0.015,
  Cnb: 0.12, Cnp: -0.03, Cnr: -0.25, Cnda: -0.012, Cndr: 0.1,
  controls: { elevatorMax: 24 * DEG, aileronMax: 25 * DEG, rudderMax: 30 * DEG, rate: 4.0, steerFade: 50, steerHydraulic: true },
  engines: [
    { type: 'jet', pos: { x: -0.7, y: -0.3, z: 4.0 }, maxThrust: 49000, idle: 0.05, tauUp: 0.8, tauDown: 0.6, reverse: 0 },
    { type: 'jet', pos: { x: 0.7, y: -0.3, z: 4.0 }, maxThrust: 49000, idle: 0.05, tauUp: 0.8, tauDown: 0.6, reverse: 0 },
  ],
  spoilers: true,
  fcs: { maxBank: 65, bankRate: 75, levelRate: 9, pitchRate: 10, maxPitch: 26, flareH: 0, flareSink: 0, kpP: 2.6, kdP: 1.45, kiP: 0.6, kpR: 2.8, kdR: 0.9, ffR: 0.3, ffP: 0.1, yawDamp: 2.0 },   // the CAS does the yaw damping on a fighter
  gearRetract: { time: 5 },
  gear: [
    { name: 'nose', main: false, pos: { x: 0, y: -2.05, z: -4.6 }, radius: 0.28, k: 320000, c: 45000, maxTravel: 0.55, brake: false, steer: 12 * DEG, maxLoad: 1100000 },
    { name: 'left', main: true, pos: { x: -1.6, y: -2.05, z: 0.9 }, radius: 0.36, k: 450000, c: 80000, maxTravel: 0.55, brake: true, steer: 0, maxLoad: 950000 },
    { name: 'right', main: true, pos: { x: 1.6, y: -2.05, z: 0.9 }, radius: 0.36, k: 450000, c: 80000, maxTravel: 0.55, brake: true, steer: 0, maxLoad: 950000 },
  ],
  bodyPoints: [
    { name: 'nose', pos: { x: 0, y: -0.85, z: -8.6 }, maxImpact: 9, crashMsg: 'Nose crushed' },
    { name: 'tail', pos: { x: 0, y: -1.5, z: 8.2 }, maxImpact: 5 },
    { name: 'wingtipL', pos: { x: -6.1, y: -0.2, z: 1.2 }, crashSpeed: 25, maxImpact: 3, crashMsg: 'Wing struck the deck' },
    { name: 'wingtipR', pos: { x: 6.1, y: -0.2, z: 1.2 }, crashSpeed: 25, maxImpact: 3, crashMsg: 'Wing struck the deck' },
    { name: 'belly', pos: { x: 0, y: -1.5, z: 0.5 }, maxImpact: 5, crashMsg: 'Fuselage crushed' },
  ],
  hook: { pivot: { x: 0, y: -0.6, z: 7.0 }, length: 2.4, angle: 40 * DEG, time: 2.0, decel: 18 },
  speeds: { Vs1: 118, Vs0: 101, Vref: 135, Vapp: 138, Vfe: 250, Vle: 250, Vne: 600 },
  limits: { crashVS: 9.5, hardVS: 5.5, firmVS: 4.0, smoothVS: 2.5, tailStrikePitch: 14 * DEG, maxSide: 6 },
  eye: { x: 0, y: 0.95, z: -5.4 },
  seatUp: 0.08,   // higher and the HUD frame starts to cross the view just above the nose
  approach: { glideslope: 3.5 * DEG, flareHeight: 0, aimDistance: 70, runwayNeed: 200, onSpeedAoA: 8.1 * DEG },
});

export const AIRCRAFT = { skylark: SKYLARK, trailblazer: TRAILBLAZER, condor: CONDOR, hornet: HORNET };
export const AIRCRAFT_LIST = [SKYLARK, TRAILBLAZER, CONDOR, HORNET];
