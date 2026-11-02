class_name Forest
extends Node3D
## The Eifel forest around the circuit (port of game/forest.ts): hundreds of thousands of spruce and beech trees placed
## on the map's satellite photo by tools/asset-pipeline/forest_scatter.mjs, packed by tools/godot/pack-forest.mjs into
## per-cell MultiMesh buffers (16 floats a tree: transform rows + colour; trees of a cell sorted by a hash so that the
## first n of a cell is a random thinning).
##
## Species: three Norway spruce models and a maple standing in for the beeches (assets/vegetation/trees.glb).
## Two levels of detail:
##  - near (≤ forestNear m; the heavy maples ≤ 40 % of it): the 3D models, swaying in the wind, with crown normals and
##    baked occlusion; chosen around the camera every ~20 m, a few cells a frame;
##  - far (≤ forestFar m): camera-facing impostor cards baked at load from the same models, one static MultiMesh per
##    128 m cell with every species in it (texture array), thinned by forestDensity; a tree inside the near radius
##    is hidden in the card's vertex shader (the model stands there instead).

const SPRUCE_H := 25.0  # metres at scale 1
const BEECH_H := 21.0
const SPRUCES := 3
const SPRUCE_TINT := Color(0.5, 0.58, 0.47)
const MAPLE_TINT := Color(0.86, 0.92, 0.78)
const NEAR_SHARE := [1.0, 1.0, 1.0, 0.4]
const STRIDE := 16

class Species:
	var mesh: ArrayMesh
	var height: float
	var w_frac: float
	var near_share: float

var grid := {}
var cells := {}     # cell index → PackedFloat32Array (16 floats a tree, pinned trees first)
var ymin := {}
var ymax := {}
var pinned := {}    # cell index → how many leading trees are trackside trees (never thinned)
var species: Array = []
var quality: Dictionary = {}
var _far_nodes := {}   # cell index → MultiMeshInstance3D
var _far_mat := ShaderMaterial.new()
var _near: Array = []  # per species: MultiMeshInstance3D
var _near_mats: Array = []  # per species: Array of ShaderMaterial (one per surface)
var _last_pos := Vector3(1e9, 0, 0)
var _work: Array = []  # cells still to visit for the near refresh
var _tmp: Array = []   # per species: PackedFloat32Array being filled
var _work_pos := Vector3.ZERO
var _drawn_near := 0

static var _globals := false

static func ensure_globals() -> void:
	if not _globals:
		_globals = true
		RenderingServer.global_shader_parameter_add("wind_time", RenderingServer.GLOBAL_VAR_TYPE_FLOAT, 0.0)
		RenderingServer.global_shader_parameter_add("wind_strength", RenderingServer.GLOBAL_VAR_TYPE_FLOAT, 1.0)

## Wind strength (0 calm … ~2 storm), from the weather.
static func set_wind_strength(v: float) -> void:
	ensure_globals()
	RenderingServer.global_shader_parameter_set("wind_strength", v)

## The map's scattered forest (if any) and its trackside trees (null when there are neither). Called as
## `await load_forest(host, track_scene, track_data, quality)` (the forest is added to host).
static func load_forest(host: Node, track: TrackScene, track_data: Dictionary, q: Dictionary) -> Forest:
	ensure_globals()
	var f := Forest.new()
	f.name = "forest"
	# in the tree before the impostors are baked (a viewport renders only there)
	host.add_child(f)
	var ok := await f._load(track, track_data, q)
	if not ok:
		f.queue_free()
		return null
	return f

func _load(track: TrackScene, track_data: Dictionary, q: Dictionary) -> bool:
	var ref = track_data.get("forest", null)
	if ref != null:
		var base := Assets.path(ref.file).get_base_dir()
		var meta_path := base + "/forest_pack.json"
		var bin_path := base + "/forest_pack.bin"
		if FileAccess.file_exists(meta_path) and FileAccess.file_exists(bin_path):
			var meta: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(meta_path))
			var all := FileAccess.get_file_as_bytes(bin_path).to_float32_array()
			grid = {"cell": float(meta.cell), "ox": float(meta.origin[0]), "oz": float(meta.origin[1]), "nx": int(meta.nx), "nz": int(meta.nz)}
			for c in meta.cells:
				var first: int = c[1]
				var count: int = c[2]
				cells[int(c[0])] = all.slice(first * STRIDE, (first + count) * STRIDE)
				ymin[int(c[0])] = float(c[3])
				ymax[int(c[0])] = float(c[4])
				pinned[int(c[0])] = 0
	var extra: Array = track.extract_card_trees()
	if cells.is_empty() and extra.is_empty():
		return false
	if grid.is_empty():
		grid = _grid_for(extra)
	_merge_extra(extra)
	await _make_species()
	if species.is_empty():
		return false
	_build_far()
	_build_near()
	set_quality(q)
	return true

## A grid over the trackside trees when the map has no scattered forest.
func _grid_for(extra: Array) -> Dictionary:
	var lo := Vector2(INF, INF)
	var hi := Vector2(-INF, -INF)
	for e in extra:
		lo = lo.min(Vector2(e.x, e.z))
		hi = hi.max(Vector2(e.x, e.z))
	var cell := 128.0
	return {"cell": cell, "ox": lo.x, "oz": lo.y, "nx": maxi(1, ceili((hi.x - lo.x + 1.0) / cell)), "nz": maxi(1, ceili((hi.y - lo.y + 1.0) / cell))}

func cell_of(x: float, z: float) -> int:
	var cx := clampi(int(floorf((x - grid.ox) / grid.cell)), 0, grid.nx - 1)
	var cz := clampi(int(floorf((z - grid.oz) / grid.cell)), 0, grid.nz - 1)
	return cz * grid.nx + cx

## The source map's trackside trees (crossed cards, read by TrackScene.extract_card_trees) planted as models: never thinned.
func _merge_extra(extra: Array) -> void:
	var by_cell := {}
	var i := 0
	for e in extra:
		var c := cell_of(e.x, e.z)
		if not by_cell.has(c):
			by_cell[c] = PackedFloat32Array()
		var s: float = float(e.h) / (SPRUCE_H if e.spruce else BEECH_H)
		var yaw := fposmod(float((i * 2654435761) % 6283) / 1000.0, TAU)
		i += 1
		var cw := cos(yaw) * s
		var sw := sin(yaw) * s
		by_cell[c].append_array(PackedFloat32Array([cw, 0, sw, e.x, 0, s, 0, e.y + 0.2 - 0.4, -sw, 0, cw, e.z, 0.9, 0.9, 0.9, 0.0 if e.spruce else float(SPRUCES)]))
	for c in by_cell:
		var add: PackedFloat32Array = by_cell[c]
		var old: PackedFloat32Array = cells.get(c, PackedFloat32Array())
		var merged := add.duplicate()
		merged.append_array(old)
		cells[c] = merged
		pinned[c] = pinned.get(c, 0) + add.size() / STRIDE
		if not ymin.has(c):
			ymin[c] = -100.0
			ymax[c] = 300.0

# ---------------------------------------------------------------- species ---

## Spruces and maple from the models, with the baked occlusion; impostor cards baked from them.
func _make_species() -> void:
	var scene = load("res://assets/vegetation/trees.glb")
	if not (scene is PackedScene):
		return
	var root: Node = (scene as PackedScene).instantiate()
	var specs: Array = []
	for k in SPRUCES:
		specs.append(["spruce_%d" % k, SPRUCE_H, SPRUCE_TINT, NEAR_SHARE[k]])
	specs.append(["maple", BEECH_H, MAPLE_TINT, NEAR_SHARE[3]])
	for sp in specs:
		var node := root.find_child(sp[0], true, false) as MeshInstance3D
		if node == null:
			continue
		var s := _species_from(node, sp[1], sp[2], sp[3])
		if s != null:
			species.append(s)
	root.free()
	if species.size() != SPRUCES + 1:
		species.clear()
		return
	await _bake_cards()

func _species_from(node: MeshInstance3D, height: float, tint: Color, near_share: float) -> Species:
	var src := node.mesh
	var xf := node.transform
	var parts: Array = []  # {arrays, leaf, mat}
	for s in src.get_surface_count():
		var arrays := src.surface_get_arrays(s)
		var m := src.surface_get_material(s)
		var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var nors: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL]
		# the models sit at the origin of their scene; the node transform is the quantisation's (dequantise), then to metres
		for i in verts.size():
			verts[i] = (xf * verts[i]) * height
			nors[i] = (xf.basis * nors[i]).normalized()
		arrays[Mesh.ARRAY_VERTEX] = verts
		arrays[Mesh.ARRAY_NORMAL] = nors
		var leaf: bool = m is BaseMaterial3D and (m as BaseMaterial3D).transparency != BaseMaterial3D.TRANSPARENCY_DISABLED
		parts.append({"arrays": arrays, "leaf": leaf, "mat": m})
	# bark first, then leaves
	parts.sort_custom(func(a, b): return int(a.leaf) < int(b.leaf))
	_shade_tree(parts)
	var out := ArrayMesh.new()
	var mats: Array = []
	var lo := Vector3(INF, INF, INF)
	var hi := Vector3(-INF, -INF, -INF)
	for k in parts.size():
		var p: Dictionary = parts[k]
		var arr: Array = p.arrays
		for v in (arr[Mesh.ARRAY_VERTEX] as PackedVector3Array):
			lo = lo.min(v)
			hi = hi.max(v)
		out.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
		var sm := ShaderMaterial.new()
		sm.shader = load("res://shaders/tree_near.gdshader")
		var bm := p.mat as BaseMaterial3D
		sm.set_shader_parameter("albedo_tex", bm.albedo_texture)
		sm.set_shader_parameter("uv_scale", Vector2(bm.uv1_scale.x, bm.uv1_scale.y))
		sm.set_shader_parameter("uv_offset", Vector2(bm.uv1_offset.x, bm.uv1_offset.y))
		sm.set_shader_parameter("leaf", p.leaf)
		var t: Color = tint if p.leaf else Color(0.8, 0.8, 0.8)
		sm.set_shader_parameter("tint", Vector3(t.r, t.g, t.b))
		sm.set_shader_parameter("bend", 0.25 / (height * height))
		sm.set_shader_parameter("flutter", 0.05 if p.leaf else 0.0)
		out.surface_set_material(k, sm)
		mats.append(sm)
	var s := Species.new()
	s.mesh = out
	s.height = height
	s.w_frac = maxf(maxf(-lo.x, hi.x), maxf(-lo.z, hi.z)) * 2.0 * 1.04 / height
	s.near_share = near_share
	_near_mats.append(mats)
	return s

## Crown normals and baked occlusion: leaf normals point out of the crown (a soft volume under the sun); vertex colours
## darken the inside of the crown and its lower part, and the bark (in the shade of the crown).
func _shade_tree(parts: Array) -> void:
	var lo := Vector3(INF, INF, INF)
	var hi := Vector3(-INF, -INF, -INF)
	for p in parts:
		if p.leaf:
			for v in (p.arrays[Mesh.ARRAY_VERTEX] as PackedVector3Array):
				lo = lo.min(v)
				hi = hi.max(v)
	var c := (lo + hi) * 0.5
	var size := hi - lo
	var rad := maxf(size.x, size.z) / 2.0
	if rad <= 0.0:
		rad = 1.0
	for p in parts:
		var verts: PackedVector3Array = p.arrays[Mesh.ARRAY_VERTEX]
		var nors: PackedVector3Array = p.arrays[Mesh.ARRAY_NORMAL]
		var col := PackedColorArray()
		col.resize(verts.size())
		for i in verts.size():
			var v := verts[i]
			var hy := clampf((v.y - lo.y) / (size.y if size.y > 0.0 else 1.0), 0.0, 1.0)
			if p.leaf:
				# ellipsoid around the crown: outward normal, blended with the card's own for some texture in the light
				var n := Vector3((v.x - c.x) / rad, ((v.y - c.y) / (size.y / 2.0 if size.y > 0.0 else 1.0)) * 0.6 + 0.25, (v.z - c.z) / rad).normalized()
				n = (n * 0.82 + nors[i] * 0.18).normalized()
				nors[i] = n
				var radial := minf(1.0, Vector2(v.x - c.x, v.z - c.z).length() / (rad * (0.35 + 0.65 * (1.0 - hy * 0.7))))
				var ao := (0.42 + 0.58 * smoothstep(0.15, 0.95, radial)) * (0.72 + 0.28 * hy)
				col[i] = Color(ao, ao, ao)
			else:
				col[i] = Color(0.55, 0.55, 0.55)
		p.arrays[Mesh.ARRAY_NORMAL] = nors
		p.arrays[Mesh.ARRAY_COLOR] = col

# ------------------------------------------------------------ impostors ---

const BAKE_W := 128
const BAKE_ASPECT := 2.1

## Bakes each species into an alpha-cut impostor card (albedo, occlusion baked), all in one texture array.
func _bake_cards() -> void:
	var res := BAKE_W if float(quality.get("forestNear", 80.0)) < 100.0 else 256
	var imgs: Array[Image] = []
	var cw := PackedFloat32Array()
	var ch := PackedFloat32Array()
	var vp := SubViewport.new()
	vp.own_world_3d = true
	vp.transparent_bg = true
	vp.msaa_3d = Viewport.MSAA_4X
	vp.size = Vector2i(res, int(res * BAKE_ASPECT))
	vp.render_target_update_mode = SubViewport.UPDATE_DISABLED
	add_child(vp)
	var cam := Camera3D.new()
	cam.projection = Camera3D.PROJECTION_ORTHOGONAL
	cam.keep_aspect = Camera3D.KEEP_HEIGHT
	vp.add_child(cam)
	var mi := MeshInstance3D.new()
	vp.add_child(mi)
	var aspect := 1.0 / BAKE_ASPECT
	for k in species.size():
		var sp: Species = species[k]
		mi.mesh = sp.mesh
		# the tree must fit the frame: tall enough for its height and wide enough for its crown
		var size := maxf(sp.height, sp.height * sp.w_frac / aspect)
		cam.size = size
		cam.position = Vector3(0, size / 2.0, 30)
		cam.look_at(Vector3(0, size / 2.0, 0), Vector3.UP)
		for si in sp.mesh.get_surface_count():
			var src := _near_mats[k][si] as ShaderMaterial
			var bm := ShaderMaterial.new()
			bm.shader = load("res://shaders/tree_bake.gdshader")
			for prm in ["albedo_tex", "tint", "uv_scale", "uv_offset", "leaf"]:
				bm.set_shader_parameter(prm, src.get_shader_parameter(prm))
			mi.set_surface_override_material(si, bm)
		vp.render_target_update_mode = SubViewport.UPDATE_ONCE
		await RenderingServer.frame_post_draw
		await RenderingServer.frame_post_draw
		var img := vp.get_texture().get_image()
		if img == null or img.is_empty():
			vp.queue_free()
			species.clear()
			return
		img.convert(Image.FORMAT_RGBA8)
		_dilate(img)
		img.generate_mipmaps()
		imgs.append(img)
		cw.append(size * aspect)
		ch.append(size)
	vp.queue_free()
	var arr := Texture2DArray.new()
	arr.create_from_images(imgs)
	_far_mat.shader = load("res://shaders/tree_far.gdshader")
	_far_mat.set_shader_parameter("cards", arr)
	_far_mat.set_shader_parameter("card_w", Vector4(cw[0], cw[1], cw[2], cw[3]))
	_far_mat.set_shader_parameter("card_h", Vector4(ch[0], ch[1], ch[2], ch[3]))

## Edge texels average with the clear colour: a foliage tone (not black) avoids dark fringes.
func _dilate(img: Image) -> void:
	var data := img.get_data()
	var n := data.size()
	var i := 0
	while i < n:
		if data[i + 3] < 8:
			data[i] = 13
			data[i + 1] = 20
			data[i + 2] = 10
		i += 4
	img.set_data(img.get_width(), img.get_height(), false, Image.FORMAT_RGBA8, data)

# ------------------------------------------------------------- the nodes ---

func _build_far() -> void:
	var quad := QuadMesh.new()
	quad.size = Vector2.ONE
	quad.center_offset = Vector3(0, 0.5, 0)
	quad.material = _far_mat
	var cell: float = grid.cell
	for c in cells:
		var data: PackedFloat32Array = cells[c]
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_colors = true
		mm.mesh = quad
		mm.instance_count = data.size() / STRIDE
		mm.buffer = data
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		var x0: float = grid.ox + (c % grid.nx) * cell
		var z0: float = grid.oz + (c / grid.nx) * cell
		mmi.custom_aabb = AABB(Vector3(x0, ymin[c] - 2.0, z0), Vector3(cell, ymax[c] - ymin[c] + 4.0, cell))
		mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mmi.position = Vector3.ZERO
		add_child(mmi)
		_far_nodes[c] = mmi

func _build_near() -> void:
	for k in species.size():
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_colors = true
		mm.mesh = (species[k] as Species).mesh
		mm.instance_count = 0
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		mmi.custom_aabb = AABB(Vector3(-20000, -2000, -20000), Vector3(40000, 4000, 40000))
		mmi.name = "forest_near_%d" % k
		add_child(mmi)
		_near.append(mmi)
		_tmp.append(PackedFloat32Array())

## The graphics settings changed (also called once at load).
func set_quality(q: Dictionary) -> void:
	quality = q
	var far_d: float = q.forestFar
	var dens: float = q.forestDensity
	var near_r := Vector4(1, 1, 1, 1)
	for k in species.size():
		near_r[k] = float(q.forestNear) * (species[k] as Species).near_share
	_far_mat.set_shader_parameter("near_r", near_r)
	for c in _far_nodes:
		var mmi: MultiMeshInstance3D = _far_nodes[c]
		var count: int = (cells[c] as PackedFloat32Array).size() / STRIDE
		var keep := maxi(int(pinned[c]), ceili(count * dens))
		mmi.multimesh.visible_instance_count = mini(count, keep)
		mmi.visibility_range_end = far_d + grid.cell
	for k in _near.size():
		(_near[k] as MultiMeshInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if q.treeShadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_last_pos = Vector3(1e9, 0, 0)

## Re-select the near trees around the camera; cheap to call every frame (works only after ~20 m of travel, a few cells
## a frame).
func update(cam: Vector3, q: Dictionary, force: bool = false) -> void:
	if q != quality:
		set_quality(q)
	RenderingServer.global_shader_parameter_set("wind_time", Time.get_ticks_msec() / 1000.0)
	if _work.is_empty():
		if not force and cam.distance_squared_to(_last_pos) < 400.0:
			return
		_last_pos = cam
		_work_pos = cam
		var near_d: float = float(q.forestNear)
		var cell: float = grid.cell
		var ci0 := maxi(0, int(floorf((cam.x - near_d - grid.ox) / cell)))
		var ci1 := mini(grid.nx - 1, int(floorf((cam.x + near_d - grid.ox) / cell)))
		var cj0 := maxi(0, int(floorf((cam.z - near_d - grid.oz) / cell)))
		var cj1 := mini(grid.nz - 1, int(floorf((cam.z + near_d - grid.oz) / cell)))
		for cj in range(cj0, cj1 + 1):
			for ci in range(ci0, ci1 + 1):
				var c: int = cj * grid.nx + ci
				if cells.has(c):
					_work.append(c)
		for k in _tmp.size():
			_tmp[k].clear()
		if _work.is_empty():
			_apply_near()
		return
	# a couple of cells a frame
	var budget := 2
	var near_d2 := []
	for k in species.size():
		near_d2.append(pow(float(quality.forestNear) * (species[k] as Species).near_share, 2.0))
	var nd: float = quality.forestNearDensity
	while budget > 0 and not _work.is_empty():
		var c: int = _work.pop_back()
		budget -= 1
		var data: PackedFloat32Array = cells[c]
		var count := data.size() / STRIDE
		var keep := maxi(int(pinned[c]), ceili(count * nd))
		for i in mini(count, keep):
			var o := i * STRIDE
			var dx := data[o + 3] - _work_pos.x
			var dz := data[o + 11] - _work_pos.z
			var d2 := dx * dx + dz * dz
			var kind := int(data[o + 15] + 0.5)
			if d2 <= near_d2[kind]:
				_tmp[kind].append_array(data.slice(o, o + STRIDE))
	if _work.is_empty():
		_apply_near()

func _apply_near() -> void:
	_drawn_near = 0
	for k in _near.size():
		var mm: MultiMesh = (_near[k] as MultiMeshInstance3D).multimesh
		var n: int = _tmp[k].size() / STRIDE
		mm.instance_count = n
		if n > 0:
			mm.buffer = _tmp[k]
		_drawn_near += n

## Total trees drawn as models (near).
func drawn() -> int:
	return _drawn_near

## Does a tree stand in the way from a to b? Each crown as an upright cylinder (40 % of the tree's height wide, from a
## quarter of the way up to its top), the segment sampled every 2 m. For the TV cameras' sightlines.
func blocks(a: Vector3, b: Vector3) -> bool:
	var length := a.distance_to(b)
	var steps := maxi(1, ceili(length / 2.0))
	var seen := {}
	for k in steps + 1:
		var u := float(k) / steps
		var px := a.x + (b.x - a.x) * u
		var pz := a.z + (b.z - a.z) * u
		var cx := int(floorf((px - grid.ox) / grid.cell))
		var cz := int(floorf((pz - grid.oz) / grid.cell))
		if cx < 0 or cz < 0 or cx >= grid.nx or cz >= grid.nz:
			continue
		seen[cz * grid.nx + cx] = true
	var dx := b.x - a.x
	var dz := b.z - a.z
	var d2 := maxf(dx * dx + dz * dz, 1e-6)
	for c in seen:
		if not cells.has(c):
			continue
		var data: PackedFloat32Array = cells[c]
		for i in data.size() / STRIDE:
			var o := i * STRIDE
			var kind := int(data[o + 15] + 0.5)
			var s: float = data[o + 5]
			var h := s * (SPRUCE_H if kind < SPRUCES else BEECH_H)
			var r := h * 0.2
			var tx := data[o + 3]
			var tz := data[o + 11]
			# nearest point of the segment to the trunk (in plan), then whether it is inside the crown there
			var u := clampf(((tx - a.x) * dx + (tz - a.z) * dz) / d2, 0.0, 1.0)
			var ex := a.x + dx * u - tx
			var ez := a.z + dz * u - tz
			if ex * ex + ez * ez > r * r:
				continue
			var y := a.y + (b.y - a.y) * u
			var ty := data[o + 7] + 0.4
			if y > ty + h * 0.25 and y < ty + h:
				return true
	return false
