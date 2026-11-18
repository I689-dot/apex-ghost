class_name CareerScreen
extends RefCounted
## The solo career at a glance (the driver profile of Forza, GT and iRacing), laid out as Le Mans Ultimate's profile:
## Profile (the driver's name with rank and level and the XP to the next, the licence and its Safety Rating towards
## promotion, the Driver Rating, the record as big numbers and stat tiles), Achievements, Ranks, and the online Ranking
## (every driver by the server's Driver Rating, which online races move: the server's economy.ts).

static var _tab := "profile"

static func build(app: App) -> Control:
	var c := CareerData.load_career()
	var body: Control
	match _tab:
		"achievements":
			body = _achievements(c)
		"ranks":
			body = _ranks(c)
		"ranking":
			body = _ranking(app)
		_:
			body = _profile(c)
	var top := UIW.top_bar({
		"title": I18n.t("Career"), "back": app.show_menu,
		"tabs": [["profile", I18n.t("Profile")], ["achievements", I18n.t("Achievements")], ["ranks", I18n.t("Ranks")], ["ranking", I18n.t("Ranking")]],
		"tab": _tab, "on_tab": func(k): _tab = k; app.show_career(), "tabs_left": UIKit.touch(),
		"right": [UIKit.button(I18n.t("Lap records"), func(): SocialUI.records_modal(app))],
	})
	return UIW.screen(top, body)

static func _name() -> String:
	var a = Account.account()
	if a != null:
		return str(a.user.nick)
	var n := str(Settings.data.get("nickname", ""))
	return n if n != "" else I18n.t("Driver")

# ---------------------------------------------------------------- profile ---

static func _profile(c: Dictionary) -> Control:
	var touch := UIKit.touch()
	var lv := CareerData.level_of(c.xp)
	var rank := CareerData.rank_of(lv.level)
	var col := UIW.vbox(18 if touch else 24)

	# the header: the level in the rank's ring, the name, rank and the XP bar
	var head := UIW.hbox(22)
	var ring := PanelContainer.new()
	ring.add_theme_stylebox_override("panel", UIKit.box(Color(rank.colour, 0.16), rank.colour, 4, 60))
	var rs := 96 if touch else 116
	ring.custom_minimum_size = Vector2(rs, rs)
	ring.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var num := UIKit.label(str(lv.level), 48 if touch else 58, Color.WHITE, true, 700)
	num.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	num.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	ring.add_child(num)
	head.add_child(ring)
	head.add_child(UIW.hair(true, Color(1, 1, 1, 0.3)))
	var who := UIW.vbox(2)
	who.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	who.alignment = BoxContainer.ALIGNMENT_CENTER
	var nm := UIKit.label(_name().to_upper(), 48 if touch else 60, UIKit.TEXT, true, 700)
	nm.clip_text = true
	who.add_child(nm)
	var tags := UIW.hbox(8)
	tags.add_child(UIW.tag(I18n.t(rank.name), rank.colour, true, UIKit.INK))
	tags.add_child(UIKit.label(I18n.t("Level {n}", {"n": lv.level}).to_upper(), 18, UIKit.SOFT, true, 600))
	who.add_child(tags)
	who.add_child(_bar(lv.into / float(lv.need), Color.WHITE, "%d / %d XP" % [int(lv.into), lv.need],
		I18n.t("Next rank at level {n}", {"n": rank.next}) if rank.next > 0 else I18n.t("Top rank")))
	head.add_child(who)
	var hp := UIW.panel(UIW.margins(head, 6, 4, 10, 4))
	col.add_child(hp)

	# the licence and the ratings, as the references' rank tiles; the record's headline numbers beside them
	var lic: String = c.licence
	var lic_col := Color(CareerData.LICENCE_COLOUR[lic])
	var target := 3.0 if lic == "R" else 4.0
	var row := UIW.hbox(18 if touch else 28)
	var cs := UIW.vbox(8)
	cs.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	cs.add_child(UIKit.label(I18n.t("Career stats").to_upper(), 24, UIKit.TEXT, true, 600))
	var nums := UIW.hbox(10)
	nums.size_flags_vertical = Control.SIZE_EXPAND_FILL
	for st in [[str(int(c.races)), I18n.t("Races")], [str(int(c.wins)), I18n.t("Wins")], [str(int(c.podiums)), I18n.t("Podiums")]]:
		var b := UIW.big_stat(st[0], st[1], 56 if touch else 68)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.alignment = BoxContainer.ALIGNMENT_CENTER
		nums.add_child(b)
	cs.add_child(nums)
	row.add_child(cs)
	row.add_child(UIW.hair(true, Color(1, 1, 1, 0.3)))
	row.add_child(_rank_tile(I18n.t("Licence"), lic, clampf(c.sr / target, 0.0, 1.0), I18n.t(CareerData.LICENCE_NAME[lic]), lic_col))
	row.add_child(_rank_tile(I18n.t("Safety Rating"), "%.2f" % c.sr, clampf(c.sr / target, 0.0, 1.0),
		I18n.t("Promotion at {sr}", {"sr": "%.2f" % target}) if lic != "P" else I18n.t(CareerData.LICENCE_NAME[lic]), Color("dfe7f2")))
	var rating := int(c.get("rating", CareerData.RATING_START))
	row.add_child(_rank_tile(I18n.t("Driver Rating"), str(rating), clampf((rating - 1000.0) / 2000.0, 0.0, 1.0), I18n.t("Credits") + " " + _thousands(int(c.coins)), Color("f2d36b")))
	col.add_child(row)
	if lic != "P":
		col.add_child(UIW.muted(I18n.t("Promotion at {sr} SR: drive clean, every corner without an incident counts", {"sr": "%.2f" % target}), 14))

	# the rest of the record as tiles
	col.add_child(UIW.section(I18n.t("Overall stats")))
	var grid := GridContainer.new()
	grid.columns = 3 if touch else 6
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	var races := int(c.races)
	for st in [[str(int(c.poles)), I18n.t("Poles")], [("%d %%" % roundi(100.0 * c.wins / races)) if races > 0 else "–", I18n.t("Win rate")],
			[str(int(c.cleanLaps)), I18n.t("Clean laps")], ["%d km" % roundi(c.km), I18n.t("Distance")], [str(int(c.sessions)), I18n.t("Sessions")],
			[_thousands(int(c.coins)), I18n.t("Credits")]]:
		var t := UIW.big_stat(st[0], st[1], 40 if touch else 46)
		var tl := UIW.tile(t, Vector2(10, 12))
		tl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		grid.add_child(tl)
	col.add_child(grid)
	return UIW.scroll(col)

## The references' DRIVER RANK tile: a title over a light box with the big value, a bar and a caption band.
static func _rank_tile(title: String, value: String, frac: float, caption: String, colour: Color) -> Control:
	var touch := UIKit.touch()
	var col := UIW.vbox(8)
	var t := UIKit.label(title.to_upper(), 24, UIKit.TEXT, true, 600)
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(t)
	var box := PanelContainer.new()
	box.add_theme_stylebox_override("panel", UIKit.box(colour, Color(1, 1, 1, 0.4), 2, 6))
	box.custom_minimum_size = Vector2(130 if touch else 150, 0)
	var inner := UIW.vbox(0)
	var dark := colour.get_luminance() > 0.45
	var ink := UIKit.INK if dark else Color.WHITE
	var v := UIKit.label(value, 50 if touch else 60, ink, true, 600)
	v.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	inner.add_child(v)
	var pb := ProgressBar.new()
	pb.show_percentage = false
	pb.max_value = 1.0
	pb.value = frac
	pb.custom_minimum_size = Vector2(0, 5)
	pb.add_theme_stylebox_override("background", UIKit.box(Color(ink, 0.25), Color(0, 0, 0, 0), 0, 1))
	pb.add_theme_stylebox_override("fill", UIKit.box(ink, Color(0, 0, 0, 0), 0, 1))
	inner.add_child(UIW.margins(pb, 14, 0, 14, 10))
	var cap := PanelContainer.new()
	cap.add_theme_stylebox_override("panel", UIKit.box(Color(1, 1, 1, 0.92), Color(0, 0, 0, 0), 0, 0, Vector2(8, 6)))
	var cl := UIKit.label(caption.to_upper(), 17, colour.darkened(0.35) if not dark else UIKit.INK, true, 600)
	cl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	cl.clip_text = true
	cap.add_child(cl)
	inner.add_child(cap)
	box.add_child(inner)
	col.add_child(box)
	return col

static func _bar(frac: float, colour: Color, text: String, sub: String) -> Control:
	var col := UIW.vbox(3)
	var row := UIW.hbox(10)
	var pb := ProgressBar.new()
	pb.show_percentage = false
	pb.max_value = 1.0
	pb.value = clampf(frac, 0.0, 1.0)
	pb.custom_minimum_size = Vector2(0, 6)
	pb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	pb.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	pb.add_theme_stylebox_override("fill", UIKit.box(colour, Color(0, 0, 0, 0), 0, 2))
	row.add_child(pb)
	row.add_child(UIKit.label(text, 15, UIKit.TEXT, false, 700))
	col.add_child(row)
	if sub != "":
		col.add_child(UIW.muted(sub, 13))
	return col

# ----------------------------------------------------------- achievements ---

static func _achievements(c: Dictionary) -> Control:
	var got: Array = c.get("achievements", [])
	var col := UIW.vbox(14)
	col.add_child(UIW.section(I18n.t("Achievements"), "%d / %d" % [got.size(), CareerData.ACHIEVEMENTS.size()]))
	var grid := GridContainer.new()
	grid.columns = 2 if UIKit.touch() else 3
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	# the unlocked ones first
	var list: Array = CareerData.ACHIEVEMENTS.filter(func(a): return got.has(a[0])) + CareerData.ACHIEVEMENTS.filter(func(a): return not got.has(a[0]))
	for a in list:
		grid.add_child(_achievement(a, got.has(a[0])))
	col.add_child(grid)
	return UIW.scroll(col)

static func _achievement(a: Array, done: bool) -> Control:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", UIKit.box(Color(UIKit.ACCENT_2, 0.12) if done else Color(1, 1, 1, 0.05), Color(UIKit.ACCENT_2, 0.7) if done else Color(1, 1, 1, 0.08), 1, 8, Vector2(12, 10)))
	p.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var row := UIW.hbox(12)
	row.add_child(UIKit.label("★" if done else "☆", 28, UIKit.ACCENT_2 if done else Color(1, 1, 1, 0.3), true, 800))
	var col := UIW.vbox(0)
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	col.add_child(UIKit.label(I18n.t(a[1]).to_upper(), 19, UIKit.TEXT if done else Color(1, 1, 1, 0.6), true, 600))
	var d := UIKit.label(I18n.t(a[2]), 14, UIKit.SOFT)
	d.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	col.add_child(d)
	row.add_child(col)
	var xp := UIKit.label("+%d XP" % a[3], 16, UIKit.ACCENT_2 if done else Color(1, 1, 1, 0.4), true, 700)
	xp.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(xp)
	p.add_child(row)
	return p

# ------------------------------------------------------------------ ranks ---

static func _ranks(c: Dictionary) -> Control:
	var lv := CareerData.level_of(c.xp)
	var rank := CareerData.rank_of(lv.level)
	var col := UIW.vbox(14)
	col.add_child(UIW.section(I18n.t("Ranks"), I18n.t(rank.name)))
	col.add_child(UIW.muted(I18n.t("Next rank at level {n}", {"n": rank.next}) if rank.next > 0 else I18n.t("Top rank"), 15))
	var grid := GridContainer.new()
	grid.columns = 5
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	for i in CareerData.RANKS.size():
		var r: Array = CareerData.RANKS[i]
		var on: bool = i == rank.index
		var done: bool = i < rank.index
		var colour := Color(r[2])
		var p := PanelContainer.new()
		p.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		p.add_theme_stylebox_override("panel", UIKit.box(Color(colour, 0.3 if on else (0.14 if done else 0.05)), Color.WHITE if on else Color(colour, 0.5 if done else 0.15), 2 if on else 1, 8, Vector2(12, 10)))
		var t := UIW.vbox(0)
		var top := UIW.hbox(6)
		var nm := UIKit.label(I18n.t(r[1]).to_upper(), 22, Color.WHITE if (on or done) else Color(1, 1, 1, 0.45), true, 600)
		nm.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		nm.clip_text = true
		top.add_child(nm)
		if on:
			top.add_child(UIW.tag(I18n.t("You"), Color.WHITE, true, UIKit.INK))
		t.add_child(top)
		t.add_child(UIKit.label(I18n.t("Level {n}", {"n": r[0]}), 14, UIKit.SOFT))
		var strip := ColorRect.new()
		strip.color = colour if (on or done) else Color(colour, 0.3)
		strip.custom_minimum_size = Vector2(0, 4)
		t.add_child(UIW.margins(strip, 0, 8, 0, 0))
		p.add_child(t)
		grid.add_child(p)
	col.add_child(grid)
	return UIW.scroll(col)

static var _scope := "global"

## The online ranking: the drivers by Driver Rating (global or me and my friends), my place in it.
static func _ranking(app: App) -> Control:
	var col := UIW.vbox(12)
	if Account.account() == null:
		col.add_child(UIW.section(I18n.t("Ranking")))
		col.add_child(UIW.muted(I18n.t("You are playing offline: the ranking needs the game server.")))
		return col
	var head := UIW.hbox(12)
	head.add_child(UIW.chips(_scope, [["global", I18n.t("Everyone")], ["friends", I18n.t("Friends")]], func(v): _scope = v; app.show_career()))
	head.add_child(UIW.spacer())
	var mine := UIKit.label("", 22, UIKit.ACCENT_2, true, 700)
	head.add_child(mine)
	col.add_child(head)
	col.add_child(UIW.muted(I18n.t("Online races move your Driver Rating: up for finishing ahead of the field's middle, down behind it, more in a bigger field. Races with other people only (not with AI cars alone)."), 14))
	var table := UIW.vbox(0)
	var note := UIW.muted(I18n.t("Loading…"))
	table.add_child(note)
	col.add_child(table)
	var fill := func() -> void:
		var r: Dictionary = await Account.ranking(_scope)
		if not is_instance_valid(table):
			return
		note.queue_free()
		if not r.ok:
			table.add_child(UIW.muted(I18n.t(str(r.error))))
			return
		var me = r.data.get("me")
		if me != null:
			mine.text = "%s  #%d · DR %d · %s" % [I18n.t("You").to_upper(), int(me.rank), int(me.rating), I18n.t("{n} races", {"n": int(me.races)})]
		var rows: Array = r.data.get("rows", [])
		if rows.is_empty():
			table.add_child(UIW.muted(I18n.t("Nobody has raced online yet: be the first.")))
			return
		var my_nick: String = str(Account.account().user.nick) if Account.account() != null else ""
		var head_row := UIW.hbox(12)
		for h in [["#", 50], [I18n.t("Driver"), 0], [I18n.t("Country"), 90], [I18n.t("Races"), 90], ["DR", 90]]:
			var l := UIKit.label(String(h[0]).to_upper(), 14, UIKit.DIM, true, 600)
			if int(h[1]) > 0:
				l.custom_minimum_size = Vector2(h[1], 0)
			else:
				l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			head_row.add_child(l)
		table.add_child(UIW.margins(head_row, 10, 0, 10, 4))
		for i in rows.size():
			var e: Dictionary = rows[i]
			var me_row: bool = str(e.nick) == my_nick
			var row := UIW.hbox(12)
			var cells := [[str(i + 1), 50], [str(e.nick) + ("  · " + str(e.abbr) if e.get("abbr") else ""), 0], [str(e.get("country")) if e.get("country") else "—", 90], [str(int(e.races)), 90], [str(int(e.rating)), 90]]
			for c in cells:
				var l := UIKit.label(String(c[0]), 18, UIKit.ACCENT_2 if me_row else UIKit.TEXT, c[1] != 0, 600 if c[1] != 0 else 500)
				if int(c[1]) > 0:
					l.custom_minimum_size = Vector2(c[1], 0)
				else:
					l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
				row.add_child(l)
			table.add_child(UIW.row_line(row))
	fill.call()
	return UIW.scroll(col)

static func _thousands(n: int) -> String:
	var s := str(absi(n))
	var out := ""
	while s.length() > 3:
		out = "," + s.substr(s.length() - 3) + out
		s = s.substr(0, s.length() - 3)
	return ("-" if n < 0 else "") + s + out
