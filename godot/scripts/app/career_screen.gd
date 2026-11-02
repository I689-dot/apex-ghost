class_name CareerScreen
extends RefCounted
## The solo career at a glance (the driver profile of Forza, GT and iRacing): rank and level with the XP to the next,
## the licence and its Safety Rating towards promotion, the Driver Rating, the record, the achievements and the ranks.

static func build(app: App) -> Control:
	var c := CareerData.load_career()
	var lv := CareerData.level_of(c.xp)
	var rank := CareerData.rank_of(lv.level)

	# left: who you are
	var left := UIW.vbox(12)
	left.custom_minimum_size = Vector2(360, 0)
	var head := UIW.hbox(14)
	var badge := PanelContainer.new()
	badge.add_theme_stylebox_override("panel", UIKit.box(Color(rank.colour, 0.18), rank.colour, 3, 40, Vector2(0, 0)))
	badge.custom_minimum_size = Vector2(80, 80)
	var num := UIKit.label(str(lv.level), 38, Color.WHITE, true, 800)
	num.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	num.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	badge.add_child(num)
	head.add_child(badge)
	var who := UIW.vbox(0)
	who.alignment = BoxContainer.ALIGNMENT_CENTER
	who.add_child(UIKit.label(I18n.t("RANK"), 13, UIKit.MUTED, true, 700))
	who.add_child(UIKit.label(I18n.t(rank.name).to_upper(), 30, rank.colour, true, 800))
	who.add_child(UIKit.label(I18n.t("Level {n}", {"n": lv.level}), 16, UIKit.TEXT, false, 600))
	head.add_child(who)
	left.add_child(head)
	left.add_child(_bar(lv.into / float(lv.need), rank.colour, "%d / %d XP" % [int(lv.into), lv.need],
		I18n.t("Next rank at level {n}", {"n": rank.next}) if rank.next > 0 else I18n.t("Top rank")))

	# the licence: SR towards promotion (3.00 as a rookie, 4.00 after), demotion under 1.00
	var lic: String = c.licence
	var lic_col := Color(CareerData.LICENCE_COLOUR[lic])
	var target := 3.0 if lic == "R" else 4.0
	var lrow := UIW.hbox(12)
	var lb := PanelContainer.new()
	lb.add_theme_stylebox_override("panel", UIKit.box(lic_col, Color(1, 1, 1, 0.25) if lic == "P" else Color(0, 0, 0, 0), 1 if lic == "P" else 0, 4, Vector2(12, 4)))
	lb.add_child(UIKit.label(lic, 30, Color.WHITE, true, 800))
	lrow.add_child(lb)
	var lcol := UIW.vbox(0)
	lcol.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	lcol.add_child(UIKit.label(I18n.t(CareerData.LICENCE_NAME[lic]).to_upper(), 18, UIKit.TEXT, true, 700))
	lcol.add_child(UIKit.label("%s %.2f" % [I18n.t("Safety Rating"), c.sr], 15, UIKit.MUTED))
	lrow.add_child(lcol)
	left.add_child(lrow)
	if lic != "P":
		left.add_child(_bar(c.sr / target, lic_col.lightened(0.2), "%.2f / %.2f" % [c.sr, target], I18n.t("Promotion at {sr} SR: drive clean, every corner without an incident counts", {"sr": "%.2f" % target})))
	var stats_top := UIW.hbox(10)
	stats_top.add_child(_stat(I18n.t("Driver Rating"), str(int(c.get("rating", CareerData.RATING_START))), UIKit.ACCENT_2))
	stats_top.add_child(_stat(I18n.t("Credits"), _thousands(int(c.coins)), UIKit.TEXT))
	left.add_child(stats_top)

	# right: record, achievements, ranks
	var right := UIW.vbox(14)
	right.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	right.add_child(UIW.h3(I18n.t("Record")))
	var grid := GridContainer.new()
	grid.columns = 4
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	var races := int(c.races)
	for st in [[I18n.t("Races"), str(races)], [I18n.t("Wins"), str(int(c.wins))], [I18n.t("Podiums"), str(int(c.podiums))], [I18n.t("Poles"), str(int(c.poles))],
			[I18n.t("Win rate"), ("%d %%" % roundi(100.0 * c.wins / races)) if races > 0 else "–"], [I18n.t("Clean laps"), str(int(c.cleanLaps))],
			[I18n.t("Distance"), "%d km" % roundi(c.km)], [I18n.t("Sessions"), str(int(c.sessions))]]:
		grid.add_child(_stat(st[0], st[1], UIKit.TEXT))
	right.add_child(grid)

	var got: Array = c.get("achievements", [])
	right.add_child(UIW.h3(I18n.t("Achievements {n}/{max}", {"n": got.size(), "max": CareerData.ACHIEVEMENTS.size()})))
	var ach := GridContainer.new()
	ach.columns = 2
	ach.add_theme_constant_override("h_separation", 10)
	ach.add_theme_constant_override("v_separation", 8)
	# the unlocked ones first
	var list: Array = CareerData.ACHIEVEMENTS.filter(func(a): return got.has(a[0])) + CareerData.ACHIEVEMENTS.filter(func(a): return not got.has(a[0]))
	for a in list:
		ach.add_child(_achievement(a, got.has(a[0])))
	right.add_child(ach)

	right.add_child(UIW.h3(I18n.t("Ranks")))
	var ladder := HFlowContainer.new()
	ladder.add_theme_constant_override("h_separation", 6)
	ladder.add_theme_constant_override("v_separation", 6)
	for i in CareerData.RANKS.size():
		var r: Array = CareerData.RANKS[i]
		var on: bool = i == rank.index
		var done: bool = i < rank.index
		var p := PanelContainer.new()
		var col := Color(r[2])
		p.add_theme_stylebox_override("panel", UIKit.box(Color(col, 0.3 if on else (0.12 if done else 0.04)), col if on else Color(1, 1, 1, 0.08), 2 if on else 1, 4, Vector2(10, 4)))
		var t := UIW.vbox(0)
		t.add_child(UIKit.label(I18n.t(r[1]).to_upper(), 15, Color.WHITE if (on or done) else UIKit.MUTED, true, 700))
		t.add_child(UIKit.label(I18n.t("Level {n}", {"n": r[0]}), 12, UIKit.MUTED))
		p.add_child(t)
		ladder.add_child(p)
	right.add_child(ladder)

	var body := UIW.hbox(18)
	body.add_child(UIW.panel(left, true))
	body.add_child(UIW.scroll(right))
	var top := UIW.hbox(14)
	top.add_child(UIKit.button("‹  " + I18n.t("Menu"), app.show_menu))
	var title := UIKit.label(I18n.t("Career"), 30, UIKit.TEXT, true, 700)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(title)
	top.add_child(UIKit.button(I18n.t("Lap records"), func(): SocialUI.records_modal(app)))
	var root := UIW.vbox(12)
	root.add_child(top)
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	root.add_child(body)
	return UIW.margin(root, 18)

static func _bar(frac: float, colour: Color, text: String, sub: String) -> Control:
	var col := UIW.vbox(3)
	var row := UIW.hbox(8)
	var pb := ProgressBar.new()
	pb.show_percentage = false
	pb.max_value = 1.0
	pb.value = clampf(frac, 0.0, 1.0)
	pb.custom_minimum_size = Vector2(0, 12)
	pb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	pb.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	pb.add_theme_stylebox_override("background", UIKit.box(Color(1, 1, 1, 0.1), Color(0, 0, 0, 0), 0, 6))
	pb.add_theme_stylebox_override("fill", UIKit.box(colour, Color(0, 0, 0, 0), 0, 6))
	row.add_child(pb)
	row.add_child(UIKit.label(text, 14, UIKit.TEXT, false, 700))
	col.add_child(row)
	if sub != "":
		col.add_child(UIW.muted(sub, 13))
	return col

static func _stat(label: String, value: String, colour: Color) -> Control:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", UIKit.box(Color(1, 1, 1, 0.05), UIKit.LINE, 1, 4, Vector2(12, 6)))
	p.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var col := UIW.vbox(0)
	col.add_child(UIKit.label(label.to_upper(), 12, UIKit.MUTED, true, 700))
	col.add_child(UIKit.label(value, 24, colour, true, 800))
	p.add_child(col)
	return p

static func _achievement(a: Array, done: bool) -> Control:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", UIKit.box(Color(UIKit.ACCENT_2, 0.1) if done else Color(1, 1, 1, 0.03), Color(UIKit.ACCENT_2, 0.6) if done else UIKit.LINE, 1, 4, Vector2(10, 6)))
	p.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var row := UIW.hbox(10)
	var mark := UIKit.label("★" if done else "☆", 22, UIKit.ACCENT_2 if done else UIKit.MUTED, true, 800)
	row.add_child(mark)
	var col := UIW.vbox(0)
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	col.add_child(UIKit.label(I18n.t(a[1]), 16, UIKit.TEXT if done else UIKit.MUTED, false, 700))
	col.add_child(UIKit.label(I18n.t(a[2]), 13, UIKit.MUTED))
	row.add_child(col)
	row.add_child(UIKit.label("+%d XP" % a[3], 13, UIKit.ACCENT_2 if done else UIKit.MUTED, true, 700))
	p.add_child(row)
	return p

static func _thousands(n: int) -> String:
	var s := str(absi(n))
	var out := ""
	while s.length() > 3:
		out = "," + s.substr(s.length() - 3) + out
		s = s.substr(0, s.length() - 3)
	return ("-" if n < 0 else "") + s + out
