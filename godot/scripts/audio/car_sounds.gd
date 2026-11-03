class_name CarSounds
extends RefCounted
## Your car's chassis noises (port of CarSounds in audio/audio.ts): tyres, road, kerbs, gravel/grass, a wall scrape,
## wind, rain on the car. The surfaces are recorded loops played faster with speed, over the procedural layer kept
## quieter underneath (shaped noise rendered once, pitched to follow the web game's moving filters).

var a: GameAudio
var _root: Node
var _loops := {}  # recorded layers by name: AudioStreamPlayer, started on first use
var _proc := {}   # procedural layers
var _cur := {}    # smoothed gains
var _scrape_level := 0.0
var _last_t := 0.0
var _level := 1.0
var _level_cur := 1.0

func _init(audio: GameAudio) -> void:
	a = audio
	_root = Node.new()
	a.add_child(_root)
	_mk("squeal", [["bandpass", 900.0, 6.0]], false, 0.0)
	_mk("road", [["lowpass", 260.0, 0.7]], true, 0.0)
	_mk("kerb", [["lowpass", 140.0, 1.0]], true, 20.0)
	_mk("gravel", [["bandpass", 2800.0, 0.8]], false, 0.0)
	_mk("grass", [["lowpass", 700.0, 0.7]], false, 0.0)
	_mk("wind", [["bandpass", 500.0, 0.6]], false, 0.0)
	_mk("rain", [["lowpass", 7000.0, 0.5], ["highpass", 1800.0, 0.5]], false, 0.0)
	_last_t = Time.get_ticks_msec() / 1000.0

func _mk(name: String, chain: Array, brown: bool, am: float) -> void:
	_proc[name] = a.loop_player(a.filtered_loop("cs_" + name, chain, brown, am), "Sfx", _root)
	_cur[name] = 0.0

## The tyres-and-surfaces level (0..1, Settings → Sound).
func level(v: float) -> void:
	_level = v * v

## A contact with a wall this moment (0..1 of a hard hit): keeps the scrape going.
func scrape(v: float) -> void:
	_scrape_level = maxf(_scrape_level, minf(1.0, 0.35 + v * 4.0))

func _db(v: float) -> float:
	return -80.0 if v < 0.0005 else linear_to_db(v)

func _sm(key: String, target: float, tc: float, dt: float) -> float:
	var c: float = _cur.get(key, 0.0)
	c += (target - c) * (1.0 - exp(-dt / tc))
	_cur[key] = c
	return c

## A recorded layer's loop, started on first use, at a random point. False when its recording is not there.
func _layer(name: String, vol: float, rate: float, dt: float) -> bool:
	var s = a.samples.get(name, null)
	if s == null:
		return false
	var p: AudioStreamPlayer = _loops.get(name, null)
	if p == null:
		if vol < 0.001:
			return true
		p = a.loop_player(s, "Sfx", _root)
		_loops[name] = p
	var g := _sm("L" + name, vol, 0.02 if name == "kerb" or name == "scrape" else 0.05, dt)
	p.volume_db = _db(g * _level_cur)
	p.pitch_scale = clampf(rate, 0.1, 4.0)
	return true

func _set_proc(name: String, vol: float, tc: float, dt: float, pitch: float = 1.0) -> void:
	var g := _sm(name, vol, tc, dt)
	var p: AudioStreamPlayer = _proc[name]
	p.volume_db = _db(g * _level_cur)
	p.pitch_scale = clampf(pitch, 0.1, 8.0)

## slip: 0..1 how far past the grip peak the tyres are (asphalt); kerb: 0..1; gravel / grass: fraction of wheels on them.
## sand / road: fraction of wheels in sand / on asphalt or kerbs; wet: the track's wetness; water: under a wheel (puddle).
func update(speed: float, slip: float, kerb: float, gravel: float, grass: float, rain: float, in_cockpit: bool, sand: float = 0.0, road: float = 1.0, wet: float = 0.0, water: float = 0.0) -> void:
	var t := Time.get_ticks_msec() / 1000.0
	var dt := clampf(t - _last_t, 0.0, 0.2)
	_last_t = t
	if dt <= 0.0:
		return
	_level_cur += (_level - _level_cur) * (1.0 - exp(-dt / 0.1))
	var sp := minf(1.0, speed / 75.0)
	var near := 1.0 if in_cockpit else 0.25
	var moving := minf(1.0, speed / 8.0)
	var sq := minf(1.0, slip * 1.25) * minf(1.0, speed / 6.0) * near
	var sq_rec := _layer("squeal", 0.45 * sq, 0.95 + 0.15 * minf(1.0, slip), dt)
	_set_proc("squeal", minf(0.32, slip * 0.4) * minf(1.0, speed / 6.0) * near * (0.35 if sq_rec else 1.0), 0.04, dt, (750.0 + 500.0 * minf(1.0, slip)) / 900.0)
	# the tyres' roar on the road: a recording from inside a car, faster and louder with speed (the shaped noise under it)
	var r_rec := _layer("road", 0.62 * pow(sp, 0.8) * road * near * (1.0 - 0.5 * wet), 0.7 + 0.65 * sp, dt)
	_set_proc("road", 0.32 * sp * near * (0.35 if r_rec else 1.0), 0.1, dt)
	# a wet road hisses under the tyres, and a puddle roars
	_layer("wet_road", (0.85 * clampf(wet * 1.4, 0.0, 1.0) * minf(1.0, speed / 15.0) * road + 1.2 * water * minf(1.0, speed / 10.0)) * (1.0 if in_cockpit else 0.45), 0.85 + 0.35 * sp, dt)
	# a kerb's stripes come at the speed the car crosses them: the recording (a rumble strip at ~100 km/h) faster or slower
	var k_rec := _layer("kerb", 1.0 * kerb * minf(1.0, speed / 10.0) * near, clampf(speed / 28.0, 0.5, 1.7), dt)
	_set_proc("kerb", 0.25 * kerb * minf(1.0, speed / 10.0) * near * (0.35 if k_rec else 1.0), 0.02, dt, maxf(4.0, speed) / 20.0)
	var g_rec := _layer("gravel", 1.1 * gravel * moving * near, 0.75 + 0.5 * minf(1.0, speed / 40.0), dt)
	_set_proc("gravel", 0.35 * gravel * moving * near * (0.35 if g_rec else 1.0), 0.05, dt)
	# turf: the tyres' soft rumble over uneven ground, the grass brushing the car
	_layer("grass_tyre", 1.0 * grass * moving * near, 0.75 + 0.5 * minf(1.0, speed / 30.0), dt)
	_layer("sand", 1.15 * sand * moving * near, 0.7 + 0.5 * minf(1.0, speed / 35.0), dt)
	var gr_rec := _layer("grass", 0.5 * grass * moving * near, 0.8 + 0.4 * minf(1.0, speed / 30.0), dt)
	_set_proc("grass", 0.3 * grass * moving * near * (0.6 if gr_rec else 1.0), 0.05, dt)
	_scrape_level *= exp(-dt * 5.0)
	_layer("scrape", 0.8 * _scrape_level * minf(1.0, speed / 4.0) * (1.0 if in_cockpit else 0.5), 0.8 + 0.4 * minf(1.0, speed / 40.0), dt)
	_set_proc("wind", 0.22 * sp * sp * (0.7 if in_cockpit else 0.15), 0.1, dt, (350.0 + speed * 9.0) / 500.0)
	_set_proc("rain", 0.14 * rain * (1.0 if in_cockpit else 0.6), 0.3, dt)

func dispose() -> void:
	if is_instance_valid(_root):
		_root.queue_free()
