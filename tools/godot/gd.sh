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
  # godot args before "--", the test's own after it; runner.gd loads the first user arg, so the script goes first
  pre=(); post=(); seen=0
  for a in "$@"; do
    if [ $seen = 0 ] && [ "$a" = "--" ]; then seen=1; continue; fi
    if [ $seen = 0 ]; then pre+=("$a"); else post+=("$a"); fi
  done
  exec "$godot" --headless --path "$here/godot" res://tests/runner.tscn "${pre[@]}" -- "res://$script" "${post[@]}"
fi
exec "$godot" --headless --path "$here/godot" -s "$script" "$@"
