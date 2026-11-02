extends SceneTree
## Headless vehicle-dynamics checks (port of tools/sim/simtest.ts): rest, 0-100, 0-200, top speed, 200->0 braking.
## godot --headless --path godot --fixed-fps 120 -s tests/simtest.gd -- [carId]

const DT := 1.0 / 120.0

var car: Dictionary
var vehicle: Vehicle
var world_root: Node3D
var ground_body: StaticBody3D

func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	var car_id := args[0] if args.size() > 0 else "2024_porsche_992_gt3_r"
	var cars: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/cars.json"))
	for c in cars.cars:
		if c.id == car_id:
			car = c
	if car.is_empty():
		car = cars.cars[0]
	Engine.physics_ticks_per_second = 120
	PhysicsServer3D.set_active(true)
	_run.call_deferred()

func _fresh() -> void:
	if world_root != null:
		world_root.queue_free()
		await physics_frame
	world_root = Node3D.new()
	root.add_child(world_root)
	ground_body = StaticBody3D.new()
	ground_body.collision_layer = VehicleConsts.LAYER_TRACK
	ground_body.collision_mask = 0
	ground_body.set_meta("surface", "asphalt")
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(40000, 2, 40000)
	cs.shape = box
	cs.position = Vector3(0, -1, 0)
	ground_body.add_child(cs)
	world_root.add_child(ground_body)
	vehicle = Vehicle.new()
	vehicle.auto_step = false
	vehicle.setup_car(car, GroundQuery.new(root.world_3d), {"tc": 1, "abs": true, "stability": false, "steering": false}, DamageState.new())
	world_root.add_child(vehicle)
	await physics_frame
	vehicle.place(0, 0, 0, 0)

func _ctl(throttle := 0.0, brake := 0.0, steer := 0.0) -> Controls:
	var c := Controls.new()
	c.throttle = throttle
	c.brake = brake
	c.steer = steer
	return c

func _step(c: Controls) -> void:
	vehicle.step(DT, c)
	await physics_frame

func _kmh(ms: float) -> float:
	return ms * 3.6

func _run() -> void:
	print("▶ %s (%d kg, %s) on a flat pad" % [car.name, car.specs.massKg, car.specs.drivetrain])
	# 1) rest
	await _fresh()
	for i in 240:
		await _step(_ctl())
	var p0 := vehicle.global_position
	var max_v := 0.0
	for i in 360:
		await _step(_ctl())
		max_v = maxf(max_v, vehicle.linear_velocity.length())
	var p1 := vehicle.global_position
	var comp := ""
	for w in vehicle.wheels:
		comp += "%.3f/" % w.compression
	print("rest drift (3 s)               %.4f m, max speed %.3f m/s, compression %s, ride y %.3f" % [Vector2(p1.x - p0.x, p1.z - p0.z).length(), max_v, comp, p1.y])
	# 2) launch
	await _fresh()
	for i in 120:
		await _step(_ctl())
	var t := 0.0
	var t100 := NAN
	var t200 := NAN
	var vmax := 0.0
	var last_gear := 1
	var shifts := ""
	for i in 120 * 45:
		await _step(_ctl(1.0))
		t += DT
		var sp := _kmh(vehicle.telemetry.speed)
		if is_nan(t100) and sp >= 100.0:
			t100 = t
		if is_nan(t200) and sp >= 200.0:
			t200 = t
		vmax = maxf(vmax, sp)
		if vehicle.telemetry.gear != last_gear:
			shifts += "%d@%.0f " % [vehicle.telemetry.gear, sp]
			last_gear = vehicle.telemetry.gear
	print("0-100 km/h                     %.2f s" % t100)
	print("0-200 km/h                     %.2f s" % t200)
	print("top speed (45 s)               %.0f km/h (spec %d)" % [vmax, car.specs.topSpeedKmh])
	print("shifts                         %s" % shifts)
	print("lateral drift on straight      %.2f m after %.0f m" % [absf(vehicle.global_position.x), vehicle.global_position.z])
	# 3) braking 200 -> 0
	await _fresh()
	for i in 120:
		await _step(_ctl())
	var guard := 0
	while _kmh(vehicle.telemetry.speed) < 200.0 and guard < 120 * 60:
		await _step(_ctl(1.0))
		guard += 1
	var z0 := vehicle.global_position.z
	t = 0.0
	while vehicle.telemetry.speed > 0.5 and t < 20.0:
		await _step(_ctl(0.0, 1.0))
		t += DT
	print("braking 200->0                 %.1f m in %.2f s (ABS on)" % [vehicle.global_position.z - z0, t])
	quit()
