import { SHOT } from '../core/Constants.js';

/**
 * The 2K-style shot meter: a slim vertical bar beside the crosshair that
 * fills from the moment a jumper starts. The tiny green band is the ideal
 * release; the bands either side of it are the deterministic outcomes for
 * releasing early or late — back iron, off the glass, airball. On button-up
 * the fill freezes with a marker at the release point and the zone it landed
 * in lights up, then the whole thing fades.
 *
 * Drawn on a canvas so the bands are exact fractions of the timeline.
 */
const COLORS = {
  green: '#46c66b',
  iron: '#e7c93c',
  glass: '#e8892a',
  air: '#e0483a',
  front: '#e0483a',
};

export class ShotMeter {
  constructor(parent) {
    this.el = document.createElement('canvas');
    this.el.className = 'shot-meter';
    this.w = 22;
    this.h = 180;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.el.width = Math.round(this.w * this.dpr);
    this.el.height = Math.round(this.h * this.dpr);
    this.el.style.width = `${this.w}px`;
    this.el.style.height = `${this.h}px`;
    parent.appendChild(this.el);
    this.ctx = this.el.getContext('2d');
    this.ctx.scale(this.dpr, this.dpr);

    this.state = 'hidden';
    this.u = 0;
    this.releaseU = null;
    this.zone = null;
    this.timer = 0;
    this.spec = { releaseTime: SHOT.releaseTime, meterTime: SHOT.meterTime, zones: [[SHOT.green, 'green'], [SHOT.iron, 'iron'], [SHOT.glass, 'glass'], [Infinity, 'air']] };
    this._bands = this._computeBands(this.spec);
  }

  /**
   * Bands as [u0, u1, zone] along the meter (u = t / meterTime), from a spec
   * { releaseTime, meterTime, zones: [[maxAbsError, zone] …] } listed outward
   * from the ideal; the last zone's error may be Infinity.
   */
  _computeBands(spec) {
    const k = 1 / spec.meterTime;
    const ui = spec.releaseTime * k;
    const bands = [];
    let inner = 0;
    for (const [maxErr, zone] of spec.zones) {
      const outer = Number.isFinite(maxErr) ? maxErr * k : Infinity;
      bands.push([Math.max(0, ui - Math.min(outer, ui)), ui - inner, zone]); // early side
      bands.push([ui + inner, Math.min(1, ui + outer), zone]); // late side
      inner = outer;
      if (!Number.isFinite(maxErr)) break;
    }
    return bands.filter(([a, b]) => b > a);
  }

  /** Start filling. `spec` (see _computeBands) describes this kind of shot. */
  show(spec = null) {
    if (spec) {
      this.spec = spec;
      this._bands = this._computeBands(spec);
    }
    this.state = 'active';
    this.u = 0;
    this.releaseU = null;
    this.zone = null;
    this.timer = 0;
    this.el.style.opacity = '1';
    this.draw();
  }

  set(u) {
    if (this.state !== 'active') return;
    this.u = Math.max(0, Math.min(1, u));
    this.draw();
  }

  release(u, zone) {
    this.state = 'result';
    this.releaseU = Math.max(0, Math.min(1, u));
    this.u = this.releaseU;
    this.zone = zone;
    this.timer = 0;
    this.draw();
  }

  hide() {
    this.state = 'hidden';
    this.el.style.opacity = '0';
  }

  update(dt) {
    if (this.state === 'result') {
      this.timer += dt;
      if (this.timer > 1.25) this.hide();
    }
  }

  draw() {
    const c = this.ctx;
    const w = this.w;
    const h = this.h;
    const pad = 3;
    const bx = pad;
    const bw = w - pad * 2;
    const top = pad;
    const bh = h - pad * 2;
    c.clearRect(0, 0, w, h);

    // Track.
    c.fillStyle = 'rgba(8, 12, 14, 0.62)';
    this._round(c, 0, 0, w, h, 6);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.18)';
    c.lineWidth = 1;
    this._round(c, 0.5, 0.5, w - 1, h - 1, 6);
    c.stroke();

    // Zone bands (u = 0 at the bottom).
    const yOf = (u) => top + bh * (1 - u);
    for (const [u0, u1, zone] of this._bands) {
      const lit = this.state === 'result' ? (zone === this.zone && this.releaseU >= u0 && this.releaseU <= u1) : true;
      const a = zone === 'green' ? (lit ? 0.95 : 0.35) : lit ? (this.state === 'result' ? 0.9 : 0.42) : 0.14;
      c.fillStyle = this._rgba(COLORS[zone], a);
      const y1 = yOf(u1);
      const y0 = yOf(u0);
      c.fillRect(bx, y1, bw, Math.max(1, y0 - y1));
    }
    // Ideal line through the green.
    const ui = this.spec.releaseTime / this.spec.meterTime;
    c.fillStyle = 'rgba(255,255,255,0.75)';
    c.fillRect(bx, yOf(ui) - 0.5, bw, 1);

    // Fill and marker.
    if (this.state !== 'hidden') {
      const y = yOf(this.u);
      c.fillStyle = 'rgba(255,255,255,0.22)';
      c.fillRect(bx, y, bw, top + bh - y);
      const isResult = this.state === 'result';
      c.fillStyle = isResult ? COLORS[this.zone] || '#fff' : '#ffffff';
      c.fillRect(bx - 2, y - (isResult ? 2 : 1), bw + 4, isResult ? 4 : 2);
      if (isResult) {
        c.strokeStyle = 'rgba(0,0,0,0.5)';
        c.strokeRect(bx - 2.5, y - 2.5, bw + 5, 5);
      }
    }
  }

  _round(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }

  _rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
}
