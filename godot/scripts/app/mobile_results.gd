class_name MobileResults
extends RefCounted
## The phone's results after an offline race (docs/prompts/mobile-f2p-pass.md 18; references 032, 044, 084): YOU WIN!
## or your place across the top with the race's objective; the podium and your own row as driver cards (place, name,
## car, its rarity, time or gap); then NEXT to the rewards (MobileHome.race_rewards: the breakdown, ×2 by an ad, the
## pass and goals). Practice and qualifying keep the full results page (ResultsScreen).

## boss: the race's rival ("" for none; the race's event is already scored and cleared when this shows).
static func show(app: App, m: Dictionary, me: String, boss: String, next: Callable) -> void:
	app.screen = "m_results"
	var rows: Array = m.get("rows", [])
	var mine: Dictionary = {}
	for r: Dictionary in rows:
		if r.id == me:
			mine = r
	var root := Control.new()
	UIKit.full(root)
	var shade := ColorRect.new()
	shade.color = Color(0.03, 0.0, 0.05, 0.7)
	UIKit.full(shade)
	root.add_child(shade)
	var pos := int(mine.get("position", 0)) if not mine.is_empty() and not bool(mine.get("dnf", false)) else 0
	# the header: the verdict on a green or dark band
	var head := PanelContainer.new()
	head.add_theme_stylebox_override("panel", UIKit.box(Color(0.1, 0.6, 0.3, 0.95) if pos == 1 else Color(0, 0, 0, 0.7), Color(0, 0, 0, 0), 0, 0, Vector2(30, 10)))
	head.set_anchors_preset(Control.PRESET_TOP_WIDE)
	head.anchor_left = 0.48
	head.offset_top = 30
	var hrow := UIW.hbox(18)
	var verdict := I18n.t("You win!") if pos == 1 else (I18n.t("P{n}", {"n": pos}) if pos > 0 else I18n.t("Did not finish"))
	var vl := UIKit.label(verdict.to_upper(), 46, Color.WHITE, true, 800)
	vl.add_theme_font_override("font", UIKit.font(true, 800, true))
	hrow.add_child(vl)
	var sub := UIW.vbox(0)
	if boss != "":
		sub.add_child(UIKit.label(I18n.t("Beat {n}", {"n": boss}).to_upper(), 15, Color.WHITE, true, 700))
	sub.add_child(UIKit.label(I18n.t("Your position: {n}", {"n": pos}).to_upper() if pos > 0 else "", 15, Color.WHITE, true, 700))
	hrow.add_child(sub)
	head.add_child(hrow)
	root.add_child(head)
	# the driver cards: the podium, then you if you are not on it
	var cards := UIW.vbox(10)
	cards.position = Vector2(40, 40)
	var shown := 0
	for r: Dictionary in rows:
		if int(r.get("position", 0)) <= 3 or r.id == me:
			cards.add_child(_driver_card(r, r.id == me, rows))
			shown += 1
		if shown >= 4:
			break
	root.add_child(cards)
	var go := MobileUI.main_button(I18n.t("Next"), func() -> void: next.call())
	var gh := Control.new()
	gh.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	gh.mouse_filter = Control.MOUSE_FILTER_IGNORE
	gh.add_child(go)
	go.position = Vector2(-280, -96)
	root.add_child(gh)
	app.set_ui(root)
	go.grab_focus.call_deferred()

## A driver's card: place, name, time or gap; their car's name, rarity and rating.
static func _driver_card(r: Dictionary, me: bool, rows: Array) -> Control:
	var p := PanelContainer.new()
	p.custom_minimum_size = Vector2(620, 0)
	p.add_theme_stylebox_override("panel", UIKit.box(Color(1, 1, 1, 0.16) if me else Color(0, 0, 0, 0.55), MobileUI.MAIN if me else Color(1, 1, 1, 0.12), 2 if me else 1, 6, Vector2(12, 8)))
	var row := UIW.hbox(14)
	var place := PanelContainer.new()
	place.add_theme_stylebox_override("panel", UIKit.box(MobileUI.MAIN if int(r.get("position", 0)) == 1 else Color(0.2, 0.22, 0.28), Color(0, 0, 0, 0), 0, 4, Vector2(12, 2)))
	place.add_child(UIKit.label(str(int(r.get("position", 0))) if not bool(r.get("dnf", false)) else "—", 34, UIKit.INK if int(r.get("position", 0)) == 1 else Color.WHITE, true, 800))
	row.add_child(place)
	var col := UIW.vbox(2)
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	col.add_child(UIKit.label((I18n.t("You") if me else str(r.get("nick", ""))).to_upper(), 22, UIKit.TEXT, true, 800))
	var car := CarsDb.resolve(str(r.get("carId", "")))
	var crow := UIW.hbox(8)
	crow.add_child(UIKit.label(str(car.get("name", "")).to_upper(), 15, UIKit.SOFT, true, 600))
	if not car.is_empty():
		crow.add_child(MobileUI.rarity_tag(str(car.id), Garage.stars(str(car.id)) if me else -1))
		crow.add_child(UIKit.label(I18n.t("{n} PR", {"n": int(Garage.stats(car).pr) + (Garage.upgrade_pr(str(car.id)) if me else 0)}), 15, UIKit.TEXT, true, 700))
	col.add_child(crow)
	row.add_child(col)
	var t := ""
	if bool(r.get("dnf", false)):
		t = I18n.t("DNF")
	elif int(r.get("position", 0)) == 1 and r.get("totalMs") != null:
		t = UIKit.fmt_lap(float(r.totalMs))
	elif r.get("gapMs") != null:
		t = "+" + UIKit.fmt_lap(float(r.gapMs))
	row.add_child(UIKit.label(t, 22, UIKit.TEXT, true, 700))
	p.add_child(row)
	return p
