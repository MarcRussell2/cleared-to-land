// The look sheet: one fixed panel of CLEARED TO LAND stills, captured deterministically.
//
// This copy lives in the game repo (branch visuals-world) with two changes from the
// website repo's tools/ctl-shots/looksheet.mjs it was taken from: `sharp` is
// resolved from that repo (set CTL_SHARP_DIR if it is elsewhere), and after the
// page reports ready it waits for the downloaded airframe to arrive before stepping,
// because two scenes (ridge, coast) stop on the very first frame and the wing camera
// placed itself differently depending on whether the model had loaded yet.
//
// This is the review loop for visual work (the art passes that run under
// src/art/ in the game repo). Same scenes, same frames, every time, so a change
// of look is the only thing that can differ between two runs. Full-size PNGs to
// look at closely, a downscaled JPEG set and a contact sheet for a quick read.
//
//   node looksheet.mjs <outDir> [shotId ...]      (no ids = the whole sheet)
//   node looksheet.mjs --list
//
// Env: CTL_WEB_DIR   packaged game, default: the web/ folder of this repository
//      CTL_SHOTS_DIR scratch for the driven pages, default C:/tmp/ctl-shots
//
// Each shot names a scenario, a camera and a stopping condition evaluated with
// (g, ac, ra, d, t) exactly as still.mjs does: ra = radio altitude in feet,
// d = metres to the threshold (negative past it), t = seconds.
//
// How repeatable this is. Everything that varies per flight is drawn from one seed
// (see startScenario in the game's main.js) and CTL_WIND_SEED below pins it, so
// the menu shoots byte-identical and the flying scenes usually do too. They are not
// guaranteed to: something in the load path still lands on a different frame now and
// then, which moves the airplane by a few centimetres and shows up as a mean pixel
// difference of up to about 6/255 with a third of the pixels nudged. Read lookdiff
// output with that floor in mind - a real change of look reads ten times higher -
// and when a single scene matters, shoot it twice.
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createRequire } from 'node:module';
// sharp is not a dependency of the game; it is borrowed from the website repo's harness.
const sharp = createRequire((process.env.CTL_SHARP_DIR || fileURLToPath(new URL('..', import.meta.url))).replace(/\\/g, '/') + '/x.mjs')('sharp');

const SHOTS = [
  // id             scenario   camera     until          max   note
  ['menu',         'menu',    null,      null,          0,    'Main menu: the UI skin and the aircraft rail'],
  ['day-final',    'solo',    'chase',   'ra < 220',    2600, 'Plains, morning: grass, asphalt, the trainer'],
  ['day-flare',    'solo',    'chase',   'ra < 8',      3200, 'The flare: runway markings and texture up close'],
  ['cockpit',      'solo',    'cockpit', 'ra < 300',    2600, 'Cockpit view and the HUD'],
  ['coast',        'heavy',   'chase',   'ra < 700',    2600, 'Harbor City: water, coastline, the airliner'],
  ['tower',        'gusty',   'tower',   'ra < 400',    2600, 'Late afternoon from the tower: long light'],
  ['carrier-day',  'cq',      'flyby',   'ra < 300',    2600, 'Carrier and sea in daylight'],
  ['carrier-nite', 'night',   'chase',   'ra < 400',    2600, 'Night trap: deck lights, sea after dark'],
  ['mountain',     'gravel',  'chase',   'ra < 260',    3200, 'Mountain valley: spruce, river, gravel bar'],
  ['ridge',        'oneway',  'wing',    'ra < 350',    2600, 'Wing view over the ridge strip'],
  ['fog',          'fog',     'chase',   'ra < 500',    2600, 'Low visibility: fog and the approach lights'],
];

const S = (process.env.CTL_SHOTS_DIR || 'C:/tmp/ctl-shots').replace(/\\/g, '/');
const GAME = (process.env.CTL_WEB_DIR || fileURLToPath(new URL('../web', import.meta.url))).replace(/\\/g, '/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (process.argv[2] === '--list') {
  for (const [id, sc, cam, , , note] of SHOTS) {
    console.log(`${id.padEnd(14)} ${String(sc).padEnd(9)} ${String(cam ?? '-').padEnd(8)} ${note}`);
  }
  process.exit(0);
}

const outDir = (process.argv[2] || './looksheet').replace(/\\/g, '/');
// A port range of this run's own, so two sheets can be shot back to back without
// tripping over each other's debugging ports.
const PORT_BASE = +(process.env.CTL_SHOT_PORT || 9500) + (process.pid % 40) * 20;
const want = process.argv.slice(3);
const shots = want.length ? SHOTS.filter((s) => want.includes(s[0])) : SHOTS;
if (!shots.length) { console.error('no shot matched'); process.exit(2); }
mkdirSync(outDir, { recursive: true });
mkdirSync(join(outDir, 'small'), { recursive: true });
mkdirSync(S, { recursive: true });

// The driven page: make.mjs's injection, inlined so the sheet is one command.
function writePage(name, P) {
  let html = readFileSync(`${GAME}/index.html`, 'utf8');
  html = html.replaceAll('url(fonts/', `url(file:///${GAME.replace(/ /g, '%20')}/fonts/`);
  const inject = [
    '<script>',
    '(function(){',
    `  const P = ${JSON.stringify(P)};`,
    "  const s = {quality:'high',sensitivity:1,mouseSens:0.5,volume:0,voice:false,hints:false,invert:false,camera:P.camera||'chase',approach:'medium',autoTrim:true,keyStrip:false};",
    "  localStorage.setItem('ctl.settings', JSON.stringify(s));",
    "  localStorage.setItem('ctl.best', JSON.stringify({}));",
    // Turbulence is seeded from Math.random() on every flight, so without this the
    // airplane flies a different approach each run and no two sheets compare.
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
    // Freeze the real animation loop BEFORE starting the scenario. Otherwise the
    // game runs a variable number of wall-clock frames first, which walks the
    // camera-shake rng and the cloud drift on and makes two runs differ.
    '    g.loop = function(){};',
    "    if (P.scenario && P.scenario !== 'menu') {",
    '      g.startScenario(window.G.SCENARIOS.find(x => x.id === P.scenario));',
    '      g.setAutopilot(true);',
    '      if (P.camera) g.rig.setMode(P.camera);',
    '      if (P.hud === false) g.hud.visible = false;',
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

async function capture(name, until, max, pngPath, port) {
  const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
    '--headless=new', '--hide-scrollbars', '--allow-file-access-from-files', '--force-device-scale-factor=1',
    '--window-size=1920,1080', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${port}`,
    `--user-data-dir=${S}/edge-profile-${port}`, `file:///${S}/${name}.html`], { stdio: 'ignore' });
  try {
    let page;
    for (let i = 0; i < 120 && !page; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
        page = list.find((t) => t.type === 'page' && t.url.includes(name));
      } catch { /* devtools not listening yet */ }
      if (!page) await sleep(200);
    }
    if (!page) throw new Error('devtools endpoint never came up');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0;
    const pending = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
    const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    const evalJs = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) throw new Error('page error: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
      return r.result?.result?.value;
    };
    await send('Page.enable');
    await send('Runtime.enable');
    for (let i = 0; i < 400; i++) { if (await evalJs('!!(window.__shot && window.__shot.ready)')) break; await sleep(100); }
    // The downloaded airframes decode asynchronously; give them a moment so every
    // scene, including the two that stop at frame 0, sees the same airplane.
    for (let i = 0; i < 40; i++) { if (await evalJs("(() => { const g = window.game; return !g || !g.model || !!g.model.gltfRoot || (g.ac && g.ac.def.id === 'hornet'); })()")) break; await sleep(100); }
    await sleep(300);
    let state = 'menu';
    if (until) {
      const hit = await evalJs(`window.__runUntil(${JSON.stringify(until)}, ${max})`);
      if (hit < 0) console.warn(`  ! ${name}: condition never held in ${max} frames`);
      state = await evalJs('window.__step(0)');
    } else {
      await sleep(1500);
    }
    await sleep(250);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(pngPath, Buffer.from(shot.result.data, 'base64'));
    ws.close();
    return state;
  } finally {
    // edge.kill() only takes the parent: headless Chromium leaves a renderer and a
    // GPU process per tab behind, and after a few sheets those hold the debugging
    // ports and pile up in their hundreds. Kill the whole tree.
    try { execFileSync('taskkill', ['/F', '/T', '/PID', String(edge.pid)], { stdio: 'ignore' }); }
    catch { edge.kill(); }
  }
}

const done = [];
for (let i = 0; i < shots.length; i++) {
  const [id, scenario, camera, until, max, note] = shots[i];
  process.stdout.write(`[${i + 1}/${shots.length}] ${id} ... `);
  writePage(`look-${id}`, { scenario, camera, hud: true });
  const png = join(outDir, `${id}.png`);
  const state = await capture(`look-${id}`, until, max, png, PORT_BASE + i);
  await sharp(png).resize(960, 540).jpeg({ quality: 82 }).toFile(join(outDir, 'small', `${id}.jpg`));
  console.log(state);
  done.push({ id, note, png });
}

// Contact sheet: three columns of captioned 640x360 thumbs.
const COLS = 3, TW = 640, TH = 360, PAD = 8, CAP = 22;
const rows = Math.ceil(done.length / COLS);
const W = COLS * TW + (COLS + 1) * PAD;
const H = rows * (TH + CAP) + (rows + 1) * PAD;
const layers = [];
for (let i = 0; i < done.length; i++) {
  const cx = PAD + (i % COLS) * (TW + PAD);
  const cy = PAD + Math.floor(i / COLS) * (TH + CAP + PAD);
  layers.push({ input: await sharp(done[i].png).resize(TW, TH).toBuffer(), left: cx, top: cy });
  const label = `${done[i].id} - ${done[i].note}`.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const svg = `<svg width="${TW}" height="${CAP}"><text x="2" y="15" font-family="Segoe UI, sans-serif" font-size="13" fill="#dfe6ee">${label}</text></svg>`;
  layers.push({ input: Buffer.from(svg), left: cx, top: cy + TH });
}
await sharp({ create: { width: W, height: H, channels: 3, background: '#14181d' } })
  .composite(layers).jpeg({ quality: 86 }).toFile(join(outDir, 'contact-sheet.jpg'));
console.log(`\n${done.length} shots -> ${outDir}  (contact-sheet.jpg, small/*.jpg)`);
