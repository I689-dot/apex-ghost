class_name TrackCollision
extends RefCounted
## Loads a track's collision file (.apxc, gzip) into Jolt trimesh bodies, one per surface sub-mesh
## (port of loadCollision in game/assets.ts and Track.buildColliders in game/track.ts).
## Each StaticBody3D carries the "surface" meta that GroundQuery reads; walls sit on their own layer.

const C = preload("res://scripts/physics/vehicle_consts.gd")

## Reads one .apxc into [{surface, positions: PackedVector3Array, indices: PackedInt32Array}].
static func read_file(path: String, surfaces: Array) -> Array:
	var raw := FileAccess.get_file_as_bytes(path)
	if raw.is_empty():
		push_error("collision file missing: %s" % path)
		return []
	# gzip magic: inflate here (an uncompressed file is read as is)
	var buf := raw.decompress_dynamic(-1, FileAccess.COMPRESSION_GZIP) if raw[0] == 0x1f and raw[1] == 0x8b else raw
	if buf.size() < 12 or buf.slice(0, 4).get_string_from_ascii() != "APXC":
		push_error("invalid collision file: %s" % path)
		return []
	var n := buf.decode_u32(8)
	var o := 12
	var out: Array = []
	for i in n:
		var si := buf.decode_u32(o)
		var nv := buf.decode_u32(o + 4)
		var ni := buf.decode_u32(o + 8)
		o += 12
		var pos := buf.slice(o, o + nv * 12).to_vector3_array()
		o += nv * 12
		var idx := buf.slice(o, o + ni * 4).to_int32_array()
		o += ni * 4
		out.append({"surface": surfaces[si], "positions": pos, "indices": idx})
	return out

## Builds the colliders under parent. track = the layout's JSON (collision.file / extra / surfaces, centerline).
## res_root is where the web asset paths ("assets/...") are rooted. Returns the created bodies.
static func build(parent: Node3D, track: Dictionary, res_root: String = "res://") -> Array[StaticBody3D]:
	var files: Array = [track.collision.file]
	files.append_array(track.collision.get("extra", []))
	var bodies: Array[StaticBody3D] = []
	for file in files:
		for m in read_file(res_root + file, track.collision.surfaces):
			var idx: PackedInt32Array = m.indices
			if m.surface == "wall":
				idx = WallCut.cut(m.positions, idx, track.centerline)
			var body := _make_body(m.surface, m.positions, idx)
			parent.add_child(body)
			bodies.append(body)
	return bodies

static func _make_body(surface: String, positions: PackedVector3Array, indices: PackedInt32Array) -> StaticBody3D:
	var faces := PackedVector3Array()
	faces.resize(indices.size())
	for i in indices.size():
		faces[i] = positions[indices[i]]
	var shape := ConcavePolygonShape3D.new()
	shape.backface_collision = true
	shape.set_faces(faces)
	var body := StaticBody3D.new()
	body.collision_layer = C.LAYER_WALL if surface == "wall" else C.LAYER_TRACK
	body.collision_mask = 0
	var mat := PhysicsMaterial.new()
	mat.friction = 0.25 if surface == "wall" else 0.8
	mat.bounce = 0.15 if surface == "wall" else 0.0
	body.physics_material_override = mat
	body.set_meta("surface", surface)
	var cs := CollisionShape3D.new()
	cs.shape = shape
	body.add_child(cs)
	return body
