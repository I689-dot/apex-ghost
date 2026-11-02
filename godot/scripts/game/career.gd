class_name CareerData
extends RefCounted
## The solo career, after the games' progression (port of career.ts): experience and driver levels (Forza, Gran
## Turismo) and an iRacing licence with its Safety Rating, coins and the garage. Kept on this device
## (user://career.json). A career is a Dictionary {xp, licence, sr, sessions, races, wins, podiums, poles, km,
## cleanLaps, coins, owned, daily}.

const LICENCES := ["R", "D", "C", "B", "A", "P"]
const LICENCE_NAME := {"R": "Rookie", "D": "Class D", "C": "Class C", "B": "Class B", "A": "Class A", "P": "Pro"}
const LICENCE_COLOUR := {"R": "#d63a3a", "D": "#f08a24", "C": "#e8c21b", "B": "#36b04a", "A": "#2f7de1", "P": "#1b1d22"}
const SAVE_PATH := "user://career.json"

static func _start() -> Dictionary:
	return {
		"xp": 0, "licence": "R", "sr": 2.5, "sessions": 0, "races": 0, "wins": 0, "podiums": 0, "poles": 0, "km": 0.0,
		"cleanLaps": 0, "coins": 100000, "owned": [], "daily": "",
	}

static func load_career() -> Dictionary:
	var c := _start()
	if FileAccess.file_exists(SAVE_PATH):
		var v = JSON.parse_string(FileAccess.get_file_as_string(SAVE_PATH))
		if typeof(v) == TYPE_DICTIONARY:
			c.merge(v, true)
	return c

static func save_career(c: Dictionary) -> void:
	var f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if f != null:
		f.store_string(JSON.stringify(c))

## XP a level needs: 500 for the first, 250 more for each one after. Returns {level, into, need}.
static func level_of(xp: float) -> Dictionary:
	var level := 1
	var need := 500
	var left := xp
	while left >= need:
		left -= need
		level += 1
		need += 250
	return {"level": level, "into": left, "need": need}

## The session's Safety Rating change: clean corners raise it slowly, incidents take it down; ~100 corners per
## incident point is neutral.
static func sr_delta(corners: float, incidents: float) -> float:
	if corners <= 0.0:
		return 0.0
	var cpi := corners / maxf(0.5, incidents)
	var target := minf(0.12, maxf(-0.3, log(cpi / 100.0) / log(2.0) * 0.06))
	return target * minf(1.0, corners / 120.0)

## Adds a session to the career; returns what it gave. s = {kind, km, laps, cleanLaps, corners, incidents,
## personalBests, difficulty?, position, field, start}.
static func add_session(s: Dictionary) -> Dictionary:
	var c := load_career()
	var lines: Array = []
	var add := func(label: String, xp: float) -> void:
		if xp > 0.0:
			lines.append([label, roundi(xp)])
	add.call("Distance", s.km * 5.0)
	add.call("Clean laps", s.cleanLaps * 20.0)
	add.call("Personal bests", s.personalBests * 50.0)
	if s.kind == "race" and s.position > 0:
		add.call("Finishing position", (s.field - s.position + 1) * 25.0)
		if s.start > s.position:
			add.call("Places gained", (s.start - s.position) * 30.0)
		if s.position == 1:
			add.call("Win", 250.0)
		elif s.position <= 3:
			add.call("Podium", 120.0)
	if s.kind == "qualifying" and s.position == 1 and s.field > 1:
		add.call("Pole position", 150.0)
	var xp := 0
	for l in lines:
		xp += l[1]
	# coins, as Gran Turismo's prize money and Forza's credits
	var coin_lines: Array = []
	var diff: float = s.get("difficulty", 1.0)
	var pay := func(label: String, v: float) -> void:
		if v > 0.0:
			coin_lines.append([label, roundi(v * pow(diff, 3.0) / 10.0) * 10])
	if s.kind == "race" and s.position > 0:
		var share := maxf(0.1, 1.0 - (s.position - 1.0) / maxf(1.0, s.field))
		pay.call("Prize money", (6000.0 + 2500.0 * minf(12.0, s.field)) * pow(share, 1.5))
		if s.start > s.position:
			pay.call("Places gained", (s.start - s.position) * 1500.0)
	if s.kind == "qualifying" and s.position == 1 and s.field > 1:
		pay.call("Pole position", 8000.0)
	pay.call("Clean laps", s.cleanLaps * 600.0)
	pay.call("Distance", s.km * 120.0)
	if s.kind == "race" and s.position > 0 and s.incidents == 0 and s.laps > 0:
		var base := 0
		for l in coin_lines:
			base += l[1]
		coin_lines.append(["Clean race bonus", roundi(base * 0.05) * 10])
	var coins := 0
	for l in coin_lines:
		coins += l[1]
	c.coins += coins
	var before := {"level": level_of(c.xp).level, "licence": c.licence, "sr": c.sr}
	c.xp += xp
	c.sessions += 1
	c.km += s.km
	c.cleanLaps += s.cleanLaps
	if s.kind == "race":
		c.races += 1
		if s.position == 1:
			c.wins += 1
		if s.position > 0 and s.position <= 3:
			c.podiums += 1
	if s.kind == "qualifying" and s.position == 1 and s.field > 1:
		c.poles += 1
	c.sr = maxf(0.0, minf(4.99, c.sr + sr_delta(s.corners, s.incidents)))
	var i := LICENCES.find(c.licence)
	if i < LICENCES.size() - 1 and c.sr >= (3.0 if c.licence == "R" else 4.0):
		c.licence = LICENCES[i + 1]
		c.sr -= 1.0
	elif i > 0 and c.sr < 1.0:
		c.licence = LICENCES[i - 1]
		c.sr = 2.5
	save_career(c)
	return {
		"xp": xp, "lines": lines, "coins": coins, "coinLines": coin_lines, "levelBefore": before.level,
		"levelAfter": level_of(c.xp).level, "licenceBefore": before.licence, "licenceAfter": c.licence,
		"srBefore": before.sr, "srAfter": c.sr,
	}

# ------------------------------------------------------------- the garage ---

## A car's price in coins: by power to weight, a little more for a newer model.
static func car_price(car: Dictionary) -> int:
	var pw: float = float(car.specs.powerKw) / float(car.specs.massKg)
	var year: float = float(car.year) if car.get("year") != null else 2015.0
	var p := 60000.0 + maxf(0.0, pw - 0.24) * 3200000.0 + maxf(0.0, year - 2015.0) * 5000.0
	return int(roundf(minf(900000.0, maxf(50000.0, p)) / 5000.0)) * 5000

## The garage the first time: the three most affordable cars, and the car last driven. Later calls change nothing.
static func init_garage(cars: Array, current: Variant = null) -> void:
	var c := load_career()
	if not c.owned.is_empty():
		return
	var sorted := cars.duplicate()
	sorted.sort_custom(func(a, b): return car_price(a) < car_price(b))
	c.owned = sorted.slice(0, 3).map(func(x): return x.id)
	if current != null and not c.owned.has(current):
		c.owned.append(current)
	save_career(c)

static func owns_car(id: String) -> bool:
	return load_career().owned.has(id)

## Buys a car: false when there are not coins enough.
static func buy_car(car: Dictionary) -> bool:
	var c := load_career()
	if c.owned.has(car.id):
		return true
	var price := car_price(car)
	if c.coins < price:
		return false
	c.coins -= price
	c.owned.append(car.id)
	save_career(c)
	return true

## The daily bonus (5,000 coins, once a day): what was given, 0 if already today.
static func claim_daily() -> int:
	var c := load_career()
	var today := Time.get_date_string_from_system(true)
	if c.daily == today:
		return 0
	c.daily = today
	c.coins += 5000
	save_career(c)
	return 5000
