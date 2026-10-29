"""
Pit crew models (the user's MODELS/ folder) → web GLBs for the pit lane (game/pitCrew.ts):
  - car_mechanic.usdz: a rigged mechanic (Ready Player Me skeleton, bones renamed n6…n86 by the export), posed by
    code in the game: kept skinned, its rest pose and bone names as they are;
  - Mechanic.usdz: a mechanic in white overalls (no skeleton), standing in the garages;
  - Mechanic_Tool_Cart.usdz: the tool trolley at each garage.
Each is stood upright (the largest extent is its height, or the trolley's), scaled to metres (people 1.80 m tall, the
trolley from its centimetres), set on the ground at the origin, its textures shrunk, and written as a GLB.

  blender -b --factory-startup -P convert_crew.py -- <in.usd[cz]> <out.glb> <kind: rig|static|prop> [maxTex=512]
"""
import bpy, sys, math, mathutils

argv = sys.argv[sys.argv.index('--') + 1:]
src, out, kind = argv[0], argv[1], argv[2]
max_tex = int(argv[3]) if len(argv) > 3 else 512

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.usd_import(filepath=src, import_cameras=False, import_lights=False, import_materials=True)


def world_bbox():
    lo = mathutils.Vector((1e9,) * 3)
    hi = mathutils.Vector((-1e9,) * 3)
    dg = bpy.context.evaluated_depsgraph_get()
    for o in bpy.data.objects:
        if o.type != 'MESH':
            continue
        e = o.evaluated_get(dg)
        for v in e.to_mesh().vertices:
            w = e.matrix_world @ v.co
            lo = mathutils.Vector(map(min, lo, w))
            hi = mathutils.Vector(map(max, hi, w))
        e.to_mesh_clear()
    return lo, hi


# one root over everything, so the whole model turns and scales together
root = bpy.data.objects.new('crew_root', None)
bpy.context.scene.collection.objects.link(root)
for o in list(bpy.data.objects):
    if o is not root and o.parent is None:
        o.parent = root

lo, hi = world_bbox()
size = hi - lo
# upright: the height must be Blender's Z. A person (or the trolley) is taller than it is deep.
axis = max(range(3), key=lambda i: size[i]) if kind != 'prop' else 2
if kind == 'prop' and size[1] > size[2] * 1.05:
    axis = 1
if axis == 1:
    root.rotation_euler = (math.pi / 2, 0, 0)
elif axis == 0:
    root.rotation_euler = (0, -math.pi / 2, 0)
bpy.context.view_layer.update()
lo, hi = world_bbox()
height = hi.z - lo.z
scale = 1.8 / height if kind != 'prop' else 0.01
root.scale = (scale, scale, scale)
bpy.context.view_layer.update()
lo, hi = world_bbox()
# standing on the ground at the origin
root.location = (-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z)
bpy.context.view_layer.update()

# facing: a person faces -Y in Blender (glTF +Z): the nose/eyes are the front. For the rig, the eye bones say where
# the face is; for the static figure the toes (the lowest, frontmost vertices) do.
def front_y():
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in bpy.data.objects:
        if o.type != 'MESH':
            continue
        e = o.evaluated_get(dg)
        for v in e.to_mesh().vertices:
            w = e.matrix_world @ v.co
            if w.z < 0.06:
                pts.append(w.y)
        e.to_mesh_clear()
    if not pts:
        return 0
    pts.sort()
    # feet stick out forwards: the side with the longer tail of the distribution
    return -1 if abs(pts[0]) > abs(pts[-1]) else 1


if kind != 'prop':
    # shoulders across X: a figure whose arms run along Y faces sideways
    lo, hi = world_bbox()
    if hi.y - lo.y > hi.x - lo.x:
        root.rotation_euler.rotate(mathutils.Euler((0, 0, math.pi / 2)))
        bpy.context.view_layer.update()
        lo, hi = world_bbox()
        root.location = (root.location.x - (lo.x + hi.x) / 2, root.location.y - (lo.y + hi.y) / 2, root.location.z)
        bpy.context.view_layer.update()
    f = front_y()
    if f > 0:
        # toes towards +Y: turn round so the figure faces -Y (glTF +Z after export)
        root.rotation_euler.rotate(mathutils.Euler((0, 0, math.pi)))
        bpy.context.view_layer.update()
lo, hi = world_bbox()
print(f'[crew] {kind}: {hi.x - lo.x:.2f} × {hi.y - lo.y:.2f} × {hi.z - lo.z:.2f} m (scale {scale:.5f}, up axis {axis})')

# smaller textures (seen from metres away)
for img in bpy.data.images:
    if img.size[0] > max_tex or img.size[1] > max_tex:
        k = max_tex / max(img.size[0], img.size[1])
        img.scale(max(4, int(img.size[0] * k)), max(4, int(img.size[1] * k)))

bpy.ops.export_scene.gltf(
    filepath=out,
    export_format='GLB',
    export_image_format='WEBP',
    export_skins=kind == 'rig',
    export_animations=False,
    export_apply=kind != 'rig',
    export_yup=True,
    export_extras=False,
)
