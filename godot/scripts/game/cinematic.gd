class_name Cinematic
extends RefCounted
## Pre-race cinematic, as in TV coverage and F1/GT games (port of game/cinematic.ts):
##  1. aerial flyover of the circuit with a title card and the track map drawing itself (also while everyone loads);
##  2. a pass down the grid, back to front, with a name card for every driver;
##  3. hand-over to the cockpit before the start lights. Enter / Space skips it (only for you).
## Timed against the server's start time, so it ends at the same moment for everyone.

## When the grid pass ends and the cockpit takes over (ms before the green light): the lights start at 3 s.
const HANDOVER_MS := 4200.0
const PER_CAR_MS := 1150.0
const MIN_GRID_MS := 3500.0
const MAX_GRID_MS := 9500.0

var camera := Camera3D.new()
var el := Control.new()
var active := true
var track: Dictionary
var order: Array = []
var _phase := "fly"
var _t := 0.0
var _center := Vector3.ZERO
var _radius := 1.0
var _grid_fwd := Vector3.ZERO
var _grid_mid := Vector3.ZERO
var _card: PanelContainer
var _card_key := -2
var _card_pos: Label
var _card_stripe: ColorRect
var _card_nick: Label
var _card_car: Label
var _map: CineMap
var _title: Control
var _bar_top: ColorRect
var _bar_bottom: ColorRect
var _side: Control
var _skip: Label

## Entrants: [{slot, nick, carName, color, me, bot}]; info: {trackName, facts: [], format}.
func _init(track_data: Dictionary, entrants: Array, info: Dictionary) -> void:
	track = track_data
	camera.fov = 48.0
	camera.near = 0.5
	camera.far = 16000.0
	# circuit centre and size from the centreline
	var cl: Array = track.centerline
	var lo := Vector3(INF, INF, INF)
	var hi := Vector3(-INF, -INF, -INF)
	for i in range(0, cl.size(), 3):
		var p := Vector3(cl[i], cl[i + 1], cl[i + 2])
		lo = lo.min(p)
		hi = hi.max(p)
	_center = (lo + hi) * 0.5
	var size := hi - lo
	_radius = maxf(size.x, size.z) * 0.62
	# grid frame: forward from the pole slot's yaw, the middle of the two columns
	var g0: Dictionary = track.grid[0]
	_grid_fwd = Vector3(sin(g0.yaw), 0, cos(g0.yaw))
	var used := entrants.map(func(e): return track.grid[e.slot] if e.slot < track.grid.size() else g0)
	for g in used:
		_grid_mid += Vector3(g.p[0], g.p[1], g.p[2])
	_grid_mid /= maxf(1.0, used.size())
	# back of the grid first, pole last
	order = entrants.duplicate()
	order.sort_custom(func(a, b): return a.slot > b.slot)
	_build_ui(entrants, info)

func _build_ui(entrants: Array, info: Dictionary) -> void:
	UIKit.full(el)
	el.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_bar_top = ColorRect.new()
	_bar_top.color = Color.BLACK
	_bar_top.set_anchors_preset(Control.PRESET_TOP_WIDE)
	_bar_top.custom_minimum_size = Vector2(0, 64)
	_bar_top.size = Vector2(0, 64)
	_bar_top.mouse_filter = Control.MOUSE_FILTER_IGNORE
	el.add_child(_bar_top)
	_bar_bottom = ColorRect.new()
	_bar_bottom.color = Color.BLACK
	_bar_bottom.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	_bar_bottom.offset_top = -64
	_bar_bottom.mouse_filter = Control.MOUSE_FILTER_IGNORE
	el.add_child(_bar_bottom)
	# title card (flyover)
	var tcol := VBoxContainer.new()
	tcol.position = Vector2(48, 96)
	tcol.mouse_filter = Control.MOUSE_FILTER_IGNORE
	tcol.add_child(UIKit.label(I18n.t("LIVE · QUALIFYING SESSION"), 16, UIKit.ACCENT, true, 700))
	tcol.add_child(UIKit.label(I18n.t(info.trackName), 60, UIKit.TEXT, true, 700))
	var facts := HBoxContainer.new()
	facts.add_theme_constant_override("separation", 18)
	for f in info.facts:
		facts.add_child(UIKit.label(f, 18, UIKit.MUTED))
	tcol.add_child(facts)
	tcol.add_child(UIKit.label(info.format, 17, UIKit.MUTED))
	_title = tcol
	el.add_child(tcol)
	# the track map and the entry list
	var side := VBoxContainer.new()
	side.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	side.offset_left = -300
	side.offset_right = -24
	side.offset_top = 80
	side.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_map = CineMap.new(track)
	_map.custom_minimum_size = Vector2(250, 170)
	side.add_child(_map)
	var sorted := entrants.duplicate()
	sorted.sort_custom(func(a, b): return a.slot < b.slot)
	for e in sorted:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 6)
		row.add_child(UIKit.label("P%d" % (e.slot + 1), 14, UIKit.ACCENT_2 if e.me else UIKit.MUTED, true, 700))
		var sw := ColorRect.new()
		sw.color = Color(e.color)
		sw.custom_minimum_size = Vector2(4, 14)
		row.add_child(sw)
		row.add_child(UIKit.label(e.nick, 14, UIKit.ACCENT_2 if e.me else UIKit.TEXT, false, 700 if e.me else 500))
		side.add_child(row)
	_side = side
	el.add_child(side)
	# the driver card of the grid pass
	_card = PanelContainer.new()
	_card.add_theme_stylebox_override("panel", UIKit.box(Color(0, 0, 0, 0.7), UIKit.LINE, 1, 3, Vector2(14, 10)))
	_card.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	_card.position = Vector2(48, 0)
	_card.offset_top = -190
	_card.offset_left = 48
	_card.visible = false
	_card.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var crow := HBoxContainer.new()
	crow.add_theme_constant_override("separation", 12)
	_card_pos = UIKit.label("", 40, UIKit.ACCENT_2, true, 700)
	crow.add_child(_card_pos)
	_card_stripe = ColorRect.new()
	_card_stripe.custom_minimum_size = Vector2(6, 48)
	crow.add_child(_card_stripe)
	var who := VBoxContainer.new()
	_card_nick = UIKit.label("", 28, UIKit.TEXT, true, 700)
	_card_car = UIKit.label("", 16, UIKit.MUTED)
	who.add_child(_card_nick)
	who.add_child(_card_car)
	crow.add_child(who)
	_card.add_child(crow)
	el.add_child(_card)
	_skip = UIKit.label(I18n.t("Tap to skip") if DisplayServer.is_touchscreen_available() else I18n.t("Enter: skip"), 14, UIKit.MUTED)
	_skip.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	_skip.offset_left = -140
	_skip.offset_top = -48
	el.add_child(_skip)

## True during the aerial flyover (high camera).
var aerial: bool:
	get:
		return active and _phase == "fly"

func skip() -> void:
	if _phase == "done":
		return
	_phase = "done"
	_finish()

func _finish() -> void:
	active = false
	var tw := el.create_tween()
	tw.tween_property(el, "modulate:a", 0.0, 0.9)
	tw.tween_callback(el.queue_free)

func _grid_ms() -> float:
	return minf(MAX_GRID_MS, maxf(MIN_GRID_MS, order.size() * PER_CAR_MS))

## ms_to_start: milliseconds until the green light, or null while drivers are still loading.
## Returns true while the cinematic owns the camera.
func update(dt: float, ms_to_start) -> bool:
	if not active:
		return false
	_t += dt
	var grid_ms := _grid_ms()
	if ms_to_start != null and ms_to_start <= HANDOVER_MS:
		_phase = "done"
		_finish()
		return false
	var in_grid: bool = ms_to_start != null and ms_to_start <= HANDOVER_MS + grid_ms
	if in_grid and _phase == "fly":
		_phase = "grid"
		_title.visible = false
		_map.visible = false
	if _phase == "fly":
		_flyover()
	else:
		_grid_pass(1.0 - (float(ms_to_start) - HANDOVER_MS) / grid_ms)
	_map.progress = clampf(_t / 8.0, 0.0, 1.0)
	return true

func _flyover() -> void:
	# a tight, high orbit looking steeply down: the circuit fills the frame and the map's edge stays hidden
	var a := _t * 0.07 + 0.6
	var r := _radius * (0.42 - 0.06 * sin(_t * 0.11))
	var pos := Vector3(_center.x + sin(a) * r, _center.y + _radius * 0.62, _center.z + cos(a) * r)
	var look := _center
	look.y -= _radius * 0.1
	camera.global_position = pos
	camera.look_at(look, Vector3.UP)
	_set_card(-1)

## u: 0 → 1 over the grid pass. The camera tracks down the middle of the grid, looking at each car in turn.
func _grid_pass(u: float) -> void:
	var n := order.size()
	if n == 0:
		return
	var x := minf(n - 1e-6, maxf(0.0, u * n))
	var i := int(floorf(x))
	var f := smoothstep(0.0, 1.0, x - i)
	var a: Dictionary = order[i]
	var b: Dictionary = order[mini(n - 1, i + 1)]
	var ga: Dictionary = track.grid[a.slot] if a.slot < track.grid.size() else track.grid[0]
	var gb: Dictionary = track.grid[b.slot] if b.slot < track.grid.size() else track.grid[0]
	var pa := Vector3(ga.p[0], ga.p[1] + 0.7, ga.p[2])
	var pb := Vector3(gb.p[0], gb.p[1] + 0.7, gb.p[2])
	var target := pa.lerp(pb, f * 0.35 if i + 1 < n else 0.0)
	# camera on the grid's centre line, a few metres ahead of the car it looks at, low like a TV dolly
	var along := (target.x - _grid_mid.x) * _grid_fwd.x + (target.z - _grid_mid.z) * _grid_fwd.z
	camera.global_position = Vector3(_grid_mid.x + _grid_fwd.x * (along + 6.5), target.y + 0.9 + 0.4 * sin(_t * 0.8), _grid_mid.z + _grid_fwd.z * (along + 6.5))
	camera.look_at(target, Vector3.UP)
	_set_card(i if x - i < 0.85 or i + 1 >= n else i + 1)

func _set_card(i: int) -> void:
	if i == _card_key:
		return
	_card_key = i
	if i < 0:
		_card.visible = false
		return
	var e: Dictionary = order[i]
	_card_pos.text = "P%d" % (e.slot + 1)
	_card_stripe.color = Color(e.color)
	_card_nick.text = "%s%s%s" % [e.nick, I18n.t("  ·  YOU") if e.me else "", I18n.t("  ·  AI") if e.bot else ""]
	_card_car.text = e.carName
	_card.visible = true
	# restart the slide-in
	_card.modulate.a = 0.0
	var tw := _card.create_tween()
	tw.tween_property(_card, "modulate:a", 1.0, 0.35)

## The circuit as a polyline that draws itself.
class CineMap:
	extends Control
	var progress := 0.0:
		set(v):
			progress = v
			queue_redraw()
	var _pts := PackedVector2Array()
	var _size := Vector2.ONE

	func _init(track: Dictionary) -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		var cl: Array = track.centerline
		var lo := Vector2(INF, INF)
		var hi := Vector2(-INF, -INF)
		for i in range(0, cl.size(), 6):
			var p := Vector2(cl[i], cl[i + 2])
			lo = lo.min(p)
			hi = hi.max(p)
			_pts.append(p)
		_size = hi - lo
		for i in _pts.size():
			_pts[i] -= lo

	func _draw() -> void:
		if _pts.size() < 2:
			return
		var box := size - Vector2(24, 24)
		var s := minf(box.x / maxf(1.0, _size.x), box.y / maxf(1.0, _size.y))
		var off := (size - _size * s) * 0.5
		var pts := PackedVector2Array()
		for p in _pts:
			pts.append(off + p * s)
		pts.append(pts[0])
		draw_polyline(pts, Color(1, 1, 1, 0.2), 4.0, true)
		var n := maxi(2, int(pts.size() * progress))
		draw_polyline(pts.slice(0, n), UIKit.ACCENT, 4.0, true)
		draw_circle(pts[0], 7.0, UIKit.ACCENT_2)
