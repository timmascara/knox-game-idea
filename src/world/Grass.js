import * as THREE from 'three';
import { randRange } from '../core/MathUtils.js';

/**
 * GPU-instanced grass. A single tapered blade geometry is drawn thousands of
 * times through one InstancedMesh, with a wind animation injected into the
 * standard material's vertex shader (so it still lights + shadows correctly).
 * Blades are scattered in a ring around the court and skip the play surface.
 */
export class Grass {
  constructor(scene, { count, innerHalfX, innerHalfZ, radius, color, colorDry, quality }) {
    this.time = 0;
    const blade = this._bladeGeometry();

    // Per-instance wind phase attribute.
    const phases = new Float32Array(count);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide,
      vertexColors: true,
    });

    this.uniforms = { uTime: { value: 0 }, uWind: { value: 0.18 } };
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.uniforms.uWind = this.uniforms.uWind;
      shader.vertexShader =
        `attribute float aPhase;\nuniform float uTime;\nuniform float uWind;\nvarying float vH;\n` +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          /* glsl */ `
            #include <begin_vertex>
            vH = uv.y;
            float sway = sin(uTime * 1.6 + aPhase) * 0.5 + sin(uTime * 3.1 + aPhase * 1.7) * 0.5;
            float bend = uv.y * uv.y * uWind;
            transformed.x += sway * bend;
            transformed.z += cos(uTime * 1.3 + aPhase) * bend * 0.6;
          `
        );
      // Slightly darken the base for grounding.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>`
      );
    };

    const mesh = new THREE.InstancedMesh(blade, mat, count);
    mesh.castShadow = false;
    // Blades don't receive shadows — thin near-vertical geometry reads as ugly
    // dark spikes when self-shadowed; unshadowed it stays lush and readable.
    mesh.receiveShadow = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const dummy = new THREE.Object3D();
    const cDry = new THREE.Color(colorDry);
    const cWet = new THREE.Color(color);
    const colors = new Float32Array(count * 3);
    let placed = 0;
    let guard = 0;
    while (placed < count && guard < count * 12) {
      guard++;
      const x = randRange(-radius, radius);
      const z = randRange(-radius, radius);
      // Skip the court footprint (plus margin) and anything outside the ring.
      if (Math.abs(x) < innerHalfX + 0.6 && Math.abs(z) < innerHalfZ + 0.6) continue;
      if (Math.hypot(x, z) > radius) continue;
      const s = randRange(0.55, 1.25);
      dummy.position.set(x, 0, z);
      dummy.rotation.y = randRange(0, Math.PI * 2);
      dummy.scale.set(randRange(0.7, 1.2), s, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(placed, dummy.matrix);
      phases[placed] = randRange(0, Math.PI * 2);
      const tint = cWet.clone().lerp(cDry, Math.random() * 0.6);
      colors[placed * 3] = tint.r;
      colors[placed * 3 + 1] = tint.g;
      colors[placed * 3 + 2] = tint.b;
      placed++;
    }
    mesh.count = placed;
    blade.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);

    scene.add(mesh);
    this.mesh = mesh;
  }

  _bladeGeometry() {
    // A tapered blade: 2 quads stacked, narrowing to a point. UV.y = height.
    const h = 0.42;
    const w = 0.035;
    const g = new THREE.BufferGeometry();
    const verts = [
      -w, 0, 0, w, 0, 0, -w * 0.6, h * 0.5, 0,
      w, 0, 0, w * 0.6, h * 0.5, 0, -w * 0.6, h * 0.5, 0,
      -w * 0.6, h * 0.5, 0, w * 0.6, h * 0.5, 0, 0, h, 0,
    ];
    const uvs = [0, 0, 1, 0, 0, 0.5, 1, 0, 1, 0.5, 0, 0.5, 0, 0.5, 1, 0.5, 0.5, 1];
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    return g;
  }

  update(dt) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
  }
}
