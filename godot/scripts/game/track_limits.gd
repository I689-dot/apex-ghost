class_name TrackLimits
extends RefCounted
## Track limits as in the real rules (port of game/trackLimits.ts): the painted white line is the edge of the track
## (per point and side: track.limitL/limitR), and a car is off only when all four wheels are beyond it. A hold time
## ignores a brief moment out. A wheel in the air judges nothing.

## Past the line + this many m a wheel counts as beyond (about half a kerb).
const LIMIT_TOLERANCE_M := 0.5
const HOLD_S := 0.4

var _t := 0.0
## True while the car has been beyond the limits for longer than the hold time.
var off_track := false

static func limit_at(track: Dictionary, index: int, left: bool) -> float:
	var lim = track.get("limitL" if left else "limitR")
	if lim != null and index < lim.size() and lim[index] != null:
		return lim[index]
	return (track.widthL[index] if left else track.widthR[index]) + 0.5

static func beyond_limits_now(v: Vehicle, track: Dictionary, index: int, lateral: float) -> bool:
	var cl: Array = track.centerline
	var n := cl.size() / 3
	var j := (index + 1) % n
	var tx: float = cl[j * 3] - cl[index * 3]
	var tz: float = cl[j * 3 + 2] - cl[index * 3 + 2]
	var tl := Vector2(tx, tz).length()
	if tl == 0.0:
		tl = 1.0
	tx /= tl
	tz /= tl
	var left := lateral >= 0.0
	var lim := limit_at(track, index, left) + LIMIT_TOLERANCE_M
	for w in v.wheels:
		if not w.contact:
			return false
		var wl: float = (w.cp.x - cl[index * 3]) * tz - (w.cp.z - cl[index * 3 + 2]) * tx
		if (wl if left else -wl) <= lim:
			return false
	return true

func update(dt: float, beyond: bool) -> bool:
	_t = _t + dt if beyond else 0.0
	off_track = _t >= HOLD_S
	return off_track

func reset() -> void:
	_t = 0.0
	off_track = false
