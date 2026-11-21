class_name HudDial
extends Control
## The driver's dial (port of the web game's ui/dial.ts, 2026-11-13): a ring of revs round a dark face with the gear
## big in the middle and the speed under it, the headlights, assist and engine lamps beside the gear, and the fuel as
## a bar below. The ring turns amber, then blue towards the limiter (the shift lights of a real wheel). Redraws only
## when a shown value changes.

const SIZE := 210.0
## The ring covers 270 degrees from the bottom left, over the top, to the bottom right.
const SWEEP := 0.75
const RING_R := 92.0 * SIZE / 200.0
const RING_W := 8.0 * SIZE / 200.0
const WHITE := Color(1, 1, 1)
const AMBER := Color("ffb020")
const BLUE := Color("2f9bff")
const LAMP_OFF := Color(1, 1, 1, 0.28)

var speed := 0.0
var unit := "KM/H"
var gear := 0
var manual := false
var rpm := 0.0
var redline := 7000.0
var limiter := 7500.0
var abs_on := false
var tc_on := false
var headlights := false
var engine := 0.0
## Fuel: {frac, litres, laps}, or {} without the fuel rule.
var fuel := {}
var fuel_low := false
## The revs ring (the HUD setting "rev lights").
var show_ring := true
var _key := ""
var _blink := 0.0

func _init() -> void:
	custom_minimum_size = Vector2(SIZE, SIZE)
	size = custom_minimum_size
	mouse_filter = Control.MOUSE_FILTER_IGNORE

func update_dial(s: Dictionary) -> void:
	speed = s.speed
	unit = s.unit
	gear = s.gear
	manual = s.manual
	rpm = s.rpm
	redline = s.redline
	limiter = s.limiter
	abs_on = s.abs
	tc_on = s.tc
	headlights = s.headlights
	engine = s.engine
	fuel = s.fuel
	fuel_low = s.fuelLow
	var pct := roundf(clampf(rpm / maxf(1.0, limiter), 0.0, 1.0) * 200.0) / 2.0
	var key := "%d|%s|%d|%s|%.1f|%s%s%s%d|%s|%s|%s" % [roundi(absf(speed)), unit, gear, manual, pct, headlights, tc_on, abs_on, roundi(engine * 10.0), str(fuel.get("litres", -1.0)).left(5), fuel_low, show_ring]
	if key != _key:
		_key = key
		queue_redraw()

func _process(dt: float) -> void:
	# the low-fuel bar pulses
	if fuel_low and not fuel.is_empty():
		_blink += dt
		queue_redraw()

## The part of the ring between two percentages of its arc.
func _arc(from_pct: float, to_pct: float, col: Color, width: float = RING_W) -> void:
	if to_pct <= from_pct:
		return
	var c := Vector2(SIZE, SIZE) * 0.5
	# 0 % at the bottom left (135 degrees round from the right, clockwise on screen), 100 % at the bottom right
	var a0 := deg_to_rad(135.0) + TAU * SWEEP * from_pct / 100.0
	var a1 := deg_to_rad(135.0) + TAU * SWEEP * to_pct / 100.0
	draw_arc(c, RING_R, a0, a1, maxi(4, int((to_pct - from_pct) * 0.9)), col, width, true)

func _text(s: String, centre: Vector2, size_px: int, weight: int, col: Color) -> void:
	var f := UIKit.font(true, weight)
	var sz := f.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, size_px)
	draw_string(f, Vector2(centre.x - sz.x / 2.0, centre.y + f.get_ascent(size_px) * 0.5 - f.get_descent(size_px) * 0.5), s, HORIZONTAL_ALIGNMENT_LEFT, -1, size_px, col)

func _draw() -> void:
	var c := Vector2(SIZE, SIZE) * 0.5
	# the face: dark, lighter towards the top (radial, from 50 % / 30 %)
	var face_r := SIZE * 0.5 - 19.0
	var pts := PackedVector2Array()
	var cols := PackedColorArray()
	var hi := c + Vector2(0, -face_r * 0.4)
	var n := 64
	for i in n:
		var a := TAU * i / n
		var p := c + Vector2(cos(a), sin(a)) * face_r
		pts.append(p)
		var t := clampf(p.distance_to(hi) / (face_r * 1.44), 0.0, 1.0)
		cols.append(Color(40 / 255.0, 45 / 255.0, 54 / 255.0, 0.92).lerp(Color(8 / 255.0, 10 / 255.0, 13 / 255.0, 0.93), t))
	# a fan round the highlight: the polygon's colours blend from the edge points, the highlight's in the middle
	for i in n:
		var tri := PackedVector2Array([hi, pts[i], pts[(i + 1) % n]])
		var tc := PackedColorArray([Color(40 / 255.0, 45 / 255.0, 54 / 255.0, 0.92), cols[i], cols[(i + 1) % n]])
		draw_polygon(tri, tc)
	draw_arc(c, face_r, 0.0, TAU, 64, Color(1, 1, 1, 0.08), 1.0, true)
	# the ring: its track, the shift zones, then the revs (white to the zone, amber in it, blue at the cut)
	if show_ring:
		var lim := maxf(1.0, limiter)
		var red := minf(100.0, redline / lim * 100.0)
		var a := red * 0.86
		var b := red * 0.97
		var pct := clampf(rpm / lim * 100.0, 0.0, 100.0)
		_arc(0.0, 100.0, Color(1, 1, 1, 0.13))
		_arc(a, b, Color(1, 176 / 255.0, 32 / 255.0, 0.5))
		_arc(b, 100.0, Color(47 / 255.0, 155 / 255.0, 1.0, 0.55))
		_arc(0.0, minf(pct, a), WHITE)
		_arc(a, maxf(a, minf(pct, b)), AMBER)
		if pct > b:
			_arc(b, pct, Color(BLUE, 0.35), RING_W * 2.2)
			_arc(b, pct, BLUE)
	# the gear, the speed and its unit (the column sits a little above the middle)
	var gs := "R" if gear < 0 else ("N" if gear == 0 else str(gear))
	_text(gs, c + Vector2(0, -22), 74, 800, Color(1, 1, 1, 0.55) if gear == 0 else WHITE)
	if manual:
		_text("M", c + Vector2(30, -38), 12, 700, UIKit.MUTED)
	_text(str(roundi(absf(speed))), c + Vector2(0, 26), 34, 700, WHITE)
	_text(unit, c + Vector2(0, 50), 12, 500, UIKit.MUTED)
	# the lamps left of the gear: headlights, TC, ABS, engine
	var lx := SIZE * 0.25
	var y := SIZE * 0.3
	_headlight_icon(Vector2(lx, y), Color("4db2ff") if headlights else LAMP_OFF)
	_boxed("TC", Vector2(lx, y + 27.0), Color("ffd60a") if tc_on else LAMP_OFF)
	_boxed("ABS", Vector2(lx, y + 48.0), Color("ffd60a") if abs_on else LAMP_OFF)
	_engine_icon(Vector2(lx, y + 72.0), Color("ff453a") if engine > 0.7 else (AMBER if engine > 0.25 else LAMP_OFF))
	# the fuel bar under the face
	if not fuel.is_empty():
		var w := 170.0
		var r := Rect2(c.x - w / 2.0, SIZE - 44.0, w, 20.0)
		draw_style_box(UIKit.box(Color(1, 69 / 255.0, 58 / 255.0, 0.22), Color(0, 0, 0, 0.4), 1, 4), r)
		draw_style_box(UIKit.box(Color(1, 90 / 255.0, 80 / 255.0, 0.85), Color(0, 0, 0, 0), 0, 4), Rect2(r.position, Vector2(w * clampf(float(fuel.frac), 0.0, 1.0), 20.0)))
		if fuel_low:
			var k := 0.5 + 0.5 * sin(_blink * PI / 0.8)
			draw_rect(r.grow(1.0), Color(1, 69 / 255.0, 58 / 255.0, k), false, 2.0)
		_text(I18n.t("{l} L ({laps} laps)", {"l": "%.1f" % float(fuel.litres), "laps": "%.1f" % float(fuel.laps)}), r.get_center(), 12, 700, WHITE)

func _boxed(s: String, centre: Vector2, col: Color) -> void:
	var f := UIKit.font(true, 800)
	var sz := f.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, 9)
	var r := Rect2(centre - Vector2(sz.x / 2.0 + 3.0, 8.0), Vector2(sz.x + 6.0, 16.0))
	draw_rect(r, col, false, 1.0)
	_text(s, centre, 9, 800, col)

func _headlight_icon(centre: Vector2, col: Color) -> void:
	# a lamp's dome and three beams (the web dial's icon, 22 px)
	var o := centre - Vector2(11, 11)
	var dome := PackedVector2Array()
	for i in 13:
		var a := -PI * 0.5 + PI * i / 12.0
		dome.append(o + Vector2(11.0 - cos(a) * 8.0, 12.0 + sin(a) * 7.0))
	dome.append(dome[0])
	draw_polyline(dome, col, 1.6, true)
	for k: int in [-1, 0, 1]:
		draw_line(o + Vector2(15.5, 12.0 + k * 5.0), o + Vector2(21.0, 12.0 + k * 6.5), col, 1.6, true)

func _engine_icon(centre: Vector2, col: Color) -> void:
	var o := centre - Vector2(11, 11)
	var p := PackedVector2Array([Vector2(3, 10), Vector2(6, 10), Vector2(7, 8), Vector2(10, 8), Vector2(10, 6), Vector2(14, 6), Vector2(14, 8), Vector2(16, 8), Vector2(18, 10), Vector2(21, 10), Vector2(21, 16), Vector2(18, 16), Vector2(16, 18), Vector2(9, 18), Vector2(7, 16), Vector2(3, 16), Vector2(3, 10)])
	for i in p.size():
		p[i] = o + p[i]
	draw_polyline(p, col, 1.6, true)
