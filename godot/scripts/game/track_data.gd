class_name TrackData
extends RefCounted
## Loads the track index and layout JSON files (copied to res://data by tools/godot/sync-assets.sh).
## The web build's file paths carry cache-busting "?v=..." queries: they are stripped here.

static func strip_query(path: String) -> String:
	var q := path.find("?")
	return path if q < 0 else path.substr(0, q)

static func _read_json(path: String) -> Variant:
	return JSON.parse_string(FileAccess.get_file_as_string(path))

## The lobby list: [{id, name, length, turns, file, default, map}, ...].
static func list_layouts() -> Array:
	var idx: Dictionary = _read_json("res://data/tracks.json")
	return idx.tracks

## One layout's data by id (res://data/track.json for the default layout, res://data/tracks/<n>.json for the others).
static func load_layout(layout: Dictionary) -> Dictionary:
	var file := strip_query(layout.file)
	var path := "res://data/" + file.get_file() if file == "assets/track.json" else "res://data/tracks/" + file.get_file()
	var t: Dictionary = _read_json(path)
	# JSON numbers are floats: the arrays stay generic Arrays (indexing is the same)
	t.collision.file = strip_query(t.collision.file)
	if t.collision.has("extra"):
		t.collision.extra = (t.collision.extra as Array).map(strip_query)
	for k in t.files:
		t.files[k] = strip_query(t.files[k])
	for c in t.chunks:
		c.file = strip_query(c.file)
	if t.has("forest") and t.forest != null:
		t.forest.file = strip_query(t.forest.file)
		t.forest.meta = strip_query(t.forest.meta)
	return t
