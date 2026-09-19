// CLEARED TO LAND - main: renderer, world loading, game loop, state machine.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { KT, FT, FPM, DEG, RAD, NM, clamp, headingToVec, wrapPi, makeRng } from './config.js';
import { Input } from './input.js';
import { Aircraft, makeGroundOut } from './physics/aircraft.js';
import { Wind } from './physics/wind.js';
import { AIRCRAFT } from './aircraft/defs.js';
import { buildModel, shipsGltf } from './aircraft/models.js';
import { Terrain } from './world/terrain.js';
import { Airport } from './world/airport.js';
import { Carrier } from './world/carrier.js';
import { SkySystem } from './art/sky.js';
import { Effects } from './art/effects.js';
import { CameraRig, CAMERA_MODES, CAMERA_NAMES } from './camera.js';
import { CockpitView } from './cockpit.js';   // the interior: its own layer and render pass (see src/cockpit.js)
import { HUD } from './ui/hud.js';
import { Menus } from './ui/menus.js';
import { AudioSys } from './audio.js';
import { SITES, SCENARIOS, siteFlats, resolveScenario, makeFreeFlight } from './systems/scenarios.js';
import { scoreLanding, vrefFor } from './systems/scoring.js';
import { pilotName, publish, forget as forgetBoards } from './systems/leaderboard.js';
import { FailureRuntime } from './systems/failureEffects.js';
import { Weather, resolveWeatherSpec } from './systems/weather.js';
import { MissionRuntime } from './systems/mission.js';
import { RoutePilot } from './systems/routepilot.js';
import { ObstacleField } from './world/obstacles.js';
import { WeatherLook } from './art/weather-look.js';
import { MISSION_GROUPS, missionOrder } from './missions/index.js';
import { validateFreeOpts } from './missions/free.js';
import { FAILURES } from './systems/malfunctions.js';
import { Autoland } from './systems/autopilot.js';
import { FlightControl } from './systems/flightControl.js';
import { TouchControls, touchLikely, touchify } from './touch.js';

const DEFAULT_SETTINGS = { quality: 'high', sensitivity: 1, mouseSens: 0.5, volume: 0.8, voice: true, hints: true, invert: false, camera: 'chase', approach: 'short', autoTrim: true, keyStrip: true, touch: 'auto', autoQuality: null, tilt: false, stickSide: 'right' };

// Rendering tiers. `touch` = phone/tablet: fewer shadow texels, a lower pixel ratio and thinner forests for the same setting.
//
// Performance pass (docs/PERF.md, 2026-09-14). Measured on a mobile-class GPU the post-processing
// composer was the biggest single cost (MSAA 4x on a HalfFloat target 13 ms + bloom at full
// resolution 7 ms of a 30 ms frame at the phone's medium tier), so the composer is now a tier
// decision per device: desktop keeps it whole (the desktop high tier is unchanged), a phone gets
// it only on high, with 2x MSAA and the bloom blurred at half resolution (`bloomScale`), and the
// low tiers and a phone's medium tier draw straight to the canvas, whose own antialiasing is the
// cheap kind on a tile-based GPU. `soft` picks PCFSoft (desktop) or PCF (phone) shadows. On top of
// the tier, autoQuality() scales the render resolution and steps these knobs at run time.
function qualityProfile(quality, touch) {
  if (quality === 'low') return { shadows: false, shadowMap: 1024, maxDpr: 1, composer: false, msaa: 0, bloomScale: 0.5, soft: false, treeScale: 0.3 };
  if (quality === 'medium') {
    if (touch) return { shadows: true, shadowMap: 1024, maxDpr: 1.5, composer: false, msaa: 0, bloomScale: 0.5, soft: false, treeScale: 0.5 };
    return { shadows: true, shadowMap: 2048, maxDpr: 2, composer: true, msaa: 4, bloomScale: 0.5, soft: true, treeScale: 0.8 };
  }
  if (touch) return { shadows: true, shadowMap: 2048, maxDpr: 2, composer: true, msaa: 2, bloomScale: 0.5, soft: false, treeScale: 0.7 };
  return { shadows: true, shadowMap: 4096, maxDpr: 2, composer: true, msaa: 4, bloomScale: 1, soft: true, treeScale: 1 };
}
// The run-time ladder autoQuality() climbs when frames run long: first the render scale (the HUD
// is DOM and stays crisp), then the shadow map, then the bloom, then the composer. Every rung is
// reversible and none of them recompiles a shader.
const AUTO_LEVELS = 9;
const AUTO_TARGET_MS = 1000 / 60;
// Altitude callouts (metres are converted at the call site); module constants so a frame allocates nothing.
const JET_CALLOUTS = [2500, 1000, 500, 400, 300, 200, 100, 50, 40, 30, 20, 10];
const LIGHT_CALLOUTS = [500, 200, 100, 50, 20, 10];
// Free flight's options (src/missions/free.js has the ranges and turns them into a scenario). windRel is degrees off the
// landing direction, + = from the right (older saves carried an absolute windDir; validateFreeOpts converts it).
const DEFAULT_FREE = { aircraft: 'skylark', site: 'bayfield', weather: 'clear', windRel: -60, windSpeed: 8, windGust: 12, turb: 0.15, microburst: false, time: 15, vis: 30000, ceilingFt: null, seaState: 0.3, weight: 'normal', dist: 5000, obstacles: true, failures: [], surprise: false, when: 'approach' };

// 2026-09-14: the game got its name. Saved settings, logbook and pilot name from the
// working-title keys carry over once; the old keys are left alone.
(function migrateStorage() {
  try {
    for (const k of ['settings', 'best', 'free', 'pilot']) {
      const o = localStorage.getItem('greaser.' + k), n = localStorage.getItem('ctl.' + k);
      if (o != null && n == null) localStorage.setItem('ctl.' + k, o);
    }
  } catch (e) { /* storage unavailable */ }
})();

class Game {
  constructor() {
    const app = document.getElementById('app');
    this.app = app;
    const saved = loadJSON('ctl.settings', {});
    this.settings = { ...DEFAULT_SETTINGS, ...saved };
    this.touchDevice = touchLikely();   // phones and tablets: touch controls, compact HUD, lighter graphics
    this.touchSeen = false;
    if (!saved.quality && this.touchDevice) this.settings.quality = 'medium';   // a phone starts a tier down; autoQuality() scales from there
    // a saved setup may name a site, aircraft or failure this build does not have (or be anything at all): cleaned, never trusted
    this.freeOpts = validateFreeOpts(loadJSON('ctl.free', {}), { defaults: DEFAULT_FREE, sites: SITES, aircraft: AIRCRAFT, failures: FAILURES, missions: SCENARIOS });
    this.best = loadJSON('ctl.best', {});
    this.pilot = pilotName.get();   // the logbook name new bests are stamped with; shared with the rest of goodmarc.com

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'game';
    app.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.3, 60000);
    this.camera.position.set(0, 30, 80);

    const rt = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { type: THREE.HalfFloatType, samples: 4 });
    this.rtSamples = 4;
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.35, 0.5, 0.92);
    // The bloom's blur pyramid can run below the frame's resolution (profile.bloomScale); its
    // composite still lands at full size. The composer resizes every pass, so the scale is
    // applied here rather than once.
    const bloomSetSize = this.bloom.setSize.bind(this.bloom);
    this.bloom.setSize = (w, h) => { const s = (this.profile && this.profile.bloomScale) || 1; bloomSetSize(Math.max(2, Math.round(w * s)), Math.max(2, Math.round(h * s))); };
    this.outputPass = new OutputPass();
    this.composer.addPass(this.renderPass);
    // the cockpit interior: drawn after the world with its own near plane, before the bloom (src/cockpit.js)
    this.cockpitView = new CockpitView(this.renderer, this.scene, this.camera);
    this.composer.addPass(this.cockpitView.pass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.outputPass);
    this.level = 0;             // autoQuality() rung, 0 = the tier as chosen
    this.renderScale = 1;       // render resolution relative to the tier's pixel ratio
    this.compiling = false;     // true while the shaders of a new flight compile (the loop holds)
    this._shadowState = '';     // what the compiled materials assume about shadows (a change is the one thing that needs a recompile)
    this._tower = new THREE.Vector3();
    this._hudCtx = {};
    this.frameNo = 0;
    this.ftWin = []; this.ftCool = 0; this.ftMsgAt = -10;

    const vignette = document.createElement('div');
    vignette.id = 'vignette';
    app.appendChild(vignette);
    this.input = new Input();
    this.input.menuOpen = () => !!(this.menus && this.menus.visible);   // the menu owns Tab, Space, Enter, arrows and Esc while it is up
    this.input.attachMouse(this.renderer.domElement);
    this.audio = new AudioSys();
    this.hud = new HUD(app);
    this.hud.visible = false;
    this.touch = new TouchControls(app, this.input, this);
    this.menus = new Menus(app, this);
    this.rig = new CameraRig(this.camera, this.input);
    this.effects = null;
    this.world = null;
    this.ac = null;
    this.model = null;
    this.wind = new Wind();
    this.state = 'menu';
    this.t = 0;
    this.endTimer = 0;
    this.scenario = null;
    this.scenarioBase = null;
    // The weather's local overlay (a microburst, a gust front's leading edge) rides on top of the physics wind
    // here, for the aircraft and (through this.fx) the particles; src/physics/wind.js is not edited.
    this.env = { wind: (p, t, o) => { this.wind.at(p, t, o); if (this.weather) this.weather.addWind(p, t, o); return o; }, ground: (x, z, o) => this.world.ground(x, z, o), carrier: null };
    this.weather = null;       // src/systems/weather.js, per flight, only when the scenario has `weather`
    this.failRt = null;        // src/systems/failureEffects.js, per flight
    this.mission = null;       // src/systems/mission.js, per flight
    this.flightSeed = 0;
    this._g = makeGroundOut();
    this.approach = null;
    this.clock = new THREE.Clock();
    this.calloutState = {};
    this.applySettings();

    window.addEventListener('resize', () => this.onResize());
    const startAudio = () => { this.audio.resume(); };
    window.addEventListener('keydown', startAudio);
    window.addEventListener('pointerdown', startAudio);
    window.addEventListener('touchend', startAudio, { passive: true });   // iOS unlocks audio at the end of a touch
    // a touch on a device that did not look like one (a touchscreen laptop): switch the touch controls on
    window.addEventListener('touchstart', () => { if (!this.touchSeen) { this.touchSeen = true; if (!this.touchDevice) this.applySettings(); } }, { passive: true, once: true });
    // phone call, app switch, tab switch: pause rather than let the sim jump
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); else this.wake(); });
    this.portrait = typeof matchMedia === 'function' ? matchMedia('(orientation: portrait)') : null;
    if (this.portrait) {
      const onFlip = () => { document.body.classList.toggle('portrait', this.portrait.matches); if (this.portrait.matches && this.touchActive) this.pause(); };
      if (this.portrait.addEventListener) this.portrait.addEventListener('change', onFlip); else if (this.portrait.addListener) this.portrait.addListener(onFlip);
      document.body.classList.toggle('portrait', this.portrait.matches);
    }
    const rotate = document.createElement('div');
    rotate.id = 'rotate';
    rotate.innerHTML = '<div class="phone"></div><b>CLEARED TO LAND</b><span>turn your phone sideways</span>';
    app.appendChild(rotate);
    if ('speechSynthesis' in window) window.speechSynthesis.getVoices();

    const loading = document.getElementById('loading');
    if (loading) loading.remove();
    this.menus.showMain();
    this.buildMenuBackdrop();
    this.loop();
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.hud.setCompact(this.touchActive);
  }

  get touchActive() { const m = this.settings.touch || 'auto'; return m === 'on' || (m === 'auto' && (this.touchDevice || this.touchSeen)); }
  // On unless switched off in Settings (it used to default to phones only; a desktop browser that
  // lands on an integrated GPU needs it just as much, and on a fast GPU it never triggers).
  get autoQualityOn() { return this.settings.autoQuality == null ? true : !!this.settings.autoQuality; }
  canFullscreen() { return !!(document.fullscreenEnabled && document.documentElement.requestFullscreen) && !document.fullscreenElement; }
  fullscreen() {
    let p = null;
    try { p = document.documentElement.requestFullscreen(); } catch (e) { return; }
    if (p && p.then) p.then(() => { try { const o = screen.orientation; if (o && o.lock) o.lock('landscape').catch(() => {}); } catch (e) { /* not on this browser */ } }).catch(() => {});
  }
  async wake() {   // keep the screen on while flying by touch (a long final has no taps)
    if (!this.touchActive || this.state !== 'flying' || !navigator.wakeLock) return;
    try { this.wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* denied or unsupported */ }
  }
  unwake() { try { if (this.wakeLock) this.wakeLock.release(); } catch (e) { /* ignore */ } this.wakeLock = null; }

  applySettings() {
    const s = this.settings;
    saveJSON('ctl.settings', s);
    saveJSON('ctl.free', this.freeOpts);
    this.input.sens = s.sensitivity;
    this.input.mouseSens = s.mouseSens ?? 0.5;
    const touch = this.touchActive;
    document.body.classList.toggle('touch', touch);
    document.body.classList.toggle('stick-right', (s.stickSide || 'right') === 'right');   // which thumb flies; see touch.js
    this.touch.homeStick();   // the resting stick follows a side change straight away
    this.hud.keyStrip = s.keyStrip !== false && !touch;   // the touch buttons replace the key strip
    this.hud.touch = touch;
    this.hud.setCompact(touch);
    if (this.ac && (this.state === 'flying' || this.state === 'paused')) { if (touch) this.touch.show(this.ac.def); else this.touch.hide(); }
    this.applyTilt();
    this.audio.setVolume(s.volume);
    this.audio.voice = s.voice;
    this.hud.showHints = s.hints;
    const q = this.profile = qualityProfile(s.quality, touch);
    this.level = 0; this.ftWin.length = 0;
    this.applyLevel();
  }

  // Everything the tier and the autoQuality() rung decide, applied idempotently. A recompile of
  // the scene's materials (a 1-2 s freeze) happens only when the shadow state they were compiled
  // for has changed; pixel ratio, shadow map size, bloom and composer switches never need one.
  applyLevel() {
    const q = this.profile, lvl = this.level;
    this.renderScale = lvl <= 5 ? 1 - 0.1 * lvl : 0.5;
    const shadowMap = Math.max(512, q.shadowMap >> Math.max(0, Math.min(2, lvl - 5)));
    const bloomOn = lvl < 8;
    this.useComposer = q.composer && lvl < 9;
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    const shadowState = `${q.shadows}|${this.renderer.shadowMap.type}`;
    if (q.msaa !== this.rtSamples) {
      this.rtSamples = q.msaa;
      this.composer.reset(new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { type: THREE.HalfFloatType, samples: q.msaa }));
    }
    this.bloom.enabled = bloomOn;
    const pr = Math.min(window.devicePixelRatio || 1, q.maxDpr) * this.renderScale;
    if (Math.abs(this.renderer.getPixelRatio() - pr) > 1e-3 || this._composerPr !== pr) {
      this.renderer.setPixelRatio(pr);
      this.composer.setPixelRatio(pr);
      this._composerPr = pr;
    }
    if (this.world && this.world.sky) this.world.sky.setShadowSize(shadowMap);
    this.shadowMapSize = shadowMap;
    if (shadowState !== this._shadowState) {
      this._shadowState = shadowState;
      this.scene.traverse((o) => { if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) m.needsUpdate = true; } });
    }
  }

  // ---------- world ----------
  clearWorld() {
    if (this.world) {
      if (this.world.weatherLook) this.world.weatherLook.dispose();
      this.scene.clear();
    }
    if (this.failRt) { this.failRt.dispose(); this.failRt = null; }
    if (this.mission) { this.mission.dispose(); this.mission = null; }
    this.weather = null;
    this.world = null;
    this.env.carrier = null;
  }

  buildMenuBackdrop() {
    // a quiet scene behind the menu
    this.loadSite(SITES.bayfield, { time: 8.5, vis: 30000 });
    this.camera.position.set(-260, 60, 700);
    this.camera.lookAt(0, 20, -600);
    this.camera.fov = 50; this.camera.updateProjectionMatrix();
    // The sky patches the world's materials with the atmosphere on its first update(), which the menu's frame in
    // loop() also makes before it draws. Made here as well, so nothing that draws the backdrop straight after
    // toMenu() (a stepped harness) compiles it unpatched: the apron lamps' shader reads the sky's atDay and would
    // fail to compile without it, and every other material would compile twice.
    this.world.sky.update(this.camera.position, 0);
  }

  loadSite(site, sc) {
    this.clearWorld();
    const scene = this.scene;
    const night = sc.time < 6.5 || sc.time > 19.5;
    // put the sun behind the approach so the aircraft's shadow falls ahead of it on the ground
    const landHdg = site.runways ? site.runways[0].heading * DEG : site.carrier ? (site.carrier.heading - 9) * DEG : 0;
    const azimuth = landHdg + Math.PI + (sc.time < 12.5 ? -0.6 : 0.6);
    // The world's detail (src/art/quality.js) is the TIER's business: it is derived from the shadow map
    // the tier asked for, so the sky gets the tier's map here and the quality controller's current rung
    // (a halved map, see applyLevel) is applied afterwards. Otherwise a rung taken on the previous flight
    // would build the next world a detail level down and leave it there.
    const sky = new SkySystem(scene, this.renderer, { time: sc.time, visibility: sc.vis, azimuth, elevation: site.terrain.elevation || 0, cloudCover: sc.vis < 7000 ? 0 : (sc.clouds ?? 0.3), shadowSize: this.profile.shadowMap });
    if (this.shadowMapSize && this.shadowMapSize !== this.profile.shadowMap) sky.setShadowSize(this.shadowMapSize);
    // A mission course (towers, bridges, cables, gates: src/world/obstacles.js) is planned before the terrain is
    // built, so the forests and villages keep out of it.
    // Free flight's "Obstacles off" sends course: false (src/missions/free.js): no course, no trees on short final.
    const course = sc.course === false ? null : ObstacleField.plan(site, sc);
    const terrain = new Terrain({ ...site.terrain, flats: siteFlats(site), keepOut: course ? course.keepOut : null });
    terrain.build(scene, { sun: sky.sunDir, treeScale: this.profile.treeScale });
    let airport = null, carrier = null;
    if (site.runways) {
      airport = new Airport(site.runways, terrain);
      airport.build(scene, { night });
    }
    if (site.obstacleTrees && sc.course !== false) terrain.addObstacleTrees(site.obstacleTrees);
    if (site.carrier) {
      carrier = new Carrier({ ...site.carrier, seaState: sc.seaState ?? site.carrier.seaState, night, x: 0, z: 0 });
      carrier.build(scene);
    }
    const obstacles = course ? new ObstacleField(course, { terrain, site }) : null;
    if (obstacles) obstacles.build(scene, { night, quality: this.settings.quality });
    const weatherLook = sc.weather ? new WeatherLook(scene, { spec: resolveWeatherSpec(sc.weather), sky, quality: this.settings.quality, touch: this.touchActive }) : null;
    const effects = new Effects(scene, { seed: 1 });
    this.cockpitView.attachScene(scene);   // this world's lights reach the cockpit layer
    // what the particle effects need from the engine each frame (t and viewH are refreshed in fxEnv())
    this.fx = { windAt: (p, t, o) => this.env.wind(p, t, o), t: 0, camera: this.camera, viewH: 1080, sky };
    const w = {
      site, terrain, airport, carrier, sky, effects, night, obstacles, weatherLook,
      _camG: makeGroundOut(),
      ground: (x, z, out) => {
        if (carrier && carrier.ground(x, z, out)) return;
        if (airport && airport.ground(x, z, out)) return;
        terrain.ground(x, z, out);
      },
    };
    if (airport) {
      w.runway = airport.primary;
      w.towerPos = airport.towerPos || airport.point(w.runway, 500, 120, new THREE.Vector3()).add(new THREE.Vector3(0, 25, 0));
    }
    if (carrier) {
      w.towerPos = null; // set per frame from the island
      w.defaultCam = new THREE.Vector3();
    }
    if (terrain.water) terrain.water.setSun(sky.sunDir, sky.dayness, sky.fogColor);
    this.world = w;
    this.env.carrier = carrier;
    this.wind.groundY = site.runways ? site.runways[0].elevation : 0;
    return w;
  }

  // ---------- scenario flow ----------
  startScenario(scBase, seed = null) {
    this.scenarioBase = scBase;
    // One seed per flight. Everything that varies from approach to approach draws
    // from it: the gust strength and anything else resolveScenario picks, the
    // turbulence, the camera shake, which wing drops at the stall. Pinning it with
    // window.CTL_WIND_SEED replays an approach exactly, which is how the
    // screenshot harness compares two builds (tools/ctl-shots/looksheet.mjs).
    // (free flight hands in the seed it already dealt its "Surprise me" failure from: one seed per flight)
    const flightSeed = (Number.isFinite(seed) && seed > 0 ? seed : 0) || window.CTL_WIND_SEED || Math.floor(Math.random() * 1000) + 1;
    this.flightSeed = flightSeed;
    const flightRng = makeRng(flightSeed);
    const sc = resolveScenario(scBase, flightRng, this.settings);
    this.scenario = sc;
    const site = SITES[sc.site];
    this.loadSite(site, sc);
    const def = AIRCRAFT[sc.aircraft];
    const mass = def.massOptions[sc.weight] || def.mass;
    const ac = new Aircraft(def, { mass });
    this.ac = ac;
    if (this.model) { this.model = null; }
    this.model = buildModel(def, { detail: this.settings.quality });
    this.scene.add(this.model.group);
    // the interior for the cockpit view, hung on the model; its own head-turn limits
    const cockpit = this.cockpitView.build(def, this.model, { detail: this.settings.quality });
    this.rig.setHeadLimits(cockpit && cockpit.look ? cockpit.look.yaw : undefined, cockpit && cockpit.look ? cockpit.look.pitch : undefined);
    // wind
    const w = sc.wind;
    const rwHeading = this.world.runway ? this.world.runway.heading : this.world.carrier ? this.world.carrier.landingHeading() : 0;
    const dir = w.dir != null ? w.dir : ((rwHeading * RAD + (w.rel || 0)) + 720) % 360;
    this.wind.set({ dir, speed: w.speed || 0, gust: w.gust, turb: w.turb || 0, shear: w.shear || 0, seed: flightSeed });
    this.rig.setSeed(flightSeed);
    this.weather = sc.weather ? new Weather(sc.weather, { seed: flightSeed, wind: this.wind, world: this.world, scenario: sc, hud: this.hud, audio: this.audio, rig: this.rig }) : null;
    // Which wing drops at the stall leaks a very small rolling bias into normal
    // flight, so it belongs to the flight's seed as well.
    ac.stallSign = flightSeed % 2 ? 1 : -1;
    this.spawn(sc);
    this.hud.setFailures([]);
    this.failRt = new FailureRuntime(ac, sc, { seed: flightSeed, hud: this.hud, audio: this.audio, rig: this.rig, input: this.input, world: this.world, touch: this.touch, game: this, touchify: (t) => (this.touchActive ? touchify(t) : t) });
    this.mission = new MissionRuntime(sc, { world: this.world, weather: this.weather, failRt: this.failRt, hud: this.hud, audio: this.audio });
    if (this.world.obstacles) this.world.obstacles.reset(ac);
    this.approach = this.newApproachLog();
    this.calloutState = {};
    this.eventLog = [];
    this.t = 0;
    this.endTimer = 0;
    this.effects = this.world.effects;
    this.rig.setMode(this.settings.camera);
    this.rig.reset();
    this.input.reset();
    this.input.throttle = ac.input.throttle;
    this.input.trim = ac.input.trim;
    this.fcs = new FlightControl(ac, this.settings);
    this.hud.visible = true;
    this.hud.setHint('');
    if (this.touchActive) { this.touch.reset(); this.touch.show(def); } else this.touch.hide();
    this.touch.tilt.zero();   // however the phone is being held right now is neutral
    document.body.classList.add('flying');
    this.ftWin.length = 0; this.ftCool = 1;
    this.menus.hide();
    this.state = 'flying';
    this.wake();
    this.ap = null;
    this.audio.resume();
    this.audio.stopSpeech();
    this.hud.message(sc.title, '', 2.5);
    this.setupCallouts();
    this.startCompile();
  }

  // The first frame of a flight used to compile every shader of the new world synchronously:
  // 1.65 s frozen on the PC (64 programs), several seconds on a phone. compileAsync() starts them
  // all at once and polls (KHR_parallel_shader_compile keeps the main thread free); the loop
  // holds the simulation until they are ready, so the flight starts at t = 0 on a rendered
  // frame. The downloaded airframe arrives meanwhile; if it is in by then, its programs are
  // compiled in the same wait. Harnesses that drive frame() and render() directly are unaffected.
  startCompile() {
    if (!this.renderer.compileAsync) return;
    this.compiling = true;
    const gen = this.compileGen = (this.compileGen || 0) + 1;
    const t0 = performance.now();
    const done = () => { if (gen !== this.compileGen) return; this.compiling = false; this.clock.getDelta(); };
    // The atmosphere is installed into every fogged material by the sky's first update(), once.
    // The downloaded airframe arrives a few hundred milliseconds after the world is built, so
    // wait for it (briefly) before that first update: compiled and patched together, the
    // airframe is fogged like everything else, every time, rather than depending on timing.
    // (only the airframes that ship as a downloaded model have anything to wait for: the procedural
    // ones are complete at build time, and waiting for them was 2.5 s of black at every "Fly")
    const needsGltf = !!(this.ac && shipsGltf(this.ac.def.id));
    const ready = () => !needsGltf || (this.model && this.model.gltfRoot) || performance.now() - t0 > 2500;
    const wait = () => new Promise((res) => { const tick = () => { if (gen !== this.compileGen || ready()) res(); else setTimeout(tick, 25); }; tick(); });
    wait().then(() => {
      if (gen !== this.compileGen) return;
      if (this.world && this.world.sky && this.ac) this.world.sky.update(this.ac.pos, 0);
      // The program variant depends on where the frame is drawn (into the composer's HalfFloat
      // target: no tone mapping, linear output; straight to the canvas: the opposite), so
      // compile with the same target bound as the frames will use, or every material would be
      // compiled twice and the first frame would still block.
      const target = this.useComposer ? this.composer.writeBuffer : null;
      this.renderer.setRenderTarget(target);
      const p = this.renderer.compileAsync(this.scene, this.camera);   // the compile itself is synchronous inside
      this.renderer.setRenderTarget(null);
      return p;
    }).then(done, done);
  }

  // The free-flight builder hands its options back here: cleaned the same way a saved setup is, then saved.
  setFreeOpts(o) {
    this.freeOpts = validateFreeOpts(o, { defaults: DEFAULT_FREE, sites: SITES, aircraft: AIRCRAFT, failures: FAILURES, missions: SCENARIOS });
    saveJSON('ctl.free', this.freeOpts);
    return this.freeOpts;
  }

  startFree() {
    this.freeOpts = validateFreeOpts(this.freeOpts, { defaults: DEFAULT_FREE, sites: SITES, aircraft: AIRCRAFT, failures: FAILURES, missions: SCENARIOS });
    saveJSON('ctl.free', this.freeOpts);
    // The flight's seed, drawn once: it picks a "Surprise me" failure here and then everything else the flight draws,
    // so replaying game.flightSeed (window.CTL_WIND_SEED) repeats the surprise as well
    const seed = window.CTL_WIND_SEED || Math.floor(Math.random() * 1000) + 1;
    const sc = makeFreeFlight(this.freeOpts, seed);
    this.startScenario(sc, seed);
  }

  spawn(sc) {
    const ac = this.ac, def = ac.def, w = this.world, sp = sc.spawn;
    const dist = sp.dist || 5000;
    let pos, heading, gsAngle, groundYAtAim;
    if (w.carrier) {
      const c = w.carrier;
      heading = c.landingHeading();
      const d = c.landDirWorld;
      pos = c.tdWorld.clone().addScaledVector(d, -dist);
      gsAngle = 3.5 * DEG;
      groundYAtAim = c.tdWorld.y;
      pos.y = groundYAtAim + dist * Math.tan(gsAngle) + 3;
      ac.input.hookCmd = 1; ac.ctl.hook = 1;
    } else {
      const rw = w.runway;
      heading = rw.heading;
      // A mission may start anywhere in the runway frame (u along, v right; src/missions/README.md) and on its
      // own heading (hdg, degrees relative to the runway); without those it is the extended centreline as always.
      const u = sp.u != null ? sp.u : -dist, v = sp.v != null ? sp.v : (sp.offset || 0);
      pos = rw.threshold.clone().addScaledVector(rw.dir, u).addScaledVector(rw.right, v);
      if (sp.hdg) heading += sp.hdg * DEG;
      gsAngle = (rw.gsAngle || (def.approach.glideslope * RAD)) * DEG;
      groundYAtAim = rw.aim.y;
      pos.y = groundYAtAim + (rw.aimDistance - u) * Math.tan(gsAngle) + def.cgHeight;
      if (sp.alt != null) { w.ground(pos.x, pos.z, this._g); pos.y = Math.max(this._g.y, rw.elevation) + sp.alt; }
    }
    ac.pos.copy(pos);
    ac.input.gearCmd = sp.gear === false ? 0 : 1;
    ac.ctl.gear = ac.input.gearCmd;
    const flap = sp.flap ?? 0;
    const speed = (sp.speedKt || sc.scoring?.vref || def.speeds.Vref) * KT;
    const windVec = this.wind.at(pos, 0, new THREE.Vector3());
    const gamma = sp.gamma != null ? sp.gamma * DEG : sp.alt != null ? -1.5 * DEG : -gsAngle;
    ac.trim(heading, speed, gamma, flap, windVec);
    if (sp.stall) {
      // The Stall Recovery start (2026-09-15): a stall ENTRY, not a stall. Slow, power off, and the previous
      // pilot keeps the yoke back (FlightControl.holdStall): the nose rises, the horn sounds, the wing breaks and
      // stays broken until the pilot pushes or adds power. The old start dropped it in fully stalled and the
      // airplane flew itself out in under a second, while the challenge title was still on screen.
      ac.input.throttle = 0;
      ac.input.trim = 0;
      ac.stallHold = true;
    }
    if (w.carrier) ac.vel.add(w.carrier.vel.clone().multiplyScalar(0));
    for (const e of ac.engines) e.throttle = ac.input.throttle;
    if (def.spoilers && !w.carrier && def.id === 'condor') ac.input.spoilerArmed = false;
    ac._derive();
  }

  newApproachLog() {
    return { gsErr: 0, locErr: 0, spdErr: 0, gsSamples: 0, ballErr: 0, lineupErr: 0, aoaErr: 0, carrierSamples: 0, lowAtRamp: false, tdU: 0, tdV: 0, stopU: 0, offRunway: false, overran: false, noseDownSpeed: null, runway: null };
  }

  retry() { this.startScenario(this.scenarioBase); }

  // ---- debugging helpers (console) ----
  setAutopilot(on) { this.ap = on && this.ac ? (this.scenario.route ? new RoutePilot(this.ac, this.world, this.scenario) : new Autoland(this.ac, this.world, this.scenario)) : null; return !!this.ap; }
  debugView(x, y, z, lookAtOffset = null) {
    this.rig.setMode('debug');
    this.rig.debugOffset = new THREE.Vector3(x, y, z);
    this.rig.debugLook = lookAtOffset ? new THREE.Vector3(...lookAtOffset) : new THREE.Vector3(0, 0, 0);
    this.camera.fov = 45; this.camera.updateProjectionMatrix();
  }
  timeScale(s) { this.speedup = s; }

  // Tilt to fly: on only when the setting asks for it and the touch controls are up. enable() may need a user
  // gesture on iOS (the Settings toggle is one) and returns false when the device has no orientation sensor.
  applyTilt() {
    const want = !!this.settings.tilt && this.touchActive;
    const t = this.touch.tilt;
    if (want && !t.on) t.enable().then((ok) => { if (!ok) { this.settings.tilt = false; saveJSON('ctl.settings', this.settings); } this.touch.setTiltButton(t.on); });
    else if (!want && t.on) t.disable();
    this.touch.setTiltButton(t.on);
  }

  // ---------- logbook name ----------
  // A new best is stamped with this name. It lives in the browser's localStorage, so it is typed once; anyone else
  // landing on the same browser changes it on the debrief (or in Settings), and older entries keep the name they were flown under.
  setPilot(name) {
    this.pilot = pilotName.set(name);
    // Someone who flies first and names themselves afterwards should still appear on
    // the board for the flights they have already logged.
    if (this.pilot) { publish(this.best, this.pilot); forgetBoards(); }
    return this.pilot;
  }
  nameBest(id, name) {
    const b = this.best[id]; if (!b) return;
    if (name) b.name = name; else delete b.name;
    saveJSON('ctl.best', this.best);
  }
  toMenu() {
    this.state = 'menu';
    this.hud.visible = false;
    this.touch.hide();
    document.body.classList.remove('flying');
    this.unwake();
    this.audio.stopSpeech();
    this.input.releaseMouse();
    this.menus.showMain();
    this.cockpitView.clear();
    if (this.model) { this.scene.remove(this.model.group); this.model = null; }
    this.ac = null;
    this.buildMenuBackdrop();
  }
  pause() { if (this.state !== 'flying') return; this.state = 'paused'; this.touch.releaseAll(); this.unwake(); this.menus.showPause(); }
  resume() { if (this.state !== 'paused') return; this.state = 'flying'; this.menus.hide(); this.clock.getDelta(); this.wake(); }
  endFlight() { this.finish(true); }

  finish(forced = false) {
    if (this.state === 'debrief') return;
    this.state = 'debrief';
    const ac = this.ac, sc = this.scenario, ap = this.approach;
    // rollout position
    if (this.world.runway) {
      const rw = this.world.runway;
      const dx = ac.pos.x - rw.threshold.x, dz = ac.pos.z - rw.threshold.z;
      ap.stopU = dx * rw.dir.x + dz * rw.dir.z;
      const v = dx * rw.right.x + dz * rw.right.z;
      if (ac.stats.touchdown && !ac.crashed) {
        if (ap.stopU > rw.length + 2) ap.overran = true;
        else if (Math.abs(v) > rw.width / 2 + 1 || ap.stopU < -2) ap.offRunway = true;
      }
      ap.runway = rw;
      if (ac.stats.touchdown) {
        const td = ac.stats.touchdown.pos;
        const tdx = td.x - rw.threshold.x, tdz = td.z - rw.threshold.z;
        ap.tdU = tdx * rw.dir.x + tdz * rw.dir.z;
        ap.tdV = tdx * rw.right.x + tdz * rw.right.z;
      }
    }
    const result = this.mission ? this.mission.score(scoreLanding(ac, sc, ap), ac, ap) : scoreLanding(ac, sc, ap);
    let newBest = false;
    if (!forced || ac.stats.touchdown) {
      const b = this.best[sc.id];
      if (sc.id !== 'free' && (!b || result.points > b.points)) {
        this.best[sc.id] = { points: result.points, grade: result.grade, ...(this.pilot ? { name: this.pilot } : {}) };
        saveJSON('ctl.best', this.best);
        newBest = !!ac.stats.touchdown && result.points > 0;
        publish(this.best, this.pilot, sc.id);
        forgetBoards();
      }
    }
    // Next follows the menu's order (MISSION_GROUPS), not the order the missions happen to be listed in
    const order = missionOrder(SCENARIOS);
    const idx = order.findIndex((s) => s.id === sc.id);
    const next = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
    this.hud.visible = false;
    this.touch.hide();
    document.body.classList.remove('flying');
    this.unwake();
    this.audio.stopSpeech();
    this.menus.showDebrief(result, sc, { newBest, next, best: this.best[sc.id] });
  }

  // ---------- loop ----------
  loop() {
    requestAnimationFrame(() => this.loop());
    if (this.compiling) return;   // the new flight's shaders are compiling: hold the sim, keep the last frame
    this.frameNo++;
    const raw = this.clock.getDelta();
    let dt = Math.min(raw, 0.1);
    if (this.state === 'flying') { const n = this.speedup || 1; for (let i = 0; i < n && this.state === 'flying'; i++) this.frame(dt); this.autoQuality(raw); }
    else if (this.state === 'debrief' && this.ac) this.frameBackground(dt);
    else if (this.state === 'menu' && this.world) { this.world.sky.update(this.camera.position, dt); this.world.terrain.water?.tick(dt); this.world.airport?.update(dt, this.camera.position, this.wind, this.t); this.t += dt; }
    else if (this.state === 'paused') { /* frozen */ }
    if (this.state !== 'flying' && this.menus.visible) this.menus.pollPad();   // the gamepad works the menu (never in flight)
    this.touch.update();
    if (this.state === 'menu' && (this.frameNo & 1)) return;   // the backdrop behind the menu at half rate: nobody is flying it
    this.render();
  }

  // Auto quality (phones by default, Settings elsewhere): a dynamic controller rather than two
  // irreversible tier drops. Every ~1.5 s it looks at the median frame time; over the target it
  // climbs one rung of the ladder in applyLevel() (render scale down to 50%, then the shadow map,
  // the bloom, the composer), well under it - with margin, so it does not oscillate - it steps
  // back down. Nothing on the ladder recompiles a shader; a rung costs one frame of reallocation.
  autoQuality(raw) {
    if (!this.autoQualityOn || raw >= 0.1 || document.hidden || this.t < 2) return;
    this.ftWin.push(raw * 1000);
    if (this.ftWin.length < 30 && this.ftWin.reduce((a, b) => a + b, 0) < 1500) return;
    const sorted = this.ftWin.slice().sort((a, b) => a - b);
    const p50 = sorted[sorted.length >> 1];
    this.ftWin.length = 0;
    if (this.ftCool > 0) { this.ftCool--; return; }   // the window right after a change is settling (reallocations, compiles)
    let next = this.level;
    if (p50 > AUTO_TARGET_MS * 1.12 && this.level < AUTO_LEVELS) next++;
    else if (p50 < AUTO_TARGET_MS * 0.6 && this.level > 0) next--;
    if (next === this.level) return;
    this.level = next;
    this.applyLevel();
    this.ftCool = 1;
    if (this.t - this.ftMsgAt > 4) {
      this.ftMsgAt = this.t;
      const what = this.level === 0 ? 'full' : this.level <= 5 ? `${Math.round(this.renderScale * 100)}% resolution` : this.level <= 7 ? `${this.shadowMapSize} shadows` : this.level === 8 ? 'no bloom' : 'no post-processing';
      this.hud.message(`Graphics: ${what} (auto, ${Math.round(1000 / p50)} fps)`, '', 2.5);
    }
  }

  render() {
    if (!this.world) return;
    this.cockpitView.sync(this.rig.mode === 'cockpit' && this.state !== 'menu');   // the interior draws only in the cockpit view; its camera follows the world camera's pose and lens
    if (this.useComposer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
    this.cockpitView.renderDirect(this.renderer);   // on the canvas, after either path (see src/cockpit.js)
  }

  frameBackground(dt) {
    // keep the world alive behind the debrief
    const ac = this.ac, w = this.world;
    this.t += dt;
    if (w.carrier) w.carrier.update(dt);
    ac.step(dt, this.env);
    this.model.update(ac, dt);
    this.effects.update(dt, ac, this.model, this.fxEnv(dt));
    if (w.obstacles) w.obstacles.update(dt, this.t, ac.pos);
    if (this.weather) this.weather.update(dt, this.t, ac);
    if (w.weatherLook) w.weatherLook.update(dt, this.weather.state, this.weatherEnv(ac));
    w.sky.update(ac.pos, dt);
    if (w.terrain.water) w.terrain.water.tick(dt);
    this.rig.update(dt, ac, w);
    this.model.setCockpitView(this.rig.mode === 'cockpit' && !!this.cockpitView.cockpit);   // the exterior skin hides only when an interior draws in its place
    this.cockpitView.update(dt, ac, this.rig, w, {});
  }

  // What the weather look reads each frame besides Weather.state (one object, refilled).
  weatherEnv(ac) {
    const e = this._wxEnv || (this._wxEnv = {});
    e.camera = this.camera; e.t = this.t; e.sky = this.world.sky; e.renderer = this.renderer; e.ac = ac; e.cameraMode = this.rig.mode;
    return e;
  }

  // The per-frame context the particle effects read (src/art/effects.js): the wind, the time, the camera,
  // the scene light, and the pixels-per-metre-at-1-m of the current lens so sprite sizes are in metres.
  fxEnv(dt) {
    const f = this.fx;
    f.t = this.t;
    f.viewH = this.renderer.domElement.height / (2 * Math.tan(this.camera.fov * DEG / 2));
    return f;
  }

  frame(dt) {
    const ac = this.ac, w = this.world, inp = this.input, sc = this.scenario, def = ac.def;
    this.t += dt;
    inp.update(dt);
    // one-shot actions
    for (const a of inp.drain()) this.action(a);
    if (this.state !== 'flying') return;
    // inputs -> aircraft
    const s = this.settings.invert ? -1 : 1;
    ac.input.throttle = inp.throttle;
    ac.input.brake = inp.brake;
    ac.input.reverse = inp.reverse;
    if (!this.ap) {
      if (this.fcs.mode === 'direct' && this.settings.autoTrim && !ac.onGround && !ac.crashed && Math.abs(inp.pitch) < 0.03 && !ac.failures.has('elevatorJam')) {
        // direct mode auto-trim: with no pitch input, trim runs to hold the current pitch attitude
        inp.trim = clamp(inp.trim - ac.omega.x * 0.5 * dt - (ac.euler.pitch - (this.trimPitch ?? ac.euler.pitch)) * 0.15 * dt, -0.45, 0.45);
        if (this.trimPitch == null) this.trimPitch = ac.euler.pitch;
      } else this.trimPitch = null;
      this.fcs.update(dt, inp, ac, s);
    }
    inp.mdx = 0; inp.mdy = 0;
    if (this.ap) { this.ap.update(dt); inp.throttle = ac.input.throttle; inp.trim = ac.input.trim; }
    this.model.setCockpitView(this.rig.mode === 'cockpit' && !!this.cockpitView.cockpit);   // the exterior skin hides only when an interior draws in its place
    // carrier tower position follows the island
    if (w.carrier) {
      w.towerPos = w.carrier.group.localToWorld(this._tower.set(31, 20 + 26, 25));
    }
    // weather and failures act on the inputs and the air after the pilot (or the autopilot) and before the physics
    if (this.weather) this.weather.update(dt, this.t, ac);
    this.failRt.preStep(dt, ac, inp);
    // physics
    if (w.carrier) w.carrier.update(dt);
    ac.step(dt, this.env);
    // mission obstacles: swept probes against towers, bridges and cables (src/world/obstacles.js)
    if (w.obstacles && !ac.crashed) { const hit = w.obstacles.hit(ac); if (hit) ac.crash('Hit ' + hit); }
    // events
    for (const e of ac.events) { this.onEvent(e); this.eventLog.push({ t: +this.t.toFixed(2), type: e.type, info: e.reason || e.wire || e.leg || (e.td ? Math.round(e.td.vs / FPM) + ' fpm ' + e.td.legs.join('+') : ''), pitch: +(ac.euler.pitch * RAD).toFixed(1), roll: +(ac.euler.roll * RAD).toFixed(1), gs: +(ac.gsRel).toFixed(1) }); }
    ac.events.length = 0;
    // failures (src/systems/failureEffects.js: triggers, announcements, and the effects that need no physics edit)
    this.failRt.check(ac, { t: this.t, distToThreshold: this.distToThreshold() });
    this.failRt.postStep(dt, ac);
    this.mission.update(dt, this.t, ac);
    // approach logging
    this.logApproach(dt);
    // callouts
    this.callouts();
    // world & visuals
    w.airport?.update(dt, ac.pos, this.wind, this.t);
    if (w.carrier) { const mb = w.carrier.meatball(ac.pos, 3); w.carrier.updateLens(mb, this.t); this.meatball = mb; }
    w.sky.update(ac.pos, dt);
    if (w.terrain.water) { w.terrain.water.setSun(w.sky.sunDir, w.sky.dayness, w.sky.fogColor); w.terrain.water.tick(dt); }
    this.model.update(ac, dt);
    this.effects.update(dt, ac, this.model, this.fxEnv(dt));
    if (w.obstacles) w.obstacles.update(dt, this.t, ac.pos);
    if (w.weatherLook) w.weatherLook.update(dt, this.weather.state, this.weatherEnv(ac));
    this.rig.update(dt, ac, w);
    // HUD
    const hudCtx = this._hudCtx;   // one object, refilled: the HUD reads it and keeps nothing
    hudCtx.wind = this.wind; hudCtx.t = this.t; hudCtx.runwayHeading = w.runway ? w.runway.heading : w.carrier ? w.carrier.landingHeading() : null;
    hudCtx.status = this.statusLine(); hudCtx.gsRef = def.approach.glideslope; hudCtx.vref = vrefFor(ac, sc); hudCtx.keys = inp.keys; hudCtx.input = inp;
    hudCtx.fcs = this.fcs && this.fcs.mode === 'assist' && !this.ap ? { pitch: this.fcs.cmdPitch, bank: this.fcs.cmdBank } : null;
    hudCtx.ils = null; hudCtx.meatball = null;
    hudCtx.sensed = this.failRt.sensed; hudCtx.display = this.failRt.display; hudCtx.weather = this.weather ? this.weather.state : null;
    if (w.runway && w.runway.ils) { const d = w.airport.deviation(w.runway, ac.pos); if (d.dist > -50 && d.dist < 15000) hudCtx.ils = d; }
    if (w.carrier) { hudCtx.meatball = this.meatball; hudCtx.gsRef = 3.5 * DEG; }
    // the cockpit interior gets the same readings the HUD gets (only while the cockpit view is up;
    // the extras are only gathered then - wind.surface() and the object were being made every frame)
    if (this.rig.mode === 'cockpit') this.cockpitView.update(dt, ac, this.rig, w, { vref: hudCtx.vref, ils: hudCtx.ils, meatball: hudCtx.meatball, wind: this.wind.surface(this.t) });
    this.hud.update(ac, hudCtx, dt);
    this.hints();
    this.audio.update(ac, { cameraMode: this.rig.mode, weather: this.weather ? this.weather.state : null }, dt);
    // end conditions
    if (ac.crashed) { this.endTimer += dt; if (this.endTimer > 3.5) this.finish(); }
    else if (ac.stopped) { this.endTimer += dt; if (this.endTimer > 2.0) this.finish(); }
    else if (ac.trap.trapped && ac.gsRel < 1) { this.endTimer += dt; if (this.endTimer > 2.5) this.finish(); }
    else if (this.t > 5 && this.distToThreshold() > 22000) { this.hud.message('Leaving the area: turn back to the field', 'warn', 3); }
  }

  action(a) {
    const ac = this.ac, inp = this.input, def = ac.def;
    if (this.failRt && this.failRt.action(a)) return;   // failure-specific actions (fire handle, trim cutout, ...)
    switch (a) {
      case 'flapsDown': case 'flapsUp': {
        const d = def.flaps.detents;
        let i = d.findIndex((x) => Math.abs(x - ac.input.flapCmd) < 0.01);
        if (i < 0) i = 0;
        i = clamp(i + (a === 'flapsDown' ? 1 : -1), 0, d.length - 1);
        ac.input.flapCmd = d[i];
        this.audio.beep(660, 0.06);
        break;
      }
      case 'gear': if (def.gearRetract) { ac.input.gearCmd = ac.input.gearCmd ? 0 : 1; this.audio.beep(440, 0.1); this.hud.message(ac.input.gearCmd ? 'GEAR DOWN' : 'GEAR UP', '', 1.2); } break;
      case 'hook': if (def.hook) { ac.input.hookCmd = ac.input.hookCmd ? 0 : 1; this.audio.beep(440, 0.1); this.hud.message(ac.input.hookCmd ? 'HOOK DOWN' : 'HOOK UP', '', 1.2); } break;
      case 'spoiler': if (def.spoilers) {
        if (ac.wheelsOnGround) { ac.input.spoiler = ac.input.spoiler ? 0 : 1; ac.input.spoilerArmed = false; }
        else if (ac.input.spoilerArmed) { ac.input.spoilerArmed = false; ac.input.spoiler = 1; this.hud.message('SPEEDBRAKE', '', 1.2); }
        else if (ac.input.spoiler) { ac.input.spoiler = 0; this.hud.message('SPEEDBRAKE IN', '', 1.2); }
        else { ac.input.spoilerArmed = true; this.hud.message('SPOILERS ARMED', '', 1.2); }
        this.audio.beep(600, 0.06);
      } break;
      case 'autobrake': if (def.autobrake) { ac.input.autobrake = ac.input.autobrake === 0 ? 0.35 : ac.input.autobrake < 0.6 ? 0.7 : 0; this.hud.message(`AUTOBRAKE ${ac.input.autobrake === 0 ? 'OFF' : ac.input.autobrake < 0.6 ? 'MED' : 'MAX'}`, '', 1.2); } break;
      case 'cam1': this.rig.setMode('chase'); break;
      case 'cam2': this.rig.setMode('cockpit'); break;
      case 'cam3': this.rig.setMode('tower'); break;
      case 'cam4': this.rig.setMode('flyby'); break;
      case 'cam5': this.rig.setMode('wing'); break;
      case 'camNext': this.rig.next(); this.hud.message(CAMERA_NAMES[this.rig.mode] + ' view', '', 1); break;
      case 'pause': this.pause(); break;
      case 'menu': if (this.input.mouseYoke) this.input.releaseMouse(); else this.pause(); break;
      case 'hudToggle': this.hud.visible = !this.hud.visible; break;
      case 'hintToggle': this.settings.hints = !this.settings.hints; this.hud.showHints = this.settings.hints; this.hud.message('Hints ' + (this.settings.hints ? 'on' : 'off'), '', 1); break;
    }
  }

  onEvent(e) {
    const ac = this.ac, hud = this.hud, au = this.audio;
    switch (e.type) {
      case 'touchdown': {
        const td = e.td;
        au.thud(clamp(td.vs / 2, 0.3, 2));
        this.rig.bump(clamp(td.vs / 3, 0.1, 1.2));
        if (this.world.carrier) break;
        const v = td.vs / FPM;
        const msg = v < 60 ? 'GREASED' : v < 180 ? 'Smooth' : v < 400 ? 'Firm' : v < 700 ? 'Hard' : 'VERY HARD';
        hud.message(`${msg}  ${Math.round(v)} fpm`, v > 400 ? 'warn' : '', 2.5);
        break;
      }
      case 'bounce': au.thud(0.8); this.rig.bump(0.5); hud.message('Bounce', 'warn', 1.2); break;
      case 'stall': if (!ac.onGround) { hud.message('STALL', 'bad', 1.5); if (!this.calloutState.stallSaid || this.t - this.calloutState.stallSaid > 6) { au.say('Stall. Stall.', true); this.calloutState.stallSaid = this.t; } } break;
      case 'crash': au.crash(); this.rig.bump(1.5); hud.message(e.reason, 'bad', 5); au.say('Crash.', true); break;
      case 'gearCollapse': au.crash(); hud.message(`${e.leg.toUpperCase()} GEAR COLLAPSED`, 'bad', 3); break;
      case 'tailstrike': au.thud(1.5); hud.message('TAIL STRIKE', 'bad', 3); break;
      case 'nosestrike': au.thud(1.5); hud.message(ac.def.engines[0].type === 'prop' ? 'PROP STRIKE' : this.scenario.scoring.noseGear ? 'NOSE DOWN' : 'NOSE STRIKE', this.scenario.scoring.noseGear ? 'warn' : 'bad', 3); if (this.approach.noseDownSpeed == null) this.approach.noseDownSpeed = ac.gs; break;
      case 'belly': au.thud(1.2); this.rig.bump(0.6); hud.message('BELLY CONTACT', 'warn', 2); if (this.approach.noseDownSpeed == null) this.approach.noseDownSpeed = ac.gs; break;
      case 'wingtip': au.thud(1); hud.message('WINGTIP STRIKE', 'bad', 2); break;
      case 'scrape': au.thud(0.8); hud.message('ENGINE POD SCRAPED', 'warn', 2); break;
      case 'wire': au.clank(); this.rig.bump(1.0); hud.message(`${e.wire}-WIRE`, '', 2.5); break;
      case 'trapped': hud.message(`TRAPPED: ${e.wire}-WIRE`, '', 4); au.say(e.wire === 3 ? 'OK three wire.' : e.wire === 2 ? 'Fair, two wire.' : e.wire === 4 ? 'Little long, four wire.' : 'One wire. Dangerously low.'); break;
      case 'bolter': hud.message('BOLTER  BOLTER', 'warn', 3); au.say('Bolter, bolter, bolter.', true); break;
      case 'spoilers': hud.message('SPOILERS UP', '', 1.2); break;
      case 'liftoff': if (ac.stats.touchdown && !this.calloutState.liftoff) { /* go-around counted below */ } break;
      case 'stopped': hud.message('Stopped', '', 2); break;
    }
  }

  distToThreshold() {
    const w = this.world, ac = this.ac;
    if (w.runway) { const rw = w.runway; const dx = ac.pos.x - rw.threshold.x, dz = ac.pos.z - rw.threshold.z; return -(dx * rw.dir.x + dz * rw.dir.z); }
    if (w.carrier) { const dl = w.carrier.deckLocal(ac.pos, { u: 0, v: 0, h: 0, onDeck: false }); return -dl.u; }
    return 1e9;
  }

  statusLine() {
    const d = this.distToThreshold();
    const nm = d / NM;
    const cam = CAMERA_NAMES[this.rig.mode];
    const ms = this.mission ? this.mission.status() : '';
    if (ms) return `${this.scenario.title} · ${ms} · ${cam}`;
    if (d > 0) return `${this.scenario.title} · ${nm.toFixed(1)} NM to the ${this.world.carrier ? 'ramp' : 'threshold'} · ${cam}`;
    return `${this.scenario.title} · ${cam}`;
  }

  logApproach(dt) {
    const ac = this.ac, w = this.world, ap = this.approach;
    if (ac.onGround || ac.crashed) return;
    if (w.runway && w.runway.ils) {
      const d = w.airport.deviation(w.runway, ac.pos);
      if (d.dist > 300 && d.dist < 3500) {
        ap.gsErr += Math.abs(d.gsDots); ap.locErr += Math.abs(d.locDots); ap.gsSamples++;
        const vref = vrefFor(ac, this.scenario) * KT;
        ap.spdErr += Math.abs(ac.ias - vref);
      }
    } else if (w.runway) {
      const rw = w.runway;
      const dx = ac.pos.x - rw.threshold.x, dz = ac.pos.z - rw.threshold.z;
      const u = dx * rw.dir.x + dz * rw.dir.z, v = dx * rw.right.x + dz * rw.right.z;
      if (u < -100 && u > -2500) {
        const gsRef = rw.gsAngle || ac.def.approach.glideslope * RAD;
        const ang = Math.atan2(ac.pos.y - rw.aim.y, rw.aimDistance - u) * RAD;
        ap.gsErr += Math.abs(ang - gsRef) / 0.5; ap.locErr += Math.abs(Math.atan2(v, rw.aimDistance - u) * RAD) / 0.8; ap.gsSamples++;
        const vref = vrefFor(ac, this.scenario) * KT;
        ap.spdErr += Math.abs(ac.ias - vref);
      }
    }
    if (w.carrier && this.meatball && this.meatball.inRange && this.meatball.range < 1300 && this.meatball.range > 30) {
      const mb = this.meatball;
      ap.ballErr += Math.abs(mb.cells); ap.lineupErr += Math.abs(mb.dl.v); ap.aoaErr += Math.abs(ac.aero.alpha - ac.def.approach.onSpeedAoA) * RAD; ap.carrierSamples++;
      if (mb.dl.u > -15 && mb.dl.u < 0 && mb.dl.h < 5.5) ap.lowAtRamp = true;
    }
  }

  setupCallouts() {
    this.calloutState = { alts: new Set(), minimums: false, retard: false, rogerBall: false, gsSaid: 0 };
  }
  callouts() {
    const ac = this.ac, cs = this.calloutState, au = this.audio, hud = this.hud, def = ac.def;
    if (ac.onGround || ac.crashed) return;
    const ra = ac.radioAlt / FT;
    const jet = def.id === 'condor';
    if (jet) {
      for (const a of JET_CALLOUTS) {
        if (ra <= a && !cs.alts.has(a) && ac.vs < 0) { cs.alts.add(a); const txt = a >= 100 ? `${a}` : `${a}`; hud.callout(txt); au.say(a === 2500 ? 'Twenty five hundred' : a === 1000 ? 'One thousand' : a === 500 ? 'Five hundred' : String(a)); }
      }
      if (ra <= 20 && !cs.retard && ac.input.throttle > 0.15) { cs.retard = true; hud.callout('RETARD'); au.say('Retard, retard.'); }
      if (ra < 2000 && ac.vs < -1500 * FPM && !cs.sink) { cs.sink = true; hud.callout('SINK RATE'); au.say('Sink rate.', true); }
      if (ac.vs > -1000 * FPM) cs.sink = false;
      if (ra < 200 && !cs.minimums && ac.vs < 0) { cs.minimums = true; au.say('Minimums.'); }
    } else if (def.id === 'hornet' && this.meatball) {
      const mb = this.meatball;
      if (mb.inRange && mb.range < 1400 && !cs.rogerBall) { cs.rogerBall = true; au.say('Roger ball. Wind 25 knots axial.'); hud.callout('Roger ball'); }
      if (mb.inRange && this.t - cs.gsSaid > 4) {
        if (mb.cells < -1.6 && mb.range > 200) { cs.gsSaid = this.t; au.say('Power.'); hud.callout('POWER'); }
        else if (mb.cells > 1.8 && mb.range > 200) { cs.gsSaid = this.t; au.say("You're high."); hud.callout("YOU'RE HIGH"); }
        else if (Math.abs(mb.dl.v) > 12 && mb.range > 250) { cs.gsSaid = this.t; const r = mb.dl.v > 0 ? 'left' : 'right'; au.say(`Come ${r} for lineup.`); hud.callout(`${r.toUpperCase()} FOR LINEUP`); }
        if (mb.waveoff && !cs.waveoff) { cs.waveoff = true; au.say('Wave off, wave off!', true); hud.message('WAVE OFF', 'bad', 3); }
        if (!mb.waveoff) cs.waveoff = false;
      }
    } else {
      for (const a of LIGHT_CALLOUTS) {
        if (ra <= a && !cs.alts.has(a) && ac.vs < 0) { cs.alts.add(a); hud.callout(String(a)); if (a <= 50) au.say(String(a)); }
      }
    }
  }

  hints() {
    if (!this.settings.hints) { this.hud.setHint(''); return; }
    const ac = this.ac, sc = this.scenario, def = ac.def, w = this.world;
    const d = this.distToThreshold();
    const ra = ac.radioAlt / FT;
    let h = '';
    const mh = !ac.crashed && this.mission ? this.mission.hint({ ac, ra, d, t: this.t }) : null;
    if (mh) h = mh;
    else if (ac.crashed) h = '';
    else if (ac.trap.trapped) h = 'Trapped. Throttle to idle.';
    else if (ac.onGround) {
      if (def.id === 'trailblazer') h = 'Keep it straight with rudder (Q/E). Brake gently (Space) or it will nose over.';
      else if (def.id === 'condor') h = 'Hold R for reverse thrust, brakes with Space (or autobrake). Keep the centerline with rudder.';
      else if (def.id === 'hornet' && !ac.trap.engaged) h = ac.trap.boltered ? 'BOLTER: full throttle, fly off the deck, and come around for another pass.' : 'Full throttle until the wire stops you.';
      else h = 'Brakes: hold Space. Keep the centerline with rudder (Q/E).';
    } else if (sc.id === 'stallrec' && (ac.stallHold || (ac.stats.stalls <= 2 && this.t < 40 && (ac.aero.stall > 0.1 || ac.ias < def.speeds.Vs1 * KT * 1.1)))) h = 'STALL: push the nose down (up arrow), full throttle (W), level the wings gently.';
    else if (ac.aero.warning && ac.radioAlt > ac.flareZone()) h = 'Stall warning: lower the nose a little and add power.';   // in the flare the horn is the landing, not a mistake
    else if (def.id === 'hornet') {
      if (ac.ctl.hook < 0.9) h = 'Hook down: press H. Gear: G. Flaps full: F twice.';
      else if (ac.ctl.gear < 0.9) h = 'Gear down: press G.';
      else if (ac.ctl.flap < 0.9) h = 'Full flaps: press F.';
      else if (this.meatball && this.meatball.inRange) h = 'Fly the ball: amber ball level with the green lights. Hold 8° AoA (green mark) with pitch, glideslope with throttle. No flare.';
      else h = 'Set 8° AoA (about 135 kt), line up with the angled deck. The ball appears at 1.2 NM.';
    } else if (def.gearRetract && ac.ctl.gear < 0.9 && d < 6000) h = 'Gear down: press G.';
    else if (def.id === 'condor') {
      if (ac.ctl.flap < 0.7 && d < 6000 && !ac.failures.has('flapsStuck')) h = 'Flaps 30: press F until FLAPS 30. Vref 142.';
      else if (!ac.input.spoilerArmed && ac.ctl.spoiler < 0.5 && d < 5000 && !ac.failures.has('hydraulics')) h = 'Arm the spoilers (K) and set autobrake (L).';
      else if (ra > 100) h = 'Vref on the airspeed bug. Keep the glideslope needle centered; the flight-path circle on the aiming bars.';
      else if (ra > 30) h = 'Flare at 30 ft: raise the nose 2-3°, thrust to idle at "retard".';
      else h = 'Hold the attitude, idle thrust, let it settle.';
    } else if (def.id === 'trailblazer') {
      if (ac.ctl.flap < 0.9 && d < 2500) h = 'Full flaps: press F. Approach at 48 kt, steep.';
      else if (ra > 60) h = 'Aim at the first markers, 48 kt. Clear the trees, then throttle back.';
      else if (ra > 8) h = 'Power off, ease the nose up into the three-point attitude.';
      else h = 'Hold it off, tail low. Rudder to keep straight.';
    } else {
      if (ac.ctl.flap < 0.6 && d < 3500 && !ac.failures.has('flapsStuck') && !ac.failures.has('engine')) h = 'Add flaps: press F (20-30°). Slow to 62 kt.';
      else if (ac.failures.has('engine')) h = ra > 200 ? 'Engine out: 68 kt best glide. Trim (T/Y). Aim for the first third of the runway. Flaps only when you have it made.' : 'Flare gently; you have no power to recover from a balloon.';
      else if (ra > 100) h = 'Green circle on the numbers, 62 kt, PAPI two white two red. Pitch for speed, throttle for the descent.';
      else if (ra > 15) h = 'Short final: 62 kt, wings level, nose on the centerline.';
      else if (ra > 3) h = 'Flare: throttle idle, raise the nose slowly and hold it off.';
      else h = 'Hold it, keep pulling gently as it slows.';
    }
    if (w.carrier && this.meatball && this.meatball.waveoff && !ac.onGround) h = 'WAVE OFF: full power, climb straight ahead, hook stays down, come around again.';
    this.hud.setHint(h);
  }
}

function loadJSON(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function loadStr(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }

window.G = { SCENARIOS, SITES, AIRCRAFT, MISSION_GROUPS };
function boot() {
  if (window.game) return;
  try {
    window.game = new Game();
  } catch (e) {
    console.error(e);
    const app = document.getElementById('app');
    app.innerHTML = '<div id="loading"><b>CLEARED TO LAND</b><span style="letter-spacing:0.05em;max-width:34em;text-align:center;line-height:1.6">This game needs WebGL 2 with hardware acceleration.<br>Use a recent Chrome, Edge, Firefox or Safari, and make sure graphics acceleration is enabled in the browser settings.</span></div>';
  }
}
window.addEventListener('DOMContentLoaded', boot);
if (document.readyState !== 'loading') boot();
