# Spa rebuild, milestone 5: the download pack

Spa (models, forest, textures, props, collision) is too big to ship inside the app, so it comes as a separate download:
a Godot resource pack per platform, fetched once, checked and mounted over `res://`, so the track loads from the same
paths as a bundled one. The other circuits stay in the app.

## Packs

`tools/godot/build-track-pack.py spa <out dir> [--version V]` exports the pack per platform with the editor (no export
templates needed) and keeps only Spa's entries. An exported pack also carries every script, `project.binary` and the
class and UID caches, and mounted over the app those would replace its own. It writes `packs.json`, the manifest the app
reads: version, file, size and SHA-256 per platform.

| pack | size | textures |
|---|---|---|
| `spa-pc-<v>.pck` | 253 MB | S3TC / BPTC, 4K road set |
| `spa-android-<v>.pck` | 217 MB | ETC2 / ASTC, 2K road set (phones run Medium) |
| **total** | **470 MB** | budget: under 600 MB |

On the way, 94 textures that had been imported uncompressed (the props' scanned materials, the detail layers, the crowd
atlas) were set to GPU compression with mipmaps (`tools/godot/set-import-defaults.py`).

The base builds leave Spa out: `export_presets.cfg` excludes `assets/maps/spa_g/`, `assets/maps/spa/` (the old web
map, apart from its collision now unused; the collision goes in the pack), `assets/textures/spa/` and the Spa trees.

## In the app

`scripts/game/track_packs.gd` (autoload `Packs`):

- **Manifest** from `<base>/packs.json`, cached in `user://packs/manifest.json` for the sizes offline. `<base>` is the
  project setting `apex/packs_url` (empty until the hosting is set up) or `APEX_PACKS_URL`.
- **Download** over HTTP(S) into `<file>.part`. After a dropped connection or a restart of the app it resumes with a
  Range request, and starts over if the server ignores the range.
- **Check**: SHA-256, hashed a few MB a frame, before the pack replaces anything; a damaged file is refused.
- **Mount**: every installed pack at start (a file of the wrong size is forgotten), and right after its download.
- **Updates**: a manifest version other than the installed one is offered; the old file goes once the new one is in.
- **Lobby**: when the room's circuit is not installed, the main button becomes "Download circuit (N MB)" with live
  progress, a checking stage and "Retry download"; the lobby redraws once the circuit is in. A race start for a circuit
  that is not installed goes back to the lobby instead of loading. An available update is mentioned there.
- **Settings › Gameplay › Interface › Downloaded circuits**: status, size and version, Download / Update / Cancel /
  Remove.

## Checks

- `tests/pack_test.gd` (13 checks) against `tools/godot/pack-server.py`, a local server with Range support that can cut
  the first download: the cut, the resume, the hash, the mount, a damaged download refused, an update replacing the
  installed version and removing the old file. The test pack is 1.2 MB, spread over many frames: an earlier version
  that checked the response code every frame wiped the file each frame and passed with a small pack.
- End to end, exported Linux build without Spa (the official 4.7.2 export templates, checksum checked):
  - the real 241 MB pack, cut at 50 MB: resumed, checked in about 5 s, mounted;
  - then a Spa session in the same build, loading everything from the pack, with no missing files;
  - the lobby without the pack shows "Download circuit (253 MB)", and a forced start stays in the lobby.
- In the editor (Spa bundled) the look is unchanged (f021 mean ΔE 3.5, as before).

## Not done yet

- **Hosting on R2**: waiting for the user's go-ahead and bucket. Until `apex/packs_url` is set, a fresh install shows
  "Circuit not installed" for Spa.
- The phone download is untested on a phone (M7 builds the APK).
- An online room on Spa: a player without the pack sees the download in the lobby; if the host starts before they have
  it, they stay in the lobby for that race.
