class_name GroundDetail
extends RefCounted
## Detail the source maps' ground lacks (port of the material patches in game/track.ts): their asphalt, concrete and
## grass textures are small flat tiles that turn to mush within metres. Each ground material gets a world-space
## overlay (shaders/ground_overlay.gdshader, multiplied onto the lit surface through next_pass); the grass wears
## Spa's lawn, sampled in world space.

const LAWN_MEAN := Vector3(0.3792, 0.4458, 0.334)
## Metres a repeat of Spa's lawn texture covers (measured on its model's main grass).
const SPA_LAWN_TILE_M := 5.5

static var _textures := {}
static var _shader: Shader

static func _tex(path: String) -> Texture2D:
	if not _textures.has(path):
		_textures[path] = load(path)
	return _textures[path]

## kind: "grass", "gravel", "paved" or "asphalt"; strength and detail as the web game's (0.22 / 0.28 on grass).
static func overlay(kind: String, strength: float, hue: bool, detail: float) -> ShaderMaterial:
	Forest.ensure_globals()
	if _shader == null:
		_shader = load("res://shaders/ground_overlay.gdshader")
	var m := ShaderMaterial.new()
	m.shader = _shader
	m.set_shader_parameter("kind", {"grass": 0, "gravel": 1, "paved": 2, "asphalt": 3}[kind])
	m.set_shader_parameter("strength", strength)
	m.set_shader_parameter("hue", hue)
	m.set_shader_parameter("detail", detail)
	var path: String = {
		"grass": "res://assets/vegetation/lawn.jpg", "gravel": "res://assets_static/ground/gravel_detail.png",
		"paved": "res://assets_static/ground/paved_detail.png", "asphalt": "res://assets/textures/asphalt_detail.jpg",
	}[kind]
	m.set_shader_parameter("detail_tex", _tex(path))
	if kind == "grass":
		m.set_shader_parameter("detail_mean", LAWN_MEAN)
	return m

## Every map's lawn wears Spa's: a sharp photo of real circuit grass, tiled every 5.5 m in world space.
static func use_spa_lawn(sm: StandardMaterial3D) -> void:
	sm.albedo_texture = _tex("res://assets/textures/lawn_spa.jpg")
	sm.albedo_color = Color.WHITE
	sm.uv1_triplanar = true
	sm.uv1_world_triplanar = true
	sm.uv1_scale = Vector3.ONE / SPA_LAWN_TILE_M
	sm.uv1_offset = Vector3.ZERO
	sm.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC

## The overlay of a ground material by its name, as the web game picks it (null: none).
static func apply(sm: StandardMaterial3D) -> void:
	# the overlay is a second pass over every ground triangle: High and Ultra only (phones run Medium)
	var overlays: bool = Settings.data.quality == "high" or Settings.data.quality == "ultra"
	var nm := sm.resource_name
	var ground := RegEx.create_from_string("(?i)^(grass|top2|terrain_fill|astroturf|sand|gravel)").search(nm) != null or nm == "grass_fill"
	var paved := RegEx.create_from_string("(?i)^(asph|conc_|pavement|pits|concrete|paddock_roof|ponyva|tiles)").search(nm) != null
	if ground:
		var is_grass := RegEx.create_from_string("(?i)grass|fill|turf").search(nm) != null
		var is_gravel := RegEx.create_from_string("(?i)^(gravel|sand)").search(nm) != null
		var top2 := RegEx.create_from_string("(?i)^top2").search(nm) != null
		# the satellite terrain (top2) is only seen from afar: no close-up detail there; stones need contrast
		var det := 0.0 if top2 else (0.28 if is_grass else (0.42 if is_gravel else 0.16))
		if overlays:
			sm.next_pass = overlay("grass" if is_grass else ("gravel" if is_gravel else "paved"), 0.22, is_grass or top2, det)
		# (Spa's own side and extension grass keep their dried-out textures out: they read as bare patches on the banks)
		if is_grass and det > 0.0 and RegEx.create_from_string("(?i)^grass_spa$").search(nm) == null:
			use_spa_lawn(sm)
	elif paved:
		var asph := RegEx.create_from_string("(?i)^asph").search(nm) != null
		var det := 0.12 if RegEx.create_from_string("(?i)^(paddock_roof|ponyva)").search(nm) != null else (0.2 if asph else 0.22)
		if overlays:
			sm.next_pass = overlay("asphalt" if asph else "paved", 0.08, false, det)
