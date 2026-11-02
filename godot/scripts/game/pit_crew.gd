class_name PitCrew
extends RefCounted
## The pit stop as it happens, not a timer (port of the logic half of game/pitCrew.ts): one timeline built from the
## same durations as PitService.service_time drives the refuel rig, the air jacks, a wheel man per corner (gun off,
## wheel off, new wheel on, gun on), then the jacks down. The session plays the gun and jack sounds at those moments and
## fits each new tyre when it goes on. Events are Dictionaries {at, kind, wheel}.

## A wheel's change, as fractions of its share of the tyre time: gun off, wheel off, new wheel on, gun on.
const WHEEL := {"gunOff": 0.02, "wheelOff": 0.14, "wheelOn": 0.55, "gunOn": 0.8}
## How long the gun runs (s), how far a wheel comes off the hub (m) and how high the jacks lift (m).
const GUN_S := 0.7
const WHEEL_OUT_M := 0.62
const JACK_M := 0.07

## The events of a stop, in order. Its total matches service_time: refuelling (and the driver change) first, then the
## jacks, the work (tyres alongside the repairs), the jacks down.
static func stop_timeline(plan: Dictionary, zones) -> Array:
	var ev: Array = []
	var total: float = PitService.service_time(plan, zones).total
	var fuel: float = plan.fuelL / PitService.REFUEL_LPS if plan.fuelL > 0.0 else 0.0
	var first := maxf(fuel, PitService.driver_change_s() if plan.driverChange else 0.0)
	if fuel > 0.0:
		ev.append({"at": 0.4, "kind": "fuelOn", "wheel": 1})
		ev.append({"at": maxf(0.6, fuel - 0.3), "kind": "fuelOff", "wheel": 1})
	if total - first <= 0.01:
		return ev
	var jack := PitService.JACKS / 2.0
	ev.append({"at": first + 0.15, "kind": "jackUp", "wheel": 0})
	if plan.tyres != null:
		# two wheel men a side: the front wheel, then the rear
		var per := PitService.TYRES / 2.0
		for wk in [[0, 0], [1, 0], [2, 1], [3, 1]]:
			var t0: float = first + jack + wk[1] * per
			for kind in ["gunOff", "wheelOff", "wheelOn", "gunOn"]:
				ev.append({"at": t0 + WHEEL[kind] * per, "kind": kind, "wheel": wk[0]})
	ev.append({"at": total - jack * 0.8, "kind": "jackDown", "wheel": 0})
	ev.sort_custom(func(a, b): return a.at < b.at)
	return ev

## The state of the car at time u of a stop: {wheelOut: [4 floats], lift}.
static func stop_pose(ev: Array, u: float) -> Dictionary:
	var out := {"wheelOut": [0.0, 0.0, 0.0, 0.0], "lift": 0.0}
	var up = null
	var down = null
	var off := [-1.0, -1.0, -1.0, -1.0]
	var on := [-1.0, -1.0, -1.0, -1.0]
	for e in ev:
		if e.kind == "jackUp":
			up = e.at
		elif e.kind == "jackDown":
			down = e.at
		elif e.kind == "wheelOff":
			off[e.wheel] = e.at
		elif e.kind == "wheelOn":
			on[e.wheel] = e.at
	if up != null and u >= up:
		out.lift = JACK_M * minf(1.0, (u - up) / 0.35) * (maxf(0.0, 1.0 - (u - down) / 0.35) if down != null and u >= down else 1.0)
	for i in 4:
		if off[i] < 0.0:
			continue
		# off: slides out over 0.6 s and stays with the wheel man; the new one slides on over 0.6 s
		if u >= off[i] and u < on[i]:
			out.wheelOut[i] = WHEEL_OUT_M * minf(1.0, (u - off[i]) / 0.6)
		elif u >= on[i]:
			out.wheelOut[i] = WHEEL_OUT_M * maxf(0.0, 1.0 - (u - on[i]) / 0.6)
	return out
