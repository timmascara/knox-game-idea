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
 * Two stages, because neither tool does the whole job:
 *   1. assimp  — reads the source format, writes glTF. Leaves textures as
 *                external file references.
 *   2. gltf-transform — resolves those references, recompresses the textures
 *                to WebP, Draco-compresses the geometry, and embeds
 *                everything into a single binary.
 *
 * Needs `assimp` on PATH (apt install assimp-utils). gltf-transform is
 * fetched by npx on demand.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

const RAW = 'assets_raw';
const OUT = 'src/assets';
// The interim glTF is written beside its own source rather than in a temp
// directory: assimp emits texture references as paths relative to the file it
// writes, so moving it elsewhere breaks every one of them.
const INTERIM = '__interim.gltf';

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
  if (!mesh) { console.error(`✗ ${name}: no mesh file found (looked for ${MESH_EXT.join(' ')})`); failed++; continue; }

  const before = dirSize(dir);
  const interim = join(dir, INTERIM);
  const out = join(OUT, `${name}.glb`);

  try {
    // Stage 1 — into glTF. A .glb/.gltf source skips this and goes straight
    // to the optimizer, which reads it natively.
    const src = ['.glb', '.gltf'].includes(extname(mesh).toLowerCase()) ? mesh : interim;
    if (src === interim) execFileSync('assimp', ['export', mesh, interim], { stdio: 'pipe' });

    // Stage 2 — resolve external textures, compress, embed into one binary.
    execFileSync('npx', ['--yes', '@gltf-transform/cli@latest', 'optimize', src, out,
      '--compress', 'draco', '--texture-compress', 'webp', '--texture-size', '2048'],
      { stdio: 'pipe' });

    rmSync(interim, { force: true });
    const after = statSync(out).size;
    const pct = ((1 - after / before) * 100).toFixed(0);
    console.log(`✓ ${name.padEnd(20)} ${basename(mesh).padEnd(28)} ${kb(before)} → ${kb(after)}  (${pct}% smaller)`);
  } catch (e) {
    rmSync(interim, { force: true });
    console.error(`✗ ${name}: ${(e.stderr?.toString() || e.message).trim().split('\n').slice(-3).join('\n   ')}`);
    failed++;
  }
}

process.exit(failed ? 1 : 0);
