class_name JsonHttp
## One request to the game server: a JSON body (null: GET, otherwise POST) and a JSON answer.

## Returns {sent, status, data}: sent false (status 0) when it never got an answer; data the answer's object, else {}.
## parent: the node the request runs under (the root by default; the root takes no child while the first scene sets up,
## so the Account autoload passes itself: its sign-in runs then).
static func request(url: String, body: Variant = null, token: Variant = null, parent: Node = null) -> Dictionary:
	var req := HTTPRequest.new()
	(parent if parent != null else (Engine.get_main_loop() as SceneTree).root).add_child(req)
	var headers := PackedStringArray(["Content-Type: application/json"])
	if token != null:
		headers.append("Authorization: Bearer %s" % token)
	var method := HTTPClient.METHOD_GET if body == null else HTTPClient.METHOD_POST
	if req.request(url, headers, method, "" if body == null else JSON.stringify(body)) != OK:
		req.queue_free()
		return {"sent": false, "status": 0, "data": {}}
	var res: Array = await req.request_completed
	req.queue_free()
	if res[0] != HTTPRequest.RESULT_SUCCESS:
		return {"sent": false, "status": 0, "data": {}}
	var bytes: PackedByteArray = res[3]
	var data: Variant = JSON.parse_string(bytes.get_string_from_utf8()) if bytes.size() > 0 else null
	return {"sent": true, "status": int(res[1]), "data": data if data is Dictionary else {}}

## The message for a request that got no answer.
static func unreachable() -> String:
	return I18n.t("Cannot reach the game server. Check your connection.")
