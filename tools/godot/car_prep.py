"""Prepares a downloaded car model for convert_car.py (the Godot app's cars, tools/godot/build-cars.py): its real
material names back, and its livery on.

   blender -b --factory-startup -P tools/godot/car_prep.py -- <in.glb> <out.glb> <settings JSON>

settings: {"livery": [[node name regex, image file, mode(, "flip")]], "rename": true, "hide": [node name regex]}
  - rename: materials with generic names (the Audi's "EXT_ENGINE_WIRE_<n>", one per original material) take the name
    the export left in their objects' names ("EXT_Carbon_Bonnet_EXT_CARPAINT_CARBON_0" -> "EXT_CARPAINT_CARBON"): the
    pipeline finds the interior, glass and lights by material name.
  - livery: the objects whose name matches get a copy of their material with the image as its base colour ("replace"),
    or over the material's colour by the image's alpha ("over": a decal sheet on transparent ground). Several zips
    ship the livery as a separate texture the model does not reference. "flip": the image is stored upside down against
    the model's UVs (a DirectX-convention skin).
  - hide: objects to drop (a placeholder decal layer the livery replaces).
  - align: a regex for the tyre objects: a car placed turned in its scene (the Ferrari's Sketchfab scene: about 37
    degrees) is turned back about the vertical so its axles lie along X, from the four biggest tyres' centres.
  - name_by_material: {material name: role} names the objects of anonymous exports (Sketchfab's "Object_38" with
    "mat_220") by their role, "Tyre", "Rim", "Caliper", ...: convert_car.py finds the wheels by name."""
import json
import re
import sys

import bpy

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst, cfg = argv[0], argv[1], json.loads(argv[2])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
GENERIC = re.compile(r'^EXT_ENGINE_WIRE(_\d+)?(\.\d+)?$')
TOKENS = ('EXT_', 'INT_', 'DASH_', 'Dash_', 'COCKPIT_')


def original_name(obj_name):
    n = re.sub(r'(_\d+)+(\.\d+)?$', '', obj_name)
    best = -1
    for t in TOKENS:
        i = n.rfind('_' + t)
        best = max(best, i)
    return n[best + 1:] if best > 0 else n


# mirrored object transforms (the Ferrari's every mesh node: determinant -1) applied here, where Blender flips the faces
# with them: convert_car.py bakes a transform without, and a mirrored car came out inside out (black)
mirrored = [o for o in meshes if o.matrix_world.determinant() < 0]
if mirrored:
    bpy.ops.object.select_all(action='DESELECT')
    for o in mirrored:
        o.select_set(True)
        if o.data.users > 1:
            o.data = o.data.copy()
    bpy.context.view_layer.objects.active = mirrored[0]
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # the imported custom (split) normals do not always follow the flip: where most of a mesh's corner normals point
    # against its faces, they are turned round (inward normals rendered the whole car black)
    import numpy as np
    flipped = 0
    for o in mirrored:
        me = o.data
        if not me.has_custom_normals or not len(me.polygons):
            continue
        cn = np.array([c.vector[:] for c in me.corner_normals])
        fn = np.empty(len(me.polygons) * 3)
        me.polygons.foreach_get('normal', fn)
        fn = fn.reshape(-1, 3)
        li = np.empty(len(me.loops), np.int64)
        for p in me.polygons:
            li[p.loop_start:p.loop_start + p.loop_total] = p.index
        if (np.einsum('ij,ij->i', cn, fn[li]) < 0).mean() > 0.5:
            me.normals_split_custom_set([tuple(-v) for v in cn])
            flipped += 1
    print(f'[prep] custom normals turned round on {flipped} meshes')
    print(f'[prep] {len(mirrored)} mirrored objects applied (faces flipped)')

renamed = 0
if cfg.get('rename'):
    made = {}
    for o in meshes:
        for slot in o.material_slots:
            m = slot.material
            if m is None or not GENERIC.match(m.name):
                continue
            want = original_name(o.name)
            key = (m.name, want)
            if key not in made:
                c = m.copy()
                c.name = want
                made[key] = c
            slot.material = made[key]
            renamed += 1
print(f'[prep] materials renamed on {renamed} slots')

roles = cfg.get('name_by_material', {})
if roles:
    k = 0
    for o in meshes:
        for slot in o.material_slots:
            if slot.material is not None and slot.material.name in roles:
                o.name = f"{roles[slot.material.name]}_{k:03d}"
                k += 1
                break
    print(f'[prep] {k} objects named by their material')

if cfg.get('align'):
    import math
    from mathutils import Matrix, Vector
    r = re.compile(cfg['align'])
    tyres = sorted([o for o in meshes if r.search(o.name)], key=lambda o: -len(o.data.polygons))[:4]
    cs = []
    for o in tyres:
        bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
        cs.append(sum(bb, Vector()) / 8)
    # the two axles: the pairing whose pairs are closest together
    pairs = min(([(0, 1), (2, 3)], [(0, 2), (1, 3)], [(0, 3), (1, 2)]), key=lambda pr: sum((cs[a] - cs[b]).length for a, b in pr))
    axle = [(cs[a] + cs[b]) / 2 for a, b in pairs]
    d = axle[1] - axle[0]
    ang = math.atan2(d.x, d.y)
    centre = (axle[0] + axle[1]) / 2
    rot = Matrix.Translation(centre) @ Matrix.Rotation(ang, 4, 'Z') @ Matrix.Translation(-centre)
    for o in bpy.context.scene.objects:
        if o.parent is None:
            o.matrix_world = rot @ o.matrix_world
    bpy.context.view_layer.update()
    print(f'[prep] aligned: turned {math.degrees(ang):.1f} deg about the vertical (wheelbase {d.length:.2f})')

for rx in cfg.get('hide', []):
    r = re.compile(rx)
    gone = [o for o in meshes if r.search(o.name)]
    meshes = [o for o in meshes if not r.search(o.name)]
    for o in gone:
        bpy.data.objects.remove(o, do_unlink=True)
    print(f'[prep] hidden {len(gone)} objects ({rx})')

for entry in cfg.get('livery', []):
    rx, image, mode = entry[:3]
    r = re.compile(rx)
    img = bpy.data.images.load(image)
    if 'flip' in entry[3:]:
        import numpy as np
        w, h = img.size
        px = np.empty(w * h * 4, np.float32)
        img.pixels.foreach_get(px)
        img.pixels.foreach_set(px.reshape(h, w, 4)[::-1].ravel())
        img.pack()
    done = {}
    n = 0
    for o in meshes:
        if not r.search(o.name):
            continue
        for slot in o.material_slots:
            m = slot.material
            if m is None:
                continue
            if m.name not in done:
                c = m.copy()
                c.name = m.name + '_livery'
                c.use_nodes = True
                nt = c.node_tree
                b = next(nd for nd in nt.nodes if nd.type == 'BSDF_PRINCIPLED')
                t = nt.nodes.new('ShaderNodeTexImage')
                t.image = img
                if mode == 'over':
                    # the decal over the paint's own colour, by the decal's alpha
                    mix = nt.nodes.new('ShaderNodeMix')
                    mix.data_type = 'RGBA'
                    base = b.inputs['Base Color'].default_value[:]
                    old = b.inputs['Base Color'].links[0].from_socket if b.inputs['Base Color'].is_linked else None
                    if old is not None:
                        nt.links.new(old, mix.inputs['A'])
                    else:
                        mix.inputs['A'].default_value = base
                    nt.links.new(t.outputs['Color'], mix.inputs['B'])
                    nt.links.new(t.outputs['Alpha'], mix.inputs['Factor'])
                    nt.links.new(mix.outputs['Result'], b.inputs['Base Color'])
                else:
                    nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
                b.inputs['Base Color'].default_value = (1, 1, 1, 1)
                done[m.name] = c
            slot.material = done[m.name]
            n += 1
    print(f'[prep] livery {image.split("/")[-1]} ({mode}) on {n} slots')

bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='AUTO')
print('[prep] wrote', dst)
