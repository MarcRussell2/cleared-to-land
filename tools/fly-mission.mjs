// Fly a mission to the end, headless, and print its debrief: the proof that a mission can be landed (and, with a
// bad route, that its obstacles are real). Two ways to fly it:
//
//   in the real page (default): boots this checkout's web/index.html (run `npm run web` first) in headless Edge,
//     pins the flight seed, freezes the game loop and steps game.frame(1/25) itself, with RoutePilot (when the
//     mission has a route) or Autoland on the controls - the game's own setAutopilot(true). The debrief's result
//     is captured from menus.showDebrief. Optional stills along the way, and every console error the page logged
//     (a shader that fails to compile is an object that is silently not drawn).
//   --node: the same flight in plain Node with the real physics, terrain, obstacle field, mission runtime and
//     pilots, but no renderer, no airport buildings and no HUD (the runway is a stand-in with the airport's
//     surface numbers). Seconds instead of a minute; tools/test-obstacles.mjs uses it (simulate() is exported).
//
// usage: node tools/fly-mission.mjs <id> [options]
//   --seed N          flight seed (default 307)
//   --pilot P         route (default: RoutePilot if the mission has a route, else Autoland) | autoland (drops the
//                     route: the straight-in path, obstacle-blind)
//   --route JSON      replace the mission's route, e.g. '[{"u":-400,"v":0,"alt":20}]' to fly level into the wires
//   --node            fly in Node (see above)
//   --max N           frames before giving up (default 12000, i.e. 8 minutes of sim time at 1/25 s)
//   --shot DIR        stills: DIR/<id>-<k>.png at each --at condition (browser mode)
//   --at EXPR         a still when EXPR becomes true; EXPR sees g, ac, u, v (runway frame), ra (ft), t;
//                     repeatable; "EXPR@camera" picks the camera (chase, cockpit, tower, flyby, wing)
//   --port N          Edge remote-debugging port (default 9811; this worktree's agents use 9800-9849)
//   --quality Q       high | medium | low (default high)
//   --size WxH        window size for stills (default 1600x900)
//   --json            print only the result JSON
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');

// ------------------------------------------------------------------ Node flight
export async function simulate(id, opts = {}) {
  const { installDomStub } = await import('./dom-stub.mjs');
  installDomStub();
  const THREE = await import('three');
  const { makeRng, KT, RAD, DEG, clamp } = await import('../src/config.js');
  const { SITES, SCENARIOS, siteFlats, resolveScenario } = await import('../src/systems/scenarios.js');
  const { Aircraft } = await import('../src/physics/aircraft.js');
  const { Wind } = await import('../src/physics/wind.js');
  const { AIRCRAFT } = await import('../src/aircraft/defs.js');
  const { Terrain } = await import('../src/world/terrain.js');
  const { ObstacleField } = await import('../src/world/obstacles.js');
  const { MissionRuntime } = await import('../src/systems/mission.js');
  const { RoutePilot } = await import('../src/systems/routepilot.js');
  const { Autoland } = await import('../src/systems/autopilot.js');
  const { scoreLanding, vrefFor } = await import('../src/systems/scoring.js');
  const { noise2 } = await import('../src/config.js');
  const seed = opts.seed || 307, dt = opts.dt || 1 / 25, maxFrames = opts.max || 12000;
  const base0 = SCENARIOS.find((s) => s.id === id);
  if (!base0) throw new Error('no mission ' + id);
  const base = { ...base0 };
  if (opts.route) base.route = opts.route;
  if (opts.pilot === 'autoland') delete base.route;
  const sc = resolveScenario(base, makeRng(seed), { approach: opts.approach || 'short' });
  const site = SITES[sc.site];
  if (!site.runways) throw new Error('simulate() flies runway sites only');
  const course = ObstacleField.plan(site, sc);
  const terrain = new Terrain({ ...site.terrain, flats: siteFlats(site), keepOut: course ? course.keepOut : null });
  // the runway as world/airport.js resolves it, and its ground query
  const d = site.runways[0], heading = d.heading * DEG;
  const dir = new THREE.Vector3(Math.sin(heading), 0, -Math.cos(heading)), right = new THREE.Vector3(-dir.z, 0, dir.x);
  const threshold = new THREE.Vector3(d.x, d.elevation, d.z), slope = d.slope || 0;
  const aimDistance = d.aimDistance || Math.min(400, d.length * 0.15);
  const aim = threshold.clone().addScaledVector(dir, aimDistance); aim.y = d.elevation + slope * aimDistance;
  const rw = { ...d, heading, dir, right, threshold, aim, aimDistance, slope, surface: d.surface || 'asphalt' };
  const runwayGround = (x, z, out) => {
    const dx = x - threshold.x, dz = z - threshold.z, u = dx * dir.x + dz * dir.z, v = dx * right.x + dz * right.z;
    if (u < -5 || u > rw.length + 5 || Math.abs(v) > rw.width / 2 + 1) return false;
    let y = rw.elevation + slope * u;
    out.n.set(0, 1, 0); if (slope) out.n.copy(dir).multiplyScalar(-slope).add(new THREE.Vector3(0, 1, 0)).normalize();
    out.vel.set(0, 0, 0);
    const s = rw.surface;
    if (s === 'asphalt') { out.mu = rw.wet ? 0.5 : 0.85; out.kind = 'runway'; out.rough = 0; }
    else if (s === 'gravel') { out.mu = 0.62; out.kind = 'gravel'; out.rough = 0.45; y += 0.035 * noise2(x * 1.7, z * 1.7, 3); }
    else if (s === 'sand') { out.mu = 0.5; out.kind = 'sand'; out.rough = 0.6; y += 0.05 * noise2(x * 1.2, z * 1.2, 5); }
    else { out.mu = 0.55; out.kind = 'dirt'; out.rough = 0.7; y += 0.06 * noise2(x * 1.5, z * 1.5, 4); }
    out.y = y; return true;
  };
  const ground = (x, z, out) => { if (!runwayGround(x, z, out)) terrain.ground(x, z, out); };
  const field = course ? new ObstacleField(course, { terrain, site }) : null;
  const world = { site, terrain, runway: rw, carrier: null, obstacles: field, ground };
  const def = AIRCRAFT[sc.aircraft];
  const ac = new Aircraft(def, { mass: def.massOptions[sc.weight] || def.mass });
  const wind = new Wind();
  const w = sc.wind;
  wind.set({ dir: w.dir != null ? w.dir : ((heading * RAD + (w.rel || 0)) + 720) % 360, speed: w.speed || 0, gust: w.gust, turb: w.turb || 0, shear: w.shear || 0, seed });
  wind.groundY = rw.elevation;
  const env = { wind: (p, t, o) => wind.at(p, t, o), ground, carrier: null };
  ac.stallSign = seed % 2 ? 1 : -1;
  // spawn: main.js spawn() for a runway site
  const sp = sc.spawn, dist = sp.dist || 5000, g0 = { y: 0, n: new THREE.Vector3(), vel: new THREE.Vector3() };
  const u0 = sp.u != null ? sp.u : -dist, v0 = sp.v != null ? sp.v : (sp.offset || 0);
  const pos = threshold.clone().addScaledVector(dir, u0).addScaledVector(right, v0);
  let hdg = heading; if (sp.hdg) hdg += sp.hdg * DEG;
  const gsAngle = (rw.gsAngle || (def.approach.glideslope * RAD)) * DEG;
  pos.y = aim.y + (aimDistance - u0) * Math.tan(gsAngle) + def.cgHeight;
  if (sp.alt != null) { ground(pos.x, pos.z, g0); pos.y = Math.max(g0.y, rw.elevation) + sp.alt; }
  ac.pos.copy(pos);
  ac.input.gearCmd = sp.gear === false ? 0 : 1; ac.ctl.gear = ac.input.gearCmd;
  const speed = (sp.speedKt || sc.scoring?.vref || def.speeds.Vref) * KT;
  const gamma = sp.gamma != null ? sp.gamma * DEG : sp.alt != null ? -1.5 * DEG : -gsAngle;
  ac.trim(hdg, speed, gamma, sp.flap ?? 0, wind.at(pos, 0, new THREE.Vector3()));
  for (const e of ac.engines) e.throttle = ac.input.throttle;
  if (def.spoilers && def.id === 'condor') ac.input.spoilerArmed = false;
  ac._derive();
  const mission = new MissionRuntime(sc, { world });
  if (field) field.reset(ac);
  const pilot = opts.pilot === 'none' ? null : sc.route ? new RoutePilot(ac, world, sc) : new Autoland(ac, world, sc);
  const ap = { gsErr: 0, locErr: 0, spdErr: 0, gsSamples: 0, tdU: 0, tdV: 0, stopU: 0, offRunway: false, overran: false, noseDownSpeed: null, runway: rw };
  const track = [];
  let t = 0, endT = 0, n = 0, hitName = null;
  for (; n < maxFrames; n++) {
    t += dt;
    if (pilot) pilot.update(dt);
    ac.step(dt, env);
    if (field && !ac.crashed) { const h = field.hit(ac); if (h) { hitName = h; ac.crash('Hit ' + h); } }
    for (const e of ac.events) if ((e.type === 'nosestrike' || e.type === 'belly') && ap.noseDownSpeed == null) ap.noseDownSpeed = ac.gs;
    ac.events.length = 0;
    mission.update(dt, t, ac);
    // approach log, as main.js logApproach()
    if (!ac.onGround && !ac.crashed) {
      const dx = ac.pos.x - threshold.x, dz = ac.pos.z - threshold.z, uu = dx * dir.x + dz * dir.z, vv = dx * right.x + dz * right.z;
      if (rw.ils) {
        const locDist = Math.max(50, rw.length + 300 - uu), gsDist = Math.max(20, aimDistance - uu), dist2 = aimDistance - uu;
        if (dist2 > 300 && dist2 < 3500) {
          const gsDots = (Math.atan2(ac.pos.y - aim.y, gsDist) * RAD - (rw.gsAngle || 3)) / 0.14, locDots = Math.atan2(vv, locDist) * RAD / 0.5;
          ap.gsErr += Math.abs(gsDots); ap.locErr += Math.abs(locDots); ap.gsSamples++; ap.spdErr += Math.abs(ac.ias - vrefFor(ac, sc) * KT);
        }
      } else if (uu < -100 && uu > -2500) {
        const gsRef = rw.gsAngle || def.approach.glideslope * RAD;
        ap.gsErr += Math.abs(Math.atan2(ac.pos.y - aim.y, aimDistance - uu) * RAD - gsRef) / 0.5; ap.locErr += Math.abs(Math.atan2(vv, aimDistance - uu) * RAD) / 0.8; ap.gsSamples++;
        ap.spdErr += Math.abs(ac.ias - vrefFor(ac, sc) * KT);
      }
    }
    if (opts.track && n % (opts.track | 0 || 25) === 0) {
      const dx = ac.pos.x - threshold.x, dz = ac.pos.z - threshold.z;
      track.push({ t: +t.toFixed(1), u: +(dx * dir.x + dz * dir.z).toFixed(0), v: +(dx * right.x + dz * right.z).toFixed(1), h: +(ac.pos.y - rw.elevation).toFixed(1), ra: +ac.radioAlt.toFixed(1), kt: +(ac.ias / KT).toFixed(0), bank: +(ac.euler.roll * RAD).toFixed(0), thr: +ac.input.throttle.toFixed(2), pitch: +(ac.euler.pitch * RAD).toFixed(1), aoa: +(ac.aero.alpha * RAD).toFixed(1), vs: +ac.vs.toFixed(1), phase: pilot && pilot.phase ? pilot.phase : '', ...(pilot && pilot.dbg && opts.debug ? { hDes: +(pilot.dbg.hDes - rw.elevation).toFixed(1), vsDes: +pilot.dbg.vsDes.toFixed(1), pCmd: +(pilot.dbg.pitchCmd * RAD).toFixed(1) } : {}) });
    }
    if (ac.crashed) { endT += dt; if (endT > 3.5) break; }
    else if (ac.stopped) { endT += dt; if (endT > 2) break; }
  }
  // finish, as main.js finish()
  const dx = ac.pos.x - threshold.x, dz = ac.pos.z - threshold.z;
  ap.stopU = dx * dir.x + dz * dir.z;
  const vEnd = dx * right.x + dz * right.z;
  if (ac.stats.touchdown && !ac.crashed) { if (ap.stopU > rw.length + 2) ap.overran = true; else if (Math.abs(vEnd) > rw.width / 2 + 1 || ap.stopU < -2) ap.offRunway = true; }
  if (ac.stats.touchdown) { const td = ac.stats.touchdown.pos; const tx = td.x - threshold.x, tz = td.z - threshold.z; ap.tdU = tx * dir.x + tz * dir.z; ap.tdV = tx * right.x + tz * right.z; }
  const result = mission.score(scoreLanding(ac, sc, ap), ac, ap);
  void clamp;
  return {
    id, seed, mode: 'node', pilot: pilot ? (pilot.constructor.name) : 'none', frames: n, t: +t.toFixed(1), crashed: ac.crashed, reason: ac.crashReason || '',
    hit: hitName, part: field && field.lastHit ? field.lastHit.part : null,
    points: result.points, grade: result.grade, headline: result.headline, lines: result.lines.map((l) => `${l.k}: ${l.v}`),
    gates: field ? field.gates.map((g) => `${g.name}: ${g.state}`) : [], closest: field && field.closestD < 1e8 ? `${field.closestD.toFixed(1)} m from ${field.closestName}` : null,
    touchdown: ac.stats.touchdown ? { u: +ap.tdU.toFixed(0), v: +ap.tdV.toFixed(1), fpm: Math.round(ac.stats.touchdown.vs / 0.00508), kt: Math.round(ac.stats.touchdown.ias / KT) } : null,
    track: opts.track ? track : undefined,
  };
}

// ------------------------------------------------------------------ the real page
async function flyInPage(id, o) {
  const html = `${ROOT}/web/index.html`;
  if (!existsSync(html)) throw new Error('no web/index.html: run `npm run web` first');
  const port = o.port || 9811;
  const dir = (process.env.CTL_MISSION_DIR || 'C:/tmp/ctl-m-obstacles').replace(/\\/g, '/');
  mkdirSync(dir, { recursive: true });
  const [W, H] = (o.size || '1600x900').split('x').map(Number);
  const profile = `${dir}/edge-fly-${port}`;
  const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--hide-scrollbars', '--allow-file-access-from-files', '--force-device-scale-factor=1',
    `--window-size=${W},${H}`, '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const logs = [];
  try {
    let page;
    for (let i = 0; i < 100 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch (e) { /* not up yet */ } if (!page) await sleep(200); }
    if (!page) throw new Error('Edge never offered a page on port ' + port);
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let mid = 0; const pend = new Map();
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
      else if (d.method === 'Runtime.consoleAPICalled' && /error|warn/.test(d.params.type)) logs.push(d.params.type + ': ' + d.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 400));
      else if (d.method === 'Runtime.exceptionThrown') logs.push('exception: ' + JSON.stringify(d.params.exceptionDetails).slice(0, 400));
    };
    const send = (method, params = {}) => new Promise((r) => { const i = ++mid; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 800)); return r.result?.result?.value; };
    await send('Page.enable'); await send('Runtime.enable');
    const settings = { quality: o.quality || 'high', sensitivity: 1, mouseSens: 0.5, volume: 0, voice: false, hints: true, invert: false, camera: 'chase', approach: 'short', autoTrim: true, keyStrip: true, touch: 'off', autoQuality: false };
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('ctl.settings', ${JSON.stringify(JSON.stringify(settings))}); localStorage.setItem('ctl.best', '{}'); } catch (e) {} window.CTL_WIND_SEED = ${o.seed || 307};` });
    await send('Page.navigate', { url: pathToFileURL(html).href });
    for (let i = 0; i < 200; i++) { if (await ev('!!(window.game && window.G)')) break; await sleep(100); }
    await sleep(1200);
    const route = o.route ? JSON.stringify(o.route) : 'null';
    await ev(`(() => { const g = window.game; g.loop = function(){};
      const o = g.menus.showDebrief.bind(g.menus); g.menus.showDebrief = (r, sc, st) => { window.__result = r; o(r, sc, st); };
      const base = G.SCENARIOS.find((s) => s.id === ${JSON.stringify(id)}); if (!base) throw new Error('no mission ${id}');
      const sc = { ...base }; const R = ${route}; if (R) sc.route = R; if (${JSON.stringify(o.pilot || '')} === 'autoland') delete sc.route;
      window.__result = null; g.startScenario(sc); g.compiling = false;
      if (${JSON.stringify(o.pilot || '')} !== 'none') g.setAutopilot(true);
      const rw = g.world.runway;
      window.__uv = () => { const dx = g.ac.pos.x - rw.threshold.x, dz = g.ac.pos.z - rw.threshold.z; return [dx * rw.dir.x + dz * rw.dir.z, dx * rw.right.x + dz * rw.right.z]; };
      return true; })()`);
    const shots = (o.at || []).map((a, k) => { const [expr, cam] = a.split('@'); return { expr, cam, k, done: false }; });
    let frames = 0; const max = o.max || 12000;
    const stills = [];
    while (frames < max) {
      const next = shots.find((s) => !s.done);
      const cond = next ? next.expr : 'false';
      const r = await ev(`(() => { const g = window.game, f = new Function('g','ac','u','v','ra','t', 'return (' + ${JSON.stringify(cond)} + ')');
        for (let i = 0; i < 400; i++) { if (g.state !== 'flying') return { n: i, state: g.state, hit: false };
          g.frame(1/25); const ac = g.ac, uv = window.__uv();
          if (f(g, ac, uv[0], uv[1], ac.radioAlt / 0.3048, g.t)) return { n: i + 1, state: g.state, hit: true }; }
        return { n: 400, state: g.state, hit: false }; })()`);
      frames += r.n;
      if (r.hit && next) {
        next.done = true;
        if (o.shot) {
          mkdirSync(o.shot, { recursive: true });
          if (next.cam) await ev(`window.game.rig.setMode(${JSON.stringify(next.cam)}); for (let i = 0; i < 25; i++) window.game.rig.update(1/25, window.game.ac, window.game.world); true`);
          await ev('window.game.render(); true');
          const shot = await send('Page.captureScreenshot', { format: 'png' });
          const file = `${o.shot}/${id}-${next.k}${next.cam ? '-' + next.cam : ''}.png`;
          writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
          const info = await ev(`(() => { const g = window.game, i = g.renderer.info.render, uv = window.__uv(); return { calls: i.calls, tris: i.triangles, programs: g.renderer.info.programs.length, u: Math.round(uv[0]), v: +uv[1].toFixed(1), h: +(g.ac.pos.y - g.world.runway.elevation).toFixed(1) }; })()`);
          stills.push({ file, ...info });
          if (next.cam) await ev(`window.game.rig.setMode('chase'); true`);
        }
        continue;
      }
      if (r.state !== 'flying') break;
    }
    // the debrief backdrop runs until finish(); step the background a little so the result is in
    for (let i = 0; i < 10 && !(await ev('!!window.__result')); i++) await ev('window.game.frameBackground && window.game.state === "debrief" ? 0 : 0');
    const res = await ev(`(() => { const g = window.game, ac = g.ac, r = window.__result, f = g.world.obstacles;
      return { frames: ${frames}, state: g.state, t: +g.t.toFixed(1), crashed: ac.crashed, reason: ac.crashReason || '', part: f && f.lastHit ? f.lastHit.part : null,
        points: r && r.points, grade: r && r.grade, headline: r && r.headline, lines: r ? r.lines.map((l) => l.k + ': ' + l.v) : null,
        gates: f ? f.gates.map((x) => x.name + ': ' + x.state) : [], closest: f && f.closestD < 1e8 ? f.closestD.toFixed(1) + ' m from ' + f.closestName : null,
        pilot: g.ap ? g.ap.constructor.name + (g.ap.phase ? '/' + g.ap.phase : '') : 'none', status: g.statusLine() }; })()`);
    return { id, seed: o.seed || 307, mode: 'page', ...res, stills, console: logs.slice(0, 30) };
  } finally {
    killEdge(edge.pid, profile);
  }
}

// Stop the headless Edge this run started, and nothing else: msedge.exe hands its work to a child and the launcher
// can exit, so the tree is found again by its own profile directory (unique to this run's port) as well as by PID.
function killEdge(pid, profile) {
  try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* already gone */ }
  const dir = profile.replace(/\//g, '\\');
  const ps = `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${profile}*' -or $_.CommandLine -like '*${dir}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  try { execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' }); } catch (e) { /* nothing left */ }
}

// ------------------------------------------------------------------ command line
async function main() {
  const args = process.argv.slice(2);
  const id = args[0];
  if (!id || id.startsWith('--')) { console.log('usage: node tools/fly-mission.mjs <mission id> [--node] [--seed N] [--pilot route|autoland|none] [--route JSON] [--shot DIR --at EXPR[@camera]...] [--port N]'); process.exit(2); }
  const o = { at: [] };
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === '--node') o.node = true;
    else if (a === '--json') o.json = true;
    else if (a === '--seed') o.seed = +args[++i];
    else if (a === '--pilot') o.pilot = args[++i];
    else if (a === '--route') o.route = JSON.parse(args[++i]);
    else if (a === '--max') o.max = +args[++i];
    else if (a === '--shot') o.shot = args[++i];
    else if (a === '--at') o.at.push(args[++i]);
    else if (a === '--port') o.port = +args[++i];
    else if (a === '--quality') o.quality = args[++i];
    else if (a === '--size') o.size = args[++i];
    else if (a === '--track') o.track = +args[++i];
  }
  if (!o.node && existsSync(`${ROOT}/web/index.html`)) {
    const age = (Date.now() - statSync(`${ROOT}/web/index.html`).mtimeMs) / 60000;
    if (age > 60 && !o.json) console.log(`(web/index.html is ${Math.round(age)} min old: run npm run web if src/ changed since)`);
  }
  const r = o.node ? await simulate(id, o) : await flyInPage(id, o);
  if (o.json) console.log(JSON.stringify(r));
  else {
    const { lines, track, stills, console: con, ...head } = r;
    console.log(JSON.stringify(head));
    if (lines) for (const l of lines) console.log('   ' + l);
    if (stills && stills.length) for (const s of stills) console.log('   still ' + JSON.stringify(s));
    if (track) for (const p of track) console.log('   ' + JSON.stringify(p));
    if (con && con.length) console.log('CONSOLE:\n' + con.join('\n'));
  }
  process.exit(0);
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); process.exit(1); });
