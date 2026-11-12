extends Node
## Downloadable track packs (autoload "Packs"): a circuit too big for the app (Spa, ~240 MB) comes as a Godot resource
## pack (tools/godot/build-track-pack.py) that is downloaded once, checked and mounted over res://, so the track loads
## from the same paths as a bundled one.
##  - Manifest: <base>/packs.json {format, packs: {id: {name, version, probe, android | pc: {file, size, sha256}}}}, kept
##    in user://packs/manifest.json for the sizes offline. <base>: APEX_PACKS_URL, else the project setting
##    "apex/packs_url" (empty: no downloads).
##  - Download: HTTP(S) into <file>.part, resumed with a Range request after an interruption or a restart of the app;
##    SHA-256 checked before the pack replaces anything; the state (user://packs/state.json) records what is installed.
##  - Mount: every installed pack at start, and right after its download.
##  - Update: a manifest version other than the installed one offers the new pack; the old file is removed once the new
##    one is in.

signal changed(id: String)

## (APEX_PACKS_DIR: another folder, for tests)
var DIR := OS.get_environment("APEX_PACKS_DIR") if OS.get_environment("APEX_PACKS_DIR") != "" else "user://packs/"
## Track layout id -> pack id (several layouts of a circuit share its pack).
const PACK_OF := {"spa": "spa"}
## A file of each pack, to tell whether it is present (bundled in a development build or mounted) before any manifest.
const PROBES := {"spa": "res://assets/maps/spa_g/map_track.glb"}
const CHUNK := 1 << 20

var manifest := {}
var state := {}
## id -> {phase: "connecting" | "downloading" | "checking", done, total, error}
var jobs := {}

var _http: HTTPClient
var _job_id := ""
var _file: FileAccess
var _hash: HashingContext
var _check: FileAccess
var _req: HTTPRequest

func _ready() -> void:
	DirAccess.make_dir_recursive_absolute(DIR)
	state = _read(DIR + "state.json")
	manifest = _read(DIR + "manifest.json")
	for id in state.keys():
		_mount(id)
	# APEX_PACKS_AUTO=<id>: fetch the manifest and download that pack straight away (end-to-end tests of a build)
	var auto := OS.get_environment("APEX_PACKS_AUTO")
	if auto != "" and not present(auto):
		changed.connect(func(cid: String) -> void:
			if cid == auto and _job_id == "" and not present(auto) and not jobs.has(auto) and not remote(auto).is_empty():
				download(auto)
			if jobs.has(cid) and jobs[cid].phase == "failed":
				print("[packs] %s: %s" % [cid, jobs[cid].error])
				get_tree().quit(1)
			elif present(cid):
				print("[packs] %s installed and mounted" % cid)
				get_tree().quit(0))
		refresh()

static func base_url() -> String:
	var u := OS.get_environment("APEX_PACKS_URL")
	if u == "":
		u = str(ProjectSettings.get_setting("apex/packs_url", ""))
	return u if u == "" or u.ends_with("/") else u + "/"

static func platform() -> String:
	return "android" if OS.has_feature("android") or OS.has_feature("mobile") else "pc"

## The pack a track layout needs ("" if none).
static func pack_of(layout_id: String) -> String:
	return PACK_OF.get(layout_id, "")

## Can the layout be raced now (bundled, or its pack mounted)?
func ready_for(layout_id: String) -> bool:
	var id := pack_of(layout_id)
	return id == "" or present(id)

func present(id: String) -> bool:
	var probe: String = PROBES.get(id, str((manifest.get("packs", {}) as Dictionary).get(id, {}).get("probe", "")))
	return probe != "" and (ResourceLoader.exists(probe) or FileAccess.file_exists(probe))

## The manifest's entry for this platform ({} if unknown).
func remote(id: String) -> Dictionary:
	var p: Dictionary = (manifest.get("packs", {}) as Dictionary).get(id, {})
	return p.get(platform(), {})

## A newer pack than the installed one.
func update_available(id: String) -> bool:
	var p: Dictionary = (manifest.get("packs", {}) as Dictionary).get(id, {})
	return state.has(id) and not p.is_empty() and str(p.get("version", "")) != str(state[id].version)

func size_mb(id: String) -> float:
	return float(remote(id).get("size", 0)) / 1e6

## Fetch the manifest (quietly: offline keeps the cached one).
func refresh() -> void:
	if base_url() == "" or _req != null:
		return
	_req = HTTPRequest.new()
	add_child(_req)
	_req.request_completed.connect(func(result: int, code: int, _h, body: PackedByteArray) -> void:
		_req.queue_free()
		_req = null
		if result == HTTPRequest.RESULT_SUCCESS and code == 200:
			var m = JSON.parse_string(body.get_string_from_utf8())
			if m is Dictionary and m.has("packs"):
				manifest = m
				_write(DIR + "manifest.json", manifest)
				for id in (manifest.packs as Dictionary):
					changed.emit(id))
	_req.request(base_url() + "packs.json")

## Start (or resume) the download of a pack; progress in jobs[id], changed(id) on every step.
func download(id: String) -> void:
	if _job_id != "" or remote(id).is_empty() or base_url() == "":
		return
	_job_id = id
	jobs[id] = {"phase": "connecting", "done": 0, "total": int(remote(id).size), "error": ""}
	var part := DIR + str(remote(id).file) + ".part"
	_file = FileAccess.open(part, FileAccess.READ_WRITE) if FileAccess.file_exists(part) else FileAccess.open(part, FileAccess.WRITE)
	if _file == null:
		_fail("Cannot write the download")
		return
	_file.seek_end()
	jobs[id].done = _file.get_position()
	var u := base_url() + str(remote(id).file)
	var tls := u.begins_with("https://")
	var rest := u.substr(8 if tls else 7)
	var slash := rest.find("/")
	var host := rest.substr(0, slash)
	var port := 443 if tls else 80
	if host.contains(":"):
		port = int(host.get_slice(":", 1))
		host = host.get_slice(":", 0)
	_http = HTTPClient.new()
	var err := _http.connect_to_host(host, port, TLSOptions.client() if tls else null)
	if err != OK:
		_fail("Cannot connect")
		return
	jobs[id].path = rest.substr(slash)
	jobs[id].requested = false
	jobs[id].answered = false
	changed.emit(id)

func cancel(id: String) -> void:
	if _job_id == id:
		_close()
		jobs.erase(id)
		changed.emit(id)

## Remove an installed pack (it stays mounted until the app restarts).
func remove(id: String) -> void:
	if state.has(id):
		DirAccess.remove_absolute(DIR + str(state[id].file))
		state.erase(id)
		_write(DIR + "state.json", state)
		changed.emit(id)

func _process(_dt: float) -> void:
	if _job_id == "":
		return
	var j: Dictionary = jobs[_job_id]
	if j.phase == "checking":
		_check_step()
		return
	_http.poll()
	var st := _http.get_status()
	if st == HTTPClient.STATUS_CONNECTING or st == HTTPClient.STATUS_RESOLVING or st == HTTPClient.STATUS_REQUESTING:
		return
	if st == HTTPClient.STATUS_CONNECTED and not j.requested:
		var headers := PackedStringArray(["User-Agent: ApexGhost"])
		if int(j.done) > 0:
			headers.append("Range: bytes=%d-" % int(j.done))
		_http.request(HTTPClient.METHOD_GET, j.path, headers)
		j.requested = true
		j.phase = "downloading"
		return
	if st == HTTPClient.STATUS_BODY:
		var code := _http.get_response_code()
		# once per response (checked on every frame it wiped the file each frame of a full download)
		if not j.get("answered", false):
			j.answered = true
			if code == 200 and int(j.done) > 0:
				# the server ignored the range: start over
				_file.resize(0)
				_file.seek(0)
				j.done = 0
			elif code != 200 and code != 206:
				_fail("Server error")
				return
		for i in 8:
			var chunk := _http.read_response_body_chunk()
			if chunk.is_empty():
				break
			if OS.get_environment("APEX_PACKS_TRACE") != "" and int(j.get("traced", 0)) < 4:
				j.traced = int(j.get("traced", 0)) + 1
				print("[packs] write %d bytes at %d (done %d, code %d)" % [chunk.size(), _file.get_position(), int(j.done), code])
			_file.store_buffer(chunk)
			j.done = int(j.done) + chunk.size()
			_http.poll()
			if _http.get_status() != HTTPClient.STATUS_BODY:
				break
		changed.emit(_job_id)
		return
	# the body is complete: the connection kept open, or every byte in and the server gone (HTTP/1.0 closes after the body: the status then
	# reads as an error)
	if j.requested and (st == HTTPClient.STATUS_CONNECTED or int(j.done) == int(j.total)):
		if int(j.done) != int(j.total):
			_fail("Download incomplete")
			return
		_file.close()
		_file = null
		_http.close()
		j.phase = "checking"
		j.done = 0
		_hash = HashingContext.new()
		_hash.start(HashingContext.HASH_SHA256)
		_check = FileAccess.open(DIR + str(remote(_job_id).file) + ".part", FileAccess.READ)
		changed.emit(_job_id)
		return
	if st == HTTPClient.STATUS_CANT_CONNECT or st == HTTPClient.STATUS_CANT_RESOLVE or st == HTTPClient.STATUS_CONNECTION_ERROR or st == HTTPClient.STATUS_TLS_HANDSHAKE_ERROR or st == HTTPClient.STATUS_DISCONNECTED:
		_fail("Connection lost: try again to resume")

## Hash a few MB a frame (a 240 MB pack in a few seconds without freezing the menu).
func _check_step() -> void:
	var j: Dictionary = jobs[_job_id]
	for i in 6:
		var b := _check.get_buffer(CHUNK)
		if b.is_empty():
			break
		_hash.update(b)
		j.done = int(j.done) + b.size()
	changed.emit(_job_id)
	if not _check.eof_reached() and int(j.done) < int(j.total):
		return
	_check.close()
	_check = null
	var id := _job_id
	var r := remote(id)
	var part := DIR + str(r.file) + ".part"
	if _hash.finish().hex_encode() != str(r.sha256):
		# (APEX_PACKS_AUTO: kept for a look)
		if OS.get_environment("APEX_PACKS_AUTO") != "":
			DirAccess.rename_absolute(part, part + ".bad")
		else:
			DirAccess.remove_absolute(part)
		_fail("The download was damaged: try again")
		return
	DirAccess.rename_absolute(part, DIR + str(r.file))
	var old: Dictionary = state.get(id, {})
	if not old.is_empty() and str(old.file) != str(r.file):
		DirAccess.remove_absolute(DIR + str(old.file))
	var p: Dictionary = manifest.packs[id]
	state[id] = {"version": str(p.version), "file": str(r.file), "size": int(r.size), "sha256": str(r.sha256)}
	_write(DIR + "state.json", state)
	_job_id = ""
	jobs.erase(id)
	_mount(id)
	changed.emit(id)

func _mount(id: String) -> void:
	var s: Dictionary = state[id]
	var path := DIR + str(s.file)
	# a pack that is not there or not whole (an interrupted copy) is forgotten rather than mounted
	if not FileAccess.file_exists(path) or FileAccess.open(path, FileAccess.READ).get_length() != int(s.size):
		state.erase(id)
		_write(DIR + "state.json", state)
		return
	if not ProjectSettings.load_resource_pack(path, true):
		push_error("track pack %s did not mount" % path)

func _fail(msg: String) -> void:
	if jobs.has(_job_id):
		jobs[_job_id].error = msg
		jobs[_job_id].phase = "failed"
	var id := _job_id
	_close()
	changed.emit(id)

func _close() -> void:
	if _file != null:
		_file.close()
		_file = null
	if _check != null:
		_check.close()
		_check = null
	if _http != null:
		_http.close()
		_http = null
	_job_id = ""

static func _read(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {}
	var d = JSON.parse_string(FileAccess.get_file_as_string(path))
	return d if d is Dictionary else {}

static func _write(path: String, d: Dictionary) -> void:
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f != null:
		f.store_string(JSON.stringify(d))
