class_name Atmosphere
extends RefCounted
## CPU twin of the sky model (port of the TypeScript half of game/atmosphere.ts; the GPU half is
## shaders/atmosphere.gdshaderinc): the sun's colour, the sky ambient and the horizon colours the fog fades into, so
## lighting, fog and sky always agree (blue noon, orange sunset, blue hour).

const R_E := 6360e3
const R_A := 6420e3
const H_R := 8000.0
const H_M := 1200.0
const BETA_R := [5.802e-6, 13.558e-6, 33.1e-6]
const BETA_M := 3.996e-6
const BETA_O := [0.65e-6, 1.881e-6, 0.085e-6]
const SUN_E := 20.0
const SKY_EXPOSURE := 1.25
## Viewer altitude (m): the Eifel sits ~600 m up.
const VIEW_H := 600.0

static func _ray_sphere(o: Vector3, d: Vector3, r: float) -> Vector2:
	var b := o.dot(d)
	var c := o.dot(o) - r * r
	var h := b * b - c
	if h < 0.0:
		return Vector2(-1, -1)
	h = sqrt(h)
	return Vector2(-b - h, -b + h)

static func _density(h: float) -> Vector3:
	return Vector3(exp(-h / H_R), exp(-h / H_M), maxf(0.0, 1.0 - absf(h - 25000.0) / 15000.0))

static func _extinction(od: Vector3, haze: float) -> Vector3:
	return Vector3(
		BETA_R[0] * od.x + BETA_M * 1.11 * haze * od.y + BETA_O[0] * od.z,
		BETA_R[1] * od.x + BETA_M * 1.11 * haze * od.y + BETA_O[1] * od.z,
		BETA_R[2] * od.x + BETA_M * 1.11 * haze * od.y + BETA_O[2] * od.z)

## Colour of the sunlight reaching the viewer (0..1 per channel) for a sun in direction dir.
static func sun_transmittance(dir: Vector3, haze: float) -> Color:
	var o := Vector3(0, R_E + VIEW_H, 0)
	var d := Vector3(dir.x, maxf(dir.y, -0.02), dir.z).normalized()
	var ta := _ray_sphere(o, d, R_A).y
	var steps := 24
	var od := Vector3.ZERO
	for i in steps:
		var u := (i + 0.5) / steps
		var ds := (2.0 * u * ta) / steps
		var p := o + d * (u * u * ta)
		od += _density(p.length() - R_E) * ds
	if _ray_sphere(o, d, R_E).x > 0.0:
		return Color(0, 0, 0)
	var tau := _extinction(od, haze)
	return Color(exp(-tau.x), exp(-tau.y), exp(-tau.z))

## Sky radiance (x SKY_EXPOSURE) seen in direction dir with the sun in sun.
static func sky_radiance(dir: Vector3, sun: Vector3, haze: float) -> Color:
	var o := Vector3(0, R_E + VIEW_H, 0)
	var ta := _ray_sphere(o, dir, R_A).y
	var tg := _ray_sphere(o, dir, R_E).x
	var length_m := tg if tg > 0.0 else ta
	var n := 16
	var mu := dir.dot(sun)
	var pr := (3.0 / (16.0 * PI)) * (1.0 + mu * mu)
	var g := 0.76
	var g2 := g * g
	var pm := ((3.0 / (8.0 * PI)) * ((1.0 - g2) * (1.0 + mu * mu))) / ((2.0 + g2) * pow(maxf(1e-4, 1.0 + g2 - 2.0 * g * mu), 1.5))
	var odv := Vector3.ZERO
	var sr := Vector3.ZERO
	var sm := Vector3.ZERO
	for i in n:
		var u := (i + 0.5) / n
		var ds := (2.0 * u * length_m) / n
		var p := o + dir * (u * u * length_m)
		var dd := _density(p.length() - R_E)
		odv += dd * ds
		if _ray_sphere(p, sun, R_E).x > 0.0:
			continue
		var sa := _ray_sphere(p, sun, R_A).y
		var dl := sa / 4.0
		var odl := Vector3.ZERO
		for j in 4:
			var q := p + sun * ((j + 0.5) * dl)
			odl += _density(q.length() - R_E) * dl
		var tau := _extinction(odv + odl, haze)
		var att := Vector3(exp(-tau.x), exp(-tau.y), exp(-tau.z))
		sr += att * (dd.x * ds)
		sm += att * (dd.y * ds)
	var k := SUN_E * SKY_EXPOSURE
	return Color(
		k * (sr.x * BETA_R[0] * pr + sm.x * BETA_M * haze * pm),
		k * (sr.y * BETA_R[1] * pr + sm.y * BETA_M * haze * pm),
		k * (sr.z * BETA_R[2] * pr + sm.z * BETA_M * haze * pm))
