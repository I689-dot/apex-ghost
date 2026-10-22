# Decisions

Every non-obvious choice made while building **APEX GHOST**, with the reason. Newest information wins: if something here disagrees with the code, the code is right and this file should be fixed.

## Name and style

- **Name:** APEX GHOST. It is about the apex, and every opponent is a ghost car.
- **Look:** dark charcoal UI, one signal-red accent (`#ff2d3d`) plus yellow for the room code and gear, and condensed italic display type (Barlow Condensed, loaded from Google Fonts). It reads like motorsport timing graphics and stays out of the way in the cockpit.

## Assets

### Which map

The `3D MODELS/MAP` folder holds **three** versions of the Nürburgring, not two:

| Version | Triangles | Textures | Notes |
|---|---|---|---|
| `Nürburgring_Circuit` | 13.9k | none | One untextured STL-style shell. Not usable. |
| `Nürburgring_GP_2016_layout` | 310k | 44 (512–1024 px) | Generic material names (`Object6921Mtl`), so there is no reliable way to tell road from grass from wall. |
| `Nürburgring_GP_2022_layout` | 1.83M | 103 (mostly 256 px tiling) | **Chosen.** Semantic materials (`asph_new`, `curb_b`, `sand`, `gravel_ext`, `grass`, `tyrewall`, `grail_tess`…), painted lines with the real grid boxes, the Mercedes-Arena layout, start lights, pit building and trackside detail. |

The 2022 version's triangle count is mostly trees (878k triangles). The pipeline keeps every tree within 140 m of the racing line and 45% of trees out to 420 m. That leaves 171k tree triangles. Tiling textures are small, so the whole map is 18 MB on disk.

**Scale.** The USD files use Sketchfab wrapper transforms with a 0.5143 root scale. The pipeline ignores that and derives the scale itself: it traces the centreline and scales it to the official 5,148 m GP lap. The result, 1.99 m per source unit, puts the painted grid boxes exactly 8.0 m apart, which matches the FIA standard and confirms it.

### Start/finish line and grid

The map has no empties or named grid markers; the Sketchfab export dropped them. The grid is painted geometry instead. The pipeline:

- finds the transverse bars (~2 m) in the `lines_003` mesh;
- takes the 12 nearest the start line, pole first;
- places each car's origin (mid-wheelbase) 2.7 m behind its bar, facing the race direction.

The chequered line (the `lines_003` component with ~300 vertices) is **gate 0**, the start/finish line used for lap timing. The grid sits between that line and the start-light gantry, as at the real track. Lap 1 from the grid is an untimed out lap (see "Session format"), so the grid position never decides the result.

### Checkpoints and centreline

Generated, because the map has none.

- **Centreline:** edge-following on a rasterised road mask (0.25 units per pixel). The painted white edge lines, curbs and every wall/barrier mesh act as boundaries, so wide asphalt run-off areas don't pull the line off the racing surface and it can't cut an apex through a tyre wall. It is smoothed and resampled every 5 m.
  - The trace starts on the middle of the grid, not at the chequered strip: that strip only covers the pit-wall side of the straight, and starting there sent the line down the narrow corridor next to the pit wall for the first 300 m (bots hit the pit wall at the start, resets and the minimap were off).
  - It closes when it crosses the start again and traces 1,200 more steps; the converged second pass replaces the first steps.
  - **Re-centring:** the smoothing straightened the Veedol chicane and some hairpins, putting the line on the grass (bots and the track-limit check went wrong there), and widths from the trace bled from one side to the other. Every 5 m point is now re-centred on the asphalt, lightly re-smoothed, and its widths are measured directly along its normal. The lap is 5,202 m along this line.
  - **Walls:** where a barrier is the track edge (the pit-entry wall at the apex of the last corner, the pit wall along the straight), the usable width stops 1.2 m short of it. Structures that "wall" both sides at once (gantries, bridges) are ignored.
- **Gates:** 149, one every 35 m, each as wide as the road plus 14 m of run-off. Dense gates mean a reset puts you back close to where you left the track.
- **Sectors:** 3, split at gates 50 and 99.
- `debug_track.png` and `debug_grid.png` in `tools/asset-pipeline/out/map` show the result. The in-game editor (F2, dev builds only) overlays the centreline, gates, grid and surface types, lets you nudge them, and exports `track.json`.

### Surfaces and collision

Surfaces come from material names:

| Surface | Materials |
|---|---|
| asphalt | asph*, travert runoff, green/red painted concrete, pit lane |
| curb | curb* |
| grass | grass*, astroturf, grasscrete |
| gravel | gravel* |
| sand | sand* |
| wall | tyre walls, guard rails (`grail_tess`, `galvanized`), concrete walls, fences |

Painted lines and decals are left out: they sit on top of the asphalt, so wheel rays hit the road beneath.

The 18 km background terrain is **render-only**. Its coarse triangles would poke through the road if they were collidable, and barriers keep cars on the modelled surfaces anyway.

Collision is a separate, simplified set of meshes:

- walls go from 382k to 125k triangles; grass and sand are lightly simplified; road and curbs are kept at full detail because the wheels ride on them;
- each surface becomes its own Rapier trimesh collider;
- total 307k triangles, gzipped by the pipeline to 3.2 MB.

The file is called `collision.apxc`, not `.gz`, because some hosts and Vite add `Content-Encoding` for `.gz` files. The client sniffs the gzip magic bytes and inflates only when needed.

### Cars

- **19 unique cars after de-duplication.** `2020_McLaren_720S_GT3(1)` is byte-identical to `2020_McLaren_720S_GT3`, so it is skipped.
- **18 cars are playable.** `Ferrari_296_GT3__www.vecarz` is **excluded**: the source is an exploded display model, with its wheels detached and lying beside the car and the front bodywork missing. It can't be fixed by conversion. It is listed in `cars.config.json` (`"exclude"`) and can be re-enabled if a better source appears.
- **Conventions.** Every car is converted to the same frame: metres, +Y up, +Z forward, +X towards the driver's left, with the origin at mid-wheelbase on the ground.
- **Scale.** Each car is scaled to its real length (`cars.config.json → pipeline.realLengthM`). The source files disagree by up to ×100, and real lengths are reliable. Tyre-diameter scaling is only the fallback.
- **Front and back** are worked out from three cues: corner labels in the USD hierarchy (`WHEEL_LF`, `Tire_RR`, `DISC_LR`…), front/rear part names, and the rear wing being the highest point. Every car's thumbnail was checked visually.

### Wheel separation

The pipeline separates the wheels in this order:

1. **By name.** Parts named like tyres (`tyre`, `tire`, but not `rim`, `disc` or `hub`) are clustered per corner.
2. **By geometry.** Failing that, it looks for ring-shaped parts low in each corner (similar width and height, thin across).
3. **Mirroring.** A missing wheel is copied from the other side of the axle.

Everything inside each wheel's cylinder moves into `wheel_XX_spin`: tyre, rim and disc. Calipers go into a static `wheel_XX_caliper`. The hub node `wheel_XX` sits at the wheel centre, steers about +Y and spins about +X.

**Fallback:** if a wheel can't be cut cleanly, a generic tyre and rim sized to the car replace it. The baked tyre faces inside that wheel's cylinder are deleted from the body.

**Cars that needed the fallback: `lamborghini_huracan_gt3_evo` (rear wheels only).** This model has no textures and no part names.

The physics uses **symmetric** axles (averaged left/right): the source models are a few millimetres lopsided, and that made one car pull by 0.8°.

### Cockpit camera

- **With a steering wheel** (found by name and kept in the cabin, 13 of 18 cars): the initial eye is 0.5 m behind the wheel along its axis and 0.06 m above. The wheel's PCA normal is used as the column axis when it's plausible; otherwise a 22° column tilt is assumed. The wheel is a separate node and turns with steering (×11 ratio).
- **Otherwise, the driver's seat** (`seat`, `sparco`, `recaro`, `bucket`; 1 car): eyes 0.8 m above the cushion, a little ahead of the seat back.
- **Last resort:** a roof heuristic (4 cars).
- **Ray-cast refinement** (all cars). Candidate eye positions around the initial guess are scored with ray casts against the cabin, with glass excluded:
  - inside closed geometry: rejected;
  - open view through the windshield: rewarded;
  - dashboard visible just below and roof just above: rewarded;
  - distance from the guess: penalised;
  - with a steering wheel, the eye must stay 0.3–0.75 m behind it.
- **Per-car nudge:** `cars.config.json → pipeline.cockpitOffset`. Used once, for the BMW M3 Touring, whose interior shares one atlas material with its windows.
- **Opaque glass.** Some sources ship opaque windows. Window materials, and objects named like windows, become 22% alpha blended glass. A "glass" material covering more than 15% of a car's faces is a catch-all atlas and stays opaque.
- A cockpit-view render from the computed eye (`out/cars/<id>_cockpit.png`) verifies every car.
- **No interior** (none of the 18 cars after conversion; the code path exists): a minimal dashboard and steering wheel are generated in front of the camera.

### Optimisation budgets

| | LOD0 (your car, close remote cars) | LOD1 (≥32 m) | LOD2 (≥95 m) |
|---|---|---|---|
| Triangles | ~100k (see note) | ~28k (interior dropped) | ~7k |
| Textures | ≤1024 px colour, ≤512 px data | ≤512 px | ≤128 px |

- **LOD0 deviation.** 11 cars are at ~100k triangles, 5 at 101–130k, and 2 at ~175k (Mercedes-AMG ONE and BMW M3 Touring, whose sources are unindexed triangle soups). LOD0 is simplified with UV seams locked. Pushing those cars to 100k means tearing seams, which visibly smears cockpit textures, and LOD0 is only drawn for your own car and remote cars within 32 m.
- **Caps.** The brief allows up to 2048 px for car textures. 1024 px was chosen so the full game fits Vercel Hobby's 100 MB static upload limit (assets total ≈ 87 MB). Simplification error is capped per LOD (0.8% / 2.5% / 6% of the car's size), so panels never shred; a LOD may go slightly over its triangle budget instead.
- **Textures** are KTX2/Basis Universal: ETC1S for colour, UASTC+RDO for normal maps. Where the basisu encoder crashes on an image (it does for one Aston Martin texture at some quality levels), the pipeline retries other levels and finally falls back to **WebP** for that texture. Thumbnails and UI images are WebP too.
- **No second, WebP-only copy of every model:** it would double the deployment past 100 MB. Every target browser (desktop Chrome, Edge, Firefox with WebGL 2) runs the Basis transcoder in WebAssembly.
- **Meshes** use Meshopt compression (`EXT_meshopt_compression`, high level).
- **Lights.** Light materials are split by position into `LIGHT_HEAD_*` and `LIGHT_TAIL_*` copies, so the game can drive brake, tail and headlights per car.

### Pipeline tools

- **Blender 4.2 LTS** (headless) and Python `usd-core`. Blender is a portable tarball in `~/.local/opt`, because there was no sudo. The `BLENDER` env var overrides the path.
- **KTX-Software 4.4.2** (`toktx`) and **gltf-transform 4** with meshoptimizer.
- **One command:** `pnpm assets`.

### Car specs

`tools/asset-pipeline/cars.config.json` is the hand-editable source. It uses engine profiles (mid-engine V8 turbo, V10 NA, front V8, rear flat-six, front I6 turbo, V6 turbo), then per-car overrides. The values follow real GT3 numbers under Balance of Performance (≈370–395 kW, 1,235–1,310 kg).

Balance:

- **Mercedes-AMG ONE** (hypercar): power capped at 560 kW and AWD, but road tyres and much less aero, so it doesn't dominate.
- **Ferrari 296 Challenge** (Cup car): more power, less grip and aero.
- **BMW M3 Touring 24h:** heavier and taller, less downforce.

**Realism pass** (details and sources: `docs/REALISM_RESEARCH.md`):

- **Grip:** slick grip μ 1.95, so a GT3 corners at ≈1.7 g at 120 km/h and ≈2.0 g at 200 km/h and brakes 200→0 in ≈75 m.
- **Aero:**
  - GT3 downforce raised by 35%, to ClA ≈ 2.3 m², about 450 kg at 200 km/h.
  - Drag area calibrated per car with `tools/sim/calibrate.ts` so the simulated top speed equals the spec. It now sits around 1.0–1.1 m², a realistic value for big-wing race cars; before, the cars reached 306 km/h.
  - The gearing-limited Ferrari Challenge keeps a hand-set drag area of 0.9.
- **Lap times:** the theoretical lap on our track is ≈2:07, against a real GT3 pole of ≈1:54. The difference is mostly the conservative measured track width; see the research notes.

## Architecture

- **Monorepo:** pnpm workspaces, strict TypeScript everywhere. `packages/shared` holds the protocol, room/race logic types, weather, track helpers and validation. It is imported by the client, the server and the tests.
- **Client:**
  - Vite + Three.js r171 (WebGL 2) + Rapier 3D 0.14 (WASM, `-compat` build: no extra .wasm request).
  - UI is plain TypeScript + CSS (a 20-line `h()` helper): no framework cost in the race loop.
- **Physics:** fixed 120 Hz with render interpolation, on the **main thread**. The car model costs ~0.2 ms per step; Rapier's work is 4 ray casts plus one box against static trimeshes. A worker would add a frame of input latency and transfer complexity for no measurable gain. It can be moved later; physics doesn't touch the DOM.
- **No allocations per frame** in the hot loops: all vectors are preallocated. The remaining exception is Rapier's JS getters, which return small objects.

## Driving model

**Suspension.** Four raycast wheels with:

- spring, bump and rebound dampers (32% / 55% of critical);
- anti-roll bars;
- bump stops;
- ride height derived so that each model sits at its modelled height under static load.

**Tyres.** A normalised Pacejka-style Magic Formula with a combined-slip friction ellipse and load sensitivity. Slick parameters:

| Parameter | Value |
|---|---|
| Peak slip ratio | 0.10 |
| Peak slip angle | 6.6° |
| Sliding grip, longitudinal | 82% of peak |
| Sliding grip, lateral | 80% of peak |

The flatter post-peak curve makes slides progressive and catchable on a keyboard. **Wheel spin** is integrated implicitly in 4 substeps (480 Hz). Explicit integration of a stiff tyre is unstable at low speed.

**Weight transfer emerges** from where forces act: tyre forces are applied at the contact patch, raised 12 cm towards a roll centre to avoid roll-over.

**Engine and gearbox:**

- torque curve, launch clutch, rev limiter (fuel cut), engine braking that grows with rpm;
- sequential gearbox with a per-car shift time, automatic by default, manual with keys (M toggles);
- reverse engages by holding brake when stopped.

**Differential.** Limited-slip: an open split plus a locking torque proportional to the wheel speed difference, capped by `diffLock`. AWD uses a fixed front/rear split.

**Assists** (your car only; defaults: ABS on, TC low, others off):

- **ABS** releases a wheel past −13% slip.
- **TC** trims throttle past 7% or 13% wheel slip.
- **Stability control** cuts throttle and brakes the outer front wheel past ~5° body slip.
- **Steering assist** adds counter-steer.

**Keyboard smoothing.** Throttle and brake ramp in and out. Steering eases in (slower at speed) and returns to centre faster. Lock shrinks with speed, to about 30% at 200 km/h.

**Surfaces:**

| Surface | Grip (vs asphalt) | Rolling resistance | Extra drag |
|---|---|---|---|
| curb | 0.90 | | |
| grass | 0.55 | | |
| gravel | 0.50 | high | speed-dependent |
| sand | 0.42 | high | speed-dependent |

**Wet grip:** up to −27% when fully wet, −32% in heavy rain with standing water. Wetness lags rain: it soaks in over ~40 s and dries over ~4 min.

**Checked headlessly** with `tools/sim/simtest.ts`, which runs the real client vehicle code in Node:

| | Porsche 992 GT3 R |
|---|---|
| 0–100 km/h | 3.7 s |
| 0–200 km/h | 9.8 s |
| Top speed | 306 km/h (gearing-limited) |
| 200→0 braking | 88 m |
| Cornering | 1.44 g at 120 km/h, 1.67 g at 200 km/h |
| Straight-line pull | none |

Drifts can be started (lift-off, handbrake or power), held and recovered. How easily depends on the car: the rear-engined Porsche is hard to slide, the front-engined BMW slides easily.

### Keyboard controls

Rewritten from a research pass over developer sources (Assetto Corsa's Advanced Gamepad Assist, BeamNG, Live for Speed, rFactor 2, UE4/Unity defaults). Details, values and sources: `docs/KEYBOARD_CONTROLS_RESEARCH.md`. Code: `apps/client/src/physics/keyboardDriver.ts`.

- Keys only set targets. All smoothing runs inside the 120 Hz physics step, never per render frame.
- Steering has three rates: out 4/s, return 5.5/s, reverse (opposite key) 8/s, then a 40 ms low-pass and a 1.5 gamma so taps make small corrections.
- **Full key = front tyres at 95% of their peak slip angle**, not full mechanical lock. The limit follows the car's motion, opens up when counter-steering so slides can be caught, and fades to full lock below ~20 km/h for hairpins and parking.
- A small self-steer (caster emulation, capped at 8°) is blended out while you steer.
- Throttle and brake ramp in over 0.2 s and release twice as fast.
- **Handbrake** ramps in (2.5/s), is capped at 700 N·m per rear wheel (below locking) and fades to 25% above 100 km/h, so it rotates the car instead of spinning it off the road.
- **The pull to the left** came from damage: the steering pull side defaulted to left even without damage, and the low car box scraped the road over crests and counted as impacts. Pull now needs real damage, only wall/barrier contacts damage the car, and the chassis box starts 30 cm above the ground.

## Damage

- **Source and zones.** Only environment hits cause damage (Rapier contact-force events). Six zones: front, rear, left, right, engine, suspension. The impulse is turned into kinetic-energy-equivalent kJ; light scrapes below 1.5 kJ do nothing.
- **Mechanical effects are capped** so every race is finishable:

| Effect | Cap |
|---|---|
| Power | −30% |
| Grip on the damaged side | −12% |
| Steering pull | 1.6° |
| Drag | +22% |
| Downforce | −30% |
| Ride height sag | 2.5 cm |

- **Visuals:**
  - vertex dents on LOD0 bodywork around the impact (geometry is cloned per car on first hit);
  - a cracked windshield overlay in the cockpit;
  - engine smoke above 55% engine damage.
- **Sync:** zone values are sent to the others at most once per second. Damage resets each race, because a new session is created.

## Session format (qualifying: best lap wins)

(Superseded in part by "Timed qualifying sessions and pit stops" below: sessions are now timed, not a lap count.)

With different grid slots, "first past the flag" was decided at the start. Like GT3 qualifying, a session is now:

- **Out lap:** lap 1 from the grid is untimed, and so is the lap after every pit stop. It warms the tyres, and the grid position no longer matters.
- **Timed laps:** `RACE_LAPS` (3) timed laps; the **best valid lap** decides the order. Equal times keep join order, and drivers without a time follow by distance.
- **Invalid laps:** a lap stops counting when
  - every wheel touching the ground is on grass, gravel or sand;
  - the car's centre is more than half a car plus a kerb's width (1 m) beyond the edge (catches asphalt run-off); held for 0.25 s;
  - the car is reset (no time penalty any more, because the reset costs the lap).
- **Anti-cheat:** the server owns the classification. Clients add an off-track flag (`FLAG_OFF_TRACK`) to their position samples, and the host does the same for bots. Like the reset flag, a modified client could withhold it; laps still need every gate in order and a plausible time.
- **End:** the session ends when everyone has finished, or 60 s after the first driver finishes.
- **HUD:** OUT / lap n of N, an INVALID tag on the lap timer, and a live delta to your best valid lap, interpolated every 5 m from a local mirror of the lap logic, so there's no network delay. The timing board shows the best lap of P1 (purple) and the others' gaps. The results show best lap, gap and valid laps.
- **Protocol:** version 4. New `invalid` message; `lap` has `valid` and `outLap` fields.

## Timed qualifying sessions and pit stops

"Best time, not first to the end": a session is now a **timed qualifying**, like GT3 qualifying:
- The host picks the length in the lobby (5, 10, 15, 20 or 30 minutes; default 10).
- Everyone laps as often as they like. The best valid lap decides the order; laps and finishing order don't matter.
- When the clock reaches zero the **chequered flag** falls: the lap in progress may be finished and still counts, then the driver's session is over. A car in the pit lane at the flag is done.
- The session ends when everyone is done, or 4 minutes after the flag (`FLAG_GRACE_MS`).
- The lap-count mode remains for tests and tools only.

**Pit lane** (traced from the map, `track.json` → `pitLane`):
- **Route:** it leaves the circuit on the inside of the last corner (4,773 m, the pit-entry wall), runs along the start/finish straight behind the pit wall, 20 m from the track and 8.4 m wide, and rejoins before Turn 1 (540 m). It is 800 m long.
- **Finding it:** a sideways scan from the start/finish straight finds the asphalt strip of pit-lane width beyond the pit wall (the narrow strip in front of the wall is run-off). It is then traced forwards and backwards until it merges with the circuit. The service zone is the 140 m alongside the line where the garages are, painted with a yellow box outline and a "PIT SERVICE" board.
- **Limiter:** entering engages the automatic 60 km/h limiter (throttle cut above the limit, brakes for an over-speed entry).
- **Lap logic:** the lap in progress is lost, gates are ignored inside the lane (it runs beside the circuit), and at the exit the lap logic resumes at the next gate. The lap after the pit exit is an out lap. The server learns pit in/out from the client (`pit` messages); this gives no advantage, because it always costs a lap.
- **Resets** are disabled in the pit lane.

**Pit service** (`game/pitService.ts`, `ui/pitMenu.ts`): stop in the box to open the menu. The session clock keeps running.

| Service | Time |
|---|---|
| New tyres (any compound) | 14 s |
| Bodywork & aero | 4 s + 26 s × worst body damage |
| Suspension | 6 s + 34 s × damage |
| Engine | 8 s + 52 s × damage |

- The tyre crew works while the mechanics repair, so the stop lasts the longer of the two, plus 2 s on and off the jacks.
- Defaults: repair what's damaged, and fit fresh tyres when worn or the wrong kind for the weather.
- New tyres are cold, because there are no tyre warmers.
- Sounds: air jacks and wheel guns.
- Repairs reset the damage zones, the body dents and the windscreen crack.

**Tyre compounds and wear** (`physics/tyres.ts`): GT3 championships race one Pirelli dry compound plus a wet. Soft / Medium / Hard are a game choice, as in ACC and the F1 games, so that a stop is a strategy:

| Compound | Dry grip | Wet grip | Wear | Window | Warm-up |
|---|---|---|---|---|---|
| Soft | 1.035 | 0.52 | ×1.9 | 85 °C | fastest |
| Medium | 1.0 | 0.52 | ×1.0 | 90 °C | normal |
| Hard | 0.965 | 0.50 | ×0.55 | 97 °C | slowest |
| Wet | 0.86 | 0.80 | ×0.7 in rain, much more on a dry track | 65 °C | quick |

- **Wet grip** blends with track wetness. Slicks also lose up to 8% more in standing water (aquaplaning). This replaces the old one-size wet-grip factor.
- **Wear** comes from sliding energy and is faster when overheated. Grip falls by up to 16% on a worn-out tyre. A Medium uses about 4–5% tread per lap at a smooth pace (`tools/sim/ailap.ts` prints it).
- **Bots** start on mediums, or wets on a wet track, and don't pit.
- **HUD:** the tyre instrument shows the compound badge (Pirelli colours) and a dark bar for tread worn. A top-centre session clock turns chequered at the flag. A yellow banner shows PIT LANE · LIMITER 60 or PIT BOX. The timing board tags drivers in the pits, and the minimap draws the pit lane and the service zone.

## Session setup: layouts, conditions, car setup

**Layouts.** The map files contain the asphalt of a link road that skips the Müllenbachschleife (the northern loop). `track_analysis.py` builds a second layout from it:
- it traces the link from its middle until it merges with the circuit at both ends;
- it splices the link into the GP centreline (same start/finish, grid and pit lane);
- it resamples every 5 m and recomputes gates, sectors and the pit entry and exit positions.

| Layout | Length | Gates |
|---|---|---|
| GP | 5.20 km | 149 |
| Short (no Müllenbachschleife) | 4.15 km | 118 |

The real "Sprintstrecke" (3.63 km) also skips other sections, so the short layout is labelled honestly. `optimize.mjs` writes one JSON per layout plus `tracks.json` (the index) and `tracks-race.json` (per-layout server validation). `--only tracks` and `--only collision` rebuild them without re-optimizing meshes.

**Other map files.** `3D MODELS/MAP` also holds `Nürburgring_GP_2016_layout` and `Nürburgring_Circuit`.
- The 2016 file has generic material names (`Object6121Mtl…`), so road, kerb, grass and wall can't be told apart automatically; it would need a hand-made material map.
- The other file is a single untextured outline mesh of the whole Nürburgring (13 × 14 km).

**Conditions** (host, lobby):
- **Options:** weather (random or any kind), time of day (dawn 06:30 … night 22:30), changes (possible / stable / changing), session length.
- **New forecast:** rerolls the seed.
- **Determinism:** `planWeather(seed, options)` makes the forecast exact. Every client shows it in the lobby, and the session runs exactly that. "Random" everywhere reproduces the old behaviour.

**Car setup** (each player, lobby; saved in settings):
- **Starting tyres:** S/M/H/W, shown to everyone as a tyre badge.
- **Rear wing:**

  | Setting | Downforce | Drag |
  |---|---|---|
  | Low | −18% | −10% |
  | Medium | baseline | baseline |
  | High | +18% | +10% |
- **Brake balance:** 54–66% front.
- **Engineer suggestion:** a recommendation from the forecast (wets in the wet, softs in cool air, mediums otherwise), applied with one click.
- **Bots:** wets on a wet forecast, mediums otherwise.

## Zandvoort

A second map: **Circuit Zandvoort, 2023 layout** (`3D MODELS/MAP/Circuit_Zandvoort_2023_layout/scene.usdc`, the same Sketchfab USD export format as the Nürburgring). The host picks it in the lobby like a layout; the client loads its own chunks and collision, the server validates its laps.

**The source.** 141 meshes, 1.06 M triangles, 100 materials, 138 small textures (mostly 128 px tiles, a 2048 px satellite photo). It is an Assetto Corsa conversion (Sylracing and "Circuit Park Zandvoort" boards in the textures) and every material has a generic name (`Dado_LW_041_<n>`, `Merged_materials`), so nothing can be matched by name as on the Nürburgring.

**Materials identified by hand.** A contact sheet of every texture, top-down plots of every material's triangles, and per-material statistics (area, share of flat triangles, height above the nearest road) told them apart. The map config (`tools/asset-pipeline/maps/zandvoort.json`) renames them to the prefixes the pipeline and the client already key on, so Blender chunking, simplification, cut-out foliage, wet asphalt, macro variation and the surface rules work unchanged:

| Renamed to | Source | Surface |
|---|---|---|
| `asph_zv61` (racing surface), `asph_zv42` (new asphalt: banked corners, Tarzan apron, pit exit), `asph_zv96` (run-off, pit lane, paddock), `asph_zv60` (rubbered strips) | 61, 42, 96, 60 | asphalt |
| `lines_zv75` (edge lines), `lines_zv59` (grid brackets, pit hatching), `lines_zv58` (start/finish), `lines_zv92`, `lines_zv21` ("PITLANE"), `lines_zv7` | | asphalt |
| `conc_`, `pavement_`, `tiles_`, `grille_` | 26, 22, 28, 6, 34, 23 | asphalt |
| `curb_zv44`, `curb_zv48`, `curb_zv25` | red/white textures | curb |
| `grass_zv97`, `86`, `24`, `71`, `74`, `55`, `81`, `51`, `31`, `66` (grass, dune grass, edge blends) | | grass |
| `gravel_zv43` | | gravel |
| `top2_zv73` (satellite terrain) | | grass (ground) |
| `trees_new_zv87` | billboards | render only |
| `wall_zv49` (untextured concrete barriers), `wall_zv50/20/9/41/33/8`, `tyrewall_zv18/19`, `galvanized_zv93` (rails and posts), `fence_zv68/89/64/54/63` | | wall |
| `struct_zv84` (garages), `struct_zv65`, `struct_zv16`, `struct_zvmerged` (buildings, bridges) | | wall |

Everything else (grandstands, signs, lamp posts, cables) is render-only scenery.

**Scale and direction.** The trace measured 12,223 source units for the lap, scaled to the official 4,259 m: **0.348 m per unit**. The painted grid brackets then sit 8.1 m apart, the FIA spacing, which confirms it (the Nürburgring check was the same). The circuit runs clockwise: up the main straight, Tarzan is a right-hander, Hugenholtz a left-hander, as in reality. The lap line is 4,299 m (+0.9 %, as the Nürburgring's is +1 %).

**Track analysis** (`track_analysis.py <usd> <out> maps/zandvoort.json`; the Nürburgring run without a config gives byte-identical output):
- Distances tuned in Nürburgring units scale with `unit` (5: Zandvoort's model is ~5× finer).
- **Centreline:** traced on the racing-surface materials only (`traceRoad`). On the whole asphalt it turned into service roads at two junctions and skipped the western loop. Where the racing surface has a short gap (the start of the Arie Luyendyk banking) the trace follows the whole road for those steps, and one hand-placed boundary segment closes the run-off lane it otherwise slid into. Widths come from the whole asphalt between the painted edge lines, walls and kerbs, as before.
- **Walls above the road** (bridges, roofs, the gantry over the line) no longer cut the road in plan: a wall triangle counts as a track edge only if its foot is within 1.5 units of the road surface around it.
- **Width spikes:** where a service road or run-off joins, the measured width jumped by up to 6 m for a few metres, and the racing line swung into it (bots ran wide at ~1,450 m). Each side is capped at its ±40 m running median + 1 m.
- **Start/finish and grid:** one painted line (`lines_zv58`, the copy in the pit lane is ignored), the grid behind it. The brackets are unwelded pieces (bar and legs), grouped by distance. The 12 slots follow the pole bracket every 8.1 m in alternating columns; one bracket merges with the pit-entry hatching and is placed on its column at the expected distance. Pole is on the right, 20 m behind the line; cars face along the straight. The first gate is the line itself.
- **Gates and sectors:** 123 gates (35 m), sectors split at gates 41 and 82 (1,430 m and 2,865 m).
- **Start lights:** the model has none. The gantry over the line is a bridge without lamps, and the only traffic-light objects are marshal posts and the pit-exit light. The countdown uses the HUD lights only, as before.
- **Pit lane:** the automatic trace (a sideways scan from the line) found the right corridor but wandered into the paddock in both directions, so the lane is given as (lap distance, lateral offset) pairs on the lap line in the map config, measured from the road rasters and checked against the collision surfaces with `node tools/sim/pitlat.mjs <from> <to> --track zandvoort`. The entry leaves the right edge of the main straight 100 m before the line (the hatched blend line), the lane runs between the pit wall and the garages 15 m right of the lap line, and the exit lane continues past the end of the pit wall and along the inside of Tarzan, separated by a line, merging at Gerlach. Entry at 4,199 m, exit at 612 m, 682 m long. The service box is 140–240 m, in front of the garages.

**Render chunks and collision** (`blender/convert_map.py` with the same config renames the materials on import):
- 750 k track, 297 k scenery, 1.4 k tree and 2.8 k terrain triangles; the heavy barriers are simplified to 465 k for the track chunks.
- Collision: walls 768 k → 338 k, 479 k triangles in all, 4.8 MB gzipped.
- `fill_holes.mjs` filled 11.9 k cells of 2 m (4.8 ha) with the main grass texture (`fillGrass` in the map config; otherwise the first grass material would be used, here an edge blend). `pnpm tsx tools/sim/holes.ts --track zandvoort`: no holes on the track, its run-off or the pit lane.
- Assets: 18.4 MB in `public/assets/maps/zandvoort/`, plus 0.6 MB of menu photos.

**Banking (tried, not kept).** Hugenholtz and Arie Luyendyk are banked about 11° and 14° in the model (19° and 18° in reality); the physics feels it through the collision mesh. A bank-aware speed profile for the bots (bank measured from the road surface at every lap-line point) made the quasi-steady lap 6 s faster, but bots trusting it ran wide on flying laps (resets at 1,464 m and 3,632 m). Counted only from 7° and at 70 % it was safe but gained 0.3 s, so it was dropped: the bots' profile stays flat-corner, as on the Nürburgring.

**Per-map pipeline.** `tools/asset-pipeline/maps/<id>.json` holds the source model, output folder (`out/map`, `out/map_zandvoort`), asset folder (`public/assets/track`, `public/assets/maps/zandvoort`), layouts with their turn count, and the map-specific steps (the Nürburgring's pit-entry fix, the fill grass). `optimize.mjs --map <id>` writes that map's layouts and merges them into `tracks.json` and `tracks-race.json`, keeping the other maps' entries. Every Nürburgring file and URL stays where it was.

**Client.** Nothing in the race code was Nürburgring-specific beyond the "15 turns" fact in the TV intro (now `turns` from the track index: 15 and 14) and the menu tagline. The menus' photo backdrops follow the session's map (`photo_<shot>_zandvoort.webp`, made with `node tools/e2e/photos.mjs --track zandvoort --map zandvoort`). Spanish: "Circuito de Zandvoort", "{n} curvas".

**Checks:**
- `pnpm tsx tools/sim/ailap.ts <car> --track zandvoort --laps 3`, Porsche 911 GT3 R (992): standing lap 1:58.8, flying laps 1:53.1 / 1:53.2 at skill 0.97 (1:56.8 at 0.88), no resets, no track-limit violations, top speed 243 km/h. Quasi-steady-state lap 1:48.7. A real GT3 pole is 1:33–1:35; the gap (+20 %) is about the same as on the Nürburgring (bots 2:12 against 1:54), from the conservative widths and the bots' safety margins. McLaren 720S LMGT3 Evo (1:52.3 flying) and Mercedes-AMG ONE: clean over 3 laps.
- The Ferrari 296 Challenge at the top skill (0.97) loses the car on lap 3 with overheated brakes and worn rear tyres. It does the same at the Nürburgring, so it isn't the track.
- `ailap.ts` now gives the bot the grip left in its tyres, as the game does (it passed a fixed 1 before), and can run several laps.
- `node tools/e2e/smoke.mjs --track zandvoort --gpu --bots 3 --pit`: passed. Lobby with Zandvoort, cinematic, grid pass, start, driving with 3 bots, pit lane limiter and service box, 58 fps average on the iGPU (Low; the Nürburgring run: 70). The Nürburgring smoke test passes unchanged.
- `node tools/e2e/tour.mjs --track zandvoort --aerial`: driver's-eye and aerial frames every 300 m; no holes, missing textures or scale problems were found.
- `apps/server/test/tracks.test.ts`: every layout in the index has validation data, and a lap along its lap line is counted by the server's tracker.

**Known limits.**
- The sun is still computed for the Nürburg's latitude, and the map's north isn't known; Zandvoort is 2° further north, which doesn't visibly change the sky.
- The pit lane isn't traced automatically on this map; if the model changes, re-measure the pairs with `pitlat.mjs`.

## Timing screen

Hold **Tab** for the full timing screen: position, driver, car, best lap, gap, last lap, best sectors (purple = fastest of the session), laps, and status (out lap / in pits / invalid / on a timed lap / finished).
- **Board labels:** the small board says OUT LAP / PIT / ON LAP instead of "NO TIME".
- **Out lap message:** after the out lap, a message gives its (untimed) time.
- **Refresh:** the server sends standings immediately after every lap.

## Map collision fixes ("missing texture" and falling below the map)

1. **The collision builder read small files wrongly.** It read Node's shared buffer pool instead of just the file's bytes (`readFileSync(...).buffer`), so the small gravel mesh got garbage vertices at ~10²⁸ m.
2. **The terrain had no collision at all.** Material `top2` matched no surface rule, so leaving the grass dropped the car through the world. Also without collision:
   - drainage grates (`grille`);
   - painted lines;
   - roadside posts, marshal boxes, garages and the timing tower.

   The rules now cover them.
3. **The lap line's height was wrong** by more than 1.5 m in 313 places. Where roads overlap in plan (under a bridge), the raster heights picked the wrong layer. Resets and respawns use that height, so the car could be placed under the road. Heights now come from the road collision surface, following the continuous one.

`tools/sim/holes.ts` casts rays across the track every 5 m. The full-width hole at 1,421 m and the 1 m edge strips are gone; 41 hairline single-point misses remain at triangle cracks.

## Cinematic and terrain

- **Culling:** the aerial shots showed holes because the scenery is culled by distance from the camera. It is now fully shown during the flyover.
- **Terrain texture:** the 2048 px terrain image was being shrunk to 512 px (a smudge from the air); it is now kept at 2048 (+0.7 MB).

## Cockpit detail

The cockpit used LOD0, simplified to ~100k triangles with textures capped at 1024 px. That removed 50–85% of the source geometry (switches, dials, steering-wheel buttons).
- **Cockpit model:** every car now has `cockpit.glb`, loaded only for your own car on Medium and above: up to 400k triangles with a 0.0005 error cap (108k–424k, 1.9–8.3 MB) and textures up to 2048 px.
- **Other cars and Low quality:** the light LODs.

## Menus with real images

The menus looked generic: a 3D showroom with a pink floor and glowing ring, rounded glowing cards. They now follow Gran Turismo's restraint (the cars first, no glows) and broadcast graphics (flat, square, high contrast), using real images instead of CSS drawings. Licensed internet photos weren't an option, so the images are made from the game's own assets:
- **Track photos:** in-engine shots of the circuit with the cars (`tools/e2e/photos.mjs`, Ultra quality, graded) as menu backdrops. Menu: the grid; lobby: the straight; loading: the aerial; results: the pole car.
- **Car renders:** a Blender Cycles studio render of every car (`tools/asset-pipeline/ui_renders.mjs` + `blender/render_ui.py`) for the lobby preview and the results podium. They swap instantly on hover; no 3D model loads in the lobby.
- **Tyre renders:** the real Porsche wheel with Pirelli lettering, rendered with a coloured sidewall band per compound, for the lobby and the pit box (the old CSS circles are gone).

## Slipstream, brake temperature, best-lap ghost, ambient occlusion

- **Slipstream and dirty air:** a car within 45 m ahead and about 2–3 m of your line cuts your drag by up to 25%, and, close behind, your downforce by up to 15%. Following cars lose both drag and downforce in a wake (Cranfield University; F1 CFD discussions). No GT3-specific figures were found, so the numbers are estimates. Applies to you and the bots, with a SLIPSTREAM indicator.
- **Brake discs:**
  - Temperature per disc: braking power heats it, airflow cools it.
  - Friction is best between 200 and 700 °C. Below 200 °C up to −14%; above 700 °C the brakes fade, down to −30%.
  - Calibrated with the lap simulator: front discs average ≈375 °C with a 578 °C peak on a lap from cold.
  - Shown as a dot on each wheel of the HUD instrument.
- **Best-lap ghost:** your best valid lap, recorded at 20 Hz and replayed by lap time as a translucent car, time-trial style (Settings → Best-lap ghost). Its model loads only once there is a best lap.
- **Ambient occlusion:** N8AO on High and Ultra, at half resolution with SMAA (its docs advise SMAA because hardware MSAA doesn't apply). It adds soft contact shadows in the cockpit, under the cars and along the barriers.

## Tyre temperature

One lumped temperature per tyre (`TYRE_TEMP` in `vehicle.ts`):

- **Heat:** sliding power (force × slip speed) plus rolling deformation.
- **Cooling:** airflow, proportional to speed.
- **Grip:** best around 90 °C. Up to −7% when cold (~35 °C off the grid) or very hot.
- **Calibration:** with the sim, so a pace lap ends the out lap at ≈70 °C front / 86 °C rear and settles at ≈80/100 °C.
- **Air temperature:** follows the time of day, cloud and rain.
- **HUD:** four small indicators: blue cold, green in the window, red overheating.

## Track limits, second version (fairer)

- **Report:** "too strict, sometimes not fair and not close to reality, specially on curves".
- **Causes:**
  - the limit came from the traced road widths, which in places stopped at an inner painted line, e.g. 2.3 m beside the pit-exit line at 500 m while the asphalt runs to 7 m;
  - the test used the car's centre with fixed allowances;
  - every excursion cost time.
- **Now:**
  - The limit is the **painted white edge line**, measured from the map's line meshes for every point and side (`tools/asset-pipeline/track_limits.mjs`): 99% painted at the Nürburgring, 96% at Zandvoort. It falls back to the paved edge + 0.5 m, with a ±40 m running median, and is never inside the old width.
  - A car is off only when **all four wheels** (their contact points) are more than 0.5 m beyond the line, i.e. kerbs can be used, for 0.4 s.
  - **No advantage, no penalty:** if the car loses more than 20% of its speed while off (grass, gravel), nothing is charged.
  - **Warnings first:** as in real races, the first 3 excursions of a session are warnings; after that 0.5 s + 1 s per second off, at most 3 s. Resets (5 s) and shortcuts (skipped checkpoints) are unchanged.
- AI laps on both circuits: no flags.

## Repairs, pit box

- **Dark cockpit:** dents recomputed the body's normals, which loses the authored hard edges and darkened the cabin; a repair restored the positions but recomputed the normals again. The original normals are now saved and restored exactly, and any bodywork repair resets the dents. Measured cockpit brightness: 60.1, dented 56.1, repaired 60.0.
- **Box markings:** they took their height from the collision, which the paint flattening had lowered a few cm, so they sank under the visible road. They are now placed on the visible road meshes.
- **Box detection:** the stop zone is the whole painted box plus 2 points of grace at each end, anywhere across the lane. After the menu is closed, moving even slowly (over 1.2 m/s) re-arms it.

## Solo offline

- "Play solo (offline)" runs the server's own room logic (`RoomCore`) in the browser (`apps/client/src/net/localRoom.ts`), behind a WebSocket look-alike: same protocol, rules, AI, briefing and race, with no network and no Cloudflare requests. Verified: 0 requests to the online server in a full session (`smoke.mjs --solo`).

## Race weekend (qualifying, then the race)

- The host picks the race in the lobby: qualifying only, or a race of 3, 5, 10 or 15 laps (default 5).
- After the qualifying results (20 s on screen with a countdown), the race loads automatically, gridded in qualifying order: pole in front, no-time drivers at the back.
- **Race rules** (`RaceTracker` race mode):
  - standing start, laps counted from the green light;
  - when the leader completes the distance, everyone finishes the lap they are on;
  - classification by laps, then finish time + penalties, then distance;
  - gaps on track estimated from the distance behind at the leader's average speed;
  - a pit stop during the race counts the lap (the pit lane passes the line).
- **HUD:** lap counter instead of the session clock; the board shows positions and gaps (+n LAP when lapped). AI cars all launch together; race results show race time, gap, best lap, laps and penalties.
- Cars still pass through each other, as in qualifying.

## Public rooms, live session list, spectators

- The host chooses public (listed; anyone can join or watch without the code) or private (code only, the default).
- Rooms report their summary to a small directory Durable Object only when something listed changes; the menu reads `GET /api/rooms` every 15 s while it is open.
- **Spectators:** they connect with `spectate: true`, take no car or slot (up to 30 per room), receive every broadcast and the car states, and survive hibernation. In the game they get a chase camera on any racer (←/→, 1–9), the board around that car, the clock and the minimap. Between sessions they see a waiting screen and the next session starts for them automatically. Any room can be watched with its code (Watch button).
- `node tools/e2e/spectate.mjs` checks it end to end.

## Time penalties instead of deleted laps

- **Request:** "don't erase or not count a lap time; if someone resets, penalise him by adding more time, and if he gets off the road too", with real-world sizes.
- **Real rules:** GT3 qualifying (SRO stewards' decisions) cancels a lap beyond track limits; F1 treats the white line as the limit (all four wheels over it) and in races gives warnings, then 5 s and 10 s penalties; the F1 games size corner-cutting penalties by the advantage (about 3 s for a small cut, 10 s for straight-lining a chicane).
- **Rule here:** every lap counts (except the untimed out lap and laps physically too fast to be real) and penalties are added to it (`PENALTY` in `packages/shared/src/race.ts`):
  - track limits (all four wheels beyond the line, held 0.25 s): 1 s + 1.5 s per second off, at most 5 s per excursion;
  - reset to the track: 5 s, on top of the time lost going back to the last checkpoint;
  - shortcut (checkpoints skipped): 5 s + 0.05 s per metre of track skipped.
- **Checkpoints:** gates every ~35 m used to be strictly in order, and a single missed gate (a cut, a rejected sample) froze the lap for the rest of the session: one reason times "did not update". Now a gate up to 300 m ahead is accepted when the car really is there along the track (a hairpin can put a later gate beside it); the gates in between count as a shortcut. A bigger jump is a teleport and gets no credit, as before.
- Shown in the HUD ("PEN +2.3 s" by the lap timer, included in the live delta), on the board and the timing screen (status and a Penalties column), in the lap message and the results. Protocol version 6.

## Briefing before the session

- **Request:** tyres, wing and the rest should be chosen after the weather, the track and the settings are revealed; otherwise only the host knows them.
- When the host starts, the room enters a `briefing` phase (30 s, `BRIEFING_MS`): the conditions are locked and shown resolved (the weather and time actually drawn, not "Random"), and each driver chooses tyres, rear wing and brake balance with the engineer's suggestion and the tyre guide. The session loads when every connected driver presses "Ready to go" or the timer runs out. The lobby only shows the session settings, with a note that the car is set up in the briefing.

## Interface language

- English or Spanish (Settings → "Language / Idioma"; first run follows the browser). `src/i18n.ts`: `t()` looks the English text up in the Spanish table and falls back to English, so a missing entry never breaks anything; `{name}` placeholders.
- Data labels (weather, tyre compounds, time of day, controls, engineer notes, wing settings) stay English in the data and are translated where they are shown, so switching applies at once: the menu and lobby are redrawn, race messages follow on their own.
- The strings were found with the TypeScript compiler (every string literal in the UI and game code), wrapped automatically where they had a dictionary entry, and the rest converted by hand. Code that compared display text (the HUD checked `startsWith('CHEQUERED')`) now compares the translated text.
- `node tools/e2e/spanish.mjs` plays in Spanish and lists any text without a Spanish entry.

## Ground holes in the map

- **Report:** "some things are not textured, and if you stay on them you fall below the map". The white areas were not untextured objects but holes: the 2022-layout source model has no ground where the old track was cut out, so the sky showed through, and there was no collision (`tools/sim/holes.ts`: 4627–4653 m and 4678–4848 m of the lap, 4–9 m left of the centreline). The satellite terrain also had a channel cut along the (unmodelled) Nordschleife, the "empty places" of the aerial cinematic.
- **Fix** (`tools/asset-pipeline/fill_holes.mjs`, run by the optimizer's collision step):
  - every drivable collision surface is rasterised onto a 2 m lattice up to 450 m from the centreline and the pit lane (cell centres and edge midpoints too, which catches cracks narrower than a cell); uncovered nodes are holes, their heights relaxed in from the ground around them;
  - each cell with a hole becomes a grass quad 12 cm below any surface it overlaps (never on top of road), in the collision and in `map_fill.glb` (the track's own grass texture): 23 ha;
  - the terrain's own holes are filled on a 20 m lattice with heights and satellite-photo coordinates relaxed in from the surrounding terrain, so the patch continues the photo seamlessly.
- Hole scan: from about 40 stretches to one sub-millimetre seam.

## Pit lane trace

- The traced pit entry wandered into the paddock (up to 89 m from the lane), so the minimap and the pit-lane markings were wrong there. The real lane was measured from the collision surfaces (`node tools/sim/pitlat.mjs`: surface types across the track with the trace overlaid): it leaves the track at ~4975 m, runs behind the pit wall 10–16 m left of the centreline, crosses the apron and reaches the garages. The optimizer rebuilds that part (`fixPitEntry`) and moves the service box in front of the garages (5190 m … 60 m, across the start line).

## Start and AI traffic

- At the green light every AI car launched side by side onto the same racing line; cars pass through each other here, so they visibly drove into each other ("the cars start bumping"). As in a real qualifying session, AI cars now leave the grid one at a time, 2.5 s apart in grid order, and keep about 12 m behind a car directly ahead in their lane (revised since: see "Start bumping, flat ground and AI traffic"). The grid itself was checked (`pnpm tsx tools/sim/gridsettle.ts`): slots are 11.4 m apart and cars settle within a few centimetres without bouncing.

## Timing board and session clock

- Checked in a 6-minute session with AI cars (`spanish.mjs`): the board shows each lap within seconds. Laps the AI lost to track limits were all in heavy rain; in the dry, `ailap.ts` and the browser run showed none.
- Drivers without a time show "–" instead of a position, in a stable order (they used to swap places as they passed each other on the out lap); the board also refreshes on status changes (out lap, invalid lap, pits).
- The clock reads "TIME LEFT 9:53", and at the green light a message explains the format: 10 minutes to set your best lap, out lap first.

## Tyre guide

- The lobby shows what each compound is for, with bars for dry grip, wet grip, life and warm-up computed from the same numbers the physics uses, and a note that tyres can be changed in the pit box.

## Map look

- Grass, terrain, sand and gravel get world-space macro variation (two octaves of smooth noise, tens of metres across, plus a dry/lush hue drift); asphalt and concrete a weaker version. It breaks the visible repetition of the small texture tiles, at the cost of a few shader instructions.

## Speed-sensitive keyboard steering

- **Report:** "the steering is way too brutal, turns are so pronounced at high speed", worse on some cars.
- **Measured** (`pnpm tsx tools/sim/steerresp.ts`, every car on a flat pad, keyboard tap of 0.35 s and a held key): at 250 km/h a tap reached the full grip limit, about 35°/s of yaw and 2.4 g, the same as holding the key. The Ferrari 296, Huracán GT3 Evo and AMG ONE also stepped the rear out by 8–10° of body slip on a held key. Steering lock and tyres are the same on every car; the spread comes from chassis balance.
- **Fix:** speed sensitivity, as in Assetto Corsa / ACC's "steering speed" and "speed sensitivity" options. Between 70 and 240 km/h the wheel turns slower (out rate 4.0 → 1.35 /s, return 5.5 → 3.2 /s), small inputs are finer (response curve exponent 1.5 → 2.1) and the slip target drops from 95% to 82% of the tyre's peak.
- **Result** at 250 km/h: a tap is now 10°/s and 0.7 g (a lane-change nudge). Holding the key still reaches about 2.4 g, so cornering speed is unchanged, and body slip drops to 3.5–6°. Low-speed steering (120 km/h) is almost unchanged.

## Racing-line assist

An option from F1 and Gran Turismo (Settings → Driving → Racing line: Off / Braking zones (default) / Full lap):
- **Line:** the bots' racing line, drawn on the road surface (heights from ground ray casts).
- **Colours:** red = brake, yellow = lift / mid-corner, green = throttle, from a speed profile for your car at 94% of its limit.

## Pre-race cinematic

TV-style intro, like the F1 and GT games (`apps/client/src/game/cinematic.ts`). It runs while drivers load and during the countdown, which is now 16 s (`COUNTDOWN_MS`):

1. **Aerial flyover** of the circuit:
   - a title card with length, turns, time, weather, track state, number of drivers and the session format;
   - the track map drawing itself (SVG) and the entry list.
   - For these shots the fog is thinned and the camera-centred rain is hidden.
2. **Grid pass:** a camera dolly down the middle of the grid from the back to pole, with a lower-third card for each car: position, name, YOU / AI, car.
3. **Cockpit:** the cut to your cockpit 4.2 s before the green light; the start lights take over.

It is timed against the server's start time, so it ends at the same moment for everyone. Enter, Space or Esc skips it, for you only. Ghost-car fading is off while it plays, so the cars on the grid look solid.

## Sound

Engines are real recordings; the rest is synthesized.
- **Why recordings now:** the player judged the synthesized engines "nowhere close to the real ones". Research turned up a licence-clean source: the free **Sonniss GDC Game Audio Bundles** (royalty-free, commercial use allowed, no attribution required). They contain onboard recordings by **Pole Position Production**, the studio that records engines for racing games, of engines close to the GT3 cars'. Free CC0 sources (Freesound, OpenGameArt) only had phone clips or generic loops.
- **Mixer:** one `AudioContext`, created on the first click or key press because browsers require a gesture. Buses for engines, effects and ambience go through a compressor, and each has a volume in Settings → Sound.

**Recorded engines** (`tools/asset-pipeline/engine_bank.py` → `public/assets/audio/engine_<bank>.bin/.json`, played by `SampleEngine` in `src/audio/engine-worklet.js`):
- Loop-based engine audio as in Forza, ACC or rFactor (Audiokinetic's "loop-based car engine design" articles describe it): constant-rpm loops every 350–425 rpm, separately for on-load (rpm rising under power) and off-load (overrun).
- The builder tracks the dominant engine order through the whole take (harmonic sum, then a Viterbi path so it never jumps an octave) and classifies load from the rpm slope. It time-warps the best moment so the rpm is exactly constant, cuts a whole number of engine cycles and crossfades end into start. Seams measured below one normal sample step, and every loop is strongly periodic at the expected order (autocorrelation 0.7–0.95).
- Playback is pitch-synchronous granular synthesis (TD-PSOLA). Each grain is two firing periods of a loop, re-fired at the target firing rate, so pitch follows rpm but the exhaust resonances stay put. That matters because the free takes only reach about 4,000 rpm (street drives), while the GT3 engines rev to 7,500–9,500. Plain speed-up would sound like a chipmunk. Bins are crossfaded per grain by error diffusion; on/off-load is an equal-power blend by throttle, with overrun at 55% level. A gear change's ignition cut drops to the overrun loop.
- **Banks** (cars with another cylinder count use the bank at the same firing frequency):

  | bank | recording (Pole Position Production, Sonniss GDC) | used by | range |
  |---|---|---|---|
  | `flat6` | Porsche 997 Cup 2012, onboard engine | Porsche 911 GT3 R ×2 | 1,000–4,000 |
  | `v10` | Audi R8 2017 (5.2 V10, the GT3 cars' engine), onboard engine | Lamborghini Huracán ×3, Audi R8 LMS | 1,000–3,900 |
  | `i6` | BMW M4 2014 (S55), onboard engine | BMW M4 GT3, M4 Touring | 1,000–4,400 |
  | `v8tt` | McLaren 570S (3.8 V8 biturbo), onboard exhaust | McLaren ×4 | 1,000–3,900 |
  | `v8f` | Ferrari 488 (3.9 V8 biturbo), onboard exhaust, steady rpm | Ferrari 296, AMG ONE | 1,000–3,800 |
  | `viper` | Dodge Viper GTS V10 race engine 2014, onboard exhaust, full rpm ramps | Mercedes-AMG GT3 ×3, Aston Martin Vantage | 1,200–6,000 |

  The AMG takes in the bundles (C63, AMG GT R) barely leave idle (under 1,800 rpm), so the AMG-engined cars use the Viper, the closest match to a big, thunderous naturally aspirated V8 and the only full-range take. A 996 GT3 Nürburgring lap (Pursuit Sound) was tried for the Porsches, but its engine orders were too ambiguous to pitch reliably, so it is not used.
- Each bank is normalised to the same full-throttle RMS on load. Per-car balance is `sampleGain`, matched to the old engine loudness (0.08–0.10 RMS on the rev sweep). The procedural engine stays underneath at 30% (`synthMix`) for the layout's firing pattern and the overrun pops, and it carries the sound alone until the bank has loaded or if loading fails.
- Size: 4.7 MB for six banks (int16 PCM, 48 kHz).
- `pnpm tsx tools/sim/engineaudio.ts` renders every car's rev sweep, recording plus procedural layer, to `tools/sim/out/<car>.wav` (`--synth` renders the old procedural-only sound to compare). Pitch tracking of the renders follows the rpm: for example the V10 measured 640 Hz at about 7,800 rpm, against 650 Hz expected.

**Procedural engine layer** (`src/audio/engine-worklet.js`, profiles in `src/audio/engineProfiles.ts`):
- An AudioWorklet runs a crank-angle clock. Each cylinder fires at its real angle into its exhaust bank's resonators.
- Firing frequency and harmonics come out of the model, plus half-orders when a bank fires twice in a row:
  - cross-plane V8 (Mercedes-AMG) burbles;
  - flat-plane V8 (McLaren) screams;
  - V10 (Audi/Lamborghini) howls;
  - flat-six (Porsche) rasps;
  - inline-six (BMW) is smooth;
  - 120° V6 (Ferrari 296, the F1-derived AMG ONE with a hybrid whine).
- Load sets pulse strength and brightness. Off-throttle at high rpm, the exhaust crackles. Gear changes cut the ignition for 55 ms.
- On top: turbo whistle and blow-off, and the straight-cut gearbox whine (loudest off-throttle).
- `pnpm tsx tools/sim/engineaudio.ts` renders a rev sweep of every engine to WAV and checks levels. Engines are normalised to within ±6% RMS. A Goertzel check confirmed the firing frequency dominates, and the cross-plane V8 has about 5× more crank-order energy than the flat-plane.
- A bug found that way: the crank advanced 720° per revolution, so every engine fired at twice the right frequency.

**Other cars:**
- The 4 nearest cars within earshot get positioned voices: distance attenuation, stereo pan relative to the active camera, and Doppler.
- Bots on the host use their real rpm and throttle. Remote players only send their pose, so their gear is estimated from speed and the car's gearing, and throttle from acceleration.

**Your car:**
- tyre squeal from slip beyond the tyre's peak;
- road roar;
- kerb rumble chopped at the stripe rate;
- gravel crunch and grass swish;
- wind rising with speed;
- rain on the car;
- impacts (thump plus crunch, scaled by the hit);
- shift clicks.

**Ambience:**
- wind in the trees;
- the crowd near the grandstands (start/finish straight and Mercedes Arena) with slow swells;
- birds by day when your engine is quiet;
- thunder in heavy rain.

**UI sounds:** start beeps (3-2-1 and GO), lap chimes (valid lap, personal best, fastest lap of the session) and an invalid-lap buzz.

**Insecure contexts:** AudioWorklet only exists on https or localhost. Opening the dev server through a LAN address (as Vite's "Network" URL does) left the game silent; that was the "sound is not working" report. Without the worklet the engines now run the same DSP in a ScriptProcessor on the main thread (2 other cars instead of 4), and every other sound no longer depends on the worklet. `GameAudio.level()` meters the output; the smoke test checks it is audible, over localhost and over the LAN URL.

**Performance:** audio parameters update at 30 Hz, and the worklet's filter coefficient is computed per 128-sample block. With 3 bots, frame rate with and without audio was within run-to-run noise (65 and 57 fps).

## HUD car status

The unlabeled coloured squares under the speed were replaced with a vector instrument (`src/ui/carStatus.ts`), bottom left:
- a top-down car whose four tyres are coloured by temperature (blue cold, light blue warming, green 75–105 °C, red hot), with the temperature in °C beside each;
- body zones (front, rear, left, right, engine) tinted yellow, orange or red by damage;
- ABS and traction-control lamps with their dashboard symbols, glowing amber while they work.

The windscreen rain was flat grey discs over the whole view. Now the drops are small lenses:
- mostly clear, with a bright lower crescent (refracted sky), a darker rim and a highlight;
- pushed up and stretched by the airflow, with faint streaks;
- only on the windscreen area.

## Multiplayer and hosting

**Server:** Cloudflare Workers plus one Durable Object per room, using the WebSocket Hibernation API, all on the free plan. Limits verified on 2026-10-16:

| Limit | Value |
|---|---|
| Durable Object requests | 100,000 per day |
| Duration | 13,000 GB-s per day |
| Incoming WebSocket messages | 20 count as 1 request |
| Outgoing messages | free |
| Hibernated idle time | free |
| Storage | SQLite-backed objects only, which the free plan requires (`new_sqlite_classes`) |

**Budget per race.** State is sampled at **20 Hz** and **two samples go in each packet (10 messages/s)**. That halves the billable request count without lowering the sample rate the interpolation uses.

- Messages: 12 players × ~10/s for a ~4–6 minute race ≈ 33–43k incoming messages.
- Races per day: **measured ≈1,645 requests per full 12-player race, so ≈60 races a day** on the free plan (`pnpm loadtest`). A friend group plays far fewer.
- Duration: well under 1% of the daily allowance.

The load test prints these numbers from a real run.

**Transport abstraction.** All room logic is in `apps/server/src/room.ts` (`RoomCore`), which knows nothing about Cloudflare. It talks to a `Conn` interface and a `RoomEnv` (clock, random, timers, persistence). The Durable Object adapter is ~150 lines. Another host (Fly.io, Deno Deploy, a Node `ws` server) would only need a new adapter.

**Rooms:**

- 5-character codes from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`. That excludes 0/O, 1/I and L, as the brief asks.
- The Worker allocates a code by asking the Durable Object with that name to initialise; it retries on collision.

**Joining:**

- If a race is running, newcomers join the room **waiting** and race next time. They see a clear notice, not an error. This combines the brief's "race in progress" message with "late joiners wait in the lobby".
- Nicknames are 2–16 characters after trimming and whitespace collapsing. Control, zero-width and bidi characters and `<>&"'` are removed. Uniqueness is case-insensitive.

**Car locks.** The Durable Object processes one message at a time, and `selectCar` is fully synchronous (check → release old → take new → broadcast), so two simultaneous requests can never both succeed. This is covered by a 50-trial test with 12 players sending shuffled, randomly delayed requests.

**Host and reconnects.**

- Host passes to the longest-connected remaining player when the host *leaves*: they clicked Leave, or their 30 s reconnect grace expired.
- A dropped connection keeps its slot, car lock and race progress for 30 s. The session token is in `sessionStorage`, per room.

**Race start.**

- The server picks the seed. Weather, time of day and the grid order (shuffled) all derive from it.
- Clients load, then send `loaded`. The countdown starts when everyone has loaded, or after 45 s regardless.
- `startAt` is in **server time**. Clients sync clocks NTP-style: 8 pings in a burst, then every 3 s; the offset is the median of the lowest-RTT half of the last 16 samples.

**Server-authoritative laps.** Clients never report checkpoints; they only send positions. The server:

- runs the shared `RaceTracker` on every sample and detects ordered gate crossings by segment/plane tests;
- requires all 73 other gates before the line counts as a lap;
- gives no credit for jumps above 115 m/s (teleports), and flags laps faster than `length / 75 m/s`;
- accepts resets only near the last passed checkpoint, and adds a 3 s penalty per reset.

Positions are laps plus distance along the centreline. Standings go out at 2 Hz.

**Finishing.** When the first car finishes, everyone else has 60 s; then they are DNF. Results go to everyone and the room returns to the lobby for a rematch with the same code.

**Binary state packet.** 37 bytes per sample:

| Field | Encoding | Bytes |
|---|---|---|
| Time | u32 ms | 4 |
| Position | int24 mm × 3 | 9 |
| Rotation | smallest-three quaternion, 2+3×10 bits | 4 |
| Velocity | int16 cm/s × 3 | 6 |
| Angular velocity | int16 mrad/s × 3 | 6 |
| Steer | int8 | 1 |
| Front and rear wheel angles | 2 × u8 | 2 |
| Suspension | 4 × u8 | 4 |
| Flags (brake, headlights, reverse, reset, handbrake, smoke) | u8 | 1 |

The server checks the length and type, then relays the packet with a 1-byte grid slot prefix.

**Remote cars:**

- **Interpolation:** 150 ms behind server time, Hermite position from the sent velocities, quaternion slerp, up to 250 ms of extrapolation.
- **Corrections** are absorbed by an error offset that decays with a 120 ms time constant, so nothing visibly pops. Errors over 12 m snap.
- **Ghost fading** uses `alphaHash` (dithered transparency, compiled up front). Cars fade below ~8 m from your eyes and never block the windshield.

**Background tabs.** The WebSocket stays open: keepalive is answered by the Durable Object's auto-response, which costs no duration. On return the client re-syncs its clock and clears remote buffers. The physics loop pauses with `requestAnimationFrame` and doesn't spiral (max 100 ms catch-up).

**Hibernation caveat.** Lobby state is persisted to Durable Object storage and survives hibernation. Race state lives in memory: during a race the object receives ~120 messages a second and never hibernates.

### Bots

The original brief said no bots; they were added later at the user's request.

- The host adds them in the lobby ("+ Add bot", ✕ to remove). The server gives each bot a random free car through the same atomic car lock, and a name (AI Nova, …). Bots are always ready and count towards the 12 drivers.
- **The host's browser simulates every bot**: a full `Vehicle` with the GT3 assists (ABS, high TC, stability) driven by `AiDriver` (`apps/client/src/game/ai.ts`). It streams their states at 20 Hz as `BIN_BOT_STATE` packets; the server accepts them only from the host, validates them with the same lap tracker and relays them like any player. The other clients can't tell a bot from a human.
- `AiDriver`:
  - **Line:** pure-pursuit steering along a **racing line**, a minimum-curvature path inside the track edges minus 2 m, found by coarse-to-fine smoothing, plus its own small lane offset.
  - **Speed:** a profile that includes downforce (v²κ = μ(g + k·v²)), with a braking pass that shares grip with cornering.
  - **Steering limit:** the same slip-angle limit as the keyboard driver; without it the AI spun at 90 km/h.
  - **Variety:** each bot gets its own skill and lane, derived from its grid slot.
  - **Recovery:** if it's stuck or far off track, it resets to its last passed gate like a player, which invalidates its lap. Bots are judged for track limits like players.
- If the host leaves mid-race, the bots are DNF. Host rights pass only to humans, and the room expires when no human is left.
- `pnpm tsx tools/sim/ailap.ts <car>` drives one lap per skill level on the real track and prints the theoretical lap too. All 18 cars finish lap 1 (standing start included) in 2:11–2:27 with no resets and no track-limit violations.

## Weather and time of day

`planWeather(seed)` picks the conditions:

- **Weather:** clear 28%, cloudy 22%, overcast 14%, light rain 15%, heavy rain 10%, fog 11%.
- **Start time:** uniformly from 06:15 to 21:30 (dawn to early night: never pitch black, after players couldn't see the track).
- **Date:** between May and September, which sets the sun path at Nürburg (50.33°N, CEST).
- **Mid-race change** (35% of races), e.g. clouds → rain or fog lifting.

`weatherAt(plan, t)` is a pure function, so every client computes identical conditions locally from the seed and race time; no weather messages are needed. Game time runs **6×** faster, so a 6-minute race moves the sun by 36 minutes.

**Visuals:**

- Preetham physical sky with sun position, stars, moon, and a procedural cloud dome whose cover follows the weather.
- Exponential fog from visibility.
- GPU rain streaks wrapped around the camera (no per-frame CPU work), stretched by the car's speed.
- Windshield droplets in the cockpit.
- Wet asphalt: darker, smoother, stronger reflections.
- A time-of-day reflection environment from the sky, regenerated only when the in-game hour moves by 45 minutes or more (normally never during a race), to avoid hitches.

**Night:**

- Your car has two real spotlights (shadows on High and Ultra).
- Remote cars get a cheap additive light pool on the road plus emissive head and tail lamps.
- Track lamps (emissive materials) brighten.
- Headlights switch on automatically at night, in fog, in heavy rain, and in dark overcast dusk.

## Graphics and performance

- **Presets** (Low/Medium/High/Ultra) control sun shadows (who casts and receives, map size and range), real headlight spot lights, reflections on the track, PBR or Lambert scenery, bloom, MSAA target, tree, scenery and detail draw distances, rain particle count and anisotropic filtering.
- **First launch:** the preset is guessed from the GPU name (`WEBGL_debug_renderer_info`). GTX 1650 and RX 570 get Medium; Iris Xe and AMD APUs get Low.
- **Resolution:** a scale slider, plus optional dynamic resolution (0.6–1.0, changes at most every 3 s, with hysteresis) to stay above ~45 fps.
- **Shadows:** one sun shadow map that follows the car and is snapped to texels. Cascades cost more draw calls than they give back on mid-range GPUs.
- **Culling:** the map is split into 320 m chunks, which three.js frustum-culls per mesh. Tree and scenery chunks are also distance-culled per preset.
- **Shader and texture warm-up** happens during loading: everything is made visible, every texture uploaded (`initTexture`), every program compiled (`compileAsync`), and one frame rendered, including shadow programs. Nothing compiles during the race.
- **Post-processing:** Low and Medium render straight to the natively multisampled canvas, with ACES tone mapping in the material shaders. High and Ultra add half-resolution bloom on a 4× MSAA half-float target.

### Cockpit glass and cabin fixes

- The Aston Martin's windscreen texture has the sun strip printed on it. From the seat it showed as a huge, fully lit, mirrored "MARTIN". Real ones read as a dark tinted band with faint reversed lettering, so your own car's glass is darkened while the camera is in the cockpit (`cockpitGlass` uniform). Face winding can't tell inside from outside, because several source models are mirrored; the camera position can. The chase view and other cars are unchanged.
- The BMW M4 Touring's cabin shell is an untextured light-grey material named `glassin`. It washed the cockpit view out white, so untextured opaque "glass" materials get a dark trim colour.
- The McLaren 650S's mirrored "BLANCPAIN" is printed on its roof-padding texture in the source model and is left as is.

### What the GPU profiling showed (`tools/e2e/profile.mjs`)

Measured in the real game on this machine's Radeon Vega (Ryzen 5000 iGPU, Iris-Xe class) at 1080p, through ANGLE/OpenGL, with the car parked on the grid looking down the pit straight. A synthetic three.js scene of similar size (680k triangles, 250 draws, shadowed sun light and an environment map) runs at 28 fps on the same GPU, which calibrates what it can do.

| Finding | Effect | Fix |
|---|---|---|
| Your car's two headlight **spot lights** are evaluated by every lit pixel, even at zero intensity | ~70% of the frame | Real spot lights only on High/Ultra; Low/Medium use a projected light pool on the road (as remote cars do) |
| **Environment map** on every material | ~2× | Reflections only on car materials; track surfaces get them on High/Ultra |
| Cockpit **glass** shaded as PBR layers covering the whole screen | ~20% | On Low/Medium it becomes a plain tint and the interior skips reflections |
| **Sun shadow sampling** on every surface | ~40% | Medium: only cars cast, only track and cars receive, 60 m range. Low: off |
| Every map material exported **double-sided** | ~15% | Opaque surfaces single-sided |
| Full PBR on scenery | small here, larger on weak GPUs | Lambert shading for everything but the road on Low/Medium |

Result on the iGPU at 1080p:

| Preset | Resolution | fps |
|---|---|---|
| Medium | 100% | 5 → ~16 (up to 41 in lighter views) |
| Low | 100% | ~25 |
| Low | 85% | ~35 |
| Low | 70% (what dynamic resolution settles on) | **~46** |

Those numbers were taken while Blender and texture encoders were also running. The final check (`node tools/e2e/smoke.mjs --gpu`, 8 s of driving at 1080p native on the same iGPU, machine otherwise idle):

| Preset | Average fps | 1% low |
|---|---|---|
| Low | **90** | 32 |
| Medium | **77** | 17 |
| High | 24 | — |

High is meant for discrete GPUs. A GTX 1650 or RX 570 is roughly 3–4× this iGPU, so Medium there should stay well above the 40–50 fps target. That is an extrapolation, not a measurement.

- **Auto-detection:** integrated GPUs (Intel Iris Xe/UHD, AMD Radeon/Vega APUs) start on Low; GTX/RX-class cards on Medium.
- **Long frames** on the iGPU are the renderer waiting for GPU command-buffer space. A Chrome trace shows it (`CommandBufferHelper::WaitForAvailableEntries`). Garbage collection maxes out at 13 ms, and no shader compiles during the race.

### Physics cost and CCD

Rapier's continuous collision detection (CCD) is **off**, for two reasons:
- **Speed lost:** against the track trimeshes it clamped every step's motion to a predicted "impact" with the road surface. At 200+ km/h the car covered only about half the distance its velocity said, a large hidden loss of speed that bot laps exposed (3:02 with CCD, 2:12 without, same car and line).
- **Cost:** it made each step about 30× more expensive (0.7 ms vs 0.02 ms per car).

At 120 Hz a car moves at most about 0.7 m per step, far less than its own size, so it can't tunnel through a wall. With 5 bots, physics costs 1.7 ms per frame instead of 24 ms.

## Testing and tooling

| Command | What it does |
|---|---|
| `pnpm test` | Vitest, 34 tests (see list below) |
| `pnpm tsx tools/sim/calibrate.ts [--write]` | Calibrates each car's drag area to its spec top speed |
| `pnpm loadtest` | 12 headless clients race a full 3-lap race against the real server: contested car lock, unique locks, synced countdown, server-validated laps, results; prints the free-tier request estimate |
| `pnpm tsx tools/sim/simtest.ts <car>` | Vehicle-dynamics numbers |
| `pnpm tsx tools/sim/ailap.ts <car>` | One AI lap on the real track per skill level; fails if a bot can't finish or needs more than two resets |
| `node tools/e2e/smoke.mjs [--gpu] [--bots N]` | Browser smoke test: Playwright Chromium (software WebGL, or the real GPU), from menu to race, optionally with bots; screenshots, fps and frame timings |

The unit tests cover:

- protocol round-trip and validation;
- quaternion compression;
- room codes and nicknames;
- clock-sync math;
- weather determinism;
- lap validation, shortcuts, teleports and reset rules;
- the qualifying format (out lap, best valid lap order, track-limit and reset invalidation);
- standings order;
- the car-lock race condition;
- host transfer, reconnection and late joiners;
- bots: host-only add/remove, free-car lock, and bot state packets accepted only from the host.

More tools: `pnpm tsx tools/sim/flatness.ts` (every ground layer under the road: bumps, steps and stacked surfaces per stretch; `--profile s0,s1,lat`, `--xprofile s,l0,l1`), `node tools/e2e/botrace.mjs [--bots 7] [--minutes 3] [--weather heavy_rain]` (bots in a real browser session: laps, resets, spins, offs, launch, overlapping cars), `node tools/e2e/cockpitlab.mjs [--cars 0,3]` (each car's cockpit from several eye positions), `node tools/e2e/lapviews.mjs` (the lap at driver height and from the air, with a z-fighting measure).

## Start bumping, flat ground and AI traffic (2026-10-18)

### "At the start the cars are bumping" / "the terrain is not flat"

- **Cause 1, the ground:** the painted lines and the grid-box bars are separate meshes laid 1–7 cm above the asphalt, and since the collision fix they are collidable (as asphalt, because the asphalt has gaps under some of them). On the start/finish straight every grid-box bar was a **6.7 cm ledge**, one every 16 m in each lane: a car leaving its box hit the bar 1.4 m ahead of its front wheels at once (a 39 m/s², 4 g heave spike in `ailap.ts`), and every car hopped every 16 m down the straight. Edge lines were 1.2 cm steps, and long painted slivers crossing crests floated up to 7 cm over the road (a bot's front wheels left the ground in the Veedol chicane at 85 km/h).
- **Fix** (`tools/asset-pipeline/flatten_layers.mjs`, called by the optimizer's collision step before simplification and the hole fill): a vertex of a ground surface that lies 3 mm–15 cm above another triangle of the *same* surface (with that lower surface continuing 2 cm around it in at least 6 of 8 directions, so the top of a real raised edge stays) is snapped down onto it; triangles that still float over one at 5 of 7 sample points are dropped. Kerbs over asphalt and road over the hole fill keep their real steps. 15,334 asphalt, 8,078 grass and 1,668 sand vertices snapped; 1,452 / 7,885 / 337 triangles dropped. The render meshes are unchanged (the raised paint is what keeps it from z-fighting).
- **Cause 2, the spawn:** cars were placed 5 cm above the grid point and dropped onto their springs during the countdown. `Vehicle.place()` now casts down and puts the car on the ground under it (grid, resets, bot resets); the session builds the ray-cast structure before placing.
- **Cause 3, the bots:** at the green light each AI car steered at full lock straight for the racing line, across the grid, through the cars still waiting in their boxes. Bots now hold the line they stand on and merge onto their racing line over 260 m (also after a reset).
- **Measured** (`tools/sim/flatness.ts` on the road surface; `ailap.ts` ride numbers, Porsche 992):

  | | before | after |
  |---|---|---|
  | Start/finish straight (5,000 → 260 m): steps over 1 cm, largest bump | ~650 steps, 6.2 cm | 0, 0.3 cm |
  | Whole lap: steps over 1 cm / stacked layers / median bump | 3,580 / 1.2 % / 0.9 cm | 2,219 / 0.5 % / 0.6 cm |
  | 50 m stretches with a bump over 3 cm | 22 of 105 | 9 of 105 |
  | Launch from the grid: largest heave in the first 6 s | 39 m/s² | 2.8 m/s² |
  | Lap: heave rms / max, wheel lift-offs | 1.84 / 58 m/s², 14 | 1.47 / 10 m/s², 2 |
  | Grid settle (`gridsettle.ts`): max vertical speed | 0.10–0.60 m/s | 0.12–0.18 m/s |

- **Left:** a 10 cm twist seam between two road pieces at 3,353 m (the cross-slope changes at a mesh border; near the crown, where the line crosses it, it is under 2 cm), the kerbs of the Mercedes Arena and the Veedol chicane (real raised kerbs), and the hole-fill edges beside the road at 4,600–4,900 m. The grass collision simplification (`SIMPLIFY_ERR`) was left alone: none of the remaining bumps over 3 cm is on simplified grass.

### AI traffic, the wet and spins

Found with `ailap.ts` (now `--laps`, `--wet`, `--slot`, spins and wall contacts) and in real browser sessions (`botrace.mjs`: 7–9 bots for 3–5 minutes, your car parked in its box):
- **Wet:** rear wet tyres ran away past 200 °C and bots spun 14–43 times a lap at wetness 0.5. Water on the track now cools the tyres (`TYRE_TEMP.wetCool`: up to 2.5× on a fully wet track, so wets sit near their 65 °C window and slicks stay cold in the rain, as in reality). The AI's grip estimate includes tyre temperature (`Vehicle.tyreGripAvg`, the weaker axle), and it keeps more in hand on a slippery track (0.8 grip → 7 % more margin).
- **Driving:** it eases to a balancing throttle instead of snapping it shut mid-corner (lift-off oversteer), squeezes the throttle on (0 → full in 0.25 s), backs off as the rear axle's slip angle passes 60 % of the tyre's peak, counter-steers once the rear lets go, trail-brakes (less brake with more lock, off the brake while sliding), and takes corners slower in another car's dirty air. A wrong-way bot resets after 3 s.
- **Lanes:** each bot's own lane offset (now ±0.9 m, was ±1.8 m) only applies on straights and moves back onto the racing line before a corner. A Ferrari 296 driving 1.8 m off the line through corners overheated its rear tyres and spun 34 times in 3 laps with the old AI.
- **Traffic:** a slow or parked car ahead (your car still in its box, a car that spun) made bots queue 12 m behind it and then reset. Now they pull out 3.6 m and pass when there is no corner within 150 m, keep that side while alongside, and otherwise follow about 10 m back (a car 0–3 m ahead used to be ignored, so bodies overlapped).
- **Results:** `ailap.ts`, 18 cars × dry / damp (0.6) / wet × skill 0.88 and 0.97 × 2 laps: no spins, resets, wall contacts or track-limit violations; flying laps 2:11.8 (McLaren 720S) to 2:24 (AMG ONE) at 0.97 in the dry, 2:26–2:40 fully wet. With lanes (grid slots 2 and 5), skill 0.97, dry and wet, 3 laps: 71 of 72 runs clean. Browser, heavy rain, 7 bots, 4 min: 10 spins, 4 offs and 1 reset before; 0 / 0 / 0 after. Dry, 9 bots, 5 min: no spins, offs or resets; overlapping car bodies 0–30 samples of ~1,100.
- **Pace** is unchanged (2:12–2:13 for the Porsche at 0.97 on a flying lap); the out lap is ~1 s slower because the bots now respect cold tyres. Robustness came first: the 2:07 quasi-steady limit and the ~1:54 real pole remain open.
- **Left:** at a forced skill of 0.97 the Ferrari 296 Challenge (more power, less grip) still overheats its rear tyres by the third lap and spins in some lanes. Bots still don't pit.

### Cockpit eye per car

- **Checked** every car from several eye positions (`cockpitlab.mjs`: one solo race per car, views side by side, wheel position and headroom printed) against what GT3 onboard (helmet) footage shows: the top of the wheel rim and the display in the lower third, the dash across, the windscreen clear, the roof or cage bar at the top edge, the A-pillar to the left.
- **Found:** the automatic raise (`autoSeat`, up to 14 cm so the road shows over the dash) had lifted the Audi and BMW M4 GT3 eyes 12 cm, the Audi's to 9 cm under the roof (the cage filled the view); the McLaren 650S eye sat 6 cm under the roof and ahead of its wheel; several eyes were 8 cm inboard of the wheel (Porsche, AMG, Ferrari, 720S); the Aston, 650S and BMW Touring eyes were too far forward to see a wheel. The Huracán EVO2 Iron Lynx and McLaren 720S LMGT3 were flagged "no interior", so a generated dash wheel was drawn over their real one. The Aston Martin's interior has no wheel rim (the column ends in a bare hub).
- **Fix:** `cars.config.json → pipeline.cockpitEye` per car (applied by `optimize.mjs`, and to `cars.json`; marked `tuned`, so there is no automatic raise), mostly 0.35–0.45 m behind and 0.25–0.30 m above the wheel centre and in line with it; cars with a low cage bar sit a little lower to keep it at the top edge. `pipeline.hasInterior` corrects the two cars above; `pipeline.steering` gives the Aston a generated GT3 wheel (rim, grips, display) that turns with the steering. The field of view stays 72° vertical (the Settings default); the seat height and position settings still offset the eye. This supersedes `pipeline.cockpitOffset` (still read by the Blender step).
- **Left:** the McLaren 720S's mirrored "BLANCPAIN" sun strip is part of its roof texture; the BMW M3 Touring's interior is one dark atlas.

### Render audit

`lapviews.mjs` (the lap every 100 m at driver height and every 400 m from the air, plus two renders 2 mm apart to catch z-fighting): no holes or z-fighting (at most 0.4 % of pixels change between the two renders, distant shimmer). Fixed: one grass material exported fully metallic (a dark mirror on High/Ultra), and the main racing asphalt (`asph_003`) at roughness 0.80 against 0.90 for the rest, which drew a wet-looking glare lobe down every straight towards the sun on a dry track. Not changed: darker new-asphalt patches (source model), sparse trees from the air (distance culling by preset).

Frame rate (`smoke.mjs --gpu --bots 5`, 1080p, this machine's iGPU, shared with another session): Medium 37.6 / 35.8 fps before, 36.0 / 33.3 after; High 13.5 / 13.1 before, 13.3 / 13.0 after: within run-to-run noise.

## Mobile app (2026-10-20)

The request: a real installable app for phones, while the website stays desktop-only, with an install button for phone visitors.

### Shape: Capacitor around the same game

- **One code base.** `apps/mobile` is a Capacitor 8 project (`app.apexghost.racing`, "APEX GHOST") that wraps the `apps/client` build. Everything app-specific in the client lives in `apps/client/src/mobile/*` and is switched on by `IS_APP` (`mobile/platform.ts`): the `app` Vite mode (`.env.app`: `VITE_APP=1`), the Capacitor bridge, or `?app=1` in dev (for Playwright).
- **Website:** unchanged on desktop except a small "Get the mobile app" button in the menu footer (a dialog with a QR code of the APK link and a download button). On a phone the website still refuses to run the game: the "Desktop only" page now has a big **Install the app** button (the APK) and a line about iOS.
- **Why Capacitor, not a PWA or a native rewrite:** the game is WebGL 2 + WASM (Rapier) + AudioWorklet, which the Android System WebView runs as Chrome does; a native port would be a second game. A PWA can't be "installed from a button" reliably on all Android browsers and still lives in the browser's chrome. Capacitor gives an APK with full-screen immersive mode, a locked landscape orientation, keep-screen-on and the back button.

### Assets: loaded from the website, cached on the phone

The `public/assets` folder is ~200 MB (cars 156 MB, maps 44 MB, sounds 5 MB). Bundling it would make a ~210 MB APK that can't be served from the Vercel site (the deploy is already near the limits) and that has to be re-downloaded for every code change.

Decision: the APK holds only the code, the Basis transcoder and the menu photos (~6 MB of web files; **9.2 MB APK**). Cars, maps, layouts and engine banks come from `https://apex-ghost-liard.vercel.app/assets/…` (`VITE_ASSET_BASE`; Vercel already answers with `Access-Control-Allow-Origin: *`). A player downloads only the car and map they use (~25-40 MB for a first race).

`mobile/assetCache.ts` keeps every downloaded file in Cache Storage: versioned files (`?v=` in the asset JSONs, i.e. models, collision, textures) are cache-first and old versions of the same file are pruned; the unversioned JSONs and engine banks are network-first with the cached copy as fallback. Result: after one race on a car and map, **solo offline** works without any network (the room logic already runs in the page, `net/localRoom.ts`). Trade-offs:

- the first race on a map needs a connection (and mobile data);
- the app reads the *live* website's car list and tracks. If the asset format changes, deploy the website first, then rebuild the APK (the same order as today for the server protocol);
- Google Fonts are not bundled: offline, the UI falls back to system fonts.

### Server

Unchanged. The Worker already sends `Access-Control-Allow-Origin: *` on the HTTP API, and WebSocket upgrades don't check `Origin`, so the app's origin (`https://localhost`, Capacitor's `androidScheme: https`) works as is. The app build points at `https://apex-ghost-server.ilmas.workers.dev`.

### Touch controls (`mobile/touchControls.ts`)

- **Hooked into the existing input path, not into the session.** Steering, throttle and brake write `touchInput` in `physics/input.ts`; `InputSmoother` merges it with the keys (max of pedals, keys win for steering), with the same throttle/brake swap when reversing. The buttons press the bound keys with synthetic `KeyboardEvent`s (gear up/down, manual/auto, look back, reset, pause, timing screen, handbrake, and Enter to skip the intro), so `session.ts` and `app.ts` needed no changes for driving. The overlay shows itself when a `.race-ui` is on screen (polled every 200 ms) and hides the driving controls in the intro, the pit box menu and spectator mode (which gets ◀ ▶ to change the watched car).
- **Safety at speed.** Touch values stay on the *keyboard* path (`Controls.digital = true`) but may be fractional: `KeyboardDriver.step` already treats its targets as numbers, so tilt and slide steering get the keyboard's rate limits, the speed-sensitive response (slower wheel and gamma 1.5 → 2.1 above 70 km/h) and, above all, the slip-based limit (±1 = ~82-95 % of the front tyres' peak slip, not full lock). The bots' analog path (`digital = false`, fraction of the mechanical lock) was not used: at 250 km/h a full tilt would be full lock, i.e. a spin.
- **Steering modes** (Settings → Touch controls, replacing the key bindings in the app): *Arrow buttons* (one pad, the left and right halves; a thumb can slide across; same targets as A/D), *Slide* (analog: drag from where the thumb lands, a third of the pad is full lock), *Tilt the phone* (accelerometer). Tilt uses `devicemotion` gravity rotated into screen axes with `screen.orientation.angle`, then the lean of the screen's horizontal axis, `atan2(sx, hypot(sy, z))`, which stays stable whether the phone is upright or tipped back; a light low-pass, a 1.5° dead zone, and full lock at 28° (adjustable 12-50°, plus an invert switch). In tilt mode the brake moves under the left thumb.
- **Layout:** pedals bottom-right (brake left of the tall throttle), steering bottom-left, gears (manual only) and handbrake above the pedals, a top bar with pause, timing (hold), look back (hold), reset and AUTO/MAN, arranged around the session clock. Button size and opacity are settings; short vibrations on taps (`VIBRATE` permission).
- **HUD:** only CSS under `html.mobile-app` (`mobile/mobile.css`): smaller corners, the track map moved up on the right, the car status and the timing tower stacked on the left above the steering pad, safe-area insets everywhere (`viewport-fit=cover`, the activity draws under the notch). Menus, lobby and dialogs get a denser type scale and scroll in a 360-412 px tall landscape screen. The desktop stylesheet is untouched.
- **Back button** (`@capacitor/app`): closes an open dialog, pauses a race, leaves a lobby or the results, and exits from the main menu.

### Phone graphics

The app replaces the *Low* preset in place (`mobile/appShell.ts`) and starts on it on first launch: render scale 0.9 of a 1.25 pixel-ratio cap (≈ 1050×470 on a 915×412 phone), car-only sun shadows on a 1024 map within 35 m, no AO, no bloom, no scenery PBR, the standard car model in the cockpit (`cockpitDetail: false`, not the high-detail interior: ~3-6 MB less to download and much less GPU memory), shorter tree/scenery/detail distances, 2× anisotropy, a 64 px reflection map, fewer rain drops, dynamic resolution on, TC high. *Medium* is retuned for flagship phones. Textures stay KTX2/Basis, which phones transcode to ASTC or ETC2, so they stay compressed in GPU memory.

### Distribution

- **APK on the website:** `apps/client/public/downloads/apex-ghost.apk`, served at `https://apex-ghost-liard.vercel.app/downloads/apex-ghost.apk` with the APK MIME type, `Content-Disposition: attachment` and no long-term caching (`vercel.json`). A GitHub release was not used: the repository is private, so its download links need a GitHub login. The APK is committed (9 MB) so a deploy from any checkout carries it.
- **Signing:** a 4096-bit RSA key in `~/.android-keys/apex-ghost-release.jks`, its passwords in `~/.android-keys/apex-ghost-release.properties` (both mode 600, outside the repository, never committed). `android/app/build.gradle` reads the properties file (or `APEX_KEYSTORE_PROPS`). **Back it up**: an update signed with another key can't be installed over the old app. `versionCode` is the UTC build hour (`yymmddHH`) so every build installs over the previous one.
- **minSdk 24 (Android 7)**, target/compile SDK 36. Requires OpenGL ES 3 (WebGL 2) and an up-to-date Android System WebView.
- **iOS:** `apps/mobile/ios` is generated (Swift Package Manager, icons and splash) but can't be built on this Linux machine: it needs a Mac with Xcode and an Apple developer account (and TestFlight or the App Store to distribute; sideloading isn't practical). The website says so.
- **Icon and splash:** generated from the favicon's red "A" chevron with a translucent ghost copy behind it, and the in-engine photo of the grid with the word mark (`apps/mobile/scripts/make-icons.mjs`).

### Not done / limits

- Not tested on a real phone. Tested in Playwright on a Pixel 7 landscape profile with touch events (`tools/e2e/mobile.mjs`), the built app bundle against the live website's assets, and the APK in an Android 14 emulator (software rendering).
- No gamepad support yet (the Gamepad API would work in the WebView).
- Pre-existing, not from this change: in a solo race the local room logs one "Malformed message." toast right after the countdown, on desktop as well (seen at 7c488cc).

## Known limitations

- Frame rate was measured only on this machine's integrated Radeon: 90 fps on Low and 77 fps on Medium at native 1080p. Medium's 1% lows (~17 fps) show occasional GPU stalls in heavy views on an iGPU, which is why integrated GPUs default to Low. The figures for GTX 1650 and RX 570 are extrapolated. Please check with the perf overlay (Settings → Performance overlay) on your machines; dynamic resolution keeps fps up if a GPU is slower than expected.
- The pit lane isn't part of the race route: the gates are as wide as the track plus run-off. Driving through the pits misses a gate, so you have to rejoin the track behind it. There are no pit stops anyway.
- `lamborghini_huracan_gt3_evo` has no textures in its source, so it is white, and its rear wheels are the generic fallback.
- Some source cars have no separate steering-wheel mesh: 8 of 18 keep a static modelled wheel in the interior.
- A start after 21:00 is a dusk/night race. Lighting was raised so the track stays readable, and headlights and track lamps help.
- Bots run on the host's computer, so a slow host makes for slower bot updates for everyone (about 0.1 ms of CPU per bot per physics step).

## Game controller support (website)

- Gamepad API, "standard" mapping (Xbox, PlayStation, Switch Pro, most USB pads). It plugs into the existing
  input path like the touch controls: analog values in `padInput`, buttons as synthetic key presses of the bound
  keys, so rebinding the keys also moves the pad's buttons to the new keys.
- Layout: RT/LT throttle/brake, left stick steer, A handbrake (and skip intro), RB/B shift up, LB/X shift down,
  Y/R3 look back, right stick look left/right, D-pad ↑ reset / ↓ gearbox, View timing, Menu pause. While
  spectating, LB/RB or ←/→ change car.
- Menus are driven with the pad too: D-pad / stick moves the focus spatially, A presses, B = Esc, ←/→ change a
  dropdown or slider.
- Steering uses a separate analog profile in the physics-step filter (fast rate limit, slip-based limit, no double
  curve, near-direct triggers). Research and numbers: docs/CONTROLLER_STEERING_RESEARCH.md. Tunable in
  Settings → Controller (curve, steering speed, speed sensitivity, dead zone, brake curve, vibration).
- Controllers the browser reports without the standard layout (e.g. Switch Pro clones on Linux: 14 buttons in kernel
  order, D-pad on a hat, digital ZL/ZR) go through input/padMap.ts: the player's own layout from Settings →
  Controller → "Set up buttons…" (learned per pad, buttons or axes, triggers resting at −1 included) wins, then the
  browser's standard layout, then a built-in Switch Pro-on-Linux layout, then raw indices. The live view in the same
  section shows what the browser reads. The pad in use is the plausible one (sticks + ≥ 6 buttons) touched last, so
  a keyboard's "joystick" interface (listed by browsers on Linux) never steals the input.
