import * as THREE from 'three';
import { COURT } from '../core/Constants.js';

/**
 * The park around the court: trees and grass clumps from the converted
 * asset packs, placed by a seeded scatter so every load is the same park.
 *
 * Everything is instanced. A model's node holds one object (the tree pack
 * arrives split into placeable trees, `tree_0 … tree_n`; the grass pack is
 * two clumps); each node's primitives become one InstancedMesh apiece, and
 * the node's own transform is folded into every instance matrix, which is
 * how the Z-up grass comes out upright.
 *
 * Trees get a trunk collider so neither the player nor a loose ball walks
 * through them. Grass has none — it is decoration you can wade into.
 */
export class Park {
  constructor(scene, physics, assets, { seed = 7, trees = 34, grass = 220 } = {}) {
    this.scene = scene;
    this.physics = physics;
    this.group = new THREE.Group();
    this.group.name = 'park';
    scene.add(this.group);

    const rand = mulberry32(seed);
    // The court and its apron, plus a margin nothing should crowd.
    const keepW = COURT.width / 2 + COURT.apron + 2.0;
    const keepL = COURT.length / 2 + COURT.apron + 2.0;
    const onCourt = (x, z) => Math.abs(x) < keepW && Math.abs(z) < keepL;

    this._placeTrees(assets.tree, rand, trees, { onCourt, keepW, keepL });
    this._placeGrass(assets.grass, rand, grass, { onCourt, keepW, keepL });
  }

  /** One InstancedMesh per primitive of each variant, filled from `spots`. */
  _instance(variant, spots, { castShadow, receiveShadow }) {
    variant.updateMatrixWorld(true);
    const m = new THREE.Matrix4();
    const tmp = new THREE.Matrix4();
    variant.traverse((o) => {
      if (!o.isMesh) return;
      const inst = new THREE.InstancedMesh(o.geometry, o.material, spots.length);
      inst.castShadow = castShadow;
      inst.receiveShadow = receiveShadow;
      spots.forEach((s, i) => {
        m.makeRotationY(s.yaw).scale(new THREE.Vector3(s.scale, s.scale, s.scale)).setPosition(s.x, 0, s.z);
        tmp.multiplyMatrices(m, o.matrixWorld);
        inst.setMatrixAt(i, tmp);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      this.group.add(inst);
    });
  }

  _placeTrees(treeScene, rand, count, { onCourt, keepW, keepL }) {
    const variants = treeScene.children.filter((n) => /^tree_\d+$/.test(n.name));
    if (!variants.length) return;
    // Bigger trees more often; the pack's saplings are the last variants.
    const heights = variants.map((v) => new THREE.Box3().setFromObject(v).max.y);
    const weights = heights.map((h) => 0.4 + h);
    const spots = variants.map(() => []);
    const placed = [];
    for (let tries = 0; placed.length < count && tries < count * 40; tries++) {
      // A ring around the court, thicker along the long sides.
      const ang = rand() * Math.PI * 2;
      const r = 12 + rand() * 30;
      const x = Math.cos(ang) * r * 1.15;
      const z = Math.sin(ang) * r;
      if (onCourt(x, z)) continue;
      if (Math.abs(x) < keepW + 3 && Math.abs(z) < keepL + 3) continue;
      if (placed.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 4.5 ** 2)) continue;
      const vi = pickWeighted(weights, rand());
      const spot = { x, z, yaw: rand() * Math.PI * 2, scale: 0.85 + rand() * 0.3, vi };
      placed.push(spot);
      spots[vi].push(spot);
    }
    variants.forEach((v, i) => spots[i].length && this._instance(v, spots[i], { castShadow: true, receiveShadow: true }));

    // Trunk colliders. The pack's trunks are ~0.25 m across at the base;
    // a slightly fat cylinder reads better than an exact one when you bump it.
    const { RAPIER } = this.physics;
    for (const p of placed) {
      const body = this.physics.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(p.x, 2, p.z));
      this.physics.createCollider(RAPIER.ColliderDesc.cylinder(2, 0.22 * p.scale).setRestitution(0.3).setFriction(0.8), body);
    }
    this.trees = placed;
  }

  _placeGrass(grassScene, rand, count, { onCourt, keepW, keepL }) {
    const variants = grassScene.children.filter((n) => n.isObject3D);
    if (!variants.length) return;
    const spots = variants.map(() => []);
    const placed = [];
    for (let tries = 0; placed.length < count && tries < count * 30; tries++) {
      // A band hugging the court, thinning out with distance.
      const side = rand();
      const d = 0.4 + Math.pow(rand(), 1.6) * 14;
      let x, z;
      if (side < 0.5) { x = (rand() * 2 - 1) * (keepW + d); z = (rand() < 0.5 ? -1 : 1) * (keepL + d); }
      else { x = (rand() < 0.5 ? -1 : 1) * (keepW + d); z = (rand() * 2 - 1) * (keepL + d); }
      if (onCourt(x, z)) continue;
      if (placed.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 1.1 ** 2)) continue;
      const vi = Math.floor(rand() * variants.length);
      const spot = { x, z, yaw: rand() * Math.PI * 2, scale: 0.6 + rand() * 0.55, vi };
      placed.push(spot);
      spots[vi].push(spot);
    }
    variants.forEach((v, i) => spots[i].length && this._instance(v, spots[i], { castShadow: false, receiveShadow: true }));
    this.grass = placed;
  }
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
