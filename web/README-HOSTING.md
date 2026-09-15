# Hosting CLEARED TO LAND on a website

CLEARED TO LAND is a single static HTML file. There is no server code, database, or build
step needed on the host. Any web server, CDN, or static hosting service works.

## What to upload

`npm run web` in the source repository writes this folder. Upload:

| File | Purpose |
|------|---------|
| `index.html` | The whole game (about 2 MB). Three.js, the physics, the aircraft and the audio are all inlined. |
| `favicon.ico` | Browser tab icon. |
| `fonts/` | The 8 `.woff2` typefaces the menus use (Barlow, Barlow Condensed, Share Tech Mono; SIL Open Font License). Referenced relatively, so keep the folder next to `index.html`. |
| `manifest.json`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | Web-app manifest and home-screen icons: on a phone, "Add to Home screen" installs the game as a full-screen landscape app. Optional; the game plays in the browser without them. |

Put them in any directory, for example `https://yourdomain.com/cleared-to-land/`. The game
is fully self-contained; it does not care which path it lives at. This file is
documentation and need not be uploaded.

## Requirements and behaviour

- **Browser:** WebGL 2 with hardware acceleration (any recent Chrome, Edge, Firefox,
  Safari). Users without it get a plain message instead of a broken page.
- **HTTPS recommended.** The game works over plain HTTP, but two features need a
  secure context: the Gamepad API and (in some browsers) pointer lock for the mouse yoke.
  Keyboard, mouse-wheel throttle and everything else work regardless.
- **External requests: none.** Fonts are self-hosted in `fonts/`; if they fail to load,
  the page falls back to system fonts. No analytics, no tracking, nothing leaves the page.
  The packager refuses to write a page that references another origin.
- **Storage:** best scores, the logbook name they are stamped with, and settings are
  saved in the visitor's browser `localStorage` under the site's origin. Nothing is
  stored server-side.
- **Sound:** starts on the first key press or click (browser autoplay rules).
- **Screen:** desktop, or a phone / tablet held sideways: on a touch screen the game shows
  on-screen controls and a compact HUD.

## Suggested server settings (optional)

- Serve `index.html` with `Content-Type: text/html; charset=utf-8`.
- Enable gzip or brotli for `.html`: the file compresses to roughly a quarter of its size.
- Cache: a short max-age (or `no-cache` with ETag revalidation) on `index.html` so a new
  build shows up on the next reload. The page carries a `<meta name="ctl-build">`
  stamp with the build time, which is the easiest way to confirm which build a browser
  is running (the menu header shows it too).
- No special headers are required. If the site sets a `Content-Security-Policy`, allow
  inline scripts and styles (`'unsafe-inline'`) and `font-src 'self'`.

## Updating

```
npm run web
```

rebuilds the game and refreshes this folder with a fresh build stamp, then upload the
files listed above again. The previous copy can simply be kept aside for a rollback.

## Credits (keep them)

The aircraft models that come from Poly Pizza are Creative Commons Attribution
(CC-BY 3.0); the in-game Controls page carries the attribution and `CREDITS.md`
in the source has the full list. Everything else in the game is original and
procedural. Code license: MIT (see `LICENSE`).
