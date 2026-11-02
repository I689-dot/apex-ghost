class_name CockpitCamera
extends RefCounted
## Cockpit camera with subtle, motion-sickness-friendly head movement (port of game/cockpit.ts): g-force sway (damped
## spring), kerb vibration, a little look-into-corner, and look left/right/back.

const PITCH := -0.055 # about 3 degrees down, like a driver looking at the road ahead
## The game eye sits ahead of and above the real driver's eyes, as in F1 / ACC / GT7 cockpit views.
const EYE_FORWARD := 0.2
const EYE_UP := 0.02

var camera: Camera3D
var _anchor := Node3D.new()
var _eye: Vector3
var _offset := Vector3.ZERO
var _off_vel := Vector3.ZERO
var _look_yaw := 0.0
var _corner_yaw := 0.0
var _shake_t := 0.0
var _dash: Node3D = null
var _dash_wheel: Node3D = null
var looking_forward := true
## True while an outside camera is in use: the drawn dash (cars without an interior) is hidden.
var hidden := false
var entry: Dictionary

var _eye_x := 0.0
var _eye_y := 0.0
var _eye_z := 0.0
## Automatic raise (m) found by auto_seat, so the road is visible over the dash.
var _auto_raise := 0.0
## Part of EYE_UP that fits under this car's roof (auto_seat measures it).
var _game_up := EYE_UP

func _init(car_entry: Dictionary, car_object: Node3D, fov: float, viewport_size: Vector2 = Vector2(1280, 720)) -> void:
	entry = car_entry
	camera = Camera3D.new()
	camera.fov = fov
	camera.near = 0.04
	camera.far = 9000.0
	var p: Array = entry.cockpitCamera.position
	_eye = Vector3(p[0], p[1], p[2])
	_anchor.position = _eye
	car_object.add_child(_anchor)
	_anchor.add_child(camera)
	# the camera looks along +Z (car forward): Godot cameras look down -Z, so turn around; slight downward pitch
	camera.rotation_order = EULER_ORDER_YXZ
	camera.rotation = Vector3(PITCH, PI, 0.0)
	apply_seat()
	if not entry.hasInterior:
		_build_dash()
	elif entry.get("steering") != null and car_object.find_child("steering_rim", true, false) == null and car_object.find_child("steering_pivot", true, false) == null:
		_build_wheel(car_object, entry.steering)

## A steering wheel for an interior modelled without one: a GT3 style rim with grips and a centre display box.
func _build_wheel(car_object: Node3D, st: Dictionary) -> void:
	var carbon := StandardMaterial3D.new()
	carbon.albedo_color = Color("1a1b1e")
	carbon.roughness = 0.5
	carbon.metallic = 0.25
	var grip := StandardMaterial3D.new()
	grip.albedo_color = Color("0d0d0f")
	grip.roughness = 0.95
	var r: float = st.diameter / 2.0
	var spin := Node3D.new()
	var rim := MeshInstance3D.new()
	var torus := TorusMesh.new()
	torus.inner_radius = r - 0.016
	torus.outer_radius = r + 0.016
	torus.rings = 40
	torus.ring_segments = 10
	rim.mesh = torus
	rim.material_override = carbon
	rim.rotation.x = PI / 2.0 # the torus lies in XZ: stand it up in XY like a wheel
	var grip_l := MeshInstance3D.new()
	var cyl := CylinderMesh.new()
	cyl.top_radius = 0.022
	cyl.bottom_radius = 0.022
	cyl.height = 0.11
	grip_l.mesh = cyl
	grip_l.material_override = grip
	grip_l.position = Vector3(r, -0.01, 0)
	var grip_r := grip_l.duplicate() as MeshInstance3D
	grip_r.position.x = -r
	var plate := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(r * 1.45, r * 0.62, 0.03)
	plate.mesh = box
	plate.material_override = carbon
	plate.position.y = -r * 0.15
	var screen := MeshInstance3D.new()
	var quad := QuadMesh.new()
	quad.size = Vector2(r * 0.7, r * 0.32)
	screen.mesh = quad
	var sm := StandardMaterial3D.new()
	sm.albedo_color = Color("0b2030")
	sm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	screen.material_override = sm
	screen.position = Vector3(0, r * 0.05, -0.017)
	screen.rotation.y = PI
	for m in [rim, grip_l, grip_r, plate, screen]:
		spin.add_child(m)
		(m as GeometryInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var holder := Node3D.new()
	holder.position = Vector3(st.position[0], st.position[1], st.position[2])
	# the wheel's face (local -Z, the screen side) looks along the column axis, towards the driver
	var axis := Vector3(st.axis[0], st.axis[1], st.axis[2]).normalized()
	holder.basis = Basis(Quaternion(Vector3(0, 0, -1), axis))
	holder.add_child(spin)
	car_object.add_child(holder)
	_dash_wheel = spin

## Minimal dashboard + wheel for models without an interior.
func _build_dash() -> void:
	var g := Node3D.new()
	var dark := StandardMaterial3D.new()
	dark.albedo_color = Color("121316")
	dark.roughness = 0.85
	var carbon := StandardMaterial3D.new()
	carbon.albedo_color = Color("1d1f22")
	carbon.roughness = 0.45
	carbon.metallic = 0.3
	var dash := MeshInstance3D.new()
	var b1 := BoxMesh.new()
	b1.size = Vector3(1.5, 0.16, 0.5)
	dash.mesh = b1
	dash.material_override = dark
	dash.position = Vector3(-_eye.x, -0.32, 0.7)
	var hood := MeshInstance3D.new()
	var b2 := BoxMesh.new()
	b2.size = Vector3(1.6, 0.04, 0.6)
	hood.mesh = b2
	hood.material_override = dark
	hood.position = Vector3(-_eye.x, -0.24, 0.95)
	hood.rotation.x = -0.12
	var wheel := Node3D.new()
	var rim := MeshInstance3D.new()
	var torus := TorusMesh.new()
	torus.inner_radius = 0.132
	torus.outer_radius = 0.168
	torus.rings = 36
	torus.ring_segments = 10
	rim.mesh = torus
	rim.material_override = carbon
	rim.rotation.x = PI / 2.0
	var hub := MeshInstance3D.new()
	var b3 := BoxMesh.new()
	b3.size = Vector3(0.2, 0.08, 0.04)
	hub.mesh = b3
	hub.material_override = carbon
	wheel.add_child(rim)
	wheel.add_child(hub)
	wheel.position = Vector3(0, -0.3, 0.48)
	wheel.rotation.x = -0.35
	g.add_child(dash)
	g.add_child(hood)
	g.add_child(wheel)
	for m in [dash, hood, rim, hub]:
		(m as GeometryInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_anchor.add_child(g)
	_dash = g
	_dash_wheel = wheel

## Base eye position plus the player's seat adjustment (Settings: seat height / position).
func apply_seat() -> void:
	_eye_x = _eye.x
	_eye_y = _eye.y + _auto_raise + _game_up + float(Settings.data.seatHeight)
	_eye_z = _eye.z + EYE_FORWARD + float(Settings.data.seatForward)

## Measures, against the real car model, how far below the horizon the dash/hood blocks the view, and raises the eye
## (up to 14 cm, keeping headroom) until the road is visible from ~10 m ahead. Runs once while loading.
func auto_seat(car: Node3D) -> void:
	var meshes: Array = []
	for n in CarVisual._walk(car):
		if not (n is MeshInstance3D) or not (n as MeshInstance3D).is_visible_in_tree() or (n as MeshInstance3D).mesh == null:
			continue
		var skip := false
		var a: Node = n
		while a != null:
			if a == _anchor:
				skip = true
				break
			a = a.get_parent()
		if skip:
			continue
		# glass does not block the view
		var mi := n as MeshInstance3D
		var all_glass := mi.mesh.get_surface_count() > 0
		for s in mi.mesh.get_surface_count():
			var m := mi.get_surface_override_material(s)
			if m == null:
				m = mi.mesh.surface_get_material(s)
			if not (m is BaseMaterial3D and m.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED):
				all_glass = false
		if all_glass:
			continue
		meshes.append(mi)
	var fwd := _eye.z + EYE_FORWARD
	# triangle meshes in the car's local space (the car's own transform cancels out)
	var tris: Array = []
	for mi: MeshInstance3D in meshes:
		var tm := mi.mesh.generate_triangle_mesh()
		if tm != null:
			tris.append([tm, car.global_transform.affine_inverse() * mi.global_transform])
	var ray_hits := func(from: Vector3, dir: Vector3, far: float) -> float:
		var best := INF
		for t in tris:
			var inv: Transform3D = (t[1] as Transform3D).affine_inverse()
			var hit: Dictionary = (t[0] as TriangleMesh).intersect_ray(inv * from, inv.basis * dir)
			if not hit.is_empty():
				var d: float = ((t[1] as Transform3D) * hit.position).distance_to(from)
				if d < best and d <= far:
					best = d
		return best
	var blocked := func(y: float, pitch_deg: float, yaw_deg: float, far: float = 3.5) -> bool:
		var p := deg_to_rad(pitch_deg)
		var yw := deg_to_rad(yaw_deg)
		var dir := Vector3(sin(yw) * cos(p), sin(p), cos(yw) * cos(p))
		return ray_hits.call(Vector3(_eye.x, y, fwd), dir, far) < INF
	var room_at := func(y: float) -> float:
		var h: float = ray_hits.call(Vector3(_eye.x, y, fwd), Vector3.UP, 1.0)
		return h if h < INF else 1.0
	_game_up = maxf(0.0, minf(EYE_UP, room_at.call(_eye.y) - 0.09))
	var raise := 0.0
	# an eye set by hand per car is already clear of the dash
	if not entry.cockpitCamera.get("tuned", false):
		var clear := func(y: float) -> bool:
			return not blocked.call(y, -5.5, 0.0) and not blocked.call(y, -5.5, -8.0) and not blocked.call(y, -5.5, 8.0)
		var dy := 0.0
		while dy <= 0.14 + 1e-6:
			if room_at.call(_eye.y + _game_up + dy) < 0.08:
				break
			raise = dy
			if clear.call(_eye.y + _game_up + dy):
				break
			dy += 0.02
	_auto_raise = raise
	apply_seat()

func set_fov(fov: float) -> void:
	camera.fov = fov

## An impact throws the head (car-local m/s, +X left, +Z forward): the neck spring brings it back.
func jolt(x: float, y: float, z: float) -> void:
	_off_vel += Vector3(x, y, z)

## t: vehicle telemetry; steer: road-wheel angle; look: {left, right, back}; yaw_rate rad/s.
func update(dt: float, t: Dictionary, steer: float, look: Dictionary, yaw_rate: float) -> void:
	# head sway: a damped spring driven by accelerations (clamped, a few centimetres)
	var g: float = Settings.data.headMovement
	var ax := clampf(-t.latAccel * 0.0028, -0.045, 0.045) * g
	var az := clampf(-t.longAccel * 0.0022, -0.035, 0.035) * g
	var ay := 0.0
	var k := 60.0
	var c := 13.0
	_off_vel.x += ((ax - _offset.x) * k - _off_vel.x * c) * dt
	_off_vel.y += ((ay - _offset.y) * k - _off_vel.y * c) * dt
	_off_vel.z += ((az - _offset.z) * k - _off_vel.z * c) * dt
	_offset += _off_vel * dt

	# kerb / rough-surface vibration
	_shake_t += dt
	var shake: float = t.surfaceRumble * minf(1.0, t.speed / 25.0) * 0.004 * float(Settings.data.cameraShake)
	var sx := sin(_shake_t * 71.0) * shake
	var sy := sin(_shake_t * 53.0 + 1.3) * shake
	_anchor.position = Vector3(_eye_x + _offset.x + sx, _eye_y + _offset.y + sy, _eye_z + _offset.z)

	# look left/right/back (hold keys) and a little look-into-corner
	var target := PI if look.back else (1.25 if look.left else (-1.25 if look.right else 0.0))
	_look_yaw += (target - _look_yaw) * minf(1.0, dt * 12.0)
	var la: float = Settings.data.lookToApex
	var corner := clampf((steer * 0.35 + yaw_rate * 0.06) * la, -0.18 * la, 0.18 * la)
	_corner_yaw += (corner - _corner_yaw) * minf(1.0, dt * 4.0)
	camera.rotation = Vector3(PITCH, PI + _look_yaw + _corner_yaw, 0.0)
	looking_forward = absf(_look_yaw) < 0.4
	if _dash_wheel != null:
		_dash_wheel.rotation.z = steer * 11.0
	if _dash != null:
		_dash.visible = looking_forward and not hidden

## World position of the camera.
func world_position() -> Vector3:
	return camera.global_position
