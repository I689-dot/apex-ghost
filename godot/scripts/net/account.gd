extends Node
## The signed-in account (port of net/account.ts), an autoload named Account: a nickname and a password (no e-mail:
## the server's accounts.ts), its friends, presence and records. The token is kept on this device; signed in, your
## nickname is the account's, your rooms tell the server who you are (hello.account) so your laps and results go to
## your records, and a heartbeat tells your friends where you are.
## API calls are async: `var r = await Account.login(nick, pw)` returns {ok, status, data, error}.

signal changed(account)

const SAVE_PATH := "user://account.json"

## {token, user} or null.
var current: Variant = null
var _presence := {"state": "menu", "room": null, "trackId": null, "session": null}
var _last_sent := ""
var _timer: Timer = null
var _accounts_on: Variant = null

func _ready() -> void:
	if FileAccess.file_exists(SAVE_PATH):
		var v = JSON.parse_string(FileAccess.get_file_as_string(SAVE_PATH))
		if typeof(v) == TYPE_DICTIONARY:
			current = v

func account() -> Variant:
	return current

func _save(a: Variant) -> void:
	current = a
	if a != null:
		var f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
		if f != null:
			f.store_string(JSON.stringify(a))
	elif FileAccess.file_exists(SAVE_PATH):
		DirAccess.remove_absolute(ProjectSettings.globalize_path(SAVE_PATH))
	changed.emit(a)
	if a != null:
		_send_presence()

## One request to the server's API. body == null: GET, otherwise POST with JSON. Returns {ok, status, data, error}.
func api(path: String, body: Variant = null, token: Variant = null) -> Dictionary:
	var req := HTTPRequest.new()
	add_child(req)
	var headers := PackedStringArray(["Content-Type: application/json"])
	var tk = token if token != null else (current.token if current != null else null)
	if tk != null:
		headers.append("Authorization: Bearer %s" % tk)
	var err := req.request("%s/api/%s" % [Config.SERVER_URL, path], headers, HTTPClient.METHOD_GET if body == null else HTTPClient.METHOD_POST, "" if body == null else JSON.stringify(body))
	if err != OK:
		req.queue_free()
		return {"ok": false, "status": 0, "data": {}, "error": I18n.t("Cannot reach the game server. Check your connection.")}
	var res: Array = await req.request_completed
	req.queue_free()
	var status: int = res[1]
	var text: String = (res[3] as PackedByteArray).get_string_from_utf8()
	var data = JSON.parse_string(text)
	if typeof(data) != TYPE_DICTIONARY:
		data = {}
	if res[0] != HTTPRequest.RESULT_SUCCESS:
		return {"ok": false, "status": 0, "data": {}, "error": I18n.t("Cannot reach the game server. Check your connection.")}
	if status < 200 or status >= 300:
		# a token the server no longer knows (signed out elsewhere, account removed): signed out here too
		if status == 401 and current != null and path != "account/login":
			_save(null)
		return {"ok": false, "status": status, "data": data, "error": data.get("error", "Server error (%d)." % status)}
	return {"ok": true, "status": status, "data": data, "error": ""}

## Does the server keep accounts? Online play needs one only then. null until known.
func accounts_enabled() -> Variant:
	return _accounts_on

func probe_accounts() -> bool:
	if _accounts_on != null:
		return _accounts_on
	var r := await api("account/me")
	if r.status == 0:
		return true # unreachable: keep online locked for the signed-out; ask again next time
	_accounts_on = r.status != 503
	return _accounts_on

func register(nick: String, password: String) -> Dictionary:
	var r := await api("account/register", {"nick": nick, "password": password})
	if r.ok:
		_save(r.data)
	return r

func login(nick: String, password: String) -> Dictionary:
	var r := await api("account/login", {"nick": nick, "password": password})
	if r.ok:
		_save(r.data)
		await refresh_profile()
	return r

## The signed-in user with the driver profile, from the server (after signing in, and at start).
func refresh_profile() -> void:
	if current == null:
		return
	var r := await api("account/me")
	if r.ok and current != null:
		var a: Dictionary = current.duplicate()
		a.user = r.data.user
		_save(a)

## Saves the driver profile ({country, num, abbr, colour}; null clears a field).
func save_profile(p: Dictionary) -> Dictionary:
	var r := await api("account/profile", p)
	if r.ok and current != null:
		var a: Dictionary = current.duplicate()
		a.user = r.data.user
		_save(a)
	return r

func logout() -> void:
	if current != null:
		await api("account/logout", {})
	_save(null)

func friends() -> Array:
	var r := await api("friends")
	return r.data.get("friends", []) if r.ok else []

func add_friend(nick: String) -> Dictionary:
	return await api("friends/add", {"nick": nick})

func accept_friend(id: String) -> Dictionary:
	return await api("friends/accept", {"id": id})

func remove_friend(id: String) -> Dictionary:
	return await api("friends/remove", {"id": id})

## Records: q = {track, car?, scope: "global"|"friends", wet?}.
func records(q: Dictionary) -> Array:
	var params := "track=%s&scope=%s" % [String(q.track).uri_encode(), q.scope]
	if q.get("car"):
		params += "&car=%s" % String(q.car).uri_encode()
	if q.get("wet"):
		params += "&wet=1"
	var r := await api("records?%s" % params)
	return r.data.get("rows", []) if r.ok else []

func stats(user: String = "") -> Dictionary:
	var r := await api("stats" if user == "" else "stats?user=%s" % user.uri_encode())
	return r.data.get("stats", {}) if r.ok else {}

# -------------------------------------------------------------- presence ---

## Where I am now: sent at once when it changes, and every 45 s while signed in (friends see it for 90 s).
func set_presence(p: Dictionary) -> void:
	_presence = p
	if JSON.stringify(p) != _last_sent:
		_send_presence()

func _send_presence() -> void:
	if current == null:
		return
	_last_sent = JSON.stringify(_presence)
	api("presence", {"presence": _presence})
	if _timer == null:
		_timer = Timer.new()
		_timer.wait_time = 45.0
		_timer.timeout.connect(func(): if current != null: api("presence", {"presence": _presence}))
		add_child(_timer)
		_timer.start()
