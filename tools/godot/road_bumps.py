#!/usr/bin/env python3
"""Finds bumps in a circuit's driven surface: the top collision surface across the road (asphalt and kerbs) every metre
along the lap; flags where the height changes abruptly along the lap (second difference over 1 m above LIMIT), the
kind of step a source model's stray or stacked triangle makes.
  python3 tools/godot/road_bumps.py spa [collision.apxc]"""
import gzip, json, struct, sys
from collections import defaultdict
import numpy as np

LIMIT = 0.05
here = __file__.rsplit('/', 3)[0]
tid = sys.argv[1]
td = json.load(open(f'{here}/godot/data/tracks/{tid}.json' if tid != 'track' else f'{here}/godot/data/track.json'))
col = td['collision']
path = sys.argv[2] if len(sys.argv) > 2 else f"{here}/godot/{col['file'].split('?')[0]}"
raw = open(path, 'rb').read()
raw = gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw
n = struct.unpack_from('<I', raw, 8)[0]
o = 12
T = []
for _ in range(n):
    si, nv, ni = struct.unpack_from('<III', raw, o); o += 12
    pos = np.frombuffer(raw, '<f4', nv * 3, o).reshape(-1, 3); o += nv * 12
    idx = np.frombuffer(raw, '<i4', ni, o).reshape(-1, 3); o += ni * 4
    if col['surfaces'][si] in ('asphalt', 'curb'):
        T.append(pos[idx])
T = np.concatenate(T)
H = defaultdict(list)
mn = np.floor(T[:, :, [0, 2]].min(1) / 4).astype(int); mx = np.floor(T[:, :, [0, 2]].max(1) / 4).astype(int)
for k in range(len(T)):
    for gx in range(mn[k, 0], mx[k, 0] + 1):
        for gz in range(mn[k, 1], mx[k, 1] + 1):
            H[(gx, gz)].append(k)

def top(x, z, yref):
    best = None
    for k in H.get((int(x // 4), int(z // 4)), []):
        a, b, c = T[k]; v0 = c - a; v1 = b - a
        d00 = v0[0] ** 2 + v0[2] ** 2; d01 = v0[0] * v1[0] + v0[2] * v1[2]; d11 = v1[0] ** 2 + v1[2] ** 2
        px = x - a[0]; pz = z - a[2]; d20 = px * v0[0] + pz * v0[2]; d21 = px * v1[0] + pz * v1[2]
        den = d00 * d11 - d01 * d01
        if abs(den) < 1e-9: continue
        u = (d11 * d20 - d01 * d21) / den; v = (d00 * d21 - d01 * d20) / den
        if u < -1e-6 or v < -1e-6 or u + v > 1 + 1e-6: continue
        y = a[1] + u * v0[1] + v * v1[1]
        if abs(y - yref) > 2.5: continue
        if best is None or y > best: best = y
    return best

cl = np.array(td['centerline']).reshape(-1, 3); cum = np.array(td['cumS']); L = td['length']
wl = np.array(td['widthL']); wr = np.array(td['widthR'])
lats = np.arange(-7.0, 7.01, 0.5)
ss = np.arange(0, L - 1, 1.0)
grid = np.full((len(ss), len(lats)), np.nan)
for r, s in enumerate(ss):
    i = min(int(np.searchsorted(cum, s, 'right')) - 1, len(cl) - 2)
    u = (s - cum[i]) / (cum[i + 1] - cum[i]); p = cl[i] + (cl[i + 1] - cl[i]) * u
    t = cl[i + 1] - cl[i]; t /= np.linalg.norm(t); nx, nz = -t[2], t[0]
    for c, lat in enumerate(lats):
        h = top(p[0] + nx * lat, p[2] + nz * lat, p[1])
        if h is not None: grid[r, c] = h
d2 = np.abs(grid[2:] - 2 * grid[1:-1] + grid[:-2])
hits = []
for r, c in zip(*np.where(d2 > LIMIT)):
    hits.append((ss[r + 1], lats[c], d2[r, c]))
# group by 5 m
groups = defaultdict(list)
for s, lat, v in hits: groups[int(s // 5) * 5].append((lat, v))
for s in sorted(groups):
    g = groups[s]
    print(f"s={s:5d}  {len(g):3d} samples  worst {max(v for _, v in g) * 100:5.1f} cm  lat {min(l for l, _ in g):+.1f}..{max(l for l, _ in g):+.1f}")
print(len(groups), "stretches with a bump over", LIMIT * 100, "cm")
