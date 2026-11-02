class_name TouchPrefs
extends RefCounted
## Touch control preferences (port of mobile/touchSettings.ts, data part): how the phone steers (two arrow buttons, a
## drag slider, or tilting the phone like a wheel), button size, vibration, opacity. Saved to user://touch.json.

const SAVE_PATH := "user://touch.json"
const DEFAULTS := {"steer": "buttons", "tiltRange": 28.0, "tiltInvert": false, "size": 1.0, "haptics": true, "opacity": 0.7}

static var data: Dictionary = {}
static var _listeners: Array[Callable] = []

static func _ensure() -> void:
	if not data.is_empty():
		return
	data = DEFAULTS.duplicate()
	if FileAccess.file_exists(SAVE_PATH):
		var v = JSON.parse_string(FileAccess.get_file_as_string(SAVE_PATH))
		if typeof(v) == TYPE_DICTIONARY:
			data.merge(v, true)

static func get_pref(key: String) -> Variant:
	_ensure()
	return data[key]

static func set_pref(key: String, value: Variant) -> void:
	_ensure()
	data[key] = value
	save()

static func save() -> void:
	_ensure()
	var f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if f != null:
		f.store_string(JSON.stringify(data))
	for l in _listeners:
		l.call()

static func on_change(fn: Callable) -> void:
	_listeners.append(fn)
