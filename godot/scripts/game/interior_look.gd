class_name InteriorLook
extends RefCounted
## Cockpit material fixes for single cars, made in the game (the shared asset config is the web game's). Some downloaded
## cockpits ship a metallic / roughness map that reads as a mirror (full metal, no roughness) and white placeholder
## textures: lit by the sky they look like chrome, where the real car is matt black. Each entry names a material of the
## car's cockpit model and what to do with it: tint (a brightness factor on the albedo), metallic and roughness (a plain
## value replaces the model's metallic / roughness map).

## Off for before / after pictures (tests set it from NO_INTERIOR_FIX); the game never turns it off.
static var enabled := true

const LOOKS := {
	# Aston Martin Vantage GT3: black carbon and Alcantara inside, the cage painted black
	"vantage_gt3_evo_heart_of_racing": {
		"Interior": {"tint": 0.14, "metallic": 0.0, "roughness": 0.85},
		"Chassis": {"tint": 0.13, "metallic": 0.2, "roughness": 0.55},
		# the wheel, dash and console: dark carbon, a soft sheen from the normal map, never a mirror of the sky
		"Cockpit": {"tint": 0.4, "metallic": 0.0, "roughness": 0.6},
	},
}

## Steering wheels modelled into the cockpit's one big mesh: with no wheel node the game would add its stand-in wheel in
## front of them and they could not turn. CarVisual cuts these triangles out into a "steering_rim" of their own. All in
## the car's coordinates: centre and axis (towards the driver) of the wheel; box around centre, along the driver's right,
## the wheel's up and the axis (measured from the mesh's vertices), and the materials the wheel is made of.
const BAKED_WHEELS := {
	"vantage_gt3_evo_heart_of_racing": {
		"centre": Vector3(0.383, 0.725, -0.12), "axis": Vector3(0.0, 0.21, -0.977), "right": 0.152, "up": [-0.10, 0.10],
		"depth": [-0.065, 0.045], "materials": ["Cockpit", "Interior"],
	},
}

## Fixes for every car, by material name (Assetto Corsa's naming, the 2026-11 line-up): its interior maps are shading
## (ambient occlusion over a carbon / plastic detail the original shader adds): exported as the base colour they drew
## white and black blotches (the Audi's "camouflage" cabin, the McLaren's white one). Kept as the shading of a dark trim.
## A car's own LOOKS entry for the material comes first.
const GENERIC := [
	["(?i)^INT_(Carbon|Occlusion)", {"tint": 0.15, "metallic": 0.0, "roughness": 0.6}],
	["(?i)^INT_ELECTRONICS", {"tint": 0.35, "metallic": 0.0, "roughness": 0.55}],
	# carbon left as a plain light grey with no texture (the NASA AMG's: its cage, dash, steering wheel and splitter,
	# 119k triangles, drawn white): the dark of real carbon, a little gloss from its clear coat
	["(?i)^EXT_Carbon$", {"untextured": true, "tint": 0.06, "metallic": 0.1, "roughness": 0.35}],
]
static var _generic_re: Array = []

## The generic fix for a material of any of the car's models (also seen through the windows from outside).
static func apply_generic(car_id: String, sm: StandardMaterial3D) -> void:
	if not enabled or (LOOKS.get(car_id, {}) as Dictionary).has(sm.resource_name):
		return
	if _generic_re.is_empty():
		for g: Array in GENERIC:
			_generic_re.append([RegEx.create_from_string(g[0]), g[1]])
	for g: Array in _generic_re:
		if (g[0] as RegEx).search(sm.resource_name) != null:
			if (g[1] as Dictionary).get("untextured", false) and sm.albedo_texture != null:
				return
			_fix(sm, g[1])
			return

static func _fix(sm: StandardMaterial3D, fix: Dictionary) -> void:
	if fix.has("tint"):
		var f: float = fix.tint
		sm.albedo_color = Color(sm.albedo_color.r * f, sm.albedo_color.g * f, sm.albedo_color.b * f, sm.albedo_color.a)
	if fix.has("metallic"):
		sm.metallic_texture = null
		sm.metallic = fix.metallic
	if fix.has("roughness"):
		sm.roughness_texture = null
		sm.roughness = fix.roughness

## Applies the car's fix for this material of its cockpit model, if it has one.
static func apply(car_id: String, sm: StandardMaterial3D) -> void:
	if not enabled:
		return
	var car: Dictionary = LOOKS.get(car_id, {})
	var fix: Dictionary = car.get(sm.resource_name, {})
	if fix.is_empty():
		return
	if fix.has("tint"):
		var f: float = fix.tint
		sm.albedo_color = Color(sm.albedo_color.r * f, sm.albedo_color.g * f, sm.albedo_color.b * f, sm.albedo_color.a)
	if fix.has("metallic"):
		sm.metallic_texture = null
		sm.metallic = fix.metallic
	if fix.has("roughness"):
		sm.roughness_texture = null
		sm.roughness = fix.roughness
