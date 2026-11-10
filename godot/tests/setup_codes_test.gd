extends Node
## Setup codes: a setup survives the trip through a text code, and bad or hostile codes are refused or clamped.
##   tools/godot/gd.sh tests/setup_codes_test.gd

var failures := 0

func check(name: String, ok: bool, detail: String = "") -> void:
	if ok:
		print("ok   ", name)
	else:
		failures += 1
		print("FAIL ", name, " ", detail)

func _ready() -> void:
	var setup := {"tyre": "soft", "wing": "high", "brakeBias": 0.62, "pressure": [26.5, 27.0], "ride": [-4, 6], "arb": [3, 5], "bump": [2, 6], "rebound": [7, 1], "fuelL": 45}
	var code := CarSetup.to_code(setup)
	check("code has the prefix", code.begins_with("AG1:"), code)
	var back = CarSetup.from_code(code)
	check("round trip keeps the setup", back != null and back.tyre == "soft" and back.wing == "high" and absf(back.brakeBias - 0.62) < 0.0001 \
		and back.ride == [-4, 6] and back.arb == [3, 5] and back.rebound == [7, 1] and back.fuelL == 45.0 and back.pressure == [26.5, 27.0], str(back))
	check("whitespace around a pasted code is fine", CarSetup.from_code("  " + code + "\n") != null)
	check("not a code", CarSetup.from_code("hello") == null)
	check("empty", CarSetup.from_code("") == null)
	check("bad base64/json", CarSetup.from_code("AG1:!!!!") == null and CarSetup.from_code("AG1:" + Marshalls.raw_to_base64("[1,2]".to_utf8_buffer())) == null)
	check("huge code refused", CarSetup.from_code("AG1:" + "A".repeat(5000)) == null)
	var hostile := {"tyre": "rocket", "wing": "x", "brakeBias": 9.0, "pressure": [-5, 900], "ride": [500, -500], "arb": [0, 99], "bump": "no", "fuelL": 1e9, "evil": "field"}
	var s = CarSetup.sanitize(hostile)
	check("hostile values are clamped", s != null and s.tyre == "medium" and s.wing == "medium" and s.brakeBias == 0.66 and s.pressure == [15.0, 40.0] \
		and s.ride == [10, -10] and s.arb == [1, 7] and s.bump == [4, 4] and s.fuelL == 200.0 and not s.has("evil"), str(s))
	check("a plain setup without pressures", CarSetup.sanitize({"tyre": "wet"}).pressure == null)
	print(failures, " failures")
	get_tree().quit(1 if failures > 0 else 0)
