class_name Hud
extends Control
## Minimal cockpit-friendly HUD (port of ui/hud.ts): lap and position, the timing tower, lap times and live delta,
## shift lights, gear and speed, the minimap or the circuit map, race messages, flags, the pit banner, the status
## instrument and the damage report, and the race overlays. Built from Controls; update_state() every frame.

var _speed := Label.new()
var _unit := Label.new()
var _gear := Label.new()
var _lap := Label.new()
var _lap_tag := Label.new()
var _pos := Label.new()
var _cur := Label.new()
var _best := Label.new()
var _last := Label.new()
var _delta := Label.new()
var _msg := Label.new()
var _msg_panel := PanelContainer.new()
var _fin := Label.new()
var _fin_panel := PanelContainer.new()
var _pit_banner := Label.new()
var _pit_panel := PanelContainer.new()
var _flag := Label.new()
var _flag_panel := PanelContainer.new()
var _fuel := Label.new()
var _draft := Label.new()
var _wrong := Label.new()
var _wrong_panel := PanelContainer.new()
var _reset_hint := Label.new()
var _rpm_fill := ColorRect.new()
var _rpm_bar := Control.new()
var _leds: Array = []
var _board := VBoxContainer.new()
var _tl := HBoxContainer.new()
var _tr := VBoxContainer.new()
var _bc := VBoxContainer.new()
var _br := Control.new()
var _bl := Control.new()
var _times_grid := GridContainer.new()
var mini_map := MiniMap.new()
var circuit_map := CircuitMap.new()
var status := CarStatus.new()
var damage_panel := DamagePanel.new()
var overlays := RaceOverlays.new()
var timing := TimingScreen.new()
var _last_rpm_pct := -1
var _last_pen_key := ""
var _board_key := ""
var _hud_key := ""
var _flag_kind := ""
var _flag_blink := 0.0

## Race (after qualifying): positions and gaps on the board instead of best laps.
var race_laps := 0
## A timed race: the board shows the lap, not "of how many".
var timed_race := false
## Car colours (the tower's chips) and the starting order (positions gained or lost in a race).
var colors := {}
var grid_order: Array = []
var drivers := {}
var _spectating := false

func _init() -> void:
	UIKit.full(self)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	theme = UIKit.build_theme()
	_build()

func _lbl(text: String, size: int, weight: int = 700, color: Color = Color.WHITE, display: bool = true) -> Label:
	var l := UIKit.label(text, size, color, display, weight)
	l.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.8))
	l.add_theme_constant_override("shadow_offset_y", 1)
	l.add_theme_constant_override("shadow_offset_x", 0)
	return l

func _small(text: String) -> Label:
	var l := _lbl(text, 12, 500, Color(1, 1, 1, 0.65))
	return l

func _style(l: Label, size: int, weight: int, color: Color = Color.WHITE, display: bool = true) -> Label:
	l.add_theme_font_override("font", UIKit.font(display, weight))
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.8))
	l.add_theme_constant_override("shadow_offset_y", 1)
	return l

func _build() -> void:
	# top-left: lap, position, the board
	_tl.add_theme_constant_override("separation", 19)
	_tl.position = Vector2(20, 18)
	add_child(_tl)
	var lap_block := VBoxContainer.new()
	lap_block.add_theme_constant_override("separation", 0)
	_lap_tag = _small(I18n.t("LAP"))
	lap_block.add_child(_lap_tag)
	_style(_lap, 38, 800)
	_lap.text = I18n.t("OUT")
	lap_block.add_child(_lap)
	_tl.add_child(lap_block)
	var pos_block := VBoxContainer.new()
	pos_block.add_theme_constant_override("separation", 0)
	pos_block.add_child(_small(I18n.t("POS")))
	_style(_pos, 38, 800)
	_pos.text = "1/1"
	pos_block.add_child(_pos)
	_tl.add_child(pos_block)
	var board_panel := PanelContainer.new()
	board_panel.add_theme_stylebox_override("panel", UIKit.box(Color(0, 0, 0, 0.45), Color(0, 0, 0, 0), 0, 6, Vector2(0, 4)))
	board_panel.custom_minimum_size.x = 170
	_board.add_theme_constant_override("separation", 0)
	board_panel.add_child(_board)
	_tl.add_child(board_panel)

	# top-right: times, delta, delta bar, relative
	_tr.add_theme_constant_override("separation", 3)
	_tr.alignment = BoxContainer.ALIGNMENT_BEGIN
	add_child(_tr)
	_times_grid.columns = 2
	_times_grid.add_theme_constant_override("h_separation", 13)
	_times_grid.add_theme_constant_override("v_separation", 0)
	_style(_cur, 22, 700)
	_style(_best, 22, 700)
	_style(_last, 22, 700)
	_lap_tag = _lap_tag # the LAP tag of the lap block doubles as the penalty tag
	var cur_lbl := _small(I18n.t("LAP"))
	_times_grid.add_child(cur_lbl)
	_times_grid.add_child(_cur)
	_times_grid.add_child(_small(I18n.t("BEST")))
	_times_grid.add_child(_best)
	_times_grid.add_child(_small(I18n.t("LAST")))
	_times_grid.add_child(_last)
	_times_cur_lbl = cur_lbl
	_tr.add_child(_times_grid)
	_style(_delta, 24, 800)
	_tr.add_child(_delta)
	_tr.add_child(overlays.delta_bar)
	_tr.add_child(overlays.relative)

	# bottom centre: shift lights, rpm bar, gear and speed, fuel, inputs
	_bc.add_theme_constant_override("separation", 4)
	_bc.alignment = BoxContainer.ALIGNMENT_END
	add_child(_bc)
	var leds_row := HBoxContainer.new()
	leds_row.add_theme_constant_override("separation", 4)
	leds_row.alignment = BoxContainer.ALIGNMENT_CENTER
	for i in 10:
		var led := Panel.new()
		led.custom_minimum_size = Vector2(14, 6)
		led.add_theme_stylebox_override("panel", UIKit.box(Color(1, 1, 1, 0.12), Color(0, 0, 0, 0), 0, 3))
		leds_row.add_child(led)
		_leds.append(led)
	_bc.add_child(leds_row)
	_rpm_bar.custom_minimum_size = Vector2(220, 4)
	_rpm_bar.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	var rpm_bg := ColorRect.new()
	rpm_bg.color = Color(1, 1, 1, 0.15)
	UIKit.full(rpm_bg)
	_rpm_bar.add_child(rpm_bg)
	_rpm_fill.color = Color.WHITE
	_rpm_fill.size = Vector2(0, 4)
	_rpm_bar.add_child(_rpm_fill)
	_bc.add_child(_rpm_bar)
	var speedo := HBoxContainer.new()
	speedo.alignment = BoxContainer.ALIGNMENT_CENTER
	speedo.add_theme_constant_override("separation", 14)
	_style(_gear, 54, 800, UIKit.ACCENT_2)
	_gear.text = "N"
	_gear.custom_minimum_size.x = 35
	_gear.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	speedo.add_child(_gear)
	var sp := HBoxContainer.new()
	sp.add_theme_constant_override("separation", 5)
	_style(_speed, 51, 800)
	_speed.text = "0"
	_speed.custom_minimum_size.x = 90
	_speed.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	sp.add_child(_speed)
	_style(_unit, 14, 500, UIKit.MUTED)
	sp.add_child(_unit)
	speedo.add_child(sp)
	_speedo = speedo
	_bc.add_child(speedo)
	var fuel_panel := PanelContainer.new()
	fuel_panel.add_theme_stylebox_override("panel", UIKit.box(Color(0, 0, 0, 0.45), Color(0, 0, 0, 0), 0, 4, Vector2(10, 1)))
	_style(_fuel, 14, 700)
	fuel_panel.add_child(_fuel)
	fuel_panel.visible = false
	_fuel_panel = fuel_panel
	_bc.add_child(fuel_panel)
	_bc.add_child(overlays.inputs)

	# bottom right: minimap or the circuit map
	add_child(_br)
	_br.add_child(mini_map)
	_br.add_child(circuit_map)
	circuit_map.visible = false
	# bottom left: status instrument
	add_child(_bl)
	_bl.add_child(status)
	add_child(damage_panel)
	add_child(overlays.spot_l)
	add_child(overlays.spot_r)
	add_child(overlays.mirror_delta)

	# centre banners
	_wrong_panel.add_theme_stylebox_override("panel", UIKit.box(UIKit.BAD, Color(0, 0, 0, 0), 0, 6, Vector2(22, 2)))
	_style(_wrong, 48, 800)
	_wrong.text = I18n.t("WRONG WAY")
	_wrong_panel.add_child(_wrong)
	_wrong_panel.visible = false
	add_child(_wrong_panel)
	_msg_panel.add_theme_stylebox_override("panel", _msg_box())
	_msg.add_theme_font_override("font", UIKit.font(false, 600))
	_msg.add_theme_font_size_override("font_size", 15)
	_msg.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_msg.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_msg.custom_minimum_size.x = 380
	_msg_panel.add_child(_msg)
	_msg_panel.visible = false
	add_child(_msg_panel)
	_fin_panel.add_theme_stylebox_override("panel", UIKit.box(Color(0, 0, 0, 0.5), Color(0, 0, 0, 0), 0, 6, Vector2(13, 2)))
	_style(_fin, 20, 500)
	_fin_panel.add_child(_fin)
	_fin_panel.visible = false
	add_child(_fin_panel)
	_pit_panel.add_theme_stylebox_override("panel", UIKit.box(UIKit.ACCENT_2, Color(0, 0, 0, 0), 0, 4, Vector2(14, 2)))
	_style(_pit_banner, 17, 500, Color("111111"))
	_pit_panel.add_child(_pit_banner)
	_pit_panel.visible = false
	add_child(_pit_panel)
	_flag_panel.add_theme_stylebox_override("panel", UIKit.box(Color("ffd60a"), Color(0, 0, 0, 0), 0, 4, Vector2(16, 3)))
	_style(_flag, 18, 500, Color("111111"))
	_flag_panel.add_child(_flag)
	_flag_panel.visible = false
	add_child(_flag_panel)
	_style(_draft, 13, 500, Color("9fd8ff"))
	_draft.text = I18n.t("SLIPSTREAM")
	_draft.modulate.a = 0.0
	add_child(_draft)
	_style(_reset_hint, 16, 500)
	_reset_hint.text = I18n.t("Tap R to reset to the track") if DisplayServer.is_touchscreen_available() else I18n.t("Press R to reset to the track")
	_reset_hint.visible = false
	add_child(_reset_hint)
	add_child(timing)
	_layout()
	resized.connect(_layout)

var _times_cur_lbl: Label
var _speedo: HBoxContainer
var _fuel_panel: PanelContainer

func _msg_box() -> StyleBoxFlat:
	var s := UIKit.box(Color(10 / 255.0, 12 / 255.0, 16 / 255.0, 0.78), Color(0, 0, 0, 0), 0, 4, Vector2(14, 5))
	s.border_width_left = 3
	s.border_color = UIKit.ACCENT_2
	return s

## Places the blocks (anchors by hand: the web's absolute positions).
func _layout() -> void:
	var s := size
	if s.x <= 0:
		return
	var hs: Dictionary = Settings.data.hud
	var sc := float(hs.scale)
	_tl.position = Vector2(20, 18)
	_tl.scale = Vector2(sc, sc)
	_tr.size.x = 0
	_tr.position = Vector2(s.x - 20.0 - _tr.get_combined_minimum_size().x * sc, 18)
	_tr.scale = Vector2(sc, sc)
	_bc.size = Vector2(0, 0)
	_bc.position = Vector2((s.x - _bc.get_combined_minimum_size().x * sc) / 2.0, s.y - 22.0 - _bc.get_combined_minimum_size().y * sc)
	_bc.scale = Vector2(sc, sc)
	_br.position = Vector2(s.x - 18.0 - 220.0 * sc, s.y - 18.0 - 220.0 * sc)
	_br.scale = Vector2(sc, sc)
	_bl.position = Vector2(18, s.y - 18.0 - status.size.y * sc)
	_bl.scale = Vector2(sc, sc)
	damage_panel.position = Vector2(20, s.y * 0.26)
	damage_panel.scale = Vector2(sc, sc)
	overlays.spot_l.position = Vector2(0, 0)
	overlays.spot_l.size = Vector2(14, s.y)
	overlays.spot_r.position = Vector2(s.x - 14, 0)
	overlays.spot_r.size = Vector2(14, s.y)
	overlays.mirror_delta.position = Vector2(s.x / 2.0 - 30.0, 66)
	_center(_wrong_panel, s.y * 0.28)
	_center(_msg_panel, 124)
	_center(_fin_panel, 14)
	_center(_pit_panel, 52)
	_center(_flag_panel, 86)
	_center(_draft, s.y - 118.0 - 14.0)
	_center(_reset_hint, s.y - 140.0 - 24.0)
	timing.position = Vector2((s.x - timing.size.x) / 2.0, s.y * 0.12)

func _center(c: Control, y: float) -> void:
	c.position = Vector2((size.x - c.get_combined_minimum_size().x) / 2.0, y)

func _process(dt: float) -> void:
	_flag_blink += dt
	if _flag_kind == "sc" or _flag_kind == "fcy":
		_flag_panel.modulate.a = 1.0 if fmod(_flag_blink, 1.0) < 0.5 else 0.0

func set_track(t: Dictionary) -> void:
	circuit_map.set_track(t, t.get("turns"))
	mini_map.set_track(t)
	_layout()

func set_car(entry: Dictionary, lines: TopView.Lines) -> void:
	status.set_car(entry, lines)

## The damage report's line drawing and the instrument's.
func set_damage_car(entry: Dictionary, lines: TopView.Lines) -> void:
	damage_panel.set_car(entry, lines)
	status.set_lines(entry, lines)

func set_spectating(on: bool) -> void:
	_spectating = on
	_bl.visible = not on
	_bc.visible = not on
	damage_panel.visible = false

func set_driver(id: String, country, num) -> void:
	drivers[id] = {"country": country, "num": num}
	overlays.drivers = drivers

func draw_map(dots: Array, me_x: float, me_z: float, fx: float, fz: float) -> void:
	mini_map.draw_map(dots, me_x, me_z, fx, fz)

## The circuit map's cars (~10 Hz): the full map (iRacing's) or the turning one, as set.
func set_map_cars(cars: Array) -> void:
	var full: bool = Settings.data.overlays.trackMap
	circuit_map.visible = full
	mini_map.visible = not full
	if full:
		circuit_map.draw_cars(cars)

func set_relative(rows: Array, left: bool, right: bool) -> void:
	overlays.set_relative(rows, left, right)

func update_damage(d: DamageState, hold: bool) -> void:
	damage_panel.update_damage(d, hold)

static func fmt_time(ms) -> String:
	if ms == null or is_nan(float(ms)):
		return "--:--.---"
	var neg: bool = ms < 0.0
	var t := absf(ms)
	var m := int(t / 60000.0)
	var sec := int(fmod(t, 60000.0) / 1000.0)
	var r := int(fmod(t, 1000.0))
	return "%s%d:%02d.%03d" % ["-" if neg else "", m, sec, r]

static func fmt_delta(ms: float) -> String:
	var s := "%.3f" % (ms / 1000.0)
	return "+" + s if ms >= 0.0 else s

## One frame of state (the keys of HudState in the web client): speedMs, rpm, redline, limiter, gear, manual,
## lapLabel, lapPenaltyMs, lapInvalid, liveDelta, position, total, currentLapMs, bestLapMs, lastLapMs, sectorDelta,
## wrongWay, abs, tc, message, sessionText, pitText, compound, tyreWear, brakeTemps, slipstream, resetHint, tyreTemps,
## damageZones, flag, flagText, fuelText, fuelLow, throttle, brake, steer.
func update_state(s: Dictionary) -> void:
	var mph: bool = Settings.data.units == "mph"
	var v: float = s.speedMs * 2.23694 if mph else s.speedMs * 3.6
	_speed.text = str(roundi(absf(v)))
	_unit.text = "MPH" if mph else "KM/H"
	_gear.text = "R" if s.gear < 0 else ("N" if s.gear == 0 else str(s.gear))
	var pct := roundi(minf(1.0, s.rpm / s.limiter) * 100.0)
	if pct != _last_rpm_pct:
		_last_rpm_pct = pct
		_rpm_fill.size = Vector2(220.0 * pct / 100.0, 4)
		_rpm_fill.color = Color.WHITE.lerp(UIKit.ACCENT, clampf((pct - 75.0) / 15.0, 0.0, 1.0))
		var lit := clampi(roundi(((s.rpm / s.redline - 0.75) / 0.25) * 10.0), 0, 10)
		for i in 10:
			var c := Color(1, 1, 1, 0.12)
			if i < lit:
				c = Color("30d158") if i < 4 else (Color("ff453a") if i < 8 else Color("0a84ff"))
			(_leds[i].get_theme_stylebox("panel") as StyleBoxFlat).bg_color = c
	_lap.text = s.lapLabel
	var pen_key := "%s|%s" % [s.lapPenaltyMs, s.get("lapInvalid", false)]
	if pen_key != _last_pen_key:
		_last_pen_key = pen_key
		var pen: bool = s.lapPenaltyMs > 0
		var invalid: bool = s.get("lapInvalid", false)
		if invalid:
			_times_cur_lbl.text = "%s · +%.0f s" % [I18n.t("INVALID"), s.lapPenaltyMs / 1000.0] if pen else I18n.t("INVALID")
		elif pen:
			_times_cur_lbl.text = "%s +%.1f s" % [I18n.t("PEN"), s.lapPenaltyMs / 1000.0]
		else:
			_times_cur_lbl.text = I18n.t("LAP")
		var bad := Color(UIKit.BAD) if (pen or invalid) else Color(1, 1, 1, 0.65)
		_times_cur_lbl.add_theme_color_override("font_color", bad)
		_cur.add_theme_color_override("font_color", UIKit.BAD if (pen or invalid) else Color.WHITE)
	_pos.text = "%s/%s" % ["–" if s.bestLapMs == null and race_laps == 0 else str(s.position), s.total]
	_cur.text = fmt_time(s.currentLapMs)
	_best.text = fmt_time(s.bestLapMs)
	_last.text = fmt_time(s.lastLapMs)
	var d = s.liveDelta if s.liveDelta != null else s.sectorDelta
	if d == null:
		_delta.text = ""
	else:
		# tenths are enough while driving (hundredths flicker unreadably)
		_delta.text = fmt_delta(roundf(d / 10.0) * 10.0)
		_delta.add_theme_color_override("font_color", UIKit.GOOD if d <= 0.0 else UIKit.BAD)
		_delta.modulate.a = 0.45 if (s.lapPenaltyMs > 0 or s.get("lapInvalid", false)) else 1.0
	_wrong_panel.visible = s.wrongWay
	status.update_status(s.tyreTemps, s.damageZones, s.abs, s.tc, s.compound, s.tyreWear, s.brakeTemps)
	_draft.modulate.a = 1.0 if s.slipstream > 0.25 else 0.0
	_set_text_panel(_msg_panel, _msg, s.message)
	_set_text_panel(_fin_panel, _fin, s.sessionText)
	_fin.add_theme_color_override("font_color", Color("111111") if s.sessionText == I18n.t("CHEQUERED FLAG · LAST LAP") else Color.WHITE)
	_set_text_panel(_pit_panel, _pit_banner, s.pitText)
	_set_text_panel(_flag_panel, _flag, s.flagText)
	if s.flag != _flag_kind:
		_flag_kind = s.flag
		_flag_panel.modulate.a = 1.0
		_flag_panel.add_theme_stylebox_override("panel", _flag_box(s.flag))
		_flag.add_theme_color_override("font_color", Color.WHITE if s.flag in ["blue", "meatball", "dt"] else Color("111111"))
	_set_text_panel(_fuel_panel, _fuel, s.fuelText)
	_fuel.add_theme_color_override("font_color", Color("ff5a5a") if s.fuelLow else Color.WHITE)
	_reset_hint.visible = s.resetHint
	# the inputs widget shows the gear and speed: the old speedometer only without it
	_speedo.visible = not Settings.data.overlays.inputs
	var hs: Dictionary = Settings.data.hud
	var key := "%s|%s|%s|%s|%s|%s|%s|%s" % [hs.scale, hs.opacity, hs.timing, hs.lapInfo, hs.tyres, hs.revLights, hs.messages, hs.map]
	if key != _hud_key:
		_hud_key = key
		for c in [_tl, _tr, _bc, _br, _bl, damage_panel]:
			c.modulate.a = float(hs.opacity)
		_board.get_parent().visible = hs.timing
		_times_grid.visible = hs.lapInfo
		_bl.visible = hs.tyres and not _spectating
		(_leds[0].get_parent() as Control).visible = hs.revLights
		_msg_panel.get_parent()
		_br.visible = hs.map
		_layout()
	overlays.update(s.throttle, s.brake, s.steer, s.liveDelta, s.gear, v, "mph" if mph else "km/h")
	_layout_dynamic()

func _layout_dynamic() -> void:
	# the blocks that change width follow their anchors
	var s := size
	var sc := float(Settings.data.hud.scale)
	_tr.position.x = s.x - 20.0 - _tr.get_combined_minimum_size().x * sc
	_bc.position = Vector2((s.x - _bc.get_combined_minimum_size().x * sc) / 2.0, s.y - 22.0 - _bc.get_combined_minimum_size().y * sc)
	for p in [_msg_panel, _fin_panel, _pit_panel, _flag_panel, _wrong_panel]:
		p.position.x = (s.x - p.get_combined_minimum_size().x) / 2.0

func _set_text_panel(panel: Control, label: Label, text: String) -> void:
	if label.text != text:
		label.text = text
	panel.visible = text != ""

func _flag_box(kind: String) -> StyleBoxFlat:
	match kind:
		"blue":
			return UIKit.box(Color("1f6fff"), Color(0, 0, 0, 0), 0, 4, Vector2(16, 3))
		"green":
			return UIKit.box(Color("19c15a"), Color(0, 0, 0, 0), 0, 4, Vector2(16, 3))
		"meatball":
			return UIKit.box(Color("111111"), Color("ff7a00"), 2, 4, Vector2(16, 3))
		"dt":
			return UIKit.box(Color("111111"), Color.WHITE, 2, 4, Vector2(16, 3))
	return UIKit.box(Color("ffd60a"), Color(0, 0, 0, 0), 0, 4, Vector2(16, 3))

## Timing screen around the player's position: best lap for the leader, gaps for the others.
## The tower's rows: the top three, then you with two cars either side, a divider where rows are skipped.
func _tower_rows(list: Array, me: String) -> Array:
	var i := 0
	for k in list.size():
		if list[k].id == me:
			i = k
			break
	var keep := {0: true, 1: true, 2: true}
	for k in range(i - 2, i + 3):
		if k >= 0 and k < list.size():
			keep[k] = true
	var idx: Array = keep.keys().filter(func(k): return k < list.size())
	idx.sort()
	var out: Array = []
	for j in idx.size():
		if j > 0 and idx[j] != idx[j - 1] + 1:
			out.append(null)
		out.append(list[idx[j]])
	return out

func _chip_row(id: String) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 4)
	var chip := ColorRect.new()
	chip.color = Color(colors.get(id, "#888888"))
	chip.custom_minimum_size = Vector2(3, 14)
	row.add_child(chip)
	var d = drivers.get(id)
	if d != null and d.num:
		var plate := PanelContainer.new()
		plate.add_theme_stylebox_override("panel", UIKit.box(Color("f2f2f2"), Color(0, 0, 0, 0), 0, 3, Vector2(3, 0)))
		plate.add_child(UIKit.label(str(d.num), 11, Color("111111"), false, 700))
		row.add_child(plate)
	if d != null and d.country:
		var flag := FlagIcon.make(d.country, 16)
		if flag != null:
			row.add_child(flag)
	return row

func _board_row(pos_text: String, id: String, name_text: String, extra: Array, em_text: String, me_row: bool, p1: bool) -> Control:
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", UIKit.box(Color(1.0, 45 / 255.0, 61 / 255.0, 0.35) if me_row else Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 0, Vector2(10, 2)))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	panel.add_child(row)
	var pl := UIKit.label(pos_text, 14, Color.WHITE, false, 700)
	pl.custom_minimum_size.x = 26
	row.add_child(pl)
	var mid := HBoxContainer.new()
	mid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	mid.add_theme_constant_override("separation", 4)
	mid.add_child(_chip_row(id))
	mid.add_child(UIKit.label(name_text, 14, Color.WHITE, false, 500))
	for e in extra:
		mid.add_child(e)
	row.add_child(mid)
	row.add_child(UIKit.label(em_text, 12, Color("c77dff") if p1 else UIKit.MUTED, false, 700 if p1 else 500))
	return panel

func _pit_tag() -> Control:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", UIKit.box(UIKit.ACCENT_2, Color(0, 0, 0, 0), 0, 3, Vector2(4, 0)))
	p.add_child(UIKit.label(I18n.t("PIT"), 10, Color("111111"), false, 700))
	return p

func set_board(list: Array, me: String, names: Dictionary) -> void:
	if race_laps > 0:
		_set_race_board(list, me, names)
		return
	var rows := _tower_rows(list, me)
	var key := "|".join(rows.map(func(r): return "-" if r == null else "%s%s%s%s%s%s%s%s" % [r.id, r.position, r.bestLapMs, r.finishedMs, r.dnf, r.inPit, r.outLap, r.lapPenaltyMs]))
	if key == _board_key:
		return
	_board_key = key
	for c in _board.get_children():
		c.queue_free()
	for r in rows:
		if r == null:
			var gap := ColorRect.new()
			gap.color = Color(1, 1, 1, 0.18)
			gap.custom_minimum_size = Vector2(0, 1)
			_board.add_child(gap)
			continue
		var text: String
		if r.bestLapMs == null:
			text = I18n.t("DNF") if r.dnf else (I18n.t("PIT") if r.inPit else (I18n.t("OUT LAP") if r.outLap else ("%s +%.1f s" % [I18n.t("PEN"), r.lapPenaltyMs / 1000.0] if r.lapPenaltyMs > 0 else I18n.t("ON LAP"))))
		elif r.position == 1:
			text = fmt_time(r.bestLapMs)
		else:
			text = "+%.3f" % ((r.gapMs if r.gapMs != null else 0.0) / 1000.0)
		_board.add_child(_board_row("–" if r.bestLapMs == null else str(r.position), r.id, names.get(r.id, "?"), [_pit_tag()] if r.inPit else [], text, r.id == me, r.position == 1 and r.bestLapMs != null))

func _set_race_board(list: Array, me: String, names: Dictionary) -> void:
	var rows := _tower_rows(list, me)
	var leader_laps: int = list[0].laps if list.size() > 0 else 0
	var text_of := func(r: Dictionary) -> String:
		if r.dnf:
			return I18n.t("DNF")
		if r.finishedMs != null and r.position > 1:
			return "+%.1f · %s" % [(r.gapMs if r.gapMs != null else 0.0) / 1000.0, I18n.t("FIN")]
		if r.position == 1:
			if r.finishedMs != null:
				return I18n.t("FIN")
			if timed_race:
				return I18n.t("LAP {n}", {"n": r.laps + 1})
			return I18n.t("LAP {n}/{max}", {"n": mini(r.laps + 1, race_laps), "max": race_laps})
		if leader_laps - r.laps >= 2 or (leader_laps - r.laps == 1 and (r.gapMs if r.gapMs != null else 0.0) > 60000.0):
			return "+%d %s" % [leader_laps - r.laps, I18n.t("LAP")]
		return "+%.1f" % ((r.gapMs if r.gapMs != null else 0.0) / 1000.0)
	var key := "|".join(rows.map(func(r): return "-" if r == null else "%s%s%s%s" % [r.id, r.position, text_of.call(r), r.inPit]))
	if key == _board_key:
		return
	_board_key = key
	for c in _board.get_children():
		c.queue_free()
	for r in rows:
		if r == null:
			var gap := ColorRect.new()
			gap.color = Color(1, 1, 1, 0.18)
			gap.custom_minimum_size = Vector2(0, 1)
			_board.add_child(gap)
			continue
		# places gained (+) or lost (-) since the start
		var g := grid_order.find(r.id)
		var moved: int = 0 if g < 0 else g + 1 - r.position
		var extra: Array = []
		if moved != 0:
			extra.append(UIKit.label("%s%d" % ["+" if moved > 0 else "−", absi(moved)], 11, UIKit.GOOD if moved > 0 else UIKit.BAD, false, 500))
		if r.inPit:
			extra.append(_pit_tag())
		_board.add_child(_board_row(str(r.position), r.id, names.get(r.id, "?"), extra, text_of.call(r), r.id == me, r.position == 1))
