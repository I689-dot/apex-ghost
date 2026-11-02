class_name PitCrews
extends Node3D
## The crews at the pit boxes (port of the rendering half of game/pitCrew.ts): each entrant's crew waits in front of its
## garage; when its car stops in the box the stop's timeline (PitCrew.stop_timeline) drives them: a wheel man per
## corner, the refueller, the chief. Near the camera the crew are the rigged mechanic of assets/vegetation/mechanic_rig.glb
## (posed by code: its bones follow the same joints as the simple figures); further away, and until the model has loaded,
## simple figures (fire suits in the car's colour, helmets) drawn as instanced meshes. Each garage also gets a tool
## trolley and two engineers in white overalls.

## Crews within this many metres of the camera are drawn with the rigged model.
const RIG_RANGE := 60.0
## The jobs of a crew: four wheel men (FL, FR, RL, RR), the refueller, the chief.
const ROLES := 6
const PARTS := ["torso", "head", "visor", "upperL", "upperR", "lowerL", "lowerR", "thighL", "thighR", "shinL", "shinR", "gun"]
## The rigged mechanic's bones (a Ready Player Me skeleton renamed n6..n86 by the export), the joint of the simple figure
## each follows, and the bone's child whose direction is straightened (the model stands in an A-pose, arms 30 degrees out).
const RIG_MAP := [
	["n6", "hips", ""], ["n7", "chest", ""], ["n10", "neck", ""], ["n18", "chest", ""], ["n19", "shoulderL", "n20"],
	["n20", "elbowL", "n21"], ["n21", "elbowL", ""], ["n47", "chest", ""], ["n48", "shoulderR", "n49"],
	["n49", "elbowR", "n50"], ["n50", "elbowR", ""], ["n76", "hipL", "n77"], ["n77", "kneeL", "n78"], ["n78", "kneeL", ""],
	["n82", "hipR", "n83"], ["n83", "kneeR", "n84"], ["n84", "kneeR", ""],
]

## A figure's joints: posed every frame, their world transforms copied into the instanced parts.
class Figure:
	extends Node3D
	var hips := Node3D.new()
	var chest := Node3D.new()
	var neck := Node3D.new()
	var shoulder_l := Node3D.new()
	var shoulder_r := Node3D.new()
	var elbow_l := Node3D.new()
	var elbow_r := Node3D.new()
	var hip_l := Node3D.new()
	var hip_r := Node3D.new()
	var knee_l := Node3D.new()
	var knee_r := Node3D.new()
	var hand := Node3D.new()
	var joints := {}

	func _init() -> void:
		add_child(hips)
		hips.position.y = 0.92
		hips.add_child(chest)
		hips.add_child(hip_l)
		hips.add_child(hip_r)
		chest.add_child(neck)
		chest.add_child(shoulder_l)
		chest.add_child(shoulder_r)
		neck.position.y = 0.6
		shoulder_l.position = Vector3(0.21, 0.52, 0)
		shoulder_r.position = Vector3(-0.21, 0.52, 0)
		shoulder_l.add_child(elbow_l)
		shoulder_r.add_child(elbow_r)
		elbow_l.position.y = -0.31
		elbow_r.position.y = -0.31
		elbow_r.add_child(hand)
		hand.position.y = -0.29
		hip_l.position = Vector3(0.1, 0, 0)
		hip_r.position = Vector3(-0.1, 0, 0)
		hip_l.add_child(knee_l)
		hip_r.add_child(knee_r)
		knee_l.position.y = -0.44
		knee_r.position.y = -0.44
		joints = {
			"torso": chest, "head": neck, "visor": neck, "upperL": shoulder_l, "upperR": shoulder_r, "lowerL": elbow_l,
			"lowerR": elbow_r, "thighL": hip_l, "thighR": hip_r, "shinL": knee_l, "shinR": knee_r, "gun": hand,
		}

	## Pose: standing (idle sway), kneeling at a wheel (gun at the nut, work 0..1 how hard), or walking. The figure faces +z.
	func pose(kind: String, t: float, work: float = 0.0) -> void:
		var rx := func(o: Node3D, a: float, z: float = 0.0) -> void: o.rotation = Vector3(a, 0, z)
		if kind == "kneel":
			# right knee down, left foot planted, leaning in towards the wheel, gun held to it in both hands
			hips.position.y = 0.5
			rx.call(hips, 0.0)
			rx.call(chest, 0.42 + 0.04 * sin(t * 30.0) * work)
			rx.call(hip_l, -1.45)
			rx.call(knee_l, 1.45)
			rx.call(hip_r, 0.15)
			rx.call(knee_r, 1.42)
			var buzz := 0.03 * sin(t * 47.0) * work
			rx.call(shoulder_l, -1.05 + buzz, -0.25)
			rx.call(elbow_l, -0.75)
			rx.call(shoulder_r, -1.15 + buzz, 0.2)
			rx.call(elbow_r, -0.55)
			hand.rotation = Vector3(-1.2, 0, 0)
			neck.rotation = Vector3(-0.25, 0, 0)
		elif kind == "walk":
			var ph := t * 7.5
			hips.position.y = 0.92 + 0.025 * absf(sin(ph))
			rx.call(hips, 0.0)
			rx.call(chest, 0.08)
			rx.call(hip_l, 0.5 * sin(ph))
			rx.call(knee_l, maxf(0.0, 0.7 * sin(ph + 1.2)))
			rx.call(hip_r, -0.5 * sin(ph))
			rx.call(knee_r, maxf(0.0, -0.7 * sin(ph + 1.2)))
			rx.call(shoulder_l, -0.4 * sin(ph), 0.08)
			rx.call(elbow_l, -0.3)
			rx.call(shoulder_r, 0.4 * sin(ph), -0.08)
			rx.call(elbow_r, -0.3)
			hand.rotation = Vector3(-1.4, 0, 0)
			neck.rotation = Vector3.ZERO
		else:
			# waiting: weight shifting, a look around now and then
			hips.position.y = 0.92
			hips.rotation = Vector3(0, 0, 0.02 * sin(t * 0.7))
			rx.call(chest, 0.03)
			rx.call(hip_l, 0.02)
			rx.call(knee_l, 0.04)
			rx.call(hip_r, -0.02)
			rx.call(knee_r, 0.02)
			rx.call(shoulder_l, 0.05, 0.1)
			rx.call(elbow_l, -0.2)
			rx.call(shoulder_r, -0.35, -0.1)
			rx.call(elbow_r, -0.9)
			hand.rotation = Vector3(-0.6, 0, 0)
			neck.rotation = Vector3(0, 0.5 * sin(t * 0.23), 0)

class Crew:
	extends RefCounted
	var home: Vector3
	var centre: Vector3
	var along: Vector3
	var away: Vector3
	var colour: Color
	var figures: Array = []
	## Where each one is now (x, z, yaw), for walking between places.
	var at: Array = []
	var rigged = null
	var props: Node3D = null

var _multi := {} # part -> MultiMeshInstance3D
var _crews: Array = []
var _time := 0.0
var _models = null

## boxes: per crew {centre, along, away, colour}.
func _init(boxes: Array) -> void:
	name = "pit-crews"
	var n := boxes.size() * ROLES
	var suit := StandardMaterial3D.new()
	suit.roughness = 0.78
	suit.vertex_color_use_as_albedo = true
	var helmet := StandardMaterial3D.new()
	helmet.roughness = 0.25
	helmet.vertex_color_use_as_albedo = true
	var gun := StandardMaterial3D.new()
	gun.albedo_color = Color("1c1d20")
	gun.roughness = 0.45
	gun.metallic = 0.6
	for p in PARTS:
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_colors = p != "gun" and p != "visor"
		mm.mesh = _part_mesh(p)
		mm.instance_count = maxi(1, n)
		mm.visible_instance_count = 0
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		mmi.material_override = helmet if p == "head" else (gun if p == "gun" or p == "visor" else suit)
		mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		mmi.extra_cull_margin = 16384.0
		add_child(mmi)
		_multi[p] = mmi
	for b in boxes:
		var c := Crew.new()
		c.home = b.centre + b.away * 4.6
		c.centre = b.centre
		c.along = b.along
		c.away = b.away
		for i in ROLES:
			var f := Figure.new()
			add_child(f)
			c.figures.append(f)
			var side := (i - (ROLES - 1) / 2.0) * 0.9
			c.at.append({"x": c.home.x + b.along.x * side, "z": c.home.z + b.along.z * side, "yaw": atan2(-b.away.x, -b.away.z)})
		# the team's colour, but never darker than a dark suit still reads as coloured
		var col := Color(b.colour)
		col.v = maxf(col.v * 0.6, 0.28) if col.s < 0.15 else col.v
		var hsl_l := (maxf(col.r, maxf(col.g, col.b)) + minf(col.r, minf(col.g, col.b))) / 2.0
		if hsl_l < 0.28:
			col = col.lightened((0.28 - hsl_l) / maxf(0.01, 1.0 - hsl_l))
		c.colour = col
		_crews.append(c)
	set_process(false)

## One geometry from several primitive meshes, each placed by a transform.
func _merge(parts: Array) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for p in parts:
		st.append_from(p[0], 0, p[1])
	return st.commit()

func _capsule(r: float, length: float, xf: Transform3D = Transform3D.IDENTITY) -> Array:
	var m := CapsuleMesh.new()
	m.radius = r
	m.height = length + r * 2.0
	m.radial_segments = 8
	m.rings = 3
	# each hangs down from its joint (the origin), so rotating the joint swings it
	return [m, Transform3D(Basis.IDENTITY, Vector3(0, -length / 2.0 - r * 0.5, 0)) * xf]

func _part_mesh(p: String) -> Mesh:
	match p:
		"torso":
			var hips := SphereMesh.new()
			hips.radius = 0.17
			hips.height = 0.34
			var chest := CylinderMesh.new()
			chest.top_radius = 0.2
			chest.bottom_radius = 0.165
			chest.height = 0.5
			var sh := CapsuleMesh.new()
			sh.radius = 0.08
			sh.height = 0.46
			var neck := CylinderMesh.new()
			neck.top_radius = 0.06
			neck.bottom_radius = 0.07
			neck.height = 0.1
			return _merge([
				[hips, Transform3D(Basis.from_scale(Vector3(1.05, 0.7, 0.78)), Vector3(0, 0.02, 0))],
				[chest, Transform3D(Basis.from_scale(Vector3(1, 1, 0.66)), Vector3(0, 0.3, 0))],
				[sh, Transform3D(Basis(Vector3(0, 0, 1), PI / 2.0), Vector3(0, 0.52, 0))],
				[neck, Transform3D(Basis.IDENTITY, Vector3(0, 0.6, 0))]])
		"head":
			var g := SphereMesh.new()
			g.radius = 0.128
			g.height = 0.256
			return _merge([[g, Transform3D(Basis.from_scale(Vector3(1, 1.06, 1.1)), Vector3(0, 0.13, -0.005))]])
		"visor":
			var g2 := SphereMesh.new()
			g2.radius = 0.131
			g2.height = 0.262
			g2.is_hemisphere = true
			return _merge([[g2, Transform3D(Basis(Vector3(1, 0, 0), -PI / 2.0).scaled(Vector3(1, 1.06, 1.1)), Vector3(0, 0.13, 0.02))]])
		"upperL", "upperR":
			return _merge([_capsule(0.068, 0.24)])
		"lowerL", "lowerR":
			var glove := SphereMesh.new()
			glove.radius = 0.058
			glove.height = 0.116
			return _merge([_capsule(0.058, 0.22), [glove, Transform3D(Basis.from_scale(Vector3(0.9, 1.2, 0.75)), Vector3(0, -0.33, 0))]])
		"thighL", "thighR":
			return _merge([_capsule(0.09, 0.32)])
		"shinL", "shinR":
			var boot := BoxMesh.new()
			boot.size = Vector3(0.11, 0.08, 0.27)
			return _merge([_capsule(0.072, 0.34), [boot, Transform3D(Basis.IDENTITY, Vector3(0, -0.44, 0.06))]])
		_:
			# a wheel gun: the body, its handle and the socket pointing forward
			var body := CylinderMesh.new()
			body.top_radius = 0.05
			body.bottom_radius = 0.05
			body.height = 0.2
			var grip := BoxMesh.new()
			grip.size = Vector3(0.04, 0.12, 0.05)
			var sock := CylinderMesh.new()
			sock.top_radius = 0.03
			sock.bottom_radius = 0.03
			sock.height = 0.12
			var rot := Basis(Vector3(1, 0, 0), PI / 2.0)
			return _merge([[body, Transform3D(rot, Vector3(0, -0.02, 0.07))], [grip, Transform3D(Basis.IDENTITY, Vector3(0, -0.1, 0.02))], [sock, Transform3D(rot, Vector3(0, -0.02, 0.22))]])

## The user's models, once loaded: rigged crews near the camera, trolleys and engineers at the garages.
## m = {rig: PackedScene, engineer: PackedScene or null, cart: PackedScene or null}.
func set_models(m) -> void:
	_models = m

func _turn(a: float, b: float, k: float) -> float:
	var d := atan2(sin(b - a), cos(b - a))
	return a + d * minf(1.0, k)

## Pose and draw the crews within range m of the camera. work[i]: what crew i is doing ({car, u, events} or null).
func update_crews(dt: float, cam: Vector3, work: Array, view_range: float = 140.0) -> void:
	_time += dt
	var k := 0
	for ci in _crews.size():
		var c: Crew = _crews[ci]
		var d2 := c.centre.distance_squared_to(cam)
		# the garage's props, once the models are in
		if _models != null and c.props == null:
			c.props = _make_props(c)
			if c.props != null:
				add_child(c.props)
		if c.props != null:
			c.props.visible = d2 < 160.0 * 160.0
		var rig: bool = _models != null and d2 < RIG_RANGE * RIG_RANGE
		if rig and c.rigged == null:
			c.rigged = []
			for i in c.figures.size():
				var r = _make_rigged(c.colour)
				if r != null:
					add_child(r.object)
					c.rigged.append(r)
			if c.rigged.size() != c.figures.size():
				c.rigged = null
				rig = false
		if c.rigged != null:
			for r in c.rigged:
				r.object.visible = rig
		if d2 > view_range * view_range:
			continue
		var w = work[ci] if ci < work.size() else null
		for r in ROLES:
			var f: Figure = c.figures[r]
			var goal := _station(c, r, w)
			var at: Dictionary = c.at[r]
			var dx: float = goal.x - at.x
			var dz: float = goal.z - at.z
			var d := Vector2(dx, dz).length()
			# walk to the station (a quick 3.2 m/s jog when the car is in), then face the job
			var speed := 3.2 if w != null and w.car != null else 1.4
			var kind := "stand"
			if d > 0.08:
				var step := minf(d, speed * dt)
				at.x += (dx / d) * step
				at.z += (dz / d) * step
				at.yaw = _turn(at.yaw, atan2(dx, dz), dt * 10.0)
				kind = "walk"
			else:
				at.yaw = _turn(at.yaw, goal.yaw, dt * 8.0)
				kind = "kneel" if goal.kneel else "stand"
			f.position = Vector3(at.x, goal.y, at.z)
			f.rotation = Vector3(0, at.yaw, 0)
			f.pose(kind, _time + r * 1.7 + ci, goal.work)
			f.hand.visible = r < 4
			if rig and c.rigged != null:
				_pose_rigged(c.rigged[r], f, r < 4)
				continue
			# the suit in the team's colour, helmets white with the colour's tint
			for p in PARTS:
				var mm: MultiMesh = _multi[p].multimesh
				if k >= mm.instance_count:
					continue
				mm.visible_instance_count = k + 1
				var xf: Transform3D = f.joints[p].global_transform if not (p == "gun" and not f.hand.visible) else Transform3D(Basis.from_scale(Vector3.ZERO), Vector3.ZERO)
				mm.set_instance_transform(k, xf)
				if mm.use_colors:
					mm.set_instance_color(k, Color("f4f4f4").lerp(c.colour, 0.25) if p == "head" else c.colour * (0.55 if r == 5 else 1.0))
			k += 1
	for p in PARTS:
		(_multi[p].multimesh as MultiMesh).visible_instance_count = k

## Where crew member r should be and how: in line at the garage, or at the car (by the stop's timeline).
func _station(c: Crew, r: int, w) -> Dictionary:
	var home_at := (r - (ROLES - 1) / 2.0) * 0.9
	var facing_lane := atan2(-c.away.x, -c.away.z)
	if w == null or w.car == null:
		return {"x": c.home.x + c.along.x * home_at, "y": c.home.y, "z": c.home.z + c.along.z * home_at, "yaw": facing_lane, "kneel": false, "work": 0.0}
	var car: Dictionary = w.car
	var e: Dictionary = car.entry
	var qb := Basis(car.quat)
	# the car's own frame: wheel men kneel just outside their wheel, facing it
	var to_world := func(x: float, z: float) -> Vector3: return qb * Vector3(x, 0, z) + car.pos
	var ev: Array = w.events if w.events != null else []
	if r < 4:
		var key: String = ["FL", "FR", "RL", "RR"][r]
		var wh: Dictionary = e.wheels[key]
		var side := 1.0 if wh.position[0] > 0.0 else -1.0
		# the wheel man waits by his wheel until it is his turn, then works at it (and holds it while it is off)
		var working := 0.0
		for x in ev:
			if x.wheel == r and (x.kind == "gunOff" or x.kind == "gunOn") and w.u >= x.at and w.u < x.at + PitCrew.GUN_S:
				working = 1.0
		var p: Vector3 = to_world.call(wh.position[0] + side * 0.85, wh.position[2])
		var look := qb * Vector3(-side, 0, 0)
		return {"x": p.x, "y": car.pos.y, "z": p.z, "yaw": atan2(look.x, look.z), "kneel": true, "work": working}
	if r == 4:
		# the refueller at the filler (right-hand side, behind the cabin) while the fuel flows, then clear of the car
		var fuelling := false
		var cleared := false
		for x in ev:
			if x.kind == "fuelOn" and w.u >= x.at:
				fuelling = true
			if x.kind == "fuelOff" and w.u >= x.at + 0.6:
				cleared = true
		fuelling = fuelling and not cleared
		var zc: float = (e.wheels.FL.position[2] + e.wheels.RL.position[2]) / 2.0 - 0.4
		var p2: Vector3 = to_world.call(-e.dims.width / 2.0 - (0.55 if fuelling else 2.2), zc)
		var look2 := qb * Vector3(1, 0, 0)
		return {"x": p2.x, "y": car.pos.y, "z": p2.z, "yaw": atan2(look2.x, look2.z), "kneel": false, "work": 0.0}
	# the chief in front of the car, facing the driver
	var p3: Vector3 = to_world.call(0.0, e.dims.length / 2.0 + 1.4)
	var look3 := qb * Vector3(0, 0, -1)
	return {"x": p3.x, "y": car.pos.y, "z": p3.z, "yaw": atan2(look3.x, look3.z), "kneel": false, "work": 0.0}

## The garage's trolley and two engineers inside, once (instances of the user's models).
func _make_props(c: Crew) -> Node3D:
	var m = _models
	if m == null or (m.cart == null and m.engineer == null):
		return null
	var g := Node3D.new()
	g.name = "pit-props"
	var yaw := atan2(-c.away.x, -c.away.z)
	var place := func(src: PackedScene, along: float, away: float, turn_a: float) -> void:
		var o: Node3D = src.instantiate()
		o.position = c.home + c.along * along + c.away * away
		o.rotation = Vector3(0, yaw + turn_a, 0)
		g.add_child(o)
	if m.cart != null:
		place.call(m.cart, 3.4, 0.2, 0.3)
	if m.engineer != null:
		place.call(m.engineer, -1.8, 2.6, 0.15)
		place.call(m.engineer, 2.2, 3.4, -0.4)
	return g

## A rigged mechanic for a crew, its overalls in the team's colour. Returns {object, skeleton, bones: [...], hips, ...} or null.
func _make_rigged(colour: Color):
	if _models == null or _models.rig == null:
		return null
	var obj: Node3D = _models.rig.instantiate()
	var skel: Skeleton3D = null
	for n in CarVisual._walk(obj):
		if n is Skeleton3D:
			skel = n
			break
	if skel == null:
		obj.queue_free()
		return null
	var mats := {}
	for n in CarVisual._walk(obj):
		if n is MeshInstance3D and (n as MeshInstance3D).mesh != null:
			var mi := n as MeshInstance3D
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
			for s in mi.mesh.get_surface_count():
				var src := mi.mesh.surface_get_material(s)
				if src is StandardMaterial3D and RegEx.create_from_string("(?i)Outfit_(Top|Bottom)|Headwear").search(src.resource_name) != null:
					if not mats.has(src):
						var cm := src.duplicate() as StandardMaterial3D
						cm.albedo_color = colour.lerp(Color.WHITE, 0.35)
						mats[src] = cm
					mi.set_surface_override_material(s, mats[src])
	var rig := {"object": obj, "skeleton": skel, "bones": []}
	var by_name := {}
	for i in skel.get_bone_count():
		by_name[skel.get_bone_name(i)] = i
	var bones: Array = rig.bones
	for row in RIG_MAP:
		if not by_name.has(row[0]):
			continue
		var bi: int = by_name[row[0]]
		var rest_world := skel.get_bone_global_rest(bi).basis.get_rotation_quaternion()
		var fix := Quaternion.IDENTITY
		if row[2] != "" and by_name.has(row[2]):
			var a := skel.get_bone_global_rest(bi).origin
			var d := (skel.get_bone_global_rest(by_name[row[2]]).origin - a).normalized()
			fix = Quaternion(d, Vector3(0, -1, 0))
		else:
			# a hand or foot keeps its angle to the straightened forearm / shin
			for pb in bones:
				var prow = RIG_MAP[pb.map_index]
				if pb.joint == row[1] and prow[2] != "" and by_name.get(prow[2], -1) == bi:
					fix = pb.fix
		# the nearest mapped ancestor
		var parent := -1
		var p: int = skel.get_bone_parent(bi)
		var between: Array = []
		while p >= 0 and parent < 0:
			var found := -1
			for k in bones.size():
				if bones[k].bone == p:
					found = k
			if found >= 0:
				parent = found
			else:
				between.push_front(p)
			p = skel.get_bone_parent(p)
		bones.append({"bone": bi, "joint": row[1], "rest_world": rest_world, "fix": fix, "parent": parent, "between": between, "map_index": RIG_MAP.find(row)})
	var hips_i: int = by_name.get("n6", -1)
	if hips_i < 0:
		obj.queue_free()
		return null
	rig.hips = hips_i
	rig.hips_rest = skel.get_bone_rest(hips_i).origin
	var hp := skel.get_bone_parent(hips_i)
	var parent_xf := skel.get_bone_global_rest(hp) if hp >= 0 else Transform3D.IDENTITY
	rig.hips_up = (parent_xf.basis.inverse() * Vector3.UP)
	rig.base_q = parent_xf.basis.get_rotation_quaternion()
	return rig

## Pose a rigged mechanic like the simple figure f (its joints' rotations, its hips' height).
func _pose_rigged(r: Dictionary, f: Figure, gun: bool) -> void:
	var obj: Node3D = r.object
	var skel: Skeleton3D = r.skeleton
	obj.global_position = f.global_position
	obj.global_transform.basis = f.global_transform.basis
	var qi := f.global_transform.basis.get_rotation_quaternion().inverse()
	var world: Array = []
	world.resize(r.bones.size())
	for i in r.bones.size():
		var b: Dictionary = r.bones[i]
		var j: Node3D = f.get(_joint_prop(b.joint))
		# the joint's rotation relative to the figure, the limb straightened, then the bone's own rest orientation
		var qa: Quaternion = qi * j.global_transform.basis.get_rotation_quaternion()
		var w: Quaternion = qa * b.fix * b.rest_world
		world[i] = w
		var parent_w: Quaternion = world[b.parent] if b.parent >= 0 else r.base_q
		# bones between two mapped ones (spine 1 and 2) keep their rest pose: the parent's world includes them
		for bt in b.between:
			parent_w = parent_w * skel.get_bone_rest(bt).basis.get_rotation_quaternion()
		skel.set_bone_pose_rotation(b.bone, parent_w.inverse() * w)
	skel.set_bone_pose_position(r.hips, r.hips_rest + r.hips_up * (f.hips.position.y - 0.92))

func _joint_prop(joint: String) -> String:
	match joint:
		"shoulderL": return "shoulder_l"
		"shoulderR": return "shoulder_r"
		"elbowL": return "elbow_l"
		"elbowR": return "elbow_r"
		"hipL": return "hip_l"
		"hipR": return "hip_r"
		"kneeL": return "knee_l"
		"kneeR": return "knee_r"
	return joint

static var _models_cache = null

## The user's models for the pit lane: {rig, engineer, cart}, or null (simple figures only).
static func load_crew_models():
	if _models_cache != null:
		return _models_cache
	var rig := Assets.scene("assets/vegetation/mechanic_rig.glb")
	if rig == null:
		return null
	_models_cache = {"rig": rig, "engineer": Assets.scene("assets/vegetation/mechanic_static.glb"), "cart": Assets.scene("assets/vegetation/tool_cart.glb")}
	return _models_cache
