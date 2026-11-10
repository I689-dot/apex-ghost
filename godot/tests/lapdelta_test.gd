extends SceneTree
## LapDelta: the best-lap reference, the optimal lap built from the best clean sectors, and the per-sector delta.
##   tools/godot/gd.sh tests/lapdelta_test.gd

var failures := 0

func check(name: String, ok: bool, detail: String = "") -> void:
	if ok:
		print("ok   ", name)
	else:
		failures += 1
		print("FAIL ", name, " ", detail)

## Drives a 3000 m lap (sectors at 1000 and 2000 m) with a time per sector, one sample every 5 m.
func drive(d: LapDelta, sector_ms: Array, clean: Array) -> void:
	d.start()
	var t := 0.0
	for s in 3:
		var from := s * 1000
		for m in range(from, from + 1000, 5):
			d.record(float(m), t + sector_ms[s] * (m - from) / 1000.0)
		t += sector_ms[s]
		d.end_sector(s, float((s + 1) * 1000), float(sector_ms[s]), clean[s])
	d.record(2999.0, t)

func _init() -> void:
	var d := LapDelta.new(3000.0)
	check("no reference at first", d.delta(500.0, 1000.0) == null and not d.has("optimal"))
	drive(d, [20000, 30000, 25000], [true, true, true])
	d.commit_best()
	check("best has a reference", d.has("best"))
	check("optimal built from the three sectors", d.has("optimal"))
	# second lap: faster 1st and 3rd sector, slower 2nd, and the 2nd with an incident
	drive(d, [19000, 33000, 24000], [true, false, true])
	check("a dirty sector is not taken", d._secs[1].ms == 30000.0, str(d._secs[1].ms))
	check("clean faster sectors are taken", d._secs[0].ms == 19000.0 and d._secs[2].ms == 24000.0)
	# third lap: drives the optimal lap exactly (19 + 30 + 24 = 73 s)
	d.start()
	var t := 0.0
	var times := [19000.0, 30000.0, 24000.0]
	for s in 3:
		var from := s * 1000
		for m in range(from, from + 1000, 5):
			var lap_ms: float = t + times[s] * (m - from) / 1000.0
			d.record(float(m), lap_ms)
			if m == 2500:
				var dv = d.delta(float(m), lap_ms, "optimal")
				check("on the optimal lap the delta is zero", dv != null and absf(dv) < 5.0, str(dv))
				var ds = d.delta(float(m), lap_ms, "sectors")
				check("on the optimal sectors the delta is zero", ds != null and absf(ds) < 5.0, str(ds))
		t += times[s]
		d.end_sector(s, float((s + 1) * 1000), times[s], true)
	# a late first sector shows in "sectors" mode as the same delta all through the next sector
	d.start()
	d.end_sector(0, 1000.0, 20000.0, false)
	var ds2 = d.delta(1500.0, 20000.0 + 15000.0, "sectors")
	check("the sector delta restarts at zero with the sector", ds2 != null and absf(ds2) < 20.0, str(ds2))
	print(failures, " failures")
	quit(1 if failures > 0 else 0)
