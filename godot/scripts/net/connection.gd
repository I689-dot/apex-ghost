class_name Connection
extends Node
## WebSocket session with automatic reconnect (the session token keeps the slot, car and race progress for up to 30 s)
## and NTP-style clock sync (port of net/connection.ts). Add to the scene tree, call connect_to_room(), then listen to
## the signals. Offline rooms (LocalRoom) and hosted P2P rooms use the same protocol through a socket look-alike.

signal message(msg: Dictionary)
signal binary(buf: PackedByteArray)
signal state_changed(state: String)

## "connecting", "open", "reconnecting" or "closed".
var state := "connecting"
var code: String
var nick: String
## Join as a spectator (watch only).
var spectate := false
var rtt := 0.0
## Counters for the perf overlay.
var stats := {"sent": 0, "recv": 0, "binRecv": 0, "lastSeqGaps": 0}

var _ws: WebSocketPeer = null
var _local: LocalRoom.LocalSocket = null
var _samples: Array = []
var _offset := 0.0
var _ping_at := -1.0
var _ping_burst := 0
var _ka_at := -1.0
var _reconnect_start := 0.0
var _reconnect_attempt := 0
var _reconnect_at := -1.0
var _closed_by_user := false
var _fatal := false
var _welcomed := false
var _connect_deadline := -1.0
## State packets produced while disconnected; replayed after reconnect so no checkpoint is missed.
var _backlog: Array = []
var _was_open := false

signal welcomed
signal connect_failed(code: String, text: String)

## Creates a room on the server and returns its code, or "" (error text in last_error).
static var last_error := ""

static func create_room() -> String:
	var tree := Engine.get_main_loop() as SceneTree
	var req := HTTPRequest.new()
	tree.root.add_child(req)
	var token = Account.account().token if Account.account() != null else null
	var headers := PackedStringArray()
	if token != null:
		headers.append("Authorization: Bearer %s" % token)
	if req.request("%s/api/rooms" % Config.SERVER_URL, headers, HTTPClient.METHOD_POST) != OK:
		req.queue_free()
		last_error = I18n.t("Cannot reach the game server. Check your connection.")
		return ""
	var res: Array = await req.request_completed
	req.queue_free()
	if res[0] != HTTPRequest.RESULT_SUCCESS:
		last_error = I18n.t("Cannot reach the game server. Check your connection.")
		return ""
	if res[1] == 401:
		last_error = I18n.t("Sign in to play online.")
		return ""
	if res[1] < 200 or res[1] >= 300:
		last_error = "Server error (%d). Try again." % res[1]
		return ""
	var body = JSON.parse_string((res[3] as PackedByteArray).get_string_from_utf8())
	if typeof(body) != TYPE_DICTIONARY or not body.has("code"):
		last_error = "Server returned no room code."
		return ""
	return body.code

## The public room list (rooms whose host made them public).
static func list_public_rooms() -> Array:
	var tree := Engine.get_main_loop() as SceneTree
	var req := HTTPRequest.new()
	tree.root.add_child(req)
	if req.request("%s/api/rooms" % Config.SERVER_URL) != OK:
		req.queue_free()
		return []
	var res: Array = await req.request_completed
	req.queue_free()
	if res[0] != HTTPRequest.RESULT_SUCCESS or res[1] != 200:
		return []
	var body = JSON.parse_string((res[3] as PackedByteArray).get_string_from_utf8())
	return body.get("rooms", []) if typeof(body) == TYPE_DICTIONARY else []

func setup(room_code: String, nickname: String, spectator: bool = false) -> Connection:
	code = room_code
	nick = nickname
	spectate = spectator
	return self

func _now_ms() -> float:
	return Time.get_ticks_msec() as float

## Resolves on the first welcome: returns {ok: true} or {ok: false, code, message}.
func connect_to_room() -> Dictionary:
	_welcomed = false
	_open()
	_connect_deadline = _now_ms() + 12000.0
	var result: Array = await _wait_welcome()
	return result[0]

func _wait_welcome() -> Array:
	# lambdas capture by value: the shared state lives in a Dictionary
	var st := {"done": false, "result": {}}
	var on_ok := func(): if not st.done: st.done = true; st.result = {"ok": true}
	var on_fail := func(c, m): if not st.done: st.done = true; st.result = {"ok": false, "code": c, "message": m}
	welcomed.connect(on_ok)
	connect_failed.connect(on_fail)
	while not st.done:
		await get_tree().process_frame
	welcomed.disconnect(on_ok)
	connect_failed.disconnect(on_fail)
	return [st.result]

func _url() -> String:
	var base := Config.SERVER_URL.replace("http", "ws")
	# online play is for signed-in drivers: the server checks the account token before the room is reached
	var acc = Account.account()
	var token = acc.token if acc != null else null
	return "%s/api/rooms/%s/ws%s" % [base, code.uri_encode(), "?t=%s" % token if token != null else ""]

func _open() -> void:
	_close_socket()
	if LocalRoom.is_local_code(code):
		_local = LocalRoom.LocalSocket.new()
		_local.on_open = _on_open
		_local.on_message = _on_data
		_local.on_close = _on_close
	else:
		_ws = WebSocketPeer.new()
		_ws.inbound_buffer_size = 1 << 20
		_ws.outbound_buffer_size = 1 << 20
		if _ws.connect_to_url(_url()) != OK:
			_ws = null
			_on_close()

func _close_socket() -> void:
	if _ws != null:
		_ws.close(1000, "bye")
		_ws = null
	if _local != null:
		_local.on_close = Callable()
		_local.close()
		_local = null
	_was_open = false

func _is_open() -> bool:
	if _local != null:
		return _local.ready_state == 1
	return _ws != null and _ws.get_ready_state() == WebSocketPeer.STATE_OPEN

func _on_open() -> void:
	_reconnect_attempt = 0
	var acc = Account.account()
	var online := not spectate and not LocalRoom.is_local_code(code)
	var hello := {
		"t": "hello", "v": Const.PROTOCOL_VERSION, "nick": nick,
		"session": null if spectate else Settings.get_session(code), "spectate": spectate,
	}
	# signed in (and online: the offline room keeps no records): the room records my laps and results
	if online and acc != null:
		hello.account = acc.token
	# the driver profile for the timing screens (offline too: it is the player's own)
	if acc != null and acc.user.get("country"):
		hello.country = acc.user.country
	if acc != null and acc.user.get("num"):
		hello.num = int(acc.user.num)
	send_json(hello)

func _on_data(data) -> void:
	if typeof(data) == TYPE_STRING:
		stats.recv += 1
		if data == "ka":
			return
		var msg = JSON.parse_string(data)
		if typeof(msg) == TYPE_DICTIONARY:
			_on_json(msg)
	else:
		stats.binRecv += 1
		var buf: PackedByteArray = data
		if buf.size() > 0 and buf[0] == CarState.BIN_SERVER_RELAY:
			binary.emit(buf)

func _on_close() -> void:
	_stop_timers()
	_was_open = false
	if _closed_by_user or _fatal:
		_set_state("closed")
		return
	_schedule_reconnect()

func _on_json(msg: Dictionary) -> void:
	match msg.t:
		"welcome":
			if not spectate:
				Settings.set_session(code, msg.session)
			_flush_backlog()
			# first estimate (no round trip yet); kept relative to the local clock like the pong estimates
			_offset = msg.serverTime - _now_ms()
			_samples = []
			_set_state("open")
			_start_timers()
			_welcomed = true
			welcomed.emit()
		"pong":
			_samples.append(ClockSync.make_sample(msg.c, msg.s, _now_ms()))
			if _samples.size() > 16:
				_samples.pop_front()
			var est := ClockSync.estimate_offset(_samples)
			_offset = est.offset
			rtt = est.rtt
			return
		"error":
			if msg.fatal:
				_fatal = true
				if not _welcomed:
					connect_failed.emit(msg.code, msg.message)
				if msg.code == "room_not_found" or msg.code == "kicked":
					Settings.set_session(code, null)
	message.emit(msg)

func _start_timers() -> void:
	# burst of samples for a quick initial estimate, then a slow refresh
	_ping_burst = 0
	_ping_at = _now_ms()
	_ka_at = _now_ms() + 20000.0

func _stop_timers() -> void:
	_ping_at = -1.0
	_ka_at = -1.0

## Re-run a quick clock sync (e.g. after the app was paused).
func resync() -> void:
	if state == "open":
		_samples = []
		_start_timers()
	elif state == "reconnecting" and not (_ws != null and _ws.get_ready_state() == WebSocketPeer.STATE_CONNECTING):
		_open()

func _schedule_reconnect() -> void:
	if state != "reconnecting":
		_reconnect_start = _now_ms()
		_set_state("reconnecting")
	if _now_ms() - _reconnect_start > Const.RECONNECT_GRACE_MS:
		_set_state("closed")
		message.emit({"t": "error", "code": "kicked", "message": "Connection lost for too long. You were removed from the room.", "fatal": true})
		return
	var delay := minf(4000.0, 400.0 * pow(2.0, _reconnect_attempt))
	_reconnect_attempt += 1
	_reconnect_at = _now_ms() + delay

func _set_state(s: String) -> void:
	state = s
	state_changed.emit(s)

## Current server time estimate (ms).
func server_now() -> float:
	return _now_ms() + _offset

func send_json(msg: Dictionary) -> void:
	if not _is_open():
		return
	var s := JSON.stringify(msg)
	if _local != null:
		_local.send(s)
	else:
		_ws.send_text(s)
	stats.sent += 1

## Sends a packed state packet (bytes already cut to length).
func send_binary(buf: PackedByteArray) -> void:
	if _is_open() and state == "open" and _backlog.is_empty():
		_send_raw(buf)
		stats.sent += 1
	elif state == "reconnecting" or state == "connecting" or not _backlog.is_empty():
		_backlog.append(buf)
		if _backlog.size() > 400:
			_backlog.pop_front() # ~40 s at 10 packets/s

func _send_raw(buf: PackedByteArray) -> void:
	if _local != null:
		_local.send(buf)
	else:
		_ws.send(buf, WebSocketPeer.WRITE_MODE_BINARY)

func _flush_backlog() -> void:
	if not _is_open():
		return
	for b in _backlog:
		_send_raw(b)
	stats.sent += _backlog.size()
	_backlog = []

func close_connection() -> void:
	_closed_by_user = true
	_stop_timers()
	_close_socket()
	_set_state("closed")

func leave() -> void:
	send_json({"t": "leave"})
	Settings.set_session(code, null)
	close_connection()

func _process(_delta: float) -> void:
	var now := _now_ms()
	if _ws != null:
		_ws.poll()
		var rs := _ws.get_ready_state()
		if rs == WebSocketPeer.STATE_OPEN and not _was_open:
			_was_open = true
			_on_open()
		while _ws != null and _ws.get_ready_state() == WebSocketPeer.STATE_OPEN and _ws.get_available_packet_count() > 0:
			var pkt := _ws.get_packet()
			_on_data(pkt.get_string_from_utf8() if _ws.was_string_packet() else pkt)
		if _ws != null and _ws.get_ready_state() == WebSocketPeer.STATE_CLOSED:
			_ws = null
			_on_close()
	if _connect_deadline > 0.0 and now > _connect_deadline:
		_connect_deadline = -1.0
		if not _welcomed:
			connect_failed.emit("timeout", "Connection timed out. The server may be unreachable.")
			close_connection()
	if _ping_at >= 0.0 and now >= _ping_at:
		send_json({"t": "ping", "c": now})
		_ping_burst += 1
		_ping_at = now + (200.0 if _ping_burst < 8 else 3000.0)
	if _ka_at >= 0.0 and now >= _ka_at:
		_ka_at = now + 20000.0
		if _is_open():
			if _local != null:
				_local.send("ka")
			else:
				_ws.send_text("ka")
	if _reconnect_at >= 0.0 and now >= _reconnect_at:
		_reconnect_at = -1.0
		if not _closed_by_user:
			_open()
