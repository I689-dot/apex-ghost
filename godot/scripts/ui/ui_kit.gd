class_name UIKit
extends RefCounted
## The game's UI look (port of the design tokens in styles.css): colours, fonts (Barlow, Barlow Condensed), panel and
## button styles, and small builders used by every screen (the equivalent of the web client's ui/dom.ts h()).
## The menus follow Le Mans Ultimate's (DECISIONS.md "Godot: menu redesign"): translucent navy panels over the circuit
## photo, condensed capitals, hairline rows, outlined white buttons and one solid white action per screen.

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

# the menus' palette: navy glass over the photo, the crimson of the livery slash, white actions
const NAVY := Color(0.043, 0.067, 0.133, 0.84)
const NAVY_SOLID := Color("0b1222")
const NAVY_DEEP := Color("060a14")
const CRIMSON := Color("e8203a")
const SWITCH_ON := Color("2f7bf5")
const HAIR := Color(1, 1, 1, 0.13)
const DIM := Color(1, 1, 1, 0.42)
const SOFT := Color("b7bfcc")
const ROW_HI := Color(1, 1, 1, 0.1)
## Text on the white primary button.
const INK := Color("0b1222")
const CARD_RADIUS := 10

static var _fonts := {}
## The theme build_theme made: the menu layers' root controls carry it (a Window's theme does not reach the controls
## under a CanvasLayer).
static var theme: Theme = null

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

## The game's theme: navy glass panels, outlined condensed-capital buttons with a white focus ring for the pad and the
## keyboard (a mouse click does not show it), hairline inputs, thin white sliders, bars and scroll bars.
static func build_theme() -> Theme:
	var th := Theme.new()
	th.default_font = font(false, 500)
	th.default_font_size = 18 if touch() else 16
	th.set_color("font_color", "Label", TEXT)
	th.set_font("font", "Label", font(false, 500))
	# buttons: outlined (the screen's one main action is solid white: button(..., true))
	var pad := btn_pad()
	th.set_stylebox("normal", "Button", box(Color(0.02, 0.035, 0.08, 0.5), Color(1, 1, 1, 0.62), 1, 2, pad))
	th.set_stylebox("hover", "Button", box(Color(1, 1, 1, 0.14), Color.WHITE, 1, 2, pad))
	th.set_stylebox("pressed", "Button", box(Color(1, 1, 1, 0.26), Color.WHITE, 1, 2, pad))
	th.set_stylebox("hover_pressed", "Button", box(Color(1, 1, 1, 0.3), Color.WHITE, 1, 2, pad))
	th.set_stylebox("disabled", "Button", box(Color(0.02, 0.035, 0.08, 0.3), Color(1, 1, 1, 0.16), 1, 2, pad))
	th.set_stylebox("focus", "Button", focus_ring())
	th.set_font("font", "Button", font(true, 600))
	th.set_font_size("font_size", "Button", 20 if touch() else 18)
	th.set_color("font_color", "Button", TEXT)
	th.set_color("font_hover_color", "Button", Color.WHITE)
	th.set_color("font_pressed_color", "Button", Color.WHITE)
	th.set_color("font_focus_color", "Button", Color.WHITE)
	th.set_color("font_hover_pressed_color", "Button", Color.WHITE)
	th.set_color("font_disabled_color", "Button", Color(1, 1, 1, 0.32))
	# drop-downs look like the buttons, the list like a menu panel
	for st in ["normal", "hover", "pressed", "disabled"]:
		th.set_stylebox(st, "OptionButton", th.get_stylebox(st, "Button"))
	th.set_stylebox("focus", "OptionButton", focus_ring())
	th.set_font("font", "OptionButton", font(false, 600))
	th.set_color("font_color", "OptionButton", TEXT)
	th.set_stylebox("panel", "PopupMenu", box(NAVY_SOLID, Color(1, 1, 1, 0.22), 1, 4, Vector2(6, 6)))
	th.set_stylebox("hover", "PopupMenu", box(Color(1, 1, 1, 0.14), Color(0, 0, 0, 0), 0, 2))
	th.set_color("font_color", "PopupMenu", SOFT)
	th.set_color("font_hover_color", "PopupMenu", Color.WHITE)
	th.set_font("font", "PopupMenu", font(false, 600))
	th.set_font_size("font_size", "PopupMenu", 18 if touch() else 16)
	th.set_constant("v_separation", "PopupMenu", 14 if touch() else 8)
	# panels
	th.set_stylebox("panel", "PanelContainer", box(NAVY, HAIR, 1, 8, Vector2(16, 14)))
	th.set_stylebox("panel", "Panel", box(NAVY, HAIR, 1, 8))
	th.set_stylebox("panel", "TooltipPanel", box(NAVY_SOLID, Color(1, 1, 1, 0.25), 1, 4, Vector2(10, 6)))
	th.set_color("font_color", "TooltipLabel", TEXT)
	# inputs
	th.set_stylebox("normal", "LineEdit", box(Color(0.01, 0.02, 0.05, 0.6), Color(1, 1, 1, 0.3), 1, 2, Vector2(12, 9)))
	th.set_stylebox("focus", "LineEdit", box(Color(0, 0, 0, 0), Color.WHITE, 2, 2))
	th.set_stylebox("read_only", "LineEdit", box(Color(0.01, 0.02, 0.05, 0.3), Color(1, 1, 1, 0.12), 1, 2, Vector2(12, 9)))
	th.set_color("font_color", "LineEdit", TEXT)
	th.set_color("font_placeholder_color", "LineEdit", Color(1, 1, 1, 0.38))
	th.set_color("caret_color", "LineEdit", Color.WHITE)
	th.set_color("selection_color", "LineEdit", Color(CRIMSON, 0.5))
	# check boxes and switches keep the engine's icons with our colours (UIW.switch draws the menu's own)
	th.set_color("font_color", "CheckBox", TEXT)
	th.set_color("font_color", "CheckButton", TEXT)
	th.set_stylebox("focus", "CheckBox", focus_ring())
	th.set_stylebox("focus", "CheckButton", focus_ring())
	# sliders: a thin line, the filled part white, a round white grabber
	th.set_stylebox("slider", "HSlider", _line(Color(1, 1, 1, 0.2), 4))
	th.set_stylebox("grabber_area", "HSlider", _line(Color.WHITE, 4))
	th.set_stylebox("grabber_area_highlight", "HSlider", _line(Color.WHITE, 4))
	th.set_stylebox("focus", "HSlider", focus_ring())
	th.set_icon("grabber", "HSlider", _dot(9 if touch() else 7, Color.WHITE))
	th.set_icon("grabber_highlight", "HSlider", _dot(10 if touch() else 8, Color.WHITE))
	th.set_icon("grabber_disabled", "HSlider", _dot(7, Color(1, 1, 1, 0.35)))
	# bars
	th.set_stylebox("background", "ProgressBar", box(Color(1, 1, 1, 0.12), Color(0, 0, 0, 0), 0, 2))
	th.set_stylebox("fill", "ProgressBar", box(Color.WHITE, Color(0, 0, 0, 0), 0, 2))
	# thin scroll bars, as the references' white hairline
	for sb in ["VScrollBar", "HScrollBar"]:
		th.set_stylebox("scroll", sb, box(Color(1, 1, 1, 0.06), Color(0, 0, 0, 0), 0, 3, Vector2(2, 2)))
		th.set_stylebox("grabber", sb, box(Color(1, 1, 1, 0.5), Color(0, 0, 0, 0), 0, 3, Vector2(2, 2)))
		th.set_stylebox("grabber_highlight", sb, box(Color(1, 1, 1, 0.8), Color(0, 0, 0, 0), 0, 3, Vector2(2, 2)))
		th.set_stylebox("grabber_pressed", sb, box(Color.WHITE, Color(0, 0, 0, 0), 0, 3, Vector2(2, 2)))
	theme = th
	return th

## The ring the keyboard and the pad focus draw (a mouse click does not: gui/common/show_focus_state_on_pointer_event).
static func focus_ring(radius: int = 3) -> StyleBoxFlat:
	var s := box(Color(1, 1, 1, 0.06), Color.WHITE, 2, radius)
	s.set_expand_margin_all(3)
	return s

## A centred line of `h` px in a slider's height (the track and its filled part).
static func _line(c: Color, h: int) -> StyleBoxFlat:
	var s := box(c, Color(0, 0, 0, 0), 0, 2)
	s.content_margin_top = h * 0.5
	s.content_margin_bottom = h * 0.5
	return s

## A filled circle of radius r as a texture (the slider's grabber), anti-aliased, made once when the theme is built.
static func _dot(r: int, c: Color) -> Texture2D:
	var n := r * 2 + 2
	var img := Image.create(n, n, false, Image.FORMAT_RGBA8)
	var mid := n * 0.5
	for y in n:
		for x in n:
			var d := Vector2(x + 0.5 - mid, y + 0.5 - mid).length()
			img.set_pixel(x, y, Color(c, c.a * clampf(r + 0.5 - d, 0.0, 1.0)))
	return ImageTexture.create_from_image(img)

## A Label with the display (condensed) or body font.
static func label(text: String, size: int = 16, color: Color = TEXT, display: bool = false, weight: int = 500) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", font(display, weight))
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l

## A styled button: outlined, or solid white with navy text for the screen's main action (`primary`). Focusable, so the
## pad and the keyboard can reach it (the ring shows only for them).
static func button(text: String, cb: Callable = Callable(), primary: bool = false) -> Button:
	var b := Button.new()
	b.text = text.to_upper()
	b.focus_mode = Control.FOCUS_ALL
	# set on the button itself: the theme's Button font does not reach the controls under the CanvasLayers
	b.add_theme_font_override("font", font(true, 600))
	if primary:
		set_primary(b)
	if cb.is_valid():
		b.pressed.connect(cb)
	return b

## Gives a button the main action's look: solid white, navy capitals.
static func set_primary(b: Button) -> void:
	var p := btn_pad() + Vector2(4, 1)
	b.add_theme_stylebox_override("normal", box(Color("f2f4f7"), Color("f2f4f7"), 1, 2, p))
	b.add_theme_stylebox_override("hover", box(Color.WHITE, Color.WHITE, 1, 2, p))
	b.add_theme_stylebox_override("pressed", box(Color("c9d0dc"), Color("c9d0dc"), 1, 2, p))
	b.add_theme_stylebox_override("hover_pressed", box(Color("c9d0dc"), Color("c9d0dc"), 1, 2, p))
	b.add_theme_stylebox_override("disabled", box(Color(1, 1, 1, 0.16), Color(1, 1, 1, 0.16), 1, 2, p))
	for k in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		b.add_theme_color_override(k, INK)
	b.add_theme_color_override("font_disabled_color", Color(1, 1, 1, 0.4))

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
