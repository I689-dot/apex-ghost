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
## Where back goes from a screen of the mobile layout (screens named "m_..."): MobileModes, MobilePass, the store.
var back_to: Callable = Callable()
var pending_start_at = null
var audio: GameAudio = null
var gamepad: GamepadInput = null
var devices: DeviceBindings
## The weekend so far, per driver (practice / qualifying / grid / race) for the results tables.
var weekend := {}

var backdrop: TextureRect
var decor: MenuDecor
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
var replay_ui: Control = null
var _tyre_sent_for := ""
var _fill_timer: SceneTreeTimer = null
var _alone_since := 0.0
var _filled := false
var _brief_clock: Label = null
var touch: TouchControls = null
var perf: PerfOverlay = null
var graphics: Graphics = null
## The screen the UI shows (screen + page): a new one fades in, a re-render of the same one keeps the pad's focus.
var _ui_key := ""

func _ready() -> void:
	# a phone's CPU: the vehicle model runs at 60 Hz (the lap time holds within 0.3 % of 120 Hz)
	if OS.has_feature("mobile"):
		Engine.physics_ticks_per_second = 60
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
	# wheels, pedal sets, shifters and handbrakes, each bound in the settings
	devices = DeviceBindings.new()
	add_child(devices)
	gamepad.connected_changed.connect(func(on, name): toast(I18n.t("Controller connected: {name}", {"name": name}) if on else I18n.t("Controller disconnected")))
	Account.changed.connect(func(_a): if screen == "menu": show_start())
	show_start()
	var auto := OS.get_environment("APEX_AUTO")
	if auto == "intro" or (auto == "" and Settings.data.get("introCinematic", true)):
		_play_intro()
	if auto == "intro":
		_shots_only.call_deferred()
	elif auto == "ui":
		_ui_shots.call_deferred()
	elif auto != "":
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
	backdrop.modulate = Color(1, 1, 1, 0.8)
	bg.add_child(backdrop)
	# the photo drifts slowly behind the menus (one looping tween, no per-frame script)
	backdrop.resized.connect(func(): backdrop.pivot_offset = backdrop.size * 0.5)
	var drift := backdrop.create_tween().set_loops()
	drift.tween_property(backdrop, "scale", Vector2(1.07, 1.07), 26.0).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	drift.tween_property(backdrop, "scale", Vector2.ONE, 26.0).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	decor = MenuDecor.new()
	UIKit.full(decor)
	bg.add_child(decor)
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
	# the menus' theme on their layer's root (the window's theme stops at the CanvasLayer)
	ui.theme = UIKit.theme
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
	_count_big = UIKit.label("", 84, UIKit.TEXT, true, 700)
	_count_big.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_count_sub = UIKit.label("", 22, UIKit.TEXT, true, 600)
	_count_sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_count_info = UIKit.label("", 16, UIKit.MUTED)
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
	var key := "%s/%s/%s/%s" % [screen, LobbyScreen._page, MenuScreen._tab, CareerScreen._tab]
	# a re-render of the same page (the lobby redraws on every room update) puts the pad's focus back where it was
	var keep := PackedInt32Array()
	var hidden := true
	var old: Control = ui.get_child(ui.get_child_count() - 1) if ui.get_child_count() > 0 else null
	var f := get_viewport().gui_get_focus_owner()
	if key == _ui_key and old != null and f != null and old.is_ancestor_of(f):
		hidden = not f.has_focus(true)
		var n: Node = f
		while n != old:
			keep.insert(0, n.get_index())
			n = n.get_parent()
	for ch in ui.get_children():
		ch.queue_free()
	UIKit.full(c)
	ui.add_child(c)
	if key != _ui_key:
		c.modulate.a = 0.0
		c.create_tween().tween_property(c, "modulate:a", 1.0, 0.18)
	_ui_key = key
	_restore_focus.call_deferred(c, keep, hidden)

func _restore_focus(root: Control, path: PackedInt32Array, hidden: bool) -> void:
	if not is_instance_valid(root) or not root.is_inside_tree() or screen == "race":
		return
	for c in overlay_layer.get_children():
		if c.has_meta("modal"):
			return  # a modal keeps the focus
	var n: Node = root
	for i in path:
		if i >= n.get_child_count():
			n = null
			break
		n = n.get_child(i)
	if n != null and n != root and n is Control and (n as Control).focus_mode != Control.FOCUS_NONE and (n as Control).is_visible_in_tree():
		(n as Control).grab_focus(hidden)
	elif get_viewport().gui_get_focus_owner() == null or not root.is_ancestor_of(get_viewport().gui_get_focus_owner()):
		UIW.focus_first(root)

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

## Raced offline this session (the sign-in screen's way in when the server cannot be reached): solo only.
var offline := false

## Where the game opens: the sign-in screen, or the menu once signed in (also when playing offline, when the server
## keeps no accounts, in tests and in the automated runs).
func show_start() -> void:
	if Account.account() != null or offline or Account.accounts_enabled() == false or Settings.testing or OS.get_environment("APEX_AUTO") != "":
		show_menu()
		return
	show_sign_in()

func show_sign_in() -> void:
	screen = "signin"
	teardown_connection()
	set_backdrop("hero")
	set_ui(SocialUI.sign_in_screen(self, func(): show_menu(), func(): offline = true; show_menu()))
	# a server that keeps no accounts: nobody signs in, straight on
	var on: bool = await Account.probe_accounts()
	if not on and screen == "signin":
		show_menu()

func show_menu(error: String = "") -> void:
	screen = "menu"
	DisplayServer.screen_set_keep_on(false)
	set_pause(false)
	set_countdown("", "")
	teardown_connection()
	set_backdrop("hero")
	Account.set_presence({"state": "menu", "room": null, "trackId": null, "session": null})
	# a career race left before it was raced: its AI level back, nothing scored
	var ev: Dictionary = Progression.data().event
	if ev.has("difficulty"):
		Settings.data.ai.difficulty = float(ev.difficulty)
		Progression.clear_event()
	if mobile_layout():
		set_ui(MobileHome.build(self))
		if error != "":
			toast(error)
		return
	set_ui(MenuScreen.build(self, error))

## The phone layout (MobileHome, after RESOURCES/UI-MOBILE-REFERENCE) or the PC's (MenuScreen): Display › Menu layout,
## "auto" picks the phone layout on a touch screen. APEX_MOBILE_UI=1 forces it (screenshots on the PC).
func mobile_layout() -> bool:
	if OS.get_environment("APEX_MOBILE_UI") != "":
		return true
	var l := str(Settings.data.display.get("menuLayout", "auto"))
	return l == "mobile" or (l == "auto" and UIKit.touch())

## The PC menu's tab (Friends, Online) from the mobile layout, with back to the home.
func show_classic_menu(tab: String) -> void:
	MenuScreen._tab = tab
	screen = "m_classic"
	back_to = func(): show_menu()
	set_ui(MenuScreen.build(self))

## The solo career's page (rank, licence, Driver Rating, record, achievements).
func show_career() -> void:
	screen = "career"
	set_backdrop("pole")
	set_ui(CareerScreen.build(self))

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
	LobbyScreen.ensure_car(self)
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

## Menus and modals are enlarged on a touch screen; the race (HUD, touch pads) keeps the base scale.
func _apply_ui_scale() -> void:
	var want := 1.0
	if UIKit.touch():
		var in_race := screen == "race" or screen == "loading"
		var modal_open := false
		for c in overlay_layer.get_children():
			if c != toasts and c != perf:
				modal_open = true
		if not in_race or modal_open:
			want = UIKit.ui_scale()
	var win := get_window()
	if not is_equal_approx(win.content_scale_factor, want):
		win.content_scale_factor = want

func _process(_dt: float) -> void:
	_apply_ui_scale()
	# while driving no button keeps the focus: Space and Enter are driving keys, not presses of the last clicked button
	if screen == "race" and pause_ui == null and replay_ui == null:
		var f := get_viewport().gui_get_focus_owner()
		if f is BaseButton:
			f.release_focus()
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
	# a circuit that comes as a download and is not installed (a room's host picked it): back to the lobby, where the
	# main action downloads it (LobbyScreen); the race goes on without us
	if not Packs.ready_for(str(race.trackId)):
		toast(I18n.t("Download the circuit to race here."))
		show_lobby()
		return
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
	bar.custom_minimum_size = Vector2(520, 4)
	bar.max_value = 1.0
	var label := UIKit.label(I18n.t("Preparing…"), 17, UIKit.SOFT)
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
	col.add_child(UIKit.label(title.to_upper(), 40, UIKit.TEXT, true, 700))
	col.add_child(UIKit.label(info, 20, UIKit.SOFT))
	col.add_child(bar)
	col.add_child(label)
	var root := Control.new()
	var my_car = null
	for c in cars.cars:
		if c.id == my_info().get("carId"):
			my_car = {"url": CarStudio.picture(c, CarStudio.my_livery(), true), "name": c.name}
	var reel := CinematicReel.new(CinematicReel.track_reel(str(tr.get("map", "")), I18n.t(tr.get("name", "")), my_car, I18n.t("RACE") if race.kind == "race" else I18n.t("QUALIFYING")), {"loop": true, "shotMs": 4600.0})
	root.add_child(reel)
	var center := CenterContainer.new()
	UIKit.full(center)
	center.add_child(col)
	root.add_child(center)
	set_ui(root)
	var slot: int = race.slots.get(me, 0) + 1
	var s := RaceSession.new(race, room, me, cars, conn, {
		"on_countdown_text": func(text, sub = ""): set_countdown(text, sub),
		"on_pause_toggle": func(open): set_pause(open),
		"on_replay_toggle": func(open): set_replay(open),
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
	# the sun's glare, under the HUD (drawn first in the same layer)
	if not OS.has_feature("mobile"):
		var flare := LensFlare.new()
		var sref = s
		flare.camera_of = func(): return get_viewport().get_camera_3d()
		flare.sun_dir_of = func(): return sref.env.sun_dir if is_instance_valid(sref) and sref.env != null else Vector3.UP
		flare.strength_of = func(): return sref.env.flare_strength if is_instance_valid(sref) and sref.env != null else 0.0
		hud_layer.add_child(flare)
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
	touch.chat_enabled = LocalRoom.is_local_code(conn.code) and not spectating
	touch.set_active(UIKit.touch())
	DisplayServer.screen_set_keep_on(true)
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
	var m := UIW.modal(overlay_layer, 440)
	pause_ui = m.root
	var b: VBoxContainer = m.body
	UIW.modal_head(b, I18n.t("Paused"), func(): if session != null: session.toggle_pause(false))
	# the session's own Esc closes the pause menu: App.go_back leaves it alone
	pause_ui.remove_meta("modal")
	pause_ui.remove_meta("close")
	b.add_child(UIW.muted(I18n.t("The race keeps running.")))
	b.add_child(UIW.default_focus(UIKit.button(I18n.t("Resume"), func(): if session != null: session.toggle_pause(false), true)))
	if session != null and session.replay.size() >= 40:
		b.add_child(UIKit.button(I18n.t("Replay"), func():
			session.toggle_pause(false)
			session.open_replay()))
	b.add_child(UIKit.button(I18n.t("Reset to track (+5 s penalty)"), func():
		if session != null:
			session.toggle_pause(false)
			session.request_reset()))
	b.add_child(UIKit.button(I18n.t("Settings"), open_settings))
	b.add_child(UIKit.button(I18n.t("Leave race"), leave))

## The replay's control bar (RaceSession.open_replay / close_replay).
func set_replay(open: bool) -> void:
	if replay_ui != null:
		replay_ui.queue_free()
		replay_ui = null
	if not open or session == null:
		return
	replay_ui = ReplayBar.new(session)
	overlay_layer.add_child(replay_ui)

func open_settings() -> void:
	var panel := SettingsPanel.build(self, func():
		if session != null:
			session.apply_settings()
		audio.set_levels(Settings.data.audio)
		graphics.apply_quality())
	# back on the screen under it, the pad's focus returns there
	panel.tree_exited.connect(func(): if is_instance_valid(ui) and is_inside_tree() and screen != "race": UIW.focus_first(ui))

# --------------------------------------------------------------- results ---

func show_results(m: Dictionary) -> void:
	set_pause(false)
	var gain = null
	var prog := {}
	var ev_result := {}
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
			"map": str(track_entry(pending_race.get("trackId", "")).get("map", "")),
		}, true)
		gain = CareerData.add_session(s)
		# the mobile layout's progression: pass XP, contracts, chests; a career cup race's trophies
		prog = Progression.record_session(s)
		var pev: Dictionary = Progression.data().event
		if m.kind == "race" and not pev.is_empty():
			var want := str(app_event_track(pev))
			if want == "" or want == str(pending_race.get("trackId", "")):
				if pev.has("difficulty"):
					Settings.data.ai.difficulty = float(pev.difficulty)
				ev_result = Progression.score_event(s.position, s.field)
	_drop_session()
	screen = "results"
	set_backdrop("pole", pending_race.get("trackId", ""))
	set_ui(ResultsScreen.build(self, m, gain))
	if mobile_layout() and not prog.is_empty():
		MobileHome.race_rewards(self, prog, ev_result, gain)

## The circuit of the career race being driven ("" for the week's featured race: MobileModes.weekly picks it).
func app_event_track(ev: Dictionary) -> String:
	if str(ev.get("cup", "")) == "weekly":
		return MobileModes.weekly(self).track
	var c := Progression.cup(str(ev.get("cup", "")))
	return str(c[3][int(ev.race)][0]) if not c.is_empty() else ""

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
	if OS.get_environment("TRACK") != "":
		send({"t": "setConditions", "trackId": OS.get_environment("TRACK")})
	await get_tree().create_timer(0.6).timeout
	await shot.call("lobby_hub")
	for step in ["circuit", "conditions", "session", "rules", "car", "drivers"]:
		LobbyScreen._page = step
		render_lobby()
		await get_tree().create_timer(0.3).timeout
		await shot.call("lobby_" + step)
	if OS.get_environment("AUTODRIVE") != "":
		send({"t": "setSession", "minutes": 5})
		send({"t": "setRaceLaps", "laps": 0})
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
	await get_tree().create_timer(6.0).timeout
	await shot.call("racing")
	if OS.get_environment("AUTODRIVE") != "":
		# the AI drives my car through the whole session: the results screen, the career, the lobby after it
		session.autodrive = AiDriver.new(session.track_data, session.vehicle, 0.95, 0.0)
		session.autodrive.human = false
		var t0 := Time.get_ticks_msec()
		var n := 0
		while screen != "results" and Time.get_ticks_msec() - t0 < 9 * 60 * 1000:
			await get_tree().create_timer(30.0).timeout
			n += 1
			await shot.call("drive_%02d" % n)
			print("t=%ds screen=%s speed=%d" % [(Time.get_ticks_msec() - t0) / 1000, screen, int(session.vehicle.telemetry.speed * 3.6) if session != null else -1])
		await get_tree().create_timer(2.0).timeout
		await shot.call("results")
		print("results reached: ", screen == "results")
		get_tree().quit()
		return
	await get_tree().create_timer(10.0).timeout
	await shot.call("race")
	await get_tree().create_timer(6.0).timeout
	await shot.call("race2")
	print("autotest done, screen=", screen)
	get_tree().quit()

## The intro when the game opens (once per install and after updates; a tap or a key skips it): the logo over a short reel of
## the circuit and a car, then the menu (port of playIntro in main.ts).
func _play_intro() -> void:
	var intro_cars := ["ferrari_296_gt3_verstappen", "corvette_z06_gt3r", "mclaren_720s_gt3_inception_racing", "lamborghini_huracan_gt3_evo2", "2025_bmw_m4_gt3_evo_g82", "2024_porsche_992_gt3_r"]
	var pool: Array = cars.cars.filter(func(c): return intro_cars.has(c.id))
	if pool.is_empty():
		pool = cars.cars.filter(func(c): return c.role != "safety")
	if pool.is_empty():
		return
	var intro := IntroCinematic.new(pool[randi() % pool.size()])
	# the studio is drawn by itself: the menu and its backdrop wait under it
	bg.visible = false
	ui.visible = false
	add_child(intro)
	var over := intro.overlay()
	overlay_layer.add_child(over)
	intro.finished.connect(func():
		Settings.data.introSeen = true
		Settings.save()
		bg.visible = true
		ui.visible = true
		ui.modulate.a = 0.0
		ui.create_tween().tween_property(ui, "modulate:a", 1.0, 0.5)
		over.queue_free()
		intro.queue_free())
	intro.play()

func _shots_only() -> void:
	for t in [1.0, 2.6, 4.2, 6.8, 9.6]:
		await get_tree().create_timer(t).timeout
		get_viewport().get_texture().get_image().save_png("%s/intro_%d.png" % [OS.get_environment("SHOT_DIR"), int(t)])
	get_tree().quit()

## Dev: APEX_AUTO=ui screenshots the menus: the menu's tabs and modals, the career's pages, every settings page, the
## lobby's pages and the briefing of a solo room, and a results screen from made-up rows (nothing is saved).
func _ui_shots() -> void:
	var dir := OS.get_environment("SHOT_DIR")
	var shot := func(n: String):
		await get_tree().create_timer(0.7).timeout
		get_viewport().get_texture().get_image().save_png("%s/ui_%s.png" % [dir, n])
	var clear := func():
		for c in overlay_layer.get_children():
			if c != toasts and c != perf:
				c.queue_free()
	await get_tree().create_timer(1.5).timeout
	await shot.call("menu")
	# the pad's D-pad: the focus ring moves to the next card
	var pad := InputEventAction.new()
	pad.action = "ui_right"
	pad.pressed = true
	Input.parse_input_event(pad)
	await shot.call("menu_pad_focus")
	for t in ["online", "friends"]:
		MenuScreen._tab = t
		show_menu()
		await shot.call("menu_" + t)
	MenuScreen._tab = "play"
	for t in ["profile", "achievements", "ranks"]:
		CareerScreen._tab = t
		show_career()
		await shot.call("career_" + t)
	CareerScreen._tab = "profile"
	show_sign_in()
	await shot.call("signin")
	show_menu()
	ChampionshipUI.open(self, func(): return "Max")
	await shot.call("champ")
	clear.call()
	SocialUI.records_modal(self)
	await shot.call("records")
	clear.call()
	for tab in ["graphics", "display", "view", "driving", "interface", "audio", "controls", "controller"]:
		SettingsPanel._tab = tab
		var panel := SettingsPanel.build(self, func(): pass)
		await shot.call("settings_" + tab)
		panel.queue_free()
	# a solo room: every lobby page, then the briefing's pages
	await join(LocalRoom.create(), "Max")
	await get_tree().create_timer(0.6).timeout
	for step in ["hub", "circuit", "car", "session", "conditions", "rules", "drivers"]:
		LobbyScreen._page = step
		render_lobby()
		await shot.call("lobby_" + step)
	LobbyScreen._page = "hub"
	render_lobby()
	send({"t": "addBot"})
	send({"t": "addBot"})
	send({"t": "ready", "ready": true})
	send({"t": "start"})
	await get_tree().create_timer(0.8).timeout
	for t in ["setup", "advanced", "saved"]:
		LobbyScreen._brief_tab = t
		render_briefing()
		await shot.call("briefing_" + t)
	LobbyScreen._brief_tab = "setup"
	# the results, from made-up rows, with the room closed so no championship is scored
	var ids: Array = CarsDb.selectable().map(func(c): return c.id)
	var nicks := ["Max", "Harry Ashdown", "Sem van Doorn", "Lucas Moreau", "Jonas Keller", "Marco Rossi"]
	var rows: Array = []
	for i in nicks.size():
		rows.append({"id": me if i == 0 else "bot%d" % i, "nick": nicks[i], "carId": ids[(i * 3) % ids.size()], "position": i + 1, "totalMs": 612345.0 + i * 1834.0,
			"penaltyMs": 5000.0 if i == 3 else 0.0, "gapMs": i * 1834.0, "bestLapMs": 118234.0 + i * 211.0, "validLaps": 5, "dnf": i == 5})
	var gain := {"lines": [["Race finished", 120], ["Position", 150], ["Clean laps", 40]], "xp": 310, "xpBefore": 0, "srBefore": 2.5, "srAfter": 2.62,
		"levelBefore": 1, "levelAfter": 1, "licenceBefore": "R", "licenceAfter": "R", "rankBefore": "Rookie", "rankAfter": "Rookie", "ratingBefore": 1350, "ratingAfter": 1372,
		"achievements": [CareerData.ACHIEVEMENTS[0]]}
	pending_race = {"trackId": "spa"}
	teardown_connection()
	weekend.clear()
	screen = "results"
	set_backdrop("pole", "spa")
	set_ui(ResultsScreen.build(self, {"kind": "race", "rows": rows, "fastestLap": {"id": me, "ms": 118234.0}, "raceId": 1}, gain))
	await shot.call("results")
	get_tree().quit()

## Esc and the pad's B (GamepadInput sends Esc) step back in the menus: the top modal closes, a lobby page returns to
## its overview, the career to the menu. The race keeps Esc for its pause menu.
func _unhandled_input(e: InputEvent) -> void:
	if e is InputEventKey and e.pressed and not e.echo and e.keycode == KEY_ESCAPE and screen != "race" and screen != "loading":
		if go_back():
			get_viewport().set_input_as_handled()

## One step back; false when there is nowhere to go from here.
func go_back() -> bool:
	var top: Node = null
	for c in overlay_layer.get_children():
		if c.has_meta("modal") and not c.is_queued_for_deletion():
			top = c
	if top != null:
		if top.has_meta("close"):
			(top.get_meta("close") as Callable).call()
		else:
			top.queue_free()
		return true
	if screen.begins_with("m_") and back_to.is_valid():
		back_to.call()
		return true
	match screen:
		"career":
			show_menu()
			return true
		"lobby":
			if LobbyScreen.back_page():
				render_lobby()
				return true
		"menu":
			if MenuScreen._tab != "play":
				MenuScreen._tab = "play"
				show_menu()
				return true
	return false

## The phone's back button, and the app going to the background.
func _notification(what: int) -> void:
	match what:
		NOTIFICATION_WM_GO_BACK_REQUEST:
			if screen != "race" and overlay_layer.get_children().any(func(c): return c.has_meta("modal")):
				go_back()
			elif screen == "race" and session != null:
				session.toggle_pause()
			elif screen.begins_with("m_") and back_to.is_valid():
				back_to.call()
			elif screen == "menu":
				get_tree().quit()
			elif screen == "career":
				show_menu()
			elif screen == "lobby" and LobbyScreen.back_page():
				render_lobby()
			elif screen == "results" or screen == "lobby" or screen == "briefing" or screen == "watch":
				leave()
			elif pause_ui != null and session != null:
				session.toggle_pause(false)
		NOTIFICATION_APPLICATION_FOCUS_OUT, NOTIFICATION_APPLICATION_PAUSED:
			AudioServer.set_bus_mute(0, true)
			# a race you are driving waits in the pause menu (the web game pauses when the tab is hidden)
			if screen == "race" and session != null and not spectating and pause_ui == null and OS.get_environment("APEX_AUTO") == "":
				session.toggle_pause(true)
		NOTIFICATION_APPLICATION_FOCUS_IN, NOTIFICATION_APPLICATION_RESUMED:
			AudioServer.set_bus_mute(0, false)
