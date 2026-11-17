class_name StoreScreen
extends RefCounted
## The store, as a preview (the user, 2026-11-17: "show me how it would be with the payment and coins prices, but
## without the payment"): coin packs and their prices, the checkout with the payment step, what coins buy (paint and
## parts, each shown on your car), the welcome offer, promotional codes and inviting friends. Nothing is charged and
## nothing is kept: the balance is a number for this session only, the pay button is off, no card details go anywhere.
## The real store needs the payment provider (Stripe on the PC, Google Play Billing in the Android app), the server
## holding the balance, and the codes and referrals checked by the server.

## Coin packs: coins, bonus coins, price (EUR, VAT included), tag.
const PACKS := [
	{"id": "p500", "coins": 500, "bonus": 0, "price": 4.99, "tag": ""},
	{"id": "p1000", "coins": 1000, "bonus": 100, "price": 9.99, "tag": "+10%"},
	{"id": "p2000", "coins": 2000, "bonus": 400, "price": 19.99, "tag": "Most popular"},
	{"id": "p5000", "coins": 5000, "bonus": 1500, "price": 49.99, "tag": "+30%"},
	{"id": "p10000", "coins": 10000, "bonus": 4000, "price": 99.99, "tag": "Best value"},
]

## Coins for racing (earned as well as bought: the user, 2026-11-16).
const EARN := [
	["Finish a race", "25"], ["Podium", "+50"], ["Win", "+100"], ["Clean race (no incidents)", "+20"],
	["First race of the day", "+50"], ["Weekly challenge", "300"], ["Licence promotion", "500"],
]

## What coins buy: the paint and parts of the Paint page (in this preview they all stay free there). Each shows on your
## car: the livery change it makes.
const ITEMS := [
	{"name": "Pearl finish", "price": 400, "kind": "Finish", "change": {"finish": "pearl"}},
	{"name": "Metallic finish", "price": 250, "kind": "Finish", "change": {"finish": "metallic"}},
	{"name": "Matte finish", "price": 250, "kind": "Finish", "change": {"finish": "matte"}},
	{"name": "Chevron", "price": 300, "kind": "Design", "change": {"design": "chevron"}},
	{"name": "Pinstripes", "price": 200, "kind": "Design", "change": {"design": "pinstripe"}},
	{"name": "Split", "price": 200, "kind": "Design", "change": {"design": "split"}},
	{"name": "Centre stripe", "price": 200, "kind": "Design", "change": {"design": "center"}},
	{"name": "Hoop", "price": 150, "kind": "Design", "change": {"design": "hoop"}},
	{"name": "Aero in your second colour", "price": 150, "kind": "Parts", "change": {"aero": "accent"}},
	{"name": "Gold rims", "price": 150, "kind": "Wheels", "change": {"rims": "#c9a227"}},
]

## Promotional codes the preview knows (the real ones live on the server, one use per account).
const CODES := {
	"WELCOME500": {"coins": 500, "what": "500 coins"},
	"CORSAGHOST": {"coins": 1000, "what": "1,000 coins: thanks for racing at launch"},
	"SPA2026": {"coins": 250, "what": "250 coins and the Spa Classic paint"},
}

## The welcome pack: once per account, in its first 7 days.
const WELCOME := {"price": 2.99, "coins": 1500, "days": 7}

const GOLD := Color("f5c542")
const GOLD_DARK := Color("b8860b")

static var _tab := "coins"
## This session's preview balance and what it has unlocked (not saved).
static var preview_coins := 1250
static var _owned := {}
static var _redeemed := {}

## The store's page (the menu's Store tab).
static func build(app: App, rerender: Callable) -> Control:
	var col := UIW.vbox(14)
	var head := UIW.hbox(14)
	head.add_child(UIW.tabs([["coins", I18n.t("Coins")], ["items", I18n.t("Paint & items")], ["offers", I18n.t("Offers")],
		["redeem", I18n.t("Redeem code")], ["invite", I18n.t("Invite friends")]], _tab, func(k): _tab = k; rerender.call(), true))
	col.add_child(head)
	col.add_child(_preview_banner())
	var body: Control
	match _tab:
		"items":
			body = _items(app, rerender)
		"offers":
			body = _offers(app, rerender)
		"redeem":
			body = _redeem(rerender)
		"invite":
			body = _invite()
		_:
			body = _coins(app, rerender)
	var sc := UIW.scroll(body)
	sc.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col.add_child(sc)
	return col

## The balance: a coin and the amount (a button to the store where `on` is given).
static func balance_chip(on: Callable) -> Control:
	var b := Button.new()
	b.focus_mode = Control.FOCUS_ALL if on.is_valid() else Control.FOCUS_NONE
	b.tooltip_text = I18n.t("Coins") + " (" + I18n.t("preview") + ")"
	for st in ["normal", "disabled"]:
		b.add_theme_stylebox_override(st, UIKit.box(Color(0.02, 0.035, 0.08, 0.55), Color(GOLD, 0.55), 1, 4))
	b.add_theme_stylebox_override("hover", UIKit.box(Color(1, 1, 1, 0.12), GOLD, 1, 4))
	b.add_theme_stylebox_override("pressed", UIKit.box(Color(1, 1, 1, 0.22), GOLD, 1, 4))
	var row := UIW.hbox(8)
	row.add_child(Coin.new(11))
	row.add_child(UIKit.label(fmt(preview_coins), 20, UIKit.TEXT, true, 700))
	var m := UIW.margins(row, 10, 4, 12, 4)
	UIW.pass_mouse(m)
	b.add_child(m)
	b.custom_minimum_size = m.get_combined_minimum_size()
	m.resized.connect(func(): b.custom_minimum_size = m.get_combined_minimum_size())
	if on.is_valid():
		b.pressed.connect(on)
	else:
		b.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return b

static func _preview_banner() -> Control:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", UIKit.box(Color(GOLD, 0.12), Color(GOLD, 0.5), 1, 4, Vector2(14, 8)))
	var row := UIW.hbox(10)
	row.add_child(UIW.tag(I18n.t("Preview"), GOLD_DARK))
	var l := UIKit.label(I18n.t("This is how the store will look. Payments are not switched on: nothing is charged, nothing is saved, and no card details go anywhere."), 15, UIKit.SOFT)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(l)
	p.add_child(row)
	return p

# ----------------------------------------------------------------- coins ---

static func _coins(app: App, rerender: Callable) -> Control:
	var col := UIW.vbox(18)
	var grid := GridContainer.new()
	grid.columns = 2 if UIKit.touch() else PACKS.size()
	grid.add_theme_constant_override("h_separation", 14)
	grid.add_theme_constant_override("v_separation", 14)
	for i in PACKS.size():
		grid.add_child(_pack_card(app, PACKS[i], i, rerender))
	col.add_child(grid)
	# earning
	col.add_child(UIW.section(I18n.t("Earn coins by racing")))
	var earn := GridContainer.new()
	earn.columns = 2 if UIKit.touch() else 4
	earn.add_theme_constant_override("h_separation", 10)
	earn.add_theme_constant_override("v_separation", 10)
	for e in EARN:
		var row := UIW.hbox(10)
		var l := UIKit.label(I18n.t(e[0]), 16, UIKit.TEXT)
		l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(l)
		row.add_child(Coin.new(8))
		row.add_child(UIKit.label(e[1], 18, GOLD, true, 700))
		var t := UIW.tile(row)
		t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		earn.add_child(t)
	col.add_child(earn)
	col.add_child(UIW.muted(I18n.t("Coins buy paint, designs and parts for your car. They do not buy speed: every car races on the same terms.")))
	return col

static func _pack_card(app: App, pack: Dictionary, tier: int, rerender: Callable) -> Control:
	var b := UIW.card_button(pack.tag == "Most popular", UIKit.CARD_RADIUS, 16)
	b.custom_minimum_size = Vector2(0, 300 if not UIKit.touch() else 250)
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var c := UIW.vbox(6)
	c.alignment = BoxContainer.ALIGNMENT_CENTER
	var tag_row := UIW.hbox(0)
	tag_row.alignment = BoxContainer.ALIGNMENT_CENTER
	tag_row.custom_minimum_size = Vector2(0, 26)
	if pack.tag != "":
		tag_row.add_child(UIW.tag(I18n.t(pack.tag), UIKit.CRIMSON if pack.tag in ["Most popular", "Best value"] else GOLD_DARK))
	c.add_child(tag_row)
	var stack := CoinStack.new(tier + 1)
	stack.custom_minimum_size = Vector2(120, 90)
	stack.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	c.add_child(stack)
	var amount := UIKit.label(fmt(pack.coins + pack.bonus), 40, UIKit.TEXT, true, 700)
	amount.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	c.add_child(amount)
	var sub := UIKit.label((I18n.t("{n} + {b} bonus", {"n": fmt(pack.coins), "b": fmt(pack.bonus)}) if pack.bonus > 0 else I18n.t("coins")).to_upper(), 14, GOLD if pack.bonus > 0 else UIKit.SOFT, true, 600)
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	c.add_child(sub)
	c.add_child(UIW.spacer())
	var price := PanelContainer.new()
	price.add_theme_stylebox_override("panel", UIKit.box(Color("f2f4f7"), Color(0, 0, 0, 0), 0, 4, Vector2(10, 6)))
	var pl := UIKit.label(money(pack.price), 22, UIKit.INK, true, 700)
	pl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	price.add_child(pl)
	c.add_child(price)
	(b.get_node("content") as Control).add_child(c)
	UIW.pass_mouse(c)
	b.pressed.connect(func(): _checkout(app, I18n.t("{n} coins", {"n": fmt(pack.coins + pack.bonus)}), [
		[I18n.t("{n} coins", {"n": fmt(pack.coins)}), ""],
		[I18n.t("Bonus coins"), "+" + fmt(pack.bonus)] if pack.bonus > 0 else null,
		[I18n.t("First purchase: coins doubled"), "+" + fmt(pack.coins + pack.bonus)] if not _owned.has("first") else null,
	], pack.price, rerender))
	return b

## The checkout: what is bought, the payment method and its fields, the pay button (off in the preview).
static func _checkout(app: App, title: String, lines: Array, price: float, _rerender: Callable) -> void:
	var m := UIW.modal(app.overlay_layer, 620)
	var body: VBoxContainer = m.body
	var close := func(): m.root.queue_free()
	UIW.modal_head(body, I18n.t("Checkout"), close, title)
	body.add_child(_preview_banner())
	# the order
	var order := UIW.vbox(4)
	for ln in lines:
		if ln == null:
			continue
		var r := UIW.hbox(8)
		var l := UIKit.label(ln[0], 17, UIKit.TEXT)
		l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		r.add_child(l)
		r.add_child(UIKit.label(ln[1], 17, GOLD, true, 700))
		order.add_child(r)
	order.add_child(UIW.hair())
	var tot := UIW.hbox(8)
	var tl := UIKit.label(I18n.t("Total").to_upper(), 22, UIKit.TEXT, true, 700)
	tl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	tot.add_child(tl)
	tot.add_child(UIKit.label(money(price), 26, UIKit.TEXT, true, 700))
	order.add_child(tot)
	order.add_child(UIW.muted(I18n.t("VAT included where it applies (shown in your local currency in the real store)."), 13))
	body.add_child(UIW.tile(order, Vector2(16, 12)))
	# the payment method
	body.add_child(UIKit.label(I18n.t("Pay with").to_upper(), 16, UIKit.DIM, true, 600))
	var methods := [["card", I18n.t("Card")], ["paypal", "PayPal"]]
	if OS.has_feature("android"):
		methods = [["play", "Google Play"]]
	elif OS.has_feature("ios"):
		methods = [["apple", "Apple Pay"]]
	else:
		methods.append(["wallet", I18n.t("Google Pay / Apple Pay")])
	var form := UIW.vbox(8)
	var fill_form := func(method: String) -> void:
		for ch in form.get_children():
			ch.queue_free()
		if method == "card":
			form.add_child(_field(I18n.t("Card number"), "1234 1234 1234 1234"))
			var two := UIW.hbox(8)
			two.add_child(_field(I18n.t("Expiry"), "MM / YY"))
			two.add_child(_field(I18n.t("Security code"), "CVC"))
			form.add_child(two)
			form.add_child(_field(I18n.t("Name on card"), ""))
		else:
			form.add_child(UIW.muted(I18n.t("You would finish paying in a {m} window, then come back here.", {"m": method.capitalize() if method != "wallet" else I18n.t("wallet")}), 15))
	body.add_child(UIW.chips(methods[0][0], methods, func(v): fill_form.call(v)))
	fill_form.call(methods[0][0])
	body.add_child(form)
	# pay
	var pay := UIKit.button(I18n.t("Pay {p}", {"p": money(price)}), Callable(), true)
	pay.disabled = true
	pay.custom_minimum_size = Vector2(0, 54)
	pay.tooltip_text = I18n.t("Payments are not switched on in this preview")
	body.add_child(pay)
	var fine := UIW.muted(I18n.t("Coins are a virtual currency for paint and parts in CorsaGhost. They have no cash value and cannot be exchanged, transferred or refunded, except where the law requires. By paying you ask for the coins at once and accept that the 14-day withdrawal right then ends (EU). Payments by Stripe on the PC and by Google Play in the Android app: CorsaGhost never sees your card."), 12)
	fine.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	body.add_child(fine)

static func _field(label: String, placeholder: String) -> Control:
	var c := UIW.vbox(2)
	c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	c.add_child(UIKit.label(label, 13, UIKit.SOFT))
	var le := LineEdit.new()
	le.placeholder_text = placeholder
	le.editable = false
	le.custom_minimum_size = Vector2(0, 44)
	le.tooltip_text = I18n.t("Payments are not switched on in this preview")
	c.add_child(le)
	return c

# ----------------------------------------------------------------- items ---

static func _items(app: App, rerender: Callable) -> Control:
	var col := UIW.vbox(14)
	col.add_child(UIW.muted(I18n.t("Each one shown on your car, in your colours. In this preview everything on the Paint page stays free.")))
	var grid := GridContainer.new()
	grid.columns = 2 if UIKit.touch() else 5
	grid.add_theme_constant_override("h_separation", 12)
	grid.add_theme_constant_override("v_separation", 12)
	var me := _my_car()
	for it in ITEMS:
		grid.add_child(_item_card(app, it, me, rerender))
	col.add_child(grid)
	return col

static func _my_car() -> Dictionary:
	var id: String = str(Settings.data.get("lastCar", ""))
	for c in CarsDb.all():
		if c.id == id:
			return c
	return CarsDb.all()[0]

static func _item_card(app: App, it: Dictionary, car: Dictionary, rerender: Callable) -> Control:
	var owned: bool = _owned.has(it.name)
	var b := UIW.card_button(owned, UIKit.CARD_RADIUS, 10)
	b.custom_minimum_size = Vector2(0, 250)
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var c := UIW.vbox(4)
	var lv: Dictionary = (CarStudio.my_livery() as Dictionary).duplicate()
	lv.merge(it.change, true)
	var pic := CarStudio.picture_rect(car, lv, Vector2(0, 130))
	c.add_child(pic)
	c.add_child(UIW.tag(I18n.t(it.kind), Color(1, 1, 1, 0.5), false))
	var nm := UIKit.label(I18n.t(it.name).to_upper(), 20, UIKit.TEXT, true, 700)
	nm.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	c.add_child(nm)
	c.add_child(UIW.spacer())
	var pr := UIW.hbox(6)
	if owned:
		pr.add_child(UIKit.label(I18n.t("Unlocked").to_upper(), 18, UIKit.GOOD, true, 700))
	else:
		pr.add_child(Coin.new(9))
		pr.add_child(UIKit.label(fmt(it.price), 22, GOLD, true, 700))
	c.add_child(pr)
	(b.get_node("content") as Control).add_child(c)
	UIW.pass_mouse(c)
	if not owned:
		b.pressed.connect(func(): _spend(app, it, rerender))
	return b

## Spending coins: the item, the balance before and after (the preview's own balance: nothing is saved).
static func _spend(app: App, it: Dictionary, rerender: Callable) -> void:
	var m := UIW.modal(app.overlay_layer, 480)
	var body: VBoxContainer = m.body
	var close := func(): m.root.queue_free()
	UIW.modal_head(body, I18n.t(it.name), close, I18n.t("Unlock"))
	var after: int = preview_coins - int(it.price)
	var rows := UIW.vbox(4)
	for r in [[I18n.t("Your coins"), fmt(preview_coins)], [I18n.t("Price"), "−" + fmt(it.price)], [I18n.t("Left after"), fmt(after)]]:
		var row := UIW.hbox(8)
		var l := UIKit.label(r[0], 17, UIKit.TEXT)
		l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(l)
		row.add_child(UIKit.label(r[1], 18, GOLD if r[0] != I18n.t("Left after") or after >= 0 else UIKit.BAD, true, 700))
		rows.add_child(row)
	body.add_child(UIW.tile(rows, Vector2(16, 12)))
	var row := UIW.hbox(10)
	row.alignment = BoxContainer.ALIGNMENT_END
	row.add_child(UIKit.button(I18n.t("Cancel"), close))
	if after >= 0:
		row.add_child(UIKit.button(I18n.t("Unlock for {n} coins", {"n": fmt(it.price)}), func():
			preview_coins = after
			_owned[it.name] = true
			close.call()
			rerender.call(), true))
	else:
		row.add_child(UIKit.button(I18n.t("Get coins"), func(): _tab = "coins"; close.call(); rerender.call(), true))
	body.add_child(row)

# ---------------------------------------------------------------- offers ---

static func _offers(app: App, rerender: Callable) -> Control:
	var row := HFlowContainer.new()
	row.add_theme_constant_override("h_separation", 14)
	row.add_theme_constant_override("v_separation", 14)
	# the welcome pack
	var w := UIW.vbox(8)
	w.add_child(UIW.tag(I18n.t("Welcome offer"), UIKit.CRIMSON))
	w.add_child(UIKit.label(I18n.t("Starter pack").to_upper(), 40, UIKit.TEXT, true, 700))
	for ln in [I18n.t("{n} coins", {"n": fmt(WELCOME.coins)}), I18n.t("Ghost Pearl paint (only in this pack)"), I18n.t("Double XP for 3 days")]:
		var r := UIW.hbox(8)
		r.add_child(UIKit.label("✓", 18, UIKit.GOOD, true, 700))
		r.add_child(UIKit.label(ln, 18, UIKit.TEXT))
		w.add_child(r)
	var t := UIW.hbox(10)
	var was := UIKit.label(money(9.99), 18, UIKit.DIM, true, 600)
	t.add_child(was)
	t.add_child(UIKit.label(money(WELCOME.price), 34, GOLD, true, 700))
	w.add_child(t)
	w.add_child(UIW.muted(I18n.t("Once per account, in your first {d} days · {left} left", {"d": WELCOME.days, "left": I18n.t("6 days")}), 14))
	w.add_child(UIKit.button(I18n.t("Get the starter pack"), func(): _checkout(app, I18n.t("Starter pack"), [
		[I18n.t("{n} coins", {"n": fmt(WELCOME.coins)}), ""], [I18n.t("Ghost Pearl paint"), ""], [I18n.t("Double XP, 3 days"), ""]], WELCOME.price, rerender), true))
	var wt := UIW.tile(w, Vector2(22, 18))
	wt.custom_minimum_size = Vector2(440, 0)
	row.add_child(wt)
	# first purchase and weekly deal
	var side := UIW.vbox(14)
	var f := UIW.vbox(6)
	f.add_child(UIW.tag(I18n.t("First purchase"), GOLD_DARK))
	f.add_child(UIKit.label(I18n.t("Double coins").to_upper(), 30, UIKit.TEXT, true, 700))
	f.add_child(UIW.muted(I18n.t("Your first coin pack of any size comes with as many coins again."), 15))
	side.add_child(UIW.tile(f, Vector2(18, 14)))
	var d := UIW.vbox(6)
	d.add_child(UIW.tag(I18n.t("This week"), Color(1, 1, 1, 0.5), false))
	d.add_child(UIKit.label(I18n.t("Hoop + gold rims").to_upper(), 30, UIKit.TEXT, true, 700))
	var dr := UIW.hbox(8)
	dr.add_child(UIKit.label(fmt(300), 18, UIKit.DIM, true, 600))
	dr.add_child(Coin.new(9))
	dr.add_child(UIKit.label(fmt(210), 24, GOLD, true, 700))
	dr.add_child(UIW.tag("−30%", UIKit.CRIMSON))
	d.add_child(dr)
	d.add_child(UIW.muted(I18n.t("Changes every Monday."), 14))
	side.add_child(UIW.tile(d, Vector2(18, 14)))
	side.custom_minimum_size = Vector2(380, 0)
	row.add_child(side)
	return row

# ---------------------------------------------------------------- redeem ---

static func _redeem(rerender: Callable) -> Control:
	var col := UIW.vbox(12)
	col.custom_minimum_size = Vector2(minf(640.0, 600.0), 0)
	col.add_child(UIKit.label(I18n.t("Promotional code").to_upper(), 30, UIKit.TEXT, true, 700))
	col.add_child(UIW.muted(I18n.t("Codes come from events, partners, streams and the newsletter. One use per account; capitals or not, it is the same code.")))
	var row := UIW.hbox(10)
	var le := LineEdit.new()
	le.max_length = 20
	le.placeholder_text = "XXXX-XXXX"
	le.custom_minimum_size = Vector2(320, 52)
	le.add_theme_font_override("font", UIKit.font(true, 600))
	le.add_theme_font_size_override("font_size", 26)
	le.text_changed.connect(func(tx): le.text = tx.to_upper(); le.caret_column = le.text.length())
	row.add_child(le)
	var msg := UIKit.label("", 17, UIKit.TEXT)
	msg.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	var go := func() -> void:
		var code := le.text.strip_edges().replace(" ", "").to_upper()
		if code == "":
			return
		if _redeemed.has(code):
			msg.text = I18n.t("You have used this code already.")
			msg.add_theme_color_override("font_color", UIKit.BAD)
		elif CODES.has(code):
			_redeemed[code] = true
			preview_coins += int(CODES[code].coins)
			msg.text = I18n.t("Redeemed: {what}. (Preview: only this session's balance.)", {"what": I18n.t(CODES[code].what)})
			msg.add_theme_color_override("font_color", UIKit.GOOD)
			rerender.call_deferred()
		else:
			msg.text = I18n.t("That code is not valid or has expired.")
			msg.add_theme_color_override("font_color", UIKit.BAD)
	le.text_submitted.connect(func(_t): go.call())
	row.add_child(UIKit.button(I18n.t("Redeem"), go, true))
	col.add_child(row)
	col.add_child(msg)
	col.add_child(UIW.muted(I18n.t("Try the preview's codes: WELCOME500, CORSAGHOST, SPA2026."), 14))
	return col

# ---------------------------------------------------------------- invite ---

## Your invite code: from your driver name, the same every time.
static func invite_code() -> String:
	var who: String = Settings.data.get("nickname", "driver")
	var alphabet := "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	var h := absi(hash(who + "|corsaghost"))
	var s := ""
	for i in 5:
		s += alphabet[h % alphabet.length()]
		h /= alphabet.length()
	return "CG-" + s

static func _invite() -> Control:
	var row := HFlowContainer.new()
	row.add_theme_constant_override("h_separation", 14)
	row.add_theme_constant_override("v_separation", 14)
	var code := invite_code()
	var link := "https://corsaghost.com/invite/" + code
	var a := UIW.vbox(10)
	a.add_child(UIKit.label(I18n.t("Invite friends").to_upper(), 36, UIKit.TEXT, true, 700))
	a.add_child(UIW.muted(I18n.t("They get coins to start with, you get coins when they race.")))
	a.add_child(UIKit.label(I18n.t("Your code").to_upper(), 14, UIKit.DIM, true, 600))
	var cr := UIW.hbox(10)
	var cl := UIKit.label(code, 44, GOLD, true, 700)
	cr.add_child(cl)
	cr.add_child(UIKit.button(I18n.t("Copy code"), func(): DisplayServer.clipboard_set(code)))
	a.add_child(cr)
	var lr := UIW.hbox(10)
	var ll := UIKit.label(link, 16, UIKit.SOFT)
	ll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	lr.add_child(ll)
	lr.add_child(UIKit.button(I18n.t("Copy link"), func(): DisplayServer.clipboard_set(link)))
	a.add_child(lr)
	var at := UIW.tile(a, Vector2(22, 18))
	at.custom_minimum_size = Vector2(520, 0)
	row.add_child(at)
	var b := UIW.vbox(8)
	b.add_child(UIKit.label(I18n.t("Rewards").to_upper(), 24, UIKit.TEXT, true, 700))
	for r in [
		[I18n.t("Your friend signs up with your code"), I18n.t("they get {n}", {"n": "300"})],
		[I18n.t("They finish 3 races"), I18n.t("you get {n}", {"n": "500"})],
		[I18n.t("3 friends racing"), I18n.t("Founder paint")],
		[I18n.t("5 friends racing"), I18n.t("+{n} coins", {"n": "2,000"})],
		[I18n.t("10 friends racing"), I18n.t("Recruiter title")],
	]:
		var rr := UIW.hbox(8)
		var l := UIKit.label(r[0], 16, UIKit.TEXT)
		l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		rr.add_child(l)
		rr.add_child(UIKit.label(r[1], 16, GOLD, true, 700))
		b.add_child(rr)
		b.add_child(UIW.hair())
	b.add_child(UIW.muted(I18n.t("Friends racing: {n} of 3", {"n": 0}), 15))
	var bar := ProgressBar.new()
	bar.max_value = 3
	bar.value = 0
	bar.show_percentage = false
	bar.custom_minimum_size = Vector2(0, 10)
	b.add_child(bar)
	var bt := UIW.tile(b, Vector2(22, 18))
	bt.custom_minimum_size = Vector2(440, 0)
	row.add_child(bt)
	return row

# ----------------------------------------------------------------- bits ---

## 12500 -> "12,500".
static func fmt(n: int) -> String:
	var s := str(absi(n))
	var out := ""
	while s.length() > 3:
		out = "," + s.substr(s.length() - 3) + out
		s = s.substr(0, s.length() - 3)
	return ("-" if n < 0 else "") + s + out

static func money(eur: float) -> String:
	return "€%.2f" % eur

## A gold coin with a C cut into it.
class Coin:
	extends Control
	var r: float
	func _init(radius: float) -> void:
		r = radius
		custom_minimum_size = Vector2(radius * 2.0 + 2.0, radius * 2.0 + 2.0)
		size_flags_vertical = Control.SIZE_SHRINK_CENTER
		mouse_filter = Control.MOUSE_FILTER_IGNORE
	func _draw() -> void:
		var c := size * 0.5
		draw_circle(c + Vector2(0, r * 0.12), r, StoreScreen.GOLD_DARK)
		draw_circle(c, r, StoreScreen.GOLD)
		draw_arc(c, r * 0.72, 0.0, TAU, 32, Color(StoreScreen.GOLD_DARK, 0.8), maxf(1.0, r * 0.12), true)
		draw_arc(c, r * 0.36, deg_to_rad(40), deg_to_rad(320), 16, StoreScreen.GOLD_DARK, maxf(1.5, r * 0.2), true)

## A stack of coins, taller for the bigger packs.
class CoinStack:
	extends Control
	var n: int
	func _init(tier: int) -> void:
		n = tier
		mouse_filter = Control.MOUSE_FILTER_IGNORE
	func _draw() -> void:
		var r := minf(size.x, size.y) * 0.3
		var piles := clampi(n, 1, 3)
		var per: int = [2, 4, 5, 7, 9][clampi(n - 1, 0, 4)]
		for p in piles:
			var x := size.x * 0.5 + (p - (piles - 1) * 0.5) * r * 1.3
			var count: int = per - p * 2 if p > 0 else per
			for i in maxi(1, count):
				var y := size.y - r * 0.6 - i * r * 0.28
				draw_set_transform(Vector2(x, y), 0.0, Vector2(1.0, 0.42))
				draw_circle(Vector2(0, r * 0.3), r, StoreScreen.GOLD_DARK)
				draw_circle(Vector2.ZERO, r, StoreScreen.GOLD)
				draw_arc(Vector2.ZERO, r * 0.74, 0.0, TAU, 28, Color(StoreScreen.GOLD_DARK, 0.7), 2.0, true)
		draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
