class_name RaceOverlays
extends RefCounted
## Race overlays after iRacing and ACC, beside the HUD (port of ui/overlays.ts): the relative box, the delta bar,
## the inputs widget, the spotter bands and the delta under the mirror. Each can be switched off in the settings.
## The controls are built here; the Hud places them.

const INPUT_W := 540.0
const INPUT_H := 112.0

class InputsWidget:
	extends Control
	var throttle := 0.0
	var brake := 0.0
	var steer := 0.0
	var gear := 0
	var speed := 0.0
	var unit := "km/h"
	var trace := PackedFloat32Array()
	var trace_at := 0

	func _init() -> void:
		custom_minimum_size = Vector2(INPUT_W, INPUT_H)
		size = Vector2(INPUT_W, INPUT_H)
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		trace.resize(150 * 2)

	func _draw() -> void:
		var W := INPUT_W
		var H := INPUT_H
		draw_style_box(UIKit.box(Color(14 / 255.0, 16 / 255.0, 20 / 255.0, 0.82), Color(0, 0, 0, 0), 0, 14), Rect2(0, 0, W, H))
		var tx := 12.0
		var tw := 230.0
		var ty := 12.0
		var th := H - 24.0
		for f in [0.25, 0.5, 0.75]:
			draw_line(Vector2(tx, ty + th * f), Vector2(tx + tw, ty + th * f), Color(1, 1, 1, 0.08), 1.0)
		var cols := [Color("30d158"), Color("ff453a")]
		for k in 2:
			var pts := PackedVector2Array()
			for i in 150:
				var v := trace[((trace_at + i) % 150) * 2 + k]
				pts.append(Vector2(tx + (i / 149.0) * tw, ty + th - v * th))
			draw_polyline(pts, cols[k], 3.0, true)
		_bar(tx + tw + 14.0, brake, Color("ff453a"), ty, th)
		_bar(tx + tw + 38.0, throttle, Color("30d158"), ty, th)
		# the gear on yellow
		var gx := tx + tw + 70.0
		draw_style_box(UIKit.box(Color("ffd60a"), Color(0, 0, 0, 0), 0, 6), Rect2(gx, ty + 6.0, 46.0, th - 12.0))
		var f56 := UIKit.font(true, 700)
		var gs := "R" if gear < 0 else ("N" if gear == 0 else str(gear))
		var gsz := f56.get_string_size(gs, HORIZONTAL_ALIGNMENT_CENTER, -1, 56)
		draw_string(f56, Vector2(gx + 23.0 - gsz.x / 2.0, ty + th / 2.0 + 2.0 + gsz.y * 0.3), gs, HORIZONTAL_ALIGNMENT_LEFT, -1, 56, Color("111111"))
		# the speed
		var ss := str(roundi(absf(speed)))
		var ssz := f56.get_string_size(ss, HORIZONTAL_ALIGNMENT_CENTER, -1, 40)
		draw_string(f56, Vector2(gx + 100.0 - ssz.x / 2.0, ty + th / 2.0 - 8.0 + ssz.y * 0.3), ss, HORIZONTAL_ALIGNMENT_LEFT, -1, 40, Color.WHITE)
		var usz := UIKit.font(true, 500).get_string_size(unit, HORIZONTAL_ALIGNMENT_CENTER, -1, 20)
		draw_string(UIKit.font(true, 500), Vector2(gx + 100.0 - usz.x / 2.0, ty + th / 2.0 + 22.0 + usz.y * 0.3), unit, HORIZONTAL_ALIGNMENT_LEFT, -1, 20, Color(1, 1, 1, 0.6))
		# the wheel, turned as far as a real one would be (+-1 is about 270 degrees)
		var c := Vector2(W - 52.0, H / 2.0)
		var rot := -steer * deg_to_rad(270.0)
		draw_set_transform(c, rot)
		draw_arc(Vector2.ZERO, 34.0, 0.0, TAU, 40, Color.WHITE, 6.0, true)
		draw_polyline(PackedVector2Array([Vector2(-34, 4), Vector2(-10, 8), Vector2(10, 8), Vector2(34, 4)]), Color.WHITE, 7.0, true)
		draw_line(Vector2(0, 8), Vector2(0, 32), Color.WHITE, 7.0)
		draw_rect(Rect2(-4, -40, 8, 10), Color("ff453a"))
		draw_set_transform(Vector2.ZERO, 0.0)

	func _bar(x: float, v: float, col: Color, ty: float, th: float) -> void:
		draw_rect(Rect2(x, ty, 18.0, th), Color(1, 1, 1, 0.08))
		draw_rect(Rect2(x, ty + th * (1.0 - v), 18.0, th * v), col)

## Delta bar: green growing left when you gain on your best lap, red right when you lose, +-1 s full.
class DeltaBar:
	extends Control
	var f := 0.0

	func _init() -> void:
		custom_minimum_size = Vector2(260, 10)
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func _draw() -> void:
		draw_rect(Rect2(Vector2.ZERO, size), Color(0, 0, 0, 0.45))
		var mid := size.x / 2.0
		var w := absf(f) * mid
		if f <= 0.0:
			draw_rect(Rect2(mid - w, 0, w, size.y), UIKit.GOOD)
		else:
			draw_rect(Rect2(mid, 0, w, size.y), UIKit.BAD)
		draw_line(Vector2(mid, 0), Vector2(mid, size.y), Color(1, 1, 1, 0.6), 2.0)

## The spotter: a band on the side of the screen where a car is alongside.
class SpotBand:
	extends ColorRect
	func _init(left: bool) -> void:
		color = Color(1, 0.6, 0.0, 0.0)
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		custom_minimum_size = Vector2(14, 0)

var relative := VBoxContainer.new()
var delta_bar := DeltaBar.new()
var inputs := InputsWidget.new()
## The delta under the rear-view mirror (iRacing puts it there).
var mirror_delta := Label.new()
var spot_l := SpotBand.new(true)
var spot_r := SpotBand.new(false)
## Drivers' countries and numbers: {id: {country, num}} (set by the HUD).
var drivers := {}
var _rel_key := ""
var _trace_t := 0.0
var _last_md := ""

func _init() -> void:
	relative.add_theme_constant_override("separation", 1)
	relative.visible = false
	mirror_delta.add_theme_font_override("font", UIKit.font(true, 700))
	mirror_delta.add_theme_font_size_override("font_size", 20)

## Every frame: pedals 0..1, steering -1 (right) .. +1 (left) of full lock, delta to the best lap (ms) or null,
## gear (-1 R, 0 N), speed in the player's units with its label.
func update(throttle: float, brake: float, steer: float, delta_ms, gear: int = 0, speed: float = 0.0, unit: String = "km/h", dt: float = 1.0 / 60.0) -> void:
	var o: Dictionary = Settings.data.overlays
	inputs.visible = o.inputs
	if o.inputs:
		# 30 samples a second, 5 s of trace
		_trace_t += dt
		while _trace_t >= 1.0 / 30.0:
			_trace_t -= 1.0 / 30.0
			inputs.trace[inputs.trace_at * 2] = throttle
			inputs.trace[inputs.trace_at * 2 + 1] = brake
			inputs.trace_at = (inputs.trace_at + 1) % 150
		inputs.throttle = throttle
		inputs.brake = brake
		inputs.steer = steer
		inputs.gear = gear
		inputs.speed = speed
		inputs.unit = unit
		inputs.queue_redraw()
	delta_bar.visible = o.deltaBar and delta_ms != null
	if o.deltaBar and delta_ms != null:
		var q := roundf(clampf(delta_ms / 1000.0, -1.0, 1.0) * 100.0) / 100.0
		if q != delta_bar.f:
			delta_bar.f = q
			delta_bar.queue_redraw()
	var md := ""
	if delta_ms != null and Settings.data.mirror:
		md = "%s%.2f" % ["−" if delta_ms <= 0.0 else "+", absf(delta_ms) / 1000.0]
	if md != _last_md:
		_last_md = md
		mirror_delta.text = md
		mirror_delta.add_theme_color_override("font_color", UIKit.GOOD if delta_ms != null and delta_ms <= 0.0 else UIKit.BAD)

## ~10 Hz: the relative box and the spotter. rows: [{id, name, color, position, gapS, lap, inPit, me}].
func set_relative(rows: Array, left: bool, right: bool) -> void:
	var o: Dictionary = Settings.data.overlays
	spot_l.color.a = 0.55 if o.spotter and left else 0.0
	spot_r.color.a = 0.55 if o.spotter and right else 0.0
	relative.visible = o.relative and rows.size() >= 2
	if not relative.visible:
		return
	var key := "|".join(rows.map(func(r): return "%s%s%.1f%s%s" % [r.id, r.position, r.gapS, r.lap, r.inPit]))
	if key == _rel_key:
		return
	_rel_key = key
	for c in relative.get_children():
		c.queue_free()
	relative.add_child(UIKit.label(I18n.t("RELATIVE"), 12, Color(1, 1, 1, 0.65), true, 700))
	for r in rows:
		relative.add_child(_rel_row(r))

func _rel_row(r: Dictionary) -> Control:
	# iRacing's colours: you in gold, your lap white, a lap or more ahead red, behind blue, the pit lane grey
	var col := UIKit.ACCENT_2 if r.me else (Color("8b9099") if r.inPit else (Color("ff5a52") if r.lap == "ahead" else (Color("4aa3ff") if r.lap == "behind" else Color("f2f2f2"))))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	var bg := PanelContainer.new()
	bg.add_theme_stylebox_override("panel", UIKit.box(Color(0, 0, 0, 0.55 if not r.me else 0.7), Color(0, 0, 0, 0), 0, 0, Vector2(6, 1)))
	bg.add_child(row)
	var pos := UIKit.label(str(r.position), 14, col, true, 700)
	pos.custom_minimum_size.x = 24
	row.add_child(pos)
	var chip := ColorRect.new()
	chip.color = Color(r.color)
	chip.custom_minimum_size = Vector2(3, 14)
	row.add_child(chip)
	var nm := UIKit.label(r.name + (" PIT" if r.inPit else ""), 14, col, false, 600)
	nm.custom_minimum_size.x = 120
	row.add_child(nm)
	var gap := UIKit.label("" if r.me else "%s%.1f" % ["−" if r.gapS > 0.0 else "+", absf(r.gapS)], 14, col, true, 700)
	gap.custom_minimum_size.x = 48
	gap.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	row.add_child(gap)
	return bg
