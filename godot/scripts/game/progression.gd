class_name Progression
extends RefCounted
## The mobile layout's progression (the user, 2026-11-20: a phone UI after RESOURCES/UI-MOBILE-REFERENCE, a free-to-play
## racing game's: career cups, a season pass, daily contracts and rewards with ads). Kept on this device
## (user://progression.json), beside the career (CareerData: XP, licence, credits) whose credits it pays into.
##
##  - Career cups: a ladder of cups by class (CUPS), each a few races; a race gives trophies by the finishing place (3 a
##    win, 2 a podium, 1 a top-6 finish), its best kept. A cup opens at a total number of trophies.
##  - Season pass: XP from every offline session; a tier every PASS_TIER_XP; each tier a free reward and a premium one
##    (the premium track is a store preview: no payments, StoreScreen).
##  - Contracts: three a day, the same for everyone that day (seeded by the date), progressed by offline sessions.
##  - Daily wins: a chest a win, up to DAILY_WINS a day.
##  - Ads: placeholders (MobileAds): the free bonus every FREE_BONUS_S, double rewards after a race, an interstitial
##    every few races. No ad network is set up.

const SAVE_PATH := "user://progression.json"
const PASS_TIERS := 30
const PASS_TIER_XP := 400
const PASS_SEASON_DAYS := 42
const DAILY_WINS := 6
const FREE_BONUS_S := 4 * 3600
## Races between two interstitial placeholders (never after a race the player doubled with a rewarded ad).
const INTERSTITIAL_EVERY := 3

## [id, class (licence letter), name, races: [trackId, laps, bots, AI difficulty], trophies needed, credits a trophy]
const CUPS := [
	["rookie_cup", "R", "Rookie Cup", [["zandvoort", 3, 7, 0.88], ["nurburgring_short", 3, 7, 0.9], ["silverstone", 2, 7, 0.9]], 0, 1500],
	["d_trophy", "D", "Class D Trophy", [["barcelona", 3, 9, 0.92], ["spa", 2, 9, 0.92], ["zandvoort", 4, 9, 0.93], ["shanghai", 2, 9, 0.93]], 6, 2000],
	["c_series", "C", "Class C Series", [["nurburgring_gp_2022", 3, 9, 0.95], ["silverstone", 3, 9, 0.95], ["barcelona", 4, 9, 0.96], ["spa", 3, 9, 0.96]], 16, 2600],
	["b_grand_prix", "B", "Class B Grand Prix", [["shanghai", 3, 11, 0.98], ["zandvoort", 5, 11, 0.98], ["spa", 3, 11, 0.99], ["silverstone", 4, 11, 0.99], ["nurburgring_gp_2022", 4, 11, 1.0]], 30, 3400],
	["a_masters", "A", "Class A Masters", [["spa", 4, 11, 1.02], ["barcelona", 5, 11, 1.02], ["shanghai", 4, 11, 1.03], ["silverstone", 5, 11, 1.04], ["nurburgring_gp_2022", 5, 11, 1.05]], 48, 4400],
	["pro_endurance", "P", "Pro Endurance", [["nurburgring_24h", 1, 11, 1.05], ["spa", 8, 11, 1.06], ["silverstone", 8, 11, 1.06]], 66, 6000],
]

## Contract kinds: [kind, text (with {n}), target range [lo, hi], credits, pass XP]
const CONTRACTS := [
	["finish", "Finish {n} races", [2, 3], 3000, 120],
	["win", "Win {n} race", [1, 1], 4000, 160],
	["podium", "Finish {n} races on the podium", [1, 2], 3500, 140],
	["clean", "Drive {n} clean laps", [4, 8], 2500, 100],
	["km", "Drive {n} km", [20, 40], 2500, 100],
	["overtakes", "Gain {n} places in races", [3, 6], 3000, 120],
]

## The pass's rewards: [kind, amount] by tier (1-based); premium doubles credits and adds paint and pass XP boosts.
static func pass_reward(tier: int, premium: bool) -> Array:
	if premium:
		if tier % 5 == 0:
			return ["paint", tier / 5]
		return ["credits", 4000 + tier * 300]
	if tier % 10 == 0:
		return ["coins", 50]
	return ["credits", 1500 + tier * 150]

static var _data: Dictionary = {}
## Tests: nothing written (the progression stays in memory, credits counted in it, not paid into the career).
static var dry := false

static func _start() -> Dictionary:
	return {
		"cups": {}, "passXp": 0, "passSeason": _season_index(), "passClaimed": {"free": [], "premium": []}, "passPremium": false,
		"contractsDay": "", "contracts": [], "winsDay": "", "wins": 0, "chests": 0,
		"freeBonusAt": 0, "racesSinceAd": 0, "rated": false, "ratePromptAt": 0, "event": {},
	}

static func data() -> Dictionary:
	if _data.is_empty():
		_data = _start()
		if FileAccess.file_exists(SAVE_PATH) and not dry:
			var v: Variant = JSON.parse_string(FileAccess.get_file_as_string(SAVE_PATH))
			if typeof(v) == TYPE_DICTIONARY:
				_data.merge(v, true)
		# a new pass season: its XP and claims start again
		if int(_data.passSeason) != _season_index():
			_data.passSeason = _season_index()
			_data.passXp = 0
			_data.passClaimed = {"free": [], "premium": []}
		_daily()
	return _data

static func save() -> void:
	if dry:
		return
	var f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if f != null:
		f.store_string(JSON.stringify(_data))

## Tests: forget what is in memory (the next data() reads the file again).
static func reset_cache() -> void:
	_data = {}

static func now() -> int:
	return int(Time.get_unix_time_from_system())

static func today() -> String:
	return Time.get_date_string_from_system(true)

# ------------------------------------------------------------------ cups ---

static func cup(id: String) -> Array:
	for c: Array in CUPS:
		if c[0] == id:
			return c
	return []

## The best trophies of each race of a cup (0..3 each).
static func cup_results(id: String) -> Array:
	var d := data()
	var c := cup(id)
	var r: Array = (d.cups.get(id, []) as Array).duplicate()
	while r.size() < (c[3] as Array).size():
		r.append(0)
	return r

static func cup_trophies(id: String) -> int:
	var n := 0
	for t: int in cup_results(id):
		n += int(t)
	return n

static func total_trophies() -> int:
	var n := 0
	for c: Array in CUPS:
		n += cup_trophies(c[0])
	return n

static func cup_open(id: String) -> bool:
	return total_trophies() >= int(cup(id)[4])

static func trophies_for(position: int, field: int) -> int:
	if position <= 0:
		return 0
	if position == 1:
		return 3
	if position <= 3:
		return 2
	return 1 if position <= mini(6, maxi(1, field)) else 0

## A cup race being driven (set when it starts, read when the results come).
static func set_event(cup_id: String, race: int) -> void:
	data().event = {"cup": cup_id, "race": race, "at": now()}
	save()

static func clear_event() -> void:
	data().event = {}
	save()

## A finished cup race: its trophies (the best kept) and credits for the new ones. {trophies, gained, credits}
static func score_event(position: int, field: int) -> Dictionary:
	var d := data()
	var ev: Dictionary = d.event
	if ev.is_empty():
		return {}
	var id: String = ev.cup
	# the week's featured race: double credits for its place, no cup to record it in
	if id == "weekly":
		var t := trophies_for(position, field)
		var cr := t * 2 * 2000
		if cr > 0:
			add_credits(cr)
		d.event = {}
		save()
		return {"trophies": t, "gained": t, "credits": cr, "cup": id, "race": 0, "weekly": true}
	var r := cup_results(id)
	var i: int = ev.race
	var got := trophies_for(position, field)
	var gained := maxi(0, got - int(r[i]))
	r[i] = maxi(int(r[i]), got)
	d.cups[id] = r
	var credits := gained * int(cup(id)[5])
	if credits > 0:
		add_credits(credits)
	d.event = {}
	save()
	return {"trophies": got, "gained": gained, "credits": credits, "cup": id, "race": i}

# ------------------------------------------------------------------ pass ---

static func _season_index() -> int:
	return int(Time.get_unix_time_from_system() / (PASS_SEASON_DAYS * 86400.0))

static func pass_season_left_s() -> int:
	return int((_season_index() + 1) * PASS_SEASON_DAYS * 86400 - Time.get_unix_time_from_system())

static func pass_tier() -> int:
	return mini(PASS_TIERS, int(data().passXp) / PASS_TIER_XP)

static func pass_into() -> int:
	return int(data().passXp) % PASS_TIER_XP if pass_tier() < PASS_TIERS else PASS_TIER_XP

static func add_pass_xp(xp: int) -> void:
	data().passXp = int(data().passXp) + xp
	save()

static func pass_claimable(tier: int, premium: bool) -> bool:
	var d := data()
	if tier > pass_tier() or (premium and not bool(d.passPremium)):
		return false
	return not (d.passClaimed["premium" if premium else "free"] as Array).has(tier)

static func pass_claimed(tier: int, premium: bool) -> bool:
	return (data().passClaimed["premium" if premium else "free"] as Array).has(tier)

## Claim a tier's reward; returns it ([kind, amount]) or [] when not claimable.
static func claim_pass(tier: int, premium: bool) -> Array:
	if not pass_claimable(tier, premium):
		return []
	var rw := pass_reward(tier, premium)
	_grant(rw)
	(data().passClaimed["premium" if premium else "free"] as Array).append(tier)
	save()
	return rw

static func pass_unclaimed() -> int:
	var n := 0
	for t in range(1, pass_tier() + 1):
		if pass_claimable(t, false):
			n += 1
		if pass_claimable(t, true):
			n += 1
	return n

# ------------------------------------------------------------- contracts ---

static func _daily() -> void:
	var d := _data
	var day := today()
	if d.winsDay != day:
		d.winsDay = day
		d.wins = 0
	if d.contractsDay == day and (d.contracts as Array).size() == 3:
		return
	d.contractsDay = day
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(day)
	var kinds := range(CONTRACTS.size())
	var picked: Array = []
	while picked.size() < 3:
		var k: int = kinds[rng.randi() % kinds.size()]
		if not picked.has(k):
			picked.append(k)
	d.contracts = []
	for k: int in picked:
		var c: Array = CONTRACTS[k]
		var n := rng.randi_range(c[2][0], c[2][1])
		d.contracts.append({"kind": c[0], "target": n, "progress": 0, "claimed": false})

static func contract_text(c: Dictionary) -> String:
	for k: Array in CONTRACTS:
		if k[0] == c.kind:
			return I18n.t(k[1], {"n": int(c.target)})
	return ""

static func contract_reward(c: Dictionary) -> Array:
	for k: Array in CONTRACTS:
		if k[0] == c.kind:
			return [k[3], k[4]]
	return [0, 0]

static func claim_contract(i: int) -> Array:
	var c: Dictionary = data().contracts[i]
	if c.claimed or int(c.progress) < int(c.target):
		return []
	c.claimed = true
	var r := contract_reward(c)
	add_credits(r[0])
	add_pass_xp(r[1])
	save()
	return r

static func contracts_ready() -> int:
	var n := 0
	for c: Dictionary in data().contracts:
		if not c.claimed and int(c.progress) >= int(c.target):
			n += 1
	return n

# ---------------------------------------------------------- after a race ---

## An offline session's outcome (the same stats the career takes: kind, position, field, start, laps, cleanLaps, km):
## the pass XP, the contracts' progress, the day's wins. Returns {passXp, contracts: [indices advanced], chest}.
static func record_session(s: Dictionary) -> Dictionary:
	var d := data()
	_daily()
	var race: bool = s.get("kind") == "race"
	var pos := int(s.get("position", 0))
	var field := int(s.get("field", 1))
	var xp := 40 + int(s.get("laps", 0)) * 15 + int(s.get("cleanLaps", 0)) * 10
	if race and pos > 0:
		xp += 60 + maxi(0, field - pos) * 12
	var advanced: Array = []
	for i in (d.contracts as Array).size():
		var c: Dictionary = d.contracts[i]
		if c.claimed or int(c.progress) >= int(c.target):
			continue
		var add := 0.0
		match c.kind:
			"finish": add = 1 if race and pos > 0 else 0
			"win": add = 1 if race and pos == 1 and field > 1 else 0
			"podium": add = 1 if race and pos > 0 and pos <= 3 and field > 1 else 0
			"clean": add = int(s.get("cleanLaps", 0))
			"km": add = floorf(float(s.get("km", 0.0)))
			"overtakes": add = maxi(0, int(s.get("start", pos)) - pos) if race and pos > 0 else 0
		if add > 0:
			c.progress = mini(int(c.target), int(c.progress) + int(add))
			advanced.append(i)
	var chest := false
	if race and pos == 1 and field > 1 and int(d.wins) < DAILY_WINS:
		d.wins = int(d.wins) + 1
		d.chests = int(d.chests) + 1
		chest = true
	d.passXp = int(d.passXp) + xp
	if race:
		d.racesSinceAd = int(d.racesSinceAd) + 1
	save()
	return {"passXp": xp, "contracts": advanced, "chest": chest}

## A daily-wins chest: credits and pass XP. [credits, xp] or [] with none to open.
static func open_chest() -> Array:
	var d := data()
	if int(d.chests) <= 0:
		return []
	d.chests = int(d.chests) - 1
	var rng := RandomNumberGenerator.new()
	rng.randomize()
	var r := [rng.randi_range(4, 12) * 500, rng.randi_range(2, 5) * 40]
	add_credits(r[0])
	d.passXp = int(d.passXp) + r[1]
	save()
	return r

# ------------------------------------------------------------------- ads ---

static func free_bonus_left_s() -> int:
	return maxi(0, int(data().freeBonusAt) + FREE_BONUS_S - now())

## The free bonus (watched an ad placeholder): credits, pass XP; the next one in FREE_BONUS_S.
static func claim_free_bonus() -> Array:
	if free_bonus_left_s() > 0:
		return []
	data().freeBonusAt = now()
	var r := [5000, 150]
	add_credits(r[0])
	data().passXp = int(data().passXp) + r[1]
	save()
	return r

static func interstitial_due() -> bool:
	return int(data().racesSinceAd) >= INTERSTITIAL_EVERY

static func interstitial_shown() -> void:
	data().racesSinceAd = 0
	save()

## The rate-us prompt: after a win, once, and not again for a week if dismissed.
static func rate_prompt_due() -> bool:
	var d := data()
	return not bool(d.rated) and now() - int(d.ratePromptAt) > 7 * 86400

static func rate_prompt_answered(rated: bool) -> void:
	data().rated = rated
	data().ratePromptAt = now()
	save()

# --------------------------------------------------------------- credits ---

static func add_credits(n: int) -> void:
	if dry:
		_data.dryCredits = int(_data.get("dryCredits", 0)) + n
		return
	var c := CareerData.load_career()
	c.coins = int(c.coins) + n
	CareerData.save_career(c)

static func credits() -> int:
	return int(CareerData.load_career().coins)

static func _grant(rw: Array) -> void:
	match rw[0]:
		"credits":
			add_credits(int(rw[1]))
		"coins":
			# store coins are the server's when signed in (only it awards them): offline / preview balance only
			if not StoreScreen.signed_in():
				StoreScreen.preview_coins += int(rw[1])
		_:
			pass

static func reward_text(rw: Array) -> String:
	match rw[0]:
		"credits":
			return I18n.t("{n} credits", {"n": StoreScreen.fmt(int(rw[1]))})
		"coins":
			return I18n.t("{n} coins", {"n": int(rw[1])})
		"paint":
			return I18n.t("Paint design #{n}", {"n": int(rw[1])})
	return ""

static func fmt_left(s: int) -> String:
	if s >= 86400:
		return "%dd %dh" % [s / 86400, (s % 86400) / 3600]
	if s >= 3600:
		return "%dh %dm" % [s / 3600, (s % 3600) / 60]
	return "%dm %ds" % [s / 60, s % 60]
