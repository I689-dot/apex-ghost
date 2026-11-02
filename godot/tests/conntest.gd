extends Node
## Connection over the offline room, and a reachability check of the live server's public room list.
func _ready() -> void:
	_run.call_deferred()

func _run() -> void:
	LocalRoom.create()
	var c := Connection.new().setup(LocalRoom.LOCAL_CODE, "Max")
	add_child(c)
	var msgs: Array = []
	c.message.connect(func(m): msgs.append(m))
	var r := await c.connect_to_room()
	print("connected: ", r)
	var welcome := msgs.filter(func(m): return m.t == "welcome")
	print("welcome: ", welcome.size(), " you=", welcome[0].you if welcome.size() > 0 else "-", " phase=", welcome[0].room.phase if welcome.size() > 0 else "-")
	await get_tree().create_timer(1.5).timeout
	print("state=", c.state, " rtt=", c.rtt, " serverNow-unix=", c.server_now() - Time.get_unix_time_from_system() * 1000.0)
	c.send_json({"t": "selectCar", "carId": CarsDb.selectable()[0].id})
	await get_tree().create_timer(0.2).timeout
	print("carLock: ", msgs.filter(func(m): return m.t == "carLock"))
	c.leave()
	var rooms := await Connection.list_public_rooms()
	print("live server public rooms: ", rooms.size())
	get_tree().quit()
