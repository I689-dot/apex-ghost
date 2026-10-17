import { NICK_MAX, NICK_MIN, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from './constants';

// Control chars, zero-width chars, bidi overrides and BOM (kept as escapes: ASCII-only source).
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const INVISIBLE_RE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff]', 'g');

export type NickResult = { ok: true; nick: string } | { ok: false; error: string };

/** Trims, collapses whitespace, strips control/markup chars, enforces 2-16 chars. */
export function sanitizeNickname(raw: unknown): NickResult {
  if (typeof raw !== 'string') return { ok: false, error: 'Nickname is required.' };
  const nick = raw
    .normalize('NFKC')
    .replace(INVISIBLE_RE, '')
    .replace(/[<>&"'`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const len = [...nick].length;
  if (len < NICK_MIN) return { ok: false, error: `Nickname must be at least ${NICK_MIN} characters.` };
  if (len > NICK_MAX) return { ok: false, error: `Nickname must be at most ${NICK_MAX} characters.` };
  return { ok: true, nick };
}

export function nicknameKey(nick: string): string {
  return nick.toLocaleLowerCase('en');
}

export function generateRoomCode(random: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    s += ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length) % ROOM_CODE_ALPHABET.length];
  }
  return s;
}

/** Normalises user input ("ab c-d e" → "ABCDE") and checks it only uses the room-code alphabet. */
export function normalizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
