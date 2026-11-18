extends Node
## Player settings (port of settings.ts), an autoload named Settings. Same field names as the web game's, kept in
## `data` (a Dictionary) and saved to user://settings.json. Quality presets come from res://data/quality.json, which
## tools/godot/export-quality.mjs generates from settings.ts.

const CONTROL_ACTIONS := [
	"throttle", "brake", "steerLeft", "steerRight", "handbrake", "shiftUp", "shiftDown", "resetCar", "toggleGearbox",
	"lookLeft", "lookRight", "lookBack", "timing", "pause", "camera", "damage", "tvCamera", "deltaMode",
	"brakeBiasUp", "brakeBiasDown", "tcCycle", "absToggle", "chat", "replay",
]
const CAMERA_MODES := ["cockpit", "chase", "far"]

const ACTION_LABEL := {
	"throttle": "Throttle", "brake": "Brake / reverse", "steerLeft": "Steer left", "steerRight": "Steer right",
	"handbrake": "Handbrake", "shiftUp": "Shift up", "shiftDown": "Shift down", "resetCar": "Reset to track",
	"toggleGearbox": "Manual / automatic", "lookLeft": "Look left", "lookRight": "Look right", "lookBack": "Look back",
	"timing": "Timing screen (hold)", "pause": "Pause menu", "camera": "Change camera", "damage": "Damage report (hold)",
	"tvCamera": "TV cameras", "deltaMode": "Delta reference (best / optimal / sectors)",
	"brakeBiasUp": "Brake bias forward", "brakeBiasDown": "Brake bias rearward", "tcCycle": "Traction control level", "absToggle": "ABS on / off", "chat": "Text chat", "replay": "Replay",
}

## Key bindings by the web game's KeyboardEvent.code names (translated to Godot keys by InputMapper).
const DEFAULT_BINDINGS := {
	"throttle": ["KeyW", "ArrowUp"], "brake": ["KeyS", "ArrowDown"], "steerLeft": ["KeyA", "ArrowLeft"],
	"steerRight": ["KeyD", "ArrowRight"], "handbrake": ["Space"], "shiftUp": ["ShiftLeft", "KeyE"],
	"shiftDown": ["ControlLeft", "KeyQ"], "resetCar": ["KeyR"], "toggleGearbox": ["KeyM"], "lookLeft": ["KeyZ"],
	"lookRight": ["KeyC"], "lookBack": ["KeyX"], "timing": ["Tab"], "pause": ["Escape"], "camera": ["KeyV"],
	"damage": ["KeyF"], "tvCamera": ["KeyT"], "deltaMode": ["KeyG"],
	"brakeBiasUp": ["Equal"], "brakeBiasDown": ["Minus"], "tcCycle": ["KeyB"], "absToggle": ["KeyN"], "chat": ["KeyY"], "replay": ["KeyP"],
}

const SAVE_PATH := "user://settings.json"

signal changed

var data: Dictionary = {}
var _quality_file: Dictionary = {}
var _cached_key := ""
var _cached_q: Dictionary = {}
var _sessions := {}

func _ready() -> void:
	_move_old_user_dir()
	data = load_settings()

## The game was called Apex Ghost until 2026-11-17, and Godot keeps a game's data (settings, career, track packs) in a
## folder named after it: on the first start as CorsaGhost, what the old folder holds moves to the new one, so nothing
## is lost. (The Android app has a new package id: a new install with its own data.)
static func _move_old_user_dir() -> void:
	if OS.has_feature("mobile") or OS.has_feature("web"):
		return
	var now := OS.get_user_data_dir()
	var old := now.get_base_dir().path_join("Apex Ghost")
	if now.get_file() == "Apex Ghost" or FileAccess.file_exists(now.path_join("settings.json")) or not DirAccess.dir_exists_absolute(old):
		return
	DirAccess.make_dir_recursive_absolute(now)
	var d := DirAccess.open(old)
	if d == null:
		return
	var names := Array(d.get_files()) + Array(d.get_directories())
	for n in names:
		if n in ["logs", "shader_cache", "vulkan", "objectdb_snapshots"]:
			continue
		if DirAccess.rename_absolute(old.path_join(n), now.path_join(n)) != OK:
			DirAccess.copy_absolute(old.path_join(n), now.path_join(n))
	print("[settings] moved the saved data from %s to %s" % [old, now])

## The monitor the game's window belongs on: APEX_SCREEN, else the Display page's choice; -1 leaves it to the desktop.
static func wanted_screen() -> int:
	if OS.get_environment("APEX_SCREEN") != "":
		return int(OS.get_environment("APEX_SCREEN"))
	if Engine.get_main_loop() != null and (Engine.get_main_loop() as SceneTree).root.has_node("Settings"):
		var st = (Engine.get_main_loop() as SceneTree).root.get_node("Settings")
		return int(st.data.get("display", {}).get("screen", -1))
	return -1

## Moves the window to that monitor (the desktop places a new window on the main one whatever Godot asks).
static func place_window() -> void:
	var scr := wanted_screen()
	if scr < 0 or scr >= DisplayServer.get_screen_count() or OS.has_feature("mobile"):
		return
	if DisplayServer.window_get_current_screen() == scr:
		return
	var mode := DisplayServer.window_get_mode()
	if mode != DisplayServer.WINDOW_MODE_WINDOWED:
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED)
	DisplayServer.window_set_current_screen(scr)
	if mode != DisplayServer.WINDOW_MODE_WINDOWED:
		DisplayServer.window_set_mode(mode)

static func default_settings() -> Dictionary:
	return {
		"nickname": "", "quality": "medium", "qualityAuto": true, "graphics": {},
		"resolutionScale": 1.0, "dynamicResolution": true, "refreshRate": 60, "fov": 58, "seatHeight": 0.0, "seatForward": 0.0,
		# the window and the picture (Display page): windowed / borderless / fullscreen, vsync, a frame-rate cap (0: none),
		# the monitor it opens on (-1: where the desktop puts it; APEX_SCREEN overrides),
		# the upscaler used under a resolution scale below 100 %, and contrast / saturation over the game's own grade
		"display": {"windowMode": "windowed", "uiSize": "medium", "eyeAdaptation": true, "hdr": false, "lensFlare": true, "vsync": true, "maxFps": 0, "upscaler": "bilinear", "contrast": 1.0, "saturation": 1.0, "screen": -1, "sideScreens": "off", "sideAngle": 0},
		# the field-of-view calculator: the screen's visible width and the eyes' distance from it (cm)
		"screen": {"widthCm": 60.0, "distanceCm": 70.0},
		"assists": {"abs": true, "tc": 1, "stability": false, "steering": false}, "manualGearbox": false,
		"camera": "cockpit", "pitCamera": "tv", "mirror": true, "units": "kmh", "racingLine": "corners", "deltaMode": "best", "showPerf": false, "introCinematic": true,
		"headMovement": 1.0, "cameraShake": 1.0,
		"overlays": {"relative": true, "inputs": true, "spotter": true, "deltaBar": true, "trackMap": true},
		"audio": {"master": 0.8, "engine": 0.9, "effects": 0.8, "ambience": 0.6, "radio": 0.9, "opponents": 0.9, "tyres": 0.9, "chimes": true},
		"keyboard": {"throttleRamp": 0.2, "brakeRamp": 0.2, "steerSpeed": 1.0},
		"hud": {"layout": {}, "scale": 1.0, "opacity": 1.0, "timing": true, "lapInfo": true, "tyres": true, "revLights": true, "messages": true, "map": true},
		"chase": {"distance": 1.0, "height": 1.0, "lag": 1.0}, "lookToApex": 1.0, "brightness": 1.0, "ai": {"difficulty": 1.0},
		"carSetup": {"tyre": "medium", "wing": "medium", "brakeBias": 0.6, "pressure": null, "ride": [0, 0], "arb": [4, 4], "bump": [4, 4], "rebound": [4, 4], "fuelL": 60,
			"springs": [4, 4], "camber": [-3.2, -2.6], "toe": [-0.05, 0.15], "diffPreload": 110, "diffLock": 4, "diffCoast": 4,
			"brakePressure": 1.0, "brakeDucts": 3, "finalDrive": 0, "engineMap": 1},
		"savedSetups": {}, "profiles": {}, "privacy": {"showOnline": true}, "online": {"region": "auto"}, "ghost": true, "bindings": DEFAULT_BINDINGS.duplicate(true),
		# your car's paint (CarPaint, the car page of the lobby): colours, finish, design, race number, rims, calipers
		"livery": {"base": "#c8102e", "accent": "#f2f2f2", "finish": "gloss", "design": "stripes", "aero": "carbon", "number": 7, "showNumber": true, "numberColor": "#ffffff", "rims": "#1c1c1e", "calipers": "#ffd60a"},
		"wheel": {"mode": "auto", "rotationDeg": 900, "brakeCurve": 1.0},
		# wheels, pedals, shifters, handbrakes (DeviceBindings): function -> {dev, nth, kind, index, min, max, deadzone}
		"devices": {},
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

## Tests run through tests/runner.gd: nothing is written to the player's settings file.
static var testing := false

func save() -> void:
	if testing:
		changed.emit()
		return
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

## Detail groups of this app beside the exported ones (data/quality.json "groups", from the web game's settings.ts):
## each takes these keys from the preset it names.
const EXTRA_GROUPS := {"mirrors": ["mirrorEvery"], "cockpit": ["cockpitDetail"], "carDetail": ["carLodScale"]}

## Settings only this app has (the web game's presets do not carry them), by preset: a reflection probe that follows
## your car (the paint reflects the track, the barriers and the cars round it, not only the sky) and screen-space
## reflections (Ultra: the wet track and the paint mirror what is on screen). Taken with the "ao" group's preset.
const GODOT_PRESET_KEYS := {
	"low": {"carProbe": false, "ssr": false},
	"medium": {"carProbe": false, "ssr": false},
	"high": {"carProbe": true, "ssr": false},
	"ultra": {"carProbe": true, "ssr": true},
}

## True when some graphics setting differs from the preset (the page then says "Custom").
func is_custom() -> bool:
	return not (data.graphics as Dictionary).is_empty()

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
	var gk = o.get("ao", data.quality)
	q.merge(GODOT_PRESET_KEYS.get(gk if GODOT_PRESET_KEYS.has(gk) else data.quality, GODOT_PRESET_KEYS.low), true)
	var groups: Dictionary = _quality().groups
	for g in groups:
		var from = o.get(g)
		if from == null or not presets().has(from):
			continue
		for k in groups[g]:
			q[k] = presets()[from][k]
	for g in EXTRA_GROUPS:
		var from = o.get(g)
		if from == null or not presets().has(from):
			continue
		for k in EXTRA_GROUPS[g]:
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
	if RegEx.create_from_string("rtx\\s*(30[6-9]|40|50)|rx\\s*(6[7-9]|7[6-9]|9)\\d\\d|apple m[2-4] (pro|max)").search(r) != null:
		return "ultra"
	if RegEx.create_from_string("rtx|gtx\\s*1(07|08)|rx\\s*(5[67]|6[0-6])\\d\\d|radeon pro|apple m[1-4]").search(r) != null:
		return "high"
	if RegEx.create_from_string("intel|uhd|iris|hd graphics|mali|adreno|radeon(\\(tm\\))? graphics|vega\\s*\\d|renoir|cezanne|rembrandt|phoenix").search(r) != null:
		return "low"
	return "medium"
