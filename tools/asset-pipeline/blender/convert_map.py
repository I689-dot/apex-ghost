"""Blender headless map converter.

blender -b --factory-startup -P convert_map.py -- <in.usdc> <out_dir> [<map config json>]

Needs <out_dir>/analysis.json and track_base.json from track_analysis.py (scale/offset/centreline).
Writes <out_dir>/map_track.glb, map_trees.glb, map_terrain.glb and chunks.json.
Each chunk is a separate node so three.js can frustum- and distance-cull it.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix

argv = sys.argv[sys.argv.index("--") + 1 :]
IN_USD, OUT = argv[0], Path(argv[1])
CFG = (json.loads(Path(argv[2]).read_text()).get("analysis") or {}) if len(argv) > 2 else {}
an = json.loads((OUT / "analysis.json").read_text())
base = json.loads((OUT / "track_base.json").read_text())
S = an["scale"]
off = an["offset"]
CELL = 320.0  # chunk size in metres
TREE_KEEP_NEAR = 140.0  # every tree within this distance of the centreline is kept
TREE_KEEP_FAR = 420.0  # beyond this distance trees are dropped
TREE_FAR_FRACTION = 0.45  # fraction of trees kept between NEAR and FAR

TREE_RE = re.compile(r"^(tree|pines|trees_new)", re.I)
TERRAIN_RE = re.compile(r"^top2", re.I)
TRACK_RE = re.compile(r"^(asph|curb|lines|redline|grass|sand|gravel|travert|conc_|pits|tyrewall|grail|galvanized|walls_new|wall_|fence|astroturf|box_decal|pavement|tiles)", re.I)


def log(*a):
    print("[map]", *a, flush=True)


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.usd_import(filepath=IN_USD, import_cameras=False, import_lights=False, import_materials=True)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
# generic source material names → the semantic names the pipeline and the client key on (same table as the analysis)
RENAME = CFG.get("materials", {})
if RENAME:
    renamed = 0
    for mat in list(bpy.data.materials):
        base_name = re.sub(r"\.\d{3}$", "", mat.name)
        if base_name in RENAME:
            mat.name = RENAME[base_name]
            renamed += 1
    log("materials renamed", renamed)

# USD (Y-up) is imported as Blender (x, -z, y). Game metres: g = (u + off) * S, and the glTF exporter maps
# Blender (X, Y, Z) → glTF (X, Z, -Y). So the Blender target is (gx, -gz, gy).
T = Matrix.Translation((off[0] * S, -off[2] * S, off[1] * S)) @ Matrix.Scale(S, 4)
for o in meshes:
    if o.data.users > 1:
        o.data = o.data.copy()
    o.data.transform(T @ o.matrix_world)
    o.parent = None
    o.matrix_world = Matrix.Identity(4)
for o in list(bpy.data.objects):
    if o.type != "MESH":
        bpy.data.objects.remove(o, do_unlink=True)
log("imported", len(meshes), "meshes")

cl = np.array(base["centerline"]).reshape(-1, 3)
cl2 = np.stack([cl[:, 0], -cl[:, 2]], axis=1)  # Blender XY of the centreline


def dist_to_centerline(xy: np.ndarray) -> np.ndarray:
    out = np.empty(len(xy))
    for i in range(0, len(xy), 2048):
        blk = xy[i : i + 2048]
        d = ((blk[:, None, :] - cl2[None, :, :]) ** 2).sum(-1).min(1)
        out[i : i + 2048] = np.sqrt(d)
    return out


def kind_of(o) -> str:
    mats = [m.name for m in o.data.materials if m]
    m = mats[0] if mats else ""
    if TREE_RE.match(m):
        return "trees"
    if TERRAIN_RE.match(m):
        return "terrain"
    if TRACK_RE.match(m):
        return "track"
    return "scenery"


def poly_arrays(me):
    n = len(me.polygons)
    c = np.empty(n * 3)
    me.polygons.foreach_get("center", c)
    return c.reshape(-1, 3)


def delete_faces(o, mask: np.ndarray) -> None:
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.faces.ensure_lookup_table()
    kill = [bm.faces[i] for i in np.nonzero(mask)[0].tolist()]
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bm.to_mesh(o.data)
    bm.free()


# ---------------------------------------------------------------- trees ---
rng = np.random.default_rng(7)
tree_before = tree_after = 0
for o in meshes:
    if kind_of(o) != "trees":
        continue
    me = o.data
    nv = len(me.vertices)
    ne = len(me.edges)
    ev = np.empty(ne * 2, dtype=np.int64)
    me.edges.foreach_get("vertices", ev)
    ev = ev.reshape(-1, 2)
    par = np.arange(nv)

    def find(a):
        r = a
        while par[r] != r:
            r = par[r]
        while par[a] != r:
            par[a], a = r, par[a]
        return r

    for a, b in ev.tolist():
        ra, rb = find(a), find(b)
        if ra != rb:
            par[ra] = rb
    lab = np.array([find(i) for i in range(nv)])
    co = np.empty(nv * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    uniq, inv = np.unique(lab, return_inverse=True)
    cx = np.bincount(inv, co[:, 0]) / np.bincount(inv)
    cy = np.bincount(inv, co[:, 1]) / np.bincount(inv)
    d = dist_to_centerline(np.stack([cx, cy], axis=1))
    keep_comp = (d < TREE_KEEP_NEAR) | ((d < TREE_KEEP_FAR) & (rng.random(len(d)) < TREE_FAR_FRACTION))
    ls = np.empty(len(me.polygons), dtype=np.int64)
    me.polygons.foreach_get("loop_start", ls)
    lv = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get("vertex_index", lv)
    face_comp = inv[lv[ls]]
    tree_before += len(me.polygons)
    delete_faces(o, ~keep_comp[face_comp])
    tree_after += len(o.data.polygons)
log("trees", tree_before, "->", tree_after, "faces")

# ------------------------------------------------------------- chunking ---
chunks: dict[tuple[str, int, int], list] = {}
for o in list(meshes):
    if len(o.data.polygons) == 0:
        bpy.data.objects.remove(o, do_unlink=True)
        continue
    k = kind_of(o)
    if k == "terrain":
        chunks.setdefault((k, 0, 0), []).append(o)
        continue
    pc = poly_arrays(o.data)
    ci = np.floor(pc[:, 0] / CELL).astype(int)
    cj = np.floor(pc[:, 1] / CELL).astype(int)
    keys = sorted(set(zip(ci.tolist(), cj.tolist())))
    if len(keys) == 1:
        chunks.setdefault((k, keys[0][0], keys[0][1]), []).append(o)
        continue
    for i, j in keys:
        dup = o.copy()
        dup.data = o.data.copy()
        bpy.context.scene.collection.objects.link(dup)
        delete_faces(dup, ~((ci == i) & (cj == j)))
        chunks.setdefault((k, i, j), []).append(dup)
    bpy.data.objects.remove(o, do_unlink=True)

info = []
for (k, i, j), objs in chunks.items():
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    name = f"chunk_{k}_{i}_{j}".replace("-", "m")
    ob.name = name
    ob.data.name = name
    co = np.empty(len(ob.data.vertices) * 3)
    ob.data.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    c = (co.min(0) + co.max(0)) / 2
    rad = float(np.linalg.norm(co.max(0) - co.min(0)) / 2)
    info.append({"name": name, "kind": k, "center": [float(c[0]), float(c[2]), float(-c[1])], "radius": rad,
                 "tris": sum(len(p.vertices) - 2 for p in ob.data.polygons)})
log("chunks", len(info))

# ---------------------------------------------------------------- export ---
for kind in ("track", "scenery", "trees", "terrain"):
    bpy.ops.object.select_all(action="DESELECT")
    sel = [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith(f"chunk_{kind}_")]
    if not sel:
        continue
    for o in sel:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(OUT / f"map_{kind}.glb"),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_image_format="AUTO",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
    )
    log("exported", kind, len(sel), "chunks", sum(c["tris"] for c in info if c["kind"] == kind), "tris")
(OUT / "chunks.json").write_text(json.dumps(info, indent=1))
