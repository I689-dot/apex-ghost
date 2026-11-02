class_name P2p
extends Node
## Races hosted on a device (port of net/p2p.ts): a phone at a friend's house, a laptop at a LAN. The host's game runs the
## room itself, as offline play does (RoomCore), and the other players connect straight to it. The web game does it over
## WebRTC data channels; the engine's WebRTC needs a native extension, so here the connection is a plain WebSocket inside
## the same Wi-Fi network: the game server still relays the one-time handshake (apps/server/src/signal.ts: the guest's
## "offer", the host's "answer"), but the answer carries the host's local address instead of a session description,
## and the guest then connects to it directly. The race never goes through the server and the host has no latency at all.

const PORT_FIRST := 47800
const PORT_LAST := 47860
const MARKER := "apx-ws"

static var instance: P2p = null
static var _known := {}

var code := ""
var port := 0
var address := ""
var _server := TCPServer.new()
var _peers: Array = []   # {ws: WebSocketPeer, conn: RoomConn, open: bool}
var _seen := {}
var _poll_in := 0.0
var _hosting := false

static func _api(c: String, path: String = "") -> String:
	return "%s/api/p2p/%s%s" % [Config.SERVER_URL, c, path]

static func _request(url: String, body = null) -> Dictionary:
	var req := HTTPRequest.new()
	(Engine.get_main_loop() as SceneTree).root.add_child(req)
	var err := req.request(url, PackedStringArray(["Content-Type: application/json"]), HTTPClient.METHOD_GET if body == null else HTTPClient.METHOD_POST, "" if body == null else JSON.stringify(body))
	if err != OK:
		req.queue_free()
		return {"status": 0, "data": {}}
	var res: Array = await req.request_completed
	req.queue_free()
	var data = JSON.parse_string((res[3] as PackedByteArray).get_string_from_utf8()) if (res[3] as PackedByteArray).size() > 0 else {}
	return {"status": res[1], "data": data if typeof(data) == TYPE_DICTIONARY else {}}

static func is_known(c: String) -> bool:
	return _known.has(c)

## Is this room code a race hosted on a device right now?
static func is_p2p_code(c: String) -> bool:
	var r := await _request(_api(c))
	var yes: bool = r.status == 200 and r.data.get("hosted", false) == true
	if yes:
		_known[c] = true
	return yes

## This device's address on the local network (a private IPv4), or "".
static func local_address() -> String:
	var best := ""
	for a in IP.get_local_addresses():
		if a.count(".") != 3 or a.begins_with("127.") or a.begins_with("169.254."):
			continue
		if a.begins_with("192.168.") or a.begins_with("10."):
			return a
		var parts := a.split(".")
		if a.begins_with("172.") and int(parts[1]) >= 16 and int(parts[1]) <= 31:
			best = a
		elif best == "":
			best = a
	return best

## Hosts a race on this device: the room here, a code the other players join with. Returns {code} or {error}.
static func host_race() -> Dictionary:
	stop_hosting()
	var addr := local_address()
	if addr == "":
		return {"error": I18n.t("No Wi-Fi network found. Connect to the network the other players are on.")}
	var h := P2p.new()
	for p in range(PORT_FIRST, PORT_LAST):
		if h._server.listen(p) == OK:
			h.port = p
			break
	if h.port == 0:
		return {"error": I18n.t("Cannot open a port for the race on this device.")}
	var c := ""
	for i in Const.ROOM_CODE_LENGTH:
		c += Const.ROOM_CODE_ALPHABET[randi() % Const.ROOM_CODE_ALPHABET.length()]
	var r := await _request(_api(c, "/host"), {})
	if r.status != 200:
		h._server.stop()
		return {"error": I18n.t("Cannot reach the game server to share the code. Check your connection.")}
	LocalRoom.create(c)
	h.code = c
	h.address = addr
	h._hosting = true
	instance = h
	(Engine.get_main_loop() as SceneTree).root.add_child(h)
	return {"code": c}

static func stop_hosting() -> void:
	if instance != null:
		instance._shutdown()
		instance.queue_free()
		instance = null

func _shutdown() -> void:
	_hosting = false
	for p in _peers:
		p.ws.close()
		if LocalRoom.room != null:
			LocalRoom.room.on_close(p.conn)
	_peers.clear()
	_server.stop()

func _process(dt: float) -> void:
	if not _hosting:
		return
	# guests: take the new connections
	while _server.is_connection_available():
		var ws := WebSocketPeer.new()
		ws.inbound_buffer_size = 1 << 20
		ws.outbound_buffer_size = 1 << 20
		if ws.accept_stream(_server.take_connection()) == OK:
			var id := "p2p-%d" % Time.get_ticks_msec()
			var peer := {"ws": ws, "open": false}
			peer.conn = RoomConn.new(id, func(data):
				if ws.get_ready_state() == WebSocketPeer.STATE_OPEN:
					if typeof(data) == TYPE_STRING:
						ws.send_text(data)
					else:
						ws.send(data, WebSocketPeer.WRITE_MODE_BINARY), func(_c, _r): ws.close())
			_peers.append(peer)
	var gone: Array = []
	for peer in _peers:
		var ws: WebSocketPeer = peer.ws
		ws.poll()
		var st := ws.get_ready_state()
		if st == WebSocketPeer.STATE_OPEN:
			peer.open = true
			while ws.get_available_packet_count() > 0:
				var pkt := ws.get_packet()
				var data = pkt.get_string_from_utf8() if ws.was_string_packet() else pkt
				# keepalive: answered here, as the server's edge answers it online
				if typeof(data) == TYPE_STRING and data == "ka":
					ws.send_text("ka")
				elif LocalRoom.room != null:
					LocalRoom.room.on_message(peer.conn, data)
		elif st == WebSocketPeer.STATE_CLOSED:
			if LocalRoom.room != null:
				LocalRoom.room.on_close(peer.conn)
			gone.append(peer)
	for g in gone:
		_peers.erase(g)
	# the server's relay: guests' offers are answered with this device's address (every poll also keeps the code listed)
	_poll_in -= dt
	if _poll_in <= 0.0:
		_poll_in = 1.0
		_poll_offers()

func _poll_offers() -> void:
	var r := await _request(_api(code, "/offers"))
	if not _hosting or r.status != 200:
		return
	for o in r.data.get("offers", []):
		if not _seen.has(o.id):
			_seen[o.id] = true
			await _request(_api(code, "/answer"), {"id": o.id, "sdp": "ws://%s:%d" % [address, port]})

## A WebSocket look-alike to the device hosting the race (the guest's side): the same interface as
## LocalRoom.LocalSocket, which Connection uses for offline rooms.
class P2pSocket:
	extends RefCounted
	const OPEN := 1
	var ready_state := 0
	var on_message: Callable
	var on_open: Callable
	var on_close: Callable
	var _ws: WebSocketPeer = null
	var _opened := false

	func _init(room_code: String) -> void:
		_connect.call_deferred(room_code)

	func _connect(room_code: String) -> void:
		var r := await P2p._request(P2p._api(room_code, "/offer"), {"sdp": P2p.MARKER})
		if r.status != 200:
			_shut()
			return
		var id: String = r.data.id
		for i in 40:
			if ready_state == 3:
				return
			await (Engine.get_main_loop() as SceneTree).create_timer(0.5).timeout
			var a := await P2p._request(P2p._api(room_code, "/answer/" + id))
			if a.status == 204:
				continue
			if a.status != 200:
				_shut()
				return
			_ws = WebSocketPeer.new()
			_ws.inbound_buffer_size = 1 << 20
			_ws.outbound_buffer_size = 1 << 20
			if _ws.connect_to_url(a.data.sdp) != OK:
				_ws = null
				_shut()
			return
		_shut()

	## Called every frame by Connection.
	func poll() -> void:
		if _ws == null:
			return
		_ws.poll()
		var st := _ws.get_ready_state()
		if st == WebSocketPeer.STATE_OPEN and not _opened:
			_opened = true
			ready_state = 1
			if on_open.is_valid():
				on_open.call()
		while _ws != null and _ws.get_ready_state() == WebSocketPeer.STATE_OPEN and _ws.get_available_packet_count() > 0:
			var pkt := _ws.get_packet()
			if on_message.is_valid():
				on_message.call(pkt.get_string_from_utf8() if _ws.was_string_packet() else pkt)
		if _ws != null and _ws.get_ready_state() == WebSocketPeer.STATE_CLOSED:
			_ws = null
			_shut()

	func send(data) -> void:
		if ready_state != 1 or _ws == null:
			return
		if typeof(data) == TYPE_STRING:
			_ws.send_text(data)
		else:
			_ws.send(data, WebSocketPeer.WRITE_MODE_BINARY)

	func close() -> void:
		if _ws != null:
			_ws.close()
			_ws = null
		_shut()

	func _shut() -> void:
		if ready_state == 3:
			return
		ready_state = 3
		if on_close.is_valid():
			on_close.call()
