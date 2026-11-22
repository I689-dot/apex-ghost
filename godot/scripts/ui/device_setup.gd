class_name DeviceSetup
extends VBoxContainer
## Settings → Controller → Wheel, pedals and shifter: every function of DeviceBindings with what it is bound to, its
## live value and Assign / Clear. Assign listens to every connected device: a button (or a shifter's gear position)
## is taken as soon as it is pressed; an axis is the one that moves most, its two ends recorded while the player moves
## it (a pedal pressed fully and let go; the wheel turned fully left and right), then Done or a still second ends it.

var changed: Callable
var _rows := {} # function -> {bind: Label, live: Control}
var _prompt := UIKit.label("", 18, UIKit.ACCENT_2, false, 700)
var _done: Button
var _learning := ""
var _kind := ""
var _base := {} # device -> Array of its axes at the start
var _lo := {}
var _hi := {}
var _best := [-1, -1, 0.0] # device, axis, travel
var _quiet := 0.0
var _btn_base := {}
## Per device and axis, the side it first moved to (the wheel is turned LEFT first: that end is full left).
var _first := {}

func _init(on_change: Callable) -> void:
	changed = on_change
	add_theme_constant_override("separation", 2)
	_prompt.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_prompt.visible = false
	add_child(_prompt)
	_done = UIKit.button(I18n.t("Done"), func() -> void: _finish(true))
	_done.visible = false
	add_child(_done)
	for f: Array in DeviceBindings.FUNCTIONS:
		var row := UIW.hbox(10)
		var name := UIKit.label(I18n.t(f[2]), 15, UIKit.TEXT, false, 600)
		name.custom_minimum_size = Vector2(190, 0)
		row.add_child(name)
		var bind := UIKit.label("", 13, UIKit.MUTED)
		bind.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		bind.clip_text = true
		row.add_child(bind)
		var live := UIW.bar(Vector2(90, 10))
		live.min_value = -1.0 if f[1] == "steer" else 0.0
		live.step = 0.001
		live.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(live)
		var key: String = f[0]
		var kind: String = f[1]
		row.add_child(UIKit.button(I18n.t("Assign"), func() -> void: _start(key, kind)))
		row.add_child(UIKit.button(I18n.t("Clear"), func() -> void:
			DeviceBindings.bindings().erase(key)
			changed.call()
			_refresh()))
		add_child(row)
		_rows[key] = {"bind": bind, "live": live, "kind": kind}
	_refresh()

func _refresh() -> void:
	var bs := DeviceBindings.bindings()
	for key: String in _rows:
		var r: Dictionary = _rows[key]
		if not bs.has(key):
			(r.bind as Label).text = "—"
			continue
		var b: Dictionary = bs[key]
		var what := (I18n.t("axis {n}") if b.kind == "axis" else I18n.t("button {n}")).replace("{n}", str(int(b.index)))
		var connected := DeviceBindings.device_of(b) >= 0
		(r.bind as Label).text = "%s · %s%s" % [str(b.dev).substr(0, 40), what, "" if connected else "  (" + I18n.t("not connected") + ")"]

func _start(key: String, kind: String) -> void:
	_learning = key
	_kind = kind
	_base.clear()
	_lo.clear()
	_hi.clear()
	_btn_base.clear()
	_first.clear()
	_best = [-1, -1, 0.0]
	_quiet = 0.0
	for d: int in DeviceBindings.joypads():
		# plain arrays: a packed array is a value, changing one through the dictionary would change a copy
		var ax: Array = []
		for a in 10:
			ax.append(DeviceBindings.joy_axis(d, a))
		_base[d] = ax
		_lo[d] = ax.duplicate()
		_hi[d] = ax.duplicate()
		var bt := []
		for b in 64:
			bt.append(DeviceBindings.joy_button(d, b))
		_btn_base[d] = bt
	match kind:
		"steer":
			_prompt.text = I18n.t("Turn the wheel fully LEFT, then fully RIGHT, then back to the centre.")
		"axis":
			_prompt.text = I18n.t("Press the pedal or pull the lever all the way, then let it go.")
		_:
			_prompt.text = I18n.t("Press the button, or put the shifter in that gear.")
	_prompt.visible = true
	_done.visible = kind == "steer" or kind == "axis"

func _finish(save: bool) -> void:
	if save and _best[0] >= 0 and (_kind == "steer" or _kind == "axis"):
		var d: int = _best[0]
		var a: int = _best[1]
		var b := _binding(d, "axis", a)
		var base: float = _base[d][a]
		var lo: float = _lo[d][a]
		var hi: float = _hi[d][a]
		if _kind == "steer":
			# min: full left (the end it went to first), max: full right
			var first: float = _first.get("%d/%d" % [d, a], -1.0)
			b.min = lo if first < 0.0 else hi
			b.max = hi if first < 0.0 else lo
		else:
			# min: released (where it rested), max: the far end it reached
			b.min = base
			b.max = hi if absf(hi - base) >= absf(lo - base) else lo
		DeviceBindings.bindings()[_learning] = b
		changed.call()
	_learning = ""
	_prompt.visible = false
	_done.visible = false
	_refresh()

func _binding(d: int, kind: String, index: int) -> Dictionary:
	var key := PadMap.pad_key(DeviceBindings.joy_name(d))
	var nth := 0
	for o: int in DeviceBindings.joypads():
		if o == d:
			break
		if PadMap.pad_key(DeviceBindings.joy_name(o)) == key:
			nth += 1
	return {"dev": key, "nth": nth, "kind": kind, "index": index, "min": -1.0, "max": 1.0, "deadzone": 0.02}

func _process(dt: float) -> void:
	# live values of what is bound
	var bs := DeviceBindings.bindings()
	for key: String in _rows:
		var r: Dictionary = _rows[key]
		var v := 0.0
		if bs.has(key):
			var b: Dictionary = bs[key]
			if r.kind == "steer":
				v = DeviceBindings.steer_value(b)
			elif r.kind == "axis":
				v = DeviceBindings.axis_01(b)
			else:
				v = 1.0 if DeviceBindings.pressed(b) else 0.0
		(r.live as ProgressBar).value = v
	if _learning == "":
		return
	if _kind == "button" or _kind == "gear":
		for d: int in _btn_base:
			for b in 64:
				if DeviceBindings.joy_button(d, b) and not _btn_base[d][b]:
					DeviceBindings.bindings()[_learning] = _binding(d, "button", b)
					changed.call()
					_finish(false)
					return
		return
	# axes: track each one's range, the one that travelled furthest wins
	var moving := false
	for d: int in _base:
		for a in 10:
			var v := DeviceBindings.joy_axis(d, a)
			_lo[d][a] = minf(_lo[d][a], v)
			_hi[d][a] = maxf(_hi[d][a], v)
			var fk := "%d/%d" % [d, a]
			if not _first.has(fk) and absf(v - _base[d][a]) > 0.4:
				_first[fk] = signf(v - _base[d][a])
			var travel: float = _hi[d][a] - _lo[d][a]
			if travel > _best[2]:
				_best = [d, a, travel]
			if absf(v - _base[d][a]) > 0.15:
				moving = true
	# moved enough and back at rest for a second: done
	if _best[2] > (1.2 if _kind == "steer" else 0.5) and not moving:
		_quiet += dt
		if _quiet > 1.0:
			_finish(true)
	else:
		_quiet = 0.0
