class_name MobileControls
extends RefCounted
## Choose your controls, the first time the phone layout opens (docs/prompts/mobile-f2p-pass.md 39; reference 038):
## the three ways the phone steers (TouchPrefs "steer": arrow buttons, a slider, tilting the phone) as pictures, the
## tilt card with a live bar of how the phone leans and an Invert switch, so the direction is right before the first
## race (the user, 2026-11-23: tilt steering went the wrong way). Saved as TouchPrefs "chosen"; Settings › Controls
## changes it later.

static func needed() -> bool:
	return UIKit.touch() and not bool(TouchPrefs.get_pref("chosen"))

## then: after CONTINUE; skip: a second way out ("Skip the first race"), or an empty Callable for none.
static func show(app: App, then: Callable, skip: Callable = Callable()) -> void:
	app.screen = "m_controls"
	var holder := Control.new()
	UIKit.full(holder)
	var _self := {}
	_self.render = func() -> void:
		for c in holder.get_children():
			c.queue_free()
		holder.add_child(_build(app, then, skip, _self.render))
	_self.render.call()
	app.set_ui(holder)

static func _build(app: App, then: Callable, skip: Callable, rerender: Callable) -> Control:
	var root := Control.new()
	UIKit.full(root)
	var shade := ColorRect.new()
	shade.color = Color(0.0, 0.01, 0.03, 0.75)
	UIKit.full(shade)
	root.add_child(shade)
	var col := UIW.vbox(14)
	col.alignment = BoxContainer.ALIGNMENT_CENTER
	var head := UIKit.label(I18n.t("Choose your control type").to_upper(), 34, UIKit.TEXT, true, 800)
	head.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(head)
	var sub := UIW.muted(I18n.t("You can change this later in Settings › Controls."), 16)
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(sub)
	var row := UIW.hbox(16)
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	var cur := str(TouchPrefs.get_pref("steer"))
	for m: Array in [["buttons", I18n.t("Arrow buttons"), I18n.t("Tap left and right")], ["slider", I18n.t("Slider"), I18n.t("Drag a thumb across")],
			["tilt", I18n.t("Tilt"), I18n.t("Lean the phone like a wheel")]]:
		var mode: String = m[0]
		var b := UIW.card_button(cur == mode, 8)
		b.custom_minimum_size = Vector2(300, 300)
		var c := UIW.vbox(8)
		c.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var pic := Picture.new()
		pic.mode = mode
		pic.on = cur == mode
		pic.custom_minimum_size = Vector2(0, 130)
		c.add_child(pic)
		c.add_child(UIKit.label(String(m[1]).to_upper(), 24, MobileUI.MAIN if cur == mode else UIKit.TEXT, true, 800))
		c.add_child(UIKit.label(m[2], 15, UIKit.SOFT, true, 600))
		if mode == "tilt" and cur == "tilt":
			var lean := Lean.new()
			lean.custom_minimum_size = Vector2(0, 26)
			c.add_child(lean)
			var inv := UIKit.button(I18n.t("Invert: on") if TouchPrefs.get_pref("tiltInvert") else I18n.t("Invert: off"), func() -> void:
				TouchPrefs.set_pref("tiltInvert", not bool(TouchPrefs.get_pref("tiltInvert")))
				rerender.call())
			inv.mouse_filter = Control.MOUSE_FILTER_STOP
			c.add_child(inv)
			var hint := UIW.muted(I18n.t("Lean the phone left: the dot should go left."), 13)
			hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			c.add_child(hint)
		b.get_node("content").add_child(UIW.margins(c, 14, 10, 14, 10))
		b.pressed.connect(func() -> void: TouchPrefs.set_pref("steer", mode); rerender.call())
		row.add_child(b)
	col.add_child(row)
	var go := MobileUI.main_button(I18n.t("Continue"), func() -> void:
		TouchPrefs.set_pref("chosen", true)
		then.call())
	go.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	col.add_child(go)
	if skip.is_valid():
		var sk := UIKit.button(I18n.t("Skip the first race"), func() -> void:
			TouchPrefs.set_pref("chosen", true)
			skip.call())
		sk.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
		col.add_child(sk)
	var cc := CenterContainer.new()
	UIKit.full(cc)
	cc.add_child(col)
	root.add_child(cc)
	go.grab_focus.call_deferred()
	return root

## A control type's picture: two arrow pads, a slider with its thumb, or a phone leaning.
class Picture:
	extends Control
	var mode := ""
	var on := false

	func _draw() -> void:
		var c := MobileUI.MAIN if on else UIKit.TEXT
		var s := size
		var mid := s * 0.5
		match mode:
			"buttons":
				for side: float in [-1.0, 1.0]:
					var x := mid.x + side * 56.0
					draw_rect(Rect2(Vector2(x - 40, mid.y - 34), Vector2(80, 68)), Color(c, 0.18))
					draw_rect(Rect2(Vector2(x - 40, mid.y - 34), Vector2(80, 68)), c, false, 2.0)
					var t := PackedVector2Array([Vector2(x - side * 12, mid.y - 18), Vector2(x + side * 16, mid.y), Vector2(x - side * 12, mid.y + 18)])
					draw_colored_polygon(t, c)
			"slider":
				draw_line(Vector2(mid.x - 110, mid.y), Vector2(mid.x + 110, mid.y), Color(c, 0.4), 8.0)
				draw_circle(Vector2(mid.x + 34, mid.y), 22.0, c)
			"tilt":
				draw_set_transform(mid, -0.3)
				draw_rect(Rect2(Vector2(-90, -42), Vector2(180, 84)), Color(c, 0.15))
				draw_rect(Rect2(Vector2(-90, -42), Vector2(180, 84)), c, false, 3.0)
				draw_arc(Vector2.ZERO, 26.0, 0, TAU, 24, c, 3.0)

## How the phone leans now, as the race's tilt steering will read it (the same sign and invert as TouchControls).
class Lean:
	extends Control
	var _v := 0.0

	func _process(_dt: float) -> void:
		var g := Input.get_accelerometer()
		if g == Vector3.ZERO:
			return
		var flipped := DisplayServer.screen_get_orientation() == DisplayServer.SCREEN_REVERSE_LANDSCAPE
		var lean := rad_to_deg(atan2(g.x if not flipped else -g.x, Vector2(g.y, g.z).length()))
		var v := clampf(lean / float(TouchPrefs.get_pref("tiltRange")), -1.0, 1.0) * (-1.0 if TouchPrefs.get_pref("tiltInvert") else 1.0)
		if absf(v - _v) > 0.01:
			_v = v
			queue_redraw()

	func _draw() -> void:
		var w := size.x
		var y := size.y * 0.5
		draw_line(Vector2(8, y), Vector2(w - 8, y), Color(1, 1, 1, 0.3), 4.0)
		# + steers left (TouchControls): the dot left of the middle
		draw_circle(Vector2(w * 0.5 - _v * (w * 0.5 - 14.0), y), 9.0, MobileUI.MAIN)
