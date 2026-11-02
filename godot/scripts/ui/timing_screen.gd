class_name TimingScreen
extends PanelContainer
## Full timing screen (hold Tab), like a qualifying monitor (port of ui/timingScreen.ts): position, driver, car, best
## lap and gap, last lap, best sectors (purple = fastest of the session), laps and the current status.

var _grid := GridContainer.new()
var _key := ""

func _init() -> void:
	add_theme_stylebox_override("panel", UIKit.box(Color(7 / 255.0, 8 / 255.0, 10 / 255.0, 0.92), UIKit.LINE, 1, 4, Vector2(18, 14)))
	var col := VBoxContainer.new()
	add_child(col)
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 16)
	col.add_child(head)
	head.add_child(UIKit.label(I18n.t("Timing"), 26, Color.WHITE, true, 800))
	head.add_child(UIKit.label(I18n.t("Best lap counts (penalties included) · release Tab to close"), 14, UIKit.MUTED))
	_grid.columns = 12
	_grid.add_theme_constant_override("h_separation", 16)
	_grid.add_theme_constant_override("v_separation", 3)
	col.add_child(_grid)
	visible = false

func set_shown(v: bool) -> void:
	visible = v

## info(id) -> {nick, car, colour, bot}. list: the standings.
func update_list(list: Array, me_id: String, info: Callable) -> void:
	var key := "|".join(list.map(func(r): return "%s%s%s%s%s%s%s%s%s%s" % [r.id, r.position, r.bestLapMs, r.lastLapMs, r.laps, r.inPit, r.outLap, r.lapPenaltyMs, r.penaltyMs, r.finishedMs]))
	if key == _key:
		return
	_key = key
	for c in _grid.get_children():
		c.queue_free()
	for h in [I18n.t("Pos"), I18n.t("Driver"), I18n.t("Car"), I18n.t("Best lap"), I18n.t("Gap"), I18n.t("Last lap"), "S1", "S2", "S3", I18n.t("Laps"), I18n.t("Penalties"), I18n.t("Status")]:
		_grid.add_child(UIKit.label(h.to_upper(), 12, UIKit.MUTED, true, 700))
	# fastest sector of the session (purple)
	var best := [INF, INF, INF]
	for r in list:
		for i in r.bestSectors.size():
			best[i] = minf(best[i], r.bestSectors[i])
	var purple := Color("c77dff")
	for r in list:
		var inf: Dictionary = info.call(r.id)
		var status: String
		var scol: Color
		if r.dnf:
			status = I18n.t("DNF")
			scol = UIKit.BAD
		elif r.finishedMs != null:
			status = I18n.t("FINISHED")
			scol = UIKit.GOOD
		elif r.inPit:
			status = I18n.t("IN PITS")
			scol = UIKit.ACCENT_2
		elif r.outLap:
			status = I18n.t("OUT LAP")
			scol = UIKit.MUTED
		elif r.lapPenaltyMs > 0:
			status = "%s +%.1f s" % [I18n.t("PEN"), r.lapPenaltyMs / 1000.0]
			scol = UIKit.BAD
		else:
			status = I18n.t("ON TIMED LAP")
			scol = UIKit.TEXT
		var is_me: bool = r.id == me_id
		var base := UIKit.ACCENT_2 if is_me else UIKit.TEXT
		_grid.add_child(UIKit.label("–" if r.bestLapMs == null else str(r.position), 16, base, true, 700))
		_grid.add_child(UIKit.label(inf.nick + (" AI" if inf.bot else ""), 15, base, false, 600))
		_grid.add_child(UIKit.label(inf.car, 14, UIKit.MUTED))
		_grid.add_child(UIKit.label(I18n.t("no time") if r.bestLapMs == null else UIKit.fmt_lap(r.bestLapMs), 15, purple if r.position == 1 and r.bestLapMs != null else base, true, 700))
		_grid.add_child(UIKit.label("" if r.bestLapMs == null or r.position == 1 or r.gapMs == null else "+%.3f" % (r.gapMs / 1000.0), 15, UIKit.MUTED, true, 700))
		_grid.add_child(UIKit.label("" if r.lastLapMs == null else UIKit.fmt_lap(r.lastLapMs), 15, base, true, 700))
		for k in 3:
			var s = r.bestSectors[k] if k < r.bestSectors.size() else null
			_grid.add_child(UIKit.label("" if s == null else "%.3f" % (s / 1000.0), 15, purple if s != null and s <= best[k] else base, true, 700))
		_grid.add_child(UIKit.label(str(r.laps), 15, base, true, 700))
		_grid.add_child(UIKit.label("+%.1f s" % (r.penaltyMs / 1000.0) if r.penaltyMs > 0 else "", 15, UIKit.MUTED, true, 700))
		_grid.add_child(UIKit.label(status, 14, scol, true, 700))
