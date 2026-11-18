class_name LensFlare
extends Control
## The sun's glare and lens flare (Display › Sun lens flare; the user, 2026-11-18: lighting as real as it can be): when the
## sun is in front of the camera and nothing solid is between (a ray against the circuit's collision: the ground,
## barriers, buildings), a soft glare round it and a few faint ghosts along the line through the screen's centre, as a
## camera lens makes. Stronger the nearer the sun is to the middle of the view, gone at night and under cloud. Drawn in 2D
## over the 3D (any renderer), additive.

var camera_of: Callable # -> Camera3D
var sun_dir_of: Callable # -> Vector3 (towards the sun, world)
var strength_of: Callable # -> 0..1 (day, clear sky)
var _seen := 0.0
var _pos := Vector2.ZERO
var _ray_t := 0.0

static var _glow: GradientTexture2D
static var _ring: GradientTexture2D
static var _disc: GradientTexture2D

## Ghosts along the sun -> centre line: [place (0 sun, 1 centre, 2 mirrored), size (share of the screen height), colour]
const GHOSTS := [
	[0.55, 0.05, Color(1.0, 0.85, 0.6, 0.10)],
	[1.25, 0.09, Color(0.6, 0.8, 1.0, 0.07)],
	[1.6, 0.04, Color(0.8, 1.0, 0.7, 0.09)],
	[2.0, 0.14, Color(1.0, 0.6, 0.45, 0.05)],
]

func _init() -> void:
	UIKit.full(self)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	var m := CanvasItemMaterial.new()
	m.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	material = m
	if _glow == null:
		_glow = _radial([Color(1, 0.98, 0.94, 1.0), Color(1, 0.95, 0.85, 0.75), Color(1, 0.88, 0.7, 0.18), Color(1, 0.85, 0.7, 0.0)], [0.0, 0.06, 0.3, 1.0])
		_ring = _radial([Color(1, 1, 1, 0), Color(1, 1, 1, 0), Color(1, 1, 1, 0.5), Color(1, 1, 1, 0)], [0.0, 0.78, 0.88, 1.0])
		_disc = _radial([Color(1, 1, 1, 0.8), Color(1, 1, 1, 0.6), Color(1, 1, 1, 0)], [0.0, 0.7, 1.0])

static func _radial(colours: Array, offsets: Array) -> GradientTexture2D:
	var g := Gradient.new()
	g.colors = PackedColorArray(colours)
	g.offsets = PackedFloat32Array(offsets)
	var t := GradientTexture2D.new()
	t.gradient = g
	t.fill = GradientTexture2D.FILL_RADIAL
	t.fill_from = Vector2(0.5, 0.5)
	t.fill_to = Vector2(1.0, 0.5)
	t.width = 128
	t.height = 128
	return t

func _process(dt: float) -> void:
	var target := 0.0
	var cam: Camera3D = camera_of.call() if camera_of.is_valid() else null
	if cam != null and bool(Settings.data.display.get("lensFlare", true)):
		var to_sun: Vector3 = sun_dir_of.call()
		var k: float = strength_of.call()
		var fwd := -cam.global_transform.basis.z
		if k > 0.01 and fwd.dot(to_sun) > 0.2:
			var far := cam.global_position + to_sun * 2000.0
			if not cam.is_position_behind(far):
				_pos = cam.unproject_position(far)
				var r := get_viewport_rect()
				# a little outside the frame still flares (the glare spills in)
				if r.grow(r.size.y * 0.15).has_point(_pos):
					_ray_t -= dt
					if _ray_t <= 0.0:
						# a few rays a second: the circuit's collision between the camera and the sun
						_ray_t = 0.12
						var q := PhysicsRayQueryParameters3D.create(cam.global_position, cam.global_position + to_sun * 1500.0)
						q.collision_mask = 1 | 4 | 16
						var hit := cam.get_world_3d().direct_space_state.intersect_ray(q)
						set_meta("blocked", not hit.is_empty())
					if not bool(get_meta("blocked", false)):
						var centred := 1.0 - clampf(_pos.distance_to(r.size * 0.5) / (r.size.length() * 0.5), 0.0, 1.0)
						target = k * (0.35 + 0.65 * centred)
	# eases in and out (the sun goes behind a post, a tree line)
	_seen = lerpf(_seen, target, clampf(dt * 8.0, 0.0, 1.0))
	visible = _seen > 0.005
	if visible:
		queue_redraw()

func _draw() -> void:
	var r := get_viewport_rect()
	var h := r.size.y
	var a := _seen
	# the glare round the sun
	var g := h * (0.7 + 0.3 * a)
	# a hot core and a wide soft bloom
	var core := h * 0.12
	draw_texture_rect(_glow, Rect2(_pos - Vector2(core, core) * 0.5, Vector2(core, core)), false, Color(1, 1, 1, minf(1.0, a * 1.6)))
	draw_texture_rect(_glow, Rect2(_pos - Vector2(g, g) * 0.5, Vector2(g, g)), false, Color(1, 1, 1, a * 0.9))
	draw_texture_rect(_ring, Rect2(_pos - Vector2(g, g) * 0.3, Vector2(g, g) * 0.6), false, Color(1, 0.95, 0.85, a * 0.35))
	# a horizontal streak (the lens's anamorphic smear)
	draw_texture_rect(_glow, Rect2(_pos - Vector2(h * 1.1, h * 0.018), Vector2(h * 2.2, h * 0.036)), false, Color(1, 0.92, 0.82, a * 0.55))
	# the ghosts
	var c := r.size * 0.5
	for gh in GHOSTS:
		var p: Vector2 = _pos.lerp(c, float(gh[0]))
		var s: float = h * float(gh[1])
		var col: Color = gh[2]
		draw_texture_rect(_disc, Rect2(p - Vector2(s, s) * 0.5, Vector2(s, s)), false, Color(col, col.a * a * 3.0))
