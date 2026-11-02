class_name PitService
extends RefCounted
## What the crew should do at a pit stop (port of game/pitService.ts). A plan is
## {tyres: compound id or null, body, suspension, engine, fuelL, driverChange}. Damage zones z: 0 front, 1 rear,
## 2 left, 3 right, 4 engine, 5 suspension.

const JACKS := 2.0
const TYRES := 14.0
const REFUEL_LPS := 2.7

static func driver_change_s() -> float:
	return RaceTracker.PIT_WINDOW.minStopMs / 1000.0

static func body_time(z) -> float:
	return 4.0 + 26.0 * maxf(maxf(z[0], z[1]), maxf(z[2], z[3]))

static func suspension_time(z) -> float:
	return 6.0 + 34.0 * z[5]

static func engine_time(z) -> float:
	return 8.0 + 52.0 * z[4]

## Returns {total, parts: [{label, seconds}]}.
static func service_time(plan: Dictionary, z) -> Dictionary:
	var parts: Array = []
	var repairs := 0.0
	if plan.body:
		var s := body_time(z)
		parts.append({"label": I18n.t("Bodywork & aero"), "seconds": s})
		repairs += s
	if plan.suspension:
		var s2 := suspension_time(z)
		parts.append({"label": I18n.t("Suspension"), "seconds": s2})
		repairs += s2
	if plan.engine:
		var s3 := engine_time(z)
		parts.append({"label": I18n.t("Engine"), "seconds": s3})
		repairs += s3
	var tyres: float = TYRES if plan.tyres != null else 0.0
	if plan.tyres != null:
		parts.append({"label": I18n.t("Tyres"), "seconds": tyres})
	var fuel: float = plan.fuelL / REFUEL_LPS if plan.fuelL > 0.0 else 0.0
	if fuel > 0.0:
		parts.append({"label": I18n.t("Refuelling {l} l", {"l": roundi(plan.fuelL)}), "seconds": fuel})
	var driver: float = driver_change_s() if plan.driverChange else 0.0
	if driver > 0.0:
		parts.append({"label": I18n.t("Driver change"), "seconds": driver})
	var work := maxf(tyres, repairs)
	return {"total": maxf(fuel, driver) + (work + JACKS if work > 0.0 else 0.0), "parts": parts}

## Sensible default: repair what is damaged, fresh tyres of the right kind when worn or the weather changed.
static func default_plan(z, avg_wear: float, current: String, wetness: float, fuel_l: float = 0.0, driver_change: bool = false) -> Dictionary:
	var want_wet := wetness > 0.35
	var right_kind: bool = current == "wet" if want_wet else current != "wet"
	var tyres = null
	if not right_kind:
		tyres = "wet" if want_wet else "medium"
	elif avg_wear > 0.25:
		tyres = current
	return {
		"tyres": tyres, "body": maxf(maxf(z[0], z[1]), maxf(z[2], z[3])) > 0.05, "suspension": z[5] > 0.05,
		"engine": z[4] > 0.05, "fuelL": fuel_l, "driverChange": driver_change,
	}
