// Synthesized audio (no sample files): engines, wind, stall horn, gear horn, tires, impacts, callouts.
import { KT, clamp, lerp } from './config.js';
import { WeatherAudio } from './audio-weather.js';   // rain, storm wind, thunder (src/systems/weather.js state)
import { Alarms } from './audio-alarms.js';   // failure alarms: chime, fire bell, trim clacker, flutter buzz (2026-09-17)

function noiseBuffer(ctx, seconds = 2) {
  const n = ctx.sampleRate * seconds;
  const b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = w * 0.5 + last * 3; }
  return b;
}

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.8;
    this.voice = true;
    this.ready = false;
    this.lastCall = {};
    this.speechQ = [];
    this.speaking = false;
    this.alarms = new Alarms(this);
  }
  resume() {
    if (this.ready) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.enabled = false; return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.volume; this.master.connect(c.destination);
    this.noise = noiseBuffer(c);

    // ---- piston engine: fundamental + harmonics, a sub, and blade-pass amplitude modulation ----
    this.engGain = c.createGain(); this.engGain.gain.value = 0; this.engGain.connect(this.master);
    this.engLP = c.createBiquadFilter(); this.engLP.type = 'lowpass'; this.engLP.frequency.value = 600; this.engLP.Q.value = 0.8;
    this.engLP.connect(this.engGain);
    this.engOsc = [];
    const spec = [[1, 'triangle', 1.0], [2, 'sine', 0.45], [3, 'sine', 0.22], [0.5, 'sawtooth', 0.18], [4, 'sine', 0.1]];
    for (const [mult, type, gain] of spec) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = 60 * mult;
      const g = c.createGain(); g.gain.value = gain;
      o.connect(g); g.connect(this.engLP); o.start();
      this.engOsc.push({ o, mult });
    }
    // blade-pass AM: an LFO at the propeller blade frequency modulating the engine gain
    this.am = c.createOscillator(); this.am.type = 'sine'; this.am.frequency.value = 80;
    this.amGain = c.createGain(); this.amGain.gain.value = 0;
    this.am.connect(this.amGain); this.amGain.connect(this.engGain.gain); this.am.start();

    // ---- jet: broadband rumble (low-passed noise) + turbine whine ----
    this.jetGain = c.createGain(); this.jetGain.gain.value = 0; this.jetGain.connect(this.master);
    this.jetNoise = c.createBufferSource(); this.jetNoise.buffer = this.noise; this.jetNoise.loop = true; this.jetNoise.playbackRate.value = 0.6;
    this.jetLP = c.createBiquadFilter(); this.jetLP.type = 'lowpass'; this.jetLP.frequency.value = 400; this.jetLP.Q.value = 0.6;
    this.jetNoise.connect(this.jetLP); this.jetLP.connect(this.jetGain); this.jetNoise.start();
    this.whine = c.createOscillator(); this.whine.type = 'sine'; this.whine.frequency.value = 1500;
    this.whine2 = c.createOscillator(); this.whine2.type = 'sine'; this.whine2.frequency.value = 2250;
    this.whineG = c.createGain(); this.whineG.gain.value = 0; this.whine.connect(this.whineG); this.whine2.connect(this.whineG); this.whineG.connect(this.master); this.whine.start(); this.whine2.start();

    // ---- wind: quiet, low, only really audible when fast or with the gear/flaps out ----
    this.windGain = c.createGain(); this.windGain.gain.value = 0; this.windGain.connect(this.master);
    this.windSrc = c.createBufferSource(); this.windSrc.buffer = this.noise; this.windSrc.loop = true; this.windSrc.playbackRate.value = 0.45;
    this.windLP = c.createBiquadFilter(); this.windLP.type = 'lowpass'; this.windLP.frequency.value = 300; this.windLP.Q.value = 0.5;
    this.windSrc.connect(this.windLP); this.windLP.connect(this.windGain); this.windSrc.start();

    // ---- stall horn / stick shaker ----
    this.hornGain = c.createGain(); this.hornGain.gain.value = 0; this.hornGain.connect(this.master);
    this.horn = c.createOscillator(); this.horn.type = 'square'; this.horn.frequency.value = 780;
    const hornLP = c.createBiquadFilter(); hornLP.type = 'lowpass'; hornLP.frequency.value = 1800;
    this.horn.connect(hornLP); hornLP.connect(this.hornGain); this.horn.start();
    this.shakerGain = c.createGain(); this.shakerGain.gain.value = 0; this.shakerGain.connect(this.master);
    this.shaker = c.createOscillator(); this.shaker.type = 'sawtooth'; this.shaker.frequency.value = 22;
    const shLP = c.createBiquadFilter(); shLP.type = 'lowpass'; shLP.frequency.value = 180;
    this.shaker.connect(shLP); shLP.connect(this.shakerGain); this.shaker.start();

    // ---- gear horn ----
    this.gearGain = c.createGain(); this.gearGain.gain.value = 0; this.gearGain.connect(this.master);
    this.gearOsc = c.createOscillator(); this.gearOsc.type = 'square'; this.gearOsc.frequency.value = 260; this.gearOsc.connect(this.gearGain); this.gearOsc.start();

    // ---- tires: screech (lateral skid only) and rolling rumble ----
    this.screechGain = c.createGain(); this.screechGain.gain.value = 0; this.screechGain.connect(this.master);
    this.screech = c.createBufferSource(); this.screech.buffer = this.noise; this.screech.loop = true; this.screech.playbackRate.value = 1.6;
    this.screechBP = c.createBiquadFilter(); this.screechBP.type = 'bandpass'; this.screechBP.frequency.value = 2400; this.screechBP.Q.value = 8;
    this.screech.connect(this.screechBP); this.screechBP.connect(this.screechGain); this.screech.start();
    this.rollGain = c.createGain(); this.rollGain.gain.value = 0; this.rollGain.connect(this.master);
    this.rollSrc = c.createBufferSource(); this.rollSrc.buffer = this.noise; this.rollSrc.loop = true; this.rollSrc.playbackRate.value = 0.25;
    this.rollLP = c.createBiquadFilter(); this.rollLP.type = 'lowpass'; this.rollLP.frequency.value = 100;
    this.rollSrc.connect(this.rollLP); this.rollLP.connect(this.rollGain); this.rollSrc.start();
    this.wx = new WeatherAudio(this);
    this.ready = true;
    this.t = 0;
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  update(ac, ctx, dt) {
    if (!this.ready || !this.enabled) return;
    this.t += dt;
    const c = this.ctx;
    const now = c.currentTime;
    const cockpit = ctx.cameraMode === 'cockpit';
    const ext = cockpit ? 0.6 : 1.0;
    const e = ac.engines[0];
    const rpm = ac.engines.reduce((a, x) => a + x.rpm, 0) / ac.engines.length;
    const thrustFrac = ac.engines.reduce((a, x) => a + Math.abs(x.thrust) / (x.maxThrust || x.staticThrust || 1), 0) / ac.engines.length;
    if (e.type === 'prop') {
      const engineRpm = rpm * 2700;                 // displayed RPM
      const f = engineRpm / 60 / 2;                 // 4-stroke firing fundamental ~ rpm/120 per cylinder pair
      const fund = Math.max(12, f * 2.0);
      for (const { o, mult } of this.engOsc) o.frequency.setTargetAtTime(fund * mult, now, 0.06);
      this.am.frequency.setTargetAtTime((engineRpm / 60) * 2, now, 0.06);   // two-blade prop
      this.engLP.frequency.setTargetAtTime(250 + rpm * 900, now, 0.1);
      const base = (0.04 + rpm * 0.3) * (cockpit ? 0.6 : 0.45) * (e.failed ? 0.1 : 1);
      this.engGain.gain.setTargetAtTime(base, now, 0.05);
      this.amGain.gain.setTargetAtTime(base * 0.35, now, 0.05);
      this.jetGain.gain.setTargetAtTime(0, now, 0.1); this.whineG.gain.setTargetAtTime(0, now, 0.1);
    } else {
      this.engGain.gain.setTargetAtTime(0, now, 0.1); this.amGain.gain.setTargetAtTime(0, now, 0.1);
      const n1 = rpm;
      this.jetLP.frequency.setTargetAtTime(180 + n1 * 1400 + thrustFrac * 600, now, 0.15);
      this.jetGain.gain.setTargetAtTime((0.02 + Math.pow(n1, 1.7) * 0.32) * ext * (ac.input.reverse > 0 && ac.wheelsOnGround ? 1.6 : 1), now, 0.15);
      this.whine.frequency.setTargetAtTime(500 + n1 * 2400, now, 0.15);
      this.whine2.frequency.setTargetAtTime((500 + n1 * 2400) * 1.5, now, 0.15);
      this.whineG.gain.setTargetAtTime(0.006 * n1 * ext * (cockpit ? 0.5 : 1), now, 0.15);
    }
    // wind: near-silent at approach speeds; grows with speed and with the gear/flaps out
    const ias = ac.ias / KT;
    const w = Math.pow(clamp((ias - 40) / 220, 0, 1), 1.7) * 0.22 * (cockpit ? 0.6 : 1) + (ac.ctl.gear > 0.5 && ias > 90 ? 0.03 : 0) + ac.ctl.spoiler * 0.05;
    this.windGain.gain.setTargetAtTime(w, now, 0.25);
    this.windLP.frequency.setTargetAtTime(180 + ias * 3, now, 0.25);
    // stall warning
    const warn = ac.aero.warning && !ac.onGround && !ac.crashed;
    if (ac.def.id === 'condor') {
      this.shakerGain.gain.setTargetAtTime(warn ? 0.3 : 0, now, 0.05);
      this.hornGain.gain.setTargetAtTime(0, now, 0.05);
    } else {
      const warble = 0.5 + 0.5 * Math.sin(this.t * 55);
      this.horn.frequency.setTargetAtTime(ac.def.id === 'hornet' ? 900 : 700 + 120 * Math.sin(this.t * 9), now, 0.02);
      this.hornGain.gain.setTargetAtTime(warn ? 0.08 * (0.6 + 0.4 * warble) * (cockpit ? 1.2 : 0.7) : 0, now, 0.03);
      this.shakerGain.gain.setTargetAtTime(0, now, 0.05);
    }
    const gearWarn = ac.def.gearRetract && ac.ctl.gear < 0.5 && ac.radioAlt < 250 && !ac.onGround && (ac.input.throttle < 0.35 || ac.ctl.flap > 0.6);
    this.gearGain.gain.setTargetAtTime(gearWarn && Math.floor(this.t * 3) % 2 === 0 ? 0.06 : 0, now, 0.02);
    // tires
    let skid = 0, roll = 0;
    for (const l of ac.legs) { if (l.contact) { skid = Math.max(skid, l.skid); roll = Math.max(roll, clamp(ac.gsRel / 40, 0, 1)); } }
    for (const p of ac.points) if (p.contact && ac.gsRel > 3) skid = Math.max(skid, 0.6);
    this.screechGain.gain.setTargetAtTime(skid * 0.2, now, 0.05);
    const roughK = ac.legs.some((l) => l.contact && l.kind !== 'runway' && l.kind !== 'deck') ? 2.0 : 1;
    this.rollGain.gain.setTargetAtTime(roll * 0.18 * roughK * (cockpit ? 1.3 : 0.8), now, 0.1);
    this.rollLP.frequency.setTargetAtTime(70 + roll * 160 * roughK, now, 0.1);
    if (this.wx) this.wx.update(ac, ctx, dt, now);
    this.processSpeech();
  }

  thud(strength = 1) {
    if (!this.ready) return;
    const c = this.ctx, now = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise; src.playbackRate.value = 0.5;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    const g = c.createGain(); g.gain.setValueAtTime(clamp(strength, 0.1, 2) * 0.8, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    src.connect(lp); lp.connect(g); g.connect(this.master); src.start(now); src.stop(now + 0.4);
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(70, now); o.frequency.exponentialRampToValueAtTime(30, now + 0.3);
    const og = c.createGain(); og.gain.setValueAtTime(clamp(strength, 0.1, 2) * 0.6, now); og.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    o.connect(og); og.connect(this.master); o.start(now); o.stop(now + 0.4);
  }
  clank() {
    if (!this.ready) return;
    const c = this.ctx, now = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise; src.playbackRate.value = 2.5;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 8;
    const g = c.createGain(); g.gain.setValueAtTime(0.7, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    src.connect(bp); bp.connect(g); g.connect(this.master); src.start(now); src.stop(now + 0.3);
    this.thud(0.8);
  }
  crash() {
    if (!this.ready) return;
    const c = this.ctx, now = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise; src.playbackRate.value = 0.35;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, now); lp.frequency.exponentialRampToValueAtTime(60, now + 2.5);
    const g = c.createGain(); g.gain.setValueAtTime(1.3, now); g.gain.exponentialRampToValueAtTime(0.001, now + 2.8);
    src.connect(lp); lp.connect(g); g.connect(this.master); src.start(now); src.stop(now + 3);
    this.thud(2);
  }
  beep(f = 880, d = 0.08) {
    if (!this.ready) return;
    const c = this.ctx, now = c.currentTime;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const g = c.createGain(); g.gain.setValueAtTime(0.1, now); g.gain.exponentialRampToValueAtTime(0.001, now + d);
    o.connect(g); g.connect(this.master); o.start(now); o.stop(now + d + 0.02);
  }
  say(text, priority = false) {
    if (!this.voice || !('speechSynthesis' in window) || this.alarms.silence(text)) return;   // (silence: dead electrics, audio-alarms.js)
    if (priority) { window.speechSynthesis.cancel(); this.speechQ.length = 0; }
    this.speechQ.push(text);
  }
  processSpeech() {
    if (!('speechSynthesis' in window) || !this.speechQ.length) return;
    if (window.speechSynthesis.speaking) return;
    const text = this.speechQ.shift();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05; u.pitch = 0.95; u.volume = clamp(this.volume, 0, 1);
    const voices = window.speechSynthesis.getVoices();
    const v = voices.find((x) => /en-(US|GB)/i.test(x.lang) && /(Google|Microsoft|Daniel|Samantha|David|Mark)/i.test(x.name)) || voices.find((x) => /^en/i.test(x.lang));
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
  }
  stopSpeech() { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); this.speechQ.length = 0; }
}
