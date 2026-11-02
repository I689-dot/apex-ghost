class_name SessionAudio
extends RefCounted
## Everything audible in a race (port of audio/sessionAudio.ts): your engine (in the cockpit, or positioned while the
## cinematic camera is elsewhere), the nearest other cars' engines (positioned, with Doppler), your chassis noises
## and the circuit ambience.

const MAX_OTHERS := 4
const UPDATE_S := 1.0 / 30.0
const HEAR_M := 220.0
const SOUND_SPEED := 343.0

var a: GameAudio
var my_entry: Dictionary
var _mine: EngineVoice = null
var _car: CarSounds
var _amb: Ambience
var _others := {}
var _crowd_t := 0.0
var _crowd := 0.0
var _grandstands: Array[Vector3] = []
var _last_gear := 1
var _acc := 0.0

func _init(audio: GameAudio, entry: Dictionary, track: Dictionary) -> void:
	a = audio
	my_entry = entry
	_car = CarSounds.new(a)
	_amb = Ambience.new(a)
	# grandstands line the start/finish straight and the Mercedes Arena (first ~1.2 km)
	var cl: Array = track.centerline
	var cum: Array = track.cumS
	var n := cl.size() / 3
	for i in range(0, n, 6):
		var s: float = cum[i]
		if s < 1200.0 or s > float(track.length) - 450.0:
			_grandstands.append(Vector3(cl[i * 3], cl[i * 3 + 1], cl[i * 3 + 2]))

## o: {listener, right, inCockpit, myPos, myVel, vehicle, others: [{key, entry, pos, vel, rpm?, load?, gearRatio?}], rain, day}
func update(dt: float, o: Dictionary) -> void:
	var v: Vehicle = o.vehicle
	var tel: Dictionary = v.telemetry
	# gear changes are caught every frame (the ignition-cut bap is short); the rest at 30 Hz
	if _mine != null and tel.gear != _last_gear:
		if tel.gear > 0 and _last_gear > 0:
			_mine.shift()
			if o.inCockpit:
				a.burst("highpass", 3500.0, 0.8, 0.03, 0.12)
		_last_gear = tel.gear
	_acc += dt
	if _acc < UPDATE_S:
		return
	dt = _acc
	_acc = 0.0
	# ---- my engine
	if _mine == null:
		_mine = a.create_engine(EngineProfiles.for_car(my_entry))
	var ratio := absf(v.drivetrain.ratio())
	if o.inCockpit:
		_mine.set_state(tel.rpm, v.pedals.throttle, ratio, 0.95, 0.0)
	else:
		var p := _place(o.myPos, o.myVel, o)
		_mine.set_state(tel.rpm, v.pedals.throttle, ratio, p.gain, p.pan, p.doppler)
	# ---- chassis noises
	var slip := 0.0
	var kerb := 0.0
	var gravel := 0.0
	var grass := 0.0
	var tp = v.tire.p
	for w in v.wheels:
		if not w.contact:
			continue
		if w.surface == "asphalt" or w.surface == "curb":
			var s := maxf(absf(w.slip_ratio) / tp.kappa_peak, absf(w.slip_angle) / tp.alpha_peak)
			slip = maxf(slip, s - 0.85)
		if w.surface == "curb":
			kerb += 0.25
		elif w.surface == "gravel" or w.surface == "sand":
			gravel += 0.25
		elif w.surface == "grass":
			grass += 0.25
	_car.level(Settings.data.audio.tyres)
	_car.update(tel.speed, maxf(0.0, slip), kerb, gravel, grass, o.rain, o.inCockpit)
	# ---- other cars: voices for the nearest few
	var near: Array = []
	var listener: Vector3 = o.listener
	for c in o.others:
		var d: float = c.pos.distance_to(listener)
		if d < HEAR_M and 1.0 / (1.0 + pow(d / 14.0, 1.5)) > 0.015:
			near.append([d, c])
	near.sort_custom(func(x, y): return x[0] < y[0])
	near = near.slice(0, MAX_OTHERS)
	var keep := {}
	for x in near:
		keep[x[1].key] = true
	for k in _others.keys():
		if not keep.has(k):
			_others[k].voice.stop()
			_others.erase(k)
	for x in near:
		var c: Dictionary = x[1]
		var ov = _others.get(c.key, null)
		if ov == null:
			var voice := a.create_engine(EngineProfiles.for_car(c.entry))
			ov = {"voice": voice, "prev_speed": c.vel.length(), "load": 0.3, "gear": 1}
			_others[c.key] = ov
		var speed: float = c.vel.length()
		var p := _place(c.pos, c.vel, o)
		var rpm = c.get("rpm", null)
		var ld = c.get("load", null)
		var rt = c.get("gearRatio", null)
		if rpm == null or ld == null or rt == null:
			var est := _estimate_rpm(c.entry, speed, ov.gear)
			ov.gear = est.gear
			rpm = est.rpm
			rt = est.ratio
			var acc: float = (speed - ov.prev_speed) / maxf(1e-3, dt)
			ov.load += ((1.0 if acc > 0.6 else (0.0 if acc < -2.0 else 0.35)) - ov.load) * minf(1.0, dt * 6.0)
			ld = ov.load
		ov.prev_speed = speed
		# the other cars at the player's opponents level (Settings → Sound)
		ov.voice.set_state(rpm, ld, rt, p.gain * 0.9 * pow(Settings.data.audio.opponents, 2.0), p.pan, p.doppler)
	# ---- ambience
	_crowd_t -= dt
	if _crowd_t <= 0.0:
		_crowd_t = 0.25
		var d := INF
		for g in _grandstands:
			d = minf(d, g.distance_to(listener))
		_crowd = clampf(1.0 - (d - 40.0) / 260.0, 0.0, 1.0)
	var quiet := (1.0 - minf(1.0, tel.speed / 20.0)) if o.inCockpit else 1.0
	_amb.update(_crowd, o.day, o.rain, quiet)

## Distance attenuation, stereo position and Doppler factor of a source for the listener.
func _place(pos: Vector3, vel: Vector3, o: Dictionary) -> Dictionary:
	var d: Vector3 = pos - o.listener
	var dist := maxf(0.5, d.length())
	d /= dist
	var gain := 1.0 / (1.0 + pow(dist / 14.0, 1.5))
	var pan := clampf(d.dot(o.right) * 0.85, -0.9, 0.9)
	# source moving towards the listener → higher pitch
	var radial := -vel.dot(d)
	var doppler := clampf(SOUND_SPEED / (SOUND_SPEED - radial), 0.75, 1.3)
	return {"gain": gain, "pan": pan, "doppler": doppler}

## A moment of the pit stop (pit_crew.stop_timeline): wheel guns, jacks and the fuel coupling, panned to their side
## of the car (-1 left … 1 right).
func pit_event(kind: String, pan: float) -> void:
	if kind == "gunOff" or kind == "gunOn":
		a.wheel_gun(pan)
	elif kind == "jackUp" or kind == "jackDown":
		a.air_jack(kind == "jackUp", pan)
	else:
		a.clunk(pan)

func impact(severity: float) -> void:
	a.impact(severity)

## Touching a wall (every contact event while rubbing it): the scrape.
func scrape(severity: float) -> void:
	_car.scrape(severity)

func beep(go: bool) -> void:
	if Settings.data.audio.chimes:
		a.countdown_beep(go)

func chime(kind: String) -> void:
	if Settings.data.audio.chimes:
		a.chime(kind)

func dispose() -> void:
	if _mine != null:
		_mine.stop()
	for ov in _others.values():
		ov.voice.stop()
	_others.clear()
	_car.dispose()
	_amb.dispose()

## Remote cars only send their pose: pick the gear an auto box would use at this speed (with hysteresis).
func _estimate_rpm(e: Dictionary, speed: float, gear: int) -> Dictionary:
	var s: Dictionary = e.specs
	var r: float = e.wheels.RL.radius if e.wheels.has("RL") else 0.34
	var wheel_rpm := (speed / (TAU * r)) * 60.0
	var gears: Array = s.gears
	var rpm_in := func(g: int) -> float: return wheel_rpm * gears[g - 1] * s.finalDrive
	var g := mini(maxi(1, gear), gears.size())
	while g < gears.size() and rpm_in.call(g) > s.redlineRpm * 0.95:
		g += 1
	while g > 1 and rpm_in.call(g - 1) < s.redlineRpm * 0.7:
		g -= 1
	var ratio: float = gears[g - 1] * s.finalDrive
	return {"rpm": maxf(s.idleRpm, rpm_in.call(g)), "gear": g, "ratio": ratio}
