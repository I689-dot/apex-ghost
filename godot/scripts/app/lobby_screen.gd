class_name LobbyScreen
extends RefCounted
## The lobby (port of App.renderLobby / lobbySetup / prepPanel / renderBriefing / renderWatch), laid out for a thumb:
## one hub with the car and the session at a glance and a single big action (start / ready), and a full page for each
## thing you can change (circuit, conditions, session, rules, car, drivers). The briefing, where each driver chooses
## tyres, wing, brake balance, fuel and the deeper setup for the final conditions, follows.

const MAP_COUNTRY := {"zandvoort": "NL", "spa": "BE"}
const CIRCUIT_NAME := {"nurburgring": "Nürburgring", "zandvoort": "Circuit Zandvoort", "spa": "Circuit de Spa-Francorchamps"}

static var _room_code := ""
static var _page := "hub"
static var _preview := ""
static var _car_filter := ""
static var _car_sent_for := ""
static var _adv_open := false

static func circuit_of(tr: Dictionary) -> String:
	var m: String = tr.get("map", tr.id)
	return "nurburgring" if m == "nordschleife" else m

static func hp(kw: float) -> int:
	return roundi(kw * 1.341)

## The phone's back button: from a page to the hub (true), or false when already on the hub.
static func back_page() -> bool:
	if _page == "hub":
		return false
	_page = "hub"
	return true

static func _cars(app: App) -> Array:
	return app.cars.cars.filter(func(c): return c.role != "safety")

static func _car_by_id(cars: Array, id: Variant) -> Dictionary:
	for c in cars:
		if c.id == id:
			return c
	return {}

## A driver starts with a car (the one they drove last): READY is never greyed out for "no car".
static func ensure_car(app: App) -> void:
	var room: Dictionary = app.room
	var mine := app.my_info()
	if room.is_empty() or mine.is_empty() or app.spectating or room.phase != "lobby" or mine.get("carId") != null or mine.get("waiting", false):
		return
	if _car_sent_for == room.code + app.me:
		return
	var cars := _cars(app)
	var pick := ""
	var last: String = str(Settings.data.get("lastCar", ""))
	for c in [_car_by_id(cars, last)] + cars:
		if c.is_empty():
			continue
		var owner = room.carLocks.get(c.id)
		if owner == null or owner == app.me:
			pick = c.id
			break
	if pick != "":
		_car_sent_for = room.code + app.me
		app.send({"t": "selectCar", "carId": pick})

# ----------------------------------------------------------------- lobby ---

static func build(app: App) -> Control:
	var room: Dictionary = app.room
	if _room_code != room.code:
		_room_code = room.code
		_page = "hub"
		_preview = ""
	var mine := app.my_info()
	var is_host: bool = mine.get("host", false)
	var edit: bool = is_host and room.phase == "lobby"
	var cars := _cars(app)
	match _page:
		"circuit", "conditions", "session", "rules":
			return _setting_page(app, _page, edit, is_host)
		"car":
			return _car_page(app, room, cars, mine)
		"drivers":
			return _drivers_page(app, room, cars, is_host and room.phase == "lobby")
	return _hub(app, room, cars, mine, is_host, edit)

static func _go(app: App, page: String) -> void:
	_page = page
	_preview = ""
	app.render_lobby()

## The common page: a back arrow and title on top, the body, an optional bottom bar.
static func _frame(title: String, sub: String, on_back: Callable, body: Control, trailing: Control = null, bottom: Control = null, back_text: String = "") -> Control:
	var top := UIW.hbox(14)
	var back := UIKit.button("‹  " + (back_text if back_text != "" else I18n.t("Back")), on_back)
	top.add_child(back)
	var head := UIW.vbox(0)
	head.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.alignment = BoxContainer.ALIGNMENT_CENTER
	head.add_child(UIKit.label(title, 30, UIKit.TEXT, true, 700))
	if sub != "":
		head.add_child(UIKit.label(sub, 15, UIKit.MUTED))
	top.add_child(head)
	if trailing != null:
		top.add_child(trailing)
	var col := UIW.vbox(12)
	col.add_child(top)
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col.add_child(body)
	if bottom != null:
		col.add_child(bottom)
	return UIW.margin(col, 18)

## A big tappable row: accent bar, kicker, value, detail and a chevron.
static func _row_card(kicker: String, value: String, detail: String, on: Variant, lead: Control = null) -> Button:
	var b := Button.new()
	b.focus_mode = Control.FOCUS_NONE
	b.custom_minimum_size = Vector2(0, 76)
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for st in ["normal", "hover", "pressed", "disabled", "focus"]:
		b.add_theme_stylebox_override(st, UIKit.box(Color(0.03, 0.035, 0.045, 0.88) if st != "pressed" else Color(UIKit.ACCENT, 0.55), Color(1, 1, 1, 0.14), 1, 4))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	UIKit.full(row)
	row.offset_left = 0
	row.offset_right = -14
	var bar := ColorRect.new()
	bar.color = UIKit.ACCENT
	bar.custom_minimum_size = Vector2(5, 0)
	bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_child(bar)
	if lead != null:
		lead.mouse_filter = Control.MOUSE_FILTER_IGNORE
		lead.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(lead)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 0)
	col.alignment = BoxContainer.ALIGNMENT_CENTER
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	col.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var k := UIKit.label(kicker.to_upper(), 13, UIKit.ACCENT_2, true, 700)
	var v := UIKit.label(value, 23, UIKit.TEXT, true, 700)
	v.clip_text = true
	var d := UIKit.label(detail, 14, UIKit.MUTED)
	d.clip_text = true
	for l in [k, v, d]:
		l.mouse_filter = Control.MOUSE_FILTER_IGNORE
		col.add_child(l)
	row.add_child(col)
	var chev := UIKit.label("›" if on != null else "", 34, UIKit.MUTED, true, 700)
	chev.mouse_filter = Control.MOUSE_FILTER_IGNORE
	chev.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(chev)
	b.add_child(row)
	if on != null:
		b.pressed.connect(on)
	else:
		b.disabled = true
		b.mouse_default_cursor_shape = Control.CURSOR_ARROW
	return b

## A labelled bar from 0 to 1 (the car's stats).
static func _stat_bar(label: String, value: String, frac: float) -> Control:
	var row := UIW.hbox(10)
	var lb := UIKit.label(label.to_upper(), 13, UIKit.MUTED, true, 700)
	lb.custom_minimum_size = Vector2(92, 0)
	row.add_child(lb)
	var pb := ProgressBar.new()
	pb.show_percentage = false
	pb.max_value = 1.0
	pb.value = clampf(frac, 0.04, 1.0)
	pb.custom_minimum_size = Vector2(0, 8)
	pb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	pb.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	pb.add_theme_stylebox_override("background", UIKit.box(Color(1, 1, 1, 0.1), Color(0, 0, 0, 0), 0, 4))
	pb.add_theme_stylebox_override("fill", UIKit.box(UIKit.ACCENT, Color(0, 0, 0, 0), 0, 4))
	row.add_child(pb)
	var vl := UIKit.label(value, 15, UIKit.TEXT, false, 700)
	vl.custom_minimum_size = Vector2(86, 0)
	vl.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	row.add_child(vl)
	return row

static func _car_stats(car: Dictionary) -> Control:
	var s: Dictionary = car.specs
	var power := hp(s.powerKw)
	var col := UIW.vbox(5)
	col.add_child(_stat_bar(I18n.t("Power"), I18n.t("{n} hp", {"n": power}), power / 700.0))
	col.add_child(_stat_bar(I18n.t("Top speed"), "%d km/h" % s.topSpeedKmh, float(s.topSpeedKmh) / 330.0))
	col.add_child(_stat_bar(I18n.t("Weight"), "%d kg" % s.massKg, float(s.massKg) / 1600.0))
	return col

static var _hero_rects: Dictionary = {}

## The car's menu picture without its empty margins (data/car_hero_rects.json, from tools/godot/make-car-bbox.py).
static func _car_image(car: Dictionary, size: Vector2) -> TextureRect:
	var img := UIW.image("res://assets/ui/cars/%s.webp" % car.id, size)
	if img.texture == null:
		img.texture = UIW.tex(car.thumbnail)
		return img
	if _hero_rects.is_empty():
		var f := FileAccess.get_file_as_string("res://data/car_hero_rects.json")
		_hero_rects = JSON.parse_string(f) if f != "" else {"": []}
	var r: Array = _hero_rects.get(car.id, [])
	if r.size() == 4:
		var at := AtlasTexture.new()
		at.atlas = img.texture
		at.region = Rect2(r[0], r[1], r[2], r[3])
		img.texture = at
	return img

static func _race_label(k: String) -> String:
	var n := int(k.substr(1))
	if k[0] == "T":
		return I18n.t("Race: {m} min + 1 lap", {"m": n})
	return I18n.t("Qualifying only") if n == 0 else I18n.t("Race: {n} laps", {"n": n})

static func _race_key(room: Dictionary) -> String:
	return ("T%d" % room.raceMinutes) if int(room.get("raceMinutes", 0)) > 0 else ("L%d" % room.raceLaps)

# ------------------------------------------------------------------- hub ---

static func _hub(app: App, room: Dictionary, cars: Array, mine: Dictionary, is_host: bool, edit: bool) -> Control:
	var c: Dictionary = room.conditions
	var track: Dictionary = app.track_entry(c.trackId)
	if track.is_empty():
		track = app.track_index[0]
	var plan := Weather.plan_weather(int(c.seed), c)
	var rules: Dictionary = room.get("rules", {})
	var rules_on := ["contact", "pitWindow", "fuel", "raceControl"].filter(func(k): return rules.get(k, false)).size()
	var car := _car_by_id(cars, mine.get("carId"))
	var solo := LocalRoom.is_local_code(room.code)

	# the car: a big card, tap to change
	var hero := Button.new()
	hero.focus_mode = Control.FOCUS_NONE
	hero.size_flags_vertical = Control.SIZE_EXPAND_FILL
	hero.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	hero.size_flags_stretch_ratio = 0.8
	for st in ["normal", "hover", "pressed", "disabled", "focus"]:
		hero.add_theme_stylebox_override(st, UIKit.box(Color(0.03, 0.035, 0.045, 0.88) if st != "pressed" else Color(UIKit.ACCENT, 0.4), Color(1, 1, 1, 0.14), 1, 4))
	var hc := VBoxContainer.new()
	hc.add_theme_constant_override("separation", 4)
	hc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	UIKit.full(hc)
	hc.offset_left = 14
	hc.offset_right = -14
	hc.offset_top = 10
	hc.offset_bottom = -10
	if car.is_empty():
		hc.alignment = BoxContainer.ALIGNMENT_CENTER
		hc.add_child(UIKit.label(I18n.t("Pick a car"), 30, UIKit.TEXT, true, 700))
	else:
		var img := _car_image(car, Vector2(0, 120))
		img.size_flags_vertical = Control.SIZE_EXPAND_FILL
		hc.add_child(img)
		hc.add_child(UIKit.label(car.name, 26, UIKit.TEXT, true, 700))
		hc.add_child(UIKit.label("%s · %s" % [car.manufacturer, car.category], 14, UIKit.MUTED))
		hc.add_child(_car_stats(car))
	var change := UIKit.label(I18n.t("Change car") + "  ›", 17, UIKit.ACCENT_2, true, 700)
	change.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	hc.add_child(change)
	for ch in hc.get_children():
		ch.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hero.add_child(hc)
	hero.disabled = room.phase != "lobby"
	hero.pressed.connect(func(): _go(app, "car"))

	# the session: a card for each thing the host can change
	var outline := TrackOutline.new(track.id, Vector2(52, 52))
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	grid.size_flags_vertical = Control.SIZE_EXPAND_FILL
	grid.size_flags_stretch_ratio = 1.0
	var open := func(p: String) -> Callable: return func(): _go(app, p)
	var km := "%.2f km" % (float(track.length) / 1000.0)
	grid.add_child(_row_card(I18n.t("Circuit"), I18n.t(track.get("name", "")), km, open.call("circuit"), outline))
	grid.add_child(_row_card(I18n.t("Conditions"), I18n.t(Weather.LABEL[plan.kind]), Weather.format_hour(plan.startHour), open.call("conditions")))
	grid.add_child(_row_card(I18n.t("Session"), _race_label.call(_race_key(room)), I18n.t("{m} min", {"m": room.sessionMinutes}) + " " + I18n.t("Qualifying").to_lower(), open.call("session")))
	grid.add_child(_row_card(I18n.t("Rules"), I18n.t("{n} of {max} on", {"n": rules_on, "max": 4}) if rules_on > 0 else I18n.t("Ghost cars"), I18n.t("Car contact") + ", " + I18n.t("Fuel and refuelling").to_lower() + "…", open.call("rules")))
	var drivers := _row_card(I18n.t("Drivers"), "%d / %d" % [room.players.size(), Const.MAX_PLAYERS], I18n.t("Add AI cars") if edit else I18n.t("Who is racing"), open.call("drivers"))
	var side := UIW.vbox(10)
	side.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	side.size_flags_stretch_ratio = 1.15
	side.add_child(grid)
	side.add_child(drivers)
	var content := UIW.hbox(14)
	content.add_child(hero)
	content.add_child(side)

	# the bottom: what is missing, and the one big action
	var hint := UIKit.label("", 16, UIKit.MUTED)
	hint.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	var connected: Array = room.players.filter(func(p): return p.connected)
	var others_ready := connected.all(func(p): return p.id == app.me or (p.carId != null and p.ready))
	var is_ready: bool = mine.get("ready", false)
	var act := UIKit.button("", Callable(), true)
	act.custom_minimum_size = Vector2(300, 72)
	act.add_theme_font_size_override("font_size", 28)
	if room.phase != "lobby" or mine.get("waiting", false):
		act.text = I18n.t("Waiting…").to_upper()
		act.disabled = true
		hint.text = I18n.t("A race is in progress. You will join the next one.")
	elif car.is_empty():
		act.text = I18n.t("Pick a car").to_upper()
		act.pressed.connect(func(): _go(app, "car"))
	elif is_host:
		act.text = I18n.t("Start race").to_upper()
		act.disabled = not others_ready
		hint.text = "" if others_ready else I18n.t("Waiting for everyone to be ready")
		act.pressed.connect(func():
			if not is_ready:
				app.send({"t": "ready", "ready": true})
			app.send({"t": "start"}))
	else:
		act.text = (I18n.t("Ready") + " ✓" if is_ready else I18n.t("Ready")).to_upper()
		hint.text = I18n.t("Waiting for the host to start") if is_ready else ""
		act.pressed.connect(func(): app.send({"t": "ready", "ready": not is_ready}))
	var bottom := UIW.hbox(14)
	bottom.add_child(hint)
	bottom.add_child(act)

	# the top: leave, where we are, settings
	var sub := ""
	if LocalRoom.is_hosted_code(room.code):
		sub = I18n.t("HOSTED ON THIS DEVICE") + " · " + I18n.t("ROOM CODE") + " " + room.code
	elif not solo:
		sub = I18n.t("ROOM CODE") + " " + room.code
	else:
		sub = I18n.t("Solo · offline")
	var right := UIW.hbox(8)
	if not solo:
		right.add_child(UIKit.button(I18n.t("Copy"), func():
			DisplayServer.clipboard_set(room.code)
			app.toast(I18n.t("Room code copied"))))
	right.add_child(UIKit.button(I18n.t("Settings"), app.open_settings))
	return _frame(I18n.t("Race setup"), sub, app.leave, content, right, bottom, I18n.t("Menu"))

# ------------------------------------------------------------- setting pages ---

static func _setting_page(app: App, page: String, edit: bool, is_host: bool) -> Control:
	var room: Dictionary = app.room
	var c: Dictionary = room.conditions
	var tracks: Array = app.track_index
	var track: Dictionary = app.track_entry(c.trackId)
	if track.is_empty():
		track = tracks[0]
	var plan := Weather.plan_weather(int(c.seed), c)
	var w0 := Weather.weather_at(plan, 0.0)
	var temp0 := Weather.temperatures(plan, w0, track.get("map", "nurburgring"))
	var rules: Dictionary = room.get("rules", {})
	var send := func(patch: Dictionary): var m := {"t": "setConditions"}; m.merge(patch); app.send(m)
	var rule_items := [
		["contact", I18n.t("Car contact"), I18n.t("Cars collide and take damage (off: ghost cars that pass through each other)")],
		["pitWindow", I18n.t("Mandatory pit stop"), I18n.t("Race: one stop with a driver change inside the pit window, as in GT World Challenge Sprint")],
		["fuel", I18n.t("Fuel and refuelling"), I18n.t("Engines burn fuel, you choose your fuel load, stops can refuel (endurance)")],
		["raceControl", I18n.t("Race control"), I18n.t("Yellow flags, full-course yellow, the safety car, blue flags and drive-through penalties")],
	]
	var title := ""
	var pane: Control
	match page:
		"circuit":
			title = I18n.t("Circuit")
			pane = _circuit_pane(app, tracks, track, edit, send)
		"conditions":
			title = I18n.t("Conditions")
			pane = _conditions_pane(c, plan, w0, temp0, edit, send)
		"session":
			title = I18n.t("Session")
			pane = _session_pane(app, room, _race_key(room), _race_label, edit, is_host)
		_:
			title = I18n.t("Rules")
			var col := UIW.vbox(16)
			for r in rule_items:
				var k: String = r[0]
				col.add_child(UIW.toggle(r[1], r[2], rules.get(k, false), (func(v): app.send({"t": "setRules", "rules": {k: v}})) if edit else null))
			pane = col
	var sub := "" if edit else I18n.t("Only the host can change this")
	var body := UIW.scroll(pane)
	return _frame(title, sub, func(): _go(app, "hub"), UIW.panel(body))

static func _circuit_pane(app: App, tracks: Array, track: Dictionary, edit: bool, send: Callable) -> Control:
	var col := UIW.vbox(14)
	var head := UIW.hbox(16)
	var preview := TextureRect.new()
	preview.custom_minimum_size = Vector2(300, 150)
	preview.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	preview.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	var map: String = track.get("map", "nurburgring")
	var sfx := "" if map == "nurburgring" or map == "nordschleife" else "_" + map
	preview.texture = UIW.tex("res://assets/ui/photo_aerial%s.webp" % sfx)
	head.add_child(preview)
	var info := UIW.vbox(4)
	info.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	info.alignment = BoxContainer.ALIGNMENT_CENTER
	info.add_child(UIW.h2(I18n.t(track.name)))
	var facts := "%.2f km · %s" % [float(track.length) / 1000.0, MAP_COUNTRY.get(track.get("map", ""), "DE")]
	if track.get("turns") != null:
		facts += " · " + I18n.t("{n} turns", {"n": int(track.turns)})
	info.add_child(UIKit.label(facts, 18, UIKit.MUTED))
	var layouts: Array = tracks.filter(func(t): return circuit_of(t) == circuit_of(track))
	if layouts.size() > 1:
		info.add_child(UIKit.label(I18n.t("Layout"), 13, UIKit.ACCENT_2, true, 700))
		info.add_child(UIW.chips(track.id, layouts.map(func(t): return [t.id, "%s · %.2f km" % [I18n.t(t.name).trim_prefix("Nürburgring ").strip_edges(), float(t.length) / 1000.0]]), func(v): send.call({"trackId": v}), edit))
	head.add_child(info)
	col.add_child(head)
	var cards := HFlowContainer.new()
	cards.add_theme_constant_override("h_separation", 10)
	cards.add_theme_constant_override("v_separation", 10)
	var seen := {}
	for t in tracks:
		var key := circuit_of(t)
		if seen.has(key):
			continue
		seen[key] = true
		var group: Array = tracks.filter(func(x): return circuit_of(x) == key)
		var on := circuit_of(track) == key
		var shown: Dictionary = track if on else group[0]
		var b := Button.new()
		b.focus_mode = Control.FOCUS_NONE
		b.custom_minimum_size = Vector2(215, 170)
		var inner := VBoxContainer.new()
		inner.mouse_filter = Control.MOUSE_FILTER_IGNORE
		inner.alignment = BoxContainer.ALIGNMENT_CENTER
		UIKit.full(inner)
		var ol := TrackOutline.new(shown.id, Vector2(86, 86))
		ol.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
		inner.add_child(ol)
		var l1 := UIKit.label(I18n.t(CIRCUIT_NAME.get(key, shown.name)), 17, UIKit.TEXT, true, 700)
		l1.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		l1.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		var l2 := UIKit.label(I18n.t("{n} layouts", {"n": group.size()}) if group.size() > 1 else "%.2f km" % (float(shown.length) / 1000.0), 14, UIKit.MUTED)
		l2.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		for l in [l1, l2]:
			l.mouse_filter = Control.MOUSE_FILTER_IGNORE
			inner.add_child(l)
		b.add_child(inner)
		b.disabled = not edit and not on
		if on:
			for st in ["normal", "hover", "pressed", "disabled"]:
				b.add_theme_stylebox_override(st, UIKit.box(UIKit.ACCENT, UIKit.ACCENT, 1, 3, Vector2(16, 10)))
		var first: String = group[0].id
		b.pressed.connect(func(): if edit and not on: send.call({"trackId": first}))
		cards.add_child(b)
	col.add_child(cards)
	return col

static func _conditions_pane(c: Dictionary, plan: Dictionary, w0: Dictionary, temp0: Dictionary, edit: bool, send: Callable) -> Control:
	var col := UIW.vbox(16)
	var weather_opts: Array = [["random", I18n.t("Random")]]
	for k in Weather.KINDS:
		weather_opts.append([k, I18n.t(Weather.LABEL[k])])
	col.add_child(UIW.field(I18n.t("Weather"), UIW.chips(c.weather, weather_opts, func(v): send.call({"weather": v}), edit)))
	var time_opts: Array = []
	for k in Weather.TIME_LABEL:
		time_opts.append([k, I18n.t(Weather.TIME_LABEL[k])])
	col.add_child(UIW.field(I18n.t("Time of day"), UIW.chips(c.time, time_opts, func(v): send.call({"time": v}), edit)))
	col.add_child(UIW.field(I18n.t("Weather changes"), UIW.chips(c.changes, [["random", I18n.t("Possible")], ["off", I18n.t("Stable")], ["on", I18n.t("Changing")]], func(v): send.call({"changes": v}), edit)))
	var state := "wet" if w0.wetness > 0.3 else ("damp" if w0.wetness > 0.05 else "dry")
	var change := I18n.t("Stable conditions")
	if plan.get("change") != null:
		change = I18n.t("{weather} from about minute {min}", {"weather": I18n.t(Weather.LABEL[plan.change.to]), "min": maxi(1, roundi(plan.change.atSec / 60.0))})
	var fc := UIW.vbox(4)
	fc.add_child(UIKit.label(I18n.t("Forecast"), 13, UIKit.ACCENT_2, true, 700))
	fc.add_child(UIKit.label("%s · %s" % [I18n.t(Weather.LABEL[plan.kind]), Weather.format_hour(plan.startHour)], 26, UIKit.TEXT, true, 700))
	fc.add_child(UIKit.label(I18n.t("%s track" % state) + " · " + change, 16, UIKit.MUTED))
	fc.add_child(UIKit.label("%s %d °C · %s %d °C" % [I18n.t("Air"), roundi(temp0.airC), I18n.t("Track"), roundi(temp0.trackC)], 18))
	if edit:
		fc.add_child(UIKit.button(I18n.t("New forecast"), func(): send.call({"reroll": true})))
	col.add_child(UIW.panel(fc))
	return col

static func _session_pane(app: App, room: Dictionary, race_key: String, race_label: Callable, edit: bool, is_host: bool) -> Control:
	# formats as the sims offer them (ACC: quick race, sprint and endurance weekends, hotlap)
	var formats := [
		["quick", I18n.t("Quick race"), 0, 10, 5, 0],
		["sprint", I18n.t("Sprint weekend"), 20, 15, 0, 30],
		["endurance", I18n.t("Endurance"), 30, 20, 0, 60],
		["hotlap", I18n.t("Hotlap"), 0, 30, 0, 0],
	]
	var fmt_now := ""
	for f in formats:
		var rm: int = int(room.get("raceMinutes", 0))
		if int(room.get("practiceMinutes", 0)) == f[2] and room.sessionMinutes == f[3] and ((rm == f[5]) if f[5] > 0 else (rm == 0 and room.raceLaps == f[4])):
			fmt_now = f[0]
	var col := UIW.vbox(16)
	col.add_child(UIW.field(I18n.t("Format"), UIW.chips(fmt_now, formats.map(func(f): return [f[0], f[1]]), func(v):
		for f in formats:
			if f[0] == v:
				app.send({"t": "setPractice", "minutes": f[2]})
				app.send({"t": "setSession", "minutes": f[3]})
				app.send({"t": "setRaceMinutes", "minutes": f[5]})
				if f[5] == 0:
					app.send({"t": "setRaceLaps", "laps": f[4]}), edit)))
	col.add_child(UIW.field(I18n.t("Free practice"), UIW.chips(int(room.get("practiceMinutes", 0)), Const.PRACTICE_MINUTE_CHOICES.map(func(m): return [m, I18n.t("No practice") if m == 0 else I18n.t("{m} min", {"m": m})]), func(v): app.send({"t": "setPractice", "minutes": int(v)}), edit)))
	col.add_child(UIW.field(I18n.t("Qualifying"), UIW.chips(int(room.sessionMinutes), Const.SESSION_MINUTES.map(func(m): return [m, I18n.t("{m} min", {"m": m})]), func(v): app.send({"t": "setSession", "minutes": int(v)}), edit)))
	var race_opts: Array = []
	for n in Const.RACE_LAP_CHOICES:
		race_opts.append(["L%d" % n, race_label.call("L%d" % n)])
	for m in Const.RACE_MINUTE_CHOICES:
		if m > 0:
			race_opts.append(["T%d" % m, race_label.call("T%d" % m)])
	col.add_child(UIW.field(I18n.t("Race"), UIW.chips(race_key, race_opts, func(v):
		var n := int(String(v).substr(1))
		if String(v)[0] == "T":
			app.send({"t": "setRaceMinutes", "minutes": n})
		else:
			app.send({"t": "setRaceMinutes", "minutes": 0})
			app.send({"t": "setRaceLaps", "laps": n}), edit)))
	if not LocalRoom.is_local_code(room.code):
		col.add_child(UIW.field(I18n.t("Room"), UIW.toggle(I18n.t("Public room"), I18n.t("Public: listed, anyone can join or watch"), room.isPublic, (func(v): app.send({"t": "setPublic", "isPublic": v})) if edit else null)))
	return col

# -------------------------------------------------------------- car page ---

static func _car_page(app: App, room: Dictionary, cars: Array, mine: Dictionary) -> Control:
	var editable: bool = room.phase == "lobby"
	var mine_car := _car_by_id(cars, mine.get("carId"))
	var shown := _car_by_id(cars, _preview)
	if shown.is_empty():
		shown = mine_car if not mine_car.is_empty() else (cars[0] if not cars.is_empty() else {})

	# the car being looked at: a big picture, the numbers and the button that takes it
	var left := UIW.vbox(8)
	left.custom_minimum_size = Vector2(380, 0)
	if not shown.is_empty():
		var img := _car_image(shown, Vector2(0, 100))
		img.size_flags_vertical = Control.SIZE_EXPAND_FILL
		left.add_child(img)
		left.add_child(UIKit.label(shown.name, 26, UIKit.TEXT, true, 700))
		var s: Dictionary = shown.specs
		left.add_child(UIKit.label("%s%s · %s · %s · %d %s" % [shown.manufacturer, (" · %d" % shown.year) if shown.get("year") else "", shown.category, s.drivetrain, s.gears.size(), I18n.t("Gears").to_lower()], 14, UIKit.MUTED))
		left.add_child(_car_stats(shown))
		var owner = room.carLocks.get(shown.id)
		var chosen: bool = mine.get("carId") == shown.id
		var take := UIKit.button(I18n.t("Selected") + " ✓" if chosen else I18n.t("Select this car"), Callable(), not chosen)
		take.custom_minimum_size = Vector2(0, 58)
		take.disabled = chosen or not editable or (owner != null and owner != app.me)
		var cid: String = shown.id
		take.pressed.connect(func():
			Settings.data["lastCar"] = cid
			Settings.save()
			app.send({"t": "selectCar", "carId": cid})
			_go(app, "hub"))
		left.add_child(take)

	# the cars, by class
	var cats: Array = []
	for c in cars:
		if not cats.has(c.category):
			cats.append(c.category)
	var chips := UIW.chips(_car_filter, [["", I18n.t("All")]] + cats.map(func(x): return [x, x]), func(v): _car_filter = v; app.render_lobby())
	var grid := GridContainer.new()
	grid.columns = 3
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	for c in cars:
		if _car_filter != "" and c.category != _car_filter:
			continue
		var owner = room.carLocks.get(c.id)
		var taken := ""
		if owner != null and owner != app.me:
			for p in room.players:
				if p.id == owner:
					taken = p.nick
		var b := Button.new()
		b.focus_mode = Control.FOCUS_NONE
		b.custom_minimum_size = Vector2(0, 142)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var chosen: bool = mine.get("carId") == c.id
		var looking: bool = not shown.is_empty() and shown.id == c.id
		for st in ["normal", "hover", "pressed", "disabled"]:
			b.add_theme_stylebox_override(st, UIKit.box(Color(UIKit.ACCENT, 0.3) if looking else Color(0.03, 0.035, 0.045, 0.85), UIKit.ACCENT if (looking or chosen) else UIKit.LINE, 2 if (looking or chosen) else 1, 4))
		var col := VBoxContainer.new()
		col.mouse_filter = Control.MOUSE_FILTER_IGNORE
		col.add_theme_constant_override("separation", 1)
		UIKit.full(col)
		col.offset_left = 8
		col.offset_right = -8
		col.offset_top = 6
		col.offset_bottom = -6
		var img := UIW.image(c.thumbnail, Vector2(0, 76))
		img.size_flags_vertical = Control.SIZE_EXPAND_FILL
		img.modulate = Color(1, 1, 1, 0.45 if taken != "" else 1.0)
		col.add_child(img)
		var nm := UIKit.label(c.name, 15, UIKit.TEXT, false, 700)
		nm.clip_text = true
		col.add_child(nm)
		var sub := UIKit.label(("✓ " + I18n.t("Your car")) if chosen else (taken if taken != "" else c.category), 13, UIKit.GOOD if chosen else (UIKit.ACCENT_2 if taken != "" else UIKit.MUTED))
		col.add_child(sub)
		for l in col.get_children():
			l.mouse_filter = Control.MOUSE_FILTER_IGNORE
		b.add_child(col)
		var cid: String = c.id
		b.pressed.connect(func(): _preview = cid; app.render_lobby())
		grid.add_child(b)
	var right := UIW.vbox(10)
	right.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	right.add_child(chips)
	right.add_child(UIW.scroll(grid))
	var body := UIW.hbox(16)
	body.add_child(UIW.panel(left, true))
	body.add_child(right)
	return _frame(I18n.t("Pick a car"), "" if editable else I18n.t("A race is in progress. You will join the next one."), func(): _go(app, "hub"), body)

# ----------------------------------------------------------- drivers page ---

static func _drivers_page(app: App, room: Dictionary, cars: Array, can_edit: bool) -> Control:
	var list := UIW.vbox(6)
	for p in room.players:
		var row := _player_row(app, p, cars, can_edit)
		list.add_child(UIW.panel(row))
	var body := UIW.vbox(10)
	body.add_child(UIW.scroll(list))
	if can_edit:
		var add := UIKit.button("+ " + I18n.t("Add bot"), func(): app.send({"t": "addBot"}))
		add.disabled = room.players.size() >= Const.MAX_PLAYERS
		add.custom_minimum_size = Vector2(0, 60)
		body.add_child(add)
	return _frame(I18n.t("Drivers {n}/{max}", {"n": room.players.size(), "max": Const.MAX_PLAYERS}), "", func(): _go(app, "hub"), body)

static func _player_row(app: App, p: Dictionary, all_cars: Array, can_remove: bool) -> Control:
	var row := UIW.hbox(12)
	var nick := UIKit.label(p.nick, 20, UIKit.ACCENT_2 if p.id == app.me else UIKit.TEXT, false, 700)
	nick.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(nick)
	if p.host:
		row.add_child(UIKit.label(I18n.t("HOST"), 13, UIKit.ACCENT_2, true, 700))
	if p.bot:
		row.add_child(UIKit.label(I18n.t("BOT"), 13, UIKit.MUTED, true, 700))
	row.add_child(UIW.image("res://assets/ui/tyre_%s.webp" % p.get("tyre", "medium"), Vector2(28, 28)))
	var car_name := I18n.t("choosing…")
	if p.carId != null:
		car_name = p.carId
		for c in all_cars:
			if c.id == p.carId:
				car_name = c.name
	elif p.waiting:
		car_name = I18n.t("next race")
	var car := UIKit.label(car_name, 15, UIKit.MUTED)
	car.clip_text = true
	car.custom_minimum_size = Vector2(190, 0)
	row.add_child(car)
	var state := UIKit.label(I18n.t("READY") if p.ready else "", 14, UIKit.GOOD, true, 700) if p.connected else UIKit.label(I18n.t("OFFLINE"), 14, UIKit.BAD, true, 700)
	state.custom_minimum_size = Vector2(70, 0)
	row.add_child(state)
	if p.bot and can_remove:
		row.add_child(UIKit.button("×", func(): app.send({"t": "removeBot", "id": p.id})))
	return row

# --------------------------------------------------------------- briefing ---

static func build_briefing(app: App) -> Control:
	var room: Dictionary = app.room
	var mine := app.my_info()
	var track := app.track_entry(room.conditions.trackId)
	var side := UIW.vbox(10)
	side.custom_minimum_size = Vector2(320, 0)
	var head := UIW.hbox(8)
	head.add_child(UIKit.label(I18n.t("BRIEFING"), 14, UIKit.MUTED, true, 700))
	var clock := UIKit.label("", 28, UIKit.TEXT, true, 700)
	head.add_child(clock)
	app._brief_clock = clock
	side.add_child(head)
	side.add_child(UIW.h2(I18n.t(track.get("name", "Nürburgring GP"))))
	side.add_child(UIW.muted(I18n.t("The conditions are final. Set up your car for them; the session loads when everyone is ready.")))
	side.add_child(UIW.h3(I18n.t("Drivers")))
	var list := UIW.vbox(4)
	for p in room.players:
		if p.carId == null or not (p.connected or p.bot) or p.waiting:
			continue
		var row := UIW.hbox(8)
		var nm := UIKit.label(p.nick, 16, UIKit.ACCENT_2 if p.id == app.me else UIKit.TEXT, false, 700)
		nm.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(nm)
		row.add_child(UIW.image("res://assets/ui/tyre_%s.webp" % p.get("tyre", "medium"), Vector2(22, 22)))
		row.add_child(UIKit.label(I18n.t("READY") if p.briefed else "…", 13, UIKit.GOOD if p.briefed else UIKit.MUTED, true, 700))
		list.add_child(row)
	side.add_child(UIW.scroll(list))
	var done: bool = mine.get("briefed", false)
	var btn := UIKit.button(I18n.t("Ready") if done else I18n.t("Ready to go"), func(): app.send({"t": "briefed"}), not done)
	btn.disabled = done
	side.add_child(btn)
	var root := UIW.hbox(18)
	root.add_child(UIW.panel(side, true))
	var main := UIW.panel(UIW.scroll(prep_panel(app, room)))
	main.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	root.add_child(main)
	return UIW.margin(root, 20)

## The player's car setup for the final conditions (tyres, wing, brake balance, fuel, advanced) with the engineer's note.
static func prep_panel(app: App, room: Dictionary) -> Control:
	var c: Dictionary = room.conditions
	var plan := Weather.plan_weather(int(c.seed), c)
	var w0 := Weather.weather_at(plan, 0.0)
	var track := app.track_entry(c.trackId)
	var temp0 := Weather.temperatures(plan, w0, track.get("map", "nurburgring"))
	var rec := CarSetup.recommend_setup(plan)
	var cs: Dictionary = Settings.data.carSetup
	var save := func(): Settings.save(); app.render_briefing()
	var col := UIW.vbox(12)
	var state := "wet" if w0.wetness > 0.3 else ("damp" if w0.wetness > 0.05 else "dry")
	var change := I18n.t("Stable conditions")
	if plan.get("change") != null:
		change = I18n.t("{weather} from about minute {min}", {"weather": I18n.t(Weather.LABEL[plan.change.to]), "min": maxi(1, roundi(plan.change.atSec / 60.0))})
	var fc := UIW.vbox(2)
	fc.add_child(UIKit.label(I18n.t("Forecast: {weather} · {hour} · {state}", {"weather": I18n.t(Weather.LABEL[plan.kind]), "hour": Weather.format_hour(plan.startHour), "state": I18n.t("%s track" % state)}), 18, UIKit.TEXT, false, 700))
	fc.add_child(UIKit.label(change, 15, UIKit.MUTED))
	fc.add_child(UIKit.label(I18n.t("Air {air} °C · track {track} °C at the start", {"air": roundi(temp0.airC), "track": roundi(temp0.trackC)}), 15, UIKit.MUTED))
	col.add_child(UIW.panel(fc))
	# the engineer's advice comes first: one tap sets the tyre and wing for these conditions
	var eng := UIW.hbox(14)
	var note := UIW.muted(I18n.t("Engineer: {note}.", {"note": rec.note}), 16)
	note.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	eng.add_child(note)
	var use := UIKit.button(I18n.t("Use {tyre} + {wing} wing", {"tyre": I18n.t(Tyres.COMPOUNDS[rec.tyre].name), "wing": I18n.t(CarSetup.WING[rec.wing].label).split(" (")[0].to_lower()}), func():
		cs.tyre = rec.tyre
		cs.wing = rec.wing
		app.send({"t": "setTyre", "tyre": rec.tyre})
		save.call(), cs.tyre != rec.tyre or cs.wing != rec.wing)
	eng.add_child(use)
	col.add_child(UIW.panel(eng))
	col.add_child(UIW.h3(I18n.t("Your car")))
	# tyres
	var tyres := HFlowContainer.new()
	tyres.add_theme_constant_override("h_separation", 8)
	for id in ["soft", "medium", "hard", "wet"]:
		var comp: Dictionary = Tyres.COMPOUNDS[id]
		var b := Button.new()
		b.focus_mode = Control.FOCUS_NONE
		b.icon = UIW.tex("res://assets/ui/tyre_%s.webp" % id)
		b.expand_icon = true
		b.custom_minimum_size = Vector2(130, 64)
		b.text = I18n.t(comp.name)
		b.tooltip_text = I18n.t("{name}: grip {dry} % dry / {wet} % wet, wear ×{wear}", {"name": I18n.t(comp.name), "dry": roundi(comp.grip * 100), "wet": roundi(comp.wetGrip * 100), "wear": comp.wear})
		if cs.tyre == id:
			for st in ["normal", "hover", "pressed"]:
				b.add_theme_stylebox_override(st, UIKit.box(UIKit.ACCENT, UIKit.ACCENT, 1, 3, Vector2(10, 6)))
		var tid: String = id
		b.pressed.connect(func():
			cs.tyre = tid
			app.send({"t": "setTyre", "tyre": tid})
			save.call())
		tyres.add_child(b)
	col.add_child(UIW.field(I18n.t("Tyres"), tyres))
	col.add_child(_tyre_guide())
	var wing_opts: Array = []
	for k in ["low", "medium", "high"]:
		wing_opts.append([k, I18n.t(CarSetup.WING[k].label)])
	col.add_child(UIW.field(I18n.t("Rear wing"), UIW.select(cs.wing, wing_opts, func(v): cs.wing = v; save.call())))
	var bias_out := UIKit.label(I18n.t("{pct} % front", {"pct": roundi(cs.brakeBias * 100)}), 15, UIKit.MUTED)
	var bias := UIW.slider(cs.brakeBias, 0.54, 0.66, 0.01, func(v):
		cs.brakeBias = v
		bias_out.text = I18n.t("{pct} % front", {"pct": roundi(v * 100)})
		Settings.save())
	var br := UIW.hbox(10)
	br.add_child(bias)
	br.add_child(bias_out)
	col.add_child(UIW.field(I18n.t("Brake balance"), br))
	if room.get("rules", {}).get("fuel", false):
		col.add_child(_fuel_row(room, float(track.get("length", 5000)), cs))
	col.add_child(_advanced(app, cs, temp0.airC))
	return col

static func _tyre_guide() -> Control:
	var note := {
		"soft": "Fastest over one lap and warms up quickly, but wears about twice as fast as the Medium.",
		"medium": "The all-rounder: good grip that lasts a long run.",
		"hard": "Lasts the longest, but has the least grip and needs more time to warm up.",
		"wet": "For a wet track: the grooves clear the water. On a drying track it overheats and wears fast.",
	}
	var ids := ["soft", "medium", "hard", "wet"]
	var max_life := 0.0
	var max_warm := 0.0
	for i in ids:
		max_life = maxf(max_life, 1.0 / Tyres.COMPOUNDS[i].wear)
		max_warm = maxf(max_warm, 1.0 / Tyres.COMPOUNDS[i].heatCap)
	var grid := GridContainer.new()
	grid.columns = 4
	grid.add_theme_constant_override("h_separation", 8)
	for id in ids:
		var cm: Dictionary = Tyres.COMPOUNDS[id]
		var card := UIW.vbox(3)
		card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		card.add_child(UIKit.label(I18n.t(cm.name), 16, UIKit.TEXT, true, 700))
		for bar in [[I18n.t("Dry grip"), (cm.grip - 0.8) / 0.25], [I18n.t("Wet grip"), cm.wetGrip / 0.8], [I18n.t("Life"), 1.0 / cm.wear / max_life], [I18n.t("Warm-up"), 1.0 / cm.heatCap / max_warm]]:
			var row := UIW.hbox(6)
			var lb := UIKit.label(bar[0], 11, UIKit.MUTED)
			lb.custom_minimum_size = Vector2(60, 0)
			row.add_child(lb)
			var pb := ProgressBar.new()
			pb.show_percentage = false
			pb.max_value = 1.0
			pb.value = clampf(bar[1], 0.06, 1.0)
			pb.custom_minimum_size = Vector2(0, 8)
			pb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			pb.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			row.add_child(pb)
			card.add_child(row)
		card.add_child(UIW.muted(I18n.t(note[id]), 11))
		grid.add_child(card)
	var col := UIW.vbox(6)
	col.add_child(UIW.h3(I18n.t("Which tyre?")))
	col.add_child(grid)
	col.add_child(UIW.muted(I18n.t("Rain or a drying track can change the best choice during the session: you can change tyres in the pit box (pit lane next to the start).")))
	return UIW.panel(col)

static func _fuel_row(room: Dictionary, track_m: float, cs: Dictionary) -> Control:
	var per_lap := (track_m / 1000.0) * VehicleConsts.FUEL.perKm
	var timed: bool = int(room.get("raceMinutes", 0)) > 0
	var laps: int = (ceili((room.raceMinutes * 60.0) / (track_m / 43.0)) + 1) if timed else int(room.raceLaps)
	var need = mini(int(VehicleConsts.FUEL.tankL), ceili((laps + 1) * per_lap)) if laps > 0 else null
	var out := UIKit.label("", 15, UIKit.MUTED)
	var show := func(): out.text = I18n.t("{l} l · ~{laps} laps · {kg} kg", {"l": cs.fuelL, "laps": "%.1f" % (cs.fuelL / per_lap), "kg": roundi(cs.fuelL * VehicleConsts.FUEL.kgPerL)})
	show.call()
	var slider := UIW.slider(cs.fuelL, 10, VehicleConsts.FUEL.tankL, 1, func(v): cs.fuelL = int(v); show.call(); Settings.save())
	var row := UIW.hbox(10)
	row.add_child(slider)
	row.add_child(out)
	var col := UIW.vbox(6)
	col.add_child(UIW.field(I18n.t("Fuel"), row))
	var note: String = I18n.t("The race needs ~{need} l ({per} l a lap). Less is lighter and faster, but you will have to refuel.", {"need": need, "per": "%.1f" % per_lap}) if need != null else I18n.t("About {per} l a lap. Less fuel is lighter and faster.", {"per": "%.1f" % per_lap})
	var rules: Dictionary = room.get("rules", {})
	if laps > 1 and rules.get("pitWindow", false) and not timed:
		var w := RaceTracker.pit_window_laps(laps)
		note += " " + I18n.t("Mandatory stop on laps {a}–{b}.", {"a": w.open, "b": w.close})
	if timed and rules.get("pitWindow", false):
		note += " " + I18n.t("Mandatory stop: into the pit lane between {a} and {b} min.", {"a": roundi(room.raceMinutes * RaceTracker.PIT_WINDOW.timedOpenShare), "b": roundi(room.raceMinutes * RaceTracker.PIT_WINDOW.timedCloseShare)})
	col.add_child(UIW.muted(note))
	if need != null:
		col.add_child(UIKit.button(I18n.t("Fuel for the whole race ({l} l)", {"l": need}), func():
			cs.fuelL = need
			slider.value = need
			Settings.save()))
	return col

static func _advanced(app: App, cs: Dictionary, air_c: float) -> Control:
	var opt: float = Tyres.COMPOUNDS[cs.tyre].optimumC
	var set_c := air_c + 12.0
	var ideal := VehicleConsts.ideal_cold_psi(opt, set_c)
	var P := VehicleConsts.TYRE_PRESSURE
	var hot := func(cold: float) -> float: return (cold + P.atmPsi) * ((opt + 273.15) / (set_c + 273.15)) - P.atmPsi
	var body := UIW.vbox(8)
	var auto: bool = cs.pressure == null
	body.add_child(UIW.toggle(I18n.t("Crew sets the tyre pressures ({p} psi cold → {hot} psi hot)", {"p": "%.1f" % ideal, "hot": P.targetPsi}), "", auto, func(v):
		cs.pressure = null if v else [ideal, ideal]
		Settings.save()
		app.render_briefing()))
	var slider := func(value: float, lo: float, hi: float, step: float, fmt: Callable, on: Callable) -> Control:
		var out := UIKit.label(fmt.call(value), 14, UIKit.MUTED)
		var s := UIW.slider(value, lo, hi, step, func(v): on.call(v); out.text = fmt.call(v); Settings.save())
		var r := UIW.hbox(8)
		r.add_child(s)
		r.add_child(out)
		return r
	var pair := func(label: String, make: Callable) -> Control:
		var p := UIW.vbox(2)
		p.add_child(UIW.h3(label))
		var r := UIW.hbox(14)
		for axle in 2:
			var cell := UIW.vbox(2)
			cell.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			cell.add_child(UIKit.label(I18n.t("Front") if axle == 0 else I18n.t("Rear"), 12, UIKit.MUTED))
			cell.add_child(make.call(axle))
			r.add_child(cell)
		p.add_child(r)
		return p
	if not auto:
		body.add_child(pair.call(I18n.t("Tyre pressure (cold)"), func(axle): return slider.call(
			(cs.pressure if cs.pressure != null else [ideal, ideal])[axle], P.minColdPsi, P.maxColdPsi, 0.1,
			func(v): return I18n.t("{p} psi → ~{hot} hot", {"p": "%.1f" % v, "hot": "%.1f" % hot.call(v)}),
			func(v):
				if cs.pressure == null:
					cs.pressure = [ideal, ideal]
				cs.pressure[axle] = v)))
	body.add_child(pair.call(I18n.t("Ride height"), func(axle): return slider.call(cs.ride[axle], -CarSetup.SETUP.rideMm, CarSetup.SETUP.rideMm, 1,
		func(v): return I18n.t("baseline") if int(v) == 0 else "%s%d mm" % ["+" if v > 0 else "", int(v)], func(v): cs.ride[axle] = int(v))))
	var clicks := func(key: String, soft: String, stiff: String) -> Callable:
		return func(axle): return slider.call(cs[key][axle], 1, CarSetup.SETUP.clicks, 1,
			func(v): return "%d%s" % [int(v), (" (%s)" % I18n.t("baseline")) if int(v) == CarSetup.SETUP.baseline else (" · " + soft if v < CarSetup.SETUP.baseline else " · " + stiff)],
			func(v): cs[key][axle] = int(v))
	body.add_child(pair.call(I18n.t("Anti-roll bar"), clicks.call("arb", I18n.t("soft"), I18n.t("stiff"))))
	body.add_child(pair.call(I18n.t("Dampers: bump"), clicks.call("bump", I18n.t("soft"), I18n.t("stiff"))))
	body.add_child(pair.call(I18n.t("Dampers: rebound"), clicks.call("rebound", I18n.t("soft"), I18n.t("stiff"))))
	body.add_child(UIW.muted(I18n.t("Hot target {p} psi: too low runs hot and soft, too high loses grip. Lower = more downforce but it bottoms over kerbs; rear higher than front moves grip to the front. A stiffer anti-roll bar takes grip from its axle (stiff front = understeer). Stiffer dampers react faster but skip over bumps.", {"p": P.targetPsi}), 12))
	body.add_child(UIKit.button(I18n.t("Reset to baseline"), func():
		cs.pressure = null
		cs.ride = [0, 0]
		cs.arb = [4, 4]
		cs.bump = [4, 4]
		cs.rebound = [4, 4]
		Settings.save()
		app.render_briefing()))
	var box := UIW.vbox(6)
	var toggle := UIKit.button(("▾ " if _adv_open else "▸ ") + I18n.t("Advanced setup: pressures, ride height, anti-roll bars, dampers"))
	toggle.pressed.connect(func():
		_adv_open = not _adv_open
		app.render_briefing())
	box.add_child(toggle)
	if _adv_open:
		box.add_child(body)
	return box

# ------------------------------------------------------------------ watch ---

## Watching (spectator connection): the room as it is, waiting for the next session.
static func build_watch(app: App) -> Control:
	var room: Dictionary = app.room
	var col := UIW.vbox(10)
	col.set_anchors_preset(Control.PRESET_CENTER)
	col.add_child(UIW.h2(I18n.t("Watching room {code}", {"code": room.get("code", "")})))
	col.add_child(UIW.muted(I18n.t("Watching this room: the next session will show here.")))
	for p in room.get("players", []):
		col.add_child(UIKit.label("%s%s" % [p.nick, "  (BOT)" if p.bot else ""], 18))
	col.add_child(UIKit.button(I18n.t("Leave"), app.leave))
	var c := CenterContainer.new()
	c.add_child(UIW.panel(col, true))
	return c
