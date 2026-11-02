class_name P2p
extends Node
## Races hosted on a device (port of net/p2p.ts): a phone at a friend's house, a laptop at a LAN. The host's game runs the
## room itself, as offline play does (RoomCore), and the other players connect straight to it over WebRTC data channels
## (the godotengine/webrtc-native extension in addons/webrtc_native). The game server only relays each connection's offer and
## answer once (apps/server/src/signal.ts); on one Wi-Fi network the race then stays on it (direct host candidates), the
## host at no latency at all, as in a LAN game. One reliable, ordered channel per player. Web guests and hosts interoperate.

const ICE := {"iceServers": [{"urls": ["stun:stun.l.google.com:19302"]}]}

static var instance: P2p = null
static var _known := {}

var code := ""
var _peers: Array = []   # {pc: WebRTCPeerConnection, dc: WebRTCDataChannel, conn: RoomConn, id: String}
var _seen := {}
var _poll_in := 0.0
var _hosting := false

static func available() -> bool:
	return ClassDB.can_instantiate("WebRTCPeerConnection")

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

## A peer connection whose session description comes complete: its ICE candidates are gathered (at most 3 s) and written
## into it, so one offer / answer carries everything (the server relays each only once). {pc, sdp}
class Handshake:
	extends RefCounted
	var pc: WebRTCPeerConnection
	var type := ""
	var sdp := ""
	var candidates: Array = []
	var created := false

	func _init() -> void:
		pc = WebRTCPeerConnection.new()
		pc.initialize(P2p.ICE)
		pc.session_description_created.connect(func(t, s):
			type = t
			sdp = s
			pc.set_local_description(t, s)
			created = true)
		pc.ice_candidate_created.connect(func(media, index, name): candidates.append("a=%s" % name))

	## Waits for the local description and the candidates.
	func complete() -> String:
		var tree := Engine.get_main_loop() as SceneTree
		var t0 := Time.get_ticks_msec()
		while not created and Time.get_ticks_msec() - t0 < 5000:
			pc.poll()
			await tree.process_frame
		t0 = Time.get_ticks_msec()
		while pc.get_gathering_state() != WebRTCPeerConnection.GATHERING_STATE_COMPLETE and Time.get_ticks_msec() - t0 < 3000:
			pc.poll()
			await tree.process_frame
		pc.poll()
		var lines := sdp.rstrip("\r\n")
		for c in candidates:
			lines += "\r\n" + c
		return lines + "\r\na=end-of-candidates\r\n"

## Hosts a race on this device: the room here, a code the other players join with. Returns {code} or {error}.
static func host_race() -> Dictionary:
	stop_hosting()
	if not available():
		return {"error": I18n.t("WebRTC is not available on this device.")}
	var c := ""
	for i in Const.ROOM_CODE_LENGTH:
		c += Const.ROOM_CODE_ALPHABET[randi() % Const.ROOM_CODE_ALPHABET.length()]
	var r := await _request(_api(c, "/host"), {})
	if r.status != 200:
		return {"error": I18n.t("Cannot reach the game server to share the code. Check your connection.")}
	LocalRoom.create(c)
	var h := P2p.new()
	h.code = c
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
		p.pc.close()
		if LocalRoom.room != null:
			LocalRoom.room.on_close(p.conn)
	_peers.clear()

func _process(dt: float) -> void:
	if not _hosting:
		return
	var gone: Array = []
	for peer in _peers:
		var pc: WebRTCPeerConnection = peer.pc
		pc.poll()
		var dc: WebRTCDataChannel = peer.dc
		if dc == null:
			continue
		var st := dc.get_ready_state()
		if st == WebRTCDataChannel.STATE_OPEN:
			while dc.get_available_packet_count() > 0:
				var pkt := dc.get_packet()
				var data = pkt.get_string_from_utf8() if dc.was_string_packet() else pkt
				# keepalive: answered here, as the server's edge answers it online
				if typeof(data) == TYPE_STRING and data == "ka":
					dc.write_mode = WebRTCDataChannel.WRITE_MODE_TEXT
					dc.put_packet("ka".to_utf8_buffer())
				elif LocalRoom.room != null:
					LocalRoom.room.on_message(peer.conn, data)
		elif st == WebRTCDataChannel.STATE_CLOSED:
			if LocalRoom.room != null:
				LocalRoom.room.on_close(peer.conn)
			gone.append(peer)
	for g in gone:
		_peers.erase(g)
	# the server's relay: guests' offers are answered (every poll also keeps the code listed)
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
			_accept(o.id, o.sdp)

## A guest's offer: answered, and its data channel becomes a connection to the room here.
func _accept(id: String, sdp: String) -> void:
	var hs := Handshake.new()
	var peer := {"pc": hs.pc, "dc": null, "id": id}
	peer.conn = RoomConn.new("p2p-" + id, func(data):
		var dc: WebRTCDataChannel = peer.dc
		if dc != null and dc.get_ready_state() == WebRTCDataChannel.STATE_OPEN:
			if typeof(data) == TYPE_STRING:
				dc.write_mode = WebRTCDataChannel.WRITE_MODE_TEXT
				dc.put_packet((data as String).to_utf8_buffer())
			else:
				dc.write_mode = WebRTCDataChannel.WRITE_MODE_BINARY
				dc.put_packet(data), func(_c, _r): hs.pc.close())
	_peers.append(peer)
	hs.pc.data_channel_received.connect(func(ch): peer.dc = ch)
	hs.pc.set_remote_description("offer", sdp)
	var answer := await hs.complete()
	if not _hosting:
		return
	await _request(_api(code, "/answer"), {"id": id, "sdp": answer})

## A WebSocket look-alike over a data channel to the device hosting the race (the guest's side): the same interface as
## LocalRoom.LocalSocket, which Connection uses for offline rooms.
class P2pSocket:
	extends RefCounted
	const OPEN := 1
	var ready_state := 0
	var on_message: Callable
	var on_open: Callable
	var on_close: Callable
	var _pc: WebRTCPeerConnection = null
	var _dc: WebRTCDataChannel = null
	var _opened := false

	func _init(room_code: String) -> void:
		_connect.call_deferred(room_code)

	func _connect(room_code: String) -> void:
		if not P2p.available():
			_shut()
			return
		var hs := P2p.Handshake.new()
		_pc = hs.pc
		_dc = _pc.create_data_channel("race", {"ordered": true})
		_pc.create_offer()
		var offer := await hs.complete()
		var r := await P2p._request(P2p._api(room_code, "/offer"), {"sdp": offer})
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
			_pc.set_remote_description("answer", a.data.sdp)
			return
		_shut()

	## Called every frame by Connection.
	func poll() -> void:
		if _pc == null or _dc == null:
			return
		_pc.poll()
		var st := _dc.get_ready_state()
		if st == WebRTCDataChannel.STATE_OPEN and not _opened:
			_opened = true
			ready_state = 1
			if on_open.is_valid():
				on_open.call()
		while _opened and _dc.get_ready_state() == WebRTCDataChannel.STATE_OPEN and _dc.get_available_packet_count() > 0:
			var pkt := _dc.get_packet()
			if on_message.is_valid():
				on_message.call(pkt.get_string_from_utf8() if _dc.was_string_packet() else pkt)
		if _dc != null and _dc.get_ready_state() == WebRTCDataChannel.STATE_CLOSED and _opened:
			_shut()
		if _pc != null and _pc.get_connection_state() == WebRTCPeerConnection.STATE_FAILED:
			_shut()

	func send(data) -> void:
		if ready_state != 1 or _dc == null:
			return
		if typeof(data) == TYPE_STRING:
			_dc.write_mode = WebRTCDataChannel.WRITE_MODE_TEXT
			_dc.put_packet((data as String).to_utf8_buffer())
		else:
			_dc.write_mode = WebRTCDataChannel.WRITE_MODE_BINARY
			_dc.put_packet(data)

	func close() -> void:
		if _pc != null:
			_pc.close()
			_pc = null
		_dc = null
		_shut()

	func _shut() -> void:
		if ready_state == 3:
			return
		ready_state = 3
		if on_close.is_valid():
			on_close.call()
