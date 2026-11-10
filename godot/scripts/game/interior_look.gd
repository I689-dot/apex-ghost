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
