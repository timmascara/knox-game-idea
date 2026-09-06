import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import handUrl from '../assets/hand_right.glb?url';

/**
 * Loads the sculpted, auto-rigged right hand (see scripts/rig_hand.py) once.
 * The GLB is bundled inline as a data URI, so this works from the dev server,
 * the static build and the single-file playable page alike.
 *
 * Returns { scene, bones } where `scene` is the template to clone per hand.
 * The mesh ships without normals to keep the file small; smooth normals are
 * computed here.
 */
export async function loadHandAsset() {
  const buf = await loadBytes(handUrl);
  const loader = new GLTFLoader();
  const gltf = await new Promise((resolve, reject) => loader.parse(buf, '', resolve, reject));
  let skinned = null;
  gltf.scene.traverse((o) => {
    if (o.isSkinnedMesh) skinned = o;
  });
  if (!skinned) throw new Error('hand asset has no skinned mesh');
  skinned.geometry.computeVertexNormals();
  skinned.frustumCulled = false;
  // A bone list in file order, for name lookups on clones.
  const boneNames = gltf.parser.json.extras?.boneNames || [];
  return { scene: gltf.scene, skinned, boneNames, joints: gltf.parser.json.extras?.joints || {} };
}

/**
 * Read the asset bytes. When Vite has inlined the file as a data: URI, decode
 * it here — hosts with a strict content-security policy refuse fetch() on
 * data: URLs, which is exactly the case for the single-file playable page.
 */
async function loadBytes(url) {
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',');
    const meta = url.slice(0, comma);
    const payload = url.slice(comma + 1);
    if (/;base64/i.test(meta)) {
      const bin = atob(payload);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out.buffer;
    }
    return new TextEncoder().encode(decodeURIComponent(payload)).buffer;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`hand asset: HTTP ${res.status}`);
  return res.arrayBuffer();
}

export { THREE };
