class_name IntroCinematic
extends Node3D
## The opening titles while the game starts (after GT's and Forza's): a GT3 car in a dark studio on a glossy floor,
## lit by a key light that fades up, a cool rim light and a red light bar sweeping past; four camera moves cut through
## black (low front three-quarter dolly, side tracking at wheel height, rear crane, head-on pull back) with the car's
## name as a TV caption, then the logo. A tap or a key skips it. finished() fires when it is over.

signal finished

const SHOT_S := 2.4
const CUT_S := 0.18

var _car: CarVisual
var _cam := Camera3D.new()
var _key := SpotLight3D.new()
var _rim := SpotLight3D.new()
var _bar := OmniLight3D.new()
var _bar_mesh := MeshInstance3D.new()
var _ui := Control.new()
var _fade := ColorRect.new()
var _caption := VBoxContainer.new()
var _logo: Control
var _len := 4.6
var _done := false

func _init(entry: Dictionary) -> void:
	_len = float(entry.dims.length)
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.008, 0.009, 0.012)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.32, 0.36, 0.45)
	env.ambient_light_energy = 0.18
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_exposure = 1.1
	env.glow_enabled = true
	env.glow_intensity = 0.7
	env.glow_bloom = 0.08
	env.glow_hdr_threshold = 1.1
	env.fog_enabled = true
	env.fog_light_color = Color(0.008, 0.009, 0.012)
	env.fog_density = 0.035
	env.fog_sky_affect = 0.0
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	# the studio floor: dark, glossy, fading into the fog
	var floor_mi := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(80, 80)
	floor_mi.mesh = pm
	var fm := StandardMaterial3D.new()
	fm.albedo_color = Color(0.035, 0.037, 0.042)
	fm.roughness = 0.18
	fm.metallic = 0.4
	fm.metallic_specular = 0.7
	floor_mi.material_override = fm
	add_child(floor_mi)
	# the car
	var model := Assets.load_car_model(entry, 1, false)
	_car = CarVisual.new(entry, model, false)
	add_child(_car)
	_car.add_headlights(false)
	_car.set_lights(false, true, 1.0)
	# lights: a warm key above the front, a cool rim behind, a red bar sweeping along the side
	_key.light_color = Color(1.0, 0.95, 0.88)
	_key.spot_range = 30.0
	_key.spot_angle = 38.0
	_key.spot_angle_attenuation = 0.6
	_key.shadow_enabled = true
	_key.light_energy = 0.0
	add_child(_key)
	_key.look_at_from_position(Vector3(2.5, 6.0, 4.0), Vector3(0, 0.4, 0), Vector3.UP)
	_rim.light_color = Color(0.55, 0.7, 1.0)
	_rim.spot_range = 30.0
	_rim.spot_angle = 45.0
	_rim.light_energy = 9.0
	add_child(_rim)
	_rim.look_at_from_position(Vector3(-3.0, 3.5, -6.0), Vector3(0, 0.6, 0), Vector3.UP)
	_bar.light_color = Color(1.0, 0.12, 0.08)
	_bar.omni_range = 5.0
	_bar.light_energy = 4.0
	add_child(_bar)
	var bm := BoxMesh.new()
	bm.size = Vector3(0.06, 0.06, 2.4)
	_bar_mesh.mesh = bm
	var em := StandardMaterial3D.new()
	em.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	em.albedo_color = Color(1.0, 0.15, 0.1)
	em.emission_enabled = true
	em.emission = Color(1.0, 0.15, 0.1)
	em.emission_energy_multiplier = 6.0
	_bar_mesh.material_override = em
	add_child(_bar_mesh)
	_cam.fov = 38.0
	_cam.current = true
	add_child(_cam)
	# 2D over it: the caption, the logo, the cuts to black and the skip hint
	UIKit.full(_ui)
	_ui.mouse_filter = Control.MOUSE_FILTER_STOP
	_caption.position = Vector2(48, 0)
	_caption.add_theme_constant_override("separation", 0)
	_caption.add_child(UIKit.label(I18n.t(entry.category).to_upper(), 16, UIKit.ACCENT_2, true, 700))
	_caption.add_child(UIKit.label(str(entry.name).to_upper(), 34, Color.WHITE, true, 800))
	_caption.modulate.a = 0.0
	_ui.add_child(_caption)
	var center := CenterContainer.new()
	UIKit.full(center)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var lc := UIW.vbox(4)
	lc.alignment = BoxContainer.ALIGNMENT_CENTER
	lc.add_child(UIW.logo(72))
	var tag := UIKit.label(I18n.t("GT3 · Nürburgring · Spa · Zandvoort"), 18, UIKit.MUTED, true, 600)
	tag.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lc.add_child(tag)
	center.add_child(lc)
	_logo = center
	_logo.modulate.a = 0.0
	_ui.add_child(_logo)
	var hint := UIKit.label(I18n.t("Tap or press any key to skip"), 14, Color(1, 1, 1, 0.45))
	hint.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	hint.offset_left = -300
	hint.offset_top = -40
	hint.offset_right = -24
	hint.offset_bottom = -16
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_ui.add_child(hint)
	_fade.color = Color.BLACK
	UIKit.full(_fade)
	_fade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_ui.add_child(_fade)
	_ui.gui_input.connect(func(e): if (e is InputEventMouseButton or e is InputEventScreenTouch) and e.pressed: finish())

## The 2D layer (caption, logo, fades): the app puts it on its overlay layer.
func overlay() -> Control:
	return _ui

func _unhandled_input(e: InputEvent) -> void:
	if (e is InputEventKey or e is InputEventJoypadButton) and e.is_pressed():
		finish()

func play() -> void:
	var L := _len
	# each shot: camera from -> to (position, look target), the bar's sweep, and what shows in 2D
	var shots := [
		{"from": [Vector3(3.2, 0.45, L * 0.95), Vector3(0, 0.55, 0.4)], "to": [Vector3(2.3, 0.55, L * 0.7), Vector3(0, 0.6, 0.2)], "fov": 36.0},
		{"from": [Vector3(3.4, 0.5, L * 0.6), Vector3(0, 0.5, L * 0.35)], "to": [Vector3(3.4, 0.5, -L * 0.6), Vector3(0, 0.5, -L * 0.35)], "fov": 30.0, "caption": true},
		{"from": [Vector3(-2.8, 0.6, -L * 0.85), Vector3(0, 0.5, -0.4)], "to": [Vector3(-3.4, 2.6, -L * 1.05), Vector3(0, 0.4, 0)], "fov": 40.0, "caption": true},
		{"from": [Vector3(0, 0.7, L * 0.95), Vector3(0, 0.55, 0)], "to": [Vector3(0, 1.1, L * 2.1), Vector3(0, 0.6, 0)], "fov": 34.0, "logo": true},
	]
	var tw := create_tween()
	tw.tween_property(_fade, "color:a", 0.0, 0.6)
	tw.parallel().tween_property(_key, "light_energy", 14.0, 1.6).set_trans(Tween.TRANS_SINE)
	for i in shots.size():
		var sh: Dictionary = shots[i]
		tw.tween_callback(func(): _place(sh.from[0], sh.from[1], sh.fov))
		if i > 0:
			tw.tween_property(_fade, "color:a", 0.0, CUT_S)
		tw.tween_method(func(f: float): _place(sh.from[0].lerp(sh.to[0], f), sh.from[1].lerp(sh.to[1], f), sh.fov); _sweep(i, f), 0.0, 1.0, SHOT_S + (1.2 if sh.get("logo", false) else 0.0)).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
		if sh.get("caption", false):
			tw.parallel().tween_property(_caption, "modulate:a", 1.0, 0.5)
		elif i == shots.size() - 1:
			tw.parallel().tween_property(_caption, "modulate:a", 0.0, 0.3)
		if sh.get("logo", false):
			tw.parallel().tween_property(_logo, "modulate:a", 1.0, 0.9).set_delay(0.6)
		if i < shots.size() - 1:
			tw.tween_property(_fade, "color:a", 1.0, CUT_S)
	tw.tween_property(_fade, "color:a", 1.0, 0.5)
	tw.tween_callback(finish)

func _place(pos: Vector3, look: Vector3, fov: float) -> void:
	_cam.fov = fov
	_cam.position = pos
	_cam.look_at(look, Vector3.UP)
	var vp := _ui.get_viewport_rect().size if _ui.is_inside_tree() else Vector2(1280, 720)
	_caption.position = Vector2(48, vp.y - 140)

func _sweep(shot: int, f: float) -> void:
	# the light bar runs along the car's side, the other way on each shot
	var z := lerpf(-_len, _len, f if shot % 2 == 0 else 1.0 - f)
	var x := 1.9 if shot != 2 else -1.9
	_bar.position = Vector3(x, 0.35, z)
	_bar_mesh.position = Vector3(x * 1.5, 0.05, z)

func finish() -> void:
	if _done:
		return
	_done = true
	finished.emit()
