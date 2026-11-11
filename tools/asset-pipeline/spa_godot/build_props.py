"""Trackside props the Spa source model lacks (the M1 checklist), modelled here at real sizes, for the Godot app.

   blender -b --factory-startup -P tools/asset-pipeline/spa_godot/build_props.py -- godot/assets/maps/spa_g/props

Reads the printed art and the scanned CC0 materials (tex/) build_prop_textures.py wrote into the same folder; writes props.glb, one root node per prop at the
origin, standing on z = 0 (glTF y = 0), its printed face towards -Y (glTF +Z): bollard, feather_flag, tv_crane,
balloon, podium_board, footbridge (spans X, 34 m), marquee. SpaProps places them."""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

out = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene


def mat(name, color, rough=0.6, metal=0.0, tex=None, normal=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1.0)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if tex:
        t = m.node_tree.nodes.new('ShaderNodeTexImage')
        t.image = bpy.data.images.load(os.path.join(out, tex))
        m.node_tree.links.new(t.outputs['Color'], b.inputs['Base Color'])
    if normal:
        _normal(m, b, os.path.join(out, normal))
    return m


def _normal(m, b, path):
    t = m.node_tree.nodes.new('ShaderNodeTexImage')
    t.image = bpy.data.images.load(path)
    t.image.colorspace_settings.name = 'Non-Color'
    nm = m.node_tree.nodes.new('ShaderNodeNormalMap')
    m.node_tree.links.new(t.outputs['Color'], nm.inputs['Color'])
    m.node_tree.links.new(nm.outputs['Normal'], b.inputs['Normal'])


# material name -> metres one repeat of its scanned texture covers (faces wearing it get world-scale UVs: tile_uvs)
TILE = {}


def pbr(name, acg, tile):
    """A scanned CC0 material (build_prop_textures.py copied it to tex/): colour, roughness, metalness when it has one,
    normal map; repeated every `tile` metres."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    d = os.path.join(out, 'tex', acg)
    c = nt.nodes.new('ShaderNodeTexImage')
    c.image = bpy.data.images.load(d + '_color.jpg')
    nt.links.new(c.outputs['Color'], b.inputs['Base Color'])
    for key, sock in (('rough', 'Roughness'), ('metal', 'Metallic')):
        if os.path.exists(f'{d}_{key}.jpg'):
            t = nt.nodes.new('ShaderNodeTexImage')
            t.image = bpy.data.images.load(f'{d}_{key}.jpg')
            t.image.colorspace_settings.name = 'Non-Color'
            nt.links.new(t.outputs['Color'], b.inputs[sock])
        elif sock == 'Metallic':
            b.inputs[sock].default_value = 0.0
    _normal(m, b, d + '_normal.jpg')
    TILE[name] = tile
    return m


ORANGE = pbr('bollard_plastic', 'Plastic007', 0.5)
WHITE = mat('reflective_white', (0.82, 0.82, 0.8), 0.35)
RUBBER = pbr('rubber', 'Rubber004', 0.6)
BLACK = pbr('black_plastic', 'Plastic011', 1.0)
STEEL = pbr('galvanised_steel', 'Metal032', 1.5)
YELLOW = pbr('crane_paint', 'PaintedMetal001', 2.0)
GLASS = mat('cab_glass', (0.05, 0.07, 0.08), 0.1)
FABRIC = pbr('tent_canvas', 'Fabric032', 1.0)
FLAG = mat('flag_print', (1, 1, 1), 0.8, tex='flag.png')
BALLOON = mat('balloon_envelope', (1, 1, 1), 0.55, tex='balloon.png', normal='balloon_normal.png')
PODIUM = mat('podium_face', (1, 1, 1), 0.5, tex='podium.png')
BANNER = mat('bridge_banner', (1, 1, 1), 0.6, tex='banner.png')
WICKER = pbr('basket_wicker', 'Wicker005', 0.5)
CLAD = pbr('corrugated_cladding', 'CorrugatedSteel005', 2.0)


def obj(name, bm, materials):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in materials:
        me.materials.append(m)
    o = bpy.data.objects.new(name, me)
    sc.collection.objects.link(o)
    return o


def box(bm, lo, hi, mi=0, bevel=0.0):
    """An axis-aligned box from corner lo to hi, faces given material index mi; bevelled edges when bevel > 0."""
    r = bmesh.ops.create_cube(bm, size=1.0)
    vs = r['verts']
    c = (Vector(lo) + Vector(hi)) / 2
    s = Vector(hi) - Vector(lo)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(c) @ Matrix.Diagonal((*s, 1)), verts=vs)
    faces = list({f for v in vs for f in v.link_faces})
    for f in faces:
        f.material_index = mi
    if bevel > 0:
        edges = list({e for v in vs for e in v.link_edges})
        bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=2, affect='EDGES', profile=0.5)
    return faces


def beam(bm, a, b, w, mi=0):
    """A square beam of width w from point a to point b."""
    a, b = Vector(a), Vector(b)
    d = b - a
    r = bmesh.ops.create_cube(bm, size=1.0)
    rot = d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    m = Matrix.Translation((a + b) / 2) @ rot @ Matrix.Diagonal((w, w, d.length, 1))
    bmesh.ops.transform(bm, matrix=m, verts=r['verts'])
    for f in {f for v in r['verts'] for f in v.link_faces}:
        f.material_index = mi


def cyl(bm, x, y, z0, z1, r0, r1=None, seg=16, mi=0, axis='Z'):
    r1 = r0 if r1 is None else r1
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r0, radius2=r1, depth=z1 - z0)
    m = Matrix.Translation((x, y, (z0 + z1) / 2))
    if axis == 'X':
        m = Matrix.Translation((x, (z0 + z1) / 2, y)) @ Matrix.Rotation(math.pi / 2, 4, 'Y') if False else Matrix.Translation((x, y, z0)) @ Matrix.Rotation(math.pi / 2, 4, 'X') @ Matrix.Translation((0, 0, (z1 - z0) / 2))
    bmesh.ops.transform(bm, matrix=m, verts=res['verts'])
    for f in {f for v in res['verts'] for f in v.link_faces}:
        f.material_index = mi


# --- bollard: a pit-lane delineator, 0.9 m, two reflective bands on a black foot
bm = bmesh.new()
box(bm, (-0.17, -0.17, 0), (0.17, 0.17, 0.06), 2, 0.015)
cyl(bm, 0, 0, 0.06, 0.58, 0.115, 0.1, 20, 0)
cyl(bm, 0, 0, 0.58, 0.66, 0.1, 0.098, 20, 1)
cyl(bm, 0, 0, 0.66, 0.74, 0.098, 0.096, 20, 0)
cyl(bm, 0, 0, 0.74, 0.82, 0.096, 0.094, 20, 1)
cyl(bm, 0, 0, 0.82, 0.9, 0.094, 0.07, 20, 0)
obj('bollard', bm, [ORANGE, WHITE, RUBBER])

# --- feather flag: 4.2 m pole, a 0.8 x 3.2 m flag curving from the pole, rounded at the top
bm = bmesh.new()
cyl(bm, 0, 0, 0, 4.25, 0.025, 0.02, 10, 1)
box(bm, (-0.25, -0.25, 0), (0.25, 0.25, 0.05), 1)
cols, rows = 8, 24
grid = []
for j in range(rows + 1):
    v = j / rows
    z = 0.95 + 3.2 * v
    row = []
    for i in range(cols + 1):
        u = i / cols
        # the top edge rounds off towards the free end; the cloth bows out a little
        w = 0.8 * (1.0 - max(0.0, (v - 0.78) / 0.22) ** 2 * u)
        x = 0.03 + w * u
        y = -0.12 * math.sin(math.pi * u) * (0.6 + 0.4 * v)
        row.append(bm.verts.new((x, y, z - (0.35 * u * max(0.0, v - 0.78) / 0.22))))
    grid.append(row)
uv_l = bm.loops.layers.uv.new()
for j in range(rows):
    for i in range(cols):
        f = bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
        f.material_index = 0
        for lp, (du, dv) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            lp[uv_l].uv = ((i + du) / cols, (j + dv) / rows)
obj('feather_flag', bm, [FLAG, STEEL])

# --- TV crane: a telehandler (chassis, cab, wheels) with a 20 m boom raised 42 degrees and a camera head
bm = bmesh.new()
box(bm, (-2.9, -1.2, 0.7), (2.9, 1.2, 1.7), 0, 0.06)
box(bm, (0.9, -1.15, 1.7), (2.3, -0.1, 3.3), 2, 0.05)
box(bm, (-2.9, -1.0, 1.7), (-1.6, 1.0, 2.6), 0, 0.05)
for x in (-1.9, 1.9):
    for y in (-1.25, 1.25):
        cyl(bm, x, y, -0.27, 0.27, 0.62, None, 20, 1, axis='X')
        bmesh.ops.translate(bm, vec=(0, 0, 0.62), verts=[v for v in bm.verts if (v.co - Vector((x, y, 0))).length < 0.8 and v.co.z < 0.7])
ang = math.radians(42)
p0 = Vector((-2.2, 0.35, 2.4))
p1 = p0 + Vector((math.cos(ang), 0, math.sin(ang))) * 20.0
beam(bm, p0, p0 + (p1 - p0) * 0.55, 0.62, 0)
beam(bm, p0 + (p1 - p0) * 0.5, p1, 0.42, 0)
box(bm, (p1.x - 0.4, -0.45, p1.z - 0.9), (p1.x + 0.4, 0.45, p1.z - 0.2), 3, 0.03)
box(bm, (p1.x - 0.2, -0.75, p1.z - 0.8), (p1.x + 0.25, -0.35, p1.z - 0.45), 1, 0.02)
obj('tv_crane', bm, [YELLOW, RUBBER, GLASS, STEEL])

# --- hot-air balloon, tethered low as in the video: a 16 m envelope, round with a short taper, its mouth 3 m up
bm = bmesh.new()
bm.loops.layers.uv.new()  # calc_uvs writes into an existing UV layer only
res = bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=20, radius=8.0, calc_uvs=True)
for v in res['verts']:
    z = v.co.z
    if z < 0:
        k = 1.0 + (z / 8.0) * 0.38
        v.co.x *= k
        v.co.y *= k
        v.co.z *= 0.9
    v.co.z += 10.4
for f in bm.faces:
    f.material_index = 0
basket = box(bm, (-0.7, -0.7, 0.0), (0.7, 0.7, 1.1), 1, 0.05)
for a in range(4):
    t = a * math.pi / 2 + math.pi / 4
    beam(bm, (0.6 * math.cos(t), 0.6 * math.sin(t), 1.1), (4.4 * math.cos(t), 4.4 * math.sin(t), 3.6), 0.03, 2)
obj('balloon', bm, [BALLOON, WICKER, RUBBER])

# --- podium board: 6 x 3 m on two posts, its face 2.2 m up
bm = bmesh.new()
face = box(bm, (-3.0, -0.08, 2.2), (3.0, 0.08, 5.2), 1, 0.02)
for x in (-1.9, 1.9):
    box(bm, (x - 0.1, 0.1, 0), (x + 0.1, 0.3, 5.0), 1, 0.01)
obj('podium_board', bm, [PODIUM, BLACK])
# the printed face: UVs over the front (-Y) side only
o = bpy.data.objects['podium_board']
bm = bmesh.new()
bm.from_mesh(o.data)
uv_l = bm.loops.layers.uv.verify()
for f in bm.faces:
    if f.normal.y < -0.9 and f.calc_center_median().z > 2.0:
        f.material_index = 0
        for lp in f.loops:
            lp[uv_l].uv = ((lp.vert.co.x + 3.0) / 6.0, (lp.vert.co.z - 2.2) / 3.0)
bm.to_mesh(o.data)
bm.free()

# --- footbridge: a 34 m box girder over the track (X across) as in f063, its soffit 5.4 m up, 1.6 m deep, clad sides
# carrying the banners, a steel handrail along the deck; stair towers clad in corrugated steel both ends
bm = bmesh.new()
L, z0, dep, wid = 34.0, 5.4, 1.6, 3.4
box(bm, (-L / 2, -wid / 2, z0), (L / 2, wid / 2, z0 + dep), 0, 0.04)
# the banner panels, proud of the girder's sides
for y in (-wid / 2 - 0.04, wid / 2 + 0.04):
    box(bm, (-L / 2 + 1.0, y - 0.02, z0 + 0.2), (L / 2 - 1.0, y + 0.02, z0 + dep - 0.2), 1)
# handrail: posts every 2 m, top and mid rails
for y in (-wid / 2 + 0.05, wid / 2 - 0.05):
    beam(bm, (-L / 2, y, z0 + dep + 1.1), (L / 2, y, z0 + dep + 1.1), 0.06, 0)
    beam(bm, (-L / 2, y, z0 + dep + 0.55), (L / 2, y, z0 + dep + 0.55), 0.04, 0)
    for k in range(18):
        x = -L / 2 + L * k / 17
        beam(bm, (x, y, z0 + dep), (x, y, z0 + dep + 1.1), 0.05, 0)
for x in (-L / 2 - 2.2, L / 2 + 2.2):
    box(bm, (x - 2.2, -2.2, 0), (x + 2.2, 2.2, z0 + dep + 2.6), 2, 0.05)
    box(bm, (x - 2.35, -2.35, z0 + dep + 2.6), (x + 2.35, 2.35, z0 + dep + 2.85), 0, 0.03)
obj('footbridge', bm, [STEEL, BANNER, CLAD])
o = bpy.data.objects['footbridge']
bm = bmesh.new()
bm.from_mesh(o.data)
uv_l = bm.loops.layers.uv.verify()
for f in bm.faces:
    if f.material_index == 1:
        if abs(f.normal.y) < 0.9:
            f.material_index = 0
            continue
        for lp in f.loops:
            u = (lp.vert.co.x + L / 2 - 1.0) / (L - 2.0)
            lp[uv_l].uv = (u if f.normal.y < 0 else 1.0 - u, (lp.vert.co.z - (z0 + 0.2)) / (dep - 0.4))
bm.to_mesh(o.data)
bm.free()

# --- marquee: a 5 x 5 m pagoda tent, 2.4 m eaves, 4.2 m apex, walls open at the front
bm = bmesh.new()
for x in (-2.5, 2.5):
    for y in (-2.5, 2.5):
        cyl(bm, x, y, 0, 2.4, 0.04, None, 8, 1)
top = bm.verts.new((0, 0, 4.2))
corners = [bm.verts.new(c) for c in ((-2.6, -2.6, 2.4), (2.6, -2.6, 2.4), (2.6, 2.6, 2.4), (-2.6, 2.6, 2.4))]
for k in range(4):
    a, b = corners[k], corners[(k + 1) % 4]
    mid = bm.verts.new(((a.co + b.co) / 2) + Vector((0, 0, 0.45)))
    bm.faces.new((a, b, top))
    v_a = bm.verts.new(a.co - Vector((0, 0, 0.35)))
    v_b = bm.verts.new(b.co - Vector((0, 0, 0.35)))
    bm.faces.new((a, v_a, v_b, b))
    if k != 0:
        w0 = bm.verts.new(Vector((a.co.x, a.co.y, 0.0)))
        w1 = bm.verts.new(Vector((b.co.x, b.co.y, 0.0)))
        bm.faces.new((v_a, w0, w1, v_b))
for f in bm.faces:
    if f.material_index != 1:
        f.material_index = 0
obj('marquee', bm, [FABRIC, STEEL])

# the scanned materials at their real size: each face's UVs from its position, projected along its main axis
def tile_uvs(o):
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        mname = me.materials[f.material_index].name if f.material_index < len(me.materials) else ''
        if mname not in TILE:
            continue
        k = 1.0 / TILE[mname]
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for lp in f.loops:
            p = lp.vert.co
            lp[uv].uv = ((p.y, p.z) if ax == 0 else (p.x, p.z) if ax == 1 else (p.x, p.y))
            lp[uv].uv = (lp[uv].uv[0] * k, lp[uv].uv[1] * k)
    bm.to_mesh(me)
    bm.free()


for o in sc.objects:
    if o.type == 'MESH':
        tile_uvs(o)

# hard surfaces flat, the cloth smooth
for o in sc.objects:
    if o.type == 'MESH':
        for f in o.data.polygons:
            f.use_smooth = o.name in ('balloon', 'feather_flag', 'marquee')
os.makedirs(out, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=os.path.join(out, 'props.glb'), export_format='GLB', export_yup=True, export_apply=True)
for o in sc.objects:
    print(f'[props] {o.name}: {len(o.data.polygons)} faces')
