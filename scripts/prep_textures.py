#!/usr/bin/env python3
"""
Normalise a downloaded model folder so the glTF toolchain can read it.

Downloaded packs routinely ship things glTF cannot express, and assimp will
either drop them silently or write a broken reference. This fixes the four
that actually come up, in place, before `npm run assets` runs assimp:

  1. Textures in formats glTF forbids (.tif/.tga/.bmp/.exr) -> .png.
  2. Separate opacity maps. OBJ puts cut-out alpha in its own greyscale file
     via `map_d`; glTF has no such concept and wants alpha in the albedo's
     fourth channel. Foliage with this unfixed renders as solid cards.
  3. A `mtllib` naming a file that is not there. Download sites rewrite
     spaces in filenames, so `mtllib tree lowpoly.mtl` arrives on disk as
     `tree+lowpoly.mtl` and the mesh loses every material.
  4. Oversized textures, capped to --max (default 2048).

  python3 scripts/prep_textures.py assets_raw/<folder>

Idempotent: converted files are reused on a second run.
"""
import argparse
import re
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("needs pillow:  pip install pillow")

# glTF permits PNG and JPEG only.
CONVERT_EXT = {".tif", ".tiff", ".tga", ".bmp", ".exr", ".psd", ".gif"}


def to_png(path: Path, max_size: int) -> Path:
    """Re-encode an unusable texture format as PNG. Returns the new path."""
    out = path.with_suffix(".png")
    if out.exists() and out.stat().st_mtime >= path.stat().st_mtime:
        return out
    im = Image.open(path)
    # 16-bit height maps and float EXRs have to come down to 8-bit to be a PNG
    # a glTF reader will accept.
    if im.mode in ("I;16", "I", "F"):
        im = im.point(lambda v: v * (1 / 256.0)).convert("L")
    elif im.mode not in ("RGB", "RGBA", "L"):
        im = im.convert("RGBA" if "A" in im.getbands() else "RGB")
    im = cap(im, max_size)
    im.save(out)
    return out


def cap(im: Image.Image, max_size: int) -> Image.Image:
    if max(im.size) <= max_size:
        return im
    scale = max_size / max(im.size)
    return im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.LANCZOS)


def merge_alpha(diffuse: Path, alpha: Path, max_size: int) -> Path:
    """Fold a standalone opacity map into the diffuse texture's alpha channel."""
    out = diffuse.with_name(diffuse.stem + "_rgba.png")
    if out.exists():
        return out
    rgb = cap(Image.open(diffuse).convert("RGB"), max_size)
    a = Image.open(alpha).convert("L").resize(rgb.size, Image.LANCZOS)
    rgb.putalpha(a)
    rgb.save(out)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("folder", type=Path)
    ap.add_argument("--max", type=int, default=2048)
    args = ap.parse_args()
    root: Path = args.folder
    if not root.is_dir():
        return print(f"not a directory: {root}") or 1

    changed = []

    # --- 1 & 4: formats glTF cannot take, and anything oversized -------------
    remap = {}
    for p in sorted(root.rglob("*")):
        if p.suffix.lower() in CONVERT_EXT:
            new = to_png(p, args.max)
            remap[p.name] = new.name
            changed.append(f"  {p.suffix} -> .png   {p.name}")

    # --- 3: a mtllib pointing at a file that is not on disk ------------------
    for obj in root.rglob("*.obj"):
        text = obj.read_text(errors="ignore")
        m = re.search(r"^mtllib\s+(.+?)\s*$", text, re.M)
        if not m:
            continue
        named = m.group(1)
        if (obj.parent / named).exists():
            continue
        cands = list(root.rglob("*.mtl"))
        if len(cands) != 1:
            print(f"  ! {obj.name} wants '{named}', found {len(cands)} .mtl files — skipping")
            continue
        target = obj.parent / named
        target.write_bytes(cands[0].read_bytes())
        changed.append(f"  mtllib repair    '{cands[0].name}' -> '{named}'")

    # --- 5: a PBR set whose albedo the .mtl never references -----------------
    # Packs often wire up normal/roughness and leave the base colour out, which
    # renders as flat grey however good the texture set is. If a material names
    # a map from a <name>_<channel> set, look for the matching albedo.
    ALBEDO_WORDS = ("albedo", "basecolor", "base_color", "diffuse", "color", "col")

    # --- 2: separate opacity maps, plus the texture renames from step 1 ------
    for mtl in root.rglob("*.mtl"):
        lines = mtl.read_text(errors="ignore").splitlines()
        out_lines, block, blocks = [], [], []
        for ln in lines:                      # split into per-material blocks
            if ln.strip().startswith("newmtl"):
                if block:
                    blocks.append(block)
                block = [ln]
            elif block:
                block.append(ln)
            else:
                out_lines.append(ln)
        if block:
            blocks.append(block)

        for blk in blocks:
            def find(key):
                for i, l in enumerate(blk):
                    if l.strip().startswith(key + " "):
                        return i, l.strip().split(None, 1)[1].strip()
                return None, None

            di, dv = find("map_Kd")
            ai, av = find("map_d")

            if di is None:
                # Take the stem of any map this material does reference, strip
                # its channel suffix, and look for the albedo of the same set.
                stem = None
                for key in ("map_Bump", "bump", "map_Ns", "norm", "map_Ks"):
                    _, v = find(key)
                    if v:
                        stem = Path(v.split()[-1])
                        break
                if stem is not None:
                    base = re.sub(r"_(normal|roughness|rough|ao|height|spec|metallic|gloss)$",
                                  "", stem.stem, flags=re.I)
                    for cand in sorted((mtl.parent / stem.parent).glob(f"{base}_*")):
                        if any(w in cand.stem.lower()[len(base):] for w in ALBEDO_WORDS):
                            rel = cand.relative_to(mtl.parent).as_posix()
                            blk.insert(1, f"map_Kd {rel}")
                            changed.append(f"  albedo restored  {blk[0].split()[-1]} -> {cand.name}")
                            di, dv = find("map_Kd")
                            break
            if di is not None and ai is not None and dv != av:
                dpath, apath = mtl.parent / dv, mtl.parent / av
                if dpath.exists() and apath.exists():
                    merged = merge_alpha(dpath, apath, args.max)
                    rel = merged.relative_to(mtl.parent).as_posix()
                    blk[di] = f"map_Kd {rel}"
                    blk[ai] = None            # glTF carries alpha in the albedo
                    changed.append(f"  alpha merged     {dpath.name} + {apath.name} -> {merged.name}")
            out_lines.extend([l for l in blk if l is not None])

        text = "\n".join(out_lines) + "\n"
        for old, new in remap.items():        # point at the converted textures
            text = text.replace(old, new)
        mtl.write_text(text)

    print(f"prepared {root}" if changed else f"{root}: nothing to fix")
    for c in changed:
        print(c)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
