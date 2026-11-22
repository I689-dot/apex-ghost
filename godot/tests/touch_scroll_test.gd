extends Node
## TouchScroll (the phone's lists, 2026-11-22): touch events on a list of buttons. A tap presses its button and does
## not scroll; a drag that starts on a button scrolls the list and presses nothing; a flick goes on after the finger
## lifts; a finger that moves less than DRAG_START is still a tap.
##   APEX_TOUCH=1 tools/godot/gd.sh tests/touch_scroll_test.gd

var failures := 0
var presses := {}

func check(cond: bool, what: String) -> void:
	print(("ok   " if cond else "FAIL ") + what)
	if not cond:
		failures += 1

func _ready() -> void:
	_run.call_deferred()

func _frames(n: int = 2) -> void:
	for i in n:
		await get_tree().process_frame

## A point in the viewport, where the window has it (parse_input_event takes window coordinates; the headless window
## is not the viewport's size).
func _w(p: Vector2) -> Vector2:
	return get_viewport().get_final_transform() * p

func _touch(pos: Vector2, pressed: bool) -> void:
	var t := InputEventScreenTouch.new()
	t.index = 0
	t.position = _w(pos)
	t.pressed = pressed
	Input.parse_input_event(t)
	await _frames(1)

func _drag(from: Vector2, to: Vector2, steps: int, frames_per_step: int = 1) -> void:
	var last := from
	for i in range(1, steps + 1):
		var p := from.lerp(to, float(i) / steps)
		var d := InputEventScreenDrag.new()
		d.index = 0
		d.position = _w(p)
		d.relative = get_viewport().get_final_transform().basis_xform(p - last)
		last = p
		Input.parse_input_event(d)
		await _frames(frames_per_step)

func _run() -> void:
	Input.emulate_mouse_from_touch = true
	add_child(TouchScroll.new())
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 0)
	for i in 30:
		var b := Button.new()
		b.text = "row %d" % i
		b.custom_minimum_size = Vector2(380, 60)
		var k := i
		b.pressed.connect(func() -> void: presses[k] = int(presses.get(k, 0)) + 1)
		col.add_child(b)
	var sc := UIW.scroll(col)
	sc.position = Vector2(20, 20)
	sc.size = Vector2(400, 300)
	add_child(sc)
	await _frames(4)
	check(sc.vertical_scroll_mode == ScrollContainer.SCROLL_MODE_SHOW_NEVER, "the list's scroll bar is hidden on a touch screen")
	# a tap on row 1 (y 20 + 60 + 30)
	await _touch(Vector2(200, 110), true)
	await _touch(Vector2(200, 110), false)
	await _frames(3)
	check(presses.get(1, 0) == 1 and sc.scroll_vertical == 0, "a tap presses its button and does not scroll (%s, scroll %d)" % [presses, sc.scroll_vertical])
	presses.clear()
	# a slow drag up from row 3: the list follows the finger, no button pressed
	await _touch(Vector2(200, 230), true)
	await _drag(Vector2(200, 230), Vector2(200, 50), 18, 2)
	await _frames(4)
	var dragged := sc.scroll_vertical
	await _touch(Vector2(200, 50), false)
	await _frames(3)
	check(dragged > 140, "a drag that starts on a button scrolls the list (%d)" % dragged)
	check(presses.is_empty(), "the drag pressed no button (%s)" % presses)
	# a quick flick: the list goes on after the finger lifts
	await _touch(Vector2(200, 260), true)
	await _drag(Vector2(200, 260), Vector2(200, 120), 4, 1)
	await _touch(Vector2(200, 120), false)
	var at_release := sc.scroll_vertical
	await _frames(20)
	check(sc.scroll_vertical > at_release + 20, "a flick goes on after the finger lifts (%d -> %d)" % [at_release, sc.scroll_vertical])
	check(presses.is_empty(), "the flick pressed no button (%s)" % presses)
	# a finger that moves a little (under DRAG_START) still taps, once the fling has stopped
	var still := -1
	while still != sc.scroll_vertical:
		still = sc.scroll_vertical
		await _frames(10)
	var before := sc.scroll_vertical
	# (the middle of a row in view: the wobble stays on it)
	var row := int((90.0 + before) / 60.0)
	var y := 20.0 + (row + 0.5) * 60.0 - before
	await _touch(Vector2(200, y), true)
	await _drag(Vector2(200, y), Vector2(204, y + 6.0), 3, 1)
	await _touch(Vector2(204, y + 6.0), false)
	await _frames(3)
	check(presses.get(row, 0) == 1 and sc.scroll_vertical == before, "a small wobble is still a tap on row %d (%s, scroll %d -> %d)" % [row, presses, before, sc.scroll_vertical])
	print("%d failures" % failures)
	get_tree().quit(1 if failures > 0 else 0)
