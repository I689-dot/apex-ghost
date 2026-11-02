class_name Validation
extends RefCounted
## Nickname and room-code rules (port of packages/shared/src/validation.ts).

static var _invisible: RegEx
static var _markup: RegEx
static var _spaces: RegEx

static func _init_re() -> void:
	if _invisible != null:
		return
	_invisible = RegEx.create_from_string("[\\x{0000}-\\x{001f}\\x{007f}-\\x{009f}\\x{200b}-\\x{200f}\\x{2028}-\\x{202e}\\x{2060}-\\x{206f}\\x{feff}]")
	_markup = RegEx.create_from_string("[<>&\"'`\\\\]")
	_spaces = RegEx.create_from_string("\\s+")

## Trims, collapses whitespace, strips control/markup chars, enforces 2-16 chars. Returns {ok, nick | error}.
static func sanitize_nickname(raw) -> Dictionary:
	if typeof(raw) != TYPE_STRING:
		return {"ok": false, "error": "Nickname is required."}
	_init_re()
	var nick: String = raw
	nick = _invisible.sub(nick, "", true)
	nick = _markup.sub(nick, "", true)
	nick = _spaces.sub(nick, " ", true).strip_edges()
	var n := nick.length()
	if n < Const.NICK_MIN:
		return {"ok": false, "error": "Nickname must be at least %d characters." % Const.NICK_MIN}
	if n > Const.NICK_MAX:
		return {"ok": false, "error": "Nickname must be at most %d characters." % Const.NICK_MAX}
	return {"ok": true, "nick": nick}

static func nickname_key(nick: String) -> String:
	return nick.to_lower()

static func generate_room_code(rng: RandomNumberGenerator = null) -> String:
	if rng == null:
		rng = RandomNumberGenerator.new()
		rng.randomize()
	var s := ""
	for i in Const.ROOM_CODE_LENGTH:
		s += Const.ROOM_CODE_ALPHABET[rng.randi() % Const.ROOM_CODE_ALPHABET.length()]
	return s

## Normalises user input ("ab c-d e" -> "ABCDE") and checks it only uses the room-code alphabet. "" when invalid.
static func normalize_room_code(raw) -> String:
	if typeof(raw) != TYPE_STRING:
		return ""
	var code: String = (raw as String).to_upper().replace(" ", "").replace("\t", "").replace("\n", "").replace("-", "")
	if code.length() != Const.ROOM_CODE_LENGTH:
		return ""
	for ch in code:
		if not Const.ROOM_CODE_ALPHABET.contains(ch):
			return ""
	return code
