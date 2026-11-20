extends Node
## Settings opened from the phone layout's garage home (the gear) apply at once, as from the classic menu: the master
## volume moved on the Audio page reaches the audio bus while the panel is still open. In memory only (the runner sets
## Settings.testing: nothing is saved).
##   tools/godot/gd.sh tests/phone_settings_test.gd

var failures := 0

func _ok(cond: bool, what: String) -> void:
	print(("ok   " if cond else "FAIL ") + what)
	if not cond:
		failures += 1

func _ready() -> void:
	_run.call_deferred()

func _run() -> void:
	Settings.data.introCinematic = false
	Settings.data.display.menuLayout = "mobile"
	Settings.data.audio.master = 0.8
	var app = load("res://scripts/app/app.gd").new()
	add_child(app)
	await get_tree().create_timer(0.5).timeout
	app.show_menu()
	await get_tree().create_timer(0.5).timeout
	var gear: Array = app.ui.find_children("*", "Button", true, false).filter(func(b): return b.tooltip_text == I18n.t("Settings"))
	_ok(gear.size() == 1, "the garage home has its Settings gear")
	if gear.is_empty():
		get_tree().quit(1)
		return
	var bus := AudioServer.get_bus_index("Master")
	var before := AudioServer.get_bus_volume_db(bus)
	# the panel opens on the page last shown: the Audio page
	SettingsPanel._tab = "audio"
	gear[0].pressed.emit()
	await get_tree().process_frame
	var sliders: Array = app.overlay_layer.find_children("*", "HSlider", true, false)
	_ok(not sliders.is_empty(), "the panel shows the Audio page's sliders")
	if sliders.is_empty():
		get_tree().quit(1)
		return
	# the first one is the master volume
	(sliders[0] as HSlider).value = 0.1
	await get_tree().process_frame
	var after := AudioServer.get_bus_volume_db(bus)
	print("master bus: %.1f dB before, %.1f dB after (0.1 is %.1f dB)" % [before, after, linear_to_db(0.01)])
	_ok(absf(Settings.data.audio.master - 0.1) < 1e-6, "the setting took the slider's value")
	_ok(absf(after - linear_to_db(0.01)) < 0.1, "the master bus follows it at once, with the panel still open")
	print("%d failures" % failures)
	get_tree().quit(1 if failures > 0 else 0)
