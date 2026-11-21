class_name ReplayBar
extends PanelContainer
## The replay's controls (iRacing's replay bar): a time slider, rewind / step / play / step / forward, the speed, the car
## and camera shown, and Close. Big buttons for a phone; the keys (Space, arrows, comma, period, Escape) work on a desktop.

var session: RaceSession
var _slider := HSlider.new()
var _time := Label.new()
var _play: Button
var _car := Label.new()
var _speed_buttons := {}
var _dragging := false

func _init(s: RaceSession) -> void:
	session = s
	set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
	offset_left = 12.0
	offset_right = -12.0
	offset_bottom = -10.0
	offset_top = -150.0
	grow_vertical = Control.GROW_DIRECTION_BEGIN
	add_theme_stylebox_override("panel", UIKit.box(Color(0.04, 0.05, 0.07, 0.86), Color(1, 1, 1, 0.12), 1, 8, Vector2(14, 10)))
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 8)
	add_child(col)

	var top := HBoxContainer.new()
	top.add_theme_constant_override("separation", 10)
	_time.custom_minimum_size = Vector2(150, 0)
	_slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_slider.min_value = 0.0
	_slider.max_value = 1.0
	_slider.step = 0.0
	_slider.drag_started.connect(func() -> void: _dragging = true)
	_slider.drag_ended.connect(func(_changed: bool) -> void: _dragging = false)
	_slider.value_changed.connect(func(v: float) -> void:
		if _dragging:
			session.replay_seek_fraction(v))
	top.add_child(_time)
	top.add_child(_slider)
	col.add_child(top)

	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	row.add_child(_button("⏪ 10 s", func() -> void: session.replay_jump(-10000.0)))
	row.add_child(_button("◀|", func() -> void: session.replay_step(-1)))
	_play = _button("⏸", func() -> void: session.replay_toggle_play(), true)
	row.add_child(_play)
	row.add_child(_button("|▶", func() -> void: session.replay_step(1)))
	row.add_child(_button("10 s ⏩", func() -> void: session.replay_jump(10000.0)))
	row.add_child(UIW.spacer())
	for sp: float in [-1.0, 0.25, 0.5, 1.0, 2.0, 4.0]:
		var b := _button(("◀◀" if sp < 0.0 else ("%s×" % ("%g" % sp))), func() -> void: session.replay_set_speed(sp))
		_speed_buttons[sp] = b
		row.add_child(b)
	col.add_child(row)

	var bottom := HBoxContainer.new()
	bottom.add_theme_constant_override("separation", 8)
	bottom.add_child(_button("◀", func() -> void: session.replay_change_car(-1)))
	_car.custom_minimum_size = Vector2(220, 0)
	_car.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	bottom.add_child(_car)
	bottom.add_child(_button("▶", func() -> void: session.replay_change_car(1)))
	bottom.add_child(_button(I18n.t("Camera"), func() -> void: session.replay_change_camera()))
	bottom.add_child(UIW.spacer())
	bottom.add_child(_button(I18n.t("Close"), func() -> void: session.close_replay(), true))
	col.add_child(bottom)

func _button(text: String, cb: Callable, primary: bool = false) -> Button:
	var b := UIKit.button(text, cb, primary)
	b.focus_mode = Control.FOCUS_NONE
	return b

func _process(_dt: float) -> void:
	if session == null or not session.replay_open:
		return
	var span := maxf(1.0, session.replay.duration_ms())
	var at := session.replay_t - session.replay.first_ms()
	if not _dragging:
		_slider.set_value_no_signal(clampf(at / span, 0.0, 1.0))
	_time.text = "%s / %s" % [_clock(at), _clock(span)]
	_play.text = "⏸" if session.replay_playing else "▶"
	_car.text = session.replay_car_name() + "  ·  " + I18n.t(session.replay_camera_name())
	for sp: float in _speed_buttons:
		_speed_buttons[sp].modulate = Color(1, 0.84, 0.04) if is_equal_approx(float(sp), session.replay_speed) else Color.WHITE

static func _clock(ms: float) -> String:
	var s := int(maxf(0.0, ms) / 1000.0)
	return "%d:%02d" % [s / 60, s % 60]
