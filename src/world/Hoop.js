import * as THREE from 'three';
import { HOOP } from '../core/Constants.js';
import { Net } from './Net.js';

/**
 * A regulation outdoor hoop: backboard, a perfectly horizontal circular rim,
 * a hanging net, and a support pole with an arm. Built in local space where
 * -Z points toward the court (the shooting direction) and +Z points to the
 * baseline/pole, then placed + rotated in the world.
 *
 * The rim collision is a ring of small sphere colliders forming a torus, so the
 * ball can drop through the hoop and rattle realistically instead of hitting a
 * solid disc.
 */
export class Hoop {
  /**
   * @param scene THREE.Scene
   * @param physics Physics
   * @param rimWorldPos THREE.Vector3 — world position of the rim centre
   * @param facing +1 or -1 — sign of the world Z the court centre lies toward
   */
  constructor(scene, physics, rimWorldPos, facing) {
    this.scene = scene;
    this.physics = physics;
    this.rimCenter = rimWorldPos.clone();

    // Local space: -Z points toward the court centre (the shooting direction),
    // +Z toward the baseline/pole. Orient the group so local -Z actually points
    // at the world origin (centre court), which puts the pole and backboard
    // BEHIND the rim on the baseline side — never on the court side.
    this.faceSign = rimWorldPos.z >= 0 ? -1 : 1; // world-Z direction to centre
    this.group = new THREE.Group();
    this.group.position.copy(rimWorldPos);
    if (rimWorldPos.z < 0) this.group.rotation.y = Math.PI;
    scene.add(this.group);

    this._buildBackboard();
    this._buildRim();
    this._buildPole();
    this._buildNet();
    this._buildColliders();
  }

  _mat(color, opts = {}) {
    const { rough, metal, ...rest } = opts;
    return new THREE.MeshStandardMaterial({
      color,
      roughness: rough ?? 0.6,
      metalness: metal ?? 0.1,
      ...rest,
    });
  }

  _buildBackboard() {
    const w = HOOP.backboardWidth;
    const h = HOOP.backboardHeight;
    const th = HOOP.backboardThickness;
    // Backboard front face 0.15 m behind the rim centre.
    const zFront = 0.15;
    const centerY = 0.42; // above rim centre
    const board = new THREE.Group();
    board.position.set(0, centerY, zFront + th / 2);

    // Glass-ish backboard
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, th),
      new THREE.MeshStandardMaterial({
        color: 0xdfe9ee,
        roughness: 0.25,
        metalness: 0.0,
        transparent: true,
        opacity: 0.62,
      })
    );
    glass.castShadow = true;
    board.add(glass);

    // White border frame
    const frameMat = this._mat(0xf3f5f4, { rough: 0.5 });
    const frameT = 0.045;
    const mkBar = (bw, bh, x, y) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, th + 0.01), frameMat);
      m.position.set(x, y, 0);
      board.add(m);
    };
    mkBar(w, frameT, 0, h / 2 - frameT / 2);
    mkBar(w, frameT, 0, -h / 2 + frameT / 2);
    mkBar(frameT, h, -w / 2 + frameT / 2, 0);
    mkBar(frameT, h, w / 2 - frameT / 2, 0);

    // Inner shooter's square (sits just above the rim)
    const sqW = 0.59;
    const sqH = 0.45;
    const sqY = -h / 2 + 0.05 + sqH / 2;
    const mkSq = (bw, bh, x, y) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, th + 0.012), this._mat(0xd9541f, { rough: 0.5 }));
      m.position.set(x, y, 0);
      board.add(m);
    };
    mkSq(sqW, 0.035, 0, sqY + sqH / 2);
    mkSq(sqW, 0.035, 0, sqY - sqH / 2);
    mkSq(0.035, sqH, -sqW / 2, sqY);
    mkSq(0.035, sqH, sqW / 2, sqY);

    this.group.add(board);
    this.backboard = board;
    this._boardZ = zFront + th / 2;
    this._boardW = w;
    this._boardH = h;
    this._boardTh = th;
    this._boardCenterY = centerY;
  }

  _buildRim() {
    const rimMat = this._mat(0xe8622a, { rough: 0.4, metal: 0.35 });
    // Visual torus rim, lying flat (rotate so the tube ring is horizontal).
    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(HOOP.rimRadius, HOOP.rimTube, 12, 40),
      rimMat
    );
    torus.rotation.x = Math.PI / 2;
    torus.castShadow = true;
    this.group.add(torus);
    this.rimMesh = torus;

    // Connector bracket from rim back to backboard.
    const bracket = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.05, 0.15 + 0.02),
      rimMat
    );
    bracket.position.set(0, 0, 0.15 / 2 + HOOP.rimRadius * 0.25);
    this.group.add(bracket);
  }

  _buildPole() {
    const poleMat = this._mat(0x2f3438, { rough: 0.7, metal: 0.4 });
    const poleZ = this._boardZ + 0.9; // behind the board
    // Vertical pole from ground to above the board.
    const topY = this._boardCenterY + this._boardH / 2 + 0.1;
    const height = HOOP.rimHeight + topY; // rim centre is at group origin (y=0)
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(HOOP.poleRadius, HOOP.poleRadius * 1.15, height, 16),
      poleMat
    );
    // Group origin is at rim height, so ground is at local y = -rimHeight.
    pole.position.set(0, -HOOP.rimHeight + height / 2, poleZ);
    pole.castShadow = true;
    this.group.add(pole);

    // Angled arm connecting pole to the top-back of the backboard.
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, poleZ - this._boardZ),
      poleMat
    );
    arm.position.set(0, this._boardCenterY + this._boardH / 2 - 0.1, (this._boardZ + poleZ) / 2);
    this.group.add(arm);

    // Padded base
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.28, 0.5, 16),
      this._mat(0x1d2226, { rough: 0.85 })
    );
    base.position.set(0, -HOOP.rimHeight + 0.25, poleZ);
    base.castShadow = true;
    this.group.add(base);

    this._poleZ = poleZ;
    this._poleHeight = height;
  }

  _buildNet() {
    this.net = new Net(12, 6);
    this.group.add(this.net.mesh);
    this.net.mesh.position.set(0, 0, 0);
  }

  _buildColliders() {
    const { RAPIER } = this.physics;

    // Fixed body for the whole rig, positioned/oriented like the group.
    const bodyDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(this.rimCenter.x, this.rimCenter.y, this.rimCenter.z)
      .setRotation(this._quatFromGroup());
    const body = this.physics.createRigidBody(bodyDesc);
    this.body = body;

    // Backboard collider.
    const board = this.physics.createCollider(
      RAPIER.ColliderDesc.cuboid(this._boardW / 2, this._boardH / 2, this._boardTh / 2)
        .setTranslation(0, this._boardCenterY, this._boardZ)
        .setRestitution(0.4)
        .setFriction(0.6),
      body
    );
    this.physics.tagCollider(board, 'backboard');

    // Rim: ring of small spheres forming the torus.
    const N = 20;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const x = Math.cos(a) * HOOP.rimRadius;
      const z = Math.sin(a) * HOOP.rimRadius;
      const rc = this.physics.createCollider(
        RAPIER.ColliderDesc.ball(HOOP.rimTube)
          .setTranslation(x, 0, z)
          .setRestitution(0.55)
          .setFriction(0.5)
          .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max),
        body
      );
      this.physics.tagCollider(rc, 'rim');
    }

    // Pole collider (so the ball can carom off it).
    this.physics.createCollider(
      RAPIER.ColliderDesc.capsule(this._poleHeight / 2 - HOOP.poleRadius, HOOP.poleRadius)
        .setTranslation(0, -HOOP.rimHeight + this._poleHeight / 2, this._poleZ)
        .setRestitution(0.3)
        .setFriction(0.7),
      body
    );
  }

  _quatFromGroup() {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.group.rotation.y, 0));
    return { x: q.x, y: q.y, z: q.z, w: q.w };
  }

  /** World position of the rim centre. */
  getRimCenter() {
    return this.rimCenter;
  }

  /** Direction from rim toward court centre (unit, world space). */
  getShootDir() {
    // local -Z transformed by group rotation.
    return new THREE.Vector3(0, 0, -1).applyEuler(this.group.rotation).normalize();
  }

  update(dt, ballWorldPos, ballRadius) {
    // Feed the ball into the net simulation in net-local space.
    if (ballWorldPos) {
      const local = this.group.worldToLocal(ballWorldPos.clone());
      this.net.interact(local, ballRadius);
    }
    this.net.update(dt);
  }
}
