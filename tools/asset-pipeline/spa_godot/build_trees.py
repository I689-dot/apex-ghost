"""Spa's forest species (godot/assets/vegetation/trees_spa.glb) from scanned / high-detail downloads, in the layout
scripts/game/forest.gd reads: nodes spruce_0, spruce_1, spruce_2 and maple (the broadleaf slot: a European beech here),
each 1 m tall with its base at the origin, and each again as "<node>_lod" at a far smaller budget (drawn past the
hero range, Forest.hero_range).

    ~/.local/opt/blender-4.2.3-linux-x64/blender -b --factory-startup -P tools/asset-pipeline/spa_godot/build_trees.py -- \
        <downloads/sketchfab dir> <out.glb> [tris per tree] [tris per tree, far model]

The downloads are 265k-2.3M triangles: far too many for a forest. Leaf cards are thinned, not collapsed (a collapse
destroys a card): whole cards are kept at random and the kept ones scaled up about their centre so the crown keeps its
density and silhouette; branches and bark are decimated.
"""
import bpy, bmesh, sys, random
from pathlib import Path
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = Path(argv[0]), Path(argv[1])
BUDGET = int(argv[2]) if len(argv) > 2 else 14000
LOD_BUDGET = int(argv[3]) if len(argv) > 3 else 1800  # "<node>_lod": past the hero range (Forest.hero_range)
# node name -> Sketchfab uid (credits in downloads/sketchfab/credits.json)
SPECIES = {
    # conical crowns (crown width / height 0.29-0.39 measured on the models), the shape of the video's forest-edge
    # spruces; the tall PlantCatalog models (20/43, 30/43) are columnar (0.19-0.27) and read as cypresses when scaled
    "spruce_0": "8bbf8b718c58458dbc8d78d6c6694be6",  # PlantCatalog, Realistic HD Norway spruce (13/43), w/h 0.36
    "spruce_1": "03dfd6ca5d624753bbf2ef9f78371db3",  # PlantCatalog, Norway spruce (28/43), w/h 0.39
    "spruce_2": "dcc2eae5908d44e39eecc1e90bc54f0c",  # PlantCatalog, Norway spruce (10/43), w/h 0.29
    "maple": "0983d8933531491f9be71c669e8a907b",     # evolveduk, Beech tree (6.6k tris; the 2.3M-tri Fagus sylvatica scan is for hero trees)
}
LEAF_FILL = {"maple": 1.7}  # leaf cards enlarged even where none are dropped: the beech's crown is sparse, the video's dense
CARD_GROW = 3.5  # the most a kept leaf card is enlarged (a crown thinned to 5 % keeps its density with ~4.5x)
LEAF = ("fol", "leaf", "leav", "needle", "card", "foliage", "twig")


def log(*a):
    print("[spa trees]", *a, flush=True)


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


bpy.ops.wm.read_factory_settings(use_empty=True)
done = []
for (node, uid), (suffix, budget) in [(sp, lv) for sp in SPECIES.items() for lv in (("", BUDGET), ("_lod", LOD_BUDGET))]:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(SRC / uid / "model.glb"))
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    # bake transforms, drop empties
    for o in meshes:
        o.data = o.data.copy()
        o.data.transform(o.matrix_world)
        o.parent = None
        o.matrix_world.identity()
    for o in new:
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    t0 = tris(ob)
    # split leaf and wood by material name
    leaf_idx = {i for i, m in enumerate(ob.data.materials) if m and any(k in m.name.lower() for k in LEAF)}
    me = ob.data
    nf = len(me.polygons)
    mi = np.empty(nf, dtype=np.int64)
    me.polygons.foreach_get("material_index", mi)
    is_leaf = np.isin(mi, list(leaf_idx))
    leaf_tris = int(sum(len(p.vertices) - 2 for p, l in zip(me.polygons, is_leaf) if l))
    wood_tris = t0 - leaf_tris
    leaf_budget = int(budget * 0.72)
    wood_budget = budget - leaf_budget
    keep = min(1.0, leaf_budget / max(leaf_tris, 1))
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    # leaf cards: connected components among leaf faces; keep a fraction, scale the kept ones up about their centre
    random.seed(7)
    seen = set()
    kill = []
    grow = 1.0 / max(keep, 0.05) ** 0.5 * LEAF_FILL.get(node, 1.0)
    for f in bm.faces:
        if not is_leaf[f.index] or f.index in seen:
            continue
        comp = []
        stack = [f]
        seen.add(f.index)
        while stack:
            g = stack.pop()
            comp.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if is_leaf[h.index] and h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        if random.random() > keep:
            kill.extend(comp)
        elif grow > 1.01:
            vs = {v for g in comp for v in g.verts}
            c = sum((v.co for v in vs), vs.__iter__().__next__().co * 0) / len(vs)
            for v in vs:
                v.co = c + (v.co - c) * min(grow, CARD_GROW * LEAF_FILL.get(node, 1.0))
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bm.to_mesh(me)
    bm.free()
    # wood: decimate (collapse) only the non-leaf faces, through a vertex group
    if wood_tris > wood_budget:
        vg = ob.vertex_groups.new(name="wood")
        mi = np.empty(len(me.polygons), dtype=np.int64)
        me.polygons.foreach_get("material_index", mi)
        wv = set()
        for p, m in zip(me.polygons, mi):
            if m not in leaf_idx:
                wv.update(p.vertices)
        vg.add(list(wv), 1.0, "REPLACE")
        mod = ob.modifiers.new("dec", "DECIMATE")
        mod.ratio = max(0.02, wood_budget / wood_tris)
        mod.vertex_group = "wood"
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_apply(modifier="dec")
    # 1 m tall, base at the origin (Blender Z up)
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    lo, hi = co.min(0), co.max(0)
    h = hi[2] - lo[2]
    base = np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]])
    co = (co - base) / h
    me.vertices.foreach_set("co", co.ravel())
    me.update()
    ob.name = node + suffix
    me.name = node + suffix
    done.append(ob)
    log(f"{node + suffix}: {t0:,} -> {tris(ob):,} tris (leaf keep {keep:.2f}, cards x{min(grow, CARD_GROW):.2f}), {h:.1f} m tall")

bpy.ops.object.select_all(action="DESELECT")
for o in done:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT), export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
                          export_image_format="AUTO", export_cameras=False, export_lights=False, export_animations=False)
log("wrote", OUT)
