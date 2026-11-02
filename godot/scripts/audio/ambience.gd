class_name Ambience
extends RefCounted
## Circuit ambience (port of Ambience in audio/audio.ts): the countryside (wind in the trees, birds by day), the
## crowd near the grandstands (start/finish straight and the Mercedes Arena), distant thunder in heavy rain.

var a: GameAudio
var _root: Node
var _bed: AudioStreamPlayer
var _crowd: AudioStreamPlayer
var _bed_g := 0.0
var _crowd_g := 0.0
var _next_bird := 0.0
var _next_thunder := 0.0
var _last_t := 0.0
var _birds: Array = []

func _init(audio: GameAudio) -> void:
	a = audio
	_root = Node.new()
	a.add_child(_root)
	_bed = a.loop_player(a.filtered_loop("amb_bed", [["lowpass", 420.0, 0.5]], true), "Amb", _root)
	_crowd = a.loop_player(a.filtered_loop("amb_crowd", [["bandpass", 750.0, 0.6]]), "Amb", _root)
	_last_t = Time.get_ticks_msec() / 1000.0

## crowd: 0..1 closeness to the grandstands; day: 0..1; rain: 0..1;
## quiet: 0..1 how much the own engine masks the countryside (birds only when it's quiet)
func update(crowd: float, day: float, rain: float, quiet: float) -> void:
	var now := Time.get_ticks_msec()
	var t := now / 1000.0
	var dt := clampf(t - _last_t, 0.0, 0.2)
	_last_t = t
	_bed_g += ((0.1 + 0.08 * rain) - _bed_g) * (1.0 - exp(-dt / 0.5))
	_bed.volume_db = linear_to_db(maxf(_bed_g, 1e-4))
	# a broad murmur with slow swells (0.13 Hz, 0.7 ± 0.3)
	var swell := 0.7 + 0.3 * sin(TAU * 0.13 * t)
	_crowd_g += ((0.16 * crowd * (0.4 + 0.6 * day) * (1.0 - 0.5 * rain)) - _crowd_g) * (1.0 - exp(-dt / 0.4))
	_crowd.volume_db = linear_to_db(maxf(_crowd_g * swell, 1e-4))
	if day > 0.3 and rain < 0.3 and quiet > 0.3 and now > _next_bird:
		_next_bird = now + 900.0 + randf() * 3500.0
		_bird(quiet)
	if rain > 0.75 and now > _next_thunder:
		_next_thunder = now + 20000.0 + randf() * 40000.0
		if _next_thunder - now < 59000.0:
			a.burst("lowpass", 160.0, 0.5, 3.5, 0.5, "Amb", randf() * 1.4 - 0.7)

func _bird(vol: float) -> void:
	var base := 2600.0 + randf() * 2600.0
	var notes := 2 + randi() % 4
	var n := int(0.12 * a.RATE)
	var pan := randf() * 2.0 - 1.0
	var delay := 0.0
	for i in notes:
		var f0 := base * (0.9 + randf() * 0.2)
		var f1 := base * (1.15 + randf() * 0.4)
		var d := PackedFloat32Array()
		d.resize(n)
		var ph := 0.0
		for j in n:
			var t := float(j) / a.RATE
			var f := f0 * pow(f1 / f0, minf(t / 0.06, 1.0))
			ph += f / a.RATE
			var env := minf(1.0, t / 0.01) * (1.0 if t < 0.04 else exp(-(t - 0.04) / 0.02))
			d[j] = sin(TAU * ph) * env
		a.play_stream(GameAudio.to_stream(d), 0.03 * vol, 1.0, "Amb", pan, delay)
		delay += 0.09 + randf() * 0.06

func dispose() -> void:
	if is_instance_valid(_root):
		_root.queue_free()
