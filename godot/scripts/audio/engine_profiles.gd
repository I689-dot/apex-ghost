class_name EngineProfiles
extends RefCounted
## Engine layouts of the cars (port of audio/engineProfiles.ts). The sound comes from the recorded loop bank; the web
## game's procedural firing-order layer (underneath at synthMix) has no counterpart here, so only what the recorded
## engine and the drivetrain noises need is kept: bank, cylinders, gains, turbo / hybrid, idle and redline.

const _BASE := {"sampleGain": 0.6, "synthMix": 0.3, "turbo": false, "hybrid": false, "idle": 1200, "level": 0.55}

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
		"f1V6": _p({"cyl": 6, "bank": "v8f", "synthMix": 0.6, "level": 1.19, "turbo": true, "hybrid": true}),
	}

static func profile_key(id: String) -> String:
	if id.contains("project_one"):
		return "f1V6"
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
	var specs: Dictionary = car.specs
	p.redline = specs.redlineRpm
	var idle: float = specs.get("idleRpm", 0)
	if idle > 0:
		p.idle = idle
	return p
