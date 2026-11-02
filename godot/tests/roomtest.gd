extends SceneTree
## Room smoke test: lobby -> briefing -> loading -> countdown -> qualifying, with a client that drives the
## centreline through binary packets, and checks laps, sectors and results come out.
## godot --headless --path godot -s tests/roomtest.gd

var now := 1000000.0
var inbox: Array = []
var scheduled := -1.0
var failures := 0

func check(cond: bool, what: String) -> void:
	print(("ok   " if cond else "FAIL ") + what)
	if not cond:
		failures += 1

func _initialize() -> void:
	_run()

func _msgs(t: String) -> Array:
	return inbox.filter(func(m): return m is Dictionary and m.t == t)

func _run() -> void:
	var layouts := TrackData.list_layouts()
	var track := TrackData.load_layout(layouts[0])
	var env := RoomEnv.new()
	env.now = func(): return now
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	env.random = func(): return rng.randf()
	env.schedule = func(at): scheduled = at
	env.persist = func(_s): pass
	env.track = track
	env.tracks = {track.id: track}
	env.car_ids = CarsDb.selectable().map(func(c): return c.id)
	var room := RoomCore.new(env)
	check(room.init_room("ABCDE"), "room created")

	var conn := RoomConn.new("c1", func(d):
		if typeof(d) == TYPE_STRING:
			inbox.append(JSON.parse_string(d)))
	room.on_message(conn, JSON.stringify({"t": "hello", "v": Const.PROTOCOL_VERSION, "nick": "Max", "session": null}))
	var welcome := _msgs("welcome")
	check(welcome.size() == 1, "welcome received")
	var me: String = welcome[0].you
	check(room.host_id == me, "first player is the host")

	room.on_message(conn, JSON.stringify({"t": "selectCar", "carId": env.car_ids[0]}))
	check(_msgs("carLock").back().ok, "car locked")
	room.on_message(conn, JSON.stringify({"t": "addBot"}))
	check(room.players.size() == 2, "bot added")
	room.on_message(conn, JSON.stringify({"t": "ready", "ready": true}))
	room.on_message(conn, JSON.stringify({"t": "start"}))
	check(room.phase == "briefing", "briefing started")
	room.on_message(conn, JSON.stringify({"t": "briefed"}))
	check(room.phase == "loading", "session loading")
	var setup: Dictionary = _msgs("raceSetup").back().race
	check(setup.kind == "qualifying" and setup.grid.size() == 2, "qualifying set up for 2 cars")
	room.on_message(conn, JSON.stringify({"t": "loaded", "raceId": setup.raceId}))
	check(room.phase == "countdown", "countdown")
	var start_at: float = room.start_at
	now = start_at + 100.0
	room.tick()
	check(room.phase == "racing", "racing")

	# drive the centreline: 3 laps' worth of samples at 50 m/s, 20 Hz, 2 states per packet
	var cl: Array = track.centerline
	var n := cl.size() / 3
	var cum: Array = track.cumS
	var total: float = track.length * 2.4
	var s := 0.0
	var seq := 0
	var states: Array = [CarState.new(), CarState.new()]
	var laps_seen := 0
	var t := start_at + 100.0
	var spd := 50.0
	while s < total and room.phase == "racing":
		for k in 2:
			t += 50.0
			s += spd * 0.05
			var pt := TrackMath.point_at_distance(track, s)
			var st: CarState = states[k]
			st.t = t
			st.px = pt.x
			st.py = pt.y
			st.pz = pt.z
			st.qw = 1.0
		now = t
		var pkt := CarState.encode_client_states(seq, states, 2)
		seq += 1
		room.on_message(conn, pkt)
	var laps := _msgs("lap")
	print("laps: ", laps.map(func(l): return "%d:%.0f%s" % [l.lap, l.lapMs, "(out)" if l.outLap else ""]))
	check(laps.size() >= 2, "laps timed from binary packets (%d)" % laps.size())
	var timed: Array = laps.filter(func(l): return l.valid and not l.outLap)
	var expected_ms: float = float(track.length) / spd * 1000.0
	check(timed.size() >= 1 and absf(timed[0].lapMs - expected_ms) < 400.0, "timed lap %.0f ms is near %.0f ms" % [timed[0].lapMs if timed.size() > 0 else -1.0, expected_ms])
	check(_msgs("sector").size() >= 2, "sector times sent")
	check(_msgs("standings").size() > 0, "standings broadcast")
	print("failures: %d" % failures)
	quit(1 if failures > 0 else 0)
