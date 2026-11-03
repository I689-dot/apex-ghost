class_name CarSpray
extends Node3D
## The spray a car throws up on a wet track (a mist trailing behind it, growing with speed and with the water on the
## road, as in the TV pictures of a wet race) and the burst of water when a wheel hits a puddle.

var _mist := GPUParticles3D.new()
var _splash := GPUParticles3D.new()
var _last := Vector3.ZERO
var _has_last := false
var speed := 0.0

static var _tex: Texture2D = null

static func _soft_texture() -> Texture2D:
	if _tex == null:
		var g := Gradient.new()
		g.set_color(0, Color(1, 1, 1, 1))
		g.set_color(1, Color(1, 1, 1, 0))
		var t := GradientTexture2D.new()
		t.gradient = g
		t.fill = GradientTexture2D.FILL_RADIAL
		t.fill_from = Vector2(0.5, 0.5)
		t.fill_to = Vector2(0.5, 0.0)
		t.width = 64
		t.height = 64
		_tex = t
	return _tex

static func _material(alpha: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.albedo_texture = _soft_texture()
	m.albedo_color = Color(0.82, 0.85, 0.88, alpha)
	m.vertex_color_use_as_albedo = true
	m.shading_mode = BaseMaterial3D.SHADING_MODE_PER_VERTEX
	m.disable_receive_shadows = true
	return m

func _init(length: float, width: float) -> void:
	# the mist: from the rear wheels, back and up, spreading and thinning out
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	pm.emission_box_extents = Vector3(width * 0.42, 0.08, 0.25)
	pm.direction = Vector3(0, 0.5, -1)
	pm.spread = 16.0
	pm.initial_velocity_min = 3.0
	pm.initial_velocity_max = 7.0
	pm.gravity = Vector3(0, -1.2, 0)
	pm.damping_min = 1.5
	pm.damping_max = 3.0
	pm.scale_min = 0.9
	pm.scale_max = 1.6
	var sc := Curve.new()
	sc.add_point(Vector2(0, 0.35))
	sc.add_point(Vector2(1, 1.8))
	var sct := CurveTexture.new()
	sct.curve = sc
	pm.scale_curve = sct
	var ramp := Gradient.new()
	ramp.set_color(0, Color(1, 1, 1, 0.0))
	ramp.add_point(0.12, Color(1, 1, 1, 0.58))
	ramp.set_color(ramp.get_point_count() - 1, Color(1, 1, 1, 0.0))
	var rt := GradientTexture1D.new()
	rt.gradient = ramp
	pm.color_ramp = rt
	_mist.process_material = pm
	var q := QuadMesh.new()
	q.size = Vector2(2.1, 2.1)
	q.material = _material(1.0)
	_mist.draw_pass_1 = q
	_mist.amount = 80
	_mist.lifetime = 1.1
	_mist.local_coords = false
	_mist.emitting = false
	_mist.position = Vector3(0, 0.25, -length * 0.45)
	_mist.visibility_aabb = AABB(Vector3(-8, -2, -30), Vector3(16, 8, 34))
	_mist.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_mist)
	# the splash: a short burst sideways and up, heavier drops falling back
	var sp := pm.duplicate() as ParticleProcessMaterial
	sp.emission_box_extents = Vector3(width * 0.5, 0.05, length * 0.35)
	sp.direction = Vector3(0, 1, -0.3)
	sp.spread = 70.0
	sp.initial_velocity_min = 3.0
	sp.initial_velocity_max = 8.0
	sp.gravity = Vector3(0, -7.0, 0)
	sp.damping_min = 0.5
	sp.damping_max = 1.0
	_splash.process_material = sp
	var q2 := QuadMesh.new()
	q2.size = Vector2(0.9, 0.9)
	q2.material = _material(1.0)
	_splash.draw_pass_1 = q2
	_splash.amount = 40
	_splash.lifetime = 0.9
	_splash.one_shot = true
	_splash.explosiveness = 0.85
	_splash.local_coords = false
	_splash.emitting = false
	_splash.position = Vector3(0, 0.15, 0)
	_splash.visibility_aabb = AABB(Vector3(-8, -2, -12), Vector3(16, 8, 24))
	_splash.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_splash)

## Every frame: the water on the road (0..1, as the weather's wetness) and whether this car is close enough to bother.
func update(dt: float, wetness: float, near: bool) -> void:
	var p := global_position
	if _has_last and dt > 0.0:
		speed = lerpf(speed, p.distance_to(_last) / dt, minf(1.0, dt * 6.0))
	_last = p
	_has_last = true
	var k := clampf((wetness - 0.08) * 1.6, 0.0, 1.0) * clampf((speed - 8.0) / 40.0, 0.0, 1.0)
	var on := near and k > 0.03
	if _mist.emitting != on:
		_mist.emitting = on
	if on:
		_mist.amount_ratio = k
		var pm := _mist.process_material as ParticleProcessMaterial
		pm.initial_velocity_min = 2.0 + speed * 0.06
		pm.initial_velocity_max = 4.0 + speed * 0.12

## A wheel went through a puddle (strength 0..1).
func splash(strength: float) -> void:
	_splash.amount_ratio = clampf(strength, 0.2, 1.0)
	_splash.restart()
