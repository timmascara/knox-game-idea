# assets_raw — drop downloaded models here

The inbox for model packs downloaded from the internet. Nothing here ships:
`npm run assets` turns each folder into one compressed, self-contained
`.glb` in `src/assets/`.

## How to add a model

**One folder per model. Every file that came with it goes in that folder,
including the texture archive — leave it zipped.**

```
assets_raw/
  tree/
    tree.obj              <- the mesh
    tree lowpoly.mtl      <- material sidecar (OBJ packs have one)
    tree_texture.7z       <- textures, still archived
```

```bash
npm run assets                 # everything
npm run assets -- tree         # one folder
```

Then **look at it** before believing it — see *Check it rendered* below.

## What the pipeline does

Five stages, because no single tool survives a real download:

| | Stage | Why it exists |
|---|---|---|
| 0 | unpack `.zip` / `.7z` | Texture sets ship archived beside the mesh |
| 1 | `prep_textures.py` | Normalises what glTF cannot express (below) |
| 2 | `assimp` | Reads `.fbx`/`.obj`/`.dae`/`.blend` → glTF |
| 3 | `fix_materials.mjs` | Puts back what assimp's glTF writer drops |
| 4 | `gltf-transform` | WebP textures, Draco geometry, one binary |

Stages 1 and 3 exist because of specific, repeatable failures. Each one was
hit for real converting the first tree:

- **`.tif` / `.tga` textures.** glTF permits PNG and JPEG only. 16-bit height
  maps also have to come down to 8-bit.
- **Cut-out alpha in a separate file.** OBJ puts it in its own greyscale image
  via `map_d`; glTF wants it in the albedo's fourth channel. Unfixed, every
  leaf renders as a solid rectangle.
- **A `mtllib` naming a file that is not there.** Download sites rewrite
  spaces, so `mtllib tree lowpoly.mtl` arrives as `tree+lowpoly.mtl` and the
  mesh silently loses every material.
- **An albedo the `.mtl` never references.** Packs routinely wire up normal
  and roughness and leave base colour out, giving a flat grey trunk beside a
  perfectly good bark texture.
- **assimp drops `alphaMode`, `doubleSided`, normal and roughness maps** when
  writing glTF, whatever the `.mtl` said.

## Check it rendered

A clean conversion and a correct model are different things. File size will
not tell you the leaves came out solid.

```bash
npm run dev -- --port 5180          # one shell
npm run assets:preview -- tree      # another
```

Writes `screenshots/asset_tree_{front,side,low}.png` and prints the model's
world bounds. **Read the bounds.** Packs are modelled at wildly varying
scales, and a file called "tree" often holds a whole grove — the first one
converted here turned out to be nine trees spanning 46 m.

## Rules that actually matter

1. **Leave archives zipped.** The pipeline unpacks them; extracted textures
   are gitignored so the repo does not carry every texture twice.
2. **Keep the download's folder structure.** The `.mtl` points at textures by
   relative path.
3. **The folder name becomes the asset name.** `assets_raw/park_bench/` →
   `src/assets/park_bench.glb`. Lowercase, underscores.
4. **One model per folder.** Twelve props in a pack is twelve folders.
5. **Do not commit loose textures.** `.gitignore` covers the usual extensions
   under `assets_raw/`; the archive is the thing worth keeping.

## Formats

`.fbx`, `.obj`, `.dae`, `.blend`, `.3ds`, `.ply`, `.stl`, `.gltf`, `.glb`.
A `.gltf`/`.glb` source skips conversion and goes straight to compression.

If a folder holds several mesh files the script prefers the most web-friendly
format, then the largest file. A pack shipping the same model as `.blend`,
`.obj`, `.dae` **and** `.fbx` only needs one of them kept.

## Per-model overrides: `meta.json`

Drop a `meta.json` beside the mesh for what no file format carries reliably:

```json
{ "scale": 0.01, "heightTint": ["#5e6e22", "#8dbf45"] }
```

- `scale` — FBX is often authored in centimetres. The preview's bounds line
  is how you find out: a grass clump reporting 189 m wide wants `0.01`.
- `heightTint` — `[base, tip]` colours baked as vertex colours by height. For
  foliage whose only texture was a gradient the pack forgot to ship.

## Textures the pack never shipped

An FBX that points at `C:\Users\<author>\...\grass_Color.jpg` was exported
without its textures, and no amount of searching the download will find
them. The pipeline looks the file up by name anywhere in the folder and,
failing that, drops the reference so the model still converts, untextured
(it says so in the log). Modelled-blade grass survives this fine with a
`heightTint`; a texture-atlas model does not, and wants a different download.

## Known gaps

- **Animations in separate files** (the Mixamo pattern) are not merged. The
  script converts the mesh file and ignores the rest.
- **No splitting.** A file holding nine trees converts as one nine-tree
  object. Placing them individually needs a separate step that does not exist.

## Size and licences

Keep raw files under ~20 MB; git keeps every binary forever. A 2.85 GB `.obj`
is not a usable asset — find the `.fbx` of the same model.

These are third-party downloads. Note where each came from and what its
licence allows; several "free" sites are personal-use-only or require
attribution. Same open question as `src/assets/hand_right.glb`.
