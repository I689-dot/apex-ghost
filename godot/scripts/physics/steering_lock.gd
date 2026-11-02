class_name SteeringLock
extends RefCounted
## Steering-wheel lock to lock (degrees) of each car (port of physics/steeringLock.ts).

static var _locks: Array = []

static func _init_locks() -> void:
	var table := [
		["porsche", 800], ["ferrari_296_gt3", 800], ["ferrari_296_challenge", 640], ["bmw_m4", 516],
		["mercedes_amg_gt3|mercedes_amg_gt3_evo|marin_kitagawa", 640], ["project_one", 540], ["mclaren", 480],
		["lamborghini", 620], ["audi", 720], ["vantage", 640], ["lexus", 640], ["mustang", 516], ["corvette", 560],
	]
	for row in table:
		var re := RegEx.new()
		re.compile(row[0])
		_locks.append([re, row[1]])

static func lock_deg(car_id: String) -> int:
	if _locks.is_empty():
		_init_locks()
	for row in _locks:
		if row[0].search(car_id) != null:
			return row[1]
	return 600
