class_name CarLineArt
extends RefCounted
## A car's own line drawing from above (port of ui/carLines.ts), each part in a colour of its own: the nose, the tail,
## the sides, the engine bay and each corner at its real wheel (iRacing's damage diagram). Shared by the damage report
## and the tyres-and-damage instrument.

const CORNER := 6

var texture: ImageTexture = null
var lines: TopView.Lines = null
var _zone_of := PackedByteArray()
var _image: Image = null

## Damage 0 (none) .. 1 (wrecked) -> green, yellow, orange, red.
static func damage_colour(d: float) -> Color:
	if d < 0.05:
		return Color("30d158")
	if d < 0.25:
		return Color("ffd60a")
	if d < 0.55:
		return Color("ff9f0a")
	return Color("ff453a")

## The car (once at load): its drawing and where its wheels are.
func set_car(entry: Dictionary, line_data: TopView.Lines) -> void:
	lines = line_data
	_zone_of = PackedByteArray()
	if line_data == null:
		return
	var W := line_data.width
	var H := line_data.height
	var wheels: Array = ["FL", "FR", "RL", "RR"].map(func(k): return entry.wheels[k])
	var z_f: float = (wheels[0].position[2] + wheels[1].position[2]) / 2.0
	var z_r: float = (wheels[2].position[2] + wheels[3].position[2]) / 2.0
	var w := line_data.max_x - line_data.min_x
	_zone_of.resize(W * H)
	for y in H:
		for x in W:
			# the picture's right is the car's right (-x), its top the nose
			var cx := line_data.max_x - ((x + 0.5) / W) * w
			var cz := line_data.max_z - ((y + 0.5) / H) * (line_data.max_z - line_data.min_z)
			var z: int
			var wi := -1
			for k in 4:
				var wh: Dictionary = wheels[k]
				if absf(cz - wh.position[2]) < wh.radius * 1.15 and absf(cx - wh.position[0]) < 0.3:
					wi = k
					break
			if wi >= 0:
				z = CORNER + wi
			elif cz > z_f + 0.15:
				z = 0
			elif cz < z_r - 0.15:
				z = 1
			elif absf(cx) < w * 0.16 and cz < (z_f + z_r) / 2.0:
				z = 4
			else:
				z = 2 if cx > 0.0 else 3
			_zone_of[y * W + x] = z

## Draws it: zones = colours of front, rear, left, right, engine; corners = of FL, FR, RL, RR. False without a car.
func draw(zones: Array, corners: Array) -> bool:
	if lines == null or _zone_of.is_empty():
		return false
	var L := lines
	var data := PackedByteArray()
	data.resize(L.width * L.height * 4)
	var zc: Array = zones.map(func(c: Color): return [c.r8, c.g8, c.b8])
	var cc: Array = corners.map(func(c: Color): return [c.r8, c.g8, c.b8])
	for i in L.lines.size():
		var a := L.lines[i]
		if a == 0:
			continue
		var zi := _zone_of[i]
		var c: Array = cc[zi - CORNER] if zi >= CORNER else (zc[zi] if zi < zc.size() else zc[0])
		var o := i * 4
		data[o] = c[0]
		data[o + 1] = c[1]
		data[o + 2] = c[2]
		data[o + 3] = a
	_image = Image.create_from_data(L.width, L.height, false, Image.FORMAT_RGBA8, data)
	if texture == null:
		texture = ImageTexture.create_from_image(_image)
	else:
		texture.update(_image)
	return true
