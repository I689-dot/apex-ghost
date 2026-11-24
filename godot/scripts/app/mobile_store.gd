class_name MobileStore
extends RefCounted
## The phone store (docs/prompts/mobile-f2p-pass.md 22, 23, 25, 27-31, E; references 006-010, 036, 058-066, 074, 092):
## the categories down the left (For you, Deals, Cars, Coins, Cosmetics, VIP, Free, Codes), the offers as cards on the
## right, each with a timer when it ends, a tag ("+25 %", "Most popular", "-50 %"), a green price and, when it costs
## money, the line saying so. Money is not taken (StoreScreen.checkout, a preview) until Google Play Billing is set up
## with the user's OK; credits, blueprints and free packs are real (Shop, Garage). Replaces the PC store page on the
## phone (MobileHome.open_store); the screen keeps its state to itself.

const CATS := [["foryou", "For you", "star"], ["deals", "Deals", "clock"], ["cars", "Cars", "car"], ["coins", "Coins", "coin"],
	["cosmetics", "Cosmetics", "brush"], ["vip", "VIP", "star"], ["free", "Free rewards", "gift"], ["codes", "Codes & invites", "mail"]]

static func show(app: App, cat: String = "foryou") -> void:
	Shop.opened()
	app.screen = "m_store"
	app.back_to = func() -> void: app.show_menu()
	var holder := Control.new()
	UIKit.full(holder)
	var st := {"cat": cat}
	var _self := {}
	_self.render = func() -> void:
		for c in holder.get_children():
			c.queue_free()
		holder.add_child(_build(app, st, _self.render))
	_self.render.call()
	app.set_ui(holder)

static func _build(app: App, st: Dictionary, rerender: Callable) -> Control:
	var top := UIW.top_bar({"title": I18n.t("Store"), "back": func() -> void: app.show_menu(),
		"right": [MobileUI.currency("credit", Progression.credits(), func() -> void: st.cat = "deals"; rerender.call()),
			MobileUI.currency("coin", StoreScreen.coins(), func() -> void: st.cat = "coins"; rerender.call())]})
	var row := UIW.hbox(18)
	# the categories
	var cats := UIW.vbox(4)
	cats.custom_minimum_size = Vector2(250, 0)
	for c: Array in CATS:
		var key: String = c[0]
		cats.add_child(_cat_button(I18n.t(c[1]), c[2], st.cat == key, _dot(key), func() -> void: st.cat = key; rerender.call()))
	row.add_child(UIW.scroll(cats))
	# the offers
	var body: Control
	match st.cat:
		"deals": body = _deals(app, rerender)
		"cars": body = _cars(app)
		"coins": body = _coins(app)
		"cosmetics": body = _cosmetics(app, rerender)
		"vip": body = _vip(app)
		"free": body = _free(app, rerender)
		"codes":
			body = UIW.vbox(16)
			body.add_child(StoreScreen.redeem_panel(rerender))
			body.add_child(StoreScreen.invite_panel())
		_: body = _for_you(app, st, rerender)
	body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var sc := UIW.scroll(body)
	sc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(sc)
	var scr := UIW.screen(top, row)
	UIKit.full(scr)
	return scr

static func _dot(key: String) -> bool:
	match key:
		"free": return Shop.has_free()
		"foryou": return Shop.starter_left_s() > 0
	return false

## A category: its icon and name, yellow when chosen (reference 058), a red dot when something waits there.
static func _cat_button(text: String, icon: String, on: bool, dot: bool, cb: Callable) -> Button:
	var b := Button.new()
	b.focus_mode = Control.FOCUS_ALL
	b.custom_minimum_size = Vector2(250, 52)
	for s: String in ["normal", "hover", "pressed"]:
		var c := MobileUI.MAIN if on else Color(0, 0, 0, 0.45 if s == "normal" else 0.7)
		b.add_theme_stylebox_override(s, UIKit.box(c, Color(1, 1, 1, 0.1), 1, 4, Vector2(14, 6)))
	var r := UIW.hbox(10)
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	UIKit.full(r)
	var fg := UIKit.INK if on else UIKit.TEXT
	r.add_child(UIW.margins(MobileUI.Icon.make(icon, 22, fg), 14, 0, 0, 0))
	var t := UIKit.label(text.to_upper(), 18, fg, true, 700)
	t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	r.add_child(t)
	if dot:
		r.add_child(UIW.margins(MobileUI.Icon.make("dot", 12, UIKit.BAD), 0, 0, 12, 0))
	b.add_child(r)
	b.pressed.connect(cb)
	return b

## An offer card: a title strip, an optional tag and timer, the contents, then the action (the price) at the bottom;
## `money` adds the line that it costs real money (reference 006).
static func _offer(title: String, lines: Array, tag: String, left_s: int, action: Button, money: bool, w: float = 330.0) -> Control:
	var p := PanelContainer.new()
	p.custom_minimum_size = Vector2(w, 300)
	p.add_theme_stylebox_override("panel", UIKit.box(MobileUI.GLASS, Color(1, 1, 1, 0.14), 1, 8, Vector2(14, 12)))
	var col := UIW.vbox(8)
	var head := UIW.hbox(8)
	var t := UIKit.label(title.to_upper(), 22, UIKit.TEXT, true, 800)
	t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	t.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	head.add_child(t)
	if tag != "":
		head.add_child(MobileUI.badge(tag, UIKit.BAD))
	col.add_child(head)
	if left_s > 0:
		col.add_child(MobileUI.badge(Progression.fmt_left(left_s), Color(0, 0, 0, 0.7), UIKit.TEXT, "clock"))
	for l: String in lines:
		var r := UIW.hbox(8)
		r.add_child(MobileUI.Icon.make("gift", 18, MobileUI.GOLD))
		var ll := UIKit.label(l, 17, UIKit.TEXT, true, 600)
		ll.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		ll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		r.add_child(ll)
		col.add_child(r)
	var fill := Control.new()
	fill.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col.add_child(fill)
	action.size_flags_horizontal = Control.SIZE_FILL
	col.add_child(action)
	if money:
		col.add_child(UIW.muted(I18n.t("Costs real money."), 12))
	p.add_child(col)
	return p

static func _flow() -> HFlowContainer:
	var f := HFlowContainer.new()
	f.add_theme_constant_override("h_separation", 14)
	f.add_theme_constant_override("v_separation", 14)
	return f

static func _money_button(app: App, title: String, lines: Array, price: float) -> Button:
	return MobileUI.buy_button(I18n.t("Buy"), StoreScreen.money(price), "", func() -> void:
		StoreScreen.checkout(app, title, lines.map(func(l: String) -> Array: return [l, ""]), price))

# --------------------------------------------------------------- for you ---

static func _for_you(app: App, st: Dictionary, rerender: Callable) -> Control:
	var f := _flow()
	var left := Shop.starter_left_s()
	if left > 0:
		var lines: Array = [Shop.reward_text(["credits", Shop.STARTER.credits]), Shop.reward_text(["coins", Shop.STARTER.coins]), Shop.reward_text(["blueprints", Shop.STARTER.blueprints])]
		f.add_child(_offer(I18n.t("Starter pack"), lines, I18n.t("Once only"), left, _money_button(app, I18n.t("Starter pack"), lines, Shop.STARTER.price), true))
	var d := Shop.deal("day")
	var dl: Array = d.deal
	f.add_child(_offer(I18n.t(dl[1]), Shop.contents_text(dl[2]), dl[4], d.left_s, _money_button(app, I18n.t(dl[1]), Shop.contents_text(dl[2]), dl[3]), true))
	var vip := MobileUI.main_button(I18n.t("See VIP"), func() -> void: st.cat = "vip"; rerender.call())
	f.add_child(_offer(I18n.t("VIP membership"), [I18n.t(Shop.VIP.perks[0]), I18n.t(Shop.VIP.perks[1])], I18n.t("{n} days free", {"n": Shop.VIP.trialDays}), 0, vip, false))
	if Shop.has_free():
		f.add_child(_offer(I18n.t("Free rewards"), [I18n.t("A gift every day and free packs")], "", 0,
			MobileUI.main_button(I18n.t("Open"), func() -> void: st.cat = "free"; rerender.call()), false))
	return f

# ----------------------------------------------------------------- deals ---

static func _deals(app: App, _rerender: Callable) -> Control:
	var f := _flow()
	for per: Array in [["day", "Daily deal"], ["week", "Weekly deal"], ["month", "Monthly deal"]]:
		var d := Shop.deal(per[0])
		var dl: Array = d.deal
		var lines := Shop.contents_text(dl[2])
		f.add_child(_offer(I18n.t(per[1]) + " · " + I18n.t(dl[1]), lines, dl[4], d.left_s, _money_button(app, I18n.t(dl[1]), lines, dl[3]), true))
	return f

# ------------------------------------------------------------------ cars ---

static func _cars(app: App) -> Control:
	var f := _flow()
	for c: Dictionary in CarsDb.selectable():
		if Garage.owns(c.id):
			continue
		var p := PanelContainer.new()
		p.custom_minimum_size = Vector2(300, 0)
		p.add_theme_stylebox_override("panel", UIKit.box(MobileUI.GLASS, Garage.RARITY_COLOUR[Garage.rarity(c.id)], 1, 8, Vector2(10, 10)))
		var col := UIW.vbox(6)
		# (the far model's small picture, as the car screen's strip: 120 high asked for the near models, loaded one after the
		# other on the main thread, and the test stalled)
		col.add_child(CarStudio.picture_rect(c, CarStudio.my_livery(), Vector2(0, 80)))
		col.add_child(UIKit.label(str(c.name).to_upper(), 18, UIKit.TEXT, true, 700))
		col.add_child(MobileUI.rarity_tag(c.id))
		col.add_child(UIKit.label(I18n.t("{n}/{m} blueprints", {"n": Garage.blueprints(c.id), "m": Garage.blueprints_needed(c.id)}), 15, UIKit.SOFT, true, 600))
		var id: String = c.id
		col.add_child(MobileUI.buy_button(I18n.t("View"), StoreScreen.fmt(Garage.price(c.id)), "credit", func() -> void: MobileCars.show(app, id)))
		p.add_child(col)
		f.add_child(p)
	if f.get_child_count() == 0:
		f.add_child(UIKit.label(I18n.t("Every car is in your garage."), 20, UIKit.SOFT, true, 600))
	return f

# ----------------------------------------------------------------- coins ---

## Coin packs with their bonus as "+N %" and the references' tags (reference 058).
static func _coins(app: App) -> Control:
	var f := _flow()
	for pk: Dictionary in StoreScreen.PACKS:
		var total := int(pk.coins) + int(pk.bonus)
		var more := roundi(100.0 * int(pk.bonus) / maxf(1.0, float(pk.coins)))
		var tag := I18n.t(str(pk.tag)) if str(pk.tag) != "" and not str(pk.tag).begins_with("+") else ("+%d %%" % more if more > 0 else "")
		var lines: Array = [I18n.t("{n} coins", {"n": StoreScreen.fmt(total)})]
		if more > 0:
			lines.append(I18n.t("{n} more than the base pack", {"n": "%d %%" % more}))
		f.add_child(_offer(I18n.t("{n} coins", {"n": StoreScreen.fmt(total)}), lines, tag, 0, _money_button(app, I18n.t("{n} coins", {"n": StoreScreen.fmt(total)}), lines, float(pk.price)), true, 260.0))
	return f

# ------------------------------------------------------------- cosmetics ---

static func _cosmetics(app: App, rerender: Callable) -> Control:
	var col := UIW.vbox(12)
	col.add_child(UIW.muted(I18n.t("Paint and parts for coins. Until the store opens they are free on the Paint page."), 15))
	var f := _flow()
	for it: Dictionary in StoreScreen.ITEMS:
		var item := it
		var b := MobileUI.buy_button(I18n.t("Unlock"), StoreScreen.fmt(int(it.price)), "coin", func() -> void: StoreScreen.spend_item(app, item, rerender))
		f.add_child(_offer(I18n.t(it.name), [I18n.t(it.kind)], "", 0, b, false, 240.0))
	col.add_child(f)
	return col

# ------------------------------------------------------------------- VIP ---

static func _vip(app: App) -> Control:
	var col := UIW.vbox(12)
	col.add_child(UIKit.label(I18n.t("Be a VIP member").to_upper(), 34, MobileUI.GOLD, true, 800))
	for perk: String in Shop.VIP.perks:
		var r := UIW.hbox(10)
		r.add_child(MobileUI.Icon.make("star", 22, MobileUI.GOLD))
		r.add_child(UIKit.label(I18n.t(perk), 19, UIKit.TEXT, true, 600))
		col.add_child(r)
	var price := float(Shop.VIP.price)
	var b := MobileUI.buy_button(I18n.t("Subscribe"), I18n.t("{p} a month", {"p": StoreScreen.money(price)}), "", func() -> void:
		StoreScreen.checkout(app, I18n.t("VIP membership"), [[I18n.t("{n} days free, then monthly", {"n": Shop.VIP.trialDays}), StoreScreen.money(price)]], price))
	b.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	b.custom_minimum_size = Vector2(420, 58)
	col.add_child(b)
	var fine := UIW.muted(I18n.t("{n}-day free trial, then {p} a month until you cancel. It renews by itself unless turned off at least 24 hours before the period ends; cancel at any time in Google Play › Subscriptions. Costs real money.", {"n": Shop.VIP.trialDays, "p": StoreScreen.money(price)}), 13)
	fine.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	col.add_child(fine)
	col.add_child(UIW.hair())
	var lines: Array = [I18n.t("No more ads between races"), I18n.t("Rewarded ads stay: they are your choice")]
	var row := _flow()
	row.add_child(_offer(I18n.t("Remove ads"), lines, "", 0, _money_button(app, I18n.t("Remove ads"), lines, Shop.REMOVE_ADS), true, 360.0))
	col.add_child(row)
	return col

# ------------------------------------------------------------------ free ---

static func _free(app: App, rerender: Callable) -> Control:
	var f := _flow()
	# the gift of the day
	var gift := MobileUI.main_button(I18n.t("Claim") if Shop.gift_ready() else I18n.t("Tomorrow"), func() -> void:
		var r := Shop.claim_gift()
		if not r.is_empty():
			MobileUI.reward_popup(app, I18n.t("Daily gift"), r)
		rerender.call())
	gift.disabled = not Shop.gift_ready()
	f.add_child(_offer(I18n.t("Daily gift"), [Shop.reward_text(["credits", 5000])], "", 0, gift, false, 280.0))
	# the free pack: an ad, then one draw, its odds shown (decision C)
	var odds: Array = []
	for o: Array in Shop.FREE_PACK_ODDS:
		odds.append("%d %%: %s" % [int(o[0]), Shop.odds_text(o)])
	var pk := MobileUI.buy_button(I18n.t("Watch ad"), I18n.t("{n} left", {"n": Shop.free_packs_left()}), "tv", func() -> void:
		MobileAds.rewarded(app, I18n.t("A free pack"), func(ok: bool) -> void:
			if ok:
				var line := Shop.open_free_pack()
				if line != "":
					MobileUI.reward_popup(app, I18n.t("Free pack"), [line])
			rerender.call()))
	pk.disabled = Shop.free_packs_left() <= 0
	f.add_child(_offer(I18n.t("Free pack"), odds, I18n.t("Odds shown"), 0, pk, false, 360.0))
	# the ad ladder (reference 036): each step takes more ads and gives more
	var ladder := UIW.hbox(10)
	for i in Shop.LADDER.size():
		var step: Array = Shop.LADDER[i]
		var done := i < Shop.ladder_step()
		var current := i == Shop.ladder_step()
		var p := PanelContainer.new()
		p.custom_minimum_size = Vector2(200, 170)
		p.add_theme_stylebox_override("panel", UIKit.box(MobileUI.GLASS, MobileUI.MAIN if current else Color(1, 1, 1, 0.12), 2 if current else 1, 8, Vector2(10, 10)))
		var col := UIW.vbox(6)
		col.add_child(UIKit.label(I18n.t("Step {n}", {"n": i + 1}).to_upper(), 16, UIKit.SOFT, true, 700))
		var rl := UIKit.label(Shop.reward_text(step[1]), 17, UIKit.TEXT, true, 700)
		rl.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		col.add_child(rl)
		var fill := Control.new()
		fill.size_flags_vertical = Control.SIZE_EXPAND_FILL
		col.add_child(fill)
		if done:
			col.add_child(UIKit.label(I18n.t("Collected"), 16, UIKit.GOOD, true, 700))
		elif current:
			var watched := Shop.ladder_ads()
			col.add_child(MobileUI.buy_button("%d/%d" % [watched, int(step[0])], "", "tv", func() -> void:
				MobileAds.rewarded(app, Shop.reward_text(step[1]), func(ok: bool) -> void:
					if ok:
						var line := Shop.ladder_watched()
						if line != "":
							MobileUI.reward_popup(app, I18n.t("Ad relay"), [line])
					rerender.call())))
		else:
			col.add_child(MobileUI.Icon.make("lock", 22, UIKit.SOFT))
		p.add_child(col)
		ladder.add_child(p)
	var lcol := UIW.vbox(8)
	lcol.add_child(UIKit.label(I18n.t("Ad relay").to_upper(), 22, UIKit.TEXT, true, 800))
	lcol.add_child(UIW.muted(I18n.t("Each step takes a few ads and gives more. It starts again every day."), 14))
	lcol.add_child(ladder)
	var col2 := UIW.vbox(18)
	col2.add_child(f)
	col2.add_child(lcol)
	return col2
