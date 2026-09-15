# CLEARED TO LAND performance notes

Branch `perf`, 2026-09-14. Marc's brief: "the game is getting slower"; on his phone (Pixel 9 Pro,
Chrome) it runs around twenty frames per second at low graphics; on his PC (RTX 4080 plus an
Intel UHD 770 iGPU, i7-13700K, Windows 10) he wants high graphics at a smooth 60+, hopefully 120.

This file is the diagnosis (measured, not guessed), the requirements that come out of it for the
art bench (`src/art/*`, which other branches are rebuilding), the engine plan, and - as the work
lands - an "after" table and a ledger of what each change bought.

## 1. The short version

- **The RTX 4080 is never the problem.** At 1920x1080 the whole frame costs it 1.5 ms of GPU
  and the game loop 2 ms of CPU: 340-360 fps headless, 217 fps at 4K, and a real window on the
  primary monitor runs at the monitor's 360 Hz. If the PC feels slow, it is one of: the browser
  rendering on the iGPU instead of the RTX (edge://gpu must say NVIDIA under GL_RENDERER); the
  primary 2560x1440 @ 360 Hz monitor being attached to the **Intel** adapter's output, so every
  frame the RTX draws is copied across to the iGPU for scanout (measured fine at 360 fps here, but
  it is the one thing in the setup that can stutter and it is a cable, not code); the 4K monitor,
  which is 60 Hz and caps at 60; or the 1.7 s freeze at the start of every flight (below).
- **A mobile-class GPU is the problem, and the composer is the biggest single item.** Pinned to
  the Intel UHD 770 at 1440p the game runs at **8 fps** on high (108 ms of GPU per frame: 71 ms
  scene, **33 ms bloom + MSAA/HalfFloat**, 3 ms output), 9 fps on medium, 30 fps on low. On the
  phone viewport (1088x430, DPR 1.5 = 1.05 MP, medium) the price list is: MSAA 4x on the
  HalfFloat target 13 ms, the forest 11.7 ms, resolution (DPR 1.5 vs 1) 11 ms, bloom 7 ms, the
  ground shader 5.7 ms, shadows 4.4 ms, HalfFloat vs 8-bit 3.7 ms, clouds 0.8 ms; water, sky
  dome, fog, HUD, particles, lights: nothing measurable.
- **The forest is drawn twice, all of it, every frame.** 10-45k instances x ~109 triangles with
  `frustumCulled = false`, so the shadow pass (a 180 m box around the aircraft) also transforms
  every tree in the county: 2.27M of the plains' 4.77M triangles per frame are the shadow pass
  redrawing the forest. The mountain at medium hits the 45,000-tree cap (5.66M tris) because the
  cap does not scale with the tier.
- **On a phone CPU the draw calls are the other half.** At a third of desktop speed (a Pixel 9
  Pro proxy) `renderer.render` costs 7 ms on the plains (379 draws) and 16 ms on the coast (460
  draws), so the coast is CPU-bound at 38 fps even with the RTX doing the pixels. The airport
  alone is 290 draws, 174 of them the six parked aircraft (29 draws each, six of those the nav
  lights: one point per draw). Physics is NOT the problem: twelve 4 ms sub-steps cost 1.8 ms at
  phone speed. The HUD is 1-1.7 ms of JS plus about 2 ms of style/layout per frame on a phone.
- **Every flight starts with a 1.65 s freeze** (0.5 s once the browser's shader cache is warm):
  64 shader programs compiled synchronously in the first frame, then another stall when the
  downloaded airframe arrives. Same on the PC; longer on the phone.
- **Garbage is 50-100 MB/s but it is not the game's**: 88% is HeapNumber boxing inside
  three.js's uniform uploads (~630 bytes per draw call). GC is 1.4% of CPU. Fewer draws is the
  only lever, and it is not worth chasing on its own.

## 2. Method

### The tool: `tools/perf-probe.mjs` (`npm run perf-probe -- ...`)

The screenshot harness in the website repo steps frames by hand; this tool lets the real
`requestAnimationFrame` loop run and samples it. It bundles the game unminified (readable
profiles), writes a self-driving page that starts a scenario with the autoland on, launches
Microsoft Edge with a DevTools port under its own scratch profile (`CTL_PERF_DIR`, a temp
folder; nothing touches the real browser profile), waits for the airframe to load and the shaders
to warm, samples a window and prints one row plus details. Options: `--scene --camera --quality`,
`--w --h --dpr`, `--phone` (Pixel 9 Pro landscape: 1088x430, DPR 2.625, touch emulation, Android
UA, so the game takes its touch path), `--gpu nvidia|intel` (pins the adapter with
`--use-adapter-luid`; the report prints which GPU actually rendered), `--cpu 3` (DevTools CPU
throttling), `--raw` (no frame-rate limit / no vsync), `--visible`, `--profile` (CPU sampling
profile: top self-time functions, inclusive, per module), `--alloc` (sampling heap profile with
collected objects included: who allocates), `--census` (what is in the scene, by owner: objects,
draws, triangles, casters, transparency, textures, programs), `--ablate a,b` (switch things off to
price them), `--matrix desktop|phone|proxy|ablation`, `--json` (one JSON line per run). `tools/perf-table.mjs`
turns a JSON-lines file into the Markdown tables below and `tools/perf-compare.mjs` a before/after table.

What a row means:

| column | meaning |
|---|---|
| fps50 / fps95 | 1000 / (p50, p95 of the interval between animation frames) |
| ft50 / ft95 | those intervals, ms |
| cpu50 / cpu95 | main-thread ms inside the game loop (update + render submission). **Inflated when the GPU is the bottleneck**: the render call then blocks on the GPU queue |
| gpu50/95 | `EXT_disjoint_timer_query_webgl2` time per frame, ms; split scene (includes the shadow pass) / bloom / output |
| calls, tris | `renderer.info` per frame, whole frame including the shadow pass |
| prog | compiled shader programs |
| MB/s | JS heap allocation rate |

Also printed: the parts of the CPU time (physics, hud, model, effects, camera, sky, audio,
render), sub-steps per frame, layouts and style recalcs per second, and the start-up timings
(world build, first frame, frames until the loop settles under 8 ms).

### Devices and proxies

- **Desktop**: headless Edge renders on the RTX 4080 via ANGLE/D3D11 (verified through
  `WEBGL_debug_renderer_info`). Headless Edge paces its frames at the primary monitor's refresh
  rate (360 Hz here, so a row reading 357 fps is at the cap); `--raw` removes the cap and
  `--visible` gives what a player sees in a real window.
- **Mobile proxy**: Edge pinned to the **Intel UHD 770** (the iGPU in Marc's PC; the same class
  of GPU as a phone's, a little faster at best) + DevTools CPU throttling x3 (an i7-13700K core is
  roughly three times a Tensor G4 core at JavaScript) + the phone viewport with touch emulation.
  It is a stand-in, not a Pixel: mobile GPUs are tile-based, their MSAA behaves differently and
  their bandwidth is lower. Every proxy number is "about this bad"; the real phone must be
  checked after the merge (section 8).
- Repeatability: `CTL_WIND_SEED` is pinned, the autoland flies; the same run repeats within a
  few percent. The very first run after a cold start is 10-15% slower on the Intel (clocks); the
  "no-op" ablations (stars, hud, physics...) give the true baseline of a chain.

## 3. Baseline (before any change)

Build: the `perf` branch at its baseline commit (live game build 2026-09-13). All runs: autoland
on, HUD on, seed 4271, 10 s windows after a 6 s warm-up, medium approach.

### 3.1 Desktop - RTX 4080, 1920x1080, DPR 1 (headless, paced at 360 Hz)

| scene / camera / tier | fps50 | fps95 | ft50 ms | cpu50 ms | gpu50 ms (scene/bloom/out) | draws | tris | sub-steps | notes |
|---|---|---|---|---|---|---|---|---|---|
| solo / chase / high | 333.3 | 172.4 | 3 | 2.3 | 1.8 (1.4/0.2/0) | 379 | 4.77M | 1 | render 1.8 hud 0.3 phys 0, 20243 trees, 1920x1080 |
| heavy / chase / high | 149.3 | 76.3 | 6.7 | 5.1 | 2.9 (2.5/0.2/0) | 459 | 2.46M | 2 | render 4.3 hud 0.4 phys 0.1, 9445 trees, 1920x1080 |
| cq / chase / high | 357.1 | 333.3 | 2.8 | 0.8 | 0.7 (0.4/0.2/0) | 116 | 0.01M | 1 | render 0.5 hud 0.2 phys 0, 1920x1080 |
| night / chase / high | 312.5 | 147.1 | 3.2 | 1.3 | 0.9 (0.6/0.2/0) | 117 | 0.01M | 1 | render 0.9 hud 0.3 phys 0, 1920x1080 |
| gravel / chase / high | 357.1 | 333.3 | 2.8 | 1 | 1.4 (1.1/0.2/0.1) | 170 | 5.64M | 1 | render 0.6 hud 0.2 phys 0, 45000 trees, 1920x1080 |
| fog / chase / high | 344.8 | 200 | 2.9 | 2.1 | 1.5 (1.2/0.2/0) | 459 | 2.47M | 1 | render 1.7 hud 0.3 phys 0, 9445 trees, 1920x1080 |
| solo / cockpit / high | 263.2 | 185.2 | 3.8 | 3 | 1.8 (1.4/0.2/0) | 355 | 4.77M | 1 | render 2.5 hud 0.3 phys 0, 20243 trees, 1920x1080 |
| heavy / cockpit / high | 227.3 | 169.5 | 4.4 | 3 | 1.4 (1.2/0.2/0) | 367 | 2.45M | 2 | render 2.5 hud 0.3 phys 0.1, 9445 trees, 1920x1080 |
| solo / chase / medium | 250 | 163.9 | 4 | 3 | 1.7 (1.4/0.2/0) | 379 | 3.88M | 1 | render 2.6 hud 0.3 phys 0, 16273 trees, 1920x1080 |
| solo / chase / low | 303 | 212.8 | 3.3 | 2.4 | 0.6 (0.6/0/0) | 340 | 0.93M | 1 | render 2 hud 0.3 phys 0, 6111 trees, 1920x1080 |
| heavy / chase / medium | 212.8 | 158.7 | 4.7 | 3.5 | 1.6 (1.4/0.2/0) | 459 | 2.03M | 2 | render 3 hud 0.3 phys 0.1, 7578 trees, 1920x1080 |
| heavy / chase / low | 263.2 | 181.8 | 3.8 | 2.6 | 0.9 (0.9/0/0) | 378 | 0.57M | 1 | render 2.2 hud 0.3 phys 0.1, 2846 trees, 1920x1080 |

### 3.2 Phone viewport (1088x430, touch path) on the RTX 4080, no CPU throttle

What the phone's own DPR and touch tiers cost when the GPU and CPU are not the limit.

| scene / camera / tier | fps50 | fps95 | ft50 ms | cpu50 ms | gpu50 ms (scene/bloom/out) | draws | tris | sub-steps | notes |
|---|---|---|---|---|---|---|---|---|---|
| solo / chase / low | 294.1 | 178.6 | 3.4 | 2.6 | 1.1 (1.1/0/0) | 340 | 0.93M | 1 | render 2.2 hud 0.3 phys 0, 6111 trees, 1088x430 |
| solo / chase / medium | 238.1 | 166.7 | 4.2 | 3.3 | 1.8 (1.7/0.1/0) | 379 | 2.53M | 2 | render 2.8 hud 0.3 phys 0, 10208 trees, 1632x645 |
| solo / chase / high | 256.4 | 185.2 | 3.9 | 3.1 | 1.8 (1.6/0.2/0) | 379 | 3.43M | 1 | render 2.6 hud 0.3 phys 0, 14213 trees, 2176x860 |
| heavy / chase / low | 263.2 | 185.2 | 3.8 | 2.7 | 1.4 (1.4/0/0) | 378 | 0.57M | 1 | render 2.3 hud 0.3 phys 0.1, 2846 trees, 1088x430 |
| heavy / chase / medium | 217.4 | 153.8 | 4.6 | 3.5 | 1.9 (1.7/0.1/0) | 459 | 1.36M | 2 | render 3 hud 0.3 phys 0.1, 4753 trees, 1632x645 |
| heavy / chase / high | 222.2 | 161.3 | 4.5 | 3.4 | 2 (1.8/0.2/0) | 459 | 1.80M | 2 | render 2.9 hud 0.3 phys 0.1, 6640 trees, 2176x860 |
| cq / chase / low | 357.1 | 344.8 | 2.8 | 0.8 | 0.2 (0.2/0/0) | 72 | 0.01M | 1 | render 0.5 hud 0.2 phys 0, 1088x430 |
| cq / chase / medium | 357.1 | 303 | 2.8 | 1.1 | 0.6 (0.4/0.1/0) | 116 | 0.01M | 1 | render 0.7 hud 0.2 phys 0, 1632x645 |
| cq / chase / high | 357.1 | 312.5 | 2.8 | 1.1 | 0.7 (0.5/0.2/0) | 116 | 0.01M | 1 | render 0.7 hud 0.2 phys 0, 2176x860 |
| gravel / chase / low | 357.1 | 344.8 | 2.8 | 0.9 | 0.6 (0.6/0/0) | 121 | 2.60M | 1 | render 0.6 hud 0.2 phys 0, 38382 trees, 1088x430 |
| gravel / chase / medium | 357.1 | 192.3 | 2.8 | 1.4 | 1.3 (1.2/0.1/0) | 170 | 5.66M | 1 | render 1 hud 0.2 phys 0, 45000 trees, 1632x645 |
| gravel / chase / high | 312.5 | 178.6 | 3.2 | 1.6 | 1.6 (1.3/0.2/0) | 170 | 5.65M | 1 | render 1.1 hud 0.3 phys 0.1, 45000 trees, 2176x860 |

### 3.3 The Pixel proxy: phone viewport, Intel UHD 770, CPU x3

| scene / camera / tier | fps50 | fps95 | ft50 ms | cpu50 ms | gpu50 ms (scene/bloom/out) | draws | tris | sub-steps | notes |
|---|---|---|---|---|---|---|---|---|---|
| solo / chase / low | 43.7 | 28.9 | 22.9 | 17.2 | 7.2 (7.2/0/0) | 340 | 0.93M | 6 | render 13.4 hud 2.2 phys 0.6, 6111 trees, 1088x430 |
| solo / chase / medium | 23.8 | 16.2 | 42.1 | 35.4 | 31.6 (22.7/8/0.9) | 379 | 2.53M | 11 | render 31 hud 2.1 phys 0.9, 10208 trees, 1632x645 |
| solo / chase / high | 18.3 | 17 | 54.6 | 20.3 | 50.3 (34.7/13.9/1.7) | 379 | 3.43M | 12 | render 12.1 hud 3.5 phys 1.4, 14213 trees, 2176x860 |
| heavy / chase / low | 46.9 | 36.4 | 21.3 | 15.7 | 5.8 (5.8/0/0) | 378 | 0.57M | 6 | render 12.5 hud 1.7 phys 0.7, 2846 trees, 1088x430 |
| heavy / chase / medium | 33.3 | 22.1 | 30 | 16.4 | 25.5 (16.8/7.9/0.9) | 459 | 1.36M | 8 | render 10.5 hud 2.4 phys 0.8, 4753 trees, 1632x645 |
| heavy / chase / high | 21 | 17.5 | 47.7 | 27.2 | 42.8 (27.8/13.5/1.5) | 459 | 1.80M | 12 | render 17.6 hud 4.3 phys 1.8, 6640 trees, 2176x860 |
| cq / chase / low | 109.9 | 79.4 | 9.1 | 5.5 | 1.6 (1.6/0/0) | 72 | 0.01M | 3 | render 3.3 hud 1.3 phys 0.2, 1088x430 |
| cq / chase / medium | 46.3 | 38.8 | 21.6 | 14 | 15.2 (7.7/6.7/0.8) | 116 | 0.01M | 6 | render 7.3 hud 3.8 phys 0.4, 1632x645 |
| cq / chase / high | 28.7 | 25.9 | 34.9 | 15.3 | 29.7 (15.2/13/1.4) | 116 | 0.01M | 9 | render 8.6 hud 2.3 phys 0.7, 2176x860 |
| gravel / chase / low | 70.9 | 67.6 | 14.1 | 6.9 | 12.5 (12.5/0/0) | 121 | 2.60M | 4 | render 3.6 hud 1.9 phys 0.4, 38382 trees, 1088x430 |
| gravel / chase / medium | 22.1 | 20.9 | 45.2 | 11.5 | 40.6 (32/7.5/1) | 170 | 5.66M | 12 | render 5.3 hud 2.2 phys 1.6, 45000 trees, 1632x645 |
| gravel / chase / high | 16.1 | 15.3 | 62.1 | 18 | 56.6 (40.2/14.8/1.5) | 170 | 5.65M | 12 | render 8.8 hud 3.2 phys 2, 45000 trees, 2176x860 |

(`cpu50` on these rows is inflated by GPU back-pressure wherever gpu50 is close to ft50.)

### 3.4 Spot checks

| run | fps50 | fps95 | cpu50 | gpu50 (scene/bloom/out) | notes |
|---|---|---|---|---|---|
| solo high, 2560x1440, visible window on the primary monitor | 357 | 256 | 1.9 | 2.1 (1.7/0.3/0.1) | vsync at 360 Hz; renderer NVIDIA |
| same, `--raw` | 476 | 270 | 1.6 | 1.7 | |
| solo high, 3840x2160 (1920x1080 @ DPR 2), RTX | 217 | 164 | 3.5 | 3.5 (2.3/0.8/0.3) | the 4K monitor case |
| solo high, 2560x1440, **Intel UHD 770** | **8.0** | 6.9 | 13.8* | **108 (71/33/3)** | 12 sub-steps/frame |
| solo medium, 2560x1440, Intel | 8.9 | 7.8 | 17.4* | 96 (59/33/3.5) | |
| solo low, 2560x1440, Intel | 29.9 | 19.8 | 6.3* | 22.6 | no composer, no shadows |
| solo medium, phone viewport, RTX, CPU x3 | 87.7 | 60 | 8.6 | 6.3 | render 6.9 ms, hud 1.0 ms: the CPU floor |
| heavy medium, phone viewport, RTX, CPU x3 | **38.3** | 31 | **20.0** | 15.2 | render 16.4 ms for 460 draws: CPU-bound |

\* inflated by GPU back-pressure.

### 3.5 Price list on the proxy (solo, medium: 1632x645, PCFSoft 1024, MSAA 4 HalfFloat + bloom)

Baseline 32.8 ms per frame, 29.7 ms of GPU (the no-op ablations' median; the first run of the
chain read 34 ms cold). Each row switches one thing off.

| off | GPU ms | saved | frame ms | note |
|---|---|---|---|---|
| msaa (samples 0, HalfFloat kept) | 16.7 | **13.0** | 25.6 | MSAA 4x on a 16-bit target: bandwidth |
| forest | 18.0 | **11.7** | 31.9 | 10.2k trees, 2.3M tris/frame incl. shadow pass |
| dpr 1.5 -> 1 | 18.7 | **11.0** | 24.6 | 1.05 -> 0.47 MP; ~60% of the GPU time is per-pixel |
| composer (direct to canvas) | 19.1 | 10.6 | 22.5 | canvas MSAA still on |
| bloom (RT + output kept) | 22.6 | 7.1 | 27.1 | UnrealBloom at full resolution |
| terrain mesh | 24.0 | 5.7 | 31.5 | the ground shader over ~60% of the screen |
| shadows | 25.3 | 4.4 | 29.1 | the pass (all trees) + PCF sampling |
| ldr (8-bit RT, MSAA kept) | 26.0 | 3.7 | 29.4 | |
| clouds | 28.9 | 0.8 | 32.5 | two 60 km layers |
| pcf instead of pcfsoft | 30.5 | 0 | 34.0 | no difference on this GPU |
| sky dome, stars, fog, water (coast), lights, particles, aircraft, hud, backdrop-filter, vignette, touch layer, physics | 29-30 | 0 | | nothing measurable on the GPU |
| airport (all 290 draws) | 27.8 | 1.7 | | but **CPU 19.5 -> 12.9 ms**: the draws cost 6.6 ms of phone CPU |

Other scenes on the proxy at medium: coast (`heavy`) 25 fps, GPU 24 ms, CPU 33 ms (CPU-bound);
carrier day (`cq`) 45 fps, GPU 15 ms; mountain (`gravel`) 22 fps, GPU 41 ms of which the forest is
23.5 ms (45,000 trees: the cap). At low: plains 80, coast 42, carrier 116, mountain 70 fps.

## 4. Where the time goes

Ranked by what it costs on the device where it matters. Evidence is the section 3 data plus the
profiles (`--profile`, `--alloc`, `--census`).

### GPU, mobile class (the proxy; the Pixel will be in the same order)

1. **The post-processing composer at full resolution**: a HalfFloat render target with MSAA 4x,
   UnrealBloomPass at the viewport resolution, then an output pass. 20 of the 30 ms at medium on
   the phone viewport; 33 of 108 ms at 1440p on the iGPU. Engine (`src/main.js`).
2. **The forest, twice**: `buildForest` returns two `InstancedMesh` (conifers, broadleaf +
   hedges) with `frustumCulled = false`; the shadow pass then draws every instance too. Plains
   10-20k trees, mountain 45k (the `maxTrees` cap counts kept trees, so `treeScale` 0.5 still
   fills it). 11.7 ms plains / 23.5 ms mountain at medium. Art (`terrain-look.js`) + engine
   (culling is the engine's job: see section 6).
3. **Resolution**: DPR 1.5 at medium and 2 at high on a 2.625 phone. 1.05 MP costs 11 ms more than
   0.47 MP at medium. Engine (pixel-ratio policy; dynamic resolution).
4. **The ground shader**: 5.7 ms at 1.05 MP - three texture taps (two detail scales + the parcel
   LUT), three `fwidth`s, the row `sin`, PCF shadow receive, the atmosphere fog, over most of the
   screen. Art (`terrain-look.js` `buildGround`).
5. **Shadows**: 4.4 ms at a 1024 map: the shadow pass (all trees, see 2) plus PCFSoft sampling on
   every lit pixel. PCF vs PCFSoft made no difference on the Intel. Engine (map size and type per
   tier) + art (casters).
6. **HalfFloat**: 3.7 ms over an 8-bit target; needed while bloom runs (HDR threshold).
7. **Lights that do nothing**: the census finds **seven `SpotLight`s** at a towered field (every
   airframe gets a landing light, the six parked ones included, all at intensity 0) and the moon as
   a second `DirectionalLight` at intensity 0 by day. three.js compiles them all into every lit
   shader (`NUM_SPOT_LIGHTS 7`, `NUM_DIR_LIGHTS 2`) and evaluates them per pixel. Not priced
   separately on the proxy yet; it is inside the "scene" number and is pure waste.
8. Clouds 0.8 ms. Everything else under the noise floor.

### CPU at phone speed (x3 throttle; divide by ~3 for the i7)

1. **Draw submission**: `renderer.render` 6.9 ms for 379 draws (plains), 16.4 ms for 460 (coast):
   per draw three.js does `projectObject`, frustum test, `setProgram`, uniform refresh (every
   material switch re-uploads the model/view/normal matrices, lights, fog and the 10 injected
   atmosphere uniforms: `setValueM4`, `setValueV3f`, `refreshUniformsCommon`,
   `markUniformsLightsNeedsUpdate` are all in the top 20), VAO bind, draw. The census at
   Bayfield: airport 502 objects / 290 draws / 151 materials, of which six parked aircraft are 174
   draws (29 per airframe: glTF parts, hinged panels, detail bits, 6 nav-light `Points` of one
   vertex each, a prop disc), the flying aircraft 29 draws, forest 8, terrain group 4, sky 3,
   particles 6 (drawing all 4,460 points even when nothing is alive).
2. **`updateMatrixWorld`**: 5.8% self time (0.66 ms/frame) walking ~600 objects, nearly all of
   them static, every frame.
3. **The HUD**: `hud.update` 1.0-1.7 ms of JS (`drawADI` 0.3 of it; `querySelector` calls every
   frame; `innerHTML` rebuilds of the engine/config/g-meter blocks whenever a digit changes; the
   status line re-set every frame) and 7-8% of wall time in style + layout (1.9 ms at 38 fps)
   because ~40 elements get `top`/`left`/`display` written per frame.
4. **Ground queries**: `fbm2`/`rawHeight` 1.5% (0.4 ms) - the physics asks the analytic
   heightfield up to 12 x (1 + 4 for the normal + one per contact point) times a frame, and the
   chase camera twice. Cheap; noted for the `yaw` branch.
5. **Physics**: 1.8 ms at 12 sub-steps/frame (20 fps), 0.2 ms at 3 (90 fps). Not a target.
6. Audio `setTargetAtTime` churn 0.2 ms; autoland, camera, model, effects each ~0.1 ms.

### Desktop (RTX 4080)

Nothing to fix for frame rate: 2 ms CPU, 1.5-3.5 ms GPU. What Marc can feel: the first-frame
compile stall (1.65 s cold, 0.5 s warm), a tier drop by the watchdog recompiling every material
(`applySettings` sets `needsUpdate` on everything: another 1-2 s freeze mid-flight), and the
monitor wiring (section 1).

### Start-up

`loadSite` 295 ms on the i7 (terrain heights 330x330 through `fbm2`, the forest scatter, the
canvas textures), `startScenario` 345 ms, then the first `render` blocks 1,650 ms compiling 64
programs (475 ms when the browser's shader disk cache has them), then the glTF airframe arrives
and compiles its five livery programs. Three times slower on the phone.

### Memory

Geometries 823, textures 29 (the runway 4096x512 aniso 16, ground detail 512x512 aniso 8, two
256x256 cloud maps, a 4096x4096 shadow depth map at high = 64 MB), 64 programs. JS heap steady at
40-65 MB; allocation 50-100 MB/s of which 88% is three.js uniform boxing (plain-Array matrices
passed to `uniformMatrix4fv` become HeapNumbers), the game's own churn ~5 MB/s (`terrain.js`
`rawHeight` 2.4%, `hud.js` strings 2.1%, `main.js` 0.3%).

## 5. Requirements for the art bench

These are for the visuals branches to bake into their Codex briefs. Numbers are measured on the
proxy (Intel UHD 770, CPU x3, phone viewport at medium = 1632x645); a phone will be no better.
Price a change yourself with
`npm run perf-probe -- --phone --gpu intel --cpu 3 --scene <id> --quality medium --ablate <thing>`
(the engine half of this branch must be merged for the tool; until then run it from the `perf`
branch's tree against your `src/`).

The frame budget on the proxy at **medium** is **16 ms of GPU** (60 fps) with the engine's share
(composer off, PCF 1024 shadows, dynamic resolution) already taken out; the art bench owns about
**10 ms** of it: forest <= 4 ms, ground <= 3 ms, sky + clouds <= 1.5 ms, water <= 1 ms, airport +
carrier + aircraft + effects <= 1 ms together. At **high** on a phone the composer comes back at
half-resolution bloom and MSAA, and the same modules get 1.5x these numbers. On the desktop high
tier there is no GPU budget worth stating: 1.5 ms per frame today; keep it under 4 ms at 1080p on
the RTX (that is 120 fps at 4K with margin).

### terrain-look.js

- **Forest**: keep returning `InstancedMesh` objects with world-space instances, any number of
  them. **Do not set `frustumCulled = false` on them** (the engine now splits every instanced mesh
  in the terrain group into a 6x6 grid of chunks with bounding spheres, so the camera and the
  shadow camera cull them; a flag you set is overwritten). Budget after culling: <= 1.2M forest
  triangles per frame at `treeScale` 1 on the plains, <= 2M on the mountain; per tree <= 110
  triangles (today conifer 44, broadleaf 140; the broadleaf's `IcosahedronGeometry(4, 1)` is 80 of
  them). **The `maxTrees` cap must scale with the tier**: 45,000 x `treeScale`, not 45,000 kept
  after thinning. Hedgerows are fine as instances of the same geometry.
- **Ground**: 5.7 ms at 1.05 MP today; budget 4 ms. Keep <= 3 texture taps per pixel (that is
  what it has). Candidates: skip the parcel block where `farm == 0` (a branch, most of the
  mountain and coast pixels), drop the row `sin` and its `fwidth` beyond a distance, and do not add
  a normal map or a fourth tap. It receives PCF shadows on every pixel; that is part of the price.
- **Water** (`makeWater` lives in sky.js but is placed here): measured at 0 ms at 1 MP and must
  stay analytic - no reflection/refraction render targets (a planar reflection is a second scene
  render), no depth-texture shoreline.
- Roads, villages, rocks, obstacle trees: fine as they are (4 + 6 draws). Rocks are an
  `InstancedMesh` and get chunked too.

### sky.js

- Sky dome and stars: not measurable; keep the analytic gradient, no per-pixel noise octaves.
- Clouds: two 60 km layers = 0.8 ms; budget 1.5 ms total. A third layer or per-pixel FBM breaks
  it; the baked 256x256 map is the right approach.
- Fog injection: costs nothing per pixel, but it adds 10 uniforms to every material and those are
  re-uploaded at every material switch (~150 per frame): keep the injected set <= 12 uniforms,
  no textures.
- **Lights**: one shadowed directional + one directional (moon) + one hemisphere is the whole
  budget. No point or spot lights anywhere in the world (each one is evaluated per pixel by every
  lit material on screen). The aircraft's landing light is the only spot light allowed, and only
  on the flying aircraft (the engine removes lights from parked models). **The moon must be
  `visible = false` while its intensity is 0** (by day it is compiled into every shader as a
  second directional light and evaluated per pixel for nothing); toggling `visible` on a light
  changes the lights hash and recompiles once, so do it in `set()`, not per frame.
- Shadows: the engine sets `shadow.mapSize` per tier (desktop 4096/2048, phone 2048/1024) and may
  use `PCFShadowMap` instead of `PCFSoftShadowMap` on phones; keep `bias`/`normalBias` working for
  both. The 180 m shadow box is the engine's (`sky.js` sets it; do not enlarge it: its cost is
  the casters inside it).

### airport-look.js

- Draw calls: a towered field is 116 draws without the parked aircraft. Budget **<= 60**: the
  bush-strip markers (one `Mesh` per cone, 18 of them), the four PAPI boxes, the three fuel tanks
  (three materials for one colour) and the eight fringe strips should each be one merged geometry
  and one material. Materials: **<= 20 distinct materials** for the whole aerodrome (151 today
  including the parked aircraft); every distinct material is a full uniform refresh per frame.
- Transparent draws: **<= 12** at any field (43 today: fringes, glass, prop discs, five light
  sets). Transparent draws are sorted back-to-front and drawn last; each fullscreen-ish one is
  overdraw.
- Parked aircraft: the engine merges each parked airframe's static meshes by material after the
  glTF loads and strips its lights, so parked aircraft cost ~8 draws each instead of 29. Ask for
  them with `parked(kind)` as now; do not clone models yourself.
- Buildings: fine (12 boxes, one shader variant). The building shader's `fwidth` is cheap.

### carrier-look.js

116 draws and 7k triangles at `cq`: cheap. Budget <= 80 draws, <= 100k triangles, wake as one
transparent quad. The deck's 4096-class texture is fine; keep it one texture.

### livery.js, airframe.js, models.js (visuals-aircraft)

- **Draws per airframe**: 29 for the Skylark (56 objects), 71 for the Condor (121 objects).
  Budget **<= 12** for the flying aircraft (<= 20 for the airliner), with
  materials shared across parts (the engine merges parked ones by material identity, so two parts
  with the same finish must share one `Material` object, not two equal ones).
- **Navigation lights**: six `Points` objects of one vertex each, six materials, six draws per
  aircraft (42 draws across a towered field for 42 pixels). Requirement: **one `Points` per
  aircraft** with six vertices, per-vertex colour and size attributes, one material; blink by
  writing the colour attribute (`needsUpdate`), not by material opacity.
- **Lights**: one `SpotLight` per airframe is on every model built, including the six parked
  ones, so every lit shader at Bayfield/Harbor loops over 7 spot lights per pixel. Keep the landing
  light on the flying aircraft only; the engine strips lights from parked models, but do not add
  any other light to a model.
- **Shader programs**: the livery adds ~22 programs (`id` x `kind` x `imported`); the first frame
  of a flight compiles 64 programs in 1.65 s. Budget: **<= 70 programs in a scene**, and prefer
  uniforms over per-id shader code (`${id === 'condor' ? ... : ''}` is a new program per id).
  `onBeforeRender` per material is fine (0.9%).
- **Cockpit interior pass** (planned): must not be a second full-scene render or a second
  full-resolution render target. Budget **<= 2 ms of GPU at 1080p on the UHD 770**, a few thousand
  triangles, no extra lights, and it must respect `qualityProfile().composer` (no pass of its own
  on tiers where the composer is off).
- Textures: the registration 512x128 per id and the 128x128 prop disc are fine; **<= 4 MB of
  texture per airframe**, mipmapped, anisotropy <= 4.

### effects.js / particles.js (visuals-aircraft)

- Today six `Points` systems draw all their `max` vertices every frame (4,460 points, 6 draws)
  whether anything is alive or not. Requirement: **no draw when a system has no live particle**
  (`points.visible = active`, or `setDrawRange` to the live count); CPU loop over live particles
  only. Total live particles **<= 4,000**, one material per system, additive or normal blending,
  **no depth-sorted or soft (depth-texture) particles**.
- A particle engine may not allocate per particle per frame (typed arrays, as now).

### textures.js

Ground 512x512 (aniso 8), runway 4096x512 (aniso 16), deck, clouds 2 x 256x256, prop 128x128,
registration 512x128: 29 textures, fine. Budget **<= 12 MB of textures per site**, all mipmapped,
anisotropy <= 8; no texture above 4096 on any side; canvas textures built once per site (they are
on the load path: 300 ms today).

### Everything

- `frustumCulled = false` only on things that are truly everywhere (sky, clouds, water, stars).
- No per-frame work in `update()` over more than a few dozen objects; nothing that sets
  `needsUpdate` on a material at runtime (recompile = a stall).
- Static objects never move: `airport.js` freezes the aerodrome's matrices after the build
  (`matrixAutoUpdate = false`); the windsock, the carrier and its radar are the moving exceptions
  and are driven by the world code, not the art.
- Share materials. Every distinct material costs a full uniform refresh per frame (~20 us of phone
  CPU and ~630 bytes of garbage per draw).
- **A transparent material with `side: DoubleSide` must set `forceSinglePass: true`.** Without it
  three.js draws the object twice (back faces, then front) and sets `material.needsUpdate = true`
  twice per object per frame, which re-keys and re-looks-up the program every frame: the propeller
  disc (`livery.js` `propDisc`) does this today - about 5,700 `needsUpdate` sets in an 8 s window
  on every propeller aircraft, none on the jets, and the `getProgramCacheKey` / `getParameters` /
  `join` lines (~3%) in the CPU profile. A flat disc looks the same drawn in one pass; the cloud
  layers meet the same condition and should carry the flag too. `npm run perf-budget` counts these
  sets and fails on any.

## 6. What the engine pass changed (this branch)

The plan, in order of measured value, as it was carried out. Files: `src/geom.js`, `src/world/terrain.js`,
`src/world/airport.js`, `src/main.js`, `src/ui/hud.js`, `src/camera.js`; nothing under `src/art/`,
`src/physics/`, `src/systems/` or `src/aircraft/` was touched.

1. **Composer per device** (`qualityProfile` -> `applyLevel`): desktop high is unchanged (HalfFloat,
   MSAA 4, bloom at full resolution, PCFSoft 4096); desktop medium keeps the composer with the
   bloom pyramid at half resolution; phone high = composer with MSAA 2 and half-resolution bloom,
   PCF 2048; phone medium and every low tier render straight to the canvas (no bloom; the
   canvas's own antialiasing is the cheap kind on a tile-based GPU), PCF 1024. Nothing here
   recompiles a shader: `applySettings` only sets `needsUpdate` when the shadow state (on/off,
   PCF/PCFSoft) actually changed, where it used to recompile every material on every call.
2. **Forest chunking** (`geom.js` `chunkInstanced`, called from `world/terrain.js` after
   `look.buildForest`/`buildRocks`): every instanced mesh the art bench returns is split into a
   grid of chunks of about 400 instances (7x7 on the plains, 11x11 on the mountain) with bounding
   spheres and `frustumCulled = true`, so both cameras cull. 4x4 was tried first: with 3.5 km
   cells every chunk's sphere touched the 180 m shadow box and 80% of the forest stayed in the
   shadow pass; at ~400 per chunk the shadow pass draws a tenth of it (plains 2.27M -> 0.46M
   triangles). Look-neutral: the same instances, in the same places, with the same colours.
3. **A dynamic quality controller** (`autoQuality` + `applyLevel`) replacing the two irreversible
   tier drops of `watchFrameRate()`: every ~1.5 s the median frame time is compared with a 60 fps
   target; over it by 12% the controller climbs one rung (render scale 90..50% in steps of 10,
   then the shadow map halved twice to a floor of 512, then bloom off, then the composer off),
   under 60% of it the rung is undone. The HUD is DOM and stays crisp at any scale. It is on for
   every device now (it used to default to phones only; a desktop browser that renders on an
   integrated GPU needs it just as much, and on a fast GPU it never triggers); Settings turns it
   off. Nothing on the ladder recompiles a shader; a rung costs one frame of reallocation.
4. **Parked aircraft** (`world/airport.js`): their landing-light SpotLights are removed at build
   time (so the light count never changes mid-flight: NUM_SPOT_LIGHTS 7 -> 1 in every shader),
   the six one-point nav-light `Points` become one, and once the downloaded airframe has landed
   (`settleParked`, polled from `update()`) each one's visible meshes are merged into one draw per
   material - materials that would compile to the same program with the same values share one
   representative - and its matrices frozen. The aerodrome (except the windsock's sock) and the
   terrain group are frozen (`matrixAutoUpdate = false`) after the build. Bayfield: 379 -> 211
   draws, 502 -> 106 objects in the airport group.
5. **HUD** (`ui/hud.js`): every write goes through change-checked setters (a `textContent` of the
   same string is still a mutation, and one mutation per frame was one layout per frame), ticks,
   bugs and needles move with `transform` (rounded to the pixel, as layout placed them) instead
   of `top`/`left`, the element lookups are cached, and the readouts (tape values, engine, config,
   wind, g-meter, status) refresh at 20 Hz while the tapes and the ADI stay per frame.
6. **Start-up** (`startCompile`): after the world is built the loop holds (`compiling`), the
   downloaded airframe is given up to 2.5 s to arrive, the sky's first `update()` installs the
   atmosphere into every material (the airframe included, which used to depend on timing), and
   `renderer.compileAsync` compiles everything with the main thread free; the flight then starts
   at t = 0 on a rendered frame. Harnesses that drive `frame()`/`render()` directly are unaffected.
7. Small allocation-free fixes in `main.js`/`camera.js` (per-frame `new Vector3`/`new Euler`, the
   HUD context object, the callout array literals), and the menu backdrop renders at half rate.

Not changing: the physics integrator and sub-step count (1.8 ms worst case at phone speed, and it
belongs to the `yaw` branch), `src/art/*` (requirements above instead), `models.js`.

## 7. After

Same method, same seed, same windows, measured on the finished branch. Baseline rows are from
section 3 (the matrix), after rows from the final verification run.

### 7.1 Before -> after

**The Pixel proxy** (phone viewport 1088x430, Intel UHD 770, CPU x3; the "before" rows are the
section 3.3 matrix, "after" the same runs on the finished branch):

| scene / camera / tier / device | fps50 before -> after | fps95 | cpu50 ms | gpu50 ms | draws | tris |
|---|---|---|---|---|---|---|
| solo/medium/phone/intel/cpu3 | 23.8 -> **70.9** | 16.2 -> 57.1 | 35.4 -> 10.5 | 31.6 -> 12.1 | 379 -> 189 | 2.53M -> 1.79M |
| solo/high/phone/intel/cpu3 | 18.3 -> **26.2** | 17 -> 24.6 | 20.3 -> 17.6 | 50.3 -> 34 | 379 -> 210 | 3.43M -> 2.10M |
| solo/low/phone/intel/cpu3 | 43.7 -> **91.7** | 28.9 -> 72.5 | 17.2 -> 8.3 | 7.2 -> 4.9 | 340 -> 151 | 0.93M -> 0.85M |
| heavy/medium/phone/intel/cpu3 | 33.3 -> **60.2** | 22.1 -> 50.8 | 16.4 -> 12 | 25.5 -> 8.2 | 459 -> 259 | 1.36M -> 0.91M |
| heavy/low/phone/intel/cpu3 | 46.9 -> **74.6** | 36.4 -> 61.3 | 15.7 -> 9.7 | 5.8 -> 3.8 | 378 -> 187 | 0.57M -> 0.57M |
| cq/medium/phone/intel/cpu3 | 46.3 -> **126.6** | 38.8 -> 92.6 | 14 -> 5.6 | 15.2 -> 3.9 | 116 -> 102 | 0.01M -> 0.01M |
| gravel/medium/phone/intel/cpu3 | 22.1 -> **58.1** | 20.9 -> 53.8 | 11.5 -> 9.4 | 40.6 -> 15.1 | 170 -> 220 | 5.66M -> 2.48M |
| gravel/low/phone/intel/cpu3 | 70.9 -> **99** | 67.6 -> 72.5 | 6.9 -> 6.7 | 12.5 -> 8.6 | 121 -> 164 | 2.60M -> 1.65M |

The phone tiers now render: low 1088x430 direct, medium 1632x645 direct (no composer), high
2176x860 through the composer with MSAA 2 and a half-resolution bloom. High on a phone is still
"as much as it can draw": the controller scales it to the frame time in play (in the `--auto`
run at medium the controller had nothing to do, 70.9 fps at level 0).

**Desktop** (RTX 4080, 1920x1080, DPR 1; 357 is the 360 Hz pacing cap; a real window at 2560x1440 on the
primary monitor: 357 fps, 0.9 ms CPU, 1.3 ms GPU):

| scene / camera / tier / device | fps50 before -> after | fps95 | cpu50 ms | gpu50 ms | draws | tris |
|---|---|---|---|---|---|---|
| solo/high | 333.3 -> **357.1** | 172.4 -> 333.3 | 2.3 -> 1.2 | 1.8 -> 1.2 | 379 -> 211 | 4.77M -> 2.07M |
| heavy/high | 149.3 -> **357.1** | 76.3 -> 294.1 | 5.1 -> 1.4 | 2.9 -> 1.3 | 459 -> 274 | 2.46M -> 1.33M |
| cq/high | 357.1 -> **357.1** | 333.3 -> 333.3 | 0.8 -> 1 | 0.7 -> 0.7 | 116 -> 116 | 0.01M -> 0.01M |
| night/high | 312.5 -> **357.1** | 147.1 -> 333.3 | 1.3 -> 1.1 | 0.9 -> 0.8 | 117 -> 117 | 0.01M -> 0.01M |
| gravel/high | 357.1 -> **357.1** | 333.3 -> 344.8 | 1 -> 0.9 | 1.4 -> 0.9 | 170 -> 193 | 5.64M -> 1.20M |
| fog/high | 344.8 -> **294.1** | 200 -> 175.4 | 2.1 -> 2.2 | 1.5 -> 1.4 | 459 -> 277 | 2.47M -> 1.57M |
| solo/cockpit/high | 263.2 -> **333.3** | 185.2 -> 188.7 | 3 -> 1.9 | 1.8 -> 1.4 | 355 -> 180 | 4.77M -> 2.19M |
| solo/medium | 250 -> **357.1** | 163.9 -> 294.1 | 3 -> 1.7 | 1.7 -> 1.4 | 379 -> 208 | 3.88M -> 2.31M |
| solo/low | 303 -> **357.1** | 212.8 -> 344.8 | 2.4 -> 1.1 | 0.6 -> 0.5 | 340 -> 151 | 0.93M -> 0.85M |

The one desktop row that reads lower after (`fog`, 345 -> 294) is inside the run-to-run band of a
scene that sits at the cap either way (2.1 -> 2.2 ms CPU, 1.5 -> 1.4 ms GPU); the mountain's draw
count rises (170 -> 193) because the forest is now 100 chunks, of which ~20 are on screen, instead
of two whole-county draws (5.64M -> 1.20M triangles).

**Start-up** (desktop, cold shader cache): the first frame of a flight lands 462 ms after "Fly"
with 91 ms of blocking CPU (the shadow depth materials and the composer passes, compiled at first
use), where it used to take 1,650 ms, all of it blocking (475 ms with a warm cache). On the direct
path (a phone's medium tier) 417 ms with 84 ms blocking. The world build itself is unchanged at
~300 ms on the i7 (three times that on a phone).

**Phone-speed CPU alone** (phone viewport on the RTX, CPU x3: what the CPU costs when the GPU is
free): plains medium 8.6 -> 4.2 ms per frame (render submission 6.9 -> 3.3, HUD 1.0 -> 0.3),
coast medium 20.0 -> 4.2 ms (render 16.4 -> 4.0, HUD 1.7 -> 0.3).

### 7.2 What each change bought (the ledger)

Measured in the order the changes landed, each row on top of the previous ones.

| change | where it shows | before -> after |
|---|---|---|
| Forest chunking + parked aircraft (lights stripped, nav lights merged, meshes merged, matrices frozen) | desktop plains high: draws, triangles, CPU | 379 -> 202 draws, 4.77M -> 4.13M tris (shadow pass still 1.88M with 4x4 chunks), CPU 2.0 -> 1.4 ms |
| | proxy plains medium (GPU) | 29.7 -> 26.2 ms; mountain medium 22 -> 29 fps (GPU 41 -> 31 ms); coast medium CPU 33 -> 25 ms |
| Finer chunks (~400 instances each) | desktop plains high, shadow pass | 1.88M -> 0.46M shadow triangles; whole frame 4.13M -> 2.07M |
| Composer per device (phone medium direct to canvas; phone high MSAA 2 + half-res bloom) | proxy plains medium (GPU) | 26.2 -> 12.2 ms: 24 -> 70 fps; plains high 18 -> 25 fps; coast medium 25 -> 79 fps; mountain medium 22 -> 54 fps; carrier medium 45 -> 92 fps |
| HUD change-only writes, transforms, 20 Hz readouts; no per-frame allocations | phone-speed CPU (RTX, x3): hud part | 1.0 -> 0.3 ms (plains), 1.7 -> 0.3 ms (coast); whole CPU frame 8.6 -> 4.2 ms and 20.0 -> 4.2 ms; desktop CPU 2.0 -> 1.0 ms |
| compileAsync before the first frame, with the composer's target bound | every flight start (cold shader cache) | first frame 1,650 ms after "Fly", all of it blocking -> 462 ms with 91 ms blocking; programs 64 -> 60 (an intermediate build that compiled without the target bound made 87: every material twice); the airframe is fogged consistently |
| Dynamic quality controller | anything slower than 60 fps | scales resolution 100 -> 50%, then shadows, bloom, composer; reversible; the Intel at 1440p high sits at 12 fps without it |
| Draw-call reduction overall | phone CPU | plains 379 -> 190 draws, coast 460 -> 263; at x3 throttle the render submission fell from 6.9/16.4 ms to 3.3/4.0 ms |

The look sheet (eleven scenes, same seed) against the baseline, shot three times on the finished
branch: ten scenes at a mean difference of 0.00-0.075/255 every time, and one scene per run at
0.75-1.15 - `mountain` in one run, `fog` in the next, never both. The amplified diff shows the
flying airframe alone: whether it receives the atmosphere fog patch depends on whether the
downloaded model has arrived when the harness takes its first step, a race the harness has
always had (it is the "lands on a different frame now and then" in `looksheet.mjs`'s header, and
the baseline sheet has it too). In play the order is now fixed by `startCompile` (model, then
fog, then compile), so the airframe is fogged every time; for the harness, waiting for
`game.model.gltfRoot` before the first step would close it. The same-build noise floor documented
in `looksheet.mjs` is about 6/255; nothing here approaches it.

### 7.3 Not done, and why

- The physics integrator and its sub-step count: 1.8 ms at 12 sub-steps on a phone-speed CPU,
  cheap, and the `yaw` branch's file. The heightfield queries (`fbm2`) are 0.4 ms of that.
- Anything in `src/art/*`: the requirements in section 5 instead, for the branches that own it.
  The one look-affecting decision made here is a tier one: a phone's medium tier has no bloom.
- Dynamic tree density: the forest is scattered in cell-scan order, so cutting an instanced
  mesh's `count` removes one side of the county rather than a random subset; density stays a
  static per-tier value (and the mountain still fills the 45,000 cap at medium, section 5).
- Merging the flying aircraft's draws (29-71): it animates, and `models.js` belongs to the
  visuals-aircraft branch. Requirement written.


## 8. Phase 3: what to re-measure once the new art lands

- The full matrix (`--matrix desktop`, `--matrix phone`, `--matrix proxy`) on the merged tree,
  and the price list (`--matrix ablation`) on the proxy at medium; compare with sections 3 and 7.
- **`npm run perf-budget`** (added after the pass): the per-module budgets of section 5 as pass/fail.
  `tools/perf-probe.mjs --budget` flies the plains, coast, carrier-night, mountain and fog scenes
  with the chase and the cockpit camera and prints, per run, one row per owner and metric -
  measured, budget, `ok` / `BREACH` / `info` - and exits 1 on any breach. It needs a GPU, so it is
  never part of `npm test`. What it asserts: vegetation triangles in view after culling (1.2M plains
  and coast, 2.0M mountain, times the tier's `treeScale`); ground, water and sky draws; airport
  draws (<= 60 without the parked aircraft), materials (<= 20) and transparent draws (<= 12 with
  them); parked aircraft <= 10 draws each; carrier <= 80 draws / 100k triangles; the flying airframe
  <= 20 draws (24 for the airliner), <= 60k triangles, <= 4 MB of textures; the cockpit interior
  <= 20 draws and <= 80k triangles in its own pass; particles <= 8 draws and <= 4,000 points on a
  clean approach; <= 70 programs; two directional, one hemisphere, at most one spot, no point light,
  and no light left visible at intensity 0; <= 12 MB of textures (the shadow map excluded);
  `frustumCulled = false` on nothing but the sky, clouds, stars, water and point sprites; no
  `material.needsUpdate` and no new program during the sample window. The GPU-millisecond budgets
  (16 ms per frame at phone medium, the cockpit pass <= 2 ms) are stated for the Intel UHD 770 and
  asserted only when the run is on it: `npm run perf-budget -- --gpu intel --phone --cpu 3
  --quality medium`; elsewhere they print as `info`. Owners are classified structurally (which
  group an object hangs under) plus the names and layers the visuals branches use: `parked:*`,
  `cockpit:*` / render layer 1 (`src/cockpit.js`, `src/art/cockpits/*`), instanced meshes under the
  terrain group (`world-vegetation.js`, `world-props.js`), the ground mesh (`world-ground.js`), the
  water (`world-water.js`), Points with particle attributes or names (`src/particles.js` +
  `effects.js`), the model group (`src/art/airframes/*` + `livery.js`). Against `main` before the
  new art lands the run reports the section-5 items the art branches still owe (listed in the
  changelog entry).
- The cockpit pass and the particle engine specifically (`--ablate` entries for each).
- **The real phone**: the proxy cannot tell how Mali handles MSAA on a HalfFloat target or how
  Chrome's compositor treats the `backdrop-filter` boxes; the first thing to do after the merge
  is a flight on the Pixel 9 Pro at each tier with the frame-rate readout (the dynamic resolution
  controller logs its scale changes to the console).
- The desktop wiring: if the PC still feels slow, edge://gpu (GL_RENDERER must name NVIDIA),
  Windows Settings > Display > Graphics for the browser, and which adapter the 360 Hz monitor is
  plugged into.

## 9. Merged art, 2026-09-14 evening

`main` at b166d49 carries the world rebuild (`src/art/world-*.js`, `quality.js`, a chunked LOD ground,
LOD vegetation in 600 m cells, baked-wave water), the aircraft work (`src/art/airframes/*`, the cockpit
placeholders in `src/art/cockpits/*` behind `src/cockpit.js`'s layer-1 pass, `src/particles.js`, three
procedural exteriors shipping via `SHIPS`) and the engine pass above. Measured with the same tool, seed
and windows as sections 3 and 7, chase and cockpit cameras; the "before" columns are section 7.

### 9.1 Engine-side findings on the merged tree (fixed on `perf`)

- **Every "Fly" waited 2.5 s for a glTF that never comes.** `startCompile` gave the downloaded airframe
  up to 2.5 s to arrive before installing the atmosphere and compiling; three airframes now ship as
  procedural models, so the wait always ran to its timeout (first frame 2.8 s after "Fly" instead of
  0.46 s). Fixed: the wait applies only to airframes that `shipsGltf()`.
- **The cockpit's state feed ran every frame in every view.** `frame()` built the interior's `extra`
  object and called `wind.surface()` for it whether or not the cockpit view was up. Fixed: gathered
  only in the cockpit view (`CockpitView.update` itself already returned early).
- **The quality controller's rung leaked into the world's detail.** `WORLD_QUALITY.detail` is derived
  from the shadow map size the sky is built with; `loadSite` passed the controller's current map, so a
  rung taken on one flight built the next world a detail level down and left it there. Fixed: the sky
  gets the tier's map, the controller's map is applied afterwards.
- **The renderer walks every vegetation LOD wrapper every frame - measured, and left alone.** The
  vegetation arrives as ~1,300 `THREE.LOD` chunks (600 m cells, one per species and level) plus
  their empty far-level groups; the census counts ~1,300 visible objects under the terrain group on
  the plains where there were a few dozen, and the desktop profile puts `updateMatrixWorld` +
  `multiplyMatrices` at 16% of the samples. An engine-side gate was built and tried: the decoration
  parcelled into a coarse grid of frozen groups with bounding spheres, a cell detached from the
  scene whenever the camera frustum missed it and it lay beyond the shadow box's reach, proven
  look-neutral sheet against sheet with `tools/looksheet-inject.mjs` (0.000/255 on ten scenes,
  0.008 on carrier-day where the wake animates). It did not pay: on a quiet machine the two arms
  read the same (phone-speed CPU 5.3-5.5 vs 5.5 ms, desktop 1.7 vs 1.7), because on final most
  cells are in view or within reach anyway. Not kept. On the proxy, clean, the merged tree's CPU per frame is level with section 7 or a
  little under it (plains medium 10.5 -> 9.9 ms, coast 12.0 -> 10.1); only the RTX-side run at
  phone-speed CPU reads 5.4 ms against 4.2 (+1.2 ms: more objects and materials for a third fewer
  draws). The 15.8 ms read earlier was contamination from A/B runs sharing the CPU. The lever, if
  one is ever needed, is the cell size on the art side (section 9.3).
- **The cockpit pass cost a second walk of the world and a second MSAA resolve.** `src/cockpit.js` drew
  the interior by rendering the whole world scene again through a layer filter (every one of the
  ~1,300 objects visited twice: +3-4 ms of CPU per frame at phone speed on the plains, +1.3 on the
  object-light carrier), and through the composer it rendered into the HalfFloat MSAA target a
  second time, which makes three.js resolve that target again: 11-12 ms of GPU per frame at the
  phone's high tier on every site (1.5-4 ms on the direct path at medium, which is the draws
  themselves). Fixed: the interior lives in a small scene of its own, on a proxy that carries the
  model's world matrix, lit by per-frame copies of the world's sun, sky and moon, and it is drawn
  straight to the canvas after the composer on every tier (the renderer's tone mapping applies, the
  same curve the output pass gives the world; the interior gets no bloom, which the placeholders
  never showed anyway). Measured on the proxy after the rework, cockpit view: plains low 47 -> 159 fps (CPU 17.7 -> 4.9 ms),
  medium 46 -> 69 fps (18.1 -> 11.3 ms, GPU 7.1 -> 6.7), high 20 -> 30 fps (CPU 43.9 -> 19.7 ms, GPU
  39.3 -> 29.2: the second resolve gone); coast medium 44 -> 67 fps; carrier high 27 -> 33 fps. The
  cockpit view now sits within about a millisecond of the chase view on both CPU and GPU.
- `settleParked` no longer waits 12 s to merge an orphaned model: airport-look flattens the parked
  models itself now (synchronously, the exteriors being procedural), and the engine's merge skips a
  group that never entered the scene.
- The probe: readiness now follows the engine's `compiling` flag instead of `model.gltfRoot`; the
  census recognises the new names (`world/ground`, `vegetation/*`, `aerodrome/parked-*`); the
  cockpit feed is timed as a part.

### 9.2 Tables

Desktop and proxy rows are the clean re-runs after the engine fixes of 9.1 (the phone-viewport
rows on the RTX were shot before them; nothing in 9.1 changes a chase-camera frame on the RTX).
The "before" values are section 7.

### Desktop, RTX 4080, 1920x1080 high (section 7 "after" -> merged art)

| scene / camera | fps50 | fps95 | cpu50 ms | gpu50 ms (scene/cockpit/bloom) | draws | tris (shadow) | load ms | parts p50 ms |
|---|---|---|---|---|---|---|---|---|
| solo / chase | 357.1 -> **357.1** | 333.3 -> **344.8** | 1.2 -> **1.5** | 1.2 (0.9/0/0.2) | 211 -> 147 | 2.07M -> 0.53M (0.03M) | 687 | render 1.3 hud 0.1 fx 0 |
| solo / cockpit | 333.3 -> **357.1** | 188.7 -> **333.3** | 1.9 -> **1.7** | 1.2 (1/0/0.2) | 180 -> 174 | 2.19M -> 0.55M (0.03M) | 657 | render 1.5 hud 0.1 fx 0 cockpit 0 |
| heavy / chase | 357.1 -> **357.1** | 294.1 -> **344.8** | 1.4 -> **1.5** | 1.2 (0.9/0/0.2) | 274 -> 163 | 1.33M -> 0.56M (0.07M) | 793 | render 1.2 hud 0.1 fx 0 |
| heavy / cockpit | **357.1** | **263.2** | **1.7** | 1.1 (0.8/0/0.2) | 168 | 0.48M (0.05M) | 778 | render 1.4 hud 0.1 fx 0 cockpit 0 |
| cq / chase | 357.1 -> **357.1** | 333.3 -> **344.8** | 1 -> **0.8** | 0.9 (0.6/0/0.2) | 116 -> 107 | 0.01M -> 0.00M (0.00M) | 252 | render 0.6 hud 0.1 fx 0 |
| cq / cockpit | **357.1** | **344.8** | **0.9** | 0.8 (0.5/0.1/0.2) | 102 | 0.01M (0.00M) | 249 | render 0.7 hud 0.1 fx 0 cockpit 0 |
| night / chase | 357.1 -> **357.1** | 333.3 -> **344.8** | 1.1 -> **0.9** | 0.9 (0.6/0/0.2) | 117 -> 108 | 0.01M -> 0.00M (0.00M) | 249 | render 0.7 hud 0.1 fx 0 |
| night / cockpit | **357.1** | **344.8** | **0.9** | 0.8 (0.4/0.1/0.2) | 103 | 0.01M (0.00M) | 250 | render 0.7 hud 0.1 fx 0 cockpit 0 |
| gravel / chase | 357.1 -> **357.1** | 344.8 -> **344.8** | 0.9 -> **1.5** | 1.4 (1.1/0/0.2) | 193 -> 218 | 1.20M -> 1.01M (0.28M) | 979 | render 1.3 hud 0.1 fx 0 |
| gravel / cockpit | **357.1** | **344.8** | **1.7** | 1.4 (1.1/0.1/0.2) | 244 | 1.02M (0.28M) | 975 | render 1.4 hud 0.1 fx 0 cockpit 0 |
| fog / chase | 294.1 -> **357.1** | 175.4 -> **344.8** | 2.2 -> **1.5** | 1.3 (1.1/0/0.2) | 277 -> 177 | 1.57M -> 0.74M (0.18M) | 751 | render 1.3 hud 0.1 fx 0 |
| fog / cockpit | **357.1** | **303** | **1.6** | 1.2 (0.8/0/0.2) | 179 | 0.63M (0.14M) | 741 | render 1.4 hud 0.1 fx 0 cockpit 0 |

### Phone viewport on the RTX, medium (the phone tiers' CPU without a slow GPU)

| scene / camera | fps50 | cpu50 ms | gpu50 ms | draws | tris | parts p50 ms |
|---|---|---|---|---|---|---|
| solo / chase | 357.1 | 1.4 | 0.5 | 116 | 0.17M | render 1.2 hud 0.1 fx 0 |
| solo / cockpit | 357.1 | 2.1 | 0.7 | 142 | 0.16M | render 1.8 hud 0.1 fx 0 cockpit 0 |
| heavy / chase | 357.1 | 1.7 | 0.8 | 136 | 0.22M | render 1.4 hud 0.1 fx 0 |
| heavy / cockpit | 344.8 | 2.1 | 0.6 | 144 | 0.21M | render 1.8 hud 0.1 fx 0 cockpit 0 |
| cq / chase | 357.1 | 0.9 | 0.3 | 93 | 0.00M | render 0.6 hud 0.1 fx 0 |
| cq / cockpit | 357.1 | 1.1 | 0.3 | 88 | 0.01M | render 0.8 hud 0.1 fx 0 cockpit 0 |
| night / chase | 357.1 | 0.8 | 0.3 | 94 | 0.00M | render 0.5 hud 0.1 fx 0 |
| night / cockpit | 357.1 | 0.6 | 0.4 | 89 | 0.01M | render 0.4 hud 0.1 fx 0 cockpit 0 |
| gravel / chase | 357.1 | 1.3 | 0.4 | 178 | 0.34M | render 1 hud 0.1 fx 0 |
| gravel / cockpit | 357.1 | 1.7 | 0.8 | 204 | 0.34M | render 1.5 hud 0.1 fx 0 cockpit 0 |
| fog / chase | 357.1 | 1.4 | 0.5 | 140 | 0.22M | render 1.1 hud 0.1 fx 0 |
| fog / cockpit | 357.1 | 1.9 | 0.6 | 145 | 0.20M | render 1.6 hud 0.1 fx 0 cockpit 0 |

### The Pixel proxy (Intel UHD 770, CPU x3, phone viewport): section 7 -> merged art

| scene / tier / camera | fps50 | fps95 | cpu50 ms | gpu50 ms (scene/cockpit/bloom) | draws | tris | veg tris in view |
|---|---|---|---|---|---|---|---|
| solo / low / chase | 91.7 -> **99** | 78.7 | 8.3 -> 7.9 | 4.9 -> 2.4 (2.4/0/0) | 95 | 0.10M | 0.04M |
| solo / low / cockpit | **90.1** | 71.4 | 8.7 | 3 (2.4/0.6/0) | 124 | 0.10M | 0.04M |
| solo / medium / chase | 70.9 -> **78.7** | 65.4 | 10.5 -> 9.9 | 12.1 -> 5.7 (5.7/0/0) | 116 | 0.22M | 0.09M |
| solo / medium / cockpit | **69.4** | 59.5 | 11.4 | 6.7 (5.4/1.2/0) | 142 | 0.16M | 0.09M |
| solo / high / chase | 26.2 -> **31.6** | 29 | 17.6 -> 20.5 | 34 -> 27.9 (16.3/0/10.2) | 146 | 0.39M | 0.22M |
| solo / high / cockpit | **30.2** | 28.2 | 20.5 | 29.3 (15.8/2.1/10) | 171 | 0.33M | 0.22M |
| heavy / low / chase | 74.6 -> **95.2** | 76.3 | 9.7 -> 7.5 | 3.8 -> 2.4 (2.4/0/0) | 111 | 0.13M | 0.06M |
| heavy / low / cockpit | **83.3** | 59.2 | 8.7 | 5 (2.2/2.8/0) | 120 | 0.12M | 0.05M |
| heavy / medium / chase | 60.2 -> **70.9** | 59.9 | 12 -> 10.1 | 8.2 -> 5.4 (5.4/0/0) | 136 | 0.22M | 0.13M |
| heavy / medium / cockpit | **68.5** | 57.8 | 10.7 | 6.1 (4.9/1.1/0) | 144 | 0.21M | 0.13M |
| heavy / high / chase | **31.5** | 28.8 | 16.8 | 27.7 (16.1/0/10.1) | 154 | 0.43M | 0.21M |
| heavy / high / cockpit | **28.3** | 24.5 | 20.1 | 30.3 (15.7/5/9.5) | 162 | 0.36M | 0.21M |
| cq / low / chase | **222.2** | 147.1 | 3.2 | 1 (1/0/0) | 63 | 0.00M | - |
| cq / low / cockpit | **188.7** | 128.2 | 3.9 | 1.6 (1/0.6/0) | 79 | 0.00M | - |
| cq / medium / chase | 126.6 -> **137** | 103.1 | 5.6 -> 5.2 | 3.9 -> 2.7 (2.7/0/0) | 93 | 0.00M | - |
| cq / medium / cockpit | **128.2** | 97.1 | 5.9 | 3.8 (2.5/1.3/0) | 88 | 0.01M | - |
| cq / high / chase | **37.2** | 34.8 | 12.7 | 23.1 (11.8/0/9.8) | 107 | 0.00M | - |
| cq / high / cockpit | **33.1** | 28.9 | 14.4 | 25 (11.6/3.3/9.1) | 102 | 0.01M | - |
| night / low / chase | **204.1** | 137 | 3.4 | 1 (1/0/0) | 64 | 0.00M | - |
| night / low / cockpit | **169.5** | 120.5 | 4.2 | 1.8 (1/0.7/0) | 80 | 0.00M | - |
| night / medium / chase | **133.3** | 103.1 | 5.2 | 2.7 (2.7/0/0) | 94 | 0.00M | - |
| night / medium / cockpit | **126.6** | 99 | 5.8 | 4.1 (2.5/1.6/0) | 89 | 0.01M | - |
| night / high / chase | **38.6** | 35.7 | 12 | 22.2 (11.5/0/9.3) | 108 | 0.00M | - |
| night / high / cockpit | **34.2** | 29.4 | 13.7 | 24.8 (11.3/3.8/8.7) | 103 | 0.01M | - |
| gravel / low / chase | 99 -> **114.9** | 87 | 6.7 -> 6.6 | 8.6 -> 2.8 (2.8/0/0) | 145 | 0.22M | 0.12M |
| gravel / low / cockpit | **102** | 81.3 | 7.4 | 3.5 (2.9/0.6/0) | 170 | 0.23M | 0.12M |
| gravel / medium / chase | 58.1 -> **78.7** | 62.9 | 9.4 -> 9.8 | 15.1 -> 6.2 (6.2/0/0) | 178 | 0.34M | 0.18M |
| gravel / medium / cockpit | **69.4** | 56.2 | 11.2 | 7.8 (6.4/1.4/0) | 204 | 0.34M | 0.18M |
| gravel / high / chase | **29.5** | 27.8 | 15.8 | 30 (18.5/0/10.1) | 209 | 0.72M | 0.32M |
| gravel / high / cockpit | **27.9** | 26.2 | 16 | 32.2 (18.7/2.2/9.9) | 236 | 0.72M | 0.32M |
| fog / low / chase | **104.2** | 82.6 | 7.2 | 2.6 (2.6/0/0) | 114 | 0.14M | 0.04M |
| fog / low / cockpit | **94.3** | 74.1 | 8.1 | 4.1 (2.2/2/0) | 121 | 0.11M | 0.04M |
| fog / medium / chase | **78.1** | 65.4 | 9.6 | 5.4 (5.4/0/0) | 140 | 0.22M | 0.09M |
| fog / medium / cockpit | **72.5** | 60.2 | 10.7 | 5.8 (4.6/1.1/0) | 146 | 0.20M | 0.08M |
| fog / high / chase | **32.7** | 29.9 | 19.2 | 26.9 (15.7/0/9.8) | 163 | 0.49M | 0.21M |
| fog / high / cockpit | **29.9** | 25.4 | 18.1 | 28.9 (14.5/5/9.2) | 170 | 0.42M | 0.22M |

### Price list on the proxy (phone medium), merged art

| run | fps50 | frame ms | gpu ms | gpu saved | cpu ms |
|---|---|---|---|---|---|
| solo/chase/medium/phone/intel/cpu3 | 76.3 | 13.1 | 5.7 | - | 10.1 |
| solo/chase/medium/phone/intel/cpu3/-shadows | 84.7 | 11.8 | 4.9 | 0.8 | 9.2 |
| solo/chase/medium/phone/intel/cpu3/-shadow:512 | 63.7 | 15.7 | 5.6 | 0.1 | 12.6 |
| solo/chase/medium/phone/intel/cpu3/-composer | 74.1 | 13.5 | 5.7 | 0.0 | 10.6 |
| solo/chase/medium/phone/intel/cpu3/-clouds | 75.2 | 13.3 | 5.4 | 0.3 | 10.4 |
| solo/chase/medium/phone/intel/cpu3/-sky | 71.9 | 13.9 | 5.3 | 0.4 | 10.7 |
| solo/chase/medium/phone/intel/cpu3/-stars | 74.6 | 13.4 | 5.7 | 0.0 | 10.4 |
| solo/chase/medium/phone/intel/cpu3/-forest | 76.9 | 13 | 5.5 | 0.2 | 10 |
| solo/chase/medium/phone/intel/cpu3/-terrain | 84 | 11.9 | 2.5 | 3.2 | 9.4 |
| solo/chase/medium/phone/intel/cpu3/-water | 71.4 | 14 | 5.8 | -0.1 | 10.9 |
| solo/chase/medium/phone/intel/cpu3/-hud | 89.3 | 11.2 | 5.7 | 0.0 | 9.4 |
| solo/chase/medium/phone/intel/cpu3/-physics | 80.6 | 12.4 | 5.9 | -0.2 | 9.9 |
| solo/chase/medium/phone/intel/cpu3/-particles | 77.5 | 12.9 | 5.7 | 0.0 | 10 |
| solo/chase/medium/phone/intel/cpu3/-lights | 79.4 | 12.6 | 5.7 | 0.0 | 10 |
| solo/chase/medium/phone/intel/cpu3/-aircraft | 85.5 | 11.7 | 5.2 | 0.5 | 9 |
| solo/chase/medium/phone/intel/cpu3/-airport | 87 | 11.5 | 5.6 | 0.1 | 8.9 |
| solo/chase/medium/phone/intel/cpu3/-fog | 76.9 | 13 | 5.7 | 0.0 | 10.1 |
| solo/chase/medium/phone/intel/cpu3/-dpr:1 | 79.4 | 12.6 | 3.5 | 2.2 | 10 |
| heavy/chase/medium/phone/intel/cpu3 | 71.4 | 14 | 5.4 | - | 10 |
| heavy/chase/medium/phone/intel/cpu3/-water | 69.9 | 14.3 | 5.3 | 0.1 | 10.2 |
| heavy/chase/medium/phone/intel/cpu3/-forest | 74.6 | 13.4 | 5.4 | 0.0 | 9.4 |
| gravel/chase/medium/phone/intel/cpu3 | 73 | 13.7 | 6.2 | - | 10.5 |
| gravel/chase/medium/phone/intel/cpu3/-forest | 88.5 | 11.3 | 5.7 | 0.5 | 8.5 |
| cq/chase/medium/phone/intel/cpu3 | 147.1 | 6.8 | 2.6 | - | 4.9 |
| cq/chase/medium/phone/intel/cpu3/-water | 149.3 | 6.7 | 1.7 | 0.9 | 4.9 |
| cq/chase/medium/phone/intel/cpu3/-carrier | 166.7 | 6 | 2.6 | 0.0 | 4.2 |
| solo/cockpit/medium/phone/intel/cpu3 | 71.4 | 14 | 6.7 | - | 11.1 |
| solo/cockpit/high/phone/intel/cpu3 | 30.9 | 32.4 | 28.7 | - | 19.9 |

### The cockpit view after the rework (Intel proxy, CPU x3)

| run | fps50 | cpu50 ms | render ms | gpu50 ms (scene/cockpit/bloom) | cockpit draws |
|---|---|---|---|---|---|
| solo/cockpit/low | 158.7 | 4.9 | 3.8 | 3 (2.4/0.61/0) | 40 |
| solo/cockpit/medium | 69.4 | 11.3 | 9.1 | 6.66 (5.41/1.24/0) | 40 |
| solo/cockpit/high | 30.3 | 19.7 | 15 | 29.24 (15.71/2.1/9.91) | 40 |
| heavy/cockpit/medium | 67.1 | 11 | 8.3 | 6.07 (4.91/1.1/0) | 32 |
| cq/cockpit/high | 33.1 | 14.1 | 9.6 | 24.97 (11.6/3.29/9.07) | 47 |
| solo/chase/medium | 77.5 | 10 | 7.8 | 5.69 (5.69/0/0) | 0 |
| solo/chase/medium/-cellgate | 78.1 | 9.9 | 7.7 | 5.7 (5.7/0/0) | 0 |
| solo/chase/medium | 76.9 | 10.1 | 7.9 | 5.7 (5.7/0/0) | 0 |
| solo/chase/medium/-cellgate | 78.7 | 9.9 | 7.7 | 5.69 (5.69/0/0) | 0 |


### 9.3 What the new art costs or saves, per scene and owner

On the Pixel proxy at the phone's **medium** tier (the tier a phone starts on), GPU per frame,
section 7 -> merged art: plains 12.1 -> 5.9 ms, coast 8.2 -> 5.4, carrier 3.9 -> 2.7, mountain
15.1 -> 6.2; at **low**: plains 4.9 -> 2.6, coast 3.8 -> 2.4, mountain 8.6 -> 2.8. The world rebuild
is a large GPU saving everywhere, and the vegetation is where it came from: on the plains the forest
went from 11.7 ms to 0.2 ms (LOD cards and cells), on the mountain from 23.5 ms (45,000 trees in
two draws) to 0.5 ms. The price list at plains medium is now 5.7 ms of GPU in total, of which:

| item (phone medium, plains, UHD 770) | GPU ms | owner |
|---|---|---|
| ground (24 LOD tiles, the parcel shader, PCF receive) | **3.2** | world (`world-ground.js`) |
| render scale (DPR 1.5 -> 1) | 2.2 | engine (the controller's first rung) |
| water (carrier, medium) | 0.9 | world (`world-water.js`) |
| shadows (1024, PCF) | 0.8 | engine tier + world casters |
| aircraft (procedural Skylark) | 0.5 | aircraft (`airframes/skylark.js`) |
| sky dome | 0.4 | world |
| clouds | 0.3 | world |
| forest | 0.2 | world |
| HUD, particles, lights, airport, fog, stars, physics | 0.0 each | - |

The **ground is now more than half of the frame** at phone medium; the world agent's next brief
should price its shader (the parcel block, the skirts' overdraw, the two detail taps) against a
2 ms target - everything else on the world side is already under a millisecond.

The **CPU** held: on the proxy, clean, the plains cost 9.9 ms per frame at medium against 10.5 in
section 7 (coast 10.1 against 12.0, carrier 5.2 against 5.6) with 116 draws against 190. What
grew is the object count - ~1,300 LOD wrappers plus their empty far-level groups walked by
three.js every frame - and it shows only as a small residual on the RTX-side run at phone-speed
CPU (5.4 against 4.2 ms); the cockpit view, which walked them a second time, is handled in 9.1.
For the world agent the request is mild: 600 m cells at ~400 instances were chosen for the GPU's
sake, and a 1,200 m cell would halve the object count for free should the CPU ever be the limit.

**Start-up**: `loadSite` went from ~300 ms to 676 (plains), 787-840 (coast), 983 (mountain), 689
(fog) on the i7 - the LOD ground grids and the vegetation cells are built synchronously - which is
two to three seconds of black after "Fly" on a phone (the sea sites are unchanged at 250 ms). The
world agent owns this one: the near ground grids at 20 m over the 4 km flight region and the
vegetation scatter are the two items to time (their `tools/world-probe.mjs` can split it).

**Budgets on the merged tree** (`npm run perf-budget`, both GPUs, 29 breaches of 246/261 checks;
the GPU rows all pass at phone medium: plains 5.9, coast 5.4, carrier 2.7, mountain 6.2, fog 5.4 of 16):

| breach | measured | budget | owner |
|---|---|---|---|
| ground draws | 24 | 2 (obsolete) | budget updated to 24: the world branch's own design (16 central + 8 outer LOD tiles) |
| textures per site, shadow map excluded | 12.5-14.2 MB airfields, 23.9-24.2 MB carrier | 12 MB | world (`textures.js`: the 4096x512 runway sheet is 11.2 MB alone; the carrier deck sheet ~11 MB) |
| a light visible at intensity 0 | 1 (night: the sun; fog: dusk) | 0 | world (`sky.js`: hide the sun by night as the moon is hidden by day) |
| `material.needsUpdate` sets in 8 s | 3,120-5,814 (chase, night), 11,336-17,286 (cockpit) | 0 | aircraft (the cockpit placeholders' transparent DoubleSide glass) and world (a two-pass material on the carrier at night); the budget row now names the materials |
| cockpit draws in its pass | 29-47 | 20 | aircraft - placeholders, known, ignored tonight |
| Hornet draws | 31 | 20 | aircraft (still the downloaded model; the other three are procedural and within budget: Skylark 18, Condor 24, Trailblazer 18) |

Passing now: vegetation triangles in view (0.04-0.32M against 0.6-2.0M budgets), airport draws and
materials, transparent draws, parked aircraft, carrier, aircraft triangles and textures, particles
(the new engine draws live particles only), programs (49-63), light counts, culling flags, no
programs compiled mid-window.

