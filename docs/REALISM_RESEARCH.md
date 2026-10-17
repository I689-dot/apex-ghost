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
