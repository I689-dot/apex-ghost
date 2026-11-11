"""Spectator sprites for the Godot app's crowd (Spa): scanned people rendered from the front and two sides of front,
evenly lit (the game shades the cards), on a transparent background.

   blender -b --factory-startup -P tools/asset-pipeline/spa_godot/render_people.py -- <out dir> <model.glb> [<model.glb> ...]

Each model -> <out dir>/<n>_<angle>.png (128 x 256 px showing 1.15 x 2.3 m: a figure scaled to 1.75 m, feet on the bottom
edge). SPLIT=1: a scene of several people (each its own mesh) gives one sprite per person at the scene's own scale,
skipping the meshes SKIP_RE matches (props), as <n>-<k>_<angle>.png. The sources (Sketchfab, CC-BY:
godot/assets_credits.md) stay outside the repo."""
import math
import os
import re
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
out, models = argv[0], argv[1:]
os.makedirs(out, exist_ok=True)
ANGLES = (0, 35, -35)
W, H = 128, 256
HEIGHT = 1.75
FRAME = 2.3
SPLIT = os.environ.get('SPLIT') == '1'
SKIP = re.compile(os.environ.get('SKIP_RE', '^$'))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE_NEXT'
    sc.render.resolution_x, sc.render.resolution_y = W * 2, H * 2
    sc.render.resolution_percentage = 50
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new('w')
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[1].default_value = 1.0
    sc.world = w
    return sc


for n, path in enumerate(models):
    sc = reset()
    bpy.ops.import_scene.gltf(filepath=path)
    sc.frame_set(1)
    meshes = [o for o in sc.objects if o.type == 'MESH']
    if not meshes:
        continue
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in meshes:
        e = o.evaluated_get(dg)
        m = e.to_mesh()
        pts += [e.matrix_world @ v.co for i, v in enumerate(m.vertices) if i % 7 == 0]
        e.to_mesh_clear()
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    k = 1.0 if SPLIT else HEIGHT / max(hi.z - lo.z, 1e-3)
    root = bpy.data.objects.new('root', None)
    sc.collection.objects.link(root)
    for o in sc.objects:
        if o.parent is None and o != root:
            o.parent = root
    root.scale = (k, k, k)
    bpy.context.view_layer.update()
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = FRAME
    sc.camera = cam
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 1.2
    sc.collection.objects.link(sun)
    people = [o for o in meshes if not SKIP.search(o.name)] if SPLIT else [None]
    for j, who in enumerate(people):
        if who is not None:
            for o in meshes:
                o.hide_render = o != who
            bb = [who.matrix_world @ Vector(c) for c in who.bound_box]
            ctr = Vector(((min(p.x for p in bb) + max(p.x for p in bb)) / 2, (min(p.y for p in bb) + max(p.y for p in bb)) / 2, min(p.z for p in bb)))
        else:
            ctr = Vector(((lo.x + hi.x) / 2 * k, (lo.y + hi.y) / 2 * k, lo.z * k))
        for a in ANGLES:
            # the glTF front (+Z) is Blender's -Y: the camera stands on -Y and looks at +Y, turned about the figure
            r = math.radians(a)
            d = 10.0
            cam.location = (ctr.x + math.sin(r) * d, ctr.y - math.cos(r) * d, ctr.z + FRAME / 2)
            cam.rotation_euler = (math.radians(90), 0, r)
            sun.rotation_euler = (math.radians(50), 0, r + math.radians(20))
            sc.render.filepath = os.path.join(out, f'{n}-{j}_{a}.png' if SPLIT else f'{n}_{a}.png')
            bpy.ops.render.render(write_still=True)
    print(f'[people] {n}: {os.path.basename(os.path.dirname(path))} scaled {k:.3f}, {len(people)} figure(s)')
