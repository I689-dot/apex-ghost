class_name EngineBank
extends RefCounted
## Recorded engine loops (port of audio/engineBank.ts): engine_<name>.bin is int16 PCM, engine_<name>.json indexes
## constant-rpm loops (each a whole number of firing periods, with an on-throttle and an off-throttle take).

static var _cache := {}

## {order, cyl, norm, loops: [{rpm, on, off}]} (streams looping at their own rate), or {} when the files are missing.
static func load_bank(name: String) -> Dictionary:
	if _cache.has(name):
		return _cache[name]
	var base := "res://assets/audio/engine_%s" % name
	var out := {}
	if FileAccess.file_exists(base + ".json") and FileAccess.file_exists(base + ".bin"):
		var meta: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(base + ".json"))
		var pcm := FileAccess.get_file_as_bytes(base + ".bin")
		var rate := int(meta.sampleRate)
		var loops: Array = []
		var sum := 0.0
		var cnt := 0
		for l in meta.loops:
			var on := _loop(pcm, l.on, rate)
			var off := _loop(pcm, l.off, rate)
			# every bank at the same full-throttle loudness (the files are peak-normalised and recordings differ in crest factor)
			var o: int = l.on[0]
			for j in range(0, int(l.on[1]), 4):
				var s := pcm.decode_s16((o + j) * 2) / 32767.0
				sum += s * s
				cnt += 1
			loops.append({"rpm": float(l.rpm), "on": on, "off": off})
		out = {"order": float(meta.order), "cyl": int(meta.cyl), "loops": loops, "norm": 0.2 / sqrt(maxf(1e-9, sum / maxf(1.0, cnt)))}
	else:
		push_warning("engine bank %s unavailable" % name)
	_cache[name] = out
	return out

static func _loop(pcm: PackedByteArray, span: Array, rate: int) -> AudioStreamWAV:
	var s := AudioStreamWAV.new()
	s.format = AudioStreamWAV.FORMAT_16_BITS
	s.mix_rate = rate
	s.data = pcm.slice(int(span[0]) * 2, (int(span[0]) + int(span[1])) * 2)
	s.loop_mode = AudioStreamWAV.LOOP_FORWARD
	s.loop_begin = 0
	s.loop_end = int(span[1])
	return s
