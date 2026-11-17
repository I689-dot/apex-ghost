class_name HudEditor
extends Control
## The HUD layout editor (the user, 2026-11-16: the HUD customisable by every player): the race HUD over a photo, filled
## with a sample lap, a handle on each block. Drag a block to move it; the wheel over it, or + and −, sizes it; the
## arrows nudge the one picked. Saved as Settings.data.hud.layout (Hud._apply_layout); Cancel puts back what was there.
## Settings › Gameplay › Interface › HUD layout.

signal closed

var hud: Hud
var _handles := {} # block name -> Panel
var _selected := ""
var _drag := ""
var _grab := Vector2.ZERO
var _before: Dictionary
var _picked: Label

const MIN_SCALE := 0.5
const MAX_SCALE := 2.0

func _init() -> void:
	UIKit.full(self)
	theme = UIKit.theme
	set_meta("modal", true)
	_before = (Settings.data.hud.get("layout", {}) as Dictionary).duplicate(true)
	if not Settings.data.hud.has("layout"):
		Settings.data.hud["layout"] = {}
	var photo := UIW.photo_fill("res://assets/ui/photo_straight_spa.webp", 1.0, 0.0)
	add_child(photo)
	hud = Hud.new()
	add_child(hud)
	_sample()
	for k in hud.blocks():
		var h := Panel.new()
		h.mouse_filter = Control.MOUSE_FILTER_STOP
		h.mouse_default_cursor_shape = Control.CURSOR_MOVE
		h.tooltip_text = I18n.t(Hud.BLOCK_NAMES[k])
		var name_l := UIKit.label(I18n.t(Hud.BLOCK_NAMES[k]).to_upper(), 13, Color.WHITE, true, 700)
		name_l.mouse_filter = Control.MOUSE_FILTER_IGNORE
		name_l.position = Vector2(6, -20)
		h.add_child(name_l)
		var kk: String = k
		h.gui_input.connect(func(e): _on_handle(kk, e))
		add_child(h)
		_handles[k] = h
	add_child(_toolbar())
	_select("dial")

## A sample lap on the HUD, so every block shows its real size.
func _sample() -> void:
	hud.dial.update_dial({"speed": 214.0, "unit": "KM/H", "gear": 5, "manual": true, "rpm": 7400.0, "redline": 8500.0, "limiter": false,
		"abs": 1, "tc": 1, "headlights": false, "engine": 0.0, "fuel": {}, "fuelLow": false})
	hud._lap.text = "4/12"
	hud._pos.text = "3/12"
	hud._cur.text = "1:42.318"
	hud._best.text = "2:17.904"
	hud._last.text = "2:18.551"
	hud._delta.text = "-0.214"
	hud._delta.add_theme_color_override("font_color", UIKit.GOOD)

func _toolbar() -> Control:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", UIKit.box(Color(UIKit.NAVY_SOLID, 0.94), Color(1, 1, 1, 0.2), 1, 8, Vector2(20, 14)))
	var col := UIW.vbox(8)
	col.add_child(UIKit.label(I18n.t("HUD layout").to_upper(), 30, UIKit.TEXT, true, 700))
	var help := UIW.muted(I18n.t("Drag a block to move it. The wheel over it, or + and −, makes it bigger or smaller; the arrows nudge it."), 14)
	help.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	help.custom_minimum_size = Vector2(420, 0)
	col.add_child(help)
	_picked = UIKit.label("", 16, UIKit.ACCENT_2, true, 600)
	col.add_child(_picked)
	var r1 := UIW.hbox(8)
	r1.add_child(UIKit.button("−", func(): _resize(_selected, -0.05)))
	r1.add_child(UIKit.button("+", func(): _resize(_selected, 0.05)))
	r1.add_child(UIKit.button(I18n.t("Reset this block"), func(): _reset(_selected)))
	r1.add_child(UIKit.button(I18n.t("Reset all"), func(): _reset("")))
	col.add_child(r1)
	var r2 := UIW.hbox(8)
	r2.alignment = BoxContainer.ALIGNMENT_END
	r2.add_child(UIKit.button(I18n.t("Cancel"), cancel))
	r2.add_child(UIKit.button(I18n.t("Save"), save, true))
	col.add_child(r2)
	p.add_child(col)
	# the middle of the screen: the HUD keeps to the edges
	p.set_anchors_preset(Control.PRESET_CENTER)
	p.resized.connect(func(): p.position = (size - p.size) / 2.0)
	resized.connect(func(): p.position = (size - p.size) / 2.0)
	return p

func _entry(k: String) -> Dictionary:
	var L: Dictionary = Settings.data.hud.layout
	if not L.has(k):
		L[k] = {}
	return L[k]

## A block's rectangle on screen: its own size, or what its children cover (the map and tyre holders are bare Controls).
func block_rect(b: Control) -> Rect2:
	var r := Rect2(b.global_position, Vector2(maxf(b.size.x, b.get_combined_minimum_size().x), maxf(b.size.y, b.get_combined_minimum_size().y)) * b.scale)
	for c in b.get_children():
		if c is Control and (c as Control).visible:
			var cc := c as Control
			var cr := Rect2(cc.global_position, Vector2(maxf(cc.size.x, cc.get_combined_minimum_size().x), maxf(cc.size.y, cc.get_combined_minimum_size().y)) * cc.get_global_transform().get_scale())
			r = r.merge(cr) if r.size.x > 0.0 and r.size.y > 0.0 else cr
	return r

func _process(_dt: float) -> void:
	var all := hud.blocks()
	for k in _handles:
		var b: Control = all[k]
		var h: Panel = _handles[k]
		h.visible = b.visible
		var r := block_rect(b).grow(4.0)
		h.position = r.position - global_position
		h.size = r.size
		# the block's name above its frame, or inside it at the top of the screen
		(h.get_child(0) as Label).position = Vector2(6, -20 if h.position.y > 22.0 else 4)
		var on: bool = k == _selected
		h.add_theme_stylebox_override("panel", UIKit.box(Color(1, 1, 1, 0.1 if on else 0.04), UIKit.ACCENT_2 if on else Color(1, 1, 1, 0.55), 2 if on else 1, 4))

func _select(k: String) -> void:
	_selected = k
	var e: Dictionary = Settings.data.hud.layout.get(k, {})
	_picked.text = "%s · %d %%" % [I18n.t(Hud.BLOCK_NAMES.get(k, "")).to_upper(), roundi(float(e.get("scale", 1.0)) * 100.0)] if k != "" else ""

func _on_handle(k: String, e: InputEvent) -> void:
	if e is InputEventMouseButton:
		var mb := e as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_LEFT:
			if mb.pressed:
				_select(k)
				_drag = k
				_grab = get_global_mouse_position() - block_rect(hud.blocks()[k]).position
			else:
				_drag = ""
			accept_event()
		elif mb.pressed and (mb.button_index == MOUSE_BUTTON_WHEEL_UP or mb.button_index == MOUSE_BUTTON_WHEEL_DOWN):
			_select(k)
			_resize(k, 0.05 if mb.button_index == MOUSE_BUTTON_WHEEL_UP else -0.05)
			accept_event()
	elif e is InputEventMouseMotion and _drag == k:
		_move_to(k, get_global_mouse_position() - _grab)
		accept_event()

## Puts the block's top-left corner at p (screen pixels): kept as a share of the screen.
func _move_to(k: String, p: Vector2) -> void:
	var b: Control = hud.blocks()[k]
	# the handle's rectangle can start left of or above the block's own corner (its children): move by the difference
	var off := block_rect(b).position - b.global_position
	var e := _entry(k)
	e.x = clampf((p.x - off.x - hud.global_position.x) / maxf(1.0, hud.size.x), 0.0, 1.0)
	e.y = clampf((p.y - off.y - hud.global_position.y) / maxf(1.0, hud.size.y), 0.0, 1.0)
	hud._layout()

func _resize(k: String, d: float) -> void:
	if k == "":
		return
	var b: Control = hud.blocks()[k]
	var e := _entry(k)
	# keep its place: the corner where it is now
	if not e.has("x"):
		e.x = (b.global_position.x - hud.global_position.x) / maxf(1.0, hud.size.x)
		e.y = (b.global_position.y - hud.global_position.y) / maxf(1.0, hud.size.y)
	e.scale = clampf(float(e.get("scale", 1.0)) + d, MIN_SCALE, MAX_SCALE)
	hud._layout()
	_select(k)

func _reset(k: String) -> void:
	if k == "":
		Settings.data.hud.layout = {}
	else:
		Settings.data.hud.layout.erase(k)
	hud._layout()
	_select(_selected)

func _unhandled_key_input(e: InputEvent) -> void:
	var k := e as InputEventKey
	if k == null or not k.pressed:
		return
	match k.keycode:
		KEY_EQUAL, KEY_PLUS, KEY_KP_ADD:
			_resize(_selected, 0.05)
		KEY_MINUS, KEY_KP_SUBTRACT:
			_resize(_selected, -0.05)
		KEY_LEFT, KEY_RIGHT, KEY_UP, KEY_DOWN:
			if _selected != "":
				var step := Vector2(-4, 0) if k.keycode == KEY_LEFT else Vector2(4, 0) if k.keycode == KEY_RIGHT else Vector2(0, -4) if k.keycode == KEY_UP else Vector2(0, 4)
				_move_to(_selected, block_rect(hud.blocks()[_selected]).position + step)
		KEY_ESCAPE:
			cancel()
		_:
			return
	get_viewport().set_input_as_handled()

func save() -> void:
	# a block left where it was and at its size is no override
	var L: Dictionary = Settings.data.hud.layout
	for k in L.keys():
		if (L[k] as Dictionary).is_empty():
			L.erase(k)
	Settings.save()
	closed.emit()
	queue_free()

func cancel() -> void:
	Settings.data.hud.layout = _before
	closed.emit()
	queue_free()
