class_name PerfOverlay
extends Control
## FPS, frame-time graph, draw calls, triangles, memory, ping and packet loss (port of game/perf.ts).

var conn: Connection = null
var remotes := Callable()
var _times := PackedFloat32Array()
var _idx := 0
var _acc := 0.0
var _frames := 0
var _text := ""
var _label := Label.new()

func _init() -> void:
	_times.resize(120)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	position = Vector2(8, 120)
	custom_minimum_size = Vector2(260, 140)
	_label.add_theme_font_size_override("font_size", 13)
	_label.add_theme_color_override("font_color", Color.WHITE)
	_label.add_theme_color_override("font_outline_color", Color.BLACK)
	_label.add_theme_constant_override("outline_size", 4)
	add_child(_label)

func _process(dt: float) -> void:
	var ms := dt * 1000.0
	_times[_idx % _times.size()] = ms
	_idx += 1
	_frames += 1
	_acc += ms
	if _acc < 500.0:
		return
	var fps := _frames * 1000.0 / _acc
	_frames = 0
	_acc = 0.0
	var mx := 0.0
	for t in _times:
		mx = maxf(mx, t)
	var recv := 0
	var lost := 0
	if remotes.is_valid():
		for b in remotes.call():
			recv += b.recv_count
			lost += b.loss_count
	var mem := OS.get_static_memory_usage() / 1048576.0
	var tex := Performance.get_monitor(Performance.RENDER_TEXTURE_MEM_USED) / 1048576.0
	var vid := Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0
	_text = "FPS %d  max %.1f ms\ndraws %d  tris %dk\nmem %d MB  tex %d MB  vram %d MB\nping %d ms  loss %.1f %%" % [
		roundi(fps), mx, int(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)),
		int(Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME) / 1000.0), roundi(mem), roundi(tex), roundi(vid),
		roundi(conn.rtt) if conn != null else 0, (lost * 100.0 / (recv + lost)) if recv + lost > 0 else 0.0]
	_label.text = _text
	queue_redraw()

func _draw() -> void:
	var base := Vector2(0, 80)
	draw_rect(Rect2(base, Vector2(240, 60)), Color(0, 0, 0, 0.45))
	for ms in [16.7, 25.0, 33.3]:
		var y: float = base.y + 60.0 - (ms / 50.0) * 60.0
		draw_line(Vector2(0, y), Vector2(240, y), Color(1, 1, 1, 0.25))
	for i in _times.size():
		var t := _times[(_idx + i) % _times.size()]
		var c := Color("ff453a") if t > 25.0 else (Color("ffd60a") if t > 20.0 else Color("30d158"))
		var hh := minf(60.0, (t / 50.0) * 60.0)
		draw_rect(Rect2(i * 2, base.y + 60.0 - hh, 2, hh), c)
