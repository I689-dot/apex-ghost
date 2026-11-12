# Spa rebuild, milestone 6: the new cars

The nine models in `RESOURCES/CAR-MODELS` replace the car line-up of the Godot app. Each takes the id, physics, engine
sound and bot setup of an existing car, so saved setups, records and the bots carry over. The Aston Martin Vantage GT3
stays as it was. The safety car is now that Vantage in green with a roof light bar. The models are for this private game
only (`godot/assets_credits.md`).

## Line-up

| id | car | lod0 (own car) | lod1 (others, near) | lod2 (others, far) |
|---|---|---|---|---|
| `vantage_gt3_evo_heart_of_racing` | Aston Martin Vantage GT3 (unchanged) | 135k | 70k | 18k |
| `2020_audi_r8_lms_evo` | Audi R8 LMS Evo | 336k | 336k | 80k |
| `2020_mclaren_720s_gt3` | McLaren 720S GT3 | 473k | 405k | 81k |
| `2024_porsche_992_gt3_r` | Porsche 911 GT3 R (992) | 489k | 403k | 81k |
| `bmw_m4_gt3_evo_2026` | BMW M4 GT3 Evo | 701k | 402k | 80k |
| `bmw_m4_gt3_vecarz` | BMW M4 GT3 | 2,561k | 400k | 107k |
| `ferrari_296_gt3_verstappen` | Ferrari 296 GT3 | 412k | 412k | 81k |
| `ford_mustang_gt3` | Ford Mustang GT3 | 597k | 402k | 80k |
| `mercedes_amg_gt3_evo` | Mercedes-AMG GT3 Evo | 496k | 401k | 81k |
| `mercedes_amg_gt3_red_bull_racing` | Mercedes-AMG GT3 Evo · NASA | 302k | 302k | 81k |
| `aston_martin_vantage_safety_car` | the Vantage, safety car look | | | |

Triangles per model. Each model has 20-85 draws (one per material within each moving part). The 16 cars that are gone
resolve to a new one through `CarsDb.FALLBACK` (old settings, replays and online rooms that name them), and anything
unknown resolves to the Vantage.

## Pipeline

`tools/godot/build-cars.py <unzipped CAR-MODELS dir>` builds every car, writes `godot/data/cars.json` and installs the
models into the git-ignored `godot/assets/cars/`:

1. `tools/godot/car_prep.py` (Blender):
   - gives generic material names back their real ones (the pipeline finds glass, lights and interior by name);
   - names the objects of anonymous Sketchfab exports by their material ("Tyre", "Rim", ...);
   - puts on the livery that three zips ship as a separate texture (Audi, Porsche, NASA AMG, all three stored upside
     down);
   - applies the Ferrari's mirrored transforms with its normals turned the right way;
   - turns the Ferrari, placed at 143° in its scene, back along the axles.
2. `tools/asset-pipeline/convert_car.py` (the web game's converter, used read-only) sets scale, axes, wheel nodes and
   pivots.
3. `tools/godot/car-lods.mjs` builds cockpit / lod0 (the source, nothing simplified, 4K colour), lod1 (≤ 400k with the
   cabin) and lod2 (≤ 80k, no cabin, 1K).
   - It joins primitives per material within each named part, from 60-90 draws a car down to 20-85.
   - It renames the steering wheel to `steering_rim`. Godot's importer turns a node ending in `_wheel` into a
     VehicleWheel3D, so the wheel stopped turning and the Ferrari's disappeared.
4. Godot's generated mesh LODs are switched off for these files (`patch_imports`). Together with the earlier 300k/60k
   cut, they caused the faceted curves that were reported.

The cockpit eye is set per car (`eye` in build-cars.py, checked with `tests/cockpit_probe.gd`) and marked `tuned`, so
the camera's automatic lift no longer pushes it into the roof.

## In the game

- **Interiors**: `InteriorLook.apply_generic` darkens carbon and occlusion surfaces that render too bright.
- **Live screens**: `DashDisplay` finds display materials by name. Overlays placed per model cover the models where the
  screen is just a face of the dash: the Vantage, and the Ferrari's Bosch dash plus its two side screens. A dash
  surface on a merged mesh gets a hidden material instead of hiding the whole mesh (this had hidden the Porsche's body).
- **Safety car**: `SafetyCarLook` turns the Vantage's livery green by brightness, so lettering and stripes stay white
  (`shaders/safety_paint.gdshader`). Six amber lamps on the roof bar flash in two halves while the car is deployed.

## Performance (PC, RX 7600 XT, 2560×1440 Ultra, Spa)

| scene | avg fps | 1 % low |
|---|---|---|
| no bots | 67 | 40 |
| 11 bots, full-detail cars | 41.3 | 15.3 |

With a full grid the frame is CPU-bound: about 24 ms of process time, 9 ms of it physics, and about 2,900 draws. The
user chose full detail everywhere and accepted about 40 fps with full grids (option B). M7 cuts the bots' physics cost,
which is the larger share.

## Check-in images

Outside and cockpit images of every car at Spa (outside the repo): `~/apex-ghost-sources/cmp/m6_out_sheet.jpg` and
`m6_cock_sheet.jpg`, one image per car beside them.

## Not done yet

- The BMW M4 (vecarz) far model stays at 107k: its 17 large surfaces stop the simplifier above the 80k budget.
- The phone has not been measured with these models yet (M7, with the APK).
