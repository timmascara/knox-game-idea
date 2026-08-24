import * as THREE from 'three';
import { randRange } from '../core/MathUtils.js';

/**
 * Lightweight rain: a single Points cloud of streaks that falls and wraps
 * around the player. Enabled only for wet environments. Also darkens/greys the
 * court via a wet sheen handled by the caller.
 */
export class Weather {
  constructor(scene) {
    this.scene = scene;
    this.enabled = false;
    const count = 3500;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = randRange(-30, 30);
      pos[i * 3 + 1] = randRange(0, 24);
      pos[i * 3 + 2] = randRange(-30, 30);
      this.vel[i] = randRange(18, 28);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xafc4d0,
      size: 0.06,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
    this.count = count;
  }

  setEnabled(on) {
    this.enabled = on;
    this.points.visible = on;
  }

  update(dt, center) {
    if (!this.enabled) return;
    const pos = this.points.geometry.attributes.position.array;
    for (let i = 0; i < this.count; i++) {
      pos[i * 3 + 1] -= this.vel[i] * dt;
      if (pos[i * 3 + 1] < 0) {
        pos[i * 3 + 1] = 24;
        pos[i * 3] = randRange(-30, 30);
        pos[i * 3 + 2] = randRange(-30, 30);
      }
    }
    // Drops are stored relative to the object, which follows the player, so the
    // rain field is always centred on wherever they are.
    this.points.position.set(center.x, 0, center.z);
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
