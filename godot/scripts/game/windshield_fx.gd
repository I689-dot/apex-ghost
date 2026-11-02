class_name WindshieldFx
extends Control
## Rain droplets on the windshield (shaders/windshield.gdshader) and the crack a hard front hit leaves (port of
## WindshieldFx in game/environment.ts), full-screen layers behind the HUD, cockpit view only. No wipers: the drops
## stay, the airflow moves them.

var _rain: ColorRect
var _crack: CrackLayer
var _mat := ShaderMaterial.new()
var _time := 0.0

func _init() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	UIKit.full(self)
	_rain = ColorRect.new()
	UIKit.full(_rain)
	_rain.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_mat.shader = load("res://shaders/windshield.gdshader")
	_rain.material = _mat
	_rain.visible = false
	add_child(_rain)
	_crack = CrackLayer.new()
	UIKit.full(_crack)
	_crack.visible = false
	add_child(_crack)

func update_fx(dt: float, rain: float, speed: float, aspect: float, light: float, looking_forward: bool) -> void:
	_time += dt
	_mat.set_shader_parameter("u_time", _time)
	_mat.set_shader_parameter("u_rain", minf(0.85, rain * 0.9))
	_mat.set_shader_parameter("u_speed", minf(1.0, speed / 45.0))
	_mat.set_shader_parameter("u_aspect", aspect)
	_mat.set_shader_parameter("u_light", light)
	_rain.visible = rain > 0.02 and looking_forward

func set_crack(front_damage: float, looking_forward: bool) -> void:
	var o := clampf((front_damage - 0.25) * 1.6, 0.0, 0.85)
	_crack.modulate.a = o
	_crack.visible = o > 0.01 and looking_forward

## The star-shaped crack of a stone hit (drawn from the web game's crackTexture, 1024 × 512 canvas units).
class CrackLayer:
	extends Control
	var _lines: Array = []

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		var seed_v := 42
		var rnd := func() -> float:
			seed_v = (seed_v * 16807) % 2147483647
			return seed_v / 2147483647.0
		var cx := 700.0
		var cy := 170.0
		for i in 26:
			var x := cx
			var y := cy
			var a: float = rnd.call() * TAU
			var pts := PackedVector2Array([Vector2(x, y)])
			var len: float = 8.0 + rnd.call() * 14.0
			for s in int(len):
				a += (rnd.call() - 0.5) * 0.6
				x += cos(a) * 18.0
				y += sin(a) * 18.0
				pts.append(Vector2(x, y))
			_lines.append([pts, 1.6])
		var r := 18.0
		while r < 120.0:
			var pts := PackedVector2Array()
			for k in 25:
				var a := (k / 24.0) * TAU
				var rr: float = r * (0.8 + rnd.call() * 0.4)
				pts.append(Vector2(cx + cos(a) * rr, cy + sin(a) * rr))
			_lines.append([pts, 1.0])
			r += 26.0

	func _draw() -> void:
		var k := Vector2(size.x / 1024.0, size.y / 512.0)
		for l in _lines:
			var pts := PackedVector2Array()
			for p in l[0]:
				pts.append(p * k)
			draw_polyline(pts, Color(0.92, 0.94, 0.96, 0.75), l[1] * maxf(1.0, k.x), true)
