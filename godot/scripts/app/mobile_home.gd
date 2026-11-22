class_name MobileHome
extends RefCounted
## The mobile layout's home (the user, 2026-11-20: a phone UI after RESOURCES/UI-MOBILE-REFERENCE): the garage. Your car
## turns in the middle; the left column carries the season pass, the featured event and the special offer; the top
## right your currencies and the icons (contracts, friends, news, settings); the right side the free bonus (a rewarded
## ad placeholder), the daily-wins chests and the championship; the bottom bar Shop, Cars, Paint, Contracts and RACE
## (MobileModes). On a touch screen unless Display › Menu layout says otherwise (App.mobile_layout()).

static func build(app: App) -> Control:
	var root := Control.new()
	UIKit.full(root)
	var p := Progression.data()
	var rerender := func() -> void: if app.screen == "menu": app.show_menu()

	# the car, large, in its studio light over the dimmed photo
	var shade := ColorRect.new()
	shade.color = Color(0.0, 0.01, 0.03, 0.55)
	shade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	UIKit.full(shade)
	root.add_child(shade)
	var car := my_car()
	if not car.is_empty():
		var pv := CarStudio.Preview.new(car, CarStudio.my_livery())
		pv.anchor_left = 0.2
		pv.anchor_right = 0.84
		pv.anchor_top = 0.1
		pv.anchor_bottom = 0.86
		root.add_child(pv)

	# top left: the driver
	root.add_child(_place(_driver(app), Control.PRESET_TOP_LEFT, Vector2(16, 12)))
	# top right: icons and currencies
	var tr := UIW.hbox(8)
	tr.add_child(MobileUI.icon_button("list", I18n.t("Contracts"), func() -> void: contracts(app, rerender), Progression.contracts_ready() > 0))
	tr.add_child(MobileUI.icon_button("people", I18n.t("Friends"), func() -> void: app.show_classic_menu("friends")))
	# (as the classic menu: a change applies at once to the audio, the graphics and a session)
	tr.add_child(MobileUI.icon_button("gear", I18n.t("Settings"), func() -> void: app.open_settings()))
	tr.add_child(MobileUI.currency("credit", Progression.credits(), func() -> void: open_store(app, "coins")))
	tr.add_child(MobileUI.currency("coin", StoreScreen.coins(), func() -> void: open_store(app, "coins")))
	root.add_child(_place(tr, Control.PRESET_TOP_RIGHT, Vector2(-16, 12)))

	# left column: pass, featured event, offer
	var left := UIW.vbox(8)
	left.custom_minimum_size = Vector2(290, 0)
	left.add_child(_section(I18n.t("Season pass")))
	left.add_child(_pass_card(app))
	left.add_child(_section(I18n.t("Featured event")))
	left.add_child(_event_card(app))
	left.add_child(_section(I18n.t("Special offer")))
	left.add_child(_offer_card(app))
	root.add_child(_place(left, Control.PRESET_TOP_LEFT, Vector2(16, 76)))

	# right column: free bonus, chests, championship, daily wins
	var right := UIW.vbox(10)
	right.alignment = BoxContainer.ALIGNMENT_END
	var tiles := UIW.hbox(8)
	tiles.alignment = BoxContainer.ALIGNMENT_END
	var left_s := Progression.free_bonus_left_s()
	tiles.add_child(_tile("tv", I18n.t("Free"), Progression.fmt_left(left_s) if left_s > 0 else I18n.t("Watch"), left_s <= 0, func() -> void: free_bonus(app, rerender)))
	tiles.add_child(_tile("chest", I18n.t("Chests"), "×%d" % int(p.chests), int(p.chests) > 0, func() -> void:
		var r := Progression.open_chest()
		if r.is_empty():
			app.toast(I18n.t("Win races to fill the daily chests."))
			return
		MobileUI.reward_popup(app, I18n.t("Chest opened"), [I18n.t("{n} credits", {"n": StoreScreen.fmt(r[0])}), I18n.t("{n} pass XP", {"n": r[1]})])
		rerender.call()))
	right.add_child(tiles)
	var champ := Button.new()
	champ.text = I18n.t("Championship").to_upper()
	champ.add_theme_font_override("font", UIKit.font(true, 700, true))
	champ.add_theme_font_size_override("font_size", 22)
	for st: String in ["normal", "hover", "pressed"]:
		var sb := UIKit.box(MobileUI.PURPLE.darkened(0.15 if st == "normal" else 0.0), Color(1, 1, 1, 0.3), 1, 4, Vector2(18, 8))
		sb.skew = Vector2(0.22, 0)
		champ.add_theme_stylebox_override(st, sb)
	champ.pressed.connect(func() -> void: ChampionshipUI.open(app, func() -> String: return nick()))
	right.add_child(champ)
	var wins := UIW.vbox(4)
	var wl := UIW.hbox(8)
	var wt := UIKit.label(I18n.t("Daily wins").to_upper(), 14, UIKit.SOFT, true, 600)
	wt.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	wl.add_child(wt)
	wl.add_child(UIKit.label("%d/%d" % [int(p.wins), Progression.DAILY_WINS], 14, UIKit.TEXT, true, 700))
	wins.add_child(wl)
	var slots := UIW.hbox(4)
	for i in Progression.DAILY_WINS:
		var sp := PanelContainer.new()
		sp.add_theme_stylebox_override("panel", UIKit.box(Color(0, 0, 0, 0.55), MobileUI.GOLD if i < int(p.wins) else Color(1, 1, 1, 0.15), 1, 4, Vector2(4, 4)))
		sp.add_child(MobileUI.Icon.make("chest", 24, MobileUI.GOLD if i < int(p.wins) else Color(1, 1, 1, 0.25)))
		slots.add_child(sp)
	wins.add_child(slots)
	var wp := PanelContainer.new()
	wp.add_theme_stylebox_override("panel", UIKit.box(MobileUI.GLASS, Color(1, 1, 1, 0.12), 1, 6, Vector2(10, 8)))
	wp.add_child(wins)
	right.add_child(wp)
	root.add_child(_place(right, Control.PRESET_BOTTOM_RIGHT, Vector2(-16, -96)))

	# the car's name and the arrows to change it
	if not car.is_empty():
		var cn := UIW.hbox(14)
		cn.alignment = BoxContainer.ALIGNMENT_CENTER
		var prev := MobileUI.icon_button("back", I18n.t("Previous car"), func() -> void: _cycle_car(-1); rerender.call())
		cn.add_child(prev)
		var cc := UIW.vbox(2)
		var nm := UIKit.label(str(car.name).to_upper(), 24, UIKit.TEXT, true, 700)
		nm.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		cc.add_child(nm)
		var tags := UIW.hbox(6)
		tags.alignment = BoxContainer.ALIGNMENT_CENTER
		tags.add_child(UIW.tag("GT3", MobileUI.PURPLE))
		var kw := float(car.get("specs", {}).get("powerKw", 0.0))
		if kw > 0.0:
			tags.add_child(UIW.tag("%d hp" % LobbyScreen.hp(kw), Color(0, 0, 0, 0.6)))
		cc.add_child(tags)
		cn.add_child(cc)
		var nxt := MobileUI.icon_button("play", I18n.t("Next car"), func() -> void: _cycle_car(1); rerender.call())
		cn.add_child(nxt)
		var holder := CenterContainer.new()
		holder.anchor_left = 0.25
		holder.anchor_right = 0.75
		holder.anchor_top = 1.0
		holder.anchor_bottom = 1.0
		holder.offset_top = -150
		holder.offset_bottom = -84
		root.add_child(holder)
		holder.add_child(cn)

	# the bottom bar
	root.add_child(_bottom_bar(app, rerender))
	return root

## The bar along the bottom: Shop, Cars, Paint, Contracts and RACE.
static func _bottom_bar(app: App, rerender: Callable) -> Control:
	var bar := PanelContainer.new()
	bar.add_theme_stylebox_override("panel", UIKit.box(Color(0, 0, 0, 0.82), Color(1, 1, 1, 0.08), 1, 0, Vector2(18, 6)))
	bar.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	bar.offset_top = -76
	var row := UIW.hbox(6)
	for it: Array in [["cart", I18n.t("Shop"), func() -> void: open_store(app, "items"), false],
			["car", I18n.t("Cars"), func() -> void: cars(app, rerender), false],
			["brush", I18n.t("Paint"), func() -> void: paint(app), false],
			["list", I18n.t("Contracts"), func() -> void: contracts(app, rerender), Progression.contracts_ready() > 0]]:
		var b := Button.new()
		b.focus_mode = Control.FOCUS_ALL
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.custom_minimum_size = Vector2(0, 60)
		for st: String in ["normal", "hover", "pressed"]:
			b.add_theme_stylebox_override(st, UIKit.box(Color(1, 1, 1, 0.0 if st == "normal" else 0.1), Color(0, 0, 0, 0), 0, 4))
		var c := UIW.hbox(8)
		c.alignment = BoxContainer.ALIGNMENT_CENTER
		c.mouse_filter = Control.MOUSE_FILTER_IGNORE
		UIKit.full(c)
		c.add_child(MobileUI.Icon.make(it[0], 26, MobileUI.GOLD if it[0] == "cart" else UIKit.TEXT))
		c.add_child(UIKit.label(String(it[1]).to_upper(), 21, MobileUI.GOLD if it[0] == "cart" else UIKit.TEXT, true, 600))
		if it[3]:
			c.add_child(MobileUI.Icon.make("dot", 10, UIKit.BAD))
		b.add_child(c)
		b.pressed.connect(it[2])
		row.add_child(b)
		row.add_child(UIW.hair(true, Color(1, 1, 1, 0.12)))
	var race := MobileUI.race_button(I18n.t("Race"), func() -> void: MobileModes.show(app))
	race.custom_minimum_size = Vector2(260, 60)
	row.add_child(UIW.default_focus(race))
	bar.add_child(row)
	return bar

static func _place(c: Control, preset: int, offset: Vector2) -> Control:
	var holder := Control.new()
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.set_anchors_preset(preset)
	holder.add_child(c)
	var put := func() -> void:
		var s2 := c.get_combined_minimum_size().max(c.size)
		if preset == Control.PRESET_TOP_RIGHT:
			c.position = Vector2(offset.x - s2.x, offset.y)
		elif preset == Control.PRESET_BOTTOM_RIGHT:
			c.position = Vector2(offset.x - s2.x, offset.y - s2.y)
		else:
			c.position = offset
	put.call()
	c.resized.connect(put)
	return holder

static func _section(t: String) -> Label:
	return UIKit.label(t.to_upper(), 14, UIKit.SOFT, true, 600)

static func _driver(app: App) -> Control:
	var career := CareerData.load_career()
	var lv: Dictionary = CareerData.level_of(career.xp)
	var on := StoreScreen.online_licence()
	var lic: String = on.licence if not on.is_empty() else career.licence
	var b := Button.new()
	b.focus_mode = Control.FOCUS_ALL
	for st: String in ["normal", "hover", "pressed"]:
		b.add_theme_stylebox_override(st, UIKit.box(Color(0, 0, 0, 0.6 if st == "normal" else 0.8), Color(1, 1, 1, 0.15), 1, 6, Vector2(8, 6)))
	var row := UIW.hbox(10)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var av := PanelContainer.new()
	av.add_theme_stylebox_override("panel", UIKit.box(Color(CareerData.LICENCE_COLOUR[lic]), Color.WHITE, 2, 20, Vector2(10, 2)))
	av.mouse_filter = Control.MOUSE_FILTER_IGNORE
	av.add_child(UIKit.label(lic, 22, Color.WHITE, true, 800))
	row.add_child(av)
	var col := UIW.vbox(2)
	col.mouse_filter = Control.MOUSE_FILTER_IGNORE
	col.add_child(UIKit.label(nick().to_upper(), 18, UIKit.TEXT, true, 700))
	var l2 := UIW.hbox(6)
	l2.mouse_filter = Control.MOUSE_FILTER_IGNORE
	l2.add_child(UIKit.label(I18n.t("LV. {n}", {"n": lv.level}), 14, MobileUI.TEAL, true, 700))
	var bar := MobileUI.bar(lv.into / float(lv.need), MobileUI.TEAL, 4)
	bar.custom_minimum_size = Vector2(110, 4)
	bar.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	l2.add_child(bar)
	col.add_child(l2)
	row.add_child(col)
	b.add_child(row)
	b.custom_minimum_size = row.get_combined_minimum_size() + Vector2(16, 12)
	row.position = Vector2(8, 6)
	b.pressed.connect(func() -> void: app.show_career())
	return b

static func _pass_card(app: App) -> Control:
	var b := MobileUI.card("", "res://assets/ui/photo_straight_spa.webp", 0.9)
	b.custom_minimum_size = Vector2(290, 112)
	var body := MobileUI.card_body(b)
	var col := UIW.vbox(4)
	col.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var top := UIW.hbox(6)
	top.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sp := Control.new()
	sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(sp)
	top.add_child(MobileUI.badge(Progression.fmt_left(Progression.pass_season_left_s()), Color(0, 0, 0, 0.75), UIKit.TEXT, "clock"))
	col.add_child(top)
	var fill := Control.new()
	fill.size_flags_vertical = Control.SIZE_EXPAND_FILL
	fill.mouse_filter = Control.MOUSE_FILTER_IGNORE
	col.add_child(fill)
	var l := UIW.hbox(6)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	l.add_child(MobileUI.Icon.make("star", 18, MobileUI.GOLD))
	var xp := UIKit.label("%d/%d" % [Progression.pass_into(), Progression.PASS_TIER_XP], 16, UIKit.TEXT, true, 700)
	xp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	l.add_child(xp)
	var unclaimed := Progression.pass_unclaimed()
	if unclaimed > 0:
		l.add_child(MobileUI.badge(I18n.t("{n} to claim", {"n": unclaimed}), UIKit.BAD))
	l.add_child(UIKit.label(I18n.t("Tier {n}", {"n": Progression.pass_tier()}).to_upper(), 18, UIKit.TEXT, true, 700))
	col.add_child(l)
	col.add_child(MobileUI.bar(Progression.pass_into() / float(Progression.PASS_TIER_XP)))
	body.add_child(col)
	b.pressed.connect(func() -> void: MobilePass.show(app))
	return b

## The week's featured event: a cup race on the week's circuit, double credits (MobileModes.weekly()).
static func _event_card(app: App) -> Control:
	var w := MobileModes.weekly(app)
	var b := MobileUI.card("", MobileUI.photo(MobileUI.map_of(app, w.track), "pole"), 0.9)
	b.custom_minimum_size = Vector2(290, 100)
	var body := MobileUI.card_body(b)
	var col := UIW.vbox(2)
	col.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var top := UIW.hbox(6)
	top.mouse_filter = Control.MOUSE_FILTER_IGNORE
	top.add_child(MobileUI.badge(I18n.t("×2 credits"), MobileUI.GOLD, UIKit.INK))
	var sp := Control.new()
	sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(sp)
	top.add_child(MobileUI.badge(Progression.fmt_left(w.left_s), Color(0, 0, 0, 0.75), UIKit.TEXT, "clock"))
	col.add_child(top)
	var fill := Control.new()
	fill.size_flags_vertical = Control.SIZE_EXPAND_FILL
	fill.mouse_filter = Control.MOUSE_FILTER_IGNORE
	col.add_child(fill)
	col.add_child(UIKit.label(str(w.name).to_upper(), 20, UIKit.TEXT, true, 700))
	body.add_child(col)
	b.pressed.connect(func() -> void: MobileModes.show(app, "events"))
	return b

static func _offer_card(app: App) -> Control:
	var b := MobileUI.card("", "res://assets/ui/photo_grid.webp", 0.85)
	b.custom_minimum_size = Vector2(290, 80)
	var body := MobileUI.card_body(b)
	var row := UIW.hbox(8)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var col := UIW.vbox(0)
	col.mouse_filter = Control.MOUSE_FILTER_IGNORE
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	col.add_child(UIKit.label(I18n.t("Welcome pack").to_upper(), 20, UIKit.TEXT, true, 700))
	col.add_child(UIKit.label(I18n.t("{n} coins", {"n": StoreScreen.fmt(int(StoreScreen.WELCOME.coins))}), 15, UIKit.SOFT))
	row.add_child(col)
	row.add_child(MobileUI.badge("-35%", UIKit.BAD))
	body.add_child(row)
	b.pressed.connect(func() -> void: open_store(app, "offers"))
	return b

static func _tile(icon: String, title: String, sub: String, hot: bool, cb: Callable) -> Button:
	var b := Button.new()
	b.focus_mode = Control.FOCUS_ALL
	b.custom_minimum_size = Vector2(86, 86)
	for st: String in ["normal", "hover", "pressed"]:
		b.add_theme_stylebox_override(st, UIKit.box(Color(0, 0, 0, 0.6 if st == "normal" else 0.8), MobileUI.GOLD if hot else Color(1, 1, 1, 0.15), 2 if hot else 1, 6))
	var col := UIW.vbox(0)
	col.alignment = BoxContainer.ALIGNMENT_CENTER
	col.mouse_filter = Control.MOUSE_FILTER_IGNORE
	UIKit.full(col)
	var ic := CenterContainer.new()
	ic.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ic.add_child(MobileUI.Icon.make(icon, 34, MobileUI.GOLD if hot else UIKit.TEXT))
	col.add_child(ic)
	for t: Array in [[title.to_upper(), 14, UIKit.TEXT], [sub, 13, MobileUI.GOLD if hot else UIKit.SOFT]]:
		var l := UIKit.label(t[0], t[1], t[2], true, 600)
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		col.add_child(l)
	b.add_child(col)
	b.pressed.connect(cb)
	return b

# ----------------------------------------------------------------- shared ---

static func nick() -> String:
	var a: Variant = Account.account()
	if a != null:
		return str(a.user.nick)
	var n := str(Settings.data.get("nickname", ""))
	return n if n != "" else I18n.t("Driver")

static func my_car() -> Dictionary:
	var cars := CarsDb.selectable()
	if cars.is_empty():
		return {}
	var last := str(Settings.data.get("lastCar", ""))
	for c: Dictionary in cars:
		if c.id == last:
			return c
	return cars[0]

static func _cycle_car(step: int) -> void:
	var cars := CarsDb.selectable()
	if cars.is_empty():
		return
	var i := 0
	for k in cars.size():
		if cars[k].id == my_car().id:
			i = k
	Settings.data.lastCar = cars[posmod(i + step, cars.size())].id
	Settings.save()

## The free bonus: a rewarded ad placeholder, then credits and pass XP (every few hours).
static func free_bonus(app: App, rerender: Callable) -> void:
	var left := Progression.free_bonus_left_s()
	if left > 0:
		app.toast(I18n.t("The next free bonus in {t}.", {"t": Progression.fmt_left(left)}))
		return
	var m := UIW.modal(app.overlay_layer, 520)
	var b: VBoxContainer = m.body
	UIW.modal_head(b, I18n.t("Free bonus"), func() -> void: m.root.queue_free())
	b.add_child(UIKit.label(I18n.t("Watch a video to claim all the rewards."), 17, UIKit.SOFT))
	var row := UIW.hbox(10)
	for r: Array in [["credit", "5,000"], ["star", I18n.t("150 XP")]]:
		var t := PanelContainer.new()
		t.add_theme_stylebox_override("panel", UIKit.box(Color(0, 0, 0, 0.5), Color(1, 1, 1, 0.15), 1, 6, Vector2(14, 10)))
		var c := UIW.vbox(4)
		var ic := CenterContainer.new()
		ic.add_child(MobileUI.Icon.make(r[0], 34, MobileUI.GOLD))
		c.add_child(ic)
		c.add_child(UIKit.label(r[1], 18, UIKit.TEXT, true, 700))
		t.add_child(c)
		row.add_child(t)
	b.add_child(row)
	var go := UIKit.button(I18n.t("Get free"), func() -> void:
		m.root.queue_free()
		MobileAds.rewarded(app, I18n.t("5,000 credits and 150 pass XP"), func(ok: bool) -> void:
			if not ok:
				return
			var r := Progression.claim_free_bonus()
			if not r.is_empty():
				MobileUI.reward_popup(app, I18n.t("Free bonus"), [I18n.t("{n} credits", {"n": StoreScreen.fmt(r[0])}), I18n.t("{n} pass XP", {"n": r[1]})])
			rerender.call()), true)
	go.size_flags_horizontal = Control.SIZE_SHRINK_END
	b.add_child(go)
	go.grab_focus.call_deferred()

## The day's three contracts, each claimable when done.
static func contracts(app: App, rerender: Callable) -> void:
	var m := UIW.modal(app.overlay_layer, 620)
	var b: VBoxContainer = m.body
	UIW.modal_head(b, I18n.t("Contracts"), func() -> void: m.root.queue_free(), I18n.t("Today"))
	var list: Array = Progression.data().contracts
	for i in list.size():
		var c: Dictionary = list[i]
		var rw := Progression.contract_reward(c)
		var row := UIW.hbox(12)
		var col := UIW.vbox(4)
		col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		col.add_child(UIKit.label(Progression.contract_text(c), 19, UIKit.TEXT, true, 600))
		var pr := UIW.hbox(8)
		var bar := MobileUI.bar(float(c.progress) / maxf(1.0, float(c.target)), MobileUI.TEAL)
		bar.custom_minimum_size = Vector2(220, 6)
		bar.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		pr.add_child(bar)
		pr.add_child(UIKit.label("%d/%d" % [int(c.progress), int(c.target)], 15, UIKit.SOFT, true, 600))
		pr.add_child(UIKit.label(I18n.t("{c} credits · {x} XP", {"c": StoreScreen.fmt(rw[0]), "x": rw[1]}), 15, MobileUI.GOLD, true, 600))
		col.add_child(pr)
		row.add_child(col)
		if c.claimed:
			row.add_child(UIKit.label(I18n.t("Claimed"), 17, UIKit.GOOD, true, 700))
		else:
			var idx := i
			var claim := UIKit.button(I18n.t("Claim"), func() -> void:
				var r := Progression.claim_contract(idx)
				if not r.is_empty():
					m.root.queue_free()
					MobileUI.reward_popup(app, I18n.t("Contract complete"), [I18n.t("{n} credits", {"n": StoreScreen.fmt(r[0])}), I18n.t("{n} pass XP", {"n": r[1]})])
					rerender.call(), true)
			claim.disabled = int(c.progress) < int(c.target)
			row.add_child(claim)
		b.add_child(UIW.row_line(row))
	b.add_child(UIW.muted(I18n.t("New contracts every day. Offline races count."), 14))

## The car list: pick the car the home shows and the lobby picks first.
static func cars(app: App, rerender: Callable) -> void:
	var m := UIW.modal(app.overlay_layer, 980, true)
	var b: VBoxContainer = m.body
	UIW.modal_head(b, I18n.t("Cars"), func() -> void: m.root.queue_free())
	var grid := GridContainer.new()
	grid.columns = 4
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	var mine := my_car()
	for c: Dictionary in CarsDb.selectable():
		var card := UIW.card_button(c.id == mine.get("id"), 6)
		card.custom_minimum_size = Vector2(220, 150)
		var col := UIW.vbox(2)
		col.mouse_filter = Control.MOUSE_FILTER_IGNORE
		col.add_child(CarStudio.picture_rect(c, CarStudio.my_livery(), Vector2(0, 100)))
		col.add_child(UIKit.label(str(c.name).to_upper(), 16, UIKit.TEXT, true, 600))
		card.get_node("content").add_child(UIW.margins(col, 8, 4, 8, 4))
		var id: String = c.id
		card.pressed.connect(func() -> void:
			Settings.data.lastCar = id
			Settings.save()
			m.root.queue_free()
			rerender.call())
		grid.add_child(card)
	b.add_child(UIW.scroll(grid))

## Paint: the lobby's Paint page (the livery editor) in a solo room.
static func paint(app: App) -> void:
	app.set_ui(Control.new())
	var err := await app.join(LocalRoom.create(), nick())
	if err != "":
		app.show_menu(err)
		return
	LobbyScreen._page = "paint"
	app.render_lobby()

## The store on its own screen (the classic menu's Store tab), back to the home.
static func open_store(app: App, tab: String) -> void:
	StoreScreen._tab = tab
	app.screen = "m_store"
	app.back_to = func() -> void: app.show_menu()
	var holder := Control.new()
	UIKit.full(holder)
	var _self := {}
	_self.render = func() -> void:
		for c in holder.get_children():
			c.queue_free()
		var top := UIW.top_bar({"title": I18n.t("Store"), "back": func() -> void: app.show_menu(),
			"right": [MobileUI.currency("credit", Progression.credits(), func() -> void: pass), MobileUI.currency("coin", StoreScreen.coins(), func() -> void: pass)]})
		var scr := UIW.screen(top, StoreScreen.build(app, _self.render))
		UIKit.full(scr)
		holder.add_child(scr)
	_self.render.call()
	app.set_ui(holder)

## After an offline session (App.show_results, the mobile layout): what it gave, over the results, as the references'
## TOTAL REWARDS panel: a cup race's trophies and credits, the pass XP, the contracts advanced, a daily-wins chest.
## The credits can be doubled by watching a rewarded ad placeholder; closing it may show an interstitial (every few
## races); after a win, once, the rate-us prompt.
static func race_rewards(app: App, prog: Dictionary, ev: Dictionary, gain: Variant) -> void:
	var lines: Array = []
	var credits := int(ev.get("credits", 0))
	if not ev.is_empty():
		var what := I18n.t("Featured event") if ev.get("weekly", false) else I18n.t(Progression.cup(ev.cup)[2])
		lines.append([what, I18n.t("{n} trophies", {"n": int(ev.trophies)}) + (I18n.t(" (+{g} new)", {"g": int(ev.gained)}) if int(ev.gained) > 0 and not ev.get("weekly", false) else "")])
	if gain != null and int(gain.get("coins", 0)) > 0:
		credits += int(gain.coins)
	if credits > 0:
		lines.append([I18n.t("Credits"), StoreScreen.fmt(credits)])
	lines.append([I18n.t("Pass XP"), "+%d" % int(prog.get("passXp", 0))])
	for i: int in prog.get("contracts", []):
		var c: Dictionary = Progression.data().contracts[i]
		lines.append([Progression.contract_text(c), "%d/%d" % [int(c.progress), int(c.target)]])
	if prog.get("chest", false):
		lines.append([I18n.t("Daily wins chest"), "+1"])
	var m := UIW.modal(app.overlay_layer, 560)
	var b: VBoxContainer = m.body
	var close_all := func(doubled: bool) -> void:
		m.root.queue_free()
		var won: bool = not ev.is_empty() and int(ev.trophies) == 3
		if won and Progression.rate_prompt_due():
			_rate(app)
		elif not doubled:
			MobileAds.interstitial(app, func() -> void: pass)
	UIW.modal_head(b, I18n.t("Total rewards"), func() -> void: close_all.call(false))
	if not ev.is_empty():
		var tr := CenterContainer.new()
		tr.add_child(MobileUI.trophies(int(ev.trophies), 3, 44))
		b.add_child(tr)
	for l: Array in lines:
		var row := UIW.hbox(10)
		var t := UIKit.label(l[0], 17, UIKit.SOFT)
		t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(t)
		row.add_child(UIKit.label(l[1], 19, UIKit.TEXT, true, 700))
		b.add_child(UIW.row_line(row))
	var acts := UIW.hbox(10)
	acts.alignment = BoxContainer.ALIGNMENT_END
	if credits > 0:
		var dbl := UIKit.button(I18n.t("Double credits · watch video"), func() -> void:
			m.root.queue_free()
			MobileAds.rewarded(app, I18n.t("{n} more credits", {"n": StoreScreen.fmt(credits)}), func(ok: bool) -> void:
				if ok:
					Progression.add_credits(credits)
					MobileUI.reward_popup(app, I18n.t("Credits doubled"), [I18n.t("{n} credits", {"n": StoreScreen.fmt(credits)})])))
		acts.add_child(dbl)
	var ok := UIKit.button(I18n.t("Continue"), func() -> void: close_all.call(false), true)
	acts.add_child(ok)
	b.add_child(acts)
	ok.grab_focus.call_deferred()

static func _rate(app: App) -> void:
	var m := UIW.modal(app.overlay_layer, 520)
	var b: VBoxContainer = m.body
	UIW.modal_head(b, I18n.t("Enjoying GridCorsa?"), func() -> void: Progression.rate_prompt_answered(false); m.root.queue_free())
	var stars := UIW.hbox(6)
	stars.alignment = BoxContainer.ALIGNMENT_CENTER
	for i in 5:
		stars.add_child(MobileUI.Icon.make("star", 44, MobileUI.GOLD))
	b.add_child(stars)
	b.add_child(UIKit.label(I18n.t("Your rating helps other drivers find the game."), 17, UIKit.SOFT))
	var acts := UIW.hbox(10)
	acts.alignment = BoxContainer.ALIGNMENT_END
	acts.add_child(UIKit.button(I18n.t("Later"), func() -> void: Progression.rate_prompt_answered(false); m.root.queue_free()))
	# (the store page opens here once the game is published: OS.shell_open with its listing)
	acts.add_child(UIKit.button(I18n.t("Rate it"), func() -> void: Progression.rate_prompt_answered(true); m.root.queue_free(); app.toast(I18n.t("Thank you!")), true))
	b.add_child(acts)
