class_name Config
extends RefCounted
## Endpoints and flags (port of config.ts). The app talks to the same Cloudflare server and website as the web game.

## Realtime server base URL (http/https; ws/wss is derived).
const SERVER_URL := "https://apex-ghost-server.ilmas.workers.dev"
const WEB_URL := "https://apex-ghost-liard.vercel.app"

static func is_dev() -> bool:
	return OS.has_feature("editor")
