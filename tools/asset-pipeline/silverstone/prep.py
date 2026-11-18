"""Silverstone (RESOURCES/CIRCUIT-MODELS/silverstone-circuit-2024-layout.zip, source/silverstone.glb, an Assetto Corsa
conversion like Spa's) made ready for the map pipeline's track analysis (tools/asset-pipeline/track_analysis.py):

 - materials renamed to the prefixes the pipeline and the game key on (RENAME below);
 - the asphalt split by where its triangles sit on the 4096 px atlas: the left two thirds are the two road strips (the
   white edge lines painted along their sides), the right third run-off, pit and paint (asph_ss_road / asph_ss_runoff);
 - the edge lines, which the source paints into the road strips' texture, made geometry (lines_ss): a 12 cm strip
   along every outer edge of the road strips' surface (their mesh boundary), 1 cm above it, which is where the paint is;
 - written as USD (the analysis reads USD).

   blender -b --factory-startup -P tools/asset-pipeline/silverstone/prep.py -- <silverstone.glb> <out.usdc> [<out.glb>]

<out.glb>: the same prepared model as glTF (renamed, split, the edge lines), for the collision (spa_godot/collision.mjs
--config silverstone/config.json), the track limits and the render chunks (spa_godot/build_render.py).
"""
import bpy, bmesh, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
GLB, OUT = argv[0], argv[1]
RENAME = {
    "asphalt.001": "asph_ss_road",  # split below
    "asph_pitlane.001": "asph_ss_pit",
    "groove.001": "asph_ss_g1", "groove2.001": "asph_ss_g2", "groove3.001": "asph_ss_g3",
    "curb.001": "curb_ss", "Curb_new.001": "curb_ss_new",
    "grass.001": "grass_ss", "grass_NM.001": "grass_ss_nm",
    "sand_new.001": "sand_ss", "sand-bordini.001": "sand_ss_border",
    "top2.001": "top2_ss", "top2_NM.001": "top2_ss_nm", "top2_refl.001": "top2_ss_refl",
    "trees.001": "trees_ss",
    "tyreswall.001": "wall_ss_tyres", "tyreswall.002": "wall_ss_tyres2",
    "walls2.001": "wall_ss", "jersey.001": "wall_ss_jersey", "jersey.003": "wall_ss_jersey2",
    "barriers1.001": "grail_ss", "barriers1.003": "grail_ss2",
    "fences1.001": "fence_ss", "fences1.003": "fence_ss2", "serraglio.001": "fence_ss_pen",
    "tile1.001": "pavement_ss", "tile1B.001": "pavement_ss_b", "stone.001": "pavement_ss_stone",
}
ROAD_U = 0.667

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
mats = bpy.data.materials
runoff = None
lines = None
for m in list(mats):
    if m.name in RENAME:
        m.name = RENAME[m.name]
road = mats.get("asph_ss_road")
if road is not None:
    runoff = road.copy()
    runoff.name = "asph_ss_runoff"
    lines = bpy.data.materials.new("lines_ss")
    lines.diffuse_color = (0.9, 0.9, 0.9, 1.0)

line_verts, line_faces = [], []
for ob in [o for o in bpy.context.scene.objects if o.type == "MESH"]:
    me = ob.data
    slot_road = next((i for i, s in enumerate(ob.material_slots) if s.material == road), None)
    if slot_road is None:
        continue
    ob.data.materials.append(runoff)
    slot_run = len(ob.material_slots) - 1
    bm = bmesh.new()
    bm.from_mesh(me)
    uvl = bm.loops.layers.uv.active
    n_road = n_run = 0
    for f in bm.faces:
        if f.material_index != slot_road:
            continue
        cu = sum(l[uvl].uv.x for l in f.loops) / len(f.loops) % 1.0
        if cu >= ROAD_U:
            f.material_index = slot_run
            n_run += 1
        else:
            n_road += 1
    # the road strips' outer edges: an edge with one road-strip face (the other side is run-off, grass or nothing)
    mw = ob.matrix_world
    n_line = 0
    for e in bm.edges:
        rf = [f for f in e.link_faces if f.material_index == slot_road]
        if len(rf) != 1:
            continue
        a, b = mw @ e.verts[0].co, mw @ e.verts[1].co
        d = b - a
        if d.length < 0.05:
            continue
        nrm = (mw.to_3x3() @ rf[0].normal).normalized()
        # inwards: towards the face's centre
        cen = mw @ rf[0].calc_center_median()
        side = d.cross(nrm).normalized()
        if side.dot(cen - a) < 0:
            side = -side
        up = nrm * 0.01
        q = [a + up, b + up, b + side * 0.12 + up, a + side * 0.12 + up]
        base = len(line_verts)
        line_verts += [tuple(v) for v in q]
        line_faces.append((base, base + 1, base + 2, base + 3))
        n_line += 1
    bm.to_mesh(me)
    bm.free()
    print(f"[ss prep] {ob.name}: road {n_road}, run-off {n_run}, edge-line pieces {n_line}", flush=True)

if line_faces:
    lm = bpy.data.meshes.new("lines_ss")
    lm.from_pydata(line_verts, [], line_faces)
    lm.materials.append(lines)
    lo = bpy.data.objects.new("lines_ss", lm)
    bpy.context.scene.collection.objects.link(lo)
if len(argv) > 2:
    bpy.ops.export_scene.gltf(filepath=argv[2], export_format="GLB", export_yup=True, export_apply=True, export_texcoords=True, export_normals=True, export_materials="EXPORT", export_image_format="AUTO")
    print("[ss prep] wrote", argv[2], flush=True)
# one mesh per material (the analysis reads one material per mesh: the USD export keeps a mesh's materials as subsets of
# it), and back to the glTF frame (Y up, as the other maps' USD: the import turned it Z up)
import math
from mathutils import Matrix
bpy.ops.object.select_all(action="DESELECT")
for ob in [o for o in bpy.context.scene.objects if o.type == "MESH"]:
    ob.select_set(True)
bpy.context.view_layer.objects.active = next(o for o in bpy.context.scene.objects if o.type == "MESH")
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.separate(type="MATERIAL")
bpy.ops.object.mode_set(mode="OBJECT")
to_gltf = Matrix.Rotation(-math.pi / 2, 4, "X")
n_obj = 0
for ob in [o for o in bpy.context.scene.objects if o.type == "MESH"]:
    ob.data.transform(to_gltf @ ob.matrix_world)
    ob.matrix_world = Matrix.Identity(4)
    # a single material each now: the name the analysis reads
    used = {p.material_index for p in ob.data.polygons}
    if len(used) == 1 and ob.material_slots:
        m = ob.material_slots[next(iter(used))].material
        ob.data.materials.clear()
        ob.data.materials.append(m)
        for p in ob.data.polygons:
            p.material_index = 0
    n_obj += 1
print(f"[ss prep] {n_obj} meshes, one material each", flush=True)
bpy.ops.wm.usd_export(filepath=OUT, export_materials=True, export_textures=False, selected_objects_only=False, export_uvmaps=True, export_normals=True)
print("[ss prep] wrote", OUT, flush=True)
