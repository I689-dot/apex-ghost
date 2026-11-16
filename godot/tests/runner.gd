extends Node
## Runs a test node: godot --headless --path godot res://tests/runner.tscn -- res://tests/xyz.gd [more args]
## The test script is an `extends Node` script; it runs when added (in _ready) and calls get_tree().quit() itself.
func _ready() -> void:
	# a test never changes the player's own settings
	Settings.testing = true
	# a rendered test opens on the monitor asked for (APEX_SCREEN, e.g. 1 for the second one)
	if DisplayServer.get_name() != "headless":
		Settings.place_window.call_deferred()
	var args := OS.get_cmdline_user_args()
	var script: GDScript = load(args[0])
	var n: Node = script.new()
	add_child(n)
