class_name RaceObjective
extends Control
## The phone's race objective layer (docs/prompts/mobile-f2p-pass.md 16, 17; references 030-031, 042-043, 083, 085):
##  - the OBJECTIVE panel at the top left: the race's goal (beat the cup's rival, else the next star: top 6, podium,
##    win), ticked when it holds;
##  - the rival's marker over their car with the distance (a career rival race; SessionBots.rival_id);
##  - callouts that pay credits: an overtake, a clean lap, a slipstream held, added up for the results' breakdown
##    (bonus, read by App.show_results).
## Made by RaceSession for offline races in the phone layout. Text changes at most every TEXT_EVERY seconds (no string
## built every frame); the marker moves every frame.

const TEXT_EVERY := 0.25
## Credits a callout pays.
const PAY := {"overtake": 250, "clean_lap": 300, "slipstream": 100}
## A slipstream counts after this long in a car's wake (s), then not again for SLIP_COOLDOWN.
const SLIP_HOLD := 2.0
const SLIP_COOLDOWN := 12.0
## The marker shows within this distance (m).
const MARKER_RANGE := 500.0
const CALLOUT_S := 1.6

var bonus := {"overtake": 0, "clean_lap": 0, "slipstream": 0}
var _rival := ""
var _panel := PanelContainer.new()
var _goal := Label.new()
var _tick := MobileUI.Icon.make("ring", 18, UIKit.TEXT)
## Whether you are ahead of the rival (RaceSession sets it from the standings).
var _rival_behind := false
var _marker := PanelContainer.new()
var _marker_text := Label.new()
var _callout := Label.new()
var _text_t := 0.0
var _call_t := 0.0
var _last_pos := 0
var _last_clean := 0
var _slip_t := 0.0
var _slip_cool := 0.0
var _dist := -1

## rival: the rival's name ("" without one).
func _init(rival: String) -> void:
	_rival = rival
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	UIKit.full(self)
	_panel.add_theme_stylebox_override("panel", UIKit.box(Color(0, 0, 0, 0.45), Color(1, 1, 1, 0.12), 1, 6, Vector2(12, 6)))
	_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var col := UIW.vbox(2)
	col.mouse_filter = Control.MOUSE_FILTER_IGNORE
	col.add_child(UIKit.label(I18n.t("Objective").to_upper(), 16, UIKit.TEXT, true, 800))
	var row := UIW.hbox(6)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_child(_tick)
	_goal.add_theme_font_override("font", UIKit.font(true, 700))
	_goal.add_theme_font_size_override("font_size", 15)
	row.add_child(_goal)
	col.add_child(row)
	_panel.add_child(col)
	# under the phone HUD's icon column and map (TouchControls.ICON column, about 130 units down)
	_panel.position = Vector2(80, 150)
	add_child(_panel)
	_marker.add_theme_stylebox_override("panel", UIKit.box(Color(MobileUI.PURPLE, 0.85), Color(1, 1, 1, 0.4), 1, 4, Vector2(8, 2)))
	_marker.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_marker_text.add_theme_font_override("font", UIKit.font(true, 700))
	_marker_text.add_theme_font_size_override("font_size", 14)
	_marker.add_child(_marker_text)
	_marker.visible = false
	add_child(_marker)
	_callout.add_theme_font_override("font", UIKit.font(true, 800, true))
	_callout.add_theme_font_size_override("font_size", 30)
	_callout.add_theme_color_override("font_color", MobileUI.GOLD)
	_callout.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.8))
	_callout.add_theme_constant_override("outline_size", 6)
	_callout.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_callout.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_callout.position = Vector2(-300, 120)
	_callout.size = Vector2(600, 40)
	_callout.visible = false
	add_child(_callout)

## Every frame of a race: the position (0 before the standings), the cars' world positions (yours, the rival's: null
## without one), the camera, your clean laps so far, your slipstream (0..1), whether the race is running.
func update(dt: float, position: int, me: Vector3, rival: Variant, cam: Camera3D, clean_laps: int, slip: float, racing: bool) -> void:
	# callouts
	if racing:
		if _last_pos > 0 and position > 0 and position < _last_pos:
			_pay("overtake", I18n.t("Overtake"))
		if clean_laps > _last_clean:
			_pay("clean_lap", I18n.t("Clean lap"))
		_slip_cool = maxf(0.0, _slip_cool - dt)
		_slip_t = _slip_t + dt if slip > 0.35 else 0.0
		if _slip_t >= SLIP_HOLD and _slip_cool <= 0.0:
			_slip_t = 0.0
			_slip_cool = SLIP_COOLDOWN
			_pay("slipstream", I18n.t("Slipstream"))
	if position > 0:
		_last_pos = position
	_last_clean = clean_laps
	if _call_t > 0.0:
		_call_t -= dt
		_callout.visible = _call_t > 0.0
		_callout.modulate.a = clampf(_call_t / 0.4, 0.0, 1.0)
	# the rival's marker, over their car
	var show := false
	if rival != null and cam != null:
		var rp: Vector3 = rival
		var d := me.distance_to(rp)
		var above := rp + Vector3.UP * 1.6
		if d < MARKER_RANGE and not cam.is_position_behind(above):
			show = true
			var sp := cam.unproject_position(above)
			_marker.position = sp - Vector2(_marker.size.x * 0.5, _marker.size.y + 4.0)
			var dm := roundi(d)
			if dm != _dist and _text_t <= 0.0:
				_dist = dm
				_marker_text.text = "%s  %d m" % [_rival.to_upper(), dm]
	_marker.visible = show
	# the objective, a few times a second
	_text_t -= dt
	if _text_t > 0.0:
		return
	_text_t = TEXT_EVERY
	var goal: String
	var ok: bool
	if _rival != "":
		goal = I18n.t("Beat {n}", {"n": _rival})
		ok = rival == null or (position > 0 and _rival_behind)
	elif position > 3 or position == 0:
		goal = I18n.t("Finish in the top 6") if position > 6 or position == 0 else I18n.t("Finish on the podium")
		ok = position > 0 and position <= 6 and position > 3
	else:
		goal = I18n.t("Win") if position > 1 else I18n.t("Win the race")
		ok = position == 1
	if _goal.text != goal:
		_goal.text = goal
	var k := "check" if ok else "ring"
	if _tick.kind != k:
		_tick.kind = k
		_tick.colour = UIKit.GOOD if ok else UIKit.TEXT
		_tick.queue_redraw()

func set_rival_behind(behind: bool) -> void:
	_rival_behind = behind

func _pay(kind: String, title: String) -> void:
	bonus[kind] = int(bonus[kind]) + int(PAY[kind])
	_callout.text = "%s  +%d" % [title.to_upper(), int(PAY[kind])]
	_callout.visible = true
	_call_t = CALLOUT_S

## The credits the callouts paid, for the results.
func total() -> int:
	var n := 0
	for k: String in bonus:
		n += int(bonus[k])
	return n
