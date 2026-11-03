class_name GameEnvironment
extends Node3D
## Sky, sun/moon light, fog, clouds, stars and rain, driven by the deterministic weather state (port of the
## Environment class of game/environment.ts). The sky (shaders/sky.gdshader) and every colour derived from it
## (sunlight, sky ambient, fog) come from one atmosphere model, so the light on the track always matches the sky.

const NIGHT_C := Color(0.012, 0.016, 0.03)
const OVERCAST_C := Color(0.62, 0.66, 0.7)
const DUSK_C := Color(0.42, 0.5, 0.75)
const LUT_SIZE := Vector2i(128, 64)

var plan: Dictionary
var quality: Dictionary
var world_env := WorldEnvironment.new()
var env := Environment.new()
var sky_mat := ShaderMaterial.new()
var sun := DirectionalLight3D.new()
var lut_viewport := SubViewport.new()
var lut_mat := ShaderMaterial.new()
var _rain: MeshInstance3D
var _rain_mat := ShaderMaterial.new()
## < 1 thins the fog (the aerial shots of the pre-race cinematic would be a white-out in fog).
var fog_scale := 1.0
## The camera-centred rain streaks look like blobs from an aerial camera: hidden during the flyover.
var hide_rain := false
## 0 day .. 1 full night.
var night := 0.0
var sun_elevation := 0.0
var sun_dir := Vector3(0, 1, 0)
var _sky_acc := 100.0
var _time := 0.0
var _last_sun := Vector3(0, -2, 0)
var _last_haze := -1.0
var _col_sun := Vector3(0, -2, 0)
var _col_haze := -1.0
var _sun_t := Color.WHITE
var _zenith := Color.BLACK
var _horizon_sun := Color.BLACK
var _horizon_away := Color.BLACK

func _init(weather_plan: Dictionary, q: Dictionary) -> void:
	plan = weather_plan
	quality = q
	name = "environment"
	# sky: the LUT viewport renders the atmosphere only when the sun or haze moves
	lut_viewport.size = LUT_SIZE
	lut_viewport.use_hdr_2d = true
	lut_viewport.transparent_bg = false
	lut_viewport.render_target_update_mode = SubViewport.UPDATE_ONCE
	lut_mat.shader = load("res://shaders/sky_lut.gdshader")
	var rect := ColorRect.new()
	rect.size = Vector2(LUT_SIZE)
	rect.material = lut_mat
	lut_viewport.add_child(rect)
	add_child(lut_viewport)
	sky_mat.shader = load("res://shaders/sky.gdshader")
	sky_mat.set_shader_parameter("tLut", lut_viewport.get_texture())
	sky_mat.set_shader_parameter("tNoise", load("res://assets_static/sky/cloud_noise.png"))
	sky_mat.set_shader_parameter("CLOUD_DETAIL", int(q.cloudDetail))
	_apply_post(q)
	var sky := Sky.new()
	sky.sky_material = sky_mat
	# the radiance map (ambient light and reflections) is redone every frame, from a cheap cubemap-pass of the sky shader
	sky.process_mode = Sky.PROCESS_MODE_REALTIME
	sky.radiance_size = Sky.RADIANCE_SIZE_256
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.fog_enabled = true
	env.fog_mode = Environment.FOG_MODE_EXPONENTIAL
	env.fog_sky_affect = 0.0
	env.fog_aerial_perspective = 0.35
	world_env.environment = env
	add_child(world_env)
	# the sun
	sun.shadow_enabled = bool(q.shadows)
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	sun.directional_shadow_max_distance = maxf(60.0, float(q.shadowRange) * 3.0)
	sun.shadow_bias = 0.02
	sun.shadow_normal_bias = 1.0
	sun.light_angular_distance = 0.5
	add_child(sun)
	_build_rain()
	RenderingServer.directional_shadow_atlas_set_size(clampi(int(q.shadowMapSize), 1024, 8192), true)
	_apply_post(q)

func _build_rain() -> void:
	var drops: int = int(quality.rainParticles)
	var verts := PackedVector3Array()
	var cols := PackedColorArray()
	var rng := RandomNumberGenerator.new()
	rng.seed = 1
	for i in drops:
		var p := Vector3(rng.randf() * 50.0 - 25.0, rng.randf() * 30.0, rng.randf() * 50.0 - 25.0)
		for k in 2:
			verts.append(p)
			cols.append(Color(float(k), 0, 0, 1))
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_COLOR] = cols
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_LINES, arrays)
	mesh.custom_aabb = AABB(Vector3(-100000, -100000, -100000), Vector3(200000, 200000, 200000))
	_rain_mat.shader = load("res://shaders/rain.gdshader")
	_rain = MeshInstance3D.new()
	_rain.mesh = mesh
	_rain.material_override = _rain_mat
	_rain.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_rain.visible = false
	add_child(_rain)

## Sunlight colour, zenith and horizon colours from the atmosphere model (cheap enough per change, not per frame).
func _refresh_colours(haze: float) -> void:
	var s := sun_dir
	if s.distance_squared_to(_col_sun) < 1e-6 and absf(haze - _col_haze) < 0.01:
		return
	_col_sun = s
	_col_haze = haze
	_sun_t = Atmosphere.sun_transmittance(s, haze)
	_zenith = Atmosphere.sky_radiance(Vector3(0, 1, 0), s, haze)
	var az := atan2(s.z, s.x) if Vector2(s.x, s.z).length() > 1e-4 else 0.0
	_horizon_sun = Atmosphere.sky_radiance(Vector3(cos(az), 0.035, sin(az)).normalized(), s, haze)
	_horizon_away = Atmosphere.sky_radiance(Vector3(-cos(az), 0.035, -sin(az)).normalized(), s, haze)

static func _smoothstep(a: float, b: float, x: float) -> float:
	var t := clampf((x - a) / (b - a), 0.0, 1.0)
	return t * t * (3.0 - 2.0 * t)

## Update for the given weather state (a Weather.weather_at result). Cheap; called every frame.
func update(dt: float, w: Dictionary, camera: Camera3D, focus: Vector3, car_vel: Vector3) -> void:
	_time += dt
	var se := Weather.sun_position(plan.dayOfYear, w.hour)
	var elevation: float = se.elevation
	var azimuth: float = se.azimuth
	sun_elevation = elevation
	# world: +Z north-ish; azimuth measured from north towards east (+X)
	var sun_v := Vector3(sin(azimuth) * cos(elevation), sin(elevation), -cos(azimuth) * cos(elevation))
	sun_dir = sun_v
	var day := _smoothstep(-0.1, 0.12, elevation)
	night = 1.0 - _smoothstep(-0.2, 0.02, elevation)
	var overcast: float = w.clouds
	# crisp blue on clear days, milky in haze and fog
	var haze: float = 0.55 + overcast * 0.9 + w.fog * 4.0
	_update_lut(sun_v, haze)
	_refresh_colours(haze)

	# sun or moon light
	var direct: float = (1.0 - overcast * 0.8) * (1.0 - w.fog * 0.6)
	var st := _sun_t
	var t_max := maxf(maxf(st.r, st.g), maxf(st.b, 1e-4))
	var light_dir: Vector3
	if elevation > -0.02:
		light_dir = -sun_v
		# hue from the atmosphere (white-yellow at noon, orange near the horizon); brightness falls with the air mass
		var c := Color(st.r / t_max, st.g / t_max, st.b / t_max).lerp(Color.WHITE, overcast * 0.6)
		sun.light_color = c
		var air_mass := clampf(sqrt((0.2126 * st.r + 0.7152 * st.g + 0.0722 * st.b) / 0.86), 0.35, 1.05)
		# three's physical lights: irradiance 3.6 -> radiance albedo * 3.6 / pi; Godot's energy 1 is albedo * 1
		sun.light_energy = (3.6 * day * direct * air_mass + 0.0001) / PI
	else:
		# moonlight from the opposite side of the sky
		var m := Vector3(-sun_v.x, maxf(0.35, -sun_v.y), -sun_v.z).normalized()
		light_dir = -m
		sun.light_color = Color(0.55, 0.65, 1.0)
		sun.light_energy = 0.45 * (1.0 - overcast * 0.6) / PI * 1.6 # bright moonlight so the track stays readable
	# snap the shadow origin to texels to avoid shimmering
	sun.global_transform = Transform3D(Basis.looking_at(light_dir, Vector3.UP), focus)

	# ambient comes from the sky itself (Environment.ambient_light_source = SKY); its strength follows the day
	# a clear day: the sun several times the sky's fill (deep, blue-ish shadows); under cloud the light is the sky's
	env.ambient_light_energy = (0.34 + 1.0 * day * (0.64 + overcast * 0.66)) * 0.62
	# the sky's light is blue, but what fills a shadow is also the light the ground and the stands bounce back
	# (warm grey): part of the ambient is that neutral colour, so shadows are cool, not cyan
	env.ambient_light_sky_contribution = 0.7
	env.ambient_light_color = Color(0.78, 0.76, 0.72) * (0.35 + 0.65 * day)

	# fog: the horizon colours of the sky in the same direction (towards / away from the sun), grey under cloud
	var heavy_fog := _smoothstep(0.0, 1.0, 1.0 - w.visibility / 900.0)
	var grey := Color(OVERCAST_C.r, OVERCAST_C.g, OVERCAST_C.b) * (0.25 + 1.25 * day)
	grey.a = 1.0
	var grey_mix := minf(1.0, overcast * 0.85 + w.fog * 0.8)
	var fog_away := _horizon_away.lerp(grey, grey_mix).lerp(NIGHT_C, night * 0.9)
	var fog_sun := _horizon_sun.lerp(grey, grey_mix).lerp(NIGHT_C, night * 0.9)
	env.fog_light_color = fog_away
	env.fog_sun_scatter = clampf((fog_sun.get_luminance() - fog_away.get_luminance()) / maxf(0.05, fog_away.get_luminance() + 0.5), 0.0, 1.0)
	# FogExp2 (density 1.95 / visibility) is nearly gone at the visibility distance: an exponential fog with the same reach
	env.fog_density = 3.8 / maxf(120.0, float(w.visibility)) * fog_scale * 0.5
	env.fog_height_density = 0.0

	# sky: clouds lit by the sun's transmitted colour and the sky's ambient
	var sun_illum := _smoothstep(-0.04, 0.06, elevation)
	var disc: Color = Color(st.r, st.g, st.b) * (60.0 * sun_illum * (1.0 - overcast * 0.95) * (1.0 - w.fog))
	var cloud_sun := Color(st.r, st.g, st.b) * (2.6 * sun_illum * (1.0 - overcast * 0.55))
	var cloud_amb := (_zenith * 0.9 + _horizon_away * 0.55).lerp(grey * 0.95, overcast * 0.7) + Color(0.006, 0.008, 0.014) * night
	RenderingServer.global_shader_parameter_set("sky_time", _time + (int(plan.seed) % 1000) * 7.0)
	_sky_acc += dt
	var push_sky := _sky_acc > 1.5
	if push_sky:
		_sky_acc = 0.0
	if push_sky:
		sky_mat.set_shader_parameter("uSun", sun_v)
	if push_sky:
		sky_mat.set_shader_parameter("uSunDisc", Vector3(disc.r, disc.g, disc.b))
	if push_sky:
		sky_mat.set_shader_parameter("uCloudSun", Vector3(cloud_sun.r, cloud_sun.g, cloud_sun.b))
	if push_sky:
		sky_mat.set_shader_parameter("uCloudAmb", Vector3(cloud_amb.r, cloud_amb.g, cloud_amb.b))
	if push_sky:
		sky_mat.set_shader_parameter("uCover", minf(0.97, 0.12 + overcast * 0.85 + w.fog * 0.2))
	if push_sky:
		sky_mat.set_shader_parameter("uCirrus", (1.0 - overcast) * 0.8)
	if push_sky:
		sky_mat.set_shader_parameter("uFogMix", heavy_fog)
	if push_sky:
		sky_mat.set_shader_parameter("uFogColor", Vector3(fog_away.r, fog_away.g, fog_away.b))
	if push_sky:
		sky_mat.set_shader_parameter("uNight", night)

	# rain
	_rain.visible = w.rain > 0.01 and not hide_rain
	_rain_mat.set_shader_parameter("uTime", _time)
	_rain_mat.set_shader_parameter("uCam", camera.global_position)
	_rain_mat.set_shader_parameter("uVel", car_vel)
	_rain_mat.set_shader_parameter("uIntensity", w.rain)
	var rc := Color(0.7, 0.74, 0.8) * (0.15 + 0.85 * day)
	_rain_mat.set_shader_parameter("uColor", Vector3(rc.r, rc.g, rc.b))

	env.tonemap_exposure = (1.0 + night * 1.1 + overcast * 0.12) * float(Settings.data.brightness)

func _update_lut(sun_v: Vector3, haze: float, force: bool = false) -> void:
	if not force and absf(sun_v.y - _last_sun.y) < 0.0015 and absf(haze - _last_haze) < 0.02:
		return
	_last_sun = sun_v
	_last_haze = haze
	lut_mat.set_shader_parameter("uSun", sun_v)
	lut_mat.set_shader_parameter("uHaze", haze)
	lut_viewport.render_target_update_mode = SubViewport.UPDATE_ONCE

## Reflection strength: dimmer at night.
func env_intensity() -> float:
	return 0.25 + 0.75 * (1.0 - night)

func _apply_post(q: Dictionary) -> void:
	# bloom (only the sun, headlights and floodlights pass the threshold) and the filmic grade of High / Ultra
	env.glow_enabled = bool(q.bloom)
	env.glow_hdr_threshold = 4.0
	env.glow_intensity = 0.32
	env.glow_bloom = 0.0
	env.adjustment_enabled = bool(q.grade)
	env.adjustment_contrast = 1.06
	env.adjustment_saturation = 1.0
	# the sun's cascades: two are enough on a phone
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS if int(q.shadowMapSize) >= 4096 else DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS

func set_quality(q: Dictionary) -> void:
	quality = q
	sun.shadow_enabled = bool(q.shadows)
	sun.directional_shadow_max_distance = maxf(60.0, float(q.shadowRange) * 3.0)
	RenderingServer.directional_shadow_atlas_set_size(clampi(int(q.shadowMapSize), 1024, 8192), true)
	sky_mat.set_shader_parameter("CLOUD_DETAIL", int(q.cloudDetail))
	_apply_post(q)
