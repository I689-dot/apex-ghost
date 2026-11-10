extends SceneTree
## Time trial rule: with cleanStreak the best lap is the fastest of consecutive clean laps (a clean lap counts only once the
## lap before it was clean too); without it every clean lap can be the best. Drives the centreline through RaceTracker.
##   tools/godot/gd.sh tests/time_trial_test.gd

var failures := 0

func check(cond: bool, what: String) -> void:
	print(("ok   " if cond else "FAIL ") + what)
	if not cond:
		failures += 1

## Lap events of a run: laps 1-3 at 50 m/s (the first is the out lap), a reset on the 4th, then 60 m/s.
func run(track: Dictionary, streak: bool) -> Array:
	var tr := RaceTracker.new(track, 0.0, {"sessionMs": 3_600_000, "cleanStreak": streak})
	tr.add_player("me")
	var laps: Array = []
	var s := 0.0
	var t := 100.0
	var lap_start_s := 0.0
	var reset_done := false
	while laps.size() < 6 and t < 2_000_000.0:
		t += 50.0
		s += (50.0 if laps.size() < 4 else 60.0) * 0.05
		var pt := TrackMath.point_at_distance(track, s)
		var reset := false
		if laps.size() == 3 and not reset_done and s - lap_start_s > track.length * 0.5:
			reset = true
			reset_done = true
		for e in tr.ingest("me", t, pt.x, pt.y, pt.z, reset):
			if e.type == "lap":
				laps.append(e)
				lap_start_s = s
	return laps

func _initialize() -> void:
	var track := TrackData.load_layout(TrackData.list_layouts()[0])
	var plain := run(track, false)
	var streak := run(track, true)
	print("plain : ", plain.map(func(l): return "%d v=%s b=%s p=%s" % [l.lap, l.valid, l.best, l.pending]))
	print("streak: ", streak.map(func(l): return "%d v=%s b=%s p=%s" % [l.lap, l.valid, l.best, l.pending]))
	check(plain.size() == 6 and streak.size() == 6, "six laps each")
	check(plain[0].outLap, "the first is the out lap")
	check(plain[1].best and not plain[1].pending, "plain: the first clean lap is the best")
	check(not plain[3].valid, "the lap with a reset is invalid")
	check(plain[4].valid and plain[4].best, "plain: the faster lap after it is the best at once")
	check(streak[1].valid and not streak[1].best and streak[1].pending, "streak: the first clean lap waits for a second")
	check(streak[2].best and not streak[2].pending, "streak: the second clean lap in a row counts")
	check(not streak[3].valid and not streak[3].pending, "streak: the lap with a reset is invalid")
	check(streak[4].valid and not streak[4].best and streak[4].pending, "streak: a faster lap straight after a bad one doesn't count yet")
	check(streak[5].best and not streak[5].pending, "streak: the next clean lap counts")
	print("failures: %d" % failures)
	quit(1 if failures > 0 else 0)
