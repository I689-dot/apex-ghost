class_name SessionWorld
extends SessionHudFeed
## RaceSession's world layer: the weather as the cars feel it (grip, rubber, water, air), spray and splashes on a
## wet track, and the reflection probes over the track and the cars (the layers: SessionBase, session_base.gd).

var _in_water := false
## Tyre smoke and dust from every car with physics here (TyreSmoke).
var tyre_smoke: TyreSmoke = null
## Cars further than this from the camera puff no smoke (m): too small to see, and the pool is shared.
const SMOKE_RANGE := 220.0

func _apply_weather() -> void:
	var w := weather
	# grip of the fitted compound for the water on the track (slicks aquaplane, wets bite)
	vehicle.weather_grip = Tyres.compound_grip(vehicle.compound, w.wetness, w.rain)
	# rubber builds on the racing line through the session (the same clock everywhere)
	var rubber := VehicleConsts.track_rubber(conn.server_now() - start_at if start_at != null else 0.0, w.wetness)
	vehicle.rubber = rubber
	vehicle.wetness = w.wetness
	vehicle.puddles = wet_fx
	if wet_fx != null:
		wet_fx.set_weather(w.wetness, w.rain)
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
		bv.puddles = wet_fx
		bv.set_air(air.airC, air.trackC, air.airDensity)
	if env != null:
		track.set_night(env.night)
		headlights_on = env.night > 0.3 or w.fog > 0.45 or w.rain > 0.4 or (env.sun_elevation < 0.08 and w.clouds > 0.6)
	vehicle.drivetrain.power_scale = damage.power_scale()
	track.apply_wetness(w.wetness)
	if road_wear != null:
		road_wear.set_wetness(w.wetness)
	if tyre_smoke != null:
		tyre_smoke.set_wetness(w.wetness)

## Spray behind every car near the camera on a wet track, and a splash (with its sound) where my wheels hit a puddle.
func _update_spray(dt: float, cam_pos: Vector3) -> void:
	if wet_fx == null:
		return
	var wet: float = weather.wetness
	var visuals: Array = [my_visual]
	for r: Remote in remotes.values():
		visuals.append(r.visual)
	for vis: CarVisual in visuals:
		if vis == null or not is_instance_valid(vis):
			continue
		var sp: CarSpray = sprays.get(vis)
		if sp == null:
			if wet < 0.08:
				continue
			sp = CarSpray.new(float(vis.entry.dims.length), float(vis.entry.dims.width))
			vis.add_child(sp)
			sprays[vis] = sp
		sp.update(dt, wet, cam_pos.distance_to(vis.global_position) < 160.0)
	if my_visual == null or vehicle == null or not sprays.has(my_visual):
		return
	var water := 0.0
	for w in vehicle.wheels:
		water = maxf(water, w.water)
	var speed: float = vehicle.telemetry.speed
	var hit := water > 0.12 and speed > 10.0
	if hit and not _in_water:
		var strength := clampf(water * 1.5, 0.0, 1.0) * clampf(speed / 40.0, 0.2, 1.0)
		sprays[my_visual].splash(strength)
		if snd != null:
			snd.splash(strength)
	_in_water = hit

## Smoke and dust from the sliding wheels of my car and the bots near the camera (other players' cars carry no tyre
## state over the network).
func _update_tyre_smoke(dt: float, cam_pos: Vector3) -> void:
	if tyre_smoke == null:
		return
	if vehicle != null and cam_pos.distance_to(vehicle.global_position) < SMOKE_RANGE:
		tyre_smoke.emit_from(vehicle, dt)
	for r: Remote in remotes.values():
		if r.bot != null and cam_pos.distance_to(r.bot.vehicle.global_position) < SMOKE_RANGE:
			tyre_smoke.emit_from(r.bot.vehicle, dt)
	tyre_smoke.update_puffs(dt, cam_pos)

## Reflection probes along the lap for every car's paint, glass and rims (2026-11-21, the user: the cars looked like
## plastic, the same from every side): without them the other cars (and yours below High) reflected the sky alone, so
## a panel looked the same wherever the car was. Every ~170 m (at most 40 a lap: the reflection atlas holds 64), a
## 230 x 60 m probe over the centreline, captured once with the circuit, the forest and the stands (not the cars), and
## given to the cars only (reflection_mask: the track's own materials keep the sky's and SSR). Captured again, a few a
## second, when the sun has moved on (the time of day runs in a race).
var track_probes: Array[ReflectionProbe] = []

var _probes_sun := Vector3.ZERO

var _probe_redo := -1

func _add_track_probes(own_too: bool) -> void:
	var cl: Array = track_data.centerline
	var n := cl.size() / 3
	var length := float(track_data.length)
	var step_m := maxf(170.0, length / 40.0)
	var cum: Array = track_data.cumS
	var next_s := 0.0
	var holder := Node3D.new()
	holder.name = "track_probes"
	add_child(holder)
	for i in n:
		if float(cum[i]) < next_s:
			continue
		next_s = float(cum[i]) + step_m
		var p := ReflectionProbe.new()
		p.update_mode = ReflectionProbe.UPDATE_ONCE
		p.size = Vector3(230, 60, 230)
		p.position = Vector3(cl[i * 3], float(cl[i * 3 + 1]) + 2.0, cl[i * 3 + 2])
		p.max_distance = 700.0
		p.cull_mask = 1 | 2
		p.reflection_mask = CarVisual.VIS_CARS | (CarVisual.VIS_OWN if own_too else 0)
		p.enable_shadows = true
		p.box_projection = false
		p.intensity = 1.0
		p.blend_distance = 30.0
		p.mesh_lod_threshold = 2.0
		p.ambient_mode = ReflectionProbe.AMBIENT_DISABLED
		holder.add_child(p)
		track_probes.append(p)
	if env != null:
		_probes_sun = env.sun_dir

## The probes again when the sun has moved more than ~6 degrees since they were captured: one every few frames.
func _refresh_track_probes() -> void:
	if track_probes.is_empty() or env == null:
		return
	if _probe_redo < 0:
		if env.sun_dir.dot(_probes_sun) > 0.9945:
			return
		_probes_sun = env.sun_dir
		_probe_redo = 0
	if Engine.get_process_frames() % 6 != 0:
		return
	var p := track_probes[_probe_redo]
	# (a once probe captures again when anything about it changes)
	p.position.y += 0.001 if _probe_redo % 2 == 0 else -0.001
	_probe_redo += 1
	if _probe_redo >= track_probes.size():
		_probe_redo = -1

## A reflection probe riding with your car (High / Ultra): the paint, glass and rims reflect the track, the barriers,
## the pit buildings and the cars round you, not only the sky. Your own car is left out of it (it would reflect its
## own inside), and so are the forest, grass and crowd (layer 2: the cost of drawing six views of them every frame).
func _add_car_probe(v: CarVisual) -> void:
	var p := ReflectionProbe.new()
	p.name = "car_probe"
	p.update_mode = ReflectionProbe.UPDATE_ALWAYS
	p.size = Vector3(40, 20, 40)
	p.position = Vector3(0, 1.0, 0)
	p.max_distance = 400.0
	p.cull_mask = 1 | CarVisual.VIS_CARS
	p.enable_shadows = false
	p.intensity = 1.0
	p.blend_distance = 4.0
	p.mesh_lod_threshold = 4.0
	# reflections only: its ambient (the captured surroundings) replaced the environment's fill round the car, and at
	# night the capture is nearly black (the cockpit and the road near you went black on High and Ultra)
	p.ambient_mode = ReflectionProbe.AMBIENT_DISABLED
	v.add_child(p)
