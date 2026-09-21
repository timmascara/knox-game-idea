import * as THREE from 'three';
import { COURT } from '../core/Constants.js';

/**
 * The park around the court: trees, rough grass, a chain-link fence, benches
 * and a path, placed by a seeded scatter so every load is the same park.
 *
 * Scattered models are instanced — one InstancedMesh per primitive per
 * variant. The variant node's **rotation and scale** are folded into each
 * instance matrix (that is what stands the Z-up grass upright) but its
 * **translation is dropped**: the tree pack is split from one 46 m grove, so
 * each variant node still carries where it stood in that grove. Folding that
 * in scattered trees up to 27 m from where they were placed, including on to
 * the court.
 *
 * Trees get a trunk collider. Grass does not — it is decoration you wade into.
 */
// Metres covered by one repeat of the chain-link texture. The texture holds
// four diamonds, so this over four is the diamond size: ~12 cm, which is
// close to real fencing. At 2.2 m it read as garden trellis.
const CHAINLINK_TILE = 0.48;

export class Park {
  constructor(scene, physics, assets, { seed = 7, trees = 56, grass = 1500 } = {}) {
    this.scene = scene;
    this.physics = physics;
    this.group = new THREE.Group();
    this.group.name = 'park';
    scene.add(this.group);

    const rand = mulberry32(seed);
    // The court, its apron, and the fence line outside that.
    this.halfW = COURT.width / 2 + COURT.apron;
    this.halfL = COURT.length / 2 + COURT.apron;
    this.fenceW = this.halfW + 1.6;
    this.fenceL = this.halfL + 1.6;

    this._buildFence();
    this._buildBenches();
    this._placeTrees(assets.tree, rand, trees);
    this._placeGrass(assets.grass, rand, grass);
  }

  /** Distance from the fence rectangle; negative inside it. */
  _outside(x, z, margin = 0) {
    const dx = Math.abs(x) - (this.fenceW + margin);
    const dz = Math.abs(z) - (this.fenceL + margin);
    return Math.max(dx, dz);
  }

  /**
   * One InstancedMesh per primitive of `variant`, filled from `spots`.
   * See the class note on why the variant's translation is discarded.
   */
  _instance(variant, spots, { castShadow, receiveShadow }) {
    variant.updateMatrixWorld(true);
    const local = new THREE.Matrix4();
    const m = new THREE.Matrix4();
    const tmp = new THREE.Matrix4();
    const scl = new THREE.Vector3();
    variant.traverse((o) => {
      if (!o.isMesh) return;
      // Orientation and scale only — no translation.
      local.copy(o.matrixWorld).setPosition(0, 0, 0);
      const inst = new THREE.InstancedMesh(o.geometry, o.material, spots.length);
      inst.castShadow = castShadow;
      inst.receiveShadow = receiveShadow;
      spots.forEach((s, i) => {
        scl.set(s.scale, s.scale, s.scale);
        m.makeRotationY(s.yaw).scale(scl).setPosition(s.x, s.y || 0, s.z);
        tmp.multiplyMatrices(m, local);
        inst.setMatrixAt(i, tmp);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      inst.frustumCulled = false;
      this.group.add(inst);
    });
  }

  _placeTrees(treeScene, rand, count) {
    const variants = treeScene.children.filter((n) => /^tree_\d+$/.test(n.name));
    if (!variants.length) return;
    // Favour the taller variants; the pack's saplings are the short ones.
    const heights = variants.map((v) => new THREE.Box3().setFromObject(v).max.y);
    const weights = heights.map((h) => 0.5 + h);
    const spots = variants.map(() => []);
    const placed = [];

    // A belt around the fence: dense just beyond it, thinning with distance.
    for (let tries = 0; placed.length < count && tries < count * 60; tries++) {
      const ang = rand() * Math.PI * 2;
      const out = 3.0 + Math.pow(rand(), 0.75) * 40;
      const x = Math.cos(ang) * (this.fenceW + out);
      const z = Math.sin(ang) * (this.fenceL + out);
      // Hard clearance: nothing within 3 m of the fence, ever.
      if (this._outside(x, z, 3) < 0) continue;
      if (placed.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 3.6 ** 2)) continue;
      const vi = pickWeighted(weights, rand());
      const spot = { x, z, yaw: rand() * Math.PI * 2, scale: 0.8 + rand() * 0.45, vi };
      placed.push(spot);
      spots[vi].push(spot);
    }
    variants.forEach((v, i) => spots[i].length && this._instance(v, spots[i], { castShadow: true, receiveShadow: true }));

    const { RAPIER } = this.physics;
    for (const p of placed) {
      const body = this.physics.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(p.x, 2.5, p.z));
      this.physics.createCollider(
        RAPIER.ColliderDesc.cylinder(2.5, 0.26 * p.scale).setRestitution(0.3).setFriction(0.8),
        body
      );
    }
    this.trees = placed;
  }

  /**
   * Rough grass. The pack's clump is ~1.9 m across, which at full size reads
   * as a bush and leaves bald ground between — the first cut's "grass in
   * clumps" problem. Scaled right down and scattered in overlapping drifts
   * instead, it reads as continuous rough grass at the court's edge.
   */
  _placeGrass(grassScene, rand, count) {
    const variants = grassScene.children.filter((n) => n.isObject3D);
    if (!variants.length) return;
    const spots = variants.map(() => []);
    let placed = 0;

    // Seed a handful of drift centres, then cluster tufts around them.
    const drifts = [];
    for (let i = 0; i < 44; i++) {
      const ang = rand() * Math.PI * 2;
      const out = 0.3 + Math.pow(rand(), 1.5) * 26;
      drifts.push({ x: Math.cos(ang) * (this.fenceW + out), z: Math.sin(ang) * (this.fenceL + out), r: 2.5 + rand() * 5 });
    }

    for (let tries = 0; placed < count && tries < count * 20; tries++) {
      let x, z;
      if (rand() < 0.78) {
        const d = drifts[(rand() * drifts.length) | 0];
        const a = rand() * Math.PI * 2;
        const rr = Math.sqrt(rand()) * d.r;
        x = d.x + Math.cos(a) * rr;
        z = d.z + Math.sin(a) * rr;
      } else {
        const ang = rand() * Math.PI * 2;
        const out = 0.2 + Math.pow(rand(), 1.4) * 40;
        x = Math.cos(ang) * (this.fenceW + out);
        z = Math.sin(ang) * (this.fenceL + out);
      }
      // Grass grows right up to the fence, but never on the asphalt.
      if (this._outside(x, z, 0.15) < 0) continue;
      const vi = (rand() * variants.length) | 0;
      // Small, and varied — a tuft, not a shrub.
      spots[vi].push({ x, z, yaw: rand() * Math.PI * 2, scale: 0.16 + Math.pow(rand(), 2) * 0.3 });
      placed++;
    }
    variants.forEach((v, i) => spots[i].length && this._instance(v, spots[i], { castShadow: false, receiveShadow: true }));
    this.grass = placed;
  }

  /**
   * Chain-link fencing on the two long sides and behind each hoop, with a
   * gap at half-court on each side to walk through. The mesh is a generated
   * alpha texture rather than geometry — at this distance a drawn diamond
   * weave reads better than anything affordable in triangles.
   */
  _buildFence() {
    const H = 3.2;
    const tex = chainLinkTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: tex, alphaTest: 0.45, transparent: false, side: THREE.DoubleSide,
      color: 0xb9c2c6, roughness: 0.65, metalness: 0.35,
    });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x8e979b, roughness: 0.55, metalness: 0.45 });
    const { RAPIER } = this.physics;
    const gap = 3.0; // walk-through at half court, both long sides

    const panel = (x1, z1, x2, z2) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 0.2) return;
      const g = new THREE.PlaneGeometry(len, H);
      const mesh = new THREE.Mesh(g, mat.clone());
      mesh.material.map = tex.clone();
      mesh.material.map.needsUpdate = true;
      mesh.material.map.repeat.set(len / CHAINLINK_TILE, H / CHAINLINK_TILE);
      mesh.material.map.wrapS = mesh.material.map.wrapT = THREE.RepeatWrapping;
      mesh.position.set((x1 + x2) / 2, H / 2, (z1 + z2) / 2);
      mesh.rotation.y = Math.atan2(x2 - x1, z2 - z1) + Math.PI / 2;
      mesh.receiveShadow = true;
      this.group.add(mesh);

      const body = this.physics.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(mesh.position.x, H / 2, mesh.position.z)
          .setRotation({ x: 0, y: Math.sin(mesh.rotation.y / 2), z: 0, w: Math.cos(mesh.rotation.y / 2) })
      );
      this.physics.createCollider(
        RAPIER.ColliderDesc.cuboid(len / 2, H / 2, 0.05).setRestitution(0.25).setFriction(0.7),
        body
      );
    };

    const W = this.fenceW, L = this.fenceL;
    for (const sx of [-1, 1]) {
      panel(sx * W, -L, sx * W, -gap / 2);
      panel(sx * W, gap / 2, sx * W, L);
    }
    for (const sz of [-1, 1]) panel(-W, sz * L, W, sz * L);

    // Posts at the corners, the gaps and along the runs.
    const postAt = (x, z) => {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, H + 0.18, 8), postMat);
      p.position.set(x, (H + 0.18) / 2, z);
      p.castShadow = true;
      this.group.add(p);
    };
    for (const sx of [-1, 1]) {
      for (let z = -L; z <= L + 0.01; z += L / 4) postAt(sx * W, z);
      postAt(sx * W, -gap / 2); postAt(sx * W, gap / 2);
    }
    for (const sz of [-1, 1]) for (let x = -W; x <= W + 0.01; x += W / 3) postAt(x, sz * L);
  }

  /** A couple of courtside benches, the kind that are always there. */
  _buildBenches() {
    const slat = new THREE.MeshStandardMaterial({ color: 0x6b4f32, roughness: 0.85 });
    const frame = new THREE.MeshStandardMaterial({ color: 0x2f3438, roughness: 0.5, metalness: 0.5 });
    const { RAPIER } = this.physics;

    const bench = (x, z, yaw) => {
      const g = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.055, 0.13), slat);
        s.position.set(0, 0.44, -0.16 + i * 0.16);
        s.castShadow = true; s.receiveShadow = true;
        g.add(s);
      }
      for (let i = 0; i < 2; i++) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.13, 0.05), slat);
        s.position.set(0, 0.72 + i * 0.17, -0.24);
        s.castShadow = true;
        g.add(s);
      }
      for (const sx of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.44, 0.5), frame);
        leg.position.set(sx * 0.78, 0.22, -0.02);
        leg.castShadow = true;
        g.add(leg);
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.05), frame);
        back.position.set(sx * 0.78, 0.6, -0.24);
        g.add(back);
      }
      g.position.set(x, 0, z);
      g.rotation.y = yaw;
      this.group.add(g);

      const body = this.physics.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, 0.45, z));
      this.physics.createCollider(RAPIER.ColliderDesc.cuboid(0.9, 0.45, 0.3).setRestitution(0.3).setFriction(0.8), body);
    };

    bench(-(this.fenceW + 1.4), -4.5, Math.PI / 2);
    bench(-(this.fenceW + 1.4), 4.5, Math.PI / 2);
    bench(this.fenceW + 1.4, 0, -Math.PI / 2);
  }
}

/**
 * A diamond chain-link weave drawn to an alpha-tested texture. Two crossed
 * sets of strokes over transparency, with the wire slightly lighter on one
 * diagonal so it does not read as a flat grid.
 */
function chainLinkTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  ctx.lineCap = 'square';
  for (const [dir, shade, w] of [[1, '#e8eef0', 3], [-1, '#c3ccd0', 3]]) {
    ctx.strokeStyle = shade;
    ctx.lineWidth = w;
    for (let i = -S; i < S * 2; i += S / 4) {
      ctx.beginPath();
      ctx.moveTo(i, dir > 0 ? 0 : S);
      ctx.lineTo(i + S, dir > 0 ? S : 0);
      ctx.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Small, seedable PRNG so the park is the same every load. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(weights, u) {
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < weights.length; i++) { acc += weights[i] / total; if (u < acc) return i; }
  return weights.length - 1;
}
