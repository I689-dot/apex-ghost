class_name GrassBlades
extends Node3D
## Real blades over the verge's lawn (High / Ultra; port of game/grassBlades.ts), on top of the shells. Shells make a dense
## mown carpet but have no outline: from a driver's eye, a few cm above the ground and looking across it, a lawn is
## blades against the light. Each tuft is a clump of curved, tapering blades (opaque: no alpha test to shimmer), every
## blade its own height, lean, curl and shade; mown short right by the track, longer further out. On the GPU the blades are
## swayed by gusts, bent by passing cars and shrunk into the shells towards the radius. Placed at load on the grass
## found by ray casts, denser right at the edge (this takes seconds: only the presets that show blades build them).

const CHUNK_M := 60.0
## Cars that bend the grass around them (the nearest to the camera).
const GRASS_CARS := 6
const MAX_TUFTS := 1400000
const SEG := 4

class BladeChunk:
	var node: MultiMeshInstance3D
	var x: float
	var z: float
	var r: float

var chunks: Array = []
var _mat := ShaderMaterial.new()
var _time := 0.0

class Rng:
	var s: int
	func _init(seed_value: int) -> void:
		s = seed_value & 0xFFFFFFFF
	func next() -> float:
		s = (s * 1664525 + 1013904223) & 0xFFFFFFFF
		return s / 4294967296.0

## A clump of n blades, h0…h1 m tall. uv.y = height along the blade (0 root … 1 tip). Colours per blade: the dull green of
## a mown verge (low saturation), some yellower, some bluer.
static func tuft_mesh(n: int, seed_value: int, h0: float, h1: float) -> ArrayMesh:
	var r := Rng.new(seed_value)
	var pos := PackedVector3Array()
	var nrm := PackedVector3Array()
	var uv := PackedVector2Array()
	var col := PackedColorArray()
	var idx := PackedInt32Array()
	for b in n:
		# clumped: most blades near the centre of the tuft
		var rad := 0.18 * sqrt(r.next()) * (0.4 + 0.6 * r.next())
		var at := r.next() * TAU
		var bx := cos(at) * rad
		var bz := sin(at) * rad
		var face := r.next() * PI
		var fx := cos(face)
		var fz := sin(face)
		var h := h0 + r.next() * (h1 - h0)
		var w := 0.006 + r.next() * 0.007 + h * 0.025
		# leaning away from the clump's centre, curling over towards the tip
		var lean_a := at + (r.next() - 0.5) * 1.2
		var lean := (0.12 + r.next() * 0.45) * h
		var lx := cos(lean_a)
		var lz := sin(lean_a)
		# the lawn's green (deep, fairly saturated), a few yellower and a few bluer
		# (HSL lightness 0.13…0.20 as HSV value: about 0.18…0.28)
		var c := Color.from_hsv((84.0 + r.next() * 18.0) / 360.0, 0.42 + r.next() * 0.16, 0.13 + r.next() * 0.07 + 0.08)
		if r.next() < 0.08:
			c = c.lightened(0.18)
		var base := pos.size()
		for k in SEG + 1:
			var t := float(k) / SEG
			var y := h * (t - 0.18 * t * t * (lean / h))
			var ox := bx + lx * lean * t * t
			var oz := bz + lz * lean * t * t
			var hw := w * pow(1.0 - t, 0.75) * 0.5
			# the blade's face normal (horizontal, across its width), bent back as it leans, rounded across it
			var nx := -fz
			var nz := fx
			var sides: Array = [0.5] if k == SEG else [0.0, 1.0]
			for side in sides:
				var sgn: float = 0.0 if side == 0.5 else side * 2.0 - 1.0
				pos.append(Vector3(ox + fx * hw * sgn, y, oz + fz * hw * sgn))
				var round: float = 0.45 * sgn
				nrm.append(Vector3(nx + fx * round, 0.35 + 0.4 * t, nz + fz * round).normalized())
				uv.append(Vector2(side, t))
				col.append(c)
		for k in SEG - 1:
			var a := base + k * 2
			idx.append_array([a, a + 2, a + 1, a + 1, a + 2, a + 3])
		var a2 := base + (SEG - 1) * 2
		idx.append_array([a2, a2 + 2, a2 + 1])
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = pos
	arrays[Mesh.ARRAY_NORMAL] = nrm
	arrays[Mesh.ARRAY_TEX_UV] = uv
	arrays[Mesh.ARRAY_COLOR] = col
	arrays[Mesh.ARRAY_INDEX] = idx
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return m

## detail: {blades, perM2, band}. Blades on this layout's verges (null: no grass found).
static func build(track: Dictionary, ground: GroundQuery, detail: Dictionary, mask: GrassMask = null) -> GrassBlades:
	var r := Rng.new(4242)
	var cl: Array = track.centerline
	var n := cl.size() / 3
	var band := float(detail.band)
	# fewer per m² on long layouts, so the 25 km one stays within MAX_TUFTS
	var per_m2 := maxf(1.0, minf(float(detail.perM2), MAX_TUFTS / (float(track.length) * 2.0 * band * 0.55)))
	var out := GrassBlades.new()
	out.name = "grass-blades"
	out._mat.shader = load("res://shaders/grass_blades.gdshader")
	out._mat.set_shader_parameter("u_lawn", load("res://assets/vegetation/lawn.jpg"))
	# three kinds of tuft: mown short by the edge, a little longer, and the uncut grass further out
	var tufts := [tuft_mesh(int(detail.blades), 7, 0.06, 0.13), tuft_mesh(int(detail.blades), 8, 0.08, 0.17), tuft_mesh(int(detail.blades), 9, 0.13, 0.32)]
	var bufs: Array = [PackedFloat32Array(), PackedFloat32Array(), PackedFloat32Array()]  # per kind: x y z yaw scale
	var chunk_from := 0.0
	var along := 0.0
	var total := 0
	var limit_l = track.get("limitL", null)
	var limit_r = track.get("limitR", null)
	var wl: PackedFloat32Array = track.widthL
	var wr: PackedFloat32Array = track.widthR
	for i in n:
		if total >= MAX_TUFTS:
			break
		var j := (i + 1) % n
		var dx: float = cl[j * 3] - cl[i * 3]
		var dz: float = cl[j * 3 + 2] - cl[i * 3 + 2]
		var seg := sqrt(dx * dx + dz * dz)
		if seg <= 0.0:
			continue
		var tx := dx / seg
		var tz := dz / seg
		var a := 0.0
		while a < seg:
			for side in [1.0, -1.0]:
				# clear of the white line and the kerb: blades right on it read as black specks over the paint
				var edge: float = (limit_l[i] if limit_l != null else wl[i]) if side > 0.0 else (limit_r[i] if limit_r != null else wr[i])
				edge += 0.9
				var off := edge
				while off < edge + band:
					var x: float = cl[i * 3] + tx * a + tz * off * side
					var z: float = cl[i * 3 + 2] + tz * a - tx * off * side
					off += 1.0
					if mask != null and mask.covers(x, z):
						continue
					var hit := ground.cast(Vector3(x, cl[i * 3 + 1] + 4.0, z), Vector3.DOWN, 12.0)
					if hit.is_empty() or hit.surface != "grass" or hit.normal.y < 0.8:
						continue
					# thicker right at the edge, where the driver looks
					var far := (off - 1.0 - edge) / band
					var here := int(floorf(per_m2 * (1.35 - 0.75 * far) + r.next()))
					var nrm: Vector3 = hit.normal
					for k in here:
						var px := x + r.next() - 0.5
						var pz := z + r.next() - 0.5
						if mask != null and mask.covers(px, pz):
							continue
						# mown near the track; past ~60 % of the strip more and more of it uncut
						var kind := 0
						if far < 0.25:
							kind = 0
						elif far < 0.6:
							kind = 1 if r.next() < 0.8 else 0
						else:
							kind = 2 if r.next() < (far - 0.5) * 1.4 else 1
						var py: float = hit.pos.y - (nrm.x * (px - x) + nrm.z * (pz - z)) / maxf(0.5, nrm.y) - 0.01
						bufs[kind].append_array(PackedFloat32Array([px, py, pz, r.next() * TAU, 0.75 + r.next() * 0.5]))
					total += here
			a += 1.0
		along += seg
		if along - chunk_from >= CHUNK_M:
			out._flush(bufs, tufts)
			chunk_from = along
	out._flush(bufs, tufts)
	return out if total > 0 else null

func _flush(bufs: Array, tufts: Array) -> void:
	for kind in 3:
		var b: PackedFloat32Array = bufs[kind]
		if b.is_empty():
			continue
		var count := b.size() / 5
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = tufts[kind]
		mm.instance_count = count
		var lo := Vector3(INF, INF, INF)
		var hi := Vector3(-INF, -INF, -INF)
		for i in count:
			var o := i * 5
			var p := Vector3(b[o], b[o + 1], b[o + 2])
			var basis := Basis(Vector3.UP, b[o + 3]) * Basis.from_scale(Vector3.ONE * b[o + 4])
			mm.set_instance_transform(i, Transform3D(basis, p))
			lo = lo.min(p)
			hi = hi.max(p)
		(tufts[kind] as ArrayMesh).surface_set_material(0, _mat)
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		mmi.custom_aabb = AABB(lo - Vector3(2, 1, 2), hi - lo + Vector3(4, 3, 4))
		mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mmi.visible = false
		mmi.layers = 2
		add_child(mmi)
		var c := BladeChunk.new()
		c.node = mmi
		c.x = (lo.x + hi.x) / 2.0
		c.z = (lo.z + hi.z) / 2.0
		c.r = Vector2(hi.x - lo.x, hi.z - lo.z).length() / 2.0 + 1.0
		chunks.append(c)
		bufs[kind] = PackedFloat32Array()

## Show the chunks within radius m of the camera (0: hidden).
func update_blades(cam: Vector3, radius: float) -> void:
	visible = radius > 0.0
	if radius <= 0.0:
		return
	_time += get_process_delta_time()
	_mat.set_shader_parameter("u_cam", cam)
	_mat.set_shader_parameter("u_radius", radius)
	_mat.set_shader_parameter("u_time", _time)
	for c: BladeChunk in chunks:
		c.node.visible = (c.x - cam.x) * (c.x - cam.x) + (c.z - cam.z) * (c.z - cam.z) < (radius + c.r) * (radius + c.r)

## Wind (m/s over the ground), wetness and the cars brushing the grass (x, z, push 0..1), once a frame.
func set_frame(wind: Vector2, wet: float, cars: Array) -> void:
	_mat.set_shader_parameter("u_wind", wind)
	_mat.set_shader_parameter("u_wet", wet)
	var arr: Array = []
	for i in GRASS_CARS:
		arr.append(Vector4(cars[i].x, cars[i].y, cars[i].z, 0.0) if i < cars.size() else Vector4(1e9, 1e9, 0, 0))
	_mat.set_shader_parameter("u_cars", arr)
