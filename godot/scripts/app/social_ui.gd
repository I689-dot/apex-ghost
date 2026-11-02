class_name SocialUI
extends RefCounted
## The account parts of the menu (port of ui/social.ts): sign in / create an account, the friends list with where each
## friend is, live public sessions, the records and the driver profile.

const COUNTRIES := "GB DE FR IT ES NL BE AT CH PT DK SE NO FI PL CZ HU MC US CA MX BR AR CL CO JP CN KR AU NZ ZA AE SA QA BH IN TH MY SG ID IE IS LU LT LV EE SK SI HR RS RO BG GR TR UA RU UY PE VE EC PY BO CR PA GT CU DO PR MA DZ TN EG NG KE IL PH VN TW HK"

static func fmt_lap(ms: float) -> String:
	var m := int(ms / 60000.0)
	return "%d:%06.3f" % [m, (ms - m * 60000.0) / 1000.0]

# ----------------------------------------------------------------- sign in ---

static func sign_in_modal(app: App, on_done: Callable, mode: String = "login") -> void:
	var m := UIW.modal(app.overlay_layer, 440)
	var body: VBoxContainer = m.body
	var close := func(): m.root.queue_free()
	var head := UIW.hbox(8)
	var tt := UIW.vbox(0)
	tt.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	tt.add_child(UIKit.label("APEX GHOST", 13, UIKit.ACCENT_2, true, 700))
	tt.add_child(UIW.h2(I18n.t("Your account")))
	head.add_child(tt)
	head.add_child(UIKit.button("×", close))
	body.add_child(head)
	var state := {"mode": mode}
	var lead := UIW.muted("")
	var nick := LineEdit.new()
	nick.max_length = 16
	nick.placeholder_text = I18n.t("Your nickname")
	var pw := LineEdit.new()
	pw.max_length = 72
	pw.secret = true
	pw.placeholder_text = I18n.t("Password")
	var show := CheckBox.new()
	show.text = I18n.t("Show password")
	show.focus_mode = Control.FOCUS_NONE
	show.toggled.connect(func(on): pw.secret = not on)
	var err := UIKit.label("", 15, UIKit.BAD)
	err.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	var submit := UIKit.button("", Callable(), true)
	var tabs := UIW.hbox(6)
	var set_mode := Callable()
	set_mode = func(md: String):
		state.mode = md
		lead.text = I18n.t("Welcome back. Sign in to play online with your friends.") if md == "login" else I18n.t("Just a nickname and a password. Your laps and results are kept, and friends can find you.")
		submit.text = (I18n.t("Sign in") if md == "login" else I18n.t("Create account")).to_upper()
		err.text = ""
	tabs.add_child(UIKit.button(I18n.t("Sign in"), func(): set_mode.call("login")))
	tabs.add_child(UIKit.button(I18n.t("Create account"), func(): set_mode.call("register")))
	body.add_child(tabs)
	body.add_child(lead)
	body.add_child(UIW.field(I18n.t("Nickname"), nick))
	body.add_child(UIW.field(I18n.t("Password") + ("  (" + I18n.t("4 to 72 characters") + ")" if mode == "register" else ""), pw))
	body.add_child(show)
	body.add_child(err)
	var go := func():
		err.text = ""
		submit.disabled = true
		var r: Dictionary
		if state.mode == "register":
			r = await Account.register(nick.text, pw.text)
		else:
			r = await Account.login(nick.text, pw.text)
		submit.disabled = false
		if r.ok:
			close.call()
			on_done.call()
		else:
			err.text = I18n.t(str(r.error))
	submit.pressed.connect(go)
	pw.text_submitted.connect(func(_t): go.call())
	body.add_child(submit)
	body.add_child(UIW.muted(I18n.t("Online play needs an account. Solo races work without one."), 13))
	set_mode.call(mode)
	nick.grab_focus.call_deferred()

# ----------------------------------------------------------------- friends ---

static func _where(p: Variant, app: App) -> String:
	if p == null:
		return I18n.t("Offline")
	var track: String = app.track_entry(str(p.get("trackId", ""))).get("name", "")
	var session: String = {"race": I18n.t("race"), "qualifying": I18n.t("qualifying"), "practice": I18n.t("practice")}.get(p.get("session"), "")
	if p.state == "menu":
		return I18n.t("Online · in the menu")
	if p.state == "lobby":
		return I18n.t("In lobby {room}", {"room": p.room}) if p.get("room") != null else I18n.t("In a lobby")
	if p.state == "watching":
		return I18n.t("Watching {room}", {"room": p.get("room", "")})
	return I18n.t("Racing · {track} {session}", {"track": track, "session": session}).strip_edges() if track != "" else I18n.t("Racing")

static func _ago(ms) -> String:
	if ms == null or ms == 0:
		return ""
	var m := roundi((Time.get_unix_time_from_system() * 1000.0 - ms) / 60000.0)
	if m < 60:
		return I18n.t("{n} min ago", {"n": maxi(1, m)})
	var hrs := roundi(m / 60.0)
	return I18n.t("{n} h ago", {"n": hrs}) if hrs < 48 else I18n.t("{n} days ago", {"n": roundi(hrs / 24.0)})

static func friends_panel(app: App, join: Callable, watch: Callable) -> Control:
	var list := UIW.vbox(6)
	var err := UIKit.label("", 15, UIKit.BAD)
	var input := LineEdit.new()
	input.max_length = 16
	input.placeholder_text = I18n.t("Add a friend by nickname")
	input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var card := UIW.vbox(8)
	var refresh := Callable()
	refresh = func():
		var all: Array = await Account.friends()
		if not is_instance_valid(list):
			return
		var rank := func(f: Dictionary) -> int:
			if f.status == "incoming":
				return 0
			if f.get("presence") != null:
				return 1 if f.presence.state == "racing" else 2
			return 4 if f.status == "outgoing" else 3
		all.sort_custom(func(a, b): return rank.call(a) < rank.call(b) or (rank.call(a) == rank.call(b) and a.nick.naturalnocasecmp_to(b.nick) < 0))
		for c in list.get_children():
			c.queue_free()
		if all.is_empty():
			list.add_child(UIW.muted(I18n.t("No friends yet: add them by their nickname.")))
		for f in all:
			list.add_child(_friend_row(app, f, join, watch, refresh, err))
	var add := func():
		err.text = ""
		var r: Dictionary = await Account.add_friend(input.text)
		if r.ok:
			input.text = ""
			refresh.call()
		else:
			err.text = I18n.t(str(r.error))
	input.text_submitted.connect(func(_t): add.call())
	var row := UIW.hbox(8)
	row.add_child(input)
	row.add_child(UIKit.button(I18n.t("Add"), add))
	card.add_child(UIW.h3(I18n.t("Friends")))
	card.add_child(UIW.scroll(list))
	card.add_child(row)
	card.add_child(err)
	var timer := Timer.new()
	timer.wait_time = 15.0
	timer.autostart = true
	timer.timeout.connect(func(): refresh.call())
	card.add_child(timer)
	refresh.call.call_deferred()
	return UIW.panel(card)

static func _friend_row(app: App, f: Dictionary, join: Callable, watch: Callable, refresh: Callable, err: Label) -> Control:
	var p = f.get("presence")
	var row := UIW.hbox(10)
	var info := UIW.vbox(0)
	info.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	info.add_child(UIKit.label(f.nick, 18, UIKit.GOOD if p != null else UIKit.TEXT, false, 700))
	var status := ""
	if f.status == "incoming":
		status = I18n.t("Wants to be your friend")
	elif f.status == "outgoing":
		status = I18n.t("Request sent")
	elif p != null:
		status = _where(p, app)
	else:
		status = "%s · %s" % [I18n.t("Offline"), _ago(f.get("lastSeen"))]
	info.add_child(UIKit.label(status, 13, UIKit.MUTED))
	row.add_child(info)
	var act := func(label: String, fn: Callable) -> void:
		row.add_child(UIKit.button(label, func():
			err.text = ""
			await fn.call()
			refresh.call()))
	if f.status == "incoming":
		act.call(I18n.t("Accept"), func(): await Account.accept_friend(f.id))
		act.call(I18n.t("Decline"), func(): await Account.remove_friend(f.id))
	elif f.status == "outgoing":
		act.call(I18n.t("Cancel"), func(): await Account.remove_friend(f.id))
	elif p != null and p.get("room") != null and p.state == "lobby":
		act.call(I18n.t("Join"), func(): join.call(p.room))
	elif p != null and p.get("room") != null and (p.state == "racing" or p.state == "watching"):
		act.call(I18n.t("Watch"), func(): watch.call(p.room))
	if f.status == "friend":
		act.call("×", func(): await Account.remove_friend(f.id))
	return row

# --------------------------------------------------------------- live rooms ---

static func room_list(app: App, join: Callable, watch: Callable) -> Control:
	var list := UIW.vbox(6)
	list.add_child(UIW.muted(I18n.t("Looking for public sessions…")))
	var phase_text := func(r: Dictionary) -> String:
		if r.phase == "lobby":
			return I18n.t("In the lobby")
		if r.phase == "briefing":
			return I18n.t("Briefing")
		if r.kind == "race":
			return I18n.t("Race · {n} laps", {"n": r.raceLaps}) if r.raceLaps > 0 else I18n.t("Race · timed")
		if r.kind == "practice":
			return I18n.t("Free practice")
		return I18n.t("Qualifying · {m} min", {"m": r.sessionMinutes})
	var refresh := func():
		var rooms: Array = await Connection.list_public_rooms()
		if not is_instance_valid(list) or app.screen != "menu":
			return
		for c in list.get_children():
			c.queue_free()
		if rooms.is_empty():
			list.add_child(UIW.muted(I18n.t("No public sessions right now. Create a room and make it public, or play solo.")))
		for r in rooms:
			var row := UIW.hbox(12)
			row.add_child(UIKit.label(I18n.t(app.track_entry(r.trackId).get("name", r.trackId)), 17, UIKit.TEXT, false, 700))
			row.add_child(UIKit.label(phase_text.call(r), 15))
			var who := UIKit.label("%s: %s · %s" % [I18n.t("Host"), r.host, I18n.t("Drivers {n}/{max}", {"n": r.drivers, "max": r.maxPlayers})], 14, UIKit.MUTED)
			who.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			row.add_child(who)
			if r.phase == "lobby" and r.drivers < r.maxPlayers:
				row.add_child(UIKit.button(I18n.t("Join"), func(): join.call(r.code)))
			row.add_child(UIKit.button(I18n.t("Watch"), func(): watch.call(r.code)))
			list.add_child(row)
	var col := UIW.vbox(8)
	col.add_child(UIW.h3(I18n.t("Live sessions")))
	col.add_child(list)
	var timer := Timer.new()
	timer.wait_time = 15.0
	timer.autostart = true
	timer.timeout.connect(refresh)
	col.add_child(timer)
	refresh.call_deferred()
	return UIW.panel(col)

# ----------------------------------------------------------------- records ---

static func records_modal(app: App) -> void:
	var m := UIW.modal(app.overlay_layer, 900)
	var body: VBoxContainer = m.body
	var close := func(): m.root.queue_free()
	var head := UIW.hbox(8)
	var tt := UIW.h2(I18n.t("Records"))
	tt.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(tt)
	head.add_child(UIKit.button("×", close))
	body.add_child(head)
	var tracks: Array = app.track_index
	var cars: Array = app.cars.cars
	var state := {"track": tracks[0].id, "car": "", "scope": "global", "wet": false}
	for t in tracks:
		if t.get("default", false):
			state.track = t.id
	var car_name := func(id: String) -> String:
		for c in cars:
			if c.id == id:
				return c.name
		return id
	var results := UIW.vbox(4)
	var load := Callable()
	load = func():
		for c in results.get_children():
			c.queue_free()
		results.add_child(UIW.muted(I18n.t("Loading…")))
		var rows: Array = await Account.records(state)
		if not is_instance_valid(results):
			return
		for c in results.get_children():
			c.queue_free()
		if rows.is_empty():
			results.add_child(UIW.muted(I18n.t("No laps here yet. Sign in and set the first one!")))
			return
		var best: float = rows[0].lapMs
		var grid := GridContainer.new()
		grid.columns = 6
		grid.add_theme_constant_override("h_separation", 14)
		for h in [I18n.t("Pos"), I18n.t("Driver"), I18n.t("Car"), I18n.t("Lap"), I18n.t("Gap"), I18n.t("Laps")]:
			grid.add_child(UIKit.label(String(h).to_upper(), 12, UIKit.MUTED, true, 700))
		for r in rows:
			var col := UIKit.ACCENT_2 if r.get("me", false) else UIKit.TEXT
			grid.add_child(UIKit.label(str(r.position), 15, col))
			grid.add_child(UIKit.label(r.nick, 15, col))
			grid.add_child(UIKit.label(car_name.call(r.carId), 15, col))
			grid.add_child(UIKit.label(fmt_lap(r.lapMs), 15, col))
			grid.add_child(UIKit.label("" if r.position == 1 else "+%.3f" % ((r.lapMs - best) / 1000.0), 15, UIKit.MUTED))
			grid.add_child(UIKit.label(str(r.laps), 15, UIKit.MUTED))
		results.add_child(grid)
	var filters := UIW.hbox(8)
	filters.add_child(UIW.select(state.track, tracks.map(func(t): return [t.id, I18n.t(t.name)]), func(v): state.track = v; load.call()))
	var car_opts: Array = [["", I18n.t("All cars")]]
	for c in cars:
		if c.role != "safety":
			car_opts.append([c.id, c.name])
	filters.add_child(UIW.select("", car_opts, func(v): state.car = v; load.call()))
	filters.add_child(UIW.select("global", [["global", I18n.t("Everyone")], ["friends", I18n.t("Friends")]], func(v): state.scope = v; load.call()))
	filters.add_child(UIW.select("dry", [["dry", I18n.t("Dry")], ["wet", I18n.t("Wet")]], func(v): state.wet = v == "wet"; load.call()))
	body.add_child(filters)
	var sc := UIW.scroll(results)
	sc.custom_minimum_size = Vector2(0, 220)
	body.add_child(sc)
	# the career
	var career := UIW.vbox(6)
	body.add_child(career)
	var load_career := func():
		if Account.account() == null:
			career.add_child(UIW.muted(I18n.t("Sign in to see your career.")))
			return
		var s: Dictionary = await Account.stats()
		if not is_instance_valid(career) or s.is_empty():
			return
		career.add_child(UIW.h3(s.nick))
		var tiles := UIW.hbox(18)
		for t in [[I18n.t("Races"), s.races], [I18n.t("Wins"), s.wins], [I18n.t("Podiums"), s.podiums], [I18n.t("Qualifyings"), s.qualifyings], [I18n.t("Poles"), s.poles], [I18n.t("Timed laps"), s.laps]]:
			var c := UIW.vbox(0)
			c.add_child(UIKit.label(str(t[1]), 26, UIKit.TEXT, true, 700))
			c.add_child(UIKit.label(t[0], 12, UIKit.MUTED))
			tiles.add_child(c)
		career.add_child(tiles)
		career.add_child(UIW.h3(I18n.t("Your best laps")))
		if s.best.is_empty():
			career.add_child(UIW.muted(I18n.t("No timed laps yet.")))
		for b in s.best:
			career.add_child(UIKit.label("%s   %s   %s" % [I18n.t(app.track_entry(b.trackId).get("name", b.trackId)), fmt_lap(b.lapMs), car_name.call(b.carId)], 15))
	load.call()
	load_career.call()

# ----------------------------------------------------------------- profile ---

static func profile_modal(app: App, on_done: Callable) -> void:
	var me: Dictionary = Account.account().user
	var m := UIW.modal(app.overlay_layer, 440)
	var body: VBoxContainer = m.body
	var close := func(): m.root.queue_free(); on_done.call()
	var head := UIW.hbox(8)
	var tt := UIW.vbox(0)
	tt.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	tt.add_child(UIKit.label(me.nick, 13, UIKit.ACCENT_2, true, 700))
	tt.add_child(UIW.h2(I18n.t("Driver profile")))
	head.add_child(tt)
	head.add_child(UIKit.button("×", close))
	body.add_child(head)
	body.add_child(UIW.muted(I18n.t("How you appear on the timing screens: your flag, your number and your three-letter code.")))
	var opts: Array = [["", I18n.t("Not set")]]
	for c in COUNTRIES.split(" "):
		opts.append([c, c])
	var country := UIW.select(me.get("country", ""), opts, func(_v): pass)
	var row := UIW.hbox(8)
	row.add_child(country)
	body.add_child(UIW.field(I18n.t("Country"), row))
	var num := SpinBox.new()
	num.min_value = 0
	num.max_value = 999
	num.value = me.get("num", 0) if me.get("num") != null else 0
	body.add_child(UIW.field(I18n.t("Car number") + " (1 - 999)", num))
	var abbr := LineEdit.new()
	abbr.max_length = 3
	abbr.text = me.get("abbr", "") if me.get("abbr") != null else ""
	abbr.text_changed.connect(func(t): abbr.text = t.to_upper(); abbr.caret_column = abbr.text.length())
	body.add_child(UIW.field(I18n.t("Code"), abbr))
	var colour := ColorPickerButton.new()
	colour.color = Color(me.get("colour", "#ff2d3d") if me.get("colour") != null else "#ff2d3d")
	colour.custom_minimum_size = Vector2(0, 40)
	body.add_child(UIW.field(I18n.t("Helmet colour"), colour))
	var err := UIKit.label("", 15, UIKit.BAD)
	body.add_child(err)
	body.add_child(UIKit.button(I18n.t("Save"), func():
		err.text = ""
		var n = int(num.value) if num.value > 0 else null
		var a = abbr.text if abbr.text != "" else null
		if n != null and (n < 1 or n > 999):
			err.text = I18n.t("The number goes from 1 to 999.")
			return
		if a != null and not RegEx.create_from_string("^[A-Z]{3}$").search(a):
			err.text = I18n.t("The code is three letters.")
			return
		var r: Dictionary = await Account.save_profile({"country": country_value(country, opts), "num": n, "abbr": a, "colour": "#" + colour.color.to_html(false)})
		if r.ok:
			close.call()
		else:
			err.text = str(r.error), true))

static func country_value(sel: OptionButton, opts: Array) -> Variant:
	var v: String = opts[sel.selected][0]
	return v if v != "" else null
