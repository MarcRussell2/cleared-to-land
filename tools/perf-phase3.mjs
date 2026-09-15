// Phase-3 tables for docs/PERF.md section 9: the merged art tree against section 7's "After".
//   node tools/perf-phase3.mjs <p3dir> <after.jsonl>
//   p3dir holds desktop.jsonl, phone.jsonl, proxy.jsonl, ablate.jsonl from the phase-3 chain.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const [dir, afterFile] = process.argv.slice(2);
const load = (f) => existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const f1 = (x) => (x == null ? '-' : (Math.round(x * 10) / 10).toString());
const byLabel = (rows) => new Map(rows.map((r) => [r.label, r]));
const after = byLabel(load(afterFile));
const desktop = load(join(dir, 'desktop.jsonl')), phone = load(join(dir, 'phone.jsonl')), proxy = load(join(dir, 'proxy.jsonl')), abl = load(join(dir, 'ablate.jsonl'));
const gpu = (r) => (r.gpu ? f1(r.gpu.p50) : '-');
const parts = (r) => { const p = r.parts || {}; return `render ${f1(p.render)} hud ${f1(p.hud)} fx ${f1(p.effects)}${p.cockpitUpdate != null ? ' cockpit ' + f1((p.cockpitUpdate || 0) + (p.cockpitSync || 0)) : ''}`; };
const owner = (r, name) => (r.census && r.census.owners[name]) || null;

console.log('### Desktop, RTX 4080, 1920x1080 high (section 7 "after" -> merged art)\n');
console.log('| scene / camera | fps50 | fps95 | cpu50 ms | gpu50 ms (scene/cockpit/bloom) | draws | tris (shadow) | load ms | parts p50 ms |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of desktop) {
  const prev = after.get(r.label);
  const d = (a, b, fmt = f1) => (prev ? `${fmt(a)} -> **${fmt(b)}**` : `**${fmt(b)}**`);
  console.log(`| ${r.opts.scene} / ${r.opts.camera} | ${d(prev && prev.fps.p50, r.fps.p50)} | ${d(prev && prev.fps.p95, r.fps.p95)} | ${d(prev && prev.cpu.p50, r.cpu.p50)} | ${gpu(r)} (${r.gpu ? `${f1(r.gpu.scene)}/${f1(r.gpu.cockpit)}/${f1(r.gpu.bloom)}` : '-'}) | ${prev ? prev.draws.calls + ' -> ' : ''}${r.draws.calls} | ${prev ? (prev.draws.tris / 1e6).toFixed(2) + 'M -> ' : ''}${(r.draws.tris / 1e6).toFixed(2)}M (${(r.draws.shadowTris / 1e6).toFixed(2)}M) | ${Math.round(r.stats.startup.loadSiteMs)} | ${parts(r)} |`);
}

console.log('\n### Phone viewport on the RTX, medium (the phone tiers\' CPU without a slow GPU)\n');
console.log('| scene / camera | fps50 | cpu50 ms | gpu50 ms | draws | tris | parts p50 ms |');
console.log('|---|---|---|---|---|---|---|');
for (const r of phone) console.log(`| ${r.opts.scene} / ${r.opts.camera} | ${f1(r.fps.p50)} | ${f1(r.cpu.p50)} | ${gpu(r)} | ${r.draws.calls} | ${(r.draws.tris / 1e6).toFixed(2)}M | ${parts(r)} |`);

console.log('\n### The Pixel proxy (Intel UHD 770, CPU x3, phone viewport): section 7 -> merged art\n');
console.log('| scene / tier / camera | fps50 | fps95 | cpu50 ms | gpu50 ms (scene/cockpit/bloom) | draws | tris | veg tris in view |');
console.log('|---|---|---|---|---|---|---|---|');
for (const r of proxy) {
  const prev = after.get(r.label);
  const veg = owner(r, 'vegetation+props (instanced)');
  console.log(`| ${r.opts.scene} / ${r.opts.quality} / ${r.opts.camera} | ${prev ? f1(prev.fps.p50) + ' -> ' : ''}**${f1(r.fps.p50)}** | ${f1(r.fps.p95)} | ${prev ? f1(prev.cpu.p50) + ' -> ' : ''}${f1(r.cpu.p50)} | ${prev ? gpu(prev) + ' -> ' : ''}${gpu(r)} (${r.gpu ? `${f1(r.gpu.scene)}/${f1(r.gpu.cockpit)}/${f1(r.gpu.bloom)}` : '-'}) | ${r.draws.calls} | ${(r.draws.tris / 1e6).toFixed(2)}M | ${veg ? (veg.visibleTris / 1e6).toFixed(2) + 'M' : '-'} |`);
}

if (abl.length) {
  console.log('\n### Price list on the proxy (phone medium), merged art\n');
  console.log('| run | fps50 | frame ms | gpu ms | delta gpu vs baseline | cpu ms |');
  console.log('|---|---|---|---|---|---|');
  const base = {};
  for (const r of abl) if (!r.opts.ablate.length) base[`${r.opts.scene}/${r.opts.camera}/${r.opts.quality}`] = r;
  for (const r of abl) {
    const b = base[`${r.opts.scene}/${r.opts.camera}/${r.opts.quality}`];
    const dg = b && r.gpu && b.gpu && r.opts.ablate.length ? f1(b.gpu.p50 - r.gpu.p50) : '-';
    console.log(`| ${r.opts.scene}/${r.opts.camera}/${r.opts.quality}${r.opts.ablate.length ? ' -' + r.opts.ablate.join(',-') : ''} | ${f1(r.fps.p50)} | ${f1(r.ft.p50)} | ${gpu(r)} | ${dg} | ${f1(r.cpu.p50)} |`);
  }
}
