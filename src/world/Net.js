import * as THREE from 'three';
import { HOOP } from '../core/Constants.js';

/**
 * A verlet-integrated basketball net. The top ring of nodes is pinned to the
 * rim circle; cords are simulated as distance constraints and rendered as a
 * diamond mesh of line segments. The ball pushes nodes outward as it passes
 * through, which produces the satisfying swish. The net only ever attaches to
 * the rim — never the pole.
 */
export class Net {
  constructor(segments = 12, rings = 6) {
    this.segments = segments;
    this.rings = rings;
    this.R = HOOP.rimRadius * 0.96;
    this.length = HOOP.netLength;

    this.nodes = []; // { pos, prev, pinned }
    this.constraints = []; // { a, b, rest }
    this._tmp = new THREE.Vector3();

    this._buildNodes();
    this._buildConstraints();
    this._buildMesh();
  }

  _index(ring, seg) {
    return ring * this.segments + (seg % this.segments);
  }

  _buildNodes() {
    for (let r = 0; r <= this.rings; r++) {
      const t = r / this.rings;
      // Net tapers inward toward the bottom.
      const radius = this.R * (1 - 0.32 * t);
      const y = -this.length * t;
      // Alternate rings are rotated half a step to make the diamonds.
      const twist = (r % 2) * (Math.PI / this.segments);
      for (let s = 0; s < this.segments; s++) {
        const a = (s / this.segments) * Math.PI * 2 + twist;
        const pos = new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius);
        this.nodes.push({
          pos,
          prev: pos.clone(),
          pinned: r === 0,
          home: pos.clone(),
        });
      }
    }
  }

  _buildConstraints() {
    const dist = (i, j) => this.nodes[i].pos.distanceTo(this.nodes[j].pos);
    for (let r = 0; r < this.rings; r++) {
      for (let s = 0; s < this.segments; s++) {
        const a = this._index(r, s);
        // Diamond diagonals to the next ring.
        const bl = this._index(r + 1, s);
        const br = this._index(r + 1, s + 1);
        this.constraints.push({ a, b: bl, rest: dist(a, bl) });
        this.constraints.push({ a, b: br, rest: dist(a, br) });
      }
    }
    // Circumferential constraints keep the mouth round.
    for (let r = 0; r <= this.rings; r++) {
      for (let s = 0; s < this.segments; s++) {
        const a = this._index(r, s);
        const b = this._index(r, s + 1);
        this.constraints.push({ a, b, rest: dist(a, b) });
      }
    }
  }

  _buildMesh() {
    const positions = new Float32Array(this.constraints.length * 2 * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0xf4f6f2,
      transparent: true,
      opacity: 0.92,
    });
    this.mesh = new THREE.LineSegments(this.geometry, mat);
    this.mesh.frustumCulled = false;
  }

  /** Push net nodes when the ball is near (ballLocal in net-local space). */
  interact(ballLocal, ballRadius) {
    for (const n of this.nodes) {
      if (n.pinned) continue;
      const dx = n.pos.x - ballLocal.x;
      const dz = n.pos.z - ballLocal.z;
      const dyOk = Math.abs(n.pos.y - ballLocal.y) < ballRadius * 2.2;
      if (!dyOk) continue;
      const horiz = Math.hypot(dx, dz);
      const minDist = ballRadius * 0.92;
      if (horiz < minDist && horiz > 1e-4) {
        const push = (minDist - horiz);
        n.pos.x += (dx / horiz) * push;
        n.pos.z += (dz / horiz) * push;
        n.pos.y -= push * 0.4;
      }
    }
  }

  update(dt) {
    const gravity = -9.0;
    const damping = 0.86;
    // Verlet integrate
    for (const n of this.nodes) {
      if (n.pinned) {
        n.pos.copy(n.home);
        n.prev.copy(n.home);
        continue;
      }
      const vx = (n.pos.x - n.prev.x) * damping;
      const vy = (n.pos.y - n.prev.y) * damping;
      const vz = (n.pos.z - n.prev.z) * damping;
      n.prev.copy(n.pos);
      n.pos.x += vx;
      n.pos.y += vy + gravity * dt * dt;
      n.pos.z += vz;
    }
    // Satisfy constraints
    for (let iter = 0; iter < 4; iter++) {
      for (const c of this.constraints) {
        const a = this.nodes[c.a];
        const b = this.nodes[c.b];
        this._tmp.subVectors(b.pos, a.pos);
        const d = this._tmp.length() || 1e-5;
        const diff = (d - c.rest) / d;
        const mulA = a.pinned ? 0 : b.pinned ? 1 : 0.5;
        const mulB = b.pinned ? 0 : a.pinned ? 1 : 0.5;
        a.pos.addScaledVector(this._tmp, mulA * diff);
        b.pos.addScaledVector(this._tmp, -mulB * diff);
      }
    }
    this._updateGeometry();
  }

  _updateGeometry() {
    const pos = this.geometry.attributes.position.array;
    let i = 0;
    for (const c of this.constraints) {
      const a = this.nodes[c.a].pos;
      const b = this.nodes[c.b].pos;
      pos[i++] = a.x; pos[i++] = a.y; pos[i++] = a.z;
      pos[i++] = b.x; pos[i++] = b.y; pos[i++] = b.z;
    }
    this.geometry.attributes.position.needsUpdate = true;
  }
}
