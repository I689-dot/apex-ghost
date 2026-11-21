class_name MobileAds
extends RefCounted
## Ad placements of the mobile layout (the user, 2026-11-20: "with ads for making revenue ... dont need to set up the
## ads"): where a free-to-play racing game shows them, as placeholders. No ad network is set up and nothing is
## fetched: each placement shows a labelled stand-in with a countdown, then gives what a real ad would.
##
##  - rewarded(): the player chooses to watch (the free bonus, double rewards after a race); the reward is given only
##    when the "video" has run to its end.
##  - interstitial(): between races, every Progression.INTERSTITIAL_EVERY races, closable after a few seconds; never
##    in the middle of a race, never right after a rewarded one.
##
## A real network (AdMob or similar, through an Android plugin) replaces _show(): load the ad, show it, and call
## on_done with whether it completed. Settings › Account would then carry the consent choices (GDPR / UMP).

const REWARDED_S := 5.0
const INTERSTITIAL_S := 3.0

## A rewarded placement: on_done(true) when watched to the end, on_done(false) when closed early.
static func rewarded(app: App, what: String, on_done: Callable) -> void:
	_show(app, true, what, on_done)

## An interstitial between races (when due); on_done() when closed.
static func interstitial(app: App, on_done: Callable) -> void:
	if not Progression.interstitial_due():
		on_done.call()
		return
	Progression.interstitial_shown()
	_show(app, false, "", func(_ok: bool) -> void: on_done.call())

static func _show(app: App, reward: bool, what: String, on_done: Callable) -> void:
	var layer := Control.new()
	layer.set_meta("modal", true)
	UIKit.full(layer)
	layer.mouse_filter = Control.MOUSE_FILTER_STOP
	var bg := ColorRect.new()
	bg.color = Color(0.01, 0.015, 0.03, 0.97)
	UIKit.full(bg)
	layer.add_child(bg)
	var col := UIW.vbox(18)
	col.alignment = BoxContainer.ALIGNMENT_CENTER
	var tag := UIW.tag(I18n.t("AD"), UIKit.ACCENT_2, true, UIKit.INK)
	tag.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	col.add_child(tag)
	var title := UIKit.label(I18n.t("Advertisement").to_upper(), 46, UIKit.TEXT, true, 700)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(title)
	var sub := UIKit.label(I18n.t("Placeholder: an ad network would show a video here.") + ("\n" + I18n.t("Reward: {what}", {"what": what}) if what != "" else ""), 18, UIKit.SOFT)
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(sub)
	var bar := ProgressBar.new()
	bar.show_percentage = false
	bar.custom_minimum_size = Vector2(520, 6)
	bar.max_value = 1.0
	col.add_child(bar)
	var left := UIKit.label("", 20, UIKit.ACCENT_2, true, 600)
	left.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(left)
	var center := CenterContainer.new()
	UIKit.full(center)
	center.add_child(col)
	layer.add_child(center)
	var close := UIW.close_button(func() -> void: pass)
	close.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	close.position = Vector2(-80, 24)
	close.visible = not reward
	layer.add_child(close)
	var claim := UIKit.button(I18n.t("Claim reward"), func() -> void: pass, true)
	claim.visible = false
	col.add_child(claim)
	app.overlay_layer.add_child(layer)
	var total := REWARDED_S if reward else INTERSTITIAL_S
	var state := {"t": 0.0, "done": false}
	var finish := func(ok: bool) -> void:
		if state.done:
			return
		state.done = true
		layer.queue_free()
		on_done.call(ok)
	close.pressed.connect(func() -> void: finish.call(state.t >= total))
	claim.pressed.connect(func() -> void: finish.call(true))
	# a rewarded one can be left early (no reward): a small "skip" under the bar
	var skip := UIKit.button(I18n.t("Close (no reward)"), func() -> void: finish.call(false))
	skip.visible = reward
	col.add_child(skip)
	var timer := Timer.new()
	timer.wait_time = 0.1
	timer.autostart = true
	layer.add_child(timer)
	timer.timeout.connect(func() -> void:
		state.t += 0.1
		bar.value = clampf(state.t / total, 0.0, 1.0)
		if state.t < total:
			left.text = I18n.t("{s} s", {"s": ceili(total - state.t)})
			return
		timer.stop()
		left.text = ""
		if reward:
			claim.visible = true
			skip.visible = false
			claim.grab_focus()
		else:
			close.visible = true)
