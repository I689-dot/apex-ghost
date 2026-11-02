class_name RaceSession
extends Node3D
## One race: loads everything for it, runs physics / render / network until the results arrive (port of
## game/session.ts RaceSession). A Node3D holding the world: track, environment, my car (a Jolt Vehicle with a CarVisual
## child, interpolated by the engine), the bots I simulate (also Vehicles), the other drivers' cars (CarVisuals driven by
## RemoteCarBuffer), cameras and the HUD. Optional subsystems (cinematic, pit crews, TV cameras, audio, radio, grass,
## forest ...) are plain fields that stay null until their module attaches: every use is guarded.

const FIXED_DT := 1.0 / 120.0
const STEPS_PER_SAMPLE := 120 / 20 # PHYSICS_HZ / STATE_HZ
const MAX_FRAME_DT := 0.1
## How far a bot moves over to pass a slower car (m).
const PASS_OFFSET := 3.6
## AI cars leave the grid one at a time, this far apart (qualifying: no rolling start).
const BOT_RELEASE_MS := 1000.0
## Contact rule: a car simulated elsewhere is a stand-in here with its real mass, driven every step to where the
## prediction puts it (velocity towards that pose, PROXY_TAU_S).
const PROXY_TAU_S := 0.06
const PROXY_SNAP_M := 3.0
const PROXY_PULL_MS := 12.0
const BUMP_MIN := 300.0
const BUMP_SEND_MS := 60.0
const BUMP_DEDUPE_MS := 500.0
const RESCUE_STEPS := 12
const FCY_MS := 80.0 / 3.6
## Maps whose pit lane gets our own surface: Zandvoort's model draws it near-white.
const PIT_SURFACE_MAPS := ["zandvoort"]
## What race control's penalties are for (the drive-through announcements).
const PENALTY_TEXT := {
	"track-limits": "track limits", "reset": "reset", "shortcut": "shortcut",
	"overtake-sc": "overtaking under the safety car", "overtake-fcy": "overtaking under the full-course yellow",
	"overtake-yellow": "overtaking under yellow flags", "passed-sc": "overtaking the safety car",
	"blue-flags": "ignoring blue flags", "missed-stop": "no mandatory stop", "unserved": "drive-through not served",
}

## Another driver's car: a human's (buffer-driven) or a bot I simulate (bot != null).
class Remote:
	extends RefCounted
	var id: String
	var slot: int
	var entry: Dictionary
	var visual: CarVisual
	var buffer := RemoteCarBuffer.new()
	var damage := DamageState.new()
	var last_damage_version := 0
	## Last known velocity (for engine pitch and Doppler).
	var vel := Vector3.ZERO
	## Set on the host for bots: simulated here and streamed to everyone else.
	var bot: LocalBot = null
	## Contact rule: its stand-in body, and the velocity set before the last solver step.
	var body: RigidBody3D = null
	var set_v := Vector3.ZERO
	## The stand-in jumped and passes through cars until clear of them.
	var ghosted := false
	## Impulse it took from a car simulated here, not yet sent (N*s, world; yaw N*m*s), from whom, last sent.
	var bump := Vector3.ZERO
	var bump_yaw := 0.0
	var bump_from := ""
	var bump_sent := 0.0
	## Where the visual sits (a bot's follows its vehicle; a remote human's is set from the buffer).
	var node: Node3D

class LocalBot:
	extends RefCounted
	var vehicle: Vehicle
	var ai: AiDriver
	var pending: Array = [CarState.new(), CarState.new()]
	var pending_count := 0
	var seq := 0
	var reset_flag_samples := 0
	var limits := TrackLimits.new()
	var hint := -1
	## Seconds left before a pass manoeuvre is given up (traffic cleared).
	var pass_hold := 0.0
	var pit: PitLaneMonitor = null
	var stop_lap := 0
	var service_end := 0.0
	var service_plan = null
	var service_start := 0.0
	var service_events = null
	var fired := 0
	var lift := 0.0
	var exit_at := 0.0
	var pit_sent := false

## Callbacks the app supplies: on_countdown_text(text, sub), on_pause_toggle(open), on_results(msg), on_fatal(message).
var cb: Dictionary = {}
var conn: Connection
var race: Dictionary
var room: Dictionary
var me: String
var cars_file: Dictionary
var spectator := false
var contact := false

var track: TrackScene
var track_data: Dictionary
var env: GameEnvironment
var vehicle: Vehicle
var my_visual: CarVisual
var cockpit: CockpitCamera
var chase := ChaseCamera.new()
var remotes := {} # slot -> Remote
var kb: KeyboardInput
var smoother := InputSmoother.new()
var damage := DamageState.new()
var hud: Hud
var local_tracker: RaceTracker = null
var names := {}
var numbers := {}
var standings: Array = []
var finish_deadline = null
var running := false
var disposed := false
var step_count := 0
var start_at = null
var seq := 0
var pending: Array = [CarState.new(), CarState.new()]
var pending_count := 0
var reset_flag_samples := 0
var career := {"km": 0.0, "laps": 0, "cleanLaps": 0, "pbs": 0, "incidents": 0, "lapIncidents": 0}
var freeze_until := 0.0
var last_reset_at := -1e9
var wrong_way_time := 0.0
var stuck_time := 0.0
var weather: Dictionary
var weather_timer := 0.0
var headlights_on := false
var last_damage_sent := 0.0
var damage_version_sent := 0
var paused := false
var air: Dictionary = {"airC": 20.0, "trackC": 25.0, "airDensity": 1.2}

# my race progress (from server events)
var my_laps := 0
var lap_times: Array = []
var best_lap = null
var best_sectors: Array = []
var sector_delta = null
var sector_delta_until := 0.0
var finished_ms = null
var limits := TrackLimits.new()
var lap_delta: LapDelta = null
var live_delta = null
var ghost := BestLapGhost.new()
var ghost_visual: CarVisual = null
var ghost_loading := false
var wake_cars: Array = []
var message := ""
var message_until := 0.0
## Race control's flags and course state (from the server).
var rc: Dictionary = RaceControl.green_state(0)
var green_until := 0.0
var sc_path = null
var sc_park = null
var sc = null # {visual, body, s, speed, vel, visible, solid}
var last_contact := {}
var hit_at := {}
var fuel_per_lap := 0.0
var fuel_at_lap = null
var flagged := false
var pit: PitLaneMonitor = null
var pit_menu = null
var pit_hold := false
var service = null
var jack_lift := 0.0
var loc := {"s": 0.0, "dot": 1.0, "index": 0, "lateral": 0.0}
var map_timer := 0.0
var rel_hints := {}
var spot := {"left": false, "right": false, "aheadS": null, "behindS": null}
var countdown_shown := ""
var spec_target := ""
var spec_cam := Camera3D.new()
var spec_cam_init := false
var tv_view := false
var spec_tv := true
var pit_cam := Camera3D.new()
var pit_cam_on := false
var pit_cam_t := 0.0

# optional subsystems, attached by their modules
var cinematic = null
var snd = null
var radio = null
var tv = null
var tv_on := false
var crews = null
var racing_line = null
var road_wear = null
var mirror = null
var windshield = null
var dash = null
var crash_fx = null
var forest = null
var shells = null
var blades = null
var perf = null
var timing: TimingScreen
var rs := {"flag": "", "pitDue": false, "fuelLow": false, "fuelCrit": false, "tyresCold": false, "rain": false, "mins": {}, "spotL": false, "spotR": false, "aheadPit": "", "behindPit": "", "leader": "", "lastPos": 0, "startPos": 0, "gapAhead": null, "gapBehind": null, "checked": false}

var _acc_time := 0.0

func _init(race_setup: Dictionary, room_snapshot: Dictionary, my_id: String, cars: Dictionary, connection: Connection, callbacks: Dictionary, watching: bool = false) -> void:
	race = race_setup
	room = room_snapshot
	me = my_id
	cars_file = cars
	conn = connection
	cb = callbacks
	spectator = watching
	name = "race_session"
	kb = KeyboardInput.new(Settings.data.bindings)
	for p in room.players:
		names[p.id] = p.nick
		if p.get("num") != null:
			numbers[p.id] = p.num
	contact = bool(race.get("rules", {}).get("contact", false)) and not spectator

func car_number(id: String):
	return numbers.get(id)

## An incident (iRacing's points: off track 1, a wall 2, contact or a reset 4).
func incident(points: int) -> void:
	career.incidents += points
	career.lapIncidents += points

## What this session gave the career (read before the session is disposed).
func career_stats() -> Dictionary:
	var c := career
	var turns = track_data.get("turns")
	return {"km": c.km, "laps": c.laps, "cleanLaps": c.cleanLaps, "corners": c.laps * (turns if turns != null else 12), "incidents": c.incidents, "personalBests": c.pbs}

## The race's laps: set, or for a timed race what fits in its time at a GT3's pace here.
func race_laps() -> int:
	var ms: float = race.get("raceMs", 0)
	if ms <= 0.0:
		return race.laps
	var lap_ms: float = (track_data.length / 43.0) * 1000.0
	return maxi(1, ceili(ms / lap_ms) + 1)

## A timed race's pit window (server ms, when the pit entry must be crossed), or null.
func pit_window_ms():
	var ms: float = race.get("raceMs", 0)
	if ms == 0.0 or start_at == null or not race.get("rules", {}).get("pitWindow", false):
		return null
	return {"open": start_at + ms * RaceTracker.PIT_WINDOW.timedOpenShare, "close": start_at + ms * RaceTracker.PIT_WINDOW.timedCloseShare}

func remote_by_id(id: String) -> Remote:
	for r in remotes.values():
		if r.id == id:
			return r
	return null

func flash(msg: String, ms: float = 2500.0) -> void:
	message = msg
	message_until = Time.get_ticks_msec() + ms

# ------------------------------------------------------------ loading ---

## progress: Callable(loaded: float, total: float, label: String). Async: await it.
func load_session(progress: Callable) -> void:
	progress.call(0.0, 1.0, I18n.t("Starting physics"))
	CarVisual.car_lod_scale = float(Settings.quality_config().carLodScale)
	track_data = Assets.load_track_file(race.trackId)
	var entries := {}
	for c in cars_file.cars:
		entries[c.id] = c
	var racers: Array = race.grid.map(func(id): return {"id": id, "player": _player(id)})
	var my_car_id = null
	if spectator:
		for r in racers:
			var pl = r.player
			if pl != null and pl.carId != null and entries.has(pl.carId):
				my_car_id = pl.carId
				break
		if my_car_id == null:
			my_car_id = cars_file.cars[0].id
	else:
		var mp = _player(me)
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
	add_child(env)
	track.apply_quality(q)

	# my car
	await step.call(I18n.t("Placing the cars on the grid"))
	var slot: int = race.slots.get(me, 0)
	var grid: Dictionary = track_data.grid[slot] if slot < track_data.grid.size() else track_data.grid[0]
	# the setup chosen in the lobby (wing, brake balance) changes the car's specs for the physics
	var tuned := CarSetup.apply_setup(my_entry, Settings.data.carSetup)
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
	vehicle.fit_tyres(Tyres.COMPOUNDS.get(tyre_id, Tyres.COMPOUNDS[Tyres.compound_for_weather(weather.wetness)]), vehicle.ambient_c + 12.0)
	fuel_per_lap = (float(track_data.length) / 1000.0) * VehicleConsts.FUEL.perKm
	if race.get("rules", {}).get("fuel", false):
		vehicle.set_fuel(Settings.data.carSetup.fuelL)
	var with_cockpit: bool = bool(q.cockpitDetail) and my_entry.get("cockpit") != null
	var my_model := Assets.load_car_model(my_entry, 1, bool(q.cockpitDetail))
	var outside = Assets.load_car_model(my_entry, 1, false).lods[0] if with_cockpit else null
	my_visual = CarVisual.new(my_entry, my_model, true, outside)
	vehicle.add_child(my_visual)
	InputState.wheel.carLockDeg = float(SteeringLock.lock_deg(my_entry.id))
	if bool(q.ownHeadlightSpots):
		my_visual.add_headlights(bool(q.ownHeadlightShadows))
	else:
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
	for r in racers:
		if r.id == me:
			continue
		var pl = r.player
		if pl == null or pl.carId == null or not entries.has(pl.carId):
			continue
		var entry: Dictionary = entries[pl.carId]
		var model := Assets.load_car_model(entry, 3, false, 1)
		var rem := Remote.new()
		rem.id = r.id
		rem.slot = race.slots[r.id]
		rem.entry = entry
		rem.visual = CarVisual.new(entry, model, false)
		var g: Dictionary = track_data.grid[rem.slot] if rem.slot < track_data.grid.size() else track_data.grid[0]
		rem.visual.position = Vector3(g.p[0], g.p[1], g.p[2])
		rem.visual.rotation = Vector3(0, g.yaw, 0)
		add_child(rem.visual)
		rem.node = rem.visual
		remotes[rem.slot] = rem
	await step.call(I18n.t("Bringing out the other drivers"))
	var line = await RacingLinePrep.finish(line_task)
	if line != null:
		AiDriver.prime_racing_line(track_data, line)
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
		_build_pit_lane(entries)
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
	for p in room.players:
		hud.set_driver(p.id, p.get("country"), p.get("num"))
	timing = hud.timing
	if mirror != null:
		hud.add_child(mirror.rect)
		hud.move_child(mirror.rect, 0)
	if not spectator:
		var model_for_lines: PackedScene = Assets.load_car_model(my_entry, 1, false).lods[0]
		var lines: TopView.Lines = await TopView.render_top_lines(self, model_for_lines)
		hud.set_car(my_entry, lines)
		hud.set_damage_car(my_entry, lines)
	else:
		hud.set_spectating(true)
	_collect_env_materials()
	_apply_weather()
	await step.call(I18n.t("Compiling shaders"))
	await _warm_up()
	# network
	conn.message.connect(_on_message)
	conn.binary.connect(_on_binary)

func _player(id: String):
	for p in room.players:
		if p.id == id:
			return p
	return null

## The HUD layer: added by the app on a CanvasLayer (the session owns the Hud node but not where it lives).
func hud_node() -> Hud:
	return hud

func start() -> void:
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
	for p in snapshot.players:
		names[p.id] = p.nick
		if hud != null:
			hud.set_driver(p.id, p.get("country"), p.get("num"))
		if p.get("num") != null:
			numbers[p.id] = p.num
	# hide cars of players who left the room
	for r: Remote in remotes.values():
		var present := false
		for p in snapshot.players:
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
		mode = {"sessionMs": race.sessionMs}
	var tr := RaceTracker.new(track_data, start_ms, mode)
	tr.add_player(me)
	for r: Remote in remotes.values():
		if r.bot != null:
			tr.add_player(r.id)
	return tr

func toggle_pause(open = null) -> void:
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
# Each hook does its work when the module exists (the later ports fill them in), and nothing otherwise.

func _load_forest(q: Dictionary) -> void:
	forest = await Forest.load_forest(self, track, track_data, q)
	if forest != null:
		track.forest = forest

func _attach_world_extras(q: Dictionary) -> void:
	var crowd := Crowd.build(track, track_data, float(q.crowd))
	if crowd != null:
		add_child(crowd)

func _attach_my_car_extras(entry: Dictionary) -> void:
	if not spectator:
		mirror = RearMirror.new(vehicle, entry.dims)
		mirror.every = int(Settings.quality_config().mirrorEvery)
		add_child(mirror)
		dash = DashDisplays.new(my_visual)
		add_child(dash)
		crash_fx = CrashFx.new()
		add_child(crash_fx)

func _attach_line_extras(tuned: Dictionary) -> void:
	if not spectator:
		racing_line = RacingLineFx.new(track_data, tuned.specs, track.ground_query, air.airDensity)
		racing_line.set_mode(Settings.data.racingLine)
		add_child(racing_line)
	road_wear = RoadWear.new(track_data, tuned.specs, track.ground_query, air.airDensity)
	add_child(road_wear)

func _build_cinematic(entries: Dictionary) -> void:
	var entrants: Array = []
	for id in race.grid:
		var p = _player(id)
		var e = entries.get(p.carId) if p != null and p.carId != null else null
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

func _collect_env_materials() -> void:
	pass

func _warm_up() -> void:
	# the first frames compile the shaders: show everything once, behind the loading screen
	track.show_all()
	await get_tree().process_frame

func _set_view_camera(c: Camera3D) -> void:
	c.current = true

# ----------------------------------------------------------- networking ---

func _on_message(m: Dictionary) -> void:
	match m.t:
		"countdown":
			if m.raceId == race.raceId:
				set_start_at(m.startAt)
		"standings":
			if m.raceId != race.raceId:
				return
			standings = m.list
			finish_deadline = m.finishDeadline
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
				flash(I18n.t("DRIVE-THROUGH: {what} · serve it within 3 laps", {"what": what}) if mine else I18n.t("{name}: drive-through, {what}", {"name": pname, "what": what}), 6000.0 if mine else 3000.0)
			else:
				flash(I18n.t("+{s} s: {what}", {"s": "%.0f" % (m.ms / 1000.0), "what": what}) if mine else I18n.t("{name}: +{s} s, {what}", {"name": pname, "s": "%.0f" % (m.ms / 1000.0), "what": what}), 4000.0)
			if mine:
				_chime("invalid")
				_say("penalty_dt" if m.get("driveThrough", false) else "penalty_time", 2, {"key": "penalty", "cooldown": 8})
		"served":
			if m.playerId == me:
				flash(I18n.t("Mandatory stop done") if m.what == "stop" else I18n.t("Drive-through served"), 3000.0)
		"raceControl":
			if m.raceId == race.raceId:
				_on_race_control(m.state)
		"flag":
			if m.raceId != race.raceId:
				return
			flagged = true
			flash(I18n.t("CHEQUERED FLAG: session over") if pit != null and pit.in_lane else I18n.t("CHEQUERED FLAG: finish your lap, it still counts"), 5000.0)
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
				flash("%s%s" % [I18n.t("FINISHED") if race.kind == "race" else I18n.t("SESSION COMPLETE"), " · P%d" % pos if pos > 0 else ""], 8000.0)
				if race.kind == "race":
					_say("win" if pos == 1 else ("podium" if pos > 0 and pos <= 3 else ("points" if pos > 0 and pos <= 10 else "finish")), 3, {"ttl": 15})
				else:
					_say("pole" if pos == 1 else "session_end", 2, {"ttl": 15})
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
		flash(I18n.t("Out lap {time} (not timed) · timed lap starts now · Tab: timing", {"time": fmt_lap(m.lapMs)}), 4000.0)
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
	for s in standings:
		if s.id != me and s.bestLapMs != null and s.bestLapMs <= m.lapMs:
			session_best = false
	var tag := ""
	if not m.valid:
		tag = I18n.t("  ·  INVALID")
	elif m.best:
		tag = I18n.t("  ·  FASTEST LAP") if session_best else I18n.t("  ·  personal best")
	var pen := I18n.t("  ·  incl. +{s} s penalties", {"s": "%.1f" % (m.penaltyMs / 1000.0)}) if m.penaltyMs > 0 else ""
	flash(I18n.t("Lap {n}: {time}", {"n": m.lap - 1, "time": fmt_lap(m.lapMs)}) + tag + pen, 3500.0)
	if m.valid:
		_chime(("session-best" if session_best else "best") if m.best else "lap")
	if m.valid and m.best:
		_say("fastest_lap" if session_best else "personal_best", 1, {"key": "lap-best", "cooldown": 30})
	radio_lap()

func _chime(kind: String) -> void:
	if snd != null:
		snd.chime(kind)

func _say(line: String, priority: int, opts: Dictionary = {}) -> void:
	if radio != null:
		radio.say(line, priority, opts)

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
	flash(text, 5000.0)
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
	for i in dec.count:
		r.buffer.push(_relay_scratch[i], (dec.seq * Const.STATES_PER_PACKET + i) & 0xffff)

## Start of my current lap (server clock), from the local mirror of the lap logic.
func lap_start_ms() -> float:
	var p: RaceTracker.PlayerRaceState = local_tracker.players.get(me) if local_tracker != null else null
	if p != null:
		return p.lap_start_ms
	return start_at if start_at != null else 0.0

func update_timing() -> void:
	if timing == null or not timing.visible:
		return
	timing.update_list(standings, me, func(id: String) -> Dictionary:
		var p = _player(id)
		var car := CarsDb.by_id(p.carId) if p != null and p.carId != null else {}
		return {"nick": names.get(id, "?"), "car": car.get("name", ""), "colour": car.get("color", "#888888"), "bot": p != null and p.get("bot", false)})

static func fmt_lap(ms: float) -> String:
	var m := int(ms / 60000.0)
	var s := (ms - m * 60000.0) / 1000.0
	return "%d:%06.3f" % [m, s]

static func fmt_clock(ms: float) -> String:
	var t := maxi(0, ceili(ms / 1000.0))
	return "%d:%02d" % [t / 60, t % 60]

## Point on the car's bounding box in direction dir (car-local, horizontal).
static func box_point(dir: Vector3, car: Dictionary) -> Vector3:
	var hx: float = car.dims.width / 2.0
	var hz: float = car.dims.length / 2.0
	var kx: float = hx / absf(dir.x) if absf(dir.x) > 1e-6 else INF
	var kz: float = hz / absf(dir.z) if absf(dir.z) > 1e-6 else INF
	var k := minf(kx, kz) * 0.95
	return Vector3(dir.x * k, 0.55, dir.z * k)

static func zone_point(zone: int, car: Dictionary) -> Vector3:
	var hz: float = car.dims.length / 2.0
	var hx: float = car.dims.width / 2.0
	if zone == 0:
		return Vector3(0, 0.55, hz * 0.95)
	if zone == 1:
		return Vector3(0, 0.6, -hz * 0.95)
	if zone == 2:
		return Vector3(hx * 0.95, 0.6, 0)
	return Vector3(-hx * 0.95, 0.6, 0)

static func zone_dir(zone: int) -> Vector3:
	if zone == 0:
		return Vector3(0, 0, -1)
	if zone == 1:
		return Vector3(0, 0, 1)
	if zone == 2:
		return Vector3(-1, 0, 0)
	return Vector3(1, 0, 0)

## Signed distance from the centreline at index i (+ = left).
static func lateral_at(t: Dictionary, i: int, x: float, z: float) -> float:
	var cl: Array = t.centerline
	var j := (i + 1) % (cl.size() / 3)
	var tx: float = cl[j * 3] - cl[i * 3]
	var tz: float = cl[j * 3 + 2] - cl[i * 3 + 2]
	var l := Vector2(tx, tz).length()
	if l == 0.0:
		l = 1.0
	return ((x - cl[i * 3]) * tz - (z - cl[i * 3 + 2]) * tx) / l

## Copy a vehicle's state into a network sample. Returns the flags (without reset/smoke).
static func fill_state(s: CarState, v: Vehicle, server_now: float, headlights: bool) -> int:
	var t := v.global_position
	var q := v.global_transform.basis.get_rotation_quaternion()
	var lv := v.linear_velocity
	var av := v.angular_velocity
	s.t = roundf(server_now)
	s.px = t.x
	s.py = t.y
	s.pz = t.z
	s.qx = q.x
	s.qy = q.y
	s.qz = q.z
	s.qw = q.w
	s.vx = lv.x
	s.vy = lv.y
	s.vz = lv.z
	s.wx = av.x
	s.wy = av.y
	s.wz = av.z
	s.steer = v.steer_angle
	s.rot_f = v.wheels[0].angle
	s.rot_r = v.wheels[2].angle
	# a lowered car's wheels sit higher in the arches (ride height setup), as the others should see them
	for i in 4:
		s.susp[i] = clampf(v.wheels[i].compression - v.setup.ride[0 if i < 2 else 1], 0.0, 0.25)
	var f := 0
	if v.pedals.brake > 0.1 and not v.is_reverse():
		f |= CarState.FLAG_BRAKE
	if headlights:
		f |= CarState.FLAG_HEADLIGHTS
	if v.is_reverse():
		f |= CarState.FLAG_REVERSE
	if v.kbd.handbrake > 0.5:
		f |= CarState.FLAG_HANDBRAKE
	return f

# ------------------------------------------------------------- physics ---

func _physics_process(dt: float) -> void:
	if not running or vehicle == null:
		return
	var server_now := conn.server_now()
	var race_t: float = server_now - start_at if start_at != null else -INF
	# the keys, touch and pad into the controls of my car (the physics-step filters run inside the Vehicle)
	var controls := smoother.update(dt, kb, vehicle.telemetry.forwardSpeed, vehicle.is_reverse())
	if paused:
		controls.throttle = 0.0
		controls.steer = 0.0
	vehicle.controls = controls
	if spectator:
		vehicle.frozen = true
	step_bots(race_t)
	if contact:
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

## The cars simulated here (mine, the bots I run): [[id, vehicle], ...].
func simulated() -> Array:
	var out: Array = []
	if not spectator:
		out.append([me, vehicle])
	for r: Remote in remotes.values():
		if r.bot != null:
			out.append([r.id, r.bot.vehicle])
	return out

## The host simulates every bot: a Vehicle + AiDriver in this physics world.
func _create_local_bots(entries: Dictionary) -> void:
	var mp = _player(me)
	if mp == null or not mp.get("host", false):
		return
	for r: Remote in remotes.values():
		var p = _player(r.id)
		if p == null or not p.get("bot", false) or p.carId == null:
			continue
		var entry = entries.get(p.carId)
		if entry == null:
			continue
		var g: Dictionary = track_data.grid[r.slot] if r.slot < track_data.grid.size() else track_data.grid[0]
		var v := Vehicle.new()
		v.auto_step = true
		v.setup_car(entry, track.ground_query, AiDriver.BOT_ASSISTS.duplicate(), r.damage)
		add_child(v)
		v.place(g.p[0], g.p[1], g.p[2], g.yaw)
		v.frozen = true
		v.set_air(air.airC, air.trackC, air.airDensity)
		v.fit_tyres(Tyres.COMPOUNDS[Tyres.compound_for_weather(weather.wetness)], v.ambient_c + 12.0)
		if contact:
			v.set_contact(true)
		# fuel for the race and a little more (they refuel at a stop if a tank is not enough), 40 l for qualifying
		var per_lap: float = (float(track_data.length) / 1000.0) * VehicleConsts.FUEL.perKm
		if race.get("rules", {}).get("fuel", false):
			v.set_fuel(minf(VehicleConsts.FUEL.tankL, race_laps() * per_lap * 1.05 + 2.0) if race.kind == "race" else 40.0)
		var win := RaceTracker.pit_window_laps(race_laps())
		# skill and racing line differ per bot so they spread out (deterministic per slot); the player's AI difficulty
		# scales every bot's pace
		var skill: float = (0.88 + ((r.slot * 37) % 10) / 100.0) * float(Settings.data.ai.difficulty)
		var lane: float = (((r.slot * 7) % 5) - 2) * 0.45
		var b := LocalBot.new()
		b.vehicle = v
		b.ai = AiDriver.new(track_data, v, skill, lane)
		b.pit = PitLaneMonitor.new(track_data) if track_data.get("pitLane") != null else null
		# spread over the window so they don't all stop on the same lap
		b.stop_lap = win.open + (r.slot % (win.close - win.open + 1))
		r.bot = b
		# the stand-in node is the bot's own vehicle: its visual hangs from it
		r.visual.reparent(v, false)
		r.visual.position = Vector3.ZERO
		r.visual.rotation = Vector3.ZERO
		r.node = v
		if b.pit != null:
			b.pit.measure_boxes(wall_probe)
			var ab: Array = b.pit.boxes()[b.pit.box_of(r.slot)]
			b.ai.pit_box = roundi((ab[0] + ab[1]) / 2.0)
			b.ai.pit_box_shift = b.pit.shift_at(b.ai.pit_box)

## Distance to the circuit's walls (collision), horizontally from 0.8 m above (x, y, z): where the garages are.
var _wall_query := PhysicsRayQueryParameters3D.new()

func wall_probe(x: float, y: float, z: float, dx: float, dz: float, max_d: float):
	_wall_query.collision_mask = VehicleConsts.LAYER_WALL
	_wall_query.from = Vector3(x, y + 0.8, z)
	_wall_query.to = Vector3(x + dx * max_d, y + 0.8, z + dz * max_d)
	var hit := get_viewport().world_3d.direct_space_state.intersect_ray(_wall_query)
	if hit.is_empty():
		return null
	return _wall_query.from.distance_to(hit.position)

## The collision box of a car simulated elsewhere (the same box as a Vehicle's): its stand-in body.
func _make_proxy(r: Remote) -> RigidBody3D:
	var body := RigidBody3D.new()
	body.gravity_scale = 0.0
	body.can_sleep = false
	body.lock_rotation = true
	body.mass = float(r.entry.specs.massKg)
	body.collision_layer = VehicleConsts.LAYER_PROXY
	body.collision_mask = VehicleConsts.LAYER_CAR
	body.linear_damp_mode = RigidBody3D.DAMP_MODE_REPLACE
	body.linear_damp = 0.0
	body.contact_monitor = true
	body.max_contacts_reported = 8
	var H := minf(r.entry.dims.height, 1.3)
	var hy := maxf(0.22, (H * 0.8 - 0.3) / 2.0)
	var z_mid: float = (r.entry.wheels.FL.position[2] + r.entry.wheels.RL.position[2]) / 2.0
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(r.entry.dims.width * 0.88, hy * 2.0, r.entry.dims.length * 0.92)
	cs.shape = box
	cs.position = Vector3(0, 0.3 + hy, z_mid)
	body.add_child(cs)
	body.global_position = r.visual.position
	add_child(body)
	return body

## Contact rule, every physics step: the other cars' stand-ins towards where they are at that step's time (their
## velocity plus a pull onto the pose: PROXY_TAU_S). Velocities, not positions: the solver then shares a hit by the masses.
func move_kinematics(_dt: float) -> void:
	for r: Remote in remotes.values():
		var body := r.body
		if body == null:
			continue
		var o: Node3D = r.visual
		var tgt := o.global_position
		var p := body.global_position
		var e := tgt - p
		var hidden := not o.visible or not r.buffer.has_data()
		if hidden or e.length_squared() > PROXY_SNAP_M * PROXY_SNAP_M:
			body.global_position = tgt
			if not r.ghosted:
				body.collision_layer = 0
			r.ghosted = true
			r.set_v = r.vel
		else:
			if r.ghosted and clear_of_mine(tgt.x, tgt.z, 5.5):
				body.collision_layer = VehicleConsts.LAYER_PROXY
				r.ghosted = false
			var k := 1.0 / PROXY_TAU_S
			r.set_v = r.vel + Vector3(clampf(e.x * k, -PROXY_PULL_MS, PROXY_PULL_MS), clampf(e.y * k, -PROXY_PULL_MS, PROXY_PULL_MS), clampf(e.z * k, -PROXY_PULL_MS, PROXY_PULL_MS))
		body.linear_velocity = r.set_v
		body.global_transform.basis = o.global_transform.basis
	# the safety car's box follows its path (solid only on track)
	if sc != null and sc.body != null:
		if not sc.visible:
			if sc.solid:
				sc.body.collision_layer = 0
			sc.solid = false
		elif not sc.solid:
			var p2: Vector3 = sc.visual.global_position
			if cars_clear_of(p2.x, p2.z, 6.5):
				sc.body.global_transform = sc.visual.global_transform
				sc.body.collision_layer = VehicleConsts.LAYER_PROXY
				sc.solid = true
		else:
			sc.body.linear_velocity = sc.vel + (sc.visual.global_position - sc.body.global_position) / PROXY_TAU_S
			sc.body.global_transform.basis = sc.visual.global_transform.basis

## No car simulated here within r (m) of (x, z).
func clear_of_mine(x: float, z: float, r: float) -> bool:
	for sv in simulated():
		var p: Vector3 = sv[1].global_position
		if (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) < r * r:
			return false
	return true

## No car (mine, the bots, the others' boxes) within r (m) of (x, z).
func cars_clear_of(x: float, z: float, r: float) -> bool:
	var near := func(px: float, pz: float) -> bool: return (px - x) * (px - x) + (pz - z) * (pz - z) < r * r
	if not spectator and near.call(vehicle.global_position.x, vehicle.global_position.z):
		return false
	for o: Remote in remotes.values():
		var p: Vector3 = o.bot.vehicle.global_position if o.bot != null else o.visual.global_position
		if near.call(p.x, p.z):
			return false
	return true

## Contact rule, after each solver step: what a hit did to the cars simulated here is capped (CAR_CONTACT), and what the
## stand-ins took from them is added to the bump for their owners.
func after_contacts() -> void:
	var now := Time.get_ticks_msec() as float
	for sv in simulated():
		var v: Vehicle = sv[1]
		if v.has_method("_touching_car") and v._touching_car():
			hit_at[sv[0]] = now
	for r: Remote in remotes.values():
		var body := r.body
		if body == null or r.ghosted:
			continue
		var v := body.linear_velocity
		var dx := v.x - r.set_v.x
		var dz := v.z - r.set_v.z
		if dx * dx + dz * dz < 0.0025:
			continue
		for sv in simulated():
			var veh: Vehicle = sv[1]
			var touching := false
			for b in body.get_colliding_bodies():
				if b == veh:
					touching = true
			if not touching:
				continue
			var m: float = r.entry.specs.massKg
			var p := body.global_position
			var jx := m * dx
			var jz := m * dz
			r.bump.x += jx
			r.bump.z += jz
			# yaw from where it was hit: (contact - centre) x J
			var c := veh.global_position
			r.bump_yaw += ((c.z + p.z) / 2.0 - p.z) * jx - ((c.x + p.x) / 2.0 - p.x) * jz
			r.bump_from = sv[0]
			last_contact["%s|%s" % [sv[0], r.id]] = now
			break

## Contact rule: the impulses the other cars took here, to whoever simulates them (at most every BUMP_SEND_MS).
func send_bumps() -> void:
	var now := Time.get_ticks_msec() as float
	for r: Remote in remotes.values():
		if r.body == null or now - r.bump_sent < BUMP_SEND_MS:
			continue
		var j := Vector2(r.bump.x, r.bump.z).length()
		if j < BUMP_MIN:
			# a graze too light to send is dropped once it is old
			if now - r.bump_sent > 400.0:
				r.bump = Vector3.ZERO
				r.bump_yaw = 0.0
			continue
		var k := minf(1.0, Protocol.MAX_BUMP_IMPULSE / j)
		var cl := func(x: float) -> int: return roundi(clampf(x * k, -Protocol.MAX_BUMP_IMPULSE, Protocol.MAX_BUMP_IMPULSE))
		var msg := {"t": "bump", "to": r.id, "ix": cl.call(r.bump.x), "iy": 0, "iz": cl.call(r.bump.z), "ty": cl.call(r.bump_yaw)}
		if r.bump_from != me:
			msg["from"] = r.bump_from
		conn.send_json(msg)
		r.bump = Vector3.ZERO
		r.bump_yaw = 0.0
		r.bump_sent = now

## Another car's owner saw it hit one of the cars simulated here, and this world did not: the hit, applied now.
func _on_bump(m: Dictionary) -> void:
	if not contact:
		return
	var v: Vehicle = null
	if m.to == me:
		v = null if spectator else vehicle
	else:
		var rr := remote_by_id(m.to)
		if rr != null and rr.bot != null:
			v = rr.bot.vehicle
	if v == null:
		return
	if Time.get_ticks_msec() - last_contact.get("%s|%s" % [m.to, m["from"]], -1e9) < BUMP_DEDUPE_MS:
		return
	v.apply_central_impulse(Vector3(m.ix, 0, m.iz))
	v.apply_torque_impulse(Vector3(0, m.ty, 0))
	hit_at[m.to] = Time.get_ticks_msec()
	if v == vehicle:
		var j := Vector2(m.ix, m.iz).length()
		if j > 1.0:
			impact_damage(j * 0.6, Vector3(m.ix / j, 0, m.iz / j), true)

## Cars sunk under the road are put back on it (mine and the bots I run).
func rescue_cars() -> void:
	for sv in simulated():
		sv[1].rescue_below_ground()

## Touched by another car in the last second (FLAG_HIT: the tracker waives what follows a hit).
func recently_hit(id: String) -> bool:
	return Time.get_ticks_msec() - hit_at.get(id, -1e9) < 1000.0

## Contact force events -> damage on my car.
func drain_contacts() -> void:
	for ev in vehicle.consume_impacts():
		# only walls and barriers damage the car; touching the road or grass never does (with the contact rule, other
		# cars too: a box that can't give way hits harder than a car that would, so less)
		var other = ev.other
		var is_car: bool = other is Vehicle or (other is CollisionObject3D and (other.collision_layer & VehicleConsts.LAYER_PROXY) != 0)
		var is_wall: bool = other != null and other.has_meta("surface") and other.get_meta("surface") == "wall"
		if not is_car and not is_wall:
			continue
		var imp: Vector3 = ev.impulse
		var impulse := imp.length() * (0.6 if is_car else 1.0)
		# rubbing a wall: the scrape, for as long as the contact lasts
		if not is_car and vehicle.telemetry.speed > 2.0 and snd != null:
			snd.scrape(impulse / (vehicle.mass * 7.0))
		impact_damage(impulse, imp.normalized(), is_car)

## A hit on my car: impulse (N*s) pushing it along push (world, unit). Damage, dents, sound, rumble.
func impact_damage(impulse: float, push: Vector3, is_car: bool = false) -> void:
	var local := vehicle.global_transform.basis.inverse() * push
	var flats: int = damage.punctured.count(true)
	var res := damage.impact(impulse, -local.x, -local.z, vehicle.mass)
	if res.is_empty():
		return
	incident(4 if is_car else 2)
	var sev := minf(1.0, impulse / (vehicle.mass * 7.0))
	if damage.punctured.count(true) > flats:
		flash(I18n.t("Puncture! Bring it back to the pits"), 3500.0)
		if snd != null:
			snd.impact(1.0)
		_say("puncture", 3, {"key": "damage", "cooldown": 6})
	else:
		var z := damage.zones
		var line := ""
		if sev > 0.85:
			line = "big_crash"
		elif z[4] > 0.25 and res.zone <= 1:
			line = "damage_engine"
		elif maxf(maxf(damage.corners[0], damage.corners[1]), maxf(damage.corners[2], damage.corners[3])) > 0.15:
			line = "damage_susp"
		elif res.zone == 0 and z[0] > 0.15:
			line = "damage_front"
		elif res.zone == 1 and z[1] > 0.15:
			line = "damage_rear"
		if line != "":
			_say(line, 2, {"key": "damage", "cooldown": 20, "ttl": 5})
	if snd != null:
		snd.impact(sev)
	Gamepad.rumble(impulse / (vehicle.mass * 5.0))
	var loc_dir := Vector3(-local.x, 0, -local.z).normalized()
	var p := box_point(loc_dir, vehicle.car)
	my_visual.dent(p, -loc_dir, res.amount * 2.0)
	# sparks and debris where it hit, and the driver's head thrown away from the hit
	var world := vehicle.global_transform * p
	if crash_fx != null:
		var wh := vehicle.wheels
		var ground_y := 0.0
		for w in wh:
			ground_y += w.cp.y
		ground_y /= wh.size()
		crash_fx.hit(world, sev, vehicle.linear_velocity, Vector3(push.x, 0, push.z), ground_y, Color(my_visual.entry.color))
	cockpit.jolt(-loc_dir.x * sev * 0.9, sev * 0.25, -loc_dir.z * sev * 0.9)
	vehicle.drivetrain.power_scale = damage.power_scale()

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

func _round_zones() -> Array:
	var out: Array = []
	for z in damage.zones:
		out.append(roundf(z * 100.0) / 100.0)
	return out

## Live delta to my best valid lap, driven by the local mirror of the lap logic (no network delay).
func update_lap_delta(now_ms: float, ev: Array) -> void:
	var tr: RaceTracker.PlayerRaceState = local_tracker.players.get(me) if local_tracker != null else null
	if tr == null:
		return
	if lap_delta == null:
		lap_delta = LapDelta.new(track_data.length)
	var d := lap_delta
	for e in ev:
		if e.type == "lap":
			if e.valid and e.best:
				d.commit_best()
			ghost.lap_ended(e.valid and e.best)
			if e.valid and e.best:
				ensure_ghost_visual()
			d.start()
		elif e.type == "penalty" and e.playerId == me and e.ms == 0:
			# the lap deleted (practice / qualifying), a warning, or off without gaining anything
			var gained := I18n.t(" (gained {s} s)", {"s": "%.1f" % (e.gainMs / 1000.0)}) if e.get("gainMs", 0) != 0 else ""
			var text: String
			if e.get("contact", false):
				text = I18n.t("Hit by another car: no penalty")
			elif e.get("invalidated", false):
				if e.reason == "reset":
					text = I18n.t("Reset: lap time deleted")
				elif e.get("gainMs", 0) != 0 or e.reason == "shortcut":
					text = I18n.t("Corner cut: lap time deleted") + gained
				else:
					text = I18n.t("Track limits: lap time deleted")
			elif e.get("blackWhite", false):
				text = I18n.t("Black and white flag: track limits, last warning")
			elif e.get("warning", 0) != 0:
				text = I18n.t("Track limits: warning {n} of {max}", {"n": e.warning, "max": RaceTracker.PENALTY.limitsWarnings})
			else:
				text = I18n.t("Off track: lost time, no strike")
			flash(text, 3200.0 if e.get("invalidated", false) or e.get("blackWhite", false) else 2200.0)
			if e.get("warning", 0) != 0 or e.get("invalidated", false):
				_chime("invalid")
			if not e.get("contact", false) and (e.get("warning", 0) != 0 or e.get("invalidated", false) or e.get("blackWhite", false)):
				incident(1)
			if e.get("invalidated", false):
				_say("lap_deleted", 2, {"key": "limits", "cooldown": 15})
			elif e.get("warning", 0) != 0 or e.get("blackWhite", false):
				_say("limits_warning", 1, {"key": "limits", "cooldown": 15})
		elif e.type == "penalty" and e.playerId == me:
			var s := "%.0f" % (e.ms / 1000.0)
			var text2: String
			if e.has("gainMs"):
				text2 = I18n.t("Left the track and gained an advantage: +{s} s", {"s": s}) + I18n.t(" (gained {g} s)", {"g": "%.1f" % (e.gainMs / 1000.0)})
			elif e.reason == "track-limits":
				text2 = I18n.t("Track limits: +{s} s", {"s": s})
			elif e.reason == "reset":
				text2 = I18n.t("Reset: +{s} s penalty", {"s": s})
			else:
				text2 = I18n.t("Shortcut: +{s} s penalty", {"s": s})
			flash(text2, 3200.0)
			_chime("invalid")
			_say("penalty_time", 2, {"key": "penalty", "cooldown": 8})
	if tr.passed < 0 or tr.laps == 0:
		live_delta = null
		return
	var lap_dist: float = tr.race_dist - tr.laps * float(track_data.length)
	var lap_ms: float = now_ms - tr.lap_start_ms
	var q := vehicle.global_transform.basis.get_rotation_quaternion()
	if not tr.out_lap and not tr.in_pit:
		ghost.record(lap_ms, vehicle.global_position, q)
	else:
		ghost.abort_lap()
	d.record(lap_dist, lap_ms)
	live_delta = d.delta(lap_dist, lap_ms)

# ---------------------------------------------------------------- bots ---

## AI cars, simulated on the host. As in a real qualifying session they leave one at a time (BOT_RELEASE_MS apart, in
## grid order) instead of all launching side by side onto the same line, and they keep their distance behind a car
## directly ahead.
func step_bots(race_t: float) -> void:
	var bots: Array = remotes.values().filter(func(r): return r.bot != null)
	bots.sort_custom(func(a, b): return a.slot < b.slot)
	for order in bots.size():
		var r: Remote = bots[order]
		var b := r.bot
		# qualifying: one at a time; the race: everyone at the green light
		var started: bool = race_t >= (0.0 if race.kind == "race" else order * BOT_RELEASE_MS)
		b.vehicle.frozen = not started or b.service_end > 0.0
		var tr: RaceTracker.PlayerRaceState = local_tracker.players.get(r.id) if local_tracker != null else null
		var gates: Array = track_data.gates
		var cp := -1.0
		if tr != null and tr.passed >= 0:
			cp = gates[posmod(tr.next_gate - 1 + gates.size(), gates.size())].s
		var cap := follow_cap(r) if started else INF
		var c := b.ai.update(FIXED_DT, started, b.vehicle.weather_grip * b.vehicle.tyre_grip_avg(), cp, cap)
		b.vehicle.controls = c

## Traffic for a bot: a slower car ahead in its lane makes it pull out and pass, keeping to that side until the car
## is behind it; it only lifts when it is about to run into one before it has moved over. Returns the speed cap.
func follow_cap(r: Remote) -> float:
	var b := r.bot
	var v := b.vehicle
	var p := v.global_position
	var fb := v.global_transform.basis.z
	var fx := fb.x
	var fz := fb.z
	var my_speed: float = v.telemetry.speed
	var cap := INF
	var block := {}
	var beside := false
	var check := func(op: Vector3, speed: float, ofx: float, ofz: float) -> void:
		# not the same piece of road: a car on the other leg of a hairpin or on a bridge / underpass looked like a car
		# ahead; a stopped car is avoided whichever way
		if absf(op.y - p.y) > 2.5 or (speed > 5.0 and ofx * fx + ofz * fz < 0.3):
			return
		var dx := op.x - p.x
		var dz := op.z - p.z
		var along := dx * fx + dz * fz
		var lat := dx * fz - dz * fx # + = left of the bot
		# alongside on the side we moved to: hold that side until it is behind us
		if along > -6.0 and along <= 3.0 and absf(lat) < 3.4:
			beside = true
		if along <= 0.0 or along > 40.0 or absf(lat) > 2.6:
			return
		# in our path (narrower once we are pulling out): keep about 10 m, back off if closer
		if absf(lat) < (1.6 if b.ai.pass_target != 0.0 else 2.2):
			cap = minf(cap, maxf(0.0, speed + (along - 10.0) * 0.7))
		if along <= 3.0 or (speed > my_speed - 1.5 and along > 14.0):
			return # as fast as us and not close: just follow
		if block.is_empty() or along < block.along:
			block = {"along": along, "lat": lat}
	for o: Remote in remotes.values():
		if o == r:
			continue
		var node: Node3D = o.bot.vehicle if o.bot != null else o.visual
		var ob := node.global_transform.basis.z
		check.call(node.global_position, o.vel.length(), ob.x, ob.z)
	if not spectator:
		var mb := vehicle.global_transform.basis.z
		check.call(vehicle.global_position, vehicle.telemetry.speed, mb.x, mb.z)
	# the safety car: queue behind it, seen from far enough to stop behind it
	if sc != null and sc.visible:
		var trp: RaceTracker.PlayerRaceState = local_tracker.players.get(r.id) if local_tracker != null else null
		var gap := TrackMath.wrap_delta(trp.progress_s, sc.s, track_data.length) if trp != null else -1.0
		if gap > 0.0 and gap < 220.0:
			cap = minf(cap, sqrt(sc.speed * sc.speed + 2.0 * 7.0 * maxf(0.0, gap - 18.0)))
	# no overtaking under a caution (FCY, safety car, a yellow flag here): follow instead
	var prog: float = local_tracker.players[r.id].progress_s if local_tracker != null and local_tracker.players.has(r.id) else -1e9
	var caution: bool = rc.course != "green" or in_yellow(prog)
	var found := {} if caution else block
	if not found.is_empty() and (b.ai.pass_target != 0.0 or b.ai.can_pass()):
		# pass on the side away from it (it is left of us -> go right), else keep the side already chosen
		if b.ai.pass_target == 0.0:
			b.ai.pass_target = -PASS_OFFSET if found.lat > 0.3 else (PASS_OFFSET if found.lat < -0.3 else b.ai.roomy_side() * PASS_OFFSET)
		b.pass_hold = 1.0
	elif beside and b.ai.pass_target != 0.0:
		b.pass_hold = 1.0
	else:
		b.pass_hold -= FIXED_DT
		if b.pass_hold <= 0.0:
			b.ai.pass_target = 0.0
	return cap

func sample_bots(server_now: float) -> void:
	for r: Remote in remotes.values():
		var b := r.bot
		if b == null:
			continue
		var s: CarState = b.pending[b.pending_count]
		var f := fill_state(s, b.vehicle, server_now, headlights_on)
		if b.reset_flag_samples > 0:
			f |= CarState.FLAG_RESET
			b.reset_flag_samples -= 1
		# a reset the AI asked for travels as the reset flag
		if b.ai.reset_requested:
			b.ai.reset_requested = false
			f |= CarState.FLAG_RESET
		# track limits, judged here like a player's (the server only sees the flag)
		b.hint = TrackMath.nearest_centerline_index(track_data, s.px, s.py, s.pz, b.hint, 30)
		var lat := lateral_at(track_data, b.hint, s.px, s.pz)
		if b.limits.update(1.0 / Const.STATE_HZ, TrackLimits.beyond_limits_now(b.vehicle, track_data, b.hint, lat)):
			f |= CarState.FLAG_OFF_TRACK
		if recently_hit(r.id):
			f |= CarState.FLAG_HIT
		s.flags = f
		if local_tracker != null:
			local_tracker.ingest(r.id, s.t, s.px, s.py, s.pz, (f & CarState.FLAG_RESET) != 0, [], (f & CarState.FLAG_OFF_TRACK) != 0, (f & CarState.FLAG_HIT) != 0)
		b.pending_count += 1
		if b.pending_count >= Const.STATES_PER_PACKET:
			conn.send_binary(CarState.encode_bot_states(r.slot, b.seq, b.pending, b.pending_count))
			b.seq = (b.seq + 1) & 0xffff
			b.pending_count = 0

## A yellow flag waved at lap distance s.
func in_yellow(s: float) -> bool:
	var L: float = track_data.length
	for y in rc.yellows:
		if TrackMath.wrap_delta(y[0], s, L) >= 0.0 and TrackMath.wrap_delta(s, y[1], L) >= 0.0:
			return true
	return false

func ensure_ghost_visual() -> void:
	if ghost_visual != null or ghost_loading or not Settings.data.ghost:
		return
	ghost_loading = true
	var entry: Dictionary = vehicle.car
	var model := Assets.load_car_model(entry, 3, false)
	var v := CarVisual.new(entry, model, false)
	v.set_opacity(0.3)
	v.visible = false
	add_child(v)
	ghost_visual = v

# --------------------------------------------------------------- frame ---

func _input(e: InputEvent) -> void:
	kb.process_event(e)
	if spectator and e is InputEventKey and e.pressed and not e.echo:
		_on_spectator_key(e)
	if cinematic != null and e is InputEventKey and e.pressed and (e.keycode == KEY_ENTER or e.keycode == KEY_SPACE or e.keycode == KEY_ESCAPE):
		cinematic.skip()
		get_viewport().set_input_as_handled()

func _process(dt: float) -> void:
	if not running or vehicle == null:
		return
	dt = minf(dt, MAX_FRAME_DT)
	var server_now := conn.server_now()
	var race_t: float = server_now - start_at if start_at != null else -INF
	handle_keys(server_now)

	# countdown & start lights
	if start_at == null or race_t < 0.0:
		vehicle.frozen = true
		update_countdown(null if start_at == null else -race_t)
	elif not spectator and server_now >= freeze_until and vehicle.frozen and race_t >= 0.0 and not pit_hold:
		vehicle.frozen = false
		update_countdown(-1.0)
		if my_laps == 0 and race_t < 2000.0:
			flash(_start_hint(), 7000.0)
	elif race_t < 1500.0:
		update_countdown(-1.0)
	else:
		clear_countdown()
	if spectator:
		vehicle.frozen = true

	# weather (deterministic from seed + race clock)
	weather_timer -= dt
	if weather_timer <= 0.0:
		weather_timer = 0.25
		weather = Weather.weather_at(race.weather, maxf(0.0, race_t / 1000.0))
		_apply_weather()

	update_safety_car(server_now, dt)
	if contact:
		send_bumps()

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
	my_visual.update_smoke(dt, damage.zones[4], self)

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
	var cine = cinematic
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
		var tt = tv_target()
		var cams = tv_cameras() if tt != null else null
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

	# the other drivers' cars
	for r: Remote in remotes.values():
		update_remote(r, server_now, dt, cam_pos)

	# environment
	env.update(dt, weather, view_cam, vehicle.global_position, car_vel)
	if crash_fx != null:
		crash_fx.update(dt)
	# aerial shots see the whole circuit: distance culling (meant for the cockpit) would leave holes
	var q := Settings.quality_config()
	if cinematic != null and cinematic.aerial:
		track.show_all()
		if forest != null:
			forest.update(cam_pos, q)
	else:
		track.update_visibility(cam_pos, q)
	if windshield != null and not spectator:
		windshield.update_fx(dt, weather.rain, v.telemetry.speed, get_viewport().get_visible_rect().size.aspect(), 1.0 - env.night * 0.8, cockpit.looking_forward and not outside and not pit_cam_on and not tv_on)
		windshield.set_crack(damage.zones[0], cockpit.looking_forward and not outside and not pit_cam_on and not tv_on)
	if shells != null:
		shells.update_shells(cam_pos, q, cinematic != null and cinematic.aerial)
	if blades != null:
		blades.update_blades(cam_pos, 0.0 if cinematic != null and cinematic.aerial else float(q.grassBladeRadius))
	update_audio(dt, view_cam)
	update_wake()
	update_ghost(server_now)

	update_race_ui(server_now, race_t, dt)
	update_pit(server_now)
	update_limiters(server_now)
	update_bot_pits(server_now)
	update_crews(dt, cam_pos)
	kb.end_frame()
	if mirror != null:
		mirror.visible = Settings.data.mirror and cinematic == null and not tv_on and cockpit.looking_forward and not kb.held("lookBack")

func _start_hint() -> String:
	if race.kind == "race":
		if race.get("raceMs", 0) > 0:
			return I18n.t("Race: {min} minutes from a standing start; the leader takes the flag on the first lap after the time is up.", {"min": roundi(race.raceMs / 60000.0)})
		return I18n.t("Race: {n} laps from a standing start. Go at the green light; penalties are added to your race time.", {"n": race.laps})
	if race.kind == "practice":
		return I18n.t("Free practice: {min} minutes to learn the track and try your setup. Nothing is decided here.", {"min": roundi(race.sessionMs / 60000.0)})
	return I18n.t("Qualifying: {min} minutes to set your best lap (clock at the top). Out lap first: warm the tyres, timing starts at the line.", {"min": roundi(race.sessionMs / 60000.0)})

func handle_keys(server_now: float) -> void:
	var show_timing := kb.held("timing")
	if timing != null and show_timing != timing.visible:
		timing.set_shown(show_timing)
		if show_timing:
			update_timing()
	if kb.tapped("pause"):
		toggle_pause()
	if paused:
		return
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
	if kb.tapped("toggleGearbox"):
		Settings.data.manualGearbox = not Settings.data.manualGearbox
		vehicle.drivetrain.manual = bool(Settings.data.manualGearbox)
		flash(I18n.t("Manual gearbox") if Settings.data.manualGearbox else I18n.t("Automatic gearbox"), 1500.0)
	if kb.tapped("resetCar"):
		request_reset()
	if freeze_until > 0.0 and server_now >= freeze_until and start_at != null and server_now >= start_at and not pit_hold:
		vehicle.frozen = false
		freeze_until = 0.0

func update_countdown(ms_left) -> void:
	var text := ""
	var sub := ""
	if ms_left == null:
		# during the cinematic a quiet line is enough
		text = "" if cinematic != null else I18n.t("Waiting for drivers")
		sub = I18n.t("Everyone is loading the race…")
		track.set_start_lights(false, false)
	elif ms_left > 3000.0:
		track.set_start_lights(false, false)
	elif ms_left > 0.0:
		text = str(ceili(ms_left / 1000.0))
		track.set_start_lights(true, false)
	else:
		text = "GO"
		track.set_start_lights(false, true)
	var key := "%s|%s" % [text, sub]
	if key != countdown_shown:
		countdown_shown = key
		if cb.has("on_countdown_text"):
			cb.on_countdown_text.call(text, sub)
		if snd != null:
			if text == "3" or text == "2" or text == "1":
				snd.beep(false)
			elif text == "GO":
				snd.beep(true)

func clear_countdown() -> void:
	if countdown_shown == "|":
		return
	countdown_shown = "|"
	if cb.has("on_countdown_text"):
		cb.on_countdown_text.call("", "")

func _apply_weather() -> void:
	var w := weather
	# grip of the fitted compound for the water on the track (slicks aquaplane, wets bite)
	vehicle.weather_grip = Tyres.compound_grip(vehicle.compound, w.wetness, w.rain)
	# rubber builds on the racing line through the session (the same clock everywhere)
	var rubber := VehicleConsts.track_rubber(conn.server_now() - start_at if start_at != null else 0.0, w.wetness)
	vehicle.rubber = rubber
	vehicle.wetness = w.wetness
	# air and track temperature, air density: the tyres, brakes, aero and engines (shared, so all clients agree)
	air = Weather.temperatures(race.weather, w, track_data.map)
	vehicle.set_air(air.airC, air.trackC, air.airDensity)
	for r: Remote in remotes.values():
		if r.bot == null:
			continue
		var bv := r.bot.vehicle
		bv.weather_grip = Tyres.compound_grip(bv.compound, w.wetness, w.rain)
		bv.rubber = rubber
		bv.wetness = w.wetness
		bv.set_air(air.airC, air.trackC, air.airDensity)
	if env != null:
		track.set_night(env.night)
		headlights_on = env.night > 0.3 or w.fog > 0.45 or w.rain > 0.4 or (env.sun_elevation < 0.08 and w.clouds > 0.6)
	vehicle.drivetrain.power_scale = damage.power_scale()
	track.apply_wetness(w.wetness)
	if road_wear != null:
		road_wear.set_wetness(w.wetness)

## The other drivers' cars where they are now (a human's from its buffer, a bot's from its vehicle).
func update_remote(r: Remote, server_now: float, dt: float, cam_pos: Vector3) -> void:
	if r.bot != null:
		var b := r.bot
		var v := b.vehicle
		r.vel = v.linear_velocity
		var susp := [0.0, 0.0, 0.0, 0.0]
		for i in 4:
			susp[i] = clampf(v.wheels[i].compression, 0.0, 0.25) - 0.02
		r.visual.wheel_out = r.visual.wheel_out
		r.visual.position = Vector3(0, b.lift, 0)
		r.visual.set_pose(v.steer_angle, v.wheels[0].angle, v.wheels[2].angle, susp)
		r.visual.set_lights(v.pedals.brake > 0.1 and not v.is_reverse(), headlights_on, env.night)
		r.visual.update_smoke(dt, 0.0, self)
		var d := r.visual.global_position.distance_to(cam_pos)
		r.visual.set_opacity(1.0 if cinematic != null or contact else clampf((d - 2.5) / 6.0, 0.15, 1.0))
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
	o.update_smoke(dt, maxf(0.6, r.damage.zones[4]) if (s.flags & CarState.FLAG_SMOKE) != 0 else 0.0, self)
	# ghost: fade out when very close to the camera so it never blocks the cockpit view
	var dd := o.global_position.distance_to(cam_pos)
	var fade := 1.0 if cinematic != null or contact or (spectator and r.id == spec_target) else clampf((dd - 2.5) / 6.0, 0.15, 1.0)
	o.set_opacity(0.35 if s.stale_ms > 5000.0 else fade)

## The ghost car: your best lap replayed.
func update_ghost(server_now: float) -> void:
	var gv := ghost_visual
	if gv == null:
		return
	var tr: RaceTracker.PlayerRaceState = local_tracker.players.get(me) if local_tracker != null else null
	var on: bool = Settings.data.ghost and tr != null and not tr.out_lap and not tr.in_pit and finished_ms == null
	if not on:
		gv.visible = false
		return
	var pose := ghost.pose(server_now - tr.lap_start_ms)
	if pose.is_empty():
		gv.visible = false
		return
	gv.visible = true
	gv.global_transform = Transform3D(Basis(pose.q), pose.p)
	# fade out when it overlaps your car, like the other ghosts
	gv.set_opacity(clampf((gv.global_position.distance_to(cockpit.world_position()) - 2.5) / 8.0, 0.05, 0.3))

## Slipstream for my car and the bots I simulate, from every car's position and velocity.
func update_wake() -> void:
	wake_cars.clear()
	for r: Remote in remotes.values():
		if r.visual.visible:
			wake_cars.append({"pos": r.visual.global_position, "vel": r.vel})
	wake_cars.append({"pos": vehicle.global_position, "vel": vehicle.linear_velocity})
	var apply := func(v: Vehicle, pos: Vector3, vel: Vector3) -> void:
		var others: Array = wake_cars.filter(func(c): return c.pos != pos)
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
		var a = cb.get("audio", Callable()).call() if cb.has("audio") else null
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
		"myVel": vehicle.linear_velocity, "vehicle": vehicle, "others": others, "rain": weather.rain, "day": 1.0 - env.night,
	})

# ------------------------------------------------------------ cameras ---

func cycle_camera() -> void:
	var modes: Array = Settings.CAMERA_MODES
	var i := modes.find(Settings.data.camera)
	Settings.data.camera = modes[(i + 1) % modes.size()]
	Settings.save()
	chase.reset()
	flash(I18n.t({"cockpit": "Cockpit camera", "chase": "Chase camera", "far": "Far chase camera"}[Settings.data.camera]), 1200.0)

func tv_wanted() -> bool:
	if spectator:
		return spec_tv
	# after the chequered flag the broadcast takes over, as F1 / GT games show your in-lap
	return tv_view or (finished_ms != null and race.kind == "race")

func toggle_tv() -> void:
	tv_view = not tv_view
	if tv != null:
		tv.reset()
	flash(I18n.t("TV cameras") if tv_view else I18n.t({"cockpit": "Cockpit camera", "chase": "Chase camera", "far": "Far chase camera"}[Settings.data.camera]), 1200.0)

## Placed the first time they are wanted: a sightline check per tower against the circuit's collision.
func tv_cameras():
	if tv != null:
		return tv
	if not ResourceLoader.exists("res://scripts/game/tv_cameras.gd"):
		return null
	var cast_sight := func(a: Vector3, b: Vector3):
		var d := a.distance_to(b)
		if d < 0.01:
			return null
		var q := PhysicsRayQueryParameters3D.create(a, a.move_toward(b, maxf(0.0, d - 3.0)), VehicleConsts.RAY_MASK)
		var hit := get_viewport().world_3d.direct_space_state.intersect_ray(q)
		if not hit.is_empty():
			return a.distance_to(hit.position)
		if forest != null and forest.blocks(a, b):
			return d / 2.0
		return null
	var ground_at := func(x: float, z: float, from_y: float):
		var q := PhysicsRayQueryParameters3D.create(Vector3(x, from_y, z), Vector3(x, from_y - 600.0, z), VehicleConsts.RAY_MASK)
		var hit := get_viewport().world_3d.direct_space_state.intersect_ray(q)
		return null if hit.is_empty() else hit.position.y
	tv = load("res://scripts/game/tv_cameras.gd").new(track_data, cast_sight, ground_at)
	add_child(tv.camera)
	return tv

var _tv_hint := -1

## The car the TV cameras follow: watching, the watched car; driving, yours. Returns {pos, vel, s} or null.
func tv_target():
	if not spectator:
		return {"pos": vehicle.global_position, "vel": vehicle.linear_velocity, "s": loc.s}
	var r := remote_by_id(spec_target)
	if r == null and remotes.size() > 0:
		r = remotes.values()[0]
	if r == null:
		return null
	var p: Vector3 = r.visual.global_position
	_tv_hint = TrackMath.nearest_centerline_index(track_data, p.x, p.y, p.z, _tv_hint, 40)
	return {"pos": p, "vel": r.vel, "s": TrackMath.progress_at(track_data, _tv_hint, p.x, p.z)}

func _on_spectator_key(e: InputEventKey) -> void:
	var have := {}
	for r: Remote in remotes.values():
		have[r.id] = true
	var src: Array = standings.map(func(s): return s.id) if standings.size() > 0 else race.grid
	var ids: Array = src.filter(func(id): return have.has(id))
	if ids.is_empty():
		return
	var i := ids.find(spec_target)
	if e.keycode == KEY_C or e.keycode == KEY_T:
		spec_tv = not spec_tv
		if tv != null:
			tv.reset()
		flash(I18n.t("TV cameras") if spec_tv else I18n.t("Chase camera"), 1200.0)
		return
	if e.keycode == KEY_RIGHT:
		i = (i + 1) % ids.size()
	elif e.keycode == KEY_LEFT:
		i = (i - 1 + ids.size()) % ids.size()
	elif e.keycode >= KEY_1 and e.keycode <= KEY_9:
		i = mini(ids.size() - 1, e.keycode - KEY_1)
	else:
		return
	spec_target = ids[i]
	spec_cam_init = false
	if tv != null:
		tv.reset()

## Chase camera behind the watched car, smoothed.
func update_spectator_cam(dt: float) -> void:
	var r := remote_by_id(spec_target)
	if r == null and remotes.size() > 0:
		r = remotes.values()[0]
	if r == null:
		return
	var o: Node3D = r.visual
	var f := o.global_transform.basis.z
	f.y = 0.0
	f = f.normalized()
	var want := o.global_position - f * 7.5 + Vector3(0, 2.6, 0)
	if not spec_cam_init:
		spec_cam.global_position = want
		spec_cam_init = true
	else:
		spec_cam.global_position = spec_cam.global_position.lerp(want, 1.0 - exp(-dt * 5.0))
	spec_cam.look_at(o.global_position + f * 4.0 + Vector3(0, 1, 0), Vector3.UP)

## The pit stop's TV shot: low from the front three-quarter on the fast-lane side, the garage behind the car, a slow
## drift around it while the crew works, as broadcasts frame a stop.
func update_pit_cam(dt: float) -> void:
	pit_cam_t += dt
	if service == null or Time.get_ticks_msec() - service.start < 50.0:
		pit_cam_t = 0.0
	var fwd := vehicle.global_transform.basis.z
	var fx := fwd.x
	var fz := fwd.z
	# the fast lane is away from the garage
	var away := Vector2(fz, -fx)
	if pit != null and pit.index >= 0:
		away = pit.away_at(pit.index)
	var side_sign := -1.0 if away.x * fz - away.y * fx > 0.0 else 1.0
	var a := 0.62 - pit_cam_t * 0.025
	var f := cos(a) * 6.2
	var side := sin(a) * 6.2 * side_sign
	var p := vehicle.global_position
	pit_cam.global_position = Vector3(p.x + fx * f + fz * side, p.y + 1.15, p.z + fz * f - fx * side)
	pit_cam.look_at(Vector3(p.x - fx * 0.4, p.y + 0.45, p.z - fz * 0.4), Vector3.UP)

# ------------------------------------------------------- race control ---

## The safety car's model (race control, race only): loaded after the session, shown when it is deployed.
func _load_safety_car() -> void:
	var entry := CarsDb.safety_car()
	if entry.is_empty():
		return
	var model := Assets.load_car_model(entry, 3, false, 1)
	var visual := CarVisual.new(entry, model, false)
	visual.visible = false
	add_child(visual)
	var body = null
	if contact:
		var r := Remote.new()
		r.entry = entry
		r.visual = visual
		body = _make_proxy(r)
		body.collision_layer = 0 # solid only on track (move_kinematics)
	sc = {"visual": visual, "body": body, "s": 0.0, "speed": 0.0, "vel": Vector3.ZERO, "visible": false, "solid": false}

## The safety car: drawn where race control's deterministic path puts it (every client agrees).
func update_safety_car(server_now: float, dt: float) -> void:
	if sc == null or sc_path == null:
		return
	var d = rc.sc
	var on: bool = d != null and server_now >= d.t0 and (d.inAt == null or server_now < d.inAt)
	sc.visible = on
	sc.visual.visible = true
	if not on or d == null:
		# waiting at the end of the pit lane, as at a real race, lights off
		var lane = track_data.get("pitLane")
		if lane == null:
			sc.visual.visible = false
			return
		if sc_park == null:
			var i := maxi(1, lane.points.size() - 14)
			var p: Array = lane.points[i]
			var q: Array = lane.points[i + 1]
			# beside the lane line, not on it: towards the garages, clear of the wall there, else the other way
			var away := pit.away_at(i) if pit != null else Vector2.ZERO
			var room := func(sx: float) -> float:
				var h = wall_probe(p[0], p[1], p[2], away.x * sx, away.y * sx, 12.0)
				return 12.0 if h == null else h
			var side := 1.0 if room.call(1.0) >= 5.5 else (-1.0 if room.call(-1.0) >= 5.5 else (1.0 if room.call(1.0) >= room.call(-1.0) else -1.0))
			var off := maxf(0.0, minf(4.2, room.call(side) - 1.3))
			var x: float = p[0] + away.x * side * off
			var z: float = p[2] + away.y * side * off
			var hit: Dictionary = track.ground_query.cast(Vector3(x, p[1] + 2.0, z), Vector3.DOWN, 5.0)
			var y: float = hit.pos.y if not hit.is_empty() else p[1]
			sc_park = {"x": x, "y": y, "z": z, "yaw": atan2(q[0] - p[0], q[2] - p[2])}
		sc.visual.global_transform = Transform3D(Basis(Vector3.UP, sc_park.yaw), Vector3(sc_park.x, sc_park.y, sc_park.z))
		sc.vel = Vector3.ZERO
		sc.visual.set_lights(false, false, env.night)
		return
	var s := RaceControl.safety_car_at(sc_path, d.t0, d.s0, server_now)
	var moved := TrackMath.wrap_delta(sc.s, s, track_data.length)
	sc.speed = moved / dt if dt > 0.0 and moved >= 0.0 and moved < 100.0 else sc.speed
	sc.s = s
	var pt := track.point_at(s)
	sc.visual.global_transform = Transform3D(Basis(Vector3.UP, pt.yaw), Vector3(pt.x, pt.y, pt.z))
	sc.vel = Vector3(sin(pt.yaw) * sc.speed, 0, cos(pt.yaw) * sc.speed)
	# the light bar flashes (it carries the brake and head light materials of the model)
	sc.visual.set_lights(int(floorf(server_now / 400.0)) % 2 == 0, true, env.night)

## Speed limiters: the pit lane's, and the full-course yellow's after its 10 s warning (my car and my bots).
func update_limiters(server_now: float) -> void:
	var fcy: bool = rc.course == "fcy" and rc.limitAt != null and server_now >= rc.limitAt
	var lane := pit.limit_ms() if pit != null else -1.0
	# the limit ends at the pit-out line (an exit road may run on beyond it)
	var pl = track_data.get("pitLane")
	var out: float = pl.outIndex if pl != null and pl.get("outIndex", null) != null else INF
	if pit != null and pit.in_lane and pit.index <= out:
		vehicle.speed_limit_ms = lane
	else:
		vehicle.speed_limit_ms = FCY_MS if fcy else -1.0
	for r: Remote in remotes.values():
		var b := r.bot
		if b != null:
			if b.ai.in_pit_lane and b.ai.lane_index() <= out:
				b.vehicle.speed_limit_ms = lane
			else:
				b.vehicle.speed_limit_ms = FCY_MS if fcy else -1.0

## Pit-window rule: is the mandatory stop (driver change) due now, done, or outside the window? "" without the rule.
func driver_change_state() -> String:
	if not race.get("rules", {}).get("pitWindow", false) or race.kind != "race":
		return ""
	for s in standings:
		if s.id == me and s.stopDone:
			return "done"
	var wt = pit_window_ms()
	if wt != null:
		# by the clock, from the pit entry: the stop has started when the car is in the lane
		var t: float = conn.server_now()
		if pit != null and pit.in_lane:
			t = local_tracker.players[me].pit_in_ms if local_tracker != null and local_tracker.players.has(me) else 0.0
		return "due" if t >= wt.open and t < wt.close else "closed"
	var w := RaceTracker.pit_window_laps(race.laps)
	var lap := my_laps + 1
	return "due" if lap >= w.open and lap <= w.close else "closed"

## The bots' pit stops (the host simulates them): the mandatory stop on their lap of the window, a stop for fuel when
## the tank won't reach the flag, a drive-through when race control gave one. They drive the pit lane (AiDriver), stand
## while the crew works (service time, as for a player), and their lap logic sees pit in / out.
func update_bot_pits(server_now: float) -> void:
	if start_at == null or server_now < start_at:
		return
	var now := Time.get_ticks_msec() as float
	var rules: Dictionary = race.get("rules", {})
	var win := RaceTracker.pit_window_laps(race_laps())
	var wt = pit_window_ms()
	for r: Remote in remotes.values():
		var b := r.bot
		var tr: RaceTracker.PlayerRaceState = local_tracker.players.get(r.id) if local_tracker != null else null
		if b == null or b.pit == null or tr == null:
			continue
		var v := b.vehicle
		var pos := v.global_position
		var lat := lateral_at(track_data, b.hint, pos.x, pos.z) if b.hint >= 0 else 0.0
		var off := 0.0
		if b.hint >= 0:
			off = absf(lat) - (track_data.widthL[b.hint] if lat >= 0.0 else track_data.widthR[b.hint])
		# in and out by the AI's own pit state (the monitor's 'exit' also fires when a bot is put back onto the lane's
		# line, which then read as a second pass through the pits)
		b.pit.update(pos.x, pos.z, off, v.telemetry.speed)
		if not b.pit_sent and b.ai.in_pit_lane and b.pit.in_lane:
			b.pit_sent = true
			conn.send_json({"t": "pit", "in": true, "id": r.id})
			local_tracker.pit_in(r.id, server_now)
		elif b.pit_sent and not b.ai.in_pit_lane:
			b.pit_sent = false
			conn.send_json({"t": "pit", "in": false, "id": r.id})
			var exit_s = track_data.pitLane.exitS if track_data.get("pitLane") != null else 0.0
			local_tracker.pit_out(r.id, exit_s, server_now)
			b.exit_at = now
		if race.kind != "race" or tr.finished_ms != null or tr.dnf:
			continue
		var lap := tr.laps + 1
		var st = _standing(r.id)
		var laps_left := race_laps() - tr.laps
		var per_lap: float = (float(track_data.length) / 1000.0) * VehicleConsts.FUEL.perKm
		# the mandatory stop: on its lap of the window, or (a timed race) at its moment in the window's 10 minutes
		var in_window: bool
		if wt != null:
			in_window = server_now >= wt.open + ((r.slot % 5) / 6.0) * (wt.close - wt.open) and server_now < wt.close - 8000.0
		else:
			in_window = lap >= b.stop_lap and lap <= win.close
		var must_stop: bool = rules.get("pitWindow", false) and not (st != null and st.stopDone) and in_window
		var need_fuel: bool = v.fuel_l >= 0.0 and v.fuel_l < per_lap * 1.3 and v.fuel_l < laps_left * per_lap
		if b.ai.pit_request == "" and not b.ai.in_pit_lane and now - b.exit_at > 5000.0:
			if must_stop or need_fuel:
				b.ai.pit_request = "stop"
			elif st != null and st.driveThroughs > 0:
				b.ai.pit_request = "through"
		# in the box: the crew's work, timed like a player's stop
		if b.ai.at_box() and b.service_end == 0.0:
			var wear := 0.0
			for w in v.wheels:
				wear += w.wear
			wear /= 4.0
			var fuel_add := 0.0 if v.fuel_l < 0.0 else ceilf(minf(VehicleConsts.FUEL.tankL - v.fuel_l, maxf(0.0, (laps_left + 1) * per_lap - v.fuel_l)))
			var driver: bool = bool(rules.get("pitWindow", false)) and not (st != null and st.stopDone) and ((tr.pit_in_ms >= wt.open and tr.pit_in_ms < wt.close) if wt != null else (lap >= win.open and lap <= win.close))
			var plan := PitService.default_plan(r.damage.zones, wear, v.compound.id, weather.wetness, fuel_add, driver)
			b.service_plan = plan
			b.service_end = now + maxf(1.0, PitService.service_time(plan, r.damage.zones).total) * 1000.0
			b.service_start = now
			b.service_events = PitCrew.stop_timeline(plan, r.damage.zones)
			b.fired = 0
		elif b.service_end > 0.0 and now < b.service_end and b.service_events != null and b.service_plan != null:
			# the crew at work: each moment as it comes (heard when close), the wheels and the jacks
			var u := (now - b.service_start) / 1000.0
			var near: bool = r.visual.global_position.distance_to(cockpit.world_position()) < 35.0
			while b.fired < b.service_events.size() and b.service_events[b.fired].at <= u:
				stop_event(b.service_events[b.fired], v, b.service_plan, near)
				b.fired += 1
			var pose := PitCrew.stop_pose(b.service_events, u)
			r.visual.wheel_out = pose.wheelOut
			b.lift = pose.lift
		elif b.service_end > 0.0 and now >= b.service_end:
			var plan2 = b.service_plan
			if plan2 != null and plan2.tyres != null:
				v.fit_tyres(Tyres.COMPOUNDS[plan2.tyres], v.ambient_c + 12.0)
				v.weather_grip = Tyres.compound_grip(v.compound, weather.wetness, weather.rain)
			if plan2 != null and plan2.fuelL > 0.0 and v.fuel_l >= 0.0:
				v.set_fuel(v.fuel_l + plan2.fuelL)
			b.service_end = 0.0
			b.service_plan = null
			b.service_events = null
			b.lift = 0.0
			r.visual.wheel_out = [0.0, 0.0, 0.0, 0.0]
			b.ai.pit_served()

func _standing(id: String):
	for s in standings:
		if s.id == id:
			return s
	return null

## Race control's flag for me (the light panel on the HUD) and the fuel readout.
func race_control_hud(server_now: float) -> Dictionary:
	var me_s = _standing(me)
	var flag := ""
	var flag_text := ""
	var sc_in = rc.sc.inAt if rc.sc != null and rc.sc.inAt != null else 0.0
	if rc.course == "sc" or (rc.course == "sc-in" and sc_in > server_now):
		flag = "sc"
		flag_text = I18n.t("SAFETY CAR IN THIS LAP") if rc.course == "sc-in" else I18n.t("SAFETY CAR · NO OVERTAKING")
	elif rc.course == "sc-in":
		flag = "sc"
		flag_text = I18n.t("RESTART AT THE LINE · NO OVERTAKING")
	elif rc.course == "fcy":
		flag = "fcy"
		var left: float = (rc.limitAt if rc.limitAt != null else 0.0) - server_now
		flag_text = I18n.t("FCY · {kmh} KM/H IN {s}", {"kmh": int(RaceControl.C.fcyKmh), "s": ceili(left / 1000.0)}) if left > 0.0 else I18n.t("FCY · {kmh} KM/H", {"kmh": int(RaceControl.C.fcyKmh)})
	elif rc.blue.has(me):
		flag = "blue"
		flag_text = I18n.t("BLUE FLAG · LET THE LEADERS BY")
	elif in_yellow(loc.s):
		flag = "yellow"
		flag_text = I18n.t("YELLOW FLAG · NO OVERTAKING")
	elif damage.punctured.has(true) and not pit_hold:
		# the mechanical flag (black with an orange disc): a puncture must be repaired in the pits
		flag = "meatball"
		flag_text = I18n.t("PUNCTURE · BOX THIS LAP")
	elif me_s != null and me_s.driveThroughs > 0:
		flag = "dt"
		flag_text = I18n.t("DRIVE-THROUGH × {n} · THROUGH THE PIT LANE", {"n": me_s.driveThroughs})
	elif Time.get_ticks_msec() < green_until:
		flag = "green"
		flag_text = I18n.t("GREEN FLAG")
	elif driver_change_state() == "due":
		flag_text = I18n.t("PIT WINDOW OPEN · MANDATORY STOP")
	var fuel := vehicle.fuel_l
	var laps := 0.0 if fuel < 0.0 else fuel / maxf(0.1, fuel_per_lap)
	return {
		"flag": flag, "flagText": flag_text,
		"fuelText": "" if fuel < 0.0 else I18n.t("FUEL {l} L · {laps} LAPS", {"l": "%.1f" % fuel, "laps": "%.1f" % laps}),
		"fuelLow": fuel >= 0.0 and laps < 2.0,
	}

## Session clock: time left until the chequered flag (the flag falls at start + session length).
func session_text(server_now: float) -> String:
	if race.kind == "race":
		if finished_ms != null:
			return I18n.t("FINISHED")
		for x in standings:
			if x.finishedMs != null:
				return I18n.t("CHEQUERED FLAG · LAST LAP")
		# a timed race: the clock, then the leader's last lap
		var ms: float = race.get("raceMs", 0)
		if ms > 0.0:
			var sa: float = start_at if start_at != null else 0.0
			var left := sa + ms - maxf(server_now, sa if start_at != null else server_now)
			return I18n.t("TIME UP · LEADER ON THE LAST LAP") if start_at != null and left <= 0.0 else I18n.t("TIME LEFT {clock}", {"clock": fmt_clock(left)})
		return I18n.t("LAP {n}/{max}", {"n": mini(my_laps + 1, race.laps), "max": race.laps})
	if finished_ms != null:
		return I18n.t("SESSION COMPLETE")
	if start_at == null:
		return I18n.t("TIME LEFT {clock}", {"clock": fmt_clock(race.sessionMs)})
	var left2: float = start_at + race.sessionMs - maxf(server_now, start_at)
	return I18n.t("CHEQUERED FLAG · LAST LAP") if flagged or left2 <= 0.0 else I18n.t("TIME LEFT {clock}", {"clock": fmt_clock(left2)})

# ------------------------------------------------------------ pit lane ---

var _tris := PackedFloat32Array()
var _tri_grid := {}
var _crew_of := {}
var _crew_centre: Array = []
var _crew_work: Array = []
var _crew_pool: Array = []

## Height of the visible road at (x, z) under top (the highest surface below the probe), from the triangles near the pit lane.
func _road_height(x: float, z: float, top: float):
	const G := 2.0
	var best = null
	var k := int(floorf(x / G)) * 65536 + int(floorf(z / G))
	for t in _tri_grid.get(k, []):
		var ax := _tris[t]
		var ay := _tris[t + 1]
		var az := _tris[t + 2]
		var bx := _tris[t + 3]
		var by := _tris[t + 4]
		var bz := _tris[t + 5]
		var cx := _tris[t + 6]
		var cy := _tris[t + 7]
		var cz := _tris[t + 8]
		var d := (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
		if absf(d) < 1e-9:
			continue
		var u := ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d
		var w := ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d
		if u < -1e-4 or w < -1e-4 or u + w > 1.0 + 1e-4:
			continue
		var y := u * ay + w * by + (1.0 - u - w) * cy
		# the highest surface below the probe (a bridge over the pit lane would be above it)
		if y <= top and y >= top - 6.0 and (best == null or y > best):
			best = y
	return best

## Pit lane: markings, the crews at their garages, the smoothed surface where the map's own is rough.
func _build_pit_lane(entries: Dictionary) -> void:
	var lane: Dictionary = track_data.pitLane
	pit = PitLaneMonitor.new(track_data)
	pit.measure_boxes(wall_probe)
	# painted on the *visible* road: the collision under painted layers is flattened a few cm lower, so markings placed
	# on it disappeared under the asphalt. Copy once only the road triangles within ~40 m of the pit lane into one small
	# set (ray casts against the whole road took seconds on a phone)
	var near := {}
	const CELL := 8.0
	var key := func(x: float, z: float) -> int: return int(floorf(x / CELL)) * 65536 + int(floorf(z / CELL))
	for p in lane.points:
		for dx in range(-5, 6):
			for dz in range(-5, 6):
				near[key.call(p[0] + dx * CELL, p[2] + dz * CELL)] = true
	var lo := Vector3(INF, INF, INF)
	var hi := Vector3(-INF, -INF, -INF)
	for p in lane.points:
		lo = Vector3(minf(lo.x, p[0]), minf(lo.y, p[1]), minf(lo.z, p[2]))
		hi = Vector3(maxf(hi.x, p[0]), maxf(hi.y, p[1]), maxf(hi.z, p[2]))
	var pit_box := AABB(lo - Vector3(45, 45, 45), (hi - lo) + Vector3(90, 90, 90))
	var road_re := RegEx.create_from_string("(?i)^(asph|pits|conc_|pavement|tiles|lines|box_decal)")
	var tris := PackedFloat32Array()
	for n in CarVisual._walk(track):
		if not (n is MeshInstance3D) or (n as MeshInstance3D).mesh == null:
			continue
		var mi := n as MeshInstance3D
		if mi.mesh.get_surface_count() == 0:
			continue
		var m0 := mi.mesh.surface_get_material(0)
		if m0 == null or road_re.search(m0.resource_name) == null:
			continue
		var xf := track._rel(mi)
		if not pit_box.intersects(xf * mi.mesh.get_aabb()):
			continue
		for s in mi.mesh.get_surface_count():
			var arr := mi.mesh.surface_get_arrays(s)
			var verts: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
			var idx = arr[Mesh.ARRAY_INDEX]
			var count: int = idx.size() if idx != null else verts.size()
			var i := 0
			while i + 2 < count:
				var a0: int = idx[i] if idx != null else i
				var w0 := xf * verts[a0]
				# the first corner decides (cheap); only nearby triangles are transformed in full
				if near.has(key.call(w0.x, w0.z)):
					for k in 3:
						var vv := xf * verts[idx[i + k] if idx != null else i + k]
						tris.append(vv.x)
						tris.append(vv.y)
						tris.append(vv.z)
				i += 3
	_tris = tris
	# a 2 m grid of those triangles: a height lookup is a point-in-triangle test on a handful of them
	const G := 2.0
	_tri_grid = {}
	var t := 0
	while t < _tris.size():
		var x0 := minf(_tris[t], minf(_tris[t + 3], _tris[t + 6]))
		var x1 := maxf(_tris[t], maxf(_tris[t + 3], _tris[t + 6]))
		var z0 := minf(_tris[t + 2], minf(_tris[t + 5], _tris[t + 8]))
		var z1 := maxf(_tris[t + 2], maxf(_tris[t + 5], _tris[t + 8]))
		for gx in range(int(floorf(x0 / G)), int(floorf(x1 / G)) + 1):
			for gz in range(int(floorf(z0 / G)), int(floorf(z1 / G)) + 1):
				var kk := gx * 65536 + gz
				if _tri_grid.has(kk):
					_tri_grid[kk].append(t)
				else:
					_tri_grid[kk] = [t]
		t += 9
	var gq := track.ground_query
	var paint_ground := func(x: float, z: float, y: float) -> float:
		var h = _road_height(x, z, y + 2.5)
		if h != null:
			return h
		var hit: Dictionary = gq.cast(Vector3(x, y + 2.5, z), Vector3.DOWN, 6.0)
		return hit.pos.y if not hit.is_empty() else y
	if PIT_SURFACE_MAPS.has(track_data.get("map", "")):
		add_child(pit.build_surface(paint_ground, wall_probe))
	var mine = null if spectator else {"slot": race.slots.get(me, 0), "name": names.get(me, "")}
	add_child(pit.build_markings(paint_ground, mine))
	# a crew in front of every entrant's garage, in the car's colour
	var boxes := pit.boxes()
	var crew_boxes: Array = []
	for id in race.grid:
		var pl = _player(id)
		var e = entries.get(pl.carId) if pl != null and pl.carId != null else null
		if e == null or boxes.is_empty():
			continue
		var ab: Array = boxes[pit.box_of(race.slots.get(id, 0))]
		var i2 := roundi((ab[0] + ab[1]) / 2.0)
		var pts: Array = lane.points
		var away := pit.away_at(i2)
		var sh := pit.shift_at(i2)
		var q0: Array = pts[maxi(0, i2 - 1)]
		var q1: Array = pts[mini(pts.size() - 1, i2 + 1)]
		var x: float = pts[i2][0] + away.x * sh
		var z: float = pts[i2][2] + away.y * sh
		_crew_of[id] = crew_boxes.size()
		var centre := Vector3(x, paint_ground.call(x, z, pts[i2][1]), z)
		_crew_centre.append(centre)
		_crew_pool.append({"car": null, "u": 0.0, "events": null})
		crew_boxes.append({"centre": centre, "along": Vector3(q1[0] - q0[0], 0, q1[2] - q0[2]).normalized(), "away": Vector3(away.x, 0, away.y), "colour": e.color})
	if not crew_boxes.is_empty() and ResourceLoader.exists("res://scripts/game/pit_crew.gd"):
		crews = PitCrews.new(crew_boxes)
		add_child(crews)

## Pit lane: limiter, pit-in/out for the lap logic, the service box.
func update_pit(server_now: float) -> void:
	if pit == null or start_at == null or server_now < start_at:
		return
	var v := vehicle
	var edge: float = track_data.widthL[loc.index] if loc.lateral >= 0.0 else track_data.widthR[loc.index]
	var p := v.global_position
	var ev := pit.update(p.x, p.z, absf(loc.lateral) - edge, v.telemetry.speed)
	if ev == "enter":
		_say("pit_limiter", 2, {"cooldown": 30, "ttl": 3})
		conn.send_json({"t": "pit", "in": true})
		local_tracker.pit_in(me, server_now)
		flash(I18n.t("Pit lane · limiter {n} km/h · stop in the yellow box for service", {"n": int(pit.lane.speedLimitKmh)}), 4000.0)
	elif ev == "exit":
		conn.send_json({"t": "pit", "in": false})
		local_tracker.pit_out(me, track_data.pitLane.exitS, server_now)
		close_pit_menu()
		flash(I18n.t("Session over") if flagged else I18n.t("Out lap: bring the tyres up to temperature"), 3000.0)
	elif ev == "box" and not pit_hold and finished_ms == null:
		open_pit_menu()
	# service running
	var sv = service
	if sv != null and pit_menu != null:
		var now := Time.get_ticks_msec() as float
		var secs: float = (now - sv.start) / 1000.0
		while sv.fired < sv.events.size() and sv.events[sv.fired].at <= secs:
			stop_event(sv.events[sv.fired], vehicle, sv.plan, true)
			sv.fired += 1
		var pose := PitCrew.stop_pose(sv.events, secs)
		my_visual.wheel_out = pose.wheelOut
		jack_lift = pose.lift
		var u: float = (now - sv.start) / (sv.end - sv.start)
		pit_menu.set_progress(u, maxf(0.0, (sv.end - now) / 1000.0), secs)
		if u >= 1.0:
			finish_service(sv.plan)
	if pit_menu != null:
		pit_menu.set_clock(session_text(server_now))
	# my car on the air jacks, drawn above its physics pose
	my_visual.position.y = jack_lift

func open_pit_menu() -> void:
	var v := vehicle
	pit_hold = true
	v.frozen = true
	var wear: Array = v.wheels.map(func(w): return w.wear)
	var avg_wear := 0.0
	for w in wear:
		avg_wear += w
	avg_wear /= 4.0
	# the race: fuel to the finish (and a lap more); the mandatory stop when the window is open
	var laps_left = maxi(0, race_laps() - my_laps) if race.kind == "race" else null
	var fuel_need = (laps_left + 1) * fuel_per_lap if laps_left != null else null
	var fuel_add := 0.0
	if v.fuel_l >= 0.0 and fuel_need != null:
		fuel_add = ceilf(minf(VehicleConsts.FUEL.tankL - v.fuel_l, maxf(0.0, fuel_need - v.fuel_l)))
	var driver := driver_change_state()
	var plan := PitService.default_plan(damage.zones, avg_wear, v.compound.id, weather.wetness, fuel_add, driver == "due")
	# a puncture: new tyres whatever their wear
	if damage.punctured.has(true) and plan.tyres == null:
		plan.tyres = v.compound.id
	var opts := {
		"current": v.compound.id, "wear": wear, "temps": v.wheels.map(func(w): return w.temp), "zones": damage.zones,
		"wetness": weather.wetness, "plan": plan,
		"fuel": null if v.fuel_l < 0.0 else {"litres": v.fuel_l, "tank": VehicleConsts.FUEL.tankL, "perLap": fuel_per_lap, "need": fuel_need},
		"driverChange": driver if driver != "" else null,
	}
	pit_menu = PitMenu.new(opts, func(p, seconds):
		var now := Time.get_ticks_msec() as float
		service = {"plan": p, "start": now, "end": now + seconds * 1000.0, "events": PitCrew.stop_timeline(p, damage.zones), "fired": 0},
		func(): release_from_box())
	hud.add_child(pit_menu)

func finish_service(plan: Dictionary) -> void:
	var v := vehicle
	if plan.tyres != null:
		v.fit_tyres(Tyres.COMPOUNDS[plan.tyres], v.ambient_c + 12.0)
		damage.tyres_changed()
		v.weather_grip = Tyres.compound_grip(v.compound, weather.wetness, weather.rain)
	# dents are visual: reset them with any bodywork repair, even if the damage value had already reached zero
	if plan.body:
		my_visual.reset_damage()
	if plan.fuelL > 0.0 and v.fuel_l >= 0.0:
		v.set_fuel(v.fuel_l + plan.fuelL)
	if damage.repair({"body": plan.body, "suspension": plan.suspension, "engine": plan.engine}):
		v.drivetrain.power_scale = damage.power_scale()
		conn.send_json({"t": "damage", "zones": _round_zones()})
		damage_version_sent = damage.version
	flash(I18n.t("Service complete · GO!"), 2500.0)
	release_from_box()

func release_from_box() -> void:
	if service != null:
		_say("pit_go", 3, {"ttl": 3})
		rs.tyresCold = false
	service = null
	jack_lift = 0.0
	my_visual.wheel_out = [0.0, 0.0, 0.0, 0.0]
	close_pit_menu()
	pit_hold = false
	if start_at != null and conn.server_now() >= freeze_until:
		vehicle.frozen = false

func close_pit_menu() -> void:
	if pit_menu != null:
		pit_menu.queue_free()
		pit_menu = null

## A moment of a pit stop: its sound (left wheels on the left), and a new tyre as it goes on, so the tyre gauges change
## wheel by wheel with the crew.
func stop_event(e: Dictionary, v: Vehicle, plan: Dictionary, audible: bool) -> void:
	if e.kind == "wheelOn" and plan.tyres != null:
		v.fit_wheel(e.wheel, Tyres.COMPOUNDS[plan.tyres], v.ambient_c + 12.0)
		v.weather_grip = Tyres.compound_grip(v.compound, weather.wetness, weather.rain)
	if not audible or e.kind == "wheelOff" or e.kind == "wheelOn":
		return
	var pan := 0.0
	if e.kind == "gunOff" or e.kind == "gunOn":
		pan = -0.7 if e.wheel % 2 == 0 else 0.7
	if snd != null:
		snd.pit_event(e.kind, pan)

## The crews: mine works to my stop's timeline; a bot's (when I run it) to its own; anyone else's car standing in its
## box gets its crew round it; the rest wait in front of their garages.
func update_crews(dt: float, cam_pos: Vector3) -> void:
	if crews == null:
		return
	_crew_work.resize(_crew_pool.size())
	_crew_work.fill(null)
	var set_work := func(id: String, obj: Node3D, entry: Dictionary, u: float, events) -> void:
		if not _crew_of.has(id):
			return
		var i: int = _crew_of[id]
		var w: Dictionary = _crew_pool[i]
		w.car = {"pos": obj.global_position, "quat": obj.global_transform.basis.get_rotation_quaternion(), "entry": entry}
		w.u = u
		w.events = events
		_crew_work[i] = w
	var now := Time.get_ticks_msec() as float
	if pit_hold and not spectator:
		set_work.call(me, my_visual, vehicle.car, (now - service.start) / 1000.0 if service != null else 0.0, service.events if service != null else null)
	for r: Remote in remotes.values():
		var b := r.bot
		if b != null:
			if b.service_end > 0.0 or b.ai.at_box():
				set_work.call(r.id, r.visual, r.entry, (now - b.service_start) / 1000.0, b.service_events)
			continue
		if _crew_of.has(r.id):
			var i2: int = _crew_of[r.id]
			if r.vel.length_squared() < 0.4 and r.visual.global_position.distance_squared_to(_crew_centre[i2]) < 20.0:
				set_work.call(r.id, r.visual, r.entry, 0.0, null)
	crews.update_crews(dt, cam_pos, _crew_work)

# --------------------------------------------------------------- radio ---

## The radio's ear on the session, every frame: a call when something changes (flags, the pit window, fuel, tyres, rain,
## the clock, rivals pitting, a new leader) and the spotter's "car left / right / three wide / clear".
func radio_frame(server_now: float, flag: String, flag_text: String, fuel_low: bool) -> void:
	var r = radio
	if r == null or spectator or start_at == null:
		return
	var v := vehicle
	var racing: bool = server_now >= start_at and finished_ms == null
	if not rs.checked and start_at - server_now < 12000.0:
		rs.checked = true
		r.say("radio_check", 1, {"ttl": 10})
	if not racing:
		return
	if flag != rs.flag:
		var prev: String = rs.flag
		rs.flag = flag
		var line := ""
		match flag:
			"sc":
				line = "sc_in" if flag_text == I18n.t("SAFETY CAR IN THIS LAP") else "sc"
			"fcy":
				line = "fcy"
			"yellow":
				line = "yellow"
			"blue":
				line = "blue"
			"green":
				line = "green" if prev == "sc" or prev == "fcy" else ""
			"meatball":
				line = "box_this_lap"
		if line != "":
			r.say(line, 2 if line == "yellow" or line == "blue" else 3, {"key": "flag-%s" % line, "cooldown": 25 if line == "yellow" else 12, "ttl": 4})
	var due := driver_change_state() == "due"
	if due and not rs.pitDue:
		r.say("pit_window_open", 2, {"ttl": 10})
	rs.pitDue = due
	if fuel_low and not rs.fuelLow:
		r.say("fuel_low", 2, {"ttl": 10})
	rs.fuelLow = fuel_low
	var crit: bool = v.fuel_l >= 0.0 and fuel_per_lap > 0.0 and v.fuel_l < fuel_per_lap * 0.9
	if crit and not rs.fuelCrit:
		r.say("fuel_critical", 3, {"ttl": 10})
	rs.fuelCrit = crit
	# tyres: cold a minute in, overheating any time
	var temps: Array = v.wheels.map(func(w): return w.temp)
	var avg := 0.0
	var mx := 0.0
	for t in temps:
		avg += t
		mx = maxf(mx, t)
	avg /= 4.0
	if not rs.tyresCold and server_now - start_at > 60000.0 and avg < 55.0 and v.telemetry.speed > 25.0:
		rs.tyresCold = true
		r.say("tyres_cold", 1, {"ttl": 8})
	if mx > 115.0:
		r.say("tyres_hot", 1, {"cooldown": 120, "ttl": 8})
	if v.wheels.any(func(w): return w.wear > 0.7):
		r.say("tyres_worn", 1, {"cooldown": 300, "ttl": 10})
	# rain
	var wet: bool = weather.rain > 0.2
	if wet and not rs.rain:
		r.say("rain_now", 2, {"cooldown": 120, "ttl": 10})
	if not wet and rs.rain and weather.rain < 0.03:
		r.say("drying", 1, {"cooldown": 120, "ttl": 10})
	rs.rain = true if wet else (false if weather.rain < 0.03 else rs.rain)
	var ch = race.weather.change
	if ch != null and (ch.to == "light_rain" or ch.to == "heavy_rain") and not wet:
		var in_s: float = (start_at + ch.atSec * 1000.0 - server_now) / 1000.0
		if in_s > 60.0 and in_s < 240.0:
			r.say("rain_coming", 1, {"cooldown": 600, "ttl": 10})
	# the clock: 20, 10 and 5 minutes left in a timed session
	var total: float = race.get("raceMs", 0) if race.kind == "race" else race.sessionMs
	if total > 0.0:
		var left: float = start_at + total - server_now
		for m in [20, 10, 5]:
			if left < m * 60000.0 and left > m * 60000.0 - 20000.0 and total > m * 60000.0 and not rs.mins.has(m):
				rs.mins[m] = true
				r.say("min%d" % m, 1, {"ttl": 15})
	# rivals: the cars either side in the classification pitting, a new leader (from lap 3)
	if race.kind == "race":
		var i := -1
		for k in standings.size():
			if standings[k].id == me:
				i = k
		var ahead = standings[i - 1] if i > 0 else null
		var behind = standings[i + 1] if i >= 0 and i + 1 < standings.size() else null
		if ahead != null and ahead.inPit and rs.aheadPit != ahead.id:
			r.say("car_ahead_pits", 1, {"ttl": 6})
		rs.aheadPit = ahead.id if ahead != null and ahead.inPit else ""
		if behind != null and behind.inPit and rs.behindPit != behind.id:
			r.say("car_behind_pits", 1, {"ttl": 6})
		rs.behindPit = behind.id if behind != null and behind.inPit else ""
		var lead: String = standings[0].id if standings.size() > 0 else ""
		if rs.leader != "" and lead != "" and lead != rs.leader and lead != me and my_laps >= 3:
			r.say("new_leader", 1, {"ttl": 6})
		rs.leader = lead
	# the spotter: someone alongside (racing speed only, not in the pit lane)
	var L: bool = spot.left and v.telemetry.speed > 12.0 and not (pit != null and pit.in_lane)
	var R: bool = spot.right and v.telemetry.speed > 12.0 and not (pit != null and pit.in_lane)
	if L and R and not (rs.spotL and rs.spotR):
		r.say("three_wide", 3, {"key": "spot", "cooldown": 2, "ttl": 1})
	elif L and not rs.spotL and not R:
		r.say("car_left", 3, {"key": "spot", "cooldown": 2, "ttl": 1})
	elif R and not rs.spotR and not L:
		r.say("car_right", 3, {"key": "spot", "cooldown": 2, "ttl": 1})
	elif not L and not R and (rs.spotL or rs.spotR):
		r.say("clear", 3, {"key": "spot-clear", "cooldown": 3, "ttl": 1})
	rs.spotL = L
	rs.spotR = R

## At the line, in a race: the start, the position, the gap to the nearest car and its trend, the last lap.
func radio_lap() -> void:
	var r = radio
	if r == null or race.kind != "race":
		return
	var pos := 0
	for k in standings.size():
		if standings[k].id == me:
			pos = k + 1
	if rs.startPos == 0:
		rs.startPos = race.grid.find(me) + 1
	if my_laps == 2 and pos > 0 and rs.startPos != 0 and pos < rs.startPos:
		r.say("good_start", 1, {"ttl": 8})
	if pos > 0 and pos <= 24 and (pos != rs.lastPos or my_laps % 3 == 0):
		r.say("pos_%d" % pos, 1, {"key": "pos", "cooldown": 20, "ttl": 8})
	rs.lastPos = pos
	# the nearest car on the road within 10 s, and whether the gap is coming down
	var a = spot.aheadS
	var b = spot.behindS
	if a != null and a < 10.0 and (b == null or a <= b):
		if rs.gapAhead != null and rs.gapAhead - a > 0.3:
			r.say("catching", 1, {"key": "trend", "cooldown": 40, "ttl": 8})
		r.say("ahead_%d" % maxi(1, mini(20, roundi(a * 2.0))), 1, {"key": "gap", "cooldown": 25, "ttl": 8})
	elif b != null and b < 10.0:
		if rs.gapBehind != null and rs.gapBehind - b > 0.3:
			r.say("losing", 1, {"key": "trend", "cooldown": 40, "ttl": 8})
		r.say("behind_%d" % maxi(1, mini(20, roundi(b * 2.0))), 1, {"key": "gap", "cooldown": 25, "ttl": 8})
	rs.gapAhead = a
	rs.gapBehind = b
	if race.get("raceMs", 0) == 0 and race.laps > 1 and my_laps == race.laps:
		r.say("last_lap", 2, {"ttl": 10})

# ------------------------------------------------------------------ ui ---

func update_spectator_ui(server_now: float, dt: float) -> void:
	var r := remote_by_id(spec_target)
	var st = _standing(spec_target)
	var nm: String = names.get(spec_target, "")
	if standings.size() > 0:
		hud.set_board(standings, spec_target, names)
	if Time.get_ticks_msec() > message_until:
		message = ""
	var sc_course: bool = rc.course == "sc" or rc.course == "sc-in"
	hud.update_state({
		"speedMs": r.vel.length() if r != null else 0.0, "rpm": 0.0, "redline": 1.0, "limiter": 1.0, "gear": 0, "manual": false,
		"lapLabel": str(st.laps + 1) if st != null else "", "lapPenaltyMs": st.lapPenaltyMs if st != null else 0, "lapInvalid": false,
		"liveDelta": null, "position": st.position if st != null else 0, "total": race.grid.size(), "currentLapMs": 0.0,
		"bestLapMs": st.bestLapMs if st != null else null, "lastLapMs": st.lastLapMs if st != null else null, "sectorDelta": null,
		"damage": 0.0, "damageZones": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0], "wrongWay": false, "abs": false, "tc": false, "message": message,
		"sessionText": session_text(server_now), "pitText": I18n.t("WATCHING · {name} · ←/→ change car", {"name": nm}),
		"throttle": 0.0, "brake": 0.0, "steer": 0.0, "compound": "medium", "tyreWear": [0.0, 0.0, 0.0, 0.0],
		"brakeTemps": [0.0, 0.0, 0.0, 0.0], "slipstream": 0.0, "resetHint": false, "tyreTemps": [0.0, 0.0, 0.0, 0.0],
		"flag": "sc" if sc_course else ("fcy" if rc.course == "fcy" else ""),
		"flagText": I18n.t("SAFETY CAR · NO OVERTAKING") if sc_course else (I18n.t("FCY · {kmh} KM/H", {"kmh": int(RaceControl.C.fcyKmh)}) if rc.course == "fcy" else ""),
		"fuelText": "", "fuelLow": false,
	})
	map_timer -= dt
	if map_timer <= 0.0 and r != null:
		map_timer = 0.1
		var dots: Array = []
		for o: Remote in remotes.values():
			if o == r or not o.visual.visible or (o.bot == null and not o.buffer.has_data()):
				continue
			dots.append({"x": o.visual.global_position.x, "z": o.visual.global_position.z, "me": false, "color": o.entry.color})
		var f := r.visual.global_transform.basis.z
		hud.draw_map(dots, r.visual.global_position.x, r.visual.global_position.z, f.x, f.z)

func update_race_ui(server_now: float, race_t: float, dt: float) -> void:
	if spectator:
		update_spectator_ui(server_now, dt)
		return
	var v := vehicle
	var tel := v.telemetry
	var p := v.global_position
	# forward direction of the car on the ground plane
	var fwd := v.global_transform.basis.z
	loc = track.locate(p.x, p.y, p.z, fwd.x, fwd.z)
	var moving_wrong: bool = loc.dot < -0.45 and absf(tel.forwardSpeed) > 4.0 and not v.is_reverse()
	wrong_way_time = wrong_way_time + dt if moving_wrong else 0.0
	# stuck / upside-down hint
	var up_y := v.global_transform.basis.y.y
	var stuck: bool = (tel.speed < 1.0 and race_t > 2000.0 and not v.frozen) or up_y < 0.3 or tel.airborne > 2.0
	stuck_time = stuck_time + dt if stuck else 0.0

	var me_s = _standing(me)
	var position: int = me_s.position if me_s != null else race.slots.get(me, 0) + 1
	var now_ms := Time.get_ticks_msec() as float
	if now_ms > message_until:
		message = ""
	if now_ms > sector_delta_until:
		sector_delta = null
	var cur_lap: float = 0.0 if race_t < 0.0 or finished_ms != null else server_now - lap_start_ms()
	var rc_hud := race_control_hud(server_now)
	radio_frame(server_now, rc_hud.flag, rc_hud.flagText, rc_hud.fuelLow)
	var mytr: RaceTracker.PlayerRaceState = local_tracker.players.get(me) if local_tracker != null else null
	var lap_label: String
	if finished_ms != null:
		lap_label = I18n.t("FIN")
	elif mytr == null or mytr.out_lap:
		lap_label = I18n.t("OUT")
	else:
		lap_label = str(my_laps + 1)
	var pen_ms: int = mytr.lap_penalty_ms if mytr != null else 0
	var state := {
		"speedMs": tel.speed, "rpm": tel.rpm, "redline": float(v.specs.redlineRpm), "limiter": float(v.specs.limiterRpm), "gear": tel.gear,
		"manual": v.drivetrain.manual, "lapLabel": lap_label, "lapPenaltyMs": pen_ms if my_laps > 0 and finished_ms == null else 0,
		"lapInvalid": finished_ms == null and mytr != null and mytr.lap_invalid,
		"liveDelta": (live_delta + pen_ms) if my_laps > 0 and finished_ms == null and live_delta != null else null,
		"position": position, "total": race.grid.size(), "currentLapMs": cur_lap, "bestLapMs": best_lap,
		"lastLapMs": lap_times.back() if not lap_times.is_empty() else null, "sectorDelta": sector_delta, "damage": damage.total(),
		"wrongWay": wrong_way_time > 1.2, "abs": tel.absActive, "tc": tel.tcActive, "message": message, "sessionText": session_text(server_now),
		"pitText": I18n.t("PIT BOX") if pit_hold else (I18n.t("PIT LANE · LIMITER {n}", {"n": int(pit.lane.speedLimitKmh)}) if pit != null and pit.in_lane else ""),
		"compound": v.compound.id, "tyreWear": v.wheels.map(func(w): return w.wear), "brakeTemps": v.wheels.map(func(w): return w.brake_temp),
		"slipstream": v.wake.strength, "resetHint": stuck_time > 3.0, "tyreTemps": v.wheels.map(func(w): return w.temp),
		"damageZones": damage.zones, "throttle": v.pedals.throttle, "brake": v.pedals.brake, "steer": v.steer_angle / v.max_steer,
	}
	state.merge(rc_hud)
	hud.update_state(state)
	hud.update_damage(damage, kb.held("damage"))
	if race_t >= 0.0 and finished_ms == null:
		career.km += (tel.speed * dt) / 1000.0
	if dash != null:
		dash.update_dash(dt, {
			"gear": tel.gear, "kmh": tel.speed * 3.6, "rpm": tel.rpm, "redline": float(v.specs.redlineRpm), "limiter": float(v.specs.limiterRpm),
			"lapMs": cur_lap, "lastMs": lap_times.back() if not lap_times.is_empty() else null, "bestMs": best_lap,
			"deltaMs": live_delta if my_laps > 0 and finished_ms == null else null, "position": position, "total": race.grid.size(),
			"tc": v.assists.tc, "abs": v.assists.abs, "bias": float(v.specs.brakeBiasFront), "fuelL": v.fuel_l if v.fuel_l >= 0.0 else null,
			"psi": v.wheels.map(func(w): return w.pressure), "temps": v.wheels.map(func(w): return w.temp), "pitLimiter": pit != null and pit.in_lane,
		})
	# minimap at ~10 Hz
	map_timer -= dt
	if map_timer <= 0.0:
		map_timer = 0.1
		var dots: Array = []
		for r: Remote in remotes.values():
			if not r.visual.visible or (r.bot == null and not r.buffer.has_data()):
				continue
			dots.append({"x": r.visual.global_position.x, "z": r.visual.global_position.z, "me": false, "color": r.entry.color})
		if sc != null and sc.visible:
			dots.append({"x": sc.visual.global_position.x, "z": sc.visual.global_position.z, "me": false, "color": "#ffb000"})
		hud.draw_map(dots, p.x, p.z, fwd.x, fwd.z)
		update_relative(p, fwd.x, fwd.z)

## The relative box (the cars nearest on the road, as iRacing's F3) and the spotter (a car alongside, within a car's
## length and 1-4.5 m to a side). The time to a car is the road distance over your lap's average speed (your best lap,
## else your last, else ~150 km/h): iRacing estimates it the same way, from a reference lap.
func update_relative(p: Vector3, fx: float, fz: float) -> void:
	var td := track_data
	var L: float = td.length
	var lap_s := func(id: String, x: float, y: float, z: float) -> float:
		var i := TrackMath.nearest_centerline_index(td, x, y, z, rel_hints.get(id, -1), 40)
		rel_hints[id] = i
		return td.cumS[i]
	var my_s: float = lap_s.call(me, p.x, p.y, p.z)
	var ref = best_lap if best_lap != null else (lap_times.back() if not lap_times.is_empty() else null)
	var v_ref: float = L / (ref / 1000.0) if ref != null else 42.0
	var mine = _standing(me)
	var rows: Array = []
	var left := false
	var right := false
	for r: Remote in remotes.values():
		if not r.visual.visible or (r.bot == null and not r.buffer.has_data()):
			continue
		var q := r.visual.global_position
		# alongside: in your car's frame (forward fx, fz; left (fz, -fx))
		var dx := q.x - p.x
		var dz := q.z - p.z
		var along := dx * fx + dz * fz
		var lat := dx * fz - dz * fx
		if absf(along) < 4.8 and absf(lat) > 1.0 and absf(lat) < 4.5 and absf(q.y - p.y) < 3.0:
			if lat > 0.0:
				left = true
			else:
				right = true
		var d: float = (lap_s.call(r.id, q.x, q.y, q.z) as float) - my_s
		if d > L / 2.0:
			d -= L
		if d < -L / 2.0:
			d += L
		var o = _standing(r.id)
		# a lap or more apart in the race (from the classification's distances)
		var laps_apart := 0
		if race.kind == "race" and o != null and mine != null:
			laps_apart = roundi((o.raceDist - mine.raceDist - d) / L)
		rows.append({
			"id": r.id, "name": names.get(r.id, "?"), "color": r.entry.color, "position": o.position if o != null else 0,
			"gapS": d / v_ref, "lap": "ahead" if laps_apart > 0 else ("behind" if laps_apart < 0 else "same"),
			"inPit": o != null and o.inPit, "me": false,
		})
	# three ahead and three behind on the road, nearest first, you in the middle
	var ahead: Array = rows.filter(func(r): return r.gapS >= 0.0)
	ahead.sort_custom(func(a, b): return a.gapS < b.gapS)
	ahead = ahead.slice(0, 3)
	ahead.reverse()
	var behind: Array = rows.filter(func(r): return r.gapS < 0.0)
	behind.sort_custom(func(a, b): return a.gapS > b.gapS)
	behind = behind.slice(0, 3)
	var me_row := {
		"id": me, "name": names.get(me, ""), "color": my_visual.entry.color, "position": mine.position if mine != null else 0,
		"gapS": 0.0, "lap": "same", "inPit": pit != null and pit.in_lane, "me": true,
	}
	hud.set_relative(ahead + [me_row] + behind, left, right)
	# the circuit map: every car, numbered (its car number, else its position), you on yellow
	var map_cars: Array = []
	for r in rows:
		var rem := remote_by_id(r.id)
		var pos := rem.visual.global_position if rem != null else Vector3.ZERO
		var num = car_number(r.id)
		map_cars.append({"x": pos.x, "z": pos.z, "label": str(num) if num != null else (str(r.position) if r.position != 0 else ""), "me": false, "lap": r.lap, "inPit": r.inPit})
	var my_num = car_number(me)
	map_cars.append({"x": p.x, "z": p.z, "label": str(my_num) if my_num != null else (str(mine.position) if mine != null and mine.position != 0 else ""), "me": true, "lap": "same", "inPit": pit != null and pit.in_lane})
	hud.set_map_cars(map_cars)
	spot.left = left
	spot.right = right
	var same_ahead: Array = rows.filter(func(r): return r.gapS >= 0.0 and r.lap == "same" and not r.inPit)
	same_ahead.sort_custom(func(a, b): return a.gapS < b.gapS)
	var same_behind: Array = rows.filter(func(r): return r.gapS < 0.0 and r.lap == "same" and not r.inPit)
	same_behind.sort_custom(func(a, b): return a.gapS > b.gapS)
	spot.aheadS = same_ahead[0].gapS if not same_ahead.is_empty() else null
	spot.behindS = -same_behind[0].gapS if not same_behind.is_empty() else null

# ------------------------------------------------------------ teardown ---

func dispose() -> void:
	running = false
	disposed = true
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
