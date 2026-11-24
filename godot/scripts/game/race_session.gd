class_name RaceSession
extends SessionWorld
## One race: loads everything for it, runs physics / render / network until the results arrive (port of
## game/session.ts RaceSession). The top layer of the session: its state and helpers are in SessionBase (session_base.gd).

# Fields only this layer uses (the shared state is in SessionBase).
## The H-pattern lever's last gear (DeviceBindings), -99 none.
var _h_gear := -99
var _ui_acc := 0.0

# ------------------------------------------------------------ loading ---

## progress: Callable(loaded: float, total: float, label: String). Async: await it.
func load_session(progress: Callable) -> void:
	progress.call(0.0, 1.0, I18n.t("Starting physics"))
	CarVisual.car_lod_scale = float(Settings.quality_config().carLodScale)
	track_data = Assets.load_track_file(race.trackId)
	var entries := {}
	for c: Dictionary in cars_file.cars:
		entries[c.id] = c
	var racers: Array = race.grid.map(func(id: String) -> Dictionary: return {"id": id, "player": _player(id)})
	# a car the app no longer has (a web player's pick in a shared room): the closest one it has (CarsDb.FALLBACK)
	for r: Dictionary in racers:
		var pl: Variant = r.player
		if pl != null and pl.carId != null and not entries.has(pl.carId):
			var alt := CarsDb.resolve(str(pl.carId))
			if not alt.is_empty():
				entries[pl.carId] = alt
	var my_car_id: Variant = null
	if spectator:
		for r: Dictionary in racers:
			var pl: Variant = r.player
			if pl != null and pl.carId != null and entries.has(pl.carId):
				my_car_id = pl.carId
				break
		if my_car_id == null:
			my_car_id = cars_file.cars[0].id
	else:
		var mp: Variant = _player(me)
		my_car_id = mp.carId if mp != null else null
	if my_car_id == null or not entries.has(my_car_id):
		push_error("Your car is not available.")
		cb.get("on_fatal", Callable()).call(I18n.t("Your car is not available."))
		return
	var my_entry: Dictionary = entries[my_car_id]
	var q := Settings.quality_config()
	# the racing line is optimised in a thread meanwhile
	var line_task := RacingLinePrep.start(track_data)
	var step := func(label: String) -> void:
		progress.call(1.0, 1.0, label)
		await get_tree().process_frame
		await get_tree().process_frame
	await step.call(I18n.t("Building the world"))
	track = TrackScene.new(track_data).load_scene()
	add_child(track)
	await step.call(I18n.t("Planting the forest"))
	await _load_forest(q)
	await step.call(I18n.t("Building the circuit physics"))
	track.build_ground_query(get_viewport().world_3d)
	_attach_world_extras(q)
	# weather & environment
	await step.call(I18n.t("Setting up sky and weather"))
	weather = Weather.weather_at(race.weather, 0.0)
	env = GameEnvironment.new(race.weather, q)
	if SpaLook.use(track_data):
		env.set_look(SpaLook.env_look())
	add_child(env)
	track.apply_quality(q)

	# my car
	await step.call(I18n.t("Placing the cars on the grid"))
	# every car model of the session read in threads first (Assets.fetch), held until the cars are built
	var files: Array = Assets.car_files(my_entry, 1, bool(q.cockpitDetail)) + Assets.car_files(my_entry, 1, false)
	for r: Dictionary in racers:
		var rp: Variant = r.player
		if r.id != me and rp != null and rp.carId != null and entries.has(rp.carId):
			var e: Dictionary = entries[rp.carId]
			files.append_array(Assets.car_files(e, 1, false, 0) if bool(Settings.data.get("carsFullDetail", false)) else Assets.car_files(e, 3, false, 1))
	if race.get("rules", {}).get("raceControl", false) and race.kind == "race" and not CarsDb.safety_car().is_empty():
		files.append_array(Assets.car_files(CarsDb.safety_car(), 3, false, 1))
	@warning_ignore("unused_variable")
	var held := await Assets.fetch(files)
	var slot: int = race.slots.get(me, 0)
	var grid: Dictionary = track_data.grid[slot] if slot < track_data.grid.size() else track_data.grid[0]
	# the setup chosen in the lobby (wing, brake balance) changes the car's specs for the physics
	var tuned := CarSetup.apply_setup(my_entry, Settings.data.carSetup)
	# a career race on the phone: the car's performance parts (Garage, decision A: the career only)
	if Progression.career_race_active() and LocalRoom.is_local_code(conn.code):
		tuned = Garage.apply_upgrades(tuned)
	vehicle = Vehicle.new()
	vehicle.auto_step = true
	vehicle.setup_car(tuned, track.ground_query, Settings.data.assists.duplicate(), damage)
	vehicle.apply_setup(CarSetup.vehicle_setup(Settings.data.carSetup))
	add_child(vehicle)
	if contact:
		vehicle.set_contact(true)
	vehicle.drivetrain.manual = bool(Settings.data.manualGearbox)
	await get_tree().physics_frame
	vehicle.place(grid.p[0], grid.p[1], grid.p[2], grid.yaw)
	vehicle.frozen = true
	# no tyre warmers: the tyres leave the pits a little above air temperature
	air = Weather.temperatures(race.weather, weather, track_data.map)
	vehicle.set_air(air.airC, air.trackC, air.airDensity)
	var tyre_id: String = Settings.data.carSetup.tyre
	vehicle.fit_tyres(Tyres.COMPOUNDS.get(tyre_id, Tyres.COMPOUNDS[Tyres.compound_for_weather(weather.wetness)]), vehicle.ambient_c + TYRE_OUT_C)
	fuel_per_lap = nominal_fuel_per_lap()
	if race.get("rules", {}).get("fuel", false):
		vehicle.set_fuel(Settings.data.carSetup.fuelL)
	var with_cockpit: bool = bool(q.cockpitDetail) and my_entry.get("cockpit") != null
	var my_model := Assets.load_car_model(my_entry, 1, bool(q.cockpitDetail))
	var outside: PackedScene = Assets.load_car_model(my_entry, 1, false).lods[0] if with_cockpit else null
	my_visual = CarVisual.new(my_entry, my_model, true, outside)
	vehicle.add_child(my_visual)
	CarPaint.apply(my_visual, Settings.data.livery)
	if bool(q.get("carProbe", false)) and not OS.has_feature("mobile"):
		_add_car_probe(my_visual)
	# every car's paint mirrors the circuit round it (Medium up on a PC): probes along the lap, captured once
	if not OS.has_feature("mobile") and Settings.data.quality != "low":
		_add_track_probes(not bool(q.get("carProbe", false)))
	InputState.wheel.carLockDeg = float(SteeringLock.lock_deg(my_entry.id))
	# a PC lights the road with real beams on every quality (two spot lights, shadows from High up); a phone keeps the
	# projected light pool unless its preset has the spots. No beam shadows on the Compatibility renderer (phones): a
	# shadowed light draws what it reaches in a pass of its own there, even unlit by day, and the lawn's grass layers
	# came out about twice as bright on High and Ultra (measured 2026-11-24, Nürburgring GP: 187 / 191 / 111 against
	# Medium's 95 / 136 / 32; 98 / 139 / 34 without the beam shadows)
	var beam_shadows := bool(q.ownHeadlightShadows) and RenderingServer.get_current_rendering_method() != "gl_compatibility"
	if bool(q.ownHeadlightSpots) or not OS.has_feature("mobile"):
		my_visual.add_headlights(beam_shadows)
	# (the presets without the spots also take the cockpit's cheaper glass)
	if not bool(q.ownHeadlightSpots):
		my_visual.simplify_for_cockpit()
	_attach_my_car_extras(my_entry)
	if spectator:
		my_visual.visible = false
		spec_target = race.grid[0] if race.grid.size() > 0 else ""
	cockpit = CockpitCamera.new(my_entry, my_visual, float(Settings.data.fov))
	cockpit.auto_seat(my_visual)
	add_child(chase.camera)
	add_child(spec_cam)
	add_child(pit_cam)
	spec_cam.fov = 62.0
	spec_cam.far = 6000.0
	pit_cam.fov = 38.0
	pit_cam.far = 9000.0

	# the other drivers' cars
	for r: Dictionary in racers:
		if r.id == me:
			continue
		var pl: Variant = r.player
		if pl == null or pl.carId == null or not entries.has(pl.carId):
			continue
		var entry: Dictionary = entries[pl.carId]
		# (Graphics › Full-resolution cars: the full model, LOD0, at every distance)
		var model := Assets.load_car_model(entry, 1, false, 0) if bool(Settings.data.get("carsFullDetail", false)) else Assets.load_car_model(entry, 3, false, 1)
		var rem := Remote.new()
		rem.id = r.id
		rem.slot = race.slots[r.id]
		rem.entry = entry
		rem.visual = CarVisual.new(entry, model, false)
		var g: Dictionary = track_data.grid[rem.slot] if rem.slot < track_data.grid.size() else track_data.grid[0]
		rem.visual.position = Vector3(g.p[0], g.p[1], g.p[2])
		rem.visual.rotation = Vector3(0, g.yaw, 0)
		add_child(rem.visual)
		CarPaint.apply(rem.visual, livery_of(r.id))
		remotes[rem.slot] = rem
	await step.call(I18n.t("Bringing out the other drivers"))
	var line: Variant = await RacingLinePrep.finish(line_task)
	if line != null:
		AiDriver.prime_racing_line(track_data, line)
	# a phone career race's rival (a bot of that name in a solo room)
	if LocalRoom.is_local_code(conn.code):
		boss_name = Progression.current_boss()
	_create_local_bots(entries)
	# contact rule: a collision box for every car not simulated here (the bots I simulate are real vehicles)
	if contact:
		for r: Remote in remotes.values():
			if r.bot == null:
				r.body = _make_proxy(r)
	if race.get("rules", {}).get("raceControl", false) and race.kind == "race":
		sc_path = RaceControl.safety_car_path(track_data)
		_load_safety_car()
	await step.call(I18n.t("Drawing the racing line"))
	_attach_line_extras(tuned)
	if track_data.get("pitLane") != null:
		_build_pit_lane()
	local_tracker = make_tracker(0.0)

	await step.call(I18n.t("Preparing the TV intro"))
	_build_cinematic(entries)
	hud = Hud.new()
	hud.set_track(track_data)
	hud.race_laps = race_laps() if race.kind == "race" else 0
	hud.grid_order = race.grid.duplicate()
	hud.colors[me] = my_entry.color
	for r: Remote in remotes.values():
		hud.colors[r.id] = r.entry.color
	hud.timed_race = race.kind == "race" and race.get("raceMs", 0) > 0
	for p: Dictionary in room.players:
		hud.set_driver(p.id, p.get("country"), p.get("num"))
	timing = hud.timing
	# the phone's offline races: the objective, the rival's marker and the callouts (RaceObjective)
	if LocalRoom.is_local_code(conn.code) and MobileUI.layout_on() and not spectator and race.kind == "race":
		objective = RaceObjective.new(boss_name)
		hud.add_child(objective)
	if LocalRoom.is_local_code(conn.code):
		chat = ChatPanel.new()
		chat.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
		chat.grow_vertical = Control.GROW_DIRECTION_BEGIN
		chat.offset_left = 16.0
		chat.offset_bottom = -240.0
		chat.submitted.connect(func(text: String) -> void: conn.send_json({"t": "chat", "text": text}))
		chat.closed.connect(func() -> void:
			chat_open = false
			chat_closed_frame = Engine.get_process_frames())
		hud.add_child(chat)
	if mirror != null:
		hud.add_child(mirror.rect)
		hud.move_child(mirror.rect, 0)
	if windshield != null:
		hud.add_child(windshield)
		hud.move_child(windshield, 0)
	if not spectator:
		var model_for_lines: PackedScene = Assets.load_car_model(my_entry, 1, false).lods[0]
		var lines: TopView.Lines = await TopView.render_top_lines(self, model_for_lines)
		hud.set_car(my_entry, lines)
		hud.set_damage_car(my_entry, lines)
	else:
		hud.set_spectating(true)
	_apply_weather()
	await step.call(I18n.t("Compiling shaders"))
	await _warm_up()
	# network
	conn.message.connect(_on_message)
	conn.binary.connect(_on_binary)

## A driver's paint: the room's when it carries one (a player's choice), else one made from their id and number.
func livery_of(id: String) -> Dictionary:
	var p: Variant = _player(id)
	if p != null and p.get("livery") is Dictionary and not (p.livery as Dictionary).is_empty():
		return p.livery
	return CarPaint.livery_for(id, int(p.num) if p != null and p.get("num") != null else -1)

## The HUD layer: added by the app on a CanvasLayer (the session owns the Hud node but not where it lives).
func hud_node() -> Hud:
	return hud

func start() -> void:
	# triple screens: the monitors beside the game's carry the view on (Display → Side screens)
	side_screens = SideScreens.new()
	add_child(side_screens)
	conn.send_json({"t": "loaded", "raceId": race.raceId})
	running = true
	if cinematic != null:
		_set_view_camera(cinematic.camera)
		hud.visible = false
	set_process(true)
	set_physics_process(true)

func set_start_at(t: float) -> void:
	start_at = t
	if local_tracker != null:
		local_tracker = make_tracker(t)

func update_room(snapshot: Dictionary) -> void:
	room = snapshot
	for p: Dictionary in snapshot.players:
		names[p.id] = p.nick
		if hud != null:
			hud.set_driver(p.id, p.get("country"), p.get("num"))
		if p.get("num") != null:
			numbers[p.id] = p.num
	# hide cars of players who left the room
	for r: Remote in remotes.values():
		var present := false
		for p: Dictionary in snapshot.players:
			if p.id == r.id:
				present = true
		if not present:
			r.visual.visible = false

## Local mirror of the server's gate logic: my car, plus the bots when I simulate them.
func make_tracker(start_ms: float) -> RaceTracker:
	var mode: Dictionary
	if race.kind == "race":
		if race.get("raceMs", 0) > 0:
			mode = {"raceMs": race.raceMs, "pitWindow": bool(race.get("rules", {}).get("pitWindow", false))}
		else:
			mode = {"raceLaps": race.laps, "pitWindow": bool(race.get("rules", {}).get("pitWindow", false))}
	else:
		mode = {"sessionMs": race.sessionMs, "cleanStreak": bool(race.get("rules", {}).get("cleanStreak", false))}
	var tr := RaceTracker.new(track_data, start_ms, mode)
	tr.add_player(me)
	for r: Remote in remotes.values():
		if r.bot != null:
			tr.add_player(r.id)
	return tr

func toggle_pause(open: Variant = null) -> void:
	paused = (not paused) if open == null else bool(open)
	if cb.has("on_pause_toggle"):
		cb.on_pause_toggle.call(paused)

func apply_settings() -> void:
	var s: Dictionary = Settings.data
	kb.set_bindings(s.bindings)
	vehicle.assists = s.assists.duplicate()
	vehicle.drivetrain.manual = bool(s.manualGearbox)
	cockpit.set_fov(float(s.fov))
	cockpit.apply_seat()
	if racing_line != null:
		racing_line.set_mode("off" if spectator else s.racingLine)
	var q := Settings.quality_config()
	env.set_quality(q)
	track.apply_quality(q)
	if mirror != null:
		mirror.every = int(q.mirrorEvery)

## Reset to the last checkpoint (pause menu or R).
func request_reset() -> void:
	var now := conn.server_now()
	if pit != null and pit.in_lane:
		flash(I18n.t("In the pit lane: stop in the service box or drive to the pit exit"))
		return
	if start_at == null or now < start_at:
		return
	if now - last_reset_at < 4000.0:
		flash(I18n.t("Reset available again in a moment"))
		return
	var tr: RaceTracker.PlayerRaceState = local_tracker.players.get(me)
	var gates: Array = track_data.gates
	var n := gates.size()
	var x: float
	var y: float
	var z: float
	var yaw: float
	if tr != null and tr.passed >= 0:
		var g: Dictionary = gates[posmod(tr.next_gate - 1 + n, n)]
		# a little before the gate, on the centreline
		var pt := track.point_at(g.s + 2.0)
		x = pt.x
		y = pt.y
		z = pt.z
		yaw = pt.yaw
	else:
		var slot: int = race.slots.get(me, 0)
		var gs: Dictionary = track_data.grid[slot]
		x = gs.p[0]
		y = gs.p[1]
		z = gs.p[2]
		yaw = gs.yaw
	vehicle.place(x, y + 0.3, z, yaw)
	smoother.reset()
	last_reset_at = now
	freeze_until = now + Const.RESET_FREEZE_MS
	vehicle.frozen = true
	reset_flag_samples = 2 # make sure at least one packet carries the reset flag
	incident(4)
	track.reset_hint()
	limits.reset()
	# the time penalty (if any) is announced by the lap logic's penalty event
	if my_laps == 0:
		flash(I18n.t("Reset to the track"))

# ----------------------------------------------------- optional modules ---

func _load_forest(q: Dictionary) -> void:
	forest = await Forest.load_forest(self, track, track_data, q)
	if forest != null:
		track.forest = forest

func _attach_world_extras(q: Dictionary) -> void:
	# the scanned spectators where a circuit has its own look (Spa; the Nürburgring and Silverstone on their own stand
	# materials: the profile's stand_re)
	var crowd: MultiMeshInstance3D = null
	if track_data.get("id", "") == "spa":
		crowd = SpaCrowd.build(track, track_data, float(q.crowd))
	elif SpaLook.use(track_data):
		crowd = SpaCrowd.build(track, track_data, float(q.crowd), SpaLook._p("stand_re", Crowd.STAND_MAT_RE), float(SpaLook._p("seat_m", 0.0)))
	else:
		crowd = Crowd.build(track, track_data, float(q.crowd))
	if crowd != null:
		add_child(crowd)
	Forest.ensure_globals()
	var mask := GrassMask.load_baked(track_data.id)
	if mask == null:
		mask = GrassMask.build(track.chunks, track_data, track.ground_materials)
	wet_fx = WetFx.new()
	add_child(wet_fx)
	tyre_smoke = TyreSmoke.new(TyreSmoke.puffs_for(str(Settings.data.quality)))
	add_child(tyre_smoke)
	var gq: GroundQuery = track.ground_query
	wet_fx.build(track_data, func(x: float, yt: float, z: float, md: float) -> Variant: return gq.height_below(x, yt, z, md), hash(str(track_data.id)))
	shells = GrassShells.build(track, track.lawn_materials, track_data, mask)
	if shells != null:
		add_child(shells)
	# real blades on top of the shells: High and Ultra only (placing them takes seconds)
	if float(q.grassBladeRadius) > 0.0 and not spectator:
		blades = GrassBlades.build(track_data, track.ground_query, {"blades": q.grassBlades, "perM2": q.grassDensity, "band": q.grassBand}, mask)
		if blades != null:
			add_child(blades)

func _attach_my_car_extras(entry: Dictionary) -> void:
	if not spectator:
		mirror = RearMirror.new(vehicle, entry.dims)
		mirror.every = int(Settings.quality_config().mirrorEvery)
		add_child(mirror)
		dash = DashDisplays.new(my_visual)
		add_child(dash)
		crash_fx = CrashFx.new()
		add_child(crash_fx)
		windshield = WindshieldFx.new()

func _attach_line_extras(tuned: Dictionary) -> void:
	if not spectator:
		racing_line = RacingLineFx.new(track_data, tuned.specs, track.ground_query, air.airDensity)
		racing_line.set_mode(Settings.data.racingLine)
		add_child(racing_line)
	# Spa's source model has its own rubber layers (SpaLook): the generic wear decal would darken the road twice
	if not SpaLook.own_wear(track_data):
		road_wear = RoadWear.new(track_data, tuned.specs, track.ground_query, air.airDensity)
		road_wear.set_neutral(SpaLook.use(track_data))
		add_child(road_wear)

func _build_cinematic(entries: Dictionary) -> void:
	var entrants: Array = []
	for id: String in race.grid:
		var p: Variant = _player(id)
		var e: Variant = entries.get(p.carId) if p != null and p.carId != null else null
		if p == null or e == null:
			continue
		entrants.append({"slot": race.slots.get(id, 0), "nick": p.nick, "carName": e.name, "color": e.color, "me": id == me, "bot": p.get("bot", false)})
	var w0 := weather
	var hh := int(floorf(w0.hour))
	var mm := int(floorf((w0.hour - hh) * 60.0))
	var facts: Array = ["%.3f km" % (float(track_data.length) / 1000.0)]
	if track_data.get("turns") != null:
		facts.append(I18n.t("{n} turns", {"n": int(track_data.turns)}))
	facts.append("%02d:%02d" % [hh, mm])
	facts.append(I18n.t(Weather.LABEL[race.weather.kind]))
	facts.append(I18n.t("Wet track") if w0.wetness > 0.3 else (I18n.t("Damp track") if w0.wetness > 0.05 else I18n.t("Dry track")))
	facts.append(I18n.t("{n} drivers", {"n": entrants.size()}))
	var format: String
	if race.kind == "race":
		format = I18n.t("Race · {min} minutes + 1 lap · grid from qualifying", {"min": roundi(race.raceMs / 60000.0)}) if race.get("raceMs", 0) > 0 else I18n.t("Race · {n} laps · grid from qualifying", {"n": race.laps})
	elif race.kind == "practice":
		format = I18n.t("{min}-minute free practice · learn the track, try your setup", {"min": roundi(race.sessionMs / 60000.0)})
	else:
		format = I18n.t("{min}-minute qualifying · best valid lap wins · pit lane open", {"min": roundi(race.sessionMs / 60000.0)})
	cinematic = Cinematic.new(track_data, entrants, {"trackName": track_data.name, "facts": facts, "format": format})
	add_child(cinematic.camera)

func _warm_up() -> void:
	# the first frames compile the shaders: show everything once, behind the loading screen
	track.show_all()
	await get_tree().process_frame

# ----------------------------------------------------------- networking ---

func _on_message(m: Dictionary) -> void:
	match m.t:
		"countdown":
			if m.raceId == race.raceId:
				set_start_at(m.startAt)
		"chat":
			if chat != null:
				chat.add_line(String(m.nick), String(m.text), bool(m.get("rc", false)), Color(String(hud.colors.get(m.from, "#ffffff"))))
		"standings":
			if m.raceId != race.raceId:
				return
			standings = m.list
			hud.set_board(m.list, me, names)
			update_timing()
		"lap":
			if m.playerId == me:
				_on_my_lap(m)
		"penalty":
			# track limits, resets and shortcuts are announced at once by the local mirror of the lap logic; race
			# control's penalties come from the server only
			if m.reason == "track-limits" or m.reason == "reset" or m.reason == "shortcut":
				return
			var what := I18n.t(PENALTY_TEXT[m.reason])
			var mine: bool = m.playerId == me
			var pname: String = names.get(m.playerId, I18n.t("A driver"))
			if m.get("driveThrough", false):
				flash(I18n.t("DRIVE-THROUGH: {what} · serve it within 3 laps", {"what": what}) if mine else I18n.t("{name}: drive-through, {what}", {"name": pname, "what": what}), 6000.0 if mine else 3000.0, "bad" if mine else "info")
			else:
				flash(I18n.t("+{s} s: {what}", {"s": "%.0f" % (m.ms / 1000.0), "what": what}) if mine else I18n.t("{name}: +{s} s, {what}", {"name": pname, "s": "%.0f" % (m.ms / 1000.0), "what": what}), 4000.0, "bad" if mine else "info")
			if mine:
				_chime("invalid")
		"served":
			if m.playerId == me:
				flash(I18n.t("Mandatory stop done") if m.what == "stop" else I18n.t("Drive-through served"), 3000.0, "good")
		"raceControl":
			if m.raceId == race.raceId:
				_on_race_control(m.state)
		"flag":
			if m.raceId != race.raceId:
				return
			flagged = true
			flash(I18n.t("CHEQUERED FLAG: session over") if pit != null and pit.in_lane else I18n.t("CHEQUERED FLAG: finish your lap, it still counts"), 5000.0, "flag")
			_chime("lap")
		"sector":
			if m.playerId == me and best_sectors.size() > m.sector:
				var ref := 0.0
				for i in range(m.sector + 1):
					ref += best_sectors[i]
				# current lap sector sum = time since lap start
				var mine_t := conn.server_now() - lap_start_ms()
				sector_delta = mine_t - ref
				sector_delta_until = Time.get_ticks_msec() + 4000.0
		"finished":
			if m.playerId == me:
				finished_ms = m.totalMs
				var pos := 0
				for i in standings.size():
					if standings[i].id == me:
						pos = i + 1
				flash("%s%s" % [I18n.t("FINISHED") if race.kind == "race" else I18n.t("SESSION COMPLETE"), " · P%d" % pos if pos > 0 else ""], 8000.0, "good")
			else:
				flash(I18n.t("{name} has completed the session", {"name": names.get(m.playerId, I18n.t("A driver"))}), 3000.0)
		"damage":
			for r: Remote in remotes.values():
				if r.id != m.playerId:
					continue
				var before := r.damage.zones.duplicate()
				r.damage.set_all(m.zones)
				# visual dents where a zone increased
				for z in 4:
					var inc: float = r.damage.zones[z] - before[z]
					if inc > 0.02:
						r.visual.dent(zone_point(z, r.entry), zone_dir(z), inc * 2.0)
				tear_parts(r.visual, r.damage.zones, before, r.vel, Vector3.ZERO)
		"results":
			if m.raceId == race.raceId and cb.has("on_results"):
				cb.on_results.call(m)
		"bump":
			_on_bump(m)
		"room":
			update_room(m.room)
		"error":
			if m.fatal and cb.has("on_fatal"):
				cb.on_fatal.call(m.message)

func _on_my_lap(m: Dictionary) -> void:
	my_laps = m.lap
	# fuel a lap burns, measured (a lap with a stop in it doesn't count: refuelled)
	var fuel := vehicle.fuel_l
	if fuel >= 0.0:
		if fuel_at_lap != null and fuel_at_lap > fuel:
			fuel_per_lap = fuel_at_lap - fuel
		fuel_at_lap = fuel
	if m.outLap:
		career.lapIncidents = 0
		flash(I18n.t("Out lap done · timed lap starts now"), 3000.0)
		return
	lap_times.append(m.lapMs)
	career.laps += 1
	if career.lapIncidents == 0 and m.valid:
		career.cleanLaps += 1
	career.lapIncidents = 0
	if m.best and m.valid:
		career.pbs += 1
	if m.best:
		best_lap = m.lapMs
		best_sectors = m.sectors.duplicate()
	var session_best := true
	for s: Dictionary in standings:
		if s.id != me and s.bestLapMs != null and s.bestLapMs <= m.lapMs:
			session_best = false
	var tag := ""
	if not m.valid:
		tag = I18n.t("  ·  INVALID")
	elif m.best:
		tag = I18n.t("  ·  FASTEST LAP") if session_best else I18n.t("  ·  personal best")
	var pen := I18n.t("  ·  incl. +{s} s penalties", {"s": "%.1f" % (m.penaltyMs / 1000.0)}) if m.penaltyMs > 0 else ""
	flash(I18n.t("Lap {n}: {time}", {"n": m.lap - 1, "time": UIKit.fmt_lap(m.lapMs)}) + tag + pen, 3500.0, "bad" if not m.valid else (("best" if session_best else "pb") if m.best else "lap"))
	if m.valid:
		_chime(("session-best" if session_best else "best") if m.best else "lap")

## Race control changed something: announce the new course state.
func _on_race_control(state: Dictionary) -> void:
	var before: String = rc.course
	rc = state
	if state.course == before:
		return
	var text: String
	match state.course:
		"fcy":
			text = I18n.t("FULL COURSE YELLOW · {kmh} km/h in 10 s · no overtaking", {"kmh": int(RaceControl.C.fcyKmh)})
		"sc":
			text = I18n.t("SAFETY CAR · no overtaking, close up behind it")
		"sc-in":
			text = I18n.t("SAFETY CAR IN THIS LAP · no overtaking until the line")
		_:
			text = I18n.t("GREEN FLAG · racing resumes")
	flash(text, 5000.0, "good" if state.course == "green" else "flag")
	if state.course == "green":
		green_until = Time.get_ticks_msec() + 4000.0
	_chime("lap" if state.course == "green" else "invalid")

var _relay_scratch: Array = [CarState.new(), CarState.new(), CarState.new(), CarState.new()]

func _on_binary(buf: PackedByteArray) -> void:
	var dec := CarState.decode_relay(buf, _relay_scratch, conn.server_now())
	if dec.is_empty():
		return
	var r: Remote = remotes.get(dec.slot)
	if r == null:
		return
	for i: int in dec.count:
		r.buffer.push(_relay_scratch[i], (dec.seq * Const.STATES_PER_PACKET + i) & 0xffff)

# ------------------------------------------------------------- physics ---

func _physics_process(dt: float) -> void:
	if not running or vehicle == null:
		return
	Prof.b("S.physics")
	if Prof.spike_ms > 0.0:
		Prof._cur["#steps"] = Prof._cur.get("#steps", 0) + 1
	_physics_inner(dt)
	Prof.e("S.physics")

func _physics_inner(dt: float) -> void:
	var server_now := conn.server_now()
	var race_t: float = server_now - start_at if start_at != null else -INF
	# the keys, touch and pad into the controls of my car (the physics-step filters run inside the Vehicle)
	var controls := smoother.update(dt, kb, vehicle.telemetry.forwardSpeed, vehicle.is_reverse())
	if autodrive != null and race_t >= 0.0:
		controls = autodrive.update(FIXED_DT, true, vehicle.weather_grip * vehicle.tyre_grip_avg(), -1.0)
	if paused or chat_open or replay_open:
		controls.throttle = 0.0
		controls.steer = 0.0
		if chat_open or replay_open:
			controls.brake = 0.0
			controls.handbrake = 0.0
	vehicle.controls = controls
	if spectator:
		vehicle.frozen = true
	Prof.b("bots")
	step_bots(race_t)
	Prof.e("bots")
	if contact:
		pit_lane_contact()
		move_kinematics(dt)
		after_contacts()
	if step_count % RESCUE_STEPS == 0:
		rescue_cars()
	drain_contacts()
	step_count += 1
	# stamp each sample with the time of its own physics step
	if step_count % STEPS_PER_SAMPLE == 0:
		if not spectator:
			sample_state(server_now)
		sample_bots(server_now)

func sample_state(server_now: float) -> void:
	var v := vehicle
	var s: CarState = pending[pending_count]
	var f := fill_state(s, v, server_now, headlights_on)
	if damage.zones[4] > 0.55:
		f |= CarState.FLAG_SMOKE
	if reset_flag_samples > 0:
		f |= CarState.FLAG_RESET
		reset_flag_samples -= 1
	# track limits: all four wheels off, or well past the edge line
	var fwd := v.global_transform.basis.z
	loc = track.locate(s.px, s.py, s.pz, fwd.x, fwd.z)
	if limits.update(1.0 / Const.STATE_HZ, TrackLimits.beyond_limits_now(v, track_data, loc.index, loc.lateral)):
		f |= CarState.FLAG_OFF_TRACK
	if recently_hit(me):
		f |= CarState.FLAG_HIT
	s.flags = f
	# mirror the server's gate logic locally (resets, the live delta and instant track-limit warnings)
	var ev: Array = []
	if local_tracker != null:
		local_tracker.ingest(me, s.t, s.px, s.py, s.pz, (f & CarState.FLAG_RESET) != 0, ev, (f & CarState.FLAG_OFF_TRACK) != 0, (f & CarState.FLAG_HIT) != 0)
	update_lap_delta(s.t, ev)
	pending_count += 1
	if pending_count >= Const.STATES_PER_PACKET:
		conn.send_binary(CarState.encode_client_states(seq, pending, pending_count))
		seq = (seq + 1) & 0xffff
		pending_count = 0
	# low-frequency visual damage sync
	if damage.version != damage_version_sent and server_now - last_damage_sent > 1000.0:
		damage_version_sent = damage.version
		last_damage_sent = server_now
		conn.send_json({"t": "damage", "zones": _round_zones()})

## ------------------------------------------------------------------ replay ---

## In-car adjustments (iRacing's F8 black box): they take effect at once and are kept for the next session.
const BIAS_STEP := 0.005

func adjust_brake_bias(dir: int) -> void:
	var s: Dictionary = vehicle.specs
	var bias := clampf(snappedf(float(s.brakeBiasFront) + dir * BIAS_STEP, BIAS_STEP), 0.54, 0.66)
	s.brakeBiasFront = bias
	Settings.data.carSetup.brakeBias = bias
	Settings.save()
	flash(I18n.t("Brake bias {pct} % front", {"pct": "%.1f" % (bias * 100.0)}), 1500.0, "osd")

func cycle_traction_control() -> void:
	var tc := (int(vehicle.assists.tc) + 1) % 3
	vehicle.assists.tc = tc
	Settings.data.assists.tc = tc
	Settings.save()
	var names := [I18n.t("Traction control: off"), I18n.t("Traction control: low"), I18n.t("Traction control: high")]
	flash(names[tc], 1500.0, "osd")

func toggle_abs() -> void:
	var on := not bool(vehicle.assists.abs)
	vehicle.assists.abs = on
	Settings.data.assists.abs = on
	Settings.save()
	flash(I18n.t("ABS on") if on else I18n.t("ABS off"), 1500.0, "osd")

## The delta key: best lap, then optimal lap, then optimal sectors (a mode without a reference yet is skipped).
func cycle_delta_mode() -> void:
	var i: int = LapDelta.MODES.find(String(Settings.data.deltaMode))
	for _k in LapDelta.MODES.size():
		i = (i + 1) % LapDelta.MODES.size()
		if LapDelta.MODES[i] == "best" or (lap_delta != null and lap_delta.has(LapDelta.MODES[i])):
			break
	Settings.data.deltaMode = LapDelta.MODES[i]
	Settings.save()
	var names := {"best": I18n.t("Delta: your best lap"), "optimal": I18n.t("Delta: your optimal lap"), "sectors": I18n.t("Delta: your best sectors")}
	flash(names[Settings.data.deltaMode], 1800.0, "osd")

# --------------------------------------------------------------- frame ---

func _input(e: InputEvent) -> void:
	kb.process_event(e)
	if spectator and e is InputEventKey and e.pressed and not e.echo:
		_on_spectator_key(e)
	if cinematic != null and e is InputEventKey and e.pressed and (e.keycode == KEY_ENTER or e.keycode == KEY_SPACE or e.keycode == KEY_ESCAPE):
		cinematic.skip()
		get_viewport().set_input_as_handled()

func _process(dt: float) -> void:
	_refresh_track_probes()
	if not running or vehicle == null:
		return
	Prof.frame()
	Prof.b("S.process")
	_process_inner(dt)
	Prof.e("S.process")

func _process_inner(dt: float) -> void:
	dt = minf(dt, MAX_FRAME_DT)
	var server_now := conn.server_now()
	var race_t: float = server_now - start_at if start_at != null else -INF
	Prof.start()
	handle_keys(server_now)

	# countdown & start lights
	if start_at == null or race_t < 0.0:
		vehicle.frozen = true
		update_countdown(null if start_at == null else -race_t)
	elif not spectator and server_now >= freeze_until and vehicle.frozen and race_t >= 0.0 and not pit_hold:
		vehicle.frozen = false
		update_countdown(-1.0)
		if my_laps == 0 and race_t < 2000.0:
			flash(_start_hint(), 6000.0)
	elif race_t < 1500.0:
		update_countdown(-1.0)
	else:
		clear_countdown()
	if spectator:
		vehicle.frozen = true

	Prof.mark("p.keys_countdown")
	# weather (deterministic from seed + race clock)
	weather_timer -= dt
	if weather_timer <= 0.0:
		weather_timer = 0.25
		weather = Weather.weather_at(race.weather, maxf(0.0, race_t / 1000.0))
		_apply_weather()

	update_safety_car(server_now, dt)
	if contact:
		send_bumps()

	Prof.mark("p.weather_sc")
	# visuals of my car
	var v := vehicle
	var susp := [0.0, 0.0, 0.0, 0.0]
	# relative to the model's own ride height (rest_len0): a lowered car sits lower over its wheels
	for i in 4:
		var w := v.wheels[i]
		susp[i] = -(w.spring_len - (w.rest_len0 - w.fz0 / w.k)) if w.contact else -0.05
	my_visual.set_pose(v.steer_angle, v.wheels[0].angle, v.wheels[2].angle, susp)
	var braking: bool = v.pedals.brake > 0.1 and not v.is_reverse()
	my_visual.set_lights(braking, headlights_on, env.night)
	my_visual.update_smoke(dt, damage.zones[4], tyre_smoke)

	Prof.mark("p.my_visual")
	# camera
	var car_vel := v.linear_velocity
	var yaw_rate := v.angular_velocity.y
	cockpit.update(dt, v.telemetry, v.steer_angle, {"left": kb.held("lookLeft"), "right": kb.held("lookRight"), "back": kb.held("lookBack")}, yaw_rate)
	var cam_pos := cockpit.world_position()
	var outside: bool = not spectator and Settings.data.camera != "cockpit"
	cockpit.hidden = outside
	var view_cam: Camera3D = chase.camera if outside else cockpit.camera
	if outside:
		chase.update(dt, v, car_vel, Settings.data.camera, kb.held("lookBack"))
		cam_pos = chase.camera.global_position
	# a pit stop: the TV camera on the crew, as broadcast stops are shown (settings: or stay in the car)
	if service != null and Settings.data.pitCamera == "tv" and not spectator:
		update_pit_cam(dt)
		view_cam = pit_cam
		cam_pos = pit_cam.global_position
		cockpit.hidden = true
		pit_cam_on = true
	elif pit_cam_on:
		pit_cam_on = false
	var cine: Cinematic = cinematic
	if cine != null:
		if cine.update(dt, null if start_at == null else start_at - server_now):
			view_cam = cine.camera
			cam_pos = cine.camera.global_position
			env.fog_scale = 0.45
			env.hide_rain = cine.aerial
		else:
			cinematic = null
			env.fog_scale = 1.0
			env.hide_rain = false
			hud.visible = true
	# the trackside TV cameras: watching, after the flag, or asked for (T)
	if cinematic == null and not pit_cam_on and tv_wanted():
		var tt: Variant = tv_target()
		var cams: TvCameras = tv_cameras() if tt != null else null
		if tt != null and cams != null and cams.update(dt, tt.pos, tt.vel, tt.s):
			view_cam = cams.camera
			cam_pos = cams.camera.global_position
			cockpit.hidden = true
			tv_on = true
	elif tv_on:
		tv_on = false
		spec_cam_init = false
	if spectator and cinematic == null and not tv_on:
		update_spectator_cam(dt)
		view_cam = spec_cam
		cam_pos = spec_cam.global_position
	if replay_open:
		var rc: Camera3D = _replay_update(dt)
		if rc != null:
			view_cam = rc
			cam_pos = rc.global_position
			cockpit.hidden = true
	view_cam.current = true
	var in_cockpit := view_cam == cockpit.camera
	CarVisual.cockpit_glass = 1.0 if in_cockpit else 0.0
	my_visual.update_cockpit_glass(CarVisual.cockpit_glass)
	my_visual.set_inside(in_cockpit)

	# the racing line is the driver's aid, not part of the broadcast picture
	if racing_line != null:
		racing_line.visible = not tv_on
		if not spectator:
			racing_line.update_line(loc.index, maxf(0.0, vehicle.telemetry.forwardSpeed))

	Prof.mark("p.cameras")
	# the other drivers' cars
	for r: Remote in remotes.values():
		update_remote(r, server_now, dt, cam_pos)

	Prof.mark("p.remotes")
	if replay_open:
		_replay_apply()
	else:
		_replay_record(dt, server_now)
	# environment
	Prof.b("env")
	env.update(dt, weather, view_cam, vehicle.global_position, car_vel)
	Prof.e("env")
	if crash_fx != null:
		crash_fx.update(dt)
	# aerial shots see the whole circuit: distance culling (meant for the cockpit) would leave holes
	var q := Settings.quality_config()
	if cinematic != null and cinematic.aerial:
		track.show_all()
		if forest != null:
			forest.update(cam_pos, q)
	else:
		Prof.b("track.vis")
		track.update_visibility(cam_pos, q)
		Prof.e("track.vis")
	_update_spray(dt, cam_pos)
	_update_tyre_smoke(dt, cam_pos)
	if windshield != null and not spectator:
		windshield.update_fx(dt, weather.rain, v.telemetry.speed, get_viewport().get_visible_rect().size.aspect(), 1.0 - env.night * 0.8, cockpit.looking_forward and not outside and not pit_cam_on and not tv_on)
		windshield.set_crack(damage.zones[0], cockpit.looking_forward and not outside and not pit_cam_on and not tv_on)
	if shells != null:
		shells.update_shells(cam_pos, q, cinematic != null and cinematic.aerial)
	if blades != null:
		blades.update_blades(cam_pos, 0.0 if cinematic != null and cinematic.aerial else float(q.grassBladeRadius))
		var gcars: Array = [Vector3(vehicle.global_position.x, vehicle.global_position.z, minf(1.0, vehicle.telemetry.speed / 40.0))]
		for rr: Remote in remotes.values():
			if gcars.size() >= GrassBlades.GRASS_CARS:
				break
			if rr.visual.visible:
				gcars.append(Vector3(rr.visual.global_position.x, rr.visual.global_position.z, minf(1.0, rr.vel.length() / 40.0)))
		blades.set_frame(Vector2(1.2, 0.5) * (0.6 + 0.8 * weather.rain), weather.wetness, gcars)
	Prof.b("audio")
	Prof.mark("p.track_shells")
	update_audio(dt, view_cam)
	Prof.e("audio")
	Prof.mark("p.audio")
	update_wake()
	update_ghost(server_now)

	# the HUD's numbers and tables at 30 Hz: the eye cannot tell, the phone's CPU can
	_ui_acc += dt
	if _ui_acc >= 1.0 / 30.0 - 0.002:
		Prof.b("ui")
		update_race_ui(server_now, race_t, _ui_acc)
		Prof.e("ui")
		_ui_acc = 0.0
	Prof.mark("p.wake_ghost_ui")
	update_pit(server_now)
	update_limiters(server_now)
	update_bot_pits(server_now)
	kb.end_frame()
	if mirror != null:
		# (no mirror on a phone: the references' HUD leaves the top of the road clear)
		mirror.visible = Settings.data.mirror and not UIKit.touch() and cinematic == null and not tv_on and cockpit.looking_forward and not kb.held("lookBack")

func handle_keys(server_now: float) -> void:
	var show_timing := kb.held("timing")
	if timing != null and show_timing != timing.visible:
		timing.set_shown(show_timing)
		if show_timing:
			update_timing()
	# typing in the chat: keys are text, and the key that closes the line must not also act
	if chat_open or Engine.get_process_frames() == chat_closed_frame:
		return
	if replay_open:
		_replay_keys()
		return
	if kb.tapped("pause"):
		toggle_pause()
	if paused:
		return
	if kb.tapped("replay") and replay.size() >= 40:
		open_replay()
		return
	if chat != null and kb.tapped("chat") and not spectator:
		chat_open = true
		chat.open()
		return
	# an H-pattern shifter: the gear its lever is in (the gearbox is manual while one is bound)
	var hg: int = InputState.rig.gear
	if hg != -99 and not spectator:
		vehicle.drivetrain.manual = true
		if hg != _h_gear:
			_h_gear = hg
			# a 7th position on a six-speed car is 6th
			vehicle.drivetrain.set_gear(clampi(hg, -1, (vehicle.specs.gears as Array).size()))
	if kb.tapped("shiftUp"):
		vehicle.shift(1)
	if kb.tapped("shiftDown"):
		vehicle.shift(-1)
	if kb.tapped("camera") and not spectator:
		if tv_view:
			toggle_tv()
		else:
			cycle_camera()
	if kb.tapped("tvCamera") and not spectator:
		toggle_tv()
	if kb.tapped("deltaMode") and not spectator:
		cycle_delta_mode()
	if not spectator:
		if kb.tapped("brakeBiasUp"):
			adjust_brake_bias(1)
		if kb.tapped("brakeBiasDown"):
			adjust_brake_bias(-1)
		if kb.tapped("tcCycle"):
			cycle_traction_control()
		if kb.tapped("absToggle"):
			toggle_abs()
	if kb.tapped("toggleGearbox"):
		Settings.data.manualGearbox = not Settings.data.manualGearbox
		vehicle.drivetrain.manual = bool(Settings.data.manualGearbox)
		flash(I18n.t("Manual gearbox") if Settings.data.manualGearbox else I18n.t("Automatic gearbox"), 1500.0, "osd")
	if kb.tapped("resetCar"):
		request_reset()
	if freeze_until > 0.0 and server_now >= freeze_until and start_at != null and server_now >= start_at and not pit_hold:
		vehicle.frozen = false
		freeze_until = 0.0

## The other drivers' cars where they are now (a human's from its buffer, a bot's from its vehicle).
func update_remote(r: Remote, server_now: float, dt: float, cam_pos: Vector3) -> void:
	if r.bot != null:
		var b := r.bot
		var v := b.vehicle
		r.vel = v.linear_velocity
		var susp := [0.0, 0.0, 0.0, 0.0]
		for i in 4:
			susp[i] = clampf(v.wheels[i].compression, 0.0, 0.25) - 0.02
		r.visual.position = Vector3(0, b.lift, 0)
		r.visual.set_pose(v.steer_angle, v.wheels[0].angle, v.wheels[2].angle, susp)
		r.visual.set_lights(v.pedals.brake > 0.1 and not v.is_reverse(), headlights_on, env.night)
		r.visual.update_smoke(dt, 0.0, tyre_smoke)
		var d := r.visual.global_position.distance_to(cam_pos)
		r.visual.set_opacity(1.0 if cinematic != null or contact else near_fade(d))
		return
	# driving: where the car is now (both drivers of a fight see the same order); watching: smooth, in the past
	var s := r.buffer.sample(server_now, dt, float(Const.INTERP_DELAY_MS) if spectator else 0.0)
	if s == null:
		return
	var o: CarVisual = r.visual
	o.global_position = Vector3(s.px, s.py, s.pz)
	r.vel = Vector3(s.vx, s.vy, s.vz)
	o.global_transform.basis = Basis(Quaternion(s.qx, s.qy, s.qz, s.qw))
	var susp2 := [s.susp[0] - 0.02, s.susp[1] - 0.02, s.susp[2] - 0.02, s.susp[3] - 0.02]
	o.set_pose(s.steer, s.rot_f, s.rot_r, susp2)
	o.set_lights((s.flags & CarState.FLAG_BRAKE) != 0, (s.flags & CarState.FLAG_HEADLIGHTS) != 0, env.night)
	o.update_smoke(dt, maxf(0.6, r.damage.zones[4]) if (s.flags & CarState.FLAG_SMOKE) != 0 else 0.0, tyre_smoke)
	# ghost: fade out when very close to the camera so it never blocks the cockpit view
	var dd := o.global_position.distance_to(cam_pos)
	var fade := 1.0 if cinematic != null or contact or (spectator and r.id == spec_target) else near_fade(dd)
	o.set_opacity(0.35 if s.stale_ms > 5000.0 else fade)

## How visible another car is at this distance from the camera without car contact (cars drive through each other):
## gone within NEAR_HIDE_M, whole from NEAR_FULL_M. It used to stay at 15 % up close, which with the stochastic
## transparency of other cars (alpha hash) drew a speckled grey shell over the road, worst on the grid behind you.
const NEAR_HIDE_M := 4.0
const NEAR_FULL_M := 8.5

static func near_fade(d: float) -> float:
	return clampf((d - NEAR_HIDE_M) / (NEAR_FULL_M - NEAR_HIDE_M), 0.0, 1.0)

## Slipstream for my car and the bots I simulate, from every car's position and velocity.
func update_wake() -> void:
	wake_cars.clear()
	for r: Remote in remotes.values():
		if r.visual.visible:
			wake_cars.append({"pos": r.visual.global_position, "vel": r.vel})
	wake_cars.append({"pos": vehicle.global_position, "vel": vehicle.linear_velocity})
	var apply := func(v: Vehicle, pos: Vector3, vel: Vector3) -> void:
		var others: Array = wake_cars.filter(func(c: Dictionary) -> bool: return c.pos != pos)
		var s := BestLapGhost.wake_strength(pos, vel, others)
		v.wake.strength += (s - v.wake.strength) * 0.2
		# research: the follower loses drag in the wake and, right behind, some downforce (dirty air)
		v.wake.drag = 1.0 - 0.25 * v.wake.strength
		v.wake.downforce = 1.0 - 0.15 * v.wake.strength
	apply.call(vehicle, vehicle.global_position, vehicle.linear_velocity)
	for r: Remote in remotes.values():
		if r.bot != null:
			apply.call(r.bot.vehicle, r.bot.vehicle.global_position, r.vel)

## Engines, chassis noises and ambience, heard from the active camera.
func update_audio(dt: float, view_cam: Camera3D) -> void:
	if snd == null:
		var a: Variant = cb.get("audio", Callable()).call() if cb.has("audio") else null
		if a == null or not a.settled:
			return
		snd = SessionAudio.new(a, vehicle.car, track_data)
	var others: Array = []
	for r: Remote in remotes.values():
		if not r.visual.visible or (r.bot == null and not r.buffer.has_data()):
			continue
		var bv: Vehicle = r.bot.vehicle if r.bot != null else null
		others.append({
			"key": r.id, "entry": r.entry, "pos": r.visual.global_position, "vel": r.vel,
			"rpm": bv.telemetry.rpm if bv != null else null, "load": bv.pedals.throttle if bv != null else null,
			"gearRatio": absf(bv.drivetrain.ratio()) if bv != null else null,
		})
	snd.update(dt, {
		"listener": view_cam.global_position, "right": view_cam.global_transform.basis.x,
		"inCockpit": cinematic == null and not spectator and not tv_on, "myPos": vehicle.global_position,
		"myVel": vehicle.linear_velocity, "vehicle": vehicle, "others": others, "rain": weather.rain, "wet": weather.wetness, "day": 1.0 - env.night,
	})

# ------------------------------------------------------------ teardown ---

func dispose() -> void:
	running = false
	if conn != null:
		if conn.message.is_connected(_on_message):
			conn.message.disconnect(_on_message)
		if conn.binary.is_connected(_on_binary):
			conn.binary.disconnect(_on_binary)
	if snd != null:
		snd.dispose()
	close_pit_menu()
	if hud != null:
		hud.queue_free()
	queue_free()
