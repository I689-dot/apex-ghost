class_name Crowd
extends RefCounted
## Spectators on the grandstands (port of game/crowd.ts). The source map's stands are low-poly shells with the seat rows
## painted on one sloped face, so they looked empty. People are placed on those sloped faces where they look towards the
## track, one per seat-sized cell with gaps (a race-day crowd, not a sell-out), each a small card facing the track, all
## in one instanced draw call.

## Materials whose sloped faces are seating (the Nürburgring GP model; other maps have none named so).
const STAND_MAT_RE := "(?i)^(wall_ringwerk|wall_dorint|openstand|stairs)"
## Metres between seats, and the share of seats taken.
const SEAT_M := 0.95
const OCCUPANCY := 0.68
const VARIANTS := 8

class Rng:
	var s: int
	func _init(seed_value: int) -> void:
		s = seed_value & 0xFFFFFFFF
	func next() -> float:
		s = (s * 1664525 + 1013904223) & 0xFFFFFFFF
		return s / 4294967296.0

## Eight seated figures side by side: skin, hair, shirt in team and fan colours, darker legs.
static func crowd_texture() -> ImageTexture:
	var W := 32
	var H := 64
	var img := Image.create(W * VARIANTS, H, false, Image.FORMAT_RGBA8)
	var shirts := ["d8262f", "f2f2f2", "1d4fa3", "f2c230", "222428", "2e8b4a", "ff7a1a", "7a4fb0"]
	var skins := ["e8c39e", "c99a6e", "8d5a3b", "f1d2b6"]
	var hair := ["2b1d14", "5a3a22", "9a7a4a", "151515"]
	var r := Rng.new(31)
	var rect := func(x: int, y: int, w: int, h: int, c: Color) -> void:
		for yy in range(y, y + h):
			for xx in range(x, x + w):
				img.set_pixel(xx, yy, c)
	var disc := func(cx: float, cy: float, rad: float, c: Color, upper_only: bool) -> void:
		for yy in range(int(cy - rad), int(cy + rad) + 1):
			for xx in range(int(cx - rad), int(cx + rad) + 1):
				if upper_only and yy > cy:
					continue
				if Vector2(xx + 0.5 - cx, yy + 0.5 - cy).length() <= rad:
					img.set_pixel(xx, yy, c)
	for k in VARIANTS:
		var x := k * W
		# legs (seated: short), torso, arms, head
		rect.call(x + 10, 46, 12, 16, Color("2a2f3a") if r.next() < 0.5 else Color("4a4038"))
		rect.call(x + 7, 24, 18, 24, Color(shirts[k]))
		rect.call(x + 4, 27, 4, 15, Color(shirts[k]))
		rect.call(x + 24, 27, 4, 15, Color(shirts[k]))
		disc.call(x + 16.0, 16.0, 6.5, Color(skins[k % skins.size()]), false)
		disc.call(x + 16.0, 13.0, 6.5, Color(hair[(k * 3) % hair.size()]), true)
		# a cap on some
		if k % 3 == 0:
			rect.call(x + 9, 8, 14, 4, Color(shirts[(k + 2) % shirts.size()]))
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)

## The crowd for this map (null when it has no stands): density 0…1 thins it (quality preset). Call after the track's
## meshes are in the tree (world transforms).
static func build(root: Node3D, track: Dictionary, density: float) -> MultiMeshInstance3D:
	if density <= 0.0:
		return null
	var re := RegEx.create_from_string(STAND_MAT_RE)
	# the lap line every ~10 m: which way the track is from a seat
	var cl: Array = track.centerline
	var npts := cl.size() / 3
	var step := maxi(1, roundi(10.0 / (float(track.length) / npts)))
	var line := PackedVector2Array()
	for i in range(0, npts, step):
		line.append(Vector2(cl[i * 3], cl[i * 3 + 2]))
	var r := Rng.new(1234567)
	var seats: Array = []  # [Vector3 position, yaw]
	for node in CarVisual._walk(root):
		if not (node is MeshInstance3D) or (node as MeshInstance3D).mesh == null:
			continue
		var mi := node as MeshInstance3D
		var xf := mi.global_transform
		for s in mi.mesh.get_surface_count():
			var m := mi.mesh.surface_get_material(s)
			if m == null or re.search(m.resource_name) == null:
				continue
			var arrays := mi.mesh.surface_get_arrays(s)
			var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
			var idx = arrays[Mesh.ARRAY_INDEX]
			var count: int = idx.size() if idx != null and idx.size() > 0 else verts.size()
			for k in range(0, count - 2, 3):
				var ia: int = idx[k] if idx != null and idx.size() > 0 else k
				var ib: int = idx[k + 1] if idx != null and idx.size() > 0 else k + 1
				var ic: int = idx[k + 2] if idx != null and idx.size() > 0 else k + 2
				var a := xf * verts[ia]
				var b := xf * verts[ib]
				var c := xf * verts[ic]
				var n := (b - a).cross(c - a)
				var area := n.length() / 2.0
				if area < 0.5:
					continue
				n = n.normalized()
				if n.y < 0.0:
					n = -n
				# seating rises away from the track: a sloped face, up and towards the track
				if n.y < 0.2 or n.y > 0.92:
					continue
				var mx := (a.x + b.x + c.x) / 3.0
				var mz := (a.z + b.z + c.z) / 3.0
				var best := INF
				var tx := 0.0
				var tz := 0.0
				for p in line:
					var d := (p.x - mx) * (p.x - mx) + (p.y - mz) * (p.y - mz)
					if d < best:
						best = d
						tx = p.x - mx
						tz = p.y - mz
				var dist := sqrt(best)
				if dist > 220.0:
					continue
				var hl := maxf(1e-6, Vector2(n.x, n.z).length())
				if (n.x * tx + n.z * tz) / (hl * (dist if dist > 0.0 else 1.0)) < 0.2:
					continue
				var yaw := atan2(tx, tz)
				var people := int(floorf((area * OCCUPANCY * density) / (SEAT_M * SEAT_M) + r.next()))
				for p in people:
					var u := r.next()
					var v := r.next()
					if u + v > 1.0:
						u = 1.0 - u
						v = 1.0 - v
					var pos := a + (b - a) * u + (c - a) * v + Vector3(0, 0.02, 0)
					seats.append([pos, yaw + (r.next() - 0.5) * 0.5])
	if seats.is_empty():
		return null
	var quad := QuadMesh.new()
	quad.size = Vector2(0.55, 1.05)
	quad.center_offset = Vector3(0, 0.52, 0)
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/crowd.gdshader")
	mat.set_shader_parameter("people", crowd_texture())
	quad.material = mat
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.use_custom_data = true
	mm.mesh = quad
	mm.instance_count = seats.size()
	for i in seats.size():
		var variant := floorf(r.next() * VARIANTS)
		var h := 0.9 + r.next() * 0.25
		var basis := Basis(Vector3.UP, seats[i][1]) * Basis.from_scale(Vector3(h, h, h))
		mm.set_instance_transform(i, Transform3D(basis, seats[i][0]))
		var shade := 0.8 + r.next() * 0.3
		mm.set_instance_color(i, Color(shade, shade, shade))
		mm.set_instance_custom_data(i, Color(variant, 0, 0, 0))
	var out := MultiMeshInstance3D.new()
	out.name = "crowd"
	out.layers = 2
	out.multimesh = mm
	out.custom_aabb = AABB(Vector3(-20000, -2000, -20000), Vector3(40000, 4000, 40000))
	out.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return out
