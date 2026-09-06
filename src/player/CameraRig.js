import * as THREE from 'three';
import { clamp, damp } from '../core/MathUtils.js';

/**
 * First-person camera. Yaw rotates the whole rig; pitch tilts only the camera,
 * clamped so you can't flip over. Mouse look is applied from consumed input
 * deltas — dx turns right (never inverted), dy looks up when the mouse moves up
 * unless invertY is set. Adds a subtle head-bob + landing dip for feedback.
 */
export class CameraRig {
  constructor(fov = 74, aspect = 1) {
    this.yawObject = new THREE.Object3D(); // holds position + yaw
    this.pitchObject = new THREE.Object3D(); // holds pitch
    this.camera = new THREE.PerspectiveCamera(fov, aspect, 0.05, 600);
    this.pitchObject.add(this.camera);
    this.yawObject.add(this.pitchObject);

    this.yaw = 0;
    this.pitch = 0;
    this.minPitch = -Math.PI / 2 + 0.05;
    this.maxPitch = Math.PI / 2 - 0.05;

    this.bobT = 0;
    this.bobAmount = 0;
    this.landDip = 0;
    this.baseEye = 1.64;
    this.sway = new THREE.Vector3();
    this.roll = 0;
  }

  /** Body sway from the dribble: lateral (m, +right), vertical (m), roll (rad). */
  setSway(lateral, vertical, roll) {
    this.sway.set(lateral, vertical, 0);
    this.roll = roll;
  }

  setFov(fov) {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  setAspect(a) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  applyLook(dx, dy) {
    this.yaw -= dx;
    this.pitch -= dy;
    this.pitch = clamp(this.pitch, this.minPitch, this.maxPitch);
    this.yawObject.rotation.y = this.yaw;
    this.pitchObject.rotation.x = this.pitch;
  }

  /** Horizontal forward direction (unit, XZ). */
  forward() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  right() {
    return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  /** Full look direction including pitch. */
  lookDir() {
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()));
    return dir.normalize();
  }

  /** Position the rig at the player's feet; eye height + bob handled here. */
  update(dt, feetPos, planarSpeed, grounded) {
    this.yawObject.position.set(feetPos.x, feetPos.y, feetPos.z);
    this.yawObject.rotation.y = this.yaw;
    this.pitchObject.rotation.x = this.pitch;

    // Head bob scales with speed while grounded.
    const targetBob = grounded ? clamp(planarSpeed / 7, 0, 1) : 0;
    this.bobAmount = damp(this.bobAmount, targetBob, 8, dt);
    this.bobT += dt * (6 + planarSpeed * 1.4);
    const bobY = Math.sin(this.bobT * 2) * 0.022 * this.bobAmount;
    const bobX = Math.cos(this.bobT) * 0.018 * this.bobAmount;

    this.landDip = damp(this.landDip, 0, 10, dt);

    this.pitchObject.position.set(bobX + this.sway.x, this.baseEye + bobY - this.landDip + this.sway.y, 0);
    this.camera.rotation.z = this.roll;
  }

  triggerLandDip(strength) {
    this.landDip = Math.min(0.14, strength);
  }
}
