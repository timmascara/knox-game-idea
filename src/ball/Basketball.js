import * as THREE from 'three';
import { BALL, GROUP } from '../core/Constants.js';

/**
 * The basketball. One persistent object for the whole session with two modes:
 *
 *   FREE       — a dynamic Rapier rigid body: falls, bounces, rolls, collides.
 *   CONTROLLED — a kinematic body driven by the dribble controller. The
 *                controller computes real ballistic bounces, so the ball still
 *                *moves* like a ball; it just isn't at the mercy of the solver
 *                while it is in your hands.
 *
 * The look is fully procedural: an equirectangular colour map painted from the
 * true 8-panel seam geometry (an equator, a meridian, and two side circles),
 * a pebble-grain bump map, and a matching roughness map.
 */
export const BallMode = { FREE: 'free', CONTROLLED: 'controlled' };

export class Basketball {
  constructor(scene, physics, spawn = new THREE.Vector3(1.5, 0.3, 6)) {
    this.scene = scene;
    this.physics = physics;
    const { RAPIER } = physics;

    this.mesh = this._buildMesh();
    scene.add(this.mesh);

    this.body = physics.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, spawn.y, spawn.z)
        .setLinearDamping(BALL.linearDamping)
        .setAngularDamping(BALL.angularDamping)
        .setCcdEnabled(true)
    );
    this.collider = physics.createCollider(
      RAPIER.ColliderDesc.ball(BALL.radius)
        .setRestitution(BALL.restitution)
        .setFriction(BALL.friction)
        .setDensity(BALL.mass / ((4 / 3) * Math.PI * BALL.radius ** 3))
        .setCollisionGroups((GROUP.BALL << 16) | (GROUP.WORLD | GROUP.PLAYER))
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body
    );
    this.colliderHandle = this.collider.handle;

    this.mode = BallMode.FREE;
    this._pos = new THREE.Vector3().copy(spawn);
    this.mesh.position.copy(spawn);
  }

  // ---------------------------------------------------------------------------
  _buildMesh() {
    const geo = new THREE.SphereGeometry(BALL.radius, 72, 54);
    const maps = Basketball.buildMaps(1536, 768);
    const mat = new THREE.MeshStandardMaterial({
      map: maps.color,
      bumpMap: maps.bump,
      bumpScale: 0.0022,
      roughnessMap: maps.rough,
      roughness: 1.0,
      metalness: 0.0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    return mesh;
  }

  /**
   * Paint the colour / bump / roughness maps. Every texel is mapped back to a
   * direction on the sphere and measured against the seam curves, so the
   * grooves are geometrically exact rather than drawn by eye.
   */
  static buildMaps(W, H) {
    const color = new Uint8ClampedArray(W * H * 4);
    const bump = new Uint8ClampedArray(W * H * 4);
    const rough = new Uint8ClampedArray(W * H * 4);

    // Panel circle: angular radius of the two side circles (see class doc).
    const THETA = (55 * Math.PI) / 180;
    const GROOVE = 0.021; // angular half-width of a seam (≈2.5 mm on the ball)
    const base = [0xd9, 0x73, 0x2d];
    const seamCol = [0x1c, 0x14, 0x10];

    // Hash-based value noise for the pebble grain (tileable in u).
    const hash = (x, y) => {
      let h = (x * 374761393 + y * 668265263) | 0;
      h = ((h ^ (h >>> 13)) * 1274126177) | 0;
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const noise = (x, y, period) => {
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      const fx = x - xi;
      const fy = y - yi;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const x0 = ((xi % period) + period) % period;
      const x1 = (x0 + 1) % period;
      const a = hash(x0, yi);
      const b = hash(x1, yi);
      const c = hash(x0, yi + 1);
      const d = hash(x1, yi + 1);
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };

    for (let j = 0; j < H; j++) {
      const v = (j + 0.5) / H;
      const lat = (0.5 - v) * Math.PI;
      const cl = Math.cos(lat);
      const y = Math.sin(lat);
      for (let i = 0; i < W; i++) {
        const u = (i + 0.5) / W;
        const lon = (u - 0.5) * Math.PI * 2;
        const x = cl * Math.sin(lon);
        // Seam distances (angular).
        const dEq = Math.asin(Math.abs(y));
        const dMer = Math.asin(Math.abs(x));
        const dCirc = Math.abs(Math.acos(Math.min(1, Math.abs(x))) - THETA);
        const d = Math.min(dEq, dMer, dCirc);
        // 0 = on the seam, 1 = panel.
        let seam = d / GROOVE;
        seam = seam >= 1 ? 1 : seam * seam * (3 - 2 * seam);

        // Pebble grain: sum of two octaves, stretched by 1/cos(lat) so the
        // grain stays roughly isotropic away from the poles.
        const px = (i / W) * 520;
        const py = (j / H) * 260;
        const st = Math.max(0.35, cl);
        let n = noise(px / st, py, Math.round(520 / st)) * 0.65 + noise(px * 2.1 / st, py * 2.1, Math.round(1092 / st)) * 0.35;
        // Sharpen into bumps.
        n = Math.pow(n, 1.35);
        const bumpV = seam * (0.55 + n * 0.45) + (1 - seam) * 0.15;

        const k = (j * W + i) * 4;
        const tint = 0.9 + n * 0.16;
        color[k] = base[0] * tint * seam + seamCol[0] * (1 - seam);
        color[k + 1] = base[1] * tint * seam + seamCol[1] * (1 - seam);
        color[k + 2] = base[2] * tint * seam + seamCol[2] * (1 - seam);
        color[k + 3] = 255;
        const bv = bumpV * 255;
        bump[k] = bump[k + 1] = bump[k + 2] = bv;
        bump[k + 3] = 255;
        const rv = (0.62 + (1 - n) * 0.2) * seam + 0.9 * (1 - seam);
        rough[k] = rough[k + 1] = rough[k + 2] = rv * 255;
        rough[k + 3] = 255;
      }
    }

    const mk = (data, srgb) => {
      const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = THREE.RepeatWrapping;
      t.anisotropy = 8;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.needsUpdate = true;
      return t;
    };
    return { color: mk(color, true), bump: mk(bump, false), rough: mk(rough, false) };
  }

  // --- Mode control ----------------------------------------------------------
  setControlled() {
    if (this.mode === BallMode.CONTROLLED) return;
    const { RAPIER } = this.physics;
    this.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    this.mode = BallMode.CONTROLLED;
  }

  setFree(launchVel = null, spin = null) {
    const { RAPIER } = this.physics;
    this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.body.wakeUp();
    if (launchVel) this.body.setLinvel({ x: launchVel.x, y: launchVel.y, z: launchVel.z }, true);
    else this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    if (spin) this.body.setAngvel({ x: spin.x, y: spin.y, z: spin.z }, true);
    this.mode = BallMode.FREE;
  }

  /** In CONTROLLED mode, drive the ball to a world position + orientation. */
  driveTo(pos, quat) {
    this.body.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z });
    if (quat) this.body.setNextKinematicRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    this._pos.copy(pos);
    this.mesh.position.copy(pos);
    if (quat) this.mesh.quaternion.copy(quat);
  }

  get position() {
    const t = this.body.translation();
    this._pos.set(t.x, t.y, t.z);
    return this._pos;
  }

  get velocity() {
    const v = this.body.linvel();
    return new THREE.Vector3(v.x, v.y, v.z);
  }

  setPositionHard(pos) {
    this.body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** Rolling resistance so loose balls come to rest and can be chased down. */
  applyRollingResistance(dt) {
    if (this.mode !== BallMode.FREE) return;
    const t = this.body.translation();
    if (t.y > BALL.radius + 0.06) return;
    const v = this.body.linvel();
    const horiz = Math.hypot(v.x, v.z);
    if (horiz < 0.01) return;
    const decay = Math.max(0, 1 - (BALL.rollDecay * dt) / Math.max(horiz, 0.4));
    this.body.setLinvel({ x: v.x * decay, y: v.y, z: v.z * decay }, true);
  }

  /**
   * The net slows a ball on its way through. `contacts` is how many net
   * nodes the ball is pushing this step; a swish touches ten or more.
   */
  applyNetDrag(dt, contacts) {
    if (this.mode !== BallMode.FREE || contacts <= 0) return;
    const s = Math.min(1, contacts / 6);
    const fh = Math.exp(-BALL.netDragHorizontal * s * dt);
    const fv = Math.exp(-BALL.netDragVertical * s * dt);
    const v = this.body.linvel();
    this.body.setLinvel({ x: v.x * fh, y: v.y * fv, z: v.z * fh }, true);
    const w = this.body.angvel();
    const fw = Math.exp(-10 * s * dt);
    this.body.setAngvel({ x: w.x * fw, y: w.y * fw, z: w.z * fw }, true);
  }

  /** Sync the render mesh from physics (FREE mode). */
  syncMesh() {
    const t = this.body.translation();
    this.mesh.position.set(t.x, t.y, t.z);
    const r = this.body.rotation();
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }
}
