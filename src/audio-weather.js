// The weather's sound: rain on the airframe, the storm's wind, thunder. Synthesised like everything in
// src/audio.js (no sample files), from the same looped noise buffer, into one bus.
//
// Contract: AudioSys builds one `new WeatherAudio(this)` in resume() (the audio context exists then) and calls
// `update(ac, ctx, dt, now)` from its own update(); ctx.weather is src/systems/weather.js `state` (null when the
// flight has no weather) and ctx.cameraMode the camera. It reads, from state:
//   rain, snow      the hiss of the drops and the drumming on the skin (louder in the cockpit: the canopy is
//                   right there), snow only a soft hiss
//   gust            a low, moving howl of storm wind on top of the airframe's own wind noise
//   strike, strikeDist, strikePower, strikeCG   a strike each time `strike` steps: thunder at distance/343 s,
//                   a sharp crack first when it is close, a long low-passed roll that is duller the further away
// Everything goes through one gain (the bus) that is held open by update() and falls silent 0.6 s after the
// last call: pause, the debrief and the menu stop calling it, so the storm fades instead of raining on over a
// menu, and a roll of thunder scheduled seconds ahead is cut off with it.
import { clamp } from './config.js';

export class WeatherAudio {
  constructor(sys) {
    this.sys = sys;
    const c = this.c = sys.ctx;
    this.bus = c.createGain(); this.bus.gain.value = 0; this.bus.connect(sys.master);
    const loop = (rate) => { const s = c.createBufferSource(); s.buffer = sys.noise; s.loop = true; s.playbackRate.value = rate; return s; };
    // rain: the hiss of a million drops (high band) and their drumming on the skin (a lumpy mid band)
    this.hissG = c.createGain(); this.hissG.gain.value = 0; this.hissG.connect(this.bus);
    const hs = loop(1.35), hp = c.createBiquadFilter(), pk = c.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 1400; hp.Q.value = 0.5;
    pk.type = 'peaking'; pk.frequency.value = 5200; pk.Q.value = 0.8; pk.gain.value = 5;
    hs.connect(hp); hp.connect(pk); pk.connect(this.hissG); hs.start();
    this.drumG = c.createGain(); this.drumG.gain.value = 0; this.drumG.connect(this.bus);
    const ds = loop(0.85), bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.9;
    this.drumAM = c.createGain(); this.drumAM.gain.value = 1;
    ds.connect(bp); bp.connect(this.drumAM); this.drumAM.connect(this.drumG); ds.start();
    // an irregular patter: two slow LFOs beating against each other on the drum layer's level
    for (const [f, depth] of [[5.3, 0.22], [8.9, 0.16]]) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = c.createGain(); g.gain.value = depth; o.connect(g); g.connect(this.drumAM.gain); o.start();
    }
    // storm wind: low noise through a band that wanders
    this.windG = c.createGain(); this.windG.gain.value = 0; this.windG.connect(this.bus);
    const ws = loop(0.32);
    this.windBP = c.createBiquadFilter(); this.windBP.type = 'bandpass'; this.windBP.frequency.value = 380; this.windBP.Q.value = 1.4;
    ws.connect(this.windBP); this.windBP.connect(this.windG); ws.start();
    this.st = null; this.lastStrike = 0; this.t = 0;
  }

  update(ac, ctx, dt, now) {
    const st = ctx && ctx.weather;
    const bus = this.bus.gain;
    bus.cancelScheduledValues(now);
    if (!st) { bus.setTargetAtTime(0, now, 0.3); return; }
    // the dead man's handle: open now, closing 0.6 s from now unless the next frame calls again
    bus.setTargetAtTime(1, now, 0.15);
    bus.setTargetAtTime(0, now + 0.6, 0.35);
    this.t += dt;
    const cockpit = ctx.cameraMode === 'cockpit';
    const rain = clamp(st.rain || 0, 0, 1), snow = clamp(st.snow || 0, 0, 1);
    const speed = clamp((ac ? ac.ias : 0) / 70, 0, 1.5);
    const hiss = (0.03 + 0.11 * rain) * (rain > 0.01 ? 1 : 0) + snow * 0.025;
    this.hissG.gain.setTargetAtTime(hiss * (cockpit ? 1.0 : 0.55) * (0.75 + 0.35 * speed), now, 0.25);
    this.drumG.gain.setTargetAtTime(rain * rain * (cockpit ? 0.28 : 0.07) * (0.6 + 0.5 * speed), now, 0.25);
    const g = clamp(st.gust || 0, 0, 1);
    this.windG.gain.setTargetAtTime(g * g * (cockpit ? 0.05 : 0.09), now, 0.4);
    this.windBP.frequency.setTargetAtTime(300 + 180 * g + 90 * Math.sin(this.t * 0.7), now, 0.5);
    // thunder: once per strike (a new flight's state starts its own count)
    if (st !== this.st) { this.st = st; this.lastStrike = st.strike || 0; }
    if (st.strike !== this.lastStrike) { this.lastStrike = st.strike; this.thunder(st.strikeDist, st.strikePower, now, cockpit); }
  }

  thunder(dist, power, now, cockpit) {
    const c = this.c;
    const t0 = now + clamp(dist / 343, 0.05, 15);
    const loud = clamp((power || 0.5) * 1.5 / (1 + dist / 2000), 0.04, 1.1) * (cockpit ? 0.8 : 1);
    const near = dist < 1600;
    if (near) {   // the crack of a close strike, before the roll
      const s = c.createBufferSource(); s.buffer = this.sys.noise; s.playbackRate.value = 1.4;
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(loud * 0.9, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
      s.connect(hp); hp.connect(g); g.connect(this.bus); s.start(t0); s.stop(t0 + 0.4);
    }
    // the roll: slowed noise, low-passed and swept down, a slow swell then two later rumbles
    const len = 4.5 + Math.min(4, dist / 2500);
    const s = c.createBufferSource(); s.buffer = this.sys.noise; s.loop = true; s.playbackRate.value = 0.26;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7;
    const f0 = near ? 1100 : clamp(700 - dist / 20, 180, 700);
    lp.frequency.setValueAtTime(f0, t0); lp.frequency.exponentialRampToValueAtTime(55, t0 + len);
    const g = c.createGain(), a = near ? 0.05 : 0.25 + Math.min(0.6, dist / 8000);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(loud, t0 + a);
    g.gain.exponentialRampToValueAtTime(loud * 0.35, t0 + a + len * 0.25);
    g.gain.exponentialRampToValueAtTime(loud * 0.6, t0 + a + len * 0.4);
    g.gain.exponentialRampToValueAtTime(loud * 0.2, t0 + a + len * 0.6);
    g.gain.exponentialRampToValueAtTime(loud * 0.3, t0 + a + len * 0.72);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + a + len);
    s.connect(lp); lp.connect(g); g.connect(this.bus);
    s.start(t0); s.stop(t0 + a + len + 0.1);
  }
}
