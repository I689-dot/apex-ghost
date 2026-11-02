class_name LocalRoom
extends RefCounted
## Offline play (port of net/localRoom.ts): the server's own room logic (RoomCore: lobby, briefing, lap timing,
## penalties, bots) running in the game, so a session alone or with AI cars makes no network requests. The client
## talks to it through LocalSocket, which behaves like the WebSocket it replaces.

## Room code of the offline room.
const LOCAL_CODE := "SOLO1"

static var room: RoomCore = null
static var _timer: SceneTreeTimer = null
## The code of the race this device hosts for other players (P2P), or "".
static var hosted_code := ""
static var _next_id := 0

## The room runs in this game: solo, or a race this device hosts.
static func is_local_code(code: String) -> bool:
	return code == LOCAL_CODE or (hosted_code != "" and code == hosted_code)

## A race this device hosts for players on other devices (not solo).
static func is_hosted_code(code: String) -> bool:
	return hosted_code != "" and code == hosted_code

## code: a code to host under (other players join with it); solo without one.
static func create(code: String = LOCAL_CODE) -> String:
	var tracks := {}
	var def := ""
	for entry in TrackData.list_layouts():
		var t := TrackData.load_layout(entry)
		var pl = t.get("pitLane", null)
		tracks[t.id] = {
			"id": t.id, "name": t.name, "length": t.length, "centerline": t.centerline, "cumS": t.cumS, "gates": t.gates,
			"sectorGates": t.sectorGates, "firstGate": t.firstGate, "minLapMs": t.minLapMs,
			"pitExitS": pl.exitS if pl != null else null, "pitEntryS": pl.entryS if pl != null else null,
			"pitLaneM": pl.length if pl != null else null,
		}
		if def == "" and entry.get("default", false):
			def = t.id
	if def == "":
		def = tracks.keys()[0]
	var env := RoomEnv.new()
	env.now = func(): return Time.get_unix_time_from_system() * 1000.0
	var rng := RandomNumberGenerator.new()
	rng.randomize()
	env.random = func(): return rng.randf()
	env.schedule = _schedule
	env.persist = func(_s): pass
	env.track = tracks[def]
	env.tracks = tracks
	env.car_ids = CarsDb.selectable().map(func(c): return c.id)
	var r := RoomCore.new(env)
	r.init_room(code)
	room = r
	hosted_code = "" if code == LOCAL_CODE else code
	return code

static func _schedule(at: float) -> void:
	var tree := Engine.get_main_loop() as SceneTree
	if tree == null:
		return
	var delay := maxf(0.0, (at - Time.get_unix_time_from_system() * 1000.0) / 1000.0)
	_timer = tree.create_timer(delay)
	var mine := _timer
	_timer.timeout.connect(func(): if mine == _timer and room != null: room.tick())

## A WebSocket look-alike connected to the in-game room.
class LocalSocket:
	extends RefCounted
	const OPEN := 1
	var ready_state := 0
	## Called with a String or PackedByteArray.
	var on_message: Callable
	var on_open: Callable
	var on_close: Callable
	var _conn: RoomConn

	func _init() -> void:
		var id := "local-%d" % LocalRoom._next_id
		LocalRoom._next_id += 1
		_conn = RoomConn.new(id, _deliver, func(_c, _r): _shut())
		# open asynchronously, like a real socket
		(Engine.get_main_loop() as SceneTree).process_frame.connect(_open, CONNECT_ONE_SHOT)

	func _open() -> void:
		if LocalRoom.room == null:
			_shut()
			return
		ready_state = 1
		if on_open.is_valid():
			on_open.call()

	# async like a real socket: the room may send while it is still handling our message
	func _deliver(data) -> void:
		var tree := Engine.get_main_loop() as SceneTree
		tree.process_frame.connect(func(): if ready_state == 1 and on_message.is_valid(): on_message.call(data), CONNECT_ONE_SHOT)

	func send(data) -> void:
		if ready_state != 1 or LocalRoom.room == null:
			return
		# keepalive: answered by Cloudflare before the room sees it online; here, the same
		if typeof(data) == TYPE_STRING and data == "ka":
			_deliver("ka")
			return
		LocalRoom.room.on_message(_conn, data)

	func close() -> void:
		if ready_state == 3:
			return
		if LocalRoom.room != null:
			LocalRoom.room.on_close(_conn)
		_shut()

	func _shut() -> void:
		if ready_state == 3:
			return
		ready_state = 3
		if on_close.is_valid():
			on_close.call()
