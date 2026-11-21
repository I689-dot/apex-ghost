class_name Config
extends RefCounted
## Endpoints and flags (port of config.ts). The app talks to the same Cloudflare server and website as the web game.

## Realtime server base URL (http/https; ws/wss is derived). APEX_SERVER overrides it (tests against a local
## `wrangler dev`).
static var SERVER_URL: String = OS.get_environment("APEX_SERVER") if OS.get_environment("APEX_SERVER") != "" else "https://apex-ghost-server.ilmas.workers.dev"
## Google Play Games sign-in: the game server's OAuth client id (Google Cloud › Credentials, a "Web application"
## client in the Play Games project; the same id as the server's GOOGLE_CLIENT_ID). Public, not a secret: the game asks
## Google for an auth code meant for it. Empty: no Play Games button (docs/play-games-sign-in.md).
const PLAY_GAMES_SERVER_CLIENT_ID := ""
