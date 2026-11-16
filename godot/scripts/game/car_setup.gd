class_name CarSetup
extends RefCounted
## Garage setup (port of game/carSetup.ts): rear wing, ride height, anti-roll bars, dampers, brake bias, pressures.
## A setup is the Dictionary in Settings.data.carSetup {tyre, wing, brakeBias, pressure, ride, arb, bump, rebound, fuelL}.

## Rear wing: downforce and drag together (more wing = more grip in corners, less top speed).
const WING := {
	"low": {"downforce": 0.82, "drag": 0.9, "label": "Low (top speed)"},
	"medium": {"downforce": 1.0, "drag": 1.0, "label": "Medium"},
	"high": {"downforce": 1.18, "drag": 1.1, "label": "High (cornering grip)"},
}

## The deeper setup, in the ranges a GT3 engineer works in.
const SETUP := {
	"clicks": 7, "baseline": 4, "arb": [0.55, 0.7, 0.85, 1.0, 1.2, 1.4, 1.6], "damperPerClick": 0.1, "rideMm": 10.0,
	"downforcePerM": 3.5, "dragPerM": 1.0, "balancePerM": 3.0, "comPerM": 0.8,
	# springs and the differential's locking per click, the brake ducts' cooling (1 closed .. 5 open)
	"springs": [0.78, 0.86, 0.93, 1.0, 1.08, 1.17, 1.27], "diffLock": [0.6, 0.73, 0.87, 1.0, 1.13, 1.27, 1.4],
	"diffCoast": [0.3, 0.38, 0.47, 0.55, 0.63, 0.72, 0.8], "ducts": [0.7, 0.85, 1.0, 1.15, 1.3],
	# static camber and toe (degrees; front toe negative = out, rear positive = in), differential preload (Nm)
	"camber": [[-4.0, -1.5], [-3.5, -1.0]], "toe": [[-0.3, 0.2], [-0.1, 0.4]], "preload": [40.0, 200.0],
	# brake pressure (share of the system's maximum), final drive (2 % a step, + shorter), engine maps
	"brakePressure": [0.8, 1.0], "finalDriveStep": 0.02, "finalDriveSteps": 3,
	"maps": [{"power": 1.0, "fuel": 1.0, "label": "Race"}, {"power": 0.975, "fuel": 0.93, "label": "Lean"}, {"power": 0.95, "fuel": 0.87, "label": "Save fuel"}],
}

static func _clamp_click(c: float) -> int:
	return clampi(roundi(c), 1, SETUP.clicks)

static func _pair(arr, i: int, default_value: float) -> float:
	if arr == null or arr.size() <= i or arr[i] == null:
		return default_value
	return float(arr[i])

## The car with the player's setup applied (the physics reads its specs). Returns a copy of the CarEntry.
static func apply_setup(entry: Dictionary, setup: Dictionary) -> Dictionary:
	var w: Dictionary = WING[setup.wing]
	var ride_f := _pair(setup.get("ride"), 0, 0.0) / 1000.0
	var ride_r := _pair(setup.get("ride"), 1, 0.0) / 1000.0
	var avg := (ride_f + ride_r) / 2.0
	var out := entry.duplicate(true)
	var s: Dictionary = out.specs
	s.downforceArea = s.downforceArea * w.downforce * (1.0 - SETUP.downforcePerM * avg)
	s.dragArea = s.dragArea * w.drag * (1.0 - SETUP.dragPerM * avg)
	s.aeroBalanceFront = clampf(s.aeroBalanceFront + SETUP.balancePerM * (ride_r - ride_f), 0.3, 0.55)
	s.comHeightM = s.comHeightM + SETUP.comPerM * avg
	s.antiRollFront = s.antiRollFront * SETUP.arb[_clamp_click(_pair(setup.get("arb"), 0, 4.0)) - 1]
	s.antiRollRear = s.antiRollRear * SETUP.arb[_clamp_click(_pair(setup.get("arb"), 1, 4.0)) - 1]
	s.brakeBiasFront = clampf(setup.brakeBias, 0.54, 0.66)
	s.diffLock = float(s.diffLock) * SETUP.diffLock[_clamp_click(float(setup.get("diffLock", SETUP.baseline))) - 1]
	s.finalDrive = float(s.finalDrive) * (1.0 + SETUP.finalDriveStep * clampi(int(setup.get("finalDrive", 0)), -SETUP.finalDriveSteps, SETUP.finalDriveSteps))
	s.brakeTorqueNm = float(s.brakeTorqueNm) * clampf(float(setup.get("brakePressure", 1.0)), SETUP.brakePressure[0], SETUP.brakePressure[1])
	return out

## The part of the setup the vehicle applies itself (pressures, ride height on the springs, dampers).
static func vehicle_setup(setup: Dictionary) -> Dictionary:
	var damper := func(arr, i: int) -> float:
		return 1.0 + SETUP.damperPerClick * (_clamp_click(_pair(arr, i, 4.0)) - SETUP.baseline)
	var ride := func(i: int) -> float:
		return clampf(_pair(setup.get("ride"), i, 0.0), -SETUP.rideMm, SETUP.rideMm) / 1000.0
	var pr = setup.get("pressure")
	return {
		"pressure": [float(pr[0]), float(pr[1])] if pr != null else null,
		"ride": [ride.call(0), ride.call(1)],
		"bump": [damper.call(setup.get("bump"), 0), damper.call(setup.get("bump"), 1)],
		"rebound": [damper.call(setup.get("rebound"), 0), damper.call(setup.get("rebound"), 1)],
		"springs": [SETUP.springs[_clamp_click(_pair(setup.get("springs"), 0, 4.0)) - 1], SETUP.springs[_clamp_click(_pair(setup.get("springs"), 1, 4.0)) - 1]],
		"camber": [clampf(_pair(setup.get("camber"), 0, -3.0), SETUP.camber[0][0], SETUP.camber[0][1]), clampf(_pair(setup.get("camber"), 1, -2.5), SETUP.camber[1][0], SETUP.camber[1][1])],
		"toe": [clampf(_pair(setup.get("toe"), 0, 0.0), SETUP.toe[0][0], SETUP.toe[0][1]), clampf(_pair(setup.get("toe"), 1, 0.0), SETUP.toe[1][0], SETUP.toe[1][1])],
		"diffPreload": clampf(float(setup.get("diffPreload", 110.0)), SETUP.preload[0], SETUP.preload[1]),
		"diffCoast": SETUP.diffCoast[_clamp_click(float(setup.get("diffCoast", SETUP.baseline))) - 1],
		"ducts": SETUP.ducts[clampi(int(setup.get("brakeDucts", 3)), 1, 5) - 1],
		"mapPower": SETUP.maps[clampi(int(setup.get("engineMap", 1)), 1, 3) - 1].power,
		"mapFuel": SETUP.maps[clampi(int(setup.get("engineMap", 1)), 1, 3) - 1].fuel,
	}

## What an engineer would suggest for this forecast. Returns {tyre, wing, note}.
static func recommend_setup(plan: Dictionary) -> Dictionary:
	var wet_start: bool = plan.initialWetness > 0.35
	var change = plan.get("change")
	var rain_later: bool = change != null and (change.to == "light_rain" or change.to == "heavy_rain")
	var drying: bool = change != null and wet_start and change.to != "heavy_rain" and change.to != "light_rain"
	if wet_start:
		return {"tyre": "wet", "wing": "high", "note": I18n.t("Wet start, drying later: wets now, slicks at a pit stop") if drying else I18n.t("Wet track: wets and maximum downforce")}
	if rain_later:
		return {"tyre": "medium", "wing": "high", "note": I18n.t("Rain on the way: mediums now, be ready to pit for wets")}
	if plan.startHour < 8.0 or plan.startHour > 20.0:
		return {"tyre": "soft", "wing": "medium", "note": I18n.t("Cool air: softs warm up quickly")}
	return {"tyre": "medium", "wing": "medium", "note": I18n.t("Dry: mediums for a long run, softs for one fast lap")}

## ------------------------------------------------------------- saved setups ---
## iRacing keeps setups per car, exports them and shares them with other drivers. Here they are named setups in
## Settings.data.savedSetups, and a setup travels between friends as a short text code (copy it, send it in any chat,
## paste it in the other game): "AG1:" + base64 of the setup's JSON.

const CODE_PREFIX := "AG1:"
const TYRES := ["soft", "medium", "hard", "wet"]

## A setup from untrusted data (a pasted code): only known fields, every number clamped to its range. Null if it isn't one.
static func sanitize(raw: Variant) -> Variant:
	if typeof(raw) != TYPE_DICTIONARY:
		return null
	var pair := func(key: String, lo: float, hi: float, def: float, whole: bool) -> Array:
		var a = raw.get(key)
		var out: Array = []
		for i in 2:
			var v: float = def
			if typeof(a) == TYPE_ARRAY and a.size() > i and (typeof(a[i]) == TYPE_FLOAT or typeof(a[i]) == TYPE_INT):
				v = clampf(float(a[i]), lo, hi)
			out.append(roundi(v) if whole else v)
		return out
	var tyre = raw.get("tyre")
	var wing = raw.get("wing")
	var bias = raw.get("brakeBias")
	var fuel = raw.get("fuelL")
	var pr = raw.get("pressure")
	var pressure = null
	if typeof(pr) == TYPE_ARRAY and pr.size() >= 2 and (typeof(pr[0]) == TYPE_FLOAT or typeof(pr[0]) == TYPE_INT) and (typeof(pr[1]) == TYPE_FLOAT or typeof(pr[1]) == TYPE_INT):
		pressure = [clampf(float(pr[0]), 15.0, 40.0), clampf(float(pr[1]), 15.0, 40.0)]
	return {
		"tyre": tyre if tyre in TYRES else "medium",
		"wing": wing if wing in WING else "medium",
		"brakeBias": clampf(float(bias), 0.54, 0.66) if (typeof(bias) == TYPE_FLOAT or typeof(bias) == TYPE_INT) else 0.6,
		"pressure": pressure,
		"ride": pair.call("ride", -SETUP.rideMm, SETUP.rideMm, 0.0, true),
		"arb": pair.call("arb", 1, SETUP.clicks, SETUP.baseline, true),
		"bump": pair.call("bump", 1, SETUP.clicks, SETUP.baseline, true),
		"rebound": pair.call("rebound", 1, SETUP.clicks, SETUP.baseline, true),
		"fuelL": clampf(float(fuel), 5.0, 200.0) if (typeof(fuel) == TYPE_FLOAT or typeof(fuel) == TYPE_INT) else 60.0,
		"springs": pair.call("springs", 1, SETUP.clicks, SETUP.baseline, true),
		"camber": [_num_in(raw.get("camber"), 0, SETUP.camber[0], -3.2), _num_in(raw.get("camber"), 1, SETUP.camber[1], -2.6)],
		"toe": [_num_in(raw.get("toe"), 0, SETUP.toe[0], -0.05), _num_in(raw.get("toe"), 1, SETUP.toe[1], 0.15)],
		"diffPreload": roundi(_one(raw.get("diffPreload"), SETUP.preload, 110.0)),
		"diffLock": roundi(_one(raw.get("diffLock"), [1, SETUP.clicks], SETUP.baseline)),
		"diffCoast": roundi(_one(raw.get("diffCoast"), [1, SETUP.clicks], SETUP.baseline)),
		"brakePressure": _one(raw.get("brakePressure"), SETUP.brakePressure, 1.0),
		"brakeDucts": roundi(_one(raw.get("brakeDucts"), [1, 5], 3)),
		"finalDrive": roundi(_one(raw.get("finalDrive"), [-SETUP.finalDriveSteps, SETUP.finalDriveSteps], 0)),
		"engineMap": roundi(_one(raw.get("engineMap"), [1, 3], 1)),
	}

## A number from a setup code, kept within [lo, hi], else the default.
static func _one(v, range_: Array, def: float) -> float:
	if typeof(v) == TYPE_FLOAT or typeof(v) == TYPE_INT:
		return clampf(float(v), float(range_[0]), float(range_[1]))
	return def

static func _num_in(arr, i: int, range_: Array, def: float) -> float:
	if typeof(arr) == TYPE_ARRAY and arr.size() > i:
		return _one(arr[i], range_, def)
	return def

static func to_code(setup: Dictionary) -> String:
	var clean = sanitize(setup)
	return CODE_PREFIX + Marshalls.raw_to_base64(JSON.stringify(clean).to_utf8_buffer())

## The setup in a code, or null for anything that isn't a valid one.
static func from_code(code: String) -> Variant:
	var c := code.strip_edges()
	if not c.begins_with(CODE_PREFIX) or c.length() > 2000:
		return null
	var body := c.substr(CODE_PREFIX.length())
	var ok := RegEx.new()
	ok.compile("^[A-Za-z0-9+/]+={0,2}$")
	if ok.search(body) == null or body.length() % 4 != 0:
		return null
	var bytes := Marshalls.base64_to_raw(body)
	if bytes.is_empty():
		return null
	return sanitize(JSON.parse_string(bytes.get_string_from_utf8()))

## The saved setups' names, sorted.
static func saved_names() -> Array:
	var names: Array = Settings.data.get("savedSetups", {}).keys()
	names.sort_custom(func(a, b): return String(a).naturalnocasecmp_to(String(b)) < 0)
	return names

static func save_named(name: String, setup: Dictionary) -> void:
	var n := name.strip_edges().left(24)
	if n.is_empty():
		return
	if not Settings.data.has("savedSetups"):
		Settings.data.savedSetups = {}
	Settings.data.savedSetups[n] = sanitize(setup)
	Settings.save()

static func delete_named(name: String) -> void:
	Settings.data.get("savedSetups", {}).erase(name)
	Settings.save()

## Copies a saved (or any) setup into the live one, keeping the dictionary the UI holds.
static func load_into(target: Dictionary, setup: Dictionary) -> void:
	var s = sanitize(setup)
	if s == null:
		return
	for k in s:
		target[k] = s[k]
