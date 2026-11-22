extends Control
## A small weather symbol drawn from lines and circles (the forecast rows): sun, cloud, rain, fog.

var kind := "clear"

func _init(k: String, sz: float = 28.0) -> void:
	kind = k
	custom_minimum_size = Vector2(sz, sz)
	mouse_filter = Control.MOUSE_FILTER_IGNORE

func _draw() -> void:
	var s := minf(size.x, size.y)
	var o := Vector2((size.x - s) * 0.5, (size.y - s) * 0.5)
	var sun := Color("ffc93c")
	var cloud := Color(1, 1, 1, 0.92)
	if kind == "clear" or kind == "cloudy":
		var c := o + (Vector2(s * 0.5, s * 0.5) if kind == "clear" else Vector2(s * 0.62, s * 0.38))
		var r := s * (0.2 if kind == "clear" else 0.16)
		draw_circle(c, r, sun, true, -1.0, true)
		for i in 8:
			var a := TAU * i / 8.0
			var d := Vector2(cos(a), sin(a))
			draw_line(c + d * (r + s * 0.06), c + d * (r + s * 0.14), sun, 1.6, true)
	if kind == "fog":
		for i in 3:
			var y := o.y + s * (0.32 + i * 0.18)
			draw_line(Vector2(o.x + s * (0.15 + i * 0.05), y), Vector2(o.x + s * (0.85 - i * 0.05), y), cloud, 2.0, true)
		return
	if kind != "clear":
		var base := o + Vector2(s * 0.5, s * (0.62 if kind == "cloudy" else 0.5))
		var col := cloud if kind != "heavy_rain" else Color(0.75, 0.8, 0.88)
		draw_circle(base + Vector2(-s * 0.16, 0), s * 0.14, col, true, -1.0, true)
		draw_circle(base + Vector2(s * 0.02, -s * 0.07), s * 0.19, col, true, -1.0, true)
		draw_circle(base + Vector2(s * 0.2, s * 0.01), s * 0.13, col, true, -1.0, true)
		draw_rect(Rect2(base.x - s * 0.16, base.y, s * 0.36, s * 0.14), col)
		if kind == "light_rain" or kind == "heavy_rain":
			var drops := 2 if kind == "light_rain" else 4
			for i in drops:
				var x := base.x - s * 0.15 + i * s * (0.3 / maxf(1.0, drops - 1.0))
				draw_line(Vector2(x, base.y + s * 0.22), Vector2(x - s * 0.05, base.y + s * 0.36), Color("5fb4ff"), 2.0, true)
