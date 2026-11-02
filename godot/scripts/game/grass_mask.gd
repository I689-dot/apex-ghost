class_name GrassMask
extends RefCounted
## Where grass must not grow (port of game/grassMask.ts): the ground footprint of the circuit's structures
## (grandstands, buildings, boards, gantries, walls), from their render meshes, on a 0.5 m grid, one cell wider all
## round. The grass is placed on the collision ground, and the stands have no collision: blades grew up through their
## lowest rows and the lawn shells showed over their floors.

## Grid cell of the mask (m), and how far from the centreline structures matter (the grass grows within ~110 m of it).
const CELL := 0.5
const NEAR := 130.0

var cells := {}
var _sorted := PackedInt64Array()  # a baked mask: the cells' keys, sorted

const BAKED_DIR := "res://assets/masks/"

## The mask baked by tests/bake_masks.gd for a layout (building it takes ~10 s on a PC, 30 s on a phone), or null.
static func load_baked(layout_id: String) -> GrassMask:
	var path := BAKED_DIR + layout_id + ".bin"
	if not FileAccess.file_exists(path):
		return null
	var m := GrassMask.new()
	m._sorted = FileAccess.get_file_as_bytes(path).to_int64_array()
	return m

func save_baked(layout_id: String) -> void:
	var keys := PackedInt64Array(cells.keys())
	keys.sort()
	DirAccess.make_dir_recursive_absolute(BAKED_DIR)
	var f := FileAccess.open(BAKED_DIR + layout_id + ".bin", FileAccess.WRITE)
	f.store_buffer(keys.to_byte_array())

static func _key(ix: int, iz: int) -> int:
	return ix * 1000003 + iz

## chunks: TrackScene.chunks; ground: the ground materials (not structures).
static func build(chunks: Array, track: Dictionary, ground: Array) -> GrassMask:
	var mask := GrassMask.new()
	var ground_set := {}
	for g in ground:
		ground_set[g] = true
	var ground_re := RegEx.create_from_string("(?i)grass|turf|terrain|ground|top\\d|fill|sand|gravel|asph|road|soil|dirt")
	var near := {}
	var cs := 24.0
	var cl: Array = track.centerline
	var reach := ceili(NEAR / cs)
	for i in range(0, cl.size(), 12):
		for dx in range(-reach, reach + 1):
			for dz in range(-reach, reach + 1):
				near[int(floorf((cl[i] + dx * cs) / cs)) * 100003 + int(floorf((cl[i + 2] + dz * cs) / cs))] = true
	for ch in chunks:
		if ch.kind != "scenery":
			continue
		for n in CarVisual._walk(ch.object):
			if not (n is MeshInstance3D) or (n as MeshInstance3D).mesh == null:
				continue
			var mi := n as MeshInstance3D
			var xf := mi.global_transform
			var mesh := mi.mesh
			for s in mesh.get_surface_count():
				var m := mesh.surface_get_material(s)
				# ground surfaces modelled with the scenery (infields, hillsides, paddocks) are not structures
				if m != null and (ground_set.has(m) or ground_re.search(m.resource_name) != null):
					continue
				var arrays := mesh.surface_get_arrays(s)
				var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
				var idx = arrays[Mesh.ARRAY_INDEX]
				var has_idx: bool = idx != null and idx.size() > 0
				var count: int = idx.size() if has_idx else verts.size()
				for i in range(0, count - 2, 3):
					var a := xf * verts[idx[i] if has_idx else i]
					var b := xf * verts[idx[i + 1] if has_idx else i + 1]
					var c := xf * verts[idx[i + 2] if has_idx else i + 2]
					var k := int(floorf((a.x + b.x + c.x) / 3.0 / cs)) * 100003 + int(floorf((a.z + b.z + c.z) / 3.0 / cs))
					if not near.has(k):
						continue
					mask._fill(a, b, c)
	return mask

## Mark the cells a triangle covers seen from above (its edges too: walls and boards are thin).
func _fill(a: Vector3, b: Vector3, c: Vector3) -> void:
	var x0 := int(floorf(minf(a.x, minf(b.x, c.x)) / CELL)) - 1
	var x1 := int(floorf(maxf(a.x, maxf(b.x, c.x)) / CELL)) + 1
	var z0 := int(floorf(minf(a.z, minf(b.z, c.z)) / CELL)) - 1
	var z1 := int(floorf(maxf(a.z, maxf(b.z, c.z)) / CELL)) + 1
	# a huge triangle is terrain-like (a hillside, a car park): not a structure's footprint
	if (x1 - x0) * (z1 - z0) > 40000:
		return
	var d := (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)
	var thin := absf(d) < 0.02
	var m := (CELL * 1.5) / sqrt(maxf(absf(d), 1e-9))
	for ix in range(x0, x1 + 1):
		for iz in range(z0, z1 + 1):
			var px := (ix + 0.5) * CELL
			var pz := (iz + 0.5) * CELL
			var inside: bool
			if thin:
				inside = _seg_dist(px, pz, a, b) < CELL or _seg_dist(px, pz, b, c) < CELL or _seg_dist(px, pz, c, a) < CELL
			else:
				var w0 := ((b.x - px) * (c.z - pz) - (c.x - px) * (b.z - pz)) / d
				var w1 := ((c.x - px) * (a.z - pz) - (a.x - px) * (c.z - pz)) / d
				# a cell's width of margin around the triangle
				inside = w0 > -m and w1 > -m and 1.0 - w0 - w1 > -m
			if inside:
				cells[_key(ix, iz)] = true

static func _seg_dist(px: float, pz: float, a: Vector3, b: Vector3) -> float:
	var dx := b.x - a.x
	var dz := b.z - a.z
	var l2 := dx * dx + dz * dz
	var t := clampf(((px - a.x) * dx + (pz - a.z) * dz) / l2, 0.0, 1.0) if l2 > 0.0 else 0.0
	return Vector2(px - a.x - dx * t, pz - a.z - dz * t).length()

## Is (x, z) under or right beside a structure?
func covers(x: float, z: float) -> bool:
	var k := _key(int(floorf(x / CELL)), int(floorf(z / CELL)))
	if not _sorted.is_empty():
		var i := _sorted.bsearch(k)
		return i < _sorted.size() and _sorted[i] == k
	return cells.has(k)
