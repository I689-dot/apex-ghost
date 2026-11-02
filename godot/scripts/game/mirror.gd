class_name RearMirror
extends Node
## Virtual rear-view mirror at the top of the screen (port of game/mirror.ts): a camera at the back of your car looking
## back, rendered by a SubViewport that shares the world, shown flipped left/right as a mirror shows it. On Low it
## refreshes every other frame.

var camera: Camera3D
var viewport: SubViewport
var rect: TextureRect
var visible := true
## Render every n-th frame.
var every := 1
var _anchor := Node3D.new()
var _frame := 0
var _frame_panel: Panel

func _init(car_object: Node3D, dims: Dictionary) -> void:
	# just behind the roof's trailing edge, a little higher than the roof: the rear wing stays out of the picture
	_anchor.position = Vector3(0, float(dims.height) + 0.12, -float(dims.length) * 0.5 - 0.15)
	car_object.add_child(_anchor)
	viewport = SubViewport.new()
	viewport.size = Vector2i(560, 133)
	viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	viewport.msaa_3d = Viewport.MSAA_2X
	camera = Camera3D.new()
	camera.fov = 30.0
	camera.near = 0.4
	camera.far = 600.0
	camera.keep_aspect = Camera3D.KEEP_HEIGHT
	viewport.add_child(camera)
	add_child(viewport)
	rect = TextureRect.new()
	rect.texture = viewport.get_texture()
	rect.flip_h = true
	rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	rect.stretch_mode = TextureRect.STRETCH_SCALE
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	# a thin dark frame
	_frame_panel = Panel.new()
	_frame_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_frame_panel.add_theme_stylebox_override("panel", UIKit.box(Color(0, 0, 0, 0), Color("0b0c0e"), 2, 0))
	_frame_panel.set_anchors_preset(Control.PRESET_FULL_RECT)
	_frame_panel.offset_left = -2
	_frame_panel.offset_top = -2
	_frame_panel.offset_right = 2
	_frame_panel.offset_bottom = 2
	rect.add_child(_frame_panel)

## The mirror's rectangle for a screen size: centred at the top.
static func screen_rect(size: Vector2) -> Rect2:
	var w := roundf(minf(size.x * 0.34, 560.0))
	var h := roundf(w / 4.2)
	return Rect2(roundf((size.x - w) / 2.0), 10.0, w, h)

func _process(_dt: float) -> void:
	rect.visible = visible
	if not visible:
		viewport.render_target_update_mode = SubViewport.UPDATE_DISABLED
		return
	var r := screen_rect(rect.get_viewport_rect().size)
	rect.position = r.position
	rect.size = r.size
	var px := Vector2i(maxi(64, int(r.size.x * 1.5)), maxi(16, int(r.size.y * 1.5)))
	if viewport.size != px:
		viewport.size = px
	camera.global_transform = _anchor.global_transform * Transform3D(Basis(Vector3.RIGHT, -0.045), Vector3.ZERO)
	_frame += 1
	viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS if _frame % maxi(1, every) == 0 else SubViewport.UPDATE_DISABLED

func dispose() -> void:
	if is_instance_valid(_anchor):
		_anchor.queue_free()
	queue_free()
