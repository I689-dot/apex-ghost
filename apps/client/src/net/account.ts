import type { AccountUser, FriendEntry, Presence, RecordRow, UserStats } from '@apex/shared';
import { SERVER_URL } from '../config';

/**
 * The signed-in account (a nickname and a password, no e-mail: the server's accounts.ts) and its friends, presence
 * and records. The token is kept in this browser; signed in, your nickname is the account's, your rooms tell the
 * server who you are (hello.account) so your laps and results go to your records, and a heartbeat tells your
 * friends where you are (in the menu, a lobby, racing or watching).
 */

const KEY = 'apexghost.account';

export interface Account {
  token: string;
  user: AccountUser;
}

let current: Account | null = load();
const listeners = new Set<(a: Account | null) => void>();

function load(): Account | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Account) : null;
  } catch {
    return null;
  }
}

function save(a: Account | null): void {
  current = a;
  try {
    if (a) localStorage.setItem(KEY, JSON.stringify(a));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: signed in for this visit only */
  }
  for (const l of listeners) l(a);
  if (a) sendPresence();
}

export function account(): Account | null {
  return current;
}

export function onAccount(l: (a: Account | null) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export class AccountError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(current ? { Authorization: `Bearer ${current.token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new AccountError(0, 'Cannot reach the game server. Check your connection.');
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    // a token the server no longer knows (signed out elsewhere, account removed): signed out here too
    if (res.status === 401 && current && path !== 'account/login') save(null);
    throw new AccountError(res.status, data.error ?? `Server error (${res.status}).`);
  }
  return data;
}

export async function register(nick: string, password: string): Promise<void> {
  save(await api<Account>('account/register', { nick, password }));
}

export async function login(nick: string, password: string): Promise<void> {
  save(await api<Account>('account/login', { nick, password }));
}

export async function logout(): Promise<void> {
  try {
    if (current) await api('account/logout', {});
  } finally {
    save(null);
  }
}

export async function friends(): Promise<FriendEntry[]> {
  return (await api<{ friends: FriendEntry[] }>('friends')).friends;
}

export const addFriend = (nick: string) => api('friends/add', { nick });
export const acceptFriend = (id: string) => api('friends/accept', { id });
export const removeFriend = (id: string) => api('friends/remove', { id });

export async function records(q: { track: string; car?: string; scope: 'global' | 'friends'; wet?: boolean }): Promise<RecordRow[]> {
  const p = new URLSearchParams({ track: q.track, scope: q.scope, ...(q.car ? { car: q.car } : {}), ...(q.wet ? { wet: '1' } : {}) });
  return (await api<{ rows: RecordRow[] }>(`records?${p}`)).rows;
}

export async function stats(user?: string): Promise<UserStats> {
  return (await api<{ stats: UserStats }>(`stats${user ? `?user=${encodeURIComponent(user)}` : ''}`)).stats;
}

/* -------------------------------------------------------------- presence --- */

let presence: Omit<Presence, 'at'> = { state: 'menu', room: null, trackId: null, session: null };
let lastSent = '';
let timer: number | null = null;

/** Where I am now: sent at once when it changes, and every 45 s while signed in (friends see it for 90 s). */
export function setPresence(p: Omit<Presence, 'at'>): void {
  presence = p;
  if (JSON.stringify(p) !== lastSent) sendPresence();
}

function sendPresence(): void {
  if (!current) return;
  lastSent = JSON.stringify(presence);
  void api('presence', { presence }).catch(() => {});
  if (timer === null) timer = window.setInterval(() => current && void api('presence', { presence }).catch(() => {}), 45_000);
}
