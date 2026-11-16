class_name CarVisual
extends Node3D
## A visible car (port of game/carVisual.ts): LOD levels instanced from the shared model, rigged wheels and steering,
## per-instance light materials, dents, ghost fading, headlights, smoke. Local axes: +X left, +Y up, +Z forward.

const WHEELS := ["FL", "FR", "RL", "RR"]
## Where a car's levels switch (x car_lod_scale), by their place in its list: the first up to 30 m, the second to 130 m,
## the third beyond. Other cars load lod1 and lod2 (Assets.load_car_model's first_level 1): lod1 near, lod2 from 30 m.
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
var _tail_mats: Array = [] # [StandardMaterial3D, share]
## Tail lamps in materials not named LIGHT_TAIL_ (by model id): the Vantage's are in its glass, the Ferrari's in an
## anonymous Sketchfab material (tools/godot/tail-lights.mjs gives them their glow map, --also).
const TAIL_LAMPS := {
	"vantage_gt3_evo_heart_of_racing": ["Glass"],
	"ferrari_296_gt3_verstappen": ["mat_50"],
}
## Rear lamp brightness (emission energy): off by day, lit with the headlights or at dusk, and the brake lights, which
## add to the tail lamps (the same LEDs, driven harder, as on the cars).
const TAIL_ON := 2.2
const BRAKE_ADD := 4.0
var _fade_mats: Array = [] # StandardMaterial3D (cloned)
var _glass_mats: Array = [] # [material, base colour] pairs for the cockpit dimming
var _strip_mats: Array = []
var _body_meshes: Array = [] # MeshInstance3D
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
## The last pose and brake light set (the replay records them).
var pose_steer := 0.0
var pose_rot_f := 0.0
var pose_rot_r := 0.0
var brake_on := false
## Your own car with the cockpit model: that model inside, the normal LOD0 seen from outside (set_inside).
var _inside_root: Node3D = null
var _outside_root: Node3D = null
var _inside = null
## True while the cockpit model's materials are prepared (InteriorLook applies to those only).
var _cockpit_pass := false

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
	var cache := {}
	for i in levels.size():
		var src: PackedScene = levels[i]
		if src == null:
			continue
		var root: Node3D = src.instantiate()
		_cockpit_pass = local and i == 0
		if _cockpit_pass and InteriorLook.BAKED_WHEELS.has(model_id(entry)):
			_cut_out_wheel(root, InteriorLook.BAKED_WHEELS[model_id(entry)])
		_prepare_materials(root, cache)
		_collect_parts(root)
		_cockpit_pass = false
		var rig := _rig(root)
		_levels.append(rig)
		add_child(root)
		if levels.size() > 1:
			# the ranges go by the level's place in the list, not its file: other cars start at lod1 (first 1), and
			# their nearest level must be drawn from 0 m (it took lod1's 30 m start: within 30 m x the preset's scale,
			# 120 m on Ultra, other cars were not drawn at all, and lod1 went on to 520 m)
			_set_lod_range(root, LOD_DIST[i] * car_lod_scale, (LOD_DIST[i + 1] * car_lod_scale) if i + 1 < levels.size() else 0.0)
		if i == 0:
			_add_body(root)
			_inside_root = root
	if local and outside != null:
		var root2: Node3D = outside.instantiate()
		_prepare_materials(root2, cache)
		_collect_parts(root2)
		_levels.append(_rig(root2))
		_add_body(root2)
		add_child(root2)
		_outside_root = root2
	_set_shadows(self)
	# after _set_shadows (which draws everything): from the seat only the cockpit model is drawn, the exterior one
	# just casts the car's shadow. Set before, it was undone and the exterior showed through the cockpit
	# (the Vantage's white door and pillars in front of its black interior).
	if _outside_root != null:
		set_inside(true)
	# remote cars always, and your own car when real spot lights are too expensive, get a projected light pool
	_make_light_pool()

## Moves a wheel modelled into the cockpit's "body" mesh to a node of its own (InteriorLook.BAKED_WHEELS), which _rig then
## turns with the steering. A triangle goes when all its corners are inside the wheel's box.
func _cut_out_wheel(root: Node3D, w: Dictionary) -> void:
	var body := root.find_child("body", true, false) as MeshInstance3D
	if body == null or body.mesh == null:
		return
	var to_root := DashDisplays._rel(body, root)
	var n: Vector3 = (w.axis as Vector3).normalized()
	var right := Vector3(-1, 0, 0)
	right = (right - n * right.dot(n)).normalized()
	var up := n.cross(right)
	var centre: Vector3 = w.centre
	var src: Mesh = body.mesh
	var kept := ArrayMesh.new()
	var rim := ArrayMesh.new()
	for s in src.get_surface_count():
		var arrays := src.surface_get_arrays(s)
		var mat := src.surface_get_material(s)
		var idx = arrays[Mesh.ARRAY_INDEX]
		if mat == null or not (w.materials as Array).has(mat.resource_name) or idx == null:
			kept.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
			kept.surface_set_material(kept.get_surface_count() - 1, mat)
			continue
		var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var inside := PackedByteArray()
		inside.resize(verts.size())
		for i in verts.size():
			var d: Vector3 = to_root * verts[i] - centre
			var a := d.dot(right)
			var b := d.dot(up)
			var c := d.dot(n)
			inside[i] = 1 if absf(a) < w.right and b > w.up[0] and b < w.up[1] and c > w.depth[0] and c < w.depth[1] else 0
		var stay := PackedInt32Array()
		var move := PackedInt32Array()
		for t in range(0, idx.size() - 2, 3):
			var i0: int = idx[t]
			var i1: int = idx[t + 1]
			var i2: int = idx[t + 2]
			var out := move if inside[i0] == 1 and inside[i1] == 1 and inside[i2] == 1 else stay
			out.append(i0)
			out.append(i1)
			out.append(i2)
		var rest := arrays.duplicate()
		rest[Mesh.ARRAY_INDEX] = stay
		kept.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, rest)
		kept.surface_set_material(kept.get_surface_count() - 1, mat)
		if move.is_empty():
			continue
		# the wheel's own mesh: vertices relative to its centre, in the model's scale
		var moved := arrays.duplicate()
		var pts := PackedVector3Array()
		pts.resize(verts.size())
		for i in verts.size():
			pts[i] = to_root * verts[i] - centre
		moved[Mesh.ARRAY_VERTEX] = pts
		moved[Mesh.ARRAY_INDEX] = move
		rim.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, moved)
		rim.surface_set_material(rim.get_surface_count() - 1, mat)
	if rim.get_surface_count() == 0:
		return
	body.mesh = kept
	var holder := Node3D.new()
	holder.name = "steering_rim"
	holder.position = centre
	var part := MeshInstance3D.new()
	part.name = "steering_mesh"
	part.mesh = rim
	holder.add_child(part)
	root.add_child(holder)
	# the wheel's real axis (the entry's is another point of the column)
	_steer_axis = n

## The cockpit model's root (what is seen from the driver's seat), or null.
func cockpit_root() -> Node3D:
	return _inside_root

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
## Parts a heavy hit can tear off (tools/godot/car-parts.mjs cuts them out of the body): name -> its mesh nodes on
## every level, and the parts already gone.
var _parts := {}
var detached := {}
## Debris in the world, from every car (the oldest goes past MAX_DEBRIS).
static var _debris: Array = []
const MAX_DEBRIS := 24
const DEBRIS_LIFE := 25.0
const DEBRIS_LAYER := 32

func _collect_parts(root: Node) -> void:
	for n in _walk(root):
		if n is MeshInstance3D and String(n.name).begins_with("part_"):
			var key := String(n.name).trim_prefix("part_")
			if not _parts.has(key):
				_parts[key] = []
			(_parts[key] as Array).append(n)

## The parts this car has: "bumper_front", "bumper_rear", "wing" (those its models were cut with).
func part_names() -> Array:
	return _parts.keys()

## Throws a part off (once): hidden on every level, and a piece of debris with its mesh and a box round it flies from
## where it was, with the car's velocity, the hit's push (world, m/s) and a tumble; it lands on the track and stays a
## while. scene_root: where the debris lives (the world, not the car).
func detach(part: String, car_velocity: Vector3, push: Vector3, scene_root: Node) -> void:
	if detached.has(part) or not _parts.has(part):
		return
	detached[part] = true
	var source: MeshInstance3D = null
	for mi: MeshInstance3D in _parts[part]:
		if source == null and mi.is_visible_in_tree():
			source = mi
		mi.visible = false
	if source == null:
		source = _parts[part][0]
	if not is_inside_tree() or source.mesh == null:
		return
	var aabb := source.mesh.get_aabb()
	if aabb.size.length() < 0.05:
		return
	var body := RigidBody3D.new()
	body.name = "debris-" + part
	body.collision_layer = DEBRIS_LAYER
	body.collision_mask = VehicleConsts.LAYER_TRACK | VehicleConsts.LAYER_WALL
	body.mass = clampf(aabb.size.x * aabb.size.y * aabb.size.z * 40.0, 3.0, 18.0)
	body.continuous_cd = true
	var pm := PhysicsMaterial.new()
	pm.friction = 0.7
	pm.bounce = 0.25
	body.physics_material_override = pm
	var mesh_node := MeshInstance3D.new()
	mesh_node.mesh = source.mesh
	for sidx in source.mesh.get_surface_count():
		mesh_node.set_surface_override_material(sidx, source.get_active_material(sidx))
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(maxf(0.05, aabb.size.x), maxf(0.05, aabb.size.y), maxf(0.05, aabb.size.z))
	cs.shape = box
	# the body's origin at the part's centre: the mesh and the box offset by it
	var c := aabb.get_center()
	mesh_node.position = -c
	body.add_child(mesh_node)
	body.add_child(cs)
	scene_root.add_child(body)
	var xf := source.global_transform
	body.global_transform = Transform3D(xf.basis, xf * c)
	body.linear_velocity = car_velocity * 0.9 + push + Vector3(0, 2.0 + randf() * 2.0, 0)
	body.angular_velocity = Vector3(randf_range(-6, 6), randf_range(-8, 8), randf_range(-6, 6))
	_debris.append(body)
	while _debris.size() > MAX_DEBRIS:
		var old = _debris.pop_front()
		if is_instance_valid(old):
			old.queue_free()
	var tree := get_tree()
	tree.create_timer(DEBRIS_LIFE).timeout.connect(func():
		if is_instance_valid(body):
			_debris.erase(body)
			body.queue_free())

## The parts back on (a reset, a repair in the pits).
func restore_parts() -> void:
	detached.clear()
	for key in _parts:
		for mi: MeshInstance3D in _parts[key]:
			mi.visible = true

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
	elif nm.begins_with("LIGHT_TAIL_") or (TAIL_LAMPS.get(model_id(entry), []) as Array).has(nm):
		# the glow map lights only the lamps (tools/godot/tail-lights.mjs: the red of the lamp atlas); a material named
		# as a tail lamp that has no glow (grey plastic, an amber indicator glass) is not one
		if sm.emission_texture != null or sm.emission != Color.BLACK:
			sm.emission_enabled = true
			# a deeper red: lit hard (braking) a lamp went pink-white in the tone mapping
			sm.emission = Color(sm.emission.r, sm.emission.g * 0.5, sm.emission.b * 0.5)
			# glass over a lamp adds to the lamp's own glow: half of it
			_tail_mats.append([sm, 0.5 if sm.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED else 1.0])
			sm.emission_energy_multiplier = 0.0
		elif sm.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED:
			# a smoked cover over the lamps (the BMW M4 Evo's, half opaque, hid them): it lets more of them through
			sm.albedo_color.a *= 0.45
	# an untextured opaque "glass" is really the untextured cabin shell: give it a dark trim colour
	if sm.transparency == BaseMaterial3D.TRANSPARENCY_DISABLED and sm.albedo_texture == null and _is_glass(nm):
		sm.albedo_color = Color("1b1d21")
		sm.roughness = 0.85
		sm.metallic = 0.0
	_apply_look(sm)
	InteriorLook.apply_generic(model_id(entry), sm)
	if _cockpit_pass:
		InteriorLook.apply(model_id(entry), sm)
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
	pose_steer = steer
	pose_rot_f = rot_f
	pose_rot_r = rot_r
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

## Tests: the lights held as given ("brake", "tail" for lit rear lamps without braking, "off"); "" plays normally.
static var test_lights := ""

func set_lights(brake: bool, headlights_on: bool, night: float) -> void:
	if test_lights != "":
		brake = test_lights == "brake"
		headlights_on = test_lights == "tail"
	brake_on = brake
	var tail := (TAIL_ON if headlights_on or night > 0.3 else 0.0) + (BRAKE_ADD if brake else 0.0)
	for t in _tail_mats:
		(t[0] as StandardMaterial3D).emission_energy_multiplier = tail * float(t[1])
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

## Dent the body around a car-local impact point: the impact is kept (up to MAX_DENTS, a hit near an earlier one
## deepens it) for the paint shader, which moves the body's vertices on the GPU (apply_dents). The dents used to be
## made on the CPU, copying the body's geometry and moving every vertex in GDScript: 0.5-2.3 s a hit with the
## full-detail cars, the freeze on a crash.
const MAX_DENTS := 8
var dents: Array = [] # [Vector4(point.xyz, radius), Vector4(direction.xyz, depth)] in car space

func dent(local_point: Vector3, direction: Vector3, amount: float) -> void:
	var radius := 0.45 + amount * 0.6
	var depth := minf(0.09, amount * 0.12)
	var dir := direction.normalized()
	for d in dents:
		var p0 := Vector3(d[0].x, d[0].y, d[0].z)
		if p0.distance_to(local_point) < float(d[0].w) * 0.6:
			d[0].w = maxf(float(d[0].w), radius)
			d[1].w = minf(0.12, float(d[1].w) + depth * 0.5)
			apply_dents()
			return
	if dents.size() >= MAX_DENTS:
		# the shallowest goes
		var k := 0
		for i in dents.size():
			if float(dents[i][1].w) < float(dents[k][1].w):
				k = i
		dents.remove_at(k)
	dents.append([Vector4(local_point.x, local_point.y, local_point.z, radius), Vector4(dir.x, dir.y, dir.z, depth)])
	apply_dents()

## Hands the dents to the car's paint materials (the ones with the dent uniforms), in each body mesh's own space.
func apply_dents() -> void:
	for mi: MeshInstance3D in _body_meshes:
		if mi.mesh == null:
			continue
		var inv := mi.global_transform.affine_inverse() * global_transform
		var pts := PackedVector4Array()
		var dirs := PackedVector4Array()
		for i in MAX_DENTS:
			if i < dents.size():
				var p := inv * Vector3(dents[i][0].x, dents[i][0].y, dents[i][0].z)
				var dv := (inv.basis * Vector3(dents[i][1].x, dents[i][1].y, dents[i][1].z)).normalized()
				pts.append(Vector4(p.x, p.y, p.z, dents[i][0].w))
				dirs.append(Vector4(dv.x, dv.y, dv.z, dents[i][1].w))
			else:
				pts.append(Vector4.ZERO)
				dirs.append(Vector4.ZERO)
		for s in mi.mesh.get_surface_count():
			var m := mi.get_active_material(s) as ShaderMaterial
			if m != null and m.shader != null and m.shader.code.contains("dent_p"):
				m.set_shader_parameter("dent_p", pts)
				m.set_shader_parameter("dent_d", dirs)

func reset_damage() -> void:
	dents.clear()
	apply_dents()
	restore_parts()

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

## The id of the model a car entry draws: its own, or the one it shares (the safety car is the Vantage GT3: "model").
## Per-model fixes (InteriorLook, DashDisplay.OVERLAYS) are keyed by it.
static func model_id(e: Dictionary) -> String:
	return str(e.get("model", e.get("id", "")))

