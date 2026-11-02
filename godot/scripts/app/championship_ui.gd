class_name ChampionshipUI
extends RefCounted
## The championship menu and its rounds (port of App.championshipMenu / startChampionshipRound): carry on, start a new
## one (rounds, race length, how many AI drivers) or abandon it. Each round is an offline room on the round's circuit.

static func open(app: App, read_nick: Callable) -> void:
	var cur = Championship.load_saved()
	var m := UIW.modal(app.overlay_layer, 520)
	var body: VBoxContainer = m.body
	var close := func(): m.root.queue_free()
	var head := UIW.hbox(8)
	var title := UIW.vbox(0)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title.add_child(UIKit.label(I18n.t("OFFLINE"), 13, UIKit.ACCENT_2, true, 700))
	title.add_child(UIW.h2(I18n.t("Championship")))
	head.add_child(title)
	head.add_child(UIKit.button("×", close))
	body.add_child(head)
	var tracks: Array = app.track_index
	if cur != null:
		body.add_child(UIW.muted(I18n.t("Round {n} of {m}: {track}.", {"n": cur.done + 1, "m": cur.rounds.size(), "track": I18n.t(app.track_entry(cur.rounds[mini(cur.done, cur.rounds.size() - 1)]).get("name", ""))}), 16))
		for d in Championship.standings(cur).slice(0, 10):
			var row := UIW.hbox(8)
			var nm := UIKit.label(d.nick, 16)
			nm.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			row.add_child(nm)
			row.add_child(UIKit.label(str(d.points), 16, UIKit.TEXT, true, 700))
			body.add_child(row)
		body.add_child(UIKit.button(I18n.t("Continue"), func():
			var nick: String = read_nick.call()
			if nick == "":
				return
			close.call()
			await start_round(app, cur, nick), true))
		body.add_child(UIKit.button(I18n.t("Abandon and start a new one"), func():
			Championship.save(null)
			close.call()
			open(app, read_nick)))
		return
	body.add_child(UIW.muted(I18n.t("Qualifying and a race on each circuit, against the same AI drivers. Points for the top ten: 25, 18, 15, 12, 10, 8, 6, 4, 2, 1, and one for the fastest lap.")))
	# one round a circuit, on its main layout
	var picks := {}
	var seen := {}
	var list := UIW.vbox(4)
	body.add_child(UIW.h3(I18n.t("Rounds")))
	for t in tracks:
		var key := LobbyScreen.circuit_of(t)
		if seen.has(key):
			continue
		seen[key] = true
		var main: Dictionary = t
		for x in tracks:
			if LobbyScreen.circuit_of(x) == key and x.get("default", false):
				main = x
		picks[main.id] = true
		var cb := CheckBox.new()
		cb.focus_mode = Control.FOCUS_NONE
		cb.text = "%s · %.2f km" % [I18n.t(LobbyScreen.CIRCUIT_NAME.get(key, main.name)), float(main.length) / 1000.0]
		cb.button_pressed = true
		var id: String = main.id
		cb.toggled.connect(func(on): if on: picks[id] = true else: picks.erase(id))
		list.add_child(cb)
	body.add_child(list)
	var laps := [5]
	var bots := [9]
	body.add_child(UIW.field(I18n.t("Race length"), UIW.chips(5, [3, 5, 10, 15].map(func(v): return [v, I18n.t("{n} laps", {"n": v})]), func(v): laps[0] = v)))
	body.add_child(UIW.field(I18n.t("AI drivers"), UIW.chips(9, [5, 9, 11].map(func(v): return [v, str(v)]), func(v): bots[0] = v)))
	body.add_child(UIKit.button(I18n.t("Start the championship"), func():
		var nick: String = read_nick.call()
		if nick == "" or picks.is_empty():
			return
		var rounds: Array = []
		var added := {}
		for t in tracks:
			if picks.has(t.id) and not added.has(t.id):
				added[t.id] = true
				rounds.append(t.id)
		var c := Championship.create(rounds, laps[0], 10, bots[0])
		Championship.save(c)
		close.call()
		await start_round(app, c, nick), true))

## A championship round: an offline room on the round's circuit, qualifying and the race set, the AI drivers in.
static func start_round(app: App, c: Dictionary, nick: String) -> void:
	if c.done >= c.rounds.size():
		return
	var err := await app.join(LocalRoom.create(), nick)
	if err != "":
		app.show_menu(err)
		return
	app.send({"t": "setConditions", "trackId": c.rounds[c.done]})
	app.send({"t": "setPractice", "minutes": 0})
	app.send({"t": "setSession", "minutes": c.qualiMinutes})
	app.send({"t": "setRaceMinutes", "minutes": 0})
	app.send({"t": "setRaceLaps", "laps": c.raceLaps})
	for i in c.bots:
		app.send({"t": "addBot"})
