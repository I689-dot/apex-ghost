class_name Garage
extends RefCounted
## The phone layout's garage (the user's picks of 2026-11-24, docs/prompts/mobile-f2p-pass.md): which cars you own and
## how the others unlock, after the free-to-play racing games' (RESOURCES/UI-MOBILE-REFERENCE 011, 045, 061, 067):
##  - every car has a rarity (common, rare, epic, legendary) and a rating (PR) from its power, weight, speed, aero and
##    brakes; the line-up is ten GT3 cars, so the ratings sit close together and the rarity tells them apart;
##  - a car unlocks with its credit price, or for free with enough of its blueprints (from chests, the free bonus, goals,
##    the pass);
##  - two starter cars are yours from the start, and the car you last drove before the garage came.
## Ownership counts in the phone layout's own pickers (the home, the solo lobby); online rooms and the PC menu keep every
## car (fair racing; web players share the rooms). Kept in the progression's file (Progression.data().garage).

const RARITY := ["common", "rare", "epic", "legendary"]
const RARITY_NAME := {"common": "Common", "rare": "Rare", "epic": "Epic", "legendary": "Legendary"}
const RARITY_COLOUR := {"common": Color("4fbf5a"), "rare": Color("3b8df0"), "epic": Color("a45af0"), "legendary": Color("f0a21b")}
## Credits and blueprints a car of each rarity takes to unlock.
const PRICE := {"common": 60000, "rare": 120000, "epic": 200000, "legendary": 320000}
const BLUEPRINTS := {"common": 10, "rare": 20, "epic": 35, "legendary": 50}

## The line-up's rarities (a car not listed is common).
const CARS := {
	"vantage_gt3_evo_heart_of_racing": "common",
	"ford_mustang_gt3": "common",
	"mercedes_amg_gt3_evo": "common",
	"bmw_m4_gt3_vecarz": "common",
	"2020_audi_r8_lms_evo": "rare",
	"bmw_m4_gt3_evo_2026": "rare",
	"mercedes_amg_gt3_red_bull_racing": "rare",
	"ferrari_296_gt3_verstappen": "epic",
	"2020_mclaren_720s_gt3": "epic",
	"2024_porsche_992_gt3_r": "legendary",
}
## Yours from the start.
const STARTERS := ["vantage_gt3_evo_heart_of_racing", "ford_mustang_gt3"]

static func _g() -> Dictionary:
	var d := Progression.data()
	if not d.has("garage"):
		var owned: Array = STARTERS.duplicate()
		# a player from before the garage keeps the car they drove
		var last := str(Settings.data.get("lastCar", ""))
		if last != "" and not owned.has(last) and not CarsDb.by_id(last).is_empty():
			owned.append(last)
		d.garage = {"owned": owned, "bp": {}, "revealed": owned.duplicate(), "goal": ""}
		Progression.save()
	return d.garage

static func rarity(id: String) -> String:
	return CARS.get(id, "common")

static func owns(id: String) -> bool:
	return (_g().owned as Array).has(id)

static func owned() -> Array:
	return (_g().owned as Array).duplicate()

static func price(id: String) -> int:
	return PRICE[rarity(id)]

static func blueprints(id: String) -> int:
	return int((_g().bp as Dictionary).get(id, 0))

static func blueprints_needed(id: String) -> int:
	return BLUEPRINTS[rarity(id)]

## Credits for a car: false when it is yours already or the credits are short.
static func buy(id: String) -> bool:
	if owns(id) or Progression.credits() < price(id):
		return false
	Progression.add_credits(-price(id))
	_unlock(id)
	return true

## Blueprints for a car; it unlocks when they reach its number. Returns true when that unlocked it.
static func add_blueprints(id: String, n: int) -> bool:
	if owns(id) or n <= 0:
		return false
	var bp: Dictionary = _g().bp
	bp[id] = int(bp.get(id, 0)) + n
	if int(bp[id]) >= blueprints_needed(id):
		_unlock(id)
		return true
	Progression.save()
	return false

static func _unlock(id: String) -> void:
	var g := _g()
	if not (g.owned as Array).has(id):
		(g.owned as Array).append(id)
	(g.bp as Dictionary).erase(id)
	if g.goal == id:
		g.goal = ""
	Progression.save()

## Unlocked but not yet shown in the full-screen reveal (MobileCars.reveal); shown once.
static func unrevealed() -> Array:
	var g := _g()
	return (g.owned as Array).filter(func(id: String) -> bool: return not (g.revealed as Array).has(id))

static func mark_revealed(id: String) -> void:
	var g := _g()
	if not (g.revealed as Array).has(id):
		(g.revealed as Array).append(id)
		Progression.save()

## The car the blueprints of chests and bonuses go to: the one the player chose, else the locked car closest to done.
static func goal() -> String:
	var g := _g()
	if str(g.goal) != "" and not owns(str(g.goal)):
		return str(g.goal)
	var best := ""
	var best_left := 1 << 30
	for c: Dictionary in CarsDb.selectable():
		if owns(c.id):
			continue
		var left := blueprints_needed(c.id) - blueprints(c.id)
		if left < best_left:
			best_left = left
			best = c.id
	return best

static func set_goal(id: String) -> void:
	_g().goal = id
	Progression.save()

## Blueprints for the goal car (chests, the free bonus): [car id, n, unlocked] or [] when every car is owned.
static func grant_goal(n: int) -> Array:
	var id := goal()
	if id == "":
		return []
	return [id, n, add_blueprints(id, n)]

# ----------------------------------------------------------------- stats ---

## A car's stats as the references show them: top speed (km/h), power-to-weight (hp a tonne), downforce (the aero
## area, m²), braking (the brakes' torque a tonne, kN·m/t), and the rating PR they add up to (about 600 for a GT3).
static func stats(c: Dictionary) -> Dictionary:
	var s: Dictionary = c.get("specs", {})
	var mass := maxf(1.0, float(s.get("massKg", 1400.0)))
	var hp_t := float(s.get("powerKw", 380.0)) * 1.341 / mass * 1000.0
	var top := float(s.get("topSpeedKmh", 280.0))
	var df := float(s.get("downforceArea", 3.0))
	var brake := float(s.get("brakeTorqueNm", 13000.0)) / mass
	var pr := roundi(hp_t * 0.65 + top * 0.5 + df * 40.0 + brake * 10.0)
	return {"top": top, "hpT": hp_t, "downforce": df, "brake": brake, "pr": pr}

## A stat's share of the line-up's range (0..1), for its bar: the slowest car of the line-up a third, the best full.
static func stat_share(key: String, value: float) -> float:
	var lo := INF
	var hi := -INF
	for c: Dictionary in CarsDb.selectable():
		var v: float = stats(c)[key]
		lo = minf(lo, v)
		hi = maxf(hi, v)
	if hi - lo < 1e-6:
		return 1.0
	return 0.35 + 0.65 * clampf((value - lo) / (hi - lo), 0.0, 1.0)
