class_name TouchControls
extends Control
## On-screen driving controls of the mobile app (port of mobile/touchControls.ts). They sit over the race UI and
## drive the game through the existing input path (InputState.touch, merged with the keys by InputSmoother, so the
## physics-step filters apply):
##  - steering and pedals write InputState.touch;
##  - the buttons (gears, look back, reset, pause, timing, handbrake, camera) press the bound keys with synthetic
##    key events, exactly like a key press.
## Multi-touch: every finger is tracked by its touch index.

const ICON_LEFT := "<"
const ICON_RIGHT := ">"

class Widget:
	extends RefCounted
	var kind: String # "pedal", "button", "hold", "steer"
	var rect := Rect2()
	var label := ""
	var action := ""
	var color := Color.WHITE
	var down := false
	var visible := true
	var value_cb: Callable
	var name := ""

var widgets: Array = []
var _fingers := {} # touch index -> {widget, origin_x}
var _steer_fingers := {} # touch index -> steer value
var _tilt_raw := 0.0
var _tilt_on := false
var _tilt_value := 0.0
var _steer_value := 0.0
var _mode := "buttons"
## Which parts the session wants shown: cine (intro), spectating, boxed (pit menu), manual gearbox.
var cine := false
var spectating := false
var boxed := false
var show_controls := false
var safe_area := Rect2()

signal key_action(action: String, down: bool)
signal skip_intro
signal spectator_key(code: String)

func _init() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	UIKit.full(self)
	TouchPrefs.on_change(_layout)

func _ready() -> void:
	visible = false
	_layout()
	get_viewport().size_changed.connect(_layout)
	if DisplayServer.is_touchscreen_available():
		set_process(true)

## Show or hide the whole overlay (a race UI on screen).
func set_active(on: bool) -> void:
	show_controls = on
	visible = on
	InputState.touch.active = on
	if not on:
		_release_all()
	queue_redraw()

func _scale() -> float:
	return float(TouchPrefs.get_pref("size"))

func _alpha() -> float:
	return float(TouchPrefs.get_pref("opacity"))

## Puts the steering and pedals where the thumbs are for the chosen steering mode.
func _layout() -> void:
	_mode = TouchPrefs.get_pref("steer")
	widgets.clear()
	var vp := get_viewport_rect().size
	var u := _scale()
	# a phone's display: reference layout is 1 px per CSS px of a ~850 px wide landscape screen; scale to the real one
	var k := clampf(vp.y / 400.0, 1.0, 4.0)
	var margin := 12.0 * k
	var sa := DisplayServer.get_display_safe_area()
	var win := DisplayServer.window_get_size()
	var inset_l := 0.0
	var inset_r := 0.0
	var inset_b := 0.0
	var inset_t := 0.0
	if sa.size.x > 0 and win.x > 0:
		inset_l = float(sa.position.x) * vp.x / win.x
		inset_t = float(sa.position.y) * vp.y / win.y
		inset_r = (win.x - sa.end.x) * vp.x / win.x
		inset_b = (win.y - sa.end.y) * vp.y / win.y
	safe_area = Rect2(inset_l, inset_t, vp.x - inset_l - inset_r, vp.y - inset_t - inset_b)
	# right: pedals
	var thr_w := 96.0 * u * k
	var thr_h := 150.0 * u * k
	var brk_w := 112.0 * u * k
	var brk_h := 104.0 * u * k
	if _mode == "tilt":
		brk_w = 128.0 * u * k
		brk_h = 128.0 * u * k
		thr_w = 128.0 * u * k
	var right := vp.x - margin - inset_r
	var bottom := vp.y - margin - inset_b
	var throttle := _widget("pedal", Rect2(right - thr_w, bottom - thr_h, thr_w, thr_h), "GAS", "", Color(0.19, 0.82, 0.35))
	throttle.value_cb = func(v): InputState.touch.throttle = v
	throttle.name = "throttle"
	var brake_rect := Rect2(right - thr_w - 10.0 * k - brk_w, bottom - brk_h, brk_w, brk_h)
	if _mode == "tilt":
		brake_rect = Rect2(margin + inset_l, bottom - brk_h, brk_w, brk_h)
	var brake := _widget("pedal", brake_rect, "BRAKE", "", Color(1, 0.27, 0.23))
	brake.value_cb = func(v): InputState.touch.brake = v
	brake.name = "brake"
	if _mode != "tilt":
		var steer := _widget("steer", Rect2(margin + inset_l, bottom - 118.0 * u * k, 250.0 * u * k, 118.0 * u * k), "", "", Color.WHITE)
		steer.name = "steer"
	# gears above the pedals: + - (manual gearbox), handbrake
	var bw := 52.0 * k
	var bh := 44.0 * k
	var gy := bottom - thr_h - 8.0 * k - bh
	var hb := _widget("hold", Rect2(right - bw, gy, bw, bh), "HB", "handbrake", Color.WHITE)
	hb.name = "hb"
	var down_b := _widget("button", Rect2(right - bw * 2 - 8.0 * k, gy, bw, bh), "-", "shiftDown", Color.WHITE)
	down_b.name = "down"
	var up_b := _widget("button", Rect2(right - bw * 3 - 16.0 * k, gy, bw, bh), "+", "shiftUp", Color.WHITE)
	up_b.name = "up"
	# top bar: pause, timing, back, reset, camera, gearbox
	var tw := 52.0 * k
	var th := 40.0 * k
	var tx := vp.x / 2.0 - (tw * 6 + 8.0 * k * 5) / 2.0 - 30.0 * k
	var ty := 6.0 * k + inset_t
	var specs := [["II", "pause", "button", "pause"], ["TIMES", "timing", "hold", "timing"], ["BACK", "lookBack", "hold", "back"],
		["R", "resetCar", "button", "reset"], ["CAM", "camera", "button", "cam"], ["AUTO", "toggleGearbox", "button", "gearbox"]]
	for i in specs.size():
		var x := tx + i * (tw + 8.0 * k) + (172.0 * k if i >= 3 else 0.0)
		var w := _widget(specs[i][2], Rect2(x, ty, tw, th), I18n.t(specs[i][0]) if specs[i][0] in ["TIMES", "BACK"] else specs[i][0], specs[i][1], Color.WHITE)
		w.name = specs[i][3]
	# intro: skip; spectator: arrows
	var skip := _widget("button", Rect2(vp.x - margin - inset_r - 150.0 * k, 56.0 * k + inset_t, 150.0 * k, 42.0 * k), I18n.t("Skip intro"), "", Color.WHITE)
	skip.name = "skip"
	var sl := _widget("button", Rect2(vp.x / 2.0 - 180.0 * k - 64.0 * k, vp.y - 14.0 * k - 54.0 * k - inset_b, 64.0 * k, 54.0 * k), "<", "", Color.WHITE)
	sl.name = "spec_left"
	var sr := _widget("button", Rect2(vp.x / 2.0 + 180.0 * k, vp.y - 14.0 * k - 54.0 * k - inset_b, 64.0 * k, 54.0 * k), ">", "", Color.WHITE)
	sr.name = "spec_right"
	_release_all()
	if _mode == "tilt":
		pass
	queue_redraw()

func _widget(kind: String, rect: Rect2, label: String, action: String, color: Color) -> Widget:
	var w := Widget.new()
	w.kind = kind
	w.rect = rect
	w.label = label
	w.action = action
	w.color = color
	widgets.append(w)
	return w

func _w(wname: String) -> Widget:
	for w in widgets:
		if w.name == wname:
			return w
	return null

## Which widgets are shown for the current state (the web CSS state classes).
func _is_shown(w: Widget) -> bool:
	var n := w.name
	if n == "skip":
		return cine
	if n == "spec_left" or n == "spec_right":
		return spectating
	if cine or boxed:
		return n in ["pause", "timing"] and not cine
	if spectating:
		return n in ["pause", "timing"]
	if n == "up" or n == "down":
		return bool(Settings.data.manualGearbox)
	return true

# ---------------------------------------------------------------- input ---

func _input(event: InputEvent) -> void:
	if not show_controls:
		return
	if event is InputEventScreenTouch:
		var e := event as InputEventScreenTouch
		if e.pressed:
			var w := _hit(e.position)
			if w != null:
				_press(e.index, w, e.position)
				get_viewport().set_input_as_handled()
		else:
			_release_finger(e.index)
	elif event is InputEventScreenDrag:
		var e2 := event as InputEventScreenDrag
		if _fingers.has(e2.index):
			var f: Dictionary = _fingers[e2.index]
			if f.widget.kind == "steer":
				_read_steer(e2.index, f.widget, e2.position)
	elif event is InputEventMouseButton and not DisplayServer.is_touchscreen_available():
		# desktop preview: the mouse acts as one finger
		var m := event as InputEventMouseButton
		if m.button_index == MOUSE_BUTTON_LEFT:
			if m.pressed:
				var w2 := _hit(m.position)
				if w2 != null:
					_press(-1, w2, m.position)
			else:
				_release_finger(-1)
	elif event is InputEventMouseMotion and _fingers.has(-1):
		var f2: Dictionary = _fingers[-1]
		if f2.widget.kind == "steer":
			_read_steer(-1, f2.widget, (event as InputEventMouseMotion).position)

func _hit(pos: Vector2) -> Widget:
	for w: Widget in widgets:
		if _is_shown(w) and w.rect.grow(4.0).has_point(pos):
			return w
	return null

func _press(index: int, w: Widget, pos: Vector2) -> void:
	_fingers[index] = {"widget": w, "origin_x": pos.x}
	match w.kind:
		"pedal":
			w.down = true
			w.value_cb.call(1.0)
		"hold":
			w.down = true
			_press_action(w.action, true)
		"button":
			w.down = true
			_buzz(8)
			if w.name == "skip":
				skip_intro.emit()
			elif w.name == "spec_left":
				spectator_key.emit("ArrowLeft")
			elif w.name == "spec_right":
				spectator_key.emit("ArrowRight")
			else:
				_press_action(w.action, true)
				_press_action(w.action, false)
			get_tree().create_timer(0.12).timeout.connect(func(): w.down = false; queue_redraw())
		"steer":
			_read_steer(index, w, pos)
	queue_redraw()

func _release_finger(index: int) -> void:
	if not _fingers.has(index):
		return
	var w: Widget = _fingers[index].widget
	_fingers.erase(index)
	match w.kind:
		"pedal":
			# another finger may still hold it
			var held := false
			for f in _fingers.values():
				if f.widget == w:
					held = true
			if not held:
				w.down = false
				w.value_cb.call(0.0)
		"hold":
			w.down = false
			_press_action(w.action, false)
		"steer":
			_steer_fingers.erase(index)
			_apply_steer()
	queue_redraw()

func _read_steer(index: int, w: Widget, pos: Vector2) -> void:
	if _mode == "slider":
		# drag from where the thumb landed: a third of the pad's width either way is full lock
		var x0: float = _fingers[index].origin_x
		var v := clampf((x0 - pos.x) / (w.rect.size.x * 0.32), -1.0, 1.0)
		_steer_fingers[index] = 0.0 if absf(v) < 0.04 else v
	else:
		_steer_fingers[index] = 1.0 if pos.x < w.rect.position.x + w.rect.size.x / 2.0 else -1.0
	_apply_steer()

func _apply_steer() -> void:
	if _mode == "tilt":
		return
	var v := 0.0
	for s in _steer_fingers.values():
		v = s # the latest thumb wins
	_steer_value = v
	InputState.touch.steer = v
	queue_redraw()

func _release_all() -> void:
	_fingers.clear()
	_steer_fingers.clear()
	for w: Widget in widgets:
		w.down = false
	InputState.touch.throttle = 0.0
	InputState.touch.brake = 0.0
	InputState.touch.handbrake = 0.0
	if _mode != "tilt":
		InputState.touch.steer = 0.0
		_steer_value = 0.0
	# held keys of the hold buttons
	for a in ["timing", "lookBack", "handbrake"]:
		_press_action(a, false)

## Presses or releases the first key bound to an action (a synthetic key event).
func _press_action(action: String, down: bool) -> void:
	var codes: Array = Settings.data.bindings.get(action, [])
	if codes.is_empty():
		return
	var k := KeyMap.key_of(codes[0])
	if k == KEY_NONE:
		return
	var ev := InputEventKey.new()
	ev.keycode = k
	ev.physical_keycode = k
	ev.pressed = down
	Input.parse_input_event(ev)
	key_action.emit(action, down)

func _buzz(ms: int) -> void:
	if TouchPrefs.get_pref("haptics"):
		Input.vibrate_handheld(ms)

# ----------------------------------------------------------------- tilt ---

func _process(_dt: float) -> void:
	if not show_controls:
		return
	if _mode == "tilt":
		var g := Input.get_accelerometer()
		if g != Vector3.ZERO:
			# lean of the phone's horizontal axis, stable whether it is held upright or tipped back
			var lean := rad_to_deg(atan2(g.x if not _landscape_flipped() else -g.x, Vector2(g.y, g.z).length()))
			_tilt_raw += (lean - _tilt_raw) * 0.35 # a light low-pass against hand shake
			_tilt_on = true
			var dead := 1.5
			var mag := maxf(0.0, absf(_tilt_raw) - dead) / maxf(5.0, float(TouchPrefs.get_pref("tiltRange")) - dead)
			var v := minf(1.0, mag) * signf(_tilt_raw) * (-1.0 if TouchPrefs.get_pref("tiltInvert") else 1.0)
			_tilt_value = v
			InputState.touch.steer = v
			queue_redraw()
	if Engine.get_process_frames() % 12 == 0:
		queue_redraw()

func _landscape_flipped() -> bool:
	return DisplayServer.screen_get_orientation() == DisplayServer.SCREEN_REVERSE_LANDSCAPE

# ----------------------------------------------------------------- draw ---

func _draw() -> void:
	if not show_controls:
		return
	var a := _alpha()
	var k := clampf(get_viewport_rect().size.y / 400.0, 1.0, 4.0)
	var f_d := UIKit.font(true, 800)
	for w: Widget in widgets:
		if not _is_shown(w):
			continue
		var fill := Color(10 / 255.0, 11 / 255.0, 14 / 255.0, 0.42)
		var border := Color(1, 1, 1, 0.35)
		if w.kind == "pedal":
			border = Color(w.color, 0.7)
			if w.down:
				fill = Color(w.color, 0.45)
		elif w.down:
			fill = Color(1, 1, 1, 0.3)
			border = Color.WHITE
		var radius := 18 if w.kind == "pedal" else (22 if w.kind == "steer" else 10)
		var sb := UIKit.box(Color(fill.r, fill.g, fill.b, fill.a * a / 0.7), Color(border.r, border.g, border.b, border.a * a / 0.7), 2, int(radius * k * 0.7))
		draw_style_box(sb, w.rect)
		if w.kind == "steer":
			_draw_steer(w, a, k)
			continue
		var text := w.label
		if w.name == "gearbox":
			text = "MAN" if Settings.data.manualGearbox else "AUTO"
		var fs := int((14.0 if w.kind == "pedal" else 15.0) * k)
		if w.kind == "pedal":
			draw_string(f_d, Vector2(w.rect.position.x, w.rect.end.y - 10.0 * k), text, HORIZONTAL_ALIGNMENT_CENTER, w.rect.size.x, fs, Color(1, 1, 1, a))
		else:
			var tsz := f_d.get_string_size(text, HORIZONTAL_ALIGNMENT_CENTER, -1, fs)
			draw_string(f_d, Vector2(w.rect.position.x, w.rect.position.y + w.rect.size.y / 2.0 + tsz.y * 0.3), text, HORIZONTAL_ALIGNMENT_CENTER, w.rect.size.x, fs, Color(1, 1, 1, a))
	# tilt indicator above the brake pedal
	if _mode == "tilt":
		var b := _w("brake")
		if b != null:
			var bar := Rect2(b.rect.position.x, b.rect.position.y - 26.0 * k, 120.0 * k, 22.0 * k)
			draw_style_box(UIKit.box(Color(0, 0, 0, 0.35), Color(1, 1, 1, 0.25), 1, int(11 * k)), bar)
			var knob_c := UIKit.ACCENT_2 if _tilt_on else UIKit.BAD
			draw_circle(Vector2(bar.position.x + bar.size.x / 2.0 - _tilt_value * bar.size.x * 0.43, bar.position.y + bar.size.y / 2.0), 7.0 * k, knob_c)
			draw_string(UIKit.font(true, 800), Vector2(bar.position.x, bar.end.y - 5.0 * k), I18n.t("TILT"), HORIZONTAL_ALIGNMENT_CENTER, bar.size.x, int(11 * k), Color(1, 1, 1, 0.55))

func _draw_steer(w: Widget, a: float, k: float) -> void:
	var half := w.rect.size.x / 2.0
	var left_r := Rect2(w.rect.position, Vector2(half, w.rect.size.y))
	var right_r := Rect2(w.rect.position + Vector2(half, 0), Vector2(half, w.rect.size.y))
	if _mode != "slider":
		if _steer_value > 0.0:
			draw_rect(left_r, Color(1, 1, 1, 0.28 * a / 0.7))
		elif _steer_value < 0.0:
			draw_rect(right_r, Color(1, 1, 1, 0.28 * a / 0.7))
		draw_line(Vector2(w.rect.position.x + half, w.rect.position.y), Vector2(w.rect.position.x + half, w.rect.end.y), Color(1, 1, 1, 0.18), 1.0)
	var f := UIKit.font(true, 800)
	var fs := int(38.0 * k * (0.6 if _mode == "slider" else 1.0))
	var col := Color(1, 1, 1, 0.85 if _mode != "slider" else 0.4)
	draw_string(f, Vector2(left_r.position.x, w.rect.get_center().y + fs * 0.3), "<", HORIZONTAL_ALIGNMENT_CENTER, half, fs, col)
	draw_string(f, Vector2(right_r.position.x, w.rect.get_center().y + fs * 0.3), ">", HORIZONTAL_ALIGNMENT_CENTER, half, fs, col)
	if _mode == "slider":
		var cx := w.rect.get_center().x - _steer_value * w.rect.size.x * 0.34
		draw_circle(Vector2(cx, w.rect.get_center().y), 32.0 * k * _scale() * 0.5, Color(1, 1, 1, 0.55))
