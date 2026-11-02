class_name RacingLineFx
extends Node3D
## Racing-line assist after the F1 games' dynamic line (port of game/racingLineFx.ts): a ribbon of soft chevrons
## pointing the way, coloured from what *your* car needs now. Ahead of the car the colour comes from the deceleration
## needed to get from the current speed down to the line's target speed there (green: keep going, amber: lift / light
## braking, red: brake hard now); further away it shows the line's own plan. "corners" shows only braking zones and
## corners; "full" the whole lap.

const WIDTH := 1.1
const LIFT := 0.03

var _corners: MeshInstance3D
var _full: MeshInstance3D
var _mat := ShaderMaterial.new()
var _cum: PackedFloat32Array
var _length: float

## specs: the car's (tuned) specs; ground: a GroundQuery; air_density: the session's.
func _init(track: Dictionary, specs: Dictionary, ground: GroundQuery, air_density: float = AiDriver.RHO) -> void:
	name = "racing-line"
	var line := AiDriver.racing_line_for(track)
	# a realistic target, not the absolute limit: what a good driver brakes for
	var limits := AiDriver.car_limits(specs, 0.94, air_density)
	var v := AiDriver.speed_profile(line, limits, 1.0, true)
	var n := v.size()
	var ds: PackedFloat32Array = line.ds
	var curv: PackedFloat32Array = line.curvature
	var lx: PackedFloat32Array = line.x
	var lz: PackedFloat32Array = line.z
	var kind := PackedFloat32Array()
	kind.resize(n)
	for i in n:
		var j := (i + 1) % n
		var acc := (v[j] * v[j] - v[i] * v[i]) / (2.0 * ds[i])
		if acc < -2.5:
			kind[i] = 2.0
		elif acc < 1.5 and absf(curv[i]) > 1.0 / 350.0:
			kind[i] = 1.0
	# a soft blend between the colours instead of hard steps
	var smooth := PackedFloat32Array()
	smooth.resize(n)
	for i in n:
		var s := 0.0
		for k in range(-2, 3):
			s += kind[(i + k + n) % n]
		smooth[i] = maxf(kind[i], s / 5.0)
	_cum = PackedFloat32Array()
	_cum.resize(n)
	for i in range(1, n):
		_cum[i] = _cum[i - 1] + ds[i - 1]
	_length = _cum[n - 1] + ds[n - 1]
	# ground heights under the line
	var y := PackedFloat32Array()
	y.resize(n)
	for i in n:
		var cy: float = track.centerline[i * 3 + 1]
		# start just above the road: a ray from higher up could land on a bridge over the track
		var hit := ground.cast(Vector3(lx[i], cy + 2.5, lz[i]), Vector3.DOWN, 6.0)
		y[i] = hit.pos.y if not hit.is_empty() else cy
	# two vertices per point; the seam wraps with one extra pair (s continues past the lap length)
	var m := n + 1
	var pos := PackedVector3Array()
	var uv := PackedVector2Array()
	var uv2 := PackedVector2Array()
	pos.resize(m * 2)
	uv.resize(m * 2)
	uv2.resize(m * 2)
	for k in m:
		var i := k % n
		var a := (i - 1 + n) % n
		var b := (i + 1) % n
		var tx := lx[b] - lx[a]
		var tz := lz[b] - lz[a]
		var l := maxf(1e-6, sqrt(tx * tx + tz * tz))
		var sx := (tz / l) * (WIDTH / 2.0)
		var sz := (-tx / l) * (WIDTH / 2.0)
		pos[k * 2] = Vector3(lx[i] + sx, y[i] + LIFT, lz[i] + sz)
		pos[k * 2 + 1] = Vector3(lx[i] - sx, y[i] + LIFT, lz[i] - sz)
		var s := _length if k == n else _cum[i]
		uv[k * 2] = Vector2(0.0, s)
		uv[k * 2 + 1] = Vector2(1.0, s)
		uv2[k * 2] = Vector2(v[i], smooth[i])
		uv2[k * 2 + 1] = Vector2(v[i], smooth[i])
	_mat.shader = load("res://shaders/racing_line.gdshader")
	_mat.set_shader_parameter("line_length", _length)
	# the car's mechanical braking (m/s²); aero adds more at speed, so the colours stay on the safe side
	_mat.set_shader_parameter("brake", limits.muBrake * 9.81)
	_mat.render_priority = 2
	_corners = _mesh(pos, uv, uv2, kind, n, true)
	_full = _mesh(pos, uv, uv2, kind, n, false)
	add_child(_corners)
	add_child(_full)

func _mesh(pos: PackedVector3Array, uv: PackedVector2Array, uv2: PackedVector2Array, kind: PackedFloat32Array, n: int, only_corners: bool) -> MeshInstance3D:
	var idx := PackedInt32Array()
	for i in n:
		var j := i + 1
		# corners mode: braking zones and corners, plus a short green lead-in so the brake point is readable
		if only_corners and kind[i] == 0.0 and kind[(i + 1) % n] == 0.0 and kind[(i + 2) % n] == 0.0 and kind[(i + 3) % n] == 0.0 and kind[(i + 4) % n] == 0.0:
			continue
		idx.append_array([i * 2, j * 2, i * 2 + 1, i * 2 + 1, j * 2, j * 2 + 1])
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = pos
	arrays[Mesh.ARRAY_TEX_UV] = uv
	arrays[Mesh.ARRAY_TEX_UV2] = uv2
	arrays[Mesh.ARRAY_INDEX] = idx
	var mesh := ArrayMesh.new()
	if idx.size() >= 3:
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		mesh.surface_set_material(0, _mat)
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.custom_aabb = AABB(Vector3(-20000, -2000, -20000), Vector3(40000, 4000, 40000))
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return mi

func set_mode(mode: String) -> void:
	_corners.visible = mode == "corners"
	_full.visible = mode == "full"

## Every frame: the car's centreline index and speed (m/s), for the dynamic colours.
func update_line(index: int, speed_ms: float) -> void:
	if not visible:
		return
	_mat.set_shader_parameter("car_s", _cum[clampi(index, 0, _cum.size() - 1)])
	_mat.set_shader_parameter("speed", speed_ms)
