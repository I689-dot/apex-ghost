"""
Vegetation models (GRAPHICS-IMPROVEMENT/*.usdz) -> a small GLB for the game's forest.

  blender -b --factory-startup -P convert_vegetation.py -- <src dir> <out dir>

trees.glb
  spruce_0..2  the three conifers of Low_Poly_Trees_Free (Eifel spruce), base at the origin, 1 unit tall
  maple        Maple_tree without its ground disc: ~38 % of the leaf cards kept and enlarged (same crown, a third of
               the triangles: hundreds of them line the track), bark decimated; 1 unit tall
Each object is one mesh with one primitive per material (bark + leaves). The textures are fixed afterwards
(vegetation.mjs: leaf alpha, sizes, WebP).
"""
import bpy, bmesh, sys, os, math, random
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = args[0], args[1]
os.makedirs(OUT, exist_ok=True)
random.seed(7)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def load(name):
    bpy.ops.wm.usd_import(filepath=os.path.join(SRC, name), import_cameras=False, import_lights=False, import_materials=True)


def meshes():
    return [o for o in bpy.context.scene.objects if o.type == 'MESH']


def mat_names(o):
    return [s.material.name if s.material else '' for s in o.material_slots]


def join(objs, name):
    """Join objects (transforms applied) into one named mesh object."""
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    # bake parent transforms first
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    return o


def bounds(o):
    vs = [o.matrix_world @ v.co for v in o.data.vertices]
    mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    return mn, mx


def normalize(o, height=None, scale=None, pivot_xy=None):
    """Base centre to the origin; scale to `height` (or by `scale`)."""
    mn, mx = bounds(o)
    px, py = pivot_xy if pivot_xy else ((mn.x + mx.x) / 2, (mn.y + mx.y) / 2)
    s = scale if scale else height / (mx.z - mn.z)
    for v in o.data.vertices:
        v.co = Vector(((v.co.x - px) * s, (v.co.y - py) * s, (v.co.z - mn.z) * s))
    o.location = (0, 0, 0)
    o.data.update()


def decimate(o, target_tris):
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    if tris <= target_tris:
        return
    m = o.modifiers.new('dec', 'DECIMATE')
    m.ratio = target_tris / tris
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier='dec')


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def export(objs, path):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_materials='EXPORT',
        export_image_format='AUTO',
        export_normals=True,
        export_texcoords=True,
        export_tangents=False,
        export_animations=False,
    )
    print('EXPORT', path, [(o.name, tris(o)) for o in objs])


# ------------------------------------------------------------------ trees
trees = []

# spruces: three trees side by side, each a bark mesh and a leaf mesh under its own parent
reset()
load('Low_Poly_Trees_Free.usdz')
groups = {}
for o in meshes():
    root = o
    while root.parent:
        root = root.parent
    groups.setdefault(o.parent.name if o.parent else o.name, []).append(o)
spruce_objs = []
for k, (gname, objs) in enumerate(sorted(groups.items())):
    bark = [o for o in objs if 'Bark' in mat_names(o)]
    o = join(objs, f'spruce_{k}')
    # pivot on the trunk, not on the (lopsided) crown
    if bark:
        bmn, bmx = bounds(o)
    trunk = [o.matrix_world @ v.co for v in o.data.vertices]
    low = [v for v in trunk if v.z < min(t.z for t in trunk) + 3]
    cx = sum(v.x for v in low) / len(low)
    cy = sum(v.y for v in low) / len(low)
    normalize(o, height=1.0, pivot_xy=(cx, cy))
    spruce_objs.append(o)
# keep them while we import the maple into the same scene: move to a holding collection
hold = bpy.data.collections.new('hold')
bpy.context.scene.collection.children.link(hold)
for o in spruce_objs:
    for c in o.users_collection:
        c.objects.unlink(o)
    hold.objects.link(o)

load('Maple_tree.usdz')
leaf_objs, bark_objs, drop = [], [], []
for o in meshes():
    if o.users_collection and o.users_collection[0] == hold:
        continue
    names = mat_names(o)
    if any('leaf' in n for n in names):
        leaf_objs.append(o)
    elif any('bark' in n for n in names):
        bark_objs.append(o)
    else:
        drop.append(o)
print('MAPLE', len(leaf_objs), 'leaf objects', len(bark_objs), 'bark', len(drop), 'dropped', [mat_names(o) for o in drop][:4])
for o in drop:
    bpy.data.objects.remove(o, do_unlink=True)
leaves = join(leaf_objs, 'maple_leaves')
# thin the leaf cards: keep ~38 %, enlarged 1.5x about their centre (same crown fill, a third of the triangles)
bm = bmesh.new()
bm.from_mesh(leaves.data)
bm.faces.ensure_lookup_table()
seen = set()
kill = []
for f in bm.faces:
    if f.index in seen:
        continue
    island = []
    stack = [f]
    seen.add(f.index)
    while stack:
        g = stack.pop()
        island.append(g)
        for e in g.edges:
            for h in e.link_faces:
                if h.index not in seen:
                    seen.add(h.index)
                    stack.append(h)
    verts = {v for g in island for v in g.verts}
    if random.random() > 0.38:
        kill.extend(island)
        continue
    c = sum((v.co for v in verts), Vector()) / len(verts)
    for v in verts:
        v.co = c + (v.co - c) * 1.5
bmesh.ops.delete(bm, geom=list(set(kill)), context='FACES')
bm.to_mesh(leaves.data)
bm.free()
bark = join(bark_objs, 'maple_bark')
print('MAPLE bark tris', tris(bark))
decimate(bark, 900)
maple = join([bark, leaves], 'maple')
mn, mx = bounds(maple)
trunk = [maple.matrix_world @ v.co for v in maple.data.vertices]
low = [v for v in trunk if v.z < mn.z + 0.04 * (mx.z - mn.z)]
normalize(maple, height=1.0, pivot_xy=(sum(v.x for v in low) / len(low), sum(v.y for v in low) / len(low)))
trees = spruce_objs + [maple]
export(trees, os.path.join(OUT, 'trees.glb'))
