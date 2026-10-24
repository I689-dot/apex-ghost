import { GameAudio } from './audio/audio';
import { heroUrl, uiAsset } from './ui/images';
import { COMPOUNDS, type CompoundId } from './physics/tyres';
import { SETUP, WING, recommendSetup } from './game/carSetup';
import { FUEL, TYRE_PRESSURE, idealColdPsi } from './physics/vehicle';
import {
  SESSION_MINUTES,
  RACE_LAP_CHOICES,
  pitWindowLaps,
  type RaceRules,
  TIME_LABEL,
  WEATHER_KINDS,
  planWeather,
  temperatures,
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
  type RoomSummary,
  type ServerMsg,
} from '@apex/shared';
import { Connection, RoomError, createRoom, listPublicRooms } from './net/connection';
import { createLocalRoom, isLocalCode } from './net/localRoom';
import { Graphics } from './game/graphics';
import { Showroom } from './game/preview';
import { RaceSession } from './game/session';
import { initLoaders, loadCarsFile, loadTrackIndex, type TrackIndexEntry } from './game/assets';
import { saveSettings, settings } from './settings';
import { clear, fmtTime, h, toast } from './ui/dom';
import { settingsPanel } from './ui/settingsPanel';
import { getLang, t } from './i18n';
import { IS_APP } from './mobile/platform';
import { mobileAppLink } from './mobile/installScreen';

type Screen = 'menu' | 'lobby' | 'briefing' | 'watch' | 'loading' | 'race' | 'results';

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
      toast(t('Graphics restored'));
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

  /**
   * Full-screen photo behind the menus (in-engine shots of the circuit, tools/e2e/photos.mjs); null in races.
   * Other maps than the Nürburgring have their own set (photo_<name>_<map>.webp), picked by the session's track.
   */
  private setBackdrop(name: 'grid' | 'straight' | 'aerial' | 'pole' | null, trackId?: string): void {
    this.showroom.stop();
    if (!this.backdropEl) {
      this.backdropEl = h('div.backdrop');
      document.getElementById('app')?.prepend(this.backdropEl);
    }
    this.backdropEl.classList.toggle('show', !!name);
    const map = this.trackIndex.find((tr) => tr.id === trackId)?.map;
    const img = `url(${uiAsset(`photo_${name}${map && map !== 'nurburgring' ? `_${map}` : ''}.webp`)})`;
    if (name && this.backdropEl.style.backgroundImage !== img) this.backdropEl.style.backgroundImage = img;
  }

  /* ----------------------------------------------------------------- menu --- */

  showMenu(error = ''): void {
    this.screen = 'menu';
    this.teardownConnection();
    this.setBackdrop('grid');
    const nick = h('input', {
      type: 'text',
      maxlength: 16,
      placeholder: t('Your nickname'),
      value: settings.nickname,
      autocomplete: 'off',
      spellcheck: 'false',
    });
    const code = h('input.code-input', { type: 'text', maxlength: 7, placeholder: t('ROOM CODE'), autocomplete: 'off', spellcheck: 'false' });
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
        err.textContent = t((e as Error).message);
      } finally {
        busy(false);
      }
    };
    const solo = async () => {
      const n = readNick();
      if (!n) return;
      busy(true);
      err.textContent = '';
      try {
        await this.join(await createLocalRoom(), n);
      } catch (e) {
        err.textContent = t((e as Error).message);
      } finally {
        busy(false);
      }
    };
    const joinIt = async () => {
      const n = readNick();
      if (!n) return;
      const c = normalizeRoomCode(code.value);
      if (!c) {
        err.textContent = t('Enter the 5-character room code.');
        code.focus();
        return;
      }
      busy(true);
      err.textContent = '';
      try {
        await this.join(c, n);
      } catch (e) {
        err.textContent = t((e as Error).message);
      } finally {
        busy(false);
      }
    };
    const watchIt = async (codeIn?: string) => {
      const n = readNick();
      if (!n) return;
      const c = normalizeRoomCode(codeIn ?? code.value);
      if (!c) {
        err.textContent = t('Enter the 5-character room code.');
        code.focus();
        return;
      }
      busy(true);
      err.textContent = '';
      try {
        await this.join(c, n, true);
      } catch (e) {
        err.textContent = t((e as Error).message);
      } finally {
        busy(false);
      }
    };
    const joinCode = async (c: string) => {
      code.value = c;
      await joinIt();
    };
    code.addEventListener('input', () => (code.value = code.value.toUpperCase()));
    code.addEventListener('keydown', (e) => e.key === 'Enter' && void joinIt());
    const form = h(
      'div.menu-card',
      {},
      h('label', { text: t('Nickname') }),
      nick,
      h('button.primary', { text: t('Create room'), onclick: () => void create() }),
      h('button.ghost.solo', {
        text: t('Play solo (offline)'),
        title: t('Alone or with AI cars, in this browser: nothing goes through the online server'),
        onclick: () => void solo(),
      }),
      h('div.or', { text: t('or join friends') }),
      h(
        'div.join-row',
        {},
        code,
        h('button', { text: t('Join'), onclick: () => void joinIt() }),
        h('button.ghost', { text: t('Watch'), title: t('Spectate this room'), onclick: () => void watchIt() }),
      ),
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
          h('p', { text: t('Online sim racing for friends · Nürburgring · Zandvoort') }),
        ),
        form,
        this.roomList(joinCode, watchIt),
        h(
          'div.menu-foot',
          {},
          h('button.ghost', { text: t('Settings'), onclick: () => this.openSettings() }),
          h('span.muted', { text: t('Keyboard: W/S throttle & brake · A/D steer · Space handbrake · Esc menu') }),
          IS_APP ? null : mobileAppLink(),
        ),
      ),
    );
    if (!nick.value) nick.focus();
  }

  /** Watching (spectator connection): no car, no lobby controls. */
  private spectating = false;

  private async join(code: string, nick: string, spectate = false): Promise<void> {
    this.spectating = spectate;
    const conn = new Connection(code, nick, spectate);
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
          room_not_found: t('Room not found. Check the code with your friend.'),
          room_full: t('Room is full ({n} players).', { n: MAX_PLAYERS }),
          nick_taken: t('That nickname is already used in this room. Pick another one.'),
        };
        throw new Error(msg[e.code] ?? t(e.message));
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
        if (this.spectating) toast(t('Watching this room: the next session will show here.'), 4000);
        if (m.room.players.find((p) => p.id === m.you)?.waiting) toast(t('A race is in progress. You will join the next one.'), 5000);
        break;
      case 'room':
        this.room = m.room;
        if (m.room.phase === 'briefing' && (this.screen === 'lobby' || this.screen === 'briefing')) this.renderBriefing();
        else if (this.screen === 'briefing') this.showLobby();
        else if (this.screen === 'lobby') this.renderLobby();
        else if (this.screen === 'watch') this.renderWatch();
        this.session?.updateRoom(m.room);
        break;
      case 'carLock':
        if (!m.ok && m.carId) {
          const owner = this.room?.players.find((p) => p.id === m.owner)?.nick;
          toast(owner ? t('{owner} already has that car.', { owner }) : t('That car is not available.'));
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
          this.showMenu(t(m.message));
        } else toast(t(m.message));
        break;
      default:
        break;
    }
  }

  /* ---------------------------------------------------------------- lobby --- */

  private showLobby(): void {
    if (this.spectating) {
      this.session?.dispose();
      this.session = null;
      this.renderWatch();
      return;
    }
    this.screen = 'lobby';
    this.session?.dispose();
    this.session = null;
    this.setBackdrop('straight', this.room?.conditions.trackId);
    this.lobbyEl = null;
    if (this.room?.phase === 'briefing') this.renderBriefing();
    else this.renderLobby();
  }

  private myInfo() {
    return this.room?.players.find((p) => p.id === this.me);
  }

  private trackIndex: TrackIndexEntry[] = [];
  private tyreSentFor = '';

  /** Session setup (host), forecast, and the player's car setup (tyres, wing, brake bias). */
  private prepPanel(room: RoomSnapshot, isHost: boolean, withCar = false): HTMLElement {
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
    const tracks = this.trackIndex.length ? this.trackIndex : [{ id: c.trackId, name: t('Nürburgring GP'), length: 5148 } as TrackIndexEntry];
    const row = (label: string, ctrl: HTMLElement) => h('div.prep-row', {}, h('span', { text: label }), ctrl);
    const plan = planWeather(c.seed, c);
    const w0 = weatherAt(plan, 0);
    const temp0 = temperatures(plan, w0, this.trackIndex.find((tr) => tr.id === c.trackId)?.map);
    const state = w0.wetness > 0.3 ? 'wet' : w0.wetness > 0.05 ? 'damp' : 'dry';
    const change = plan.change
      ? t('{weather} from about minute {min}', { weather: t(WEATHER_LABEL[plan.change.to]), min: Math.max(1, Math.round(plan.change.atSec / 60)) })
      : t('Stable conditions');
    const rec = recommendSetup(plan);
    const cs = settings.carSetup;
    const saveSetup = () => {
      saveSettings(settings);
      if (this.screen === 'briefing') this.renderBriefing();
      else this.renderLobby();
    };
    const tyreBtns = h(
      'div.prep-tyres',
      {},
      ...(['soft', 'medium', 'hard', 'wet'] as const).map((id) => {
        const comp = COMPOUNDS[id];
        return h(
          `button.prep-tyre${cs.tyre === id ? '.on' : ''}`,
          {
            title: t('{name}: grip {dry} % dry / {wet} % wet, wear ×{wear}', {
              name: t(comp.name),
              dry: Math.round(comp.grip * 100),
              wet: Math.round(comp.wetGrip * 100),
              wear: comp.wear,
            }),
            onclick: () => {
              cs.tyre = id;
              this.conn?.sendJson({ t: 'setTyre', tyre: id });
              saveSetup();
            },
          },
          h('img', { src: uiAsset(`tyre_${id}.webp`), alt: comp.letter, draggable: 'false' }),
          h('span', { text: t(comp.name) }),
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
      ...(['low', 'medium', 'high'] as const).map((k) => h('option', { value: k, text: t(WING[k].label), selected: cs.wing === k })),
    );
    const biasOut = h('output', { text: t('{pct} % front', { pct: Math.round(cs.brakeBias * 100) }) });
    const bias = h('input', {
      type: 'range',
      min: 0.54,
      max: 0.66,
      step: 0.01,
      value: cs.brakeBias,
      oninput: (e: Event) => {
        cs.brakeBias = Number((e.target as HTMLInputElement).value);
        biasOut.textContent = t('{pct} % front', { pct: Math.round(cs.brakeBias * 100) });
        saveSettings(settings);
      },
    });
    return h(
      'div.prep',
      {},
      h('h3', { text: edit ? t('Session · you are the host') : t('Session') }),
      row(
        t('Track'),
        sel(
          c.trackId,
          tracks.map((tr) => [tr.id, `${t(tr.name)} · ${(tr.length / 1000).toFixed(2)} km`] as [string, string]),
          (v) => send({ trackId: v }),
        ),
      ),
      row(
        t('Weather'),
        withCar
          ? h('b', { text: t(WEATHER_LABEL[plan.kind]) })
          : sel(c.weather, [['random', t('Random')], ...WEATHER_KINDS.map((k) => [k, t(WEATHER_LABEL[k])] as [string, string])] as [string, string][], (v) =>
              send({ weather: v }),
            ),
      ),
      row(
        t('Time of day'),
        withCar
          ? h('b', { text: formatHour(plan.startHour) })
          : sel(c.time, Object.entries(TIME_LABEL).map(([k, v]) => [k, t(v)]) as [string, string][], (v) => send({ time: v })),
      ),
      row(
        t('Weather changes'),
        withCar
          ? h('b', { text: change })
          : sel(
              c.changes,
              [
                ['random', t('Possible')],
                ['off', t('Stable')],
                ['on', t('Changing')],
              ],
              (v) => send({ changes: v }),
            ),
      ),
      row(
        t('Length'),
        sel(
          room.sessionMinutes,
          SESSION_MINUTES.map((m) => [m, t('{m} min qualifying', { m })] as [number, string]),
          (v) => this.conn?.sendJson({ t: 'setSession', minutes: Number(v) }),
        ),
      ),
      row(
        t('Room'),
        edit
          ? h(
              'label.switch-row',
              {},
              h('input', {
                type: 'checkbox',
                checked: room.isPublic,
                onchange: (e: Event) => this.conn?.sendJson({ t: 'setPublic', isPublic: (e.target as HTMLInputElement).checked }),
              }),
              h('span', { text: t('Public: listed, anyone can join or watch') }),
            )
          : h('b', { text: room.isPublic ? t('Public') : t('Private (code only)') }),
      ),
      row(
        t('Race'),
        sel(
          room.raceLaps,
          RACE_LAP_CHOICES.map((n) => [n, n === 0 ? t('Qualifying only') : t('Race: {n} laps', { n })] as [number, string]),
          (v) => this.conn?.sendJson({ t: 'setRaceLaps', laps: Number(v) }),
        ),
      ),
      row(t('Rules'), this.rulesPanel(room, edit)),
      h(
        'div.forecast',
        {},
        h('b', {
          text: t('Forecast: {weather} · {hour} · {state}', {
            weather: t(WEATHER_LABEL[plan.kind]),
            hour: formatHour(plan.startHour),
            state: t(`${state} track`),
          }),
        }),
        h('span', { text: change }),
        h('span', { text: t('Air {air} °C · track {track} °C at the start', { air: Math.round(temp0.airC), track: Math.round(temp0.trackC) }) }),
        edit ? h('button.ghost.small', { text: t('New forecast'), onclick: () => send({ reroll: true }) }) : null,
      ),
      withCar
        ? null
        : h('p.prep-note', {
            text: t('Tyres, rear wing and brakes are chosen in the briefing, once the host starts: everyone sees the final conditions first.'),
          }),
      withCar ? h('h3', { text: t('Your car') }) : null,
      withCar ? row(t('Tyres'), tyreBtns) : null,
      withCar ? tyreGuide() : null,
      withCar ? row(t('Rear wing'), wingSel) : null,
      withCar ? row(t('Brake balance'), h('div.range', {}, bias, biasOut)) : null,
      withCar && room.rules?.fuel ? this.fuelRow(room, tracks.find((tr) => tr.id === c.trackId)?.length ?? 5000) : null,
      withCar ? this.advancedSetup(temp0.airC) : null,
      !withCar
        ? null
        : h(
            'div.engineer',
            {},
            h('span', { text: t('Engineer: {note}.', { note: rec.note }) }),
            h('button.ghost.small', {
              text: t('Use {tyre} + {wing} wing', { tyre: t(COMPOUNDS[rec.tyre].name), wing: t(WING[rec.wing].label).split(' (')[0].toLowerCase() }),
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

  /** The host's rules (switches for the host in the lobby, a summary for everyone else). */
  private rulesPanel(room: RoomSnapshot, edit: boolean): HTMLElement {
    const rules = room.rules ?? { contact: false, pitWindow: false, fuel: false, raceControl: false };
    const items: [keyof RaceRules, string, string][] = [
      ['contact', t('Car contact'), t('Cars collide and take damage (off: ghost cars that pass through each other)')],
      ['pitWindow', t('Mandatory pit stop'), t('Race: one stop with a driver change inside the pit window, as in GT World Challenge Sprint')],
      ['fuel', t('Fuel and refuelling'), t('Engines burn fuel, you choose your fuel load, stops can refuel (endurance)')],
      ['raceControl', t('Race control'), t('Yellow flags, full-course yellow, the safety car, blue flags and drive-through penalties')],
    ];
    if (!edit) {
      const on = items.filter(([k]) => rules[k]).map(([, label]) => label);
      return h('b', { text: on.length ? on.join(' · ') : t('Ghost cars, no fuel, no race control') });
    }
    return h(
      'div.rules',
      {},
      ...items.map(([k, label, help]) =>
        h(
          'label.switch-row',
          { title: help },
          h('input', {
            type: 'checkbox',
            checked: rules[k],
            onchange: (e: Event) => this.conn?.sendJson({ t: 'setRules', rules: { [k]: (e.target as HTMLInputElement).checked } }),
          }),
          h('span', { text: label }),
          h('small.muted', { text: help }),
        ),
      ),
    );
  }

  /** Fuel load for the start (fuel rule): litres, the laps they last, and what the race needs. */
  private fuelRow(room: RoomSnapshot, trackM: number): HTMLElement {
    const cs = settings.carSetup;
    const perLap = (trackM / 1000) * FUEL.perKm;
    const laps = room.raceLaps;
    const need = laps > 0 ? Math.min(FUEL.tankL, Math.ceil((laps + 1) * perLap)) : null;
    const out = h('output');
    const show = () =>
      (out.textContent = t('{l} l · ~{laps} laps · {kg} kg', {
        l: cs.fuelL,
        laps: (cs.fuelL / perLap).toFixed(1),
        kg: Math.round(cs.fuelL * FUEL.kgPerL),
      }));
    show();
    const slider = h('input', {
      type: 'range',
      min: 10,
      max: FUEL.tankL,
      step: 1,
      value: cs.fuelL,
      oninput: (e: Event) => {
        cs.fuelL = Number((e.target as HTMLInputElement).value);
        show();
        saveSettings(settings);
      },
    });
    const w = laps > 1 && room.rules?.pitWindow ? pitWindowLaps(laps) : null;
    return h(
      'div.prep-fuel',
      {},
      h('div.prep-row', {}, h('span', { text: t('Fuel') }), h('div.range', {}, slider, out)),
      h('p.prep-note', {
        text:
          (need !== null
            ? t('The race needs ~{need} l ({per} l a lap). Less is lighter and faster, but you will have to refuel.', { need, per: perLap.toFixed(1) })
            : t('About {per} l a lap. Less fuel is lighter and faster.', { per: perLap.toFixed(1) })) +
          (w ? ` ${t('Mandatory stop on laps {a}–{b}.', { a: w.open, b: w.close })}` : ''),
      }),
      need !== null
        ? h('button.ghost.small', {
            text: t('Fuel for the whole race ({l} l)', { l: need }),
            onclick: () => {
              cs.fuelL = need;
              slider.value = String(need);
              show();
              saveSettings(settings);
            },
          })
        : null,
    );
  }

  private advOpen = false;

  /** The deeper setup: tyre pressures, ride height, anti-roll bars and dampers (front / rear). */
  private advancedSetup(airC: number): HTMLElement {
    const cs = settings.carSetup;
    const opt = COMPOUNDS[cs.tyre].optimumC;
    const setC = airC + 12;
    const ideal = idealColdPsi(opt, setC);
    const P = TYRE_PRESSURE;
    const hot = (cold: number) => (cold + P.atmPsi) * ((opt + 273.15) / (setC + 273.15)) - P.atmPsi;
    const slider = (value: number, min: number, max: number, step: number, fmt: (v: number) => string, on: (v: number) => void) => {
      const out = h('output', { text: fmt(value) });
      const inp = h('input', {
        type: 'range',
        min,
        max,
        step,
        value,
        oninput: (e: Event) => {
          const v = Number((e.target as HTMLInputElement).value);
          on(v);
          out.textContent = fmt(v);
          saveSettings(settings);
        },
      });
      return h('div.range', {}, inp, out);
    };
    const pair = (label: string, make: (axle: 0 | 1) => HTMLElement) =>
      h(
        'div.setup-pair',
        {},
        h('span', { text: label }),
        h('div', {}, h('small', { text: t('Front') }), make(0)),
        h('div', {}, h('small', { text: t('Rear') }), make(1)),
      );
    const clicks = (key: 'arb' | 'bump' | 'rebound', soft: string, stiff: string) => (axle: 0 | 1) =>
      slider(
        cs[key][axle],
        1,
        SETUP.clicks,
        1,
        (v) => `${v}${v === SETUP.baseline ? ` (${t('baseline')})` : v < SETUP.baseline ? ` · ${soft}` : ` · ${stiff}`}`,
        (v) => (cs[key][axle] = v),
      );
    const auto = cs.pressure === null;
    const rerender = () => this.renderBriefing();
    const body = h(
      'div.setup-adv',
      {},
      h(
        'label.switch-row',
        {},
        h('input', {
          type: 'checkbox',
          checked: auto,
          onchange: (e: Event) => {
            cs.pressure = (e.target as HTMLInputElement).checked ? null : [ideal, ideal];
            saveSettings(settings);
            rerender();
          },
        }),
        h('span', { text: t('Crew sets the tyre pressures ({p} psi cold → {hot} psi hot)', { p: ideal.toFixed(1), hot: P.targetPsi }) }),
      ),
      auto
        ? null
        : pair(t('Tyre pressure (cold)'), (axle) =>
            slider(
              (cs.pressure ?? [ideal, ideal])[axle],
              P.minColdPsi,
              P.maxColdPsi,
              0.1,
              (v) => t('{p} psi → ~{hot} hot', { p: v.toFixed(1), hot: hot(v).toFixed(1) }),
              (v) => {
                cs.pressure ??= [ideal, ideal];
                cs.pressure[axle] = v;
              },
            ),
          ),
      pair(t('Ride height'), (axle) =>
        slider(
          cs.ride[axle],
          -SETUP.rideMm,
          SETUP.rideMm,
          1,
          (v) => (v === 0 ? t('baseline') : `${v > 0 ? '+' : ''}${v} mm`),
          (v) => (cs.ride[axle] = v),
        ),
      ),
      pair(t('Anti-roll bar'), clicks('arb', t('soft'), t('stiff'))),
      pair(t('Dampers: bump'), clicks('bump', t('soft'), t('stiff'))),
      pair(t('Dampers: rebound'), clicks('rebound', t('soft'), t('stiff'))),
      h('p.prep-note', {
        text: t(
          'Hot target {p} psi: too low runs hot and soft, too high loses grip. Lower = more downforce but it bottoms over kerbs; rear higher than front moves grip to the front. A stiffer anti-roll bar takes grip from its axle (stiff front = understeer). Stiffer dampers react faster but skip over bumps.',
          { p: P.targetPsi },
        ),
      }),
      h('button.ghost.small', {
        text: t('Reset to baseline'),
        onclick: () => {
          Object.assign(cs, { pressure: null, ride: [0, 0], arb: [4, 4], bump: [4, 4], rebound: [4, 4] });
          saveSettings(settings);
          rerender();
        },
      }),
    );
    const d = h(
      'details.setup-details',
      { open: this.advOpen },
      h('summary', { text: t('Advanced setup: pressures, ride height, anti-roll bars, dampers') }),
      body,
    );
    d.addEventListener('toggle', () => (this.advOpen = (d as HTMLDetailsElement).open));
    return d;
  }

  private renderLobby(): void {
    const room = this.room;
    if (!room || !this.conn) return;
    if (this.screen === 'lobby') this.setBackdrop('straight', room.conditions.trackId); // follows the host's track choice
    const mine = this.myInfo();
    // the safety car is race control's, nobody's to drive
    const cars = (this.cars?.cars ?? []).filter((c) => c.role !== 'safety');
    const browsing = cars.find((c) => c.id === (this.browsing ?? mine?.carId)) ?? cars.find((c) => c.id === mine?.carId) ?? null;
    const isHost = !!mine?.host;
    // the room shows everyone's starting tyres: tell it ours (saved from last time)
    if (mine && (room.phase === 'lobby' || room.phase === 'briefing') && mine.tyre !== settings.carSetup.tyre && this.tyreSentFor !== room.code) {
      this.tyreSentFor = room.code;
      this.conn.sendJson({ t: 'setTyre', tyre: settings.carSetup.tyre });
    }
    const connected = room.players.filter((p) => p.connected);
    const allReady = connected.length > 0 && connected.every((p) => p.carId && p.ready);
    const nameOf = (id: string) => room.players.find((p) => p.id === id)?.nick ?? '?';

    const copy = () => {
      void navigator.clipboard?.writeText(room.code).then(
        () => toast(t('Room code copied')),
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
          p.host ? h('span.badge', { text: t('HOST') }) : null,
          p.bot ? h('span.badge.bot', { text: t('BOT') }) : null,
          h('img.tyre-badge', {
            src: uiAsset(`tyre_${p.tyre ?? 'medium'}.webp`),
            title: t('{name} tyres', { name: t(COMPOUNDS[p.tyre ?? 'medium'].name) }),
            alt: '',
          }),
          h('span.car', { text: p.carId ? (cars.find((c) => c.id === p.carId)?.name ?? p.carId) : p.waiting ? t('next race') : 'choosing…' }),
          h(`span.ready${p.ready ? '.on' : ''}`, { text: p.connected ? (p.ready ? t('READY') : '') : t('OFFLINE') }),
          p.bot && isHost && room.phase === 'lobby'
            ? h('button.remove-bot', { text: '✕', title: t('Remove this bot'), onclick: () => this.conn?.sendJson({ t: 'removeBot', id: p.id }) })
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
            title: takenBy ? t('Taken by {name}', { name: takenBy }) : c.name,
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
            h('dt', { text: t('Power') }),
            h('dd', { text: t('{n} hp', { n: hp(browsing.specs.powerKw) }) }),
            h('dt', { text: t('Weight (with driver)') }),
            h('dd', { text: `${browsing.specs.massKg} kg` }),
            h('dt', { text: t('Drivetrain') }),
            h('dd', { text: browsing.specs.drivetrain }),
            h('dt', { text: t('Top speed') }),
            h('dd', { text: `${browsing.specs.topSpeedKmh} km/h` }),
            h('dt', { text: t('Gears') }),
            h('dd', { text: String(browsing.specs.gears.length) }),
            ...(browsing.info
              ? [
                  h('dt', { text: t('Engine') }),
                  h('dd', { text: t(browsing.info.engine) }),
                  h('dt', { text: t('Gearbox') }),
                  h('dd', { text: t(browsing.info.gearbox) }),
                  h('dt', { text: t('Team') }),
                  h('dd', { text: t(browsing.info.team) }),
                ]
              : []),
          ),
        )
      : h('div.spec', {}, h('h2', { text: t('Pick a car') }));
    const readyBtn = h(`button${mine?.ready ? '.on' : ''}`, {
      text: mine?.ready ? t('Ready ✓') : t('Ready'),
      disabled: !mine?.carId || room.phase !== 'lobby' || mine.waiting,
      onclick: () => this.conn?.sendJson({ t: 'ready', ready: !mine?.ready }),
    });
    const startBtn = isHost
      ? h('button.primary', {
          text: t('Start race'),
          disabled: !allReady || room.phase !== 'lobby',
          title: allReady ? '' : t('Everyone needs a car and must be ready'),
          onclick: () => this.conn?.sendJson({ t: 'start' }),
        })
      : h('div.muted.wait', { text: allReady ? t('Waiting for the host to start') : t('Waiting for everyone to be ready') });
    const banner = room.phase !== 'lobby' ? h('div.banner', { text: t('A race is in progress. You will join the next one.') }) : null;

    const el = h(
      'div.lobby',
      {},
      h(
        'aside.lobby-side',
        {},
        isLocalCode(room.code)
          ? h('div.room-code', {}, h('label', { text: t('Solo · offline') }))
          : h(
              'div.room-code',
              {},
              h('label', { text: t('ROOM CODE') }),
              h('div.code', { text: room.code }),
              h('button.ghost', { text: t('Copy'), onclick: copy }),
            ),
        h('h3', { text: t('Drivers {n}/{max}', { n: room.players.length, max: MAX_PLAYERS }) }),
        players,
        isHost && room.phase === 'lobby'
          ? h('button.ghost.add-bot', {
              text: t('+ Add bot'),
              disabled: room.players.length >= MAX_PLAYERS,
              title: t('An AI driver simulated on your computer (they race as ghosts too)'),
              onclick: () => this.conn?.sendJson({ t: 'addBot' }),
            })
          : null,
        h('div.lobby-actions', {}, readyBtn, startBtn),
        h(
          'div.lobby-foot',
          {},
          h('button.ghost', { text: t('Settings'), onclick: () => this.openSettings() }),
          h('button.ghost', { text: t('Leave'), onclick: () => this.leave() }),
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

  private roomsTimer = 0;

  /** Public rooms, refreshed every 15 s while the menu is open (one small request each time). */
  private roomList(join: (code: string) => Promise<void>, watch: (code: string) => Promise<void>): HTMLElement {
    const list = h('div.room-list', {}, h('p.muted', { text: t('Looking for public sessions…') }));
    const phaseText = (r: RoomSummary) =>
      r.phase === 'lobby'
        ? t('In the lobby')
        : r.phase === 'briefing'
          ? t('Briefing')
          : r.kind === 'race'
            ? t('Race · {n} laps', { n: r.raceLaps })
            : t('Qualifying · {m} min', { m: r.sessionMinutes });
    const refresh = async () => {
      const rooms = await listPublicRooms();
      if (this.screen !== 'menu') return;
      list.replaceChildren(
        ...(rooms.length
          ? rooms.map((r) =>
              h(
                'div.room-row',
                {},
                h('b', { text: t(this.trackIndex.find((x) => x.id === r.trackId)?.name ?? r.trackId) }),
                h('span', { text: phaseText(r) }),
                h('span.muted', { text: `${t('Host')}: ${r.host} · ${t('Drivers {n}/{max}', { n: r.drivers, max: r.maxPlayers })}` }),
                r.phase === 'lobby' && r.drivers < r.maxPlayers ? h('button.small', { text: t('Join'), onclick: () => void join(r.code) }) : null,
                h('button.ghost.small', { text: t('Watch'), onclick: () => void watch(r.code) }),
              ),
            )
          : [h('p.muted', { text: t('No public sessions right now. Create a room and make it public, or play solo.') })]),
      );
    };
    clearInterval(this.roomsTimer);
    void refresh();
    this.roomsTimer = window.setInterval(() => (this.screen === 'menu' ? void refresh() : clearInterval(this.roomsTimer)), 15_000);
    return h('div.menu-card.rooms', {}, h('h3', { text: t('Live sessions') }), list);
  }

  /** Waiting screen while watching a room between sessions. */
  private renderWatch(): void {
    const room = this.room;
    if (!room) return;
    this.screen = 'watch';
    this.setBackdrop('aerial', room.conditions.trackId);
    const cars = this.cars?.cars ?? [];
    const track = this.trackIndex.find((x) => x.id === room.conditions.trackId);
    const phase: Record<string, string> = {
      lobby: t('In the lobby'),
      briefing: t('Briefing'),
      loading: t('Loading'),
      countdown: t('Starting'),
      racing: t('Session running'),
      results: t('Results'),
    };
    this.setUi(
      h(
        'div.lobby.watch',
        {},
        h(
          'aside.lobby-side',
          {},
          h('div.brief-head', {}, h('span.muted', { text: t('WATCHING') }), h('b', { text: room.code })),
          h('h2', { text: t(track?.name ?? 'Nürburgring GP') }),
          h('p.muted', { text: `${phase[room.phase] ?? room.phase} · ${t('Spectators: {n}', { n: room.spectators })}` }),
          h('p.muted', { text: t('The next qualifying or race starts here automatically. ←/→ change the car you follow.') }),
          h('h3', { text: t('Drivers') }),
          h(
            'ul.players',
            {},
            ...room.players.map((p) =>
              h(
                'li',
                {},
                h('span.nick', { text: p.nick }),
                p.bot ? h('span.badge.bot', { text: t('BOT') }) : null,
                h('span.car', { text: cars.find((c) => c.id === p.carId)?.name ?? '' }),
              ),
            ),
          ),
          h('button.ghost', { text: t('Leave'), onclick: () => this.showMenu() }),
        ),
      ),
    );
  }

  private briefTimer = 0;

  /**
   * Briefing (after the host starts): the final track, weather forecast, time and length for everyone, then each
   * driver sets up their car for them. The session loads when all are done or the timer runs out.
   */
  private renderBriefing(): void {
    const room = this.room;
    if (!room || !this.conn) return;
    this.screen = 'briefing';
    const mine = this.myInfo();
    const cars = this.cars?.cars ?? [];
    if (mine && mine.tyre !== settings.carSetup.tyre) this.conn.sendJson({ t: 'setTyre', tyre: settings.carSetup.tyre });
    const track = this.trackIndex.find((x) => x.id === room.conditions.trackId);
    this.setBackdrop('aerial', room.conditions.trackId);
    const clock = h('b.brief-clock');
    const tickClock = () => {
      const left = Math.max(0, (room.briefingUntil ?? 0) - (this.conn?.serverNow() ?? 0));
      clock.textContent = `${Math.ceil(left / 1000)} s`;
    };
    tickClock();
    clearInterval(this.briefTimer);
    this.briefTimer = window.setInterval(() => {
      if (this.screen !== 'briefing') clearInterval(this.briefTimer);
      else tickClock();
    }, 250);
    const drivers = h(
      'ul.players',
      {},
      ...room.players
        .filter((p) => p.carId && (p.connected || p.bot) && !p.waiting)
        .map((p) =>
          h(
            `li${p.id === this.me ? '.me' : ''}`,
            {},
            h('span.nick', { text: p.nick }),
            p.bot ? h('span.badge.bot', { text: t('BOT') }) : null,
            h('img.tyre-badge', { src: uiAsset(`tyre_${p.tyre ?? 'medium'}.webp`), alt: '' }),
            h('span.car', { text: cars.find((c) => c.id === p.carId)?.name ?? '' }),
            h(`span.ready${p.briefed ? '.on' : ''}`, { text: p.briefed ? t('READY') : '…' }),
          ),
        ),
    );
    const done = !!mine?.briefed;
    const el = h(
      'div.lobby.briefing',
      {},
      h(
        'aside.lobby-side',
        {},
        h('div.brief-head', {}, h('span.muted', { text: t('BRIEFING') }), clock),
        h('h2', { text: t(track?.name ?? 'Nürburgring GP') }),
        h('p.muted', { text: t('The conditions are final. Set up your car for them; the session loads when everyone is ready.') }),
        h('h3', { text: t('Drivers') }),
        drivers,
        h(
          `button.primary${done ? '.on' : ''}`,
          { disabled: done, onclick: () => this.conn?.sendJson({ t: 'briefed' }) },
          done ? t('Ready ✓') : t('Ready to go'),
        ),
      ),
      h('main.lobby-main', {}, h('div.lobby-top', {}, this.prepPanel(room, false, true))),
    );
    this.setUi(el);
    this.lobbyEl = null;
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
    this.setBackdrop('aerial', race.trackId);
    this.session?.dispose();
    const w0 = weatherAt(race.weather, 0);
    const temp0 = temperatures(race.weather, w0, this.trackIndex.find((tr) => tr.id === race.trackId)?.map);
    const slot = (race.slots[this.me] ?? 0) + 1;
    const bar = h('div.bar-fill');
    const label = h('div.load-label', { text: t('Preparing…') });
    const weatherTxt = race.weather.change
      ? t('{weather} → {later} later', { weather: t(WEATHER_LABEL[race.weather.kind]), later: t(WEATHER_LABEL[race.weather.change.to]) })
      : t(WEATHER_LABEL[race.weather.kind]);
    this.setUi(
      h(
        'div.loading',
        {},
        h(
          'div.load-card',
          {},
          h('div.logo.small', {}, h('span', { text: 'APEX' }), h('b', { text: 'GHOST' })),
          h('h2', {
            text: t('{track} · {min}-minute qualifying', {
              track: t(this.trackIndex.find((tr) => tr.id === race.trackId)?.name ?? 'Nürburgring GP'),
              min: Math.round(race.sessionMs / 60000),
            }),
          }),
          h(
            'div.race-facts',
            {},
            fact(t('Grid'), t('P{slot} of {n}', { slot, n: race.grid.length })),
            fact(t('Weather'), weatherTxt),
            fact(t('Time'), formatHour(w0.hour)),
            fact(t('Track'), w0.wetness > 0.3 ? t('Wet') : w0.wetness > 0.05 ? t('Damp') : t('Dry')),
            fact(t('Air / track'), `${Math.round(temp0.airC)} / ${Math.round(temp0.trackC)} °C`),
          ),
          h('div.bar', {}, bar),
          label,
        ),
      ),
    );
    const session = new RaceSession(
      this.gfx,
      this.conn,
      race,
      this.room,
      this.me,
      this.cars,
      {
        onCountdownText: (text, sub) => this.setCountdown(text, sub),
        onPauseToggle: (open) => this.setPause(open),
        onResults: (m) => this.showResults(m),
        onFatal: (msg) => this.showMenu(msg),
        audio: () => this.audio,
      },
      this.spectating,
    );
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
      this.fatal(t('Could not load the race: {msg}', { msg: (e as Error).message }));
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
    big.textContent = text === 'GO' ? t(text) : text;
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
        h('h2', { text: t('Paused') }),
        h('p.muted', { text: t('The race keeps running.') }),
        h('button.primary', { text: t('Resume'), onclick: close }),
        h('button', {
          text: t('Reset to track (+5 s penalty)'),
          onclick: () => {
            close();
            this.session?.requestReset();
          },
        }),
        h('button', { text: t('Settings'), onclick: () => this.openSettings() }),
        h('button.danger', { text: t('Leave race'), onclick: () => this.leave() }),
      ),
    );
    document.body.append(this.overlay);
  }

  private openSettings(): void {
    const lang = getLang();
    const panel = settingsPanel(
      () => panel.remove(),
      () => {
        if (getLang() !== lang) {
          // new language: redraw the screen behind and the panel itself (race texts follow on their own)
          panel.remove();
          if (this.screen === 'menu') this.showMenu();
          else if (this.screen === 'lobby') this.renderLobby();
          this.openSettings();
          return;
        }
        this.session?.applySettings();
        if (!this.session) this.gfx.applyQuality();
        this.audio?.setLevels(settings.audio);
      },
    );
    document.body.append(panel);
  }

  /* -------------------------------------------------------------- results --- */

  private resultsTimer = 0;

  private showResults(m: Extract<ServerMsg, { t: 'results' }>): void {
    this.setPause(false);
    this.session?.dispose();
    this.session = null;
    this.screen = 'results';
    this.setBackdrop('pole', this.pendingRace?.trackId);
    const cars = this.cars?.cars ?? [];
    const race = m.kind === 'race';
    const total = (r: (typeof m.rows)[number]) => (r.totalMs === null ? null : r.totalMs + r.penaltyMs);
    const classified = (r: (typeof m.rows)[number]) => (race ? !r.dnf && r.totalMs !== null : r.bestLapMs !== null);
    const sec = (ms: number) => `+${(ms / 1000).toFixed(3)}`;
    const rows = m.rows.map((r) =>
      h(
        `tr${r.id === this.me ? '.me' : ''}`,
        {},
        h('td.pos', { text: classified(r) ? String(r.position) : '—' }),
        h('td', { text: r.nick }),
        h('td.muted', { text: cars.find((c) => c.id === r.carId)?.name ?? '' }),
        race
          ? h('td.mono', { text: r.dnf || total(r) === null ? t('DNF') : fmtTime(total(r) as number) })
          : h(`td.mono${m.fastestLap?.id === r.id ? '.fastest' : ''}`, { text: r.bestLapMs === null ? t('no time') : fmtTime(r.bestLapMs) }),
        h('td.mono.muted', { text: !classified(r) || !r.gapMs ? '' : sec(r.gapMs) }),
        race ? h(`td.mono${m.fastestLap?.id === r.id ? '.fastest' : ''}`, { text: r.bestLapMs === null ? '' : fmtTime(r.bestLapMs) }) : null,
        h('td.muted', { text: `${r.validLaps}${r.dnf && !race ? ` · ${t('DNF')}` : ''}` }),
        h('td.mono.muted', { text: r.penaltyMs > 0 ? `+${(r.penaltyMs / 1000).toFixed(1)} s` : '' }),
      ),
    );
    const heads = race
      ? [t('Pos'), t('Driver'), t('Car'), t('Race time'), t('Gap'), t('Best lap'), t('Laps'), t('Penalties')]
      : [t('Pos'), t('Driver'), t('Car'), t('Best lap'), t('Gap'), t('Timed laps'), t('Penalties')];
    // after qualifying: the race loads by itself, gridded in this order
    const next = m.raceAt !== null ? h('p.race-next') : null;
    clearInterval(this.resultsTimer);
    if (next && m.raceAt !== null) {
      const at = m.raceAt;
      const tick = () => {
        const left = Math.max(0, Math.ceil((at - (this.conn?.serverNow() ?? 0)) / 1000));
        next.textContent = t('The race starts in {s} s · grid in qualifying order', { s: left });
      };
      tick();
      this.resultsTimer = window.setInterval(() => (this.screen === 'results' ? tick() : clearInterval(this.resultsTimer)), 250);
    }
    this.setUi(
      h(
        'div.results',
        {},
        h(
          'div.results-card',
          {},
          h('h2', { text: race ? t('Race results') : t('Qualifying results') }),
          h(
            'div.podium',
            {},
            ...m.rows
              .filter(classified)
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
                  h('em', { text: race ? (i === 0 ? fmtTime(total(r) as number) : sec(r.gapMs ?? 0)) : fmtTime(r.bestLapMs) }),
                );
              }),
          ),
          h('p.muted', {
            text: race
              ? t('Race time includes penalties: track limits after 3 warnings (0.5–3 s), reset (5 s), shortcut (5 s and more).')
              : t('Ranked by best lap. Penalties are added to the lap: track limits after 3 warnings (0.5–3 s), reset (5 s), shortcut (5 s and more).'),
          }),
          h('table', {}, h('thead', {}, h('tr', {}, ...heads.map((x) => h('th', { text: x })))), h('tbody', {}, ...rows)),
          m.fastestLap
            ? h('p.fastest-note', {
                text: t('Fastest lap: {nick} · {time}', { nick: m.rows.find((r) => r.id === m.fastestLap?.id)?.nick ?? '', time: fmtTime(m.fastestLap.ms) }),
              })
            : null,
          next ?? h('button.primary', { text: t('Back to lobby'), onclick: () => this.showLobby() }),
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
        h('h2', { text: t('Graphics reset') }),
        h('p', { text: t('The graphics driver reset the WebGL context. Trying to recover…') }),
        h('button', { text: t('Reload page'), onclick: () => location.reload() }),
      ),
    );
    document.body.append(el);
  }

  private fatal(msg: string): void {
    this.setUi(
      h(
        'div.fatal',
        {},
        h('h2', { text: t('Something went wrong') }),
        h('p', { text: msg }),
        h('button.primary', { text: t('Back to menu'), onclick: () => this.showMenu() }),
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

/** What each compound is for, from the same numbers the physics uses (lobby, before choosing). */
function tyreGuide(): HTMLElement {
  const NOTE: Record<CompoundId, string> = {
    soft: 'Fastest over one lap and warms up quickly, but wears about twice as fast as the Medium.',
    medium: 'The all-rounder: good grip that lasts a long run.',
    hard: 'Lasts the longest, but has the least grip and needs more time to warm up.',
    wet: 'For a wet track: the grooves clear the water. On a drying track it overheats and wears fast.',
  };
  const ids: CompoundId[] = ['soft', 'medium', 'hard', 'wet'];
  const maxLife = Math.max(...ids.map((i) => 1 / COMPOUNDS[i].wear));
  const maxWarm = Math.max(...ids.map((i) => 1 / COMPOUNDS[i].heatCap));
  const bar = (label: string, v: number) =>
    h('div.tg-bar', {}, h('span', { text: label }), h('i', {}, h('b', { style: `width:${Math.round(Math.max(0.06, Math.min(1, v)) * 100)}%` })));
  return h(
    'details.tyre-guide',
    { open: true },
    h('summary', { text: t('Which tyre?') }),
    h(
      'div.tg-grid',
      {},
      ...ids.map((id) => {
        const c = COMPOUNDS[id];
        return h(
          'div.tg-card',
          { style: `--tc:${c.colour}` },
          h('img', { src: uiAsset(`tyre_${id}.webp`), alt: '' }),
          h('b', { text: t(c.name) }),
          bar(t('Dry grip'), (c.grip - 0.8) / 0.25),
          bar(t('Wet grip'), c.wetGrip / 0.8),
          bar(t('Life'), 1 / c.wear / maxLife),
          bar(t('Warm-up'), 1 / c.heatCap / maxWarm),
          h('p', { text: t(NOTE[id]) }),
        );
      }),
    ),
    h('p.tg-foot', {
      text: t('Rain or a drying track can change the best choice during the session: you can change tyres in the pit box (pit lane next to the start).'),
    }),
  );
}
