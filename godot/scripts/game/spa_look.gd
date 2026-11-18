class_name SpaLook
extends RefCounted
## Spa-Francorchamps's own materials (the Godot build from the new source model, tools/asset-pipeline/spa_godot/):
## how each of the source's Assetto Corsa materials draws here, and the colour each class is brought to so a clear
## afternoon matches the reference video (docs/spa-rebuild: the look sheet, colours measured from the video frames).
## The other circuits never pass through here.
##
## The source's export lost every alpha mode. Its rubber layers (asph_spa_g*) are black decals whose alpha is the rubber
## (groove3: black, alpha 50/255 on average): drawn opaque they painted the racing surface black. The base asphalt's alpha
## is a detail mask of Assetto Corsa's multi-layer shader, not transparency.

## The same treatment for another circuit (the user, 2026-11-18: the Nürburgring as Spa): a profile overrides the
## tables below by key (NurburgringLook.PROFILE, SilverstoneLook.PROFILE); Spa's profile is empty, so Spa reads these constants as before.
## use() picks the profile for a track (true: the circuit has a look of its own).
static var profile: Dictionary = {}

static func use(track_data: Dictionary) -> bool:
	var id := str(track_data.get("id", ""))
	var map := str(track_data.get("map", ""))
	if id == "spa":
		profile = {}
		return true
	if map == "nurburgring" or id.begins_with("nurburgring_gp") or id == "nurburgring_short":
		profile = NurburgringLook.PROFILE
		return true
	if map == "silverstone":
		profile = SilverstoneLook.PROFILE
		return true
	profile = {}
	return false

## A profile's value, else Spa's.
static func _p(key: String, spa: Variant) -> Variant:
	return profile.get(key, spa)

## [material name pattern, how it draws]: "blend" (alpha-blended decal over the road), "scissor" (cut-out foliage, fences),
## "opaque" (alpha ignored). First match wins.
const DRAW := [
	["(?i)^asph_spa_g", "blend"],
	["(?i)^lines_spa_dots", "blend"],
	["(?i)^(trees_|bushes|treesline|fence|grille|transp|hedge|flag|tyres_add)", "scissor"],
	["(?i)^(asph|curb|lines|grass|gravel|sand|astroturf|pavement|top2|wall_|grail|galvanized)", "opaque"],
]

## Spa's tree cards that are conifers (the forest plants spruces there; the others become its broadleaf): trees1's atlas
## is tall conifers, trees2's broadleaf crowns.
const CONIFER_RE := "(?i)^trees_new_spa1"

## The environment for Spa (GameEnvironment.look): fitted to the video's clear afternoon (matched chase camera, sun 38 deg
## up at 142 deg; tools: ~/apex-ghost-sources/survey-tools/cmp_measure.py). AgX rolls the highlights off as the video
## does (its brightest 0.1 % at 218/255, nothing clipped); the sun and the sky's fill are stronger and the sky itself
## dimmer and clearer: the video's horizon is 3.3x as bright as sunlit asphalt, the game's was 11x. Little fog (at the
## default the far forest turned blue-grey: the video's is olive), scattered cumulus and hardly any cirrus.
const ENV := {"haze": 0.15, "fog": 0.15, "cover": 0.3, "cirrus": 0.2, "sun": 2.2, "ambient": 2.1, "sky": 0.7, "tonemap": "agx", "white": 6.0}

## Albedo multipliers by material name pattern (as albedo_color: sRGB-encoded, so 1.4 is about 2.1x in linear light; and
## alpha: the rubber decals' strength), fitted to the colours measured in the video.
const TINT := [
	# the source's rubber: two layers cover one half of the road each (a hard edge down the middle, a dark half-road):
	# off; the skid marks in the braking zones stay, at half strength
	["^asph_spa_(g1|g2|gc)", [1.0, 1.0, 1.0, 0.0]],
	["^asph_spa_g3", [1.0, 1.0, 1.0, 0.5]],
	["^top2", [2.05, 1.78, 1.53]],
	["@lawn", [1.98, 1.78, 1.47]],
	# the forest (scanned spruces, beech) and the source's distant tree cards: the video's spruce is a dark green
	# (red nearly equal to green read olive-beige on the sunlit side of the crowns once they were lit as crowns)
	["@forest", [0.27, 0.31, 0.16]],
	["^(trees_|bushes)", [0.57, 0.54, 0.38]],
]

## Spa draws its own rubber (the source's layers): no generic RoadWear decal on top.
static func own_wear(track_data: Dictionary) -> bool:
	return use(track_data) and bool(_p("own_wear", true))

## Red-channel mean of assets/textures/asphalt_detail.jpg (the ground detail pass's asphalt photo).
const ASPHALT_DETAIL_MEAN := 0.5

## Target albedos (linear RGB) by material name pattern: the material is tinted so its texture's mean comes out at the
## target. The road is several layers whose textures average from 73/255 to 171/255 (base, resurfaced, pit lane):
## tinted alike they showed as bands; brought to one albedo they read as one surface with the textures' detail.
## Fitted on the base asphalt's match with the video (Kemmel, Raidillon: Delta E under 4).
## The PC's Forward+ renderer against the phone's Mobile one, same scene (the multiply passes made equal: Forest.
## ensure_globals' mul_gain): the sky paler (Mobile's 10-bit buffer clips its brightest blue before the tonemapper, which
## Forward+ rolls off toward white). Fitted at the same seven spots.
const ENV_FP := {"sky": 0.62}

const TARGET := [
	["^asph_spa_(base|base2|new|pit|pit2)$", [0.19, 0.19, 0.195]],
	["^pavement_spa", [0.17, 0.17, 0.172]],
	# the source's bare dirt banks (the hill after La Source, behind Raidillon) carry the planted forest
	# (build_forest.py): a needle-strewn forest floor in shade, not a quarry
	["^sand_spa_dirt", [0.045, 0.042, 0.03]],
]

## The painted run-off (the source's "astroturf" materials: a pale green, a blue and a strip of concrete, green paint and
## white line; and the worn teal strip in the kerb atlas curb_spa_b): not lawn (GroundDetail.paint_re), and every painted
## texel brought to the video's green paint. The video has no blue run-off.
const PAINT_RE := "^(astroturf_spa|curb_spa_b)"
## The video's green run-off paint as an albedo (linear): measured lit at the chicane and Pouhon, (0.005-0.016, 0.32,
## 0.12), over the lit / albedo ratio of the lawn beside it.
const PAINT_GREEN := Color(0.006, 0.22, 0.075)

## The texture with its paint (green or blue texels) recoloured to PAINT_GREEN, the texels' brightness kept as grain.
static var _painted := {}
static func _paint(m: StandardMaterial3D) -> void:
	var t := m.albedo_texture
	if t == null:
		return
	if not _painted.has(t):
		var img := t.get_image()
		if img == null:
			return
		img = img.duplicate()
		if img.is_compressed():
			img.decompress()
		img.clear_mipmaps()
		img.convert(Image.FORMAT_RGBA8)
		var paint := []
		var sum := 0.0
		for y in img.get_height():
			for x in img.get_width():
				var c := img.get_pixel(x, y)
				if c.g > c.r * 1.25 or (c.b > c.r * 1.4 and bool(_p("paint_blue", true))):
					var l := c.srgb_to_linear()
					var lum := l.r * 0.2126 + l.g * 0.7152 + l.b * 0.0722
					paint.append([x, y, lum])
					sum += lum
		if paint.is_empty():
			_painted[t] = t
		else:
			var mean := sum / paint.size()
			for p in paint:
				var k: float = clampf(p[2] / mean, 0.6, 1.4)
				var pg: Color = _p("paint_green", PAINT_GREEN)
				var c := Color(pg.r * k, pg.g * k, pg.b * k).linear_to_srgb()
				c.a = img.get_pixel(p[0], p[1]).a
				img.set_pixel(p[0], p[1], c)
			img.generate_mipmaps()
			_painted[t] = ImageTexture.create_from_image(img)
	m.albedo_texture = _painted[t]
	m.albedo_color = Color(1, 1, 1, m.albedo_color.a)
	# flat paint: no ground-detail pass (a multiply pass at half value on both renderers: Forest.ensure_globals'
	# mul_gain), and little sheen (at a low angle the sky's reflection greyed it)
	m.next_pass = null
	m.metallic_specular = 0.15
	m.roughness = 0.9

## Detail layers on the source's hard surfaces (its textures are cut to 256 px): [material pattern, layer, metres a
## repeat covers]. The layer (tools/asset-pipeline/spa_godot/build_detail_textures.py: scanned CC0 grain, linear mean 0.5,
## and its normal map) is multiplied on in world space over a second UV set, so the material's own texture and its
## paint layout stay; the material's colour is doubled to keep the average. High and Ultra only.
const DETAIL := [
	["^(wall_spa$|wall_spa_concrete|wall_spa_jersey|wall_spa_stone|wall_spa_barriers)", "concrete", 2.7],
	["^(grail_spa|galvanized_spa|metal_beam|fence_spa_special)", "metal", 1.0],
	# the kerbs: painted concrete
	["^(curb_spa|lines_spa$)", "concrete", 1.6],
	["^(structures|box1|houses|main-gstand|raidillon-grandstand|marshal-post|box-door)", "painted", 2.0],
]
const DETAIL_DIR := "res://assets/textures/spa/"

static func _detail(m: StandardMaterial3D, layer: String, tile: float) -> void:
	var tex := DETAIL_DIR + "detail_%s.png" % layer
	if not ResourceLoader.exists(tex):
		return
	m.detail_enabled = true
	m.detail_blend_mode = BaseMaterial3D.BLEND_MODE_MUL
	m.detail_uv_layer = BaseMaterial3D.DETAIL_UV_2
	m.detail_albedo = load(tex)
	if ResourceLoader.exists(DETAIL_DIR + "detail_%s_nor.jpg" % layer):
		m.normal_enabled = true
		m.detail_normal = load(DETAIL_DIR + "detail_%s_nor.jpg" % layer)
	m.uv2_triplanar = true
	m.uv2_world_triplanar = true
	m.uv2_scale = Vector3.ONE / tile
	m.uv2_triplanar_sharpness = 4.0
	# the grain's linear mean is 0.5: twice the colour under it
	var c := m.albedo_color.srgb_to_linear()
	m.albedo_color = Color(c.r * 2.0, c.g * 2.0, c.b * 2.0, c.a).linear_to_srgb()
	m.albedo_color.a = c.a

## The catch fence (the source's "fence_spa"): its 64 x 256 texture drew the wire mesh as an 11 % alpha fill and the
## cables at 23 %; cut at 45 % only the posts were left (the video shows a grey veil of wires). Redrawn at 4x with solid
## wires (tools/asset-pipeline/spa_godot/build_detail_textures.py) and alpha-hashed: a thin wire keeps its coverage
## far off as a dither TAA smooths, where an alpha cut drops it.
const CATCH_FENCE := "res://assets/textures/spa/catch_fence.png"

static func _catch_fence(m: StandardMaterial3D) -> void:
	if not ResourceLoader.exists(CATCH_FENCE):
		return
	m.albedo_texture = load(CATCH_FENCE)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_HASH
	m.alpha_hash_scale = 1.0
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	m.metallic = 0.6
	m.roughness = 0.5

## The kerbs' paint (the source's 96 x 256 kerb textures came out pale pink and cream): red and yellow texels brought to
## the video's (measured lit at Les Combes and Raidillon: red 0.59-0.79 / 0.13-0.15 / 0.12-0.13, yellow 0.66-0.75 /
## 0.58-0.65 / 0.08-0.11 linear) as albedos, each texel's brightness kept as grain; white left alone.
const KERB_RE := "^(curb_spa|lines_spa$)"
const KERB_RED := Color(0.5, 0.085, 0.07)
const KERB_YELLOW := Color(0.5, 0.42, 0.05)

static func _kerb(m: StandardMaterial3D) -> void:
	var t := m.albedo_texture
	if t == null:
		return
	var img := t.get_image()
	if img == null:
		return
	img = img.duplicate()
	if img.is_compressed():
		img.decompress()
	img.clear_mipmaps()
	img.convert(Image.FORMAT_RGBA8)
	# each paint's texels and their mean brightness first, so the grain keeps its average
	var groups := {"red": [], "yellow": []}
	var sums := {"red": 0.0, "yellow": 0.0}
	for y in img.get_height():
		for x in img.get_width():
			var c := img.get_pixel(x, y)
			var key := ""
			# (faded paint: a pale pink is still red, a cream still yellow; white and grey stay)
			if c.r > c.g * 1.12 and c.r > c.b * 1.1 and c.r - c.g > 0.06:
				key = "red"
			elif (c.r + c.g) * 0.5 > c.b * 1.2 and absf(c.r - c.g) < 0.12 and (c.r + c.g) * 0.5 - c.b > 0.08:
				key = "yellow"
			if key != "":
				var l := c.srgb_to_linear()
				var lum := l.r * 0.2126 + l.g * 0.7152 + l.b * 0.0722
				groups[key].append([x, y, lum])
				sums[key] += lum
	var changed := false
	for key in groups:
		var g: Array = groups[key]
		if g.is_empty():
			continue
		changed = true
		var mean: float = sums[key] / g.size()
		var want: Color = _p("kerb_red", KERB_RED) if key == "red" else _p("kerb_yellow", KERB_YELLOW)
		for p in g:
			var k: float = clampf(p[2] / mean, 0.7, 1.3)
			var c := Color(want.r * k, want.g * k, want.b * k).linear_to_srgb()
			c.a = img.get_pixel(p[0], p[1]).a
			img.set_pixel(p[0], p[1], c)
	# matte paint: the source's kerbs were glossy and a flat kerb seen low against the sky came out pale pink and cream
	m.roughness = 0.85
	m.metallic = 0.0
	m.metallic_specular = 0.25
	if changed:
		img.generate_mipmaps()
		m.albedo_texture = ImageTexture.create_from_image(img)
		m.albedo_color = Color(1, 1, 1, m.albedo_color.a)

## The lawns the 3D grass grows on (GrassShells: every "grass" material): drawn as the shells draw it, so the two agree
## where the shells end (16 m on a phone, 60 m on Ultra). Before, they were coloured apart and the flat lawn had the
## default material's sky reflection, which the shells have not: past the shells a lighter, washed-out band.
const LAWN_RE := "^grass_spa(_ext|_bank)?$"
## Ground that keeps its own texture and grows no 3D grass (GroundDetail.paint_re): the painted run-off, and the side
## banks: the source's rock cuttings (grass-side1B: layered rock and scrub) and rough banks (sbancamento_B, 8K: meadow
## grass and earth; grass-side3, 4K). The shared ground code put the mown lawn photo on them (a port of the web game,
## where they read as bare patches) and the 3D lawn on top: the cuttings and banks came out uniform mown grass.
const OWN_RE := "^(astroturf_spa|curb_spa_b|grass_spa_side)"
## The shells' shading the flat lawn takes (grass_shells.gdshader: dark roots 0.62 to light tips 1.3; 0.84 to 0.88 on
## average over the blade texture seen from above); the shells settle on it as they fade out.
const LAWN_EDGE := 0.85

## A lawn as the shells draw it: the same photo at the same world-space tiling, the shells' tint (in linear light, as their
## shader multiplies it) and shading, no specular.
static func _lawn(m: StandardMaterial3D) -> void:
	GroundDetail.use_spa_lawn(m)
	var t := global_tint("@lawn") * LAWN_EDGE
	# the ground-detail pass (High, Ultra) multiplies at half value on both renderers (Forest.ensure_globals' mul_gain):
	# twice the colour under it
	if m.next_pass != null:
		t *= 2.0
	var c := GroundDetail.LAWN_TINT
	m.albedo_color = Color(_enc(c.r * t.x), _enc(c.g * t.y), _enc(c.b * t.z))
	m.metallic_specular = 0.0
	m.roughness = 1.0

## The road's surface: a scanned circuit asphalt (Poly Haven "asphalt_track", CC0, 2 x 2 m at 4K: godot/assets_credits.md)
## in world space over every road layer. The source's road textures are Assetto Corsa strips (1024 x 4096) whose
## brightness changes along their length: the same layer showed light on one straight and dark on the next.
const ROAD_RE := "^asph_spa_(base|base2|new|pit|pit2)$"
## 4K on the PC, 2K on phones (the phone's pack carries only the 2K set: tools/godot/build-track-pack.py); whichever
## is there.
static func _road_file(map: String) -> String:
	for res in (["2k", "4k"] if OS.has_feature("mobile") else ["4k", "2k"]):
		var p := "res://assets/textures/spa/asphalt_track_%s_%s.jpg" % [map, res]
		if ResourceLoader.exists(p):
			return p
	return ""

## (looked up when used, not when the script loads: a pack downloaded in the session mounts after that)
const ROAD_TILE_M := 2.0
## The scan's mean linear colour, measured from the file (reading it back from the GPU's compressed copy came out wrong).
const ROAD_TEX_MEAN := Color(0.0163, 0.0128, 0.0120)

static func _road_surface(m: StandardMaterial3D) -> void:
	var ROAD_TEX := _road_file("diff")
	var ROAD_NORMAL := _road_file("nor_gl")
	var ROAD_ARM := _road_file("arm")
	if ROAD_TEX == "":
		return
	m.albedo_texture = load(ROAD_TEX)
	m.uv1_triplanar = true
	m.uv1_world_triplanar = true
	m.uv1_scale = Vector3.ONE / ROAD_TILE_M
	m.uv1_offset = Vector3.ZERO
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	if ResourceLoader.exists(ROAD_NORMAL):
		m.normal_enabled = true
		m.normal_texture = load(ROAD_NORMAL)
		m.normal_scale = 1.0
	if ResourceLoader.exists(ROAD_ARM):
		m.roughness_texture = load(ROAD_ARM)
		m.roughness_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_GREEN
		m.roughness = 1.0

## Linear to sRGB encoding, also above 1 (a factor brightening a dark texture).
static func _enc(x: float) -> float:
	return x * 12.92 if x <= 0.0031308 else 1.055 * pow(x, 1.0 / 2.4) - 0.055

## The mean linear colour of a texture (cached by resource).
static var _means := {}
static func texture_mean(t: Texture2D) -> Color:
	if t == null:
		return Color(1, 1, 1)
	if _means.has(t):
		return _means[t]
	var img := t.get_image()
	if img == null:
		return Color(1, 1, 1)
	img = img.duplicate()
	if img.is_compressed():
		img.decompress()
	img.convert(Image.FORMAT_RGB8)
	img.resize(32, 32, Image.INTERPOLATE_BILINEAR)
	var acc := Vector3.ZERO
	for y in 32:
		for x in 32:
			var c := img.get_pixel(x, y).srgb_to_linear()
			acc += Vector3(c.r, c.g, c.b)
	acc /= 1024.0
	_means[t] = Color(acc.x, acc.y, acc.z)
	return _means[t]

## ENV, with a test's SPA_LOOK (JSON) over it (look comparisons).
static func env_look() -> Dictionary:
	var l: Dictionary = (_p("env", ENV) as Dictionary).duplicate()
	if forward_plus():
		l.merge(_p("env_fp", ENV_FP), true)
	var o = JSON.parse_string(OS.get_environment("SPA_LOOK")) if OS.get_environment("SPA_LOOK") != "" else null
	if o is Dictionary:
		l.merge(o, true)
	return l

static func forward_plus() -> bool:
	return RenderingServer.get_current_rendering_method() == "forward_plus"

## TINT, or a test's SPA_TINT (JSON: [[pattern, [r, g, b]], ...]).
static func tints() -> Array:
	var o = JSON.parse_string(OS.get_environment("SPA_TINT")) if OS.get_environment("SPA_TINT") != "" else null
	return o if o is Array else _p("tint", TINT)

## Tints of what draws its own shared textures, not the circuit's materials: "@lawn" (the 3D grass shells and blades),
## "@forest" (the forest's trees and impostors).
static func global_tint(key: String) -> Vector3:
	for t in tints():
		if t[0] == key:
			return Vector3(t[1][0], t[1][1], t[1][2])
	return Vector3.ONE

static func apply(track: TrackScene) -> void:
	var res := []
	for d in _p("draw", DRAW):
		res.append([RegEx.create_from_string(d[0]), d[1]])
	var tint_res := []
	for t in tints():
		if String(t[0]).begins_with("@"):
			continue
		tint_res.append([RegEx.create_from_string(t[0]), Color(t[1][0], t[1][1], t[1][2], t[1][3] if t[1].size() > 3 else 1.0)])
	var target_res := []
	for t in _p("target", TARGET):
		target_res.append([RegEx.create_from_string(t[0]), Color(t[1][0], t[1][1], t[1][2])])
	var road_re := RegEx.create_from_string(_p("road_re", ROAD_RE))
	var lawn_re := RegEx.create_from_string(_p("lawn_re", LAWN_RE))
	var paint_re := RegEx.create_from_string(_p("paint_re", PAINT_RE))
	var kerb_re := RegEx.create_from_string(_p("kerb_re", KERB_RE))
	var fence_re := RegEx.create_from_string(_p("fence_re", "^fence_spa$"))
	var seen := {}
	var counts := {}
	var off: Array = []
	for n in CarVisual._walk(track):
		if not (n is MeshInstance3D) or (n as MeshInstance3D).mesh == null:
			continue
		var mesh := (n as MeshInstance3D).mesh
		for s in mesh.get_surface_count():
			var m := mesh.surface_get_material(s) as StandardMaterial3D
			if m == null or seen.has(m):
				continue
			seen[m] = true
			var how := ""
			for r in res:
				if (r[0] as RegEx).search(m.resource_name) != null:
					how = r[1]
					break
			match how:
				"blend":
					# no ground-detail pass of its own (GroundDetail gives every "asph" material one): stacked over the road,
					# each decal layer's multiplied the road again, a darker half-road where the rubber layers lie
					m.next_pass = null
					m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
					m.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
					m.render_priority = 1
					m.cull_mode = BaseMaterial3D.CULL_BACK
				"scissor":
					m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
					# tree cards' foliage is soft-edged: a high threshold left bare branches
					m.alpha_scissor_threshold = 0.25 if m.resource_name.begins_with("trees_") or m.resource_name.begins_with("bushes") else 0.45
					m.cull_mode = BaseMaterial3D.CULL_DISABLED
				"opaque":
					m.transparency = BaseMaterial3D.TRANSPARENCY_DISABLED
					# the road's detail pass: neutral on average (the photo's mean, not 0.5), so High / Ultra and Medium (no
					# pass) show the same colour
					if m.next_pass is ShaderMaterial and int((m.next_pass as ShaderMaterial).get_shader_parameter("kind")) == 3:
						(m.next_pass as ShaderMaterial).set_shader_parameter("asph_mean", ASPHALT_DETAIL_MEAN)
			if how != "":
				counts[how] = counts.get(how, 0) + 1
			if OS.get_environment("LOOK_ROLES") != "":
				var roles := []
				for pair in [["road", road_re], ["lawn", lawn_re], ["paint", paint_re], ["kerb", kerb_re], ["fence", fence_re]]:
					if (pair[1] as RegEx).search(m.resource_name) != null:
						roles.append(pair[0])
				print("[look roles] %s draw=%s %s next=%s" % [m.resource_name, how, roles, m.next_pass != null])
			if road_re.search(m.resource_name) != null:
				_road_surface(m)
			if lawn_re.search(m.resource_name) != null:
				_lawn(m)
			if paint_re.search(m.resource_name) != null:
				_paint(m)
			if fence_re.search(m.resource_name) != null:
				_catch_fence(m)
			if kerb_re.search(m.resource_name) != null:
				_kerb(m)
			for t in target_res:
				if (t[0] as RegEx).search(m.resource_name) != null:
					var mean := ROAD_TEX_MEAN if m.albedo_texture != null and m.albedo_texture.resource_path.begins_with("res://assets/textures/spa/asphalt_track_diff") else texture_mean(m.albedo_texture)
					var want: Color = t[1]
					if OS.get_environment("SPA_DEBUG") != "":
						print("[spa look] ", m.resource_name, " tex ", m.albedo_texture.resource_path if m.albedo_texture else "-", " ", m.albedo_texture.get_size() if m.albedo_texture else "", " mean ", mean, " albedo_color before ", m.albedo_color, " metal ", m.metallic, " rough ", m.roughness, " spec ", m.metallic_specular)
					# albedo_color is an sRGB colour (the shader takes it to linear): the linear factor target / mean goes in encoded
					m.albedo_color = Color(_enc(want.r / maxf(mean.r, 0.002)), _enc(want.g / maxf(mean.g, 0.002)), _enc(want.b / maxf(mean.b, 0.002)), m.albedo_color.a)
					for r in track.road_materials:
						if r.mat == m:
							r.color = m.albedo_color
					break
			for t in tint_res:
				if (t[0] as RegEx).search(m.resource_name) != null:
					var c: Color = t[1]
					m.albedo_color = Color(m.albedo_color.r * c.r, m.albedo_color.g * c.g, m.albedo_color.b * c.b, m.albedo_color.a * c.a)
					# a layer switched off (alpha 0) is not drawn at all
					if m.albedo_color.a <= 0.0:
						off.append(m)
					# the wet-track darkening restores the dry colour it saved: save the tinted one
					for r in track.road_materials:
						if r.mat == m:
							r.color = m.albedo_color
					break
	if OS.get_environment("SPA_DEBUG") != "":
		for mm in seen:
			var sm := mm as StandardMaterial3D
			if sm != null and sm.resource_name.begins_with("asph_spa_") and not sm.resource_name.begins_with("asph_spa_g"):
				print("[spa look] final ", sm.resource_name, " tex ", sm.albedo_texture.resource_path if sm.albedo_texture else "-", " col ", sm.albedo_color, " vc ", sm.vertex_color_use_as_albedo, " rough ", sm.roughness, " nrm ", sm.normal_enabled, " tri ", sm.uv1_triplanar, " detail ", sm.detail_enabled, " next ", sm.next_pass != null, " shading ", sm.shading_mode)
	# the repainted textures live on in their materials: no static reference left to outlive the scene (a leak at exit)
	_painted.clear()
	if Settings.data.quality == "high" or Settings.data.quality == "ultra":
		var det_res := []
		for d in _p("detail", DETAIL):
			det_res.append([RegEx.create_from_string(d[0]), d[1], d[2]])
		for mm in seen:
			var sm := mm as StandardMaterial3D
			if sm == null or sm.detail_enabled:
				continue
			for d in det_res:
				if (d[0] as RegEx).search(sm.resource_name) != null:
					_detail(sm, d[1], d[2])
					break
	if not off.is_empty():
		for n in CarVisual._walk(track):
			if n is MeshInstance3D and (n as MeshInstance3D).mesh != null:
				var mi := n as MeshInstance3D
				for k in mi.mesh.get_surface_count():
					if off.has(mi.mesh.surface_get_material(k)):
						mi.set_surface_override_material(k, _hidden())
	print("[%s look] materials: " % _p("name", "spa"), counts, ", layers off: ", off.size())

static var _hidden_mat: StandardMaterial3D = null
## A material that draws nothing (a surface switched off without rebuilding the mesh).
static func _hidden() -> StandardMaterial3D:
	if _hidden_mat == null:
		_hidden_mat = StandardMaterial3D.new()
		_hidden_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		_hidden_mat.albedo_color = Color(0, 0, 0, 0)
		_hidden_mat.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
		_hidden_mat.no_depth_test = false
	return _hidden_mat


## Spa's forest stands up to the track all round (build_forest.py plants it every 6.5 m): the models' range is cut so
## Ultra draws about as many as at the Nordschleife (10,500 trees within 220 m: 36 fps on the RX 7600 XT at 1440p).
## 0.49 (108 m on Ultra) with FOREST_SHADOW: the climb from Raidillon up the Kemmel straight, forest close on both
## sides, was the lap's slowest stretch (GPU 24.4 ms, 36 fps at 1440p Ultra with no other cars; 20.1 ms, 46 fps now).
const FOREST_NEAR_SCALE := 0.49
## How far Spa's near trees cast shadows (45 m before: 1.5 x FOREST_HERO; the tree shadows were 4 ms of that stretch).
const FOREST_SHADOW := 30.0
## Spa's full tree models out to 30 m (60 elsewhere): the far models keep the crowns' cover (build_trees.py) and the
## change is a blend (Forest.fades), so it is hard to see; the full layer reaches the range + Forest.HERO_BAND +
## PICK_MARGIN. Ultra at 2560 x 1440 (60 s drive from 0.5 km): 30 m 67 fps average / 40 at the 1 % low, 40 m 59 / 35
const FOREST_HERO := 30.0

## The source's trackside trees (crossed cards, planted as models by Forest): its cards stand 2-18 m (5-95 %) and the
## near ones are nearly all one spruce texture, where the video shows 20-30 m spruce with beech and birch in front. Trees
## (not the bushes, under 4 m) are scaled up 1.35x to at most 30 m, and about a third become broadleaf, by a hash of
## the position (the same every load).
const CARD_TREE_SCALE := 1.35
const CARD_TREE_MAX := 30.0
const CARD_BROADLEAF := 0.35

static func card_trees(out: Array) -> void:
	var spruce_before := 0
	for e in out:
		spruce_before += 1 if e.spruce else 0
		if float(e.h) < 4.0:
			continue
		e.h = minf(float(e.h) * CARD_TREE_SCALE, CARD_TREE_MAX)
		var hsh := absi(int(floor(float(e.x) * 7.31)) * 73856093 ^ int(floor(float(e.z) * 5.17)) * 19349663) % 1000
		if e.spruce and hsh < int(CARD_BROADLEAF * 1000.0):
			e.spruce = false
			e.h = float(e.h) * 0.85
	if OS.get_environment("SPA_DEBUG") != "":
		print("[spa look] card trees: %d (spruce %d -> %d)" % [out.size(), spruce_before, out.filter(func(e): return e.spruce).size()])
