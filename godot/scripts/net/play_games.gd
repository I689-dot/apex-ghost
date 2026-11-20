class_name PlayGames
extends RefCounted
## Google Play Games sign-in on Android (the user, 2026-11-20: "login with google play games or playing as guests"),
## through the godot-play-game-services plugin (github.com/godot-sdk-integrations/godot-play-game-services, MIT;
## its Android singleton, used directly so that its GDScript autoloads are not needed): Play Games signs the player in,
## then gives a one-time server auth code for Config.PLAY_GAMES_SERVER_CLIENT_ID, which the game server exchanges
## with Google for the player's id (apps/server index.ts playGamesSignIn). The game never sends a player id itself.
## Without the plugin (the PC, a build without the Gradle template), or before the client id is set, there is no Play
## Games button. Setup: docs/play-games-sign-in.md.

const SINGLETON := "GodotPlayGameServices"
## How long the Play Games sheet may stay open before the button gives up waiting.
const WAIT_S := 120.0

static var _plugin: Object = null

static func available() -> bool:
	return OS.get_name() == "Android" and Engine.has_singleton(SINGLETON) and Config.PLAY_GAMES_SERVER_CLIENT_ID != ""

static func _plugin_obj() -> Object:
	if _plugin == null and Engine.has_singleton(SINGLETON):
		_plugin = Engine.get_singleton(SINGLETON)
		_plugin.initialize()
	return _plugin

## Signs in to Play Games (its own sheet when it is needed) and returns the server auth code, or "" when the player
## did not sign in (cancelled, no Play Games, no network).
static func auth_code() -> String:
	var p := _plugin_obj()
	if p == null:
		return ""
	p.isAuthenticated()
	var ok = await _wait(Signal(p, "userAuthenticated"))
	if ok != true:
		p.signIn()
		ok = await _wait(Signal(p, "userAuthenticated"))
	if ok != true:
		return ""
	p.requestServerSideAccess(Config.PLAY_GAMES_SERVER_CLIENT_ID, false)
	var code = await _wait(Signal(p, "serverSideAccessRequested"))
	return code if typeof(code) == TYPE_STRING else ""

## The signal's first argument, or null after WAIT_S.
static func _wait(sig: Signal) -> Variant:
	var box := {"done": false, "v": null}
	var f := func(v): box.done = true; box.v = v
	sig.connect(f, CONNECT_ONE_SHOT)
	var tree := Engine.get_main_loop() as SceneTree
	var t := 0.0
	while not box.done and t < WAIT_S:
		await tree.create_timer(0.1).timeout
		t += 0.1
	if sig.is_connected(f):
		sig.disconnect(f)
	return box.v
