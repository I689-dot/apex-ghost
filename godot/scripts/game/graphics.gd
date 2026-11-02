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
	Engine.max_fps = 0

func _apply_scale() -> void:
	var s := float(quality.superSample) * float(Settings.data.resolutionScale) * dyn_scale
	var vp := get_viewport()
	vp.scaling_3d_mode = Viewport.SCALING_3D_MODE_BILINEAR
	vp.scaling_3d_scale = clampf(s, 0.4, 2.0)

## Feed frame times; lowers / raises the render resolution to hold ~90 % of the display rate (54 fps at 60 Hz, 108 at
## 120 Hz), rarely and with hysteresis. Never on Ultra, which is about picture quality only.
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
	var next := dyn_scale
	if avg > 1000.0 / (hz * 0.9):
		next = maxf(0.6, dyn_scale - 0.1)
	elif avg < 1000.0 / (hz * 0.97) and dyn_scale < 1.0 and now - _last_change > 4000.0:
		next = minf(1.0, dyn_scale + 0.1)
	if not is_equal_approx(next, dyn_scale):
		dyn_scale = next
		_last_change = now
		_idx = 0  # judge the new resolution on fresh frames
		_apply_scale()

func _process(dt: float) -> void:
	track_frame(dt * 1000.0)
