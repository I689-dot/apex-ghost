class_name TrackOutline
extends Control
## A layout's shape as an outline (port of ui/trackMap.ts): the lobby's circuit cards and preview, drawn from the
## centreline seen from above, the start/finish marked. Built once per layout from the track file.

static var _cache := {}  # layout id → PackedVector2Array in 0..100 (plus the start as the first point)

var layout_id: String
var accent: Color = UIKit.ACCENT

func _init(id: String, min_size: Vector2 = Vector2(120, 120)) -> void:
	layout_id = id
	custom_minimum_size = min_size
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	if not _cache.has(id):
		_load.call_deferred()

func _load() -> void:
	if not _cache.has(layout_id):
		_cache[layout_id] = _outline_of(Assets.load_track_file(layout_id))
	queue_redraw()

static func _outline_of(td: Dictionary) -> PackedVector2Array:
	var cl: Array = td.centerline
	var n := cl.size() / 3
	# every point would be ~5000 on the 25 km layout: a point every few metres is plenty for a card
	var step := maxi(1, n / 900)
	var lo := Vector2(INF, INF)
	var hi := Vector2(-INF, -INF)
	for i in range(0, n, step):
		lo = lo.min(Vector2(cl[i * 3], cl[i * 3 + 2]))
		hi = hi.max(Vector2(cl[i * 3], cl[i * 3 + 2]))
	var size := maxf(maxf(hi.x - lo.x, hi.y - lo.y), 1.0)
	var pad := 6.0
	var k := (100.0 - pad * 2.0) / size
	var o := Vector2(pad + (100.0 - pad * 2.0 - (hi.x - lo.x) * k) / 2.0, pad + (100.0 - pad * 2.0 - (hi.y - lo.y) * k) / 2.0)
	var pts := PackedVector2Array()
	for i in range(0, n, step):
		pts.append(o + (Vector2(cl[i * 3], cl[i * 3 + 2]) - lo) * k)
	return pts

func _draw() -> void:
	if not _cache.has(layout_id):
		return
	var pts: PackedVector2Array = _cache[layout_id]
	if pts.size() < 2:
		return
	var s := minf(size.x, size.y) / 100.0
	var off := (size - Vector2(100, 100) * s) / 2.0
	var scaled := PackedVector2Array()
	for p in pts:
		scaled.append(off + p * s)
	scaled.append(scaled[0])
	draw_polyline(scaled, Color(0, 0, 0, 0.5), 5.0 * maxf(0.6, s * 1.4), true)
	draw_polyline(scaled, Color(1, 1, 1, 0.9), 2.4 * maxf(0.6, s * 1.4), true)
	draw_circle(scaled[0], 3.6 * maxf(0.8, s * 1.2), accent)
