#!/usr/bin/env bash
# Copies the web game's runtime assets into the Godot project (godot/assets is not committed; run this after cloning).
set -euo pipefail
# WARNING: godot/assets now also holds files only the Godot app has (Spa's build in assets/maps/spa_g, assets/textures/spa,
# the Spa trees; the 2026-11 cars from tools/godot/build-cars.py, and godot/data/cars.json from it): this mirror with
# --delete removes them. Re-run tools/asset-pipeline/spa_godot/* and tools/godot/build-cars.py afterwards, or don't run it.
if [ "${FORCE_SYNC:-}" != "1" ]; then
  echo "sync-assets.sh would delete the Godot-only Spa and car files in godot/assets (see the header). FORCE_SYNC=1 to run it anyway." >&2
  exit 1
fi
here="$(cd "$(dirname "$0")/../.." && pwd)"
src="$here/apps/client/public/assets"
dst="$here/godot/assets"
mkdir -p "$dst"
rsync -a --delete --exclude='*.apk' "$src/" "$dst/"
node "$here/tools/godot/export-i18n.mjs"
node "$here/tools/godot/export-quality.mjs"
cp "$src/cars.json" "$here/godot/data/cars.json"
cp "$src/track.json" "$src/tracks.json" "$here/godot/data/"
mkdir -p "$here/godot/data/tracks" && cp "$src"/tracks/*.json "$here/godot/data/tracks/"
node "$here/tools/godot/unpack-glb.mjs" "$dst"
node "$here/tools/godot/pack-forest.mjs" "$dst"
echo "synced to $dst"
