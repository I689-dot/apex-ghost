class_name VehicleConsts
extends RefCounted
## Constants and helper curves of the vehicle model (port of the top of physics/vehicle.ts).

const G := 9.81
## Standard air (15 C, sea level): the reference for drag, downforce and engine power.
const RHO := 1.225

## Collision layers (bit values; same numbers as the Rapier groups of the web game).
## Track = layer 1, cars = layer 2, the track's walls = layer 3, proxies of remote cars = layer 4.
const LAYER_TRACK := 1
const LAYER_CAR := 2
const LAYER_WALL := 4
const LAYER_PROXY := 8
## Wheel rays only see the track and its walls.
const RAY_MASK := LAYER_TRACK | LAYER_WALL

## Surface properties: grip, rolling resistance, extra deep-surface drag, vibration.
const SURFACE_PROPS := {
	"asphalt": {"grip": 1.0, "rolling": 0.013, "drag": 0.0, "bumpy": 0.0},
	"curb": {"grip": 0.9, "rolling": 0.02, "drag": 0.0, "bumpy": 1.0},
	"grass": {"grip": 0.55, "rolling": 0.06, "drag": 1.2, "bumpy": 0.35},
	"gravel": {"grip": 0.5, "rolling": 0.15, "drag": 6.0, "bumpy": 0.8},
	"sand": {"grip": 0.42, "rolling": 0.22, "drag": 9.0, "bumpy": 0.6},
	"wall": {"grip": 0.4, "rolling": 0.05, "drag": 0.0, "bumpy": 0.2},
}

## What one step of car-to-car contact may do to a car.
const CAR_CONTACT := {"maxDvy": 0.6, "maxDwTilt": 0.5, "maxDv": 16.0}

const TYRE_TEMP := {
	"optimumC": 85.0, "windowC": 6.0, "coldPenalty": 0.12, "coldSpanC": 30.0, "hotPenalty": 0.1, "hotSpanC": 25.0,
	"heatCapacity": 6000.0, "coolBase": 13.0, "coolPerMs": 1.2, "rolling": 0.0075, "flex": 0.006, "road": 50.0,
	"frontScrub": 1.7, "wetCool": 1.5, "hotFadeC": 30.0,
}

const CHASSIS := {
	"damperKnee": 0.08, "damperLow": 1.45, "damperHigh": 0.55, "relaxM": 0.3, "relaxMin": 0.12, "relaxMax": 0.55,
	"balancePerMm": 0.0022, "balanceMax": 0.06, "yawLoss": 10.0, "yawMin": 0.55, "yawDrag": 3.0, "yawRear": 0.35,
	"camberRoll": 0.4, "camberGrip": 0.005, "camberRollRef": 1.2, "heavePerMm": 0.0015, "heaveMax": 0.05,
	"diffPreload": 110.0, "diffCoast": 0.55,
}

const BRAKE_TEMP := {
	"heatCapacity": 3000.0, "coolBase": 8.0, "coolPerMs": 0.95, "coldC": 200.0, "fadeC": 700.0, "fadeCarbonC": 1000.0,
}

const TYRE_PRESSURE := {
	"targetPsi": 29.0, "atmPsi": 14.7, "gripLoss": 0.05, "gripSpanPsi": 3.0, "maxLoss": 0.1, "flexExp": 1.5,
	"stiffExp": 0.35, "minColdPsi": 20.3, "maxColdPsi": 30.5,
}

const FUEL := {
	"kgPerL": 0.745, "jPerL": 32e6, "efficiency": 0.31, "idleLps": 0.0006, "tankL": 120.0, "refL": 50.0, "perKm": 0.64,
}

## Neutral garage setup.
static func neutral_setup() -> Dictionary:
	return {"pressure": null, "ride": [0.0, 0.0], "bump": [1.0, 1.0], "rebound": [1.0, 1.0]}

## Rubber on the line raises grip through a session; rain washes it away.
static func track_rubber(session_ms: float, wetness: float) -> float:
	return 1.0 + 0.02 * minf(1.0, maxf(0.0, session_ms) / 1200000.0) * (1.0 - minf(1.0, wetness * 2.0))

## Engine power in air of this density against standard air.
static func engine_air_scale(s: Dictionary, rho: float) -> float:
	var r := rho / RHO
	return r if s.get("aspiration", "na") == "na" else sqrt(r)

static func brake_temp_factor(t: float, carbon: bool = false) -> float:
	var fade: float = BRAKE_TEMP.fadeCarbonC if carbon else BRAKE_TEMP.fadeC
	if t < BRAKE_TEMP.coldC:
		return 0.86 + 0.14 * (t / BRAKE_TEMP.coldC)
	if t <= fade:
		return 1.0
	return maxf(0.7, 1.0 - (t - fade) / 600.0)

## Cold pressure (psi) that reaches the hot target at the compound's working temperature.
static func ideal_cold_psi(optimum_c: float, set_c: float) -> float:
	var P := TYRE_PRESSURE
	return roundf(((P.targetPsi + P.atmPsi) * ((set_c + 273.15) / (optimum_c + 273.15)) - P.atmPsi) * 10.0) / 10.0

static func pressure_grip(psi: float) -> float:
	var P := TYRE_PRESSURE
	var d: float = (psi - P.targetPsi) / P.gripSpanPsi
	return 1.0 - minf(P.maxLoss, P.gripLoss * d * d)

static func tyre_temp_grip(t: float, optimum_c: float = 85.0) -> float:
	var d := t - optimum_c
	var T := TYRE_TEMP
	if absf(d) <= T.windowC:
		return 1.0
	if d < 0.0:
		var x: float = (-d - T.windowC) / T.coldSpanC
		return 1.0 - T.coldPenalty * minf(1.0, x * x)
	var x2: float = (d - T.windowC) / T.hotSpanC
	return 1.0 - T.hotPenalty * minf(1.0, x2 * x2)
