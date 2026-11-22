class_name SessionRaceControl
extends SessionBots
## RaceSession's race control layer: the safety car (its model, where it drives), the pit and safety-car
## limiters, the driver change, the flag panel and fuel readout, the session's clock text (the layers: SessionBase,
## session_base.gd).

## The safety car's model (race control, race only): loaded after the session, shown when it is deployed.
func _load_safety_car() -> void:
	var entry := CarsDb.safety_car()
	if entry.is_empty():
		return
	var model := Assets.load_car_model(entry, 3, false, 1)
	var visual := CarVisual.new(entry, model, false)
	visual.visible = false
	add_child(visual)
	var look := SafetyCarLook.dress(visual, entry)
	var body: Variant = null
	if contact:
		var r := Remote.new()
		r.entry = entry
		r.visual = visual
		body = _make_proxy(r)
		body.collision_layer = 0 # solid only on track (move_kinematics)
	sc = {"visual": visual, "body": body, "look": look, "s": 0.0, "speed": 0.0, "vel": Vector3.ZERO, "visible": false, "solid": false}

## The safety car: drawn where race control's deterministic path puts it (every client agrees).
func update_safety_car(server_now: float, dt: float) -> void:
	if sc == null or sc_path == null:
		return
	var d: Variant = rc.sc
	var on: bool = d != null and server_now >= d.t0 and (d.inAt == null or server_now < d.inAt)
	sc.visible = on
	if sc.get("look") != null:
		(sc.look as SafetyCarLook).active = on
	sc.visual.visible = true
	if not on or d == null:
		# waiting at the end of the pit lane, as at a real race, lights off
		var lane: Variant = track_data.get("pitLane")
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
				var h: Variant = wall_probe(p[0], p[1], p[2], away.x * sx, away.y * sx, 12.0)
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
	var pl: Variant = track_data.get("pitLane")
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
	for s: Dictionary in standings:
		if s.id == me and s.stopDone:
			return "done"
	var wt: Variant = pit_window_ms()
	if wt != null:
		# by the clock, from the pit entry: the stop has started when the car is in the lane
		var t: float = conn.server_now()
		if pit != null and pit.in_lane:
			t = local_tracker.players[me].pit_in_ms if local_tracker != null and local_tracker.players.has(me) else 0.0
		return "due" if t >= wt.open and t < wt.close else "closed"
	var w := RaceTracker.pit_window_laps(race.laps)
	var lap := my_laps + 1
	return "due" if lap >= w.open and lap <= w.close else "closed"

## Race control's flag for me (the light panel on the HUD) and the fuel readout.
func race_control_hud(server_now: float) -> Dictionary:
	var me_s: Variant = _standing(me)
	var flag := ""
	var flag_text := ""
	var sc_in: float = rc.sc.inAt if rc.sc != null and rc.sc.inAt != null else 0.0
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
		# the dial's fuel bar: share of the tank, litres, laps left ({} without the fuel rule)
		"fuel": {} if fuel < 0.0 else {"frac": fuel / float(VehicleConsts.FUEL.tankL), "litres": fuel, "laps": laps},
	}

## Session clock: time left until the chequered flag (the flag falls at start + session length).
func session_text(server_now: float) -> String:
	if race.kind == "race":
		if finished_ms != null:
			return I18n.t("FINISHED")
		for x: Dictionary in standings:
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
