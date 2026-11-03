class_name TireModel
extends RefCounted
## Simplified Pacejka "Magic Formula" with combined slip (port of physics/tire.ts).
## Both slips are normalised by their peak values so sigma = |(sx, sy)| is 1 at peak grip in any direction.

class TireParams:
	var kappa_peak: float
	var alpha_peak: float
	var slide_x: float
	var slide_y: float
	var load_sens: float
	func _init(kp: float, ap: float, sx: float, sy: float, ls: float) -> void:
		kappa_peak = kp; alpha_peak = ap; slide_x = sx; slide_y = sy; load_sens = ls

## A GT3 slick: the force past the peak falls ~15 % (the slide is progressive, as the sims' newer tyre models), not 20 %.
static var SLICK := TireParams.new(0.1, 0.115, 0.85, 0.84, 0.12)

var p: TireParams
var cx: float
var bx: float
var cy: float
var by: float

static func _c_for_slide(slide: float) -> float:
	return (PI - asin(slide)) / (PI / 2.0)

static func _b_for_c(c: float) -> float:
	return tan(PI / (2.0 * c))

func _init(params: TireParams = SLICK) -> void:
	p = params
	cx = _c_for_slide(p.slide_x)
	bx = _b_for_c(cx)
	cy = _c_for_slide(p.slide_y)
	by = _b_for_c(cy)

func curve(sigma: float, b: float, c: float) -> float:
	return sin(c * atan(b * sigma))

## Combined tyre force. Returns Vector2(longitudinal, lateral).
func force(kappa: float, alpha: float, fz: float, fz0: float, mu: float) -> Vector2:
	if fz <= 0.0:
		return Vector2.ZERO
	# a loaded tyre's carcass deflects more before it slides: its peak slip comes later (cornering stiffness grows
	# less than the load), a light one peaks earlier
	var r := clampf(fz / fz0, 0.3, 2.5)
	var sx := kappa / (p.kappa_peak * pow(r, 0.1))
	var sy := tan(alpha) / tan(p.alpha_peak * pow(r, 0.25))
	var sigma := Vector2(sx, sy).length()
	if sigma < 1e-6:
		return Vector2.ZERO
	var load := maxf(0.65, 1.0 - p.load_sens * (fz / fz0 - 1.0))
	var mu_eff := mu * load
	var wx := absf(sx) / (absf(sx) + absf(sy))
	var b := bx * wx + by * (1.0 - wx)
	var c := cx * wx + cy * (1.0 - wx)
	var f := mu_eff * fz * curve(sigma, b, c)
	return Vector2(f * sx / sigma, f * sy / sigma)
