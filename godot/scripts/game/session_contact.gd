class_name SessionContact
extends SessionReplay
## RaceSession's contact layer: the contact rule (each car simulated elsewhere is a stand-in body here, driven
## to its predicted pose; the bumps sent and taken, a car rescued from another), impact damage and the parts it tears
## off, and the space around cars (the layers: SessionBase, session_base.gd).

## Point on the car's bounding box in direction dir (car-local, horizontal).
static func box_point(dir: Vector3, car: Dictionary) -> Vector3:
	var hx: float = car.dims.width / 2.0
	var hz: float = car.dims.length / 2.0
	var kx: float = hx / absf(dir.x) if absf(dir.x) > 1e-6 else INF
	var kz: float = hz / absf(dir.z) if absf(dir.z) > 1e-6 else INF
	var k := minf(kx, kz) * 0.95
	return Vector3(dir.x * k, 0.55, dir.z * k)

static func zone_point(zone: int, car: Dictionary) -> Vector3:
	var hz: float = car.dims.length / 2.0
	var hx: float = car.dims.width / 2.0
	if zone == 0:
		return Vector3(0, 0.55, hz * 0.95)
	if zone == 1:
		return Vector3(0, 0.6, -hz * 0.95)
	if zone == 2:
		return Vector3(hx * 0.95, 0.6, 0)
	return Vector3(-hx * 0.95, 0.6, 0)

static func zone_dir(zone: int) -> Vector3:
	if zone == 0:
		return Vector3(0, 0, -1)
	if zone == 1:
		return Vector3(0, 0, 1)
	if zone == 2:
		return Vector3(-1, 0, 0)
	return Vector3(1, 0, 0)

## Distance to the circuit's walls (collision), horizontally from 0.8 m above (x, y, z): where the garages are.
var _wall_query := PhysicsRayQueryParameters3D.new()

func wall_probe(x: float, y: float, z: float, dx: float, dz: float, max_d: float) -> Variant:
	_wall_query.collision_mask = VehicleConsts.LAYER_WALL
	_wall_query.from = Vector3(x, y + 0.8, z)
	_wall_query.to = Vector3(x + dx * max_d, y + 0.8, z + dz * max_d)
	var hit := get_viewport().world_3d.direct_space_state.intersect_ray(_wall_query)
	if hit.is_empty():
		return null
	return _wall_query.from.distance_to(hit.position)

## The collision box of a car simulated elsewhere (the same box as a Vehicle's): its stand-in body.
func _make_proxy(r: Remote) -> RigidBody3D:
	var body := RigidBody3D.new()
	body.gravity_scale = 0.0
	body.can_sleep = false
	body.lock_rotation = true
	body.mass = float(r.entry.specs.massKg)
	body.collision_layer = VehicleConsts.LAYER_PROXY
	body.collision_mask = VehicleConsts.LAYER_CAR
	body.linear_damp_mode = RigidBody3D.DAMP_MODE_REPLACE
	body.linear_damp = 0.0
	body.contact_monitor = true
	body.max_contacts_reported = 8
	var H := minf(r.entry.dims.height, 1.3)
	var hy := maxf(0.22, (H * 0.8 - 0.3) / 2.0)
	var z_mid: float = (r.entry.wheels.FL.position[2] + r.entry.wheels.RL.position[2]) / 2.0
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(r.entry.dims.width * 0.88, hy * 2.0, r.entry.dims.length * 0.92)
	cs.shape = box
	cs.position = Vector3(0, 0.3 + hy, z_mid)
	body.add_child(cs)
	body.global_position = r.visual.position
	add_child(body)
	return body

## Contact rule, every physics step: the other cars' stand-ins towards where they are at that step's time (their
## velocity plus a pull onto the pose: PROXY_TAU_S). Velocities, not positions: the solver then shares a hit by the masses.
func move_kinematics(_dt: float) -> void:
	for r: Remote in remotes.values():
		var body := r.body
		if body == null:
			continue
		var o: Node3D = r.visual
		var tgt := o.global_position
		var p := body.global_position
		var e := tgt - p
		var hidden := not o.visible or not r.buffer.has_data() or remote_in_pit(r.id)
		if hidden or e.length_squared() > PROXY_SNAP_M * PROXY_SNAP_M:
			body.global_position = tgt
			if not r.ghosted:
				body.collision_layer = 0
			r.ghosted = true
			r.set_v = r.vel
		else:
			if r.ghosted and clear_of_mine(tgt.x, tgt.z, 5.5):
				body.collision_layer = VehicleConsts.LAYER_PROXY
				r.ghosted = false
			var k := 1.0 / PROXY_TAU_S
			r.set_v = r.vel + Vector3(clampf(e.x * k, -PROXY_PULL_MS, PROXY_PULL_MS), clampf(e.y * k, -PROXY_PULL_MS, PROXY_PULL_MS), clampf(e.z * k, -PROXY_PULL_MS, PROXY_PULL_MS))
		body.linear_velocity = r.set_v
		body.global_transform.basis = o.global_transform.basis
	# the safety car's box follows its path (solid only on track)
	if sc != null and sc.body != null:
		if not sc.visible:
			if sc.solid:
				sc.body.collision_layer = 0
			sc.solid = false
		elif not sc.solid:
			var p2: Vector3 = sc.visual.global_position
			if cars_clear_of(p2.x, p2.z, 6.5):
				sc.body.global_transform = sc.visual.global_transform
				sc.body.collision_layer = VehicleConsts.LAYER_PROXY
				sc.solid = true
		else:
			sc.body.linear_velocity = sc.vel + (sc.visual.global_position - sc.body.global_position) / PROXY_TAU_S
			sc.body.global_transform.basis = sc.visual.global_transform.basis

## Crashes throw parts off (the user, 2026-11-16: bumpers flying off): a bumper once its zone of damage (front or
## rear) passes TEAR_AT or one hit adds TEAR_JUMP, the wing at heavier rear damage. push: the hit's (world, m/s).
func tear_parts(visual: CarVisual, zones: PackedFloat32Array, before: PackedFloat32Array, vel: Vector3, push: Vector3) -> void:
	if visual == null:
		return
	# repaired (another driver's bodywork back near new): the parts are back on
	if not visual.detached.is_empty() and zones[0] < 0.05 and zones[1] < 0.05:
		visual.restore_parts()
		return
	for part: String in TEAR_AT:
		if visual.detached.has(part):
			continue
		var z: int = TEAR_AT[part][0]
		var at: float = TEAR_AT[part][1]
		var jump := zones[z] - before[z]
		if zones[z] >= at or (part != "wing" and jump >= TEAR_JUMP):
			visual.detach(part, vel, push, self)

## No car contact in the pit lane (the user, 2026-11-16): a car simulated here that is in the pit lane passes
## through the others, and they through it; it is solid again once out of the lane and clear of every car (it never
## turns solid inside another).
func pit_lane_contact() -> void:
	for sv: Array in simulated():
		var id: String = sv[0]
		var v: Vehicle = sv[1]
		var in_lane := false
		if id == me:
			in_lane = pit != null and pit.in_lane
		else:
			for r: Remote in remotes.values():
				if r.id == id and r.bot != null:
					in_lane = r.bot.ai.in_pit_lane or (r.bot.pit != null and r.bot.pit.in_lane)
		var want := not in_lane
		if want == v.contact_on():
			continue
		if want:
			var p := v.global_position
			if not cars_clear_of_except(p.x, p.z, 5.5, v):
				continue
		v.set_contact(want)

## A remote driver is in the pit lane (from the standings): their proxy body is not solid there.
func remote_in_pit(id: String) -> bool:
	var o: Variant = _standing(id)
	return o != null and bool(o.get("inPit", false))

## No car (simulated here, or another driver's) within r (m) of (x, z), apart from `skip`.
func cars_clear_of_except(x: float, z: float, r: float, skip: Node3D) -> bool:
	for sv: Array in simulated():
		var v: Node3D = sv[1]
		if v == skip:
			continue
		var p: Vector3 = v.global_position
		if (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) < r * r:
			return false
	for rr: Remote in remotes.values():
		if rr.bot != null or rr.visual == null or not rr.visual.visible:
			continue
		var q: Vector3 = rr.visual.global_position
		if (q.x - x) * (q.x - x) + (q.z - z) * (q.z - z) < r * r:
			return false
	return true

## No car simulated here within r (m) of (x, z).
func clear_of_mine(x: float, z: float, r: float) -> bool:
	for sv: Array in simulated():
		var p: Vector3 = sv[1].global_position
		if (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) < r * r:
			return false
	return true

## No car (mine, the bots, the others' boxes) within r (m) of (x, z).
func cars_clear_of(x: float, z: float, r: float) -> bool:
	var near := func(px: float, pz: float) -> bool: return (px - x) * (px - x) + (pz - z) * (pz - z) < r * r
	if not spectator and near.call(vehicle.global_position.x, vehicle.global_position.z):
		return false
	for o: Remote in remotes.values():
		var p: Vector3 = o.bot.vehicle.global_position if o.bot != null else o.visual.global_position
		if near.call(p.x, p.z):
			return false
	return true

## Contact rule, after each solver step: what a hit did to the cars simulated here is capped (CAR_CONTACT), and what the
## stand-ins took from them is added to the bump for their owners.
func after_contacts() -> void:
	var now := Time.get_ticks_msec() as float
	for sv: Array in simulated():
		var v: Vehicle = sv[1]
		if v._touching_car():
			hit_at[sv[0]] = now
	for r: Remote in remotes.values():
		var body := r.body
		if body == null or r.ghosted:
			continue
		var v := body.linear_velocity
		var dx := v.x - r.set_v.x
		var dz := v.z - r.set_v.z
		if dx * dx + dz * dz < 0.0025:
			continue
		for sv: Array in simulated():
			var veh: Vehicle = sv[1]
			var touching := false
			for b in body.get_colliding_bodies():
				if b == veh:
					touching = true
			if not touching:
				continue
			var m: float = r.entry.specs.massKg
			var p := body.global_position
			var jx := m * dx
			var jz := m * dz
			r.bump.x += jx
			r.bump.z += jz
			# yaw from where it was hit: (contact - centre) x J
			var c := veh.global_position
			r.bump_yaw += ((c.z + p.z) / 2.0 - p.z) * jx - ((c.x + p.x) / 2.0 - p.x) * jz
			r.bump_from = sv[0]
			last_contact["%s|%s" % [sv[0], r.id]] = now
			break

## Contact rule: the impulses the other cars took here, to whoever simulates them (at most every BUMP_SEND_MS).
func send_bumps() -> void:
	var now := Time.get_ticks_msec() as float
	for r: Remote in remotes.values():
		if r.body == null or now - r.bump_sent < BUMP_SEND_MS:
			continue
		var j := Vector2(r.bump.x, r.bump.z).length()
		if j < BUMP_MIN:
			# a graze too light to send is dropped once it is old
			if now - r.bump_sent > 400.0:
				r.bump = Vector3.ZERO
				r.bump_yaw = 0.0
			continue
		var k := minf(1.0, Protocol.MAX_BUMP_IMPULSE / j)
		var cl := func(x: float) -> int: return roundi(clampf(x * k, -Protocol.MAX_BUMP_IMPULSE, Protocol.MAX_BUMP_IMPULSE))
		var msg := {"t": "bump", "to": r.id, "ix": cl.call(r.bump.x), "iy": 0, "iz": cl.call(r.bump.z), "ty": cl.call(r.bump_yaw)}
		if r.bump_from != me:
			msg["from"] = r.bump_from
		conn.send_json(msg)
		r.bump = Vector3.ZERO
		r.bump_yaw = 0.0
		r.bump_sent = now

## Another car's owner saw it hit one of the cars simulated here, and this world did not: the hit, applied now.
func _on_bump(m: Dictionary) -> void:
	if not contact:
		return
	var v: Vehicle = null
	if m.to == me:
		v = null if spectator else vehicle
	else:
		var rr := remote_by_id(m.to)
		if rr != null and rr.bot != null:
			v = rr.bot.vehicle
	if v == null:
		return
	if Time.get_ticks_msec() - last_contact.get("%s|%s" % [m.to, m["from"]], -1e9) < BUMP_DEDUPE_MS:
		return
	v.apply_central_impulse(Vector3(m.ix, 0, m.iz))
	v.apply_torque_impulse(Vector3(0, m.ty, 0))
	hit_at[m.to] = Time.get_ticks_msec()
	if v == vehicle:
		var j := Vector2(m.ix, m.iz).length()
		if j > 1.0:
			impact_damage(j * 0.6, Vector3(m.ix / j, 0, m.iz / j), true)

## Cars sunk under the road are put back on it (mine and the bots I run).
func rescue_cars() -> void:
	for sv: Array in simulated():
		sv[1].rescue_below_ground()

## Touched by another car in the last second (FLAG_HIT: the tracker waives what follows a hit).
func recently_hit(id: String) -> bool:
	return Time.get_ticks_msec() - hit_at.get(id, -1e9) < 1000.0

## Contact force events -> damage on my car.
func drain_contacts() -> void:
	for ev: Dictionary in vehicle.consume_impacts():
		# only walls and barriers damage the car; touching the road or grass never does (with the contact rule, other
		# cars too: a box that can't give way hits harder than a car that would, so less)
		var other: Variant = ev.other
		var is_car: bool = other is Vehicle or (other is CollisionObject3D and (other.collision_layer & VehicleConsts.LAYER_PROXY) != 0)
		var is_wall: bool = other != null and other.has_meta("surface") and other.get_meta("surface") == "wall"
		if not is_car and not is_wall:
			continue
		var imp: Vector3 = ev.impulse
		var impulse := imp.length() * (0.6 if is_car else 1.0)
		# rubbing a wall: the scrape, for as long as the contact lasts
		if not is_car and vehicle.telemetry.speed > 2.0 and snd != null:
			snd.scrape(impulse / (vehicle.mass * 7.0))
		impact_damage(impulse, imp.normalized(), is_car)

## A hit on my car: impulse (N*s) pushing it along push (world, unit). Damage, dents, sound, rumble.
func impact_damage(impulse: float, push: Vector3, is_car: bool = false) -> void:
	var local := vehicle.global_transform.basis.inverse() * push
	var flats: int = damage.punctured.count(true)
	var before_zones := damage.zones.duplicate()
	var res := damage.impact(impulse, -local.x, -local.z, vehicle.mass)
	if res.is_empty():
		return
	incident(4 if is_car else 2)
	var sev := minf(1.0, impulse / (vehicle.mass * 7.0))
	if damage.punctured.count(true) > flats:
		flash(I18n.t("Puncture! Bring it back to the pits"), 3500.0, "bad")
		if snd != null:
			snd.impact(1.0)
	if snd != null:
		snd.impact(sev)
	Gamepad.rumble(impulse / (vehicle.mass * 5.0))
	var loc_dir := Vector3(-local.x, 0, -local.z).normalized()
	var p := box_point(loc_dir, vehicle.car)
	my_visual.dent(p, -loc_dir, res.amount * 2.0)
	# a heavy hit tears parts off (bumpers, the wing)
	tear_parts(my_visual, damage.zones, before_zones, vehicle.linear_velocity, vehicle.global_transform.basis * (-loc_dir) * minf(12.0, impulse / vehicle.mass * 2.0))
	# sparks and debris where it hit, and the driver's head thrown away from the hit
	var world := vehicle.global_transform * p
	if crash_fx != null:
		var wh := vehicle.wheels
		var ground_y := 0.0
		for w in wh:
			ground_y += w.cp.y
		ground_y /= wh.size()
		crash_fx.hit(world, sev, vehicle.linear_velocity, Vector3(push.x, 0, push.z), ground_y, Color(my_visual.entry.color))
	cockpit.jolt(-loc_dir.x * sev * 0.9, sev * 0.25, -loc_dir.z * sev * 0.9)
	vehicle.drivetrain.power_scale = damage.power_scale()

func _round_zones() -> Array:
	var out: Array = []
	for z in damage.zones:
		out.append(roundf(z * 100.0) / 100.0)
	return out
