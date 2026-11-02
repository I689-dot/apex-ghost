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
