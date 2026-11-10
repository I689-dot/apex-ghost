extends SceneTree
## Replay buffer: recording at 20 Hz, the ring cap, interpolation (position, rotation), jumps, velocity.
##   tools/godot/gd.sh tests/replay_test.gd

var failures := 0

func check(cond: bool, what: String) -> void:
	print(("ok   " if cond else "FAIL ") + what)
	if not cond:
		failures += 1

func _initialize() -> void:
	var r := Replay.new()
	r.clear(["a", "b"])
	var due := 0
	for i in 200:
		if r.due(1.0 / 60.0):
			due += 1
	check(due >= 64 and due <= 67, "20 Hz out of 60 fps frames: %d samples in 200 frames" % due)

	# car a drives +x at 40 m/s and yaws; car b stands still and jumps (a reset) at 4 s
	r.clear(["a", "b"])
	for i in 101:
		var t := i * 50.0
		var poses := PackedFloat32Array()
		poses.resize(2 * Replay.STRIDE)
		var q := Quaternion(Vector3.UP, t / 1000.0 * 0.5)
		Replay.put(poses, 0, Vector3(40.0 * t / 1000.0, 0, 0), q, 0.1, 1.0, 2.0, false)
		Replay.put(poses, 1, Vector3(0, 0, 0) if t < 4000.0 else Vector3(500, 0, 0), Quaternion.IDENTITY, 0, 0, 0, true)
		r.add(1_000_000.0 + t, poses)
	check(r.size() == 101 and absf(r.duration_ms() - 5000.0) < 0.01, "101 samples, 5 s")
	var p := r.pose(1025.0, 0)
	check(absf(p.pos.x - 41.0) < 0.01, "position is interpolated between samples (%.3f)" % p.pos.x)
	var yaw: float = p.rot.get_euler().y
	check(absf(yaw - 0.5 * 1.025) < 0.005, "rotation is interpolated (%.4f)" % yaw)
	check(absf(p.steer - 0.1) < 0.0001 and p.brake == false, "steer and brake light")
	check(r.pose(-500.0, 0).pos.x == 0.0 and absf(r.pose(99999.0, 0).pos.x - 200.0) < 0.01, "times outside the buffer are clamped")
	check(r.pose(3990.0, 1).pos.x == 0.0 and r.pose(4010.0, 1).pos.x == 500.0, "a reset is a jump, not a drive across the track")
	check(absf(r.velocity(2000.0, 0).x - 40.0) < 0.01, "velocity from the samples: %.2f" % r.velocity(2000.0, 0).x)
	check(r.velocity(3990.0, 1).length() == 0.0, "no velocity across a jump")
	check(r.pose(0, 5).is_empty(), "unknown car")

	var cap := Replay.new()
	cap.clear(["a"])
	var n := int(Replay.MAX_SECONDS * Replay.HZ) + 500
	var one := PackedFloat32Array()
	one.resize(Replay.STRIDE)
	for i in n:
		cap.add(float(i) * 50.0, one)
	check(cap.size() == int(Replay.MAX_SECONDS * Replay.HZ), "ring buffer holds %d samples" % cap.size())
	check(absf(cap.duration_ms() - (cap.size() - 1) * 50.0) < 0.5 and cap.first_ms() > 0.0, "oldest samples dropped")
	print("failures: %d" % failures)
	quit(1 if failures > 0 else 0)
