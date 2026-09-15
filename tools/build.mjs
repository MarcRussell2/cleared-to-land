// Build: bundles src/main.js into a single IIFE and packs it, with the CSS, into
// one self-contained HTML file (CTL.html) that runs from file://.
// Usage: node tools/build.mjs [--watch] [--serve]
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const watch = args.has('--watch');
const serve = args.has('--serve');
const port = 8123;

mkdirSync(resolve(root, 'dist'), { recursive: true });

function pack() {
  const js = readFileSync(resolve(root, 'dist/game.js'), 'utf8');
  const css = readFileSync(resolve(root, 'src/style.css'), 'utf8');
  const tpl = readFileSync(resolve(root, 'src/index.html'), 'utf8');
  const safeJs = js.replace(/<\/script/gi, '<\\/script');
  // dist/index.html references game.js (for the dev server)
  const dev = tpl.replace('/*CSS*/', () => css).replace('<!--JS-->', () => '<script src="game.js"></script>');
  writeFileSync(resolve(root, 'dist/index.html'), dev);
  // CTL.html is fully self-contained
  const single = tpl.replace('/*CSS*/', () => css).replace('<!--JS-->', () => '<script>\n' + safeJs + '\n</script>');
  writeFileSync(resolve(root, 'CTL.html'), single);
  writeFileSync(resolve(root, 'dist/CTL.html'), single);
  // Artifact variant: no doctype/html/head/body wrappers, style + markup + script only
  const art = readFileSync(resolve(root, 'src/artifact.html'), 'utf8')
    .replace('/*CSS*/', () => css)
    .replace('<!--JS-->', () => '<script>\n' + safeJs + '\n</script>');
  writeFileSync(resolve(root, 'dist/artifact.html'), art);
  const kb = Math.round(single.length / 1024);
  console.log(`[build] CTL.html ${kb} KB  (${new Date().toLocaleTimeString()})`);
}

const packPlugin = {
  name: 'pack',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length === 0) pack();
      else console.log('[build] errors:', result.errors.length);
    });
  },
};

const ctx = await esbuild.context({
  entryPoints: [resolve(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  outfile: resolve(root, 'dist/game.js'),
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  legalComments: 'none',
  loader: { '.glb': 'dataurl' },
  logLevel: 'info',
  plugins: [packPlugin],
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
});

if (watch || serve) {
  await ctx.watch();
  if (serve) {
    const { host, port: p } = await ctx.serve({ servedir: resolve(root, 'dist'), port, host: '127.0.0.1' });
    console.log(`[serve] http://${host}:${p}/`);
  }
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
