import * as THREE from 'three';
import { HOOP } from '../core/Constants.js';

/**
 * A verlet-integrated basketball net rendered as real geometry. Twelve loops
 * of cord hang from the rim in the classic diamond weave; the top ring is
 * pinned to the rim circle, every cord is a distance constraint, and the
 * ball is a moving sphere that shoves nodes out of its way in full 3D — so a
 * swish pushes the cords apart, drags the whole net down with it, and lets
 * the net whip back up and swing once the ball is through.
 *
 * Cords are an InstancedMesh of thin cylinders (one per constraint) and the
 * knots an InstancedMesh of small spheres, refreshed from the node positions
 * every step — a few hundred instances, cheap to update, and they take
 * shadows and light like the rest of the rig instead of reading as 1 px
 * lines.
 *
 * `interact()` also reports how many nodes the ball touched this step, which
 * the hoop turns into drag on the ball: a real net slows a ball noticeably on
 * the way through, and that is a large part of why a swish reads as a swish.
 */
const _tmp = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class Net {
  constructor(segments = 12, rings = 7) {
    this.segments = segments;
    this.rings = rings;
    this.R = HOOP.rimRadius * 0.97;
    this.bottomR = 0.135; // the mouth at the bottom; the ball has to push through
    this.length = HOOP.netLength;
    this.cordRadius = 0.0032;

    this.nodes = []; // { pos, prev, pinned, home }
    this.constraints = []; // { a, b, rest }
    this.contacts = 0; // nodes touched by the ball this step
    this.energy = 0; // how much the ball disturbed the net this step (m)

    this._buildNodes();
    this._buildConstraints();
    this._buildMesh();
  }

  _index(ring, seg) {
    return ring * this.segments + ((seg % this.segments) + this.segments) % this.segments;
  }

  _buildNodes() {
    for (let r = 0; r <= this.rings; r++) {
      const t = r / this.rings;
      // A real net keeps its width for the first third, then tapers.
      const taper = t < 0.3 ? 0 : (t - 0.3) / 0.7;
      const radius = this.R + (this.bottomR - this.R) * taper * taper * (3 - 2 * taper);
      const y = -this.length * t;
      const twist = (r % 2) * (Math.PI / this.segments);
      for (let s = 0; s < this.segments; s++) {
        const a = (s / this.segments) * Math.PI * 2 + twist;
        const pos = new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius);
        this.nodes.push({ pos, prev: pos.clone(), pinned: r === 0, home: pos.clone() });
      }
    }
  }

  _buildConstraints() {
    const dist = (i, j) => this.nodes[i].pos.distanceTo(this.nodes[j].pos);
    for (let r = 0; r < this.rings; r++) {
      for (let s = 0; s < this.segments; s++) {
        const a = this._index(r, s);
        // Diamond diagonals to the next ring: the odd rings are twisted half
        // a step, so each node links to the two nodes straddling it below.
        const bl = this._index(r + 1, s);
        const br = this._index(r + 1, r % 2 === 0 ? s - 1 : s + 1);
        this.constraints.push({ a, b: bl, rest: dist(a, bl) });
        this.constraints.push({ a, b: br, rest: dist(a, br) });
      }
    }
    // The bottom loop is a closed cord.
    for (let s = 0; s < this.segments; s++) {
      const a = this._index(this.rings, s);
      const b = this._index(this.rings, s + 1);
      this.constraints.push({ a, b, rest: dist(a, b) });
    }
    // Soft circumferential bracing on the middle rings keeps the weave from
    // collapsing into a rope; it is not drawn.
    this._brace = [];
    for (let r = 1; r < this.rings; r++) {
      for (let s = 0; s < this.segments; s++) {
        const a = this._index(r, s);
        const b = this._index(r, s + 2);
        this._brace.push({ a, b, rest: dist(a, b) * 1.06 });
      }
    }
    this.drawn = this.constraints.length;
  }

  _buildMesh() {
    this.mesh = new THREE.Group();
    const cordMat = new THREE.MeshStandardMaterial({ color: 0xf1f0e8, roughness: 0.92, metalness: 0 });
    const cordGeo = new THREE.CylinderGeometry(this.cordRadius, this.cordRadius, 1, 6, 1, true);
    this.cords = new THREE.InstancedMesh(cordGeo, cordMat, this.drawn);
    this.cords.castShadow = true;
    this.cords.frustumCulled = false;
    this.cords.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.add(this.cords);

    const knotGeo = new THREE.SphereGeometry(this.cordRadius * 1.9, 6, 5);
    this.knots = new THREE.InstancedMesh(knotGeo, cordMat, this.nodes.length);
    this.knots.frustumCulled = false;
    this.knots.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.add(this.knots);

    // The cord loops that hang the net on the rim.
    const loopMat = new THREE.MeshStandardMaterial({ color: 0xe9e8e0, roughness: 0.9 });
    const loopGeo = new THREE.TorusGeometry(HOOP.rimTube + 0.004, 0.0028, 6, 12);
    for (let s = 0; s < this.segments; s++) {
      const a = (s / this.segments) * Math.PI * 2;
      const loop = new THREE.Mesh(loopGeo, loopMat);
      loop.position.set(Math.cos(a) * HOOP.rimRadius, 0, Math.sin(a) * HOOP.rimRadius);
      loop.rotation.y = -a;
      this.mesh.add(loop);
    }
    this._updateGeometry();
  }

  /**
   * Shove nodes out of the ball (net-local space). Returns the number of
   * nodes in contact. Nodes are pushed radially away from the ball centre in
   * 3D, so cords below the ball are carried down with it and cords beside it
   * are spread apart — no node can pass through the ball.
   */
  interact(ballLocal, ballRadius) {
    let contacts = 0;
    let energy = 0;
    const reach = ballRadius + this.cordRadius * 2;
    // Quick reject: the ball is nowhere near the net.
    if (ballLocal.y > reach + 0.02 || ballLocal.y < -this.length - reach || Math.hypot(ballLocal.x, ballLocal.z) > this.R + reach) {
      this.contacts = 0;
      this.energy = 0;
      return 0;
    }
    for (const n of this.nodes) {
      if (n.pinned) continue;
      _tmp.subVectors(n.pos, ballLocal);
      const d = _tmp.length();
      if (d < reach && d > 1e-5) {
        const push = reach - d;
        n.pos.addScaledVector(_tmp, push / d);
        contacts++;
        energy += push;
      }
    }
    this.contacts = contacts;
    this.energy = energy;
    return contacts;
  }

  update(dt) {
    const gravity = -9.81;
    const damping = 0.985; // per step velocity retention: cords are light and swing
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
    for (let iter = 0; iter < 6; iter++) {
      for (const c of this.constraints) this._satisfy(c, 1);
      for (const c of this._brace) this._satisfy(c, 0.15, true);
    }
    this._updateGeometry();
  }

  _satisfy(c, stiffness, onlyStretch = false) {
    const a = this.nodes[c.a];
    const b = this.nodes[c.b];
    _tmp.subVectors(b.pos, a.pos);
    const d = _tmp.length() || 1e-5;
    if (onlyStretch && d < c.rest) return;
    const diff = ((d - c.rest) / d) * stiffness;
    const mulA = a.pinned ? 0 : b.pinned ? 1 : 0.5;
    const mulB = b.pinned ? 0 : a.pinned ? 1 : 0.5;
    a.pos.addScaledVector(_tmp, mulA * diff);
    b.pos.addScaledVector(_tmp, -mulB * diff);
  }

  _updateGeometry() {
    for (let i = 0; i < this.drawn; i++) {
      const c = this.constraints[i];
      const a = this.nodes[c.a].pos;
      const b = this.nodes[c.b].pos;
      _mid.addVectors(a, b).multiplyScalar(0.5);
      _dir.subVectors(b, a);
      const len = _dir.length() || 1e-5;
      _dir.divideScalar(len);
      _q.setFromUnitVectors(_up, _dir);
      _s.set(1, len, 1);
      _m.compose(_mid, _q, _s);
      this.cords.setMatrixAt(i, _m);
    }
    this.cords.instanceMatrix.needsUpdate = true;
    _q.identity();
    _s.set(1, 1, 1);
    for (let i = 0; i < this.nodes.length; i++) {
      _m.compose(this.nodes[i].pos, _q, _s);
      this.knots.setMatrixAt(i, _m);
    }
    this.knots.instanceMatrix.needsUpdate = true;
  }

  /** How far the net currently hangs from its rest shape (m, max over nodes). */
  displacement() {
    let m = 0;
    for (const n of this.nodes) m = Math.max(m, n.pos.distanceTo(n.home));
    return m;
  }
}
