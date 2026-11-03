class_name WetFx
extends Node3D
## Water on a wet track: puddles where the rain gathers (low points of the lap and the edges of the road, more of them
## and bigger as the track gets wetter), drawn as still water with rain rings, felt by the tyres (aquaplaning), and the
## spray thrown up behind every car with speed, a burst of it where a wheel hits a puddle.

## A puddle: centre, half-lengths along / across the road (m), its heading and how deep it gets (0..1 of ~8 mm).
class Puddle:
	extends RefCounted
	var x: float
	var y: float
	var z: float
	var a: float
	var b: float
	var yaw: float
	var depth: float
	var basis: Basis

## Water is on the road above this wetness; puddles grow to full size at FULL.
const START := 0.35
const FULL := 0.85
const CELL := 8.0

var puddles: Array = []
var level := 0.0
var _cells := {}
var _mm := MultiMeshInstance3D.new()
var _mat := ShaderMaterial.new()

## ground: Callable(x, y_top, z, max_d) -> height or null (GroundQuery.height_below).
func build(td: Dictionary, ground: Callable, seed_value: int) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_value
	var cl: Array = td.centerline
	var cum: Array = td.cumS
	var n := cl.size() / 3
	var wl: Array = td.get("widthL", [])
	var wr: Array = td.get("widthR", [])
	var last_s := -1e9
	for i in n:
		var s: float = cum[i]
		if s - last_s < 28.0:
			continue
		last_s = s
		# where the lap dips (the lowest point within 60 m either side) water gathers; elsewhere now and then
		var y: float = cl[i * 3 + 1]
		var low := true
		for k in range(-12, 13):
			var j := posmod(i + k * 2, n)
			if cl[j * 3 + 1] < y - 0.05:
				low = false
				break
		if rng.randf() > (0.85 if low else 0.16):
			continue
		var j2 := (i + 1) % n
		var tx: float = cl[j2 * 3] - cl[i * 3]
		var tz: float = cl[j2 * 3 + 2] - cl[i * 3 + 2]
		var tl := maxf(0.001, sqrt(tx * tx + tz * tz))
		tx /= tl
		tz /= tl
		var half_l: float = float(wl[i]) if i < wl.size() else 6.0
		var half_r: float = float(wr[i]) if i < wr.size() else 6.0
		# mostly by the edges (camber drains there), sometimes on the racing line
		var side := -1.0 if rng.randf() < 0.5 else 1.0
		var edge: float = (half_l if side < 0.0 else half_r)
		var lat := side * edge * (rng.randf_range(0.55, 0.9) if rng.randf() < 0.75 else rng.randf_range(0.0, 0.5))
		var p := Puddle.new()
		p.x = cl[i * 3] + tz * lat
		p.z = cl[i * 3 + 2] - tx * lat
		var h = ground.call(p.x, cl[i * 3 + 1] + 2.0, p.z, 5.0)
		if h == null:
			continue
		p.y = float(h)
		p.a = rng.randf_range(1.6, 4.5) * (1.4 if low else 1.0)
		p.b = rng.randf_range(0.8, 2.0) * (1.3 if low else 1.0)
		p.yaw = atan2(tx, tz)
		p.depth = rng.randf_range(0.35, 0.8) * (1.3 if low else 1.0)
		# the surface under it: a plane through the ground at its ends and sides
		var fwd := Vector3(sin(p.yaw), 0, cos(p.yaw))
		var right := Vector3(fwd.z, 0, -fwd.x)
		var hf = ground.call(p.x + fwd.x * p.a, p.y + 1.0, p.z + fwd.z * p.a, 3.0)
		var hb = ground.call(p.x - fwd.x * p.a, p.y + 1.0, p.z - fwd.z * p.a, 3.0)
		var hr = ground.call(p.x + right.x * p.b, p.y + 1.0, p.z + right.z * p.b, 3.0)
		var hl = ground.call(p.x - right.x * p.b, p.y + 1.0, p.z - right.z * p.b, 3.0)
		var df: float = (float(hf) - float(hb)) / (2.0 * p.a) if hf != null and hb != null else 0.0
		var dr: float = (float(hr) - float(hl)) / (2.0 * p.b) if hr != null and hl != null else 0.0
		var ax := (fwd + Vector3.UP * df).normalized()
		var ar := (right + Vector3.UP * dr).normalized()
		var up := ax.cross(ar).normalized()
		if up.y < 0.0:
			up = -up
		p.basis = Basis(ar, up, ax)
		puddles.append(p)
	for k in puddles.size():
		var q: Puddle = puddles[k]
		var r := maxf(q.a, q.b)
		for gx in range(floori((q.x - r) / CELL), floori((q.x + r) / CELL) + 1):
			for gz in range(floori((q.z - r) / CELL), floori((q.z + r) / CELL) + 1):
				var key := Vector2i(gx, gz)
				if not _cells.has(key):
					_cells[key] = []
				_cells[key].append(k)
	_build_mesh()

func _build_mesh() -> void:
	var quad := QuadMesh.new()
	quad.size = Vector2(2, 2)
	quad.orientation = PlaneMesh.FACE_Y
	_mat.shader = load("res://shaders/puddle.gdshader")
	quad.material = _mat
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_custom_data = true
	mm.mesh = quad
	mm.instance_count = puddles.size()
	for k in puddles.size():
		var p: Puddle = puddles[k]
		var b := p.basis.scaled_local(Vector3(p.b, 1.0, p.a))
		mm.set_instance_transform(k, Transform3D(b, Vector3(p.x, p.y + 0.012, p.z)))
		mm.set_instance_custom_data(k, Color(p.depth, randf(), 0, 0))
	_mm.multimesh = mm
	_mm.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_mm.visible = false
	add_child(_mm)

## Wetness (0..1) and rain (0..1) now: how much of each puddle is there.
func set_weather(wetness: float, rain: float) -> void:
	level = clampf((wetness - START) / (FULL - START), 0.0, 1.0)
	_mm.visible = level > 0.01
	_mat.set_shader_parameter("level", level)
	_mat.set_shader_parameter("rain", rain)

## Water under (x, z): 0 (dry) .. ~1 (the deep middle of a full puddle).
func depth_at(x: float, z: float) -> float:
	if level <= 0.0:
		return 0.0
	var l: Array = _cells.get(Vector2i(floori(x / CELL), floori(z / CELL)), [])
	var best := 0.0
	for k in l:
		var p: Puddle = puddles[k]
		var dx := x - p.x
		var dz := z - p.z
		var c := cos(p.yaw)
		var s := sin(p.yaw)
		var along := dx * s + dz * c
		var across := dx * c - dz * s
		# the puddle grows from its middle as the track gets wetter
		var ea := p.a * (0.35 + 0.65 * level)
		var eb := p.b * (0.35 + 0.65 * level)
		var r2 := (along * along) / (ea * ea) + (across * across) / (eb * eb)
		if r2 < 1.0:
			best = maxf(best, p.depth * level * (1.0 - r2))
	return best

## Grip left on a puddle at a speed (m/s): water under a tyre lifts it off the road faster than it can clear it
## (dynamic aquaplaning, from ~60 km/h on slicks; a wet tyre's grooves push it ~25 km/h higher).
static func aquaplane_grip(water: float, speed: float, wet_tyre: bool) -> float:
	if water <= 0.0:
		return 1.0
	var v0 := 23.0 if wet_tyre else 16.0
	var lift := clampf((speed - v0) / 22.0, 0.0, 1.0) * clampf(water * 1.6, 0.0, 1.0)
	return 1.0 - lift * (0.45 if wet_tyre else 0.8)
