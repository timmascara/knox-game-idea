import { DRIBBLE, SHOT } from '../core/Constants.js';

/**
 * Live tuning panel (Tab). Every slider writes straight into the DRIBBLE
 * constants the engine reads each frame, so the feel can be dialled in while
 * dribbling instead of by rebuilding. Values are not persisted — this is a
 * lab bench, and the defaults in Constants.js are the record.
 */
const FIELDS = [
  ['catchHeight', 'Dribble height', 0.5, 1.25, 0.01],
  ['lowCatchHeight', 'Low dribble height', 0.35, 0.85, 0.01],
  ['forward', 'Ball forward', 0.3, 1.0, 0.01],
  ['side', 'Ball side offset', 0.1, 0.55, 0.01],
  ['restitution', 'Bounce restitution', 0.6, 0.95, 0.01],
  ['catchRiseSpeed', 'Catch rise speed', 0.2, 2.0, 0.05],
  ['releaseDrop', 'Push depth', 0.02, 0.25, 0.005],
  ['absorb', 'Absorb rise', 0.0, 0.15, 0.005],
  ['speedLead', 'Speed lead', 0.0, 0.2, 0.005],
  ['followLambda', 'Handle follow', 4, 30, 0.5],
  ['yawLambda', 'Handle turn', 2, 20, 0.5],
  ['contactPound', 'Pound contact (s)', 0.08, 0.3, 0.005],
  ['contactCross', 'Crossover contact (s)', 0.1, 0.35, 0.005],
  ['contactBetween', 'Between contact (s)', 0.1, 0.35, 0.005],
  ['contactBehind', 'Behind contact (s)', 0.15, 0.5, 0.005],
  ['contactInOut', 'In&Out contact (s)', 0.15, 0.45, 0.005],
  ['contactHesi', 'Hesitation hold (s)', 0.2, 0.8, 0.01],
  ['swayLateral', 'Body sway (lateral)', 0, 0.15, 0.005],
  ['swayVertical', 'Body sway (vertical)', 0, 0.1, 0.005],
  ['swayRoll', 'Body sway (roll)', 0, 0.08, 0.002],
];

const SHOT_FIELDS = [
  ['releaseTime', 'Ideal release (s)', 0.4, 0.9, 0.01],
  ['green', 'Green window (±s)', 0.01, 0.08, 0.005],
  ['iron', 'Back-iron window (±s)', 0.04, 0.15, 0.005],
  ['glass', 'Glass window (±s)', 0.08, 0.25, 0.005],
  ['entryAngle', 'Entry angle (°)', 40, 55, 0.5],
  ['jumpSpeed', 'Hop speed (m/s)', 2.0, 4.5, 0.1],
  ['backspin', 'Backspin (rad/s)', 0, 25, 0.5],
];

export class Tuning {
  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'tuning';
    this.root.innerHTML = `<div class="tuning-title">DRIBBLE TUNING <span>Tab to close</span></div>`;
    this._rows(FIELDS, DRIBBLE);
    const title = document.createElement('div');
    title.className = 'tuning-title';
    title.style.marginTop = '10px';
    title.textContent = 'SHOT TUNING';
    this.root.appendChild(title);
    this._rows(SHOT_FIELDS, SHOT);
    document.body.appendChild(this.root);
    this.visible = false;
    this.hide();
  }

  _rows(fields, target) {
    for (const [key, label, min, max, step] of fields) {
      const row = document.createElement('label');
      row.className = 'tuning-row';
      row.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${target[key]}"><b>${target[key]}</b>`;
      const input = row.querySelector('input');
      const val = row.querySelector('b');
      input.oninput = () => {
        target[key] = parseFloat(input.value);
        val.textContent = input.value;
      };
      this.root.appendChild(row);
    }
  }

  toggle() {
    this.visible ? this.hide() : this.show();
  }

  show() {
    this.visible = true;
    this.root.style.display = 'block';
  }

  hide() {
    this.visible = false;
    this.root.style.display = 'none';
  }
}
