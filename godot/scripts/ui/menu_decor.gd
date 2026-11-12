class_name MenuDecor
extends Control
## The menus' backdrop over the circuit photo (after Le Mans Ultimate's): a navy tint on the left turning crimson on the
## right and darker at the bottom, so white text reads anywhere; the livery's crimson slash in the top-left corner under
## the logo; a white corner with hatch stripes at the bottom right. Drawn once per resize (no per-frame work).

func _init() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE

func _notification(what: int) -> void:
	if what == NOTIFICATION_RESIZED:
		queue_redraw()

func _draw() -> void:
	var w := size.x
	var h := size.y
	if w <= 0.0 or h <= 0.0:
		return
	# the tint: navy left, wine right, both deeper towards the bottom
	draw_polygon(PackedVector2Array([Vector2(0, 0), Vector2(w, 0), Vector2(w, h), Vector2(0, h)]), PackedColorArray([
		Color(0.02, 0.05, 0.14, 0.62), Color(0.26, 0.02, 0.07, 0.5), Color(0.1, 0.02, 0.06, 0.82), Color(0.01, 0.03, 0.1, 0.86)]))
	# a darker band behind the content's middle keeps rows readable over bright photos
	draw_polygon(PackedVector2Array([Vector2(w * 0.42, 0), Vector2(w * 0.78, 0), Vector2(w * 0.5, h), Vector2(w * 0.14, h)]), PackedColorArray([
		Color(0, 0.01, 0.04, 0.0), Color(0, 0.01, 0.04, 0.22), Color(0, 0.01, 0.04, 0.22), Color(0, 0.01, 0.04, 0.0)]))
	# the livery slash: solid crimson along its edge, lighter into the corner
	var s := h * 0.6
	var c := UIKit.CRIMSON
	draw_polygon(PackedVector2Array([Vector2(0, 0), Vector2(s * 0.72, 0), Vector2(0, s)]), PackedColorArray([
		Color(c.lightened(0.12), 0.62), Color(c, 0.86), Color(c, 0.86)]))
	draw_polygon(PackedVector2Array([Vector2(s * 0.72, 0), Vector2(s * 0.8, 0), Vector2(0, s * 1.11), Vector2(0, s)]), PackedColorArray([
		Color(1, 1, 1, 0.16), Color(1, 1, 1, 0.0), Color(1, 1, 1, 0.0), Color(1, 1, 1, 0.16)]))
	# the white corner and its hatch
	var k := minf(h * 0.13, 120.0)
	draw_polygon(PackedVector2Array([Vector2(w - k, h), Vector2(w, h - k), Vector2(w, h)]), PackedColorArray([Color(1, 1, 1, 0.8), Color(1, 1, 1, 0.8), Color(1, 1, 1, 0.8)]))
	var line := Color(1, 1, 1, 0.55)
	for i in 6:
		var d := k + 10.0 + i * 9.0
		draw_line(Vector2(w - d, h), Vector2(w, h - d), line, 2.0, true)
