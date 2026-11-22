#!/usr/bin/env bash
# The AI laps of a commit and of the working tree with the bots' per-object randomness fixed: ailap_seeded.sh [ref]
# (default HEAD). A bot seeds its mistakes with hash(get_instance_id()) and varies its pace per stretch with the same
# id, so any change in how many objects the engine makes before it (a new script loaded at boot) moves every lap time
# in the baseline although the driving is the same. Here both trees get the same constants in place of the id; the 16
# laps must then match exactly. Two scratch worktrees (git-ignored assets linked, not copied); the main tree is not
# touched. Prints "N of 16 identical" and exits 1 when one differs.
set -u
R="$(cd "$(dirname "$0")/../.." && pwd)"
G=$HOME/.local/opt/godot/godot
REF="${1:-HEAD}"
T=$(mktemp -d)
M="$R/godot"
cd "$R"
git diff > "$T/wip.patch"
for w in base work; do
  git worktree add -q --detach "$T/$w" "$REF"
  ( cd "$T/$w/godot" && ln -s "$M/assets" assets && mkdir -p .godot && ln -s "$M/.godot/imported" .godot/imported \
    && cp "$M"/.godot/*.cfg "$M"/.godot/*.bin .godot/ \
    && for f in "$M"/data/*; do [ -e "data/$(basename "$f")" ] || cp -r "$f" data/; done )
done
# the working tree: its diff and its new scripts
( cd "$T/work" && { [ ! -s "$T/wip.patch" ] || git apply "$T/wip.patch"; } )
git ls-files --others --exclude-standard godot/scripts | while read -r f; do mkdir -p "$T/work/$(dirname "$f")"; cp "$f" "$T/work/$f"; done
for w in base work; do
  sed -i -e 's/^\t_rng.seed = hash(get_instance_id())$/\t_rng.seed = 12345/' \
    -e 's/hash(Vector3i(get_instance_id() \& 0xffff, _lap_salt, b))/hash(Vector3i(777, _lap_salt, b))/' "$T/$w/godot/scripts/game/ai.gd"
  [ "$(grep -cE '_rng.seed = 12345|Vector3i\(777' "$T/$w/godot/scripts/game/ai.gd")" = 2 ] || { echo "ai.gd changed: update the two patterns here"; exit 2; }
  "$G" --headless --path "$T/$w/godot" --import >/dev/null 2>&1
  mkdir -p "$T/out_$w"
done
for w in base work; do for hz in 120 60; do for i in 0 1 2 3 4 5 6 7; do echo "$w $hz $i"; done; done; done |
  xargs -P 4 -L 1 bash -c 'w=$0; hz=$1; i=$2; HZ=$hz '"$G"' --headless --path '"$T"'/$w/godot --fixed-fps $hz -s tests/ailap.gd -- $i 2>&1 | grep -v "racing line built" > '"$T"'/out_$w/ailap_${hz}_$i.txt'
n=0
for f in "$T"/out_base/*.txt; do
  b=$(basename "$f")
  if cmp -s "$f" "$T/out_work/$b"; then n=$((n + 1)); else echo "== $b"; diff "$f" "$T/out_work/$b" | head -6; fi
done
echo "$n of 16 identical"
git worktree remove --force "$T/base"; git worktree remove --force "$T/work"; git worktree prune; rm -rf "$T"
[ "$n" = 16 ]
