// Route pilot: flies a mission's `route` (waypoints in the runway frame: around the hill, through the gates,
// under the bridge) and then hands the airplane to the stock Autoland for the final approach and landing.
// Autoland (src/systems/autopilot.js) is not edited: it only ever flies a straight line from the aim point.
//
// This is what proves, headless, that an obstacle or city mission can be flown at all; it is also what
// game.setAutopilot(true) uses when the scenario has a route.
//
// SKELETON (2026-09-17): no route following yet; straight to Autoland.
import { Autoland } from './autopilot.js';

export class RoutePilot {
  constructor(ac, world, sc) {
    this.ac = ac; this.world = world; this.sc = sc;
    this.final = new Autoland(ac, world, sc);
    this.phase = 'final';
  }
  update(dt) { this.final.update(dt); }
}
