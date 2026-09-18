// The mission registry: what src/systems/scenarios.js appends to SITES and SCENARIOS, and the menu groups.
// Append-only. Each area keeps its missions in its own file so parallel work does not collide.
import { NEW_SITES } from './sites.js';
import { WEATHER_MISSIONS, WEATHER_SITES } from './weather.js';
import { FAILURES_MISSIONS, FAILURES_SITES } from './failures.js';
import { OBSTACLES_MISSIONS, OBSTACLES_SITES } from './obstacles.js';
import { CITY_MISSIONS, CITY_SITES } from './city.js';
import { MAPS_MISSIONS, MAPS_SITES } from './maps.js';

// sites.js holds the new maps; an area file may add sites of its own (a site id is permanent too).
export const ALL_NEW_SITES = { ...NEW_SITES, ...WEATHER_SITES, ...FAILURES_SITES, ...OBSTACLES_SITES, ...CITY_SITES, ...MAPS_SITES };
export const NEW_MISSIONS = [...WEATHER_MISSIONS, ...FAILURES_MISSIONS, ...OBSTACLES_MISSIONS, ...CITY_MISSIONS, ...MAPS_MISSIONS];

// Menu groups, in menu order. The first seven are the original rail (src/ui/menus.js GROUPS); a mission with
// `group` set joins that group; the original twenty are listed by id here so their files stay untouched.
export const MISSION_GROUPS = [
  { id: 'basics', title: 'Basics', ids: ['solo', 'xwind15', 'gusty'] },
  { id: 'heavy', title: 'Heavy iron', ids: ['heavy', 'short', 'noflaps', 'fog'] },
  { id: 'broke', title: 'Something broke', ids: ['deadstick', 'nosegear', 'oneengine', 'jammed', 'brakes', 'ice'] },
  { id: 'stall', title: 'The stall', ids: ['slow', 'stallrec'] },
  { id: 'boat', title: 'Boat', ids: ['cq', 'night'] },
  { id: 'bush', title: 'Bush', ids: ['gravel', 'oneway'] },
  { id: 'storms', title: 'Storms', ids: [] },
  { id: 'breaks', title: 'Things break', ids: [] },
  { id: 'obstacles', title: 'In the way', ids: [] },
  { id: 'city', title: 'The city', ids: [] },
  { id: 'maps', title: 'Far places', ids: [] },
  { id: 'chaos', title: 'Chaos', ids: ['roulette'] },
];

// Every mission id in menu order (groups first, then anything with an unknown group at the end).
export function missionOrder(all) {
  const byId = new Map(all.map((s) => [s.id, s]));
  const out = [], seen = new Set();
  for (const g of MISSION_GROUPS) {
    for (const id of g.ids) if (byId.has(id) && !seen.has(id)) { out.push(byId.get(id)); seen.add(id); }
    for (const s of all) if (s.group === g.id && !seen.has(s.id)) { out.push(s); seen.add(s.id); }
  }
  for (const s of all) if (!seen.has(s.id)) out.push(s);
  return out;
}
