class_name LobbyScreen
extends RefCounted
## The lobby (port of App.renderLobby / lobbySetup / prepPanel / renderBriefing / renderWatch), laid out as Le Mans
## Ultimate's race weekend: tabs for the Overview (the circuit as a headline, the sessions as cards, the car, the room's
## facts), the Circuit (its drawing, its layouts, a strip of circuits), the Car (a big picture, the numbers, a strip of
## cars by class), the Event (session, conditions and rules as rows of steppers and switches) and the Drivers (the
## entry list); the screen's one big action (start / ready) stays at the bottom right on every tab. The briefing, where
## each driver chooses tyres, wing, brake balance, fuel and the deeper setup for the final conditions, follows.

const MAP_COUNTRY := {"zandvoort": "NL", "spa": "BE"}
const CIRCUIT_NAME := {"nurburgring": "Nürburgring", "zandvoort": "Circuit Zandvoort", "spa": "Circuit de Spa-Francorchamps"}
## Where each circuit is, and when the drawn layout first opened (the GP-Strecke 1984, the Nordschleife 1927).
const LOCATION := {"nurburgring": "Nürburg, Germany", "nordschleife": "Nürburg, Germany", "spa": "Stavelot, Belgium", "zandvoort": "Zandvoort, Netherlands"}
const OPENED := {"nurburgring": 1984, "nordschleife": 1927, "spa": 1921, "zandvoort": 1948}

static var _room_code := ""
static var _page := "hub"
static var _preview := ""
static var _car_filter := ""
static var _car_sent_for := ""
static var _adv_open := false
## The briefing's page: setup, advanced or saved.
static var _brief_tab := "setup"

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
		# your paint, for the others to see
		app.send({"t": "setLivery", "livery": (Settings.data.livery as Dictionary).duplicate()})

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
	var body: Control
	var extra: Array = []
	match _page:
		"circuit":
			body = _circuit_page(app, room, edit)
			extra.append(UIKit.button(I18n.t("Continue") + "  ›", func(): _go(app, "car")))
		"car":
			body = _car_page(app, room, cars, mine, extra)
		"paint":
			body = _paint_page(app, cars, mine, extra)
		"session", "conditions", "rules":
			body = _event_page(app, room, _page, edit, is_host)
		"drivers":
			body = _drivers_page(app, room, cars, is_host and room.phase == "lobby", extra)
		_:
			body = _hub(app, room, cars, mine)
	return _frame(app, room, mine, cars, is_host, body, extra)

static func _go(app: App, page: String) -> void:
	_page = page
	_preview = ""
	app.render_lobby()

## The weekend's frame: the top bar (‹ back, the tabs, the room code and the gear), the page, and the bottom bar with
## what is missing and the one big action.
static func _frame(app: App, room: Dictionary, mine: Dictionary, cars: Array, is_host: bool, body: Control, extra: Array) -> Control:
	var solo := LocalRoom.is_local_code(room.code)
	var tab := _page
	if _page == "session" or _page == "conditions" or _page == "rules":
		tab = "event"
	var right: Array = []
	if not solo:
		var code_tag := UIW.tag((I18n.t("HOSTED ON THIS DEVICE") + " · " if LocalRoom.is_hosted_code(room.code) else "") + I18n.t("ROOM CODE") + " " + room.code, Color(1, 1, 1, 0.9), true, UIKit.INK)
		right.append(code_tag)
		right.append(UIKit.button(I18n.t("Copy"), func():
			DisplayServer.clipboard_set(room.code)
			app.toast(I18n.t("Room code copied"))))
	right.append(MenuScreen._icon_button("⚙", I18n.t("Settings"), app.open_settings))
	var opts := {
		"title": I18n.t("Race weekend") if not UIKit.touch() else "", "back": app.leave if _page == "hub" else func(): _go(app, "hub"),
		"tabs": [["hub", I18n.t("Overview")], ["circuit", I18n.t("Circuit")], ["car", I18n.t("Car")], ["paint", I18n.t("Paint")], ["event", I18n.t("Event")], ["drivers", I18n.t("Drivers")]],
		"tab": tab, "on_tab": func(k): _go(app, "session" if k == "event" else k), "tabs_left": UIKit.touch(), "right": right,
	}
	if tab == "event":
		opts.sub_tabs = [["session", I18n.t("Session")], ["conditions", I18n.t("Conditions")], ["rules", I18n.t("Rules")]]
		opts.sub_tab = _page
		opts.on_sub = func(k): _go(app, k)
	var top := UIW.top_bar(opts)
	var act := _main_action(app, room, mine, _car_by_id(cars, mine.get("carId")), is_host)
	# one solid white action per screen: a page's own primary (Select this car) turns the start into an outlined one
	var primary_taken := false
	for e in extra:
		if e is Button and e.get_theme_stylebox("normal").bg_color == Color("f2f4f7"):
			primary_taken = true
	if primary_taken:
		for st in ["normal", "hover", "pressed", "hover_pressed", "disabled"]:
			act.button.remove_theme_stylebox_override(st)
		for k in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color", "font_disabled_color"]:
			act.button.remove_theme_color_override(k)
	var actions: Array = extra.duplicate()
	actions.append(act.button)
	var bar := UIW.action_bar(act.hint, actions)
	if _page == "hub":
		UIW.default_focus(act.button)
	return UIW.screen(top, body, bar)

## The big action and the line beside it: Start race (host, when everyone is ready), Ready, Pick a car, or Waiting.
static func _main_action(app: App, room: Dictionary, mine: Dictionary, car: Dictionary, is_host: bool) -> Dictionary:
	var hint := UIKit.label("", 16, UIKit.SOFT)
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	var connected: Array = room.players.filter(func(p): return p.connected)
	var others_ready := connected.all(func(p): return p.id == app.me or (p.carId != null and p.ready))
	var is_ready: bool = mine.get("ready", false)
	var act := UIW.action("", Callable(), true)
	act.custom_minimum_size = Vector2(250, 0)
	var track_id: String = str(room.conditions.trackId)
	if not Packs.ready_for(track_id):
		# the circuit comes as a download (Packs): the main action fetches it, its text the progress
		return _download_action(app, act, hint, Packs.pack_of(track_id))
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
	# a newer version of the circuit's pack: said, not forced (the race runs on the installed one)
	if hint.text == "" and Packs.pack_of(track_id) != "" and Packs.update_available(Packs.pack_of(track_id)):
		hint.text = I18n.t("An update of this circuit is ready: Settings › Gameplay › Interface.")
	return {"button": act, "hint": hint}

## The download of a circuit's pack as the lobby's main action: Download (N MB), then the progress, the check and an
## error to retry; the lobby is drawn again (render_lobby) once the circuit is in.
static func _download_action(app: App, act: Button, hint: Label, id: String) -> Dictionary:
	var show := func() -> void:
		var j: Dictionary = Packs.jobs.get(id, {})
		var total := maxf(1.0, float(j.get("total", 1)))
		match str(j.get("phase", "")):
			"connecting":
				act.text = I18n.t("Connecting…").to_upper()
				act.disabled = true
			"downloading":
				act.text = I18n.t("Downloading {p} %", {"p": int(100.0 * float(j.done) / total)}).to_upper()
				act.disabled = true
				hint.text = I18n.t("{a} of {b} MB. You can keep using the menus; it resumes if the connection drops.", {"a": "%.0f" % (float(j.done) / 1e6), "b": "%.0f" % (total / 1e6)})
			"checking":
				act.text = I18n.t("Checking {p} %", {"p": int(100.0 * float(j.done) / total)}).to_upper()
				act.disabled = true
			"failed":
				act.text = I18n.t("Retry download").to_upper()
				act.disabled = false
				hint.text = I18n.t(str(j.error))
			_:
				var mb := Packs.size_mb(id)
				if Packs.base_url() == "" or mb <= 0.0:
					act.text = I18n.t("Circuit not installed").to_upper()
					act.disabled = true
					hint.text = I18n.t("This circuit is a separate download, not available right now. Connect to the internet and try again.")
				else:
					act.text = I18n.t("Download circuit ({n} MB)", {"n": "%.0f" % mb}).to_upper()
					act.disabled = false
					hint.text = I18n.t("This circuit is a separate download. Once installed it works offline.")
	show.call()
	act.pressed.connect(func(): Packs.download(id))
	var on_change := func(changed_id: String) -> void:
		if changed_id != id or not is_instance_valid(act):
			return
		if Packs.present(id):
			app.render_lobby()
			return
		show.call()
	Packs.changed.connect(on_change)
	act.tree_exiting.connect(func(): if Packs.changed.is_connected(on_change): Packs.changed.disconnect(on_change))
	if Packs.remote(id).is_empty():
		Packs.refresh()
	return {"button": act, "hint": hint}

## A labelled bar from 0 to 1 (the car's stats).
static func _stat_bar(label: String, value: String, frac: float) -> Control:
	var col := UIW.vbox(3)
	var row := UIW.hbox(10)
	var lb := UIKit.label(label.to_upper(), 15, UIKit.SOFT, true, 600)
	lb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(lb)
	row.add_child(UIKit.label(value, 17, UIKit.TEXT, true, 600))
	col.add_child(row)
	var pb := ProgressBar.new()
	pb.show_percentage = false
	pb.max_value = 1.0
	pb.value = clampf(frac, 0.04, 1.0)
	pb.custom_minimum_size = Vector2(0, 4)
	col.add_child(pb)
	return col

static func _car_stats(car: Dictionary) -> Control:
	var s: Dictionary = car.specs
	var power := hp(s.powerKw)
	var col := UIW.vbox(8)
	col.add_child(_stat_bar(I18n.t("Power"), I18n.t("{n} hp", {"n": power}), power / 700.0))
	col.add_child(_stat_bar(I18n.t("Top speed"), "%d km/h" % s.topSpeedKmh, float(s.topSpeedKmh) / 330.0))
	col.add_child(_stat_bar(I18n.t("Weight"), "%d kg" % s.massKg, float(s.massKg) / 1600.0))
	return col

static var _hero_rects: Dictionary = {}

## The car's menu picture without its empty margins (data/car_hero_rects.json, from tools/godot/make-car-bbox.py).
## The car's picture (CarStudio: brand-free, in your paint; the shipped photos showed the real liveries).
static func _car_image(car: Dictionary, size: Vector2) -> TextureRect:
	return CarStudio.picture_rect(car, CarStudio.my_livery(), size)

static func _race_label(k: String) -> String:
	var n := int(k.substr(1))
	if k[0] == "T":
		return I18n.t("Race: {m} min + 1 lap", {"m": n})
	return I18n.t("Qualifying only") if n == 0 else I18n.t("Race: {n} laps", {"n": n})

static func _race_key(room: Dictionary) -> String:
	return ("T%d" % room.raceMinutes) if int(room.get("raceMinutes", 0)) > 0 else ("L%d" % room.raceLaps)

## The circuit's headline: the flag and the name, the place in hollow capitals, the facts.
static func _track_head(track: Dictionary, big: bool) -> Control:
	var touch := UIKit.touch()
	var map: String = track.get("map", "nurburgring")
	var col := UIW.vbox(0)
	var r := UIW.hbox(14)
	var fl := FlagIcon.make(MAP_COUNTRY.get(circuit_of(track), "DE"), 46 if (big and not touch) else 34)
	if fl != null:
		fl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		r.add_child(fl)
	var name := UIKit.label(I18n.t(track.get("name", "")).to_upper(), (54 if not touch else 38) if big else (34 if not touch else 28), UIKit.TEXT, true, 700)
	name.clip_text = true
	name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	r.add_child(name)
	col.add_child(r)
	if big:
		col.add_child(UIW.outline_label(I18n.t(LOCATION.get(map, "Nürburg, Germany")), 40 if not touch else 28))
	var facts: Array = []
	if OPENED.has(map):
		facts.append(I18n.t("Opened {y}", {"y": OPENED[map]}))
	facts.append("%.3f km" % (float(track.length) / 1000.0))
	if track.get("turns") != null:
		facts.append(I18n.t("{n} turns", {"n": int(track.turns)}))
	col.add_child(UIKit.label("     ".join(facts), 16, UIKit.SOFT, false, 500))
	return col

# ------------------------------------------------------------------- hub ---

static func _hub(app: App, room: Dictionary, cars: Array, mine: Dictionary) -> Control:
	var touch := UIKit.touch()
	var c: Dictionary = room.conditions
	var track: Dictionary = app.track_entry(c.trackId)
	if track.is_empty():
		track = app.track_index[0]
	var plan := Weather.plan_weather(int(c.seed), c)
	var rules: Dictionary = room.get("rules", {})
	var rules_on := ["contact", "pitWindow", "fuel", "raceControl"].filter(func(k): return rules.get(k, false)).size()
	var car := _car_by_id(cars, mine.get("carId"))

	var left := UIW.vbox(14 if touch else 18)
	left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var head_row := UIW.hbox(18)
	var outline := TrackOutline.new(track.id, Vector2(110, 110) if not touch else Vector2(76, 76))
	head_row.add_child(outline)
	var th := _track_head(track, true)
	th.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head_row.add_child(th)
	left.add_child(head_row)

	# the sessions, as the references' session cards: what runs, how long, the forecast
	var sh := UIW.hbox(12)
	sh.add_child(UIKit.label(I18n.t("Session settings").to_upper(), 22, UIKit.TEXT, true, 600))
	var adv := UIKit.button(I18n.t("Change"), func(): _go(app, "session"))
	sh.add_child(adv)
	left.add_child(sh)
	var cards := UIW.hbox(12)
	var pm := int(room.get("practiceMinutes", 0))
	var rm := int(room.get("raceMinutes", 0))
	var race_on: bool = rm > 0 or int(room.raceLaps) > 0
	cards.add_child(_session_card(app, I18n.t("Practice"), pm > 0, I18n.t("{m} min", {"m": pm}) if pm > 0 else I18n.t("No practice"), plan))
	cards.add_child(_session_card(app, I18n.t("Qualifying"), true, I18n.t("{m} min", {"m": int(room.sessionMinutes)}), plan))
	cards.add_child(_session_card(app, I18n.t("Race"), race_on, (I18n.t("{m} min", {"m": rm}) if rm > 0 else I18n.t("{n} laps", {"n": int(room.raceLaps)})) if race_on else I18n.t("Qualifying only"), plan))
	left.add_child(cards)

	# the room's facts as the references' bottom strip, each one a way into its page
	var strip := PanelContainer.new()
	strip.add_theme_stylebox_override("panel", UIKit.box(Color(0.02, 0.04, 0.1, 0.72), Color(0, 0, 0, 0), 0, 4, Vector2(10, 6)))
	var facts := UIW.hbox(6)
	facts.add_child(_fact(I18n.t("Weather"), I18n.t(Weather.LABEL[plan.kind]), func(): _go(app, "conditions")))
	facts.add_child(_fact(I18n.t("Start time"), Weather.format_hour(plan.startHour), func(): _go(app, "conditions")))
	facts.add_child(_fact(I18n.t("Rules"), (I18n.t("{n} of {max} on", {"n": rules_on, "max": 4}) if rules_on > 0 else I18n.t("Ghost cars")), func(): _go(app, "rules")))
	facts.add_child(_fact(I18n.t("Drivers"), "%d / %d" % [room.players.size(), Const.MAX_PLAYERS], func(): _go(app, "drivers")))
	strip.add_child(facts)
	strip.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	left.add_child(strip)

	# the car on the right, as the references' entry: the make, the name, the team, the picture
	var right := UIKit.button("", func(): _go(app, "car"))
	right.custom_minimum_size = Vector2(300 if touch else 400, 0)
	right.size_flags_vertical = Control.SIZE_EXPAND_FILL
	right.disabled = room.phase != "lobby"
	var empty := StyleBoxEmpty.new()
	for st in ["normal", "disabled"]:
		right.add_theme_stylebox_override(st, empty)
	right.add_theme_stylebox_override("hover", UIKit.box(Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.3), 1, 8))
	right.add_theme_stylebox_override("pressed", UIKit.box(Color(1, 1, 1, 0.12), Color.WHITE, 1, 8))
	right.add_theme_stylebox_override("focus", UIKit.focus_ring(8))
	var rc := UIW.vbox(4)
	if car.is_empty():
		rc.alignment = BoxContainer.ALIGNMENT_CENTER
		rc.add_child(UIKit.label(I18n.t("Pick a car").to_upper(), 34, UIKit.TEXT, true, 700))
	else:
		var info: Dictionary = car.get("info", {})
		rc.add_child(UIKit.label(str(info.get("team", car.manufacturer)).to_upper(), 16, UIKit.SOFT, true, 600))
		var cn := UIKit.label(str(car.name).to_upper(), 30 if touch else 36, UIKit.TEXT, true, 700)
		cn.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		rc.add_child(cn)
		var tags := UIW.hbox(6)
		tags.add_child(UIW.tag(car.category, _class_colour(car.category)))
		if car.get("year"):
			tags.add_child(UIW.tag(str(int(car.year)), Color(1, 1, 1, 0.8), false))
		rc.add_child(tags)
		var img := _car_image(car, Vector2(0, 120))
		img.size_flags_vertical = Control.SIZE_EXPAND_FILL
		rc.add_child(img)
	var change := UIKit.label(I18n.t("Change car").to_upper() + "  ›", 18, Color.WHITE, true, 600)
	change.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	rc.add_child(change)
	var rm2 := UIW.margins(rc, 14, 10, 14, 10)
	UIKit.full(rm2)
	UIW.pass_mouse(rm2)
	right.add_child(rm2)

	var row := UIW.hbox(26 if not touch else 16)
	row.add_child(left)
	row.add_child(UIW.hair(true, Color(1, 1, 1, 0.2)))
	row.add_child(right)
	return row

## A session's card: its name, on or off, the forecast and its length (a way into the Session page).
static func _session_card(app: App, title: String, on: bool, length: String, plan: Dictionary) -> Button:
	var touch := UIKit.touch()
	var b := UIW.card_button(on, 8)
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	b.custom_minimum_size = Vector2(150, 112 if touch else 124)
	var col := UIW.vbox(4)
	var top := UIW.hbox(6)
	var t := UIKit.label(title.to_upper(), 24 if touch else 26, Color.WHITE if on else Color(1, 1, 1, 0.5), true, 600)
	t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(t)
	top.add_child(UIKit.label("✓" if on else "○", 20, Color.WHITE if on else Color(1, 1, 1, 0.5), false, 700))
	col.add_child(top)
	var icons := UIW.hbox(4)
	icons.add_child(UIW.WeatherIcon.new(plan.kind, 24.0))
	if plan.get("change") != null:
		icons.add_child(UIKit.label("›", 18, UIKit.SOFT, true, 600))
		icons.add_child(UIW.WeatherIcon.new(plan.change.to, 24.0))
	col.add_child(icons)
	col.add_child(UIW.spacer())
	var l := UIW.stat(I18n.t("Length"), length, 22 if touch else 24, Color.WHITE if on else Color(1, 1, 1, 0.5))
	col.add_child(l)
	var content: MarginContainer = b.get_node("content")
	for s in ["left", "right"]:
		content.add_theme_constant_override("margin_" + s, 14)
	content.add_theme_constant_override("margin_top", 10)
	content.add_theme_constant_override("margin_bottom", 10)
	content.add_child(col)
	UIW.pass_mouse(content)
	b.pressed.connect(func(): _go(app, "session"))
	return b

## One fact of the bottom strip: a small label over the value, pressable.
static func _fact(label: String, value: String, on: Callable) -> Button:
	var b := Button.new()
	b.focus_mode = Control.FOCUS_ALL
	var pad := Vector2(12, 4)
	b.add_theme_stylebox_override("normal", UIKit.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 3, pad))
	b.add_theme_stylebox_override("hover", UIKit.box(Color(1, 1, 1, 0.1), Color(0, 0, 0, 0), 0, 3, pad))
	b.add_theme_stylebox_override("pressed", UIKit.box(Color(1, 1, 1, 0.2), Color(0, 0, 0, 0), 0, 3, pad))
	var s := UIW.stat(label, value, 22)
	var m := UIW.margins(s, 12, 4, 12, 4)
	UIW.pass_mouse(m)
	b.add_child(m)
	b.custom_minimum_size = m.get_combined_minimum_size()
	m.resized.connect(func(): b.custom_minimum_size = m.get_combined_minimum_size())
	b.pressed.connect(on)
	return b

## A class's tag colour (the references' coloured class chips).
static func _class_colour(cat: String) -> Color:
	var k := cat.to_lower()
	if k.begins_with("gt3 evo"):
		return Color("1f9d55")
	if k.begins_with("gt3"):
		return Color("16804a")
	if k == "hypercar":
		return Color("c8102e")
	if k == "cup":
		return Color("d97706")
	if k == "touring":
		return Color("2563eb")
	return Color("6b7280")

# ---------------------------------------------------------------- circuit ---

static func _circuit_page(app: App, room: Dictionary, edit: bool) -> Control:
	var touch := UIKit.touch()
	var tracks: Array = app.track_index
	var track: Dictionary = app.track_entry(room.conditions.trackId)
	if track.is_empty():
		track = tracks[0]
	var send := func(patch: Dictionary): var m := {"t": "setConditions"}; m.merge(patch); app.send(m)
	var col := UIW.vbox(12)
	var top := UIW.hbox(20)
	var left := UIW.vbox(10)
	left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	left.add_child(_track_head(track, true))
	if not edit:
		left.add_child(UIKit.label(I18n.t("Only the host can change this"), 15, UIKit.ACCENT_2))
	var ol := TrackOutline.new(track.id, Vector2(320, 230) if not touch else Vector2(220, 130))
	ol.size_flags_vertical = Control.SIZE_EXPAND_FILL
	ol.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	left.add_child(ol)
	top.add_child(left)
	# the layouts of this circuit, as the references' Circuit Layout list
	var layouts: Array = tracks.filter(func(t): return circuit_of(t) == circuit_of(track))
	var lp := PanelContainer.new()
	lp.add_theme_stylebox_override("panel", UIKit.box(Color(UIKit.NAVY_SOLID, 0.9), Color(1, 1, 1, 0.14), 1, 4, Vector2(6, 6)))
	lp.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	lp.custom_minimum_size = Vector2(300 if touch else 360, 0)
	var lc := UIW.vbox(2)
	lc.add_child(UIW.margins(UIKit.label(I18n.t("Circuit layout"), 16, UIKit.SOFT, false, 600), 8, 4, 8, 6))
	lc.add_child(UIW.hair())
	for t in layouts:
		var on: bool = t.id == track.id
		var b := Button.new()
		b.focus_mode = Control.FOCUS_ALL
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.text = ("✓  " if on else "     ") + "%s · %.2f km" % [I18n.t(t.name).trim_prefix("Nürburgring ").strip_edges(), float(t.length) / 1000.0]
		b.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		b.add_theme_font_override("font", UIKit.font(false, 600))
		b.add_theme_font_size_override("font_size", 16)
		var pad := Vector2(10, 9 if touch else 6)
		b.add_theme_stylebox_override("normal", UIKit.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 3, pad))
		b.add_theme_stylebox_override("disabled", UIKit.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 3, pad))
		b.add_theme_stylebox_override("hover", UIKit.box(Color("f2f4f7"), Color(0, 0, 0, 0), 0, 3, pad))
		b.add_theme_stylebox_override("pressed", UIKit.box(Color("dfe3ea"), Color(0, 0, 0, 0), 0, 3, pad))
		b.add_theme_color_override("font_hover_color", UIKit.CRIMSON)
		b.add_theme_color_override("font_pressed_color", UIKit.CRIMSON)
		b.add_theme_color_override("font_color", Color.WHITE if on else UIKit.SOFT)
		b.disabled = not edit
		var id: String = t.id
		b.pressed.connect(func(): if edit and not on: send.call({"trackId": id}))
		lc.add_child(b)
	lp.add_child(lc)
	top.add_child(lp)
	top.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col.add_child(top)
	# every circuit in a strip at the bottom, the current one outlined
	var strip := UIW.hbox(8)
	var seen := {}
	for t in tracks:
		var key := circuit_of(t)
		if seen.has(key):
			continue
		seen[key] = true
		var group: Array = tracks.filter(func(x): return circuit_of(x) == key)
		var on := circuit_of(track) == key
		var shown: Dictionary = track if on else group[0]
		var b := UIW.card_button(on, 4)
		b.custom_minimum_size = Vector2(200 if touch else 230, 92 if touch else 100)
		var r := UIW.hbox(10)
		var o := TrackOutline.new(shown.id, Vector2(64, 64))
		o.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		r.add_child(o)
		var info := UIW.vbox(0)
		info.alignment = BoxContainer.ALIGNMENT_CENTER
		info.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var l1 := UIKit.label(I18n.t(CIRCUIT_NAME.get(key, shown.name)).to_upper(), 18, UIKit.TEXT if on else UIKit.SOFT, true, 600)
		l1.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		info.add_child(l1)
		info.add_child(UIKit.label(I18n.t("{n} layouts", {"n": group.size()}) if group.size() > 1 else "%.2f km" % (float(shown.length) / 1000.0), 13, UIKit.SOFT))
		r.add_child(info)
		var content: MarginContainer = b.get_node("content")
		for s in ["left", "right", "top", "bottom"]:
			content.add_theme_constant_override("margin_" + s, 8)
		content.add_child(r)
		UIW.pass_mouse(content)
		b.disabled = not edit and not on
		if on:
			UIW.default_focus(b)
		var first: String = group[0].id
		b.pressed.connect(func(): if edit and not on: send.call({"trackId": first}))
		strip.add_child(b)
	var sp := PanelContainer.new()
	sp.add_theme_stylebox_override("panel", UIKit.box(Color(0.02, 0.04, 0.1, 0.6), Color(0, 0, 0, 0), 0, 4, Vector2(8, 8)))
	sp.add_child(UIW.hscroll(strip))
	col.add_child(sp)
	return col

# ------------------------------------------------------------------- car ---

static func _car_page(app: App, room: Dictionary, cars: Array, mine: Dictionary, extra: Array) -> Control:
	var touch := UIKit.touch()
	var editable: bool = room.phase == "lobby"
	var mine_car := _car_by_id(cars, mine.get("carId"))
	var shown := _car_by_id(cars, _preview)
	if shown.is_empty():
		shown = mine_car if not mine_car.is_empty() else (cars[0] if not cars.is_empty() else {})
	var col := UIW.vbox(10)
	var top := UIW.hbox(20)
	top.size_flags_vertical = Control.SIZE_EXPAND_FILL
	if not shown.is_empty():
		var info: Dictionary = shown.get("info", {})
		var s: Dictionary = shown.specs
		# the name in big capitals, the engine under it, the picture filling the middle
		var left := UIW.vbox(4)
		left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var nr := UIW.hbox(16)
		var mk := UIKit.label(str(shown.manufacturer).to_upper(), 18, UIKit.SOFT, true, 600)
		mk.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		nr.add_child(mk)
		nr.add_child(UIW.hair(true, Color(1, 1, 1, 0.3)))
		var nm := UIKit.label(str(shown.name).to_upper(), 50 if not touch else 30, UIKit.TEXT, true, 700)
		nm.clip_text = true
		nm.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		nr.add_child(nm)
		left.add_child(nr)
		left.add_child(UIKit.label(str(info.get("engine", "")), 15, UIKit.SOFT))
		var tags := UIW.hbox(6)
		tags.add_child(UIW.tag(shown.category, _class_colour(shown.category)))
		if shown.get("year"):
			tags.add_child(UIW.tag(str(int(shown.year)), Color(1, 1, 1, 0.8), false))
		var owner = room.carLocks.get(shown.id)
		if mine.get("carId") == shown.id:
			tags.add_child(UIW.tag("✓ " + I18n.t("Your car"), UIKit.GOOD))
		elif owner != null and owner != app.me:
			for p in room.players:
				if p.id == owner:
					tags.add_child(UIW.tag(p.nick, UIKit.ACCENT_2, true, UIKit.INK))
		left.add_child(tags)
		var img := _car_image(shown, Vector2(0, 70 if touch else 230))
		img.size_flags_vertical = Control.SIZE_EXPAND_FILL
		left.add_child(img)
		top.add_child(left)
		var right := UIW.vbox(10)
		right.custom_minimum_size = Vector2(250 if touch else 320, 0)
		# a phone keeps the height for the strip and the actions: the numbers only
		if not touch:
			var team := UIKit.label(str(info.get("team", "")).to_upper(), 20, UIKit.TEXT, true, 600)
			team.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			right.add_child(team)
			right.add_child(UIW.hair())
		right.add_child(_car_stats(shown))
		if not touch:
			right.add_child(UIW.hair())
			var g := GridContainer.new()
			g.columns = 2
			g.add_theme_constant_override("h_separation", 22)
			g.add_theme_constant_override("v_separation", 6)
			g.add_child(UIW.stat(I18n.t("Drive"), str(s.drivetrain), 22))
			g.add_child(UIW.stat(I18n.t("Gears"), str(s.gears.size()), 22))
			right.add_child(g)
			var gb := UIKit.label(str(info.get("gearbox", "")), 14, UIKit.SOFT)
			gb.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			right.add_child(gb)
		top.add_child(right)
		var chosen: bool = mine.get("carId") == shown.id
		if not chosen:
			var take := UIW.action(I18n.t("Select this car"), Callable(), true)
			take.disabled = not editable or (owner != null and owner != app.me)
			var cid: String = shown.id
			take.pressed.connect(func():
				Settings.data["lastCar"] = cid
				Settings.save()
				app.send({"t": "selectCar", "carId": cid})
				_go(app, "hub"))
			extra.append(take)
		else:
			extra.append(UIKit.button(I18n.t("Continue") + "  ›", func(): _go(app, "session")))
	col.add_child(top)
	# the classes and the cars as the references' strip
	var cats: Array = []
	for c in cars:
		if not cats.has(c.category):
			cats.append(c.category)
	var filters := UIW.chips(_car_filter, [["", I18n.t("All")]] + cats.map(func(x): return [x, x]), func(v): _car_filter = v; app.render_lobby())
	col.add_child(filters)
	if not editable:
		col.add_child(UIKit.label(I18n.t("A race is in progress. You will join the next one."), 15, UIKit.ACCENT_2))
	var strip := UIW.hbox(8)
	for c in cars:
		if _car_filter != "" and c.category != _car_filter:
			continue
		var owner = room.carLocks.get(c.id)
		var taken := ""
		if owner != null and owner != app.me:
			for p in room.players:
				if p.id == owner:
					taken = p.nick
		var chosen: bool = mine.get("carId") == c.id
		var looking: bool = not shown.is_empty() and shown.id == c.id
		var b := UIW.card_button(looking, 4)
		b.custom_minimum_size = Vector2(140 if touch else 176, 84 if touch else 112)
		var cc := UIW.vbox(0)
		var hr := UIW.hbox(4)
		var y := UIKit.label(str(int(c.year)) if c.get("year") else "", 13, UIKit.SOFT, false, 700)
		y.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		hr.add_child(y)
		if chosen:
			hr.add_child(UIKit.label("✓", 14, UIKit.GOOD, false, 700))
		cc.add_child(hr)
		var img := CarStudio.picture_rect(c, CarStudio.my_livery(), Vector2(0, 36 if touch else 58))
		img.size_flags_vertical = Control.SIZE_EXPAND_FILL
		img.modulate = Color(1, 1, 1, 0.4 if taken != "" else 1.0)
		cc.add_child(img)
		var nm := UIKit.label(c.name, 13, UIKit.TEXT if looking else UIKit.SOFT, false, 600)
		nm.clip_text = true
		nm.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		cc.add_child(nm)
		if taken != "":
			cc.add_child(UIKit.label(taken, 12, UIKit.ACCENT_2))
		var content: MarginContainer = b.get_node("content")
		for s in ["left", "right", "top", "bottom"]:
			content.add_theme_constant_override("margin_" + s, 7)
		content.add_child(cc)
		UIW.pass_mouse(content)
		if looking:
			UIW.default_focus(b)
		var cid: String = c.id
		b.pressed.connect(func(): _preview = cid; app.render_lobby())
		strip.add_child(b)
	var sp := PanelContainer.new()
	sp.add_theme_stylebox_override("panel", UIKit.box(Color(0.02, 0.04, 0.1, 0.6), Color(0, 0, 0, 0), 0, 4, Vector2(8, 8)))
	sp.add_child(UIW.hscroll(strip))
	col.add_child(sp)
	return col

# ----------------------------------------------------------------- paint ---

## Your car's paint (CarPaint): the car turning on the left, the choices on the right. Every change shows at once on
## the car, is kept in the settings and goes to the room (the others see your colours).
static func _paint_page(app: App, cars: Array, mine: Dictionary, extra: Array) -> Control:
	var touch := UIKit.touch()
	var car := _car_by_id(cars, mine.get("carId"))
	if car.is_empty() and not cars.is_empty():
		car = cars[0]
	var lv: Dictionary = Settings.data.livery
	var row := UIW.hbox(20)
	row.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var preview := CarStudio.Preview.new(car, lv)
	preview.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	preview.size_flags_vertical = Control.SIZE_EXPAND_FILL
	preview.custom_minimum_size = Vector2(0, 180 if touch else 320)
	row.add_child(preview)
	var col := UIW.vbox(4)
	var changed := func(key: String, v: Variant) -> void:
		lv[key] = v
		Settings.save()
		preview.set_livery(lv)
		app.send({"t": "setLivery", "livery": lv.duplicate()})
	col.add_child(UIW.section(I18n.t("Body")))
	col.add_child(UIW.row(I18n.t("Colour"), _swatches(lv.base, CarPaint.PALETTE, func(c): changed.call("base", c))))
	col.add_child(UIW.row(I18n.t("Finish"), _live_chips(lv.finish, [["gloss", I18n.t("Gloss")], ["metallic", I18n.t("Metallic")], ["matte", I18n.t("Matte")], ["pearl", I18n.t("Pearl")]], func(v): changed.call("finish", v))))
	col.add_child(UIW.section(I18n.t("Design")))
	col.add_child(UIW.row(I18n.t("Design"), _live_chips(lv.design, [["plain", I18n.t("Plain")], ["stripes", I18n.t("Stripes")], ["twotone", I18n.t("Two-tone")], ["fade", I18n.t("Fade")], ["side", I18n.t("Side stripe")], ["hoop", I18n.t("Hoop")]], func(v): changed.call("design", v))))
	col.add_child(UIW.row(I18n.t("Second colour"), _swatches(lv.accent, CarPaint.PALETTE, func(c): changed.call("accent", c))))
	col.add_child(UIW.section(I18n.t("Race number")))
	var nums: Array = []
	for n in range(1, 100):
		nums.append([str(n), str(n)])
	var num_row := UIW.hbox(12)
	num_row.add_child(UIW.stepper(str(int(lv.number)), nums, func(v): changed.call("number", int(v))))
	num_row.add_child(UIW.switch(bool(lv.showNumber), func(on): changed.call("showNumber", on)))
	col.add_child(UIW.row(I18n.t("Number"), num_row))
	col.add_child(UIW.row(I18n.t("Number colour"), _swatches(lv.numberColor, ["#ffffff", "#111214", "#ffd60a", "#c8102e", "#0a3d91", "#00843d"], func(c): changed.call("numberColor", c))))
	col.add_child(UIW.section(I18n.t("Wheels")))
	col.add_child(UIW.row(I18n.t("Rims"), _swatches(lv.rims, ["#1c1c1e", "#9a9fa5", "#f2f2f2", "#c9a227", "#c8102e", "#0a3d91"], func(c): changed.call("rims", c))))
	col.add_child(UIW.row(I18n.t("Calipers"), _swatches(lv.calipers, ["#ffd60a", "#c8102e", "#1c1c1e", "#0a84ff", "#30d158", "#f2f2f2"], func(c): changed.call("calipers", c))))
	var right := UIW.scroll(col)
	right.custom_minimum_size = Vector2(380 if touch else 520, 0)
	right.size_flags_vertical = Control.SIZE_EXPAND_FILL
	row.add_child(right)
	extra.append(UIKit.button(I18n.t("Continue") + "  ›", func(): _go(app, "session")))
	return row

## Chips that show the new choice themselves (the page is not rebuilt for each change: the turning car stays).
static func _live_chips(current: Variant, options: Array, on: Callable) -> Control:
	var holder := UIW.vbox(0)
	# wide enough for the choices to sit side by side
	holder.custom_minimum_size = Vector2(130.0 * minf(4.0, options.size()), 0)
	var fill := func(cur: Variant, again: Callable) -> void:
		for c in holder.get_children():
			c.queue_free()
		holder.add_child(UIW.chips(cur, options, func(v):
			on.call(v)
			again.call(v, again)))
	fill.call(current, fill)
	return holder

## A row of colour swatches (the chosen one ringed) and a picker for any other colour.
static func _swatches(current: String, colours: Array, on: Callable) -> Control:
	var box := UIW.hbox(6)
	var buttons: Array = []
	var mark := func(sel: String) -> void:
		for b: Button in buttons:
			var c := Color(b.get_meta("colour"))
			var on_it: bool = c.to_html(false) == Color(sel).to_html(false)
			for st in ["normal", "hover", "pressed", "focus"]:
				b.add_theme_stylebox_override(st, UIKit.box(c, Color.WHITE if on_it else Color(1, 1, 1, 0.18), 3 if on_it else 1, 6))
	for hex in colours:
		var b := Button.new()
		b.custom_minimum_size = Vector2(30, 30)
		b.set_meta("colour", hex)
		b.focus_mode = Control.FOCUS_ALL
		b.tooltip_text = hex
		b.pressed.connect(func():
			mark.call(hex)
			on.call(hex))
		buttons.append(b)
		box.add_child(b)
	var pick := ColorPickerButton.new()
	pick.custom_minimum_size = Vector2(30, 30)
	pick.color = Color(current)
	pick.edit_alpha = false
	pick.tooltip_text = I18n.t("Any colour")
	pick.color_changed.connect(func(c: Color):
		mark.call(c.to_html(false))
		on.call("#" + c.to_html(false)))
	box.add_child(pick)
	mark.call(current)
	return box

# ----------------------------------------------------------------- event ---

static func _event_page(app: App, room: Dictionary, page: String, edit: bool, is_host: bool) -> Control:
	var c: Dictionary = room.conditions
	var tracks: Array = app.track_index
	var track: Dictionary = app.track_entry(c.trackId)
	if track.is_empty():
		track = tracks[0]
	var plan := Weather.plan_weather(int(c.seed), c)
	var w0 := Weather.weather_at(plan, 0.0)
	var temp0 := Weather.temperatures(plan, w0, track.get("map", "nurburgring"))
	var send := func(patch: Dictionary): var m := {"t": "setConditions"}; m.merge(patch); app.send(m)
	var col := UIW.vbox(0)
	if not edit:
		col.add_child(UIW.margins(UIKit.label(I18n.t("Only the host can change this"), 15, UIKit.ACCENT_2), 0, 0, 0, 10))
	var side: Control = null
	match page:
		"conditions":
			_conditions_pane(col, c, edit, send)
			side = _forecast_panel(plan, w0, temp0, edit, send)
		"rules":
			col.add_child(UIW.section(I18n.t("Rules")))
			var rules: Dictionary = room.get("rules", {})
			for r in [
				["contact", I18n.t("Car contact"), I18n.t("Cars collide and take damage (off: ghost cars that pass through each other)")],
				["pitWindow", I18n.t("Mandatory pit stop"), I18n.t("Race: one stop with a driver change inside the pit window, as in GT World Challenge Sprint")],
				["fuel", I18n.t("Fuel and refuelling"), I18n.t("Engines burn fuel, you choose your fuel load, stops can refuel (endurance)")],
				["raceControl", I18n.t("Race control"), I18n.t("Yellow flags, full-course yellow, the safety car, blue flags and drive-through penalties")],
			]:
				var k: String = r[0]
				col.add_child(UIW.row(r[1], UIW.switch(rules.get(k, false), (func(v): app.send({"t": "setRules", "rules": {k: v}})) if edit else null), r[2]))
		_:
			_session_pane(col, app, room, edit)
	var body := UIW.hbox(36)
	var mid := UIW.scroll(UIW.margins(col, 0, 0, 12, 10))
	mid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	mid.size_flags_stretch_ratio = 2.4
	body.add_child(mid)
	if side != null:
		side.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		body.add_child(side)
	else:
		var sp := UIW.spacer()
		sp.size_flags_stretch_ratio = 1.0 if not UIKit.touch() else 0.05
		body.add_child(sp)
	return body

static func _conditions_pane(col: Control, c: Dictionary, edit: bool, send: Callable) -> void:
	col.add_child(UIW.section(I18n.t("Conditions")))
	var weather_opts: Array = [["random", I18n.t("Random")]]
	for k in Weather.KINDS:
		weather_opts.append([k, I18n.t(Weather.LABEL[k])])
	col.add_child(UIW.row(I18n.t("Weather"), UIW.stepper(c.weather, weather_opts, func(v): send.call({"weather": v}), edit)))
	var time_opts: Array = []
	for k in Weather.TIME_LABEL:
		time_opts.append([k, I18n.t(Weather.TIME_LABEL[k])])
	col.add_child(UIW.row(I18n.t("Time of day"), UIW.stepper(c.time, time_opts, func(v): send.call({"time": v}), edit)))
	col.add_child(UIW.row(I18n.t("Weather changes"), UIW.stepper(c.changes, [["random", I18n.t("Possible")], ["off", I18n.t("Stable")], ["on", I18n.t("Changing")]], func(v): send.call({"changes": v}), edit)))

## The forecast beside the conditions: the symbol, the weather and hour, the track, the temperatures, a new roll.
static func _forecast_panel(plan: Dictionary, w0: Dictionary, temp0: Dictionary, edit: bool, send: Callable) -> Control:
	var state := "wet" if w0.wetness > 0.3 else ("damp" if w0.wetness > 0.05 else "dry")
	var change := I18n.t("Stable conditions")
	if plan.get("change") != null:
		change = I18n.t("{weather} from about minute {min}", {"weather": I18n.t(Weather.LABEL[plan.change.to]), "min": maxi(1, roundi(plan.change.atSec / 60.0))})
	var fc := UIW.vbox(8)
	fc.add_child(UIKit.label(I18n.t("Forecast").to_upper(), 26, UIKit.DIM, true, 600))
	var top := UIW.hbox(14)
	top.add_child(UIW.WeatherIcon.new(plan.kind, 64.0))
	var tc := UIW.vbox(-4)
	tc.add_child(UIKit.label(I18n.t(Weather.LABEL[plan.kind]).to_upper(), 30, UIKit.TEXT, true, 700))
	tc.add_child(UIKit.label(Weather.format_hour(plan.startHour), 22, UIKit.SOFT, true, 600))
	top.add_child(tc)
	fc.add_child(top)
	fc.add_child(UIKit.label(I18n.t("%s track" % state) + " · " + change, 15, UIKit.SOFT))
	var temps := UIW.hbox(24)
	temps.add_child(UIW.stat(I18n.t("Air"), "%d °C" % roundi(temp0.airC), 30))
	temps.add_child(UIW.stat(I18n.t("Track"), "%d °C" % roundi(temp0.trackC), 30))
	fc.add_child(temps)
	if edit:
		var b := UIKit.button(I18n.t("New forecast"), func(): send.call({"reroll": true}))
		b.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		fc.add_child(b)
	var p := UIW.panel(fc)
	p.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	return p

static func _session_pane(col: Control, app: App, room: Dictionary, edit: bool) -> void:
	# formats as the sims offer them (ACC: quick race, sprint and endurance weekends, hotlap)
	var formats := [
		["quick", I18n.t("Quick race"), 0, 10, 5, 0],
		["sprint", I18n.t("Sprint weekend"), 20, 15, 0, 30],
		["endurance", I18n.t("Endurance"), 30, 20, 0, 60],
		["hotlap", I18n.t("Hotlap"), 0, 30, 0, 0, false],
	]
	# Time trial (solo): 30 minutes alone, and the best lap is the fastest of consecutive clean laps
	var local: bool = LocalRoom.is_local_code(room.code)
	if local:
		formats.append(["trial", I18n.t("Time trial"), 0, 30, 0, 0, true])
	var fmt_now := ""
	for f in formats:
		var rm: int = int(room.get("raceMinutes", 0))
		var streak_now: bool = room.get("rules", {}).get("cleanStreak", false)
		if int(room.get("practiceMinutes", 0)) == f[2] and room.sessionMinutes == f[3] and ((rm == f[5]) if f[5] > 0 else (rm == 0 and room.raceLaps == f[4])) \
				and (f.size() < 7 or streak_now == f[6]):
			fmt_now = f[0]
	var fmt_opts: Array = formats.map(func(f): return [f[0], f[1]])
	if fmt_now == "":
		fmt_opts.push_front(["", I18n.t("Custom")])
	col.add_child(UIW.section(I18n.t("Format")))
	col.add_child(UIW.row(I18n.t("Format"), UIW.stepper(fmt_now, fmt_opts, func(v):
		for f in formats:
			if f[0] == v:
				app.send({"t": "setPractice", "minutes": f[2]})
				app.send({"t": "setSession", "minutes": f[3]})
				app.send({"t": "setRaceMinutes", "minutes": f[5]})
				if f[5] == 0:
					app.send({"t": "setRaceLaps", "laps": f[4]})
				if local:
					app.send({"t": "setRules", "rules": {"cleanStreak": f.size() > 6 and f[6]}}), edit)))
	var gap := func():
		var g := Control.new()
		g.custom_minimum_size = Vector2(0, 18)
		col.add_child(g)
	var pm := int(room.get("practiceMinutes", 0))
	gap.call()
	col.add_child(UIW.section(I18n.t("Free practice"), I18n.t("{m} min", {"m": pm}) if pm > 0 else ""))
	col.add_child(UIW.row(I18n.t("Practice length"), UIW.stepper(pm, Const.PRACTICE_MINUTE_CHOICES.map(func(m): return [m, I18n.t("No practice") if m == 0 else I18n.t("{m} min", {"m": m})]), func(v): app.send({"t": "setPractice", "minutes": int(v)}), edit)))
	gap.call()
	col.add_child(UIW.section(I18n.t("Qualifying"), I18n.t("{m} min", {"m": int(room.sessionMinutes)})))
	col.add_child(UIW.row(I18n.t("Qualifying length"), UIW.stepper(int(room.sessionMinutes), Const.SESSION_MINUTES.map(func(m): return [m, I18n.t("{m} min", {"m": m})]), func(v): app.send({"t": "setSession", "minutes": int(v)}), edit)))
	var race_opts: Array = []
	for n in Const.RACE_LAP_CHOICES:
		race_opts.append(["L%d" % n, _race_label("L%d" % n)])
	for m in Const.RACE_MINUTE_CHOICES:
		if m > 0:
			race_opts.append(["T%d" % m, _race_label("T%d" % m)])
	gap.call()
	col.add_child(UIW.section(I18n.t("Race")))
	col.add_child(UIW.row(I18n.t("Race length"), UIW.stepper(_race_key(room), race_opts, func(v):
		var n := int(String(v).substr(1))
		if String(v)[0] == "T":
			app.send({"t": "setRaceMinutes", "minutes": n})
		else:
			app.send({"t": "setRaceMinutes", "minutes": 0})
			app.send({"t": "setRaceLaps", "laps": n}), edit)))
	if not LocalRoom.is_local_code(room.code):
		gap.call()
		col.add_child(UIW.section(I18n.t("Room")))
		col.add_child(UIW.row(I18n.t("Public room"), UIW.switch(room.isPublic, (func(v): app.send({"t": "setPublic", "isPublic": v})) if edit else null), I18n.t("Public: listed, anyone can join or watch")))

# --------------------------------------------------------------- drivers ---

static func _drivers_page(app: App, room: Dictionary, cars: Array, can_edit: bool, extra: Array) -> Control:
	var col := UIW.vbox(8)
	var head := UIW.hbox(10)
	var t := UIKit.label(I18n.t("Entry list").to_upper(), 30, UIKit.TEXT, true, 600)
	t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(t)
	head.add_child(UIW.tag(I18n.t("Drivers {n}/{max}", {"n": room.players.size(), "max": Const.MAX_PLAYERS}), Color(1, 1, 1, 0.8), false))
	col.add_child(head)
	var list := UIW.vbox(0)
	var i := 0
	for p in room.players:
		i += 1
		list.add_child(_player_row(app, p, cars, can_edit, i))
	col.add_child(UIW.scroll(list))
	if can_edit:
		var add := UIKit.button("+ " + I18n.t("Add bot"), func(): app.send({"t": "addBot"}))
		add.disabled = room.players.size() >= Const.MAX_PLAYERS
		extra.append(add)
	var p := UIW.panel(col)
	p.size_flags_vertical = Control.SIZE_EXPAND_FILL
	return p

static func _player_row(app: App, p: Dictionary, all_cars: Array, can_remove: bool, n: int) -> Control:
	var touch := UIKit.touch()
	var pc := PanelContainer.new()
	var st := UIKit.box(Color(1, 1, 1, 0.06) if p.id == app.me else Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 0, Vector2(8, 4 if not touch else 6))
	st.border_color = UIKit.HAIR
	st.border_width_bottom = 1
	pc.add_theme_stylebox_override("panel", st)
	var row := UIW.hbox(12)
	var pos := UIKit.label(str(n), 18, UIKit.SOFT, true, 600)
	pos.custom_minimum_size = Vector2(26, 0)
	row.add_child(pos)
	var nick := UIKit.label(p.nick, 18, UIKit.ACCENT_2 if p.id == app.me else UIKit.TEXT, false, 700)
	nick.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	nick.clip_text = true
	row.add_child(nick)
	if p.host:
		row.add_child(UIW.tag(I18n.t("HOST"), UIKit.ACCENT_2, true, UIKit.INK))
	if p.bot:
		row.add_child(UIW.tag(I18n.t("BOT"), Color(1, 1, 1, 0.6), false))
	var car_name := I18n.t("choosing…")
	var thumb := ""
	var shown_car := {}
	if p.carId != null:
		# a car the app no longer has shows as the one it is drawn as (CarsDb.FALLBACK)
		var shown := CarsDb.resolve(str(p.carId))
		car_name = shown.get("name", str(p.carId))
		thumb = "car"
		shown_car = shown
	elif p.waiting:
		car_name = I18n.t("next race")
	if thumb != "":
		var lv: Dictionary = p.get("livery", {}) if p.get("livery") is Dictionary and not (p.get("livery") as Dictionary).is_empty() else CarPaint.livery_for(str(p.id), int(p.num) if p.get("num") != null else -1)
		if p.id == app.me:
			lv = CarStudio.my_livery()
		row.add_child(CarStudio.picture_rect(shown_car, lv, Vector2(56, 30)))
	var car := UIKit.label(car_name, 15, UIKit.SOFT)
	car.clip_text = true
	car.custom_minimum_size = Vector2(150 if touch else 220, 0)
	row.add_child(car)
	row.add_child(UIW.image("res://assets/ui/tyre_%s.webp" % p.get("tyre", "medium"), Vector2(26, 26)))
	var state: Control
	if not p.connected:
		state = UIW.tag(I18n.t("OFFLINE"), UIKit.BAD, false)
	elif p.ready:
		state = UIW.tag(I18n.t("READY"), UIKit.GOOD)
	else:
		state = UIKit.label("", 14)
	state.custom_minimum_size = Vector2(76, 0)
	row.add_child(state)
	if p.bot and can_remove:
		row.add_child(UIW.close_button(func(): app.send({"t": "removeBot", "id": p.id})))
	pc.add_child(row)
	return pc

# --------------------------------------------------------------- briefing ---

static func build_briefing(app: App) -> Control:
	var touch := UIKit.touch()
	var room: Dictionary = app.room
	var mine := app.my_info()
	var track := app.track_entry(room.conditions.trackId)
	var c: Dictionary = room.conditions
	var plan := Weather.plan_weather(int(c.seed), c)
	var w0 := Weather.weather_at(plan, 0.0)
	var temp0 := Weather.temperatures(plan, w0, track.get("map", "nurburgring"))
	# the countdown as the references' session chip: white, crimson capitals
	var chip := PanelContainer.new()
	chip.add_theme_stylebox_override("panel", UIKit.box(Color("f2f4f7"), Color(0, 0, 0, 0), 0, 4, Vector2(12, 2)))
	var cr := UIW.hbox(14)
	cr.add_child(UIKit.label(I18n.t("BRIEFING"), 22, UIKit.CRIMSON, true, 600))
	var clock := UIKit.label("", 22, UIKit.CRIMSON, true, 700)
	cr.add_child(clock)
	app._brief_clock = clock
	chip.add_child(cr)
	var top := UIW.top_bar({
		"title": I18n.t("Briefing") if not touch else "",
		"tabs": [["setup", I18n.t("Setup")], ["advanced", I18n.t("Advanced")], ["saved", I18n.t("Saved setups")]],
		"tab": _brief_tab, "on_tab": func(k): _brief_tab = k; app.render_briefing(), "tabs_left": touch,
		"right": [chip],
	})
	# the headline: the circuit, the driver in hollow capitals, the forecast on the right
	var head := UIW.hbox(20)
	var hl := UIW.vbox(0)
	hl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var tr := UIW.hbox(12)
	var fl := FlagIcon.make(MAP_COUNTRY.get(circuit_of(track), "DE"), 34)
	if fl != null:
		fl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		tr.add_child(fl)
	tr.add_child(UIKit.label(I18n.t(track.get("name", "Nürburgring GP")).to_upper(), 34 if not touch else 26, UIKit.TEXT, true, 700))
	hl.add_child(tr)
	var who: String = ("#%s " % str(mine.num)) if mine.get("num") else ""
	hl.add_child(UIW.outline_label(who + str(mine.get("nick", "")), 34 if not touch else 24))
	head.add_child(hl)
	var fc := UIW.hbox(12)
	fc.add_child(UIW.WeatherIcon.new(plan.kind, 46.0))
	var fcc := UIW.vbox(-4)
	fcc.add_child(UIKit.label(I18n.t("Forecast").to_upper() + " · " + Weather.format_hour(plan.startHour), 22, UIKit.TEXT, true, 600))
	fcc.add_child(UIKit.label("%s %d °C · %s %d °C" % [I18n.t("Air"), roundi(temp0.airC), I18n.t("Track"), roundi(temp0.trackC)], 15, UIKit.SOFT))
	fc.add_child(fcc)
	if plan.get("change") != null:
		fc.add_child(UIKit.label("›", 22, UIKit.SOFT, true, 600))
		fc.add_child(UIW.WeatherIcon.new(plan.change.to, 36.0))
	fc.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	head.add_child(fc)
	var main: Control
	match _brief_tab:
		"advanced":
			main = UIW.scroll(_advanced(app, Settings.data.carSetup, temp0.airC))
		"saved":
			main = UIW.scroll(_setup_library(app, Settings.data.carSetup, func(): Settings.save(); app.render_briefing()))
		_:
			main = prep_panel(app, room)
	var col := UIW.vbox(12)
	col.add_child(head)
	var row := UIW.hbox(18)
	row.size_flags_vertical = Control.SIZE_EXPAND_FILL
	# the drivers and whether they are ready, as the references' standings
	if not touch:
		var side := UIW.vbox(4)
		side.custom_minimum_size = Vector2(250, 0)
		side.add_child(UIKit.label(I18n.t("Drivers").to_upper(), 22, UIKit.DIM, true, 600))
		side.add_child(UIW.hair())
		for p in room.players:
			if p.carId == null or not (p.connected or p.bot) or p.waiting:
				continue
			var r := UIW.hbox(8)
			var nm := UIKit.label(p.nick, 16, UIKit.ACCENT_2 if p.id == app.me else UIKit.TEXT, false, 600)
			nm.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			nm.clip_text = true
			r.add_child(nm)
			r.add_child(UIW.image("res://assets/ui/tyre_%s.webp" % p.get("tyre", "medium"), Vector2(22, 22)))
			r.add_child(UIW.tag(I18n.t("READY"), UIKit.GOOD) if p.briefed else UIKit.label("…", 14, UIKit.SOFT, true, 700))
			side.add_child(UIW.margins(r, 0, 4, 0, 4))
		var sp := UIW.panel(side)
		sp.size_flags_vertical = Control.SIZE_EXPAND_FILL
		row.add_child(sp)
	main.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(main)
	col.add_child(row)
	var done: bool = mine.get("briefed", false)
	var btn := UIW.action(I18n.t("Ready") if done else I18n.t("Ready to go"), func(): app.send({"t": "briefed"}), not done)
	btn.disabled = done
	btn.custom_minimum_size = Vector2(250, 0)
	UIW.default_focus(btn)
	var note := UIW.muted(I18n.t("The conditions are final. Set up your car for them; the session loads when everyone is ready."), 14)
	return UIW.screen(top, col, UIW.action_bar(note, [btn]))

## The player's car setup for the final conditions (tyres, wing, brake balance, fuel) with the engineer's note, in three
## panels as the references' pit garage: tyres, the car, the rest.
static func prep_panel(app: App, room: Dictionary) -> Control:
	var touch := UIKit.touch()
	var c: Dictionary = room.conditions
	var plan := Weather.plan_weather(int(c.seed), c)
	var track := app.track_entry(c.trackId)
	var rec := CarSetup.recommend_setup(plan)
	var cs: Dictionary = Settings.data.carSetup
	var save := func(): Settings.save(); app.render_briefing()
	var row := UIW.hbox(14)
	# tyres: the engineer's call first (one press sets the tyre and wing), then the four compounds
	var tyres_col := UIW.vbox(10)
	tyres_col.add_child(UIKit.label(I18n.t("Tyres").to_upper(), 22, UIKit.TEXT, true, 600))
	var note := UIW.muted(I18n.t("Engineer: {note}.", {"note": rec.note}), 14)
	tyres_col.add_child(note)
	var use := UIKit.button(I18n.t("Use {tyre} + {wing} wing", {"tyre": I18n.t(Tyres.COMPOUNDS[rec.tyre].name), "wing": I18n.t(CarSetup.WING[rec.wing].label).split(" (")[0].to_lower()}), func():
		cs.tyre = rec.tyre
		cs.wing = rec.wing
		app.send({"t": "setTyre", "tyre": rec.tyre})
		save.call())
	use.disabled = cs.tyre == rec.tyre and cs.wing == rec.wing
	use.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	tyres_col.add_child(use)
	var tg := GridContainer.new()
	tg.columns = 2
	tg.add_theme_constant_override("h_separation", 8)
	tg.add_theme_constant_override("v_separation", 8)
	for id in ["soft", "medium", "hard", "wet"]:
		var comp: Dictionary = Tyres.COMPOUNDS[id]
		var on: bool = cs.tyre == id
		var b := UIW.card_button(on, 6)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.custom_minimum_size = Vector2(130, 62 if touch else 58)
		b.tooltip_text = I18n.t("{name}: grip {dry} % dry / {wet} % wet, wear ×{wear}", {"name": I18n.t(comp.name), "dry": roundi(comp.grip * 100), "wet": roundi(comp.wetGrip * 100), "wear": comp.wear})
		var r := UIW.hbox(8)
		r.add_child(UIW.image("res://assets/ui/tyre_%s.webp" % id, Vector2(38, 38)))
		var tl := UIKit.label(I18n.t(comp.name).to_upper(), 20, Color.WHITE if on else UIKit.SOFT, true, 600)
		tl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		r.add_child(tl)
		if on:
			r.add_child(UIKit.label("✓", 18, Color.WHITE, false, 700))
		var content: MarginContainer = b.get_node("content")
		for s in ["left", "right", "top", "bottom"]:
			content.add_theme_constant_override("margin_" + s, 8)
		content.add_child(r)
		UIW.pass_mouse(content)
		if on:
			UIW.default_focus(b)
		var tid: String = id
		b.pressed.connect(func():
			cs.tyre = tid
			app.send({"t": "setTyre", "tyre": tid})
			save.call())
		tg.add_child(b)
	tyres_col.add_child(tg)
	var tp := UIW.panel(UIW.scroll(tyres_col))
	tp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(tp)
	# the car's settings as rows
	var rcol := UIW.vbox(0)
	rcol.add_child(UIKit.label(I18n.t("Aero and brakes").to_upper(), 22, UIKit.TEXT, true, 600))
	var wing_opts: Array = []
	for k in ["low", "medium", "high"]:
		wing_opts.append([k, I18n.t(CarSetup.WING[k].label)])
	rcol.add_child(UIW.row(I18n.t("Rear wing"), UIW.stepper(cs.wing, wing_opts, func(v): cs.wing = v; save.call())))
	var bias_out := UIKit.label(I18n.t("{pct} % front", {"pct": roundi(cs.brakeBias * 100)}), 15, UIKit.TEXT, false, 600)
	var bias := UIW.slider(cs.brakeBias, 0.54, 0.66, 0.01, func(v):
		cs.brakeBias = v
		bias_out.text = I18n.t("{pct} % front", {"pct": roundi(v * 100)})
		Settings.save())
	bias.custom_minimum_size = Vector2(150, 30)
	var br := UIW.hbox(10)
	br.add_child(bias)
	br.add_child(bias_out)
	rcol.add_child(UIW.row(I18n.t("Brake balance"), br))
	if room.get("rules", {}).get("fuel", false):
		var g := Control.new()
		g.custom_minimum_size = Vector2(0, 14)
		rcol.add_child(g)
		rcol.add_child(UIKit.label(I18n.t("Fuel").to_upper(), 22, UIKit.TEXT, true, 600))
		rcol.add_child(_fuel_row(room, float(track.get("length", 5000)), cs))
	rcol.add_child(UIW.margins(_tyre_guide(), 0, 14, 0, 0))
	var rp := UIW.panel(UIW.scroll(rcol))
	rp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(rp)
	return row

## Named setups, kept on this device, and the text code that shares one with a friend.
static func _setup_library(app: App, cs: Dictionary, save: Callable) -> Control:
	var box := UIW.vbox(8)
	box.add_child(UIW.section(I18n.t("Saved setups")))
	var status := UIKit.label("", 14, UIKit.SOFT)
	var name_in := LineEdit.new()
	name_in.max_length = 24
	name_in.placeholder_text = I18n.t("Name for this setup")
	name_in.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var row := UIW.hbox(8)
	row.add_child(name_in)
	row.add_child(UIKit.button(I18n.t("Save"), func():
		if name_in.text.strip_edges().is_empty():
			status.text = I18n.t("Type a name first")
			return
		CarSetup.save_named(name_in.text, cs)
		app.render_briefing(), true))
	box.add_child(row)
	for nm in CarSetup.saved_names():
		var r := UIW.hbox(8)
		var lb := UIKit.label(String(nm), 16, UIKit.TEXT, false, 600)
		lb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		r.add_child(lb)
		var key: String = nm
		r.add_child(UIKit.button(I18n.t("Load"), func():
			CarSetup.load_into(cs, Settings.data.savedSetups[key])
			app.send({"t": "setTyre", "tyre": cs.tyre})
			save.call()))
		r.add_child(UIKit.button(I18n.t("Share"), func():
			DisplayServer.clipboard_set(CarSetup.to_code(Settings.data.savedSetups[key]))
			status.text = I18n.t("Code copied: send it to a friend")))
		r.add_child(UIKit.button(I18n.t("Delete"), func():
			CarSetup.delete_named(key)
			app.render_briefing()))
		var rp := PanelContainer.new()
		var st := UIKit.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 0, Vector2(8, 4))
		st.border_color = UIKit.HAIR
		st.border_width_bottom = 1
		rp.add_theme_stylebox_override("panel", st)
		rp.add_child(r)
		box.add_child(rp)
	var io := UIW.hbox(8)
	io.add_child(UIKit.button(I18n.t("Copy code of the current setup"), func():
		DisplayServer.clipboard_set(CarSetup.to_code(cs))
		status.text = I18n.t("Code copied: send it to a friend")))
	io.add_child(UIKit.button(I18n.t("Paste a friend's code"), func():
		var imported = CarSetup.from_code(DisplayServer.clipboard_get())
		if imported == null:
			status.text = I18n.t("The clipboard doesn't hold a setup code")
			return
		CarSetup.load_into(cs, imported)
		app.send({"t": "setTyre", "tyre": cs.tyre})
		save.call()))
	box.add_child(UIW.margins(io, 0, 8, 0, 0))
	box.add_child(status)
	return UIW.panel(box)

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
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 14)
	grid.add_theme_constant_override("v_separation", 12)
	for id in ids:
		var cm: Dictionary = Tyres.COMPOUNDS[id]
		var card := UIW.vbox(3)
		card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		card.add_child(UIKit.label(I18n.t(cm.name).to_upper(), 17, UIKit.TEXT, true, 600))
		for bar in [[I18n.t("Dry grip"), (cm.grip - 0.8) / 0.25], [I18n.t("Wet grip"), cm.wetGrip / 0.8], [I18n.t("Life"), 1.0 / cm.wear / max_life], [I18n.t("Warm-up"), 1.0 / cm.heatCap / max_warm]]:
			var row := UIW.hbox(6)
			var lb := UIKit.label(bar[0], 12, UIKit.SOFT)
			lb.custom_minimum_size = Vector2(62, 0)
			row.add_child(lb)
			var pb := ProgressBar.new()
			pb.show_percentage = false
			pb.max_value = 1.0
			pb.value = clampf(bar[1], 0.06, 1.0)
			pb.custom_minimum_size = Vector2(0, 4)
			pb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			pb.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			row.add_child(pb)
			card.add_child(row)
		card.add_child(UIW.muted(I18n.t(note[id]), 12))
		grid.add_child(card)
	var col := UIW.vbox(8)
	col.add_child(UIW.hair())
	col.add_child(UIW.h3(I18n.t("Which tyre?")))
	col.add_child(grid)
	col.add_child(UIW.muted(I18n.t("Rain or a drying track can change the best choice during the session: you can change tyres in the pit box (pit lane next to the start)."), 13))
	return col

static func _fuel_row(room: Dictionary, track_m: float, cs: Dictionary) -> Control:
	var per_lap := (track_m / 1000.0) * VehicleConsts.FUEL.perKm
	var timed: bool = int(room.get("raceMinutes", 0)) > 0
	var laps: int = (ceili((room.raceMinutes * 60.0) / (track_m / 43.0)) + 1) if timed else int(room.raceLaps)
	var need = mini(int(VehicleConsts.FUEL.tankL), ceili((laps + 1) * per_lap)) if laps > 0 else null
	var out := UIKit.label("", 15, UIKit.TEXT, false, 600)
	var show := func(): out.text = I18n.t("{l} l · ~{laps} laps · {kg} kg", {"l": cs.fuelL, "laps": "%.1f" % (cs.fuelL / per_lap), "kg": roundi(cs.fuelL * VehicleConsts.FUEL.kgPerL)})
	show.call()
	var slider := UIW.slider(cs.fuelL, 10, VehicleConsts.FUEL.tankL, 1, func(v): cs.fuelL = int(v); show.call(); Settings.save())
	slider.custom_minimum_size = Vector2(150, 30)
	var row := UIW.hbox(10)
	row.add_child(slider)
	row.add_child(out)
	var col := UIW.vbox(6)
	col.add_child(UIW.row(I18n.t("Fuel"), row))
	var note: String = I18n.t("The race needs ~{need} l ({per} l a lap). Less is lighter and faster, but you will have to refuel.", {"need": need, "per": "%.1f" % per_lap}) if need != null else I18n.t("About {per} l a lap. Less fuel is lighter and faster.", {"per": "%.1f" % per_lap})
	var rules: Dictionary = room.get("rules", {})
	if laps > 1 and rules.get("pitWindow", false) and not timed:
		var w := RaceTracker.pit_window_laps(laps)
		note += " " + I18n.t("Mandatory stop on laps {a}–{b}.", {"a": w.open, "b": w.close})
	if timed and rules.get("pitWindow", false):
		note += " " + I18n.t("Mandatory stop: into the pit lane between {a} and {b} min.", {"a": roundi(room.raceMinutes * RaceTracker.PIT_WINDOW.timedOpenShare), "b": roundi(room.raceMinutes * RaceTracker.PIT_WINDOW.timedCloseShare)})
	col.add_child(UIW.muted(note, 13))
	if need != null:
		var b := UIKit.button(I18n.t("Fuel for the whole race ({l} l)", {"l": need}), func():
			cs.fuelL = need
			slider.value = need
			Settings.save())
		b.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		col.add_child(b)
	return col

## The deeper setup (pressures, ride height, anti-roll bars, dampers) as rows of sliders, front and rear.
static func _advanced(app: App, cs: Dictionary, air_c: float) -> Control:
	var opt: float = Tyres.COMPOUNDS[cs.tyre].optimumC
	var set_c := air_c + 12.0
	var ideal := VehicleConsts.ideal_cold_psi(opt, set_c)
	var P := VehicleConsts.TYRE_PRESSURE
	var hot := func(cold: float) -> float: return (cold + P.atmPsi) * ((opt + 273.15) / (set_c + 273.15)) - P.atmPsi
	var body := UIW.vbox(0)
	var auto: bool = cs.pressure == null
	body.add_child(UIW.section(I18n.t("Advanced setup")))
	body.add_child(UIW.row(I18n.t("Crew sets the tyre pressures ({p} psi cold → {hot} psi hot)", {"p": "%.1f" % ideal, "hot": P.targetPsi}), UIW.switch(auto, func(v):
		cs.pressure = null if v else [ideal, ideal]
		Settings.save()
		app.render_briefing())))
	var slider := func(value: float, lo: float, hi: float, step: float, fmt: Callable, on: Callable) -> Control:
		var out := UIKit.label(fmt.call(value), 14, UIKit.TEXT, false, 600)
		out.custom_minimum_size = Vector2(150, 0)
		var s := UIW.slider(value, lo, hi, step, func(v): on.call(v); out.text = fmt.call(v); Settings.save())
		s.custom_minimum_size = Vector2(150, 30)
		var r := UIW.hbox(8)
		r.add_child(s)
		r.add_child(out)
		return r
	var pair := func(label: String, make: Callable) -> void:
		for axle in 2:
			body.add_child(UIW.row("%s · %s" % [label, I18n.t("Front") if axle == 0 else I18n.t("Rear")], make.call(axle)))
	if not auto:
		pair.call(I18n.t("Tyre pressure (cold)"), func(axle): return slider.call(
			(cs.pressure if cs.pressure != null else [ideal, ideal])[axle], P.minColdPsi, P.maxColdPsi, 0.1,
			func(v): return I18n.t("{p} psi → ~{hot} hot", {"p": "%.1f" % v, "hot": "%.1f" % hot.call(v)}),
			func(v):
				if cs.pressure == null:
					cs.pressure = [ideal, ideal]
				cs.pressure[axle] = v))
	pair.call(I18n.t("Ride height"), func(axle): return slider.call(cs.ride[axle], -CarSetup.SETUP.rideMm, CarSetup.SETUP.rideMm, 1,
		func(v): return I18n.t("baseline") if int(v) == 0 else "%s%d mm" % ["+" if v > 0 else "", int(v)], func(v): cs.ride[axle] = int(v)))
	var clicks := func(key: String, soft: String, stiff: String) -> Callable:
		return func(axle): return slider.call(cs[key][axle], 1, CarSetup.SETUP.clicks, 1,
			func(v): return "%d%s" % [int(v), (" (%s)" % I18n.t("baseline")) if int(v) == CarSetup.SETUP.baseline else (" · " + soft if v < CarSetup.SETUP.baseline else " · " + stiff)],
			func(v): cs[key][axle] = int(v))
	pair.call(I18n.t("Anti-roll bar"), clicks.call("arb", I18n.t("soft"), I18n.t("stiff")))
	pair.call(I18n.t("Dampers: bump"), clicks.call("bump", I18n.t("soft"), I18n.t("stiff")))
	pair.call(I18n.t("Dampers: rebound"), clicks.call("rebound", I18n.t("soft"), I18n.t("stiff")))
	pair.call(I18n.t("Springs"), clicks.call("springs", I18n.t("soft"), I18n.t("stiff")))
	# alignment
	body.add_child(UIW.section(I18n.t("Alignment")))
	pair.call(I18n.t("Camber"), func(axle): return slider.call(float(cs.camber[axle]), CarSetup.SETUP.camber[axle][0], CarSetup.SETUP.camber[axle][1], 0.1,
		func(v): return "%.1f°" % v, func(v): cs.camber[axle] = snappedf(v, 0.1)))
	pair.call(I18n.t("Toe"), func(axle): return slider.call(float(cs.toe[axle]), CarSetup.SETUP.toe[axle][0], CarSetup.SETUP.toe[axle][1], 0.01,
		func(v): return ("%.2f° " % absf(v)) + (I18n.t("out") if v < 0.0 else (I18n.t("in") if v > 0.0 else "")), func(v): cs.toe[axle] = snappedf(v, 0.01)))
	# differential, brakes, gearing, engine
	var one := func(key: String, lo: float, hi: float, step: float, fmt: Callable) -> Control:
		return slider.call(float(cs[key]), lo, hi, step, fmt, func(v): cs[key] = v if step < 1.0 else int(v))
	body.add_child(UIW.section(I18n.t("Differential")))
	body.add_child(UIW.row(I18n.t("Preload"), one.call("diffPreload", CarSetup.SETUP.preload[0], CarSetup.SETUP.preload[1], 5.0, func(v): return "%d Nm" % int(v))))
	body.add_child(UIW.row(I18n.t("Locking on power"), one.call("diffLock", 1, CarSetup.SETUP.clicks, 1.0, func(v): return "%d / %d" % [int(v), CarSetup.SETUP.clicks])))
	body.add_child(UIW.row(I18n.t("Locking off power"), one.call("diffCoast", 1, CarSetup.SETUP.clicks, 1.0, func(v): return "%d / %d" % [int(v), CarSetup.SETUP.clicks])))
	body.add_child(UIW.section(I18n.t("Brakes and engine")))
	body.add_child(UIW.row(I18n.t("Brake pressure"), one.call("brakePressure", CarSetup.SETUP.brakePressure[0], CarSetup.SETUP.brakePressure[1], 0.01, func(v): return "%d %%" % roundi(v * 100.0))))
	body.add_child(UIW.row(I18n.t("Brake ducts"), one.call("brakeDucts", 1, 5, 1.0, func(v): return "%d / 5%s" % [int(v), " · " + I18n.t("cooler") if v > 3 else (" · " + I18n.t("hotter") if v < 3 else "")])))
	body.add_child(UIW.row(I18n.t("Final drive"), one.call("finalDrive", -CarSetup.SETUP.finalDriveSteps, CarSetup.SETUP.finalDriveSteps, 1.0, func(v): return I18n.t("baseline") if int(v) == 0 else ("%+d %% · %s" % [int(v) * 2, I18n.t("shorter") if v > 0 else I18n.t("longer")]))))
	body.add_child(UIW.row(I18n.t("Engine map"), one.call("engineMap", 1, 3, 1.0, func(v): return "%d · %s" % [int(v), I18n.t(CarSetup.SETUP.maps[int(v) - 1].label)])))
	body.add_child(UIW.margins(UIW.muted(I18n.t("Hot target {p} psi: too low runs hot and soft, too high loses grip. Lower = more downforce but it bottoms over kerbs; rear higher than front moves grip to the front. A stiffer anti-roll bar takes grip from its axle (stiff front = understeer). Stiffer dampers react faster but skip over bumps. Stiffer springs: sharper, less grip over bumps. More negative camber: more grip in long corners, too much costs braking. Front toe-out: quicker turn-in; rear toe-in: a stable rear. More diff locking: better traction, more understeer on the way in. Bigger ducts cool the brakes and tyres. A shorter final drive accelerates harder, tops out sooner. Leaner maps save fuel for a little power.", {"p": P.targetPsi}), 13), 10, 10, 10, 6))
	var reset := UIKit.button(I18n.t("Reset to baseline"), func():
		cs.pressure = null
		cs.ride = [0, 0]
		cs.arb = [4, 4]
		cs.bump = [4, 4]
		cs.rebound = [4, 4]
		var d: Dictionary = Settings.default_settings().carSetup
		for k in ["springs", "camber", "toe", "diffPreload", "diffLock", "diffCoast", "brakePressure", "brakeDucts", "finalDrive", "engineMap"]:
			cs[k] = d[k] if typeof(d[k]) != TYPE_ARRAY else (d[k] as Array).duplicate()
		Settings.save()
		app.render_briefing())
	reset.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	body.add_child(UIW.margins(reset, 10, 4, 0, 0))
	return UIW.panel(body)

# ------------------------------------------------------------------ watch ---

## Watching (spectator connection): the room as it is, waiting for the next session.
static func build_watch(app: App) -> Control:
	var room: Dictionary = app.room
	var col := UIW.vbox(10)
	col.add_child(UIW.section(I18n.t("Watching room {code}", {"code": room.get("code", "")})))
	col.add_child(UIW.muted(I18n.t("Watching this room: the next session will show here.")))
	for p in room.get("players", []):
		var r := UIW.hbox(8)
		r.add_child(UIKit.label(p.nick, 18, UIKit.TEXT, false, 600))
		if p.bot:
			r.add_child(UIW.tag(I18n.t("BOT"), Color(1, 1, 1, 0.6), false))
		col.add_child(r)
	var p := UIW.panel(col)
	p.custom_minimum_size = Vector2(520, 0)
	var c := CenterContainer.new()
	c.add_child(p)
	var top := UIW.top_bar({"title": I18n.t("Watch"), "back": app.leave})
	return UIW.screen(top, c, UIW.action_bar(null, [UIW.default_focus(UIKit.button(I18n.t("Leave"), app.leave))]))
