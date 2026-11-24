class_name SessionBots
extends SessionContact
## RaceSession's bots layer: the AI cars this session simulates (made on the grid, released one at a time,
## driven each step with a cap behind slower cars and under yellow flags) and the state they send (the layers:
## SessionBase, session_base.gd).

## The rival of a phone career race (MobileModes adds a bot of that name; Progression.current_boss), "" for none, set
## by RaceSession before the bots are made; the bot found with it (rival_id: the HUD's rival marker).
var boss_name := ""
var rival_id := ""
## How much faster the rival is than the field's best (its share of the AI difficulty).
const BOSS_SKILL := 1.03

## The host simulates every bot: a Vehicle + AiDriver in this physics world.
func _create_local_bots(entries: Dictionary) -> void:
	var mp: Variant = _player(me)
	if mp == null or not mp.get("host", false):
		return
	for r: Remote in remotes.values():
		var p: Variant = _player(r.id)
		if p == null or not p.get("bot", false) or p.carId == null:
			continue
		var entry: Variant = entries.get(p.carId)
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
		v.fit_tyres(Tyres.COMPOUNDS[Tyres.compound_for_weather(weather.wetness)], v.ambient_c + TYRE_OUT_C)
		if contact:
			v.set_contact(true)
		# fuel for the race and a little more (they refuel at a stop if a tank is not enough), 40 l for qualifying
		var per_lap := nominal_fuel_per_lap()
		if race.get("rules", {}).get("fuel", false):
			v.set_fuel(minf(VehicleConsts.FUEL.tankL, race_laps() * per_lap * 1.05 + 2.0) if race.kind == "race" else 40.0)
		var win := RaceTracker.pit_window_laps(race_laps())
		# skill and racing line differ per bot so they spread out (deterministic per slot); the player's AI difficulty
		# scales every bot's pace
		var skill: float = (0.88 + ((r.slot * 37) % 10) / 100.0) * float(Settings.data.ai.difficulty)
		# a phone career race's rival (Progression.current_boss: a bot of that name in a solo room) drives at the top of
		# the field's spread and a little over: the race to beat (the HUD marks them: rival_id)
		if boss_name != "" and str(names.get(r.id, "")) == boss_name:
			skill = 1.0 * float(Settings.data.ai.difficulty) * BOSS_SKILL
			rival_id = r.id
		var lane: float = (((r.slot * 7) % 5) - 2) * 0.45
		var b := LocalBot.new()
		b.vehicle = v
		b.ai = AiDriver.new(track_data, v, skill, lane)
		b.ai.set_seed(r.id)
		b.pit = PitLaneMonitor.new(track_data) if track_data.get("pitLane") != null else null
		# spread over the window so they don't all stop on the same lap
		b.stop_lap = win.open + (r.slot % (win.close - win.open + 1))
		r.bot = b
		# the stand-in node is the bot's own vehicle: its visual hangs from it
		r.visual.reparent(v, false)
		r.visual.position = Vector3.ZERO
		r.visual.rotation = Vector3.ZERO
		if b.pit != null:
			b.pit.measure_boxes(wall_probe)
			var ab: Array = b.pit.boxes()[b.pit.box_of(r.slot)]
			b.ai.pit_box = roundi((ab[0] + ab[1]) / 2.0)
			b.ai.pit_box_shift = b.pit.shift_at(b.ai.pit_box)

## AI cars, simulated on the host. As in a real qualifying session they leave one at a time (BOT_RELEASE_MS apart, in
## grid order) instead of all launching side by side onto the same line, and they keep their distance behind a car
## directly ahead.
func step_bots(race_t: float) -> void:
	var bots: Array = remotes.values().filter(func(r: Remote) -> bool: return r.bot != null)
	bots.sort_custom(func(a: Remote, b: Remote) -> bool: return a.slot < b.slot)
	for order in bots.size():
		var r: Remote = bots[order]
		var b := r.bot
		# qualifying: one at a time; the race: everyone at the green light
		var started: bool = race_t >= (0.0 if race.kind == "race" else order * BOT_RELEASE_MS)
		b.vehicle.frozen = not started or b.service_end > 0.0
		# the driver decides at AI_HZ (half the bots one physics step, half the next) and its controls hold in between:
		# the car's physics still runs every step. A bot's decisions (track position, racing line, traffic against every
		# car) were the larger share of a full grid's physics time.
		if (step_count + r.slot) % AI_DIV != 0 and b.decided != started:
			continue
		b.decided = started
		var dt := FIXED_DT * AI_DIV
		var tr: RaceTracker.PlayerRaceState = local_tracker.players.get(r.id) if local_tracker != null else null
		var gates: Array = track_data.gates
		var cp := -1.0
		if tr != null and tr.passed >= 0:
			cp = gates[posmod(tr.next_gate - 1 + gates.size(), gates.size())].s
		var cap := follow_cap(r, dt) if started else INF
		var c := b.ai.update(dt, started, b.vehicle.weather_grip * b.vehicle.tyre_grip_avg(), cp, cap)
		b.vehicle.controls = c

## Traffic for a bot: a slower car ahead in its lane makes it pull out and pass, keeping to that side until the car
## is behind it; it only lifts when it is about to run into one before it has moved over. Returns the speed cap.
## (A plain loop: this was a lambda assigning to the function's locals, which GDScript captures by value, so no bot
## ever backed off or pulled out for traffic.)
func follow_cap(r: Remote, dt: float) -> float:
	var b := r.bot
	var v := b.vehicle
	var p := v.global_position
	var fb := v.global_transform.basis.z
	var fx := fb.x
	var fz := fb.z
	var my_speed: float = v.telemetry.speed
	var cap := INF
	var block_along := INF
	var block_lat := 0.0
	var beside := false
	var lane_w := 1.6 if b.ai.pass_target != 0.0 else 2.2
	var n := remotes.size() + (0 if spectator else 1)
	var others := remotes.values()
	for k in n:
		var op: Vector3
		var speed: float
		var ob: Vector3
		if k < others.size():
			var o: Remote = others[k]
			if o == r:
				continue
			var node: Node3D = o.bot.vehicle if o.bot != null else o.visual
			op = node.global_position
			ob = node.global_transform.basis.z
			speed = o.vel.length()
		else:
			op = vehicle.global_position
			ob = vehicle.global_transform.basis.z
			speed = vehicle.telemetry.speed
		# not the same piece of road: a car on the other leg of a hairpin or on a bridge / underpass looked like a car
		# ahead; a stopped car is avoided whichever way
		if absf(op.y - p.y) > 2.5 or (speed > 5.0 and ob.x * fx + ob.z * fz < 0.3):
			continue
		var dx := op.x - p.x
		var dz := op.z - p.z
		var along := dx * fx + dz * fz
		var lat := dx * fz - dz * fx # + = left of the bot
		# alongside on the side we moved to: hold that side until it is behind us
		if along > -6.0 and along <= 3.0 and absf(lat) < 3.4:
			beside = true
		if along <= 0.0 or along > 40.0 or absf(lat) > 2.6:
			continue
		# in our path (narrower once we are pulling out): keep about 10 m, back off if closer
		if absf(lat) < lane_w:
			cap = minf(cap, maxf(0.0, speed + (along - 10.0) * 0.7))
		if along <= 3.0 or (speed > my_speed - 1.5 and along > 14.0):
			continue # as fast as us and not close: just follow
		if along < block_along:
			block_along = along
			block_lat = lat
	# the safety car: queue behind it, seen from far enough to stop behind it
	if sc != null and sc.visible:
		var trp: RaceTracker.PlayerRaceState = local_tracker.players.get(r.id) if local_tracker != null else null
		var gap := TrackMath.wrap_delta(trp.progress_s, sc.s, track_data.length) if trp != null else -1.0
		if gap > 0.0 and gap < 220.0:
			cap = minf(cap, sqrt(sc.speed * sc.speed + 2.0 * 7.0 * maxf(0.0, gap - 18.0)))
	# no overtaking under a caution (FCY, safety car, a yellow flag here): follow instead
	var prog: float = local_tracker.players[r.id].progress_s if local_tracker != null and local_tracker.players.has(r.id) else -1e9
	var caution: bool = rc.course != "green" or in_yellow(prog)
	var found := not caution and block_along < INF
	if found and (b.ai.pass_target != 0.0 or b.ai.can_pass()):
		# pass on the side away from it (it is left of us -> go right), else keep the side already chosen
		if b.ai.pass_target == 0.0:
			b.ai.pass_target = -PASS_OFFSET if block_lat > 0.3 else (PASS_OFFSET if block_lat < -0.3 else b.ai.roomy_side() * PASS_OFFSET)
		b.pass_hold = 1.0
	elif beside and b.ai.pass_target != 0.0:
		b.pass_hold = 1.0
	else:
		b.pass_hold -= dt
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
	for y: Array in rc.yellows:
		if TrackMath.wrap_delta(y[0], s, L) >= 0.0 and TrackMath.wrap_delta(s, y[1], L) >= 0.0:
			return true
	return false
