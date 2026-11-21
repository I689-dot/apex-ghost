class_name MobilePass
extends RefCounted
## The season pass (after RESOURCES/UI-MOBILE-REFERENCE): the season's tiers along a horizontal track, the free reward
## of each above and the premium one below; a tier is reached with pass XP (every offline session, contracts, chests,
## the free bonus); a reached reward is claimed by tapping it. The premium track is a preview: unlocking it would be a
## purchase (the store's checkout preview), so its rewards stay locked.

static func show(app: App) -> void:
	app.screen = "m_pass"
	app.back_to = func() -> void: app.show_menu()
	app.set_backdrop("straight", "spa")
	var holder := Control.new()
	UIKit.full(holder)
	var shade := ColorRect.new()
	shade.color = Color(0.0, 0.01, 0.03, 0.66)
	UIKit.full(shade)
	holder.add_child(shade)
	var top := UIW.top_bar({"title": I18n.t("Season pass"), "back": func() -> void: app.show_menu(),
		"right": [MobileUI.badge(I18n.t("Season ends in {t}", {"t": Progression.fmt_left(Progression.pass_season_left_s())}), Color(0, 0, 0, 0.7), UIKit.TEXT, "clock")]})
	var col := UIW.vbox(14)
	# the headline: the tier, the XP to the next, the premium offer
	var head := UIW.hbox(20)
	var hl := UIW.vbox(4)
	hl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	hl.add_child(UIKit.label(I18n.t("Tier {n}", {"n": Progression.pass_tier()}).to_upper(), 52, UIKit.TEXT, true, 800))
	var xr := UIW.hbox(8)
	xr.add_child(MobileUI.Icon.make("star", 22, MobileUI.GOLD))
	xr.add_child(UIKit.label("%d / %d XP" % [Progression.pass_into(), Progression.PASS_TIER_XP], 20, UIKit.TEXT, true, 700))
	hl.add_child(xr)
	var bar := MobileUI.bar(Progression.pass_into() / float(Progression.PASS_TIER_XP), MobileUI.GOLD, 8)
	bar.custom_minimum_size = Vector2(420, 8)
	hl.add_child(bar)
	head.add_child(hl)
	var premium := bool(Progression.data().passPremium)
	var prem := PanelContainer.new()
	prem.add_theme_stylebox_override("panel", UIKit.box(Color(MobileUI.PURPLE, 0.85), Color(1, 1, 1, 0.3), 1, 8, Vector2(18, 12)))
	var pc := UIW.vbox(6)
	pc.add_child(UIKit.label(I18n.t("Premium pass").to_upper(), 26, Color.WHITE, true, 800))
	for line: String in [I18n.t("Twice the credits on every tier"), I18n.t("Exclusive paint designs"), I18n.t("Coins on the last tiers")]:
		var r := UIW.hbox(6)
		r.add_child(MobileUI.Icon.make("star", 14, MobileUI.GOLD))
		r.add_child(UIKit.label(line, 15, Color.WHITE))
		pc.add_child(r)
	if premium:
		pc.add_child(UIKit.label(I18n.t("Unlocked"), 18, UIKit.GOOD, true, 700))
	else:
		pc.add_child(UIKit.button(I18n.t("Unlock · {p}", {"p": StoreScreen.money(9.99)}), func() -> void:
			StoreScreen._checkout(app, I18n.t("Premium pass"), [I18n.t("This season's premium track"), I18n.t("Rewards of the tiers already reached at once")], 9.99, func() -> void: pass), true))
	prem.add_child(pc)
	head.add_child(prem)
	col.add_child(head)

	# the track: a column per tier, free above, premium below
	var track := UIW.hbox(8)
	var tier := Progression.pass_tier()
	for t in range(1, Progression.PASS_TIERS + 1):
		var c := UIW.vbox(6)
		var num := UIKit.label(str(t), 18, MobileUI.GOLD if t <= tier else UIKit.SOFT, true, 700)
		num.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		c.add_child(num)
		c.add_child(_reward(app, t, false))
		c.add_child(_reward(app, t, true))
		track.add_child(c)
	track.custom_minimum_size = Vector2(0, 290)
	var sc := UIW.hscroll(track)
	sc.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col.add_child(sc)
	col.add_child(UIW.muted(I18n.t("Pass XP from every offline race, the contracts, the chests and the free bonus."), 15))
	var scr := UIW.screen(top, UIW.margins(col, 22, 14, 22, 18))
	UIKit.full(scr)
	holder.add_child(scr)
	app.set_ui(holder)
	# scroll to the current tier
	sc.set_deferred("scroll_horizontal", maxi(0, (tier - 2) * 140))

static func _reward(app: App, t: int, premium: bool) -> Control:
	var rw := Progression.pass_reward(t, premium)
	var claimable := Progression.pass_claimable(t, premium)
	var claimed := Progression.pass_claimed(t, premium)
	var reached := t <= Progression.pass_tier()
	var b := Button.new()
	b.focus_mode = Control.FOCUS_ALL
	b.custom_minimum_size = Vector2(132, 120)
	var bg := Color(MobileUI.PURPLE, 0.55) if premium else Color(0, 0, 0, 0.6)
	var border := MobileUI.GOLD if claimable else Color(1, 1, 1, 0.14)
	for st: String in ["normal", "hover", "pressed"]:
		b.add_theme_stylebox_override(st, UIKit.box(bg.lightened(0.08 if st != "normal" else 0.0), border, 2 if claimable else 1, 6))
	var col := UIW.vbox(4)
	col.alignment = BoxContainer.ALIGNMENT_CENTER
	col.mouse_filter = Control.MOUSE_FILTER_IGNORE
	UIKit.full(col)
	var ic := CenterContainer.new()
	ic.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var kind: String = {"credits": "credit", "coins": "coin", "paint": "brush"}.get(rw[0], "gift")
	ic.add_child(MobileUI.Icon.make(kind, 38, MobileUI.GOLD if reached else Color(1, 1, 1, 0.4)))
	col.add_child(ic)
	var l := UIKit.label(Progression.reward_text(rw), 14, UIKit.TEXT, true, 600)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	col.add_child(l)
	var state := ""
	if claimed:
		state = I18n.t("Claimed")
	elif claimable:
		state = I18n.t("Claim")
	elif premium and not bool(Progression.data().passPremium):
		state = I18n.t("Premium")
	else:
		state = I18n.t("Tier {n}", {"n": t})
	var sl := UIKit.label(state.to_upper(), 13, UIKit.GOOD if claimed else (MobileUI.GOLD if claimable else UIKit.SOFT), true, 700)
	sl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(sl)
	b.add_child(col)
	if premium and not bool(Progression.data().passPremium):
		var lk := MobileUI.Icon.make("lock", 18, Color(1, 1, 1, 0.7))
		lk.position = Vector2(8, 8)
		b.add_child(lk)
	b.pressed.connect(func() -> void:
		if not claimable:
			return
		var got := Progression.claim_pass(t, premium)
		if not got.is_empty():
			show(app)
			MobileUI.reward_popup(app, I18n.t("Tier {n} reward", {"n": t}), [Progression.reward_text(got)]))
	return b
