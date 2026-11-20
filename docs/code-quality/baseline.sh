#!/usr/bin/env bash
# Runs every headless Godot test and saves each one's output: baseline.sh <out dir>
set -u
R="$(cd "$(dirname "$0")/../.." && pwd)"
G=$HOME/.local/opt/godot/godot
OUT="$1"; mkdir -p "$OUT"

cd "$R"
"$G" --headless --path godot --import >/dev/null 2>&1
run() { # name, command...
  local n="$1"; shift
  local t0=$(date +%s)
  "$@" > "$OUT/$n.txt" 2>&1; local rc=$?
  echo "exit=$rc seconds=$(( $(date +%s) - t0 ))" >> "$OUT/$n.txt"
  echo "$n exit=$rc"
}
run compile_all tools/godot/gd.sh tests/compile_all.gd
for t in prngtest chat_test lapdelta_test replay_test time_trial_test settings_test setup_codes_test progression_test signin_test audiotest devices_test hud_layout_test conntest menu_test; do
  run $t tools/godot/gd.sh tests/$t.gd
done
run roomtest "$G" --headless --path godot --fixed-fps 120 -s tests/roomtest.gd
for i in 0 1 2 3 4 5 6 7; do run tracktest_$i "$G" --headless --path godot --fixed-fps 120 -s tests/tracktest.gd -- $i; done
for c in $(python3 -I -c "import json;d=json.load(open('godot/data/cars.json'));print(' '.join(c['id'] for c in (d['cars'] if isinstance(d,dict) else d) if c.get('role')!='safety'))"); do
  run simtest_$c "$G" --headless --path godot --fixed-fps 120 -s tests/simtest.gd -- $c
done
# the pack download (a local pack server that cuts the connection part-way)
PD=$(mktemp -d); python3 -I tools/godot/pack-server.py "$PD" 8765 --drop-after 40000 > "$OUT/pack_server.log" 2>&1 & PS=$!
sleep 1
PACK_TEST_DIR=$PD APEX_PACKS_URL=http://127.0.0.1:8765/ APEX_PACKS_DIR=$PD/user/ run pack_test tools/godot/gd.sh tests/pack_test.gd
kill $PS; rm -rf "$PD"
# the account tests against a local server (never the live one)
WR=$(mktemp -d); ( cd apps/server && exec corepack pnpm exec wrangler dev --port 8799 --ip 127.0.0.1 --persist-to "$WR" ) > "$OUT/wrangler.log" 2>&1 & WP=$!
for i in $(seq 1 60); do curl -sf http://127.0.0.1:8799/health >/dev/null && break; sleep 1; done
APEX_SERVER=http://127.0.0.1:8799 run economy_test tools/godot/gd.sh tests/economy_test.gd
APEX_SERVER=http://127.0.0.1:8799 run guest_test tools/godot/gd.sh tests/guest_test.gd
for p in $(ps -eo pid,args | grep -E "[w]rangler dev --port 8799|[w]orkerd" | awk '{print $1}'); do kill $p 2>/dev/null; done
wait $WP 2>/dev/null; rm -rf "$WR"
# the AI laps: every layout at 120 Hz and at the phone's 60 Hz, 4 at a time
jobs_=()
for hz in 120 60; do for i in 0 1 2 3 4 5 6 7; do jobs_+=("$hz $i"); done; done
printf '%s\n' "${jobs_[@]}" | xargs -P 4 -L 1 bash -c 'hz=$0; i=$1; t0=$(date +%s); HZ=$hz '"$G"' --headless --path godot --fixed-fps $hz -s tests/ailap.gd -- $i > '"$OUT"'/ailap_${hz}_$i.txt 2>&1; echo "exit=$? seconds=$(( $(date +%s) - t0 ))" >> '"$OUT"'/ailap_${hz}_$i.txt; echo "ailap_${hz}_$i done"'
echo ALL DONE
