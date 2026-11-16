class_name SafetyCarLook
extends Node3D
## The safety car's look (the Vantage GT3 model, docs/prompts/spa-and-cars-rebuild.md): race-control green (CarPaint,
## brand-free since 2026-11-16; shaders/safety_paint.gdshader before) and an SRO-style roof light bar, its amber lamps
## flashing in turn while the car is deployed, off while it waits in the pit lane.

const BAR_SIZE := Vector3(1.1, 0.07, 0.2)
const LAMPS := 6
const FLASH_HZ := 2.4

var active := false
var _lamps: Array = []
var _on_mat := StandardMaterial3D.new()
var _off_mat := StandardMaterial3D.new()
var _t := 0.0

## The safety car's paint (CarPaint): race-control green with a white stripe along the flanks, no number.
const LIVERY := {"base": "#0b5d3b", "accent": "#f2f2f2", "finish": "metallic", "design": "side", "number": 0, "showNumber": false, "numberColor": "#ffffff", "rims": "#1c1c1e", "calipers": "#ffd60a"}

## Applies the look to a safety car's visual (its root, the entry for the sizes).
static func dress(visual: Node3D, entry: Dictionary) -> SafetyCarLook:
	CarPaint.apply(visual as CarVisual, LIVERY)
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
