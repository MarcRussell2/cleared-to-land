// The art bench fence.
//
// Work on the look is scoped to src/art/ (see src/art/AGENTS.md). This repository
// is not under version control, so there is no `git status` to check afterwards:
// this script is the substitute. Take a snapshot before handing the job over, check
// it after, and restore anything that was touched outside the fence.
//
//   node tools/art-fence.mjs snapshot    before the run
//   node tools/art-fence.mjs check       after it: lists anything out of bounds
//   node tools/art-fence.mjs restore     puts the out-of-bounds files back
//
// "Out of bounds" means anything under src/ or tools/, plus package.json, that is
// not inside src/art/. Changes inside src/art/ are the point and are only counted.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, statSync, mkdirSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, posix } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STORE = join(ROOT, 'backups', 'art-fence');
const MANIFEST = join(STORE, 'manifest.json');
const WATCHED = ['src', 'tools'];
const WATCHED_FILES = ['package.json'];
const FENCE = 'src/art/';

const rel = (abs) => relative(ROOT, abs).split('\\').join(posix.sep);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

function files() {
  const out = [];
  for (const d of WATCHED) if (existsSync(join(ROOT, d))) walk(join(ROOT, d), out);
  for (const f of WATCHED_FILES) if (existsSync(join(ROOT, f))) out.push(join(ROOT, f));
  return out.map(rel).sort();
}

const hash = (r) => createHash('sha256').update(readFileSync(join(ROOT, r))).digest('hex').slice(0, 16);
const inFence = (r) => r.startsWith(FENCE);

const cmd = process.argv[2];

if (cmd === 'snapshot') {
  rmSync(STORE, { recursive: true, force: true });
  mkdirSync(STORE, { recursive: true });
  const manifest = {};
  for (const r of files()) {
    manifest[r] = hash(r);
    if (inFence(r)) continue;             // only the outside needs a copy to restore from
    const dest = join(STORE, 'tree', r);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(ROOT, r), dest);
  }
  writeFileSync(MANIFEST, JSON.stringify({ at: new Date().toISOString(), manifest }, null, 1));
  const outside = Object.keys(manifest).filter((r) => !inFence(r)).length;
  console.log(`snapshot: ${Object.keys(manifest).length} files (${outside} outside the fence, copied)`);
  process.exit(0);
}

if (!existsSync(MANIFEST)) { console.error('no snapshot: run `node tools/art-fence.mjs snapshot` first'); process.exit(2); }
const { at, manifest } = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const now = files();
const seen = new Set(now);

const breaches = [];   // outside the fence
const art = [];        // inside it, which is the work
for (const r of now) {
  const before = manifest[r];
  const state = before === undefined ? 'added' : before !== hash(r) ? 'changed' : null;
  if (!state) continue;
  (inFence(r) ? art : breaches).push(`${state.padEnd(7)} ${r}`);
}
for (const r of Object.keys(manifest)) {
  if (seen.has(r)) continue;
  (inFence(r) ? art : breaches).push(`deleted ${r}`);
}

if (cmd === 'restore') {
  let n = 0;
  for (const line of breaches) {
    const r = line.slice(8);
    const src = join(STORE, 'tree', r);
    if (existsSync(src)) { mkdirSync(dirname(join(ROOT, r)), { recursive: true }); copyFileSync(src, join(ROOT, r)); n++; }
    else { rmSync(join(ROOT, r), { force: true }); n++; }   // it was added, so take it away
  }
  console.log(n ? `restored ${n} file(s) outside the fence` : 'nothing to restore');
  process.exit(0);
}

console.log(`snapshot taken ${at}`);
console.log(`\non the art bench (${art.length}):`);
for (const l of art) console.log('  ' + l);
if (!breaches.length) {
  console.log('\nfence intact: nothing outside src/art/ was touched');
  process.exit(0);
}
console.log(`\nFENCE BREACHED (${breaches.length}) - these are not the art bench's to change:`);
for (const l of breaches) console.log('  ' + l);
console.log('\nreview them, then `node tools/art-fence.mjs restore` to put them back');
process.exit(1);
