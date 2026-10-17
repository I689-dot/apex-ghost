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

## Known limitations

- Frame rate was measured only on this machine's integrated Radeon: 90 fps on Low and 77 fps on Medium at native 1080p. Medium's 1% lows (~17 fps) show occasional GPU stalls in heavy views on an iGPU, which is why integrated GPUs default to Low. The figures for GTX 1650 and RX 570 are extrapolated. Please check with the perf overlay (Settings → Performance overlay) on your machines; dynamic resolution keeps fps up if a GPU is slower than expected.
- The pit lane isn't part of the race route: the gates are as wide as the track plus run-off. Driving through the pits misses a gate, so you have to rejoin the track behind it. There are no pit stops anyway.
- `lamborghini_huracan_gt3_evo` has no textures in its source, so it is white, and its rear wheels are the generic fallback.
- Some source cars have no separate steering-wheel mesh: 8 of 18 keep a static modelled wheel in the interior.
- A start after 21:00 is a dusk/night race. Lighting was raised so the track stays readable, and headlights and track lamps help.
- Bots run on the host's computer, so a slow host makes for slower bot updates for everyone (about 0.1 ms of CPU per bot per physics step).
