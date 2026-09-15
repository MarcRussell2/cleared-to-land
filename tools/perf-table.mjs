// Turn perf-probe JSON lines into a Markdown table (for docs/PERF.md).
//   node tools/perf-table.mjs <file.jsonl> [filter]     filter: comma-separated label substrings, "!x" excludes
import { readFileSync } from 'node:fs';
const [file, filter = ''] = process.argv.slice(2);
const terms = filter.split(',').filter(Boolean);
const keep = (label) => terms.every((t) => (t.startsWith('!') ? !label.includes(t.slice(1)) : label.includes(t)));
const rows = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => keep(r.label));
const f1 = (x) => (x == null ? '-' : (Math.round(x * 10) / 10).toString());
console.log('| scene / camera / tier | fps50 | fps95 | ft50 ms | cpu50 ms | gpu50 ms (scene/bloom/out) | draws | tris | sub-steps | notes |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const o = r.opts;
  const label = `${o.scene} / ${o.camera} / ${o.quality}`;
  const gpu = r.gpu ? `${f1(r.gpu.p50)} (${f1(r.gpu.scene)}/${f1(r.gpu.bloom)}/${f1(r.gpu.output)})` : '-';
  const parts = r.parts || {};
  const notes = [`render ${f1(parts.render)} hud ${f1(parts.hud)} phys ${f1(parts.physics)}`, r.stats.trees ? `${r.stats.trees} trees` : '', `${r.stats.drawingBuffer.join('x')}`].filter(Boolean).join(', ');
  console.log(`| ${label} | ${f1(r.fps.p50)} | ${f1(r.fps.p95)} | ${f1(r.ft.p50)} | ${f1(r.cpu.p50)} | ${gpu} | ${r.draws.calls} | ${(r.draws.tris / 1e6).toFixed(2)}M | ${r.physics.substepsP50} | ${notes} |`);
}
