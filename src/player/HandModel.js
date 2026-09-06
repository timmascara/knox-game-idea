import * as THREE from 'three';
import { clamp, damp } from '../core/MathUtils.js';

/**
 * A procedurally built, jointed hand — the only part of the player you ever
 * see (VR style: no arms). Local frame: origin at the wrist, fingers point
 * down -Z, the back of the hand faces +Y and the palm faces -Y. `thumbSign`
 * is +1 for the left hand and -1 for the right (which side the thumb is on).
 *
 * Pose is driven by a handful of scalars that damp toward targets each frame:
 *   curl[4]   0..1 per finger (index, middle, ring, pinky), 1 = fist
 *   spread    0..1 how far the fingers fan out
 *   thumbCurl 0..1 thumb flexion
 *   thumbOut  0..1 thumb abducted away from the palm (1) or tucked in (0)
 */
const FINGER_X = [0.031, 0.011, -0.010, -0.030]; // multiplied by thumbSign
const FINGER_LEN = [0.074, 0.081, 0.075, 0.059];
const FINGER_R = [0.0086, 0.0088, 0.0082, 0.0072];
const PHALANX = [0.44, 0.31, 0.25];
const MAX_CURL = [1.25, 1.55, 1.05]; // radians per joint at curl = 1
const FAN = [0.16, 0.05, -0.06, -0.17]; // spread angle per finger (rad)
const BASE_Y_DROOP = [0.02, 0.0, -0.01, -0.03];

export const HAND_POSES = {
  relaxed: { curl: [0.28, 0.34, 0.38, 0.42], spread: 0.25, thumbCurl: 0.3, thumbOut: 0.45 },
  open: { curl: [0.06, 0.08, 0.1, 0.12], spread: 0.55, thumbCurl: 0.1, thumbOut: 0.75 },
  // Fingers wrap the ball's curvature while the palm stays off it.
  ball: { curl: [0.24, 0.26, 0.3, 0.36], spread: 0.95, thumbCurl: 0.2, thumbOut: 0.95 },
  // A firmer grip for holding / gathering the ball in two hands.
  grip: { curl: [0.36, 0.4, 0.44, 0.5], spread: 0.8, thumbCurl: 0.35, thumbOut: 0.8 },
  guard: { curl: [0.18, 0.22, 0.26, 0.3], spread: 0.35, thumbCurl: 0.25, thumbOut: 0.6 },
};

export class HandModel {
  constructor(thumbSign = -1, skin = 0xc98f68) {
    this.thumbSign = thumbSign;
    this.root = new THREE.Group();
    this.root.name = thumbSign < 0 ? 'rightHand' : 'leftHand';

    this.skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.62, metalness: 0 });
    this.palmMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(skin).offsetHSL(0, -0.05, 0.06),
      roughness: 0.7,
      metalness: 0,
    });
    this.bandMat = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.9, metalness: 0 });

    this.fingers = []; // [{ joints: [Object3D x3] }]
    this.thumb = null;

    this.pose = { curl: [0, 0, 0, 0], spread: 0, thumbCurl: 0, thumbOut: 0 };
    this.targetPose = { curl: [0, 0, 0, 0], spread: 0, thumbCurl: 0, thumbOut: 0 };
    this.setPose(HAND_POSES.relaxed, true);

    this._buildPalm();
    this._buildFingers();
    this._buildThumb();
    this._buildWrist();

    this.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = false;
        o.frustumCulled = false;
      }
    });
    this.applyPose();
  }

  // ---------------------------------------------------------------------------
  _buildPalm() {
    // The palm is an organic outline (wider across the knuckles, a bulge at
    // the thumb heel) extruded with a soft bevel, so its edges catch light
    // like flesh rather than a slab. Drawn in the XZ plane: +X thumb side,
    // -Z toward the fingers.
    const s = this.thumbSign;
    const d = 0.102;
    const shape = new THREE.Shape();
    const pts = [
      [-0.036, 0.0], // wrist, pinky side
      [-0.040, -0.035],
      [-0.043, -0.075],
      [-0.038, -0.098], // pinky knuckle
      [-0.012, -0.104],
      [0.014, -0.104],
      [0.040, -0.098], // index knuckle
      [0.046, -0.078],
      [0.048, -0.055], // thumb web
      [0.050, -0.030], // thumb heel bulge
      [0.044, -0.008],
      [0.036, 0.0],
    ];
    shape.moveTo(pts[0][0] * s, pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      shape.quadraticCurveTo(((a[0] + b[0]) / 2) * s, (a[1] + b[1]) / 2 - 0.002, b[0] * s, b[1]);
    }
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.014,
      bevelEnabled: true,
      bevelThickness: 0.008,
      bevelSize: 0.007,
      bevelSegments: 7,
      curveSegments: 10,
    });
    // Extrude runs along +Z of the shape; lay it flat: shape Y → -Z (fingers),
    // extrusion → Y (thickness), centred on the wrist origin.
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0.007, 0);
    // Taper the thickness toward the knuckles and dome the back of the hand.
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const t = clamp(-z / d, 0, 1);
      const thin = 1 - t * 0.28;
      const arch = (1 - Math.pow(x / 0.046, 2)) * 0.004;
      pos.setY(i, y > 0 ? y * thin + arch * (1 - t * 0.5) : y * (1 - t * 0.15));
    }
    geo.computeVertexNormals();
    const palm = new THREE.Mesh(geo, this.skinMat);
    this.root.add(palm);
    this.palm = palm;

    // Thenar (thumb heel) and hypothenar pads on the palm side.
    const thenar = new THREE.Mesh(new THREE.SphereGeometry(0.02, 14, 10), this.palmMat);
    thenar.scale.set(1.0, 0.5, 1.4);
    thenar.position.set(s * 0.027, -0.010, -0.034);
    this.root.add(thenar);
    const hypo = new THREE.Mesh(new THREE.SphereGeometry(0.015, 12, 8), this.palmMat);
    hypo.scale.set(0.9, 0.45, 1.7);
    hypo.position.set(-s * 0.028, -0.009, -0.046);
    this.root.add(hypo);

    // Knuckle ridge across the back of the hand.
    for (let f = 0; f < 4; f++) {
      const k = new THREE.Mesh(new THREE.SphereGeometry(FINGER_R[f] * 1.15, 12, 8), this.skinMat);
      k.scale.set(1, 0.8, 1);
      k.position.set(s * FINGER_X[f], 0.004, -d + 0.006);
      this.root.add(k);
    }
  }

  _segment(radius, length, mat) {
    // Capsule lying along -Z, base at the origin of its joint.
    const cyl = Math.max(0.002, length - radius);
    const geo = new THREE.CapsuleGeometry(radius, cyl, 4, 10);
    geo.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.z = -length / 2;
    return m;
  }

  _buildFingers() {
    const d = 0.102;
    for (let f = 0; f < 4; f++) {
      const total = FINGER_LEN[f];
      const baseR = FINGER_R[f];
      const joints = [];
      let parent = this.root;
      let z = -d + 0.006;
      let x = this.thumbSign * FINGER_X[f];
      let y = 0.001;
      for (let j = 0; j < 3; j++) {
        const joint = new THREE.Object3D();
        joint.position.set(x, y, z);
        parent.add(joint);
        const len = total * PHALANX[j];
        const r = baseR * (1 - j * 0.11);
        const seg = this._segment(r, len, this.skinMat);
        joint.add(seg);
        // Fingertip pad.
        if (j === 2) {
          const tip = new THREE.Mesh(new THREE.SphereGeometry(r * 0.98, 10, 8), this.palmMat);
          tip.position.set(0, -r * 0.25, -len + r * 0.4);
          tip.scale.set(1, 0.8, 1.15);
          joint.add(tip);
        }
        joints.push(joint);
        parent = joint;
        x = 0;
        y = 0;
        z = -len;
      }
      this.fingers.push({ joints, index: f });
    }
  }

  _buildThumb() {
    const base = new THREE.Object3D();
    base.position.set(this.thumbSign * 0.038, -0.006, -0.030);
    this.root.add(base);

    const meta = new THREE.Object3D(); // CMC joint orientation
    base.add(meta);
    const lens = [0.046, 0.034, 0.030];
    const radii = [0.0115, 0.0102, 0.0092];
    const joints = [];
    let parent = meta;
    for (let j = 0; j < 3; j++) {
      const joint = new THREE.Object3D();
      joint.position.set(0, 0, j === 0 ? 0 : -lens[j - 1]);
      parent.add(joint);
      const seg = this._segment(radii[j], lens[j], this.skinMat);
      joint.add(seg);
      if (j === 2) {
        const tip = new THREE.Mesh(new THREE.SphereGeometry(radii[j] * 0.95, 10, 8), this.palmMat);
        tip.position.set(0, -radii[j] * 0.2, -lens[j] + radii[j] * 0.4);
        tip.scale.set(1, 0.8, 1.15);
        joint.add(tip);
      }
      joints.push(joint);
      parent = joint;
    }
    this.thumb = { base, meta, joints, lens };
  }

  _buildWrist() {
    // Stump: an elliptical capsule fading back toward where the arm would be,
    // capped by a sweatband so the cut never reads as a cut.
    const stump = new THREE.Mesh(new THREE.CapsuleGeometry(0.030, 0.05, 4, 14), this.skinMat);
    stump.geometry.rotateX(Math.PI / 2);
    stump.scale.set(1.0, 0.72, 1);
    stump.position.set(0, 0.0, 0.03);
    this.root.add(stump);

    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.034, 0.032, 18, 1), this.bandMat);
    band.geometry.rotateX(Math.PI / 2);
    band.scale.set(1.0, 0.76, 1);
    band.position.set(0, 0, 0.036);
    this.root.add(band);
  }

  // ---------------------------------------------------------------------------
  /** Set the target pose (or snap to it immediately). */
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

  /** Blend two named poses into the target. */
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

  applyPose() {
    const p = this.pose;
    const s = this.thumbSign;
    for (const f of this.fingers) {
      const c = clamp(p.curl[f.index], 0, 1);
      for (let j = 0; j < 3; j++) {
        const joint = f.joints[j];
        // Curl toward the palm (-Y) is a negative rotation about +X.
        const bend = c * MAX_CURL[j] + (j === 0 ? BASE_Y_DROOP[f.index] : 0);
        joint.rotation.x = -bend;
        joint.rotation.y = j === 0 ? -s * FAN[f.index] * (0.35 + p.spread) : 0;
        joint.rotation.z = 0;
      }
    }
    // Thumb: the metacarpal swings out from the palm; the two distal joints flex.
    const th = this.thumb;
    const out = clamp(p.thumbOut, 0, 1);
    const curl = clamp(p.thumbCurl, 0, 1);
    th.meta.rotation.set(0, 0, 0);
    th.meta.rotation.order = 'YXZ';
    th.meta.rotation.y = -s * (0.55 + out * 0.55); // sweep outward
    th.meta.rotation.x = -(0.30 + curl * 0.35); // tilt toward the palm
    th.meta.rotation.z = s * (0.65 - out * 0.35); // roll so the pad faces inward
    th.joints[0].rotation.x = -(0.05 + curl * 0.35);
    th.joints[1].rotation.x = -(0.10 + curl * 0.55);
    th.joints[2].rotation.x = -(0.05 + curl * 0.75);
  }
}
