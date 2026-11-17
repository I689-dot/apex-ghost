extends Node
## Every car's front close up (the near model, as other cars are drawn), its headlamps off and lit, in one sheet: how
## the lamps look (glass, reflectors, LEDs). SHEET=<file.png> (default user://headlights.png). MODE=badges: the nose
## and the tail straight on instead (where makers' badges sit: nothing of them may be left).
##   godot --path godot res://tests/runner.tscn --resolution 1280x720 -- res://tests/headlights_sheet.gd

const CELL := Vector2i(560, 315)

func _ready() -> void:
	_run.call_deferred()

func _run() -> void:
	var cars := CarsDb.all()
	var vp := CarStudio._make_studio(CELL)
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	add_child(vp)
	var sheet := Image.create(CELL.x * 2, CELL.y * cars.size(), false, Image.FORMAT_RGBA8)
	sheet.fill(Color(0.1, 0.1, 0.12))
	var cam := vp.get_node("cam") as Camera3D
	for i in cars.size():
		var e: Dictionary = cars[i]
		var v := CarStudio._car(e, CarStudio.my_livery(), true)
		if v == null:
			continue
		vp.add_child(v)
		CarPaint.apply(v, CarStudio.my_livery())
		var length: float = float(e.get("dims", {}).get("length", 4.6))
		var badges := OS.get_environment("MODE") == "badges"
		for lit in 2:
			if badges:
				# the nose from ahead and above, the tail from behind
				var sgn := 1.0 if lit == 0 else -1.0
				cam.position = Vector3(0, 1.05, sgn * (length * 0.5 + 1.6))
				cam.look_at(Vector3(0, 0.5, sgn * length * 0.4), Vector3.UP)
			else:
				# low, 25 degrees off the nose, the lamps filling the frame
				var a := deg_to_rad(25.0)
				cam.position = Vector3(sin(a) * length * 0.75, 0.75, length * 0.5 + cos(a) * length * 0.6)
				cam.look_at(Vector3(0.25, 0.55, length * 0.42), Vector3.UP)
			v.set_lights(false, lit == 1 and not badges, 0.0)
			for f in 4:
				await RenderingServer.frame_post_draw
			var img := vp.get_texture().get_image()
			img.convert(Image.FORMAT_RGBA8)
			sheet.blit_rect(img, Rect2i(Vector2i.ZERO, CELL), Vector2i(CELL.x * lit, CELL.y * i))
		print("%s done" % e.id)
		v.queue_free()
		await get_tree().process_frame
	var out := OS.get_environment("SHEET") if OS.get_environment("SHEET") != "" else "user://headlights.png"
	sheet.save_png(out)
	print("sheet: ", out)
	get_tree().quit(0)
