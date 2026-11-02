#!/usr/bin/env bash
# Runs a Godot headless script from the project after refreshing the global class cache (new class_name scripts).
# usage: tools/godot/gd.sh tests/roomtest.gd [--fixed-fps 120] [-- args]
set -euo pipefail
here="$(cd "$(dirname "$0")/../.." && pwd)"
godot="${GODOT:-$HOME/.local/opt/godot/godot}"
script="$1"; shift
"$godot" --headless --path "$here/godot" --import >/dev/null 2>&1 || true
exec "$godot" --headless --path "$here/godot" -s "$script" "$@"
