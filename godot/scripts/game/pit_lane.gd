class_name PitLaneMonitor
extends RefCounted
## Where the car is relative to the pit lane (port of game/pitLane.ts): entry, boxes, exit; the lane's geometry, its
## painted boxes, and its asphalt surface. Events from update(): "enter", "exit", "box" or "".

## Length of a garage's box along the lane (m), and half its width across.
const BOX_M := 12.5
const HALF := 3.0
## A box's outer edge this far from the garage front (m).
const GARAGE_GAP := 0.8
## Our pit lane surface over the model's road (m).
const SURFACE_LIFT := 0.03

## lane id -> {away: Array of Vector2, boxShift: Array or null}
static var _geometry := {}

var lane: Dictionary
var in_lane := false
var index := -1
var dist := INF
var _in_box_stop := false
var _geo: Dictionary
## Markings above the road (m); above our own surface where there is one.
var _paint_lift := 0.025

## The lane's cross directions (and box shifts, once measured): shared by every monitor of a track (bots too).
static func lane_geometry(track: Dictionary) -> Dictionary:
	var key := "%s/%s" % [track.id, track.pitLane.length]
	if _geometry.has(key):
		return _geometry[key]
	var pts: Array = track.pitLane.points
	var cl: Array = track.centerline
	var away: Array = []
	for i in pts.size():
		var p: Array = pts[i]
		var a: Array = pts[maxi(0, i - 1)]
		var b: Array = pts[mini(pts.size() - 1, i + 1)]
		var l := Vector2(b[0] - a[0], b[2] - a[2]).length()
		if l == 0.0:
			l = 1.0
		var nx: float = (b[2] - a[2]) / l
		var nz: float = -(b[0] - a[0]) / l
		var c := TrackMath.nearest_centerline_index(track, p[0], p[1], p[2], -1)
		if nx * (p[0] - cl[c * 3]) + nz * (p[2] - cl[c * 3 + 2]) < 0.0:
			nx = -nx
			nz = -nz
		away.append(Vector2(nx, nz))
	var g := {"away": away, "boxShift": null}
	_geometry[key] = g
	return g

func _init(track: Dictionary) -> void:
	assert(track.get("pitLane", null) != null, "track has no pit lane")
	lane = track.pitLane
	_geo = lane_geometry(track)

## Where the boxes really are: each box goes in front of its garage, the wall found across the lane, a box width and
## a gap off it. probe(x, y, z, dx, dz, max) -> distance to the nearest wall, or null.
func measure_boxes(probe: Callable) -> void:
	if _geo.boxShift != null:
		return
	var pts: Array = lane.points
	var raw: Array = []
	for ab in boxes():
		var d: Array = []
		for i in range(ab[0], ab[1] + 1):
			var j := mini(pts.size() - 1, i + 1)
			var aw: Vector2 = _geo.away[i]
			var seg := Vector2(pts[j][0] - pts[i][0], pts[j][2] - pts[i][2]).length()
			var n := maxi(1, roundi(seg / 0.5))
			for s in n:
				var f := float(s) / n
				for lift in [0.0, 0.9]:
					var h = probe.call(
						pts[i][0] + (pts[j][0] - pts[i][0]) * f,
						pts[i][1] + (pts[j][1] - pts[i][1]) * f + lift,
						pts[i][2] + (pts[j][2] - pts[i][2]) * f,
						aw.x, aw.y, 25.0)
					if h != null:
						d.append(h)
		if d.is_empty():
			raw.append(null)
		else:
			d.sort()
			raw.append(d[int(floorf(d.size() / 10.0))])
	# a post or a sign in front of one box is not the garage front: the median of each box and its neighbours
	var shift: Array = []
	for k in raw.size():
		var x = raw[k]
		var from := maxi(0, mini(k - 1, raw.size() - 3))
		var w: Array = raw.slice(from, from + 3).filter(func(v): return v != null)
		if x == null or w.is_empty():
			shift.append(null if x == null else minf(15.0, maxf(0.0, x - GARAGE_GAP - HALF)))
			continue
		w.sort()
		shift.append(minf(15.0, maxf(0.0, minf(x, w[int(floorf(w.size() / 2.0))] + 1.5) - GARAGE_GAP - HALF)))
	# a box with no wall found takes its neighbours' (garage fronts run in a smooth line)
	var out: Array = []
	for k in shift.size():
		var x2 = shift[k]
		if x2 != null:
			out.append(x2)
			continue
		var lo := k - 1
		var hi := k + 1
		while lo >= 0 and shift[lo] == null:
			lo -= 1
		while hi < shift.size() and shift[hi] == null:
			hi += 1
		var l = shift[lo] if lo >= 0 else null
		var r = shift[hi] if hi < shift.size() else null
		if l != null and r != null:
			out.append(l + ((r - l) * (k - lo)) / float(hi - lo))
		else:
			out.append(l if l != null else (r if r != null else 0.0))
	_geo.boxShift = out

## The box shift (m towards the garages) at lane point i (0 outside the boxes or before measure_boxes).
func shift_at(i: int) -> float:
	var sh = _geo.boxShift
	if sh == null:
		return 0.0
	var bx := boxes()
	for k in bx.size():
		if i >= bx[k][0] - 2 and i <= bx[k][1] + 2:
			return sh[k]
	return 0.0

## Unit vector (x, z) across the lane at point i, away from the circuit.
func away_at(i: int) -> Vector2:
	return _geo.away[clampi(i, 0, _geo.away.size() - 1)]

func _locate(x: float, z: float) -> void:
	var pts: Array = lane.points
	var from := 0 if index < 0 else maxi(0, index - 20)
	var to := pts.size() if index < 0 else mini(pts.size(), index + 21)
	var best := INF
	var bi := index
	for i in range(from, to):
		var dx: float = pts[i][0] - x
		var dz: float = pts[i][2] - z
		var d := dx * dx + dz * dz
		if d < best:
			best = d
			bi = i
	index = bi
	dist = sqrt(best)

## off_main: how far outside the circuit's edge the car is (m; <= 0 on the track). speed in m/s.
func update(x: float, z: float, off_main: float, speed: float) -> String:
	_locate(x, z)
	if dist > 40.0:
		index = -1 # far away: full search next time
	var n: int = lane.points.size()
	if not in_lane:
		if dist < 5.0 and index > 3 and index < n * 0.4 and off_main > 1.0:
			in_lane = true
			_in_box_stop = false
			return "enter"
		return ""
	if (index >= n - 5 and off_main <= 0.5) or dist > 14.0:
		in_lane = false
		return "exit"
	var p: Array = lane.points[index]
	var aw := away_at(index)
	var across: float = (x - p[0]) * aw.x + (z - p[2]) * aw.y
	var in_box: bool = index >= lane.boxFrom - 2 and index <= lane.boxTo + 2 and absf(across - shift_at(index)) < HALF + 1.5
	if in_box and speed < 0.8 and not _in_box_stop:
		_in_box_stop = true
		return "box"
	if not in_box or speed > 1.2:
		_in_box_stop = false
	return ""

func limit_ms() -> float:
	return lane.speedLimitKmh / 3.6

## Boxes along the garage row (one per garage, ~12.5 m) as [first, last] lane points.
func boxes() -> Array:
	var f: int = lane.boxFrom
	var to: int = lane.boxTo
	var pts: Array = lane.points
	var step := Vector2(pts[f + 1][0] - pts[f][0], pts[f + 1][2] - pts[f][2]).length()
	if step == 0.0:
		step = 2.5
	var per := maxi(3, roundi(BOX_M / step))
	var out: Array = []
	var i := f
	while i + per - 1 <= to:
		out.append([i, i + per - 1])
		i += per
	return out

## The box of a grid slot: drivers spread evenly along the row, as teams have garages along a real pit lane.
func box_of(slot: int) -> int:
	var n := boxes().size()
	return mini(n - 1, maxi(0, int(floorf((slot + 0.5) * n / Const.MAX_PLAYERS))))

func _paint_material(color: Color, opacity: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(color, opacity)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.no_depth_test = false
	m.render_priority = 2
	return m

func _mesh_from(pos: PackedVector3Array, idx: PackedInt32Array, mat: Material, uv: PackedVector2Array = PackedVector2Array()) -> MeshInstance3D:
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = pos
	arrays[Mesh.ARRAY_INDEX] = idx
	if not uv.is_empty():
		arrays[Mesh.ARRAY_TEX_UV] = uv
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	return mi

## The pit boxes painted along the whole garage row: a white outline in front of every garage, the driver's own box
## in yellow with their name on a board above it, and a PIT SERVICE board where the row starts. ground(x, z, y) -> y.
## mine: {slot, name} or null.
func build_markings(ground: Callable, mine) -> Node3D:
	var g := Node3D.new()
	g.name = "pit-markings"
	var pts: Array = lane.points
	var white := _paint_material(Color("f2f2f2"), 0.8)
	var yellow := _paint_material(Color("ffd60a"), 0.9)
	var fill := _paint_material(Color("ffd60a"), 0.22)
	var bx := boxes()
	var own: int = box_of(mine.slot) if mine != null else -1
	for k in bx.size():
		var a: int = bx[k][0]
		var b: int = bx[k][1]
		var mat := yellow if k == own else white
		g.add_child(_strip(pts, ground, a, b - 1, HALF, 0.15, mat))
		g.add_child(_strip(pts, ground, a, b - 1, -HALF, 0.15, mat))
		g.add_child(_bar(pts, ground, a, mat))
		g.add_child(_bar(pts, ground, b - 1, mat))
		if k == own:
			g.add_child(_strip(pts, ground, a, b - 1, 0.0, HALF * 2.0 - 0.3, fill))
	if not bx.is_empty():
		g.add_child(_strip(pts, ground, bx[0][0], bx[bx.size() - 1][1], -HALF - 0.35, 0.14, white))
		g.add_child(_board(pts, ground, bx[0][0], I18n.t("PIT SERVICE"), I18n.t("STOP IN ANY BOX · TYRES · REPAIRS"), Color("ffd60a")))
	if own >= 0 and mine != null:
		g.add_child(_board(pts, ground, int(roundf((bx[own][0] + bx[own][1]) / 2.0)), String(mine.name).to_upper(), I18n.t("YOUR BOX"), Color("ffd60a")))
	return g

## Across the lane: away from the circuit, each box moved in front of its garage (measure_boxes).
func _strip(pts: Array, ground: Callable, from: int, to: int, offset: float, width: float, mat: Material) -> MeshInstance3D:
	var pos := PackedVector3Array()
	for i in range(from, to + 1):
		var nrm := away_at(i)
		var o := offset + shift_at(i)
		var p: Array = pts[i]
		var x0: float = p[0] + nrm.x * (o - width / 2.0)
		var z0: float = p[2] + nrm.y * (o - width / 2.0)
		var x1: float = p[0] + nrm.x * (o + width / 2.0)
		var z1: float = p[2] + nrm.y * (o + width / 2.0)
		pos.append(Vector3(x0, float(ground.call(x0, z0, p[1])) + _paint_lift, z0))
		pos.append(Vector3(x1, float(ground.call(x1, z1, p[1])) + _paint_lift, z1))
	var idx := PackedInt32Array()
	for i in range(to - from):
		idx.append_array([i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3])
	return _mesh_from(pos, idx, mat)

## A line across the lane at point i (the box's front or back), t m thick along the lane.
func _bar(pts: Array, ground: Callable, i: int, mat: Material, t: float = 0.15) -> MeshInstance3D:
	var a: Array = pts[maxi(0, i - 1)]
	var b: Array = pts[mini(pts.size() - 1, i + 1)]
	var l := Vector2(b[0] - a[0], b[2] - a[2]).length()
	if l == 0.0:
		l = 1.0
	var fx: float = ((b[0] - a[0]) / l) * (t / 2.0)
	var fz: float = ((b[2] - a[2]) / l) * (t / 2.0)
	var nrm := away_at(i)
	var sh := shift_at(i)
	var pos := PackedVector3Array()
	for of in [[sh - HALF, -1.0], [sh + HALF, -1.0], [sh - HALF, 1.0], [sh + HALF, 1.0]]:
		var x: float = pts[i][0] + nrm.x * of[0] + fx * of[1]
		var z: float = pts[i][2] + nrm.y * of[0] + fz * of[1]
		pos.append(Vector3(x, float(ground.call(x, z, pts[i][1])) + _paint_lift, z))
	return _mesh_from(pos, PackedInt32Array([0, 2, 1, 1, 2, 3]), mat)

func _board(pts: Array, ground: Callable, at: int, title: String, sub: String, colour: Color) -> Node3D:
	var root := Node3D.new()
	var aw := away_at(at)
	var sh := shift_at(at)
	var px: float = pts[at][0] + aw.x * sh
	var pz: float = pts[at][2] + aw.y * sh
	var a: Array = pts[maxi(0, at - 2)]
	var b: Array = pts[mini(pts.size() - 1, at + 2)]
	root.position = Vector3(px, float(ground.call(px, pz, pts[at][1])) + 5.2, pz)
	root.rotation.y = atan2(b[0] - a[0], b[2] - a[2]) + PI # facing the cars coming down the lane
	var plate := MeshInstance3D.new()
	var quad := QuadMesh.new()
	quad.size = Vector2(8, 2)
	plate.mesh = quad
	var pm := StandardMaterial3D.new()
	pm.albedo_color = Color("111111")
	pm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	pm.cull_mode = BaseMaterial3D.CULL_DISABLED
	plate.material_override = pm
	root.add_child(plate)
	var l1 := Label3D.new()
	l1.text = title
	l1.font_size = 96
	l1.pixel_size = 0.0045
	l1.modulate = colour
	l1.position = Vector3(0, 0.3, 0.01)
	l1.double_sided = true
	l1.shaded = false
	root.add_child(l1)
	var l2 := Label3D.new()
	l2.text = sub
	l2.font_size = 48
	l2.pixel_size = 0.0045
	l2.position = Vector3(0, -0.5, 0.01)
	l2.double_sided = true
	l2.shaded = false
	root.add_child(l2)
	return root

## A pit lane surface over the model's: grey asphalt with a fine grain from the pit wall to the garages, both edges
## found with the wall probe, laid 3 cm over the visible ground. Call before build_markings.
func build_surface(ground: Callable, probe: Callable) -> Node3D:
	var pts: Array = lane.points
	var n := pts.size()
	var raw: Array = []
	for i in n:
		var p: Array = pts[i]
		var aw := away_at(i)
		var out = probe.call(p[0], p[1], p[2], aw.x, aw.y, 20.0)
		var inn = probe.call(p[0], p[1], p[2], -aw.x, -aw.y, 20.0)
		raw.append([5.0 if out == null else minf(14.0, out - 0.25), 3.0 if inn == null else minf(12.0, inn - 0.25)])
	var edge: Array = []
	for i in n:
		var w: Array = raw.slice(maxi(0, i - 3), mini(n, i + 4))
		var med := func(kk: int) -> float:
			var v: Array = w.map(func(x): return x[kk])
			v.sort()
			return v[int(floorf(v.size() / 2.0))]
		edge.append([med.call(0), -med.call(1)])
	const COLS := 8
	var pos := PackedVector3Array()
	var uv := PackedVector2Array()
	var along := 0.0
	for i in n:
		if i > 0:
			along += Vector2(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]).length()
		var aw := away_at(i)
		var o: float = edge[i][0]
		var inn2: float = edge[i][1]
		for c in COLS + 1:
			var d: float = inn2 + ((o - inn2) * c) / COLS
			var x: float = pts[i][0] + aw.x * d
			var z: float = pts[i][2] + aw.y * d
			pos.append(Vector3(x, float(ground.call(x, z, pts[i][1])) + SURFACE_LIFT, z))
			uv.append(Vector2(d / 4.0, along / 4.0))
	var idx := PackedInt32Array()
	# not over the first and last metres, where the lane joins the circuit
	for i in range(4, n - 5):
		for c in COLS:
			var k := i * (COLS + 1) + c
			idx.append_array([k, k + COLS + 1, k + 1, k + 1, k + COLS + 1, k + COLS + 2])
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color("84868b")
	mat.albedo_texture = _asphalt_grain()
	mat.roughness = 0.92
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	mat.render_priority = 1
	mat.resource_name = "pits_surface"
	_paint_lift = SURFACE_LIFT + 0.015
	var mi := _mesh_from(pos, idx, mat, uv)
	mi.name = "pit-surface"
	# normals for the lit material
	var st := SurfaceTool.new()
	st.create_from(mi.mesh, 0)
	st.generate_normals()
	mi.mesh = st.commit()
	mi.material_override = mat
	return mi

static var _grain: ImageTexture

## A fine asphalt grain (tiling, 4 m), drawn once.
static func _asphalt_grain() -> ImageTexture:
	if _grain != null:
		return _grain
	var img := Image.create(256, 256, false, Image.FORMAT_RGB8)
	var seed_v := 7
	for y in 256:
		for x in 256:
			seed_v = (seed_v * 16807) % 2147483647
			var r1 := seed_v / 2147483647.0
			seed_v = (seed_v * 16807) % 2147483647
			var r2 := seed_v / 2147483647.0
			var v := (150.0 + r1 * 70.0 + (35.0 if r2 < 0.04 else 0.0)) / 255.0
			img.set_pixel(x, y, Color(v, v, v))
	img.generate_mipmaps()
	_grain = ImageTexture.create_from_image(img)
	return _grain
