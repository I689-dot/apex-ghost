extends Node
## The mobile layout's screens one after the other (SHOTS=<dir>: mobile_<name>.png each): the home, the game modes'
## categories, a cup, the season pass, the contracts, the free bonus, an ad placeholder and the after-race rewards.
## The progression is a made-up one in memory (nothing saved over the player's).
##   APEX_MOBILE_UI=1 SHOTS=<dir> godot --path godot --resolution 1600x720 res://tests/runner.tscn -- res://tests/mobile_shots.gd

var app

func _ready() -> void:
	_run.call_deferred()

func _shot(name: String, wait: float = 0.8) -> void:
	await get_tree().create_timer(wait).timeout
	var dir := OS.get_environment("SHOTS")
	if dir != "":
		get_viewport().get_texture().get_image().save_png("%s/mobile_%s.png" % [dir, name])
	print("shot ", name)

func _clear_overlays() -> void:
	for c in app.overlay_layer.get_children():
		c.queue_free()
	await get_tree().process_frame

func _run() -> void:
	Settings.data.introCinematic = false
	# a made-up progression (in memory only: dry, nothing saved)
	Progression.dry = true
	Progression.reset_cache()
	var p := Progression.data()
	p.passXp = 2650
	p.cups = {"rookie_cup": [3, 2, 1], "d_trophy": [2, 0, 0, 0]}
	p.wins = 2
	p.chests = 1
	p.freeBonusAt = 0
	(p.contracts as Array)[0].progress = (p.contracts as Array)[0].target
	# the login reward taken today (else the calendar opens over the home by itself)
	p.login = {"streak": 2, "last": Progression.today()}
	app = load("res://scripts/app/app.gd").new()
	add_child(app)
	await get_tree().create_timer(1.0).timeout
	app.show_menu()
	await _shot("home", 2.5)
	for c in ["career", "events", "online", "quick"]:
		MobileModes.show(app, c)
		await _shot("modes_" + c, 1.0)
	MobileModes.show_cup(app, "d_trophy")
	await _shot("cup", 1.0)
	MobilePass.show(app)
	await _shot("pass", 1.0)
	app.show_menu()
	await get_tree().create_timer(1.0).timeout
	MobileHome.contracts(app, func(): pass)
	await _shot("contracts")
	await _clear_overlays()
	MobileHome.free_bonus(app, func(): pass)
	await _shot("free_bonus")
	await _clear_overlays()
	MobileAds.rewarded(app, "5,000 credits", func(_ok): pass)
	await _shot("ad", 2.0)
	await _clear_overlays()
	MobileHome.race_rewards(app, {"passXp": 260, "contracts": [0], "chest": true}, {"trophies": 3, "gained": 2, "credits": 4000, "cup": "d_trophy", "race": 1}, {"coins": 6200})
	await _shot("rewards")
	await _clear_overlays()
	MobileHome._rate(app)
	await _shot("rate")
	await _clear_overlays()
	# the garage (Garage, MobileCars): an owned car, a locked one with blueprints, the reveal
	p.garage = {"owned": ["vantage_gt3_evo_heart_of_racing", "ford_mustang_gt3"], "bp": {"2020_audi_r8_lms_evo": 13}, "revealed": ["vantage_gt3_evo_heart_of_racing", "ford_mustang_gt3"], "goal": "2020_audi_r8_lms_evo"}
	MobileCars.show(app, "vantage_gt3_evo_heart_of_racing")
	await _shot("cars_owned", 2.5)
	MobileCars.show(app, "2020_audi_r8_lms_evo")
	await _shot("cars_locked", 2.5)
	MobileCars.upgrades(app, "vantage_gt3_evo_heart_of_racing", func() -> void: pass)
	await _shot("car_upgrade", 1.0)
	await _clear_overlays()
	MobileCars.reveal(app, "2024_porsche_992_gt3_r", func() -> void: pass)
	await _shot("car_reveal", 2.5)
	await _clear_overlays()
	# the store (MobileStore, Shop)
	for c in ["foryou", "deals", "cars", "coins", "vip", "free"]:
		MobileStore.show(app, c)
		await _shot("store_" + c, 1.5)
	# the daily screen and the profile (the calendar with today's reward waiting)
	p.login = {"streak": 2, "last": ""}
	for t in ["login", "daily", "weekly"]:
		MobileDaily.show(app, t)
		await _shot("daily_" + t, 1.5)
	MobileProfile.show(app)
	await _shot("profile", 1.5)
	get_tree().quit(0)
