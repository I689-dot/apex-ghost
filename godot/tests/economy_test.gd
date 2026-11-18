extends Node
## Coins, codes, invites and the ranking from the game against a server (APEX_SERVER=http://127.0.0.1:8799 with
## `wrangler dev` in apps/server; never the live one): a driver's invite code signs a second one up with coins, a code
## adds its coins once, the store shows the server's balance, the ranking answers. The signed-in account from before
## the test is put back.
##   APEX_SERVER=http://127.0.0.1:8799 tools/godot/gd.sh tests/economy_test.gd

var failures := 0

func _ok(cond: bool, what: String) -> void:
	print(("ok   " if cond else "FAIL ") + what)
	if not cond:
		failures += 1

func _ready() -> void:
	_run.call_deferred()

func _run() -> void:
	if not Config.SERVER_URL.begins_with("http://127.0.0.1") and not Config.SERVER_URL.begins_with("http://localhost"):
		print("economy_test runs against a local server only: APEX_SERVER=http://127.0.0.1:8799")
		get_tree().quit(1)
		return
	var before = Account.account()
	var a := "eco%d" % (randi() % 100000)
	var b := "eco%d" % (randi() % 100000)
	var ra: Dictionary = await Account.register(a, "pass1")
	_ok(ra.ok, "a driver signs up (%s)" % str(ra.get("error", "")))
	var inv: Dictionary = await Account.invite()
	_ok(inv.ok and str(inv.data.code).begins_with("CG-"), "their invite code (%s)" % str(inv.data.get("code", "")))
	var rb: Dictionary = await Account.register(b, "pass1", str(inv.data.code).to_lower())
	_ok(rb.ok, "a friend signs up with it")
	var w: Dictionary = await Account.wallet()
	_ok(w.ok and int(w.data.coins) == 300, "the friend starts with 300 coins (%s)" % str(w.data.get("coins")))
	var rd: Dictionary = await Account.redeem("welcome500")
	_ok(rd.ok and int(rd.data.coins) == 800, "a code adds its 500 (%s)" % str(rd.data))
	var rd2: Dictionary = await Account.redeem("WELCOME500")
	_ok(not rd2.ok and rd2.status == 409, "the same code a second time is refused (%s)" % rd2.error)
	StoreScreen._fetched_at = -1000000
	await StoreScreen.refresh(Callable(), true)
	_ok(StoreScreen.coins() == 800 and (StoreScreen._live.ledger as Array).size() == 2, "the store shows the server's balance and its history")
	var rk: Dictionary = await Account.ranking("global")
	_ok(rk.ok and rk.data.me != null and int(rk.data.me.rating) == 1500, "the ranking answers with my place (%s)" % str(rk.data.get("me")))
	var rf: Dictionary = await Account.ranking("friends")
	_ok(rf.ok, "the friends ranking answers")
	# the account from before the test back (none: signed out)
	Account._save(before)
	StoreScreen._live = {}
	StoreScreen._live_invite = {}
	print("%d failures" % failures)
	get_tree().quit(1 if failures > 0 else 0)
