class_name Const
extends RefCounted
## Shared game constants (port of packages/shared/src/constants.ts).

const GAME_NAME := "APEX GHOST"
const PROTOCOL_VERSION := 8

const MAX_PLAYERS := 12
## Lap-count sessions (tests and tools only): timed laps after the out lap.
const RACE_LAPS := 3
## Qualifying session length the host can choose (minutes).
const SESSION_MINUTES := [5, 10, 15, 20, 30]
const DEFAULT_SESSION_MINUTES := 10
## Race after qualifying: laps the host can choose (0 = qualifying only).
const RACE_LAP_CHOICES := [0, 3, 5, 10, 15]
const DEFAULT_RACE_LAPS := 5
## A timed race instead: minutes the host can choose (0 = the race goes by laps).
const RACE_MINUTE_CHOICES := [0, 10, 20, 30, 45, 60]
## Free practice before qualifying (minutes; 0 = none).
const PRACTICE_MINUTE_CHOICES := [0, 10, 20, 30]
## Qualifying results on screen before the race loads.
const QUALI_TO_RACE_MS := 20000
const MAX_SPECTATORS := 30
## After the chequered flag, drivers may finish the lap they are on: at most this long.
const FLAG_GRACE_MS := 240000

## Room codes: 5 chars, no ambiguous glyphs (0/O, 1/I/L).
const ROOM_CODE_LENGTH := 5
const ROOM_CODE_ALPHABET := "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

const NICK_MIN := 2
const NICK_MAX := 16

## Car state sampling rate (Hz) and how many samples are packed per network message.
const STATE_HZ := 20
const STATES_PER_PACKET := 2
const PACKET_HZ := STATE_HZ / STATES_PER_PACKET

## Remote-car interpolation delay. Must exceed one packet interval plus jitter.
const INTERP_DELAY_MS := 150
const MAX_EXTRAPOLATION_MS := 250
const SNAP_DISTANCE_M := 12

const RECONNECT_GRACE_MS := 30000
const LOAD_TIMEOUT_MS := 45000
## Briefing before the session: final conditions revealed, everyone sets up their car.
const BRIEFING_MS := 30000
## Pre-race cinematic, then the 3-2-1 start lights.
const COUNTDOWN_MS := 16000
const FINISH_TIMEOUT_MS := 60000
const RESET_PENALTY_MS := 3000
const RESET_FREEZE_MS := 1500

## Anti-cheat sanity limits used by the server.
const MAX_PLAUSIBLE_SPEED_MS := 115 # ~414 km/h
const MAX_CLOCK_SKEW_MS := 3000

const PHYSICS_HZ := 120
