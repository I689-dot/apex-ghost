# Player retention and engagement-loop design for online racing games (small-population focus, 2023-2026)

Research date: 2026-11-18. About 20 search/fetch calls. Caveat up front: hard, public, racing-specific numbers are scarce. Most studios (Nadeo, Psyonix, Polyphony, iRacing, Studio 397) publish no retention data. Where only vendor blogs or forum anecdotes exist, they are labeled as such. Design recommendations for GridCorsa are under "Inferences" and are not sourced facts.

## 1. Retention benchmarks (D1/D7/D30) for racing games on mobile and PC; what separates top-quartile games

### Takeaway
All-genre medians (GameAnalytics 2026 report, 2025 data) are about 22% / 4% / 0.7% for D1/D7/D30 on mobile, and about 7% / 1.2% / 0.2% on PC. Top-quartile games reach about 30% / 6-7% / 1.6-1.8% on mobile and 12-13% / 3% / 0.8% on PC. The only racing-specific mobile figures found (one vendor blog, unclear method) sit near the all-genre median: about 28/8.5/1.9% on iOS and 20/4/0.7% on Android. No public PC racing or sim benchmark exists.

### Cited Findings
- GameAnalytics 2026 Mobile & PC Benchmarks (2025 data, 16,000+ mobile games with at least 1,000 MAU): mobile (iOS + Android combined) **median D1 ~22%, D7 just under 4%, D30 ~0.68-0.79%**. **Top 25%: D1 just above 30%, D7 6-7%, D30 1.6-1.8%.** Median session 3.1-3.5 min (top 25% ~5.2 min). Sessions per day 3.8-3.9 (top 25% 5.3-5.7). The report states genre-level benchmarks are not available. — [GameAnalytics 2026 benchmarks](https://www.gameanalytics.com/reports/2026-mobile-pc-gaming-benchmarks)
- Same report, PC (3,582 games, no Steam-specific split): **median D1 ~7%, D7 1.1-1.3%, D30 ~0.2-0.25%**. **Top 25%: D1 12-13%, D7 2.7-3.2%, D30 0.7-0.9%.** Median session ~18 min (top 25% just over 30 min). Sessions per day 1.65-1.70 (top 25% just over 2). **DAU/MAU 4-5% median, ~7% top quartile.** — [GameAnalytics 2026 benchmarks](https://www.gameanalytics.com/reports/2026-mobile-pc-gaming-benchmarks)
- Top-quartile mobile D1 by platform: iOS 31-33% versus Android 25-27%. — [GameAnalytics summary via gamedevreports](https://gamedevreports.substack.com/p/gameanalytics-mobile-gaming-benchmarks); [Innovecs summary](https://www.innovecsgames.com/blog/mobile-game-retention-benchmarks/)
- Racing-specific (vendor blog, method and sample not stated, labeled "Q3 2026"): **iOS racing D1 28.32%, D7 8.54%, D30 1.93%; Android racing D1 20.13%, D7 4.02%, D30 0.72%.** Treat as directional only. — [Asohot retention benchmarks](https://www.asohot.com/blog/mobile-game-retention-rate-strategies/)
- GameAnalytics reports that arcade games lead on short-term (D1) retention but have problems with long-term retention. — [GameAnalytics summary via gamedevreports](https://gamedevreports.substack.com/p/gameanalytics-mobile-gaming-benchmarks)
- For comparison, Sensor Tower figures put mid-core games at 44-45% D1, 20-21% D7 and 11-12% D30, a far higher bar than casual or racing. — [Innovecs summary](https://www.innovecsgames.com/blog/mobile-game-retention-benchmarks/)
- Sensor Tower's top-25 casual games had D7 fall to 14.9% in December 2025. The steepest download declines in 2025 were in action, RPG, simulators and racing. — [Sensor Tower State of Gaming 2026 via gamedevreports](https://gamedevreports.substack.com/p/sensor-tower-state-of-gaming-2026)
- Racing on mobile is a shrinking, top-heavy category. In one US iOS Q2 2025 top-5 racing snapshot, active users of a top title fell from 441K to 200K within the quarter while downloads stabilized around 25-33K. — [Sensor Tower Q2 2025 iOS racing](https://sensortower.com/blog/2025-q2-ios-top-5-racing%20games-units-us-62fbc03af5dff393904ee927)
- The largest block of churn happens on install day, not at D7 or D30. — [Playio on onboarding](https://blog.playio.co/mobile-game-onboarding-retention)
- Sim racing scale references for 2025-2026 (to size "small"):
  - Le Mans Ultimate's v1.0 launch (22 Jul 2025) set an all-time Steam peak of 8,463 concurrent players. — [Traxion](https://traxion.gg/le-mans-ultimates-v1-0-release-breaks-player-records/)
  - LMU reached 11,941 concurrent users during its 24h Special Event on 24 Oct 2026. — [BoxThisLap](https://boxthislap.org/le-mans-ultimate-breaks-steam-player-record-during-24h/)
  - An undated LMU snapshot showed 4,636 online, with a 24h peak of 6,131. — [Tracker.gg](https://tracker.gg/population/steam/2399420)
  - iRacing is described as 350,000+ subscribers worldwide (a community-size figure, not verified). It publishes no churn or renewal data. — [BoxThisLap on the 2026 price rise](https://boxthislap.org/has-iracings-2026-price-increase-hurt-the-service/)

### Inferences
- Realistic GridCorsa targets: on Android, aim to beat the racing figures (about 20/4/0.7) and reach the all-genre top quartile (about 30/6-7/1.7). On PC/Steam, D1 above 12% and D7 above 3% would be top quartile. PC sessions run far longer (about 18 min median against about 3 min on mobile), so race lengths and loops should differ by platform: short sprint races and time-trial attempts on mobile, full qualifying + race on PC.
- iOS beats Android by about 5-8 points of D1 in every dataset. GridCorsa ships on Android only (no iOS), so its numbers should be judged against Android figures.
- What separates top-quartile games is not isolated in these reports. The consistent cross-source themes are: more sessions per day (5+ versus about 4 on mobile), a first session that reaches the fun on install day, and recurring reasons to return (see section 2).

### Gaps
- No public D1/D7/D30 benchmark for PC racing or sim racing (Steam). GameAnalytics does not break out genres in 2026.
- No browser/web-game retention benchmark was found.
- The racing mobile numbers come from a single source with no stated methodology.

## 2. Mechanics with evidence: scheduled series, time-trial leaderboards, dailies, streaks, passes, career, licences, collection, ghosts, clubs, leagues

### Takeaway
Every successful racing live game runs a fixed, predictable cadence of fresh, time-limited competition. Examples: Trackmania's daily Track of the Day and Cup of the Day plus five beginner tracks every Sunday; GT7's three Daily Races refreshed every Monday; LMU's several daily ranked races feeding Driver and Safety ratings; Rocket League's soft-reset seasons with cosmetic rank rewards. None of these studios publishes causal retention data. Evidence for login streaks and battle passes is mostly vendor claims with selection bias. Academic work flags that streaks can turn into "daily pests".

### Cited Findings
**Scheduled fixed-time and rotating races**
- GT7 Daily Races update every Monday. Each set usually has three races (A/B/C) and runs for about a week. Rules vary by week: fuel and tyre multipliers, mandatory stops, fixed setups. — [GTPlanet Daily Races](https://www.gtplanet.net/gran-turismo-7-daily-races-20250929/); [GTPlanet](https://www.gtplanet.net/?p=138089)
- GT7 switches DR/SR on or off per race. For example, in Sept 2025 DR updates were off for Race C while SR stayed on. Polyphony also trialled Daily Races that affect neither DR nor SR, a lower-risk option for newcomers. DR/SR set a player's league for the season's esports series. — [GTPlanet 2025-09-22](https://www.gtplanet.net/gran-turismo-7-daily-races-20250922); [GTPlanet](https://www.gtplanet.net/?p=144364)
- GT7 Sport Mode unlocks only after Café Menu Book 9 and needs PlayStation Plus. Online racing is gated behind single-player onboarding. — [racinggames.gg guide](https://racinggames.gg/article/gran-turismo-7-daily-races-a-guide-to-this-week-gt7-races)
- LMU ships native ranked multiplayer: several daily races, plus weekly and special events that build Driver and Safety ranks, with no third-party site or subscription. — [BoxThisLap on LMU's model](https://boxthislap.org/le-mans-ultimate-iracing-business-model/); [Overtake on the RaceControl expansion](https://www.overtake.gg/news/comments/81388/)
- Anecdote: LMU beginner events often draw over 100 entrants, sometimes over 300 (a Steam user, not verified). — [Steam discussion](https://steamcommunity.com/app/2399420/discussions/0/594020645016178995)
- LMU's biggest concurrency spikes came around real-world Le Mans and its in-game 24h Special Event. Tent-pole special events concentrate players. — [Overtake](https://overtake.gg/news/comments/86353); [BoxThisLap](https://boxthislap.org/le-mans-ultimate-breaks-steam-player-record-during-24h/)

**Daily and weekly time-trial leaderboards (Trackmania)**
- Track of the Day: a new community track every day at 19:00 CE(S)T with a fresh records leaderboard and 24 hours to set the best time. — [Trackmania docs: What is TOTD](https://doc.trackmania.com/play/what-is-totd/)
- Cup of the Day is a daily knockout tournament on the TOTD. It later ran three times a day at 8-hour intervals to cover time zones. TOTD and COTD need paid Standard or Club access. — [Trackmania wiki mirror](https://wiki.riteme.site/wiki/TrackMania_Nations_(2020_video_game)); [Trackmania blog, COTD tag](https://blog.trackmania.com/tag/cup-of-the-day)
- Weekly Shorts (post dated 10 Mar 2025): five new tracks every Sunday at 18:00 CET, one per style (Wide, Slow, Puzzle, Fast, LOL), each with an author time of 20 s or less, readable for new players. They are aimed at beginners and players who just found the game, and free on Starter access. Nadeo calls the mode "popular" but gives no figures. — [Trackmania: Weekly Shorts rules](https://blog.trackmania.com/?p=8560); [Weekly Shorts guidelines](https://doc.trackmania.com/create/map-review/weekly-shorts-guidelines/)
- Weekly Shorts leaderboard times and replays stay secret during the week, so players find lines themselves. — [Trackmania wiki mirror](https://wiki.riteme.site/wiki/TrackMania_Nations_(2020_video_game))

**Seasons and ranked rewards (Rocket League)**
- Ranks soft-reset each season. End-of-season rewards are cosmetic (banners, decals, boosts, titles), set by the season rank and earned by winning ranked matches (for example 10 wins at a tier). — [Epic help: Season Rewards](https://www.epicgames.com/help/en-US/rocket-league-c5719357623323/gameplay-c7262179951387/what-are-rocket-league-season-rewards-a5720149751579); [esports.gg S14](https://esports.gg/news/rocket-league/rocket-league-season-14-competitive-rewards)
- Psyonix permanently closed Casual Extra Modes when it added Ranked Extra Modes, explicitly "to keep the player base from splitting too much". This is a deliberate queue-consolidation choice. — [Prima Games](https://primagames.com/gaming/rocket-league-ranks-what-to-know-for-season-3)

**Daily login, streaks, battle passes**
- Daily login rewards appear in 95% of the Korean mobile games studied (arXiv 2025). This is a prevalence finding framed around loss aversion, not a measured retention lift. — [arXiv 2504.10714](https://arxiv.org/pdf/2504.10714)
- "Daily Quests or Daily Pests?" (mixed-methods survey, 178 players): time-based rewards can help retention but cause frustration and fear of losing streaks when players miss days. — [ResearchGate](https://www.researchgate.net/publication/365003534_Daily_Quests_or_Daily_Pests_The_Benefits_and_Pitfalls_of_Engagement_Rewards_in_Games)
- Vendor claim, no study cited: D30/D60 retention of battle-pass holders exceeds non-holders by 40-80%. Holders self-select, so this overstates any causal effect. — [FoxData glossary](https://foxdata.com/en/glossary/battle-pass/)
- Unsourced blog claims of about a 30% retention lift from login bonuses should be discounted. — [Recited KB](https://recited.io/kb/game-monetization-strategies/player-engagement-and-retention/daily-rewards-and-login-bonuses/)

**Asynchronous ghosts and friends' times**
- Real Racing 3's "Time-Shifted Multiplayer" records friends' races, uploads them and has the AI imitate those drivers, so you race "them" without them being online. — [Pocket Gamer](https://www.pocketgamer.com/real-racing-3/real-racing-3s-asynchronous-multiplayer-turns-ghosts-into-ai-competitors)
- In Beach Buggy Racing 2 (Vector Unit), a new personal best uploads your ghost to the leaderboard for friends to race against, and others race your avatar. — [Vector Unit FAQ](https://vector-unit-faq.groovehq.com/help/does-online-multiplayer-have-a-leaderboard)
- Game Developer: leaderboards are "the original and best social feature". Friends leaderboards tied to social networks drive acquisition and retention, but async play has its own critical-mass and inactivity problems. — [Game Developer](https://www.gamedeveloper.com/design/leaderboards-the-original-and-best-social-feature-); [Mobile Free to Play, 3 approaches](https://mobilefreetoplay.com/?p=735)

**Community leagues**
- Low Fuel Motorsport (a free league and ranking platform) reached 200,000 registered users and added RaceRoom in 2025 (company announcement). Third-party ranked platforms thrive where games lack native scheduling. — [Traxion](https://traxion.gg/low-fuel-motorsport-to-add-raceroom-in-2025/)
- SimGrid hosts self-run communities ranging from a few hundred to several thousand followers. — [SimGrid community listing](https://www.thesimgrid.com/drivers/6198/communities)

### Inferences
- The mechanics with the strongest structural support for GridCorsa map onto what it has or plans:
  1. A rotating weekly time-trial (one circuit and car per week, global and friends leaderboards, an optimal-lap delta, downloadable ghosts). This is Trackmania's TOTD/Weekly Shorts model and GT7's weekly rotation, and it needs zero concurrency.
  2. A fixed schedule of official online races at set times (see section 3).
  3. Seasons, for example 8-12 weeks, with a soft DR reset and cosmetic rewards (liveries, rims, number plates fit the planned customisation).
  4. Licences/SR as visible progression with a no-stakes newcomer lane (as GT7 trialled).
- With three circuits, a weekly rotation repeats every three weeks. Variety must come from car-and-track combos, reverse layouts, weather and time of day, and rule twists (GT7 uses fuel and tyre multipliers and fixed setups).
- Login streaks and passes: use sparingly. A soft weekly-goal track (for example "complete 3 races this week") with no punishing streak break fits the "Daily Pests" findings better than daily-login chains. Since coins are real money (per backlog), it must stay compliant and non-predatory.

### Gaps
- No studio publishes the retention effect of TOTD/COTD, GT7 Daily Races, LMU ranked or Rocket League seasons.
- No controlled study of login-streak or battle-pass effects in racing games was found.
- No data was found on car or cosmetic collection as a retention driver in racing.
- No data was found on clubs/teams features (for example GT7 or Forza clubs).

## 3. Solving low player counts: async competition, human-like bots, scheduled times, crossplay, small-pool skill matchmaking, community leagues

### Takeaway
For a game this size, the main levers are, in order:
1. Make the core competitive loop asynchronous (leaderboards and ghosts never need a lobby).
2. Concentrate live play into a few fixed race slots per day (GT7 Daily Races, LMU ranked, COTD 3x/day for time zones).
3. Keep one pool: no fragmenting queues (Rocket League closed casual extra modes), with crossplay across PC/Android/browser.
4. Backfill with bots so a race always starts on time.

Evidence is qualitative. No reliable dataset quantifies the crossplay or bot-fill effect for indies.

### Cited Findings
- Fragmented pools mean longer waits and worse matches. Game Developer's Scavengers piece: "smaller, segmented pools of players also result in longer wait times and poorer matchmaking." — [Game Developer: Scavengers cross-play](https://www.gamedeveloper.com/game-platforms/how-i-scavengers-i-is-launching-across-multiple-platforms-and-stores-with-cross-play)
- Unreal tech blog (Hyper Jam, 2019): for a small game, crossplay "could be the difference between someone finding a match or leaving in disappointment." — [Unreal Engine blog](https://www.unrealengine.com/tech-blog/how-indie-developer-bit-dragon-tackled-cross-platform-play-in-hyper-jam?lang=fr)
- Aggregator figures (+42.5% D30 retention from crossplay, 58% shorter waits) cite no traceable primary source. Do not use. — [voxbooster (unverified)](https://voxbooster.com/blog/crossplay-gaming-statistics-2026)
- Bot backfill failure modes in a AAA game (Battlefield 6 player reports): bots fail to fill small modes in low-population regions, bots get kicked as humans join so rounds never start, or the game starts on a timeout. Backfill logic must guarantee the start. — [EA Forums](https://forums.ea.com/idea/battlefield-6-bug-reports-en/matchmaking-not-filling-small-modes-with-ai-to-start-the-round-bot-quota-issue/12808994)
- Indie players directly ask for bots when concurrency cannot fill a server. For example, a Gunfire Reborn commenter: "added bots and that was really good because I can never find a multiplayer match." — [Steam: Ace Squared](https://steamcommunity.com/app/3151710/discussions/0/4635988976587613313)
- Real Racing 3 turns friends' recorded races into AI opponents that drive like them, a hybrid of ghosts and bots. — [Pocket Gamer](https://www.pocketgamer.co.uk/articles/048276/r/)
- Scheduled cadence concentrates players: GT7's weekly Daily Races, COTD moved to 3x daily at 8-hour intervals, LMU's daily ranked slots, and special events that set concurrency records (LMU 24h: 11,941 CCU). — [GTPlanet](https://www.gtplanet.net/?p=138089); [Trackmania wiki mirror](https://wiki.riteme.site/wiki/TrackMania_Nations_(2020_video_game)); [BoxThisLap](https://boxthislap.org/le-mans-ultimate-breaks-steam-player-record-during-24h/)
- Racing against same-region competitors and people you have raced before affects whether iRacing drivers rage-quit (University of Hawaiʻi study, 19,000+ races, 16,000+ drivers, 2018 data). Regional and familiar-face matching matters socially. — [ScholarSpace: "Too Legit to Rage Quit"](https://scholarspace.manoa.hawaii.edu/items/996a0d84-fc62-49cf-ad9c-68ba77da5c16)
- Third-party league and ranking platforms (LFM, 200k users; SimGrid) fill the gap where games lack native organised racing. — [Traxion](https://traxion.gg/low-fuel-motorsport-to-add-raceroom-in-2025/)

### Inferences
- With GridCorsa's likely concurrency (tens, not thousands), skill-split matchmaking will mostly produce empty or bot-heavy races. Better: one shared official race per slot with all skill levels, split only when the entry list is big enough (iRacing-style splits). Show DR/SR so mixed grids still mean something, start fast drivers at the back or use reverse-grid heats, and fill the rest with bots tuned to the median human pace.
- Publish a small, fixed schedule (for example 3-4 official race times a day aimed at EU evening, US evening and Asia), with a visible countdown and "X drivers registered" in the menu. Better still, allow pre-registration and push notifications on Android. A visible registered count is social proof and lets players coordinate.
- Bots should be labeled (honesty), but should have human-like names, liveries, varied pace and occasional small mistakes. Real Racing 3's "AI that imitates a real player's recorded laps" is a strong idea for GridCorsa: replace bots with ghost-driven AI built from real players' recorded laps on that circuit.
- Treat the weekly time-trial leaderboard as the main competitive product and live races as the event layer on top. Async always works at any population.
- Crossplay across PC, Android and browser in one pool is mandatory at this size. Use input-based fairness (show device and assist icons) rather than separate pools.
- Discord: a GridCorsa Discord with automatic race-result and leaderboard posts (a webhook) plus "league hosting" via private rooms with fixed schedules lets the community run leagues at no live-ops cost.

### Gaps
- No reliable quantitative data on how much crossplay grows indie retention or shortens queues.
- No developer postmortem on bot backfill in a small racing game was found.
- Real player-count figures for LMU daily-race splits or GT7 Daily Race entry numbers are not public.

## 4. Onboarding and the first session: time-to-first-race, assists, device detection, difficulty curve, sign-in friction, tutorial design

### Takeaway
Industry consensus says the first session decides most churn (install day is the biggest drop). The guidance is: get the player driving within minutes (Forza Horizon puts players at the wheel about 3 minutes after Start and shows the whole loop within about 15 minutes), defer account creation until a moment of value, and measure every step of the funnel. No rigorous public racing-specific FTUE numbers or forced-login A/B results were found. The case against a sign-in wall rests on practitioner and vendor guidance and e-commerce data.

### Cited Findings
- Forza Horizon 3 (2016): a reviewer was behind the wheel about 3 minutes after pressing Start. — [Business Insider NL](https://www.businessinsider.nl/forza-horizon-3-opening-2016-9)
- Forza Horizon 5 (2021) opens with a scripted multi-car "Initial Drive" that samples every discipline. Within about 15 minutes, a few short races give the player most of the picture of the game. The intro reportedly took six months to make. — [Car Throttle](https://www.carthrottle.com/news/first-8-minutes-forza-horizon-5-gameplay-pleasingly-ott-thrill-ride); [GamesRadar](https://www.gamesradar.com/why-the-stunning-forza-horizon-5-intro-sequence-took-six-months-to-create)
- Forza Horizon 6 lets players replay the prologue for the first time in the series. — [OpenCritic news](https://opencritic.com/news/31352/heads-up-you-can-replay-the-initial-drive-in-forza-horizon-6)
- GT7 gates online Sport Mode behind single-player progress (Café Menu Book 9), so new players reach ranked racing only after learning the basics offline. — [racinggames.gg](https://racinggames.gg/article/gran-turismo-7-daily-races-a-guide-to-this-week-gt7-races)
- The biggest churn block is on install day. Measure step-level drop-off (for example "12% leave at step three" tells you more than "70% complete"). — [Playio](https://blog.playio.co/mobile-game-onboarding-retention)
- Prioritise fixing steps by absolute players lost (reach at step × drop rate), not by the highest drop rate. — [Bugnet: tutorial drop-off](https://bugnet.io/blog/how-to-measure-and-reduce-tutorial-drop-off)
- Treat a slightly larger drop after tutorial step 1 as normal and a big drop at a later step as the real problem. — [Unity: onboarding standard events](https://blog.unity.com/technology/standard-events-explained-part-1-onboarding)
- Forced login walls hurt conversion, worst on mobile where typing is error-prone. — [Corbado: login friction](https://www.corbado.com/blog/login-friction-kills-conversion)
- F2P mobile games are most exposed to pre-play forms. Guest start with deferred account linking is the pattern (for example Persona 5: The Phantom X). — [Descope: gaming auth](https://www.descope.com/blog/post/gaming-auth)
- Backend guidance: create a guest account silently, keep progress persistent, prompt the upgrade at value moments (purchase, social play, device switch), and link rather than reset. — [Supercraft: guest login and account upgrade](https://supercraft.host/wiki/game-server-backend/guest_login_and_account_upgrade)
- "Do not ask players to register before they understand the game" (HTML5/web game developer). — [Enclave Games](https://enclavegames.com/p/ask-players-register.html)
- The often-quoted 19% checkout abandonment from forced account creation is Baymard e-commerce data, not games. — [This Is Glance, citing Baymard](https://thisisglance.com/learning-centre/should-my-app-require-sign-up-before-users-can-explore-features)
- Sim racing's learning curve makes many beginners quit before the rewarding part. — [Operation Sports](https://www.operationsports.com/why-sim-racing-is-so-tough-for-beginners-and-why-people-often-quit/)

### Inferences
- **Conflict with the current GridCorsa design:** sign-in is required before the menu. All the evidence found points the other way, especially on Android and in the browser where the user has not yet chosen the game. A low-risk path is one-tap guest or device sign-in (silently created, upgradable via Google, Apple or email at the first value moment: first coins earned, joining an online room, adding a friend, buying), so the "signed in" rule is technically kept. This is a product decision for the user, and the numbers to settle it would come from GridCorsa's own funnel (install → sign-in screen → signed in → first lap).
- Target first-session shape:
  1. Under 60-90 s from launch to driving on mobile and browser (Forza's about 3 minutes is the console bar).
  2. Detect the input device (touch, pad, wheel, keyboard) automatically and pick matching default assists (racing line, braking assist, auto gears, traction control on).
  3. A 2-3 lap "hot lap / chase the ghost" with a ghost to beat.
  4. Then a short race against bots set to lose narrowly.
  5. Then a reward (coins plus a cosmetic) and "you can now race online".

  Offer ranked online racing only after a short licence test (GT7 and iRacing gate this way). That protects newcomers and veterans from each other.
- Instrument now: funnel events for app open, sign-in shown, sign-in done, first lap started, first lap completed, first race completed, first online race, D1 return.

### Gaps
- No public racing-game FTUE funnel data (time-to-first-race against D1).
- No game-specific A/B result quantifying the D1 loss from a forced sign-in wall. Only vendor and practitioner guidance and e-commerce data exist.
- No public data on assist defaults or input-device auto-detection and retention.

## 5. Social retention: friends, invites, clans, spectating, replay and clip sharing, creator tools (livery sharing)

### Takeaway
Social ties measurably affect whether sim racers stay (the iRacing rage-quit study). Friends leaderboards and friend ghosts are the cheapest social feature with retention support. Creator sharing (GT7 Showcase, Forza livery sharing) is widely used, but no retention figures were found.

### Cited Findings
- iRacing data (2018, 19k races and 16k drivers): prior experience with competitors, racing with same-region drivers, and the presence of other rage-quitters all influence quitting. Social context changes persistence. — [ScholarSpace](https://scholarspace.manoa.hawaii.edu/items/996a0d84-fc62-49cf-ad9c-68ba77da5c16)
- Friends leaderboards with social networks are effective for acquisition and retention. — [Game Developer](https://www.gamedeveloper.com/design/leaderboards---the-original-and-best-social-feature-)
- Ghost racing against Game Center friends is described as "the real fun" (Ghost Racer). Its success depends on "getting people you actually know to play against you" (Top Bot review). — [148Apps: Ghost Racer](https://www.148apps.com/news/ghost-racer-review); [Kotaku](https://kotaku.com/this-robot-racer-will-make-you-love-to-race-and-hate-5983864)
- Real Racing 3 reviewer: "you'll find yourself replaying races over and over again just to leave your friends in the dust." — [Gamezebo](https://www.gamezebo.com/reviews/real-racing-3-review/)
- Social features in mobile games overview (social mechanics as retention drivers). — [4enjoy](https://4enjoy.com/articles/on-social-features-in-mobile-games)

### Inferences
- GridCorsa already has friends and referrals. Highest value for the effort:
  1. A friends tab on every leaderboard, with "X beat your time at Spa" notifications as the strongest return trigger, and one-tap "race their ghost".
  2. Shareable replay clips or a lap card image ("1:58.3 at Spa, P4 this week") for socials and Discord.
  3. Setup sharing (planned) and livery or number sharing attached to a leaderboard entry ("use the leader's setup").
  4. Private rooms with a shareable invite link that opens the browser version, which removes friction for a friend who has nothing installed.
- Clubs/teams can wait until the player base is bigger. With small numbers they fragment the community. A single official Discord does that job.

### Gaps
- No public retention data for GT7 Showcase, Forza livery sharing, spectating, or clip sharing.
- No data on clubs/teams in racing games.

## 6. Churn causes in sim racing (contact, ranking frustration, grind, hardware) and fixes

### Takeaway
The recurring churn drivers are being wrecked or unfairly penalised, fear of losing Safety Rating, toxic veterans calling beginners "wreckers", and the steep learning curve. Evidence is mostly forum and editorial, plus one academic dataset. Fixes in shipping games: rating-free or SR-only races (GT7 trial), newcomer-protected lanes, and better penalty and reporting systems.

### Cited Findings
- Veterans calling new players "wreckers" creates a toxic environment that drives many away, and newcomers often quit before the rewarding stage. — [Operation Sports](https://www.operationsports.com/why-sim-racing-is-so-tough-for-beginners-and-why-people-often-quit/)
- LMU players: online racing feels "frustrating and unjust". Drivers who are hit sometimes get penalised themselves. — [Steam LMU thread](https://steamcommunity.com/app/2399420/discussions/0/594032586879410936/)
- iRacing's reporting system is criticised as ineffective, causing growing frustration (secondary article, not readable due to bot wall; from search snippet). — [BoxThisLap](https://boxthislap.org/iracing-the-main-reason-why-users-are-quitting-the-simulator/)
- Fear of losing safety rating makes drivers play it safe (iRacing). In ACC, "the fear of losing rating takes the fun out of racing." — [Steam iRacing](https://steamcommunity.com/app/266410/discussions/0/1752394498612235416); [Steam ACC](https://steamcommunity.com/app/805550/discussions/0/4339861336967383891)
- GT7 runs Daily Races with DR and/or SR switched off, and trialled fully rating-free races to lower stakes for newcomers. — [GTPlanet](https://www.gtplanet.net/gran-turismo-7-daily-races-20250922)
- Rage-quitting is contagious: the presence of other rage-quitters raises a driver's own odds of quitting (iRacing study, 2018 data). — [ScholarSpace](https://scholarspace.manoa.hawaii.edu/items/996a0d84-fc62-49cf-ad9c-68ba77da5c16)
- Cost and hardware barriers: iRacing raised prices on 18 Aug 2026 (12-month renewal was $110 before the rise, discounted to $82.50 at the 2025 Black Friday). Content costs are a known barrier, and a planned career mode was meant to let new members progress without buying content. — [BoxThisLap](https://boxthislap.org/iracing-subscription-price-increase-august-2026-how-to-lock-in-current-rates/); [BoxThisLap](https://boxthislap.org/has-iracings-2026-price-increase-hurt-the-service/)

### Inferences
- GridCorsa fixes, by priority:
  1. Automatic contact attribution, so the car that was hit does not lose SR and the ghosting or collision-off window on first-lap carnage is generous.
  2. A newcomer lane: Rookie licence races against bots and rookies only, with SR at stake but DR off.
  3. A visible "no-stakes" race option (as GT7 did).
  4. Easy reporting with clip capture once replays exist.
  5. SR penalties that scale with incident severity and fade, so one bad race is not fatal.
- Grind risk: if coins are real money and cars are unlocked with coins, keep competitive cars free or spec (GT3 BoP), so paying cannot buy pace. Pay-to-win perception is a classic churn driver (no source found here, so this is an inference).
- Hardware hassle is GridCorsa's advantage: the browser and Android versions with good touch and pad defaults are the "no wheel needed" entry point. Wheel auto-detection and presets matter for PC.

### Gaps
- No large-scale 2023-2026 survey quantifying why sim racers quit.
- No published numbers on how SR/penalty system changes affected retention in any sim.

## 7. Live-ops cadence realistic for a tiny team (weekly events, monthly content)

### Takeaway
The reference cadences are: Trackmania with daily TOTD (community-made, curated) and weekly Shorts (community-made under published rules); GT7 with a weekly three-race rotation that mostly changes rules and car/track combos rather than adding assets; LMU with daily ranked slots plus occasional big special events; Rocket League with multi-month seasons. The cheapest of these, rotating existing content by schedule and rules, is what a solo developer can sustain.

### Cited Findings
- GT7: three Daily Races refreshed weekly on Monday across the game's whole life to date, varying car class, track and rules (tyre and fuel multipliers, fixed setups, rating toggles). — [GTPlanet](https://www.gtplanet.net/?p=138089); [racinggames.gg](https://racinggames.gg/article/gran-turismo-7-daily-races-a-guide-to-this-week-gt7-races)
- Trackmania outsources content creation to the community with published guidelines (Weekly Shorts: 5 tracks a week, each 20 s or under, fixed style order), keeping the daily/weekly cadence affordable. — [Trackmania: Weekly Shorts rules](https://blog.trackmania.com/?p=8560)
- LMU: daily ranked races plus weekly and special events. Records cluster around tent-pole special events (24h). — [BoxThisLap](https://boxthislap.org/le-mans-ultimate-iracing-business-model/); [BoxThisLap](https://boxthislap.org/le-mans-ultimate-breaks-steam-player-record-during-24h/)
- Rocket League: seasons with soft rank resets and cosmetic end-of-season rewards. — [Epic help](https://www.epicgames.com/help/en-US/rocket-league-c5719357623323/gameplay-c7262179951387/what-are-rocket-league-season-rewards-a5720149751579)

### Inferences
- A cadence a solo developer can sustain, almost all data-driven and automatable on the server:
  - **Daily:** 3-4 official race slots, same format all week, auto-generated with bot fill.
  - **Weekly (Monday):** new time-trial combo (track, car, conditions), new official-race format (rules twist), reset weekly leaderboard, small cosmetic reward for top X% or a participation goal.
  - **Monthly:** one special event (endurance, night or rain race, reverse layout, one-make cup) and a balance or patch note.
  - **Season (about 8-12 weeks):** DR soft reset, season cosmetic rewards (livery, number, rims), championship standings. A new circuit or car aligned to a season start when one is ready.
- Write the schedule as data (a JSON calendar on the server) a month or more ahead, so live ops is a config push, not a release.

### Gaps
- No published staffing or cost figures for running these cadences.
- No evidence comparing weekly against biweekly rotation on retention.
