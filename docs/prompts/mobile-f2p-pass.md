# Mobile free-to-play pass (2026-11-24)

The user studied 102 phone screenshots of five racing games (`RESOURCES/UI-MOBILE-REFERENCE/Screenshot_20261124-*`,
numbered 001-102 in the order taken: Asphalt 8 001-036, Race Max Pro 037-086, Asphalt Legends 087-096, Monoposto
097-101, a Need for Speed loading screen 102) and asked for every change I recommended. Layouts and ideas only: no
names, logos or art of those games, and the game stays brand-free (memory: brand-free-customisation).

Godot app only (`godot/`), the phone layout (`MobileHome`, `MobileModes`, `MobilePass`, `MobileAds`, `MobileUI`,
`Progression`). The PC menu is not changed unless a step says so.

## Decisions (the user's, 2026-11-24)

- **A. Performance upgrades**: in the single-player career only. Online races and quick races stay equal cars.
- **B. Blueprints**: a way to unlock a car beside its fixed credit price.
- **C. Random packs** (my call, as asked): never sold for money. Free packs (an ad, the daily login, the pass) may be
  random and show their odds; packs sold for money have fixed, listed contents.
- **D. No fuel / energy** limit on racing.
- **E. VIP subscription**: yes (a monthly price, a free trial, perks that do not sell race results).
- **F. Look** (my call): keep the dark crimson identity; adopt the genre's conventions: green = buy / pay, yellow = the
  screen's main action, a red dot on anything waiting, a timer on anything that ends.
- **G. Providers** (my call, "easiest, least commission"): AdMob for ads (a Godot Android plugin) and Google Play
  Billing for purchases (15 % service fee for most developers; the alternatives save 3-4 points for much more work).
  Accounts, ad units and products are created only with the user's OK, each time; until then the placeholders stay.

My own calls on the way (say so in the reply when one lands):
- Car ownership applies to the phone layout's own pickers (career, quick race, the home). Online rooms and the PC menu
  keep every car (fair online racing, web players in shared rooms). Two starter cars are owned from the start; a
  player who had the old free garage keeps the car they last drove too.
- Each car gets a rating (PR, from its power, weight and grip) and a rarity by its place in the line-up.

## The list (numbers as in the proposal; status: todo / done <commit>)

Home and navigation
- [~] 1 (red dots on Shop, Cars, Daily, the store's categories; more as screens land) Red dots on every button with something to claim.
- [ ] 2 One column of live events with countdowns (pass, featured event, offer, new season).
- [~] 3 (Events and Online racing locked until the first trophy / race; the home's bar has Daily) Bottom tabs (Career / Pass / Events / Daily / Online), locked ones shown with a padlock until reached.
- [x] 5 (phase 3) Profile page: name, flag, level, most-driven car, badges, stats by discipline, copy player ID.

Cars
- [x] 6 (1a332fd) Car picker: rating bands down the left, search, stat bars with numbers.
- [x] 7 (1a332fd) Rarity and star level on every car card.
- [x] 8 (1a332fd) Full-screen "new car unlocked" reveal.
- [x] B (1a332fd) Blueprints: a car unlocks with N blueprints or its credit price.
- [x] A (phase 4) Upgrades (engine, gearbox, turbo, weight, tyres; stages) used in the career only.

Customisation
- [ ] 9 Paint as a bottom bar of categories (body, decal, rims, smoke, spoiler, window tint, plate), price and preview.
- [ ] 10 Some paints unlocked by challenges.

Career
- [x] 12 (phase 4) Chapters with a rival boss; boss wins open the next modes.
- [x] 13 (phase 4: the trophies shown as stars with named objectives; the third a win or a clean podium) Three star objectives per race (finish / time / clean); stars open the next season.
- [x] 15 (phase 4) Recommended car rating on every event.

Race HUD
- [x] 16 (phase 5; to check in a real race on the phone) Objective panel and a rival marker with the distance.
- [x] 17 (phase 5: overtake 250, clean lap 300, slipstream 100) Callouts that pay: clean lap, overtake, slipstream, clean race.

After the race
- [x] 18 (phase 5) Results: each driver's card (car, rarity, gap), then the rewards by category.
- [x] 19 (phase 5) A big "×2 earnings · watch ad / miss out" card.
- [x] 20 (phase 5: the pass bar; the goals advanced listed) Pass and goal progress on the results.

Ads
- [~] 21 (upgrade stages by ad, 2 a day; paint by ad still to do) "Watch ad" as an alternative price (paint, items), daily limit.
- [x] 22 (store, phase 2) Ad ladder (1, 2, 3 ads for bigger packs).
- [x] 23 (store, phase 2) Free pack / free reward by ad in the store's Free tab.
- [ ] 24 Try a locked car for one race by ad.
- [~] 25 (the Remove ads offer is in the store; interstitials already only between races) Interstitials only between races, never before one; paid "Remove ads".

Shop
- [x] 27 (store, phase 2) Store with categories down the left (For you / Deals / Cars / Coins / Cosmetics / VIP / Free).
- [x] 28 (store, phase 2) Coin packs tagged "+25 %", "Most popular", "Best value".
- [x] 29 (store, phase 2) Cheap starter offer with a timer, the first days.
- [x] 30 (store, phase 2) Rotating daily / weekly / monthly deals with a refresh timer.
- [~] 31 ("Costs real money" done in the store; Restore purchases / Delete my data in Settings still to do) "Costs real money" on paid items; Restore purchases and Delete my data in Settings.
- [x] E (store, phase 2) VIP subscription page.

Retention and social
- [x] 32 (phase 3) 7-day login calendar, big reward on day 7.
- [x] 33 (phase 3) Daily goals (5) and weekly goals, towards a car's blueprints.
- [ ] 35 Friends: add by player ID, share an invite.
- [ ] 37 "What's new" tab.
- [ ] 38 Notification permission asked after a good moment (only once notifications exist).

First launch
- [ ] 39 Choose controls on first launch with pictures.
- [ ] 40 A first race straight away, with a skip.
- [ ] 41 Tips and quotes on loading screens.
- [ ] 42 Small install, circuits and cars downloaded after (Play Asset Delivery: Play's base download limit).

## Order

1. Economy core: car ownership, rating, rarity, blueprints, the car picker and the reveal (6, 7, 8, B).
2. Store rebuilt with categories, packs, offers, deals, free tab, VIP page as previews (27-31, E, 23, 29, 30).
3. Daily: login calendar, daily and weekly goals, red dots, home's events column and tabs, profile (1, 2, 3, 5, 32, 33).
4. Career: chapters, bosses, stars, recommended rating; upgrades in the career (12, 13, 15, A).
5. Race: objective and rival marker, callouts; results and ×2 card (16, 17, 18, 19, 20).
6. Ads placements: alternative price, ladder, try a car, remove ads (21, 22, 24, 25).
7. Paint bar and challenge paints (9, 10).
8. First launch: controls, first race, loading tips; what's new, friends by ID (39, 40, 41, 37, 35).
9. Providers (with the user's OK): AdMob, Play Billing, notifications (G, 38).
10. Play Asset Delivery (42).

Each step: compile 0 failed, check.sh PASS, mobile_shots (rendered, APEX_SCREEN=1), on the phone when connected, its
own commit. Update the list above as steps land.
