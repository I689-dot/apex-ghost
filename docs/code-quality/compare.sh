#!/usr/bin/env bash
# Compares a run of baseline.sh with docs/code-quality/baseline: compare.sh <run dir>. Prints the tests whose
# deterministic output differs (timings, random ids and exit-time leak counts left out, and audiotest's bus count,
# which depends on when the engine voices' buses are freed under load; menu_test's lines sorted, as it prints some
# asynchronously) and PASS or FAIL.
set -u
B="$(cd "$(dirname "$0")" && pwd)/baseline"
RUN="$1"
DROP='audio ok, buses:| ms\b|[0-9]+ ?ms|fps|Godot Engine|^\s*$|ObjectDB instances|RID allocations|RIDs of type|resources still in use|welcome:|state=open|carLock|invite code|gets a number|^\s+at: '
fail=0
for f in "$B"/*.txt; do
  n=$(basename "$f")
  case "$n" in rendered_*|warnings.txt) continue;; esac
  if [ ! -f "$RUN/$n" ]; then echo "missing: $n"; fail=1; continue; fi
  # compile_all: its script and warning counts change with the clean-up; only "0 failed" must hold
  if [ "$n" = compile_all.txt ]; then
    grep -qE "^[0-9]+ scripts, 0 failed" "$RUN/$n" || { echo "== compile_all: a script failed to compile"; fail=1; }
    continue
  fi
  # (the exit line stays, without its time: a test that fails or hangs shows as its exit code)
  a=$(grep -vE "$DROP" "$f" | sed -E 's/ seconds=[0-9]+$//'); b=$(grep -vE "$DROP" "$RUN/$n" | sed -E 's/ seconds=[0-9]+$//')
  if [ "$n" = menu_test.txt ]; then a=$(echo "$a" | sort); b=$(echo "$b" | sort); fi
  if [ "$a" != "$b" ]; then echo "== $n"; diff <(echo "$a") <(echo "$b") | head -8; fail=1; fi
done
[ $fail = 0 ] && echo PASS || echo FAIL
exit $fail
