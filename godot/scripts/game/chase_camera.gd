class_name ChaseCamera
extends RefCounted
## Chase camera, as in GT / ACC (port of RaceSession.updateChaseCam): it trails the car's heading with a short lag,
## leans a little towards the direction of travel when sliding, pulls back and widens slightly with speed, and smooths
## the height so kerbs and bumps don't shake the picture. Look back puts it ahead of the car, looking back.

var camera := Camera3D.new()
var _init_done := false
var _yaw := 0.0
var _y := 0.0
var _side := 0.0

func _init() -> void:
	camera.near = 0.1
	camera.far = 9000.0
	camera.fov = 58.0

func reset() -> void:
	_init_done = false

## car: the car's node; car_vel its world velocity; mode "chase" or "far"; back: look back.
func update(dt: float, car: Node3D, car_vel: Vector3, mode: String, back: bool) -> void:
	var o := car.global_transform
	var fwd_v := o.basis.z
	var heading := atan2(fwd_v.x, fwd_v.z)
	var speed := Vector2(car_vel.x, car_vel.z).length()
	var target := heading
	if speed > 8.0:
		# in a slide, look partly along the path the car is really taking
		var travel := atan2(car_vel.x, car_vel.z)
		var slip := atan2(sin(travel - heading), cos(travel - heading))
		target = heading + clampf(slip, -0.6, 0.6) * 0.35
	var far := mode == "far"
	if not _init_done:
		_yaw = target
		_y = o.origin.y
		_init_done = true
	var d_yaw := atan2(sin(target - _yaw), cos(target - _yaw))
	var chase_cfg: Dictionary = Settings.data.chase
	# the player's lag (Settings: camera): more lag, a looser follow
	_yaw += d_yaw * (1.0 - exp((-dt * (4.5 if far else 6.0)) / maxf(0.3, float(chase_cfg.lag))))
	_y += (o.origin.y - _y) * (1.0 - exp(-dt * 7.0))
	var kmh := speed * 3.6
	var fast := minf(1.0, kmh / 250.0)
	# framed as in GT7 / F1 25: the car in the lower third, the road and the next corner above it
	var dist := ((8.6 if far else 5.9) + fast * (1.1 if far else 0.8)) * float(chase_cfg.distance)
	var height := (2.9 if far else 2.0) * float(chase_cfg.height)
	var yaw := _yaw + PI if back else _yaw
	var fx := sin(yaw)
	var fz := cos(yaw)
	# a touch of sideways sway with the cornering g (the camera lags the car into the corner)
	var side := clampf(d_yaw * 2.2, -0.45, 0.45) * (0.0 if back else 1.0)
	_side += (side - _side) * (1.0 - exp(-dt * 3.0))
	camera.global_position = Vector3(o.origin.x - fx * dist - fz * _side, _y + height, o.origin.z - fz * dist + fx * _side)
	var ahead := 9.0 if far else 10.0
	camera.look_at(Vector3(o.origin.x + fx * ahead, _y + (0.75 if far else 0.95), o.origin.z + fz * ahead), Vector3.UP)
	camera.fov = (54.0 if far else 58.0) + fast * 7.0
