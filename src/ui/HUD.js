/**
 * The in-game heads-up display: crosshair, session stats, contextual hint, the
 * shot-timing meter, and the grade / make flashes. Pure DOM over the canvas so
 * it stays crisp and cheap. Everything is created here so index.html stays
 * minimal.
 */
export class HUD {
  constructor(gameState) {
    this.gameState = gameState;
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="crosshair"></div>
      <div class="stats">
        <div class="big"><span id="hud-makes">0</span>/<span id="hud-att">0</span>
          <span style="opacity:.6;font-size:14px">(<span id="hud-pct">0</span>%)</span></div>
        <div class="streak" id="hud-streak"></div>
      </div>
      <div class="env-name" id="hud-env"></div>
      <div class="shot-meter" id="hud-meter">
        <div class="fill" id="hud-meter-fill"></div>
        <div class="ideal" id="hud-meter-ideal"></div>
      </div>
      <div class="flash grade" id="hud-grade"></div>
      <div class="flash make" id="hud-make"></div>
      <div class="hint" id="hud-hint">Click to look around · E to pick up the ball</div>
    `;
    document.body.appendChild(this.root);

    this.el = {
      makes: this.root.querySelector('#hud-makes'),
      att: this.root.querySelector('#hud-att'),
      pct: this.root.querySelector('#hud-pct'),
      streak: this.root.querySelector('#hud-streak'),
      env: this.root.querySelector('#hud-env'),
      meter: this.root.querySelector('#hud-meter'),
      meterFill: this.root.querySelector('#hud-meter-fill'),
      meterIdeal: this.root.querySelector('#hud-meter-ideal'),
      grade: this.root.querySelector('#hud-grade'),
      make: this.root.querySelector('#hud-make'),
      hint: this.root.querySelector('#hud-hint'),
    };

    gameState.onChange((s) => this._refreshStats(s));
    this._refreshStats(gameState);
    this._hintTimer = 0;
  }

  _refreshStats(s) {
    this.el.makes.textContent = s.makes;
    this.el.att.textContent = s.attempts;
    this.el.pct.textContent = s.percentage;
    this.el.streak.textContent = s.streak >= 2 ? `🔥 ${s.streak} in a row` : '';
  }

  setEnvName(name) {
    this.el.env.textContent = name;
  }

  setHint(text) {
    this.el.hint.textContent = text;
    this.el.hint.style.opacity = text ? '0.75' : '0';
  }

  setShotMeter(data) {
    if (!data) {
      this.el.meter.style.display = 'none';
      return;
    }
    this.el.meter.style.display = 'block';
    this.el.meterFill.style.height = `${Math.min(100, data.fill * 100)}%`;
    // Position the ideal marker line.
    this.el.meterIdeal.style.bottom = `${data.idealAt * 100}%`;
  }

  flashGrade(grade) {
    const label = grade.toUpperCase();
    const e = this.el.grade;
    e.textContent = label;
    e.className = `flash grade g-${grade} show`;
    void e.offsetWidth; // restart animation
    e.className = `flash grade g-${grade} show`;
    setTimeout(() => (e.className = `flash grade g-${grade}`), 900);
  }

  flashMake(text) {
    const e = this.el.make;
    e.textContent = text;
    e.className = 'flash make g-green show';
    void e.offsetWidth;
    e.className = 'flash make g-green show';
    setTimeout(() => (e.className = 'flash make g-green'), 900);
  }

  show() { this.root.style.display = 'block'; }
  hide() { this.root.style.display = 'none'; }
}
