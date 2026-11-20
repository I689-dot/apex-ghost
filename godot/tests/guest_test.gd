extends Node
## Guest drivers from the game against a server (APEX_SERVER=http://127.0.0.1:8799 with `wrangler dev` in apps/server;
## never the live one): play as a guest under a driver name (a number added when it is taken), the device key kept,
## back in with it after the token is lost, a new name, signing out keeps the key, deleting the driver forgets it.
## The account and device key from before the test are put back.
##   APEX_SERVER=http://127.0.0.1:8799 tools/godot/gd.sh tests/guest_test.gd

var failures := 0

func _ok(cond: bool, what: String) -> void:
	print(("ok   " if cond else "FAIL ") + what)
	if not cond:
		failures += 1

static func _read(path: String) -> Variant:
	return FileAccess.get_file_as_string(path) if FileAccess.file_exists(path) else null

static func _put(path: String, text: Variant) -> void:
	if text == null:
		if FileAccess.file_exists(path):
			DirAccess.remove_absolute(ProjectSettings.globalize_path(path))
		return
	var f := FileAccess.open(path, FileAccess.WRITE)
	f.store_string(text)

func _ready() -> void:
	if not Config.SERVER_URL.begins_with("http://127.0.0.1"):
		print("APEX_SERVER must be a local server")
		get_tree().quit(1)
		return
	var keep_account = _read(Account.SAVE_PATH)
	var keep_device = _read(Account.DEVICE_PATH)
	var before = Account.account()
	var name := "Gst%d" % (randi() % 100000)
	var g: Dictionary = await Account.guest(name)
	_ok(g.ok and Account.account().user.nick == name and Account.kind() == "guest", "a guest under its driver name (%s)" % str(g.get("error", "")))
	var d := Account.device()
	_ok(d.get("id", "") == Account.account().user.id and str(d.get("key", "")).length() == 48, "its device key is kept")
	var other: Dictionary = await Account.api("account/guest", {"nick": name})
	_ok(other.ok and str(other.data.user.nick).begins_with(name) and other.data.user.nick != name, "the same name again gets a number (%s)" % str(other.data.get("user", {}).get("nick", "")))
	# the token lost (as a 401 does): back in with the key
	Account._save(null)
	var r: Dictionary = await Account.resume()
	_ok(r.ok and Account.account().user.id == d.id, "back in with the device key")
	var n: Dictionary = await Account.rename(name + "x")
	_ok(n.ok and Account.account().user.nick == name + "x" and Account.device().nick == name + "x", "a new driver name, on the device too")
	var taken: Dictionary = await Account.rename(str(other.data.user.nick))
	_ok(not taken.ok and taken.status == 409, "a taken name is refused")
	await Account.logout()
	_ok(Account.account() == null and not Account.device().is_empty() and not Account.auto_resume, "signing out keeps the key, no sign-in on its own")
	await Account.resume()
	var del: Dictionary = await Account.delete_account()
	_ok(del.ok and Account.account() == null and Account.device().is_empty(), "deleting the driver: no password asked, the key forgotten (%s)" % str(del.get("error", "")))
	var gone: Dictionary = await Account.api("account/resume", {"id": d.id, "key": d.key})
	_ok(gone.status == 401, "the deleted driver cannot come back")
	var pg: Dictionary = await Account.api("account/play-games", {"code": "x"})
	_ok(pg.status == 503, "Play Games: not set up on a server without its Google client")
	# the other guest away too, then the player's own account back
	await Account.api("account/delete", {"password": other.data.key}, other.data.token)
	_put(Account.SAVE_PATH, keep_account)
	_put(Account.DEVICE_PATH, keep_device)
	Account.current = before
	print("%d failures" % failures)
	get_tree().quit(1 if failures > 0 else 0)
