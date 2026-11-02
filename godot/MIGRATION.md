# Godot migration checklist (every source file must be ported; nothing skipped)

Legend: [ ] todo, [~] partly, [x] done

## apps/client/src
- [~] apps/client/src/app.ts (menu, lobby, briefing, loading, race, pause, results, championship, settings done; p2p hosting, reels, showroom pending)
- [x] apps/client/src/career.ts
- [x] apps/client/src/championship.ts
- [x] apps/client/src/config.ts
- [x] apps/client/src/i18n.ts
- [~] apps/client/src/main.ts (scenes/main.tscn + scripts/app/app.gd; intro reel pending)
- [x] apps/client/src/settings.ts
- [ ] apps/client/src/styles.css

## apps/client/src/game
- [x] apps/client/src/game/ai.ts
- [x] apps/client/src/game/assets.ts
- [x] apps/client/src/game/atmosphere.ts
- [x] apps/client/src/game/carSetup.ts
- [x] apps/client/src/game/carVisual.ts
- [ ] apps/client/src/game/cinematic.ts
- [x] apps/client/src/game/cockpit.ts
- [ ] apps/client/src/game/crashFx.ts
- [ ] apps/client/src/game/crowd.ts
- [ ] apps/client/src/game/dashDisplay.ts
- [~] apps/client/src/game/environment.ts (sky, sun, fog, rain done; windshield rain/crack, stars, moon pending)
- [ ] apps/client/src/game/forest.ts
- [x] apps/client/src/game/ghost.ts
- [ ] apps/client/src/game/graphics.ts
- [ ] apps/client/src/game/grassBlades.ts
- [ ] apps/client/src/game/grassMask.ts
- [ ] apps/client/src/game/grassShells.ts
- [x] apps/client/src/game/lapDelta.ts
- [ ] apps/client/src/game/mirror.ts
- [ ] apps/client/src/game/perf.ts
- [x] apps/client/src/game/pitCrew.ts
- [x] apps/client/src/game/pitLane.ts
- [x] apps/client/src/game/pitService.ts
- [ ] apps/client/src/game/preview.ts
- [ ] apps/client/src/game/racingLineFx.ts
- [x] apps/client/src/game/racingLinePrep.ts
- [x] apps/client/src/game/racingLineWorker.ts (thread in racing_line_prep.gd)
- [x] apps/client/src/game/roadPatches.ts
- [ ] apps/client/src/game/roadWear.ts
- [~] apps/client/src/game/session.ts (loads and runs offline end to end; optional subsystems still being attached)
- [x] apps/client/src/game/sky.ts
- [ ] apps/client/src/game/taa.ts
- [x] apps/client/src/game/topView.ts
- [~] apps/client/src/game/track.ts (scene, collision, culling, wetness, lights done; surface shaders pending)
- [ ] apps/client/src/game/trackEditor.ts
- [x] apps/client/src/game/trackLimits.ts
- [ ] apps/client/src/game/tvCameras.ts
- [ ] apps/client/src/game/vegetation.ts
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
- [ ] apps/client/src/audio/radio.ts
- [x] apps/client/src/audio/sessionAudio.ts

## apps/client/src/input
- [x] apps/client/src/input/gamepad.ts
- [x] apps/client/src/input/padMap.ts
- [ ] apps/client/src/input/padSetup.ts

## apps/client/src/net
- [x] apps/client/src/net/account.ts
- [x] apps/client/src/net/connection.ts
- [x] apps/client/src/net/localRoom.ts
- [ ] apps/client/src/net/p2p.ts
- [x] apps/client/src/net/remote.ts

## apps/client/src/ui
- [x] apps/client/src/ui/carLines.ts
- [x] apps/client/src/ui/carStatus.ts
- [x] apps/client/src/ui/careerBlock.ts
- [x] apps/client/src/ui/circuitMap.ts
- [x] apps/client/src/ui/damagePanel.ts
- [ ] apps/client/src/ui/dom.ts
- [x] apps/client/src/ui/hud.ts
- [ ] apps/client/src/ui/icons.ts
- [ ] apps/client/src/ui/images.ts
- [x] apps/client/src/ui/overlays.ts
- [x] apps/client/src/ui/pitMenu.ts
- [ ] apps/client/src/ui/reel.ts
- [x] apps/client/src/ui/settingsPanel.ts
- [x] apps/client/src/ui/social.ts
- [x] apps/client/src/ui/timingScreen.ts
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
