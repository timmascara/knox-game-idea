import * as THREE from 'three';
import { COURT, HOOP } from '../core/Constants.js';
import { Sky } from './Sky.js';
import { Court } from './Court.js';
import { Hoop } from './Hoop.js';

/**
 * An open outdoor court: a flat asphalt slab with regulation markings, two
 * hoops, a wide dusty ground plane, a ring of distant hills for a horizon and
 * a warm late-afternoon sun. Deliberately sparse — nothing here competes with
 * the ball and the hands for attention.
 */
export class World {
  constructor(scene, physics, quality = 'high') {
    this.scene = scene;
    this.physics = physics;
    this.quality = quality;

    this.sky = new Sky(scene);
    this.sky.apply({ skyTop: 0x3f7fc4, skyBottom: 0xd6e6f0, fogColor: 0xd6e6f0, fogNear: 60, fogFar: 260 });

    this._buildLights();
    this._buildGround();
    this._buildHorizon();

    this.court = new Court(scene, physics, {
      surface: '#6e7673',
      apron: '#5d6462',
      key: '#b8573d',
      line: '#f0f0ea',
    });

    const basketZ = COURT.length / 2 - COURT.rimFromBaseline;
    this.hoops = [
      new Hoop(scene, physics, new THREE.Vector3(0, HOOP.rimHeight, basketZ), +1),
      new Hoop(scene, physics, new THREE.Vector3(0, HOOP.rimHeight, -basketZ), -1),
    ];
  }

  _buildLights() {
    this.hemi = new THREE.HemisphereLight(0xcfe3f2, 0x6d6a5a, 0.9);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
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
    this.sunOffset = new THREE.Vector3(18, 26, 10);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
  }

  _buildGround() {
    const size = 400;
    const geo = new THREE.PlaneGeometry(size, size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8b8a6e, roughness: 1.0, metalness: 0 });
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
    const mat = new THREE.MeshStandardMaterial({ color: 0x7f8c7a, roughness: 1, side: THREE.DoubleSide });
    const hills = new THREE.Mesh(geo, mat);
    this.scene.add(hills);
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
