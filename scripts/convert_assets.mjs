/**
 * Asset conversion pipeline.
 *
 * Downloaded model packs arrive as several loose files — a mesh (.fbx/.obj/
 * .dae/.blend), a material sidecar (.mtl), and a folder of textures. The game
 * wants exactly one self-contained .glb per model. This walks every folder in
 * assets_raw/ and produces src/assets/<folder-name>.glb.
 *
 *   npm run assets              # convert every folder
 *   npm run assets -- tree_oak  # convert just one
 *
 * Five stages, because no one tool does the whole job:
 *   0. unpack — texture sets ship as .zip/.7z beside the mesh; extract them
 *                so the .mtl's relative paths resolve.
 *   1. prep_textures.py — normalise what glTF cannot express: .tif/.tga
 *                textures, cut-out alpha in its own file, a `mtllib` naming a
 *                file that download sites renamed, an unreferenced albedo.
 *   2. assimp  — reads the source format, writes glTF. Leaves textures as
 *                external file references.
 *   3. fix_materials.mjs — puts back what assimp's glTF writer drops: cut-out
 *                alpha, double-sidedness, normal and roughness maps. Runs on
 *                the uncompressed interim so nothing has to be decoded.
 *   4. gltf-transform — resolves the texture references, recompresses to
 *                WebP, Draco-compresses the geometry, and embeds everything
 *                into a single binary.
 *
 * Needs `assimp` and `7z` on PATH (apt install assimp-utils p7zip-full) and
 * python3 with pillow. gltf-transform is fetched by npx on demand.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, extname, basename, dirname, relative } from 'node:path';

const RAW = 'assets_raw';
// Models go to public/ as .gltf with their textures as SEPARATE FILES, not
// embedded. An embedded texture has to be handed to the browser as a blob:
// URL, and strict-CSP hosts (the published artifact frame among them) refuse
// to load images from blob: — the model arrives, every material comes through
// untextured white, and cut-out foliage turns into solid shards. Plain files
// next to the .gltf are ordinary same-origin requests and always work. They
// live in public/ so Vite copies them verbatim and the .gltf's relative URIs
// still resolve.
const OUT = 'public/models';
// The interim glTF is written beside its own source rather than in a temp
// directory: assimp emits texture references as paths relative to the file it
// writes, so moving it elsewhere breaks every one of them.
const INTERIM = '__interim.gltf';
// fix_materials rewrites the interim as a self-contained .glb, so the
// external buffers and textures assimp emitted alongside it are cleaned up
// rather than left in the source folder.
const INTERIM_FIXED = '__interim.glb';

// Preferred in order: an existing glTF needs no conversion at all.
const MESH_EXT = ['.gltf', '.glb', '.fbx', '.obj', '.dae', '.blend', '.3ds', '.ply', '.stl'];

function findMesh(dir) {
  const hits = [];
  (function walk(d) {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e !== INTERIM && MESH_EXT.includes(extname(e).toLowerCase())) hits.push(p);
    }
  })(dir);
  // Rank by format preference, then by file size (the biggest mesh is almost
  // always the model itself rather than a stray collision proxy or LOD).
  hits.sort((a, b) => {
    const r = MESH_EXT.indexOf(extname(a).toLowerCase()) - MESH_EXT.indexOf(extname(b).toLowerCase());
    return r !== 0 ? r : statSync(b).size - statSync(a).size;
  });
  return hits[0] || null;
}

const kb = (n) => (n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`);

/** Total bytes of a source folder — the honest "before", since the output
 *  rolls the mesh, its materials and every texture into one file. */
function dirSize(dir) {
  let n = 0;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    n += st.isDirectory() ? dirSize(p) : st.size;
  }
  return n;
}

/**
 * Point every image URI in the interim glTF at a file that exists.
 *
 * FBX and some OBJ exports carry the texture path from the author's machine
 * (`C:\\Users\\...\\grass_Color.jpg`). assimp writes that through verbatim,
 * and the next stage crashes trying to open it. The file's *name* is usually
 * right, so look the basename up anywhere under the source folder. When it
 * is nowhere — the pack shipped without its textures — drop the reference
 * so the material comes through untextured rather than the whole model
 * failing to convert.
 */
function resolveImageUris(interim, dir) {
  const j = JSON.parse(readFileSync(interim, 'utf8'));
  if (!j.images?.length) return [];
  const byName = new Map();
  (function walk(d) {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else byName.set(e.toLowerCase(), p);
    }
  })(dir);
  const notes = [];
  const dropped = new Set();
  j.images.forEach((img, i) => {
    if (!img.uri || img.uri.startsWith('data:')) return;
    const uri = decodeURIComponent(img.uri);
    if (existsSync(join(dirname(interim), uri))) return;
    const base = uri.split(/[\\/]/).pop();
    const hit = byName.get(base.toLowerCase());
    if (hit) {
      img.uri = relative(dirname(interim), hit).split('\\').join('/');
      notes.push(`texture found by name  ${base}`);
    } else {
      dropped.add(i);
      notes.push(`texture MISSING        ${base} — material left untextured`);
    }
  });
  if (dropped.size) {
    // Remove the dead images and every texture that used them, then renumber
    // the survivors and unlink any material slot that pointed at a casualty.
    const imgMap = new Map();
    j.images = j.images.filter((img, i) => (dropped.has(i) ? false : (imgMap.set(i, imgMap.size), true)));
    const texMap = new Map();
    j.textures = (j.textures || []).filter((t, i) => {
      if (dropped.has(t.source)) return false;
      t.source = imgMap.get(t.source);
      texMap.set(i, texMap.size);
      return true;
    });
    const fix = (o) => {
      if (!o || typeof o !== 'object') return;
      for (const k of Object.keys(o)) {
        const v = o[k];
        if (v && typeof v === 'object' && typeof v.index === 'number' && /Texture$/.test(k)) {
          if (texMap.has(v.index)) v.index = texMap.get(v.index); else delete o[k];
        } else fix(v);
      }
    };
    (j.materials || []).forEach(fix);
  }
  writeFileSync(interim, JSON.stringify(j));
  return notes;
}

/** Remove every file the interim conversion dropped in the source folder. */
function cleanInterim(dir) {
  for (const f of readdirSync(dir)) {
    if (f.startsWith('__interim.') || /^(normal|metallicRoughness|baseColor|emissive|occlusion)_\d+\.(png|jpe?g)$/.test(f)) {
      rmSync(join(dir, f), { force: true });
    }
  }
}

const only = process.argv.slice(2);
if (!existsSync(RAW)) { console.error(`no ${RAW}/ — nothing to convert`); process.exit(0); }

const folders = readdirSync(RAW)
  .filter((f) => statSync(join(RAW, f)).isDirectory())
  .filter((f) => !only.length || only.includes(f));

if (!folders.length) { console.error(`no folders in ${RAW}/`); process.exit(0); }

mkdirSync(OUT, { recursive: true });
let failed = 0;

for (const name of folders) {
  const dir = join(RAW, name);
  const mesh = findMesh(dir);
  if (!mesh) {
    // assets_raw also holds texture-only folders (ground sets, decal packs).
    // Not a failure — there is just nothing here to convert.
    console.log(`· ${name.padEnd(20)} no mesh, skipped (texture-only folder)`);
    continue;
  }

  const before = dirSize(dir);   // measured after unpacking, below
  const interim = join(dir, INTERIM);
  const fixed = join(dir, INTERIM_FIXED);
  const outDir = join(OUT, name);
  const out = join(outDir, 'model.gltf');

  mkdirSync(outDir, { recursive: true });
  try {
    // Stage 0 — unpack any texture archives sitting beside the mesh.
    for (const f of readdirSync(dir)) {
      if (!/\.(zip|7z)$/i.test(f)) continue;
      execFileSync('7z', ['x', join(dir, f), `-o${dir}`, '-y'], { stdio: 'pipe' });
    }

    // Stage 1 — normalise textures and repair the .mtl before assimp sees it.
    const prep = execFileSync('python3', ['scripts/prep_textures.py', dir], { stdio: 'pipe' }).toString().trim();
    for (const l of prep.split('\n').slice(1)) if (l.trim()) console.log(`  ${l.trim()}`);

    // Stage 2 — into glTF. A .glb/.gltf source skips this and goes straight
    // to the optimizer, which reads it natively.
    const src = ['.glb', '.gltf'].includes(extname(mesh).toLowerCase()) ? mesh : interim;
    if (src === interim) execFileSync('assimp', ['export', mesh, interim], { stdio: 'pipe' });

    // Stage 3 — repair the materials assimp could not translate. Only
    // meaningful for formats with a separate material file; harmless
    // otherwise, since it no-ops when it finds no .mtl.
    let optimizeFrom = src;
    if (src === interim) {
      for (const n of resolveImageUris(interim, dir)) console.log(`  ${n}`);
      const fix = execFileSync('node', ['scripts/fix_materials.mjs', interim, dir, fixed], { stdio: 'pipe' });
      const msg = fix.toString().trim();
      if (msg && !msg.startsWith('no material')) {
        for (const l of msg.split('\n').slice(1)) console.log(`  ${l.trim()}`);
      }
      if (existsSync(fixed)) optimizeFrom = fixed;
    }

    // Optional decimation, from meta.json's `simplify` (a target triangle
    // ratio). The grass clump ships at ~15k triangles for something rendered
    // a few centimetres tall; at 900 instances that was 6.7 M triangles, 92%
    // of the whole scene, and it stalled the headless harness outright.
    const meta = existsSync(join(dir, 'meta.json')) ? JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) : {};
    const simplify = meta.simplify
      ? ['--simplify', 'true', '--simplify-ratio', String(meta.simplify), '--simplify-error', String(meta.simplifyError ?? 0.02)]
      : ['--simplify', 'false'];

    // Stage 4 — resolve external textures, compress, embed into one binary.
    execFileSync('npx', ['--yes', '@gltf-transform/cli@latest', 'optimize', optimizeFrom, out,
      '--compress', 'draco', '--texture-compress', 'webp', '--texture-size', '2048',
      ...simplify,
      // optimize's default `join` fuses every node sharing a material into one
      // mesh, which destroys the per-object split (and any pack that arrived
      // already separated). Keep nodes as they are.
      '--no-join'],
      { stdio: 'pipe' });

    cleanInterim(dir);
    const after = statSync(out).size;
    const pct = ((1 - after / before) * 100).toFixed(0);
    console.log(`✓ ${name.padEnd(20)} ${basename(mesh).padEnd(28)} ${kb(before)} → ${kb(after)}  (${pct}% smaller)`);
  } catch (e) {
    cleanInterim(dir);
    console.error(`✗ ${name}: ${(e.stderr?.toString() || e.message).trim().split('\n').slice(-3).join('\n   ')}`);
    failed++;
  }
}

process.exit(failed ? 1 : 0);
