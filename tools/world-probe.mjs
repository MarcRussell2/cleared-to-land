// Per-scene render cost and shader health, measured in the real page.
//
// The look sheet (the website repo's tools/ctl-shots/looksheet.mjs) shows what a
// scene looks like; this prints what it costs. For each of the same eleven scenes it
// drives the packaged game in headless Edge over the DevTools protocol to the same
// frame, then reads `renderer.info` for one full frame (the composer: scene + shadow
// pass + bloom + output) and for the scene alone (renderer.render of the world with
// no post-processing), lists the shader programs, and reports everything the page
// logged - three.js prints shader compile failures with console.error, and the art
// tests in Node cannot see those.
//
//   node tools/world-probe.mjs <out.json> [shotId ...]     (no ids = every scene)
//
// Env: CTL_WEB_DIR     the packaged game (default: this checkout's web/)
//      CTL_PROBE_DIR   scratch for the driven pages (default C:/tmp/ctl-probe)
//      CTL_PROBE_PORT  first debugging port (default 12420; one port per scene)
//      CTL_PROBE_QUALITY  the tier to run at: high (default), medium or low
//
// The driven page is the look sheet's: same settings, same wind seed, same stepping,
// so the numbers belong to the pictures on the sheet. Read `scene.calls` and
// `scene.triangles` against the budget in docs/CHANGELOG.md (the world pass) or
// docs/PERF.md when the performance branch lands.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = [
  ['menu',         'menu',    null,      null,          0],
  ['day-final',    'solo',    'chase',   'ra < 220',    2600],
  ['day-flare',    'solo',    'chase',   'ra < 8',      3200],
  ['cockpit',      'solo',    'cockpit', 'ra < 300',    2600],
  ['coast',        'heavy',   'chase',   'ra < 700',    2600],
  ['tower',        'gusty',   'tower',   'ra < 400',    2600],
  ['carrier-day',  'cq',      'flyby',   'ra < 300',    2600],
  ['carrier-nite', 'night',   'chase',   'ra < 400',    2600],
  ['mountain',     'gravel',  'chase',   'ra < 260',    3200],
  ['ridge',        'oneway',  'wing',    'ra < 350',    2600],
  ['fog',          'fog',     'chase',   'ra < 500',    2600],
];

const S = (process.env.CTL_PROBE_DIR || 'C:/tmp/ctl-probe').replace(/\\/g, '/');
const GAME = (process.env.CTL_WEB_DIR || join(ROOT, 'web')).replace(/\\/g, '/');
const PORT0 = +(process.env.CTL_PROBE_PORT || 12420);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const out = (process.argv[2] || 'world-probe.json').replace(/\\/g, '/');
const want = process.argv.slice(3);
const shots = want.length ? SHOTS.filter((s) => want.includes(s[0])) : SHOTS;
mkdirSync(S, { recursive: true });

function writePage(name, P) {
  let html = readFileSync(`${GAME}/index.html`, 'utf8');
  html = html.replaceAll('url(fonts/', `url(file:///${GAME.replace(/ /g, '%20')}/fonts/`);
  const inject = [
    '<script>',
    '(function(){',
    `  const P = ${JSON.stringify(P)};`,
    `  const s = {quality:${JSON.stringify(process.env.CTL_PROBE_QUALITY || 'high')},sensitivity:1,mouseSens:0.5,volume:0,voice:false,hints:false,invert:false,camera:P.camera||'chase',approach:'medium',autoTrim:true,keyStrip:false};`,
    "  localStorage.setItem('ctl.settings', JSON.stringify(s));",
    "  localStorage.setItem('ctl.best', JSON.stringify({}));",
    '  window.CTL_WIND_SEED = 4271;',
    '  window.__shot = {ready:false};',
    '  const step = (g) => { const dt = 1/25;',
    "    window.__advance = function(n, render) { for (let i = 0; i < n; i++) { if (g.state === 'flying') g.frame(dt); else if (g.state === 'debrief' && g.ac) g.frameBackground(dt); } if (render !== false) g.render(); };",
    "    window.__step = function(n) { window.__advance(n, true); return g.state + ' t=' + g.t.toFixed(2) + ' ra=' + (g.ac ? (g.ac.radioAlt/0.3048).toFixed(0) : '-'); };",
    "    window.__runUntil = function(expr, max) { const f = new Function('g','ac','ra','d','t', 'return (' + expr + ')'); for (let i = 0; i < max; i++) { window.__advance(1, false); const ac = g.ac; if (!ac) continue; const ra = ac.radioAlt / 0.3048; const d = g.distToThreshold ? g.distToThreshold() : 0; if (f(g, ac, ra, d, g.t)) { g.render(); return i; } } g.render(); return -1; };",
    '  };',
    '  const iv = setInterval(() => {',
    "    const g = window.game; if (!g || !window.G || document.readyState !== 'complete') return;",
    '    clearInterval(iv);',
    '    g.loop = function(){};',
    "    if (P.scenario && P.scenario !== 'menu') {",
    '      g.startScenario(window.G.SCENARIOS.find(x => x.id === P.scenario));',
    '      g.setAutopilot(true);',
    '      if (P.camera) g.rig.setMode(P.camera);',
    '    }',
    // The menu backdrop is normally kept alive by the game loop (sun placed at the
    // camera, fog installed on the first update); with the loop frozen that never
    // happens, so give the menu scene the one update the loop would have given it.
    "    if (!P.scenario || P.scenario === 'menu') { g.world.sky.update(g.camera.position, 1/25); if (g.world.terrain.water) g.world.terrain.water.tick(1/25); if (g.world.airport) g.world.airport.update(1/25, g.camera.position, g.wind, 0); }",
    '    step(g);',
    '    window.__shot.ready = true;',
    '  }, 50);',
    '})();',
    '</script>',
  ].join('\n');
  writeFileSync(`${S}/${name}.html`, html.replace('<body>', '<body>\n' + inject));
}

// Runs in the page: one full frame and one bare scene render, each with the counters reset.
const PROBE = `(() => {
  const g = window.game, r = g.renderer, info = r.info;
  const gl = r.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
  info.autoReset = false;
  const grab = () => ({ calls: info.render.calls, triangles: info.render.triangles, points: info.render.points, lines: info.render.lines });
  info.reset(); g.render(); const frame = grab();
  info.reset(); r.render(g.scene, g.camera); const scene = grab();
  info.autoReset = true;
  // Wall-clock cost of the scene alone, best of a few; only meaningful on a real GPU.
  let best = 1e9;
  for (let i = 0; i < 6; i++) { const t0 = performance.now(); r.render(g.scene, g.camera); gl.finish(); best = Math.min(best, performance.now() - t0); }
  let objects = 0, meshes = 0, instanced = 0, instances = 0, shadowCasters = 0, transparent = 0;
  g.scene.traverse((o) => { objects++; if (o.isMesh || o.isPoints || o.isLine) { meshes++; if (o.castShadow) shadowCasters++; const m = Array.isArray(o.material) ? o.material[0] : o.material; if (m && m.transparent) transparent++; } if (o.isInstancedMesh) { instanced++; instances += o.count; } });
  // Where the draws come from: renderables under each direct child of the scene
  // (the terrain group, the aerodrome group, the ship, the airplane, the sky...).
  const breakdown = {};
  const w = g.world || {};
  const roots = [['terrain', w.terrain && w.terrain.group], ['airport', w.airport && w.airport.group], ['carrier', w.carrier && w.carrier.group],
    ['aircraft', g.model && g.model.group], ['sky', w.sky && w.sky.sky], ['clouds+stars', null]];
  const named = new Set(roots.map((r) => r[1]).filter(Boolean));
  for (const [label, root] of roots) {
    const child = root || { traverse(fn) { for (const c of g.scene.children) if (!named.has(c)) c.traverse(fn); } };
    let n = 0, tris = 0, casters = 0, inst = 0;
    child.traverse((o) => {
      if (!(o.isMesh || o.isPoints || o.isLine) || !o.visible) return;
      const geo = o.geometry; if (!geo) return;
      const count = geo.index ? geo.index.count : geo.attributes.position ? geo.attributes.position.count : 0;
      const per = o.isMesh ? count / 3 : 0;
      const k = o.isInstancedMesh ? o.count : 1;
      n++; tris += per * k; if (o.castShadow) casters++; if (o.isInstancedMesh) inst += o.count;
    });
    breakdown[label] = { draws: n, tris: Math.round(tris), casters, instances: inst };
  }
  return { gpu, frame, scene, sceneMs: +best.toFixed(2), programs: info.programs.length, geometries: info.memory.geometries, textures: info.memory.textures,
    objects, meshes, instanced, instances, shadowCasters, transparent, breakdown,
    trees: g.world && g.world.terrain ? g.world.terrain.treeCount : 0,
    quality: g.settings.quality, dpr: r.getPixelRatio(), size: [r.domElement.width, r.domElement.height] };
})()`;

async function probe(name, until, max, port) {
  const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
    '--headless=new', '--hide-scrollbars', '--allow-file-access-from-files', '--force-device-scale-factor=1',
    '--window-size=1920,1080', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${port}`,
    `--user-data-dir=${S}/edge-profile-${port}`, `file:///${S}/${name}.html`], { stdio: 'ignore' });
  const log = [];
  try {
    let page;
    for (let i = 0; i < 120 && !page; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
        page = list.find((t) => t.type === 'page' && t.url.includes(name));
      } catch { /* not listening yet */ }
      if (!page) await sleep(200);
    }
    if (!page) throw new Error('devtools endpoint never came up');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0;
    const pending = new Map();
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
      if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || d.params.type === 'warning')) {
        const text = d.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
        if (/ERR_FILE_NOT_FOUND/.test(text)) return;   // the driven page's favicon/manifest, not the game
        log.push({ level: d.params.type, text: d.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300) });
      } else if (d.method === 'Runtime.exceptionThrown') {
        log.push({ level: 'exception', text: (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').slice(0, 300) });
      } else if (d.method === 'Log.entryAdded' && (d.params.entry.level === 'error' || d.params.entry.level === 'warning')) {
        if (/ERR_FILE_NOT_FOUND/.test(d.params.entry.text)) return;
        log.push({ level: d.params.entry.level, text: d.params.entry.text.slice(0, 300) });
      }
    };
    const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    const evalJs = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) throw new Error('page error: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
      return r.result?.result?.value;
    };
    await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
    for (let i = 0; i < 400; i++) { if (await evalJs('!!(window.__shot && window.__shot.ready)')) break; await sleep(100); }
    let state = 'menu';
    if (until) {
      const hit = await evalJs(`window.__runUntil(${JSON.stringify(until)}, ${max})`);
      if (hit < 0) console.warn(`  ! ${name}: condition never held in ${max} frames`);
      state = await evalJs('window.__step(0)');
    } else { await sleep(1200); await evalJs('window.game.render(); 1'); }
    const r = await evalJs(PROBE);
    await sleep(200);
    ws.close();
    return { state, ...r, log };
  } finally {
    try { execFileSync('taskkill', ['/F', '/T', '/PID', String(edge.pid)], { stdio: 'ignore' }); } catch { edge.kill(); }
  }
}

const results = {};
console.log(`${'scene'.padEnd(13)} ${'calls'.padStart(6)} ${'tris'.padStart(9)} ${'frame'.padStart(6)} ${'ftris'.padStart(9)} ${'prog'.padStart(5)} ${'tex'.padStart(4)} ${'inst'.padStart(7)} ${'shad'.padStart(5)} ${'ms'.padStart(6)}  log`);
for (let i = 0; i < shots.length; i++) {
  const [sid, scenario, camera, until, max] = shots[i];
  writePage(`probe-${sid}`, { scenario, camera });
  const r = await probe(`probe-${sid}`, until, max, PORT0 + i);
  results[sid] = r;
  const bad = r.log.filter((l) => l.level !== 'warning').length, warn = r.log.length - bad;
  console.log(`${sid.padEnd(13)} ${String(r.scene.calls).padStart(6)} ${String(r.scene.triangles).padStart(9)} ${String(r.frame.calls).padStart(6)} ${String(r.frame.triangles).padStart(9)} ${String(r.programs).padStart(5)} ${String(r.textures).padStart(4)} ${String(r.instances).padStart(7)} ${String(r.shadowCasters).padStart(5)} ${String(r.sceneMs).padStart(6)}  ${bad ? bad + ' error(s)' : ''}${warn ? ' ' + warn + ' warning(s)' : ''}`);
  for (const l of r.log) console.log(`    ${l.level}: ${l.text.replace(/\s+/g, ' ')}`);
  if (process.env.CTL_PROBE_BREAKDOWN) for (const [k, b] of Object.entries(r.breakdown)) console.log(`    ${k.padEnd(22)} draws ${String(b.draws).padStart(4)}  tris ${String(b.tris).padStart(9)}  casters ${String(b.casters).padStart(4)}  instances ${b.instances}`);
}
console.log(`gpu: ${Object.values(results)[0]?.gpu}`);
writeFileSync(out, JSON.stringify(results, null, 1));
console.log(`-> ${out}`);
