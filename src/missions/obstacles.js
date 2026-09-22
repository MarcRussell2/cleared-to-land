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
// site on its own is just the bar (its aim point is 170 m in, where a landing out of the notch and the jink onto the
// strip can first touch): nothing else that flies here (free flight, Autoland, the look and perf tools)
// meets a wall it cannot see a way through. `missionOnly`: a site that exists for a mission; the free-flight picker
// should leave it out (the new home menu honours it; the old menu lists every site).
const NOTCH_V = -28, NOTCH_W = 30, NOTCH_U = -6;
const notchbar = {
  id: 'notchbar', name: 'Moose Creek Notch', kind: 'bush', missionOnly: true,
  terrain: { style: 'mountain', seed: 61, size: 14000, res: 400, elevation: 520, waterLevel: 516, valleyWidth: 1400, trees: 0.9, treeArea: 4500, snowLine: 1900 },
  runways: [{ x: 0, z: 0, heading: 0, length: 340, width: 14, surface: 'gravel', elevation: 520, name: '36', nameRecip: '18', papi: false, ils: false, lights: false, windsock: true, markers: true, aimDistance: 170, flatWidth: 60, flatMargin: 120 }],
  course: {
    // the valley's scattered spruce, where Moose Creek Bar has them (its x -> v, z -> -u)
    // (the one that stood at x -34, z 260 moved to -70, 240 on 2026-09-22: it was on the run-in to the notch)
    obstacles: [[-70, 240, 1.1], [45, 320, 1.2], [22, 420, 1.0], [-48, 470, 1.1], [-25, -420, 1.2], [40, -380, 1.1]].map(([x, z, s]) => ({ kind: 'tree', u: -z, v: x, scale: s })),
  },
};

export const OBSTACLES_SITES = { notchbar };

// ------------------------------------------------------------------ 36: Power Lines
// Ridgefield (runway 36, 1,600 m, threshold elevation 120 m; the ground is at the threshold's height for the last few
// hundred metres of the approach). A line of 34 m lattice pylons crosses the approach diagonally right before the
// threshold, 120 m out over the centreline; mid-span its lowest conductors hang 14.5 m above the ground, its middle
// pair 21 m and its earth wire 28.7 m. A 10 m pole line runs along the road 230 m out, before the pylons. The start
// is an ordinary one, 900 m out on the 3-degree glideslope - which runs 20.6 m up at the pylons, among the wires: the
// path you are on hits them (the stock Autoland does, proven), so the mission is the decision. Over the top means
// levelling off at 40 m and a landing from 40 m over the threshold (idle, full flap, a slip; RoutePilot touches down
// 270-290 m in); under means below about 11 m (the fin stands 2.4 m over the CG) between the pylons, wings level -
// and the pole line's wires at 10 m, 110 m before that, leave a slot of about four metres to thread. (Until
// 2026-09-22 the pylons stood 600 m out and the pilot flew a normal final after them; on the first cut of the move
// the start was still 2.6 km out, level at wire height, 50 ft up for two kilometres - Marc: "you spawn really far and
// low"; now 900 m on the glideslope.)
const powerLines = {
  id: 'power-lines', n: 36, title: 'Power Lines', group: 'obstacles', difficulty: 3, tags: ['obstacles', 'low'],
  aircraft: 'skylark', site: 'ridgefield', time: 7.8, vis: 4500,
  desc: 'Half a mile out on a normal approach, and the county\'s high-voltage line crosses the approach right in front of the threshold, 34-metre pylons and all. The glideslope you are on runs straight through its wires, which hang between 15 and 29 m over the centerline. Over the top means 130 ft over the numbers and a dive at 1,600 m of runway; under means 35 ft between the pylons, after a four-metre slot over the pole line by the road.',
  tips: [
    'Decide now. Over: full power and level off at 130 ft, well before the pylons, and hold it until the orange marker balls are behind you. A Skylark climbs 500 feet a minute, so there is no time to think about it twice.',
    'Over the wires, throttle to idle, full flap and push: you are 40 m up over the threshold with the aiming bars 250 m ahead. A slip (rudder one way, aileron the other) gets you down without the speed.',
    'Under: come down early to about 40 ft, thread the slot over the 10 m pole line by the road, then hold 35 ft and wings level between the pylons. There is 1,600 m to stop in, so a long landing is fine; a crooked one is not.',
  ],
  wind: { rel: 25, speed: 8, turb: 0.2 }, weight: 'normal',
  spawn: { u: -900, v: 0, flap: 0.333, speedKt: 72, fixed: true },
  failures: [], scoring: { type: 'runway' },
  course: {
    obstacles: [
      { kind: 'powerline', type: 'hv', from: { u: -50, v: -900 }, to: { u: -190, v: 900 }, spans: 5, h: 34, sag: 5, markers: 60, name: 'the power lines' },
      { kind: 'powerline', type: 'pole', from: { u: -230, v: -550 }, to: { u: -230, v: 550 }, spans: 11, h: 10, name: 'the power lines along the road' },
    ],
  },
  // RoutePilot: level off at 40 m, over the wires, then steeply down onto the runway (tools/fly-mission.mjs
  // power-lines --node: 100 and 75 on seeds 307 and 4271, touching down 270-290 m in)
  route: [
    { u: -480, v: 0, alt: 40, kt: 70 },
    { u: -180, v: 0, alt: 40, kt: 68, over: true },
    { u: -70, v: 0, alt: 40, kt: 66, over: true },
    { u: 120, v: 0, alt: 8, kt: 63 },
  ],
  hint: (c) => {
    if (c.ac.onGround) return null;
    const agl = c.ra * 0.3048;
    if (c.u < -480) return 'The glideslope runs through the wires at the threshold. Over the top at 130 ft, or under at 35: decide now.';
    if (c.u < -130) {
      if (agl > 31) return 'Over the top: hold this height until the marker balls are behind you.';
      if (agl < 12) return c.u < -240 ? 'Under: the pole line by the road first, 10 m tall, then stay below 35 ft.' : 'Under the wires: below 35 ft, wings level, between the pylons.';
      return `Power lines in ${Math.max(0, Math.round((-120 - c.u) / 10) * 10)} m, at your height: climb to 130 ft, above the pylon tops, or get down under 35 ft, now.`;
    }
    if (c.u < 40) return agl > 20 ? 'Over the wires. Idle, full flap, push: the runway is right under you.' : 'Under. Wings level, hold it, and land straight ahead.';
    return null;
  },
};

// ------------------------------------------------------------------ 37: The Notch
// Moose Creek Notch (above) with a forest edge of giants standing right at the end of the gravel: three rows of
// spruce about 85 m tall (scale 3.4; Sitka spruce reach 96 m), 240 m wide, the last row's trunks at NOTCH_U on the
// bar's own flat, and one notch cut through the canopy 30 m wide, NOTCH_V (28 m) left of the centreline - the crown
// of the giant standing just right of the centreline covers the whole strip. No gate: the notch is the only way onto
// the bar because there is no other. Over the top there is no bar left - from 90 m up the Trailblazer at idle touches
// 340 m in and overruns, and even a full forward slip touches 260-275 m in and overruns (measured, 2026-09-22); a
// straight-in hits a tree; round the wall's end is 120 m of side-step with none to do it in. Out of the notch the
// airplane is over the bar 28 m left of the strip and about 15 m up: a jink right onto the gravel, idle, and down;
// the site's aim point is 170 m in. RoutePilot lands it 83 / 89 on seeds 307 / 4271 (touchdown 192-208 m, stopped
// 271-282): a landing, not a pretty one, which is the mission. (2026-09-22, second cut: the first put the wall at the
// threshold with an orange gate in a 40 m wall; Marc: "you shouldn't have a box that you're supposed to fly through
// ... force the user to fly through the obstacle because there's no other easier way".)
const theNotch = {
  id: 'the-notch', n: 37, title: 'The Notch', group: 'obstacles', difficulty: 5, tags: ['obstacles', 'bush'],
  aircraft: 'trailblazer', site: 'notchbar', time: 8.6, vis: 30000,
  desc: 'The spruce in front of Moose Creek Bar are giants, 85 metres tall and three rows deep, standing right at the end of the gravel, and the only way onto the bar is a notch in the canopy 30 metres wide, just left of the strip. There is no going over: from 90 m up there is no bar left to land on. Through the notch low, a jink right onto the gravel, power off, and down onto what is left of 340 m.',
  tips: [
    'Full flap (F twice), 50 kt, and line up on the notch from a long way out: the gap in the canopy 28 m left of the strip, its trunks 50 m apart below it. Your wings are 11 m.',
    'Through it at 40 to 60 ft above the bar, wings level, and do not look up: the crowns start 90 ft up. Under them it is a corridor between trunks.',
    'Out of the notch the strip is beside you: roll right at once, about 25 degrees, and back level on the centerline with the power at idle; the wheels want to be on by the 170 m mark. Brake gently (Space) or it will nose over.',
  ],
  wind: { rel: 25, speed: 6, turb: 0.3 }, weight: 'normal',
  spawn: { u: -850, v: -12, alt: 62, gamma: -3, flap: 1, speedKt: 52, fixed: true },
  failures: [], scoring: { type: 'bush' },
  course: {
    obstacles: [
      { kind: 'treeWall', u: NOTCH_U, from: -120, to: 120, step: 9, scale: 3.4, rows: 3, rowGap: 14, jitter: 3, seed: 7, gap: { v: NOTCH_V, w: NOTCH_W } },
    ],
    // keep the decorative forest off the line to the notch (the run-in over the ground before the bar's flat)
    clear: [{ u: -100, v: NOTCH_V, r: 40 }, { u: -60, v: NOTCH_V, r: 35 }],
  },
  // RoutePilot: the line to the notch, through it at 15 m, then the jink right, slowing to 45 kt, to the 170 m aim
  route: [
    { u: -520, v: NOTCH_V, alt: 34, kt: 52 },
    { u: -120, v: NOTCH_V, alt: 21, kt: 50, over: true },
    { u: NOTCH_U - 13, v: NOTCH_V, alt: 15, kt: 50, over: true },
    { u: 40, v: -20, alt: 9.5, kt: 48 },
    { u: 90, v: -6, alt: 5.5, kt: 46 },
    { u: 140, v: 0, alt: 3.5, kt: 45 },
  ],
  // The line to the notch: 12 m over the ground at the wall, and a 4-degree slope back from it.
  hint: (c) => {
    if (c.ac.onGround) return null;
    // (the wall's three rows stand from about u -48 to 8, crowns included)
    if (c.u < -50) {
      const off = c.v - NOTCH_V;
      if (Math.abs(off) > 6) return `Line up on the notch: ${Math.round(Math.abs(off))} m ${off > 0 ? 'left' : 'right'}. It is the gap in the canopy, left of the strip.`;
      const agl = c.ra * 0.3048, want = 12 + (NOTCH_U - 13 - c.u) * 0.07;
      if (agl > want + 12) return 'High for the notch: power back and come down, 12 m over the ground at the trees.';
      if (agl < want - 8) return 'Low: a little power.';
      return 'On the notch. Wings level, 50 kt, 12 m over the ground at the trees.';
    }
    if (c.u < 8) return 'In the notch. Wings level, hold it steady.';
    if (c.u < 60) return 'Through! Roll right onto the gravel, power to idle.';
    if (c.u < 190) return Math.abs(c.v) > 8 ? `The strip: ${Math.round(Math.abs(c.v))} m ${c.v > 0 ? 'left' : 'right'}. Level and down by the 170 m mark.` : 'Wings level, push it down: touch down by the 170 m mark, then brake gently.';
    return null;
  },
};

// ------------------------------------------------------------------ 38: Harbor Cranes
// Harbor City's container basin, right on the approach, and the airliner starts inside it: a landward quay (its face
// at v QUAY_FACE) and a mole (its face at MOLE_FACE) 170 m apart, five ship-to-shore cranes on each with EVERY boom
// lowered across the basin (BOOM_OUT metres of outreach: the landward tips reach v 1192, the mole's 1178, so both
// cross the lane at v LANE), a ship alongside each quay, container stacks behind. The booms stand 50 m over the
// water, one every 125 m from alternate sides; the start is 100 m before the first, 26 m over the water at 150 kt.
// No gates: the geometry is the rule. Climbing out is not on - the fin must stay under a boom (the CG below 33 m
// above the threshold), and above the booms each crane's tip stays block its plane up to about 56 m, so getting out
// means gaining 24 m between two cranes 1.6 s apart, which a 60-tonne airliner at 150 kt cannot (tools/
// test-obstacles.mjs flies a full pull-up from eight moments: every one ends in a boom or a stay). Turning out is
// not on either: the quays are 85 m either side and a 40-degree bank moves the airliner 150 m sideways only after
// 500 m, and a drift out over the mole ends in a crane. The stock Autoland, heading for the centreline, hits a
// crane. So: the lane at 100 ft to the end of the basin, then the S-turn out of it onto the final - two arcs of
// 1,147 m, 27 degrees at 146 kt, rolling out on the centreline FINAL_U from the threshold on the glide path.
// (2026-09-22, third cut of the day: the morning's had three gates and one boom to pass over, under or around;
// Marc: "no gates ... flying under the cranes ... how can I make this obstacle unavoidable".)
const LANE = 1185;           // the lane up the basin, metres right of the runway centreline
const QUAY_FACE = 1100;      // the landward quay's face
const MOLE_V = 1300;         // the mole's crane line; its landward face is MOLE_FACE
const MOLE_FACE = MOLE_V - 30;
const BOOM_OUT = 105;        // every boom's outreach: the landward tips reach v 1192, the mole's 1178
const LAND_U = [-3550, -3300, -3050, -2800, -2550];   // the landward cranes
const MOLE_U = [-3425, -3175, -2925, -2675, -2425];   // the mole's, between them
const BASIN_END = -2400;     // the end of the basin: from here the S-turn
const FINAL_U = -400;        // where the S-turn rolls out on the centreline
const S_MID_U = (BASIN_END + FINAL_U) / 2;
const LANE_ALT = 24;         // the CG's height (above the threshold) up the basin: 32 m over the water, 9 m under a boom
// the 3-degree glide path's height above the threshold at u (aim point 400 m in), and the Condor's CG on it
const GLIDE = (u) => Math.max(0, 400 - u) * Math.tan(3 * Math.PI / 180);
const ON_PATH = (u) => Math.round((GLIDE(u) + 4.1) * 10) / 10;
const harborCranes = {
  id: 'harbor-cranes', n: 38, title: 'Harbor Cranes', group: 'obstacles', difficulty: 4, tags: ['obstacles', 'heavy', 'low'],
  aircraft: 'condor', site: 'harbor', time: 17.2, vis: 25000,
  desc: 'Harbor City\'s container basin, and you are in it: two quays 170 metres apart, ten cranes, every boom lowered to 50 metres over the water, and an airliner between them at 100 ft and 150 kt. There is no climbing out, the next boom is a second and a half away, and no room to turn; so it is the lane to the end of the basin, then an S-turn onto a final 400 m long.',
  tips: [
    'Hold 100 ft on the radio altimeter and the middle of the basin: the booms are 50 m over the water and your fin stands 9 m over you; the quays are 85 m either side of you, the ships 50. Flaps 30, gear down, about 150 kt.',
    'Small corrections only. At 150 kt a bank of ten degrees moves you 20 m sideways in two seconds, and there are ten booms, one every second and a half.',
    'Past the last crane, roll left into 27 degrees of bank and climb gently to 150 ft; halfway to the runway reverse it, and roll out on the centerline 400 m out with the glideslope meeting you. Before the turn, not in it: Arm the spoilers (K) and set autobrake (L).',
  ],
  wind: { rel: 70, speed: 8, turb: 0.15 }, weight: 'normal',
  spawn: { u: LAND_U[0] - 100, v: LANE, hdg: 0, alt: 18, gamma: 0, flap: 0.75, speedKt: 150, fixed: true },
  failures: [], scoring: { type: 'runway' },
  course: {
    obstacles: [
      { kind: 'quay', u: -3050, v: QUAY_FACE - 50, w: 100, d: 1300, top: 4, name: 'the quay' },
      { kind: 'quay', u: -3050, v: MOLE_FACE + 50, w: 100, d: 1300, top: 4, name: 'the mole' },
      { kind: 'containers', u: -3350, v: 1025, rot: -90, cols: 9, rows: 10, tiers: 4, base: -4, seed: 3 },
      { kind: 'containers', u: -2550, v: 1025, rot: -90, cols: 7, rows: 10, tiers: 5, base: -4, seed: 9 },
      { kind: 'containers', u: -3150, v: MOLE_FACE + 50, rot: -90, cols: 8, rows: 8, tiers: 4, base: -4, seed: 5 },
      { kind: 'containers', u: -2650, v: MOLE_FACE + 50, rot: -90, cols: 6, rows: 8, tiers: 3, base: -4, seed: 6 },
      ...LAND_U.map((u, i) => ({ kind: 'crane', type: 'sts', u, v: 1070, boom: 0, outreach: BOOM_OUT, base: -4, color: i % 2 ? 'craneBlue' : undefined, name: 'a container crane', boomName: 'a lowered crane boom' })),
      ...MOLE_U.map((u, i) => ({ kind: 'crane', type: 'sts', u, v: MOLE_V, rot: 180, boom: 0, outreach: BOOM_OUT, base: -4, color: i % 2 ? undefined : 'craneBlue', name: 'a container crane', boomName: 'a lowered crane boom' })),
      { kind: 'ship', type: 'container', u: -3420, v: QUAY_FACE + 17, rot: -90, length: 240, beam: 30, seed: 4, name: 'the container ship' },
      { kind: 'ship', type: 'container', u: -2700, v: MOLE_FACE - 17, rot: 90, length: 200, beam: 30, seed: 8, name: 'the second ship' },
      { kind: 'ship', type: 'tall', u: -4100, v: 1500, rot: -80, length: 72, beam: 11, name: 'the barque', mastName: 'the barque\'s masts' },
    ],
  },
  // RoutePilot: up the basin at LANE_ALT, then the S-turn onto the centreline at FINAL_U, on the glide path (79 / 69
  // on seeds 307 / 4271, touching down 375-413 m in)
  route: [
    { u: -3500, v: LANE, alt: LANE_ALT, kt: 150 },
    { u: -2500, v: LANE, alt: LANE_ALT, kt: 150 },
    { u: BASIN_END, v: LANE, alt: LANE_ALT + 2, kt: 148 },
    ...sCurve(BASIN_END, LANE, FINAL_U, 0, LANE_ALT + 2, ON_PATH(FINAL_U), 146, 40),
  ],
  hint: (c) => {
    if (c.ac.onGround) return null;
    const ra = c.ra;   // over the water the radio altimeter reads the height above the water
    if (c.u < BASIN_END) {
      const off = c.v - LANE;
      if (Math.abs(off) > 30) return `The middle of the basin: ${Math.round(Math.abs(off))} m ${off > 0 ? 'left' : 'right'}. The quays are 85 m out.`;
      if (ra > 110) return `Too high for the booms: down to 100 ft (${Math.round(ra)} ft). Your fin is 9 m tall.`;
      if (ra < 50) return 'Low over the water: a little power, back to 100 ft.';
      return 'Under the booms: hold 100 ft, wings level, the middle of the basin.';
    }
    if (c.u < S_MID_U) return 'Out of the basin: roll left, 27 degrees of bank, climb to 150 ft.';
    if (c.u < FINAL_U) return `Now right: 27 degrees, roll out on the centerline${Math.abs(c.v) > 40 ? `, ${Math.round(Math.abs(c.v))} m to go` : ''}.`;
    if (c.u < 0 && Math.abs(c.v) > 15) return `Line up: ${Math.round(Math.abs(c.v))} m ${c.v > 0 ? 'left' : 'right'}.`;
    return null;
  },
};

export const OBSTACLES_MISSIONS = [powerLines, theNotch, harborCranes];
