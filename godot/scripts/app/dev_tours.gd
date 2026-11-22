class_name DevTours
extends RefCounted
## The app's dev automation (APEX_AUTO, from App._ready): tours that drive the real app by themselves and save
## screenshots to SHOT_DIR. Split from app.gd; each takes the App it drives.

## Dev: APEX_AUTO=solo plays through menu → lobby → briefing → race by itself (SHOT_DIR saves a screenshot per step).
static func solo(app: App) -> void:
	var shot := func(n: String) -> void:
		var dir := OS.get_environment("SHOT_DIR")
		if dir != "":
			await app.get_tree().process_frame
			app.get_viewport().get_texture().get_image().save_png("%s/app_%s.png" % [dir, n])
	await app.get_tree().create_timer(1.0).timeout
	await shot.call("menu")
	var err := await app.join(LocalRoom.create(), "Max")
	print("join: ", err)
	if OS.get_environment("TRACK") != "":
		app.send({"t": "setConditions", "trackId": OS.get_environment("TRACK")})
	await app.get_tree().create_timer(0.6).timeout
	await shot.call("lobby_hub")
	for step: String in ["circuit", "conditions", "session", "rules", "car", "drivers"]:
		LobbyScreen._page = step
		app.render_lobby()
		await app.get_tree().create_timer(0.3).timeout
		await shot.call("lobby_" + step)
	if OS.get_environment("AUTODRIVE") != "":
		app.send({"t": "setSession", "minutes": 5})
		app.send({"t": "setRaceLaps", "laps": 0})
	app.send({"t": "selectCar", "carId": CarsDb.selectable()[0].id})
	app.send({"t": "addBot"})
	app.send({"t": "addBot"})
	app.send({"t": "ready", "ready": true})
	await app.get_tree().create_timer(0.5).timeout
	await shot.call("lobby_ready")
	app.send({"t": "start"})
	await app.get_tree().create_timer(1.0).timeout
	await shot.call("briefing")
	app.send({"t": "briefed"})
	for i in 40:
		await app.get_tree().create_timer(0.5).timeout
		if app.screen == "race":
			break
	await shot.call("loaded")
	await app.get_tree().create_timer(6.0).timeout
	await shot.call("racing")
	if OS.get_environment("AUTODRIVE") != "":
		# the AI drives my car through the whole session: the results screen, the career, the lobby after it
		app.session.autodrive = AiDriver.new(app.session.track_data, app.session.vehicle, 0.95, 0.0)
		app.session.autodrive.human = false
		var t0 := Time.get_ticks_msec()
		var n := 0
		while app.screen != "results" and Time.get_ticks_msec() - t0 < 9 * 60 * 1000:
			await app.get_tree().create_timer(30.0).timeout
			n += 1
			await shot.call("drive_%02d" % n)
			print("t=%ds screen=%s speed=%d" % [(Time.get_ticks_msec() - t0) / 1000, app.screen, int(app.session.vehicle.telemetry.speed * 3.6) if app.session != null else -1])
		await app.get_tree().create_timer(2.0).timeout
		await shot.call("results")
		print("results reached: ", app.screen == "results")
		app.get_tree().quit()
		return
	await app.get_tree().create_timer(10.0).timeout
	await shot.call("race")
	await app.get_tree().create_timer(6.0).timeout
	await shot.call("race2")
	print("autotest done, screen=", app.screen)
	app.get_tree().quit()

## Dev: APEX_AUTO=intro screenshots the intro at five moments, then quits.
static func intro_shots(app: App) -> void:
	for t: float in [1.0, 2.6, 4.2, 6.8, 9.6]:
		await app.get_tree().create_timer(t).timeout
		app.get_viewport().get_texture().get_image().save_png("%s/intro_%d.png" % [OS.get_environment("SHOT_DIR"), int(t)])
	app.get_tree().quit()

## Dev: APEX_AUTO=ui screenshots the menus: the menu's tabs and modals, the career's pages, every settings page, the
## lobby's pages and the briefing of a solo room, and a results screen from made-up rows (nothing is saved).
static func ui(app: App) -> void:
	var dir := OS.get_environment("SHOT_DIR")
	var shot := func(n: String) -> void:
		await app.get_tree().create_timer(0.7).timeout
		app.get_viewport().get_texture().get_image().save_png("%s/ui_%s.png" % [dir, n])
	var clear := func() -> void:
		for c in app.overlay_layer.get_children():
			if c != app.toasts and c != app.perf:
				c.queue_free()
	await app.get_tree().create_timer(1.5).timeout
	await shot.call("menu")
	# the pad's D-pad: the focus ring moves to the next card
	var pad := InputEventAction.new()
	pad.action = "ui_right"
	pad.pressed = true
	Input.parse_input_event(pad)
	await shot.call("menu_pad_focus")
	for t: String in ["online", "friends"]:
		MenuScreen._tab = t
		app.show_menu()
		await shot.call("menu_" + t)
	MenuScreen._tab = "play"
	for t: String in ["profile", "achievements", "ranks"]:
		CareerScreen._tab = t
		app.show_career()
		await shot.call("career_" + t)
	CareerScreen._tab = "profile"
	app.show_sign_in()
	await shot.call("signin")
	app.show_menu()
	ChampionshipUI.open(app, func() -> String: return "Max")
	await shot.call("champ")
	clear.call()
	SocialUI.records_modal(app)
	await shot.call("records")
	clear.call()
	for tab: String in ["graphics", "display", "view", "driving", "interface", "audio", "controls", "controller"]:
		SettingsPanel._tab = tab
		var panel := SettingsPanel.build(app, func() -> void: pass)
		await shot.call("settings_" + tab)
		panel.queue_free()
	# a solo room: every lobby page, then the briefing's pages
	await app.join(LocalRoom.create(), "Max")
	await app.get_tree().create_timer(0.6).timeout
	for step: String in ["hub", "circuit", "car", "session", "conditions", "rules", "drivers"]:
		LobbyScreen._page = step
		app.render_lobby()
		await shot.call("lobby_" + step)
	LobbyScreen._page = "hub"
	app.render_lobby()
	app.send({"t": "addBot"})
	app.send({"t": "addBot"})
	app.send({"t": "ready", "ready": true})
	app.send({"t": "start"})
	await app.get_tree().create_timer(0.8).timeout
	for t: String in ["setup", "advanced", "saved"]:
		BriefingScreen._brief_tab = t
		app.render_briefing()
		await shot.call("briefing_" + t)
	BriefingScreen._brief_tab = "setup"
	# the results, from made-up rows, with the room closed so no championship is scored
	var ids: Array = CarsDb.selectable().map(func(c: Dictionary) -> String: return c.id)
	var nicks := ["Max", "Harry Ashdown", "Sem van Doorn", "Lucas Moreau", "Jonas Keller", "Marco Rossi"]
	var rows: Array = []
	for i in nicks.size():
		rows.append({"id": app.me if i == 0 else "bot%d" % i, "nick": nicks[i], "carId": ids[(i * 3) % ids.size()], "position": i + 1, "totalMs": 612345.0 + i * 1834.0,
			"penaltyMs": 5000.0 if i == 3 else 0.0, "gapMs": i * 1834.0, "bestLapMs": 118234.0 + i * 211.0, "validLaps": 5, "dnf": i == 5})
	var gain := {"lines": [["Race finished", 120], ["Position", 150], ["Clean laps", 40]], "xp": 310, "xpBefore": 0, "srBefore": 2.5, "srAfter": 2.62,
		"levelBefore": 1, "levelAfter": 1, "licenceBefore": "R", "licenceAfter": "R", "rankBefore": "Rookie", "rankAfter": "Rookie", "ratingBefore": 1350, "ratingAfter": 1372,
		"achievements": [CareerData.ACHIEVEMENTS[0]]}
	app.pending_race = {"trackId": "spa"}
	app.teardown_connection()
	app.weekend.clear()
	app.screen = "results"
	app.set_backdrop("pole", "spa")
	app.set_ui(ResultsScreen.build(app, {"kind": "race", "rows": rows, "fastestLap": {"id": app.me, "ms": 118234.0}, "raceId": 1}, gain))
	await shot.call("results")
	app.get_tree().quit()
