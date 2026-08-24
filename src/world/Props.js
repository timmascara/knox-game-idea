import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { randRange, randInt } from '../core/MathUtils.js';

/**
 * Static park props: a chain-link fence around the court, benches facing in,
 * a path, and instanced rocks + bushes. Repeated elements (fence posts, rocks,
 * bushes) go through InstancedMesh; the handful of benches are merged into one
 * geometry each. Colliders are added for the fence and benches so the ball and
 * player interact with them.
 */
export class Props {
  constructor(scene, physics, opts) {
    this.scene = scene;
    this.physics = physics;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.opts = opts;

    this._buildFence();
    this._buildBenches();
    this._buildPath();
    this._buildRocks();
    this._buildBushes();
  }

  // --- Chain-link fence ------------------------------------------------------
  _chainTexture() {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);
    ctx.strokeStyle = 'rgba(200,205,205,0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = -128; i < 256; i += 24) {
      ctx.moveTo(i, 0); ctx.lineTo(i + 128, 128);
      ctx.moveTo(i + 128, 0); ctx.lineTo(i, 128);
    }
    ctx.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  _buildFence() {
    const { fenceHalfX, fenceHalfZ, fenceHeight = 2.6 } = this.opts;
    const postMat = new THREE.MeshStandardMaterial({ color: 0x9aa4a6, roughness: 0.6, metalness: 0.5 });
    const meshTex = this._chainTexture();

    // Fence runs as 4 sides with a gate gap on the +X sideline.
    const segments = [
      { a: [-fenceHalfX, -fenceHalfZ], b: [fenceHalfX, -fenceHalfZ] }, // baseline -Z
      { a: [-fenceHalfX, fenceHalfZ], b: [fenceHalfX, fenceHalfZ] }, // baseline +Z
      { a: [-fenceHalfX, -fenceHalfZ], b: [-fenceHalfX, fenceHalfZ] }, // sideline -X
      // +X sideline split into two with a gate gap in the middle
      { a: [fenceHalfX, -fenceHalfZ], b: [fenceHalfX, -1.6] },
      { a: [fenceHalfX, 1.6], b: [fenceHalfX, fenceHalfZ] },
    ];

    // Count posts for instancing.
    const postPositions = [];
    const railGeos = [];
    for (const seg of segments) {
      const ax = seg.a[0], az = seg.a[1], bx = seg.b[0], bz = seg.b[1];
      const len = Math.hypot(bx - ax, bz - az);
      const nPosts = Math.max(2, Math.round(len / 2.4));
      for (let i = 0; i <= nPosts; i++) {
        const t = i / nPosts;
        postPositions.push([ax + (bx - ax) * t, az + (bz - az) * t]);
      }
      // Mesh panel
      const panel = new THREE.PlaneGeometry(len, fenceHeight);
      const midX = (ax + bx) / 2;
      const midZ = (az + bz) / 2;
      const ang = Math.atan2(bz - az, bx - ax);
      panel.rotateY(-ang);
      panel.translate(midX, fenceHeight / 2, midZ);
      panel.setAttribute('uv', this._panelUV(panel, len, fenceHeight));
      railGeos.push(panel);
    }

    // Posts (instanced)
    const postGeo = new THREE.CylinderGeometry(0.045, 0.045, fenceHeight + 0.15, 8);
    postGeo.translate(0, (fenceHeight + 0.15) / 2, 0);
    const posts = new THREE.InstancedMesh(postGeo, postMat, postPositions.length);
    posts.castShadow = true;
    const d = new THREE.Object3D();
    postPositions.forEach((p, i) => {
      d.position.set(p[0], 0, p[1]);
      d.updateMatrix();
      posts.setMatrixAt(i, d.matrix);
    });
    this.group.add(posts);

    // Chain-link panels merged
    const mergedPanels = BufferGeometryUtils.mergeGeometries(railGeos, false);
    const panelMesh = new THREE.Mesh(
      mergedPanels,
      new THREE.MeshStandardMaterial({
        map: meshTex,
        transparent: true,
        alphaTest: 0.25,
        side: THREE.DoubleSide,
        roughness: 0.7,
        metalness: 0.3,
        color: 0xcfd6d6,
      })
    );
    this.group.add(panelMesh);

    // Top rails as thin boxes + physics colliders for each side.
    const { RAPIER } = this.physics;
    const railMat = postMat;
    for (const seg of segments) {
      const ax = seg.a[0], az = seg.a[1], bx = seg.b[0], bz = seg.b[1];
      const len = Math.hypot(bx - ax, bz - az);
      const midX = (ax + bx) / 2, midZ = (az + bz) / 2;
      const ang = Math.atan2(bz - az, bx - ax);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.06), railMat);
      rail.position.set(midX, fenceHeight, midZ);
      rail.rotation.y = -ang;
      this.group.add(rail);

      // Thin collider wall for the fence line.
      const body = this.physics.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(midX, fenceHeight / 2, midZ)
          .setRotation(this._yQuat(-ang))
      );
      this.physics.createCollider(
        RAPIER.ColliderDesc.cuboid(len / 2, fenceHeight / 2, 0.04)
          .setRestitution(0.35)
          .setFriction(0.6),
        body
      );
    }
  }

  _panelUV(geo, len, height) {
    // Repeat the chain texture roughly square.
    const uvAttr = geo.attributes.uv;
    const arr = uvAttr.array.slice();
    const repX = len / 1.2;
    const repY = height / 1.2;
    for (let i = 0; i < arr.length; i += 2) {
      arr[i] *= repX;
      arr[i + 1] *= repY;
    }
    return new THREE.BufferAttribute(arr, 2);
  }

  _yQuat(angle) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    return { x: q.x, y: q.y, z: q.z, w: q.w };
  }

  // --- Benches ---------------------------------------------------------------
  _benchGeometry() {
    const parts = [];
    const seatMat = 0x8a5a34;
    const slat = (w, h, d, x, y, z) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, y, z);
      this._paintGeo(g, seatMat);
      parts.push(g);
    };
    // seat slats
    for (let i = 0; i < 3; i++) slat(1.6, 0.05, 0.12, 0, 0.45, -0.18 + i * 0.15);
    // back slats
    for (let i = 0; i < 2; i++) {
      const g = new THREE.BoxGeometry(1.6, 0.12, 0.05);
      g.translate(0, 0.7 + i * 0.16, -0.32);
      this._paintGeo(g, seatMat);
      parts.push(g);
    }
    // legs (metal)
    const legMat = 0x3a4042;
    const leg = (x, z) => {
      const g = new THREE.BoxGeometry(0.08, 0.45, 0.08);
      g.translate(x, 0.225, z);
      this._paintGeo(g, legMat);
      parts.push(g);
      const gb = new THREE.BoxGeometry(0.08, 0.5, 0.08);
      gb.translate(x, 0.5, z - 0.32);
      this._paintGeo(gb, legMat);
      parts.push(gb);
    };
    leg(-0.7, 0); leg(0.7, 0);
    return BufferGeometryUtils.mergeGeometries(parts, false);
  }

  _buildBenches() {
    const benchGeo = this._benchGeometry();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    const { fenceHalfX, fenceHalfZ } = this.opts;
    // Intentional placements: facing the court from a few spots.
    const spots = [
      { x: 0, z: fenceHalfZ - 1.0, ry: Math.PI },
      { x: -fenceHalfX + 1.0, z: -3, ry: Math.PI / 2 },
      { x: -fenceHalfX + 1.0, z: 3, ry: Math.PI / 2 },
      { x: fenceHalfX - 1.0, z: fenceHalfZ - 2, ry: -Math.PI / 2 },
    ];
    const { RAPIER } = this.physics;
    for (const s of spots) {
      const m = new THREE.Mesh(benchGeo, mat);
      m.position.set(s.x, 0, s.z);
      m.rotation.y = s.ry;
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
      const body = this.physics.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(s.x, 0.45, s.z).setRotation(this._yQuat(s.ry))
      );
      this.physics.createCollider(
        RAPIER.ColliderDesc.cuboid(0.8, 0.45, 0.35).setRestitution(0.25).setFriction(0.8),
        body
      );
    }
  }

  // --- Path ------------------------------------------------------------------
  _buildPath() {
    const { fenceHalfZ } = this.opts;
    const w = 2.0;
    const len = 22;
    const geo = new THREE.PlaneGeometry(w, len, 1, 12);
    geo.rotateX(-Math.PI / 2);
    // Curve the path a little.
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      pos.setX(i, pos.getX(i) + Math.sin((z / len) * Math.PI) * 1.5);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x9c8f74, roughness: 1.0 });
    const path = new THREE.Mesh(geo, mat);
    path.position.set(3.5, 0.015, fenceHalfZ + len / 2 - 1);
    path.receiveShadow = true;
    this.group.add(path);
  }

  // --- Rocks (instanced) -----------------------------------------------------
  _buildRocks() {
    const count = this.opts.rockCount ?? 40;
    const geo = new THREE.IcosahedronGeometry(0.4, 0);
    // jitter vertices for irregular rocks
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      p.setXYZ(i, p.getX(i) * randRange(0.7, 1.2), p.getY(i) * randRange(0.5, 0.9), p.getZ(i) * randRange(0.7, 1.2));
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x7d7b74, roughness: 1.0, flatShading: true });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const d = new THREE.Object3D();
    const { fenceHalfX, fenceHalfZ, radius } = this.opts;
    let placed = 0, guard = 0;
    while (placed < count && guard < count * 20) {
      guard++;
      const x = randRange(-radius, radius);
      const z = randRange(-radius, radius);
      if (Math.abs(x) < fenceHalfX + 1.5 && Math.abs(z) < fenceHalfZ + 1.5) continue;
      if (Math.hypot(x, z) > radius) continue;
      d.position.set(x, randRange(-0.05, 0.1), z);
      d.rotation.set(randRange(0, 6), randRange(0, 6), randRange(0, 6));
      d.scale.setScalar(randRange(0.5, 1.8));
      d.updateMatrix();
      mesh.setMatrixAt(placed++, d.matrix);
    }
    mesh.count = placed;
    this.group.add(mesh);
  }

  // --- Bushes (instanced) ----------------------------------------------------
  _buildBushes() {
    const count = this.opts.bushCount ?? 26;
    const foliage = this.opts.foliageColors ?? [0x4a6b34];
    // Merge a couple of blobs into one bush prototype.
    const parts = [];
    for (let i = 0; i < 3; i++) {
      const b = new THREE.IcosahedronGeometry(randRange(0.35, 0.55), 0);
      b.translate(randRange(-0.3, 0.3), randRange(0.1, 0.4), randRange(-0.3, 0.3));
      this._paintGeo(b, foliage[randInt(0, foliage.length - 1)]);
      parts.push(b);
    }
    const geo = BufferGeometryUtils.mergeGeometries(parts, false);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const d = new THREE.Object3D();
    const { fenceHalfX, fenceHalfZ, radius } = this.opts;
    let placed = 0, guard = 0;
    while (placed < count && guard < count * 20) {
      guard++;
      const x = randRange(-radius, radius);
      const z = randRange(-radius, radius);
      if (Math.abs(x) < fenceHalfX + 1.2 && Math.abs(z) < fenceHalfZ + 1.2) continue;
      if (Math.hypot(x, z) > radius) continue;
      d.position.set(x, 0, z);
      d.rotation.y = randRange(0, 6);
      d.scale.setScalar(randRange(0.7, 1.5));
      d.updateMatrix();
      mesh.setMatrixAt(placed++, d.matrix);
    }
    mesh.count = placed;
    this.group.add(mesh);
  }

  _paintGeo(geo, hex) {
    const c = new THREE.Color(hex);
    const n = geo.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = 0.9 + Math.random() * 0.2;
      arr[i * 3] = c.r * v; arr[i * 3 + 1] = c.g * v; arr[i * 3 + 2] = c.b * v;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
}
