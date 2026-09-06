import * as THREE from 'three';
import { dirOf } from './BounceMath.js';
import { DRIBBLE as D } from '../core/Constants.js';
import { clamp } from '../core/MathUtils.js';

/**
 * The move library. Each move is one dribble *cycle*: a CONTACT (the hand
 * carries the ball from the catch to the release along a shaped path) and the
 * FLIGHT that follows (where the ball is asked to come back up, and into
 * which hand). Combos are just cycles queued back to back.
 *
 * Frame space: x = right (+), y = up from the feet, z = forward (+).
 * `sign` is the hand currently holding the ball: +1 right, -1 left.
 *
 * A plan is:
 *   {
 *     name, label,
 *     hand: sign of the hand that carries this contact,
 *     catchHand: sign of the hand that receives the following flight,
 *     waypoints: [{ p, v?, t, dir, top? }]  (first p is overwritten with the
 *                                            actual catch point),
 *     target: Vector3   catch point of the following flight,
 *     catchDir: Vector3 hand contact direction at that catch,
 *     sway: { lateral, vertical, roll } keyframe amplitudes (signed),
 *     squeak: bool, interruptible: bool
 *   }
 */

/** Movement context passed to every planner. */
export function makeContext({ sign, speed, sprint, low, catchPos, inVel }) {
  const lead = clamp(speed * D.speedLead, 0, D.speedLeadMax);
  const height = (low ? D.lowCatchHeight : D.catchHeight) + (sprint ? D.speedHeightGain : 0);
  return {
    sign,
    speed,
    sprint,
    low,
    lead,
    fwd: low ? D.forward - 0.12 : D.forward,
    side: low ? D.side + 0.04 : D.side,
    height,
    catchPos: catchPos.clone(),
    inVel: inVel.clone(),
  };
}

const P = (x, y, z) => new THREE.Vector3(x, y, z);

/** Step a coordinate toward home but never more than `max` in one cycle. */
const toward = (from, to, max) => from + clamp(to - from, -max, max);

// ---------------------------------------------------------------------------
export const MOVES = {
  /** The default rhythm dribble. Also the speed dribble (sprint) and the low
   *  protect dribble (`low`). */
  pound(c) {
    const s = c.sign;
    const c0 = c.catchPos;
    const homeZ = c.fwd + c.lead;
    const homeX = s * c.side;
    // Height changes (hip ↔ low, walk ↔ sprint) settle over a couple of
    // cycles rather than in one violent push; big changes get a longer carry.
    const homeY = toward(c0.y, c.height, 0.22);
    const dy = Math.abs(homeY - c0.y);
    let T = c.low ? D.contactPound * 0.75 : D.contactPound;
    T *= 1 + Math.min(dy, 0.3) * 1.6;
    const absorb = c.low ? D.absorb * 0.6 : D.absorb;
    const drop = c.low ? D.releaseDrop * 0.6 : D.releaseDrop;
    const relZ = toward(c0.z, homeZ + (c.sprint ? 0.10 : 0.02), 0.32);
    const relX = toward(c0.x, homeX, 0.22);
    const topDir = dirOf(0.12, 0.92, s * 0.32);
    return {
      name: 'pound',
      label: c.sprint ? 'SPEED' : c.low ? 'LOW' : null,
      hand: s,
      catchHand: s,
      waypoints: [
        { p: c0.clone(), t: 0, dir: topDir },
        { p: P((c0.x + relX) / 2, c0.y + absorb, (c0.z + relZ) / 2), t: T * 0.42, dir: topDir, top: true },
        { p: P(relX, homeY - drop, relZ), t: T, dir: dirOf(0.05, 0.95, s * 0.28) },
      ],
      target: P(homeX, homeY, homeZ),
      catchDir: topDir,
      sway: { lateral: 0, vertical: 0, roll: 0 },
      interruptible: true,
    };
  },

  /** Crossover: carried in, snapped down across the body into the other hand. */
  crossover(c) {
    const s = c.sign;
    const c0 = c.catchPos;
    const T = D.contactCross;
    const wide = c.sprint ? 0.08 : 0.04;
    return {
      name: 'crossover',
      label: 'CROSSOVER',
      hand: s,
      catchHand: -s,
      waypoints: [
        { p: c0.clone(), t: 0, dir: dirOf(0.1, 0.72, s * 0.6) },
        { p: P(s * c.side * 0.45, c0.y + D.absorb * 0.7, c0.z + 0.05), t: T * 0.38, dir: dirOf(0.05, 0.6, s * 0.78), top: true },
        { p: P(-s * 0.04, c.height - D.releaseDrop - 0.08, c0.z + 0.08), t: T, dir: dirOf(0.05, 0.45, s * 0.88) },
      ],
      target: P(-s * (c.side + wide), c.height - 0.10, c.fwd + c.lead * 0.5 - 0.04),
      catchDir: dirOf(0.1, 0.78, -s * 0.55),
      sway: { lateral: -s, vertical: -0.5, roll: -s * 0.8 },
      squeak: true,
      interruptible: false,
    };
  },

  /** Between the legs: pushed back through the legs into the other hand. */
  between(c) {
    const s = c.sign;
    const c0 = c.catchPos;
    const T = D.contactBetween;
    const relZ = 0.30;
    return {
      name: 'between',
      label: 'BETWEEN THE LEGS',
      hand: s,
      catchHand: -s,
      waypoints: [
        { p: c0.clone(), t: 0, dir: dirOf(0.15, 0.85, s * 0.45) },
        { p: P(s * c.side * 0.85, c0.y + D.absorb * 0.8, (c0.z + relZ) / 2 + 0.05), t: T * 0.4, dir: dirOf(0.45, 0.8, s * 0.35), top: true },
        { p: P(s * 0.11, c.height - D.releaseDrop - 0.06, relZ), t: T, dir: dirOf(0.62, 0.66, s * 0.25) },
      ],
      target: P(-s * (c.side + 0.02), c.height - 0.14, -0.14),
      catchDir: dirOf(-0.25, 0.82, -s * 0.5),
      sway: { lateral: s * 0.35, vertical: -1, roll: s * 0.4 },
      squeak: true,
      interruptible: false,
    };
  },

  /** Behind the back: wrapped around the hip and flicked across. */
  behind(c) {
    const s = c.sign;
    const c0 = c.catchPos;
    const T = D.contactBehind;
    return {
      name: 'behind',
      label: 'BEHIND THE BACK',
      hand: s,
      catchHand: -s,
      waypoints: [
        { p: c0.clone(), t: 0, dir: dirOf(0.2, 0.75, s * 0.62) },
        { p: P(s * (c.side + 0.10), c0.y + D.absorb, -0.14), t: T * 0.38, dir: dirOf(0.35, 0.55, s * 0.76), top: true },
        { p: P(s * 0.10, c0.y + D.absorb * 0.4, -0.32), t: T * 0.72, dir: dirOf(-0.5, 0.5, s * 0.7) },
        { p: P(-s * 0.05, c.height - D.releaseDrop - 0.06, -0.30), t: T, dir: dirOf(-0.62, 0.42, s * 0.66) },
      ],
      target: P(-s * (c.side + 0.05), c.height - 0.10, c.fwd + c.lead * 0.4 - 0.10),
      catchDir: dirOf(0.05, 0.8, -s * 0.6),
      sway: { lateral: s * 0.6, vertical: -0.4, roll: s * 0.9 },
      squeak: true,
      interruptible: false,
    };
  },

  /** In-and-out: the hand rolls over the ball, sells a cross, keeps the hand. */
  inout(c) {
    const s = c.sign;
    const c0 = c.catchPos;
    const T = D.contactInOut;
    return {
      name: 'inout',
      label: 'IN & OUT',
      hand: s,
      catchHand: s,
      waypoints: [
        { p: c0.clone(), t: 0, dir: dirOf(0.1, 0.8, s * 0.55) },
        { p: P(s * c.side * 0.15, c0.y + D.absorb * 0.6, c0.z + 0.10), t: T * 0.45, dir: dirOf(0.1, 0.72, -s * 0.62), top: true },
        { p: P(s * c.side * 0.5, c.height - D.releaseDrop, c0.z + 0.06), t: T, dir: dirOf(0.05, 0.6, -s * 0.78) },
      ],
      target: P(s * (c.side + 0.12), c.height - 0.05, c.fwd + c.lead * 0.6),
      catchDir: dirOf(0.1, 0.78, s * 0.55),
      sway: { lateral: -s * 0.9, vertical: -0.3, roll: -s * 0.6, rebound: true },
      squeak: true,
      interruptible: false,
    };
  },

  /** Hesitation: the ball hangs on the hand, then explodes out. */
  hesitation(c) {
    const s = c.sign;
    const c0 = c.catchPos;
    const T = D.contactHesi;
    const hangDir = dirOf(0.15, 0.55, s * 0.8);
    return {
      name: 'hesitation',
      label: 'HESITATION',
      hand: s,
      catchHand: s,
      waypoints: [
        { p: c0.clone(), t: 0, dir: dirOf(0.1, 0.85, s * 0.45) },
        { p: P(s * (c.side + 0.03), c0.y + D.absorb + 0.09, c0.z + 0.04), t: T * 0.3, dir: hangDir, top: true },
        { p: P(s * (c.side + 0.04), c0.y + D.absorb + 0.085, c0.z + 0.10), t: T * 0.7, dir: hangDir, top: true },
        { p: P(s * c.side, c.height - D.releaseDrop - 0.02, c0.z + 0.16), t: T, dir: dirOf(0.05, 0.9, s * 0.4) },
      ],
      target: P(s * c.side, c.height, c.fwd + c.lead + 0.18),
      catchDir: dirOf(0.12, 0.92, s * 0.32),
      sway: { lateral: s * 0.25, vertical: 0.9, roll: 0, hold: true },
      squeak: false,
      interruptible: false,
    };
  },

  /** Step-back: a crossover-style snap while hopping backward. */
  stepback(c) {
    const s = c.sign;
    const c0 = c.catchPos;
    const T = D.contactCross + 0.04;
    return {
      name: 'stepback',
      label: 'STEP-BACK',
      hand: s,
      catchHand: -s,
      waypoints: [
        { p: c0.clone(), t: 0, dir: dirOf(0.3, 0.7, s * 0.6) },
        { p: P(s * c.side * 0.4, c0.y + D.absorb * 0.7, c0.z - 0.02), t: T * 0.4, dir: dirOf(0.4, 0.55, s * 0.7), top: true },
        { p: P(-s * 0.02, c.height - D.releaseDrop - 0.06, c0.z - 0.14), t: T, dir: dirOf(0.5, 0.45, s * 0.7) },
      ],
      target: P(-s * (c.side + 0.05), c.height - 0.06, c.fwd - 0.12),
      catchDir: dirOf(0.1, 0.8, -s * 0.55),
      sway: { lateral: -s * 0.4, vertical: -0.8, roll: -s * 0.5 },
      squeak: true,
      hop: true,
      interruptible: false,
    };
  },
};

export const MOVE_ORDER = ['crossover', 'between', 'behind', 'inout', 'hesitation', 'stepback'];
