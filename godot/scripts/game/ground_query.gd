class_name GroundQuery
extends RefCounted
## Wheel rays against the track (port of Track.groundQuery in game/track.ts). Surface of a hit comes from the
## "surface" meta of the collider's body ("asphalt", "curb", "grass", "gravel", "sand", "wall").

var _world: World3D
var _query := PhysicsRayQueryParameters3D.new()

func _init(world: World3D) -> void:
	_world = world
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
	return {"dist": origin.distance_to(hit.position), "pos": hit.position, "normal": hit.normal, "surface": surface}
