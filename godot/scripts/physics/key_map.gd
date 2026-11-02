class_name KeyMap
extends RefCounted
## Translates the web game's KeyboardEvent.code names (the key bindings in the settings) to Godot keys.

static var _map := {}

static func _build() -> void:
	for i in 26:
		_map["Key%s" % char(65 + i)] = KEY_A + i
	for i in 10:
		_map["Digit%d" % i] = KEY_0 + i
		_map["Numpad%d" % i] = KEY_KP_0 + i
	for i in range(1, 13):
		_map["F%d" % i] = KEY_F1 + i - 1
	_map.merge({
		"ArrowUp": KEY_UP, "ArrowDown": KEY_DOWN, "ArrowLeft": KEY_LEFT, "ArrowRight": KEY_RIGHT,
		"Space": KEY_SPACE, "Enter": KEY_ENTER, "NumpadEnter": KEY_KP_ENTER, "Escape": KEY_ESCAPE, "Tab": KEY_TAB,
		"Backspace": KEY_BACKSPACE, "ShiftLeft": KEY_SHIFT, "ShiftRight": KEY_SHIFT, "ControlLeft": KEY_CTRL,
		"ControlRight": KEY_CTRL, "AltLeft": KEY_ALT, "AltRight": KEY_ALT, "Comma": KEY_COMMA, "Period": KEY_PERIOD,
		"Slash": KEY_SLASH, "Semicolon": KEY_SEMICOLON, "Quote": KEY_APOSTROPHE, "BracketLeft": KEY_BRACKETLEFT,
		"BracketRight": KEY_BRACKETRIGHT, "Backslash": KEY_BACKSLASH, "Minus": KEY_MINUS, "Equal": KEY_EQUAL,
		"Backquote": KEY_QUOTELEFT, "PageUp": KEY_PAGEUP, "PageDown": KEY_PAGEDOWN, "Home": KEY_HOME, "End": KEY_END,
		"Insert": KEY_INSERT, "Delete": KEY_DELETE,
	})

## The Godot key of a web key code ("KeyW" -> KEY_W), or KEY_NONE.
static func key_of(code: String) -> int:
	if _map.is_empty():
		_build()
	return _map.get(code, KEY_NONE)

## The web code of a Godot physical keycode (for the key-binding editor), or "".
static func code_of(keycode: int) -> String:
	if _map.is_empty():
		_build()
	for c in _map:
		if _map[c] == keycode:
			return c
	return ""
