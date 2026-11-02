#!/usr/bin/env python3
"""The blade height field of the lawn shells (port of bladeTexture in game/grassShells.ts): R = blade height (each blade
a small cone), G = per-blade colour variation; 512 px, tiled every ~1.2 m."""
import math, os, random
import numpy as np
from PIL import Image

N = 512
out = os.path.join(os.path.dirname(__file__), '..', '..', 'godot', 'assets_static', 'ground', 'blades.png')
rng = random.Random(9091)
h = np.zeros((N, N), dtype=np.float32)
g = np.full((N, N), 0.5, dtype=np.float32)
for _ in range(42000):
    cx = rng.random() * N; cy = rng.random() * N
    # most blades near the mowing height, a few shorter ones and a few that escaped the mower
    height = min(1.0, 0.55 + rng.random() * 0.4 + (0.25 if rng.random() < 0.04 else 0))
    rad = 1.1 + rng.random() * 1.3
    tone = rng.random()
    a = rng.random() * math.pi
    ex, ey = math.cos(a), math.sin(a)
    for y in range(math.floor(cy - rad * 2), math.floor(cy + rad * 2) + 1):
        for x in range(math.floor(cx - rad * 2), math.floor(cx + rad * 2) + 1):
            dx, dy = x - cx, y - cy
            along = dx * ex + dy * ey
            across = -dx * ey + dy * ex
            d = math.hypot(along / 1.8, across) / rad
            if d >= 1: continue
            v = height * (1 - d * d)
            yy, xx = y % N, x % N
            if v > h[yy, xx]:
                h[yy, xx] = v; g[yy, xx] = tone
img = np.zeros((N, N, 4), dtype=np.uint8)
img[..., 0] = np.round(h * 255); img[..., 1] = np.round(g * 255); img[..., 3] = 255
Image.fromarray(img, 'RGBA').save(out)
print('wrote', out)
