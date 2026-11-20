# Google Play Games sign-in

The game opens on two ways in: **Continue with Google Play Games** and **Play as guest**. Neither asks for an e-mail
or a password. The Play Games button appears only once the steps below are done. Until then, players race as guests.

## How it works

1. On the phone, the Play Games plugin signs the player in.
2. The plugin gives the game a one-time server auth code for the game server's OAuth client
   (`Config.PLAY_GAMES_SERVER_CLIENT_ID`).
3. The game sends that code to `POST /api/account/play-games`.
4. The Worker exchanges the code with Google using `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. It then asks the
   Play Games API who the player is (`players/me`).
5. AccountsDO signs in the account linked to that player id.
   - If no account is linked and a guest is signed in, the guest is linked, so what the guest raced is kept.
   - Otherwise a new account is made under the player's Play Games name.

The player id always comes from Google, never from the game.

Guests are accounts too. A guest has a driver name and a 48-hex device key in `user://device.json`. The game uses
that key to sign back in on its own, through `account/resume`.

## What has to be set up (Google's consoles: the owner's account)

1. **Play Console**
   1. Create the app `app.gridcorsa.racing`.
   2. Go to Grow › Play Games Services › Setup and management › Configuration.
   3. Create a Play Games project.
   4. Note its **project id**: a number of about 12 digits.
2. **Credentials** (Play Games Services › Configuration › Credentials)
   1. Add an **Android** credential: package `app.gridcorsa.racing`, with the release key's SHA-1
      `FB:5F:E6:C2:83:8A:A0:B4:5E:6C:7B:B7:9D:DD:56:F8:DC:D2:E0:EC`.
      - The upload key is `~/.config/apex-ghost/apex-ghost-release.keystore`, alias `apexghost`.
      - Once Play App Signing is on, also add the SHA-1 that Play shows under App integrity.
   2. Add a **Game server** credential, which is a Web application OAuth client. Note its **client id** and its
      **client secret**.
3. **Testers.** Add the testers' Google accounts while the Play Games project is unpublished.
4. **The server**
   1. `wrangler secret put GOOGLE_CLIENT_SECRET` (never in the repo).
   2. Put `GOOGLE_CLIENT_ID` in `wrangler.toml [vars]` or as a secret.
   3. Deploy.
5. **The game**
   1. Set `PLAY_GAMES_SERVER_CLIENT_ID` in `godot/scripts/game/config.gd` to the same client id. It is public.
   2. Install the plugin, from github.com/godot-sdk-integrations/godot-play-game-services, release v3.4.0
      `addons.zip`:
      1. Unpack it into `godot/addons/GodotPlayGameServices/`.
      2. Enable the plugin.
      3. Install the Android build template.
      4. Turn on **Use Gradle Build** in the Android export preset.
      5. Set the preset's `godot_play_game_services/game_id` to the project id.

Until step 5, `PlayGames.available()` is false, so there is no Play Games button and nothing changes in the APK.
