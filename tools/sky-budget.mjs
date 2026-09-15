// The sky's radiance budget, checked in plain Node.
//
// The composer renders the world into a linear HDR target without tone mapping, the
// bloom pass thresholds that radiance at 0.92, and only then does the output pass
// apply ACES. So anything the sky bakes above ~0.9 blooms - and because the sky is
// half of most frames, a sky over the threshold veils the whole picture in grey
// (the "tower" scene of the first sky pass). This bakes the atmosphere's lookup
// tables for the look sheet's conditions and prints the peak, the horizon and the
// zenith radiance of each, so the budget can be checked before a screenshot.
//
//   node tools/sky-budget.mjs           (exit 1 if any daytime sky peaks above 0.9)
import * as THREE from 'three';
import { atmosphereUniforms, VISIBILITY_EXTINCTION } from '../src/art/world-atmosphere.js';

const DEG = Math.PI / 180;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const SCENES = [['plains 10:00', 10, 40000], ['menu 08:30', 8.5, 30000], ['coast 13:00', 13, 40000], ['tower 16:30', 16.5, 25000],
  ['ridge 17:00', 17, 30000], ['dusk 19:00', 19, 30000], ['fog 07:00', 7, 700], ['night 22:30', 22.5, 15000]];
const LIMIT = 0.9;
let bad = 0;
for (const [label, time, vis] of SCENES) {
  const u = atmosphereUniforms();
  const e = Math.sin((time - 6.5) / 13 * Math.PI) * 62 * DEG;
  const az = 80 * DEG;
  u.atSun.value.set(Math.sin(az) * Math.cos(e), Math.sin(e), -Math.cos(az) * Math.cos(e));
  u.atDay.value = smooth(-6 * DEG, 6 * DEG, e);
  u.atLow.value = 1 - smooth(5 * DEG, 35 * DEG, e);
  u.atWeather.value = 1 - smooth(900, 7000, vis);
  u.atExtinction.value = VISIBILITY_EXTINCTION / vis;
  if (u.atLut?.value?.userData?.bake) u.atLut.value.userData.bake();
  const tables = [u.atLut, u.atLutNight].filter((t) => t && t.value && t.value.image).map((t) => t.value.image);
  if (!tables.length) { console.log(`${label.padEnd(14)} no lookup table (atLut) - nothing to check`); continue; }
  const w = tables[0].width, h = tables[0].height;
  const at = (x, y) => [0, 1, 2].map((k) => tables.reduce((s, img) => s + (img.data instanceof Uint16Array ? THREE.DataUtils.fromHalfFloat(img.data[(y * w + x) * 4 + k]) : img.data[(y * w + x) * 4 + k] / 255), 0));
  let max = 0, where = '';
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const m = Math.max(...at(x, y)); if (m > max) { max = m; where = `x${x} y${y}`; } }
  const fmt = (c) => c.map((v) => v.toFixed(2)).join(',');
  const over = u.atDay.value > 0.5 && max > LIMIT;
  if (over) bad++;
  console.log(`${label.padEnd(14)} sun ${(e / DEG).toFixed(1).padStart(5)} deg  peak ${max.toFixed(2)} at ${where.padEnd(9)} horizon ${fmt(at(w >> 1, Math.round(h * 0.2)))}  zenith ${fmt(at(w >> 1, h - 1))}${over ? '   OVER the bloom threshold' : ''}`);
}
// Aerial perspective: what the eye gets after ACES and 8-bit output is far less than
// the physical contrast, so the clear-air extinction the shaders use (atExtinction,
// read by installFog, the clouds and the water) must be gentler than Koschmieder's
// 3.912/V. The tower scene (25 km, a 3.5-degree lens on ground 4-8 km away) is the
// test: ground at 4 km keeps at least 65% of its contrast, 8 km at least 40%. The
// value is taken the way SkySystem.set() computes it: through clearExtinction() if
// world-atmosphere.js exports one, else the raw uniform default scaled to 25 km.
{
  const atmo = await import('../src/art/world-atmosphere.js');
  const V = 25000;
  const k = typeof atmo.clearExtinction === 'function' ? atmo.clearExtinction(V) : VISIBILITY_EXTINCTION / V;
  const c = (d) => Math.exp(-k * d);
  const line = [1500, 4000, 8000, 15000].map((d) => `${d / 1000} km ${(100 * c(d)).toFixed(0)}%`).join('  ');
  const ok = c(4000) >= 0.65 && c(8000) >= 0.40;
  if (ok === false) bad++;
  console.log(`\naerial perspective at 25 km visibility (extinction ${k.toExponential(2)}/m): contrast kept at ${line}${ok ? '' : '   TOO STRONG (need >= 65% at 4 km, >= 40% at 8 km)'}`);
}
console.log(bad ? `\n${bad} check(s) failed` : `\nall daytime skies under ${LIMIT}, aerial perspective within limits`);
process.exit(bad ? 1 : 0);
