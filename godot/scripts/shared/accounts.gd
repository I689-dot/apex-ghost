class_name Accounts
extends RefCounted
## Account types and profile checks (port of packages/shared/src/accounts.ts). The data are plain Dictionaries
## with the field names the server's account API sends.

static func profile_ok(field: String, value: String) -> bool:
	var re := RegEx.new()
	match field:
		"country":
			re.compile("^[A-Z]{2}$")
		"abbr":
			re.compile("^[A-Z]{3}$")
		"colour":
			re.compile("^#[0-9a-fA-F]{6}$")
		_:
			return false
	return re.search(value) != null
