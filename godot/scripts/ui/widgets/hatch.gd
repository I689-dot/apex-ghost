extends Control
## Diagonal stripes filling the bottom-right half of its square (the references' hatched card corners).

var colour: Color
var gap := 6.0

func _init(c: Color = Color(1, 1, 1, 0.5), sz: Vector2 = Vector2(48, 48)) -> void:
	colour = c
	custom_minimum_size = sz
	mouse_filter = Control.MOUSE_FILTER_IGNORE

func _draw() -> void:
	var s := minf(size.x, size.y)
	var o := Vector2(size.x - s, size.y - s)
	var t := gap
	while t <= s:
		draw_line(o + Vector2(s - t, s), o + Vector2(s, s - t), colour, 2.0, true)
		t += gap
