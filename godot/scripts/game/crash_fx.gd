class_name CrashFx
extends Node3D
## What a crash leaves, as the sims show it (port of game/crashFx.ts): a shower of sparks where bodywork scrapes a wall
## or another car (additive, short-lived, flung with the car's speed and falling), and pieces of carbon and bodywork
## that tumble off, bounce on the road and stay there for a while before they are cleared. Pools of fixed size: a big
## crash recycles the oldest pieces.

const SPARKS := 320
const DEBRIS := 90
const G := 9.81

var _spark_pos := PackedVector3Array()
var _spark_vel := PackedVector3Array()
var _spark_life := PackedFloat32Array()
var _spark_next := 0
var _spark_mesh := ImmediateMesh.new()
var _debris: MultiMesh
var _d_pos := PackedVector3Array()
var _d_vel := PackedVector3Array()
var _d_rot := PackedVector3Array()
var _d_spin := PackedVector3Array()
var _d_scale := PackedVector3Array()
var _d_ground := PackedFloat32Array()
var _d_age := PackedFloat32Array()
var _d_next := 0
var _alive_sparks := 0

func _init() -> void:
	_spark_pos.resize(SPARKS)
	_spark_vel.resize(SPARKS)
	_spark_life.resize(SPARKS)
	_d_pos.resize(DEBRIS)
	_d_vel.resize(DEBRIS)
	_d_rot.resize(DEBRIS)
	_d_spin.resize(DEBRIS)
	_d_scale.resize(DEBRIS)
	_d_ground.resize(DEBRIS)
	_d_age.resize(DEBRIS)
	_d_age.fill(1e9)
	var sm := StandardMaterial3D.new()
	sm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	sm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	sm.albedo_color = Color(1.0, 0.75, 0.44, 0.95)
	sm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	sm.no_depth_test = false
	sm.disable_fog = true
	var sparks := MeshInstance3D.new()
	sparks.mesh = _spark_mesh
	sparks.material_override = sm
	sparks.custom_aabb = AABB(Vector3(-20000, -2000, -20000), Vector3(40000, 4000, 40000))
	sparks.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(sparks)
	var box := BoxMesh.new()
	box.size = Vector3.ONE
	var dm := StandardMaterial3D.new()
	dm.albedo_color = Color("1b1d21")
	dm.roughness = 0.55
	dm.metallic = 0.2
	dm.vertex_color_use_as_albedo = true
	box.material = dm
	_debris = MultiMesh.new()
	_debris.transform_format = MultiMesh.TRANSFORM_3D
	_debris.use_colors = true
	_debris.mesh = box
	_debris.instance_count = DEBRIS
	_debris.visible_instance_count = 0
	var dmi := MultiMeshInstance3D.new()
	dmi.multimesh = _debris
	dmi.custom_aabb = AABB(Vector3(-20000, -2000, -20000), Vector3(40000, 4000, 40000))
	add_child(dmi)
	for i in DEBRIS:
		_debris.set_instance_transform(i, Transform3D(Basis.from_scale(Vector3.ZERO), Vector3.ZERO))

## A hit at world point p: severity 0…1, the car's velocity (m/s), the direction the hit pushed it (unit), the ground
## height under it, the car's paint (some debris is bodywork, the rest carbon).
func hit(p: Vector3, severity: float, vel: Vector3, push: Vector3, ground_y: float, paint: Variant) -> void:
	var n := roundi(30.0 + 160.0 * severity)
	for k in n:
		var i := _spark_next
		_spark_next = (i + 1) % SPARKS
		_spark_pos[i] = p
		# scraped along with the car, sprayed out sideways and up
		var sp := 3.0 + randf() * 9.0
		_spark_vel[i] = Vector3(vel.x * 0.7 + push.x * -sp + (randf() - 0.5) * 6.0, 1.0 + randf() * 4.0, vel.z * 0.7 + push.z * -sp + (randf() - 0.5) * 6.0)
		_spark_life[i] = 0.25 + randf() * 0.6
	# pieces only from real impacts
	var pieces := 0 if severity < 0.12 else roundi(3.0 + 18.0 * severity)
	for k in pieces:
		var i := _d_next
		_d_next = (i + 1) % DEBRIS
		_d_pos[i] = Vector3(p.x + (randf() - 0.5) * 0.6, p.y + randf() * 0.3, p.z + (randf() - 0.5) * 0.6)
		_d_vel[i] = Vector3(vel.x * (0.5 + randf() * 0.4) - push.x * (2.0 + randf() * 4.0), 1.5 + randf() * 3.5, vel.z * (0.5 + randf() * 0.4) - push.z * (2.0 + randf() * 4.0))
		_d_rot[i] = Vector3(randf() * 6.0, randf() * 6.0, randf() * 6.0)
		_d_spin[i] = Vector3((randf() - 0.5) * 20.0, (randf() - 0.5) * 20.0, (randf() - 0.5) * 20.0)
		# splinters of carbon and flakes of bodywork: long and thin
		var big := 1.8 if randf() < 0.1 else 1.0
		_d_scale[i] = Vector3((0.04 + randf() * 0.12) * big, 0.008 + randf() * 0.012, (0.03 + randf() * 0.08) * big)
		_d_ground[i] = ground_y
		_d_age[i] = 0.0
		_debris.set_instance_color(i, paint if (paint != null and randf() < 0.45) else Color("1b1d21"))

func update(dt: float) -> void:
	# sparks: ballistic, dying out
	var any := false
	for i in SPARKS:
		if _spark_life[i] > 0.0:
			any = true
			break
	if any or _alive_sparks > 0:
		_spark_mesh.clear_surfaces()
		_spark_mesh.surface_begin(Mesh.PRIMITIVE_LINES)
		var live := 0
		for i in SPARKS:
			if _spark_life[i] <= 0.0:
				continue
			_spark_life[i] -= dt
			var v := _spark_vel[i]
			v.y -= G * dt
			_spark_vel[i] = v
			_spark_pos[i] += v * dt
			# a 1/60 s exposure: the streak's length is its speed
			_spark_mesh.surface_add_vertex(_spark_pos[i])
			_spark_mesh.surface_add_vertex(_spark_pos[i] - v * 0.016)
			live += 1
		if live == 0:
			_spark_mesh.surface_add_vertex(Vector3(0, -1e4, 0))
			_spark_mesh.surface_add_vertex(Vector3(0, -1e4, 0))
		_spark_mesh.surface_end()
		_alive_sparks = live
	# debris: tumbles, bounces, slides to rest on the road; cleared after a minute
	var live_d := 0
	for i in DEBRIS:
		_d_age[i] += dt
		var age := _d_age[i]
		if age > 60.0:
			_debris.set_instance_transform(i, Transform3D(Basis.from_scale(Vector3.ZERO), Vector3.ZERO))
			continue
		live_d = i + 1
		var pos := _d_pos[i]
		var vel := _d_vel[i]
		var spin := _d_spin[i]
		var rot := _d_rot[i]
		var on_ground := pos.y <= _d_ground[i] + 0.01
		if not on_ground:
			vel.y -= G * dt
		pos += vel * dt
		if pos.y < _d_ground[i] + 0.01:
			pos.y = _d_ground[i] + 0.01
			# a bounce, then friction on the asphalt
			vel.y = -vel.y * 0.3 if absf(vel.y) > 1.5 else 0.0
			var f := maxf(0.0, 1.0 - dt * 3.5)
			vel.x *= f
			vel.z *= f
			spin *= f
			# lying flat once it stops
			if Vector2(vel.x, vel.z).length() < 0.2:
				rot.x *= 1.0 - minf(1.0, dt * 4.0)
				rot.z *= 1.0 - minf(1.0, dt * 4.0)
		rot += spin * dt
		_d_pos[i] = pos
		_d_vel[i] = vel
		_d_spin[i] = spin
		_d_rot[i] = rot
		var fade := maxf(0.001, (60.0 - age) / 5.0) if age > 55.0 else 1.0
		var sc := _d_scale[i] * fade
		var basis := Basis.from_euler(rot) * Basis.from_scale(sc)
		_debris.set_instance_transform(i, Transform3D(basis, pos))
	_debris.visible_instance_count = live_d
