class_name I18n
extends RefCounted
## Interface language: English (the source strings) or Spanish (port of i18n.ts). t() looks the English text up
## in the Spanish table (res://data/i18n_es.json) and falls back to English. {name} placeholders come from vars.

const LANGUAGES := [["en", "English"], ["es", "Español"]]

static var lang := "en"
static var _es: Dictionary = {}
static var _loaded := false

static func set_lang(l: String) -> void:
	lang = l

static func get_lang() -> String:
	return lang

## The device language as the first-run default.
static func default_lang() -> String:
	return "es" if OS.get_locale_language().to_lower().begins_with("es") else "en"

static func t(en: String, vars: Dictionary = {}) -> String:
	var s := en
	if lang == "es":
		if not _loaded:
			_loaded = true
			var f := FileAccess.get_file_as_string("res://data/i18n_es.json")
			if f != "":
				_es = JSON.parse_string(f)
			_es.merge(I18nExtra.ES, false)
		if _es.has(en):
			s = _es[en]
	if not vars.is_empty():
		var re := RegEx.create_from_string("\\{(\\w+)\\}")
		var out := ""
		var last := 0
		for m in re.search_all(s):
			out += s.substr(last, m.get_start() - last)
			var k := m.get_string(1)
			out += str(vars[k]) if vars.has(k) else m.get_string()
			last = m.get_end()
		s = out + s.substr(last)
	return s
