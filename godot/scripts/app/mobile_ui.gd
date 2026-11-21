class_name MobileUI
extends RefCounted
## Building blocks of the mobile layout (MobileHome, MobileModes, MobilePass), after the free-to-play racing games in
## RESOURCES/UI-MOBILE-REFERENCE: dark glass cards with a title strip, photo cards with a timer badge, slanted crimson
## actions, the currencies as pills, vector icons drawn in code (no icon font: Barlow has no pictograms).

const GLASS := Color(0.02, 0.03, 0.06, 0.78)
const STRIP := Color(0, 0, 0, 0.72)
const GOLD := Color("f5c542")
const PURPLE := Color("7b3fe4")
const TEAL := Color("1fb6a6")

## A circuit's menu photo: kind hero / pole / grid / aerial / straight, by the layout's map.
static func photo(map: String, kind: String = "hero") -> String:
	var sfx := "" if map == "" or map == "nurburgring" or map == "nordschleife" else "_" + map
	var p := "res://assets/ui/photo_%s%s.webp" % [kind, sfx]
	return p if ResourceLoader.exists(p) else "res://assets/ui/photo_%s.webp" % kind

static func map_of(app: App, track_id: String) -> String:
	return str(app.track_entry(track_id).get("map", ""))

## A card button: an optional photo, a black title strip on top with its text, the body under it.
static func card(title: String, photo_path: String = "", tint: float = 0.95) -> Button:
	var b := UIW.card_button(false, 6)
	if photo_path != "":
		b.get_node("clip").add_child(UIW.photo_fill(photo_path, tint, 0.55))
	var col := UIW.vbox(0)
	UIKit.full(col)
	col.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if title != "":
		var strip := PanelContainer.new()
		strip.add_theme_stylebox_override("panel", UIKit.box(STRIP, Color(0, 0, 0, 0), 0, 0, Vector2(10, 4)))
		strip.mouse_filter = Control.MOUSE_FILTER_IGNORE
		strip.add_child(UIKit.label(title.to_upper(), 15, UIKit.TEXT, true, 600))
		col.add_child(strip)
	var body := MarginContainer.new()
	body.name = "body"
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for s: String in ["left", "right"]:
		body.add_theme_constant_override("margin_" + s, 10)
	for s: String in ["top", "bottom"]:
		body.add_theme_constant_override("margin_" + s, 6)
	col.add_child(body)
	b.get_node("content").add_child(col)
	return b

static func card_body(b: Button) -> MarginContainer:
	return b.get_node("content").get_child(0).get_node("body")

## A small black pill (a timer, a count) at a corner of a card.
static func badge(text: String, c: Color = Color(0, 0, 0, 0.8), fg: Color = UIKit.TEXT, icon_kind: String = "") -> PanelContainer:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", UIKit.box(c, Color(0, 0, 0, 0), 0, 4, Vector2(8, 2)))
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var row := UIW.hbox(5)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if icon_kind != "":
		row.add_child(Icon.make(icon_kind, 16, fg))
	row.add_child(UIKit.label(text, 15, fg, true, 600))
	p.add_child(row)
	return p

## The slanted crimson action (the references' RACE).
static func race_button(text: String, cb: Callable) -> Button:
	var b := Button.new()
	b.focus_mode = Control.FOCUS_ALL
	b.text = text.to_upper()
	b.add_theme_font_override("font", UIKit.font(true, 800, true))
	b.add_theme_font_size_override("font_size", 34)
	b.add_theme_color_override("font_color", Color.WHITE)
	b.add_theme_color_override("font_hover_color", Color.WHITE)
	b.add_theme_color_override("font_pressed_color", Color.WHITE)
	var n := _slant(UIKit.CRIMSON)
	var h := _slant(UIKit.CRIMSON.lightened(0.15))
	var p := _slant(UIKit.CRIMSON.darkened(0.2))
	b.add_theme_stylebox_override("normal", n)
	b.add_theme_stylebox_override("hover", h)
	b.add_theme_stylebox_override("pressed", p)
	b.add_theme_stylebox_override("focus", UIKit.focus_ring(4))
	b.custom_minimum_size = Vector2(240, 64)
	b.pressed.connect(cb)
	return b

static func _slant(c: Color) -> StyleBoxFlat:
	var s := UIKit.box(c, Color(1, 1, 1, 0.25), 1, 4, Vector2(28, 8))
	s.skew = Vector2(0.28, 0)
	s.shadow_color = Color(c, 0.45)
	s.shadow_size = 10
	return s

## A currency pill: the icon, the amount, a + that opens the store.
static func currency(kind: String, amount: int, on_plus: Callable) -> Control:
	var b := Button.new()
	b.focus_mode = Control.FOCUS_ALL
	for st: String in ["normal", "hover", "pressed"]:
		b.add_theme_stylebox_override(st, UIKit.box(Color(0, 0, 0, 0.55 if st == "normal" else 0.75), Color(1, 1, 1, 0.18), 1, 16, Vector2(10, 3)))
	var row := UIW.hbox(6)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_child(Icon.make(kind, 22, GOLD if kind == "coin" else Color("dfe7f2")))
	row.add_child(UIKit.label(StoreScreen.fmt(amount), 19, UIKit.TEXT, true, 700))
	row.add_child(UIKit.label("+", 22, UIKit.TEXT, true, 700))
	var cc := CenterContainer.new()
	cc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	UIKit.full(cc)
	cc.add_child(row)
	b.add_child(cc)
	b.custom_minimum_size = Vector2(row.get_combined_minimum_size().x + 26, 40)
	b.pressed.connect(on_plus)
	return b

## A round icon button with a red dot when something waits there.
static func icon_button(kind: String, tip: String, cb: Callable, dot: bool = false) -> Control:
	var b := Button.new()
	b.focus_mode = Control.FOCUS_ALL
	b.tooltip_text = tip
	b.custom_minimum_size = Vector2(42, 42)
	for st: String in ["normal", "hover", "pressed"]:
		b.add_theme_stylebox_override(st, UIKit.box(Color(0, 0, 0, 0.4 if st == "normal" else 0.7), Color(1, 1, 1, 0.12), 1, 21))
	var ic := Icon.make(kind, 24, UIKit.TEXT)
	UIKit.full(ic)
	b.add_child(ic)
	if dot:
		var d := Icon.make("dot", 12, UIKit.BAD)
		d.set_anchors_preset(Control.PRESET_TOP_RIGHT)
		d.position = Vector2(-12, 0)
		b.add_child(d)
	b.pressed.connect(cb)
	return b

## A progress bar as the references' thin gold line.
static func bar(frac: float, c: Color = GOLD, h: int = 6) -> Control:
	var back := Panel.new()
	back.custom_minimum_size = Vector2(0, h)
	back.mouse_filter = Control.MOUSE_FILTER_IGNORE
	back.add_theme_stylebox_override("panel", UIKit.box(Color(1, 1, 1, 0.14), Color(0, 0, 0, 0), 0, h / 2))
	var fill := Panel.new()
	fill.mouse_filter = Control.MOUSE_FILTER_IGNORE
	fill.add_theme_stylebox_override("panel", UIKit.box(c, Color(0, 0, 0, 0), 0, h / 2))
	fill.anchor_bottom = 1.0
	fill.anchor_right = clampf(frac, 0.0, 1.0)
	back.add_child(fill)
	return back

## A row of trophies earned of a race (0..3).
static func trophies(n: int, of: int = 3, size: int = 18) -> HBoxContainer:
	var row := UIW.hbox(2)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for i in of:
		row.add_child(Icon.make("trophy", size, GOLD if i < n else Color(1, 1, 1, 0.22)))
	return row

## A reward toast in the middle of the screen (a claim): the lines, then it fades.
static func reward_popup(app: App, title: String, lines: Array) -> void:
	var m := UIW.modal(app.overlay_layer, 440)
	var b: VBoxContainer = m.body
	UIW.modal_head(b, title, func() -> void: m.root.queue_free())
	for l in lines:
		var row := UIW.hbox(10)
		row.add_child(Icon.make("gift", 22, GOLD))
		row.add_child(UIKit.label(l, 20, UIKit.TEXT, true, 600))
		b.add_child(row)
	var ok := UIKit.button(I18n.t("Collect"), func() -> void: m.root.queue_free(), true)
	ok.size_flags_horizontal = Control.SIZE_SHRINK_END
	b.add_child(ok)
	ok.grab_focus.call_deferred()

## Vector icons drawn in code.
class Icon:
	extends Control
	var kind := ""
	var colour := Color.WHITE
	## the drawn size; centred in whatever rect the icon is given
	var px := 24.0

	static func make(k: String, size: int, c: Color) -> Icon:
		var i := Icon.new()
		i.kind = k
		i.colour = c
		i.px = size
		i.custom_minimum_size = Vector2(size, size)
		i.size = Vector2(size, size)
		i.mouse_filter = Control.MOUSE_FILTER_IGNORE
		return i

	func _draw() -> void:
		var s := minf(px, minf(size.x, size.y))
		draw_set_transform((size - Vector2(s, s)) * 0.5)
		var c := colour
		var w := maxf(1.5, s * 0.09)
		match kind:
			"dot":
				draw_circle(Vector2(s, s) * 0.5, s * 0.5, c)
			"trophy":
				draw_colored_polygon(Transform2D().scaled(Vector2(s, s)) * PackedVector2Array([Vector2(0.22, 0.12), Vector2(0.78, 0.12), Vector2(0.72, 0.45), Vector2(0.58, 0.58), Vector2(0.42, 0.58), Vector2(0.28, 0.45)]), c)
				draw_rect(Rect2(Vector2(0.45, 0.58) * s, Vector2(0.1, 0.18) * s), c)
				draw_rect(Rect2(Vector2(0.28, 0.76) * s, Vector2(0.44, 0.12) * s), c)
				draw_arc(Vector2(0.22, 0.27) * s, s * 0.13, PI * 0.5, PI * 1.5, 10, c, w)
				draw_arc(Vector2(0.78, 0.27) * s, s * 0.13, -PI * 0.5, PI * 0.5, 10, c, w)
			"coin":
				draw_circle(Vector2(s, s) * 0.5, s * 0.46, c)
				draw_circle(Vector2(s, s) * 0.5, s * 0.33, c.darkened(0.25))
				draw_string(UIKit.font(true, 800), Vector2(s * 0.33, s * 0.7), "G", HORIZONTAL_ALIGNMENT_LEFT, -1, int(s * 0.5), c)
			"credit":
				draw_arc(Vector2(s, s) * 0.5, s * 0.42, 0, TAU, 24, c, w)
				draw_string(UIKit.font(true, 800), Vector2(s * 0.3, s * 0.68), "CR", HORIZONTAL_ALIGNMENT_LEFT, -1, int(s * 0.38), c)
			"gear":
				for i in 8:
					var a := i * TAU / 8.0
					draw_line(Vector2(s, s) * 0.5 + Vector2(cos(a), sin(a)) * s * 0.28, Vector2(s, s) * 0.5 + Vector2(cos(a), sin(a)) * s * 0.46, c, w * 1.6)
				draw_arc(Vector2(s, s) * 0.5, s * 0.28, 0, TAU, 20, c, w * 1.3)
				draw_circle(Vector2(s, s) * 0.5, s * 0.1, c)
			"people":
				draw_circle(Vector2(0.36, 0.32) * s, s * 0.14, c)
				draw_arc(Vector2(0.36, 0.86) * s, s * 0.28, PI, TAU, 16, c, w * 1.4)
				draw_circle(Vector2(0.7, 0.36) * s, s * 0.11, Color(c, 0.75))
				draw_arc(Vector2(0.7, 0.86) * s, s * 0.22, PI, TAU, 16, Color(c, 0.75), w * 1.2)
			"mail":
				draw_rect(Rect2(Vector2(0.1, 0.24) * s, Vector2(0.8, 0.52) * s), c, false, w)
				draw_polyline(PackedVector2Array([Vector2(0.1, 0.24) * s, Vector2(0.5, 0.56) * s, Vector2(0.9, 0.24) * s]), c, w)
			"calendar":
				draw_rect(Rect2(Vector2(0.14, 0.2) * s, Vector2(0.72, 0.66) * s), c, false, w)
				draw_rect(Rect2(Vector2(0.14, 0.2) * s, Vector2(0.72, 0.16) * s), c)
				for x: float in [0.32, 0.5, 0.68]:
					draw_rect(Rect2(Vector2(x - 0.05, 0.5) * s, Vector2(0.1, 0.1) * s), c)
			"chest":
				draw_rect(Rect2(Vector2(0.12, 0.38) * s, Vector2(0.76, 0.46) * s), c)
				draw_rect(Rect2(Vector2(0.12, 0.2) * s, Vector2(0.76, 0.2) * s), c.lightened(0.2))
				draw_rect(Rect2(Vector2(0.44, 0.34) * s, Vector2(0.12, 0.16) * s), c.darkened(0.45))
			"gift":
				draw_rect(Rect2(Vector2(0.14, 0.38) * s, Vector2(0.72, 0.48) * s), c)
				draw_rect(Rect2(Vector2(0.1, 0.26) * s, Vector2(0.8, 0.14) * s), c.lightened(0.15))
				draw_rect(Rect2(Vector2(0.45, 0.26) * s, Vector2(0.1, 0.6) * s), c.darkened(0.4))
			"play":
				draw_colored_polygon(PackedVector2Array([Vector2(0.3, 0.2) * s, Vector2(0.8, 0.5) * s, Vector2(0.3, 0.8) * s]), c)
			"tv":
				draw_rect(Rect2(Vector2(0.1, 0.22) * s, Vector2(0.8, 0.52) * s), c, false, w)
				draw_colored_polygon(PackedVector2Array([Vector2(0.42, 0.36) * s, Vector2(0.62, 0.48) * s, Vector2(0.42, 0.6) * s]), c)
				draw_line(Vector2(0.35, 0.86) * s, Vector2(0.65, 0.86) * s, c, w)
			"lock":
				draw_rect(Rect2(Vector2(0.24, 0.46) * s, Vector2(0.52, 0.42) * s), c)
				draw_arc(Vector2(0.5, 0.46) * s, s * 0.17, PI, TAU, 12, c, w * 1.3)
			"cart":
				draw_polyline(PackedVector2Array([Vector2(0.08, 0.2) * s, Vector2(0.22, 0.2) * s, Vector2(0.32, 0.66) * s, Vector2(0.8, 0.66) * s, Vector2(0.88, 0.32) * s, Vector2(0.26, 0.32) * s]), c, w)
				draw_circle(Vector2(0.38, 0.82) * s, s * 0.07, c)
				draw_circle(Vector2(0.74, 0.82) * s, s * 0.07, c)
			"car":
				draw_colored_polygon(PackedVector2Array([Vector2(0.06, 0.66) * s, Vector2(0.12, 0.48) * s, Vector2(0.3, 0.42) * s, Vector2(0.42, 0.28) * s, Vector2(0.7, 0.28) * s, Vector2(0.84, 0.44) * s, Vector2(0.94, 0.5) * s, Vector2(0.94, 0.66) * s]), c)
				draw_circle(Vector2(0.28, 0.7) * s, s * 0.1, c.darkened(0.5))
				draw_circle(Vector2(0.74, 0.7) * s, s * 0.1, c.darkened(0.5))
			"brush":
				draw_line(Vector2(0.8, 0.14) * s, Vector2(0.4, 0.58) * s, c, w * 1.8)
				draw_colored_polygon(PackedVector2Array([Vector2(0.3, 0.52) * s, Vector2(0.46, 0.66) * s, Vector2(0.26, 0.9) * s, Vector2(0.1, 0.86) * s]), c)
			"list":
				for y: float in [0.28, 0.5, 0.72]:
					draw_rect(Rect2(Vector2(0.12, y - 0.05) * s, Vector2(0.1, 0.1) * s), c)
					draw_line(Vector2(0.32, y) * s, Vector2(0.88, y) * s, c, w)
			"flag":
				draw_line(Vector2(0.2, 0.1) * s, Vector2(0.2, 0.92) * s, c, w)
				for i in 3:
					for j in 2:
						if (i + j) % 2 == 0:
							draw_rect(Rect2(Vector2(0.22 + i * 0.22, 0.14 + j * 0.2) * s, Vector2(0.22, 0.2) * s), c)
				draw_rect(Rect2(Vector2(0.22, 0.14) * s, Vector2(0.66, 0.4) * s), c, false, w * 0.6)
			"star":
				var pts := PackedVector2Array()
				for i in 10:
					var a := -PI / 2 + i * PI / 5
					var r := 0.46 if i % 2 == 0 else 0.2
					pts.append(Vector2(0.5 + cos(a) * r, 0.52 + sin(a) * r) * s)
				draw_colored_polygon(pts, c)
			"back":
				draw_polyline(PackedVector2Array([Vector2(0.62, 0.16) * s, Vector2(0.3, 0.5) * s, Vector2(0.62, 0.84) * s]), c, w * 1.5)
			"globe":
				draw_arc(Vector2(s, s) * 0.5, s * 0.42, 0, TAU, 24, c, w)
				draw_line(Vector2(0.08, 0.5) * s, Vector2(0.92, 0.5) * s, c, w * 0.8)
				draw_arc(Vector2(s, s) * 0.5, s * 0.42, 0, TAU, 24, c, w)
				draw_polyline(PackedVector2Array([Vector2(0.5, 0.08) * s, Vector2(0.32, 0.5) * s, Vector2(0.5, 0.92) * s]), c, w * 0.8)
				draw_polyline(PackedVector2Array([Vector2(0.5, 0.08) * s, Vector2(0.68, 0.5) * s, Vector2(0.5, 0.92) * s]), c, w * 0.8)
			"clock":
				draw_arc(Vector2(s, s) * 0.5, s * 0.42, 0, TAU, 24, c, w)
				draw_line(Vector2(s, s) * 0.5, Vector2(0.5, 0.22) * s, c, w)
				draw_line(Vector2(s, s) * 0.5, Vector2(0.7, 0.58) * s, c, w)
