extends Node
## Bakes the grass masks (the footprint of the structures near each layout's racing line) into assets/masks/<layout>.bin
## (~10 s a layout): godot --path godot res://tests/runner.tscn -- res://tests/bake_masks.gd
func _ready() -> void:
	_run.call_deferred()

func _run() -> void:
	for entry in TrackData.list_layouts():
		var data := Assets.load_track_file(entry.id)
		var track := TrackScene.new(data).load_scene()
		add_child(track)
		await get_tree().process_frame
		var t0 := Time.get_ticks_msec()
		var mask := GrassMask.build(track.chunks, data, track.ground_materials)
		mask.save_baked(entry.id)
		print("%s: %d cells in %d ms" % [entry.id, mask.cells.size(), Time.get_ticks_msec() - t0])
		track.queue_free()
		await get_tree().process_frame
	get_tree().quit()
