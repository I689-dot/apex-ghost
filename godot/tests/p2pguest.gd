extends Node
## Joins a race hosted on another device: CODE=ABCDE godot ... runner -- res://tests/p2pguest.gd
func _ready() -> void:
	_run.call_deferred()

func _run() -> void:
	var code := OS.get_environment("CODE")
	print("is p2p: ", await P2p.is_p2p_code(code))
	var guest := Connection.new().setup(code, "PcGuest")
	add_child(guest)
	var msgs: Array = []
	guest.message.connect(func(m): msgs.append(m))
	print("guest connected: ", await guest.connect_to_room())
	await get_tree().create_timer(3.0).timeout
	for m in msgs:
		if m.t == "welcome":
			print("welcome: you=", m.you, " players=", m.room.players.map(func(p): return p.nick), " phase=", m.room.phase)
	var rooms: Array = msgs.filter(func(m): return m.t == "room")
	if not rooms.is_empty():
		print("room update players: ", rooms.back().room.players.map(func(p): return p.nick))
	print("rtt ", guest.rtt)
	get_tree().quit()
