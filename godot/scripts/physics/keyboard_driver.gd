class_name KeyboardDriver
extends RefCounted
## Keyboard / touch / pad -> analog driver inputs, run inside every physics step (port of physics/keyboardDriver.ts).
## Keys only set targets; asymmetric rate limiters + a short low-pass; steering +-1 means "front tyres at ~95 %
## of their peak slip angle", computed from the car's motion; speed-sensitive; ramped pedals and handbrake.

## Keyboard profile. Mutable (settings change thrUp/brkUp/rate_scale).
static var KB := {
	"steerOutRate": 4.0, "steerReturnRate": 5.5, "steerReverseRate": 8.0, "steerTau": 0.04, "steerGamma": 1.5,
	"targetSlipFrac": 0.95, "hsV0": 70.0 / 3.6, "hsV1": 240.0 / 3.6, "hsOutRate": 1.35, "hsReturnRate": 3.2,
	"hsReverseRate": 4.5, "hsGamma": 2.1, "hsTargetSlipFrac": 0.82, "maxLimitReductionFrac": 0.55,
	"counterMarginFrac": 0.2, "limitRate": 10.0, "minLimitRad": 2.0 * PI / 180.0, "selfResp": 0.35, "selfDamp": 0.35,
	"selfCapRad": 8.0 * PI / 180.0, "thrUp": 5.0, "thrDown": 10.0, "brkUp": 5.0, "brkDown": 10.0, "hbUp": 2.5,
	"hbDown": 10.0, "hbTorquePerWheel": 700.0, "hbFadeV0": 10.0, "hbFadeV1": 28.0, "hbFadeMin": 0.25, "rateScale": 1.0,
}

## Game controller profile (analog stick and triggers).
static var PAD := {
	"steerOutRate": 7.5, "steerReturnRate": 9.0, "steerReverseRate": 11.0, "hsOutRate": 3.2, "hsReturnRate": 4.5,
	"hsReverseRate": 5.5, "steerTau": 0.03, "hsGamma": 1.25, "targetSlipFrac": 0.97, "hsTargetSlipFrac": 0.9,
	"thrUp": 14.0, "thrDown": 20.0, "brkUp": 16.0, "brkDown": 22.0, "rateScale": 1.0, "speedSens": 0.5,
}

## Ramped and filtered steering (-1..1, of the dynamic limit).
var u_ramp := 0.0
var u_filt := 0.0
var limit := 0.4
var throttle := 0.0
var brake := 0.0
var handbrake := 0.0
## Final road-wheel steering angle (rad).
var steer_angle := 0.0

func reset() -> void:
	u_ramp = 0.0; u_filt = 0.0; throttle = 0.0; brake = 0.0; handbrake = 0.0; steer_angle = 0.0

static func _move_towards(v: float, t: float, step: float) -> float:
	return t if absf(t - v) <= step else v + signf(t - v) * step

static func _smoothstep(a: float, b: float, x: float) -> float:
	var t := clampf((x - a) / (b - a), 0.0, 1.0)
	return t * t * (3.0 - 2.0 * t)

## keys: {throttle, brake, steer, handbrake, analog}. m: {vx, vy, r, a, b, wheelbase, maxLockRad, alphaPeak}.
func step(dt: float, keys, m: Dictionary) -> void:
	var kb := KB
	var pd := PAD
	var target: float = keys.steer
	var pad: bool = keys.analog
	var hs := _smoothstep(kb.hsV0, kb.hsV1, m.vx)
	var rate: float
	var reversing := target != 0.0 and u_ramp != 0.0 and signf(target) != signf(u_ramp)
	if pad:
		var ret := absf(target) < absf(u_ramp) and not reversing
		var hs_p: float = hs * pd.speedSens * 2.0
		var k := minf(1.0, hs_p)
		if reversing:
			rate = lerpf(pd.steerReverseRate, pd.hsReverseRate, k)
		elif ret:
			rate = lerpf(pd.steerReturnRate, pd.hsReturnRate, k)
		else:
			rate = lerpf(pd.steerOutRate, pd.hsOutRate, k)
		rate *= pd.rateScale
	elif target == 0.0:
		rate = lerpf(kb.steerReturnRate, kb.hsReturnRate, hs)
	elif reversing:
		rate = lerpf(kb.steerReverseRate, kb.hsReverseRate, hs)
	else:
		rate = lerpf(kb.steerOutRate, kb.hsOutRate, hs)
	if not pad:
		rate *= kb.rateScale
	var before := u_ramp
	u_ramp = _move_towards(u_ramp, target, rate * dt)
	if reversing and signf(u_ramp) != signf(before) and u_ramp != 0.0:
		u_ramp = 0.0
	u_filt += (u_ramp - u_filt) * (1.0 - exp(-dt / (pd.steerTau if pad else kb.steerTau)))
	var gamma: float = lerpf(1.0, pd.hsGamma, hs) if pad else lerpf(kb.steerGamma, kb.hsGamma, hs)
	var u_shaped := signf(u_filt) * pow(absf(u_filt), gamma)

	# dynamic, slip-based steering limit
	var vxa := maxf(absf(m.vx), 0.5)
	var beta_f := atan2(m.vy + m.a * m.r, vxa)
	var beta_r := atan2(m.vy - m.b * m.r, vxa)
	var slip_frac: float = lerpf(pd.targetSlipFrac, pd.hsTargetSlipFrac, hs) if pad else lerpf(kb.targetSlipFrac, kb.hsTargetSlipFrac, hs)
	var alpha_t: float = slip_frac * m.alphaPeak
	var s := signf(u_shaped)
	if s == 0.0:
		s = 1.0
	var lim_inward: float = alpha_t + maxf(s * beta_f, -kb.maxLimitReductionFrac * alpha_t)
	var counter := _smoothstep(0.0785, 0.1745, absf(beta_r)) if s == signf(beta_r) else 0.0
	var lim_counter: float = absf(beta_r) + kb.counterMarginFrac * alpha_t
	var lim_target := lerpf(lim_inward, maxf(lim_inward, lim_counter), counter)
	lim_target = clampf(lim_target, kb.minLimitRad, m.maxLockRad)
	limit += (lim_target - limit) * (1.0 - exp(-kb.limitRate * dt))
	var kk: float = m.wheelbase / 2.5
	var fade := _smoothstep(2.0 * kk, 6.0 * kk, m.vx) if m.vx > 0.0 else 0.0
	var eff_limit := lerpf(m.maxLockRad, limit, fade)

	# self-steer (caster)
	var self_s := clampf(kb.selfResp * 1.4 * beta_r - kb.selfDamp * 0.03 * m.r, -kb.selfCapRad, kb.selfCapRad) * fade
	steer_angle = clampf(u_shaped * eff_limit + self_s * (1.0 - absf(u_filt)), -m.maxLockRad, m.maxLockRad)

	# pedals
	var P: Dictionary = pd if pad else kb
	throttle = _move_towards(throttle, keys.throttle, (P.thrUp if keys.throttle > throttle else P.thrDown) * dt)
	brake = _move_towards(brake, keys.brake, (P.brkUp if keys.brake > brake else P.brkDown) * dt)
	handbrake = _move_towards(handbrake, keys.handbrake, (kb.hbUp if keys.handbrake > handbrake else kb.hbDown) * dt)

## Handbrake torque per rear wheel (N*m), faded with speed.
func handbrake_torque(speed: float) -> float:
	var fade := lerpf(1.0, KB.hbFadeMin, _smoothstep(KB.hbFadeV0, KB.hbFadeV1, speed))
	return handbrake * fade * KB.hbTorquePerWheel
