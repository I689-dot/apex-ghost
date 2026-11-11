#!/usr/bin/env python3
"""Detail layers for the Spa source model's hard surfaces (its embedded textures are cut to 256 px: walls, barriers,
rails and buildings turn to mush up close). Each layer is a scanned CC0 surface turned into neutral grain plus its
normal map; SpaLook multiplies it onto the source's own colours in world space (SpaLook.DETAIL), so the paint layouts
stay and the close-up texture is real.

   python3 -I tools/asset-pipeline/spa_godot/build_detail_textures.py <polyhaven dir> <ambientCG dir> godot/assets/textures/spa

Writes detail_<name>.png (greyscale, sRGB-encoded, linear mean 0.5: SpaLook doubles the material's colour) and
detail_<name>_nor.jpg (OpenGL normal map), 2048 px."""
import os
import sys

import numpy as np
from PIL import Image

ph, acg, out = sys.argv[1], sys.argv[2], sys.argv[3]
# name -> (colour map, normal map, contrast of the grain about its mean)
SETS = {
    'concrete': (f'{ph}/concrete_wall_008/concrete_wall_008_diff_2k.jpg', f'{ph}/concrete_wall_008/concrete_wall_008_nor_gl_2k.jpg', 1.5),
    'metal': (f'{acg}/Metal032/Metal032_2K-JPG_Color.jpg', f'{acg}/Metal032/Metal032_2K-JPG_NormalGL.jpg', 2.2),
    'painted': (f'{ph}/painted_concrete/painted_concrete_diff_2k.jpg', f'{ph}/painted_concrete/painted_concrete_nor_gl_2k.jpg', 0.32),
}
os.makedirs(out, exist_ok=True)


def lin(a):
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def enc(a):
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(np.maximum(a, 0), 1 / 2.4) - 0.055)


for name, (col, nor, k) in SETS.items():
    a = np.asarray(Image.open(col).convert('RGB').resize((2048, 2048), Image.LANCZOS)).astype(np.float64) / 255
    y = lin(a) @ [0.2126, 0.7152, 0.0722]
    g = np.clip(0.5 * (1.0 + (y / y.mean() - 1.0) * k), 0.0, 1.0)
    Image.fromarray((enc(g) * 255 + 0.5).astype(np.uint8), 'L').save(os.path.join(out, f'detail_{name}.png'), optimize=True)
    Image.open(nor).convert('RGB').resize((2048, 2048), Image.LANCZOS).save(os.path.join(out, f'detail_{name}_nor.jpg'), quality=92)
    print(f'[detail] {name}: grain {g.std():.3f} about 0.5 (linear)')
