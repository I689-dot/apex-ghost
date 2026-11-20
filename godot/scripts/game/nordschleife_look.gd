class_name NordschleifeLook
extends RefCounted
## The 24h layout's look (the GP and the Nordschleife; map "nordschleife"): the GP model carries NurburgringLook's
## materials and the Nordschleife model (the web game's, assets/maps/nordschleife) its own few generated ones, so this
## is NurburgringLook.PROFILE with the Nordschleife's added: asph_ns on the scanned road at Spa's albedo (its texture a
## flat 0.10 grey noise), grass_ns as lawn, curb_ns repainted, the barriers' metal grain, and Spa's forest limits (the
## Nordschleife runs through forest for most of its 20 km, as Spa does). Before 2026-11-19 the layout had no look at
## all, the GP stretch included.

static var _profile: Dictionary = {}

static func profile() -> Dictionary:
	if not _profile.is_empty():
		return _profile
	var p: Dictionary = NurburgringLook.PROFILE.duplicate(true)
	p["name"] = "nordschleife"
	p["road_re"] = "^(asph_(new|mid|old|003|ext_new|ns$)|travert_0)"
	(p["target"] as Array).push_front(["^asph_ns$", [0.19, 0.19, 0.195]])
	p["lawn_re"] = "^(grass_0|grassbrd_gp|grass_fill|grass_ns)"
	p["kerb_re"] = "^(curb_0|curb_b|curbs_new|curb_misc|curb_ns)"
	(p["detail"] as Array).push_front(["^(galvanized_ns|grail_ns)$", "metal", 1.0])
	# the Nordschleife's kerbs take the GP kerbs' grain too (2026-11-20: they were repainted but had none)
	(p["detail"] as Array).push_front(["^curb_ns$", "concrete", 1.6])
	# the far terrain about the whole lap (build_far.py with FAR_MODEL_DIRS=godot/assets/track)
	p["far_dir"] = "assets/maps/nordschleife"
	p["forest_near_scale"] = SpaLook.FOREST_NEAR_SCALE
	p["forest_hero"] = SpaLook.FOREST_HERO
	p["forest_shadow"] = SpaLook.FOREST_SHADOW
	_profile = p
	return p
