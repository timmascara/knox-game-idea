/**
 * Persistent player preferences, stored in localStorage. Every read/write is
 * guarded so the game still runs in private windows or when storage is blocked.
 */
import { DEFAULT_BINDINGS, BINDINGS_VERSION } from '../core/Bindings.js';

const KEY = 'homecourt.settings.v2';

const DEFAULTS = {
  sensitivity: 0.0022,
  invertY: false,
  masterVolume: 0.8,
  sfxVolume: 0.9,
  ambienceVolume: 0.7,
  quality: 'high', // 'low' | 'high'
  fov: 84,
  bindings: { ...DEFAULT_BINDINGS },
};

export class Settings {
  constructor() {
    this.data = { ...DEFAULTS };
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch (e) {
      /* storage unavailable — fall back to defaults */
    }
    // Actions added since the settings were saved get their defaults, and a
    // new default layout replaces a saved one outright (the owner asked for
    // J/K after playing with the old defaults saved in their browser).
    if ((this.data.bindingsVersion || 0) < BINDINGS_VERSION) {
      this.data.bindings = { ...DEFAULT_BINDINGS };
      this.data.bindingsVersion = BINDINGS_VERSION;
      this.save();
    } else {
      this.data.bindings = { ...DEFAULT_BINDINGS, ...(this.data.bindings || {}) };
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch (e) {
      /* ignore */
    }
  }

  get(k) {
    return this.data[k];
  }

  set(k, v) {
    this.data[k] = v;
    this.save();
  }
}
