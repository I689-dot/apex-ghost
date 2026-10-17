"""
UI renders with Blender Cycles (real renders instead of CSS drawings):

  hero  <car.glb> <out.png>            studio shot of a car, front three-quarter, transparent background + shadow
  tyres <car.glb> <car.json> <outdir>  the car's front-left wheel side-on, once per compound (coloured sidewall band)

  blender -b --factory-startup -P render_ui.py -- hero  out/cars/x.glb hero.png
"""
import json
import math
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
MODE = argv[0]


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    scn.cycles.device = "CPU"
    scn.cycles.use_adaptive_sampling = True
    scn.cycles.use_denoising = True
    scn.render.film_transparent = True
    scn.render.image_settings.file_format = "PNG"
    scn.render.image_settings.color_mode = "RGBA"
    scn.view_settings.view_transform = "AgX"
    scn.view_settings.look = "AgX - Medium High Contrast"
    world = bpy.data.worlds.new("w")
    scn.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.03, 0.035, 0.045, 1)
    bg.inputs[1].default_value = 0.6
    return scn


def area(name, loc, size, energy, color=(1, 1, 1), target=(0, 0, 0.5)):
    d = bpy.data.lights.new(name, "AREA")
    d.size = size
    d.energy = energy
    d.color = color
    o = bpy.data.objects.new(name, d)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    direction = Vector(target) - Vector(loc)
    o.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return o


def camera(loc, target, lens):
    c = bpy.data.cameras.new("cam")
    c.lens = lens
    o = bpy.data.objects.new("cam", c)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = o
    return o


def import_car(path):
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in meshes:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    return meshes, lo, hi


if MODE == "hero":
    scn = reset()
    meshes, lo, hi = import_car(argv[1])
    length = hi.y - lo.y
    height = hi.z - lo.z
    # the glTF importer turns the car's +Z (forward) into Blender -Y; +X (left) stays +X
    floor = bpy.data.meshes.new("floor")
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, lo.z))
    plane = bpy.context.active_object
    plane.is_shadow_catcher = True
    target = (0, (lo.y + hi.y) / 2, lo.z + height * 0.42)
    camera((length * 0.62, lo.y - length * 1.02, lo.z + 1.05), target, 44)
    area("key", (1.5, -2.0, 6.5), 6, 1400, target=target)
    area("rim", (-4.5, 4.0, 2.5), 4, 900, color=(0.85, 0.9, 1.0), target=target)
    area("fill", (5.0, -4.0, 1.2), 3, 220, color=(1.0, 0.93, 0.86), target=target)
    import os

    scale = float(os.environ.get("PREVIEW_SCALE", "1"))
    scn.render.resolution_x = int(1280 * scale)
    scn.render.resolution_y = int(720 * scale)
    scn.cycles.samples = 32 if scale >= 1 else 16
    scn.render.filepath = argv[2]
    bpy.ops.render.render(write_still=True)

elif MODE == "tyres":
    scn = reset()
    bpy.ops.import_scene.gltf(filepath=argv[1])
    meta = json.load(open(argv[2]))
    hub = bpy.data.objects.get("wheel_FL")
    keep = set()
    if hub:
        keep = {hub} | set(hub.children_recursive)
    for o in list(bpy.context.scene.objects):
        if o not in keep and o.type == "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    r = meta["wheels"]["FL"]["radius"]
    w = meta["wheels"]["FL"]["width"]
    c = hub.matrix_world.translation.copy() if hub else Vector((0, 0, r))
    # outer sidewall of a left wheel faces +X
    camera((c.x + 3.2, c.y, c.z), (c.x, c.y, c.z), 70)
    scn.camera.data.type = "ORTHO"
    scn.camera.data.ortho_scale = r * 2.25
    area("key", (c.x + 3, c.y - 2.5, c.z + 3), 3, 400, target=c)
    area("fill", (c.x + 3, c.y + 2.5, c.z), 2, 120, target=c)
    scn.render.resolution_x = 384
    scn.render.resolution_y = 384
    scn.cycles.samples = 48
    colours = {"soft": (0.95, 0.08, 0.08), "medium": (1.0, 0.82, 0.0), "hard": (0.95, 0.95, 0.95), "wet": (0.05, 0.35, 1.0)}
    ring = None
    for name, col in colours.items():
        if ring:
            bpy.data.objects.remove(ring, do_unlink=True)
        # Pirelli-style band on the sidewall
        bpy.ops.mesh.primitive_torus_add(
            major_radius=r * 0.82, minor_radius=r * 0.035, location=(c.x + w * 0.5 + 0.004, c.y, c.z), rotation=(0, math.pi / 2, 0)
        )
        ring = bpy.context.active_object
        ring.scale = (1, 1, 0.25)
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        p = mat.node_tree.nodes["Principled BSDF"]
        p.inputs["Base Color"].default_value = (*col, 1)
        p.inputs["Roughness"].default_value = 0.45
        ring.data.materials.append(mat)
        scn.render.filepath = f"{argv[3]}/tyre_{name}.png"
        bpy.ops.render.render(write_still=True)
