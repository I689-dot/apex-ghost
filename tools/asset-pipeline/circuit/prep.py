"""A circuit model (an Assetto Corsa conversion, RESOURCES/CIRCUIT-MODELS/<name>.zip, source/*.glb) made ready for the
map pipeline's track analysis (tools/asset-pipeline/track_analysis.py), driven by the circuit's config
(tools/asset-pipeline/circuit/<id>.json, key "prep"):

 - "rename": materials renamed to the prefixes the pipeline and the game key on (asph_, lines_, curb_, grass_, sand_,
   top2_, trees_, wall_, grail_, fence_, pavement_ ...);
 - "hide": materials whose faces are dropped (a painted sky backdrop: the game draws its own sky);
 - "split" (optional): one material's faces moved to another by where they sit on its texture atlas (u >= uMin:
   Silverstone's asphalt atlas holds the road strips and the run-off);
 - "synthLines" (optional): edge lines the source paints into a road texture made geometry: a 12 cm strip along every
   outer edge of that material's surface, 1 cm above it;
 - written as glTF (for the collision, the track limits and the render chunks) and as USD, one material a mesh, Y up
   (what the analysis reads).

   blender -b --factory-startup -P tools/asset-pipeline/circuit/prep.py -- <config.json> <source.glb> <out.usdc> <out.glb>

(Silverstone's own tools/asset-pipeline/silverstone/prep.py came first and does the same with its settings written in.)
"""
import bpy, bmesh, json, math, sys
from mathutils import Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
CFG = json.load(open(argv[0]))["prep"]
GLB, USD, OUT_GLB = argv[1], argv[2], argv[3]
TAG = "[prep %s]" % CFG.get("code", "?")
RENAME = CFG.get("rename", {})
HIDE = set(CFG.get("hide", []))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
mats = bpy.data.materials
renamed = 0
for m in list(mats):
    if m.name in RENAME:
        m.name = RENAME[m.name]
        renamed += 1
missing = [k for k in RENAME if k not in {m.name for m in mats} and RENAME[k] not in {m.name for m in mats}]
print(TAG, "renamed", renamed, "materials", ("(not in the model: %s)" % ", ".join(missing)) if missing else "", flush=True)

split = CFG.get("split")
lines_cfg = CFG.get("synthLines")
src_split = mats.get(split["material"]) if split else None
dst_split = None
if src_split is not None:
    dst_split = src_split.copy()
    dst_split.name = split["into"]
src_lines = mats.get(lines_cfg["material"]) if lines_cfg else None
lines_mat = None
if src_lines is not None:
    lines_mat = bpy.data.materials.new(lines_cfg["name"])
    lines_mat.diffuse_color = (0.9, 0.9, 0.9, 1.0)

line_verts, line_faces = [], []
n_hidden = 0
for ob in [o for o in bpy.context.scene.objects if o.type == "MESH"]:
    me = ob.data
    slots = {i: s.material for i, s in enumerate(ob.material_slots)}
    hide_slots = {i for i, m in slots.items() if m is not None and m.name in HIDE}
    slot_split = next((i for i, m in slots.items() if src_split is not None and m == src_split), None)
    slot_lines = next((i for i, m in slots.items() if src_lines is not None and m == src_lines), None)
    if not hide_slots and slot_split is None and slot_lines is None:
        continue
    slot_dst = None
    if slot_split is not None:
        ob.data.materials.append(dst_split)
        slot_dst = len(ob.material_slots) - 1
    bm = bmesh.new()
    bm.from_mesh(me)
    if hide_slots:
        dead = [f for f in bm.faces if f.material_index in hide_slots]
        n_hidden += len(dead)
        bmesh.ops.delete(bm, geom=dead, context="FACES")
    if slot_split is not None:
        uvl = bm.loops.layers.uv.active
        for f in bm.faces:
            if f.material_index == slot_split and sum(l[uvl].uv.x for l in f.loops) / len(f.loops) % 1.0 >= split["uMin"]:
                f.material_index = slot_dst
    if slot_lines is not None:
        mw = ob.matrix_world
        for e in bm.edges:
            rf = [f for f in e.link_faces if f.material_index == slot_lines]
            if len(rf) != 1:
                continue
            a, b = mw @ e.verts[0].co, mw @ e.verts[1].co
            d = b - a
            if d.length < 0.05:
                continue
            nrm = (mw.to_3x3() @ rf[0].normal).normalized()
            cen = mw @ rf[0].calc_center_median()
            side = d.cross(nrm).normalized()
            if side.dot(cen - a) < 0:
                side = -side
            up = nrm * 0.01
            q = [a + up, b + up, b + side * 0.12 + up, a + side * 0.12 + up]
            base = len(line_verts)
            line_verts += [tuple(v) for v in q]
            line_faces.append((base, base + 1, base + 2, base + 3))
    bm.to_mesh(me)
    bm.free()
if n_hidden:
    print(TAG, "hidden", n_hidden, "faces of", ", ".join(sorted(HIDE)), flush=True)
if line_faces:
    lm = bpy.data.meshes.new(lines_cfg["name"])
    lm.from_pydata(line_verts, [], line_faces)
    lm.materials.append(lines_mat)
    lo = bpy.data.objects.new(lines_cfg["name"], lm)
    bpy.context.scene.collection.objects.link(lo)
    print(TAG, "edge-line pieces", len(line_faces), flush=True)

bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", export_yup=True, export_apply=True, export_texcoords=True, export_normals=True, export_materials="EXPORT", export_image_format="AUTO")
print(TAG, "wrote", OUT_GLB, flush=True)
# one mesh per material (the analysis reads one material per mesh: the USD export keeps a mesh's materials as subsets of
# it), and back to the glTF frame (Y up, as the other maps' USD: the import turned it Z up)
bpy.ops.object.select_all(action="DESELECT")
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
for ob in meshes:
    ob.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.separate(type="MATERIAL")
bpy.ops.object.mode_set(mode="OBJECT")
to_gltf = Matrix.Rotation(-math.pi / 2, 4, "X")
n_obj = 0
for ob in [o for o in bpy.context.scene.objects if o.type == "MESH"]:
    ob.data.transform(to_gltf @ ob.matrix_world)
    ob.matrix_world = Matrix.Identity(4)
    used = {p.material_index for p in ob.data.polygons}
    if len(used) == 1 and ob.material_slots:
        m = ob.material_slots[next(iter(used))].material
        ob.data.materials.clear()
        ob.data.materials.append(m)
        for p in ob.data.polygons:
            p.material_index = 0
    n_obj += 1
print(TAG, n_obj, "meshes, one material each", flush=True)
bpy.ops.wm.usd_export(filepath=USD, export_materials=True, export_textures=False, selected_objects_only=False, export_uvmaps=True, export_normals=True)
print(TAG, "wrote", USD, flush=True)
