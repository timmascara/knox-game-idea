import * as THREE from 'three';
import { COURT } from '../core/Constants.js';

/**
 * The park around the court: trees, rough grass, a chain-link fence, benches
 * and a path, placed by a seeded scatter so every load is the same park.
 *
 * Scattered models are instanced — one InstancedMesh per primitive per
 * variant. The variant node's **rotation and scale** are folded into each
 * instance matrix (that is what stands the Z-up grass upright) but its
 * **translation is dropped**: the tree pack is split from one 46 m grove, so
 * each variant node still carries where it stood in that grove. Folding that
 * in scattered trees up to 27 m from where they were placed, including on to
 * the court.
 *
 * Trees get a trunk collider. Grass does not — it is decoration you wade into.
 */
// Metres covered by one repeat of the chain-link texture. The texture holds
// four diamonds, so this over four is the diamond size: ~12 cm, which is
// close to real fencing. At 2.2 m it read as garden trellis.
const CHAINLINK_TILE = 0.48;

export class Park {
  constructor(scene, physics, assets, { seed = 7, trees = 56, grass = 1500 } = {}) {
    this.scene = scene;
    this.physics = physics;
    this.group = new THREE.Group();
    this.group.name = 'park';
    scene.add(this.group);

    const rand = mulberry32(seed);
    // The court, its apron, and the fence line outside that.
    this.halfW = COURT.width / 2 + COURT.apron;
    this.halfL = COURT.length / 2 + COURT.apron;
    this.fenceW = this.halfW + 1.6;
    this.fenceL = this.halfL + 1.6;

    this._buildFence();
    this._buildBenches();
    this._buildLamps();
    this._buildProps();
    this._placeTrees(assets.tree, rand, trees);
    this._placeGrass(assets.grass, rand, grass);
    this._buildNeighbourhood(rand);
    if (assets.decals?.length) this._scatterLeaves(assets.decals, rand);
  }

  /**
   * The neighbourhood the park sits in.
   *
   * **The test this has to pass is occlusion, not decoration.** Standing on
   * the court and looking in any direction, you must not be able to see the
   * ground plane run away to the horizon. If you can, the scene reads as open
   * country no matter how much furniture is scattered on it — which is what
   * three earlier passes got wrong. Houses at 60-112 m and 3-6 m tall are a
   * strip of dots under an empty sky; the eye goes straight past them.
   *
   * So the buildings are **close** (first row fronts at ~30 m, just behind
   * the tree belt), **tall** (two and three storeys, 7-11 m), and **laid out
   * in continuous rows** that leave no angular gap. Three rings, each behind
   * the last, so anywhere a gap does open in the first row the second fills
   * it. They face the park, as houses on a street around a park would,
   * rather than being randomly rotated boxes.
   *
   * `verifyEnclosure()` measures it: rays from the court at eye height, all
   * the way round, must every one of them hit something.
   */
  _buildNeighbourhood(rand) {
    const group = new THREE.Group();
    group.name = 'neighbourhood';
    this._blockers = [];

    // Varied and reasonably saturated. The first pass used muted beiges and
    // the sky's own blue-green bounce flattened them all into one grey-green
    // wall — the buildings need to differ from each other by more than the
    // light differs across them.
    const wallCols = [0xd9c9a8, 0xb5735a, 0xe0d6c4, 0x9aa6a8, 0xc8a878, 0xa8896c, 0xd6c0a2, 0x8f9d8a, 0xcf8f6a];
    const roofCols = [0x7a3f2c, 0x4a4340, 0x8a5636, 0x3d3a38, 0x6a4a38, 0x5c4a3e];
    const facade = facadeTexture();

    // Ring: [front distance on X, front distance on Z, height range, how far
    // apart along the row]. Each row sits behind the one before it.
    // `wFrac` is building width as a fraction of the spacing: under 1 leaves
    // alleys between the houses, over 1 overlaps them into a continuous run.
    // The front rows get alleys because that is what a street looks like; the
    // back row is deliberately continuous, as the backstop that closes every
    // sightline those alleys open. Without it verifyEnclosure() reports
    // escapes straight through the gaps.
    const rings = [
      { rx: 30, rz: 36, h: [7.0, 10.5], step: 13, jitter: 2.0, wFrac: [0.58, 0.30] },
      { rx: 48, rz: 55, h: [8.0, 12.5], step: 16, jitter: 3.0, wFrac: [0.72, 0.32] },
      { rx: 74, rz: 82, h: [10.0, 15.0], step: 20, jitter: 2.0, wFrac: [1.02, 0.25] },
    ];

    for (const ring of rings) {
      // Walk the perimeter in even angular steps so the row is continuous.
      const circumference = 2 * Math.PI * Math.max(ring.rx, ring.rz);
      const n = Math.max(16, Math.round(circumference / ring.step));
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.05;
        const jx = (rand() - 0.5) * ring.jitter;
        const jz = (rand() - 0.5) * ring.jitter;
        const x = Math.cos(ang) * ring.rx + jx;
        const z = Math.sin(ang) * ring.rz + jz;
        // Alternate short and tall along the row so the skyline is jagged
        // rather than one flat parapet.
        const tallish = (i % 3 === 0) ? 1 : (i % 3 === 1 ? 0.62 : 0.82);
        const h = ring.h[0] + (ring.h[1] - ring.h[0]) * (tallish * (0.75 + rand() * 0.45));
        // Deliberately narrower than the spacing, so there are alleys between
        // the houses. The ring behind closes those sightlines — which is why
        // there are three rings and why verifyEnclosure() has to be re-run
        // after touching any of this.
        const w = ring.step * (ring.wFrac[0] + rand() * ring.wFrac[1]);
        const d = 7 + rand() * 7;

        const g = new THREE.Group();
        const wall = new THREE.MeshStandardMaterial({
          map: facade.clone(), color: wallCols[(rand() * wallCols.length) | 0], roughness: 0.93,
        });
        // One window roughly every 2.6 m across and every 3.2 m up, so the
        // facade reads at the right scale however wide the building is.
        wall.map.repeat.set(Math.max(1, Math.round(w / 3.0)), Math.max(1, Math.round(h / 3.3)));
        wall.map.needsUpdate = true;

        const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wall);
        body.position.y = h / 2;
        body.castShadow = false;
        body.receiveShadow = true;
        g.add(body);

        const roofMat = new THREE.MeshStandardMaterial({
          color: roofCols[(rand() * roofCols.length) | 0], roughness: 0.88,
        });
        let roofH;
        if (h < 8.5) {
          // A house: a proper ridge roof running along the frontage.
          roofH = 1.5 + rand() * 1.6;
          // A 4-sided cone's base is a square whose DIAGONAL is 2r, so with
          // the 45 degree turn below its side is r*sqrt2. Sizing the radius
          // off `d * 0.78` made the roof half again as wide as its house and
          // left big pale triangles jutting out over the grass.
          const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0, d / Math.SQRT2, roofH, 4), roofMat);
          ridge.scale.set(w / d, 1, 1);
          ridge.position.y = h + roofH / 2 - 0.05;
          ridge.rotation.y = Math.PI / 4;
          g.add(ridge);
        } else {
          // A block: flat roof with a parapet lip, which reads right at this
          // size and keeps the skyline varied against the houses.
          roofH = 0.5;
          const parapet = new THREE.Mesh(new THREE.BoxGeometry(w + 0.35, roofH, d + 0.35), roofMat);
          parapet.position.y = h + roofH / 2 - 0.08;
          g.add(parapet);
        }

        g.position.set(x, 0, z);
        // Face the park.
        g.rotation.y = -ang + Math.PI / 2 + (rand() - 0.5) * 0.12;
        group.add(g);

        this._blockers.push({ x, z, r: Math.max(w, d) * 0.5, h: h + roofH });
      }
    }

    this.group.add(group);
  }

  /**
   * Prove the horizon is closed off: cast rays from a few points on the court
   * at eye height, all the way round, and report any that escape without
   * meeting a building. Any escape is a sightline out to open ground, which
   * is precisely what made this read as plains.
   */
  verifyEnclosure({ rays = 360, eye = 1.7, from = [[0, 0], [0, -12], [0, 12], [-7, 0], [7, 0]] } = {}) {
    let escapes = 0;
    let worst = null;
    for (const [ox, oz] of from) {
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * Math.PI * 2;
        const dx = Math.cos(a), dz = Math.sin(a);
        let hit = false;
        for (const b of this._blockers) {
          // Distance from the blocker centre to the ray, and how far along.
          const px = b.x - ox, pz = b.z - oz;
          const t = px * dx + pz * dz;
          if (t <= 0) continue;
          const perp = Math.abs(px * dz - pz * dx);
          if (perp > b.r) continue;
          // Does it still rise above the eye line at that range? Anything
          // shorter than the eye height leaves the horizon showing over it.
          if (b.h > eye) { hit = true; break; }
        }
        if (!hit) { escapes++; worst = ((a * 180) / Math.PI).toFixed(0); }
      }
    }
    return { escapes, total: rays * from.length, worstAngle: worst };
  }

  /**
   * Street lamps. Nothing says "municipal park" faster, and at dusk they are
   * the light source the reference photograph is built around.
   */
  _buildLamps() {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x4a5257, roughness: 0.6, metalness: 0.4 });
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xfff4d8, roughness: 0.4, emissive: 0xffdca0, emissiveIntensity: 0.35,
    });
    const H = 6.2;
    const lamp = (x, z, facing) => {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.12, H, 8), poleMat);
      pole.position.y = H / 2;
      pole.castShadow = true;
      g.add(pole);
      // The arm curves out over the court.
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.5, 6), poleMat);
      arm.position.set(0.62, H - 0.28, 0);
      arm.rotation.z = Math.PI / 2 - 0.35;
      g.add(arm);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.16, 0.34), headMat);
      head.position.set(1.28, H - 0.52, 0);
      g.add(head);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.45, 8), poleMat);
      base.position.y = 0.22;
      base.castShadow = true;
      g.add(base);
      g.position.set(x, 0, z);
      g.rotation.y = facing;
      this.group.add(g);
    };
    const W = this.fenceW + 1.1, L = this.fenceL - 3;
    lamp(-W, -L, 0);
    lamp(-W, L, 0);
    lamp(W, -L, Math.PI);
    lamp(W, L, Math.PI);
    lamp(0, this.fenceL + 1.2, -Math.PI / 2);
  }

  /** A bin by the benches, and a path out of the near gate. */
  _buildProps() {
    const binMat = new THREE.MeshStandardMaterial({ color: 0x3f5540, roughness: 0.75, metalness: 0.2 });
    const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.24, 0.85, 12), binMat);
    bin.position.set(-(this.fenceW + 1.4), 0.43, 0.9);
    bin.castShadow = true;
    this.group.add(bin);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.07, 12), binMat);
    lid.position.set(bin.position.x, 0.89, bin.position.z);
    this.group.add(lid);

    // A worn footpath running OUT of the west gate toward the houses. The
    // first version sat 28 m away running parallel to the court, connected
    // to nothing, and foreshortened into a pale triangle on the grass.
    const pathMat = new THREE.MeshStandardMaterial({ color: 0x9a8f7a, roughness: 1 });
    const from = this.fenceW, to = 30;
    const path = new THREE.Mesh(new THREE.PlaneGeometry(to - from, 1.6), pathMat);
    path.rotation.x = -Math.PI / 2;
    path.position.set(-(from + (to - from) / 2), 0.006, 0);
    path.receiveShadow = true;
    this.group.add(path);
  }

  /**
   * Fallen leaves, from the decal pack, as flat quads lying on the ground and
   * drifting on to the court edges. Two triangles each and they do more for
   * "nobody has swept this in a month" than any amount of geometry.
   */
  _scatterLeaves(decals, rand) {
    const mats = decals.map((t) => new THREE.MeshStandardMaterial({
      map: t, transparent: true, alphaTest: 0.35, depthWrite: false,
      roughness: 1, side: THREE.DoubleSide,
    }));
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);

    const perMat = mats.map(() => []);
    for (let i = 0; i < 260; i++) {
      const ang = rand() * Math.PI * 2;
      const r = Math.pow(rand(), 0.6);
      // Mostly around the court edge, some drifted on to the asphalt.
      const x = Math.cos(ang) * (this.fenceW * (0.55 + r * 1.9));
      const z = Math.sin(ang) * (this.fenceL * (0.55 + r * 1.5));
      const onCourt = Math.abs(x) < this.halfW && Math.abs(z) < this.halfL;
      perMat[(rand() * mats.length) | 0].push({
        x, z, y: onCourt ? 0.026 : 0.012,
        yaw: rand() * Math.PI * 2, scale: 0.9 + rand() * 2.2,
      });
    }
    perMat.forEach((spots, i) => {
      if (!spots.length) return;
      const inst = new THREE.InstancedMesh(geo, mats[i], spots.length);
      inst.receiveShadow = true;
      const m = new THREE.Matrix4();
      const v = new THREE.Vector3();
      spots.forEach((s, k) => {
        v.set(s.scale, 1, s.scale);
        m.makeRotationY(s.yaw).scale(v).setPosition(s.x, s.y, s.z);
        inst.setMatrixAt(k, m);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      this.group.add(inst);
    });
  }

  /** Distance from the fence rectangle; negative inside it. */
  _outside(x, z, margin = 0) {
    const dx = Math.abs(x) - (this.fenceW + margin);
    const dz = Math.abs(z) - (this.fenceL + margin);
    return Math.max(dx, dz);
  }

  /**
   * One InstancedMesh per primitive of `variant`, filled from `spots`.
   * See the class note on why the variant's translation is discarded.
   */
  _instance(variant, spots, { castShadow, receiveShadow }) {
    variant.updateMatrixWorld(true);
    const local = new THREE.Matrix4();
    const m = new THREE.Matrix4();
    const tmp = new THREE.Matrix4();
    const scl = new THREE.Vector3();
    variant.traverse((o) => {
      if (!o.isMesh) return;
      // Orientation and scale only — no translation.
      local.copy(o.matrixWorld).setPosition(0, 0, 0);
      const inst = new THREE.InstancedMesh(o.geometry, o.material, spots.length);
      inst.castShadow = castShadow;
      inst.receiveShadow = receiveShadow;
      spots.forEach((s, i) => {
        scl.set(s.scale, s.scale, s.scale);
        m.makeRotationY(s.yaw).scale(scl).setPosition(s.x, s.y || 0, s.z);
        tmp.multiplyMatrices(m, local);
        inst.setMatrixAt(i, tmp);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      this.group.add(inst);
    });
  }

  _placeTrees(treeScene, rand, count) {
    const variants = treeScene.children.filter((n) => /^tree_\d+$/.test(n.name));
    if (!variants.length) return;
    // Favour the taller variants; the pack's saplings are the short ones.
    const heights = variants.map((v) => new THREE.Box3().setFromObject(v).max.y);
    const weights = heights.map((h) => 0.5 + h);
    const spots = variants.map(() => []);
    const placed = [];

    // A belt around the fence: dense just beyond it, thinning with distance.
    for (let tries = 0; placed.length < count && tries < count * 60; tries++) {
      const ang = rand() * Math.PI * 2;
      const out = 2.5 + Math.pow(rand(), 0.8) * 16;
      const x = Math.cos(ang) * (this.fenceW + out);
      const z = Math.sin(ang) * (this.fenceL + out);
      // Hard clearance: nothing within 3 m of the fence, ever.
      if (this._outside(x, z, 3) < 0) continue;
      if (placed.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 3.6 ** 2)) continue;
      const vi = pickWeighted(weights, rand());
      const spot = { x, z, yaw: rand() * Math.PI * 2, scale: 0.8 + rand() * 0.45, vi };
      placed.push(spot);
      spots[vi].push(spot);
    }
    // Shadows only from the trees near enough for their shadow to land on or
    // beside the court. The shadow map is re-rendered every frame, so a tree
    // 60 m away casting into it is pure cost for something nobody can see.
    const SHADOW_RANGE = 30;
    variants.forEach((v, i) => {
      const near = spots[i].filter((s) => Math.hypot(s.x, s.z) < SHADOW_RANGE);
      const far = spots[i].filter((s) => Math.hypot(s.x, s.z) >= SHADOW_RANGE);
      if (near.length) this._instance(v, near, { castShadow: true, receiveShadow: true });
      if (far.length) this._instance(v, far, { castShadow: false, receiveShadow: true });
    });

    const { RAPIER } = this.physics;
    for (const p of placed) {
      const body = this.physics.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(p.x, 2.5, p.z));
      this.physics.createCollider(
        RAPIER.ColliderDesc.cylinder(2.5, 0.26 * p.scale).setRestitution(0.3).setFriction(0.8),
        body
      );
    }
    this.trees = placed;
  }

  /**
   * Rough grass. The pack's clump is ~1.9 m across, which at full size reads
   * as a bush and leaves bald ground between — the first cut's "grass in
   * clumps" problem. Scaled right down and scattered in overlapping drifts
   * instead, it reads as continuous rough grass at the court's edge.
   */
  _placeGrass(grassScene, rand, count) {
    const variants = grassScene.children.filter((n) => n.isObject3D);
    if (!variants.length) return;
    const spots = variants.map(() => []);
    let placed = 0;

    // Seed a handful of drift centres, then cluster tufts around them.
    const drifts = [];
    for (let i = 0; i < 54; i++) {
      const ang = rand() * Math.PI * 2;
      const out = 0.3 + Math.pow(rand(), 1.5) * 26;
      drifts.push({ x: Math.cos(ang) * (this.fenceW + out), z: Math.sin(ang) * (this.fenceL + out), r: 2.5 + rand() * 5 });
    }

    for (let tries = 0; placed < count && tries < count * 20; tries++) {
      let x, z;
      if (rand() < 0.78) {
        const d = drifts[(rand() * drifts.length) | 0];
        const a = rand() * Math.PI * 2;
        const rr = Math.sqrt(rand()) * d.r;
        x = d.x + Math.cos(a) * rr;
        z = d.z + Math.sin(a) * rr;
      } else {
        const ang = rand() * Math.PI * 2;
        const out = 0.2 + Math.pow(rand(), 1.4) * 40;
        x = Math.cos(ang) * (this.fenceW + out);
        z = Math.sin(ang) * (this.fenceL + out);
      }
      // Grass grows right up to the fence, but never on the asphalt.
      if (this._outside(x, z, 0.15) < 0) continue;
      const vi = (rand() * variants.length) | 0;
      // Small, and varied — a tuft, not a shrub.
      spots[vi].push({ x, z, yaw: rand() * Math.PI * 2, scale: 0.16 + Math.pow(rand(), 2) * 0.3 });
      placed++;
    }
    variants.forEach((v, i) => spots[i].length && this._instance(v, spots[i], { castShadow: false, receiveShadow: true }));
    this.grass = placed;
  }

  /**
   * Chain-link fencing on the two long sides and behind each hoop, with a
   * gap at half-court on each side to walk through. The mesh is a generated
   * alpha texture rather than geometry — at this distance a drawn diamond
   * weave reads better than anything affordable in triangles.
   */
  _buildFence() {
    const H = 3.2;
    const tex = chainLinkTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: tex, alphaTest: 0.45, transparent: false, side: THREE.DoubleSide,
      color: 0xb9c2c6, roughness: 0.65, metalness: 0.35,
    });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x8e979b, roughness: 0.55, metalness: 0.45 });
    const { RAPIER } = this.physics;
    const gap = 3.0; // walk-through at half court, both long sides

    const panel = (x1, z1, x2, z2) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 0.2) return;
      const g = new THREE.PlaneGeometry(len, H);
      const mesh = new THREE.Mesh(g, mat.clone());
      mesh.material.map = tex.clone();
      mesh.material.map.needsUpdate = true;
      mesh.material.map.repeat.set(len / CHAINLINK_TILE, H / CHAINLINK_TILE);
      mesh.material.map.wrapS = mesh.material.map.wrapT = THREE.RepeatWrapping;
      mesh.position.set((x1 + x2) / 2, H / 2, (z1 + z2) / 2);
      mesh.rotation.y = Math.atan2(x2 - x1, z2 - z1) + Math.PI / 2;
      mesh.receiveShadow = true;
      this.group.add(mesh);

      const body = this.physics.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(mesh.position.x, H / 2, mesh.position.z)
          .setRotation({ x: 0, y: Math.sin(mesh.rotation.y / 2), z: 0, w: Math.cos(mesh.rotation.y / 2) })
      );
      this.physics.createCollider(
        RAPIER.ColliderDesc.cuboid(len / 2, H / 2, 0.05).setRestitution(0.25).setFriction(0.7),
        body
      );
    };

    const W = this.fenceW, L = this.fenceL;
    for (const sx of [-1, 1]) {
      panel(sx * W, -L, sx * W, -gap / 2);
      panel(sx * W, gap / 2, sx * W, L);
    }
    for (const sz of [-1, 1]) panel(-W, sz * L, W, sz * L);

    // Posts at the corners, the gaps and along the runs.
    const postAt = (x, z) => {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, H + 0.18, 8), postMat);
      p.position.set(x, (H + 0.18) / 2, z);
      p.castShadow = true;
      this.group.add(p);
    };
    for (const sx of [-1, 1]) {
      for (let z = -L; z <= L + 0.01; z += L / 4) postAt(sx * W, z);
      postAt(sx * W, -gap / 2); postAt(sx * W, gap / 2);
    }
    for (const sz of [-1, 1]) for (let x = -W; x <= W + 0.01; x += W / 3) postAt(x, sz * L);
  }

  /** A couple of courtside benches, the kind that are always there. */
  _buildBenches() {
    const slat = new THREE.MeshStandardMaterial({ color: 0x6b4f32, roughness: 0.85 });
    const frame = new THREE.MeshStandardMaterial({ color: 0x2f3438, roughness: 0.5, metalness: 0.5 });
    const { RAPIER } = this.physics;

    const bench = (x, z, yaw) => {
      const g = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.055, 0.13), slat);
        s.position.set(0, 0.44, -0.16 + i * 0.16);
        s.castShadow = true; s.receiveShadow = true;
        g.add(s);
      }
      for (let i = 0; i < 2; i++) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.13, 0.05), slat);
        s.position.set(0, 0.72 + i * 0.17, -0.24);
        s.castShadow = true;
        g.add(s);
      }
      for (const sx of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.44, 0.5), frame);
        leg.position.set(sx * 0.78, 0.22, -0.02);
        leg.castShadow = true;
        g.add(leg);
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.05), frame);
        back.position.set(sx * 0.78, 0.6, -0.24);
        g.add(back);
      }
      g.position.set(x, 0, z);
      g.rotation.y = yaw;
      this.group.add(g);

      const body = this.physics.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, 0.45, z));
      this.physics.createCollider(RAPIER.ColliderDesc.cuboid(0.9, 0.45, 0.3).setRestitution(0.3).setFriction(0.8), body);
    };

    bench(-(this.fenceW + 1.4), -4.5, Math.PI / 2);
    bench(-(this.fenceW + 1.4), 4.5, Math.PI / 2);
    bench(this.fenceW + 1.4, 0, -Math.PI / 2);
  }
}

/**
 * One window per tile, with a frame and a sill. The buildings are close
 * enough now to be read properly, so the texture repeats once per window
 * rather than carrying a whole facade.
 */
function facadeTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, S, S);
  // Glass, darker at the top where it reflects the sky less.
  const g = ctx.createLinearGradient(0, 18, 0, 46);
  g.addColorStop(0, 'rgba(44,50,58,0.72)');
  g.addColorStop(1, 'rgba(96,104,112,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(20, 18, 24, 28);
  // Frame and sill.
  ctx.strokeStyle = 'rgba(250,248,244,0.9)';
  ctx.lineWidth = 3;
  ctx.strokeRect(20, 18, 24, 28);
  ctx.beginPath();
  ctx.moveTo(32, 18); ctx.lineTo(32, 46);
  ctx.moveTo(20, 32); ctx.lineTo(44, 32);
  ctx.stroke();
  ctx.fillStyle = 'rgba(232,228,220,0.95)';
  ctx.fillRect(17, 46, 30, 3);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * A diamond chain-link weave drawn to an alpha-tested texture. Two crossed
 * sets of strokes over transparency, with the wire slightly lighter on one
 * diagonal so it does not read as a flat grid.
 */
function chainLinkTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  ctx.lineCap = 'square';
  for (const [dir, shade, w] of [[1, '#e8eef0', 3], [-1, '#c3ccd0', 3]]) {
    ctx.strokeStyle = shade;
    ctx.lineWidth = w;
    for (let i = -S; i < S * 2; i += S / 4) {
      ctx.beginPath();
      ctx.moveTo(i, dir > 0 ? 0 : S);
      ctx.lineTo(i + S, dir > 0 ? S : 0);
      ctx.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Small, seedable PRNG so the park is the same every load. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(weights, u) {
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < weights.length; i++) { acc += weights[i] / total; if (u < acc) return i; }
  return weights.length - 1;
}
