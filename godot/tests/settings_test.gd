extends Node
## Settings pages and presets: every page builds without errors (in both languages), the detail groups this app adds
## (mirrors, cockpit, car detail) take their values from the preset they name, "Custom" is seen, old settings files get
## the new defaults, and the GPU detection ranks current cards.
##   tools/godot/gd.sh tests/settings_test.gd

var failures := 0

func _ok(cond: bool, what: String) -> void:
	print(("ok   " if cond else "FAIL ") + what)
	if not cond:
		failures += 1

func _ready() -> void:
	var saved: Dictionary = Settings.data.duplicate(true)
	Settings.data = Settings.default_settings()
	var S: Dictionary = Settings.data
	var changed := func(): pass
	var show := func(_k): pass
	for lang in ["en"]:
		for page in ["graphics", "display", "view", "driving", "interface", "audio"]:
			var col := VBoxContainer.new()
			add_child(col)
			match page:
				"graphics":
					SettingsPanel._graphics(col, changed, show)
				"display":
					SettingsPanel._display(col, changed)
				"view":
					SettingsPanel._view(col, changed)
				"driving":
					SettingsPanel._driving(col, changed)
				"interface":
					SettingsPanel._interface(col, changed)
				"audio":
					SettingsPanel._sound(col, changed)
			_ok(col.get_child_count() > 3, "%s page builds (%s): %d rows" % [page, lang, col.get_child_count()])
			col.queue_free()
	# presets and the extra groups
	S.quality = "ultra"
	S.graphics = {}
	_ok(not Settings.is_custom(), "a plain preset is not custom")
	var q := Settings.quality_config()
	_ok(int(q.mirrorEvery) == int(Settings.presets().ultra.mirrorEvery), "ultra mirrors from the ultra preset")
	S.graphics = {"mirrors": "low", "cockpit": "low", "carDetail": "low"}
	q = Settings.quality_config()
	_ok(Settings.is_custom(), "overrides make it custom")
	_ok(int(q.mirrorEvery) == int(Settings.presets().low.mirrorEvery), "mirror updates from the low preset (%d)" % int(q.mirrorEvery))
	_ok(bool(q.cockpitDetail) == bool(Settings.presets().low.cockpitDetail), "cockpit detail from the low preset")
	_ok(is_equal_approx(float(q.carLodScale), float(Settings.presets().low.carLodScale)), "car detail from the low preset")
	_ok(int(q.shadowMapSize) == int(Settings.presets().ultra.shadowMapSize), "the rest stays ultra")
	# an old settings file (no display / screen sections) gets the defaults
	var old := {"quality": "high", "fov": 60}
	var merged := Settings.merge_deep(Settings.default_settings(), old)
	_ok(merged.display.upscaler == "bilinear" and int(merged.display.maxFps) == 0 and merged.screen.has("widthCm"), "old settings get the display defaults")
	# Graphics.upscalers: FSR 2 only on Forward+
	var ups: Array = Graphics.upscalers().map(func(o): return o[0])
	_ok(ups.has("bilinear") and ups.has("fsr") and (ups.has("fsr2") == (RenderingServer.get_current_rendering_method() == "forward_plus")), "upscalers %s on %s" % [ups, RenderingServer.get_current_rendering_method()])
	# detection patterns (the adapter name is read from the GPU; the patterns are what matters)
	var re := RegEx.create_from_string("rtx\\s*(30[6-9]|40|50)|rx\\s*(6[7-9]|7[6-9]|9)\\d\\d|apple m[2-4] (pro|max)")
	_ok(re.search("amd radeon rx 7600 xt (radv navi33)") != null, "RX 7600 XT ranks ultra")
	_ok(re.search("intel(r) uhd graphics 630") == null, "UHD 630 does not")
	Settings.data = saved
	print("%d failures" % failures)
	get_tree().quit(1 if failures else 0)
