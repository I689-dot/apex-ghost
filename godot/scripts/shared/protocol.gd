class_name Protocol
extends RefCounted
## Lobby types and JSON message validation (port of the JSON part of packages/shared/src/protocol.ts).
## Messages are Dictionaries with a "t" field, exactly as on the wire.

## Largest impulse a bump may carry (N*s): a 1.4 t car stopped from 30 m/s.
const MAX_BUMP_IMPULSE := 42000.0

const PHASES := ["lobby", "briefing", "loading", "countdown", "racing", "results"]
const TYRE_CHOICES := ["soft", "medium", "hard", "wet"]
const TIME_CHOICES := ["random", "dawn", "morning", "midday", "afternoon", "evening", "night"]
const CHANGE_CHOICES := ["random", "off", "on"]
const SESSION_KINDS := ["practice", "qualifying", "race"]

static func default_rules() -> Dictionary:
	return {"contact": false, "pitWindow": false, "fuel": false, "raceControl": false}

static func _str(v, max_len: int = 64) -> bool:
	return typeof(v) == TYPE_STRING and (v as String).length() <= max_len

static func _num(v) -> bool:
	return (typeof(v) == TYPE_FLOAT or typeof(v) == TYPE_INT) and is_finite(float(v))

static func _is_int(v) -> bool:
	return _num(v) and float(v) == floorf(float(v))

## Strict validation of untrusted client JSON. Returns {} for anything malformed.
static func parse_client_msg(raw: String) -> Dictionary:
	if raw.length() > 2048:
		return {}
	var v = JSON.parse_string(raw)
	if typeof(v) != TYPE_DICTIONARY or typeof(v.get("t")) != TYPE_STRING:
		return {}
	match v.t:
		"hello":
			if not (_num(v.get("v")) and _str(v.get("nick"), 64) and (v.get("session") == null or _str(v.get("session"), 64))):
				return {}
			var out := {"t": "hello", "v": v.v, "nick": v.nick, "session": v.session, "spectate": v.get("spectate") == true}
			var acc = v.get("account")
			if typeof(acc) == TYPE_STRING and RegEx.create_from_string("^[0-9a-f]{48}$").search(acc) != null:
				out.account = acc
			var country = v.get("country")
			if typeof(country) == TYPE_STRING and RegEx.create_from_string("^[A-Z]{2}$").search(country) != null:
				out.country = country
			var n = v.get("num")
			if _is_int(n) and n >= 1 and n <= 999:
				out.num = int(n)
			return out
		"selectCar":
			return {"t": "selectCar", "carId": v.get("carId")} if v.get("carId") == null or _str(v.get("carId"), 64) else {}
		"ready":
			return {"t": "ready", "ready": v.ready} if typeof(v.get("ready")) == TYPE_BOOL else {}
		"start":
			return {"t": "start"}
		"briefed":
			return {"t": "briefed"}
		"loaded":
			return {"t": "loaded", "raceId": v.raceId} if _num(v.get("raceId")) else {}
		"ping":
			return {"t": "ping", "c": v.c} if _num(v.get("c")) else {}
		"damage":
			var z = v.get("zones")
			if typeof(z) != TYPE_ARRAY or z.size() != 6:
				return {}
			for x in z:
				if not (_num(x) and x >= 0 and x <= 1):
					return {}
			return {"t": "damage", "zones": z}
		"leave":
			return {"t": "leave"}
		"addBot":
			return {"t": "addBot"}
		"removeBot":
			return {"t": "removeBot", "id": v.id} if _str(v.get("id"), 32) else {}
		"setSession":
			var m = v.get("minutes")
			return {"t": "setSession", "minutes": int(m)} if _is_int(m) and m >= 1 and m <= 60 else {}
		"setPublic":
			return {"t": "setPublic", "isPublic": v.isPublic} if typeof(v.get("isPublic")) == TYPE_BOOL else {}
		"setRaceMinutes":
			var m2 = v.get("minutes")
			return {"t": "setRaceMinutes", "minutes": int(m2)} if _num(m2) and Const.RACE_MINUTE_CHOICES.has(int(m2)) and float(m2) == floorf(m2) else {}
		"setPractice":
			var m3 = v.get("minutes")
			return {"t": "setPractice", "minutes": int(m3)} if _num(m3) and Const.PRACTICE_MINUTE_CHOICES.has(int(m3)) and float(m3) == floorf(m3) else {}
		"setRaceLaps":
			var l = v.get("laps")
			return {"t": "setRaceLaps", "laps": int(l)} if _is_int(l) and l >= 0 and l <= 50 else {}
		"pit":
			if typeof(v.get("in")) != TYPE_BOOL or (v.has("id") and not _str(v.id, 32)):
				return {}
			return {"t": "pit", "in": v["in"]} if not v.has("id") else {"t": "pit", "in": v["in"], "id": v.id}
		"bump":
			var lim := MAX_BUMP_IMPULSE
			if not _str(v.get("to"), 32):
				return {}
			for k in ["ix", "iy", "iz", "ty"]:
				if not (_num(v.get(k)) and absf(v[k]) <= lim):
					return {}
			if v.has("from") and not _str(v["from"], 32):
				return {}
			var b := {"t": "bump", "to": v.to, "ix": v.ix, "iy": v.iy, "iz": v.iz, "ty": v.ty}
			if v.has("from"):
				b["from"] = v["from"]
			return b
		"setRules":
			if typeof(v.get("rules")) != TYPE_DICTIONARY:
				return {}
			var rules := {}
			for k in default_rules():
				if not v.rules.has(k):
					continue
				if typeof(v.rules[k]) != TYPE_BOOL:
					return {}
				rules[k] = v.rules[k]
			return {"t": "setRules", "rules": rules}
		"setTyre":
			return {"t": "setTyre", "tyre": v.tyre} if TYRE_CHOICES.has(v.get("tyre")) else {}
		"setConditions":
			var c := {"t": "setConditions"}
			if v.has("trackId"):
				if not _str(v.trackId, 64):
					return {}
				c.trackId = v.trackId
			if v.has("weather"):
				if not (v.weather == "random" or Weather.KINDS.has(v.weather)):
					return {}
				c.weather = v.weather
			if v.has("time"):
				if not TIME_CHOICES.has(v.time):
					return {}
				c.time = v.time
			if v.has("changes"):
				if not CHANGE_CHOICES.has(v.changes):
					return {}
				c.changes = v.changes
			if v.get("reroll") == true:
				c.reroll = true
			return c
		_:
			return {}

static func encode_json(msg: Dictionary) -> String:
	return JSON.stringify(msg)
