/**
 * Stage the production build for publishing as a Claude artifact.
 *
 * The artifact host serves a fixed set of file extensions. Three of the
 * build's are not on it — `.glb`, `.gltf`, `.bin` — and a fourth, the
 * sourcemap, is 7 MB of dead weight. Nothing about the *content* is a
 * problem, so this copies dist/ and renames those files to extensions the
 * host does serve, rewriting every reference to match:
 *
 *   model.gltf -> model.json    (GLTFLoader sniffs content, not extension)
 *   model.bin  -> model.wasm    (served as application/wasm: binary-safe)
 *
 * The published page is otherwise byte-identical to what GitHub Pages gets.
 *
 *   npm run build && node scripts/prep_artifact.mjs
 *   -> writes .artifact/ and prints the file map to publish
 */
import { cpSync, rmSync, readdirSync, statSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const SRC = 'dist';
const OUT = '.artifact';
const RENAME = { '.gltf': '.json', '.bin': '.wasm', '.glb': '.wasm' };

if (!existsSync(SRC)) { console.error('no dist/ — run npm run build first'); process.exit(1); }
rmSync(OUT, { recursive: true, force: true });
cpSync(SRC, OUT, { recursive: true });

const files = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    statSync(p).isDirectory() ? walk(p) : files.push(p);
  }
})(OUT);

// Sourcemaps are not worth 7 MB of the artifact's budget.
for (const f of files.filter((f) => f.endsWith('.map'))) rmSync(f);

const renamed = [];
for (const f of files) {
  if (f.endsWith('.map')) continue;
  const to = RENAME[extname(f).toLowerCase()];
  if (!to) continue;
  const dst = f.slice(0, -extname(f).length) + to;
  renameSync(f, dst);
  renamed.push([f.split('/').pop(), dst.split('/').pop()]);
}

// Rewrite every reference to a renamed file, in the text files that can hold
// one: the page, the bundles, and the glTF JSON (which names its own buffer).
const texty = ['.html', '.js', '.mjs', '.css', '.json'];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!texty.includes(extname(p))) continue;
    let t = readFileSync(p, 'utf8');
    let hit = false;
    for (const [from, to] of renamed) {
      if (t.includes(from)) { t = t.split(from).join(to); hit = true; }
    }
    if (hit) writeFileSync(p, t);
  }
})(OUT);

const out = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    statSync(p).isDirectory() ? walk(p) : out.push(relative(OUT, p));
  }
})(OUT);

console.log(`staged ${out.length} files in ${OUT}/  (renamed ${renamed.length})`);
const page = out.find((f) => f === 'index.html');
console.log('page:', page);
console.log(JSON.stringify(Object.fromEntries(out.filter((f) => f !== page).map((f) => [f, f])), null, 0));
