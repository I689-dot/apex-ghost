"""Spa-Francorchamps render chunks for the Godot app, from the new source model (spa.glb + its full-size textures).

    ~/.local/opt/blender-4.2.3-linux-x64/blender -b --factory-startup -P tools/asset-pipeline/spa_godot/build_render.py -- \
        <spa.glb> <textures dir> <out dir>

Writes <out>/map_track.glb, map_scenery.glb, map_trees.glb, map_terrain.glb and chunks.json (as blender/convert_map.py
does for the web pipeline's maps), in the game's frame (config.json "toGameFrame", the same as the collision's).
Differences from the source:
 - one mesh per material, cut into 320 m chunks (the source is one mesh for the whole circuit);
 - materials renamed to the semantic names the game's shading keys on (config.json "renderNames");
 - the 256 px images the GLB embeds replaced by the full-size files of the download where there is one
   (asph 1024x4096, the grass detail, trees, the 8192 px bank, ...);
 - texture alpha connected (the export had lost every alpha mode; the game sets scissor or blend per material).
"""
import bpy, bmesh, json, re, sys
from pathlib import Path
import numpy as np
from mathutils import Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
GLB, TEX, OUT = Path(argv[0]), Path(argv[1]), Path(argv[2])
OUT.mkdir(parents=True, exist_ok=True)
# [<config>]: another circuit's (Silverstone: tools/asset-pipeline/silverstone/config.json, its "godot" key: toGameFrame,
# renderNames, and the name patterns below)
CFG = json.loads(Path(argv[3]).read_text())["godot"] if len(argv) > 3 else json.loads((Path(__file__).parent / "config.json").read_text())
CELL = 320.0
NAMES = CFG.get("renderNames", {})
# single trees (the forest plants models where they stand); the tree-line strips stay cards (a painted forest wall)
RE = CFG.get("renderRe", {})
TREE_RE = re.compile(RE.get("tree", r"^(trees_new_spa1|trees_new_spa2|bushes)"), re.I)
TERRAIN_RE = re.compile(RE.get("terrain", r"^top2"), re.I)
TRACK_RE = re.compile(RE.get("track", r"^(asph|curb|lines|grass|sand|gravel|grille|grail|galvanized|wall_|fence|astroturf|pavement|top2)"), re.I)
ALPHA_RE = re.compile(RE.get("alpha", r"^(trees_|bushes|fence|grille|transp|flag|hedge|asph_spa_g|lines)"), re.I)


def log(*a):
    print("[spa render]", *a, flush=True)


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(GLB))
# glTF (x, y, z) is Blender (x, -z, y); game = s * glTF + t, so in Blender: s * B + (t0, -t2, t1)
s = CFG["toGameFrame"]["s"]
t = CFG["toGameFrame"]["t"]
T = Matrix.Translation((t[0], -t[2], t[1])) @ Matrix.Scale(s, 4)
for o in list(bpy.data.objects):
    if o.type != "MESH":
        continue
    o.data.transform(T @ o.matrix_world)
    o.parent = None
    o.matrix_world = Matrix.Identity(4)
for o in list(bpy.data.objects):
    if o.type != "MESH":
        bpy.data.objects.remove(o, do_unlink=True)

# one object per material
src = [o for o in bpy.data.objects if o.type == "MESH"]
bpy.ops.object.select_all(action="DESELECT")
for o in src:
    o.select_set(True)
bpy.context.view_layer.objects.active = src[0]
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.separate(type="MATERIAL")
bpy.ops.object.mode_set(mode="OBJECT")
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
log("objects by material", len(meshes))

# semantic material names
renamed = 0
for m in bpy.data.materials:
    key = re.sub(r"\.\d{3}$", "", m.name)
    if key in NAMES:
        m.name = NAMES[key]
        renamed += 1
log("materials renamed", renamed, "of", len(bpy.data.materials))

# ground surfaces: normals from the geometry, smoothed up to 30 degrees. The source's custom normals don't follow the road (Raidillon's resurfaced
# asphalt, one material, lit as two bands of different brightness)
GROUND_RE = re.compile(r"^(asph|curb|lines|grass|gravel|sand|astroturf|pavement|grille|top2)", re.I)
fixed = 0
for o in meshes:
    m = o.data.materials[0].name if o.data.materials and o.data.materials[0] else ""
    if not GROUND_RE.match(m):
        continue
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    if o.data.has_custom_normals:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    # faces wound downwards (the resurfaced asphalt's are): flipped, so the geometry's normals point up
    bm = bmesh.new()
    bm.from_mesh(o.data)
    down = [f for f in bm.faces if f.normal.z < 0.0]
    if down:
        bmesh.ops.reverse_faces(bm, faces=down)
        bm.to_mesh(o.data)
    bm.free()
    # smooth only across gentle angles: a road vertex shared with a steep face (a kerb's back, a skirt) took its tilt, and
    # on Raidillon's long triangles the whole road leaned (lit as if the sun were low at every azimuth)
    o.data.shade_smooth()
    o.data.set_sharp_from_angle(angle=0.5236)
    if down:
        log(f"  {m}: {len(down)} faces flipped up")
    fixed += 1
log("ground normals from the geometry", fixed)

# full-size textures: the download's textures/ folder holds the big files under the image's own name
full = {p.name.lower(): p for p in TEX.iterdir() if p.suffix.lower() == ".png" and ".png_" not in p.name}
swapped = 0
for img in bpy.data.images:
    nm = (img.name if img.name.lower().endswith(".png") else img.name + ".png").lower()
    p = full.get(nm)
    if p is None:
        continue
    w0 = img.size[0]
    img.filepath = str(p)
    img.source = "FILE"
    img.reload()
    img.pack()
    if img.size[0] > w0:
        swapped += 1
        log(f"  {img.name}: {w0} -> {img.size[0]}x{img.size[1]}")
log("full-size textures", swapped)

# alpha: the base colour texture's alpha into the shader (the export lost it); the game picks scissor or blend
for m in bpy.data.materials:
    if not m.use_nodes or not ALPHA_RE.match(m.name):
        continue
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    tex = None
    if bsdf and bsdf.inputs["Base Color"].is_linked:
        tex = bsdf.inputs["Base Color"].links[0].from_node
        while tex and tex.type != "TEX_IMAGE" and tex.inputs and any(i.is_linked for i in tex.inputs):
            tex = next(i.links[0].from_node for i in tex.inputs if i.is_linked)
    if bsdf and tex is not None and tex.type == "TEX_IMAGE":
        nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])


# each material's mean base colour as it shows: the texture sampled at every face's UV centre, weighted by the face's area
# (linear RGB, times the factor). SpaLook tints a class of surfaces to one target albedo from these: the road's layers
# show from 0.06 to 0.4 of their textures' ranges (Assetto Corsa strips whose UVs use only part of the image), and tinted
# alike they read as bands
def srgb_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def base_image(m):
    bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if m.use_nodes else None
    if bsdf is None:
        return None, [1.0, 1.0, 1.0]
    f = list(bsdf.inputs["Base Color"].default_value)[:3]
    tex = None
    if bsdf.inputs["Base Color"].is_linked:
        tex = bsdf.inputs["Base Color"].links[0].from_node
        while tex and tex.type != "TEX_IMAGE" and tex.inputs and any(i.is_linked for i in tex.inputs):
            tex = next(i.links[0].from_node for i in tex.inputs if i.is_linked)
    return (tex.image if tex is not None and tex.type == "TEX_IMAGE" and tex.image and tex.image.size[0] > 0 else None), f


img_px = {}
means = {}
for o in meshes:
    me = o.data
    if not me.materials or me.materials[0] is None or not me.uv_layers:
        continue
    m = me.materials[0]
    img, f = base_image(m)
    if img is None:
        means[m.name] = [round(float(x), 5) for x in f]
        continue
    if img.name not in img_px:
        w, h = img.size
        px = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        img_px[img.name] = (px.reshape(h, w, 4)[..., :3], w, h)
    px, w, h = img_px[img.name]
    nl = len(me.loops)
    uv = np.empty(nl * 2, dtype=np.float32)
    me.uv_layers.active.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    nf = len(me.polygons)
    ls = np.empty(nf, dtype=np.int64); me.polygons.foreach_get("loop_start", ls)
    lt = np.empty(nf, dtype=np.int64); me.polygons.foreach_get("loop_total", lt)
    ar = np.empty(nf, dtype=np.float32); me.polygons.foreach_get("area", ar)
    sums = np.add.reduceat(uv, ls, axis=0) / lt[:, None]
    x = np.mod(sums[:, 0], 1.0) * (w - 1)
    y = np.mod(sums[:, 1], 1.0) * (h - 1)  # Blender's pixel rows start at the bottom, as UV v does
    c = srgb_lin(px[y.astype(int), x.astype(int)])
    if img.colorspace_settings.name != "sRGB":
        c = px[y.astype(int), x.astype(int)]
    mean = (c * ar[:, None]).sum(0) / max(ar.sum(), 1e-9)
    means[m.name] = [round(float(a * b), 5) for a, b in zip(mean, f)]
(OUT / "materials.json").write_text(json.dumps(means, indent=1))
log("material means (as shown)", len(means))


def kind_of(o) -> str:
    m = o.data.materials[0].name if o.data.materials and o.data.materials[0] else ""
    if TREE_RE.match(m):
        return "trees"
    if TERRAIN_RE.match(m):
        return "terrain"
    if TRACK_RE.match(m):
        return "track"
    return "scenery"


def delete_faces(o, mask):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in np.nonzero(mask)[0].tolist()], context="FACES")
    bm.to_mesh(o.data)
    bm.free()


chunks = {}
for o in list(meshes):
    if len(o.data.polygons) == 0:
        bpy.data.objects.remove(o, do_unlink=True)
        continue
    k = kind_of(o)
    if k == "terrain":
        chunks.setdefault((k, 0, 0), []).append(o)
        continue
    n = len(o.data.polygons)
    pc = np.empty(n * 3)
    o.data.polygons.foreach_get("center", pc)
    pc = pc.reshape(-1, 3)
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
    info.append({"name": name, "kind": k, "center": [float(c[0]), float(c[2]), float(-c[1])],
                 "radius": float(np.linalg.norm(co.max(0) - co.min(0)) / 2), "tris": sum(len(p.vertices) - 2 for p in ob.data.polygons)})
log("chunks", len(info))

for kind in ("track", "scenery", "trees", "terrain"):
    bpy.ops.object.select_all(action="DESELECT")
    sel = [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith(f"chunk_{kind}_")]
    if not sel:
        continue
    for o in sel:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT / f"map_{kind}.glb"), export_format="GLB", use_selection=True, export_yup=True,
                              export_apply=True, export_image_format="AUTO", export_cameras=False, export_lights=False, export_animations=False)
    log("exported", kind, len(sel), "chunks", sum(c["tris"] for c in info if c["kind"] == kind), "tris")
(OUT / "chunks.json").write_text(json.dumps(info, indent=1))
