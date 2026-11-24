class_name MobileDaily
extends RefCounted
## The phone layout's Daily screen (docs/prompts/mobile-f2p-pass.md 32, 33; references 055, 078): the 7-day login
## calendar (day 7 the big one), the day's five goals and the week's three, each claimable when done; goals also give
## blueprints for the car being collected (Garage.goal), shown beside them. Replaces the home's Contracts window. The
## calendar opens by itself the first time the home shows on a day with its reward unclaimed (once a run).

static var _login_shown := false

static func show(app: App, tab: String = "") -> void:
	app.screen = "m_daily"
	app.back_to = func() -> void: app.show_menu()
	var holder := Control.new()
	UIKit.full(holder)
	var st := {"tab": tab if tab != "" else ("login" if Progression.login_ready() else "daily")}
	var _self := {}
	_self.render = func() -> void:
		for c in holder.get_children():
			c.queue_free()
		holder.add_child(_build(app, st, _self.render))
	_self.render.call()
	app.set_ui(holder)

## The home's first showing today with the login reward waiting: the calendar (MobileHome.build).
static func maybe_auto(app: App) -> void:
	if _login_shown or not Progression.login_ready():
		return
	_login_shown = true
	show.call_deferred(app, "login")

static func _build(app: App, st: Dictionary, rerender: Callable) -> Control:
	var tabs := [["login", I18n.t("Login rewards") + (" •" if Progression.login_ready() else "")],
		["daily", I18n.t("Daily goals") + (" •" if Progression.contracts_ready() > 0 else "")],
		["weekly", I18n.t("Weekly goals")]]
	var top := UIW.top_bar({"title": I18n.t("Daily"), "back": func() -> void: app.show_menu(), "tabs": tabs, "tab": st.tab,
		"on_tab": func(k: String) -> void: st.tab = k; rerender.call(),
		"right": [MobileUI.currency("credit", Progression.credits(), func() -> void: MobileStore.show(app, "deals"))]})
	var body: Control
	match st.tab:
		"login": body = _login(app, rerender)
		"weekly": body = _goals(app, true, rerender)
		_: body = _goals(app, false, rerender)
	var row := UIW.hbox(24)
	body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(body)
	if st.tab != "login":
		row.add_child(_goal_car(app))
	var scr := UIW.screen(top, row)
	UIKit.full(scr)
	return scr

static func _login(app: App, rerender: Callable) -> Control:
	var col := UIW.vbox(14)
	var row := UIW.hbox(10)
	var day := Progression.login_day()
	var ready := Progression.login_ready()
	for i in Progression.LOGIN.size():
		var rw: Array = Progression.LOGIN[i]
		var last := i == Progression.LOGIN.size() - 1
		var claimed := i < day
		var today := i == day and ready
		var p := PanelContainer.new()
		p.custom_minimum_size = Vector2(260 if last else 170, 250)
		var edge := MobileUI.MAIN if today else Color(1, 1, 1, 0.12)
		p.add_theme_stylebox_override("panel", UIKit.box(Color(MobileUI.PURPLE, 0.5) if last else MobileUI.GLASS, edge, 2 if today else 1, 8, Vector2(10, 10)))
		var c := UIW.vbox(8)
		var t := UIKit.label(I18n.t("Day {n}", {"n": i + 1}).to_upper(), 22, UIKit.TEXT, true, 800)
		t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		c.add_child(t)
		if last:
			var lr := UIKit.label(I18n.t("Loyalty reward").to_upper(), 14, MobileUI.GOLD, true, 700)
			lr.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			c.add_child(lr)
		var ic := CenterContainer.new()
		ic.add_child(MobileUI.Icon.make("blueprint" if rw[0] == "blueprints" else ("star" if rw[0] == "passXp" else "credit"), 56 if last else 44, MobileUI.GOLD if not claimed else Color(1, 1, 1, 0.3)))
		c.add_child(ic)
		var l := UIKit.label(Shop.reward_text(rw), 15, UIKit.TEXT if not claimed else UIKit.DIM, true, 600)
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		c.add_child(l)
		var fill := Control.new()
		fill.size_flags_vertical = Control.SIZE_EXPAND_FILL
		c.add_child(fill)
		if claimed:
			var done := UIKit.label(I18n.t("Claimed"), 16, UIKit.GOOD, true, 700)
			done.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			c.add_child(done)
		elif today:
			var b := MobileUI.main_button(I18n.t("Claim"), func() -> void:
				var line := Progression.claim_login()
				if line != "":
					MobileUI.reward_popup(app, I18n.t("Day {n}", {"n": i + 1}), [line])
				rerender.call())
			b.custom_minimum_size = Vector2(0, 48)
			c.add_child(b)
		p.add_child(c)
		row.add_child(p)
	col.add_child(UIW.hscroll(row))
	var next := UIW.muted(I18n.t("Come back every day: missing a day does not start the calendar again.") if ready else I18n.t("Next reward tomorrow."), 15)
	col.add_child(next)
	return col

static func _goals(app: App, weekly: bool, rerender: Callable) -> Control:
	var col := UIW.vbox(8)
	var head := UIW.hbox(10)
	var h := UIKit.label((I18n.t("Weekly goals") if weekly else I18n.t("Daily goals")).to_upper(), 30, UIKit.TEXT, true, 800)
	h.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(h)
	var left := Progression.weekly_left_s() if weekly else int(86400 - int(Time.get_unix_time_from_system()) % 86400)
	head.add_child(MobileUI.badge(I18n.t("Resets in {t}", {"t": Progression.fmt_left(left)}), Color(0, 0, 0, 0.7), UIKit.TEXT, "clock"))
	col.add_child(head)
	var list: Array = Progression.data().weekly if weekly else Progression.data().contracts
	for i in list.size():
		var c: Dictionary = list[i]
		var credits: int
		var bp: int
		if weekly:
			credits = Progression.WEEKLY[i][2]
			bp = Progression.WEEKLY[i][4]
		else:
			credits = Progression.contract_reward(c)[0]
			bp = Progression.BLUEPRINTS_GOAL
		var row := UIW.hbox(12)
		var info := UIW.vbox(4)
		info.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		info.add_child(UIKit.label(Progression.contract_text(c), 19, UIKit.TEXT, true, 600))
		var pr := UIW.hbox(8)
		var bar := MobileUI.bar(float(c.progress) / maxf(1.0, float(c.target)), MobileUI.TEAL)
		bar.custom_minimum_size = Vector2(260, 6)
		bar.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		pr.add_child(bar)
		pr.add_child(UIKit.label("%d/%d" % [int(c.progress), int(c.target)], 15, UIKit.SOFT, true, 600))
		info.add_child(pr)
		row.add_child(info)
		row.add_child(MobileUI.Icon.make("credit", 20, MobileUI.GOLD))
		row.add_child(UIKit.label(StoreScreen.fmt(credits), 18, MobileUI.GOLD, true, 700))
		row.add_child(MobileUI.Icon.make("blueprint", 20, MobileUI.TEAL))
		row.add_child(UIKit.label("×%d" % bp, 18, MobileUI.TEAL, true, 700))
		if c.claimed:
			row.add_child(UIKit.label(I18n.t("Claimed"), 17, UIKit.GOOD, true, 700))
		else:
			var idx := i
			var b := MobileUI.main_button(I18n.t("Claim"), func() -> void:
				var r := Progression.claim_weekly(idx) if weekly else Progression.claim_contract(idx)
				if not r.is_empty():
					var lines: Array = [I18n.t("{n} credits", {"n": StoreScreen.fmt(r[0])}), I18n.t("{n} pass XP", {"n": r[1]})]
					if r.size() > 2:
						lines.append(MobileHome.blueprint_text(r[2]))
					MobileUI.reward_popup(app, I18n.t("Goal complete"), lines)
				rerender.call())
			b.custom_minimum_size = Vector2(150, 48)
			b.disabled = int(c.progress) < int(c.target)
			row.add_child(b)
		col.add_child(UIW.row_line(row))
	col.add_child(UIW.muted(I18n.t("Offline races count: career, events and quick races."), 14))
	return col

## The car the goals' blueprints go to (reference 078's left side).
static func _goal_car(app: App) -> Control:
	var id := Garage.goal()
	var col := UIW.vbox(8)
	col.custom_minimum_size = Vector2(300, 0)
	if id == "":
		col.add_child(UIKit.label(I18n.t("Every car is in your garage."), 18, UIKit.SOFT, true, 600))
		return col
	var car := CarsDb.by_id(id)
	col.add_child(CarStudio.picture_rect(car, CarStudio.my_livery(), Vector2(0, 100)))
	col.add_child(UIKit.label(I18n.t("Complete goals to get blueprints for this car").to_upper(), 18, UIKit.TEXT, true, 800))
	col.add_child(UIKit.label(str(car.name).to_upper(), 20, MobileUI.GOLD, true, 800))
	col.add_child(MobileUI.bar(Garage.blueprints(id) / float(Garage.blueprints_needed(id)), MobileUI.TEAL))
	col.add_child(UIKit.label("%d/%d" % [Garage.blueprints(id), Garage.blueprints_needed(id)], 16, UIKit.SOFT, true, 700))
	col.add_child(UIKit.button(I18n.t("Choose another car"), func() -> void: MobileCars.show(app, id)))
	return col
