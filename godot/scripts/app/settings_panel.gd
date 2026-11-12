class_name SettingsPanel
extends RefCounted
## Settings (port of ui/settingsPanel.ts, reorganised after iRacing's options and laid out as Le Mans Ultimate's):
## four top tabs (Graphics, Gameplay, Audio, Controls) with their pages as sub-tabs (Quality, Display, View; Driving,
## Interface; Keyboard / Touch, Controller), each page in big titled sections of hairline rows with ‹ value › steppers,
## switches and sliders, and the help for the row under the pointer or the pad on the right. Every change is saved and
## `on_change` called after it.

const ACTION_LABEL := {
	"throttle": "Throttle", "brake": "Brake / reverse", "steerLeft": "Steer left", "steerRight": "Steer right", "handbrake": "Handbrake",
	"shiftUp": "Shift up", "shiftDown": "Shift down", "resetCar": "Reset to track", "toggleGearbox": "Manual / automatic",
	"lookLeft": "Look left", "lookRight": "Look right", "lookBack": "Look back", "timing": "Timing screen (hold)", "pause": "Pause menu",
	"camera": "Change camera", "damage": "Damage report (hold)", "tvCamera": "TV cameras",
	"deltaMode": "Delta reference (best / optimal / sectors)",
	"brakeBiasUp": "Brake bias forward", "brakeBiasDown": "Brake bias rearward", "tcCycle": "Traction control level", "absToggle": "ABS on / off", "chat": "Text chat", "replay": "Replay",
}
## The graphics page's detail groups by section (a group takes its settings from the preset picked for it).
const SECTIONS := [
	["World detail", [
		["viewDistance", "View distance", "How far buildings, barriers and detailed cars are drawn"],
		["trees", "Trees", "Forest density and distance"], ["grass", "Grass", "The 3D lawn and grass blades on the verges"],
		["crowd", "Spectators", "People on the grandstands"], ["clouds", "Sky and clouds", "Flat, lit, or with deep self-shadowing"],
	]],
	["Shadows and lighting", [
		["shadows", "Shadows", "Shadow sharpness and how far they reach"], ["ao", "Ambient occlusion", "Soft contact shadows in corners and under cars"],
	]],
	["Image quality", [["textures", "Textures and reflections", "Texture filtering at grazing angles, reflections"]]],
	["Post-processing", [["effects", "Effects", "Bloom, colour grade and rain"]]],
	["Your car", [["cockpit", "Cockpit detail", "The full interior model in the cockpit view"], ["mirrors", "Mirror updates", "Low: the mirrors redraw every other frame"]]],
	["Other cars", [["carDetail", "Car detail distance", "How far other cars keep their detailed model"]]],
]
const PRESET_NOTE := {
	"low": "Low: no shadows or post-processing, short view distance. For integrated graphics and phones.",
	"medium": "Medium: shadows, bloom and grass at a moderate distance. A good default for phones.",
	"high": "High: sharper shadows, ambient occlusion and a long view distance.",
	"ultra": "Ultra: the best picture the game can make, with no regard to performance.",
}

static var _tab := "graphics"
## Old page names (a player's last page) and their new ones.
const RENAMED := {"general": "interface", "camera": "view", "sound": "audio"}
## The pages under the four top tabs (Le Mans Ultimate's Gameplay / Controls / Graphics / Sound with sub-tabs).
const GROUPS := [["graphics", "Graphics", ["graphics", "display", "view"]], ["gameplay", "Gameplay", ["driving", "interface"]], ["audio", "Audio", ["audio"]], ["controls", "Controls", ["controls", "controller"]]]
## The help column: the row under the pointer or the pad's focus explains itself there (a phone shows the help in the rows).
static var _help_title: Label = null
static var _help_text: Label = null
static var _inline_hints := true

static func _pct(v: float) -> String:
	return "%d %%" % roundi(v * 100.0)

static func _group_of(page: String) -> Array:
	for g in GROUPS:
		if (g[2] as Array).has(page):
			return g
	return GROUPS[0]

## The settings, over whatever is on screen (menu, lobby or the pause menu): a page of its own with the top bar, the
## rows in the middle and the help on the right. Closes with Done, ‹, Esc or the pad's B.
static func build(app: App, on_change: Callable) -> Control:
	var touch := UIKit.touch()
	var vp := app.get_viewport().get_visible_rect().size
	var wide := not touch and vp.x >= 1180.0
	_inline_hints = not wide
	var root := Control.new()
	UIKit.full(root)
	root.theme = UIKit.theme
	root.set_meta("modal", true)
	var dim := ColorRect.new()
	dim.color = Color(0.012, 0.02, 0.05, 0.97)
	UIKit.full(dim)
	root.add_child(dim)
	var decor := MenuDecor.new()
	UIKit.full(decor)
	root.add_child(decor)
	var close := func():
		_help_title = null
		_help_text = null
		root.queue_free()
	root.set_meta("close", close)
	var changed := func():
		Settings.save()
		on_change.call()
	var is_touch := DisplayServer.is_touchscreen_available()
	var page_label := {
		"graphics": I18n.t("Quality"), "display": I18n.t("Display"), "view": I18n.t("View"), "driving": I18n.t("Driving"), "interface": I18n.t("Interface"),
		"audio": I18n.t("Audio"), "controls": I18n.t("Touch") if is_touch else I18n.t("Keyboard"), "controller": I18n.t("Controller"),
	}
	var holder := MarginContainer.new()
	holder.size_flags_vertical = Control.SIZE_EXPAND_FILL
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var sub_row := CenterContainer.new()
	sub_row.custom_minimum_size = Vector2(0, 42 if touch else 46)
	var help_col := UIW.vbox(10)
	help_col.custom_minimum_size = Vector2(300, 0)
	help_col.visible = wide
	_help_title = UIKit.label("", 26, UIKit.DIM, true, 600)
	_help_title.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_help_text = UIKit.label("", 15, UIKit.SOFT)
	_help_text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	help_col.add_child(_help_title)
	var help_box := PanelContainer.new()
	help_box.add_theme_stylebox_override("panel", UIKit.box(Color(1, 1, 1, 0.05), Color(1, 1, 1, 0.16), 1, 2, Vector2(14, 12)))
	help_box.add_child(_help_text)
	help_col.add_child(help_box)
	var devices := UIW.vbox(2)
	help_col.add_child(UIW.spacer())
	help_col.add_child(devices)
	# the bar is made after the page switcher: the switcher finds its tab row through this dictionary
	var bar := {}
	var show := Callable()
	show = func(key: String):
		_tab = key
		var grp := _group_of(key)
		for b in (bar.tabs.get_children() if bar.has("tabs") and bar.tabs != null else []):
			b.set_active(b.get_meta("key") == grp[0])
		for c in sub_row.get_children():
			c.queue_free()
		if (grp[2] as Array).size() > 1:
			sub_row.add_child(UIW.tabs((grp[2] as Array).map(func(k): return [k, page_label[k]]), key, func(k): show.call(k), true))
		for c in holder.get_children():
			c.queue_free()
		_help_title.text = String(page_label[key]).to_upper()
		_help_text.text = I18n.t("Point at a setting, or move to it with the pad, to see what it does.")
		for c in devices.get_children():
			c.queue_free()
		if key == "controls" or key == "controller":
			devices.add_child(UIKit.label(I18n.t("Detected devices").to_upper(), 22, UIKit.DIM, true, 600))
			var pads := Input.get_connected_joypads()
			if pads.is_empty():
				devices.add_child(UIKit.label(I18n.t("No controller connected"), 14, UIKit.SOFT))
			for d in pads:
				devices.add_child(UIKit.label(Input.get_joy_name(d), 14, UIKit.SOFT))
		var col := UIW.vbox(0)
		match key:
			"graphics":
				_graphics(col, changed, show)
			"display":
				_display(col, changed)
			"view":
				_view(col, changed)
			"driving":
				_driving(col, changed)
			"interface":
				_interface(col, changed)
			"audio":
				_sound(col, changed)
			"controls":
				if is_touch:
					_touch(col)
				else:
					_controls(col, changed, show)
			"controller":
				_controller(col, changed, app)
		col.add_child(UIW.spacer(false))
		var sc := UIW.scroll(UIW.margins(col, 0, 0, 14, 12))
		holder.add_child(sc)
	var on_group := func(g: String):
		for grp in GROUPS:
			if grp[0] == g:
				show.call(grp[2][0])
				UIW.focus_first.call_deferred(holder)
	var top := UIW.top_bar({
		"title": I18n.t("Settings"), "back": close,
		"tabs": GROUPS.map(func(g): return [g[0], I18n.t(g[1])]), "tab": "", "on_tab": on_group, "tabs_left": touch,
	})
	# the tab row is the bar's own: found once to light the current group
	bar.tabs = _find_tabs(top)
	var body := UIW.hbox(36)
	var mid := UIW.vbox(0)
	mid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	mid.size_flags_stretch_ratio = 2.6
	mid.add_child(holder)
	body.add_child(mid)
	help_col.size_flags_stretch_ratio = 1.0
	help_col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.add_child(help_col)
	var col := UIW.vbox(0)
	col.add_child(top)
	col.add_child(sub_row)
	var done := UIW.action(I18n.t("Done"), close, true)
	var scr := UIW.screen(col, body, UIW.action_bar(null, [done]))
	UIKit.full(scr)
	root.add_child(scr)
	var start: String = RENAMED.get(_tab, _tab)
	var ok := false
	for g in GROUPS:
		if (g[2] as Array).has(start):
			ok = true
	show.call(start if ok else "graphics")
	app.overlay_layer.add_child(root)
	root.modulate.a = 0.0
	root.create_tween().tween_property(root, "modulate:a", 1.0, 0.15)
	UIW.focus_first.call_deferred(holder)
	return root

static func _find_tabs(n: Node) -> HBoxContainer:
	for c in n.get_children():
		if c is HBoxContainer and c.get_child_count() > 0 and c.get_child(0) is UIW.TabButton:
			return c
		var r := _find_tabs(c)
		if r != null:
			return r
	return null

# --------------------------------------------------------------- row kinds ---

## A row: the label on the left, the control on the right, a hairline under it; the pointer or the focus lights it and
## puts its help in the help column (or under the label on a phone).
static func _row(label: String, ctrl: Control, hint: String = "") -> Control:
	var touch := UIKit.touch()
	var p := PanelContainer.new()
	var normal := UIKit.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 0, Vector2(10, 6 if touch else 4))
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
	if hint != "" and _inline_hints:
		left.add_child(UIW.muted(hint, 13))
	r.add_child(left)
	ctrl.size_flags_horizontal = Control.SIZE_SHRINK_END
	ctrl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	r.add_child(ctrl)
	p.add_child(r)
	var on := func():
		p.add_theme_stylebox_override("panel", lit)
		if _help_title != null and is_instance_valid(_help_title):
			_help_title.text = label.to_upper()
			_help_text.text = hint if hint != "" else I18n.t("Point at a setting, or move to it with the pad, to see what it does.")
	var off := func():
		if not p.is_inside_tree():
			return
		var f := p.get_viewport().gui_get_focus_owner()
		var focused := f != null and p.is_ancestor_of(f)
		if not focused and not p.get_global_rect().has_point(p.get_global_mouse_position()):
			p.add_theme_stylebox_override("panel", normal)
	p.mouse_entered.connect(on)
	p.mouse_exited.connect(off)
	for c in _focusables(ctrl):
		c.focus_entered.connect(on)
		c.focus_exited.connect(off)
	return p

static func _focusables(c: Control) -> Array:
	var out: Array = []
	if c.focus_mode != Control.FOCUS_NONE:
		out.append(c)
	for ch in c.get_children():
		if ch is Control:
			out.append_array(_focusables(ch))
	return out

static func _toggle(col: Control, label: String, hint: String, d: Dictionary, key: String, changed: Callable) -> void:
	var sw := UIW.switch(d[key], func(v): d[key] = v; changed.call())
	col.add_child(_row(label, sw, hint))

static func _range(col: Control, label: String, hint: String, d: Dictionary, key: String, lo: float, hi: float, step: float, fmt: Callable, changed: Callable) -> void:
	var out := UIKit.label(fmt.call(d[key]), 16, UIKit.TEXT, false, 600)
	out.custom_minimum_size = Vector2(76, 0)
	out.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	var s := UIW.slider(d[key], lo, hi, step, func(v): d[key] = v; out.text = fmt.call(v); changed.call())
	s.custom_minimum_size = Vector2(240, 30)
	var box := UIW.hbox(10)
	box.add_child(s)
	box.add_child(out)
	col.add_child(_row(label, box, hint))

static func _select(col: Control, label: String, hint: String, d: Dictionary, key: String, options: Array, changed: Callable, cast: Callable = Callable()) -> void:
	var cur = d[key]
	var o := UIW.stepper(str(cur), options, func(v): d[key] = cast.call(v) if cast.is_valid() else v; changed.call())
	col.add_child(_row(label, o, hint))

## A section's heading (a gap above all but the first).
static func _head(col: Control, text: String) -> void:
	if col.get_child_count() > 0:
		var gap := Control.new()
		gap.custom_minimum_size = Vector2(0, 22)
		col.add_child(gap)
	col.add_child(UIW.section(text))

## Buttons under a section, on the left.
static func _buttons(col: Control, buttons: Array) -> void:
	var row := UIW.hbox(8)
	for b in buttons:
		row.add_child(b)
	col.add_child(UIW.margins(row, 0, 10, 0, 4))

# ------------------------------------------------------------------- tabs ---

static func _levels() -> Array:
	return [["", I18n.t("Preset")], ["low", I18n.t("Low")], ["medium", I18n.t("Medium")], ["high", I18n.t("High")], ["ultra", I18n.t("Ultra")]]

## A graphics override row: "Preset" follows the preset; any other level takes that preset's values for the group.
static func _override(col: Control, label: String, hint: String, key: String, options: Array, cast: Callable, changed: Callable) -> void:
	var g: Dictionary = Settings.data.graphics
	col.add_child(_row(label, UIW.stepper(str(g.get(key, "")), options, func(v):
		if v == "":
			g.erase(key)
		else:
			g[key] = cast.call(v) if cast.is_valid() else v
		changed.call()), hint))

static func _graphics(col: Control, changed: Callable, show: Callable) -> void:
	var S: Dictionary = Settings.data
	_head(col, I18n.t("Presets"))
	var note := UIW.muted("", 13)
	var refresh := func():
		var n := (S.graphics as Dictionary).size()
		note.text = I18n.t(PRESET_NOTE[S.quality]) + ("" if n == 0 else "\n" + I18n.t("Custom: {n} settings differ from the preset.", {"n": n}))
	var on_change := func():
		changed.call()
		refresh.call()
	_select(col, I18n.t("Quality preset"), "", S, "quality", [["low", I18n.t("Low")], ["medium", I18n.t("Medium")], ["high", I18n.t("High")], ["ultra", I18n.t("Ultra")]], func():
		S.graphics = {}
		S.qualityAuto = false
		changed.call()
		show.call("graphics"))
	col.add_child(UIW.margins(note, 10, 8, 10, 0))
	refresh.call()
	_buttons(col, [UIKit.button(I18n.t("Back to the preset"), func():
		S.graphics = {}
		changed.call()
		show.call("graphics")), UIKit.button(I18n.t("Detect for this device"), func():
		S.quality = Settings.detect_quality()
		S.graphics = {}
		changed.call()
		show.call("graphics"))])
	for sec in SECTIONS:
		_head(col, I18n.t(sec[0]))
		for grp in sec[1]:
			_override(col, I18n.t(grp[1]), I18n.t(grp[2]), grp[0], _levels(), Callable(), on_change)
		if sec[0] == "Image quality":
			_override(col, I18n.t("Anti-aliasing"), I18n.t("TAA smooths jagged distant edges, fences and shimmering textures best"), "antialias",
				[["", I18n.t("Preset")], ["native", I18n.t("MSAA (fast)")], ["msaa", I18n.t("MSAA 4×")], ["smaa", I18n.t("SMAA")], ["taa", I18n.t("TAA (smoothest)")]], Callable(), on_change)
			_override(col, I18n.t("Supersampling"), I18n.t("Renders above your screen resolution and scales down: the sharpest, cleanest picture, at a big cost"), "superSample",
				[["", I18n.t("Preset")], ["1", I18n.t("Off")], ["1.25", "1.25×"], ["1.5", "1.5×"], ["2", I18n.t("2× (4 × the pixels)")]], func(v): return float(v), on_change)
		if sec[0] == "Your car":
			_toggle(col, I18n.t("Rear-view mirror"), I18n.t("What is behind you, at the top of the screen"), S, "mirror", changed)

static func _display(col: Control, changed: Callable) -> void:
	var S: Dictionary = Settings.data
	var d: Dictionary = S.display
	var hz := roundi(DisplayServer.screen_get_refresh_rate())
	if not OS.has_feature("mobile"):
		_head(col, I18n.t("Window"))
		_select(col, I18n.t("Window mode"), "", d, "windowMode", [["windowed", I18n.t("Windowed")], ["borderless", I18n.t("Borderless full screen")], ["fullscreen", I18n.t("Exclusive full screen")]], changed)
		_toggle(col, I18n.t("Vertical sync"), I18n.t("No tearing; the frame rate stays at most the display's refresh rate"), d, "vsync", changed)
	_head(col, I18n.t("Frame rate"))
	var caps: Array = [["0", I18n.t("No limit")]]
	for r in [30, 45, 60, 90, 120, 144, 165, 240]:
		if r <= maxi(hz, 60) + 2 or r == 30:
			caps.append([str(r), "%d fps" % r])
	_select(col, I18n.t("Frame rate limit"), I18n.t("Lower: cooler and quieter, longer on a battery"), d, "maxFps", caps, changed, func(v): return int(v))
	var rates: Array = [[str(45), "45 fps"], [str(60), "60 fps"]]
	for r in [90, 120, 144]:
		if hz >= r - 2:
			rates.append([str(r), "%d fps" % r])
	_toggle(col, I18n.t("Dynamic resolution"), I18n.t("Lowers the resolution for a moment when the frame rate falls under the target"), S, "dynamicResolution", changed)
	_select(col, I18n.t("Dynamic resolution target"), "", S, "refreshRate", rates, changed, func(v): return int(v))
	_head(col, I18n.t("Resolution"))
	_range(col, I18n.t("Resolution scale"), I18n.t("The 3D picture's resolution against the screen's (the HUD stays sharp)"), S, "resolutionScale", 0.5, 1.0, 0.05, _pct, changed)
	_select(col, I18n.t("Upscaling"), I18n.t("How a picture under 100 % is brought to the screen: FSR keeps it sharper"), d, "upscaler", Graphics.upscalers().map(func(o): return [o[0], I18n.t(o[1])]), changed)
	_head(col, I18n.t("Picture"))
	_range(col, I18n.t("Brightness"), "", S, "brightness", 0.6, 1.5, 0.05, _pct, changed)
	_range(col, I18n.t("Contrast"), "", d, "contrast", 0.8, 1.25, 0.01, _pct, changed)
	_range(col, I18n.t("Colour saturation"), "", d, "saturation", 0.6, 1.4, 0.01, _pct, changed)

static func _view(col: Control, changed: Callable) -> void:
	var S: Dictionary = Settings.data
	_head(col, I18n.t("Camera"))
	_select(col, I18n.t("Pit stop camera"), "", S, "pitCamera", [["tv", I18n.t("TV camera on the crew")], ["car", I18n.t("Stay in the car")]], changed)
	_range(col, I18n.t("Head movement"), I18n.t("The head thrown by braking, acceleration and corners"), S, "headMovement", 0.0, 1.0, 0.05, _pct, changed)
	_range(col, I18n.t("Camera shake"), I18n.t("Kerbs, bumps and a flat-spotted tyre"), S, "cameraShake", 0.0, 1.0, 0.05, _pct, changed)
	_range(col, I18n.t("Look to apex"), I18n.t("The cockpit view turns into corners with the steering"), S, "lookToApex", 0.0, 2.0, 0.1, _pct, changed)
	_head(col, I18n.t("Field of view"))
	_range(col, I18n.t("Field of view"), I18n.t("Vertical, as iRacing and ACC count it: lower is more realistic on a desk monitor"), S, "fov", 25, 95, 1, func(v): return "%d°" % int(v), changed)
	# the calculator: the vertical angle the screen really covers from the eyes (16:9 assumed from its width)
	var sc: Dictionary = S.screen
	var result := UIW.muted("", 13)
	var calc := func() -> float:
		var aspect := maxf(1.0, float(DisplayServer.window_get_size().x) / maxf(1.0, float(DisplayServer.window_get_size().y)))
		var h := float(sc.widthCm) / aspect
		return rad_to_deg(2.0 * atan(h / 2.0 / maxf(1.0, float(sc.distanceCm))))
	var upd := func():
		result.text = I18n.t("Your screen covers {v}° of your view vertically.", {"v": "%.0f" % calc.call()})
	var cm := func(v): return "%d cm" % int(v)
	_range(col, I18n.t("Screen width"), I18n.t("The picture's visible width"), sc, "widthCm", 20, 200, 1, cm, func(): changed.call(); upd.call())
	_range(col, I18n.t("Eyes to screen"), "", sc, "distanceCm", 30, 200, 1, cm, func(): changed.call(); upd.call())
	col.add_child(UIW.margins(result, 10, 8, 10, 0))
	upd.call()
	_buttons(col, [UIKit.button(I18n.t("Use this field of view"), func():
		S.fov = clampf(roundf(calc.call()), 25.0, 95.0)
		changed.call()
		result.text = I18n.t("Field of view set to {v}°.", {"v": "%d" % int(S.fov)}))])
	_head(col, I18n.t("Seat"))
	_range(col, I18n.t("Seat height"), I18n.t("Raise the cockpit camera to see more road"), S, "seatHeight", -0.1, 0.2, 0.01, func(v): return "%s%d cm" % ["+" if v >= 0 else "", roundi(v * 100)], changed)
	_range(col, I18n.t("Seat position"), I18n.t("Forward / back"), S, "seatForward", -0.25, 0.25, 0.01, func(v): return "%s%d cm" % ["+" if v >= 0 else "", roundi(v * 100)], changed)
	_head(col, I18n.t("Chase camera"))
	_range(col, I18n.t("Distance"), "", S.chase, "distance", 0.7, 1.6, 0.05, _pct, changed)
	_range(col, I18n.t("Height"), "", S.chase, "height", 0.5, 2.0, 0.05, _pct, changed)
	_range(col, I18n.t("Camera lag"), I18n.t("More: the car turns more in the frame before the camera follows"), S.chase, "lag", 0.3, 2.5, 0.05, _pct, changed)

static func _driving(col: Control, changed: Callable) -> void:
	var S: Dictionary = Settings.data
	_head(col, I18n.t("Assists"))
	_toggle(col, I18n.t("ABS"), "", S.assists, "abs", changed)
	_select(col, I18n.t("Traction control"), "", S.assists, "tc", [["0", I18n.t("Off")], ["1", I18n.t("Low")], ["2", I18n.t("High")]], changed, func(v): return int(v))
	_toggle(col, I18n.t("Stability control"), "", S.assists, "stability", changed)
	_toggle(col, I18n.t("Steering assist"), I18n.t("Automatic counter-steer"), S.assists, "steering", changed)
	_toggle(col, I18n.t("Manual gearbox"), "", S, "manualGearbox", changed)
	_head(col, I18n.t("Aids"))
	_select(col, I18n.t("Racing line"), I18n.t("Red: brake · yellow: lift · green: throttle"), S, "racingLine", [["off", I18n.t("Off")], ["corners", I18n.t("Braking zones")], ["full", I18n.t("Full lap")]], changed)
	_toggle(col, I18n.t("Best-lap ghost"), I18n.t("Your best valid lap replayed as a ghost car"), S, "ghost", changed)
	_head(col, I18n.t("Opponents"))
	_range(col, I18n.t("AI difficulty"), I18n.t("Their pace in the races you play solo or host (from the next session)"), S.ai, "difficulty", 0.8, 1.06, 0.01, _pct, changed)

static func _interface(col: Control, changed: Callable) -> void:
	var S: Dictionary = Settings.data
	_head(col, I18n.t("Language"))
	col.add_child(_row("Language / Idioma", UIW.stepper(S.language, I18n.LANGUAGES, func(v):
		S.language = v
		I18n.set_lang(v)
		changed.call())))
	_head(col, I18n.t("On-screen displays"))
	_select(col, I18n.t("Speed units"), "", S, "units", [["kmh", "km/h"], ["mph", "mph"]], changed)
	_toggle(col, I18n.t("Performance overlay"), I18n.t("Frame time, network and draw calls in a corner"), S, "showPerf", changed)
	_toggle(col, I18n.t("Opening titles"), I18n.t("The studio cinematic when the game starts"), S, "introCinematic", changed)
	_head(col, I18n.t("HUD"))
	var h: Dictionary = S.hud
	_range(col, I18n.t("HUD size"), "", h, "scale", 0.7, 1.4, 0.05, _pct, changed)
	_range(col, I18n.t("HUD opacity"), "", h, "opacity", 0.3, 1.0, 0.05, _pct, changed)
	_toggle(col, I18n.t("Timing tower"), "", h, "timing", changed)
	_toggle(col, I18n.t("Lap and position"), I18n.t("Lap, position and the lap times"), h, "lapInfo", changed)
	_toggle(col, I18n.t("Tyres and damage"), "", h, "tyres", changed)
	_toggle(col, I18n.t("Shift lights"), "", h, "revLights", changed)
	_toggle(col, I18n.t("On-screen messages"), I18n.t("Flags, penalties and lap messages"), h, "messages", changed)
	_toggle(col, I18n.t("Track map"), "", h, "map", changed)
	_head(col, I18n.t("Race overlays"))
	var o: Dictionary = S.overlays
	_toggle(col, I18n.t("Relative"), I18n.t("The cars just ahead and behind on the road, with the time to each"), o, "relative", changed)
	_toggle(col, I18n.t("Delta bar"), I18n.t("Gaining or losing against your best lap, as a bar"), o, "deltaBar", changed)
	_toggle(col, I18n.t("Inputs"), I18n.t("Throttle, brake and steering"), o, "inputs", changed)
	_toggle(col, I18n.t("Circuit map"), I18n.t("The whole circuit with numbered corners and cars (off: the map turning with you)"), o, "trackMap", changed)
	_toggle(col, I18n.t("Spotter"), I18n.t("Marks the side of the screen when a car is alongside"), o, "spotter", changed)

static func _sound(col: Control, changed: Callable) -> void:
	var A: Dictionary = Settings.data.audio
	_head(col, I18n.t("Main audio levels"))
	_range(col, I18n.t("Master volume"), "", A, "master", 0.0, 1.0, 0.05, _pct, changed)
	_range(col, I18n.t("Engines"), I18n.t("Your car and the cars around you"), A, "engine", 0.0, 1.0, 0.05, _pct, changed)
	_range(col, I18n.t("Effects"), I18n.t("Tyres, kerbs, wind, impacts, beeps"), A, "effects", 0.0, 1.0, 0.05, _pct, changed)
	_range(col, I18n.t("Ambience"), I18n.t("Crowd, birds, wind in the trees, thunder"), A, "ambience", 0.0, 1.0, 0.05, _pct, changed)
	_head(col, I18n.t("Mix"))
	_range(col, I18n.t("Opponents"), I18n.t("The other cars' engines"), A, "opponents", 0.0, 1.0, 0.05, _pct, changed)
	_range(col, I18n.t("Tyres and surfaces"), I18n.t("Squeal, kerbs, gravel, grass, scrapes"), A, "tyres", 0.0, 1.0, 0.05, _pct, changed)
	_toggle(col, I18n.t("Chimes and beeps"), I18n.t("Lap chimes and the start beeps"), A, "chimes", changed)

static func _key_name(code: String) -> String:
	var names := {"Space": "Space", "ShiftLeft": "L-Shift", "ShiftRight": "R-Shift", "ControlLeft": "L-Ctrl", "ControlRight": "R-Ctrl", "Escape": "Esc", "ArrowUp": "↑", "ArrowDown": "↓", "ArrowLeft": "←", "ArrowRight": "→"}
	if names.has(code):
		return names[code]
	return code.trim_prefix("Key").trim_prefix("Digit")

static func _controls(col: Control, changed: Callable, show: Callable) -> void:
	var S: Dictionary = Settings.data
	_head(col, I18n.t("Controls"))
	col.add_child(UIW.margins(UIW.muted(I18n.t("Click a key, then press the new one. Two keys per action.")), 10, 8, 10, 6))
	for a in ACTION_LABEL:
		var keys := UIW.hbox(6)
		var codes: Array = S.bindings[a]
		for idx in codes.size():
			keys.add_child(_key_button(a, idx, _key_name(codes[idx]), S, changed, show))
		if codes.size() < 2:
			keys.add_child(_key_button(a, codes.size(), "+", S, changed, show))
		col.add_child(_row(I18n.t(ACTION_LABEL[a]), keys))
	_buttons(col, [UIKit.button(I18n.t("Reset keys"), func():
		S.bindings = Settings.DEFAULT_BINDINGS.duplicate(true)
		changed.call()
		show.call("controls"))])

static func _key_button(action: String, idx: int, text: String, S: Dictionary, changed: Callable, show: Callable) -> Button:
	var b := UIKit.button(text)
	b.custom_minimum_size = Vector2(78, 0)
	b.pressed.connect(func():
		b.text = "…"
		var listener := KeyCapture.new()
		b.add_child(listener)
		listener.captured.connect(func(code: String):
			listener.queue_free()
			if code != "":
				for other in S.bindings:
					S.bindings[other] = S.bindings[other].filter(func(k): return k != code)
				var list: Array = S.bindings[action].duplicate()
				if idx < list.size():
					list[idx] = code
				else:
					list.append(code)
				S.bindings[action] = list.filter(func(k): return k != "")
			changed.call()
			show.call("controls")))
	return b

## Waits for one key press (Esc clears the slot).
class KeyCapture:
	extends Node
	signal captured(code: String)
	func _input(e: InputEvent) -> void:
		if e is InputEventKey and e.pressed and not e.echo:
			get_viewport().set_input_as_handled()
			captured.emit("" if e.physical_keycode == KEY_ESCAPE else KeyMap.code_of(e.physical_keycode))

static func _touch(col: Control) -> void:
	_head(col, I18n.t("Touch"))
	var steer: Dictionary = {"steer": TouchPrefs.get_pref("steer")}
	col.add_child(_row(I18n.t("Steering"), UIW.stepper(steer.steer, [["buttons", I18n.t("Arrow buttons")], ["slider", I18n.t("Slider")], ["tilt", I18n.t("Tilt the phone")]], func(v): TouchPrefs.set_pref("steer", v))))
	var tr := {"v": TouchPrefs.get_pref("tiltRange")}
	var out := UIKit.label("%d°" % int(tr.v), 15, UIKit.MUTED)
	var s := UIW.slider(tr.v, 10, 50, 1, func(v): TouchPrefs.set_pref("tiltRange", v); out.text = "%d°" % int(v))
	var r := UIW.hbox(8)
	r.add_child(s)
	r.add_child(out)
	col.add_child(_row(I18n.t("Tilt range"), r, I18n.t("Tilt angle that gives full steering")))
	var inv := UIW.switch(TouchPrefs.get_pref("tiltInvert"), func(v): TouchPrefs.set_pref("tiltInvert", v))
	col.add_child(_row(I18n.t("Invert tilt"), inv, I18n.t("Swap the tilt direction")))
	var sz := UIW.slider(TouchPrefs.get_pref("size"), 0.8, 1.3, 0.05, func(v): TouchPrefs.set_pref("size", v))
	col.add_child(_row(I18n.t("Pedal size"), sz))
	var op := UIW.slider(TouchPrefs.get_pref("opacity"), 0.25, 1.0, 0.05, func(v): TouchPrefs.set_pref("opacity", v))
	col.add_child(_row(I18n.t("Controls opacity"), op))
	var hp := UIW.switch(TouchPrefs.get_pref("haptics"), func(v): TouchPrefs.set_pref("haptics", v))
	col.add_child(_row(I18n.t("Vibration"), hp, I18n.t("Short vibration on gear shifts and button presses")))

static func _controller(col: Control, changed: Callable, app: App = null) -> void:
	var S: Dictionary = Settings.data
	_head(col, I18n.t("Controller"))
	if app != null and app.gamepad != null:
		col.add_child(UIW.margins(PadSetup.new(app.gamepad), 10, 8, 10, 4))
	_head(col, I18n.t("Steering wheel"))
	col.add_child(UIW.margins(UIW.muted(I18n.t("Logitech, Thrustmaster, Fanatec, Moza, Simucube and Simagic wheels are recognised. Set the wheel to 900° in its own software and the same here: each car then turns as its real lock allows."), 13), 10, 8, 10, 6))
	_select(col, I18n.t("Device"), "", S.wheel, "mode", [["auto", I18n.t("Recognise wheels automatically")], ["wheel", I18n.t("Always a steering wheel")], ["pad", I18n.t("Always a gamepad")]], changed)
	_range(col, I18n.t("Wheel rotation"), I18n.t("Lock to lock, as set on the wheel base: the car's own lock is used within it"), S.wheel, "rotationDeg", 180, 1080, 10, func(v): return "%d°" % int(v), changed)
	_range(col, I18n.t("Brake pedal curve"), I18n.t("1 = linear; higher = more travel near the locking point (load-cell pedals: about 1)"), S.wheel, "brakeCurve", 0.6, 2.4, 0.1, func(v): return "%.1f" % v, changed)
	_head(col, I18n.t("Gamepad"))
	var p: Dictionary = S.pad
	_range(col, I18n.t("Steering curve"), I18n.t("Higher = finer near the centre, same full lock"), p, "steerCurve", 1.0, 3.0, 0.1, func(v): return "%.1f" % v, changed)
	_range(col, I18n.t("Steering speed"), I18n.t("How fast the front wheels follow the stick"), p, "steerSpeed", 0.5, 1.6, 0.05, _pct, changed)
	_range(col, I18n.t("Speed sensitivity"), I18n.t("Calmer steering at high speed"), p, "speedSens", 0.0, 1.0, 0.05, _pct, changed)
	_range(col, I18n.t("Stick dead zone"), I18n.t("Raise it if the car drifts with the stick centred"), p, "deadzone", 0.0, 0.25, 0.01, _pct, changed)
	_range(col, I18n.t("Brake curve"), I18n.t("Higher = more trigger travel near the locking point"), p, "brakeCurve", 1.0, 2.5, 0.1, func(v): return "%.1f" % v, changed)
	_toggle(col, I18n.t("Vibration"), "", p, "vibration", changed)
	_head(col, I18n.t("Pedals"))
	_select(col, I18n.t("Pedals on"), "", p, "pedals", [["triggers", I18n.t("Triggers")], ["rightStick", I18n.t("Right stick (up / down)")]], changed)
	_range(col, I18n.t("Throttle dead zone"), "", p, "throttleDeadzone", 0.0, 0.3, 0.01, _pct, changed)
	_range(col, I18n.t("Throttle saturation"), I18n.t("Where the trigger reaches 100 %"), p, "throttleSaturation", 0.5, 1.0, 0.01, _pct, changed)
	_range(col, I18n.t("Throttle curve"), I18n.t("1 = linear; higher = finer at the start"), p, "throttleCurve", 0.6, 2.5, 0.1, func(v): return "%.1f" % v, changed)
	_range(col, I18n.t("Brake dead zone"), "", p, "brakeDeadzone", 0.0, 0.3, 0.01, _pct, changed)
	_range(col, I18n.t("Brake saturation"), "", p, "brakeSaturation", 0.5, 1.0, 0.01, _pct, changed)
	_range(col, I18n.t("Steering saturation"), I18n.t("Stick travel for full lock"), p, "steerSaturation", 0.6, 1.0, 0.01, _pct, changed)
	_range(col, I18n.t("On / off triggers ramp"), I18n.t("Triggers with no travel (Switch Pro): held, they reach full over this time"), p, "digitalRamp", 0.1, 2.0, 0.05, func(v): return "%.2f s" % v, changed)
	_head(col, I18n.t("Keyboard"))
	var k: Dictionary = S.keyboard
	_range(col, I18n.t("Throttle ramp"), I18n.t("Time from nothing to full throttle: longer, a tap gives part throttle"), k, "throttleRamp", 0.05, 1.5, 0.05, func(v): return "%.2f s" % v, changed)
	_range(col, I18n.t("Brake ramp"), I18n.t("Time from nothing to full brake"), k, "brakeRamp", 0.05, 1.5, 0.05, func(v): return "%.2f s" % v, changed)
	_range(col, I18n.t("Steering speed"), "", k, "steerSpeed", 0.5, 1.6, 0.05, _pct, changed)
	_buttons(col, [UIKit.button(I18n.t("Reset the controller settings"), func():
		var layouts = S.pad.layouts
		S.pad = Settings.default_settings().pad
		S.pad.layouts = layouts
		changed.call())])
