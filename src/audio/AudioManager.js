import { clamp } from '../core/MathUtils.js';

/**
 * Fully synthesised audio (Web Audio API) — no asset files, so the game is
 * self-contained and every sound is tunable. Provides basketball impacts (ball,
 * rim, backboard, net swish), player foley (footsteps, shoe squeaks, whistle)
 * and a layered ambience bed (wind + birds or rain). Nothing plays until the
 * context is resumed from a user gesture.
 */
export class AudioManager {
  constructor(settings) {
    this.settings = settings;
    this.ready = false;
    this.ctx = null;
    this.enabled = true;
  }

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.settings.get('masterVolume');
      this.master.connect(this.ctx.destination);

      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = this.settings.get('sfxVolume');
      this.sfxBus.connect(this.master);

      this.ambBus = this.ctx.createGain();
      this.ambBus.gain.value = this.settings.get('ambienceVolume');
      this.ambBus.connect(this.master);

      this._noiseBuffer = this._makeNoise(2.0);
      this._whiteBuffer = this._makeWhite(2.0);
      this.ready = true;
    } catch (e) {
      this.enabled = false;
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolumes() {
    if (!this.ready) return;
    this.master.gain.value = this.settings.get('masterVolume');
    this.sfxBus.gain.value = this.settings.get('sfxVolume');
    this.ambBus.gain.value = this.settings.get('ambienceVolume');
  }

  _makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      // brownish noise
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.5;
    }
    return buf;
  }

  _makeWhite(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _noiseSource(white = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = white ? this._whiteBuffer : this._noiseBuffer;
    s.loop = true;
    // Start somewhere random in the loop so back-to-back hits never phase.
    s.loopStart = 0;
    s._offset = Math.random() * 1.5;
    return s;
  }

  _env(node, bus, peak, attack, decay, when = 0) {
    const t = this.ctx.currentTime + when;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    node.connect(g);
    g.connect(bus || this.sfxBus);
    return { g, t };
  }

  // --- Basketball impacts ----------------------------------------------------
  bounce(intensity = 1) {
    if (!this.ready) return;
    const v = clamp(intensity, 0.2, 1.6);
    // Low thump
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    const f = 120 + v * 60;
    osc.frequency.setValueAtTime(f, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(f * 0.5, this.ctx.currentTime + 0.12);
    const { t } = this._env(osc, this.sfxBus, 0.5 * v, 0.004, 0.14);
    osc.start(t);
    osc.stop(t + 0.2);
    // Noise slap
    const n = this._noiseSource();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    n.connect(bp);
    const { g, t: nt } = this._env(bp, this.sfxBus, 0.18 * v, 0.002, 0.06);
    n.start(nt);
    n.stop(nt + 0.1);
  }

  /** Soft slap of the ball meeting the palm. */
  catchBall(intensity = 0.3) {
    if (!this.ready) return;
    const v = clamp(intensity, 0.05, 0.8);
    const n = this._noiseSource();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500 + Math.random() * 400;
    bp.Q.value = 0.9;
    n.connect(bp);
    const { t } = this._env(bp, this.sfxBus, 0.10 * v, 0.002, 0.045);
    n.start(t);
    n.stop(t + 0.08);
  }

  /**
   * Ball on the iron: a bright inharmonic clang (steel ring, several
   * partials that decay at different rates) over a short dull thud from the
   * ball itself. Harder hits ring longer and brighter.
   */
  rim(intensity = 0.8) {
    if (!this.ready) return;
    const v = clamp(intensity, 0.2, 1.4);
    const partials = [
      [1180, 0.11, 0.22],
      [1760, 0.07, 0.3],
      [2410, 0.05, 0.18],
      [3260, 0.035, 0.12],
      [640, 0.05, 0.14],
    ];
    for (const [f, g, decay] of partials) {
      const o = this.ctx.createOscillator();
      o.type = f < 800 ? 'sine' : 'triangle';
      o.frequency.value = f * (0.985 + Math.random() * 0.03);
      const { t } = this._env(o, this.sfxBus, g * v * (f > 2000 ? Math.min(1, v) : 1), 0.0015, decay * (0.7 + 0.5 * v));
      o.start(t);
      o.stop(t + decay * 1.2 + 0.1);
    }
    // The ball's own thud on the metal.
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(190, this.ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(95, this.ctx.currentTime + 0.07);
    const { t } = this._env(o, this.sfxBus, 0.22 * v, 0.002, 0.07);
    o.start(t);
    o.stop(t + 0.12);
    const n = this._noiseSource(true);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600;
    bp.Q.value = 0.8;
    n.connect(bp);
    const { t: nt } = this._env(bp, this.sfxBus, 0.06 * v, 0.001, 0.03);
    n.start(nt, n._offset);
    n.stop(nt + 0.06);
  }

  /** Ball on the glass: a deep board thump with a short glassy ring. */
  backboard(intensity = 0.8) {
    if (!this.ready) return;
    const v = clamp(intensity, 0.2, 1.4);
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(230, this.ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(140, this.ctx.currentTime + 0.1);
    const { t } = this._env(o, this.sfxBus, 0.34 * v, 0.003, 0.14);
    o.start(t);
    o.stop(t + 0.22);
    const ring = this.ctx.createOscillator();
    ring.type = 'sine';
    ring.frequency.value = 1450 * (0.98 + Math.random() * 0.04);
    const { t: rt } = this._env(ring, this.sfxBus, 0.05 * v, 0.002, 0.09);
    ring.start(rt);
    ring.stop(rt + 0.14);
    const n = this._noiseSource();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.value = 1600;
    n.connect(bp);
    const { t: nt } = this._env(bp, this.sfxBus, 0.2 * v, 0.002, 0.08);
    n.start(nt, n._offset);
    n.stop(nt + 0.12);
  }

  /**
   * The net. A swish is cords brushing the leather: a bright, breathy hiss
   * that darkens as the ball pushes through, a lower whoosh as the net
   * snaps down and back, and a few tiny cord snaps at the start. Intensity
   * follows the ball's speed through the net.
   */
  swish(intensity = 1) {
    if (!this.ready) return;
    const v = clamp(intensity, 0.3, 1.3);
    const now = this.ctx.currentTime;
    // Cord brush.
    const n = this._noiseSource(true);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1500;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(5600, now);
    bp.frequency.exponentialRampToValueAtTime(1700, now + 0.3);
    bp.Q.value = 0.65;
    n.connect(hp).connect(bp);
    const { t } = this._env(bp, this.sfxBus, 0.2 * v, 0.022, 0.3 * (0.8 + 0.4 * v));
    n.start(t, n._offset);
    n.stop(t + 0.6);
    // Net body: the whoosh of the whole net dropping and whipping back.
    const n2 = this._noiseSource();
    const bp2 = this.ctx.createBiquadFilter();
    bp2.type = 'bandpass';
    bp2.frequency.setValueAtTime(1100, now + 0.04);
    bp2.frequency.exponentialRampToValueAtTime(420, now + 0.4);
    bp2.Q.value = 0.9;
    n2.connect(bp2);
    const { t: t2 } = this._env(bp2, this.sfxBus, 0.11 * v, 0.05, 0.38, 0.04);
    n2.start(t2, n2._offset);
    n2.stop(t2 + 0.6);
    // Cord snaps.
    const snaps = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < snaps; i++) {
      const when = 0.01 + Math.random() * 0.13;
      const s = this._noiseSource(true);
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 2600 + Math.random() * 2400;
      f.Q.value = 2.5;
      s.connect(f);
      const { t: st } = this._env(f, this.sfxBus, 0.05 * v, 0.001, 0.012, when);
      s.start(st, Math.random() * 1.5);
      s.stop(st + 0.03);
    }
  }

  /** The ball leaving the fingertips: a barely-there brush of leather. */
  release() {
    if (!this.ready) return;
    const n = this._noiseSource(true);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2800;
    bp.Q.value = 1.2;
    n.connect(bp);
    const { t } = this._env(bp, this.sfxBus, 0.035, 0.004, 0.035);
    n.start(t, n._offset);
    n.stop(t + 0.06);
  }

  footstep(intensity = 1) {
    if (!this.ready) return;
    const n = this._noiseSource();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500 + Math.random() * 200;
    n.connect(lp);
    const { t } = this._env(lp, this.sfxBus, 0.09 * intensity, 0.002, 0.07);
    n.start(t);
    n.stop(t + 0.1);
  }

  squeak() {
    if (!this.ready) return;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    const f = 900 + Math.random() * 500;
    o.frequency.setValueAtTime(f, this.ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(f * 1.8, this.ctx.currentTime + 0.06);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'bandpass';
    lp.frequency.value = f * 1.4;
    o.connect(lp);
    const { t } = this._env(lp, this.sfxBus, 0.06, 0.004, 0.08);
    o.start(t);
    o.stop(t + 0.14);
  }

  whistle() {
    if (!this.ready) return;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 2100;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 18;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 60;
    lfo.connect(lfoG).connect(o.frequency);
    const { t } = this._env(o, this.sfxBus, 0.14, 0.01, 0.4);
    o.start(t);
    lfo.start(t);
    o.stop(t + 0.5);
    lfo.stop(t + 0.5);
  }

  // --- Ambience --------------------------------------------------------------
  startAmbience({ birds = true, rain = false } = {}) {
    if (!this.ready) return;
    this.stopAmbience();
    this._amb = {};

    // Wind: filtered brown noise, slowly modulated.
    const wind = this._noiseSource();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = rain ? 900 : 420;
    const wg = this.ctx.createGain();
    wg.gain.value = rain ? 0.16 : 0.09;
    wind.connect(lp).connect(wg).connect(this.ambBus);
    // slow gain LFO
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 0.04;
    lfo.connect(lfoG).connect(wg.gain);
    wind.start();
    lfo.start();
    this._amb.wind = wind;
    this._amb.lfo = lfo;

    if (rain) {
      const r = this._noiseSource();
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 3200;
      bp.Q.value = 0.4;
      const rg = this.ctx.createGain();
      rg.gain.value = 0.14;
      r.connect(bp).connect(rg).connect(this.ambBus);
      r.start();
      this._amb.rain = r;
    }

    if (birds && !rain) {
      this._birdsOn = true;
      this._scheduleBird();
    }
  }

  _scheduleBird() {
    if (!this._birdsOn || !this.ready) return;
    const delay = 2 + Math.random() * 6;
    this._birdTimer = setTimeout(() => {
      this._chirp();
      this._scheduleBird();
    }, delay * 1000);
  }

  _chirp() {
    if (!this.ready) return;
    const notes = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < notes; i++) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      const base = 2400 + Math.random() * 1400;
      o.frequency.setValueAtTime(base, this.ctx.currentTime + i * 0.09);
      o.frequency.exponentialRampToValueAtTime(base * 1.3, this.ctx.currentTime + i * 0.09 + 0.05);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, this.ctx.currentTime + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.05, this.ctx.currentTime + i * 0.09 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + i * 0.09 + 0.08);
      o.connect(g).connect(this.ambBus);
      o.start(this.ctx.currentTime + i * 0.09);
      o.stop(this.ctx.currentTime + i * 0.09 + 0.1);
    }
  }

  stopAmbience() {
    this._birdsOn = false;
    if (this._birdTimer) clearTimeout(this._birdTimer);
    if (this._amb) {
      for (const k of Object.keys(this._amb)) {
        try { this._amb[k].stop(); } catch (e) {}
      }
      this._amb = null;
    }
  }
}
