import * as THREE from 'three';

/**
 * Pure math for the dribble. Everything here works in the *handle frame* —
 * a body-relative space (x = right, y = up from the feet, z = forward) that
 * the controller transforms to world every frame.
 *
 * A dribble is an alternating sequence of two segment types:
 *
 *   FLIGHT   The ball is out of the hand: a real ballistic drop, a floor
 *            bounce (vertical restitution + a little horizontal loss), and a
 *            ballistic rise into the next catch point. Solved so the ball
 *            arrives at the requested catch point still rising slightly —
 *            the hand meets a rising ball, exactly like a real dribble.
 *
 *   CONTACT  The ball is in the hand: a piecewise cubic Hermite path through
 *            a few waypoints (catch → absorb/carry → release). Endpoint
 *            velocities are the neighbouring flights' velocities, so the ball
 *            never snaps: position AND velocity are continuous through the
 *            whole cycle.
 */
const G = 9.81;

export class Flight {
  /**
   * @param {THREE.Vector3} A release point (frame space)
   * @param {THREE.Vector3} B desired catch point (frame space)
   * @param {object} o { floor, restitution, horizontalKeep, catchRiseSpeed }
   */
  constructor(A, B, o) {
    this.A = A.clone();
    this.B = B.clone();
    const floor = o.floor;
    const e = o.restitution;
    const k = o.horizontalKeep;
    const yA = Math.max(A.y, floor + 0.04);
    let yB = Math.max(B.y, floor + 0.04);

    // Rebound speed needed to reach the hand still rising at catchRiseSpeed.
    let vu = Math.sqrt(2 * G * (yB - floor) + o.catchRiseSpeed ** 2);
    let vf = vu / e; // floor impact speed required
    const freeFall2 = 2 * G * (yA - floor);
    let vPush = vf * vf - freeFall2;
    if (vPush > 0) {
      vPush = Math.sqrt(vPush);
    } else {
      // A plain drop already hits harder than needed: no push, and the ball
      // comes up faster than asked. Accept it (catch a little sooner).
      vPush = 0;
      vf = Math.sqrt(freeFall2);
      vu = e * vf;
      const reach = floor + (vu * vu) / (2 * G);
      if (reach - 0.02 < yB) yB = Math.max(floor + 0.04, reach - 0.02);
    }
    const t1 = (vf - vPush) / G;
    const rise2 = Math.max(0, vu * vu - 2 * G * (yB - floor));
    const t2 = (vu - Math.sqrt(rise2)) / G;

    this.floor = floor;
    this.yA = yA;
    this.yB = yB;
    this.vPush = vPush;
    this.vf = vf;
    this.vu = vu;
    this.k = k;
    this.t1 = t1;
    this.t2 = t2;
    this.T = t1 + t2;
    this.catchRise = Math.sqrt(rise2);

    const denom = Math.max(1e-4, t1 + k * t2);
    this.vh = new THREE.Vector2((B.x - A.x) / denom, (B.z - A.z) / denom);
    this.C = new THREE.Vector2(A.x + this.vh.x * t1, A.z + this.vh.y * t1); // floor contact
    this.B.y = yB;
    this.bounced = false;
  }

  /** Velocity at release (frame space). */
  releaseVelocity(out = new THREE.Vector3()) {
    return out.set(this.vh.x, -this.vPush, this.vh.y);
  }

  /** Velocity at the catch (frame space). */
  catchVelocity(out = new THREE.Vector3()) {
    return out.set(this.vh.x * this.k, this.catchRise, this.vh.y * this.k);
  }

  positionAt(t, out = new THREE.Vector3()) {
    if (t <= this.t1) {
      out.x = this.A.x + this.vh.x * t;
      out.z = this.A.z + this.vh.y * t;
      out.y = this.yA - this.vPush * t - 0.5 * G * t * t;
    } else {
      const tau = Math.min(t, this.T) - this.t1;
      out.x = this.C.x + this.vh.x * this.k * tau;
      out.z = this.C.y + this.vh.y * this.k * tau;
      out.y = this.floor + this.vu * tau - 0.5 * G * tau * tau;
    }
    return out;
  }

  velocityAt(t, out = new THREE.Vector3()) {
    if (t <= this.t1) {
      out.set(this.vh.x, -this.vPush - G * t, this.vh.y);
    } else {
      const tau = Math.min(t, this.T) - this.t1;
      out.set(this.vh.x * this.k, this.vu - G * tau, this.vh.y * this.k);
    }
    return out;
  }
}

/**
 * Piecewise cubic Hermite through waypoints [{ p: Vector3, v: Vector3|null,
 * t: seconds, dir: Vector3 (hand contact direction), top: bool }]. Missing
 * intermediate velocities are filled with Catmull-Rom tangents (vertical
 * zeroed on `top` waypoints so the ball visibly settles before the push).
 */
export class Contact {
  constructor(waypoints) {
    this.w = waypoints;
    const n = waypoints.length;
    for (let i = 0; i < n; i++) {
      const wp = waypoints[i];
      if (wp.v) continue;
      if (i === 0 || i === n - 1) {
        wp.v = new THREE.Vector3();
        continue;
      }
      const a = waypoints[i - 1];
      const b = waypoints[i + 1];
      const v = new THREE.Vector3().subVectors(b.p, a.p).divideScalar(Math.max(1e-4, b.t - a.t));
      if (wp.top) v.y = 0;
      wp.v = v;
    }
    this.T = waypoints[n - 1].t;
  }

  _seg(t) {
    const w = this.w;
    let i = 0;
    while (i < w.length - 2 && t > w[i + 1].t) i++;
    return i;
  }

  positionAt(t, out = new THREE.Vector3()) {
    const w = this.w;
    t = Math.max(0, Math.min(this.T, t));
    const i = this._seg(t);
    const a = w[i];
    const b = w[i + 1];
    const dt = Math.max(1e-4, b.t - a.t);
    const s = (t - a.t) / dt;
    const s2 = s * s;
    const s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1;
    const h10 = s3 - 2 * s2 + s;
    const h01 = -2 * s3 + 3 * s2;
    const h11 = s3 - s2;
    out.set(0, 0, 0);
    out.addScaledVector(a.p, h00);
    out.addScaledVector(a.v, h10 * dt);
    out.addScaledVector(b.p, h01);
    out.addScaledVector(b.v, h11 * dt);
    return out;
  }

  velocityAt(t, out = new THREE.Vector3()) {
    const w = this.w;
    t = Math.max(0, Math.min(this.T, t));
    const i = this._seg(t);
    const a = w[i];
    const b = w[i + 1];
    const dt = Math.max(1e-4, b.t - a.t);
    const s = (t - a.t) / dt;
    const s2 = s * s;
    const d00 = (6 * s2 - 6 * s) / dt;
    const d10 = 3 * s2 - 4 * s + 1;
    const d01 = (-6 * s2 + 6 * s) / dt;
    const d11 = 3 * s2 - 2 * s;
    out.set(0, 0, 0);
    out.addScaledVector(a.p, d00);
    out.addScaledVector(a.v, d10);
    out.addScaledVector(b.p, d01);
    out.addScaledVector(b.v, d11);
    return out;
  }

  /** Hand contact direction (unit), blended between waypoints. */
  dirAt(t, out = new THREE.Vector3()) {
    const w = this.w;
    t = Math.max(0, Math.min(this.T, t));
    const i = this._seg(t);
    const a = w[i];
    const b = w[i + 1];
    const s = (t - a.t) / Math.max(1e-4, b.t - a.t);
    const k = s * s * (3 - 2 * s);
    out.copy(a.dir).lerp(b.dir, k);
    if (out.lengthSq() < 1e-6) out.set(0, 1, 0);
    return out.normalize();
  }
}

/** Frame-space helpers. */
export const up = new THREE.Vector3(0, 1, 0);
export const dirOf = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
