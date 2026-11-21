class_name MobileModes
extends RefCounted
## The mobile layout's Game Modes (after RESOURCES/UI-MOBILE-REFERENCE): the categories down the left (Career, Events,
## Online racing, Quick race), the category's cards on the right as photo cards with a title strip and a corner badge.
## Career is the ladder of class cups (Progression.CUPS): a cup opens at a number of trophies; its page lists the races,
## each with its best trophies and a start. Events: the week's featured race (double credits), the championship and
## Time trial. Online racing: create a room, join with a code, host on this device, friends.

static var _cat := "career"

static func show(app: App, cat: String = "") -> void:
	if cat != "":
		_cat = cat
	app.screen = "m_modes"
	app.back_to = func() -> void: app.show_menu()
	app.set_backdrop("aerial")
	var holder := Control.new()
	UIKit.full(holder)
	var shade := ColorRect.new()
	shade.color = Color(0.0, 0.01, 0.03, 0.62)
	UIKit.full(shade)
	holder.add_child(shade)
	var top := UIW.top_bar({"title": I18n.t("Game modes"), "back": func() -> void: app.show_menu(),
		"right": [MobileUI.currency("credit", Progression.credits(), func() -> void: MobileHome.open_store(app, "coins")), MobileUI.currency("coin", StoreScreen.coins(), func() -> void: MobileHome.open_store(app, "coins"))]})
	var row := UIW.hbox(18)
	row.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var cats := UIW.vbox(6)
	cats.custom_minimum_size = Vector2(210, 0)
	cats.alignment = BoxContainer.ALIGNMENT_CENTER
	for c: Array in [["career", I18n.t("Career")], ["events", I18n.t("Events")], ["online", I18n.t("Online racing")], ["quick", I18n.t("Quick race")]]:
		var b := Button.new()
		b.text = String(c[1]).to_upper()
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.focus_mode = Control.FOCUS_ALL
		b.custom_minimum_size = Vector2(200, 56)
		b.add_theme_font_override("font", UIKit.font(true, 700))
		b.add_theme_font_size_override("font_size", 22)
		var on: bool = c[0] == _cat
		b.add_theme_color_override("font_color", UIKit.TEXT if on else UIKit.SOFT)
		for st: String in ["normal", "hover", "pressed", "focus"]:
			b.add_theme_stylebox_override(st, UIKit.box(Color(1, 1, 1, 0.16 if on else (0.08 if st == "hover" else 0.0)), Color(0, 0, 0, 0), 0, 6, Vector2(16, 6)))
		var k: String = c[0]
		b.pressed.connect(func() -> void: show(app, k))
		cats.add_child(b if not on else UIW.default_focus(b))
	row.add_child(cats)
	var cards := UIW.hbox(12)
	cards.size_flags_vertical = Control.SIZE_EXPAND_FILL
	cards.custom_minimum_size = Vector2(0, 430)
	match _cat:
		"events":
			_events(app, cards)
		"online":
			_online(app, cards)
		"quick":
			_quick(app, cards)
		_:
			_career(app, cards)
	var sc := UIW.hscroll(cards)
	sc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sc.size_flags_vertical = Control.SIZE_EXPAND_FILL
	row.add_child(sc)
	var body := UIW.margins(row, 22, 18, 0, 22)
	var scr := UIW.screen(top, body)
	UIKit.full(scr)
	holder.add_child(scr)
	app.set_ui(holder)

## A mode card: the photo, the title strip, the line at the bottom, a lock with its condition.
static func _mode_card(title: String, photo: String, sub: String, cb: Callable, lock: String = "", size: Vector2 = Vector2(280, 0)) -> Button:
	var b := MobileUI.card(title, photo, 0.4 if lock != "" else 0.95)
	b.custom_minimum_size = size
	b.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var col := UIW.vbox(4)
	col.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var fill := Control.new()
	fill.size_flags_vertical = Control.SIZE_EXPAND_FILL
	fill.mouse_filter = Control.MOUSE_FILTER_IGNORE
	col.add_child(fill)
	if sub != "":
		var l := UIKit.label(sub, 16, UIKit.TEXT, false, 500)
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		col.add_child(l)
	if lock != "":
		var lr := UIW.hbox(6)
		lr.mouse_filter = Control.MOUSE_FILTER_IGNORE
		lr.add_child(MobileUI.badge(lock, Color(UIKit.BAD, 0.9), Color.WHITE, "lock"))
		col.add_child(lr)
	MobileUI.card_body(b).add_child(col)
	if lock == "":
		b.pressed.connect(cb)
	else:
		b.pressed.connect(func() -> void: pass)
	return b

# ---------------------------------------------------------------- career ---

static func _career(app: App, cards: HBoxContainer) -> void:
	for c in Progression.CUPS:
		var id: String = c[0]
		var open := Progression.cup_open(id)
		var b := _cup_card(app, c, open)
		cards.add_child(b)

static func _cup_card(app: App, c: Array, open: bool) -> Button:
	var id: String = c[0]
	var races: Array = c[3]
	var lic: String = c[1]
	var photo := MobileUI.photo(MobileUI.map_of(app, races[0][0]), "aerial")
	var b := MobileUI.card(I18n.t(c[2]), photo, 0.95 if open else 0.35)
	b.custom_minimum_size = Vector2(250, 0)
	b.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var col := UIW.vbox(6)
	col.mouse_filter = Control.MOUSE_FILTER_IGNORE
	# the class badge, as the references' licence seal
	var seal := CenterContainer.new()
	seal.mouse_filter = Control.MOUSE_FILTER_IGNORE
	seal.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var s := PanelContainer.new()
	s.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var lc := Color(CareerData.LICENCE_COLOUR[lic])
	s.add_theme_stylebox_override("panel", UIKit.box(Color(lc, 0.9), Color.WHITE if open else Color(1, 1, 1, 0.3), 3, 46, Vector2(22, 4)))
	s.add_child(UIKit.label(lic, 58, Color.WHITE, true, 800))
	seal.add_child(s)
	col.add_child(seal)
	col.add_child(UIKit.label(I18n.t(CareerData.LICENCE_NAME[lic]).to_upper() + " · " + I18n.t("{n} races", {"n": races.size()}), 15, UIKit.SOFT, true, 600))
	var tr := UIW.hbox(8)
	tr.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if open:
		tr.add_child(MobileUI.badge("%d/%d" % [Progression.cup_trophies(id), 3 * races.size()], Color(0, 0, 0, 0.8), MobileUI.GOLD, "trophy"))
	else:
		tr.add_child(MobileUI.badge(I18n.t("Unlock: {n}", {"n": int(c[4])}), Color(UIKit.BAD, 0.9), Color.WHITE, "lock"))
		tr.add_child(MobileUI.badge("%d" % Progression.total_trophies(), Color(0, 0, 0, 0.8), MobileUI.GOLD, "trophy"))
	col.add_child(tr)
	MobileUI.card_body(b).add_child(col)
	if open:
		b.pressed.connect(func() -> void: show_cup(app, id))
	else:
		b.pressed.connect(func() -> void: app.toast(I18n.t("Earn {n} trophies in the career to open this cup.", {"n": int(c[4])})))
	return b

## A cup's page: its races as cards (circuit, laps, the AI's level, your best trophies, start).
static func show_cup(app: App, id: String) -> void:
	var c := Progression.cup(id)
	if c.is_empty():
		return
	app.screen = "m_cup"
	app.back_to = func() -> void: show(app, "career")
	var races: Array = c[3]
	app.set_backdrop("grid", races[0][0])
	var holder := Control.new()
	UIKit.full(holder)
	var shade := ColorRect.new()
	shade.color = Color(0.0, 0.01, 0.03, 0.6)
	UIKit.full(shade)
	holder.add_child(shade)
	var top := UIW.top_bar({"title": I18n.t(c[2]), "back": func() -> void: show(app, "career"),
		"right": [MobileUI.badge("%d/%d" % [Progression.cup_trophies(id), 3 * races.size()], Color(0, 0, 0, 0.7), MobileUI.GOLD, "trophy")]})
	var row := UIW.hbox(12)
	row.size_flags_vertical = Control.SIZE_EXPAND_FILL
	row.custom_minimum_size = Vector2(0, 420)
	var res := Progression.cup_results(id)
	for i in races.size():
		var r: Array = races[i]
		var tr := app.track_entry(r[0])
		var b := MobileUI.card(I18n.t("Race {n}", {"n": i + 1}), MobileUI.photo(MobileUI.map_of(app, r[0]), "aerial"), 0.95)
		b.custom_minimum_size = Vector2(270, 0)
		b.size_flags_vertical = Control.SIZE_EXPAND_FILL
		var col := UIW.vbox(6)
		col.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var fill := Control.new()
		fill.size_flags_vertical = Control.SIZE_EXPAND_FILL
		fill.mouse_filter = Control.MOUSE_FILTER_IGNORE
		col.add_child(fill)
		var nm := UIKit.label(I18n.t(str(tr.get("name", r[0]))).to_upper(), 22, UIKit.TEXT, true, 700)
		nm.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		col.add_child(nm)
		col.add_child(UIKit.label(I18n.t("{l} laps · {b} rivals · AI {d}%", {"l": r[1], "b": r[2], "d": roundi(float(r[3]) * 100.0)}), 15, UIKit.SOFT, true, 600))
		col.add_child(MobileUI.trophies(int(res[i]), 3, 22))
		var idx := i
		var go := MobileUI.race_button(I18n.t("Start"), func() -> void: start_cup_race(app, id, idx))
		go.custom_minimum_size = Vector2(0, 50)
		go.add_theme_font_size_override("font_size", 24)
		col.add_child(go)
		MobileUI.card_body(b).add_child(col)
		b.pressed.connect(func() -> void: start_cup_race(app, id, idx))
		row.add_child(b)
	var sc := UIW.hscroll(row)
	var body := UIW.vbox(10)
	body.add_child(UIW.muted(I18n.t("A win gives 3 trophies, a podium 2, a top-six finish 1. Your best result of each race counts."), 15))
	sc.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_child(sc)
	var scr := UIW.screen(top, UIW.margins(body, 22, 14, 0, 22))
	UIKit.full(scr)
	holder.add_child(scr)
	app.set_ui(holder)

## A cup race: a solo room on its circuit, a short qualifying, the race over its laps against its rivals at its AI level;
## the results score it (Progression.score_event).
static func start_cup_race(app: App, cup_id: String, race: int) -> void:
	var r: Array = Progression.cup(cup_id)[3][race]
	if not Packs.ready_for(str(r[0])):
		app.toast(I18n.t("Download the circuit first (Settings › Gameplay › Interface)."))
		return
	Progression.set_event(cup_id, race)
	Progression.data().event.difficulty = Settings.data.ai.difficulty
	Settings.data.ai.difficulty = float(r[3])
	await _solo(app, str(r[0]), int(r[1]), int(r[2]), 2)

## The week's featured race: a circuit by the week of the year, double credits from its trophies.
static func weekly(app: App) -> Dictionary:
	var ids: Array = app.track_index.filter(func(t): return t.id != "nurburgring_24h").map(func(t): return t.id)
	if ids.is_empty():
		ids = ["spa"]
	var week := int(Time.get_unix_time_from_system() / (7 * 86400.0))
	var tid: String = ids[week % ids.size()]
	var left := int((week + 1) * 7 * 86400 - Time.get_unix_time_from_system())
	return {"track": tid, "name": I18n.t("{track} sprint", {"track": I18n.t(str(app.track_entry(tid).get("name", tid)))}), "left_s": left, "laps": 4, "bots": 11}

static func _solo(app: App, track: String, laps: int, bots: int, quali_min: int) -> void:
	app.set_ui(Control.new())
	var err := await app.join(LocalRoom.create(), MobileHome.nick())
	if err != "":
		Progression.clear_event()
		app.show_menu(err)
		return
	app.send({"t": "setConditions", "trackId": track})
	app.send({"t": "setPractice", "minutes": 0})
	app.send({"t": "setSession", "minutes": quali_min})
	app.send({"t": "setRaceMinutes", "minutes": 0})
	app.send({"t": "setRaceLaps", "laps": laps})
	for i in bots:
		app.send({"t": "addBot"})

# ---------------------------------------------------------------- events ---

static func _events(app: App, cards: HBoxContainer) -> void:
	var w := weekly(app)
	cards.add_child(_mode_card(I18n.t("Featured event") + " · " + Progression.fmt_left(w.left_s), MobileUI.photo(MobileUI.map_of(app, w.track), "pole"),
		str(w.name) + " · " + I18n.t("double credits"), func() -> void:
			Progression.set_event("weekly", 0)
			Progression.data().event.difficulty = Settings.data.ai.difficulty
			await _solo(app, w.track, int(w.laps), int(w.bots), 2)))
	var champ = Championship.load_saved()
	cards.add_child(_mode_card(I18n.t("Championship"), "res://assets/ui/photo_aerial_spa.webp",
		I18n.t("Round {n} of {m}", {"n": champ.done + 1, "m": champ.rounds.size()}) if champ != null else I18n.t("A season on every circuit, F1 points"),
		func() -> void: ChampionshipUI.open(app, func(): return MobileHome.nick())))
	cards.add_child(_mode_card(I18n.t("Time trial"), "res://assets/ui/photo_straight.webp", I18n.t("Alone on track, 10 minutes: clean laps in a row count"), func() -> void:
		app.set_ui(Control.new())
		var err := await app.join(LocalRoom.create(), MobileHome.nick())
		if err != "":
			app.show_menu(err)
			return
		app.send({"t": "setPractice", "minutes": 0})
		app.send({"t": "setSession", "minutes": 10})
		app.send({"t": "setRaceLaps", "laps": 0})
		app.send({"t": "setRaceMinutes", "minutes": 0})
		app.send({"t": "setRules", "rules": {"cleanStreak": true}})))

# ---------------------------------------------------------------- online ---

static func _online(app: App, cards: HBoxContainer) -> void:
	var online: bool = Account.account() != null or Account.accounts_enabled() == false
	var lock := "" if online else I18n.t("Sign in")
	cards.add_child(_mode_card(I18n.t("Create room"), "res://assets/ui/photo_grid.webp", I18n.t("Your lobby: invite friends with the code"), func() -> void:
		app.set_ui(Control.new())
		var c := await Connection.create_room()
		if c == "":
			app.show_menu(I18n.t("Cannot reach the game server. Check your connection."))
			return
		var err := await app.join(c, MobileHome.nick())
		if err != "":
			app.show_menu(err), lock))
	cards.add_child(_mode_card(I18n.t("Join room"), "res://assets/ui/photo_pole_zandvoort.webp", I18n.t("A code from a friend"), func() -> void: _join_dialog(app), lock))
	cards.add_child(_mode_card(I18n.t("Host on this device"), "res://assets/ui/photo_hero.webp", I18n.t("Friends nearby join your phone's race"), func() -> void:
		app.set_ui(Control.new())
		var r: Dictionary = await P2p.host_race()
		if r.has("error"):
			app.show_menu(r.error)
			return
		var err := await app.join(r.code, MobileHome.nick())
		if err != "":
			app.show_menu(err)))
	cards.add_child(_mode_card(I18n.t("Friends"), "res://assets/ui/photo_aerial.webp", I18n.t("Where your friends race, live sessions"), func() -> void: app.show_classic_menu("friends"), lock))

static func _join_dialog(app: App) -> void:
	var m := UIW.modal(app.overlay_layer, 460)
	var b: VBoxContainer = m.body
	UIW.modal_head(b, I18n.t("Join room"), func() -> void: m.root.queue_free())
	var code := LineEdit.new()
	code.max_length = 7
	code.placeholder_text = I18n.t("ROOM CODE")
	code.custom_minimum_size = Vector2(0, 56)
	code.add_theme_font_size_override("font_size", 26)
	b.add_child(code)
	var msg := UIKit.label("", 15, UIKit.BAD)
	b.add_child(msg)
	var go := func() -> void:
		var c := Validation.normalize_room_code(code.text)
		if c == "":
			msg.text = I18n.t("Enter the 5-character room code.")
			return
		m.root.queue_free()
		app.set_ui(Control.new())
		var err := await app.join(c, MobileHome.nick())
		if err != "":
			app.show_menu(err)
	code.text_submitted.connect(func(_t): go.call())
	var j := UIKit.button(I18n.t("Join"), go, true)
	j.size_flags_horizontal = Control.SIZE_SHRINK_END
	b.add_child(j)
	code.grab_focus.call_deferred()

# ----------------------------------------------------------------- quick ---

static func _quick(app: App, cards: HBoxContainer) -> void:
	cards.add_child(_mode_card(I18n.t("Quick race"), "res://assets/ui/photo_hero_spa.webp", I18n.t("Any circuit, your settings, the AI"), func() -> void:
		app.set_ui(Control.new())
		var err := await app.join(LocalRoom.create(), MobileHome.nick())
		if err != "":
			app.show_menu(err)))
	for t in app.track_index:
		var id: String = t.id
		cards.add_child(_mode_card(I18n.t(str(t.name)), MobileUI.photo(str(t.get("map", "")), "aerial"), I18n.t("{km} km · 3 laps", {"km": "%.1f" % (float(t.length) / 1000.0)}), func() -> void:
			if not Packs.ready_for(id):
				app.toast(I18n.t("Download the circuit first (Settings › Gameplay › Interface)."))
				return
			await _solo(app, id, 3, 9, 2), "", Vector2(240, 0)))
