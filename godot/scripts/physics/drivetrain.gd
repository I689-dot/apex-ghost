class_name Drivetrain
extends RefCounted
## Engine + sequential gearbox + launch clutch (port of physics/drivetrain.ts). Gear 0 = neutral, -1 = reverse.

const RPM_TO_RADS := (2.0 * PI) / 60.0

var s: Dictionary
var rpm: float
var gear := 1
## Remaining shift time (s); drive is interrupted while > 0.
var shift_timer := 0.0
var _pending_gear := -999
var manual := false
var limiter_cut := false
## Power multiplier from engine damage (0.6..1).
var power_scale := 1.0
## Power multiplier from the air the engine breathes.
var air_scale := 1.0
## Out of fuel: the engine gets none.
var starved := false
var engine_torque := 0.0
var _auto_cooldown := 0.0

func _init(specs: Dictionary) -> void:
	s = specs
	rpm = float(s.idleRpm)

func torque_at(r: float) -> float:
	var c: Array = s.torqueCurve
	if r <= c[0][0]:
		return c[0][1]
	for i in range(1, c.size()):
		if r <= c[i][0]:
			var t: float = (r - c[i - 1][0]) / (c[i][0] - c[i - 1][0])
			return c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t
	return c[c.size() - 1][1]

func ratio(g: int = 999) -> float:
	if g == 999:
		g = gear
	if g == 0:
		return 0.0
	if g < 0:
		return -float(s.reverseRatio) * float(s.finalDrive)
	return float(s.gears[g - 1]) * float(s.finalDrive)

func is_shifting() -> bool:
	return shift_timer > 0.0

func request_shift(dir: int) -> void:
	var cur := gear if _pending_gear == -999 else _pending_gear
	var target := cur + dir
	if target > s.gears.size() or target < -1:
		return
	if shift_timer > 0.0 and _pending_gear != -999:
		_pending_gear = target
		return
	_pending_gear = target
	shift_timer = float(s.shiftTimeMs) / 1000.0

## Immediate gear set (reverse engagement when stopped).
func set_gear(g: int) -> void:
	gear = g
	_pending_gear = -999
	shift_timer = 0.0

## Advance the engine. wheel_omega is the mean angular speed of the driven wheels (rad/s).
## Returns the torque delivered to the driven axle(s) (Nm, after gearing).
func update(dt: float, throttle: float, wheel_omega: float, speed_ms: float) -> float:
	if shift_timer > 0.0:
		shift_timer -= dt
		if shift_timer <= 0.0 and _pending_gear != -999:
			gear = _pending_gear
			_pending_gear = -999
	if not manual:
		_auto_shift(dt, throttle, speed_ms)

	var rt := ratio()
	var idle := float(s.idleRpm)
	var redline := float(s.redlineRpm)
	var limiter := float(s.limiterRpm)
	var wheel_rpm := int(absf(wheel_omega * rt) / RPM_TO_RADS)
	var launch_rpm := idle + throttle * (redline * 0.45 - idle)
	var clutch := 1.0
	var target := float(wheel_rpm)
	if rt == 0.0 or shift_timer > 0.0:
		clutch = 0.0
		target = idle + throttle * (limiter - idle)
	elif wheel_rpm < launch_rpm:
		target = launch_rpm
	var locked := rt != 0.0 and shift_timer <= 0.0 and wheel_rpm >= launch_rpm
	var rate := 1.0 if locked else 1.0 - exp(-dt * 12.0)
	rpm += (maxf(target, idle * 0.9) - rpm) * rate
	if rpm > limiter:
		rpm = limiter

	if rpm >= limiter - 30.0:
		limiter_cut = true
	elif rpm < limiter - 250.0:
		limiter_cut = false
	var thr := 0.0 if (limiter_cut or starved) else throttle
	var full := torque_at(rpm) * power_scale * air_scale
	var turning := wheel_omega * rt > 0.0
	var drag := (0.06 + 0.12 * (rpm / redline)) * full if turning else 0.0
	var tq := thr * full - (1.0 - thr) * drag
	engine_torque = tq
	if clutch == 0.0:
		return 0.0
	if not locked and throttle < 0.02:
		return 0.0
	return tq * rt * clutch * 0.92 # 8 % driveline loss

func _auto_shift(dt: float, throttle: float, speed_ms: float) -> void:
	_auto_cooldown -= dt
	if gear <= 0 or shift_timer > 0.0 or _auto_cooldown > 0.0:
		return
	var up := float(s.redlineRpm) * (0.9 + 0.06 * throttle)
	if rpm > up and gear < s.gears.size() and speed_ms > 2.0:
		request_shift(1)
		_auto_cooldown = 0.35
		return
	if gear > 1:
		var lower: float = rpm * (float(s.gears[gear - 2]) / float(s.gears[gear - 1]))
		var down: float = float(s.redlineRpm) * (0.72 if throttle > 0.5 else 0.62)
		if lower < down:
			request_shift(-1)
			_auto_cooldown = 0.4
