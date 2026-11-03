class_name EngineVoice
extends Node
## One car's engine and drivetrain noises (port of EngineVoice in audio/audio.ts): the recorded engine, turbo whistle
## and blow-off, straight-cut gearbox whine, hybrid motor whine. Positioned by gain + stereo pan (and a Doppler factor
## on the pitch). The web game grains the recordings at the firing rate; here the two recorded loops around the
## current rpm are played pitched to it and cross-faded (equal power), on-throttle against off-throttle by load.

static var _counter := 0

var a: GameAudio
var profile: Dictionary
var bank: Dictionary
var stopped := false
var _bus := ""
var _panner: AudioEffectPanner
var _players: Array[AudioStreamPlayer] = []  # lo-on, lo-off, hi-on, hi-off
var _lo := -1
var _hi := -1
var _whine: AudioStreamPlayer
var _turbo: AudioStreamPlayer
var _motor: AudioStreamPlayer
var _t_rpm := 1000.0
var _t_load := 0.0
var _rpm := 1000.0
var _load := 0.0
var _t_gain := 0.0
var _gain := 0.0
var _t_pan := 0.0
var _pan := 0.0
var _gear_ratio := 0.0
var _doppler := 1.0
var _raw_rpm := 1000.0
var _boost := 0.0
var _last_load := 0.0
var _cut_until := 0.0
var _fade := 1.0
## Overrun: seconds left of crackling after a lift from high revs, and when the next pop comes.
var _overrun := 0.0
var _next_pop := 0.0

func _init(audio: GameAudio, prof: Dictionary) -> void:
	a = audio
	profile = prof
	bank = EngineBank.load_bank(prof.bank)
	_counter += 1
	_bus = "EV%d" % _counter
	_panner = a.voice_bus(_bus, "Engine")
	# the car's own tone over the shared recording
	var tone: Array = prof.get("tone", [0.0, 0.0, 0.0])
	if tone.any(func(g): return absf(float(g)) > 0.01):
		var eq := AudioEffectEQ6.new()
		eq.set_band_gain_db(0, float(tone[0]))
		eq.set_band_gain_db(1, float(tone[0]) * 0.6)
		eq.set_band_gain_db(2, float(tone[1]))
		eq.set_band_gain_db(3, float(tone[1]) * 0.5 + float(tone[2]) * 0.5)
		eq.set_band_gain_db(4, float(tone[2]))
		eq.set_band_gain_db(5, float(tone[2]) * 0.7)
		AudioServer.add_bus_effect(AudioServer.get_bus_index(_bus), eq, 0)
	if not bank.is_empty():
		for i in 4:
			var lp: Dictionary = bank.loops[0]
			var p := AudioStreamPlayer.new()
			p.bus = _bus
			p.stream = lp.on
			p.volume_db = -80.0
			_players.append(p)
	_whine = _osc("triangle")
	if prof.turbo:
		_turbo = _osc("sine")
	if prof.hybrid:
		_motor = _osc("sawtooth")

func _osc(type: String) -> AudioStreamPlayer:
	var p := AudioStreamPlayer.new()
	p.stream = a.cycle_stream(type)
	p.bus = _bus
	p.volume_db = -80.0
	return p

func _ready() -> void:
	for p in _players:
		add_child(p)
		p.play(randf() * 0.5)
	for p in [_whine, _turbo, _motor]:
		if p != null:
			add_child(p)
			p.play()

## rpm: engine speed; load: throttle 0..1; gear_ratio: overall ratio of the current gear; gain: distance attenuation
## 0..1; pan: -1..1; doppler: pitch factor.
func set_state(rpm: float, load: float, gear_ratio: float, gain: float, pan: float, doppler: float = 1.0) -> void:
	if stopped:
		return
	_raw_rpm = rpm
	_t_rpm = maxf(profile.idle * 0.8, rpm) * doppler
	_doppler = doppler
	_t_load = load
	_gear_ratio = gear_ratio
	_t_gain = gain
	_t_pan = pan

## Ignition cut for a gear change (the crisp "bap" of a sequential box).
func shift() -> void:
	_cut_until = Time.get_ticks_msec() + 55.0
	# the bark of a sequential upshift under power: the cut, then the exhaust catching
	if _load > 0.6 and not stopped:
		a.burst("lowpass", 420.0, 0.9, 0.06, 0.14 * _gain, "Engine", _pan)

func stop() -> void:
	if stopped:
		return
	stopped = true
	_t_gain = 0.0
	get_tree().create_timer(0.4).timeout.connect(_free)

func _free() -> void:
	a.free_bus(_bus)
	queue_free()

func _db(v: float) -> float:
	return -80.0 if v < 0.0005 else linear_to_db(v)

func _process(dt: float) -> void:
	_rpm += (_t_rpm - _rpm) * (1.0 - exp(-dt / 0.02))
	_load += (_t_load - _load) * (1.0 - exp(-dt / 0.03))
	_gain += (_t_gain - _gain) * (1.0 - exp(-dt / (0.08 if stopped else 0.05)))
	_pan += (_t_pan - _pan) * (1.0 - exp(-dt / 0.05))
	_panner.pan = clampf(_pan, -1.0, 1.0)
	var p: Dictionary = profile
	var now := Time.get_ticks_msec()
	var cut := 1.0 if now < _cut_until else 0.0
	var rn := minf(1.0, _raw_rpm / p.redline)
	# on the limiter the ignition cuts in and out (~12 Hz): the rev limiter's stutter
	if rn > 0.995 and _load > 0.8 and fmod(now / 1000.0, 0.085) < 0.032:
		cut = 1.0
	# the overrun: lifting off from high revs, unburnt fuel pops in the exhaust for a moment
	if _last_load > 0.6 and _load < 0.15 and rn > 0.55:
		_overrun = 0.6 + 0.9 * float(p.get("pops", 0.6))
	if _overrun > 0.0:
		_overrun -= dt
		if _load > 0.3 or _raw_rpm < p.idle * 1.6:
			_overrun = 0.0
		elif now >= _next_pop and not stopped:
			var strength := float(p.get("pops", 0.6)) * (0.5 + 0.5 * rn) * randf_range(0.4, 1.0)
			a.burst("bandpass", randf_range(700.0, 2200.0), 1.4, randf_range(0.02, 0.05), 0.2 * _gain * strength, "Engine", _pan)
			_next_pop = now + randf_range(40.0, 220.0) / maxf(0.3, float(p.get("pops", 0.6)))
	if not bank.is_empty():
		_update_engine(cut, rn)
	# straight-cut sequential gearbox: the GT3 whine, loudest off-throttle
	if _gear_ratio > 0.0:
		_whine.pitch_scale = clampf(minf(6000.0, ((_raw_rpm / 60.0) * 38.0 * _doppler) / maxf(0.6, _gear_ratio / 3.0)) / 1000.0, 0.02, 8.0)
		_whine.volume_db = _db(_gain * (0.012 + 0.03 * (1.0 - _load)) * rn)
	else:
		_whine.volume_db = -80.0
	if _turbo != null:
		var target := rn if _load > 0.5 else 0.0
		_boost += (target - _boost) * (0.06 if target > _boost else 0.25) * minf(1.0, dt * 60.0)
		_turbo.pitch_scale = (2200.0 + 9500.0 * _boost) * _doppler / 1000.0
		_turbo.volume_db = _db(_gain * 0.025 * _boost * _boost)
		# blow-off valve when lifting with boost
		if _last_load > 0.7 and _load < 0.2 and _boost > 0.45 and not stopped:
			a.burst("highpass", 2600.0, 0.7, 0.35, 0.16 * _gain * _boost, "Engine", _pan)
	if _motor != null:
		_motor.pitch_scale = (_raw_rpm / 60.0) * 7.0 * _doppler / 1000.0
		_motor.volume_db = _db(_gain * 0.02 * rn * (0.4 + _load))
	_last_load = _load

func _update_engine(cut: float, rn: float) -> void:
	var loops: Array = bank.loops
	var r := maxf(300.0, _rpm * float(profile.cyl) / float(bank.cyl) * float(profile.get("pitch", 1.0)))
	var k := 0
	while k < loops.size() - 2 and loops[k + 1].rpm < r:
		k += 1
	var lo = loops[k]
	var hi = loops[mini(k + 1, loops.size() - 1)]
	var f := 0.0 if hi == lo else clampf((r - lo.rpm) / (hi.rpm - lo.rpm), 0.0, 1.0)
	if k != _lo or _hi != mini(k + 1, loops.size() - 1):
		_lo = k
		_hi = mini(k + 1, loops.size() - 1)
		_swap(0, lo.on)
		_swap(1, lo.off)
		_swap(2, hi.on)
		_swap(3, hi.off)
	var ld := clampf(_load * (1.0 - cut), 0.0, 1.0)
	var w_on := sqrt(ld)
	var w_off := sqrt(1.0 - ld) * 0.55
	var w_lo := cos(f * PI * 0.5)
	var w_hi := sin(f * PI * 0.5)
	var g: float = _gain * bank.norm * profile.sampleGain * minf(1.25, 0.45 + 0.6 * _rpm / profile.redline)
	_players[0].pitch_scale = r / lo.rpm
	_players[1].pitch_scale = r / lo.rpm
	_players[2].pitch_scale = r / hi.rpm
	_players[3].pitch_scale = r / hi.rpm
	_players[0].volume_db = _db(g * w_lo * w_on)
	_players[1].volume_db = _db(g * w_lo * w_off)
	_players[2].volume_db = _db(g * w_hi * w_on)
	_players[3].volume_db = _db(g * w_hi * w_off)

## Switches a player to another loop, keeping its place in the cycle (loops are whole numbers of firing periods).
func _swap(i: int, stream: AudioStreamWAV) -> void:
	var p := _players[i]
	if p.stream == stream:
		return
	var frac := 0.0
	if p.playing and p.stream != null and p.stream.get_length() > 0.0:
		frac = fposmod(p.get_playback_position(), p.stream.get_length()) / p.stream.get_length()
	p.stream = stream
	p.play(frac * stream.get_length())
