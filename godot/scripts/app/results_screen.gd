class_name ResultsScreen
extends RefCounted
## The results after a session (port of App.showResults), laid out as Le Mans Ultimate's standings: the circuit and the
## session's chip, the podium as cards with the cars, the classification over hairline rows, the career's gain, the
## weekend's Results & Stats, a championship round's scoring, and what comes next in the bottom bar (the race loading by
## itself, the next round, or back to the lobby).

static func _classified(r: Dictionary, race: bool) -> bool:
	return (not r.dnf and r.totalMs != null) if race else r.bestLapMs != null

static func _total(r: Dictionary):
	return null if r.totalMs == null else r.totalMs + r.penaltyMs

static func fmt_time(ms) -> String:
	if ms == null:
		return "--:--.---"
	var neg: bool = ms < 0
	var t := absf(ms)
	var m := int(t / 60000.0)
	var s := int(fmod(t, 60000.0) / 1000.0)
	var r := int(fmod(t, 1000.0))
	return "%s%d:%02d.%03d" % ["-" if neg else "", m, s, r]

static func build(app: App, m: Dictionary, gain) -> Control:
	var touch := UIKit.touch()
	var race: bool = m.kind == "race"
	var cars: Array = app.cars.cars
	var col := UIW.vbox(14)
	var title := I18n.t("Race results") if race else (I18n.t("Free practice results") if m.kind == "practice" else I18n.t("Qualifying results"))
	# the headline: the circuit, the session as the references' white chip
	var track := app.track_entry(str(app.pending_race.get("trackId", app.room.get("conditions", {}).get("trackId", ""))))
	var head := UIW.hbox(16)
	var hl := UIW.vbox(0)
	hl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	if not track.is_empty():
		var tr := UIW.hbox(12)
		var fl := FlagIcon.make(LobbyScreen.MAP_COUNTRY.get(LobbyScreen.circuit_of(track), "DE"), 34)
		if fl != null:
			fl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			tr.add_child(fl)
		tr.add_child(UIKit.label(I18n.t(track.get("name", "")).to_upper(), 38 if not touch else 28, UIKit.TEXT, true, 700))
		hl.add_child(tr)
	hl.add_child(UIW.outline_label(title, 32 if not touch else 24))
	head.add_child(hl)
	var chip := PanelContainer.new()
	chip.add_theme_stylebox_override("panel", UIKit.box(Color("f2f4f7"), Color(0, 0, 0, 0), 0, 4, Vector2(14, 2)))
	chip.add_child(UIKit.label((I18n.t("Race") if race else (I18n.t("Practice") if m.kind == "practice" else I18n.t("Qualifying"))).to_upper(), 26, UIKit.CRIMSON, true, 600))
	chip.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	head.add_child(chip)
	col.add_child(head)
	var car_name := func(id) -> String:
		for c in cars:
			if c.id == id:
				return c.name
		return ""
	var fastest_id = m.fastestLap.id if m.get("fastestLap") != null else null
	# the podium: the top three as cards with their cars
	var podium := UIW.hbox(14)
	var shown := 0
	for r in m.rows:
		if not _classified(r, race) or shown >= 3:
			continue
		var card := UIW.vbox(0)
		card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var top := UIW.hbox(10)
		top.add_child(UIKit.label("P%d" % (shown + 1), 44, UIKit.ACCENT_2 if shown == 0 else UIKit.TEXT, true, 700))
		var who := UIW.vbox(-4)
		who.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		who.alignment = BoxContainer.ALIGNMENT_CENTER
		var nk := UIKit.label(str(r.nick).to_upper(), 22, UIKit.TEXT, true, 600)
		nk.clip_text = true
		who.add_child(nk)
		var t_text: String = (fmt_time(_total(r)) if shown == 0 else "+%.3f" % (float(r.get("gapMs", 0)) / 1000.0)) if race else fmt_time(r.bestLapMs)
		who.add_child(UIKit.label(t_text, 16, UIKit.SOFT, false, 600))
		top.add_child(who)
		card.add_child(top)
		var car_shown := CarsDb.resolve(str(r.carId))
		var lv: Dictionary = CarStudio.my_livery() if r.get("id") == app.me else CarPaint.livery_for(str(r.get("id", "")))
		for pl in app.room.get("players", []):
			if pl.id == r.get("id") and pl.get("livery") is Dictionary and not (pl.livery as Dictionary).is_empty() and pl.id != app.me:
				lv = pl.livery
		card.add_child(CarStudio.picture_rect(car_shown, lv, Vector2(0, 50 if touch else 96)))
		var cn := UIKit.label(car_name.call(r.carId), 13, UIKit.SOFT)
		cn.clip_text = true
		card.add_child(cn)
		var pp := UIW.panel(card)
		if shown == 0:
			pp.add_theme_stylebox_override("panel", UIKit.box(UIKit.NAVY, Color(UIKit.ACCENT_2, 0.8), 2, 8, Vector2(16, 12)))
		pp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		pp.custom_minimum_size = Vector2(200, 0)
		podium.add_child(pp)
		shown += 1
	col.add_child(podium)

	# the classification as the references' standings: muted capitals over hairline rows, my row lit
	var heads: Array = [I18n.t("Pos"), I18n.t("Driver"), I18n.t("Car"), I18n.t("Race time"), I18n.t("Gap"), I18n.t("Best lap"), I18n.t("Laps"), I18n.t("Penalties")] if race else [I18n.t("Pos"), I18n.t("Driver"), I18n.t("Car"), I18n.t("Best lap"), I18n.t("Gap"), I18n.t("Timed laps"), I18n.t("Penalties")]
	var widths: Array = [46, 190, 250, 120, 90, 110, 60, 90] if race else [46, 200, 260, 120, 90, 100, 90]
	var standing := UIW.vbox(0)
	var hr := UIW.hbox(10)
	for i in heads.size():
		var l := UIKit.label(String(heads[i]).to_upper(), 14, UIKit.SOFT, true, 600)
		l.custom_minimum_size = Vector2(widths[i] * (0.8 if touch else 1.0), 0)
		if i == 2:
			l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		hr.add_child(l)
	standing.add_child(UIW.margins(hr, 10, 0, 10, 6))
	for r in m.rows:
		var cl := _classified(r, race)
		var me: bool = r.id == app.me
		var cells: Array = []
		var colours: Array = []
		cells.append(str(r.position) if cl else "—")
		colours.append(UIKit.TEXT)
		cells.append(r.nick)
		colours.append(UIKit.TEXT)
		cells.append(car_name.call(r.carId))
		colours.append(UIKit.SOFT)
		if race:
			cells.append(I18n.t("DNF") if (r.dnf or _total(r) == null) else fmt_time(_total(r)))
			colours.append(UIKit.TEXT)
		else:
			cells.append(I18n.t("no time") if r.bestLapMs == null else fmt_time(r.bestLapMs))
			colours.append(UIKit.GOOD if fastest_id == r.id else UIKit.TEXT)
		cells.append("" if (not cl or not r.get("gapMs")) else "+%.3f" % (float(r.gapMs) / 1000.0))
		colours.append(UIKit.SOFT)
		if race:
			cells.append("" if r.bestLapMs == null else fmt_time(r.bestLapMs))
			colours.append(UIKit.GOOD if fastest_id == r.id else UIKit.TEXT)
		cells.append("%d%s" % [r.validLaps, (" · " + I18n.t("DNF")) if r.dnf and not race else ""])
		colours.append(UIKit.SOFT)
		cells.append(("+%.1f s" % (float(r.penaltyMs) / 1000.0)) if r.penaltyMs > 0 else "")
		colours.append(UIKit.BAD)
		var row := UIW.hbox(10)
		for i in cells.size():
			var c: Color = UIKit.ACCENT_2 if me and colours[i] == UIKit.TEXT else colours[i]
			var l := UIKit.label(String(cells[i]), 16 if i > 0 else 18, c, i == 0, 700 if (me or i == 0) else 500)
			l.custom_minimum_size = Vector2(widths[i] * (0.8 if touch else 1.0), 0)
			l.clip_text = true
			if i == 2:
				l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			row.add_child(l)
		var rp := PanelContainer.new()
		var st := UIKit.box(Color(1, 1, 1, 0.1) if me else Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 2, Vector2(10, 5))
		st.border_color = UIKit.HAIR
		st.border_width_bottom = 1
		rp.add_theme_stylebox_override("panel", st)
		rp.add_child(row)
		standing.add_child(rp)
	col.add_child(UIW.panel(standing))
	if fastest_id != null:
		var who := ""
		for r in m.rows:
			if r.id == fastest_id:
				who = r.nick
		col.add_child(UIKit.label(I18n.t("Fastest lap: {nick} · {time}", {"nick": who, "time": fmt_time(m.fastestLap.ms)}), 16, UIKit.GOOD, false, 600))
	col.add_child(UIW.muted(I18n.t("Race time includes penalties: track limits after 3 warnings (0.5–3 s), reset (5 s), shortcut (5 s and more).") if race else I18n.t("Ranked by best lap. Penalties are added to the lap: track limits after 3 warnings (0.5–3 s), reset (5 s), shortcut (5 s and more)."), 13))
	if gain != null:
		col.add_child(career_block(gain))

	# the weekend's record
	for r in m.rows:
		var p := {}
		for x in app.room.get("players", []):
			if x.id == r.id:
				p = x
		var w: Dictionary = app.weekend.get(r.id, {"nick": r.nick, "num": p.get("num"), "country": p.get("country")})
		var pos = r.position if _classified(r, race) else null
		if m.kind == "practice":
			w.practice = pos
		elif race:
			if not w.has("grid"):
				w.grid = w.get("qualify")
			w.race = I18n.t("DNF") if r.dnf else (str(pos) if pos != null else "–")
		else:
			w.qualify = pos
			w.qualifyMs = r.bestLapMs
		app.weekend[r.id] = w
	var wk := _weekend_table(app, "race" if race else ("practice" if m.kind == "practice" else "qualify"))
	if wk != null:
		col.add_child(wk)

	# a championship round (offline, on the round's circuit)
	var champ = Championship.load_saved()
	var champ_track: Variant = app.room.get("conditions", {}).get("trackId")
	var next_button: Control = null
	var my_nick: String = app.my_info().get("nick", Settings.data.nickname)
	if race and champ != null and app.conn != null and LocalRoom.is_local_code(app.conn.code) and champ_track != null and (champ.rounds[champ.done] == champ_track if champ.done < champ.rounds.size() else false or champ.lastScored == "%s-%d" % [app.conn.code, m.raceId]):
		var fastest_nick: Variant = null
		if m.get("fastestLap") != null:
			for r in m.rows:
				if r.id == m.fastestLap.id:
					fastest_nick = r.nick
		Championship.score_race(champ, "%s-%d" % [app.conn.code, m.raceId], m.rows.map(func(r): return {"nick": r.nick, "carId": r.carId, "classified": _classified(r, true)}), fastest_nick)
		var over: bool = champ.done >= champ.rounds.size()
		Championship.save(null if over else champ)
		var table := Championship.standings(champ)
		var cb := UIW.vbox(4)
		cb.add_child(UIW.section(I18n.t("Championship final standings") if over else I18n.t("Championship after round {n} of {m}", {"n": champ.done, "m": champ.rounds.size()})))
		for i in mini(12, table.size()):
			var d: Dictionary = table[i]
			var row := UIW.hbox(10)
			var nm := UIKit.label("%d. %s" % [i + 1, d.nick], 16, UIKit.ACCENT_2 if d.nick == my_nick else UIKit.TEXT, false, 700)
			nm.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			row.add_child(nm)
			row.add_child(UIKit.label(" ".join(d.results.map(func(p): return "P%d" % p if p != null and p != 0 else "–")), 12, UIKit.MUTED))
			row.add_child(UIKit.label(str(d.points), 18, UIKit.TEXT, true, 700))
			cb.add_child(row)
		if over and not table.is_empty():
			cb.add_child(UIKit.label(I18n.t("{nick} is the champion!", {"nick": table[0].nick}), 20, UIKit.ACCENT_2, true, 700))
		col.add_child(UIW.panel(cb))
		if not over and champ.done < champ.rounds.size():
			var next_track: String = champ.rounds[champ.done]
			next_button = UIKit.button(I18n.t("Next round: {track}", {"track": I18n.t(app.track_entry(next_track).get("name", next_track))}), func() -> void:
				if app.conn != null:
					app.conn.leave()
				app.teardown_connection()
				ChampionshipUI.start_round(app, champ, my_nick), true)

	# what comes next, in the bottom bar
	var note: Control = null
	var actions: Array = []
	if m.get("raceAt") != null:
		var next := UIKit.label("", 20, UIKit.ACCENT_2, true, 600)
		var tick := func() -> void:
			if app.screen != "results" or app.conn == null:
				return
			var left := maxi(0, ceili((m.raceAt - app.conn.server_now()) / 1000.0))
			next.text = I18n.t("Qualifying starts in {s} s", {"s": left}) if m.kind == "practice" else I18n.t("The race starts in {s} s · grid in qualifying order", {"s": left})
		var timer := Timer.new()
		timer.wait_time = 0.25
		timer.autostart = true
		timer.timeout.connect(tick)
		next.add_child(timer)
		tick.call()
		note = next
	elif next_button != null:
		actions.append(UIKit.button(I18n.t("Back to lobby"), app.show_lobby))
		actions.append(UIW.default_focus(next_button))
		next_button.add_theme_font_size_override("font_size", 23)
	else:
		actions.append(UIW.default_focus(UIW.action(I18n.t("Back to lobby"), app.show_lobby, true)))
	var top := UIW.top_bar({"title": I18n.t("Results")})
	return UIW.screen(top, UIW.scroll(col), UIW.action_bar(note, actions))

static func _weekend_table(app: App, by: String) -> Control:
	var rows: Array = app.weekend.keys().map(func(k): return [k, app.weekend[k]])
	var sessions := [rows.any(func(r): return r[1].has("practice")), rows.any(func(r): return r[1].has("qualify")), rows.any(func(r): return r[1].has("race"))]
	if sessions.filter(func(b): return b).size() < 2:
		return null
	var key := func(w: Dictionary) -> int:
		if by == "race":
			return int(w.get("race", 999)) if str(w.get("race", "")).is_valid_int() else 999
		var v: Variant = w.get("qualify") if by == "qualify" else w.get("practice")
		return int(v) if v != null else 999
	rows.sort_custom(func(a, b): return key.call(a[1]) < key.call(b[1]))
	var grid := GridContainer.new()
	grid.columns = 6
	grid.add_theme_constant_override("h_separation", 22)
	grid.add_theme_constant_override("v_separation", 4)
	for h: String in ["#", I18n.t("Driver"), I18n.t("Practice"), I18n.t("Qualify"), I18n.t("G"), I18n.t("Race")]:
		grid.add_child(UIKit.label(String(h).to_upper(), 14, UIKit.SOFT, true, 600))
	for r in rows:
		var w: Dictionary = r[1]
		var me: bool = r[0] == app.me
		var c := UIKit.ACCENT_2 if me else UIKit.TEXT
		grid.add_child(UIKit.label("#%d" % w.num if w.get("num") else "", 15, c))
		var name_row := UIW.hbox(6)
		if w.get("country") != null:
			name_row.add_child(FlagIcon.make(w.country, 16))
		name_row.add_child(UIKit.label(w.nick, 15, c))
		grid.add_child(name_row)
		grid.add_child(UIKit.label("P%d" % w.practice if w.get("practice") else "---", 15, c))
		grid.add_child(UIKit.label(("P%d" % w.qualify if w.get("qualify") else "---") + ("  " + fmt_time(w.qualifyMs) if w.get("qualifyMs") else ""), 15, c))
		grid.add_child(UIKit.label(str(w.grid) if w.get("grid") else "", 15, c))
		grid.add_child(UIKit.label(str(w.get("race", "")), 15, c))
	var col := UIW.vbox(8)
	col.add_child(UIW.section(I18n.t("Results & stats")))
	col.add_child(grid)
	return UIW.panel(col)

## What a session gave the career: the XP line by line, the level bar, the licence and its Safety Rating.
static func career_block(g: Dictionary) -> Control:
	var c := CareerData.load_career()
	var lv := CareerData.level_of(c.xp)
	var d_sr: float = g.srAfter - g.srBefore
	var sr_text := "%s%.2f" % ["±" if absf(d_sr) < 0.005 else ("+" if d_sr > 0 else "−"), absf(d_sr)]
	var row := UIW.hbox(30)
	var xp := UIW.vbox(2)
	xp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for l in g.lines:
		var line := UIW.hbox(8)
		var k := UIKit.label(I18n.t(l[0]), 15, UIKit.MUTED)
		k.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		line.add_child(k)
		line.add_child(UIKit.label("+%d XP" % l[1], 15, UIKit.TEXT, false, 700))
		xp.add_child(line)
	var total := UIW.hbox(8)
	var tk := UIKit.label(I18n.t("Total"), 16, UIKit.TEXT, true, 700)
	tk.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	total.add_child(tk)
	total.add_child(UIKit.label("+%d XP" % g.xp, 16, UIKit.ACCENT_2, true, 700))
	xp.add_child(total)
	row.add_child(xp)
	var side := UIW.vbox(4)
	side.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var rank := CareerData.rank_of(lv.level)
	side.add_child(UIKit.label("%s · %s   %d / %d XP" % [I18n.t(rank.name).to_upper(), I18n.t("Level {n}", {"n": lv.level}), int(lv.into), lv.need], 16, rank.colour, true, 700))
	# the bar fills from where it was to where it is now (from zero after a level up)
	var bar := ProgressBar.new()
	bar.show_percentage = false
	bar.max_value = lv.need
	var before := CareerData.level_of(g.get("xpBefore", c.xp))
	bar.value = before.into if before.level == lv.level else 0.0
	bar.custom_minimum_size = Vector2(0, 12)
	bar.add_theme_stylebox_override("background", UIKit.box(Color(1, 1, 1, 0.1), Color(0, 0, 0, 0), 0, 6))
	bar.add_theme_stylebox_override("fill", UIKit.box(rank.colour, Color(0, 0, 0, 0), 0, 6))
	bar.ready.connect(func() -> void: bar.create_tween().tween_property(bar, "value", lv.into, 1.4).set_delay(0.4).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT))
	side.add_child(bar)
	if g.levelAfter > g.levelBefore:
		side.add_child(UIKit.label(I18n.t("Level up! Level {n}", {"n": g.levelAfter}), 16, UIKit.GOOD, true, 700))
	if g.get("rankAfter", "") != g.get("rankBefore", ""):
		side.add_child(UIKit.label(I18n.t("New rank: {rank}", {"rank": I18n.t(g.rankAfter)}).to_upper(), 18, rank.colour, true, 800))
	var lic: String = g.licenceAfter
	side.add_child(UIKit.label("%s %.2f   %s · %s %s" % [lic, c.sr, I18n.t(CareerData.LICENCE_NAME[lic]), I18n.t("Safety Rating"), sr_text], 15, Color(CareerData.LICENCE_COLOUR[lic]).lightened(0.35)))
	if lic != g.licenceBefore:
		var up: bool = CareerData.LICENCES.find(lic) > CareerData.LICENCES.find(g.licenceBefore)
		side.add_child(UIKit.label(I18n.t("Promoted to {lic}!", {"lic": I18n.t(CareerData.LICENCE_NAME[lic])}) if up else I18n.t("Back to {lic}: keep it clean", {"lic": I18n.t(CareerData.LICENCE_NAME[lic])}), 16, UIKit.GOOD if up else UIKit.BAD, true, 700))
	var d_r: int = int(g.get("ratingAfter", 0)) - int(g.get("ratingBefore", 0))
	if g.has("ratingAfter"):
		side.add_child(UIKit.label("%s %d   %s" % [I18n.t("Driver Rating"), int(g.ratingAfter), ("+%d" % d_r) if d_r > 0 else (("%d" % d_r) if d_r < 0 else "±0")], 15, UIKit.GOOD if d_r > 0 else (UIKit.BAD if d_r < 0 else UIKit.MUTED), false, 700))
	for a in g.get("achievements", []):
		var ap := PanelContainer.new()
		ap.add_theme_stylebox_override("panel", UIKit.box(Color(UIKit.ACCENT_2, 0.12), Color(UIKit.ACCENT_2, 0.7), 1, 4, Vector2(10, 3)))
		ap.add_child(UIKit.label("★  %s · %s  +%d XP" % [I18n.t(a[1]), I18n.t(a[2]), a[3]], 14, UIKit.ACCENT_2, false, 700))
		side.add_child(ap)
	row.add_child(side)
	var col := UIW.vbox(8)
	col.add_child(UIW.section(I18n.t("Career"), "+%d XP" % g.xp))
	col.add_child(row)
	return UIW.panel(col)
