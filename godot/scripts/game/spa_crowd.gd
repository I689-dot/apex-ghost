class_name SpaCrowd
extends RefCounted
## Spa's spectators: scanned people (assets/maps/spa_g/crowd_atlas.png; tools/asset-pipeline/spa_godot/render_people.py
## and build_crowd.py) on the grandstands' seating (Crowd.seats_on_stands with Spa's stand materials) and on the banks and
## fences where the reference video has them (crowd_zones.bin). One instanced draw (shaders/spa_crowd.gdshader).

const ATLAS := "res://assets/maps/spa_g/crowd_atlas.png"
const ZONES := "res://assets/maps/spa_g/crowd_zones.bin"
const STAND_MAT_RE := "(?i)^(main-gstand|raidillon-grandstand|seat1)"
const COLUMNS := 10
const ROWS := 3
## The sprite cell's size (m): the figures are 1.75 m in a 1.15 x 2.3 m frame, feet on the bottom edge.
const CELL := Vector2(1.15, 2.3)

static func build(root: Node3D, track: Dictionary, density: float) -> MultiMeshInstance3D:
	if density <= 0.0 or not ResourceLoader.exists(ATLAS):
		return null
	var r := Crowd.Rng.new(98765)
	var spots := Crowd.seats_on_stands(root, track, density, STAND_MAT_RE, r)
	if FileAccess.file_exists(ZONES):
		var f := FileAccess.open(ZONES, FileAccess.READ)
		var n := f.get_length() / 16
		for i in n:
			var x := f.get_float()
			var y := f.get_float()
			var z := f.get_float()
			var yaw := f.get_float()
			if r.next() <= density:
				spots.append([Vector3(x, y, z), yaw])
	if spots.is_empty():
		return null
	var quad := QuadMesh.new()
	quad.size = CELL
	quad.center_offset = Vector3(0, CELL.y / 2.0, 0)
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/spa_crowd.gdshader")
	mat.set_shader_parameter("people", load(ATLAS))
	mat.set_shader_parameter("columns", float(COLUMNS))
	mat.set_shader_parameter("rows", float(ROWS))
	quad.material = mat
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.use_custom_data = true
	mm.mesh = quad
	mm.instance_count = spots.size()
	for i in spots.size():
		var h := 0.94 + r.next() * 0.12
		mm.set_instance_transform(i, Transform3D(Basis(Vector3.UP, spots[i][1]) * Basis.from_scale(Vector3(h, h, h)), spots[i][0]))
		var shade := 0.85 + r.next() * 0.25
		mm.set_instance_color(i, Color(shade, shade, shade))
		mm.set_instance_custom_data(i, Color(floorf(r.next() * COLUMNS), floorf(r.next() * ROWS), 0, 0))
	var out := MultiMeshInstance3D.new()
	out.name = "crowd"
	out.layers = 2
	out.multimesh = mm
	out.custom_aabb = AABB(Vector3(-20000, -2000, -20000), Vector3(40000, 4000, 40000))
	out.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return out
