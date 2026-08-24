import * as THREE from 'three';

/**
 * A large inward-facing sky dome with a vertical gradient shader, plus the
 * scene's fog. Cheap, no textures, and reads as a clean stylised sky that
 * matches the indie art direction better than an HDRI would.
 */
export class Sky {
  constructor(scene) {
    this.scene = scene;
    const geo = new THREE.SphereGeometry(400, 32, 16);
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x4a86c8) },
        bottomColor: { value: new THREE.Color(0xbfe0f2) },
        offset: { value: 8 },
        exponent: { value: 0.7 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPosition;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorldPosition = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
          float t = pow(max(h, 0.0), exponent);
          gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0);
        }
      `,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  apply(env) {
    this.material.uniforms.topColor.value.setHex(env.skyTop);
    this.material.uniforms.bottomColor.value.setHex(env.skyBottom);
    this.scene.fog = new THREE.Fog(env.fogColor, env.fogNear, env.fogFar);
  }
}
