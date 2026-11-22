class_name SessionReplay
extends SessionCameras
## RaceSession's replay layer: the recording at 20 Hz, playback (pause, slow motion, frames, jumps),
## its cars and cameras, and putting the live cars back after it (the layers: SessionBase, session_base.gd).

var _replay_proxy := Node3D.new()

var _replay_chase := ChaseCamera.new()

var _replay_saved := {}

var _replay_poses := PackedFloat32Array()

func _replay_visual(i: int) -> CarVisual:
	var id: String = replay.ids[i]
	if id == me:
		return my_visual
	var r := remote_by_id(id)
	return r.visual if r != null else null

## One sample of every car's pose, 20 times a second, from the cars as they were drawn this frame.
func _replay_record(dt: float, server_now: float) -> void:
	if start_at == null or server_now < start_at - 3000.0:
		return
	if replay.ids.is_empty():
		var ids: Array = [] if spectator else [me]
		for r: Remote in remotes.values():
			ids.append(r.id)
		replay.clear(ids)
		_replay_poses.resize(ids.size() * Replay.STRIDE)
	if not replay.due(dt):
		return
	for i in replay.ids.size():
		var v := _replay_visual(i)
		if v == null:
			continue
		Replay.put(_replay_poses, i, v.global_position, v.global_transform.basis.get_rotation_quaternion(), v.pose_steer, v.pose_rot_f, v.pose_rot_r, v.brake_on)
	replay.add(float(Time.get_ticks_msec()), _replay_poses)

func open_replay() -> void:
	if replay_open or replay.size() < 40 or cinematic != null:
		return
	replay_open = true
	replay_playing = true
	replay_speed = 1.0
	replay_t = maxf(replay.first_ms(), replay.last_ms() - 15000.0)
	replay_car = 0
	replay_cam_mode = 0
	_replay_chase.reset()
	_replay_saved.clear()
	for i in replay.ids.size():
		var v := _replay_visual(i)
		if v != null:
			_replay_saved[v] = v.transform
			# placed in world space while the replay runs: my car's model is a child of the live car, which rolls on
			# under the physics between frames (the replayed car jittered with it)
			v.top_level = true
	replay_cam = Camera3D.new()
	replay_cam.near = 0.1
	replay_cam.far = 9000.0
	add_child(replay_cam)
	add_child(_replay_proxy)
	add_child(_replay_chase.camera)
	hud.visible = false
	if cb.has("on_replay_toggle"):
		cb.on_replay_toggle.call(true)

func close_replay() -> void:
	if not replay_open:
		return
	replay_open = false
	# (Variant: a saved visual may be freed by now, which a typed variable would refuse)
	for v: Variant in _replay_saved:
		if is_instance_valid(v):
			v.top_level = false
			v.transform = _replay_saved[v]
	_replay_saved.clear()
	if replay_cam != null:
		replay_cam.queue_free()
		replay_cam = null
	if _replay_proxy.get_parent() == self:
		remove_child(_replay_proxy)
	if _replay_chase.camera.get_parent() == self:
		remove_child(_replay_chase.camera)
	hud.visible = true
	if cb.has("on_replay_toggle"):
		cb.on_replay_toggle.call(false)

func replay_toggle_play() -> void:
	if not replay_playing and ((replay_speed > 0.0 and replay_t >= replay.last_ms() - 1.0) or (replay_speed < 0.0 and replay_t <= replay.first_ms() + 1.0)):
		replay_t = replay.first_ms() if replay_speed > 0.0 else replay.last_ms()
	replay_playing = not replay_playing

func replay_set_speed(sp: float) -> void:
	replay_speed = sp
	replay_playing = true

## One recorded sample (a twentieth of a second) back or forward, paused.
func replay_step(dir: int) -> void:
	replay_playing = false
	replay_t = clampf(replay_t + dir * 1000.0 / Replay.HZ, replay.first_ms(), replay.last_ms())

func replay_jump(ms: float) -> void:
	replay_t = clampf(replay_t + ms, replay.first_ms(), replay.last_ms())

func replay_seek_fraction(f: float) -> void:
	replay_t = replay.first_ms() + clampf(f, 0.0, 1.0) * replay.duration_ms()

func replay_change_car(dir: int) -> void:
	replay_car = posmod(replay_car + dir, maxi(1, replay.ids.size()))
	_replay_chase.reset()

func replay_change_camera() -> void:
	replay_cam_mode = (replay_cam_mode + 1) % REPLAY_CAMERAS.size()
	_replay_chase.reset()

func replay_camera_name() -> String:
	return REPLAY_CAMERAS[replay_cam_mode]

func replay_car_name() -> String:
	if replay_car >= replay.ids.size():
		return ""
	return String(names.get(replay.ids[replay_car], "?"))

## Desktop keys while the replay is open (the bar has buttons for everything).
func _replay_keys() -> void:
	if Input.is_key_pressed(KEY_ESCAPE) or kb.tapped("pause") or kb.tapped("replay"):
		close_replay()
		return
	if kb.tapped("handbrake") or _tapped_key(KEY_K):
		replay_toggle_play()
	if _tapped_key(KEY_COMMA):
		replay_step(-1)
	if _tapped_key(KEY_PERIOD):
		replay_step(1)
	if _tapped_key(KEY_LEFT) or _tapped_key(KEY_J):
		replay_jump(-5000.0)
	if _tapped_key(KEY_RIGHT) or _tapped_key(KEY_L):
		replay_jump(5000.0)
	if kb.tapped("camera"):
		replay_change_camera()
	if kb.tapped("steerLeft") and not _tapped_key(KEY_LEFT):
		replay_change_car(-1)
	if kb.tapped("steerRight") and not _tapped_key(KEY_RIGHT):
		replay_change_car(1)

func _tapped_key(k: int) -> bool:
	return kb._pressed.has(k)

## Playback time, and the camera on the car being watched. Returns the camera to look through.
func _replay_update(dt: float) -> Camera3D:
	if replay_playing:
		replay_t += dt * 1000.0 * replay_speed
		if replay_t >= replay.last_ms() and replay_speed > 0.0:
			replay_t = replay.last_ms()
			replay_playing = false
		elif replay_t <= replay.first_ms() and replay_speed < 0.0:
			replay_t = replay.first_ms()
			replay_playing = false
	var p := replay.pose(replay_t, replay_car)
	if p.is_empty():
		return null
	_replay_proxy.global_transform = Transform3D(Basis(p.rot), p.pos)
	var vel := replay.velocity(replay_t, replay_car)
	if replay_cam_mode == 1 and tv_cameras() != null:
		_tv_hint = TrackMath.nearest_centerline_index(track_data, p.pos.x, p.pos.y, p.pos.z, _tv_hint, 40)
		var s := TrackMath.progress_at(track_data, _tv_hint, p.pos.x, p.pos.z)
		var cams: TvCameras = tv_cameras()
		if cams.update(dt, p.pos, vel, s):
			return cams.camera
	if replay_cam_mode == 2:
		var fwd: Vector3 = p.rot * Vector3(0, 0, 1)
		replay_cam.global_position = p.pos + fwd * 9.0 + Vector3(0, 1.1, 0)
		replay_cam.look_at(p.pos + Vector3(0, 0.7, 0), Vector3.UP)
		replay_cam.fov = 60.0
		return replay_cam
	_replay_chase.update(dt, _replay_proxy, vel, "chase", false)
	return _replay_chase.camera

## Puts every car where the replay has it (after the live update, so the live positions are only overdrawn).
func _replay_apply() -> void:
	for i in replay.ids.size():
		var v := _replay_visual(i)
		if v == null:
			continue
		var p := replay.pose(replay_t, i)
		if p.is_empty():
			continue
		v.global_transform = Transform3D(Basis(p.rot), p.pos)
		v.set_pose(p.steer, p.rot_f, p.rot_r, [0.0, 0.0, 0.0, 0.0])
		v.set_lights(p.brake, headlights_on, env.night)
		v.set_opacity(1.0)
		v.visible = true
