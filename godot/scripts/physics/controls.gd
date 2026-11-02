class_name Controls
extends RefCounted
## Driver inputs for one physics step (port of physics/input.ts Controls).

var throttle := 0.0
var brake := 0.0
## -1 (right) .. +1 (left)
var steer := 0.0
var handbrake := 0.0
## Keyboard targets (0/+-1): the vehicle filters them every physics step. Bots send analog values (digital = false).
var digital := false
## Steering and pedals come from a game controller this frame (proportional): the filters use the PAD profile.
var analog := false
