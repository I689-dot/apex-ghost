class_name SpaProps
extends Node3D
## Trackside objects the source model lacks, for Spa (docs/spa-rebuild: the M1 checklist). COPIES repeats pieces of the
## model where the reference video has more of them: the triangles of the listed materials inside a box (and reaching
## above a height, which leaves the guard rails out), placed at another lap distance in the same place across the track
## (the centreline's frame at the source mapped onto the frame at the destination), optionally repainted. PROPS places the
## objects modelled for Spa (tools/asset-pipeline/spa_godot/build_props.py: bollards, feather flags, TV cranes, the
## balloon, podium boards, the footbridge, tents) where build_places.py put them.

const PROPS := "assets/maps/spa_g/props/props.glb"
const PLACES := "res://assets/maps/spa_g/props_places.json"

## The video's green gantry steel (as albedo_color, sRGB-encoded: multiplied onto the galvanised texture).
const GANTRY_GREEN := Color(0.28, 0.62, 0.36)

## {from_s: lap m of the source, box: [x0, y0, z0, x1, y1, z1] (game frame), parts: [[material pattern, lowest top
## (m, game y): a triangle must reach above it]], to: [[lap m, paint for the first part or null]]}
const COPIES := [
	# TotalEnergies gantry: the model has the one at 3.60 km; the video has two more, green, at Fagnes and Campus
	# (positions from the banner's size in f042-f043 and f047-f048)
	{"from_s": 3602.3, "box": [324.0, -10.0, 577.0, 352.5, 12.0, 586.5], "parts": [["^galvanized_spa$", 3.6], ["^texts_new", -100.0]],
		"to": [[4495.0, GANTRY_GREEN], [4985.0, GANTRY_GREEN]]},
]

## Stretches of a material repainted where the video shows another colour: [material pattern, lap m from, to, side (+1
## right of the direction of travel, -1 left), metres from the centreline from, to, target albedo (linear: the texture's
## mean brought to it, as SpaLook.TARGET)]
const REPAINT := [
	# f007-f009: the pit-exit wall is green (white in the model); measured lit (0.012, 0.08, 0.05)
	["^wall_spa_concrete$", 440.0, 770.0, 1, 4.0, 14.0, Color(0.015, 0.1, 0.06)],
]

static func build(track: TrackScene) -> SpaProps:
	var out := SpaProps.new()
	out.name = "spa-props"
	for rp in REPAINT:
		_repaint(track, rp)
	for c in COPIES:
		var parts := _cut(track, c)
		if parts.is_empty():
			continue
		var src := _frame(track, c.from_s)
		for to in c.to:
			var xf: Transform3D = _frame(track, to[0]) * src.affine_inverse()
			for k in parts.size():
				var mi := MeshInstance3D.new()
				mi.mesh = parts[k].mesh
				mi.transform = xf
				if k == 0 and to[1] != null:
					var m := (parts[k].material as StandardMaterial3D).duplicate() as StandardMaterial3D
					var p: Color = to[1]
					m.albedo_color = Color(m.albedo_color.r * p.r, m.albedo_color.g * p.g, m.albedo_color.b * p.b, m.albedo_color.a)
					mi.material_override = m
				out.add_child(mi)
	out._place_props()
	return out

func _place_props() -> void:
	if not ResourceLoader.exists(Assets.path(PROPS)) or not FileAccess.file_exists(PLACES):
		return
	var scene := Assets.scene(PROPS).instantiate()
	var meshes := {}
	for n in CarVisual._walk(scene):
		if n is MeshInstance3D:
			meshes[String(n.name)] = (n as MeshInstance3D).mesh
	scene.free()
	var rows = JSON.parse_string(FileAccess.get_file_as_string(PLACES))
	if not (rows is Array):
		return
	for row in rows:
		var mesh: Mesh = meshes.get(row[0])
		if mesh == null:
			continue
		var mi := MeshInstance3D.new()
		mi.mesh = mesh
		mi.transform = Transform3D(Basis(Vector3.UP, row[4]), Vector3(row[1], row[2], row[3]))
		# the big ones cast shadows (the balloon, cranes, the footbridge over the track), the small ones not
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if row[0] in ["balloon", "tv_crane", "footbridge", "podium_board"] else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mi)

## The centreline's frame at lap distance s: origin on it, rotated to the track's heading, y up.
static func _frame(track: TrackScene, s: float) -> Transform3D:
	var p := track.point_at(s)
	return Transform3D(Basis(Vector3.UP, p.yaw), Vector3(p.x, p.y, p.z))

## The triangles of each part inside the box, as one mesh per part with that part's material.
static func _cut(track: TrackScene, c: Dictionary) -> Array:
	var b: Array = c.box
	var lo := Vector3(b[0], b[1], b[2])
	var hi := Vector3(b[3], b[4], b[5])
	var out := []
	for part in c.parts:
		var re := RegEx.create_from_string(part[0])
		var top: float = part[1]
		var pos := PackedVector3Array()
		var nor := PackedVector3Array()
		var uv := PackedVector2Array()
		var mat: Material = null
		for n in CarVisual._walk(track):
			if not (n is MeshInstance3D) or (n as MeshInstance3D).mesh == null:
				continue
			var mi := n as MeshInstance3D
			var xf := track._rel(mi)
			for s in mi.mesh.get_surface_count():
				var m := mi.mesh.surface_get_material(s)
				if m == null or re.search(m.resource_name) == null:
					continue
				var a := mi.mesh.surface_get_arrays(s)
				var v: PackedVector3Array = a[Mesh.ARRAY_VERTEX]
				var nv = a[Mesh.ARRAY_NORMAL]
				var tv = a[Mesh.ARRAY_TEX_UV]
				var idx = a[Mesh.ARRAY_INDEX]
				var has_idx: bool = idx != null and idx.size() > 0
				var cnt: int = idx.size() if has_idx else v.size()
				for i in range(0, cnt - 2, 3):
					var ia: int = idx[i] if has_idx else i
					var ib: int = idx[i + 1] if has_idx else i + 1
					var ic: int = idx[i + 2] if has_idx else i + 2
					var pa := xf * v[ia]
					var pb := xf * v[ib]
					var pc := xf * v[ic]
					var ce := (pa + pb + pc) / 3.0
					if ce.x < lo.x or ce.y < lo.y or ce.z < lo.z or ce.x > hi.x or ce.y > hi.y or ce.z > hi.z:
						continue
					if maxf(pa.y, maxf(pb.y, pc.y)) < top:
						continue
					mat = m
					pos.append_array(PackedVector3Array([pa, pb, pc]))
					if nv != null and nv.size() > 0:
						nor.append_array(PackedVector3Array([(xf.basis * nv[ia]).normalized(), (xf.basis * nv[ib]).normalized(), (xf.basis * nv[ic]).normalized()]))
					if tv != null and tv.size() > 0:
						uv.append_array(PackedVector2Array([tv[ia], tv[ib], tv[ic]]))
		if pos.is_empty():
			continue
		var arrays := []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = pos
		if nor.size() == pos.size():
			arrays[Mesh.ARRAY_NORMAL] = nor
		if uv.size() == pos.size():
			arrays[Mesh.ARRAY_TEX_UV] = uv
		var mesh := ArrayMesh.new()
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		mesh.surface_set_material(0, mat)
		out.append({"mesh": mesh, "material": mat})
	return out

## Moves the triangles of a material inside a stretch (lap range, side, distance band) into a surface of their own with a
## repainted copy of the material.
static func _repaint(track: TrackScene, rp: Array) -> void:
	var re := RegEx.create_from_string(rp[0])
	var cl: Array = track.data.centerline
	var cum: Array = track.data.cumS
	# the centreline over the stretch, and its box widened by the band
	var pts := PackedVector2Array()
	var fwd := PackedVector2Array()
	for i in cum.size() - 1:
		if cum[i] >= rp[1] - 5.0 and cum[i] <= rp[2] + 5.0:
			var a := Vector2(cl[i * 3], cl[i * 3 + 2])
			pts.append(a)
			fwd.append((Vector2(cl[i * 3 + 3], cl[i * 3 + 5]) - a).normalized())
	if pts.is_empty():
		return
	var lo := pts[0]
	var hi := pts[0]
	for p in pts:
		lo = lo.min(p)
		hi = hi.max(p)
	lo -= Vector2.ONE * rp[5]
	hi += Vector2.ONE * rp[5]
	for n in CarVisual._walk(track):
		if not (n is MeshInstance3D) or not ((n as MeshInstance3D).mesh is ArrayMesh):
			continue
		var mi := n as MeshInstance3D
		var mesh := mi.mesh as ArrayMesh
		var xf := track._rel(mi)
		for si in range(mesh.get_surface_count() - 1, -1, -1):
			var m := mesh.surface_get_material(si) as StandardMaterial3D
			if m == null or re.search(m.resource_name) == null:
				continue
			var arrays := mesh.surface_get_arrays(si)
			var v: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
			var idx: PackedInt32Array = arrays[Mesh.ARRAY_INDEX] if arrays[Mesh.ARRAY_INDEX] != null else PackedInt32Array()
			if idx.is_empty():
				continue
			var keep := PackedInt32Array()
			var move := PackedInt32Array()
			for t in range(0, idx.size() - 2, 3):
				var c := (xf * v[idx[t]] + xf * v[idx[t + 1]] + xf * v[idx[t + 2]]) / 3.0
				var c2 := Vector2(c.x, c.z)
				var inside := false
				if c2.x >= lo.x and c2.y >= lo.y and c2.x <= hi.x and c2.y <= hi.y:
					var best := INF
					var k := 0
					for j in pts.size():
						var d := pts[j].distance_squared_to(c2)
						if d < best:
							best = d
							k = j
					var off := c2 - pts[k]
					# right of the direction of travel: (-fz, fx) in x, z
					var side := off.dot(Vector2(-fwd[k].y, fwd[k].x))
					inside = side * rp[3] > 0.0 and sqrt(best) >= rp[4] and sqrt(best) <= rp[5]
				var dst := move if inside else keep
				dst.append(idx[t])
				dst.append(idx[t + 1])
				dst.append(idx[t + 2])
			if move.is_empty():
				continue
			mesh.surface_remove(si)
			arrays[Mesh.ARRAY_INDEX] = keep
			if not keep.is_empty():
				mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
				mesh.surface_set_material(mesh.get_surface_count() - 1, m)
			var painted := m.duplicate() as StandardMaterial3D
			var mean := SpaLook.texture_mean(m.albedo_texture)
			var want: Color = rp[6]
			painted.albedo_color = Color(SpaLook._enc(want.r / maxf(mean.r, 0.002)), SpaLook._enc(want.g / maxf(mean.g, 0.002)), SpaLook._enc(want.b / maxf(mean.b, 0.002)), m.albedo_color.a)
			arrays[Mesh.ARRAY_INDEX] = move
			mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
			mesh.surface_set_material(mesh.get_surface_count() - 1, painted)

