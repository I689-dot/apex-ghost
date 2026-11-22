class_name SessionPits
extends SessionRaceControl
## RaceSession's pit layer: the pit lane built from the layout (its road surface, the garage fronts), the
## bots' stops (when they come in, the crew's work, the end of it) and mine (the pit menu, the crew, the release),
## and the pit service shared by both (the layers: SessionBase, session_base.gd).

## The bots' pit stops (the host simulates them): the mandatory stop on their lap of the window, a stop for fuel when
## the tank won't reach the flag, a drive-through when race control gave one. They drive the pit lane (AiDriver), stand
## while the crew works (service time, as for a player), and their lap logic sees pit in / out.
func update_bot_pits(server_now: float) -> void:
	if start_at == null or server_now < start_at:
		return
	var now := Time.get_ticks_msec() as float
	var rules: Dictionary = race.get("rules", {})
	var win := RaceTracker.pit_window_laps(race_laps())
	var wt: Variant = pit_window_ms()
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
			var exit_s: float = track_data.pitLane.exitS if track_data.get("pitLane") != null else 0.0
			local_tracker.pit_out(r.id, exit_s, server_now)
			b.exit_at = now
		if race.kind != "race" or tr.finished_ms != null or tr.dnf:
			continue
		var lap := tr.laps + 1
		var st: Variant = _standing(r.id)
		var laps_left := race_laps() - tr.laps
		var per_lap := nominal_fuel_per_lap()
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
			var wear := avg_wear(v)
			var fuel_add := fuel_to_add(v, (laps_left + 1) * per_lap)
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
			if b.service_plan != null:
				serve(v, b.service_plan, weather.wetness, weather.rain)
			b.service_end = 0.0
			b.service_plan = null
			b.service_events = null
			b.lift = 0.0
			r.visual.wheel_out = [0.0, 0.0, 0.0, 0.0]
			b.ai.pit_served()

var _tris := PackedFloat32Array()

var _tri_grid := {}

## Height of the visible road at (x, z) under top (the highest surface below the probe), from the triangles near the pit lane.
func _road_height(x: float, z: float, top: float) -> Variant:
	const G := 2.0
	var best: Variant = null
	var k := int(floorf(x / G)) * 65536 + int(floorf(z / G))
	for t: int in _tri_grid.get(k, []):
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

## No driving into the garages (the user, 2026-11-16): an unseen wall just behind the garage fronts along the boxes,
## on its own layer, which every car meets (a bot in the pit lane has its other walls off, to get through the narrow
## entry and exit).
func _build_garage_wall(monitor: PitLaneMonitor) -> void:
	var body := StaticBody3D.new()
	body.name = "garage-wall"
	body.collision_layer = VehicleConsts.LAYER_GARAGE
	body.collision_mask = 0
	body.set_meta("surface", "wall")
	for run: Array in monitor.garage_front():
		var line: PackedVector3Array = run[0]
		var dirs: PackedVector3Array = run[1]
		for i in line.size() - 1:
			var a := line[i]
			var b := line[i + 1]
			var d := Vector3(b.x - a.x, 0.0, b.z - a.z)
			var l := d.length()
			if l < 0.05:
				continue
			var away := (dirs[i] + dirs[i + 1]).normalized()
			var cs := CollisionShape3D.new()
			var box := BoxShape3D.new()
			# long along the front, 3 m tall, 0.3 m thick, its lane-side face on the front line
			box.size = Vector3(0.3, 3.0, l + 0.1)
			cs.shape = box
			var mid := (a + b) * 0.5
			cs.transform = Transform3D(Basis.looking_at(d / l, Vector3.UP), mid + away * 0.15 + Vector3(0, 1.4, 0))
			body.add_child(cs)
	add_child(body)

## Pit lane: markings and the smoothed surface where the map's own is rough.
func _build_pit_lane() -> void:
	var lane: Dictionary = track_data.pitLane
	pit = PitLaneMonitor.new(track_data)
	pit.measure_boxes(wall_probe)
	_build_garage_wall(pit)
	# painted on the *visible* road: the collision under painted layers is flattened a few cm lower, so markings placed
	# on it disappeared under the asphalt. Copy once only the road triangles within ~40 m of the pit lane into one small
	# set (ray casts against the whole road took seconds on a phone)
	var near := {}
	const CELL := 8.0
	var key := func(x: float, z: float) -> int: return int(floorf(x / CELL)) * 65536 + int(floorf(z / CELL))
	for p: Array in lane.points:
		for dx in range(-5, 6):
			for dz in range(-5, 6):
				near[key.call(p[0] + dx * CELL, p[2] + dz * CELL)] = true
	var lo := Vector3(INF, INF, INF)
	var hi := Vector3(-INF, -INF, -INF)
	for p: Array in lane.points:
		lo = Vector3(minf(lo.x, p[0]), minf(lo.y, p[1]), minf(lo.z, p[2]))
		hi = Vector3(maxf(hi.x, p[0]), maxf(hi.y, p[1]), maxf(hi.z, p[2]))
	var pit_box := AABB(lo - Vector3(45, 45, 45), (hi - lo) + Vector3(90, 90, 90))
	var road_re := RegEx.create_from_string("(?i)^(asph|pits|conc_|pavement|tiles|lines|box_decal)")
	var tris := PackedFloat32Array()
	for n: Node in CarVisual._walk(track):
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
			var idx: Variant = arr[Mesh.ARRAY_INDEX]
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
		var h: Variant = _road_height(x, z, y + 2.5)
		if h != null:
			return h
		var hit: Dictionary = gq.cast(Vector3(x, y + 2.5, z), Vector3.DOWN, 6.0)
		return hit.pos.y if not hit.is_empty() else y
	if PIT_SURFACE_MAPS.has(track_data.get("map", "")):
		add_child(pit.build_surface(paint_ground, wall_probe))
	var mine: Variant = null if spectator else {"slot": race.slots.get(me, 0), "name": names.get(me, "")}
	add_child(pit.build_markings(paint_ground, mine))

## Pit lane: limiter, pit-in/out for the lap logic, the service box.
func update_pit(server_now: float) -> void:
	if pit == null or start_at == null or server_now < start_at:
		return
	var v := vehicle
	var edge: float = track_data.widthL[loc.index] if loc.lateral >= 0.0 else track_data.widthR[loc.index]
	var p := v.global_position
	var ev := pit.update(p.x, p.z, absf(loc.lateral) - edge, v.telemetry.speed)
	if ev == "enter":
		conn.send_json({"t": "pit", "in": true})
		local_tracker.pit_in(me, server_now)
		flash(I18n.t("Stop in the yellow box for service"), 4000.0)
	elif ev == "exit":
		conn.send_json({"t": "pit", "in": false})
		local_tracker.pit_out(me, track_data.pitLane.exitS, server_now)
		close_pit_menu()
		flash(I18n.t("Session over") if flagged else I18n.t("Out lap: bring the tyres up to temperature"), 3000.0)
	elif ev == "box" and not pit_hold and finished_ms == null:
		open_pit_menu()
	# service running
	var sv: Variant = service
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
	# my car on the air jacks, drawn above its physics pose (not while a replay places it in world space)
	if not my_visual.top_level:
		my_visual.position.y = jack_lift

func open_pit_menu() -> void:
	var v := vehicle
	pit_hold = true
	v.frozen = true
	var wear: Array = v.wheels.map(func(w: Wheel) -> float: return w.wear)
	# the race: fuel to the finish (and a lap more); the mandatory stop when the window is open
	var laps_left: Variant = maxi(0, race_laps() - my_laps) if race.kind == "race" else null
	var fuel_need: Variant = (laps_left + 1) * fuel_per_lap if laps_left != null else null
	var fuel_add := fuel_to_add(v, fuel_need) if fuel_need != null else 0.0
	var driver := driver_change_state()
	var plan := PitService.default_plan(damage.zones, avg_wear(v), v.compound.id, weather.wetness, fuel_add, driver == "due")
	# a puncture: new tyres whatever their wear
	if damage.punctured.has(true) and plan.tyres == null:
		plan.tyres = v.compound.id
	var opts := {
		"current": v.compound.id, "wear": wear, "temps": v.wheels.map(func(w: Wheel) -> float: return w.temp), "zones": damage.zones,
		"wetness": weather.wetness, "plan": plan,
		"fuel": null if v.fuel_l < 0.0 else {"litres": v.fuel_l, "tank": VehicleConsts.FUEL.tankL, "perLap": fuel_per_lap, "need": fuel_need},
		"driverChange": driver if driver != "" else null,
	}
	pit_menu = PitMenu.new(opts, func(p: Dictionary, seconds: float) -> void:
		var now := Time.get_ticks_msec() as float
		service = {"plan": p, "start": now, "end": now + seconds * 1000.0, "events": PitCrew.stop_timeline(p, damage.zones), "fired": 0},
		func() -> void: release_from_box())
	hud.add_child(pit_menu)

## The end of a stop, the same for a bot's and for mine: the plan's new tyres (with their grip for the water on the
## track) and its fuel.
static func serve(v: Vehicle, plan: Dictionary, wetness: float, rain: float) -> void:
	if plan.tyres != null:
		v.fit_tyres(Tyres.COMPOUNDS[plan.tyres], v.ambient_c + TYRE_OUT_C)
		v.weather_grip = Tyres.compound_grip(v.compound, wetness, rain)
	if plan.fuelL > 0.0 and v.fuel_l >= 0.0:
		v.set_fuel(v.fuel_l + plan.fuelL)

## Litres to add at a stop for need litres in the tank, at most a full tank; 0 without a fuel model (fuel_l < 0).
static func fuel_to_add(v: Vehicle, need: float) -> float:
	if v.fuel_l < 0.0:
		return 0.0
	return ceilf(minf(VehicleConsts.FUEL.tankL - v.fuel_l, maxf(0.0, need - v.fuel_l)))

## The four tyres' mean wear.
static func avg_wear(v: Vehicle) -> float:
	var sum := 0.0
	for w: Wheel in v.wheels:
		sum += w.wear
	return sum / 4.0

func finish_service(plan: Dictionary) -> void:
	var v := vehicle
	serve(v, plan, weather.wetness, weather.rain)
	if plan.tyres != null:
		damage.tyres_changed()
	# dents are visual: reset them with any bodywork repair, even if the damage value had already reached zero
	if plan.body:
		my_visual.reset_damage()
	if damage.repair({"body": plan.body, "suspension": plan.suspension, "engine": plan.engine}):
		v.drivetrain.power_scale = damage.power_scale()
		conn.send_json({"t": "damage", "zones": _round_zones()})
		damage_version_sent = damage.version
	flash(I18n.t("Service complete · GO!"), 2500.0, "good")
	release_from_box()

func release_from_box() -> void:
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
		v.fit_wheel(e.wheel, Tyres.COMPOUNDS[plan.tyres], v.ambient_c + TYRE_OUT_C)
		v.weather_grip = Tyres.compound_grip(v.compound, weather.wetness, weather.rain)
	if not audible or e.kind == "wheelOff" or e.kind == "wheelOn":
		return
	var pan := 0.0
	if e.kind == "gunOff" or e.kind == "gunOn":
		pan = -0.7 if e.wheel % 2 == 0 else 0.7
	if snd != null:
		snd.pit_event(e.kind, pan)
