class_name GrassShells
extends Node3D
## Mown grass with depth on the verges (port of game/grassShells.ts): the lawn near the camera is drawn again in
## `grassShells` thin layers stacked up to SHELL_H above the ground (shell texturing, as racing games grow short lawns).
## Built once at load from the lawn triangles within ~110 m of the racing line, in world space, grouped in 24 m cells;
## each frame only the cells within `grassShellRadius` of the camera are drawn, all layers of a cell in one instanced
## draw. The layers thin out towards the radius (the upper ones first), so the blades shorten into the flat lawn.

const SHELL_H := 0.075
const MAX_SHELLS := 24
const CELL := 24.0
const NEAR_TRACK := 110.0

class ShellCell:
	var node: MultiMeshInstance3D
	var x: float
	var z: float

var cells: Array = []
var _mat := ShaderMaterial.new()
var _last := Vector3(INF, 0, 0)
var _last_q: Dictionary = {}
var _last_n := -1

## Shells over the lawn of these materials near the racing line (null: no lawn).
static func build(track_root: Node3D, lawn: Array, track: Dictionary) -> GrassShells:
	if lawn.is_empty():
		return null
	var lawn_set := {}
	for m in lawn:
		lawn_set[m] = true
	# cells within NEAR_TRACK of the centreline
	var near := {}
	var cl: Array = track.centerline
	var reach := ceili(NEAR_TRACK / CELL)
	for i in range(0, cl.size(), 12):
		for dx in range(-reach, reach + 1):
			for dz in range(-reach, reach + 1):
				near[_key(cl[i] + dx * CELL, cl[i + 2] + dz * CELL)] = true
	# lawn triangles, world space, by cell
	var by_cell := {}
	for n in CarVisual._walk(track_root):
		if not (n is MeshInstance3D) or (n as MeshInstance3D).mesh == null:
			continue
		var mi := n as MeshInstance3D
		var xf := mi.global_transform
		var mesh := mi.mesh
		for s in mesh.get_surface_count():
			if not lawn_set.has(mesh.surface_get_material(s)):
				continue
			var arrays := mesh.surface_get_arrays(s)
			var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
			var nors = arrays[Mesh.ARRAY_NORMAL]
			var idx = arrays[Mesh.ARRAY_INDEX]
			var has_idx: bool = idx != null and idx.size() > 0
			var count: int = idx.size() if has_idx else verts.size()
			for i in range(0, count - 2, 3):
				var ia: int = idx[i] if has_idx else i
				var ib: int = idx[i + 1] if has_idx else i + 1
				var ic: int = idx[i + 2] if has_idx else i + 2
				var a := xf * verts[ia]
				var b := xf * verts[ib]
				var c := xf * verts[ic]
				var k := _key((a.x + b.x + c.x) / 3.0, (a.z + b.z + c.z) / 3.0)
				if not near.has(k):
					continue
				if not by_cell.has(k):
					by_cell[k] = {"p": PackedVector3Array(), "n": PackedVector3Array()}
				var g: Dictionary = by_cell[k]
				g.p.append_array(PackedVector3Array([a, b, c]))
				if nors != null:
					g.n.append_array(PackedVector3Array([(xf.basis * nors[ia]).normalized(), (xf.basis * nors[ib]).normalized(), (xf.basis * nors[ic]).normalized()]))
	if by_cell.is_empty():
		return null
	var out := GrassShells.new()
	out.name = "grass-shells"
	out._mat.shader = load("res://shaders/grass_shells.gdshader")
	out._mat.set_shader_parameter("lawn", load("res://assets/textures/lawn_spa.jpg"))
	out._mat.set_shader_parameter("blades", load("res://assets_static/ground/blades.png"))
	out._mat.render_priority = 1
	for k in by_cell:
		var g: Dictionary = by_cell[k]
		var arrays := []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = g.p
		if g.n.size() == g.p.size():
			arrays[Mesh.ARRAY_NORMAL] = g.n
		var mesh := ArrayMesh.new()
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		mesh.surface_set_material(0, out._mat)
		var lo := Vector3(INF, INF, INF)
		var hi := Vector3(-INF, -INF, -INF)
		for v in (g.p as PackedVector3Array):
			lo = lo.min(v)
			hi = hi.max(v)
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = mesh
		mm.instance_count = MAX_SHELLS
		mm.visible_instance_count = 0
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		mmi.custom_aabb = AABB(lo - Vector3(0, 0.2, 0), (hi - lo) + Vector3(0, SHELL_H + 0.4, 0))
		mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mmi.visible = false
		out.add_child(mmi)
		var sc := ShellCell.new()
		sc.node = mmi
		sc.x = (lo.x + hi.x) / 2.0
		sc.z = (lo.z + hi.z) / 2.0
		out.cells.append(sc)
	return out

static func _key(x: float, z: float) -> int:
	return int(floorf(x / CELL)) * 65536 + int(floorf(z / CELL))

## Show the cells around the camera (after it moved a few metres, or when the preset changed).
func update_shells(cam: Vector3, q: Dictionary, hide: bool = false) -> void:
	var n := 0 if hide else mini(MAX_SHELLS, int(q.grassShells))
	if q != _last_q or n != _last_n:
		_last_q = q
		_last_n = n
		_last = Vector3(INF, 0, 0)
		_mat.set_shader_parameter("shell_radius", float(q.grassShellRadius))
		_mat.set_shader_parameter("shell_count", float(maxi(1, n)))
		RenderingServer.global_shader_parameter_set("shell_ground", float(q.grassShellRadius) if n > 0 else 0.0)
		for c: ShellCell in cells:
			c.node.multimesh.visible_instance_count = n
			for i in c.node.multimesh.instance_count:
				c.node.multimesh.set_instance_transform(i, Transform3D.IDENTITY)
	if n == 0:
		visible = false
		return
	visible = true
	if cam.distance_squared_to(_last) < 9.0:
		return
	_last = cam
	var reach := pow(float(q.grassShellRadius) + CELL * 0.75, 2.0)
	for c: ShellCell in cells:
		c.node.visible = (c.x - cam.x) * (c.x - cam.x) + (c.z - cam.z) * (c.z - cam.z) < reach
