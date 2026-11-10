extends SceneTree
## Text chat in a room this game hosts: everyone gets a line, "/rc text" only the host and the sender, markup and
## control characters are stripped, over-long lines are cut, and spam inside the minimum gap is dropped.
##   tools/godot/gd.sh tests/chat_test.gd

var now := 1000000.0
var failures := 0
var inbox := {"host": [], "guest": [], "third": []}

func check(cond: bool, what: String) -> void:
	print(("ok   " if cond else "FAIL ") + what)
	if not cond:
		failures += 1

func chats(who: String) -> Array:
	return inbox[who].filter(func(m): return m is Dictionary and m.t == "chat")

func connect_player(room: RoomCore, id: String, who: String, nick: String) -> RoomConn:
	var conn := RoomConn.new(id, func(d):
		if typeof(d) == TYPE_STRING:
			inbox[who].append(JSON.parse_string(d)))
	room.on_message(conn, JSON.stringify({"t": "hello", "v": Const.PROTOCOL_VERSION, "nick": nick, "session": null}))
	return conn

func say(room: RoomCore, conn: RoomConn, text: String) -> void:
	room.on_message(conn, JSON.stringify({"t": "chat", "text": text}))

func _initialize() -> void:
	var track := TrackData.load_layout(TrackData.list_layouts()[0])
	var env := RoomEnv.new()
	env.now = func(): return now
	var rng := RandomNumberGenerator.new()
	rng.seed = 3
	env.random = func(): return rng.randf()
	env.schedule = func(_at): pass
	env.persist = func(_s): pass
	env.track = track
	env.tracks = {track.id: track}
	env.car_ids = CarsDb.selectable().map(func(c): return c.id)
	var room := RoomCore.new(env)
	room.init_room("CHAT1")
	var host := connect_player(room, "c1", "host", "Max")
	var guest := connect_player(room, "c2", "guest", "Lando")
	var third := connect_player(room, "c3", "third", "Kimi")
	check(room.players.size() == 3, "three players")

	say(room, guest, "hello everyone")
	check(chats("host").size() == 1 and chats("guest").size() == 1 and chats("third").size() == 1, "a line reaches everyone, the sender too")
	check(chats("third")[0].nick == "Lando" and chats("third")[0].text == "hello everyone" and not chats("third")[0].rc, "with the sender's nick")

	now += 1000.0
	say(room, guest, "/rc he pushed me")
	check(chats("host").size() == 2 and chats("host")[1].rc and chats("host")[1].text == "he pushed me", "/rc reaches the host")
	check(chats("guest").size() == 2, "and comes back to the sender")
	check(chats("third").size() == 1, "but not to the others")

	now += 1000.0
	say(room, guest, "[b]bold[/b] <i>x</i>\u0007 tab\there")
	var last: Dictionary = chats("host").back()
	check(not last.text.contains("\u0007") and not last.text.contains("\t"), "control characters are stripped: '%s'" % last.text)

	now += 1000.0
	say(room, guest, "a".repeat(500))
	check(chats("host").back().text.length() == Validation.CHAT_MAX_LEN, "a long line is cut to %d" % Validation.CHAT_MAX_LEN)

	var n := chats("host").size()
	now += 1000.0
	say(room, guest, "one")
	now += 100.0
	say(room, guest, "two, too quick")
	check(chats("host").size() == n + 1, "a second line inside the minimum gap is dropped")
	now += 1000.0
	say(room, guest, "   ")
	check(chats("host").size() == n + 1, "an empty line is ignored")
	var errors: int = inbox.guest.filter(func(m): return m is Dictionary and m.t == "error").size()
	say(room, guest, "/rc ")
	check(chats("host").size() == n + 1, "an empty /rc is ignored")
	print("failures: %d (errors sent %d)" % [failures, errors])
	quit(1 if failures > 0 else 0)
