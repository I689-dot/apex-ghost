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
	# DISPLAY_SET='{"eyeAdaptation": false}': display settings for the run
	if OS.get_environment("DISPLAY_SET") != "":
		Settings.data.display.merge(JSON.parse_string(OS.get_environment("DISPLAY_SET")), true)
	if OS.get_environment("QUALITY") != "":
		Settings.data.quality = OS.get_environment("QUALITY")
		Settings.data.graphics = {}
	if OS.get_environment("GFX") != "":
		# group overrides, as the settings page stores them: {"shadows": "high", "trees": "medium", ...}
		Settings.data.graphics = JSON.parse_string(OS.get_environment("GFX"))
	if OS.get_environment("NO_INTERIOR_FIX") != "":
		InteriorLook.enabled = false
	if OS.get_environment("FOV") != "":
		Settings.data.fov = float(OS.get_environment("FOV"))
	if OS.get_environment("SEAT_HEIGHT") != "":
		Settings.data.seatHeight = float(OS.get_environment("SEAT_HEIGHT"))
	if OS.get_environment("SEAT_FORWARD") != "":
		# only in memory, for the picture: the seat setting is not saved
		Settings.data.seatForward = float(OS.get_environment("SEAT_FORWARD"))
	if OS.get_environment("SUN_EL") != "":
		GameEnvironment.sun_override = {"elevation": deg_to_rad(float(OS.get_environment("SUN_EL"))), "azimuth": deg_to_rad(float(OS.get_environment("SUN_AZ")))}
	if OS.get_environment("CHASE_DIST") != "":
		ChaseCamera.tune = {"dist": float(OS.get_environment("CHASE_DIST")), "height": float(OS.get_environment("CHASE_H")), "fov": float(OS.get_environment("CHASE_FOV")),
			"ahead": float(OS.get_environment("CHASE_AHEAD")) if OS.get_environment("CHASE_AHEAD") != "" else 10.0, "yaw": float(OS.get_environment("CHASE_YAW")) if OS.get_environment("CHASE_YAW") != "" else 0.0, "look_y": float(OS.get_environment("CHASE_LOOKY")) if OS.get_environment("CHASE_LOOKY") != "" else 0.95}
	if OS.get_environment("LIGHTS") != "":
		CarVisual.test_lights = OS.get_environment("LIGHTS")
	if OS.get_environment("CAMERA") != "":
		Settings.data.camera = OS.get_environment("CAMERA")
	LocalRoom.create()
	var conn := Connection.new().setup(LocalRoom.LOCAL_CODE, "Max")
	add_child(conn)
	conn.message.connect(func(m): msgs.append(m))
	await conn.connect_to_room()
	var cars := CarsDb.selectable()
	conn.send_json({"t": "selectCar", "carId": OS.get_environment("CAR_ID") if OS.get_environment("CAR_ID") != "" else cars[0].id})
	if OS.get_environment("NO_BOTS") == "":
		# BOTS=<n>: a fuller grid (default 2)
		for i in int(OS.get_environment("BOTS")) if OS.get_environment("BOTS") != "" else 2:
			conn.send_json({"t": "addBot"})
	conn.send_json({"t": "ready", "ready": true})
	await get_tree().create_timer(0.3).timeout
	var cond := {"t": "setConditions", "weather": OS.get_environment("WEATHER") if OS.get_environment("WEATHER") != "" else "clear", "time": OS.get_environment("TIME") if OS.get_environment("TIME") != "" else "midday", "changes": "off"}
	if OS.get_environment("TRACK") != "":
		cond.trackId = OS.get_environment("TRACK")
	conn.send_json(cond)
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
	print("stand-in wheel built: ", session.cockpit._dash_wheel != null)
	if OS.get_environment("CAM_PITCH") != "":
		session.cockpit.pitch = deg_to_rad(float(OS.get_environment("CAM_PITCH")))
	if OS.get_environment("HIDE_OUTSIDE") != "" and session.my_visual._outside_root != null:
		# debugging: is the exterior model drawn inside the cockpit view?
		session.my_visual._outside_root.visible = false
	if OS.get_environment("SHOW_HUD") != "" and session.hud != null:
		# the race HUD as the app shows it (its own canvas layer over the 3D)
		var layer := CanvasLayer.new()
		layer.layer = 5
		add_child(layer)
		# the sun's flare under it, as the app adds it
		var flare := LensFlare.new()
		flare.camera_of = func(): return get_viewport().get_camera_3d()
		flare.sun_dir_of = func(): return session.env.sun_dir
		flare.strength_of = func(): return session.env.flare_strength
		layer.add_child(flare)
		layer.add_child(session.hud)
		UIKit.full(session.hud)
	if OS.get_environment("SKIP_INTRO") != "" and session.cinematic != null:
		session.cinematic.skip()
	if OS.get_environment("TELEPORT") != "":
		var pt := TrackMath.point_at_distance(session.track_data, float(OS.get_environment("TELEPORT")))
		var lat := float(OS.get_environment("LATERAL")) if OS.get_environment("LATERAL") != "" else 0.0
		session.vehicle.place(pt.x + cos(pt.yaw) * lat, pt.y + 0.5, pt.z - sin(pt.yaw) * lat, pt.yaw)
	if OS.get_environment("AUTODRIVE") != "":
		session.autodrive = AiDriver.new(session.track_data, session.vehicle, 0.95, 0.0)
	var shot_dir := OS.get_environment("SHOT_DIR")
	var elapsed := 0.0
	var next_shot := 0.0
	var rids := {"main": get_viewport().get_viewport_rid(), "mirror": session.mirror.viewport.get_viewport_rid() if session.mirror != null else RID(), "sky_lut": session.env.lut_viewport.get_viewport_rid()}
	for k in rids:
		if rids[k].is_valid():
			RenderingServer.viewport_set_measure_render_time(rids[k], true)
	if OS.get_environment("TEST_SET") != "":
		# experiment: preset values changed in memory, e.g. TEST_SET='{"treeShadows": false}' (what a setting costs)
		var over: Dictionary = JSON.parse_string(OS.get_environment("TEST_SET"))
		for k in over:
			Settings.presets()[Settings.data.quality][k] = over[k]
		Settings._cached_key = ""
	if OS.get_environment("RENDER_SCALE") != "":
		# the 3D drawn at this multiple of the window (the target's pixel count on a smaller screen): 1.333 makes a
		# 1920 x 1080 window cost a 2560 x 1440 one
		get_viewport().scaling_3d_mode = Viewport.SCALING_3D_MODE_BILINEAR
		get_viewport().scaling_3d_scale = float(OS.get_environment("RENDER_SCALE"))
	var gpu := {}
	var proc := 0.0
	var phys := 0.0
	var frames := 0
	var dts := PackedFloat32Array()
	var crashed := false
	# per measured frame, for what the slowest frames spend their time on: process, physics, render CPU, GPU (main
	# viewport), physics steps, and when
	var f_proc := PackedFloat32Array()
	var f_phys := PackedFloat32Array()
	var f_rcpu := PackedFloat32Array()
	var f_gpu := PackedFloat32Array()
	var f_steps := PackedInt32Array()
	var f_at := PackedFloat32Array()
	var f_pos := PackedVector3Array()
	var last_pf := Engine.get_physics_frames()
	while elapsed < seconds:
		await get_tree().process_frame
		elapsed += get_process_delta_time()
		if elapsed <= seconds * 0.5:
			last_pf = Engine.get_physics_frames()
		if elapsed > seconds * 0.5:
			dts.append(get_process_delta_time())
			proc += Performance.get_monitor(Performance.TIME_PROCESS)
			phys += Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS)
			var vrid := get_viewport().get_viewport_rid()
			f_proc.append(Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0)
			f_phys.append(Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0)
			f_rcpu.append(RenderingServer.viewport_get_measured_render_time_cpu(vrid) + RenderingServer.get_frame_setup_time_cpu())
			f_gpu.append(RenderingServer.viewport_get_measured_render_time_gpu(vrid))
			f_steps.append(Engine.get_physics_frames() - last_pf)
			f_at.append(elapsed)
			f_pos.append(session.vehicle.global_position)
			frames += 1
			last_pf = Engine.get_physics_frames()
			for k in rids:
				if rids[k].is_valid():
					gpu[k] = gpu.get(k, 0.0) + RenderingServer.viewport_get_measured_render_time_gpu(rids[k])
		# CRASH=<s>: a heavy front hit, then a rear one, at that time (parts torn off)
		if OS.get_environment("CRASH") != "" and elapsed >= float(OS.get_environment("CRASH")) and not crashed:
			crashed = true
			var fwd := session.vehicle.global_transform.basis.z
			session.impact_damage(session.vehicle.mass * 16.0, -fwd)
			session.impact_damage(session.vehicle.mass * 16.0, fwd)
			print("crash: detached ", session.my_visual.detached.keys(), " of ", session.my_visual.part_names())
		# BOT_REPORT: each bot's race distance and speed every 15 s (traffic, passing, nobody stuck)
		if OS.get_environment("BOT_REPORT") != "" and session.local_tracker != null and int(elapsed / 15.0) != int((elapsed - get_process_delta_time()) / 15.0):
			var row := []
			for r in session.remotes.values():
				if r.bot != null and session.local_tracker.players.has(r.id):
					row.append("%d:%.0fm/%.0fkmh%s" % [r.slot, session.local_tracker.players[r.id].race_dist, r.bot.vehicle.telemetry.speed * 3.6, "P" if r.bot.ai.pass_target != 0.0 else ""])
			print("[bots %3.0f s] " % elapsed, " ".join(row))
		if OS.get_environment("COCKPIT_DEBUG") != "" and session.cockpit != null and int(elapsed * 2.0) != int((elapsed - get_process_delta_time()) * 2.0):
			var cam: Camera3D = session.cockpit.camera
			var car: Node3D = session.my_visual
			print("[cockpit] eye in car ", car.global_transform.affine_inverse() * cam.global_position, " current ", cam.current, " car up ", car.global_transform.basis.y)
		if OS.get_environment("SHOT_ONCE") != "" and elapsed >= float(OS.get_environment("SHOT_ONCE")):
			get_viewport().get_texture().get_image().save_png("%s/%s.png" % [shot_dir, OS.get_environment("SHOT_NAME") if OS.get_environment("SHOT_NAME") != "" else "shot"])
			# the side screens' views too (triple screens)
			if session.side_screens != null:
				for e in session.side_screens.windows():
					(e[0] as Window).get_texture().get_image().save_png("%s/%s_%s.png" % [shot_dir, OS.get_environment("SHOT_NAME") if OS.get_environment("SHOT_NAME") != "" else "shot", "left" if e[2] < 0 else "right"])
			get_tree().quit()
			return
		if shot_dir != "" and elapsed >= next_shot and OS.get_environment("SHOT_ONCE") == "":
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
	print("shells: ", session.shells.cells.size() if session.shells != null else -1, " visible: ", session.shells.cells.filter(func(c): return c.node.visible).size() if session.shells != null else 0, " crowd/forest: ", session.forest != null)
	if session.shells != null:
		var c0 = session.shells.cells[0]
		print("visible cells: ", session.shells.cells.filter(func(c): return c.node.visible).size(), " cell0 ", c0.x, " ", c0.z, " cam ", session.get_viewport().get_camera_3d().global_position, " car ", session.vehicle.global_position, " vis ", session.shells.visible, " n ", session.shells._last_n)
	print("avg process ms: ", proc / maxf(1, frames) * 1000.0, " physics ms/frame: ", phys / maxf(1, frames) * 1000.0, " fps ", Engine.get_frames_per_second(), " draws ", Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME))
	for k in gpu:
		print("gpu ms ", k, ": ", gpu[k] / maxf(1, frames))
	if dts.size() > 0:
		var sorted_dts := dts.duplicate()
		sorted_dts.sort()
		var total := 0.0
		for d in dts:
			total += d
		# the 1 % low: the frame rate of the slowest 1 % of frames (their mean frame time)
		var n_low := maxi(1, dts.size() / 100)
		var low := 0.0
		for i in n_low:
			low += sorted_dts[sorted_dts.size() - 1 - i]
		print("avg fps %.1f, 1%% low %.1f, worst frame %.1f ms (%d frames)" % [dts.size() / total, n_low / low, sorted_dts[sorted_dts.size() - 1] * 1000.0, dts.size()])
		# the slowest 1 % against all frames: where the time goes (the monitors are the previous frame's for some)
		var order := range(dts.size())
		order.sort_custom(func(a, b): return dts[a] > dts[b])
		var sums := [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
		var alls := [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
		for k in dts.size():
			var row := [dts[k] * 1000.0, f_proc[k], f_phys[k], f_rcpu[k], f_gpu[k], float(f_steps[k])]
			for c in 6:
				alls[c] += row[c]
				if order.find(k) < n_low:
					sums[c] += row[c]
		var names := ["frame", "process", "physics", "render cpu", "gpu", "physics steps"]
		for c in 6:
			print("  %-14s slowest 1%%: %6.2f   all: %6.2f" % [names[c], sums[c] / n_low, alls[c] / dts.size()])
		var at := []
		for i in mini(n_low, 20):
			at.append("%.1f" % f_at[order[i]])
		print("  slowest frames at s: ", ", ".join(at))
		# TIMELINE: per half second, the frame time, GPU time, physics steps and where the car was
		if OS.get_environment("TIMELINE") != "":
			var k0 := 0
			while k0 < dts.size():
				var t_end := f_at[k0] + 0.5
				var n := 0
				var sd := 0.0
				var sg := 0.0
				var ss := 0
				var worst := 0.0
				while k0 < dts.size() and f_at[k0] < t_end:
					sd += dts[k0]
					sg += f_gpu[k0]
					ss += f_steps[k0]
					worst = maxf(worst, dts[k0] * 1000.0)
					n += 1
					k0 += 1
				print("  t %5.1f  frame %5.1f ms (worst %5.1f)  gpu %5.1f  steps %.1f  at %s" % [t_end - 0.5, sd * 1000.0 / n, worst, sg / n, float(ss) / n, f_pos[k0 - 1]])
		# what was actually drawn: the window can be smaller than asked (capped at the screen), the 3D scaled from it
		var vp := get_viewport()
		var win := DisplayServer.window_get_size()
		print("3D rendered at %d x %d (window %d x %d, 3D scale %.3f)" % [roundi(win.x * vp.scaling_3d_scale), roundi(win.y * vp.scaling_3d_scale), win.x, win.y, vp.scaling_3d_scale])
	var vp := get_viewport().get_viewport_rid()
	for pass_name in ["visible", "shadow"]:
		var t := RenderingServer.VIEWPORT_RENDER_INFO_TYPE_VISIBLE if pass_name == "visible" else RenderingServer.VIEWPORT_RENDER_INFO_TYPE_SHADOW
		print("%s pass: %d objects, %.1f M primitives, %d draw calls" % [pass_name, RenderingServer.viewport_get_render_info(vp, t, RenderingServer.VIEWPORT_RENDER_INFO_OBJECTS_IN_FRAME), RenderingServer.viewport_get_render_info(vp, t, RenderingServer.VIEWPORT_RENDER_INFO_PRIMITIVES_IN_FRAME) / 1e6, RenderingServer.viewport_get_render_info(vp, t, RenderingServer.VIEWPORT_RENDER_INFO_DRAW_CALLS_IN_FRAME)])
	if session.forest != null:
		print("forest near trees: ", session.forest.drawn())
	print("tris ", Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME), " draws ", Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME), " quality ", Settings.data.quality)
	print("speed=", session.vehicle.telemetry.speed, " pos=", session.vehicle.global_position)
	if session.wet_fx != null:
		print("wetness=", session.weather.wetness, " rain=", session.weather.rain, " puddles=", session.wet_fx.puddles.size(), " level=", session.wet_fx.level, " sprays=", session.sprays.size())
	if OS.get_environment("DUMP_MATS") != "":
		for r in session.track.road_materials:
			var m: StandardMaterial3D = r.mat
			print("road mat ", m.resource_name, " albedo ", m.albedo_color, " tex ", m.albedo_texture.resource_path if m.albedo_texture else "-", " metal ", m.metallic, " rough ", m.roughness, " spec ", m.metallic_specular, " next ", m.next_pass, " ao ", m.ao_enabled, " normal ", m.normal_enabled)
		print("env ambient ", session.env.env.ambient_light_energy, " sky contrib ", session.env.env.ambient_light_sky_contribution, " sun ", session.env.sun.light_energy, " exposure ", session.env.env.tonemap_exposure)
	session.dispose()
	get_tree().quit()
