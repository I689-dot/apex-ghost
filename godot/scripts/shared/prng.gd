class_name Prng
extends RefCounted
## mulberry32: tiny deterministic PRNG, bit-identical to the web game's (weather and grids are shared with it).
## Usage: var r := Prng.new(seed); r.next() -> float in [0, 1).

const M32 := 0xFFFFFFFF

var _a: int

func _init(seed_value: int) -> void:
	_a = seed_value & M32

func next() -> float:
	_a = (_a + 0x6d2b79f5) & M32
	var t := _a
	t = ((t ^ (t >> 15)) * (t | 1)) & M32
	t = (t ^ (t + (((t ^ (t >> 7)) * (t | 61)) & M32))) & M32
	return float((t ^ (t >> 14)) & M32) / 4294967296.0

static func shuffle(items: Array, rand: Prng) -> Array:
	var a := items.duplicate()
	var i := a.size() - 1
	while i > 0:
		var j := int(floorf(rand.next() * (i + 1)))
		var tmp = a[i]
		a[i] = a[j]
		a[j] = tmp
		i -= 1
	return a

static func hash_string(s: String) -> int:
	var h := 2166136261
	for b in _utf16_units(s):
		h ^= b
		h = (h * 16777619) & M32
	return h & M32

## UTF-16 code units, as JS charCodeAt sees them.
static func _utf16_units(s: String) -> Array:
	var out: Array = []
	var bytes := s.to_utf16_buffer()
	for i in range(0, bytes.size(), 2):
		out.append(bytes[i] | (bytes[i + 1] << 8))
	return out
