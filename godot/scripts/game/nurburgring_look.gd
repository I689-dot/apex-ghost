class_name NurburgringLook
extends RefCounted
## The Nürburgring GP's look (the user, 2026-11-18: "the same you did for Spa", with everything Spa used): SpaLook's
## treatment through a profile of the GP model's materials (the web game's model: assets/track). Spa's measured values
## are reused where the surface is the same kind (the clear afternoon's grade, the road's albedo, the kerbs' paint, the
## lawn, the run-off paint), since there is no Nürburgring reference video: the two circuits are 60 km apart in the same
## climate, and the GP's kerbs and paint are the same reds, yellows and greens.
##
## The model's own colours, measured (linear texture means, assets/track): the road layers 0.072 (new), 0.114 (mid),
## 0.144, 0.227 (the run-off): they showed as bands of grey; the kerbs 0.14 / 0.11 / 0.10 (washed-out pink); the
## terrain 0.023 / 0.032 / 0.018 (near black under the forest); the green paint 0.019 / 0.31 / 0.11 (neon).

const PROFILE := {
	"name": "nurburgring",
	# Spa's clear afternoon (the same Eifel / Ardennes sky)
	"env": {"haze": 0.18, "fog": 0.16, "cover": 0.3, "cirrus": 0.2, "sun": 2.2, "ambient": 2.1, "sky": 0.7, "tonemap": "agx", "white": 6.0},
	"draw": [
		["(?i)^(trees|pines|tree[0-9]|fences_b|fence_green|grille|box_fence)", "scissor"],
		["(?i)^(asph|curb|lines|grass|gravel|sand|astroturf|pavement|top2|wall|grail|galvanized|conc_|travert_0|tiles|terrain_fill)", "opaque"],
	],
	# every racing layer and the pit lane: one scanned asphalt (Poly Haven asphalt_track, 4K) at Spa's albedo; the
	# run-off asphalt a shade lighter (older, dustier). The wide run-off aprons are "travert" (the source's name for its
	# run-off asphalt, 3,700 triangles): left out before, they kept the model's pale flat texture beside a dark road
	# (2026-11-19, the user: "important color issues on the road")
	"road_re": "^(asph_(new|mid|old|003|ext_new)|travert_0)",
	"target": [
		["^(asph_ext_new|travert_0)", [0.215, 0.212, 0.21]],
		["^asph_(new|mid|old|003)", SpaLook.ROAD_ALBEDO],
		["^pavement_brick", [0.15, 0.135, 0.11]],
		# the painted concrete strips: Spa's green paint, the kerbs' red
		["^conc_green", [0.006, 0.22, 0.075]],
		["^conc_red", [0.5, 0.085, 0.07]],
		# the artificial turf on the run-off (Mercedes-Arena, the chicane): a turf green, not Spa's green paint (repainted
		# to that it showed as a pale mint beside the lawn)
		["^astroturf", [0.03, 0.085, 0.035]],
		# the terrain under the forest and on the banks: a dark meadow and forest floor, not black
		["^(top2|terrain_fill)", [0.05, 0.068, 0.026]],
		["^gravel_ext", [0.3, 0.24, 0.17]],
		["^(sand_0|sandbrd)", [0.32, 0.25, 0.16]],
	],
	# the gravel traps: the scanned gravel in world space (SpaLook._scan_surface), at its target above
	"scans": [["^(gravel_ext|sand_0)", "gravel_floor", SpaLook.GRAVEL_TILE]],
	"tint": [
		# the GP's lawns are open to the sky (Spa's mostly stand by the forest): Spa's tint came out pale yellow-green
		# (183, 191, 130 on screen against Spa's 114, 127, 85); this one 129, 145, 61, a mown lawn in sun
		["@lawn", [1.0, 1.1, 0.55]],
		["@forest", SpaLook.FOREST_TINT],
		["^(trees|pines|tree[0-9])", [0.57, 0.54, 0.38]],
	],
	"lawn_re": "^(grass_0|grassbrd_gp|grass_fill)",
	"paint_re": "^$",
	"paint_blue": false,
	# painted run-off and strips keep their own texture and grow no 3D grass
	"own_re": "^(astroturf|conc_green|conc_red|travert_grass)",
	"kerb_re": "^(curb_0|curb_b|curbs_new|curb_misc)",
	"fence_re": "^fences_b",
	"conifer_re": "(?i)^(pines|trees1)",
	"detail": [
		["^(walls_new|wall_dorint|wall_pitlane|wall_ringwerk|conc_|tiles)", "concrete", 2.7],
		["^(grail_tess|galvanized|fence_details|metals|metal_wall|metal_white|gantry)", "metal", 1.0],
		["^(building|garage|box_top|box_struct|box_door|marshal|marshall|timetower|paddock_roof|stairs|openstand|concrete_0|medical|pits_0|gs_roof)", "painted", 2.0],
	],
	# the generic rubber and wear decal (the model has no rubber layers of its own)
	"own_wear": false,
	"far_dir": "assets/track",
	# the scanned forest: the Nürburgring's is sparser than Spa's and further from the track
	"forest_near_scale": 0.65,
	"forest_hero": 40.0,
	"forest_shadow": 30.0,
}
