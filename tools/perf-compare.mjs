// Before/after table from two perf-probe JSON-line files, matched by label.
//   node tools/perf-compare.mjs <before.jsonl> <after.jsonl> [filter]     (filter as in perf-table.mjs)
import { readFileSync } from 'node:fs';
const [a, b, filter = ''] = process.argv.slice(2);
const terms = filter.split(',').filter(Boolean);
const keep = (label) => terms.every((t) => (t.startsWith('!') ? !label.includes(t.slice(1)) : label.includes(t)));
const load = (f) => new Map(readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.label, r]));
const A = load(a), B = load(b);
const f1 = (x) => (x == null ? '-' : (Math.round(x * 10) / 10).toString());
console.log('| scene / camera / tier / device | fps50 before -> after | fps95 | cpu50 ms | gpu50 ms | draws | tris |');
console.log('|---|---|---|---|---|---|---|');
for (const [label, r2] of B) {
  if (!keep(label)) continue;
  const r1 = A.get(label);
  const lbl = label.replace(/\/1920x1080@1/, '').replace(/\/chase/, '');
  if (!r1) { console.log(`| ${lbl} | - -> ${f1(r2.fps.p50)} | - -> ${f1(r2.fps.p95)} | - -> ${f1(r2.cpu.p50)} | - -> ${r2.gpu ? f1(r2.gpu.p50) : '-'} | - -> ${r2.draws.calls} | - -> ${(r2.draws.tris / 1e6).toFixed(2)}M |`); continue; }
  console.log(`| ${lbl} | ${f1(r1.fps.p50)} -> **${f1(r2.fps.p50)}** | ${f1(r1.fps.p95)} -> ${f1(r2.fps.p95)} | ${f1(r1.cpu.p50)} -> ${f1(r2.cpu.p50)} | ${r1.gpu ? f1(r1.gpu.p50) : '-'} -> ${r2.gpu ? f1(r2.gpu.p50) : '-'} | ${r1.draws.calls} -> ${r2.draws.calls} | ${(r1.draws.tris / 1e6).toFixed(2)}M -> ${(r2.draws.tris / 1e6).toFixed(2)}M |`);
}
