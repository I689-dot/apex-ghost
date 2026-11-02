class_name PadSetup
extends VBoxContainer
## Settings → Controller: a live view of what the engine reads from the controller, and a button setup that asks for each
## control in turn (port of input/padSetup.ts). The setup is saved per controller and works for any pad, even ones the
## engine reports without a known mapping.

const MAX_BUTTONS := 24
const MAX_AXES := 6

var gamepad: GamepadInput
var _status := UIKit.label("", 15, UIKit.MUTED)
var _live := UIKit.label("", 13, UIKit.MUTED)
var _prompt := UIKit.label("", 20, UIKit.ACCENT_2, false, 700)
var _start: Button
var _clear: Button
var _wizard := VBoxContainer.new()
var _steps: Array = []
var _i := -1
var _layout: Dictionary = {}
var _key := ""
var _base: Dictionary = {}
var _wait_release := true
var _held: Dictionary = {}
var _still := 0
var _last_axes: Array = []
var _device := -1

func _init(pad: GamepadInput) -> void:
	gamepad = pad
	add_theme_constant_override("separation", 6)
	_live.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(_status)
	add_child(_live)
	var row := UIW.hbox(8)
	_start = UIKit.button(I18n.t("Set up buttons…"), _begin)
	_clear = UIKit.button(I18n.t("Remove my setup"), _remove)
	row.add_child(_start)
	row.add_child(_clear)
	add_child(row)
	var wrow := UIW.hbox(8)
	wrow.add_child(UIKit.button(I18n.t("Skip"), _next))
	wrow.add_child(UIKit.button(I18n.t("Cancel"), func(): _finish(false)))
	_wizard.add_child(_prompt)
	_wizard.add_child(wrow)
	_wizard.visible = false
	add_child(_wizard)

static func steps_list() -> Array:
	return [
		{"label": I18n.t("Press THROTTLE (trigger or pedal)"), "button": 7},
		{"label": I18n.t("Press BRAKE (trigger or pedal)"), "button": 6},
		{"label": I18n.t("Turn the wheel or push the steering stick to the RIGHT"), "axis": 0},
		{"label": I18n.t("Press HANDBRAKE (also \"select\" in menus)"), "button": 0},
		{"label": I18n.t("Press BACK in menus (also shift up)"), "button": 1},
		{"label": I18n.t("Press SHIFT UP"), "button": 5},
		{"label": I18n.t("Press SHIFT DOWN"), "button": 4},
		{"label": I18n.t("Press LOOK BACK"), "button": 3},
		{"label": I18n.t("Press PAUSE"), "button": 9},
		{"label": I18n.t("Press TIMING SCREEN"), "button": 8},
		{"label": I18n.t("Press D-pad UP (menus, reset car)"), "button": 12},
		{"label": I18n.t("Press D-pad DOWN (menus, gearbox)"), "button": 13},
		{"label": I18n.t("Press D-pad LEFT"), "button": 14},
		{"label": I18n.t("Press D-pad RIGHT"), "button": 15},
	]

func _raw_buttons(d: int) -> Array:
	var out: Array = []
	for b in MAX_BUTTONS:
		out.append(Input.is_joy_button_pressed(d, b))
	return out

func _raw_axes(d: int) -> Array:
	var out: Array = []
	for a in MAX_AXES:
		out.append(Input.get_joy_axis(d, a))
	return out

func _finish(save: bool) -> void:
	if save and not _layout.is_empty() and _key != "":
		Settings.data.pad.layouts[_key] = _layout
		Settings.save()
	_i = -1
	_wizard.visible = false
	_start.visible = true
	gamepad.pause_pad(false)

func _next() -> void:
	_i += 1
	_wait_release = true
	_still = 0
	_base = {}
	if _i >= _steps.size():
		_finish(true)
	else:
		_prompt.text = "%d/%d · %s" % [_i + 1, _steps.size(), _steps[_i].label]

func _begin() -> void:
	var d := gamepad.active_pad()
	if d < 0:
		_prompt.text = ""
		_status.text = I18n.t("No controller found. Connect it and press any button on it while this page is open.")
		return
	_device = d
	_key = PadMap.pad_key(Input.get_joy_name(d))
	# skipped steps keep what the pad does now
	var cur = Settings.data.pad.layouts.get(_key, null)
	if cur != null:
		_layout = cur.duplicate(true)
	else:
		var buttons: Array = []
		for k in PadMap.STD_BUTTONS:
			buttons.append({"b": k} if k < MAX_BUTTONS else null)
		var axes: Array = []
		for k in 4:
			axes.append({"a": k, "dir": 1})
		_layout = {"buttons": buttons, "axes": axes}
	_steps = steps_list()
	_i = -1
	_wizard.visible = true
	_start.visible = false
	gamepad.pause_pad(true)
	_next()

func _remove() -> void:
	var d := gamepad.active_pad()
	if d >= 0:
		Settings.data.pad.layouts.erase(PadMap.pad_key(Input.get_joy_name(d)))
		Settings.save()

func _process(_dt: float) -> void:
	if not is_visible_in_tree():
		if _i >= 0:
			_finish(false)
		return
	var d := gamepad.active_pad()
	var cur_key := PadMap.pad_key(Input.get_joy_name(d)) if d >= 0 else ""
	_clear.visible = d >= 0 and Settings.data.pad.layouts.has(cur_key)
	if d < 0:
		_status.text = I18n.t("No controller found. Connect it and press any button on it while this page is open.")
		_live.text = ""
		return
	if _i >= 0:
		_learn(d)
	var v := PadMap.read(d)
	var names := {"custom": "Your setup", "standard": "Standard", "raw": "Unknown: set up the buttons below"}
	_status.text = "%s: %s · %s" % [I18n.t("Controller"), Input.get_joy_name(d).substr(0, 60), I18n.t(names[v.layout])]
	var raw_b := []
	var rb := _raw_buttons(d)
	for k in rb.size():
		if rb[k]:
			raw_b.append(str(k))
	var raw_a := _raw_axes(d).map(func(x): return "%.2f" % x)
	_live.text = "%s %.2f · %s %.2f · %s %.2f — %s: %s · %s: %s" % [
		I18n.t("Throttle"), v.buttons[7].value, I18n.t("Brake"), v.buttons[6].value, I18n.t("Steer"), v.axes[0],
		I18n.t("raw buttons"), " ".join(raw_b) if not raw_b.is_empty() else "–", I18n.t("axes"), " ".join(raw_a)]

## The control learned last: the next question waits until it is let go.
func _learn(d: int) -> void:
	var b := _raw_buttons(d)
	var a := _raw_axes(d)
	if _wait_release:
		# the control just learned is let go, no button is down, and the axes have settled for a moment
		if _held.has("b") and b[_held.b]:
			return
		if _held.has("a") and absf(a[_held.a] - _held.from) < 0.5:
			return
		if b.any(func(x): return x):
			return
		var moving := false
		for k in a.size():
			if absf(a[k] - (_last_axes[k] if k < _last_axes.size() else a[k])) > 0.05:
				moving = true
		_last_axes = a
		_still = 0 if moving else _still + 1
		if _still < 6:
			return
		# rest: a trigger on an axis rests at ±1, a stick or a hat at 0
		var rest: Array = []
		for v in a:
			rest.append(signf(v) if absf(v) > 0.8 else (0.0 if absf(v) < 0.2 else v))
		_base = {"b": b, "a": rest}
		_wait_release = false
		_held = {}
		return
	if _base.is_empty() or _layout.is_empty():
		return
	var step: Dictionary = _steps[_i]
	var pressed := -1
	for k in b.size():
		if b[k] and not _base.b[k]:
			pressed = k
			break
	var moved := -1
	for k in a.size():
		if absf(a[k] - _base.a[k]) > 0.6 and (moved < 0 or absf(a[k] - _base.a[k]) > absf(a[moved] - _base.a[moved])):
			moved = k
	if step.has("axis"):
		if moved < 0:
			return
		var dir := 1 if a[moved] > _base.a[moved] else -1
		_layout.axes[0] = {"a": moved, "dir": dir}
		# the vertical axis of the same stick usually follows it
		if moved + 1 < a.size():
			_layout.axes[1] = {"a": moved + 1, "dir": 1}
		_held = {"a": moved, "from": a[moved]}
	elif step.has("button"):
		if pressed >= 0:
			_layout.buttons[step.button] = {"b": pressed}
			_held = {"b": pressed}
		elif moved >= 0:
			_layout.buttons[step.button] = {"a": moved, "dir": 1 if a[moved] > _base.a[moved] else -1, "rest": _base.a[moved]}
			_held = {"a": moved, "from": a[moved]}
		else:
			return
	_next()
