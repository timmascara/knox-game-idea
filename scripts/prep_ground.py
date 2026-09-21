#!/usr/bin/env python3
"""
Turn a Poly Haven texture download into the three maps the game's ground
materials want, as WebP in src/assets/textures/:

  <name>_diff.webp   colour
  <name>_nor.webp    tangent-space normal, OpenGL convention (what three.js wants)
  <name>_rough.webp  roughness, greyscale

Poly Haven ships the normal and roughness as 16-bit EXR, which no browser
reads, and either a standalone roughness map or an "arm" (AO / roughness /
metal) pack with roughness in G. Both are handled.

  python3 scripts/prep_ground.py assets_raw/clean_asphalt_1k.zip asphalt
  python3 scripts/prep_ground.py assets_raw/leafy_grass_1k.blend.zip grass_ground
"""
import sys, zipfile, io, re
from pathlib import Path
import numpy as np
from PIL import Image
import OpenEXR, Imath

OUT = Path("src/assets/textures")
SIZE = 1024   # the game repeats these every few metres; 1K is plenty


def exr_to_array(data: bytes) -> np.ndarray:
    tmp = Path("/tmp/_prep_ground.exr"); tmp.write_bytes(data)
    f = OpenEXR.InputFile(str(tmp))
    hdr = f.header(); dw = hdr["dataWindow"]
    w, h = dw.max.x - dw.min.x + 1, dw.max.y - dw.min.y + 1
    chans = [c for c in ("R", "G", "B") if c in hdr["channels"]] or list(hdr["channels"])[:1]
    pt = Imath.PixelType(Imath.PixelType.FLOAT)
    arr = np.stack([np.frombuffer(f.channel(c, pt), np.float32).reshape(h, w) for c in chans], -1)
    return arr


def save(arr: np.ndarray, path: Path, mode: str):
    im = Image.fromarray(np.clip(arr * 255 + 0.5, 0, 255).astype(np.uint8), mode)
    if max(im.size) > SIZE:
        im = im.resize((SIZE, SIZE), Image.LANCZOS)
    im.save(path, "WEBP", quality=88, method=6)
    print(f"  {path.name:28} {im.size[0]}x{im.size[1]}  {path.stat().st_size // 1024} KB")


def main(zip_path: str, name: str):
    OUT.mkdir(parents=True, exist_ok=True)
    z = zipfile.ZipFile(zip_path)
    names = z.namelist()
    pick = lambda pat: next((n for n in names if re.search(pat, n, re.I)), None)

    diff = pick(r"_diff_\d+k\.(jpg|png)$")
    nor = pick(r"_nor_gl_\d+k\.(exr|png|jpg)$")
    rough = pick(r"_rough_\d+k\.(exr|png|jpg)$")
    arm = pick(r"_arm_\d+k\.(jpg|png)$")
    print(f"{name}: diff={diff and Path(diff).name} nor={nor and Path(nor).name} rough={(rough or arm) and Path(rough or arm).name}")

    im = Image.open(io.BytesIO(z.read(diff))).convert("RGB")
    save(np.asarray(im, np.float32) / 255, OUT / f"{name}_diff.webp", "RGB")

    if nor.lower().endswith(".exr"):
        n = exr_to_array(z.read(nor))[..., :3]
    else:
        n = np.asarray(Image.open(io.BytesIO(z.read(nor))).convert("RGB"), np.float32) / 255
    save(n, OUT / f"{name}_nor.webp", "RGB")

    if rough:
        r = exr_to_array(z.read(rough))[..., 0] if rough.lower().endswith(".exr") \
            else np.asarray(Image.open(io.BytesIO(z.read(rough))).convert("L"), np.float32) / 255
    else:
        r = np.asarray(Image.open(io.BytesIO(z.read(arm))).convert("RGB"), np.float32)[..., 1] / 255
    save(r, OUT / f"{name}_rough.webp", "L")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
