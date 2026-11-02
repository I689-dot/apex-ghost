extends Node
## Drives the AI over a stretch of a circuit with a lane offset (onto the kerbs) and reports the body tilt and bounce.
## TRACK=spa FROM=2300 TO=2800 LANE=3.2 godot --path godot res://tests/runner.tscn -- res://tests/kerb_test.gd

var msgs: Array = []

## The AI's pedals, but its own steering: pure pursuit of a line at a fixed lateral offset (onto the kerbs).
class KerbDriver extends AiDriver:
	var offset := 0.0
	var _h := -1
	func _init(track_data: Dictionary, veh: Vehicle, off: float) -> void:
		super(track_data, veh, 0.85, 0.0)
		offset = off
	func update(dt: float, race_started: bool, weather_grip: float, checkpoint_s: float = -1.0, speed_cap: float = INF) -> Controls:
		var c := super.update(dt, race_started, weather_grip, checkpoint_s, minf(speed_cap, 150.0 / 3.6))
		var p := vehicle.global_position
		_h = TrackMath.nearest_centerline_index(track, p.x, p.y, p.z, _h, 40)
		var s := TrackMath.progress_at(track, _h, p.x, p.z)
		var look := clampf(vehicle.telemetry.speed * 0.45, 6.0, 22.0)
		var q := TrackMath.point_at_distance(track, s + look)
		var tx: float = q.x + cos(q.yaw) * offset - p.x
		var tz: float = q.z - sin(q.yaw) * offset - p.z
		var fwd := -vehicle.global_transform.basis.z
		if vehicle.linear_velocity.length() > 3.0:
			fwd = vehicle.linear_velocity.normalized()
		var cross := fwd.x * tz - fwd.z * tx
		var ang := atan2(-cross, fwd.x * tx + fwd.z * tz)
		c.steer = clampf(ang * 2.2, -1.0, 1.0)
		return c

func _ready() -> void:
	_run.call_deferred()

func _find(t: String) -> Array:
	return msgs.filter(func(m): return m is Dictionary and m.t == t)

func _run() -> void:
	var track_id := OS.get_environment("TRACK") if OS.get_environment("TRACK") != "" else "spa"
	var from_s := float(OS.get_environment("FROM")) if OS.get_environment("FROM") != "" else 2300.0
	var to_s := float(OS.get_environment("TO")) if OS.get_environment("TO") != "" else 2800.0
	var lane := float(OS.get_environment("LANE")) if OS.get_environment("LANE") != "" else 0.0
	LocalRoom.create()
	var conn := Connection.new().setup(LocalRoom.LOCAL_CODE, "Max")
	add_child(conn)
	conn.message.connect(func(m): msgs.append(m))
	await conn.connect_to_room()
	var cars := CarsDb.selectable()
	conn.send_json({"t": "selectCar", "carId": OS.get_environment("CAR_ID") if OS.get_environment("CAR_ID") != "" else cars[0].id})
	conn.send_json({"t": "ready", "ready": true})
	await get_tree().create_timer(0.3).timeout
	conn.send_json({"t": "setConditions", "trackId": track_id, "weather": "clear", "time": "midday", "changes": "off"})
	conn.send_json({"t": "start"})
	await get_tree().create_timer(0.3).timeout
	conn.send_json({"t": "briefed"})
	await get_tree().create_timer(0.5).timeout
	var setups := _find("raceSetup")
	var welcome: Dictionary = _find("welcome")[0]
	var room: Dictionary = _find("room").back().room if not _find("room").is_empty() else welcome.room
	var audio := GameAudio.new()
	add_child(audio)
	var session := RaceSession.new(setups.back().race, room, welcome.you, CarsDb.file(), conn, {"audio": func(): return audio, "on_countdown_text": func(t, sub = ""): pass, "on_fatal": func(m): print("FATAL: ", m)})
	add_child(session)
	await session.load_session(func(l, t, lbl): pass)
	session.start()
	var pt := TrackMath.point_at_distance(session.track_data, from_s - 150.0)
	session.vehicle.place(pt.x, pt.y + 0.5, pt.z, pt.yaw)
	session.autodrive = KerbDriver.new(session.track_data, session.vehicle, lane)
	var v := session.vehicle
	var worst := {"tilt": 0.0, "vy": 0.0, "s": 0.0}
	var t_end := 0.0
	var log_next := 0.0
	var t := 0.0
	var seen_from := false
	var hint := -1
	while t < 120.0:
		await get_tree().physics_frame
		t += get_physics_process_delta_time()
		hint = TrackMath.nearest_centerline_index(session.track_data, v.global_position.x, v.global_position.y, v.global_position.z, hint, 60)
		var s: float = session.track_data.cumS[hint]
		if s >= from_s and s <= to_s:
			seen_from = true
			# roll: the car's side axis against the horizontal (the road's slope along the lap does not count)
			var tilt := absf(rad_to_deg(asin(clampf(v.global_transform.basis.x.y, -1, 1))))
			var vy := v.linear_velocity.y
			if tilt > worst.tilt:
				worst.tilt = tilt
				worst.s = s
			worst.vy = maxf(worst.vy, absf(vy))
			var lat := (v.global_position - Vector3(session.track_data.centerline[hint * 3], 0, session.track_data.centerline[hint * 3 + 2]))
			if t >= log_next:
				log_next = t + 0.25
				var yaw0: float = TrackMath.point_at_distance(session.track_data, s).yaw
				print("s=%.0f v=%.0f km/h lat=%+.1f roll=%.1f vy=%.2f y=%.3f" % [s, v.linear_velocity.length() * 3.6, lat.x * cos(yaw0) - lat.z * sin(yaw0), tilt, vy, v.global_position.y])
		elif seen_from and s > to_s:
			break
	print("WORST roll=%.1f deg at s=%.0f, max |vy|=%.2f m/s (lane %.1f)" % [worst.tilt, worst.s, worst.vy, lane])
	session.dispose()
	get_tree().quit()
