# Job: an Assetto-Corsa-class Spa and a new car line-up for the Godot app

Paste this whole file to Claude Code in the APEX GHOST repo. The reference video, the Spa model and the car models are
already in the repo under `RESOURCES/` (see "Inputs"); attaching them again is not needed.

---

You are working on APEX GHOST, a multiplayer GT3 sim racer. This job is for the **Godot app only** (`godot/`), which runs
on **PC and Android phones**. Read your memory index first (MEMORY.md and the files it links), especially
`godot-only-scope`, `godot-test-setup`, `godot-render-tests-open-windows`, `apex-ghost-code-conventions` and
`apex-ghost-feature-workflow`. `godot/README.md`, `godot/MIGRATION.md` and `DECISIONS.md` describe how the game is built.

The job has two parts:

1. **Rebuild Spa-Francorchamps** from the new source model so that it **looks like Assetto Corsa Competizione (ACC)
   in the reference video, as closely as possible**. The video is the target for every visual choice: colours, light,
   trees, terrain, trackside detail. When the source model and the video disagree on looks, the video wins (see
   "Matching the video"). Spa is **separate from the other maps**: its own pipeline, materials and quality settings.
   The Nürburgring, Nordschleife and Zandvoort must not change.
2. **Replace the car line-up** with the high-quality models in `RESOURCES/CAR-MODELS`, keeping their quality.

Work in milestones (below). Stop and show me results at the check-ins.

## Hardware

- PC: Linux, 12 threads, 16 GB RAM, and a new **AMD Radeon RX 7600 XT (16 GB)** replacing the Intel UHD 630 the game
  was tuned on so far. Check that Godot uses the Radeon through Vulkan (the startup log names the device) before
  measuring anything.
- Phone: Pixel 10a, the reference device. I install and test the APK myself. If the Android SDK is not set up on this
  machine, tell me what to install, or hand me the export and I build the APK.

## Inputs

All under `RESOURCES/`, which is **not committed**. Add `RESOURCES/` to `.gitignore` as your first change: it holds
779 MB of archives. Extract archives into a new empty folder outside the repo or in the scratchpad, never over the
repo. Read every file before using it.

- **Spa model:** `RESOURCES/CIRCUIT-MODELS/circuit-de-spa-francorchamps-2022-layout.zip` holds `source/spa.glb`
  (84 MB) and about 80 textures, some up to 19 MB (asphalt, kerbs, grass, run-off, trees, barriers, buildings, flags,
  start lights, banners). **Build Spa from this model, not from the one now in the game.** The current game Spa comes
  from `3DMODELS/Circuit_de_Spa-Francorchamps_2022_layout.usdz` (`tools/asset-pipeline/maps/spa.json`), which has
  known faults. For example, two road layers disagree by up to 35 cm before turn 9 (3.24–3.30 km), patched with
  `smoothRoad`. Check whether the new model has the same faults instead of carrying the patches over.
- **Reference video:** `RESOURCES/VIDEOS/BMW M4 GT3 ｜ SPA 2.16.4 ｜ HOTLAP + FREE SETUP ｜ ACC v1.9 [4426Dce3wNs].mkv`
  (2560×1440, 60 fps, AV1). **Use only 00:02:39.066 to 00:04:51.066.** That part is one full lap as a replay from the
  chase camera, in sunny afternoon light. It fades in at the start. The HUD (standings top-left, gauge bottom-right) is
  not part of the look. The rest of the video is the cockpit view and menus: ignore it.
  - ACC's own files must not be extracted or used. The video is a visual reference only.
  - Pull frames with ffmpeg, for example `ffmpeg -ss 175 -i "<video>" -frames:v 1 f.png`.
  - Build a table of video time → lap distance → corner name, so that every comparison can be made at the same spot.
- **Car models:** nine zips in `RESOURCES/CAR-MODELS/`, each with `source/` and `textures/`. Two hold their model inside
  another archive: `bmw-m4-gt3.zip` has a `.7z`, `ford-mustang-gt3-2024.zip` a `.zip`. Several come from vecarz.com and
  Sketchfab. Keep them to this private game; do not publish them anywhere else.

## Decisions already made (don't ask again)

- **Target:** PC and phone. One Spa layout and one set of physics everywhere. Quality tiers differ: full detail on PC
  High/Ultra, lighter textures, trees, crowd and draw distance on phone Low/Medium (`Settings.quality_config()`,
  `data/quality.json`).
- **Spa is a separate download**, not inside the APK. The APK is already 1.65 GB, and the new Spa is expected at
  300–600 MB.
  - Host the pack on **Cloudflare R2**: free up to 10 GB, and next to the game server already on Cloudflare. Guide me
    through creating the bucket and any keys. Never put secrets in the repo or the APK.
  - The game shows Spa with "Download (N MB)" until it is installed, then downloads it with progress, resume and a
    hash check, and stores it in `user://`.
  - A new version of the pack replaces the old one.
  - Solo offline works once the pack is downloaded.
- **Weather and time of day stay dynamic** (random dawn to evening, rain, changes during a session). So no fully baked
  lighting. Use baked ambient occlusion and other light-independent bakes, and dynamic sun, sky and shadows.
- **All four areas matter:**
  - road, kerbs and run-off
  - trees, terrain and the Ardennes hills
  - buildings, grandstands, crowd and banners
  - light and colour grading
- **Cars:**
  - Delete every existing car from the Godot app except the **Aston Martin Vantage GT3** (`vantage_gt3_evo_heart_of_racing`).
    Keep its cockpit work from 2026-11-07: `game/interior_look.gd`, the TFT overlay in `game/dash_display.gd`, and the
    wheel cut out of the mesh by `CarVisual._cut_out_wheel`.
  - Add the nine new cars.
  - **The safety car becomes the Vantage GT3 with that interior.** Keep the safety car's id
    (`aston_martin_vantage_safety_car`, `role: 'safety'`). Ask me which livery and light bar it should carry.
  - **Each new car reuses the id of the car it replaces.** The shared online server only accepts car ids it knows,
    and lap records are stored per id. Reusing ids keeps online play and records working without a server change.
  - Proposed mapping. Check each one by looking at the model and its livery, and ask me where unsure:

    | Zip | Model file | Reuses id |
    |---|---|---|
    | 2020-audi-r8-lms-evo | audi_r8_evo_acc_loda_sprint_2.glb | `2020_audi_r8_lms_evo` |
    | 2020-mclaren-720s-gt3 | mclaren_720s_gt3_2.glb | `2020_mclaren_720s_gt3` |
    | 2024-porsche-992-gt3-r | porsche_992_gt3_r.glb | `2024_porsche_992_gt3_r` |
    | 2026-bmw-m4-gt3-evo | M4_GT3_EVO_46.glb | `bmw_m4_gt3_evo_2026` |
    | bmw-m4-gt3 | bmw_m4_gt3__www_vecarz_com.7z | `bmw_m4_gt3_vecarz` |
    | ferrari-296-gt3-wwwvecarzcom | ferrari_296_gt3.glb | `ferrari_296_gt3_verstappen` |
    | ford-mustang-gt3-2024 | ford_mustang_gt3_2024__www_vecarz_com.zip | `ford_mustang_gt3` |
    | mercedes-amg-gt3-evo-2020-wwwvecarzcom | 2020_mercedes-amg_gt3_evo.glb | `mercedes_amg_gt3_evo` |
    | mercedes-amg-gt3-wwwvecarzcom | amg_evo_3.glb | an AMG id not used above: check the livery |

  - **Keep each replaced car's physics.** That means its specs in `tools/asset-pipeline/cars.config.json`, its engine
    sound profile and its bot setup. Change the models only.
  - **Cars the server still lists but the app no longer has:** a player on the web game can still pick one in a shared
    room. The Godot app must draw something sensible for such an id, such as the closest remaining model, and never
    crash.
- **Git:**
  - First commit the work already in the tree, as is, after checking that it compiles and its tests pass. That is the
    iRacing-guide features and the Vantage interior.
  - Then make one local commit per finished milestone.
  - **Ask before every push, deploy or upload** (GitHub, Cloudflare, R2).
  - Never commit `RESOURCES/`, extracted sources, keys or secrets.

## Matching the video

The aim is a Spa that looks like the video at every point of the lap. Copy it deliberately: measure from the frames,
don't guess.

- **A look sheet from the video, before any art work.** Pull a frame every 2 s of the lap (about 66 frames), plus extra
  frames at every corner. From them, record:
  - **Colours,** sampled from flat, sunlit and shaded patches (sRGB and linear values):
    - asphalt: old, new and patched, and the rubbered racing line
    - white lines and kerbs, each kerb colour
    - run-off: green, red and blue paint, gravel, sand
    - grass: mown and rough, verges
    - concrete, barriers (Armco, tyre walls, concrete), fences
    - tree foliage near and far, sky at the horizon and overhead
  - **Light:**
    - the sun's height and direction, estimated from shadow lengths and directions at known objects
    - how soft and how dark the shadows are
    - how bright the sky's fill light is in shade
    - the haze and fog over the far hills: how the colour and contrast fade with distance
  - **Grading:** contrast, saturation, white balance, and how highlights roll off. Build a colour grade (a LUT or
    Godot's adjustments) that brings a neutral in-game frame to the video's look.
  - **Trees and hills:**
    - which kinds of trees (pines, firs, deciduous), and their mix by section
    - how tall they are, how dense, how close to the track
    - where the forest stops, and how the hills rise behind it
  - **Trackside checklist per section:**
    - banners and signs
    - fences, catch fencing and barriers
    - grandstands and crowd
    - marshal posts, gantries and bridges
    - buildings, flags, start lights, lamp posts
    - anything else visible
    Mark each item present, missing or wrong in the source model. Everything missing gets built and placed;
    everything wrong gets fixed.
  - **Surface detail:** asphalt grain, cracks and patches, skid marks, kerb wear, rubber build-up, grass wear at the
    edges. Copy what the video shows, where it shows it.
- **Textures:**
  - Use the source model's textures where they match the video.
  - Where they don't, tint them, or replace them with free materials (CC0, for example ambientCG or Poly Haven) matched
    to the measured colours.
  - Never take textures from ACC.
  - On PC, the road and kerbs need high resolution, with detail and normal maps so they hold up from the cockpit.
- **Models for what the source model lacks or does badly.** Everything should look as real as possible, so aim for
  realistic models, not placeholders.
  - **Build hard-surface objects yourself,** as Blender Python scripts (Blender 4.2 is installed) or Godot code.
    That covers barriers, Armco, tyre walls, catch fencing, banners, signs, flags, gantries, marshal posts, lamp posts,
    cones, kerb pieces, grandstands and simple buildings.
    - Use real dimensions from photos and specs.
    - Give them bevelled edges, proper PBR materials, and wear: dirt, rust, scuffs, faded paint.
  - **Search and download free models widely** for everything complex: trees and other vegetation, the pit building,
    landmark buildings, spectators, vehicles, trackside clutter.
    - Look through every site that offers free downloads, for example:
      - Sketchfab (downloadable models)
      - Poly Haven, ambientCG
      - BlenderKit (free assets)
      - Fab (free assets)
      - CGTrader and TurboSquid (free)
      - Free3D, OpenGameArt, Smithsonian 3D
      - photogrammetry and scanned-asset collections
    - Take the most realistic one that fits the video and the performance budget.
    - Any licence that allows free download and use is fine, non-commercial ones included: this is a private game.
    - Record each asset's source, author and licence in `godot/assets_credits.md` (the source files stay out of git).
  - **Trees matter most:** they fill most of every frame of the video.
    - Use scanned or high-quality tree models near the track.
    - Use impostors (camera-facing pictures of the same trees) for the forest further away, so the hillsides look
      like the video at a low cost.
  - **Anything that still can't be matched** goes on a "needs a real model" list at the first check-in. Give each item
    what it is, where it appears in the video, and what to look for, so I can buy or find it early.
- **Comparing:**
  - Set the game to the video's conditions for every comparison: clear weather, a dry track, and the time of day and sun
    direction measured above.
  - Match the camera: the chase camera at the video's height and distance, and the same field of view.
  - Make each comparison image the video frame above the game frame at the same spot.
  - Score it in two ways:
    - the average colour difference over matching areas (road, grass, trees, sky)
    - the checklist items present
  - Give a list of what still differs, with the cause and the fix. Keep a scores table per spot from check-in to
    check-in, so progress is visible.
- **Dynamic weather stays.** The video's look is the clear-day target. Rain, dusk and dawn must still work and look
  natural with the same materials, so check a wet frame and an evening frame too.
- **The phone tier** keeps the same colours, grade, layout and landmarks. It has fewer trees, smaller textures and
  a shorter view, but at a glance it should still read as the same place.

## Ground rules

- **Godot only.**
  - Don't change the web client (`apps/client`), the shared server (`apps/server`) or `packages/shared`.
  - `tools/asset-pipeline` also builds the web game, so add Spa-for-Godot and the new cars as their own outputs and
    leave the web game's files as they are.
  - If something truly needs a server change, stop and ask.
- **Look before you rewrite.**
  - The map pipeline's tools already exist: `road_collision.mjs`, `track_limits.mjs`, `conform_apxc.mjs`,
    `optimize.mjs` and the `maps/*.json` configs.
  - So do the Godot checks: `kerb_scan.py`, `road_bumps.py`, `kerb_test.gd`, `ai_learn.gd`, `session_test.gd`,
    `cockpit_view.gd`, `cockpit_probe.gd` and `features_test.gd`.
  - Reuse them, and extend them where needed.
- **Every rendering test opens a window on my screen.** Say so before you start one, and ask me to leave it open.
- **Judge looks in the real game, not in a viewer.**
  - Compare in-game screenshots at the game's own cameras (chase and cockpit) with video frames at the same spots.
  - Make each comparison an image: the video frame above, the game below.
  - `cockpit_view.gd` lights things differently and misled us once.
- **Measure, don't assume.** Give performance numbers from real runs:
  - fps
  - CPU and GPU frame time (`APEX_PROF=1`, the performance overlay)
  - draw calls and triangles
  - texture memory
  - download size

## Milestones

1. **Survey and plan (no game changes).**
   - Extract and inspect the new Spa model: meshes, materials, texture sizes, triangle counts, scale, and the
     orientation against the current Spa.
   - Look for faults: stacked road layers, gaps, wrong kerb heights, missing or doubled objects, and the turn 9 slab.
   - Do the same for each car model:
     - LODs or none
     - interior or not
     - steering wheel node, or baked into a mesh as on the Vantage
     - display materials
     - wheel naming (`wheel_FL_spin` and so on, see `godot/tools`, `unpack-glb.mjs`)
     - texture sizes and triangle count
   - Write a short plan with budgets per quality tier (triangles, draw calls, texture memory, pack size) for PC and
     phone.
   - Make the look sheet from the video ("Matching the video"): colours, light, grade, trees and hills, the trackside
     checklist and surface detail.
   - List the models you will build, the ones you found to download (with links and licences), and the "needs a real
     model" list.
   - **Check-in:** show me the plan, the fault list, the video-time → corner table, and the look sheet. Include frames
     with the sampled colours marked on them, the checklist with what the source model is missing, and the model
     lists.
2. **Spa core.**
   - Road, kerbs, run-off, collision, centreline, gates, sectors, pit lane, grid, track limits and the minimap, from the
     new model.
   - Then re-run the surface checks over the whole lap and fix what they find.
   - Bots: retrain Spa with `ai_learn.gd` (real time), and confirm a full lap with resets at 0.
3. **Test slice, Eau Rouge to Raidillon (about 1 km), at full quality.**
   - road materials (asphalt detail and the rubbered line)
   - kerbs
   - trees and terrain
   - barriers and fences
   - buildings and grandstands
   - lighting and grading
   - every checklist item in that stretch
   - **Check-in:** comparison images at at least 6 spots in that stretch, in the chase and cockpit views, on PC Ultra
     and phone Medium. Each image comes with its score and its list of what still differs. Iterate until the
     differences left are small, then show me. Don't go on until I approve.
4. **The whole lap.**
   - Roll the approved look out over the full 7 km.
   - Every checklist item around the lap must be present.
   - **Check-in:** comparison images and scores at at least 12 spots around the lap, plus one wet frame and one evening
     frame.
5. **The download pack.**
   - Pack the quality tiers, host on R2 after my OK, and add the in-game download (UI, progress, resume, hash, cache,
     updates).
   - Spa must load from the pack on both PC and phone.
6. **Cars.** Import the nine models and rebuild the line-up as decided:
   - Each car gets LODs, its cockpit, a steering wheel that turns, live dash screens, lights, and wheels that spin and
     steer.
   - Fix cockpits as needed, the way the Vantage was fixed.
   - **Check-in:** a cockpit and an outside image of every car in-game.
7. **Finish.**
   - Full checks: `compile_all`, all the tests, a full offline race at Spa on PC, and an APK for me to test on the
     phone.
   - DECISIONS.md and the Godot README updated with what was done, why, and the measured numbers.
   - The final commits, then ask me about pushing and deploying.

## Targets

These are defaults; I may change them.

| | PC (RX 7600 XT, 2560×1440, Ultra) | Phone (Pixel 10a, Medium) |
|---|---|---|
| Frame rate | 45 fps or more, steady | 60 fps aim, never under 45 |
| Spa pack | | under 600 MB in total, the phone tier much smaller |

Anything else, ask me at the next check-in rather than guessing.
