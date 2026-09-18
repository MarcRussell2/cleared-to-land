// Obstacles and gates for a mission: city towers, bridges you fly under, power lines, cranes, masts, tree walls
// with a notch, and the gates of a slalom. This file decides where they are and what counts as hitting them;
// src/art/city-look.js (reached through the art door, src/art/terrain-look.js) decides how they look.
//
// Why not terrain.obstacles: those are flat-topped columns in the ground query, so radio altitude reads the
// roof of anything underneath (ground effect, the assist flare, callouts, altitude-triggered failures and the
// chase camera all follow it), nothing can be flown UNDER, and the list is scanned linearly per contact point.
// Here the airframe is tested after each physics step with swept probe spheres (src/aircraft/hulls.js)
// against real volumes (boxes with a bottom and a top, cylinders, cables), through a grid, and a hit calls the
// aircraft's public crash(). The ground query and the physics are untouched.
//
// Placement is in the runway frame of site.runways[0] (u along, v right, y above the threshold elevation);
// see src/missions/README.md.
//
// STUB (skeleton, 2026-09-17): plan() returns null, so no mission has a course yet.

export class ObstacleField {
  // Resolve the site's and the scenario's `course` into world space. Returns null when there is nothing to
  // place. The result carries `keepOut` rectangles the terrain uses to keep trees and villages out of it.
  static plan(site, sc) {
    const a = site && site.course, b = sc && sc.course;
    if (!a && !b) return null;
    return null;   // stub
  }
  constructor(course, { terrain = null, site = null } = {}) {
    this.course = course;
    this.terrain = terrain;
    this.site = site;
    this.gates = [];
  }
  build(scene, opts = {}) { /* stub */ }
  reset(ac) { /* stub */ }
  hit(ac) { return null; }
  update(dt, t, pos) { /* stub */ }
}
