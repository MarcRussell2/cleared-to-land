// Scoring checks (2026-09-15): a touchdown at or near the stall costs nothing, only a fast one does; a stall
// or stall horn inside the flare zone is part of the landing, not the approach; the stall the Stall Recovery
// challenge starts in (held for the pilot) is not counted. Plain Node, no GPU.
import { scoreLanding } from '../src/systems/scoring.js';
import { SKYLARK, TRAILBLAZER } from '../src/aircraft/defs.js';
import { KT } from '../src/config.js';

let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };

function landing(def, { ias, flap = 1, stats = {}, scoring = {} }) {
  const ac = {
    def, mass: def.mass, crashed: false, ctl: { flap },
    stats: {
      touchdown: { vs: 0.4, vlat: 0.2, roll: 0, pitch: 0.12, ias: ias * KT, legs: ['left', 'right'] },
      touchdowns: [], stalls: 0, stallsLow: 0, stallsHeld: 0, stallWarnTime: 0, stallWarnTimeLow: 0,
      bounces: 0, damage: [], goArounds: 0, tailstrike: false, propstrike: false, wingtip: false, gearCollapse: false, belly: false,
      ...stats,
    },
  };
  const approach = { runway: { aimDistance: 300, length: 1800, width: 30 }, tdU: 300, tdV: 0, stopU: 700, offRunway: false, overran: false, gsSamples: 0, noseDownSpeed: null };
  const sc = { scoring: { type: 'runway', ...scoring }, failures: [] };
  const r = scoreLanding(ac, sc, approach);
  const find = (k) => r.lines.find((l) => l.k === k);
  return { r, find };
}
const penalty = (line) => { const m = line && /\(-(\d+)\)/.exec(line.v); return m ? +m[1] : 0; };

console.log('\n== Speed at touchdown ==');
{
  const vs0 = SKYLARK.speeds.Vs0;
  const { r, find } = landing(SKYLARK, { ias: vs0 + 1 });
  const s = find('Speed at touchdown');
  check(penalty(s) === 0, `Skylark at ${vs0 + 1} kt, full flap (the stall): no speed penalty ("${s.v}")`);
  check(/held off to the stall/.test(s.v), 'the debrief calls it a hold-off to the stall');
  check(r.grade === 'GREASED', `a soft full-stall landing on the numbers still grades GREASED (${r.points} pts, ${r.grade})`);
  const slow = landing(SKYLARK, { ias: SKYLARK.speeds.Vref - 12 }).find('Speed at touchdown');
  check(penalty(slow) === 0, `Skylark 12 kt under Vref: no speed penalty ("${slow.v}")`);
  const tb = landing(TRAILBLAZER, { ias: TRAILBLAZER.speeds.Vs0 }).find('Speed at touchdown');
  check(penalty(tb) === 0, `Trailblazer three-pointed at the stall: no speed penalty ("${tb.v}")`);
  const fast = landing(SKYLARK, { ias: SKYLARK.speeds.Vref + 15 }).find('Speed at touchdown');
  check(penalty(fast) > 0, `Skylark 15 kt over Vref still costs points (-${penalty(fast)})`);
}

console.log('\n== Stalls and the stall horn ==');
{
  const inFlare = landing(SKYLARK, { ias: 43, stats: { stalls: 1, stallsLow: 1 } });
  check(!inFlare.find('Stalls on approach'), 'a stall inside the flare zone is not a stall on approach');
  const high = landing(SKYLARK, { ias: 55, stats: { stalls: 1, stallsLow: 0 } });
  check(penalty(high.find('Stalls on approach')) === 15, 'a stall above the flare zone still costs 15');
  const hornLow = landing(SKYLARK, { ias: 44, stats: { stallWarnTime: 4, stallWarnTimeLow: 4 } });
  check(!hornLow.find('Stall warning'), 'four seconds of horn in the flare cost nothing');
  const hornHigh = landing(SKYLARK, { ias: 55, stats: { stallWarnTime: 6, stallWarnTimeLow: 1 } });
  check(penalty(hornHigh.find('Stall warning')) === 5, 'five seconds of horn on the approach still cost 5');
  const held = landing(SKYLARK, { ias: 55, stats: { stalls: 2, stallsHeld: 1 }, scoring: { stallStart: true } });
  check(held.find('Stalls on approach') && held.find('Stalls on approach').v.startsWith('1'), 'Stall Recovery: the held starting stall is free, a second stall is counted');
  const heldOnly = landing(SKYLARK, { ias: 55, stats: { stalls: 1, stallsHeld: 1 }, scoring: { stallStart: true } });
  check(!heldOnly.find('Stalls on approach'), 'Stall Recovery: only the held starting stall means no stall penalty');
}

console.log(failures ? `\n${failures} scoring check(s) FAILED` : '\nall scoring checks passed');
process.exit(failures ? 1 : 0);
