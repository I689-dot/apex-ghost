# Godot migration checklist (every source file must be ported; nothing skipped)

Legend: [ ] todo, [~] partly, [x] done

## apps/client/src
- [x] apps/client/src/app.ts (scripts/app/*: every screen; the unused Showroom aside)
- [x] apps/client/src/career.ts
- [x] apps/client/src/championship.ts
- [x] apps/client/src/config.ts
- [x] apps/client/src/i18n.ts
- [x] apps/client/src/main.ts (scenes/main.tscn, app.gd incl. the intro reel)
- [x] apps/client/src/settings.ts
- [x] apps/client/src/styles.css (replaced by the UIKit theme and the screens in code)

## apps/client/src/game
- [x] apps/client/src/game/ai.ts
- [x] apps/client/src/game/assets.ts
- [x] apps/client/src/game/atmosphere.ts
- [x] apps/client/src/game/carSetup.ts
- [x] apps/client/src/game/carVisual.ts
- [x] apps/client/src/game/cinematic.ts
- [x] apps/client/src/game/cockpit.ts
- [x] apps/client/src/game/crashFx.ts
- [x] apps/client/src/game/crowd.ts
- [x] apps/client/src/game/dashDisplay.ts
- [x] apps/client/src/game/environment.ts
- [x] apps/client/src/game/forest.ts (packed cells, near models, impostors)
- [x] apps/client/src/game/ghost.ts
- [~] apps/client/src/game/graphics.ts (AA, scale, dynamic res, bloom, grade; no AO on the Mobile renderer)
- [x] apps/client/src/game/grassBlades.ts (High / Ultra)
- [x] apps/client/src/game/grassMask.ts (baked per layout: tests/bake_masks.gd)
- [x] apps/client/src/game/grassShells.ts
- [x] apps/client/src/game/lapDelta.ts
- [x] apps/client/src/game/mirror.ts
- [x] apps/client/src/game/perf.ts
- [x] apps/client/src/game/pitCrew.ts
- [x] apps/client/src/game/pitLane.ts
- [x] apps/client/src/game/pitService.ts
- [x] apps/client/src/game/preview.ts (n/a: the showroom is not shown by the UI)
- [x] apps/client/src/game/racingLineFx.ts
- [x] apps/client/src/game/racingLinePrep.ts
- [x] apps/client/src/game/racingLineWorker.ts (thread in racing_line_prep.gd)
- [x] apps/client/src/game/roadPatches.ts
- [x] apps/client/src/game/roadWear.ts
- [x] apps/client/src/game/session.ts (race_session.gd; every optional subsystem attached except the radio)
- [x] apps/client/src/game/sky.ts
- [x] apps/client/src/game/taa.ts (engine TAA: Viewport.use_taa)
- [x] apps/client/src/game/topView.ts
- [~] apps/client/src/game/track.ts (all but the kerb crisp-paint shader, the structure depth push and the decal polygon offset)
- [ ] apps/client/src/game/trackEditor.ts (dev tool of the web build, not shipped)
- [x] apps/client/src/game/trackLimits.ts
- [x] apps/client/src/game/tvCameras.ts
- [x] apps/client/src/game/vegetation.ts (forest.gd, grass_blades.gd)
- [x] apps/client/src/game/wallCut.ts

## apps/client/src/physics
- [x] apps/client/src/physics/damage.ts
- [x] apps/client/src/physics/drivetrain.ts
- [x] apps/client/src/physics/input.ts
- [x] apps/client/src/physics/keyboardDriver.ts
- [x] apps/client/src/physics/steeringLock.ts
- [x] apps/client/src/physics/tire.ts
- [x] apps/client/src/physics/tyres.ts
- [x] apps/client/src/physics/vehicle.ts

## apps/client/src/audio
- [x] apps/client/src/audio/audio.ts
- [~] apps/client/src/audio/engine-worklet.d.ts (recorded-loop engine only; no procedural layer)
- [~] apps/client/src/audio/engine-worklet.js (recorded-loop engine only; no procedural layer)
- [x] apps/client/src/audio/engineBank.ts
- [x] apps/client/src/audio/engineProfiles.ts
- [ ] apps/client/src/audio/radio.ts (disabled in the web game too: no voice files are shipped)
- [x] apps/client/src/audio/sessionAudio.ts

## apps/client/src/input
- [x] apps/client/src/input/gamepad.ts
- [x] apps/client/src/input/padMap.ts
- [x] apps/client/src/input/padSetup.ts

## apps/client/src/net
- [x] apps/client/src/net/account.ts
- [x] apps/client/src/net/connection.ts
- [x] apps/client/src/net/localRoom.ts
- [x] apps/client/src/net/p2p.ts (WebRTC through the webrtc-native extension)
- [x] apps/client/src/net/remote.ts

## apps/client/src/ui
- [x] apps/client/src/ui/carLines.ts
- [x] apps/client/src/ui/carStatus.ts
- [x] apps/client/src/ui/careerBlock.ts
- [x] apps/client/src/ui/circuitMap.ts
- [x] apps/client/src/ui/damagePanel.ts
- [x] apps/client/src/ui/dom.ts (replaced by UIKit / UIW)
- [x] apps/client/src/ui/hud.ts
- [x] apps/client/src/ui/icons.ts (replaced by UIKit / UIW)
- [x] apps/client/src/ui/images.ts (replaced by UIKit / UIW)
- [x] apps/client/src/ui/overlays.ts
- [x] apps/client/src/ui/pitMenu.ts
- [x] apps/client/src/ui/reel.ts
- [x] apps/client/src/ui/settingsPanel.ts
- [x] apps/client/src/ui/social.ts
- [x] apps/client/src/ui/timingScreen.ts
- [x] apps/client/src/ui/trackMap.ts

## apps/client/src/mobile
- [x] apps/client/src/mobile/appShell.ts (n/a: native app)
- [x] apps/client/src/mobile/assetCache.ts (n/a: native app)
- [x] apps/client/src/mobile/installScreen.ts (n/a: native app)
- [x] apps/client/src/mobile/mobile.css (n/a: native app)
- [x] apps/client/src/mobile/platform.ts (n/a: native app)
- [ ] apps/client/src/mobile/refreshRate.ts (120 Hz: not wanted for the moment)
- [x] apps/client/src/mobile/touchControls.ts (ui/touch_controls.gd)
- [x] apps/client/src/mobile/touchSettings.ts (settings panel Touch tab)

## packages/shared/src
- [x] packages/shared/src/accounts.ts
- [x] packages/shared/src/cars.ts (CarsDb)
- [x] packages/shared/src/clock.ts
- [x] packages/shared/src/constants.ts
- [x] packages/shared/src/index.ts (scripts/shared/*)
- [x] packages/shared/src/prng.ts
- [x] packages/shared/src/protocol.ts
- [x] packages/shared/src/race.ts
- [x] packages/shared/src/raceControl.ts
- [x] packages/shared/src/track.ts
- [x] packages/shared/src/validation.ts
- [x] packages/shared/src/weather.ts

## apps/server/src
- [x] apps/server/src/accounts.ts (unchanged: the Cloudflare server is reused)
- [x] apps/server/src/index.ts (unchanged: the Cloudflare server is reused)
- [x] apps/server/src/room.ts
- [x] apps/server/src/signal.ts (unchanged: the Cloudflare server is reused)

## Assets
- [x] cars (GLB) + cars.json
- [x] tracks Nordschleife GP/short/24h, Spa, Zandvoort + collision.apxc + forest.json
- [x] textures, audio engine profiles + surface sounds, i18n strings
