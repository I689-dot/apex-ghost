class_name Prof
extends RefCounted
## A tiny section profiler: Prof.b("name") … Prof.e("name"); a summary of microseconds a frame is printed every few
## seconds when APEX_PROF is set (the performance overlay shows the top entries when it is on).

static var on := OS.get_environment("APEX_PROF") != ""
static var _t := {}
static var _acc := {}
static var _frames := 0
static var _last := 0
static var top := ""

static func b(label: String) -> void:
	_t[label] = Time.get_ticks_usec()

static func e(label: String) -> void:
	_acc[label] = _acc.get(label, 0) + Time.get_ticks_usec() - _t.get(label, 0)

static var _lap := 0

## Lap timer: Prof.start() then Prof.mark("section") after each section.
static func start() -> void:
	_lap = Time.get_ticks_usec()

static func mark(label: String) -> void:
	var n := Time.get_ticks_usec()
	_acc[label] = _acc.get(label, 0) + n - _lap
	_lap = n

## Once a frame: prints / stores the averages every 3 s.
static func frame() -> void:
	_frames += 1
	var now := Time.get_ticks_msec()
	if now - _last < 3000:
		return
	_last = now
	var items: Array = []
	for k in _acc:
		items.append([k, _acc[k] / float(maxi(1, _frames))])
	items.sort_custom(func(a, b): return a[1] > b[1])
	top = ""
	for i in mini(7, items.size()):
		top += "%s %.2f ms\n" % [items[i][0], items[i][1] / 1000.0]
	if on:
		print("PROF ", top.replace("\n", " | "))
	_acc.clear()
	_frames = 0
