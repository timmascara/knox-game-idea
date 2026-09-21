/**
 * Split a fused multi-object model into separately placeable nodes.
 *
 * Packs routinely export a whole grove or a shelf of props as one mesh with
 * no object boundaries left. Instancing needs one geometry per object, so
 * this finds them from the geometry alone:
 *
 *   1. Connected components over the triangle graph, per primitive.
 *   2. Components that touch the ground are the seeds (trunks, bases).
 *   3. Every other component (leaf cards, loose parts) joins the seed
 *      nearest to it in the ground plane.
 *   4. Each cluster becomes a node named <name>_<i>, its geometry rebased
 *      so the seed's footprint centre is the node origin at y = 0. The node
 *      keeps a translation back to where it stood, so the file still
 *      previews as the original arrangement.
 *
 * Called from fix_materials.mjs when meta.json has `"splitObjects": true`.
 */
import { Accessor } from '@gltf-transform/core';

export function splitObjects(doc, { name = 'obj', groundBand = 0.35 } = {}) {
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  const buffer = root.listBuffers()[0] || doc.createBuffer();

  // Gather every primitive with its node's world transform baked in.
  const items = [];
  const nodes = [];
  (function walk(n) { nodes.push(n); n.listChildren().forEach(walk); })(scene);
  for (const node of nodes) {
    const mesh = node.getMesh?.();
    if (!mesh) continue;
    const M = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      // OBJ 'l' elements arrive as LINES primitives: stray edges, no surface.
      // They are dropped with the old nodes below.
      if (prim.getMode() !== 4) continue;
      const pos = prim.getAttribute('POSITION');
      const idx = prim.getIndices();
      const n = pos.getCount();
      const P = new Float32Array(n * 3);
      const v = [0, 0, 0];
      for (let i = 0; i < n; i++) {
        pos.getElement(i, v);
        const x = v[0], y = v[1], z = v[2];
        P[i * 3]     = M[0] * x + M[4] * y + M[8]  * z + M[12];
        P[i * 3 + 1] = M[1] * x + M[5] * y + M[9]  * z + M[13];
        P[i * 3 + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
      }
      const I = idx ? Array.from(idx.getArray()) : Array.from({ length: n }, (_, i) => i);
      items.push({ prim, P, I, n,
        attrs: prim.listSemantics().filter((s) => s !== 'POSITION').map((s) => [s, prim.getAttribute(s)]) });
    }
  }

  // 1. connected components per primitive (union-find over triangle edges)
  const comps = []; // { item, tris: [t...], minY, cx, cz }
  for (const it of items) {
    const parent = Int32Array.from({ length: it.n }, (_, i) => i);
    const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
    for (let t = 0; t < it.I.length; t += 3) { union(it.I[t], it.I[t + 1]); union(it.I[t], it.I[t + 2]); }
    const byRoot = new Map();
    for (let t = 0; t < it.I.length; t += 3) {
      const r = find(it.I[t]);
      let c = byRoot.get(r);
      if (!c) { c = { item: it, tris: [], minY: Infinity, sx: 0, sz: 0, k: 0 }; byRoot.set(r, c); comps.push(c); }
      c.tris.push(t);
      for (let j = 0; j < 3; j++) {
        const vi = it.I[t + j];
        const y = it.P[vi * 3 + 1];
        if (y < c.minY) c.minY = y;
        c.sx += it.P[vi * 3]; c.sz += it.P[vi * 3 + 2]; c.k++;
      }
    }
  }
  const floor = Math.min(...comps.map((c) => c.minY));
  for (const c of comps) { c.cx = c.sx / c.k; c.cz = c.sz / c.k; }

  // 2. seeds: substantial components that reach the ground. A trunk is
  //    thousands of triangles; a leaf card brushing the grass is two, and
  //    must not start a tree of its own. Merge seeds that stand on the same
  //    spot (a trunk split across two primitives, say).
  const totalTris = comps.reduce((n, c) => n + c.tris.length, 0);
  const minSeedTris = 40;
  const seeds = [];
  for (const c of comps.filter((c) => c.minY < floor + groundBand && c.tris.length >= minSeedTris)
                       .sort((a, b) => b.tris.length - a.tris.length)) {
    const near = seeds.find((s) => Math.hypot(s.cx - c.cx, s.cz - c.cz) < 1.5);
    if (near) near.members.push(c); else seeds.push({ cx: c.cx, cz: c.cz, members: [c] });
  }
  if (!seeds.length) return 0;

  // 3. everything else joins the nearest seed in the ground plane
  for (const c of comps) {
    if (seeds.some((s) => s.members.includes(c))) continue;
    let best = null, bd = Infinity;
    for (const s of seeds) { const d = Math.hypot(s.cx - c.cx, s.cz - c.cz); if (d < bd) { bd = d; best = s; } }
    best.members.push(c);
  }

  // 4. one node per seed, rebased to its footprint
  const oldNodes = scene.listChildren();
  seeds.forEach((s, si) => {
    // footprint centre = centroid of the ground-touching vertices
    let fx = 0, fz = 0, fk = 0, fy = Infinity;
    for (const c of s.members) if (c.minY < floor + groundBand) {
      for (const t of c.tris) for (let j = 0; j < 3; j++) {
        const vi = c.item.I[t + j], y = c.item.P[vi * 3 + 1];
        if (y < floor + groundBand) { fx += c.item.P[vi * 3]; fz += c.item.P[vi * 3 + 2]; fk++; fy = Math.min(fy, y); }
      }
    }
    fx /= fk; fz /= fk;

    const mesh = doc.createMesh(`${name}_${si}`);
    const byPrim = new Map();
    for (const c of s.members) { if (!byPrim.has(c.item)) byPrim.set(c.item, []); byPrim.get(c.item).push(...c.tris); }
    for (const [it, tris] of byPrim) {
      const remap = new Map(); const order = [];
      const I = new Uint32Array(tris.length * 3);
      let w = 0;
      for (const t of tris) for (let j = 0; j < 3; j++) {
        const vi = it.I[t + j];
        let ni = remap.get(vi);
        if (ni === undefined) { ni = order.length; remap.set(vi, ni); order.push(vi); }
        I[w++] = ni;
      }
      const P = new Float32Array(order.length * 3);
      order.forEach((vi, ni) => { P[ni * 3] = it.P[vi * 3] - fx; P[ni * 3 + 1] = it.P[vi * 3 + 1] - fy; P[ni * 3 + 2] = it.P[vi * 3 + 2] - fz; });
      const prim = doc.createPrimitive().setMaterial(it.prim.getMaterial()).setMode(it.prim.getMode());
      prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(P).setBuffer(buffer));
      for (const [sem, acc] of it.attrs) {
        const size = acc.getElementSize();
        const A = new Float32Array(order.length * size); const tmp = new Array(size);
        order.forEach((vi, ni) => { acc.getElement(vi, tmp); for (let k = 0; k < size; k++) A[ni * size + k] = tmp[k]; });
        prim.setAttribute(sem, doc.createAccessor().setType(acc.getType()).setArray(A).setBuffer(buffer));
      }
      prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(I).setBuffer(buffer));
      mesh.addPrimitive(prim);
    }
    const node = doc.createNode(`${name}_${si}`).setMesh(mesh).setTranslation([fx, fy - floor, fz]);
    scene.addChild(node);
  });
  for (const n of oldNodes) n.dispose();
  return seeds.length;
}
