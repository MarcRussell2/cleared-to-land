// Mission runtime: one per flight. What a mission adds on top of the landing itself: gates passed or missed,
// timers, mission-specific hints and HUD status, and extra lines in the debrief. The landing is still scored by
// src/systems/scoring.js, unedited; score() takes its result and adds to it.
//
// SKELETON (2026-09-17): a pass-through. score() returns the landing result unchanged.

export class MissionRuntime {
  constructor(sc, { world = null, weather = null, failRt = null, hud = null, audio = null } = {}) {
    this.sc = sc;
    this.world = world; this.weather = weather; this.failRt = failRt;
    this.hud = hud; this.audio = audio;
  }
  update(dt, t, ac) { /* stub */ }
  // A mission-specific hint, or null for the game's usual one. ctx = { ac, ra (ft), d (m to threshold), t }.
  hint(ctx) { return typeof this.sc.hint === 'function' ? this.sc.hint({ ...ctx, mission: this }) : null; }
  // Extra text for the HUD status line (e.g. "Gates 3/5"), or ''.
  status() { return ''; }
  // result = { points, grade, gradeIdx, lines: [{k, v, cls}], headline } from scoreLanding.
  score(result, ac, approach) { return result; }
  dispose() { /* stub */ }
}
