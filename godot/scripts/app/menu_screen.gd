class_name MenuScreen
extends RefCounted
## The main menu (port of App.showMenu), laid out after Le Mans Ultimate's: a top bar with the sections (Play, Online,
## Friends, Career, Store), the coins, the driver chip and the gear; Play shows the modes as tall photo cards (solo, online room,
## championship, join) with their facts at the bottom; Online joins by code, hosts on this device or watches a live
## session; Friends lists them with where each one is; Store sells coins and paint (StoreScreen: a preview, no payments).

static var _tab := "play"

static func build(app: App, error: String = "") -> Control:
	var signed_in = Account.account()
	var root := Control.new()
	var err := UIKit.label(error, 16, UIKit.BAD)
	err.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	# the nickname lives in a hidden field; the driver chip edits it in a small dialog
	var nick := LineEdit.new()
	nick.text = signed_in.user.nick if signed_in != null else Settings.data.get("nickname", "")
	nick.visible = false
	root.add_child(nick)
	var nick_label := UIKit.label("", 17, UIKit.TEXT, true, 600)
	var code := LineEdit.new()
	code.max_length = 7
	code.placeholder_text = I18n.t("ROOM CODE")
	code.custom_minimum_size = Vector2(220, 52 if UIKit.touch() else 46)
	code.add_theme_font_override("font", UIKit.font(true, 600))
	code.add_theme_font_size_override("font_size", 26)
	code.text_changed.connect(func(t): code.text = t.to_upper(); code.caret_column = code.text.length())

	var online: bool = signed_in != null or Account.accounts_enabled() == false
	if not online and Account.accounts_enabled() == null:
		_probe(app, error)
	var edit_nick := func() -> void:
		var m := UIW.modal(app.overlay_layer, 460)
		var b: VBoxContainer = m.body
		UIW.modal_head(b, I18n.t("Your nickname"), func(): m.root.queue_free())
		var le := LineEdit.new()
		le.max_length = 16
		le.placeholder_text = I18n.t("Your nickname")
		le.text = nick.text
		le.custom_minimum_size = Vector2(0, 56)
		le.add_theme_font_size_override("font_size", 22)
		b.add_child(le)
		var msg := UIKit.label("", 15, UIKit.BAD)
		b.add_child(msg)
		var row := UIW.hbox(10)
		row.alignment = BoxContainer.ALIGNMENT_END
		row.add_child(UIKit.button(I18n.t("Cancel"), func(): m.root.queue_free()))
		var save := func():
			var r := Validation.sanitize_nickname(le.text)
			if not r.ok:
				msg.text = r.error
				return
			nick.text = r.nick
			Settings.data.nickname = r.nick
			Settings.save()
			nick_label.text = r.nick.to_upper()
			err.text = ""
			m.root.queue_free()
		row.add_child(UIKit.button(I18n.t("Save"), save, true))
		le.text_submitted.connect(func(_t): save.call())
		b.add_child(row)
		le.grab_focus.call_deferred()
	nick_label.text = (nick.text if nick.text != "" else I18n.t("Your nickname")).to_upper()
	var read_nick := func() -> String:
		var r := Validation.sanitize_nickname(nick.text)
		if not r.ok:
			err.text = r.error
			edit_nick.call()
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
	# (no sign-in here: the game opens on the sign-in screen. Signed out only when playing offline: back to it)
	var sign_in := func(): app.offline = false; app.show_start()

	var frame := Control.new()
	UIKit.full(frame)
	root.add_child(frame)
	# (a lambda captures by value: it reaches itself through this dictionary, else it calls an empty Callable)
	var _self := {}
	_self.render = func():
		# the error line, the code box and the nickname are shared by the tabs: detach them before the old tab is freed
		for shared in [err, code, nick_label]:
			if shared.get_parent() != null:
				shared.get_parent().remove_child(shared)
		for c in frame.get_children():
			c.queue_free()
		var body: Control
		if _tab == "online":
			body = _online_tab(app, online, code, err, join_it, create, sign_in, host)
		elif _tab == "store":
			body = StoreScreen.build(app, _self.render)
		elif _tab == "friends":
			body = SocialUI.friends_panel(app, func(c): code.text = c; join_it.call(false), func(c): join_it.call(true, c)) if signed_in != null else _gate(I18n.t("Friends"), I18n.t("You are playing offline. Friends need the game server."), sign_in)
			# a readable column in the middle, as the references' entry list
			var holder := HBoxContainer.new()
			holder.alignment = BoxContainer.ALIGNMENT_CENTER
			body.custom_minimum_size = Vector2(minf(880.0, app.get_viewport().get_visible_rect().size.x - 60.0), 0)
			body.size_flags_vertical = Control.SIZE_EXPAND_FILL if signed_in != null else Control.SIZE_SHRINK_BEGIN
			holder.add_child(body)
			body = holder
		else:
			body = _play_tab(app, online, err, solo, create, read_nick, sign_in, func(): _tab = "online"; _self.render.call())
		var on_tab := func(k: String):
			if k == "career":
				app.show_career()
				return
			_tab = k
			_self.render.call()
		var top := UIW.top_bar({
			"tabs": [["play", I18n.t("Play")], ["online", I18n.t("Online")], ["friends", I18n.t("Friends")], ["career", I18n.t("Career")], ["store", I18n.t("Store")]],
			"tab": _tab, "on_tab": on_tab, "tabs_left": UIKit.touch(),
			# the coins (the store, a preview for now) beside the driver
			"right": [StoreScreen.balance_chip(func(): _tab = "store"; _self.render.call())] + _driver_chip(app, signed_in, nick_label, edit_nick, sign_in),
		})
		var scr := UIW.screen(top, body)
		UIKit.full(scr)
		frame.add_child(scr)
		UIW.focus_first.call_deferred(body)
	_self.render.call()
	# the coins beside the driver: the server's balance (refreshed now and then)
	StoreScreen.refresh(func(): if is_instance_valid(frame) and app.screen == "menu": _self.render.call())
	UIKit.full(root)
	return root

## The driver at the top right: licence and Safety Rating, the name, rank and level (a button to the career), the
## account's actions and the gear to the settings.
static func _driver_chip(app: App, signed_in, nick_label: Label, edit_nick: Callable, sign_in: Callable) -> Array:
	var out: Array = []
	var career := CareerData.load_career()
	var lic: String = career.licence
	var lv: int = CareerData.level_of(career.xp).level
	var rk := CareerData.rank_of(lv)
	var prof := Button.new()
	prof.focus_mode = Control.FOCUS_ALL
	prof.tooltip_text = I18n.t("Career")
	for st in ["normal", "disabled"]:
		prof.add_theme_stylebox_override(st, UIKit.box(Color(0.02, 0.035, 0.08, 0.55), Color(1, 1, 1, 0.18), 1, 4))
	prof.add_theme_stylebox_override("hover", UIKit.box(Color(1, 1, 1, 0.12), Color(1, 1, 1, 0.5), 1, 4))
	prof.add_theme_stylebox_override("pressed", UIKit.box(Color(1, 1, 1, 0.22), Color.WHITE, 1, 4))
	var pr := UIW.hbox(8)
	var badge := UIW.tag("%s %.2f" % [lic, career.sr], Color(CareerData.LICENCE_COLOUR[lic]))
	pr.add_child(badge)
	var rcol := UIW.vbox(-4)
	if nick_label.get_parent() != null:
		nick_label.get_parent().remove_child(nick_label)
	if signed_in != null:
		nick_label.text = (("%s · %s" % [signed_in.user.nick, signed_in.user.abbr]) if signed_in.user.get("abbr") else str(signed_in.user.nick)).to_upper()
	rcol.add_child(nick_label)
	rcol.add_child(UIKit.label("%s · %s" % [I18n.t(rk.name).to_upper(), I18n.t("Lv {n}", {"n": lv})], 13, rk.colour, true, 600))
	pr.add_child(rcol)
	var pm := UIW.margins(pr, 8, 3, 10, 3)
	UIW.pass_mouse(pm)
	prof.add_child(pm)
	prof.custom_minimum_size = pm.get_combined_minimum_size()
	pm.resized.connect(func(): prof.custom_minimum_size = pm.get_combined_minimum_size())
	prof.pressed.connect(app.show_career)
	out.append(prof)
	if signed_in != null:
		# the profile, the password and signing out are in Settings › Account (the gear)
		pass
	else:
		# offline (or a server without accounts): the nickname is this device's
		out.append(_icon_button("✎", I18n.t("Your nickname"), edit_nick))
	out.append(_icon_button("⚙", I18n.t("Settings"), app.open_settings))
	return out

## A square icon button (the gear, the pencil).
static func _icon_button(glyph: String, tip: String, cb: Callable) -> Button:
	var b := UIKit.button(glyph, cb)
	b.tooltip_text = tip
	b.add_theme_font_override("font", UIKit.font(false, 500))
	b.add_theme_font_size_override("font_size", 20)
	var s := 46.0 if UIKit.touch() else 38.0
	b.custom_minimum_size = Vector2(s, s)
	for st in ["normal", "hover", "pressed", "hover_pressed", "disabled"]:
		var base: StyleBoxFlat = b.get_theme_stylebox(st).duplicate()
		base.content_margin_left = 4
		base.content_margin_right = 4
		base.content_margin_top = 2
		base.content_margin_bottom = 2
		b.add_theme_stylebox_override(st, base)
	return b

static func _probe(app: App, error: String) -> void:
	var on: bool = await Account.probe_accounts()
	if not on and app.screen == "menu":
		app.show_menu(error)

static func _busy() -> Control:
	var c := CenterContainer.new()
	var col := UIW.vbox(10)
	col.add_child(UIW.logo(40))
	var l := UIKit.label(I18n.t("Preparing…").to_upper(), 22, UIKit.SOFT, true, 600)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(l)
	c.add_child(col)
	return c

static func _gate(title: String, text: String, sign_in: Callable) -> Control:
	var col := UIW.vbox(12)
	col.add_child(UIW.h2(title))
	col.add_child(UIW.muted(text))
	var b := UIKit.button(I18n.t("Connect again"), sign_in, true)
	b.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	col.add_child(UIW.default_focus(b))
	var p := UIW.panel(col)
	p.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	return p

# ------------------------------------------------------------------- play ---

static func _play_tab(app: App, online: bool, err: Label, solo: Callable, create: Callable, read_nick: Callable, sign_in: Callable, to_online: Callable) -> Control:
	var col := UIW.vbox(14 if UIKit.touch() else 18)
	# the big headline is for a big screen: a phone gives the room to the mode cards
	if not UIKit.touch():
		var hero := UIW.vbox(-6)
		hero.add_child(UIKit.label(I18n.t("GT3 · Nürburgring · Spa · Zandvoort").to_upper(), 17, UIKit.SOFT, true, 600))
		hero.add_child(UIKit.label(I18n.t("Ready to race").to_upper(), 62, UIKit.TEXT, true, 700))
		col.add_child(hero)
	var circuits := {}
	for t in app.track_index:
		circuits[LobbyScreen.circuit_of(t)] = true
	var champ = Championship.load_saved()
	var cards := UIW.hbox(14 if UIKit.touch() else 18)
	cards.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var lock := "" if online else I18n.t("Offline: connect again to play online")
	var solo_card := _card("photo_hero_spa.webp", [[I18n.t("OFFLINE"), UIKit.SOFT]], I18n.t("Play solo"), I18n.t("Race the AI on any circuit. No account, no server."),
		[[I18n.t("Circuits"), str(circuits.size())], [I18n.t("Cars"), str(CarsDb.selectable().size())]], solo, "")
	cards.add_child(UIW.default_focus(solo_card))
	cards.add_child(_card("photo_grid.webp", [[I18n.t("ONLINE"), UIKit.CRIMSON]], I18n.t("Create room"), I18n.t("Your own lobby: invite friends with the room code, add AI cars."),
		[[I18n.t("Drivers"), str(Const.MAX_PLAYERS)], [I18n.t("AI cars"), "✓"]], create if online else sign_in, lock))
	var champ_stats: Array = [[I18n.t("Round"), "%d/%d" % [champ.done + 1, champ.rounds.size()]], [I18n.t("Points"), "25 · 18 · 15"]] if champ != null else [[I18n.t("Rounds"), str(circuits.size())], [I18n.t("Points"), "25 · 18 · 15"]]
	cards.add_child(_card("photo_aerial_spa.webp", [[I18n.t("OFFLINE"), UIKit.SOFT], [I18n.t("Season"), UIKit.ACCENT_2]],
		I18n.t("Championship · round {n}/{m}", {"n": champ.done + 1, "m": champ.rounds.size()}) if champ != null else I18n.t("Championship"),
		I18n.t("A season against the AI on every circuit, points as in F1."), champ_stats, func(): ChampionshipUI.open(app, read_nick), ""))
	cards.add_child(_card("photo_pole_zandvoort.webp", [[I18n.t("ONLINE"), UIKit.CRIMSON]], I18n.t("Join friends"), I18n.t("A room code from a friend, or a live public session."),
		[[I18n.t("Room code"), "5"], [I18n.t("Watch"), I18n.t("Live")]], to_online if online else sign_in, lock))
	col.add_child(cards)
	col.add_child(err)
	return col

## A tall mode card: the photo with a navy fade, tags, a big title, one line, its facts at the bottom and the hatched
## corner. `lock` set: dimmed, LOCKED and why (pressing it goes back to the sign-in screen).
static func _card(photo: String, tags: Array, title: String, sub: String, stats: Array, on: Callable, lock: String) -> Button:
	var touch := UIKit.touch()
	var b := UIW.card_button()
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	b.size_flags_vertical = Control.SIZE_EXPAND_FILL
	b.custom_minimum_size = Vector2(180, 250 if touch else 300)
	b.get_node("clip").add_child(UIW.photo_fill("res://assets/ui/" + photo, 0.45 if lock != "" else 0.95, 0.95))
	var col := UIW.vbox(6)
	var tr := UIW.hbox(6)
	for t in tags:
		tr.add_child(UIW.tag(t[0], t[1], true, UIKit.INK if t[1] == UIKit.SOFT or t[1] == UIKit.ACCENT_2 else Color.WHITE))
	col.add_child(tr)
	var tl := UIKit.label(title.to_upper(), 34 if touch else 40, UIKit.TEXT, true, 700)
	tl.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	tl.add_theme_constant_override("line_spacing", -8)
	col.add_child(tl)
	if lock != "":
		col.add_child(UIKit.label(I18n.t("Locked").to_upper(), 30 if touch else 36, Color(1, 1, 1, 0.9), true, 700))
		col.add_child(UIKit.label(lock, 16, UIKit.ACCENT_2, false, 600))
	col.add_child(UIW.spacer())
	var s := UIW.muted(sub, 15 if touch else 16)
	col.add_child(s)
	if lock == "" and not stats.is_empty():
		var g := GridContainer.new()
		g.columns = 2
		g.add_theme_constant_override("h_separation", 26)
		for st in stats:
			g.add_child(UIW.stat(st[0], st[1], 28 if touch else 32))
		col.add_child(g)
	var content: MarginContainer = b.get_node("content")
	for side in ["left", "right"]:
		content.add_theme_constant_override("margin_" + side, 16 if touch else 20)
	content.add_theme_constant_override("margin_top", 16)
	content.add_theme_constant_override("margin_bottom", 16)
	content.add_child(col)
	var hatch := UIW.Hatch.new(Color(1, 1, 1, 0.55) if lock == "" else Color(1, 1, 1, 0.25), Vector2(44, 44))
	hatch.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	hatch.offset_left = -50
	hatch.offset_top = -50
	hatch.offset_right = -6
	hatch.offset_bottom = -6
	b.add_child(hatch)
	UIW.pass_mouse(content)
	b.pressed.connect(on)
	# it answers the pointer: a little lift on hover, a dip when pressed (a PC menu: the cards felt dead)
	b.resized.connect(func(): b.pivot_offset = b.size * 0.5)
	var to := func(k: float, t: float) -> void:
		var tw := b.create_tween()
		tw.tween_property(b, "scale", Vector2(k, k), t).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	b.mouse_entered.connect(func(): to.call(1.025, 0.12))
	b.mouse_exited.connect(func(): to.call(1.0, 0.15))
	b.focus_entered.connect(func(): to.call(1.025, 0.12))
	b.focus_exited.connect(func(): to.call(1.0, 0.15))
	b.button_down.connect(func(): to.call(0.99, 0.06))
	b.button_up.connect(func(): to.call(1.025 if b.is_hovered() else 1.0, 0.1))
	return b

# ----------------------------------------------------------------- online ---

static func _online_tab(app: App, online: bool, code: LineEdit, err: Label, join_it: Callable, create: Callable, sign_in: Callable, host: Callable) -> Control:
	var row := UIW.hbox(18)
	var left := UIW.vbox(14)
	left.custom_minimum_size = Vector2(380 if UIKit.touch() else 440, 0)
	var join_p := UIW.vbox(10)
	if online:
		join_p.add_child(UIW.section(I18n.t("Join with a code")))
		var r := UIW.hbox(8)
		code.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		r.add_child(code)
		r.add_child(UIW.default_focus(UIKit.button(I18n.t("Join"), func(): join_it.call(false), true)))
		r.add_child(UIKit.button(I18n.t("Watch"), func(): join_it.call(true)))
		join_p.add_child(r)
		join_p.add_child(err)
		var cr := UIKit.button(I18n.t("Create room"), create)
		cr.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		join_p.add_child(cr)
		left.add_child(UIW.panel(join_p))
		left.add_child(_host_panel(host))
	else:
		left.add_child(_gate(I18n.t("You are offline"), I18n.t("Rooms, friends and live sessions need the game server. Solo races and the championship work offline."), sign_in))
		join_p.add_child(UIW.section(I18n.t("Join a race hosted on a device")))
		var jr := UIW.hbox(8)
		code.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		jr.add_child(code)
		jr.add_child(UIKit.button(I18n.t("Join"), func(): join_it.call(false), true))
		join_p.add_child(jr)
		join_p.add_child(err)
		left.add_child(UIW.panel(join_p))
		left.add_child(_host_panel(host))
	row.add_child(UIW.scroll(left) if UIKit.touch() else left)
	if online:
		var rl := SocialUI.room_list(app, func(c): code.text = c; join_it.call(false), func(c): join_it.call(true, c))
		rl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		rl.size_flags_vertical = Control.SIZE_EXPAND_FILL
		row.add_child(rl)
	else:
		var pic := UIW.panel(null)
		pic.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		pic.size_flags_vertical = Control.SIZE_EXPAND_FILL
		pic.clip_children = CanvasItem.CLIP_CHILDREN_AND_DRAW
		pic.add_child(UIW.photo_fill("res://assets/ui/photo_grid_spa.webp", 0.8, 0.7))
		row.add_child(pic)
	return row

## Races on the same Wi-Fi: hosted on this device, the friends join with its code and connect straight to it.
static func _host_panel(host: Callable) -> Control:
	var p := UIW.vbox(10)
	p.add_child(UIW.section(I18n.t("Race on the same Wi-Fi")))
	p.add_child(UIW.muted(I18n.t("Host the race on this device (a phone works): your friends join with its code and connect straight to you. No account needed.")))
	var b := UIKit.button(I18n.t("Host on this device"), host)
	b.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	p.add_child(b)
	return UIW.panel(p)
