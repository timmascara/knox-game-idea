# assets_raw — drop downloaded models here

This is the inbox for model packs downloaded from the internet. Nothing in
here ships; `npm run assets` converts each folder into one compressed
self-contained `.glb` in `src/assets/`.

## How to add a model

**One folder per model. Every file that came with it goes in that folder.**

```
assets_raw/
  tree_oak/
    tree.fbx                  <- the mesh
    tree.mtl                  <- material sidecar, if the pack has one
    textures/
      bark_diffuse.png        <- textures, in whatever folder they came in
      bark_normal.png
      leaves_diffuse.png
```

Then:

```bash
npm run assets            # convert everything in assets_raw/
npm run assets -- tree_oak  # or just one folder
```

Output: `src/assets/tree_oak.glb` — mesh, textures and materials packed into
a single file, geometry Draco-compressed, textures re-encoded to WebP and
capped at 2048px.

## Rules that actually matter

1. **Keep the folder structure the download came in.** The mesh file points at
   its textures by relative path (`textures/bark_diffuse.png`). Flatten the
   folders and those links break and you get an untextured grey blob.
2. **Include the `.mtl` if the mesh is an `.obj`.** That file is what connects
   the mesh to its textures. It is the single most commonly forgotten piece.
3. **The folder name becomes the asset name.** `assets_raw/park_bench/` →
   `src/assets/park_bench.glb`. Use lowercase with underscores.
4. **One model per folder.** If a pack contains twelve props, that is twelve
   folders, not one.

## Formats

Reads `.fbx`, `.obj`, `.dae`, `.blend`, `.3ds`, `.ply`, `.stl`, `.gltf`,
`.glb` — via assimp, so most things a pack ships will work. A `.gltf`/`.glb`
source skips conversion and goes straight to compression.

If a folder holds several mesh files the script takes the most
web-friendly format, then the largest file, on the assumption that the biggest
mesh is the model rather than a collision proxy or a low LOD. If it picks
wrong, delete the ones you do not want.

## Known gap: animations in separate files

Packs sometimes ship the mesh in one file and each animation in its own
(the Mixamo pattern). This script does **not** merge those — it converts the
mesh file and any animation inside it, and ignores the rest. Merging separate
animation clips onto one skeleton needs the rigs to match exactly and is
fragile. If you have a model like this, say so rather than assuming it worked.

## Size

Keep individual raw files under ~20 MB. Git stores every binary forever, so a
large file committed once stays in the repo's history even after deletion. If
a source file is bigger than that, it is film- or archviz-grade and wants
decimating before it comes anywhere near a web build.

## Licences

These are third-party downloads. Note where each one came from and what its
licence allows — several "free" model sites are personal-use-only or require
attribution. Same open question as `src/assets/hand_right.glb`. It does not
matter while building; it matters if this is ever published.
