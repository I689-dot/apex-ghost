# Godot migration checklist (every source file must be ported; nothing skipped)

Legend: [ ] todo, [x] done

## apps/client/src
- [ ] apps/client/src/app.ts
- [ ] apps/client/src/career.ts
- [ ] apps/client/src/championship.ts
- [ ] apps/client/src/config.ts
- [x] apps/client/src/i18n.ts
- [ ] apps/client/src/main.ts
- [x] apps/client/src/settings.ts
- [ ] apps/client/src/styles.css

## apps/client/src/game
- [x] apps/client/src/game/ai.ts
- [ ] apps/client/src/game/assets.ts
- [ ] apps/client/src/game/atmosphere.ts
- [ ] apps/client/src/game/carSetup.ts
- [ ] apps/client/src/game/carVisual.ts
- [ ] apps/client/src/game/cinematic.ts
- [ ] apps/client/src/game/cockpit.ts
- [ ] apps/client/src/game/crashFx.ts
- [ ] apps/client/src/game/crowd.ts
- [ ] apps/client/src/game/dashDisplay.ts
- [ ] apps/client/src/game/environment.ts
- [ ] apps/client/src/game/forest.ts
- [ ] apps/client/src/game/ghost.ts
- [ ] apps/client/src/game/graphics.ts
- [ ] apps/client/src/game/grassBlades.ts
- [ ] apps/client/src/game/grassMask.ts
- [ ] apps/client/src/game/grassShells.ts
- [ ] apps/client/src/game/lapDelta.ts
- [ ] apps/client/src/game/mirror.ts
- [ ] apps/client/src/game/perf.ts
- [ ] apps/client/src/game/pitCrew.ts
- [x] apps/client/src/game/pitLane.ts
- [ ] apps/client/src/game/pitService.ts
- [ ] apps/client/src/game/preview.ts
- [ ] apps/client/src/game/racingLineFx.ts
- [ ] apps/client/src/game/racingLinePrep.ts
- [ ] apps/client/src/game/racingLineWorker.ts
- [x] apps/client/src/game/roadPatches.ts
- [ ] apps/client/src/game/roadWear.ts
- [ ] apps/client/src/game/session.ts
- [ ] apps/client/src/game/sky.ts
- [ ] apps/client/src/game/taa.ts
- [ ] apps/client/src/game/topView.ts
- [ ] apps/client/src/game/track.ts
- [ ] apps/client/src/game/trackEditor.ts
- [ ] apps/client/src/game/trackLimits.ts
- [ ] apps/client/src/game/tvCameras.ts
- [ ] apps/client/src/game/vegetation.ts
- [x] apps/client/src/game/wallCut.ts

## apps/client/src/physics
- [x] apps/client/src/physics/damage.ts
- [x] apps/client/src/physics/drivetrain.ts
- [ ] apps/client/src/physics/input.ts (Controls class done; key/touch/pad InputSmoother pending)
- [x] apps/client/src/physics/keyboardDriver.ts
- [x] apps/client/src/physics/steeringLock.ts
- [x] apps/client/src/physics/tire.ts
- [x] apps/client/src/physics/tyres.ts
- [x] apps/client/src/physics/vehicle.ts

## apps/client/src/audio
- [ ] apps/client/src/audio/audio.ts
- [ ] apps/client/src/audio/engine-worklet.d.ts
- [ ] apps/client/src/audio/engine-worklet.js
- [ ] apps/client/src/audio/engineBank.ts
- [ ] apps/client/src/audio/engineProfiles.ts
- [ ] apps/client/src/audio/radio.ts
- [ ] apps/client/src/audio/sessionAudio.ts

## apps/client/src/input
- [ ] apps/client/src/input/gamepad.ts
- [ ] apps/client/src/input/padMap.ts
- [ ] apps/client/src/input/padSetup.ts

## apps/client/src/net
- [ ] apps/client/src/net/account.ts
- [ ] apps/client/src/net/connection.ts
- [ ] apps/client/src/net/localRoom.ts
- [ ] apps/client/src/net/p2p.ts
- [ ] apps/client/src/net/remote.ts

## apps/client/src/ui
- [ ] apps/client/src/ui/carLines.ts
- [ ] apps/client/src/ui/carStatus.ts
- [ ] apps/client/src/ui/careerBlock.ts
- [ ] apps/client/src/ui/circuitMap.ts
- [ ] apps/client/src/ui/damagePanel.ts
- [ ] apps/client/src/ui/dom.ts
- [ ] apps/client/src/ui/hud.ts
- [ ] apps/client/src/ui/icons.ts
- [ ] apps/client/src/ui/images.ts
- [ ] apps/client/src/ui/overlays.ts
- [ ] apps/client/src/ui/pitMenu.ts
- [ ] apps/client/src/ui/reel.ts
- [ ] apps/client/src/ui/settingsPanel.ts
- [ ] apps/client/src/ui/social.ts
- [ ] apps/client/src/ui/timingScreen.ts
- [ ] apps/client/src/ui/trackMap.ts

## apps/client/src/mobile
- [ ] apps/client/src/mobile/appShell.ts
- [ ] apps/client/src/mobile/assetCache.ts
- [ ] apps/client/src/mobile/installScreen.ts
- [ ] apps/client/src/mobile/mobile.css
- [ ] apps/client/src/mobile/platform.ts
- [ ] apps/client/src/mobile/refreshRate.ts
- [ ] apps/client/src/mobile/touchControls.ts
- [ ] apps/client/src/mobile/touchSettings.ts

## packages/shared/src
- [x] packages/shared/src/accounts.ts
- [x] packages/shared/src/cars.ts (CarsDb)
- [x] packages/shared/src/clock.ts
- [x] packages/shared/src/constants.ts
- [ ] packages/shared/src/index.ts
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
- [ ] cars (GLB) + cars.json
- [ ] tracks Nordschleife GP/short/24h, Spa, Zandvoort + collision.apxc + forest.json
- [ ] textures, audio engine profiles + surface sounds, i18n strings
