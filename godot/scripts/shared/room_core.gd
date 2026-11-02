class_name RoomCore
extends RefCounted
## Transport-agnostic room logic: lobby, briefing, loading, countdown, session, results, bots, lap timing and
## broadcasts (port of apps/server/src/room.ts). The Cloudflare server and offline play both drive this logic.
## Everything is synchronous, so each incoming message is processed atomically.

const ID_CHARS := "abcdefghijkmnpqrstuvwxyz23456789"

## AI drivers: invented names from the nationalities of a GT3 grid, each with the flag of its country.
const BOT_DRIVERS := [
	["Lukas Brenner", "DE"], ["Jonas Hartmann", "DE"], ["Felix Kramer", "DE"], ["Oliver Whitmore", "GB"],
	["Callum Fletcher", "GB"], ["Harry Ashdown", "GB"], ["Maxime Delvaux", "BE"], ["Thomas Peeters", "BE"],
	["Sem van Doorn", "NL"], ["Ruben Visser", "NL"], ["Hugo Marchand", "FR"], ["Théo Lefèvre", "FR"],
	["Matteo Ferraresi", "IT"], ["Luca Bellandi", "IT"], ["Pablo Echeverría", "ES"], ["Álvaro Montes", "ES"],
	["Niklas Eder", "AT"], ["Simon Aebischer", "CH"], ["Mads Kjeldsen", "DK"], ["Kacper Wiśniak", "PL"],
	["Tyler Brooks", "US"], ["Jack Morrison", "AU"], ["Rafael Moreira", "BR"], ["Kenta Morishita", "JP"],
]

class Player:
	extends RefCounted
	var id: String
	var nick: String
	var session: String
	var car_id = null
	var ready := false
	var joined_at := 0.0
	var waiting := false
	var bot := false
	var tyre := "medium"
	var account = null
	var country = null
	var num = null
	var conn: RoomConn = null
	var briefed := false
	var disconnected_at = null
	var slot := -1
	var last_damage_at := 0.0
	var last_packet_at := 0.0
	var bumps := 0
	var bump_window := 0.0

var env: RoomEnv
var code := ""
var created := false
var phase := "lobby"
var host_id = null
var race_id := 0
var players := {} # id -> Player
## carId -> playerId: the single source of truth for car ownership.
var car_locks := {}
var _conn_player := {} # conn id -> player id
var race = null # RaceSetup Dictionary
var briefing_until := 0.0
var tracker: RaceTracker = null
var start_at = null
var _loaded := {}
var _load_deadline = null
var finish_deadline = null
var session_minutes: int = Const.DEFAULT_SESSION_MINUTES
var race_laps: int = Const.DEFAULT_RACE_LAPS
var race_minutes := 0
var practice_minutes := 0
var _next_session := "race"
var is_public := false
var rules := Protocol.default_rules()
var rc: RaceControl = null
var _rc_sent := -1
var _last_rc_at := 0.0
var spectators := {} # conn id -> RoomConn
var _last_report := ""
var race_at = null
var _race_grid: Array = []
var conditions := {"trackId": "", "weather": "random", "time": "random", "changes": "random", "seed": 1}
var _last_standings_at := 0.0
var _scratch: Array = [CarState.new(), CarState.new(), CarState.new(), CarState.new()]

func _init(room_env: RoomEnv) -> void:
	env = room_env

# ------------------------------------------------------------ lifecycle ---

func init_room(room_code: String) -> bool:
	if created:
		return false
	code = room_code
	conditions = conditions.duplicate()
	conditions.trackId = env.track.id
	conditions.seed = _new_seed()
	created = true
	_persist()
	return true

## Restore from a persisted state Dictionary.
func restore(s: Dictionary) -> void:
	code = s.code
	created = s.created
	host_id = s.hostId
	race_id = s.raceId
	session_minutes = s.get("sessionMinutes", Const.DEFAULT_SESSION_MINUTES)
	race_minutes = s.get("raceMinutes", 0)
	practice_minutes = s.get("practiceMinutes", 0)
	race_laps = s.get("raceLaps", Const.DEFAULT_RACE_LAPS)
	is_public = bool(s.get("isPublic", false))
	rules = Protocol.default_rules()
	rules.merge(s.get("rules", {}), true)
	conditions = s.get("conditions", {"trackId": env.track.id, "weather": "random", "time": "random", "changes": "random", "seed": _new_seed()})
	for sp in s.players:
		var p := Player.new()
		p.id = sp.id
		p.nick = sp.nick
		p.session = sp.session
		p.car_id = sp.carId
		p.ready = sp.ready
		p.joined_at = sp.joinedAt
		p.waiting = sp.waiting
		p.bot = bool(sp.get("bot", false))
		p.tyre = sp.get("tyre", "medium")
		p.account = sp.get("account")
		p.country = sp.get("country")
		p.num = sp.get("num")
		p.disconnected_at = null if p.bot else env.now.call()
		players[p.id] = p
		if p.car_id != null:
			car_locks[p.car_id] = p.id
	_schedule_next()

## Re-attach a socket that survived hibernation.
func reattach(conn: RoomConn, player_id: String) -> void:
	var p: Player = players.get(player_id)
	if p == null:
		return
	p.conn = conn
	p.disconnected_at = null
	_conn_player[conn.id] = player_id

func _persist() -> void:
	var list: Array = []
	for p in players.values():
		var d := {"id": p.id, "nick": p.nick, "session": p.session, "carId": p.car_id, "ready": p.ready, "joinedAt": p.joined_at, "waiting": p.waiting, "bot": p.bot, "tyre": p.tyre}
		if p.account != null:
			d.account = p.account
		list.append(d)
	env.persist.call({
		"code": code, "created": created, "hostId": host_id, "raceId": race_id, "sessionMinutes": session_minutes,
		"raceLaps": race_laps, "raceMinutes": race_minutes, "practiceMinutes": practice_minutes, "isPublic": is_public,
		"conditions": conditions, "rules": rules, "players": list,
	})

# -------------------------------------------------------------- helpers ---

func _now() -> float:
	return env.now.call()

func _rand() -> float:
	return env.random.call()

func _rid(n: int) -> String:
	var s := ""
	for i in n:
		s += ID_CHARS[int(floorf(_rand() * ID_CHARS.length()))]
	return s

func snapshot() -> Dictionary:
	var sorted: Array = []
	for p in players.values():
		sorted.append(p)
	var order := range(sorted.size())
	order.sort_custom(func(a, b): return sorted[a].joined_at < sorted[b].joined_at or (sorted[a].joined_at == sorted[b].joined_at and a < b))
	var list: Array = []
	for i in order:
		var p: Player = sorted[i]
		list.append({
			"id": p.id, "nick": p.nick, "carId": p.car_id, "ready": p.ready, "host": p.id == host_id,
			"connected": p.conn != null or p.bot, "waiting": p.waiting, "bot": p.bot, "tyre": p.tyre,
			"briefed": p.briefed, "country": p.country, "num": p.num,
		})
	return {
		"code": code, "phase": phase, "players": list, "carLocks": car_locks.duplicate(), "raceId": race_id,
		"sessionMinutes": session_minutes, "raceLaps": race_laps, "raceMinutes": race_minutes,
		"practiceMinutes": practice_minutes, "isPublic": is_public, "spectators": spectators.size(),
		"conditions": conditions, "briefingUntil": briefing_until if phase == "briefing" else null, "rules": rules,
	}

func _tracks() -> Dictionary:
	return env.tracks if not env.tracks.is_empty() else {env.track.id: env.track}

func _send(p: Player, msg: Dictionary) -> void:
	if p != null and p.conn != null:
		p.conn.send(JSON.stringify(msg))

func _broadcast(msg: Dictionary, except: String = "") -> void:
	var s := JSON.stringify(msg)
	for p in players.values():
		if p.conn != null and p.id != except:
			p.conn.send(s)
	for c in spectators.values():
		c.send(s)

func _broadcast_room() -> void:
	_broadcast({"t": "room", "room": snapshot()})
	_report()

## Public room list entry (only when something listed changed).
func _report() -> void:
	if not env.report.is_valid():
		return
	var humans: Array = players.values().filter(func(p): return not p.bot)
	var host: Player = players.get(host_id) if host_id != null else null
	var summary = null
	if created and is_public and humans.size() > 0:
		summary = {
			"code": code, "host": host.nick if host != null else "", "trackId": conditions.trackId, "phase": phase,
			"kind": race.kind if race != null and phase != "lobby" else null, "drivers": players.size(),
			"humans": humans.size(), "spectators": spectators.size(), "maxPlayers": Const.MAX_PLAYERS,
			"sessionMinutes": session_minutes, "raceLaps": race_laps, "updatedAt": 0,
		}
	var key := JSON.stringify(summary)
	if key == _last_report:
		return
	_last_report = key
	if summary != null:
		summary.updatedAt = _now()
	env.report.call(summary)

func _error(conn: RoomConn, err_code: String, message: String, fatal: bool) -> void:
	conn.send(JSON.stringify({"t": "error", "code": err_code, "message": message, "fatal": fatal}))
	if fatal:
		conn.close(4000, err_code)

func _racers() -> Array:
	var out: Array = []
	if race == null:
		return out
	for id in race.grid:
		var p = players.get(id)
		if p != null:
			out.append(p)
	return out

# ------------------------------------------------------------- messages ---

func on_message(conn: RoomConn, data) -> void:
	if typeof(data) != TYPE_STRING:
		_on_binary(conn, data)
		return
	var msg := Protocol.parse_client_msg(data)
	if msg.is_empty():
		_error(conn, "bad_message", "Malformed message.", false)
		return
	if msg.t == "ping":
		conn.send(JSON.stringify({"t": "pong", "c": msg.c, "s": _now()}))
		return
	if msg.t == "hello":
		_on_hello(conn, msg)
		return
	var pid = _conn_player.get(conn.id)
	var p: Player = players.get(pid) if pid != null else null
	if p == null:
		if spectators.has(conn.id):
			return
		_error(conn, "bad_message", "Say hello first.", true)
		return
	_handle(p, msg)

func _on_hello(conn: RoomConn, msg: Dictionary) -> void:
	var now := _now()
	if not created:
		return _error(conn, "room_not_found", "Room not found. Check the code.", true)
	if msg.v != Const.PROTOCOL_VERSION:
		return _error(conn, "version_mismatch", "Game version mismatch. Reload the page.", true)
	if msg.get("spectate", false):
		return add_spectator(conn)

	# reconnect with a session token
	if msg.session != null and msg.session != "":
		for existing in players.values():
			if existing.session == msg.session:
				if existing.conn != null and existing.conn.id != conn.id:
					_conn_player.erase(existing.conn.id)
					existing.conn.close(4001, "replaced")
				existing.conn = conn
				existing.disconnected_at = null
				if msg.has("account"):
					existing.account = msg.account
				if msg.has("country"):
					existing.country = msg.country
				if msg.has("num"):
					existing.num = msg.num
				_conn_player[conn.id] = existing.id
				_send_welcome(existing)
				_broadcast_room()
				return

	var nick := Validation.sanitize_nickname(msg.nick)
	if not nick.ok:
		return _error(conn, "nick_invalid", nick.error, true)
	if players.size() >= Const.MAX_PLAYERS:
		return _error(conn, "room_full", "Room is full (%d players)." % Const.MAX_PLAYERS, true)
	var key := Validation.nickname_key(nick.nick)
	for o in players.values():
		if Validation.nickname_key(o.nick) == key:
			return _error(conn, "nick_taken", "That nickname is already taken in this room.", true)

	var p := Player.new()
	p.id = _rid(10)
	p.nick = nick.nick
	p.session = _rid(24)
	p.joined_at = now
	p.waiting = phase != "lobby"
	p.conn = conn
	if msg.has("account"):
		p.account = msg.account
	if msg.has("country"):
		p.country = msg.country
	if msg.has("num"):
		p.num = msg.num
	players[p.id] = p
	_conn_player[conn.id] = p.id
	if host_id == null or not players.has(host_id):
		host_id = p.id
	_persist()
	_send_welcome(p)
	_broadcast_room()

## A spectator: no car, no slot; sees the room, the session and every car.
func add_spectator(conn: RoomConn) -> void:
	if not spectators.has(conn.id) and spectators.size() >= Const.MAX_SPECTATORS:
		return _error(conn, "too_many_spectators", "Too many spectators in this room.", true)
	spectators[conn.id] = conn
	var live: bool = race != null and (phase == "loading" or phase == "countdown" or phase == "racing")
	conn.send(JSON.stringify({
		"t": "welcome", "you": "spectator:%s" % conn.id, "session": "", "room": snapshot(), "serverTime": _now(),
		"race": race if live else null, "startAt": start_at if live else null, "spectator": true,
	}))
	_broadcast_room()

func _send_welcome(p: Player) -> void:
	var in_race: bool = race != null and race.grid.has(p.id) and phase != "lobby"
	_send(p, {
		"t": "welcome", "you": p.id, "session": p.session, "room": snapshot(), "serverTime": _now(),
		"race": race if in_race else null, "startAt": start_at if in_race else null,
	})
	if in_race and rc != null and race != null:
		_send(p, {"t": "raceControl", "raceId": race.raceId, "state": rc.state})

func _handle(p: Player, msg: Dictionary) -> void:
	match msg.t:
		"selectCar":
			select_car(p, msg.carId)
		"ready":
			if phase != "lobby":
				return
			if msg.ready and p.car_id == null:
				return
			p.ready = msg.ready
			_persist()
			_broadcast_room()
		"start":
			_start(p)
		"briefed":
			if phase != "briefing":
				return
			p.briefed = true
			_broadcast_room()
			_maybe_launch()
		"loaded":
			if race != null and msg.raceId == race.raceId:
				_loaded[p.id] = true
				_maybe_begin_countdown()
		"damage":
			var now := _now()
			if now - p.last_damage_at < 400.0:
				return
			p.last_damage_at = now
			if rc != null:
				rc.set_damage(p.id, msg.zones.max())
			_broadcast({"t": "damage", "playerId": p.id, "zones": msg.zones}, p.id)
		"leave":
			remove_player(p.id)
			if p.conn != null:
				p.conn.close(1000, "left")
		"addBot":
			_add_bot(p)
		"setConditions":
			if p.id != host_id or phase != "lobby":
				return
			var c := conditions.duplicate()
			if msg.has("trackId") and _tracks().has(msg.trackId):
				c.trackId = msg.trackId
			if msg.has("weather"):
				c.weather = msg.weather
			if msg.has("time"):
				c.time = msg.time
			if msg.has("changes"):
				c.changes = msg.changes
			if msg.get("reroll", false):
				c.seed = _new_seed()
			conditions = c
			_update_bot_tyres()
			_persist()
			_broadcast_room()
		"setTyre":
			if phase != "lobby" and phase != "briefing" and not p.waiting:
				return
			p.tyre = msg.tyre
			_persist()
			_broadcast_room()
		"setRules":
			if p.id != host_id or phase != "lobby":
				return
			rules.merge(msg.rules, true)
			_persist()
			_broadcast_room()
		"setPublic":
			if p.id != host_id:
				return
			is_public = msg.isPublic
			_persist()
			_broadcast_room()
		"setRaceLaps":
			if p.id != host_id or phase != "lobby":
				return
			race_laps = msg.laps
			if msg.laps > 0:
				race_minutes = 0
			_persist()
			_broadcast_room()
		"setRaceMinutes":
			if p.id != host_id or phase != "lobby":
				return
			race_minutes = msg.minutes
			if msg.minutes > 0:
				race_laps = 0
			_persist()
			_broadcast_room()
		"setPractice":
			if p.id != host_id or phase != "lobby":
				return
			practice_minutes = msg.minutes
			_persist()
			_broadcast_room()
		"setSession":
			if p.id != host_id or phase != "lobby":
				return
			session_minutes = msg.minutes
			_persist()
			_broadcast_room()
		"pit":
			# a bot's stop is reported by the host, who simulates it
			var who: Player = p
			if msg.has("id"):
				who = players.get(msg.id) if p.id == host_id else null
			if who == null or (msg.has("id") and not who.bot):
				return
			if tracker == null or race == null or not race.slots.has(who.id):
				return
			if phase != "racing" and phase != "countdown":
				return
			var ev: Array = []
			var now2 := _now()
			if msg["in"]:
				tracker.pit_in(who.id, now2, ev)
			else:
				var exit_s = tracker.track.get("pitExitS", null)
				tracker.pit_out(who.id, exit_s if exit_s != null else 0.0, now2, ev)
			_broadcast({"t": "pit", "playerId": who.id, "in": msg["in"]})
			_handle_race_events(ev, who, now2)
			if tracker != null and tracker.all_done():
				end_race()
		"bump":
			# contact rule: the hit, for whoever simulates the car that was hit (a bot: the host)
			if race == null or not race.rules.contact or (phase != "racing" and phase != "countdown"):
				return
			var from: Player = p
			if msg.has("from"):
				from = players.get(msg["from"]) if p.id == host_id else null
			var to: Player = players.get(msg.to)
			if from == null or to == null or (msg.has("from") and not from.bot) or from.id == to.id:
				return
			if not race.slots.has(from.id) or not race.slots.has(to.id):
				return
			var now3 := _now()
			if now3 - p.bump_window >= 1000.0:
				p.bump_window = now3
				p.bumps = 0
			p.bumps += 1
			if p.bumps > 30:
				return
			var dest: Player = players.get(host_id if host_id != null else "") if to.bot else to
			if dest == null or dest.id == p.id:
				return
			_send(dest, {"t": "bump", "from": from.id, "to": to.id, "ix": msg.ix, "iy": msg.iy, "iz": msg.iz, "ty": msg.ty})
		"removeBot":
			var b: Player = players.get(msg.id)
			if p.id == host_id and phase == "lobby" and b != null and b.bot:
				remove_player(b.id)

func _new_seed() -> int:
	return int(floorf(_rand() * 0xffffffff)) & 0xFFFFFFFF

## Bots pick their tyres from the forecast: wets on a wet track, mediums otherwise.
func _update_bot_tyres() -> void:
	var plan := Weather.plan_weather(conditions.seed, conditions)
	var tyre := "wet" if plan.initialWetness > 0.35 else "medium"
	for b in players.values():
		if b.bot:
			b.tyre = tyre

## Host adds an AI driver with a random free car (respects the car locks).
func _add_bot(host: Player) -> void:
	if host.id != host_id or phase != "lobby":
		return
	if players.size() >= Const.MAX_PLAYERS:
		_send(host, {"t": "error", "code": "room_full", "message": "Room is full (%d players)." % Const.MAX_PLAYERS, "fatal": false})
		return
	var free: Array = (env.car_ids if env.car_ids != null else []).filter(func(c): return not car_locks.has(c))
	if free.is_empty():
		_send(host, {"t": "error", "code": "car_taken", "message": "No free car left for a bot.", "fatal": false})
		return
	# the car first (as it always was drawn), then the name and number
	var car_id: String = free[int(floorf(_rand() * free.size()))]
	var used := {}
	for x in players.values():
		used[x.nick] = true
	var free_names: Array = BOT_DRIVERS.filter(func(d): return not used.has(d[0]))
	var nick: String
	var country = null
	if free_names.size() > 0:
		var d: Array = free_names[int(floorf(_rand() * free_names.size()))]
		nick = d[0]
		country = d[1]
	else:
		nick = "AI %s" % _rid(3).to_upper()
	var used_nums := {}
	for x in players.values():
		used_nums[x.num] = true
	var num := 2 + int(floorf(_rand() * 97))
	while used_nums.has(num):
		num = (num % 98) + 2
	var bot := Player.new()
	bot.id = "bot%s" % _rid(7)
	bot.nick = nick
	bot.session = ""
	bot.car_id = car_id
	bot.ready = true
	bot.joined_at = _now()
	bot.bot = true
	bot.country = country
	bot.num = num
	bot.tyre = "wet" if Weather.plan_weather(conditions.seed, conditions).initialWetness > 0.35 else "medium"
	players[bot.id] = bot
	car_locks[car_id] = bot.id
	_persist()
	_broadcast_room()

## Atomic car lock: grant only when nobody else holds the car.
func select_car(p: Player, car_id) -> void:
	if phase != "lobby" and not p.waiting:
		_send(p, {"t": "carLock", "ok": false, "carId": car_id, "owner": null})
		return
	if car_id != null and env.car_ids != null and not env.car_ids.has(car_id):
		_send(p, {"t": "carLock", "ok": false, "carId": car_id, "owner": null})
		return
	if car_id != null:
		var owner = car_locks.get(car_id)
		if owner != null and owner != p.id:
			_send(p, {"t": "carLock", "ok": false, "carId": car_id, "owner": owner})
			return
	if p.car_id != null and car_locks.get(p.car_id) == p.id:
		car_locks.erase(p.car_id)
	p.car_id = car_id
	if car_id != null:
		car_locks[car_id] = p.id
	else:
		p.ready = false
	_persist()
	_send(p, {"t": "carLock", "ok": true, "carId": car_id, "owner": p.id})
	_broadcast_room()

func _start(p: Player) -> void:
	if p.id != host_id or phase != "lobby":
		_send(p, {"t": "error", "code": "not_host", "message": "Only the host can start the race.", "fatal": false})
		return
	var entrants: Array = players.values().filter(func(x): return x.conn != null or x.bot)
	if entrants.is_empty() or entrants.any(func(x): return x.car_id == null or not x.ready):
		_send(p, {"t": "error", "code": "not_ready", "message": "Everyone needs a car and must be ready.", "fatal": false})
		return
	# Briefing: the conditions are final now, everyone sees them and sets up their car.
	phase = "briefing"
	briefing_until = _now() + Const.BRIEFING_MS
	for x in players.values():
		x.briefed = x.bot
	_update_bot_tyres()
	_persist()
	_broadcast_room()
	_schedule_next()

## After the qualifying results: the race, gridded in qualifying order.
func _launch_race() -> void:
	race_at = null
	var entrants: Array = players.values().filter(func(x): return (x.conn != null or x.bot) and x.car_id != null)
	if entrants.is_empty():
		phase = "lobby"
		_broadcast_room()
		return
	if _next_session == "qualifying":
		_launch(entrants, null, "qualifying")
	else:
		_launch(entrants, _race_grid)

## End of the briefing: everyone connected is done (or the time is up).
func _maybe_launch(force: bool = false) -> void:
	if phase != "briefing":
		return
	var humans: Array = players.values().filter(func(x): return not x.bot and x.conn != null and x.car_id != null)
	if not force and humans.any(func(x): return not x.briefed):
		return
	var entrants: Array = players.values().filter(func(x): return (x.conn != null or x.bot) and x.car_id != null)
	if entrants.is_empty():
		phase = "lobby"
		_broadcast_room()
		return
	_launch(entrants, null, "practice" if practice_minutes > 0 else "qualifying")

## Load a session: practice / qualifying (random grid) or the race (grid = race_grid).
func _launch(entrants: Array, race_grid, timed: String = "qualifying") -> void:
	var now := _now()
	race_id += 1
	var seed_value := int(floorf(_rand() * 0xffffffff)) & 0xFFFFFFFF
	var rand := Prng.new(seed_value)
	var ids: Array = entrants.map(func(x): return x.id)
	var grid: Array
	if race_grid != null:
		grid = race_grid.filter(func(id): return ids.has(id))
		grid.append_array(ids.filter(func(id): return not race_grid.has(id)))
	else:
		grid = Prng.shuffle(ids, rand)
	var slots := {}
	for i in grid.size():
		slots[grid[i]] = i
		var pl: Player = players.get(grid[i])
		if pl != null:
			pl.slot = i
	for x in players.values():
		x.waiting = not grid.has(x.id)
	var cond := conditions
	var track_id: String = cond.trackId if _tracks().has(cond.trackId) else env.track.id
	var session_ms := 0 if race_grid != null else (practice_minutes if timed == "practice" else session_minutes) * 60000
	race = {
		"raceId": race_id, "seed": cond.seed, "weather": Weather.plan_weather(cond.seed, cond), "grid": grid, "slots": slots,
		"sessionMs": session_ms, "trackId": track_id, "kind": "race" if race_grid != null else timed, "laps": race_laps,
		"rules": rules.duplicate(),
	}
	if race_grid != null and race_minutes > 0:
		race.raceMs = race_minutes * 60000
	phase = "loading"
	_loaded = {}
	_load_deadline = now + Const.LOAD_TIMEOUT_MS
	start_at = null
	tracker = null
	finish_deadline = null
	_persist()
	_broadcast({"t": "raceSetup", "race": race})
	_broadcast_room()
	_schedule_next()

func _maybe_begin_countdown(force: bool = false) -> void:
	if phase != "loading" or race == null:
		return
	var waiting_for: Array = _racers().filter(func(r): return r.conn != null and not _loaded.has(r.id))
	if not force and waiting_for.size() > 0:
		return
	var now := _now()
	start_at = now + Const.COUNTDOWN_MS
	var mode: Dictionary
	if race.kind == "race":
		if race.get("raceMs", 0) > 0:
			mode = {"raceMs": race.raceMs, "pitWindow": race.rules.pitWindow}
		else:
			mode = {"raceLaps": race.laps, "pitWindow": race.rules.pitWindow}
	else:
		mode = {"sessionMs": race.sessionMs}
	tracker = RaceTracker.new(_tracks().get(race.trackId, env.track), start_at, mode)
	for id in race.grid:
		tracker.add_player(id)
	# race control: flags in qualifying, the full procedures (FCY, safety car, penalties) in the race
	rc = RaceControl.new(tracker, true) if race.rules.raceControl else null
	_rc_sent = -1
	phase = "countdown"
	_broadcast({"t": "countdown", "raceId": race.raceId, "startAt": start_at})
	_broadcast_room()
	_schedule_next()

# --------------------------------------------------------------- binary ---

func _on_binary(conn: RoomConn, buf: PackedByteArray) -> void:
	var pid = _conn_player.get(conn.id)
	var sender: Player = players.get(pid) if pid != null else null
	if sender == null or race == null or tracker == null or (phase != "countdown" and phase != "racing"):
		return
	var now := _now()
	var p: Player = sender
	var relay: PackedByteArray
	var count: int
	if buf.size() > 0 and buf[0] == CarState.BIN_BOT_STATE:
		# only the host simulates bots
		if sender.id != host_id:
			return
		var dec := CarState.decode_bot_states(buf, _scratch, now)
		if dec.is_empty():
			return
		p = null
		for x in players.values():
			if x.bot and x.slot == dec.slot:
				p = x
				break
		if p == null:
			return
		count = dec.count
		relay = CarState.bot_to_relay(buf)
	else:
		if sender.slot < 0 or not race.slots.has(sender.id):
			return
		var dec2 := CarState.decode_client_states(buf, _scratch, now)
		if dec2.is_empty():
			return
		count = dec2.count
		relay = CarState.make_relay_packet(buf, sender.slot)
	p.last_packet_at = now
	if phase == "countdown" and start_at != null and now >= start_at:
		phase = "racing"
	# race validation (server clock)
	var ev: Array = []
	for i in count:
		var s: CarState = _scratch[i]
		# future timestamps are forged; old ones are accepted for backfill after a reconnect
		if s.t > now + Const.MAX_CLOCK_SKEW_MS or s.t < now - Const.RECONNECT_GRACE_MS - 10000:
			continue
		tracker.ingest(p.id, s.t, s.px, s.py, s.pz, (s.flags & CarState.FLAG_RESET) != 0, ev, (s.flags & CarState.FLAG_OFF_TRACK) != 0, (s.flags & CarState.FLAG_HIT) != 0)
	if rc != null and now - _last_rc_at >= 200.0:
		_last_rc_at = now
		rc.update(now, ev)
		if rc.version != _rc_sent:
			_rc_sent = rc.version
			_broadcast({"t": "raceControl", "raceId": race.raceId, "state": rc.state})
	_handle_race_events(ev, p, now)
	# relay to everybody else in the race (bot states go to everyone but the simulating host)
	for o in players.values():
		if o.conn != null and o.id != p.id and o.id != sender.id and not o.waiting:
			o.conn.send(relay)
	for c in spectators.values():
		c.send(relay)
	if now - _last_standings_at >= 500.0:
		_last_standings_at = now
		_broadcast({"t": "standings", "raceId": race.raceId, "list": tracker.standings(), "finishDeadline": finish_deadline})
	if tracker.all_done():
		end_race()

## Broadcast what the lap logic decided (laps, sectors, penalties, finishes, the flag).
func _handle_race_events(ev: Array, sender: Player, now: float) -> void:
	for e in ev:
		# race control's events can be about any car, not just the one whose packet was processed
		var who: Player = players.get(sender.id if e.type == "flag" else e.playerId, sender)
		if e.type == "lap" or e.type == "penalty":
			_last_standings_at = 0.0 # the timing screen updates at once
		# a signed-in driver's valid timed lap: their records
		if e.type == "lap" and e.valid and not e.outLap and who.account != null and who.car_id != null and race != null and env.record.is_valid():
			var wet: bool = Weather.weather_at(race.weather, maxf(0.0, (now - (start_at if start_at != null else now)) / 1000.0)).wetness > 0.3
			env.record.call({
				"kind": "lap", "token": who.account, "trackId": race.trackId, "carId": who.car_id, "lapMs": e.lapMs,
				"sectors": e.sectors, "session": race.kind, "wet": wet,
			})
		if e.type == "lap":
			_broadcast({
				"t": "lap", "playerId": e.playerId, "lap": e.lap, "lapMs": e.lapMs, "penaltyMs": e.penaltyMs,
				"sectors": e.sectors, "best": e.best, "valid": e.valid, "outLap": e.outLap,
			})
		elif e.type == "penalty" and e.reason != "track-limits" and e.reason != "reset" and e.reason != "shortcut":
			# race control's decisions are public (timing screens show them)
			var m := {"t": "penalty", "playerId": e.playerId, "reason": e.reason, "ms": e.ms, "lapPenaltyMs": e.lapPenaltyMs}
			if e.has("driveThrough"):
				m.driveThrough = e.driveThrough
			_broadcast(m)
		elif e.type == "penalty" and not who.bot:
			var m2 := {"t": "penalty", "playerId": e.playerId, "reason": e.reason, "ms": e.ms, "lapPenaltyMs": e.lapPenaltyMs}
			if e.has("warning"):
				m2.warning = e.warning
			if e.has("noAdvantage"):
				m2.noAdvantage = e.noAdvantage
			_send(who, m2)
		elif e.type == "sector" and not who.bot:
			_send(who, {"t": "sector", "playerId": e.playerId, "sector": e.sector, "ms": e.ms})
		elif e.type == "served":
			_last_standings_at = 0.0
			_broadcast({"t": "served", "playerId": e.playerId, "what": e.what})
		elif e.type == "finish":
			_broadcast({"t": "finished", "playerId": e.playerId, "totalMs": e.totalMs})
			# lap-count sessions only: the others finish the lap they are on, with a minute's margin at least
			if finish_deadline == null and tracker != null and tracker.flag_at == null:
				var pl: RaceTracker.PlayerRaceState = tracker.players.get(e.playerId)
				finish_deadline = now + RaceTracker.finish_grace_ms(e.totalMs, pl.laps if pl != null else 0)
				_schedule_next()
		elif e.type == "flag" and race != null:
			_broadcast({"t": "flag", "raceId": race.raceId})
			# chequered flag: everyone may finish the lap they are on
			finish_deadline = (tracker.flag_at if tracker != null and tracker.flag_at != null else now) + Const.FLAG_GRACE_MS
			_schedule_next()

# --------------------------------------------------------- end of race ---

func end_race() -> void:
	if race == null or tracker == null:
		return
	for p in tracker.players.values():
		if p.finished_ms == null:
			tracker.mark_dnf(p.id)
	var st := tracker.standings()
	var fastest = null
	var rows: Array = []
	for s in st:
		var pl: Player = players.get(s.id)
		if s.bestLapMs != null and (fastest == null or s.bestLapMs < fastest.ms):
			fastest = {"id": s.id, "ms": s.bestLapMs}
		rows.append({
			"id": s.id, "nick": pl.nick if pl != null else "left", "carId": pl.car_id if pl != null else null,
			"position": s.position, "totalMs": s.finishedMs, "bestLapMs": s.bestLapMs, "gapMs": s.gapMs,
			"validLaps": s.validLaps, "dnf": s.dnf, "penaltyMs": s.penaltyMs,
		})
	# signed-in drivers' results (a driver who set no time in a timed session has no result)
	if env.record.is_valid():
		for s in st:
			var pl2: Player = players.get(s.id)
			if pl2 == null or pl2.account == null or pl2.car_id == null or (s.bestLapMs == null and s.finishedMs == null):
				continue
			env.record.call({
				"kind": "result", "token": pl2.account, "trackId": race.trackId, "carId": pl2.car_id, "session": race.kind,
				"position": s.position, "entrants": st.size(), "bestLapMs": s.bestLapMs, "totalMs": s.finishedMs,
			})
	# the weekend goes on: after free practice qualifying, after qualifying the race (by laps or by time)
	var race_next: bool = race.kind == "qualifying" and (race_laps > 0 or race_minutes > 0) and st.any(func(x): return not x.dnf or x.bestLapMs != null)
	var quali_next: bool = race.kind == "practice"
	_next_session = "qualifying" if quali_next else "race"
	race_at = _now() + Const.QUALI_TO_RACE_MS if race_next or quali_next else null
	_race_grid = st.map(func(x): return x.id) if race_next else []
	_broadcast({"t": "results", "raceId": race.raceId, "kind": race.kind, "rows": rows, "fastestLap": fastest, "raceAt": race_at})
	phase = "results" if race_next or quali_next else "lobby"
	race = null
	tracker = null
	rc = null
	start_at = null
	finish_deadline = null
	_load_deadline = null
	for p in players.values():
		p.ready = false
		p.waiting = false
		p.slot = -1
	_persist()
	_broadcast_room()
	_schedule_next()

# ---------------------------------------------------------- disconnects ---

func on_close(conn: RoomConn) -> void:
	if spectators.erase(conn.id):
		_broadcast_room()
		return
	var pid = _conn_player.get(conn.id)
	_conn_player.erase(conn.id)
	var p: Player = players.get(pid) if pid != null else null
	if p == null or p.conn == null or p.conn.id != conn.id:
		return
	p.conn = null
	p.disconnected_at = _now()
	_schedule_next()
	_broadcast_room()
	if phase == "loading":
		_maybe_begin_countdown()
	if phase == "briefing":
		_maybe_launch()

func remove_player(id: String) -> void:
	var p: Player = players.get(id)
	if p == null:
		return
	if p.conn != null:
		_conn_player.erase(p.conn.id)
	players.erase(id)
	if p.car_id != null and car_locks.get(p.car_id) == id:
		car_locks.erase(p.car_id)
	if tracker != null:
		tracker.mark_dnf(id)
	if host_id == id:
		# bots were simulated by the old host: they cannot continue this race
		if tracker != null:
			for b in players.values():
				if b.bot:
					tracker.mark_dnf(b.id)
		var humans: Array = players.values().filter(func(x): return not x.bot)
		var order := range(humans.size())
		order.sort_custom(func(a, b):
			var ha: bool = humans[a].conn != null
			var hb: bool = humans[b].conn != null
			if ha != hb:
				return ha
			if humans[a].joined_at != humans[b].joined_at:
				return humans[a].joined_at < humans[b].joined_at
			return a < b)
		host_id = humans[order[0]].id if order.size() > 0 else null
	if not players.values().any(func(x): return not x.bot):
		# no humans left: the room code expires (bots go with it)
		players.clear()
		created = false
		phase = "lobby"
		race = null
		tracker = null
		car_locks.clear()
	_persist()
	_broadcast_room()
	if tracker != null and tracker.all_done():
		end_race()
	if phase == "loading":
		_maybe_begin_countdown()
	if phase == "briefing":
		_maybe_launch()

## Process deadlines. Returns the next time we need a tick, or -1 for none.
func tick() -> float:
	var now := _now()
	for p in players.values().duplicate():
		if p.disconnected_at != null and now - p.disconnected_at >= Const.RECONNECT_GRACE_MS:
			remove_player(p.id)
	if phase == "briefing" and now >= briefing_until:
		_maybe_launch(true)
	if phase == "results" and race_at != null and now >= race_at:
		_launch_race()
	if phase == "loading" and _load_deadline != null and now >= _load_deadline:
		_maybe_begin_countdown(true)
	if phase == "countdown" and start_at != null and now >= start_at:
		phase = "racing"
	if tracker != null and race != null and (phase == "racing" or phase == "countdown"):
		var ev: Array = []
		tracker.check_flag(now, ev)
		var host: Player = players.get(host_id) if host_id != null else null
		if ev.size() > 0 and host != null:
			_handle_race_events(ev, host, now)
		if tracker.all_done():
			end_race()
	if finish_deadline != null and now >= finish_deadline:
		end_race()
	return _schedule_next()

func _schedule_next() -> float:
	var times: Array = []
	for p in players.values():
		if p.disconnected_at != null:
			times.append(p.disconnected_at + Const.RECONNECT_GRACE_MS)
	if phase == "briefing":
		times.append(briefing_until)
	if phase == "results" and race_at != null:
		times.append(race_at)
	if phase == "loading" and _load_deadline != null:
		times.append(_load_deadline)
	if phase == "countdown" and start_at != null:
		times.append(start_at)
	if finish_deadline != null:
		times.append(finish_deadline)
	if tracker != null and tracker.flag_at != null and not tracker.flag_shown:
		times.append(tracker.flag_at)
	if times.is_empty():
		return -1.0
	var at: float = times.min()
	env.schedule.call(at)
	return at
