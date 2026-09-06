/**
 * Minimal heads-up display for the dribble lab: a crosshair, which hand has
 * the ball, the move that just fired (and the chain it belongs to), a live
 * tempo readout, and a contextual hint. Pure DOM over the canvas.
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
      <div class="flash move" id="hud-move"></div>
      <div class="combo" id="hud-combo"></div>
      <div class="hint" id="hud-hint"></div>
    `;
    document.body.appendChild(this.root);
    this.el = {
      left: this.root.querySelector('#hud-left'),
      right: this.root.querySelector('#hud-right'),
      tempo: this.root.querySelector('#hud-tempo'),
      move: this.root.querySelector('#hud-move'),
      combo: this.root.querySelector('#hud-combo'),
      hint: this.root.querySelector('#hud-hint'),
    };
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

  update(dt, dribble, player) {
    this._clock += dt;
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
