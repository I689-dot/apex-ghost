class_name ClockSync
extends RefCounted
## NTP-style clock sync (port of packages/shared/src/clock.ts). Samples are {offset, rtt}.

static func make_sample(c0: float, s: float, c1: float) -> Dictionary:
	return {"offset": s - (c0 + c1) / 2.0, "rtt": maxf(0.0, c1 - c0)}

static func median(values: Array) -> float:
	if values.is_empty():
		return 0.0
	var a := values.duplicate()
	a.sort()
	var m := a.size() >> 1
	return a[m] if a.size() % 2 == 1 else (a[m - 1] + a[m]) / 2.0

static func estimate_offset(samples: Array) -> Dictionary:
	if samples.is_empty():
		return {"offset": 0.0, "rtt": 0.0}
	var sorted := samples.duplicate()
	sorted.sort_custom(func(a, b): return a.rtt < b.rtt)
	var best := sorted.slice(0, maxi(1, ceili(sorted.size() / 2.0)))
	return {"offset": median(best.map(func(s): return s.offset)), "rtt": median(best.map(func(s): return s.rtt))}
