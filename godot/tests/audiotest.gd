extends Node
## Builds the audio system and drives an engine through its range (no output device needed).

func _ready() -> void:
	var a := GameAudio.new()
	add_child(a)
	print("samples: ", a.samples.keys())
	var cars: Array = JSON.parse_string(FileAccess.get_file_as_string("res://data/cars.json")).cars
	var seen := {}
	for c in cars:
		var k := EngineProfiles.profile_key(c.id)
		if seen.has(k):
			continue
		seen[k] = true
		var p := EngineProfiles.for_car(c)
		var v := a.create_engine(p)
		print(c.id, " ", k, " bank=", p.bank, " loops=", v.bank.get("loops", []).size(), " norm=", snappedf(v.bank.get("norm", 0), 0.01))
		for r in [1000.0, 4000.0, 8000.0]:
			v.set_state(r, 0.8, 8.0, 0.9, 0.2)
			await get_tree().create_timer(0.1).timeout
		v.stop()
	a.chime("best")
	a.impact(0.8)
	a.wheel_gun(0.5)
	a.air_jack(true, -0.5)
	var amb := Ambience.new(a)
	amb.update(0.5, 1.0, 0.0, 1.0)
	var cs := CarSounds.new(a)
	cs.update(50.0, 0.4, 0.5, 0.0, 0.0, 0.0, true)
	await get_tree().create_timer(0.3).timeout
	print("audio ok, buses: ", AudioServer.bus_count)
	get_tree().quit()
