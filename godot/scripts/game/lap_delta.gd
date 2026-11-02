class_name LapDelta
extends RefCounted
## Live delta to your personal best lap (port of game/lapDelta.ts): the lap time recorded every few metres; the
## delta is the current lap time minus the best lap's time at the same distance, interpolated.

var _bin: float
var _cur: PackedFloat32Array
var _best: PackedFloat32Array = PackedFloat32Array()
var _has_best := false

func _init(track_length: float, bin_m: float = 5.0) -> void:
	_bin = bin_m
	_cur = PackedFloat32Array()
	_cur.resize(ceili(track_length / bin_m) + 2)
	_cur.fill(NAN)

## A new lap starts.
func start() -> void:
	_cur.fill(NAN)

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

## Current lap time minus the best lap's time at this distance (ms), or null without a reference.
func delta(lap_dist_m: float, lap_ms: float) -> Variant:
	if not _has_best:
		return null
	var x := lap_dist_m / _bin
	var i := int(floorf(x))
	if i < 0 or i + 1 >= _best.size():
		return null
	var a := _best[i]
	var b := _best[i + 1]
	if is_nan(a) or is_nan(b):
		return null
	return lap_ms - (a + (b - a) * (x - i))
