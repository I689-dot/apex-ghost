extends Node
## A race hosted on this device and a guest connecting to it through the server's relay (needs network).
func _ready() -> void:
	_run.call_deferred()

func _run() -> void:
	var r := await P2p.host_race()
	print("host: ", r, " webrtc: ", P2p.available())
	if r.has("error"):
		get_tree().quit(1)
		return
	var host := Connection.new().setup(r.code, "Host")
	add_child(host)
	var hr := await host.connect_to_room()
	print("host connected: ", hr)
	print("is p2p: ", await P2p.is_p2p_code(r.code))
	var guest := Connection.new().setup(r.code, "Guest")
	add_child(guest)
	var msgs: Array = []
	guest.message.connect(func(m): msgs.append(m))
	var gr := await guest.connect_to_room()
	print("guest connected: ", gr)
	await get_tree().create_timer(1.0).timeout
	print("guest got welcome: ", msgs.filter(func(m): return m.t == "welcome").size(), " room players: ", LocalRoom.room.players.size())
	P2p.stop_hosting()
	get_tree().quit()
