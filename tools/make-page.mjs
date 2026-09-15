// Build a self-driving copy of the CLEARED TO LAND page for headless stills - a copy of the website
// repo's tools/ctl-shots/make.mjs (2026-09-14) with three switches the aircraft work needs:
//   "noGltf": true    force the procedural airframes (window.CTL_NO_GLTF) so a pass on
//                     src/art/airframes/ can be reviewed while the glTF still ships
//   "gltf": true      force the downloaded models (window.CTL_GLTF)
//   "seed": 4271      pin the flight seed (window.CTL_WIND_SEED) so two stills compare
// usage: node tools/make-page.mjs <name> '<json params>'     (writes <name>.html in the cwd)
// Params otherwise as make.mjs: scenario, camera, approach, hud, hints, keyStrip, settings, drive, freeze.
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
const [name, json] = process.argv.slice(2);
const P = JSON.parse(json);
const game = (process.env.CTL_WEB_DIR || fileURLToPath(new URL('../web', import.meta.url))).replace(/\\/g, '/');
let html = readFileSync(`${game}/index.html`, 'utf8');
html = html.replaceAll('url(fonts/', `url(file:///${game.replace(/ /g, '%20')}/fonts/`);
const flags = [
  P.noGltf ? 'window.CTL_NO_GLTF = true;' : '',
  P.gltf ? 'window.CTL_GLTF = true;' : '',
  P.seed ? `window.CTL_WIND_SEED = ${+P.seed};` : '',
].join(' ');
const inject = `<script>
(function(){
  ${flags}
  const P = ${JSON.stringify(P)};
  const s = {quality:'high',sensitivity:1,mouseSens:0.5,volume:0,voice:false,hints:P.hints!==false,invert:false,camera:P.camera||'chase',approach:P.approach||'short',autoTrim:true,keyStrip:P.keyStrip!==false, ...(P.settings||{})};
  localStorage.setItem('ctl.settings', JSON.stringify(s));
  localStorage.setItem('ctl.best', JSON.stringify(P.best||{}));
  if (P.free) localStorage.setItem('ctl.free', JSON.stringify(P.free));
  window.__shot = {started:false, frozen:false, t:0};
  const step = (g) => { const dt = 1/25;
    window.__advance = function(n, render) { for (let i = 0; i < n; i++) { if (g.state === 'flying') g.frame(dt); else if (g.state === 'debrief' && g.ac) g.frameBackground(dt); } if (render !== false) g.render(); };
    window.__step = function(n) { window.__advance(n, true); return g.state + ' t=' + g.t.toFixed(2) + ' ra=' + (g.ac ? (g.ac.radioAlt/0.3048).toFixed(0) : '-') + ' d=' + (g.distToThreshold ? g.distToThreshold().toFixed(0) : '-'); };
    window.__runUntil = function(expr, max) { const f = new Function('g','ac','ra','d','t', 'return (' + expr + ')'); for (let i = 0; i < max; i++) { window.__advance(1, false); const ac = g.ac; if (!ac) continue; const ra = ac.radioAlt / 0.3048; const d = g.distToThreshold ? g.distToThreshold() : 0; if (f(g, ac, ra, d, g.t)) { g.render(); return i; } } g.render(); return -1; };
  };
  const iv = setInterval(() => {
    const g = window.game; if (!g || !window.G || document.readyState !== 'complete') return; clearInterval(iv);
    window.__shot.started = true;
    g.loop = function(){};
    if (P.scenario && P.scenario !== 'menu') {
      const sc = P.scenario === 'free' ? null : window.G.SCENARIOS.find(x => x.id === P.scenario);
      if (P.scenario === 'free') g.startFree(); else g.startScenario(sc);
      if (P.autopilot !== false) g.setAutopilot(true);
      if (P.camera) g.rig.setMode(P.camera);
      if (P.hud === false) g.hud.visible = false;
    }
    step(g);
    window.__shot.ready = true;
  }, 50);
})();
</script>`;
html = html.replace('<body>', '<body>\n' + inject);
writeFileSync(`${name}.html`, html);
console.log(`${name}.html written${flags ? ' (' + flags.trim() + ')' : ''}`);
