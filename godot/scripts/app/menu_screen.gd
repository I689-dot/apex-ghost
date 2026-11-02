class_name MenuScreen
extends RefCounted
## The main menu (port of App.showMenu): mode tiles (solo, online room, championship, join), join by code / watch,
## settings, and the driver chip with the solo career's licence.

static func build(app: App, error: String = "") -> Control:
	var signed_in = Account.account()
	var tab := ["play"]
	var body := MarginContainer.new()
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var err := UIKit.label(error, 16, UIKit.BAD)
	err.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	var nick := LineEdit.new()
	nick.max_length = 16
	nick.placeholder_text = I18n.t("Your nickname")
	nick.text = signed_in.user.nick if signed_in != null else Settings.data.get("nickname", "")
	nick.editable = signed_in == null
	nick.custom_minimum_size = Vector2(200, 0)
	var code := LineEdit.new()
	code.max_length = 7
	code.placeholder_text = I18n.t("ROOM CODE")
	code.custom_minimum_size = Vector2(220, 0)
	code.text_changed.connect(func(t): code.text = t.to_upper(); code.caret_column = code.text.length())

	var online: bool = signed_in != null or Account.accounts_enabled() == false
	if not online and Account.accounts_enabled() == null:
		_probe(app, error)
	var read_nick := func() -> String:
		var r := Validation.sanitize_nickname(nick.text)
		if not r.ok:
			err.text = r.error
			nick.grab_focus()
			return ""
		Settings.data.nickname = r.nick
		Settings.save()
		return r.nick
	var go := func(starter: Callable) -> void:
		var n: String = read_nick.call()
		if n == "":
			return
		err.text = ""
		app.set_ui(_busy())
		var res: String = await starter.call(n)
		if res != "":
			app.show_menu(res)
	var solo := func():
		await go.call(func(n):
			return await app.join(LocalRoom.create(), n))
	var create := func():
		await go.call(func(n):
			var c := await Connection.create_room()
			if c == "":
				return I18n.t(Connection.last_error) if Connection.last_error != "" else I18n.t("Cannot reach the game server. Check your connection.")
			return await app.join(c, n))
	var join_it := func(spectate: bool = false, code_in: String = ""):
		var c := Validation.normalize_room_code(code_in if code_in != "" else code.text)
		if c == "":
			err.text = I18n.t("Enter the 5-character room code.")
			code.grab_focus()
			return
		await go.call(func(n):
			# a race hosted on a device: straight to it (no account needed, as on a LAN)
			var hosted: bool = await P2p.is_p2p_code(c)
			if not hosted and not online:
				return I18n.t("Online needs an account")
			return await app.join(c, n, spectate))
	var host := func():
		await go.call(func(n):
			var r: Dictionary = await P2p.host_race()
			if r.has("error"):
				return r.error
			return await app.join(r.code, n))
	var sign_in := func(): SocialUI.sign_in_modal(app, func(): app.show_menu())

	var render := Callable()
	render = func():
		# the error line and the code box are shared by the tabs: detach them before the old tab is freed
		for shared in [err, code]:
			if shared.get_parent() != null:
				shared.get_parent().remove_child(shared)
		for c in body.get_children():
			c.queue_free()
		if tab[0] == "play":
			var tiles := HBoxContainer.new()
			tiles.add_theme_constant_override("separation", 14)
			tiles.size_flags_vertical = Control.SIZE_EXPAND_FILL
			var champ = Championship.load_saved()
			tiles.add_child(_tile("photo_hero_spa.webp", I18n.t("OFFLINE"), I18n.t("Play solo (offline)"), I18n.t("Race the AI on any circuit. No account, no server."), solo, ""))
			tiles.add_child(_tile("photo_hero.webp", I18n.t("ONLINE"), I18n.t("Create room"), I18n.t("Your own lobby: invite friends with the room code, add AI cars."), create if online else sign_in, "" if online else I18n.t("Sign in to play online")))
			tiles.add_child(_tile("photo_aerial_spa.webp", I18n.t("OFFLINE"),
				I18n.t("Championship · round {n}/{m}", {"n": champ.done + 1, "m": champ.rounds.size()}) if champ != null else I18n.t("Championship"),
				I18n.t("A season against the AI on every circuit, points as in F1."), func(): ChampionshipUI.open(app, read_nick), ""))
			tiles.add_child(_tile("photo_hero_zandvoort.webp", I18n.t("ONLINE"), I18n.t("Join friends"), I18n.t("A room code from a friend, or a live public session."),
				(func(): tab[0] = "online"; render.call()) if online else sign_in, "" if online else I18n.t("Sign in to play online")))
			var col := UIW.vbox(8)
			col.add_child(tiles)
			col.add_child(err)
			tiles.custom_minimum_size = Vector2(0, 260)
			body.add_child(col)
		elif tab[0] == "online":
			body.add_child(_online_tab(app, online, code, err, join_it, create, sign_in, host))
		else:
			body.add_child(SocialUI.friends_panel(app, func(c): code.text = c; join_it.call(false), func(c): join_it.call(true, c)) if signed_in != null else _gate(I18n.t("Friends"), I18n.t("Sign in to add friends, see where they are and join their lobbies."), sign_in))

	var tabs := HBoxContainer.new()
	tabs.add_theme_constant_override("separation", 6)
	for t in [["play", I18n.t("Play")], ["online", I18n.t("Online")], ["friends", I18n.t("Friends")]]:
		var b := UIKit.button(t[1], func(): tab[0] = t[0]; render.call())
		tabs.add_child(b)
	tabs.add_child(UIKit.button(I18n.t("Records"), func(): SocialUI.records_modal(app)))
	tabs.add_child(UIKit.button(I18n.t("Settings"), app.open_settings))

	var career := CareerData.load_career()
	var lic: String = career.licence
	var chip := UIW.hbox(10)
	var badge := UIKit.label("%s %.2f" % [lic, career.sr], 16, Color.WHITE, true, 700)
	var badge_p := PanelContainer.new()
	badge_p.add_theme_stylebox_override("panel", UIKit.box(Color(CareerData.LICENCE_COLOUR[lic]), Color(0, 0, 0, 0), 0, 3, Vector2(8, 3)))
	badge_p.add_child(badge)
	chip.add_child(badge_p)
	chip.add_child(UIKit.label(I18n.t("Lv {n}", {"n": CareerData.level_of(career.xp).level}), 14, UIKit.MUTED))
	if signed_in != null:
		chip.add_child(UIKit.label(("%s · %s" % [signed_in.user.nick, signed_in.user.abbr]) if signed_in.user.get("abbr") else signed_in.user.nick, 18, UIKit.TEXT, false, 700))
		chip.add_child(UIKit.button(I18n.t("Edit driver profile"), func(): SocialUI.profile_modal(app, func(): app.show_menu())))
		chip.add_child(UIKit.button(I18n.t("Sign out"), func(): await Account.logout(); app.show_menu()))
	else:
		chip.add_child(nick)
		chip.add_child(UIKit.label(I18n.t("Offline · solo only"), 13, UIKit.MUTED))
		chip.add_child(UIKit.button(I18n.t("Sign in"), sign_in, true))

	var top := UIW.hbox(18)
	top.add_child(UIW.logo(34))
	top.add_child(tabs)
	top.add_child(UIW.spacer())
	top.add_child(chip)
	var hero := UIW.vbox(0)
	hero.add_child(UIKit.label(I18n.t("GT3 · Nürburgring · Spa · Zandvoort"), 16, UIKit.ACCENT_2, true, 700))
	hero.add_child(UIKit.label(I18n.t("Ready to race"), 64, UIKit.TEXT, true, 700))
	var root := VBoxContainer.new()
	root.add_theme_constant_override("separation", 14)
	root.add_child(top)
	root.add_child(hero)
	root.add_child(body)
	var margin := UIW.margin(root, 26)
	render.call()
	if nick.editable and nick.text == "":
		nick.grab_focus.call_deferred()
	return margin

static func _probe(app: App, error: String) -> void:
	var on: bool = await Account.probe_accounts()
	if not on and app.screen == "menu":
		app.show_menu(error)

static func _busy() -> Control:
	var c := CenterContainer.new()
	c.add_child(UIKit.label(I18n.t("Preparing…"), 24, UIKit.MUTED, true, 600))
	return c

static func _gate(title: String, text: String, sign_in: Callable) -> Control:
	var col := UIW.vbox(10)
	col.add_child(UIW.h2(title))
	col.add_child(UIW.muted(text))
	col.add_child(UIKit.button(I18n.t("Sign in / create account"), sign_in, true))
	return UIW.panel(col)

static func _online_tab(app: App, online: bool, code: LineEdit, err: Label, join_it: Callable, create: Callable, sign_in: Callable, host: Callable) -> Control:
	var col := UIW.vbox(12)
	if online:
		var p := UIW.vbox(10)
		p.add_child(UIW.h3(I18n.t("Join with a code")))
		var row := UIW.hbox(8)
		row.add_child(code)
		row.add_child(UIKit.button(I18n.t("Join"), func(): join_it.call(false), true))
		row.add_child(UIKit.button(I18n.t("Watch"), func(): join_it.call(true)))
		p.add_child(row)
		p.add_child(UIKit.button(I18n.t("Create room"), create))
		p.add_child(err)
		col.add_child(UIW.panel(p))
		col.add_child(_host_panel(host))
		col.add_child(SocialUI.room_list(app, func(c): code.text = c; join_it.call(false), func(c): join_it.call(true, c)))
	else:
		col.add_child(_gate(I18n.t("Online needs an account"), I18n.t("Sign in to create rooms, join friends and watch live sessions. Solo races work without one."), sign_in))
		col.add_child(_host_panel(host))
		var jp := UIW.vbox(8)
		jp.add_child(UIW.h3(I18n.t("Join a race hosted on a device")))
		var jr := UIW.hbox(8)
		jr.add_child(code)
		jr.add_child(UIKit.button(I18n.t("Join"), func(): join_it.call(false), true))
		jp.add_child(jr)
		col.add_child(UIW.panel(jp))
		col.add_child(err)
	return UIW.scroll(col)

## Races on the same Wi-Fi: hosted on this device, the friends join with its code and connect straight to it.
static func _host_panel(host: Callable) -> Control:
	var p := UIW.vbox(8)
	p.add_child(UIW.h3(I18n.t("Race on the same Wi-Fi")))
	p.add_child(UIW.muted(I18n.t("Host the race on this device (a phone works): your friends join with its code and connect straight to you. No account needed.")))
	p.add_child(UIKit.button(I18n.t("Host on this device"), host, true))
	return UIW.panel(p)

## A big mode tile: a photo, a kicker, a title and one line.
static func _tile(photo: String, kicker: String, title: String, sub: String, on: Callable, lock: String) -> Control:
	var b := Button.new()
	b.focus_mode = Control.FOCUS_NONE
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	b.size_flags_vertical = Control.SIZE_EXPAND_FILL
	b.custom_minimum_size = Vector2(200, 240)
	b.clip_contents = true
	for st in ["normal", "hover", "pressed", "focus", "disabled"]:
		b.add_theme_stylebox_override(st, UIKit.box(Color(0.03, 0.03, 0.04, 0.9), Color(1, 1, 1, 0.22 if st == "hover" else 0.1), 1, 4))
	var img := TextureRect.new()
	img.texture = UIW.tex("res://assets/ui/" + photo)
	img.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	img.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	img.mouse_filter = Control.MOUSE_FILTER_IGNORE
	img.modulate = Color(1, 1, 1, 0.7)
	UIKit.full(img)
	b.add_child(img)
	var shade := ColorRect.new()
	shade.color = Color(0, 0, 0, 0.35)
	shade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	UIKit.full(shade)
	b.add_child(shade)
	var col := VBoxContainer.new()
	col.mouse_filter = Control.MOUSE_FILTER_IGNORE
	col.alignment = BoxContainer.ALIGNMENT_END
	UIKit.full(col)
	col.offset_left = 16
	col.offset_right = -16
	col.offset_bottom = -14
	col.add_child(UIKit.label(kicker, 13, UIKit.ACCENT_2, true, 700))
	col.add_child(UIKit.label(title.to_upper(), 26, UIKit.TEXT, true, 700))
	var s := UIW.muted(sub, 14)
	s.mouse_filter = Control.MOUSE_FILTER_IGNORE
	col.add_child(s)
	if lock != "":
		col.add_child(UIKit.label("🔒 " + lock, 14, UIKit.ACCENT_2))
	for ch in col.get_children():
		ch.mouse_filter = Control.MOUSE_FILTER_IGNORE
	b.add_child(col)
	b.pressed.connect(on)
	return b
