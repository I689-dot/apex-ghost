class_name TvCameras
extends RefCounted
## Trackside TV cameras, as a race is broadcast (port of game/tvCameras.ts): a camera on a tower on the outside of every
## corner and along the long straights, fixed in place, panning to follow the car and zooming to keep it the same size
## in the frame. Each camera holds the car as it comes towards it and a little after, then the next one takes it (a
## cut, never a move). Placed once per track, every sightline checked against the circuit's collision and trees.

var camera := Camera3D.new()
var td: Dictionary
var _stations: Array = []  # {pos: Vector3, from: float, to: float}
var _current := -1
var _look_at := Vector3.ZERO
var _fov := 30.0
var _t := 0.0
var _len: float

## sight: Callable(a: Vector3, b: Vector3) -> distance of the first hit or null; ground: Callable(x, z, from_y) -> y or null.
func _init(track_data: Dictionary, sight: Callable, ground: Callable) -> void:
	td = track_data
	_len = float(td.length)
	camera.fov = 30.0
	camera.near = 0.5
	camera.far = 12000.0
	_place(sight, ground)

func count() -> int:
	return _stations.size()

func _place(sight: Callable, ground: Callable) -> void:
	var length := _len
	# where the cameras look from: every corner (outside of it), the long straights filled in every ~380 m
	var spots: Array = []
	for c in CircuitMap.find_corners(td, td.get("turns", null)):
		var p := TrackMath.point_at_distance(td, c.s)
		# which side is outside: the corner's "out" direction against the track's left normal (cos yaw, -sin yaw)
		var left: float = cos(p.yaw) * c.out[0] - sin(p.yaw) * c.out[1]
		spots.append({"s": c.s, "side": 1 if left > 0.0 else -1})
	spots.sort_custom(func(a, b): return a.s < b.s)
	if spots.is_empty():
		spots.append({"s": 0.0, "side": 1})
	var filled: Array = []
	for i in spots.size():
		var a: Dictionary = spots[i]
		var b: Dictionary = spots[(i + 1) % spots.size()]
		filled.append(a)
		var gap := fposmod(b.s - a.s, length)
		if gap == 0.0:
			gap = length
		var extra := int(floorf(gap / 380.0))
		for k in range(1, extra + 1):
			filled.append({"s": fposmod(a.s + gap * k / (extra + 1), length), "side": -a.side if k % 2 == 1 else a.side})
	filled.sort_custom(func(a, b): return a.s < b.s)
	# each camera covers from 45 % of the way after the previous one to 45 % of the way to the next:
	# the car is shown coming towards it (the long-lens head-on shot) and going away for a short while
	var n := filled.size()
	for i in n:
		var prev: Dictionary = filled[(i - 1 + n) % n]
		var cur: Dictionary = filled[i]
		var nxt: Dictionary = filled[(i + 1) % n]
		var gap_in := fposmod(cur.s - prev.s, length)
		if gap_in == 0.0:
			gap_in = length
		var gap_out := fposmod(nxt.s - cur.s, length)
		if gap_out == 0.0:
			gap_out = length
		var from := fposmod(prev.s + gap_in * 0.45, length)
		var to := fposmod(cur.s + gap_out * 0.45, length)
		_stations.append({"pos": _best_spot(cur, from, to, sight, ground), "from": from, "to": to})

## A tower beside the track at `spot`: tries the outside, further back and higher, then the inside; the clearest wins.
func _best_spot(spot: Dictionary, from: float, to: float, sight: Callable, ground: Callable) -> Vector3:
	var pt := TrackMath.point_at_distance(td, spot.s)
	var i := TrackMath.index_at_distance(td, spot.s)
	var half: float = td.widthL[i] if spot.side > 0 else td.widthR[i]
	var span := fposmod(to - from, _len)
	# the stretch the camera has to see: 9 points along it, 1 m above the road
	var targets: Array = []
	for k in 9:
		var q := TrackMath.point_at_distance(td, from + span * k / 8.0)
		targets.append(Vector3(q.x, q.y + 1.0, q.z))
	var best := Vector3.ZERO
	var best_seen := -1.0
	for side in [spot.side, -spot.side]:
		# [offset from the track edge, height]; a crane over the trees is the last resort
		for oh in [[14.0, 6.0], [24.0, 9.0], [38.0, 14.0], [8.0, 4.0], [16.0, 24.0]]:
			var off: float = oh[0]
			var up: float = oh[1]
			var lx: float = cos(pt.yaw) * side
			var lz: float = -sin(pt.yaw) * side
			var half2: float = half if side == spot.side else (td.widthR[i] if spot.side > 0 else td.widthL[i])
			var x: float = pt.x + lx * (half2 + off)
			var z: float = pt.z + lz * (half2 + off)
			var g = ground.call(x, z, pt.y + 200.0)
			var y: float = maxf(pt.y, g if g != null else pt.y) + up
			var seen := 0
			for tg in targets:
				if sight.call(Vector3(x, y, z), tg) == null:
					seen += 1
			# prefer the outside of the corner and the nearer towers when they see as much
			var score := seen + (0.3 if side == spot.side else 0.0) - off * 0.004
			if score > best_seen:
				best_seen = score
				best = Vector3(x, y, z)
			if seen == targets.size() and side == spot.side:
				return best
	return best

## The camera covering lap distance s.
func _station_at(s: float) -> int:
	s = fposmod(s, _len)
	for i in _stations.size():
		var st: Dictionary = _stations[i]
		var span := fposmod(st.to - st.from, _len)
		if fposmod(s - st.from, _len) <= span:
			return i
	return 0

## Starts the next shot as a cut (the first frame jumps straight onto the car).
func reset() -> void:
	_current = -1

## Follows a car: pos where it is, vel its velocity, s its lap distance. False when no camera could be placed.
func update(dt: float, pos: Vector3, vel: Vector3, s: float) -> bool:
	if _stations.is_empty():
		return false
	_t += dt
	var i := _station_at(s)
	var cut := i != _current
	_current = i
	var st: Dictionary = _stations[i]
	# a tripod on a tower: the faintest sway of a long lens in the wind
	camera.global_position = Vector3(st.pos.x + sin(_t * 0.9) * 0.03, st.pos.y + sin(_t * 1.3) * 0.02, st.pos.z)
	# the operator leads the car a little in the direction it is going
	var look := Vector3(pos.x + vel.x * 0.12, pos.y + 0.6, pos.z + vel.z * 0.12)
	if cut:
		_look_at = look
	else:
		_look_at = _look_at.lerp(look, 1.0 - exp(-dt * 9.0))
	if camera.global_position.distance_to(_look_at) > 0.01:
		camera.look_at(_look_at, Vector3.UP)
	# zoom: the car about a third of the frame's width (~14 m of scene across), wider as it passes close
	var d := _look_at.distance_to(camera.global_position)
	var size := camera.get_viewport().get_visible_rect().size
	var aspect := size.x / maxf(1.0, size.y)
	var frame_h := 14.0 / aspect
	var fov := clampf(rad_to_deg(2.0 * atan(frame_h / 2.0 / maxf(1.0, d))), 2.5, 50.0)
	_fov = fov if cut else _fov + (fov - _fov) * (1.0 - exp(-dt * 4.0))
	camera.fov = _fov
	return true
