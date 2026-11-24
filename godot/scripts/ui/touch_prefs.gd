class_name TouchPrefs
extends RefCounted
## Touch control preferences (port of mobile/touchSettings.ts, data part): how the phone steers (two arrow buttons, a
## drag slider, or tilting the phone like a wheel), button size, vibration, opacity. Saved to user://touch.json.

const SAVE_PATH := "user://touch.json"
## chosen: the control type picked on the first-launch screen (MobileControls)
const DEFAULTS := {"steer": "buttons", "tiltRange": 28.0, "tiltInvert": false, "size": 1.0, "haptics": true, "opacity": 0.7, "chosen": false}

static var data: Dictionary = {}
static var _listeners: Array[Callable] = []

static func _ensure() -> void:
	if not data.is_empty():
		return
	data = DEFAULTS.duplicate()
	data.merge(JsonFile.read(SAVE_PATH), true)

static func get_pref(key: String) -> Variant:
	_ensure()
	return data[key]

static func set_pref(key: String, value: Variant) -> void:
	_ensure()
	data[key] = value
	save()

static func save() -> void:
	_ensure()
	JsonFile.write(SAVE_PATH, data)
	for l in _listeners:
		l.call()

static func on_change(fn: Callable) -> void:
	_listeners.append(fn)
