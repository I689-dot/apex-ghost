extends SceneTree
## Track packs (scripts/game/track_packs.gd): a small pack served by tools/godot/pack-server.py, the connection cut
## part-way (the download must resume with a Range request), the SHA-256 checked, the pack mounted (its file readable
## from res://), a damaged download refused, an update replacing the installed version.
##   python3 -I tools/godot/pack-server.py <dir> 8765 --drop-after 40000 &   (the test writes <dir>: PACK_TEST_DIR)
##   PACK_TEST_DIR=<dir> APEX_PACKS_URL=http://127.0.0.1:8765/ APEX_PACKS_DIR=<dir>/user/ tools/godot/gd.sh tests/pack_test.gd

var failures := 0

func check(name: String, ok: bool, detail: String = "") -> void:
	if ok:
		print("ok   ", name)
	else:
		failures += 1
		print("FAIL ", name, " ", detail)

## A pack holding res://pack_test/hello.txt (and some filler, so the server can cut it part-way) with this text.
func make_pack(path: String, text: String) -> Dictionary:
	var tmp := path + ".src"
	var f := FileAccess.open(tmp, FileAccess.WRITE)
	f.store_string(text)
	f.close()
	var filler := path + ".fill"
	f = FileAccess.open(filler, FileAccess.WRITE)
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	# 1.2 MB: a download spread over many frames (a check run once per frame once wiped it frame by frame)
	for i in 300000:
		f.store_32(rng.randi())
	f.close()
	var p := PCKPacker.new()
	p.pck_start(path)
	p.add_file("res://pack_test/hello.txt", tmp)
	p.add_file("res://pack_test/filler.bin", filler)
	p.flush()
	DirAccess.remove_absolute(tmp)
	DirAccess.remove_absolute(filler)
	var h := HashingContext.new()
	h.start(HashingContext.HASH_SHA256)
	h.update(FileAccess.get_file_as_bytes(path))
	return {"file": path.get_file(), "size": FileAccess.get_file_as_bytes(path).size(), "sha256": h.finish().hex_encode()}

func write_manifest(dir: String, version: String, entry: Dictionary) -> void:
	var m := {"format": 1, "packs": {"test": {"name": "Test", "version": version, "probe": "res://pack_test/hello.txt", "android": entry, "pc": entry}}}
	var f := FileAccess.open(dir + "packs.json", FileAccess.WRITE)
	f.store_string(JSON.stringify(m))
	f.close()

func run_job(packs: Node, id: String, max_frames: int = 3000) -> void:
	packs.download(id)
	for i in max_frames:
		await process_frame
		if not packs.jobs.has(id) or packs.jobs[id].phase == "failed":
			return

func _initialize() -> void:
	var dir := OS.get_environment("PACK_TEST_DIR")
	if dir == "" or OS.get_environment("APEX_PACKS_URL") == "":
		print("FAIL set PACK_TEST_DIR and APEX_PACKS_URL (see the header)")
		quit(1)
		return
	dir = dir.trim_suffix("/") + "/"
	var v1 := make_pack(dir + "test-1.pck", "version one")
	write_manifest(dir, "1", v1)
	var packs: Node = load("res://scripts/game/track_packs.gd").new()
	root.add_child(packs)
	await process_frame
	check("not present before the download", not packs.present("test"))
	packs.refresh()
	for i in 300:
		await process_frame
		if not packs.remote("test").is_empty():
			break
	check("manifest fetched", not packs.remote("test").is_empty(), str(packs.manifest))
	# first try: the server cuts it after 40 kB
	await run_job(packs, "test")
	var cut: bool = packs.jobs.has("test") and packs.jobs.test.phase == "failed"
	check("a cut download stops with an error", cut, str(packs.jobs.get("test", {})))
	var part_size := FileAccess.get_file_as_bytes(packs.DIR + "test-1.pck.part").size()
	check("the part is kept for resuming", part_size > 0 and part_size < int(v1.size), "%d of %d" % [part_size, v1.size])
	await run_job(packs, "test")
	check("resumed and finished", not packs.jobs.has("test"), str(packs.jobs.get("test", {})))
	check("installed with its hash", packs.state.has("test") and packs.state.test.sha256 == v1.sha256)
	check("mounted: its file reads from res://", FileAccess.get_file_as_string("res://pack_test/hello.txt") == "version one")
	check("present after the download", packs.present("test"))
	# a damaged download: the manifest's hash does not match
	var v2 := make_pack(dir + "test-2.pck", "version two")
	var bad := v2.duplicate()
	bad.sha256 = "00" + str(v2.sha256).substr(2)
	write_manifest(dir, "2", bad)
	packs.refresh()
	for i in 300:
		await process_frame
		if packs.update_available("test"):
			break
	check("an update is offered", packs.update_available("test"))
	await run_job(packs, "test")
	await run_job(packs, "test")
	check("a damaged download is refused", packs.jobs.has("test") and packs.jobs.test.phase == "failed" and packs.state.test.version == "1", str(packs.jobs.get("test", {})))
	# the real update
	write_manifest(dir, "2", v2)
	packs.refresh()
	for i in 300:
		await process_frame
		if str(packs.remote("test").get("sha256", "")) == str(v2.sha256):
			break
	await run_job(packs, "test")
	check("update installed", packs.state.has("test") and packs.state.test.version == "2", str(packs.state))
	check("update mounted over the old one", FileAccess.get_file_as_string("res://pack_test/hello.txt") == "version two")
	check("the old version's file removed", not FileAccess.file_exists(packs.DIR + "test-1.pck"))
	print("%d failures" % failures)
	quit(1 if failures > 0 else 0)
