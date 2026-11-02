extends Node
## Renders the HUD with fake data and saves a screenshot: res://tests/runner.tscn -- res://tests/hud_demo.gd
func _ready() -> void:
	_run.call_deferred()

func _run() -> void:
	var bg := ColorRect.new()
	bg.color = Color(0.25, 0.3, 0.35)
	UIKit.full(bg)
	add_child(bg)
	var hud := Hud.new()
	add_child(hud)
	var layout: Dictionary = TrackData.list_layouts()[4]
	var track: Dictionary = Assets.load_track_file(layout.id)
	hud.set_track(track)
	var car: Dictionary = CarsDb.by_id("2024_porsche_992_gt3_r")
	var model: Dictionary = Assets.load_car_model(car, 3, false)
	var lines := await TopView.render_top_lines(self, model.lods[0])
	print("lines: ", lines.width, "x", lines.height if lines != null else 0)
	hud.set_car(car, lines)
	hud.set_damage_car(car, lines)
	hud.race_laps = 0
	hud.colors = {"a": "#1d2f55", "b": "#c4161c", "c": "#f2f2f2", "me": "#ffd60a", "d": "#2f7de1"}
	hud.set_driver("a", "GB", 7)
	hud.set_driver("me", "NL", 33)
	var standings: Array = []
	var names := {"a": "Oliver Whitmore", "b": "Maxime Delvaux", "c": "Hugo Marchand", "me": "Max", "d": "Callum Fletcher"}
	var i := 1
	for id in ["a", "b", "c", "me", "d"]:
		standings.append({"id": id, "position": i, "laps": 3, "bestLapMs": 93500.0 + i * 420.0, "gapMs": (i - 1) * 420.0, "finishedMs": null, "dnf": false, "inPit": false, "outLap": false, "lapPenaltyMs": 0})
		i += 1
	hud.set_board(standings, "me", names)
	var st := {
		"speedMs": 61.0, "rpm": 6800.0, "redline": 7000.0, "limiter": 7250.0, "gear": 5, "manual": false, "lapLabel": "OUT",
		"lapPenaltyMs": 0, "lapInvalid": false, "liveDelta": -230.0, "position": 4, "total": 5, "currentLapMs": 41230.0,
		"bestLapMs": 94800.0, "lastLapMs": 95100.0, "sectorDelta": null, "damage": 0.2, "damageZones": [0.0, 0.3, 0.0, 0.1, 0.0, 0.0],
		"wrongWay": false, "abs": true, "tc": true, "message": "Lap 3: 1:34.800 · PERSONAL BEST", "sessionText": "TIME LEFT 7:42",
		"pitText": "", "compound": "medium", "tyreWear": [0.12, 0.1, 0.22, 0.2], "brakeTemps": [420.0, 410.0, 360.0, 350.0],
		"slipstream": 0.6, "resetHint": false, "tyreTemps": [88.0, 90.0, 96.0, 95.0], "flag": "", "flagText": "", "fuelText": "",
		"fuelLow": false, "throttle": 0.8, "brake": 0.0, "steer": 0.2,
	}
	hud.update_state(st)
	hud.draw_map([{"x": track.centerline[0] + 50, "z": track.centerline[2] + 30, "me": false, "color": "#c4161c"}], track.centerline[0], track.centerline[2], 0.0, 1.0)
	hud.set_map_cars([{"x": track.centerline[0], "z": track.centerline[2], "label": "33", "me": true, "lap": "same", "inPit": false}])
	hud.set_relative([
		{"id": "a", "name": "Oliver Whitmore", "color": "#1d2f55", "position": 1, "gapS": 2.3, "lap": "same", "inPit": false, "me": false},
		{"id": "me", "name": "Max", "color": "#ffd60a", "position": 4, "gapS": 0.0, "lap": "same", "inPit": false, "me": true},
		{"id": "d", "name": "Callum Fletcher", "color": "#2f7de1", "position": 5, "gapS": -1.4, "lap": "behind", "inPit": false, "me": false}], false, true)
	Settings.data.overlays.trackMap = false
	hud.set_map_cars([])
	var d := DamageState.new()
	d.impact(70000.0, 0.2, 1.0, 1400.0)
	hud.update_damage(d, true)
	await get_tree().create_timer(0.6).timeout
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(OS.get_environment("SHOT_DIR") + "/hud.png")
	print("saved")
	get_tree().quit()
