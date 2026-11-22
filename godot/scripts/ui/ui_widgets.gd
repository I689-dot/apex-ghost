class_name UIW
extends RefCounted
## Small builders for the menu screens (the web game's dom.ts helpers): boxes, chip rows, toggles, cards, modals, and the
## menu shell after Le Mans Ultimate's (DECISIONS.md "Godot: menu redesign"): a top bar with the section and its tabs,
## big dim section headings over hairline rows, ‹ value › steppers, pill switches, photo cards with a hatched corner,
## and a bottom bar with the screen's actions. Everything a player can press is focusable for the pad and the keyboard.

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
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if expand:
		c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		c.size_flags_vertical = Control.SIZE_EXPAND_FILL
	return c

## A bordered panel holding `child` (navy glass; `solid` is opaque, for panels over busy pictures).
static func panel(child: Control = null, solid: bool = false) -> PanelContainer:
	var p := PanelContainer.new()
	if solid:
		p.add_theme_stylebox_override("panel", UIKit.box(Color(UIKit.NAVY_SOLID, 0.94), UIKit.HAIR, 1, 8, Vector2(16, 14)))
	if child != null:
		p.add_child(child)
	return p

## Margins per side (left, top, right, bottom).
static func margins(child: Control, l: int, t: int, r: int, b: int) -> MarginContainer:
	var c := MarginContainer.new()
	c.add_theme_constant_override("margin_left", l)
	c.add_theme_constant_override("margin_top", t)
	c.add_theme_constant_override("margin_right", r)
	c.add_theme_constant_override("margin_bottom", b)
	c.add_child(child)
	return c

## A vertical scroller that follows the pad's focus (a focused row is scrolled into view).
static func scroll(child: Control) -> ScrollContainer:
	var s := ScrollContainer.new()
	s.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	s.size_flags_vertical = Control.SIZE_EXPAND_FILL
	s.follow_focus = true
	child.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	s.add_child(child)
	return s

## A horizontal strip (the circuit and car carousels).
static func hscroll(child: Control) -> ScrollContainer:
	var s := ScrollContainer.new()
	s.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	s.follow_focus = true
	s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	s.add_child(child)
	return s

static func h2(text: String) -> Label:
	return UIKit.label(text.to_upper(), 30, UIKit.TEXT, true, 700)

static func h3(text: String) -> Label:
	return UIKit.label(text.to_upper(), 15, UIKit.SOFT, true, 600)

## A bar without the percentage text: size its minimum (0 width: as wide as its container), value of max_value.
static func bar(size: Vector2, value: float = 0.0, max_value: float = 1.0) -> ProgressBar:
	var b := ProgressBar.new()
	b.show_percentage = false
	b.custom_minimum_size = size
	b.max_value = max_value
	b.value = value
	return b

static func muted(text: String, size: int = 15) -> Label:
	var l := UIKit.label(text, size, UIKit.SOFT)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return l

## The game's mark: GRID in white, CORSA in the livery's crimson, slanted like a car number (as the website's).
static func logo(size: int = 34) -> Control:
	# one word, as the website's GRIDCORSA (the colours part it)
	var h := UIW.hbox(maxi(1, size / 20))
	h.add_child(_logo_word("GRID", size, Color.WHITE))
	h.add_child(_logo_word("CORSA", size, UIKit.CRIMSON))
	h.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return h

static func _logo_word(text: String, size: int, c: Color) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", UIKit.font(true, 800, true))
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", c)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l

## Hollow capitals (the references' outlined second line under a circuit's name).
static func outline_label(text: String, size: int, c: Color = Color(1, 1, 1, 0.85)) -> Label:
	var l := UIKit.label(text.to_upper(), size, Color(0, 0, 0, 0), true, 800)
	l.add_theme_color_override("font_outline_color", c)
	l.add_theme_constant_override("outline_size", maxi(2, size / 18))
	return l

## A 1 px hairline (horizontal, or vertical when `vertical`).
static func hair(vertical: bool = false, c: Color = UIKit.HAIR) -> ColorRect:
	var r := ColorRect.new()
	r.color = c
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	r.custom_minimum_size = Vector2(1, 0) if vertical else Vector2(0, 1)
	if vertical:
		r.size_flags_vertical = Control.SIZE_EXPAND_FILL
	else:
		r.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return r

## A row of exclusive choices: options [[value, label], ...]; on(value) when one is picked. `enabled` false greys them.
## Drawn as the references' filter strip: the chosen one solid white, the others plain capitals.
static func chips(current: Variant, options: Array, on: Callable, enabled: bool = true) -> Control:
	var flow := HFlowContainer.new()
	flow.add_theme_constant_override("h_separation", 4)
	flow.add_theme_constant_override("v_separation", 4)
	var pad := Vector2(14, 10) if UIKit.touch() else Vector2(12, 6)
	for o: Array in options:
		var b := Button.new()
		b.text = String(o[1]).to_upper()
		b.toggle_mode = true
		b.focus_mode = Control.FOCUS_ALL
		b.button_pressed = o[0] == current
		b.disabled = not enabled and o[0] != current
		b.add_theme_font_override("font", UIKit.font(true, 600))
		b.add_theme_font_size_override("font_size", 18 if UIKit.touch() else 16)
		if b.button_pressed:
			for st: String in ["normal", "hover", "pressed", "disabled", "hover_pressed"]:
				b.add_theme_stylebox_override(st, UIKit.box(Color("f2f4f7"), Color("f2f4f7"), 1, 2, pad))
			for k: String in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color", "font_disabled_color"]:
				b.add_theme_color_override(k, UIKit.INK)
		else:
			b.add_theme_stylebox_override("normal", UIKit.box(Color(0.02, 0.035, 0.08, 0.55), Color(0, 0, 0, 0), 0, 2, pad))
			b.add_theme_stylebox_override("hover", UIKit.box(Color(1, 1, 1, 0.14), Color(0, 0, 0, 0), 0, 2, pad))
			b.add_theme_stylebox_override("pressed", UIKit.box(Color(1, 1, 1, 0.26), Color(0, 0, 0, 0), 0, 2, pad))
			b.add_theme_stylebox_override("disabled", UIKit.box(Color(0.02, 0.035, 0.08, 0.3), Color(0, 0, 0, 0), 0, 2, pad))
		var val: Variant = o[0]
		b.pressed.connect(func() -> void: if enabled: on.call(val))
		flow.add_child(b)
	return flow

## A pill switch (blue when on); on(bool) when flipped, or null for a read-only one.
static func switch(value: bool, on: Variant) -> Switch:
	return Switch.new(value, on)

## A labelled setting: title over the control.
static func field(label: String, control: Control) -> Control:
	var c := UIW.vbox(6)
	c.add_child(UIW.h3(label))
	c.add_child(control)
	return c

## A drop-down of [[value, label], ...].
static func select(current: Variant, options: Array, on: Callable) -> OptionButton:
	var o := OptionButton.new()
	o.focus_mode = Control.FOCUS_ALL
	o.fit_to_longest_item = true
	for i in options.size():
		o.add_item(String(options[i][1]), i)
		if options[i][0] == current:
			o.select(i)
	o.item_selected.connect(func(i: int) -> void: on.call(options[i][0]))
	return o

## ‹ value › of [[value, label], ...] (the references' rows: the pad's left / right steps it, a click on an arrow too).
static func stepper(current: Variant, options: Array, on: Callable, enabled: bool = true) -> Stepper:
	return Stepper.new(current, options, on, enabled)

static func slider(value: float, lo: float, hi: float, step: float, on: Callable) -> HSlider:
	var s := HSlider.new()
	s.min_value = lo
	s.max_value = hi
	s.step = step
	s.value = value
	s.focus_mode = Control.FOCUS_ALL
	s.custom_minimum_size = Vector2(220, 32 if UIKit.touch() else 26)
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
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return r

# ----------------------------------------------------------------- modals ---

## A modal card over a dimmed screen. Returns {root, body}: add content to body; free root to close. Esc, the pad's B
## and the phone's back button close the top one (App.go_back), calling root's "close" meta when it has one.
static func modal(parent: Node, min_width: int = 460, full_height: bool = false) -> Dictionary:
	var root := Control.new()
	UIKit.full(root)
	root.theme = UIKit.theme
	root.set_meta("modal", true)
	var dim := ColorRect.new()
	dim.color = Color(0.01, 0.02, 0.05, 0.72)
	UIKit.full(dim)
	root.add_child(dim)
	var center := CenterContainer.new()
	UIKit.full(center)
	root.add_child(center)
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", UIKit.box(Color(UIKit.NAVY_SOLID, 0.97), Color(1, 1, 1, 0.2), 1, 10, Vector2(26, 22)))
	var vp: Vector2 = parent.get_viewport().get_visible_rect().size if parent.is_inside_tree() else Vector2(1280, 720)
	card.custom_minimum_size = Vector2(minf(min_width, vp.x - 32.0), 0)
	if full_height:
		card.custom_minimum_size.y = maxf(0.0, vp.y - 36.0)
	center.add_child(card)
	var body := UIW.vbox(12)
	body.set_meta("modal_root", root)
	# a modal taller than the screen (a phone) scrolls inside it: the scroller takes the content's height up to the screen's
	var sc := ScrollContainer.new()
	sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	sc.follow_focus = true
	body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sc.add_child(body)
	card.add_child(sc)
	var fit := func() -> void:
		if is_instance_valid(sc) and is_instance_valid(body):
			sc.custom_minimum_size.y = minf(body.get_combined_minimum_size().y, maxf(120.0, vp.y - 60.0))
	body.minimum_size_changed.connect(fit)
	fit.call_deferred()
	# the references' hatched corner, on a plain layer the panel stretches over the card (the hatch keeps its size)
	var over := Control.new()
	over.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var hatch := Hatch.new(Color(1, 1, 1, 0.5), Vector2(34, 34))
	hatch.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	hatch.offset_left = -16
	hatch.offset_top = -14
	hatch.offset_right = 20
	hatch.offset_bottom = 18
	over.add_child(hatch)
	card.add_child(over)
	parent.add_child(root)
	root.modulate.a = 0.0
	root.create_tween().tween_property(root, "modulate:a", 1.0, 0.14)
	UIW.focus_first.call_deferred(body)
	return {"root": root, "body": body}

## A modal's head: an optional kicker over the title, a × that closes it.
static func modal_head(body: Control, title: String, close: Callable, kicker: String = "") -> void:
	var head := UIW.hbox(8)
	var tt := UIW.vbox(0)
	tt.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	if kicker != "":
		tt.add_child(UIKit.label(kicker.to_upper(), 14, UIKit.CRIMSON, true, 700))
	tt.add_child(UIKit.label(title.to_upper(), 30, UIKit.TEXT, true, 700))
	head.add_child(tt)
	var x := close_button(close)
	x.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	head.add_child(x)
	body.add_child(head)
	if body.has_meta("modal_root"):
		(body.get_meta("modal_root") as Node).set_meta("close", close)

## A flat × button.
static func close_button(cb: Callable) -> Button:
	var x := Button.new()
	x.text = "✕"
	x.focus_mode = Control.FOCUS_ALL
	x.custom_minimum_size = Vector2(44, 44) if UIKit.touch() else Vector2(34, 34)
	for st: String in ["normal", "disabled"]:
		x.add_theme_stylebox_override(st, StyleBoxEmpty.new())
	x.add_theme_stylebox_override("hover", UIKit.box(Color(1, 1, 1, 0.12), Color(0, 0, 0, 0), 0, 3))
	x.add_theme_stylebox_override("pressed", UIKit.box(Color(1, 1, 1, 0.24), Color(0, 0, 0, 0), 0, 3))
	x.add_theme_font_override("font", UIKit.font(false, 600))
	x.add_theme_font_size_override("font_size", 20)
	x.pressed.connect(cb)
	return x

# ------------------------------------------------------------------ shell ---

## The top bar of a screen: the mark, a ‹ back with the section's title, centred tabs, and widgets on the right.
## opts: title, back (Callable), tabs ([[key, label], ...]), tab (current key), on_tab (Callable(key)), right (Array of
## Controls), sub_tabs / sub_tab / on_sub (a second row of tabs under the bar).
static func top_bar(opts: Dictionary) -> Control:
	var touch := UIKit.touch()
	var h := 52 if touch else 56
	var col := UIW.vbox(0)
	var bar := Control.new()
	bar.custom_minimum_size = Vector2(0, h)
	bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var band := ColorRect.new()
	band.color = Color(0.015, 0.025, 0.06, 0.55)
	band.mouse_filter = Control.MOUSE_FILTER_IGNORE
	UIKit.full(band)
	bar.add_child(band)
	var line := UIW.hair(false, Color(1, 1, 1, 0.16))
	line.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	line.offset_top = -1
	bar.add_child(line)
	var left := UIW.hbox(12)
	left.set_anchors_preset(Control.PRESET_LEFT_WIDE)
	left.offset_left = 20 if touch else 26
	left.offset_right = 600
	left.alignment = BoxContainer.ALIGNMENT_BEGIN
	left.mouse_filter = Control.MOUSE_FILTER_IGNORE
	# a phone keeps the bar's width for the section: the mark only where there is no back arrow
	if not touch or opts.get("back") == null:
		var lg := UIW.logo(26 if touch else 28)
		lg.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		left.add_child(lg)
	if opts.get("back") != null:
		var back := Button.new()
		back.text = "‹"
		back.focus_mode = Control.FOCUS_ALL
		back.tooltip_text = I18n.t("Back")
		back.custom_minimum_size = Vector2(44, 44) if touch else Vector2(34, 36)
		back.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		back.add_theme_font_override("font", UIKit.font(false, 500))
		back.add_theme_font_size_override("font_size", 34)
		back.add_theme_color_override("font_color", Color(1, 1, 1, 0.8))
		for st: String in ["normal", "disabled"]:
			back.add_theme_stylebox_override(st, UIKit.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 2, Vector2(4, -4)))
		back.add_theme_stylebox_override("hover", UIKit.box(Color(1, 1, 1, 0.12), Color(0, 0, 0, 0), 0, 2, Vector2(4, -4)))
		back.add_theme_stylebox_override("pressed", UIKit.box(Color(1, 1, 1, 0.24), Color(0, 0, 0, 0), 0, 2, Vector2(4, -4)))
		back.pressed.connect(opts.back)
		left.add_child(back)
	if opts.get("title", "") != "":
		var v := UIW.hair(true, Color(1, 1, 1, 0.3))
		v.size_flags_vertical = Control.SIZE_FILL
		v.custom_minimum_size = Vector2(1, 26)
		var vc := CenterContainer.new()
		vc.mouse_filter = Control.MOUSE_FILTER_IGNORE
		vc.add_child(v)
		left.add_child(vc)
		var t := UIKit.label(String(opts.title).to_upper(), 20 if touch else 21, UIKit.TEXT, true, 600)
		t.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		left.add_child(t)
	bar.add_child(left)
	if opts.has("right"):
		var right := UIW.hbox(10)
		right.set_anchors_preset(Control.PRESET_RIGHT_WIDE)
		right.offset_left = -900
		right.offset_right = -(18 if touch else 24)
		right.alignment = BoxContainer.ALIGNMENT_END
		right.mouse_filter = Control.MOUSE_FILTER_IGNORE
		for c: Control in opts.right:
			if c != null:
				c.size_flags_vertical = Control.SIZE_SHRINK_CENTER
				right.add_child(c)
		bar.add_child(right)
	if opts.has("tabs") and opts.get("tabs_left", false):
		# a narrow screen: the tabs follow the mark instead of the centre, clear of the widgets on the right
		left.add_child(UIW.tabs(opts.tabs, opts.get("tab", ""), opts.get("on_tab", Callable()), false))
	elif opts.has("tabs"):
		var center := CenterContainer.new()
		UIKit.full(center)
		center.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var tb := UIW.tabs(opts.tabs, opts.get("tab", ""), opts.get("on_tab", Callable()), false)
		center.add_child(tb)
		bar.add_child(center)
	col.add_child(bar)
	if opts.has("sub_tabs"):
		var sub := CenterContainer.new()
		sub.custom_minimum_size = Vector2(0, 44 if touch else 46)
		sub.add_child(UIW.tabs(opts.sub_tabs, opts.get("sub_tab", ""), opts.get("on_sub", Callable()), true))
		col.add_child(sub)
		var hl := HBoxContainer.new()
		hl.alignment = BoxContainer.ALIGNMENT_CENTER
		var line2 := UIW.hair(false, Color(1, 1, 1, 0.14))
		line2.size_flags_horizontal = Control.SIZE_FILL
		line2.custom_minimum_size = Vector2(640, 1)
		hl.add_child(line2)
		col.add_child(hl)
	return col

## Capital tabs with a white underline under the current one ([[key, label], ...]).
static func tabs(items: Array, current: String, on: Callable, small: bool = false) -> HBoxContainer:
	var row := UIW.hbox(6 if small else 10)
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	for it: Array in items:
		var key: String = it[0]
		var b := TabButton.new(String(it[1]), key == current, small)
		b.set_meta("key", key)
		if on.is_valid():
			b.pressed.connect(func() -> void: on.call(key))
		row.add_child(b)
	return row

## The screen's frame: the top bar, the body (it takes the height) and an optional bottom bar.
static func screen(top: Control, body: Control, bottom: Control = null) -> Control:
	var touch := UIKit.touch()
	var col := UIW.vbox(0)
	col.add_child(top)
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col.add_child(UIW.margins(body, 22 if touch else 40, 12 if touch else 18, 22 if touch else 40, 8 if bottom != null else (14 if touch else 24)))
	col.get_child(1).size_flags_vertical = Control.SIZE_EXPAND_FILL
	if bottom != null:
		col.add_child(UIW.margins(bottom, 22 if touch else 40, 0, 22 if touch else 40, 12 if touch else 22))
	return col

## The bottom bar: a note on the left, the actions on the right (the last one is the main action).
static func action_bar(note: Control, actions: Array) -> HBoxContainer:
	var row := UIW.hbox(12)
	if note != null:
		note.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		note.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(note)
	else:
		row.add_child(UIW.spacer())
	for a: Control in actions:
		if a != null:
			a.custom_minimum_size = Vector2(maxf(a.custom_minimum_size.x, 168), maxf(a.custom_minimum_size.y, 54 if UIKit.touch() else 46))
			row.add_child(a)
	return row

## A big action button (the bottom bar's): taller capitals.
static func action(text: String, cb: Callable, primary: bool = false) -> Button:
	var b := UIKit.button(text, cb, primary)
	b.add_theme_font_size_override("font_size", 24 if UIKit.touch() else 23)
	return b

## A big dim section heading with an optional value on the right and a hairline under it (the references' PRACTICE 45MINS).
static func section(title: String, value: String = "") -> Control:
	var col := UIW.vbox(4)
	var row := UIW.hbox(8)
	var t := UIKit.label(title.to_upper(), 26 if UIKit.touch() else 28, UIKit.DIM, true, 600)
	t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(t)
	if value != "":
		row.add_child(UIKit.label(value.to_upper(), 26 if UIKit.touch() else 28, UIKit.DIM, true, 600))
	col.add_child(row)
	col.add_child(UIW.hair())
	return col

## A setting row as the references' (label left, control right, a hairline under it, lit while pointed at or focused),
## with the help under the label.
static func row(label: String, ctrl: Control, hint: String = "") -> PanelContainer:
	var touch := UIKit.touch()
	var p := PanelContainer.new()
	var normal := UIKit.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 0, Vector2(10, 6 if touch else 5))
	normal.border_color = UIKit.HAIR
	normal.border_width_bottom = 1
	var lit: StyleBoxFlat = normal.duplicate()
	lit.bg_color = UIKit.ROW_HI
	p.add_theme_stylebox_override("panel", normal)
	p.custom_minimum_size = Vector2(0, 50 if touch else 40)
	var r := UIW.hbox(12)
	var left := UIW.vbox(0)
	left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	left.alignment = BoxContainer.ALIGNMENT_CENTER
	left.add_child(UIKit.label(label, 17 if touch else 16, UIKit.TEXT, false, 600))
	if hint != "":
		left.add_child(UIW.muted(hint, 13))
	r.add_child(left)
	ctrl.size_flags_horizontal = Control.SIZE_SHRINK_END
	ctrl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	r.add_child(ctrl)
	p.add_child(r)
	p.mouse_entered.connect(func() -> void: p.add_theme_stylebox_override("panel", lit))
	p.mouse_exited.connect(func() -> void: if not p.get_global_rect().has_point(p.get_global_mouse_position()): p.add_theme_stylebox_override("panel", normal))
	if ctrl.focus_mode != Control.FOCUS_NONE:
		ctrl.focus_entered.connect(func() -> void: p.add_theme_stylebox_override("panel", lit))
		ctrl.focus_exited.connect(func() -> void: p.add_theme_stylebox_override("panel", normal))
	return p

## A list row: the content over a hairline (entry lists, standings).
static func row_line(content: Control) -> PanelContainer:
	var p := PanelContainer.new()
	var st := UIKit.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 0, Vector2(8, 6 if UIKit.touch() else 5))
	st.border_color = UIKit.HAIR
	st.border_width_bottom = 1
	p.add_theme_stylebox_override("panel", st)
	p.add_child(content)
	return p

## A small coloured tag (GT3, OFFLINE, HOST). `filled` false: an outlined one.
static func tag(text: String, c: Color, filled: bool = true, text_colour: Color = Color.WHITE) -> PanelContainer:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", UIKit.box(c if filled else Color(0, 0, 0, 0.25), c, 1, 2, Vector2(6, 1)))
	var l := UIKit.label(text.to_upper(), 14, text_colour if filled else c, true, 700)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	p.add_child(l)
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	p.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	p.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	return p

## A label over a big condensed value (the cards' "Circuit length / 7.004 KM").
static func stat(label: String, value: String, size: int = 30, colour: Color = UIKit.TEXT) -> VBoxContainer:
	var c := UIW.vbox(-4)
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var l := UIKit.label(label, 13, UIKit.SOFT, false, 500)
	var v := UIKit.label(value.to_upper(), size, colour, true, 600)
	for x: Label in [l, v]:
		x.mouse_filter = Control.MOUSE_FILTER_IGNORE
		c.add_child(x)
	return c

## A big number over its caption (the career's stat tiles), centred.
static func big_stat(value: String, caption: String, size: int = 52) -> VBoxContainer:
	var c := UIW.vbox(-6)
	var v := UIKit.label(value, size, UIKit.TEXT, true, 600)
	v.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	var l := UIKit.label(caption.to_upper(), 15, UIKit.TEXT, true, 600)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	c.add_child(v)
	c.add_child(l)
	return c

## A tile: navy glass, rounded (the stats' boxes).
static func tile(child: Control, pad: Vector2 = Vector2(14, 12)) -> PanelContainer:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", UIKit.box(Color(1, 1, 1, 0.07), Color(1, 1, 1, 0.08), 1, 8, pad))
	p.add_child(child)
	return p

## A pressable card (a Button holding any content, which ignores the mouse): navy glass with rounded corners that also
## clip a photo put in its "clip" child, a rim drawn over the photo (white when hovered or `selected`), the focus ring
## for the pad. Content goes into the "content" MarginContainer.
static func card_button(selected: bool = false, radius: int = UIKit.CARD_RADIUS, pad: int = 0) -> Button:
	var b := Button.new()
	b.focus_mode = Control.FOCUS_ALL
	var empty := StyleBoxEmpty.new()
	for st: String in ["normal", "hover", "pressed", "hover_pressed", "disabled"]:
		b.add_theme_stylebox_override(st, empty)
	b.add_theme_stylebox_override("focus", UIKit.focus_ring(radius))
	var clip := Panel.new()
	clip.name = "clip"
	UIKit.full(clip)
	clip.mouse_filter = Control.MOUSE_FILTER_IGNORE
	clip.add_theme_stylebox_override("panel", UIKit.box(Color(0.035, 0.055, 0.115, 0.86), Color(0, 0, 0, 0), 0, radius))
	# the rounded panel masks what is drawn inside it (the photo's corners)
	clip.clip_children = CanvasItem.CLIP_CHILDREN_AND_DRAW
	b.add_child(clip)
	var m := MarginContainer.new()
	m.name = "content"
	UIKit.full(m)
	for s: String in ["left", "top", "right", "bottom"]:
		m.add_theme_constant_override("margin_" + s, pad)
	m.mouse_filter = Control.MOUSE_FILTER_IGNORE
	b.add_child(m)
	var rim := Panel.new()
	rim.name = "rim"
	UIKit.full(rim)
	rim.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var rim_n := _rim(Color.WHITE if selected else Color(1, 1, 1, 0.16), 2 if selected else 1, radius)
	var rim_h := _rim(Color.WHITE if selected else Color(1, 1, 1, 0.7), 2 if selected else 1, radius)
	var rim_p := _rim(Color.WHITE, 2, radius)
	rim.add_theme_stylebox_override("panel", rim_n)
	b.mouse_entered.connect(func() -> void: rim.add_theme_stylebox_override("panel", rim_h))
	b.mouse_exited.connect(func() -> void: rim.add_theme_stylebox_override("panel", rim_n))
	b.button_down.connect(func() -> void: rim.add_theme_stylebox_override("panel", rim_p))
	b.button_up.connect(func() -> void: rim.add_theme_stylebox_override("panel", rim_h if b.is_hovered() else rim_n))
	b.add_child(rim)
	return b

static func _rim(c: Color, w: int, radius: int) -> StyleBoxFlat:
	var s := UIKit.box(Color(0, 0, 0, 0), c, w, radius)
	s.draw_center = false
	return s

## Lets the mouse through a whole subtree (content laid over a card button).
static func pass_mouse(c: Control) -> void:
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for ch in c.get_children():
		if ch is Control:
			UIW.pass_mouse(ch)

## A photo filling its parent with a navy fade from the bottom (cards and the circuit header).
static func photo_fill(path: String, alpha: float = 1.0, fade: float = 0.92) -> Control:
	var root := Control.new()
	UIKit.full(root)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var img := TextureRect.new()
	img.texture = UIW.tex(path)
	img.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	img.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	img.modulate = Color(1, 1, 1, alpha)
	img.mouse_filter = Control.MOUSE_FILTER_IGNORE
	UIKit.full(img)
	root.add_child(img)
	var shade := TextureRect.new()
	shade.texture = _fade_tex(fade)
	shade.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	shade.stretch_mode = TextureRect.STRETCH_SCALE
	shade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	UIKit.full(shade)
	root.add_child(shade)
	return root

static var _fades := {}

## Transparent at the top to navy at the bottom (cached per strength).
static func _fade_tex(strength: float) -> Texture2D:
	if _fades.has(strength):
		return _fades[strength]
	var g := Gradient.new()
	g.set_color(0, Color(UIKit.NAVY_DEEP, 0.1))
	g.set_color(1, Color(UIKit.NAVY_DEEP, strength))
	g.add_point(0.45, Color(UIKit.NAVY_DEEP, strength * 0.45))
	var t := GradientTexture2D.new()
	t.gradient = g
	t.fill_from = Vector2(0, 0)
	t.fill_to = Vector2(0, 1)
	t.width = 4
	t.height = 128
	_fades[strength] = t
	return t

## Marks the control a screen focuses first (the pad and the keyboard start there).
static func default_focus(c: Control) -> Control:
	c.set_meta("default_focus", true)
	return c

## Focuses the subtree's default control, else its first focusable one (hidden: the ring shows on the first pad or key press).
static func focus_first(root: Node) -> void:
	if root == null or not is_instance_valid(root) or not root.is_inside_tree():
		return
	var pick := _find_focus(root, true)
	if pick == null:
		pick = _find_focus(root, false)
	if pick != null:
		pick.grab_focus(true)

static func _find_focus(n: Node, marked: bool) -> Control:
	if n is Control:
		var c := n as Control
		if not c.is_visible_in_tree():
			return null
		if c.focus_mode != Control.FOCUS_NONE and (not marked or c.has_meta("default_focus")) and not (c is BaseButton and (c as BaseButton).disabled):
			return c
	for ch in n.get_children():
		var r := _find_focus(ch, marked)
		if r != null:
			return r
	return null

# -------------------------------------------------------------- controls ---

## The control classes, each in its own file under scripts/ui/widgets (UIW.TabButton and the others as before).
const TabButton = preload("res://scripts/ui/widgets/tab_button.gd")
const Switch = preload("res://scripts/ui/widgets/switch.gd")
const Stepper = preload("res://scripts/ui/widgets/stepper.gd")
const Hatch = preload("res://scripts/ui/widgets/hatch.gd")
const WeatherIcon = preload("res://scripts/ui/widgets/weather_icon.gd")
