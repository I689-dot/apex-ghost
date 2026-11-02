class_name TrackScene
extends Node3D
## The loaded track: render scene, collision and centreline helpers (port of game/track.ts Track). Chunks are the
## map's GLB files split by the asset pipeline (one node per chunk, named in the layout's "chunks" list); the layout
## may list only some chunks of a file (the Nordschleife layout swaps the GP's terrain and junction walls for its
## own copies). Surface shading beyond the glTF materials is added by TrackShading (shaders).

## Large areas whose small texture tile repeats visibly.
const GROUND_MAT_RE := "(?i)^(grass|top2|terrain_fill|astroturf|sand|gravel)"
const PAVED_MAT_RE := "(?i)^(asph|conc_|pavement|pits|concrete|paddock_roof|ponyva|tiles)"
const ROAD_MAT_RE := "(?i)^(asph|curb|lines|redline|pits|conc_|travert_0|box_decal|pavement)"
const LIGHT_MAT_RE := "(?i)^(lights_emissive|lights_0)"
## Small, dense trackside detail: invisible far away, so culled per mesh by distance.
const DETAIL_MAT_RE := "(?i)^(galvanized|fence|fences_b|details|metals|signs|marshal|stairs|handle|spons|speaker|box_fence|electric_box|tent|medical|building|plastic_cone|tuv|logos|garage_spons)"
## Low vertical barriers along the road: culled per mesh at barrierDistance.
const BARRIER_MAT_RE := "(?i)^(grail|tyrewall|walls_new|wall_pitlane)"
## Flat ground pieces exported among the scenery: they always draw, like the road.
const GROUND_PIECE_RE := "(?i)^(grille|curb_misc)"

class Chunk:
	extends RefCounted
	var object: Node3D
	var kind: String
	var center: Vector3
	var radius: float

var data: Dictionary
var chunks: Array = [] # Chunk
var _details: Array = [] # {mesh, center, radius}
var _barriers: Array = []
## Road materials with their dry look, for the wet-track darkening.
var road_materials: Array = [] # {mat, color, roughness}
var light_materials: Array = []
var start_lights := {"red": [], "green": []}
var lawn_materials: Array = []
var kerb_materials: Array = []
## Every ground surface (grass, gravel, terrain, paving): not structures.
var ground_materials: Array = []
var collision_bodies: Array[StaticBody3D] = []
var ground_query: GroundQuery = null
var forest = null
var _hint := -1
var _re := {}

func _rx(pattern: String) -> RegEx:
	if not _re.has(pattern):
		_re[pattern] = RegEx.create_from_string(pattern)
	return _re[pattern]

func _match(pattern: String, s: String) -> bool:
	return _rx(pattern).search(s) != null

func _init(track_data: Dictionary) -> void:
	data = track_data
	name = "track"

## Builds the scene: chunk models, collision (walls cut across the layout's lap line), the wheel ground query with the
## smoothed road patches. Returns self.
func load_scene() -> TrackScene:
	var files: Array = []
	for c in data.chunks:
		if not files.has(c.file):
			files.append(c.file)
	for f in files:
		var packed := Assets.scene(f)
		if packed == null:
			push_error("track model missing: %s" % f)
			continue
		var scene := packed.instantiate() as Node3D
		# a layout can take some chunks of a file and replace others: drop the chunk nodes this layout does not list
		var listed := {}
		for c in data.chunks:
			if c.file == f:
				listed[c.node] = true
		for child in scene.get_children():
			if String(child.name).begins_with("chunk_") and not listed.has(String(child.name)):
				scene.remove_child(child)
				child.queue_free()
		add_child(scene)
	for c in data.chunks:
		var obj := find_child(c.node, true, false) as Node3D
		if obj == null:
			continue
		var ch := Chunk.new()
		ch.object = obj
		ch.kind = c.kind
		ch.center = Vector3(c.center[0], c.center[1], c.center[2])
		ch.radius = c.radius
		chunks.append(ch)
	_pull_ground_pieces()
	_prepare_materials()
	collision_bodies = TrackCollision.build(self, data)
	return self

## Ground pieces leave their (culled) scenery chunk for an always-visible group.
func _pull_ground_pieces() -> void:
	var ground := Node3D.new()
	ground.name = "ground_pieces"
	var pieces: Array = []
	for n in CarVisual._walk(self):
		if n is MeshInstance3D and (n as MeshInstance3D).mesh != null and (n as MeshInstance3D).mesh.get_surface_count() > 0:
			var m0 := (n as MeshInstance3D).mesh.surface_get_material(0)
			if m0 != null and _match(GROUND_PIECE_RE, m0.resource_name):
				pieces.append(n)
	add_child(ground)
	for p in pieces:
		var tr := _rel(p)
		p.reparent(ground, false)
		p.transform = tr

## A node's transform relative to this scene (works before the scene is in the tree).
func _rel(node: Node3D) -> Transform3D:
	var t := Transform3D.IDENTITY
	var n: Node = node
	while n != null and n != self:
		if n is Node3D:
			t = (n as Node3D).transform * t
		n = n.get_parent()
	return t

func _chunk_kind_of(mesh: Node) -> String:
	for c: Chunk in chunks:
		var a := mesh
		while a != null:
			if a == c.object:
				return c.kind
			a = a.get_parent()
	return "scenery"

func _prepare_materials() -> void:
	var seen := {}
	for n in CarVisual._walk(self):
		if not (n is MeshInstance3D) or (n as MeshInstance3D).mesh == null:
			continue
		var mesh := n as MeshInstance3D
		var kind := _chunk_kind_of(mesh)
		mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if kind == "scenery" or kind == "trees" else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var first_name := ""
		for s in mesh.mesh.get_surface_count():
			var m := mesh.mesh.surface_get_material(s)
			if m == null:
				continue
			if s == 0:
				first_name = m.resource_name
			if seen.has(m):
				continue
			seen[m] = true
			if not (m is StandardMaterial3D):
				continue
			var sm := m as StandardMaterial3D
			var nm := sm.resource_name
			# export slips: one grass material is fully metallic, and the main racing asphalt (asph_003) is glossier than
			# the rest: dry asphalt and grass are rough dielectrics
			if _match(GROUND_MAT_RE, nm):
				sm.metallic = 0.0
			if _match("(?i)^asph", nm):
				sm.roughness = maxf(sm.roughness, 0.9)
			# kerbs are painted concrete: a satin sheen, not the asphalt's matte
			if _match("(?i)^curb", nm) and sm.albedo_texture != null:
				sm.roughness = 0.6
				kerb_materials.append(sm)
			if _match(ROAD_MAT_RE, nm):
				road_materials.append({"mat": sm, "color": sm.albedo_color, "roughness": sm.roughness})
			if _match(LIGHT_MAT_RE, nm):
				light_materials.append(sm)
			if _match("(?i)^red_lights", nm):
				start_lights.red.append(sm)
			if _match("(?i)^green_lights", nm):
				start_lights.green.append(sm)
			# walls too: the source maps flip some of their triangles
			if sm.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED or _match("(?i)^wall", nm):
				sm.cull_mode = BaseMaterial3D.CULL_DISABLED
			if _match(GROUND_MAT_RE, nm) or nm == "grass_fill":
				ground_materials.append(sm)
				if _match("(?i)grass|fill|turf", nm):
					lawn_materials.append(sm)
			elif _match(PAVED_MAT_RE, nm) or _match(ROAD_MAT_RE, nm):
				ground_materials.append(sm)
		var culled = null
		if first_name != "" and _match(DETAIL_MAT_RE, first_name):
			culled = _details
		elif first_name != "" and _match(BARRIER_MAT_RE, first_name):
			culled = _barriers
		if culled != null:
			var aabb := _rel(mesh) * mesh.get_aabb()
			culled.append({"mesh": mesh, "center": aabb.get_center(), "radius": aabb.size.length() / 2.0})

## Builds the wheel ground query (rays against the collision bodies, with the smoothed road patches).
func build_ground_query(world: World3D) -> GroundQuery:
	ground_query = GroundQuery.new(world)
	ground_query.patches = RoadPatches.build(data, ground_query.height_below)
	return ground_query

## All standard materials of the track.
func materials() -> Array:
	var out := {}
	for n in CarVisual._walk(self):
		if n is MeshInstance3D and (n as MeshInstance3D).mesh != null:
			for s in (n as MeshInstance3D).mesh.get_surface_count():
				var m := (n as MeshInstance3D).mesh.surface_get_material(s)
				if m is StandardMaterial3D:
					out[m] = true
	return out.keys()

## Quality settings that act on the scene: shadow casting by kind.
func apply_quality(q: Dictionary) -> void:
	for c: Chunk in chunks:
		var cast: bool = q.treeShadows if c.kind == "trees" else (q.sceneryShadows if c.kind == "scenery" else false)
		for n in CarVisual._walk(c.object):
			if n is GeometryInstance3D:
				n.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if cast else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

## Distance culling of heavy chunks (frustum culling is done by the engine per mesh).
func update_visibility(cam_pos: Vector3, q: Dictionary) -> void:
	for c: Chunk in chunks:
		if c.kind == "track" or c.kind == "terrain":
			continue
		var max_d: float = q.treeDistance if c.kind == "trees" else q.sceneryDistance
		c.object.visible = c.center.distance_to(cam_pos) - c.radius < max_d
	for d in _details:
		d.mesh.visible = d.center.distance_to(cam_pos) - d.radius < q.detailDistance
	for d in _barriers:
		d.mesh.visible = d.center.distance_to(cam_pos) - d.radius < q.barrierDistance
	if forest != null:
		forest.update(cam_pos, q)

## Make every chunk visible (shader/texture warm-up).
func show_all() -> void:
	for c: Chunk in chunks:
		c.object.visible = true
	for d in _details:
		d.mesh.visible = true
	for d in _barriers:
		d.mesh.visible = true

## Darker, glossier asphalt as the track gets wet.
func apply_wetness(w: float) -> void:
	for r in road_materials:
		var col: Color = r.color
		var k := 1.0 - 0.38 * w
		r.mat.albedo_color = Color(col.r * k, col.g * k, col.b * k, col.a)
		r.mat.roughness = r.roughness * (1.0 - 0.62 * w)

func set_night(night_factor: float) -> void:
	for m in light_materials:
		m.emission_enabled = true
		m.emission_energy_multiplier = 0.3 + 4.0 * night_factor

## Start lights: red or green lit.
func set_start_lights(red: bool, green: bool) -> void:
	for m in start_lights.red:
		m.emission_enabled = true
		m.emission_energy_multiplier = 6.0 if red else 0.05
	for m in start_lights.green:
		m.emission_enabled = true
		m.emission_energy_multiplier = 6.0 if green else 0.05

# --------------------------------------------------- centreline ---

## Progress along the lap (m), heading alignment (dot of car fwd and track dir), lateral offset.
## Returns {s, dot, index, lateral}.
func locate(x: float, y: float, z: float, fx: float, fz: float) -> Dictionary:
	var i := TrackMath.nearest_centerline_index(data, x, y, z, _hint, 30)
	_hint = i
	var cl: Array = data.centerline
	var n := cl.size() / 3
	var j := (i + 1) % n
	var tx: float = cl[j * 3] - cl[i * 3]
	var tz: float = cl[j * 3 + 2] - cl[i * 3 + 2]
	var tl := Vector2(tx, tz).length()
	if tl == 0.0:
		tl = 1.0
	tx /= tl
	tz /= tl
	var fl := Vector2(fx, fz).length()
	if fl == 0.0:
		fl = 1.0
	return {
		"index": i, "s": TrackMath.progress_at(data, i, x, z), "dot": (fx * tx + fz * tz) / fl,
		"lateral": (x - cl[i * 3]) * tz - (z - cl[i * 3 + 2]) * tx,
	}

func reset_hint() -> void:
	_hint = -1

## Position and heading on the centreline at distance s: {x, y, z, yaw}.
func point_at(s: float) -> Dictionary:
	return TrackMath.point_at_distance(data, s)

## The source map's trackside trees are crossed alpha cards. Each connected group of cards is one tree: its base,
## height and width are read here and the card chunks are removed, so the forest plants its 3D models in the same
## places. Returns [{x, y, z, h, spruce}].
func extract_card_trees() -> Array:
	var out: Array = []
	for c: Chunk in chunks.filter(func(ch): return ch.kind == "trees"):
		for n in CarVisual._walk(c.object):
			if not (n is MeshInstance3D) or (n as MeshInstance3D).mesh == null:
				continue
			var mi := n as MeshInstance3D
			var pine := false
			for s in mi.mesh.get_surface_count():
				var m := mi.mesh.surface_get_material(s)
				if m != null and _match("(?i)pine", m.resource_name):
					pine = true
			for s in mi.mesh.get_surface_count():
				_card_trees_of_surface(mi, s, pine, out)
		c.object.get_parent().remove_child(c.object)
		c.object.queue_free()
	chunks = chunks.filter(func(ch): return ch.kind != "trees")
	return out

func _card_trees_of_surface(mi: MeshInstance3D, s: int, pine: bool, out: Array) -> void:
	var arr := mi.mesh.surface_get_arrays(s)
	var verts: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
	var idx = arr[Mesh.ARRAY_INDEX]
	var n := verts.size()
	var par := PackedInt32Array()
	par.resize(n)
	for i in n:
		par[i] = i
	var find := func(a: int) -> int:
		while par[a] != a:
			par[a] = par[par[a]]
			a = par[a]
		return a
	if idx != null:
		var ia: PackedInt32Array = idx
		var i := 0
		while i + 2 < ia.size():
			var r0: int = find.call(ia[i])
			var r1: int = find.call(ia[i + 1])
			par[r1] = r0
			var r2: int = find.call(ia[i + 2])
			var r0b: int = find.call(ia[i])
			par[r2] = r0b
			i += 3
	var xf := _rel(mi)
	# minX, minY, minZ, maxX, maxY, maxZ, then sum x, sum z, sum xz, count
	var box := {}
	for i in n:
		var v := xf * verts[i]
		var r: int = find.call(i)
		if not box.has(r):
			box[r] = [v.x, v.y, v.z, v.x, v.y, v.z, v.x, v.z, v.x * v.z, 1]
		else:
			var b: Array = box[r]
			b[6] += v.x
			b[7] += v.z
			b[8] += v.x * v.z
			b[9] += 1
			b[0] = minf(b[0], v.x)
			b[1] = minf(b[1], v.y)
			b[2] = minf(b[2], v.z)
			b[3] = maxf(b[3], v.x)
			b[4] = maxf(b[4], v.y)
			b[5] = maxf(b[5], v.z)
	# pieces far wider than a card or a row of them: one tree per cluster of their vertices
	var big := {}
	for r in box:
		var b2: Array = box[r]
		if Vector2(b2[3] - b2[0], b2[5] - b2[2]).length() > 40.0:
			big[r] = true
	if not big.is_empty():
		var cells := {}
		for i in n:
			if not big.has(find.call(i)):
				continue
			var v2 := xf * verts[i]
			var key := "%d,%d" % [int(floorf(v2.x / 5.0)), int(floorf(v2.z / 5.0))]
			if not cells.has(key):
				cells[key] = [v2.x, v2.y, v2.z, v2.y, 1]
			else:
				var c: Array = cells[key]
				c[0] += v2.x
				c[2] += v2.z
				c[1] = minf(c[1], v2.y)
				c[3] = maxf(c[3], v2.y)
				c[4] += 1
		for c in cells.values():
			var h: float = c[3] - c[1]
			if h >= 1.5 and c[4] >= 3:
				out.append({"x": c[0] / c[4], "y": c[1], "z": c[2] / c[4], "h": h, "spruce": pine})
		for r in big:
			box.erase(r)
	for b3 in box.values():
		var h2: float = b3[4] - b3[1]
		var wx: float = b3[3] - b3[0]
		var wz: float = b3[5] - b3[2]
		var w := Vector2(wx, wz).length()
		if h2 < 1.5:
			continue
		# a row of trees on one card: one tree per ~0.6 x height along it
		var k := maxi(2, roundi(w / (0.6 * h2))) if w > 1.4 * h2 else 1
		var down: bool = b3[8] / b3[9] - (b3[6] / b3[9]) * (b3[7] / b3[9]) < 0.0
		for j in k:
			var t := 0.5 if k == 1 else (j + 0.5) / k
			var z: float = b3[5] - wz * t if down else b3[2] + wz * t
			out.append({"x": b3[0] + wx * t, "y": b3[1], "z": z, "h": h2, "spruce": pine or (k == 1 and w < 0.45 * h2)})
