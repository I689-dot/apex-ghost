class_name BarcelonaLook
extends RefCounted
## Barcelona-Catalunya's look (the user, 2026-11-19: the new circuit with "super hyper realistic graphics"): SpaLook's
## treatment through a profile of the model's materials (tools/asset-pipeline/circuit/barcelona.json names them
## asph_bc_*, curb_bc ...), as for Silverstone and Zandvoort. Spa's measured values stand in where the surface is the
## same kind; the light is a dry Mediterranean afternoon (clear, little haze, a harder sun) over a drier lawn.
##
## The model's own colours, measured (the render's materials.json): the racing surface asph_bc_road 0.19 (128 x 512 px
## strips), the paddock and run-off asph_bc_fill 0.06, the old chicane asph_bc_old 0.16; the run-off paints (green, red,
## yellow, pink) all a flat 0.6 grey (the export lost the colour their Assetto Corsa shader gave a white detail
## texture); the lawn 0.06; the gravel 0.28 / 0.25 / 0.21.

const PROFILE := {
	"name": "barcelona",
	# a dry, clear Catalan afternoon: a little less haze and cloud than Spa's, the same sun and grade
	"env": {"haze": 0.12, "fog": 0.12, "cover": 0.2, "cirrus": 0.25, "sun": 2.25, "ambient": 2.05, "sky": 0.72, "tonemap": "agx", "white": 6.0},
	"draw": [
		# the source's rubber and pit skid marks: decals over the road
		["(?i)^asph_bc_g", "blend"],
		["(?i)^(trees_bc|fence_bc|lines_bc_(edge|green|red|w5))", "scissor"],
		["(?i)^(asph|curb|lines|grass|sand|pavement|top2|wall_|grail)", "opaque"],
	],
	# the racing surface, the 2023 piece and the paddock / run-off asphalt: one scanned asphalt
	"road_re": "^asph_bc_(road|old|fill|patch|patch2)$",
	"target": [
		["^asph_bc_(road|old|patch2)$", SpaLook.ROAD_ALBEDO],
		["^asph_bc_(fill|patch)$", [0.205, 0.202, 0.2]],
		# the painted run-off: green, red, yellow and pink paint on asphalt (as Spa's green paint and kerb red)
		["^asph_bc_paint_green", [0.006, 0.22, 0.075]],
		["^asph_bc_paint_red", [0.5, 0.085, 0.07]],
		["^asph_bc_paint_yellow", [0.5, 0.42, 0.05]],
		["^asph_bc_paint_pink", [0.5, 0.18, 0.28]],
		["^pavement_bc_conc2$", [0.3, 0.29, 0.26]],
		# the gravel: Catalan gravel is a warm, pale limestone
		["^sand_bc$", [0.36, 0.32, 0.25]],
		["^sand_bc_(border|soil)$", [0.33, 0.28, 0.2]],
		# the satellite photo of the surroundings: dry scrub and fields
		["^top2_bc", [0.11, 0.1, 0.07]],
	],
	"scans": [["^sand_bc$", "gravel_floor", SpaLook.GRAVEL_TILE]],
	"tint": [
		["^asph_bc_g1", [1.0, 1.0, 1.0, 0.6]],
		# the lawn under a Mediterranean sun: drier and yellower than Spa's
		["@lawn", [1.05, 1.05, 0.52]],
		["@forest", SpaLook.FOREST_TINT],
		["^trees_bc", [0.62, 0.6, 0.42]],
	],
	"lawn_re": "^grass_bc$",
	"paint_re": "^$",
	"paint_blue": false,
	# the paint and the ivy keep their own colour and grow no 3D grass
	"own_re": "^(asph_bc_paint|trees_bc_ivy)",
	"kerb_re": "^curb_bc(_2|_3)?$",
	"fence_re": "^fence_bc$",
	# the stone pines round the circuit
	"conifer_re": "(?i)^trees_bc_pines",
	"detail": [
		["^(wall_bc$|wall_bc_(concrete|safer|safer2|barrier)|GRANDSTAND_BASE|GSTANDS|BOX_1|pavement_bc)", "concrete", 2.7],
		["^(grail_bc|METAL_BASE|GARAGE_METAL_BASE|STRUCTURE_BASE)", "metal", 1.0],
	],
	"own_wear": true,
	"far_dir": "assets/maps/barcelona",
	"stand_re": "^(GSTANDS-BASE3|GRANDSTAND_BASE)",
	"forest_near_scale": 0.65,
	"forest_hero": 40.0,
	"forest_shadow": 30.0,
}
