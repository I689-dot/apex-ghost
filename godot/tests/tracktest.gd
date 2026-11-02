extends SceneTree
## Loads a layout's collision, puts a car on grid slot 0 and drives it down the track for a few seconds.
## godot --headless --path godot --fixed-fps 120 -s tests/tracktest.gd -- [layoutIndex]

const DT := 1.0 / 120.0

func _initialize() -> void:
	Engine.physics_ticks_per_second = 120
	_run.call_deferred()

func _run() -> void:
	var args := OS.get_cmdline_user_args()
	var layouts := TrackData.list_layouts()
	var layout: Dictionary = layouts[int(args[0]) if args.size() > 0 else 0]
	print("layout: %s" % layout.name)
	var t0 := Time.get_ticks_msec()
	var track := TrackData.load_layout(layout)
	var holder := Node3D.new()
	root.add_child(holder)
	var bodies := TrackCollision.build(holder, track)
	print("collision bodies: %d in %d ms" % [bodies.size(), Time.get_ticks_msec() - t0])
	var cars: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/cars.json"))
	var v := Vehicle.new()
	v.auto_step = false
	v.setup_car(cars.cars[0], GroundQuery.new(root.world_3d), {"tc": 1, "abs": true, "stability": false, "steering": false}, DamageState.new())
	holder.add_child(v)
	await physics_frame
	var g: Dictionary = track.grid[0]
	v.place(g.p[0], g.p[1], g.p[2], g.yaw)
	var c := Controls.new()
	c.throttle = 1.0
	var start := v.global_position
	for i in 120 * 12:
		v.step(DT, c)
		await physics_frame
		if i % 240 == 0:
			print("t=%2d  speed %5.1f km/h  y=%.2f  surface=%s gear=%d" % [i / 120, v.telemetry.speed * 3.6, v.global_position.y, v.wheels[0].surface, v.telemetry.gear])
	var idx := TrackMath.nearest_centerline_index(track, v.global_position.x, v.global_position.y, v.global_position.z, -1)
	print("moved %.0f m, centreline index %d, progress %.0f m" % [start.distance_to(v.global_position), idx, TrackMath.progress_at(track, idx, v.global_position.x, v.global_position.z)])
	quit()
