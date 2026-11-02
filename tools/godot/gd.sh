#!/usr/bin/env bash
# Runs a Godot headless test after refreshing the global class cache (new class_name scripts).
#   tools/godot/gd.sh tests/roomtest.gd [godot args] [-- user args]
# Scripts that start with `extends Node` run inside a scene (autoloads available); the others as a SceneTree script.
set -euo pipefail
here="$(cd "$(dirname "$0")/../.." && pwd)"
godot="${GODOT:-$HOME/.local/opt/godot/godot}"
script="$1"; shift
"$godot" --headless --path "$here/godot" --import >/dev/null 2>&1 || true
if head -1 "$here/godot/$script" | grep -q '^extends Node'; then
  # user args after "--" are passed on; the test script comes first
  args=("$@")
  if printf '%s\n' "${args[@]:-}" | grep -qx -- '--'; then
    exec "$godot" --headless --path "$here/godot" res://tests/runner.tscn "${args[@]}" -- "res://$script"
  fi
  exec "$godot" --headless --path "$here/godot" res://tests/runner.tscn "$@" -- "res://$script"
fi
exec "$godot" --headless --path "$here/godot" -s "$script" "$@"
