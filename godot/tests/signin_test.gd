extends Node
## The sign-in screen (headless, no server needed): Play as guest opens the driver-name box, the older accounts' form
## is behind its link, Continue as … only when this device has a driver, no Play Games button off Android. The device
## key from before the test is put back.
##   tools/godot/gd.sh tests/signin_test.gd
##   SHOTS=<dir> godot --path godot res://tests/runner.tscn -- res://tests/signin_test.gd   (a window: signin.png, signin_guest.png)

var failures := 0

func _ok(cond: bool, what: String) -> void:
	print(("ok   " if cond else "FAIL ") + what)
	if not cond:
		failures += 1

func _buttons(n: Node) -> Array:
	return n.find_children("*", "BaseButton", true, false).filter(func(b): return b is Button or b is LinkButton)

func _text(n: Node, t: String) -> Array:
	return _buttons(n).filter(func(b): return b.text.to_lower() == t.to_lower())

func _ready() -> void:
	var keep_device = FileAccess.get_file_as_string(Account.DEVICE_PATH) if FileAccess.file_exists(Account.DEVICE_PATH) else null
	Account._save_device({})
	var app = load("res://scripts/app/app.gd").new()
	add_child(app)
	await get_tree().process_frame
	var s: Control = SocialUI.sign_in_screen(app, func(): pass, func(): pass)
	add_child(s)
	await get_tree().process_frame
	var guest: Array = _text(s, "Play as guest")
	_ok(guest.size() == 1 and guest[0].visible, "Play as guest is there")
	_ok(_text(s, "Continue with Google Play Games").is_empty(), "no Play Games button off Android")
	_ok(_buttons(s).filter(func(b): return b.text.begins_with("CONTINUE AS")).is_empty(), "no Continue as … without a driver on this device")
	var start: Array = _text(s, "START RACING")
	_ok(start.size() == 1 and not start[0].is_visible_in_tree(), "the driver-name box shut at first")
	guest[0].pressed.emit()
	_ok(start[0].is_visible_in_tree() and not guest[0].visible, "Play as guest opens it")
	var legacy: Array = _text(s, "I have a nickname and password")
	var sign: Array = _text(s, "SIGN IN")
	_ok(legacy.size() == 1 and sign.size() == 1 and not sign[0].is_visible_in_tree(), "the older accounts' form behind its link")
	legacy[0].pressed.emit()
	_ok(sign[0].is_visible_in_tree(), "and opened by it")
	_ok(_text(s, "Create account").is_empty(), "no account to create")
	s.queue_free()
	Account._save_device({"id": "x", "key": "0".repeat(48), "nick": "Ana"})
	var s2: Control = SocialUI.sign_in_screen(app, func(): pass, func(): pass)
	add_child(s2)
	await get_tree().process_frame
	_ok(_text(s2, "CONTINUE AS ANA").size() == 1, "Continue as Ana with a driver on this device")
	# SHOTS=<dir> (a rendered run): the screen as the game shows it, then with the guest box open
	if OS.get_environment("SHOTS") != "":
		s2.queue_free()
		app.show_sign_in()
		await get_tree().create_timer(2.0).timeout
		get_viewport().get_texture().get_image().save_png(OS.get_environment("SHOTS") + "/signin.png")
		for b in app.find_children("*", "Button", true, false):
			if b.text.to_lower() == "play as guest":
				b.pressed.emit()
		await get_tree().create_timer(0.8).timeout
		get_viewport().get_texture().get_image().save_png(OS.get_environment("SHOTS") + "/signin_guest.png")
	if keep_device == null:
		Account._save_device({})
	else:
		FileAccess.open(Account.DEVICE_PATH, FileAccess.WRITE).store_string(keep_device)
	print("%d failures" % failures)
	get_tree().quit(1 if failures > 0 else 0)
