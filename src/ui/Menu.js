import { BINDING_LABELS, DEFAULT_BINDINGS, codeLabel, RESERVED_CODES } from '../core/Bindings.js';

/**
 * Start + pause menu with an inline settings panel and a controls panel
 * where every action can be rebound (click a binding, press a key or a
 * mouse button; Esc cancels). The menu only appears
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
          <div class="btn-row">
            <button class="btn secondary" id="btn-settings">Settings</button>
            <button class="btn secondary" id="btn-controls">Controls</button>
          </div>
          <div class="controls-list" id="controls-list"></div>
        </div>

        <div id="menu-controls" style="display:none">
          <p class="menu-sub">Click a binding, then press a key or mouse button. Esc cancels.</p>
          <div class="bind-list" id="bind-list"></div>
          <div class="btn-row">
            <button class="btn secondary" id="btn-bind-reset">Reset to defaults</button>
            <button class="btn" id="btn-bind-back">Back</button>
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
    $('#btn-controls').onclick = () => this._showPanel('controls');
    $('#btn-bind-back').onclick = () => this._showPanel('main');
    $('#btn-bind-reset').onclick = () => this._setBindings(null);

    this._syncControls();
    this._renderBindings();
    this._bindCapture();

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
    this._showPanel(on ? 'settings' : 'main');
  }

  _showPanel(name) {
    this.$('#menu-main').style.display = name === 'main' ? 'block' : 'none';
    this.$('#menu-settings').style.display = name === 'settings' ? 'block' : 'none';
    this.$('#menu-controls').style.display = name === 'controls' ? 'block' : 'none';
    if (name !== 'controls') this._capture = null;
  }

  // --- Bindings -------------------------------------------------------------
  get bindings() {
    return this.settings.get('bindings');
  }

  _setBindings(map) {
    const next = map ? { ...map } : null;
    this.settings.set('bindings', next || { ...this._defaults() });
    this.cb.onSettingChange?.('bindings', this.settings.get('bindings'));
    this._renderBindings();
  }

  _defaults() {
    return { ...DEFAULT_BINDINGS };
  }

  _renderBindings() {
    const b = this.bindings;
    // Start-menu summary.
    const list = this.$('#controls-list');
    const rows = [`<div><b>WASD</b> move · <b>Mouse</b> look</div>`];
    for (const [action, label] of BINDING_LABELS) rows.push(`<div><b>${codeLabel(b[action])}</b> ${label}</div>`);
    rows.push(`<div><b>Tab</b> tuning panel · <b>Esc</b> pause</div>`);
    list.innerHTML = rows.join('');
    // Controls panel.
    const panel = this.$('#bind-list');
    panel.innerHTML = BINDING_LABELS.map(
      ([action, label]) =>
        `<div class="bind-row"><span>${label}</span><button class="bind-btn" data-action="${action}">${codeLabel(b[action])}</button></div>`
    ).join('');
    for (const btn of panel.querySelectorAll('.bind-btn')) {
      btn.onclick = () => {
        for (const o of panel.querySelectorAll('.bind-btn')) o.classList.remove('capturing');
        btn.classList.add('capturing');
        btn.textContent = 'press a key…';
        this._capture = btn.dataset.action;
      };
    }
  }

  /** While a binding is being captured, the next key or mouse button takes it. */
  _bindCapture() {
    const take = (code, e) => {
      if (!this._capture) return;
      e.preventDefault();
      e.stopPropagation();
      const action = this._capture;
      this._capture = null;
      if (code === 'Escape' || RESERVED_CODES.has(code)) {
        this._renderBindings();
        return;
      }
      const map = { ...this.bindings };
      // Swap with whatever already had this code, so nothing is left unbound.
      for (const [other, c] of Object.entries(map)) if (c === code && other !== action) map[other] = map[action];
      map[action] = code;
      this._setBindings(map);
    };
    window.addEventListener('keydown', (e) => take(e.code, e), true);
    document.addEventListener('mousedown', (e) => { if (this._capture) take(`Mouse${e.button}`, e); }, true);
    document.addEventListener('contextmenu', (e) => { if (this._capture) e.preventDefault(); }, true);
  }

  showStart() {
    this.started = false;
    this.overlay.classList.remove('hidden');
    this._showPanel('main');
    this.$('#menu-sub').textContent = 'Handle it. Then knock it down.';
    this.$('#btn-play').textContent = 'Step on the court';
  }

  showPause() {
    this.started = true;
    this._syncControls();
    this.overlay.classList.remove('hidden');
    this._showPanel('main');
    this.$('#menu-sub').textContent = 'Paused.';
    this.$('#btn-play').textContent = 'Resume';
  }

  hide() {
    this.started = true;
    this.overlay.classList.add('hidden');
  }
}
