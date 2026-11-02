extends Node
func _ready() -> void:
	var id := "2024_porsche_992_gt3_r"
	for f in ["lod0", "lod1", "lod2", "cockpit"]:
		var res = load("res://assets/cars/%s/%s.glb" % [id, f])
		var inst: Node = res.instantiate()
		var count := 0
		var tris := 0
		var mats := {}
		for n in _walk(inst):
			count += 1
			if n is MeshInstance3D:
				var m := (n as MeshInstance3D).mesh
				if m != null:
					for s in m.get_surface_count():
						var mat := m.surface_get_material(s)
						if mat != null:
							mats[mat.resource_name] = true
		print("%s: %d nodes, root=%s children=%s" % [f, count, inst.name, inst.get_children().map(func(c): return c.name)])
		if f == "lod0":
			_print_tree(inst, 0, 3)
			print("materials: ", mats.keys().slice(0, 40))
	get_tree().quit()

func _walk(n: Node) -> Array:
	var out := [n]
	for c in n.get_children():
		out.append_array(_walk(c))
	return out

func _print_tree(n: Node, depth: int, max_depth: int) -> void:
	if depth > max_depth:
		return
	var extra := ""
	if n is Node3D:
		extra = " pos=%s" % [str((n as Node3D).position)]
	print("  ".repeat(depth) + n.name + " (" + n.get_class() + ")" + extra)
	for c in n.get_children():
		_print_tree(c, depth + 1, max_depth)
