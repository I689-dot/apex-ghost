class_name MobileNews
extends RefCounted
## What's new (docs/prompts/mobile-f2p-pass.md 37; references 055, 095): the game's recent changes as dated cards, newest
## first, from the home's top-right icon; its red dot until the newest has been seen (Settings "newsSeen").

## [date, title, text], newest first.
const NEWS := [
	["2026-11-24", "Your garage", "Cars now unlock with credits or blueprints. Collect blueprints from chests, goals and the free bonus, or try a locked car for one race."],
	["2026-11-24", "Career rivals and upgrades", "Every cup has a rival to beat in its last race. Upgrade your car's parts for the career: online races stay equal."],
	["2026-11-24", "Daily goals and login rewards", "Five goals a day, three a week and a reward every day you race: the seventh day is the big one."],
	["2026-11-24", "The new store", "Daily, weekly and monthly deals, free packs and the ad relay, and the VIP membership."],
	["2026-11-23", "Tyre smoke and 3D clouds", "Wheelspin and slides now smoke, gravel throws dust, and the sky has real clouds on High and Ultra."],
]

static func unseen() -> bool:
	return str(Settings.data.get("newsSeen", "")) < str(NEWS[0][0])

static func show(app: App, on_close: Callable) -> void:
	Settings.data.newsSeen = str(NEWS[0][0])
	Settings.save()
	var m := UIW.modal(app.overlay_layer, 880, true)
	var b: VBoxContainer = m.body
	UIW.modal_head(b, I18n.t("What's new"), func() -> void: m.root.queue_free(); on_close.call())
	for n: Array in NEWS:
		var p := PanelContainer.new()
		p.add_theme_stylebox_override("panel", UIKit.box(MobileUI.GLASS, Color(1, 1, 1, 0.12), 1, 6, Vector2(14, 10)))
		var col := UIW.vbox(4)
		var head := UIW.hbox(10)
		var t := UIKit.label(I18n.t(n[1]).to_upper(), 20, UIKit.TEXT, true, 800)
		t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		head.add_child(t)
		head.add_child(MobileUI.badge(str(n[0]), Color(0, 0, 0, 0.6)))
		col.add_child(head)
		var l := UIKit.label(I18n.t(n[2]), 16, UIKit.SOFT)
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		col.add_child(l)
		p.add_child(col)
		b.add_child(p)
