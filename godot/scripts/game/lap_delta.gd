class_name LapDelta
extends RefCounted
## Live delta to your personal best lap (port of game/lapDelta.ts): the lap time recorded every few metres; the
## delta is the current lap time minus the best lap's time at the same distance, interpolated.
## Also keeps the best clean run of each sector, so the delta can be measured against the optimal lap (the best sectors
## put together) or against the best sectors one by one, as iRacing's Tab key cycles (for this session).

const MODES := ["best", "optimal", "sectors"]

var _bin: float
var _cur: PackedFloat32Array
var _best: PackedFloat32Array = PackedFloat32Array()
var _has_best := false
## Best clean run of each sector: {ms, from (bin), rel (lap time since the sector's start at each bin)}.
var _secs: Array = [null, null, null]
var _optimal := PackedFloat32Array()
var _has_optimal := false
var _sector_from := 0
var _sector_start_ms := 0.0

func _init(track_length: float, bin_m: float = 5.0) -> void:
	_bin = bin_m
	_cur = PackedFloat32Array()
	_cur.resize(ceili(track_length / bin_m) + 2)
	_cur.fill(NAN)

## A new lap starts.
func start() -> void:
	_cur.fill(NAN)
	_sector_from = 0
	_sector_start_ms = 0.0

## A sector ended at lap_dist_m (the last one passes the track length). A clean run that beats the sector's best
## replaces it; the optimal lap is rebuilt once every sector has one.
func end_sector(index: int, lap_dist_m: float, ms: float, clean: bool) -> void:
	if index < 0 or index > 2:
		return
	var to := clampi(int(floorf(lap_dist_m / _bin)), _sector_from + 1, _cur.size() - 1)
	var from := _sector_from
	var start_ms := _sector_start_ms
	_sector_from = to
	_sector_start_ms = start_ms + ms
	var old = _secs[index]
	if not clean or (old != null and old.ms <= ms):
		return
	var rel := PackedFloat32Array()
	rel.resize(to - from + 1)
	for i in range(from, to + 1):
		rel[i - from] = _cur[i] - start_ms
	_secs[index] = {"ms": ms, "from": from, "rel": rel}
	_build_optimal()

func _build_optimal() -> void:
	for sec in _secs:
		if sec == null:
			return
	var out := PackedFloat32Array()
	out.resize(_cur.size())
	out.fill(NAN)
	var acc := 0.0
	for sec in _secs:
		for i in sec.rel.size():
			out[sec.from + i] = acc + sec.rel[i]
		acc += sec.ms
	_optimal = out
	_has_optimal = true

## True when the mode has something to compare with.
func has(mode: String) -> bool:
	return _has_best if mode == "best" else _has_optimal

func record(lap_dist_m: float, lap_ms: float) -> void:
	var b := int(floorf(lap_dist_m / _bin))
	if b < 0 or b >= _cur.size():
		return
	if is_nan(_cur[b]):
		_cur[b] = lap_ms

## The lap that just ended is the new reference. Call before start().
func commit_best() -> void:
	_best = _cur.duplicate()
	_has_best = true

func has_reference() -> bool:
	return _has_best

## Current lap time minus the reference's time at this distance (ms), or null without a reference. In "sectors" mode
## the delta restarts at zero with each sector.
func delta(lap_dist_m: float, lap_ms: float, mode: String = "best") -> Variant:
	var ref: PackedFloat32Array = _best if mode == "best" else _optimal
	if not has(mode):
		return null
	var here = _at(ref, lap_dist_m / _bin)
	if here == null:
		return null
	if mode != "sectors":
		return lap_ms - here
	var start = _at(ref, float(_sector_from))
	if start == null:
		return null
	return lap_ms - _sector_start_ms - (here - start)

## The reference lap's time at bin position x (interpolated), or null where it has no data.
func _at(ref: PackedFloat32Array, x: float) -> Variant:
	var i := int(floorf(x))
	if i < 0 or i + 1 >= ref.size():
		return null
	var a := ref[i]
	var b := ref[i + 1]
	if is_nan(a) or is_nan(b):
		return null
	return a + (b - a) * (x - i)
