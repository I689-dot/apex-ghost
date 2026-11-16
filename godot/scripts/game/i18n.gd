class_name I18n
extends RefCounted
## The interface text. The game is in English only (the user, 2026-11-16: the Spanish translation and the language
## setting are gone); t() fills {name} placeholders from vars. Kept as the one place every text goes through.

static func t(en: String, vars: Dictionary = {}) -> String:
	var s := en
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
