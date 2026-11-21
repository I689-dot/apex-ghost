extends SceneTree
## Compiles every script under res://scripts and reports the ones that fail, then the GDScript warnings per script
## and in total. A script cannot see its own warnings: a second run with --debug reloads every script (a script
## compiled as another one's dependency prints nothing; its reload does, sometimes twice) and this one reads its
## output, counting each warning once (its message and place). Exit 1 when a script fails to compile or the second
## run prints a script error (a script that compiles only in part, e.g. an unknown type, still loads).
##   tools/godot/gd.sh tests/compile_all.gd             (WARNINGS=0: compile only, no warning count)

func _initialize() -> void:
	if OS.get_cmdline_user_args().has("--inner"):
		quit(_compile())
		return
	var bad := _compile()
	if OS.get_environment("WARNINGS") != "0" and _warnings() > 0:
		bad = 1
	quit(bad)

## Loads every script; prints the ones that fail. Returns 1 when one failed.
func _compile() -> int:
	var bad := 0
	var n := 0
	var inner := OS.get_cmdline_user_args().has("--inner")
	for path in _scripts("res://scripts"):
		n += 1
		var s := load(path)
		# (the --debug run: a reload compiles it again, printing its warnings and any error)
		if inner and s is GDScript and (s as GDScript).reload(true) != OK:
			print("FAILED: ", path, " (reload)")
			bad += 1
			continue
		if s == null or (s is GDScript and not (s as GDScript).can_instantiate() and not (s as GDScript).is_abstract() and (s as GDScript).get_script_method_list().is_empty() and (s as GDScript).get_script_property_list().is_empty() and (s as GDScript).get_script_constant_map().is_empty()):
			print("FAILED: ", path)
			bad += 1
	print("%d scripts, %d failed" % [n, bad])
	return 1 if bad > 0 else 0

## The same load in a --debug run, its "WARNING:" lines counted once each by the place named on the line after it.
## Returns the number of script errors that run printed.
func _warnings() -> int:
	var out: Array = []
	var args := ["--headless", "--path", ProjectSettings.globalize_path("res://"), "--debug", "-s", "res://tests/compile_all.gd", "--", "--inner"]
	OS.execute(OS.get_executable_path(), args, out, true)
	var lines := "\n".join(out).split("\n")
	var per := {}
	var kinds := {}
	var total := 0
	var re := RegEx.create_from_string("\\((res://[^:]+):(\\d+)\\)")
	var seen := {}
	var errors := 0
	for i in lines.size():
		if lines[i].begins_with("SCRIPT ERROR: "):
			errors += 1
			print(lines[i], "  ", lines[i + 1].strip_edges() if i + 1 < lines.size() else "")
			continue
		if not lines[i].begins_with("WARNING: "):
			continue
		var m := re.search(lines[i + 1]) if i + 1 < lines.size() else null
		if m == null:
			continue
		var place := "%s|%s:%s" % [lines[i], m.get_string(1), m.get_string(2)]
		if seen.has(place):
			continue
		seen[place] = true
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
	if errors > 0:
		print("%d script errors in the --debug run" % errors)
	return errors

func _scripts(dir: String) -> Array:
	var out: Array = []
	for f in DirAccess.get_files_at(dir):
		if f.ends_with(".gd"):
			out.append(dir + "/" + f)
	for d in DirAccess.get_directories_at(dir):
		out.append_array(_scripts(dir + "/" + d))
	return out
