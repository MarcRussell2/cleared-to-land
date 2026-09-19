// The weather model (src/systems/weather.js), in plain Node: no weather is no change; the same seed is the same
// storm; the microburst has the structure and size it was designed with; nothing in the air jumps between two
// 4 ms physics steps; every storm mission is flown by the game's Autoland from its own spawn with several seeds
// (a microburst pilot flies the escape the tips teach); and the carrier-in-a-storm trap is asserted, which
// tools/test-carrier.mjs (a log, no assertions) does not do.
//
//   node tools/test-weather.mjs            the checks (exit 1 on a failure)
//   node tools/test-weather.mjs --fly id [seeds]   one mission's flights in detail, e.g. --fly microburst 1-12
import { installDomStub } from './dom-stub.mjs';
installDomStub();   // src/world/terrain.js reaches the art bench, which draws canvas textures
const THREE = await import('three');
const { Aircraft, makeGroundOut } = await import('../src/physics/aircraft.js');
const { AIRCRAFT } = await import('../src/aircraft/defs.js');
const { Wind } = await import('../src/physics/wind.js');
const { Carrier } = await import('../src/world/carrier.js');
const { Terrain } = await import('../src/world/terrain.js');
const { Autoland } = await import('../src/systems/autopilot.js');
const { SITES, SCENARIOS, siteFlats, resolveScenario } = await import('../src/systems/scenarios.js');
const { Weather, downburst, downburstParams, resolveWeatherSpec, WEATHER_PRESETS } = await import('../src/systems/weather.js');
const { WEATHER_MISSIONS } = await import('../src/missions/weather.js');
const { KT, FT, DEG, RAD, FPM, makeRng, headingToVec } = await import('../src/config.js');

let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) { passes++; if (VERBOSE) console.log('PASS ' + msg); } else { fails++; console.log('FAIL ' + msg); } };
const VERBOSE = process.argv.includes('-v');
const say = (s) => console.log(s);

// ---------------------------------------------------------------- a world without the GPU
// The runway object as src/world/airport.js resolves it (Airport itself imports the glTF models).
function makeRunway(d) {
  const heading = d.heading * DEG;
  const dir = headingToVec(heading, new THREE.Vector3());
  const right = new THREE.Vector3(-dir.z, 0, dir.x);
  const threshold = new THREE.Vector3(d.x, d.elevation, d.z);
  const aimDistance = d.aimDistance || Math.min(400, d.length * 0.15);
  const aim = threshold.clone().addScaledVector(dir, aimDistance); aim.y = d.elevation + (d.slope || 0) * aimDistance;
  return { ...d, heading, dir, right, threshold, aim, aimDistance, slope: d.slope || 0, surface: d.surface || 'asphalt' };
}
function makeWorld(site, sc) {
  const terrain = new Terrain({ ...site.terrain, flats: siteFlats(site) });
  const runway = site.runways ? makeRunway(site.runways[0]) : null;
  const carrier = site.carrier ? new Carrier({ ...site.carrier, seaState: sc.seaState ?? site.carrier.seaState, x: 0, z: 0 }) : null;
  const w = {
    site, terrain, runway, carrier, airport: null,
    ground(x, z, out) {
      if (carrier && carrier.ground(x, z, out)) return;
      if (runway) {
        const dx = x - runway.threshold.x, dz = z - runway.threshold.z;
        const u = dx * runway.dir.x + dz * runway.dir.z, v = dx * runway.right.x + dz * runway.right.z;
        if (u >= -5 && u <= runway.length + 5 && Math.abs(v) <= runway.width / 2 + 1) {
          out.y = runway.elevation + runway.slope * u; out.n.set(0, 1, 0); out.vel.set(0, 0, 0);
          out.mu = runway.wet ? 0.5 : 0.85; out.kind = 'runway'; out.rough = 0; return;
        }
      }
      terrain.ground(x, z, out);
    },
  };
  return w;
}
// src/main.js spawn(), for the fields the storm missions use.
function spawn(ac, sc, w, wind) {
  const def = ac.def, sp = sc.spawn;
  const dist = sp.dist || 5000;
  let pos, heading, gsAngle;
  if (w.carrier) {
    const c = w.carrier;
    heading = c.landingHeading(); gsAngle = 3.5 * DEG;
    pos = c.tdWorld.clone().addScaledVector(c.landDirWorld, -dist);
    pos.y = c.tdWorld.y + dist * Math.tan(gsAngle) + 3;
    ac.input.hookCmd = 1; ac.ctl.hook = 1;
  } else {
    const rw = w.runway;
    heading = rw.heading;
    const u = sp.u != null ? sp.u : -dist, v = sp.v != null ? sp.v : (sp.offset || 0);
    pos = rw.threshold.clone().addScaledVector(rw.dir, u).addScaledVector(rw.right, v);
    if (sp.hdg) heading += sp.hdg * DEG;
    gsAngle = (rw.gsAngle || (def.approach.glideslope * RAD)) * DEG;
    pos.y = rw.aim.y + (rw.aimDistance - u) * Math.tan(gsAngle) + def.cgHeight;
  }
  ac.pos.copy(pos);
  ac.input.gearCmd = sp.gear === false ? 0 : 1; ac.ctl.gear = ac.input.gearCmd;
  const speed = (sp.speedKt || sc.scoring?.vref || def.speeds.Vref) * KT;
  ac.trim(heading, speed, sp.gamma != null ? sp.gamma * DEG : -gsAngle, sp.flap ?? 0, wind.at(pos, 0, new THREE.Vector3()));
  for (const e of ac.engines) e.throttle = ac.input.throttle;
  if (def.spoilers && !w.carrier && def.id === 'condor') ac.input.spoilerArmed = false;
  ac._derive();
}

// The microburst technique the tips teach, wrapped around the stock Autoland: on WINDSHEAR, thrust to the stops
// and pitch up toward 15 degrees but never past the stall warning, wings level; out the far side, hand back.
class EscapePilot {
  constructor(ac, world, sc, weather) { this.ac = ac; this.world = world; this.sc = sc; this.wx = weather; this.ap = new Autoland(ac, world, sc); this.mode = 'approach'; this.calm = 0; this.escapes = 0; }
  update(dt) {
    const ac = this.ac, inp = ac.input, st = this.wx.state;
    if (this.mode === 'approach' && st.windshear && !ac.onGround) { this.mode = 'escape'; this.escapes++; this.saved = { pitchRef: this.ap.pitchRef, thr0: this.ap.thr0 }; this.iP = 0; }
    if (this.mode === 'escape') {
      this.calm = st.windshear || this.wx.F > 0.02 ? 0 : this.calm + dt;
      inp.throttle = 1;
      const warnMargin = ac.aero.alphaStall - 1.5 * DEG - ac.aero.alpha;
      // up toward 15 degrees while it sinks; once it climbs, only as much as stops the sink (no zoom out the far side)
      const want = ac.vs > 0 ? Math.max(4 * DEG, 15 * DEG - ac.vs * 1.6 * DEG) : 15 * DEG;
      const target = warnMargin > 0 ? want : ac.euler.pitch - 2 * DEG;
      // hold the attitude the way the assist law would (an integral takes out the trim the approach left behind)
      const err = Math.min(target, 15 * DEG) - ac.euler.pitch;
      this.iP = Math.max(-0.6, Math.min(0.6, this.iP + err * dt * 2.5));
      inp.pitch = Math.max(-1, Math.min(1, 4.5 * err + this.iP - 2.5 * ac.omega.x));
      inp.roll = Math.max(-1, Math.min(1, -2.0 * ac.euler.roll + 0.8 * ac.omega.z));
      inp.yaw = Math.max(-1, Math.min(1, 1.5 * ac.aero.beta));
      // out the far side: the sink is gone and the speed is back (or the shear has been calm a while)
      const vref = (this.sc.scoring && this.sc.scoring.vref || ac.def.speeds.Vref) * KT;
      if (this.calm > 2 || (this.wx.F < 0.05 && ac.vs > 2 && ac.ias > vref)) { this.mode = 'recapture'; this.ap = new Autoland(ac, this.world, this.sc); this.ap.pitchRef = this.saved.pitchRef; this.ap.thr0 = this.saved.thr0; }
      return;
    }
    // Out the far side, high: Autoland's lateral and speed, but a steady descent (800-1,800 fpm, steeper the higher it
    // is) down to the glidepath, then Autoland from the glidepath or from 450 ft, whichever comes first.
    this.ap.update(dt);
    if (this.mode === 'recapture') {
      const g = this.ap.geometry(), err = ac.pos.y - g.hDes;
      if (err < 8 || ac.radioAlt < 450 * FT) { this.mode = 'approach'; return; }   // on the glidepath, or low: Autoland settles and flares
      const vsErr = -Math.min(9, 4 + 0.03 * err) - ac.vs;
      inp.pitch = Math.max(-1, Math.min(1, 4.5 * (this.saved.pitchRef + 0.03 * vsErr - ac.euler.pitch) - 2.5 * ac.omega.x));
    }
  }
}

// A carrier pilot flying the Navy technique the tips teach: pitch holds on-speed AoA, the throttle flies the
// glideslope to the ship's MEAN deck (the ball's average, not every heave), the stock Autoland keeps the lineup.
// No flare: fly it into the deck, full power at touchdown until the wire has you.
class BallPilot {
  constructor(ac, world, sc) {
    this.ac = ac; this.c = world.carrier;
    this.lateral = new Autoland(ac, world, sc);
    this.local = this.c.landLocalPoint(this.c.touchdownU, 0);
    this.td = new THREE.Vector3(); this.int = 0; this.thr = null; this.mode = 'approach';
  }
  update(dt) {
    const ac = this.ac, inp = ac.input, c = this.c, def = ac.def;
    this.t = (this.t || 0) + dt;
    this.lateral.update(dt);   // roll, yaw, gear, hook, flaps (and the bolter go-around); it flies the first 3 s
    if (this.t < 3 || this.lateral.phase === 'bolter' || ac.trap.engaged || ac.trap.trapped || ac.wheelsOnGround) { this.mode = this.lateral.phase; this.thr = inp.throttle; return; }
    this.td.copy(this.local).applyQuaternion(c.qYaw).add(c.pos);
    const dir = c.landDirWorld;
    const dToTd = -((ac.pos.x - this.td.x) * dir.x + (ac.pos.z - this.td.z) * dir.z);
    const gs = Math.tan(3.5 * DEG);
    const hErr = this.td.y + dToTd * gs + 3.3 - ac.pos.y;
    const closure = Math.max(5, ac.gs - c.speed);
    const vsDes = -closure * gs + Math.max(-2.5, Math.min(2.5, 0.15 * hErr));
    const e = vsDes - ac.vs;
    this.int = Math.max(-0.3, Math.min(0.3, this.int + 0.008 * e * dt));
    inp.throttle = Math.max(0, Math.min(1, this.thr + 0.025 * e + this.int));
    inp.pitch = Math.max(-1, Math.min(1, 4.0 * (def.approach.onSpeedAoA - ac.aero.alpha) - 2.2 * ac.omega.x));
    this.mode = 'ball';
  }
}

// Flying the lens: the ball's glideslope is referenced to the deck it is mounted on, so it tilts and rides with
// the ship. The stock Autoland, steered at the touchdown point moved to the deck plane under the airplane (the
// same line the ball shows), so the hook crosses the ramp at the same height above the deck whatever the swell.
class LensPilot {
  constructor(ac, world, sc) {
    const c = this.c = world.carrier;
    this.ac = ac;
    this.lens = { get speed() { return c.speed; }, tdWorld: new THREE.Vector3(), landDirWorld: c.landDirWorld, landRightWorld: c.landRightWorld, landingHeading: () => c.landingHeading() };
    this.ap = new Autoland(ac, { carrier: this.lens, runway: null }, sc);
    this.l = { x: 0, z: 0 }; this.mode = 'approach';
  }
  get phase() { return this.ap.phase; }
  update(dt) {
    const c = this.c, ac = this.ac;
    const l = c.toLocalXZ(ac.pos.x, ac.pos.z, this.l);
    this.lens.tdWorld.copy(c.tdWorld);
    this.lens.tdWorld.y = c.deckWorldY(l.x, l.z);
    this.ap.update(dt);
    this.mode = this.ap.phase;
  }
}

// A good carrier pilot with an LSO talking. Far out it flies the ball's average (the stock Autoland steered at
// the ship's MEAN deck, not every swing of the ball); in the last few seconds it flies the real deck, the way the
// ball and the deck converge in close; and it never lets the path go below where the ramp WILL be when the hook
// gets there ("power... little power" when the stern is coming up). It reads the deck, not the future wind: the
// ramp's height at the crossing comes from a copy of the ship run ahead to that moment.
class LsoPilot {
  constructor(ac, world, sc) {
    const c = this.c = world.carrier;
    this.ac = ac;
    this.ref = { get speed() { return c.speed; }, tdWorld: new THREE.Vector3(), landDirWorld: c.landDirWorld, landRightWorld: c.landRightWorld, landingHeading: () => c.landingHeading() };
    this.ap = new Autoland(ac, { carrier: this.ref, runway: null }, sc);
    this.local = c.landLocalPoint(c.touchdownU, 0);
    this.probe = new Carrier({ seaState: c.seaState });
    this.dl = { u: 0, v: 0, h: 0, onDeck: false }; this.y = null; this.mode = 'approach';
  }
  get phase() { return this.ap.phase; }
  update(dt) {
    const c = this.c, ac = this.ac, P = this.probe;
    this.ref.tdWorld.copy(this.local).applyQuaternion(c.qYaw).add(c.pos);   // the mean deck (y = 20)
    const meanY = this.ref.tdWorld.y;
    const dl = c.deckLocal(ac.pos, this.dl);
    const closure = Math.max(5, ac.gs - c.speed);
    const tRamp = -dl.u / closure;
    const w = tRamp <= 3 ? 1 : tRamp >= 8 ? 0 : (8 - tRamp) / 5;
    let y = meanY + w * (c.tdWorld.y - meanY);
    if (tRamp > 0 && tRamp < 20) { P.seaState = c.seaState; P.phase = c.phase; P.pos.copy(c.pos); P.t = c.t + tRamp; P.update(0); y = Math.max(y, P.rampWorld.y + 0.2); }
    if (this.y == null) this.y = y;
    this.y += Math.max(-dt * 2, Math.min(dt * 2, y - this.y));
    this.ref.tdWorld.y = this.y;
    this.ap.update(dt);
    this.mode = this.ap.phase;
  }
}

// The pilot who does nothing about it: Autoland for the first three seconds (to settle the spawn), then the trimmed
// attitude and power are frozen (wings kept level) until 60 m, where Autoland takes it back for the flare. What the
// burst does unopposed.
class HoldPilot {
  constructor(ac, world, sc) { this.ac = ac; this.ap = new Autoland(ac, world, sc); this.frozen = null; this.mode = 'approach'; }
  update(dt) {
    const ac = this.ac, inp = ac.input;
    this.t = (this.t || 0) + dt;
    if (!this.frozen && this.t > 3) this.frozen = { pitch: ac.euler.pitch, thr: inp.throttle };
    if (this.frozen && ac.radioAlt > 60) {
      this.mode = 'hold';
      inp.throttle = this.frozen.thr;
      inp.pitch = Math.max(-1, Math.min(1, 2.5 * (this.frozen.pitch - ac.euler.pitch) - 1.2 * ac.omega.x));
      inp.roll = Math.max(-1, Math.min(1, -2.0 * ac.euler.roll + 0.8 * ac.omega.z));
      inp.yaw = Math.max(-1, Math.min(1, 1.5 * ac.aero.beta));
      return;
    }
    this.mode = 'approach';
    this.ap.update(dt);
  }
}

// One flight, the way src/main.js frame() orders it: pilot, weather, deck, physics. dt = 1/25 like the harnesses.
export function fly(base, seed, { pilot = 'autoland', maxT = 420, trace = false, approach = 'short' } = {}) {
  const sc = resolveScenario(base, makeRng(seed), { approach });
  const site = SITES[sc.site];
  const w = makeWorld(site, sc);
  const def = AIRCRAFT[sc.aircraft];
  const ac = new Aircraft(def, { mass: def.massOptions[sc.weight] || def.mass });
  const wind = new Wind();
  wind.groundY = site.runways ? site.runways[0].elevation : 0;
  const rwHeading = w.runway ? w.runway.heading : w.carrier.landingHeading();
  const wd = sc.wind;
  wind.set({ dir: wd.dir != null ? wd.dir : ((rwHeading * RAD + (wd.rel || 0)) + 720) % 360, speed: wd.speed || 0, gust: wd.gust, turb: wd.turb || 0, shear: wd.shear || 0, seed });
  const msgs = [], said = [];
  const hud = { message: (m) => msgs.push(m), callout() {}, setFailures() {} };
  const audio = { say: (s) => said.push(s), beep() {} };
  const rig = { bumps: 0, bump() { this.bumps++; } };
  const weather = sc.weather ? new Weather(sc.weather, { seed, wind, world: w, scenario: sc, hud, audio, rig }) : null;
  ac.stallSign = seed % 2 ? 1 : -1;
  spawn(ac, sc, w, wind);
  const env = { wind: (p, t, o) => { wind.at(p, t, o); if (weather) weather.addWind(p, t, o); return o; }, ground: (x, z, o) => w.ground(x, z, o), carrier: w.carrier };
  const ap = pilot === 'escape' ? new EscapePilot(ac, w, sc, weather) : pilot === 'hold' ? new HoldPilot(ac, w, sc) : pilot === 'ball' ? new BallPilot(ac, w, sc) : pilot === 'lens' ? new LensPilot(ac, w, sc) : pilot === 'lso' ? new LsoPilot(ac, w, sc) : new Autoland(ac, w, sc);
  const dt = 1 / 25;
  let t = 0, end = 0, minGs = 1e9, shearMin = 1e9, events = [];
  for (let i = 0; i < maxT / dt; i++) {
    t += dt;
    ap.update(dt);
    if (weather) weather.update(dt, t, ac);
    if (w.carrier) w.carrier.update(dt);
    ac.step(dt, env);
    for (const e of ac.events) events.push(e.type + (e.wire ? e.wire : '') + (e.reason ? ':' + e.reason : ''));
    ac.events.length = 0;
    if (w.runway && !ac.onGround) {
      const rw = w.runway, u = (ac.pos.x - rw.threshold.x) * rw.dir.x + (ac.pos.z - rw.threshold.z) * rw.dir.z;
      if (u < -300) { const hDes = rw.aim.y + (rw.aimDistance - u) * Math.tan(3 * DEG) + def.cgHeight; minGs = Math.min(minGs, ac.pos.y - hDes); }
      if (weather && weather.state.windshear) shearMin = Math.min(shearMin, ac.radioAlt);
    }
    if (trace && w.carrier) { const dl = w.carrier.deckLocal(ac.hookTipWorld || ac.pos, {}); if (dl.u > -150 && dl.u < 150 && i % 2 === 0) say(`   c t=${t.toFixed(2)} hook u=${dl.u.toFixed(1)} h=${dl.h.toFixed(2)} v=${dl.v.toFixed(1)} vs=${(ac.vs / FPM).toFixed(0)} heave=${w.carrier.heave.toFixed(2)} hr=${w.carrier.heaveRate.toFixed(2)} pitchDeck=${(w.carrier.pitch * RAD).toFixed(2)} gear=${ac.legs.map((l) => l.contact ? 'C' : '-').join('')} trap=${ac.trap.engaged ? 'ENG' : ac.trap.trapped ? 'T' : ac.trap.boltered ? 'B' : '-'} ${ac.events.map((e) => e.type).join(',')}`); }
    if (trace && i % 25 === 0) say(`  t=${t.toFixed(0)} d=${(-(ac.pos.z)).toFixed(0)} ra=${(ac.radioAlt / FT).toFixed(0)}ft ias=${(ac.ias / KT).toFixed(0)} vs=${(ac.vs / FPM).toFixed(0)} pitch=${(ac.euler.pitch * RAD).toFixed(1)} thr=${ac.input.throttle.toFixed(2)} aoa=${(ac.aero.alpha * RAD).toFixed(1)} F=${weather && weather.F != null ? weather.F.toFixed(3) : '-'} ws=${weather ? weather.state.windshear : '-'} mode=${ap.mode || ''}`);
    if (ac.crashed) { end += dt; if (end > 1) break; }
    else if (ac.stopped) { end += dt; if (end > 1) break; }
    else if (ac.trap.trapped && ac.gsRel < 1) { end += dt; if (end > 1) break; }
  }
  const td = ac.stats.touchdown;
  let tdU = null;
  if (td && w.runway) { const rw = w.runway; tdU = (td.pos.x - rw.threshold.x) * rw.dir.x + (td.pos.z - rw.threshold.z) * rw.dir.z; }
  return {
    id: sc.id, seed, t: +t.toFixed(1), crashed: ac.crashed, reason: ac.crashReason || '', stopped: ac.stopped,
    td: td ? { fpm: Math.round(td.vs / FPM), kt: Math.round(td.ias / KT), u: tdU != null ? Math.round(tdU) : null } : null,
    wire: ac.trap.trapped ? ac.trap.wire : 0, bolters: events.filter((e) => e === 'bolter').length,
    minGs: Math.round(minGs), shearMin: shearMin < 1e9 ? Math.round(shearMin / FT) : null, msgs, said, bumps: rig.bumps, escapes: ap.escapes || 0, wet: w.runway ? !!w.runway.wet : null,
    weather, carrier: !!w.carrier,
  };
}
const outcome = (r) => r.crashed ? `CRASH (${r.reason})` : r.wire ? `TRAP ${r.wire}-wire${r.bolters ? ' after ' + r.bolters + ' bolter(s)' : ''}` : r.td && r.carrier ? 'BOLTER (hook over the wires)' : r.td ? `LANDED ${r.td.fpm} fpm ${r.td.kt} kt at u=${r.td.u ?? '-'} m${r.stopped ? ', stopped' : ''}` : r.bolters ? `BOLTER x${r.bolters}, no trap` : 'NO TOUCHDOWN';

// ---------------------------------------------------------------- --fly: one mission in detail
const flyAt = process.argv.indexOf('--fly');
if (flyAt >= 0) {
  const id = process.argv[flyAt + 1];
  const [a, b] = (process.argv[flyAt + 2] || '1-6').split('-').map(Number);
  const pilot = process.argv.includes('--escape') ? 'escape' : process.argv.includes('--hold') ? 'hold' : process.argv.includes('--ball') ? 'ball' : process.argv.includes('--lens') ? 'lens' : process.argv.includes('--lso') ? 'lso' : 'autoland';
  const approach = process.argv.includes('--long') ? 'long' : process.argv.includes('--medium') ? 'medium' : 'short';
  // --set '{"weather":{"seaState":0.8}}' tries a variant (nested objects are merged one level down)
  const setAt = process.argv.indexOf('--set');
  const over = setAt >= 0 ? JSON.parse(process.argv[setAt + 1]) : {};
  const orig = SCENARIOS.find((s) => s.id === id);
  const base = { ...orig };
  for (const k of Object.keys(over)) base[k] = over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) ? { ...orig[k], ...over[k] } : over[k];
  for (let seed = a; seed <= (b || a); seed++) {
    const r = fly(base, seed, { pilot, trace: process.argv.includes('--trace'), approach });
    say(`${id} seed ${seed} ${pilot}: ${outcome(r)}  t=${r.t}s  minGS=${r.minGs} m  shear@${r.shearMin ?? '-'} ft  escapes=${r.escapes}  msgs=${r.msgs.join(' | ')}`);
  }
  process.exit(0);
}

// ================================================================ the checks
say('weather model');

// 1. The spec: presets fill what a mission leaves out; events are copies.
{
  const s = resolveWeatherSpec({ preset: 'storm', rain: 0.9, events: [{ type: 'turbBurst' }] });
  ok(s.rain === 0.9 && s.darkness === WEATHER_PRESETS.storm.darkness && s.ceiling === WEATHER_PRESETS.storm.ceiling, 'a preset fills what the spec leaves out, the spec wins where it speaks');
  ok(Object.keys(WEATHER_PRESETS).join() === 'clear,overcast,rain,storm,snow,dust,fog', 'presets: clear overcast rain storm snow dust fog');
}

// 2. No weather is no change: with no events, env.wind is Wind.at() bit for bit, and the Wind is never written.
{
  const wind = new Wind({ dir: 300, speed: 14, gust: 22, turb: 0.4, shear: 0.3, seed: 77 });
  wind.groundY = 8;
  const before = JSON.stringify([wind.dirDeg, wind.speedKt, wind.gustKt, wind.turb, wind.shear]);
  const site = SITES.harbor, sc = { vis: 30000 };
  const w = makeWorld(site, sc);
  const wx = new Weather({ preset: 'rain', lightning: 0.8 }, { seed: 77, wind, world: w, scenario: sc });
  const ac = { pos: new THREE.Vector3(0, 300, 4000), vel: new THREE.Vector3(0, -3, -70), ias: 70, radioAlt: 290, onGround: false, crashed: false, gload: 1, stats: {} };
  const a = new THREE.Vector3(), b = new THREE.Vector3(), p = new THREE.Vector3();
  let same = true;
  for (let i = 0; i < 4000; i++) {
    const t = i * 0.037;
    wx.update(0.037, t, ac);
    p.set(Math.sin(i) * 3000, 5 + (i % 400), Math.cos(i * 0.7) * 5000);
    wind.at(p, t, a);
    b.set(0, 0, 0); wind.at(p, t, b); wx.addWind(p, t, b);
    if (a.x !== b.x || a.y !== b.y || a.z !== b.z) { same = false; break; }
  }
  ok(same, 'with no events the wind is exactly Wind.at() (4000 samples, bitwise)');
  ok(JSON.stringify([wind.dirDeg, wind.speedKt, wind.gustKt, wind.turb, wind.shear]) === before, 'with no events the Wind object is never written');
  ok(wx.state.strike > 0, `lightning still strikes with no events (${wx.state.strike} strikes in 148 s)`);
}

// 3. The same seed is the same storm; another seed is another storm.
{
  const run = (seed) => {
    const wind = new Wind({ dir: 10, speed: 10, gust: 16, turb: 0.25, seed }); wind.groundY = 8;
    const site = SITES.harbor, base = SCENARIOS.find((s) => s.id === 'microburst');
    const w = makeWorld(site, base);
    const wx = new Weather(base.weather, { seed, wind, world: w, scenario: base });
    const ac = { pos: new THREE.Vector3(0, 380, 6600), vel: new THREE.Vector3(0, -3.8, -72), ias: 73, radioAlt: 370, onGround: false, crashed: false, gload: 1, stats: {} };
    const trace = [];
    const o = new THREE.Vector3();
    for (let i = 0; i < 2500; i++) {
      const t = i / 25;
      ac.pos.addScaledVector(ac.vel, 1 / 25); ac.radioAlt = ac.pos.y - 8;
      wx.update(1 / 25, t, ac);
      o.set(0, 0, 0); wx.addWind(ac.pos, t, o);
      trace.push(wx.state.flash.toFixed(6), wx.state.strike, o.x.toFixed(6), o.y.toFixed(6), wx.state.rain.toFixed(6), wx.state.windshear ? 1 : 0);
    }
    return { trace: trace.join(','), strikes: wx.state.strike, cells: JSON.stringify(wx.cells) };
  };
  const a = run(307), b = run(307), c = run(308);
  ok(a.trace === b.trace && a.cells === b.cells, 'the same seed gives the same cells, strikes, flashes, rain and overlay (100 s at 25 Hz)');
  ok(a.cells !== c.cells && a.trace !== c.trace, 'another seed gives another storm');
  ok(a.strikes >= 3 && a.strikes <= 40, `lightning 0.35 strikes a plausible number of times in 100 s (${a.strikes})`);
}

// 4. The microburst: structure and size (the mission's: 24 kt peak outflow, R 650 m, depth 300 m).
{
  const p = downburstParams({ outflow: 24 * KT, radius: 650, depth: 300 });
  const o = new THREE.Vector3();
  const at = (r, h) => downburst(p, r, 0, h, 1, o.set(0, 0, 0));
  // peak outflow height
  let best = 0, bestH = 0;
  for (let h = 1; h <= 400; h += 1) { const u = at(p.R * 1.12, h).x; if (u > best) { best = u; bestH = h; } }
  ok(bestH >= 30 && bestH <= 100, `outflow peaks 30-100 m above the ground (${bestH} m)`);
  ok(Math.abs(best / KT - 24) < 1.2, `peak outflow is the design 24 kt (${(best / KT).toFixed(1)} kt)`);
  ok(at(p.R, 0.001).length() < 0.01, 'nothing at the ground: outflow and downdraft fade to zero');
  const w100 = -at(0, 100).y, w250 = -at(0, 250).y;
  ok(w100 > 2.5 && w100 < 7, `downdraft in the core at 100 m: ${w100.toFixed(1)} m/s (2.5-7)`);
  ok(w250 > 7 && w250 < 14, `downdraft in the core at 250 m: ${w250.toFixed(1)} m/s (7-14)`);
  ok(at(p.R * 3.5, 80).length() < 1e-3 && at(p.R * 3.3, 80).length() < 0.8, `the footprint ends at 3.5 R, smoothly (${at(p.R * 3.3, 80).length().toFixed(2)} m/s at 3.3 R)`);
  // continuity: div = (1/r) d(r u)/dr + dw/dh = 0
  let worst = 0;
  for (const [r, h] of [[200, 50], [650, 80], [900, 150], [1500, 40], [400, 300]]) {
    const e = 0.5;
    const ru = (rr, hh) => rr * downburst(p, rr, 0, hh, 1, o.set(0, 0, 0)).x;
    const wv = (rr, hh) => downburst(p, rr, 0, hh, 1, o.set(0, 0, 0)).y;
    const div = (ru(r + e, h) - ru(r - e, h)) / (2 * e) / r + (wv(r, h + e) - wv(r, h - e)) / (2 * e);
    worst = Math.max(worst, Math.abs(div));
  }
  ok(worst < 1e-5, `the flow is mass-conserving (worst divergence ${worst.toExponential(1)} 1/s)`);
  // along the microburst mission's approach path: headwind, then sink, then tailwind
  const base = SCENARIOS.find((s) => s.id === 'microburst');
  const w = makeWorld(SITES.harbor, base);
  const wind = new Wind({ dir: 0, speed: 0, seed: 1 }); wind.groundY = 8;
  const wx = new Weather(base.weather, { seed: 5, wind, world: w, scenario: base });
  const mb = base.weather.events.find((e) => e.type === 'microburst');
  const ac = { pos: new THREE.Vector3(0, 330, -mb.u + 1500), vel: new THREE.Vector3(0, -3.8, -72), ias: 73, radioAlt: 380, onGround: false, crashed: false, gload: 1, stats: {} };
  wx.update(0.04, 1.5, ac); wx.update(0.04, 30, ac);   // fired and grown
  ok(!!wx.burst && Math.abs(wx.burst.z + mb.u) < 1 && Math.abs(wx.burst.x - mb.v) < 1, `the burst sits where the mission put it (u ${mb.u}, v +${mb.v}, ${(-mb.u / 1852).toFixed(1)} NM final)`);
  ok(-mb.u >= 2 * 1852 && -mb.u <= 3 * 1852, 'the microburst is on a 2-3 NM final');
  const alongPath = (u) => { const y = 8 + (400 - u) * Math.tan(3 * DEG); return wx.addWind(new THREE.Vector3(0, y, -u), 30, new THREE.Vector3()); };
  const head = alongPath(mb.u - 800), core = alongPath(mb.u), tail = alongPath(mb.u + 800);
  ok(head.z > 4 && core.y < -7 && tail.z < -4, `on the glidepath (flying toward -z): headwind ${(head.z / KT).toFixed(0)} kt, then sink ${(-core.y).toFixed(1)} m/s, then tailwind ${(-tail.z / KT).toFixed(0)} kt`);
  ok(wx.burst.lossKt >= 30 && wx.burst.lossKt <= 55, `the tower's microburst alert gives a ${wx.burst.lossKt} kt loss`);
}

// 5. Continuity: nothing in the air jumps between two 4 ms physics steps, through every event type.
{
  const base = { vis: 30000 };
  const w = makeWorld(SITES.bayfield, base);
  const wind = new Wind({ dir: 350, speed: 8, gust: 12, turb: 0.25, seed: 9 }); wind.groundY = 0;
  const spec = { preset: 'storm', events: [
    { type: 'gustFront', at: { type: 'time', value: 2 }, shift: 60, speed: 20, gust: 30 },
    { type: 'microburst', at: { type: 'time', value: 3 }, u: -1200, v: 0 },
    { type: 'turbBurst', at: { type: 'time', value: 4 }, turb: 0.6, dur: 6 },
    { type: 'windShift', at: { type: 'time', value: 9 }, shift: -40 },
    { type: 'squall', at: { type: 'time', value: 12 }, shift: 30, speed: 25, gust: 35, rain: 1 },
    { type: 'visDrop', at: { type: 'time', value: 13 }, vis: 1200 },
  ] };
  const wx = new Weather(spec, { seed: 9, wind, world: w, scenario: base });
  const ac = { pos: new THREE.Vector3(0, 120, 2400), vel: new THREE.Vector3(0, -3, -60), ias: 60, radioAlt: 120, onGround: false, crashed: false, gload: 1, stats: {} };
  const a = new THREE.Vector3(), prev = new THREE.Vector3();
  let worst = 0, first = true, worstAt = 0, dirOut = 0;
  for (let i = 0; i < 25 * 250; i++) {   // 25 s at 4 ms
    const t = i * 0.004;
    ac.pos.addScaledVector(ac.vel, 0.004); ac.radioAlt = ac.pos.y;
    if (i % 10 === 0) { wx.update(0.04, t, ac); if (!(wind.dirDeg >= 0 && wind.dirDeg < 360)) dirOut++; }   // the frame; the physics sub-steps in between
    a.set(0, 0, 0); wind.at(ac.pos, t, a); wx.addWind(ac.pos, t, a);
    if (!first) { const d = a.distanceTo(prev); if (d > worst) { worst = d; worstAt = t; } }
    prev.copy(a); first = false;
  }
  ok(worst < 0.35, `the wind at the airplane never changes more than 0.35 m/s in one 4 ms step (worst ${worst.toFixed(3)} at t=${worstAt.toFixed(2)} s)`);
  ok(Math.abs(wind.speedKt - 25) < 1e-9 && Math.abs(wind.gustKt - 35) < 1e-9 && Math.abs(wind.dirDeg - (350 + 60 - 40 + 30) % 360) < 1e-9, `after the ramps the Wind holds the last target (${wind.dirDeg.toFixed(0)} deg, ${wind.speedKt} G ${wind.gustKt} kt)`);
  ok(dirOut === 0, `the Wind's direction stays 0..360 through every ramp, swinging through north (${dirOut} frames outside)`);
  ok(Math.abs(wind.turb - (0.25 + 0.15 + 0.15)) < 1e-9, `the turbulence burst is gone and the fronts' roughness stays (turb ${wind.turb.toFixed(2)})`);
  ok(Math.abs(wx.state.vis - 1200) < 1e-6 && wx.state.rain > 0.95, `visDrop and the squall's rain arrive (vis ${wx.state.vis}, rain ${wx.state.rain.toFixed(2)})`);
}

// 6. The carrier's sea: seeded phases change the deck only when asked, and a storm sea is bigger but smooth.
{
  const pose = (c) => { const out = []; for (let i = 0; i < 600; i++) { c.update(1 / 60); out.push(c.heave, c.pitch, c.roll); } return out; };
  const a = pose(new Carrier({ seaState: 0.8 })), b = pose(new Carrier({ seaState: 0.8 }));
  ok(a.every((v, i) => v === b[i]), 'without a seed the deck moves exactly as it always has');
  const s1 = new Carrier({ seaState: 1.2, seed: 11 }), s2 = new Carrier({ seaState: 1.2, seed: 12 });
  const p1 = pose(s1), p2 = pose(s2);
  ok(p1.some((v, i) => v !== p2[i]), 'two seeds, two decks');
  let maxRate = 0, maxHeave = 0; const c = new Carrier({ seaState: 1.2, seed: 3 });
  for (let i = 0; i < 6000; i++) { c.update(1 / 60); maxRate = Math.max(maxRate, Math.abs(c.heaveRate)); maxHeave = Math.max(maxHeave, Math.abs(c.heave)); }
  ok(maxHeave > 2.2 && maxHeave < 3.5 && maxRate < 2.5, `sea 1.2 heaves up to ${maxHeave.toFixed(2)} m at up to ${maxRate.toFixed(2)} m/s (2.2-3.5 m, < 2.5 m/s)`);
}

// 7. The storm missions, flown. Runways: the game's Autoland (the pilot that verifies every challenge), five seeds
// each; every flight must end on the runway without breaking. The microburst three ways: Autoland, the escape
// the tips teach, and a pilot who freezes attitude and power (who must NOT make it: the burst is real).
// Carriers: Autoland for the record, and the LSO pilot (above) for the assertion - a pilot who flies the ball's
// average and adds power when the stern is coming up must never hit the ramp, and must get aboard often.
const SEEDS = [307, 11, 42, 99, 123];
const BOAT_SEEDS = [307, 11, 42, 99, 123, 7, 8, 9, 10, 12, 13, 14];
const results = {};
const rate = (rs, f) => `${rs.filter(f).length}/${rs.length}`;
for (const m of WEATHER_MISSIONS) {
  const base = SCENARIOS.find((s) => s.id === m.id);
  ok(!!base && /^[a-z0-9][a-z0-9-]{0,23}$/.test(m.id) && m.group === 'storms' && m.difficulty >= 1 && m.difficulty <= 5 && m.tips.length === 3 && m.n >= 21 && m.n <= 25, `${m.id}: registered, a permanent id, group storms, difficulty ${m.difficulty}, three tips, n ${m.n}`);
  const boat = base.scoring.type === 'carrier';
  const pilots = m.id === 'microburst' ? ['autoland', 'escape', 'hold'] : boat ? ['autoland', 'lso'] : ['autoland'];
  for (const pilot of pilots) {
    const rs = (boat ? BOAT_SEEDS : SEEDS).map((seed) => fly(base, seed, { pilot }));
    results[m.id + '/' + pilot] = rs;
    say(`  ${m.id.padEnd(12)} ${pilot.padEnd(8)} ${rs.map((r) => `${r.seed}: ${outcome(r)}`).join('; ')}`);
    if (boat) {
      if (pilot === 'lso') {
        ok(rs.every((r) => !r.crashed), `${m.id} (LSO pilot): no ramp strike or crash in ${rs.length} seeds`);
        ok(rs.filter((r) => r.wire).length >= Math.ceil(rs.length * 0.25), `${m.id} (LSO pilot): traps in ${rate(rs, (r) => r.wire)} seeds (at least a quarter; the rest are bolters, which go around)`);
      } else ok(rs.some((r) => r.wire), `${m.id} (Autoland): traps in ${rate(rs, (r) => r.wire)} seeds, crashes in ${rate(rs, (r) => r.crashed)}`);
    } else if (pilot === 'hold') {
      ok(rs.every((r) => (r.crashed || !r.td || r.td.u < 0) && r.minGs < -80), `${m.id} (frozen attitude and power): the burst drives it far below the glidepath and it never lands on the runway (${rs.map((r) => r.minGs + ' m ' + (r.crashed ? 'crash' : r.td ? 'short' : 'no landing')).join(', ')})`);
    } else {
      ok(rs.every((r) => !r.crashed && r.td && r.td.u > -2 && r.td.u < SITES[base.site].runways[0].length), `${m.id} (${pilot}): every seed touches down on the runway without breaking (${rs.map((r) => r.td ? r.td.fpm + ' fpm' : '-').join(', ')})`);
      ok(rs.every((r) => r.wet), `${m.id}: the runway is wet`);
    }
  }
}
// what each storm mission must actually do to the pilot
{
  const mb = results['microburst/autoland'];
  ok(mb.every((r) => r.msgs.some((x) => x.startsWith('MICROBURST ALERT'))), `microburst: the tower calls the microburst alert ("${mb[0].said.find((x) => /Microburst/.test(x))}")`);
  const mbAt = SCENARIOS.find((s) => s.id === 'microburst').weather.events[0].u, nm = (-mbAt / 1852).toFixed(1);
  ok(mb.every((r) => r.msgs.some((x) => x.endsWith(` ${nm} MI FINAL`)) && r.said.some((x) => x.includes(`${nm} mile final`))), `microburst: the alert gives the distance in nautical miles, as the briefing does (${nm} mile final for ${-mbAt} m)`);
  ok(mb.every((r) => r.msgs.filter((x) => x === 'WINDSHEAR').length === 1 && r.said.some((s) => /Windshear, windshear/.test(s))), 'microburst: WINDSHEAR is shown and spoken, once, in every flight');
  ok(results['microburst/escape'].every((r) => r.escapes >= 1), 'microburst: the escape pilot flies the escape in every seed');
  const sq = results['squall/autoland'];
  ok(sq.every((r) => r.msgs.some((x) => /^WIND \d{3}\/20G30$/.test(x))), `squall: the tower gives the new wind (${sq[0].msgs.filter((x) => x.startsWith('WIND')).join(', ')})`);
  ok(sq.every((r) => !r.msgs.includes('WINDSHEAR')), 'squall: a gust front with a headwind gain is not a windshear warning');
  const th = results['thunder/autoland'];
  ok(th.every((r) => r.bumps > 0 && r.weather.state.strike > 0), `thunder: the bumps jolt the camera (${th.map((r) => r.bumps).join(', ')}) and the lightning strikes`);
  ok(results['night-storm/autoland'].every((r) => Math.abs(r.weather.carrier.seaState - 1.2) < 1e-9), 'night-storm: the sea is at 1.2');
}

// 8. The briefings and hints: tips name keys only where src/touch.js rewrites them for a phone; hints never throw.
{
  const { touchify } = await import('../src/touch.js');
  const KEYISH = /\((?:[A-Z]|Space|Q\/E|T\/Y)\)|\bpress [A-Z]\b|\bhold [A-Z]\b|\b[A-Z] for\b|\b[A-Z] twice\b/;
  const bad = [];
  for (const m of WEATHER_MISSIONS) for (const tip of m.tips) if (KEYISH.test(touchify(tip))) bad.push(`${m.id}: ${touchify(tip)}`);
  ok(!bad.length, `every key a storm tip names has a touch wording${bad.length ? ': ' + bad.join(' | ') : ''}`);
  let threw = null;
  for (const m of WEATHER_MISSIONS) {
    if (typeof m.hint !== 'function') continue;
    const base = SCENARIOS.find((s) => s.id === m.id);
    const sc = resolveScenario(base, makeRng(5), { approach: 'short' });
    const w = makeWorld(SITES[sc.site], sc);
    const wind = new Wind({ dir: 0, speed: 10, seed: 5 }); wind.groundY = w.runway ? w.runway.elevation : 0;
    const weather = new Weather(sc.weather, { seed: 5, wind, world: w, scenario: sc });
    const ac = { pos: new THREE.Vector3(0, 200, 3000), vel: new THREE.Vector3(0, -3, -70), ias: 70, radioAlt: 190, onGround: false, crashed: false, gload: 1, stats: {}, aero: { warning: false }, trap: {} };
    try { for (let t = 0; t < 60; t += 0.5) { weather.update(0.5, t, ac); m.hint({ mission: { weather }, ac, ra: 600, d: 3000, t }); } } catch (e) { threw = `${m.id}: ${e.message}`; }
  }
  ok(!threw, `the storm missions' hints run against a live weather without throwing${threw ? ' (' + threw + ')' : ''}`);
}

// 9. Roulette's "random weather" (scenarios.js resolveScenario): drawn after every other draw, so each spin's
// aircraft, field, time, wind, weight, failure and spawn are what they always were for that seed (and its visibility
// only ever comes down); no other challenge gains weather; and a weather spin is still flyable (Autoland, runway
// fields; this Node flight does not apply the spin's failure, the real build does).
{
  const base = SCENARIOS.find((s) => s.id === 'roulette');
  let same = true, got = 0;
  const kinds = {};
  for (let seed = 1; seed <= 300; seed++) {
    const a = resolveScenario(base, makeRng(seed), { approach: 'short' });
    const b = resolveScenario({ ...base, weather: { preset: 'clear' } }, makeRng(seed), { approach: 'short' });   // asks for its own: no draw
    for (const k of ['aircraft', 'site', 'time', 'weight', 'wind', 'failures', 'spawn']) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) same = false;
    if (a.vis > b.vis) same = false;
    if (a.weather) { got++; const k = a.weather.preset + (a.weather.events.length ? '+squall' : ''); kinds[k] = (kinds[k] || 0) + 1; }
  }
  ok(same, 'Roulette: the weather is drawn after everything else, so every spin keeps its aircraft, field, time, wind, weight, failure and spawn (300 seeds)');
  ok(got >= 100 && got <= 165, `Roulette: ${got} of 300 spins bring weather (${Object.entries(kinds).map(([k, n]) => k + ' ' + n).join(', ')})`);
  ok(SCENARIOS.filter((s) => s.id !== 'roulette' && !s.weather).every((s) => !resolveScenario(s, makeRng(7), {}).weather), 'no other challenge picks up weather it did not ask for');
  const spins = [];
  for (let seed = 1; spins.length < 6 && seed < 400; seed++) {
    const s = resolveScenario(base, makeRng(seed), { approach: 'short' });
    if (s.weather && SITES[s.site].kind === 'airport' && !spins.some((x) => x.w === s.weather.preset)) spins.push({ seed, w: s.weather.preset });
  }
  const rs = spins.map(({ seed }) => fly(base, seed));
  say(`  roulette     autoland ${rs.map((r, i) => `${r.seed} ${spins[i].w}: ${outcome(r)}`).join('; ')}`);
  ok(rs.every((r) => !r.crashed && r.td), `Roulette: a spin of each kind of weather lands on Autoland (${spins.map((x) => x.w).join(', ')})`);
}

// 10. The look (src/art/weather-look.js), in plain Node: what it builds for each kind of weather, the art bench's
// rules (named materials, at* uniforms only as the sky's own objects, the sky's cloud sheets hidden under a deck),
// that update() drives the light from the sky's values without drifting or toggling a light, the whiteout, the
// budget, determinism, and dispose(). The GPU half (does it compile, does it look right) is the stills' job.
{
  const { SkySystem } = await import('../src/art/sky.js');
  const { WeatherLook } = await import('../src/art/weather-look.js');
  const { clearExtinction } = await import('../src/art/world-atmosphere.js');
  const build = (spec, time = 14) => {
    const scene = new THREE.Scene();
    const renderer = { toneMapping: 0, toneMappingExposure: 1, domElement: { height: 900 } };
    const sky = new SkySystem(scene, renderer, { time, visibility: 5000, azimuth: 1, elevation: 0, cloudCover: 0.3, shadowSize: 4096 });
    const look = new WeatherLook(scene, { spec: resolveWeatherSpec(spec), sky });
    const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.3, 60000);
    return { scene, renderer, sky, look, camera };
  };
  const state = (over = {}) => {
    const wind = new Wind({ dir: 0, speed: 0, seed: 1 });
    const wx = new Weather({ preset: 'storm', lightning: 0.5, ...over }, { seed: 3, wind, world: { runway: null, carrier: null }, scenario: { vis: 5000 } });
    return wx;
  };
  const env = (b, camY = 100, mode = 'chase') => { b.camera.position.set(0, camY, 2000); return { camera: b.camera, t: 10, sky: b.sky, renderer: b.renderer, ac: { vel: new THREE.Vector3(0, -3, -70), ias: 70 }, cameraMode: mode }; };

  const storm = build({ preset: 'storm', rain: 0.8, darkness: 0.5, ceiling: 300, lightning: 0.5, cells: 3 });
  const names = storm.look.objects.map((o) => o.material.name).sort();
  ok(names.join() === ['weather/bolt', 'weather/deck', 'weather/glass', 'weather/rain', 'weather/shafts'].join(), `a storm builds rain, a deck, rain shafts, a bolt and windscreen drops, all named (${names.join(', ')})`);
  ok(storm.sky.clouds.length === 2 && storm.sky.clouds.every((c) => !c.mesh.visible), 'the storm deck replaces the sky\'s two cloud sheets (hidden), so there is never a third layer');
  let ownAt = [];
  for (const o of storm.look.objects) for (const k of Object.keys(o.material.uniforms)) {
    if (/^at[A-Z]/.test(k) && o.material.uniforms[k] !== storm.sky.uniforms[k]) ownAt.push(o.material.name + '.' + k);
    if (!/^(at[A-Z]|wx[A-Z])/.test(k)) ownAt.push(o.material.name + '.' + k + ' (not wx*)');
  }
  ok(!ownAt.length, `the look's uniforms are wx* of its own or the sky's own at* objects${ownAt.length ? ': ' + ownAt.join(', ') : ''}`);
  const tris = storm.look.objects.reduce((n, o) => n + (o.geometry.isInstancedBufferGeometry ? o.geometry.instanceCount * 2 : o.geometry.index.count / 3), 0);
  ok(storm.look.objects.length <= 5 && tris <= 60000 && storm.look.objects.every((o) => o.frustumCulled && o.geometry.boundingSphere), `the high tier's budget: ${storm.look.objects.length} draws, ${tris} triangles, every mesh culled against a real bounding sphere`);
  // light: the flash rises and falls back to exactly the storm's level; lights never change visibility
  const wx = state({ darkness: 0.5, ceiling: 300 });
  const vis0 = [storm.sky.sun.visible, storm.sky.moon.visible, storm.sky.hemi.visible].join();
  const e = env(storm);
  storm.look.update(1 / 25, wx.state, e);
  const calm = [storm.sky.sun.intensity, storm.sky.hemi.intensity, storm.renderer.toneMappingExposure];
  wx.state.flash = 1; storm.look.update(1 / 25, wx.state, e);
  const lit = [storm.sky.sun.intensity, storm.sky.hemi.intensity, storm.renderer.toneMappingExposure];
  wx.state.flash = 0; for (let i = 0; i < 50; i++) storm.look.update(1 / 25, wx.state, e);
  const after = [storm.sky.sun.intensity, storm.sky.hemi.intensity, storm.renderer.toneMappingExposure];
  ok(lit[1] > calm[1] && lit[2] > calm[2] && after.every((v, i) => v === calm[i]), `a flash lifts the hemisphere light and the exposure and they come back exactly (hemi ${calm[1].toFixed(3)} -> ${lit[1].toFixed(3)} -> ${after[1].toFixed(3)})`);
  ok(calm[0] < storm.look.base.sun * 0.5 && calm[0] > 0.002 && calm[2] < storm.look.base.exposure, `under the deck the sun is mostly gone but never off (${calm[0].toFixed(3)} of ${storm.look.base.sun.toFixed(3)}), and the exposure is down`);
  ok([storm.sky.sun.visible, storm.sky.moon.visible, storm.sky.hemi.visible].join() === vis0, 'update() never toggles a light\'s visibility (that would recompile every program)');
  // the whiteout: inside the cloud the shared extinction is the cloud's; below the ragged base it is the air's
  const weather0 = storm.look.base.weather;
  storm.look.update(0, wx.state, env(storm, wx.state.ceilingY + 60));
  const inCloud = storm.sky.uniforms.atExtinction.value, weatherIn = storm.sky.uniforms.atWeather.value;
  storm.look.update(0, wx.state, env(storm, wx.state.ceilingY - 120));
  const below = storm.sky.uniforms.atExtinction.value, weatherBelow = storm.sky.uniforms.atWeather.value;
  ok(Math.abs(inCloud - 3.912 / 140) < 1e-9 && Math.abs(below / clearExtinction(wx.state.vis) - 1) < 0.35, `inside the cloud the view closes to 140 m (${(3.912 / inCloud).toFixed(0)} m); 120 m under the base it is the air's again (${(3.912 / below).toFixed(0)} m)`);
  ok(weather0 < 0.9 && weatherIn === 1 && weatherBelow === weather0, `inside the cloud the airlight has no horizon step (atWeather ${weather0.toFixed(2)} -> ${weatherIn} -> ${weatherBelow.toFixed(2)} under the base)`);
  // through the tower's long lens no drop is close enough to be magnified across the picture: the near fade
  // (1.2-3.5 m at a normal lens) moves out past the rain's box; at a normal lens it stays where it was
  wx.state.rain = 0.8;
  const zoomAt = (fov) => { storm.camera.fov = fov; storm.look.update(0, wx.state, env(storm, 100, 'tower')); return storm.look.precip.uniforms.wxZoom.value; };
  const zTower = zoomAt(3.5), zChase = zoomAt(55), zWide = zoomAt(75);
  const ss = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  const B = storm.look.precip.K.box;
  let most = 0; for (let d = 0; d <= B; d += 0.25) most = Math.max(most, ss(1.2 * zTower, 3.5 * zTower, d) * (1 - ss(0.3 * B, 0.47 * B, d)));   // the shader's two fades
  ok(most < 0.03 && Math.abs(zChase - 1) < 1e-9 && zWide === 1, `rain through the tower's 3.5-degree lens: no drop in the ${B} m box keeps more than ${(most * 100).toFixed(1)} % of its alpha (zoom ${zTower.toFixed(1)}); at 55 and 75 degrees the near fade is unchanged`);
  storm.look.update(0, wx.state, env(storm, 100, 'cockpit'));
  const glass = storm.look.glass.mesh.visible;
  storm.look.update(0, wx.state, env(storm, 100, 'chase'));
  ok(glass && !storm.look.glass.mesh.visible, 'the windscreen drops show in the cockpit view only');
  // other kinds of weather
  const snow = build({ preset: 'snow' }), dust = build({ preset: 'dust' }), clear = build({ preset: 'clear' });
  ok(snow.look.objects.some((o) => o.name === 'weather/snow') && dust.look.objects.some((o) => o.name === 'weather/dust') && !dust.look.glass, 'snow builds flakes (and drops on the glass), dust builds a brown-out and no glass');
  ok(clear.look.objects.length === 0 && clear.sky.clouds.every((c) => c.mesh.visible), 'a clear spec builds nothing and leaves the sky alone');
  // determinism: two builds of the same spec are the same drops
  const again = build({ preset: 'storm', rain: 0.8, darkness: 0.5, ceiling: 300, lightning: 0.5, cells: 3 });
  const seeds = (b) => b.look.precip.mesh.geometry.attributes.aSeed.array;
  ok(seeds(storm).every((v, i) => v === seeds(again)[i]), 'the same spec builds the same rain, drop for drop');
  // dispose
  storm.look.dispose();
  ok(!storm.scene.children.some((o) => /^weather\//.test(o.name)), 'dispose() takes every weather mesh out of the scene');
}

console.log(fails ? `\n${fails} weather check(s) FAILED (${passes} passed)` : `\nall ${passes} weather checks passed`);
process.exit(fails ? 1 : 0);
