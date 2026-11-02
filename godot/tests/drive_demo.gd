extends Node
## Visual drive demo: a track, a car (physics + model), cameras. The AI drives the car so screenshots show motion.
## godot --path godot res://tests/runner.tscn --resolution 1280x720 -- res://tests/drive_demo.gd <layout> <carId> <cam> <seconds>
## SHOT_DIR=... saves screenshots every 3 s. Interactive when run without SHOT_DIR (keyboard drives).

var track: TrackScene
var vehicle: Vehicle
var visual: CarVisual
var ai: AiDriver
var chase := ChaseCamera.new()
var cockpit: CockpitCamera
var cam_mode := "chase"
var shot_dir := ""
var elapsed := 0.0
var shots := 0
var duration := 12.0
var kb := KeyboardInput.new({})
var smoother := InputSmoother.new()
var auto := true

func _ready() -> void:
	_run.call_deferred()

func _run() -> void:
	var args := OS.get_cmdline_user_args()
	var layout_i := int(args[1]) if args.size() > 1 else 4
	var car_id: String = args[2] if args.size() > 2 else "2024_porsche_992_gt3_r"
	cam_mode = args[3] if args.size() > 3 else "chase"
	duration = float(args[4]) if args.size() > 4 else 12.0
	shot_dir = OS.get_environment("SHOT_DIR")
	auto = shot_dir != ""
	kb.set_bindings(Settings.data.bindings)
	var data := Assets.load_track_file(TrackData.list_layouts()[layout_i].id)
	track = TrackScene.new(data).load_scene()
	add_child(track)
	var world := get_viewport().world_3d
	var gq := track.build_ground_query(world)
	var car := CarsDb.by_id(car_id)
	vehicle = Vehicle.new()
	vehicle.setup_car(car, gq, {"tc": 1, "abs": true, "stability": false, "steering": false}, DamageState.new())
	vehicle.auto_step = true
	add_child(vehicle)
	var model := Assets.load_car_model(car, 3, false)
	visual = CarVisual.new(car, model, true, null)
	vehicle.add_child(visual)
	await get_tree().physics_frame
	var g: Dictionary = data.grid[0]
	vehicle.place(g.p[0], g.p[1], g.p[2], g.yaw)
	vehicle.set_air(20.0, 30.0, 1.2)
	vehicle.fit_tyres(Tyres.COMPOUNDS.medium, 40.0)
	if auto:
		ai = AiDriver.new(data, vehicle, 0.95, 0.0)
	cockpit = CockpitCamera.new(car, visual, 58.0)
	cockpit.auto_seat(visual)
	_environment()
	add_child(chase.camera)
	(cockpit.camera as Camera3D).current = cam_mode == "cockpit"
	chase.camera.current = cam_mode != "cockpit"
	print("ready: ", car.name, " on ", data.name, " cam=", cam_mode)

var gameenv: GameEnvironment
var weather_plan := Weather.plan_weather(7, {"weather": "clear", "time": "afternoon", "changes": "off"})

func _environment() -> void:
	gameenv = GameEnvironment.new(weather_plan, Settings.quality_config())
	add_child(gameenv)

func _physics_process(dt: float) -> void:
	if vehicle == null:
		return
	if auto and ai != null:
		var c := ai.update(dt, elapsed > 3.0, 1.0)
		vehicle.controls = c
	else:
		vehicle.controls = smoother.update(dt, kb, vehicle.telemetry.speed, vehicle.is_reverse())
		kb.end_frame()

func _input(e: InputEvent) -> void:
	kb.process_event(e)
	if e is InputEventKey and e.pressed and e.keycode == KEY_V:
		cam_mode = "cockpit" if cam_mode == "chase" else "chase"

func _process(dt: float) -> void:
	if vehicle == null:
		return
	elapsed += dt
	var cc := cam_mode == "cockpit"
	visual.set_inside(cc)
	cockpit.camera.current = cc
	chase.camera.current = not cc
	if cc:
		cockpit.update(dt, vehicle.telemetry, vehicle.steer_angle, {"left": false, "right": false, "back": false}, vehicle.angular_velocity.y)
	else:
		chase.update(dt, vehicle, vehicle.linear_velocity, "chase", false)
	var cam_pos := (cockpit.world_position() if cc else chase.camera.global_position)
	track.update_visibility(cam_pos, Settings.quality_config())
	var cam := cockpit.camera if cc else chase.camera
	gameenv.update(dt, Weather.weather_at(weather_plan, elapsed), cam, vehicle.global_position, vehicle.linear_velocity)
	visual.set_pose(vehicle.steer_angle, vehicle.wheels[0].angle, vehicle.wheels[2].angle, [0, 0, 0, 0])
	visual.set_lights(vehicle.pedals.brake > 0.3, false, 0.0)
	if shot_dir != "" and elapsed > (shots + 1) * 3.0:
		shots += 1
		get_viewport().get_texture().get_image().save_png("%s/drive_%s_%d.png" % [shot_dir, cam_mode, shots])
		print("shot %d: speed %.0f km/h at %s" % [shots, vehicle.telemetry.speed * 3.6, vehicle.global_position])
	if elapsed > duration:
		get_tree().quit()
