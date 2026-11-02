extends Node
## End-to-end offline race: local room (RoomCore) with a bot, the full RaceSession (world, my car, bots, HUD, audio),
## a few seconds of qualifying driven by the AI. Prints what happened; SHOT_DIR=... saves screenshots.
## godot --path godot res://tests/runner.tscn --resolution 1280x720 -- res://tests/session_test.gd [seconds] [kind]

var msgs: Array = []

func _ready() -> void:
	_run.call_deferred()

func _find(t: String) -> Array:
	return msgs.filter(func(m): return m is Dictionary and m.t == t)

func _run() -> void:
	var args := OS.get_cmdline_user_args()
	var seconds := float(args[1]) if args.size() > 1 else 8.0
	if OS.get_environment("LINE") != "":
		Settings.data.racingLine = OS.get_environment("LINE")
	LocalRoom.create()
	var conn := Connection.new().setup(LocalRoom.LOCAL_CODE, "Max")
	add_child(conn)
	conn.message.connect(func(m): msgs.append(m))
	await conn.connect_to_room()
	var cars := CarsDb.selectable()
	conn.send_json({"t": "selectCar", "carId": OS.get_environment("CAR_ID") if OS.get_environment("CAR_ID") != "" else cars[0].id})
	conn.send_json({"t": "addBot"})
	conn.send_json({"t": "addBot"})
	conn.send_json({"t": "ready", "ready": true})
	await get_tree().create_timer(0.3).timeout
	conn.send_json({"t": "start"})
	await get_tree().create_timer(0.3).timeout
	conn.send_json({"t": "briefed"})
	await get_tree().create_timer(0.5).timeout
	var setups := _find("raceSetup")
	if setups.is_empty():
		print("FAIL no raceSetup; msgs: ", msgs.map(func(m): return m.t if m is Dictionary else "bin"))
		get_tree().quit(1)
		return
	var welcome: Dictionary = _find("welcome")[0]
	var room: Dictionary = _find("room").back().room if not _find("room").is_empty() else welcome.room
	var audio := GameAudio.new()
	add_child(audio)
	var cars_file: Dictionary = CarsDb.file()
	var session := RaceSession.new(setups.back().race, room, welcome.you, cars_file, conn, {
		"audio": func(): return audio,
		"on_countdown_text": func(t, sub = ""): print("countdown: ", t),
		"on_fatal": func(m): print("FATAL: ", m),
	})
	add_child(session)
	var t0 := Time.get_ticks_msec()
	await session.load_session(func(l, t, lbl): print("load ", lbl))
	print("loaded in ", (Time.get_ticks_msec() - t0) / 1000.0, " s")
	session.start()
	var shot_dir := OS.get_environment("SHOT_DIR")
	var elapsed := 0.0
	var next_shot := 0.0
	while elapsed < seconds:
		await get_tree().process_frame
		elapsed += get_process_delta_time()
		if shot_dir != "" and elapsed >= next_shot:
			next_shot += 2.0
			get_viewport().get_texture().get_image().save_png("%s/session_%02d.png" % [shot_dir, int(elapsed)])
	print("phase msgs: ", msgs.filter(func(m): return m is Dictionary).map(func(m): return m.t).slice(-12))
	if session.dash != null:
		print("dash screens: ", session.dash.count())
	for n in CarVisual._walk(session.my_visual):
		if n is MeshInstance3D and n.mesh != null:
			for i in n.mesh.get_surface_count():
				var m = n.mesh.surface_get_material(i)
				if m != null and ("isp" in m.resource_name or "creen" in m.resource_name):
					print("mat: ", m.resource_name, " on ", n.name, " visible=", n.is_visible_in_tree())
	print("speed=", session.vehicle.telemetry.speed, " pos=", session.vehicle.global_position)
	session.dispose()
	get_tree().quit()
