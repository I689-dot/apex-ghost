class_name BriefingScreen
extends RefCounted
## The briefing before a session (port of App.renderBriefing / prepPanel), split from the lobby: each driver chooses
## tyres, wing, brake balance, fuel and the deeper setup for the final conditions, with the setup library, the tyre
## guide and the fuel row.

## The briefing's page: setup, advanced or saved.
static var _brief_tab := "setup"

static func build_briefing(app: App) -> Control:
	var touch := UIKit.touch()
	var room: Dictionary = app.room
	var mine := app.my_info()
	var track := app.track_entry(room.conditions.trackId)
	var c: Dictionary = room.conditions
	var plan := Weather.plan_weather(int(c.seed), c)
	var w0 := Weather.weather_at(plan, 0.0)
	var temp0 := Weather.temperatures(plan, w0, track.get("map", "nurburgring"))
	# the countdown as the references' session chip: white, crimson capitals
	var chip := PanelContainer.new()
	chip.add_theme_stylebox_override("panel", UIKit.box(Color("f2f4f7"), Color(0, 0, 0, 0), 0, 4, Vector2(12, 2)))
	var cr := UIW.hbox(14)
	cr.add_child(UIKit.label(I18n.t("BRIEFING"), 22, UIKit.CRIMSON, true, 600))
	var clock := UIKit.label("", 22, UIKit.CRIMSON, true, 700)
	cr.add_child(clock)
	app._brief_clock = clock
	chip.add_child(cr)
	var top := UIW.top_bar({
		"title": I18n.t("Briefing") if not touch else "",
		"tabs": [["setup", I18n.t("Setup")], ["advanced", I18n.t("Advanced")], ["saved", I18n.t("Saved setups")]],
		"tab": _brief_tab, "on_tab": func(k: String) -> void: _brief_tab = k; app.render_briefing(), "tabs_left": touch,
		"right": [chip],
	})
	# the headline: the circuit, the driver in hollow capitals, the forecast on the right
	var head := UIW.hbox(20)
	var hl := UIW.vbox(0)
	hl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var tr := UIW.hbox(12)
	var fl := FlagIcon.make(LobbyScreen.MAP_COUNTRY.get(LobbyScreen.circuit_of(track), "DE"), 34)
	if fl != null:
		fl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		tr.add_child(fl)
	tr.add_child(UIKit.label(I18n.t(track.get("name", "Nürburgring GP")).to_upper(), 34 if not touch else 26, UIKit.TEXT, true, 700))
	hl.add_child(tr)
	var who: String = ("#%s " % str(mine.num)) if mine.get("num") else ""
	hl.add_child(UIW.outline_label(who + str(mine.get("nick", "")), 34 if not touch else 24))
	head.add_child(hl)
	var fc := UIW.hbox(12)
	fc.add_child(UIW.WeatherIcon.new(plan.kind, 46.0))
	var fcc := UIW.vbox(-4)
	fcc.add_child(UIKit.label(I18n.t("Forecast").to_upper() + " · " + Weather.format_hour(plan.startHour), 22, UIKit.TEXT, true, 600))
	fcc.add_child(UIKit.label("%s %d °C · %s %d °C" % [I18n.t("Air"), roundi(temp0.airC), I18n.t("Track"), roundi(temp0.trackC)], 15, UIKit.SOFT))
	fc.add_child(fcc)
	if plan.get("change") != null:
		fc.add_child(UIKit.label("›", 22, UIKit.SOFT, true, 600))
		fc.add_child(UIW.WeatherIcon.new(plan.change.to, 36.0))
	fc.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	head.add_child(fc)
	var main: Control
	match _brief_tab:
		"advanced":
			main = UIW.scroll(_advanced(app, Settings.data.carSetup, temp0.airC))
		"saved":
			main = UIW.scroll(_setup_library(app, Settings.data.carSetup, func() -> void: Settings.save(); app.render_briefing()))
		_:
			main = prep_panel(app, room)
	var col := UIW.vbox(12)
	col.add_child(head)
	var row := UIW.hbox(18)
	row.size_flags_vertical = Control.SIZE_EXPAND_FILL
	# the drivers and whether they are ready, as the references' standings
	if not touch:
		var side := UIW.vbox(4)
		side.custom_minimum_size = Vector2(250, 0)
		side.add_child(UIKit.label(I18n.t("Drivers").to_upper(), 22, UIKit.DIM, true, 600))
		side.add_child(UIW.hair())
		for p: Dictionary in room.players:
			if p.carId == null or not (p.connected or p.bot) or p.waiting:
				continue
			var r := UIW.hbox(8)
			var nm := UIKit.label(p.nick, 16, UIKit.ACCENT_2 if p.id == app.me else UIKit.TEXT, false, 600)
			nm.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			nm.clip_text = true
			r.add_child(nm)
			r.add_child(UIW.image("res://assets/ui/tyre_%s.webp" % p.get("tyre", "medium"), Vector2(22, 22)))
			r.add_child(UIW.tag(I18n.t("READY"), UIKit.GOOD) if p.briefed else UIKit.label("…", 14, UIKit.SOFT, true, 700))
			side.add_child(UIW.margins(r, 0, 4, 0, 4))
		var sp := UIW.panel(side)
		sp.size_flags_vertical = Control.SIZE_EXPAND_FILL
		row.add_child(sp)
	main.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(main)
	col.add_child(row)
	var done: bool = mine.get("briefed", false)
	var btn := UIW.action(I18n.t("Ready") if done else I18n.t("Ready to go"), func() -> void: app.send({"t": "briefed"}), not done)
	btn.disabled = done
	btn.custom_minimum_size = Vector2(250, 0)
	UIW.default_focus(btn)
	var note := UIW.muted(I18n.t("The conditions are final. Set up your car for them; the session loads when everyone is ready."), 14)
	return UIW.screen(top, col, UIW.action_bar(note, [btn]))

## The player's car setup for the final conditions (tyres, wing, brake balance, fuel) with the engineer's note, in three
## panels as the references' pit garage: tyres, the car, the rest.
static func prep_panel(app: App, room: Dictionary) -> Control:
	var touch := UIKit.touch()
	var c: Dictionary = room.conditions
	var plan := Weather.plan_weather(int(c.seed), c)
	var track := app.track_entry(c.trackId)
	var rec := CarSetup.recommend_setup(plan)
	var cs: Dictionary = Settings.data.carSetup
	var save := func() -> void: Settings.save(); app.render_briefing()
	var row := UIW.hbox(14)
	# tyres: the engineer's call first (one press sets the tyre and wing), then the four compounds
	var tyres_col := UIW.vbox(10)
	tyres_col.add_child(UIKit.label(I18n.t("Tyres").to_upper(), 22, UIKit.TEXT, true, 600))
	var note := UIW.muted(I18n.t("Engineer: {note}.", {"note": rec.note}), 14)
	tyres_col.add_child(note)
	var use := UIKit.button(I18n.t("Use {tyre} + {wing} wing", {"tyre": I18n.t(Tyres.COMPOUNDS[rec.tyre].name), "wing": I18n.t(CarSetup.WING[rec.wing].label).split(" (")[0].to_lower()}), func() -> void:
		cs.tyre = rec.tyre
		cs.wing = rec.wing
		app.send({"t": "setTyre", "tyre": rec.tyre})
		save.call())
	use.disabled = cs.tyre == rec.tyre and cs.wing == rec.wing
	use.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	tyres_col.add_child(use)
	var tg := GridContainer.new()
	tg.columns = 2
	tg.add_theme_constant_override("h_separation", 8)
	tg.add_theme_constant_override("v_separation", 8)
	for id: String in ["soft", "medium", "hard", "wet"]:
		var comp: Dictionary = Tyres.COMPOUNDS[id]
		var on: bool = cs.tyre == id
		var b := UIW.card_button(on, 6)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.custom_minimum_size = Vector2(130, 62 if touch else 58)
		b.tooltip_text = I18n.t("{name}: grip {dry} % dry / {wet} % wet, wear ×{wear}", {"name": I18n.t(comp.name), "dry": roundi(comp.grip * 100), "wet": roundi(comp.wetGrip * 100), "wear": comp.wear})
		var r := UIW.hbox(8)
		r.add_child(UIW.image("res://assets/ui/tyre_%s.webp" % id, Vector2(38, 38)))
		var tl := UIKit.label(I18n.t(comp.name).to_upper(), 20, Color.WHITE if on else UIKit.SOFT, true, 600)
		tl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		r.add_child(tl)
		if on:
			r.add_child(UIKit.label("✓", 18, Color.WHITE, false, 700))
		var content: MarginContainer = b.get_node("content")
		for s: String in ["left", "right", "top", "bottom"]:
			content.add_theme_constant_override("margin_" + s, 8)
		content.add_child(r)
		UIW.pass_mouse(content)
		if on:
			UIW.default_focus(b)
		var tid: String = id
		b.pressed.connect(func() -> void:
			cs.tyre = tid
			app.send({"t": "setTyre", "tyre": tid})
			save.call())
		tg.add_child(b)
	tyres_col.add_child(tg)
	var tp := UIW.panel(UIW.scroll(tyres_col))
	tp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(tp)
	# the car's settings as rows
	var rcol := UIW.vbox(0)
	rcol.add_child(UIKit.label(I18n.t("Aero and brakes").to_upper(), 22, UIKit.TEXT, true, 600))
	var wing_opts: Array = []
	for k: String in ["low", "medium", "high"]:
		wing_opts.append([k, I18n.t(CarSetup.WING[k].label)])
	rcol.add_child(UIW.row(I18n.t("Rear wing"), UIW.stepper(cs.wing, wing_opts, func(v: Variant) -> void: cs.wing = v; save.call())))
	var bias_out := UIKit.label(I18n.t("{pct} % front", {"pct": roundi(cs.brakeBias * 100)}), 15, UIKit.TEXT, false, 600)
	var bias := UIW.slider(cs.brakeBias, 0.54, 0.66, 0.01, func(v: float) -> void:
		cs.brakeBias = v
		bias_out.text = I18n.t("{pct} % front", {"pct": roundi(v * 100)})
		Settings.save())
	bias.custom_minimum_size = Vector2(150, 30)
	var br := UIW.hbox(10)
	br.add_child(bias)
	br.add_child(bias_out)
	rcol.add_child(UIW.row(I18n.t("Brake balance"), br))
	if room.get("rules", {}).get("fuel", false):
		var g := Control.new()
		g.custom_minimum_size = Vector2(0, 14)
		rcol.add_child(g)
		rcol.add_child(UIKit.label(I18n.t("Fuel").to_upper(), 22, UIKit.TEXT, true, 600))
		rcol.add_child(_fuel_row(room, float(track.get("length", 5000)), cs))
	rcol.add_child(UIW.margins(_tyre_guide(), 0, 14, 0, 0))
	var rp := UIW.panel(UIW.scroll(rcol))
	rp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(rp)
	return row

## Named setups, kept on this device, and the text code that shares one with a friend.
static func _setup_library(app: App, cs: Dictionary, save: Callable) -> Control:
	var box := UIW.vbox(8)
	box.add_child(UIW.section(I18n.t("Saved setups")))
	var status := UIKit.label("", 14, UIKit.SOFT)
	var name_in := LineEdit.new()
	name_in.max_length = 24
	name_in.placeholder_text = I18n.t("Name for this setup")
	name_in.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var row := UIW.hbox(8)
	row.add_child(name_in)
	row.add_child(UIKit.button(I18n.t("Save"), func() -> void:
		if name_in.text.strip_edges().is_empty():
			status.text = I18n.t("Type a name first")
			return
		CarSetup.save_named(name_in.text, cs)
		app.render_briefing(), true))
	box.add_child(row)
	for nm: String in CarSetup.saved_names():
		var r := UIW.hbox(8)
		var lb := UIKit.label(String(nm), 16, UIKit.TEXT, false, 600)
		lb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		r.add_child(lb)
		var key: String = nm
		r.add_child(UIKit.button(I18n.t("Load"), func() -> void:
			CarSetup.load_into(cs, Settings.data.savedSetups[key])
			app.send({"t": "setTyre", "tyre": cs.tyre})
			save.call()))
		r.add_child(UIKit.button(I18n.t("Share"), func() -> void:
			DisplayServer.clipboard_set(CarSetup.to_code(Settings.data.savedSetups[key]))
			status.text = I18n.t("Code copied: send it to a friend")))
		r.add_child(UIKit.button(I18n.t("Delete"), func() -> void:
			CarSetup.delete_named(key)
			app.render_briefing()))
		var rp := PanelContainer.new()
		var st := UIKit.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 0, Vector2(8, 4))
		st.border_color = UIKit.HAIR
		st.border_width_bottom = 1
		rp.add_theme_stylebox_override("panel", st)
		rp.add_child(r)
		box.add_child(rp)
	var io := UIW.hbox(8)
	io.add_child(UIKit.button(I18n.t("Copy code of the current setup"), func() -> void:
		DisplayServer.clipboard_set(CarSetup.to_code(cs))
		status.text = I18n.t("Code copied: send it to a friend")))
	io.add_child(UIKit.button(I18n.t("Paste a friend's code"), func() -> void:
		var imported: Variant = CarSetup.from_code(DisplayServer.clipboard_get())
		if imported == null:
			status.text = I18n.t("The clipboard doesn't hold a setup code")
			return
		CarSetup.load_into(cs, imported)
		app.send({"t": "setTyre", "tyre": cs.tyre})
		save.call()))
	box.add_child(UIW.margins(io, 0, 8, 0, 0))
	box.add_child(status)
	return UIW.panel(box)

static func _tyre_guide() -> Control:
	var note := {
		"soft": "Fastest over one lap and warms up quickly, but wears about twice as fast as the Medium.",
		"medium": "The all-rounder: good grip that lasts a long run.",
		"hard": "Lasts the longest, but has the least grip and needs more time to warm up.",
		"wet": "For a wet track: the grooves clear the water. On a drying track it overheats and wears fast.",
	}
	var ids := ["soft", "medium", "hard", "wet"]
	var max_life := 0.0
	var max_warm := 0.0
	for i: String in ids:
		max_life = maxf(max_life, 1.0 / Tyres.COMPOUNDS[i].wear)
		max_warm = maxf(max_warm, 1.0 / Tyres.COMPOUNDS[i].heatCap)
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 14)
	grid.add_theme_constant_override("v_separation", 12)
	for id: String in ids:
		var cm: Dictionary = Tyres.COMPOUNDS[id]
		var card := UIW.vbox(3)
		card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		card.add_child(UIKit.label(I18n.t(cm.name).to_upper(), 17, UIKit.TEXT, true, 600))
		for bar: Array in [[I18n.t("Dry grip"), (cm.grip - 0.8) / 0.25], [I18n.t("Wet grip"), cm.wetGrip / 0.8], [I18n.t("Life"), 1.0 / cm.wear / max_life], [I18n.t("Warm-up"), 1.0 / cm.heatCap / max_warm]]:
			var row := UIW.hbox(6)
			var lb := UIKit.label(bar[0], 12, UIKit.SOFT)
			lb.custom_minimum_size = Vector2(62, 0)
			row.add_child(lb)
			var pb := UIW.bar(Vector2(0, 4), clampf(bar[1], 0.06, 1.0))
			pb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			pb.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			row.add_child(pb)
			card.add_child(row)
		card.add_child(UIW.muted(I18n.t(note[id]), 12))
		grid.add_child(card)
	var col := UIW.vbox(8)
	col.add_child(UIW.hair())
	col.add_child(UIW.h3(I18n.t("Which tyre?")))
	col.add_child(grid)
	col.add_child(UIW.muted(I18n.t("Rain or a drying track can change the best choice during the session: you can change tyres in the pit box (pit lane next to the start)."), 13))
	return col

static func _fuel_row(room: Dictionary, track_m: float, cs: Dictionary) -> Control:
	var per_lap := (track_m / 1000.0) * VehicleConsts.FUEL.perKm
	var timed: bool = int(room.get("raceMinutes", 0)) > 0
	var laps: int = (ceili((room.raceMinutes * 60.0) / (track_m / 43.0)) + 1) if timed else int(room.raceLaps)
	var need: Variant = mini(int(VehicleConsts.FUEL.tankL), ceili((laps + 1) * per_lap)) if laps > 0 else null
	var out := UIKit.label("", 15, UIKit.TEXT, false, 600)
	var show := func() -> void: out.text = I18n.t("{l} l · ~{laps} laps · {kg} kg", {"l": cs.fuelL, "laps": "%.1f" % (cs.fuelL / per_lap), "kg": roundi(cs.fuelL * VehicleConsts.FUEL.kgPerL)})
	show.call()
	var slider := UIW.slider(cs.fuelL, 10, VehicleConsts.FUEL.tankL, 1, func(v: float) -> void: cs.fuelL = int(v); show.call(); Settings.save())
	slider.custom_minimum_size = Vector2(150, 30)
	var row := UIW.hbox(10)
	row.add_child(slider)
	row.add_child(out)
	var col := UIW.vbox(6)
	col.add_child(UIW.row(I18n.t("Fuel"), row))
	var note: String = I18n.t("The race needs ~{need} l ({per} l a lap). Less is lighter and faster, but you will have to refuel.", {"need": need, "per": "%.1f" % per_lap}) if need != null else I18n.t("About {per} l a lap. Less fuel is lighter and faster.", {"per": "%.1f" % per_lap})
	var rules: Dictionary = room.get("rules", {})
	if laps > 1 and rules.get("pitWindow", false) and not timed:
		var w := RaceTracker.pit_window_laps(laps)
		note += " " + I18n.t("Mandatory stop on laps {a}–{b}.", {"a": w.open, "b": w.close})
	if timed and rules.get("pitWindow", false):
		note += " " + I18n.t("Mandatory stop: into the pit lane between {a} and {b} min.", {"a": roundi(room.raceMinutes * RaceTracker.PIT_WINDOW.timedOpenShare), "b": roundi(room.raceMinutes * RaceTracker.PIT_WINDOW.timedCloseShare)})
	col.add_child(UIW.muted(note, 13))
	if need != null:
		var b := UIKit.button(I18n.t("Fuel for the whole race ({l} l)", {"l": need}), func() -> void:
			cs.fuelL = need
			slider.value = need
			Settings.save())
		b.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		col.add_child(b)
	return col

## The deeper setup (pressures, ride height, anti-roll bars, dampers) as rows of sliders, front and rear.
static func _advanced(app: App, cs: Dictionary, air_c: float) -> Control:
	var opt: float = Tyres.COMPOUNDS[cs.tyre].optimumC
	var set_c := air_c + 12.0
	var ideal := VehicleConsts.ideal_cold_psi(opt, set_c)
	var P := VehicleConsts.TYRE_PRESSURE
	var hot := func(cold: float) -> float: return (cold + P.atmPsi) * ((opt + 273.15) / (set_c + 273.15)) - P.atmPsi
	var body := UIW.vbox(0)
	var auto: bool = cs.pressure == null
	body.add_child(UIW.section(I18n.t("Advanced setup")))
	body.add_child(UIW.row(I18n.t("Crew sets the tyre pressures ({p} psi cold → {hot} psi hot)", {"p": "%.1f" % ideal, "hot": P.targetPsi}), UIW.switch(auto, func(v: bool) -> void:
		cs.pressure = null if v else [ideal, ideal]
		Settings.save()
		app.render_briefing())))
	var slider := func(value: float, lo: float, hi: float, step: float, fmt: Callable, on: Callable) -> Control:
		var out := UIKit.label(fmt.call(value), 14, UIKit.TEXT, false, 600)
		out.custom_minimum_size = Vector2(150, 0)
		var s := UIW.slider(value, lo, hi, step, func(v: float) -> void: on.call(v); out.text = fmt.call(v); Settings.save())
		s.custom_minimum_size = Vector2(150, 30)
		var r := UIW.hbox(8)
		r.add_child(s)
		r.add_child(out)
		return r
	var pair := func(label: String, make: Callable) -> void:
		for axle in 2:
			body.add_child(UIW.row("%s · %s" % [label, I18n.t("Front") if axle == 0 else I18n.t("Rear")], make.call(axle)))
	if not auto:
		pair.call(I18n.t("Tyre pressure (cold)"), func(axle: int) -> Control: return slider.call(
			(cs.pressure if cs.pressure != null else [ideal, ideal])[axle], P.minColdPsi, P.maxColdPsi, 0.1,
			func(v: float) -> String: return I18n.t("{p} psi → ~{hot} hot", {"p": "%.1f" % v, "hot": "%.1f" % hot.call(v)}),
			func(v: float) -> void:
				if cs.pressure == null:
					cs.pressure = [ideal, ideal]
				cs.pressure[axle] = v))
	pair.call(I18n.t("Ride height"), func(axle: int) -> Control: return slider.call(cs.ride[axle], -CarSetup.SETUP.rideMm, CarSetup.SETUP.rideMm, 1,
		func(v: float) -> String: return I18n.t("baseline") if int(v) == 0 else "%s%d mm" % ["+" if v > 0 else "", int(v)], func(v: float) -> void: cs.ride[axle] = int(v)))
	var clicks := func(key: String, soft: String, stiff: String) -> Callable:
		return func(axle: int) -> Control: return slider.call(cs[key][axle], 1, CarSetup.SETUP.clicks, 1,
			func(v: float) -> String: return "%d%s" % [int(v), (" (%s)" % I18n.t("baseline")) if int(v) == CarSetup.SETUP.baseline else (" · " + soft if v < CarSetup.SETUP.baseline else " · " + stiff)],
			func(v: float) -> void: cs[key][axle] = int(v))
	pair.call(I18n.t("Anti-roll bar"), clicks.call("arb", I18n.t("soft"), I18n.t("stiff")))
	pair.call(I18n.t("Dampers: bump"), clicks.call("bump", I18n.t("soft"), I18n.t("stiff")))
	pair.call(I18n.t("Dampers: rebound"), clicks.call("rebound", I18n.t("soft"), I18n.t("stiff")))
	pair.call(I18n.t("Springs"), clicks.call("springs", I18n.t("soft"), I18n.t("stiff")))
	# alignment
	body.add_child(UIW.section(I18n.t("Alignment")))
	pair.call(I18n.t("Camber"), func(axle: int) -> Control: return slider.call(float(cs.camber[axle]), CarSetup.SETUP.camber[axle][0], CarSetup.SETUP.camber[axle][1], 0.1,
		func(v: float) -> String: return "%.1f°" % v, func(v: float) -> void: cs.camber[axle] = snappedf(v, 0.1)))
	pair.call(I18n.t("Toe"), func(axle: int) -> Control: return slider.call(float(cs.toe[axle]), CarSetup.SETUP.toe[axle][0], CarSetup.SETUP.toe[axle][1], 0.01,
		func(v: float) -> String: return ("%.2f° " % absf(v)) + (I18n.t("out") if v < 0.0 else (I18n.t("in") if v > 0.0 else "")), func(v: float) -> void: cs.toe[axle] = snappedf(v, 0.01)))
	# differential, brakes, gearing, engine
	var one := func(key: String, lo: float, hi: float, step: float, fmt: Callable) -> Control:
		return slider.call(float(cs[key]), lo, hi, step, fmt, func(v: float) -> void: cs[key] = v if step < 1.0 else int(v))
	body.add_child(UIW.section(I18n.t("Differential")))
	body.add_child(UIW.row(I18n.t("Preload"), one.call("diffPreload", CarSetup.SETUP.preload[0], CarSetup.SETUP.preload[1], 5.0, func(v: float) -> String: return "%d Nm" % int(v))))
	body.add_child(UIW.row(I18n.t("Locking on power"), one.call("diffLock", 1, CarSetup.SETUP.clicks, 1.0, func(v: float) -> String: return "%d / %d" % [int(v), CarSetup.SETUP.clicks])))
	body.add_child(UIW.row(I18n.t("Locking off power"), one.call("diffCoast", 1, CarSetup.SETUP.clicks, 1.0, func(v: float) -> String: return "%d / %d" % [int(v), CarSetup.SETUP.clicks])))
	body.add_child(UIW.section(I18n.t("Brakes and engine")))
	body.add_child(UIW.row(I18n.t("Brake pressure"), one.call("brakePressure", CarSetup.SETUP.brakePressure[0], CarSetup.SETUP.brakePressure[1], 0.01, func(v: float) -> String: return "%d %%" % roundi(v * 100.0))))
	body.add_child(UIW.row(I18n.t("Brake ducts"), one.call("brakeDucts", 1, 5, 1.0, func(v: float) -> String: return "%d / 5%s" % [int(v), " · " + I18n.t("cooler") if v > 3 else (" · " + I18n.t("hotter") if v < 3 else "")])))
	body.add_child(UIW.row(I18n.t("Final drive"), one.call("finalDrive", -CarSetup.SETUP.finalDriveSteps, CarSetup.SETUP.finalDriveSteps, 1.0, func(v: float) -> String: return I18n.t("baseline") if int(v) == 0 else ("%+d %% · %s" % [int(v) * 2, I18n.t("shorter") if v > 0 else I18n.t("longer")]))))
	body.add_child(UIW.row(I18n.t("Engine map"), one.call("engineMap", 1, 3, 1.0, func(v: float) -> String: return "%d · %s" % [int(v), I18n.t(CarSetup.SETUP.maps[int(v) - 1].label)])))
	body.add_child(UIW.margins(UIW.muted(I18n.t("Hot target {p} psi: too low runs hot and soft, too high loses grip. Lower = more downforce but it bottoms over kerbs; rear higher than front moves grip to the front. A stiffer anti-roll bar takes grip from its axle (stiff front = understeer). Stiffer dampers react faster but skip over bumps. Stiffer springs: sharper, less grip over bumps. More negative camber: more grip in long corners, too much costs braking. Front toe-out: quicker turn-in; rear toe-in: a stable rear. More diff locking: better traction, more understeer on the way in. Bigger ducts cool the brakes and tyres. A shorter final drive accelerates harder, tops out sooner. Leaner maps save fuel for a little power.", {"p": P.targetPsi}), 13), 10, 10, 10, 6))
	var reset := UIKit.button(I18n.t("Reset to baseline"), func() -> void:
		cs.pressure = null
		cs.ride = [0, 0]
		cs.arb = [4, 4]
		cs.bump = [4, 4]
		cs.rebound = [4, 4]
		var d: Dictionary = Settings.default_settings().carSetup
		for k: String in ["springs", "camber", "toe", "diffPreload", "diffLock", "diffCoast", "brakePressure", "brakeDucts", "finalDrive", "engineMap"]:
			cs[k] = d[k] if typeof(d[k]) != TYPE_ARRAY else (d[k] as Array).duplicate()
		Settings.save()
		app.render_briefing())
	reset.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	body.add_child(UIW.margins(reset, 10, 4, 0, 0))
	return UIW.panel(body)
