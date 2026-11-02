class_name RoomEnv
extends RefCounted
## What the room needs from its host (port of RoomEnv in apps/server/src/room.ts).

## now() -> float ms; random() -> float in [0,1); schedule(at: float); persist(state: Dictionary);
## report(summary) (optional); record(event: Dictionary) (optional).
var now: Callable
var random: Callable
var schedule: Callable
var persist: Callable
var report: Callable = Callable()
var record: Callable = Callable()
## Default layout (TrackRaceData Dictionary) and all layouts by id (the default included).
var track: Dictionary
var tracks: Dictionary = {}
## Selectable car ids (Array of String), or null for any.
var car_ids = null
