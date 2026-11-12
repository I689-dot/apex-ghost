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

## Cars the shared server still lists but the app no longer has (the 2026-11 line-up: docs/spa-rebuild): a web player
## can still pick one in a shared room. Drawn (and driven, for a bot) as the closest car the app has.
const FALLBACK := {
	"bmw_m4_touring_nh_24h": "bmw_m4_gt3_vecarz",
	"2025_bmw_m4_gt3_evo_g82": "bmw_m4_gt3_evo_2026",
	"corvette_z06_gt3r": "ford_mustang_gt3",
	"lexus_rc_f_gt3": "ford_mustang_gt3",
	"ferrari_296_challenge_2024": "ferrari_296_gt3_verstappen",
	# the Huracán shares the R8's V10 platform
	"lamborghini_huracan_gt3_evo": "2020_audi_r8_lms_evo",
	"2023_lamborghini_huracan_gt3_evo2": "2020_audi_r8_lms_evo",
	"lamborghini_huracan_gt3_evo2": "2020_audi_r8_lms_evo",
	"lamborghini_temerario_gt3": "2020_audi_r8_lms_evo",
	"2015_mclaren_650s_gt3": "2020_mclaren_720s_gt3",
	"mclaren_720s_gt3_inception_racing": "2020_mclaren_720s_gt3",
	"mclaren_720s_lmgt3_evo": "2020_mclaren_720s_gt3",
	"2015_mercedes_amg_gt3_marin_kitagawa": "mercedes_amg_gt3_evo",
	"2022_mercedes_amg_project_one": "mercedes_amg_gt3_evo",
	"porsche_992_gt3_r": "2024_porsche_992_gt3_r",
	"porsche_911_gt3_r_rennsport": "2024_porsche_992_gt3_r",
}
const DEFAULT_FALLBACK := "vantage_gt3_evo_heart_of_racing"

## The car to draw for an id: itself, else its FALLBACK, else the Vantage ({} only if the file has none of them).
static func resolve(id: String) -> Dictionary:
	var c := by_id(id)
	if not c.is_empty():
		return c
	c = by_id(FALLBACK.get(id, DEFAULT_FALLBACK))
	return c if not c.is_empty() else by_id(DEFAULT_FALLBACK)

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
