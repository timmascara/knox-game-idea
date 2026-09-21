import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

import treeUrl from '../assets/tree.glb?url';
import grassUrl from '../assets/grass.glb?url';
import asphaltDiffUrl from '../assets/textures/asphalt_diff.webp?url';
import asphaltNorUrl from '../assets/textures/asphalt_nor.webp?url';
import asphaltRoughUrl from '../assets/textures/asphalt_rough.webp?url';
import groundDiffUrl from '../assets/textures/grass_ground_diff.webp?url';
import groundNorUrl from '../assets/textures/grass_ground_nor.webp?url';
import groundRoughUrl from '../assets/textures/grass_ground_rough.webp?url';

/**
 * Everything the park is built from, loaded once up front so the world can
 * be constructed synchronously with real geometry in hand (the smoke and
 * capture harnesses rely on the first frame being the finished scene).
 *
 * Models come out of `npm run assets` Draco-compressed with WebP textures.
 * The Draco decoder is served from public/draco/ — it has to be fetched as
 * files, not imported — and WebP needs no extension registration, GLTFLoader
 * handles EXT_texture_webp itself.
 */
export async function loadParkAssets(onProgress = () => {}) {
  const draco = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
  const gltf = new GLTFLoader().setDRACOLoader(draco);
  const tex = new THREE.TextureLoader();

  const glb = (url) => new Promise((res, rej) => gltf.load(url, res, undefined, rej));
  const texture = (url, { srgb = false, repeat = 1 } = {}) =>
    new Promise((res, rej) =>
      tex.load(url, (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(repeat, repeat);
        t.anisotropy = 8;
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        res(t);
      }, undefined, rej)
    );

  let done = 0;
  const total = 8;
  const tick = (v) => { done++; onProgress(done / total); return v; };

  const [tree, grass, asphaltDiff, asphaltNor, asphaltRough, groundDiff, groundNor, groundRough] = await Promise.all([
    glb(treeUrl).then(tick),
    glb(grassUrl).then(tick),
    texture(asphaltDiffUrl, { srgb: true }).then(tick),
    texture(asphaltNorUrl).then(tick),
    texture(asphaltRoughUrl).then(tick),
    texture(groundDiffUrl, { srgb: true }).then(tick),
    texture(groundNorUrl).then(tick),
    texture(groundRoughUrl).then(tick),
  ]);
  draco.dispose();

  return {
    tree: tree.scene,
    grass: grass.scene,
    asphalt: { diff: asphaltDiff, nor: asphaltNor, rough: asphaltRough },
    ground: { diff: groundDiff, nor: groundNor, rough: groundRough },
  };
}
