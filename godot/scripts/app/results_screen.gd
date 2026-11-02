class_name ResultsScreen
extends RefCounted
## The results after a session (port of App.showResults): podium, the classification table, the career's gain, the
## weekend's Results & Stats, a championship round's scoring, and what comes next (the race loading by itself, the
## next round, or back to the lobby).

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
	var race: bool = m.kind == "race"
	var cars: Array = app.cars.cars
	var col := UIW.vbox(10)
	col.add_child(UIW.h2(I18n.t("Race results") if race else (I18n.t("Free practice results") if m.kind == "practice" else I18n.t("Qualifying results"))))
	var car_name := func(id) -> String:
		for c in cars:
			if c.id == id:
				return c.name
		return ""
	var fastest_id = m.fastestLap.id if m.get("fastestLap") != null else null
	# the podium
	var podium := UIW.hbox(14)
	var shown := 0
	for r in m.rows:
		if not _classified(r, race) or shown >= 3:
			continue
		var card := UIW.vbox(2)
		card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var img := UIW.image("res://assets/ui/cars/%s.webp" % r.carId, Vector2(0, 90))
		if img.texture == null:
			for c in cars:
				if c.id == r.carId:
					img.texture = UIW.tex(c.thumbnail)
		card.add_child(img)
		card.add_child(UIKit.label("P%d" % (shown + 1), 28, UIKit.ACCENT_2 if shown == 0 else UIKit.TEXT, true, 700))
		card.add_child(UIKit.label(r.nick, 18, UIKit.TEXT, false, 700))
		var t_text: String = (fmt_time(_total(r)) if shown == 0 else "+%.3f" % (float(r.get("gapMs", 0)) / 1000.0)) if race else fmt_time(r.bestLapMs)
		card.add_child(UIKit.label(t_text, 15, UIKit.MUTED))
		podium.add_child(UIW.panel(card))
		shown += 1
	col.add_child(podium)
	col.add_child(UIW.muted(I18n.t("Race time includes penalties: track limits after 3 warnings (0.5–3 s), reset (5 s), shortcut (5 s and more).") if race else I18n.t("Ranked by best lap. Penalties are added to the lap: track limits after 3 warnings (0.5–3 s), reset (5 s), shortcut (5 s and more).")))

	# the table
	var heads: Array = [I18n.t("Pos"), I18n.t("Driver"), I18n.t("Car"), I18n.t("Race time"), I18n.t("Gap"), I18n.t("Best lap"), I18n.t("Laps"), I18n.t("Penalties")] if race else [I18n.t("Pos"), I18n.t("Driver"), I18n.t("Car"), I18n.t("Best lap"), I18n.t("Gap"), I18n.t("Timed laps"), I18n.t("Penalties")]
	var grid := GridContainer.new()
	grid.columns = heads.size()
	grid.add_theme_constant_override("h_separation", 14)
	grid.add_theme_constant_override("v_separation", 4)
	for h in heads:
		grid.add_child(UIKit.label(String(h).to_upper(), 12, UIKit.MUTED, true, 700))
	for r in m.rows:
		var cl := _classified(r, race)
		var me: bool = r.id == app.me
		var cell := func(text: String, color: Color = UIKit.TEXT) -> void:
			grid.add_child(UIKit.label(text, 15, UIKit.ACCENT_2 if me and color == UIKit.TEXT else color, false, 700 if me else 500))
		cell.call(str(r.position) if cl else "—")
		cell.call(r.nick)
		cell.call(car_name.call(r.carId), UIKit.MUTED)
		if race:
			cell.call(I18n.t("DNF") if (r.dnf or _total(r) == null) else fmt_time(_total(r)))
		else:
			cell.call(I18n.t("no time") if r.bestLapMs == null else fmt_time(r.bestLapMs), UIKit.GOOD if fastest_id == r.id else UIKit.TEXT)
		cell.call("" if (not cl or not r.get("gapMs")) else "+%.3f" % (float(r.gapMs) / 1000.0), UIKit.MUTED)
		if race:
			cell.call("" if r.bestLapMs == null else fmt_time(r.bestLapMs), UIKit.GOOD if fastest_id == r.id else UIKit.TEXT)
		cell.call("%d%s" % [r.validLaps, (" · " + I18n.t("DNF")) if r.dnf and not race else ""], UIKit.MUTED)
		cell.call(("+%.1f s" % (float(r.penaltyMs) / 1000.0)) if r.penaltyMs > 0 else "", UIKit.MUTED)
	col.add_child(grid)
	if fastest_id != null:
		var who := ""
		for r in m.rows:
			if r.id == fastest_id:
				who = r.nick
		col.add_child(UIKit.label(I18n.t("Fastest lap: {nick} · {time}", {"nick": who, "time": fmt_time(m.fastestLap.ms)}), 16, UIKit.GOOD))
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
	var champ_track = app.room.get("conditions", {}).get("trackId")
	var next_button: Control = null
	var my_nick: String = app.my_info().get("nick", Settings.data.nickname)
	if race and champ != null and app.conn != null and LocalRoom.is_local_code(app.conn.code) and champ_track != null and (champ.rounds[champ.done] == champ_track if champ.done < champ.rounds.size() else false or champ.lastScored == "%s-%d" % [app.conn.code, m.raceId]):
		var fastest_nick = null
		if m.get("fastestLap") != null:
			for r in m.rows:
				if r.id == m.fastestLap.id:
					fastest_nick = r.nick
		Championship.score_race(champ, "%s-%d" % [app.conn.code, m.raceId], m.rows.map(func(r): return {"nick": r.nick, "carId": r.carId, "classified": _classified(r, true)}), fastest_nick)
		var over: bool = champ.done >= champ.rounds.size()
		Championship.save(null if over else champ)
		var table := Championship.standings(champ)
		var cb := UIW.vbox(4)
		cb.add_child(UIW.h3(I18n.t("Championship final standings") if over else I18n.t("Championship after round {n} of {m}", {"n": champ.done, "m": champ.rounds.size()})))
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
			next_button = UIKit.button(I18n.t("Next round: {track}", {"track": I18n.t(app.track_entry(next_track).get("name", next_track))}), func():
				if app.conn != null:
					app.conn.leave()
				app.teardown_connection()
				ChampionshipUI.start_round(app, champ, my_nick), true)

	# what comes next
	var foot := UIW.hbox(10)
	if m.get("raceAt") != null:
		var next := UIKit.label("", 18, UIKit.ACCENT_2)
		var tick := func():
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
		foot.add_child(next)
	elif next_button != null:
		foot.add_child(next_button)
	else:
		foot.add_child(UIKit.button(I18n.t("Back to lobby"), app.show_lobby, true))
	col.add_child(foot)
	var scroll := UIW.scroll(col)
	return UIW.margin(UIW.panel(scroll, true), 24)

static func _weekend_table(app: App, by: String) -> Control:
	var rows: Array = app.weekend.keys().map(func(k): return [k, app.weekend[k]])
	var sessions := [rows.any(func(r): return r[1].has("practice")), rows.any(func(r): return r[1].has("qualify")), rows.any(func(r): return r[1].has("race"))]
	if sessions.filter(func(b): return b).size() < 2:
		return null
	var key := func(w: Dictionary) -> int:
		if by == "race":
			return int(w.get("race", 999)) if str(w.get("race", "")).is_valid_int() else 999
		var v = w.get("qualify") if by == "qualify" else w.get("practice")
		return int(v) if v != null else 999
	rows.sort_custom(func(a, b): return key.call(a[1]) < key.call(b[1]))
	var grid := GridContainer.new()
	grid.columns = 6
	grid.add_theme_constant_override("h_separation", 16)
	for h in ["#", I18n.t("Driver"), I18n.t("Practice"), I18n.t("Qualify"), I18n.t("G"), I18n.t("Race")]:
		grid.add_child(UIKit.label(String(h).to_upper(), 12, UIKit.MUTED, true, 700))
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
	var col := UIW.vbox(6)
	col.add_child(UIW.h3(I18n.t("Results & stats")))
	col.add_child(grid)
	return col

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
	side.add_child(UIKit.label("%s   %d / %d XP" % [I18n.t("Level {n}", {"n": lv.level}), int(lv.into), lv.need], 16, UIKit.TEXT, false, 700))
	var bar := ProgressBar.new()
	bar.show_percentage = false
	bar.max_value = lv.need
	bar.value = lv.into
	bar.custom_minimum_size = Vector2(0, 10)
	side.add_child(bar)
	if g.levelAfter > g.levelBefore:
		side.add_child(UIKit.label(I18n.t("Level up! Level {n}", {"n": g.levelAfter}), 16, UIKit.GOOD, true, 700))
	var lic: String = g.licenceAfter
	side.add_child(UIKit.label("%s %.2f   %s · %s %s" % [lic, c.sr, I18n.t(CareerData.LICENCE_NAME[lic]), I18n.t("Safety Rating"), sr_text], 15, Color(CareerData.LICENCE_COLOUR[lic]).lightened(0.35)))
	if lic != g.licenceBefore:
		var up: bool = CareerData.LICENCES.find(lic) > CareerData.LICENCES.find(g.licenceBefore)
		side.add_child(UIKit.label(I18n.t("Promoted to {lic}!", {"lic": I18n.t(CareerData.LICENCE_NAME[lic])}) if up else I18n.t("Back to {lic}: keep it clean", {"lic": I18n.t(CareerData.LICENCE_NAME[lic])}), 16, UIKit.GOOD if up else UIKit.BAD, true, 700))
	row.add_child(side)
	var col := UIW.vbox(6)
	col.add_child(UIW.h3(I18n.t("Career")))
	col.add_child(row)
	return UIW.panel(col)
