class_name CarPaint
extends RefCounted
## The cars' paint and their brand-free look (the user, 2026-11-16: no brands anywhere, cars customisable):
## - the livery material becomes shaders/car_paint.gdshader in the driver's colours, design, finish and race number;
## - decals, banners, stickers, logos and number plates are not drawn;
## - rims and calipers take the driver's colours, without their textures (and their makers' marks);
## - tyres are plain rubber (no sidewall lettering).
## A livery: {base, accent, finish, design, aero, number, showNumber, numberColor, rims, calipers} (Settings' "livery").

const SHADER := preload("res://shaders/car_paint.gdshader")
const DESIGNS := ["plain", "stripes", "twotone", "fade", "side", "hoop", "center", "chevron", "pinstripe", "split"]
## The wing, splitter, sills and diffuser: bare carbon, the body's colour, or the second colour.
const AERO := ["carbon", "body", "accent"]
const FINISHES := {
	"gloss": {"metallic": 0.0, "roughness": 0.28, "clearcoat": 1.0, "pearl": 0.0, "flakes": 0.0},
	"metallic": {"metallic": 0.65, "roughness": 0.32, "clearcoat": 1.0, "pearl": 0.0, "flakes": 1.0},
	"matte": {"metallic": 0.0, "roughness": 0.62, "clearcoat": 0.0, "pearl": 0.0, "flakes": 0.0},
	"pearl": {"metallic": 0.35, "roughness": 0.3, "clearcoat": 1.0, "pearl": 0.6, "flakes": 0.6},
}
## The colours bots and other drivers get (by their id): racing colours that read well against the circuits.
const PALETTE := ["#c8102e", "#0a3d91", "#f2f2f2", "#111214", "#ffb000", "#00843d", "#ff5f00", "#5b2c83", "#00a3e0", "#9a9fa5", "#7a0019", "#e4002b", "#1d428a", "#ffd60a", "#2e7d32", "#ff6fae"]

## The paint material(s) of each model (by model id) when the name does not say it.
const PAINT_MATS := {
	"ferrari_296_gt3_verstappen": ["mat_220"],
	"bmw_m4_gt3_vecarz": ["BODY"],
	"vantage_gt3_evo_heart_of_racing": ["Body"],
}
const TYRE_MATS := {"ferrari_296_gt3_verstappen": ["mat_75"]}
## Label sheets and straps that are mostly lettering (seat belts, safety nets, display and switch labels full of
## suppliers' names): drawn in one plain dark colour. By name, and per model for anonymous materials.
const PLAIN_MATS := {
	"ferrari_296_gt3_verstappen": ["mat_46", "mat_215", "mat_216", "mat_217", "mat_47"],
	"bmw_m4_gt3_evo_2026": ["FUEL_LCD"],
}
static var _plain_re := RegEx.create_from_string("(?i)belt|schroth|^INT_NET$|lumi|_SAS$|^INT_SAS|INT_DETAILS_TEXT|INT_Details_2|LED_STEER|^Material_25$")

## Materials with brands or the model's own race number, not drawn (anonymous ones the name rules cannot see).
const HIDE_MATS := {"ferrari_296_gt3_verstappen": ["mat_73"]}
const RIM_MATS := {"ferrari_296_gt3_verstappen": ["mat_235", "mat_36"]}

static var _paint_re := RegEx.create_from_string("(?i)carpaint|livery")
static var _hide_re := RegEx.create_from_string("(?i)decal|banner|sticker|logo|number_?plate|badge|emblem")
static var _tyre_re := RegEx.create_from_string("(?i)tyre|tire|rubber|pneu")
static var _disc_re := RegEx.create_from_string("(?i)disc|disk|rotor")
static var _hidden: ShaderMaterial
static var _cull_off_shader: Shader

## The default livery for a driver who has not chosen one (bots, other players): from their id, so it stays the same.
static func livery_for(id: String, number: int = -1) -> Dictionary:
	var h := hash(id)
	var base: String = PALETTE[absi(h) % PALETTE.size()]
	var accent: String = PALETTE[absi(h / 17) % PALETTE.size()]
	if accent == base:
		accent = "#f2f2f2" if base != "#f2f2f2" else "#111214"
	return {
		"base": base, "accent": accent, "finish": ["gloss", "metallic", "pearl", "gloss"][absi(h / 7) % 4],
		"design": DESIGNS[absi(h / 3) % DESIGNS.size()], "number": number if number >= 0 else 2 + absi(h / 11) % 97,
		"aero": AERO[absi(h / 19) % 2], "showNumber": true, "numberColor": "#111214" if Color(base).get_luminance() > 0.6 else "#ffffff",
		"rims": ["#1c1c1e", "#9a9fa5", "#c9a227", "#f2f2f2"][absi(h / 5) % 4], "calipers": ["#ffd60a", "#c8102e", "#1c1c1e"][absi(h / 13) % 3],
	}

## Paints a car (all its levels and its cockpit model). Call again with a new livery to repaint it.
static func apply(visual: CarVisual, livery: Dictionary) -> void:
	var mid := CarVisual.model_id(visual.entry)
	var paint_names: Array = PAINT_MATS.get(mid, [])
	var number_tex := _number_texture(visual, livery)
	var aabb := _body_box(visual)
	var fin: Dictionary = FINISHES.get(livery.get("finish", "gloss"), FINISHES.gloss)
	for n in CarVisual._walk(visual):
		if not (n is MeshInstance3D) or (n as MeshInstance3D).mesh == null:
			continue
		var mi := n as MeshInstance3D
		var node_name := String(mi.name) + "|" + String(mi.get_parent().name if mi.get_parent() else "")
		var in_caliper := node_name.contains("caliper")
		var in_spin := node_name.contains("spin")
		for s in mi.mesh.get_surface_count():
			var m := mi.get_active_material(s)
			var nm: String = m.get_meta("paint_src_name", m.resource_name) if m != null else ""
			if m is ShaderMaterial and m.has_meta("car_paint"):
				# already painted: new colours
				_set_paint(m as ShaderMaterial, livery, fin, number_tex, visual, mi, aabb)
				continue
			if not (m is StandardMaterial3D):
				continue
			var sm := m as StandardMaterial3D
			if _hide_re.search(nm) != null or (HIDE_MATS.get(mid, []) as Array).has(nm):
				mi.set_surface_override_material(s, _hidden_mat())
			elif paint_names.has(nm) or (_paint_re.search(nm) != null and not nm.begins_with("LIGHT_")):
				var pm := ShaderMaterial.new()
				if sm.cull_mode == BaseMaterial3D.CULL_DISABLED:
					pm.shader = _cull_off()
				else:
					pm.shader = SHADER
				pm.set_meta("car_paint", true)
				pm.set_meta("paint_src_name", nm)
				if sm.normal_enabled and sm.normal_texture != null:
					pm.set_shader_parameter("normal_tex", sm.normal_texture)
					pm.set_shader_parameter("has_normal", true)
					pm.set_shader_parameter("normal_depth", sm.normal_scale)
				_set_paint(pm, livery, fin, number_tex, visual, mi, aabb)
				mi.set_surface_override_material(s, pm)
			elif _plain_re.search(nm) != null or (PLAIN_MATS.get(mid, []) as Array).has(nm):
				_flat(sm, Color(0.11, 0.11, 0.12), 0.0, 0.8)
			elif in_caliper or (in_spin and (RIM_MATS.get(mid, []) as Array).has(nm)):
				_flat(sm, Color(livery.get("calipers" if in_caliper else "rims", "#1c1c1e")), 0.45 if in_caliper else 0.6, 0.35)
			elif _tyre_re.search(nm) != null or (TYRE_MATS.get(mid, []) as Array).has(nm):
				_flat(sm, Color(0.045, 0.045, 0.05), 0.0, 0.88)
			elif in_spin and _disc_re.search(nm) == null and not sm.resource_name.begins_with("LIGHT_"):
				# the rim's other parts (spokes, the motion-blurred rim)
				_flat(sm, Color(livery.get("rims", "#1c1c1e")), 0.6, 0.35)
	visual.apply_dents()

static func _flat(sm: StandardMaterial3D, col: Color, metallic: float, roughness: float) -> void:
	sm.albedo_texture = null
	sm.albedo_color = Color(col, sm.albedo_color.a)
	sm.metallic_texture = null
	sm.metallic = metallic
	sm.roughness_texture = null
	sm.roughness = roughness

static func _set_paint(pm: ShaderMaterial, livery: Dictionary, fin: Dictionary, number_tex: Texture2D, visual: CarVisual, mi: MeshInstance3D, box: AABB) -> void:
	pm.set_shader_parameter("base_color", Color(livery.get("base", "#c8102e")))
	pm.set_shader_parameter("accent_color", Color(livery.get("accent", "#f2f2f2")))
	pm.set_shader_parameter("design", maxi(0, DESIGNS.find(livery.get("design", "plain"))))
	pm.set_shader_parameter("metallic_v", fin.metallic)
	pm.set_shader_parameter("roughness_v", fin.roughness)
	pm.set_shader_parameter("clearcoat_v", fin.clearcoat)
	pm.set_shader_parameter("pearl", fin.pearl)
	pm.set_shader_parameter("flakes", fin.get("flakes", 0.0))
	# the aero (the livery's "aero"): the wing all of it, the lowest band of the body too; carbon, or painted in
	# the second colour; "body": no trim
	var aero: String = livery.get("aero", "carbon")
	var trimmed := aero != "body"
	pm.set_shader_parameter("trim_all", trimmed and String(mi.name) == "part_wing")
	pm.set_shader_parameter("trim_height", 0.11 if trimmed else 0.0)
	pm.set_shader_parameter("trim_paint", aero == "accent")
	pm.set_shader_parameter("trim_color", Color(livery.get("accent", "#f2f2f2")) if aero == "accent" else Color(0.035, 0.037, 0.04))
	pm.set_shader_parameter("show_number", bool(livery.get("showNumber", true)))
	pm.set_shader_parameter("number_tex", number_tex)
	# mesh space -> car space (the visual's own frame)
	var to_car := visual.global_transform.affine_inverse() * mi.global_transform if mi.is_inside_tree() and visual.is_inside_tree() else _rel(visual, mi)
	pm.set_shader_parameter("to_car", Projection(to_car))
	pm.set_shader_parameter("box", Vector4(maxf(0.5, maxf(absf(box.position.x), absf(box.end.x))), box.position.y, box.end.y, box.position.z))
	pm.set_shader_parameter("box_front", box.end.z)
	var e := visual.entry
	var fz: float = e.wheels.FL.position[2]
	var rz: float = e.wheels.RL.position[2]
	var wb := fz - rz
	# the door number just behind the front wheel, half way up the body; the bonnet's over the front axle
	pm.set_shader_parameter("door_number", Vector3(fz - wb * 0.36, box.position.y + (box.end.y - box.position.y) * 0.42, minf(0.5, (box.end.y - box.position.y) * 0.4)))
	pm.set_shader_parameter("hood_number", Vector2(fz - 0.1, 0.5))

## A node's transform relative to the visual, outside the tree.
static func _rel(visual: Node3D, n: Node3D) -> Transform3D:
	var t := Transform3D.IDENTITY
	var cur: Node = n
	while cur != null and cur != visual:
		if cur is Node3D:
			t = (cur as Node3D).transform * t
		cur = cur.get_parent()
	return t

## The body's box in car space (all levels' body meshes; the first level is enough).
static func _body_box(visual: CarVisual) -> AABB:
	var out := AABB()
	var first := true
	for n in CarVisual._walk(visual):
		if not (n is MeshInstance3D) or (n as MeshInstance3D).mesh == null:
			continue
		var mi := n as MeshInstance3D
		if String(mi.name) == "body" or (mi.get_parent() != null and String(mi.get_parent().name) == "body"):
			var b := _rel(visual, mi) * mi.mesh.get_aabb()
			out = b if first else out.merge(b)
			first = false
	if first:
		var d: Dictionary = visual.entry.dims
		out = AABB(Vector3(-d.width / 2.0, 0.0, -d.length / 2.0), Vector3(d.width, d.height, d.length))
	return out

## The race number, drawn once into a small texture (a viewport of the car's own).
static func _number_texture(visual: CarVisual, livery: Dictionary) -> Texture2D:
	var vp := visual.get_node_or_null("number_vp") as SubViewport
	if vp == null:
		vp = SubViewport.new()
		vp.name = "number_vp"
		vp.size = Vector2i(256, 256)
		vp.transparent_bg = true
		vp.disable_3d = true
		var l := Label.new()
		l.name = "n"
		l.size = Vector2(256, 256)
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		l.add_theme_font_override("font", UIKit.font(true, 800))
		l.add_theme_font_size_override("font_size", 190)
		l.add_theme_constant_override("outline_size", 22)
		vp.add_child(l)
		visual.add_child(vp)
	var lab := vp.get_node("n") as Label
	var col := Color(livery.get("numberColor", "#ffffff"))
	lab.text = str(int(livery.get("number", 7)))
	lab.add_theme_color_override("font_color", col)
	lab.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.85) if col.get_luminance() > 0.5 else Color(1, 1, 1, 0.85))
	vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	return vp.get_texture()

static func _hidden_mat() -> ShaderMaterial:
	if _hidden == null:
		var sh := Shader.new()
		sh.code = "shader_type spatial;\nrender_mode unshaded, depth_draw_never, cull_disabled;\nvoid vertex() { POSITION = vec4(2.0, 2.0, 2.0, 1.0); }\nvoid fragment() { discard; }\n"
		_hidden = ShaderMaterial.new()
		_hidden.shader = sh
	return _hidden

static func _cull_off() -> Shader:
	if _cull_off_shader == null:
		_cull_off_shader = Shader.new()
		_cull_off_shader.code = SHADER.code.replace("cull_back", "cull_disabled")
	return _cull_off_shader
