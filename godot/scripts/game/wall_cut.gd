class_name WallCut
extends RefCounted
## Walls that cross the layout's own lap line are taken out of its collision (port of game/wallCut.ts).
## A wall triangle whose footprint from above crosses a centreline segment, within 4 m of the road's height there,
## is dropped. Returns the kept triangle indices (the same array when nothing is cut).

const CELL := 10.0

static func _cross(ax: float, az: float, bx: float, bz: float, cx: float, cz: float, dx: float, dz: float) -> bool:
	var d := (bx - ax) * (dz - cz) - (bz - az) * (dx - cx)
	if absf(d) < 1e-9:
		return false
	var t := ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / d
	var u := ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / d
	return t >= 0.0 and t <= 1.0 and u >= 0.0 and u <= 1.0

static func _key(x: float, z: float) -> int:
	return int(floorf(x / CELL)) * 100003 + int(floorf(z / CELL))

## centerline: flat array [x,y,z,...] of the layout. positions: PackedVector3Array. indices: PackedInt32Array.
static func cut(positions: PackedVector3Array, indices: PackedInt32Array, centerline: Array) -> PackedInt32Array:
	var n := centerline.size() / 3
	var grid := {}
	for i in n:
		var j := (i + 1) % n
		var xa := minf(centerline[i * 3], centerline[j * 3])
		var xb := maxf(centerline[i * 3], centerline[j * 3])
		var za := minf(centerline[i * 3 + 2], centerline[j * 3 + 2])
		var zb := maxf(centerline[i * 3 + 2], centerline[j * 3 + 2])
		for x in range(int(floorf(xa / CELL)), int(floorf(xb / CELL)) + 1):
			for z in range(int(floorf(za / CELL)), int(floorf(zb / CELL)) + 1):
				var k := x * 100003 + z
				if grid.has(k):
					grid[k].append(i)
				else:
					grid[k] = [i]
	var keep := PackedInt32Array()
	var cut_count := 0
	var t := 0
	while t < indices.size():
		var tri := [positions[indices[t]], positions[indices[t + 1]], positions[indices[t + 2]]]
		var hit := false
		var seen := {}
		for v in tri:
			var list = grid.get(_key(v.x, v.z))
			if list == null:
				continue
			for i in list:
				if seen.has(i):
					continue
				seen[i] = true
				var j: int = (i + 1) % n
				var y: float = centerline[i * 3 + 1]
				var ylo := minf(tri[0].y, minf(tri[1].y, tri[2].y))
				var yhi := maxf(tri[0].y, maxf(tri[1].y, tri[2].y))
				if yhi < y - 4.0 or ylo > y + 4.0:
					continue
				for e in 3:
					var p: Vector3 = tri[e]
					var q: Vector3 = tri[(e + 1) % 3]
					if _cross(p.x, p.z, q.x, q.z, centerline[i * 3], centerline[i * 3 + 2], centerline[j * 3], centerline[j * 3 + 2]):
						hit = true
						break
				if hit:
					break
			if hit:
				break
		if hit:
			cut_count += 1
		else:
			keep.append(indices[t])
			keep.append(indices[t + 1])
			keep.append(indices[t + 2])
		t += 3
	return keep if cut_count > 0 else indices
