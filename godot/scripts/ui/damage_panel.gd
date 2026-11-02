class_name DamagePanel
extends PanelContainer
## The damage report, as iRacing's black box draws it (port of ui/damagePanel.ts): the car's own model as a line
## drawing from above, every part in the colour of its damage, the four tyres below (suspension, punctures), what is
## lost in figures and how long the repairs would take in the pits. Shown for a few seconds after the damage changes,
## or while the damage key is held.

var art := CarLineArt.new()
var _car_rect := TextureRect.new()
var _list := VBoxContainer.new()
var _tyres: Array = []
var _repair := Label.new()
var _shown_until := 0.0
var _version := -1
var _last: DamageState = null

func _init() -> void:
	custom_minimum_size.x = 290
	add_theme_stylebox_override("panel", UIKit.box(Color(6 / 255.0, 9 / 255.0, 8 / 255.0, 0.86), Color(0.19, 0.82, 0.35, 0.35), 1, 4, Vector2(10, 8)))
	var col := VBoxContainer.new()
	add_child(col)
	col.add_child(UIKit.label(I18n.t("VEHICLE DAMAGE"), 13, Color("30d158"), true, 800))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	col.add_child(row)
	var left := VBoxContainer.new()
	row.add_child(left)
	_car_rect.custom_minimum_size = Vector2(112, 200)
	_car_rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_car_rect.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	left.add_child(_car_rect)
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 4)
	grid.add_theme_constant_override("v_separation", 4)
	left.add_child(grid)
	for k in ["LF", "RF", "LR", "RR"]:
		var l := UIKit.label(k, 12, Color("30d158"), true, 800)
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		l.custom_minimum_size.x = 54
		grid.add_child(l)
		_tyres.append(l)
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_list.add_theme_constant_override("separation", 3)
	row.add_child(_list)
	_repair.add_theme_font_size_override("font_size", 12)
	_repair.add_theme_color_override("font_color", UIKit.ACCENT_2)
	col.add_child(_repair)
	visible = false

## The car this panel draws: its line drawing and where its wheels are (once at load).
func set_car(entry: Dictionary, lines: TopView.Lines) -> void:
	art.set_car(entry, lines)
	if _last != null:
		_render(_last)

## Every frame: refreshes when the damage changed (and shows itself for 6 s), or while hold is down.
func update_damage(d: DamageState, hold: bool) -> void:
	var now := Time.get_ticks_msec() as float
	if d.version != _version:
		var first := _version == -1
		_version = d.version
		_render(d)
		# nothing to report at the start, or after a full repair
		if not first and _worst(d) > 0.02:
			_shown_until = now + 6000.0
	visible = hold or now < _shown_until

func _worst(d: DamageState) -> float:
	var m := 0.0
	for z in d.zones:
		m = maxf(m, z)
	if d.punctured.has(true):
		m = 1.0
	return m

func _render(d: DamageState) -> void:
	_last = d
	var z := d.zones
	var zc: Array = []
	for i in 5:
		zc.append(CarLineArt.damage_colour(z[i]))
	var cc: Array = []
	for i in 4:
		cc.append(Color("ff453a") if d.punctured[i] else CarLineArt.damage_colour(d.corners[i]))
	if art.draw(zc, cc):
		_car_rect.texture = art.texture
		_car_rect.custom_minimum_size = Vector2(112, 112.0 * art.lines.height / art.lines.width)
	for i in 4:
		var l: Label = _tyres[i]
		var sev: Color = Color("ff453a") if d.punctured[i] else CarLineArt.damage_colour(d.corners[i])
		l.add_theme_color_override("font_color", Color.WHITE if d.punctured[i] else sev)
		l.add_theme_stylebox_override("normal", UIKit.box(sev if d.punctured[i] else Color(sev, 0.12), sev, 1, 2, Vector2(0, 2)))
	var pct := func(v: float) -> String: return "%d %%" % roundi(v * 100.0)
	var rows: Array = []
	var front := 1.0 - d.downforce_front()
	var rear := 1.0 - d.downforce_rear()
	if front > 0.005:
		rows.append([I18n.t("Front downforce"), "−" + pct.call(front), z[0]])
	if rear > 0.005:
		rows.append([I18n.t("Rear downforce"), "−" + pct.call(rear), z[1]])
	var pull := d.alignment()
	if absf(pull) > 0.002:
		rows.append([I18n.t("Steering pulls"), I18n.t("left") if pull > 0.0 else I18n.t("right"), z[5]])
	if z[4] > 0.01:
		rows.append([I18n.t("Engine power"), "−" + pct.call(1.0 - d.power_scale()), z[4]])
	var names := [I18n.t("Front left"), I18n.t("Front right"), I18n.t("Rear left"), I18n.t("Rear right")]
	for i in 4:
		if d.punctured[i]:
			rows.append([names[i], I18n.t("PUNCTURE"), 1.0])
		elif d.corners[i] > 0.02:
			rows.append([names[i], "%s %s" % [I18n.t("suspension"), pct.call(d.corners[i])], d.corners[i]])
	for c in _list.get_children():
		c.queue_free()
	if rows.is_empty():
		rows.append([I18n.t("No damage"), "", 0.0])
	for r in rows:
		var sev := CarLineArt.damage_colour(r[2])
		var line := HBoxContainer.new()
		var a := UIKit.label(r[0], 12, Color("d8dde3"), false, 500)
		a.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		line.add_child(a)
		line.add_child(UIKit.label(r[1], 12, sev, false, 700))
		_list.add_child(line)
	# what a stop would take to put it right (the pit menu's times)
	var body := PitService.body_time(z) if maxf(maxf(z[0], z[1]), maxf(z[2], z[3])) > 0.02 else 0.0
	var susp := PitService.suspension_time(z) if z[5] > 0.02 else 0.0
	var eng := PitService.engine_time(z) if z[4] > 0.02 else 0.0
	var total := body + susp + eng
	_repair.text = I18n.t("Repairs in the pits: {s} s", {"s": "%.0f" % total}) if total > 0.5 else ""
