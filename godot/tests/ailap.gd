extends SceneTree
## Bot AI check (port of tools/sim/ailap.ts, trimmed): one lap of a real track from the grid with the real Vehicle
## and AiDriver. godot --headless --path godot --fixed-fps 120 -s tests/ailap.gd -- <layoutIndex> <skill> [carId]

var HZ := int(OS.get_environment("HZ")) if OS.get_environment("HZ") != "" else 120
var DT := 1.0 / HZ

func _initialize() -> void:
	Engine.physics_ticks_per_second = HZ
	_run.call_deferred()

func _fmt(ms: float) -> String:
	var m := int(ms / 60000.0)
	return "%d:%06.3f" % [m, (ms - m * 60000.0) / 1000.0]

func _run() -> void:
	var args := OS.get_cmdline_user_args()
	var layouts := TrackData.list_layouts()
	var layout: Dictionary = layouts[int(args[0]) if args.size() > 0 else 0]
	var skill := float(args[1]) if args.size() > 1 else 0.97
	var car_id: String = args[2] if args.size() > 2 else "2024_porsche_992_gt3_r"
	var track := TrackData.load_layout(layout)
	var car := CarsDb.by_id(car_id)
	print("▶ AI lap: %s on %s" % [car.name, track.name])
	var holder := Node3D.new()
	root.add_child(holder)
	TrackCollision.build(holder, track)
	var gq := GroundQuery.new(root.world_3d)
	await physics_frame
	gq.patches = RoadPatches.build(track, gq.height_below)
	var t0 := Time.get_ticks_msec()
	var line := AiDriver.racing_line_for(track)
	print("  racing line built in %d ms" % (Time.get_ticks_msec() - t0))
	var ideal := AiDriver.profile_lap_time(line, AiDriver.speed_profile(line, AiDriver.car_limits(car.specs, 1.0, 1.225), 1.0, true))
	print("  quasi-steady-state lap on the racing line: %s" % _fmt(ideal * 1000.0))
	var v := Vehicle.new()
	v.auto_step = false
	v.setup_car(car, gq, AiDriver.BOT_ASSISTS.duplicate(), DamageState.new())
	holder.add_child(v)
	await physics_frame
	var g: Dictionary = track.grid[0]
	v.place(g.p[0], g.p[1], g.p[2], g.yaw)
	v.set_air(20.0, 32.0, 1.225)
	v.fit_tyres(Tyres.COMPOUNDS.medium, 32.0)
	v.wetness = 0.0
	v.weather_grip = Tyres.compound_grip(v.compound, 0.0, 0.0)
	var tr := RaceTracker.new(track, 0.0, 1)
	tr.add_player("ai")
	var ai := AiDriver.new(track, v, skill, 0.0)
	var t := 0.0
	var resets := 0
	var lap_ms := -1.0
	var max_v := 0.0
	var steps := int(maxf(120.0, track.length / 40.0) * 2.0 * HZ)
	for i in steps:
		var pr: RaceTracker.PlayerRaceState = tr.players["ai"]
		var cp := -1.0
		if pr.passed >= 0:
			var gates: Array = track.gates
			cp = gates[posmod(pr.next_gate - 1 + gates.size(), gates.size())].s
		var c := ai.update(DT, true, v.weather_grip * v.tyre_grip_avg(), cp)
		if ai.reset_requested:
			resets += 1
			ai.reset_requested = false
			var p := v.global_position
			tr.ingest("ai", t * 1000.0 + 1.0, p.x, p.y, p.z, true)
		v.step(DT, c)
		await physics_frame
		t += DT
		max_v = maxf(max_v, v.telemetry.speed)
		if i % (HZ / 20) == 0:
			var p2 := v.global_position
			var ev := tr.ingest("ai", t * 1000.0, p2.x, p2.y, p2.z, false)
			for e in ev:
				if e.type == "lap":
					print("  lap %d: %s%s" % [e.lap, _fmt(e.lapMs), " (out)" if e.outLap else ""])
					lap_ms = e.lapMs
		if pr.finished_ms != null:
			break
		if i % (HZ * 20) == 0:
			print("    t=%3.0f s  lap distance %5.0f m  %3.0f km/h" % [t, tr.players["ai"].race_dist, v.telemetry.speed * 3.6])
	print("skill %.2f: lap %s, resets %d, top %.0f km/h, finished=%s" % [skill, _fmt(lap_ms) if lap_ms > 0 else "—", resets, max_v * 3.6, str(tr.players["ai"].finished_ms != null)])
	quit()
