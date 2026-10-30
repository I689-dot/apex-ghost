import type { CarEntry, FriendEntry, Presence, RecordRow, UserStats } from '@apex/shared';
import { h } from './dom';
import { t } from '../i18n';
import * as acc from '../net/account';

/**
 * The menu's account parts: sign in / create an account (nickname + password), the friends list with where each
 * friend is now (join their lobby, watch their race), and the records (best laps per layout, everyone or friends,
 * and your career).
 */

export interface TrackChoice {
  id: string;
  name: string;
}

/* --------------------------------------------------------------- sign in --- */

export function signInModal(onDone: () => void): HTMLElement {
  const nick = h('input', { type: 'text', maxlength: 16, placeholder: t('Nickname'), autocomplete: 'username', spellcheck: 'false' });
  const pw = h('input', { type: 'password', maxlength: 72, placeholder: t('Password'), autocomplete: 'current-password' });
  const err = h('div.form-error');
  const close = () => modal.remove();
  const go = async (create: boolean) => {
    err.textContent = '';
    card.classList.add('busy');
    try {
      if (create) await acc.register(nick.value, pw.value);
      else await acc.login(nick.value, pw.value);
      close();
      onDone();
    } catch (e) {
      err.textContent = t((e as Error).message);
    } finally {
      card.classList.remove('busy');
    }
  };
  pw.addEventListener('keydown', (e) => e.key === 'Enter' && void go(false));
  const card = h(
    'div.modal-card.sign-in',
    {},
    h('header', {}, h('h2', { text: t('Your account') }), h('button.icon', { text: '✕', title: t('Close'), onclick: close })),
    h('p.muted', { text: t('Just a nickname and a password. Your laps and results are kept, and friends can find you.') }),
    nick,
    pw,
    err,
    h(
      'div.sign-in-actions',
      {},
      h('button.primary', { text: t('Sign in'), onclick: () => void go(false) }),
      h('button', { text: t('Create account'), onclick: () => void go(true) }),
    ),
  );
  const modal: HTMLElement = h('div.modal', { onclick: (e: Event) => e.target === modal && close() }, card);
  queueMicrotask(() => nick.focus());
  return modal;
}

/* --------------------------------------------------------------- friends --- */

/** What a friend is doing, in words. */
function where(p: Presence | null, tracks: TrackChoice[]): string {
  if (!p) return t('Offline');
  const track = tracks.find((x) => x.id === p.trackId)?.name ?? '';
  const session = p.session === 'race' ? t('race') : p.session === 'qualifying' ? t('qualifying') : p.session === 'practice' ? t('practice') : '';
  if (p.state === 'menu') return t('Online · in the menu');
  if (p.state === 'lobby') return p.room ? t('In lobby {room}', { room: p.room }) : t('In a lobby');
  if (p.state === 'watching') return t('Watching {room}', { room: p.room ?? '' });
  return track ? t('Racing · {track} {session}', { track, session }).trim() : t('Racing');
}

function ago(ms: number | null): string {
  if (!ms) return '';
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 60) return t('{n} min ago', { n: Math.max(1, m) });
  const hrs = Math.round(m / 60);
  return hrs < 48 ? t('{n} h ago', { n: hrs }) : t('{n} days ago', { n: Math.round(hrs / 24) });
}

/**
 * The friends card: online friends first with where they are (Join a lobby, Watch a race), requests to answer,
 * requests sent, and a box to add someone by nickname. Refreshes every 15 s while shown.
 */
export function friendsPanel(tracks: () => TrackChoice[], join: (code: string) => void, watch: (code: string) => void): HTMLElement {
  const list = h('div.friends-list');
  const err = h('div.form-error');
  const input = h('input', { type: 'text', maxlength: 16, placeholder: t('Add a friend by nickname'), spellcheck: 'false' });
  const card = h(
    'div.menu-card.friends',
    {},
    h('h3', { text: t('Friends') }),
    list,
    h('div.join-row', {}, input, h('button', { text: t('Add'), onclick: () => void add() })),
    err,
  );
  const add = async () => {
    err.textContent = '';
    try {
      await acc.addFriend(input.value);
      input.value = '';
      await refresh();
    } catch (e) {
      err.textContent = t((e as Error).message);
    }
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && void add());
  const row = (f: FriendEntry) => {
    const p = f.presence;
    const actions: HTMLElement[] = [];
    const act = (label: string, fn: () => Promise<unknown> | void, cls: 'button.small' | 'button.ghost.small' = 'button.small') =>
      actions.push(
        h(cls, {
          text: label,
          onclick: async () => {
            err.textContent = '';
            try {
              await fn();
              await refresh();
            } catch (e) {
              err.textContent = t((e as Error).message);
            }
          },
        }),
      );
    if (f.status === 'incoming') {
      act(t('Accept'), () => acc.acceptFriend(f.id));
      act(t('Decline'), () => acc.removeFriend(f.id), 'button.ghost.small');
    } else if (f.status === 'outgoing') act(t('Cancel'), () => acc.removeFriend(f.id), 'button.ghost.small');
    else if (p?.room && p.state === 'lobby') act(t('Join'), () => join(p.room as string));
    else if (p?.room && (p.state === 'racing' || p.state === 'watching')) act(t('Watch'), () => watch(p.room as string), 'button.ghost.small');
    const status =
      f.status === 'incoming'
        ? t('Wants to be your friend')
        : f.status === 'outgoing'
          ? t('Request sent')
          : p
            ? where(p, tracks())
            : `${t('Offline')} · ${ago(f.lastSeen)}`;
    return h(
      `div.friend${p ? '.online' : ''}${p?.state === 'racing' ? '.racing' : ''}`,
      {},
      h('span.friend-dot'),
      h('div.friend-name', {}, h('b', { text: f.nick }), h('small', { text: status })),
      h(
        'div.friend-actions',
        {},
        ...actions,
        f.status === 'friend'
          ? h('button.icon.small', { text: '✕', title: t('Remove friend'), onclick: () => void acc.removeFriend(f.id).then(refresh) })
          : null,
      ),
    );
  };
  const refresh = async () => {
    if (!card.isConnected && list.childElementCount) return;
    try {
      const all = await acc.friends();
      // requests first, then online friends (racing first), then the rest by name
      const rank = (f: FriendEntry) => (f.status === 'incoming' ? 0 : f.presence ? (f.presence.state === 'racing' ? 1 : 2) : f.status === 'outgoing' ? 4 : 3);
      all.sort((a, b) => rank(a) - rank(b) || a.nick.localeCompare(b.nick));
      list.replaceChildren(...(all.length ? all.map(row) : [h('p.muted', { text: t('No friends yet: add them by their nickname.') })]));
    } catch (e) {
      list.replaceChildren(h('p.muted', { text: t((e as Error).message) }));
    }
  };
  void refresh();
  // every 15 s, and at once when the tab comes back (a background tab's timers are throttled)
  const onShow = () => document.visibilityState === 'visible' && card.isConnected && void refresh();
  document.addEventListener('visibilitychange', onShow);
  const timer = window.setInterval(() => {
    if (!card.isConnected) {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onShow);
    } else void refresh();
  }, 15_000);
  return card;
}

/* --------------------------------------------------------------- records --- */

export function fmtLap(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = (ms - m * 60000) / 1000;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

/**
 * Records: the best lap of every driver on a layout (everyone or friends; any car or one; dry or wet), and your
 * career (sessions, wins, podiums, poles, laps, your best lap everywhere).
 */
export function recordsModal(tracks: TrackChoice[], cars: CarEntry[], startTrack: string): HTMLElement {
  const close = () => modal.remove();
  const carName = (id: string) => cars.find((c) => c.id === id)?.name ?? id;
  const trackName = (id: string) => tracks.find((x) => x.id === id)?.name ?? id;
  const state = {
    track: tracks.some((x) => x.id === startTrack) ? startTrack : (tracks[0]?.id ?? ''),
    car: '',
    scope: 'global' as 'global' | 'friends',
    wet: false,
  };
  const sel = (opts: [string, string][], value: string, set: (v: string) => void) => {
    const s = h('select', { onchange: () => set(s.value) }, ...opts.map(([v, l]) => h('option', { value: v, text: l, selected: v === value })));
    return s;
  };
  const body = h('div.records-body');
  const filters = h(
    'div.records-filters',
    {},
    sel(
      tracks.map((x) => [x.id, x.name]),
      state.track,
      (v) => ((state.track = v), void load()),
    ),
    sel(
      [['', t('All cars')], ...cars.filter((c) => c.role !== 'safety').map((c) => [c.id, c.name] as [string, string])],
      '',
      (v) => ((state.car = v), void load()),
    ),
    sel(
      [
        ['global', t('Everyone')],
        ['friends', t('Friends')],
      ],
      'global',
      (v) => ((state.scope = v as 'global' | 'friends'), void load()),
    ),
    sel(
      [
        ['dry', t('Dry')],
        ['wet', t('Wet')],
      ],
      'dry',
      (v) => ((state.wet = v === 'wet'), void load()),
    ),
  );
  const table = (rows: RecordRow[]) => {
    if (!rows.length) return h('p.muted', { text: t('No laps here yet. Sign in and set the first one!') });
    const best = rows[0].lapMs;
    return h(
      'table.records-table',
      {},
      h('thead', {}, h('tr', {}, ...[t('Pos'), t('Driver'), t('Car'), t('Lap'), t('Gap'), t('Laps'), t('Date')].map((x) => h('th', { text: x })))),
      h(
        'tbody',
        {},
        ...rows.map((r) =>
          h(
            `tr${r.me ? '.me' : ''}`,
            {},
            h('td', { text: String(r.position) }),
            h('td', { text: r.nick }),
            h('td', { text: carName(r.carId) }),
            h('td.mono', { text: fmtLap(r.lapMs) }),
            h('td.mono', { text: r.position === 1 ? '' : `+${((r.lapMs - best) / 1000).toFixed(3)}` }),
            h('td', { text: String(r.laps) }),
            h('td.muted', { text: new Date(r.at).toLocaleDateString() }),
          ),
        ),
      ),
    );
  };
  const load = async () => {
    body.replaceChildren(h('p.muted', { text: t('Loading…') }));
    try {
      body.replaceChildren(table(await acc.records(state)));
    } catch (e) {
      body.replaceChildren(h('p.form-error', { text: t((e as Error).message) }));
    }
  };
  const career = h('div.records-career');
  const loadCareer = async () => {
    if (!acc.account()) {
      career.replaceChildren(h('p.muted', { text: t('Sign in to see your career.') }));
      return;
    }
    try {
      const s: UserStats = await acc.stats();
      const tile = (label: string, v: number) => h('div.stat-tile', {}, h('b', { text: String(v) }), h('span', { text: label }));
      career.replaceChildren(
        h('h3', { text: s.nick }),
        h(
          'div.stat-tiles',
          {},
          tile(t('Races'), s.races),
          tile(t('Wins'), s.wins),
          tile(t('Podiums'), s.podiums),
          tile(t('Qualifyings'), s.qualifyings),
          tile(t('Poles'), s.poles),
          tile(t('Timed laps'), s.laps),
        ),
        h('h4', { text: t('Your best laps') }),
        s.best.length
          ? h(
              'ul.best-laps',
              {},
              ...s.best.map((b) =>
                h('li', {}, h('span', { text: trackName(b.trackId) }), h('b.mono', { text: fmtLap(b.lapMs) }), h('small', { text: carName(b.carId) })),
              ),
            )
          : h('p.muted', { text: t('No timed laps yet.') }),
      );
    } catch (e) {
      career.replaceChildren(h('p.form-error', { text: t((e as Error).message) }));
    }
  };
  const card = h(
    'div.modal-card.records',
    {},
    h('header', {}, h('h2', { text: t('Records') }), h('button.icon', { text: '✕', title: t('Close'), onclick: close })),
    h('div.records-grid', {}, h('section', {}, h('h3', { text: t('Lap records') }), filters, body), h('section', {}, career)),
  );
  const modal: HTMLElement = h('div.modal', { onclick: (e: Event) => e.target === modal && close() }, card);
  void load();
  void loadCareer();
  return modal;
}
