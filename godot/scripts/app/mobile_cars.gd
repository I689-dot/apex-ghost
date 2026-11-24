class_name MobileCars
extends RefCounted
## The phone layout's car screen (docs/prompts/mobile-f2p-pass.md 6, 7, 8, B; references 011, 045, 046, 067, 089):
## the shown car large in the middle; its name, rarity, rating and stat bars on the left; on the right what it takes:
## SELECT for a car you own, else its blueprints ("7 left to unlock") and its credit price; along the bottom the
## rarity tabs, a search and the line-up as cards, a padlock on the locked ones. A car unlocked shows the full-screen
## reveal once (reveal()). The screen keeps its state to itself (CLAUDE.md: no static UI state set from elsewhere).

const ALL := "all"

static func show(app: App, start_id: String = "") -> void:
	app.screen = "m_cars"
	app.back_to = func() -> void: app.show_menu()
	var holder := Control.new()
	UIKit.full(holder)
	var st := {"id": start_id if start_id != "" else str(CarStudio.my_car().get("id", "")), "tab": ALL, "q": ""}
	var _self := {}
	_self.render = func() -> void:
		for c in holder.get_children():
			c.queue_free()
		holder.add_child(_build(app, st, _self.render))
	_self.render.call()
	app.set_ui(holder)
	# a car unlocked elsewhere (a chest's blueprints) is revealed when the garage opens
	_reveal_pending(app, _self.render)

static func _cars(st: Dictionary) -> Array:
	var q := str(st.q).to_lower()
	return CarsDb.selectable().filter(func(c: Dictionary) -> bool:
		return (st.tab == ALL or Garage.rarity(c.id) == st.tab) and (q == "" or str(c.name).to_lower().contains(q)))

static func _build(app: App, st: Dictionary, rerender: Callable) -> Control:
	var root := Control.new()
	UIKit.full(root)
	var car := CarsDb.by_id(str(st.id))
	if car.is_empty():
		car = CarStudio.my_car()
		st.id = car.get("id", "")
	var owned := Garage.owns(car.id)

	# the car, large, between the columns
	var shade := ColorRect.new()
	shade.color = Color(0.0, 0.01, 0.03, 0.6)
	shade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	UIKit.full(shade)
	root.add_child(shade)
	var pv := CarStudio.Preview.new(car, CarStudio.my_livery())
	pv.anchor_left = 0.24
	pv.anchor_right = 0.78
	pv.anchor_top = 0.1
	pv.anchor_bottom = 0.72
	if not owned:
		pv.modulate = Color(0.75, 0.75, 0.8)
	root.add_child(pv)

	# the top bar: back, the count owned, the currencies
	var top := UIW.top_bar({"title": I18n.t("Cars") + "  ·  " + I18n.t("{n}/{m} owned", {"n": Garage.owned().size(), "m": CarsDb.selectable().size()}),
		"back": func() -> void: app.show_menu(),
		"right": [MobileUI.currency("credit", Progression.credits(), func() -> void: MobileHome.open_store(app, "coins")),
			MobileUI.currency("coin", StoreScreen.coins(), func() -> void: MobileHome.open_store(app, "coins"))]})
	top.set_anchors_preset(Control.PRESET_TOP_WIDE)
	root.add_child(top)

	# left: name, rarity, rating, stats
	var left := UIW.vbox(8)
	left.position = Vector2(22, 70)
	left.custom_minimum_size = Vector2(330, 0)
	left.add_child(UIKit.label(str(car.get("manufacturer", "")).to_upper(), 15, UIKit.SOFT, true, 600))
	left.add_child(UIKit.label(str(car.name).to_upper(), 26, UIKit.TEXT, true, 800))
	left.add_child(MobileUI.rarity_tag(car.id, Garage.stars(car.id)))
	var s := Garage.stats(car)
	var pr := UIW.hbox(8)
	pr.add_child(UIKit.label(str(int(s.pr) + Garage.upgrade_pr(car.id)), 34, UIKit.TEXT, true, 800))
	pr.add_child(UIKit.label(I18n.t("PR"), 16, UIKit.SOFT, true, 700))
	if Garage.upgrade_pr(car.id) > 0:
		pr.add_child(UIKit.label(I18n.t("(+{n} career parts)", {"n": Garage.upgrade_pr(car.id)}), 14, UIKit.GOOD, true, 600))
	left.add_child(pr)
	for row: Array in [[I18n.t("Top speed"), "%d km/h" % roundi(s.top), "top", s.top], [I18n.t("Power"), "%d hp/t" % roundi(s.hpT), "hpT", s.hpT],
			[I18n.t("Downforce"), "%.2f m²" % s.downforce, "downforce", s.downforce], [I18n.t("Braking"), "%.1f kN·m/t" % s.brake, "brake", s.brake]]:
		var line := UIW.hbox(8)
		var n := UIKit.label(String(row[0]).to_upper(), 15, UIKit.SOFT, true, 600)
		n.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		line.add_child(n)
		line.add_child(UIKit.label(row[1], 17, UIKit.TEXT, true, 700))
		left.add_child(line)
		var b := MobileUI.bar(Garage.stat_share(row[2], row[3]), UIKit.TEXT, 4)
		left.add_child(b)
	root.add_child(left)

	# right: select, or what unlocking takes
	var right := UIW.vbox(10)
	right.custom_minimum_size = Vector2(300, 0)
	right.alignment = BoxContainer.ALIGNMENT_END
	if owned:
		var uid: String = car.id
		right.add_child(MobileUI.buy_button(I18n.t("Upgrade"), I18n.t("Career"), "", func() -> void: upgrades(app, uid, rerender)))
		if car.id == CarStudio.my_car().get("id", ""):
			right.add_child(MobileUI.badge(I18n.t("In your garage · driving").to_upper(), Color(0, 0, 0, 0.7), UIKit.GOOD))
		else:
			var id: String = car.id
			right.add_child(MobileUI.main_button(I18n.t("Select"), func() -> void:
				Settings.data.lastCar = id
				Settings.save()
				app.show_menu()))
	else:
		right.add_child(_blueprint_card(car, rerender))
		var id2: String = car.id
		var buy := MobileUI.buy_button(I18n.t("Buy"), StoreScreen.fmt(Garage.price(car.id)), "credit", func() -> void:
			if Garage.buy(id2):
				reveal(app, id2, rerender)
			else:
				app.toast(I18n.t("Not enough credits: race, open chests or get more in the store.")))
		right.add_child(buy)
		# one race in it by an ad (reference 028)
		var tid: String = car.id
		right.add_child(MobileUI.main_button(I18n.t("Try it · one race") if Garage.trial() != tid else I18n.t("On trial: race it now"), func() -> void:
			if Garage.trial() == tid:
				MobileModes.show(app)
				return
			MobileAds.rewarded(app, I18n.t("One race in the {car}", {"car": str(car.name)}), func(ok: bool) -> void:
				if ok:
					Garage.try_car(tid)
					app.toast(I18n.t("The {car} is yours for one race.", {"car": str(car.name)}))
				rerender.call())))
	var rh := Control.new()
	rh.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	rh.mouse_filter = Control.MOUSE_FILTER_IGNORE
	rh.add_child(right)
	right.position = Vector2(-322, 120)
	root.add_child(rh)

	# bottom: rarity tabs, search, the line-up
	var bottom := UIW.vbox(8)
	bottom.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	bottom.offset_top = -200
	bottom.offset_left = 22
	bottom.offset_right = -22
	bottom.offset_bottom = -10
	var tabs := UIW.hbox(6)
	for t: String in [ALL] + Garage.RARITY:
		var tab := t
		var label := I18n.t("All") if t == ALL else I18n.t(Garage.RARITY_NAME[t])
		var tb := UIW.TabButton.new(label.to_upper(), st.tab == t, true)
		tb.pressed.connect(func() -> void: st.tab = tab; rerender.call())
		tabs.add_child(tb)
	var sp := Control.new()
	sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	tabs.add_child(sp)
	tabs.add_child(MobileUI.Icon.make("search", 22, UIKit.SOFT))
	var q := LineEdit.new()
	q.placeholder_text = I18n.t("Search")
	q.text = str(st.q)
	q.custom_minimum_size = Vector2(220, 40)
	q.text_submitted.connect(func(v: String) -> void: st.q = v; rerender.call())
	tabs.add_child(q)
	bottom.add_child(tabs)
	var strip := UIW.hbox(8)
	for c: Dictionary in _cars(st):
		strip.add_child(_card(c, c.id == st.id, func() -> void: st.id = c.id; rerender.call()))
	var sc := UIW.scroll(strip)
	sc.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_SHOW_NEVER
	sc.custom_minimum_size = Vector2(0, 130)
	bottom.add_child(sc)
	root.add_child(bottom)
	return root

## The car's performance parts (references 048-054; decision A: they count in the career only): the parts as tabs, the
## chosen one's stage dots and effect, the rating it adds, UPGRADE for credits or one stage by an ad (a few a day).
static func upgrades(app: App, id: String, on_change: Callable) -> void:
	var m := UIW.modal(app.overlay_layer, 900)
	var st := {"part": "engine"}
	var _self := {}
	_self.render = func() -> void:
		var b: VBoxContainer = m.body
		for c in b.get_children():
			c.queue_free()
		UIW.modal_head(b, I18n.t("Upgrade"), func() -> void: m.root.queue_free(); on_change.call(), str(CarsDb.by_id(id).get("name", "")))
		var tabs := UIW.hbox(6)
		for p: Array in Garage.PARTS:
			var key: String = p[0]
			var tb := UIW.TabButton.new("%s  %d/%d" % [I18n.t(p[1]).to_upper(), Garage.stage(id, key), Garage.MAX_STAGE], st.part == key, true)
			tb.pressed.connect(func() -> void: st.part = key; _self.render.call())
			tabs.add_child(tb)
		b.add_child(tabs)
		var part: Array = []
		for p: Array in Garage.PARTS:
			if p[0] == st.part:
				part = p
		var row := UIW.hbox(16)
		var info := UIW.vbox(8)
		info.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		info.add_child(UIKit.label(I18n.t(part[1]).to_upper(), 40, UIKit.TEXT, true, 800))
		var dots := UIW.hbox(6)
		for i in Garage.MAX_STAGE:
			dots.add_child(MobileUI.Icon.make("dot", 18, MobileUI.BUY if i < Garage.stage(id, st.part) else Color(1, 1, 1, 0.2)))
		info.add_child(dots)
		info.add_child(UIKit.label(I18n.t("Each stage: {e} · +{pr} PR", {"e": I18n.t(part[3]), "pr": int(part[2])}), 18, UIKit.SOFT, true, 600))
		info.add_child(UIKit.label(I18n.t("Rating with parts: {n} PR", {"n": int(Garage.stats(CarsDb.by_id(id)).pr) + Garage.upgrade_pr(id)}), 20, UIKit.TEXT, true, 700))
		info.add_child(UIW.muted(I18n.t("Parts count in career races only: online and quick races stay equal."), 14))
		row.add_child(info)
		var acts := UIW.vbox(10)
		acts.custom_minimum_size = Vector2(300, 0)
		if Garage.stage(id, st.part) >= Garage.MAX_STAGE:
			acts.add_child(UIKit.label(I18n.t("Fully upgraded"), 22, UIKit.GOOD, true, 800))
		else:
			acts.add_child(MobileUI.buy_button(I18n.t("Upgrade"), StoreScreen.fmt(Garage.stage_cost(id, st.part)), "credit", func() -> void:
				if Garage.upgrade(id, st.part):
					_self.render.call()
				else:
					app.toast(I18n.t("Not enough credits."))))
			var ad := MobileUI.buy_button(I18n.t("Watch ad"), I18n.t("{n} left today", {"n": Garage.ad_stages_left()}), "tv", func() -> void:
				MobileAds.rewarded(app, I18n.t("One {part} stage", {"part": I18n.t(part[1])}), func(ok: bool) -> void:
					if ok:
						Garage.upgrade(id, st.part, true)
					_self.render.call()))
			ad.disabled = Garage.ad_stages_left() <= 0
			acts.add_child(ad)
		row.add_child(acts)
		b.add_child(row)
	_self.render.call()

## A card of the line-up: its picture, name, rarity edge, a padlock when locked.
static func _card(c: Dictionary, on: bool, cb: Callable) -> Button:
	var b := UIW.card_button(on, 6)
	b.custom_minimum_size = Vector2(200, 126)
	var col := UIW.vbox(2)
	col.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var pic := CarStudio.picture_rect(c, CarStudio.my_livery(), Vector2(0, 80))
	if not Garage.owns(c.id):
		pic.modulate = Color(0.55, 0.55, 0.6)
	col.add_child(pic)
	var row := UIW.hbox(6)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var n := UIKit.label(str(c.name).to_upper(), 13, UIKit.TEXT, true, 600)
	n.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	n.clip_text = true
	row.add_child(n)
	if not Garage.owns(c.id):
		row.add_child(MobileUI.Icon.make("lock", 16, UIKit.TEXT))
	col.add_child(row)
	var edge := ColorRect.new()
	edge.color = Garage.RARITY_COLOUR[Garage.rarity(c.id)]
	edge.custom_minimum_size = Vector2(0, 4)
	edge.mouse_filter = Control.MOUSE_FILTER_IGNORE
	col.add_child(edge)
	b.get_node("content").add_child(UIW.margins(col, 6, 4, 6, 4))
	b.pressed.connect(cb)
	return b

## A locked car's blueprints: how many, how many left, and the button making it the goal chests and bonuses fill.
static func _blueprint_card(car: Dictionary, rerender: Callable) -> Control:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", UIKit.box(MobileUI.GLASS, Color(1, 1, 1, 0.14), 1, 6, Vector2(12, 10)))
	var col := UIW.vbox(6)
	var have := Garage.blueprints(car.id)
	var need := Garage.blueprints_needed(car.id)
	var top := UIW.hbox(8)
	top.add_child(MobileUI.Icon.make("blueprint", 26, MobileUI.TEAL))
	var t := UIKit.label(I18n.t("{n} left to unlock", {"n": need - have}).to_upper(), 16, UIKit.TEXT, true, 700)
	t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(t)
	top.add_child(UIKit.label("%d/%d" % [have, need], 16, UIKit.SOFT, true, 700))
	col.add_child(top)
	col.add_child(MobileUI.bar(have / float(need), MobileUI.TEAL))
	var id: String = car.id
	if Garage.goal() == id:
		col.add_child(UIW.muted(I18n.t("Chests, the free bonus and goals give blueprints for this car."), 13))
	else:
		col.add_child(UIKit.button(I18n.t("Collect blueprints for this car"), func() -> void: Garage.set_goal(id); rerender.call()))
	p.add_child(col)
	return p

## Cars unlocked and not yet shown: their reveals one after the other.
static func _reveal_pending(app: App, then: Callable) -> void:
	var ids := Garage.unrevealed()
	if ids.is_empty():
		return
	reveal(app, ids[0], func() -> void:
		then.call()
		_reveal_pending(app, then))

## NEW CAR UNLOCKED (references 046, 089): the car over the whole screen, its name, rarity and rating; once.
static func reveal(app: App, id: String, on_done: Callable) -> void:
	Garage.mark_revealed(id)
	var car := CarsDb.by_id(id)
	if car.is_empty():
		on_done.call()
		return
	var root := Control.new()
	UIKit.full(root)
	root.mouse_filter = Control.MOUSE_FILTER_STOP
	var bg := ColorRect.new()
	bg.color = Color(0.03, 0.03, 0.05, 0.97)
	UIKit.full(bg)
	root.add_child(bg)
	var pv := CarStudio.Preview.new(car, CarStudio.my_livery())
	pv.anchor_left = 0.38
	pv.anchor_right = 1.0
	pv.anchor_top = 0.15
	pv.anchor_bottom = 0.9
	root.add_child(pv)
	var col := UIW.vbox(10)
	col.position = Vector2(60, 90)
	var head := UIKit.label(I18n.t("New car\nunlocked").to_upper(), 64, Garage.RARITY_COLOUR[Garage.rarity(id)], true, 800)
	head.add_theme_font_override("font", UIKit.font(true, 800, true))
	col.add_child(head)
	col.add_child(UIKit.label(str(car.get("manufacturer", "")).to_upper(), 20, UIKit.SOFT, true, 600))
	col.add_child(UIKit.label(str(car.name).to_upper(), 36, UIKit.TEXT, true, 800))
	col.add_child(MobileUI.rarity_tag(id, 0))
	col.add_child(UIKit.label(I18n.t("{n} PR", {"n": Garage.stats(car).pr}), 22, UIKit.TEXT, true, 700))
	root.add_child(col)
	var go := MobileUI.main_button(I18n.t("Continue"), func() -> void:
		root.queue_free()
		on_done.call())
	go.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	go.position = Vector2(-280, -100)
	var gh := Control.new()
	gh.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	gh.mouse_filter = Control.MOUSE_FILTER_IGNORE
	gh.add_child(go)
	go.position = Vector2(-280, -96)
	root.add_child(gh)
	app.overlay_layer.add_child(root)
	go.grab_focus.call_deferred()
