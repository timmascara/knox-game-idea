import { ShotMeter } from './ShotMeter.js';
import { SHOT } from '../core/Constants.js';

/**
 * Minimal heads-up display: a crosshair, which hand has the ball, the move
 * that just fired (and the chain it belongs to), a live tempo readout, the
 * shot meter with its timing and result feedback, a makes tally, and a
 * contextual hint. Pure DOM over the canvas.
 */
export class HUD {
  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="crosshair"></div>
      <div class="hands">
        <span class="hand" id="hud-left">L</span>
        <span class="hand" id="hud-right">R</span>
      </div>
      <div class="tempo" id="hud-tempo"></div>
      <div class="score" id="hud-score"></div>
      <div class="flash move" id="hud-move"></div>
      <div class="flash result" id="hud-result"></div>
      <div class="timing" id="hud-timing"></div>
      <div class="combo" id="hud-combo"></div>
      <div class="hint" id="hud-hint"></div>
    `;
    document.body.appendChild(this.root);
    this.el = {
      left: this.root.querySelector('#hud-left'),
      right: this.root.querySelector('#hud-right'),
      tempo: this.root.querySelector('#hud-tempo'),
      score: this.root.querySelector('#hud-score'),
      move: this.root.querySelector('#hud-move'),
      result: this.root.querySelector('#hud-result'),
      timing: this.root.querySelector('#hud-timing'),
      combo: this.root.querySelector('#hud-combo'),
      hint: this.root.querySelector('#hud-hint'),
    };
    this.meter = new ShotMeter(this.root);
    this._lastCatch = 0;
    this._catchTimes = [];
    this._clock = 0;
    this._moveTimer = 0;
    this.hide();
  }

  setHand(sign) {
    this.el.left.classList.toggle('active', sign < 0);
    this.el.right.classList.toggle('active', sign > 0);
  }

  setHint(text) {
    this.el.hint.textContent = text || '';
    this.el.hint.style.opacity = text ? '0.8' : '0';
  }

  flashMove(label) {
    const e = this.el.move;
    e.textContent = label;
    e.classList.remove('show');
    void e.offsetWidth;
    e.classList.add('show');
    clearTimeout(this._moveTo);
    this._moveTo = setTimeout(() => e.classList.remove('show'), 700);
  }

  setCombo(list) {
    this.el.combo.textContent = list.length > 1 ? list.join('  →  ') : '';
  }

  /** Timing feedback the instant the button comes up, before the ball lands. */
  flashTiming(zone, err, kind = 'jumper') {
    const e = this.el.timing;
    let text;
    const side = err < 0 ? 'EARLY' : 'LATE';
    if (zone === 'green') text = kind === 'layup' ? 'GOOD' : 'PERFECT';
    else if (kind === 'layup') text = side;
    else {
      const mag = Math.abs(err);
      text = mag <= SHOT.iron ? `SLIGHTLY ${side}` : mag <= SHOT.glass ? side : `WAY ${side}`;
    }
    e.textContent = text;
    e.className = `timing show zone-${zone}`;
    clearTimeout(this._timingTo);
    this._timingTo = setTimeout(() => e.classList.remove('show'), 1100);
  }

  /** The verdict once the ball has settled the question. */
  flashResult(label, kind) {
    const e = this.el.result;
    e.textContent = label;
    e.className = `flash result result-${kind}`;
    void e.offsetWidth;
    e.classList.add('show');
    clearTimeout(this._resultTo);
    this._resultTo = setTimeout(() => e.classList.remove('show'), 1000);
  }

  setScore(made, attempts) {
    this.el.score.textContent = attempts ? `${made} / ${attempts}` : '';
  }

  update(dt, dribble, player) {
    this._clock += dt;
    this.meter.update(dt);
    if (dribble.lastEvent === 'catch') {
      dribble.lastEvent = null;
      this._catchTimes.push(this._clock);
      if (this._catchTimes.length > 6) this._catchTimes.shift();
    }
    if (!dribble.dribbling) {
      this.el.tempo.textContent = '';
      this._catchTimes.length = 0;
      this.el.left.classList.remove('active');
      this.el.right.classList.remove('active');
      return;
    }
    if (this._catchTimes.length >= 2) {
      const span = this._catchTimes[this._catchTimes.length - 1] - this._catchTimes[0];
      const per = span / (this._catchTimes.length - 1);
      if (per > 0) this.el.tempo.textContent = `${Math.round(60 / per)} bpm`;
    }
  }

  show() { this.root.style.display = 'block'; }
  hide() { this.root.style.display = 'none'; }
}
