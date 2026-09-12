import * as THREE from 'three';
import { SHOT, HOOP, BALL } from '../core/Constants.js';
import { clamp } from '../core/MathUtils.js';

/**
 * Pure shot maths. Nothing here touches the scene: the controller feeds it
 * world-space points and gets back launch velocities, aim points and a
 * verdict on where the release landed on the meter.
 *
 * The launch is a closed-form ballistic solve that includes Rapier's linear
 * damping, so the ball flies exactly where it is aimed (validated in the
 * headless harness to ~5 mm at the rim). The arc is defined by its *entry
 * angle* at the rim rather than an apex height — that is how shooters
 * actually keep the same shape from every distance, and a 47° entry is what
 * makes a centred ball drop cleanly through a 45 cm rim.
 */
const G = 9.81;
const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);

/** Where a release landed on the meter, from its signed timing error. */
export const ZONE = { GREEN: 'green', IRON: 'iron', GLASS: 'glass', AIR: 'air', FRONT: 'front' };

export function zoneFor(err) {
  const e = Math.abs(err);
  if (e <= SHOT.green) return ZONE.GREEN;
  if (e <= SHOT.iron) return ZONE.IRON;
  if (e <= SHOT.glass) return ZONE.GLASS;
  return ZONE.AIR;
}

/** Layups: a wide make window (narrow when contested), otherwise the front iron. */
export function zoneForLayup(err, contested = false) {
  const w = contested ? SHOT.layupContestedWindow : SHOT.layupWindow;
  return Math.abs(err) <= w ? ZONE.GREEN : ZONE.FRONT;
}

/** The meter's band layout for each kind of shot: [maxAbsError, zone] outward from the ideal. */
export function meterSpec(kind, contested = false) {
  if (kind === 'layup') {
    return {
      releaseTime: SHOT.layupReleaseTime,
      meterTime: SHOT.layupMeterTime,
      zones: [[contested ? SHOT.layupContestedWindow : SHOT.layupWindow, ZONE.GREEN], [Infinity, ZONE.FRONT]],
    };
  }
  return {
    releaseTime: SHOT.releaseTime,
    meterTime: SHOT.meterTime,
    zones: [[SHOT.green, ZONE.GREEN], [SHOT.iron, ZONE.IRON], [SHOT.glass, ZONE.GLASS], [Infinity, ZONE.AIR]],
  };
}

export const ZONE_LABEL = {
  [ZONE.GREEN]: 'SWISH',
  [ZONE.IRON]: 'BACK IRON',
  [ZONE.GLASS]: 'OFF THE GLASS',
  [ZONE.AIR]: 'AIRBALL',
  [ZONE.FRONT]: 'FRONT RIM',
};

/**
 * Launch velocity (world) that carries a ball from `from` to `to`, arriving
 * `entryDeg` below horizontal, under gravity and linear damping `k` (Rapier's
 * per-second linear damping coefficient). Returns null only if the geometry
 * is impossible (target below the launch with a negative entry angle).
 *
 * With damping v' = a − k v the position is closed-form:
 *   x(T) = x0 + vx0 · E,            E = (1 − e^{−kT}) / k
 *   y(T) = y0 + (a/k) T + (vy0 − a/k) · E
 * The flight time comes from the undamped entry-angle condition, which is
 * within a fraction of a degree of the damped one at these speeds.
 */
export function solveLaunch(from, to, entryDeg = SHOT.entryAngle, k = BALL.linearDamping, out = new THREE.Vector3()) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dy = to.y - from.y;
  const D = Math.hypot(dx, dz);
  const tanE = Math.tan(entryDeg * DEG);
  const T2 = (2 * (dy + D * tanE)) / G;
  if (T2 <= 1e-6) return null;
  const T = Math.sqrt(T2);
  const E = k > 1e-6 ? (1 - Math.exp(-k * T)) / k : T;
  const a = -G;
  const vh = D > 1e-6 ? D / E : 0;
  const vy = k > 1e-6 ? a / k + (dy - (a / k) * T) / E : (dy + 0.5 * G * T * T) / T;
  out.set(D > 1e-6 ? (vh * dx) / D : 0, vy, D > 1e-6 ? (vh * dz) / D : 0);
  out.flightTime = T;
  return out;
}

/**
 * The aim point and entry angle for a release in `zone`, shooting from
 * `from` at `hoop`. `err` is the signed timing error (negative = early).
 * Every zone is a deliberate, deterministic target: the physics then does
 * the rest (the back rim kicks the ball out, the glass carom drops it on
 * the near rim, the airball falls short of everything).
 */
export function aimFor(zone, err, hoop, from, kind = 'jumper') {
  const rim = hoop.rimCenter;
  const dir = new THREE.Vector3(rim.x - from.x, 0, rim.z - from.z);
  const dist = dir.length();
  if (dist < 1e-3) dir.set(0, 0, -1);
  else dir.divideScalar(dist);
  const side = new THREE.Vector3().crossVectors(dir, UP); // shooter's right
  const late = err > 0;
  const aim = rim.clone();
  let entry = SHOT.entryAngle;

  switch (zone) {
    case ZONE.GREEN:
      aim.addScaledVector(dir, SHOT.swishDepth);
      break;
    case ZONE.IRON:
      // The ball's centre crosses the rim plane just past the back tube, so
      // it meets the top of the back iron on the way down and pops out long.
      aim.addScaledVector(dir, HOOP.rimRadius + SHOT.ironDepth);
      break;
    case ZONE.GLASS: {
      // Hit the board above the square, off to one side, so the carom lands
      // on the rim and falls away. Aimed in board space so it holds from the
      // wing as well as from straight on. Early releases hit a touch lower.
      const bn = hoop.getShootDir(); // board normal, toward the court
      const bs = new THREE.Vector3().crossVectors(bn, UP);
      // Always the far side of the board from the shooter: the carom then
      // lands outside the far rim tube and kicks away. (On the near side it
      // drops back onto the iron and too often rattles in.)
      const shooterSide = Math.sign(bs.dot(new THREE.Vector3(from.x - rim.x, 0, from.z - rim.z))) || 1;
      aim.addScaledVector(bn, -(hoop.boardFrontOffset - BALL.radius));
      aim.addScaledVector(bs, -SHOT.glassSide * shooterSide);
      aim.y = rim.y + SHOT.glassHeight - (late ? 0 : 0.08);
      break;
    }
    case ZONE.FRONT:
      // A missed layup: short, onto the front iron, which kicks it away.
      aim.addScaledVector(dir, -(HOOP.rimRadius + SHOT.frontDepth));
      break;
    case ZONE.AIR:
    default:
      aim.addScaledVector(dir, -(HOOP.rimRadius + SHOT.airShort));
      aim.y = rim.y - SHOT.airDrop;
      entry = late ? SHOT.entryAngleLate : SHOT.entryAngleEarly;
      break;
  }
  // Close to the basket a fixed entry angle gives a low, flat arc that
  // cannot clear the front iron, so each outcome asks for a minimum apex
  // above the rim instead: a swish must rise well above the rim and drop
  // in steeply; a back-iron miss comes in flat so the kick carries it back
  // out over the front.
  if (zone === ZONE.GREEN) entry = entryFor(from, aim, entry, kind === 'layup' ? SHOT.layupMinApex : SHOT.minApexSwish);
  else if (zone === ZONE.IRON) entry = entryFor(from, aim, entry, SHOT.minApexIron);
  else if (zone === ZONE.GLASS) entry = entryFor(from, aim, entry, 0.12);
  else if (zone === ZONE.FRONT) entry = entryFor(from, aim, entry, 0.3);
  return { aim, entry, dir, side, dist };
}

/**
 * The entry angle (degrees) that reaches `to` from `from` with the natural
 * `entryDeg` arc, unless that arc would peak less than `minApex` above the
 * target — then the angle of the arc that peaks exactly `minApex` above it.
 */
export function entryFor(from, to, entryDeg, minApex) {
  const D = Math.hypot(to.x - from.x, to.z - from.z);
  const dy = to.y - from.y;
  const tanE = Math.tan(entryDeg * DEG);
  const T2 = (2 * (dy + D * tanE)) / G;
  if (T2 > 1e-6) {
    const vx = D / Math.sqrt(T2);
    const h = (vx * tanE) ** 2 / (2 * G);
    if (h >= minApex) return entryDeg;
  }
  const tUp = Math.sqrt((2 * Math.max(0.01, dy + minApex)) / G);
  const tDown = Math.sqrt((2 * minApex) / G);
  const vx = D / (tUp + tDown);
  const vyE = Math.sqrt(2 * G * minApex);
  return Math.atan2(vyE, Math.max(vx, 1e-4)) / DEG;
}

/**
 * Tracks a shot after release: rim / board / court contacts (fed in from the
 * physics contact events) and the two-stage make detector. A make is
 * *pending* when the ball descends through the rim plane inside the hoop,
 * *confirmed* once it is clearly below, and cancelled if it pops back up.
 * Resolves to one of: swish, made, iron, glass, air, miss.
 */
export class ShotTracker {
  constructor(hoop, zone, meta = {}) {
    this.hoop = hoop;
    this.zone = zone;
    this.meta = meta;
    this.rimHits = 0;
    this.boardHits = 0;
    this.courtHits = 0;
    this.pending = false;
    this.clean = true; // untouched by rim or board so far
    this.made = false;
    this.result = null;
    this.timer = 0;
    this.prevY = null;
    this.rimPlaneOffset = null; // where the centre crossed the rim plane (for tests)
  }

  contact(tag) {
    if (this.result) return;
    if (tag === 'rim') {
      this.rimHits++;
      if (!this.made) this.clean = false;
    } else if (tag === 'backboard') {
      this.boardHits++;
      if (!this.made) this.clean = false;
    } else if (tag === 'court') {
      this.courtHits++;
    }
  }

  /** Returns the result string once the shot is decided, else null. */
  update(dt, pos, vel) {
    if (this.result) return this.result;
    this.timer += dt;
    const rim = this.hoop.rimCenter;
    const horiz = Math.hypot(pos.x - rim.x, pos.z - rim.z);

    if (!this.made) {
      if (this.prevY !== null && !this.pending && this.prevY > rim.y && pos.y <= rim.y && horiz < HOOP.rimRadius * 0.92 && vel.y < 0) {
        this.pending = true;
        const s = (this.prevY - rim.y) / Math.max(1e-6, this.prevY - pos.y);
        this.rimPlaneOffset = horiz * (1 - s) + (this._prevHoriz ?? horiz) * s;
      }
      if (this.pending) {
        if (pos.y > rim.y + 0.05) this.pending = false; // rattled back out
        else if (pos.y < rim.y - 0.16 && horiz < HOOP.rimRadius + BALL.radius) {
          this.made = true;
          this.result = this.clean ? 'swish' : 'made';
        }
      }
    }
    this.prevY = pos.y;
    this._prevHoriz = horiz;
    if (this.result) return this.result;

    // A miss is certain once the ball is on its way down, well below the
    // rim and outside the hoop (or inside it without ever having crossed the
    // plane from above), or once it has touched the court, or after a long
    // time. Never before the apex: a low, early release starts below the rim.
    const descending = vel.y < 0;
    const lowOutside = descending && pos.y < rim.y - 0.3 && (horiz > HOOP.rimRadius + BALL.radius || !this.pending);
    if (this.courtHits > 0 || lowOutside || this.timer > 8) {
      if (this.boardHits > 0) this.result = 'glass';
      else if (this.rimHits > 0) this.result = this.zone === ZONE.FRONT ? 'front' : 'iron';
      else this.result = 'air';
    }
    return this.result;
  }
}

export const RESULT_LABEL = {
  swish: 'SWISH',
  made: 'BUCKET',
  iron: 'BACK IRON',
  front: 'FRONT RIM',
  glass: 'OFF THE GLASS',
  air: 'AIRBALL',
  miss: 'MISS',
};

/** Yaw that faces a world point from another (the frame's yaw convention). */
export function yawToward(from, to) {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

export { clamp };
