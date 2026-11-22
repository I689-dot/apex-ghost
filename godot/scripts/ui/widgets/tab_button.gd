extends Button
## A tab of the top bar: capitals, dimmed unless current, a white underline under the current one.

var active := false
var small := false

func _init(text_in: String, is_active: bool, is_small: bool) -> void:
	text = text_in.to_upper()
	small = is_small
	focus_mode = Control.FOCUS_ALL
	var pad := Vector2(10, 8) if is_small else Vector2(12, 10)
	if UIKit.touch():
		pad += Vector2(4, 4)
	for st: String in ["normal", "hover", "pressed", "hover_pressed", "disabled"]:
		add_theme_stylebox_override(st, UIKit.box(Color(1, 1, 1, 0.07) if st == "hover" else Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 2, pad))
	add_theme_stylebox_override("focus", UIKit.focus_ring())
	add_theme_font_override("font", UIKit.font(true, 600))
	add_theme_font_size_override("font_size", (18 if is_small else 21) + (1 if UIKit.touch() else 0))
	add_theme_color_override("font_hover_color", Color.WHITE)
	add_theme_color_override("font_pressed_color", Color.WHITE)
	set_active(is_active)

## Current or not: white with the underline, or dimmed.
func set_active(on: bool) -> void:
	active = on
	var c := Color.WHITE if on else Color(1, 1, 1, 0.68)
	add_theme_color_override("font_color", c)
	add_theme_color_override("font_focus_color", c)
	queue_redraw()

func _draw() -> void:
	if active:
		var w := size.x - 20.0
		draw_rect(Rect2((size.x - w) * 0.5, size.y - 5.0, w, 2.5), Color.WHITE)
