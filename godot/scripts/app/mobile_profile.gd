class_name MobileProfile
extends RefCounted
## The phone layout's driver profile (docs/prompts/mobile-f2p-pass.md 5; references 079, 093): your name, country flag,
## level and rank, licence and ratings; the most-driven car; your badges (the career's achievements); your numbers by
## discipline (races, wins, podiums, poles, distance, clean laps); your player ID to copy for friends. Opened from the
## home's driver card; the full career page stays one tap away.

static func show(app: App) -> void:
	app.screen = "m_profile"
	app.back_to = func() -> void: app.show_menu()
	var c := CareerData.load_career()
	var lv: Dictionary = CareerData.level_of(c.xp)
	var rk := CareerData.rank_of(int(lv.level))
	var a: Variant = Account.account()
	var top := UIW.top_bar({"title": I18n.t("Driver profile"), "back": func() -> void: app.show_menu()})
	var row := UIW.hbox(18)

	# who: flag, name, level, licence, ID
	var who := _card(I18n.t("Driver"))
	var wc: VBoxContainer = who.get_meta("col")
	var nm := UIW.hbox(10)
	var cc := str(a.user.get("country", "")).to_lower() if a != null else ""
	if cc != "" and ResourceLoader.exists("res://assets_static/flags/%s.png" % cc):
		var fl := TextureRect.new()
		fl.texture = load("res://assets_static/flags/%s.png" % cc)
		fl.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		fl.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		fl.custom_minimum_size = Vector2(40, 28)
		nm.add_child(fl)
	nm.add_child(UIKit.label(MobileHome.nick().to_upper(), 28, UIKit.TEXT, true, 800))
	wc.add_child(nm)
	wc.add_child(UIKit.label(I18n.t("Level {n} · {rank}", {"n": lv.level, "rank": I18n.t(rk.name)}), 18, rk.colour, true, 700))
	wc.add_child(MobileUI.bar(float(lv.into) / float(lv.need), MobileUI.TEAL))
	var lic := str(c.licence)
	wc.add_child(UIKit.label(I18n.t("Licence {l} · Safety {sr} · Rating {r}", {"l": I18n.t(CareerData.LICENCE_NAME.get(lic, lic)), "sr": "%.2f" % float(c.sr), "r": int(c.get("rating", CareerData.RATING_START))}), 16, UIKit.SOFT, true, 600))
	if a != null:
		# friends add each other by driver name (unique per account: Account.add_friend), so the name is the player ID
		var nick := str(a.user.nick)
		var ids := UIW.hbox(8)
		ids.add_child(UIKit.label(I18n.t("Player ID") + "  " + nick, 16, UIKit.TEXT, true, 700))
		ids.add_child(UIKit.button(I18n.t("Copy ID"), func() -> void:
			DisplayServer.clipboard_set(nick)
			app.toast(I18n.t("Player ID copied: a friend adds you with it in Friends."))))
		ids.add_child(UIKit.button(I18n.t("Invite a friend"), func() -> void:
			DisplayServer.clipboard_set(I18n.t("Race me in GridCorsa! Add me as {nick}, and use my invite code {code} for free coins.", {"nick": nick, "code": StoreScreen.invite_code()}))
			app.toast(I18n.t("Invite copied: paste it in a message to a friend."))))
		ids.add_child(UIKit.button(I18n.t("Friends"), func() -> void: app.show_classic_menu("friends")))
		wc.add_child(ids)
	else:
		wc.add_child(UIW.muted(I18n.t("Sign in to get a player ID your friends can add."), 14))
	row.add_child(who)

	# numbers and badges
	var mid := UIW.vbox(14)
	mid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var nums := _card(I18n.t("Progress"))
	var grid := GridContainer.new()
	grid.columns = 3
	grid.add_theme_constant_override("h_separation", 26)
	grid.add_theme_constant_override("v_separation", 10)
	for st: Array in [[I18n.t("Races"), str(int(c.races))], [I18n.t("Wins"), str(int(c.wins))], [I18n.t("Podiums"), str(int(c.podiums))],
			[I18n.t("Poles"), str(int(c.poles))], [I18n.t("Distance"), "%d km" % roundi(float(c.km))], [I18n.t("Clean laps"), str(int(c.cleanLaps))]]:
		grid.add_child(UIW.stat(st[0], st[1], 26))
	nums.get_meta("col").add_child(grid)
	mid.add_child(nums)
	var badges := _card(I18n.t("Badges"))
	var got: Array = c.get("achievements", [])
	var brow := UIW.hbox(10)
	for ach: Array in CareerData.ACHIEVEMENTS:
		if got.has(ach[0]) and brow.get_child_count() < 4:
			var bx := UIW.vbox(2)
			var ic := CenterContainer.new()
			ic.add_child(MobileUI.Icon.make("trophy", 34, MobileUI.GOLD))
			bx.add_child(ic)
			bx.add_child(UIKit.label(I18n.t(ach[1]), 13, UIKit.TEXT, true, 600))
			brow.add_child(bx)
	badges.get_meta("col").add_child(brow)
	if brow.get_child_count() == 0:
		badges.get_meta("col").add_child(UIW.muted(I18n.t("Race to earn badges: your first finish, podium, win…"), 14))
	badges.get_meta("col").add_child(UIW.muted(I18n.t("{n} of {m} earned", {"n": got.size(), "m": CareerData.ACHIEVEMENTS.size()}), 13))
	mid.add_child(badges)
	row.add_child(mid)

	# the most-driven car
	var car_card := _card(I18n.t("Most driven car"))
	var md := Progression.most_driven()
	var car := CarsDb.by_id(md) if md != "" else CarStudio.my_car()
	if not car.is_empty():
		car_card.get_meta("col").add_child(CarStudio.picture_rect(car, CarStudio.my_livery(), Vector2(0, 100)))
		car_card.get_meta("col").add_child(UIKit.label(str(car.name).to_upper(), 18, UIKit.TEXT, true, 700))
		var uses := int((Progression.data().carUse as Dictionary).get(car.id, 0))
		car_card.get_meta("col").add_child(UIW.muted(I18n.t("{n} races", {"n": uses}), 14))
	car_card.get_meta("col").add_child(UIKit.button(I18n.t("Full career"), func() -> void: app.show_career()))
	row.add_child(car_card)

	var holder := Control.new()
	UIKit.full(holder)
	var scr := UIW.screen(top, row)
	UIKit.full(scr)
	holder.add_child(scr)
	app.set_ui(holder)

## A glass card with its title; its column is in the "col" meta.
static func _card(title: String) -> PanelContainer:
	var p := PanelContainer.new()
	p.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	p.add_theme_stylebox_override("panel", UIKit.box(MobileUI.GLASS, Color(1, 1, 1, 0.14), 1, 8, Vector2(16, 12)))
	var col := UIW.vbox(10)
	col.add_child(UIKit.label(title.to_upper(), 20, UIKit.SOFT, true, 800))
	p.add_child(col)
	p.set_meta("col", col)
	return p
