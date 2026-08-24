import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { randRange, randInt } from '../core/MathUtils.js';

/**
 * Stylised low-poly trees. Each tree prototype (a tapered trunk plus a few
 * faceted foliage clusters) is merged into ONE geometry with baked vertex
 * colours, then drawn through a single InstancedMesh — one draw call for the
 * whole grove. Trees are scattered in the outer ring and given per-instance
 * rotation, scale and a subtle colour tint.
 */
export class Trees {
  constructor(scene, { count, innerHalfX, innerHalfZ, radius, foliageColors, trunkColor }) {
    const proto = this._buildPrototype(foliageColors, trunkColor);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0,
      flatShading: true,
    });
    const mesh = new THREE.InstancedMesh(proto, mat, count);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const dummy = new THREE.Object3D();
    const colors = new Float32Array(count * 3);
    const positions = [];
    let placed = 0;
    let guard = 0;
    const minTreeGap = 3.0;
    while (placed < count && guard < count * 30) {
      guard++;
      const ang = randRange(0, Math.PI * 2);
      const rad = randRange(Math.max(innerHalfX, innerHalfZ) + 4.5, radius);
      const x = Math.cos(ang) * rad;
      const z = Math.sin(ang) * rad;
      if (Math.abs(x) < innerHalfX + 3 && Math.abs(z) < innerHalfZ + 3) continue;
      let tooClose = false;
      for (const p of positions) {
        if (Math.hypot(p.x - x, p.z - z) < minTreeGap) { tooClose = true; break; }
      }
      if (tooClose) continue;
      positions.push({ x, z });
      const s = randRange(0.8, 1.6);
      dummy.position.set(x, 0, z);
      dummy.rotation.y = randRange(0, Math.PI * 2);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      mesh.setMatrixAt(placed, dummy.matrix);
      const tint = 0.85 + Math.random() * 0.3;
      colors[placed * 3] = tint;
      colors[placed * 3 + 1] = tint;
      colors[placed * 3 + 2] = tint;
      placed++;
    }
    mesh.count = placed;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    scene.add(mesh);
    this.mesh = mesh;
    this.positions = positions.slice(0, placed);
  }

  _buildPrototype(foliageColors, trunkColor) {
    const parts = [];

    // Trunk — tapered cylinder. Converted to non-indexed so every part shares
    // the same (index-free) attribute layout before merging.
    const trunkH = randRange(1.6, 2.2);
    const trunk = new THREE.CylinderGeometry(0.11, 0.2, trunkH, 6, 1).toNonIndexed();
    trunk.translate(0, trunkH / 2, 0);
    this._paint(trunk, trunkColor);
    parts.push(trunk);

    // Foliage — a few faceted icosahedron blobs clustered near the top.
    const nBlobs = randInt(3, 5);
    for (let i = 0; i < nBlobs; i++) {
      const r = randRange(0.7, 1.15);
      const blob = new THREE.IcosahedronGeometry(r, 0).toNonIndexed();
      const bx = randRange(-0.5, 0.5);
      const bz = randRange(-0.5, 0.5);
      const by = trunkH + randRange(0.2, 1.1);
      blob.scale(1, randRange(0.8, 1.05), 1);
      blob.translate(bx, by, bz);
      const col = foliageColors[randInt(0, foliageColors.length - 1)];
      this._paint(blob, col);
      parts.push(blob);
    }

    // Drop UVs — trunk (cylinder) and blobs (polyhedron) both carry them but we
    // only use vertex colours, and keeping them just risks layout mismatches.
    for (const p of parts) p.deleteAttribute('uv');

    const merged = BufferGeometryUtils.mergeGeometries(parts, false);
    merged.computeVertexNormals();
    return merged;
  }

  _paint(geo, hex) {
    const c = new THREE.Color(hex);
    const n = geo.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      // Slight per-vertex value noise for a hand-painted feel.
      const v = 0.9 + Math.random() * 0.2;
      arr[i * 3] = c.r * v;
      arr[i * 3 + 1] = c.g * v;
      arr[i * 3 + 2] = c.b * v;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
}
