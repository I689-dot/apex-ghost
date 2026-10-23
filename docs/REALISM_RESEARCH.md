# Realism research: Nürburgring GP, GT3 cars, rules and racing games

This pass checked the game against real-world data and against what the established racing games (Assetto Corsa Competizione, iRacing, F1 24, Gran Turismo 7) do. **[Estimate]** marks values with no published source, chosen by reasoning or calibration.

## 1. Reference lap times

| What | Time | Source |
|---|---|---|
| GT World Challenge sprint pole, 2019 (Bortolotti) | 1:54.926 | enduranceandgt.co.uk |
| GT World Challenge sprint pole, 2019 (D. Vanthoor) | 1:54.439 | enduranceandgt.co.uk |
| GTWC Endurance qualifying average (Aston Martin, Comtoyou) | 1:53.591; fastest single lap that weekend 1:53.070 | speedweek.com |
| ACC coaching targets on the GP layout | 1:52.0 pro, 1:55.0 pro-am, 1:57.5 am | traxion.gg |

**Track:** GP-Strecke, 5.148 km, 15 turns (coachdaveacademy.com). The corners in order:

| Turn | Name | Type | Gear |
|---|---|---|---|
| T1 | Castrol-S / Haug-Haken | Downhill right hairpin | 1st |
| T2–T4 | Mercedes Arena | Left, tightening downhill left, right | — |
| T5 | — | Fast downhill left | — |
| T6 | Ford-Kurve | Right | — |
| T7 | Dunlop-Kehre | Right hairpin, downhill in, uphill out | 2nd |
| T8–T9 | Michael Schumacher S | Fast left-right | — |
| T10 | Kumho-Kurve | Left | 3rd |
| T11 | Bit-Kurve | Downhill right | 3rd |
| T12 | — | Flat-out kink | — |
| T13–T14 | Veedol chicane | Left-right, braking between the 100 m and 50 m boards | — |
| T15 | Coca-Cola-Kurve | Slow right | 2nd |

## 2. GT3 cars

**Class:** 1,200–1,300 kg and 500–600 hp, with traction control and ABS as standard. Balance of Performance (BoP) adjusts weight and power per car and event. An example from a 2024 SRO sheet: Acura NSX EVO2 at 1,260 kg + 25 kg ballast (Wikipedia "FIA GT3"; SRO BoP sheets).

**Downforce:**
- The road-going 911 GT3 RS makes 409 kg at 200 km/h and 860 kg at 285 km/h (Porsche / Top Gear).
- No racing-GT3 figure is published. We use about 450 kg at 200 km/h (ClA ≈ 2.3 m²), slightly above the RS. **[Estimate]**

**Drag:** race GT3s with big wings and wide slicks are in the Cd·A ≈ 1.0 m² range. **[Estimate]** We calibrate each car's Cd·A so the simulated top speed equals its spec (`tools/sim/calibrate.ts`).

**Tyres (Pirelli P Zero DHF):**
- Slightly harder than its predecessor, slower to warm up, and sensitive to the low end of its window: cold tyres caused problems on restarts (sportscar365).
- The precise window isn't published. We use 80–100 °C for slicks. **[Estimate]**

## 3. Rules that matter for the game

- **Track limits:** a lap is deleted when the car leaves the track without staying in contact with the white line. In GT World Challenge the stewards reinstate a lap when video shows the car was always in contact with the line. Race-directors' notes may add warnings or drive-throughs (GT World Challenge decisions; Autosport on Spa).
- **Qualifying:** the grid comes from best laps. GTWC Endurance uses each driver's best lap, averaged. Sprint qualifying has short timed segments, and cars may make at most one in-lap. Tyre warmers are not part of the procedure, so the out lap is used to warm the tyres.

## 4. What the reference games do

| Feature | Seen in |
|---|---|
| Best-lap classification, lap invalidation for track limits, out lap | ACC, iRacing, F1 (Time Trial / qualifying) |
| Live delta to personal best on the HUD | F1 games (on by default), ACC, iRacing |
| Dynamic racing line coloured by braking / throttle ("corners only" option) | F1 games, Gran Turismo |
| Tyre temperature affecting grip, cold out laps | ACC, iRacing |
| Penalty and incident systems, safety and driver ratings | iRacing (incident points, SR/iR), GT7 (DR/SR, slowdown penalties), ACC (penalties, rating requirements) |
| Tyre sets, fuel and pit strategy | ACC |

## 5. What we changed

**Bugs found by measuring against reality:**
- **Rapier CCD halved the car's progress at speed.** Continuous collision detection clamped the motion to a predicted impact with the road, so at 200+ km/h the car covered half the distance its velocity said. It is now off; at 120 Hz a car can't tunnel through a wall.
- **The centreline cut the Veedol chicane and some hairpins across the grass.** The widths of one side also bled into the other. The track pipeline now re-centres every point on the asphalt and measures the widths directly. Where a wall is the edge (pit-entry wall at the last corner, pit wall on the straight), the usable width stops 1.2 m short of it. Bridges and gantries are ignored.

**Physics:**
- Slick grip raised so a GT3 corners at ≈1.7 g at 120 km/h and ≈2.0 g at 200 km/h.
- About 35% more downforce.
- Drag calibrated per car: top speeds 272–296 km/h, about 225–250 km/h at the end of the GP straights.
- Braking 200→0 km/h in about 75 m.
- Tyre temperature model.

**Rules:**
- Out lap + 3 timed laps; the best valid lap wins.
- A lap is invalid when all four wheels leave the asphalt and kerbs, the car goes a kerb's width past the edge line, or the car is reset.
- The server owns the classification; clients send an off-track flag with their position samples.

**Driving aids (optional):**
- Racing line: off, braking zones only, or the full lap. It is computed from a minimum-curvature line and a speed profile for your car.
- Live delta to your best valid lap.

**Bots:** they now drive the racing line with a downforce-aware speed profile. With realistic physics, the fastest bots lap in about 2:05–2:13.

**Remaining gap:** the theoretical lap of our physics on our track is about 2:07, against a real pole of 1:54. The main reasons:
- the measured track width stops at the painted edge and the kerbs, while real drivers use the kerbs;
- elevation is not used in the speed estimate;
- the uncertainty in GT3 aero figures.

## 6. The cars one by one (2026-10-23)

**Question:** "some cars heat their tyres way too quickly or don't steer well". Measured with `tools/sim/ailap.ts` (every car, 2 laps at bot skill 0.97, tyre temperatures per axle) and `tools/sim/steerresp.ts`, then checked against the real cars.

**Answer: partly true, and the cause was in the data, not the cars.**
- Three cars had been "balanced" with invented handicaps: the Ferrari 296 Challenge (tyre grip 1.71, a third less downforce than a GT3), the Mercedes-AMG ONE (power capped at 560 kW, grip 1.56) and the BMW M3 Touring (grip 1.77, 30 % less downforce, 110 kg extra). They cornered 13–24 % less on a held key at 250 km/h, and the Ferrari cooked its rears (102 °C average, 112 °C peak against a 90 °C optimum). The real cars are not like that (below).
- On every car the fronts ran ~19 °C colder than the rears (the fronts of the Porsche, Audi and Lamborghinis never reached 80 °C in two laps): the tyre model had no heat from carcass flex or front camber/scrub, and no contact with the track surface.
- The other GT3s were within ~5 % of each other on steering and grip: no hidden bad car among them.
- Temperature changed grip by at most 7 %, so the hot tyres were not what made the three cars feel bad; their low grip was.

**Real data used** (BoP = SRO's 2024 Balance of Performance sheet, race weight without driver):

| Car | Real data | In the game now |
|---|---|---|
| Porsche 911 GT3 R (992) | 4.2 L flat-six NA, up to 565 hp (BoP-limited), revs past 9,000; 6-speed sequential; BoP 1,295 kg | 1,405 kg (+80 kg driver, +30 kg fuel), 387 kW |
| Audi R8 LMS GT3 evo II | 5.2 L V10 NA, up to 585 hp; 6-speed sequential; BoP 1,310 kg | 1,420 kg, 401 kW |
| Lamborghini Huracán GT3 EVO / EVO2 | 5.2 L V10 NA, 1×52 mm restrictor; 6-speed Xtrac; dry 1,230 kg, BoP 1,330 kg | 1,440 kg, 401 kW |
| BMW M4 GT3 EVO | 3.0 L twin-turbo straight-six (P58), up to 590 hp, boost table to 7,500 rpm; 6-speed Xtrac; BoP 1,310 kg | 1,420 kg, 403 kW, limiter 7,500 |
| BMW M3 Touring 24h | The M4 GT3 EVO package in an estate body, 200 mm longer and 32 mm taller; SPX class at the 2024 Nürburgring 24h (not GT3-homologated, no BoP) | M4 GT3 values, slick grip, centre of gravity +2 cm, 1,440 kg [estimate] |
| McLaren 650S GT3 | 3.8 L twin-turbo V8 (M838T), 500 bhp under BoP; 6-speed sequential; 1,240 kg dry | 1,400 kg, 375 kW |
| McLaren 720S GT3 / Evo / LMGT3 Evo | 4.0 L twin-turbo V8 (M840T); 6-speed sequential; the Evo has more downforce, balance forward | 1,410–1,430 kg [not in the sheet: estimate], 391 kW |
| Mercedes-AMG GT3 / EVO | 6.2 L V8 NA (M159), 2×34.5 mm restrictors; 6-speed sequential transaxle; BoP 1,355 kg | 1,465 kg (EVO), 1,430 kg (2015 car, estimate), 374 kW |
| Aston Martin Vantage GT3 Evo | 4.0 L twin-turbo V8 (Mercedes-AMG M177), boost table to 7,250 rpm; 6-speed Xtrac; BoP 1,305 kg | 1,415 kg, 390 kW, turbo curve (it had shared the AMG's NA V8 curve) |
| Ferrari 296 Challenge | 3.0 L twin-turbo 120° V6, 700 cv, 740 Nm; 7-speed F1 dual-clutch; 1,330 kg dry; 870 kg downforce at 250 km/h; carbon-ceramic discs. Ferrari: the 296 GT3, with 100 hp less, laps "a handful of seconds" faster | 1,440 kg, 515 kW, 7 gears, ClA 2.9, carbon brakes; tyre grip 1.68, calibrated so it laps ~2 % slower than the GT3s |
| Mercedes-AMG ONE | 1.6 L V6 turbo (F1-derived) + 4 electric motors, 782 kW (1,063 hp), 4MATIC+ with two 120 kW front motors; 1,695 kg DIN; Michelin Cup 2 R road tyres (285/35 ZR19, 335/30 ZR20); 352 km/h (capped); downforce "about half the weight" (AMG); Nordschleife record 6:29.090 | 1,775 kg, 783 kW, AWD 30 % front, tyre grip 1.72 [road tyre: estimate], ClA 2.6 [estimate], carbon brakes |

- **Downforce:** no GT3 figure is published. The 296 Challenge's published 870 kg at 250 km/h (ClA ≈ 2.9) must sit below a GT3's (the GT3 is faster with less power), and the game's GT3s had 2.3, the road 911 GT3 RS's value. All GT3 downforce was raised ×1.35 (≈ 3.0–3.3) **[estimate]**, and drag recalibrated to each car's top speed (`calibrate.ts`: 0.70–1.11 m²).
- **Power** is now the peak of each torque curve (it was a separate number the physics never used), and turbo vs naturally aspirated is set per engine for the air-density effect.

**Result** (flying laps on the GP, standard air; before → after): GT3 tyres front/rear 72–84 / 90–95 °C → 79–90 / 81–89 °C, peaks ≤ 100 °C; the front-engined AMG, BMW and Aston now run warmer fronts than rears, as front-engined cars do. Ferrari rears 102 → 98 °C (peak 112 → 104); M3 Touring 2:21.4 → 2:15.3 (with the M4 at 2:14.9); AMG ONE 2:23.9 → 2:13.3. All 18 cars: no spins or resets. The Ferrari and the ONE still corner less (1.41–1.42 g against 1.62–1.67 g at 120 km/h): Challenge slicks and road tyres really have less grip than the GT3 slick.

**Temperature** (`temperatures()` in `packages/shared/src/weather.ts`): air from the month's climate at each circuit (monthly average highs/lows, Nürburg and Zandvoort, from published climate tables), the time of day, cloud and rain, and a ±3.5 °C day anomaly from the seed; the track adds up to ~20 °C in full sun on dry asphalt (sunny tracks run ~15–20 °C over the air); air density from altitude (Nürburgring ~620 m, Zandvoort ~5 m) and temperature drives drag, downforce and engine power (naturally aspirated fully, turbo and hybrid by the square root: SRO boost limits are ratios of ambient pressure). In the Ring's air the NA Porsche tops out at 235 km/h against 243 in standard air. Tyres exchange heat with the track: Porsche flying-lap tyres 67/75 °C on a 12/15 °C day, 79/87 on 20/32, 91/99 on 28/48; on the cold day the out lap is 2.7 s slower.

## Sources

- https://enduranceandgt.co.uk/grts-bortolotti-and-wrts-vanthoor-on-pole-at-nurburgring-31-08-19/
- https://www.speedweek.com/en/a/sportscar/comtoyou-racing-secures-aston-martin-pole-position-at-the-nuerburgring
- https://www.ferrari.com/en-QA/competizioni-gt/articles/third-fastest-time-for-ferrari-in-qualifying-at-nurburgring
- https://traxion.gg/watch-nurburgring-gp-assetto-corsa-competizione-track-guide/
- https://coachdaveacademy.com/tutorials/nurburgring-grand-prix-circuit-track-guide/
- https://www.iracing.com/tracks/nurburgring/
- https://en.wikipedia.org/wiki/FIA_GT3
- https://www.gt-world-challenge-asia.com/documents/notice/665/SRO%2BBalance%2Bof%2BPerformance%2BFIA%2BGT3%2Bcars%2B2024%2BCHANG%2B%2B11052024.pdf
- https://www.topgear.com/car-news/supercars/new-porsche-911-gt3-rs-and-its-pretty-much-a-race-car-now
- https://media.porsche.com/mediakit/911-gt3/en/the-new-911-gt3/body-and-aerodynamics
- https://sportscar365.com/?p=105144 (Pirelli DHF)
- https://www.gt-world-challenge-europe.com/documents/notice/9247/282-682995c9f3430159427dfeb6-18-05-2025-08-09.pdf (track-limit decision)
- https://www.autosport.com/gt/news/track-limits-clampdown-issued-for-spa-24-hours-4977925/4977925/
- https://en.wikipedia.org/wiki/GT_World_Challenge_Europe
- https://www.bmw-m.com/en_PM/topics/magazine-article-pool/bmw-m3-m4-brakes.html
- https://simracingsetup.com/?p=9860697 (F1 racing line)
- https://www.sportskeeda.com/gaming-tech/f1-24-settings-need-change-playing (F1 delta)
- https://coachdaveacademy.com/tutorials/how-to-improve-your-dr-sr-in-gt7/
- https://support.iracing.com/support/solutions/articles/31000173709-incident-points
- https://www.overtake.gg/threads/assetto-corsa-competizione-build-7-now-live.166902/
- https://www.gt-world-challenge-asia.com/documents/notice/665/SRO%2BBalance%2Bof%2BPerformance%2BFIA%2BGT3%2Bcars%2B2024%2BCHANG%2B%2B11052024.pdf (2024 BoP: weights, restrictors, boost tables)
- https://racing.porsche.com/en-NZ/cars/911-gt3-r-992
- https://www.stuttcars.com/porsche-911-gt3-r-992-1-2023-2025-specifications-performance/
- https://audi.com/en/sport/motorsport/audi-racing-models/r8-lms-gt3.html
- https://www.press.bmwgroup.com/global/article/detail/T0442652EN/presentation-of-the-bmw-m4-gt3-evo-at-the-nuerburgring:-bmw-m-motorsport-makes-the-successful-model-even-better
- https://www.pistonheads.com/news/ph-germancars/bmw-blows-minds-with-new-gt3-spec-m3-touring/50991
- https://jalopnik.com/2124744/bmw-m3-wagon-race-car-nurburgring-24-hours/
- https://www.motorsportmagazine.com/special-article/race-to-road-ferrari/90/ferrari-296-challenge-how-its-aero-and-electronics-make-690bhp-approachable/
- https://autocar.co.uk/node/132859 (Ferrari 296 Challenge)
- https://www.motor1.com/news/601257/ferrari-296-gt3-race-car-debut/
- https://waynetaylorracing.com/customer/carspecs/gtd (Huracán GT3 EVO2 spec sheet)
- https://www.lamborghini.com/en-en/motorsport/motorsport-models/huracan-gt3-evo2
- https://cars.mclaren.com/en/customer-racing/models/720s-gt3-evo
- https://www.classicdriver.com/en/car/mclaren/650s/2015/751829
- https://sportscar365.com/?p=113415 (AMG GT3 Evo weight)
- https://www.carscoops.com/?p=2938510 (Vantage GT3)
- https://mercedes-amg.com/en/vehicles/amg-one/hypercar.html
- https://en.wikipedia.org/wiki/Mercedes-AMG_One
- https://www.autocarpro.in/news-international/mercedesamg-one-confirmed-as-hypercar-production-name-40820?amp=1 (ONE downforce, "half the weight")
- https://www.automotiveworld.com/news/629-090-min-mercedes-amg-one-breaks-its-own-lap-record-on-the-nurburgring-nordschleife/
- https://simracingsetup.com/assetto-corsa/acc-tyre-pressure-guide/ (DHF window 80–90 °C in ACC: a sim reference)
- https://zh.hotels.com/de361543/hotels-nuerburg-germany/monthTab2 (Nürburg monthly averages)
- https://sg.hotels.com/de929953/zandvoort-netherlands-hotel-rooms/monthTab8 (Zandvoort monthly averages)
- https://www.mercedesamgf1.com/news/insight-temperature-talk (track vs air temperature)
