class_name SettingsPages
extends RefCounted
## The settings' Account tab (the user, 2026-11-16: presets and account settings in a proper menu, after F1, Assetto
## Corsa EVO and Le Mans Ultimate):
##   Account: your driver card (licence, Safety Rating, rank), the driver profile, a new password, signing out, deleting
##            the account
##   Presets: every setting saved under a name and loaded again (this device), and ready-made starting points for a
##            keyboard, a controller or a wheel
## and the assist levels at the top of the Driving page (F1's Casual / Standard / Expert).

## One click for the assists and aids (F1's levels; "Custom" whenever they differ).
const ASSIST_LEVELS := {
	"casual": {"assists": {"abs": true, "tc": 2, "stability": true, "steering": true}, "manualGearbox": false, "racingLine": "full"},
	"standard": {"assists": {"abs": true, "tc": 1, "stability": false, "steering": false}, "manualGearbox": false, "racingLine": "corners"},
	"expert": {"assists": {"abs": true, "tc": 0, "stability": false, "steering": false}, "manualGearbox": true, "racingLine": "off"},
}

## Ready-made starting points: they set what fits the device and leave the rest as it is.
const STARTERS := [
	["Keyboard · first laps", "Full assists, the racing line, the chase camera.",
		{"assists": {"abs": true, "tc": 2, "stability": true, "steering": true}, "manualGearbox": false, "racingLine": "full", "camera": "chase"}],
	["Controller · racing", "ABS and some traction control, braking zones shown, the chase camera.",
		{"assists": {"abs": true, "tc": 1, "stability": false, "steering": false}, "manualGearbox": false, "racingLine": "corners", "camera": "chase"}],
	["Wheel · sim", "As the real car (ABS and traction control on their lowest), manual gears, no line, the cockpit.",
		{"assists": {"abs": true, "tc": 0, "stability": false, "steering": false}, "manualGearbox": true, "racingLine": "off", "camera": "cockpit"}],
]

## What a saved preset leaves out: who you are, your car and its paint, your saved car setups and the presets themselves.
const NOT_IN_PRESETS := ["profiles", "nickname", "livery", "lastCar", "savedSetups", "carSetup", "introSeen", "lastTrack"]

# ---------------------------------------------------------------- assists ---

static func assist_level() -> String:
	var S: Dictionary = Settings.data
	for k in ASSIST_LEVELS:
		var l: Dictionary = ASSIST_LEVELS[k]
		if l.assists == S.assists and l.manualGearbox == S.manualGearbox and l.racingLine == S.racingLine:
			return k
	return "custom"

static func apply_assist_level(k: String) -> void:
	if not ASSIST_LEVELS.has(k):
		return
	var l: Dictionary = ASSIST_LEVELS[k]
	Settings.data.assists = (l.assists as Dictionary).duplicate()
	Settings.data.manualGearbox = l.manualGearbox
	Settings.data.racingLine = l.racingLine

## The assist level row (the Driving page's first): pressing a level sets them all and redraws the page.
static func assist_row(changed: Callable, refresh: Callable) -> Control:
	var opts := [["casual", I18n.t("Casual")], ["standard", I18n.t("Standard")], ["expert", I18n.t("Expert")]]
	var cur := assist_level()
	if cur == "custom":
		opts.append(["custom", I18n.t("Custom")])
	var c := UIW.chips(cur, opts, func(v):
		if v == "custom":
			return
		apply_assist_level(v)
		changed.call()
		refresh.call())
	# side by side (a row's control shrinks to its narrowest: the chips stacked one per line)
	c.custom_minimum_size = Vector2(130.0 * opts.size(), 0)
	return c

# ---------------------------------------------------------------- presets ---

static func profiles() -> Dictionary:
	if not Settings.data.has("profiles") or typeof(Settings.data.profiles) != TYPE_DICTIONARY:
		Settings.data["profiles"] = {}
	return Settings.data.profiles

static func snapshot() -> Dictionary:
	var out := {}
	for k in Settings.data:
		if not NOT_IN_PRESETS.has(k):
			out[k] = Settings.data[k].duplicate(true) if Settings.data[k] is Dictionary or Settings.data[k] is Array else Settings.data[k]
	return out

static func load_profile(p: Dictionary) -> void:
	for k in p:
		if NOT_IN_PRESETS.has(k):
			continue
		Settings.data[k] = p[k].duplicate(true) if p[k] is Dictionary or p[k] is Array else p[k]

static func presets(col: Control, app: App, changed: Callable, refresh: Callable) -> void:
	SettingsPanel._head(col, I18n.t("Your presets"))
	var name_box := LineEdit.new()
	name_box.max_length = 24
	name_box.placeholder_text = I18n.t("Name, e.g. Wheel · night races")
	name_box.custom_minimum_size = Vector2(320, 0)
	var save := func() -> void:
		var n := name_box.text.strip_edges()
		if n == "":
			name_box.grab_focus()
			return
		profiles()[n] = snapshot()
		changed.call()
		app.toast(I18n.t("Saved: {n}", {"n": n}))
		refresh.call()
	name_box.text_submitted.connect(func(_t): save.call())
	var save_row := UIW.hbox(8)
	save_row.add_child(name_box)
	save_row.add_child(UIKit.button(I18n.t("Save current settings"), save, true))
	col.add_child(SettingsPanel._row(I18n.t("New preset"), save_row, I18n.t("Everything in the settings: graphics, view, assists, HUD, audio, keys and devices. Not your car or its paint.")))
	var names: Array = profiles().keys()
	names.sort()
	if names.is_empty():
		col.add_child(UIW.margins(UIW.muted(I18n.t("No presets yet: set things up as you like them and save them here."), 15), 10, 8, 0, 8))
	for n in names:
		var r := UIW.hbox(8)
		var nn: String = n
		r.add_child(UIKit.button(I18n.t("Load"), func():
			load_profile(profiles()[nn])
			changed.call()
			app.toast(I18n.t("Loaded: {n}", {"n": nn}))
			refresh.call(), true))
		r.add_child(UIKit.button(I18n.t("Update"), func():
			profiles()[nn] = snapshot()
			changed.call()
			app.toast(I18n.t("Saved: {n}", {"n": nn}))))
		r.add_child(UIKit.button(I18n.t("Delete"), func():
			profiles().erase(nn)
			changed.call()
			refresh.call()))
		col.add_child(SettingsPanel._row(nn, r))
	SettingsPanel._head(col, I18n.t("Starting points"))
	for st in STARTERS:
		var s: Array = st
		col.add_child(SettingsPanel._row(I18n.t(s[0]), UIKit.button(I18n.t("Use"), func():
			load_profile(s[2])
			changed.call()
			app.toast(I18n.t("Set: {n}", {"n": I18n.t(s[0])}))
			refresh.call()), I18n.t(s[1])))
	SettingsPanel._head(col, I18n.t("Graphics"))
	col.add_child(UIW.margins(UIW.muted(I18n.t("The graphics presets (Low to Ultra) are on Graphics › Quality."), 15), 10, 8, 0, 8))

# ---------------------------------------------------------------- account ---

static func account(col: Control, app: App, changed: Callable, refresh: Callable) -> void:
	var a = Account.account()
	if a == null:
		SettingsPanel._head(col, I18n.t("Account"))
		col.add_child(UIW.margins(UIW.muted(I18n.t("You are playing offline: no account is signed in."), 15), 10, 8, 0, 8))
		SettingsPanel._buttons(col, [UIKit.button(I18n.t("Connect again"), func():
			var close: Callable = app.overlay_layer.get_children().filter(func(c): return c.has_meta("close")).back().get_meta("close")
			close.call()
			app.offline = false
			app.show_start(), true)])
		return
	var u: Dictionary = a.user
	var career := CareerData.load_career()
	var lv: int = CareerData.level_of(career.xp).level
	var rk := CareerData.rank_of(lv)
	# the driver card
	var card := UIW.hbox(18)
	var who := UIW.vbox(2)
	who.add_child(UIKit.label(str(u.nick).to_upper(), 40, UIKit.TEXT, true, 700))
	var line := UIW.hbox(8)
	line.add_child(UIW.tag("%s %.2f" % [career.licence, career.sr], Color(CareerData.LICENCE_COLOUR[career.licence])))
	line.add_child(UIKit.label("%s · %s" % [I18n.t(rk.name).to_upper(), I18n.t("Lv {n}", {"n": lv})], 16, rk.colour, true, 600))
	if u.get("abbr"):
		line.add_child(UIW.tag(str(u.abbr), Color(1, 1, 1, 0.5), false))
	if u.get("country"):
		line.add_child(UIKit.label(str(u.country), 16, UIKit.SOFT, true, 600))
	who.add_child(line)
	card.add_child(who)
	col.add_child(UIW.margins(card, 10, 6, 0, 10))
	SettingsPanel._head(col, I18n.t("Driver profile"))
	col.add_child(SettingsPanel._row(I18n.t("Flag, number, code, helmet"), UIKit.button(I18n.t("Edit"), func(): SocialUI.profile_modal(app, refresh)), I18n.t("How you appear on the timing screens.")))
	SettingsPanel._head(col, I18n.t("Sign-in"))
	col.add_child(SettingsPanel._row(I18n.t("Password"), UIKit.button(I18n.t("Change"), func(): _password_modal(app)), I18n.t("Your other devices are signed out when it changes.")))
	col.add_child(SettingsPanel._row(I18n.t("Sign out"), UIKit.button(I18n.t("Sign out"), func():
		var close: Callable = app.overlay_layer.get_children().filter(func(c): return c.has_meta("close")).back().get_meta("close")
		close.call()
		await Account.logout()
		app.show_start()), I18n.t("Back to the sign-in screen.")))
	SettingsPanel._head(col, I18n.t("Privacy"))
	var S: Dictionary = Settings.data
	if not S.has("privacy"):
		S["privacy"] = {"showOnline": true}
	SettingsPanel._toggle(col, I18n.t("Show friends where I am"), I18n.t("Off: you appear offline to your friends (menu, lobby or racing)."), S.privacy, "showOnline", changed)
	SettingsPanel._head(col, I18n.t("Delete account"))
	col.add_child(SettingsPanel._row(I18n.t("Delete my account"), UIKit.button(I18n.t("Delete…"), func(): _delete_modal(app)), I18n.t("Your account, laps, results and friends are deleted for good.")))

static func _password_modal(app: App) -> void:
	var m := UIW.modal(app.overlay_layer, 460)
	var body: VBoxContainer = m.body
	var close := func(): m.root.queue_free()
	UIW.modal_head(body, I18n.t("New password"), close)
	var old := LineEdit.new()
	old.secret = true
	old.max_length = 72
	var nw := LineEdit.new()
	nw.secret = true
	nw.max_length = 72
	var again := LineEdit.new()
	again.secret = true
	again.max_length = 72
	body.add_child(UIW.field(I18n.t("Current password"), old))
	body.add_child(UIW.field(I18n.t("New password") + "  (" + I18n.t("4 to 72 characters") + ")", nw))
	body.add_child(UIW.field(I18n.t("New password again"), again))
	var err := UIKit.label("", 15, UIKit.BAD)
	err.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	body.add_child(err)
	var go := UIKit.button(I18n.t("Change password"), Callable(), true)
	go.pressed.connect(func():
		if nw.text != again.text:
			err.text = I18n.t("The new passwords are not the same.")
			return
		go.disabled = true
		var r: Dictionary = await Account.change_password(old.text, nw.text)
		if not is_instance_valid(go):
			return
		go.disabled = false
		if r.ok:
			close.call()
			app.toast(I18n.t("Password changed"))
		else:
			err.text = I18n.t(str(r.error)))
	body.add_child(go)
	old.grab_focus.call_deferred()

static func _delete_modal(app: App) -> void:
	var m := UIW.modal(app.overlay_layer, 480)
	var body: VBoxContainer = m.body
	var close := func(): m.root.queue_free()
	UIW.modal_head(body, I18n.t("Delete account"), close, str(Account.account().user.nick))
	var t := UIW.muted(I18n.t("Your account, your laps and results on the leaderboards and your friends list are deleted from the server for good. This cannot be undone."))
	t.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	body.add_child(t)
	var pw := LineEdit.new()
	pw.secret = true
	pw.max_length = 72
	body.add_child(UIW.field(I18n.t("Your password"), pw))
	var sure := UIW.row(I18n.t("I understand it cannot be undone"), UIW.switch(false, func(_on): pass))
	body.add_child(sure)
	var err := UIKit.label("", 15, UIKit.BAD)
	body.add_child(err)
	var go := UIKit.button(I18n.t("Delete my account"), Callable(), false)
	go.add_theme_color_override("font_color", UIKit.BAD)
	go.pressed.connect(func():
		var sw: UIW.Switch = sure.find_children("*", "", true, false).filter(func(n): return n is UIW.Switch).front()
		if not sw.button_pressed:
			err.text = I18n.t("Tick the box first.")
			return
		go.disabled = true
		var r: Dictionary = await Account.delete_account(pw.text)
		if not is_instance_valid(go):
			return
		go.disabled = false
		if r.ok:
			close.call()
			for c in app.overlay_layer.get_children():
				if c.has_meta("close"):
					(c.get_meta("close") as Callable).call()
			app.show_start()
		else:
			err.text = I18n.t(str(r.error)))
	body.add_child(go)
