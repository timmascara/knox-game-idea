import * as THREE from 'three';
import { GRADE, SHOT, GRAVITY, BALL } from '../core/Constants.js';
import { solveArc, clamp, lerp } from '../core/MathUtils.js';

/** Scale horizontal launch speed to cancel the ball's linear damping over the
 * flight, so a solved arc actually lands where solveArc intended. */
function dragCompensate(vel, dist) {
  const d = BALL.linearDamping;
  const horiz = Math.hypot(vel.x, vel.z) || 0.1;
  const T = dist / horiz;
  const dT = d * T;
  const comp = dT > 1e-4 ? dT / (1 - Math.exp(-dT)) : 1;
  vel.x *= comp;
  vel.z *= comp;
  return vel;
}

/**
 * Pure shot maths: timing → grade, and (grade, geometry) → a launch velocity.
 *
 * The philosophy: we compute the *ideal* launch that would swish, then perturb
 * the aim point by an amount that grows with worse timing and with distance.
 * From there the ball is a free physics object — makes, backboard banks, rim
 * rattles, misses and airballs all emerge from the simulation rather than being
 * scripted.
 */
export class Shot {
  /** Absolute timing error (s from ideal release) → grade. */
  static grade(errAbs) {
    if (errAbs <= SHOT.green) return GRADE.GREEN;
    if (errAbs <= SHOT.yellow) return GRADE.YELLOW;
    if (errAbs <= SHOT.orange) return GRADE.ORANGE;
    if (errAbs <= SHOT.red) return GRADE.RED;
    return GRADE.EXTREME;
  }

  static gradeErrorScale(grade) {
    switch (grade) {
      case GRADE.GREEN: return 0.035;
      case GRADE.YELLOW: return 0.10;
      case GRADE.ORANGE: return 0.155; // "possible make or miss"
      case GRADE.RED: return 0.26; // "mostly misses"
      default: return 0.5; // extreme — occasional make, frequent airball
    }
  }

  /**
   * Build a launch for a jump shot.
   * @param from THREE.Vector3 release position
   * @param rim THREE.Vector3 rim centre
   * @param grade grade string
   * @param signedErr signed timing error (negative = early, positive = late)
   * @param playerVel THREE.Vector3 player horizontal velocity at release
   */
  static jumpShot(from, rim, grade, signedErr, playerVel = new THREE.Vector3()) {
    const flat = new THREE.Vector3(rim.x - from.x, 0, rim.z - from.z);
    const dist = flat.length();
    const distFactor = 1 + dist / 7.5;

    // Aim at (slightly past) the rim centre and let the ball drop in from
    // above. Aiming a hair long compensates for the small vertical-damping
    // shortfall so a clean arc drops through the middle rather than the front
    // rim.
    const dir = flat.clone().normalize();
    const aim = rim.clone().addScaledVector(dir, 0.06);
    aim.y = rim.y + 0.03;

    // Perturb aim by timing + distance.
    const scale = Shot.gradeErrorScale(grade) * distFactor;
    const side = new THREE.Vector3(-dir.z, 0, dir.x); // left/right
    // Early tends short, late tends long — bias depth by sign of error.
    const depthBias = clamp(signedErr * 6, -1, 1);
    const rand = () => (Math.random() * 2 - 1);
    aim.addScaledVector(side, rand() * scale);
    aim.addScaledVector(dir, (rand() * 0.5 + depthBias * 0.6) * scale);
    aim.y += rand() * scale * 0.5;

    // Apex scales with distance for a believable rainbow on longer shots.
    let apex = lerp(SHOT.minApex, SHOT.maxApex, clamp(dist / 9, 0, 1));
    apex += rand() * scale * 0.4;

    // Extreme early can produce an airball: shorten the shot.
    let velScale = 1;
    if (grade === GRADE.EXTREME && signedErr < 0) velScale = 0.72;

    let vel = solveArc(from, aim, apex, GRAVITY);
    if (!vel) vel = new THREE.Vector3(dir.x * 4, 5, dir.z * 4);
    dragCompensate(vel, dist);
    vel.multiplyScalar(velScale);

    // Carry a little of the player's momentum into the shot.
    vel.x += playerVel.x * 0.18;
    vel.z += playerVel.z * 0.18;

    // Backspin about the left/right axis.
    const spin = side.clone().multiplyScalar(-9);
    return { vel, spin, dist };
  }

  /** A layup toss — lower arc, aimed to kiss the backboard or drop softly. */
  static layup(from, rim, shootDir, grade, useBackboard) {
    const aim = rim.clone();
    if (useBackboard) {
      // Aim at a spot on the backboard just above the rim.
      aim.addScaledVector(shootDir, -0.18);
      aim.y = rim.y + 0.16;
    } else {
      aim.y = rim.y + 0.04;
    }
    const scale = Shot.gradeErrorScale(grade) * 0.7;
    const side = new THREE.Vector3(-shootDir.z, 0, shootDir.x);
    const rand = () => (Math.random() * 2 - 1);
    aim.addScaledVector(side, rand() * scale);
    aim.y += rand() * scale * 0.5;

    let vel = solveArc(from, aim, 0.75 + Math.random() * 0.25, GRAVITY);
    if (!vel) {
      const d = new THREE.Vector3().subVectors(aim, from).normalize();
      vel = d.multiplyScalar(4).setY(4);
    }
    dragCompensate(vel, from.distanceTo(aim));
    const spin = side.clone().multiplyScalar(-7);
    return { vel, spin };
  }
}
