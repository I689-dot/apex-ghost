class_name Championship
extends RefCounted
## A solo championship (port of championship.ts): rounds on different circuits against the same AI drivers,
## qualifying then a race each, points for the top ten as in F1 (25-18-15-12-10-8-6-4-2-1, one for the fastest lap
## in the top ten). Kept on this device between rounds. A championship is a Dictionary
## {rounds, done, raceLaps, qualiMinutes, bots, drivers: {nick: ChampDriver}, lastScored}.

const CHAMP_POINTS := [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]
const SAVE_PATH := "user://championship.json"

static func load_saved() -> Variant:
	if not FileAccess.file_exists(SAVE_PATH):
		return null
	var v = JSON.parse_string(FileAccess.get_file_as_string(SAVE_PATH))
	return v if typeof(v) == TYPE_DICTIONARY else null

## Save, or delete the saved championship with null.
static func save(c) -> void:
	if c == null:
		if FileAccess.file_exists(SAVE_PATH):
			DirAccess.remove_absolute(ProjectSettings.globalize_path(SAVE_PATH))
		return
	var f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if f != null:
		f.store_string(JSON.stringify(c))

static func create(rounds: Array, race_laps: int, quali_minutes: int, bots: int) -> Dictionary:
	return {"rounds": rounds, "done": 0, "raceLaps": race_laps, "qualiMinutes": quali_minutes, "bots": bots, "drivers": {}, "lastScored": ""}

## Scores a race: order = classification [{nick, carId, classified}], fastest = the fastest lap's nick (or null).
static func score_race(c: Dictionary, race_key: String, order: Array, fastest) -> void:
	if c.lastScored == race_key:
		return
	c.lastScored = race_key
	var round_i: int = c.done
	for i in order.size():
		var r: Dictionary = order[i]
		if not c.drivers.has(r.nick):
			c.drivers[r.nick] = {"nick": r.nick, "carId": r.carId, "points": 0, "wins": 0, "podiums": 0, "results": []}
		var d: Dictionary = c.drivers[r.nick]
		if r.carId != null:
			d.carId = r.carId
		var pos: int = i + 1 if r.classified else 0
		while d.results.size() <= round_i:
			d.results.append(null)
		d.results[round_i] = pos
		if pos > 0 and pos <= CHAMP_POINTS.size():
			d.points += CHAMP_POINTS[pos - 1]
		if pos == 1:
			d.wins += 1
		if pos > 0 and pos <= 3:
			d.podiums += 1
		if fastest != null and r.nick == fastest and pos > 0 and pos <= 10:
			d.points += 1
	c.done += 1

## The table: points, then wins, then best results (count-back), as the FIA ties are broken.
static func standings(c: Dictionary) -> Array:
	var list: Array = c.drivers.values()
	list.sort_custom(func(a, b):
		if a.points != b.points:
			return a.points > b.points
		if a.wins != b.wins:
			return a.wins > b.wins
		if a.podiums != b.podiums:
			return a.podiums > b.podiums
		return a.nick.naturalnocasecmp_to(b.nick) < 0)
	return list
