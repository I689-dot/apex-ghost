import { GameAudio } from './audio/audio';
import { heroUrl, uiAsset } from './ui/images';
import { COMPOUNDS } from './physics/tyres';
import { WING, recommendSetup } from './game/carSetup';
import {
  SESSION_MINUTES,
  TIME_LABEL,
  WEATHER_KINDS,
  planWeather,
  type ClientMsg,
  GAME_NAME,
  MAX_PLAYERS,
  WEATHER_LABEL,
  formatHour,
  normalizeRoomCode,
  sanitizeNickname,
  weatherAt,
  type CarEntry,
  type CarsFile,
  type RaceSetup,
  type RoomSnapshot,
  type ServerMsg,
} from '@apex/shared';
import { Connection, RoomError, createRoom } from './net/connection';
import { Graphics } from './game/graphics';
import { Showroom } from './game/preview';
import { RaceSession } from './game/session';
import { initLoaders, loadCarsFile, loadTrackIndex, type TrackIndexEntry } from './game/assets';
import { saveSettings, settings } from './settings';
import { clear, fmtTime, h, toast } from './ui/dom';
import { settingsPanel } from './ui/settingsPanel';

type Screen = 'menu' | 'lobby' | 'loading' | 'race' | 'results';

const hp = (kw: number) => Math.round(kw * 1.341);

export class App {
  private ui: HTMLElement;
  private gfx: Graphics;
  private showroom: Showroom;
  private cars: CarsFile | null = null;
  private conn: Connection | null = null;
  private room: RoomSnapshot | null = null;
  private me = '';
  private session: RaceSession | null = null;
  private pendingRace: RaceSetup | null = null;
  private pendingStartAt: number | null = null;
  private screen: Screen = 'menu';
  private browsing: string | null = null;
  private lobbyEl: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private countdownEl: HTMLElement | null = null;
  private offs: (() => void)[] = [];

  constructor(root: HTMLElement) {
    this.ui = h('div.ui');
    root.append(this.ui);
    this.gfx = new Graphics(root);
    initLoaders(this.gfx.renderer);
    this.showroom = new Showroom(this.gfx);
    this.gfx.onContextLost = () => this.showContextLost();
    this.gfx.onContextRestored = () => {
      document.querySelector('.context-lost')?.remove();
      toast('Graphics restored');
    };
    loadCarsFile()
      .then((c) => {
        this.cars = c;
        if (this.screen === 'lobby') this.renderLobby();
      })
      .catch((e: Error) => this.fatal(e.message));
    window.addEventListener('beforeunload', () => this.conn?.close());
    void loadTrackIndex().then((t) => {
      this.trackIndex = t;
      if (this.screen === 'lobby') this.renderLobby();
    });
    // browsers only allow audio after a user gesture: create it on the first click / key press
    const unlock = () => {
      if (!this.audio) {
        try {
          this.audio = new GameAudio(settings.audio);
        } catch (e) {
          console.warn('[audio] unavailable', e);
        }
      }
      this.audio?.resume();
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
  }

  private audio: GameAudio | null = null;
  private backdropEl: HTMLElement | null = null;

  /** Full-screen photo behind the menus (in-engine shots of the circuit, tools/e2e/photos.mjs); null in races. */
  private setBackdrop(name: 'grid' | 'straight' | 'aerial' | 'pole' | null): void {
    this.showroom.stop();
    if (!this.backdropEl) {
      this.backdropEl = h('div.backdrop');
      document.getElementById('app')?.prepend(this.backdropEl);
    }
    this.backdropEl.classList.toggle('show', !!name);
    if (name) this.backdropEl.style.backgroundImage = `url(${uiAsset(`photo_${name}.webp`)})`;
  }

  /* ----------------------------------------------------------------- menu --- */

  showMenu(error = ''): void {
    this.screen = 'menu';
    this.teardownConnection();
    this.setBackdrop('grid');
    const nick = h('input', { type: 'text', maxlength: 16, placeholder: 'Your nickname', value: settings.nickname, autocomplete: 'off', spellcheck: 'false' });
    const code = h('input.code-input', { type: 'text', maxlength: 7, placeholder: 'ROOM CODE', autocomplete: 'off', spellcheck: 'false' });
    const err = h('div.form-error', { text: error });
    const busy = (b: boolean) => form.classList.toggle('busy', b);
    const readNick = (): string | null => {
      const r = sanitizeNickname(nick.value);
      if (!r.ok) {
        err.textContent = r.error;
        nick.focus();
        return null;
      }
      settings.nickname = r.nick;
      saveSettings(settings);
      return r.nick;
    };
    const create = async () => {
      const n = readNick();
      if (!n) return;
      busy(true);
      err.textContent = '';
      try {
        const c = await createRoom();
        await this.join(c, n);
      } catch (e) {
        err.textContent = (e as Error).message;
      } finally {
        busy(false);
      }
    };
    const joinIt = async () => {
      const n = readNick();
      if (!n) return;
      const c = normalizeRoomCode(code.value);
      if (!c) {
        err.textContent = 'Enter the 5-character room code.';
        code.focus();
        return;
      }
      busy(true);
      err.textContent = '';
      try {
        await this.join(c, n);
      } catch (e) {
        err.textContent = (e as Error).message;
      } finally {
        busy(false);
      }
    };
    code.addEventListener('input', () => (code.value = code.value.toUpperCase()));
    code.addEventListener('keydown', (e) => e.key === 'Enter' && void joinIt());
    const form = h(
      'div.menu-card',
      {},
      h('label', { text: 'Nickname' }),
      nick,
      h('button.primary', { text: 'Create room', onclick: () => void create() }),
      h('div.or', { text: 'or join friends' }),
      h('div.join-row', {}, code, h('button', { text: 'Join', onclick: () => void joinIt() })),
      err,
    );
    this.setUi(
      h(
        'div.menu',
        {},
        h(
          'div.brand',
          {},
          h('div.logo', {}, h('span', { text: 'APEX' }), h('b', { text: 'GHOST' })),
          h('p', { text: 'Online sim racing for friends · Nürburgring GP' }),
        ),
        form,
        h(
          'div.menu-foot',
          {},
          h('button.ghost', { text: 'Settings', onclick: () => this.openSettings() }),
          h('span.muted', { text: 'Keyboard: W/S throttle & brake · A/D steer · Space handbrake · Esc menu' }),
        ),
      ),
    );
    if (!nick.value) nick.focus();
  }

  private async join(code: string, nick: string): Promise<void> {
    const conn = new Connection(code, nick);
    this.conn = conn;
    this.offs.push(conn.on((m) => this.onMessage(m)));
    this.offs.push(
      conn.onState((s) => {
        document.body.classList.toggle('reconnecting', s === 'reconnecting');
      }),
    );
    try {
      await conn.connect();
    } catch (e) {
      this.teardownConnection();
      if (e instanceof RoomError) {
        const msg: Record<string, string> = {
          room_not_found: 'Room not found. Check the code with your friend.',
          room_full: `Room is full (${MAX_PLAYERS} players).`,
          nick_taken: 'That nickname is already used in this room. Pick another one.',
        };
        throw new Error(msg[e.code] ?? e.message);
      }
      throw e;
    }
  }

  private teardownConnection(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.conn?.close();
    this.conn = null;
    this.room = null;
    this.session?.dispose();
    this.session = null;
  }

  /* ------------------------------------------------------------- messages --- */

  private onMessage(m: ServerMsg): void {
    switch (m.t) {
      case 'welcome':
        this.me = m.you;
        this.room = m.room;
        if (m.race && m.room.phase !== 'lobby') {
          // reconnect into a running race
          if (!this.session || this.session.race.raceId !== m.race.raceId) void this.startLoading(m.race, m.startAt);
        } else if (this.screen !== 'results') this.showLobby();
        if (m.room.players.find((p) => p.id === m.you)?.waiting) toast('A race is in progress. You will join the next one.', 5000);
        break;
      case 'room':
        this.room = m.room;
        if (this.screen === 'lobby') this.renderLobby();
        this.session?.updateRoom(m.room);
        break;
      case 'carLock':
        if (!m.ok && m.carId) {
          const owner = this.room?.players.find((p) => p.id === m.owner)?.nick;
          toast(owner ? `${owner} already has that car.` : 'That car is not available.');
        }
        break;
      case 'raceSetup':
        void this.startLoading(m.race, null);
        break;
      case 'countdown':
        if (this.session) this.session.setStartAt(m.startAt);
        else this.pendingStartAt = m.startAt;
        break;
      case 'error':
        if (m.fatal) {
          this.showMenu(m.message);
        } else toast(m.message);
        break;
      default:
        break;
    }
  }

  /* ---------------------------------------------------------------- lobby --- */

  private showLobby(): void {
    this.screen = 'lobby';
    this.session?.dispose();
    this.session = null;
    this.setBackdrop('straight');
    this.lobbyEl = null;
    this.renderLobby();
  }

  private myInfo() {
    return this.room?.players.find((p) => p.id === this.me);
  }

  private trackIndex: TrackIndexEntry[] = [];
  private tyreSentFor = '';

  /** Session setup (host), forecast, and the player's car setup (tyres, wing, brake bias). */
  private prepPanel(room: RoomSnapshot, isHost: boolean): HTMLElement {
    const c = room.conditions;
    const edit = isHost && room.phase === 'lobby';
    const send = (patch: Record<string, unknown>) => this.conn?.sendJson({ t: 'setConditions', ...patch } as ClientMsg);
    const sel = <T extends string | number>(value: T, options: [T, string][], on: (v: string) => void) =>
      edit
        ? h(
            'select',
            { onchange: (e: Event) => on((e.target as HTMLSelectElement).value) },
            ...options.map(([v, l]) => h('option', { value: v, text: l, selected: v === value })),
          )
        : h('b', { text: options.find(([v]) => v === value)?.[1] ?? String(value) });
    const tracks = this.trackIndex.length ? this.trackIndex : [{ id: c.trackId, name: 'Nürburgring GP', length: 5148 } as TrackIndexEntry];
    const row = (label: string, ctrl: HTMLElement) => h('div.prep-row', {}, h('span', { text: label }), ctrl);
    const plan = planWeather(c.seed, c);
    const w0 = weatherAt(plan, 0);
    const state = w0.wetness > 0.3 ? 'wet' : w0.wetness > 0.05 ? 'damp' : 'dry';
    const change = plan.change ? `${WEATHER_LABEL[plan.change.to]} from about minute ${Math.max(1, Math.round(plan.change.atSec / 60))}` : 'Stable conditions';
    const rec = recommendSetup(plan);
    const cs = settings.carSetup;
    const saveSetup = () => {
      saveSettings(settings);
      this.renderLobby();
    };
    const tyreBtns = h(
      'div.prep-tyres',
      {},
      ...(['soft', 'medium', 'hard', 'wet'] as const).map((id) => {
        const comp = COMPOUNDS[id];
        return h(
          `button.prep-tyre${cs.tyre === id ? '.on' : ''}`,
          {
            title: `${comp.name}: grip ${Math.round(comp.grip * 100)} % dry / ${Math.round(comp.wetGrip * 100)} % wet, wear ×${comp.wear}`,
            onclick: () => {
              cs.tyre = id;
              this.conn?.sendJson({ t: 'setTyre', tyre: id });
              saveSetup();
            },
          },
          h('img', { src: uiAsset(`tyre_${id}.webp`), alt: comp.letter, draggable: 'false' }),
          h('span', { text: comp.name }),
        );
      }),
    );
    const wingSel = h(
      'select',
      {
        onchange: (e: Event) => {
          cs.wing = (e.target as HTMLSelectElement).value as typeof cs.wing;
          saveSetup();
        },
      },
      ...(['low', 'medium', 'high'] as const).map((k) => h('option', { value: k, text: WING[k].label, selected: cs.wing === k })),
    );
    const biasOut = h('output', { text: `${Math.round(cs.brakeBias * 100)} % front` });
    const bias = h('input', {
      type: 'range',
      min: 0.54,
      max: 0.66,
      step: 0.01,
      value: cs.brakeBias,
      oninput: (e: Event) => {
        cs.brakeBias = Number((e.target as HTMLInputElement).value);
        biasOut.textContent = `${Math.round(cs.brakeBias * 100)} % front`;
        saveSettings(settings);
      },
    });
    return h(
      'div.prep',
      {},
      h('h3', { text: edit ? 'Session · you are the host' : 'Session' }),
      row(
        'Track',
        sel(
          c.trackId,
          tracks.map((t) => [t.id, `${t.name} · ${(t.length / 1000).toFixed(2)} km`] as [string, string]),
          (v) => send({ trackId: v }),
        ),
      ),
      row(
        'Weather',
        sel(c.weather, [['random', 'Random'], ...WEATHER_KINDS.map((k) => [k, WEATHER_LABEL[k]] as [string, string])] as [string, string][], (v) =>
          send({ weather: v }),
        ),
      ),
      row(
        'Time of day',
        sel(c.time, Object.entries(TIME_LABEL) as [string, string][], (v) => send({ time: v })),
      ),
      row(
        'Weather changes',
        sel(
          c.changes,
          [
            ['random', 'Possible'],
            ['off', 'Stable'],
            ['on', 'Changing'],
          ],
          (v) => send({ changes: v }),
        ),
      ),
      row(
        'Length',
        sel(
          room.sessionMinutes,
          SESSION_MINUTES.map((m) => [m, `${m} min qualifying`] as [number, string]),
          (v) => this.conn?.sendJson({ t: 'setSession', minutes: Number(v) }),
        ),
      ),
      h(
        'div.forecast',
        {},
        h('b', { text: `Forecast: ${WEATHER_LABEL[plan.kind]} · ${formatHour(plan.startHour)} · ${state} track` }),
        h('span', { text: change }),
        edit ? h('button.ghost.small', { text: 'New forecast', onclick: () => send({ reroll: true }) }) : null,
      ),
      h('h3', { text: 'Your car' }),
      row('Tyres', tyreBtns),
      row('Rear wing', wingSel),
      row('Brake balance', h('div.range', {}, bias, biasOut)),
      h(
        'div.engineer',
        {},
        h('span', { text: `Engineer: ${rec.note}.` }),
        h('button.ghost.small', {
          text: `Use ${COMPOUNDS[rec.tyre].name} + ${rec.wing} wing`,
          onclick: () => {
            cs.tyre = rec.tyre;
            cs.wing = rec.wing;
            this.conn?.sendJson({ t: 'setTyre', tyre: rec.tyre });
            saveSetup();
          },
        }),
      ),
    );
  }

  private renderLobby(): void {
    const room = this.room;
    if (!room || !this.conn) return;
    const mine = this.myInfo();
    const cars = this.cars?.cars ?? [];
    const browsing = cars.find((c) => c.id === (this.browsing ?? mine?.carId)) ?? cars.find((c) => c.id === mine?.carId) ?? null;
    const isHost = !!mine?.host;
    // the room shows everyone's starting tyres: tell it ours (saved from last time)
    if (mine && room.phase === 'lobby' && mine.tyre !== settings.carSetup.tyre && this.tyreSentFor !== room.code) {
      this.tyreSentFor = room.code;
      this.conn.sendJson({ t: 'setTyre', tyre: settings.carSetup.tyre });
    }
    const connected = room.players.filter((p) => p.connected);
    const allReady = connected.length > 0 && connected.every((p) => p.carId && p.ready);
    const nameOf = (id: string) => room.players.find((p) => p.id === id)?.nick ?? '?';

    const copy = () => {
      void navigator.clipboard?.writeText(room.code).then(
        () => toast('Room code copied'),
        () => toast(room.code),
      );
    };
    const players = h(
      'ul.players',
      {},
      ...room.players.map((p) =>
        h(
          `li${p.id === this.me ? '.me' : ''}${p.connected ? '' : '.offline'}`,
          {},
          h('span.nick', { text: p.nick }),
          p.host ? h('span.badge', { text: 'HOST' }) : null,
          p.bot ? h('span.badge.bot', { text: 'BOT' }) : null,
          h('img.tyre-badge', { src: uiAsset(`tyre_${p.tyre ?? 'medium'}.webp`), title: `${COMPOUNDS[p.tyre ?? 'medium'].name} tyres`, alt: '' }),
          h('span.car', { text: p.carId ? (cars.find((c) => c.id === p.carId)?.name ?? p.carId) : p.waiting ? 'next race' : 'choosing…' }),
          h(`span.ready${p.ready ? '.on' : ''}`, { text: p.connected ? (p.ready ? 'READY' : '') : 'OFFLINE' }),
          p.bot && isHost && room.phase === 'lobby'
            ? h('button.remove-bot', { text: '✕', title: 'Remove this bot', onclick: () => this.conn?.sendJson({ t: 'removeBot', id: p.id }) })
            : null,
        ),
      ),
    );
    const grid = h(
      'div.car-grid',
      {},
      ...cars.map((c) => {
        const owner = room.carLocks[c.id];
        const takenBy = owner && owner !== this.me ? nameOf(owner) : null;
        const sel = mine?.carId === c.id;
        return h(
          `button.car-card${sel ? '.selected' : ''}${takenBy ? '.taken' : ''}${browsing?.id === c.id ? '.browsing' : ''}`,
          {
            disabled: !!takenBy || room.phase !== 'lobby',
            title: takenBy ? `Taken by ${takenBy}` : c.name,
            onmouseenter: () => this.previewSoon(c),
            onmouseleave: () => this.previewSoon(browsing),
            onclick: () => {
              this.browsing = c.id;
              this.conn?.sendJson({ t: 'selectCar', carId: c.id });
            },
          },
          h('img', { src: c.thumbnail, alt: '', loading: 'lazy', draggable: 'false' }),
          h('span.cname', { text: c.name }),
          h('span.cat', { text: c.category }),
          takenBy ? h('span.owner', { text: takenBy }) : null,
        );
      }),
    );
    const spec = browsing
      ? h(
          'div.spec',
          {},
          h('img.hero-car', {
            src: heroUrl(browsing),
            alt: '',
            draggable: 'false',
            onerror: (e: Event) => ((e.target as HTMLImageElement).src = browsing.thumbnail),
          }),
          h('h2', { text: browsing.name }),
          h('div.spec-sub', { text: `${browsing.manufacturer}${browsing.year ? ` · ${browsing.year}` : ''} · ${browsing.category}` }),
          h(
            'dl',
            {},
            h('dt', { text: 'Power' }),
            h('dd', { text: `${hp(browsing.specs.powerKw)} hp` }),
            h('dt', { text: 'Weight' }),
            h('dd', { text: `${browsing.specs.massKg} kg` }),
            h('dt', { text: 'Drivetrain' }),
            h('dd', { text: browsing.specs.drivetrain }),
            h('dt', { text: 'Top speed' }),
            h('dd', { text: `${browsing.specs.topSpeedKmh} km/h` }),
            h('dt', { text: 'Gears' }),
            h('dd', { text: String(browsing.specs.gears.length) }),
          ),
        )
      : h('div.spec', {}, h('h2', { text: 'Pick a car' }));
    const readyBtn = h(`button${mine?.ready ? '.on' : ''}`, {
      text: mine?.ready ? 'Ready ✓' : 'Ready',
      disabled: !mine?.carId || room.phase !== 'lobby' || mine.waiting,
      onclick: () => this.conn?.sendJson({ t: 'ready', ready: !mine?.ready }),
    });
    const startBtn = isHost
      ? h('button.primary', {
          text: 'Start race',
          disabled: !allReady || room.phase !== 'lobby',
          title: allReady ? '' : 'Everyone needs a car and must be ready',
          onclick: () => this.conn?.sendJson({ t: 'start' }),
        })
      : h('div.muted.wait', { text: allReady ? 'Waiting for the host to start' : 'Waiting for everyone to be ready' });
    const banner = room.phase !== 'lobby' ? h('div.banner', { text: 'A race is in progress. You will join the next one.' }) : null;

    const el = h(
      'div.lobby',
      {},
      h(
        'aside.lobby-side',
        {},
        h('div.room-code', {}, h('label', { text: 'ROOM CODE' }), h('div.code', { text: room.code }), h('button.ghost', { text: 'Copy', onclick: copy })),
        h('h3', { text: `Drivers ${room.players.length}/${MAX_PLAYERS}` }),
        players,
        isHost && room.phase === 'lobby'
          ? h('button.ghost.add-bot', {
              text: '+ Add bot',
              disabled: room.players.length >= MAX_PLAYERS,
              title: 'An AI driver simulated on your computer (they race as ghosts too)',
              onclick: () => this.conn?.sendJson({ t: 'addBot' }),
            })
          : null,
        h('div.lobby-actions', {}, readyBtn, startBtn),
        h(
          'div.lobby-foot',
          {},
          h('button.ghost', { text: 'Settings', onclick: () => this.openSettings() }),
          h('button.ghost', { text: 'Leave', onclick: () => this.leave() }),
        ),
      ),
      h('main.lobby-main', {}, banner, h('div.lobby-top', {}, this.prepPanel(room, isHost), spec), grid),
    );
    // keep scroll position of the car grid across re-renders
    const oldGrid = this.lobbyEl?.querySelector('.car-grid');
    const scroll = oldGrid ? oldGrid.scrollTop : 0;
    this.setUi(el);
    this.lobbyEl = el;
    const ng = el.querySelector('.car-grid');
    if (ng) ng.scrollTop = scroll;
  }

  private hoverTimer = 0;
  /** Hover previews load full-detail models, so wait until the pointer rests on a card. */
  private previewSoon(entry: CarEntry | null): void {
    clearTimeout(this.hoverTimer);
    // studio renders swap instantly (no 3D model to load)
    this.hoverTimer = window.setTimeout(() => {
      const img = this.lobbyEl?.querySelector<HTMLImageElement>('img.hero-car');
      if (img && entry) img.src = heroUrl(entry);
    }, 60);
  }

  private leave(): void {
    this.conn?.leave();
    this.showMenu();
  }

  /* -------------------------------------------------------------- loading --- */

  private async startLoading(race: RaceSetup, startAt: number | null): Promise<void> {
    if (!this.conn || !this.room || !this.cars) return;
    if (this.screen === 'loading' && this.pendingRace?.raceId === race.raceId) return;
    this.screen = 'loading';
    this.pendingRace = race;
    this.pendingStartAt = startAt;
    this.setBackdrop('aerial');
    this.session?.dispose();
    const w0 = weatherAt(race.weather, 0);
    const slot = (race.slots[this.me] ?? 0) + 1;
    const bar = h('div.bar-fill');
    const label = h('div.load-label', { text: 'Preparing…' });
    const weatherTxt = `${WEATHER_LABEL[race.weather.kind]}${race.weather.change ? ` → ${WEATHER_LABEL[race.weather.change.to]} later` : ''}`;
    this.setUi(
      h(
        'div.loading',
        {},
        h(
          'div.load-card',
          {},
          h('div.logo.small', {}, h('span', { text: 'APEX' }), h('b', { text: 'GHOST' })),
          h('h2', {
            text: `${this.trackIndex.find((t) => t.id === race.trackId)?.name ?? 'Nürburgring GP'} · ${Math.round(race.sessionMs / 60000)}-minute qualifying`,
          }),
          h(
            'div.race-facts',
            {},
            fact('Grid', `P${slot} of ${race.grid.length}`),
            fact('Weather', weatherTxt),
            fact('Time', formatHour(w0.hour)),
            fact('Track', w0.wetness > 0.3 ? 'Wet' : w0.wetness > 0.05 ? 'Damp' : 'Dry'),
          ),
          h('div.bar', {}, bar),
          label,
        ),
      ),
    );
    const session = new RaceSession(this.gfx, this.conn, race, this.room, this.me, this.cars, {
      onCountdownText: (text, sub) => this.setCountdown(text, sub),
      onPauseToggle: (open) => this.setPause(open),
      onResults: (m) => this.showResults(m),
      onFatal: (msg) => this.showMenu(msg),
      audio: () => this.audio,
    });
    this.session = session;
    try {
      await session.load((l, t, lbl) => {
        bar.style.transform = `scaleX(${t ? l / t : 0})`;
        label.textContent = `${lbl} · ${Math.round((l / Math.max(1, t)) * 100)} %`;
      });
    } catch (e) {
      console.error(e);
      session.dispose();
      this.session = null;
      this.fatal(`Could not load the race: ${(e as Error).message}`);
      return;
    }
    if (this.session !== session) return; // superseded
    if (this.pendingStartAt !== null) session.setStartAt(this.pendingStartAt);
    this.screen = 'race';
    this.setBackdrop(null);
    this.countdownEl = h(
      'div.countdown',
      {},
      h('div.cd-big'),
      h('div.cd-sub'),
      h('div.cd-info', { text: `P${slot} · ${weatherTxt} · ${formatHour(w0.hour)}` }),
    );
    this.setUi(h('div.race-ui', {}, session.cinematicElement, session.hudElement, this.countdownEl));
    session.start();
  }

  private setCountdown(text: string, sub: string): void {
    if (!this.countdownEl) return;
    const [big, s, info] = Array.from(this.countdownEl.children) as HTMLElement[];
    big.textContent = text;
    big.className = `cd-big ${text === 'GO' ? 'go' : ''}`;
    s.textContent = sub;
    info.style.display = text && text !== 'GO' ? 'block' : sub ? 'block' : 'none';
    this.countdownEl.classList.toggle('show', !!text || !!sub);
  }

  /* ---------------------------------------------------------------- pause --- */

  private setPause(open: boolean): void {
    this.overlay?.remove();
    this.overlay = null;
    if (!open) return;
    const close = () => this.session?.togglePause(false);
    this.overlay = h(
      'div.modal.pause',
      {},
      h(
        'div.modal-card.pause-card',
        {},
        h('h2', { text: 'Paused' }),
        h('p.muted', { text: 'The race keeps running.' }),
        h('button.primary', { text: 'Resume', onclick: close }),
        h('button', {
          text: 'Reset to track (this lap will not count)',
          onclick: () => {
            close();
            this.session?.requestReset();
          },
        }),
        h('button', { text: 'Settings', onclick: () => this.openSettings() }),
        h('button.danger', { text: 'Leave race', onclick: () => this.leave() }),
      ),
    );
    document.body.append(this.overlay);
  }

  private openSettings(): void {
    const panel = settingsPanel(
      () => panel.remove(),
      () => {
        this.session?.applySettings();
        if (!this.session) this.gfx.applyQuality();
        this.audio?.setLevels(settings.audio);
      },
    );
    document.body.append(panel);
  }

  /* -------------------------------------------------------------- results --- */

  private showResults(m: Extract<ServerMsg, { t: 'results' }>): void {
    this.setPause(false);
    this.session?.dispose();
    this.session = null;
    this.screen = 'results';
    this.setBackdrop('pole');
    const cars = this.cars?.cars ?? [];
    const rows = m.rows.map((r) =>
      h(
        `tr${r.id === this.me ? '.me' : ''}`,
        {},
        h('td.pos', { text: r.bestLapMs === null ? '—' : String(r.position) }),
        h('td', { text: r.nick }),
        h('td.muted', { text: cars.find((c) => c.id === r.carId)?.name ?? '' }),
        h(`td.mono${m.fastestLap?.id === r.id ? '.fastest' : ''}`, { text: r.bestLapMs === null ? 'no time' : fmtTime(r.bestLapMs) }),
        h('td.mono.muted', { text: r.bestLapMs === null || !r.gapMs ? '' : `+${(r.gapMs / 1000).toFixed(3)}` }),
        h('td.muted', { text: `${r.validLaps}${r.dnf ? ' · DNF' : ''}` }),
      ),
    );
    this.setUi(
      h(
        'div.results',
        {},
        h(
          'div.results-card',
          {},
          h('h2', { text: 'Classification' }),
          h(
            'div.podium',
            {},
            ...m.rows
              .filter((r) => r.bestLapMs !== null)
              .slice(0, 3)
              .map((r, i) => {
                const car = cars.find((c) => c.id === r.carId);
                return h(
                  `div.podium-step.p${i + 1}`,
                  {},
                  car
                    ? h('img', { src: heroUrl(car), alt: '', draggable: 'false', onerror: (e: Event) => ((e.target as HTMLImageElement).src = car.thumbnail) })
                    : null,
                  h('b', { text: `P${i + 1}` }),
                  h('span', { text: r.nick }),
                  h('em', { text: fmtTime(r.bestLapMs) }),
                );
              }),
          ),
          h('p.muted', { text: 'Ranked by best valid lap. Laps beyond track limits or after a reset do not count.' }),
          h(
            'table',
            {},
            h('thead', {}, h('tr', {}, ...['Pos', 'Driver', 'Car', 'Best lap', 'Gap', 'Valid laps'].map((t) => h('th', { text: t })))),
            h('tbody', {}, ...rows),
          ),
          m.fastestLap
            ? h('p.fastest-note', { text: `Fastest lap: ${m.rows.find((r) => r.id === m.fastestLap?.id)?.nick ?? ''} · ${fmtTime(m.fastestLap.ms)}` })
            : null,
          h('button.primary', { text: 'Back to lobby', onclick: () => this.showLobby() }),
        ),
      ),
    );
  }

  /* ---------------------------------------------------------------- misc --- */

  private setUi(el: HTMLElement): void {
    clear(this.ui);
    this.ui.append(el);
  }

  private showContextLost(): void {
    if (document.querySelector('.context-lost')) return;
    const el = h(
      'div.modal.context-lost',
      {},
      h(
        'div.modal-card',
        {},
        h('h2', { text: 'Graphics reset' }),
        h('p', { text: 'The graphics driver reset the WebGL context. Trying to recover…' }),
        h('button', { text: 'Reload page', onclick: () => location.reload() }),
      ),
    );
    document.body.append(el);
  }

  private fatal(msg: string): void {
    this.setUi(
      h(
        'div.fatal',
        {},
        h('h2', { text: 'Something went wrong' }),
        h('p', { text: msg }),
        h('button.primary', { text: 'Back to menu', onclick: () => this.showMenu() }),
      ),
    );
  }

  get name(): string {
    return GAME_NAME;
  }
}

function fact(k: string, v: string): HTMLElement {
  return h('div.fact', {}, h('label', { text: k }), h('span', { text: v }));
}
