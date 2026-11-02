class_name CarState
extends RefCounted
## One car state sample and its binary wire format (port of the binary part of packages/shared/src/protocol.ts).
## Wire-compatible with the web client and the Cloudflare server (little endian).

const BIN_CLIENT_STATE := 1
const BIN_SERVER_RELAY := 2
## Host -> server: states of a bot it simulates. Same layout as a relay packet (type, slot, count, seq, states).
const BIN_BOT_STATE := 3

const FLAG_BRAKE := 1
const FLAG_HEADLIGHTS := 2
const FLAG_REVERSE := 4
const FLAG_RESET := 8
const FLAG_HANDBRAKE := 16
const FLAG_SMOKE := 32
## All four wheels beyond the track limits: the lap is invalid.
const FLAG_OFF_TRACK := 64
## Touched by another car in the last second (contact rule).
const FLAG_HIT := 128

## Bytes per encoded sample. Header: type u8, count u8, seq u16. The relay header additionally has slot u8.
const STATE_BYTES := 4 + 9 + 4 + 6 + 6 + 1 + 2 + 4 + 1
const CLIENT_HEADER := 4
const RELAY_HEADER := 5

const TWO_PI := PI * 2.0
const SQRT1_2 := 0.7071067811865476

## Server-clock time in ms.
var t := 0.0
var px := 0.0
var py := 0.0
var pz := 0.0
var qx := 0.0
var qy := 0.0
var qz := 0.0
var qw := 1.0
var vx := 0.0
var vy := 0.0
var vz := 0.0
var wx := 0.0
var wy := 0.0
var wz := 0.0
## Front wheel steer angle, radians.
var steer := 0.0
## Wheel rotation angles front/rear axle, radians.
var rot_f := 0.0
var rot_r := 0.0
## Suspension compression per wheel FL, FR, RL, RR (m, 0..0.25).
var susp := [0.0, 0.0, 0.0, 0.0]
var flags := 0

func copy_from(s: CarState) -> CarState:
	t = s.t
	px = s.px; py = s.py; pz = s.pz
	qx = s.qx; qy = s.qy; qz = s.qz; qw = s.qw
	vx = s.vx; vy = s.vy; vz = s.vz
	wx = s.wx; wy = s.wy; wz = s.wz
	steer = s.steer; rot_f = s.rot_f; rot_r = s.rot_r
	susp = s.susp.duplicate()
	flags = s.flags
	return self

## JS Math.round (halves go up).
static func _jsr(v: float) -> int:
	return int(floorf(v + 0.5))

static func _write_i24(b: PackedByteArray, o: int, v: float) -> void:
	var x := clampi(_jsr(v), -8388608, 8388607) & 0xffffff
	b[o] = x & 0xff
	b[o + 1] = (x >> 8) & 0xff
	b[o + 2] = (x >> 16) & 0xff

static func _read_i24(b: PackedByteArray, o: int) -> int:
	var x: int = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)
	return x - 0x1000000 if (x & 0x800000) != 0 else x

## Smallest-three quaternion compression: 2-bit index + 3 x 10-bit components.
static func pack_quat(qx_: float, qy_: float, qz_: float, qw_: float) -> int:
	var c := [qx_, qy_, qz_, qw_]
	var idx := 0
	var mx := absf(qx_)
	if absf(qy_) > mx:
		mx = absf(qy_)
		idx = 1
	if absf(qz_) > mx:
		mx = absf(qz_)
		idx = 2
	if absf(qw_) > mx:
		idx = 3
	var sign := -1.0 if c[idx] < 0.0 else 1.0
	var packed := idx
	for i in 4:
		if i == idx:
			continue
		var v := clampf((c[i] * sign) / SQRT1_2, -1.0, 1.0)
		packed = (packed << 10) | _jsr((v * 0.5 + 0.5) * 1023.0)
	return packed & 0xFFFFFFFF

## Unpacks into the quaternion fields of out (a CarState).
static func unpack_quat(packed: int, out: CarState) -> void:
	var idx := (packed >> 30) & 3
	var vals := [0.0, 0.0, 0.0]
	for k in [2, 1, 0]:
		vals[k] = (((packed >> ((2 - k) * 10)) & 1023) / 1023.0 - 0.5) * 2.0 * SQRT1_2
	var rest := sqrt(maxf(0.0, 1.0 - vals[0] * vals[0] - vals[1] * vals[1] - vals[2] * vals[2]))
	var c := [0.0, 0.0, 0.0, 0.0]
	var k2 := 0
	for i in 4:
		if i == idx:
			c[i] = rest
		else:
			c[i] = vals[k2]
			k2 += 1
	out.qx = c[0]
	out.qy = c[1]
	out.qz = c[2]
	out.qw = c[3]

func _write(b: PackedByteArray, o: int) -> int:
	b.encode_u32(o, int(t) & 0xFFFFFFFF)
	o += 4
	_write_i24(b, o, px * 1000.0)
	_write_i24(b, o + 3, py * 1000.0)
	_write_i24(b, o + 6, pz * 1000.0)
	o += 9
	b.encode_u32(o, pack_quat(qx, qy, qz, qw))
	o += 4
	b.encode_s16(o, clampi(_jsr(vx * 100.0), -32768, 32767))
	b.encode_s16(o + 2, clampi(_jsr(vy * 100.0), -32768, 32767))
	b.encode_s16(o + 4, clampi(_jsr(vz * 100.0), -32768, 32767))
	o += 6
	b.encode_s16(o, clampi(_jsr(wx * 1000.0), -32768, 32767))
	b.encode_s16(o + 2, clampi(_jsr(wy * 1000.0), -32768, 32767))
	b.encode_s16(o + 4, clampi(_jsr(wz * 1000.0), -32768, 32767))
	o += 6
	b.encode_s8(o, clampi(_jsr((steer / 0.7) * 127.0), -127, 127))
	o += 1
	var rf := fposmod(rot_f, TWO_PI)
	var rr := fposmod(rot_r, TWO_PI)
	b[o] = _jsr((rf / TWO_PI) * 255.0) & 255
	b[o + 1] = _jsr((rr / TWO_PI) * 255.0) & 255
	o += 2
	for i in 4:
		b[o + i] = clampi(_jsr((susp[i] / 0.25) * 255.0), 0, 255)
	o += 4
	b[o] = flags & 255
	return o + 1

func _read(b: PackedByteArray, o: int, time_base: float) -> int:
	var t32 := b.decode_u32(o)
	var base := time_base - fmod(time_base, 4294967296.0)
	var tt := base + t32
	if tt - time_base > 2147483648.0:
		tt -= 4294967296.0
	elif time_base - tt > 2147483648.0:
		tt += 4294967296.0
	t = tt
	o += 4
	px = _read_i24(b, o) / 1000.0
	py = _read_i24(b, o + 3) / 1000.0
	pz = _read_i24(b, o + 6) / 1000.0
	o += 9
	unpack_quat(b.decode_u32(o), self)
	o += 4
	vx = b.decode_s16(o) / 100.0
	vy = b.decode_s16(o + 2) / 100.0
	vz = b.decode_s16(o + 4) / 100.0
	o += 6
	wx = b.decode_s16(o) / 1000.0
	wy = b.decode_s16(o + 2) / 1000.0
	wz = b.decode_s16(o + 4) / 1000.0
	o += 6
	steer = (b.decode_s8(o) / 127.0) * 0.7
	o += 1
	rot_f = (b[o] / 255.0) * TWO_PI
	rot_r = (b[o + 1] / 255.0) * TWO_PI
	o += 2
	for i in 4:
		susp[i] = (b[o + i] / 255.0) * 0.25
	o += 4
	flags = b[o]
	return o + 1

## Encode the first `count` states into a client packet.
static func encode_client_states(seq: int, states: Array, count: int) -> PackedByteArray:
	var b := PackedByteArray()
	b.resize(CLIENT_HEADER + count * STATE_BYTES)
	b[0] = BIN_CLIENT_STATE
	b[1] = count
	b.encode_u16(2, seq & 0xffff)
	var o := CLIENT_HEADER
	for i in count:
		o = states[i]._write(b, o)
	return b

## Validates a client packet. Returns the sample count, or -1 when malformed.
static func validate_client_packet(b: PackedByteArray) -> int:
	if b.size() < CLIENT_HEADER or b[0] != BIN_CLIENT_STATE:
		return -1
	var count := b[1]
	if count < 1 or count > 4:
		return -1
	if b.size() != CLIENT_HEADER + count * STATE_BYTES:
		return -1
	return count

## Decode a client packet's states into `out` (CarStates). Returns {seq, count, slot} or {}.
static func decode_client_states(b: PackedByteArray, out: Array, time_base: float) -> Dictionary:
	var count := validate_client_packet(b)
	if count < 0:
		return {}
	var o := CLIENT_HEADER
	for i in count:
		o = out[i]._read(b, o, time_base)
	return {"seq": b.decode_u16(2), "count": count, "slot": -1}

## Server: wrap a validated client packet for relay, adding the sender's slot.
static func make_relay_packet(client: PackedByteArray, slot: int) -> PackedByteArray:
	var out := PackedByteArray()
	out.resize(client.size() + 1)
	out[0] = BIN_SERVER_RELAY
	out[1] = slot
	for i in range(1, client.size()):
		out[i + 1] = client[i]
	return out

## Host: encode bot states (relay layout with type BIN_BOT_STATE).
static func encode_bot_states(slot: int, seq: int, states: Array, count: int) -> PackedByteArray:
	var b := PackedByteArray()
	b.resize(RELAY_HEADER + count * STATE_BYTES)
	b[0] = BIN_BOT_STATE
	b[1] = slot
	b[2] = count
	b.encode_u16(3, seq & 0xffff)
	var o := RELAY_HEADER
	for i in count:
		o = states[i]._write(b, o)
	return b

static func _decode_slotted(b: PackedByteArray, kind: int, out: Array, time_base: float) -> Dictionary:
	if b.size() < RELAY_HEADER or b[0] != kind:
		return {}
	var slot := b[1]
	var count := b[2]
	if count < 1 or count > 4 or b.size() != RELAY_HEADER + count * STATE_BYTES:
		return {}
	var seq := b.decode_u16(3)
	var o := RELAY_HEADER
	for i in count:
		o = out[i]._read(b, o, time_base)
	return {"seq": seq, "count": count, "slot": slot}

## Server: decode a bot packet (validated).
static func decode_bot_states(b: PackedByteArray, out: Array, time_base: float) -> Dictionary:
	return _decode_slotted(b, BIN_BOT_STATE, out, time_base)

## Server: turn a validated bot packet into a relay packet.
static func bot_to_relay(b: PackedByteArray) -> PackedByteArray:
	var out := b.duplicate()
	out[0] = BIN_SERVER_RELAY
	return out

## Client: decode a relayed packet.
static func decode_relay(b: PackedByteArray, out: Array, time_base: float) -> Dictionary:
	return _decode_slotted(b, BIN_SERVER_RELAY, out, time_base)
