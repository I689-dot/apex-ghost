extends SceneTree
func _initialize() -> void:
	var r := Prng.new(12345)
	var out := []
	for i in 5:
		out.append("%.10f" % r.next())
	print(",".join(out))
	print(Prng.hash_string("Zandvoort ü€"))
	print(Validation.normalize_room_code("ab c-d e"), " ", Validation.sanitize_nickname("  <b>Max</b>  Z "))
	quit()
