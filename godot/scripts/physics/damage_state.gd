class_name DamageState
extends RefCounted
## A car's damage (port of physics/damage.ts). Zones: 0 front, 1 rear, 2 left, 3 right, 4 engine, 5 suspension.
## Values 0 (new) .. 1 (wrecked). Corners are FL, FR, RL, RR.

const ZONES := ["front", "rear", "left", "right", "engine", "suspension"]
const CORNER_KEYS := ["FL", "FR", "RL", "RR"]

const CAP_POWER := 0.3
const CAP_GRIP := 0.12
const CAP_ALIGNMENT_RAD := 1.6 * PI / 180.0
const CAP_DRAG := 0.22
const CAP_DOWNFORCE := 0.3
const CAP_RIDE := 0.025

var zones := PackedFloat32Array([0, 0, 0, 0, 0, 0])
var corners := PackedFloat32Array([0, 0, 0, 0])
var punctured := [false, false, false, false]
var version := 0

func reset() -> void:
	zones.fill(0.0)
	corners.fill(0.0)
	punctured = [false, false, false, false]
	version += 1

## Register an impact. impulse in N*s, (lx, lz) is where the hit came FROM relative to the car centre
## (car-local: +X left, +Z forward). Returns {zone, amount} or an empty dictionary.
func impact(impulse: float, lx: float, lz: float, mass: float) -> Dictionary:
	var energy_kj := (impulse * impulse) / (2.0 * mass) / 1000.0
	if energy_kj < 1.5:
		return {}
	var amount := minf(0.35, (energy_kj - 1.5) / 140.0)
	var ax := absf(lx)
	var az := absf(lz)
	var zone: int
	if az >= ax:
		zone = 0 if lz > 0.0 else 1
	else:
		zone = 2 if lx > 0.0 else 3
	_add(zone, amount)
	var corner := (0 if lz >= 0.0 else 2) + (0 if lx >= 0.0 else 1)
	var susp: float
	if zone == 0:
		_add(4, amount * 0.6)
		susp = amount * 0.35
	elif zone == 1:
		_add(4, amount * 0.25)
		susp = amount * 0.3
	else:
		susp = amount * 0.6
	corners[corner] = minf(1.0, corners[corner] + susp)
	var near := (corner ^ 1) if az >= ax else (corner ^ 2)
	corners[near] = minf(1.0, corners[near] + (susp * 0.25 * minf(ax, az)) / maxf(maxf(ax, az), 1e-6))
	zones[5] = maxf(maxf(corners[0], corners[1]), maxf(corners[2], corners[3]))
	if susp > 0.18 or corners[corner] > 0.45:
		punctured[corner] = true
	version += 1
	return {"zone": zone, "amount": amount}

func _add(i: int, v: float) -> void:
	zones[i] = minf(1.0, zones[i] + v)

## Pit-stop repair. parts: {body, suspension, engine}. Returns true when something changed.
func repair(parts: Dictionary) -> bool:
	var changed := false
	if parts.get("body", false):
		for i in [0, 1, 2, 3]:
			if zones[i] > 0.0:
				changed = true
			zones[i] = 0.0
	if parts.get("suspension", false):
		if zones[5] > 0.0:
			changed = true
		zones[5] = 0.0
		corners.fill(0.0)
	if parts.get("engine", false):
		if zones[4] > 0.0:
			changed = true
		zones[4] = 0.0
	if changed:
		version += 1
	return changed

## Sets zones from a remote snapshot.
func set_all(z: Array) -> void:
	for i in 6:
		zones[i] = float(z[i]) if i < z.size() else 0.0
	var l := zones[2] >= zones[3]
	var s := zones[5]
	if l:
		corners = PackedFloat32Array([s, s * 0.4, s * 0.6, s * 0.3])
	else:
		corners = PackedFloat32Array([s * 0.4, s, s * 0.3, s * 0.6])
	version += 1

## New tyres: the punctures are gone.
func tyres_changed() -> void:
	if punctured.has(true):
		version += 1
	punctured = [false, false, false, false]

func _corner_of(key: String) -> float:
	return corners[CORNER_KEYS.find(key)]

func _flat(key: String) -> bool:
	return punctured[CORNER_KEYS.find(key)]

func power_scale() -> float:
	return 1.0 - CAP_POWER * zones[4]

## Steering pull (rad, + left).
func alignment() -> float:
	var d := corners[0] - corners[1] + (0.5 if punctured[0] else 0.0) - (0.5 if punctured[1] else 0.0)
	return CAP_ALIGNMENT_RAD * clampf(d * 1.4 + signf(d) * zones[0] * 0.3, -1.0, 1.0)

func _side_of(key: String) -> float:
	return zones[2] if key[1] == "L" else zones[3]

func grip_scale(key: String) -> float:
	var g := 1.0 - CAP_GRIP * minf(1.0, _corner_of(key) * 0.8 + _side_of(key) * 0.4)
	return g * 0.35 if _flat(key) else g

func damper_scale(key: String) -> float:
	return 1.0 - 0.35 * minf(1.0, _corner_of(key) * 0.7 + _side_of(key) * 0.4)

func ride_drop(key: String) -> float:
	return CAP_RIDE * minf(1.0, _side_of(key) * 0.5 + _corner_of(key) * 0.6) + (0.06 if _flat(key) else 0.0)

func wear_scale(key: String) -> float:
	return (1.0 + 2.5 * _corner_of(key)) * (6.0 if _flat(key) else 1.0)

func drag_scale() -> float:
	return 1.0 + CAP_DRAG * minf(1.0, (zones[0] + zones[1] + zones[2] + zones[3]) / 2.2)

func downforce_front() -> float:
	return 1.0 - CAP_DOWNFORCE * minf(1.0, zones[0] * 1.1 + (zones[2] + zones[3]) * 0.15)

func downforce_rear() -> float:
	return 1.0 - CAP_DOWNFORCE * minf(1.0, zones[1] * 1.2 + (zones[2] + zones[3]) * 0.15)

## 0..1 overall for the HUD.
func total() -> float:
	var s := 0.0
	for i in 6:
		s += zones[i]
	return minf(1.0, s / 3.0)
