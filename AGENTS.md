# AGENTS.md — CLEARED TO LAND

A browser flight game: every flight is the last three miles of an approach. Plain
ES modules, three.js, esbuild. `tools/build.mjs` bundles the whole thing into one
self-contained `CTL.html`; `tools/package-web.mjs` writes the hosted copy in
`web/`. It is published at https://goodmarc.com/cleared-to-land/ beside a personal site.

**This repository is under git** (since 2026-09-14). `git status` shows what you
changed; do not commit, the owner does. Change what you were asked to change and
nothing else.

## Hard rules

1. **Never deploy, publish or upload anything.** Anything that talks to a server is
   off limits. The owner runs deploys himself.
2. **Never touch anything outside this repository.**
3. **No new dependencies and no network access.** The game ships as one HTML file
   with everything inlined. No CDN, no font download, no image download, no
   telemetry. Everything is drawn in code or already in `assets/`.
4. **Do not change the flight model.** `src/physics/`, `src/systems/` and
   `src/aircraft/defs.js` are how the airplane flies. They have their own test
   suite and their numbers came from real aerodynamics. They are not to be tuned
   to make something look better.
5. **Stay inside the task's fence.** Most work here is scoped to a subdirectory,
   and that scope is stated in the task and in the `AGENTS.md` of that directory.
   If the job seems to need a file outside it, say so in your answer and stop —
   do not make the change.
6. **Determinism.** The world is built from seeded noise so that the same scenario
   always produces the same terrain, and so that screenshots can be compared
   between runs. Use the seeded helpers in `src/config.js` (`makeRng`, `noise2`,
   `fbm2`), not `Math.random()`, for anything that is part of the world.

## Checking your work

- `npm run build` bundles; it must succeed.
- `npm test` runs the physics, flight-control, flare, carrier, camera and art
  contract suites. It must pass before you hand anything back.
- You cannot see the game. Screenshots are taken by the owner's harness; describe
  what you changed and what it should look like, and let the review come back to you.

## Layout

    src/main.js        the game: scene, loop, state machine, quality tiers
    src/config.js      constants and the seeded noise helpers
    src/physics/       aerodynamics, the aircraft state, wind        (do not touch)
    src/systems/       flight control, autopilot, scoring, failures  (do not touch)
    src/aircraft/      aircraft definitions and their models
    src/world/         what the world IS: heightfield, aerodrome, carrier, ground queries
    src/art/           what the world LOOKS like — the art bench, see its own AGENTS.md
    src/ui/            HUD and menus
    tools/             build, package, and the Node test suites
