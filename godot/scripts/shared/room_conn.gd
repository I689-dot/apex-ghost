class_name RoomConn
extends RefCounted
## A connection as the room logic sees it (port of Conn in apps/server/src/room.ts). Subclass or set the callables:
## on_send(data: String | PackedByteArray), on_close(code: int, reason: String).

var id: String
var on_send: Callable
var on_close: Callable

func _init(conn_id: String, send_cb: Callable = Callable(), close_cb: Callable = Callable()) -> void:
	id = conn_id
	on_send = send_cb
	on_close = close_cb

func send(data) -> void:
	if on_send.is_valid():
		on_send.call(data)

func close(code: int, reason: String) -> void:
	if on_close.is_valid():
		on_close.call(code, reason)
