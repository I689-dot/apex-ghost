class_name Shop
extends RefCounted
## What the phone store offers and remembers (docs/prompts/mobile-f2p-pass.md 22, 23, 27-30, C, E; references 006-010,
## 036, 058-066, 092): the starter offer of the first days, the daily, weekly and monthly deals, the free gift of the
## day, the free pack an ad opens and the ad ladder. Kept in the progression's file (Progression.data().shop).
## Money is never taken here: anything priced in euros goes to the checkout preview (StoreScreen.checkout) until Google
## Play Billing is set up with the user's OK. Credits are the career's, real.
##
## Random contents (decision C): only in free packs (an ad, a gift), always with their odds shown (FREE_PACK_ODDS);
## anything sold has fixed, listed contents.

## The starter offer: for this long after the store is first opened.
const STARTER_S := 3 * 86400
const STARTER := {"price": 0.99, "credits": 150000, "coins": 300, "blueprints": 10}
## The free pack's possible contents: [weight %, kind, low, high]. Shown as the odds.
const FREE_PACK_ODDS := [[55, "credits", 6000, 15000], [30, "blueprints", 2, 4], [15, "passXp", 200, 400]]
## Free packs (each by an ad) a day.
const FREE_PACKS_DAY := 3
## The ad ladder (reference 036): ads each step takes, and its reward. A step opens when the one before is done;
## the ladder starts again each day.
const LADDER := [[1, ["credits", 10000]], [2, ["blueprints", 4]], [3, ["credits", 40000]], [4, ["blueprints", 10]]]
## Money offers: [id, title, contents (fixed), price EUR, tag]. Deals rotate by the day, week and month.
const DAILY_DEALS := [
	["d_cr", "Credit crate", [["credits", 60000]], 0.99, "-50%"],
	["d_bp", "Blueprint bundle", [["blueprints", 12]], 1.49, "-40%"],
	["d_mix", "Pit stop pack", [["credits", 40000], ["blueprints", 6]], 1.29, "-45%"],
]
const WEEKLY_DEALS := [
	["w_bp", "Blueprint chest", [["blueprints", 30], ["credits", 50000]], 4.99, "-60%"],
	["w_cr", "Credit vault", [["credits", 400000]], 4.99, "-55%"],
]
const MONTHLY_DEALS := [
	["m_big", "Season stockpile", [["credits", 1200000], ["blueprints", 60], ["coins", 1500]], 19.99, "-70%"],
]
## The VIP subscription (decision E; references 066, 074, 094): its price a month, the free trial, the perks. Perks do
## not sell race results: more of what racing earns, no ads, cosmetics and a daily gift.
const VIP := {"price": 3.99, "trialDays": 3, "perks": [
	"No ads: the rewards of rewarded ads without watching them",
	"+25 % credits from every race",
	"A daily VIP gift: 10,000 credits and 2 blueprints",
	"Exclusive paint designs and a VIP badge on your profile",
	"Edit your driver name at any time",
]}
## Removing ads for good (reference 066).
const REMOVE_ADS := 4.99

static func _s() -> Dictionary:
	var d := Progression.data()
	if not d.has("shop"):
		d.shop = {"firstOpen": 0, "giftDay": "", "packsDay": "", "packs": 0, "ladderDay": "", "ladderStep": 0, "ladderAds": 0, "bought": {}}
	var s: Dictionary = d.shop
	var day := Progression.today()
	if s.packsDay != day:
		s.packsDay = day
		s.packs = 0
	if s.ladderDay != day:
		s.ladderDay = day
		s.ladderStep = 0
		s.ladderAds = 0
	return s

## The store opened: the starter offer's clock starts the first time.
static func opened() -> void:
	var s := _s()
	if int(s.firstOpen) == 0:
		s.firstOpen = Progression.now()
		Progression.save()

static func starter_left_s() -> int:
	var s := _s()
	if bool((s.bought as Dictionary).get("starter", false)):
		return 0
	var first := int(s.firstOpen) if int(s.firstOpen) > 0 else Progression.now()
	return maxi(0, first + STARTER_S - Progression.now())

# ----------------------------------------------------------------- deals ---

## Today's, this week's and this month's deal: {deal: [...], left_s}.
static func deal(period: String) -> Dictionary:
	var t := Progression.now()
	var list: Array
	var length: int
	match period:
		"week":
			list = WEEKLY_DEALS
			length = 7 * 86400
		"month":
			list = MONTHLY_DEALS
			length = 30 * 86400
		_:
			list = DAILY_DEALS
			length = 86400
	var index := t / length
	return {"deal": list[index % list.size()], "left_s": (index + 1) * length - t}

## A deal's contents as reward lines.
static func contents_text(contents: Array) -> Array:
	var out: Array = []
	for c: Array in contents:
		out.append(reward_text(c))
	return out

static func reward_text(c: Array) -> String:
	match c[0]:
		"blueprints":
			var car := str(CarsDb.by_id(Garage.goal()).get("name", ""))
			return I18n.t("{n} blueprints for the {car}", {"n": int(c[1]), "car": car}) if car != "" else I18n.t("{n} blueprints", {"n": int(c[1])})
		"passXp":
			return I18n.t("{n} pass XP", {"n": int(c[1])})
	return Progression.reward_text(c)

## Gives one reward ([kind, n]); returns its line (blueprints may unlock the goal car: Garage.unrevealed).
static func grant(c: Array) -> String:
	match c[0]:
		"blueprints":
			var bp := Garage.grant_goal(int(c[1]))
			return MobileHome.blueprint_text(bp) if not bp.is_empty() else ""
		"passXp":
			Progression.add_pass_xp(int(c[1]))
			return reward_text(c)
	Progression.grant(c)
	return reward_text(c)

# -------------------------------------------------------------- free ---

## The free gift of the day: claimable once a day.
static func gift_ready() -> bool:
	return str(_s().giftDay) != Progression.today()

static func claim_gift() -> Array:
	if not gift_ready():
		return []
	_s().giftDay = Progression.today()
	Progression.save()
	return [grant(["credits", 5000])]

static func free_packs_left() -> int:
	return maxi(0, FREE_PACKS_DAY - int(_s().packs))

## One line of the free pack's odds: "6,000-15,000 credits".
static func odds_text(o: Array) -> String:
	var lo: int = o[2]
	var hi: int = o[3]
	match o[1]:
		"credits": return I18n.t("{a}-{b} credits", {"a": StoreScreen.fmt(lo), "b": StoreScreen.fmt(hi)})
		"blueprints": return I18n.t("{a}-{b} blueprints", {"a": lo, "b": hi})
	return I18n.t("{a}-{b} pass XP", {"a": lo, "b": hi})

## A free pack (after its ad): one draw by FREE_PACK_ODDS. Returns its line, or "" with none left today.
static func open_free_pack() -> String:
	if free_packs_left() <= 0:
		return ""
	_s().packs = int(_s().packs) + 1
	var rng := RandomNumberGenerator.new()
	rng.randomize()
	var roll := rng.randi_range(1, 100)
	for o: Array in FREE_PACK_ODDS:
		roll -= int(o[0])
		if roll <= 0:
			var n: int = rng.randi_range(int(o[2]), int(o[3]))
			if o[1] == "credits":
				n = n / 500 * 500
			var line := grant([o[1], n])
			Progression.save()
			return line
	return ""

## The ad ladder's step (0-based; LADDER.size() when done today) and the ads watched on it.
static func ladder_step() -> int:
	return int(_s().ladderStep)

static func ladder_ads() -> int:
	return int(_s().ladderAds)

## One ad watched on the current step: the step's reward line when that completed it, else "".
static func ladder_watched() -> String:
	var s := _s()
	var i := int(s.ladderStep)
	if i >= LADDER.size():
		return ""
	s.ladderAds = int(s.ladderAds) + 1
	var line := ""
	if int(s.ladderAds) >= int(LADDER[i][0]):
		line = grant(LADDER[i][1])
		s.ladderStep = i + 1
		s.ladderAds = 0
	Progression.save()
	return line

## Something to collect in the store (its red dot): the gift, a free pack.
static func has_free() -> bool:
	return gift_ready() or free_packs_left() > 0
