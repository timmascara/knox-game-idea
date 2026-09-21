import * as THREE from 'three';
import { COURT } from '../core/Constants.js';

/** Small, seedable PRNG so the court weathers the same way every load. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The playing surface. The court markings are painted once into a high-res
 * canvas (top-down, real proportions) and used as the slab's colour map, which
 * keeps the lines crisp, thin and perfectly aligned without hundreds of line
 * meshes. A single box collider under it handles ball + player contact.
 *
 * With `palette.asphalt` the canvas is painted over a tiled asphalt photo
 * instead of flat colour — the court tint and the key are laid on top at
 * partial alpha so the grain shows through — and the asphalt's normal and
 * roughness maps go on the slab via a second UV set (`uv1`, tiled every
 * `ASPHALT_TILE` metres) since the markings need the whole slab to be one
 * untiled UV space.
 */
const ASPHALT_TILE = 2.6;
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
    this.asphalt = palette.asphalt ?? null;

    this._build();
    this._buildCollider();
  }

  _build() {
    // --- Canvas markings -----------------------------------------------------
    const border = COURT.apron;
    const worldW = COURT.width + border * 2;
    const worldL = COURT.length + border * 2;
    const ppm = 64; // pixels per metre
    const cw = Math.round(worldW * ppm);
    const ch = Math.round(worldL * ppm);

    // world(x,z) -> canvas(px,py). +X right, +Z is down the canvas.
    const X = (x) => cw / 2 + x * ppm;
    const Z = (z) => ch / 2 + z * ppm;
    const S = (m) => m * ppm;
    const rand = mulberry32(31337); // same wear every load

    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');

    // --- 1. the asphalt itself ----------------------------------------------
    if (this.asphalt?.diff?.image) {
      const img = this.asphalt.diff.image;
      const pat = ctx.createPattern(img, 'repeat');
      const sc = S(ASPHALT_TILE) / img.width;
      pat.setTransform(new DOMMatrix().scale(sc, sc));
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, cw, ch);
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = this.apron;
      ctx.fillRect(0, 0, cw, ch);
      ctx.globalAlpha = 0.34;
      ctx.fillStyle = this.surface;
      this._roundRect(ctx, X(-COURT.width / 2), Z(-COURT.length / 2), S(COURT.width), S(COURT.length), S(0.2));
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = this.apron;
      ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = this.surface;
      this._roundRect(ctx, X(-COURT.width / 2), Z(-COURT.length / 2), S(COURT.width), S(COURT.length), S(0.2));
      ctx.fill();
    }

    this._weatherAsphalt(ctx, cw, ch, S, rand);

    // --- 2. the markings, on their own layer so they can be worn away -------
    const lines = document.createElement('canvas');
    lines.width = cw;
    lines.height = ch;
    const lc = lines.getContext('2d');
    lc.strokeStyle = this.line;
    lc.fillStyle = this.line;
    lc.lineWidth = Math.max(1.5, S(COURT.lineWidth));
    lc.lineJoin = 'round';
    lc.lineCap = 'butt';

    // Key paint, laid down first and kept translucent — park paint is thin
    // and the asphalt always shows through it.
    for (const sign of [1, -1]) {
      const baselineZ = sign * (COURT.length / 2);
      const ftZ = sign * (COURT.length / 2 - COURT.freeThrowFromBaseline);
      lc.save();
      lc.globalAlpha = 0.42;
      lc.fillStyle = this.key;
      lc.fillRect(X(-COURT.keyWidth / 2), Z(Math.min(baselineZ, ftZ)), S(COURT.keyWidth), S(Math.abs(ftZ - baselineZ)));
      lc.restore();
      lc.fillStyle = this.line;
    }

    // Boundary
    lc.strokeRect(X(-COURT.width / 2), Z(-COURT.length / 2), S(COURT.width), S(COURT.length));

    // Centre line + circle
    lc.beginPath();
    lc.moveTo(X(-COURT.width / 2), Z(0));
    lc.lineTo(X(COURT.width / 2), Z(0));
    lc.stroke();
    lc.beginPath();
    lc.arc(X(0), Z(0), S(COURT.centerCircleRadius), 0, Math.PI * 2);
    lc.stroke();

    this._drawEnd(lc, +1, { X, Z, S });
    this._drawEnd(lc, -1, { X, Z, S });

    this._wearLines(lc, cw, ch, S, rand);

    // --- 3. composite: paint is never pure white on a park court ------------
    ctx.save();
    ctx.globalAlpha = 0.82;
    ctx.drawImage(lines, 0, 0);
    ctx.restore();

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 16;
    this.texture = tex;

    const geo = new THREE.PlaneGeometry(worldW, worldL);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.82,
      metalness: 0.0,
    });
    if (this.asphalt?.nor && this.asphalt?.rough) {
      // Second UV set for the tiled surface maps: uv scaled to metres/tile.
      const uv = geo.attributes.uv;
      const uv1 = new Float32Array(uv.count * 2);
      for (let i = 0; i < uv.count; i++) {
        uv1[i * 2] = uv.getX(i) * (worldW / ASPHALT_TILE);
        uv1[i * 2 + 1] = uv.getY(i) * (worldL / ASPHALT_TILE);
      }
      geo.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
      mat.normalMap = this.asphalt.nor;
      mat.normalMap.channel = 1;
      mat.normalScale.set(0.6, 0.6);
      mat.roughnessMap = this.asphalt.rough;
      mat.roughnessMap.channel = 1;
      mat.roughness = 1.0;
    }
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.position.y = 0.02; // sits just above terrain
    this.group.add(this.mesh);

    // Slight physical thickness slab for visual edge
    const edgeGeo = new THREE.BoxGeometry(worldW, 0.16, worldL);
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.9 });
    const edge = new THREE.Mesh(edgeGeo, edgeMat);
    edge.position.y = -0.075; // top face 1.5 cm under the slab: no z-fighting
    edge.receiveShadow = true;
    this.group.add(edge);
  }

  /**
   * Cracks, patches and staining. A clean asphalt tile repeated over 400 m²
   * reads as a car park; the large-scale damage is what makes it a court that
   * has been rained on for ten years.
   */
  _weatherAsphalt(ctx, cw, ch, S, rand) {
    ctx.save();

    // Broad blotches: resurfacing patches and where water sits.
    for (let i = 0; i < 60; i++) {
      const x = rand() * cw;
      const y = rand() * ch;
      const r = S(0.6 + rand() * 3.4);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const dark = rand() < 0.62;
      g.addColorStop(0, dark ? 'rgba(30,32,34,0.10)' : 'rgba(185,187,183,0.09)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Cracks: a random walk that branches, thinning as it goes.
    ctx.lineCap = 'round';
    const crack = (x, y, ang, len, w, depth) => {
      ctx.strokeStyle = `rgba(18,19,21,${0.30 + rand() * 0.26})`;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x, y);
      let cx = x, cy = y, a = ang;
      const steps = 6 + (rand() * 10) | 0;
      for (let i = 0; i < steps; i++) {
        a += (rand() - 0.5) * 0.9;
        cx += Math.cos(a) * len;
        cy += Math.sin(a) * len;
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
      if (depth > 0 && rand() < 0.65) crack(cx, cy, a + (rand() - 0.5) * 1.8, len * 0.8, w * 0.65, depth - 1);
    };
    for (let i = 0; i < 26; i++) {
      crack(rand() * cw, rand() * ch, rand() * Math.PI * 2, S(0.35 + rand() * 0.5), 1.1 + rand() * 1.6, 2);
    }
    ctx.restore();
  }

  /**
   * Chip the markings. Paint wears off in patches — under the basket, along
   * the baseline, wherever feet land — so the line layer gets punched through
   * with transparent blobs before it is composited.
   */
  _wearLines(lc, cw, ch, S, rand) {
    lc.save();
    lc.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 520; i++) {
      const x = rand() * cw;
      const y = rand() * ch;
      const r = S(0.05 + Math.pow(rand(), 2.2) * 0.9);
      const g = lc.createRadialGradient(x, y, 0, x, y, r);
      const a = 0.30 + rand() * 0.6;
      g.addColorStop(0, `rgba(0,0,0,${a})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      lc.fillStyle = g;
      lc.beginPath();
      lc.arc(x, y, r, 0, Math.PI * 2);
      lc.fill();
    }
    lc.restore();
  }

  _drawEnd(ctx, sign, { X, Z, S }) {
    const baselineZ = sign * (COURT.length / 2);
    const basketZ = sign * (COURT.length / 2 - COURT.rimFromBaseline);
    const ftZ = sign * (COURT.length / 2 - COURT.freeThrowFromBaseline);
    const halfKey = COURT.keyWidth / 2;

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

    // No restricted-area arc and no rim tick: those are pro markings, and a
    // park court does not have them. Keeping them was what made this read as
    // a televised court dropped into a field.

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
      // Sweep the LONG way, through centre court. Canvas angles run clockwise
      // because +Z is down the canvas, so the basket at +Z needs the
      // anticlockwise sweep and the basket at -Z the clockwise one. Getting
      // this backwards drew only the two stubs by the baseline and no arc at
      // all — which is what "the court lines are terrible" meant.
      ctx.beginPath();
      ctx.arc(X(0), Z(basketZ), S(r), a0, a1, sign > 0);
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
    const border = COURT.apron;
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
