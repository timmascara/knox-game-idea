import { ENVIRONMENTS, ENVIRONMENT_ORDER } from '../world/environments.js';

/**
 * Start + pause menu with an inline settings panel. Gameplay always takes
 * priority: the menu only appears before first entry and when the player pauses
 * (pointer unlock / Esc), and every control writes straight through to Settings.
 */
export class Menu {
  constructor(settings, callbacks) {
    this.settings = settings;
    this.cb = callbacks;
    this.started = false;

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
        <p class="menu-sub" id="menu-sub">A quiet afternoon at the park.</p>

        <div id="menu-main">
          <button class="btn" id="btn-play">Enter the Park</button>
          <button class="btn secondary" id="btn-settings">Settings</button>
          <div class="controls-list">
            <div><b>WASD</b> move</div>
            <div><b>Shift</b> sprint</div>
            <div><b>Space</b> jump</div>
            <div><b>Mouse</b> look</div>
            <div><b>E</b> pick up / drop ball</div>
            <div><b>L-Click</b> shoot · near rim: layup / dunk</div>
            <div><b>R-Click</b> dribble move (crossover / between / behind)</div>
            <div><b>Dbl A/D</b> quick crossover</div>
            <div><b>Esc</b> pause</div>
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
            <input type="range" id="set-fov" min="60" max="100" step="1">
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
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <div style="opacity:.6;font-size:12px;margin-top:4px">Changes apply on reload.</div>
          </div>
          <div class="setting">
            <label>Environment</label>
            <select id="set-env"></select>
          </div>
          <button class="btn" id="btn-back">Back</button>
        </div>
      </div>
    `;
  }

  _bind() {
    const $ = (id) => this.overlay.querySelector(id);
    this.$ = $;

    $('#btn-play').onclick = () => this.cb.onStart();
    $('#btn-settings').onclick = () => this._showSettings(true);
    $('#btn-back').onclick = () => this._showSettings(false);

    // Populate environment select.
    const envSel = $('#set-env');
    for (const key of ENVIRONMENT_ORDER) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = ENVIRONMENTS[key].name;
      envSel.appendChild(opt);
    }

    this._syncControls();

    const s = this.settings;
    $('#set-sens').oninput = (e) => {
      // Map slider 0.5..3.5 to a real sensitivity.
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
    $('#set-env').onchange = (e) => this.cb.onEnvironment?.(e.target.value);
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
    $('#set-env').value = s.get('environment');
  }

  _showSettings(on) {
    this.$('#menu-main').style.display = on ? 'none' : 'block';
    this.$('#menu-settings').style.display = on ? 'block' : 'none';
  }

  showStart() {
    this.overlay.classList.remove('hidden');
    this._showSettings(false);
    this.$('#menu-sub').textContent = 'A quiet afternoon at the park.';
    this.$('#btn-play').textContent = 'Enter the Park';
  }

  showPause() {
    this._syncControls();
    this.overlay.classList.remove('hidden');
    this._showSettings(false);
    this.$('#menu-sub').textContent = 'Paused.';
    this.$('#btn-play').textContent = 'Resume';
  }

  hide() {
    this.overlay.classList.add('hidden');
  }
}
