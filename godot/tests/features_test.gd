extends Node
## The iRacing-guide features inside a real offline session: in-car adjustments, the delta key, text chat and the replay
## (recording, playback, closing). A few seconds of qualifying with the bots driving.
## godot --path godot res://tests/runner.tscn --resolution 640x360 -- res://tests/features_test.gd [seconds]

var msgs: Array = []
var failures := 0

func check(cond: bool, what: String) -> void:
	print(("ok   " if cond else "FAIL ") + what)
	if not cond:
		failures += 1

func _ready() -> void:
	_run.call_deferred()

func _find(t: String) -> Array:
	return msgs.filter(func(m): return m is Dictionary and m.t == t)

func _run() -> void:
	var args := OS.get_cmdline_user_args()
	var seconds := float(args[1]) if args.size() > 1 else 10.0
	Settings.data.quality = "low"
	Settings.data.graphics = {}
	var saved_settings: Dictionary = Settings.data.duplicate(true)
	LocalRoom.create()
	var conn := Connection.new().setup(LocalRoom.LOCAL_CODE, "Max")
	add_child(conn)
	conn.message.connect(func(m): msgs.append(m))
	await conn.connect_to_room()
	conn.send_json({"t": "selectCar", "carId": CarsDb.selectable()[0].id})
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
		print("FAIL no raceSetup")
		get_tree().quit(1)
		return
	var welcome: Dictionary = _find("welcome")[0]
	var room: Dictionary = _find("room").back().room if not _find("room").is_empty() else welcome.room
	var audio := GameAudio.new()
	add_child(audio)
	var session := RaceSession.new(setups.back().race, room, welcome.you, CarsDb.file(), conn, {
		"audio": func(): return audio,
		"on_countdown_text": func(_t, _sub = ""): pass,
		"on_fatal": func(m): print("FATAL: ", m),
		"on_replay_toggle": func(open): print("replay toggle ", open),
	})
	add_child(session)
	await session.load_session(func(_l, _t, _lbl): pass)
	var layer := CanvasLayer.new()
	add_child(layer)
	layer.add_child(session.hud)
	UIKit.full(session.hud)
	session.start()
	session.autodrive = AiDriver.new(session.track_data, session.vehicle, 0.95, 0.0)

	# ---- in-car adjustments
	var bias0: float = session.vehicle.specs.brakeBiasFront
	session.adjust_brake_bias(1)
	check(absf(float(session.vehicle.specs.brakeBiasFront) - (bias0 + 0.005)) < 0.0001, "brake bias moves 0.5 %% forward (%.3f -> %.3f)" % [bias0, session.vehicle.specs.brakeBiasFront])
	for _i in 40:
		session.adjust_brake_bias(1)
	check(float(session.vehicle.specs.brakeBiasFront) <= 0.66 + 0.0001, "brake bias stops at 66 %% (%.3f)" % session.vehicle.specs.brakeBiasFront)
	for _i in 40:
		session.adjust_brake_bias(-1)
	check(float(session.vehicle.specs.brakeBiasFront) >= 0.54 - 0.0001, "and at 54 %% (%.3f)" % session.vehicle.specs.brakeBiasFront)
	var tc0 := int(session.vehicle.assists.tc)
	session.cycle_traction_control()
	check(int(session.vehicle.assists.tc) == (tc0 + 1) % 3 and int(Settings.data.assists.tc) == (tc0 + 1) % 3, "TC cycles and is kept in the settings")
	session.cycle_traction_control()
	session.cycle_traction_control()
	check(int(session.vehicle.assists.tc) == tc0, "three presses are a full cycle")
	var abs0: bool = session.vehicle.assists.abs
	session.toggle_abs()
	check(session.vehicle.assists.abs == not abs0, "ABS toggles")
	session.toggle_abs()
	session.cycle_delta_mode()
	check(Settings.data.deltaMode == "best", "the delta key stays on 'best' while there is no optimal lap yet")

	# ---- text chat (a local room)
	check(session.chat != null, "the chat panel exists in a local room")
	session.chat.open()
	session.chat_open = true
	check(session.chat.is_open, "chat opens")
	conn.send_json({"t": "chat", "text": "hello from the test"})
	await get_tree().create_timer(0.9).timeout
	conn.send_json({"t": "chat", "text": "/rc a message for the host"})

	# ---- drive for a while: the replay records
	# the replay records from just before the green light: wait for the start, then drive
	while session.start_at == null or conn.server_now() < session.start_at:
		await get_tree().process_frame
	var elapsed := 0.0
	while elapsed < seconds:
		await get_tree().process_frame
		elapsed += get_process_delta_time()
	session.chat.close()
	check(not session.chat_open, "chat closed")
	check(_find("chat").size() >= 1 and _find("chat")[0].text == "hello from the test", "the chat line came back from the room")
	check(_find("chat").size() == 2 and _find("chat")[1].rc, "the /rc line too, marked for the host")
	check(session.chat.get_child_count() == 3, "both are in the panel (%d children: the input and two lines)" % session.chat.get_child_count())
	print("replay samples: ", session.replay.size(), " cars: ", session.replay.ids.size(), " duration ", session.replay.duration_ms() / 1000.0, " s")
	check(session.replay.size() >= int(seconds * 8.0), "the replay recorded 20 Hz samples (%d in %.0f s)" % [session.replay.size(), seconds])
	check(session.replay.ids.size() == 3, "all three cars are recorded")

	# ---- replay playback
	var my_xf: Transform3D = session.my_visual.transform
	session.open_replay()
	check(session.replay_open and session.hud.visible == false, "the replay opens and hides the HUD")
	session.replay_playing = false
	await get_tree().process_frame
	await get_tree().process_frame
	var p0: Dictionary = session.replay.pose(session.replay_t, 0)
	check(session.my_visual.global_position.distance_to(p0.pos) < 0.01, "my car is drawn where the replay has it")
	var t_before: float = session.replay_t
	session.replay_set_speed(0.25)
	for _i in 4:
		await get_tree().process_frame
	check(session.replay_t > t_before, "slow motion advances (%.0f -> %.0f ms)" % [t_before, session.replay_t])
	session.replay_toggle_play()
	var paused_t: float = session.replay_t
	await get_tree().process_frame
	check(session.replay_t == paused_t, "pause holds the time")
	session.replay_step(-1)
	check(absf(session.replay_t - (paused_t - 50.0)) < 0.01 or session.replay_t == session.replay.first_ms(), "one frame back")
	session.replay_jump(-10000.0)
	check(session.replay_t >= session.replay.first_ms(), "a jump back stays inside the recording")
	session.replay_change_car(1)
	check(session.replay_car == 1 and session.replay_car_name() != "", "next car: %s" % session.replay_car_name())
	for _m in 3:
		session.replay_change_camera()
		await get_tree().process_frame
		await get_tree().process_frame
		check(session.get_viewport().get_camera_3d() != null, "camera '%s' is current" % session.replay_camera_name())
	session.replay_set_speed(-1.0)
	for _i in 5:
		await get_tree().process_frame
	check(session.replay_t >= session.replay.first_ms(), "rewinding is clamped to the start")
	session.close_replay()
	await get_tree().process_frame
	check(not session.replay_open and session.hud.visible, "the replay closes and the HUD returns")
	check(session.my_visual.transform.is_equal_approx(my_xf), "my car's visual is back where the live car has it")
	var n_before: int = session.replay.size()
	await get_tree().create_timer(1.0).timeout
	check(session.replay.size() > n_before, "recording goes on after the replay")

	Settings.data = saved_settings
	Settings.save()
	session.dispose()
	print("failures: %d" % failures)
	get_tree().quit(1 if failures > 0 else 0)
