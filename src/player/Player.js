import * as THREE from 'three';
import { PLAYER, GROUP } from '../core/Constants.js';
import { clamp } from '../core/MathUtils.js';

/**
 * First-person player built on a Rapier kinematic capsule + character
 * controller (collide-and-slide, autostep, ground snap). Movement uses real
 * acceleration/deceleration so walking, running and sprinting feel distinct,
 * with gravity for the little step-back hop. The controller pushes dynamic
 * bodies, so bumping the ball nudges it.
 */
export class Player {
  constructor(physics, spawn = new THREE.Vector3(0, 0, 8)) {
    this.physics = physics;
    const { RAPIER } = physics;

    this.radius = PLAYER.radius;
    this.halfHeight = (PLAYER.height - 2 * PLAYER.radius) / 2;
    this.centerOffset = this.halfHeight + this.radius; // feet -> capsule centre

    // Kinematic body at capsule centre.
    const startCenter = new THREE.Vector3(spawn.x, spawn.y + this.centerOffset, spawn.z);
    this.body = physics.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(startCenter.x, startCenter.y, startCenter.z)
    );
    this.collider = physics.createCollider(
      RAPIER.ColliderDesc.capsule(this.halfHeight, this.radius)
        .setCollisionGroups((GROUP.PLAYER << 16) | (GROUP.WORLD | GROUP.BALL))
        .setFriction(0.0),
      this.body
    );

    this.controller = physics.world.createCharacterController(0.02);
    this.controller.enableAutostep(PLAYER.stepHeight, this.radius * 0.5, true);
    this.controller.enableSnapToGround(0.35);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(80);
    this.controller.setSlideEnabled(true);

    this.velocity = new THREE.Vector3(); // horizontal m/s
    this.vy = 0; // vertical m/s
    this.grounded = false;
    this.wasGrounded = false;
    this.feet = spawn.clone();
    this.planarSpeed = 0;
    this.sprinting = false;
    this.moveDir = new THREE.Vector3(0, 0, 1);
    this.lastLandImpact = 0;
    // Optional predicate: colliders the character controller must not be
    // blocked by (the ball while it is in your hands).
    this.ignoreCollider = null;
    // While a shot plays the body is committed: movement input is ignored.
    this.lockMove = false;
  }

  get position() {
    return this.feet;
  }

  /** Eye/handling position in world space. */
  get eyePosition() {
    return new THREE.Vector3(this.feet.x, this.feet.y + PLAYER.eyeHeight, this.feet.z);
  }

  update(dt, input, cam) {
    const axis = this.lockMove ? { x: 0, z: 0, magnitude: 0 } : input.moveAxis();
    const wantSprint = !this.lockMove && (input.isDown('ShiftLeft') || input.isDown('ShiftRight'));
    this.sprinting = wantSprint && axis.z > 0.1 && axis.magnitude > 0.1;

    // Desired horizontal velocity in world space from camera-relative input.
    const fwd = cam.forward();
    const right = cam.right();
    const wish = new THREE.Vector3()
      .addScaledVector(fwd, axis.z)
      .addScaledVector(right, axis.x);
    const wishLen = wish.length();
    if (wishLen > 0) wish.multiplyScalar(1 / wishLen);

    let maxSpeed = PLAYER.walkSpeed;
    if (axis.magnitude > 0.1) maxSpeed = this.sprinting ? PLAYER.sprintSpeed : PLAYER.runSpeed;
    const targetVel = wish.multiplyScalar(wishLen > 0 ? maxSpeed * axis.magnitude : 0);

    // Accelerate / decelerate toward target (air control is weaker).
    const accel = this.grounded
      ? (targetVel.lengthSq() > this.velocity.lengthSq() ? PLAYER.accel : PLAYER.deaccel)
      : PLAYER.airAccel;
    this.velocity.x = this._approach(this.velocity.x, targetVel.x, accel * dt);
    this.velocity.z = this._approach(this.velocity.z, targetVel.z, accel * dt);

    // Vertical
    if (this.grounded && this.vy <= 0) {
      this.vy = -1.0; // small stick to keep grounded on slopes/steps
    } else {
      this.vy += PLAYER.gravity * dt;
      this.vy = Math.max(this.vy, -40);
    }

    // Desired movement this frame.
    const desired = {
      x: this.velocity.x * dt,
      y: this.vy * dt,
      z: this.velocity.z * dt,
    };

    this.controller.computeColliderMovement(
      this.collider,
      desired,
      undefined,
      undefined,
      this.ignoreCollider ? (c) => !this.ignoreCollider(c) : undefined
    );
    const corrected = this.controller.computedMovement();
    this.wasGrounded = this.grounded;
    this.grounded = this.controller.computedGrounded();

    const t = this.body.translation();
    const next = { x: t.x + corrected.x, y: t.y + corrected.y, z: t.z + corrected.z };
    this.body.setNextKinematicTranslation(next);

    // Landing feedback.
    if (this.grounded && !this.wasGrounded && this.vy < -3) {
      this.lastLandImpact = clamp(-this.vy / 10, 0, 1);
    } else {
      this.lastLandImpact = 0;
    }
    if (this.grounded && this.vy < 0) this.vy = 0;

    // Update tracked feet position (capsule centre -> feet).
    this.feet.set(next.x, next.y - this.centerOffset, next.z);
    this.planarSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.planarSpeed > 0.05) this.moveDir.set(this.velocity.x, 0, this.velocity.z).normalize();
  }

  /** Leave the ground with the given vertical speed (no-op while airborne). */
  jump(vy) {
    if (!this.grounded) return false;
    this.vy = vy;
    this.grounded = false;
    return true;
  }

  _approach(cur, target, maxDelta) {
    const d = target - cur;
    if (Math.abs(d) <= maxDelta) return target;
    return cur + Math.sign(d) * maxDelta;
  }

  teleport(pos) {
    this.feet.copy(pos);
    this.body.setTranslation({ x: pos.x, y: pos.y + this.centerOffset, z: pos.z }, true);
    this.velocity.set(0, 0, 0);
    this.vy = 0;
  }
}
