class_name DashDisplays
extends Node
## Live data on the cockpit's own screens, as a GT3 dash shows it (port of game/dashDisplay.ts): the big gear, shift
## lights, last lap and the delta, TC and ABS, brake bias as an offset from 50 %, fuel, the four tyre pressures. The
## car's display meshes keep their shape; their picture is a SubViewport drawn here, projected onto them.

## Display materials in the cars' cockpits (Assetto Corsa's naming: DISPLAY the dash, DISPLAY_SAS the wheel's).
const DASH_RE := "(?i)^(display(_\\d+)?|lexgt3_display|int_display(_\\d+)?|screen|mi_.*cockpit_screen)$"
const WHEEL_RE := "(?i)^display_sas(_\\d+)?$"
## The models' own digit overlays in front of a screen (Assetto Corsa's "digital instruments"): hidden under ours.
const OVERLAY_RE := "(?i)^(phisics_dash(_\\d+)?|display_trans)$"

## Screens that the model draws as plain black glass (no display material to project onto): a lit quad is put on them.
## pos / normal in the car's coordinates (found with tests/cockpit_probe.gd), size in metres, view = the canvas in pixels.
const OVERLAYS := {
	"vantage_gt3_evo_heart_of_racing": [
		{"kind": "aston", "pos": Vector3(0.385, 0.777, 0.174), "normal": Vector3(0.0, 0.14, -0.99), "size": Vector2(0.128, 0.077), "view": Vector2i(640, 384)},
	],
	# Ferrari 296 GT3 (a Sketchfab export: its screens are faces of the dash mesh, no display material): the Bosch dash
	# in the middle and the two side screens (probed with tests/cockpit_probe.gd from the race's eye)
	"ferrari_296_gt3_verstappen": [
		{"kind": "dash", "pos": Vector3(0.332, 0.737, 0.788), "normal": Vector3(0.0, 0.171, -0.985), "size": Vector2(0.15, 0.097), "view": Vector2i(640, 414)},
		{"kind": "wheel", "pos": Vector3(0.558, 0.777, 0.751), "normal": Vector3(-0.328, 0.263, -0.907), "size": Vector2(0.09, 0.056), "view": Vector2i(384, 240)},
		{"kind": "wheel", "pos": Vector3(0.099, 0.776, 0.758), "normal": Vector3(0.333, 0.253, -0.909), "size": Vector2(0.09, 0.056), "view": Vector2i(384, 240)},
	],
}

var screens: Array = []  # {view: SubViewport, ctl: Screen, kind}
var _t := 0.0

func _init(root: Node3D) -> void:
	var dash_re := RegEx.create_from_string(DASH_RE)
	var wheel_re := RegEx.create_from_string(WHEEL_RE)
	var overlay_re := RegEx.create_from_string(OVERLAY_RE)
	var seen := {}
	var meshes: Array = []
	for n: Node in CarVisual._walk(root):
		if n is MeshInstance3D and (n as MeshInstance3D).mesh != null:
			meshes.append(n)
	for mi: MeshInstance3D in meshes:
		var mesh := mi.mesh
		var new_mesh: ArrayMesh = null
		var lits := {}
		for s in mesh.get_surface_count():
			var m := mi.get_surface_override_material(s)
			if m == null:
				m = mesh.surface_get_material(s)
			if m == null:
				continue
			var kind := ""
			if wheel_re.search(m.resource_name) != null:
				kind = "wheel"
			elif dash_re.search(m.resource_name) != null:
				kind = "dash"
			if kind == "":
				continue
			var sc: Dictionary
			if seen.has(m):
				sc = seen[m]
			else:
				sc = _make_screen(kind)
				seen[m] = sc
				screens.append(sc)
			var uv := _project_uv(mi, s, root, sc.view.size.x / float(sc.view.size.y))
			if uv.is_empty():
				continue
			if new_mesh == null:
				new_mesh = _copy_mesh(mesh)
			# replace the surface's UVs and material
			var arrays := new_mesh.surface_get_arrays(s)
			arrays[Mesh.ARRAY_TEX_UV] = uv
			var rebuilt := ArrayMesh.new()
			for k in new_mesh.get_surface_count():
				if k == s:
					rebuilt.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
				else:
					rebuilt.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, new_mesh.surface_get_arrays(k))
				rebuilt.surface_set_material(k, new_mesh.surface_get_material(k))
			# a lit screen: unaffected by the cabin's shading
			var lit := StandardMaterial3D.new()
			lit.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			lit.albedo_texture = sc.view.get_texture()
			lit.resource_name = m.resource_name
			rebuilt.surface_set_material(s, lit)
			lits[s] = lit
			new_mesh = rebuilt
		if new_mesh != null:
			mi.mesh = new_mesh
			for s in lits:
				mi.set_surface_override_material(s, lits[s])
	if not screens.is_empty() and screens.any(func(sc): return sc.kind == "dash"):
		for mi: MeshInstance3D in meshes:
			for s in mi.mesh.get_surface_count():
				var m := mi.get_surface_override_material(s)
				if m == null:
					m = mi.mesh.surface_get_material(s)
				if m != null and overlay_re.search(m.resource_name) != null:
					# the overlay's surface only: a model that merges its parts into one mesh (the Porsche's whole body)
					# vanished when the mesh was hidden
					mi.set_surface_override_material(s, _hidden_mat())
	_add_overlays(root)

## A lit quad over a screen the model has as plain glass (OVERLAYS), in the cockpit model so it is only seen from inside.
func _add_overlays(root: Node3D) -> void:
	if not (root is CarVisual) or not InteriorLook.enabled:
		return
	var car := root as CarVisual
	var cockpit := car.cockpit_root()
	if cockpit == null:
		return
	for o in OVERLAYS.get(CarVisual.model_id(car.entry), []):
		var sc := _make_screen(o.kind, o.view)
		screens.append(sc)
		var n: Vector3 = (o.normal as Vector3).normalized()
		var right := Vector3(-1, 0, 0)
		right = (right - n * right.dot(n)).normalized()
		var up := n.cross(right)
		# a hair in front of the glass, facing the driver; the quad's +X is the driver's right (the car's -X)
		var in_car := Transform3D(Basis(right, up, n), (o.pos as Vector3) + n * 0.0015)
		var quad := QuadMesh.new()
		quad.size = o.size
		var lit := StandardMaterial3D.new()
		lit.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		lit.albedo_texture = sc.view.get_texture()
		quad.material = lit
		var mi := MeshInstance3D.new()
		mi.mesh = quad
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.transform = cockpit.transform.affine_inverse() * in_car
		cockpit.add_child(mi)

func _copy_mesh(src: Mesh) -> ArrayMesh:
	var out := ArrayMesh.new()
	for s in src.get_surface_count():
		out.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, src.surface_get_arrays(s))
		out.surface_set_material(s, src.surface_get_material(s))
	return out

func _make_screen(kind: String, canvas := Vector2i.ZERO) -> Dictionary:
	var view := SubViewport.new()
	view.size = canvas if canvas != Vector2i.ZERO else (Vector2i(640, 320) if kind == "dash" else Vector2i(384, 192))
	view.disable_3d = true
	view.transparent_bg = false
	view.render_target_update_mode = SubViewport.UPDATE_ONCE
	var ctl := DashScreen.new(kind)
	ctl.size = Vector2(view.size)
	view.add_child(ctl)
	add_child(view)
	return {"view": view, "ctl": ctl, "kind": kind}

## The mesh projected on its own plane, right and up as the driver sees them (the car's −X is its right, +Y up; the
## model's own UVs often point at a glyph atlas), the canvas fitted inside with its aspect kept.
func _project_uv(mi: MeshInstance3D, surface: int, root: Node3D, aspect: float) -> PackedVector2Array:
	var arrays := mi.mesh.surface_get_arrays(surface)
	var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	if verts.size() < 3:
		return PackedVector2Array()
	var to_root := _rel(mi, root)
	var pts := PackedVector3Array()
	pts.resize(verts.size())
	for i in verts.size():
		pts[i] = to_root * verts[i]
	# the plane's normal: the area-weighted sum of the triangles' (sign-free)
	var acc := [Vector3.ZERO]  # lambdas capture by value: the sum lives in an Array
	var idx: Variant = arrays[Mesh.ARRAY_INDEX]
	var tri := func(a: int, b: int, c: int) -> void:
		var cr := (pts[b] - pts[a]).cross(pts[c] - pts[a])
		if (acc[0] as Vector3).dot(cr) < 0.0:
			cr = -cr
		acc[0] = (acc[0] as Vector3) + cr
	if idx != null and idx.size() >= 3:
		for i in range(0, idx.size() - 2, 3):
			tri.call(idx[i], idx[i + 1], idx[i + 2])
	else:
		for i in range(0, pts.size() - 2, 3):
			tri.call(i, i + 1, i + 2)
	var n: Vector3 = acc[0]
	if n.length_squared() < 1e-12:
		return PackedVector2Array()
	n = n.normalized()
	var right := Vector3(-1, 0, 0)
	right = (right - n * right.dot(n)).normalized()
	var up := Vector3(0, 1, 0)
	up = (up - n * up.dot(n) - right * up.dot(right)).normalized()
	if not is_finite(right.x) or not is_finite(up.x):
		return PackedVector2Array()
	var u0 := INF
	var u1 := -INF
	var v0 := INF
	var v1 := -INF
	var uv: Array = []
	for p in pts:
		var u := p.dot(right)
		var v := p.dot(up)
		u0 = minf(u0, u)
		u1 = maxf(u1, u)
		v0 = minf(v0, v)
		v1 = maxf(v1, v)
		uv.append(Vector2(u, v))
	# the canvas (width 1, height 1/aspect) as large as fits, centred; v = 0 is the canvas's top row
	var k := 1.0 / maxf(u1 - u0, (v1 - v0) * aspect)
	var um := (u0 + u1) / 2.0
	var vm := (v0 + v1) / 2.0
	var out := PackedVector2Array()
	out.resize(uv.size())
	for i in uv.size():
		out[i] = Vector2(0.5 + (uv[i].x - um) * k, 0.5 + (vm - uv[i].y) * k * aspect)
	return out

## A node's transform relative to root (works before the scene is in the tree).
static func _rel(node: Node3D, root: Node3D) -> Transform3D:
	var t := Transform3D.IDENTITY
	var n: Node = node
	while n != null and n != root:
		if n is Node3D:
			t = (n as Node3D).transform * t
		n = n.get_parent()
	return t

func count() -> int:
	return screens.size()

func update_dash(dt: float, d: Dictionary) -> void:
	if screens.is_empty():
		return
	_t += dt
	if _t < 1.0 / 15.0:
		return
	_t = 0.0
	for sc in screens:
		sc.ctl.data = d
		sc.ctl.queue_redraw()
		sc.view.render_target_update_mode = SubViewport.UPDATE_ONCE

## One screen's picture.
class DashScreen:
	extends Control
	var kind: String
	var data: Dictionary = {}

	func _init(k: String) -> void:
		kind = k

	static func fmt(ms) -> String:
		if ms == null or ms <= 0:
			return "-:--.---"
		var m := int(ms / 60000.0)
		return "%d:%06.3f" % [m, fmod(ms, 60000.0) / 1000.0]

	func _text(s: String, pos: Vector2, size: int, color: Color, align: int = HORIZONTAL_ALIGNMENT_LEFT, bold: bool = true) -> void:
		# canvas "middle" baseline: the position is the text's vertical centre
		var f := UIKit.font(true, 700 if bold else 500)
		var width := 400.0
		var x := pos.x
		if align == HORIZONTAL_ALIGNMENT_CENTER:
			x -= width / 2.0
		elif align == HORIZONTAL_ALIGNMENT_RIGHT:
			x -= width
		draw_string(f, Vector2(x, pos.y + size * 0.35), s, align, width, size, color)

	## Shift lights across the top: green, red, blue at the limit, flashing over it.
	func _lights(x: float, y: float, w: float, h: float) -> void:
		var d := data
		var n := 10
		var lit := clampi(roundi(((d.rpm / d.redline - 0.75) / 0.25) * n), 0, n)
		var flash: bool = d.rpm >= d.limiter * 0.985 and int(Time.get_ticks_msec() / 90.0) % 2 == 0
		for i in n:
			var c := Color("1a1d22")
			if flash:
				c = Color("3aa0ff")
			elif i < lit:
				c = Color("2fd35a") if i < 4 else (Color("ff3b30") if i < 8 else Color("3aa0ff"))
			draw_rect(Rect2(x + i * w / n + 2.0, y, w / n - 4.0, h), c)

	func _draw() -> void:
		if data.is_empty():
			draw_rect(Rect2(Vector2.ZERO, size), Color("05070a"))
			return
		if kind == "dash":
			_draw_dash()
		elif kind == "aston":
			_draw_aston()
		else:
			_draw_wheel()

	func _gear_text() -> String:
		return "R" if data.gear < 0 else ("N" if data.gear == 0 else str(data.gear))

	func _draw_dash() -> void:
		var d := data
		var W := size.x
		var H := size.y
		draw_rect(Rect2(Vector2.ZERO, size), Color("05070a"))
		_lights(10, 8, W - 20, 18)
		# the big gear in the middle, the pit limiter over it
		_text(_gear_text(), Vector2(W / 2, H * 0.52), 150, Color("ffd60a") if d.pitLimiter else Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER)
		_text("PIT LIMITER" if d.pitLimiter else "%d km/h" % roundi(d.kmh), Vector2(W / 2, H * 0.88), 34, Color("ffd60a") if d.pitLimiter else Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER)
		# left column: lap times and the delta
		var grey := Color("8b9099")
		_text("LAST", Vector2(14, 52), 22, grey, HORIZONTAL_ALIGNMENT_LEFT, false)
		_text("BEST", Vector2(14, 112), 22, grey, HORIZONTAL_ALIGNMENT_LEFT, false)
		_text("DELTA", Vector2(14, 172), 22, grey, HORIZONTAL_ALIGNMENT_LEFT, false)
		_text(fmt(d.lastMs), Vector2(14, 80), 34, Color.WHITE)
		_text(fmt(d.bestMs), Vector2(14, 140), 34, Color("c77dff"))
		if d.deltaMs != null:
			_text("%s%.2f" % ["−" if d.deltaMs <= 0 else "+", absf(d.deltaMs) / 1000.0], Vector2(14, 200), 34, Color("2fd35a") if d.deltaMs <= 0 else Color("ff453a"))
		else:
			_text("-.--", Vector2(14, 200), 34, grey)
		_text("P%s/%d" % [str(d.position) if d.position > 0 else "-", d.total], Vector2(14, 262), 30, Color.WHITE)
		# right column: TC, ABS, brake bias as an offset from 50 %, fuel
		var row := func(label: String, value: String, y: float, colour: Color = Color.WHITE) -> void:
			_text(label, Vector2(W - 110, y), 22, grey, HORIZONTAL_ALIGNMENT_RIGHT, false)
			_text(value, Vector2(W - 14, y), 30, colour, HORIZONTAL_ALIGNMENT_RIGHT)
		row.call("TC", str(d.tc) if d.tc > 0 else "OFF", 56, Color("ffd60a") if d.tc > 0 else Color("ff453a"))
		row.call("ABS", "ON" if d.abs else "OFF", 96, Color("ffd60a") if d.abs else Color("ff453a"))
		row.call("BB", "%.1f" % (d.bias * 100.0 - 50.0), 136)
		row.call("FUEL", "--" if d.fuelL == null else "%.1f L" % d.fuelL, 176)
		# tyres: pressure (psi) over temperature, coloured cold / working / hot
		var tyre := func(i: int, x: float, y: float) -> void:
			var c: float = d.temps[i]
			draw_rect(Rect2(x - 34, y - 20, 68, 44), Color("3aa0ff") if c < 70 else (Color("ff453a") if c > 105 else Color("2fd35a")))
			_text("%.1f" % d.psi[i], Vector2(x, y - 6), 22, Color("05070a"), HORIZONTAL_ALIGNMENT_CENTER)
			_text("%d°" % roundi(c), Vector2(x, y + 14), 18, Color("05070a"), HORIZONTAL_ALIGNMENT_CENTER, false)
		tyre.call(0, W - 120, 232)
		tyre.call(1, W - 44, 232)
		tyre.call(2, W - 120, 284)
		tyre.call(3, W - 44, 284)

	## The wheel's small screen: gear, delta, position.
	func _draw_wheel() -> void:
		var d := data
		var W := size.x
		var H := size.y
		draw_rect(Rect2(Vector2.ZERO, size), Color("05070a"))
		_lights(6, 6, W - 12, 14)
		_text(_gear_text(), Vector2(W / 2, H * 0.58), 110, Color("ffd60a") if d.pitLimiter else Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER)
		var grey := Color("8b9099")
		if d.deltaMs == null:
			_text("-.--", Vector2(10, H * 0.58), 30, grey)
		else:
			_text("%s%.2f" % ["−" if d.deltaMs <= 0 else "+", absf(d.deltaMs) / 1000.0], Vector2(10, H * 0.58), 30, Color("2fd35a") if d.deltaMs <= 0 else Color("ff453a"))
		_text("P%s" % (str(d.position) if d.position > 0 else "-"), Vector2(W - 10, H * 0.58), 30, Color.WHITE, HORIZONTAL_ALIGNMENT_RIGHT)
		_text("%d" % roundi(d.kmh), Vector2(W / 2, H * 0.92), 22, Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER, false)

	## The Aston Martin Vantage GT3's driver display: rev lights over a gold ring round the gear, lap times and delta on
	## the left, speed and the four tyre pressures (bar, in green boxes) on the right, the knob settings along the bottom.
	func _draw_aston() -> void:
		var d := data
		var W := size.x
		var H := size.y
		draw_rect(Rect2(Vector2.ZERO, size), Color("04060a"))
		var grey := Color("8b9099")
		var gold := Color("d9b52b")
		# rev lights: small round lamps over the ring
		var n := 15
		var lit := clampi(roundi(((d.rpm / d.redline - 0.7) / 0.3) * n), 0, n)
		var flash: bool = d.rpm >= d.limiter * 0.985 and int(Time.get_ticks_msec() / 90.0) % 2 == 0
		for i in n:
			var c := Color("1a2024")
			if flash:
				c = Color("3aa0ff")
			elif i < lit:
				c = Color("2fd35a") if i < 6 else (Color("ff3b30") if i < 12 else Color("3aa0ff"))
			draw_circle(Vector2(W / 2.0 + (i - (n - 1) / 2.0) * 30.0, 22.0), 8.0, c)
		# the gear in its gold ring
		var ring := Vector2(W / 2.0, H * 0.47)
		draw_arc(ring, 100.0, 0.0, TAU, 72, gold, 5.0)
		draw_arc(ring, 90.0, 0.0, TAU, 72, Color("23281f"), 2.0)
		_text(_gear_text(), ring + Vector2(0, -8), 150, Color("ffd60a") if d.pitLimiter else Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER)
		_text("PIT LIMITER" if d.pitLimiter else "VANTAGE GT3", ring + Vector2(0, 66), 15, Color("ffd60a") if d.pitLimiter else grey, HORIZONTAL_ALIGNMENT_CENTER, false)
		# left: last lap, best lap, delta, position
		var left := func(label: String, value: String, y: float, colour: Color) -> void:
			_text(label, Vector2(24, y), 16, grey, HORIZONTAL_ALIGNMENT_LEFT, false)
			_text(value, Vector2(24, y + 26), 32, colour)
		left.call("LAST", fmt(d.lastMs), 80.0, Color.WHITE)
		left.call("BEST", fmt(d.bestMs), 148.0, Color("c77dff"))
		if d.deltaMs != null:
			left.call("DELTA", "%s%.2f" % ["−" if d.deltaMs <= 0 else "+", absf(d.deltaMs) / 1000.0], 216.0, Color("2fd35a") if d.deltaMs <= 0 else Color("ff453a"))
		else:
			left.call("DELTA", "-.--", 216.0, grey)
		left.call("POS", "P%s/%d" % [str(d.position) if d.position > 0 else "-", d.total], 284.0, Color.WHITE)
		# right: speed, then the tyres (pressure in bar over temperature)
		_text("%d" % roundi(d.kmh), Vector2(W - 24, 96), 64, Color.WHITE, HORIZONTAL_ALIGNMENT_RIGHT)
		_text("km/h", Vector2(W - 24, 138), 18, grey, HORIZONTAL_ALIGNMENT_RIGHT, false)
		for i in 4:
			var x := W - 24.0 - 92.0 * (2 - (i % 2)) + 8.0
			var y := 178.0 + (i / 2) * 58.0
			var c: float = d.temps[i]
			var box := Color("2fd35a") if c >= 70 and c <= 105 else (Color("3aa0ff") if c < 70 else Color("ff453a"))
			draw_rect(Rect2(x, y, 84, 50), box)
			_text("%.2f" % (d.psi[i] / 14.5038), Vector2(x + 42, y + 17), 24, Color("04060a"), HORIZONTAL_ALIGNMENT_CENTER)
			_text("%d°" % roundi(c), Vector2(x + 42, y + 38), 15, Color("04060a"), HORIZONTAL_ALIGNMENT_CENTER, false)
		# the knobs: TC, ABS, brake bias (offset from 50 %), fuel, pit limiter, engine map
		var knobs := [
			["TC", str(d.tc), Color("e0b020")],
			["ABS", "1" if d.abs else "0", Color("e03a30")],
			["BB", "%.1f" % (d.bias * 100.0 - 50.0), Color("3a7be0")],
			["FUEL", "--" if d.fuelL == null else "%d" % roundi(d.fuelL), Color("d8d8d8")],
			["PIT", "1" if d.pitLimiter else "0", Color("8b9099")],
			["MAP", "1", Color("2fb050")],
		]
		for i in knobs.size():
			var cx := 70.0 + i * 100.0
			var cy := H - 46.0
			draw_circle(Vector2(cx, cy), 21.0, knobs[i][2])
			draw_circle(Vector2(cx, cy), 17.0, Color("0b0e12"))
			_text(knobs[i][1], Vector2(cx, cy), 18, Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER)
			_text(knobs[i][0], Vector2(cx, cy + 32), 12, grey, HORIZONTAL_ALIGNMENT_CENTER, false)

static var _hidden: StandardMaterial3D
## A material that draws nothing (a surface hidden within a mesh that stays).
static func _hidden_mat() -> StandardMaterial3D:
	if _hidden == null:
		_hidden = StandardMaterial3D.new()
		_hidden.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		_hidden.albedo_color = Color(0, 0, 0, 0)
		_hidden.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		_hidden.no_depth_test = false
	return _hidden

