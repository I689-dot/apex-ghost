#!/usr/bin/env bash
# The code check: compile_all, every headless test, and their deterministic numbers (simtest, tracktest, roomtest,
# ailap at 120 and 60 Hz, replay, settings...) against docs/code-quality/baseline. Prints PASS or FAIL (exit 0 / 1).
#   tools/godot/check.sh            (about 20-30 min; starts and stops its own local pack and account servers)
# The outputs stay in a temporary folder (printed at the end) to read a failure. Physics and AI are deterministic:
# a change that should not change behaviour matches to the last digit. Re-record the baseline only on purpose
# (docs/code-quality/baseline.sh docs/code-quality/baseline), with the reason in the commit.
set -u
R="$(cd "$(dirname "$0")/../.." && pwd)"
OUT=$(mktemp -d)
"$R/docs/code-quality/baseline.sh" "$OUT" > "$OUT/run.log" 2>&1
"$R/docs/code-quality/compare.sh" "$OUT"
rc=$?
echo "outputs: $OUT"
exit $rc
