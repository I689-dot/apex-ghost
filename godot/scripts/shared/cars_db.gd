class_name CarsDb
extends RefCounted
## The cars file (res://data/cars.json, copied from the web game's assets/cars.json): a Dictionary
## {version, forward, up, units, cars: [CarEntry]} with the CarEntry fields of packages/shared/src/cars.ts.

static var _file: Dictionary = {}

static func file() -> Dictionary:
	if _file.is_empty():
		_file = JSON.parse_string(FileAccess.get_file_as_string("res://data/cars.json"))
	return _file

static func all() -> Array:
	return file().cars

## The car with this id, or {} when unknown.
static func by_id(id: String) -> Dictionary:
	for c in all():
		if c.id == id:
			return c
	return {}

## Cars a player can pick (the safety car is not one).
static func selectable() -> Array:
	return all().filter(func(c): return c.get("role", null) != "safety")

## The race-control safety car, or {}.
static func safety_car() -> Dictionary:
	for c in all():
		if c.get("role", null) == "safety":
			return c
	return {}
