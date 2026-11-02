class_name TrackMath
extends RefCounted
## Centreline and gate helpers (port of packages/shared/src/track.ts). A track is the layout's JSON Dictionary:
## centerline is a flat Array [x, y, z, ...]; gates, grid etc. as in the file. Vectors are Arrays of 3 floats.

## Horizontal side vector (pointing to the driver's left when facing d).
static func gate_side(d: Array) -> Array:
	return [d[2], 0.0, -d[0]]

## Segment a->b crosses gate g (from behind to in front, within its width)? Returns 0..1 along the segment, or -1.
static func crosses_gate(g: Dictionary, a: Vector3, b: Vector3) -> float:
	var p: Array = g.p
	var d: Array = g.d
	var da: float = (a.x - p[0]) * d[0] + (a.z - p[2]) * d[2]
	var db: float = (b.x - p[0]) * d[0] + (b.z - p[2]) * d[2]
	if not (da < 0.0 and db >= 0.0):
		return -1.0
	var f := da / (da - db)
	var x := a.x + (b.x - a.x) * f
	var y := a.y + (b.y - a.y) * f
	var z := a.z + (b.z - a.z) * f
	var lateral := absf((x - p[0]) * d[2] - (z - p[2]) * d[0])
	if lateral > g.hw:
		return -1.0
	if absf(y - p[1]) > 12.0:
		return -1.0
	return f

## Nearest centreline point index to (x, y, z). Searches +-window around hint (or the whole loop when hint < 0).
static func nearest_centerline_index(track: Dictionary, x: float, y: float, z: float, hint: int, window: int = 40) -> int:
	var cl: Array = track.centerline
	var n := cl.size() / 3
	var best := -1
	var best_d := INF
	var full := hint < 0
	var count := n if full else mini(n, window * 2 + 1)
	var start := 0 if full else hint - window
	for k in count:
		var i := posmod(start + k, n)
		var dx: float = cl[i * 3] - x
		var dy: float = (cl[i * 3 + 1] - y) * 2.0 # vertical separation matters more (bridges)
		var dz: float = cl[i * 3 + 2] - z
		var d := dx * dx + dy * dy + dz * dz
		if d < best_d:
			best_d = d
			best = i
	return best

## Distance along the centreline (0..length) of the projection of (x, z) near index i.
static func progress_at(track: Dictionary, i: int, x: float, z: float) -> float:
	var cl: Array = track.centerline
	var n := cl.size() / 3
	var j := (i + 1) % n
	var ax: float = cl[i * 3]
	var az: float = cl[i * 3 + 2]
	var sx: float = cl[j * 3] - ax
	var sz: float = cl[j * 3 + 2] - az
	var len2 := sx * sx + sz * sz
	if len2 == 0.0:
		len2 = 1.0
	var t := clampf(((x - ax) * sx + (z - az) * sz) / len2, -0.5, 1.5)
	var cum: Array = track.cumS
	var seg_len: float = track.length - cum[i] if j == 0 else cum[j] - cum[i]
	var s: float = cum[i] + t * seg_len
	if s < 0.0:
		s += track.length
	if s >= track.length:
		s -= track.length
	return s

## The centreline point at or before lap distance s (wrapped into the lap): a binary search of cumS.
static func index_at_distance(track: Dictionary, s: float) -> int:
	var length: float = track.length
	s = fposmod(s, length)
	var cum: Array = track.cumS
	var lo := 0
	var hi := cum.size() - 1
	while lo < hi:
		var m := (lo + hi + 1) >> 1
		if cum[m] <= s:
			lo = m
		else:
			hi = m - 1
	return lo

## Position (x, y, z) and heading (yaw = atan2(dx, dz)) on the centreline at lap distance s.
## Returns {x, y, z, yaw}.
static func point_at_distance(track: Dictionary, s: float) -> Dictionary:
	var length: float = track.length
	s = fposmod(s, length)
	var cum: Array = track.cumS
	var n := cum.size()
	var i := index_at_distance(track, s)
	var j := (i + 1) % n
	var seg_len: float = (length if j == 0 else cum[j]) - cum[i]
	var u: float = (s - cum[i]) / seg_len if seg_len > 0.0 else 0.0
	var cl: Array = track.centerline
	return {
		"x": cl[i * 3] + (cl[j * 3] - cl[i * 3]) * u,
		"y": cl[i * 3 + 1] + (cl[j * 3 + 1] - cl[i * 3 + 1]) * u,
		"z": cl[i * 3 + 2] + (cl[j * 3 + 2] - cl[i * 3 + 2]) * u,
		"yaw": atan2(cl[j * 3] - cl[i * 3], cl[j * 3 + 2] - cl[i * 3 + 2]),
	}

## Forward-wrapped distance from s0 to s1 on a loop of length L, mapped into (-L/2, L/2].
static func wrap_delta(s0: float, s1: float, length: float) -> float:
	var d := fmod(s1 - s0, length)
	if d > length / 2.0:
		d -= length
	if d <= -length / 2.0:
		d += length
	return d
