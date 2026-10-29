"""
Lawn scan (photogrammetry, Grass.usdz) -> a top-down orthographic colour render of a clean part of the patch
(no lighting: the scan's own photo colours), for vegetation.mjs to make seamless.

  blender -b --factory-startup -P bake_lawn.py -- <Grass.usdz> <out.png> [size_px]
"""
import bpy, sys, math, mathutils

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = args[0], args[1]
PX = int(args[2]) if len(args) > 2 else 2048
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.usd_import(filepath=SRC, import_cameras=False, import_lights=False, import_materials=True)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
pts = [o.matrix_world @ mathutils.Vector(c) for o in meshes for c in o.bound_box]
mn = mathutils.Vector([min(p[i] for p in pts) for i in range(3)])
mx = mathutils.Vector([max(p[i] for p in pts) for i in range(3)])
# the patch is long in y; a square from its middle, inset from the edges (a brick edging runs along one side)
w = (mx.x - mn.x) * 0.62
cx = (mn.x + mx.x) / 2
cy = (mn.y + mx.y) / 2 - (mx.y - mn.y) * 0.12
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
bpy.context.scene.collection.objects.link(cam)
cam.data.type = 'ORTHO'
cam.data.ortho_scale = w
cam.data.clip_end = 10000
cam.location = (cx, cy, mx.z + 500)
cam.rotation_euler = (0, 0, 0)
sc = bpy.context.scene
sc.camera = cam
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'FLAT'
sc.display.shading.color_type = 'TEXTURE'
sc.view_settings.view_transform = 'Standard'
sc.render.resolution_x = sc.render.resolution_y = PX
sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('LAWN', OUT, 'square', round(w, 1), 'units at', round(cx, 1), round(cy, 1))
