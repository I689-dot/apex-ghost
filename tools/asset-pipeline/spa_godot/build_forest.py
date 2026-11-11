"""Spa's scattered forest for the Godot app (assets/maps/spa_g/forest.bin + forest.json, the layout
tools/godot/pack-forest.mjs packs for scripts/game/forest.gd), from the render chunks build_render.py wrote.

    ~/.local/opt/blender-4.2.3-linux-x64/blender -b --factory-startup -P tools/asset-pipeline/spa_godot/build_forest.py -- \
        godot/assets/maps/spa_g [spacing m]
    node tools/godot/pack-forest.mjs godot/assets/maps/spa_g && node tools/asset-pipeline/spa_godot/layout.mjs

The source model has trees only as cards along the track and bare ground behind them (the hill after La Source, the
banks at Eau Rouge); the reference video shows the Ardennes spruce forest wherever the ground is not lawn, run-off or
buildings. Trees are planted on a jittered grid on open ground only (the first surface a vertical ray meets must be the
terrain, a bank, dirt or the outer lawns, with the same all round the trunk), away from the racing line, the walls, the
buildings and the card trees. Clearings and meadows come from a smooth noise field (the source's aerial photo was tried as
a forest map: at ~10 m a texel and placed by hand in the atlas it does not line up with the circuit). Writes a top-down
check image, forest_check.png, beside the output (git-ignored with the rest of spa_g).
"""
import bpy, json, math, re, sys
from pathlib import Path
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

argv = sys.argv[sys.argv.index("--") + 1:]
DIR = Path(argv[0])
SPACING = float(argv[1]) if len(argv) > 1 else 6.5
ROOT = Path(__file__).resolve().parents[3]
TRACK = json.loads((ROOT / "godot/data/tracks/spa.json").read_text())
R_MAX = 1600.0       # metres from the centreline (beyond: the far hills)
CLEAR_LINE = 24.0    # no tree closer to the centreline
CLEAR_BLOCK = 6.0    # nor to a wall, fence, building, kerb, road, gravel or card tree
TRUNK_RING = 3.5     # the ground this far around the trunk must be plantable too
MAX_SLOPE = 42.0     # degrees
CLEARING = 0.36      # noise below this is meadow (about a fifth of the ground)
BROADLEAF = 0.18     # share of broadleaf trees (the video: spruce stands with beech and birch at the edges)
# ground a tree may stand on (the first surface hit from above)
PLANT_RE = re.compile(r"^(top2|grass_spa_bank|grass_spa_ext|grass_spa_side|sand_spa_dirt|grass_spa$)", re.I)
# lawns kept open nearer the track: only planted this far out
LAWN_RE = re.compile(r"^grass_spa$", re.I)
LAWN_CLEAR = 45.0


def log(*a):
    print("[spa forest]", *a, flush=True)


def base_name(m):
    return re.sub(r"\.\d{3}$", "", m.name) if m else ""


bpy.ops.wm.read_factory_settings(use_empty=True)
for f in ("map_track.glb", "map_terrain.glb", "map_scenery.glb", "map_trees.glb"):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(DIR / f))
    for o in set(bpy.data.objects) - before:
        o["src"] = f

# every triangle in the game frame (Blender (x, y, z) = game (x, -z, y)), with its material and, for the terrain, its UVs
verts, tris, mats, kinds = [], [], [], []
names = []
name_id = {}
nv = 0
for o in bpy.data.objects:
    if o.type != "MESH":
        continue
    me = o.data
    me.calc_loop_triangles()
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    w = np.array(o.matrix_world)
    co = co @ w[:3, :3].T + w[:3, 3]
    g = np.stack([co[:, 0], co[:, 2], -co[:, 1]], 1)
    lt = me.loop_triangles
    n = len(lt)
    tv = np.empty(n * 3, dtype=np.int64)
    lt.foreach_get("vertices", tv)
    tv = tv.reshape(-1, 3)
    mi = np.empty(n, dtype=np.int64)
    lt.foreach_get("material_index", mi)
    ids = []
    for m in (list(me.materials) or [None]):
        nm = base_name(m)
        if nm not in name_id:
            name_id[nm] = len(names)
            names.append(nm)
        ids.append(name_id[nm])
    ids = np.array(ids, dtype=np.int64)
    kind = 2 if o["src"] == "map_trees.glb" else (1 if o["src"] == "map_scenery.glb" else 0)
    verts.append(g)
    tris.append(tv + nv)
    mats.append(ids[np.clip(mi, 0, len(ids) - 1)])
    kinds.append(np.full(n, kind))
    nv += len(g)
V = np.concatenate(verts)
F = np.concatenate(tris)
M = np.concatenate(mats)
K = np.concatenate(kinds)
log(f"{len(F):,} triangles, {len(names)} materials")

# ---- clearings: value noise (two octaves, 900 m and 260 m) over the ground; below the threshold is meadow
rng = np.random.default_rng(11)
_oct = [(900.0, rng.random((64, 64)), 0.65), (260.0, rng.random((160, 160)), 0.35)]


def noise(x, z):
    t = 0.0
    for size, g, w in _oct:
        u = x / size + 20.0
        v = z / size + 20.0
        i = np.floor(u).astype(int)
        j = np.floor(v).astype(int)
        fu = u - i
        fv = v - j
        fu = fu * fu * (3 - 2 * fu)
        fv = fv * fv * (3 - 2 * fv)
        n = g.shape[0]
        a = g[j % n, i % n]
        b = g[j % n, (i + 1) % n]
        c = g[(j + 1) % n, i % n]
        d = g[(j + 1) % n, (i + 1) % n]
        t = t + w * ((a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv)
    return t


def wood_at(x, z):
    return noise(x, z) > CLEARING


# ---- candidates: a jittered grid within R_MAX of the centreline
cl = np.array(TRACK["centerline"], dtype=np.float64).reshape(-1, 3)
kd_line = KDTree(len(cl))
for i, p in enumerate(cl):
    kd_line.insert((p[0], p[2], 0.0), i)
kd_line.balance()
lo = cl[:, [0, 2]].min(0) - R_MAX
hi = cl[:, [0, 2]].max(0) + R_MAX
gx, gz = np.meshgrid(np.arange(lo[0], hi[0], SPACING), np.arange(lo[1], hi[1], SPACING))
cx = gx.ravel() + rng.uniform(-0.45, 0.45, gx.size) * SPACING
cz = gz.ravel() + rng.uniform(-0.45, 0.45, gz.size) * SPACING
sel = wood_at(cx, cz)
cx, cz = cx[sel], cz[sel]
dline = np.array([kd_line.find((x, z, 0.0))[2] for x, z in zip(cx, cz)])
sel = (dline > CLEAR_LINE) & (dline < R_MAX)
cx, cz, dline = cx[sel], cz[sel], dline[sel]
log(f"{len(cx):,} candidates outside the clearings within {R_MAX:.0f} m")

# ---- open ground: BVH over everything; the first hit from above must be plantable, also around the trunk
bvh = BVHTree.FromPolygons([Vector(v) for v in V[:, [0, 2, 1]]], F.tolist(), all_triangles=True)
plant = np.array([bool(PLANT_RE.match(n)) for n in names])
lawn = np.array([bool(LAWN_RE.match(n)) for n in names])
ytop = float(V[:, 1].max()) + 50
down = Vector((0, 0, -1))
cosmax = math.cos(math.radians(MAX_SLOPE))
ring = [(TRUNK_RING * math.cos(a), TRUNK_RING * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 6, endpoint=False)]


def ground(x, z):
    loc, nor, idx, _ = bvh.ray_cast(Vector((x, z, ytop)), down)
    if idx is None:
        return None
    return loc, nor, idx


# blockers: the vertices and centroids of everything a tree must keep away from (not ground, not trees)
blk = (~plant[M]) & (K != 2)
bt = np.where(blk)[0]
bv = np.unique(F[blk])
bc = np.concatenate([V[F[bt]].mean(1), V[bv]])
# the triangle each blocker point came from (vertices: any triangle of the blocker set using it), for the probe
_first = np.full(len(V), -1)
_first[F[bt].ravel()] = np.repeat(bt, 3)
blk_src = np.concatenate([bt, _first[bv]])
kd_blk = KDTree(len(bc))
for i, p in enumerate(bc):
    kd_blk.insert((p[0], p[2], p[1]), i)
kd_blk.balance()
tc = np.unique(F[K == 2])
kd_tree = KDTree(len(tc))
for i, k in enumerate(tc):
    p = V[k]
    kd_tree.insert((p[0], p[2], 0.0), i)
kd_tree.balance()

import os
for q in filter(None, os.environ.get("FOREST_PROBE", "").split(";")):
    x, z = map(float, q.split(","))
    h = ground(x, z)
    if h is None:
        log(f"probe {x},{z}: no ground")
        continue
    loc, nor, idx = h
    log(f"probe {x},{z}: {names[M[idx]]} ({['track', 'scenery', 'trees'][K[idx]]}) y {loc.z:.1f} slope {math.degrees(math.acos(min(1, abs(nor.z)))):.0f}"
        f" line {kd_line.find((x, z, 0.0))[2]:.0f} m, blocker {kd_blk.find((x, z, loc.z))[2]:.1f} m ({names[M[blk_src[kd_blk.find((x, z, loc.z))[1]]]]}),"
        f" card {kd_tree.find((x, z, 0.0))[2]:.1f} m, noise {float(noise(np.array([x]), np.array([z]))[0]):.2f}")
out = []
rej = {"miss": 0, "surface": 0, "slope": 0, "lawn": 0, "ring": 0, "block": 0, "cards": 0}
for x, z, d in zip(cx, cz, dline):
    h = ground(x, z)
    if h is None:
        rej["miss"] += 1
        continue
    loc, nor, idx = h
    mid = M[idx]
    if not plant[mid] or K[idx] != 0:
        rej["surface"] += 1
        continue
    if abs(nor.z) < cosmax:  # (x, z, y) mirrors the winding: normals can point down
        rej["slope"] += 1
        continue
    if lawn[mid] and d < LAWN_CLEAR:
        rej["lawn"] += 1
        continue
    y = loc.z
    if kd_tree.find((x, z, 0.0))[2] < 4.0:
        rej["cards"] += 1
        continue
    if kd_blk.find((x, z, y))[2] < CLEAR_BLOCK:
        rej["block"] += 1
        continue
    ok = True
    for ox, oz in ring:
        r_ = ground(x + ox, z + oz)
        if r_ is None or not plant[M[r_[2]]] or K[r_[2]] != 0 or abs(r_[0].z - y) > TRUNK_RING * 1.2:
            ok = False
            break
    if not ok:
        rej["ring"] += 1
        continue
    out.append((x, y, z))
log(f"planted {len(out):,}; rejected {rej}")

# ---- forest.bin v2: 8 bytes a tree in 128 m cells (u16 x/5, u16 z/5 from the origin, i16 y*20, u8 scale*100, u8 type|yaw)
T = np.array(out)
CELL = 128.0
ox, oz = float(np.floor(T[:, 0].min())) - 1, float(np.floor(T[:, 2].min())) - 1
nx = int(math.ceil((T[:, 0].max() - ox + 1) / CELL))
nz = int(math.ceil((T[:, 2].max() - oz + 1) / CELL))
cid = np.floor((T[:, 2] - oz) / CELL).astype(int) * nx + np.floor((T[:, 0] - ox) / CELL).astype(int)
order = np.argsort(cid, kind="stable")
T, cid = T[order], cid[order]
n = len(T)
broad = rng.random(n) < BROADLEAF
# spruce 20-32 m, broadleaf 16-25 m (scale 1 = 25 m for both in pack-forest's bounds); taller in the forest's depth
d_edge = np.array([kd_line.find((x, z, 0.0))[2] for x, z in zip(T[:, 0], T[:, 2])])
depth = np.clip((d_edge - CLEAR_LINE) / 120.0, 0, 1)
h = np.where(broad, rng.uniform(16, 25, n), rng.uniform(20, 28, n) + 4 * depth)
scale = np.clip(np.round(h / 25.0 * 100), 1, 255).astype(np.uint8)
yaw = rng.integers(0, 128, n).astype(np.uint8)
rec = np.zeros(n, dtype=[("x", "<u2"), ("z", "<u2"), ("y", "<i2"), ("s", "u1"), ("t", "u1")])
rec["x"] = np.round((T[:, 0] - ox) * 5).astype(np.uint16)
rec["z"] = np.round((T[:, 2] - oz) * 5).astype(np.uint16)
rec["y"] = np.round(T[:, 1] * 20).astype(np.int16)
rec["s"] = scale
rec["t"] = (broad.astype(np.uint8) << 7) | yaw
(DIR / "forest.bin").write_bytes(rec.tobytes())
cells = []
u, first, cnt = np.unique(cid, return_index=True, return_counts=True)
for c, f0, k in zip(u, first, cnt):
    cells.append([int(c), int(f0), int(k)])
(DIR / "forest.json").write_text(json.dumps({"version": 2, "cell": CELL, "origin": [ox, oz], "nx": nx, "nz": nz, "count": n, "cells": cells}))
log(f"wrote {DIR / 'forest.bin'}: {n:,} trees ({broad.mean() * 100:.0f} % broadleaf), {len(cells)} cells, {nx}x{nz}")

# ---- check image: 4 m a pixel, north (-z) up; ground surfaces grey, buildings / walls dark, trees green, centreline red
PX = 4.0
w_ = int((hi[0] - lo[0]) / PX) + 1
h_ = int((hi[1] - lo[1]) / PX) + 1
pic = np.ones((h_, w_, 3), np.float32)
cen = V[F].mean(1)
kc = np.clip(((cen[:, 0] - lo[0]) / PX).astype(int), 0, w_ - 1), np.clip(((cen[:, 2] - lo[1]) / PX).astype(int), 0, h_ - 1)
pic[kc[1][plant[M]], kc[0][plant[M]]] = (0.85, 0.82, 0.7)
pic[kc[1][blk], kc[0][blk]] = (0.35, 0.35, 0.4)
tj = np.clip(((T[:, 0] - lo[0]) / PX).astype(int), 0, w_ - 1), np.clip(((T[:, 2] - lo[1]) / PX).astype(int), 0, h_ - 1)
pic[tj[1], tj[0]] = (0.1, 0.45, 0.15)
ci = np.clip(((cl[:, 0] - lo[0]) / PX).astype(int), 0, w_ - 1), np.clip(((cl[:, 2] - lo[1]) / PX).astype(int), 0, h_ - 1)
pic[ci[1], ci[0]] = (0.9, 0.1, 0.1)
img = bpy.data.images.new("forest_check", w_, h_)
img.pixels.foreach_set(np.concatenate([pic[::-1], np.ones((h_, w_, 1), np.float32)], -1).ravel())
img.filepath_raw = str(DIR / "forest_check.png")
img.file_format = "PNG"
img.save()
log("check image", DIR / "forest_check.png")
