class_name RemoteCarBuffer
extends RefCounted
## One remote car, from its stream of samples (port of net/remote.ts).
##  - Watching (delay INTERP_DELAY_MS): drawn in the past, Hermite-interpolated between samples with the sent
##    velocities, orientation slerped, extrapolated briefly when packets are late.
##  - Driving (delay 0): drawn where it is now, predicted (dead reckoning) from the newest sample along a curved path.
## Corrections when a new sample disagrees are hidden with a decaying error offset (or a snap when far off).

const BUF := 32
## A stamp this far off the stream is a clock jump, not a late packet.
const RESYNC_MS := 3000.0
## Drawn in the present: predicted at most this far past the newest sample (ms), then held.
const PREDICT_MAX_MS := 500.0
## Prediction steps over that span (the path is integrated, not a straight line).
const PREDICT_STEPS := 8

## Output of sampling a remote car at render time.
class RemoteSample:
	extends CarState
	## True while we are extrapolating past the newest packet.
	var extrapolating := false
	## Milliseconds since the newest packet (render time based).
	var stale_ms := 0.0

var _states: Array = []
var _count := 0
var _head := 0 # index of the newest state
var out := RemoteSample.new()
var _err := Vector3.ZERO
var _last := Vector3.ZERO
var _has_last := false
var last_seq := -1
var loss_count := 0
var recv_count := 0

func _init() -> void:
	for i in BUF:
		_states.append(CarState.new())

func push(s: CarState, seq: int) -> void:
	if last_seq >= 0:
		var gap := (seq - last_seq + 65536) % 65536
		if gap > 1 and gap < 1000:
			loss_count += gap - 1
	last_seq = seq
	recv_count += 1
	var newest: CarState = _states[_head]
	if _count > 0 and s.t <= newest.t:
		# out of order / duplicate; but a newest state seconds ahead of the stream is a bad stamp: start over
		if newest.t - s.t < RESYNC_MS:
			return
		reset()
	_head = (_head + 1) % BUF
	(_states[_head] as CarState).copy_from(s)
	if _count < BUF:
		_count += 1

func has_data() -> bool:
	return _count > 0

func newest_time() -> float:
	return (_states[_head] as CarState).t if _count > 0 else 0.0

## Sample at server_now - delay_ms (0: the present). dt (s) drives the error decay.
func sample(server_now: float, dt: float, delay_ms: float = Const.INTERP_DELAY_MS) -> RemoteSample:
	if _count == 0:
		return null
	var t := server_now - delay_ms
	var o := out
	var newest: CarState = _states[_head]
	o.stale_ms = t - newest.t
	var a: CarState = null
	var b: CarState = null
	for k in range(_count - 1):
		var ib := (_head - k + BUF) % BUF
		var ia := (ib - 1 + BUF) % BUF
		if (_states[ia] as CarState).t <= t and (_states[ib] as CarState).t > t:
			a = _states[ia]
			b = _states[ib]
			break
	if a != null and b != null:
		o.extrapolating = false
		var span := (b.t - a.t) / 1000.0
		var u := (t - a.t) / (b.t - a.t)
		_hermite(o, a, b, u, span)
		_slerp(o, a, b, u)
		o.vx = a.vx + (b.vx - a.vx) * u
		o.vy = a.vy + (b.vy - a.vy) * u
		o.vz = a.vz + (b.vz - a.vz) * u
		o.steer = a.steer + (b.steer - a.steer) * u
		o.rot_f = _lerp_angle(a.rot_f, b.rot_f, u)
		o.rot_r = _lerp_angle(a.rot_r, b.rot_r, u)
		for i in 4:
			o.susp[i] = a.susp[i] + (b.susp[i] - a.susp[i]) * u
		o.flags = a.flags if u < 0.5 else b.flags
		o.t = t
	else:
		# older than everything (just joined) or newer than the newest: hold / extrapolate
		var oldest: CarState = _states[(_head - _count + 1 + BUF) % BUF]
		var base: CarState = oldest if t < oldest.t else newest
		o.copy_from(base)
		var ahead := minf(maxf(0.0, t - base.t), PREDICT_MAX_MS if delay_ms == 0.0 else Const.MAX_EXTRAPOLATION_MS) / 1000.0
		o.extrapolating = ahead > 0.0
		if ahead > 0.0:
			# acceleration along the path, from the last two samples
			var acc := 0.0
			if base == newest and _count > 1:
				var prev: CarState = _states[(_head - 1 + BUF) % BUF]
				var span2 := (newest.t - prev.t) / 1000.0
				if span2 > 0.01 and span2 < 0.3:
					acc = (Vector2(newest.vx, newest.vz).length() - Vector2(prev.vx, prev.vz).length()) / span2
			_predict(o, base, ahead, clampf(acc, -35.0, 15.0) * 0.8)
		o.t = t

	# smooth out discontinuities: compare with where we would be if we continued last frame
	if _has_last:
		var pred := _last + Vector3(o.vx, o.vy, o.vz) * dt
		var e := pred - (Vector3(o.px, o.py, o.pz) + _err)
		var d2 := e.length_squared()
		var tgt := _err + e
		var snap2 := Const.SNAP_DISTANCE_M * Const.SNAP_DISTANCE_M
		if tgt.length_squared() > snap2 or d2 > snap2:
			_err = Vector3.ZERO # too far: snap
		elif d2 > 0.0004:
			_err = tgt
	# a prediction is corrected over a little longer: its errors are larger and a quick snap reads as a twitch
	var decay := exp(-dt / (0.18 if delay_ms == 0.0 else 0.12))
	_err *= decay
	o.px += _err.x
	o.py += _err.y
	o.pz += _err.z
	_last = Vector3(o.px, o.py, o.pz)
	_has_last = true
	return o

func reset() -> void:
	_count = 0
	_has_last = false
	_err = Vector3.ZERO

## Dead reckoning over `ahead` s: the velocity turns at the sampled yaw rate and its speed changes at acc (m/s^2,
## along the path, never through zero). Height follows the vertical speed; the orientation integrates the angular velocity.
static func _predict(o: CarState, b: CarState, ahead: float, acc: float) -> void:
	var h := ahead / PREDICT_STEPS
	var speed := Vector2(b.vx, b.vz).length()
	var x := 0.0
	var z := 0.0
	var vx := b.vx
	var vz := b.vz
	for i in PREDICT_STEPS:
		var tm := (i + 0.5) * h
		var a := b.wy * tm
		var k := maxf(0.0, 1.0 + (acc * tm) / speed) if speed > 0.5 else 1.0
		var c := cos(a)
		var s := sin(a)
		vx = (b.vx * c + b.vz * s) * k
		vz = (-b.vx * s + b.vz * c) * k
		x += vx * h
		z += vz * h
	o.px = b.px + x
	o.py = b.py + b.vy * ahead
	o.pz = b.pz + z
	o.vx = vx
	o.vz = vz
	_integrate_rotation(o, b.wx * ahead, b.wy * ahead, b.wz * ahead)

static func _hermite(o: CarState, a: CarState, b: CarState, u: float, span: float) -> void:
	var u2 := u * u
	var u3 := u2 * u
	var h00 := 2.0 * u3 - 3.0 * u2 + 1.0
	var h10 := u3 - 2.0 * u2 + u
	var h01 := -2.0 * u3 + 3.0 * u2
	var h11 := u3 - u2
	o.px = h00 * a.px + h10 * span * a.vx + h01 * b.px + h11 * span * b.vx
	o.py = h00 * a.py + h10 * span * a.vy + h01 * b.py + h11 * span * b.vy
	o.pz = h00 * a.pz + h10 * span * a.vz + h01 * b.pz + h11 * span * b.vz

static func _slerp(o: CarState, a: CarState, b: CarState, u: float) -> void:
	var bx := b.qx
	var by := b.qy
	var bz := b.qz
	var bw := b.qw
	var cs := a.qx * bx + a.qy * by + a.qz * bz + a.qw * bw
	if cs < 0.0:
		cs = -cs
		bx = -bx
		by = -by
		bz = -bz
		bw = -bw
	var k0: float
	var k1: float
	if cs > 0.9995:
		k0 = 1.0 - u
		k1 = u
	else:
		var th := acos(cs)
		var s := sin(th)
		k0 = sin((1.0 - u) * th) / s
		k1 = sin(u * th) / s
	o.qx = a.qx * k0 + bx * k1
	o.qy = a.qy * k0 + by * k1
	o.qz = a.qz * k0 + bz * k1
	o.qw = a.qw * k0 + bw * k1
	var n := sqrt(o.qx * o.qx + o.qy * o.qy + o.qz * o.qz + o.qw * o.qw)
	if n == 0.0:
		n = 1.0
	o.qx /= n
	o.qy /= n
	o.qz /= n
	o.qw /= n

## q = q * exp(omega*dt/2) with world-space angular velocity (small angle).
static func _integrate_rotation(o: CarState, ax: float, ay: float, az: float) -> void:
	var hx := ax * 0.5
	var hy := ay * 0.5
	var hz := az * 0.5
	var qx := o.qx
	var qy := o.qy
	var qz := o.qz
	var qw := o.qw
	o.qx = qx + (hx * qw + hy * qz - hz * qy)
	o.qy = qy + (hy * qw + hz * qx - hx * qz)
	o.qz = qz + (hz * qw + hx * qy - hy * qx)
	o.qw = qw - (hx * qx + hy * qy + hz * qz)
	var n := sqrt(o.qx * o.qx + o.qy * o.qy + o.qz * o.qz + o.qw * o.qw)
	if n == 0.0:
		n = 1.0
	o.qx /= n
	o.qy /= n
	o.qz /= n
	o.qw /= n

static func _lerp_angle(a: float, b: float, u: float) -> float:
	var d := b - a
	while d > PI:
		d -= PI * 2.0
	while d < -PI:
		d += PI * 2.0
	return a + d * u
