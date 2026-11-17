extends Node
## The HUD layout editor (HudEditor) and a saved layout in the HUD (Hud._apply_layout): a block moved and sized in the
## editor is where it was put in a new HUD, stays on screen in a smaller window, and Cancel restores the layout.
## SHOT=<file.png> saves the editor.
##   godot --path godot res://tests/runner.tscn --resolution 1600x900 -- res://tests/hud_layout_test.gd

var failures := 0

func _ok(cond: bool, what: String) -> void:
	print(("ok   " if cond else "FAIL ") + what)
	if not cond:
		failures += 1

func _ready() -> void:
	_run.call_deferred()

func _frames(n: int = 3) -> void:
	for i in n:
		await get_tree().process_frame

func _run() -> void:
	var keep: Dictionary = (Settings.data.hud.get("layout", {}) as Dictionary).duplicate(true)
	Settings.data.hud.layout = {}
	var ed := HudEditor.new()
	add_child(ed)
	await _frames()
	var dial: Control = ed.hud.blocks().dial
	var was := dial.position
	# the dial to the top left, a size larger
	ed._select("dial")
	ed._move_to("dial", ed.global_position + Vector2(40, 40) + (ed.block_rect(dial).position - dial.global_position))
	ed._resize("dial", 0.2)
	await _frames()
	var L: Dictionary = Settings.data.hud.layout
	_ok(L.has("dial") and absf(float(L.dial.scale) - 1.2) < 0.001, "the dial's size kept (%s)" % str(L.get("dial")))
	_ok(dial.position.distance_to(Vector2(40, 40)) < 2.0 and dial.position.distance_to(was) > 200.0, "the dial moved to the top left (%s, was %s)" % [dial.position, was])
	ed._select("map")
	ed._resize("map", 0.3)
	if OS.get_environment("SHOT") != "":
		await get_tree().create_timer(0.5).timeout
		get_viewport().get_texture().get_image().save_png(OS.get_environment("SHOT"))
	ed.save()
	await _frames()
	# a new HUD (the next race) takes the layout
	var hud := Hud.new()
	add_child(hud)
	await _frames()
	var d2: Control = hud.blocks().dial
	_ok(d2.position.distance_to(Vector2(40, 40)) < 2.0, "a new HUD puts the dial where it was saved (%s)" % d2.position)
	_ok(absf(d2.scale.x / hud.hud_scale() - 1.2) < 0.01, "and at its size (%.2f)" % (d2.scale.x / hud.hud_scale()))
	# a narrow window: every block stays on the screen
	hud.size = Vector2(800, 450)
	hud._layout()
	await _frames()
	var inside := true
	for k in hud.blocks():
		var b: Control = hud.blocks()[k]
		if not b.visible:
			continue
		if b.position.x < -0.5 or b.position.y < -0.5 or b.position.x > 800.0 or b.position.y > 450.0:
			inside = false
			print("  off screen: ", k, " ", b.position)
	_ok(inside, "in a smaller window every block's corner stays on the screen")
	hud.queue_free()
	# Cancel restores the layout from before
	var before: Dictionary = (Settings.data.hud.layout as Dictionary).duplicate(true)
	var ed2 := HudEditor.new()
	add_child(ed2)
	await _frames()
	ed2._reset("")
	_ok((Settings.data.hud.layout as Dictionary).is_empty(), "Reset all clears the layout")
	ed2.cancel()
	_ok(Settings.data.hud.layout == before, "Cancel puts the layout back")
	Settings.data.hud.layout = keep
	print("%d failures" % failures)
	get_tree().quit(1 if failures > 0 else 0)
