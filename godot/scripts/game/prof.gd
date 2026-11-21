class_name Prof
extends RefCounted
## A tiny section profiler: Prof.b("name") … Prof.e("name"); a summary of microseconds a frame is printed every few
## seconds when APEX_PROF is set (the performance overlay shows the top entries when it is on).

static var on := OS.get_environment("APEX_PROF") != ""
## Recording at all: with APEX_PROF, or while the performance overlay shows the top entries (PerfOverlay sets it).
## Off, every call returns at once: they sit in each car's physics step, ~20,000 calls a second with a full grid.
static var active := on
## APEX_PROF_SPIKES=<ms>: every frame longer than that prints its own largest sections (what starts a slow patch).
static var spike_ms := float(OS.get_environment("APEX_PROF_SPIKES")) if OS.get_environment("APEX_PROF_SPIKES") != "" else 0.0
static var _cur := {}
static var _frame_us := 0
static var _t := {}
static var _acc := {}
static var _frames := 0
static var _last := 0
static var top := ""

static func b(label: String) -> void:
	if not active:
		return
	_t[label] = Time.get_ticks_usec()

static func e(label: String) -> void:
	if not active:
		return
	var d: int = Time.get_ticks_usec() - _t.get(label, 0)
	_acc[label] = _acc.get(label, 0) + d
	if spike_ms > 0.0:
		_cur[label] = _cur.get(label, 0) + d

static var _lap := 0

## Lap timer: Prof.start() then Prof.mark("section") after each section.
static func start() -> void:
	if not active:
		return
	_lap = Time.get_ticks_usec()

static func mark(label: String) -> void:
	if not active:
		return
	var n := Time.get_ticks_usec()
	_acc[label] = _acc.get(label, 0) + n - _lap
	if spike_ms > 0.0:
		_cur[label] = _cur.get(label, 0) + n - _lap
	_lap = n

## Once a frame: prints / stores the averages every 3 s.
static func frame() -> void:
	if not active:
		return
	if spike_ms > 0.0:
		var now_us := Time.get_ticks_usec()
		if _frame_us > 0 and now_us - _frame_us > spike_ms * 1000.0:
			var items: Array = []
			for k: String in _cur:
				if _cur[k] >= 500:
					items.append([k, _cur[k]])
			items.sort_custom(func(a: Array, b: Array) -> bool: return a[1] > b[1])
			print("SPIKE %.1f ms (physics steps %d): %s" % [(now_us - _frame_us) / 1000.0, _cur.get("#steps", 0), ", ".join(items.map(func(it: Array) -> String: return "%s %.1f" % [it[0], it[1] / 1000.0]))])
		_frame_us = now_us
		_cur.clear()
	_frames += 1
	var now := Time.get_ticks_msec()
	if now - _last < 3000:
		return
	_last = now
	var items: Array = []
	for k: String in _acc:
		items.append([k, _acc[k] / float(maxi(1, _frames))])
	items.sort_custom(func(a: Array, b: Array) -> bool: return a[1] > b[1])
	top = ""
	for i in mini(7, items.size()):
		top += "%s %.2f ms\n" % [items[i][0], items[i][1] / 1000.0]
	if on:
		print("PROF ", top.replace("\n", " | "))
	_acc.clear()
	_frames = 0
