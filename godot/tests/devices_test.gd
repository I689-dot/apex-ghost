extends Node
## Wheels, pedals and shifters (DeviceBindings, DeviceSetup) with simulated devices: a wheel base, a separate pedal
## set whose axes rest at +1, an H-pattern shifter. Bound functions drive InputState.rig; the setup page learns an
## axis's ends and the steering's direction.
##   tools/godot/gd.sh tests/devices_test.gd

var failures := 0

func check(cond: bool, what: String) -> void:
	print(("ok   " if cond else "FAIL ") + what)
	if not cond:
		failures += 1

func _axis(d: int, a: int, v: float) -> void:
	DeviceBindings.fake.axes["%d/%d" % [d, a]] = v

func _button(d: int, b: int, down: bool) -> void:
	DeviceBindings.fake.buttons["%d/%d" % [d, b]] = down

func _ready() -> void:
	_run.call_deferred()

func _frames(n: int = 2) -> void:
	for i in n:
		await get_tree().process_frame

func _run() -> void:
	DeviceBindings.fake = {"ids": [10, 11, 12], "names": {10: "Fake Wheel Base", 11: "Fake Pedals", 12: "Fake H Shifter"}, "axes": {}, "buttons": {}}
	var db := DeviceBindings.new()
	add_child(db)
	var bs := DeviceBindings.bindings()
	bs.clear()
	bs["steer"] = {"dev": PadMap.pad_key("Fake Wheel Base"), "nth": 0, "kind": "axis", "index": 0, "min": -1.0, "max": 1.0, "deadzone": 0.02}
	# pedals at rest +1, pressed -1 (as many load-cell sets report)
	bs["throttle"] = {"dev": PadMap.pad_key("Fake Pedals"), "nth": 0, "kind": "axis", "index": 1, "min": 1.0, "max": -1.0, "deadzone": 0.02}
	bs["brake"] = {"dev": PadMap.pad_key("Fake Pedals"), "nth": 0, "kind": "axis", "index": 2, "min": 1.0, "max": -1.0, "deadzone": 0.02}
	bs["gear3"] = {"dev": PadMap.pad_key("Fake H Shifter"), "nth": 0, "kind": "button", "index": 2}
	bs["gearR"] = {"dev": PadMap.pad_key("Fake H Shifter"), "nth": 0, "kind": "button", "index": 6}
	bs["shiftUp"] = {"dev": PadMap.pad_key("Fake Wheel Base"), "nth": 0, "kind": "button", "index": 4}
	_axis(10, 0, 0.0)
	_axis(11, 1, 1.0)
	_axis(11, 2, 1.0)
	await _frames()
	var rig: Dictionary = InputState.rig
	check(rig.active, "bound devices drive the car")
	check(absf(rig.steer) < 0.01 and rig.throttle < 0.01 and rig.brake < 0.01, "at rest: straight, no pedals (%.2f %.2f %.2f)" % [rig.steer, rig.throttle, rig.brake])
	_axis(10, 0, -0.5)
	_axis(11, 1, -1.0)
	_axis(11, 2, 0.0)
	await _frames()
	check(absf(rig.steer - 0.5) < 0.02, "wheel half left: steer +0.5 (%.2f)" % rig.steer)
	check(rig.throttle > 0.98, "throttle pressed fully, its axis turned round (%.2f)" % rig.throttle)
	check(absf(rig.brake - 0.5) < 0.03, "brake half way (%.2f)" % rig.brake)
	check(rig.gear == 0, "the shifter in neutral (%d)" % rig.gear)
	_button(12, 2, true)
	await _frames()
	check(rig.gear == 3, "the shifter in 3rd (%d)" % rig.gear)
	_button(12, 2, false)
	_button(12, 6, true)
	await _frames()
	check(rig.gear == -1, "the shifter in reverse (%d)" % rig.gear)
	_button(12, 6, false)
	# a paddle taps the game's shift-up key
	var got := [false]
	var watch := func(e: InputEvent) -> void:
		if e is InputEventKey and e.pressed and e.physical_keycode == KeyMap.key_of(Settings.data.bindings.shiftUp[0]):
			got[0] = true
	get_viewport().window_input.connect(watch)
	_button(10, 4, true)
	await _frames()
	_button(10, 4, false)
	await _frames()
	check(got[0], "the shift-up paddle presses the game's shift-up")
	# the setup page learns a pedal: pressed fully and let go
	var setup := DeviceSetup.new(func(): pass)
	add_child(setup)
	_axis(11, 3, 1.0)
	await _frames()
	setup._start("clutch", "axis")
	for v in [0.6, 0.0, -0.7, -1.0, -1.0, 0.2, 1.0]:
		_axis(11, 3, v)
		await _frames(3)
	await get_tree().create_timer(1.3).timeout
	var c: Dictionary = bs.get("clutch", {})
	check(c.get("index") == 3 and c.get("dev") == PadMap.pad_key("Fake Pedals"), "the clutch learnt on the pedals' axis 3 (%s)" % str(c))
	check(absf(float(c.get("min", 0)) - 1.0) < 0.01 and absf(float(c.get("max", 0)) + 1.0) < 0.01, "its ends: rest +1, pressed -1")
	# the steering learnt from a wheel turned left first: left is +1 on this base
	_axis(10, 5, 0.0)
	await _frames()
	setup._start("steer", "steer")
	for v in [0.3, 0.8, 1.0, 0.4, -0.5, -1.0, -0.3, 0.0]:
		_axis(10, 5, v)
		await _frames(3)
	await get_tree().create_timer(1.3).timeout
	var st: Dictionary = bs.get("steer", {})
	check(st.get("index") == 5, "the steering learnt on the wheel's axis 5")
	_axis(10, 5, 1.0)
	await _frames()
	check(DeviceBindings.steer_value(st) > 0.95, "turned the way it went first (left): steer +1 (%.2f)" % DeviceBindings.steer_value(st))
	# a device unplugged: nothing drives from it
	DeviceBindings.fake.ids = [12]
	await _frames()
	check(not rig.active, "unplugged: the bindings stop driving")
	print("%d failures" % failures)
	get_tree().quit(1 if failures > 0 else 0)
