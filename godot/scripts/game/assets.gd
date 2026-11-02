class_name Assets
extends RefCounted
## Asset loading (port of game/assets.ts). The game's files are bundled with the app (res://assets, copied from the web
## game's assets by tools/godot/sync-assets.sh), so there is no download or retry logic: loads come from the package
## (ResourceLoader, optionally threaded). Paths in the data carry "?v=..." cache-busting queries: stripped here.

static func path(p: String) -> String:
	return "res://" + TrackData.strip_query(p)

## A PackedScene from a data path ("assets/cars/x/lod0.glb?v=..."), or null.
static func scene(p: String) -> PackedScene:
	var res = load(path(p))
	return res if res is PackedScene else null

## Starts loading in a thread; poll with scene_ready / get with scene_result.
static func request(p: String) -> void:
	ResourceLoader.load_threaded_request(path(p))

static func scene_ready(p: String) -> bool:
	return ResourceLoader.load_threaded_get_status(path(p)) != ResourceLoader.THREAD_LOAD_IN_PROGRESS

static func scene_result(p: String) -> PackedScene:
	var res = ResourceLoader.load_threaded_get(path(p))
	return res if res is PackedScene else null

## The track index (the lobby list).
static func load_track_index() -> Array:
	return TrackData.list_layouts()

## A layout by id (the default GP when the id is unknown). Adds {turns, map} from the index like the web client.
static func load_track_file(track_id: String = "") -> Dictionary:
	var index := load_track_index()
	var entry: Dictionary = {}
	for e in index:
		if e.id == track_id:
			entry = e
	if entry.is_empty():
		for e in index:
			if e.get("default", false):
				entry = e
	var d := TrackData.load_layout(entry)
	if d.get("turns", null) == null:
		d.turns = entry.get("turns", null)
	d.map = entry.get("map", "nurburgring")
	return d

## A loaded car model: {entry, lods: [PackedScene], first_level}. cockpit: your own car with its high-detail interior
## model in place of LOD0 (when the car has one). lods_wanted: levels first_level .. lods_wanted - 1.
static var _models := {}

static func load_car_model(entry: Dictionary, lods_wanted: int = 3, cockpit: bool = false, first_level: int = 0) -> Dictionary:
	var files: Array = []
	var cock = entry.get("cockpit", null)
	if cockpit and cock != null:
		files.append(cock)
		files.append_array(entry.lods.slice(1))
	else:
		files = entry.lods
	var first := mini(first_level, files.size() - 1)
	var key := "%s:%d-%d:%s" % [entry.id, first, lods_wanted, str(cockpit and cock != null)]
	if _models.has(key):
		return _models[key]
	var lods: Array = []
	for f in files.slice(first, lods_wanted):
		lods.append(scene(f))
	var m := {"entry": entry, "lods": lods, "first_level": first}
	_models[key] = m
	return m
