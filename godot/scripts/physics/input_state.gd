class_name InputState
extends RefCounted
## Shared input state (port of the singletons in physics/input.ts). Values are targets like the keys' (0..1 pedals,
## -1..+1 steering, + = left) but may be fractional: they go through the same physics-step filters (KeyboardDriver),
## so tilt is as safe at speed as the keys.

## Touch / tilt controls of the mobile app (TouchControls).
static var touch := {"active": false, "throttle": 0.0, "brake": 0.0, "steer": 0.0, "handbrake": 0.0}
## Game controller (GamepadInput): analog triggers and stick, same meaning and filters as touch.
static var pad := {"active": false, "throttle": 0.0, "brake": 0.0, "steer": 0.0, "handbrake": 0.0, "wheel": false}
## The car being driven's steering lock (degrees lock to lock), for a wheel's soft lock.
static var wheel := {"carLockDeg": 600.0}
