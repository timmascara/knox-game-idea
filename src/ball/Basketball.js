import * as THREE from 'three';
import { BALL, GROUP } from '../core/Constants.js';

/**
 * The basketball. One persistent object for the whole session — it is never
 * deleted and recreated. It has two modes:
 *
 *   FREE       — a dynamic Rapier rigid body: falls, bounces, rolls, collides
 *                with court/rim/backboard/props. Used for loose balls, live
 *                shots and rebounds. Real physics.
 *   CONTROLLED — a kinematic body whose position is driven by the ball
 *                controller (pickup / dribble / shooting wind-up). The dribble
 *                bounce is computed from real gravity math so it still reads as
 *                a physical bounce, then it is handed back to FREE mode with a
 *                launch velocity when shot or dropped.
 */
export const BallMode = { FREE: 'free', CONTROLLED: 'controlled' };

export class Basketball {
  constructor(scene, physics, spawn = new THREE.Vector3(1.5, 0.3, 6)) {
    this.scene = scene;
    this.physics = physics;
    const { RAPIER } = physics;

    this.mesh = this._buildMesh();
    scene.add(this.mesh);

    this.body = physics.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, spawn.y, spawn.z)
        .setLinearDamping(BALL.linearDamping)
        .setAngularDamping(BALL.angularDamping)
        .setCcdEnabled(true)
    );
    this.collider = physics.createCollider(
      RAPIER.ColliderDesc.ball(BALL.radius)
        .setRestitution(BALL.restitution)
        .setFriction(BALL.friction)
        .setDensity(BALL.mass / ((4 / 3) * Math.PI * BALL.radius ** 3))
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body
    );
    this.colliderHandle = this.collider.handle;

    this.mode = BallMode.FREE;
    this._pos = new THREE.Vector3().copy(spawn);
    this._prevPos = this._pos.clone();
    this.spinAxis = new THREE.Vector3(1, 0, 0);
  }

  _buildMesh() {
    const geo = new THREE.SphereGeometry(BALL.radius, 32, 24);
    const tex = this._texture();
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.72,
      metalness: 0.0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    return mesh;
  }

  _texture() {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    const ctx = c.getContext('2d');
    // Base orange with subtle vertical shading.
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#d9752e');
    grad.addColorStop(0.5, '#e07f33');
    grad.addColorStop(1, '#c96727');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 256);
    // pebble speckle
    ctx.fillStyle = 'rgba(120,60,20,0.10)';
    for (let i = 0; i < 2200; i++) {
      ctx.fillRect(Math.random() * 512, Math.random() * 256, 1.3, 1.3);
    }
    // Seams (black). UV sphere: horizontal line = equator, verticals = meridians.
    ctx.strokeStyle = '#1c1410';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, 128); ctx.lineTo(512, 128); // equator
    ctx.stroke();
    for (const x of [128, 384]) {
      ctx.beginPath();
      ctx.moveTo(x, 0); ctx.lineTo(x, 256);
      ctx.stroke();
    }
    // Curved side seams
    ctx.beginPath();
    ctx.moveTo(0, 128);
    ctx.bezierCurveTo(128, 40, 128, 216, 256, 128);
    ctx.bezierCurveTo(384, 40, 384, 216, 512, 128);
    ctx.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  // --- Mode control ----------------------------------------------------------
  setControlled() {
    if (this.mode === BallMode.CONTROLLED) return;
    const { RAPIER } = this.physics;
    this.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    this.mode = BallMode.CONTROLLED;
  }

  setFree(launchVel = null, spin = null) {
    const { RAPIER } = this.physics;
    this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.body.wakeUp();
    if (launchVel) this.body.setLinvel({ x: launchVel.x, y: launchVel.y, z: launchVel.z }, true);
    else this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    if (spin) this.body.setAngvel({ x: spin.x, y: spin.y, z: spin.z }, true);
    this.mode = BallMode.FREE;
  }

  /** In CONTROLLED mode, drive the ball to a world position this frame. */
  driveTo(pos) {
    this.body.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z });
    this._pos.copy(pos);
  }

  get position() {
    const t = this.body.translation();
    this._pos.set(t.x, t.y, t.z);
    return this._pos;
  }

  get velocity() {
    const v = this.body.linvel();
    return new THREE.Vector3(v.x, v.y, v.z);
  }

  setPositionHard(pos) {
    this.body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /**
   * Extra rolling resistance while the ball is rolling on the ground. A perfect
   * sphere on a plane would roll almost forever in the solver; this bleeds off
   * horizontal speed so loose balls come to rest and can be chased down.
   */
  applyRollingResistance(dt) {
    if (this.mode !== BallMode.FREE) return;
    const t = this.body.translation();
    if (t.y > BALL.radius + 0.06) return; // only near the ground
    const v = this.body.linvel();
    const horiz = Math.hypot(v.x, v.z);
    if (horiz < 0.01) return;
    const decay = Math.max(0, 1 - (BALL.rollDecay * dt) / Math.max(horiz, 0.4));
    this.body.setLinvel({ x: v.x * decay, y: v.y, z: v.z * decay }, true);
  }

  /** Sync the render mesh from physics (FREE) — spin is read from angvel. */
  syncMesh() {
    const t = this.body.translation();
    this.mesh.position.set(t.x, t.y, t.z);
    const r = this.body.rotation();
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }

  /** In CONTROLLED mode we set mesh position directly and spin it manually. */
  syncMeshControlled(pos, spinQuat) {
    this.mesh.position.copy(pos);
    if (spinQuat) this.mesh.quaternion.copy(spinQuat);
  }
}
