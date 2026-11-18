"""Fit a circuit's game frame onto real coordinates: the centreline (game x, z) against OpenStreetMap's raceway (lat/lon),
for the far terrain (build_far.py).
   python3 -I tools/asset-pipeline/far/geofit.py <track.json> <osm_raceway.json> <out.json> <lat0> <lon0> [skip regex]
<skip regex>: raceway names left out (pit lanes, other layouts); default "Kart|Pit|Moto".
Local metres around LAT0/LON0 (east, north); a rotation (and with FIT_SCALE=1 a scale) search then ICP (rotation +
translation, and scale with FIT_SCALE: a model not built at 1:1, e.g. Silverstone's source)."""
import sys, json, re, numpy as np
LAT0, LON0 = float(sys.argv[4]), float(sys.argv[5])
SKIP = re.compile(sys.argv[6] if len(sys.argv) > 6 else 'Kart|Pit|Moto')
R = 6378137.0
def en(lat, lon):
    return np.stack([np.radians(lon - LON0) * R * np.cos(np.radians(LAT0)), np.radians(lat - LAT0) * R], -1)
d = json.load(open(sys.argv[1])); cl = np.array(d['centerline'], float).reshape(-1, 3)[:, [0, 2]]
o = json.load(open(sys.argv[2]))
pts = []
for e in o['elements']:
    nm = e['tags'].get('name') or ''
    if SKIP.search(nm): continue
    g = np.array([[p['lat'], p['lon']] for p in e['geometry']])
    # densify to ~2 m
    for a, b in zip(g[:-1], g[1:]):
        A, B = en(*a), en(*b); n = max(1, int(np.linalg.norm(B - A) / 2))
        for t in np.linspace(0, 1, n, endpoint=False): pts.append(A + (B - A) * t)
P = np.array(pts); print('osm pts', len(P), 'centreline', len(cl))
def nn(Q):
    # brute force on a grid hash
    from collections import defaultdict
    return None
def chamfer(Q):
    # mean nearest distance Q -> P (P subsampled)
    Ps = P[::3]
    d2 = ((Q[:, None, :] - Ps[None, :, :]) ** 2).sum(-1)
    return np.sqrt(d2.min(1)), d2.argmin(1)
Q0 = cl[::8]
import os
FIT_SCALE = os.environ.get('FIT_SCALE') == '1'
best = None
for sc in (np.arange(0.6, 1.41, 0.05) if FIT_SCALE else [1.0]):
    for mirror in (1, -1):
        for deg in range(0, 360, 2):
            a = np.radians(deg); Rm = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
            q = sc * (Q0 * [1, mirror]) @ Rm.T; q = q - q.mean(0) + P.mean(0)
            e = chamfer(q)[0].mean()
            if best is None or e < best[0]: best = (e, mirror, deg, sc)
print('coarse', best)
_, mirror, deg, s_fit = best
a = np.radians(deg); Rm = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
Q = cl[::2] * [1, mirror]; t = P.mean(0) - s_fit * (Q0 * [1, mirror]).mean(0) @ Rm.T
for it in range(30):
    q = s_fit * Q @ Rm.T + t
    dist, idx = chamfer(q)
    keep = dist < np.percentile(dist, 90)
    A = Q[keep]; B = P[::3][idx[keep]]
    ma, mb = A.mean(0), B.mean(0); H = (A - ma).T @ (B - mb); U, S, Vt = np.linalg.svd(H); Rm = (U @ Vt).T
    if np.linalg.det(Rm) < 0: Vt[-1] *= -1; Rm = (U @ Vt).T
    if FIT_SCALE:
        s_fit = float(np.sum(((B - mb) @ Rm) * (A - ma)) / np.sum((A - ma) ** 2))
    t = mb - s_fit * ma @ Rm.T
q = s_fit * Q @ Rm.T + t; dist, _ = chamfer(q)
print('fit: scale', round(s_fit, 4), 'mirror', mirror, 'rot deg', np.degrees(np.arctan2(Rm[1, 0], Rm[0, 0])).round(3), 't', t.round(2), 'residual mean', dist.mean().round(2), 'p95', np.percentile(dist, 95).round(2), 'max', dist.max().round(1))
json.dump({'lat0': LAT0, 'lon0': LON0, 'mirror_z': mirror, 's': s_fit, 'R': Rm.tolist(), 't': t.tolist(), 'note': 'east,north = s * R @ (x, mirror*z) + t'}, open(sys.argv[3], 'w'))
