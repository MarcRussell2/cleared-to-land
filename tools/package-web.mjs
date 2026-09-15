// Rebuilds the game and refreshes the deploy-ready web/ folder and CTL-web.zip.
// web/index.html differs from CTL.html in three ways, all applied here:
//   1. site meta tags (favicon, description, Open Graph, theme colour)
//   2. a build stamp  <meta name="ctl-build">  that the website deploy verifies
//   3. SELF-HOSTED fonts: the two Google Fonts <link>s become @font-face rules that
//      point at web/fonts/*.woff2 (copied from the @fontsource packages), because
//      goodmarc.com allows no third-party requests on public pages.
// Usage: npm run web        (then upload web/ to the host; see web/README-HOSTING.md)
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = resolve(root, 'web');
const stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z'); // e.g. 2026-09-10T05:30:12Z

execSync('node tools/build.mjs', { cwd: root, stdio: 'inherit' });
mkdirSync(web, { recursive: true });

// --- fonts: the same faces and weights the Google Fonts link used to request ---
const FONTS = [
  { pkg: 'barlow-condensed', family: 'Barlow Condensed', weights: [500, 600, 700, 800] },
  { pkg: 'barlow',           family: 'Barlow',           weights: [400, 500, 600] },
  { pkg: 'share-tech-mono',  family: 'Share Tech Mono',  weights: [400] },
];
const fontsDir = resolve(web, 'fonts');
rmSync(fontsDir, { recursive: true, force: true });
mkdirSync(fontsDir);
let fontCss = '';
let fontCount = 0;
for (const { pkg, family, weights } of FONTS) {
  for (const w of weights) {
    const file = `${pkg}-latin-${w}-normal.woff2`;
    const src = resolve(root, 'node_modules/@fontsource', pkg, 'files', file);
    if (!existsSync(src)) throw new Error(`[web] ${src} is missing - run "npm install" first`);
    copyFileSync(src, resolve(fontsDir, file));
    fontCss += `@font-face{font-family:'${family}';font-style:normal;font-weight:${w};font-display:swap;src:url(fonts/${file}) format('woff2')}\n`;
    fontCount++;
  }
}

// --- head: the Google Fonts links become meta tags + the @font-face block ---
let html = readFileSync(resolve(root, 'CTL.html'), 'utf8');
const googleLinks = /<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\s*<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/[^"]*">/;
if (!googleLinks.test(html)) throw new Error('[web] could not find the two Google Fonts <link> tags in CTL.html');
const head = [
  '<link rel="icon" href="favicon.ico">',
  // phones: "Add to Home screen" installs a landscape, full-screen app (Android); iOS gets the standalone meta + icon
  '<link rel="manifest" href="manifest.json">',
  '<link rel="apple-touch-icon" href="apple-touch-icon.png">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
  '<meta name="apple-mobile-web-app-title" content="CTL">',
  '<meta name="description" content="Cleared to Land: airplane landing challenges. Crosswinds, heavy jets, malfunctions, carrier traps, bush strips, and a stall that behaves like the real thing.">',
  '<meta property="og:title" content="Cleared to Land — Airplane Landing Challenges">',
  '<meta property="og:description" content="Every flight starts on final. Crosswinds, heavy jets, malfunctions, carrier traps, bush strips.">',
  '<meta name="theme-color" content="#0e131a">',
  `<meta name="ctl-build" content="${stamp}">`,
  `<style>\n${fontCss}</style>`,
].join('\n');
html = html.replace(googleLinks, () => head);

// --- guard: nothing in the web copy may load from another origin ---
const leaks = [
  /<link[^>]+href=["']https?:/i,
  /<script[^>]+src=["']https?:/i,
  /url\(\s*["']?https?:/i,
  /fonts\.g(?:oogleapis|static)\.com/i,
];
for (const re of leaks) {
  if (re.test(html)) throw new Error(`[web] index.html still references an external resource (${re})`);
}

writeFileSync(resolve(web, 'index.html'), html);
copyFileSync(resolve(root, 'assets/ctl.ico'), resolve(web, 'favicon.ico'));
// --- phones: web-app manifest + icons (assets/icons/*.png come from the 256 px PNG inside ctl.ico) ---
for (const f of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) {
  const src = resolve(root, 'assets/icons', f);
  if (!existsSync(src)) throw new Error(`[web] ${src} is missing`);
  copyFileSync(src, resolve(web, f));
}
const manifest = {
  id: '/cleared-to-land/', name: 'Cleared to Land', short_name: 'CTL', description: 'Airplane Landing Challenges.',
  start_url: './', scope: './', display: 'fullscreen', orientation: 'landscape', background_color: '#0e131a', theme_color: '#0e131a',
  icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }],
};
writeFileSync(resolve(web, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
if (existsSync(resolve(root, 'docs/HANDOFF.md'))) copyFileSync(resolve(root, 'docs/HANDOFF.md'), resolve(web, 'HANDOFF.md'));   // private ops notes, present only on the owner's machine
const zip = resolve(root, 'CTL-web.zip');
if (existsSync(zip)) rmSync(zip);
execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${web}\*' -DestinationPath '${zip}' -Force"`, { stdio: 'inherit' });
console.log(`[web] ${resolve(web, 'index.html')} (${Math.round(html.length / 1024)} KB), ${fontCount} self-hosted font files, manifest.json + 3 icons, build ${stamp}, and ${zip}`);
