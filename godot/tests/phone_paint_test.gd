extends Node
## The phone layout's Paint button (the garage home's bottom bar) opens the lobby on its Paint page, the livery editor,
## in a solo room. In memory only (the runner sets Settings.testing: nothing is saved).
##   tools/godot/gd.sh tests/phone_paint_test.gd

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
	var app = load("res://scripts/app/app.gd").new()
	add_child(app)
	await get_tree().create_timer(0.5).timeout
	app.show_menu()
	await get_tree().create_timer(0.5).timeout
	await MobileHome.paint(app)
	await get_tree().create_timer(0.5).timeout
	var labels: Array = app.ui.find_children("*", "Label", true, false).map(func(l): return (l as Label).text.to_lower())
	print("lobby page: %s" % LobbyScreen._page)
	_ok(LobbyScreen._page == "paint", "the lobby opens on its Paint page")
	_ok(labels.has(I18n.t("Race number").to_lower()), "the livery editor is on screen (its Race number section)")
	print("%d failures" % failures)
	get_tree().quit(1 if failures > 0 else 0)
