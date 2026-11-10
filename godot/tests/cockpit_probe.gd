extends Node
## Where a pixel of a cockpit view lands on the model: rays from the driver's eye through pixels, against the cockpit mesh.
## Prints the hit in the car's own coordinates (what a node parented to the CarVisual uses). Same view as cockpit_view.gd.
##   CAR_ID=<id> VIEW="yaw,pitch" FOV=70 PIXELS="x,y;x,y" godot --path godot --resolution 1280x720 res://tests/runner.tscn -- res://tests/cockpit_probe.gd

func _ready() -> void:
	_run.call_deferred()

func _run() -> void:
	var id := OS.get_environment("CAR_ID") if OS.get_environment("CAR_ID") != "" else "vantage_gt3_evo_heart_of_racing"
	var fov := float(OS.get_environment("FOV")) if OS.get_environment("FOV") != "" else 70.0
	var view := (OS.get_environment("VIEW") if OS.get_environment("VIEW") != "" else "0,-30").split(",")
	var entry: Dictionary = {}
	for c in CarsDb.file().cars:
		if c.id == id:
			entry = c
	var model := Assets.load_car_model(entry, 3, true)
	var world := Node3D.new()
	add_child(world)
	var car := CarVisual.new(entry, model, true, null)
	world.add_child(car)
	var cam := Camera3D.new()
	cam.fov = fov
	world.add_child(cam)
	cam.current = true
	var p: Array = entry.cockpitCamera.position
	cam.global_position = Vector3(p[0], p[1], p[2])
	cam.global_transform.basis = Basis.from_euler(Vector3(deg_to_rad(float(view[1])), deg_to_rad(180.0 + float(view[0])), 0), EULER_ORDER_YXZ)
	for _k in 3:
		await get_tree().process_frame
	var tms := []
	for n in CarVisual._walk(car):
		if n is MeshInstance3D and n.mesh != null and (n as MeshInstance3D).name == "body":
			tms.append([n, (n.mesh as Mesh).generate_triangle_mesh()])
	for px in OS.get_environment("PIXELS").split(";"):
		var f := px.split(",")
		var pos := Vector2(float(f[0]), float(f[1]))
		var o := cam.project_ray_origin(pos)
		var d := cam.project_ray_normal(pos)
		var best := {}
		var best_t := INF
		for e in tms:
			var inv: Transform3D = (e[0] as Node3D).global_transform.affine_inverse()
			var hit: Dictionary = (e[1] as TriangleMesh).intersect_ray(inv * o, inv.basis * d)
			if not hit.is_empty():
				var gp: Vector3 = (e[0] as Node3D).global_transform * hit.position
				var t := o.distance_to(gp)
				if t < best_t:
					best_t = t
					best = {"pos": gp, "normal": ((e[0] as Node3D).global_transform.basis * hit.normal).normalized()}
		if best.is_empty():
			print("pixel %s: no hit" % px)
		else:
			print("pixel %s: pos=(%.4f, %.4f, %.4f) normal=(%.3f, %.3f, %.3f) dist=%.3f" % [px, best.pos.x, best.pos.y, best.pos.z, best.normal.x, best.normal.y, best.normal.z, best_t])
	get_tree().quit()
