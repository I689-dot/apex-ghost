class_name App
extends Node
## The game's shell (port of app.ts): screens (menu, lobby, briefing, loading, race, results), the connection to the
## room (offline RoomCore, a hosted game or the server), the race session and its HUD layers. Screens are built by the
## MenuScreen / LobbyScreen / ResultsScreen / SettingsPanel classes; this node owns the state and the flow.

var cars: Dictionary = {}
var track_index: Array = []
var conn: Connection = null
var room: Dictionary = {}
var me := ""
var session: RaceSession = null
var screen := "menu"
var spectating := false
var browsing := ""
var pending_race: Dictionary = {}
var pending_start_at = null
var audio: GameAudio = null
var gamepad: GamepadInput = null
## The weekend so far, per driver (practice / qualifying / grid / race) for the results tables.
var weekend := {}

var backdrop: TextureRect
var bg: CanvasLayer
var ui_layer: CanvasLayer
var ui: Control
var hud_layer: CanvasLayer
var touch_layer: CanvasLayer
var overlay_layer: CanvasLayer
var toasts: VBoxContainer
var countdown: Control
var _count_big: Label
var _count_sub: Label
var _count_info: Label
var pause_ui: Control = null
var _tyre_sent_for := ""
var _fill_timer: SceneTreeTimer = null
var _alone_since := 0.0
var _filled := false
var _brief_clock: Label = null
var touch: TouchControls = null
var perf: PerfOverlay = null
var graphics: Graphics = null

func _ready() -> void:
	# a phone's CPU: the vehicle model runs at 60 Hz (the lap time holds within 0.3 % of 120 Hz)
	if OS.has_feature("mobile"):
		Engine.physics_ticks_per_second = 60
	Settings.data.language = Settings.data.get("language", I18n.default_lang())
	I18n.set_lang(Settings.data.language)
	get_tree().root.theme = UIKit.build_theme()
	_build_layers()
	cars = CarsDb.file()
	track_index = TrackData.list_layouts()
	audio = GameAudio.new()
	add_child(audio)
	graphics = Graphics.new()
	add_child(graphics)
	gamepad = GamepadInput.new()
	gamepad.driving = func(): return screen == "race" and pause_ui == null and session != null
	gamepad.spectating = func(): return spectating
	add_child(gamepad)
	gamepad.connected_changed.connect(func(on, name): toast(I18n.t("Controller connected: {name}", {"name": name}) if on else I18n.t("Controller disconnected")))
	Account.changed.connect(func(_a): if screen == "menu": show_menu())
	show_menu()
	if OS.get_environment("APEX_AUTO") != "":
		_autotest.call_deferred()

func _build_layers() -> void:
	bg = CanvasLayer.new()
	bg.layer = -5
	add_child(bg)
	var black := ColorRect.new()
	black.color = UIKit.BG
	UIKit.full(black)
	bg.add_child(black)
	backdrop = TextureRect.new()
	UIKit.full(backdrop)
	backdrop.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	backdrop.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	backdrop.modulate = Color(1, 1, 1, 0.55)
	bg.add_child(backdrop)
	hud_layer = CanvasLayer.new()
	hud_layer.layer = 5
	add_child(hud_layer)
	touch_layer = CanvasLayer.new()
	touch_layer.layer = 6
	add_child(touch_layer)
	ui_layer = CanvasLayer.new()
	ui_layer.layer = 10
	add_child(ui_layer)
	ui = Control.new()
	UIKit.full(ui)
	ui.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ui_layer.add_child(ui)
	overlay_layer = CanvasLayer.new()
	overlay_layer.layer = 30
	add_child(overlay_layer)
	toasts = VBoxContainer.new()
	toasts.set_anchors_preset(Control.PRESET_CENTER_TOP)
	toasts.offset_top = 24
	toasts.mouse_filter = Control.MOUSE_FILTER_IGNORE
	toasts.alignment = BoxContainer.ALIGNMENT_BEGIN
	overlay_layer.add_child(toasts)
	# countdown text over the race
	countdown = Control.new()
	UIKit.full(countdown)
	countdown.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var cc := VBoxContainer.new()
	cc.set_anchors_preset(Control.PRESET_CENTER)
	cc.alignment = BoxContainer.ALIGNMENT_CENTER
	countdown.add_child(cc)
	_count_big = UIKit.label("", 120, UIKit.TEXT, true, 700)
	_count_big.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_count_sub = UIKit.label("", 28, UIKit.TEXT, true, 600)
	_count_sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_count_info = UIKit.label("", 20, UIKit.MUTED)
	_count_info.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	cc.add_child(_count_big)
	cc.add_child(_count_sub)
	cc.add_child(_count_info)
	hud_layer.add_child(countdown)
	countdown.visible = false

## A short message at the top (ms on screen).
func toast(text: String, ms: float = 2500.0) -> void:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", UIKit.box(Color(0.04, 0.04, 0.05, 0.92), UIKit.LINE, 1, 20, Vector2(18, 8)))
	var l := UIKit.label(text, 18)
	p.add_child(l)
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	toasts.add_child(p)
	get_tree().create_timer(ms / 1000.0).timeout.connect(func(): if is_instance_valid(p): p.queue_free())

func set_ui(c: Control) -> void:
	for ch in ui.get_children():
		ch.queue_free()
	UIKit.full(c)
	ui.add_child(c)

func set_backdrop(name: String, track_id: String = "") -> void:
	# the 3D world is drawn first: the backdrop layer must not cover it during a race
	bg.visible = name != ""
	if name == "":
		backdrop.texture = null
		return
	var map := ""
	for t in track_index:
		if t.id == track_id:
			map = str(t.get("map", ""))
	var suffix := "_" + map if map != "" and map != "nurburgring" and map != "nordschleife" else ""
	var path := "res://assets/ui/photo_%s%s.webp" % [name, suffix]
	if not ResourceLoader.exists(path):
		path = "res://assets/ui/photo_%s.webp" % name
	backdrop.texture = load(path) if ResourceLoader.exists(path) else null

func my_info() -> Dictionary:
	for p in room.get("players", []):
		if p.id == me:
			return p
	return {}

func track_entry(id: String) -> Dictionary:
	for t in track_index:
		if t.id == id:
			return t
	return {}

func send(m: Dictionary) -> void:
	if conn != null:
		conn.send_json(m)

# ------------------------------------------------------------------ menu ---

func show_menu(error: String = "") -> void:
	screen = "menu"
	set_pause(false)
	set_countdown("", "")
	teardown_connection()
	set_backdrop("hero")
	Account.set_presence({"state": "menu", "room": null, "trackId": null, "session": null})
	set_ui(MenuScreen.build(self, error))

func join(code: String, nick: String, spectate: bool = false) -> String:
	spectating = spectate
	conn = Connection.new().setup(code, nick, spectate)
	add_child(conn)
	conn.message.connect(_on_message)
	var r := await conn.connect_to_room()
	if not r.ok:
		var msg := {
			"room_not_found": I18n.t("Room not found. Check the code with your friend."),
			"room_full": I18n.t("Room is full ({n} players).", {"n": Const.MAX_PLAYERS}),
			"nick_taken": I18n.t("That nickname is already used in this room. Pick another one."),
		}
		var text: String = msg.get(r.code, I18n.t(str(r.message)))
		teardown_connection()
		return text
	return ""

func teardown_connection() -> void:
	if conn != null and P2p.instance != null and conn.code == P2p.instance.code:
		P2p.stop_hosting()
	if conn != null:
		conn.close_connection()
		conn.queue_free()
		conn = null
	room = {}
	_filled = false
	_alone_since = 0.0
	if session != null:
		session.dispose()
		session.queue_free()
		session = null
	_clear_race_layers()

func leave() -> void:
	if conn != null:
		conn.leave()
	show_menu()

func _clear_race_layers() -> void:
	for ch in hud_layer.get_children():
		if ch != countdown:
			ch.queue_free()
	for ch in touch_layer.get_children():
		ch.queue_free()
	touch = null

# -------------------------------------------------------------- messages ---

func _on_message(m: Dictionary) -> void:
	match m.t:
		"welcome":
			me = m.you
			room = m.room
			if m.get("race", null) != null and m.room.phase != "lobby":
				if session == null or session.race.raceId != m.race.raceId:
					start_loading(m.race, m.get("startAt", null))
			elif screen != "results":
				show_lobby()
			if spectating:
				toast(I18n.t("Watching this room: the next session will show here."), 4000.0)
			if my_info().get("waiting", false):
				toast(I18n.t("A race is in progress. You will join the next one."), 5000.0)
		"room":
			room = m.room
			_auto_fill()
			if m.room.phase == "briefing" and (screen == "lobby" or screen == "briefing"):
				render_briefing()
			elif screen == "briefing":
				show_lobby()
			elif screen == "lobby":
				render_lobby()
			elif screen == "watch":
				render_watch()
		"carLock":
			if not m.ok and m.get("carId", null) != null:
				var owner := ""
				for p in room.get("players", []):
					if p.id == m.get("owner"):
						owner = p.nick
				toast(I18n.t("{owner} already has that car.", {"owner": owner}) if owner != "" else I18n.t("That car is not available."))
		"raceSetup":
			start_loading(m.race, null)
		"countdown":
			if session != null:
				session.set_start_at(m.startAt)
			else:
				pending_start_at = m.startAt
		"error":
			if m.fatal:
				show_menu(I18n.t(m.message))
			else:
				toast(I18n.t(m.message))

## Nobody joined an online room within 15 s: the host gets AI drivers, as online games fill a lobby that is taking too long.
func _auto_fill() -> void:
	var online := conn != null and not LocalRoom.is_local_code(room.get("code", conn.code))
	var host: bool = my_info().get("host", false)
	var humans: int = room.get("players", []).filter(func(p): return not p.bot).size()
	var bots: int = room.get("players", []).filter(func(p): return p.bot).size()
	if room.is_empty() or not online or not host or room.phase != "lobby" or humans > 1 or bots > 0 or spectating:
		if room.is_empty() or room.phase != "lobby" or humans > 1:
			_alone_since = 0.0
		return
	if _filled:
		return
	if _alone_since == 0.0:
		_alone_since = Time.get_ticks_msec()
		_fill_timer = get_tree().create_timer(15.0)
		_fill_timer.timeout.connect(func():
			if room.is_empty() or room.phase != "lobby" or _filled:
				return
			if room.players.filter(func(p): return not p.bot).size() > 1 or room.players.any(func(p): return p.bot):
				return
			_filled = true
			for i in 7:
				send({"t": "addBot"})
			toast(I18n.t("Nobody joined in 15 s: AI drivers added. Players can still join."), 5000.0))

# ----------------------------------------------------------------- lobby ---

func show_lobby() -> void:
	if screen == "results":
		weekend.clear()
	if spectating:
		_drop_session()
		render_watch()
		return
	screen = "lobby"
	_drop_session()
	set_backdrop("straight", room.get("conditions", {}).get("trackId", ""))
	if room.get("phase", "") == "briefing":
		render_briefing()
	else:
		render_lobby()

func _drop_session() -> void:
	if session != null:
		session.dispose()
		session.queue_free()
		session = null
	_clear_race_layers()
	countdown.visible = false

func render_lobby() -> void:
	if room.is_empty() or conn == null:
		return
	if screen == "lobby":
		set_backdrop("straight", room.conditions.trackId)
	var mine := my_info()
	# the room shows everyone's starting tyres: tell it ours (saved from last time)
	if not mine.is_empty() and (room.phase == "lobby" or room.phase == "briefing") and mine.get("tyre") != Settings.data.carSetup.tyre and _tyre_sent_for != room.code:
		_tyre_sent_for = room.code
		send({"t": "setTyre", "tyre": Settings.data.carSetup.tyre})
	set_ui(LobbyScreen.build(self))

func render_watch() -> void:
	screen = "watch"
	set_ui(LobbyScreen.build_watch(self))

func render_briefing() -> void:
	if room.is_empty() or conn == null:
		return
	screen = "briefing"
	var mine := my_info()
	if not mine.is_empty() and mine.get("tyre") != Settings.data.carSetup.tyre:
		send({"t": "setTyre", "tyre": Settings.data.carSetup.tyre})
	set_backdrop("aerial", room.conditions.trackId)
	set_ui(LobbyScreen.build_briefing(self))

func _process(_dt: float) -> void:
	# the performance overlay follows the setting (Settings → General)
	if Settings.data.showPerf and perf == null:
		perf = PerfOverlay.new()
		overlay_layer.add_child(perf)
	elif not Settings.data.showPerf and perf != null:
		perf.queue_free()
		perf = null
	if perf != null:
		perf.conn = conn
		perf.graphics = graphics
		perf.remotes = func(): return session.remotes.values().map(func(r): return r.buffer) if session != null else []
	if screen == "briefing" and _brief_clock != null and is_instance_valid(_brief_clock) and conn != null and room.get("briefingUntil") != null:
		var left := maxf(0.0, room.briefingUntil - conn.server_now())
		_brief_clock.text = "%d s" % ceili(left / 1000.0)

# --------------------------------------------------------------- loading ---

func start_loading(race: Dictionary, start_at) -> void:
	if conn == null or room.is_empty():
		return
	if screen == "loading" and pending_race.get("raceId") == race.raceId:
		return
	screen = "loading"
	pending_race = race
	pending_start_at = start_at
	set_backdrop("aerial", race.trackId)
	_drop_session()
	var bar := ProgressBar.new()
	bar.show_percentage = false
	bar.custom_minimum_size = Vector2(520, 10)
	bar.max_value = 1.0
	var label := UIKit.label(I18n.t("Preparing…"), 18, UIKit.MUTED)
	var w0 := Weather.weather_at(race.weather, 0.0)
	var weather_txt := I18n.t(Weather.LABEL[race.weather.kind])
	if race.weather.get("change") != null:
		weather_txt = I18n.t("{weather} → {later} later", {"weather": I18n.t(Weather.LABEL[race.weather.kind]), "later": I18n.t(Weather.LABEL[race.weather.change.to])})
	var info := "%s · %s" % [weather_txt, Weather.format_hour(w0.hour)]
	var tr := track_entry(race.trackId)
	var title := I18n.t("{track} · {min}-minute qualifying", {"track": I18n.t(tr.get("name", "")), "min": roundi(race.sessionMs / 60000.0)}) if race.kind != "race" else I18n.t(tr.get("name", ""))
	var col := UIW.vbox(14)
	col.set_anchors_preset(Control.PRESET_CENTER)
	col.add_child(UIW.logo(40))
	col.add_child(UIW.h2(title))
	col.add_child(UIKit.label(info, 20, UIKit.MUTED))
	col.add_child(bar)
	col.add_child(label)
	var root := CenterContainer.new()
	root.add_child(col)
	set_ui(root)
	var slot: int = race.slots.get(me, 0) + 1
	var s := RaceSession.new(race, room, me, cars, conn, {
		"on_countdown_text": func(text, sub = ""): set_countdown(text, sub),
		"on_pause_toggle": func(open): set_pause(open),
		"on_results": func(m): show_results(m),
		"on_fatal": func(msg): show_menu(msg),
		"audio": func(): return audio,
	}, spectating)
	session = s
	add_child(s)
	await s.load_session(func(l, t, lbl):
		bar.value = (l / t) if t > 0.0 else 0.0
		label.text = lbl)
	if session != s:
		return  # superseded
	if pending_start_at != null:
		s.set_start_at(pending_start_at)
	screen = "race"
	set_backdrop("")
	_count_info.text = "P%d · %s" % [slot, info]
	set_ui(Control.new())
	var hud := s.hud_node()
	if hud.get_parent() != null:
		hud.get_parent().remove_child(hud)
	hud_layer.add_child(hud)
	UIKit.full(hud)
	if s.cinematic != null:
		hud_layer.add_child(s.cinematic.el)
	hud_layer.move_child(countdown, -1)
	touch = TouchControls.new()
	touch.key_action.connect(_touch_key)
	touch.skip_intro.connect(func(): _key_event(KEY_ENTER, true); _key_event(KEY_ENTER, false))
	touch.spectator_key.connect(func(code): var k := KeyMap.key_of(code); _key_event(k, true); _key_event(k, false))
	touch_layer.add_child(touch)
	touch.spectating = spectating
	touch.set_active(DisplayServer.is_touchscreen_available())
	s.start()
	Account.set_presence({"state": "watching" if spectating else "racing", "room": null if LocalRoom.is_local_code(conn.code) else conn.code, "trackId": race.trackId, "session": race.kind})

func _touch_key(action: String, down: bool) -> void:
	var codes: Array = Settings.data.bindings.get(action, [])
	if not codes.is_empty():
		_key_event(KeyMap.key_of(codes[0]), down)

func _key_event(keycode: int, down: bool) -> void:
	if keycode == KEY_NONE:
		return
	var e := InputEventKey.new()
	e.physical_keycode = keycode
	e.keycode = keycode
	e.pressed = down
	Input.parse_input_event(e)

func set_countdown(text: String, sub: String) -> void:
	_count_big.text = I18n.t(text) if text == "GO" else text
	_count_big.add_theme_color_override("font_color", UIKit.GOOD if text == "GO" else UIKit.TEXT)
	_count_sub.text = sub
	_count_info.visible = (text != "" and text != "GO") or sub != ""
	countdown.visible = text != "" or sub != ""

# ----------------------------------------------------------------- pause ---

func set_pause(open: bool) -> void:
	if pause_ui != null:
		pause_ui.queue_free()
		pause_ui = null
	if not open:
		return
	var m := UIW.modal(overlay_layer, 420)
	pause_ui = m.root
	var b: VBoxContainer = m.body
	b.add_child(UIW.h2(I18n.t("Paused")))
	b.add_child(UIW.muted(I18n.t("The race keeps running.")))
	b.add_child(UIKit.button(I18n.t("Resume"), func(): if session != null: session.toggle_pause(false), true))
	b.add_child(UIKit.button(I18n.t("Reset to track (+5 s penalty)"), func():
		if session != null:
			session.toggle_pause(false)
			session.request_reset()))
	b.add_child(UIKit.button(I18n.t("Settings"), open_settings))
	b.add_child(UIKit.button(I18n.t("Leave race"), leave))

func open_settings() -> void:
	var lang := I18n.get_lang()
	var panel := SettingsPanel.build(self, func():
		if I18n.get_lang() != lang:
			if screen == "menu":
				show_menu()
		if session != null:
			session.apply_settings()
		audio.set_levels(Settings.data.audio)
		graphics.apply_quality())
	overlay_layer.add_child(panel)

# --------------------------------------------------------------- results ---

func show_results(m: Dictionary) -> void:
	set_pause(false)
	var gain = null
	var stats := {}
	if session != null:
		stats = session.career_stats()
	if not stats.is_empty() and conn != null and LocalRoom.is_local_code(conn.code) and not spectating:
		var mine = null
		for r in m.rows:
			if r.id == me:
				mine = r
		var ok: bool = mine != null and ((not mine.dnf and mine.totalMs != null) if m.kind == "race" else mine.bestLapMs != null)
		var s := stats.duplicate()
		s.merge({
			"kind": "race" if m.kind == "race" else ("practice" if m.kind == "practice" else "qualifying"),
			"position": mine.position if ok else 0, "field": m.rows.size(),
			"start": session.race.grid.find(me) + 1, "difficulty": Settings.data.ai.difficulty,
		}, true)
		gain = CareerData.add_session(s)
	_drop_session()
	screen = "results"
	set_backdrop("pole", pending_race.get("trackId", ""))
	set_ui(ResultsScreen.build(self, m, gain))

## Dev: APEX_AUTO=solo plays through menu → lobby → briefing → race by itself (SHOT_DIR saves a screenshot per step).
func _autotest() -> void:
	var shot := func(n: String):
		var dir := OS.get_environment("SHOT_DIR")
		if dir != "":
			await get_tree().process_frame
			get_viewport().get_texture().get_image().save_png("%s/app_%s.png" % [dir, n])
	await get_tree().create_timer(1.0).timeout
	await shot.call("menu")
	var err := await join(LocalRoom.create(), "Max")
	print("join: ", err)
	await get_tree().create_timer(0.6).timeout
	await shot.call("lobby_circuit")
	for step in ["conditions", "session", "rules", "car"]:
		LobbyScreen._step.step = step
		render_lobby()
		await get_tree().create_timer(0.3).timeout
		await shot.call("lobby_" + step)
	send({"t": "selectCar", "carId": CarsDb.selectable()[0].id})
	send({"t": "addBot"})
	send({"t": "addBot"})
	send({"t": "ready", "ready": true})
	await get_tree().create_timer(0.5).timeout
	await shot.call("lobby_ready")
	send({"t": "start"})
	await get_tree().create_timer(1.0).timeout
	await shot.call("briefing")
	send({"t": "briefed"})
	for i in 40:
		await get_tree().create_timer(0.5).timeout
		if screen == "race":
			break
	await shot.call("loaded")
	await get_tree().create_timer(10.0).timeout
	await shot.call("race")
	await get_tree().create_timer(6.0).timeout
	await shot.call("race2")
	print("autotest done, screen=", screen)
	get_tree().quit()
