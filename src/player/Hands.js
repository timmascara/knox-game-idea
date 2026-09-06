import * as THREE from 'three';
import { HandModel, HAND_POSES } from './HandModel.js';

/**
 * The pair of first-person hands. They live in WORLD space (not parented to
 * the camera) so that, exactly like VR, looking around never drags them with
 * your head — they belong to your body. Whoever drives them (the dribble
 * controller) sets a world-space target transform + pose per hand each frame,
 * and the hands chase it with a tunable spring so motion always reads as
 * flesh moving through air, not a cursor snapping.
 */
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();

export class Hands {
  constructor(scene, asset, skin = 0xc98f68) {
    this.scene = scene;
    this.asset = asset;
    this.left = this._make(+1, skin);
    this.right = this._make(-1, skin);
    scene.add(this.left.model.root);
    scene.add(this.right.model.root);
  }

  _make(thumbSign, skin) {
    const model = new HandModel(this.asset, thumbSign, skin);
    return {
      model,
      target: { pos: new THREE.Vector3(), quat: new THREE.Quaternion() },
      // Current smoothed transform (the mesh is placed from this).
      pos: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      vel: new THREE.Vector3(),
      posLambda: 22,
      rotLambda: 20,
      snap: true,
    };
  }

  get(side) {
    return side === 'left' ? this.left : this.right;
  }

  /**
   * World-space target: position of the wrist origin, and an orientation built
   * from where the palm faces (`palmDir`, unit, from the hand toward whatever
   * it is touching) and where the fingers point (`fingerDir`, unit).
   */
  setTarget(side, pos, palmDir, fingerDir, posLambda = 22, rotLambda = 20) {
    const h = this.get(side);
    h.target.pos.copy(pos);
    Hands.quatFromPalm(palmDir, fingerDir, h.target.quat);
    h.posLambda = posLambda;
    h.rotLambda = rotLambda;
  }

  setTargetQuat(side, pos, quat, posLambda = 22, rotLambda = 20) {
    const h = this.get(side);
    h.target.pos.copy(pos);
    h.target.quat.copy(quat);
    h.posLambda = posLambda;
    h.rotLambda = rotLambda;
  }

  setPose(side, pose, immediate = false) {
    this.get(side).model.setPose(pose, immediate);
  }

  setPoseBlend(side, a, b, k) {
    this.get(side).model.setPoseBlend(a, b, k);
  }

  /**
   * Build a hand orientation from a palm direction (local -Y maps to it) and a
   * finger direction (local -Z maps to its component perpendicular to the palm).
   */
  static quatFromPalm(palmDir, fingerDir, out = new THREE.Quaternion()) {
    _y.copy(palmDir).multiplyScalar(-1).normalize(); // local +Y = back of hand
    _z.copy(fingerDir).multiplyScalar(-1); // local +Z = toward the wrist
    _z.addScaledVector(_y, -_z.dot(_y));
    if (_z.lengthSq() < 1e-6) _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
    _z.normalize();
    _x.crossVectors(_y, _z).normalize();
    _m.makeBasis(_x, _y, _z);
    return out.setFromRotationMatrix(_m);
  }

  snapToTargets() {
    for (const h of [this.left, this.right]) {
      h.pos.copy(h.target.pos);
      h.quat.copy(h.target.quat);
      h.vel.set(0, 0, 0);
      h.snap = false;
    }
  }

  setVisible(v) {
    this.left.model.root.visible = v;
    this.right.model.root.visible = v;
  }

  update(dt) {
    for (const h of [this.left, this.right]) {
      if (h.snap) {
        h.pos.copy(h.target.pos);
        h.quat.copy(h.target.quat);
        h.snap = false;
      } else {
        const t = 1 - Math.exp(-h.posLambda * dt);
        h.pos.lerp(h.target.pos, t);
        h.quat.slerp(h.target.quat, 1 - Math.exp(-h.rotLambda * dt));
      }
      h.model.root.position.copy(h.pos);
      h.model.root.quaternion.copy(h.quat);
      h.model.update(dt);
    }
  }
}

export { HAND_POSES };
