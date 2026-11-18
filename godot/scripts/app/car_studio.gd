class_name CarStudio
extends RefCounted
## Brand-free pictures of the cars for the menus (the game carries no brands since 2026-11-16: the shipped thumbnails
## and photos showed the real liveries). picture() renders a car in a livery (CarPaint) in a small studio of its own;
## Preview is the live, turning car of the lobby's Paint page.

## (sharper on a PC: the car page shows the picture large)
static var PIC_SIZE := Vector2i(640, 360) if OS.has_feature("mobile") else Vector2i(1280, 720)

static var _cache := {} # key -> ImageTexture
static var _queue: Array = [] # [entry, livery, ImageTexture]
static var _busy := false
static var _studio: SubViewport
## The car models loaded for the menus, kept (load_model_async).
static var _held := {}

## The car in this livery, rendered 3/4 from the front. The texture is returned at once and filled in when its turn
## comes (a frame or two a car).
## near: from the detailed near model (the big pictures); else the light far model (thumbnails: the strip, the
## drivers' rows), which loads in a fraction of the time.
static func picture(entry: Dictionary, livery: Dictionary, near: bool = false) -> Texture2D:
	near = near and not OS.has_feature("mobile")
	var key := "%s|%s|%s" % [entry.get("id", ""), JSON.stringify(livery), near]
	if _cache.has(key):
		return _cache[key]
	var img := Image.create(8, 8, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	var tex := ImageTexture.create_from_image(img)
	_cache[key] = tex
	_queue.append([entry, livery, tex, near])
	if not _busy:
		_render_queue()
	return tex

## A TextureRect showing picture(), scaled to fit.
static func picture_rect(entry: Dictionary, livery: Dictionary, size: Vector2) -> TextureRect:
	var r := TextureRect.new()
	# a big picture (or one that takes its size from its place) from the near model
	r.texture = picture(entry, livery, size.y >= 120.0 or size == Vector2.ZERO)
	r.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	r.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	r.custom_minimum_size = size
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return r

## The livery a car is shown in where no driver is attached: the player's own.
static func my_livery() -> Dictionary:
	return Settings.data.get("livery", {})

## The file of the car's model level that _car(near) uses.
static func model_file(entry: Dictionary, near: bool) -> String:
	var lods: Array = entry.get("lods", [])
	if lods.is_empty():
		return ""
	return str(lods[mini(1, lods.size() - 1) if near else lods.size() - 1])

## Loads that file in a thread and waits for it (frames go on meanwhile); afterwards _car finds it loaded.
static func load_model_async(entry: Dictionary, near: bool) -> void:
	var f := model_file(entry, near)
	if f == "" or ResourceLoader.has_cached(Assets.path(f)):
		return
	var tree := Engine.get_main_loop() as SceneTree
	Assets.request(f)
	while not Assets.scene_ready(f):
		await tree.process_frame
	# held: a resource nothing refers to is freed at once (and the next load reads it again, on the main thread)
	_held[f] = Assets.scene_result(f)

static func _render_queue() -> void:
	_busy = true
	var tree := Engine.get_main_loop() as SceneTree
	if _studio == null or not is_instance_valid(_studio):
		_studio = _make_studio(PIC_SIZE)
		tree.root.add_child.call_deferred(_studio)
		await tree.process_frame
	while not _queue.is_empty():
		var job: Array = _queue.pop_front()
		var entry: Dictionary = job[0]
		# the model's file read in a thread (a near model took 0.1-0.8 s on the main thread: the lobby froze while
		# its pictures were made)
		await load_model_async(entry, job[3])
		var visual := _car(entry, job[1], job[3])
		if visual == null:
			continue
		_studio.add_child(visual)
		CarPaint.apply(visual, job[1])
		_frame_camera(_studio.get_node("cam") as Camera3D, entry)
		_studio.render_target_update_mode = SubViewport.UPDATE_ONCE
		# the number texture and the paint draw first, then the picture
		await RenderingServer.frame_post_draw
		_studio.render_target_update_mode = SubViewport.UPDATE_ONCE
		await RenderingServer.frame_post_draw
		var img := _studio.get_texture().get_image()
		(job[2] as ImageTexture).set_image(img)
		visual.queue_free()
		await tree.process_frame
	_busy = false

## A small world of its own: a key light, a fill, soft ambient, a transparent background.
static func _make_studio(size: Vector2i) -> SubViewport:
	var vp := SubViewport.new()
	vp.name = "car-studio"
	vp.size = size
	vp.own_world_3d = true
	vp.transparent_bg = true
	vp.msaa_3d = Viewport.MSAA_4X
	vp.render_target_update_mode = SubViewport.UPDATE_DISABLED
	var env := Environment.new()
	env.background_mode = Environment.BG_CLEAR_COLOR
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.62, 0.66, 0.74)
	env.ambient_light_energy = 0.55
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	# a showroom to reflect (the background stays clear): a bright ceiling, a soft horizon band, a dark floor. Without
	# anything to reflect the clear-coated paint looked like flat plastic, one colour all over
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color(0.92, 0.94, 0.98)
	sky_mat.sky_horizon_color = Color(0.55, 0.58, 0.64)
	sky_mat.sky_curve = 0.09
	sky_mat.ground_bottom_color = Color(0.03, 0.035, 0.04)
	sky_mat.ground_horizon_color = Color(0.22, 0.23, 0.26)
	sky_mat.ground_curve = 0.05
	sky_mat.sun_angle_max = 0.0
	sky_mat.energy_multiplier = 1.1
	var sky := Sky.new()
	sky.sky_material = sky_mat
	env.sky = sky
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	var we := WorldEnvironment.new()
	we.environment = env
	vp.add_child(we)
	var key := DirectionalLight3D.new()
	key.rotation_degrees = Vector3(-38, -35, 0)
	key.light_energy = 1.6
	key.shadow_enabled = false
	vp.add_child(key)
	var fill := DirectionalLight3D.new()
	fill.rotation_degrees = Vector3(-18, 150, 0)
	fill.light_energy = 0.55
	fill.light_color = Color(0.8, 0.86, 1.0)
	vp.add_child(fill)
	var cam := Camera3D.new()
	cam.name = "cam"
	# the horizontal angle is kept: the car's length fits whatever the frame's shape
	cam.keep_aspect = Camera3D.KEEP_WIDTH
	cam.fov = 30.0
	cam.current = true
	vp.add_child(cam)
	return vp

static func _frame_camera(cam: Camera3D, entry: Dictionary, turn: float = 0.0) -> void:
	var length: float = float(entry.get("dims", {}).get("length", 4.6))
	# 3/4 from the front left, a little above, the car filling the frame
	var a := deg_to_rad(38.0) + turn
	var d := length * 2.15
	cam.position = Vector3(sin(a) * d, length * 0.33, cos(a) * d)
	cam.look_at(Vector3(0, 0.5, 0), Vector3.UP)

## The car, painted: its near model (the one other cars are drawn with in a race, the full model or up to 400k
## triangles), or its far model (light to load, a phone's small pictures). The menus used the far model everywhere,
## and the cars there looked rough and wrongly shaped, panels collapsed by the simplification.
static func _car(entry: Dictionary, _livery: Dictionary, near: bool = true) -> CarVisual:
	var lods: Array = entry.get("lods", [])
	if lods.is_empty():
		return null
	var level := mini(1, lods.size() - 1) if near else lods.size() - 1
	var model := Assets.load_car_model(entry, level + 1, false, level)
	if model.lods.is_empty() or model.lods[0] == null:
		return null
	return CarVisual.new(entry, model, false)

## The lobby's live car: it turns slowly, and set_livery() repaints it at once.
class Preview:
	extends SubViewportContainer
	var vp: SubViewport
	var visual: CarVisual
	var entry: Dictionary
	var turn := 0.0

	func _init(car: Dictionary, livery: Dictionary) -> void:
		entry = car
		stretch = true
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		vp = CarStudio._make_studio(Vector2i(960, 540))
		vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
		add_child(vp)
		_show.call_deferred(livery)

	## The car when its model has loaded in the background (the page appears at once, the car a moment later).
	var _livery: Dictionary
	func _show(livery: Dictionary) -> void:
		_livery = livery
		await CarStudio.load_model_async(entry, true)
		if not is_instance_valid(vp):
			return
		visual = CarStudio._car(entry, _livery)
		if visual != null:
			vp.add_child(visual)
			CarPaint.apply(visual, _livery)

	func set_livery(livery: Dictionary) -> void:
		_livery = livery
		if visual != null:
			CarPaint.apply(visual, livery)

	func _process(dt: float) -> void:
		turn += dt * 0.35
		CarStudio._frame_camera(vp.get_node("cam") as Camera3D, entry, turn)
