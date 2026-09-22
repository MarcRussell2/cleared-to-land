// New missions: obstacles ("In the way", n 36-38). Each entry follows src/missions/README.md; ids are permanent.
// The obstacles themselves are built by src/world/obstacles.js from the `course` specs below (its header lists every
// kind); the routes are what RoutePilot flies to prove each mission can be landed (tools/fly-mission.mjs,
// tools/test-obstacles.mjs), and the tips tell a human the same technique.
//
// Hints get ctx = { ac, ra (ft), d (m to the threshold), t, u, v (runway frame, metres), mission }, where
// mission.next() is the next pending gate ({ gate, dist }) or null. Return a string, or null for the game's usual
// hint. Hints name no keys (the touch layer would have to translate them).
//
// Heights in a course and a route are metres above the threshold elevation (the local ground under an approach is
// rarely at that height: Harbor City's water is 8 m below its threshold). tools/test-obstacles.mjs prints the numbers
// each description quotes, and checks them.
import { sCurve } from './util.js';

// ------------------------------------------------------------------ the Moose Creek Notch site
// The gravel bar of Moose Creek (SITES.gravelbar: the same valley, bar and scattered spruce) without its tree wall at
// the end of the gravel. The Notch mission grows that wall into a forest edge in its own course (below), so the
// site on its own is just the bar (its aim point is 120 m in, where a landing out of the notch can first touch): nothing else that flies here (free flight, Autoland, the look and perf tools)
// meets a wall it cannot see a way through. `missionOnly`: a site that exists for a mission; the free-flight picker
// should leave it out (the new home menu honours it; the old menu lists every site).
const NOTCH_V = -16, NOTCH_W = 30, NOTCH_U = -6;
const notchbar = {
  id: 'notchbar', name: 'Moose Creek Notch', kind: 'bush', missionOnly: true,
  terrain: { style: 'mountain', seed: 61, size: 14000, res: 400, elevation: 520, waterLevel: 516, valleyWidth: 1400, trees: 0.9, treeArea: 4500, snowLine: 1900 },
  runways: [{ x: 0, z: 0, heading: 0, length: 340, width: 14, surface: 'gravel', elevation: 520, name: '36', nameRecip: '18', papi: false, ils: false, lights: false, windsock: true, markers: true, aimDistance: 120, flatWidth: 60, flatMargin: 120 }],
  course: {
    // the valley's scattered spruce, where Moose Creek Bar has them (its x -> v, z -> -u)
    obstacles: [[-34, 260, 1.1], [45, 320, 1.2], [22, 420, 1.0], [-48, 470, 1.1], [-25, -420, 1.2], [40, -380, 1.1]].map(([x, z, s]) => ({ kind: 'tree', u: -z, v: x, scale: s })),
  },
};

export const OBSTACLES_SITES = { notchbar };

// ------------------------------------------------------------------ 36: Power Lines
// Ridgefield (runway 36, 1,600 m, threshold elevation 120 m; the ground is at the threshold's height for the last few
// hundred metres of the approach). A line of 34 m lattice pylons crosses the approach diagonally right before the
// threshold, 120 m out over the centreline; mid-span its lowest conductors hang 14.5 m above the ground, its middle
// pair 21 m and its earth wire 28.7 m. A 10 m pole line runs along the road 230 m out, before the pylons. The start
// is level at 14.5 m, the height of the lowest wires: stay there and you meet them. Over the top means about 40 m up
// over the threshold and a landing from there (idle, full flap, a slip; RoutePilot touches down 280-310 m in); under
// means below about 11 m (the fin stands 2.4 m over the CG) between the pylons, wings level. The stock 3-degree path is
// 20.6 m up there, so a straight-in on the glideslope hits the wires. (Until 2026-09-22 the pylons stood 600 m out and
// the pilot flew a normal final after them; Marc: "the obstacle and then immediately the runway".)
const powerLines = {
  id: 'power-lines', n: 36, title: 'Power Lines', group: 'obstacles', difficulty: 3, tags: ['obstacles', 'low'],
  aircraft: 'skylark', site: 'ridgefield', time: 7.8, vis: 4500,
  desc: 'Scud-running at 50 ft under the morning murk, and the county\'s high-voltage line crosses the approach right in front of the threshold, 34-metre pylons and all. Its wires sag to between 15 and 29 m over the centerline, so the lowest one is exactly where you are. Over the top means 130 ft over the numbers and a dive at 1,600 m of runway; under means 35 ft with a pylon either side.',
  tips: [
    'Climb as soon as you see the pylons: full power and a gentle pull, up to about 130 ft. A Skylark climbs 500 feet a minute, so start early. The pole line by the road comes first, 10 m tall; you clear it as you are.',
    'Cross the wires where the orange marker balls are, with room to spare, then throttle to idle, full flap and push: you are 40 m up over the threshold with the aiming bars 250 m ahead. A slip (rudder one way, aileron the other) gets you down without the speed.',
    'Under is the other way: duck to 35 ft over the ground between the pylons, wings level, with the runway straight ahead. Either way there is 1,600 m to stop in, so a long landing is fine; a crooked one is not.',
  ],
  wind: { rel: 25, speed: 8, turb: 0.2 }, weight: 'normal',
  spawn: { u: -2600, v: 0, alt: 14.5, gamma: 0, flap: 0.333, speedKt: 72, fixed: true },
  failures: [], scoring: { type: 'runway' },
  course: {
    obstacles: [
      { kind: 'powerline', type: 'hv', from: { u: -50, v: -900 }, to: { u: -190, v: 900 }, spans: 5, h: 34, sag: 5, markers: 60, name: 'the power lines' },
      { kind: 'powerline', type: 'pole', from: { u: -230, v: -550 }, to: { u: -230, v: 550 }, spans: 11, h: 10, name: 'the power lines along the road' },
    ],
  },
  // RoutePilot: over the wires at 40 m, then steeply down onto the runway (tools/fly-mission.mjs power-lines --node:
  // 98 and 93 on seeds 307 and 4271, touching down 280-310 m in)
  route: [
    { u: -1800, v: 0, alt: 48, kt: 70 },
    { u: -180, v: 0, alt: 40, kt: 68, over: true },
    { u: -70, v: 0, alt: 40, kt: 66, over: true },
    { u: 120, v: 0, alt: 8, kt: 63 },
  ],
  hint: (c) => {
    if (c.ac.onGround) return null;
    const agl = c.ra * 0.3048;
    if (c.u < -320) return 'Power lines at the threshold, 15 to 29 m up: over the top at 130 ft, or under at 35. Decide early; the pole line by the road comes first.';
    if (c.u < -130) {
      if (agl > 31) return 'Over the top: hold this height until the marker balls are behind you.';
      if (agl < 11) return 'Under the wires: below 35 ft, wings level, between the pylons.';
      return `Power lines in ${Math.max(0, Math.round((-120 - c.u) / 10) * 10)} m at wire height: climb to 130 ft, above the pylon tops, or get down under 35 ft, now.`;
    }
    if (c.u < 40) return agl > 20 ? 'Over the wires. Idle, full flap, push: the runway is right under you.' : 'Under. Wings level, hold it, and land straight ahead.';
    return null;
  },
};

// ------------------------------------------------------------------ 37: The Notch
// Moose Creek Notch (above) with the forest edge standing right at the end of the gravel: three rows of spruce 40 m
// tall (scale 1.6), 220 m wide, the last row's trunks at NOTCH_U on the bar's own flat, and one notch cut through it
// 16 m left of the centreline. All of it is course trees: one instanced draw, swept collision against the trunk and
// the crown as drawn. Out of the notch the airplane is over the bar, 16 m left of the strip and about 15 m up, with
// 340 m left: a jink right, idle, and down; the site's aim point is 120 m in, the earliest a landing out of the notch
// can touch. (Until 2026-09-22 the wall stood 150 m before the bar, on ground 5-7 m above it, and the pilot lined up
// on the strip after it like any approach; Marc: "you fly through the trees and the runway's already passing you".)
const theNotch = {
  id: 'the-notch', n: 37, title: 'The Notch', group: 'obstacles', difficulty: 5, tags: ['obstacles', 'bush'],
  aircraft: 'trailblazer', site: 'notchbar', time: 8.6, vis: 30000,
  desc: 'The spruce in front of Moose Creek Bar have grown into a wall 40 metres tall and three rows deep, standing right at the end of the gravel, and the only way through is a notch 30 metres wide, 16 metres left of the strip. Come out of it low with the wings level and the bar already under you; then a jink right, power off, and down onto what is left of 340 m. Over the top counts as not doing the mission.',
  tips: [
    'Full flap (F twice), 50 kt, and line up on the orange gate in the notch from a long way out. It is 16 m left of the centerline; your wings are 11 m.',
    'Through the gap at 30 to 50 ft above the bar, wings level. The crowns are widest at the bottom of the green, so low and centred is the safe line.',
    'Out of the notch the strip is beside you: a quick jink right onto the gravel, power to idle, push, and put it down by the 120 m mark. Brake gently (Space) or it will nose over.',
  ],
  wind: { rel: 25, speed: 6, turb: 0.3 }, weight: 'normal',
  spawn: { u: -850, v: -12, alt: 62, gamma: -3, flap: 1, speedKt: 52, fixed: true },
  failures: [], scoring: { type: 'bush' },
  course: {
    obstacles: [
      { kind: 'treeWall', u: NOTCH_U, from: -110, to: 110, step: 9, scale: 1.6, rows: 3, rowGap: 13, jitter: 3, seed: 7, gap: { v: NOTCH_V, w: NOTCH_W } },
    ],
    gates: [{ u: NOTCH_U - 13, v: NOTCH_V, y: 17, w: 20, h: 16, name: 'the notch', required: true }],
    // keep the decorative forest off the line to the notch (the run-in over the ground before the bar's flat)
    clear: [{ u: -100, v: NOTCH_V, r: 40 }, { u: -60, v: NOTCH_V, r: 35 }],
  },
  // RoutePilot: the line to the notch, through it at 17.5 m, then the jink right and down to the 120 m aim point
  // (tools/fly-mission.mjs the-notch --node: 97 and 94 on seeds 307 and 4271, touching down 161-165 m in)
  route: [
    { u: -520, v: NOTCH_V, alt: 34, kt: 52 },
    { u: -120, v: NOTCH_V, alt: 21, kt: 50, over: true },
    { u: NOTCH_U - 13, v: NOTCH_V, alt: 17.5, kt: 50, over: true },
    { u: 30, v: -12, alt: 11, kt: 49 },
    { u: 80, v: -4, alt: 6, kt: 48 },
  ],
  // The line to the notch: 12 m over the ground at the wall, and a 4-degree slope back from it.
  hint: (c) => {
    if (c.ac.onGround) return null;
    // (the wall's three rows stand from about u -40 to 0, crowns included)
    if (c.u < -42) {
      const off = c.v - NOTCH_V;
      if (Math.abs(off) > 6) return `Line up on the notch: ${Math.round(Math.abs(off))} m ${off > 0 ? 'left' : 'right'}. It is the gap with the orange gate.`;
      const agl = c.ra * 0.3048, want = 12 + (NOTCH_U - 13 - c.u) * 0.07;
      if (agl > want + 12) return 'High for the notch: power back and come down, 12 m over the ground at the trees.';
      if (agl < want - 8) return 'Low: a little power.';
      return 'On the notch. Wings level, 50 kt, 12 m over the ground at the trees.';
    }
    if (c.u < 0) return 'In the notch. Wings level, hold it steady.';
    if (c.u < 40) return 'Through! Jink right onto the gravel, power to idle.';
    if (c.u < 140) return 'Push it down: touch down by the 120 m mark, then brake gently.';
    return null;
  },
};

// ------------------------------------------------------------------ 38: Harbor Cranes
// Harbor City's container port, on the coast 1.1 km east of the runway and right on the approach: the quay runs from
// 3.7 km out to 2.4 km, and the harbor exit gate is 2.4 km from the threshold. A quay 1.3 km long, five ship-to-shore
// cranes, container stacks, a container ship alongside, a barque at anchor off the entrance. The approach is flown up
// the harbor along a lane LANE metres right of the runway, through the entrance and exit gates. The fourth crane has
// its boom lowered right across the lane (its underside 50 m above the water, its stays above it, its tip 7 m past
// the middle of the lane); under it is a bonus gate. Then an S-turn out of the harbor - left, then right, about 27
// degrees of bank at 146 kt (two arcs of 1,147 m) - that rolls out on the centreline FINAL_U from the threshold, where
// the glideslope is 150 ft up: the lane's height, held all the way round. (Until 2026-09-22 the harbor stood 5.1 to
// 6.7 km out with a 3 km straight final after it; Marc: "the obstacle and then immediately the runway". It came 2.7 km
// down the approach and 170 m further out to sea, because the coast here runs at v 945-1085 and the ships must float.)
const LANE = 1170;           // the lane up the harbor, metres right of the runway centreline
const QUAY_FACE = 1100;      // the quay's seaward face
const BOOM_U = -2800;        // the crane with its boom lowered across the lane
const EXIT_U = -2400;        // the harbor exit gate
const FINAL_U = -400;        // where the S-turn out of the harbor rolls out on the centreline
const S_MID_U = (EXIT_U + FINAL_U) / 2;
const LANE_ALT = 40;         // the CG's height (above the threshold) leaving the harbor, held through the S-turn
// the 3-degree glide path's height above the threshold at u (aim point 400 m in), and the Condor's CG on it
const GLIDE = (u) => Math.max(0, 400 - u) * Math.tan(3 * Math.PI / 180);
const ON_PATH = (u) => Math.round((GLIDE(u) + 4.1) * 10) / 10;
const harborCranes = {
  id: 'harbor-cranes', n: 38, title: 'Harbor Cranes', group: 'obstacles', difficulty: 4, tags: ['obstacles', 'heavy'],
  aircraft: 'condor', site: 'harbor', time: 17.2, vis: 25000,
  desc: 'The scenic approach to Harbor City, right on the doorstep: up the container port at crane height, through the harbor gates, past a ship being loaded, and under or over a crane boom lowered across the lane 50 metres over the water. Out of the harbor exit the threshold is 2.4 km away and a kilometre to your left: an S-turn at 150 ft, and land.',
  tips: [
    'Fly the lane up the harbor through both gates, 200 ft over the water, flaps 30, gear down, about 150 kt. Small bank angles: your wingtips are 17 m out.',
    'The lowered boom: over it means 300 ft or more, clear of its stays; under it means 100 ft or less, because your fin is 9 m tall. Under it is worth 10 points.',
    'Through the exit gate, roll left into 27 degrees of bank and hold 150 ft; halfway to the runway reverse it, and roll out on the centerline 400 m out with the glideslope meeting you. Before the turn, not in it: Arm the spoilers (K) and set autobrake (L).',
  ],
  wind: { rel: 70, speed: 8, turb: 0.15 }, weight: 'normal',
  spawn: { u: -5300, v: 1490, hdg: -12, alt: 60, gamma: 0, flap: 0.75, speedKt: 150, fixed: true },
  failures: [], scoring: { type: 'runway' },
  course: {
    obstacles: [
      { kind: 'quay', u: -3050, v: QUAY_FACE - 50, w: 100, d: 1300, top: 4, name: 'the quay' },
      { kind: 'containers', u: -3350, v: 1025, rot: -90, cols: 9, rows: 10, tiers: 4, base: -4, seed: 3 },
      { kind: 'containers', u: -2550, v: 1025, rot: -90, cols: 7, rows: 10, tiers: 5, base: -4, seed: 9 },
      { kind: 'crane', type: 'sts', u: -3550, v: 1070, boom: 80, base: -4 },
      { kind: 'crane', type: 'sts', u: -3300, v: 1070, boom: 80, base: -4 },
      { kind: 'crane', type: 'sts', u: -3050, v: 1070, boom: 80, base: -4, color: 'craneBlue' },
      { kind: 'crane', type: 'sts', u: BOOM_U, v: 1070, boom: 0, outreach: 90, base: -4, name: 'a container crane', boomName: 'the lowered crane boom' },
      { kind: 'crane', type: 'sts', u: -2550, v: 1070, boom: 80, base: -4, color: 'craneBlue' },
      { kind: 'ship', type: 'container', u: -3420, v: QUAY_FACE + 17, rot: -90, length: 240, beam: 30, seed: 4, name: 'the container ship' },
      { kind: 'ship', type: 'tall', u: -4050, v: 1320, rot: -80, length: 72, beam: 11, name: 'the barque', mastName: 'the barque\'s masts' },
    ],
    gates: [
      { u: -3850, v: LANE, y: 52, w: 120, h: 90, name: 'the harbor entrance', required: true },
      { u: BOOM_U, v: LANE, y: 18, w: 40, h: 24, name: 'the gap under the boom', required: false, bonus: 10 },
      { u: EXIT_U, v: LANE, y: 52, w: 120, h: 90, name: 'the harbor exit', required: true },
    ],
  },
  // RoutePilot: the lane at 50 m, down to 22 m over the water for the boom (the bonus), up to LANE_ALT for the exit,
  // then the S-turn onto the centreline at FINAL_U, on the glide path (tools/fly-mission.mjs harbor-cranes --node: 81
  // and 84 on seeds 307 and 4271, every gate, touching down 400-460 m in)
  route: [
    { u: -4500, v: 1290, alt: 55, kt: 150 },
    { u: -3850, v: LANE, alt: 50, kt: 150 },
    { u: -3000, v: LANE, alt: 22, kt: 150 },
    { u: -2650, v: LANE, alt: 22, kt: 150 },
    { u: EXIT_U, v: LANE, alt: LANE_ALT, kt: 148 },
    ...sCurve(EXIT_U, LANE, FINAL_U, 0, LANE_ALT, ON_PATH(FINAL_U), 146, 40),
  ],
  hint: (c) => {
    if (c.ac.onGround) return null;
    const n = c.mission.next();
    if (c.u > -4000 && c.u < EXIT_U && Math.abs(c.v - LANE) > 60) return `Back to the lane up the harbor: ${Math.round(Math.abs(c.v - LANE))} m ${c.v > LANE ? 'left' : 'right'}.`;
    if (c.u > -3300 && c.u < BOOM_U) return 'Lowered boom ahead: over it at 300 ft, or under it below 100 ft (your fin is 9 m tall).';
    if (n && n.gate.required && n.dist < 1500) return `Next: ${n.gate.name}, ${Math.round(n.dist / 10) * 10} m.`;
    if (c.u >= EXIT_U && c.u < S_MID_U) return 'Out of the harbor: roll left, 27 degrees of bank, hold 150 ft.';
    if (c.u >= S_MID_U && c.u < FINAL_U) return `Now right: 27 degrees, roll out on the centerline${Math.abs(c.v) > 40 ? `, ${Math.round(Math.abs(c.v))} m to go` : ''}.`;
    if (c.u >= FINAL_U && c.u < 0 && Math.abs(c.v) > 15) return `Line up: ${Math.round(Math.abs(c.v))} m ${c.v > 0 ? 'left' : 'right'}.`;
    return null;
  },
};

export const OBSTACLES_MISSIONS = [powerLines, theNotch, harborCranes];
