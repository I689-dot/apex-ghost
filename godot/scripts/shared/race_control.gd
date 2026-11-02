class_name RaceControl
extends RefCounted
## Race control, after SRO's GT World Challenge procedures (port of packages/shared/src/raceControl.ts): yellow
## flags, full-course yellow, the safety car, blue flags, and drive-throughs for overtaking under caution.
## The safety car's path is deterministic (safety_car_at): every client draws it in the same place.

const C := {
	"stoppedMs": 4.0, "yellowAfterMs": 2000.0, "yellowBeforeM": 250.0, "yellowAfterM": 60.0, "fcyAfterMs": 12000.0,
	"fcyKmh": 80.0, "fcyWarningMs": 10000.0, "clearForMs": 5000.0, "fcyMinMs": 20000.0, "scAfterFcyMs": 40000.0,
	"scCars": 2, "scDamage": 0.6, "scAheadM": 250.0, "scMinMs": 75000.0, "scMaxSpeed": 150.0 / 3.6, "scLatAcc": 8.0,
	"scBrake": 7.0, "scAccel": 3.5, "giveBackMs": 8000.0, "slowCarMs": 12.0, "blueM": 80.0, "blueMaxMs": 25000.0,
	"staleMs": 3000.0, "pitExitGraceMs": 10000.0,
}

## Course states: "green", "fcy", "sc", "sc-in".
static func green_state(t: float) -> Dictionary:
	return {"course": "green", "since": t, "limitAt": null, "sc": null, "yellows": [], "blue": []}

# ------------------------------------------------------------ safety car ---

static var _paths := {}

## The safety car's pace around the centreline: {length, time: PackedFloat64Array, lapS, cumS}.
static func safety_car_path(track: Dictionary) -> Dictionary:
	var key := "%s/%s" % [track.id, track.length]
	if _paths.has(key):
		return _paths[key]
	var cl: Array = track.centerline
	var cum: Array = track.cumS
	var n := cl.size() / 3
	var ds := PackedFloat64Array()
	ds.resize(n)
	for i in n:
		ds[i] = cum[i + 1] - cum[i] if i + 1 < n else track.length - cum[i]
	var v := PackedFloat64Array()
	v.resize(n)
	for i in n:
		var d := _head(cl, n, i + 3) - _head(cl, n, i - 3)
		d = atan2(sin(d), cos(d))
		var span := 0.0
		for k in range(-3, 3):
			span += ds[posmod(i + k, n)]
		var curv := absf(d) / maxf(span, 1.0)
		v[i] = minf(C.scMaxSpeed, sqrt(C.scLatAcc / curv) if curv > 1e-6 else C.scMaxSpeed)
	for pass_i in 2:
		for j in range(n - 1, -1, -1):
			v[j] = minf(v[j], sqrt(pow(v[(j + 1) % n], 2) + 2.0 * C.scBrake * ds[j]))
		for i in n:
			var nx := (i + 1) % n
			v[nx] = minf(v[nx], sqrt(pow(v[i], 2) + 2.0 * C.scAccel * ds[i]))
	var time := PackedFloat64Array()
	time.resize(n + 1)
	for i in n:
		time[i + 1] = time[i] + ds[i] / maxf(1.0, (v[i] + v[(i + 1) % n]) / 2.0)
	var p := {"length": track.length, "time": time, "lapS": time[n], "cumS": cum}
	_paths[key] = p
	return p

static func _head(cl: Array, n: int, i: int) -> float:
	var a := posmod(i, n)
	var b := (a + 1) % n
	return atan2(cl[b * 3] - cl[a * 3], cl[b * 3 + 2] - cl[a * 3 + 2])

## Time (s) from the line to lap distance s along the safety car's path.
static func _time_at(p: Dictionary, s: float) -> float:
	var L: float = p.length
	s = fposmod(s, L)
	var c: Array = p.cumS
	var lo := 0
	var hi := c.size() - 1
	while lo < hi:
		var m := (lo + hi + 1) >> 1
		if c[m] <= s:
			lo = m
		else:
			hi = m - 1
	var nxt: float = c[lo + 1] if lo + 1 < c.size() else L
	var f: float = (s - c[lo]) / maxf(1e-6, nxt - c[lo])
	var tm: PackedFloat64Array = p.time
	return tm[lo] + (tm[lo + 1] - tm[lo]) * f

## Lap distance (m) of the safety car at server time t (deployed at t0 at s0).
static func safety_car_at(p: Dictionary, t0: float, s0: float, t: float) -> float:
	var total := _time_at(p, s0) + maxf(0.0, t - t0) / 1000.0
	var into := fmod(total, p.lapS)
	var tm: PackedFloat64Array = p.time
	var c: Array = p.cumS
	var lo := 0
	var hi := tm.size() - 2
	while lo < hi:
		var m := (lo + hi + 1) >> 1
		if tm[m] <= into:
			lo = m
		else:
			hi = m - 1
	var nxt: float = c[lo + 1] if lo + 1 < c.size() else p.length
	var f := (into - tm[lo]) / maxf(1e-6, tm[lo + 1] - tm[lo])
	return c[lo] + (nxt - c[lo]) * f

## When (server ms) the safety car, deployed at t0/s0, next reaches lap distance s after time `after`.
static func safety_car_reaches(p: Dictionary, t0: float, s0: float, after: float, s: float) -> float:
	var now := safety_car_at(p, t0, s0, after)
	var dt := _time_at(p, s) - _time_at(p, now)
	if dt <= 0.0:
		dt += p.lapS
	return after + dt * 1000.0

# ---------------------------------------------------------- race control ---

var state: Dictionary
## Bumped on every change of state (the server broadcasts it then).
var version := 0
var path: Dictionary
var tracker: RaceTracker
## FCY, safety car and penalties (the race with the rule on); otherwise yellow flags only.
var full: bool
var _stopped_since := {}
var _damage := {}
var _prev_dist := {}
var _prev_sc_delta := {}
var _blue_since := {}
var _in_pit := {}
var _pit_exit_at := {}
var _passes: Array = [] # {by, of, at, reason}
var _clear_since = null
var _fcy_incident_at := 0.0
var _restart_laps = null

func _init(race_tracker: RaceTracker, full_rules: bool) -> void:
	tracker = race_tracker
	full = full_rules
	state = green_state(tracker.start_ms)
	path = safety_car_path(tracker.track)

## Damage reported by a car (its worst zone, 0..1).
func set_damage(id: String, worst: float) -> void:
	_damage[id] = worst

func _set_state(patch: Dictionary) -> void:
	state = state.merged(patch, true)
	version += 1

## Call a few times a second with the server time; drive-throughs come out as tracker events.
func update(t: float, out: Array = []) -> Array:
	var tr := tracker
	if t < tr.start_ms:
		return out
	var L: float = tr.track.length
	var cars: Array = []
	for p in tr.players.values():
		if p.in_pit:
			_in_pit[p.id] = true
		elif _in_pit.erase(p.id):
			_pit_exit_at[p.id] = t
		var live: bool = p.has_pos and not p.dnf and p.finished_ms == null and t - p.lt < C.staleMs
		if live and not p.in_pit:
			cars.append(p)
		if not live or p.in_pit or not p.rolling or p.speed > C.stoppedMs:
			_stopped_since.erase(p.id)
		elif not _stopped_since.has(p.id):
			_stopped_since[p.id] = t

	# incidents: cars standing on the track
	var yellows: Array = []
	var fcy_cars := 0
	var serious := false
	for id in _stopped_since:
		var p: RaceTracker.PlayerRaceState = tr.players.get(id)
		if p == null:
			continue
		var dur: float = t - _stopped_since[id]
		if dur >= C.yellowAfterMs:
			yellows.append([p.progress_s - C.yellowBeforeM, p.progress_s + C.yellowAfterM])
		if dur >= C.fcyAfterMs:
			fcy_cars += 1
			if _damage.get(id, 0.0) >= C.scDamage:
				serious = true
	var clear := _stopped_since.is_empty()
	if clear:
		if _clear_since == null:
			_clear_since = t
	else:
		_clear_since = null
	var rounded: Array = yellows.map(func(y): return [roundi(y[0]), roundi(y[1])])
	var cur: Array = state.yellows.map(func(y): return [roundi(y[0]), roundi(y[1])])
	if str(rounded) != str(cur):
		_set_state({"yellows": rounded})

	if full and tr.is_race:
		_course(t, fcy_cars, serious)
		_blue_flags(t, cars, L, out)
	_overtakes(t, cars, L, out)
	return out

## Green -> FCY -> safety car -> in this lap -> green.
func _course(t: float, fcy_cars: int, serious: bool) -> void:
	var st := state
	var tr := tracker
	var leader = _leader()
	if st.course == "green" and fcy_cars > 0:
		_fcy_incident_at = t
		if fcy_cars >= C.scCars or serious:
			_deploy_sc(t, leader)
		else:
			_set_state({"course": "fcy", "since": t, "limitAt": t + C.fcyWarningMs, "sc": null})
		return
	if st.course == "fcy":
		var limit_at: float = st.limitAt if st.limitAt != null else t
		var clear_long: bool = _clear_since != null and t - _clear_since >= C.clearForMs and t - limit_at >= C.fcyMinMs - C.fcyWarningMs
		if clear_long:
			_set_state({"course": "green", "since": t, "limitAt": null})
		elif fcy_cars >= C.scCars or serious or (fcy_cars > 0 and t - _fcy_incident_at >= C.scAfterFcyMs):
			_deploy_sc(t, leader)
		return
	var sc = st.sc
	if st.course == "sc" and sc != null:
		if _clear_since != null and t - _clear_since >= C.clearForMs and t - st.since >= C.scMinMs:
			var entry: float = tr.track.get("pitEntryS", null) if tr.track.get("pitEntryS", null) != null else 0.0
			var nsc: Dictionary = sc.duplicate()
			nsc.inAt = safety_car_reaches(path, sc.t0, sc.s0, t, entry)
			_set_state({"course": "sc-in", "sc": nsc})
			_restart_laps = null
		return
	if st.course == "sc-in" and sc != null and sc.inAt != null and t >= sc.inAt:
		if _restart_laps == null:
			_restart_laps = leader.laps if leader != null else 0
		elif leader == null or leader.laps > _restart_laps:
			_set_state({"course": "green", "since": t, "sc": null, "limitAt": null})

func _deploy_sc(t: float, leader) -> void:
	var s0: float = (leader.progress_s if leader != null else 0.0) + C.scAheadM
	_set_state({"course": "sc", "since": t, "limitAt": null, "sc": {"t0": t, "s0": s0, "inAt": null}})

func _leader():
	var best = null
	for p in tracker.players.values():
		if not p.dnf and p.finished_ms == null and (best == null or p.race_dist > best.race_dist):
			best = p
	return best

## A car being lapped with a lapping car close behind it gets the blue flag; too long is a drive-through.
func _blue_flags(t: float, cars: Array, L: float, out: Array) -> void:
	var blue: Array = []
	for c in cars:
		var behind := false
		for f in cars:
			if f == c or f.race_dist < c.race_dist + L * 0.5:
				continue
			var gap := TrackMath.wrap_delta(f.progress_s, c.progress_s, L)
			if gap > 0.0 and gap < C.blueM:
				behind = true
				break
		if not behind:
			_blue_since.erase(c.id)
			continue
		blue.append(c.id)
		var since: float = _blue_since.get(c.id, t)
		_blue_since[c.id] = since
		if t - since >= C.blueMaxMs:
			tracker.add_drive_through(c.id, "blue-flags", out)
			_blue_since[c.id] = t
	if ",".join(blue) != ",".join(state.blue):
		_set_state({"blue": blue})

## Overtaking under a caution and passing the safety car: pending for giveBackMs; a drive-through if not given back.
func _overtakes(t: float, cars: Array, L: float, out: Array) -> void:
	var st := state
	var caution := ""
	if st.course == "fcy":
		caution = "overtake-fcy"
	elif st.course == "sc" or st.course == "sc-in":
		caution = "overtake-sc"
	var sc_s = null
	if st.sc != null and (st.sc.inAt == null or t < st.sc.inAt):
		sc_s = safety_car_at(path, st.sc.t0, st.sc.s0, t)
	var penalise: bool = full and tracker.is_race
	for a in cars:
		var pa = _prev_dist.get(a.id)
		for b in cars:
			if a == b or pa == null:
				continue
			var pb = _prev_dist.get(b.id)
			if pb == null or not (pa < pb and a.race_dist > b.race_dist) or b.speed < C.slowCarMs:
				continue
			if t - _pit_exit_at.get(a.id, -1e9) < C.pitExitGraceMs or t - _pit_exit_at.get(b.id, -1e9) < C.pitExitGraceMs:
				continue
			var in_yellow := false
			for y in st.yellows:
				if TrackMath.wrap_delta(y[0], b.progress_s, L) >= 0.0 and TrackMath.wrap_delta(b.progress_s, y[1], L) >= 0.0:
					in_yellow = true
					break
			var reason := caution if caution != "" else ("overtake-yellow" if in_yellow else "")
			if reason != "" and penalise and not _has_pass(a.id, b.id):
				_passes.append({"by": a.id, "of": b.id, "at": t, "reason": reason})
		if sc_s != null:
			var d := TrackMath.wrap_delta(sc_s, a.progress_s, L)
			var pd = _prev_sc_delta.get(a.id)
			if pd != null and pd < 0.0 and pd > -60.0 and d >= 0.0 and d < 60.0 and penalise and not _has_pass(a.id, ""):
				_passes.append({"by": a.id, "of": "", "at": t, "reason": "passed-sc"})
			_prev_sc_delta[a.id] = d
		else:
			_prev_sc_delta.erase(a.id)
	for p in tracker.players.values():
		_prev_dist[p.id] = p.race_dist
	var kept: Array = []
	for x in _passes:
		var a: RaceTracker.PlayerRaceState = tracker.players.get(x.by)
		if a == null or a.dnf or a.finished_ms != null or a.in_pit:
			continue
		var back: bool
		if x.of == "":
			back = sc_s == null or TrackMath.wrap_delta(sc_s, a.progress_s, L) < 0.0
		else:
			var b: RaceTracker.PlayerRaceState = tracker.players.get(x.of)
			back = b == null or b.dnf or b.in_pit or a.race_dist < b.race_dist
		if back:
			continue
		if t - x.at < C.giveBackMs:
			kept.append(x)
			continue
		tracker.add_drive_through(x.by, x.reason, out)
	_passes = kept

func _has_pass(by: String, of: String) -> bool:
	for x in _passes:
		if x.by == by and x.of == of:
			return true
	return false
