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
* `tests/session_test.gd` runs a whole offline race (non-headless: it renders). Environment: `CAR_ID`, `WEATHER`, `TIME`,
  `TELEPORT=<lap metres>`, `LATERAL=<m>`, `LINE=full`, `SHOT_DIR=<dir>` for screenshots.
* `APEX_AUTO=solo SHOT_DIR=… godot --path godot` plays menu → lobby → briefing → race by itself; `APEX_AUTO=intro` shows the intro.
* `APEX_PROF=1` prints a per-section CPU profile; the performance overlay (Settings → General) shows it on a device.

## Android

`export_presets.cfg` has the Android preset (arm64, package `app.apexghost.racing.godot`, so it installs next to the old app).
Debug build: `godot --headless --path godot --export-debug Android ../build/apex-ghost-godot.apk` (the Android SDK and JDK paths are in
the editor settings; Godot's debug keystore signs it). A release build needs a keystore in the preset's options.

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
