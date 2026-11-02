class_name MiniMap
extends Control
## The turning minimap of the HUD (port of Hud.setTrack / Hud.drawMap): zoomed in, centred on you and rotating with
## your heading, the circuit as a white road on a dark ribbon, the pit lane and boxes, the start line and the cars.

const SIZE := 220.0
## Radius in metres.
const RANGE_M := 320.0

var _track_pts := PackedVector2Array()
var _pit_pts := PackedVector2Array()
var _box_pts := PackedVector2Array()
var _start := Vector2.ZERO
var _dots: Array = []
var _me := Vector2.ZERO
var _fwd := Vector2(0, 1)

func _init() -> void:
	custom_minimum_size = Vector2(SIZE, SIZE)
	size = Vector2(SIZE, SIZE)
	mouse_filter = Control.MOUSE_FILTER_IGNORE

func set_track(t: Dictionary) -> void:
	var cl: Array = t.centerline
	_track_pts = PackedVector2Array()
	for i in range(0, cl.size(), 3):
		_track_pts.append(Vector2(cl[i], cl[i + 2]))
	_track_pts.append(_track_pts[0])
	var pl = t.get("pitLane", null)
	_pit_pts = PackedVector2Array()
	_box_pts = PackedVector2Array()
	if pl != null:
		var last: int = pl.get("outIndex", pl.points.size() - 1) if pl.get("outIndex", null) != null else pl.points.size() - 1
		for i in range(0, last + 1):
			_pit_pts.append(Vector2(pl.points[i][0], pl.points[i][2]))
		for i in range(pl.boxFrom, pl.boxTo + 1):
			_box_pts.append(Vector2(pl.points[i][0], pl.points[i][2]))
	_start = Vector2(cl[0], cl[2])

## Draw the map around (me_x, me_z) with the car's forward (fx, fz) pointing up. dots: [{x, z, me, color}].
func draw_map(dots: Array, me_x: float, me_z: float, fx: float, fz: float) -> void:
	_dots = dots
	_me = Vector2(me_x, me_z)
	_fwd = Vector2(fx, fz)
	queue_redraw()

func _draw() -> void:
	var r := SIZE / 2.0
	draw_circle(Vector2(r, r), r - 2.0, Color(0, 0, 0, 0.25))
	if _track_pts.is_empty():
		return
	var s := (r - 6.0) / RANGE_M # px per metre
	# forward -> up
	var rot := -atan2(_fwd.x, -_fwd.y)
	var xf := Transform2D(rot, Vector2(r, r)) * Transform2D().scaled(Vector2(s, s)) * Transform2D(0, -_me)
	draw_circle(Vector2(r, r), r - 2.0, Color(0, 0, 0, 0.35))
	var c := Vector2(r, r)
	var rr := r - 2.0
	var tp := PackedVector2Array()
	for p in _track_pts:
		tp.append(xf * p)
	var track_lines := _clip(tp, c, rr)
	for l in track_lines:
		draw_polyline(l, Color(0, 0, 0, 0.6), 22.0 * s, true)
	for l in track_lines:
		draw_polyline(l, Color(1, 1, 1, 0.9), 12.0 * s, true)
	if not _pit_pts.is_empty() and not _box_pts.is_empty():
		var pp := PackedVector2Array()
		for p in _pit_pts:
			pp.append(xf * p)
		for l in _clip(pp, c, rr):
			draw_polyline(l, Color(1, 1, 1, 0.45), 6.0 * s, true)
		var bp := PackedVector2Array()
		for p in _box_pts:
			bp.append(xf * p)
		for l in _clip(bp, c, rr):
			draw_polyline(l, Color("ffd60a"), 7.0 * s, true)
	var st := xf * _start
	if st.distance_to(c) < rr - 8.0 * s:
		draw_rect(Rect2(st - Vector2(8, 8) * s, Vector2(16, 16) * s), Color("ff3b30"))
	for d in _dots:
		var p := xf * Vector2(d.x, d.z)
		if p.distance_to(c) > rr - 7.0:
			continue
		var rad: float = 6.5 if d.me else 5.0
		draw_circle(p, rad + 1.5, Color.BLACK)
		draw_circle(p, rad, Color("ffd60a") if d.me else Color(d.color))
	# your car: a fixed arrow in the centre pointing up
	var arrow := PackedVector2Array([Vector2(r, r - 9), Vector2(r + 6, r + 6), Vector2(r, r + 2), Vector2(r - 6, r + 6)])
	draw_colored_polygon(arrow, Color("ffd60a"))
	arrow.append(arrow[0])
	draw_polyline(arrow, Color.BLACK, 1.5, true)

## A polyline clipped to a circle: the parts of it inside, as separate polylines.
static func _clip(pts: PackedVector2Array, c: Vector2, rad: float) -> Array:
	var out: Array = []
	var cur := PackedVector2Array()
	for i in range(pts.size() - 1):
		var seg := _clip_seg(pts[i], pts[i + 1], c, rad)
		if seg.is_empty():
			if cur.size() > 1:
				out.append(cur)
			cur = PackedVector2Array()
			continue
		if cur.is_empty() or cur[cur.size() - 1].distance_squared_to(seg[0]) > 0.01:
			if cur.size() > 1:
				out.append(cur)
			cur = PackedVector2Array([seg[0]])
		cur.append(seg[1])
	if cur.size() > 1:
		out.append(cur)
	return out

## The part of the segment a-b inside the circle: [p, q], or [].
static func _clip_seg(a: Vector2, b: Vector2, c: Vector2, rad: float) -> Array:
	var d := b - a
	var f := a - c
	var qa := d.dot(d)
	if qa < 1e-9:
		return [a, b] if f.length_squared() <= rad * rad else []
	var qb := 2.0 * f.dot(d)
	var qc := f.dot(f) - rad * rad
	var disc := qb * qb - 4.0 * qa * qc
	if disc < 0.0:
		return []
	var sq := sqrt(disc)
	var t0 := (-qb - sq) / (2.0 * qa)
	var t1 := (-qb + sq) / (2.0 * qa)
	if t1 < 0.0 or t0 > 1.0:
		return []
	t0 = maxf(t0, 0.0)
	t1 = minf(t1, 1.0)
	return [a + d * t0, a + d * t1]
