class_name BestLapGhost
extends RefCounted
## Your best valid lap as a ghost (port of game/ghost.ts): the current lap is recorded at the state sample rate; when
## it becomes the new personal best it replaces the ghost, which is then replayed by lap time on the following laps.

const STRIDE := 8 # lapMs, x, y, z, qx, qy, qz, qw

var _cur := PackedFloat32Array()
var _n := 0
var _best := PackedFloat32Array()
var _best_n := 0

func record(lap_ms: float, p: Vector3, q: Quaternion) -> void:
	if (_n + 1) * STRIDE > _cur.size():
		_cur.resize(maxi(STRIDE * 4096, _cur.size() * 2))
	var o := _n * STRIDE
	_cur[o] = lap_ms
	_cur[o + 1] = p.x
	_cur[o + 2] = p.y
	_cur[o + 3] = p.z
	_cur[o + 4] = q.x
	_cur[o + 5] = q.y
	_cur[o + 6] = q.z
	_cur[o + 7] = q.w
	_n += 1

## A lap ended: keep it when it was the new best, then start recording the next one.
func lap_ended(new_best: bool) -> void:
	if new_best and _n > 10:
		_best = _cur.slice(0, _n * STRIDE)
		_best_n = _n
	_n = 0

## Discard the lap in progress (pit stop, reset).
func abort_lap() -> void:
	_n = 0

func has_ghost() -> bool:
	return _best_n > 0

## Pose of the best lap at lap_ms: {p: Vector3, q: Quaternion}, or {} outside the recorded lap.
func pose(lap_ms: float) -> Dictionary:
	var b := _best
	if _best_n < 2 or lap_ms < b[0] or lap_ms > b[(_best_n - 1) * STRIDE]:
		return {}
	var lo := 0
	var hi := _best_n - 1
	while hi - lo > 1:
		var m := (lo + hi) >> 1
		if b[m * STRIDE] <= lap_ms:
			lo = m
		else:
			hi = m
	var a := lo * STRIDE
	var c := hi * STRIDE
	var f := (lap_ms - b[a]) / maxf(1.0, b[c] - b[a])
	var p := Vector3(b[a + 1] + (b[c + 1] - b[a + 1]) * f, b[a + 2] + (b[c + 2] - b[a + 2]) * f, b[a + 3] + (b[c + 3] - b[a + 3]) * f)
	var qa := Quaternion(b[a + 4], b[a + 5], b[a + 6], b[a + 7])
	var qb := Quaternion(b[c + 4], b[c + 5], b[c + 6], b[c + 7])
	return {"p": p, "q": qa.slerp(qb, f)}

## Slipstream: how much of a car's wake reaches a follower at pos moving along vel (0 .. 1). others: [{pos, vel}].
## Strongest a few metres behind, gone ~45 m back or ~2-3 m to the side; the leader must be going the same way.
static func wake_strength(pos: Vector3, vel: Vector3, others: Array) -> float:
	var speed := vel.length()
	if speed < 15.0:
		return 0.0
	var dir := vel / speed
	var best := 0.0
	for o in others:
		var rel: Vector3 = o.pos - pos
		var along := rel.dot(dir)
		if along < 3.0 or along > 45.0:
			continue
		if (o.vel as Vector3).dot(dir) < speed * 0.6:
			continue
		var lateral := (rel - dir * along).length()
		var width := 2.2 + along * 0.025
		if lateral > width:
			continue
		var s := (1.0 - (along - 3.0) / 42.0) * (1.0 - lateral / width)
		if s > best:
			best = s
	return best
