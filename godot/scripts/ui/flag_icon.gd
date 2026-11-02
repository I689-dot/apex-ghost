class_name FlagIcon
extends RefCounted
## A country's flag (an image, no emoji), 4:3 (port of flagImg in ui/social.ts). The flag files are bundled
## (godot/assets_static/flags/<cc>.png, fetched by tools/godot/fetch-flags.mjs from flagcdn.com).

static var _tex := {}

## A TextureRect with the flag, or null for an unknown or empty code.
static func make(cc, width: int = 20) -> TextureRect:
	if cc == null or typeof(cc) != TYPE_STRING or not Accounts.profile_ok("country", cc):
		return null
	var tex := texture(cc)
	if tex == null:
		return null
	var r := TextureRect.new()
	r.texture = tex
	r.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	r.stretch_mode = TextureRect.STRETCH_SCALE
	r.custom_minimum_size = Vector2(width, roundi(width * 0.75))
	return r

static func texture(cc: String) -> Texture2D:
	var key := cc.to_lower()
	if _tex.has(key):
		return _tex[key]
	var path := "res://assets_static/flags/%s.png" % key
	var t = load(path) if ResourceLoader.exists(path) else null
	_tex[key] = t
	return t
