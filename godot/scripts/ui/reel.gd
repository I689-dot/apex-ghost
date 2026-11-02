class_name CinematicReel
extends Control
## A short TV-style intro reel for the boot, the race loading screen and the waiting screens (port of ui/reel.ts):
## letterbox bars, slow camera moves over the circuit photos (Ken Burns), the car's studio render sweeping in with a
## light streak, lower-third title cards. shots: [{photo, move: pan|push|rise|car, car?, kicker?, title?}].

signal finished

var shots: Array
var shot_ms := 4200.0
var loop := false
var bars := true
var _items: Array = []
var _i := -1
var _timer: Timer
var _tween: Tween

func _init(reel_shots: Array, opts: Dictionary = {}) -> void:
	shots = reel_shots
	shot_ms = float(opts.get("shotMs", 4200.0))
	loop = bool(opts.get("loop", false))
	bars = bool(opts.get("bars", true))
	UIKit.full(self)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	clip_contents = true
	for s in shots:
		var item := Control.new()
		UIKit.full(item)
		item.mouse_filter = Control.MOUSE_FILTER_IGNORE
		item.modulate.a = 0.0
		var img := TextureRect.new()
		img.texture = UIW.tex("res://assets/ui/" + s.photo)
		img.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		img.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
		img.mouse_filter = Control.MOUSE_FILTER_IGNORE
		UIKit.full(img)
		img.pivot_offset = Vector2(640, 360)
		item.add_child(img)
		item.set_meta("img", img)
		if s.move == "car" and s.get("car") != null:
			var car := UIW.image(s.car, Vector2.ZERO)
			car.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
			car.set_anchors_preset(Control.PRESET_CENTER)
			car.custom_minimum_size = Vector2(760, 380)
			car.position = Vector2(640 - 380, 360 - 150)
			car.size = Vector2(760, 380)
			car.mouse_filter = Control.MOUSE_FILTER_IGNORE
			item.add_child(car)
			item.set_meta("car", car)
		if s.get("title") != null:
			var cap := VBoxContainer.new()
			cap.position = Vector2(56, 560)
			if s.get("kicker") != null:
				cap.add_child(UIKit.label(s.kicker, 16, UIKit.ACCENT_2, true, 700))
			cap.add_child(UIKit.label(s.title, 44, UIKit.TEXT, true, 700))
			item.add_child(cap)
		add_child(item)
		_items.append(item)
	# letterbox bars, a vignette
	if bars:
		for top in [true, false]:
			var bar := ColorRect.new()
			bar.color = Color.BLACK
			bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
			bar.set_anchors_preset(Control.PRESET_TOP_WIDE if top else Control.PRESET_BOTTOM_WIDE)
			bar.custom_minimum_size = Vector2(0, 56)
			if top:
				bar.offset_bottom = 56
			else:
				bar.offset_top = -56
			add_child(bar)
	_timer = Timer.new()
	_timer.one_shot = true
	_timer.timeout.connect(_next)
	add_child(_timer)
	_start.call_deferred()

func _start() -> void:
	_next()

func _next() -> void:
	if _tween != null:
		_tween.kill()
	if _i >= 0:
		var old: Control = _items[_i]
		var fade := create_tween()
		fade.tween_property(old, "modulate:a", 0.0, 0.5)
	_i += 1
	if _i >= _items.size():
		if not loop:
			finished.emit()
			return
		_i = 0
	var item: Control = _items[_i]
	var img: TextureRect = item.get_meta("img")
	img.scale = Vector2.ONE
	img.position = Vector2.ZERO
	item.modulate.a = 0.0
	_tween = create_tween().set_parallel(true)
	_tween.tween_property(item, "modulate:a", 1.0, 0.5)
	var secs := shot_ms / 1000.0
	match shots[_i].move:
		"pan":
			img.scale = Vector2(1.18, 1.18)
			img.position = Vector2(50, 0)
			_tween.tween_property(img, "position:x", -50.0, secs)
		"push":
			_tween.tween_property(img, "scale", Vector2(1.28, 1.28), secs)
		"rise":
			img.scale = Vector2(1.2, 1.2)
			img.position = Vector2(0, 40)
			_tween.tween_property(img, "position:y", -40.0, secs)
		"car":
			img.scale = Vector2(1.1, 1.1)
			var car: Control = item.get_meta("car", null)
			if car != null:
				car.position.x = -900.0
				_tween.tween_property(car, "position:x", 640.0 - 380.0, secs * 0.45).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	_timer.start(secs)

func dispose() -> void:
	if _tween != null:
		_tween.kill()
	queue_free()

## The usual reel for a circuit: aerial, the car, the grid, pole, the straight.
static func track_reel(map: String, track_name: String, car: Variant, kicker: String) -> Array:
	var sfx := "" if map == "" or map == "nurburgring" or map == "nordschleife" else "_" + map
	var out: Array = [{"photo": "photo_aerial%s.webp" % sfx, "move": "rise", "kicker": kicker, "title": track_name}]
	if car != null:
		out.append({"photo": "photo_straight%s.webp" % sfx, "move": "car", "car": car.url, "kicker": "GT3", "title": car.name})
	out.append({"photo": "photo_grid%s.webp" % sfx, "move": "pan"})
	out.append({"photo": "photo_pole%s.webp" % sfx, "move": "push"})
	out.append({"photo": "photo_straight%s.webp" % sfx, "move": "pan"})
	return out
