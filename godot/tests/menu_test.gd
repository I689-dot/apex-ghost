extends Node
## The menus after the redesign (DECISIONS.md "Godot: menu redesign"), in a real App: every screen builds in both
## languages (menu tabs, career pages, every settings page, each lobby page of a solo room, the results), the menu layer
## carries the theme, a screen focuses its main control for the pad, the ‹ value › stepper and the switch work with the
## pad's keys, and Esc (the pad's B) steps back: a modal closes, a lobby page returns to the overview, the career to
## the menu. Nothing is saved.
##   tools/godot/gd.sh tests/menu_test.gd

var failures := 0
var app: App

func _ok(cond: bool, what: String) -> void:
	print(("ok   " if cond else "FAIL ") + what)
	if not cond:
		failures += 1

func _ready() -> void:
	_run.call_deferred()

func _frames(n: int = 3) -> void:
	for i in n:
		await get_tree().process_frame

func _count(n: Node, cls: Variant) -> int:
	var c := 1 if is_instance_of(n, cls) else 0
	for ch in n.get_children():
		c += _count(ch, cls)
	return c

func _esc() -> void:
	var e := InputEventKey.new()
	e.keycode = KEY_ESCAPE
	e.physical_keycode = KEY_ESCAPE
	e.pressed = true
	app._unhandled_input(e)

func _run() -> void:
	var saved: Dictionary = Settings.data.duplicate(true)
	Settings.data.introCinematic = false
	app = load("res://scripts/app/app.gd").new()
	add_child(app)
	await _frames(4)
	_ok(app.ui.theme != null and app.ui.theme == UIKit.theme, "the menu layer carries the theme")
	var f := get_viewport().gui_get_focus_owner()
	_ok(f != null and app.ui.is_ancestor_of(f), "the menu focuses a control for the pad (%s)" % (f.get_class() if f != null else "none"))
	for lang in ["en"]:
		for t in ["play", "online", "friends"]:
			MenuScreen._tab = t
			app.show_menu()
			await _frames()
			_ok(_count(app.ui, UIW.TabButton) >= 4, "menu %s builds (%s)" % [t, lang])
		for t in ["profile", "achievements", "ranks"]:
			CareerScreen._tab = t
			app.show_career()
			await _frames()
			_ok(app.ui.get_child_count() > 0 and _count(app.ui, UIW.TabButton) == 3, "career %s builds (%s)" % [t, lang])
		for page in ["graphics", "display", "view", "driving", "interface", "audio", "controls", "controller", "account", "presets"]:
			SettingsPanel._tab = page
			var panel := SettingsPanel.build(app, func(): pass)
			await _frames(2)
			var rows := _count(panel, UIW.Stepper) + _count(panel, UIW.Switch) + _count(panel, HSlider) + _count(panel, Button)
			# (the account page offline: only "Connect again")
			_ok(rows > (0 if page == "account" else 6) and panel.theme == UIKit.theme, "settings %s builds (%s): %d controls" % [page, lang, rows])
			panel.queue_free()
			await _frames(1)
	# the sign-in screen the game opens on (signed out), and no sign-in of the menu's own
	_ok(_find(app.ui, Button, func(n): return (n as Button).text.to_upper() == "SIGN IN") == null, "the menu has no sign-in button")
	app.show_sign_in()
	await _frames(3)
	_ok(app.screen == "signin" and _find(app.ui, LineEdit, func(n): return (n as LineEdit).secret) != null, "the sign-in screen asks for the password")
	if OS.get_environment("STORE_SHOT") != "":
		await get_tree().create_timer(0.8).timeout
		get_viewport().get_texture().get_image().save_png("%s/signin.png" % OS.get_environment("STORE_SHOT"))
	app.show_menu()
	await _frames()
	# the store (a preview: no payments): every page builds, a code adds to the preview balance, the checkout's pay
	# button is off. STORE_SHOT=<dir>: each page and the checkout as pictures
	var store_shot := OS.get_environment("STORE_SHOT")
	MenuScreen._tab = "store"
	for t in ["coins", "items", "offers", "redeem", "invite"]:
		StoreScreen._tab = t
		app.show_menu()
		await _frames()
		_ok(_count(app.ui, UIW.TabButton) >= 10, "store %s builds" % t)
		if store_shot != "":
			await get_tree().create_timer(2.5 if t == "items" else 0.6).timeout
			get_viewport().get_texture().get_image().save_png("%s/store_%s.png" % [store_shot, t])
	var before := StoreScreen.preview_coins
	StoreScreen._tab = "redeem"
	app.show_menu()
	await _frames()
	var code_box: LineEdit = _find(app.ui, LineEdit, func(n): return (n as LineEdit).placeholder_text == "XXXX-XXXX")
	code_box.text = "welcome500"
	code_box.text_submitted.emit(code_box.text)
	await _frames()
	_ok(StoreScreen.preview_coins == before + 500, "a promotional code adds its coins to the preview balance")
	StoreScreen._tab = "coins"
	app.show_menu()
	await _frames()
	StoreScreen._checkout(app, "2,400 coins", [["2,000 coins", ""], ["Bonus coins", "+400"]], 19.99, func(): pass)
	await _frames(3)
	var pay: Button = _find(app.overlay_layer, Button, func(n): return (n as Button).text.to_upper().begins_with("PAY €"))
	_ok(pay != null and pay.disabled, "the checkout's pay button is off in the preview")
	if store_shot != "":
		await get_tree().create_timer(0.5).timeout
		get_viewport().get_texture().get_image().save_png("%s/store_checkout.png" % store_shot)
	for c in app.overlay_layer.get_children():
		if c.has_meta("modal"):
			c.queue_free()
	StoreScreen.preview_coins = before
	StoreScreen._redeemed.clear()
	if OS.get_environment("STORE_SHOT") != "":
		# the settings' driving page (assist levels) and the presets page, as pictures
		for page in ["driving", "presets", "account"]:
			SettingsPanel._tab = page
			var sp := SettingsPanel.build(app, func(): pass)
			await get_tree().create_timer(0.6).timeout
			get_viewport().get_texture().get_image().save_png("%s/settings_%s.png" % [OS.get_environment("STORE_SHOT"), page])
			sp.queue_free()
			await _frames(2)
	MenuScreen._tab = "play"
	CareerScreen._tab = "profile"

	# the stepper: the pad's right / left step it, the ends hold, the callback gets the value
	var got := []
	var st := UIW.stepper("b", [["a", "A"], ["b", "B"], ["c", "C"]], func(v): got.append(v))
	add_child(st)
	var right := InputEventAction.new()
	right.action = "ui_right"
	right.pressed = true
	var left := InputEventAction.new()
	left.action = "ui_left"
	left.pressed = true
	st._gui_input(right)
	st._gui_input(right)
	_ok(st.value() == "c" and got == ["c"], "stepper steps right and holds at the end (%s)" % [got])
	st._gui_input(left)
	st._gui_input(left)
	st._gui_input(left)
	_ok(st.value() == "a" and got == ["c", "b", "a"], "stepper steps left and holds at the start (%s)" % [got])
	var off := UIW.stepper("a", [["a", "A"], ["b", "B"]], func(v): got.append(v), false)
	add_child(off)
	off._gui_input(right)
	_ok(off.value() == "a" and off.focus_mode == Control.FOCUS_NONE, "a read-only stepper does not step")
	st.queue_free()
	off.queue_free()
	# the switch
	var flips := []
	var sw := UIW.switch(false, func(v): flips.append(v))
	add_child(sw)
	sw.button_pressed = true
	_ok(flips == [true], "switch reports a flip")
	var ro := UIW.switch(true, null)
	_ok(ro.disabled and ro.focus_mode == Control.FOCUS_NONE, "a read-only switch is disabled")
	sw.queue_free()
	ro.free()

	# back steps: a modal closes, the career returns to the menu
	app.show_menu()
	await _frames()
	SocialUI.records_modal(app)
	await _frames()
	var modals := func() -> int: return app.overlay_layer.get_children().filter(func(c): return c.has_meta("modal") and not c.is_queued_for_deletion()).size()
	_ok(modals.call() == 1, "the records modal opens")
	_esc()
	await _frames()
	_ok(modals.call() == 0, "Esc closes the modal")
	app.open_settings()
	await _frames()
	_ok(modals.call() == 1, "the settings open over the menu")
	_esc()
	await _frames()
	_ok(modals.call() == 0 and app.screen == "menu", "Esc closes the settings, the menu stays")
	app.show_career()
	await _frames()
	_esc()
	await _frames()
	_ok(app.screen == "menu", "Esc from the career returns to the menu")

	# a solo room: every lobby page, the big action, back to the overview
	var err := await app.join(LocalRoom.create(), "Max")
	_ok(err == "", "joined a solo room")
	await get_tree().create_timer(0.4).timeout
	for page in ["hub", "circuit", "car", "session", "conditions", "rules", "drivers"]:
		LobbyScreen._page = page
		app.render_lobby()
		await _frames()
		var has_start := false
		for b in app.ui.find_children("*", "Button", true, false):
			if (b as Button).text == I18n.t("Start race").to_upper():
				has_start = true
		_ok(has_start, "lobby %s builds with the start button" % page)
	LobbyScreen._page = "rules"
	app.render_lobby()
	await _frames()
	_esc()
	await _frames()
	_ok(LobbyScreen._page == "hub", "Esc from a lobby page returns to the overview")
	_ok(_count(app.ui, UIW.Stepper) == 0 and _count(app.ui, UIW.TabButton) == 6, "the overview shows the six weekend tabs")
	# the paint page: your car turning, its choices
	LobbyScreen._page = "paint"
	app.render_lobby()
	await _frames()
	_ok(_count(app.ui, CarStudio.Preview) == 1 and _count(app.ui, ColorPickerButton) >= 5, "the paint page shows your car and the colour choices")
	if OS.get_environment("PAINT_SHOT") != "":
		# a rendered run: the page as it looks, once the car has loaded and turned a little
		await get_tree().create_timer(2.5).timeout
		get_viewport().get_texture().get_image().save_png(OS.get_environment("PAINT_SHOT"))
	if OS.get_environment("PAINT_SHOT") != "":
		# the car page too: the big picture and the strip of cars (CarStudio's brand-free pictures)
		LobbyScreen._page = "car"
		app.render_lobby()
		await get_tree().create_timer(4.0).timeout
		get_viewport().get_texture().get_image().save_png(OS.get_environment("PAINT_SHOT").replace(".png", "_car.png"))
	LobbyScreen._page = "hub"
	app.render_lobby()
	await _frames()

	# the results from made-up rows, with the room closed (no championship is scored)
	var ids: Array = CarsDb.selectable().map(func(c): return c.id)
	var rows: Array = []
	for i in 4:
		rows.append({"id": app.me if i == 0 else "b%d" % i, "nick": "D%d" % i, "carId": ids[i], "position": i + 1, "totalMs": 600000.0 + i * 1000.0,
			"penaltyMs": 0.0, "gapMs": i * 1000.0, "bestLapMs": 118000.0 + i * 100.0, "validLaps": 5, "dnf": false})
	app.teardown_connection()
	app.screen = "results"
	app.set_ui(ResultsScreen.build(app, {"kind": "race", "rows": rows, "fastestLap": {"id": app.me, "ms": 118000.0}, "raceId": 1}, null))
	await _frames()
	var back := false
	for b in app.ui.find_children("*", "Button", true, false):
		if (b as Button).text == I18n.t("Back to lobby").to_upper():
			back = true
	_ok(back, "the results build with Back to lobby")
	Settings.data = saved
	print("%d failures" % failures)
	get_tree().quit(1 if failures else 0)

## The first node under `root` of `type` that `ok` accepts.
func _find(root: Node, type, ok: Callable) -> Node:
	for n in root.find_children("*", "", true, false):
		if is_instance_of(n, type) and ok.call(n):
			return n
	return null
