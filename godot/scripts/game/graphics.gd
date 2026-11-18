class_name Graphics
extends Node
## The renderer's quality settings (port of game/graphics.ts): anti-aliasing, the render resolution (the user's scale,
## supersampling and the dynamic scale that holds the frame rate), first-launch quality detection. Shadows, bloom and
## the grade belong to the GameEnvironment (set_quality). Ambient occlusion has no counterpart on the Mobile renderer.

var quality: Dictionary
## Dynamic resolution multiplier (0.6..1) on top of the user's resolution scale.
var dyn_scale := 1.0
var _times := PackedFloat32Array()
var _idx := 0
var _last_change := 0.0

func _ready() -> void:
	_times.resize(45)
	RenderingServer.viewport_set_measure_render_time(get_viewport().get_viewport_rid(), true)
	if Settings.data.qualityAuto:
		Settings.data.quality = Settings.detect_quality()
		Settings.data.qualityAuto = false
		Settings.save()
	apply_quality()

## After a change of the quality settings.
func apply_quality() -> void:
	quality = Settings.quality_config()
	dyn_scale = 1.0
	var vp := get_viewport()
	var aa: String = quality.antialias
	vp.msaa_3d = Viewport.MSAA_4X if aa == "msaa" else (Viewport.MSAA_2X if aa == "native" else Viewport.MSAA_DISABLED)
	vp.screen_space_aa = Viewport.SCREEN_SPACE_AA_FXAA if aa == "smaa" else Viewport.SCREEN_SPACE_AA_DISABLED
	vp.use_taa = aa == "taa"
	_apply_scale()
	_apply_display()

## The Display page: window mode and vsync (desktop only: a phone is always full screen with the display's vsync) and
## the frame-rate cap.
func _apply_display() -> void:
	var d: Dictionary = Settings.data.display
	Engine.max_fps = int(d.maxFps)
	if OS.has_feature("mobile"):
		return
	apply_ui_size()
	apply_hdr()
	Settings.place_window()
	var mode: DisplayServer.WindowMode = {
		"windowed": DisplayServer.WINDOW_MODE_WINDOWED, "borderless": DisplayServer.WINDOW_MODE_FULLSCREEN,
		"fullscreen": DisplayServer.WINDOW_MODE_EXCLUSIVE_FULLSCREEN,
	}.get(d.windowMode, DisplayServer.WINDOW_MODE_WINDOWED)
	# leave a maximised window alone while the setting says windowed
	var cur := DisplayServer.window_get_mode()
	if mode != cur and not (mode == DisplayServer.WINDOW_MODE_WINDOWED and cur == DisplayServer.WINDOW_MODE_MAXIMIZED):
		DisplayServer.window_set_mode(mode)
	DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_ENABLED if d.vsync else DisplayServer.VSYNC_DISABLED)

## The menus' and HUD's size on a computer (Display › Interface size): the canvas they are laid out on. The game's
## screens were drawn for 1280 x 720 (a phone), and blown up 1.5x on a 1080p screen, 2x on 1440p, they looked like a
## rescaled phone menu (the user, 2026-11-18). On a PC they are laid out on a bigger canvas: text and controls at a
## desktop's size, more room around them. The canvas keeps the window's shape (stretch aspect "expand").
const UI_CANVAS := {"small": Vector2i(1920, 1080), "medium": Vector2i(1600, 900), "large": Vector2i(1280, 720)}

static func apply_ui_size() -> void:
	if OS.has_feature("mobile"):
		return
	var w := (Engine.get_main_loop() as SceneTree).root
	var k: String = str(Settings.data.display.get("uiSize", "medium"))
	w.content_scale_size = UI_CANVAS.get(k, UI_CANVAS.medium)

## HDR output (Display › HDR output, Godot 4.7): on an HDR screen the sun, headlights and floodlights are shown as
## bright as the lighting makes them instead of being tone-mapped down to an ordinary screen's range. Windows, macOS
## and Linux on Wayland; elsewhere the switch is off.
static func hdr_supported() -> bool:
	return not OS.has_feature("mobile") and DisplayServer.window_is_hdr_output_supported()

static func apply_hdr() -> void:
	var w := (Engine.get_main_loop() as SceneTree).root
	w.hdr_output_requested = hdr_supported() and bool(Settings.data.display.get("hdr", false))

## FSR 2 needs the Forward+ renderer; FSR 1 works on both.
static func upscalers() -> Array:
	var out: Array = [["bilinear", "Bilinear"], ["fsr", "AMD FSR 1.0"]]
	if RenderingServer.get_current_rendering_method() == "forward_plus":
		out.append(["fsr2", "AMD FSR 2.2"])
	return out

func _apply_scale() -> void:
	var s := float(quality.superSample) * float(Settings.data.resolutionScale) * dyn_scale
	var vp := get_viewport()
	var up: String = Settings.data.display.upscaler
	if up == "fsr2" and RenderingServer.get_current_rendering_method() != "forward_plus":
		up = "fsr"
	# an upscaler only below native: above it (supersampling) the plain filter downsamples best
	vp.scaling_3d_mode = Viewport.SCALING_3D_MODE_BILINEAR if s >= 1.0 or up == "bilinear" else (Viewport.SCALING_3D_MODE_FSR2 if up == "fsr2" else Viewport.SCALING_3D_MODE_FSR)
	vp.scaling_3d_scale = clampf(s, 0.4, 2.0)

## Feed the GPU's time for the frame; lowers / raises the render resolution to keep it within the display's frame budget
## (16.7 ms at 60 Hz), rarely and with hysteresis. Only the GPU counts: a CPU-bound frame gains nothing from fewer
## pixels. Never on Ultra, which is about picture quality only.
func track_frame(dt_ms: float) -> void:
	var now := Time.get_ticks_msec() as float
	_times[_idx % _times.size()] = dt_ms
	_idx += 1
	if not Settings.data.dynamicResolution or Settings.data.quality == "ultra" or now - _last_change < 1500.0 or _idx < _times.size():
		return
	var sum := 0.0
	for t in _times:
		sum += t
	var avg := sum / _times.size()
	var hz := maxf(60.0, float(Settings.data.refreshRate))
	var budget := 1000.0 / hz
	var next := dyn_scale
	if avg > budget * 0.85:
		next = maxf(0.6, dyn_scale - 0.1)
	elif avg < budget * 0.55 and dyn_scale < 1.0 and now - _last_change > 4000.0:
		next = minf(1.0, dyn_scale + 0.1)
	if not is_equal_approx(next, dyn_scale):
		dyn_scale = next
		_last_change = now
		_idx = 0  # judge the new resolution on fresh frames
		_apply_scale()

func _process(_dt: float) -> void:
	track_frame(RenderingServer.viewport_get_measured_render_time_gpu(get_viewport().get_viewport_rid()))
