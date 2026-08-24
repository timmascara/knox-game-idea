import * as THREE from 'three';

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const randRange = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(randRange(a, b + 1));

/** Framerate-independent exponential smoothing for THREE.Vector3 (in place). */
export function dampVec3(current, target, lambda, dt) {
  const t = 1 - Math.exp(-lambda * dt);
  current.x = lerp(current.x, target.x, t);
  current.y = lerp(current.y, target.y, t);
  current.z = lerp(current.z, target.z, t);
  return current;
}

/**
 * Solve a ballistic launch velocity that carries a projectile from `from` to
 * `to` under gravity `g` (negative), reaching an apex `apexHeight` above the
 * higher of the two endpoints. Returns a THREE.Vector3 velocity, or null if
 * no real solution exists.
 *
 * This is what makes shots arc believably: we pick a peak height and let the
 * time-of-flight fall out of the vertical kinematics, then solve the
 * horizontal velocity to cover the ground distance in that time.
 */
export function solveArc(from, to, apexHeight, g = -9.81) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dy = to.y - from.y;

  const peak = Math.max(from.y, to.y) + apexHeight;
  const riseFromStart = peak - from.y;
  if (riseFromStart <= 0.001) return null;

  // Time from launch to apex, then apex to target.
  const vUp = Math.sqrt(-2 * g * riseFromStart);
  const tUp = vUp / -g;
  // Height to fall from apex to target.
  const fall = peak - to.y;
  if (fall < 0) return null;
  const tDown = Math.sqrt((2 * fall) / -g);
  const tTotal = tUp + tDown;
  if (tTotal <= 0.0001) return null;

  return new THREE.Vector3(dx / tTotal, vUp, dz / tTotal);
}

/** Signed shortest angle between two radians. */
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

const _v = new THREE.Vector3();
/** Horizontal (XZ) distance between two Vector3-like objects. */
export function planarDistance(a, b) {
  _v.set(a.x - b.x, 0, a.z - b.z);
  return _v.length();
}
