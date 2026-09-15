// One driven still of CLEARED TO LAND with forced control deflection, orbit angle, head turn or a debug camera.
// A copy of the website repo's tools/ctl-shots/surfshot.mjs (2026-09-14) with three additions for
// the aircraft-visuals work: after the camera mode is set it feeds the cockpit interior its state and
// hides the fuselage the way the game loop does, it prints renderer.info (draw calls, triangles) so the
// aircraft and cockpit budgets can be read off a still, and it prints every console error the page
// logged (a shader that fails to compile is an aircraft that is simply not drawn).
//
// usage: node tools/surfshot.mjs <name> <out.png> "<until expr>" <maxFrames> '<json opts>' [port]
//   opts: { deflect: true, cam: [x,y,z], look: [x,y,z], orbitYaw: rad, orbitPitch: rad, zoom: k, mode: 'chase',
//           headYaw: rad, headPitch: rad, elevator, aileron, rudder, flap, spoiler, throttle }
//   cam/look are in the airplane's body frame (x right, y up, z back), metres.
//   The page <name>.html is made by the website repo's make.mjs (with "drive":true) in CTL_SHOTS_DIR.
import { writeFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
const [name, out, until, maxS, optsS = '{}', portS = '9661'] = process.argv.slice(2);
const O = JSON.parse(optsS);
const S = process.env.CTL_SHOTS_DIR || 'C:/tmp/ctl-shots';
const port = +portS;
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new', '--hide-scrollbars', '--allow-file-access-from-files', '--force-device-scale-factor=1',
  '--window-size=1600,900', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${port}`,
  `--user-data-dir=${S}/edge-profile-${port}`, `file:///${S}/${name}.html`], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function targets() { for (let i = 0; i < 100; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json`); return await r.json(); } catch (e) { await sleep(200); } } throw new Error('devtools endpoint never came up'); }
try {
  let page; for (let i = 0; i < 50 && !page; i++) { page = (await targets()).find((t) => t.type === 'page' && t.url.includes(name)); if (!page) await sleep(200); }
  if (!page) throw new Error('page target not found');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const errors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || d.params.type === 'warning')) errors.push(d.params.type + ': ' + d.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    if (d.method === 'Runtime.exceptionThrown') errors.push('exception: ' + JSON.stringify(d.params.exceptionDetails).slice(0, 300));
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error('page error: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 500)); return r.result?.result?.value; };
  await send('Page.enable'); await send('Runtime.enable');
  let ready = false;
  for (let i = 0; i < 300; i++) { if (await evalJs('!!(window.__shot && window.__shot.ready)')) { ready = true; break; } await sleep(100); }
  if (!ready) throw new Error('game never became ready');
  await sleep(1500);
  const hit = await evalJs(`window.__runUntil(${JSON.stringify(until)}, ${+maxS})`);
  const setup = `(() => {
    const g = window.game, ac = g.ac, O = ${JSON.stringify(O)};
    if (O.deflect) { ac.ctl.elevator = O.elevator ?? 0.9; ac.ctl.aileron = O.aileron ?? 0.9; ac.ctl.rudder = O.rudder ?? 0.8; ac.ctl.flap = O.flap ?? 1; if (ac.def.spoilers) ac.ctl.spoiler = O.spoiler ?? 1; }
    if (O.throttle != null) { ac.input.throttle = O.throttle; for (const e of ac.engines) e.throttle = O.throttle; }
    if (O.mode) g.rig.setMode(O.mode);
    if (O.orbitYaw != null) g.rig.orbitYaw = O.orbitYaw;
    if (O.orbitPitch != null) g.rig.orbitPitch = O.orbitPitch;
    if (O.zoom != null) g.rig.orbitZoom = O.zoom;
    if (O.headYaw != null) g.rig.headYaw = O.headYaw;
    if (O.headPitch != null) g.rig.headPitch = O.headPitch;
    if (O.cam) { g.rig.mode = 'debug'; g.rig.debugOffset = ac.pos.clone().set(O.cam[0], O.cam[1], O.cam[2]); g.rig.debugLook = ac.pos.clone().set(...(O.look || [0, 0, 0])); }
    g.model.update(ac, 0);
    g.rig.initialized = false;
    for (let i = 0; i < 3; i++) g.rig.update(0.05, ac, g.world);
    // the game loop's cockpit housekeeping, for a mode set after the loop was frozen
    g.model.setCockpitView(g.rig.mode === 'cockpit');
    if (g.cockpitView) g.cockpitView.update(0.04, ac, g.rig, g.world, {});
    // renderer.info resets on every render() call and the composer makes several per frame: count the whole frame
    g.renderer.info.autoReset = false; g.renderer.info.reset();
    g.render();
    const info = { calls: g.renderer.info.render.calls, triangles: g.renderer.info.render.triangles };   // a snapshot: an eval may render again
    g.renderer.info.autoReset = true;
    const s = g.rig.mode + ' ctl e=' + ac.ctl.elevator.toFixed(2) + ' a=' + ac.ctl.aileron.toFixed(2) + ' r=' + ac.ctl.rudder.toFixed(2) + ' f=' + ac.ctl.flap.toFixed(2);
    const gl = g.model.gltfRoot ? 'gltf loaded' : (g.model.procedural ? 'procedural' : 'NO gltf');
    // per-group accounting: visible meshes (= draw calls, one material each) and triangles
    const count = (root) => { let calls = 0, tris = 0; if (!root) return 'n/a'; root.updateMatrixWorld(true); root.traverse((o) => { if (!o.visible) return; if (o.isMesh && o.geometry) { let vis = true; for (let p = o; p; p = p.parent) if (!p.visible) { vis = false; break; } if (!vis) return; calls += Array.isArray(o.material) ? o.material.length : 1; const ge = o.geometry; tris += ge.index ? ge.index.count / 3 : ge.attributes.position.count / 3; } }); return calls + ' calls / ' + Math.round(tris) + ' tris'; };
    const acct = ' | aircraft ' + count(g.model.group) + (g.cockpitView && g.cockpitView.cockpit && g.cockpitView.cockpit.group.visible ? ' | cockpit ' + count(g.cockpitView.cockpit.group) : '');
    const extra = O.eval ? ' | eval: ' + String(new Function('g', 'ac', O.eval)(g, ac)) : '';
    return s + ' | ' + gl + ' | frame: ' + info.calls + ' calls, ' + info.triangles + ' tris' + acct + extra + ' | build ' + (document.querySelector('meta[name=ctl-build]') || {}).content;
  })()`;
  const state = await evalJs(setup);
  await sleep(200);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (!shot.result?.data) throw new Error('screenshot failed: ' + JSON.stringify(shot).slice(0, 200));
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log(`[${name}] condition hit at frame ${hit}; ${state}; wrote ${out}`);
  if (errors.length) { console.log(`[${name}] ${errors.length} console error(s):`); for (const e of errors.slice(0, 12)) console.log('   ' + e); }
  else console.log(`[${name}] console clean`);
  ws.close();
} finally {
  try { execFileSync('taskkill', ['/F', '/T', '/PID', String(edge.pid)], { stdio: 'ignore' }); } catch { edge.kill(); }
}
