class_name TopView
extends RefCounted
## A car seen from straight above (port of game/topView.ts): a picture of the car's own model (nose up, transparent
## background), and its technical line drawing (surface creases, silhouette, height steps) for the damage report and
## the status instrument. Both are rendered once at load, each car gets its own. The car is instanced again in a
## private SubViewport world, so the live car is never touched.

class Picture:
	extends RefCounted
	var texture: ImageTexture
	var min_x: float
	var max_x: float
	var min_z: float
	var max_z: float

class Lines:
	extends RefCounted
	## Line strength per pixel, 0..255, rows top (nose) to bottom.
	var lines: PackedByteArray
	var width: int
	var height: int
	var min_x: float
	var max_x: float
	var min_z: float
	var max_z: float

const NORMAL_SHADER := "shader_type spatial;\nrender_mode unshaded, cull_disabled;\nvarying vec3 n_w;\nvoid vertex() { n_w = (MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz; }\nvoid fragment() { ALBEDO = normalize(n_w) * 0.5 + 0.5; }\n"
const HEIGHT_SHADER := "shader_type spatial;\nrender_mode unshaded, cull_disabled;\nuniform float lo;\nuniform float hi;\nvarying float vy;\nvoid vertex() { vy = (MODEL_MATRIX * vec4(VERTEX, 1.0)).y; }\nvoid fragment() { float u = clamp((vy - lo) / max(hi - lo, 0.01), 0.0, 1.0); ALBEDO = vec3(u, fract(u * 255.0), 0.0); }\n"

## The car's meshes' box (the car's own geometry only: far-out stuff would shrink it to a dot), in the car's frame.
static func _car_box(root: Node3D) -> AABB:
	var box := AABB()
	var first := true
	for n in CarVisual._walk(root):
		if not (n is MeshInstance3D) or (n as MeshInstance3D).mesh == null:
			continue
		var mi := n as MeshInstance3D
		if not mi.visible:
			continue
		# transform relative to the root
		var t := Transform3D.IDENTITY
		var a: Node = mi
		while a != null and a != root:
			if a is Node3D:
				t = (a as Node3D).transform * t
			a = a.get_parent()
		var mb := t * mi.mesh.get_aabb()
		if mb.position.x < -3.0 or mb.end.x > 3.0 or mb.position.z < -4.0 or mb.end.z > 4.0 or mb.end.y > 3.0:
			continue
		box = mb if first else box.merge(mb)
		first = false
	return box if not first else AABB()

static func _make_world(host: Node, px_w: int, px_h: int, model: PackedScene, box: AABB, with_light: bool) -> Array:
	var vp := SubViewport.new()
	vp.size = Vector2i(px_w, px_h)
	vp.own_world_3d = true
	vp.transparent_bg = true
	vp.msaa_3d = Viewport.MSAA_4X if with_light else Viewport.MSAA_DISABLED
	vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	host.add_child(vp)
	var car: Node3D = model.instantiate()
	vp.add_child(car)
	var cam := Camera3D.new()
	cam.projection = Camera3D.PROJECTION_ORTHOGONAL
	cam.size = box.size.z
	cam.near = 0.1
	cam.far = box.end.y + 15.0
	vp.add_child(cam)
	# looking down with +z (forward) up the picture: the picture's right is the car's right (-x)
	cam.global_transform = Transform3D(Basis(Vector3(-1, 0, 0), Vector3(0, 0, 1), Vector3(0, 1, 0)), Vector3(box.get_center().x, box.end.y + 5.0, box.get_center().z))
	if with_light:
		var env := WorldEnvironment.new()
		var e := Environment.new()
		e.background_mode = Environment.BG_CLEAR_COLOR
		e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
		e.ambient_light_color = Color(0.85, 0.85, 0.9)
		e.ambient_light_energy = 0.9
		env.environment = e
		vp.add_child(env)
		var sun := DirectionalLight3D.new()
		sun.rotation_degrees = Vector3(-70, 210, 0)
		sun.light_energy = 1.0
		vp.add_child(sun)
	return [vp, car, cam]

## The car's model from straight above (nose up). model: the car's PackedScene (any level). Async: await it.
static func render_top_view(host: Node, model: PackedScene, px_wide: int = 120) -> Picture:
	var probe: Node3D = model.instantiate()
	var box := _car_box(probe)
	probe.free()
	if box.size == Vector3.ZERO:
		return null
	var W := px_wide * 2
	var H := roundi(W * box.size.z / box.size.x)
	var parts := _make_world(host, W, H, model, box, true)
	var vp: SubViewport = parts[0]
	await RenderingServer.frame_post_draw
	await RenderingServer.frame_post_draw
	var img := vp.get_texture().get_image()
	vp.queue_free()
	var pic := Picture.new()
	pic.texture = ImageTexture.create_from_image(img)
	pic.min_x = box.position.x
	pic.max_x = box.end.x
	pic.min_z = box.position.z
	pic.max_z = box.end.z
	return pic

## The car's own model as a technical line drawing from straight above: rendered twice top-down, its surface
## directions and its height, and drawn where either jumps. Async: await it.
static func render_top_lines(host: Node, model: PackedScene, px_wide: int = 220) -> Lines:
	var probe: Node3D = model.instantiate()
	var box := _car_box(probe)
	probe.free()
	if box.size == Vector3.ZERO:
		return null
	var W := px_wide
	var H := roundi(W * box.size.z / box.size.x)
	var imgs: Array = []
	for pass_i in 2:
		var parts := _make_world(host, W, H, model, box, false)
		var vp: SubViewport = parts[0]
		var car: Node3D = parts[1]
		var sh := Shader.new()
		sh.code = NORMAL_SHADER if pass_i == 0 else HEIGHT_SHADER
		var mat := ShaderMaterial.new()
		mat.shader = sh
		if pass_i == 1:
			mat.set_shader_parameter("lo", box.position.y)
			mat.set_shader_parameter("hi", box.end.y)
		for n in CarVisual._walk(car):
			if n is MeshInstance3D:
				(n as MeshInstance3D).material_override = mat
		var e := WorldEnvironment.new()
		var env := Environment.new()
		env.background_mode = Environment.BG_CLEAR_COLOR
		env.tonemap_mode = Environment.TONE_MAPPER_LINEAR
		e.environment = env
		vp.add_child(e)
		await RenderingServer.frame_post_draw
		await RenderingServer.frame_post_draw
		imgs.append(vp.get_texture().get_image())
		vp.queue_free()
	var nrm: Image = imgs[0]
	var hgt: Image = imgs[1]
	nrm.convert(Image.FORMAT_RGBA8)
	hgt.convert(Image.FORMAT_RGBA8)
	var nd := nrm.get_data()
	var hd := hgt.get_data()
	var range_y := box.size.y
	var lines := PackedByteArray()
	lines.resize(W * H)
	for y in H:
		for x in W:
			var i := (y * W + x) * 4
			var solid := nd[i + 3] > 0
			var e := 0.0
			for d in [[1, 0], [0, 1], [1, 1], [1, -1]]:
				var nx: int = x + d[0]
				var ny: int = y + d[1]
				if nx < 0 or ny < 0 or nx >= W or ny >= H:
					continue
				var j := (ny * W + nx) * 4
				var other := nd[j + 3] > 0
				if solid != other:
					e = maxf(e, 1.0)
					continue
				if not solid:
					continue
				# a crease: the surface turns sharply
				var dn := (absf(float(nd[i]) - nd[j]) + absf(float(nd[i + 1]) - nd[j + 1]) + absf(float(nd[i + 2]) - nd[j + 2])) / 255.0 * 0.5
				# a step: one part lies over another (the wing over the deck, the mirrors, the wheels under the arches)
				var dh := (absf(float(hd[i]) - hd[j]) / 255.0) * range_y
				e = maxf(e, minf(1.0, maxf((dn - 0.35) / 0.4, (dh - 0.03) / 0.06)))
			lines[y * W + x] = roundi(maxf(0.0, e) * 255.0)
	var out := Lines.new()
	out.lines = lines
	out.width = W
	out.height = H
	out.min_x = box.position.x
	out.max_x = box.end.x
	out.min_z = box.position.z
	out.max_z = box.end.z
	return out
