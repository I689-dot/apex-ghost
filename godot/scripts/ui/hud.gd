class_name Hud
extends Control
## Minimal cockpit-friendly HUD (port of ui/hud.ts): lap and position, the timing tower, lap times and live delta,
## shift lights, gear and speed, the minimap or the circuit map, race messages, flags, the pit banner, the status
## instrument and the damage report, and the race overlays. Built from Controls; update_state() every frame.

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
var _draft := Label.new()
var _wrong := Label.new()
var _wrong_panel := PanelContainer.new()
var _reset_hint := Label.new()
## The driver's dial (bottom right): revs, gear, speed, lamps, fuel (as the web game's since 2026-11-13).
var dial := HudDial.new()
var _board := VBoxContainer.new()
var _tl := HBoxContainer.new()
var _tr := VBoxContainer.new()
var _bc := HBoxContainer.new()
var _br := Control.new()
var _bl := Control.new()
var _times_grid := GridContainer.new()
var mini_map := MiniMap.new()
var circuit_map := CircuitMap.new()
var status := CarStatus.new()
var damage_panel := DamagePanel.new()
var overlays := RaceOverlays.new()
var timing := TimingScreen.new()
var _last_pen_key := ""
var _board_key := ""
var _hud_key := ""
var _flag_kind := ""
var _flag_blink := 0.0
## Small note over the speedometer (camera, gearbox): the iRacing on-screen display, not a message.
var _osd := Label.new()
var _msg_kind := ""
## The mirror is drawn at the top centre: the messages go under it.
var _mirror_on := false
## Touch controls on screen: the map and the tyres move out from under the pedals and the steering pad.
var touch := UIKit.touch()
var _board_panel: PanelContainer

## Colour tag of a message by what it is about.
const KIND_COLOUR := {
	"info": Color("8b9099"), "lap": Color("f2f3f5"), "pb": Color("30d158"), "best": Color("bf5af2"), "good": Color("30d158"),
	"warn": Color("ffd60a"), "bad": Color("ff453a"), "flag": Color("ffd60a"),
}

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
	_board_panel = board_panel
	# on a phone the tower goes under the lap and position (the top bar's buttons are beside them)
	if touch:
		add_child(board_panel)
	else:
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
	# the relative list: bottom left over the tyres, as in the sims (a phone keeps it here, its corners are the
	# touch controls')
	if touch:
		_tr.add_child(overlays.relative)

	# bottom right: the inputs widget beside the driver's dial (bottom centre on a phone)
	_bc.add_theme_constant_override("separation", 12)
	_bc.alignment = BoxContainer.ALIGNMENT_END
	add_child(_bc)
	overlays.inputs.size_flags_vertical = Control.SIZE_SHRINK_END
	_bc.add_child(overlays.inputs)
	_bc.add_child(dial)

	# the minimap or the circuit map: under the lap times (the bottom right corner is the dial's)
	add_child(_br)
	_br.add_child(mini_map)
	_br.add_child(circuit_map)
	circuit_map.visible = false
	# bottom left: status instrument
	add_child(_bl)
	_bl_col.add_theme_constant_override("separation", 8)
	_bl.add_child(_bl_col)
	if not touch:
		_bl_col.add_child(overlays.relative)
	_bl_col.add_child(status)
	add_child(damage_panel)
	add_child(overlays.spot_l)
	add_child(overlays.spot_r)
	add_child(overlays.mirror_delta)

	# centre banners
	_wrong_panel.add_theme_stylebox_override("panel", UIKit.box(UIKit.BAD, Color(0, 0, 0, 0), 0, 5, Vector2(16, 1)))
	_style(_wrong, 26, 800)
	_wrong.text = I18n.t("WRONG WAY")
	_wrong_panel.add_child(_wrong)
	_wrong_panel.visible = false
	add_child(_wrong_panel)
	_msg_panel.add_theme_stylebox_override("panel", _msg_box())
	_msg.add_theme_font_override("font", UIKit.font(false, 600))
	_msg.add_theme_font_size_override("font_size", 15)
	_msg.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_msg_panel.add_child(_msg)
	_msg_panel.visible = false
	add_child(_msg_panel)
	_fin_panel.add_theme_stylebox_override("panel", UIKit.box(Color(0, 0, 0, 0.55), Color(0, 0, 0, 0), 0, 4, Vector2(10, 1)))
	_style(_fin, 15, 600)
	_fin_panel.add_child(_fin)
	_fin_panel.visible = false
	add_child(_fin_panel)
	_pit_panel.add_theme_stylebox_override("panel", UIKit.box(UIKit.ACCENT_2, Color(0, 0, 0, 0), 0, 4, Vector2(10, 1)))
	_style(_pit_banner, 14, 600, Color("111111"))
	_pit_panel.add_child(_pit_banner)
	_pit_panel.visible = false
	add_child(_pit_panel)
	_flag_panel.add_theme_stylebox_override("panel", UIKit.box(Color("ffd60a"), Color(0, 0, 0, 0), 0, 4, Vector2(10, 1)))
	_style(_flag, 14, 600, Color("111111"))
	_flag_panel.add_child(_flag)
	_flag_panel.visible = false
	add_child(_flag_panel)
	_style(_draft, 13, 500, Color("9fd8ff"))
	_draft.text = I18n.t("SLIPSTREAM")
	_draft.modulate.a = 0.0
	add_child(_draft)
	_style(_osd, 14, 600, Color(1, 1, 1, 0.8))
	_osd.visible = false
	add_child(_osd)
	_style(_reset_hint, 15, 500)
	_reset_hint.text = I18n.t("Tap R to reset to the track") if DisplayServer.is_touchscreen_available() else I18n.t("Press R to reset to the track")
	_reset_hint.visible = false
	add_child(_reset_hint)
	add_child(timing)
	_layout()
	resized.connect(_layout)

var _times_cur_lbl: Label
## Bottom left: the relative list over the tyres (desktop).
var _bl_col := VBoxContainer.new()

func _msg_box(kind: String = "info") -> StyleBoxFlat:
	var s := UIKit.box(Color(10 / 255.0, 12 / 255.0, 16 / 255.0, 0.8), Color(0, 0, 0, 0), 0, 4, Vector2(10, 3))
	s.border_width_left = 4
	s.border_color = KIND_COLOUR.get(kind, KIND_COLOUR.info)
	return s

## Places the blocks (anchors by hand: the web's absolute positions).
func _layout() -> void:
	var s := size
	if s.x <= 0:
		return
	var sc := hud_scale()
	_tl.position = Vector2(20, 18)
	_tl.scale = Vector2(sc, sc)
	_tr.size.x = 0
	_tr.position = Vector2(s.x - 20.0 - _tr.get_combined_minimum_size().x * sc, 18)
	_tr.scale = Vector2(sc, sc)
	_bc.size = Vector2(0, 0)
	_place_bc()
	_bc.scale = Vector2(sc, sc)
	if touch:
		# the pedals and the steering pad take the bottom corners: the map sits at the right edge above the pedals'
		# buttons, the tyres above the steering pad
		var k := clampf(s.y / 400.0, 1.0, 4.0)
		var u := float(TouchPrefs.get_pref("size"))
		var full: bool = Settings.data.overlays.trackMap
		var mw: float = CircuitMap.W if full else MiniMap.SIZE
		var msc := sc * (190.0 if full else 136.0) / mw
		_br.position = Vector2(s.x - 14.0 - mw * msc, s.y * 0.25)
		_br.scale = Vector2(msc, msc)
		var steer_top := s.y - 12.0 * k - 118.0 * u * k
		_bl.position = Vector2(14, steer_top - 10.0 - _bl_height() * sc * 0.8)
		_bl.scale = Vector2(sc * 0.8, sc * 0.8)
	else:
		_place_map()
		_bl.position = Vector2(18, s.y - 18.0 - _bl_height() * sc)
		_bl.scale = Vector2(sc, sc)
	damage_panel.position = Vector2(20, s.y * 0.26)
	damage_panel.scale = Vector2(sc, sc)
	overlays.spot_l.position = Vector2(0, 0)
	overlays.spot_l.size = Vector2(14, s.y)
	overlays.spot_r.position = Vector2(s.x - 14, 0)
	overlays.spot_r.size = Vector2(14, s.y)
	overlays.mirror_delta.position = Vector2(s.x / 2.0 - 30.0, 66)
	_center(_wrong_panel, s.y * 0.3)
	_stack_banners()
	_center(_draft, s.y - 118.0 - 14.0)
	_center(_reset_hint, s.y - 140.0 - 24.0)
	timing.position = Vector2((s.x - timing.size.x) / 2.0, s.y * 0.12)

## The HUD's size: the player's scale, and on a computer the window's (as the web game's fit(): full size from
## 1600 x 900 up, smaller below, as on a laptop's 1366 x 768).
func hud_scale() -> float:
	var sc := float(Settings.data.hud.scale)
	if touch:
		return sc
	return sc * clampf(minf(size.x / 1600.0, size.y / 900.0), 0.58, 1.0)

## The dial and the inputs: the bottom right corner on a computer, the bottom centre on a phone.
func _place_bc() -> void:
	var s := size
	var sc := hud_scale()
	var m := _bc.get_combined_minimum_size() * sc
	if touch:
		_bc.position = Vector2((s.x - m.x) / 2.0, s.y - 22.0 - m.y)
	else:
		_bc.position = Vector2(s.x - 18.0 - m.x, s.y - 14.0 - m.y)

## The bottom-left column's height: the tyre widget sets its own size (larger than its minimum), the relative list
## over it when it is there.
func _bl_height() -> float:
	var h := maxf(status.size.y, status.get_combined_minimum_size().y)
	if overlays.relative.get_parent() == _bl_col and overlays.relative.visible:
		h += overlays.relative.get_combined_minimum_size().y + float(_bl_col.get_theme_constant("separation"))
	return h

## The map under the lap times (computer): MAP_W wide, as the web game's column.
const MAP_W := 200.0

func _place_map() -> void:
	var sc := hud_scale()
	var mw: float = CircuitMap.W if Settings.data.overlays.trackMap else MiniMap.SIZE
	var msc := sc * MAP_W / mw
	_br.scale = Vector2(msc, msc)
	_br.position = Vector2(size.x - 20.0 - MAP_W * sc, 18.0 + _tr.get_combined_minimum_size().y * sc + 8.0 * sc)

## The race's notices, one compact stack at the top centre (under the mirror when it is shown, under the touch
## buttons on a phone): flag, session, pit lane, then the latest message.
func _stack_banners() -> void:
	var s := size
	var y := 14.0
	if touch:
		y = 6.0 * clampf(s.y / 400.0, 1.0, 4.0) + 40.0 * clampf(s.y / 400.0, 1.0, 4.0) + 8.0
	if _mirror_on:
		y = maxf(y, RearMirror.screen_rect(s).end.y + 8.0)
	for p in [_flag_panel, _fin_panel, _pit_panel, _msg_panel]:
		if not p.visible:
			continue
		var m: Vector2 = p.get_combined_minimum_size()
		p.size = m
		p.position = Vector2((s.x - m.x) / 2.0, y)
		y += m.y + 5.0
	if _osd.visible:
		var b := _bc.position.y - _osd.get_combined_minimum_size().y - 6.0
		_osd.position = Vector2((s.x - _osd.get_combined_minimum_size().x) / 2.0, b)

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
	if touch and circuit_map.visible != full:
		circuit_map.visible = full
		_layout()
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
	dial.update_dial({
		"speed": v, "unit": "MPH" if mph else "KM/H", "gear": s.gear, "manual": s.manual, "rpm": s.rpm, "redline": s.redline,
		"limiter": s.limiter, "abs": s.abs, "tc": s.tc, "headlights": s.get("headlights", false),
		"engine": float(s.damageZones[4]) if (s.damageZones as Array).size() > 4 else 0.0, "fuel": s.get("fuel", {}), "fuelLow": s.fuelLow,
	})
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
	var kind: String = s.get("messageKind", "info")
	_mirror_on = s.get("mirrorOn", false)
	if kind == "osd":
		_set_text_panel(_msg_panel, _msg, "")
		if _osd.text != s.message:
			_osd.text = s.message
		_osd.visible = s.message != ""
	else:
		_osd.visible = false
		if kind != _msg_kind:
			_msg_kind = kind
			_msg_panel.add_theme_stylebox_override("panel", _msg_box(kind))
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
	_reset_hint.visible = s.resetHint
	var hs: Dictionary = Settings.data.hud
	var key := "%s|%s|%s|%s|%s|%s|%s|%s" % [hs.scale, hs.opacity, hs.timing, hs.lapInfo, hs.tyres, hs.revLights, hs.messages, hs.map]
	if key != _hud_key:
		_hud_key = key
		for c in [_tl, _tr, _bc, _br, _bl, damage_panel]:
			c.modulate.a = float(hs.opacity)
		_board.get_parent().visible = hs.timing
		_times_grid.visible = hs.lapInfo
		_bl.visible = hs.tyres and not _spectating
		dial.show_ring = hs.revLights
		_msg_panel.get_parent()
		_br.visible = hs.map
		_layout()
	overlays.update(s.throttle, s.brake, s.steer, s.liveDelta, s.gear, v, "mph" if mph else "km/h")
	_layout_dynamic()

func _layout_dynamic() -> void:
	# the blocks that change width follow their anchors
	var s := size
	var sc := hud_scale()
	_tr.position.x = s.x - 20.0 - _tr.get_combined_minimum_size().x * sc
	_place_bc()
	if not touch:
		_place_map()
		_bl.position.y = s.y - 18.0 - _bl_height() * sc
	_wrong_panel.position.x = (s.x - _wrong_panel.get_combined_minimum_size().x) / 2.0
	_stack_banners()
	if touch and _board_panel != null:
		_board_panel.position = Vector2(20, 18 + _tl.get_combined_minimum_size().y * sc + 6.0)
		_board_panel.scale = Vector2(sc, sc)

func _set_text_panel(panel: Control, label: Label, text: String) -> void:
	if label.text != text:
		label.text = text
	panel.visible = text != ""

func _flag_box(kind: String) -> StyleBoxFlat:
	match kind:
		"blue":
			return UIKit.box(Color("1f6fff"), Color(0, 0, 0, 0), 0, 4, Vector2(10, 1))
		"green":
			return UIKit.box(Color("19c15a"), Color(0, 0, 0, 0), 0, 4, Vector2(10, 1))
		"meatball":
			return UIKit.box(Color("111111"), Color("ff7a00"), 2, 4, Vector2(10, 1))
		"dt":
			return UIKit.box(Color("111111"), Color.WHITE, 2, 4, Vector2(10, 1))
	return UIKit.box(Color("ffd60a"), Color(0, 0, 0, 0), 0, 4, Vector2(10, 1))

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
