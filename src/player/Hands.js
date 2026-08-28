import * as THREE from 'three';
import { dampVec3 } from '../core/MathUtils.js';

/**
 * Stylised first-person hands, parented to the camera so they live in view
 * space. Each hand is a mitten-style palm + thumb + finger block — intentional
 * low-poly forms, not floating cubes. The ball controller drives per-frame
 * targets (rest, reach, dribble-follow, shooting) and the hands damp toward
 * them so motion always reads as connected to the ball.
 */
export class Hands {
  constructor(camera, skin = 0xb9855f) {
    this.camera = camera;
    this.left = this._makeHand(+1, skin);
    this.right = this._makeHand(-1, skin);
    camera.add(this.left.group);
    camera.add(this.right.group);

    // Rest poses in camera-local space.
    this.rest = {
      left: { pos: new THREE.Vector3(0.26, -0.42, -0.62), rot: new THREE.Euler(-0.5, 0.2, 0.3) },
      right: { pos: new THREE.Vector3(-0.26, -0.42, -0.62), rot: new THREE.Euler(-0.5, -0.2, -0.3) },
    };
    this.target = {
      left: { pos: this.rest.left.pos.clone(), rot: this.rest.left.rot.clone() },
      right: { pos: this.rest.right.pos.clone(), rot: this.rest.right.rot.clone() },
    };
    this.responsiveness = 16;
    this.visible = true;

    // Place the hands at their rest pose immediately so they never render at the
    // camera origin (in your face) before the first update runs.
    for (const side of ['left', 'right']) {
      this[side].group.position.copy(this.rest[side].pos);
      this[side].group.quaternion.setFromEuler(this.rest[side].rot);
    }
  }

  _makeHand(sideSign, skin) {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7, metalness: 0.0 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2f33, roughness: 0.8 });

    // Short wrist/sleeve — kept small so it reads as a wrist, not a big dark
    // blob filling the corner of the screen.
    const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, 0.11, 4, 8), dark);
    forearm.rotation.x = Math.PI / 2;
    forearm.position.set(0, 0, 0.12);
    group.add(forearm);

    // Palm
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.045, 0.12), mat);
    this._round(palm);
    group.add(palm);

    // Finger block
    const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.035, 0.075), mat);
    this._round(fingers);
    fingers.position.set(0, 0, -0.093);
    fingers.rotation.x = -0.15;
    group.add(fingers);
    this._fingers = fingers;

    // Thumb
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.03, 0.06), mat);
    this._round(thumb);
    thumb.position.set(sideSign * 0.06, 0, -0.02);
    thumb.rotation.z = sideSign * 0.5;
    group.add(thumb);

    group.traverse((o) => {
      o.castShadow = false;
      o.frustumCulled = false;
    });
    return { group, palm, fingers, thumb };
  }

  _round(mesh) {
    // Cheap visual rounding: bevel via slightly scaled duplicate is overkill;
    // just soften normals.
    mesh.geometry.computeVertexNormals();
  }

  setResponsiveness(v) {
    this.responsiveness = v;
  }

  /** Set a per-hand target in camera-local space. */
  setTarget(side, pos, rot) {
    this.target[side].pos.copy(pos);
    if (rot) this.target[side].rot.copy(rot);
  }

  toRest(side) {
    this.target[side].pos.copy(this.rest[side].pos);
    this.target[side].rot.copy(this.rest[side].rot);
  }

  setVisible(v) {
    this.visible = v;
    this.left.group.visible = v;
    this.right.group.visible = v;
  }

  update(dt) {
    for (const side of ['left', 'right']) {
      const hand = this[side];
      const tgt = this.target[side];
      dampVec3(hand.group.position, tgt.pos, this.responsiveness, dt);
      // Damp rotation via quaternion slerp.
      const q = new THREE.Quaternion().setFromEuler(tgt.rot);
      hand.group.quaternion.slerp(q, 1 - Math.exp(-this.responsiveness * dt));
    }
  }
}
