class_name DeviceBindings
extends Node
## Steering wheels, pedal sets, shifters and handbrakes, each a device of its own (the user, 2026-11-16: wheels must
## work, with extra peripherals): every driving function can be bound to any axis or button of any connected device,
## calibrated (the axis's two ends, read while the player moves it) and turned round. Several devices at once: a
## wheel base, separate pedals, an H-pattern shifter and a handbrake. Bindings are kept in the settings by device
## name (and which one of that name), so they come back when the device is plugged in again.
## Read every frame into InputState.rig, which InputSmoother drives the car with (a wheel's direct steering with the
## soft lock); buttons press the game's own actions (shift up / down, look, pause...), an H-pattern gear selects it.

## The functions, in the order the setup page lists them. kind: "steer" (an axis, both ways), "axis" (0..1),
## "button" (an action of the game), "gear" (an H-pattern position).
const FUNCTIONS := [
	["steer", "steer", "Steering"],
	["throttle", "axis", "Throttle"],
	["brake", "axis", "Brake"],
	["clutch", "axis", "Clutch"],
	["handbrakeAxis", "axis", "Handbrake (lever)"],
	["shiftUp", "button", "Shift up"],
	["shiftDown", "button", "Shift down"],
	["gear1", "gear", "Gear 1"], ["gear2", "gear", "Gear 2"], ["gear3", "gear", "Gear 3"], ["gear4", "gear", "Gear 4"],
	["gear5", "gear", "Gear 5"], ["gear6", "gear", "Gear 6"], ["gear7", "gear", "Gear 7"], ["gearR", "gear", "Reverse"],
	["handbrake", "button", "Handbrake (button)"],
	["lookLeft", "button", "Look left"], ["lookRight", "button", "Look right"], ["lookBack", "button", "Look back"],
	["camera", "button", "Change camera"], ["pause", "button", "Pause"], ["resetCar", "button", "Reset to track"],
	["tcCycle", "button", "Traction control"], ["absToggle", "button", "ABS"],
	["brakeBiasUp", "button", "Brake bias forward"], ["brakeBiasDown", "button", "Brake bias rearward"],
	["timing", "button", "Timing screen"], ["replay", "button", "Replay"],
]

## Pressing a button bound to one of these holds the game's action while it is held (the others tap it).
const HOLD := ["lookLeft", "lookRight", "lookBack", "timing"]

## Where devices are read (Input; a test puts simulated ones here): connected ids, a name, an axis, a button.
static var fake := {}

static func joypads() -> Array:
	return fake.ids if fake.has("ids") else Array(Input.get_connected_joypads())

static func joy_name(d: int) -> String:
	return str(fake.names.get(d, "")) if fake.has("names") else Input.get_joy_name(d)

static func joy_axis(d: int, a: int) -> float:
	return float(fake.axes.get("%d/%d" % [d, a], 0.0)) if fake.has("axes") else Input.get_joy_axis(d, a)

static func joy_button(d: int, b: int) -> bool:
	return bool(fake.buttons.get("%d/%d" % [d, b], false)) if fake.has("buttons") else Input.is_joy_button_pressed(d, b)

var _held := {}
var _prev_buttons := {}

static func bindings() -> Dictionary:
	if not Settings.data.has("devices"):
		Settings.data["devices"] = {}
	return Settings.data.devices

## The connected device a binding means: by its name, the n-th of that name.
static func device_of(b: Dictionary) -> int:
	var n := 0
	for d in joypads():
		if PadMap.pad_key(joy_name(d)) == b.get("dev", ""):
			if n == int(b.get("nth", 0)):
				return d
			n += 1
	return -1

## A bound axis as 0..1 from its calibrated ends (min: released, max: pressed; turned round when max < min).
static func axis_01(b: Dictionary) -> float:
	var d := device_of(b)
	if d < 0:
		return 0.0
	var v := joy_axis(d, int(b.index))
	var lo: float = b.get("min", -1.0)
	var hi: float = b.get("max", 1.0)
	if is_equal_approx(lo, hi):
		return 0.0
	var f := clampf((v - lo) / (hi - lo), 0.0, 1.0)
	var dz: float = b.get("deadzone", 0.02)
	return clampf((f - dz) / (1.0 - dz * 2.0), 0.0, 1.0)

## The steering axis as -1 (right) .. +1 (left): min is full left, max full right, the middle straight ahead.
static func steer_value(b: Dictionary) -> float:
	var d := device_of(b)
	if d < 0:
		return 0.0
	var v := joy_axis(d, int(b.index))
	var lo: float = b.get("min", -1.0)
	var hi: float = b.get("max", 1.0)
	var mid := (lo + hi) * 0.5
	var half := absf(hi - lo) * 0.5
	if half < 1e-4:
		return 0.0
	var s := clampf((v - mid) / half * signf(hi - lo), -1.0, 1.0)
	return -s

static func pressed(b: Dictionary) -> bool:
	var d := device_of(b)
	if d < 0:
		return false
	if b.get("kind", "button") == "axis":
		# a button made of an axis (a sequential shifter some report so): past the middle of its range
		var v := joy_axis(d, int(b.index))
		return (v - float(b.get("min", 0.0))) / maxf(1e-4, float(b.get("max", 1.0)) - float(b.get("min", 0.0))) > 0.5
	return joy_button(d, int(b.index))

func _process(_dt: float) -> void:
	var bs := bindings()
	var rig: Dictionary = InputState.rig
	var drive_bound: bool = bs.has("steer") or bs.has("throttle") or bs.has("brake")
	var any_connected := false
	for k in ["steer", "throttle", "brake"]:
		if bs.has(k) and device_of(bs[k]) >= 0:
			any_connected = true
	rig.active = drive_bound and any_connected
	rig.steer = steer_value(bs.steer) if bs.has("steer") else 0.0
	rig.throttle = axis_01(bs.throttle) if bs.has("throttle") else 0.0
	rig.brake = pow(axis_01(bs.brake), float(Settings.data.wheel.get("brakeCurve", 1.0))) if bs.has("brake") else 0.0
	rig.clutch = axis_01(bs.clutch) if bs.has("clutch") else 0.0
	var hb := axis_01(bs.handbrakeAxis) if bs.has("handbrakeAxis") else 0.0
	if bs.has("handbrake") and pressed(bs.handbrake):
		hb = 1.0
	rig.handbrake = hb
	# the H-pattern: the gear whose position is held, else neutral when any gear is bound
	var gear := -99
	var h_bound := false
	for i in range(1, 8):
		var key := "gear%d" % i
		if bs.has(key):
			h_bound = true
			if pressed(bs[key]):
				gear = i
	if bs.has("gearR"):
		h_bound = true
		if pressed(bs.gearR):
			gear = -1
	rig.gear = (0 if gear == -99 else gear) if h_bound else -99
	# buttons: the game's actions, tapped or held
	for f in FUNCTIONS:
		if f[1] != "button" or f[0] == "handbrake" or not bs.has(f[0]):
			continue
		var on := pressed(bs[f[0]])
		var was: bool = _prev_buttons.get(f[0], false)
		_prev_buttons[f[0]] = on
		if HOLD.has(f[0]):
			if on != was:
				_press_action(f[0], on)
		elif on and not was:
			_press_action(f[0], true)
			_press_action(f[0], false)

## Presses or releases the first key bound to a game action (the game reads actions from the keys).
func _press_action(action: String, down: bool) -> void:
	var codes: Array = Settings.data.bindings.get(action, [])
	if codes.is_empty():
		return
	var k := KeyMap.key_of(codes[0])
	if k == KEY_NONE:
		return
	var e := InputEventKey.new()
	e.physical_keycode = k
	e.keycode = k
	e.pressed = down
	Input.parse_input_event(e)
