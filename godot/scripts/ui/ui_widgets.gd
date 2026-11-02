class_name UIW
extends RefCounted
## Small builders for the menu screens (the web game's dom.ts helpers): boxes, chip rows, toggles, cards, modals.

static func vbox(sep: int = 8) -> VBoxContainer:
	var b := VBoxContainer.new()
	b.add_theme_constant_override("separation", sep)
	return b

static func hbox(sep: int = 8) -> HBoxContainer:
	var b := HBoxContainer.new()
	b.add_theme_constant_override("separation", sep)
	return b

static func spacer(expand: bool = true) -> Control:
	var c := Control.new()
	if expand:
		c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		c.size_flags_vertical = Control.SIZE_EXPAND_FILL
	return c

## A bordered panel holding `child`.
static func panel(child: Control = null, solid: bool = false) -> PanelContainer:
	var p := PanelContainer.new()
	if solid:
		p.add_theme_stylebox_override("panel", UIKit.box(UIKit.PANEL_SOLID, UIKit.LINE, 1, UIKit.RADIUS, Vector2(16, 14)))
	if child != null:
		p.add_child(child)
	return p

static func margin(child: Control, m: int = 16) -> MarginContainer:
	var c := MarginContainer.new()
	for s in ["left", "top", "right", "bottom"]:
		c.add_theme_constant_override("margin_" + s, m)
	c.add_child(child)
	return c

static func scroll(child: Control) -> ScrollContainer:
	var s := ScrollContainer.new()
	s.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	s.size_flags_vertical = Control.SIZE_EXPAND_FILL
	child.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	s.add_child(child)
	return s

static func h2(text: String) -> Label:
	return UIKit.label(text, 30, UIKit.TEXT, true, 700)

static func h3(text: String) -> Label:
	return UIKit.label(text.to_upper(), 15, UIKit.MUTED, true, 700)

static func muted(text: String, size: int = 15) -> Label:
	var l := UIKit.label(text, size, UIKit.MUTED)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return l

static func logo(size: int = 34) -> Control:
	var h := UIW.hbox(6)
	h.add_child(UIKit.label("APEX", size, UIKit.TEXT, true, 700))
	h.add_child(UIKit.label("GHOST", size, UIKit.ACCENT, true, 700))
	return h

## A row of exclusive choices: options [[value, label], ...]; on(value) when one is picked. `enabled` false greys them.
static func chips(current: Variant, options: Array, on: Callable, enabled: bool = true) -> Control:
	var flow := HFlowContainer.new()
	flow.add_theme_constant_override("h_separation", 6)
	flow.add_theme_constant_override("v_separation", 6)
	for o in options:
		var b := Button.new()
		b.text = String(o[1])
		b.toggle_mode = true
		b.focus_mode = Control.FOCUS_NONE
		b.button_pressed = o[0] == current
		b.disabled = not enabled and o[0] != current
		if b.button_pressed:
			for st in ["normal", "hover", "pressed", "disabled"]:
				b.add_theme_stylebox_override(st, UIKit.box(UIKit.ACCENT, UIKit.ACCENT, 1, UIKit.RADIUS, UIKit.btn_pad()))
		var val = o[0]
		b.pressed.connect(func(): if enabled: on.call(val))
		flow.add_child(b)
	return flow

## A labelled on/off row with a help line.
static func toggle(label: String, help: String, value: bool, on: Variant) -> Control:
	var row := UIW.hbox(12)
	var col := UIW.vbox(2)
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	col.add_child(UIKit.label(label, 18, UIKit.TEXT, false, 600))
	if help != "":
		col.add_child(UIW.muted(help, 14))
	row.add_child(col)
	var cb := CheckButton.new()
	cb.button_pressed = value
	cb.focus_mode = Control.FOCUS_NONE
	cb.disabled = on == null
	if on != null:
		cb.toggled.connect(on)
	row.add_child(cb)
	return row

## A labelled setting: title over the control.
static func field(label: String, control: Control) -> Control:
	var c := UIW.vbox(4)
	c.add_child(UIW.h3(label))
	c.add_child(control)
	return c

## A drop-down of [[value, label], ...].
static func select(current: Variant, options: Array, on: Callable) -> OptionButton:
	var o := OptionButton.new()
	o.focus_mode = Control.FOCUS_NONE
	for i in options.size():
		o.add_item(String(options[i][1]), i)
		if options[i][0] == current:
			o.select(i)
	o.item_selected.connect(func(i): on.call(options[i][0]))
	return o

static func slider(value: float, lo: float, hi: float, step: float, on: Callable) -> HSlider:
	var s := HSlider.new()
	s.min_value = lo
	s.max_value = hi
	s.step = step
	s.value = value
	s.custom_minimum_size = Vector2(220, 28)
	s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	s.value_changed.connect(on)
	return s

## A texture from a res:// path ("" when missing).
static func tex(path: String) -> Texture2D:
	var p := Assets.path(path) if not path.begins_with("res://") else path
	return load(p) if ResourceLoader.exists(p) else null

static func image(path: String, size: Vector2 = Vector2.ZERO, expand: bool = false) -> TextureRect:
	var r := TextureRect.new()
	r.texture = tex(path)
	r.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	r.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED if expand else TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	r.custom_minimum_size = size
	return r

## A modal card over a dimmed screen. Returns {root, body}: add content to body; free root to close.
static func modal(parent: Node, min_width: int = 460, full_height: bool = false) -> Dictionary:
	var root := Control.new()
	UIKit.full(root)
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.62)
	UIKit.full(dim)
	root.add_child(dim)
	var center := CenterContainer.new()
	UIKit.full(center)
	root.add_child(center)
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", UIKit.box(UIKit.PANEL_SOLID, UIKit.LINE, 1, UIKit.RADIUS, Vector2(22, 20)))
	card.custom_minimum_size = Vector2(min_width, 0)
	if full_height:
		card.custom_minimum_size.y = maxf(0.0, parent.get_viewport().get_visible_rect().size.y - 36.0)
	center.add_child(card)
	var body := UIW.vbox(10)
	card.add_child(body)
	parent.add_child(root)
	return {"root": root, "body": body}
