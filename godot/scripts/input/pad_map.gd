class_name PadMap
extends RefCounted
## Turns whatever the engine reports for a controller into the layout the game reads (port of input/padMap.ts):
## buttons 0–16 = A B X Y LB RB LT RT View Menu L3 R3 ↑ ↓ ← → Home; axes LX LY RX RY.
## Godot maps known pads to the SDL standard layout itself; an unknown pad comes through with raw indices.
## A layout the player set up in Settings → Controller (per pad, see PadSetup) wins over both.

const STD_BUTTONS := 17

## Godot's JoyButton for each standard button index (triggers are axes in Godot: handled in read()).
const _JOY := [
	JOY_BUTTON_A, JOY_BUTTON_B, JOY_BUTTON_X, JOY_BUTTON_Y, JOY_BUTTON_LEFT_SHOULDER, JOY_BUTTON_RIGHT_SHOULDER, -1, -1,
	JOY_BUTTON_BACK, JOY_BUTTON_START, JOY_BUTTON_LEFT_STICK, JOY_BUTTON_RIGHT_STICK,
	JOY_BUTTON_DPAD_UP, JOY_BUTTON_DPAD_DOWN, JOY_BUTTON_DPAD_LEFT, JOY_BUTTON_DPAD_RIGHT, JOY_BUTTON_GUIDE,
]

## Storage key of a pad: its name without decoration.
static func pad_key(id: String) -> String:
	return " ".join(id.to_lower().split(" ", false)).strip_edges().substr(0, 80)

## "custom", "standard" or "raw" (Godot knows the pad's mapping).
static func layout_kind(device: int) -> String:
	var custom = Settings.data.pad.layouts.get(pad_key(Input.get_joy_name(device)), null)
	if custom != null:
		return "custom"
	return "standard" if Input.is_joy_known(device) else "raw"

static func source_value(device: int, s: Variant) -> float:
	if s == null:
		return 0.0
	if s.has("b"):
		return 1.0 if Input.is_joy_button_pressed(device, int(s.b)) else 0.0
	var v := Input.get_joy_axis(device, int(s.a))
	var rest: float = s.rest
	var span := (1.0 - rest) if s.dir > 0 else (rest + 1.0)
	return clampf(((v - rest) * s.dir) / (span if span != 0.0 else 1.0), 0.0, 1.0)

## {buttons: [{pressed, value}] × 17, axes: [LX, LY, RX, RY], layout, name}.
static func read(device: int) -> Dictionary:
	var kind := layout_kind(device)
	var layout = Settings.data.pad.layouts.get(pad_key(Input.get_joy_name(device)), null) if kind == "custom" else null
	var buttons: Array = []
	for i in STD_BUTTONS:
		var v := 0.0
		var pressed := false
		if layout != null:
			var s = layout.buttons[i] if i < layout.buttons.size() else null
			v = source_value(device, s)
			pressed = Input.is_joy_button_pressed(device, int(s.b)) if s != null and s.has("b") else v > 0.5
		elif i == 6:
			v = maxf(0.0, Input.get_joy_axis(device, JOY_AXIS_TRIGGER_LEFT))
			pressed = v > 0.5
		elif i == 7:
			v = maxf(0.0, Input.get_joy_axis(device, JOY_AXIS_TRIGGER_RIGHT))
			pressed = v > 0.5
		else:
			pressed = Input.is_joy_button_pressed(device, _JOY[i])
			v = 1.0 if pressed else 0.0
		buttons.append({"pressed": pressed, "value": v})
	var axes := [0.0, 0.0, 0.0, 0.0]
	var std := [JOY_AXIS_LEFT_X, JOY_AXIS_LEFT_Y, JOY_AXIS_RIGHT_X, JOY_AXIS_RIGHT_Y]
	for i in 4:
		if layout != null:
			var s = layout.axes[i] if i < layout.axes.size() else null
			axes[i] = Input.get_joy_axis(device, int(s.a)) * s.dir if s != null else 0.0
		else:
			axes[i] = Input.get_joy_axis(device, std[i])
	return {"buttons": buttons, "axes": axes, "layout": kind, "name": Input.get_joy_name(device)}

## Plausible game controllers only (a keyboard's "joystick" interface reports no sticks).
static func plausible(device: int) -> bool:
	return Input.get_joy_name(device) != ""
