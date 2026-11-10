class_name Replay
extends RefCounted
## In-session replay (iRacing: play / pause, slow motion, frame step, rewind, fast-forward, a choice of car and camera).
## Records every car's pose 20 times a second into a ring buffer of the last MAX_SECONDS and plays it back with
## interpolation, so slow motion and a rewind stay smooth. Pure data: RaceSession feeds it and draws from it.

## Floats per car: position (3), rotation (4), steer, front and rear wheel angle, brake light, spare.
const STRIDE := 12
const HZ := 20.0
const MAX_SECONDS := 360.0

## The recorded cars (player ids), in the order of their poses in a frame.
var ids: Array = []
## One PackedFloat32Array per sample: [t_ms, pose of car 0, pose of car 1, ...] (t_ms relative to the first sample).
var frames: Array = []
var _acc := 0.0
var _t0 := -1.0
var _last_raw := -1.0

func clear(car_ids: Array = []) -> void:
	ids = car_ids.duplicate()
	frames.clear()
	_acc = 0.0
	_t0 = -1.0
	_last_raw = -1.0

## True when the next sample is due (call every frame with the frame time).
func due(dt: float) -> bool:
	_acc += dt
	if _acc >= 1.0 / HZ:
		_acc = fmod(_acc, 1.0 / HZ)
		return true
	return false

## Appends a sample. poses: PackedFloat32Array of ids.size() * STRIDE floats. now_ms: any monotonic clock.
func add(now_ms: float, poses: PackedFloat32Array) -> void:
	if _t0 < 0.0:
		_t0 = now_ms
	elif now_ms - _last_raw > 250.0:
		# time spent away from recording (a replay being watched) is not part of the race: close the gap
		_t0 += now_ms - _last_raw - 1000.0 / HZ
	_last_raw = now_ms
	var f := PackedFloat32Array()
	f.resize(1 + poses.size())
	f[0] = now_ms - _t0
	for i in poses.size():
		f[1 + i] = poses[i]
	frames.append(f)
	while frames.size() > int(MAX_SECONDS * HZ):
		frames.pop_front()

func size() -> int:
	return frames.size()

func first_ms() -> float:
	return frames[0][0] if frames.size() > 0 else 0.0

func last_ms() -> float:
	return frames[frames.size() - 1][0] if frames.size() > 0 else 0.0

func duration_ms() -> float:
	return last_ms() - first_ms()

## Index of the last frame at or before t_ms (clamped).
func _index_at(t_ms: float) -> int:
	var lo := 0
	var hi := frames.size() - 1
	while lo < hi:
		var mid := (lo + hi + 1) >> 1
		if frames[mid][0] <= t_ms:
			lo = mid
		else:
			hi = mid - 1
	return lo

## The pose of car `car` at t_ms, interpolated between the two samples around it.
## Returns {pos, rot, steer, rot_f, rot_r, brake}, or an empty Dictionary without samples.
func pose(t_ms: float, car: int) -> Dictionary:
	if frames.is_empty() or car < 0 or car >= ids.size():
		return {}
	var i := _index_at(t_ms)
	var j := mini(i + 1, frames.size() - 1)
	var a: PackedFloat32Array = frames[i]
	var b: PackedFloat32Array = frames[j]
	var span: float = b[0] - a[0]
	var u := clampf((t_ms - a[0]) / span, 0.0, 1.0) if span > 0.0 else 0.0
	var o := 1 + car * STRIDE
	var pa := Vector3(a[o], a[o + 1], a[o + 2])
	var pb := Vector3(b[o], b[o + 1], b[o + 2])
	var qa := Quaternion(a[o + 3], a[o + 4], a[o + 5], a[o + 6])
	var qb := Quaternion(b[o + 3], b[o + 4], b[o + 5], b[o + 6])
	# a reset or a teleport between two samples is a jump, not a drive
	var jump := pa.distance_to(pb) > 30.0
	return {
		"pos": pa if jump else pa.lerp(pb, u),
		"rot": qa if jump else qa.slerp(qb, u),
		"steer": lerpf(a[o + 7], b[o + 7], u),
		"rot_f": lerp_angle(a[o + 8], b[o + 8], u),
		"rot_r": lerp_angle(a[o + 9], b[o + 9], u),
		"brake": a[o + 10] > 0.5,
	}

## Velocity of car `car` around t_ms (m/s), from the samples either side.
func velocity(t_ms: float, car: int) -> Vector3:
	if frames.size() < 2 or car < 0 or car >= ids.size():
		return Vector3.ZERO
	var i := _index_at(t_ms)
	var j := mini(i + 1, frames.size() - 1)
	if j == i:
		i = maxi(0, i - 1)
	var a: PackedFloat32Array = frames[i]
	var b: PackedFloat32Array = frames[j]
	var dt: float = (b[0] - a[0]) / 1000.0
	if dt <= 0.0:
		return Vector3.ZERO
	var o := 1 + car * STRIDE
	var d := Vector3(b[o] - a[o], b[o + 1] - a[o + 1], b[o + 2] - a[o + 2])
	return Vector3.ZERO if d.length() > 30.0 else d / dt

## Packs one pose into poses[car * STRIDE ...].
static func put(poses: PackedFloat32Array, car: int, pos: Vector3, rot: Quaternion, steer: float, rot_f: float, rot_r: float, brake: bool) -> void:
	var o := car * STRIDE
	poses[o] = pos.x
	poses[o + 1] = pos.y
	poses[o + 2] = pos.z
	poses[o + 3] = rot.x
	poses[o + 4] = rot.y
	poses[o + 5] = rot.z
	poses[o + 6] = rot.w
	poses[o + 7] = steer
	poses[o + 8] = rot_f
	poses[o + 9] = rot_r
	poses[o + 10] = 1.0 if brake else 0.0
