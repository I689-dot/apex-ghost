class_name TouchControls
extends Control
## On-screen driving controls of the mobile app (port of mobile/touchControls.ts). They sit over the race UI and
## drive the game through the existing input path (InputState.touch, merged with the keys by InputSmoother, so the
## physics-step filters apply):
##  - steering and pedals write InputState.touch;
##  - the buttons (gears, look back, reset, pause, timing, handbrake, camera) press the bound keys with synthetic
##    key events, exactly like a key press.
## Multi-touch: every finger is tracked by its touch index.


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
	## Drawn as this icon instead of a label ("menu", "tune", "camera", "chat").
	var icon := ""
	## The pedals' and the steering's drawing, made when the layout changes (_shape): outlines (an outer hairline and
	## an inner one per part), the halftone dots (x, y, radius) and the steering's chevrons.
	var outlines: Array = []
	var inners: Array = []
	var dots := PackedVector3Array()
	var chevrons: Array = []

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

## The phone's icon column at the top left (pause, aids, camera, chat), each this wide before the screen's factor k.
const ICON := 30.0

## The parts of the screen a notch or the system bars cover, in viewport units: [left, top, right, bottom].
static func safe_insets(vp: Vector2) -> Array:
	var sa := DisplayServer.get_display_safe_area()
	var win := DisplayServer.window_get_size()
	if sa.size.x <= 0 or win.x <= 0:
		return [0.0, 0.0, 0.0, 0.0]
	return [float(sa.position.x) * vp.x / win.x, float(sa.position.y) * vp.y / win.y, (win.x - sa.end.x) * vp.x / win.x, (win.y - sa.end.y) * vp.y / win.y]

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
	var ins := safe_insets(vp)
	var inset_l: float = ins[0]
	var inset_t: float = ins[1]
	var inset_r: float = ins[2]
	var inset_b: float = ins[3]
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
	throttle.value_cb = func(v: float) -> void: InputState.touch.throttle = v
	throttle.name = "throttle"
	var brake_rect := Rect2(right - thr_w - 10.0 * k - brk_w, bottom - brk_h, brk_w, brk_h)
	if _mode == "tilt":
		brake_rect = Rect2(margin + inset_l, bottom - brk_h, brk_w, brk_h)
	var brake := _widget("pedal", brake_rect, "BRAKE", "", Color(1, 0.27, 0.23))
	brake.value_cb = func(v: float) -> void: InputState.touch.brake = v
	brake.name = "brake"
	if _mode != "tilt":
		var steer := _widget("steer", Rect2(margin + inset_l, bottom - 118.0 * u * k, 250.0 * u * k, 118.0 * u * k), "", "", Color.WHITE)
		steer.name = "steer"
	# the handbrake, small, above the throttle
	var hbw := 44.0 * k
	var hbh := 36.0 * k
	var hb := _widget("hold", Rect2(right - hbw, bottom - thr_h - 8.0 * k - hbh, hbw, hbh), "HB", "handbrake", Color.WHITE)
	hb.name = "hb"
	# the gears (manual gearbox) either side of the speed at the bottom centre (PhoneSpeed), as the references
	var hud_sc := float(Settings.data.hud.scale)
	var gw := 34.0 * k
	var gh := 58.0 * k
	var half := PhoneSpeed.SIZE.x * hud_sc / 2.0 + 10.0 * k
	var down_b := _widget("button", Rect2(vp.x / 2.0 - half - gw, bottom - gh, gw, gh), "−", "shiftDown", Color.WHITE)
	down_b.name = "down"
	var up_b := _widget("button", Rect2(vp.x / 2.0 + half, bottom - gh, gw, gh), "+", "shiftUp", Color.WHITE)
	up_b.name = "up"
	# the icon column at the top left: pause (the menu: reset, settings, leave), the aids, the camera, the chat
	var isz := ICON * k
	var ix := margin + inset_l
	var iy := 8.0 * k + inset_t
	var icons := [["menu", "pause", "pause"], ["tune", "", "tune"], ["camera", "camera", "cam"], ["chat", "chat", "chat"]]
	for i in icons.size():
		var iw := _widget("button", Rect2(ix, iy + i * (isz + 8.0 * k), isz, isz), "", icons[i][1], Color.WHITE)
		iw.icon = icons[i][0]
		iw.name = icons[i][2]
	# the aids row (brake bias, TC, ABS, the gearbox, the delta) opens beside the aids icon
	var tw := 50.0 * k
	var th := isz
	var tune_y := iy + isz + 8.0 * k
	var rows := [["BB−", "brakeBiasDown", "bb_down"], ["BB+", "brakeBiasUp", "bb_up"], ["TC", "tcCycle", "tc"], ["ABS", "absToggle", "abs"],
		["AUTO", "toggleGearbox", "gearbox"], ["DELTA", "deltaMode", "delta"]]
	for j in rows.size():
		var tb := _widget("button", Rect2(ix + isz + 10.0 * k + j * (tw + 6.0 * k), tune_y, tw, th), rows[j][0], rows[j][1], Color.WHITE)
		tb.name = rows[j][2]
	# intro: skip; spectator: arrows
	var skip := _widget("button", Rect2(vp.x - margin - inset_r - 150.0 * k, 56.0 * k + inset_t, 150.0 * k, 42.0 * k), I18n.t("Skip intro"), "", Color.WHITE)
	skip.name = "skip"
	var sl := _widget("button", Rect2(vp.x / 2.0 - 180.0 * k - 64.0 * k, vp.y - 14.0 * k - 54.0 * k - inset_b, 64.0 * k, 54.0 * k), "<", "", Color.WHITE)
	sl.name = "spec_left"
	var sr := _widget("button", Rect2(vp.x / 2.0 + 180.0 * k, vp.y - 14.0 * k - 54.0 * k - inset_b, 64.0 * k, 54.0 * k), ">", "", Color.WHITE)
	sr.name = "spec_right"
	_release_all()
	var kk := clampf(vp.y / 400.0, 1.0, 4.0)
	for w: Widget in widgets:
		if w.kind == "pedal" or w.kind == "steer":
			_shape(w, kk)
	queue_redraw()

## The race has a text chat (rooms this game hosts): the CHAT button shows.
var chat_enabled := false
## The tuning row is open (TUNE button).
var tune_open := false

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
	for w: Widget in widgets:
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
		return n == "pause" and not cine
	if spectating:
		return n == "pause"
	if n == "up" or n == "down":
		return bool(Settings.data.manualGearbox)
	if n in ["bb_down", "bb_up", "tc", "abs", "gearbox", "delta"]:
		return tune_open
	if n == "chat":
		return chat_enabled
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
			elif w.name == "tune":
				tune_open = not tune_open
			else:
				_press_action(w.action, true)
				_press_action(w.action, false)
			get_tree().create_timer(0.12).timeout.connect(func() -> void: w.down = false; queue_redraw())
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
			for f: Dictionary in _fingers.values():
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
	for s: float in _steer_fingers.values():
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
	for a: String in ["timing", "lookBack", "handbrake"]:
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

## A part's outline as points over its rect (shares of the width and height), in screen units.
static func _poly(r: Rect2, pts: Array) -> PackedVector2Array:
	var out := PackedVector2Array()
	for p: Vector2 in pts:
		out.append(r.position + p * r.size)
	return out

## The references' controls: hairline outlines, a second one inside, halftone dots that grow towards a focus and fade
## to the edges; the steering as two pointed pads with a solid chevron each. Made once a layout.
func _shape(w: Widget, k: float) -> void:
	w.outlines.clear()
	w.inners.clear()
	w.chevrons.clear()
	w.dots = PackedVector3Array()
	var parts: Array = [] # [outline, focus point, reach]
	if w.name == "throttle":
		var o := _poly(w.rect, [Vector2(0.24, 0.0), Vector2(0.9, 0.0), Vector2(1.0, 0.05), Vector2(1.0, 0.95), Vector2(0.92, 1.0),
			Vector2(0.08, 1.0), Vector2(0.0, 0.95), Vector2(0.0, 0.52), Vector2(0.24, 0.44)])
		parts.append([o, w.rect.position + w.rect.size * Vector2(0.62, 0.5), w.rect.size.y * 0.55])
	elif w.name == "brake":
		var o2 := _poly(w.rect, [Vector2(0.06, 0.0), Vector2(0.84, 0.0), Vector2(1.0, 0.24), Vector2(0.96, 0.9), Vector2(0.88, 1.0),
			Vector2(0.08, 1.0), Vector2(0.0, 0.88), Vector2(0.0, 0.12)])
		parts.append([o2, w.rect.position + w.rect.size * Vector2(0.72, 0.62), w.rect.size.x * 0.6])
	elif w.kind == "steer":
		var gap := 0.04
		var lr := Rect2(w.rect.position, Vector2(w.rect.size.x * (0.5 - gap), w.rect.size.y))
		var rr := Rect2(w.rect.position + Vector2(w.rect.size.x * (0.5 + gap), 0), Vector2(w.rect.size.x * (0.5 - gap), w.rect.size.y))
		var ol := _poly(lr, [Vector2(0.0, 0.5), Vector2(0.24, 0.02), Vector2(1.0, 0.02), Vector2(1.0, 0.98), Vector2(0.24, 0.98)])
		var orr := _poly(rr, [Vector2(0.0, 0.02), Vector2(0.76, 0.02), Vector2(1.0, 0.5), Vector2(0.76, 0.98), Vector2(0.0, 0.98)])
		parts.append([ol, lr.position + lr.size * Vector2(0.12, 0.5), lr.size.x * 0.55])
		parts.append([orr, rr.position + rr.size * Vector2(0.88, 0.5), rr.size.x * 0.55])
		var ch := lr.size.y * 0.16
		var cl := lr.position + lr.size * Vector2(0.36, 0.5)
		w.chevrons.append(PackedVector2Array([cl + Vector2(-ch * 0.7, 0), cl + Vector2(ch * 0.35, -ch), cl + Vector2(ch * 0.35, ch)]))
		var cr := rr.position + rr.size * Vector2(0.64, 0.5)
		w.chevrons.append(PackedVector2Array([cr + Vector2(ch * 0.7, 0), cr + Vector2(-ch * 0.35, -ch), cr + Vector2(-ch * 0.35, ch)]))
	var step := 7.0 * k
	var rmax := 1.9 * k
	for part: Array in parts:
		var o3: PackedVector2Array = part[0]
		w.outlines.append(o3)
		var inner := Geometry2D.offset_polygon(o3, -4.0 * k)
		w.inners.append(inner[0] if not inner.is_empty() else PackedVector2Array())
		var focus: Vector2 = part[1]
		var reach: float = part[2]
		var box := Rect2(o3[0], Vector2.ZERO)
		for q: Vector2 in o3:
			box = box.expand(q)
		var y := box.position.y + step
		while y < box.end.y - step * 0.5:
			var x := box.position.x + step
			while x < box.end.x - step * 0.5:
				var pt := Vector2(x, y)
				var f := clampf(1.0 - pt.distance_to(focus) / reach, 0.0, 1.0)
				var rad := rmax * pow(f, 0.8)
				if rad > 0.35 * k and Geometry2D.is_point_in_polygon(pt, o3):
					w.dots.append(Vector3(x, y, rad))
				x += step
			y += step

func _draw() -> void:
	if not show_controls:
		return
	var a := _alpha() / 0.7
	var k := clampf(get_viewport_rect().size.y / 400.0, 1.0, 4.0)
	var f_d := UIKit.font(true, 800)
	for w: Widget in widgets:
		if not _is_shown(w):
			continue
		if w.icon != "":
			_draw_icon(w, a, k)
			continue
		if w.kind == "pedal" or w.kind == "steer":
			_draw_part(w, a, k)
			continue
		# the small buttons: a translucent glass chip
		var fill := Color(1, 1, 1, 0.28 * a) if w.down else Color(0.02, 0.03, 0.05, 0.28 * a)
		draw_style_box(UIKit.box(fill, Color(1, 1, 1, 0.45 * a), 1, int(7 * k)), w.rect)
		var text := w.label
		if w.name == "gearbox":
			text = "MAN" if Settings.data.manualGearbox else "AUTO"
		if w.name == "up" or w.name == "down":
			_draw_shift(w, a, k)
			continue
		var fs := int(13.0 * k)
		var tsz := f_d.get_string_size(text, HORIZONTAL_ALIGNMENT_CENTER, -1, fs)
		draw_string(f_d, Vector2(w.rect.position.x, w.rect.position.y + w.rect.size.y / 2.0 + tsz.y * 0.3), text, HORIZONTAL_ALIGNMENT_CENTER, w.rect.size.x, fs, Color(1, 1, 1, 0.9 * a))
	# tilt indicator above the brake pedal
	if _mode == "tilt":
		var b := _w("brake")
		if b != null:
			var bar := Rect2(b.rect.position.x, b.rect.position.y - 26.0 * k, 120.0 * k, 22.0 * k)
			draw_style_box(UIKit.box(Color(0, 0, 0, 0.35), Color(1, 1, 1, 0.25), 1, int(11 * k)), bar)
			var knob_c := UIKit.ACCENT_2 if _tilt_on else UIKit.BAD
			draw_circle(Vector2(bar.position.x + bar.size.x / 2.0 - _tilt_value * bar.size.x * 0.43, bar.position.y + bar.size.y / 2.0), 7.0 * k, knob_c)
			draw_string(UIKit.font(true, 800), Vector2(bar.position.x, bar.end.y - 5.0 * k), I18n.t("TILT"), HORIZONTAL_ALIGNMENT_CENTER, bar.size.x, int(11 * k), Color(1, 1, 1, 0.55))

## A pedal or the steering: hairlines and halftone, brighter while pressed (the steering lights the side held).
func _draw_part(w: Widget, a: float, k: float) -> void:
	for i in w.outlines.size():
		var lit := w.down
		if w.kind == "steer":
			lit = (i == 0 and _steer_value > 0.0) or (i == 1 and _steer_value < 0.0)
		var o: PackedVector2Array = w.outlines[i]
		if lit:
			draw_colored_polygon(o, Color(1, 1, 1, 0.1 * a))
		var closed := o.duplicate()
		closed.append(o[0])
		draw_polyline(closed, Color(1, 1, 1, (0.85 if lit else 0.5) * a), 1.4 * k * 0.8, true)
		var inner: PackedVector2Array = w.inners[i]
		if inner.size() > 2:
			var ci := inner.duplicate()
			ci.append(inner[0])
			draw_polyline(ci, Color(1, 1, 1, (0.4 if lit else 0.2) * a), 1.0 * k * 0.7, true)
	var dot := Color(1, 1, 1, (0.55 if w.down else 0.28) * a)
	for d: Vector3 in w.dots:
		draw_circle(Vector2(d.x, d.y), d.z, dot)
	for c: PackedVector2Array in w.chevrons:
		draw_colored_polygon(c, Color(1, 1, 1, 0.78 * a))
	if _mode == "slider" and w.kind == "steer":
		var kx := w.rect.get_center().x - _steer_value * w.rect.size.x * 0.34
		draw_circle(Vector2(kx, w.rect.get_center().y), 32.0 * k * _scale() * 0.5, Color(1, 1, 1, 0.45 * a))

## A gear button as the references': a slim bracket with an arrow.
func _draw_shift(w: Widget, a: float, k: float) -> void:
	var up := w.name == "up"
	var c := w.rect.get_center()
	var col := Color(1, 1, 1, (1.0 if w.down else 0.8) * a)
	var h := w.rect.size.y * 0.12
	var tip := c + Vector2(0, -h if up else h)
	draw_colored_polygon(PackedVector2Array([tip, c + Vector2(-h, h if up else -h), c + Vector2(h, h if up else -h)]), col)

## The icon column's icons: drawn with lines over a faint glass disc.
func _draw_icon(w: Widget, a: float, k: float) -> void:
	var c := w.rect.get_center()
	var r := w.rect.size.x / 2.0
	draw_circle(c, r, Color(0.02, 0.03, 0.05, (0.42 if w.down else 0.22) * a))
	draw_arc(c, r - 0.5, 0.0, TAU, 28, Color(1, 1, 1, 0.25 * a), 1.0, true)
	var col := Color(1, 1, 1, 0.92 * a)
	var t := 2.0 * k * 0.8
	var u := r * 0.46
	match w.icon:
		"menu":
			for dy: float in [-u * 0.6, 0.0, u * 0.6]:
				draw_line(c + Vector2(-u, dy), c + Vector2(u, dy), col, t, true)
		"tune":
			draw_line(c + Vector2(-u, -u * 0.45), c + Vector2(u, -u * 0.45), col, t, true)
			draw_line(c + Vector2(-u, u * 0.45), c + Vector2(u, u * 0.45), col, t, true)
			draw_circle(c + Vector2(u * 0.35, -u * 0.45), t * 1.8, col)
			draw_circle(c + Vector2(-u * 0.4, u * 0.45), t * 1.8, col)
		"camera":
			draw_rect(Rect2(c + Vector2(-u, -u * 0.6), Vector2(u * 2.0, u * 1.35)), col, false, t)
			draw_arc(c + Vector2(0, u * 0.08), u * 0.42, 0.0, TAU, 20, col, t, true)
		"chat":
			draw_rect(Rect2(c + Vector2(-u, -u * 0.7), Vector2(u * 2.0, u * 1.2)), col, false, t)
			draw_line(c + Vector2(-u * 0.4, u * 0.5), c + Vector2(-u * 0.7, u * 0.95), col, t, true)
