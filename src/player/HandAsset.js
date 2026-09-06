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
  const res = await fetch(handUrl);
  const buf = await res.arrayBuffer();
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

export { THREE };
