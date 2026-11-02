class_name InputSmoother
extends RefCounted
## Reads the keys, touch and controller into digital targets (port of InputSmoother in physics/input.ts). All smoothing
## happens inside the physics step (KeyboardDriver), never per render frame.

var out := Controls.new()

func _init() -> void:
	out.digital = true

## reverse: the keys swap meaning when reversing (S drives backwards, W brakes).
func update(_dt: float, kb: KeyboardInput, _speed_ms: float, reverse: bool) -> Controls:
	var s: Dictionary = Settings.data
	# the player's keyboard ramps: a short tap is part throttle or brake
	KeyboardDriver.KB.thrUp = 1.0 / maxf(0.05, float(s.keyboard.throttleRamp))
	KeyboardDriver.KB.brkUp = 1.0 / maxf(0.05, float(s.keyboard.brakeRamp))
	KeyboardDriver.KB.rateScale = s.keyboard.steerSpeed
	var up := kb.held("throttle")
	var down := kb.held("brake")
	out.throttle = 1.0 if (down if reverse else up) else 0.0
	out.brake = 1.0 if (up if reverse else down) else 0.0
	out.handbrake = 1.0 if kb.held("handbrake") else 0.0
	var left := kb.held("steerLeft")
	var right := kb.held("steerRight")
	out.steer = 0.0 if left == right else (1.0 if left else -1.0)
	for src in [InputState.touch, InputState.pad]:
		if not src.active:
			continue
		var thr := clampf(src.throttle, 0.0, 1.0)
		var brk := clampf(src.brake, 0.0, 1.0)
		out.throttle = maxf(out.throttle, brk if reverse else thr)
		out.brake = maxf(out.brake, thr if reverse else brk)
		out.handbrake = maxf(out.handbrake, clampf(src.handbrake, 0.0, 1.0))
		# a wheel: its angle (a fraction of half its rotation) scaled to the car's lock (soft lock), 1:1
		var st: float = src.steer
		if src == InputState.pad and InputState.pad.wheel:
			st = src.steer * float(s.wheel.rotationDeg) / InputState.wheel.carLockDeg
		if out.steer == 0.0:
			out.steer = clampf(st, -1.0, 1.0)
	# a wheel drives the steering directly, as a real one: no keyboard or pad filters
	out.digital = not (InputState.pad.active and InputState.pad.wheel and not left and not right)
	# a key held for steering wins; otherwise a connected controller makes the filters proportional
	out.analog = InputState.pad.active and not left and not right and not (InputState.touch.active and InputState.touch.steer != 0.0)
	return out

func reset() -> void:
	out.throttle = 0.0
	out.brake = 0.0
	out.steer = 0.0
	out.handbrake = 0.0
