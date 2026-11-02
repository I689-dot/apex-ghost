class_name Gamepad
extends RefCounted
## Game controller helpers (rumble). The controller's analog input itself is read by GamepadInput (port of
## input/gamepad.ts); this class is what the rest of the game calls to shake the pad.

static var enabled := true
static var _last_ms := 0.0

## A hit or a rough surface: strength 0..1 (the web game's navigator.vibrate on the pad's actuators).
static func rumble(strength: float, duration_ms: float = 120.0) -> void:
	if not enabled or not Settings.data.pad.vibration:
		return
	var now := Time.get_ticks_msec() as float
	if now - _last_ms < 40.0:
		return
	_last_ms = now
	var s := clampf(strength, 0.0, 1.0)
	if s <= 0.01:
		return
	for id in Input.get_connected_joypads():
		Input.start_joy_vibration(id, s * 0.7, s, duration_ms / 1000.0)
	if s > 0.3 and DisplayServer.is_touchscreen_available() and TouchPrefs.get_pref("haptics"):
		Input.vibrate_handheld(int(duration_ms * s))
