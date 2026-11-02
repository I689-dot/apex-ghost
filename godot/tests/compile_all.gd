extends SceneTree
## Loads every script under res://scripts and reports the ones that fail to compile.
func _initialize() -> void:
	var bad := 0
	var n := 0
	for path in _scripts("res://scripts"):
		n += 1
		var s = load(path)
		if s == null or (s is GDScript and not (s as GDScript).can_instantiate() and not (s as GDScript).is_abstract() and (s as GDScript).get_script_method_list().is_empty() and (s as GDScript).get_script_property_list().is_empty() and (s as GDScript).get_script_constant_map().is_empty()):
			print("FAILED: ", path)
			bad += 1
	print("%d scripts, %d failed" % [n, bad])
	quit(1 if bad > 0 else 0)

func _scripts(dir: String) -> Array:
	var out: Array = []
	for f in DirAccess.get_files_at(dir):
		if f.ends_with(".gd"):
			out.append(dir + "/" + f)
	for d in DirAccess.get_directories_at(dir):
		out.append_array(_scripts(dir + "/" + d))
	return out
