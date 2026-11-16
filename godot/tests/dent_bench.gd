extends Node
## How long a crash's body dent takes on each car (your own car's models, as in a session): the first dent copies the
## body's geometry, the second only moves vertices. Renders (mesh data needs the real rendering server).
##   godot --path godot --resolution 320x180 res://tests/runner.tscn -- res://tests/dent_bench.gd [car id ...]

func _ready() -> void:
	_run.call_deferred()

func _run() -> void:
	var ids: Array = Array(OS.get_cmdline_user_args().slice(1))
	if ids.is_empty():
		ids = CarsDb.selectable().map(func(c): return c.id)
	for id in ids:
		var entry: Dictionary = CarsDb.by_id(id)
		var model := Assets.load_car_model(entry, 1, true)
		var outside: PackedScene = Assets.load_car_model(entry, 1, false).lods[0]
		var v := CarVisual.new(entry, model, true, outside)
		add_child(v)
		await get_tree().process_frame
		var times := []
		for k in 2:
			var t0 := Time.get_ticks_usec()
			v.dent(Vector3(0.6, 0.5, float(entry.dims.length) * 0.45), Vector3(-0.6, 0, -0.8).normalized(), 0.5)
			times.append((Time.get_ticks_usec() - t0) / 1000.0)
		print("%-34s first dent %7.1f ms, second %7.1f ms" % [id, times[0], times[1]])
		v.queue_free()
		await get_tree().process_frame
	get_tree().quit()
