class_name ZandvoortLook
extends RefCounted
## Zandvoort's look (the user, 2026-11-19: "important color issues on the road" and "ultra realistic zandvoort"):
## SpaLook's treatment through a profile of the web game's Zandvoort model (assets/maps/zandvoort, material names
## asph_zv42 ...), as for the Nürburgring GP and Silverstone. Spa's measured values are reused where the surface is the
## same kind: there is no Zandvoort reference video.
##
## The model's own colours, measured (linear texture means): the racing surface asph_zv42 0.055 (128 x 64 px: drawn as
## it is, near-black with blurred bands), the run-off and pit asphalt asph_zv96 0.24 (four times as light: the two
## showed as a black road in a grey apron), the rubber decals asph_zv61 0.05 at alpha 0.25 and the skid marks asph_zv60;
## the lawn grass_zv97 0.105 / 0.115 / 0.051; the dunes' own textures (sand, marram grass, an aerial photo of the dune
## scrub: grass_zv24 / 31 / 51 / 66 / 81) 0.2-0.47; the gravel 0.41 / 0.30 / 0.16 (orange).

const PROFILE := {
	"name": "zandvoort",
	# a clear afternoon on the North Sea coast: more haze (sea air) than the Ardennes, the same sun and grade
	"env": {"haze": 0.26, "fog": 0.17, "cover": 0.32, "cirrus": 0.3, "sun": 2.2, "ambient": 2.1, "sky": 0.68, "tonemap": "agx", "white": 6.0},
	"draw": [
		# the source's rubber, skid marks and the soft edges where the dunes meet the lawn: decals over what is under them
		["(?i)^(asph_zv6[01]|grass_zv(55|71|74))$", "blend"],
		["(?i)^(Dado_LW_041_87|fence_zv|grille)", "scissor"],
		["(?i)^(asph|curb|lines|grass|gravel|conc|pavement|tiles|top2|wall_|galvanized|tyrewall)", "opaque"],
	],
	# the racing surface and the run-off / pit apron: one scanned asphalt
	"road_re": "^asph_zv(42|96)$",
	"target": [
		# the two asphalts: asph_zv96 is the run-off and the pit apron, and the racing surface in places too (the banked
		# turns): one albedo for both
		["^asph_zv(42|96)$", [0.19, 0.19, 0.195]],
		["^conc_zv", [0.2, 0.19, 0.17]],
		# the gravel traps: Zandvoort's gravel is pale, near the dunes' sand
		["^gravel_zv43$", [0.36, 0.31, 0.21]],
		# the dunes: sand and dry marram grass, lighter and yellower than the model's
		["^grass_zv(51|66)$", [0.3, 0.26, 0.18]],
		["^grass_zv24$", [0.3, 0.27, 0.19]],
	],
	# the gravel traps: the scanned gravel in world space (SpaLook._scan_surface), at its target above
	"scans": [["^gravel_zv43$", "gravel_floor", 1.5]],
	"tint": [
		# the rubber: the band down the racing line at half strength (it darkened the road in one long stripe), the
		# skid marks in full
		["^asph_zv61$", [1.0, 1.0, 1.0, 0.5]],
		# the lawn by the sea: a little drier than Spa's
		["@lawn", [1.0, 1.06, 0.56]],
		["@forest", [0.27, 0.31, 0.16]],
		["^Dado_LW_041_87", [0.62, 0.6, 0.42]],
	],
	"lawn_re": "^(grass_zv97|grass_fill)$",
	"paint_re": "^$",
	"paint_blue": false,
	# the dunes keep their own textures and grow no mown 3D grass
	"own_re": "^grass_zv(24|31|51|55|66|71|74|81)$",
	"kerb_re": "^curb_zv(25|44|48)$",
	"fence_re": "^fence_zv68$",
	"conifer_re": "(?i)^conifers_none$",
	"detail": [
		["^(wall_zv|conc_zv|struct_zv)", "concrete", 2.7],
		["^(galvanized_zv|grille_zv)", "metal", 1.0],
		["^curb_zv(25|44|48)$", "concrete", 1.6],
	],
	"own_wear": true,
	"far_dir": "assets/maps/zandvoort",
	# the crowd on the grandstands' blue seats
	"stand_re": "^Dado_LW_041_1[01]$",
	# (single seats: one person a seat pan, Crowd.seats_on_stands)
	"seat_m": 0.55,
	"forest_near_scale": 0.65,
	"forest_hero": 40.0,
	"forest_shadow": 30.0,
}
