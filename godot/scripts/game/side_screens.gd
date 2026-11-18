class_name SideScreens
extends Node
## Triple screens (the user, 2026-11-16: several monitors at once): while racing, a window on the monitor left and / or
## right of the game's, each drawing the same world from the camera in use turned to that side, so the view carries on
## across the screens as in the sims' triple-screen setups. The angle is the centre view's own width by default (the
## views meet edge to edge), or the player's (Display → Side screen angle). Each window is a native one of its own,
## full screen on its monitor, and takes no input.

var _windows: Array = [] # [Window, Camera3D, side (-1 left, +1 right)]

## The monitors beside the one the game is on: {"left": index or -1, "right": index or -1}.
static func neighbours() -> Dictionary:
	var me := DisplayServer.window_get_current_screen()
	var mx := DisplayServer.screen_get_position(me).x
	var left := -1
	var right := -1
	for i in DisplayServer.get_screen_count():
		if i == me:
			continue
		var x := DisplayServer.screen_get_position(i).x
		if x < mx and (left < 0 or x > DisplayServer.screen_get_position(left).x):
			left = i
		if x > mx and (right < 0 or x < DisplayServer.screen_get_position(right).x):
			right = i
	return {"left": left, "right": right}

func _ready() -> void:
	var mode: String = Settings.data.display.get("sideScreens", "off")
	if mode == "off" or OS.has_feature("mobile") or DisplayServer.get_name() == "headless":
		return
	var nb := neighbours()
	if mode in ["both", "left"] and nb.left >= 0:
		_open(nb.left, -1)
	if mode in ["both", "right"] and nb.right >= 0:
		_open(nb.right, 1)

func _open(screen: int, side: int) -> void:
	var w := Window.new()
	# hidden while it is set up: a native window can only be made so before it shows
	w.visible = false
	w.name = "side-%s" % ("left" if side < 0 else "right")
	w.title = "GridCorsa"
	w.force_native = true
	w.borderless = true
	w.unfocusable = true
	w.transient = false
	w.current_screen = screen
	w.position = DisplayServer.screen_get_position(screen)
	w.size = DisplayServer.screen_get_size(screen)
	var cam := Camera3D.new()
	cam.current = true
	w.add_child(cam)
	add_child(w)
	w.mode = Window.MODE_FULLSCREEN
	w.visible = true
	_windows.append([w, cam, side])

## How far round each side view is turned (radians): the player's angle, or the centre view's width.
func side_yaw(main: Camera3D) -> float:
	var deg: float = Settings.data.display.get("sideAngle", 0.0)
	if deg > 0.0:
		return deg_to_rad(deg)
	var vp := get_viewport().get_visible_rect().size
	var aspect := vp.x / maxf(1.0, vp.y)
	if main.keep_aspect == Camera3D.KEEP_WIDTH:
		return deg_to_rad(main.fov)
	return 2.0 * atan(tan(deg_to_rad(main.fov) * 0.5) * aspect)

func _process(_dt: float) -> void:
	if _windows.is_empty():
		return
	var main := get_viewport().get_camera_3d()
	if main == null:
		return
	var yaw := side_yaw(main)
	for e in _windows:
		var cam: Camera3D = e[1]
		var side: int = e[2]
		# left: turned left round the camera's own up (a positive turn about +Y looks left)
		cam.global_transform = main.global_transform * Transform3D(Basis(Vector3.UP, -side * yaw), Vector3.ZERO)
		cam.fov = main.fov
		cam.keep_aspect = main.keep_aspect
		cam.near = main.near
		cam.far = main.far
		cam.attributes = main.attributes
		cam.cull_mask = main.cull_mask

## The side windows, for tests: [Window, Camera3D, side].
func windows() -> Array:
	return _windows
