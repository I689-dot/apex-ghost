# Job: a code-quality pass over the Godot app, and the rules that keep it clean

Paste this whole file to Claude Code in the APEX GHOST repo, in a fresh session. The job runs across several sessions;
`docs/code-quality/progress.md` (which you create) carries the state between them. To resume, paste this file again
and say "resume".

---

You are working on APEX GHOST, a multiplayer GT3 sim racer. This job is for the **Godot app only** (`godot/`, GDScript,
Godot 4.7, Jolt physics at 120 Hz on PC / 60 Hz on phones, Forward+ on PC, Android phones as the first target). About
35,000 lines in ~150 scripts under `godot/scripts/{app,audio,game,input,net,physics,shared,ui}` and ~85 test
scripts under `godot/tests`.

Before anything else, read your memory index (MEMORY.md and the files it links), especially `godot-only-scope`,
`apex-ghost-code-conventions`, `apex-ghost-feature-workflow`, `godot-test-setup`, `godot-render-tests-open-windows`,
`game-on-lg-monitor` and `release-upload-policy`. Then read `godot/README.md`, `godot/MIGRATION.md`, and the parts of
`DECISIONS.md` about whatever you touch. DECISIONS.md says "if it disagrees with the code, the code is right": treat it
as the reason a thing exists, not as proof the thing is still used.

## The goal

Make the Godot code **smaller, clearer and easier to extend, while the game does exactly what it did before**. In
priority order:

1. **Remove what is dead**: unreachable code, functions/signals/constants/variables/settings nothing reads, leftovers
   from the web port that the Godot app never calls, debug prints and one-off experiments that stayed, commented-out
   code, stale comments that describe code that no longer exists, test scripts for features that are gone.
2. **Remove duplication that is the same concept**: logic written twice or more that must always change together (the
   per-circuit `*_look.gd` scripts, the screens in `app/` and `ui/`, the widget-building code, the setting
   read/write paths, tests that re-implement the same setup).
3. **Make the code say what it is**: static types everywhere (`var x := …` / `var x: T`, `-> T` on every function,
   typed arrays), names that match what a thing does, one way of doing each common job (building a screen, reading a
   setting, loading a pack, timing a frame).
4. **Split what is too big**: `game/race_session.gd` (~3,600 lines), `app/lobby_screen.gd` (~1,400),
   `shared/room_core.gd`, `app/app.gd`, `ui/ui_widgets.gd`. Pull out cohesive subsystems with a narrow interface. Don't
   cut a file into arbitrary pieces.
5. **Leave guardrails** so the next sessions keep it this way: Godot warnings switched on, a short `CLAUDE.md`, a
   check that is easy to run.

"Better" means a future change touches fewer files and has one obvious place to go. It does not mean more layers.
Fewer lines is a good sign, not the target: never compress code into something harder to read to save lines.

## Rules (and why they exist)

**Behaviour does not change.** A cleanup commit changes no gameplay, physics, AI lap, timing, netcode, save format or
look. If you find a real bug along the way, write it in the progress file and fix it in its own commit, with a
measurement and a line saying it changes behaviour. Never mix a fix into a cleanup: a mixed commit can't be reverted
cleanly, and it hides the fix from review.

**Prove a thing is dead before you delete it.** GDScript is dynamic, so a search for `foo(` misses most uses. A symbol
counts as unused only after you searched every one of these and found nothing:
- string-based calls: `call("foo")`, `call_deferred`, `callv`, `has_method`, `Callable(obj, "foo")`, `get("foo")`,
  `set("foo")`, `connect("sig", …)`, `emit_signal("sig")`, string keys in dictionaries used as dispatch tables;
- `.tscn` / `.tres` files (signal connections, `[connection]` blocks, method tracks in animations, exported
  properties set in the scene, scripts attached by path or uid), `project.godot` (autoloads `Settings`, `Account`,
  `Packs`, input map), `export_presets.cfg`;
- `godot/tests/*` and `tools/godot/*` (tests and tools are callers too), environment hooks (`APEX_AUTO`,
  `APEX_PROF`, `APEX_TOUCH`, `SHOT_DIR`, `CAR_ID`… read with `OS.get_environment`), anything the game server sends or
  expects (`apps/server` is read-only for this job, but its protocol must still match);
- JSON in `godot/data` (git-ignored, but the game reads it: quality presets, packs), saved settings keys (a key that
  disappears from the code silently resets a player's setting: keep old keys readable).
Write the evidence (the searches you ran) in the progress file next to each deletion. When you're not sure, leave the
code in place and list it as "probably dead, needs your call" at the check-in.

**Tests are the reference for behaviour, not something to fix.** Never edit, weaken, skip or delete a test to get it
to pass. If a test is wrong or tests something that no longer exists, stop and tell me. You may *add* tests (see
Baseline). Solve the real problem for every input, not just the cases a test covers.

**Duplication: same concept, not same shape.** Merge code only when the copies mean the same thing and must change
together. Wait until there are three copies, or two with proof they already drifted into a bug. Two blocks that look
alike but serve different things (e.g. two circuits that will diverge) stay separate. Signs of the wrong abstraction,
which you should not create: a helper taking boolean/mode flags to act as each caller, a base class with one subclass,
a "manager" or "utils" grab-bag, a helper used once, an event bus for two nodes that could just call each other.
Duplication is cheaper than the wrong abstraction. If an existing abstraction is already wrong (callers fighting it
with flags), inline it back into the callers first, then see what's actually shared.

**Keep the project's style.** Match `apex-ghost-code-conventions`: the module header comment explaining what and why,
short lowercase `#` comments giving reasons, British spelling (tyre, kerb, colour), tunables in UPPER_CASE
dicts/consts with units, banner comments between sections. Don't bring in new patterns, frameworks or addons. Keep
comments that explain *why* (they often cite a DECISIONS.md measurement). Delete comments that only repeat the code.

**Hot paths don't allocate.** Anything that runs per physics step or per frame (vehicle, tyres, AI, race session
frame, remote interpolation, HUD updates, audio) keeps preallocated scratch values and no per-frame `Array`/`Dictionary`
/`String` building. A cleanup must not add an allocation, a signal emit, a `get_node` lookup or a string format to a
hot loop. If a cleaner version is slower, the faster version stays.

**Know these Godot traps, and don't "simplify" code that works around them:**
- A GDScript lambda captures locals by value, so a self-calling lambda lives in a dictionary
  (`var _self := {}; _self.f = func(): _self.f.call()`).
- A threaded load's result must stay referenced (`load_threaded_get`), or it is freed and reloaded on the main thread.
- A rendered run does not re-import rebuilt assets: run `godot --headless --path godot --import` first.
- Moving or renaming a script or scene: keep its `.uid` file with it, and update every `res://` path in `.tscn`,
  `.tres`, `preload`/`load` strings and tests. Delete the `.uid` together with a deleted script.
- `class_name` changes need the global class cache refreshed (`tools/godot/gd.sh` does it).

**Stay in scope.** No edits to `apps/client`, `packages/shared`, `apps/server` (for this job), `RESOURCES/`,
`godot/assets`, `godot/data` or the private car/circuit models. Nothing gets uploaded or pushed. No new features. When
you notice something outside the job, write it in the progress file's "Later" list and move on.

**Never guess about code you haven't opened.** Read a file before you say what it does or change it. Read the callers
before you change a function's signature.

## How to work

### Phase 0: baseline (before any edit)

1. `git status` must be clean apart from the untracked `reports/` and `research_notes/` (leave those alone). Note the
   starting commit in the progress file.
2. Run `tools/godot/gd.sh tests/compile_all.gd` and every **headless** test (`simtest`, `tracktest`, `roomtest`,
   `ailap`, `conntest`, `prngtest`, `chat_test`, `lapdelta_test`, `replay_test`, `pack_test`, `time_trial_test`, the
   settings/economy/progression/setup-code tests, and any other `SceneTree` or runner test that runs headless). Save
   each one's full output under `docs/code-quality/baseline/` so it can be compared later. Note which tests already
   fail: they're not yours to fix silently.
3. Record the numbers that define behaviour: simtest values, `ailap` lap times and off-track counts for every circuit
   (also with `HZ=60`), roomtest/race-tracker results, replay output. Physics and AI are deterministic, so after a
   cleanup these must come out **the same to the last printed digit**. If one moves, it's a behaviour change: find out
   why before going on.
4. Where an area you plan to refactor has no test (UI screens, lobby flow, settings migration, pit stop logic),
   **write a characterization test first**: a headless test that records what the code does now (outputs, state
   after a scripted sequence, the saved settings dictionary) and checks that later runs match. These tests record
   current behaviour, quirks included, and don't judge whether it's correct. Commit them on their own before the
   refactor.
5. Rendered baseline, **only after asking me** (a window opens; it must go on the LG monitor with `APEX_SCREEN=1`, and
   I must not close it): `session_test.gd` with `SKIP_INTRO=1 AUTODRIVE=1` for average fps and the 1 % low on one
   circuit, and `menu_test.gd` / `features_test.gd`. Performance after the job must not be worse.

### Phase 1: audit (read-only, no edits)

Map the code before changing it. Use parallel read-only subagents (Explore) per directory to save your context, and
check what they report yourself before trusting it: a subagent's "unused" is a lead, not proof.

Make `docs/code-quality/progress.md` with:
- **Inventory**: each script, its lines, what it is for in one line, who uses it (autoload / scene / class_name /
  preload).
- **Findings**, each with file:line, the evidence, the value (lines removed, files a change no longer touches, bug
  risk removed) and the risk (hot path? netcode? save format? rendered-only?). Group them: dead code, duplication,
  typing, oversized files/functions, inconsistent patterns, stale comments/debug leftovers, tests that no longer run or
  test nothing.
- **Batches**: the findings ordered from high value + low risk to low value + high risk. Dead code and typing come
  first (cheap, safe, and they make the rest easier to read), then duplication, then the big splits.
- **Later**: things outside this job.

**Check-in 1:** stop and show me the top findings, the batch plan, the numbers (lines/files today), and the "needs
your call" list. Don't edit code until I answer.

### Phase 2: guardrails

1. Switch on GDScript warnings in `godot/project.godot` (`debug/gdscript/warnings/*`; check the exact names in the
   4.7 docs or the editor before writing them): unused variable / local constant / private class variable /
   parameter / signal, unreachable code and pattern, shadowed variable and global identifier, standalone expression,
   integer division, narrowing conversion, return value discarded, and `untyped_declaration` (start it as a warning;
   make it an error once the typing batch is done). Silence a single intentional case with `@warning_ignore("…")` plus
   a one-line reason, never by switching the warning off.
2. Make `tests/compile_all.gd` print the number of warnings per script and in total (and fail on errors), so "zero new
   warnings" is a check anyone can run.
3. Commit the guardrails alone. The warning count from now on is part of every batch report.

### Phase 3: batches

One batch = one kind of change in one area, small enough to review in a few minutes (as a guide, under ~400 changed
lines). For each batch:

1. Reread the code involved and its callers (they may have changed since the audit).
2. Make the change. Don't touch anything outside the batch, even small things you notice (put them in "Later").
3. Verify: `compile_all` (0 errors, warnings not up), every headless test, and the baseline numbers identical. If
   the batch touches something only a rendered run shows (look, HUD, menus, touch layout), list it for the next
   check-in's rendered run.
4. Commit it on `main` with the project's style: one subject line, "Area: what changed (details)", e.g.
   `Cleanup: race_session's unused replay hooks and the web-port lap-chart code removed (−420 lines, no behaviour
   change)`, ending with the `Co-Authored-By` trailer. This prompt allows commits on `main` for verified batches.
   It does not allow pushes, uploads or releases.
5. Update the progress file: done, evidence, line count, warnings count, anything learnt.

If a batch fails verification and the cause isn't clear within two attempts, revert it (`git checkout` of the batch's
files, or `git reset --hard` to the last batch's commit after showing me `git status`), write down what you learnt,
and move on to the next batch. Don't pile fixes on a broken refactor.

**Splitting the big files** (last, and one subsystem per batch): look for groups of state + functions that belong
together (in `race_session.gd`: camera, pit flow, race control/flags, timing/HUD feed, replay, bots stepping, weather/
environment, audio feed) and move each into its own script owned by the session, which calls it directly. Keep the
frame order exactly as it is: the order of steps in the physics and render loop is behaviour. The session stays the
one place that sequences the frame. Don't introduce signals or an event bus where a direct call worked: signals fail
silently and hide the order. A child reports up through signals only where it already did.

**Check-in 2** after the dead-code and typing batches, **check-in 3** after duplication, **check-in 4** at the end.
At each one: lines and files before/after, warnings before/after, what was deleted and why it was safe, the baseline
comparison, and (after asking) a rendered run of the screens and race the batches touched.

### Phase 4: keep it clean (what future sessions will follow)

1. Write a root `CLAUDE.md` of **under 150 lines** with only what a session can't learn from the repo: the Godot-only
   scope, the check commands (compile_all, the headless test list, the baseline compare), the dead-code evidence list
   above, the duplication rule, hot-path rules, the Godot traps, "never edit a test to pass it", the commit style, "a
   window opens on the LG with APEX_SCREEN=1; ask first", and patterns that still exist in old code but must not be
   copied (name them). Link to this file and to DECISIONS.md rather than copying them.
2. Write a `tools/godot/check.sh` that runs compile_all plus the headless tests and compares the deterministic
   numbers with `docs/code-quality/baseline/`, and prints PASS/FAIL. Re-record the baseline only on purpose, with
   the reason in the commit.
3. **Propose** (don't install without my OK) a Claude Code Stop hook that runs `compile_all` when a `.gd` file changed,
   so a session can't finish with a script that doesn't compile.
4. Add a short DECISIONS.md section, "Code-quality pass (2026-11)": what was removed or merged, the measured
   before/after (lines, files, warnings, fps, lap times unchanged), and the rules now in CLAUDE.md.

## Context and sessions

- `docs/code-quality/progress.md` is the source of truth: update it after every batch, so a fresh session (or one
  that comes back after compaction) can carry on from it and `git log` alone.
- Use subagents for broad read-only searches and for an independent review of each finished phase. Tell the reviewer
  to report only things that affect correctness or the rules above and to skip taste. A reviewer told to find
  problems always finds some, and acting on every one of them adds the layers this job removes.
- Make independent tool calls in parallel (several greps, several file reads, several headless tests).
- Keep temporary files in the scratchpad; delete anything you made only for yourself before the end.

## Reports

Plain and short: what you did, the evidence, the numbers, what's left. Say plainly when a test failed (with its
output), when you skipped something, or when you weren't able to verify a change. Don't call something done until it
has passed the checks.
