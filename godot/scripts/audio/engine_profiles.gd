class_name EngineProfiles
extends RefCounted
## Engine layouts of the cars (port of audio/engineProfiles.ts). The sound comes from the recorded loop bank; the web
## game's procedural firing-order layer (underneath at synthMix) has no counterpart here, so only what the recorded
## engine and the drivetrain noises need is kept: bank, cylinders, gains, turbo / hybrid, idle and redline.

## pitch: the recording's rpm mapped higher or lower (a smaller or bigger engine on the same bank); pops: how much it
## crackles on the overrun; tone: [low, mid, high] dB of the voice's EQ (a deeper or rawer car on the same bank).
const _BASE := {"sampleGain": 0.6, "synthMix": 0.3, "turbo": false, "hybrid": false, "idle": 1200, "level": 0.55, "pitch": 1.0, "pops": 0.6, "tone": [0.0, 0.0, 0.0]}

static func _p(over: Dictionary) -> Dictionary:
	var d := _BASE.duplicate()
	d.merge(over, true)
	return d

static func _profiles() -> Dictionary:
	return {
		# Dodge Viper GTS V10 race engine: the closest free match to the 6.2 AMG's thunder
		"amgV8": _p({"cyl": 8, "bank": "viper", "level": 0.59, "idle": 1000}),
		"amgV8tt": _p({"cyl": 8, "bank": "viper", "level": 0.8, "turbo": true}),
		"mclarenV8": _p({"cyl": 8, "bank": "v8tt", "level": 0.88, "turbo": true}),
		"v10": _p({"cyl": 10, "bank": "v10", "sampleGain": 0.8, "level": 0.8}),
		"boxer6": _p({"cyl": 6, "bank": "flat6", "level": 0.85}),
		"bmwI6": _p({"cyl": 6, "bank": "i6", "level": 1.12, "turbo": true}),
		"ferrariV6": _p({"cyl": 6, "bank": "v8f", "level": 0.99, "turbo": true}),
		"f1V6": _p({"cyl": 6, "bank": "v8f", "synthMix": 0.6, "level": 1.19, "turbo": true, "hybrid": true, "pitch": 1.25, "pops": 0.2}),
		# the Corvette's flat-plane LT6: the Ferrari flat-plane V8 recording without its turbos, raw and high
		"flatV8": _p({"cyl": 8, "bank": "v8f", "level": 0.95, "pitch": 0.97, "pops": 1.0, "tone": [2.0, 0.0, 2.5]}),
		# big cross-plane NA V8s (Mustang Coyote, Lexus 2UR): the V10 thunder pitched down, a heavy bottom end
		"muscleV8": _p({"cyl": 8, "bank": "viper", "level": 0.7, "idle": 950, "pitch": 0.92, "pops": 1.3, "tone": [3.5, 1.0, -2.0]}),
		"lexusV8": _p({"cyl": 8, "bank": "viper", "level": 0.68, "pitch": 1.03, "pops": 0.9, "tone": [1.5, 2.0, 0.0]}),
		# the Temerario's twin-turbo flat-plane V8, higher revving than the McLaren's
		"lamboV8tt": _p({"cyl": 8, "bank": "v8tt", "level": 0.85, "turbo": true, "pitch": 1.07, "pops": 0.5, "tone": [0.0, 1.0, 1.5]}),
	}

static func profile_key(id: String) -> String:
	if id.contains("project_one"):
		return "f1V6"
	if id.contains("corvette"):
		return "flatV8"
	if id.contains("mustang"):
		return "muscleV8"
	if id.contains("lexus"):
		return "lexusV8"
	if id.contains("temerario"):
		return "lamboV8tt"
	if id.contains("porsche"):
		return "boxer6"
	if id.contains("mclaren"):
		return "mclarenV8"
	if id.contains("lamborghini") or id.contains("audi"):
		return "v10"
	if id.contains("bmw"):
		return "bmwI6"
	if id.contains("ferrari"):
		return "ferrariV6"
	if id.contains("vantage"):
		return "amgV8tt"
	if id.contains("mercedes"):
		return "amgV8"
	return "amgV8tt"

static func for_car(car: Dictionary) -> Dictionary:
	var p: Dictionary = _profiles()[profile_key(car.id)]
	# one family, different cars: the 296's 120° V6 is higher than the V8 recording; Audi's V10 deeper than the Lamborghini
	if car.id.contains("ferrari_296"):
		p.pitch = 1.1
		p.pops = 0.7
		p.tone = [-1.0, 1.5, 2.0]
	elif car.id.contains("audi"):
		p.pitch = 0.98
		p.tone = [1.5, 0.0, -0.5]
	elif car.id.contains("lamborghini"):
		p.pitch = 1.02
		p.pops = 0.9
		p.tone = [0.0, 0.5, 2.0]
	elif car.id.contains("rennsport"):
		p.pitch = 1.03
		p.tone = [0.0, 1.0, 2.5]
	elif car.id.contains("mercedes"):
		p.pops = 1.1
		p.tone = [2.5, 0.0, -0.5]
	elif car.id.contains("mclaren_650s"):
		p.pitch = 0.97
	var specs: Dictionary = car.specs
	p.redline = specs.redlineRpm
	var idle: float = specs.get("idleRpm", 0)
	if idle > 0:
		p.idle = idle
	return p
