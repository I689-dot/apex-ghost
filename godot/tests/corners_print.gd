extends SceneTree
## Prints the corner numbers the circuit map shows and where they are along the lap. TRACK=spa
func _initialize() -> void:
	var id := OS.get_environment("TRACK") if OS.get_environment("TRACK") != "" else "spa"
	var td = JSON.parse_string(FileAccess.get_file_as_string("res://data/tracks/%s.json" % id))
	var cs := CircuitMap.find_corners(td, 19 if id == "spa" else null)
	for i in cs.size():
		print(i + 1, ": ", cs[i])
	quit()
