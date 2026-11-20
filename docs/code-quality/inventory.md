| Script | Lines | class_name | Files referring | Untyped vars | Funcs without -> | Untyped params | Purpose (header) |
|---|---:|---|---:|---:|---:|---:|---|
| app/app.gd | 989 | App | 22 | 5 | 0 | 1 | The game's shell (port of app.ts): screens (menu, lobby, briefing, loading, race, results), the connection to  |
| app/car_studio.gd | 208 | CarStudio | 8 | 0 | 0 | 0 | Brand-free pictures of the cars for the menus (the game carries no brands since 2026-11-16: the shipped thumbn |
| app/career_screen.gd | 330 | CareerScreen | 3 | 3 | 0 | 0 | The solo career at a glance (the driver profile of Forza, GT and iRacing), laid out as Le Mans Ultimate's prof |
| app/championship_ui.gd | 95 | ChampionshipUI | 5 | 1 | 0 | 0 | The championship menu and its rounds (port of App.championshipMenu / startChampionshipRound): carry on, start  |
| app/intro_cinematic.gd | 189 | IntroCinematic | 1 | 0 | 0 | 0 | The opening titles while the game starts (after GT's and Forza's): a GT3 car in a dark studio on a glossy floo |
| app/lobby_screen.gd | 1431 | LobbyScreen | 6 | 5 | 0 | 0 | The lobby (port of App.renderLobby / lobbySetup / prepPanel / renderBriefing / renderWatch), laid out as Le Ma |
| app/menu_screen.gd | 396 | MenuScreen | 5 | 2 | 0 | 1 | The main menu (port of App.showMenu), laid out after Le Mans Ultimate's: a top bar with the sections (Play, On |
| app/mobile_ads.gd | 102 | MobileAds | 3 | 0 | 0 | 0 | Ad placements of the mobile layout (the user, 2026-11-20: "with ads for making revenue ... dont need to set up |
| app/mobile_home.gd | 547 | MobileHome | 4 | 1 | 0 | 1 | The mobile layout's home (the user, 2026-11-20: a phone UI after RESOURCES/UI-MOBILE-REFERENCE): the garage. Y |
| app/mobile_modes.gd | 329 | MobileModes | 4 | 1 | 1 | 1 | The mobile layout's Game Modes (after RESOURCES/UI-MOBILE-REFERENCE): the categories down the left (Career, Ev |
| app/mobile_pass.gd | 125 | MobilePass | 4 | 0 | 0 | 0 | The season pass (after RESOURCES/UI-MOBILE-REFERENCE): the season's tiers along a horizontal track, the free r |
| app/mobile_ui.gd | 284 | MobileUI | 3 | 0 | 1 | 3 | Building blocks of the mobile layout (MobileHome, MobileModes, MobilePass), after the free-to-play racing game |
| app/results_screen.gd | 340 | ResultsScreen | 2 | 6 | 1 | 2 | The results after a session (port of App.showResults), laid out as Le Mans Ultimate's standings: the circuit a |
| app/settings_pages.gd | 317 | SettingsPages | 2 | 1 | 0 | 0 | The settings' Account tab (the user, 2026-11-16: presets and account settings in a proper menu, after F1, Asse |
| app/settings_panel.gd | 684 | SettingsPanel | 7 | 2 | 2 | 0 | Settings (port of ui/settingsPanel.ts, reorganised after iRacing's options and laid out as Le Mans Ultimate's) |
| app/social_ui.gd | 495 | SocialUI | 6 | 3 | 1 | 1 | The account parts of the menu (port of ui/social.ts): sign in / create an account, the friends list with where |
| app/store_screen.gd | 618 | StoreScreen | 9 | 0 | 0 | 0 | The store, as a preview (the user, 2026-11-17: "show me how it would be with the payment and coins prices, but |
| audio/ambience.gd | 69 | Ambience | 3 | 0 | 0 | 0 | Circuit ambience (port of Ambience in audio/audio.ts): the countryside (wind in the trees, birds by day), the |
| audio/car_sounds.gd | 110 | CarSounds | 2 | 1 | 0 | 0 | Your car's chassis noises (port of CarSounds in audio/audio.ts): tyres, road, kerbs, gravel/grass, a wall scra |
| audio/engine_bank.gd | 45 | EngineBank | 1 | 0 | 0 | 0 | Recorded engine loops (port of audio/engineBank.ts): engine_<name>.bin is int16 PCM, engine_<name>.json indexe |
| audio/engine_profiles.gd | 90 | EngineProfiles | 2 | 0 | 0 | 0 | Engine layouts of the cars (port of audio/engineProfiles.ts). The sound comes from the recorded loop bank; the |
| audio/engine_voice.gd | 208 | EngineVoice | 2 | 2 | 0 | 0 | One car's engine and drivetrain noises (port of EngineVoice in audio/audio.ts): the recorded engine, turbo whi |
| audio/game_audio.gd | 357 | GameAudio | 11 | 1 | 0 | 0 | Game audio (port of audio/audio.ts): the mixer buses (master with the limiter, engine, effects, ambience, radi |
| audio/session_audio.gd | 204 | SessionAudio | 1 | 5 | 0 | 0 | Everything audible in a race (port of audio/sessionAudio.ts): your engine (in the cockpit, or positioned while |
| game/ai.gd | 639 | AiDriver | 12 | 3 | 1 | 0 | Racing AI (port of game/ai.ts): pure-pursuit steering along a racing line (plus its own small offset) and a |
| game/assets.gd | 76 | Assets | 20 | 4 | 0 | 0 | Asset loading (port of game/assets.ts). The game's files are bundled with the app (res://assets, copied from t |
| game/atmosphere.gd | 91 | Atmosphere | 1 | 0 | 0 | 0 | CPU twin of the sky model (port of the TypeScript half of game/atmosphere.ts; the GPU half is |
| game/barcelona_look.gd | 68 | BarcelonaLook | 1 | 0 | 0 | 0 | Barcelona-Catalunya's look (the user, 2026-11-19: the new circuit with "super hyper realistic graphics"): SpaL |
| game/car_paint.gd | 226 | CarPaint | 10 | 0 | 0 | 0 | The cars' paint and their brand-free look (the user, 2026-11-16: no brands anywhere, cars customisable): |
| game/car_setup.gd | 197 | CarSetup | 4 | 11 | 0 | 3 | Garage setup (port of game/carSetup.ts): rear wing, ride height, anti-roll bars, dampers, brake bias, pressure |
| game/car_spray.gd | 126 | CarSpray | 1 | 0 | 0 | 0 | The spray a car throws up on a wet track (a mist trailing behind it, growing with speed and with the water on  |
| game/car_visual.gd | 788 | CarVisual | 27 | 8 | 0 | 1 | A visible car (port of game/carVisual.ts): LOD levels instanced from the shared model, rigged wheels and steer |
| game/career.gd | 292 | CareerData | 9 | 1 | 0 | 0 | The solo career, after the games' progression (port of career.ts): experience and driver levels (Forza, Gran |
| game/championship.gd | 68 | Championship | 5 | 1 | 0 | 2 | A solo championship (port of championship.ts): rounds on different circuits against the same AI drivers, |
| game/chase_camera.gd | 73 | ChaseCamera | 3 | 0 | 0 | 0 | Chase camera, as in GT / ACC (port of RaceSession.updateChaseCam): it trails the car's heading with a short la |
| game/cinematic.gd | 282 | Cinematic | 1 | 0 | 0 | 1 | Pre-race cinematic, as in TV coverage and F1/GT games (port of game/cinematic.ts): |
| game/cockpit_camera.gd | 284 | CockpitCamera | 4 | 0 | 1 | 1 | Cockpit camera with subtle, motion-sickness-friendly head movement (port of game/cockpit.ts): g-force sway (da |
| game/config.gd | 15 | Config | 6 | 0 | 0 | 0 | Endpoints and flags (port of config.ts). The app talks to the same Cloudflare server and website as the web ga |
| game/crash_fx.gd | 168 | CrashFx | 1 | 0 | 0 | 0 | What a crash leaves, as the sims show it (port of game/crashFx.ts): a shower of sparks where bodywork scrapes  |
| game/crowd.gd | 183 | Crowd | 4 | 1 | 0 | 0 | Spectators on the grandstands (port of game/crowd.ts). The source map's stands are low-poly shells with the se |
| game/dash_display.gd | 420 | DashDisplays | 3 | 1 | 0 | 1 | Live data on the cockpit's own screens, as a GT3 dash shows it (port of game/dashDisplay.ts): the big gear, sh |
| game/environment_ctrl.gd | 337 | GameEnvironment | 5 | 0 | 0 | 0 | Sky, sun/moon light, fog, clouds, stars and rain, driven by the deterministic weather state (port of the |
| game/forest.gd | 626 | Forest | 5 | 2 | 0 | 0 | The Eifel forest around the circuit (port of game/forest.ts): hundreds of thousands of spruce and beech trees  |
| game/ghost.gd | 84 | BestLapGhost | 1 | 0 | 0 | 0 | Your best valid lap as a ghost (port of game/ghost.ts): the current lap is recorded at the state sample rate;  |
| game/graphics.gd | 122 | Graphics | 6 | 0 | 0 | 0 | The renderer's quality settings (port of game/graphics.ts): anti-aliasing, the render resolution (the user's s |
| game/grass_blades.gd | 229 | GrassBlades | 1 | 2 | 0 | 0 | Real blades over the verge's lawn (High / Ultra; port of game/grassBlades.ts), on top of the shells. Shells ma |
| game/grass_mask.gd | 120 | GrassMask | 4 | 1 | 0 | 0 | Where grass must not grow (port of game/grassMask.ts): the ground footprint of the circuit's structures |
| game/grass_shells.gd | 144 | GrassShells | 2 | 2 | 0 | 0 | Mown grass with depth on the verges (port of game/grassShells.ts): the lawn near the camera is drawn again in |
| game/ground_detail.gd | 83 | GroundDetail | 2 | 0 | 0 | 0 | Detail the source maps' ground lacks (port of the material patches in game/track.ts): their asphalt, concrete  |
| game/ground_query.gd | 49 | GroundQuery | 10 | 0 | 1 | 0 | Wheel rays against the track (port of Track.groundQuery in game/track.ts). Surface of a hit comes from the |
| game/i18n.gd | 18 | I18n | 41 | 0 | 0 | 0 | The interface text. The game is in English only (the user, 2026-11-16: the Spanish translation and the languag |
| game/interior_look.gd | 87 | InteriorLook | 4 | 0 | 0 | 0 | Cockpit material fixes for single cars, made in the game (the shared asset config is the web game's). Some dow |
| game/lap_delta.gd | 112 | LapDelta | 2 | 3 | 0 | 0 | Live delta to your personal best lap (port of game/lapDelta.ts): the lap time recorded every few metres; the |
| game/lens_flare.gd | 102 | LensFlare | 3 | 0 | 0 | 0 | The sun's glare and lens flare (Display › Sun lens flare; the user, 2026-11-18: lighting as real as it can be) |
| game/mirror.gd | 76 | RearMirror | 2 | 0 | 0 | 0 | Virtual rear-view mirror at the top of the screen (port of game/mirror.ts): a camera at the back of your car l |
| game/nordschleife_look.gd | 28 | NordschleifeLook | 1 | 0 | 0 | 0 | The 24h layout's look (the GP and the Nordschleife; map "nordschleife"): the GP model carries NurburgringLook' |
| game/nurburgring_look.gd | 71 | NurburgringLook | 2 | 0 | 0 | 0 | The Nürburgring GP's look (the user, 2026-11-18: "the same you did for Spa", with everything Spa used): SpaLoo |
| game/perf.gd | 76 | PerfOverlay | 2 | 0 | 0 | 0 | FPS, frame-time graph, draw calls, triangles, memory, ping and packet loss (port of game/perf.ts). |
| game/pit_crew.gd | 66 | PitCrew | 3 | 2 | 0 | 1 | The pit stop as it happens, not a timer (port of the logic half of game/pitCrew.ts): one timeline built from t |
| game/pit_crews.gd | 528 | PitCrews | 1 | 7 | 2 | 2 | The crews at the pit boxes (port of the rendering half of game/pitCrew.ts): each entrant's crew waits in front |
| game/pit_lane.gd | 423 | PitLaneMonitor | 2 | 9 | 1 | 1 | Where the car is relative to the pit lane (port of game/pitLane.ts): entry, boxes, exit; the lane's geometry,  |
| game/pit_service.gd | 63 | PitService | 4 | 1 | 0 | 5 | What the crew should do at a pit stop (port of game/pitService.ts). A plan is |
| game/prof.gd | 80 | Prof | 3 | 0 | 0 | 0 | A tiny section profiler: Prof.b("name") … Prof.e("name"); a summary of microseconds a frame is printed every f |
| game/progression.gd | 410 | Progression | 7 | 1 | 0 | 0 | The mobile layout's progression (the user, 2026-11-20: a phone UI after RESOURCES/UI-MOBILE-REFERENCE, a free- |
| game/race_session.gd | 3571 | RaceSession | 12 | 86 | 8 | 2 | One race: loads everything for it, runs physics / render / network until the results arrive (port of |
| game/racing_line_fx.gd | 128 | RacingLineFx | 1 | 0 | 0 | 0 | Racing-line assist after the F1 games' dynamic line (port of game/racingLineFx.ts): a ribbon of soft chevrons |
| game/racing_line_prep.gd | 26 | RacingLinePrep | 2 | 1 | 1 | 0 | The racing line is optimised in a thread meanwhile the session loads (port of game/racingLinePrep.ts and its w |
| game/replay.gd | 133 | Replay | 6 | 0 | 0 | 0 | In-session replay (iRacing: play / pause, slow motion, frame step, rewind, fast-forward, a choice of car and c |
| game/road_patches.gd | 235 | RoadPatches | 3 | 3 | 0 | 0 | Smoothed driving surfaces over stretches where the map's collision is rough (port of game/roadPatches.ts): the |
| game/road_wear.gd | 111 | RoadWear | 2 | 0 | 0 | 0 | Lived-in asphalt, as on a real circuit after a season of racing, drawn as one multiplicative decal over the wh |
| game/safety_car_look.gd | 68 | SafetyCarLook | 2 | 0 | 0 | 0 | The safety car's look (the Vantage GT3 model, docs/prompts/spa-and-cars-rebuild.md): race-control green (CarPa |
| game/settings.gd | 253 | - | 1 | 5 | 0 | 0 | Player settings (port of settings.ts), an autoload named Settings. Same field names as the web game's, kept in |
| game/shanghai_look.gd | 63 | ShanghaiLook | 1 | 0 | 0 | 0 | Shanghai International Circuit's look (the user, 2026-11-19: the new circuit with "super hyper realistic graph |
| game/side_screens.gd | 90 | SideScreens | 1 | 0 | 0 | 0 | Triple screens (the user, 2026-11-16: several monitors at once): while racing, a window on the monitor left an |
| game/silverstone_look.gd | 74 | SilverstoneLook | 1 | 0 | 0 | 0 | Silverstone's look (the user, 2026-11-19: the new map "super ultra mega hiper realistic"): SpaLook's treatment |
| game/spa_crowd.gd | 61 | SpaCrowd | 1 | 0 | 0 | 0 | Spa's spectators (and the Nürburgring GP's: build's stand_re): scanned people (assets/maps/spa_g/crowd_atlas.p |
| game/spa_far.gd | 52 | SpaFar | 1 | 0 | 0 | 0 | The hills around Spa that the source model lacks: a ring of real terrain from the model's edge out to 9.5 km |
| game/spa_look.gd | 597 | SpaLook | 13 | 2 | 0 | 0 | Spa-Francorchamps's own materials (the Godot build from the new source model, tools/asset-pipeline/spa_godot/) |
| game/spa_props.gd | 304 | SpaProps | 1 | 6 | 0 | 0 | Trackside objects the source model lacks, for Spa (docs/spa-rebuild: the M1 checklist). COPIES repeats pieces  |
| game/top_view.gd | 185 | TopView | 6 | 0 | 0 | 0 | A car seen from straight above (port of game/topView.ts): a picture of the car's own model (nose up, transpare |
| game/track_collision.gd | 70 | TrackCollision | 3 | 0 | 0 | 0 | Loads a track's collision file (.apxc, gzip) into Jolt trimesh bodies, one per surface sub-mesh |
| game/track_data.gd | 34 | TrackData | 12 | 0 | 0 | 0 | Loads the track index and layout JSON files (copied to res://data by tools/godot/sync-assets.sh). |
| game/track_limits.gd | 49 | TrackLimits | 2 | 1 | 0 | 0 | Track limits as in the real rules (port of game/trackLimits.ts): the painted white line is the edge of the tra |
| game/track_packs.gd | 298 | - | 2 | 2 | 0 | 0 | Downloadable track packs (autoload "Packs"): a circuit too big for the app (Spa, ~240 MB) comes as a Godot res |
| game/track_scene.gd | 462 | TrackScene | 7 | 3 | 0 | 0 | The loaded track: render scene, collision and centreline helpers (port of game/track.ts Track). Chunks are the |
| game/tv_cameras.gd | 149 | TvCameras | 1 | 1 | 0 | 0 | Trackside TV cameras, as a race is broadcast (port of game/tvCameras.ts): a camera on a tower on the outside o |
| game/wall_cut.gd | 75 | WallCut | 1 | 1 | 0 | 0 | Walls that cross the layout's own lap line are taken out of its collision (port of game/wallCut.ts). |
| game/wet_fx.gd | 162 | WetFx | 3 | 5 | 0 | 0 | Water on a wet track: puddles where the rain gathers (low points of the lap and the edges of the road, more of |
| game/windshield_fx.gd | 82 | WindshieldFx | 1 | 0 | 0 | 0 | Rain droplets on the windshield (shaders/windshield.gdshader) and the crack a hard front hit leaves (port of |
| game/zandvoort_look.gd | 70 | ZandvoortLook | 1 | 0 | 0 | 0 | Zandvoort's look (the user, 2026-11-19: "important color issues on the road" and "ultra realistic zandvoort"): |
| input/device_bindings.gd | 163 | DeviceBindings | 6 | 0 | 0 | 0 | Steering wheels, pedal sets, shifters and handbrakes, each a device of its own (the user, 2026-11-16: wheels m |
| input/gamepad.gd | 23 | Gamepad | 2 | 0 | 0 | 0 | Game controller helpers (rumble). The controller's analog input itself is read by GamepadInput (port of |
| input/gamepad_input.gd | 234 | GamepadInput | 4 | 0 | 0 | 0 | Game controller support (port of input/gamepad.ts). Like the touch controls it plugs into the shared input sta |
| input/pad_map.gd | 72 | PadMap | 5 | 4 | 0 | 0 | Turns whatever the engine reports for a controller into the layout the game reads (port of input/padMap.ts): |
| net/account.gd | 292 | - | 1 | 4 | 0 | 0 | The signed-in account (port of net/account.ts), an autoload named Account: a guest (a driver name and a device |
| net/connection.gd | 350 | Connection | 16 | 8 | 0 | 1 | WebSocket session with automatic reconnect (the session token keeps the slot, car and race progress for up to  |
| net/local_room.gd | 118 | LocalRoom | 19 | 1 | 0 | 2 | Offline play (port of net/localRoom.ts): the server's own room logic (RoomCore: lobby, briefing, lap timing, |
| net/p2p.gd | 268 | P2p | 6 | 2 | 0 | 2 | Races hosted on a device (port of net/p2p.ts): a phone at a friend's house, a laptop at a LAN. The host's game |
| net/play_games.gd | 55 | PlayGames | 3 | 2 | 0 | 0 | Google Play Games sign-in on Android (the user, 2026-11-20: "login with google play games or playing as guests |
| net/remote_car_buffer.gd | 239 | RemoteCarBuffer | 1 | 0 | 0 | 0 | One remote car, from its stream of samples (port of net/remote.ts). |
| physics/controls.gd | 13 | Controls | 10 | 0 | 0 | 0 | Driver inputs for one physics step (port of physics/input.ts Controls). |
| physics/damage_state.gd | 147 | DamageState | 9 | 0 | 0 | 0 | A car's damage (port of physics/damage.ts). Zones: 0 front, 1 rear, 2 left, 3 right, 4 engine, 5 suspension. |
| physics/drivetrain.gd | 129 | Drivetrain | 1 | 0 | 0 | 0 | Engine + sequential gearbox + launch clutch (port of physics/drivetrain.ts). Gear 0 = neutral, -1 = reverse. |
| physics/input_smoother.gd | 51 | InputSmoother | 5 | 0 | 0 | 0 | Reads the keys, touch and controller into digital targets (port of InputSmoother in physics/input.ts). All smo |
| physics/input_state.gd | 16 | InputState | 6 | 0 | 0 | 0 | Shared input state (port of the singletons in physics/input.ts). Values are targets like the keys' (0..1 pedal |
| physics/key_map.gd | 39 | KeyMap | 7 | 0 | 0 | 0 | Translates the web game's KeyboardEvent.code names (the key bindings in the settings) to Godot keys. |
| physics/keyboard_driver.gd | 112 | KeyboardDriver | 4 | 0 | 0 | 1 | Keyboard / touch / pad -> analog driver inputs, run inside every physics step (port of physics/keyboardDriver. |
| physics/keyboard_input.gd | 36 | KeyboardInput | 3 | 0 | 0 | 0 | Raw digital key state against the player's key bindings (port of class Keyboard in physics/input.ts). |
| physics/steering_lock.gd | 24 | SteeringLock | 2 | 0 | 0 | 0 | Steering-wheel lock to lock (degrees) of each car (port of physics/steeringLock.ts). |
| physics/tire_model.gd | 90 | TireModel | 1 | 0 | 0 | 0 | Simplified Pacejka "Magic Formula" with combined slip (port of physics/tire.ts). |
| physics/tyres.gd | 29 | Tyres | 9 | 0 | 0 | 0 | Tyre compounds and wear (port of physics/tyres.ts). Compound ids: soft, medium, hard, wet. |
| physics/vehicle.gd | 752 | Vehicle | 10 | 3 | 0 | 1 | The car: a Jolt rigid body with a custom raycast-wheel model (port of physics/vehicle.ts). |
| physics/vehicle_consts.gd | 101 | VehicleConsts | 8 | 0 | 0 | 0 | Constants and helper curves of the vehicle model (port of the top of physics/vehicle.ts). |
| physics/wheel.gd | 88 | Wheel | 10 | 0 | 0 | 0 | One wheel of the vehicle model (port of class Wheel in physics/vehicle.ts). |
| shared/accounts.gd | 26 | Accounts | 1 | 2 | 0 | 1 | Account types and profile checks (port of packages/shared/src/accounts.ts). The data are plain Dictionaries |
| shared/car_state.gd | 267 | CarState | 5 | 0 | 0 | 0 | One car state sample and its binary wire format (port of the binary part of packages/shared/src/protocol.ts). |
| shared/cars_db.gd | 85 | CarsDb | 25 | 0 | 0 | 0 | The cars file (res://data/cars.json, copied from the web game's assets/cars.json): a Dictionary |
| shared/clock.gd | 22 | ClockSync | 1 | 0 | 0 | 0 | NTP-style clock sync (port of packages/shared/src/clock.ts). Samples are {offset, rtt}. |
| shared/constants.gd | 60 | Const | 14 | 0 | 0 | 0 | Shared game constants (port of packages/shared/src/constants.ts). |
| shared/prng.gd | 44 | Prng | 3 | 1 | 0 | 0 | mulberry32: tiny deterministic PRNG, bit-identical to the web game's (weather and grids are shared with it). |
| shared/protocol.gd | 183 | Protocol | 2 | 14 | 0 | 3 | Lobby types and JSON message validation (port of the JSON part of packages/shared/src/protocol.ts). |
| shared/race_control.gd | 328 | RaceControl | 2 | 9 | 1 | 1 | Race control, after SRO's GT World Challenge procedures (port of packages/shared/src/raceControl.ts): yellow |
| shared/race_tracker.gd | 657 | RaceTracker | 7 | 11 | 0 | 1 | Server-authoritative session logic (port of packages/shared/src/race.ts): lap and sector timing from position |
| shared/room_conn.gd | 21 | RoomConn | 5 | 0 | 1 | 1 | A connection as the room logic sees it (port of Conn in apps/server/src/room.ts). Subclass or set the callable |
| shared/room_core.gd | 1017 | RoomCore | 6 | 20 | 0 | 3 | Transport-agnostic room logic: lobby, briefing, loading, countdown, session, results, bots, lap timing and |
| shared/room_env.gd | 17 | RoomEnv | 4 | 1 | 0 | 0 | What the room needs from its host (port of RoomEnv in apps/server/src/room.ts). |
| shared/track_math.gd | 112 | TrackMath | 15 | 0 | 0 | 0 | Centreline and gate helpers (port of packages/shared/src/track.ts). A track is the layout's JSON Dictionary: |
| shared/validation.gd | 63 | Validation | 7 | 0 | 0 | 2 | Nickname and room-code rules (port of packages/shared/src/validation.ts). |
| shared/weather.gd | 158 | Weather | 7 | 4 | 0 | 0 | Deterministic weather, time of day and temperatures from a seed (port of packages/shared/src/weather.ts). |
| ui/car_line_art.gd | 86 | CarLineArt | 2 | 0 | 0 | 0 | A car's own line drawing from above (port of ui/carLines.ts), each part in a colour of its own: the nose, the  |
| ui/car_status.gd | 209 | CarStatus | 1 | 0 | 0 | 1 | Car status instrument, as on a GT3 dash / F1 game HUD (port of ui/carStatus.ts): your own car seen from above  |
| ui/chat_panel.gd | 81 | ChatPanel | 1 | 0 | 0 | 0 | Text chat in the race (iRacing: T to type, /rc for the admins): the last lines fade after a while, and an inpu |
| ui/circuit_map.gd | 162 | CircuitMap | 3 | 1 | 0 | 2 | The circuit map as iRacing draws it (port of ui/circuitMap.ts): the whole layout (north-up, not turning with y |
| ui/damage_panel.gd | 130 | DamagePanel | 1 | 0 | 0 | 0 | The damage report, as iRacing's black box draws it (port of ui/damagePanel.ts): the car's own model as a line |
| ui/device_setup.gd | 185 | DeviceSetup | 2 | 0 | 0 | 0 | Settings → Controller → Wheel, pedals and shifter: every function of DeviceBindings with what it is bound to,  |
| ui/flag_icon.gd | 29 | FlagIcon | 3 | 1 | 0 | 1 | A country's flag (an image, no emoji), 4:3 (port of flagImg in ui/social.ts). The flag files are bundled |
| ui/hud.gd | 672 | Hud | 6 | 2 | 0 | 3 | Minimal cockpit-friendly HUD (port of ui/hud.ts): lap and position, the timing tower, lap times and live delta |
| ui/hud_dial.gd | 167 | HudDial | 2 | 0 | 0 | 0 | The driver's dial (port of the web game's ui/dial.ts, 2026-11-13): a ring of revs round a dark face with the g |
| ui/hud_editor.gd | 207 | HudEditor | 3 | 0 | 0 | 0 | The HUD layout editor (the user, 2026-11-16: the HUD customisable by every player): the race HUD over a photo, |
| ui/menu_decor.gd | 38 | MenuDecor | 2 | 0 | 0 | 0 | The menus' backdrop over the circuit photo (after Le Mans Ultimate's): a navy tint on the left turning crimson |
| ui/mini_map.gd | 133 | MiniMap | 1 | 1 | 0 | 0 | The turning minimap of the HUD (port of Hud.setTrack / Hud.drawMap): zoomed in, centred on you and rotating wi |
| ui/pad_setup.gd | 216 | PadSetup | 2 | 1 | 0 | 0 | Settings → Controller: a live view of what the engine reads from the controller, and a button setup that asks  |
| ui/pit_menu.gd | 359 | PitMenu | 1 | 11 | 2 | 1 | The pit box: choose tyres and repairs, see how long the stop takes, start the service (port of ui/pitMenu.ts). |
| ui/race_overlays.gd | 181 | RaceOverlays | 1 | 0 | 0 | 1 | Race overlays after iRacing and ACC, beside the HUD (port of ui/overlays.ts): the relative box, the delta bar, |
| ui/reel.gd | 139 | CinematicReel | 1 | 0 | 0 | 0 | A short TV-style intro reel for the boot, the race loading screen and the waiting screens (port of ui/reel.ts) |
| ui/replay_bar.gd | 90 | ReplayBar | 1 | 0 | 0 | 0 | The replay's controls (iRacing's replay bar): a time slider, rewind / step / play / step / forward, the speed, |
| ui/timing_screen.gd | 78 | TimingScreen | 2 | 1 | 0 | 0 | Full timing screen (hold Tab), like a qualifying monitor (port of ui/timingScreen.ts): position, driver, car,  |
| ui/touch_controls.gd | 432 | TouchControls | 2 | 0 | 0 | 0 | On-screen driving controls of the mobile app (port of mobile/touchControls.ts). They sit over the race UI and |
| ui/touch_prefs.gd | 39 | TouchPrefs | 4 | 1 | 0 | 0 | Touch control preferences (port of mobile/touchSettings.ts, data part): how the phone steers (two arrow button |
| ui/track_outline.gd | 58 | TrackOutline | 1 | 0 | 1 | 1 | A layout's shape as an outline (port of ui/trackMap.ts): the lobby's circuit cards and preview, drawn from the |
| ui/ui_kit.gd | 242 | UIKit | 44 | 0 | 2 | 3 | The game's UI look (port of the design tokens in styles.css): colours, fonts (Barlow, Barlow Condensed), panel |
| ui/ui_widgets.gd | 904 | UIW | 24 | 1 | 3 | 7 | Small builders for the menu screens (the web game's dom.ts helpers): boxes, chip rows, toggles, cards, modals, |
