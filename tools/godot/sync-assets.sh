#!/usr/bin/env bash
# Copies the web game's runtime assets into the Godot project (godot/assets is not committed; run this after cloning).
set -euo pipefail
here="$(cd "$(dirname "$0")/../.." && pwd)"
src="$here/apps/client/public/assets"
dst="$here/godot/assets"
mkdir -p "$dst"
rsync -a --delete --exclude='*.apk' "$src/" "$dst/"
cp "$src/cars.json" "$here/godot/data/cars.json"
cp "$src/track.json" "$src/tracks.json" "$here/godot/data/"
mkdir -p "$here/godot/data/tracks" && cp "$src"/tracks/*.json "$here/godot/data/tracks/"
node "$here/tools/godot/unpack-glb.mjs" "$dst"
echo "synced to $dst"
