class_name RaceTracker
extends RefCounted
## Server-authoritative session logic (port of packages/shared/src/race.ts): lap and sector timing from position
## samples, track limits, cuts, resets, pit stops, drive-throughs, standings. Events are Dictionaries with a "type".
## Nullable numbers of the TS code are untyped Variants here (null = absent).

## Track limits and cutting, after the real rules (see race.ts).
const PENALTY := {
	"limitsWarnings": 3, "limitsPenaltyMs": 5000, "accidentSlowdown": 0.5, "lineAllowance": 0.1, "cutSavedM": 6.0,
	"cutGainMs": 400.0, "cutMs": 5000, "cutBigMs": 10000, "cutBigGainMs": 2000.0, "resetMs": 5000, "shortcutBigM": 60.0,
	"maxSkipM": 300.0, "serveLaps": 3, "unservedExtraMs": 10000, "missedStopMs": 90000, "driveThroughMaxStopMs": 1500,
	"contactGraceMs": 12000.0,
}

## The mandatory stop of the pit-window rule (GT World Challenge Sprint).
const PIT_WINDOW := {
	"openShare": 0.4, "closeShare": 0.6, "timedOpenShare": 25.0 / 60.0, "timedCloseShare": 35.0 / 60.0,
	"minStopMs": 20000, "toleranceMs": 1500,
}

class PlayerRaceState:
	extends RefCounted
	var id: String
	var laps := 0
	var lap_penalty_ms := 0
	var off_since = null
	var off_last := 0.0
	var off_speed0 := 0.0
	var off_min_speed := 0.0
	var off_dist0 := 0.0
	var off_path := 0.0
	var off_skipped := false
	var off_carried := false
	var lap_invalid := false
	var limit_warnings := 0
	var hit_at := -1e12
	var rolling := false
	var speed := 0.0
	var speed_smooth := 0.0
	var out_lap := true
	var in_pit := false
	var pit_stops := 0
	var pit_lap := 0
	var pit_in_ms := 0.0
	var stopped_ms := 0.0
	var stop_done := false
	var drive_throughs: Array = []
	var serving_dt := false
	var valid_laps := 0
	var next_gate := 0
	var passed := 0
	var lap_start_ms := 0.0
	var sector_start_ms := 0.0
	var sectors: Array = []
	var last_lap_ms = null
	var best_lap_ms = null
	var best_sectors: Array = []
	var finished_ms = null
	var dnf := false
	var penalty_ms := 0
	var resets := 0
	var suspicious := 0
	var has_pos := false
	var lx := 0.0
	var ly := 0.0
	var lz := 0.0
	var lt := 0.0
	var cl_index := -1
	var progress_s := 0.0
	var race_dist := -1e6

var track: Dictionary
var start_ms: float
var players := {} # id -> PlayerRaceState (insertion ordered)
## Lap-count mode: timed laps after the out lap (0 = timed session).
var laps := 0
## Timed session: when the chequered flag falls (server clock), or null.
var flag_at = null
var first_finish_ms = null
var flag_shown := false
var is_race := false
var pit_window = null # {open, close} in laps
var race_end_at = null
var pit_window_ms = null # {open, close} in ms
var drive_through_ms: int

static func pit_window_laps(n: int) -> Dictionary:
	var open := maxi(1, int(floorf(n * PIT_WINDOW.openShare)))
	return {"open": open, "close": maxi(open, mini(n - 1, ceili(n * PIT_WINDOW.closeShare)))}

## After the winner of a lap-count race finishes, the others finish the lap they are on.
static func finish_grace_ms(winner_ms: float, n_laps: int) -> float:
	return maxf(Const.FINISH_TIMEOUT_MS, (winner_ms / n_laps) * 1.3 if n_laps > 0 else 0.0)

## Time a drive-through costs (ms).
static func drive_through_cost_ms(t: Dictionary) -> int:
	var lane: float = t.get("pitLaneM", 0.0) if t.get("pitLaneM", null) != null else 0.0
	if lane <= 0.0:
		return 30000
	var s := lane / (60.0 / 3.6) - lane / 50.0 + 2.0
	return int(roundf(minf(45.0, maxf(15.0, s)))) * 1000

## mode: an int (lap-count test mode), {sessionMs}, {raceLaps, pitWindow?} or {raceMs, pitWindow?}.
func _init(track_data: Dictionary, start: float, mode: Variant = Const.RACE_LAPS) -> void:
	track = track_data
	start_ms = start
	drive_through_ms = drive_through_cost_ms(track)
	if typeof(mode) == TYPE_INT or typeof(mode) == TYPE_FLOAT:
		laps = int(mode)
	elif mode.has("raceMs"):
		laps = 0
		is_race = true
		race_end_at = start + mode.raceMs
		if mode.get("pitWindow", false) and mode.raceMs >= 6 * 60000:
			pit_window_ms = {"open": start + mode.raceMs * PIT_WINDOW.timedOpenShare, "close": start + mode.raceMs * PIT_WINDOW.timedCloseShare}
	elif mode.has("raceLaps"):
		laps = int(mode.raceLaps)
		is_race = true
		if mode.get("pitWindow", false) and mode.raceLaps >= 2:
			pit_window = pit_window_laps(int(mode.raceLaps))
	else:
		laps = 0
		flag_at = start + mode.sessionMs

## The car enters the pit lane: the lap in progress is lost, gates are ignored inside the lane.
func pit_in(id: String, t: float, out: Array = []) -> Array:
	var p: PlayerRaceState = players.get(id)
	if p == null or p.dnf or p.finished_ms != null or p.in_pit:
		return out
	if not _near(p, track.get("pitEntryS", null), -60.0, 450.0):
		return out
	p.in_pit = true
	p.rolling = false
	p.pit_stops += 1
	p.pit_lap = p.laps + 1
	p.pit_in_ms = t
	p.stopped_ms = 0.0
	p.serving_dt = is_race and p.drive_throughs.size() > 0
	if not is_race:
		p.out_lap = true
		p.lap_penalty_ms = 0
		p.lap_invalid = false
	p.off_since = null
	p.sectors = []
	if flag_at != null and t >= flag_at:
		_finish(p, t, out)
	return out

## The car leaves the pit lane at lap distance exit_s: the out lap continues from the next gate. t < 0: no time.
func pit_out(id: String, exit_s: float, t: float = -1.0, out: Array = []) -> void:
	var p: PlayerRaceState = players.get(id)
	if p == null or not p.in_pit:
		return
	if not _near(p, exit_s, -450.0, 60.0):
		p.in_pit = false
		p.serving_dt = false
		return
	var gates: Array = track.gates
	var gi := -1
	for i in range(1, gates.size()):
		if gates[i].s > exit_s + 5.0:
			gi = i
			break
	if gi < 0:
		gi = 0
	p.in_pit = false
	p.next_gate = gi
	p.passed = gates.size() - 1 if gi == 0 else gi - 1
	p.has_pos = false
	if p.serving_dt and p.stopped_ms < PENALTY.driveThroughMaxStopMs:
		p.drive_throughs.pop_front()
		out.append({"type": "served", "playerId": p.id, "what": "drive-through"})
	p.serving_dt = false
	var in_window := false
	if pit_window != null:
		in_window = p.pit_lap >= pit_window.open and p.pit_lap <= pit_window.close
	elif pit_window_ms != null:
		in_window = p.pit_in_ms >= pit_window_ms.open and p.pit_in_ms < pit_window_ms.close
	if in_window and not p.stop_done and p.stopped_ms >= PIT_WINDOW.minStopMs - PIT_WINDOW.toleranceMs:
		p.stop_done = true
		out.append({"type": "served", "playerId": p.id, "what": "stop"})
	# the race: the pit lane runs past the line, so the lap of the stop ends here
	if is_race and t >= 0.0 and p.finished_ms == null:
		var lap_ms := t - p.lap_start_ms
		p.laps += 1
		p.last_lap_ms = lap_ms + p.lap_penalty_ms
		out.append({"type": "lap", "playerId": p.id, "lap": p.laps, "lapMs": p.last_lap_ms, "penaltyMs": p.lap_penalty_ms, "sectors": [], "best": false, "valid": true, "outLap": false})
		p.lap_start_ms = t
		p.sector_start_ms = t
		p.sectors = []
		p.lap_penalty_ms = 0
		p.lap_invalid = false
		if _race_done(p, t):
			_finish(p, t, out)

func _race_done(p: PlayerRaceState, t: float) -> bool:
	if first_finish_ms != null and t >= first_finish_ms:
		return true
	if race_end_at == null:
		return p.laps >= laps
	if t < race_end_at:
		return false
	for o in players.values():
		if o != p and not o.dnf and o.finished_ms == null and o.race_dist > p.race_dist + 1.0:
			return false
	return true

## The car's last known lap distance is from `before` to `after` metres around s (true without s or a position).
func _near(p: PlayerRaceState, s, before: float, after: float) -> bool:
	if s == null or not p.has_pos:
		return true
	var d := TrackMath.wrap_delta(s, p.progress_s, track.length)
	return d >= before and d <= after

func _finish(p: PlayerRaceState, t: float, out: Array) -> void:
	if p.finished_ms != null:
		return
	p.finished_ms = t - start_ms
	if is_race:
		for d in p.drive_throughs:
			_add_penalty(p, d.reason, drive_through_ms, out)
		p.drive_throughs = []
		if pit_window != null and not p.stop_done:
			_add_penalty(p, "missed-stop", PENALTY.missedStopMs, out)
	if first_finish_ms == null:
		first_finish_ms = t
	out.append({"type": "finish", "playerId": p.id, "totalMs": p.finished_ms})

## Call regularly with the server time: shows the chequered flag once, and finishes cars in the garage when it falls.
func check_flag(t: float, out: Array = []) -> Array:
	if flag_at == null or t < flag_at:
		return out
	if not flag_shown:
		flag_shown = true
		out.append({"type": "flag"})
	for p in players.values():
		if p.in_pit and not p.dnf:
			_finish(p, t, out)
	return out

func add_player(id: String) -> PlayerRaceState:
	var g: int = track.firstGate
	var p := PlayerRaceState.new()
	p.id = id
	p.next_gate = g
	p.passed = -1 if g == 0 else g - 1
	p.lap_start_ms = start_ms
	p.sector_start_ms = start_ms
	if is_race:
		p.out_lap = false
	players[id] = p
	return p

func mark_dnf(id: String) -> void:
	var p: PlayerRaceState = players.get(id)
	if p != null and p.finished_ms == null:
		p.dnf = true

## Feed one position sample. reset = the client teleported back to its last checkpoint; off_track = all four wheels
## beyond the track limits in this sample. Returns the events (laps, sectors, finish).
func ingest(id: String, t: float, x: float, y: float, z: float, reset: bool, out: Array = [], off_track: bool = false, hit: bool = false) -> Array:
	var p: PlayerRaceState = players.get(id)
	if p == null or p.dnf or p.finished_ms != null:
		return out
	if t < start_ms - 10000.0:
		return out
	if hit:
		p.hit_at = maxf(p.hit_at, t)
	if p.has_pos and t > p.lt:
		p.speed = Vector2(x - p.lx, z - p.lz).length() / ((t - p.lt) / 1000.0)
		if not reset and p.speed < 120.0:
			p.speed_smooth += (p.speed - p.speed_smooth) * minf(1.0, (t - p.lt) / 500.0)
		if p.in_pit and p.speed < 1.0:
			p.stopped_ms += t - p.lt
		if not p.in_pit and not reset and t >= start_ms and p.speed > 15.0 and p.speed < 120.0:
			p.rolling = true
	if t >= start_ms and not p.in_pit:
		if off_track and not reset:
			if p.off_since == null:
				p.off_since = t
				p.off_speed0 = p.speed_smooth
				p.off_min_speed = p.speed_smooth
				p.off_dist0 = p.race_dist
				p.off_path = 0.0
				p.off_skipped = false
				p.off_carried = false
			elif p.has_pos:
				p.off_path += Vector2(x - p.lx, z - p.lz).length()
			p.off_last = t
			p.off_min_speed = minf(p.off_min_speed, p.speed_smooth)
		elif p.off_since != null:
			if reset:
				p.off_since = null
			else:
				_close_excursion(p, out)
	var tr := track
	var gates: Array = tr.gates
	var n := gates.size()

	if not p.has_pos or p.in_pit:
		_place(p, t, x, y, z, not p.has_pos)
		return out
	var dt := (t - p.lt) / 1000.0
	if dt <= 0.0:
		return out
	var dx := x - p.lx
	var dy := y - p.ly
	var dz := z - p.lz
	var dist := sqrt(dx * dx + dy * dy + dz * dz)

	if reset:
		var last: Dictionary = gates[posmod(p.next_gate - 1 + n, n)]
		var ex: float = x - last.p[0]
		var ez: float = z - last.p[2]
		if p.passed >= 0 and ex * ex + ez * ez > 40.0 * 40.0 and dist > 5.0:
			p.suspicious += 1
			out.append({"type": "rejected", "playerId": id, "reason": "reset-far-from-checkpoint"})
		p.resets += 1
		p.off_since = null
		if t >= start_ms and not p.out_lap:
			if _was_hit(p, t):
				out.append({"type": "penalty", "playerId": id, "reason": "reset", "ms": 0, "lapPenaltyMs": p.lap_penalty_ms, "contact": true})
			elif not is_race:
				_invalidate(p, "reset", out)
			else:
				_add_penalty(p, "reset", PENALTY.resetMs, out)
		_place(p, t, x, y, z, true)
		return out

	if dist / maxf(dt, 0.02) > Const.MAX_PLAUSIBLE_SPEED_MS and dist > 8.0:
		p.suspicious += 1
		out.append({"type": "rejected", "playerId": id, "reason": "implausible-speed"})
		_place(p, t, x, y, z, true)
		return out

	# Cross as many gates as the segment covers (packet loss can skip several samples).
	var s_new = null
	var a := Vector3(p.lx, p.ly, p.lz)
	var at := p.lt
	for guard in n:
		var gi := p.next_gate
		var f := TrackMath.crosses_gate(gates[gi], a, Vector3(x, y, z))
		if f < 0.0:
			if s_new == null:
				s_new = TrackMath.progress_at(tr, TrackMath.nearest_centerline_index(tr, x, y, z, p.cl_index), x, z)
			var k := 1
			while k < n and f < 0.0:
				var cand := (p.next_gate + k) % n
				var ahead := TrackMath.wrap_delta(gates[p.next_gate].s, gates[cand].s, tr.length)
				if ahead > PENALTY.maxSkipM or ahead < 0.0:
					break
				var off := TrackMath.wrap_delta(gates[cand].s, s_new, tr.length)
				if off < -15.0 or off > 60.0:
					k += 1
					continue
				var fc := TrackMath.crosses_gate(gates[cand], a, Vector3(x, y, z))
				if fc >= 0.0:
					gi = cand
					f = fc
				k += 1
			if f < 0.0:
				break
		var g: Dictionary = gates[gi]
		var tc := at + (t - at) * f
		if gi != p.next_gate:
			var skipped := TrackMath.wrap_delta(gates[p.next_gate].s, g.s, tr.length)
			var counts := not p.out_lap and p.passed >= 0
			var kk := p.next_gate
			while kk != gi:
				_on_gate(p, kk, tc, out)
				kk = (kk + 1) % n
			if p.off_since != null:
				p.off_skipped = true
			if counts and _was_hit(p, tc):
				out.append({"type": "penalty", "playerId": p.id, "reason": "shortcut", "ms": 0, "lapPenaltyMs": p.lap_penalty_ms, "contact": true})
			elif counts and not is_race:
				_invalidate(p, "shortcut", out)
			elif counts:
				p.lap_invalid = true
				_add_penalty(p, "shortcut", PENALTY.cutBigMs if skipped > PENALTY.shortcutBigM else PENALTY.cutMs, out)
		_on_gate(p, gi, tc, out)
		if p.finished_ms != null:
			break
		a = a + (Vector3(x, y, z) - a) * f
		at = tc
		a.x += g.d[0] * 1e-3
		a.z += g.d[2] * 1e-3
	_place(p, t, x, y, z, false)
	return out

func _on_gate(p: PlayerRaceState, gi: int, tc: float, out: Array) -> void:
	var tr := track
	var n: int = tr.gates.size()
	if gi == 0:
		if p.passed == n - 1:
			# lap complete
			var lap_ms := tc - p.lap_start_ms
			var s3 := tc - p.sector_start_ms
			p.sectors.append(s3)
			out.append({"type": "sector", "playerId": p.id, "sector": 2, "ms": s3})
			if lap_ms < tr.minLapMs:
				p.suspicious += 1
				out.append({"type": "rejected", "playerId": p.id, "reason": "lap-too-fast"})
			var out_lap := p.out_lap
			if p.off_since != null:
				if not is_race:
					_invalidate(p, "track-limits", out)
				p.off_carried = true
			var penalty_ms := 0 if out_lap else p.lap_penalty_ms
			var timed := lap_ms + penalty_ms
			var valid: bool = not out_lap and lap_ms >= tr.minLapMs and not p.lap_invalid
			var best: bool = valid and (p.best_lap_ms == null or timed < p.best_lap_ms)
			if best:
				p.best_lap_ms = timed
				p.best_sectors = p.sectors.duplicate()
			if valid:
				p.valid_laps += 1
			p.last_lap_ms = lap_ms if out_lap else timed
			p.laps += 1
			out.append({"type": "lap", "playerId": p.id, "lap": p.laps, "lapMs": timed, "penaltyMs": penalty_ms, "sectors": p.sectors.duplicate(), "best": best, "valid": valid, "outLap": out_lap})
			p.lap_start_ms = tc
			p.sector_start_ms = tc
			p.sectors = []
			p.passed = 0
			p.lap_penalty_ms = 0
			p.lap_invalid = false
			p.out_lap = false
			while p.drive_throughs.size() > 0 and p.laps - p.drive_throughs[0].lap >= PENALTY.serveLaps:
				p.drive_throughs.pop_front()
				_add_penalty(p, "unserved", drive_through_ms + PENALTY.unservedExtraMs, out)
			var laps_done: bool = _race_done(p, tc) if is_race else (laps > 0 and p.laps >= laps + 1)
			var flagged: bool = flag_at != null and tc >= flag_at
			if laps_done or flagged:
				_finish(p, tc, out)
		else:
			# first crossing after the grid or the pit exit: the out lap ends here and the timed lap starts
			p.passed = 0
			if p.out_lap and p.laps > 0:
				p.out_lap = false
				p.lap_penalty_ms = 0
				p.lap_invalid = false
				p.off_since = null
				p.lap_start_ms = tc
				p.sector_start_ms = tc
				p.sectors = []
				if flag_at != null and tc >= flag_at:
					_finish(p, tc, out)
	else:
		p.passed += 1
		var si := 0 if gi == tr.sectorGates[0] else (1 if gi == tr.sectorGates[1] else -1)
		if si >= 0 and p.passed >= 0:
			var ms := tc - p.sector_start_ms
			if p.sectors.size() <= si:
				p.sectors.resize(si + 1)
			p.sectors[si] = ms
			p.sector_start_ms = tc
			out.append({"type": "sector", "playerId": p.id, "sector": si, "ms": ms})
	p.next_gate = (gi + 1) % n

func _was_hit(p: PlayerRaceState, t: float) -> bool:
	return t - p.hit_at < PENALTY.contactGraceMs

func _add_penalty(p: PlayerRaceState, reason: String, ms: int, out: Array, extra: Dictionary = {}) -> void:
	if p.out_lap or ms <= 0:
		return
	p.lap_penalty_ms += ms
	p.penalty_ms += ms
	var ev := {"type": "penalty", "playerId": p.id, "reason": reason, "ms": ms, "lapPenaltyMs": p.lap_penalty_ms}
	ev.merge(extra)
	out.append(ev)

## Race control's drive-through (the race only).
func add_drive_through(id: String, reason: String, out: Array = []) -> Array:
	var p: PlayerRaceState = players.get(id)
	if not is_race or p == null or p.dnf or p.finished_ms != null:
		return out
	var laps_left: float
	if race_end_at != null:
		laps_left = (race_end_at - p.lt) / maxf(60000.0, p.last_lap_ms if p.last_lap_ms != null else 120000.0)
	else:
		laps_left = laps - p.laps
	if laps_left <= PENALTY.serveLaps:
		_add_penalty(p, reason, drive_through_ms, out)
		return out
	p.drive_throughs.append({"reason": reason, "lap": p.laps})
	out.append({"type": "penalty", "playerId": p.id, "reason": reason, "ms": 0, "lapPenaltyMs": p.lap_penalty_ms, "driveThrough": true})
	return out

## End of a track-limits excursion.
func _close_excursion(p: PlayerRaceState, out: Array) -> void:
	if p.off_since == null:
		return
	var since: float = p.off_since
	var dur := maxf(0.05, (p.off_last - since) / 1000.0)
	p.off_since = null
	if p.out_lap:
		return
	var base := {"type": "penalty", "playerId": p.id, "reason": "track-limits", "ms": 0, "lapPenaltyMs": p.lap_penalty_ms}
	if p.hit_at >= since - PENALTY.contactGraceMs and p.hit_at <= p.off_last:
		var ev := base.duplicate()
		ev.contact = true
		out.append(ev)
		return
	if p.off_skipped:
		return
	var covered := maxf(0.0, p.race_dist - p.off_dist0) * (1.0 - PENALTY.lineAllowance)
	var saved_m := covered - p.off_path
	var v_off := p.off_path / dur
	var gain_ms := maxf(
		(saved_m / v_off) * 1000.0 if saved_m > 0.0 and v_off > 1.0 else 0.0,
		(covered / p.off_speed0 - dur) * 1000.0 if p.off_speed0 > 5.0 else 0.0)
	var cut: bool = saved_m > PENALTY.cutSavedM or gain_ms > PENALTY.cutGainMs
	if not is_race:
		if not p.off_carried or cut:
			_invalidate(p, "track-limits", out, int(roundf(maxf(0.0, gain_ms))) if cut else 0)
		return
	if cut:
		var g := int(roundf(maxf(0.0, gain_ms)))
		p.lap_invalid = true
		_add_penalty(p, "track-limits", PENALTY.cutBigMs if g > PENALTY.cutBigGainMs else PENALTY.cutMs, out, {"gainMs": g})
		return
	if p.off_speed0 > 5.0 and p.off_min_speed < p.off_speed0 * (1.0 - PENALTY.accidentSlowdown):
		var ev2 := base.duplicate()
		ev2.noAdvantage = true
		out.append(ev2)
		return
	if p.limit_warnings < PENALTY.limitsWarnings:
		p.limit_warnings += 1
		var ev3 := base.duplicate()
		ev3.warning = p.limit_warnings
		if p.limit_warnings == PENALTY.limitsWarnings:
			ev3.blackWhite = true
		out.append(ev3)
		return
	_add_penalty(p, "track-limits", PENALTY.limitsPenaltyMs, out)

## Practice / qualifying: the lap in progress no longer counts (announced once per lap).
func _invalidate(p: PlayerRaceState, reason: String, out: Array, gain_ms: int = 0) -> void:
	if p.out_lap or p.passed < 0:
		return
	var first := not p.lap_invalid
	p.lap_invalid = true
	if first:
		var ev := {"type": "penalty", "playerId": p.id, "reason": reason, "ms": 0, "lapPenaltyMs": p.lap_penalty_ms, "invalidated": true}
		if gain_ms != 0:
			ev.gainMs = gain_ms
		out.append(ev)

func _place(p: PlayerRaceState, t: float, x: float, y: float, z: float, full_search: bool) -> void:
	p.has_pos = true
	p.lx = x
	p.ly = y
	p.lz = z
	p.lt = t
	p.cl_index = TrackMath.nearest_centerline_index(track, x, y, z, -1 if full_search else p.cl_index)
	p.progress_s = TrackMath.progress_at(track, p.cl_index, x, z)
	p.race_dist = race_distance(p)

## Total distance covered: laps * length + distance into the current lap, gate-anchored.
func race_distance(p: PlayerRaceState) -> float:
	var L: float = track.length
	var gates: Array = track.gates
	var n := gates.size()
	if p.passed < 0:
		var d := TrackMath.wrap_delta(0.0, p.progress_s, L)
		return minf(0.0, d)
	var last_gi := posmod(p.next_gate - 1 + n, n)
	var last_s: float = 0.0 if last_gi == 0 else gates[last_gi].s
	var next_s: float = L if p.next_gate == 0 else gates[p.next_gate].s
	var into := TrackMath.wrap_delta(last_s, p.progress_s, L)
	if into < -80.0:
		into = -80.0
	if into > next_s - last_s + 20.0:
		into = next_s - last_s + 20.0
	return p.laps * L + last_s + into

## Official order: qualifying by best valid lap; the race by finish time + penalties, then distance.
func standings() -> Array:
	var list: Array = players.values()
	# stable sort (GDScript's sort_custom is not): decorate with the join order
	var ordered: Array = []
	for i in list.size():
		ordered.append([i, list[i]])
	if is_race:
		ordered.sort_custom(func(A, B):
			var a: PlayerRaceState = A[1]
			var b: PlayerRaceState = B[1]
			if a.dnf != b.dnf:
				return not a.dnf
			var af: bool = a.finished_ms != null
			var bf: bool = b.finished_ms != null
			if af and bf:
				var c: int = (b.laps - a.laps)
				if c != 0:
					return c < 0
				var d: float = (a.finished_ms + a.penalty_ms) - (b.finished_ms + b.penalty_ms)
				return d < 0.0 if d != 0.0 else A[0] < B[0]
			if af != bf:
				return af
			if b.race_dist != a.race_dist:
				return a.race_dist > b.race_dist
			return A[0] < B[0])
	else:
		ordered.sort_custom(func(A, B):
			var a: PlayerRaceState = A[1]
			var b: PlayerRaceState = B[1]
			var at: bool = a.best_lap_ms != null
			var bt: bool = b.best_lap_ms != null
			if at and bt:
				return a.best_lap_ms < b.best_lap_ms if a.best_lap_ms != b.best_lap_ms else A[0] < B[0]
			if at != bt:
				return at
			if a.dnf != b.dnf:
				return not a.dnf
			if flag_at == null and b.race_dist != a.race_dist:
				return a.race_dist > b.race_dist
			return A[0] < B[0])
	var leader: PlayerRaceState = ordered[0][1] if ordered.size() > 0 else null
	var result: Array = []
	for i in ordered.size():
		var p: PlayerRaceState = ordered[i][1]
		var gap = null
		if is_race:
			gap = _race_gap(leader, p)
		elif leader != null and leader.best_lap_ms != null and p.best_lap_ms != null:
			gap = p.best_lap_ms - leader.best_lap_ms
		result.append({
			"id": p.id, "position": i + 1, "laps": p.laps, "raceDist": p.race_dist, "lastLapMs": p.last_lap_ms,
			"bestLapMs": p.best_lap_ms, "finishedMs": p.finished_ms, "dnf": p.dnf, "penaltyMs": p.penalty_ms, "gapMs": gap,
			"validLaps": p.valid_laps, "lapPenaltyMs": p.lap_penalty_ms, "inPit": p.in_pit, "outLap": p.out_lap,
			"bestSectors": p.best_sectors.duplicate(), "driveThroughs": p.drive_throughs.size(), "stopDone": p.stop_done,
		})
	return result

## Race gap to the leader (ms), or null.
func _race_gap(leader: PlayerRaceState, p: PlayerRaceState) -> Variant:
	if leader == null or p == leader or p.dnf:
		return 0 if p == leader else null
	if leader.finished_ms != null and p.finished_ms != null:
		return p.finished_ms + p.penalty_ms - (leader.finished_ms + leader.penalty_ms)
	var elapsed := maxf(1.0, (leader.lt - start_ms) / 1000.0)
	var speed := maxf(10.0, leader.race_dist / elapsed)
	return maxf(0.0, ((leader.race_dist - p.race_dist) / speed) * 1000.0) + p.penalty_ms - leader.penalty_ms

func all_done() -> bool:
	for p in players.values():
		if not p.dnf and p.finished_ms == null:
			return false
	return true
