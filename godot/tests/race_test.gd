extends Node
## A whole offline race weekend with a full grid: one minute of qualifying, then the race over RACE_LAPS laps, every car
## driven by the AI (yours too), in the real RaceSession as the app runs it. Checks the race's results: everyone is
## classified, the order follows the distance, the laps are there; prints the standings and the frame rate.
##   godot --path godot --disable-vsync --resolution 1280x720 res://tests/runner.tscn -- res://tests/race_test.gd
## TRACK (spa), BOTS (11: as many as there are free cars), RACE_LAPS (2), QUALITY (medium), CAR_ID.

var msgs: Array = []
var failures := 0

func check(cond: bool, what: String) -> void:
	print(("ok   " if cond else "FAIL ") + what)
	if not cond:
		failures += 1

func _env(k: String, d: String) -> String:
	return OS.get_environment(k) if OS.get_environment(k) != "" else d

func _ready() -> void:
	_run.call_deferred()

func _setups() -> Array:
	return msgs.filter(func(m): return m is Dictionary and m.t == "raceSetup")

func _results() -> Array:
	return msgs.filter(func(m): return m is Dictionary and m.t == "results")

func _run() -> void:
	Settings.data.quality = _env("QUALITY", "medium")
	Settings.data.camera = "chase"
	LocalRoom.create()
	var conn := Connection.new().setup(LocalRoom.LOCAL_CODE, "Max")
	add_child(conn)
	conn.message.connect(func(m): msgs.append(m))
	await conn.connect_to_room()
	var bots := int(_env("BOTS", "11"))
	var laps := int(_env("RACE_LAPS", "2"))
	conn.send_json({"t": "selectCar", "carId": _env("CAR_ID", "bmw_m4_gt3_vecarz")})
	for i in bots:
		conn.send_json({"t": "addBot"})
	conn.send_json({"t": "setSession", "minutes": 1})
	conn.send_json({"t": "setRaceLaps", "laps": laps})
	# RULES='{"pitWindow": true, "contact": true}': the room's rules (a mandatory stop, car contact...)
	if OS.get_environment("RULES") != "":
		conn.send_json({"t": "setRules", "rules": JSON.parse_string(OS.get_environment("RULES"))})
	conn.send_json({"t": "ready", "ready": true})
	await get_tree().create_timer(0.3).timeout
	conn.send_json({"t": "setConditions", "trackId": _env("TRACK", "spa"), "weather": "clear", "time": "midday", "changes": "off"})
	conn.send_json({"t": "start"})
	await get_tree().create_timer(0.3).timeout
	conn.send_json({"t": "briefed"})
	var audio := GameAudio.new()
	add_child(audio)
	var errors_before := 0
	var race_results: Dictionary = {}
	var t_start := Time.get_ticks_msec()
	# qualifying, then the race: each session as the app runs it, a new RaceSession per setup
	for kind in ["qualifying", "race"]:
		var want := 1 if kind == "qualifying" else 2
		while _setups().size() < want:
			await get_tree().create_timer(0.25).timeout
			if (Time.get_ticks_msec() - t_start) > 900000:
				check(false, "the %s was set up (15 min)" % kind)
				get_tree().quit(1)
				return
		var setup: Dictionary = _setups().back()
		check(setup.race.kind == kind, "the %s is set up (%s)" % [kind, setup.race.kind])
		var welcome: Dictionary = msgs.filter(func(m): return m is Dictionary and m.t == "welcome")[0]
		var rooms := msgs.filter(func(m): return m is Dictionary and m.t == "room")
		var room: Dictionary = rooms.back().room if not rooms.is_empty() else welcome.room
		var session := RaceSession.new(setup.race, room, welcome.you, CarsDb.file(), conn, {
			"audio": func(): return audio,
			"on_countdown_text": func(_t, _sub = ""): pass,
			"on_fatal": func(m): print("FATAL: ", m),
		})
		add_child(session)
		await session.load_session(func(_l, _t, _lbl): pass)
		session.start()
		if session.cinematic != null:
			session.cinematic.skip()
		session.autodrive = AiDriver.new(session.track_data, session.vehicle, 0.95, 0.0)
		var gw := session.get_node_or_null("garage-wall")
		if kind == "race":
			check(gw != null and gw.get_child_count() > 20, "the garage fronts are solid (%d wall pieces)" % (gw.get_child_count() if gw != null else 0))
		var n_results := _results().size()
		var frames := 0
		var t0 := Time.get_ticks_msec()
		var last_report := 0
		while _results().size() == n_results:
			await get_tree().process_frame
			frames += 1
			var t := Time.get_ticks_msec() - t0
			if t - last_report > 30000:
				last_report = t
				var tr = session.local_tracker
				var row := []
				if tr != null:
					for id in tr.players:
						row.append("%.0f" % tr.players[id].race_dist)
				print("  [%s %3d s] %d fps, distances: %s" % [kind, t / 1000, Engine.get_frames_per_second(), " ".join(row)])
			if t > 900000:
				check(false, "the %s ended (15 min)" % kind)
				get_tree().quit(1)
				return
		var res: Dictionary = _results().back()
		var secs := (Time.get_ticks_msec() - t0) / 1000.0
		print("%s over in %.0f s, %.1f fps average" % [kind, secs, frames / secs])
		check(res.kind == kind, "%s results arrived" % kind)
		# a room gives each car to one driver: the grid is as many cars as the line-up has, at most
		var grid: int = (setup.race.grid as Array).size()
		check((res.rows as Array).size() == grid, "%s: every car classified (%d of %d on the grid)" % [kind, (res.rows as Array).size(), grid])
		if kind == "race":
			race_results = res
		session.queue_free()
		await get_tree().process_frame
	# the race's classification
	var rows: Array = race_results.get("rows", [])
	var finished := rows.filter(func(r): return r.get("totalMs") != null)
	print("race classification:")
	for r in rows:
		print("  P%s %-22s %-34s total %s  best %s  valid laps %s  penalty %s%s" % [r.get("position"), str(r.get("nick", r.get("id"))).substr(0, 22), str(r.get("carId")), r.get("totalMs"), r.get("bestLapMs"), r.get("validLaps"), r.get("penaltyMs"), "  DNF" if r.get("dnf", false) else ""])
	check(finished.size() >= rows.size() - 1, "the race: all but at most one car finished (%d of %d)" % [finished.size(), rows.size()])
	var positions: Array = rows.map(func(r): return int(r.get("position", 0)))
	var ordered := true
	for i in positions.size():
		ordered = ordered and positions[i] == i + 1
	check(ordered, "the race: positions 1..%d in order" % rows.size())
	# the classification counts time penalties (race control's, for incidents with car contact on)
	var totals: Array = finished.map(func(r): return float(r.totalMs) + float(r.get("penaltyMs", 0) if r.get("penaltyMs") != null else 0))
	var by_time := true
	for i in range(1, totals.size()):
		by_time = by_time and totals[i] >= totals[i - 1]
	check(by_time, "the race: the finishers in order of their race time")
	check(rows.all(func(r): return r.get("dnf", false) or int(r.get("validLaps", 0)) <= laps), "the race: no finisher has more than %d valid laps" % laps)
	print("%d failures" % failures)
	get_tree().quit(1 if failures > 0 else 0)
