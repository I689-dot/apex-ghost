extends Node
## Renders a track from above and from the grid and saves screenshots to the scratchpad (needs a display).
func _ready() -> void:
	_run.call_deferred()

func _run() -> void:
	var layouts := TrackData.list_layouts()
	var track := TrackData.load_layout(layouts[4])
	var root3 := Node3D.new()
	add_child(root3)
	var n := 0
	for k in ["track", "terrain", "scenery", "fill"]:
		if track.files.has(k):
			var res = load("res://" + track.files[k])
			if res != null:
				var inst = res.instantiate()
				root3.add_child(inst)
				n += 1
	print("track scenes loaded: ", n)
	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color(0.5, 0.7, 0.9)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.8, 0.8, 0.8)
	env.environment = e
	add_child(env)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-50, 30, 0)
	add_child(sun)
	var cam := Camera3D.new()
	add_child(cam)
	cam.far = 5000.0
	var g: Dictionary = track.grid[0]
	cam.global_position = Vector3(g.p[0], g.p[1] + 400.0, g.p[2] + 1.0)
	cam.look_at(Vector3(g.p[0], g.p[1], g.p[2]), Vector3.UP)
	await get_tree().create_timer(1.0).timeout
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(OS.get_environment("SHOT_DIR") + "/track_top.png")
	cam.global_position = Vector3(g.p[0], g.p[1] + 2.0, g.p[2])
	cam.rotation = Vector3(0, g.yaw + PI, 0)
	await get_tree().create_timer(0.5).timeout
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(OS.get_environment("SHOT_DIR") + "/track_grid.png")
	print("saved")
	get_tree().quit()
