// Weather: storms, squalls, microbursts, gust fronts, snow and dust, driven by the scenario's `weather` spec
// (src/missions/README.md). This is the MODEL: what the air does and what the pilot is told. How it looks is
// src/art/weather-look.js, which reads `state` and nothing else; how it sounds is src/audio-weather.js, which
// reads the same `state`.
//
// The flight-physics wind (src/physics/wind.js) is not edited. Weather works on it from outside in two ways:
//   - update() may ramp the Wind object's public fields (speedKt, gustKt, dirDeg, turb, shear) for slow changes
//     such as a gust front; the HUD wind box, the windsock and the cockpit follow automatically;
//   - addWind() adds a local overlay in m/s (a microburst's downdraft and outflow) on top of Wind.at(). main.js
//     calls it for the aircraft (every physics sub-step) and for every live particle, so it is O(1) with an
//     early exit when nothing is active.
// A spec with no events never writes a Wind field and never adds anything: the wind is Wind.at() exactly
// (tools/test-weather.mjs checks this).
// Randomness comes from the flight seed only (makeRng(seed * k + c), constants of this file's own); never
// Math.random(), never a draw from the rng resolveScenario uses.
//
// ---- The spec (scenario.weather) ----
//   preset       'clear' | 'overcast' | 'rain' | 'storm' | 'snow' | 'dust' | 'fog': defaults for everything below
//   rain, snow, dust   0..1 precipitation (look + sound; rain > 0.3 wets an asphalt runway: mu 0.85 -> 0.5)
//   darkness     0..1 overcast dimming (the look dims the sun, the sky light and the exposure)
//   ceiling      cloud base in metres above the field (null = none); above it the view goes white
//   lightning    0..1, about 6 strikes a minute at 1; cloud-to-ground strikes draw a bolt, all of them flash
//   cells        number of storm cells around the field (rain shafts, where the lightning comes from)
//   wet          true/false overrides the rain rule for the runway
//   seaState     the carrier's sea (the ship's heave, pitch and roll, and the look of the sea); above 1 a longer,
//                heavier swell joins in (src/world/carrier.js), and the deck motion's phases come from the seed
//   events       [{ type, at, ... }]; `at` uses the failure trigger types (src/systems/malfunctions.js
//                shouldTrigger: start, time s, alt ft radio, dist m to the threshold or ramp; plus window
//                {from,to} s seeded, speed kt IAS below, touchdown):
//     microburst  { strength = 1, outflow = 24 kt (peak outflow each way, 30-100 m up), radius = 650 m,
//                   depth = 300 m, u, v (runway frame; default: `ahead` = 1500 m in front of the aircraft on the
//                   approach path), grow = 8 s, life = 100 s, decay = 30 s }
//                 The Oseguera-Bowles analytic downburst: a Gaussian core with a downdraft that is zero at the
//                 ground and grows with height, and a radial outflow that satisfies continuity with it and
//                 peaks 30-100 m above the ground. Flown through: a headwind gain, then sink, then a tailwind.
//                 It rains itself out after `life`, so going around and coming back is a real choice.
//     gustFront   { shift deg, speed kt, gust kt (default speed + 10), ramp = 4 s, turb (added, default 0.15) }
//     windShift   { shift deg, speed kt (default unchanged), gust, ramp = 15 s }
//     turbBurst   { turb = 0.5 (added at the peak), dur = 8 s }: rougher air for a while, and camera jolts
//     squall      { rain = 0.95, darkness (added, default 0.15), shift, speed, gust, ramp = 4 s, seaState }
//     visDrop     { vis m, ramp = 6 s }
//
// ---- state (one object, refilled every update; nothing else is exported per frame) ----
//   rain, snow, dust, darkness   0..1 now
//   ceiling, ceilingY, cloudTop  metres above the field, and world heights of the cloud base and top (or null)
//   vis                          visibility now in metres (the scenario's, or a visDrop's)
//   flash                        0..1 lightning brightness now; bolt = { on, x, z, y0, y1, variant, dist, cg }
//   strike, strikeDist, strikePower, strikeCG   a counter that steps at each strike (the sound's thunder cue)
//   windshear                    true while the aircraft is in a performance-decreasing shear
//   wind                         the wind at the aircraft now, m/s (the rain's slant)
//   shafts[4], nShafts           rain shafts under the storm cells and the microburst: { x, z, r, a }
//   gust                         0..1 how rough the air is (the sound's gust layer)
//   seaState, fieldY, kind       ('rain' | 'snow' | 'dust' | null: which precipitation the look builds)
import { Vector3 } from 'three';
import { KT, FT, DEG, clamp, smoothstep, makeRng } from '../config.js';
import { shouldTrigger } from './malfunctions.js';

export const WEATHER_PRESETS = {
  clear:    { rain: 0, snow: 0, dust: 0, darkness: 0, ceiling: null, lightning: 0, cells: 0 },
  overcast: { rain: 0, snow: 0, dust: 0, darkness: 0.3, ceiling: 900, lightning: 0, cells: 0 },
  rain:     { rain: 0.55, snow: 0, dust: 0, darkness: 0.35, ceiling: 500, lightning: 0, cells: 0 },
  storm:    { rain: 0.8, snow: 0, dust: 0, darkness: 0.55, ceiling: 300, lightning: 0.5, cells: 3 },
  snow:     { rain: 0, snow: 0.6, dust: 0, darkness: 0.3, ceiling: 450, lightning: 0, cells: 0 },
  dust:     { rain: 0, snow: 0, dust: 0.7, darkness: 0.15, ceiling: null, lightning: 0, cells: 0 },
  fog:      { rain: 0, snow: 0, dust: 0, darkness: 0.1, ceiling: 60, lightning: 0, cells: 0 },
};

// The preset's defaults under the spec's own values (a key the spec leaves out keeps the preset's).
export function resolveWeatherSpec(spec) {
  const s = spec || {};
  const out = { ...(WEATHER_PRESETS[s.preset] || WEATHER_PRESETS.clear) };
  for (const k of Object.keys(s)) if (s[k] !== undefined) out[k] = s[k];
  out.events = (s.events || []).map((e) => ({ ...e }));
  return out;
}

// The Oseguera-Bowles downburst, pure. p = { R, lam, zs, eps }; dx, dz from the core, h above the ground.
// Adds the wind (m/s) to out. Radial outflow u = lam R^2 / (2 r) (1 - e^(-r^2/R^2)) (e^(-h/zs) - e^(-h/eps));
// downdraft w = -lam e^(-r^2/R^2) (zs (1 - e^(-h/zs)) - eps (1 - e^(-h/eps))). Continuity holds exactly inside
// 2.4 R, both are zero at the ground, and nothing reaches past 3.5 R.
export function downburst(p, dx, dz, h, amp, out) {
  if (h <= 0 || amp <= 0) return out;
  const r2 = dx * dx + dz * dz, R2 = p.R * p.R;
  const e = Math.exp(-r2 / R2);
  const ez = Math.exp(-h / p.zs), ee = Math.exp(-h / p.eps);
  if (r2 > 1e-6) {
    const r = Math.sqrt(r2);
    // the model's outflow falls off only as 1/r; past 2.4 R it is faded to nothing by 3.5 R (a smooth edge where
    // the real outflow would roll up into the gust front), so the burst has a finite footprint and no step
    const x = (r / p.R - 2.4) / 1.1, taper = x <= 0 ? 1 : x >= 1 ? 0 : 1 - x * x * (3 - 2 * x);
    const ur = amp * taper * p.lam * R2 * 0.5 * (1 - e) / r * (ez - ee);
    out.x += ur * dx / r; out.z += ur * dz / r;
  }
  out.y -= amp * p.lam * e * (p.zs * (1 - ez) - p.eps * (1 - ee));
  return out;
}
// lam for a wanted peak outflow (m/s): the radial factor peaks at x = r/R = 1.1209 ((1 - e^-x^2)/x = 0.6382),
// the height factor at h = ln(zs/eps) / (1/eps - 1/zs).
export function downburstParams({ outflow = 12, radius = 650, depth = 300, eps = 30 } = {}) {
  const hPeak = Math.log(depth / eps) / (1 / eps - 1 / depth);
  const fPeak = Math.exp(-hPeak / depth) - Math.exp(-hPeak / eps);
  const lam = (2 * outflow) / (radius * 0.63817 * fPeak);
  return { R: radius, lam, zs: depth, eps, hPeak, rCut2: (radius * 3.5) ** 2 };
}

const T0 = new Vector3();
const envOf = (b, t) => { const x = (t - b.t0) / b.dur; return x >= 1 || x < 0 ? 0 : b.add * smoothstep(0, 0.12, x) * (1 - smoothstep(0.7, 1, x)); };

export class Weather {
  constructor(spec, { seed = 1, wind = null, world = null, scenario = null, hud = null, audio = null, rig = null } = {}) {
    this.spec = resolveWeatherSpec(spec);
    this.seed = seed;
    this.t = 0;
    this.wind = wind;
    this.world = world;
    this.scenario = scenario;
    this.hud = hud; this.audio = audio; this.rig = rig;
    const s = this.spec, w = world || {};
    this.carrier = w.carrier || null;
    this.runway = w.runway || null;
    this.fieldY = this.runway ? this.runway.elevation : 0;
    // One frame of reference for everything placed around the field: the threshold (or the carrier's touchdown
    // point where the flight starts) and the approach direction. The storm is in the world frame; the ship
    // steams through it.
    const c = this.carrier;
    this.origin = this.runway ? this.runway.threshold.clone() : c ? c.tdWorld.clone() : new Vector3();
    this.dir = this.runway ? this.runway.dir.clone() : c ? c.landDirWorld.clone() : new Vector3(0, 0, -1);
    this.right = this.runway ? this.runway.right.clone() : c ? c.landRightWorld.clone() : new Vector3(1, 0, 0);
    this.baseVis = scenario && scenario.vis ? scenario.vis : 30000;
    this.kind = s.snow > 0 && s.snow >= s.rain ? 'snow' : s.dust > 0 && s.dust > s.rain ? 'dust' : s.rain > 0 ? 'rain' : null;
    // the Wind as the scenario set it; ramps start from wherever it is when they fire
    this.turbBase = wind ? wind.turb : 0;
    this.ramp = null;          // { from: {dir, speed, gust, turb}, to: {...}, t0, dur, said }
    this.turbAdd = [];         // active turbulence bursts { t0, dur, add }
    this.rainAdd = 0; this.rainTo = 0; this.darkAdd = 0; this.darkTo = 0;
    this.visFrom = this.baseVis; this.visTo = this.baseVis; this.visT0 = 0; this.visDur = 0;
    this.burst = null;         // the active microburst { R, lam, zs, eps, rCut2, x, z, t0, grow, life, decay }
    this.events = s.events.map((e) => ({ ...e, fired: false }));
    this.rngEvents = makeRng(seed * 3571 + 499);
    for (const e of this.events) if (e.at && e.at.type === 'window') e._when = e.at.from + this.rngEvents() * ((e.at.to ?? e.at.from) - e.at.from);
    // storm cells: where the rain shafts hang and the lightning comes from
    const rc = makeRng(seed * 7919 + 101);
    this.cells = [];
    const nCells = s.cells ?? (s.lightning > 0 ? 3 : 0);
    for (let i = 0; i < nCells; i++) {
      // the first is the storm "near the field", off to one side of the approach; the rest anywhere around
      const side = rc() < 0.5 ? -1 : 1;
      const ang = i === 0 ? side * (40 + rc() * 70) * DEG : rc() * Math.PI * 2;
      const dist = i === 0 ? 3500 + rc() * 2500 : 4500 + rc() * 8000;
      const along = -Math.cos(ang) * dist, across = Math.sin(ang) * dist;   // along < 0 = out on the approach
      this.cells.push({ x: this.origin.x + this.dir.x * along + this.right.x * across, z: this.origin.z + this.dir.z * along + this.right.z * across, r: 1200 + rc() * 1300, power: 0.6 + rc() * 0.4 });
    }
    // lightning: a strike schedule drawn from its own stream, in sim time
    this.rngLight = makeRng(seed * 6271 + 877);
    this.rngJolt = makeRng(seed * 2297 + 33);
    this.nextStrike = s.lightning > 0 ? 3 + this.rngLight() * 7 : Infinity;
    this.strikeT = -1e9; this.strikePulses = [0, 0, 0]; this.strikeGap = 0.1;
    this.nextJolt = 0; this.gLP = 1;
    // windshear detection (F-factor from the shear alone, not the gust noise)
    this.wxPrev = null; this.dWx = 0; this.fShear = 0; this.fHold = 0; this.shearSaid = -1e9; this.shearLastT = -1e9;
    this._mean = new Vector3();
    // the sea
    this.seaTarget = s.seaState != null ? s.seaState : c ? c.seaState : 0;
    if (c && s.seaState != null) {
      c.seaState = s.seaState;
      if (c.setMotionSeed) c.setMotionSeed(seed * 131 + 7);
      c.update(0);   // re-pose the deck at the new sea state without a heave-rate spike (dt = 0 gives heaveRate 0)
    }
    if (w.terrain && w.terrain.water && c) w.terrain.water.seaState = Math.min(1, c.seaState);
    // a wet runway: the grip the aerodrome already models (mu 0.5 on wet asphalt)
    if (this.runway && (s.wet === true || (s.wet !== false && s.rain > 0.3))) this.runway.wet = true;
    // under a storm deck the lights are on: runway and deck lights toward their night strength
    if (s.darkness > 0.25) this.lightsUp(w);

    this.state = {
      rain: s.rain, snow: s.snow, dust: s.dust, darkness: s.darkness,
      ceiling: s.ceiling, ceilingY: s.ceiling != null ? this.fieldY + s.ceiling : null, cloudTop: s.ceiling != null ? this.fieldY + s.ceiling + 1400 : null,
      flash: 0, vis: this.baseVis, windshear: false, wind: new Vector3(), kind: this.kind,
      bolt: { on: false, x: 0, z: 0, y0: this.fieldY, y1: this.fieldY + (s.ceiling ?? 600), variant: 0, dist: 0, cg: false },
      strike: 0, strikeDist: 0, strikePower: 0, strikeCG: false,
      shafts: [0, 1, 2, 3].map(() => ({ x: 0, z: 0, r: 0, a: 0 })), nShafts: 0,
      gust: 0, seaState: c ? c.seaState : 0, fieldY: this.fieldY, lightning: s.lightning || 0,
    };
    this.fillShafts(0);
  }

  lightsUp(w) {
    const k = clamp(this.spec.darkness * 1.4, 0, 1);
    const raise = (m) => { if (m && m.opacity < 1) m.opacity += (1 - m.opacity) * k; };
    if (w.airport && w.airport.lightSet) raise(w.airport.lightSet.mat);
    if (w.carrier && w.carrier.group) w.carrier.group.traverse((o) => { if (o.isPoints && o.material && o.material.name === 'lights/set') raise(o.material); });
  }

  // Metres to the threshold (or the carrier's ramp), as main.distToThreshold() measures it.
  distTo(ac) {
    if (this.runway) { const rw = this.runway; return -((ac.pos.x - rw.threshold.x) * rw.dir.x + (ac.pos.z - rw.threshold.z) * rw.dir.z); }
    if (this.carrier) { const dl = this.carrier.deckLocal(ac.pos, this._dl || (this._dl = { u: 0, v: 0, h: 0, onDeck: false })); return -dl.u; }
    return 1e9;
  }

  // The failure triggers, with the same meaning (start/time/alt/dist go through malfunctions.shouldTrigger itself).
  triggered(e, ac, t) {
    const at = e.at || { type: 'start' };
    switch (at.type) {
      case 'window': return t >= e._when;
      case 'speed': return !ac.onGround && ac.ias < at.value * KT && t > 1;
      case 'touchdown': return !!(ac.stats && ac.stats.touchdown);
      default: return shouldTrigger(e, ac, { t, distToThreshold: this.distTo(ac) });
    }
  }

  update(dt, t, ac) {
    const s = this.spec, st = this.state, W = this.wind;
    this.t = t;
    if (ac) for (const e of this.events) if (!e.fired && this.triggered(e, ac, t)) { e.fired = true; e.firedAt = t; this.fire(e, t, ac); }
    // the Wind's public fields: a ramp (gust front, shift, squall) and the turbulence bursts on top
    if (W && (this.ramp || this.turbAdd.length)) {
      if (this.ramp) {
        const r = this.ramp, k = smoothstep(0, 1, (t - r.t0) / r.dur);
        W.dirDeg = r.from.dir + (r.to.dir - r.from.dir) * k;
        W.speedKt = r.from.speed + (r.to.speed - r.from.speed) * k;
        W.gustKt = Math.max(W.speedKt, r.from.gust + (r.to.gust - r.from.gust) * k);
        this.turbBase = r.from.turb + (r.to.turb - r.from.turb) * k;
        if (!r.said && k > 0.5) { r.said = true; if (r.announce) this.announceWind(r.to); }
        if (k >= 1) this.ramp = null;
      }
      let add = 0;
      for (let i = this.turbAdd.length - 1; i >= 0; i--) {
        const b = this.turbAdd[i];
        if (t - b.t0 >= b.dur) { this.turbAdd.splice(i, 1); continue; }
        add += envOf(b, t);
      }
      W.turb = this.turbBase + add;
    }
    // precipitation, darkness and visibility
    this.rainAdd += clamp(this.rainTo - this.rainAdd, -dt * 0.25, dt * 0.25);
    this.darkAdd += clamp(this.darkTo - this.darkAdd, -dt * 0.05, dt * 0.05);
    let near = 0;
    if (ac) {
      for (const c of this.cells) { const dx = ac.pos.x - c.x, dz = ac.pos.z - c.z; near = Math.max(near, c.power * Math.exp(-(dx * dx + dz * dz) / (c.r * c.r))); }
      if (this.burst) { const b = this.burst, dx = ac.pos.x - b.x, dz = ac.pos.z - b.z; near = Math.max(near, this.burstAmp(t) * Math.exp(-(dx * dx + dz * dz) / (b.R * b.R * 1.6))); }
    }
    const base = Math.max(s.rain || 0, this.rainAdd);
    st.rain = base > 0 ? clamp(base + 0.3 * near, 0, 1) : 0;
    st.snow = s.snow || 0; st.dust = s.dust || 0;
    st.darkness = clamp((s.darkness || 0) + this.darkAdd, 0, 1);
    if (this.visDur > 0) st.vis = this.visFrom + (this.visTo - this.visFrom) * smoothstep(0, 1, (t - this.visT0) / this.visDur);
    if (this.runway && !this.runway.wet && s.wet !== false && st.rain > 0.3) this.runway.wet = true;
    // the sea: ramped, never stepped (the deck's heave rate is a finite difference the physics reads)
    const c = this.carrier;
    if (c) {
      if (c.seaState !== this.seaTarget) c.seaState += clamp(this.seaTarget - c.seaState, -dt * 0.02, dt * 0.02);
      st.seaState = c.seaState;
      const water = this.world && this.world.terrain && this.world.terrain.water;
      if (water) water.seaState = Math.min(1, c.seaState);
    }
    this.lightning(t, ac);
    this.fillShafts(t);
    if (!ac) return;
    // the wind at the aircraft, for the rain's slant and the gust sound
    if (W) { W.at(ac.pos, t, st.wind); this.addWind(ac.pos, t, st.wind); }
    st.gust = W ? clamp(W.turb * 1.2 + Math.max(0, W.gustKt - W.speedKt) / 25 + (this.burst ? this.burstAmp(t) * 0.3 : 0), 0, 1) : 0;
    this.shearWatch(dt, t, ac);
    this.jolts(dt, t, ac);
  }

  fire(e, t, ac) {
    const W = this.wind;
    switch (e.type) {
      case 'microburst': this.startBurst(e, t, ac); break;
      case 'gustFront': case 'windShift': case 'squall': {
        const quiet = e.type === 'windShift';
        if (W && (e.type !== 'squall' || e.shift || e.speed != null)) {
          // from where the wind is now; to a target relative to where it was going (a change that fires during
          // another one builds on its target, so events compose)
          const from = { dir: W.dirDeg, speed: W.speedKt, gust: W.gustKt, turb: this.turbBase };
          const prev = this.ramp ? this.ramp.to : from;
          const speed = e.speed ?? prev.speed;
          const gust = Math.max(speed, e.gust ?? (e.speed != null ? speed + 10 : prev.gust));
          const to = { dir: prev.dir + (e.shift || 0), speed, gust, turb: prev.turb + (e.turb ?? (quiet ? 0 : 0.15)) };
          this.ramp = { from, to, t0: t, dur: e.ramp || (quiet ? 15 : 4), said: false, announce: e.announce !== false };
        }
        if (e.type === 'squall') {
          this.rainTo = e.rain ?? 0.95;
          this.darkTo = e.darkness ?? 0.15;
          if (e.seaState != null) this.seaTarget = e.seaState;
          if (this.hud) this.hud.message('SQUALL', 'warn', 2.5);
        }
        if (!quiet && this.rig) this.rig.bump(0.6);
        break;
      }
      case 'turbBurst': this.turbAdd.push({ t0: t, dur: e.dur || 8, add: e.turb ?? 0.5 }); this.nextJolt = t; break;
      case 'visDrop': this.visFrom = this.state.vis; this.visTo = e.vis ?? 1500; this.visT0 = t; this.visDur = e.ramp || 6; break;
      default: break;
    }
  }

  // Tower's call after a wind change, the way it is given: "Wind 310 at 20, gusts 30."
  announceWind(to) {
    const dir = ((Math.round(to.dir / 10) * 10) % 360 + 360) % 360 || 360;
    const d3 = String(dir).padStart(3, '0'), spd = Math.round(to.speed), gst = Math.round(to.gust);
    const gusts = gst >= spd + 5;
    if (this.hud) this.hud.message(`WIND ${d3}/${spd}${gusts ? 'G' + gst : ''}`, 'warn', 4);
    if (this.audio) this.audio.say(`Wind ${d3.split('').join(' ')} at ${spd}${gusts ? ', gusts ' + gst : ''}.`);
  }

  // ---------- the microburst ----------
  startBurst(e, t, ac) {
    const k = e.strength ?? 1;
    const p = downburstParams({ outflow: (e.outflow ?? 24) * KT * k, radius: e.radius ?? 650, depth: e.depth ?? 300, eps: e.eps ?? 30 });
    // where: runway frame (u, v) if given, else on the approach path `ahead` metres in front of the aircraft
    let u = e.u;
    const v = e.v ?? 0;
    if (u == null) {
      const dx = ac.pos.x - this.origin.x, dz = ac.pos.z - this.origin.z;
      u = dx * this.dir.x + dz * this.dir.z + (e.ahead ?? 1500);
    }
    this.burst = { ...p, x: this.origin.x + this.dir.x * u + this.right.x * v, z: this.origin.z + this.dir.z * u + this.right.z * v, t0: t, grow: e.grow ?? 8, life: e.life ?? 100, decay: e.decay ?? 30, u, v, lossKt: 0 };
    // the loss a pilot flying through it on the glidepath would see, for the tower's alert (TDWR phrasing)
    const hPath = Math.max(40, (-u + (this.runway ? this.runway.aimDistance : 0)) * Math.tan(3 * DEG));
    this.burst.lossKt = Math.round((2 * downburst(p, p.R * 1.12, 0, hPath, 1, T0.set(0, 0, 0)).x) / KT / 5) * 5;
    if (this.runway && this.burst.lossKt >= 15) {
      const mi = Math.max(1, Math.round(-u / 1609));
      const name = String(this.runway.name || '').split('').join(' ');
      if (this.hud) this.hud.message(`MICROBURST ALERT  ${this.burst.lossKt} KT LOSS  ${mi} MI FINAL`, 'warn', 5);
      if (this.audio) this.audio.say(`Microburst alert. Runway ${name} arrival, ${this.burst.lossKt} knot loss, ${mi} mile final.`);
    }
  }
  burstAmp(t) {
    const b = this.burst; if (!b) return 0;
    return smoothstep(b.t0, b.t0 + b.grow, t) * (1 - smoothstep(b.t0 + b.grow + b.life, b.t0 + b.grow + b.life + b.decay, t));
  }

  // The local overlay, m/s, added to out. O(1) with an early exit: it runs per physics sub-step and per particle.
  addWind(p, t, out) {
    const b = this.burst;
    if (!b) return out;
    const dx = p.x - b.x, dz = p.z - b.z;
    if (dx * dx + dz * dz > b.rCut2) return out;
    const amp = this.burstAmp(t);
    if (amp <= 0) return out;
    return downburst(b, dx, dz, p.y - this.fieldY, amp, out);
  }

  // ---------- windshear alerting ----------
  // The F-factor (dWx/dt / g - w / V) of the SHEAR alone: the microburst overlay plus the mean wind as the
  // ramps move it, without the gust and turbulence noise, so a gusty day never cries wolf. Warning at F > 0.1
  // held for half a second, below 1500 ft, airborne: the reactive system's "Windshear, windshear, windshear".
  shearWatch(dt, t, ac) {
    if (dt <= 0) return;
    const st = this.state, W = this.wind, m = this._mean.set(0, 0, 0);
    if (W) {
      const h = Math.max(0, ac.pos.y - (W.groundY || 0));
      const v = W.speedKt * KT * W.heightFactor(h), psi = (W.dirDeg + 180) * DEG;
      m.set(Math.sin(psi) * v, 0, -Math.cos(psi) * v);
    }
    this.addWind(ac.pos, t, m);
    const V = Math.max(20, ac.ias);
    const hs = Math.hypot(ac.vel.x, ac.vel.z) || 1;
    const wx = (m.x * ac.vel.x + m.z * ac.vel.z) / hs;   // tailwind positive
    if (this.wxPrev != null) this.dWx += ((wx - this.wxPrev) / dt - this.dWx) * clamp(dt / 0.6, 0, 1);
    this.wxPrev = wx;
    const F = this.dWx / 9.81 - m.y / V;
    this.fShear += (F - this.fShear) * clamp(dt / 0.5, 0, 1);
    this.F = this.fShear;
    const low = !ac.onGround && ac.radioAlt < 1500 * FT && !ac.crashed;
    st.windshear = low && this.fShear > 0.06;
    if (st.windshear) this.shearLastT = t;   // when the airplane was last in the shear (a mission hint reads it)
    this.fHold = low && this.fShear > 0.1 ? this.fHold + dt : 0;
    // one warning per encounter: it re-arms after five seconds of calm air
    this.fCalm = this.fShear < 0.03 ? (this.fCalm || 0) + dt : 0;
    if (this.fCalm > 5) this.shearArmed = true;
    if (this.fHold > 0.5 && this.shearArmed !== false) {
      this.shearArmed = false;
      this.shearSaid = t;
      this.shearCount = (this.shearCount || 0) + 1;
      if (this.hud) this.hud.message('WINDSHEAR', 'bad', 5);
      if (this.audio) this.audio.say('Windshear, windshear, windshear.', true);
    }
  }

  // Turbulence felt through the seat: the camera jolts on the high-passed load factor, and during a burst.
  jolts(dt, t, ac) {
    if (!this.rig || ac.onGround || ac.crashed) return;
    this.gLP += (ac.gload - this.gLP) * clamp(dt / 0.5, 0, 1);
    const hp = Math.abs(ac.gload - this.gLP);
    if (hp > 0.18) this.rig.bump(clamp((hp - 0.18) * 1.6, 0, 0.9));
    if (this.turbAdd.length && t >= this.nextJolt) {
      let env = 0;
      for (const b of this.turbAdd) env = Math.max(env, envOf(b, t));
      this.rig.bump(clamp((0.25 + 0.6 * this.rngJolt()) * env * 1.6, 0, 1));
      this.nextJolt = t + 0.35 + this.rngJolt() * 1.1;
    }
  }

  // ---------- lightning ----------
  lightning(t, ac) {
    const s = this.spec, st = this.state, r = this.rngLight;
    if (t >= this.nextStrike) {
      // where: under a storm cell (weighted by its power), else anywhere 3-12 km out
      const px = ac ? ac.pos.x : this.origin.x, pz = ac ? ac.pos.z : this.origin.z, py = ac ? ac.pos.y : this.fieldY;
      let x, z;
      if (this.cells.length) {
        let tot = 0; for (const c of this.cells) tot += c.power;
        let pick = r() * tot, cell = this.cells[0];
        for (const c of this.cells) { pick -= c.power; if (pick <= 0) { cell = c; break; } }
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * cell.r * 0.8;
        x = cell.x + Math.cos(a) * d; z = cell.z + Math.sin(a) * d;
      } else {
        const a = r() * Math.PI * 2, d = 3000 + r() * 9000;
        x = px + Math.cos(a) * d; z = pz + Math.sin(a) * d;
      }
      const cg = r() < 0.55;
      const base = this.fieldY + (s.ceiling ?? 600);
      const dist = Math.hypot(x - px, z - pz, (cg ? (this.fieldY + base) * 0.5 : base + 400) - py);
      const power = clamp(1.6 / (1 + dist / 1500), 0.1, 1) * (0.7 + 0.3 * r());
      this.strikeT = t;
      this.strikePulses[0] = power; this.strikePulses[1] = 0.25 + 0.2 * r(); this.strikePulses[2] = 0.08 + 0.12 * r();
      this.strikeGap = 0.07 + 0.06 * r();
      st.strike++; st.strikeDist = dist; st.strikePower = power; st.strikeCG = cg;
      const b = st.bolt;
      b.x = x; b.z = z; b.y0 = this.fieldY; b.y1 = base; b.variant = Math.floor(r() * 4); b.dist = dist; b.cg = cg;
      // next: exponential intervals, about 6 a minute at lightning 1
      const mean = 60 / (6 * Math.max(0.05, s.lightning));
      this.nextStrike = t + Math.max(1.5, -Math.log(1 - r() * 0.98) * mean);
    }
    // the flash: one envelope (a fast rise, a 0.3 s fall) with the later return strokes as ripples on it, so a
    // strike is ONE flash, never a strobe (photosensitivity; the look softens it further for reduced motion)
    const a = t - this.strikeT;
    if (a >= 0 && a < 1.6) {
      const P = this.strikePulses, g = this.strikeGap;
      const env = P[0] * (a < 0.02 ? a / 0.02 : Math.exp(-(a - 0.02) / 0.3));
      const rip = (x) => (x > 0 && x < 0.25 ? Math.exp(-x / 0.05) : 0);
      st.flash = clamp(env * (1 + P[1] * rip(a - g) + P[2] * rip(a - 2.4 * g)), 0, 1);
      st.bolt.on = st.bolt.cg && a < 0.28;
    } else { st.flash = 0; st.bolt.on = false; }
  }

  fillShafts(t) {
    const st = this.state;
    let n = 0;
    for (const c of this.cells) { if (n >= 3) break; const sh = st.shafts[n++]; sh.x = c.x; sh.z = c.z; sh.r = c.r * 0.55; sh.a = 0.5 * c.power * Math.max(this.spec.rain, 0.5); }
    if (this.burst) { const sh = st.shafts[n++], b = this.burst; sh.x = b.x; sh.z = b.z; sh.r = b.R * 0.8; sh.a = 0.8 * this.burstAmp(t); }
    for (let i = n; i < 4; i++) st.shafts[i].a = 0;
    st.nShafts = n;
  }
}
