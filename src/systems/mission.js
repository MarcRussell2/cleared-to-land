// Mission runtime: one per flight. What a mission adds on top of the landing itself: gates passed or missed,
// near misses, mission-specific hints and HUD status, and extra lines in the debrief. The landing is still scored
// by src/systems/scoring.js, unedited; score() takes its result and adds to it.
//
// Gates come from the course (src/world/obstacles.js resolves them and detects the crossings, from the same
// swept step as the collisions); this file only reads the field's events and keeps the account:
//   - a REQUIRED gate that is missed (flown past outside its frame, or never reached before the flight ends)
//     fails the mission: the debrief says which, the headline says so, and the points are capped at MISSION_CAP
//     (the landing still shows its own lines: you did land, and how well);
//   - a BONUS gate passed adds its `bonus` points (the default is 5; one in the harbour is worth 10);
//   - the closest the airframe came to any solid is a debrief line ("Closest shave: 3.1 m from the crane boom"),
//     and a pass within 5 m gets a callout in flight. Flavour only: no points.
// status() is the HUD status line ("Gates 1/3 · the harbour exit 1.2 km"); hint() the scenario's own hint
// function, handed { ac, ra (ft), d (m to the threshold), t, u, v (runway frame), mission }.
//
// score(result, ac, approach) returns a NEW result ({ points, grade, gradeIdx, lines, headline }), clamped
// 0..100. A crash or a flight with no touchdown keeps its 0 points and gets the gate lines for the record.
// EXTENSION POINT (failures builder, another worktree): `sc.scoring.belly` - a gear-up landing on purpose - is
// scored in scoreExtras() below; it is marked there and left for that builder.

export const MISSION_CAP = 30;

export class MissionRuntime {
  constructor(sc, { world = null, weather = null, failRt = null, hud = null, audio = null } = {}) {
    this.sc = sc;
    this.world = world; this.weather = weather; this.failRt = failRt;
    this.hud = hud; this.audio = audio;
    this.field = world && world.obstacles ? world.obstacles : null;
    this.gates = this.field ? this.field.gates : [];
    this.passed = 0;
    this.bonus = 0;
    this._ctx = { ac: null, ra: 0, d: 0, t: 0, u: 0, v: 0, mission: this };
    this._next = { gate: null, dist: 0 };
    this.pos = null;
  }

  update(dt, t, ac) {
    this.pos = ac.pos;
    const f = this.field;
    if (!f || !f.events.length) return;
    for (const e of f.events) {
      if (e.type === 'gate') {
        const g = e.gate;
        if (e.passed) {
          this.passed++; this.bonus += g.bonus || 0;
          if (this.hud) this.hud.message(`Through ${g.name}` + (g.bonus ? `  +${g.bonus}` : ''), '', 2);
          if (this.audio) this.audio.beep(988, 0.12);
        } else {
          if (this.hud) this.hud.message(g.required ? `MISSED ${g.name.toUpperCase()}` : `Missed ${g.name}`, g.required ? 'bad' : 'warn', 3);
          if (this.audio) this.audio.beep(330, 0.35);
        }
      } else if (e.type === 'close' && !ac.crashed && this.hud) {
        this.hud.callout(`${Math.max(0, e.d).toFixed(1)} m`, 1.4);
      }
    }
    f.events.length = 0;
  }

  // The next gate still to fly, and how far its plane is along its own direction (metres), or null.
  next() {
    const p = this.pos;
    if (!p) return null;
    for (const g of this.gates) {
      if (g.state !== 'pending') continue;
      this._next.gate = g;
      this._next.dist = Math.max(0, (g.x - p.x) * g.n[0] + (g.z - p.z) * g.n[2]);
      return this._next;
    }
    return null;
  }

  // A mission-specific hint, or null for the game's usual one. ctx = { ac, ra (ft), d (m to threshold), t }.
  hint(ctx) {
    if (typeof this.sc.hint !== 'function') return null;
    const c = this._ctx, ac = ctx.ac;
    c.ac = ac; c.ra = ctx.ra; c.d = ctx.d; c.t = ctx.t; this.pos = ac.pos;
    const rw = this.world && this.world.runway;
    if (rw) {
      const dx = ac.pos.x - rw.threshold.x, dz = ac.pos.z - rw.threshold.z;
      c.u = dx * rw.dir.x + dz * rw.dir.z; c.v = dx * rw.right.x + dz * rw.right.z;
    } else { c.u = -ctx.d; c.v = 0; }
    return this.sc.hint(c);
  }

  // Extra text for the HUD status line (e.g. "Gates 1/3 · the harbour exit 1.2 km"), or ''.
  status() {
    if (!this.gates.length) return '';
    const n = this.next();
    const s = `Gates ${this.passed}/${this.gates.length}`;
    if (!n) return s;
    return `${s} · ${n.gate.name} ${n.dist >= 1000 ? (n.dist / 1000).toFixed(1) + ' km' : Math.round(n.dist / 10) * 10 + ' m'}`;
  }

  // result = { points, grade, gradeIdx, lines: [{k, v, cls}], headline } from scoreLanding.
  score(result, ac, approach) {
    const out = { ...result, lines: result.lines.slice() };
    const line = (k, v, cls = '') => out.lines.push({ k, v, cls });
    const f = this.field;
    if (f) {
      // anything never reached counts as missed now
      const missedRequired = [];
      for (const g of this.gates) if (g.state === 'missed' || g.state === 'pending') { if (g.required) missedRequired.push(g); }
      if (this.gates.length) {
        line('Gates', `${this.passed}/${this.gates.length}` + (this.bonus ? ` (+${this.bonus})` : ''), missedRequired.length ? 'bad' : 'good');
        for (const g of this.gates) if (g.state !== 'passed') line(g.state === 'pending' ? 'Not flown' : 'Missed gate', g.name + (g.required ? '' : ' (bonus)'), g.required ? 'bad' : 'warn');
      }
      if (f.closestD < 15 && f.closestName) line('Closest shave', `${Math.max(0, f.closestD).toFixed(1)} m from ${f.closestName}`, f.closestD < 3 ? 'warn' : '');
      const flown = !ac.crashed && ac.stats.touchdown;
      if (flown) {
        out.points = Math.max(0, Math.min(100, Math.round(out.points + this.bonus)));
        if (missedRequired.length) {
          out.points = Math.min(out.points, MISSION_CAP);
          out.grade = 'MISSED GATE'; out.gradeIdx = 4;
          out.headline = `You landed, but you missed ${missedRequired[0].name}. The mission does not count.`;
          line('Mission', `FAILED: ${missedRequired.map((g) => g.name).join(', ')} (points capped at ${MISSION_CAP})`, 'bad');
        }
      }
    }
    this.scoreExtras(out, ac, approach);
    out.points = Math.max(0, Math.min(100, Math.round(out.points)));
    return out;
  }

  // EXTENSION POINT for scenario-specific scoring beyond gates. The failures builder adds `sc.scoring.belly`
  // (a deliberate gear-up landing) here: scoreLanding penalises BELLY LANDING 50 points, and a belly mission
  // must take that line back and score the slide instead. Nothing is done here yet.
  scoreExtras(out, ac, approach) { void out; void ac; void approach; }

  dispose() { this.field = null; this.gates = []; }
}
