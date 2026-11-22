class_name ShanghaiLook
extends RefCounted
## Shanghai International Circuit's look (the user, 2026-11-19: the new circuit with "super hyper realistic graphics"):
## SpaLook's treatment through a profile of the model's materials (tools/asset-pipeline/circuit/shanghai.json names them
## asph_sh_*, curb_sh ...). The model is a compressed export (textures at 256 px, the road 64 x 256): the scanned road
## and gravel, the lawn photo and the grain layers carry its surfaces. The light is a humid Yangtze-delta afternoon:
## a hazy, paler sky and more haze over the flat land around.
##
## The model's own colours, measured (the render's materials.json): the racing surface and the run-off 0.095, the
## paddock and pit asphalt near black (0.004: their texture's alpha, a specular mask, came through as colour), the
## lawn a flat grey 0.26, the gravel 0.21 / 0.18 / 0.14.

const PROFILE := {
	"name": "shanghai",
	# a humid afternoon: hazier and cloudier than Spa's, a softer sun
	"env": {"haze": 0.34, "fog": 0.22, "cover": 0.42, "cirrus": 0.35, "sun": 2.05, "ambient": 2.2, "sky": 0.64, "tonemap": "agx", "white": 6.0},
	"draw": [
		["(?i)^(asph_sh_g|asph_sh_trans)", "blend"],
		["(?i)^(trees_sh|treeline|fence_sh|lines_sh)", "scissor"],
		["(?i)^(asph|curb|grass|sand|top2|astroturf|wall_|grail|water)", "opaque"],
	],
	# every asphalt: one scanned asphalt
	"road_re": "^asph_sh_(road|runoff|runoff_art1|runoff_art2|paddock|paddock2|pit)$",
	"target": [
		["^asph_sh_road$", SpaLook.ROAD_ALBEDO],
		["^asph_sh_(runoff|runoff_art1|runoff_art2)$", [0.205, 0.202, 0.2]],
		# the paddock and the pit lane: the pale concrete-grey asphalt of a new circuit
		["^asph_sh_(paddock|paddock2|pit)$", [0.22, 0.218, 0.215]],
		["^sand_sh", [0.34, 0.3, 0.23]],
		# the outfield beyond the model's ground: grass and paving round the circuit's buildings
		["^top2_sh$", [0.08, 0.095, 0.05]],
		["^top2_sh_paddock$", [0.2, 0.2, 0.2]],
		# the run-off's painted turf: green and the blue of the hairpin's
		["^astroturf_sh$", [0.03, 0.12, 0.045]],
		["^astroturf_sh_blue$", [0.03, 0.09, 0.2]],
	],
	"scans": [["^sand_sh", "gravel_floor", SpaLook.GRAVEL_TILE]],
	"tint": [
		["^asph_sh_g1", [1.0, 1.0, 1.0, 0.6]],
		["@lawn", [0.98, 1.08, 0.6]],
		["@forest", SpaLook.FOREST_TINT],
		["^(trees_sh|treeline)", [0.62, 0.6, 0.42]],
	],
	"lawn_re": "^grass_sh(_bank)?$",
	"paint_re": "^$",
	"paint_blue": false,
	"own_re": "^(astroturf_sh|water_sh)",
	"kerb_re": "^curb_sh(_2|_3)?$",
	"fence_re": "^fence_sh$",
	"conifer_re": "(?i)^conifers_none$",
	"detail": [
		["^(wall_sh|sha_wall|Muro|sha_infrastructure_arcwall|aa_|standard_)", "concrete", 2.7],
		["^(grail_sh|sha_barrier)", "metal", 1.0],
		["^(sha_building|orig_sha_building|material_sha_building|sha_hut)", "painted", 2.0],
	],
	"own_wear": true,
	"far_dir": "assets/maps/shanghai",
	"stand_re": "^(aa_3$|aa_1$|standard_2|sha_grandstand_underbrolly_b_0[13])",
	"forest_near_scale": 0.65,
	"forest_hero": 40.0,
	"forest_shadow": 30.0,
}
