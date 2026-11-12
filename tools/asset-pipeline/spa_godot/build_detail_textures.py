#!/usr/bin/env python3
"""Detail layers for the Spa source model's hard surfaces (its embedded textures are cut to 256 px: walls, barriers,
rails and buildings turn to mush up close). Each layer is a scanned CC0 surface turned into neutral grain plus its
normal map; SpaLook multiplies it onto the source's own colours in world space (SpaLook.DETAIL), so the paint layouts
stay and the close-up texture is real.

   python3 -I tools/asset-pipeline/spa_godot/build_detail_textures.py <polyhaven dir> <ambientCG dir> godot/assets/textures/spa

Writes detail_<name>.png (greyscale, sRGB-encoded, linear mean 0.5: SpaLook doubles the material's colour) and
detail_<name>_nor.jpg (OpenGL normal map), 2048 px. Also catch_fence.png: the catch fence redrawn at 4x (the source's
64 x 256 texture draws its wire mesh as an 11 % alpha fill and its cables at 23 %: an alpha cut at 45 % left only the
posts): cables 2 px solid at the source's cable rows, a diamond chain-link mesh in the band where the source's mesh is,
the rails kept; galvanised grey-green. Mapped as the source's (v the fence's height, u along it)."""
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


def catch_fence():
    W, H = 256, 1024
    a = np.zeros((H, W), np.float32)
    # the source's rows (of 256) x 4: cable pairs every 8 rows in 0-127 and 192-223, the dense mesh band 128-191, rails
    # at 236-240 and 251-254
    for r in list(range(7, 128, 8)) + list(range(195, 224, 8)):
        a[r * 4:r * 4 + 2, :] = 1.0
    y0, y1 = 128 * 4, 192 * 4
    yy, xx = np.mgrid[y0:y1, 0:W]
    # chain link: 50 mm diamonds, the texture about 4 mm a texel (the fence about 4 m tall over 1024 rows)
    p = 12.0
    d1 = np.abs(((xx + yy) % p) - p / 2)
    d2 = np.abs(((xx - yy) % p) - p / 2)
    wire = np.clip(1.2 - np.minimum(np.abs(d1 - p / 2), np.abs(d2 - p / 2)), 0, 1)
    a[y0:y1] = np.maximum(a[y0:y1], wire)
    a[y0:y0 + 3] = 1.0
    a[y1 - 3:y1] = 1.0
    for r0, r1 in ((236, 240), (251, 254)):
        a[r0 * 4:r1 * 4] = 1.0
    rgb = np.zeros((H, W, 3), np.float32)
    rgb[:] = np.array([96, 108, 104], np.float32)
    shade = 0.85 + 0.15 * np.sin(np.arange(W) / W * 2 * np.pi * 3)[None, :]
    rgb *= shade[..., None]
    img = np.concatenate([rgb, a[..., None] * 255], -1).clip(0, 255).astype(np.uint8)
    Image.fromarray(img, 'RGBA').save(os.path.join(out, 'catch_fence.png'), optimize=True)
    print(f'[detail] catch fence: {float((a > 0.5).mean()):.0%} wire coverage')


catch_fence()
