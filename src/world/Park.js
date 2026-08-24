import * as THREE from 'three';
import { COURT } from '../core/Constants.js';
import { Sky } from './Sky.js';
import { Court } from './Court.js';
import { Hoop } from './Hoop.js';
import { Grass } from './Grass.js';
import { Trees } from './Trees.js';
import { Props } from './Props.js';
import { Weather } from './Weather.js';
import { ENVIRONMENTS } from './environments.js';

/**
 * Assembles the whole outdoor scene: terrain + ground collider, sky, sun +
 * ambient lighting, the court, two hoops, and the instanced vegetation/props.
 * Environment presets are applied here so the same geometry can be reskinned as
 * afternoon / fall / dusk / rain without rebuilding anything.
 */
export class Park {
  constructor(scene, physics, renderer, settings) {
    this.scene = scene;
    this.physics = physics;
    this.renderer = renderer;
    this.settings = settings;
    this.quality = settings.get('quality');

    this.sky = new Sky(scene);
    this._buildLights();
    this._buildTerrain();

    const env = ENVIRONMENTS[settings.get('environment')] || ENVIRONMENTS.afternoon;

    this.court = new Court(scene, physics, {
      surface: '#4f7c8a',
      apron: '#37545e',
      key: '#c2683c',
      line: '#eef2f0',
    });

    // Two hoops at the ends of the court.
    const basketZ = COURT.length / 2 - COURT.rimFromBaseline;
    this.hoops = [
      new Hoop(scene, physics, new THREE.Vector3(0, 3.05, basketZ), +1),
      new Hoop(scene, physics, new THREE.Vector3(0, 3.05, -basketZ), -1),
    ];

    this._buildVegetation(env);
    this.weather = new Weather(scene);

    this.applyEnvironment(settings.get('environment'));
  }

  _buildLights() {
    this.hemi = new THREE.HemisphereLight(0xbfe0f2, 0x5b6b46, 0.75);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff2d6, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(this.quality === 'low' ? 1024 : 2048, this.quality === 'low' ? 1024 : 2048);
    const s = 26;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 90;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
  }

  _buildTerrain() {
    // Large gently undulating ground plane. The court sits flat at the centre.
    const size = 300;
    const seg = 96;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const distToCourt = Math.max(0, Math.hypot(x, z) - 22);
      // Keep it flat near the court, roll it out further away.
      const h =
        (Math.sin(x * 0.03) * Math.cos(z * 0.025) * 1.6 + Math.sin(x * 0.08 + z * 0.05) * 0.6) *
        Math.min(1, distToCourt / 30);
      pos.setY(i, h);
    }
    geo.computeVertexNormals();
    this.terrainMat = new THREE.MeshStandardMaterial({ color: 0x5f7742, roughness: 1.0, metalness: 0 });
    this.terrain = new THREE.Mesh(geo, this.terrainMat);
    this.terrain.receiveShadow = true;
    this.scene.add(this.terrain);

    // Flat ground physics collider at y=0 (the court + near field are flat).
    const { RAPIER } = this.physics;
    const body = this.physics.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
    this.physics.createCollider(
      RAPIER.ColliderDesc.cuboid(size / 2, 0.5, size / 2).setRestitution(0.4).setFriction(0.95),
      body
    );
  }

  _buildVegetation(env) {
    const q = this.quality;
    const grassCount = q === 'low' ? 6000 : q === 'medium' ? 14000 : 26000;
    const treeCount = q === 'low' ? 40 : q === 'medium' ? 70 : 110;
    const innerHalfX = COURT.width / 2 + 2.5;
    const innerHalfZ = COURT.length / 2 + 2.5;
    const radius = 95;

    this.grass = new Grass(this.scene, {
      count: grassCount,
      innerHalfX,
      innerHalfZ,
      radius: 70,
      color: env.grass,
      colorDry: env.grassDry,
      quality: q,
    });

    this.trees = new Trees(this.scene, {
      count: treeCount,
      innerHalfX,
      innerHalfZ,
      radius,
      foliageColors: env.foliage,
      trunkColor: env.trunk,
    });

    const fenceHalfX = COURT.width / 2 + 1.9;
    const fenceHalfZ = COURT.length / 2 + 1.9;
    this.props = new Props(this.scene, this.physics, {
      fenceHalfX,
      fenceHalfZ,
      fenceHeight: 2.7,
      radius: 60,
      foliageColors: env.foliage,
      rockCount: q === 'low' ? 24 : 46,
      bushCount: q === 'low' ? 16 : 30,
    });
  }

  applyEnvironment(key) {
    const env = ENVIRONMENTS[key] || ENVIRONMENTS.afternoon;
    this.currentEnv = env;
    this.sky.apply(env);

    this.hemi.color.setHex(env.hemiSky);
    this.hemi.groundColor.setHex(env.hemiGround);
    this.hemi.intensity = env.hemiIntensity;

    this.sun.color.setHex(env.sunColor);
    this.sun.intensity = env.sunIntensity;
    this.sun.position.set(...env.sunPosition);
    this.sun.target.position.set(0, 0, 0);

    this.terrainMat.color.setHex(env.ground);

    if (this.renderer) this.renderer.toneMappingExposure = env.exposure;

    // Wet look for rain.
    const wet = !!env.rain;
    this.court.mesh.material.roughness = wet ? 0.35 : 0.82;
    this.court.mesh.material.metalness = wet ? 0.15 : 0.0;
    this.court.mesh.material.needsUpdate = true;
    if (this.weather) this.weather.setEnabled(wet);

    this.settings.set('environment', key);
  }

  /** Keep the sun's shadow frustum following the player. */
  update(dt, playerPos) {
    this.grass.update(dt);
    this.sun.position.set(
      playerPos.x + this.currentEnv.sunPosition[0],
      this.currentEnv.sunPosition[1],
      playerPos.z + this.currentEnv.sunPosition[2]
    );
    this.sun.target.position.set(playerPos.x, 0, playerPos.z);
    this.sun.target.updateMatrixWorld();

    for (const h of this.hoops) h.updateBall = null; // reset per-frame marker
    if (this.weather) this.weather.update(dt, playerPos);
  }

  nearestHoop(pos) {
    let best = null;
    let bestD = Infinity;
    for (const h of this.hoops) {
      const d = h.getRimCenter().distanceToSquared(pos);
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    return best;
  }
}
