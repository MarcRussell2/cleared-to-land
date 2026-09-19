// Failure alarms, synthesized like the rest of src/audio.js (no sample files): the master caution chime, the fire
// bell, the clack of a runaway trim wheel, the buzz of flutter, the bang of an engine surge or a tire going.
// AudioSys owns one of these (audio.alarms); src/systems/failureEffects.js drives it:
//   chime(n)            one caution chime (n = 1) or the warning's triple (n = 2)
//   update(dt, snd)     every frame while flying, snd = { bell, clacker, buzz, bang, thud } (0..1 each; bang and thud
//                       are one-shots, the rest last while they are set); snd = null stops everything
//   dark                true while the electrics are dead (failureEffects.js Electrical): silence(text) then tells
//                       AudioSys.say() to drop the radio altimeter's calls (main.js says them as a number alone)
// The continuous sounds are made of short strikes scheduled from update(), and the buzz fades by itself unless
// update() keeps it up, so when the frames stop (pause, the debrief, the menu) the alarms stop with them.
import { clamp } from './config.js';

export class Alarms {
  constructor(sys) { this.sys = sys; this.bellT = 0; this.clackT = 0; this.buzzOn = false; this.dark = false; }
  get ok() { return this.sys.ready && this.sys.enabled; }
  // No electrics, no radio altimeter: its calls ("50", "20") are dropped; everything else still speaks.
  silence(text) { return this.dark && /^\d+$/.test(text); }

  // A struck tone: a sine and its metallic overtone, gone in `decay` s.
  strike(f, gain, decay, when = 0) {
    const c = this.sys.ctx, t = c.currentTime + when;
    for (const [mult, g] of [[1, 1], [2.76, 0.35]]) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f * mult;
      const a = c.createGain(); a.gain.setValueAtTime(0.0001, t); a.gain.linearRampToValueAtTime(gain * g, t + 0.004); a.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(a); a.connect(this.sys.master); o.start(t); o.stop(t + decay + 0.02);
    }
  }
  chime(n = 1) {
    if (!this.ok) return;
    if (n >= 2) { for (let i = 0; i < 3; i++) this.strike(1180, 0.07, 0.35, i * 0.16); return; }
    this.strike(1318, 0.07, 0.55); this.strike(1046, 0.06, 0.8, 0.22);
  }
  noise(freq, q, gain, decay, rate = 1) {
    const c = this.sys.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.sys.noise; src.playbackRate.value = rate;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const a = c.createGain(); a.gain.setValueAtTime(gain, t); a.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    this.off = ((this.off || 0) + 0.377) % 1.5;   // a different stretch of the noise each time (no Math.random)
    src.connect(f); f.connect(a); a.connect(this.sys.master); src.start(t, this.off); src.stop(t + decay + 0.02);
  }
  bang(strength) {
    this.noise(420, 0.7, 0.9 * clamp(strength, 0, 1.5), 0.45, 0.6);
    this.sys.thud(strength);
  }
  _buzz(level) {
    const c = this.sys.ctx, now = c.currentTime;
    if (!this.buzzG) {
      this.buzzO = c.createOscillator(); this.buzzO.type = 'sawtooth'; this.buzzO.frequency.value = 38;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
      this.buzzG = c.createGain(); this.buzzG.gain.value = 0;
      this.buzzO.connect(lp); lp.connect(this.buzzG); this.buzzG.connect(this.sys.master); this.buzzO.start();
    }
    const g = this.buzzG.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(0.12 * level, now, 0.05);
    g.setTargetAtTime(0, now + 0.25, 0.08);   // a dead man's handle: silent unless the next frame asks again
    this.buzzO.frequency.setTargetAtTime(34 + 14 * level, now, 0.1);
  }
  update(dt, snd) {
    if (!this.ok) return;
    if (!snd) { if (this.buzzG) this._buzz(0); return; }
    if (snd.bell > 0) {
      this.bellT -= dt;
      if (this.bellT <= 0) { this.bellT = 0.105; this.strike(1460, 0.05, 0.22); }
    } else this.bellT = 0;
    if (snd.clacker > 0) {
      this.clackT -= dt;
      if (this.clackT <= 0) { this.clackT = 0.085; this.noise(2400, 3, 0.18, 0.03, 1.8); }
    } else this.clackT = 0;
    if (snd.buzz > 0.02 || this.buzzG) this._buzz(snd.buzz > 0.02 ? snd.buzz : 0);
    if (snd.bang > 0) this.bang(snd.bang);
    if (snd.thud > 0) this.sys.thud(snd.thud);
  }
}
