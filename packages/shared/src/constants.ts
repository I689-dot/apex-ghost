export const GAME_NAME = 'APEX GHOST';
export const PROTOCOL_VERSION = 6;

export const MAX_PLAYERS = 12;
/** Lap-count sessions (tests and tools only): timed laps after the out lap. */
export const RACE_LAPS = 3;
/** Qualifying session length the host can choose (minutes). */
export const SESSION_MINUTES = [5, 10, 15, 20, 30] as const;
export const DEFAULT_SESSION_MINUTES = 10;
/** Race after qualifying: laps the host can choose (0 = qualifying only). */
export const RACE_LAP_CHOICES = [0, 3, 5, 10, 15] as const;
export const DEFAULT_RACE_LAPS = 5;
/** Qualifying results on screen before the race loads. */
export const QUALI_TO_RACE_MS = 20_000;
/** After the chequered flag, drivers may finish the lap they are on: at most this long. */
export const FLAG_GRACE_MS = 240_000;

/** Room codes: 5 chars, no ambiguous glyphs (0/O, 1/I/L). */
export const ROOM_CODE_LENGTH = 5;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const NICK_MIN = 2;
export const NICK_MAX = 16;

/** Car state sampling rate (Hz) and how many samples are packed per network message. */
export const STATE_HZ = 20;
export const STATES_PER_PACKET = 2;
export const PACKET_HZ = STATE_HZ / STATES_PER_PACKET;

/** Remote-car interpolation delay. Must exceed one packet interval plus jitter. */
export const INTERP_DELAY_MS = 150;
export const MAX_EXTRAPOLATION_MS = 250;
export const SNAP_DISTANCE_M = 12;

export const RECONNECT_GRACE_MS = 30_000;
export const LOAD_TIMEOUT_MS = 45_000;
/** Briefing before the session: final conditions revealed, everyone sets up their car. */
export const BRIEFING_MS = 30_000;
/** Pre-race cinematic (aerial flyover, grid pass with driver names), then the 3-2-1 start lights. */
export const COUNTDOWN_MS = 16_000;
export const FINISH_TIMEOUT_MS = 60_000;
export const RESET_PENALTY_MS = 3_000;
export const RESET_FREEZE_MS = 1_500;

/** Anti-cheat sanity limits used by the server. */
export const MAX_PLAUSIBLE_SPEED_MS = 115; // ~414 km/h
export const MAX_CLOCK_SKEW_MS = 3_000;

export const PHYSICS_HZ = 120;
