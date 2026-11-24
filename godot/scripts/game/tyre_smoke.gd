class_name TyreSmoke
extends MultiMeshInstance3D
## Tyre smoke and dust (the user, 2026-11-23: "improve ... the smokes of the car"): a wheel that slides on the track
## (wheelspin, a lock-up, a car going sideways) puffs white smoke, one on gravel or sand puffs dust; grass and a wet
## track none. One pool of puffs for every car with physics here (mine and the bots'), drawn as one multimesh of
## camera-facing cards playing a pre-rendered smoke puff (shaders/tyre_smoke.gdshaderinc). A puff is carried along by the car, slows in the air, rises
## and grows as it thins out. Nothing is allocated per frame: the puffs live in packed arrays and the multimesh buffer
## is written in one call.

## How fast a contact patch must slide to smoke (m/s), and the speed at which it smokes fully.
const SLIDE_START := 3.0
const SLIDE_FULL := 11.0
## Dust: loose ground shows less slide.
const DUST_START := 1.5
## Puffs a second from one wheel smoking fully.
const RATE := 34.0
## A puff's life (s), its size when born and at the end of its life (m across).
const LIFE := 2.2
const SIZE_BORN := 0.7
const SIZE_END := 2.8
## Puffs nearer the camera than this are not drawn (m): one there covers the screen, the costliest overdraw (Ultra at
## 1080p, the camera in a cloud of them: 90 -> 52 fps before).
const NEAR_CULL := 1.5
## Opacity of a fresh puff at full smoke.
const ALPHA := 0.5
## How much of the car's speed a puff keeps when born, its drag (1/s) and how fast it rises (m/s).
const CARRY := 0.3
const DRAG := 1.6
const RISE := 0.45
## Colours: tyre smoke (bright, a touch blue-grey) and dust (the colour of the run-off gravel).
const SMOKE_C := Color(0.84, 0.85, 0.88)
const DUST_C := Color(0.62, 0.53, 0.4)
## The puff's flipbook (Unity Labs' "Cloud02", CC0: assets_credits.md).
const PUFF_TEX := "res://assets_static/fx/smoke_puff_8x8.png"
## Floats per instance in the multimesh buffer: transform (12), colour (4), custom (4).
const STRIDE := 20

var _n := 0
var _pos := PackedVector3Array()
var _vel := PackedVector3Array()
var _age := PackedFloat32Array()
var _alpha := PackedFloat32Array()
var _spin := PackedFloat32Array()
var _seed := PackedFloat32Array()
var _col := PackedColorArray()
var _buf := PackedFloat32Array()
var _next := 0
## Puffs alive after the last update, and whether one was born since (nothing to do while both are none).
var _alive := 0
var _born := false
var _rng := RandomNumberGenerator.new()
## The track's wetness (set_wetness).
var _wet := 0.0

## puffs: the pool's size (the quality: overdraw is the cost).
func _init(puffs: int) -> void:
	name = "tyre_smoke"
	_n = puffs
	_rng.seed = 7
	_pos.resize(_n)
	_vel.resize(_n)
	_age.resize(_n)
	_alpha.resize(_n)
	_spin.resize(_n)
	_seed.resize(_n)
	_col.resize(_n)
	_buf.resize(_n * STRIDE)
	_age.fill(LIFE)
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.use_custom_data = true
	var quad := QuadMesh.new()
	quad.size = Vector2(1, 1)
	mm.mesh = quad
	mm.instance_count = _n
	mm.visible_instance_count = 0
	multimesh = mm
	var mat := ShaderMaterial.new()
	var compat := RenderingServer.get_current_rendering_method() == "gl_compatibility"
	mat.shader = load("res://shaders/tyre_smoke_flat.gdshader" if compat else "res://shaders/tyre_smoke.gdshader")
	mat.set_shader_parameter("puff_tex", load(PUFF_TEX))
	material_override = mat
	cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	custom_aabb = AABB(Vector3(-100000, -1000, -100000), Vector3(200000, 2000, 200000))

## The pool's size for a quality preset.
static func puffs_for(quality: String) -> int:
	return {"low": 96, "medium": 160, "high": 256, "ultra": 384}.get(quality, 160)

## The track's wetness (0..1): water on the track, no smoke (the spray takes over).
func set_wetness(w: float) -> void:
	_wet = w

## Puffs from a car's sliding wheels this frame.
func emit_from(v: Vehicle, dt: float) -> void:
	var dry := clampf(1.0 - _wet * 2.5, 0.0, 1.0)
	if dry <= 0.0:
		return
	var speed: float = v.telemetry.speed
	var den := maxf(speed, 2.5)
	var carry := v.linear_velocity * CARRY
	for w: Wheel in v.wheels:
		if not w.contact:
			continue
		var dust := w.surface == "gravel" or w.surface == "sand"
		if not dust and w.surface != "asphalt" and w.surface != "curb":
			continue
		# how fast the patch slides over the ground: along (spin, lock) and across (the slip angle)
		var slide := den * sqrt(w.slip_ratio * w.slip_ratio + pow(tan(clampf(w.slip_angle, -1.3, 1.3)), 2.0))
		var start := DUST_START if dust else SLIDE_START
		var k := clampf((slide - start) / (SLIDE_FULL - start), 0.0, 1.0) * dry
		if k <= 0.0:
			continue
		var count := RATE * k * dt
		# whole puffs, and the rest by chance
		var whole := int(count)
		if _rng.randf() < count - whole:
			whole += 1
		for i in whole:
			puff(w.cp + w.n * 0.2, carry, k, dust)

## One puff at a point (a contact patch), carried along at `carry` (m/s), as thick as k (0..1); dust or smoke.
func puff(at: Vector3, carry: Vector3, k: float, dust: bool) -> void:
	var c := DUST_C if dust else SMOKE_C
	var i := _next
	_next = (_next + 1) % _n
	_pos[i] = at + Vector3(_rng.randf_range(-0.25, 0.25), 0.0, _rng.randf_range(-0.25, 0.25))
	_vel[i] = carry + Vector3(_rng.randf_range(-0.8, 0.8), _rng.randf_range(0.2, 0.9), _rng.randf_range(-0.8, 0.8))
	_age[i] = 0.0
	_alpha[i] = ALPHA * (0.4 + 0.6 * k)
	_spin[i] = _rng.randf() * TAU
	_seed[i] = _rng.randf()
	_col[i] = c
	_born = true

## Moves and ages every puff and hands the ones to draw to the GPU (once a frame). cam: the camera's position.
func update_puffs(dt: float, cam: Vector3) -> void:
	if _alive == 0 and not _born:
		return
	_born = false
	var drag := exp(-DRAG * dt)
	var alive := 0
	var drawn := 0
	var b := 0
	var near := NEAR_CULL * NEAR_CULL
	for i in _n:
		var age := _age[i]
		if age >= LIFE:
			continue
		age += dt
		_age[i] = age
		if age >= LIFE:
			continue
		var vel := _vel[i] * drag
		vel.y += RISE * dt
		_vel[i] = vel
		var p := _pos[i] + vel * dt
		_pos[i] = p
		alive += 1
		# at the lens: not drawn (faded out there anyway, and the most costly: it covers the screen)
		if p.distance_squared_to(cam) < near:
			continue
		var t := age / LIFE
		# grows fast, then slowly; fades in over a tenth of a second and out over its life
		var size := lerpf(SIZE_BORN, SIZE_END, 1.0 - (1.0 - t) * (1.0 - t))
		var a := _alpha[i] * minf(1.0, age * 10.0) * (1.0 - t) * (1.0 - t)
		var c := _col[i]
		_buf[b] = size
		_buf[b + 1] = 0.0
		_buf[b + 2] = 0.0
		_buf[b + 3] = p.x
		_buf[b + 4] = 0.0
		_buf[b + 5] = size
		_buf[b + 6] = 0.0
		_buf[b + 7] = p.y
		_buf[b + 8] = 0.0
		_buf[b + 9] = 0.0
		_buf[b + 10] = size
		_buf[b + 11] = p.z
		_buf[b + 12] = c.r
		_buf[b + 13] = c.g
		_buf[b + 14] = c.b
		_buf[b + 15] = a
		_buf[b + 16] = _spin[i] + age * 0.4
		_buf[b + 17] = t
		_buf[b + 18] = _seed[i]
		_buf[b + 19] = 0.0
		b += STRIDE
		drawn += 1
	_alive = alive
	visible = drawn > 0
	if drawn > 0:
		multimesh.buffer = _buf
	multimesh.visible_instance_count = drawn
