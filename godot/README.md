# Apex Ghost (Godot)

The game ported to Godot 4.7 (Mobile renderer, Jolt physics) for Android; the web / Capacitor game and the Cloudflare server
are untouched and the Godot client reuses the server for online play. `MIGRATION.md` lists every source file of the web game
and where it went.

## Set up

```
tools/godot/sync-assets.sh                # copies the web game's assets into godot/assets, unpacks the GLBs, packs the forests
python3 tools/godot/make-ground-textures.py && python3 tools/godot/make-grass-blades.py && python3 tools/godot/make-car-bbox.py
godot --headless --path godot --import    # first import (long)
godot --headless --path godot res://tests/runner.tscn -- res://tests/bake_masks.gd   # grass masks under the stands (assets/masks)
python3 tools/godot/set-import-defaults.py && godot --headless --path godot --import   # VRAM-compressed textures with mipmaps
```

`godot/assets`, `godot/data` and `godot/.godot` are not committed. The WebRTC extension (`addons/webrtc_native`, from
godotengine/webrtc-native 1.2.2) carries the Linux x86_64 and Android arm64 builds only.

## Run and test

* `tools/godot/gd.sh tests/compile_all.gd` compiles every script.
* `tools/godot/gd.sh tests/<name>.gd`: `simtest` (vehicle), `tracktest`, `roomtest`, `ailap` (`HZ=60` for the phone's physics rate),
  `conntest`, `prngtest`, `audiotest`, `p2ptest` (a race hosted on this device, needs network).
* `tests/session_test.gd` runs an offline session (non-headless: it renders). Environment: `CAR_ID`, `WEATHER`, `TIME`,
  `TELEPORT=<lap metres>`, `LATERAL=<m>`, `LINE=full`, `SHOT_DIR=<dir>` for screenshots, `BOTS=<n>`, `AUTODRIVE=1`,
  `RENDER_SCALE=1.3333` (a 1080p screen drawing 1440p's pixels), `TIMELINE=1` (frame time, GPU time and position per
  half second), `BOT_REPORT=1`, `LIGHTS=brake|tail|off`. It prints the average fps and the 1 % low with what the
  slowest frames spent their time on.
* `tests/race_test.gd` runs a whole race weekend with a full grid (one minute of qualifying, then `RACE_LAPS` laps, the
  AI driving every car) and checks the classification. `tests/features_test.gd` and `tests/menu_test.gd` check the
  in-car features and every menu screen.
* `APEX_AUTO=solo SHOT_DIR=… godot --path godot` plays menu → lobby → briefing → race by itself; `APEX_AUTO=intro` shows the intro.
* `APEX_PROF=1` prints a per-section CPU profile; the performance overlay (Settings → General) shows it on a device.
  `APEX_PROF_SPIKES=<ms>` also prints the sections of every frame longer than that.

## Android

`export_presets.cfg` has the Android preset (arm64, package `app.apexghost.racing.godot`, so it installs next to the old app).
Debug build: `godot --headless --path godot --export-debug Android ../build/apex-ghost-godot.apk` (the Android SDK and JDK paths are in
the editor settings; Godot's debug keystore signs it).
Release build: the keystore stays outside the repo, and Godot reads it from the environment:
`env $(cat ~/.config/apex-ghost/release-keystore.env) godot --headless --path godot --export-release Android ../build/apex-ghost-godot.apk`
(`GODOT_ANDROID_KEYSTORE_RELEASE_PATH`, `_USER`, `_PASSWORD`). The Android SDK (build tools 35, platform tools) is in
`~/Android/Sdk` (`android sdk install build-tools/35.0.0 platform-tools`), the JDK path is
`/usr/lib/jvm/java-21-openjdk-amd64` in the editor settings. The APK is about 1.6 GB (the cars at full detail); Spa
is not in it (a download).

Phone adaptations (a Pixel 10a is the reference): physics at 60 Hz (the lap time holds within 0.3 %), dynamic resolution from the GPU's
time, forest and far scenery capped on Medium, ground overlays and shells for High / Ultra, the mirror without the far scenery.

## Touch UI

On a phone or tablet (`UIKit.touch()`), the menus, modals and the pause menu are enlarged (`App._apply_ui_scale`, about 1.5x on a
Pixel: a button is about 48 dp); the race keeps the base scale. To check the layouts on the desktop:
`APEX_TOUCH=1 APEX_UI_SCALE=1.5 APEX_AUTO=solo SHOT_DIR=/tmp/lb godot --path godot --resolution 1616x720`.
The lobby (`lobby_screen.gd`) is a hub (car, circuit, conditions, session, rules, drivers, one big start/ready button) with
a full page for each; a car is picked automatically (the last one used).

## Track surface checks

* `python3 tools/godot/kerb_scan.py spa [file.apxc] [from to]`: kerb steps over 5 cm against the road or ground beside them.
* `python3 tools/godot/road_bumps.py spa [file.apxc]`: abrupt height changes of the driven surface along the lap.
* `TRACK=spa FROM=3150 TO=3420 LANE=-5.8 godot --path godot --resolution 960x540 res://tests/runner.tscn -- res://tests/kerb_test.gd`:
  drives a stretch with the car held on a lateral line (onto the kerbs) and prints the roll and vertical speed.
* `node tools/asset-pipeline/conform_apxc.mjs <collision.apxc>`: subdivides long kerb triangles, brings kerbs within a few cm of
  the road, lifts the ground behind them and closes the gaps with a skirt (the pipeline does the same in optimize.mjs).
* Stretches whose source road is broken get `smoothRoad` in the map's config (tools/asset-pipeline/maps/<map>.json).
* Spa for this app is built from the new source model, apart from the web game's Spa:
  `node tools/asset-pipeline/spa_godot/collision.mjs [--glb spa.glb]` writes `godot/assets/maps/spa/collision.apxc` from
  `source/spa.glb` of `RESOURCES/CIRCUIT-MODELS/circuit-de-spa-francorchamps-2022-layout.zip` (default path
  `~/apex-ghost-sources/spa/source/spa.glb`, or `SPA_GLB`), in the game's existing frame (`spa_godot/config.json`
  `toGameFrame`, so the server's gates still time online laps). The rubber layers are left out of the collision and the kerbs
  are levelled by `spa_godot/kerb_level.mjs`; no `smoothRoad`. Check with the three tools above.

## Bots that learned the circuits

`TRACK=spa LAPS=8 godot --path godot --disable-vsync --always-on-top --resolution 320x180 res://tests/runner.tscn -- res://tests/ai_learn.gd`
(on Wayland a covered, vsync'd window gets no frames and the laps crawl; real time: the
physics does not survive a faster clock) drives laps with the AI alone and writes `data/ai_learned/<layout>.json`, a grip
multiplier per 25 m that every bot plans with (AiDriver.learned_grip). Retrain after changing the tyres or the cars.

## Cars

The line-up is built from the user's models (docs/spa-rebuild/milestone-6-cars.md):
`python3 -I tools/godot/build-cars.py <unzipped CAR-MODELS dir> [--car <id>]`, then `godot --headless --path godot --import`.
For each car: `car_prep.py` (Blender: material names, liveries, mirrored and turned exports), the web game's
`convert_car.py` (read-only), `car-lods.mjs` (cockpit / lod0 at full detail, lod1 for other cars near you, lod2 far;
light materials kept apart), `tail-lights.mjs` (the rear lamps' glow maps). The cockpit eye defaults to 0.58 m behind and
0.30 m above the steering wheel (`seat_eye`). Lamps in materials not named `LIGHT_TAIL_` are listed in
`CarVisual.TAIL_LAMPS` (and `'tail'` in build-cars.py); screens that are only faces of the dash in
`DashDisplay.OVERLAYS`.

## Track packs (downloads)

Spa is a separate download (docs/spa-rebuild/milestone-5-download-pack.md):

- **Build:** `python3 -I tools/godot/build-track-pack.py spa <out dir> --version <v>` writes `spa-pc-<v>.pck`, `spa-android-<v>.pck` and `packs.json`. Upload all three to the packs URL (project setting `apex/packs_url`).
- **Test locally:** `python3 -I tools/godot/pack-server.py <out dir> 8765`, then run the app with `APEX_PACKS_URL=http://<this machine>:8765/` (a phone on the same network works too).
- **Automated test:** `tests/pack_test.gd` (see its header).
