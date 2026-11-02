class_name RoadWear
extends MeshInstance3D
## Lived-in asphalt, as on a real circuit after a season of racing, drawn as one multiplicative decal over the whole road
## width (port of game/roadWear.ts): the rubbered racing line with two darker wheel tracks, heavier rubber and skid
## streaks in braking zones, repair patches, marbles in fast corners. It fades out with distance.

const ACROSS := [-1.0, -0.5, 0.0, 0.5, 1.0]  # vertices across the road (edge → edge): follows the crown and camber
const LIFT := 0.025

var _mat := ShaderMaterial.new()

func _init(track: Dictionary, specs: Dictionary, ground: GroundQuery, air_density: float = AiDriver.RHO) -> void:
	name = "road-wear"
	var line := AiDriver.racing_line_for(track)
	var v := AiDriver.speed_profile(line, AiDriver.car_limits(specs, 0.94, air_density), 1.0, true)
	var cl: Array = track.centerline
	var n := cl.size() / 3
	var ds: PackedFloat32Array = line.ds
	var curv: PackedFloat32Array = line.curvature
	var offs: PackedFloat32Array = line.offset
	# per point: braking (decel) and cornering load, smoothed over ~25 m so the wear fades in and out
	var brake := PackedFloat32Array()
	var corner := PackedFloat32Array()
	brake.resize(n)
	corner.resize(n)
	for i in n:
		var j := (i + 1) % n
		var acc := (v[j] * v[j] - v[i] * v[i]) / (2.0 * maxf(0.5, ds[i]))
		brake[i] = smoothstep(3.0, 12.0, -acc)
		corner[i] = smoothstep(6.0, 18.0, absf(curv[i]) * v[i] * v[i])
	var brake_s := _smooth(brake, 4, n)
	var corner_s := _smooth(corner, 3, n)
	var m := ACROSS.size()
	var pos := PackedVector3Array()
	var uv := PackedVector2Array()
	var uv2 := PackedVector2Array()
	var col := PackedColorArray()
	pos.resize(n * m)
	uv.resize(n * m)
	uv2.resize(n * m)
	col.resize(n * m)
	var wl: PackedFloat32Array = track.widthL
	var wr: PackedFloat32Array = track.widthR
	var cum: Array = track.cumS
	for i in n:
		var a := (i - 1 + n) % n
		var b := (i + 1) % n
		var tx: float = cl[b * 3] - cl[a * 3]
		var tz: float = cl[b * 3 + 2] - cl[a * 3 + 2]
		var l := maxf(1e-6, sqrt(tx * tx + tz * tz))
		var lx := tz / l  # left
		var lz := -tx / l
		for k in m:
			var f: float = ACROSS[k]
			var w: float = -wr[i] * -f if f < 0.0 else wl[i] * f
			var x: float = cl[i * 3] + lx * w
			var z: float = cl[i * 3 + 2] + lz * w
			var cy: float = cl[i * 3 + 1]
			var hit := ground.cast(Vector3(x, cy + 2.5, z), Vector3.DOWN, 6.0)
			var y: float = hit.pos.y if not hit.is_empty() else cy
			var o := i * m + k
			pos[o] = Vector3(x, y + LIFT, z)
			uv[o] = Vector2(w, offs[i])
			uv2[o] = Vector2(cum[i], 0.0)
			col[o] = Color(brake_s[i], corner_s[i], 0.0, 1.0)
	var idx := PackedInt32Array()
	for i in n:
		var j := (i + 1) % n
		if j == 0 and Vector2(cl[0] - cl[i * 3], cl[2] - cl[i * 3 + 2]).length() > 20.0:
			continue  # open layouts
		for k in m - 1:
			var a := i * m + k
			var b := j * m + k
			idx.append_array([a, b, a + 1, a + 1, b, b + 1])
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = pos
	arrays[Mesh.ARRAY_TEX_UV] = uv
	arrays[Mesh.ARRAY_TEX_UV2] = uv2
	arrays[Mesh.ARRAY_COLOR] = col
	arrays[Mesh.ARRAY_INDEX] = idx
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	_mat.shader = load("res://shaders/road_wear.gdshader")
	_mat.render_priority = 1  # after the road, before the racing-line assist (2)
	mesh.surface_set_material(0, _mat)
	self.mesh = mesh
	custom_aabb = AABB(Vector3(-20000, -2000, -20000), Vector3(40000, 4000, 40000))
	cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

static func _smooth(a: PackedFloat32Array, rad: int, n: int) -> PackedFloat32Array:
	var o := PackedFloat32Array()
	o.resize(n)
	for i in n:
		var s := 0.0
		for k in range(-rad, rad + 1):
			s += a[(i + k + n) % n]
		o[i] = s / (2 * rad + 1)
	return o

## Rain washes the contrast out (the whole road darkens instead).
func set_wetness(w: float) -> void:
	_mat.set_shader_parameter("wet", w)

func set_quality(fade_distance: float) -> void:
	_mat.set_shader_parameter("fade_dist", fade_distance)
