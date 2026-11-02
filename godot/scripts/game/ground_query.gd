class_name GroundQuery
extends RefCounted
## Wheel rays against the track (port of Track.groundQuery in game/track.ts). Surface of a hit comes from the
## "surface" meta of the collider's body ("asphalt", "curb", "grass", "gravel", "sand", "wall").

var _world: World3D
var _query := PhysicsRayQueryParameters3D.new()
## The game's smoothed pit lane and rough stretches (RoadPatches), or null.
var patches: RoadPatches = null

func _init(world: World3D, road_patches: RoadPatches = null) -> void:
	_world = world
	patches = road_patches
	_query.collision_mask = VehicleConsts.RAY_MASK
	_query.hit_from_inside = false
	_query.collide_with_areas = false

## Cast a ray; returns {} when nothing is hit within max_dist, else {dist, pos, normal, surface}.
func cast(origin: Vector3, dir: Vector3, max_dist: float) -> Dictionary:
	var space := _world.direct_space_state
	_query.from = origin
	_query.to = origin + dir * max_dist
	var hit := space.intersect_ray(_query)
	if hit.is_empty():
		return {}
	var surface := "asphalt"
	var col: Object = hit.collider
	if col != null and col.has_meta("surface"):
		surface = col.get_meta("surface")
	var normal: Vector3 = hit.normal
	if normal.dot(dir) > 0.0:
		normal = -normal
	var out := {"dist": origin.distance_to(hit.position), "pos": hit.position, "normal": normal, "surface": surface}
	if patches != null and surface != "wall":
		patches.apply(origin, dir, max_dist, out)
	return out

## Ground height under (x, z) from y_top down at most max_d (null: no ground, or a wall): for RoadPatches.build.
func height_below(x: float, y_top: float, z: float, max_d: float):
	var space := _world.direct_space_state
	_query.from = Vector3(x, y_top, z)
	_query.to = Vector3(x, y_top - max_d, z)
	var hit := space.intersect_ray(_query)
	if hit.is_empty():
		return null
	var col: Object = hit.collider
	if col != null and col.has_meta("surface") and col.get_meta("surface") == "wall":
		return null
	return hit.position.y
