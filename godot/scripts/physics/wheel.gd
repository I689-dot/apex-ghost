class_name Wheel
extends RefCounted
## One wheel of the vehicle model (port of class Wheel in physics/vehicle.ts).

var key: String
var front: bool
var left: bool
## Hardpoint in car-local space (top of suspension travel).
var hx: float
var hy: float
var hz: float
var radius: float
## Spring length at full extension and the travel to the bump stop (ride height changes both).
var rest_len: float
var travel: float
var rest_len0: float
var travel0: float
var k: float
var c_bump: float
var c_rebound: float
var c_bump0: float
var c_rebound0: float
var inertia: float
var fz0: float
var driven := false

var compression := 0.0
var prev_compression := 0.0
var contact := false
var surface := "asphalt"
## World-space contact point and normal.
var cp := Vector3.ZERO
var n := Vector3.UP
var omega := 0.0
var angle := 0.0
## A flat spot from a lock-up (0..1).
var flat_spot := 0.0
var steer := 0.0
var fz := 0.0
var slip_ratio := 0.0
var slip_angle := 0.0
var alpha_relax := 0.0
var fx := 0.0
var fy := 0.0
var drive_torque := 0.0
var brake_torque := 0.0
## Wheel centre offset below the hardpoint (m), for visuals.
var spring_len := 0.0
## Tyre temperature (C).
var temp := 35.0
## Tread worn away, 0 (new) .. 1 (down to the cords).
var wear := 0.0
## Brake disc temperature (C).
var brake_temp := 60.0
## ABS: the share of the pedal's torque this wheel's valve lets through (1 = all).
var abs_factor := 1.0
var cold_psi := 22.5
var set_c := 32.0
var pressure := 22.5

func _init(wheel_key: String, geom_pos: Vector3, geom_radius: float, s: Dictionary, static_load: float) -> void:
	key = wheel_key
	front = key[0] == "F"
	left = key[1] == "L"
	radius = geom_radius
	travel = float(s.suspTravelM)
	k = float(s.springRateFront) if front else float(s.springRateRear)
	var quarter_mass := static_load / VehicleConsts.G
	var crit := 2.0 * sqrt(k * quarter_mass)
	c_bump = crit * 0.32
	c_bump0 = c_bump
	c_rebound = crit * 0.55
	c_rebound0 = c_rebound
	fz0 = static_load
	var static_comp := static_load / k
	rest_len = travel * 0.55 + static_comp
	rest_len0 = rest_len
	travel0 = travel
	hx = geom_pos.x
	hy = geom_pos.y + (rest_len - static_comp)
	hz = geom_pos.z
	inertia = 1.1 + 2.2 * radius * radius
	spring_len = rest_len - static_comp
