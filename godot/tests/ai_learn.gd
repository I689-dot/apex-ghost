extends Node
## The bots learn a circuit on the game's own physics: the AI drives laps alone, and for every 25 m stretch the time
## from it to 75 m past it (the corner and its exit) is measured. Each stretch keeps the grip in its plan that gave
## its best time and tries a step further each lap (later braking, more corner speed); a slower time sends it back to
## its best with a smaller step the other way, and leaving the road or a big slide takes grip away at once. The result goes
## to data/ai_learned/<layout>.json, which every bot reads (AiDriver.learned_grip).
##   TRACK=spa LAPS=10 godot --path godot --resolution 320x180 res://tests/runner.tscn -- res://tests/ai_learn.gd

const BIN := 25.0
const STEP := 0.04
const DOWN := 0.955
## Stretches counted after each one (its exit): 3 x 25 m.
const EXIT := 3

var msgs: Array = []

func _ready() -> void:
	_run.call_deferred()

func _find(t: String) -> Array:
	return msgs.filter(func(m): return m is Dictionary and m.t == t)

func _run() -> void:
	var track_id := OS.get_environment("TRACK") if OS.get_environment("TRACK") != "" else "spa"
	var laps := int(OS.get_environment("LAPS")) if OS.get_environment("LAPS") != "" else 8
	# a faster clock lengthens the physics step and the cars stop handling like themselves: real time only
	Engine.time_scale = float(OS.get_environment("SPEED")) if OS.get_environment("SPEED") != "" else 1.0
	Engine.max_physics_steps_per_frame = 24
	LocalRoom.create()
	var conn := Connection.new().setup(LocalRoom.LOCAL_CODE, "Max")
	add_child(conn)
	conn.message.connect(func(m): msgs.append(m))
	await conn.connect_to_room()
	var cars := CarsDb.selectable()
	conn.send_json({"t": "selectCar", "carId": OS.get_environment("CAR_ID") if OS.get_environment("CAR_ID") != "" else cars[0].id})
	conn.send_json({"t": "ready", "ready": true})
	conn.send_json({"t": "setSession", "minutes": 30})
	await get_tree().create_timer(0.3).timeout
	conn.send_json({"t": "setConditions", "trackId": track_id, "weather": "clear", "time": "midday", "changes": "off"})
	conn.send_json({"t": "start"})
	await get_tree().create_timer(0.3).timeout
	conn.send_json({"t": "briefed"})
	await get_tree().create_timer(0.5).timeout
	var welcome: Dictionary = _find("welcome")[0]
	var room: Dictionary = _find("room").back().room if not _find("room").is_empty() else welcome.room
	var audio := GameAudio.new()
	add_child(audio)
	var session := RaceSession.new(_find("raceSetup").back().race, room, welcome.you, CarsDb.file(), conn, {"audio": func(): return audio, "on_countdown_text": func(t, sub = ""): pass, "on_fatal": func(m): print("FATAL: ", m)})
	add_child(session)
	await session.load_session(func(l, t, lbl): pass)
	session.start()
	var td: Dictionary = session.track_data
	var L: float = td.length
	var nb := ceili(L / BIN)
	var mult := PackedFloat32Array()
	mult.resize(nb)
	mult.fill(1.0)
	var old := FileAccess.get_file_as_string("res://data/ai_learned/%s.json" % track_id)
	if old != "" and OS.get_environment("FRESH") == "":
		var d = JSON.parse_string(old)
		if d is Dictionary and d.mult.size() == nb:
			for b in nb:
				mult[b] = float(d.mult[b])
	var ai := AiDriver.new(td, session.vehicle, 1.0, 0.0)
	ai.human = false
	session.autodrive = ai
	var line := AiDriver.racing_line_for(td)
	ai.set_learned(_per_point(td, mult))
	var v := session.vehicle
	var bin_t := PackedFloat32Array()
	var best_cost := PackedFloat32Array()
	best_cost.resize(nb)
	best_cost.fill(INF)
	var best_mult := mult.duplicate()
	var step := PackedFloat32Array()
	step.resize(nb)
	step.fill(STEP)
	var worst_err := PackedFloat32Array()
	var worst_slip := PackedFloat32Array()
	var bad := PackedByteArray()
	var hint := -1
	var prev_s := -1.0
	var lap_start := -1.0
	var lap_times: Array = []
	var done := 0
	var t := 0.0
	var reset_seen := false
	var clear := func():
		bin_t.resize(nb)
		bin_t.fill(0.0)
		worst_err.resize(nb)
		worst_err.fill(0.0)
		worst_slip.resize(nb)
		worst_slip.fill(0.0)
		bad.resize(nb)
		bad.fill(0)
	clear.call()
	while done < laps and t < 60.0 * 40.0:
		await get_tree().physics_frame
		t += get_physics_process_delta_time()
		var p := v.global_position
		hint = TrackMath.nearest_centerline_index(td, p.x, p.y, p.z, hint, 60)
		var s: float = td.cumS[hint]
		var b := clampi(int(s / BIN), 0, nb - 1)
		# how far from its line, how far past the tyres' peak, whether it left the road
		# sideways only: the centreline points are ~5 m apart along the road
		var cl: Array = td.centerline
		var nxt := (hint + 1) % (cl.size() / 3)
		var tan := Vector2(cl[nxt * 3] - cl[hint * 3], cl[nxt * 3 + 2] - cl[hint * 3 + 2]).normalized()
		var err := absf(Vector2(p.x - line.x[hint], p.z - line.z[hint]).cross(tan))
		var slip := 0.0
		for w in v.wheels:
			if w.contact:
				slip = maxf(slip, absf(w.slip_angle) / v.tire.p.alpha_peak)
		var off := 0
		for w in v.wheels:
			if w.contact and (w.surface == "grass" or w.surface == "gravel" or w.surface == "sand"):
				off += 1
		bin_t[b] += get_physics_process_delta_time()
		worst_err[b] = maxf(worst_err[b], err)
		worst_slip[b] = maxf(worst_slip[b], slip)
		if off >= 2 or (ai.reset_requested and not reset_seen):
			bad[b] = 1
		reset_seen = ai.reset_requested
		# a lap: the line crossed
		if prev_s > L - 150.0 and s < 150.0:
			if lap_start >= 0.0:
				var lt := t - lap_start
				lap_times.append(lt)
				done += 1
				var es := Array(worst_err)
				es.sort()
				var ss := Array(worst_slip)
				ss.sort()
				var nbad := 0
				for k in nb:
					nbad += bad[k]
				print("  err median %.2f p90 %.2f | slip median %.2f p90 %.2f | off-track stretches %d" % [es[nb / 2], es[nb * 9 / 10], ss[nb / 2], ss[nb * 9 / 10], nbad])
				var ups := 0
				var downs := 0
				for k in nb:
					var cost := 0.0
					for e in EXIT + 1:
						cost += bin_t[(k + e) % nb]
					var wrong := bad[k] == 1 or worst_err[k] > 2.2 or worst_slip[k] > 1.5
					if wrong:
						# off the road or sliding: less grip here and in the braking zone before, the best forgotten
						for back in 3:
							var kb := posmod(k - back, nb)
							mult[kb] = maxf(0.8, mult[kb] * (DOWN if back == 0 else 0.975))
							best_mult[kb] = mult[kb]
							best_cost[kb] = INF
						downs += 1
					elif cost < best_cost[k] - 0.004:
						# faster: keep it, and go further the same way
						best_cost[k] = cost
						best_mult[k] = mult[k]
						mult[k] = clampf(mult[k] * (1.0 + step[k]), 0.8, 1.35)
						ups += 1
					else:
						# no better: back to the best, a smaller step the other way
						step[k] = -step[k] * 0.5 if absf(step[k]) > 0.004 else STEP
						mult[k] = clampf(best_mult[k] * (1.0 + step[k]), 0.8, 1.35)
				ai.set_learned(_per_point(td, mult))
				print("lap %d: %s  (%d stretches improved, %d off or sliding; best plan mean grip x%.3f)" % [done, UIKit.fmt_lap(lt * 1000.0), ups, downs, _mean(best_mult)])
			lap_start = t
			clear.call()
		prev_s = s
	var out := {"layout": track_id, "binM": BIN, "car": v.car.id, "lapTimes": lap_times.map(func(x): return snappedf(x, 0.001)),
		"mult": Array(best_mult).map(func(x): return snappedf(x, 0.001))}
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://data/ai_learned"))
	var f := FileAccess.open(ProjectSettings.globalize_path("res://data/ai_learned/%s.json" % track_id), FileAccess.WRITE)
	f.store_string(JSON.stringify(out))
	f.close()
	print("LEARNED ", track_id, " laps ", lap_times.map(func(x): return UIKit.fmt_lap(x * 1000.0)))
	session.dispose()
	get_tree().quit()

static func _per_point(td: Dictionary, mult: PackedFloat32Array) -> PackedFloat32Array:
	var cum: Array = td.cumS
	var out := PackedFloat32Array()
	out.resize(cum.size())
	for i in cum.size():
		out[i] = mult[clampi(int(cum[i] / BIN), 0, mult.size() - 1)]
	return out

static func _mean(a: PackedFloat32Array) -> float:
	var s := 0.0
	for x in a:
		s += x
	return s / maxf(1, a.size())
