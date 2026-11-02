#!/usr/bin/env python3
"""Procedural detail tiles for the ground (ports of pavedDetail / gravelDetail in game/track.ts) as PNGs:
paved_detail.png (binder noise + light stones + dark pores) and gravel_detail.png (a pebble tile)."""
import math, os, random
from PIL import Image

out = os.path.join(os.path.dirname(__file__), '..', '..', 'godot', 'assets_static', 'ground')
os.makedirs(out, exist_ok=True)
N = 256

def lattice(rnd, f):
    g = [[rnd() for _ in range(f + 1)] for _ in range(f + 1)]
    for i in range(f + 1):
        g[i][f] = g[i][0]
        g[f][i] = g[0][i]
    def at(a, b):
        return g[b % (f + 1)][a % (f + 1)]
    def v(x, y):
        fx = x / N * f; fy = y / N * f
        ix = int(fx); iy = int(fy)
        tx = fx - ix; ty = fy - iy
        sx = tx * tx * (3 - 2 * tx); sy = ty * ty * (3 - 2 * ty)
        return (at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx) * (1 - sy) + (at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx) * sy
    return v

rng = random.Random(1234567)
o1, o2, o3 = lattice(rng.random, 8), lattice(rng.random, 32), lattice(rng.random, 128)
img = Image.new('L', (N, N))
px = img.load()
for y in range(N):
    for x in range(N):
        v = 0.45 * o1(x, y) + 0.3 * o2(x, y) + 0.25 * o3(x, y)
        r = rng.random()
        if r < 0.035: v += 0.35
        elif r < 0.07: v -= 0.3
        px[x, y] = max(0, min(255, round(v * 255)))
img.save(os.path.join(out, 'paved_detail.png'))

rng = random.Random(8675309)
v = [0.36] * (N * N)
for _ in range(1400):
    cx = rng.random() * N; cy = rng.random() * N
    rad = 2.5 + rng.random() * 6
    tone = 0.45 + rng.random() * 0.4
    for y in range(math.floor(cy - rad - 1), math.floor(cy + rad + 1) + 1):
        for x in range(math.floor(cx - rad - 1), math.floor(cx + rad + 1) + 1):
            dd = math.hypot(x - cx, (y - cy) * 1.25) / rad
            i = (y % N) * N + (x % N)
            if dd < 1: v[i] = max(v[i], tone + 0.18 * (1 - dd) - 0.12 * ((y - cy) / rad))
            elif dd < 1.25: v[i] = min(v[i], 0.22)
img = Image.new('L', (N, N))
img.putdata([max(0, min(255, round(c * 255))) for c in v])
img.save(os.path.join(out, 'gravel_detail.png'))
print('ground textures written to', out)
