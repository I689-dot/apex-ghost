class_name CarStatus
extends Control
## Car status instrument, as on a GT3 dash / F1 game HUD (port of ui/carStatus.ts): your own car seen from above (its
## line drawing, a drawn outline until then) with the four tyres coloured by temperature (the temperature in C next to
## each), the tread worn, the brake discs, the fitted compound, and ABS / traction-control lamps. Drawn in a 120 x 110
## unit box scaled to 200 px wide.

const TYRE_COLOURS := {"cold": Color("3a86ff"), "warm": Color("5ec8ff"), "ok": Color("30d158"), "hot": Color("ff453a")}
const BOX_W := 120.0
const BOX_H := 110.0

var _scale := 200.0 / BOX_W
## Per wheel: {rect: Rect2 (box units), temp, wear, brake colour, label pos}
var _tyres: Array = []
var _temps := [0, 0, 0, 0]
var _wear := [0.0, 0.0, 0.0, 0.0]
var _brake_cols := [Color("5ec8ff"), Color("5ec8ff"), Color("5ec8ff"), Color("5ec8ff")]
var _compound := "medium"
var _abs := false
var _tc := false
var _zones := [0.0, 0.0, 0.0, 0.0, 0.0]
var art := CarLineArt.new()
var _car_rect := Rect2(40, 3, 40, 97)
var _zone_rects: Array = [Rect2(40, 2, 40, 18), Rect2(40, 84, 40, 18), Rect2(40, 20, 9, 64), Rect2(71, 20, 9, 64), Rect2(52, 62, 16, 18)]
var _badge_y := 62.0
var _has_car := false
var _entry: Dictionary = {}
var _key := ""

func _init() -> void:
	custom_minimum_size = Vector2(200, 200 * BOX_H / BOX_W + 22)
	size = custom_minimum_size
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	for i in 4:
		_tyres.append({"rect": Rect2([33, 79, 33, 79][i], [18, 18, 68, 68][i], 8, 18), "cx": [37, 83, 37, 83][i], "cy": [27, 27, 77, 77][i], "label_x": [30.0, 90.0, 30.0, 90.0][i], "tread": 16.0})

## Where the engine sits: front-engined (BMW, Mercedes, Aston, Ford, Lexus), rear (911), the rest mid-engined.
static func engine_at(id: String) -> String:
	if RegEx.create_from_string("porsche").search(id) != null:
		return "rear"
	if RegEx.create_from_string("bmw|mercedes_amg_gt3|amg_gt3|vantage|aston|mustang|lexus").search(id) != null:
		return "front"
	return "mid"

## Around the compound's own window (not fixed numbers: wets at their best showed blue).
static func tyre_colour(t: float, optimum_c: float) -> Color:
	if t < optimum_c - 20.0:
		return TYRE_COLOURS.cold
	if t < optimum_c - 8.0:
		return TYRE_COLOURS.warm
	if t <= optimum_c + 18.0:
		return TYRE_COLOURS.ok
	return TYRE_COLOURS.hot

static func damage_colour(d: float) -> Color:
	if d < 0.05:
		return Color(0, 0, 0, 0)
	if d < 0.3:
		return Color("ffd60a")
	if d < 0.6:
		return Color("ff9f0a")
	return Color("ff453a")

## The car you drive: the tyres, brakes and damage zones where that car has them (track, wheelbase, tyre sizes, the
## engine's place), from its line drawing's frame.
func set_car(entry: Dictionary, lines: TopView.Lines) -> void:
	_entry = entry
	if lines == null:
		return
	var length := lines.max_z - lines.min_z
	var k := minf(94.0 / length, 70.0 / (lines.max_x - lines.min_x))
	var sx := func(x: float) -> float: return 60.0 - (x - (lines.min_x + lines.max_x) / 2.0) * k
	var sy := func(z: float) -> float: return 4.0 + (lines.max_z - z) * k
	var w := (lines.max_x - lines.min_x) * k
	var top: float = sy.call(lines.max_z)
	var left: float = sx.call(lines.max_x)
	_car_rect = Rect2(left, top, w, length * k)
	_has_car = true
	var z0 := top
	var L := length * k
	var eng := engine_at(entry.id)
	var ey := z0 + L * 0.1 if eng == "front" else (z0 + L * 0.76 if eng == "rear" else z0 + L * 0.52)
	_zone_rects = [
		Rect2(left, z0, w, L * 0.2), Rect2(left, z0 + L * 0.8, w, L * 0.2), Rect2(left, z0 + L * 0.2, w * 0.24, L * 0.6),
		Rect2(left + w * 0.76, z0 + L * 0.2, w * 0.24, L * 0.6), Rect2(60.0 - w * 0.18, ey, w * 0.36, L * 0.2)]
	var keys := ["FL", "FR", "RL", "RR"]
	for i in 4:
		var wg: Dictionary = entry.wheels[keys[i]]
		var tw := maxf(5.0, 0.32 * k)
		var th: float = 2.0 * wg.radius * k
		var cx: float = sx.call(wg.position[0])
		var cy: float = sy.call(wg.position[2])
		var t: Dictionary = _tyres[i]
		t.rect = Rect2(cx - tw / 2.0, cy - th / 2.0, tw, th)
		t.cx = cx
		t.cy = cy
		t.tread = th - 2.0
		var left_side: bool = keys[i][1] == "L"
		t.label_x = minf(cx - tw / 2.0 - 2.0, left - 1.0) if left_side else maxf(cx + tw / 2.0 + 2.0 + tw * 0.0, left + w + 1.0)
	_badge_y = z0 + L * 0.62 if eng == "front" else z0 + L * 0.36
	queue_redraw()

## The car's line drawing (renderTopLines): it replaces the damage blocks.
func set_lines(entry: Dictionary, lines: TopView.Lines) -> void:
	art.set_car(entry, lines)
	_show_lines([0.0, 0.0, 0.0, 0.0, 0.0])

func _show_lines(zones: Array) -> void:
	if art.lines == null:
		return
	var zc: Array = zones.map(func(z): return CarLineArt.damage_colour(z))
	art.draw(zc, [zc[0], zc[0], zc[1], zc[1]])

## temps: FL, FR, RL, RR (C); zones: front, rear, left, right, engine (0..1).
func update_status(temps: Array, zones, abs_on: bool, tc_on: bool, compound: String, wear: Array, brakes: Array = []) -> void:
	var t: Array = temps.map(func(x): return roundi(x))
	var z: Array = []
	for i in 5:
		z.append(roundi((zones[i] if i < zones.size() else 0.0) * 20.0) / 20.0)
	var wr: Array = wear.map(func(x): return roundi(x * 50.0))
	var bk: Array = brakes.map(func(b): return "c" if b < 200.0 else ("o" if b <= 700.0 else ("h" if b <= 850.0 else "f")))
	var key := "%s|%s|%s%s|%s|%s|%s" % [t, z, abs_on, tc_on, compound, wr, bk]
	if key == _key:
		return
	_key = key
	_temps = t
	_zones = z
	_abs = abs_on
	_tc = tc_on
	_compound = compound
	_wear = wr.map(func(x): return minf(1.0, x / 50.0))
	var cmap := {"c": Color("5ec8ff"), "o": Color("30d158"), "h": Color("ff9f0a"), "f": Color("ff453a")}
	for i in 4:
		_brake_cols[i] = cmap[bk[i] if i < bk.size() else "c"]
	_show_lines(z)
	queue_redraw()

func _u(v: Vector2) -> Vector2:
	return v * _scale

func _draw() -> void:
	draw_style_box(UIKit.box(Color(6 / 255.0, 9 / 255.0, 8 / 255.0, 0.82), Color(0.19, 0.82, 0.35, 0.35), 1, 4), Rect2(Vector2.ZERO, size))
	var pad := Vector2(0, 6)
	var opt: float = Tyres.COMPOUNDS[_compound].optimumC
	# the car: its line drawing, or the drawn outline until it is ready
	if art.texture != null:
		var r := Rect2(pad + _car_rect.position * _scale, _car_rect.size * _scale)
		draw_texture_rect(art.texture, r, false)
	else:
		var body := PackedVector2Array([Vector2(48, 8), Vector2(60, 5), Vector2(72, 8), Vector2(77, 22), Vector2(78, 86), Vector2(72, 98), Vector2(60, 100), Vector2(48, 98), Vector2(42, 86), Vector2(43, 22)])
		var pts := PackedVector2Array()
		for p in body:
			pts.append(pad + _u(p))
		draw_colored_polygon(pts, Color(1, 1, 1, 0.1))
		pts.append(pts[0])
		draw_polyline(pts, Color(1, 1, 1, 0.75), 1.4 * _scale, true)
		for i in 5:
			var zc := damage_colour(_zones[i])
			if zc.a > 0.0:
				var zr := Rect2(pad + _zone_rects[i].position * _scale, _zone_rects[i].size * _scale)
				draw_rect(zr, Color(zc, 0.35 + 0.5 * _zones[i]))
	var f := UIKit.font(true, 800)
	for i in 4:
		var tdat: Dictionary = _tyres[i]
		var col := tyre_colour(_temps[i], opt)
		var r2 := Rect2(pad + tdat.rect.position * _scale, tdat.rect.size * _scale)
		draw_rect(r2, Color(col, 0.28))
		draw_rect(r2, col, false, 1.3 * _scale * 0.6)
		# tread left: a dark bar that grows from the top as the tyre wears
		draw_rect(Rect2(r2.position + Vector2(1, 1) * _scale, Vector2((tdat.rect.size.x - 2.0) * _scale, tdat.tread * _wear[i] * _scale)), Color(0, 0, 0, 0.55))
		# brake disc: a dot on the hub
		draw_circle(pad + Vector2(tdat.cx, tdat.cy) * _scale, 2.2 * _scale, _brake_cols[i])
		var txt := "%d°" % _temps[i]
		var fs := int(9.5 * _scale)
		var tsz := f.get_string_size(txt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs)
		var lx: float = tdat.label_x * _scale
		var left_side := i % 2 == 0
		draw_string(f, pad + Vector2(lx - (tsz.x if left_side else 0.0), tdat.cy * _scale + 3.0 * _scale), txt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, col)
	# fitted compound: Pirelli-style coloured ring with its letter
	var c: Dictionary = Tyres.COMPOUNDS[_compound]
	var bc := pad + Vector2(60, _badge_y) * _scale
	draw_circle(bc, 7.0 * _scale, Color(0, 0, 0, 0.6))
	draw_arc(bc, 7.0 * _scale, 0.0, TAU, 32, Color(c.colour), 2.2 * _scale * 0.6, true)
	var lsz := f.get_string_size(c.letter, HORIZONTAL_ALIGNMENT_LEFT, -1, int(8.0 * _scale))
	draw_string(f, bc + Vector2(-lsz.x / 2.0, lsz.y * 0.3), c.letter, HORIZONTAL_ALIGNMENT_LEFT, -1, int(8.0 * _scale), Color(c.colour))
	# ABS lamp: "ABS" in a circle between brackets; traction control: a car with skid lines
	var on := Color("ffb000")
	var off := Color(1, 1, 1, 0.28)
	var abs_c := on if _abs else off
	var ac := pad + Vector2(13, 101) * _scale
	draw_arc(ac, 7.0 * _scale, 0.0, TAU, 24, abs_c, 1.4 * _scale * 0.6, true)
	var fb := UIKit.font(false, 600)
	draw_string(fb, ac + Vector2(-5.0 * _scale * 0.5 - 1.0, 2.0 * _scale), "ABS", HORIZONTAL_ALIGNMENT_LEFT, -1, int(5.2 * _scale), abs_c)
	var tc_c := on if _tc else off
	var tp := pad + Vector2(98, 92) * _scale
	draw_polyline(PackedVector2Array([tp + Vector2(3, 9) * _scale, tp + Vector2(5, 4) * _scale, tp + Vector2(13, 4) * _scale, tp + Vector2(15, 9) * _scale, tp + Vector2(15, 12) * _scale, tp + Vector2(3, 12) * _scale, tp + Vector2(3, 9) * _scale]), tc_c, 1.4 * _scale * 0.6, true)
	for sx in [4.0, 9.0, 14.0]:
		draw_line(tp + Vector2(sx, 14) * _scale, tp + Vector2(sx + 1.0, 18) * _scale, tc_c, 1.4 * _scale * 0.6, true)
	# caption
	var cap := I18n.t("TYRES °C · DAMAGE")
	var cf := UIKit.font(true, 800)
	var csz := cf.get_string_size(cap, HORIZONTAL_ALIGNMENT_LEFT, -1, 11)
	draw_string(cf, Vector2((size.x - csz.x) / 2.0, size.y - 6.0), cap, HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color("30d158"))
