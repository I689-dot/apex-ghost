extends SceneTree
## Loads every script under res://scripts and reports the ones that fail to compile, then the GDScript warnings per
## script and in total (a script cannot see its own warnings: they are printed by a second run with --debug, whose
## output this one reads). Exit 1 when a script fails to compile.
##   tools/godot/gd.sh tests/compile_all.gd             (WARNINGS=0: compile only, no warning count)

func _initialize() -> void:
	if OS.get_cmdline_user_args().has("--inner"):
		quit(_compile())
		return
	var bad := _compile()
	if OS.get_environment("WARNINGS") != "0":
		_warnings()
	quit(bad)

## Loads every script; prints the ones that fail. Returns 1 when one failed.
func _compile() -> int:
	var bad := 0
	var n := 0
	for path in _scripts("res://scripts"):
		n += 1
		var s := load(path)
		if s == null or (s is GDScript and not (s as GDScript).can_instantiate() and not (s as GDScript).is_abstract() and (s as GDScript).get_script_method_list().is_empty() and (s as GDScript).get_script_property_list().is_empty() and (s as GDScript).get_script_constant_map().is_empty()):
			print("FAILED: ", path)
			bad += 1
	print("%d scripts, %d failed" % [n, bad])
	return 1 if bad > 0 else 0

## The same load in a --debug run, its "WARNING:" lines counted by the script named on the line after each.
func _warnings() -> void:
	var out: Array = []
	var args := ["--headless", "--path", ProjectSettings.globalize_path("res://"), "--debug", "-s", "res://tests/compile_all.gd", "--", "--inner"]
	OS.execute(OS.get_executable_path(), args, out, true)
	var lines := "\n".join(out).split("\n")
	var per := {}
	var kinds := {}
	var total := 0
	var re := RegEx.create_from_string("\\((res://[^:]+):\\d+\\)")
	for i in lines.size():
		if not lines[i].begins_with("WARNING: "):
			continue
		var m := re.search(lines[i + 1]) if i + 1 < lines.size() else null
		if m == null:
			continue
		total += 1
		per[m.get_string(1)] = int(per.get(m.get_string(1), 0)) + 1
		var kind := RegEx.create_from_string("\"[^\"]*\"").sub(lines[i].trim_prefix("WARNING: "), "\"…\"", true)
		kinds[kind] = int(kinds.get(kind, 0)) + 1
	var paths := per.keys()
	paths.sort_custom(func(a: String, b: String) -> bool: return per[a] > per[b] or (per[a] == per[b] and a < b))
	for p in paths:
		print("warnings %4d  %s" % [per[p], p])
	var ks := kinds.keys()
	ks.sort_custom(func(a: String, b: String) -> bool: return kinds[a] > kinds[b])
	for k in ks:
		print("kind %4d  %s" % [kinds[k], k.left(110)])
	print("%d warnings in %d scripts" % [total, paths.size()])

func _scripts(dir: String) -> Array:
	var out: Array = []
	for f in DirAccess.get_files_at(dir):
		if f.ends_with(".gd"):
			out.append(dir + "/" + f)
	for d in DirAccess.get_directories_at(dir):
		out.append_array(_scripts(dir + "/" + d))
	return out
