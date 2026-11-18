extends Node
## The main menu at the usual PC window sizes (SHOTS=<dir>: menu_<w>x<h>.png each), and how smoothly it draws there
## (frame times while the menu sits and while the pointer moves over it).
##   godot --path godot res://tests/runner.tscn -- res://tests/menu_shots.gd

const SIZES := [Vector2i(1280, 720), Vector2i(1366, 768), Vector2i(1920, 1080), Vector2i(2560, 1440), Vector2i(3440, 1440)]

func _ready() -> void:
	_run.call_deferred()

func _frames(n: int) -> void:
	for i in n:
		await get_tree().process_frame

func _run() -> void:
	Settings.data.introCinematic = false
	var app = load("res://scripts/app/app.gd").new()
	add_child(app)
	await _frames(10)
	var dir := OS.get_environment("SHOTS")
	var win := get_window()
	win.mode = Window.MODE_WINDOWED
	for s in SIZES:
		win.size = s
		await _frames(4)
		MenuScreen._tab = "play"
		app.show_menu()
		await get_tree().create_timer(1.2).timeout
		# frame times: still, then the pointer sweeping across the cards
		var still := PackedFloat32Array()
		for i in 60:
			await get_tree().process_frame
			still.append(get_process_delta_time() * 1000.0)
		var moving := PackedFloat32Array()
		for i in 60:
			var e := InputEventMouseMotion.new()
			e.position = Vector2(s.x * (0.1 + 0.8 * i / 59.0), s.y * 0.6)
			e.global_position = e.position
			Input.parse_input_event(e)
			await get_tree().process_frame
			moving.append(get_process_delta_time() * 1000.0)
		still.sort()
		moving.sort()
		print("menu %dx%d (viewport %s): still median %.1f ms worst %.1f, pointer moving median %.1f ms worst %.1f" % [s.x, s.y, get_viewport().get_visible_rect().size, still[30], still[59], moving[30], moving[59]])
		if dir != "":
			get_viewport().get_texture().get_image().save_png("%s/menu_%dx%d.png" % [dir, s.x, s.y])
	get_tree().quit(0)
