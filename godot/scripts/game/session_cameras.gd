class_name SessionCameras
extends SessionBase
## RaceSession's cameras layer: switching views, the TV cameras and the car they follow, the spectator's
## camera and keys, the camera over my pit box (the layers: SessionBase, session_base.gd).

func _set_view_camera(c: Camera3D) -> void:
	c.current = true

func cycle_camera() -> void:
	var modes: Array = Settings.CAMERA_MODES
	var i := modes.find(Settings.data.camera)
	Settings.data.camera = modes[(i + 1) % modes.size()]
	Settings.save()
	chase.reset()
	flash(I18n.t({"cockpit": "Cockpit camera", "chase": "Chase camera", "far": "Far chase camera"}[Settings.data.camera]), 1200.0, "osd")

func tv_wanted() -> bool:
	if spectator:
		return spec_tv
	# after the chequered flag the broadcast takes over, as F1 / GT games show your in-lap
	return tv_view or (finished_ms != null and race.kind == "race")

func toggle_tv() -> void:
	tv_view = not tv_view
	if tv != null:
		tv.reset()
	flash(I18n.t("TV cameras") if tv_view else I18n.t({"cockpit": "Cockpit camera", "chase": "Chase camera", "far": "Far chase camera"}[Settings.data.camera]), 1200.0, "osd")

## Placed the first time they are wanted: a sightline check per tower against the circuit's collision.
func tv_cameras() -> TvCameras:
	if tv != null:
		return tv
	if not ResourceLoader.exists("res://scripts/game/tv_cameras.gd"):
		return null
	var cast_sight := func(a: Vector3, b: Vector3) -> Variant:
		var d := a.distance_to(b)
		if d < 0.01:
			return null
		var q := PhysicsRayQueryParameters3D.create(a, a.move_toward(b, maxf(0.0, d - 3.0)), VehicleConsts.RAY_MASK)
		var hit := get_viewport().world_3d.direct_space_state.intersect_ray(q)
		if not hit.is_empty():
			return a.distance_to(hit.position)
		if forest != null and forest.blocks(a, b):
			return d / 2.0
		return null
	var ground_at := func(x: float, z: float, from_y: float) -> Variant:
		var q := PhysicsRayQueryParameters3D.create(Vector3(x, from_y, z), Vector3(x, from_y - 600.0, z), VehicleConsts.RAY_MASK)
		var hit := get_viewport().world_3d.direct_space_state.intersect_ray(q)
		return null if hit.is_empty() else hit.position.y
	tv = load("res://scripts/game/tv_cameras.gd").new(track_data, cast_sight, ground_at)
	add_child(tv.camera)
	return tv

var _tv_hint := -1

## The car the TV cameras follow: watching, the watched car; driving, yours. Returns {pos, vel, s} or null.
func tv_target() -> Variant:
	if not spectator:
		return {"pos": vehicle.global_position, "vel": vehicle.linear_velocity, "s": loc.s}
	var r := remote_by_id(spec_target)
	if r == null and remotes.size() > 0:
		r = remotes.values()[0]
	if r == null:
		return null
	var p: Vector3 = r.visual.global_position
	_tv_hint = TrackMath.nearest_centerline_index(track_data, p.x, p.y, p.z, _tv_hint, 40)
	return {"pos": p, "vel": r.vel, "s": TrackMath.progress_at(track_data, _tv_hint, p.x, p.z)}

func _on_spectator_key(e: InputEventKey) -> void:
	var have := {}
	for r: Remote in remotes.values():
		have[r.id] = true
	var src: Array = standings.map(func(s: Dictionary) -> String: return s.id) if standings.size() > 0 else race.grid
	var ids: Array = src.filter(func(id: String) -> bool: return have.has(id))
	if ids.is_empty():
		return
	var i := ids.find(spec_target)
	if e.keycode == KEY_C or e.keycode == KEY_T:
		spec_tv = not spec_tv
		if tv != null:
			tv.reset()
		flash(I18n.t("TV cameras") if spec_tv else I18n.t("Chase camera"), 1200.0, "osd")
		return
	if e.keycode == KEY_RIGHT:
		i = (i + 1) % ids.size()
	elif e.keycode == KEY_LEFT:
		i = (i - 1 + ids.size()) % ids.size()
	elif e.keycode >= KEY_1 and e.keycode <= KEY_9:
		i = mini(ids.size() - 1, e.keycode - KEY_1)
	else:
		return
	spec_target = ids[i]
	spec_cam_init = false
	if tv != null:
		tv.reset()

## Chase camera behind the watched car, smoothed.
func update_spectator_cam(dt: float) -> void:
	var r := remote_by_id(spec_target)
	if r == null and remotes.size() > 0:
		r = remotes.values()[0]
	if r == null:
		return
	var o: Node3D = r.visual
	var f := o.global_transform.basis.z
	f.y = 0.0
	f = f.normalized()
	var want := o.global_position - f * 7.5 + Vector3(0, 2.6, 0)
	if not spec_cam_init:
		spec_cam.global_position = want
		spec_cam_init = true
	else:
		spec_cam.global_position = spec_cam.global_position.lerp(want, 1.0 - exp(-dt * 5.0))
	spec_cam.look_at(o.global_position + f * 4.0 + Vector3(0, 1, 0), Vector3.UP)

## The pit stop's TV shot: low from the front three-quarter on the fast-lane side, the garage behind the car, a slow
## drift around it while the crew works, as broadcasts frame a stop.
func update_pit_cam(dt: float) -> void:
	pit_cam_t += dt
	if service == null or Time.get_ticks_msec() - service.start < 50.0:
		pit_cam_t = 0.0
	var fwd := vehicle.global_transform.basis.z
	var fx := fwd.x
	var fz := fwd.z
	# the fast lane is away from the garage
	var away := Vector2(fz, -fx)
	if pit != null and pit.index >= 0:
		away = pit.away_at(pit.index)
	var side_sign := -1.0 if away.x * fz - away.y * fx > 0.0 else 1.0
	var a := 0.62 - pit_cam_t * 0.025
	var f := cos(a) * 6.2
	var side := sin(a) * 6.2 * side_sign
	var p := vehicle.global_position
	pit_cam.global_position = Vector3(p.x + fx * f + fz * side, p.y + 1.15, p.z + fz * f - fx * side)
	pit_cam.look_at(Vector3(p.x - fx * 0.4, p.y + 0.45, p.z - fz * 0.4), Vector3.UP)
