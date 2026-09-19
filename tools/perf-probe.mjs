// perf-probe: measure how fast CLEARED TO LAND actually runs, on a real GPU, with the real animation loop.
//
// The screenshot harness steps frames by hand; this one lets requestAnimationFrame run and samples
// it. It builds an UNMINIFIED bundle of the game (so CPU profiles have readable names), writes a
// self-driving page that starts a scenario with the autoland on, launches Microsoft Edge with a
// DevTools port (headless by default - headless Edge renders on the real GPU here, verified by
// WEBGL_debug_renderer_info), waits for the model to load and the shaders to warm, then samples
// a window and prints:
//
//   frame time     p50 / p95 / p99 of the interval between animation frames, and fps from them
//   cpu            main-thread ms per frame inside the game loop (update + render submission),
//                  split into parts: physics, hud, model, effects, camera, sky, audio, render
//   gpu            EXT_disjoint_timer_query_webgl2 time per frame, split scene / bloom / output
//                  (scene includes the shadow pass), p50 / p95
//   draws          renderer.info per frame: draw calls, triangles, points, lines, and how many
//                  of the calls/triangles were the shadow pass
//   memory         geometries, textures, compiled programs; JS heap allocation rate (MB/s)
//   physics        sub-steps per frame (the integrator runs 4 ms sub-steps, up to 12 per frame)
//   dom            layouts and style recalcs per second (CDP Performance.getMetrics)
//   --profile      a CPU sampling profile over the same window: top self-time functions and
//                  a per-module split (game modules vs three.js internals)
//   --census       a static census of the scene: per owner (terrain, forest, airport, carrier,
//                  sky, aircraft, effects...) objects, estimated draws, triangles, shadow casters,
//                  and the texture inventory
//
// Usage
//   node tools/perf-probe.mjs [options]
//     --scene <id>         scenario id (solo, heavy, cq, night, gravel, fog, ...) or menu   [solo]
//     --camera <mode>      chase | cockpit | tower | flyby | wing                           [chase]
//     --quality <tier>     low | medium | high                                             [high]
//     --w --h --dpr        CSS viewport and devicePixelRatio                        [1920 1080 1]
//     --phone              Pixel 9 Pro landscape: 1088x430, dpr 2.625, touch + Android UA,
//                          so the game takes its touch path (compact HUD, touch tiers)
//     --gpu <which>        nvidia | intel | <high,low>: pin the adapter (--use-adapter-luid);
//                          the report says which GPU actually rendered
//     --cpu <rate>         CDP CPU throttling (3 ~ a Pixel 9 Pro's single-thread JS speed)
//     --raw                --disable-frame-rate-limit --disable-gpu-vsync: how fast it CAN run
//                          (default: vsync, what a player sees, capped at the display rate)
//     --visible            a real window instead of --headless=new
//     --warm <s>           warm-up before sampling                                          [6]
//     --seconds <s>        sampling window                                                 [12]
//     --profile            CPU sampling profile over the window
//     --census             print the scene census
//     --ablate a,b,...     switch things off before sampling, to price them:
//                          shadows, pcf, shadow:N, composer, bloom, msaa, dpr:N, clouds, sky,
//                          stars, forest, terrain, water, airport, carrier, aircraft, particles,
//                          lights, hud, hudjs, vignette, touch, physics, fog
//     --auto               leave the game's own frame-rate watchdog on (default: off, so the
//                          tier cannot change mid-sample)
//     --seed <n>           the flight seed (turbulence, gusts, shake)                    [4271]
//     --shot <file.png>    save a screenshot at the end of the window
//     --json <file>        append the result as one JSON line
//     --port <n>           DevTools port                                                 [9630]
//     --minify             use a minified bundle (default unminified, for the profiler)
//     --label <text>       a name for the row in the report
//     --matrix [name]      run the standard matrix (see MATRIX below) and print one table
//     --budget             the census as pass/fail against docs/PERF.md section 5: plains, coast,
//                          carrier-night, mountain and fog, chase and cockpit cameras; one row per
//                          owner and metric (measured / budget / ok, BREACH or info); exit 1 on a
//                          breach. `npm run perf-budget` (structural budgets on the default GPU);
//                          `npm run perf-budget -- --gpu intel --phone --cpu 3 --quality medium`
//                          also asserts the GPU-millisecond budgets on the mobile stand-in.
//     --scenes a,b,...     with --budget: these scenes (chase and cockpit each) instead of the
//                          standard five, e.g. the new maps: --budget --scenes hill-hop,mesa-top
//
// Work dir: C:/tmp/ctl-perf (bundle, pages, Edge profiles). Only Edge processes started by
// this tool are killed (by PID tree). npm script: `npm run perf-probe -- --scene heavy`.
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORK = (process.env.CTL_PERF_DIR || 'C:/tmp/ctl-perf').replace(/\\/g, '/');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
// Adapter LUIDs on this machine (dxgi EnumAdapters1); pass your own as high,low if they differ.
const GPUS = { nvidia: '0,96124', intel: '0,100565' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ arguments
function parseArgs(argv) {
  const o = { scene: 'solo', camera: 'chase', quality: 'high', w: 1920, h: 1080, dpr: 1, warm: 6, seconds: 12, port: 9630, seed: 4271, ablate: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    switch (a) {
      case '--scene': o.scene = next(); break;
      case '--camera': o.camera = next(); break;
      case '--quality': o.quality = next(); break;
      case '--w': o.w = +next(); break;
      case '--h': o.h = +next(); break;
      case '--dpr': o.dpr = +next(); break;
      case '--phone': o.phone = true; break;
      case '--gpu': o.gpu = next(); break;
      case '--cpu': o.cpu = +next(); break;
      case '--raw': o.raw = true; break;
      case '--visible': o.visible = true; break;
      case '--warm': o.warm = +next(); break;
      case '--seconds': o.seconds = +next(); o.secondsSet = true; break;
      case '--profile': o.profile = true; break;
      case '--alloc': o.alloc = true; break;
      case '--census': o.census = true; break;
      case '--ablate': o.ablate = next().split(',').filter(Boolean); break;
      case '--auto': o.auto = true; break;
      case '--seed': o.seed = +next(); break;
      case '--shot': o.shot = next(); break;
      case '--json': o.json = next(); break;
      case '--port': o.port = +next(); break;
      case '--minify': o.minify = true; break;
      case '--label': o.label = next(); break;
      case '--matrix': o.matrix = argv[i + 1] && !argv[i + 1].startsWith('--') ? next() : 'default'; break;
      case '--budget': o.budget = true; o.census = true; break;
      case '--scenes': o.scenes = next().split(',').filter(Boolean); break;
      case '--help': case '-h': console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n')); process.exit(0);
      default: throw new Error('unknown option ' + a);
    }
  }
  if (o.phone) { o.w = 1088; o.h = 430; o.dpr = 2.625; }
  if (o.budget && !o.secondsSet) o.seconds = 8;
  return o;
}

// ------------------------------------------------------------------ the bundle and the page
async function bundle(minify) {
  mkdirSync(WORK, { recursive: true });
  const entry = `${WORK}/entry.js`;
  writeFileSync(entry, `import * as THREE from 'three';\nwindow.__THREE = THREE;\nimport ${JSON.stringify(resolve(root, 'src/main.js').replace(/\\/g, '/'))};\n`);
  const out = `${WORK}/game${minify ? '.min' : ''}.js`;
  await esbuild.build({
    entryPoints: [entry], bundle: true, format: 'iife', target: ['es2020'], outfile: out, minify: !!minify,
    sourcemap: false, legalComments: 'none', loader: { '.glb': 'dataurl' }, logLevel: 'error',
    absWorkingDir: root, nodePaths: [resolve(root, 'node_modules')],
    define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  });
  return out;
}

function fontCss() {
  const fontsDir = resolve(root, 'web/fonts').replace(/\\/g, '/');
  if (!existsSync(fontsDir)) return '';
  const FONTS = [['barlow-condensed', 'Barlow Condensed', [500, 600, 700, 800]], ['barlow', 'Barlow', [400, 500, 600]], ['share-tech-mono', 'Share Tech Mono', [400]]];
  let css = '';
  for (const [pkg, family, weights] of FONTS) for (const w of weights) {
    const f = `${fontsDir}/${pkg}-latin-${w}-normal.woff2`;
    if (existsSync(f)) css += `@font-face{font-family:'${family}';font-style:normal;font-weight:${w};font-display:swap;src:url(file:///${f.replace(/ /g, '%20')}) format('woff2')}\n`;
  }
  return css;
}

function writePage(name, jsFile, P) {
  const tpl = readFileSync(resolve(root, 'src/index.html'), 'utf8');
  const css = readFileSync(resolve(root, 'src/style.css'), 'utf8');
  let html = tpl.replace('/*CSS*/', () => css);
  html = html.replace(/<link rel="preconnect"[^>]*>\s*<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/, () => `<style>\n${fontCss()}</style>`);
  const driver = `<script>(${pageCode.toString()})(${JSON.stringify(P)});</script>`;
  html = html.replace('<body>', () => '<body>\n' + driver).replace('<!--JS-->', () => `<script src="${jsFile.split('/').pop()}"></script>`);
  const file = `${WORK}/${name}.html`;
  writeFileSync(file, html);
  return file;
}

// Runs INSIDE the page. Sets the saved settings before the game boots, starts the scenario,
// instruments the loop and exposes __perf / __ablate / __census to the driver.
function pageCode(P) {
  const s = { quality: P.quality, sensitivity: 1, mouseSens: 0.5, volume: 0, voice: false, hints: true, invert: false, camera: P.camera, approach: 'medium', autoTrim: true, keyStrip: true, touch: 'auto', autoQuality: !!P.auto, tilt: false, stickSide: 'right' };
  try { localStorage.setItem('ctl.settings', JSON.stringify(s)); localStorage.setItem('ctl.best', '{}'); } catch (e) { /* ignore */ }
  window.CTL_WIND_SEED = P.seed || 4271;
  const perf = window.__perf = { ready: false, on: false, frames: [], gpuFrames: [], log: [], error: null };
  window.addEventListener('error', (e) => { perf.error = String(e.message || e); });
  const now = () => performance.now();

  function install(g) {
    const r = g.renderer, gl = r.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    perf.timerQuery = !!ext;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    perf.gpuName = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    perf.parallelCompile = (gl.getSupportedExtensions() || []).includes('KHR_parallel_shader_compile');
    r.info.autoReset = false;
    // ---- GPU timer queries: one per renderer.render call, labelled by the pass that issued it
    let active = null, label = 'scene', frameIdx = 0;
    const pending = [];
    const beginQ = () => { if (!ext || active) return; const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); active = { q, label, frame: frameIdx }; };
    const endQ = () => { if (!active) return; gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(active); active = null; };
    const poll = () => {
      if (!ext) return;
      while (pending.length) {
        const p = pending[0];
        const ok = gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE);
        if (!ok) break;
        const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
        const ns = gl.getQueryParameter(p.q, gl.QUERY_RESULT);
        gl.deleteQuery(p.q); pending.shift();
        if (disjoint) { perf.disjoint = (perf.disjoint || 0) + 1; continue; }
        if (perf.on) { const f = perf.gpuFrames[p.frame] || (perf.gpuFrames[p.frame] = {}); f[p.label] = (f[p.label] || 0) + ns / 1e6; }
      }
    };
    // A second world-style render call in a frame (outside the bloom/output passes) is the cockpit
    // interior pass (src/cockpit.js on the visuals-aircraft branch draws it on its own layer with a
    // second camera); it gets its own label and its own draw count.
    let sceneCalls = 0, cockpitCalls = 0, cockpitTris = 0;
    const origRender = r.render.bind(r);
    r.render = (scene, camera) => {
      let lab = label;
      if (label === 'scene') { if (sceneCalls > 0) lab = 'cockpit'; sceneCalls++; }
      const prev = label; label = lab;
      const c0 = r.info.render.calls, t0 = r.info.render.triangles;
      beginQ(); origRender(scene, camera); endQ();
      if (lab === 'cockpit') { cockpitCalls += r.info.render.calls - c0; cockpitTris += r.info.render.triangles - t0; }
      label = prev;
    };
    const wrapPass = (pass, name) => { if (!pass) return; const o = pass.render.bind(pass); pass.render = (...a) => { const prev = label; label = name; o(...a); label = prev; }; };
    wrapPass(g.bloom, 'bloom'); wrapPass(g.outputPass, 'output');
    // Runtime needsUpdate storms: count every `material.needsUpdate = true` during the window.
    perf.needsUpdates = 0;
    try {
      const T = window.__THREE, desc = Object.getOwnPropertyDescriptor(T.Material.prototype, 'needsUpdate');
      if (desc && desc.set) Object.defineProperty(T.Material.prototype, 'needsUpdate', { configurable: true, get: desc.get, set(v) { if (v && perf.on) perf.needsUpdates++; desc.set.call(this, v); } });
    } catch (e) { perf.log.push('needsUpdate hook failed: ' + e); }
    // ---- shadow pass share of the draw calls
    const sm = r.shadowMap, origShadow = sm.render.bind(sm);
    let shadowCalls = 0, shadowTris = 0;
    sm.render = (...a) => { const c0 = r.info.render.calls, t0 = r.info.render.triangles; origShadow(...a); shadowCalls += r.info.render.calls - c0; shadowTris += r.info.render.triangles - t0; };
    // ---- CPU parts
    const parts = {}; perf.partsNames = [];
    const timed = (obj, method, name) => {
      if (!obj || typeof obj[method] !== 'function' || obj[method].__timed) return;
      const o = obj[method];
      const w = function (...a) { const t = now(); const out = o.apply(this, a); parts[name] = (parts[name] || 0) + now() - t; return out; };
      w.__timed = true; obj[method] = w;
      if (!perf.partsNames.includes(name)) perf.partsNames.push(name);
    };
    let physDt = 0;
    const timePhysics = (ac) => {
      if (!ac || ac.step.__timed) return;
      const o = ac.step;
      ac.step = function (dt, env) { physDt = dt; const t = now(); o.call(this, dt, env); parts.physics = (parts.physics || 0) + now() - t; };
      ac.step.__timed = true;
      if (!perf.partsNames.includes('physics')) perf.partsNames.push('physics');
    };
    const hookWorld = () => {
      timePhysics(g.ac);
      timed(g.hud, 'update', 'hud');
      timed(g.model, 'update', 'model');
      timed(g.effects, 'update', 'effects');
      timed(g.rig, 'update', 'camera');
      timed(g.world && g.world.sky, 'update', 'sky');
      timed(g.world && g.world.airport, 'update', 'airport');
      timed(g.world && g.world.carrier, 'update', 'carrier');
      timed(g.audio, 'update', 'audio');
      timed(g.touch, 'update', 'touch');
      timed(g, 'render', 'render');
      timed(g.fcs, 'update', 'fcs');
      timed(g.ap, 'update', 'autoland');
      timed(g.cockpitView, 'update', 'cockpitUpdate');   // the interior's state feed (src/cockpit.js), cockpit view only
      timed(g.cockpitView, 'sync', 'cockpitSync');
      if (g.world && g.world.terrain && g.world.terrain.water) timed(g.world.terrain.water, 'tick', 'water');
    };
    perf.hookWorld = hookWorld;
    // ---- start-up: how long the world takes to build and how long the first frame (shader compiles) blocks
    const origLoad = g.loadSite.bind(g);
    g.loadSite = (...a) => { const t = now(); const out = origLoad(...a); perf.loadSiteMs = now() - t; return out; };
    const origStart = g.startScenario.bind(g);
    g.startScenario = (...a) => { const t = now(); const out = origStart(...a); perf.startScenarioMs = now() - t; perf.startAt = now(); perf.firstFrameMs = null; perf.framesToSettle = null; return out; };
    // ---- the loop
    let lastT0 = 0, sinceStart = 0;
    const origLoop = g.loop.bind(g);
    g.loop = function () {
      const t0 = now();
      r.info.reset(); shadowCalls = 0; shadowTris = 0; sceneCalls = 0; cockpitCalls = 0; cockpitTris = 0;
      for (const k in parts) parts[k] = 0;
      poll();
      origLoop();
      const t1 = now();
      // the first frame that actually ran (the engine holds the loop while a new flight's shaders compile)
      if (perf.startAt != null && perf.firstFrameMs == null && !g.compiling) { perf.firstFrameMs = t1 - perf.startAt; perf.firstFrameCpuMs = t1 - t0; sinceStart = 0; }
      else if (perf.startAt != null && perf.framesToSettle == null) { sinceStart++; if (t1 - t0 < 8) perf.framesToSettle = sinceStart; else if (sinceStart > 600) perf.framesToSettle = -1; }
      if (perf.on) {
        const mem = performance.memory ? performance.memory.usedJSHeapSize : 0;
        const rec = { t: t0, dt: lastT0 ? t0 - lastT0 : 0, cpu: t1 - t0, calls: r.info.render.calls, tris: r.info.render.triangles, points: r.info.render.points, lines: r.info.render.lines, shadowCalls, shadowTris, cockpitCalls, cockpitTris, heap: mem, physDt, parts: { ...parts } };
        perf.frames.push(rec);
      }
      lastT0 = t0; frameIdx++;
    };
    perf.begin = () => { perf.frames = []; perf.gpuFrames = []; perf.disjoint = 0; perf.needsUpdates = 0; perf.programs0 = r.info.programs ? r.info.programs.length : 0; hookWorld(); perf.on = true; perf.t0 = now(); };
    perf.end = () => { perf.on = false; return { frames: perf.frames, gpuFrames: perf.gpuFrames, disjoint: perf.disjoint, seconds: (now() - perf.t0) / 1000, needsUpdates: perf.needsUpdates, programsDelta: (r.info.programs ? r.info.programs.length : 0) - perf.programs0 }; };
    perf.stats = () => {
      const w = g.world || {};
      const rt = g.composer && g.composer.renderTarget1;
      const sun = w.sky && w.sky.sun;
      const size = r.getDrawingBufferSize(new window.__THREE.Vector2());
      return {
        gpu: perf.gpuName, timerQuery: perf.timerQuery, parallelCompile: perf.parallelCompile,
        pixelRatio: r.getPixelRatio(), drawingBuffer: [size.x, size.y], css: [innerWidth, innerHeight], devicePixelRatio,
        composer: !!g.useComposer, bloom: !!(g.bloom && g.bloom.enabled), rt: rt ? { w: rt.width, h: rt.height, samples: rt.samples, type: rt.texture.type } : null,
        shadows: r.shadowMap.enabled, shadowType: r.shadowMap.type, shadowMap: sun ? sun.shadow.mapSize.x : 0,
        memory: { ...r.info.memory }, programs: r.info.programs ? r.info.programs.length : 0,
        quality: g.settings.quality, touch: g.touchActive, profile: g.profile, trees: w.terrain ? w.terrain.treeCount : 0,
        state: g.state, gltf: !!(g.model && g.model.gltfRoot), scene: g.scenario && g.scenario.id, camera: g.rig.mode,
        aircraft: g.ac ? g.ac.def.id : null, site: w.site ? w.site.id : null, style: w.terrain ? w.terrain.style : null, treeScale: g.profile ? g.profile.treeScale : 1,
        build: (document.querySelector('meta[name=ctl-build]') || {}).content || null,
        startup: { loadSiteMs: perf.loadSiteMs, startScenarioMs: perf.startScenarioMs, firstFrameMs: perf.firstFrameMs, firstFrameCpuMs: perf.firstFrameCpuMs, framesToSettle: perf.framesToSettle },
      };
    };
  }

  // What is in the scene, by owner. The art bench's modules map onto the engine's groups, so the
  // classification is structural (which group an object hangs under) plus a few names and layers
  // the branches use: `parked:*` / `parked-lights` are the engine-merged apron aircraft, a group
  // named `cockpit:*` or anything on render layer 1 is the cockpit interior (visuals-aircraft's
  // src/cockpit.js and src/art/cockpits/*), InstancedMesh under the terrain group is vegetation
  // and props (visuals-world's world-vegetation.js / world-props.js), the ground mesh is
  // world-ground.js, the water world-water.js, the sky dome / clouds / stars sky.js +
  // world-atmosphere.js, the aircraft src/art/airframes/* + livery.js, the particles
  // src/particles.js + effects.js (Points with the particle attributes or a particle-like name).
  window.__census = function () {
    const g = window.game, w = g.world || {}, T = window.__THREE;
    const under = (o, root) => { for (let p = o; p; p = p.parent) if (p === root) return true; return false; };
    const named = (o, prefix) => { for (let p = o; p; p = p.parent) { if (p.name && p.name.startsWith(prefix)) return true; } return false; };
    const cockpitObj = (o) => named(o, 'cockpit:') || (o.layers.mask & 2) !== 0;
    const parkedObj = (o) => named(o, 'parked:') || named(o, 'parked-lights') || named(o, 'aerodrome/parked');
    const owners = [];
    const own = (name, test) => owners.push({ name, test });
    if (w.sky) {
      own('sky dome', (o) => o === w.sky.sky);
      own('clouds', (o) => (w.sky.clouds || []).some((c) => c.mesh === o));
      own('stars', (o) => o === w.sky.stars);
    }
    if (w.terrain) {
      // the world branch's modules name what they build (world/ground, vegetation/<species>, world/water)
      if (w.terrain.mesh) own('ground', (o) => o === w.terrain.mesh || under(o, w.terrain.mesh) || named(o, 'world/ground'));
      if (w.terrain.water) own('water', (o) => o === w.terrain.water.mesh || named(o, 'world/water'));
      own('vegetation+props (instanced)', (o) => named(o, 'vegetation/') || (o.isInstancedMesh && under(o, w.terrain.group)));
      own('terrain other (roads, obstacle trees)', (o) => under(o, w.terrain.group));
    }
    if (w.airport) {
      own('parked aircraft', (o) => parkedObj(o) && under(o, w.airport.group));
      own('airport', (o) => under(o, w.airport.group));
    }
    if (w.carrier) own('carrier', (o) => under(o, w.carrier.group));
    if (g.model) {
      own('cockpit', (o) => under(o, g.model.group) && cockpitObj(o));
      own('aircraft', (o) => under(o, g.model.group));
    }
    own('cockpit', (o) => cockpitObj(o));
    own('particles', (o) => o.isPoints && !!(o.geometry.attributes.aSize || o.geometry.attributes.aAlpha || o.geometry.attributes.aLife || o.geometry.attributes.aAge || (g.effects && g.effects.all && g.effects.all.some((s) => s.points === o)) || /particle|smoke|spray|spark|dust|fire|exhaust/i.test(o.name)));
    own('other', () => true);
    const cam = g.camera;
    cam.updateMatrixWorld(true);
    const frustum = new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const rows = {};
    const texSeen = new Map();
    const offenders = [];
    const noteTex = (t, where) => {
      if (!t || !t.isTexture) return;
      const im = t.image, k = t.uuid;
      if (texSeen.has(k)) return;
      const wd = im && (im.width || (im[0] && im[0].width)) || 0, ht = im && (im.height || 0) || 0;
      const bpp = t.type === T.HalfFloatType ? 8 : t.type === T.FloatType ? 16 : 4;
      texSeen.set(k, { where, w: wd, h: ht, mip: t.generateMipmaps, aniso: t.anisotropy, type: t.constructor.name, bytes: Math.round(wd * ht * bpp * (t.generateMipmaps ? 4 / 3 : 1)) });
    };
    const roots = [g.scene];
    if (g.cockpitView && g.cockpitView.own) roots.push(g.cockpitView.own);   // the interior lives in a scene of its own
    for (const root of roots) root.traverse((o) => {
      if (!o.visible) return;
      for (let p = o.parent; p; p = p.parent) if (!p.visible) return;
      const owner = owners.find((x) => x.test(o)).name;
      const row = rows[owner] || (rows[owner] = { objects: 0, draws: 0, tris: 0, visibleDraws: 0, visibleTris: 0, points: 0, casters: 0, receivers: 0, transparent: 0, uncullable: 0, instances: 0, geometries: new Set(), materials: new Set() });
      row.objects++;
      if (!(o.isMesh || o.isPoints || o.isLine)) return;
      const geo = o.geometry; if (!geo) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) { row.materials.add(m); for (const k of ['map', 'normalMap', 'roughnessMap', 'emissiveMap', 'alphaMap', 'metalnessMap', 'aoMap', 'bumpMap']) noteTex(m[k], owner); if (m.uniforms) for (const u in m.uniforms) noteTex(m.uniforms[u] && m.uniforms[u].value, owner); if (m.transparent) row.transparent++; }
      row.geometries.add(geo);
      const idx = geo.index ? geo.index.count : geo.attributes.position ? geo.attributes.position.count : 0;
      const range = geo.drawRange && geo.drawRange.count !== Infinity ? Math.min(geo.drawRange.count, idx) : idx;
      const inst = o.isInstancedMesh ? o.count : 1;
      row.instances += o.isInstancedMesh ? o.count : 0;
      row.draws += mats.length;
      const tris = o.isPoints || o.isLine ? 0 : Math.floor(range / 3) * inst;
      if (o.isPoints) row.points += range * inst; else row.tris += tris;
      let inView = true;
      if (o.frustumCulled !== false) { try { inView = frustum.intersectsObject(o); } catch (e) { inView = true; } }
      if (inView) { row.visibleDraws += mats.length; row.visibleTris += tris; }
      if (o.castShadow) row.casters++;
      if (o.receiveShadow) row.receivers++;
      if (o.frustumCulled === false) {
        row.uncullable++;
        const allowed = o.isPoints || (w.sky && (o === w.sky.sky || o === w.sky.stars || (w.sky.clouds || []).some((c) => c.mesh === o))) || (w.terrain && w.terrain.water && o === w.terrain.water.mesh);
        if (!allowed) offenders.push({ owner, name: o.name || '', type: o.type, tris });
      }
    });
    const out = {};
    for (const k in rows) { const r = rows[k]; out[k] = { ...r, geometries: r.geometries.size, materials: r.materials.size }; }
    const sun = w.sky && w.sky.sun;
    const textures = [...texSeen.values()];
    if (sun && sun.shadow.map) textures.push({ where: 'shadow map', w: sun.shadow.mapSize.x, h: sun.shadow.mapSize.y, type: 'DepthTexture', bytes: sun.shadow.mapSize.x * sun.shadow.mapSize.y * 4 });
    const programs = {};
    for (const p of (g.renderer.info.programs || [])) { const k = p.name || '?'; programs[k] = (programs[k] || 0) + 1; }
    const lights = [], lightDetail = [];
    g.scene.traverse((o) => { if (o.isLight) { lights.push(o.type + (o.castShadow ? '(shadow)' : '') + (o.intensity === 0 ? '(off)' : '')); lightDetail.push({ type: o.type, intensity: o.intensity, visible: o.visible, castShadow: !!o.castShadow }); } });
    // Materials three.js draws in two passes, setting needsUpdate twice per object per frame (docs/PERF.md section 5)
    const twoPass = new Map();
    for (const root of roots) root.traverse((o) => {
      if (!(o.isMesh || o.isPoints) || !o.visible) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m && m.transparent && m.side === 2 && !m.forceSinglePass) twoPass.set(m.name || m.type, (twoPass.get(m.name || m.type) || 0) + 1);
    });
    const parkedGroups = new Set();
    g.scene.traverse((o) => { if (o.name && (o.name.startsWith('parked:') || o.name === 'parked-lights') && o.parent) parkedGroups.add(o.parent); });
    return { owners: out, textures, programs, lights, lightDetail, offenders, parkedCount: parkedGroups.size, twoPass: [...twoPass.entries()].map(([name, n]) => ({ name, objects: n })) };
  };

  // Switch things off to price them. Each name is a small, reversible change made before sampling.
  window.__ablate = function (names) {
    const g = window.game, w = g.world || {}, T = window.__THREE, r = g.renderer;
    const recompile = () => g.scene.traverse((o) => { if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) m.needsUpdate = true; } });
    const done = [];
    for (const n of names) {
      const [k, v] = n.split(':');
      switch (k) {
        case 'shadows': r.shadowMap.enabled = false; recompile(); break;
        case 'pcf': r.shadowMap.type = T.PCFShadowMap; recompile(); break;
        case 'basicshadow': r.shadowMap.type = T.BasicShadowMap; recompile(); break;
        case 'vsm': r.shadowMap.type = T.VSMShadowMap; recompile(); break;
        case 'shadow': w.sky && w.sky.setShadowSize(+v); break;
        case 'composer': g.useComposer = false; break;
        case 'bloom': if (g.bloom) g.bloom.enabled = false; break;
        case 'msaa': { const rt = new T.WebGLRenderTarget(innerWidth, innerHeight, { type: T.HalfFloatType, samples: +v || 0 }); g.composer.reset(rt); g.composer.setPixelRatio(r.getPixelRatio()); g.composer.setSize(innerWidth, innerHeight); break; }
        case 'ldr': { const rt = new T.WebGLRenderTarget(innerWidth, innerHeight, { type: T.UnsignedByteType, samples: 4 }); g.composer.reset(rt); g.composer.setPixelRatio(r.getPixelRatio()); g.composer.setSize(innerWidth, innerHeight); break; }
        case 'dpr': r.setPixelRatio(+v); g.composer.setPixelRatio(+v); g.composer.setSize(innerWidth, innerHeight); break;
        case 'clouds': if (w.sky) for (const c of w.sky.clouds) c.mesh.visible = false; break;
        case 'sky': if (w.sky) w.sky.sky.visible = false; break;
        case 'stars': if (w.sky) w.sky.stars.visible = false; break;
        case 'forest': if (w.terrain) w.terrain.group.traverse((o) => { if (o.isInstancedMesh) o.visible = false; }); break;
        case 'terrain': if (w.terrain && w.terrain.mesh) w.terrain.mesh.visible = false; break;
        case 'water': if (w.terrain && w.terrain.water) w.terrain.water.mesh.visible = false; break;
        case 'airport': if (w.airport) w.airport.group.visible = false; break;
        case 'carrier': if (w.carrier) w.carrier.group.visible = false; break;
        case 'aircraft': if (g.model) g.model.group.visible = false; break;
        case 'particles': if (g.effects) for (const s of g.effects.all) s.points.visible = false; break;
        case 'lights': g.scene.traverse((o) => { if (o.isPoints && o !== (w.sky && w.sky.stars)) o.visible = false; }); break;
        case 'hud': g.hud.visible = false; break;
        case 'hudjs': g.hud.update = () => {}; break;
        case 'vignette': { const e = document.getElementById('vignette'); if (e) e.style.display = 'none'; break; }
        case 'touch': { const e = document.getElementById('touch'); if (e) e.style.display = 'none'; break; }
        case 'backdrop': { const st = document.createElement('style'); st.textContent = '.hud-box, #touch .tb, #hud.compact #hint, .pausebox { backdrop-filter: none !important; }'; document.head.appendChild(st); break; }
        case 'textshadow': { const st = document.createElement('style'); st.textContent = '#hud, #hud * { text-shadow: none !important; }'; document.head.appendChild(st); break; }
        case 'adi': g.hud.drawADI = () => {}; break;
        case 'fog': g.scene.fog = null; recompile(); break;
        case 'physics': if (g.ac) { const ac = g.ac; ac.step = (dt, env) => { const o = Object.getPrototypeOf(ac).step; o.call(ac, Math.min(dt, 0.004), env); }; } break;
        case 'autopilot': g.ap = null; break;
        default: perf.log.push('unknown ablation ' + n); continue;
      }
      done.push(n);
    }
    return done;
  };

  const iv = setInterval(() => {
    const g = window.game; if (!g || !window.G || document.readyState !== 'complete' || !window.__THREE) return;
    clearInterval(iv);
    try {
      install(g);
      if (P.scene && P.scene !== 'menu') {
        const sc = window.G.SCENARIOS.find((x) => x.id === P.scene);
        if (!sc) throw new Error('no scenario ' + P.scene);
        g.startScenario(sc);
        g.setAutopilot(true);
        if (P.camera) g.rig.setMode(P.camera);
      }
      perf.ready = true;
    } catch (e) { perf.error = String(e && e.stack || e); }
  }, 50);
}

// ------------------------------------------------------------------ Edge + CDP
class Browser {
  constructor(opts) { this.opts = opts; }
  async launch(port) {
    const o = this.opts;
    const args = [
      ...(o.visible ? [] : ['--headless=new']),
      '--hide-scrollbars', '--allow-file-access-from-files', '--force-device-scale-factor=1', '--no-first-run', '--no-default-browser-check',
      `--window-size=${o.w},${o.h}`, '--window-position=0,0', '--autoplay-policy=no-user-gesture-required',
      '--enable-precise-memory-info', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      `--remote-debugging-port=${port}`, `--user-data-dir=${WORK}/profile-${port}`,
      ...(o.raw ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : []),
      ...(o.gpu ? [`--use-adapter-luid=${GPUS[o.gpu] || o.gpu}`] : []),
      'about:blank',
    ];
    this.proc = spawn(EDGE, args, { stdio: 'ignore' });
    let page;
    for (let i = 0; i < 150 && !page; i++) {
      try { const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); page = list.find((t) => t.type === 'page'); } catch { /* not yet */ }
      if (!page) await sleep(200);
    }
    if (!page) throw new Error('devtools endpoint never came up on ' + port);
    this.ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.id = 0; this.pending = new Map(); this.events = [];
    this.ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && this.pending.has(d.id)) { this.pending.get(d.id)(d); this.pending.delete(d.id); } else if (d.method) this.events.push(d); };
    await this.send('Page.enable'); await this.send('Runtime.enable');
  }
  send(method, params = {}) { return new Promise((res) => { const i = ++this.id; this.pending.set(i, res); this.ws.send(JSON.stringify({ id: i, method, params })); }); }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error('page error: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 600));
    return r.result?.result?.value;
  }
  async close() {
    try { this.ws && this.ws.close(); } catch { /* ignore */ }
    try { execFileSync('taskkill', ['/F', '/T', '/PID', String(this.proc.pid)], { stdio: 'ignore' }); } catch { try { this.proc.kill(); } catch { /* gone */ } }
  }
}

// ------------------------------------------------------------------ statistics
const pct = (arr, p) => { if (!arr.length) return 0; const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * (a.length - 1) + 0.5))]; };
const mean = (arr) => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100;

function summarize(data, metricsDelta) {
  const F = data.frames.slice(2);   // the first samples straddle begin()
  const dts = F.map((f) => f.dt).filter((x) => x > 0);
  const cpu = F.map((f) => f.cpu);
  const gpuAll = [], gpuBy = { scene: [], bloom: [], output: [] };
  for (const gf of data.gpuFrames) { if (!gf) continue; let tot = 0; for (const k in gf) { tot += gf[k]; (gpuBy[k] || (gpuBy[k] = [])).push(gf[k]); } gpuAll.push(tot); }
  let alloc = 0; for (let i = 1; i < F.length; i++) { const d = F[i].heap - F[i - 1].heap; if (d > 0) alloc += d; }
  const parts = {};
  for (const f of F) for (const k in f.parts) (parts[k] || (parts[k] = [])).push(f.parts[k]);
  const partsP50 = {}; for (const k in parts) partsP50[k] = r2(pct(parts[k], 0.5));
  const sub = F.map((f) => Math.max(1, Math.min(12, Math.ceil(f.physDt / 0.004))));
  const out = {
    frames: F.length, seconds: r2(data.seconds),
    ft: { p50: r2(pct(dts, 0.5)), p95: r2(pct(dts, 0.95)), p99: r2(pct(dts, 0.99)), mean: r2(mean(dts)) },
    fps: { p50: r1(1000 / (pct(dts, 0.5) || 1)), p95: r1(1000 / (pct(dts, 0.95) || 1)), mean: r1(1000 / (mean(dts) || 1)) },
    cpu: { p50: r2(pct(cpu, 0.5)), p95: r2(pct(cpu, 0.95)), max: r2(Math.max(...cpu)) },
    gpu: gpuAll.length ? { p50: r2(pct(gpuAll, 0.5)), p95: r2(pct(gpuAll, 0.95)), scene: r2(pct(gpuBy.scene, 0.5)), bloom: r2(pct(gpuBy.bloom, 0.5)), output: r2(pct(gpuBy.output, 0.5)), cockpit: gpuBy.cockpit ? r2(pct(gpuBy.cockpit, 0.5)) : 0, n: gpuAll.length, disjoint: data.disjoint } : null,
    draws: { calls: Math.round(pct(F.map((f) => f.calls), 0.5)), tris: Math.round(pct(F.map((f) => f.tris), 0.5)), points: Math.round(pct(F.map((f) => f.points), 0.5)), lines: Math.round(pct(F.map((f) => f.lines), 0.5)), shadowCalls: Math.round(pct(F.map((f) => f.shadowCalls), 0.5)), shadowTris: Math.round(pct(F.map((f) => f.shadowTris), 0.5)), cockpitCalls: Math.round(pct(F.map((f) => f.cockpitCalls || 0), 0.5)), cockpitTris: Math.round(pct(F.map((f) => f.cockpitTris || 0), 0.5)) },
    runtime: { needsUpdates: data.needsUpdates || 0, programsDelta: data.programsDelta || 0 },
    heap: { allocMBs: r2(alloc / 1048576 / (data.seconds || 1)), start: Math.round((F[0]?.heap || 0) / 1048576), end: Math.round((F[F.length - 1]?.heap || 0) / 1048576) },
    physics: { substepsP50: pct(sub, 0.5), substepsMax: Math.max(...sub) },
    parts: partsP50,
    dom: metricsDelta,
  };
  return out;
}

function metricsMap(m) { const o = {}; for (const x of m.metrics) o[x.name] = x.value; return o; }

// ------------------------------------------------------------------ CPU profile aggregation
function moduleMap(jsFile) {
  const lines = readFileSync(jsFile, 'utf8').split('\n');
  const marks = [];
  for (let i = 0; i < lines.length; i++) { const m = /^\s*\/\/ (\S+\.(?:m?js|glb))\s*$/.exec(lines[i]); if (m) marks.push([i + 1, m[1]]); }
  return (line) => { let name = '(bundle)'; for (const [l, n] of marks) { if (l <= line) name = n; else break; } return name; };
}
function aggregateProfile(profile, jsFile, seconds) {
  const modOf = moduleMap(jsFile);
  const nodes = new Map(); for (const n of profile.nodes) nodes.set(n.id, n);
  const parent = new Map(); for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const self = new Map(), incl = new Map(), mods = new Map();
  let total = 0;
  const keyOf = (n) => { const cf = n.callFrame; const fn = cf.functionName || '(anonymous)'; if (!cf.url) return fn; return `${fn}  ${modOf(cf.lineNumber + 1)}:${cf.lineNumber + 1}`; };
  const modOfNode = (n) => { const cf = n.callFrame; if (!cf.url) return cf.functionName || '(anonymous)'; return modOf(cf.lineNumber + 1); };
  for (let i = 0; i < profile.samples.length; i++) {
    const dt = (profile.timeDeltas[i] || 0) / 1000;
    total += dt;
    const n = nodes.get(profile.samples[i]); if (!n) continue;
    const k = keyOf(n); self.set(k, (self.get(k) || 0) + dt);
    const m = modOfNode(n); mods.set(m, (mods.get(m) || 0) + dt);
    const seen = new Set(); let id = n.id;
    while (id != null) { const nn = nodes.get(id); const kk = keyOf(nn); if (!seen.has(kk)) { seen.add(kk); incl.set(kk, (incl.get(kk) || 0) + dt); } id = parent.get(id); }
  }
  const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ name: k, ms: r1(v), pct: r1(100 * v / total) }));
  return { totalMs: r1(total), seconds, self: top(self, 30), inclusive: top(incl, 25), modules: top(mods, 25) };
}

// Sampling heap profile (HeapProfiler.startSampling): who allocates, by self size, function and module.
function aggregateAlloc(prof, jsFile, seconds) {
  const modOf = moduleMap(jsFile);
  const self = new Map(), mods = new Map(), stacks = new Map();
  let total = 0;
  const walk = (n, chain) => {
    const cf = n.callFrame; const fn = cf.functionName || '(anonymous)';
    const key = cf.url ? `${fn}  ${modOf(cf.lineNumber + 1)}:${cf.lineNumber + 1}` : fn;
    const mod = cf.url ? modOf(cf.lineNumber + 1) : fn;
    const here = [...chain, fn];
    if (n.selfSize) {
      total += n.selfSize;
      self.set(key, (self.get(key) || 0) + n.selfSize);
      mods.set(mod, (mods.get(mod) || 0) + n.selfSize);
      const sk = here.slice(-4).join(' < ');
      stacks.set(sk, (stacks.get(sk) || 0) + n.selfSize);
    }
    for (const c of n.children || []) walk(c, here);
  };
  walk(prof.head, []);
  const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ name: k, kb: Math.round(v / 1024), pct: r1(100 * v / (total || 1)) }));
  return { totalMB: r2(total / 1048576), perSecondMB: r2(total / 1048576 / (seconds || 1)), self: top(self, 25), modules: top(mods, 15), stacks: top(stacks, 20) };
}

// ------------------------------------------------------------------ one measurement
async function measure(o, jsFile) {
  const P = { scene: o.scene, camera: o.camera, quality: o.quality, auto: !!o.auto, seed: o.seed };
  const name = `probe-${o.port}`;
  const file = writePage(name, jsFile, P);
  const br = new Browser(o);
  const t0 = Date.now();
  await br.launch(o.port);
  try {
    if (o.phone) {
      await br.send('Emulation.setDeviceMetricsOverride', { width: o.w, height: o.h, deviceScaleFactor: o.dpr, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
      await br.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await br.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] });
      await br.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l' });
    } else {
      await br.send('Emulation.setDeviceMetricsOverride', { width: o.w, height: o.h, deviceScaleFactor: o.dpr, mobile: false });
    }
    if (o.cpu && o.cpu > 1) await br.send('Emulation.setCPUThrottlingRate', { rate: o.cpu });
    await br.send('Performance.enable');
    await br.send('Page.navigate', { url: `file:///${file}` });
    for (let i = 0; i < 600; i++) { const st = await br.eval('window.__perf ? { ready: window.__perf.ready, error: window.__perf.error } : null'); if (st && (st.ready || st.error)) { if (st.error) throw new Error(st.error); break; } await sleep(100); }
    if (!(await br.eval('!!(window.__perf && window.__perf.ready)'))) throw new Error('the game never became ready');
    // the engine holds the loop while the new flight's airframe arrives and its shaders compile (startCompile);
    // wait for that to clear so the sample is of the real thing (older builds without the flag: wait for the glTF)
    for (let i = 0; i < 100; i++) { if (o.scene === 'menu' || await br.eval('(window.game.compiling === false) || (window.game.compiling === undefined && !!(window.game.model && window.game.model.gltfRoot))')) break; await sleep(100); }
    const ablated = o.ablate.length ? await br.eval(`window.__ablate(${JSON.stringify(o.ablate)})`) : [];
    await sleep(o.warm * 1000);
    const m0 = metricsMap(await br.send('Performance.getMetrics').then((r) => r.result));
    if (o.profile) { await br.send('Profiler.enable'); await br.send('Profiler.setSamplingInterval', { interval: 250 }); await br.send('Profiler.start'); }
    // includeObjectsCollectedBy*: without these the sampler only reports what is still alive at the end, i.e. not the churn
    if (o.alloc) { await br.send('HeapProfiler.enable'); await br.send('HeapProfiler.startSampling', { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true }); }
    await br.eval('window.__perf.begin(); true');
    await sleep(o.seconds * 1000);
    const data = await br.eval('window.__perf.end()');
    let profile = null, alloc = null;
    if (o.profile) { const r = await br.send('Profiler.stop'); profile = r.result && r.result.profile; }
    if (o.alloc) { const r = await br.send('HeapProfiler.stopSampling'); alloc = r.result && r.result.profile; }
    const m1 = metricsMap(await br.send('Performance.getMetrics').then((r) => r.result));
    const secs = data.seconds || o.seconds;
    const dom = { layoutsPerS: r1((m1.LayoutCount - m0.LayoutCount) / secs), recalcPerS: r1((m1.RecalcStyleCount - m0.RecalcStyleCount) / secs), scriptPct: r1(100 * (m1.ScriptDuration - m0.ScriptDuration) / secs), layoutPct: r1(100 * ((m1.LayoutDuration - m0.LayoutDuration) + (m1.RecalcStyleDuration - m0.RecalcStyleDuration)) / secs), nodes: m1.Nodes };
    const stats = await br.eval('window.__perf.stats()');
    const census = o.census ? await br.eval('window.__census()') : null;
    if (o.shot) { const s = await br.send('Page.captureScreenshot', { format: 'png' }); if (s.result?.data) writeFileSync(o.shot, Buffer.from(s.result.data, 'base64')); }
    const err = await br.eval('window.__perf.error');
    const summary = summarize(data, dom);
    const result = {
      label: o.label || `${o.scene}/${o.camera}/${o.quality}${o.phone ? '/phone' : `/${o.w}x${o.h}@${o.dpr}`}${o.gpu ? '/' + o.gpu : ''}${o.cpu ? '/cpu' + o.cpu : ''}${o.raw ? '/raw' : o.visible ? '/vsync' : ''}${o.ablate.length ? '/-' + o.ablate.join(',-') : ''}`,
      opts: { scene: o.scene, camera: o.camera, quality: o.quality, w: o.w, h: o.h, dpr: o.dpr, phone: !!o.phone, gpu: o.gpu || 'default', cpu: o.cpu || 1, raw: !!o.raw, visible: !!o.visible, ablate: o.ablate, seed: o.seed },
      stats, ablated, ...summary, error: err || null,
      profile: profile ? aggregateProfile(profile, jsFile, secs) : null, alloc: alloc ? aggregateAlloc(alloc, jsFile, secs) : null, census, wall: r1((Date.now() - t0) / 1000), when: new Date().toISOString(),
    };
    return result;
  } finally { await br.close(); }
}

// ------------------------------------------------------------------ printing
function fmtRow(r) {
  const g = r.gpu ? `${r.gpu.p50.toFixed(1)}/${r.gpu.p95.toFixed(1)}` : '-';
  return `${r.label.padEnd(46)} ${String(r.fps.p50).padStart(6)} ${String(r.fps.p95).padStart(6)}  ${r.ft.p50.toFixed(1).padStart(6)} ${r.ft.p95.toFixed(1).padStart(6)}  ${r.cpu.p50.toFixed(1).padStart(5)} ${r.cpu.p95.toFixed(1).padStart(5)}  ${g.padStart(11)}  ${String(r.draws.calls).padStart(5)} ${String(Math.round(r.draws.tris / 1000)).padStart(6)}k ${String(r.stats.programs).padStart(4)}  ${String(r.heap.allocMBs).padStart(6)}`;
}
const HEADER = `${'label'.padEnd(46)} ${'fps50'.padStart(6)} ${'fps95'.padStart(6)}  ${'ft50'.padStart(6)} ${'ft95'.padStart(6)}  ${'cpu50'.padStart(5)} ${'cpu95'.padStart(5)}  ${'gpu50/95'.padStart(11)}  ${'calls'.padStart(5)} ${'tris'.padStart(7)} ${'prog'.padStart(4)}  ${'MB/s'.padStart(6)}`;

function printResult(r, verbose = true) {
  console.log(HEADER); console.log(fmtRow(r));
  if (!verbose) return;
  const s = r.stats;
  console.log(`  gpu: ${s.gpu}${s.timerQuery ? '' : '  (no timer query)'}`);
  console.log(`  buffer ${s.drawingBuffer.join('x')} (css ${s.css.join('x')} x dpr ${s.pixelRatio}, device ${s.devicePixelRatio})  composer ${s.composer} bloom ${s.bloom} rt ${s.rt ? `${s.rt.w}x${s.rt.h} msaa${s.rt.samples} type${s.rt.type}` : '-'}  shadows ${s.shadows} map ${s.shadowMap} type ${s.shadowType}  quality ${s.quality} touch ${s.touch} trees ${s.trees} gltf ${s.gltf}`);
  console.log(`  frames ${r.frames} in ${r.seconds}s  ft p99 ${r.ft.p99}  cpu max ${r.cpu.max}  gpu ${r.gpu ? `scene ${r.gpu.scene} bloom ${r.gpu.bloom} output ${r.gpu.output} (n=${r.gpu.n}, disjoint ${r.gpu.disjoint})` : '-'}`);
  if (s.startup && s.startup.startScenarioMs != null) console.log(`  start-up: loadSite ${Math.round(s.startup.loadSiteMs)} ms, startScenario ${Math.round(s.startup.startScenarioMs)} ms, first frame after ${Math.round(s.startup.firstFrameMs)} ms (its cpu ${Math.round(s.startup.firstFrameCpuMs)} ms), settled under 8 ms after ${s.startup.framesToSettle} frames`);
  console.log(`  draws: ${r.draws.calls} calls (${r.draws.shadowCalls} in the shadow pass), ${r.draws.tris} tris (${r.draws.shadowTris} shadow), ${r.draws.points} points, ${r.draws.lines} lines; geometries ${s.memory.geometries} textures ${s.memory.textures} programs ${s.programs}`);
  console.log(`  physics ${r.physics.substepsP50} sub-steps/frame (max ${r.physics.substepsMax}); heap ${r.heap.start}->${r.heap.end} MB, ${r.heap.allocMBs} MB/s allocated; dom ${r.dom.layoutsPerS} layouts/s ${r.dom.recalcPerS} recalcs/s, script ${r.dom.scriptPct}% layout+style ${r.dom.layoutPct}%`);
  console.log(`  cpu parts p50 ms: ` + Object.entries(r.parts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
  if (r.ablated.length) console.log(`  ablated: ${r.ablated.join(', ')}`);
  if (r.error) console.log(`  PAGE ERROR: ${r.error}`);
  if (r.profile) {
    const p = r.profile;
    console.log(`  profile: ${p.totalMs} ms sampled over ${p.seconds.toFixed(1)} s`);
    console.log('  top self time:'); for (const x of p.self) console.log(`    ${String(x.pct).padStart(5)}%  ${String(x.ms).padStart(7)} ms  ${x.name}`);
    console.log('  inclusive:'); for (const x of p.inclusive) console.log(`    ${String(x.pct).padStart(5)}%  ${String(x.ms).padStart(7)} ms  ${x.name}`);
    console.log('  by module:'); for (const x of p.modules) console.log(`    ${String(x.pct).padStart(5)}%  ${String(x.ms).padStart(7)} ms  ${x.name}`);
  }
  if (r.alloc) {
    const a = r.alloc;
    console.log(`  allocations: ${a.totalMB} MB sampled over the window (${a.perSecondMB} MB/s)`);
    console.log('  top allocating functions:'); for (const x of a.self) console.log(`    ${String(x.pct).padStart(5)}%  ${String(x.kb).padStart(7)} KB  ${x.name}`);
    console.log('  by module:'); for (const x of a.modules) console.log(`    ${String(x.pct).padStart(5)}%  ${String(x.kb).padStart(7)} KB  ${x.name}`);
    console.log('  call chains (innermost first):'); for (const x of a.stacks) console.log(`    ${String(x.pct).padStart(5)}%  ${String(x.kb).padStart(7)} KB  ${x.name}`);
  }
  if (r.census) {
    console.log('  census (visible objects by owner):');
    console.log(`    ${'owner'.padEnd(52)} ${'objs'.padStart(5)} ${'draws'.padStart(5)} ${'tris'.padStart(9)} ${'points'.padStart(7)} ${'inst'.padStart(6)} ${'cast'.padStart(4)} ${'recv'.padStart(4)} ${'trans'.padStart(5)} ${'nocull'.padStart(6)} ${'geo'.padStart(4)} ${'mat'.padStart(4)}`);
    for (const [k, v] of Object.entries(r.census.owners)) console.log(`    ${k.padEnd(52)} ${String(v.objects).padStart(5)} ${String(v.draws).padStart(5)} ${String(v.tris).padStart(9)} ${String(v.points).padStart(7)} ${String(v.instances).padStart(6)} ${String(v.casters).padStart(4)} ${String(v.receivers).padStart(4)} ${String(v.transparent).padStart(5)} ${String(v.uncullable).padStart(6)} ${String(v.geometries).padStart(4)} ${String(v.materials).padStart(4)}`);
    console.log(`    lights: ${r.census.lights.join(', ')}`);
    console.log('    programs: ' + Object.entries(r.census.programs).map(([k, v]) => `${k} x${v}`).join(', '));
    if (r.census.offenders && r.census.offenders.length) console.log('    frustumCulled=false on: ' + r.census.offenders.map((x) => `${x.owner}/${x.type}${x.name ? '(' + x.name + ')' : ''}`).join(', '));
    console.log(`    runtime: ${r.runtime.needsUpdates} needsUpdate sets, ${r.runtime.programsDelta} new programs during the window; cockpit pass ${r.draws.cockpitCalls} draws / ${r.draws.cockpitTris} tris`);
    console.log('    textures: ' + r.census.textures.map((t) => `${t.w}x${t.h}${t.mip ? 'm' : ''}${t.aniso > 1 ? 'a' + t.aniso : ''}[${t.where.split(' ')[0]}]`).join(' '));
  }
}

// ------------------------------------------------------------------ the standard matrix
const MATRIX = {
  // desktop, 1920x1080, DPR 1, the RTX: every scene at high, then the tiers and cameras on the plains
  desktop: [
    ...['solo', 'heavy', 'cq', 'night', 'gravel', 'fog'].map((scene) => ({ scene, camera: 'chase', quality: 'high' })),
    { scene: 'solo', camera: 'cockpit', quality: 'high' }, { scene: 'heavy', camera: 'cockpit', quality: 'high' },
    { scene: 'solo', camera: 'chase', quality: 'medium' }, { scene: 'solo', camera: 'chase', quality: 'low' },
    { scene: 'heavy', camera: 'chase', quality: 'medium' }, { scene: 'heavy', camera: 'chase', quality: 'low' },
  ],
  // the phone viewport, touch path, on the RTX (what the phone's DPR costs) and on the iGPU with a slow CPU (the Pixel proxy)
  phone: [
    ...['solo', 'heavy', 'cq', 'gravel'].flatMap((scene) => ['low', 'medium', 'high'].map((quality) => ({ scene, camera: 'chase', quality, phone: true }))),
  ],
  proxy: [
    ...['solo', 'heavy', 'cq', 'gravel'].flatMap((scene) => ['low', 'medium', 'high'].map((quality) => ({ scene, camera: 'chase', quality, phone: true, gpu: 'intel', cpu: 3 }))),
  ],
  // phase 3 (merged art): six scenes, chase and cockpit, on the three devices
  'p3-desktop': ['solo', 'heavy', 'cq', 'night', 'gravel', 'fog'].flatMap((scene) => ['chase', 'cockpit'].map((camera) => ({ scene, camera, quality: 'high' }))),
  'p3-phone': ['solo', 'heavy', 'cq', 'night', 'gravel', 'fog'].flatMap((scene) => ['chase', 'cockpit'].map((camera) => ({ scene, camera, quality: 'medium', phone: true }))),
  'p3-proxy': ['solo', 'heavy', 'cq', 'night', 'gravel', 'fog'].flatMap((scene) => ['low', 'medium', 'high'].flatMap((quality) => ['chase', 'cockpit'].map((camera) => ({ scene, camera, quality, phone: true, gpu: 'intel', cpu: 3 })))),
  // the missions expansion's new maps (2026-09-17): island, island airliner field, desert mesa, frozen lake
  maps: ['hill-hop', 'beach-buzz', 'mesa-top', 'whiteout', 'dust-wall'].flatMap((scene) => ['chase', 'cockpit'].map((camera) => ({ scene, camera, quality: 'high' }))),
  'maps-phone': ['hill-hop', 'beach-buzz', 'mesa-top', 'whiteout'].map((scene) => ({ scene, camera: 'chase', quality: 'medium', phone: true })),
  // price list: what each feature costs on the plains and the coast at high
  ablation: [
    ...['solo', 'heavy'].flatMap((scene) => ['', 'shadows', 'pcf', 'shadow:2048', 'composer', 'bloom', 'msaa:0', 'clouds', 'sky', 'forest', 'terrain', 'water', 'airport', 'aircraft', 'hud', 'hudjs', 'vignette', 'fog', 'physics'].map((a) => ({ scene, camera: 'chase', quality: 'high', ablate: a ? [a] : [] }))),
  ],
};

// ------------------------------------------------------------------ budgets (docs/PERF.md section 5)
// `--budget`: the census as pass/fail. One row per (owner, metric): measured, budget, ok/BREACH/info.
// Structural budgets (draws, triangles after culling, materials, transparency, lights, textures,
// programs, culling flags, runtime needsUpdate sets) hold on any GPU; the GPU-millisecond budgets
// are stated for the Intel UHD 770 (the mobile stand-in) and are only asserted when the run is on
// it - elsewhere they are printed as `info`. Exit code 1 when any row breaches.
const MB = 1048576;
function budgetChecks(r) {
  const c = r.census, s = r.stats, o = r.opts;
  const zero = { objects: 0, draws: 0, tris: 0, visibleDraws: 0, visibleTris: 0, points: 0, casters: 0, receivers: 0, transparent: 0, uncullable: 0, instances: 0, geometries: 0, materials: 0 };
  const ow = (name) => c.owners[name] || zero;
  const checks = [];
  const add = (owner, metric, measured, budget, opts = {}) => checks.push({ owner, metric, measured, budget, ok: opts.info ? null : measured <= budget, note: opts.note || '' });
  const intel = /intel/i.test(s.gpu || '');
  const treeScale = s.treeScale || 1;
  const veg = ow('vegetation+props (instanced)');
  const vegBudget = Math.round(({ plains: 1.2e6, coast: 1.2e6, mountain: 2.0e6, sea: 0, island: 1.2e6, arctic: 1.2e6, desert: 0.2e6 }[s.style] ?? 1.2e6) * treeScale);
  add('vegetation+props', 'visible triangles (main pass, after culling)', veg.visibleTris, vegBudget, { note: `treeScale ${treeScale}, ${veg.visibleDraws}/${veg.draws} chunks in view` });
  add('ground', 'draws (LOD tiles)', ow('ground').draws, 24);   // world-ground.js: 16 central + 8 outer tiles by design
  add('water', 'draws', ow('water').draws, 1);
  add('sky+clouds+stars', 'draws', ow('sky dome').draws + ow('clouds').draws + ow('stars').draws, 4);
  add('terrain other', 'draws (roads, obstacle trees)', ow('terrain other (roads, obstacle trees)').draws, 40);
  const ap = ow('airport'), pk = ow('parked aircraft');
  if (ap.objects) {
    add('airport (excl. parked)', 'draws', ap.draws, 60);
    add('airport (excl. parked)', 'materials', ap.materials, 20);
    add('airport (incl. parked)', 'transparent draws', ap.transparent + pk.transparent, 12);
    add('parked aircraft', 'draws', pk.draws, 10 * Math.max(1, c.parkedCount || 0), { note: `${c.parkedCount || 0} parked airframes` });
  }
  const car = ow('carrier');
  if (car.objects) { add('carrier', 'draws', car.draws, 80); add('carrier', 'triangles', car.tris, 100000); }
  const ac = ow('aircraft');
  add('aircraft', 'draws', ac.draws, s.aircraft === 'condor' ? 24 : 20, { note: s.aircraft });
  add('aircraft', 'triangles', ac.tris, 60000);
  const acTex = c.textures.filter((t) => t.where === 'aircraft').reduce((a, t) => a + (t.bytes || 0), 0);
  add('aircraft', 'texture MB', +(acTex / MB).toFixed(2), 4);
  if (o.camera === 'cockpit') {
    const cp = ow('cockpit');
    add('cockpit', 'draws (its pass)', r.draws.cockpitCalls || cp.draws, 20, { note: cp.objects ? `${cp.objects} objects` : 'no interior in this build' });
    add('cockpit', 'triangles', Math.max(r.draws.cockpitTris || 0, cp.tris), 80000);
    add('cockpit', 'GPU ms (UHD 770)', r.gpu ? r.gpu.cockpit : 0, 2, { info: !intel, note: intel ? '' : 'informational off the reference GPU' });
  }
  const pt = ow('particles');
  add('particles', 'points drawn per frame on a clean approach', pt.points, 4000, { note: 'the rule is no draw while idle; 4,000 is the live cap' });
  add('particles', 'draws', pt.draws, 8);
  add('scene', 'programs', s.programs, 70);
  const L = c.lightDetail || [];
  const count = (t) => L.filter((l) => l.type === t).length;
  add('scene', 'DirectionalLight', count('DirectionalLight'), 2); add('scene', 'HemisphereLight', count('HemisphereLight'), 1);
  add('scene', 'SpotLight', count('SpotLight'), 1); add('scene', 'PointLight', count('PointLight'), 0);
  add('scene', 'lights visible at intensity 0', L.filter((l) => l.visible && l.intensity === 0).length, 0, { note: 'the moon by day: set visible=false' });
  const texAll = c.textures.filter((t) => t.where !== 'shadow map').reduce((a, t) => a + (t.bytes || 0), 0);
  add('scene', 'texture MB (excl. shadow map)', +(texAll / MB).toFixed(2), 12);
  add('scene', 'frustumCulled=false on meshes (sky/clouds/stars/water/points allowed)', (c.offenders || []).length, 0, { note: (c.offenders || []).slice(0, 4).map((x) => x.owner + '/' + (x.name || x.type)).join(', ') });
  add('scene', 'material.needsUpdate sets during the window', r.runtime.needsUpdates, 0, { note: (c.twoPass || []).length ? 'two-pass (transparent DoubleSide, no forceSinglePass): ' + c.twoPass.map((t) => `${t.name} x${t.objects}`).join(', ') : '' });
  add('scene', 'transparent DoubleSide materials without forceSinglePass', (c.twoPass || []).length, 0, { note: (c.twoPass || []).map((t) => t.name).join(', ') });
  add('scene', 'programs compiled during the window', r.runtime.programsDelta, 0);
  const gpuAsserted = intel && o.phone && o.quality === 'medium';
  add('frame', 'GPU ms p50', r.gpu ? r.gpu.p50 : 0, 16, { info: !gpuAsserted, note: gpuAsserted ? 'phone medium on the UHD 770' : 'asserted on the Intel proxy at phone medium (--gpu intel --phone --cpu 3 --quality medium)' });
  return checks;
}
function printBudget(r, checks) {
  console.log(`\n${r.label}   (${r.fps.p50} fps, ${r.draws.calls} draws, ${r.stats.gpu.split('(')[0].trim()})`);
  console.log(`  ${'owner'.padEnd(24)} ${'metric'.padEnd(64)} ${'measured'.padStart(10)} ${'budget'.padStart(9)}  result`);
  for (const c of checks) console.log(`  ${c.owner.padEnd(24)} ${c.metric.padEnd(64)} ${String(c.measured).padStart(10)} ${String(c.budget).padStart(9)}  ${c.ok === null ? 'info' : c.ok ? 'ok' : 'BREACH'}${c.note ? '   ' + c.note : ''}`);
}
const BUDGET_MATRIX = ['solo', 'heavy', 'night', 'gravel', 'fog'].flatMap((scene) => ['chase', 'cockpit'].map((camera) => ({ scene, camera })));

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const jsFile = await bundle(o.minify);
  if (o.budget) {
    let breaches = 0, total = 0;
    const failed = [];
    const list = o.scenes ? o.scenes.flatMap((scene) => ['chase', 'cockpit'].map((camera) => ({ scene, camera }))) : BUDGET_MATRIX;
    for (let i = 0; i < list.length; i++) {
      const oo = { ...o, ...list[i] };
      process.stdout.write(`[${i + 1}/${list.length}] ${oo.scene}/${oo.camera}/${oo.quality}${oo.phone ? '/phone' : ''}${oo.gpu ? '/' + oo.gpu : ''} ... `);
      try {
        const r = await measure(oo, jsFile);
        const checks = budgetChecks(r);
        r.budget = checks;
        printBudget(r, checks);
        for (const c of checks) { if (c.ok === null) continue; total++; if (!c.ok) { breaches++; failed.push(`${r.label}: ${c.owner} ${c.metric} = ${c.measured} > ${c.budget}`); } }
        if (o.json) appendFileSync(o.json, JSON.stringify(r) + '\n');
      } catch (e) { console.log('FAILED: ' + (e.message || e)); breaches++; failed.push(`${oo.scene}/${oo.camera}: run failed (${e.message || e})`); }
    }
    console.log(`\n${breaches} breach${breaches === 1 ? '' : 'es'} in ${total} checks`);
    for (const f of failed) console.log('  ' + f);
    process.exit(breaches ? 1 : 0);
  }
  if (!o.matrix) {
    const r = await measure(o, jsFile);
    if (o.json) appendFileSync(o.json, JSON.stringify(r) + '\n');   // before printing: a closed pipe (| head) must not lose the record
    printResult(r, true);
    return;
  }
  const set = MATRIX[o.matrix];
  if (!set) throw new Error('no matrix ' + o.matrix + ' (have ' + Object.keys(MATRIX).join(', ') + ')');
  const rows = [];
  for (let i = 0; i < set.length; i++) {
    const oo = { ...o, ...set[i], ablate: set[i].ablate || [] };
    if (oo.phone) { oo.w = 1088; oo.h = 430; oo.dpr = 2.625; }
    process.stdout.write(`[${i + 1}/${set.length}] ${oo.scene}/${oo.camera}/${oo.quality}${oo.phone ? '/phone' : ''}${oo.gpu ? '/' + oo.gpu : ''}${oo.cpu ? '/cpu' + oo.cpu : ''}${oo.ablate.length ? '/-' + oo.ablate.join(',-') : ''} ... `);
    try {
      const r = await measure(oo, jsFile);
      rows.push(r);
      console.log(`${r.fps.p50} fps (p95 ${r.fps.p95}), cpu ${r.cpu.p50} ms, gpu ${r.gpu ? r.gpu.p50 : '-'} ms, ${r.draws.calls} calls, ${r.wall}s`);
      if (o.json) appendFileSync(o.json, JSON.stringify(r) + '\n');
    } catch (e) { console.log('FAILED: ' + (e.message || e)); }
  }
  console.log('\n' + HEADER);
  for (const r of rows) console.log(fmtRow(r));
  const gpus = [...new Set(rows.map((r) => r.stats.gpu))];
  console.log(`\nrendered on: ${gpus.join(' | ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
