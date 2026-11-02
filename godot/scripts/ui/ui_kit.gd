class_name UIKit
extends RefCounted
## The game's UI look (port of the design tokens in styles.css): colours, fonts (Barlow, Barlow Condensed), panel and
## button styles, and small builders used by every screen (the equivalent of the web client's ui/dom.ts h()).

const BG := Color("050506")
const PANEL := Color(7 / 255.0, 8 / 255.0, 10 / 255.0, 0.86)
const PANEL_SOLID := Color("0b0c0f")
const LINE := Color(1, 1, 1, 0.1)
const TEXT := Color("f2f3f5")
const MUTED := Color("8b9099")
const ACCENT := Color("e10600")
const ACCENT_2 := Color("ffd60a")
const GOOD := Color("30d158")
const BAD := Color("ff453a")
const RADIUS := 3

static var _fonts := {}

## A phone or tablet (APEX_TOUCH=1 pretends on the desktop, to check the layouts).
static func touch() -> bool:
	return DisplayServer.is_touchscreen_available() or OS.get_environment("APEX_TOUCH") != ""

## How much the menu screens are enlarged: a button should be about 48 dp (finger-sized) on any phone or tablet.
static func ui_scale() -> float:
	if not touch():
		return 1.0
	if OS.get_environment("APEX_UI_SCALE") != "":
		return float(OS.get_environment("APEX_UI_SCALE"))
	var win := DisplayServer.window_get_size()
	var dpi := float(DisplayServer.screen_get_dpi())
	if dpi <= 0.0 or win.y <= 0:
		return 1.5
	var unit_dp := (float(win.y) / 720.0) / (dpi / 160.0)
	return clampf(0.86 / unit_dp, 1.0, 2.0)

## Padding of a button: roomier on a touch screen.
static func btn_pad() -> Vector2:
	return Vector2(20, 14) if touch() else Vector2(16, 9)

## display: Barlow Condensed (headings, numbers, buttons); body: Barlow. weight: 400, 500, 600, 700, 800.
static func font(display: bool, weight: int = 500, italic: bool = false) -> Font:
	var key := "%s%d%s" % ["d" if display else "b", weight, "i" if italic else ""]
	if _fonts.has(key):
		return _fonts[key]
	var file: String
	if display:
		if italic:
			file = "BarlowCondensed-ExtraBoldItalic"
		else:
			file = {500: "BarlowCondensed-Medium", 600: "BarlowCondensed-SemiBold", 700: "BarlowCondensed-Bold", 800: "BarlowCondensed-ExtraBold"}.get(weight, "BarlowCondensed-Bold")
	else:
		file = {400: "Barlow-Regular", 500: "Barlow-Medium", 600: "Barlow-SemiBold", 700: "Barlow-Bold"}.get(weight, "Barlow-Regular")
	var f := load("res://assets_static/fonts/%s.ttf" % file) as Font
	_fonts[key] = f
	return f

static func box(bg: Color, border: Color = Color(0, 0, 0, 0), border_w: int = 0, radius: int = RADIUS, pad: Vector2 = Vector2.ZERO) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = bg
	s.border_color = border
	s.set_border_width_all(border_w)
	s.set_corner_radius_all(radius)
	s.content_margin_left = pad.x
	s.content_margin_right = pad.x
	s.content_margin_top = pad.y
	s.content_margin_bottom = pad.y
	return s

## The game's theme: dark panels, condensed uppercase buttons, thin lines.
static func build_theme() -> Theme:
	var th := Theme.new()
	th.default_font = font(false, 500)
	th.default_font_size = 18 if touch() else 16
	th.set_color("font_color", "Label", TEXT)
	th.set_font("font", "Label", font(false, 500))
	# buttons
	for state in ["normal", "hover", "pressed", "disabled", "focus"]:
		var bg := Color(1, 1, 1, 0.06)
		var bd := LINE
		match state:
			"hover":
				bg = Color(1, 1, 1, 0.12)
			"pressed":
				bg = Color(ACCENT, 0.9)
				bd = ACCENT
			"disabled":
				bg = Color(1, 1, 1, 0.03)
			"focus":
				bg = Color(1, 1, 1, 0.1)
				bd = Color(1, 1, 1, 0.5)
		th.set_stylebox(state, "Button", box(bg, bd, 1, RADIUS, btn_pad()))
	th.set_font("font", "Button", font(true, 700))
	th.set_font_size("font_size", "Button", 20 if touch() else 18)
	th.set_color("font_color", "Button", TEXT)
	th.set_color("font_hover_color", "Button", Color.WHITE)
	th.set_color("font_pressed_color", "Button", Color.WHITE)
	th.set_color("font_disabled_color", "Button", MUTED)
	# panels
	th.set_stylebox("panel", "PanelContainer", box(PANEL, LINE, 1, RADIUS, Vector2(14, 12)))
	th.set_stylebox("panel", "Panel", box(PANEL, LINE, 1, RADIUS))
	# inputs
	th.set_stylebox("normal", "LineEdit", box(Color(0, 0, 0, 0.35), LINE, 1, RADIUS, Vector2(10, 8)))
	th.set_stylebox("focus", "LineEdit", box(Color(0, 0, 0, 0.45), Color(1, 1, 1, 0.45), 1, RADIUS, Vector2(10, 8)))
	th.set_color("font_color", "LineEdit", TEXT)
	th.set_color("font_placeholder_color", "LineEdit", MUTED)
	# check boxes / option buttons / sliders keep the engine look with our colours
	th.set_color("font_color", "CheckBox", TEXT)
	th.set_color("font_color", "OptionButton", TEXT)
	return th

## A Label with the display (condensed) or body font.
static func label(text: String, size: int = 16, color: Color = TEXT, display: bool = false, weight: int = 500) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", font(display, weight))
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l

## A flat styled button.
static func button(text: String, cb: Callable = Callable(), primary: bool = false) -> Button:
	var b := Button.new()
	b.text = text.to_upper()
	b.focus_mode = Control.FOCUS_NONE
	if primary:
		for state in ["normal", "hover", "pressed", "focus"]:
			var c := ACCENT if state != "hover" else Color("ff2b1f")
			b.add_theme_stylebox_override(state, box(c, c, 1, RADIUS, btn_pad() + Vector2(2, 1)))
	if cb.is_valid():
		b.pressed.connect(cb)
	return b

## A container filled to its parent.
static func full(c: Control) -> void:
	c.set_anchors_preset(Control.PRESET_FULL_RECT)
	c.offset_left = 0
	c.offset_top = 0
	c.offset_right = 0
	c.offset_bottom = 0

## Millisecond lap time as m:ss.mmm.
static func fmt_lap(ms: float) -> String:
	var m := int(ms / 60000.0)
	return "%d:%06.3f" % [m, (ms - m * 60000.0) / 1000.0]

## Gap with sign: +1.234 / -0.120.
static func fmt_gap(ms: float) -> String:
	return "%s%.3f" % ["+" if ms >= 0.0 else "-", absf(ms) / 1000.0]

static func fmt_clock(ms: float) -> String:
	var total := maxi(0, int(ms / 1000.0))
	return "%d:%02d" % [total / 60, total % 60]
