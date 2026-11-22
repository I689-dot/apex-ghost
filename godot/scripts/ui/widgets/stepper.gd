extends Control
## ‹ value ›: the value right-aligned before two chevrons; click a chevron (or the value, forward) to step, or press the
## pad's left / right while it has focus. The chevron at an end is dimmed.

signal changed(value: Variant)
var options: Array
var index := 0
var enabled := true
var _hot := 0
static var _ring: StyleBoxFlat = null

func _init(current: Variant, opts: Array, on: Callable, on_enabled: bool = true) -> void:
	options = opts
	enabled = on_enabled
	for i in opts.size():
		if opts[i][0] == current:
			index = i
	focus_mode = Control.FOCUS_ALL if enabled else Control.FOCUS_NONE
	mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if enabled else Control.CURSOR_ARROW
	var f := UIKit.font(false, 600)
	var widest := 0.0
	for o: Array in opts:
		widest = maxf(widest, f.get_string_size(String(o[1]), HORIZONTAL_ALIGNMENT_LEFT, -1, _fs()).x)
	custom_minimum_size = Vector2(clampf(widest + 96.0, 180.0, 420.0), 44.0 if UIKit.touch() else 34.0)
	if on.is_valid():
		changed.connect(on)

static func _fs() -> int:
	return 18 if UIKit.touch() else 16

func value() -> Variant:
	return options[index][0] if not options.is_empty() else null

func step(d: int) -> void:
	var n := clampi(index + d, 0, options.size() - 1)
	if n == index or not enabled:
		return
	index = n
	queue_redraw()
	changed.emit(options[index][0])

func _cell() -> float:
	return 36.0 if UIKit.touch() else 28.0

func _gui_input(e: InputEvent) -> void:
	if not enabled:
		return
	var c := _cell()
	if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
		step(-1 if e.position.x >= size.x - c * 2.0 and e.position.x < size.x - c else 1)
		accept_event()
	elif e is InputEventMouseMotion:
		var hot := 0
		if e.position.x >= size.x - c * 2.0:
			hot = -1 if e.position.x < size.x - c else 1
		if hot != _hot:
			_hot = hot
			queue_redraw()
	elif e.is_action_pressed("ui_left", true):
		step(-1)
		accept_event()
	elif e.is_action_pressed("ui_right", true):
		step(1)
		accept_event()

func _notification(what: int) -> void:
	if what == NOTIFICATION_MOUSE_EXIT:
		_hot = 0
		queue_redraw()
	elif what == NOTIFICATION_FOCUS_ENTER or what == NOTIFICATION_FOCUS_EXIT:
		queue_redraw()

func _draw() -> void:
	var c := _cell()
	if has_focus(true):
		if _ring == null:
			_ring = UIKit.focus_ring()
		_ring.draw(get_canvas_item(), Rect2(Vector2.ZERO, size))
	var f := UIKit.font(false, 600)
	var txt: String = String(options[index][1]) if not options.is_empty() else ""
	var tc := Color.WHITE if enabled else Color(1, 1, 1, 0.4)
	var base := (size.y + f.get_ascent(_fs()) - f.get_descent(_fs())) * 0.5
	draw_string(f, Vector2(0, base), txt, HORIZONTAL_ALIGNMENT_RIGHT, size.x - c * 2.0 - 8.0, _fs(), tc)
	for side: int in [-1, 1]:
		var x := size.x - c * (1.5 if side < 0 else 0.5)
		var y := size.y * 0.5
		var at_end := (index == 0) if side < 0 else (index == options.size() - 1)
		var col := Color(1, 1, 1, 0.22) if (at_end or not enabled) else (Color.WHITE if _hot == side else Color(1, 1, 1, 0.82))
		var k := 5.0 if not UIKit.touch() else 6.0
		# two strokes a little apart: the references' outlined chevron
		var sd := float(side)
		for o: float in [-2.5, 2.5]:
			var ox: float = x - o * sd
			draw_polyline(PackedVector2Array([Vector2(ox - k * 0.6 * sd, y - k), Vector2(ox + k * 0.6 * sd, y), Vector2(ox - k * 0.6 * sd, y + k)]), col, 1.6, true)
