class_name Vehicle
extends RigidBody3D
## The car: a Jolt rigid body with a custom raycast-wheel model (port of physics/vehicle.ts).
## Local axes are the web game's: +X left, +Y up, +Z forward. Everything is computed in _physics_process, once per
## fixed step, before the physics server steps; forces are applied with apply_force (cleared by the server each step).

const C = preload("res://scripts/physics/vehicle_consts.gd")

## Ground rays: ground.cast(origin, dir, max_dist) -> {} or {dist, pos, normal, surface}. Must ignore the car itself.
var ground
var car: Dictionary
var specs: Dictionary
var damage: DamageState
var assists := {"tc": 0, "abs": true, "stability": false, "steering": false}

var mass_kg: float
var com_y: float
var com_z: float
var wheelbase: float
var track_width: float
var max_steer: float
var wheels: Array[Wheel] = []
var drivetrain: Drivetrain
var tire := TireModel.new()
var kbd := KeyboardDriver.new()
var _base_inertia: Vector3
var steer_angle := 0.0
## Effective pedal values after filtering (brake lights and HUD).
var pedals := {"throttle": 0.0, "brake": 0.0}
var _motion := {"vx": 0.0, "vy": 0.0, "r": 0.0, "a": 1.3, "b": 1.3, "wheelbase": 2.6, "maxLockRad": 0.4, "alphaPeak": 0.115}
## Grip of the fitted compound for the current water on the track.
var weather_grip := 1.0
## Rubber on the track (VehicleConsts.track_rubber).
var rubber := 1.0
var compound: Dictionary = Tyres.COMPOUNDS.medium
## Track water 0..1 (tyre wear).
var wetness := 0.0
## The track's puddles (WetFx), or null: each wheel asks how much water is under it.
var puddles = null
## Aerodynamic wake of a car ahead.
var wake := {"drag": 1.0, "downforce": 1.0, "strength": 0.0}
## Pit lane speed limiter (m/s), or -1 when off.
var speed_limit_ms := -1.0
## Fuel on board (l), or -1 without the fuel rule.
var fuel_l := -1.0
var fuel_used_l := 0.0
var _mass_timer := 0.0
var setup: Dictionary = C.neutral_setup()
var ambient_c := 20.0
var track_c := 25.0
var air_density: float = C.RHO
var frozen := false
var telemetry := {
	"speed": 0.0, "forwardSpeed": 0.0, "rpm": 0.0, "gear": 1, "slipBody": 0.0, "absActive": false, "tcActive": false,
	"airborne": 0.0, "surfaceRumble": 0.0, "longAccel": 0.0, "latAccel": 0.0,
}
## Hard hits since the last consume_impacts(): [{impulse: Vector3, point: Vector3 (global), other: Node}].
var impacts: Array = []
## Set by the session: the driver's controls for the next step, and whether this car steps itself.
var controls := Controls.new()
var auto_step := true

var _reverse_timer := 0.0
var _tc_cut := 0.0
var _prev_vel := Vector3.ZERO
var _contact_on := false
var _walls_on := true
var _pre_vel := Vector3.ZERO
var _pre_ang := Vector3.ZERO
var _last_good := Transform3D.IDENTITY
var _shape: CollisionShape3D
var _material := PhysicsMaterial.new()
var _tmp_hit := {}

## Build the car from its cars.json entry. Call before adding to the tree.
func setup_car(car_entry: Dictionary, ground_query, assist_set: Dictionary, damage_state: DamageState) -> void:
	car = car_entry
	specs = car.specs
	ground = ground_query
	assists = assist_set
	damage = damage_state
	mass_kg = float(specs.massKg)
	wheelbase = float(car.wheelbase)
	track_width = (float(car.trackFront) + float(car.trackRear)) / 2.0
	max_steer = deg_to_rad(float(specs.maxSteerDeg))
	var zf: float = car.wheels.FL.position[2]
	var zr: float = car.wheels.RL.position[2]
	com_z = zr + (zf - zr) * float(specs.weightFront)
	com_y = float(specs.comHeightM)
	drivetrain = Drivetrain.new(specs)

	can_sleep = false
	linear_damp_mode = RigidBody3D.DAMP_MODE_REPLACE
	angular_damp_mode = RigidBody3D.DAMP_MODE_REPLACE
	linear_damp = 0.0
	angular_damp = 0.05
	gravity_scale = 1.0
	# no continuous collision detection: at 120 Hz a car moves under 0.7 m per step, far less than its own size
	continuous_cd = false
	contact_monitor = true
	max_contacts_reported = 8

	var L: float = car.dims.length
	var W: float = car.dims.width
	var H: float = minf(car.dims.height, 1.3)
	# the body only needs to hit walls and barriers (the wheels carry the car), so it starts 30 cm up
	var bottom := 0.3
	var hx := W * 0.44
	var hy := maxf(0.22, (H * 0.8 - bottom) / 2.0)
	var hz := L * 0.46
	_material.friction = 0.35
	_material.bounce = 0.05
	physics_material_override = _material
	_shape = CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(hx * 2.0, hy * 2.0, hz * 2.0)
	_shape.shape = box
	_shape.position = Vector3(0.0, bottom + hy, (zf + zr) / 2.0)
	add_child(_shape)
	collision_layer = C.LAYER_CAR
	collision_mask = C.LAYER_TRACK | C.LAYER_WALL

	var m := mass_kg
	_base_inertia = Vector3((m / 12.0) * (H * H + L * L) * 0.75, (m / 12.0) * (W * W + L * L) * 0.8, (m / 12.0) * (W * W + H * H) * 0.7)
	center_of_mass_mode = RigidBody3D.CENTER_OF_MASS_MODE_CUSTOM
	center_of_mass = Vector3(0.0, com_y, com_z)
	mass = m
	inertia = _base_inertia

	var front_load := m * C.G * float(specs.weightFront) / 2.0
	var rear_load := m * C.G * (1.0 - float(specs.weightFront)) / 2.0
	# symmetric axles for the physics (source models are a few millimetres lopsided, which would pull)
	var geom := {}
	for pair in [["FL", "FR"], ["RL", "RR"]]:
		var wa: Dictionary = car.wheels[pair[0]]
		var wb: Dictionary = car.wheels[pair[1]]
		var x: float = (absf(wa.position[0]) + absf(wb.position[0])) / 2.0
		var y: float = (wa.position[1] + wb.position[1]) / 2.0
		var z: float = (wa.position[2] + wb.position[2]) / 2.0
		var r: float = (wa.radius + wb.radius) / 2.0
		geom[pair[0]] = [Vector3(x, y, z), r]
		geom[pair[1]] = [Vector3(-x, y, z), r]
	for k in ["FL", "FR", "RL", "RR"]:
		var g: Array = geom[k]
		wheels.append(Wheel.new(k, g[0], g[1], specs, front_load if k[0] == "F" else rear_load))
	for w in wheels:
		w.driven = specs.drivetrain == "AWD" or (not w.front if specs.drivetrain == "RWD" else w.front)

## The air of the session (temperatures() in the shared weather code).
func set_air(air_c: float, track_temp_c: float, density: float) -> void:
	ambient_c = air_c
	track_c = track_temp_c
	air_density = density
	drivetrain.air_scale = C.engine_air_scale(specs, density)

## Tyres straight out of the garage: a little above air temperature.
func set_tyre_temps(c: float) -> void:
	for w in wheels:
		w.temp = c

## A new set of tyres (pit stop): new tread, garage temperature, pressures set now.
func fit_tyres(comp: Dictionary, temp_c: float) -> void:
	compound = comp
	for w in wheels:
		w.wear = 0.0
		w.flat_spot = 0.0
		w.temp = temp_c
		w.set_c = temp_c
		var s = setup.pressure
		w.cold_psi = s[0 if w.front else 1] if s != null else C.ideal_cold_psi(comp.optimumC, temp_c)
		w.pressure = w.cold_psi

## One new tyre (the pit crew fits them one at a time).
func fit_wheel(i: int, comp: Dictionary, temp_c: float) -> void:
	compound = comp
	var w := wheels[i]
	w.wear = 0.0
	w.temp = temp_c
	w.set_c = temp_c
	var s = setup.pressure
	w.cold_psi = s[0 if w.front else 1] if s != null else C.ideal_cold_psi(comp.optimumC, temp_c)
	w.pressure = w.cold_psi

## The garage setup: ride height and dampers. Before place().
func apply_setup(new_setup: Dictionary) -> void:
	setup = new_setup
	for w in wheels:
		var a := 0 if w.front else 1
		w.rest_len = w.rest_len0 + setup.ride[a]
		w.travel = maxf(0.02, w.travel0 + setup.ride[a])
		w.c_bump = w.c_bump0 * setup.bump[a]
		w.c_rebound = w.c_rebound0 * setup.rebound[a]

## Fuel load (the fuel rule): the car's mass follows it. Pass -1 for no fuel rule.
func set_fuel(litres: float) -> void:
	fuel_l = -1.0 if litres < 0.0 else clampf(litres, 0.0, C.FUEL.tankL)
	_update_mass()

func _update_mass() -> void:
	var m := mass_kg + (0.0 if fuel_l < 0.0 else (fuel_l - C.FUEL.refL) * C.FUEL.kgPerL)
	mass = m
	inertia = _base_inertia * (m / mass_kg)

## Cars collide with each other (the contact rule) or pass through (ghosts).
func set_contact(on: bool) -> void:
	_contact_on = on
	_apply_groups()

## The body against the circuit's walls and barriers (off for a bot in the pit lane).
func set_walls(on: bool) -> void:
	_walls_on = on
	_apply_groups()

func _apply_groups() -> void:
	var m := C.LAYER_TRACK
	if _walls_on:
		m |= C.LAYER_WALL
	if _contact_on:
		m |= C.LAYER_CAR | C.LAYER_PROXY
	collision_layer = C.LAYER_CAR
	collision_mask = m

## Grip left in the tyres from wear and temperature, of the weaker axle (for the AI's speed profile).
func tyre_grip_avg() -> float:
	var f := 0.0
	var r := 0.0
	for w in wheels:
		var g := Tyres.wear_grip(w.wear) * C.tyre_temp_grip(w.temp, compound.optimumC)
		if w.front:
			f += g
		else:
			r += g
	return minf(f, r) / 2.0

func is_reverse() -> bool:
	return drivetrain.gear < 0

func rpm_ratio() -> float:
	return drivetrain.rpm / float(specs.redlineRpm)

func shift(dir: int) -> void:
	drivetrain.request_shift(dir)

## Angular speed (rad/s) at the wheels in the current gear at a given rpm.
func wheel_omega_at(rpm: float) -> float:
	var r := drivetrain.ratio()
	return 0.0 if r == 0.0 else (rpm * Drivetrain.RPM_TO_RADS) / r

func world_com() -> Vector3:
	return global_transform * center_of_mass

## Teleport through the physics server (valid at any time, also with the body in the tree).
func _teleport(t: Transform3D, lin: Vector3, ang: Vector3) -> void:
	PhysicsServer3D.body_set_state(get_rid(), PhysicsServer3D.BODY_STATE_TRANSFORM, t)
	PhysicsServer3D.body_set_state(get_rid(), PhysicsServer3D.BODY_STATE_LINEAR_VELOCITY, lin)
	PhysicsServer3D.body_set_state(get_rid(), PhysicsServer3D.BODY_STATE_ANGULAR_VELOCITY, ang)
	global_transform = t
	linear_velocity = lin
	angular_velocity = ang

## Place the car (chassis origin at ground level) with a heading.
func place(x: float, y: float, z: float, yaw: float) -> void:
	# on the ground under (x, z) when it can be found: dropped from a few centimetres the car bounced on its springs
	var gh: Dictionary = ground.cast(Vector3(x, y + 1.2, z), Vector3.DOWN, 3.0)
	var gy: float = gh.pos.y + 0.005 if not gh.is_empty() else y + 0.05
	_teleport(Transform3D(Basis(Vector3.UP, yaw), Vector3(x, gy, z)), Vector3.ZERO, Vector3.ZERO)
	for w in wheels:
		w.omega = 0.0
		w.compression = w.fz0 / w.k
		w.prev_compression = w.compression
		w.alpha_relax = 0.0
	kbd.reset()
	drivetrain.set_gear(1)
	drivetrain.rpm = float(specs.idleRpm)
	steer_angle = 0.0
	_pre_vel = Vector3.ZERO
	_pre_ang = Vector3.ZERO
	_prev_vel = Vector3.ZERO

## A car pushed under the road has nothing under its wheels and falls forever: the road within 2 m above its origin
## puts it back on top, upright, keeping heading and horizontal speed. Returns true if moved.
func rescue_below_ground() -> bool:
	var p := global_position
	var h: Dictionary = ground.cast(p + Vector3(0, 2, 0), Vector3.DOWN, 2.2)
	if h.is_empty() or h.surface == "wall" or h.pos.y < p.y + 0.3 or h.normal.y < 0.6:
		return false
	var fwd := global_transform.basis.z
	var yaw := atan2(fwd.x, fwd.z)
	var v := linear_velocity
	_teleport(Transform3D(Basis(Vector3.UP, yaw), Vector3(p.x, h.pos.y + 0.05, p.z)), Vector3(v.x, 0, v.z), Vector3(0, angular_velocity.y, 0))
	for w in wheels:
		w.compression = w.fz0 / w.k
		w.prev_compression = w.compression
	return true

## After a solver step in which this car touched another: cap what the contact did (CAR_CONTACT).
func limit_car_contact() -> void:
	var cc := C.CAR_CONTACT
	var v := linear_velocity
	var w := angular_velocity
	var d := Vector3(v.x - _pre_vel.x, 0.0, v.z - _pre_vel.z)
	var dh := d.length()
	if dh > cc.maxDv:
		d *= cc.maxDv / dh
	linear_velocity = Vector3(_pre_vel.x + d.x, _pre_vel.y + clampf(v.y - _pre_vel.y, -cc.maxDvy, cc.maxDvy), _pre_vel.z + d.z)
	# the angular change split along the car's axes: yaw (up) kept, roll (forward) and pitch (left) capped
	var b := global_transform.basis
	var dw := w - _pre_ang
	var up := dw.dot(b.y)
	var roll := clampf(dw.dot(b.z), -cc.maxDwTilt, cc.maxDwTilt)
	var pitch := clampf(dw.dot(b.x), -cc.maxDwTilt, cc.maxDwTilt)
	angular_velocity = _pre_ang + up * b.y + roll * b.z + pitch * b.x

func consume_impacts() -> Array:
	var out := impacts
	impacts = []
	return out

func _integrate_forces(state: PhysicsDirectBodyState3D) -> void:
	# contact forces for the damage model: Rapier's threshold, a force of 4 x the car's mass
	var dt := state.step
	for i in state.get_contact_count():
		var imp := state.get_contact_impulse(i)
		if imp.length() / dt > mass_kg * 4.0:
			impacts.append({"impulse": imp, "point": state.get_contact_collider_position(i), "other": state.get_contact_collider_object(i)})

func _touching_car() -> bool:
	for b in get_colliding_bodies():
		if b is Vehicle:
			return true
		if b is CollisionObject3D and (b.collision_layer & C.LAYER_PROXY) != 0:
			return true
	return false

func _physics_process(dt: float) -> void:
	Prof.b("vehicle")
	_phys_inner(dt)
	Prof.e("vehicle")

func _phys_inner(dt: float) -> void:
	if not auto_step or ground == null:
		return
	if _touching_car():
		limit_car_contact()
	step(dt, controls)
	_pre_vel = linear_velocity
	_pre_ang = angular_velocity

## Cast a ray in world space through the ground query.
func _cast(origin: Vector3, dir: Vector3, max_dist: float) -> Dictionary:
	return ground.cast(origin, dir, max_dist)

## One fixed physics step (before the physics server steps).
func step(dt: float, c: Controls) -> void:
	Prof.start()
	# safety net: a solver blow-up must never lose the car
	var gt := global_transform
	if not (is_finite(gt.origin.x) and is_finite(gt.origin.y) and is_finite(gt.origin.z)):
		var g := _last_good
		_teleport(Transform3D(g.basis, g.origin + Vector3(0, 0.3, 0)), Vector3.ZERO, Vector3.ZERO)
		for w in wheels:
			w.omega = 0.0
		return
	_last_good = gt
	var bs := gt.basis
	var l := bs.x
	var u := bs.y
	var f := bs.z
	var p := gt.origin
	var v := linear_velocity
	var av := angular_velocity
	var com := world_com()
	var s := specs
	var dmg := damage

	var v_f := v.dot(f)
	var v_l := v.dot(l)
	var speed := v.length()
	var tel := telemetry
	tel.speed = speed
	tel.forwardSpeed = v_f
	tel.slipBody = atan2(v_l, absf(v_f)) if absf(v_f) > 3.0 else 0.0
	var dv := v - _prev_vel
	tel.longAccel = dv.dot(f) / dt
	tel.latAccel = dv.dot(l) / dt
	_prev_vel = v

	if frozen:
		linear_velocity = Vector3(v.x * 0.8, v.y, v.z * 0.8)

	Prof.mark("v.pre")
	# ---------------------------------------------------- gear logic
	var dt2 := drivetrain
	var throttle_in := c.throttle
	var brake_in := c.brake
	var hb_torque := c.handbrake * 700.0
	if c.digital:
		var m := _motion
		m.vx = v_f
		m.vy = v_l
		m.r = av.dot(u)
		m.a = float(car.wheels.FL.position[2]) - com_z
		m.b = com_z - float(car.wheels.RL.position[2])
		m.wheelbase = wheelbase
		m.maxLockRad = max_steer
		m.alphaPeak = tire.p.alpha_peak
		kbd.step(dt, c, m)
		throttle_in = kbd.throttle
		brake_in = kbd.brake
		hb_torque = kbd.handbrake_torque(speed)
	# pit lane speed limiter
	if speed_limit_ms >= 0.0 and v_f > speed_limit_ms:
		throttle_in = 0.0
		brake_in = maxf(brake_in, minf(0.7, (v_f - speed_limit_ms) * 0.25))
	pedals.throttle = throttle_in
	pedals.brake = brake_in
	var throttle := 0.0 if frozen else throttle_in
	var brake := brake_in
	if not dt2.manual or dt2.gear <= 0:
		# reverse engagement: hold brake while (almost) stopped
		if dt2.gear >= 1 and absf(v_f) < 0.8 and c.brake > 0.9 and c.throttle < 0.05:
			_reverse_timer += dt
			if _reverse_timer > 0.35:
				dt2.set_gear(-1)
		elif dt2.gear == -1 and absf(v_f) < 0.8 and c.brake > 0.9:
			_reverse_timer += dt
			if _reverse_timer > 0.2:
				dt2.set_gear(1)
		else:
			_reverse_timer = 0.0

	# ---------------------------------------------------- assists
	tel.tcActive = false
	if assists.tc > 0 and throttle > 0.0:
		var thr := 0.07 if assists.tc == 2 else 0.13
		var worst := 0.0
		for w in wheels:
			if w.driven and w.contact:
				worst = maxf(worst, absf(w.slip_ratio))
		var target := minf(0.85, maxf(0.0, (worst - thr) / 0.12))
		_tc_cut += (target - _tc_cut) * minf(1.0, dt * 25.0)
		if _tc_cut > 0.05:
			tel.tcActive = true
		throttle *= 1.0 - _tc_cut
	else:
		_tc_cut = 0.0
	var esc_brake := 0.0
	var esc_wheel := -1
	if assists.stability and absf(v_f) > 8.0:
		var beta0: float = tel.slipBody
		if absf(beta0) > 0.09:
			throttle *= 0.4
			esc_brake = minf(2500.0, (absf(beta0) - 0.09) * 20000.0)
			esc_wheel = 1 if beta0 > 0.0 else 0

	# ---------------------------------------------------- steering
	var steer: float = kbd.steer_angle if c.digital else clampf(c.steer, -1.0, 1.0) * max_steer
	if assists.steering and absf(v_f) > 6.0:
		steer += clampf(-float(tel.slipBody) * 0.8, -0.15, 0.15)
	var pull := dmg.alignment()
	steer_angle = clampf(steer, -max_steer, max_steer) + pull
	var ack := 0.12 * signf(steer_angle)
	wheels[0].steer = steer_angle * (1.0 + ack)
	wheels[1].steer = steer_angle * (1.0 - ack)
	wheels[2].steer = 0.0
	wheels[3].steer = 0.0

	Prof.mark("v.gear_assist_steer")
	# ---------------------------------------------------- suspension
	var contacts := 0
	var rumble := 0.0
	for w in wheels:
		var hp := p + l * w.hx + u * w.hy + f * w.hz
		var max_d := w.rest_len + w.radius + dmg.ride_drop(w.key)
		var h := _cast(hp, -u, max_d)
		w.prev_compression = w.compression
		if not h.is_empty():
			w.contact = true
			contacts += 1
			w.spring_len = h.dist - w.radius
			w.compression = maxf(0.0, w.rest_len - w.spring_len)
			w.cp = h.pos
			w.n = h.normal
			w.surface = h.surface
			rumble = maxf(rumble, C.SURFACE_PROPS[h.surface].bumpy)
			w.water = puddles.depth_at(h.pos.x, h.pos.z) if puddles != null and h.surface != "grass" else 0.0
		else:
			w.water = 0.0
			w.contact = false
			w.spring_len = w.rest_len
			w.compression = 0.0
	tel.airborne = tel.airborne + dt if contacts == 0 else 0.0
	var flat := 0.0
	for w in wheels:
		flat = maxf(flat, w.flat_spot)
	tel.surfaceRumble = maxf(rumble, flat * 0.6 * minf(1.0, speed / 30.0))

	# spring + damper + anti-roll
	var arb_f: float = s.antiRollFront
	var arb_r: float = s.antiRollRear
	var CH := C.CHASSIS
	for i in 4:
		var w := wheels[i]
		if not w.contact:
			w.fz = 0.0
			continue
		var vel := (w.compression - w.prev_compression) / dt
		var avel := absf(vel)
		var dvv: float = avel * CH.damperLow if avel <= CH.damperKnee else CH.damperKnee * CH.damperLow + (avel - CH.damperKnee) * CH.damperHigh
		var damp: float = (w.c_bump if vel > 0.0 else w.c_rebound) * signf(vel) * dvv * dmg.damper_scale(w.key)
		var fs: float = w.k * w.compression + damp
		var other := wheels[i ^ 1]
		fs += (arb_f if w.front else arb_r) * (w.compression - other.compression)
		if w.compression > w.travel:
			fs += 350000.0 * (w.compression - w.travel)
		if w.flat_spot > 0.01:
			fs += w.flat_spot * 2600.0 * minf(1.0, speed / 25.0) * pow(maxf(0.0, cos(w.angle)), 16.0)
		w.fz = maxf(0.0, fs)

	Prof.mark("v.suspension")
	# ---------------------------------------------------- drivetrain
	var driven_omega := 0.0
	var n_driven := 0
	for w in wheels:
		if w.driven:
			driven_omega += w.omega
			n_driven += 1
	driven_omega /= maxf(1.0, n_driven)
	dt2.starved = fuel_l >= 0.0 and fuel_l <= 0.0
	var axle_torque := dt2.update(dt, throttle, driven_omega, speed)
	if fuel_l >= 0.0 and not frozen:
		var power := maxf(0.0, dt2.engine_torque) * dt2.rpm * Drivetrain.RPM_TO_RADS
		var used: float = (power / (C.FUEL.efficiency * C.FUEL.jPerL) + C.FUEL.idleLps) * dt
		fuel_l = maxf(0.0, fuel_l - used)
		fuel_used_l += used
		_mass_timer -= dt
		if _mass_timer <= 0.0:
			_mass_timer = 1.0
			_update_mass()
	tel.rpm = dt2.rpm
	tel.gear = dt2.gear
	var front_split: float = float(s.frontTorqueSplit) if s.drivetrain == "AWD" else (1.0 if s.drivetrain == "FWD" else 0.0)
	_split_axle(0, 1, axle_torque * front_split)
	_split_axle(2, 3, axle_torque * (1.0 - front_split))

	Prof.mark("v.drivetrain")
	# ---------------------------------------------------- brakes
	tel.absActive = false
	var brake_total: float = float(s.brakeTorqueNm) * brake
	var BT := C.BRAKE_TEMP
	for i in 4:
		var w := wheels[i]
		var bt: float = (brake_total * (s.brakeBiasFront if w.front else 1.0 - s.brakeBiasFront)) / 2.0 * C.brake_temp_factor(w.brake_temp, s.get("carbonBrakes", false))
		if assists.abs and bt > 0.0 and w.contact and absf(v_f) > 3.0:
			var target: float = tire.p.kappa_peak * 0.95
			var over: float = (-w.slip_ratio - target) / target
			if over > 0.0:
				w.abs_factor = maxf(0.1, w.abs_factor - dt * (12.0 + 80.0 * over))
			else:
				w.abs_factor = minf(1.0, w.abs_factor + dt * (4.0 - 6.0 * over))
			if w.abs_factor < 0.98:
				tel.absActive = true
			bt *= w.abs_factor
		else:
			w.abs_factor = 1.0
		if not w.front:
			bt += hb_torque
		if i == esc_wheel:
			bt += esc_brake
		w.brake_torque = bt
		var heat := absf(bt * w.omega) * (1.0 if w.front else 0.85)
		var cool: float = (BT.coolBase + BT.coolPerMs * speed) * (w.brake_temp - ambient_c)
		w.brake_temp += ((heat - cool) / BT.heatCapacity) * dt

	Prof.mark("v.brakes")
	# ---------------------------------------------------- tyres
	var SUB := 4
	var h_sub := dt / SUB
	var mu_base: float = float(s.tyreGrip) * weather_grip * rubber
	var roll_f := rad_to_deg(atan2(wheels[0].compression - wheels[1].compression, float(car.trackFront) if car.trackFront else 1.6))
	var roll_r := rad_to_deg(atan2(wheels[2].compression - wheels[3].compression, float(car.trackRear) if car.trackRear else 1.6))
	var TP := C.TYRE_PRESSURE
	var TT := C.TYRE_TEMP
	for w in wheels:
		var sin_s := sin(w.steer)
		var cos_s := cos(w.steer)
		var wf := f * cos_s + l * sin_s
		var nrm := w.n if w.contact else u
		wf -= nrm * wf.dot(nrm)
		var fl := wf.length()
		wf /= fl if fl != 0.0 else 1.0
		# lateral = n x forward (points to the car's left)
		var wl := nrm.cross(wf)

		if not w.contact:
			# free wheel: driven torque spins it, brakes stop it
			w.omega += (w.drive_torque / w.inertia) * dt
			var bd0 := (w.brake_torque / w.inertia) * dt
			w.omega = 0.0 if absf(w.omega) <= bd0 else w.omega - signf(w.omega) * bd0
			w.omega *= 0.998
			w.fx = 0.0
			w.fy = 0.0
			w.angle += w.omega * dt
			continue
		# velocity of the contact patch
		var r_vec := w.cp - com
		var cv := v + av.cross(r_vec)
		var vx := cv.dot(wf)
		var vy := cv.dot(wl)
		var surf: Dictionary = C.SURFACE_PROPS[w.surface]
		# hot pressure from the cold setting (gas law)
		w.pressure = (w.cold_psi + TP.atmPsi) * ((w.temp + 273.15) / (w.set_c + 273.15)) - TP.atmPsi
		var pr := maxf(0.5, w.pressure / TP.targetPsi)
		var stiff := pow(pr, TP.stiffExp)
		var flex_k := minf(1.8, pow(pr, -TP.flexExp))
		# camber in roll
		var body_roll := roll_f if w.front else roll_r
		var lean: float = CH.camberRoll * (body_roll if w.left else -body_roll)
		var off: float = lean - CH.camberRoll * CH.camberRollRef
		var camber_grip: float = 1.0 - minf(0.08, CH.camberGrip * off * off)
		var mu: float = (mu_base * surf.grip * dmg.grip_scale(w.key) * C.tyre_temp_grip(w.temp, compound.optimumC)
			* Tyres.wear_grip(w.wear) * C.pressure_grip(w.pressure) * camber_grip * (1.0 - 0.06 * w.flat_spot)
			* WetFx.aquaplane_grip(w.water, absf(vx), compound.get("id", "") == "wet"))
		var fz := w.fz
		var R := w.radius
		var den := maxf(absf(vx), 2.5)
		# lateral slip through the tyre's relaxation length, longer under load
		var alpha := atan2(-vy, maxf(absf(vx), 2.5))
		var relax: float = maxf(CH.relaxMin, minf(CH.relaxMax, CH.relaxM * sqrt(maxf(0.0, fz) / w.fz0)))
		w.alpha_relax += (alpha - w.alpha_relax) * minf(1.0, ((absf(vx) + 2.0) * dt) / relax)
		w.slip_angle = w.alpha_relax
		# initial slope of the longitudinal curve (N per unit slip ratio)
		var kx: float = (mu * fz * tire.bx * tire.cx) / tire.p.kappa_peak
		var fx_sum := 0.0
		var fy_sum := 0.0
		for sub in SUB:
			# implicit linear step for wheel spin, then evaluate the non-linear tyre at the new slip
			var tq := w.drive_torque
			var om: float = (w.omega + (h_sub / w.inertia) * (tq + (kx * R * vx) / den)) / (1.0 + (h_sub * kx * R * R) / (w.inertia * den))
			var kappa := (om * R - vx) / den
			if absf(kappa) > tire.p.kappa_peak * 0.7:
				# saturated: explicit step with the actual (flat) force
				var ff := tire.force(kappa, w.slip_angle * stiff, fz, w.fz0, mu)
				om = w.omega + ((tq - ff.x * R) / w.inertia) * h_sub
				kappa = (om * R - vx) / den
			# brakes: friction torque that can stop but never reverse the wheel
			var bd := (w.brake_torque / w.inertia) * h_sub
			if absf(om) <= bd:
				om = 0.0
			else:
				om -= signf(om) * bd
			w.omega = om
			kappa = (om * R - vx) / den
			var f2 := tire.force(kappa, w.slip_angle * stiff, fz, w.fz0, mu)
			fx_sum += f2.x
			fy_sum += f2.y
			w.slip_ratio = kappa
		var fx_t := fx_sum / SUB
		var fy_t := fy_sum / SUB
		# rolling resistance and deep-surface drag
		var roll := minf(1.0, absf(vx) / 0.5)
		fx_t -= signf(vx) * roll * fz * (surf.rolling + (surf.drag * absf(vx)) / 1000.0 + w.water * 0.035 * minf(1.0, absf(vx) / 20.0))
		w.fx = fx_t
		w.fy = fy_t
		w.angle += w.omega * dt
		# tyre temperature
		var slip_power: float = absf((fx_sum / SUB) * (w.omega * R - vx)) + absf(fy_t * vy) * (TT.frontScrub if w.front else 1.0)
		var past := maxf(0.0, w.temp - compound.optimumC - TT.windowC)
		var heat: float = (slip_power + (TT.rolling * fz + TT.flex * flex_k * (absf(fx_t) + absf(fy_t))) * absf(vx)) / (1.0 + past / TT.hotFadeC)
		var size: float = s.tyreHeatScale if s.has("tyreHeatScale") and s.tyreHeatScale != null else 1.0
		var cool: float = ((TT.coolBase + TT.coolPerMs * absf(vx)) * (1.0 + TT.wetCool * wetness) * (w.temp - ambient_c)
			+ (TT.road if w.contact else 0.0) * (w.temp - track_c)) * size
		w.temp += ((heat - cool) / (TT.heatCapacity * compound.heatCap * size)) * dt
		# tread wear from sliding energy, faster when overheated
		var over_t := maxf(0.0, w.temp - compound.optimumC - 15.0) / 30.0
		w.wear = minf(1.0, w.wear + slip_power * dt * Tyres.WEAR_PER_J * Tyres.wear_rate(compound, wetness) * (1.0 + over_t) * dmg.wear_scale(w.key) * (1.0 + w.flat_spot))
		# locked under braking at speed: the tread scrubs flat where it touches
		if w.contact and brake_in > 0.25 and absf(v_f) > 12.0 and w.slip_ratio < -0.75:
			w.flat_spot = minf(1.0, w.flat_spot + dt * 0.11 * minf(2.0, absf(v_f) / 40.0))
		# force at the contact patch, raised towards a roll centre to tame roll-over
		var fw := wf * fx_t + wl * fy_t + nrm * fz
		apply_force(fw, w.cp + u * 0.12 - p)

	Prof.mark("v.tyres")
	# ---------------------------------------------------- aero
	var beta := atan2(absf(v_l), absf(v_f)) if absf(v_f) > 8.0 else 0.0
	var yaw_keep: float = maxf(CH.yawMin, 1.0 - CH.yawLoss * beta * beta)
	var drag_area: float = float(s.dragArea) * dmg.drag_scale() * wake.drag * (1.0 + CH.yawDrag * beta * beta)
	var fd := 0.5 * air_density * drag_area * speed
	apply_central_force(-fd * v)
	var W0 := wheels
	var heave_mm: float = ((W0[0].compression + W0[1].compression - (2.0 * W0[0].fz0) / W0[0].k + W0[2].compression + W0[3].compression - (2.0 * W0[2].fz0) / W0[2].k) / 4.0) * 1000.0
	var heave := clampf(1.0 + CH.heavePerMm * heave_mm, 1.0 - CH.heaveMax, 1.0 + CH.heaveMax)
	var df: float = 0.5 * air_density * float(s.downforceArea) * wake.downforce * v_f * v_f * yaw_keep * heave
	var pitch_mm := int((((W0[0].compression + W0[1].compression) / 2.0 - W0[0].fz0 / W0[0].k - ((W0[2].compression + W0[3].compression) / 2.0 - W0[2].fz0 / W0[2].k)) * 1000.0))
	var shift_bal: float = clampf(pitch_mm * CH.balancePerMm, -CH.balanceMax, CH.balanceMax) + CH.yawRear * (1.0 - yaw_keep)
	var df_f0: float = df * maxf(0.2, minf(0.7, float(s.aeroBalanceFront) + shift_bal))
	var df_f: float = df_f0 * dmg.downforce_front()
	var df_r: float = (df - df_f0) * dmg.downforce_rear()
	var zf: float = car.wheels.FL.position[2]
	var zr: float = car.wheels.RL.position[2]
	apply_force(-u * df_f, f * zf)
	apply_force(-u * df_r, f * zr)

	# parking brake when stopped with nothing pressed keeps the car from creeping on slopes
	if speed < 0.25 and throttle_in < 0.02 and contacts >= 3:
		linear_velocity = Vector3(v.x * 0.9, v.y, v.z * 0.9)

## Limited-slip differential: open split plus a speed-difference locking torque.
func _split_axle(a: int, b: int, torque: float) -> void:
	var wa := wheels[a]
	var wb := wheels[b]
	if torque == 0.0 and not wa.driven:
		wa.drive_torque = 0.0
		wb.drive_torque = 0.0
		return
	var CH := C.CHASSIS
	var lock: float = float(specs.diffLock) * (1.0 if torque >= 0.0 else CH.diffCoast)
	var d := wa.omega - wb.omega
	var limit: float = CH.diffPreload + lock * absf(torque) * 0.5
	var bias := clampf(d * 90.0, -limit, limit)
	wa.drive_torque = torque / 2.0 - bias
	wb.drive_torque = torque / 2.0 + bias
