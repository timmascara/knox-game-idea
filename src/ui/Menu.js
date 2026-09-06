/**
 * Start + pause menu with an inline settings panel. The menu only appears
 * before first entry and when the player pauses (pointer unlock / Esc), and
 * every control writes straight through to Settings.
 */
export class Menu {
  constructor(settings, callbacks) {
    this.settings = settings;
    this.cb = callbacks;

    this.overlay = document.createElement('div');
    this.overlay.className = 'overlay';
    this.overlay.innerHTML = this._html();
    document.body.appendChild(this.overlay);

    this._bind();
    this.showStart();
  }

  _html() {
    return `
      <div class="menu-card">
        <h1>HOME <span>COURT</span></h1>
        <p class="menu-sub" id="menu-sub">Dribble lab. Master the handle first.</p>

        <div id="menu-main">
          <button class="btn" id="btn-play">Step on the court</button>
          <button class="btn secondary" id="btn-settings">Settings</button>
          <div class="controls-list">
            <div><b>WASD</b> move · <b>Shift</b> sprint (speed dribble)</div>
            <div><b>Mouse</b> look</div>
            <div><b>E</b> pick up · hold / dribble</div>
            <div><b>L-Click</b> crossover · with <b>S</b>: step-back</div>
            <div><b>R-Click</b> between the legs</div>
            <div><b>Q</b> behind the back</div>
            <div><b>F</b> in &amp; out</div>
            <div><b>Space</b> hesitation</div>
            <div><b>C</b> (hold) low dribble</div>
            <div><b>G</b> drop the ball</div>
            <div><b>Tab</b> tuning panel · <b>Esc</b> pause</div>
          </div>
        </div>

        <div id="menu-settings" style="display:none">
          <div class="setting">
            <label>Look sensitivity: <span id="lbl-sens"></span></label>
            <input type="range" id="set-sens" min="0.5" max="3.5" step="0.05">
          </div>
          <div class="setting"><div class="row">
            <input type="checkbox" id="set-invert"><label style="margin:0">Invert Y axis</label>
          </div></div>
          <div class="setting">
            <label>Field of view: <span id="lbl-fov"></span></label>
            <input type="range" id="set-fov" min="60" max="110" step="1">
          </div>
          <div class="setting">
            <label>Master volume</label><input type="range" id="set-master" min="0" max="1" step="0.02">
          </div>
          <div class="setting">
            <label>SFX volume</label><input type="range" id="set-sfx" min="0" max="1" step="0.02">
          </div>
          <div class="setting">
            <label>Ambience volume</label><input type="range" id="set-amb" min="0" max="1" step="0.02">
          </div>
          <div class="setting">
            <label>Graphics quality</label>
            <select id="set-quality">
              <option value="low">Low</option>
              <option value="high">High</option>
            </select>
            <div style="opacity:.6;font-size:12px;margin-top:4px">Changes apply on reload.</div>
          </div>
          <button class="btn" id="btn-back">Back</button>
        </div>
      </div>
    `;
  }

  _bind() {
    const $ = (id) => this.overlay.querySelector(id);
    this.$ = $;

    $('#btn-play').onclick = () => (this.started ? this.cb.onResume() : this.cb.onStart());
    $('#btn-settings').onclick = () => this._showSettings(true);
    $('#btn-back').onclick = () => this._showSettings(false);

    this._syncControls();

    const s = this.settings;
    $('#set-sens').oninput = (e) => {
      const v = 0.0022 * parseFloat(e.target.value);
      s.set('sensitivity', v);
      $('#lbl-sens').textContent = parseFloat(e.target.value).toFixed(2);
      this.cb.onSettingChange?.('sensitivity', v);
    };
    $('#set-invert').onchange = (e) => {
      s.set('invertY', e.target.checked);
      this.cb.onSettingChange?.('invertY', e.target.checked);
    };
    $('#set-fov').oninput = (e) => {
      const v = parseInt(e.target.value, 10);
      s.set('fov', v);
      $('#lbl-fov').textContent = v;
      this.cb.onSettingChange?.('fov', v);
    };
    $('#set-master').oninput = (e) => { s.set('masterVolume', +e.target.value); this.cb.onSettingChange?.('volume'); };
    $('#set-sfx').oninput = (e) => { s.set('sfxVolume', +e.target.value); this.cb.onSettingChange?.('volume'); };
    $('#set-amb').oninput = (e) => { s.set('ambienceVolume', +e.target.value); this.cb.onSettingChange?.('volume'); };
    $('#set-quality').onchange = (e) => s.set('quality', e.target.value);
  }

  _syncControls() {
    const s = this.settings;
    const $ = this.$;
    const sensSlider = s.get('sensitivity') / 0.0022;
    $('#set-sens').value = sensSlider;
    $('#lbl-sens').textContent = sensSlider.toFixed(2);
    $('#set-invert').checked = s.get('invertY');
    $('#set-fov').value = s.get('fov');
    $('#lbl-fov').textContent = s.get('fov');
    $('#set-master').value = s.get('masterVolume');
    $('#set-sfx').value = s.get('sfxVolume');
    $('#set-amb').value = s.get('ambienceVolume');
    $('#set-quality').value = s.get('quality');
  }

  _showSettings(on) {
    this.$('#menu-main').style.display = on ? 'none' : 'block';
    this.$('#menu-settings').style.display = on ? 'block' : 'none';
  }

  showStart() {
    this.started = false;
    this.overlay.classList.remove('hidden');
    this._showSettings(false);
    this.$('#menu-sub').textContent = 'Dribble lab. Master the handle first.';
    this.$('#btn-play').textContent = 'Step on the court';
  }

  showPause() {
    this.started = true;
    this._syncControls();
    this.overlay.classList.remove('hidden');
    this._showSettings(false);
    this.$('#menu-sub').textContent = 'Paused.';
    this.$('#btn-play').textContent = 'Resume';
  }

  hide() {
    this.started = true;
    this.overlay.classList.add('hidden');
  }
}
