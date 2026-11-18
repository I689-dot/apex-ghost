#!/usr/bin/env bash
# The menus' background photos (godot/assets/ui/photo_<kind>[_spa|_zandvoort].webp), shot in the Godot game itself:
# the brand-free cars and boards, the game's own name on them. Each opens a game window (on screen APEX_SCREEN, default
# 1: the LG); ~1 min a photo, 15 photos.
#   tools/godot/menu-photos.sh
set -euo pipefail
here="$(cd "$(dirname "$0")/../.." && pwd)"
godot="${GODOT:-$HOME/.local/opt/godot/godot}"
out="$(mktemp -d)"
cd "$here/godot"
shot() { # name track secs env...
  local name=$1 track=$2 secs=$3; shift 3
  env APEX_SCREEN="${APEX_SCREEN:-1}" QUALITY=ultra TRACK="$track" SKIP_INTRO=1 BOTS=6 CAMERA=chase SHOT_DIR="$out" SHOT_NAME="$name" SHOT_ONCE=$((secs-2)) "$@" \
    timeout 300 "$godot" --path . --disable-vsync --resolution 1920x1080 res://tests/runner.tscn -- res://tests/session_test.gd "$secs" >/dev/null 2>&1 || true
  echo "$name $(test -f "$out/$name.png" && echo ok || echo MISSING)"
}
for t in nurburgring_short spa zandvoort; do
  sfx=""; [ "$t" != nurburgring_short ] && sfx="_$t"
  shot "hero$sfx" "$t" 14 CHASE_YAW=145 CHASE_DIST=5.6 CHASE_H=0.95 CHASE_FOV=40 CHASE_AHEAD=0 CHASE_LOOKY=0.6
  shot "pole$sfx" "$t" 14 CHASE_YAW=190 CHASE_DIST=7.5 CHASE_H=0.7 CHASE_FOV=34 CHASE_AHEAD=0 CHASE_LOOKY=0.7
  shot "grid$sfx" "$t" 14 CHASE_YAW=10 CHASE_DIST=16 CHASE_H=6 CHASE_FOV=44 CHASE_AHEAD=12 CHASE_LOOKY=0.5
  shot "aerial$sfx" "$t" 14 CHASE_YAW=30 CHASE_DIST=70 CHASE_H=55 CHASE_FOV=50 CHASE_AHEAD=60 CHASE_LOOKY=0
  shot "straight$sfx" "$t" 15 AUTODRIVE=1 CHASE_YAW=152 CHASE_DIST=7.5 CHASE_H=1.3 CHASE_FOV=34 CHASE_AHEAD=0 CHASE_LOOKY=0.7
done
python3 -I - "$out" "$here/godot/assets/ui" <<'PY'
import sys, os
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
for f in sorted(os.listdir(src)):
    if not f.endswith('.png'):
        continue
    im = Image.open(os.path.join(src, f)).convert('RGB')
    w, h = im.size
    sc = max(1920 / w, 1080 / h)
    im = im.resize((round(w * sc), round(h * sc)), Image.LANCZOS)
    w, h = im.size
    im = im.crop(((w - 1920) // 2, (h - 1080) // 2, (w - 1920) // 2 + 1920, (h - 1080) // 2 + 1080))
    im.save(os.path.join(dst, 'photo_' + f[:-4] + '.webp'), quality=88)
    print('photo_' + f[:-4] + '.webp')
PY
rm -rf "$out"
