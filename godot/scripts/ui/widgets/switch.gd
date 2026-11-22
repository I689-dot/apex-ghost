extends BaseButton
## The pill switch: a blue track with a check when on, grey when off; the knob slides.

static var _on_box: StyleBoxFlat = null
static var _off_box: StyleBoxFlat = null
static var _ring: StyleBoxFlat = null
var _t := 0.0
var anim: float:
	set(v):
		_t = v
		queue_redraw()
	get:
		return _t

func _init(value: bool, on: Variant) -> void:
	if _on_box == null:
		_on_box = UIKit.box(UIKit.SWITCH_ON, UIKit.SWITCH_ON, 1, 13)
		_off_box = UIKit.box(Color(1, 1, 1, 0.16), Color(1, 1, 1, 0.4), 1, 13)
		_ring = UIKit.focus_ring(16)
	toggle_mode = true
	set_pressed_no_signal(value)
	_t = 1.0 if value else 0.0
	focus_mode = Control.FOCUS_ALL if on != null else Control.FOCUS_NONE
	mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	custom_minimum_size = Vector2(56, 34) if UIKit.touch() else Vector2(50, 28)
	disabled = on == null
	if disabled:
		modulate.a = 0.45
	toggled.connect(func(v: bool) -> void: create_tween().tween_property(self, "anim", 1.0 if v else 0.0, 0.12))
	if on != null:
		toggled.connect(on)

func _notification(what: int) -> void:
	if what == NOTIFICATION_FOCUS_ENTER or what == NOTIFICATION_FOCUS_EXIT or what == NOTIFICATION_MOUSE_ENTER or what == NOTIFICATION_MOUSE_EXIT:
		queue_redraw()

func _draw() -> void:
	var h := 26.0 if UIKit.touch() else 22.0
	var w := h * 1.82
	var r := Rect2(size.x - w, (size.y - h) * 0.5, w, h)
	if has_focus(true):
		_ring.draw(get_canvas_item(), r)
	(_on_box if _t > 0.5 else _off_box).draw(get_canvas_item(), r)
	var knob := h * 0.5 - 3.0
	var cx := r.position.x + h * 0.5 + (w - h) * _t
	var cy := r.position.y + h * 0.5
	draw_circle(Vector2(cx, cy), knob, Color.WHITE, true, -1.0, true)
	if _t > 0.5:
		var k := knob * 0.5
		draw_polyline(PackedVector2Array([Vector2(cx - k, cy), Vector2(cx - k * 0.25, cy + k * 0.7), Vector2(cx + k, cy - k * 0.6)]), UIKit.SWITCH_ON, 2.0, true)
	elif is_hovered():
		draw_circle(Vector2(cx, cy), knob + 2.0, Color(1, 1, 1, 0.25), false, 1.5, true)
