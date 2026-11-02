class_name CircuitMap
extends Control
## The circuit map as iRacing draws it (port of ui/circuitMap.ts): the whole layout (north-up, not turning with you), a
## dark track with white edges, the start/finish line, the corners numbered, every car a numbered dot, yours on yellow.
## The track is built once; the cars are redrawn ~10 times a second. cars: [{x, z, label, me, lap, inPit}].

const W := 520.0
const H := 400.0

var _cars: Array = []
var _k := 1.0
var _ox := 0.0
var _oz := 0.0
var _edge := Line2D.new()
var _road := Line2D.new()
var _corner_labels: Array = [] # [Vector2, String]
var _start: Array = [] # [Vector2, Vector2]

func _init() -> void:
	custom_minimum_size = Vector2(W, H)
	size = Vector2(W, H)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	for l in [_edge, _road]:
		l.joint_mode = Line2D.LINE_JOINT_ROUND
		l.begin_cap_mode = Line2D.LINE_CAP_ROUND
		l.end_cap_mode = Line2D.LINE_CAP_ROUND
		l.antialiased = true
		add_child(l)
	_edge.default_color = Color(1, 1, 1, 0.95)
	_edge.width = 15.0
	_road.default_color = Color("121418")
	_road.width = 10.0

## The corners of a circuit, numbered along the lap: stretches of the lap line turning tighter than ~260 m radius,
## split where the turn changes hand (chicanes are two), one number each at its tightest point. With the circuit's
## official count, the gentlest extra ones are left out. Returns [{x, z, out: [x, z], s}].
static func find_corners(td: Dictionary, expected = null) -> Array:
	var cl: Array = td.centerline
	var n := cl.size() / 3
	var heading := PackedFloat64Array()
	heading.resize(n)
	for i in n:
		var j := (i + 1) % n
		heading[i] = atan2(cl[j * 3] - cl[i * 3], cl[j * 3 + 2] - cl[i * 3 + 2])
	var step: float = td.length / n
	var win := maxi(1, roundi(15.0 / step))
	var kappa := PackedFloat64Array()
	kappa.resize(n)
	for i in n:
		var d := heading[(i + win) % n] - heading[(i - win + n) % n]
		while d > PI:
			d -= 2.0 * PI
		while d < -PI:
			d += 2.0 * PI
		kappa[i] = d / (2.0 * win * step)
	var thresh := 1.0 / 260.0
	var regions: Array = []
	var cur = null
	var gap_max := roundi(25.0 / step)
	var gap := 0
	for i in n:
		var k := kappa[i]
		var sign_k := signf(k)
		if absf(k) > thresh:
			if cur != null and sign_k == cur.sign:
				cur.to = i
				gap = 0
			else:
				cur = {"from": i, "to": i, "sign": sign_k, "peak": i, "turn": 0.0}
				regions.append(cur)
				gap = 0
			if absf(k) > absf(kappa[cur.peak]):
				cur.peak = i
			cur.turn += absf(k) * step
		elif cur != null:
			gap += 1
			if gap > gap_max:
				cur = null
	var corners: Array = regions.filter(func(r): return (r.to - r.from) * step > 12.0 and r.turn > 0.25)
	if expected != null and corners.size() > int(expected):
		var sorted := corners.duplicate()
		sorted.sort_custom(func(a, b): return a.turn > b.turn)
		var keep := sorted.slice(0, int(expected))
		corners = corners.filter(func(c): return keep.has(c))
	var out: Array = []
	for c in corners:
		var i2: int = c.peak
		var j2 := (i2 + 1) % n
		var tx: float = cl[j2 * 3] - cl[i2 * 3]
		var tz: float = cl[j2 * 3 + 2] - cl[i2 * 3 + 2]
		var tl := Vector2(tx, tz).length()
		if tl == 0.0:
			tl = 1.0
		# outside of the corner: away from its centre
		var sd := -1.0 if c.sign > 0.0 else 1.0
		out.append({"x": cl[i2 * 3], "z": cl[i2 * 3 + 2], "out": [(tz / tl) * sd, (-tx / tl) * sd], "s": td.cumS[i2]})
	return out

func set_track(td: Dictionary, turns = null) -> void:
	var pad := 30.0
	var cl: Array = td.centerline
	var x0 := INF
	var x1 := -INF
	var z0 := INF
	var z1 := -INF
	for i in range(0, cl.size(), 3):
		x0 = minf(x0, cl[i])
		x1 = maxf(x1, cl[i])
		z0 = minf(z0, cl[i + 2])
		z1 = maxf(z1, cl[i + 2])
	_k = minf((W - pad * 2.0) / maxf(x1 - x0, 1.0), (H - pad * 2.0) / maxf(z1 - z0, 1.0))
	_ox = (W - (x1 - x0) * _k) / 2.0 - x0 * _k
	_oz = (H - (z1 - z0) * _k) / 2.0 - z0 * _k
	var pts := PackedVector2Array()
	for i in range(0, cl.size(), 3):
		pts.append(_px(cl[i], cl[i + 2]))
	pts.append(pts[0])
	_edge.points = pts
	_road.points = pts
	# the start/finish line, across the track
	var s := _px(cl[0], cl[2])
	var nx := _px(cl[3], cl[5])
	var a := atan2(nx.y - s.y, nx.x - s.x) + PI / 2.0
	_start = [s - Vector2(cos(a), sin(a)) * 13.0, s + Vector2(cos(a), sin(a)) * 13.0]
	_corner_labels.clear()
	var corners := find_corners(td, turns)
	for i in corners.size():
		var c: Dictionary = corners[i]
		var p := _px(c.x, c.z)
		_corner_labels.append([p + Vector2(c.out[0], c.out[1]) * 22.0, str(i + 1)])
	_cars = []
	queue_redraw()

func _px(x: float, z: float) -> Vector2:
	return Vector2(_ox + x * _k, _oz + z * _k)

func draw_cars(cars: Array) -> void:
	_cars = cars
	queue_redraw()

func _draw() -> void:
	draw_line(_start[0] if not _start.is_empty() else Vector2.ZERO, _start[1] if not _start.is_empty() else Vector2.ZERO, Color.WHITE, 4.0)
	var f := UIKit.font(true, 700)
	for c in _corner_labels:
		var pos: Vector2 = c[0]
		var sz := f.get_string_size(c[1], HORIZONTAL_ALIGNMENT_CENTER, -1, 19)
		# a dark outline, then the number
		for o in [Vector2(-1.5, 0), Vector2(1.5, 0), Vector2(0, -1.5), Vector2(0, 1.5)]:
			draw_string(f, pos + o + Vector2(-sz.x / 2.0, sz.y * 0.3), c[1], HORIZONTAL_ALIGNMENT_LEFT, -1, 19, Color(0, 0, 0, 0.75))
		draw_string(f, pos + Vector2(-sz.x / 2.0, sz.y * 0.3), c[1], HORIZONTAL_ALIGNMENT_LEFT, -1, 19, Color.WHITE)
	# you last, on top
	var sorted := _cars.duplicate()
	sorted.sort_custom(func(a, b): return int(a.me) < int(b.me))
	for c in sorted:
		var p := _px(c.x, c.z)
		var r := 15.0 if c.me else 11.0
		var fill := Color("ffd60a") if c.me else (Color("8b9099") if c.inPit else (Color("ff5a52") if c.lap == "ahead" else (Color("4aa3ff") if c.lap == "behind" else Color("f2f2f2"))))
		draw_circle(p, r + 2.0, Color("111111"))
		draw_circle(p, r, fill)
		var fs := 17 if c.me else 13
		var sz := f.get_string_size(c.label, HORIZONTAL_ALIGNMENT_CENTER, -1, fs)
		draw_string(f, p + Vector2(-sz.x / 2.0, sz.y * 0.3), c.label, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color("111111"))
