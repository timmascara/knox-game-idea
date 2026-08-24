import * as THREE from 'three';
import { COURT } from '../core/Constants.js';

/**
 * The playing surface. The court markings are painted once into a high-res
 * canvas (top-down, real proportions) and used as the slab's colour map, which
 * keeps the lines crisp, thin and perfectly aligned without hundreds of line
 * meshes. A single box collider under it handles ball + player contact.
 */
export class Court {
  constructor(scene, physics, palette = {}) {
    this.scene = scene;
    this.physics = physics;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.surface = palette.surface ?? '#4f7c8a';
    this.apron = palette.apron ?? '#3a5a66';
    this.key = palette.key ?? '#c2683c';
    this.line = palette.line ?? '#eef2f0';

    this._build();
    this._buildCollider();
  }

  _build() {
    // --- Canvas markings -----------------------------------------------------
    const border = 1.6; // apron beyond the boundary lines
    const worldW = COURT.width + border * 2;
    const worldL = COURT.length + border * 2;
    const ppm = 48; // pixels per metre
    const cw = Math.round(worldW * ppm);
    const ch = Math.round(worldL * ppm);
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');

    // world(x,z) -> canvas(px,py). +X right, +Z is down the canvas.
    const X = (x) => cw / 2 + x * ppm;
    const Z = (z) => ch / 2 + z * ppm;
    const S = (m) => m * ppm;

    // Apron + surface
    ctx.fillStyle = this.apron;
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = this.surface;
    this._roundRect(ctx, X(-COURT.width / 2), Z(-COURT.length / 2), S(COURT.width), S(COURT.length), S(0.2));
    ctx.fill();

    ctx.strokeStyle = this.line;
    ctx.fillStyle = this.line;
    ctx.lineWidth = Math.max(2, S(COURT.lineWidth));
    ctx.lineJoin = 'round';

    // Boundary
    ctx.strokeRect(X(-COURT.width / 2), Z(-COURT.length / 2), S(COURT.width), S(COURT.length));

    // Center line + circle
    ctx.beginPath();
    ctx.moveTo(X(-COURT.width / 2), Z(0));
    ctx.lineTo(X(COURT.width / 2), Z(0));
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(X(0), Z(0), S(COURT.centerCircleRadius), 0, Math.PI * 2);
    ctx.stroke();

    this._drawEnd(ctx, +1, { X, Z, S });
    this._drawEnd(ctx, -1, { X, Z, S });

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    this.texture = tex;

    const geo = new THREE.PlaneGeometry(worldW, worldL);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.82,
      metalness: 0.0,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.position.y = 0.02; // sits just above terrain
    this.group.add(this.mesh);

    // Slight physical thickness slab for visual edge
    const edgeGeo = new THREE.BoxGeometry(worldW, 0.16, worldL);
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x2f4650, roughness: 0.9 });
    const edge = new THREE.Mesh(edgeGeo, edgeMat);
    edge.position.y = -0.06;
    edge.receiveShadow = true;
    this.group.add(edge);
  }

  _drawEnd(ctx, sign, { X, Z, S }) {
    const baselineZ = sign * (COURT.length / 2);
    const basketZ = sign * (COURT.length / 2 - COURT.rimFromBaseline);
    const ftZ = sign * (COURT.length / 2 - COURT.freeThrowFromBaseline);
    const halfKey = COURT.keyWidth / 2;

    // Paint fill
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = this.key;
    ctx.fillRect(
      X(-halfKey),
      Z(Math.min(baselineZ, ftZ)),
      S(COURT.keyWidth),
      S(Math.abs(ftZ - baselineZ))
    );
    ctx.restore();

    // Key outline
    ctx.strokeRect(
      X(-halfKey),
      Z(Math.min(baselineZ, ftZ)),
      S(COURT.keyWidth),
      S(Math.abs(ftZ - baselineZ))
    );

    // Free-throw circle (solid top half)
    ctx.beginPath();
    ctx.arc(X(0), Z(ftZ), S(COURT.freeThrowCircleRadius), 0, Math.PI * 2);
    ctx.stroke();

    // Restricted-area arc under basket (semicircle facing the court)
    ctx.beginPath();
    const raStart = sign > 0 ? Math.PI : 0;
    ctx.arc(X(0), Z(basketZ), S(COURT.restrictedRadius), raStart, raStart + Math.PI);
    ctx.stroke();

    // Backboard/rim tick
    ctx.beginPath();
    ctx.moveTo(X(-0.45), Z(basketZ));
    ctx.lineTo(X(0.45), Z(basketZ));
    ctx.stroke();

    // Three-point line: corner straights + arc
    const cornerX = COURT.width / 2 - COURT.threePointStraight;
    // Where the arc meets the corner straight line: solve x=cornerX on circle
    const r = COURT.threePointRadius;
    const dx = cornerX;
    if (dx < r) {
      const dz = Math.sqrt(r * r - dx * dx); // distance along Z from basket
      const straightEndZ = basketZ - sign * dz;
      // Straight segments
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(X(sx * cornerX), Z(baselineZ));
        ctx.lineTo(X(sx * cornerX), Z(straightEndZ));
        ctx.stroke();
      }
      // Arc between the two straight ends, bulging toward centre court
      const a0 = Math.atan2(straightEndZ - basketZ, cornerX);
      const a1 = Math.atan2(straightEndZ - basketZ, -cornerX);
      ctx.beginPath();
      // choose sweep that bulges to centre
      if (sign > 0) ctx.arc(X(0), Z(basketZ), S(r), a1, a0, true);
      else ctx.arc(X(0), Z(basketZ), S(r), a0, a1, true);
      ctx.stroke();
    }
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  _buildCollider() {
    const { RAPIER } = this.physics;
    const border = 1.6;
    const w = COURT.width + border * 2;
    const l = COURT.length + border * 2;
    const body = this.physics.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.06, 0));
    const col = RAPIER.ColliderDesc.cuboid(w / 2, 0.08, l / 2)
      .setRestitution(0.55)
      .setFriction(0.9)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max);
    const collider = this.physics.createCollider(col, body);
    this.physics.tagCollider(collider, 'court');
    this.body = body;
  }
}
