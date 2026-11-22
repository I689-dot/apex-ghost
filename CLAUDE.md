# GridCorsa: notes for a session

What a session can't learn from the code. The why behind most numbers is in `DECISIONS.md` ("if it disagrees with
the code, the code is right"); the 2026-11 code-quality pass is `docs/prompts/code-quality-pass.md` and
`docs/code-quality/progress.md`.

## Scope and limits

- New work goes in `godot/` (the Godot app: PC and Android). `apps/client` and `packages/shared` are the old web game:
  don't edit them. `apps/server` only when the task asks for a server change.
- Ask before every push, deploy or upload (GitHub, Cloudflare, R2). An OK covers that one action, not the next.
- Never commit `RESOURCES/`, extracted sources, keys or secrets; never put a secret in the repo or the APK.
- The car and circuit models are private to this game: never publish them anywhere else. Release zips leave out the
  cars, Silverstone and `spa_g`. Nothing may be taken from ACC's files (models, textures).
- `godot/assets` and `godot/data/*` are git-ignored (they come from the draft release and the build tools).

## Checks

- The engine: `~/.local/opt/godot/godot` (4.7.2), or `$GODOT`.
- `tools/godot/gd.sh tests/<test>.gd [godot args] [-- test args]`: a headless test, after refreshing the global class
  cache. Scripts starting `extends Node` run inside `tests/runner.tscn` (autoloads present).
- `tools/godot/gd.sh tests/compile_all.gd < /dev/null`: every script compiles, then the warning count. It must say
  `0 failed`. Untyped declarations are an error in `godot/scripts`.
- A Stop hook (`.claude/settings.json`, committed although `.claude/` is otherwise git-ignored) runs that compile when a `.gd` file under
  `godot/` changed: a session can't finish with a script that doesn't compile.
- `tools/godot/check.sh`: compile_all, every headless test, and their deterministic numbers (simtest, tracktest,
  roomtest, ailap at 120 and 60 Hz, replay, settings...) against `docs/code-quality/baseline/`. PASS or FAIL.
  Physics and AI are deterministic: after a change that should not change behaviour, the numbers match to the last
  digit. Re-record the baseline only on purpose, with the reason in the commit.
- **A rendered test opens a window: say so before you start one, and put it on the LG monitor with `APEX_SCREEN=1`.**
  `APEX_SCREEN=1 ~/.local/opt/godot/godot --path godot --disable-vsync --always-on-top res://tests/runner.tscn --
  res://tests/<test>.gd`. Rendered: `features_test` (in-car adjustments, chat, replay), `race_test` (a whole weekend;
  `RULES='{"contact": true, "pitWindow": true, "fuel": true}'`), `menu_buttons_test`, `session_test`. The app's
  own tours: `APEX_AUTO=ui|solo|intro SHOT_DIR=<dir>` (DevTours).
- A rendered run doesn't re-import rebuilt assets: run `godot --headless --path godot --import` first.
- menu_test and a few others talk to the live server; the account and economy tests use a local one
  (`APEX_SERVER=http://127.0.0.1:8799`, `wrangler dev` in apps/server). Never point a test at the live server's
  accounts.

## Rules

- **Behaviour.** A cleanup changes no gameplay, physics, AI lap, timing, netcode, save format or look. A bug found on
  the way is fixed in its own `Fix:` commit with a measurement and "changes behaviour".
- **Tests are the reference.** Never edit, weaken, skip or delete a test to make it pass. If a test is wrong, say so.
  Adding a test is fine.
- **Dead code needs proof.** GDScript is dynamic: a symbol is unused only after searching string calls (`call`,
  `call_deferred`, `callv`, `has_method`, `Callable(obj, "x")`, `get`/`set`, `connect("sig")`, `emit_signal`,
  dispatch dictionaries), `.tscn`/`.tres`, `project.godot` (autoloads Settings, Account, Packs; the input map),
  `export_presets.cfg`, `godot/tests`, `tools/godot`, env hooks (`APEX_*`, `SHOT_DIR`, `CAR_ID`...), what the server
  sends, `godot/data` JSON, and saved settings keys (keep old keys readable).
- **Duplication: same concept, not same shape.** Merge when copies mean the same thing and must change together:
  three copies, or two that already drifted into a bug. No helper with mode flags, no base class with one subclass,
  no "utils" grab-bag, no helper used once.
- **Hot paths don't allocate.** Per step or per frame (vehicle, tyres, AI, the session's frame, remote cars, HUD,
  audio): preallocated scratch values, no `Array`/`Dictionary`/`String` built per frame, no new signal emit,
  `get_node` or string format in a hot loop. If the cleaner version is slower, the faster one stays.
- **Style.** A header comment saying what and why; short `#` comments giving reasons (often a DECISIONS.md
  measurement); British spelling (tyre, kerb, colour); tunables in UPPER_CASE with units; banner comments between
  sections; typed everything (`Variant` only for JSON, nullable values and optional arguments). UI is built in code
  (UIKit, UIW); every player-facing string through `I18n.t`.

## Godot traps (don't "simplify" these away)

- A lambda captures locals by value: a self-calling lambda lives in a dictionary (`_self.f = func(): _self.f.call()`).
- A threaded load's result must stay referenced (`load_threaded_get`), or it is freed and loaded again on the main
  thread.
- Moving or renaming a script: keep its `.uid` with it and update every `res://` path; delete the `.uid` with a
  deleted script. A `class_name` change needs the class cache refreshed (gd.sh does it).
- The root takes no child while the first scene sets up: a node that may work at boot (the Account autoload's
  requests) passes itself as the parent (`JsonHttp.request(..., self)`).
- A typed loop variable fails on a freed object: lists that can hold freed nodes stay `Variant`.
- `compile_all` with `--debug` stops in the debugger on a script error (it reads errors from a run without it).
- `get_instance_id()` follows how many objects the engine made before: never seed behaviour from it (bots seed from
  their id: `AiDriver.set_seed`).

## Where things are

- **The race session is a chain of layers, one object:** `SessionBase` (state, Remote / LocalBot, shared helpers) ->
  `SessionCameras` -> `SessionReplay` -> `SessionContact` -> `SessionBots` -> `SessionRaceControl` -> `SessionPits`
  -> `SessionHudFeed` -> `SessionWorld` -> `RaceSession` (loading, networking, the physics and frame loops,
  teardown), each in `godot/scripts/game/session_*.gd`. A layer calls only what it and the layers below declare (the
  compiler checks it); a field one layer uses lives in that layer. New session code goes in the layer of its
  subsystem. The frame order in `_process` / `_physics_process` is load-bearing: don't reorder it.
- The UI widget classes are in `godot/scripts/ui/widgets/`, reached as `UIW.TabButton`, `UIW.Switch`, `UIW.Stepper`,
  `UIW.Hatch`, `UIW.WeatherIcon` (preloaded constants).
- Shared helpers: `JsonFile` (the player's saves under user://), `JsonHttp` (a JSON request to the game server),
  `UIKit.fmt_lap`, `UIW.bar`, `CarStudio.my_car`, `App.join_code` (a typed code, a device-hosted race included),
  `App.go_back` / `App.top_modal`. Use them rather than writing another copy.
- The briefing is `BriefingScreen`; the app's dev automation is `DevTours`.

## Old patterns not to copy

- Static mutable UI state set from other files (`MenuScreen._tab`, `LobbyScreen._page`, `BriefingScreen._brief_tab`):
  existing, but a new screen keeps its state to itself.
- Reaching another class's `_private` members.
- `Hud` building its own `UIKit.theme` (a modal after a race gets another Theme instance than `app.ui`).
- Work done while rendering: `ResultsScreen.build` scores the championship as it builds the screen.
- Long functions in hot code (`Vehicle.step`, `AiDriver.update`): add to them only with a measurement.

## Commits

On `main`, one verified change each. The subject says the kind and what, the body why and how it was checked:
`Fix: ... ; measured: ...; changes behaviour (...)`, `Split: ...; checked: ...`, `Duplication: ...`, `Cleanup: ...`.
End with the `Co-Authored-By` line the session gives. Nothing is pushed without asking.
