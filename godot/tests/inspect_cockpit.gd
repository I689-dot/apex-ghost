extends SceneTree
## Lists the meshes and materials of a car's cockpit.glb (CAR_ID): where each is, and how its material is set.
##   CAR_ID=vantage_gt3_evo_heart_of_racing godot --headless --path godot -s tests/inspect_cockpit.gd

func _walk(n: Node) -> Array:
	var out := [n]
	for c in n.get_children():
		out.append_array(_walk(c))
	return out

func _initialize() -> void:
	var id := OS.get_environment("CAR_ID") if OS.get_environment("CAR_ID") != "" else "vantage_gt3_evo_heart_of_racing"
	var inst: Node = load(Assets.path(str(CarsDb.by_id(id).get("cockpit", "assets/cars/%s/lod0.glb" % id)))).instantiate()
	for n in _walk(inst):
		if n is MeshInstance3D and n.mesh != null:
			var mi := n as MeshInstance3D
			var box := mi.global_transform * mi.mesh.get_aabb()
			print("%s  tris~%d  aabb pos=(%.2f %.2f %.2f) size=(%.2f %.2f %.2f)" % [mi.name, _tris(mi.mesh), box.position.x, box.position.y, box.position.z, box.size.x, box.size.y, box.size.z])
			for s in mi.mesh.get_surface_count():
				var m := mi.mesh.surface_get_material(s)
				if m is StandardMaterial3D:
					var sm := m as StandardMaterial3D
					print("    [%d] %s albedo=%s metal=%.2f rough=%.2f tex=%s mr=%s nrm=%s emis=%s trans=%d" % [s, sm.resource_name, sm.albedo_color, sm.metallic, sm.roughness,
						sm.albedo_texture.resource_path.get_file() if sm.albedo_texture else "-", sm.metallic_texture.resource_path.get_file() if sm.metallic_texture else "-",
						sm.normal_texture.resource_path.get_file() if sm.normal_texture else "-", sm.emission_enabled, sm.transparency])
	quit()

func _tris(m: Mesh) -> int:
	var t := 0
	for s in m.get_surface_count():
		var a := m.surface_get_arrays(s)
		t += (a[Mesh.ARRAY_INDEX].size() if a[Mesh.ARRAY_INDEX] != null else a[Mesh.ARRAY_VERTEX].size()) / 3
	return t
