class_name PhoneSpeed
extends Control
## The phone HUD's speed (the user's mobile references, 2026-11-22: "avoid occupying so much screen space"): a
## segmented rev arc over the speed, the gear beside it with AT / MT under it. Takes the place of the driver's dial (HudDial) on
## a touch screen, at the bottom centre between the steering pad and the pedals. Drawn, not built from nodes: set()
## every frame, a redraw only when a shown value changes.

## Its size before the HUD's scale (units).
const SIZE := Vector2(190, 66)
## The arc's share of the revs where it turns from white to red (the shift lights' window).
const RED_FROM := 0.86
## The rev arc: how many segments, its radius and half its width (units); a big radius keeps it shallow.
const SEGMENTS := 14
const ARC_RADIUS := 180.0
const ARC_HALF_SPAN := 54.0

var _speed := -1
var _gear := -99
var _manual := false
var _unit := "km/h"
## The revs as a share of the limiter, to the hundredth (redrawn when that changes).
var _rev := -1.0

func _init() -> void:
	custom_minimum_size = SIZE
	size = SIZE
	mouse_filter = Control.MOUSE_FILTER_IGNORE

func set_values(speed: float, unit: String, gear: int, manual: bool, rpm: float, limiter: float) -> void:
	var sp := roundi(absf(speed))
	var rev := snappedf(clampf(rpm / maxf(limiter, 1.0), 0.0, 1.0), 0.01)
	if sp == _speed and gear == _gear and manual == _manual and unit == _unit and is_equal_approx(rev, _rev):
		return
	_speed = sp
	_gear = gear
	_manual = manual
	_unit = unit
	_rev = rev
	queue_redraw()

func _draw() -> void:
	var w := SIZE.x
	# the rev arc (the reference's): a wide shallow arc of segments over the speed, lit with the revs, red near the
	# limiter, a dot riding above its lit end
	var c := Vector2(w * 0.31, ARC_RADIUS + 8.0)
	var half := asin(ARC_HALF_SPAN / ARC_RADIUS)
	var a0 := -PI * 0.5 - half
	var step := 2.0 * half / SEGMENTS
	var gap := step * 0.28
	for i in SEGMENTS:
		var share := (i + 1.0) / SEGMENTS
		var lit := _rev >= share - 0.5 / SEGMENTS
		var col := Color(1, 1, 1, 0.16)
		if lit:
			col = Color(1, 0.2, 0.22) if share > RED_FROM else Color(1, 1, 1, 0.85)
		var s0 := a0 + i * step + gap * 0.5
		draw_arc(c, ARC_RADIUS, s0, s0 + step - gap, 4, col, 4.0, true)
	if _rev > 0.0:
		var at := a0 + 2.0 * half * _rev
		var dot_col := Color(1, 0.2, 0.22) if _rev > RED_FROM else Color.WHITE
		draw_circle(c + Vector2(cos(at), sin(at)) * (ARC_RADIUS + 7.0), 2.5, dot_col, true, -1.0, true)
	# the speed under the arc, its unit under it
	var fd := UIKit.font(true, 800)
	var fs := UIKit.font(false, 600)
	var sp := str(maxi(_speed, 0))
	draw_string(fd, Vector2(0, 49), sp, HORIZONTAL_ALIGNMENT_CENTER, w * 0.62, 30, Color.WHITE)
	draw_string(fs, Vector2(0, 63), _unit, HORIZONTAL_ALIGNMENT_CENTER, w * 0.62, 11, Color(1, 1, 1, 0.7))
	# a thin divider, the gear and its box type
	draw_line(Vector2(w * 0.66, 24), Vector2(w * 0.66, 62), Color(1, 1, 1, 0.35), 1.5)
	var g := "R" if _gear < 0 else ("N" if _gear == 0 else str(_gear))
	draw_string(fd, Vector2(w * 0.7, 49), g, HORIZONTAL_ALIGNMENT_CENTER, w * 0.26, 30, Color.WHITE)
	draw_string(fs, Vector2(w * 0.7, 63), "MT" if _manual else "AT", HORIZONTAL_ALIGNMENT_CENTER, w * 0.26, 11, Color(1, 1, 1, 0.7))
