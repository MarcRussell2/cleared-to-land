// Display-only data for the menu: what each airplane looks like from above, a one-line blurb, a workload rating
// and two type facts. The numbers (Vref, weight, span, stall speeds, runway needed) are read from
// src/aircraft/defs.js at render time and never copied here: that file belongs to the flight model and is not
// edited for the menu. Nothing in this file is read by the simulation (free flight's builder, src/missions/free.js,
// reads the runway need ashore below to decide which places it offers).
import { RAD } from '../config.js';

// Plan-view silhouettes, nose up, in a 120x120 box. Wing first, fuselage over it, so the fuselage outline reads
// across the wing like a three-view drawing. `.s` paths are strokes only (panel lines, the prop disc).
const SIL = {
  skylark: `
    <path d="M10 40 H110 Q113 40 113 43 V50 Q113 53 110 53 H10 Q7 53 7 50 V43 Q7 40 10 40Z"/>
    <path d="M41 95 H79 L77 103 H43 Z"/>
    <path d="M60 13 C64 13 66 19 66 27 L66 50 C66 60 63 82 61.6 105 L58.4 105 C57 82 54 60 54 50 L54 27 C54 19 56 13 60 13Z"/>
    <path class="s" d="M50 11.5 H70"/>
    <path class="s" d="M57 30 H63"/>`,
  trailblazer: `
    <ellipse cx="46" cy="33" rx="5" ry="7.5"/><ellipse cx="74" cy="33" rx="5" ry="7.5"/>
    <path d="M7 42 H113 Q118 42 118 47 V52 Q118 57 113 57 H7 Q2 57 2 52 V47 Q2 42 7 42Z"/>
    <path class="s" d="M8 53 H38 M82 53 H112"/>
    <path d="M43 91 H77 Q80 91 79 95 L77 100 H43 L41 95 Q40 91 43 91Z"/>
    <path d="M60 18 C65 18 67 22 67 30 L67 52 C67 64 63 82 61.5 101 L58.5 101 C57 82 53 64 53 52 L53 30 C53 22 55 18 60 18Z"/>
    <path class="s" d="M49 16 H71"/>`,
  condor: `
    <path d="M33.5 47 Q36 45 38.5 47 V62 H33.5Z"/><path d="M81.5 47 Q84 45 86.5 47 V62 H81.5Z"/>
    <path d="M55.5 46 L7 74 L9 79.5 L55.5 68 Z"/><path d="M64.5 46 L113 74 L111 79.5 L64.5 68 Z"/>
    <path d="M58 97 L41 107 L42 111 L58 106 Z"/><path d="M62 97 L79 107 L78 111 L62 106 Z"/>
    <path d="M60 6 C63.6 6 65 10 65 16 L65 96 C65 104 62.6 110 60 114 C57.4 110 55 104 55 96 L55 16 C55 10 56.4 6 60 6Z"/>
    <path class="s" d="M57.5 12 H62.5"/>`,
  hornet: `
    <path d="M49 61 L11 77 L11 84 L49 87 Z"/><path d="M71 61 L109 77 L109 84 L71 87 Z"/>
    <path d="M51 95 L30 105 L30 111 L51 108 Z"/><path d="M69 95 L90 105 L90 111 L69 108 Z"/>
    <path d="M60 4 C62 12 63.4 19 64 25 C66.5 36 70.5 48 71 60 L70.5 104 L66 110 H54 L49.5 104 L49 60 C49.5 48 53.5 36 56 25 C56.6 19 58 12 60 4 Z"/>
    <path d="M54 78 L48.5 99 L51 100 L56 80Z"/><path d="M66 78 L71.5 99 L69 100 L64 80Z"/>
    <ellipse class="s" cx="60" cy="24" rx="2.6" ry="7"/>`,
  // an airplane this file does not know yet (a later aircraft): a plain high-wing outline
  generic: `
    <path d="M12 44 H108 V54 H12Z"/>
    <path d="M44 94 H76 V101 H44Z"/>
    <path d="M60 14 C64 14 65 20 65 28 L65 52 C65 64 62 84 61 104 L59 104 C58 84 55 64 55 52 L55 28 C55 20 56 14 60 14Z"/>`,
};

export function sil(id, cls = '') {
  return `<svg class="sil ${cls}" viewBox="0 0 120 120" aria-hidden="true" focusable="false">${SIL[id] || SIL.generic}</svg>`;
}

const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
export const massText = (kg) => (kg >= 10000 ? `${Math.round(kg / 1000)} t` : `${fmtInt(kg)} kg`);

// Per airplane: the blurb on its card (the long description stays in defs.js and is shown in the briefing), a
// workload rating out of five, and two facts. Facts are functions of the definition so the numbers stay the
// flight model's own.
const CATALOG = {
  skylark: {
    blurb: 'Four-seat trainer. Forgiving, slow, and honest.',
    work: 1,
    facts: (d) => [['Stall', `${d.speeds.Vs1} / ${d.speeds.Vs0} kt`], ['Gear', 'Fixed tricycle']],
  },
  trailblazer: {
    blurb: 'Big flaps, huge drag, goes where there is no runway.',
    work: 3,
    facts: (d) => [['Stops in', `${fmtInt(d.approach.runwayNeed)} m`], ['Gear', 'Taildragger']],
  },
  condor: {
    blurb: 'Sixty tonnes that do not want to slow down.',
    work: 4,
    facts: () => [['Spool', '4 s'], ['Stops with', 'Spoilers, reverse']],
  },
  hornet: {
    blurb: 'Fly the ball, catch the three-wire.',
    work: 5,
    facts: (d) => [['On speed', `${(d.approach.onSpeedAoA * RAD).toFixed(1)}° AoA`], ['Flare', d.approach.flareHeight ? `${d.approach.flareHeight} m` : 'None']],
  },
};

// Everything a card or a tile shows about one airplane.
export function aircraftInfo(def) {
  const c = CATALOG[def.id] || { blurb: String(def.description || '').split('. ')[0] + '.', work: 3, facts: () => [] };
  return {
    id: def.id,
    name: def.name,
    short: def.short || def.name,
    category: String(def.category || '').replace(/\s*\(.*\)\s*$/, ''),
    blurb: c.blurb,
    description: def.description || '',
    work: c.work,
    facts: c.facts(def),
    vref: def.speeds.Vref,
    mass: def.mass,
    massText: massText(def.mass),
    span: def.span,
    runwayNeed: def.approach ? def.approach.runwayNeed : 0,
    hook: !!def.hook,
  };
}

// The airplanes a mission with aircraft 'random' (Roulette) can draw. It mirrors the pick in resolveScenario()
// (src/systems/scenarios.js), which never draws the Sea Hornet: the menu files Roulette under these three only.
export const RANDOM_AIRCRAFT = ['skylark', 'condor', 'trailblazer'];
// Does this mission fly this airplane (a random-aircraft mission counts for each airplane it can draw)?
export const missionFlies = (sc, acId) => !!sc && (sc.aircraft === acId || (sc.aircraft === 'random' && RANDOM_AIRCRAFT.includes(acId)));

// The runway an airplane needs ashore, for free flight's place list. defs.js gives the Sea Hornet its arrested
// stopping distance (200 m on the wires); on a runway, without a wire, a fighter needs about 1,500 m.
const RUNWAY_NEED_ASHORE = { hornet: 1500 };
export function runwayNeedAshore(def) {
  if (!def) return 0;
  if (RUNWAY_NEED_ASHORE[def.id] != null) return RUNWAY_NEED_ASHORE[def.id];
  return (def.approach && def.approach.runwayNeed) || 0;
}

// How hard each of the original twenty is, 1..5 (a new mission carries `difficulty` itself; scenarios.js, where
// the twenty live, is left untouched). Its keys double as the list of the original twenty: anything else is new.
export const CLASSIC_DIFFICULTY = {
  solo: 1, xwind15: 2, gusty: 3, heavy: 2, short: 3, noflaps: 3, fog: 4, deadstick: 3, nosegear: 3, oneengine: 3,
  jammed: 4, ice: 4, brakes: 3, slow: 2, stallrec: 3, cq: 4, night: 5, gravel: 3, oneway: 4, roulette: 4,
};
export const isClassicMission = (id) => Object.prototype.hasOwnProperty.call(CLASSIC_DIFFICULTY, id);

// The six places the game shipped with; any other site id is a new map and gets a NEW tag in the builder.
export const CLASSIC_SITES = ['bayfield', 'harbor', 'ridgefield', 'carrier', 'gravelbar', 'oneway'];

export function difficultyOf(sc) {
  const d = Number(sc && (sc.difficulty ?? CLASSIC_DIFFICULTY[sc.id]));
  return Number.isFinite(d) ? Math.max(1, Math.min(5, Math.round(d))) : 3;
}

// A place in a few words for a tile: the terrain, then the runway (or the deck).
const STYLE_WORD = { plains: 'Plains', coast: 'Coast', sea: 'At sea', mountain: 'Mountains', desert: 'Desert', island: 'Island', arctic: 'Arctic', city: 'City' };
export function siteLine(site) {
  if (!site) return '';
  if (site.kind === 'carrier' || (!site.runways && site.carrier)) return 'Carrier · 4 wires';
  const rw = site.runways && site.runways[0];
  const surf = rw && rw.surface ? rw.surface : 'dirt';
  const where = site.kind === 'bush' ? `${surf[0].toUpperCase()}${surf.slice(1)} strip` : STYLE_WORD[site.terrain && site.terrain.style] || 'Airport';
  return rw ? `${where} · ${fmtInt(rw.length)} m` : where;
}
