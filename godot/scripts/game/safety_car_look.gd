class_name SafetyCarLook
extends Node3D
## The safety car's look (the Vantage GT3 model, docs/prompts/spa-and-cars-rebuild.md): its livery in the safety car's
## green (shaders/safety_paint.gdshader on the "Body" material) and an SRO-style roof light bar, its amber lamps
## flashing in turn while the car is deployed, off while it waits in the pit lane.

const BAR_SIZE := Vector3(1.1, 0.07, 0.2)
const LAMPS := 6
const FLASH_HZ := 2.4

var active := false
var _lamps: Array = []
var _on_mat := StandardMaterial3D.new()
var _off_mat := StandardMaterial3D.new()
var _t := 0.0

## Applies the look to a safety car's visual (its root, the entry for the sizes).
static func dress(visual: Node3D, entry: Dictionary) -> SafetyCarLook:
	var shader: Shader = load("res://shaders/safety_paint.gdshader")
	for n in CarVisual._walk(visual):
		if not (n is MeshInstance3D) or (n as MeshInstance3D).mesh == null:
			continue
		var mi := n as MeshInstance3D
		for s in mi.mesh.get_surface_count():
			var m := mi.get_active_material(s) as StandardMaterial3D
			if m == null or m.resource_name != "Body" or m.albedo_texture == null:
				continue
			var sm := ShaderMaterial.new()
			sm.shader = shader
			sm.set_shader_parameter("livery", m.albedo_texture)
			mi.set_surface_override_material(s, sm)
	var look := SafetyCarLook.new()
	look.name = "safety-look"
	var dims: Dictionary = entry.get("dims", {})
	var cam: Dictionary = entry.get("cockpitCamera", {})
	var eye: Array = cam.get("position", [0.33, 0.97, -0.3])
	# on the roof, a little behind the driver's eye
	look.position = Vector3(0.0, float(dims.get("height", 1.22)) + BAR_SIZE.y * 0.5 - 0.01, float(eye[2]) - 0.15)
	look._build()
	visual.add_child(look)
	return look

func _build() -> void:
	var base := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = BAR_SIZE
	base.mesh = bm
	var black := StandardMaterial3D.new()
	black.albedo_color = Color(0.03, 0.03, 0.035)
	black.roughness = 0.4
	base.material_override = black
	add_child(base)
	_on_mat.albedo_color = Color(1.0, 0.55, 0.05)
	_on_mat.emission_enabled = true
	_on_mat.emission = Color(1.0, 0.5, 0.05)
	_on_mat.emission_energy_multiplier = 6.0
	_off_mat.albedo_color = Color(0.35, 0.2, 0.06)
	_off_mat.roughness = 0.2
	var w := BAR_SIZE.x / LAMPS
	for i in LAMPS:
		var lamp := MeshInstance3D.new()
		var lm := BoxMesh.new()
		lm.size = Vector3(w * 0.8, BAR_SIZE.y * 0.8, BAR_SIZE.z * 1.02)
		lamp.mesh = lm
		lamp.position = Vector3(-BAR_SIZE.x * 0.5 + w * (i + 0.5), 0.005, 0.0)
		lamp.material_override = _off_mat
		lamp.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(lamp)
		_lamps.append(lamp)

func _process(dt: float) -> void:
	_t += dt
	# the two halves flash in turn
	var phase := int(_t * FLASH_HZ * 2.0) % 2
	for i in _lamps.size():
		var lit: bool = active and ((i < LAMPS / 2) == (phase == 0))
		(_lamps[i] as MeshInstance3D).material_override = _on_mat if lit else _off_mat
