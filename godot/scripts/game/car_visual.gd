class_name CarVisual
extends Node3D
## A visible car (port of game/carVisual.ts): LOD levels instanced from the shared model, rigged wheels and steering,
## per-instance light materials, dents, ghost fading, headlights, smoke. Local axes: +X left, +Y up, +Z forward.

const WHEELS := ["FL", "FR", "RL", "RR"]
## Where other cars switch to lighter models (x CAR_LOD.scale): full detail up close, LOD1 from 30 m, LOD2 beyond 130 m.
const LOD_DIST := [0.0, 30.0, 130.0]
## The quality preset's car detail distance (QualityConfig.carLodScale): set before the cars are built.
static var car_lod_scale := 1.0
## 1 while the camera is in your own cockpit (set by the session each frame).
static var cockpit_glass := 0.0

static var _glass_re: RegEx
static var _pool_tex: GradientTexture2D
static var _smoke_tex: GradientTexture2D

class WheelRig:
	extends RefCounted
	var hub: Node3D
	var spin: Node3D
	var base_x: float
	var base_y: float

class LevelRig:
	extends RefCounted
	var root: Node3D
	var wheels: Array = [] # WheelRig
	var steering: Node3D = null

var entry: Dictionary
var local: bool
var _levels: Array = [] # LevelRig
var _head_mats: Array = []
var _tail_mats: Array = []
var _fade_mats: Array = [] # StandardMaterial3D (cloned)
var _glass_mats: Array = [] # [material, base colour] pairs for the cockpit dimming
var _strip_mats: Array = []
var _body_meshes: Array = [] # MeshInstance3D
var _orig_arrays := {} # mesh instance id -> original surface arrays
var _steer_axis := Vector3(0, 0, 1)
## Steering-wheel angle : road-wheel angle, from the real car's lock.
var _steer_ratio: float
var _pool: MeshInstance3D = null
var headlights: Array = [] # SpotLight3D
var _smoke: Array = [] # Sprite3D
var _smoke_t := 0.0
var _opacity := 1.0
var static_comp: Array = [0.0, 0.0, 0.0, 0.0]
## How far each wheel is off its hub (m, FL, FR, RL, RR): the pit crew's work.
var wheel_out := [0.0, 0.0, 0.0, 0.0]
## Your own car with the cockpit model: that model inside, the normal LOD0 seen from outside (set_inside).
var _inside_root: Node3D = null
var _outside_root: Node3D = null
var _inside = null

## model: Assets.load_car_model result. outside: the normal LOD0 scene for your own car's outside view (or null).
func _init(car_entry: Dictionary, model: Dictionary, is_local: bool, outside: PackedScene = null) -> void:
	entry = car_entry
	local = is_local
	_steer_ratio = SteeringLock.lock_deg(entry.id) / 2.0 / maxf(10.0, float(entry.specs.maxSteerDeg))
	name = "car_%s" % entry.id
	var st = entry.get("steering", null)
	if st != null:
		_steer_axis = Vector3(st.axis[0], st.axis[1], st.axis[2]).normalized()
	var levels: Array = model.lods.slice(0, 1) if local else model.lods
	var first: int = 0 if local else model.first_level
	var cache := {}
	for i in levels.size():
		var src: PackedScene = levels[i]
		if src == null:
			continue
		var root: Node3D = src.instantiate()
		_prepare_materials(root, cache)
		var rig := _rig(root)
		_levels.append(rig)
		add_child(root)
		if levels.size() > 1:
			_set_lod_range(root, (LOD_DIST[mini(first + i, 2)] if first + i < LOD_DIST.size() else 200.0) * car_lod_scale, (LOD_DIST[first + i + 1] * car_lod_scale) if first + i + 1 < LOD_DIST.size() else 0.0)
		if i == 0:
			_add_body(root)
			_inside_root = root
	if local and outside != null:
		var root2: Node3D = outside.instantiate()
		_prepare_materials(root2, cache)
		_levels.append(_rig(root2))
		_add_body(root2)
		add_child(root2)
		_outside_root = root2
		set_inside(true)
	_set_shadows(self)
	# remote cars always, and your own car when real spot lights are too expensive, get a projected light pool
	_make_light_pool()

## LOD by visibility range on every mesh of a level: visible from begin to end metres (0 = unlimited).
func _set_lod_range(root: Node, begin: float, end_m: float) -> void:
	for n in _walk(root):
		if n is GeometryInstance3D:
			n.visibility_range_begin = begin
			n.visibility_range_end = end_m
			n.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_DISABLED

static func _walk(n: Node) -> Array:
	var out: Array = [n]
	for c in n.get_children():
		out.append_array(_walk(c))
	return out

## Dents go on the most detailed level (and on the outside model of your own car).
func _add_body(root: Node) -> void:
	var b := root.find_child("body", true, false)
	if b != null:
		for n in _walk(b):
			if n is MeshInstance3D:
				_body_meshes.append(n)

func _set_shadows(root: Node) -> void:
	for n in _walk(root):
		if n is GeometryInstance3D:
			n.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON

static func _is_glass(mat_name: String) -> bool:
	if _glass_re == null:
		_glass_re = RegEx.create_from_string("(?i)glass|window|windscreen|windshield|visor|lexan")
	return _glass_re.search(mat_name) != null

## The car's material fixes (CarEntry.look), checked from the driver's seat.
func _apply_look(sm: StandardMaterial3D) -> void:
	var look = entry.get("look", null)
	if look == null:
		return
	var f = look.get("tint", {}).get(sm.resource_name) if look.get("tint") != null else null
	if f != null:
		sm.albedo_color = Color(sm.albedo_color.r * f, sm.albedo_color.g * f, sm.albedo_color.b * f, sm.albedo_color.a)
	var flat = look.get("plain", {}).get(sm.resource_name) if look.get("plain") != null else null
	if flat != null:
		sm.albedo_texture = null
		sm.albedo_color = Color(flat)
		sm.roughness = maxf(sm.roughness, 0.8)
	if look.get("glass") != null and look.glass.has(sm.resource_name):
		sm.albedo_texture = null
		sm.albedo_color = Color(0x9a / 255.0, 0xa3 / 255.0, 0xad / 255.0, 0.22)
		sm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		sm.roughness = 0.05
		sm.metallic = 0.0
	# your own sun strip, from the seat only: a tinted band you can see through (from outside it stays a sticker)
	if local and look.get("strip") != null and look.strip.has(sm.resource_name):
		sm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		_strip_mats.append([sm, sm.albedo_color])

func _prepare_materials(root: Node, cache: Dictionary) -> void:
	for n in _walk(root):
		if not (n is MeshInstance3D):
			continue
		var mi := n as MeshInstance3D
		if mi.mesh == null:
			continue
		for s in mi.mesh.get_surface_count():
			var src := mi.mesh.surface_get_material(s)
			if src == null:
				continue
			var swapped: Material = cache.get(src)
			if swapped == null:
				swapped = src.duplicate()
				cache[src] = swapped
				if swapped is StandardMaterial3D:
					_setup_material(swapped as StandardMaterial3D)
			mi.set_surface_override_material(s, swapped)

func _setup_material(sm: StandardMaterial3D) -> void:
	var nm := sm.resource_name
	if nm.begins_with("LIGHT_HEAD_"):
		if not sm.emission_enabled or (sm.emission_texture == null and sm.emission == Color.BLACK):
			sm.emission_enabled = true
			sm.emission = Color(1, 0.97, 0.9)
		_head_mats.append(sm)
	elif nm.begins_with("LIGHT_TAIL_"):
		sm.emission_enabled = true
		if sm.emission_texture == null and sm.emission == Color.BLACK:
			sm.emission = Color(1, 0.05, 0.02)
		else:
			sm.emission = Color(1, 0.12, 0.08)
		_tail_mats.append(sm)
	# an untextured opaque "glass" is really the untextured cabin shell: give it a dark trim colour
	if sm.transparency == BaseMaterial3D.TRANSPARENCY_DISABLED and sm.albedo_texture == null and _is_glass(nm):
		sm.albedo_color = Color("1b1d21")
		sm.roughness = 0.85
		sm.metallic = 0.0
	_apply_look(sm)
	if local and sm.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED and _is_glass(nm):
		_glass_mats.append([sm, sm.albedo_color])
	if not local:
		# stochastic transparency: fades without sorting
		if sm.transparency == BaseMaterial3D.TRANSPARENCY_DISABLED:
			sm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_HASH
		_fade_mats.append(sm)

func _rig(root: Node3D) -> LevelRig:
	var rig := LevelRig.new()
	rig.root = root
	for k in WHEELS:
		var hub := root.find_child("wheel_%s" % k, true, false) as Node3D
		if hub == null:
			continue
		# insert a pivot at the hub so spinning is about the true axle, whatever the mesh node transform is
		var pivot := Node3D.new()
		pivot.name = "spin_%s" % k
		hub.add_child(pivot)
		for c in hub.get_children():
			if c != pivot and (String(c.name).ends_with("_spin") or String(c.name).contains("spin")):
				c.owner = null
				(c as Node3D).reparent(pivot, false)
		var w := WheelRig.new()
		w.hub = hub
		w.spin = pivot
		w.base_x = hub.position.x
		w.base_y = hub.position.y
		rig.wheels.append(w)
	var sw := root.find_child("steering_rim", true, false) as Node3D
	if sw != null:
		var pivot2 := Node3D.new()
		pivot2.name = "steering_pivot"
		sw.add_child(pivot2)
		for c in sw.get_children():
			if c != pivot2:
				c.owner = null
				(c as Node3D).reparent(pivot2, false)
		rig.steering = pivot2
	return rig

func _make_light_pool() -> void:
	if _pool_tex == null:
		_pool_tex = GradientTexture2D.new()
		var g := Gradient.new()
		g.colors = PackedColorArray([Color(1, 0.96, 0.86, 0.9), Color(1, 0.94, 0.82, 0.35), Color(1, 0.94, 0.82, 0.0)])
		g.offsets = PackedFloat32Array([0.0, 0.5, 1.0])
		_pool_tex.gradient = g
		_pool_tex.fill = GradientTexture2D.FILL_RADIAL
		_pool_tex.fill_from = Vector2(0.5, 0.5)
		_pool_tex.fill_to = Vector2(1.0, 0.5)
		_pool_tex.width = 128
		_pool_tex.height = 128
	var quad := QuadMesh.new()
	quad.size = Vector2(9, 22)
	quad.orientation = PlaneMesh.FACE_Y
	_pool = MeshInstance3D.new()
	_pool.mesh = quad
	_pool.position = Vector3(0, 0.06, float(entry.dims.length) / 2.0 + 10.0)
	var m := StandardMaterial3D.new()
	m.albedo_texture = _pool_tex
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.albedo_color = Color(1, 1, 1, 0)
	m.no_depth_test = false
	m.render_priority = 2
	_pool.material_override = m
	_pool.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_pool.visible = false
	add_child(_pool)

## Your own car: the cockpit model while the camera is in it, LOD0 from outside (no-op without an outside model).
## Inside, the outside model still casts the car's shadow (shadows-only mode, invisible to the view camera).
func set_inside(inside: bool) -> void:
	if _inside_root == null or _outside_root == null or inside == _inside:
		return
	_inside = inside
	_inside_root.visible = inside
	for n in _walk(_inside_root):
		if n is GeometryInstance3D:
			n.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	for n in _walk(_outside_root):
		if n is GeometryInstance3D:
			n.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY if inside else GeometryInstance3D.SHADOW_CASTING_SETTING_ON
			n.visible = true
	_outside_root.visible = true
	if inside:
		# only shadows from the outside model: its meshes are not drawn for the view
		for n in _walk(_outside_root):
			if n is GeometryInstance3D:
				n.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY
	else:
		for n in _walk(_outside_root):
			if n is GeometryInstance3D:
				n.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON

## Cockpit-only cost cut for weaker GPUs: glass becomes a plain tint. Must run before shader warm-up.
func simplify_for_cockpit() -> void:
	var tint := StandardMaterial3D.new()
	tint.albedo_color = Color(0x80 / 255.0, 0x90 / 255.0, 0xa0 / 255.0, 0.1)
	tint.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	tint.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	for n in _walk(self):
		if not (n is MeshInstance3D) or n.mesh == null:
			continue
		for s in n.mesh.get_surface_count():
			var m = n.get_surface_override_material(s)
			if m is StandardMaterial3D and not m.resource_name.begins_with("LIGHT_"):
				if m.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED and _is_glass(m.resource_name):
					n.set_surface_override_material(s, tint)

## Real spot lights for the local car (shadows optional).
func add_headlights(shadows: bool) -> void:
	var z := float(entry.dims.length) / 2.0 - 0.3
	for x in [0.6, -0.6]:
		var l := SpotLight3D.new()
		l.light_color = Color("fff3e0")
		l.light_energy = 0.0
		l.spot_range = 140.0
		l.spot_angle = rad_to_deg(0.42)
		l.spot_angle_attenuation = 0.55
		l.position = Vector3(x, 0.65, z)
		l.look_at_from_position(l.position, Vector3(x * 0.6, 0, z + 25.0), Vector3.UP)
		l.shadow_enabled = shadows and x > 0.0
		add_child(l)
		headlights.append(l)

## Update visual state: steer = road-wheel angle (rad), rot_f / rot_r wheel angles, susp = per-wheel compression delta from static (m).
func set_pose(steer: float, rot_f: float, rot_r: float, susp) -> void:
	for lvl: LevelRig in _levels:
		for i in lvl.wheels.size():
			var w: WheelRig = lvl.wheels[i]
			var front := i < 2
			w.hub.rotation.y = steer if front else 0.0
			w.spin.rotation.x = rot_f if front else rot_r
			w.hub.position.y = w.base_y + (float(susp[i]) if i < susp.size() else 0.0)
			# a pit stop: the wheel off its hub, outwards
			w.hub.position.x = w.base_x + signf(w.base_x) * wheel_out[i]
		if lvl.steering != null:
			# the axis points at the driver, so a positive angle turns the rim counter-clockwise (left)
			lvl.steering.quaternion = Quaternion(_steer_axis, steer * _steer_ratio)

func set_lights(brake: bool, headlights_on: bool, night: float) -> void:
	var tail := 5.0 if brake else (1.1 if headlights_on or night > 0.3 else 0.12)
	for m in _tail_mats:
		m.emission_energy_multiplier = tail
	var head := 4.0 if headlights_on else 0.35
	for m in _head_mats:
		m.emission_energy_multiplier = head
	for l in headlights:
		l.light_energy = 6.0 if headlights_on else 0.0
	if _pool != null:
		_pool.visible = headlights_on
		(_pool.material_override as StandardMaterial3D).albedo_color = Color(1, 1, 1, 0.55 * minf(1.0, night + 0.3) if headlights_on else 0.0)

## Glass seen from inside the cockpit is dark (sun strips and lettering are printed on the outside of the texture).
func update_cockpit_glass(v: float) -> void:
	for gm in _glass_mats:
		var m: StandardMaterial3D = gm[0]
		var base: Color = gm[1]
		m.albedo_color = Color(lerpf(base.r, base.r * 0.12 + 0.01, v), lerpf(base.g, base.g * 0.12 + 0.01, v), lerpf(base.b, base.b * 0.12 + 0.01, v), base.a)
	for sm in _strip_mats:
		var m2: StandardMaterial3D = sm[0]
		var base2: Color = sm[1]
		m2.albedo_color = Color(base2.r, base2.g, base2.b, base2.a * lerpf(1.0, 0.28, v))

## Ghost fade for remote cars near the camera (0 invisible .. 1 solid).
func set_opacity(a: float) -> void:
	if absf(a - _opacity) < 0.01:
		return
	_opacity = a
	for m in _fade_mats:
		var c: Color = m.albedo_color
		c.a = a * (0.5 if m.transparency == BaseMaterial3D.TRANSPARENCY_ALPHA else 1.0)
		m.albedo_color = c
	visible = a > 0.04

## Dent the body around a car-local impact point.
func dent(local_point: Vector3, direction: Vector3, amount: float) -> void:
	var radius := 0.45 + amount * 0.6
	var depth := minf(0.09, amount * 0.12)
	for mi: MeshInstance3D in _body_meshes:
		var key := mi.get_instance_id()
		var mesh := mi.mesh as ArrayMesh
		if mesh == null:
			continue
		if not _orig_arrays.has(key):
			# per-instance geometry: the mesh resource is shared between cars
			var copy := ArrayMesh.new()
			var arrays_all: Array = []
			for s in mesh.get_surface_count():
				var arr := mesh.surface_get_arrays(s)
				arrays_all.append(arr)
				copy.add_surface_from_arrays(mesh.surface_get_primitive_type(s), arr)
				copy.surface_set_material(s, mesh.surface_get_material(s))
			var mats: Array = []
			for s in mi.mesh.get_surface_count():
				mats.append(mi.get_surface_override_material(s))
			mi.mesh = copy
			for s in mats.size():
				mi.set_surface_override_material(s, mats[s])
			_orig_arrays[key] = arrays_all.map(func(a): return a.duplicate(true))
			mesh = copy
		# impact point into the mesh's local space
		var inv := mi.global_transform.affine_inverse() * global_transform
		var p := inv * local_point
		var dir := (inv.basis * direction).normalized()
		var r2 := radius * radius
		for s in mesh.get_surface_count():
			var arr := mesh.surface_get_arrays(s)
			var verts: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
			var touched := false
			for i in verts.size():
				var d2 := verts[i].distance_squared_to(p)
				if d2 > r2:
					continue
				var f := 1.0 - sqrt(d2) / radius
				var k := depth * f * f
				verts[i] += Vector3(dir.x * k, dir.y * k * 0.5, dir.z * k)
				touched = true
			if touched:
				arr[Mesh.ARRAY_VERTEX] = verts
				_rebuild_surface(mesh, s, arr, true)

func _rebuild_surface(mesh: ArrayMesh, s: int, arr: Array, recompute_normals: bool) -> void:
	var mat := mesh.surface_get_material(s)
	var prim := mesh.surface_get_primitive_type(s)
	if recompute_normals and arr[Mesh.ARRAY_INDEX] != null:
		var st := SurfaceTool.new()
		st.create_from_arrays(arr, prim)
		st.generate_normals()
		arr = st.commit_to_arrays()
	# replace the surface: rebuild the mesh without it, then re-add in place
	var all: Array = []
	for i in mesh.get_surface_count():
		all.append([mesh.surface_get_arrays(i) if i != s else arr, mesh.surface_get_primitive_type(i), mesh.surface_get_material(i)])
	mesh.clear_surfaces()
	for i in all.size():
		mesh.add_surface_from_arrays(all[i][1], all[i][0])
		mesh.surface_set_material(i, all[i][2] if i != s else mat)

func reset_damage() -> void:
	for mi: MeshInstance3D in _body_meshes:
		var key := mi.get_instance_id()
		if not _orig_arrays.has(key):
			continue
		var mesh := mi.mesh as ArrayMesh
		var orig: Array = _orig_arrays[key]
		for s in mesh.get_surface_count():
			_rebuild_surface(mesh, s, (orig[s] as Array).duplicate(false), false)

## Engine smoke at high damage. scene_root: where the sprites live (the world).
func update_smoke(dt: float, engine_damage: float, scene_root: Node) -> void:
	if engine_damage < 0.55:
		for s in _smoke:
			s.visible = false
		return
	if _smoke.is_empty():
		if _smoke_tex == null:
			_smoke_tex = GradientTexture2D.new()
			var g := Gradient.new()
			g.colors = PackedColorArray([Color(1, 1, 1, 0.8), Color(1, 1, 1, 0.0)])
			_smoke_tex.gradient = g
			_smoke_tex.fill = GradientTexture2D.FILL_RADIAL
			_smoke_tex.fill_from = Vector2(0.5, 0.5)
			_smoke_tex.fill_to = Vector2(1.0, 0.5)
			_smoke_tex.width = 64
			_smoke_tex.height = 64
		for i in 24:
			var sp := Sprite3D.new()
			sp.texture = _smoke_tex
			sp.billboard = BaseMaterial3D.BILLBOARD_ENABLED
			sp.modulate = Color(0.33, 0.33, 0.33, 0.0)
			sp.shaded = false
			sp.visible = false
			sp.pixel_size = 0.02
			sp.set_meta("age", 99.0)
			scene_root.add_child(sp)
			_smoke.append(sp)
	_smoke_t -= dt
	if _smoke_t <= 0.0:
		_smoke_t = 0.12 / engine_damage
		for sp in _smoke:
			if sp.get_meta("age") > 2.2:
				sp.set_meta("age", 0.0)
				sp.global_position = global_transform * Vector3(0, 0.9, float(entry.dims.length) * 0.32)
				sp.visible = true
				break
	for sp in _smoke:
		if not sp.visible:
			continue
		var age: float = sp.get_meta("age") + dt
		sp.set_meta("age", age)
		sp.global_position.y += dt * 1.2
		sp.scale = Vector3.ONE * (0.6 + age * 1.6)
		sp.modulate = Color(0.33, 0.33, 0.33, maxf(0.0, 0.45 * (1.0 - age / 2.2) * engine_damage))
		if age > 2.2:
			sp.visible = false

func dispose() -> void:
	for sp in _smoke:
		sp.queue_free()
	queue_free()
