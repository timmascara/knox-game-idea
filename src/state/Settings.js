/**
 * Persistent player preferences, stored in localStorage. Every read/write is
 * guarded so the game still runs in private windows or when storage is blocked.
 */
const KEY = 'homecourt.settings.v2';

const DEFAULTS = {
  sensitivity: 0.0022,
  invertY: false,
  masterVolume: 0.8,
  sfxVolume: 0.9,
  ambienceVolume: 0.7,
  quality: 'high', // 'low' | 'high'
  fov: 84,
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
