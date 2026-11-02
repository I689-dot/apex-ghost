extends Node
## Player settings (port of settings.ts), an autoload named Settings. Same field names as the web game's, kept in
## `data` (a Dictionary) and saved to user://settings.json. Quality presets come from res://data/quality.json, which
## tools/godot/export-quality.mjs generates from settings.ts.

const CONTROL_ACTIONS := [
	"throttle", "brake", "steerLeft", "steerRight", "handbrake", "shiftUp", "shiftDown", "resetCar", "toggleGearbox",
	"lookLeft", "lookRight", "lookBack", "timing", "pause", "camera", "damage", "tvCamera",
]
const CAMERA_MODES := ["cockpit", "chase", "far"]

const ACTION_LABEL := {
	"throttle": "Throttle", "brake": "Brake / reverse", "steerLeft": "Steer left", "steerRight": "Steer right",
	"handbrake": "Handbrake", "shiftUp": "Shift up", "shiftDown": "Shift down", "resetCar": "Reset to track",
	"toggleGearbox": "Manual / automatic", "lookLeft": "Look left", "lookRight": "Look right", "lookBack": "Look back",
	"timing": "Timing screen (hold)", "pause": "Pause menu", "camera": "Change camera", "damage": "Damage report (hold)",
	"tvCamera": "TV cameras",
}

## Key bindings by the web game's KeyboardEvent.code names (translated to Godot keys by InputMapper).
const DEFAULT_BINDINGS := {
	"throttle": ["KeyW", "ArrowUp"], "brake": ["KeyS", "ArrowDown"], "steerLeft": ["KeyA", "ArrowLeft"],
	"steerRight": ["KeyD", "ArrowRight"], "handbrake": ["Space"], "shiftUp": ["ShiftLeft", "KeyE"],
	"shiftDown": ["ControlLeft", "KeyQ"], "resetCar": ["KeyR"], "toggleGearbox": ["KeyM"], "lookLeft": ["KeyZ"],
	"lookRight": ["KeyC"], "lookBack": ["KeyX"], "timing": ["Tab"], "pause": ["Escape"], "camera": ["KeyV"],
	"damage": ["KeyF"], "tvCamera": ["KeyT"],
}

const SAVE_PATH := "user://settings.json"

signal changed

var data: Dictionary = {}
var _quality_file: Dictionary = {}
var _cached_key := ""
var _cached_q: Dictionary = {}
var _sessions := {}

func _ready() -> void:
	data = load_settings()
	I18n.set_lang(data.language)

static func default_settings() -> Dictionary:
	return {
		"nickname": "", "language": I18n.default_lang(), "quality": "medium", "qualityAuto": true, "graphics": {},
		"resolutionScale": 1.0, "dynamicResolution": true, "refreshRate": 60, "fov": 58, "seatHeight": 0.0, "seatForward": 0.0,
		"assists": {"abs": true, "tc": 1, "stability": false, "steering": false}, "manualGearbox": false,
		"camera": "cockpit", "pitCamera": "tv", "mirror": true, "units": "kmh", "racingLine": "corners", "showPerf": true,
		"headMovement": 1.0, "cameraShake": 1.0,
		"overlays": {"relative": true, "inputs": true, "spotter": true, "deltaBar": true, "trackMap": true},
		"audio": {"master": 0.8, "engine": 0.9, "effects": 0.8, "ambience": 0.6, "radio": 0.9, "opponents": 0.9, "tyres": 0.9, "chimes": true},
		"keyboard": {"throttleRamp": 0.2, "brakeRamp": 0.2, "steerSpeed": 1.0},
		"hud": {"scale": 1.0, "opacity": 1.0, "timing": true, "lapInfo": true, "tyres": true, "revLights": true, "messages": true, "map": true},
		"chase": {"distance": 1.0, "height": 1.0, "lag": 1.0}, "lookToApex": 1.0, "brightness": 1.0, "ai": {"difficulty": 1.0},
		"carSetup": {"tyre": "medium", "wing": "medium", "brakeBias": 0.6, "pressure": null, "ride": [0, 0], "arb": [4, 4], "bump": [4, 4], "rebound": [4, 4], "fuelL": 60},
		"ghost": true, "bindings": DEFAULT_BINDINGS.duplicate(true),
		"wheel": {"mode": "auto", "rotationDeg": 900, "brakeCurve": 1.0},
		"pad": {
			"deadzone": 0.06, "steerCurve": 1.7, "steerSpeed": 1.0, "speedSens": 0.5, "brakeCurve": 1.4, "throttleDeadzone": 0.04,
			"throttleSaturation": 0.96, "throttleCurve": 1.1, "brakeDeadzone": 0.04, "brakeSaturation": 0.96, "steerSaturation": 0.97,
			"pedals": "triggers", "digitalRamp": 0.6, "vibration": true, "layouts": {},
		},
	}

## Recursively lays `over` on `base` for dictionaries (arrays and scalars replace).
static func merge_deep(base: Dictionary, over: Dictionary) -> Dictionary:
	var out := base.duplicate(true)
	for k in over:
		if out.has(k) and typeof(out[k]) == TYPE_DICTIONARY and typeof(over[k]) == TYPE_DICTIONARY and k != "layouts" and k != "graphics":
			out[k] = merge_deep(out[k], over[k])
		else:
			out[k] = over[k]
	return out

func load_settings() -> Dictionary:
	var defaults := default_settings()
	if not FileAccess.file_exists(SAVE_PATH):
		return defaults
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(SAVE_PATH))
	if typeof(parsed) != TYPE_DICTIONARY:
		return defaults
	var merged := merge_deep(defaults, parsed)
	# the old default (72 degrees, a very wide view) moves to the new one
	if parsed.get("fov") == 72:
		merged.fov = defaults.fov
	return merged

func save() -> void:
	var f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if f != null:
		f.store_string(JSON.stringify(data))
	changed.emit()

# Session tokens for reconnecting to a room (kept for the app's run).
func get_session(room_code: String) -> Variant:
	return _sessions.get(room_code)

func set_session(room_code: String, token: Variant) -> void:
	if token:
		_sessions[room_code] = token
	else:
		_sessions.erase(room_code)

# --------------------------------------------------------------- quality ---

func _quality() -> Dictionary:
	if _quality_file.is_empty():
		_quality_file = JSON.parse_string(FileAccess.get_file_as_string("res://data/quality.json"))
	return _quality_file

func presets() -> Dictionary:
	return _quality().quality

## The graphics in effect: the preset with the individual settings over it. The same object while nothing changes.
func quality_config() -> Dictionary:
	var key := "%s|%s" % [data.quality, JSON.stringify(data.graphics)]
	if key == _cached_key:
		return _cached_q
	var q: Dictionary = presets()[data.quality].duplicate()
	var o: Dictionary = data.graphics
	var groups: Dictionary = _quality().groups
	for g in groups:
		var from = o.get(g)
		if from == null or not presets().has(from):
			continue
		for k in groups[g]:
			q[k] = presets()[from][k]
	if o.has("antialias"):
		q.antialias = o.antialias
	if o.has("superSample"):
		q.superSample = o.superSample
	# a phone's GPU: the far forest closer and thinner (the impostor cards are most of the draw calls)
	if OS.has_feature("mobile") and data.quality != "high" and data.quality != "ultra":
		q.forestFar = minf(float(q.forestFar), 650.0)
		q.forestDensity = float(q.forestDensity) * 0.8
	_cached_key = key
	_cached_q = q
	return q

## First-launch guess from the GPU name.
func detect_quality() -> String:
	var r := RenderingServer.get_video_adapter_name().to_lower()
	if r.is_empty() or RegEx.create_from_string("swiftshader|llvmpipe|software|basic render").search(r) != null:
		return "low"
	if RegEx.create_from_string("rtx\\s*(30[6-9]|40|50)|rx\\s*(6[7-9]|7[7-9]|9)\\d\\d|apple m[2-4] (pro|max)").search(r) != null:
		return "ultra"
	if RegEx.create_from_string("rtx|gtx\\s*1(07|08)|rx\\s*(5[67]|6[0-6])\\d\\d|radeon pro|apple m[1-4]").search(r) != null:
		return "high"
	if RegEx.create_from_string("intel|uhd|iris|hd graphics|mali|adreno|radeon(\\(tm\\))? graphics|vega\\s*\\d|renoir|cezanne|rembrandt|phoenix").search(r) != null:
		return "low"
	return "medium"
