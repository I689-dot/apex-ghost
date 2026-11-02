class_name RoadPatches
extends RefCounted
## Smoothed driving surfaces over stretches where the map's collision is rough (port of game/roadPatches.ts): the
## pit lane, and stretches of a layout listed in its "smoothRoad" ([fromS, toS] pairs). Per metre along the path and
## every 0.5 m across it: the ground's height with kerb ridges taken out by a median across and bumps by a median
## and moving average along. Wheel rays that land within the corridor, close enough to it, ride it instead.

const BIN := 0.5

class Patch:
	extends RefCounted
	var x: PackedFloat32Array
	var z: PackedFloat32Array
	var tx: PackedFloat32Array
	var tz: PackedFloat32Array
	## Distance from each station to the next (m).
	var seg: PackedFloat32Array
	## Smoothed height, station x lateral bin (0.5 m apart from -half), NAN where there is no ground.
	var h: PackedFloat32Array
	var bins: int
	var half: float
	## How far from the smoothed surface (m) a hit may be and still be put on it.
	var tol: float

var _patches: Array = []
## Corridor cells (1 m) -> patch index * 1e6 + station.
var _cells := {}

## ground: Callable(x, yTop, z, maxD) -> ground height under (x, z) from yTop down at most maxD, or null.
static func build(td: Dictionary, ground: Callable) -> RoadPatches:
	var r := RoadPatches.new()
	var lane = td.get("pitLane", null)
	if lane != null and lane.points.size() >= 4:
		r._add(td, ground, lane.points, 9.0, 4, 0.15, true)
	var cl: Array = td.centerline
	var n := cl.size() / 3
	for pair in td.get("smoothRoad", []):
		var from: float = pair[0]
		var to: float = pair[1]
		var pts: Array = []
		for i in n:
			if td.cumS[i] >= from - 15.0 and td.cumS[i] <= to + 15.0:
				pts.append([cl[i * 3], cl[i * 3 + 1], cl[i * 3 + 2]])
		if pts.size() >= 4:
			r._add(td, ground, pts, 7.0, 8, 1.1, false)
	return r

static func _median(v: Array) -> float:
	v.sort()
	return v[v.size() >> 1]

func _add(td: Dictionary, ground: Callable, pts: Array, half: float, smooth_m: int, tol: float, off_circuit: bool) -> void:
	# resample the path every metre
	var px := PackedFloat32Array()
	var py := PackedFloat32Array()
	var pz := PackedFloat32Array()
	for i in range(pts.size() - 1):
		var a: Array = pts[i]
		var b: Array = pts[i + 1]
		var l := Vector2(b[0] - a[0], b[2] - a[2]).length()
		var d := 0.0
		while d < l:
			var f := d / l
			px.append(a[0] + (b[0] - a[0]) * f)
			py.append(a[1] + (b[1] - a[1]) * f)
			pz.append(a[2] + (b[2] - a[2]) * f)
			d += 1.0
	var n := px.size()
	if n < 4:
		return
	var tx := PackedFloat32Array()
	var tz := PackedFloat32Array()
	tx.resize(n)
	tz.resize(n)
	for i in n:
		var a2 := maxi(0, i - 2)
		var b2 := mini(n - 1, i + 2)
		var l2 := Vector2(px[b2] - px[a2], pz[b2] - pz[a2]).length()
		if l2 == 0.0:
			l2 = 1.0
		tx[i] = (px[b2] - px[a2]) / l2
		tz[i] = (pz[b2] - pz[a2]) / l2
	var bins := roundi((half * 2.0) / BIN) + 1
	var raw := PackedFloat32Array()
	raw.resize(n * bins)
	for i in n:
		for j in bins:
			var lat := -half + j * BIN
			var g = ground.call(px[i] + tz[i] * lat, py[i] + 2.0, pz[i] - tx[i] * lat, 4.0)
			raw[i * bins + j] = NAN if g == null else g
	# across: a median over 2 m (kerb ridges, painted stripes and decals 1 m wide are gone, the fall stays)
	var across := PackedFloat32Array()
	across.resize(n * bins)
	var win: Array = []
	for i in n:
		for j in bins:
			var c := raw[i * bins + j]
			if is_nan(c):
				across[i * bins + j] = NAN
				continue
			win.clear()
			for k in range(maxi(0, j - 2), mini(bins - 1, j + 2) + 1):
				var v := raw[i * bins + k]
				if not is_nan(v) and absf(v - c) < tol:
					win.append(v)
			across[i * bins + j] = _median(win)
	# along: a median over 5 m (seams, short bumps), then a moving average over +-smooth_m
	var med := PackedFloat32Array()
	med.resize(n * bins)
	for j in bins:
		for i in n:
			var c2 := across[i * bins + j]
			if is_nan(c2):
				med[i * bins + j] = NAN
				continue
			win.clear()
			for k in range(maxi(0, i - 2), mini(n - 1, i + 2) + 1):
				var v2 := across[k * bins + j]
				if not is_nan(v2) and absf(v2 - c2) < tol:
					win.append(v2)
			med[i * bins + j] = _median(win)
	var h := PackedFloat32Array()
	h.resize(n * bins)
	for j in bins:
		for i in n:
			var c3 := med[i * bins + j]
			if is_nan(c3):
				h[i * bins + j] = NAN
				continue
			var total := 0.0
			var cnt := 0
			for k in range(maxi(0, i - smooth_m), mini(n - 1, i + smooth_m) + 1):
				var v3 := med[k * bins + j]
				if not is_nan(v3) and absf(v3 - c3) < tol:
					total += v3
					cnt += 1
			h[i * bins + j] = total / cnt
	var seg := PackedFloat32Array()
	seg.resize(n)
	for i in range(n - 1):
		var sl := Vector2(px[i + 1] - px[i], pz[i + 1] - pz[i]).length()
		seg[i] = sl if sl != 0.0 else 1.0
	seg[n - 1] = 1.0
	var pi := _patches.size()
	var hint := -1
	var cl: Array = td.centerline
	var m := cl.size() / 3
	for i in n:
		if off_circuit:
			hint = TrackMath.nearest_centerline_index(td, px[i], py[i], pz[i], hint)
		var lat2 := -half
		while lat2 <= half:
			var x := px[i] + tz[i] * lat2
			var z := pz[i] - tx[i] * lat2
			var key := int(floorf(x)) * 100003 + int(floorf(z))
			lat2 += 0.5
			if _cells.has(key):
				continue
			if off_circuit:
				# the pit lane's corridor stops short of the circuit's own surface
				var jj := TrackMath.nearest_centerline_index(td, x, py[i], z, hint, 30)
				var jx: float = cl[((jj + 1) % m) * 3] - cl[jj * 3]
				var jz: float = cl[((jj + 1) % m) * 3 + 2] - cl[jj * 3 + 2]
				var jl := Vector2(jx, jz).length()
				if jl == 0.0:
					jl = 1.0
				var side: float = ((x - cl[jj * 3]) * jz - (z - cl[jj * 3 + 2]) * jx) / jl
				if absf(side) < (td.widthL[jj] if side >= 0.0 else td.widthR[jj]) + 1.0:
					continue
			_cells[key] = pi * 1000000 + i
	var p := Patch.new()
	p.x = px
	p.z = pz
	p.tx = tx
	p.tz = tz
	p.seg = seg
	p.h = h
	p.bins = bins
	p.half = half
	p.tol = tol
	_patches.append(p)

## A ground hit inside a patch, close to its plane: moved onto the plane (the ray from o along d).
## hit: {dist, pos, normal, surface}; modified in place.
func apply(o: Vector3, d: Vector3, max_dist: float, hit: Dictionary) -> void:
	var hp: Vector3 = hit.pos
	var cell_v = _cells.get(int(floorf(hp.x)) * 100003 + int(floorf(hp.z)))
	if cell_v == null:
		return
	var p: Patch = _patches[int(cell_v / 1000000)]
	var i: int = int(cell_v) % 1000000
	var best := INF
	for k in range(maxi(0, i - 4), mini(p.x.size() - 1, i + 4) + 1):
		var dd := (hp.x - p.x[k]) * (hp.x - p.x[k]) + (hp.z - p.z[k]) * (hp.z - p.z[k])
		if dd < best:
			best = dd
			i = k
	var along := (hp.x - p.x[i]) * p.tx[i] + (hp.z - p.z[i]) * p.tz[i]
	if along < 0.0 and i > 0:
		i -= 1
		along += p.seg[i]
	var i1 := mini(p.x.size() - 1, i + 1)
	var f := 0.0 if i1 == i else clampf(along / p.seg[i], 0.0, 1.0)
	var lat := (hp.x - p.x[i]) * p.tz[i] - (hp.z - p.z[i]) * p.tx[i]
	var jf := (lat + p.half) / BIN
	var j := clampi(int(floorf(jf)), 0, p.bins - 2)
	var g := clampf(jf - j, 0.0, 1.0)
	var h00 := p.h[i * p.bins + j]
	var h01 := p.h[i * p.bins + j + 1]
	var h10 := p.h[i1 * p.bins + j]
	var h11 := p.h[i1 * p.bins + j + 1]
	if is_nan(h00 + h01 + h10 + h11):
		return
	var ys := (h00 * (1.0 - g) + h01 * g) * (1.0 - f) + (h10 * (1.0 - g) + h11 * g) * f
	var off := absf(ys - hp.y)
	if off >= p.tol:
		return
	# fade back to the real ground towards the tolerance: no step where the smoothing lets go
	var w := 1.0 if off < p.tol * 0.5 else 1.0 - (off - p.tol * 0.5) / (p.tol * 0.5)
	# the surface's gradient along the path and across it (lateral + = left of travel: (tz, -tx))
	var gs := ((h10 - h00) * (1.0 - g) + (h11 - h01) * g) / (1.0 if i1 == i else p.seg[i])
	var gl := ((h01 - h00) * (1.0 - f) + (h11 - h10) * f) / BIN
	var pn := Vector3(-gs * p.tx[i] - gl * p.tz[i], 1.0, -gs * p.tz[i] + gl * p.tx[i]).normalized()
	var denom := d.dot(pn)
	if denom > -1e-3:
		return
	var t := ((hp.x - o.x) * pn.x + (ys - o.y) * pn.y + (hp.z - o.z) * pn.z) / denom
	if t <= 0.0 or t >= max_dist:
		return
	var dist: float = hit.dist
	dist += (t - dist) * w
	hit.dist = dist
	hit.pos = o + d * dist
	var nrm: Vector3 = hit.normal
	hit.normal = (nrm + (pn - nrm) * w).normalized()
