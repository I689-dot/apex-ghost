class_name GamepadInput
extends Node
## Game controller support (port of input/gamepad.ts). Like the touch controls it plugs into the shared input state
## (InputState.pad): the left stick and triggers write it, the InputSmoother merges it with the keys and the
## physics-step filters treat it like any other input; the buttons press the bound keys with synthetic key events.
## In menus Godot's own focus navigation (D-pad / left stick, A to press) does the work; B and Menu send Escape.

const BTN := {"A": 0, "B": 1, "X": 2, "Y": 3, "LB": 4, "RB": 5, "LT": 6, "RT": 7, "VIEW": 8, "MENU": 9, "LS": 10, "RS": 11, "UP": 12, "DOWN": 13, "LEFT": 14, "RIGHT": 15}

## Held buttons → held actions while driving.
const HOLD := [[3, "lookBack"], [11, "lookBack"], [8, "timing"]]
## Pressed buttons → one tap of an action while driving.
const TAP := [[5, "shiftUp"], [1, "shiftUp"], [4, "shiftDown"], [2, "shiftDown"], [12, "resetCar"], [13, "toggleGearbox"], [9, "pause"], [10, "camera"], [15, "camera"]]

## Steering wheels by name or USB vendor (reported as game controllers): Logitech, Thrustmaster, Fanatec, Moza, Simucube, Simagic.
const WHEEL_RE := "wheel|racing|driving force|\\bg2[5-9]\\b|\\bg9[0-2][0-9]\\b|t150|t248|t300|t500|\\btx\\b|tmx|t-?gt|t818|fanatec|csl|clubsport|podium|moza|simucube|simagic"

signal connected_changed(connected: bool, name: String)

## Set by the session: true while the race UI is up with nothing modal over it; true while spectating.
var driving := Callable()
var spectating := Callable()
var paused := false
var connected := false
var _prev: Array = []
var _held := {}
var _mode := "menu"
var _last_pad := -1
var _trig := [{"analog": false, "v": 0.0, "t": 0}, {"analog": false, "v": 0.0, "t": 0}]
var _wheel_re := RegEx.new()

func _ready() -> void:
	_wheel_re.compile("(?i)" + WHEEL_RE)
	Input.joy_connection_changed.connect(_on_joy)

func _on_joy(device: int, on: bool) -> void:
	var name := Input.get_joy_name(device)
	if on:
		connected = true
		connected_changed.emit(true, name)
	else:
		connected = active_pad() >= 0
		_release()
		connected_changed.emit(false, name)

func controller_connected() -> bool:
	return connected

## While the button setup in Settings listens to the pad, the game must not act on it.
func pause_pad(on: bool) -> void:
	paused = on
	if on:
		_release()

## The controller in use: the one touched most recently.
func active_pad() -> int:
	var pads := Input.get_connected_joypads()
	if pads.is_empty():
		return -1
	if _last_pad in pads:
		return _last_pad
	_last_pad = pads[0]
	return _last_pad

func is_wheel(name: String) -> bool:
	var m: String = Settings.data.wheel.mode
	return m == "wheel" or (m == "auto" and _wheel_re.search(name) != null)

func _process(_dt: float) -> void:
	var dev := -1 if paused else active_pad()
	if dev < 0:
		if InputState.pad.active:
			_release()
		return
	# the pad touched last wins when several are plugged in
	for d in Input.get_connected_joypads():
		if d != dev and (Input.is_joy_button_pressed(d, JOY_BUTTON_A) or Input.is_joy_button_pressed(d, JOY_BUTTON_START)):
			dev = d
			_last_pad = d
	connected = true
	var pad := PadMap.read(dev)
	var now: Array = []
	for b in pad.buttons:
		now.append(b.pressed)
	var next := "drive" if driving.is_valid() and driving.call() else "menu"
	if next != _mode:
		_release()
		_mode = next
		# the button that switched the mode (Start, A on "Resume"…) must not act again in the new one
		_prev = now
		return
	var pressed := func(i: int) -> bool: return now[i] and not (_prev.size() > i and _prev[i])
	if _mode == "drive":
		_drive(pad, now, pressed, spectating.is_valid() and spectating.call())
	else:
		_menu(pressed)
	_prev = now

# ------------------------------------------------------------- driving ---

func _drive(pad: Dictionary, now: Array, pressed: Callable, spec: bool) -> void:
	var pd: Dictionary = InputState.pad
	var s: Dictionary = Settings.data.pad
	var val := func(i: int) -> float: return pad.buttons[i].value
	pd.active = true
	KeyboardDriver.PAD.rateScale = s.steerSpeed
	KeyboardDriver.PAD.speedSens = s.speedSens
	pd.wheel = is_wheel(pad.name)
	if pd.wheel:
		# a wheel: its angle as it is (the soft lock and no filters), linear pedals with the brake's own curve
		var ax: float = pad.axes[0]
		pd.steer = -(0.0 if absf(ax) < 0.002 else ax)
		pd.throttle = clampf((val.call(7) - 0.02) / 0.96, 0.0, 1.0)
		pd.brake = pow(clampf((val.call(6) - 0.02) / 0.96, 0.0, 1.0), Settings.data.wheel.brakeCurve)
	else:
		var stick: bool = s.pedals == "rightStick"
		var ry: float = pad.axes[3]
		# on / off triggers (a Switch Pro's ZL and ZR): pressed and held, they rise to full over the player's ramp
		var raw_thr := maxf(0.0, -ry) if stick else _digital_ramp(0, val.call(7))
		var raw_brk := maxf(0.0, ry) if stick else _digital_ramp(1, val.call(6))
		pd.throttle = _shape_pedal(raw_thr, s.throttleCurve, s.throttleDeadzone, s.throttleSaturation)
		# a finer brake curve: the short trigger travel is spent mostly around the locking point (ACC "brake gamma")
		pd.brake = _shape_pedal(raw_brk, s.brakeCurve, s.brakeDeadzone, s.brakeSaturation)
		pd.steer = -_shape_steer(pad.axes[0])  # + = left
	pd.handbrake = 1.0 if now[BTN.A] else 0.0
	# A also confirms (skips the intro); the handbrake is harmless then
	if pressed.call(BTN.A):
		_tap_key(KEY_ENTER)
	if spec:
		# change the car you watch
		if pressed.call(BTN.LEFT) or pressed.call(BTN.LB):
			_tap_key(KEY_LEFT)
		if pressed.call(BTN.RIGHT) or pressed.call(BTN.RB):
			_tap_key(KEY_RIGHT)
		if pressed.call(BTN.MENU):
			_tap_action("pause")
		return
	for t in TAP:
		if pressed.call(t[0]):
			_tap_action(t[1])
	var want := {}
	for h in HOLD:
		if now[h[0]]:
			want[h[1]] = true
	var rx: float = pad.axes[2]
	# (the right stick drives the pedals in that mode: no looking with it)
	if s.pedals != "rightStick":
		if rx < -0.6:
			want["lookLeft"] = true
		if rx > 0.6:
			want["lookRight"] = true
	for a in _held.keys():
		if not want.has(a):
			_press_action(a, false)
	for a in want.keys():
		if not _held.has(a):
			_press_action(a, true)
	_held = want

## Stick → steering: dead zone with the rest of the travel rescaled (no jump at its edge), full lock a little before
## the rim and the player's response curve.
func _shape_steer(x: float) -> float:
	var dz: float = Settings.data.pad.deadzone
	var sat := maxf(dz + 0.05, Settings.data.pad.steerSaturation)
	var m := clampf((absf(x) - dz) / (sat - dz), 0.0, 1.0)
	return signf(x) * pow(m, Settings.data.pad.steerCurve)

## Trigger → pedal: the dead zone and the saturation point (F1's calibration), then the curve.
func _shape_pedal(v: float, curve: float, dz: float, sat: float) -> float:
	var top := maxf(dz + 0.05, sat)
	return 0.0 if v <= dz else pow(minf(1.0, (v - dz) / (top - dz)), curve)

## Triggers that report only 0 or 1: held, they rise over the player's ramp time, released they fall three times as
## fast. A trigger seen anywhere between is analog and passes straight through from then on.
func _digital_ramp(i: int, raw: float) -> float:
	var s: Dictionary = _trig[i]
	var now := Time.get_ticks_msec()
	var dt := minf(0.1, (now - s.t) / 1000.0 if s.t != 0 else 0.0)
	s.t = now
	if raw > 0.03 and raw < 0.97:
		s.analog = true
	if s.analog:
		s.v = raw
		return raw
	var rate := 1.0 / maxf(0.05, Settings.data.pad.digitalRamp)
	s.v = minf(1.0, s.v + rate * dt) if raw > 0.5 else maxf(0.0, s.v - rate * 3.0 * dt)
	return s.v

func _release() -> void:
	for a in _held.keys():
		_press_action(a, false)
	_held.clear()
	var pd: Dictionary = InputState.pad
	pd.active = false
	pd.throttle = 0.0
	pd.brake = 0.0
	pd.handbrake = 0.0
	pd.steer = 0.0

# --------------------------------------------------------------- menus ---

func _menu(pressed: Callable) -> void:
	# focus navigation and A are Godot's ui_* actions; B and Menu go back
	if pressed.call(BTN.B) or pressed.call(BTN.MENU):
		var f := get_viewport().gui_get_focus_owner()
		if f is LineEdit or f is TextEdit:
			f.release_focus()  # Esc must reach the window
		_tap_key(KEY_ESCAPE)

# ------------------------------------------------------------- helpers ---

func _key(keycode: int, down: bool) -> void:
	var e := InputEventKey.new()
	e.physical_keycode = keycode
	e.keycode = keycode
	e.pressed = down
	Input.parse_input_event(e)

func _tap_key(keycode: int) -> void:
	_key(keycode, true)
	_key(keycode, false)

## Presses or releases the first key bound to an action.
func _press_action(action: String, down: bool) -> void:
	var codes: Array = Settings.data.bindings.get(action, [])
	if codes.is_empty():
		return
	var k := KeyMap.key_of(codes[0])
	if k != KEY_NONE:
		_key(k, down)

func _tap_action(action: String) -> void:
	_press_action(action, true)
	_press_action(action, false)
