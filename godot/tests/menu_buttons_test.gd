extends Node
## Every button of the main menu pressed, one at a time (the user, 2026-11-18: "some buttons crash the game or freeze
## it on the menu"): for each, the longest frame after it (a freeze), and whether the game is still there. Buttons that
## leave the menu (a race, the career, a dialog) are followed back to the menu. Prints one line a button; the log's
## SCRIPT ERRORs between the lines belong to the button above them.
##   godot --path godot res://tests/runner.tscn --resolution 1600x900 -- res://tests/menu_buttons_test.gd

var app

func _ready() -> void:
	_run.call_deferred()

func _frames(n: int) -> void:
	for i in n:
		await get_tree().process_frame

## Every pressable button under a node, by a path of texts that finds it again after the menu is rebuilt.
func _buttons(root: Node) -> Array:
	var out: Array = []
	for n in root.find_children("*", "BaseButton", true, false):
		var b := n as BaseButton
		if b.is_visible_in_tree() and not b.disabled:
			out.append(b)
	return out

func _label(b: BaseButton) -> String:
	if b is Button and (b as Button).text != "":
		return (b as Button).text
	var ls := b.find_children("*", "Label", true, false)
	var t := []
	for l in ls:
		if (l as Label).text != "":
			t.append((l as Label).text)
	return " / ".join(t.slice(0, 2)) if not t.is_empty() else (b.tooltip_text if b.tooltip_text != "" else b.get_class())

func _back_to_menu() -> void:
	for c in app.overlay_layer.get_children():
		if c.has_meta("close"):
			(c.get_meta("close") as Callable).call()
		elif c.has_meta("modal"):
			c.queue_free()
	if app.screen != "menu":
		if app.session != null or app.conn != null:
			app.leave()
		else:
			app.show_menu()
	await _frames(6)

func _run() -> void:
	Settings.data.introCinematic = false
	app = load("res://scripts/app/app.gd").new()
	add_child(app)
	await _frames(10)
	for tab in ["play", "online", "friends", "store"]:
		MenuScreen._tab = tab
		app.show_menu()
		await _frames(6)
		var n := _buttons(app.ui).size()
		for i in n:
			MenuScreen._tab = tab
			app.show_menu()
			await _frames(4)
			var list := _buttons(app.ui)
			if i >= list.size():
				break
			var b: BaseButton = list[i]
			var name := _label(b)
			var t0 := Time.get_ticks_msec()
			b.pressed.emit()
			var worst := 0.0
			var t_prev := Time.get_ticks_msec()
			# up to 4 s after the press: the longest gap between two frames
			while Time.get_ticks_msec() - t0 < 4000:
				await get_tree().process_frame
				var now := Time.get_ticks_msec()
				worst = maxf(worst, now - t_prev)
				t_prev = now
			print("[%s] %-40s screen=%-8s longest frame %5.0f ms%s" % [tab, name.left(40), app.screen, worst, "   <-- FREEZE" if worst > 700.0 else ""])
			await _back_to_menu()
	# the settings: every top tab and sub-tab switches the page (they called an empty Callable before 2026-11-18)
	var pages := {}
	var panel := SettingsPanel.build(app, func(): pass)
	await _frames(4)
	for g in SettingsPanel.GROUPS:
		var tabs := panel.find_children("*", "", true, false).filter(func(t): return t is UIW.TabButton and t.has_meta("key") and t.get_meta("key") == g[0])
		if tabs.is_empty():
			print("[settings] no tab for ", g[0])
			continue
		(tabs[0] as BaseButton).pressed.emit()
		await _frames(3)
		pages[SettingsPanel._tab] = true
		for sub in g[2]:
			var subs := panel.find_children("*", "", true, false).filter(func(t): return t is UIW.TabButton and t.has_meta("key") and t.get_meta("key") == sub)
			if subs.is_empty():
				continue
			(subs[0] as BaseButton).pressed.emit()
			await _frames(3)
			pages[SettingsPanel._tab] = true
	print("[settings] pages reached by their tabs: %s" % ", ".join(pages.keys()))
	panel.queue_free()
	print("menu buttons: done")
	get_tree().quit(0)
