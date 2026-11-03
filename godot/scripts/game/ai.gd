class_name AiDriver
extends RefCounted
## Racing AI (port of game/ai.ts): pure-pursuit steering along a racing line (plus its own small offset) and a
## quasi-steady-state speed profile. Also the racing line builder and the speed profile (statics).

const G := 9.81
const RHO := 1.225
## Fastest throttle application (per second): 0 -> full in 0.25 s.
const THROTTLE_RISE := 4.0
## Distance over which a bot merges from its grid box (or a reset) onto its racing line (m).
const BLEND_M := 260.0
## How fast a bot moves sideways to pass (m per second of lateral target shift).
const PASS_RATE := 2.5
## Speed into the pit lane entry (m/s, ~30 km/h).
const ENTRY_MS := 8.3

## Bots drive with the assists a GT3 car carries.
const BOT_ASSISTS := {"abs": true, "tc": 2, "stability": true, "steering": false}

## Share of the tyres' grip the bots plan with, cornering and braking.
static var AI_GRIP := {"corner": 0.92, "brake": 0.98}

## A racing line: {x, z, offset, ds, curvature} as PackedFloat32Arrays, one value per centreline point.
## Found by minimising curvature (iterative smoothing towards the neighbours' midpoint, clamped to the track edges).
static func build_racing_line(track: Dictionary, margin: float = 2.0, iterations: int = 3000) -> Dictionary:
	var cl: Array = track.centerline
	var n := cl.size() / 3
	var nx := PackedFloat32Array()
	var nz := PackedFloat32Array()
	var lo := PackedFloat32Array()
	var hi := PackedFloat32Array()
	nx.resize(n); nz.resize(n); lo.resize(n); hi.resize(n)
	for i in n:
		var a := ((i - 1 + n) % n) * 3
		var b := ((i + 1) % n) * 3
		var tx: float = cl[b] - cl[a]
		var tz: float = cl[b + 2] - cl[a + 2]
		var l := Vector2(tx, tz).length()
		if l == 0.0:
			l = 1.0
		nx[i] = tz / l
		nz[i] = -tx / l
		lo[i] = -maxf(0.0, track.widthR[i] - margin)
		hi[i] = maxf(0.0, track.widthL[i] - margin)
	var off := PackedFloat32Array()
	var x := PackedFloat32Array()
	var z := PackedFloat32Array()
	off.resize(n); x.resize(n); z.resize(n)
	# the centreline as packed arrays (fast inner loop)
	var cx := PackedFloat32Array()
	var cz := PackedFloat32Array()
	cx.resize(n); cz.resize(n)
	for i in n:
		cx[i] = cl[i * 3]
		cz[i] = cl[i * 3 + 2]
		x[i] = cx[i]
		z[i] = cz[i]
	# coarse-to-fine: wide stencils settle the long-scale shape, narrow ones the local detail
	for k: int in [8, 4, 2, 1]:
		for it in iterations / 4:
			for i in n:
				var a := (i - k + n) % n
				var b := (i + k) % n
				var mx := (x[a] + x[b]) / 2.0
				var mz := (z[a] + z[b]) / 2.0
				var want := (mx - cx[i]) * nx[i] + (mz - cz[i]) * nz[i]
				var o := off[i] + (want - off[i]) * 0.6
				o = lo[i] if o < lo[i] else (hi[i] if o > hi[i] else o)
				off[i] = o
				x[i] = cx[i] + nx[i] * o
				z[i] = cz[i] + nz[i] * o
	var ds := PackedFloat32Array()
	ds.resize(n)
	for i in n:
		var j := (i + 1) % n
		var d := Vector2(x[j] - x[i], z[j] - z[i]).length()
		ds[i] = d if d != 0.0 else 0.01
	var curvature := PackedFloat32Array()
	curvature.resize(n)
	var kk := 2 # +-10 m stencil
	for i in n:
		var a := (i - kk + n) % n
		var c := (i + kk) % n
		var abx := x[i] - x[a]
		var abz := z[i] - z[a]
		var bcx := x[c] - x[i]
		var bcz := z[c] - z[i]
		var cross := abx * bcz - abz * bcx
		var la := Vector2(abx, abz).length()
		var lb := Vector2(bcx, bcz).length()
		var lc := Vector2(x[a] - x[c], z[a] - z[c]).length()
		# x/z with +X left: a left turn has a negative cross product in this frame
		curvature[i] = (-2.0 * cross) / (la * lb * lc) if la * lb * lc > 1e-6 else 0.0
	# light smoothing of the curvature
	var tmp := curvature.duplicate()
	for i in n:
		curvature[i] = (tmp[(i - 1 + n) % n] + 2.0 * tmp[i] + tmp[(i + 1) % n]) / 4.0
	return {"x": x, "z": z, "offset": off, "ds": ds, "curvature": curvature}

## What the speed profile needs to know about the car.
static func car_limits(specs: Dictionary, skill: float = 1.0, air_density: float = RHO) -> Dictionary:
	return {
		"airDensity": air_density, "massKg": specs.massKg, "mu": specs.tyreGrip * AI_GRIP.corner * skill,
		"muBrake": specs.tyreGrip * AI_GRIP.brake * skill, "dragArea": specs.dragArea, "downforceArea": specs.downforceArea,
		"powerW": specs.powerKw * 1000.0 * 0.85, "vMax": specs.topSpeedKmh / 3.6,
	}

## Quasi-steady-state speed profile along the racing line: cornering limit with downforce, a backward braking pass
## that shares grip with cornering (friction ellipse), optionally a forward power-limited pass.
## gmul: per centreline point, how much of the planned grip the bots dare use there (learned_grip), or empty.
static func speed_profile(line: Dictionary, car: Dictionary, weather_grip: float = 1.0, forward: bool = false, gmul: PackedFloat32Array = PackedFloat32Array()) -> PackedFloat32Array:
	var ds: PackedFloat32Array = line.ds
	var curv: PackedFloat32Array = line.curvature
	var n := ds.size()
	var v := PackedFloat32Array()
	v.resize(n)
	var mass: float = car.massKg
	var k: float = (0.5 * car.airDensity * car.downforceArea) / mass
	var kd: float = (0.5 * car.airDensity * car.dragArea) / mass
	var mu: float = car.mu * weather_grip
	var mu_b: float = car.muBrake * weather_grip
	var vmax: float = car.vMax
	var has_g := gmul.size() == n
	for i in n:
		var kap := absf(curv[i])
		var mu_i := mu * (gmul[i] if has_g else 1.0)
		var den := kap - mu_i * k
		v[i] = vmax if den <= 1e-6 else minf(vmax, sqrt((mu_i * G) / den))
	for pass_i in 2:
		for j in range(n - 1, -1, -1):
			var nxt := (j + 1) % n
			var vn := v[nxt]
			var grip := mu_b * (gmul[nxt] if has_g else 1.0) * (G + k * vn * vn)
			var lat := vn * vn * absf(curv[nxt])
			var avail := sqrt(maxf(0.0, grip * grip - lat * lat))
			var dec := avail + kd * vn * vn
			v[j] = minf(v[j], sqrt(vn * vn + 2.0 * dec * ds[j]))
	if forward:
		for pass_i in 2:
			for i in n:
				var nxt2 := (i + 1) % n
				var vi := maxf(v[i], 1.0)
				var grip2 := mu * (G + k * vi * vi)
				var lat2 := vi * vi * absf(curv[i])
				var avail2 := sqrt(maxf(0.0, grip2 * grip2 - lat2 * lat2))
				var acc := minf(car.powerW / (mass * vi), avail2) - kd * vi * vi - 0.013 * G
				v[nxt2] = minf(v[nxt2], sqrt(maxf(0.0, vi * vi + 2.0 * acc * ds[i])))
	return v

## Lap time (s) of a quasi-steady-state profile (forward pass included).
static func profile_lap_time(line: Dictionary, v: PackedFloat32Array) -> float:
	var t := 0.0
	var ds: PackedFloat32Array = line.ds
	for i in v.size():
		t += ds[i] / maxf(1.0, (v[i] + v[(i + 1) % v.size()]) / 2.0)
	return t

static var _line_cache := {} # track id -> line
static var _learned_cache := {} # track id -> PackedFloat32Array (per centreline point)

## What the bots learned driving this layout (tests/ai_learn.gd: laps on the game's physics, braking later and
## carrying more speed where they had grip to spare, less where they ran wide, slid or left the track): a grip
## multiplier per centreline point, from data/ai_learned/<layout>.json. Empty when there is none.
static func learned_grip(track: Dictionary) -> PackedFloat32Array:
	if _learned_cache.has(track.id):
		return _learned_cache[track.id]
	var out := PackedFloat32Array()
	var f := FileAccess.get_file_as_string("res://data/ai_learned/%s.json" % track.id)
	if f != "":
		var d = JSON.parse_string(f)
		if d is Dictionary and d.has("mult"):
			var bin: float = d.binM
			var mult: Array = d.mult
			var cum: Array = track.cumS
			out.resize(cum.size())
			for i in cum.size():
				out[i] = float(mult[clampi(int(cum[i] / bin), 0, mult.size() - 1)])
	_learned_cache[track.id] = out
	return out

## Racing lines are the same for every car: build once per track.
static func racing_line_for(track: Dictionary) -> Dictionary:
	if not _line_cache.has(track.id):
		_line_cache[track.id] = build_racing_line(track)
	return _line_cache[track.id]

## Store a racing line built elsewhere (RacingLinePrep: in a thread while the session loads).
static func prime_racing_line(track: Dictionary, line: Dictionary) -> void:
	if not _line_cache.has(track.id):
		_line_cache[track.id] = line

static func index_at(t: Dictionary, s: float) -> int:
	return TrackMath.index_at_distance(t, s)

# ------------------------------------------------------------------ driver ---

var controls := Controls.new()
var _profile: PackedFloat32Array
var _profile_grip := 1.0
var _line: Dictionary
var _limits: Dictionary
var _hint := -1
var _stuck := 0.0
var _wrong_way := 0.0
var _off_track := 0.0
## Set when the AI teleported itself back onto the track (forwarded as the reset flag).
var reset_requested := false
var dbg_vt := 0.0
## Joining the racing line: from the grid (or a reset) the bot first holds the line it stands on and merges onto its
## racing line over BLEND_M.
var _blend_off := 0.0
var _blend_left := 0.0
var _need_blend := true
## Passing: lateral offset (m, + = left) asked for by the traffic logic, and the one applied now.
var pass_target := 0.0
var _pass_off := 0.0
var _lane_now := 0.0
var _roomy := 1.0
## Pit stop asked for by the session: "stop" in the box, or "through" (a drive-through), or "".
var pit_request := ""
var pit_box := 0
## How far its box is from the traced lane, towards the garage (m).
var pit_box_shift := 0.0
var in_pit_lane := false
var _box_done := false
var _lane_idx := 0
var _lane_stuck := 0.0
var _last_s := 0.0
## Human: the pace is never the same twice (a bit per 25 m stretch, new every lap, less for the better drivers), and
## now and then a braking point is missed (too fast into the corner: the car runs wide or locks a wheel).
## Off for learning laps (tests/ai_learn.gd) and when the AI drives the player's car.
var human := true
var _rng := RandomNumberGenerator.new()
var _lap_salt := 0
var _mistake_m := 0.0
var _was_braking := false
## The lap's pace factor of a stretch: deterministic per bot, lap and stretch.
func _pace(s: float) -> float:
	var b := int(s / 25.0)
	var h := hash(Vector3i(get_instance_id() & 0xffff, _lap_salt, b))
	var u := float(h % 10000) / 10000.0 - 0.5
	var spread := 0.022 * clampf(1.06 - skill, 0.06, 0.25) / 0.15
	return 1.0 + u * spread

var track: Dictionary
var vehicle: Vehicle
## 0.82 (slow) .. 0.97 (fast)
var skill: float
## extra lateral offset from the racing line (m, + = left), so bots don't drive in single file
var lane: float

func _init(track_data: Dictionary, veh: Vehicle, skill_value: float, lane_offset: float) -> void:
	track = track_data
	vehicle = veh
	skill = skill_value
	lane = lane_offset
	controls.digital = false
	_line = racing_line_for(track)
	_limits = car_limits(veh.specs, skill, veh.air_density)
	_profile = speed_profile(_line, _limits, 1.0, false, learned_grip(track))
	_rng.seed = hash(get_instance_id())

func lane_index() -> int:
	return _lane_idx

## Room to pass: no corner or braking zone in the next 150 m.
func can_pass() -> bool:
	var v: float = vehicle.telemetry.speed
	var d := 0
	while d <= 150:
		if _profile[index_at(track, _last_s + d)] < maxf(v, 20.0) * 0.92:
			return false
		d += 10
	return true

## Stopped at its box, waiting for the crew.
func at_box() -> bool:
	return in_pit_lane and pit_request == "stop" and not _box_done and vehicle.telemetry.speed < 0.5 and _lane_idx >= pit_box - 4

## The crew is done: drive on to the pit exit.
func pit_served() -> void:
	_box_done = true

## The side (+1 left, -1 right) with more track beside the line here.
func roomy_side() -> float:
	return _roomy

## Pit lane target point and speed, or {} when not pitting. {follow: false} while still on track braking for the entry.
func _pit_path(dt: float, x: float, z: float, s: float, speed: float) -> Dictionary:
	var pl = track.get("pitLane", null)
	if pl == null or (pit_request == "" and not in_pit_lane):
		return {}
	var pts: Array = pl.points
	var n := pts.size()
	var limit: float = pl.speedLimitKmh / 3.6 - 0.8
	if not in_pit_lane:
		var d := TrackMath.wrap_delta(s, pl.entryS, track.length)
		if d < 0.0 or d > 600.0:
			return {}
		var v := sqrt(ENTRY_MS * ENTRY_MS + 2.0 * 6.0 * maxf(0.0, d - 10.0))
		if d > 50.0:
			return {"follow": false, "x": 0.0, "z": 0.0, "v": v}
		in_pit_lane = true
		_lane_idx = 0
		_box_done = false
		_lane_stuck = 0.0
		vehicle.set_walls(false)
	# where along the lane (only once on it)
	var best := INF
	var bi := _lane_idx
	for i in range(maxi(0, _lane_idx - 3), mini(n, _lane_idx + 30)):
		var dx: float = pts[i][0] - x
		var dz: float = pts[i][2] - z
		var dd := dx * dx + dz * dz
		if dd < best:
			best = dd
			bi = i
	if best < 15.0 * 15.0:
		_lane_idx = bi
	if _lane_idx >= n - 3:
		# back on the circuit: onto the racing line again
		in_pit_lane = false
		pit_request = ""
		_need_blend = true
		vehicle.set_walls(true)
		return {}
	var step: float = pl.length / (n - 1) if n > 1 else 2.5
	if step == 0.0:
		step = 2.5
	var k := mini(n - 1, _lane_idx + maxi(2, roundi((3.0 + 0.12 * speed) / step)))
	var v2: float = ENTRY_MS if _lane_idx < 8 else limit
	if pit_request == "stop" and not _box_done:
		var dist := (pit_box - _lane_idx) * step
		v2 = 0.0 if dist <= 0.5 else minf(v2, sqrt(2.0 * 3.5 * (dist - 0.5)))
	_lane_stuck = _lane_stuck + dt if v2 > 0.0 and speed < 1.0 else 0.0
	if _lane_stuck > 2.5:
		var j := mini(n - 2, _lane_idx + 2)
		var yaw := atan2(pts[j + 1][0] - pts[j][0], pts[j + 1][2] - pts[j][2])
		vehicle.place(pts[j][0], pts[j][1] + 0.3, pts[j][2], yaw)
		_lane_stuck = 0.0
		reset_requested = true
	# across to the box in front of the garage over the last 12 m, back to the lane line over 15 m after it
	var w := 0.0
	if pit_request == "stop" and pit_box_shift > 0.0:
		if _box_done:
			w = clampf(1.0 - ((k - pit_box) * step) / 15.0, 0.0, 1.0)
		else:
			w = clampf(1.0 - ((pit_box - k) * step) / 12.0, 0.0, 1.0)
	var away := Vector2.ZERO
	if w > 0.0:
		away = PitLaneMonitor.lane_geometry(track).away[k]
	return {"follow": true, "x": pts[k][0] + away.x * pit_box_shift * w, "z": pts[k][2] + away.y * pit_box_shift * w, "v": v2}

## checkpoint_s: lap distance of the last gate this bot passed (resets go there, like a player's reset), or -1.
## speed_cap: highest speed allowed now (m/s): a car directly ahead.
func update(dt: float, race_started: bool, weather_grip: float, checkpoint_s: float = -1.0, speed_cap: float = INF) -> Controls:
	var c := controls
	var v := vehicle
	var t := track
	var p := v.global_position
	var speed: float = v.telemetry.speed
	var i := TrackMath.nearest_centerline_index(t, p.x, p.y, p.z, _hint, 30)
	_hint = i
	var s := TrackMath.progress_at(t, i, p.x, p.z)
	var cl: Array = t.centerline
	var n := cl.size() / 3
	var lx_: PackedFloat32Array = _line.x
	var lz_: PackedFloat32Array = _line.z
	var loff: PackedFloat32Array = _line.offset
	var lcurv: PackedFloat32Array = _line.curvature
	if _need_blend:
		# where the car stands relative to its own racing line (+ = left)
		var k2 := (i + 1) % n
		var ux: float = cl[k2 * 3] - cl[i * 3]
		var uz: float = cl[k2 * 3 + 2] - cl[i * 3 + 2]
		var ul := Vector2(ux, uz).length()
		if ul == 0.0:
			ul = 1.0
		ux /= ul
		uz /= ul
		_blend_off = (p.x - lx_[i]) * uz - (p.z - lz_[i]) * ux - lane
		_blend_left = BLEND_M
		_need_blend = false
	if race_started:
		_blend_left = maxf(0.0, _blend_left - speed * dt)
	var u := _blend_left / BLEND_M
	var merge := _blend_off * u * u * (3.0 - 2.0 * u)
	_pass_off += clampf(pass_target - _pass_off, -PASS_RATE * dt, PASS_RATE * dt)

	# target point ahead on the racing line (interpolated between line points)
	var look := 4.5 + 0.24 * speed
	var sa := s + look
	var j := index_at(t, sa)
	var j2 := (j + 1) % n
	var cum: Array = t.cumS
	var seg_s: float = t.length - cum[j] if j2 == 0 else cum[j2] - cum[j]
	var f := clampf((fposmod(sa, t.length) - cum[j]) / (seg_s if seg_s != 0.0 else 1.0), 0.0, 1.0)
	var tx: float = cl[j2 * 3] - cl[j * 3]
	var tz: float = cl[j2 * 3 + 2] - cl[j * 3 + 2]
	var tl := Vector2(tx, tz).length()
	if tl == 0.0:
		tl = 1.0
	tx /= tl
	tz /= tl
	var line_off := loff[j] + (loff[j2] - loff[j]) * f
	# the bot's own lane only on straights; it moves back onto the line before a corner
	var k_max := 0.0
	var d := 0
	while d <= 120:
		k_max = maxf(k_max, absf(lcurv[index_at(t, s + d)]))
		d += 10
	var lane_target := lane * clampf(1.0 - k_max * 300.0, 0.0, 1.0)
	var lane_step := 0.04 * maxf(speed, 5.0) * dt
	_lane_now += clampf(lane_target - _lane_now, -lane_step, lane_step)
	var extra := clampf(line_off + _lane_now + merge + _pass_off, -t.widthR[j] + 1.2, t.widthL[j] - 1.2) - line_off
	_roomy = 1.0 if t.widthL[j] - line_off > t.widthR[j] + line_off else -1.0
	var px: float = lx_[j] + (lx_[j2] - lx_[j]) * f + tz * extra
	var pz: float = lz_[j] + (lz_[j2] - lz_[j]) * f - tx * extra
	var pit := _pit_path(dt, p.x, p.z, s, speed)
	if not pit.is_empty() and pit.follow:
		px = pit.x
		pz = pit.z

	# into the car frame (+X left, +Z forward)
	var b := v.global_transform.basis
	var fx := b.z.x
	var fz := b.z.z
	var lx := b.x.x
	var lz := b.x.z
	var dx := px - p.x
	var dz := pz - p.z
	var local_z := dx * fx + dz * fz
	var local_x := dx * lx + dz * lz
	var alpha := atan2(local_x, maxf(0.5, local_z))
	var steer_angle: float = atan((2.0 * v.wheelbase * sin(alpha)) / Vector2(local_x, local_z).length())
	# the same physical limit as the keyboard driver: keep the front tyres just below their peak slip angle
	var lin := v.linear_velocity
	var v_f := lin.x * fx + lin.z * fz
	var v_l := lin.x * lx + lin.z * lz
	var yaw_rate := v.angular_velocity.y
	var slide := 0.0
	var alpha_peak: float = v.tire.p.alpha_peak
	if v_f > 4.0:
		var beta_f := atan2(v_l + 0.5 * v.wheelbase * yaw_rate, v_f)
		var beta_r := atan2(v_l - 0.5 * v.wheelbase * yaw_rate, v_f)
		slide = clampf((absf(beta_r) - alpha_peak) / alpha_peak, 0.0, 1.0)
		var lim := 0.9 * alpha_peak * (1.0 - 0.85 * slide)
		steer_angle = clampf(steer_angle, beta_f - lim, beta_f + lim)
	var target := clampf(steer_angle / v.max_steer, -1.0, 1.0)
	c.steer += (target - c.steer) * minf(1.0, dt * (12.0 + 24.0 * slide))

	# speed: the profile a little ahead; rebuilt when the track gets wetter or drier
	if absf(weather_grip - _profile_grip) > 0.02:
		_profile_grip = weather_grip
		_profile = speed_profile(_line, _limits, weather_grip * (1.0 - 0.35 * maxf(0.0, 1.0 - weather_grip)), false, learned_grip(track))
	var vt := _profile[index_at(t, s + 2.0 + speed * 0.12)]
	var v_max: float = _limits.vMax
	if human and race_started:
		if s < _last_s - float(t.length) * 0.5:
			_lap_salt += 1
		vt *= _pace(s)
		# a braking zone starts: rarely, one braked a little late (a less skilled driver more often)
		var braking := vt < speed * 0.9
		if braking and not _was_braking and _mistake_m <= 0.0 and _rng.randf() < 0.012 * clampf(1.1 - skill, 0.05, 0.3) / 0.1:
			_mistake_m = 55.0
		_was_braking = braking
		if _mistake_m > 0.0:
			_mistake_m -= speed * dt
			vt *= 1.07
	if vt < v_max * 0.9:
		vt *= 1.0 - 0.35 * (1.0 - v.wake.downforce)
	vt = minf(vt, speed_cap)
	if not pit.is_empty():
		vt = minf(vt, pit.v)
	_last_s = s
	dbg_vt = vt
	var err := vt - speed
	if err > 0.0:
		var thr := clampf(0.4 + err * 0.3, 0.0, 1.0)
		# rear grip guard: back out of it as the rear axle's slip angle passes the tyre's peak
		if v_f > 3.0:
			var beta_r2 := absf(atan2(v_l - 0.5 * v.wheelbase * yaw_rate, v_f))
			thr *= clampf(1.0 - (beta_r2 - 0.6 * alpha_peak) / (0.5 * alpha_peak), 0.0, 1.0)
		c.throttle = minf(thr, c.throttle + dt * THROTTLE_RISE)
		c.brake = 0.0
	elif err > -0.6:
		c.throttle = maxf(clampf(0.3 + err * 0.5, 0.0, 1.0), c.throttle - dt * 6.0)
		c.brake = 0.0
	else:
		c.throttle = 0.0
		# trail-braking: less brake with more lock, and off the brake while the rear is sliding
		c.brake = clampf(-err * 0.35, 0.0, 1.0) * clampf(1.3 - absf(c.steer), 0.35, 1.0) * (1.0 - 0.8 * slide)
	if not race_started:
		c.throttle = 0.0
		c.brake = 0.0
	elif not pit.is_empty() and pit.v == 0.0 and speed < 1.5:
		# standing in the box (not on full brake: held at a standstill, that engages reverse)
		c.throttle = 0.0
		c.brake = 0.6

	# recovery: stuck against something, or far off the circuit
	var lateral := absf((p.x - cl[i * 3]) * tz - (p.z - cl[i * 3 + 2]) * tx)
	_stuck = _stuck + dt if race_started and speed < 2.0 and not in_pit_lane else 0.0
	_off_track = _off_track + dt if lateral > 22.0 and not in_pit_lane else 0.0
	_wrong_way = _wrong_way + dt if race_started and fx * tx + fz * tz < -0.2 and speed < 12.0 else 0.0
	if _stuck > 4.0 or _off_track > 3.0 or _wrong_way > 3.0:
		var k := index_at(t, checkpoint_s + 2.0 if checkpoint_s >= 0.0 else s - 10.0)
		var k2b := (k + 1) % n
		var yaw := atan2(cl[k2b * 3] - cl[k * 3], cl[k2b * 3 + 2] - cl[k * 3 + 2])
		v.place(cl[k * 3], cl[k * 3 + 1] + 0.3, cl[k * 3 + 2], yaw)
		_stuck = 0.0
		_off_track = 0.0
		_wrong_way = 0.0
		_hint = -1
		reset_requested = true
		_need_blend = true
	return c

## Learning (tests/ai_learn.gd): a new grip multiplier per point, the profile rebuilt with it.
func set_learned(g: PackedFloat32Array) -> void:
	_learned_cache[track.id] = g
	_profile = speed_profile(_line, _limits, _profile_grip, false, g)
