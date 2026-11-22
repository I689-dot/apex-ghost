extends Node
## The signed-in account (port of net/account.ts), an autoload named Account: a guest (a driver name and a device key
## kept in user://device.json) or a Google Play Games player, no e-mail and no password (the server's accounts.ts; the
## first nickname-and-password accounts still sign in), its friends, presence and records. The token is kept on this device; signed in, your
## nickname is the account's, your rooms tell the server who you are (hello.account) so your laps and results go to
## your records, and a heartbeat tells your friends where you are.
## API calls are async: `var r = await Account.login(nick, pw)` returns {ok, status, data, error}.

signal changed(account: Variant)

const SAVE_PATH := "user://account.json"
## {id, key, nick}: the guest (or Play Games) account this device signs back in to without anyone typing anything.
const DEVICE_PATH := "user://device.json"

## {token, user} or null.
var current: Variant = null
var _presence := {"state": "menu", "room": null, "trackId": null, "session": null}
var _last_sent := ""
var _timer: Timer = null
var _accounts_on: Variant = null
## Sign back in on its own with the device key (off after signing out: the sign-in screen offers it instead).
var auto_resume := true

func _ready() -> void:
	var a := JsonFile.read(SAVE_PATH)
	if not a.is_empty():
		current = a

func account() -> Variant:
	return current

func _save(a: Variant) -> void:
	current = a
	if a != null:
		JsonFile.write(SAVE_PATH, a)
	else:
		JsonFile.remove(SAVE_PATH)
	changed.emit(a)
	if a != null:
		_send_presence()

## One request to the server's API. body == null: GET, otherwise POST with JSON. Returns {ok, status, data, error}.
func api(path: String, body: Variant = null, token: Variant = null) -> Dictionary:
	var tk: Variant = token if token != null else (current.token if current != null else null)
	var r := await JsonHttp.request("%s/api/%s" % [Config.SERVER_URL, path], body, tk, self)
	if not r.sent:
		return {"ok": false, "status": 0, "data": {}, "error": JsonHttp.unreachable()}
	var status: int = r.status
	var data: Dictionary = r.data
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

# ------------------------------------------------------- guest and Google Play Games ---

## The device key's account ({id, key, nick}), or {} when this device has none.
func device() -> Dictionary:
	var d := JsonFile.read(DEVICE_PATH)
	return d if d.has("id") and d.has("key") else {}

func _save_device(d: Dictionary) -> void:
	if d.is_empty():
		JsonFile.remove(DEVICE_PATH)
	else:
		JsonFile.write(DEVICE_PATH, d)

## How the signed-in account signs in: "guest", "playGames" or "password" (the first accounts).
func kind() -> String:
	if current == null:
		return ""
	var u: Dictionary = current.user
	if u.get("playGames", false):
		return "playGames"
	return str(u.get("kind", "guest" if device().get("id", "") == u.get("id", "") else "password"))

## Play as a guest: an account under that driver name (empty: the server picks DriverNNNN; a number is added to a
## taken one) whose key stays on this device.
func guest(nick: String, invite: String = "") -> Dictionary:
	var body := {"nick": nick.strip_edges()}
	if invite.strip_edges() != "":
		body.invite = invite.strip_edges()
	var r := await api("account/guest", body)
	if r.ok:
		_save_device({"id": r.data.user.id, "key": r.data.key, "nick": r.data.user.nick})
		_save({"token": r.data.token, "user": r.data.user})
	return r

## Back in to the device key's account.
func resume() -> Dictionary:
	var d := device()
	if d.is_empty():
		return {"ok": false, "status": 404, "data": {}, "error": "No driver on this device."}
	var r := await api("account/resume", {"id": d.id, "key": d.key})
	if r.ok:
		d.nick = r.data.user.nick
		_save_device(d)
		_save(r.data)
	elif r.status == 401:
		_save_device({}) # the account is gone (deleted elsewhere)
	return r

## Google Play Games: the plugin's server auth code (PlayGames.auth_code) for the server to check with Google. Signed
## in as a guest, the guest is linked to the player (what it raced is kept); a player with an account signs in to it.
func play_games(code: String) -> Dictionary:
	var r := await api("account/play-games", {"code": code})
	if r.ok:
		if r.data.has("key"):
			_save_device({"id": r.data.user.id, "key": r.data.key, "nick": r.data.user.nick})
		_save({"token": r.data.token, "user": r.data.user})
	return r

## A new driver name.
func rename(nick: String) -> Dictionary:
	var r := await api("account/nick", {"nick": nick.strip_edges()})
	if r.ok and current != null:
		var a: Dictionary = current.duplicate()
		a.user = r.data.user
		_save(a)
		var d := device()
		if d.get("id", "") == r.data.user.id:
			d.nick = r.data.user.nick
			_save_device(d)
	return r

## invite: a friend's invite code (optional; a wrong one does not stop the account, it is just not applied).
func register(nick: String, password: String, invite: String = "") -> Dictionary:
	var body := {"nick": nick, "password": password}
	if invite.strip_edges() != "":
		body.invite = invite.strip_edges()
	var r := await api("account/register", body)
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

# ---------------------------------------------------- coins, invites, ranking (the server's economy.ts) ---

## {coins, rating, races, ledger: [{delta, reason, at}]}
func wallet() -> Dictionary:
	return await api("wallet")

## A promotional code: {coins, added, what}, or the server's reason it did not work.
func redeem(code: String) -> Dictionary:
	return await api("redeem", {"code": code})

## My invite code and how many friends joined with it and raced: {code, invited, racing, inviteRaces, rewards}.
func invite() -> Dictionary:
	return await api("invite")

func apply_invite(code: String) -> Dictionary:
	return await api("invite/apply", {"code": code})

## The ranking by Driver Rating: {rows: [{nick, country, abbr, num, rating, races}], me: {rank, rating, races}}.
func ranking(scope: String = "global") -> Dictionary:
	return await api("ranking?scope=%s" % scope)

## A new password (the current one again first). The server signs out every other device.
func change_password(old_pw: String, new_pw: String) -> Dictionary:
	return await api("account/password", {"password": old_pw, "newPassword": new_pw})

## Deletes the account and everything of it on the server, then signs out here: a guest's proof is its device key, a
## Play Games player's the Play Games sign-in; the first accounts' the password again (pw).
func delete_account(pw: String = "") -> Dictionary:
	var d := device()
	var mine: bool = current != null and d.get("id", "") == current.user.get("id", "")
	var body: Dictionary = {"confirm": true} if kind() == "playGames" else {"password": d.key if mine and pw == "" else pw}
	var r := await api("account/delete", body)
	if r.ok:
		if mine:
			_save_device({})
		_save(null)
	return r

## Signs out here (the device key stays: the sign-in screen offers "Continue as …").
func logout() -> void:
	auto_resume = false
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

## Settings › Account › Privacy: off, nothing is sent and friends see you offline (the server forgets you in ~90 s).
static func _shows_online() -> bool:
	return bool(Settings.data.get("privacy", {}).get("showOnline", true))

func _send_presence() -> void:
	if current == null or not _shows_online():
		return
	_last_sent = JSON.stringify(_presence)
	api("presence", {"presence": _presence})
	if _timer == null:
		_timer = Timer.new()
		_timer.wait_time = 45.0
		_timer.timeout.connect(func() -> void: if current != null and _shows_online(): api("presence", {"presence": _presence}))
		add_child(_timer)
		_timer.start()
