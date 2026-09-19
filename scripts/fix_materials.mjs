/**
 * Repair glTF materials that assimp could not carry across from a .mtl.
 *
 * assimp's OBJ reader understands the MTL material model but its glTF writer
 * drops most of it. Three things go missing every time, and all three are
 * visible in-game:
 *
 *   - `alphaMode` stays OPAQUE, so cut-out foliage renders as solid
 *     rectangles however good the alpha channel is.
 *   - `doubleSided` stays false, so leaf cards vanish when seen from behind.
 *   - `map_Bump` / `map_Ns` never become normalTexture /
 *     metallicRoughnessTexture, so a full PBR set renders flat.
 *
 * This reads the source .mtl for ground truth, then writes those properties
 * onto the converted GLB, pulling in any texture assimp left behind.
 *
 *   node scripts/fix_materials.mjs <interim.gltf> assets_raw/tree
 *
 * Runs on the uncompressed interim glTF, before textures become WebP and the
 * geometry becomes Draco — neither of which this needs to decode.
 *
 * glTF packs roughness in a metallicRoughness texture's G channel, so a
 * standalone roughness map is rechannelled rather than attached as-is.
 */
import { NodeIO } from '@gltf-transform/core';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import sharp from 'sharp';

const [glbPath, srcDir, outPath] = process.argv.slice(2);
if (!glbPath || !srcDir) {
  console.error('usage: node scripts/fix_materials.mjs <interim.gltf> <assets_raw/folder> [out.glb]');
  process.exit(2);
}
// Writing a .glb pulls the external buffers and textures in, so the caller has
// one file to hand on and one file to delete.
const dest = outPath || glbPath;

/** Parse the .mtl into { materialName: { map_Kd, map_Bump, map_Ns, ... } }. */
function parseMtl(dir) {
  const file = readdirSync(dir).find((f) => f.toLowerCase().endsWith('.mtl'));
  if (!file) return {};
  const mats = {};
  let cur = null;
  for (const raw of readFileSync(join(dir, file), 'utf8').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('newmtl ')) { cur = line.slice(7).trim(); mats[cur] = { _dir: dir }; continue; }
    if (!cur) continue;
    const m = line.match(/^(map_\w+|bump)\s+(.*)$/i);
    if (!m) continue;
    // Strip MTL option flags (-bm 3.6, -s 1 1 1) — the path is what is left.
    const parts = m[2].split(/\s+/);
    const idx = parts.findIndex((p) => /\.(png|jpe?g|tga|bmp|tif|tiff)$/i.test(p));
    if (idx >= 0) mats[cur][m[1].toLowerCase()] = parts[idx];
  }
  return mats;
}

/** Does this texture carry alpha that actually varies? */
async function hasRealAlpha(dir, rel) {
  const p = join(dir, rel);
  if (!existsSync(p)) return false;
  const img = sharp(p);
  const meta = await img.metadata();
  if (!meta.hasAlpha) return false;
  const stats = await img.stats();
  const a = stats.channels[3];
  return a && a.min < 250; // a constant-255 alpha channel means opaque
}

const io = new NodeIO();
const doc = await io.read(glbPath);
const root = doc.getRoot();
const mtl = parseMtl(srcDir);
const changes = [];

/** Load an external image into the document as a Texture. */
function addTexture(rel, name) {
  const p = join(srcDir, rel);
  if (!existsSync(p)) return null;
  const mime = /\.jpe?g$/i.test(p) ? 'image/jpeg' : 'image/png';
  return doc.createTexture(name).setImage(readFileSync(p)).setMimeType(mime);
}

for (const mat of root.listMaterials()) {
  const name = mat.getName();
  const src = mtl[name];
  if (!src) continue;

  // --- cut-out foliage -----------------------------------------------------
  const albedo = src.map_kd;
  if (albedo && (await hasRealAlpha(srcDir, albedo))) {
    mat.setAlphaMode('MASK').setAlphaCutoff(0.5).setDoubleSided(true);
    changes.push(`${name}: alphaMode=MASK cutoff=0.5 doubleSided=true`);
  }

  // --- normal map ----------------------------------------------------------
  const normal = src.map_bump || src.bump || src.norm;
  if (normal && !mat.getNormalTexture()) {
    const tex = addTexture(normal, `${name}_normal`);
    if (tex) { mat.setNormalTexture(tex); changes.push(`${name}: normalTexture <- ${basename(normal)}`); }
  }

  // --- roughness -----------------------------------------------------------
  // glTF wants occlusion/roughness/metalness in R/G/B of one texture. A loose
  // greyscale roughness map has to be moved into the green channel.
  const rough = src.map_ns || src.map_pr;
  if (rough && !mat.getMetallicRoughnessTexture()) {
    const p = join(srcDir, rough);
    if (existsSync(p)) {
      const g = await sharp(p).greyscale().toBuffer();
      const { width, height } = await sharp(p).metadata();
      const packed = await sharp({ create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } } })
        .composite([{ input: g, blend: 'add' }])           // roughness -> G
        .png().toBuffer();
      // composite writes greyscale into all channels; isolate G by zeroing R/B.
      const rgb = await sharp(packed).removeAlpha().toColourspace('srgb').raw().toBuffer();
      for (let i = 0; i < rgb.length; i += 3) { rgb[i] = 0; rgb[i + 2] = 0; }
      const out = await sharp(rgb, { raw: { width, height, channels: 3 } }).png().toBuffer();
      const tex = doc.createTexture(`${name}_metalRough`).setImage(out).setMimeType('image/png');
      mat.setMetallicRoughnessTexture(tex).setRoughnessFactor(1).setMetallicFactor(0);
      changes.push(`${name}: metallicRoughnessTexture <- ${basename(rough)} (G channel)`);
    }
  }
}

await io.write(dest, doc);
if (!changes.length) { console.log('no material repairs needed'); process.exit(0); }
console.log(`repaired ${dest}:`);
for (const c of changes) console.log('  ' + c);
