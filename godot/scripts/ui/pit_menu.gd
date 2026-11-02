class_name PitMenu
extends Control
## The pit box: choose tyres and repairs, see how long the stop takes, start the service (port of ui/pitMenu.ts). The
## session clock keeps running the whole time (as in qualifying). Keys: Enter starts the service, Esc leaves without
## one, 1-5 pick keep / soft / medium / hard / wet. info = {current, wear, temps, zones, wetness, plan, fuel, driverChange};
## on_start(plan, seconds), on_leave().

var info: Dictionary
var plan: Dictionary
var _on_start: Callable
var _on_leave: Callable
var _total := Label.new()
var _breakdown := VBoxContainer.new()
var _tyre_btns := {} # compound id or "keep" -> Button
var _repair_boxes: Array = []
var _clock := Label.new()
var _card := PanelContainer.new()
var _col := VBoxContainer.new()
var _jobs: Array = [] # {from, to, row: HBoxContainer, mark: ColorRect}
var _count: Label = null
var _servicing := false
var _fuel_out := Label.new()

func _init(menu_info: Dictionary, on_start: Callable, on_leave: Callable) -> void:
	info = menu_info
	plan = info.plan.duplicate()
	_on_start = on_start
	_on_leave = on_leave
	UIKit.full(self)
	mouse_filter = Control.MOUSE_FILTER_STOP
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.35)
	UIKit.full(dim)
	add_child(dim)
	_card.add_theme_stylebox_override("panel", UIKit.box(Color(7 / 255.0, 8 / 255.0, 10 / 255.0, 0.94), UIKit.LINE, 1, 4, Vector2(20, 16)))
	_card.custom_minimum_size.x = 470
	add_child(_card)
	_card.add_child(_col)
	_col.add_theme_constant_override("separation", 6)
	_build_menu()
	resized.connect(_center)
	_center.call_deferred()

func _center() -> void:
	_card.position = Vector2((size.x - _card.size.x) / 2.0, maxf(10.0, (size.y - _card.size.y) / 2.0))

func _clear_col() -> void:
	for c in _col.get_children():
		c.queue_free()

func _head(title: String) -> HBoxContainer:
	var head := HBoxContainer.new()
	head.add_child(UIKit.label(title, 26, Color.WHITE, true, 800))
	var sp := Control.new()
	sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(sp)
	_clock.add_theme_font_override("font", UIKit.font(true, 700))
	_clock.add_theme_font_size_override("font_size", 18)
	_clock.add_theme_color_override("font_color", UIKit.ACCENT_2)
	if _clock.get_parent() != null:
		_clock.get_parent().remove_child(_clock)
	head.add_child(_clock)
	return head

func _build_menu() -> void:
	_clear_col()
	_col.add_child(_head(I18n.t("PIT BOX")))
	var hint := UIKit.label(I18n.t("The session clock keeps running. Your next lap after the pit exit is an out lap."), 13, UIKit.MUTED)
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_col.add_child(hint)
	var c: Dictionary = Tyres.COMPOUNDS[info.current]
	var avg_wear := 0.0
	for w in info.wear:
		avg_wear += w
	avg_wear /= 4.0
	_col.add_child(UIKit.label(I18n.t("Tyres · fitted: {name}, {pct} tread", {"name": I18n.t(c.name), "pct": "%d %%" % roundi((1.0 - avg_wear) * 100.0)}), 16, Color.WHITE, true, 700))
	var wear_row := HBoxContainer.new()
	wear_row.add_theme_constant_override("separation", 12)
	for i in 4:
		var cell := VBoxContainer.new()
		cell.add_theme_constant_override("separation", 0)
		cell.add_child(UIKit.label(["FL", "FR", "RL", "RR"][i], 14, Color.WHITE, true, 700))
		cell.add_child(UIKit.label(I18n.t("{pct} % tread", {"pct": roundi(100.0 - info.wear[i] * 100.0)}), 12, UIKit.TEXT))
		cell.add_child(UIKit.label("%d °C" % roundi(info.temps[i]), 12, UIKit.MUTED))
		wear_row.add_child(cell)
	_col.add_child(wear_row)
	var tyre_row := HBoxContainer.new()
	tyre_row.add_theme_constant_override("separation", 6)
	var ids := ["keep", "soft", "medium", "hard", "wet"]
	for i in ids.size():
		var id: String = ids[i]
		var comp = null if id == "keep" else Tyres.COMPOUNDS[id]
		var b := Button.new()
		b.focus_mode = Control.FOCUS_NONE
		b.toggle_mode = false
		b.custom_minimum_size = Vector2(84, 74)
		var inner := VBoxContainer.new()
		inner.alignment = BoxContainer.ALIGNMENT_CENTER
		inner.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var path := "res://assets/ui/tyre_%s.webp" % id
		if comp != null and ResourceLoader.exists(path):
			var tr := TextureRect.new()
			tr.texture = load(path)
			tr.custom_minimum_size = Vector2(34, 34)
			tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
			tr.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
			tr.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
			tr.mouse_filter = Control.MOUSE_FILTER_IGNORE
			inner.add_child(tr)
		else:
			var l0 := UIKit.label("↺" if comp == null else comp.letter, 24, Color.WHITE, true, 800)
			l0.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			inner.add_child(l0)
		var nl := UIKit.label((I18n.t(comp.name) if comp != null else I18n.t("Keep")).to_upper(), 12, Color.WHITE, true, 700)
		nl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		inner.add_child(nl)
		var kl := UIKit.label(str(i + 1), 10, UIKit.MUTED)
		kl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		inner.add_child(kl)
		inner.set_anchors_preset(Control.PRESET_FULL_RECT)
		b.add_child(inner)
		b.pressed.connect(func(): _set_tyres(null if id == "keep" else id))
		tyre_row.add_child(b)
		_tyre_btns[id] = b
	_col.add_child(tyre_row)
	var wet_hint: String
	if info.wetness > 0.35 and info.current != "wet":
		wet_hint = I18n.t("Wet track: wet tyres recommended")
	elif info.wetness < 0.15 and info.current == "wet":
		wet_hint = I18n.t("Dry track: wets will overheat and wear fast")
	else:
		wet_hint = I18n.t("Track wet") if info.wetness > 0.3 else (I18n.t("Track damp") if info.wetness > 0.05 else I18n.t("Track dry"))
	_col.add_child(UIKit.label(wet_hint, 13, UIKit.ACCENT_2))
	_col.add_child(UIKit.label(I18n.t("Repairs"), 16, Color.WHITE, true, 700))
	var z = info.zones
	_col.add_child(_repair(I18n.t("Bodywork & aero"), maxf(maxf(z[0], z[1]), maxf(z[2], z[3])), "body"))
	_col.add_child(_repair(I18n.t("Suspension"), z[5], "suspension"))
	_col.add_child(_repair(I18n.t("Engine"), z[4], "engine"))
	var fr = _fuel_row()
	if fr != null:
		_col.add_child(fr)
	var dr = _driver_row()
	if dr != null:
		_col.add_child(dr)
	_col.add_child(_breakdown)
	_total.add_theme_font_override("font", UIKit.font(true, 700))
	_total.add_theme_font_size_override("font_size", 18)
	_total.add_theme_color_override("font_color", UIKit.ACCENT_2)
	_col.add_child(_total)
	var actions := HBoxContainer.new()
	actions.add_theme_constant_override("separation", 8)
	actions.add_child(UIKit.button(I18n.t("Start service (Enter)"), start, true))
	actions.add_child(UIKit.button(I18n.t("Leave the box (Esc)"), leave))
	_col.add_child(actions)
	_refresh()

func _repair(label: String, dmg: float, key: String) -> Control:
	var row := HBoxContainer.new()
	var box := CheckBox.new()
	box.focus_mode = Control.FOCUS_NONE
	box.button_pressed = plan[key]
	box.disabled = dmg < 0.005
	box.toggled.connect(func(on): plan[key] = on; _refresh())
	_repair_boxes.append(box)
	row.add_child(box)
	var l := UIKit.label(label, 15, UIKit.TEXT)
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(l)
	var col := UIKit.BAD if dmg > 0.6 else (Color("ff9f0a") if dmg > 0.3 else (UIKit.ACCENT_2 if dmg > 0.005 else UIKit.MUTED))
	row.add_child(UIKit.label(I18n.t("{pct} damaged", {"pct": "%d %%" % roundi(dmg * 100.0)}) if dmg > 0.005 else I18n.t("no damage"), 13, col))
	return row

## Fuel to add: a slider up to a full tank, with the laps it gives and a button for what the race still needs.
func _fuel_row():
	var f = info.fuel
	if f == null:
		return null
	var room := maxf(0.0, f.tank - f.litres)
	var box := VBoxContainer.new()
	box.add_child(UIKit.label(I18n.t("Fuel · {l} l on board, {per} l a lap", {"l": "%.1f" % f.litres, "per": "%.2f" % f.perLap}), 16, Color.WHITE, true, 700))
	var row := HBoxContainer.new()
	var slider := HSlider.new()
	slider.min_value = 0
	slider.max_value = floorf(room)
	slider.step = 1
	slider.value = minf(room, plan.fuelL)
	slider.custom_minimum_size.x = 220
	var show := func() -> void:
		var laps: float = (f.litres + plan.fuelL) / maxf(0.1, f.perLap)
		_fuel_out.text = I18n.t("+{add} l → {l} l, ~{laps} laps", {"add": roundi(plan.fuelL), "l": roundi(f.litres + plan.fuelL), "laps": "%.1f" % laps})
	slider.value_changed.connect(func(v): plan.fuelL = v; show.call(); _refresh())
	_fuel_out.add_theme_font_size_override("font_size", 13)
	row.add_child(slider)
	row.add_child(_fuel_out)
	box.add_child(row)
	show.call()
	if f.need != null:
		box.add_child(UIKit.button(I18n.t("To the finish: +{l} l", {"l": ceili(minf(room, maxf(0.0, f.need - f.litres)))}), func():
			plan.fuelL = ceilf(minf(room, maxf(0.0, f.need - f.litres)))
			slider.value = plan.fuelL
			show.call()
			_refresh()))
	return box

func _driver_row():
	var d = info.driverChange
	if d == null:
		return null
	var row := HBoxContainer.new()
	var box := CheckBox.new()
	box.focus_mode = Control.FOCUS_NONE
	box.button_pressed = plan.driverChange
	box.toggled.connect(func(on): plan.driverChange = on; _refresh())
	row.add_child(box)
	var l := UIKit.label(I18n.t("Driver change"), 15, UIKit.TEXT)
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(l)
	var note: String
	if d == "due":
		note = I18n.t("Pit window open: the mandatory stop needs a driver change")
	elif d == "done":
		note = I18n.t("Mandatory stop already made")
	else:
		note = I18n.t("Outside the pit window: this stop does not count as the mandatory one")
	row.add_child(UIKit.label(note, 12, UIKit.ACCENT_2 if d == "due" else UIKit.MUTED))
	return row

func _set_tyres(id) -> void:
	plan.tyres = id
	_refresh()

func _refresh() -> void:
	for id in _tyre_btns:
		var on: bool = (null if id == "keep" else id) == plan.tyres
		var b: Button = _tyre_btns[id]
		for st in ["normal", "hover", "pressed", "focus"]:
			b.add_theme_stylebox_override(st, UIKit.box(Color(1, 1, 1, 0.22 if on else 0.06), UIKit.ACCENT_2 if on else UIKit.LINE, 2 if on else 1, 3))
	var st := PitService.service_time(plan, info.zones)
	for c in _breakdown.get_children():
		c.queue_free()
	for p in st.parts:
		var row := HBoxContainer.new()
		var a := UIKit.label(p.label, 14, UIKit.TEXT)
		a.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(a)
		row.add_child(UIKit.label("%.1f s" % p.seconds, 14, Color.WHITE, true, 700))
		_breakdown.add_child(row)
	if st.total > 0.0:
		_total.text = I18n.t("Stop: {s} s (refuelling first, then tyres and repairs)", {"s": "%.1f" % st.total}) if plan.fuelL > 0.0 else I18n.t("Stop: {s} s (tyres change while the mechanics repair)", {"s": "%.1f" % st.total})
	else:
		_total.text = I18n.t("Nothing to do: drive on")

## Remaining session time, shown in the box.
func set_clock(text: String) -> void:
	_clock.text = text

func _input(e: InputEvent) -> void:
	if _servicing or not (e is InputEventKey) or not e.pressed or e.echo:
		return
	var ids := {KEY_1: "keep", KEY_2: "soft", KEY_3: "medium", KEY_4: "hard", KEY_5: "wet"}
	if e.keycode == KEY_ENTER or e.keycode == KEY_KP_ENTER:
		start()
	elif e.keycode == KEY_ESCAPE:
		leave()
	elif ids.has(e.keycode):
		_set_tyres(null if ids[e.keycode] == "keep" else ids[e.keycode])
	else:
		return
	get_viewport().set_input_as_handled()

func start() -> void:
	if _servicing:
		return
	var st := PitService.service_time(plan, info.zones)
	if st.total <= 0.0:
		leave()
		return
	_servicing = true
	# the jobs as the crew does them (PitCrew.stop_timeline), each ticking from waiting to working to done, as iRacing's
	# pit service list and a TV pit graphic show them: no progress bar
	var ev := PitCrew.stop_timeline(plan, info.zones)
	var at := func(kind: String, wheel: int = -1):
		for e in ev:
			if e.kind == kind and (wheel < 0 or e.wheel == wheel):
				return e.at
		return null
	var fuel: float = plan.fuelL / PitService.REFUEL_LPS if plan.fuelL > 0.0 else 0.0
	var driver: float = PitService.driver_change_s() if plan.driverChange else 0.0
	var jack_up = at.call("jackUp")
	var jack_down = at.call("jackDown")
	var z = info.zones
	var repairs: Array = []
	if plan.body:
		repairs.append({"label": I18n.t("Bodywork & aero"), "seconds": PitService.body_time(z)})
	if plan.suspension:
		repairs.append({"label": I18n.t("Suspension"), "seconds": PitService.suspension_time(z)})
	if plan.engine:
		repairs.append({"label": I18n.t("Engine"), "seconds": PitService.engine_time(z)})
	var jobs: Array = []
	if driver > 0.0:
		jobs.append({"label": I18n.t("Driver change"), "from": 0.0, "to": driver})
	if fuel > 0.0:
		jobs.append({"label": I18n.t("Refuelling {l} l", {"l": roundi(plan.fuelL)}), "from": 0.0, "to": fuel})
	if jack_up != null:
		jobs.append({"label": I18n.t("Car up"), "from": jack_up, "to": jack_up + 0.35})
	var wheels := [I18n.t("Front left"), I18n.t("Front right"), I18n.t("Rear left"), I18n.t("Rear right")]
	for w in 4:
		var a = at.call("gunOff", w)
		var b = at.call("gunOn", w)
		if a != null and b != null:
			var cname: String = Tyres.COMPOUNDS[plan.tyres if plan.tyres != null else "medium"].name
			jobs.append({"label": "%s · %s" % [wheels[w], I18n.t(cname)], "from": a, "to": b + 0.7})
	if jack_up != null:
		var t0: float = jack_up + PitService.JACKS / 2.0
		for p in repairs:
			jobs.append({"label": p.label, "from": t0, "to": t0 + p.seconds})
			t0 += p.seconds
	if jack_down != null:
		jobs.append({"label": I18n.t("Car down"), "from": jack_down, "to": st.total})
	jobs.sort_custom(func(a, b): return a.from < b.from)
	_clear_col()
	_col.add_child(_head(I18n.t("PIT STOP")))
	_count = UIKit.label("%.1f" % st.total, 64, Color.WHITE, true, 800)
	_count.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_col.add_child(_count)
	_jobs.clear()
	for j in jobs:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 8)
		var mark := ColorRect.new()
		mark.custom_minimum_size = Vector2(10, 10)
		mark.color = Color(1, 1, 1, 0.25)
		row.add_child(mark)
		var l := UIKit.label(j.label, 15, UIKit.TEXT)
		l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(l)
		row.add_child(UIKit.label("%.1f s" % (j.to - j.from), 14, UIKit.MUTED, true, 700))
		_col.add_child(row)
		_jobs.append({"from": j.from, "to": j.to, "mark": mark, "label": l})
	_total.text = I18n.t("Hold the brake: the lollipop goes up when the car is down")
	_col.add_child(_total)
	_center.call_deferred()
	_on_start.call(plan, st.total)

## Service time elapsed and seconds left: the jobs' states and the countdown.
func set_progress(_u: float, left: float, elapsed: float = 0.0) -> void:
	for j in _jobs:
		var col := Color(1, 1, 1, 0.25)
		if elapsed >= j.to:
			col = UIKit.GOOD
		elif elapsed >= j.from:
			col = UIKit.ACCENT_2
		j.mark.color = col
	if _count != null:
		_count.text = "%.1f" % left if left > 0.0 else I18n.t("GO")
		_count.add_theme_color_override("font_color", UIKit.GOOD if left <= 0.0 else Color.WHITE)

func leave() -> void:
	_on_leave.call()
