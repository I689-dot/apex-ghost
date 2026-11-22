# Code-quality pass: progress

The job is described in `docs/prompts/code-quality-pass.md`. This file carries its state between sessions: read it
together with `git log`.

## State

- **Phase:** check-in 3 (2026-11-22): batch 4 (duplication) done; batch 5 (splits) waits for the user's answers.
- **Numbers at check-in 3:** 153 scripts (two helpers added: JsonFile, JsonHttp), 34,060 lines (34,140 at check-in 2),
  676 warnings (689). One behaviour fix in the batch: the phone's Join (2eb818d).
- **Questions at check-in 3:** batch 5 go-ahead; the server quota's fix; the bots' randomness from their instance id.
- **Done after check-in 2:**
  - The safety car: build-cars.py repoints an entry whose file is gone. data/cars.json is fixed here (it is
    git-ignored); a race with race control no longer logs "Resource file not found".
  - race_test's order check now orders by laps, then time, and the test prints a bot's pit state when its distance
    stands still.
  - **The "stuck" bot is not a bug.** The tracker does not advance a car's distance in the pit lane, and a bot on a
    long stop near the end (driver change, repairs, tyres: 1 to 2 minutes) is classified at the flag where it is, as
    the tracker means (cars in the garage when it falls). The diagnostic showed every "standing" bot moving at the
    pit limiter or serving its stop.
  - **ailap's baseline re-recorded (2026-11-22).** Layouts 0-3 drifted from the baseline after about 140 s on the
    same code. A bot's mistake roll is seeded with `hash(get_instance_id())`, and an object's id depends on how many
    objects the engine made before it: one extra `RefCounted.new()` before the test moves layout 0's lap from 2:04.922
    to 2:04.943. So the lap times follow the engine's object count as well as the code. Proof that the code did not
    cause it: the baseline's own commit (5f19051), run today in a scratch worktree, gives exactly today's 16 outputs.
    Those 16 outputs are now the baseline.
  - **When ailap differs: `docs/code-quality/ailap_seeded.sh`.** The pace a bot varies per 25 m stretch is hashed from
    its instance id too (ai.gd `_pace`), so with the seed alone fixed the laps still moved. The script runs HEAD and
    the working tree in two scratch worktrees with both ids replaced by constants; the 16 laps must match exactly.
    The JSON / HTTP merge loads two new scripts at boot and moved every lap in the baseline; seeded, 16 of 16 match.
  - baseline.sh stops a test after 15 min (exit 124), and compare.sh keeps each test's exit code (it dropped the
    whole line with the time). A script error in my HTTP merge hung guest_test and with it the whole run.
  - menu_test talks to the live server: whether the store's invite answer arrives after its page is gone ("Lambda
    capture ... was freed") depends on the server's timing. Its 50 checks are what counts.
- **Batch 4 so far (duplication):**
  - Lap-time formatter and the player's car: one copy each (committed).
  - JSON saves: 8 copies of "read a dictionary, else {}" / "write it" / "delete it" -> JsonFile (settings, career,
    championship, progression, track packs, touch prefs, account, device key). The res:// data reads stay: each
    handles its own file.
  - Server requests: 4 copies -> JsonHttp.request (account, create room, room list, P2P relay), and its "Cannot reach
    the game server" message. The first version added every request under the root, which takes no child while the
    first scene sets up: the sign-in at boot failed (guest_test). The Account autoload passes itself, as before.
  - Looks: the kerb grain comes from kerb_re alone, ahead of each detail list (each profile wrote its kerb regex
    twice; the Nordschleife's drifted, bug 5); the road scan's albedo, the forest tint and the gravel scan's tile
    named once in SpaLook. Inside spa_look: one image preparation (3 copies), one regrain (2), one world-space scan
    under the road and gravel surfaces (2), _road_file gone (it was _scan_file("asphalt_track")). Measured by a probe
    that builds every layout at Ultra and lists each material (detail layer and tile, uv, albedo, textures with the
    repainted ones' pixel hashes, roughness, specular): 1,810 lines identical before and after.
  - Left alone, under the rule (two copies, no bug): StoreScreen.fmt / CareerScreen._thousands, Hud.fmt_time /
    ResultsScreen.fmt_time, CareerScreen._name / MobileHome.nick, UIW.row / SettingsPanel._row (the panel's has its
    help hooks), the row-line style. The env's "white" stays in each look (AgX ignores it, but it is a setting each
    passes on). The "anything but toasts and perf" overlay test is another question than "a modal is open".
  - **Fixed (2eb818d): the phone's Join could not reach a race hosted on a device.** Only the classic menu called
    P2p.is_p2p_code, which marks the code as a device's (Connection then connects over WebRTC); the phone's Join went
    to app.join straight away and Connection took the code for a server room. Both now use App.join_code. Measured
    against a local server with the race hosted in another process: before, the phone's way opened 6 WebSockets to
    a server room of that code and had not joined after 60 s; the menu's way and App.join_code joined.
  - Bars: UIW.bar (9 copies). Back navigation: the phone's back button takes go_back's steps (App.top_modal for the
    top modal) and keeps its own (pause the race, close the app from the classic menu, leave the results, a lobby,
    the briefing, watching). Kept apart on purpose: Esc does not leave a lobby or the results.
  - race_session's pit service: serve (the end of a stop: tyres with their grip, fuel), fuel_to_add, avg_wear,
    nominal_fuel_per_lap and TYRE_OUT_C, shared by the bots and me. Measured: a probe ran 400 random stops (wear,
    fuel, plans, weather) through the old inline code and the helpers on two real vehicles: 0 different.
  - **The PC tonight (2026-11-22 ~03:40): any window stalls 1 s every 1.1 s,** an empty one too and on the code
    before these changes (probe: 6 long frames of 1,001-1,003 ms in 6 s). Likely the screens asleep (Wayland: no DPMS
    query). Rendered frame times are not usable until it is gone; menu_buttons_test's presses all ran.
- **The user's answers at check-in 2:**
  - Find the cause of the server's exhausted quota.
  - Fix the safety car's missing lod1.glb now.
  - Investigate the bot stuck in its pit box, and fix race_test's order check (editing that test is allowed).
  - Then go on with batch 4.
- **The server's quota, the cause (Cloudflare analytics: read-only, the user's own wrangler login):**
  - The RoomDO class alone made a steady **~2,400 requests an hour until 13:00 UTC on 2026-11-20, then ~4,200 an
    hour**, at night too, with every other class near 0. 4,200 x 24 is about 100,800 a day, just over the free tier's
    100,000, so the quota ran out at about 21:00 UTC on 11-21.
  - The traffic stopped there and did not come back after the reset (0 requests in a minute of the live log after
    it). That is what WebSocket clients do when the server drops them; a room's alarm would have come back.
  - A connected Godot client sends a clock ping every 3 s after its first burst, plus a keepalive every 20 s: about
    1,380 messages an hour, and a Durable Object counts each received message. **Two or three clients left
    connected to rooms around the clock** fit the numbers.
  - No game is running on this PC now, and the phone is not on USB, so which clients it was is not known: this PC,
    the user's other machine, the phone, or the old web game.
  - **Fixes for the user to choose** (each needs an APK or a server deploy):
    - ping every 15-30 s once the clock is synced;
    - the server closes a lobby's connections after about 30 idle minutes;
    - Cloudflare's paid Workers plan ($5 a month).
- **Numbers at check-in 2**, against the start:
  - scripts: 151 (152);
  - lines: 34,140 (35,232: −1,092);
  - warnings: 689 distinct. The start's 2,433 was measured with the corrected counter before typing; the first
    counter's 221 left out untyped declarations.
  - Of the 689, 500 are "return value discarded"; the rest are 56 integer divisions, 36 incompatible ternaries,
    about 60 shadowings and a few smaller kinds.
  - **No untyped declaration is left in godot/scripts, and `untyped_declaration` is an error there now.**
    godot/tests is left out by a directory rule, as res://addons already was, because this job does not edit tests.
  - 31 commits since `5f19051`: 7 of them are fixes, each with its measurement.
- **Found at the end of batch 3: the live server was down.** Every Durable Object request failed with "Exceeded
  allowed volume of requests in Durable Objects free tier" (rooms and accounts: error 1101, seen with `wrangler
  tail`). It worked again after the daily reset at 00:00 UTC. My test runs make only a handful of live requests each,
  so something else used up the day's allowance. The user stopped the investigation (watching the live log after the
  reset), so it is a question for check-in 2.
- **compile_all, again:** an error in its `--debug` run stopped that run in the stdout debugger. With an open stdin
  the check hung; with an empty one it passed a broken script. Errors now come from a run without `--debug`, and the
  warnings are counted only when there are none (`ca2b6f8`).
- **Found while checking game/'s typing** (not fixed, for check-in 2):
  - **A bot can stay in its pit box until the end of the race**, with pitWindow, raceControl, contact and fuel on
    (Zandvoort, 4 laps). It happened both after the typing and with game/ as it was before it, so it is not the
    typing.
  - **race_test's "finishers in order of their race time" check ignores laps.** A finisher a lap down has a lower
    total, so the check fails whenever a car is lapped (it failed after the typing, passed before by chance). It is
    a test, so it is the user's call.
  - **My car dedupe (0cf4ad1) broke the safety car's middle model.** aston_martin_vantage_safety_car in
    data/cars.json still points at vantage_gt3_evo_heart_of_racing/lod1.glb, which the dedupe removed ("Resource
    file not found" in every race with a safety car). The fix is in godot/data (outside this job): point it at
    lod0.glb, as the Vantage's own entry does.
- **Typing rules used (keep them for game/ and app/):**
  - A precise type only where the value's type is certain from the code. A JSON value, a "TS number|null" field or
    an optional argument is an explicit `Variant`.
  - **Before typing a parameter, read what every caller passes**, `null` included. `_launch(race_grid: Array)` broke
    on a caller's literal `null`; the full suite caught it, and it is `Variant` now.
  - A variable's type comes from how it is used, not from its first value: `var x = 0` that later takes `+= 0.5` is a
    float.
  - An inner class is written with its class (`TireModel.TireParams`, `RaceTracker.PlayerRaceState`).
  - Two scratchpad tools (not kept):
    - `untyped.py` lists the places from compile_all's `--debug` output, with the source line.
    - `autotype.py` types only two safe forms, and prints every change: a statement lambda, typed `-> void`; a loop
      over a written-out list of one kind of literal.
  - Each folder: the full headless suite through compare.sh, plus the rendered checks for the code it touches.
- **Typing commits:**
  - `93b5344` input, physics, audio (2,433 → 2,383).
  - `fb6fc0b` net, shared (→ 2,133).
  - `8e8a302` ui (→ 1,934).
  - `6b8761f` game/, the mechanical part (→ 1,814).
  - `18a79a4` game/'s smaller scripts (→ 1,659).
  - `9cf08aa` race_session, car_visual, track_scene, spa_look (→ 1,449).
  - `0634ecf` app/, the mechanical part (→ 1,150).
  - `d7e31d0` the lobby and the settings panel (→ 926).
  - `d6bc849` the rest of app/ (→ 700).
  - `9e1d8e5` the last places; untyped_declaration is an error (→ 689).
- **Kept Variant on purpose:**
  - A loop over objects that may already be freed. The replay's saved visuals are checked with is_instance_valid,
    and a typed variable refuses a freed object.
  - car_visual's `_inside`: null until set_inside() first runs. As a bool it would start false and skip the first
    call.
- **audiotest's bus count is not deterministic.** The engine voices' buses are freed on real-time timers: once
  under load it printed 8, otherwise 9. compare.sh leaves it out (`754efb1`).
- **Size and warnings after batch 2:**
  - Scripts and lines: 151 scripts (152 at the start), 34,138 lines (35,232 at the start, −1,094).
  - Warnings: **2,433 distinct**, counted by the corrected compile_all (`fe65a16`). The 2,488 and 2,591 reported
    before were from the first counter. It counted only the scripts that happened to compile first, so the number
    moved with the load order, and it counted some warnings twice. No unused-name warning is left.
  - The corrected compile_all reloads every script in its `--debug` run and also fails on any script error. Before,
    a script that compiled only in part still loaded and passed: it happened once during typing, with an inner-class
    type written without its class (`TireParams` for `TireModel.TireParams`).
- **Batch 2 commits.** Each one compiled, passed the full headless suite through `compare.sh` (PASS: identical to the
  baseline), and passed the rendered features_test, a session, and, for the UI, rendered menu_test, the phone shots
  and a HUD shot.
  - `7d6d3aa` race_session: the radio and the never-read members (−214 lines).
  - `90fdf4b` the pit crews: pit_crews.gd deleted, as the user answered (−596 lines).
  - `3b6a423` shared, net, physics, input, audio (−83 lines).
  - `73d82cb` game/, and the dev knobs the user asked to remove (−167 lines).
  - `babdb41` app/ and ui/ (−48 lines).
  - `f4b84b6` **Fix** (behaviour): the phone's Paint button opened the Car page, which the new
    `tests/phone_paint_test.gd` shows; plus two out-of-date texts.
- **Kept after checking**, where the audit's lead did not hold:
  - `LocalRoom._next_id`: read through the class name, which the warning does not see; now marked with
    `@warning_ignore`.
  - `TireModel.force()`: the reference that the inlined fast path's comment points to.
  - hud.gd's two `circuit_map.visible` writes: one only on touch, before a re-layout.
  - the one-line `[look] materials` load summary (a deliberate trace, like `[boot]`).
  - the career's `owned` and `daily` save keys, which are no longer read.
- **Pre-existing, noted:** a rendered session prints the same leak counts at exit before and after (66 text shapes,
  9 textures, 178 objects). That is for the Later list.
- **The scratchpad was wiped overnight** (2026-11-21). `baseline.sh` and `compare.sh` live in this folder; the
  `inventory.py` script must be written again when phase 4 moves it to `tools/godot/`.
- **After the bug fixes, the headless baseline is unchanged.** A third run, after the fixes, matches the first. The
  only difference was the order of two menu_test lines, which are printed asynchronously; compare that test's lines
  sorted.
- **Guardrails (phase 2):**
  - `project.godot` now sets `debug/gdscript/warnings/untyped_declaration=1` and `return_value_discarded=1`. Every
    other warning the job asks for was already on by default.
  - `tests/compile_all.gd` still fails when a script does not compile. It now also starts itself again with `--debug`
    and prints the warnings per script, per kind, and in total. `WARNINGS=0` compiles only.
  - `held` (app.gd, the threaded load kept referenced) carries `@warning_ignore("unused_variable")` with its reason.
- **Warnings at the guardrails, by the first counter** (the per-kind table stays as a rough guide; the counts from batch 2 on are
  the corrected counter's): **2,591 in 131 scripts.** By kind:

  | Kind | Count |
  |---|---:|
  | Function without a return type (lambdas included) | 625 |
  | `for` variable without a type | 531 |
  | Return value discarded | 507 |
  | Parameter without a type | 386 |
  | Variable without a type | 322 |
  | Everything else | 220 |

  The `untyped_declaration` part is batch 3's work. `return_value_discarded` is mostly `connect()`, `append`-like
  calls and `await`ed values that are ignored on purpose; it stays a warning and is not a target.
- **Bug fixes done**, each in its own commit with its measurement:
  - `410126a` gd.sh passes runner-test arguments. Before, `-- 5 x` hung the run.
  - `e3743b4` the phone home's Settings gear applies changes at once. The new `tests/phone_settings_test.gd` checks
    it: the master bus stayed at −3.9 dB before the fix and goes to −40.0 dB after, for a slider at 0.1.
  - `51bbbf2` the forest cards are 256 px on High and Ultra. At Spa they were 128x268 before and 256x537 after;
    Medium and Low are unchanged at 128x268.
  - `6fe2182` each circuit's own sky with the Forward+ ratio on the PC. Every circuit was 0.620; now Zandvoort
    0.602, Silverstone and Barcelona 0.638, Shanghai 0.567, Spa and the Nürburgring 0.620. The Mobile values are
    unchanged.
  - `6019b1d` the Nordschleife's `curb_ns` gets the kerb grain on High and Ultra.
  - `50fcccf` inspect_car.gd skips the levels the car dedupe keeps once.
  - Not fixed here: `setLivery` (a server change, under Later). The drift items in F3.7 are left for the
    duplication batches: each is fixed in its own commit when its batch reaches it.
- **Frame rates depend on what else the PC is doing.** After the fixes, Spa Ultra gave 75.9 / 78.6 fps, and the same
  run with the old forest.gd gave 75.4 / 81.6. The browser was using about 80 % of a CPU and the GPU was 22 % busy
  before the test started. Rule: compare frame rates only back to back, old code against new code, in the same
  conditions; never against the baseline file from another time.
- **The user's answers at check-in 1:**
  - **Pit crews:** delete `pit_crews.gd` and the crew code in race_session.gd.
  - **Dev knobs:** remove the look, paint and line knobs (SPA_LOOK, SPA_TINT, LOOK_ROLES, SPA_DEBUG, MUL_GAIN,
    FOREST_NO_FADE, CAR_DEPTH, LINE_MARGIN, SIDE_SCREENS); keep APEX_PACKS_TRACE and APEX_PACKS_AUTO.
  - **Bugs:** fix them first, each in its own commit with a before/after measurement, before the cleanup batches.
    Their new numbers become the baseline.
  - **Rendered baseline:** run it now.
  - **My defaults, not objected to:**
    - delete the radio code;
    - keep room_core's server-mirroring paths;
    - keep `I18n.t`;
    - keep the diagnostic test scripts as tools;
    - fix the `cockpit.glb` path in `inspect_car.gd`.
- **Starting commit:** `5f19051` (2026-11-20). The tree was clean apart from the untracked `reports/`,
  `research_notes/` and `docs/prompts/code-quality-pass.md`.
- **Size today:** 152 scripts under `godot/scripts`, 35,232 lines, and 44 test scripts plus `runner.gd`.
- **Warnings today:** 221 with Godot's default warning settings (`project.godot` sets none). Counted with
  `godot --headless --path godot --debug -s tests/compile_all.gd`, which prints them; a run without `--debug`
  prints none. The list is in `baseline/warnings.txt`.
  - By kind: 62 integer division, 35 incompatible ternary, 22 + 10 + 9 + 7 shadowing, 10 unused parameter, 9 unused
    class variable, 8 declared below in the parent block, 8 int used as enum, 7 static called on an instance, 6 named
    like a built-in function.
  - `untyped_declaration` and `return_value_discarded` are off by default. Every other warning the job lists is
    already on.
- **Typing today**, counted by `inventory.py` (see below):
  - 321 `var x = …` without a type.
  - 31 of 1,623 functions without `-> T`.
  - 69 of 2,441 parameters without a type.
  - Also untyped, and not counted above: most lambda parameters, most `for` variables, and the many bare `Array`
    and `Dictionary` annotations.

## Baseline (phase 0)

All outputs are in `docs/code-quality/baseline/`, one file per test.

- **Runner:** `docs/code-quality/baseline.sh <out dir>`. It was run twice; the second run went to the scratchpad.
- **Tests run headless (all exit 0):**
  - compile_all (152 scripts, 0 failed);
  - prngtest, chat_test, lapdelta_test, replay_test, time_trial_test, settings_test, setup_codes_test,
    progression_test, signin_test, audiotest, devices_test, hud_layout_test, conntest, menu_test (50 checks);
  - roomtest;
  - tracktest for all 8 layouts;
  - simtest for all 10 race cars;
  - pack_test, against the local `pack-server.py`, with the connection cut part-way;
  - economy_test and guest_test, against a local `wrangler dev` on :8799;
  - ailap for all 8 layouts, at 120 Hz and at 60 Hz.
- **No test failed before the job.**
- **Determinism:** the two runs are identical to the last printed digit for ailap, simtest, tracktest, roomtest,
  replay_test and every other deterministic output, once timing lines (ms, s, fps) are left out. The only
  differences are random ids: conntest's room ids, economy_test's invite code, guest_test's numbered name, and the
  leaked-object count signin_test prints at exit.
- **The numbers that define behaviour.** ailap: skill 0.97, Porsche 992 GT3 R, second lap. "Off" means times off
  the track.

  | Layout | 120 Hz | 60 Hz |
  |---|---|---|
  | 0 nurburgring_gp_2022 | 2:05.144, 0 resets, 0 off | 2:04.771, 0, 0 |
  | 1 nurburgring_short | 1:45.700, 0, 2 off | 1:46.014, 0, 2 |
  | 2 nurburgring_24h | 10:32.213, 3 resets, 30 off | 10:16.842, 3, 19 |
  | 3 spa | 2:29.162, 0, 0 | 2:29.617, 0, 0 |
  | 4 zandvoort | 1:46.305, 0, 0 | 1:46.693, 0, 0 |
  | 5 silverstone | 2:09.348, 0, 0 | 2:09.732, 0, 0 |
  | 6 shanghai | 2:06.824, 0, 0 | 2:06.989, 0, 0 |
  | 7 barcelona | 1:44.815, 0, 0 | 1:45.137, 0, 0 |

  simtest, Porsche: 0-100 km/h in 4.14 s, 0-200 km/h in 11.56 s, top speed 274 km/h in 45 s, braking 200→0 in
  86.1 m and 3.29 s. Every car's numbers are in `simtest_*.txt`.
- **Rendered baseline** (2026-11-20, the LG monitor, RX 7600 XT, files `baseline/rendered_*.txt`):
  - `session_test`, Spa, Ultra, 1600x900, 40 s, `SKIP_INTRO=1 AUTODRIVE=1`, `--disable-vsync`: run 1 was 91.4 fps
    average with a 63.5 fps 1 % low; run 2 was 85.6 / 51.6.
  - The same run varies by about 7 % on the average and 20 % on the 1 % low. A later run counts as worse only
    outside that range: compare the best of two runs.
  - `features_test` (640x360) and rendered `menu_test` (1600x900): 0 failures.
- **Still to write:** the characterization tests for the areas phase 3 will touch that have no test yet, each
  committed on its own before its batch:
  - lobby and briefing flow;
  - settings migration and old saves;
  - pit stop, service and driver change;
  - results and championship scoring;
  - back navigation.

## Inventory

Generated by `inventory.py` (in the session scratchpad for now; it moves to `tools/godot/` in phase 4).
- "Files referring" counts the other scripts, tests, scenes, tools and project files that name the class or the
  `res://` path.
- Every script has at least one reference, so no whole file is unreferenced.
- `pit_crews.gd` and `tv_cameras.gd` are reached only through guarded paths.

See `inventory.md` in this folder: 152 rows of path, lines, class_name, referrers, the typing counts and the header's
first line.

## Findings

Every dead-code item below was checked by hand after the audit agents reported it. The check was a whole-word
`grep -rnw <name> godot/scripts godot/tests godot/scenes tools/godot`, which also matches the name inside quoted
strings, so it covers `call("x")`, `has_method("x")`, `Callable(o, "x")`, `connect("x")` and dispatch keys.
Unless a line says otherwise, the only hit was the declaration itself. `project.godot` and `export_presets.cfg`
contain none of these names.

### F1. Dead code, confirmed (low risk, about 600 lines)

- **race_session.gd**
  - Members: `perf` 237, `_acc_time` 241, `_replay_hint` 177, `Remote.last_damage_version` 49.
  - Written but never read: `finish_deadline` 124, `disposed` 126 (its other hit, at 270, is a comment),
    `car_probe` 3553, `Remote.node` 65.
  - `_collect_env_materials` 729 has `pass` as its body.
  - The no-op `r.visual.wheel_out = r.visual.wheel_out` at 2283.
  - The always-true guard `has_method("_touching_car")` at 1286.
- **race_session.gd radio:** `radio` is declared `null` (220) and nothing in `godot/` assigns it. That makes `_say`,
  `radio_frame` (3111-3217) and `radio_lap` (3220-3249) no-ops, and `spot` (206, 3431-3438) bookkeeping for them.
  MIGRATION.md lists `radio.ts` as not ported ("no voice files are shipped"). About 170 lines.
- **shared/**
  - constants.gd: `GAME_NAME` 5, `PACKET_HZ` 39, `RESET_PENALTY_MS` 53, `PHYSICS_HZ` 60.
  - protocol.gd: `PHASES` 9, `SESSION_KINDS` 13, `encode_json` 182.
  - validation.gd: `generate_room_code` 42 (p2p.gd builds codes inline).
  - accounts.gd: `is_presence` 19.
  - track_math.gd: `gate_side` 6.
- **net/**
  - connection.gd: `resync` 243, and `signal state_changed` 9, which is emitted with no listener.
  - remote_car_buffer.gd: `newest_time` 61.
  - local_room.gd: `_next_id` 14.
- **physics/ and input/**
  - vehicle.gd: `set_tyre_temps` 166, `rpm_ratio` 260, `wheel_omega_at` 267, `_tmp_hit` 73, the local `CH` at 746.
  - drivetrain.gd: `is_shifting` 209.
  - tire_model.gd: `force()` 252 (`.force(` has 0 hits).
  - damage_state.gd: `ZONES` 6.
  - device_bindings.gd: `_held` 49.
  - gamepad_input.gd: `controller_connected` 232.
  - pad_map.gd: `plausible` 71.
- **audio/**
  - game_audio.gd: `worklet_ok` 14, `level` 81, `when_ready` 88.
  - engine_voice.gd: `_fade` 36. ambience.gd: `_birds` 15.
- **game/**
  - career.gd 246-292: the garage (`init_garage`, `owns_car`, `buy_car`, `claim_daily`). The save keys `owned` and
    `daily` stay readable: they are simply no longer touched.
  - top_view.gd: `render_top_view` 88-110, the `Picture` class and the `with_light` branch.
  - track_scene.gd: `materials()` 255; `kerb_materials` and `collision_bodies` are written but never read; the local
    `mats` at 243.
  - config.gd: `WEB_URL`, `is_dev`.
  - environment_ctrl.gd: `DUSK_C`, `env_intensity`, and the unused parameter `q` of `_apply_eye`.
  - forest.gd: `set_wind_strength`.
  - ghost.gd `has_ghost`, lap_delta.gd `has_reference`, progression.gd `max_trophies`.
  - settings.gd: `CONTROL_ACTIONS`.
  - ai.gd: `dbg_vt` is written, never read.
  - cockpit_camera.gd: the `viewport_size` parameter.
- **app/ and ui/**
  - ui_kit.gd: `fmt_gap` 237, `fmt_clock` 240 (RaceSession's copy is the one used), `PANEL`, `PANEL_SOLID`.
  - ui_widgets.gd: `margin` 35, `toggle` 151.
  - mobile_ui.gd: `GLASS_HI`. touch_controls.gd: `ICON_LEFT`, `ICON_RIGHT`.
  - app.gd: `browsing`.
  - lobby_screen.gd: `_adv_open`, `_hero_rects` and its doc line (`data/car_hero_rects.json` has no reader).
  - pit_menu.gd: `_repair_boxes`. race_overlays.gd: `drivers`.
  - Unused locals in mobile_modes.gd: `total`, `id`, `races`.
  - Unused parameters: lobby `_event_page(is_host)`, `_player_row(all_cars)`; menu `_driver_chip(sign_in)`.
  - No-op statements:
    - hud.gd:138 `_lap_tag = _lap_tag`, and the Label made at :8 is thrown away at :103.
    - hud.gd:502 `_msg_panel.get_parent()`.
    - hud.gd:399-402 sets `circuit_map.visible = full` twice.
    - menu_screen.gd:198-200 is `if … != null: pass else:`.
- **Debug print left in:** race_session.gd:657 `[crowd]`, and spa_look.gd:551, which prints unconditionally on every
  track load. The `[boot]` traces and `prof.gd` are deliberate.
- **Stale comments**, rewritten in the same batch as the code they describe:
  - race_session.gd:6-7 and 642 on optional modules and the radio; 92, the `cb` keys; 192; 3440, a teardown banner
    above `_update_spray`.
  - room_core.gd:4 says the Cloudflare server drives this logic (it runs room.ts); :273 "Reload the page."
  - spa_look.gd:6 says the other circuits never pass through it; track_scene.gd:6, 93; forest.gd:92, 112.
  - Names of classes that don't exist: car_visual.gd:10 "QualityConfig", settings.gd:22 "InputMapper",
    track_scene.gd:6 "TrackShading".
  - top_view.gd:3-5, career.gd:4-6, graphics.gd:3.
  - app.gd:795 "once per install" (`introSeen` is never read).
  - mobile_home.gd:129 and 447; mobile_modes.gd:204 and 327 (the wrong settings page); social_ui.gd:389.
  - The headers of the tests settings_test.gd and menu_test.gd still say "both languages". Those are test headers:
    not touched without the user's OK.

### F2. Dead or switched off: needs the user's call (see check-in)

- **pit_crews.gd** (528 lines), plus the crew code in race_session.gd (`crews`, `update_crews`, `_crew_*`,
  2777-2782, 2941-2952, 3078-3105). Switched off by `const SHOW_PIT_CREWS := false`, the user's choice on
  2026-11-16: "no people in the boxes". `set_models` and `load_crew_models` are never called, so even switched on,
  only the plain path could run. The guard at 2946 checks for `pit_crew.gd` (the timeline, which exists), not
  `pit_crews.gd`.
- **room_core.gd** `restore` 97 and `reattach` 131 are the server's hibernation paths; the Godot app never calls them.
  `env.persist` is a no-op in local_room, so `_persist` (13 calls) serializes for nothing. `env.report` and
  `env.record` are never set, so `_report` and the record blocks never run in the app. All of it mirrors room.ts.
- **Dev environment hooks** that nothing in the repo or in `~/apex-ghost-sources` sets: SPA_LOOK, SPA_TINT,
  LOOK_ROLES, SPA_DEBUG (spa_look.gd); MUL_GAIN, FOREST_NO_FADE (forest.gd); CAR_DEPTH (car_paint.gd);
  APEX_PACKS_TRACE, APEX_PACKS_AUTO (track_packs.gd); SIDE_SCREENS (race_session.gd:524, and this one writes a
  saved setting); LINE_MARGIN (ai.gd:224).
- **touch_controls.gd** `cine` and `boxed` (35-37) are never set anywhere. So the touch "skip" widget never shows,
  `skip_intro` never fires, and app.gd:607's connect is dead. This may be missing wiring rather than dead code.
- **I18n.t** (game/i18n.gd, 18 lines) returns the English text with `{vars}` filled in. There is no translation table
  any more, and there are 1,543 call sites. Removing it would touch about 40 files for little gain; the proposal is
  to keep it.
- **`introSeen`** (written at app.gd:828, never read) and **`lastTrack`** (only listed in NOT_IN_PRESETS) are saved
  keys. Proposal: keep them readable, stop writing `introSeen`.
- **Diagnostic test scripts that check nothing** (always exit 0): ailap, audiotest, conntest, corners_print,
  dent_bench, inspect_car, inspect_cockpit, kerb_test, menu_buttons_test, prngtest, simtest, tracktest, p2pguest,
  and p2ptest unless hosting itself fails. Proposal: keep them as tools. `check.sh` compares their numbers with the
  baseline, which is what makes them checks.
- **inspect_car.gd** has been broken since the car dedupe (0cf4ad1): it loads `cockpit.glb`, which no car has any
  more. It is a diagnostic, not a test, but editing a test-folder script needs the user's OK. Fix the path, or delete
  it.

### F3. Bugs found (none fixed: each would go in its own commit, with a measurement)

1. **`setLivery` is not accepted by the server.** The lobby sends it in online rooms too (lobby_screen.gd:70 and
   715), but `apps/server/src` has no `setLivery` at all. The server answers `bad_message`, and the paint never
   reaches the others online. The fix is a server change, outside this job.
2. **The phone home's Settings gear doesn't apply changes live.** mobile_home.gd:36 calls
   `SettingsPanel.build(app, func(): pass)`; the classic menu's `App.open_settings` applies the audio levels, the
   graphics quality and the session settings when something changes.
3. **Forest tree cards are always 128 px.** forest.gd `_load` waits for the cards to bake inside `_make_species()`,
   and only afterwards calls `set_quality(q)` (147). So `_bake_cards` (330) always sees an empty `quality`, and High
   and Ultra (forestNear 110/220) never bake 256 px. Rendering only.
4. **On PC, every circuit uses Spa's sky value.** spa_look.gd:397 merges `_p("env_fp", ENV_FP)`; no profile sets
   `env_fp`, so Spa's `{"sky": 0.62}` overrides each circuit's own `sky` (0.64-0.72) on Forward+. Fixing it changes
   how the PC looks.
5. **Nordschleife kerbs:** nordschleife_look.gd:20 adds `curb_ns` to `kerb_re`, but the inherited kerb detail entry
   (nurburgring_look:61) does not list it, so curb_ns is repainted but gets no grain.
6. **`tools/godot/gd.sh`:** with `--` in the arguments, it runs `runner.tscn args -- script`, and `runner.gd` loads
   the first user argument as the script. So runner tests cannot be given user arguments through gd.sh.
7. **Drift, needs a closer look:**
   - `RaceSession.pit_window_ms` (285-289) does not require `raceMs >= 6 min`; race_tracker.gd:119-120 does.
   - The phone's Join (mobile_modes.gd:287-313) does not check `P2p.is_p2p_code` or the online gate, as the classic
     menu does (menu_screen.gd:91-102).
   - `StoreScreen._my_car` picks from `CarsDb.all`; `MobileHome.my_car` picks from `CarsDb.selectable`.
   - hud.gd:74 rebuilds `UIKit.theme` for every HUD, so a modal opened after a race gets a different Theme instance
     from `app.ui`.
8. **Diagnostics:** corners_print cannot read nurburgring_gp_2022 (its data is `data/track.json`); hud_demo and
   shot_track write to `/` when SHOT_DIR is not set; cockpit_probe crashes without PIXELS.

### F4. Duplication of one concept (batch 4)

- **Lap-time formatting, 3 identical copies:** UIKit.fmt_lap, SocialUI.fmt_lap and RaceSession.fmt_lap.
  - Hud.fmt_time and ResultsScreen.fmt_time have drifted: only the HUD handles NaN.
  - The thousands separator is written twice: StoreScreen.fmt and CareerScreen._thousands.
- **The driver's name and current car:** 3 ways each (career, mobile_home, menu; mobile_home, store, lobby). The
  store's copy has already drifted (bug 7).
- **The per-circuit looks:**
  - Shared values are retyped in every profile: the forest tint, the road target, the gravel scan, the detail tiles,
    the AgX white (which AgX ignores).
  - Each profile writes its kerb regex twice, once in `kerb_re` and once in `detail`. That is how the Nordschleife
    drift (bug 5) happened.
  - Inside spa_look: `_road_file`/`_scan_file` and `_road_surface`/`_scan_surface` are near-identical; the image
    preparation is written 3 times and the grain recolour twice.
  - What genuinely differs stays per circuit: the material regexes, the env numbers, the targets, stand_re and
    seat_m, far_dir, own_wear.
- **JSON load/save, 5 copies:** settings, career, championship, progression, track_packs.
- **HTTP request boilerplate, 4 copies:** account, connection ×2, p2p. The "Cannot reach the game server" text is
  written 4 times.
- **Two near-identical socket classes:** LocalSocket (local_room) and P2pSocket (p2p). The keepalive is handled in
  3 places.
- **Settings rows:** UIW.row and SettingsPanel._row have drifted. The row-line style is built by hand 3 times. A
  progress bar is built inline 9 times. A button that tracks a margin's minimum size is written 3 times.
- **"Close the top overlay":** 6 places, with two different tests for what counts as one. Back navigation is
  written twice (go_back and _notification), and they drifted: only `_notification` leaves results, the briefing
  and watch.
- **Classic menu vs phone layout:** create, join, host, solo, the driver chip, the coins chip and the solo room
  setup (4 copies). Join has drifted (bug 7).
- **Inside race_session.gd:**
  - The pit service, the driver change and the "service finished" code are written once for bots and once for me.
  - `compound_grip` is called in 5 places, `fit_tyres(... +12)` in 5, fuel per lap in 3.
  - `local_tracker.players.get(x)` appears 7 times, and the minimap dots are built twice.
  - `sample_state` and `sample_bots` build packets the same way.
- **Tests:**
  - The offline-room + RaceSession boot is copied in 5 tests; `_ok`/`check` in 17, with 2 signatures; the App boot
    in 6.
  - Editing tests is not allowed without the user's OK: a shared helper is only a proposal.

### F5. Oversized files and functions (batch 5, splits)

- **race_session.gd (3,571 lines).** Cohesive groups the audit mapped:
  - pit lane and service (2777-3105);
  - cameras: the selection block inline at 2009-2064, plus 2380-2510;
  - replay (1560-1738);
  - contact rule (1059-1370);
  - damage (938-964, 1374-1473);
  - bots (1069, 1783-1915, 2615-2701);
  - race control and safety car (2511-2610, 2710-2754);
  - HUD feed (3253-3438);
  - track probes (3496-3571);
  - weather (2243-2265).

  The frame order is written down in the audit notes and must stay exactly as it is:
  - `_process`: probes, then keys, countdown, weather, safety car, bumps, my car, camera, racing line, remotes,
    replay, env, crash fx, visibility/forest, spray, windshield, shells/blades, audio, wake, ghost, race UI at
    30 Hz, pit, limiters, bot pits, crews, kb end, mirror.
  - `_physics_process`: smoother, controls, `step_bots`, contacts, rescue, `drain_contacts`, step++, sampling.
  - Vehicles step themselves after the session (tree order; no `process_priority` anywhere).
- **lobby_screen.gd (1,431).** The briefing (1018-1410, about 390 lines) is its own unit. So are the pages: hub,
  circuit, car, paint, event, drivers. The track metadata (10-27) is used by 4 files.
- **app.gd (989).** The dev automation (`_autotest`, `_shots_only`, `_ui_shots`, about 145 lines), the intro and
  the back navigation.
- **ui_widgets.gd (904).** The control classes TabButton, Switch, Stepper, Hatch and WeatherIcon (661-904).
- **room_core.gd (1,017).** `_handle` is 180 lines: lobby settings vs in-race commands.
- **Long functions:**
  - vehicle.gd `step` (360 lines, hot path: split only if it costs nothing);
  - results_screen `build` (220, and it scores the championship while rendering);
  - ai.gd `update` (161), menu `build` (152), sign_in_screen (147), settings_panel `build` (142);
  - spa_look `apply` (133), road_patches `_add` (133).

### F6. Inconsistent patterns (rules for CLAUDE.md, fixed where a batch touches them)

- **Five ways to build a screen,** four ways to show a message, and five ways to read a setting.
- **Touch detection:** `UIKit.touch()` honours APEX_TOUCH; `DisplayServer.is_touchscreen_available()` (3 files) does
  not.
- **Quality checks:** some code tests the preset name (`quality == "high"`), some reads the `quality_config()` flags.
  So a Custom textures group doesn't switch the ground overlays.
- **Private members used across files:** `CarVisual._walk` (26 calls in 13 files), `SettingsPanel._row` (21),
  `LobbyScreen._page`, `MenuScreen._tab`.
- **Two colour palettes** (the web tokens and the LMU tokens) and many hex literals; `Color("f2f4f7")` is written 7
  times.
- **Hot-path allocations already there** (noted, not for this job unless a measurement asks):
  - `simulated()` builds an Array of Arrays several times a physics step.
  - `step_bots` filters and sorts the remotes each step.
  - `Settings.quality_config()` runs a `JSON.stringify` every frame.
  - The audio and HUD feeds build dictionaries 30 times a second.

## Batches (planned order; each one under ~400 changed lines and committed alone)

1. **Guardrails** (phase 2):
   - turn on `untyped_declaration` (as a warning) and `return_value_discarded`;
   - make compile_all run with `--debug` and print the warning count per script and in total;
   - `@warning_ignore` with a reason for the intentional cases, such as `held` at app.gd:820, which keeps the threaded
     load referenced.
2. **Dead code F1,** in 4 commits by area:
   - race_session, including the radio;
   - shared, net, physics, input and audio;
   - game;
   - app and ui.

   Expected about −600 lines, and the 9 "unused class variable" and 10 "unused parameter" warnings gone.
3. **Typing,** by directory:
   - the 321 vars, 31 returns and 69 params;
   - then lambdas and typed arrays where the element type is plain;
   - then `untyped_declaration` becomes an error.
4. **Duplication F4,** in this order:
   - formatters;
   - driver name and car;
   - JSON load/save;
   - HTTP request;
   - looks shared values;
   - spa_look internals;
   - settings rows and overlays;
   - back navigation;
   - race_session's pit/service copies.
5. **Splits F5,** one subsystem per batch:
   - race_session: pit lane, replay, cameras, contact, bots, HUD feed, probes;
   - then the lobby's briefing, app's dev automation, and the widget classes.
6. **Phase 4:** CLAUDE.md, `tools/godot/check.sh`, the Stop hook proposal, the DECISIONS.md section.

## Later (outside this job)

- **Server:** accept `setLivery` (bug 1). The server's `damage` takes an `id` and counts incidents, which protocol.gd
  and room_core drop: parity only.
- **data/quality.json:** keys nothing reads (`anisotropy`, `envMapSize`, `envOnTrack`, `pbrScenery`,
  `pixelRatioCap`, `remoteDetail`, `softShadows`); `forestHero` and `forestShadow` are read but no preset sets them.
  `godot/data` is out of scope.
- **The README:** it misses many tests and env hooks (APEX_SERVER, APEX_SCREEN, APEX_MOBILE_UI, most of
  session_test's).
- **Hot-path allocations** listed in F6, for a performance job with measurements.
