import * as THREE from 'three';
import { COURT, HOOP } from '../core/Constants.js';
import { Sky } from './Sky.js';
import { Court } from './Court.js';
import { Hoop } from './Hoop.js';
import { Park } from './Park.js';

/**
 * A park court: an asphalt slab with regulation markings and two hoops, on
 * a grass ground, ringed by trees and grass clumps from the converted asset
 * packs (see Park.js), a ring of distant hills for a horizon and a warm
 * late-afternoon sun. `assets` comes from loadParkAssets(); without it the
 * world still builds, as the old flat greybox, which is what the harnesses
 * that construct a World directly get.
 */
export class World {
  constructor(scene, physics, quality = 'high', assets = null) {
    this.scene = scene;
    this.physics = physics;
    this.quality = quality;
    this.assets = assets;

    this.sky = new Sky(scene);
    this.sky.apply({ skyTop: 0x5f9ad6, skyBottom: 0xf6e3c6, fogColor: 0xe9dcc4, fogNear: 80, fogFar: 320 });

    this._buildLights();
    this._buildGround();
    this._buildHorizon();

    this.court = new Court(scene, physics, {
      surface: '#6e7673',
      apron: '#5d6462',
      key: '#b8573d',
      line: '#f0f0ea',
      asphalt: assets?.asphalt ?? null,
    });

    if (assets) this.park = new Park(scene, physics, assets);

    const basketZ = COURT.length / 2 - COURT.rimFromBaseline;
    this.hoops = [
      new Hoop(scene, physics, new THREE.Vector3(0, HOOP.rimHeight, basketZ), +1),
      new Hoop(scene, physics, new THREE.Vector3(0, HOOP.rimHeight, -basketZ), -1),
    ];
  }

  _buildLights() {
    this.hemi = new THREE.HemisphereLight(0xcde3f6, 0x7a7154, 0.95);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffdfb4, 3.8);
    this.sun.castShadow = true;
    const res = this.quality === 'low' ? 1024 : 2048;
    this.sun.shadow.mapSize.set(res, res);
    const s = 14;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 80;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.05;
    // Low and to the side: long shadows across the court, which is most of
    // what makes late afternoon read as late afternoon.
    this.sunOffset = new THREE.Vector3(24, 21, 12);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
  }

  _buildGround() {
    const size = 400;
    const geo = new THREE.PlaneGeometry(size, size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const g = this.assets?.ground;
    const tile = 3.2; // metres per texture repeat
    if (g) for (const t of [g.diff, g.nor, g.rough]) t.repeat.set(size / tile, size / tile);
    // The owner's ground texture (Poly Haven "leafy grass") is a dry, leaf-
    // strewn lawn whose average colour is tan. A green multiplier pulls it
    // toward a park in summer without losing the detail; a greener texture
    // dropped into assets_raw/ground would make this tint unnecessary.
    const mat = g
      ? new THREE.MeshStandardMaterial({ map: g.diff, color: 0x8fbe6a, normalMap: g.nor, roughnessMap: g.rough, roughness: 1, metalness: 0 })
      : new THREE.MeshStandardMaterial({ color: 0x8b8a6e, roughness: 1.0, metalness: 0 });
    this.ground = new THREE.Mesh(geo, mat);
    this.ground.receiveShadow = true;
    this.ground.position.y = -0.02;
    this.scene.add(this.ground);

    const { RAPIER } = this.physics;
    const body = this.physics.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.52, 0));
    this.physics.createCollider(
      RAPIER.ColliderDesc.cuboid(size / 2, 0.5, size / 2).setRestitution(0.4).setFriction(0.95),
      body
    );
  }

  _buildHorizon() {
    // A low, faceted ring of hills far out so the horizon isn't a hard line.
    const R = 170;
    const N = 72;
    const pts = [];
    const idx = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const h = 6 + Math.sin(a * 3.1) * 3 + Math.sin(a * 7.3 + 1) * 2 + Math.cos(a * 13.7) * 1.2;
      pts.push(Math.cos(a) * R, -1, Math.sin(a) * R);
      pts.push(Math.cos(a) * R, h, Math.sin(a) * R);
    }
    for (let i = 0; i < N; i++) {
      const a = i * 2;
      const b = ((i + 1) % N) * 2;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // Hazy green-grey so the ring reads as distant tree line over the grass.
    const mat = new THREE.MeshStandardMaterial({ color: 0x67775e, roughness: 1, side: THREE.DoubleSide });
    const hills = new THREE.Mesh(geo, mat);
    this.scene.add(hills);
  }

  /**
   * Image-based lighting from the sky dome itself: the gradient sky is
   * rendered into a prefiltered environment map so every PBR material has
   * something to reflect and the shaded sides of things pick up sky blue
   * instead of going flat. Needs the renderer, so Game calls it once that
   * exists. Zero assets, and it is the single biggest change to how the
   * park reads.
   */
  buildEnvironment(renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const skyScene = new THREE.Scene();
    const dome = this.sky.mesh.clone();
    skyScene.add(dome);
    // A ground-coloured floor so the lower hemisphere is not sky blue.
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(390, 24),
      new THREE.MeshBasicMaterial({ color: 0x5d6b3a })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1;
    skyScene.add(floor);
    this.scene.environment = pmrem.fromScene(skyScene, 0.04).texture;
    this.scene.environmentIntensity = 0.62;
    pmrem.dispose();
  }

  /** Keep the shadow frustum centred on the player. */
  update(dt, playerPos, ballPos) {
    this.sun.position.copy(playerPos).add(this.sunOffset);
    this.sun.target.position.set(playerPos.x, 0, playerPos.z);
    this.sun.target.updateMatrixWorld();
    this.netContacts = 0;
    for (const hoop of this.hoops) this.netContacts = Math.max(this.netContacts, hoop.update(dt, ballPos, 0.121));
  }
}
