class_name SpaFar
extends Node3D
## The hills around Spa that the source model lacks: a ring of real terrain from the model's edge out to 9.5 km
## (tools/asset-pipeline/spa_godot/build_far.py: Copernicus heights, ESA WorldCover land cover), coloured by
## shaders/far_terrain.gdshader. Two meshes: "far_hi" for High and Ultra, "far_lo" (3x coarser) below.

## (the files are in the circuit's folder: assets/maps/spa_g for Spa, assets/track for the Nürburgring GP)
## The finer mesh from this scenery distance (the "view distance" group: High 1500 m, Ultra 4500 m).
const HI_FROM := 1500.0

var _hi: MeshInstance3D
var _lo: MeshInstance3D

## The far terrain, or null when it has not been built.
static func build(dir: String = "assets/maps/spa_g") -> SpaFar:
	var FILE := dir + "/far_terrain.glb"
	var COVER := "res://" + dir + "/far_cover.png"
	if not ResourceLoader.exists(Assets.path(FILE)):
		return null
	var packed := Assets.scene(FILE)
	if packed == null:
		return null
	var out := SpaFar.new()
	out.name = "spa-far"
	var scene := packed.instantiate()
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/far_terrain.gdshader")
	if ResourceLoader.exists(COVER):
		mat.set_shader_parameter("cover", load(COVER))
	for n in CarVisual._walk(scene):
		if n is MeshInstance3D:
			var mi := n as MeshInstance3D
			mi.material_override = mat
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			if String(mi.name).begins_with("far_hi"):
				out._hi = mi
			elif String(mi.name).begins_with("far_lo"):
				out._lo = mi
	out.add_child(scene)
	return out

func apply_quality(q: Dictionary) -> void:
	var hi: bool = float(q.get("sceneryDistance", 0.0)) >= HI_FROM
	if _hi != null:
		_hi.visible = hi or _lo == null
	if _lo != null:
		_lo.visible = not hi or _hi == null
