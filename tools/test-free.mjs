// Free flight checks (2026-09-19): the builder's options -> scenario (src/missions/free.js). A saved setup is never
// trusted (anything JSON.parse can return boots), the same options and seed give the same flight, "Obstacles off" is
// course: false, a failure asked for "on approach" or "on short final" fires below where the flight starts (never in
// its first second), and the places offered are ones the airplane can land at. Plain Node, no GPU.
import { validateFreeOpts, buildFreeFlight, siteUsable, landingHeading } from '../src/missions/free.js';
import { SITES, SCENARIOS, resolveScenario } from '../src/systems/scenarios.js';
import { AIRCRAFT } from '../src/aircraft/defs.js';
import { FAILURES } from '../src/systems/malfunctions.js';
import { RANDOM_AIRCRAFT, missionFlies } from '../src/ui/aircraft-catalog.js';
import { makeRng } from '../src/config.js';

let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };
const FT = 0.3048;

// the defaults main.js hands validateFreeOpts (DEFAULT_FREE)
const DEFAULTS = { aircraft: 'skylark', site: 'bayfield', weather: 'clear', windRel: -60, windSpeed: 8, windGust: 12, turb: 0.15, microburst: false, time: 15, vis: 30000, ceilingFt: null, seaState: 0.3, weight: 'normal', dist: 5000, obstacles: true, failures: [], surprise: false, when: 'approach' };
const clean = (raw) => validateFreeOpts(raw, { defaults: DEFAULTS, sites: SITES, aircraft: AIRCRAFT, failures: FAILURES, missions: SCENARIOS });
const build = (o, seed = 1) => buildFreeFlight({ ...DEFAULTS, ...o }, { sites: SITES, seed, missions: SCENARIOS });
const altOf = (sc) => (sc.failures[0] && sc.failures[0].at.type === 'alt' ? sc.failures[0].at.value : null);

console.log('\n== A saved setup is cleaned, never trusted ==');
{
  const junk = [undefined, null, 'string', 42, [], [1, 2], {}, { aircraft: 'zeppelin', site: 'atlantis', weather: 'plague', failures: ['gremlins', 7, null], when: 'never' },
    { windSpeed: 'fast', windGust: NaN, time: 99, vis: -5, ceilingFt: 'low', seaState: 1e9, dist: -1, weight: 'enormous', obstacles: 'yes', surprise: 1 },
    { windDir: 120 }, JSON.parse('{"__proto__":{"x":1},"aircraft":"hornet","site":"gravelbar"}')];
  for (const raw of junk) {
    let o = null, err = null;
    try { o = clean(raw); } catch (e) { err = e; }
    const label = JSON.stringify(raw) === undefined ? 'undefined' : JSON.stringify(raw).slice(0, 60);
    check(!err && o && AIRCRAFT[o.aircraft] && SITES[o.site] && siteUsable(SITES[o.site], AIRCRAFT[o.aircraft], { sites: SITES, missions: SCENARIOS }).ok, `${label} -> ${o ? `${o.aircraft} at ${o.site}` : err}`);
    let sc = null; err = null;
    try { sc = buildFreeFlight(raw, { sites: SITES, seed: 3, defaults: DEFAULTS, missions: SCENARIOS }); } catch (e) { err = e; }
    check(!err && sc && sc.id === 'free' && Number.isFinite(sc.wind.dir) && Number.isFinite(sc.spawn.dist), `  and builds a flight (${err ? err.message : sc.aircraft + ', wind ' + Math.round(sc.wind.dir) + '°'})`);
  }
  const o = clean({ failures: ['gremlins', 'brakes', 'brakes'], when: 'never', weather: 'plague' });
  check(o.failures.length === 1 && o.failures[0] === 'brakes', 'an unknown failure is dropped, a repeated one kept once');
  check(o.when === 'approach' && o.weather === 'clear', 'an unknown moment and weather fall back to the defaults');
  const old = clean({ windDir: (landingHeading(SITES.bayfield) + 90) % 360 });
  check(old.windRel === 90, `an old save's absolute windDir becomes windRel (${old.windRel})`);
  const hornetGravel = clean({ aircraft: 'hornet', site: 'gravelbar' });
  check(hornetGravel.aircraft === 'hornet' && hornetGravel.site !== 'gravelbar', `the Sea Hornet saved at the Gravel Bar is moved to a place it can use (${hornetGravel.site})`);
}

console.log('\n== The scenario it builds ==');
{
  const sc = build({ aircraft: 'trailblazer', site: 'gravelbar', weather: 'snow', windRel: 90, windSpeed: 14, windGust: 14, microburst: true, time: 9, obstacles: false, failures: ['brakes'], when: 'short' });
  check(sc.id === 'free' && sc.aircraft === 'trailblazer' && sc.site === 'gravelbar', 'id free, the airplane and the place asked for');
  check(sc.scoring.type === 'bush', 'a bush strip is scored as one');
  check(sc.course === false, '"Obstacles off" is course: false');
  check(!('course' in build({ aircraft: 'trailblazer', site: 'gravelbar', obstacles: true })), '"Obstacles on" leaves course out (the site keeps its trees)');
  check(Math.round(sc.wind.dir) === Math.round((landingHeading(SITES.gravelbar) + 90) % 360), `wind from 90° right of the landing direction (dir ${sc.wind.dir})`);
  check(sc.wind.shear > 0 && sc.weather.events.length === 1 && sc.weather.events[0].type === 'microburst' && sc.weather.events[0].at.type === 'dist' && sc.weather.events[0].at.value === 2500, 'wind shear: a microburst event 2,500 m out');
  check(sc.weather.preset === 'snow' && sc.weather.snow > 0, 'the weather preset reaches the weather spec');
  check(sc.spawn.dist === 900 && sc.spawn.alt === 100, `the Gravel Bar starts where resolveScenario puts it: 900 m out, 100 m up (${sc.spawn.dist} m, ${sc.spawn.alt} m)`);
  check(build({ site: 'carrier', aircraft: 'hornet' }).scoring.type === 'carrier', 'the carrier is scored as the carrier');
  check(build({ site: 'bayfield' }).scoring.type === 'runway', 'an airport is scored as a runway');
  check(build({ site: 'carrier', aircraft: 'hornet', seaState: 0.9 }).weather.seaState === 0.9, 'the sea state reaches the carrier');
  check(build({ site: 'bayfield' }).weather.seaState === undefined, 'and only the carrier');
}

console.log('\n== The same options and seed give the same flight ==');
{
  const opts = { aircraft: 'condor', site: 'harbor', weather: 'storm', surprise: true, when: 'any' };
  const a = JSON.stringify(build(opts, 307)), b = JSON.stringify(build(opts, 307));
  check(a === b, 'two builds with seed 307 are identical');
  const picks = new Set();
  for (let seed = 1; seed <= 40; seed++) { const sc = build(opts, seed); picks.add(sc.failures.map((f) => f.name).join()); check(sc.failures.length === 1 && sc.failures[0].silent === true && sc.surprise === true, `seed ${seed}: one silent failure (${sc.failures[0] && sc.failures[0].name})`); }
  check(picks.size > 1, `"Surprise me" deals different failures across seeds (${[...picks].join(', ')})`);
  const noRandom = Math.random;
  Math.random = () => { throw new Error('Math.random called'); };
  let err = null;
  try { build({ ...opts, surprise: false, failures: ['engineLeft'] }, 5); build(opts, 9); } catch (e) { err = e; }
  Math.random = noRandom;
  check(!err, 'the builder never calls Math.random()');
}

console.log('\n== A failure fires below where the flight starts ==');
{
  const starts = { gravelbar: 100 / FT, oneway: 100 / FT };
  for (const site of ['gravelbar', 'oneway']) {
    const ap = altOf(build({ aircraft: 'trailblazer', site, failures: ['flapsStuck'], when: 'approach' }));
    const sh = altOf(build({ aircraft: 'trailblazer', site, failures: ['flapsStuck'], when: 'short' }));
    check(ap != null && ap < starts[site] * 0.86 && ap > sh, `${site}: "on approach" at ${ap} ft, below the ${Math.round(starts[site])} ft start and above "short final" (${sh} ft)`);
  }
  for (const [ac, site] of [['skylark', 'bayfield'], ['condor', 'harbor'], ['hornet', 'carrier'], ['skylark', 'ridgefield']]) {
    for (const dist of [2000, 5000, 12000]) {
      const ap = altOf(build({ aircraft: ac, site, dist, failures: ['flapsStuck'], when: 'approach' }));
      const sh = altOf(build({ aircraft: ac, site, dist, failures: ['flapsStuck'], when: 'short' }));
      check(ap != null && sh != null && ap > sh && sh >= 60, `${ac} at ${site}, ${dist / 1000} km out: approach ${ap} ft > short final ${sh} ft`);
    }
  }
  const t = build({ failures: ['brakes'], when: 'start' }).failures[0].at;
  check(t.type === 'time' && t.value > 0, '"At start" is a time trigger a few seconds in');
}

console.log('\n== The places each airplane is offered ==');
{
  const offered = (ac) => Object.keys(SITES).filter((id) => siteUsable(SITES[id], AIRCRAFT[ac], { sites: SITES, missions: SCENARIOS }).ok);
  const h = offered('hornet');
  check(h.includes('carrier') && !h.includes('gravelbar') && !h.includes('oneway'), `Sea Hornet: ${h.join(', ')} (no gravel bar, no mountain strip)`);
  check(!offered('trailblazer').includes('carrier') && offered('trailblazer').includes('gravelbar'), `Trailblazer: ${offered('trailblazer').join(', ')} (no carrier: no hook)`);
  const c = siteUsable(SITES.ridgefield, AIRCRAFT.condor, { sites: SITES, missions: SCENARIOS });
  check(c.ok && !!c.tight, `the Condor at Ridgefield (a mission flies it) is offered, marked tight: "${c.tight}"`);
  check(!siteUsable(SITES.ridgefield, AIRCRAFT.condor).ok, 'without the missions it is refused on length alone');
  const keep = clean({ aircraft: 'condor', site: 'ridgefield' });
  check(keep.site === 'ridgefield', 'a saved Condor-at-Ridgefield setup is kept');
  for (const id of Object.keys(AIRCRAFT)) {
    const sc = build({ aircraft: id, site: 'gravelbar' });
    check(siteUsable(SITES[sc.site], AIRCRAFT[id], { sites: SITES, missions: SCENARIOS }).ok, `${id}: asked for the Gravel Bar, flies at ${sc.site}`);
  }
}

console.log('\n== A failure is offered only where it applies ==');
{
  const cat = { ...FAILURES, onlyJets: { name: 'Jet thing', applies: (d) => d.id === 'condor' }, broken: { name: 'Throws', applies: () => { throw new Error('x'); } } };
  const o = validateFreeOpts({ aircraft: 'skylark', site: 'bayfield', failures: ['onlyJets', 'broken', 'brakes'] }, { defaults: DEFAULTS, sites: SITES, failures: cat });
  check(o.failures.join() === 'brakes', `a failure whose applies() is false or throws is dropped (${o.failures.join()})`);
  const j = validateFreeOpts({ aircraft: 'condor', site: 'harbor', failures: ['onlyJets'] }, { defaults: DEFAULTS, sites: SITES, failures: cat });
  check(j.failures.join() === 'onlyJets', 'and kept where it applies');
}

console.log('\n== Roulette is filed under the airplanes it can draw ==');
{
  const roulette = SCENARIOS.find((s) => s.id === 'roulette');
  const drawn = new Set();
  for (let seed = 1; seed <= 200; seed++) drawn.add(resolveScenario(roulette, makeRng(seed * 7 + 1)).aircraft);
  check([...drawn].sort().join() === [...RANDOM_AIRCRAFT].sort().join(), `resolveScenario draws ${[...drawn].sort().join(', ')}; RANDOM_AIRCRAFT is ${[...RANDOM_AIRCRAFT].sort().join(', ')}`);
  check(!missionFlies(roulette, 'hornet') && missionFlies(roulette, 'condor'), 'the Sea Hornet has no Roulette; the Condor does');
}

console.log(failures ? `\n${failures} FAILED` : '\nall free-flight checks passed');
process.exit(failures ? 1 : 0);
