#!/usr/bin/env python3
"""
Turn a decal texture set (diffuse + separate alpha) into RGBA WebP cut-outs
in src/assets/textures/, for scattering on flat quads.

The leaf pack ships each set as <name>_diff_2k.jpg plus <name>_alpha_2k.jpg.
glTF and three.js both want the alpha in the image, so they are merged.

  python3 scripts/prep_decals.py assets_raw/leaf_decals/<zip> leaves_01 leaves_04 leaves_07
"""
import sys, zipfile, io, re
from pathlib import Path
from PIL import Image

OUT = Path("src/assets/textures")
SIZE = 512  # these are scattered small and many; 512 is ample


def main(zip_path, names):
    OUT.mkdir(parents=True, exist_ok=True)
    z = zipfile.ZipFile(zip_path)
    entries = z.namelist()
    for name in names:
        diff = next((n for n in entries if re.search(rf"{name}_diff", n, re.I)), None)
        alpha = next((n for n in entries if re.search(rf"{name}_alpha", n, re.I)), None)
        if not diff or not alpha:
            print(f"  ! {name}: diff={bool(diff)} alpha={bool(alpha)} — skipped")
            continue
        rgb = Image.open(io.BytesIO(z.read(diff))).convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)
        a = Image.open(io.BytesIO(z.read(alpha))).convert("L").resize((SIZE, SIZE), Image.LANCZOS)
        rgb.putalpha(a)
        p = OUT / f"decal_{name}.webp"
        rgb.save(p, "WEBP", quality=86, method=6)
        print(f"  decal_{name}.webp  {p.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
