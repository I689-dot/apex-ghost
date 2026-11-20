extends Node
## The mobile layout's progression rules (Progression), in memory (dry: nothing saved, no credits paid into the career):
## trophies by place, a cup's best kept and its credits for new trophies only, cups opening by trophies, the week's
## featured race, the pass tiers and claims (premium locked), the contracts' progress and claim, the daily wins and
## chests, the free bonus's cooldown, the interstitial's cadence.
##   tools/godot/gd.sh tests/progression_test.gd

var failures := 0

func _ok(cond: bool, what: String) -> void:
	print(("ok   " if cond else "FAIL ") + what)
	if not cond:
		failures += 1

func _ready() -> void:
	Progression.dry = true
	Progression.reset_cache()
	var p := Progression.data()
	_ok(Progression.trophies_for(1, 12) == 3 and Progression.trophies_for(3, 12) == 2 and Progression.trophies_for(6, 12) == 1 and Progression.trophies_for(7, 12) == 0 and Progression.trophies_for(0, 12) == 0, "trophies: 3 a win, 2 a podium, 1 a top six, none after or for a DNF")
	_ok(Progression.cup_open("rookie_cup") and not Progression.cup_open("d_trophy"), "the Rookie Cup is open, Class D shut at the start")
	# a cup race: P2, then P1 the second time (only the new trophy pays), then P5 (the best stays)
	Progression.set_event("rookie_cup", 0)
	var r1 := Progression.score_event(2, 8)
	_ok(r1.trophies == 2 and r1.gained == 2 and r1.credits == 2 * 1500, "P2 in a cup race: 2 trophies, their credits (%s)" % str(r1))
	Progression.set_event("rookie_cup", 0)
	var r2 := Progression.score_event(1, 8)
	_ok(r2.gained == 1 and r2.credits == 1500 and Progression.cup_results("rookie_cup")[0] == 3, "a win after it: one new trophy, paid once (%s)" % str(r2))
	Progression.set_event("rookie_cup", 0)
	var r3 := Progression.score_event(5, 8)
	_ok(r3.gained == 0 and r3.credits == 0 and Progression.cup_results("rookie_cup")[0] == 3, "a worse result keeps the best")
	_ok(Progression.score_event(1, 8).is_empty(), "no race set: nothing scored")
	p.cups["rookie_cup"] = [3, 3, 0]
	_ok(Progression.total_trophies() == 6 and Progression.cup_open("d_trophy") and not Progression.cup_open("c_series"), "6 trophies open Class D, not C")
	Progression.set_event("weekly", 0)
	var w := Progression.score_event(1, 12)
	_ok(w.get("weekly", false) and w.credits == 3 * 2 * 2000 and Progression.total_trophies() == 6, "the featured race: double credits, no cup trophies (%s)" % str(w))
	# the pass
	p.passXp = Progression.PASS_TIER_XP * 3 + 50
	_ok(Progression.pass_tier() == 3 and Progression.pass_into() == 50, "pass tier 3, 50 XP into the next")
	_ok(not Progression.claim_pass(1, false).is_empty() and Progression.claim_pass(1, false).is_empty(), "a reached free reward claims once")
	_ok(Progression.claim_pass(4, false).is_empty(), "a tier not reached cannot be claimed")
	_ok(Progression.claim_pass(2, true).is_empty() and Progression.pass_unclaimed() == 2, "premium locked; 2 free rewards still to claim")
	# contracts and the day's wins
	p.contracts = [{"kind": "win", "target": 1, "progress": 0, "claimed": false}, {"kind": "clean", "target": 5, "progress": 0, "claimed": false}, {"kind": "overtakes", "target": 3, "progress": 0, "claimed": false}]
	p.wins = 0
	p.chests = 0
	var xp0 := int(p.passXp)
	var s := Progression.record_session({"kind": "race", "position": 1, "field": 10, "start": 5, "laps": 4, "cleanLaps": 3, "km": 20.0})
	_ok(s.passXp > 0 and int(p.passXp) == xp0 + int(s.passXp), "a race gives pass XP (%d)" % s.passXp)
	_ok(int(p.contracts[0].progress) == 1 and int(p.contracts[1].progress) == 3 and int(p.contracts[2].progress) == 3, "the contracts advance: the win, 3 clean laps, 4 places gained (capped at 3)")
	_ok(s.chest and int(p.wins) == 1 and int(p.chests) == 1, "a win fills a daily chest")
	_ok(not Progression.claim_contract(0).is_empty() and Progression.claim_contract(0).is_empty() and Progression.claim_contract(1).is_empty(), "a done contract claims once; an unfinished one cannot")
	_ok(not Progression.open_chest().is_empty() and Progression.open_chest().is_empty(), "a chest opens once")
	p.wins = Progression.DAILY_WINS
	_ok(not Progression.record_session({"kind": "race", "position": 1, "field": 10}).chest, "no chest past the day's wins")
	# the free bonus and the interstitial
	p.freeBonusAt = 0
	_ok(not Progression.claim_free_bonus().is_empty() and Progression.free_bonus_left_s() > 0 and Progression.claim_free_bonus().is_empty(), "the free bonus, then its cooldown")
	p.racesSinceAd = 0
	for i in Progression.INTERSTITIAL_EVERY - 1:
		Progression.record_session({"kind": "race", "position": 4, "field": 10})
	_ok(not Progression.interstitial_due(), "no interstitial before its number of races")
	Progression.record_session({"kind": "race", "position": 4, "field": 10})
	_ok(Progression.interstitial_due(), "an interstitial after %d races" % Progression.INTERSTITIAL_EVERY)
	Progression.interstitial_shown()
	_ok(not Progression.interstitial_due(), "and not again until the next ones")
	print("%d failures" % failures)
	get_tree().quit(1 if failures > 0 else 0)
