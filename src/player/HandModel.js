import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { clamp, damp } from '../core/MathUtils.js';

/**
 * A skinned hand driven by a handful of pose scalars. The mesh is the
 * sculpted hand from `src/assets/hand_right.glb`, auto-rigged by
 * scripts/rig_hand.py so that every joint's local -Z runs down the bone and
 * local +Y faces the back of the hand. Curl is then a rotation about a
 * joint's local X, fanning a rotation about its local Y — applied on top of
 * the sculpt's own relaxed bind pose.
 *
 * Local frame of the whole hand: origin at the wrist, fingers down -Z, back
 * of the hand +Y, palm -Y. `thumbSign` is -1 for the right hand (thumb on
 * -X) and +1 for the left, which is the same asset mirrored in X.
 *
 * Pose scalars (damped toward targets every frame):
 *   curl[4]   extra flexion per finger (index, middle, ring, pinky); the
 *             sculpt is already slightly curled, so 0 is relaxed, negative
 *             straightens, 1 is a fist
 *   spread    0..1 how far the fingers fan out
 *   thumbCurl 0..1 thumb flexion
 *   thumbOut  0..1 thumb abducted away from the palm
 */
const FINGERS = ['index', 'middle', 'ring', 'pinky'];
const MAX_CURL = [1.05, 1.35, 0.85]; // radians per joint at curl = 1 (on top of the sculpt)
const FAN = [0.17, 0.05, -0.07, -0.19]; // fan per finger at spread = 1 (rad)
const REST_FAN = 0.35; // fraction of FAN already present when spread = 0

export const HAND_POSES = {
  relaxed: { curl: [0.02, 0.05, 0.08, 0.1], spread: 0.15, thumbCurl: 0.2, thumbOut: 0.35 },
  open: { curl: [-0.16, -0.16, -0.14, -0.12], spread: 0.6, thumbCurl: 0.0, thumbOut: 0.7 },
  // Fingers wrap the ball's curvature while the palm stays off it.
  ball: { curl: [-0.02, 0.0, 0.04, 0.08], spread: 1.0, thumbCurl: 0.05, thumbOut: 0.95 },
  // A firmer grip for holding / gathering the ball in two hands.
  grip: { curl: [0.12, 0.16, 0.2, 0.24], spread: 0.8, thumbCurl: 0.25, thumbOut: 0.8 },
  guard: { curl: [-0.05, 0.0, 0.04, 0.08], spread: 0.3, thumbCurl: 0.15, thumbOut: 0.5 },
};

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();

export class HandModel {
  constructor(asset, thumbSign = -1, skin = 0xc98f68) {
    this.thumbSign = thumbSign;
    this.root = new THREE.Group();
    this.root.name = thumbSign < 0 ? 'rightHand' : 'leftHand';

    this.skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.58, metalness: 0 });
    this.bandMat = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });

    // Independent skeleton per hand.
    const inst = cloneSkeleton(asset.scene);
    this.mesh = null;
    this.bones = {};
    inst.traverse((o) => {
      if (o.isSkinnedMesh) {
        this.mesh = o;
        o.material = this.skinMat;
        o.castShadow = true;
        o.receiveShadow = false;
        o.frustumCulled = false;
      }
      if (o.isBone) this.bones[o.name] = o;
    });
    // The left hand is the right hand mirrored.
    if (thumbSign > 0) inst.scale.x = -1;
    this.root.add(inst);

    // Bind rotations: pose deltas are applied on top of these.
    this.bind = {};
    for (const [name, b] of Object.entries(this.bones)) this.bind[name] = b.quaternion.clone();

    // Sweatband over the forearm cut.
    // An open ring, so the skin of the forearm shows through it and there is
    // no flat black disc facing the camera.
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.045, 0.028, 24, 1, true), this.bandMat);
    band.geometry.rotateX(Math.PI / 2);
    band.scale.set(1.0, 0.8, 1);
    band.position.set(0, 0.006, 0.03);
    band.castShadow = true;
    this.root.add(band);

    this.pose = { curl: [0, 0, 0, 0], spread: 0, thumbCurl: 0, thumbOut: 0 };
    this.targetPose = { curl: [0, 0, 0, 0], spread: 0, thumbCurl: 0, thumbOut: 0 };
    this.setPose(HAND_POSES.relaxed, true);
    this.applyPose();
  }

  // ---------------------------------------------------------------------------
  setPose(p, immediate = false) {
    const t = this.targetPose;
    for (let i = 0; i < 4; i++) t.curl[i] = p.curl[i];
    t.spread = p.spread;
    t.thumbCurl = p.thumbCurl;
    t.thumbOut = p.thumbOut;
    if (immediate) {
      for (let i = 0; i < 4; i++) this.pose.curl[i] = t.curl[i];
      this.pose.spread = t.spread;
      this.pose.thumbCurl = t.thumbCurl;
      this.pose.thumbOut = t.thumbOut;
    }
  }

  setPoseBlend(a, b, k) {
    const t = this.targetPose;
    for (let i = 0; i < 4; i++) t.curl[i] = a.curl[i] + (b.curl[i] - a.curl[i]) * k;
    t.spread = a.spread + (b.spread - a.spread) * k;
    t.thumbCurl = a.thumbCurl + (b.thumbCurl - a.thumbCurl) * k;
    t.thumbOut = a.thumbOut + (b.thumbOut - a.thumbOut) * k;
  }

  update(dt, lambda = 18) {
    const p = this.pose;
    const t = this.targetPose;
    for (let i = 0; i < 4; i++) p.curl[i] = damp(p.curl[i], t.curl[i], lambda, dt);
    p.spread = damp(p.spread, t.spread, lambda, dt);
    p.thumbCurl = damp(p.thumbCurl, t.thumbCurl, lambda, dt);
    p.thumbOut = damp(p.thumbOut, t.thumbOut, lambda, dt);
    this.applyPose();
  }

  _set(name, rx, ry, rz = 0) {
    const b = this.bones[name];
    if (!b) return;
    _e.set(rx, ry, rz, 'XYZ');
    _q.setFromEuler(_e);
    b.quaternion.copy(this.bind[name]).multiply(_q);
  }

  applyPose() {
    const p = this.pose;
    for (let f = 0; f < 4; f++) {
      const c = clamp(p.curl[f], -0.3, 1);
      const fan = FAN[f] * (REST_FAN + (1 - REST_FAN) * p.spread) - FAN[f] * REST_FAN;
      for (let j = 0; j < 3; j++) {
        // Curl toward the palm (-Y) is a negative rotation about local +X.
        this._set(`${FINGERS[f]}_${j + 1}`, -c * MAX_CURL[j], j === 0 ? fan : 0);
      }
    }
    const out = clamp(p.thumbOut, 0, 1);
    const curl = clamp(p.thumbCurl, 0, 1);
    // Thumb: the sculpt's thumb hangs toward the palm. "Out" lifts the
    // metacarpal into the palm plane (positive local X) and spreads it away
    // from the index (local Y); curl flexes all three joints.
    this._set('thumb_1', out * 0.55 - curl * 0.35, (out - 0.4) * 0.35, (out - 0.4) * 0.2);
    this._set('thumb_2', out * 0.1 - curl * 0.55, 0);
    this._set('thumb_3', -(curl * 0.7 - 0.05), 0);
  }
}
