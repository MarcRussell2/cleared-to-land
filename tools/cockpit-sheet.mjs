// The cockpit sheet: every aircraft's interior from the cockpit camera - the panel straight
// ahead with the controls deflected, the head turned to the left window and to the right
// window - shot deterministically and laid out on one contact sheet, the way the website
// harness's looksheet.mjs does for the world. Twelve stills at 1600x900.
//
//   node tools/cockpit-sheet.mjs <outDir> [id ...]      (no ids = all four aircraft)
//
// Env: CTL_WEB_DIR   the packaged game (web/), default: the web/ folder of this repository
//      CTL_SHOTS_DIR scratch for the driven pages, default C:/tmp/ctl-shots
//      CTL_SHOT_PORT first DevTools port (default 9680; twelve consecutive ports are used)
// The driven pages come from tools/make-page.mjs (seed pinned) and the stills from
// tools/surfshot.mjs, which also prints each frame's draw calls and triangles and the
// console errors - so this is the budget and shader check for the interiors as well.
import { mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOOLS = dirname(fileURLToPath(import.meta.url));
const S = (process.env.CTL_SHOTS_DIR || 'C:/tmp/ctl-shots').replace(/\\/g, '/');
const PORT = +(process.env.CTL_SHOT_PORT || 9680);
// sharp lives in the website repo's node_modules (this repo has no image dependency)
// sharp: `npm install --no-save sharp` in this repository, or point CTL_SHARP at an installed copy
const SHARP = process.env.CTL_SHARP || fileURLToPath(new URL('../node_modules/sharp/lib/index.js', import.meta.url));

const SCENES = { skylark: 'solo', trailblazer: 'gravel', condor: 'heavy', hornet: 'cq' };
const VIEWS = [
  ['panel', { mode: 'cockpit', deflect: true, elevator: 0.6, aileron: 0.7, rudder: 0.5, flap: 1 }],
  // camera.js: a positive head yaw turns the head to the RIGHT (a rightward drag)
  ['left', { mode: 'cockpit', headYaw: -1.35, headPitch: -0.15 }],
  ['right', { mode: 'cockpit', headYaw: 1.35, headPitch: -0.15 }],
];
const outDir = (process.argv[2] || './cockpit-sheet').replace(/\\/g, '/');
const ids = process.argv.slice(3).length ? process.argv.slice(3) : Object.keys(SCENES);
mkdirSync(outDir, { recursive: true });
mkdirSync(S, { recursive: true });

const done = [];
let port = PORT;
for (const id of ids) {
  const page = `ck-${id}`;
  execFileSync('node', [join(TOOLS, 'make-page.mjs'), page, JSON.stringify({ scenario: SCENES[id], camera: 'chase', drive: true, hints: false, seed: 4271 })], { cwd: S, stdio: 'inherit' });
  for (const [view, opts] of VIEWS) {
    const png = resolve(outDir, `${id}-${view}.png`);
    process.stdout.write(`${id} ${view}: `);
    const out = execFileSync('node', [join(TOOLS, 'surfshot.mjs'), page, png, 't > 1.5', '100', JSON.stringify(opts), String(port++)], { env: { ...process.env, CTL_SHOTS_DIR: S } }).toString();
    const m = out.match(/cockpit (\d+) calls \/ (\d+) tris/);
    const errs = /console clean/.test(out) ? '' : ' CONSOLE ERRORS';
    console.log((m ? `cockpit ${m[1]} draws, ${m[2]} tris` : 'no cockpit count') + errs);
    if (!/console clean/.test(out)) console.log(out);
    done.push({ id, view, png, note: m ? `${m[1]} draws / ${m[2]} tris` : '' });
  }
}

if (!existsSync(SHARP)) { console.log(`no sharp at ${SHARP}: stills only`); process.exit(0); }
const sharp = (await import(pathToFileURL(SHARP).href)).default;
const COLS = 3, TW = 640, TH = 360, PAD = 8, CAP = 22;
const rows = Math.ceil(done.length / COLS);
const W = COLS * TW + (COLS + 1) * PAD, H = rows * (TH + CAP) + (rows + 1) * PAD;
const layers = [];
for (let i = 0; i < done.length; i++) {
  const cx = PAD + (i % COLS) * (TW + PAD), cy = PAD + Math.floor(i / COLS) * (TH + CAP + PAD);
  layers.push({ input: await sharp(done[i].png).resize(TW, TH).toBuffer(), left: cx, top: cy });
  const label = `${done[i].id} - ${done[i].view}  ${done[i].note}`.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  layers.push({ input: Buffer.from(`<svg width="${TW}" height="${CAP}"><text x="2" y="15" font-family="Segoe UI, sans-serif" font-size="13" fill="#dfe6ee">${label}</text></svg>`), left: cx, top: cy + TH });
}
await sharp({ create: { width: W, height: H, channels: 3, background: '#14181d' } }).composite(layers).jpeg({ quality: 86 }).toFile(join(outDir, 'cockpit-sheet.jpg'));
console.log(`\n${done.length} stills -> ${outDir} (cockpit-sheet.jpg)`);
