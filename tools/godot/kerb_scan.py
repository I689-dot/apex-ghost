#!/usr/bin/env python3
"""Scans a circuit's collision for kerb steps: every 2 m along the lap, a cross-section at 0.2 m steps; reports where a
kerb's surface sits more than STEP above or below the road or ground beside it.
  python3 tools/godot/kerb_scan.py spa [collision.apxc] [from_m to_m]"""
import gzip, json, struct, sys
from collections import defaultdict
import numpy as np

STEP = 0.05
here = __file__.rsplit('/', 3)[0]
tid = sys.argv[1]
td = json.load(open(f'{here}/godot/data/tracks/{tid}.json' if tid != 'track' else f'{here}/godot/data/track.json'))
col = td['collision']
path = sys.argv[2] if len(sys.argv) > 2 else f"{here}/godot/{col['file'].split('?')[0]}"
s0, s1 = (float(sys.argv[3]), float(sys.argv[4])) if len(sys.argv) > 4 else (0, td['length'])
raw = open(path, 'rb').read()
raw = gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw
n = struct.unpack_from('<I', raw, 8)[0]
o = 12
T, S = [], []
for _ in range(n):
    si, nv, ni = struct.unpack_from('<III', raw, o); o += 12
    pos = np.frombuffer(raw, '<f4', nv * 3, o).reshape(-1, 3); o += nv * 12
    idx = np.frombuffer(raw, '<i4', ni, o).reshape(-1, 3); o += ni * 4
    if col['surfaces'][si] != 'wall':
        T.append(pos[idx]); S += [col['surfaces'][si]] * len(idx)
T = np.concatenate(T); S = np.array(S)
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
        if y > yref + 3: continue
        if best is None or y > best[0]: best = (y, S[k])
    return best

cl = np.array(td['centerline']).reshape(-1, 3); cum = np.array(td['cumS'])
bad = 0
last = -1e9
for i in range(len(cl) - 1):
    s = cum[i]
    if not s0 <= s <= s1 or s - last < 2: continue
    last = s
    t = cl[i + 1] - cl[i]; t /= np.linalg.norm(t); nx, nz = -t[2], t[0]
    prof = [(lat, top(cl[i, 0] + nx * lat, cl[i, 2] + nz * lat, cl[i, 1])) for lat in np.arange(-14, 14.01, 0.2)]
    worst = None
    for (l0, h0), (l1, h1) in zip(prof, prof[1:]):
        if not h0 or not h1 or 'curb' not in (h0[1], h1[1]) or h0[1] == h1[1] == 'curb' and abs(h1[0] - h0[0]) < STEP: continue
        if h0[1] != 'asphalt' and h1[1] != 'asphalt' and 'curb' in (h0[1], h1[1]) and h0[1] != h1[1]:
            # kerb to grass/gravel: only a kerb above the ground matters (a wheel drops off it)
            pass
        dh = h1[0] - h0[0]
        if abs(dh) > STEP and (worst is None or abs(dh) > abs(worst[0])):
            worst = (dh, l0, h0[1], h1[1])
    if worst:
        bad += 1
        print(f"s={s:.0f} step {worst[0] * 100:+.1f} cm at {worst[1]:+.1f} m ({worst[2]} -> {worst[3]})")
print(f"{bad} cross-sections with a kerb step over {STEP * 100:.0f} cm")
