/**
 * Session scoreboard + streak tracking. Deliberately light — Home Court is
 * about feel, not a scoreboard — but it gives the shot system somewhere to
 * report makes/misses and drives the little HUD readouts.
 */
export class GameState {
  constructor() {
    this.makes = 0;
    this.attempts = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.greens = 0;
    this.lastResult = null; // { grade, made, kind }
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit() {
    for (const fn of this.listeners) fn(this);
  }

  recordShot({ grade, made, kind }) {
    this.attempts++;
    if (grade === 'green') this.greens++;
    if (made) {
      this.makes++;
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
    } else {
      this.streak = 0;
    }
    this.lastResult = { grade, made, kind };
    this._emit();
  }

  get percentage() {
    return this.attempts ? Math.round((this.makes / this.attempts) * 100) : 0;
  }
}
