"""Spa's forest species (godot/assets/vegetation/trees_spa.glb) from scanned / high-detail downloads, in the layout
scripts/game/forest.gd reads: nodes spruce_0, spruce_1, spruce_2 and maple (the broadleaf slot: a European beech here),
each 1 m tall with its base at the origin, and each again as "<node>_lod" at a far smaller budget (drawn past the
hero range, Forest.hero_range).

    ~/.local/opt/blender-4.2.3-linux-x64/blender -b --factory-startup -P tools/asset-pipeline/spa_godot/build_trees.py -- \
        <downloads/sketchfab dir> <out.glb> [tris per tree] [tris per tree, far model] [tris per tree, shadow model]

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
LOD_BUDGET = int(argv[3]) if len(argv) > 3 else 2600  # "<node>_lod": past the hero range (Forest.hero_range)
# "<node>_shadow": what the near trees cast their shadows with (Forest's shadow layer): a shadow needs the crown's mass,
# not its cards (with the far model as the caster, Ultra's shadow pass drew 25 M primitives)
SHADOW_BUDGET = int(argv[4]) if len(argv) > 4 else 1200
# node name -> Sketchfab uid (credits in downloads/sketchfab/credits.json)
SPECIES = {
    # conical crowns (crown width / height 0.29-0.39 measured on the models), the shape of the video's forest-edge
    # spruces; the tall PlantCatalog models (20/43, 30/43) are columnar (0.19-0.27) and read as cypresses when scaled
    "spruce_0": "8bbf8b718c58458dbc8d78d6c6694be6",  # PlantCatalog, Realistic HD Norway spruce (13/43), w/h 0.36
    "spruce_1": "03dfd6ca5d624753bbf2ef9f78371db3",  # PlantCatalog, Norway spruce (28/43), w/h 0.39
    "spruce_2": "dcc2eae5908d44e39eecc1e90bc54f0c",  # PlantCatalog, Norway spruce (10/43), w/h 0.29
    # the broadleaf slot: a full-crowned PlantCatalog oak (10.5 m, 203k tris) in place of the small beech (3.8 m, 6.6k
    # tris, sparse: scaled to the video's 20-25 m trackside trees it stood as a bare trunk); scanned in autumn colours,
    # its leaves recoloured to summer (RECOLOUR)
    "maple": "b7ed18f291c3445a8b805da379e3de4f",     # PlantCatalog, Realistic HD Northern red oak (37/138)
}
LEAF_FILL = {}  # leaf cards enlarged even where none are dropped (the old beech needed 1.7: its crown was sparse)
CARD_GROW = 3.5  # the most a kept leaf card is enlarged (a crown thinned to 5 % keeps its density with ~4.5x)
# the far model: its crown thinned to 1-3 % of the cards, which may grow further (capped at 3.5x it kept a sixth of the
# crown's cover and stood bare until the full model took over), and most of its budget on foliage
CARD_GROW_LOD = 8.0
LEAF_SHARE = {"": 0.72, "_lod": 0.85, "_shadow": 0.85}
FRAME = {}  # node -> (base, height) of its full model
# leaf textures brought to a summer green: node -> the green (linear, at the leaves' mean brightness) and how much of the
# original hue variation stays
RECOLOUR = {"maple": ((0.30, 0.42, 0.10), 0.25)}
LEAF = ("fol", "leaf", "leav", "needle", "card", "foliage", "twig")


def is_leaf_mat(m):
    """Foliage cards: a leaf-like name, and for "twig" a see-through material too (the oak's twigs are its branch wood,
    opaque: thinned and scaled as cards they fell apart into floating pieces)."""
    n = m.name.lower()
    if not any(k in n for k in LEAF):
        return False
    if "twig" in n and not any(k in n for k in LEAF if k != "twig"):
        return see_through(m)
    return True


def see_through(m):
    """Does the material cut or blend by alpha? (the glTF importer links the texture's alpha to the BSDF's Alpha for
    MASK / BLEND materials; blend_method no longer tells in Blender 4.2)"""
    if not m.use_nodes:
        return False
    for nd in m.node_tree.nodes:
        if nd.type == "BSDF_PRINCIPLED":
            a = nd.inputs.get("Alpha")
            return a is not None and (a.is_linked or a.default_value < 0.999)
    return False


def recolour(ob, green, keep):
    """The leaf textures' colour replaced by `green` at each texel's own brightness (the veins, light and shade stay),
    with `keep` of the original colour's deviation from grey mixed back for variety. Once per source image."""
    seen = set()
    for m in ob.data.materials:
        if not m or not is_leaf_mat(m) or not m.use_nodes:
            continue
        for nd in m.node_tree.nodes:
            if nd.type != "TEX_IMAGE" or nd.image is None or nd.image.name in seen:
                continue
            if not any(l.to_socket.name == "Base Color" for l in nd.outputs["Color"].links):
                continue
            img = nd.image
            seen.add(img.name)
            px = np.empty(len(img.pixels), dtype=np.float32)
            img.pixels.foreach_get(px)
            px = px.reshape(-1, 4)
            rgb = px[:, :3]
            lum = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
            solid = px[:, 3] > 0.2
            mean = float(lum[solid].mean()) if solid.any() else 0.3
            g = np.array(green, np.float32)
            g = g / (g @ np.array([0.2126, 0.7152, 0.0722], np.float32))
            dev = rgb - lum[:, None]
            rgb[:] = np.clip(lum[:, None] * g[None, :] + dev * keep, 0.0, 1.0)
            img.pixels.foreach_set(px.ravel())
            img.pack()
            log(f"  recoloured {img.name} (mean brightness {mean:.2f})")


def log(*a):
    print("[spa trees]", *a, flush=True)


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


bpy.ops.wm.read_factory_settings(use_empty=True)
done = []
for (node, uid), (suffix, budget) in [(sp, lv) for sp in SPECIES.items() for lv in (("", BUDGET), ("_lod", LOD_BUDGET), ("_shadow", SHADOW_BUDGET))]:
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
    if node in RECOLOUR:
        recolour(ob, *RECOLOUR[node])
    t0 = tris(ob)
    # split leaf and wood by material name
    leaf_idx = {i for i, m in enumerate(ob.data.materials) if m and is_leaf_mat(m)}
    me = ob.data
    nf = len(me.polygons)
    mi = np.empty(nf, dtype=np.int64)
    me.polygons.foreach_get("material_index", mi)
    is_leaf = np.isin(mi, list(leaf_idx))
    leaf_tris = int(sum(len(p.vertices) - 2 for p, l in zip(me.polygons, is_leaf) if l))
    wood_tris = t0 - leaf_tris
    # a broadleaf's branches carry its shape (the spruces' needles hide theirs): more of the budget to the wood
    leaf_budget = int(budget * LEAF_SHARE[suffix] * (0.8 if node == "maple" else 1.0))
    wood_budget = budget - leaf_budget
    keep = min(1.0, leaf_budget / max(leaf_tris, 1))
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    # leaf cards: connected components among leaf faces; keep a fraction, scale the kept ones up about their centre
    random.seed(7)
    seen = set()
    kill = []
    # (the far and shadow models keep 1-3 % of the cards: their floor lower, or the cap below was never reached)
    grow = 1.0 / max(keep, 0.01 if suffix else 0.05) ** 0.5 * LEAF_FILL.get(node, 1.0)
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
                v.co = c + (v.co - c) * min(grow, (CARD_GROW_LOD if suffix else CARD_GROW) * LEAF_FILL.get(node, 1.0))
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
        mod.ratio = max(0.004 if suffix else 0.02, wood_budget / wood_tris)
        log(f"  wood {wood_tris:,} tris, budget {wood_budget:,}, ratio {mod.ratio:.3f}")
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
    # the lighter versions in the full model's frame: their enlarged cards stand proud of the crown, and scaled by their
    # own height they came out up to a fifth smaller (the trees shrank where the forest blends one into the other)
    if suffix:
        base, h = FRAME[node]
    else:
        FRAME[node] = (base, h)
    co = (co - base) / h
    me.vertices.foreach_set("co", co.ravel())
    me.update()
    ob.name = node + suffix
    me.name = node + suffix
    done.append(ob)
    log(f"{node + suffix}: {t0:,} -> {tris(ob):,} tris (leaf keep {keep:.2f}, cards x{min(grow, (CARD_GROW_LOD if suffix else CARD_GROW) * LEAF_FILL.get(node, 1.0)):.2f}), {h:.1f} m tall")

bpy.ops.object.select_all(action="DESELECT")
for o in done:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT), export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
                          export_image_format="AUTO", export_cameras=False, export_lights=False, export_animations=False)
log("wrote", OUT)
