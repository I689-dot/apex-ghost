class_name SilverstoneLook
extends RefCounted
## Silverstone's look (the user, 2026-11-19: the new map "super ultra mega hiper realistic"): SpaLook's treatment through
## a profile of the model's materials (tools/asset-pipeline/silverstone/prep.py names them asph_ss_*, curb_ss, ...).
## Spa's measured values are reused where the surface is the same kind (the scanned asphalt at Spa's albedo, the kerbs'
## paint, the lawn), as for the Nürburgring: there is no Silverstone reference video. Silverstone is an old airfield in
## open farmland (the far terrain's cover: 41 % crops, 39 % grass, 16 % trees), so a brighter, hazier English summer sky
## than the Ardennes and few trees near the track.
##
## The model's own colours, measured (linear texture means): the road atlas 0.154 (its painted edge lines are drawn by
## prep.py's lines_ss strips once the scanned asphalt covers it), the run-off half of the atlas the same, the rubber
## decals 0.063 / 0.017 / 0.011 at alpha 0.28 / 0.11 / 0.06, the kerbs 0.43 / 0.37 / 0.35 (washed-out red and white),
## the lawn 0.59 / 0.64 / 0.50 (pale), the gravel 0.32 / 0.30 / 0.23, the concrete pavement 0.78 (white).

const PROFILE := {
	"name": "silverstone",
	# an English summer afternoon: a little more haze and cumulus than Spa's clear Ardennes sky
	"env": {"haze": 0.22, "fog": 0.14, "cover": 0.38, "cirrus": 0.25, "sun": 2.2, "ambient": 2.15, "sky": 0.72, "tonemap": "agx", "white": 6.0},
	"draw": [
		# the source's rubber (a racing groove and the braking zones' marks): black decals whose alpha is the rubber
		["(?i)^asph_ss_g", "blend"],
		["(?i)^(trees_ss|fence_ss|flag|miscalpha|transp|glass_transp)", "scissor"],
		["(?i)^(asph|curb|lines|grass|sand|pavement|top2|wall_|grail)", "opaque"],
	],
	# the racing surface: the scanned asphalt at Spa's albedo; the pit lane keeps its painted texture
	"road_re": "^asph_ss_road$",
	"target": [
		["^asph_ss_road$", [0.19, 0.19, 0.195]],
		# the run-off: older, dustier asphalt (keeps the atlas: its green paint strip and the pit lane's markings)
		["^asph_ss_runoff", [0.2, 0.198, 0.195]],
		["^pavement_ss(_b)?$", [0.21, 0.21, 0.205]],
		# the gravel traps: Silverstone's are pale (a washed flint gravel)
		["^sand_ss$", [0.34, 0.3, 0.22]],
		# the gravel traps' borders and the concrete pavement are the source's white base textures (Assetto Corsa's
		# multi-layer shader coloured them; their alpha is a specular mask): drawn as they are they glared white
		["^sand_ss_border", [0.3, 0.27, 0.2]],
		# the farmland round the circuit's own terrain: summer grass and crop, not the source's grey-olive
		["^top2_ss", [0.06, 0.075, 0.03]],
	],
	"tint": [
		# the rubber: the groove at 60 % (it covered the racing line in one dark band), the braking marks in full
		["^asph_ss_g1", [1.0, 1.0, 1.0, 0.6]],
		# the edge lines: geometry over the scanned asphalt (white paint, not glossy)
		["^lines_ss", [1.0, 1.0, 1.0]],
		["@lawn", [1.0, 1.08, 0.58]],
		["@forest", [0.27, 0.31, 0.16]],
		["^trees_ss", [0.6, 0.58, 0.4]],
	],
	"lawn_re": "^grass_ss(_nm)?$",
	# no painted run-off of its own (the run-off's paint is in the asphalt atlas)
	"paint_re": "^$",
	"paint_blue": false,
	"own_re": "^$",
	"kerb_re": "^(curb_ss|curb_ss_new)$",
	"fence_re": "^fence_ss2?$",
	# the source's trees are broadleaf (oak, ash and poplar lines between the fields)
	"conifer_re": "(?i)^conifers_none$",
	"detail": [
		["^(wall_ss$|wall_ss_jersey)", "concrete", 2.7],
		["^(grail_ss|metals1)", "metal", 1.0],
		["^(curb_ss|curb_ss_new)$", "concrete", 1.6],
		["^(structures|box1|box2|gstands1|bridges|NewBridge\\.concrete|HotelConcrete|marshall)", "painted", 2.0],
	],
	"own_wear": true,
	"far_dir": "assets/maps/silverstone",
	# the crowd on the grandstands
	"stand_re": "(?i)^gstands1",
	# the scanned forest only where the source planted its tree lines; they stand well back from the track
	"forest_near_scale": 0.7,
	"forest_hero": 40.0,
	"forest_shadow": 30.0,
}
