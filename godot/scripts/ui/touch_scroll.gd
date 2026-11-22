class_name TouchScroll
extends Node
## Lists that scroll under a finger, as a phone's do (the user, 2026-11-22: "you cant scroll with the phone, and
## clicking things is weird"). Godot gives a press to the deepest control under it: on a card, a row or a button the
## drag never reached the ScrollContainer below, and nearly every list here is made of cards. So, on a touch screen:
##  - a finger that moves past DRAG_START scrolls the nearest ScrollContainer above the control it started on that
##    can scroll that way (a card strip sideways, the page up and down), and the press on that control is cancelled,
##    so lifting the finger does not tap it;
##  - a drag let go flings on (FRICTION), as a phone's lists do; a touch stops it;
##  - a tap leaves no hover behind (the pointer a touch moves stays where the finger left it: a card stayed lit);
##  - the scroll bars are hidden (the lists still scroll; a bar is a mouse's handle).
## App adds one when UIKit.touch(). Nothing here runs per frame unless a list is flinging.

## How far a finger moves before it scrolls instead of tapping (viewport units, about 2 mm on a phone).
const DRAG_START := 14.0
## How fast a fling slows: its speed is multiplied by this every second.
const FRICTION := 0.03
## Below this a fling stops (viewport units a second).
const MIN_SPEED := 30.0

var _down := false
var _start := Vector2.ZERO
var _last := Vector2.ZERO
var _sc: ScrollContainer = null
var _vertical := true
var _dragging := false
## The drag's speed (viewport units a second, smoothed), and what is left of it once let go.
var _speed := 0.0
var _last_t := 0.0
var _fling: ScrollContainer = null
## The scroll position as a float (a step under a pixel adds up instead of rounding away).
var _pos := 0.0

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	set_process(false)
	get_tree().node_added.connect(_on_node_added)
	for n: Node in get_tree().root.find_children("*", "ScrollContainer", true, false):
		_on_node_added(n)

func _on_node_added(n: Node) -> void:
	if n is ScrollContainer:
		var s := n as ScrollContainer
		if s.horizontal_scroll_mode == ScrollContainer.SCROLL_MODE_AUTO:
			s.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_SHOW_NEVER
		if s.vertical_scroll_mode == ScrollContainer.SCROLL_MODE_AUTO:
			s.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_SHOW_NEVER

func _input(e: InputEvent) -> void:
	if e is InputEventScreenTouch:
		var t := e as InputEventScreenTouch
		if t.index != 0:
			return
		if t.pressed:
			_fling = null
			set_process(false)
			_down = true
			_dragging = false
			_sc = null
			_start = t.position
			_last = t.position
			_speed = 0.0
			_last_t = Time.get_ticks_msec() / 1000.0
		else:
			_down = false
			if _dragging:
				_dragging = false
				get_viewport().set_input_as_handled()
				if absf(_speed) > MIN_SPEED and is_instance_valid(_sc):
					_fling = _sc
					set_process(true)
			else:
				_clear_hover.call_deferred()
	elif e is InputEventScreenDrag:
		var d := e as InputEventScreenDrag
		if d.index != 0 or not _down:
			return
		if not _dragging:
			var moved := d.position - _start
			if moved.length() < DRAG_START:
				return
			_vertical = absf(moved.y) >= absf(moved.x)
			_sc = _scroller_under(_vertical)
			if _sc == null:
				# nothing here scrolls that way: the drag is the control's (a slider, the HUD editor)
				_down = false
				return
			_dragging = true
			_pos = _scroll_of(_sc)
			_cancel_press.call_deferred()
			_last = d.position
		var now := Time.get_ticks_msec() / 1000.0
		var step := _local_delta(d.position - _last)
		_last = d.position
		var along := step.y if _vertical else step.x
		_move(_sc, -along)
		var dt := maxf(now - _last_t, 0.001)
		_speed = lerpf(_speed, -along / dt, 0.4)
		_last_t = now
		get_viewport().set_input_as_handled()
	elif _dragging and (e is InputEventMouseMotion or e is InputEventMouseButton):
		# the pointer the touch moves: not to the controls while the list is dragged
		get_viewport().set_input_as_handled()

func _process(dt: float) -> void:
	if _fling == null or not is_instance_valid(_fling) or not _fling.is_visible_in_tree():
		_fling = null
		set_process(false)
		return
	var ended := _move(_fling, _speed * dt)
	_speed *= pow(FRICTION, dt)
	# stopped by its end, or slow enough
	if ended or absf(_speed) < MIN_SPEED:
		_fling = null
		set_process(false)

## The nearest ScrollContainer above the control under the finger that can scroll this way (content longer than it).
func _scroller_under(vertical: bool) -> ScrollContainer:
	var n: Node = get_viewport().gui_get_hovered_control()
	while n != null:
		if n is ScrollContainer:
			var s := n as ScrollContainer
			var bar: ScrollBar = s.get_v_scroll_bar() if vertical else s.get_h_scroll_bar()
			var mode := s.vertical_scroll_mode if vertical else s.horizontal_scroll_mode
			if mode != ScrollContainer.SCROLL_MODE_DISABLED and bar != null and bar.max_value - bar.page > 1.0:
				return s
		n = n.get_parent()
	return null

## The press the finger began on, let go off-screen: the control under it releases without being pressed.
func _cancel_press() -> void:
	var up := InputEventMouseButton.new()
	up.button_index = MOUSE_BUTTON_LEFT
	up.pressed = false
	up.position = Vector2(-10000, -10000)
	up.global_position = up.position
	get_viewport().push_input(up)
	_clear_hover.call_deferred()

## The pointer moved off-screen: no control stays hovered after the finger left it.
func _clear_hover() -> void:
	var m := InputEventMouseMotion.new()
	m.position = Vector2(-10000, -10000)
	m.global_position = m.position
	get_viewport().push_input(m)

## A finger's movement in the scroller's own units (the menus are scaled on a phone).
func _local_delta(screen_delta: Vector2) -> Vector2:
	if _sc == null or not is_instance_valid(_sc):
		return screen_delta
	return _sc.get_global_transform_with_canvas().affine_inverse().basis_xform(screen_delta)

func _scroll_of(s: ScrollContainer) -> float:
	return float(s.scroll_vertical if _vertical else s.scroll_horizontal)

## Moves the list; true when it is held at an end.
func _move(s: ScrollContainer, amount: float) -> bool:
	_pos += amount
	if _vertical:
		s.scroll_vertical = roundi(_pos)
	else:
		s.scroll_horizontal = roundi(_pos)
	var held := absf(_scroll_of(s) - _pos) > 1.0
	if held:
		_pos = _scroll_of(s)
	return held
