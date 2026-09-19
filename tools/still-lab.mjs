// One look-sheet scene, rendered with an experiment applied: drive the packaged
// game to the scene's frame, run a snippet of JavaScript in the page (turn the
// composer off, change the exposure, zero a uniform, hide an object...), render
// once more and screenshot. For finding out WHICH part of the pipeline makes a
// scene look the way it does, without touching the source.
//
//   node tools/still-lab.mjs <shotId> <out.png> "<js run before the final render>" [port]
//
// e.g.  node tools/still-lab.mjs tower lab-nobloom.png "game.useComposer=false"
//       node tools/still-lab.mjs tower lab-noext.png "game.world.sky.uniforms.atExtinction.value=0"
//
// The snippet sees `game` (window.game). Env as world-probe.mjs (CTL_WEB_DIR,
// CTL_PROBE_DIR); the driven page is written the same way, same wind seed.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = {
  menu: ['menu', null, null, 0], 'day-final': ['solo', 'chase', 'ra < 220', 2600], 'day-flare': ['solo', 'chase', 'ra < 8', 3200],
  cockpit: ['solo', 'cockpit', 'ra < 300', 2600], coast: ['heavy', 'chase', 'ra < 700', 2600], tower: ['gusty', 'tower', 'ra < 400', 2600],
  'carrier-day': ['cq', 'flyby', 'ra < 300', 2600], 'carrier-nite': ['night', 'chase', 'ra < 400', 2600], mountain: ['gravel', 'chase', 'ra < 260', 3200],
  ridge: ['oneway', 'wing', 'ra < 350', 2600], fog: ['fog', 'chase', 'ra < 500', 2600],
};
const [sid, out, snippet = '', portS = '12436'] = process.argv.slice(2);
if (!SHOTS[sid] || !out) { console.error('usage: node tools/still-lab.mjs <shotId> <out.png> "<js>" [port]'); process.exit(2); }
const [scenario, camera, until, max] = SHOTS[sid];
const S = (process.env.CTL_PROBE_DIR || 'C:/tmp/ctl-probe').replace(/\\/g, '/');
const GAME = (process.env.CTL_WEB_DIR || join(ROOT, 'web')).replace(/\\/g, '/');
const port = +portS;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(S, { recursive: true });

const name = `lab-${sid}`;
{
  let html = readFileSync(`${GAME}/index.html`, 'utf8');
  html = html.replaceAll('url(fonts/', `url(file:///${GAME.replace(/ /g, '%20')}/fonts/`);
  const P = { scenario, camera };
  const inject = [
    '<script>', '(function(){', `  const P = ${JSON.stringify(P)};`,
    "  const s = {quality:'high',sensitivity:1,mouseSens:0.5,volume:0,voice:false,hints:false,invert:false,camera:P.camera||'chase',approach:'medium',autoTrim:true,keyStrip:false};",
    "  localStorage.setItem('ctl.settings', JSON.stringify(s)); localStorage.setItem('ctl.best', JSON.stringify({}));",
    '  window.CTL_WIND_SEED = 4271; window.__shot = {ready:false};',
    '  const step = (g) => { const dt = 1/25;',
    "    window.__advance = function(n, render) { for (let i = 0; i < n; i++) { if (g.state === 'flying') g.frame(dt); else if (g.state === 'debrief' && g.ac) g.frameBackground(dt); } if (render !== false) g.render(); };",
    "    window.__runUntil = function(expr, max) { const f = new Function('g','ac','ra','d','t', 'return (' + expr + ')'); for (let i = 0; i < max; i++) { window.__advance(1, false); const ac = g.ac; if (!ac) continue; const ra = ac.radioAlt / 0.3048; const d = g.distToThreshold ? g.distToThreshold() : 0; if (f(g, ac, ra, d, g.t)) { g.render(); return i; } } g.render(); return -1; };",
    '  };',
    '  const iv = setInterval(() => {',
    "    const g = window.game; if (!g || !window.G || document.readyState !== 'complete') return;",
    '    clearInterval(iv); g.loop = function(){};',
    "    if (P.scenario && P.scenario !== 'menu') { g.startScenario(window.G.SCENARIOS.find(x => x.id === P.scenario)); g.setAutopilot(true); if (P.camera) g.rig.setMode(P.camera); }",
    "    else { g.world.sky.update(g.camera.position, 1/25); if (g.world.terrain.water) g.world.terrain.water.tick(1/25); }",
    '    step(g); window.__shot.ready = true;',
    '  }, 50);', '})();', '</script>',
  ].join('\n');
  writeFileSync(`${S}/${name}.html`, html.replace('<body>', '<body>\n' + inject));
}

const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new', '--mute-audio', '--hide-scrollbars', '--allow-file-access-from-files', '--force-device-scale-factor=1',
  '--window-size=1920,1080', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${port}`,
  `--user-data-dir=${S}/edge-profile-${port}`, `file:///${S}/${name}.html`], { stdio: 'ignore' });
try {
  let page;
  for (let i = 0; i < 120 && !page; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); page = list.find((t) => t.type === 'page' && t.url.includes(name)); } catch { /* not yet */ }
    if (!page) await sleep(200);
  }
  if (!page) throw new Error('devtools endpoint never came up');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const log = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') log.push(d.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)); };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error('page error: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result?.result?.value; };
  await send('Page.enable'); await send('Runtime.enable');
  for (let i = 0; i < 400; i++) { if (await evalJs('!!(window.__shot && window.__shot.ready)')) break; await sleep(100); }
  for (let i = 0; i < 40; i++) { if (await evalJs("(() => { const g = window.game; return !g || !g.model || !!g.model.gltfRoot || (g.ac && g.ac.def.id === 'hornet'); })()")) break; await sleep(100); }
  await sleep(300);
  if (until) { const hit = await evalJs(`window.__runUntil(${JSON.stringify(until)}, ${max})`); if (hit < 0) console.warn(`  ! condition never held in ${max} frames`); }
  const result = await evalJs(`(() => { const game = window.game; const r = (function(){ ${snippet} })(); game.render(); return r === undefined ? 'ok' : JSON.stringify(r); })()`);
  await sleep(200);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log(`[${sid}] snippet -> ${result}; wrote ${out}${log.length ? '\n  errors: ' + log.join(' | ') : ''}`);
  ws.close();
} finally {
  try { execFileSync('taskkill', ['/F', '/T', '/PID', String(edge.pid)], { stdio: 'ignore' }); } catch { edge.kill(); }
}
