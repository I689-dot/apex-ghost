class_name LobbyScreen
extends RefCounted
## The lobby (port of App.renderLobby / lobbySetup / prepPanel / renderBriefing / renderWatch): a stepped setup
## (circuit, conditions, session, rules, car) the host edits and everyone sees, the driver list, and the briefing where
## each driver chooses tyres, wing, brake balance, fuel and the deeper setup for the final conditions.

const MAP_COUNTRY := {"zandvoort": "NL", "spa": "BE"}
const CIRCUIT_NAME := {"nurburgring": "Nürburgring", "zandvoort": "Circuit Zandvoort", "spa": "Circuit de Spa-Francorchamps"}
const STEPS := ["circuit", "conditions", "session", "rules", "car"]

static var _step := {"room": "", "step": "car"}
static var _adv_open := false

static func circuit_of(tr: Dictionary) -> String:
	var m: String = tr.get("map", tr.id)
	return "nurburgring" if m == "nordschleife" else m

static func hp(kw: float) -> int:
	return roundi(kw * 1.341)

# ----------------------------------------------------------------- lobby ---

static func build(app: App) -> Control:
	var room: Dictionary = app.room
	var mine := app.my_info()
	var is_host: bool = mine.get("host", false)
	var all_cars: Array = app.cars.cars.filter(func(c): return c.role != "safety")
	var connected: Array = room.players.filter(func(p): return p.connected)
	var all_ready := connected.size() > 0 and connected.all(func(p): return p.carId != null and p.ready)

	var side := UIW.vbox(10)
	side.custom_minimum_size = Vector2(300, 0)
	if LocalRoom.is_hosted_code(room.code):
		side.add_child(UIW.h3(I18n.t("HOSTED ON THIS DEVICE")))
		side.add_child(UIKit.label(room.code, 40, UIKit.TEXT, true, 700))
	elif LocalRoom.is_local_code(room.code):
		side.add_child(UIW.h3(I18n.t("Solo · offline")))
	else:
		side.add_child(UIW.h3(I18n.t("ROOM CODE")))
		var row := UIW.hbox(8)
		row.add_child(UIKit.label(room.code, 40, UIKit.TEXT, true, 700))
		row.add_child(UIKit.button(I18n.t("Copy"), func():
			DisplayServer.clipboard_set(room.code)
			app.toast(I18n.t("Room code copied"))))
		side.add_child(row)
	side.add_child(UIW.h3(I18n.t("Drivers {n}/{max}", {"n": room.players.size(), "max": Const.MAX_PLAYERS})))
	var list := UIW.vbox(4)
	for p in room.players:
		list.add_child(_player_row(app, p, all_cars, is_host and room.phase == "lobby"))
	side.add_child(UIW.scroll(list))
	if is_host and room.phase == "lobby":
		var add := UIKit.button(I18n.t("+ Add bot"), func(): app.send({"t": "addBot"}))
		add.disabled = room.players.size() >= Const.MAX_PLAYERS
		side.add_child(add)
	var ready_btn := UIKit.button(I18n.t("Ready"), func(): app.send({"t": "ready", "ready": not mine.get("ready", false)}), mine.get("ready", false))
	ready_btn.disabled = mine.get("carId") == null or room.phase != "lobby" or mine.get("waiting", false)
	side.add_child(ready_btn)
	if is_host:
		var start := UIKit.button(I18n.t("Start race"), func(): app.send({"t": "start"}), true)
		start.disabled = not all_ready or room.phase != "lobby"
		side.add_child(start)
	else:
		side.add_child(UIW.muted(I18n.t("Waiting for the host to start") if all_ready else I18n.t("Waiting for everyone to be ready")))
	var foot := UIW.hbox(8)
	foot.add_child(UIKit.button(I18n.t("Settings"), app.open_settings))
	foot.add_child(UIKit.button(I18n.t("Leave"), app.leave))
	side.add_child(foot)

	var main := UIW.vbox(10)
	main.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	main.size_flags_vertical = Control.SIZE_EXPAND_FILL
	if room.phase != "lobby":
		main.add_child(UIKit.label(I18n.t("A race is in progress. You will join the next one."), 18, UIKit.ACCENT_2))
	var setup := UIW.panel(_setup(app, is_host, all_cars, mine))
	setup.size_flags_vertical = Control.SIZE_EXPAND_FILL
	main.add_child(setup)

	var root := UIW.hbox(18)
	root.add_child(UIW.panel(side, true))
	root.add_child(main)
	return UIW.margin(root, 20)

static func _player_row(app: App, p: Dictionary, all_cars: Array, can_remove: bool) -> Control:
	var row := UIW.hbox(8)
	var nick := UIKit.label(p.nick, 17, UIKit.ACCENT_2 if p.id == app.me else UIKit.TEXT, false, 700)
	nick.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(nick)
	if p.host:
		row.add_child(UIKit.label(I18n.t("HOST"), 11, UIKit.ACCENT_2, true, 700))
	if p.bot:
		row.add_child(UIKit.label(I18n.t("BOT"), 11, UIKit.MUTED, true, 700))
	var tyre := UIW.image("res://assets/ui/tyre_%s.webp" % p.get("tyre", "medium"), Vector2(22, 22))
	row.add_child(tyre)
	var car_name := I18n.t("choosing…")
	if p.carId != null:
		car_name = p.carId
		for c in all_cars:
			if c.id == p.carId:
				car_name = c.name
	elif p.waiting:
		car_name = I18n.t("next race")
	var car := UIKit.label(car_name, 13, UIKit.MUTED)
	car.clip_text = true
	car.custom_minimum_size = Vector2(90, 0)
	row.add_child(car)
	row.add_child(UIKit.label(I18n.t("READY") if p.ready else "", 12, UIKit.GOOD, true, 700) if p.connected else UIKit.label(I18n.t("OFFLINE"), 12, UIKit.BAD, true, 700))
	if p.bot and can_remove:
		row.add_child(UIKit.button("×", func(): app.send({"t": "removeBot", "id": p.id})))
	return row

static func _setup(app: App, is_host: bool, all_cars: Array, mine: Dictionary) -> Control:
	var room: Dictionary = app.room
	var c: Dictionary = room.conditions
	var edit: bool = is_host and room.phase == "lobby"
	if _step.room != room.code:
		_step = {"room": room.code, "step": "circuit" if is_host else "car"}
	var step: String = _step.step
	var tracks: Array = app.track_index
	var track: Dictionary = app.track_entry(c.trackId)
	if track.is_empty():
		track = tracks[0]
	var plan := Weather.plan_weather(int(c.seed), c)
	var w0 := Weather.weather_at(plan, 0.0)
	var temp0 := Weather.temperatures(plan, w0, track.get("map", "nurburgring"))
	var rules: Dictionary = room.get("rules", {})
	var race_key := ("T%d" % room.raceMinutes) if int(room.get("raceMinutes", 0)) > 0 else ("L%d" % room.raceLaps)
	var race_label := func(k: String) -> String:
		var n := int(k.substr(1))
		if k[0] == "T":
			return I18n.t("Race: {m} min + 1 lap", {"m": n})
		return I18n.t("Qualifying only") if n == 0 else I18n.t("Race: {n} laps", {"n": n})
	var send := func(patch: Dictionary): var m := {"t": "setConditions"}; m.merge(patch); app.send(m)
	var rule_items := [
		["contact", I18n.t("Car contact"), I18n.t("Cars collide and take damage (off: ghost cars that pass through each other)")],
		["pitWindow", I18n.t("Mandatory pit stop"), I18n.t("Race: one stop with a driver change inside the pit window, as in GT World Challenge Sprint")],
		["fuel", I18n.t("Fuel and refuelling"), I18n.t("Engines burn fuel, you choose your fuel load, stops can refuel (endurance)")],
		["raceControl", I18n.t("Race control"), I18n.t("Yellow flags, full-course yellow, the safety car, blue flags and drive-through penalties")],
	]
	var rules_on := rule_items.filter(func(r): return rules.get(r[0], false)).size()
	var car_name := ""
	for car in all_cars:
		if car.id == mine.get("carId"):
			car_name = car.name
	var steps := [
		["circuit", I18n.t("Circuit"), I18n.t(track.get("name", ""))],
		["conditions", I18n.t("Conditions"), "%s · %s" % [I18n.t(Weather.LABEL[plan.kind]), Weather.format_hour(plan.startHour)]],
		["session", I18n.t("Session"), race_label.call(race_key)],
		["rules", I18n.t("Rules"), I18n.t("{n} of {max} on", {"n": rules_on, "max": rule_items.size()}) if rules_on > 0 else I18n.t("Ghost cars")],
		["car", I18n.t("Car"), car_name if car_name != "" else I18n.t("Pick a car")],
	]
	var go := func(s: String): _step.step = s; app.render_lobby()
	var at := STEPS.find(step)

	var pane: Control
	match step:
		"circuit":
			pane = _circuit_pane(app, tracks, track, edit, send)
		"conditions":
			pane = _conditions_pane(c, plan, w0, temp0, edit, send)
		"session":
			pane = _session_pane(app, room, race_key, race_label, edit, is_host)
		"rules":
			var col := UIW.vbox(14)
			for r in rule_items:
				var k: String = r[0]
				col.add_child(UIW.toggle(r[1], r[2], rules.get(k, false), (func(v): app.send({"t": "setRules", "rules": {k: v}})) if edit else null))
			pane = col
		_:
			pane = _car_pane(app, room, all_cars, mine)

	var nav := UIW.hbox(6)
	for i in steps.size():
		var s: Array = steps[i]
		var b := Button.new()
		b.focus_mode = Control.FOCUS_NONE
		b.text = "%02d  %s\n%s" % [i + 1, String(s[1]).to_upper(), s[2]]
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.clip_text = true
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		var on: bool = s[0] == step
		for st in ["normal", "hover", "pressed"]:
			b.add_theme_stylebox_override(st, UIKit.box(Color(UIKit.ACCENT, 0.9) if on else Color(1, 1, 1, 0.05 if i >= at else 0.1), UIKit.LINE, 1, 3, Vector2(12, 8)))
		b.add_theme_font_size_override("font_size", 14)
		var key: String = s[0]
		b.pressed.connect(func(): go.call(key))
		nav.add_child(b)
	var foot := UIW.hbox(8)
	if at > 0:
		var pk: String = STEPS[at - 1]
		foot.add_child(UIKit.button("‹ " + String(steps[at - 1][1]), func(): go.call(pk)))
	foot.add_child(UIW.spacer())
	if at < STEPS.size() - 1:
		var nk: String = STEPS[at + 1]
		foot.add_child(UIKit.button(String(steps[at + 1][1]) + " ›", func(): go.call(nk), true))

	var col := UIW.vbox(10)
	col.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col.add_child(nav)
	var body := UIW.scroll(pane)
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col.add_child(body)
	col.add_child(foot)
	return col

static func _circuit_pane(app: App, tracks: Array, track: Dictionary, edit: bool, send: Callable) -> Control:
	var col := UIW.vbox(12)
	var info := UIW.vbox(6)
	info.add_child(UIKit.label(I18n.t("Selected circuit") if edit else I18n.t("The host chose"), 13, UIKit.ACCENT_2, true, 700))
	info.add_child(UIW.h2(I18n.t(track.name)))
	var facts := "%.2f km · %s" % [float(track.length) / 1000.0, MAP_COUNTRY.get(track.get("map", ""), "DE")]
	if track.get("turns") != null:
		facts += " · " + I18n.t("{n} turns", {"n": track.turns})
	info.add_child(UIKit.label(facts, 18, UIKit.MUTED))
	var layouts: Array = tracks.filter(func(t): return circuit_of(t) == circuit_of(track))
	if layouts.size() > 1:
		info.add_child(UIKit.label(I18n.t("Layout"), 13, UIKit.ACCENT_2, true, 700))
		info.add_child(UIW.chips(track.id, layouts.map(func(t): return [t.id, "%s · %.2f km" % [I18n.t(t.name).trim_prefix("Nürburgring ").strip_edges(), float(t.length) / 1000.0]]), func(v): send.call({"trackId": v}), edit))
	var preview := TextureRect.new()
	preview.custom_minimum_size = Vector2(0, 170)
	preview.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	preview.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	var map: String = track.get("map", "nurburgring")
	var sfx := "" if map == "nurburgring" or map == "nordschleife" else "_" + map
	preview.texture = UIW.tex("res://assets/ui/photo_aerial%s.webp" % sfx)
	col.add_child(preview)
	col.add_child(info)
	var cards := HFlowContainer.new()
	cards.add_theme_constant_override("h_separation", 8)
	cards.add_theme_constant_override("v_separation", 8)
	var seen := {}
	for t in tracks:
		var key := circuit_of(t)
		if seen.has(key):
			continue
		seen[key] = true
		var group: Array = tracks.filter(func(x): return circuit_of(x) == key)
		var on := circuit_of(track) == key
		var shown: Dictionary = track if on else group[0]
		var b := UIKit.button("%s\n%s" % [I18n.t(CIRCUIT_NAME.get(key, shown.name)), I18n.t("{n} layouts", {"n": group.size()}) if group.size() > 1 else "%.2f km" % (float(shown.length) / 1000.0)])
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
	var col := UIW.vbox(14)
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
	fc.add_child(UIKit.label("%s · %s" % [I18n.t(Weather.LABEL[plan.kind]), Weather.format_hour(plan.startHour)], 24, UIKit.TEXT, true, 700))
	fc.add_child(UIKit.label(I18n.t("%s track" % state), 16, UIKit.MUTED))
	fc.add_child(UIKit.label(change, 16, UIKit.MUTED))
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
	var col := UIW.vbox(14)
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

static func _car_pane(app: App, room: Dictionary, all_cars: Array, mine: Dictionary) -> Control:
	var browsing: Dictionary = {}
	for c in all_cars:
		if c.id == (app.browsing if app.browsing != "" else mine.get("carId")):
			browsing = c
	if browsing.is_empty():
		for c in all_cars:
			if c.id == mine.get("carId"):
				browsing = c
	var root := UIW.hbox(14)
	var spec := UIW.vbox(4)
	spec.custom_minimum_size = Vector2(300, 0)
	if browsing.is_empty():
		spec.add_child(UIW.h2(I18n.t("Pick a car")))
	else:
		var hero := UIW.image("res://assets/ui/cars/%s.webp" % browsing.id, Vector2(300, 170))
		if hero.texture == null:
			hero.texture = UIW.tex(browsing.thumbnail)
		spec.add_child(hero)
		spec.add_child(UIW.h2(browsing.name))
		spec.add_child(UIKit.label("%s%s · %s" % [browsing.manufacturer, (" · %d" % browsing.year) if browsing.get("year") else "", browsing.category], 15, UIKit.MUTED))
		var s: Dictionary = browsing.specs
		var rows := [
			[I18n.t("Power"), I18n.t("{n} hp", {"n": hp(s.powerKw)})], [I18n.t("Weight (with driver)"), "%d kg" % s.massKg],
			[I18n.t("Drivetrain"), s.drivetrain], [I18n.t("Top speed"), "%d km/h" % s.topSpeedKmh], [I18n.t("Gears"), str(s.gears.size())],
			[I18n.t("Steering lock"), "%d°" % SteeringLock.lock_deg(browsing.id)],
			[I18n.t("Power-to-weight"), "%.2f kg/hp" % (float(s.massKg) / hp(s.powerKw))],
		]
		if browsing.get("info") != null:
			rows.append_array([[I18n.t("Engine"), I18n.t(browsing.info.engine)], [I18n.t("Gearbox"), I18n.t(browsing.info.gearbox)], [I18n.t("Team"), I18n.t(browsing.info.team)]])
		for r in rows:
			var line := UIW.hbox(8)
			var k := UIKit.label(r[0], 14, UIKit.MUTED)
			k.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			line.add_child(k)
			line.add_child(UIKit.label(str(r[1]), 14, UIKit.TEXT, false, 600))
			spec.add_child(line)
	root.add_child(spec)
	var grid := GridContainer.new()
	grid.columns = 3
	grid.add_theme_constant_override("h_separation", 8)
	grid.add_theme_constant_override("v_separation", 8)
	grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for c in all_cars:
		var owner = room.carLocks.get(c.id)
		var taken := ""
		if owner != null and owner != app.me:
			for p in room.players:
				if p.id == owner:
					taken = p.nick
		var b := Button.new()
		b.focus_mode = Control.FOCUS_NONE
		b.disabled = taken != "" or room.phase != "lobby"
		b.custom_minimum_size = Vector2(0, 120)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var selected: bool = mine.get("carId") == c.id
		for st in ["normal", "hover", "pressed", "disabled"]:
			b.add_theme_stylebox_override(st, UIKit.box(Color(UIKit.ACCENT, 0.35) if selected else Color(1, 1, 1, 0.05), UIKit.ACCENT if selected else UIKit.LINE, 1, 3))
		var col := VBoxContainer.new()
		col.mouse_filter = Control.MOUSE_FILTER_IGNORE
		UIKit.full(col)
		col.offset_left = 6
		col.offset_right = -6
		col.offset_top = 4
		var img := UIW.image(c.thumbnail, Vector2(0, 70))
		img.mouse_filter = Control.MOUSE_FILTER_IGNORE
		col.add_child(img)
		var nm := UIKit.label(c.name, 13, UIKit.TEXT, false, 600)
		nm.clip_text = true
		nm.mouse_filter = Control.MOUSE_FILTER_IGNORE
		col.add_child(nm)
		var sub := UIKit.label(taken if taken != "" else c.category, 12, UIKit.ACCENT_2 if taken != "" else UIKit.MUTED)
		sub.mouse_filter = Control.MOUSE_FILTER_IGNORE
		col.add_child(sub)
		b.add_child(col)
		var cid: String = c.id
		b.pressed.connect(func():
			app.browsing = cid
			app.send({"t": "selectCar", "carId": cid}))
		grid.add_child(b)
	root.add_child(grid)
	return root

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
	var eng := UIW.hbox(10)
	var note := UIW.muted(I18n.t("Engineer: {note}.", {"note": rec.note}))
	note.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	eng.add_child(note)
	eng.add_child(UIKit.button(I18n.t("Use {tyre} + {wing} wing", {"tyre": I18n.t(Tyres.COMPOUNDS[rec.tyre].name), "wing": I18n.t(CarSetup.WING[rec.wing].label).split(" (")[0].to_lower()}), func():
		cs.tyre = rec.tyre
		cs.wing = rec.wing
		app.send({"t": "setTyre", "tyre": rec.tyre})
		save.call()))
	col.add_child(UIW.panel(eng))
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
