# Keyboard controls research (steering, throttle, brake, handbrake)

Summary of a research pass over developer sources: open-source game code (Assetto Corsa "Advanced Gamepad Assist", BeamNG Advanced Steering, BeamNG `input.lua`, TORCS, VDrift, UE4 PhysX vehicle, Unity's InputManager), official manuals (Live for Speed, rFactor 2 Controller.JSON, GT7, Edy's Vehicle Physics) and community settings. **[Inference]** marks reasoning rather than a sourced fact. Full source list at the end. This file drives the input code in `apps/client/src/physics/input.ts` and `vehicle.ts`.

## What was wrong with our keyboard controls

1. **Full lock on a key press.**
   - The "no help" keyboard mode feels twitchy. Live for Speed's manual calls it "definitely not recommended".
   - Two separate problems:
     - **Rate.** Steering goes in as a step input.
     - **Range.** Full lock at speed is far past the tyre's peak slip angle: understeer first, then a snap when the car rotates. "There's always an optimal amount of steering (or rather an optimal slip angle) that results in the highest grip … steering too much can make you turn less" (AGA).
2. **Handbrake spins the car.**
   - Full rear-locking torque applied instantly drives the rear tyres to pure longitudinal slip. Through the friction ellipse, rear lateral grip collapses.
   - GT3 regulations (FIA App. J 257A) have no handbrake requirement, and the cars don't appear to have a driver-usable one.

## Best practices

1. **Keys set a target; an asymmetric rate limiter produces the output.** Three rates: *out* (key held), *return* (released, faster) and *reverse* (opposite key while on the other side of zero, fastest). All filtering runs in the fixed physics step with `rate·dt`. Every engine studied does this (UE4, Unity, BeamNG, VDrift, AC, LFS, rF2).
2. **±1 means "front tyres at ~95% of peak slip angle", not full mechanical lock.** Compute the limit as target front slip + front-axle velocity angle, so it follows the car's motion. Seen in:
   - LFS "Keyboard – stabilised";
   - Edy's ESP;
   - BeamNG's understeer reduction assistant;
   - AGA's `calcCorrectedSteering`.
3. **When counter-steering, the limit expands** to |rear-axle slip| plus a margin, so slides can always be caught (rF2's "opposite lock" help).
4. **A small self-steer (caster / force-feedback emulation)** turns the wheels toward the direction of travel, with yaw damping. It is capped at ~8° and blended out by player input (LFS stabilised, AGA, BeamNG Advanced Steering, GT7 countersteer assist).
5. **Pedals:** ramp in about 0.2 s and release about twice as fast. ABS and TC on by default, since GT3 cars carry both.
6. **Handbrake:** off by default for GT3. If enabled, it ramps (2–3/s), stays below the rear-lock torque (~700 N·m per wheel), and fades with speed (to ~25% above 100 km/h).
7. **Never filter per render frame or in key event handlers.** Clear keys on `blur` and `visibilitychange`, and ignore auto-repeat.

## Reference values found

| Source | Steer out | Return | Opposite key |
|---|---|---|---|
| UE4 PhysX vehicle defaults | 2.5/s | 5/s | fall rate until 0 |
| Unity default "Horizontal" | 3/s | 3/s | snaps to 0 |
| BeamNG stock keyboard | 1.6/s (−70% at 1 g) | 2.2/s | ×1.5–1.8, +70% at 1 g |
| VDrift (button_ramp 5) | 1.5/s | 6/s | rate-limited |
| AGA (AC mod) | ≈6/s + 0.15 s lag | ×1.5 | ×1.5 |
| AC user settings | 1.15–2.5 | 1.0–1.8 | 2.5–4.0 |
| LFS manual | steer rate | 50–75% of steer rate | — |

Pedals:
- UE4: 6 up / 10 down per s.
- BeamNG: 3/s up, instant release.
- AGA: ≈10/s.

Handbrake rates:
- BeamNG: 10/s.
- UE4: 12/s.

## Chosen defaults (implemented)

| Parameter | Value | Range in sources |
|---|---|---|
| Steer out rate (of dynamic limit) | 4.0 /s | 2.5–6 |
| Return rate | 5.5 /s | 0.6–2× out |
| Reverse rate (until zero) | 8 /s | 1.5–2.5× out |
| Second-stage low-pass τ | 40 ms | 20–150 ms |
| Gamma on the ramped value (taps = fine corrections) | 1.5 | 1.0–2.0 |
| Target front slip | 0.95 × α_peak | 0.90–1.0 |
| Max limit reduction while oversteering | 0.55 × α_T | 0.4–0.75 |
| Counter-steer margin over \|β_rear\| | 0.2 × α_T | 0.1–0.35 |
| Limit smoothing | 10 /s | 6–15 |
| Assist fade-in | 2→6 m/s (× wheelbase/2.5) | — |
| Self-steer cap / response / damping | 8° / 0.35 / 0.35 | 3–15° / 0.2–0.5 |
| Throttle and brake up / down | 5 / 10 per s | 3–10 / 8–instant |
| Handbrake | off for GT3 by default; if on: 2.5 up / 10 down, 700 N·m per rear wheel, 25% above 100 km/h | — |

For our normalised Pacejka-style curve, the peak slip angle is known exactly (`alphaPeak` in `tire.ts`), so the limit needs no online estimation. AGA has to learn α_peak in Assetto Corsa.

## Common pitfalls

- **Full lock at speed:** understeer, then a snap.
- **Steering rate too slow:** slides can't be caught. Give the reverse direction its own faster rate.
- **Rate too fast or unfiltered:** twitchy taps.
- **Frame-rate dependent filters:** TORCS limits pedal rise per frame. Always use `rate·dt` and `1 − exp(−dt/τ)`.
- **A limit computed from instantaneous slip oscillates:** smooth it.
- **Low speed and reverse:** fade the limit in from 2–6 m/s and switch it off in reverse.
- **Self-steer fighting the player:** blend it out by |input| and damp it with yaw rate.
- **Over-assisting:** rF2's highest help "steers itself on rails". Shape the steering angle only; never inject yaw torque.

## Sources

- AC Advanced Gamepad Assist (README, ConfigGuide, `assist.lua`, `CarPerformanceData.lua`, `AGALib.lua`): https://github.com/adam10603/AC-Advanced-Gamepad-Assist
- BeamNG Advanced Steering (source, presets, Explanation.md): https://github.com/adam10603/BeamNG-Advanced-Steering
- BeamNG `input.lua` (public gist): https://gist.github.com/GettingWhiter/38d585e1517e38845053f199f47493be
- Unity default InputManager.asset: https://github.com/Unity-Technologies/ml-agents/blob/develop/Project/ProjectSettings/InputManager.asset ; manual: https://docs.unity3d.com/ja/2021.2/Manual/class-InputManager.html
- UE4 PhysX `WheeledVehicleMovementComponent` (4.18 mirror): https://github.com/windystrife/UnrealEngine_NVIDIAGameWorks ; Chaos steering config: https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/ChaosVehicles/FVehicleSteeringConfig
- LFS manual, controls: https://en.lfsmanual.net/wiki/Options/Controls
- rFactor 2 keyboard guide (Controller.JSON): https://steamcommunity.com/sharedfiles/filedetails/?id=553201325
- VDrift `carcontrolmap.cpp`: https://github.com/VDrift/vdrift/blob/master/src/carcontrolmap.cpp
- TORCS `human.cpp`: https://github.com/fmirus/torcs-1.3.7/blob/main/src/drivers/human/human.cpp
- Edy's Vehicle Physics wiki (CarSettings / CarControl): https://vehiclephysics.repositoryhosting.com/trac/vehiclephysics_edys-vehicle-physics/wiki/CarSettings
- Vehicle Physics Pro input: https://vehiclephysics.com/components/vehicle-input/
- Dedoimedo, BeamNG keyboard driving: https://www.dedoimedo.com/games/beamng-keyboard-mouse-driving.html
- AC keyboard settings: https://solox.gg/assetto-corsa-keyboard-controls/ ; https://pastebin.com/F62BZYv0
- GT7 countersteering assistance: https://gran-turismo.com/us/gt7/manual/drivingoption/03
- GT3 ABS/TC: https://en.wikipedia.org/wiki/Group_GT3
- FIA Appendix J Art. 257A (2024): https://www.fia.com/sites/default/files/257a_2024.pdf
- Slip-angle ranges: https://suspensionsecrets.co.uk/tyre-slip-angle
- Marco Monster, Car Physics for Games (archived): https://web.archive.org/web/2003/http://home.planet.nl/~monstrous/tutcar.html
- GameDev.net on fake rear-grip drifting: https://gamedev.net/forums/topic/712162-how-do-i-implement-arcade-drift-using-a-physics-engine
