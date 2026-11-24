class_name SessionHudFeed
extends SessionPits
## RaceSession's HUD feed: what the HUD shows each frame (timing, the lap delta, the relative board, the
## countdown, the start hint, the spectator's board) (the layers: SessionBase, session_base.gd).

## Start of my current lap (server clock), from the local mirror of the lap logic.
## The phone's objective layer in an offline race (RaceObjective), null elsewhere.
var objective: RaceObjective = null

func lap_start_ms() -> float:
	var p: RaceTracker.PlayerRaceState = local_tracker.players.get(me) if local_tracker != null else null
	if p != null:
		return p.lap_start_ms
	return start_at if start_at != null else 0.0

func update_timing() -> void:
	if timing == null or not timing.visible:
		return
	timing.update_list(standings, me, func(id: String) -> Dictionary:
		var p: Variant = _player(id)
		var car := CarsDb.resolve(p.carId) if p != null and p.carId != null else {}
		return {"nick": names.get(id, "?"), "car": car.get("name", ""), "colour": car.get("color", "#888888"), "bot": p != null and p.get("bot", false)})

## Live delta to my best valid lap, driven by the local mirror of the lap logic (no network delay).
func update_lap_delta(now_ms: float, ev: Array) -> void:
	var tr: RaceTracker.PlayerRaceState = local_tracker.players.get(me) if local_tracker != null else null
	if tr == null:
		return
	if lap_delta == null:
		lap_delta = LapDelta.new(track_data.length)
	var d := lap_delta
	if tr.lap_invalid or tr.lap_penalty_ms > 0 or tr.in_pit or tr.out_lap:
		sector_dirty = true
	var lap_dist_now: float = tr.race_dist - tr.laps * float(track_data.length)
	for e: Dictionary in ev:
		if e.type == "sector" and e.playerId == me:
			d.end_sector(int(e.sector), float(track_data.length) if int(e.sector) >= 2 else lap_dist_now, float(e.ms), not sector_dirty)
			sector_dirty = tr.lap_invalid or tr.in_pit
		elif e.type == "lap":
			if e.valid and e.best:
				d.commit_best()
			if e.get("pending", false):
				flash(I18n.t("Clean lap: one more clean lap in a row and your best will count"), 3200.0, "info")
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
			flash(text, 3200.0 if e.get("invalidated", false) or e.get("blackWhite", false) else 2200.0, "bad" if e.get("invalidated", false) or e.get("blackWhite", false) else "warn")
			if e.get("warning", 0) != 0 or e.get("invalidated", false):
				_chime("invalid")
			if not e.get("contact", false) and (e.get("warning", 0) != 0 or e.get("invalidated", false) or e.get("blackWhite", false)):
				incident(1)
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
			flash(text2, 3200.0, "bad")
			_chime("invalid")
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
	live_delta = d.delta(lap_dist, lap_ms, String(Settings.data.deltaMode))

func _start_hint() -> String:
	if race.kind == "race":
		if race.get("raceMs", 0) > 0:
			return I18n.t("RACE · {min} MIN + 1 LAP · standing start", {"min": roundi(race.raceMs / 60000.0)})
		return I18n.t("RACE · {n} LAPS · standing start", {"n": race.laps})
	if race.kind == "practice":
		return I18n.t("FREE PRACTICE · {min} MIN", {"min": roundi(race.sessionMs / 60000.0)})
	return I18n.t("QUALIFYING · {min} MIN · out lap first, timing starts at the line", {"min": roundi(race.sessionMs / 60000.0)})

func update_countdown(ms_left: Variant) -> void:
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

func update_spectator_ui(server_now: float, dt: float) -> void:
	var r := remote_by_id(spec_target)
	var st: Variant = _standing(spec_target)
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
		"damage": 0.0, "damageZones": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0], "wrongWay": false, "abs": false, "tc": false, "message": message, "messageKind": message_kind, "mirrorOn": mirror != null and mirror.visible,
		"sessionText": session_text(server_now), "pitText": I18n.t("WATCHING · {name} · ←/→ change car", {"name": nm}),
		"throttle": 0.0, "brake": 0.0, "steer": 0.0, "compound": "medium", "tyreWear": [0.0, 0.0, 0.0, 0.0],
		"brakeTemps": [0.0, 0.0, 0.0, 0.0], "slipstream": 0.0, "resetHint": false, "tyreTemps": [0.0, 0.0, 0.0, 0.0],
		"flag": "sc" if sc_course else ("fcy" if rc.course == "fcy" else ""),
		"flagText": I18n.t("SAFETY CAR · NO OVERTAKING") if sc_course else (I18n.t("FCY · {kmh} KM/H", {"kmh": int(RaceControl.C.fcyKmh)}) if rc.course == "fcy" else ""),
		"fuelText": "", "fuelLow": false, "fuel": {},
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

	var me_s: Variant = _standing(me)
	var position: int = me_s.position if me_s != null else race.slots.get(me, 0) + 1
	var now_ms := Time.get_ticks_msec() as float
	if now_ms > message_until:
		message = ""
	if now_ms > sector_delta_until:
		sector_delta = null
	var cur_lap: float = 0.0 if race_t < 0.0 or finished_ms != null else server_now - lap_start_ms()
	var rc_hud := race_control_hud(server_now)
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
		"wrongWay": wrong_way_time > 1.2, "abs": tel.absActive, "tc": tel.tcActive, "message": message, "messageKind": message_kind, "mirrorOn": mirror != null and mirror.visible, "sessionText": session_text(server_now),
		"pitText": I18n.t("PIT BOX") if pit_hold else (I18n.t("PIT LANE · LIMITER {n}", {"n": int(pit.lane.speedLimitKmh)}) if pit != null and pit.in_lane else ""),
		"compound": v.compound.id, "tyreWear": v.wheels.map(func(w: Wheel) -> float: return w.wear), "brakeTemps": v.wheels.map(func(w: Wheel) -> float: return w.brake_temp),
		"slipstream": v.wake.strength, "resetHint": stuck_time > 3.0, "tyreTemps": v.wheels.map(func(w: Wheel) -> float: return w.temp),
		"damageZones": damage.zones, "headlights": headlights_on, "throttle": v.pedals.throttle, "brake": v.pedals.brake, "steer": v.steer_angle / v.max_steer,
	}
	state.merge(rc_hud)
	hud.update_state(state)
	if objective != null:
		var rival_pos: Variant = null
		if rival_id != "" and remotes.has(rival_id):
			var rr: Remote = remotes[rival_id]
			rival_pos = rr.visual.global_position
			var rs: Variant = _standing(rival_id)
			objective.set_rival_behind(rs != null and me_s != null and int(me_s.position) < int(rs.position))
		objective.update(dt, position if me_s != null else 0, p, rival_pos, get_viewport().get_camera_3d(), int(career.cleanLaps), v.wake.strength, race_t >= 0.0 and finished_ms == null)
	hud.update_damage(damage, kb.held("damage"))
	if race_t >= 0.0 and finished_ms == null:
		career.km += (tel.speed * dt) / 1000.0
	if dash != null:
		dash.update_dash(dt, {
			"gear": tel.gear, "kmh": tel.speed * 3.6, "rpm": tel.rpm, "redline": float(v.specs.redlineRpm), "limiter": float(v.specs.limiterRpm),
			"lapMs": cur_lap, "lastMs": lap_times.back() if not lap_times.is_empty() else null, "bestMs": best_lap,
			"deltaMs": live_delta if my_laps > 0 and finished_ms == null else null, "position": position, "total": race.grid.size(),
			"tc": v.assists.tc, "abs": v.assists.abs, "bias": float(v.specs.brakeBiasFront), "fuelL": v.fuel_l if v.fuel_l >= 0.0 else null,
			"psi": v.wheels.map(func(w: Wheel) -> float: return w.pressure), "temps": v.wheels.map(func(w: Wheel) -> float: return w.temp), "pitLimiter": pit != null and pit.in_lane,
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
	var ref: Variant = best_lap if best_lap != null else (lap_times.back() if not lap_times.is_empty() else null)
	var v_ref: float = L / (ref / 1000.0) if ref != null else 42.0
	var mine: Variant = _standing(me)
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
		var o: Variant = _standing(r.id)
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
	var ahead: Array = rows.filter(func(r: Dictionary) -> bool: return r.gapS >= 0.0)
	ahead.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a.gapS < b.gapS)
	ahead = ahead.slice(0, 3)
	ahead.reverse()
	var behind: Array = rows.filter(func(r: Dictionary) -> bool: return r.gapS < 0.0)
	behind.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a.gapS > b.gapS)
	behind = behind.slice(0, 3)
	var me_row := {
		"id": me, "name": names.get(me, ""), "color": my_visual.entry.color, "position": mine.position if mine != null else 0,
		"gapS": 0.0, "lap": "same", "inPit": pit != null and pit.in_lane, "me": true,
	}
	hud.set_relative(ahead + [me_row] + behind, left, right)
	# the circuit map: every car, numbered (its car number, else its position), you on yellow
	var map_cars: Array = []
	for r: Dictionary in rows:
		var rem := remote_by_id(r.id)
		var pos := rem.visual.global_position if rem != null else Vector3.ZERO
		var num: Variant = car_number(r.id)
		map_cars.append({"x": pos.x, "z": pos.z, "label": str(num) if num != null else (str(r.position) if r.position != 0 else ""), "me": false, "lap": r.lap, "inPit": r.inPit})
	var my_num: Variant = car_number(me)
	map_cars.append({"x": p.x, "z": p.z, "label": str(my_num) if my_num != null else (str(mine.position) if mine != null and mine.position != 0 else ""), "me": true, "lap": "same", "inPit": pit != null and pit.in_lane})
	hud.set_map_cars(map_cars)

func ensure_ghost_visual() -> void:
	if ghost_visual != null or ghost_loading or not Settings.data.ghost:
		return
	ghost_loading = true
	var entry: Dictionary = vehicle.car
	# (read in threads, the session going on: Assets.fetch)
	@warning_ignore("unused_variable")
	var held := await Assets.fetch(Assets.car_files(entry, 3, false))
	if not is_inside_tree():
		return
	var model := Assets.load_car_model(entry, 3, false)
	var v := CarVisual.new(entry, model, false)
	v.set_opacity(0.3)
	v.visible = false
	add_child(v)
	CarPaint.apply(v, Settings.data.livery)
	ghost_visual = v

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
