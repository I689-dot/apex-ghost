class_name GameAudio
extends Node
## Game audio (port of audio/audio.ts): the mixer buses (master with the limiter, engine, effects, ambience, radio),
## the shared noise loops and recordings, and the one-shots (tones, noise bursts, crashes, pit tools, chimes).
## The web game builds these with Web Audio nodes; here the shaped noise and tones are rendered once into
## AudioStreamWAV buffers (cached) and played through panning buses, which costs no per-frame DSP.

const RATE := 44100
const SAMPLE_NAMES := ["gravel", "kerb", "grass", "squeal", "scrape", "crash_light", "crash_medium", "crash_heavy", "crash_debris"]
const LOOPED := ["gravel", "kerb", "grass", "squeal", "scrape"]
const PAN_STEPS := 8

## There is no worklet / main-thread distinction here: the engine voices are always the cheap recorded-loop kind.
var worklet_ok := true
var settled := true
var samples := {}
var noise: PackedFloat32Array
var brown: PackedFloat32Array
var _cache := {}
var _pan_buses := {}

func _init(levels: Dictionary = {}) -> void:
	_setup_buses()
	set_levels(levels if not levels.is_empty() else Settings.data.audio)
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	var n := RATE * 3
	noise = PackedFloat32Array()
	brown = PackedFloat32Array()
	noise.resize(n)
	brown.resize(n)
	var last := 0.0
	for i in n:
		var w := rng.randf() * 2.0 - 1.0
		noise[i] = w
		last = (last + 0.02 * w) / 1.02
		brown[i] = last * 3.5
	for name in SAMPLE_NAMES:
		var path := "res://assets/audio/surface/%s.wav" % name
		if not ResourceLoader.exists(path):
			push_warning("[audio] %s not loaded: the procedural sound stays" % name)
			continue
		var s = load(path)
		if s is AudioStreamWAV:
			s = s.duplicate()
			if name in LOOPED:
				s.loop_mode = AudioStreamWAV.LOOP_FORWARD
				s.loop_begin = 0
				s.loop_end = s.data.size() / (2 * (2 if s.stereo else 1))
			samples[name] = s

func _setup_buses() -> void:
	var comp := AudioEffectCompressor.new()
	comp.threshold = -14.0
	comp.ratio = 4.0
	comp.attack_us = 4000.0
	comp.release_ms = 200.0
	var has := false
	for i in AudioServer.get_bus_effect_count(0):
		if AudioServer.get_bus_effect(0, i) is AudioEffectCompressor:
			has = true
	if not has:
		AudioServer.add_bus_effect(0, comp)
	for b in ["Engine", "Sfx", "Amb", "Radio"]:
		if AudioServer.get_bus_index(b) < 0:
			AudioServer.add_bus()
			var i := AudioServer.bus_count - 1
			AudioServer.set_bus_name(i, b)
			AudioServer.set_bus_send(i, "Master")

func set_levels(l: Dictionary) -> void:
	var f := func(bus: String, v: float): AudioServer.set_bus_volume_db(AudioServer.get_bus_index(bus), linear_to_db(maxf(v, 1e-4)))
	f.call("Master", l.master * l.master)
	f.call("Engine", l.engine * l.engine)
	f.call("Sfx", l.effects * l.effects)
	f.call("Amb", l.ambience * l.ambience * 0.8)
	var r: float = l.get("radio", 0.9)
	f.call("Radio", r * r * 1.4)

## RMS of the mixed output right now (diagnostics).
func level() -> float:
	var db := maxf(AudioServer.get_bus_peak_volume_left_db(0, 0), AudioServer.get_bus_peak_volume_right_db(0, 0))
	return db_to_linear(db)

func resume() -> void:
	pass

func when_ready() -> bool:
	return true

# ------------------------------------------------------------ rendering ---

static func to_stream(data: PackedFloat32Array, rate: int = RATE, loop: bool = false) -> AudioStreamWAV:
	var bytes := PackedByteArray()
	bytes.resize(data.size() * 2)
	for i in data.size():
		bytes.encode_s16(i * 2, int(clampf(data[i], -1.0, 1.0) * 32767.0))
	var s := AudioStreamWAV.new()
	s.format = AudioStreamWAV.FORMAT_16_BITS
	s.mix_rate = rate
	s.stereo = false
	s.data = bytes
	if loop:
		s.loop_mode = AudioStreamWAV.LOOP_FORWARD
		s.loop_begin = 0
		s.loop_end = data.size()
	return s

## RBJ biquad over a buffer. WebAudio's lowpass / highpass Q is in dB, bandpass Q is linear.
static func biquad(type: String, f: float, q: float, x: PackedFloat32Array, rate: int = RATE) -> PackedFloat32Array:
	var qq := q if type == "bandpass" else pow(10.0, q / 20.0)
	var w0 := TAU * minf(f, rate * 0.45) / rate
	var cw := cos(w0)
	var alpha := sin(w0) / (2.0 * qq)
	var b0: float
	var b1: float
	var b2: float
	match type:
		"lowpass":
			b0 = (1.0 - cw) / 2.0
			b1 = 1.0 - cw
			b2 = b0
		"highpass":
			b0 = (1.0 + cw) / 2.0
			b1 = -(1.0 + cw)
			b2 = b0
		_:
			b0 = alpha
			b1 = 0.0
			b2 = -alpha
	var a0 := 1.0 + alpha
	var a1 := -2.0 * cw / a0
	var a2 := (1.0 - alpha) / a0
	b0 /= a0
	b1 /= a0
	b2 /= a0
	var out := PackedFloat32Array()
	out.resize(x.size())
	var x1 := 0.0
	var x2 := 0.0
	var y1 := 0.0
	var y2 := 0.0
	for i in x.size():
		var v := x[i]
		var y := b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
		out[i] = y
		x2 = x1
		x1 = v
		y2 = y1
		y1 = y
	return out

## A seamless looping noise through a filter chain: [[type, hz, q], ...]; brown: from the integrated noise.
func filtered_loop(key: String, chain: Array, use_brown: bool = false, am_hz: float = 0.0) -> AudioStreamWAV:
	if _cache.has(key):
		return _cache[key]
	var x: PackedFloat32Array = brown if use_brown else noise
	for c in chain:
		# two passes over the loop; the second one has the filter already settled, so the loop point is clean
		var y := biquad(c[0], c[1], c[2], x + x)
		x = y.slice(x.size())
	if am_hz > 0.0:
		# chopped like a square LFO of the same depth: 0 … 2× the level
		for i in x.size():
			x[i] *= 2.0 if fposmod(float(i) / RATE * am_hz, 1.0) < 0.5 else 0.0
	var s := to_stream(x, RATE, true)
	_cache[key] = s
	return s

## One cycle-exact loop of a waveform at 1 kHz: pitch it with pitch_scale = Hz / 1000.
func cycle_stream(type: String) -> AudioStreamWAV:
	var key := "cycle_" + type
	if _cache.has(key):
		return _cache[key]
	var n := 480
	var d := PackedFloat32Array()
	d.resize(n)
	for i in n:
		d[i] = _wave(type, fposmod(i / 48.0, 1.0))
	var s := to_stream(d, 48000, true)
	_cache[key] = s
	return s

static func _wave(type: String, ph: float) -> float:
	match type:
		"square":
			return 1.0 if ph < 0.5 else -1.0
		"sawtooth":
			return 2.0 * ph - 1.0
		"triangle":
			return 4.0 * absf(ph - 0.5) - 1.0
	return sin(TAU * ph)

# --------------------------------------------------------------- buses ---

## A bus panned to one of PAN_STEPS positions that feeds `target`.
func pan_bus(target: String, pan: float) -> String:
	var k := clampi(roundi((clampf(pan, -1.0, 1.0) * 0.5 + 0.5) * PAN_STEPS), 0, PAN_STEPS)
	var name := "P%s%d" % [target, k]
	if not _pan_buses.has(name):
		AudioServer.add_bus()
		var i := AudioServer.bus_count - 1
		AudioServer.set_bus_name(i, name)
		AudioServer.set_bus_send(i, target)
		var p := AudioEffectPanner.new()
		p.pan = k * 2.0 / PAN_STEPS - 1.0
		AudioServer.add_bus_effect(i, p)
		_pan_buses[name] = true
	return name

## A new bus with a panner for one voice (free it with free_bus).
func voice_bus(name: String, target: String) -> AudioEffectPanner:
	AudioServer.add_bus()
	var i := AudioServer.bus_count - 1
	AudioServer.set_bus_name(i, name)
	AudioServer.set_bus_send(i, target)
	var p := AudioEffectPanner.new()
	AudioServer.add_bus_effect(i, p)
	return p

func free_bus(name: String) -> void:
	var i := AudioServer.get_bus_index(name)
	if i >= 0:
		AudioServer.remove_bus(i)

## A looping player on a bus, started at a random point.
func loop_player(stream: AudioStream, bus: String, parent: Node = null) -> AudioStreamPlayer:
	var p := AudioStreamPlayer.new()
	p.stream = stream
	p.bus = bus
	p.volume_db = -80.0
	(parent if parent != null else self).add_child(p)
	p.play(randf() * maxf(0.0, stream.get_length() - 0.05))
	return p

func play_stream(stream: AudioStream, vol: float, rate: float, bus: String, pan: float, when: float = 0.0) -> void:
	var p := AudioStreamPlayer.new()
	p.stream = stream
	p.bus = pan_bus(bus, pan) if absf(pan) > 0.05 else bus
	p.volume_db = linear_to_db(maxf(vol, 1e-4))
	p.pitch_scale = rate
	add_child(p)
	p.finished.connect(p.queue_free)
	if when > 0.0:
		get_tree().create_timer(when).timeout.connect(func(): if is_instance_valid(p): p.play())
	else:
		p.play()

# ------------------------------------------------------------ one-shots ---

## Short tone with an envelope (beeps, chimes).
func tone(freq: float, dur: float, vol: float, type: String = "sine", when: float = 0.0, bus: String = "Sfx") -> void:
	var key := "tone_%s_%d_%.2f" % [type, int(freq), dur]
	if not _cache.has(key):
		var n := int((dur + 0.3) * RATE)
		var d := PackedFloat32Array()
		d.resize(n)
		for i in n:
			var t := float(i) / RATE
			var env := minf(1.0, t / 0.008)
			if t > dur * 0.6:
				env *= exp(-(t - dur * 0.6) / (dur * 0.25))
			d[i] = _wave(type, fposmod(t * freq, 1.0)) * env
		_cache[key] = to_stream(d)
	play_stream(_cache[key], vol, 1.0, bus, 0.0, when)

## Filtered noise burst.
func burst(type: String, f: float, q: float, dur: float, vol: float, bus: String = "Sfx", pan: float = 0.0) -> void:
	var key := "burst_%s_%d_%.2f_%.2f" % [type, int(f), q, dur]
	if not _cache.has(key):
		var n := int((dur * 2.0 + 0.1) * RATE)
		var x := PackedFloat32Array()
		x.resize(n)
		for i in n:
			var t := float(i) / RATE
			x[i] = noise[i % noise.size()] * (1.0 if t < 0.005 else exp(-(t - 0.005) / (dur / 3.0)))
		_cache[key] = to_stream(biquad(type, f, q, x))
	play_stream(_cache[key], vol, 1.0, bus, pan)

## A recording once (a crash), at a gain and a playback rate, panned.
func play_sample(name: String, vol: float, rate: float = 1.0, pan: float = 0.0, when: float = 0.0) -> bool:
	if not samples.has(name):
		return false
	play_stream(samples[name], vol, rate, "Sfx", pan, when)
	return true

## Body impact, scaled by severity (0..1): a low thump for the weight, and a recorded crash (a knock of metal for a
## brush, a crunch for a hit, a crash with the debris falling after it for a big one).
func impact(severity: float, pan: float = 0.0) -> void:
	var v := minf(1.0, severity)
	var rate := 0.9 + randf() * 0.2
	var recorded: bool
	if v < 0.3:
		recorded = play_sample("crash_light", 0.5 + 1.5 * v, rate, pan)
	elif v < 0.65:
		recorded = play_sample("crash_medium", 0.7 + 0.6 * v, rate, pan) and play_sample("crash_light", 0.4, rate * 0.9, pan)
	else:
		recorded = play_sample("crash_heavy", 1.1, rate, pan) and play_sample("crash_debris", 0.6, 1.0, pan, 0.15)
	if not _cache.has("thump"):
		var n := int(0.6 * RATE)
		var d := PackedFloat32Array()
		d.resize(n)
		var ph := 0.0
		for i in n:
			var t := float(i) / RATE
			var fr := 90.0 * pow(38.0 / 90.0, minf(t / 0.25, 1.0))
			ph += fr / RATE
			d[i] = sin(TAU * ph) * (1.0 if t < 0.02 else exp(-(t - 0.02) / 0.09))
		_cache["thump"] = to_stream(d)
	play_stream(_cache["thump"], 0.9 * v, 1.0, "Sfx", 0.0)
	if recorded:
		return
	burst("lowpass", 1800.0, 0.7, 0.18 + 0.2 * v, 0.7 * v, "Sfx", pan)
	if v > 0.35:
		burst("bandpass", 3800.0, 1.5, 0.35, 0.25 * v, "Sfx", pan)

## Air jacks: the hiss of the lance going in and the car rising (up), or the dump valve (down).
func air_jack(up: bool, pan: float = 0.0) -> void:
	burst("highpass", 2600.0 if up else 1800.0, 0.6, 0.55 if up else 0.4, 0.32 if up else 0.42, "Sfx", pan)
	burst("lowpass", 320.0, 0.9, 0.18, 0.35 if up else 0.5, "Sfx", pan)

## The refuelling rig's coupling: a heavy clunk.
func clunk(pan: float = 0.0) -> void:
	burst("lowpass", 650.0, 1.1, 0.12, 0.6, "Sfx", pan)

## Pneumatic wheel gun: a fast rattling whirr (noise amplitude-modulated at ~60 Hz).
func wheel_gun(pan: float = 0.0) -> void:
	if not _cache.has("gun"):
		var n := int(0.75 * RATE)
		var x := noise.slice(0, n)
		for i in n:
			var t := float(i) / RATE
			var env := 0.3 if t < 0.55 else (maxf(0.0, 0.3 * (0.7 - t) / 0.15) if t < 0.7 else 0.0)
			var am := 0.25 if fposmod(t * 62.0, 1.0) < 0.5 else -0.25
			x[i] *= (env + (am if t < 0.75 else 0.0))
		_cache["gun"] = to_stream(biquad("bandpass", 2200.0, 1.2, x))
	play_stream(_cache["gun"], 1.0, 1.0, "Sfx", pan)

func countdown_beep(go: bool) -> void:
	if go:
		tone(1320.0, 0.6, 0.35, "square")
	else:
		tone(880.0, 0.22, 0.3, "square")

func chime(kind: String) -> void:
	if kind == "invalid":
		tone(196.0, 0.25, 0.22, "sawtooth")
		tone(147.0, 0.35, 0.22, "sawtooth", 0.12)
		return
	var notes: Array = [784, 988, 1175, 1568] if kind == "session-best" else ([659, 880, 1175] if kind == "best" else [880, 1320])
	for i in notes.size():
		tone(notes[i], 0.35, 0.16, "triangle", i * 0.09)

func create_engine(profile: Dictionary) -> EngineVoice:
	var v := EngineVoice.new(self, profile)
	add_child(v)
	return v
