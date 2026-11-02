class_name KeyboardInput
extends RefCounted
## Raw digital key state against the player's key bindings (port of class Keyboard in physics/input.ts).
## held(action): is a bound key down now; tapped(action): pressed since end_frame() (feed events with process_event).

var bindings: Dictionary
var _pressed := {} # Godot physical keycode -> true, since the last end_frame()

func _init(key_bindings: Dictionary) -> void:
	bindings = key_bindings

func set_bindings(b: Dictionary) -> void:
	bindings = b

## Call from _input / _unhandled_input with every event.
func process_event(e: InputEvent) -> void:
	if e is InputEventKey and e.pressed and not e.echo:
		_pressed[e.physical_keycode] = true

func held(action: String) -> bool:
	for code in bindings.get(action, []):
		var k := KeyMap.key_of(code)
		if k != KEY_NONE and Input.is_physical_key_pressed(k):
			return true
	return false

## True once per key press. Call end_frame() after reading.
func tapped(action: String) -> bool:
	for code in bindings.get(action, []):
		var k := KeyMap.key_of(code)
		if k != KEY_NONE and _pressed.has(k):
			return true
	return false

func end_frame() -> void:
	_pressed.clear()
