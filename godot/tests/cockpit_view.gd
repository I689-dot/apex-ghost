extends Node
## Renders a car's cockpit from the driver's eye (and other angles) without a race: the real CarVisual (cockpit model,
## material fixes, dash screens), a daylight sky, one PNG per view.
##   CAR_ID=<id> VIEWS="yaw,pitch;yaw,pitch" FOV=70 OUT=<dir> godot --path godot --resolution 1280x720 res://tests/runner.tscn -- res://tests/cockpit_view.gd
## yaw / pitch in degrees from straight ahead (yaw + = left, pitch - = down); a view "x,y,z,yaw,pitch" also moves the eye.

func _ready() -> void:
	_run.call_deferred()

func _run() -> void:
	var id := OS.get_environment("CAR_ID") if OS.get_environment("CAR_ID") != "" else "vantage_gt3_evo_heart_of_racing"
	var out := OS.get_environment("OUT") if OS.get_environment("OUT") != "" else "/tmp"
	var fov := float(OS.get_environment("FOV")) if OS.get_environment("FOV") != "" else 70.0
	var views := (OS.get_environment("VIEWS") if OS.get_environment("VIEWS") != "" else "0,-8").split(";")
	if OS.get_environment("NO_INTERIOR_FIX") != "":
		InteriorLook.enabled = false
	var entry: Dictionary = {}
	for c in CarsDb.file().cars:
		if c.id == id:
			entry = c
	var model := Assets.load_car_model(entry, 3, true)
	var world := Node3D.new()
	add_child(world)
	var sky := Sky.new()
	var psm := ProceduralSkyMaterial.new()
	sky.sky_material = psm
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	var we := WorldEnvironment.new()
	we.environment = env
	world.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-50, 35, 0)
	sun.light_energy = 1.1
	world.add_child(sun)
	var floor_mesh := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(60, 60)
	floor_mesh.mesh = pm
	var fm := StandardMaterial3D.new()
	fm.albedo_color = Color(0.22, 0.22, 0.23)
	floor_mesh.material_override = fm
	world.add_child(floor_mesh)
	var car := CarVisual.new(entry, model, true, null)
	world.add_child(car)
	car.set_inside(true)
	car.update_cockpit_glass(1.0)
	var dash := DashDisplays.new(car)
	add_child(dash)
	print("dash screens: ", dash.count())
	if OS.get_environment("STEER") != "":
		car.set_pose(deg_to_rad(float(OS.get_environment("STEER"))), 0.0, 0.0, [0.0, 0.0, 0.0, 0.0])
	dash.update_dash(1.0, {
		"gear": 2, "kmh": 133.0, "rpm": 6900.0, "redline": 7400.0, "limiter": 7600.0, "lapMs": 61000.0, "lastMs": 400400.0, "bestMs": 398200.0, "deltaMs": -180.0,
		"position": 3, "total": 12, "tc": 4, "abs": true, "bias": 0.585, "fuelL": 58.0, "psi": [26.1, 26.0, 26.2, 26.1], "temps": [88.0, 90.0, 93.0, 91.0], "pitLimiter": false,
	})
	var cam := Camera3D.new()
	cam.fov = fov
	cam.near = 0.03
	cam.far = 500.0
	world.add_child(cam)
	cam.current = true
	var p: Array = entry.cockpitCamera.position
	var i := 0
	for v in views:
		var f := v.split(",")
		var eye := Vector3(p[0], p[1], p[2])
		var yaw := float(f[0])
		var pitch := float(f[1])
		if f.size() >= 5:
			eye += Vector3(float(f[0]), float(f[1]), float(f[2]))
			yaw = float(f[3])
			pitch = float(f[4])
		cam.global_position = eye
		cam.global_transform.basis = Basis.from_euler(Vector3(deg_to_rad(pitch), deg_to_rad(180.0 + yaw), 0), EULER_ORDER_YXZ)
		for _k in 6:
			await get_tree().process_frame
		var path := "%s/cockpit_%s_%s%d.png" % [out, id.left(12), "before_" if OS.get_environment("NO_INTERIOR_FIX") != "" else "after_", i]
		get_viewport().get_texture().get_image().save_png(path)
		print("saved ", path, "  view ", v)
		i += 1
	get_tree().quit()
