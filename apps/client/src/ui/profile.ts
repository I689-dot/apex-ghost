import { PROFILE_RE, sanitizeNickname, type CarEntry, type UserStats } from '@apex/shared';
import { LICENCE_COLOUR, LICENCE_NAME, levelOf, loadCareer } from '../career';
import { favouriteCar, loadHistory, loadRecentPlayers, type SessionRecord } from '../history';
import { getLang, t } from '../i18n';
import * as acc from '../net/account';
import { saveSettings, settings } from '../settings';
import { fmtTime, h, toast } from './dom';
import { ICONS } from './icons';
import { AVATAR_DESIGNS, avatarEl, helmetSvg, parseAvatar, photoToAvatar } from './avatar';
import { cssUrl, heroUrl } from './images';
import { COUNTRIES, flagImg, type TrackChoice } from './social';

/**
 * The driver's page, as iRacing's member profile, Gran Turismo's "My Page" and the F1 games' driver card lay it out:
 * who you are (number, code, flag, licence, level), your numbers (starts, wins, podiums, poles, win and podium rates,
 * distance, clean laps; and the online career when signed in), your favourite car, your last results, the people you
 * raced (add them as friends), and the profile's settings below.
 */
export function profilePage(o: { cars: CarEntry[]; tracks: TrackChoice[]; onChanged: () => void; signIn: () => void; openGarage: () => void }): HTMLElement {
  const signed = acc.account();
  const me = signed?.user;
  const career = loadCareer();
  const lv = levelOf(career.xp);
  const hist = loadHistory();
  const fav = favouriteCar(hist) ?? settings.garageCar;
  const favCar = o.cars.find((c) => c.id === fav) ?? null;
  const nick = me?.nick ?? settings.nickname ?? t('Driver');
  const num = me?.num ?? settings.profile.num;
  const country = me?.country ?? (settings.profile.country || null);
  const colour = me?.colour ?? settings.profile.colour;
  const avatar = me?.avatar ?? settings.profile.avatar;
  const photo = settings.profile.photo;
  const BANNERS: Record<string, string> = { spa: 'photo_hero_spa.webp', zandvoort: 'photo_hero_zandvoort.webp', nurburgring: 'photo_hero.webp' };
  const banner = BANNERS[settings.profile.banner] ?? null;
  const abbr =
    me?.abbr ??
    (settings.profile.abbr ||
      nick
        .replace(/[^a-z]/gi, '')
        .slice(0, 3)
        .toUpperCase());
  const carName = (id: string | null) => o.cars.find((c) => c.id === id)?.name ?? '—';
  const trackName = (id: string) => t(o.tracks.find((x) => x.id === id)?.name ?? id);
  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');

  // --- the driver card
  const card = h(
    'section.pf-card',
    { style: `--helmet:${colour}${banner ? `;--banner:${cssUrl(banner)}` : ''}` },
    h('div.pf-avatar', {}, avatarEl({ avatar, colour, photo, num }, 112), num ? h('span.pf-numtag', { text: `#${num}` }) : null),
    h(
      'div.pf-who',
      {},
      h('span.pf-kicker', { text: signed ? t('Online driver') : t('Offline driver') }),
      h('h2', {}, flagImg(country, 28) ?? '', h('span', { text: nick })),
      h(
        'div.pf-badges',
        {},
        h('span.pf-abbr', { text: abbr }),
        h('span.pf-lic', {
          text: `${career.licence} ${career.sr.toFixed(2)}`,
          style: `background:${LICENCE_COLOUR[career.licence]}`,
          title: t(LICENCE_NAME[career.licence]),
        }),
        h('span.pf-level', { text: t('Level {n}', { n: lv.level }) }),
      ),
      h(
        'div.pf-xp',
        { title: `${lv.into} / ${lv.need} XP` },
        h('i', { style: `width:${((lv.into / lv.need) * 100).toFixed(1)}%` }),
        h('small', { text: t('{a} / {b} XP to level {n}', { a: lv.into.toLocaleString(), b: lv.need.toLocaleString(), n: lv.level + 1 }) }),
      ),
    ),
    favCar
      ? h(
          'button.pf-fav',
          { type: 'button', title: t('Open the garage'), onclick: o.openGarage },
          h('img', { src: heroUrl(favCar), alt: '', draggable: 'false', onerror: (e: Event) => ((e.target as HTMLImageElement).src = favCar.thumbnail) }),
          h('span', {}, h('small', { text: t('Favourite car') }), h('b', { text: favCar.name })),
        )
      : h(
          'button.pf-fav.empty',
          { type: 'button', onclick: o.openGarage },
          h('span', {}, h('small', { text: t('No car yet') }), h('b', { text: t('Choose one in the garage') })),
        ),
  );

  // --- the numbers
  // a number, its label, and (out of the starts) a thin bar, as Le Mans Ultimate's career stats
  const tile = (label: string, value: string, sub = '', frac: number | null = null) =>
    h(
      'div.pf-tile',
      {},
      h('b', { text: value }),
      h('span', { text: label }),
      sub ? h('small', { text: sub }) : null,
      frac !== null ? h('i.pf-tile-bar', {}, h('i', { style: `width:${Math.max(0, Math.min(1, frac)) * 100}%` })) : null,
    );
  const raced = hist.filter((r) => r.kind === 'race');
  const avgFinish = raced.filter((r) => r.position > 0);
  const stats = h(
    'section.pf-stats',
    {},
    h('h3', { text: t('Career (this device)') }),
    h(
      'div.pf-tiles',
      {},
      tile(t('Starts'), String(career.races)),
      tile(t('Wins'), String(career.wins), `${career.wins}/${career.races}`, career.races ? career.wins / career.races : 0),
      tile(t('Podiums'), String(career.podiums), `${career.podiums}/${career.races}`, career.races ? career.podiums / career.races : 0),
      tile(t('Poles'), String(career.poles)),
      tile(t('Sessions'), String(career.sessions)),
      tile(t('Distance'), `${Math.round(career.km).toLocaleString()} km`),
      tile(t('Clean laps'), career.cleanLaps.toLocaleString()),
      tile(
        t('Average finish'),
        avgFinish.length ? `P${(avgFinish.reduce((s, r) => s + r.position, 0) / avgFinish.length).toFixed(1)}` : '—',
        avgFinish.length ? t('last {n} races', { n: avgFinish.length }) : '',
      ),
    ),
  );
  // --- achievements (the games' trophies), from the career and the sessions kept on this device
  const tracksRaced = new Set(hist.map((r) => r.trackId)).size;
  const LIC = ['R', 'D', 'C', 'B', 'A', 'P'];
  const lic = LIC.indexOf(career.licence);
  const ach: [string, string, number, number][] = [
    [t('First start'), t('Start a race'), career.races, 1],
    [t('On the podium'), t('Finish in the top three'), career.podiums, 1],
    [t('Winner'), t('Win a race'), career.wins, 1],
    [t('Pole sitter'), t('Take a pole position'), career.poles, 1],
    [t('Hat-trick'), t('Win three races'), career.wins, 3],
    [t('Champion material'), t('Win ten races'), career.wins, 10],
    [t('Clean driver'), t('Drive 50 clean laps'), career.cleanLaps, 50],
    [t('Century'), t('Drive 100 km'), Math.floor(career.km), 100],
    [t('Endurance'), t('Drive 1,000 km'), Math.floor(career.km), 1000],
    [t('Globetrotter'), t('Race on three circuits'), tracksRaced, 3],
    [t('Licence B'), t('Reach licence class B'), Math.max(0, lic), 3],
    [t('Pro licence'), t('Reach the Pro licence'), Math.max(0, lic), 5],
    [t('Level 10'), t('Reach driver level 10'), lv.level, 10],
    [t('Online racer'), t('Race online'), hist.filter((r) => r.online).length, 1],
  ];
  const got = ach.filter(([, , v, need]) => v >= need).length;
  const achievements = h(
    'section.pf-ach',
    {},
    h('header.pf-ach-head', {}, h('h3', { text: t('Achievements') }), h('span', { text: `${got} / ${ach.length}` })),
    h(
      'div.pf-ach-grid',
      {},
      ...ach.map(([name, how, v, need]) =>
        h(
          `div.pf-badge${v >= need ? '.got' : ''}`,
          { title: how },
          h('span.pf-badge-icon', { html: v >= need ? ICONS.trophy : ICONS.lock }),
          h('b', { text: name }),
          h('small', { text: v >= need ? how : `${Math.min(v, need).toLocaleString()} / ${need.toLocaleString()}` }),
          v < need && need > 1 ? h('i.pf-badge-bar', {}, h('i', { style: `width:${Math.min(100, (v / need) * 100).toFixed(0)}%` })) : null,
        ),
      ),
    ),
  );

  const online = h('section.pf-stats.pf-online');
  if (signed) {
    online.append(h('h3', { text: t('Online career') }), h('p.muted', { text: t('Loading…') }));
    void acc
      .stats()
      .then((s: UserStats) => {
        const since = new Date(s.since).toLocaleDateString(getLang(), { year: 'numeric', month: 'short' });
        online.replaceChildren(
          h('h3', { text: t('Online career') }),
          h(
            'div.pf-tiles',
            {},
            tile(t('Starts'), String(s.races)),
            tile(t('Wins'), String(s.wins), pct(s.wins, s.races)),
            tile(t('Podiums'), String(s.podiums), pct(s.podiums, s.races)),
            tile(t('Poles'), String(s.poles), pct(s.poles, s.qualifyings)),
            tile(t('Laps'), s.laps.toLocaleString()),
            tile(t('Member since'), since),
          ),
          s.best.length
            ? h(
                'div.pf-best',
                {},
                h('h4', { text: t('Personal bests') }),
                ...s.best.map((b) =>
                  h(
                    'div.pf-best-row',
                    {},
                    h('span', { text: trackName(b.trackId) }),
                    h('small', { text: carName(b.carId) }),
                    h('b', { text: fmtTime(b.lapMs) }),
                  ),
                ),
              )
            : '',
        );
      })
      .catch(() => online.replaceChildren(h('h3', { text: t('Online career') }), h('p.muted', { text: t('Could not load your online stats.') })));
  } else
    online.append(
      h('h3', { text: t('Online career') }),
      h('p.muted', { text: t('Sign in to race online, keep records on the leaderboards and add friends.') }),
      h('button.primary', { type: 'button', text: t('Sign in / create account'), onclick: o.signIn }),
    );

  // --- recent results
  const kindLabel = (r: SessionRecord) => (r.kind === 'race' ? t('Race') : r.kind === 'qualifying' ? t('Qualifying') : t('Practice'));
  const results = h(
    'section.pf-results',
    {},
    h('h3', { text: t('Recent results') }),
    hist.length
      ? h(
          'div.pf-table',
          { role: 'table' },
          ...hist
            .slice(0, 12)
            .map((r) =>
              h(
                `div.pf-res${r.kind === 'race' && r.position === 1 ? '.win' : r.kind === 'race' && r.position > 0 && r.position <= 3 ? '.podium' : ''}`,
                { role: 'row' },
                h('b.pf-pos', { text: r.position > 0 ? `P${r.position}` : r.kind === 'race' ? 'DNF' : '—' }),
                h(
                  'span.pf-res-main',
                  {},
                  h('b', { text: trackName(r.trackId) }),
                  h('small', { text: `${kindLabel(r)} · ${carName(r.carId)}${r.online ? ` · ${t('Online')}` : ''}` }),
                ),
                h('span.pf-res-lap', { text: r.bestLapMs ? fmtTime(r.bestLapMs) : '' }),
                h('small.pf-res-date', { text: new Date(r.at).toLocaleDateString(getLang(), { day: 'numeric', month: 'short' }) }),
              ),
            ),
        )
      : h('p.muted', { text: t('Your sessions will show here.') }),
  );

  const players = recentPlayersPanel(o.tracks);

  // --- profile settings
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([getLang()], { type: 'region' });
  } catch {
    names = null;
  }
  const fNick = h('input.pf-input', { type: 'text', maxlength: 16, value: nick, disabled: !!signed, spellcheck: 'false', autocomplete: 'nickname' });
  const fNum = h('input.pf-input', { type: 'number', min: 1, max: 999, placeholder: '1 - 999', value: num ?? '' });
  const fAbbr = h('input.pf-input', { type: 'text', maxlength: 3, value: me?.abbr ?? settings.profile.abbr, placeholder: abbr, spellcheck: 'false' });
  fAbbr.addEventListener('input', () => (fAbbr.value = fAbbr.value.replace(/[^a-z]/gi, '').toUpperCase()));
  const fCountry = h(
    'select.pf-input',
    {},
    h('option', { value: '', text: t('Not set') }),
    ...COUNTRIES.map((c) => h('option', { value: c, text: `${names?.of(c) ?? c} (${c})`, selected: country === c })),
  );
  const fColour = h('input.pf-colour', { type: 'color', value: colour });
  // the avatar: a helmet design in the two colours, or a photo (this browser only)
  const cur = parseAvatar(avatar);
  let design = cur.design;
  let newPhoto: string | null = photo;
  const fColour2 = h('input.pf-colour', { type: 'color', value: cur.colour2 });
  const preview = h('div.pf-av-preview');
  const grid = h('div.pf-av-grid', { role: 'radiogroup', 'aria-label': t('Helmet design') });
  const drawPicker = () => {
    preview.replaceChildren(
      avatarEl({ avatar: `h${design}:${fColour2.value}`, colour: fColour.value, photo: newPhoto, num: fNum.value ? Number(fNum.value) : null }, 96),
    );
    grid.replaceChildren(
      ...Array.from({ length: AVATAR_DESIGNS }, (_, i) =>
        h(`button.pf-av${i === design && !newPhoto ? '.on' : ''}`, {
          type: 'button',
          role: 'radio',
          'aria-checked': String(i === design && !newPhoto),
          title: t('Design {n}', { n: i + 1 }),
          html: helmetSvg(i, fColour.value, fColour2.value),
          onclick: () => {
            design = i;
            newPhoto = null;
            drawPicker();
          },
        }),
      ),
    );
    photoBtn.textContent = newPhoto ? t('Change photo') : t('Use a photo');
    removePhoto.hidden = !newPhoto;
  };
  const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const photoBtn = h('button.ghost.small', { type: 'button', onclick: () => fileIn.click() });
  const removePhoto = h('button.ghost.small', {
    type: 'button',
    text: t('Remove photo'),
    onclick: () => {
      newPhoto = null;
      drawPicker();
    },
  });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files?.[0];
    if (!f) return;
    try {
      newPhoto = await photoToAvatar(f);
      drawPicker();
    } catch (x) {
      toast(t((x as Error).message));
    }
    fileIn.value = '';
  });
  fColour.addEventListener('input', drawPicker);
  fColour2.addEventListener('input', drawPicker);
  const fBanner = h(
    'select.pf-input',
    {},
    ...(
      [
        ['spa', 'Circuit de Spa-Francorchamps'],
        ['zandvoort', 'Circuit Zandvoort'],
        ['nurburgring', 'Nürburgring'],
        ['none', t('None')],
      ] as const
    ).map(([v, l]) => h('option', { value: v, text: l, selected: settings.profile.banner === v })),
  );
  const fUnits = h(
    'select.pf-input',
    {},
    h('option', { value: 'kmh', text: 'km/h', selected: settings.units === 'kmh' }),
    h('option', { value: 'mph', text: 'mph', selected: settings.units === 'mph' }),
  );
  const fCar = h(
    'select.pf-input',
    {},
    h('option', { value: '', text: t('Not chosen') }),
    ...o.cars.filter((c) => c.role !== 'safety').map((c) => h('option', { value: c.id, text: c.name, selected: settings.garageCar === c.id })),
  );
  const err = h('div.form-error');
  const save = h('button.primary', { type: 'submit', text: t('Save profile') });
  const fieldRow = (label: string, ctrl: HTMLElement, help = '') =>
    h('label.pf-field', {}, h('span', { text: label }), ctrl, help ? h('small.muted', { text: help }) : null);
  const form = h(
    'form.pf-settings',
    {
      onsubmit: async (e: Event) => {
        e.preventDefault();
        err.textContent = '';
        const n = fNum.value ? Number(fNum.value) : null;
        if (n !== null && !(Number.isInteger(n) && n >= 1 && n <= 999)) return void (err.textContent = t('The number goes from 1 to 999.'));
        const a = fAbbr.value || null;
        if (a !== null && !PROFILE_RE.abbr.test(a)) return void (err.textContent = t('The code is three letters.'));
        if (!signed) {
          const r = sanitizeNickname(fNick.value);
          if (!r.ok) return void (err.textContent = t(r.error));
          settings.nickname = r.nick;
        }
        const av = `h${design}:${fColour2.value}`;
        settings.profile = {
          num: n,
          abbr: a ?? '',
          country: fCountry.value,
          colour: fColour.value,
          avatar: av,
          photo: newPhoto,
          banner: (['spa', 'zandvoort', 'nurburgring', 'none'] as const).find((b) => b === fBanner.value) ?? 'spa',
        };
        settings.units = fUnits.value === 'mph' ? 'mph' : 'kmh';
        settings.garageCar = fCar.value || null;
        saveSettings(settings);
        save.setAttribute('disabled', '');
        try {
          if (signed) await acc.saveProfile({ country: fCountry.value || null, num: n, abbr: a, colour: fColour.value, avatar: av });
          toast(t('Profile saved'));
          o.onChanged();
        } catch (x) {
          err.textContent = x instanceof Error ? t(x.message) : String(x);
        } finally {
          save.removeAttribute('disabled');
        }
      },
    },
    h('h3', { text: t('Profile settings') }),
    h(
      'div.pf-av-edit',
      {},
      preview,
      h(
        'div.pf-av-side',
        {},
        h('span.pf-label', { text: t('Avatar') }),
        grid,
        h(
          'div.pf-av-row',
          {},
          h('label.pf-mini', {}, h('span', { text: t('Helmet colour') }), fColour),
          h('label.pf-mini', {}, h('span', { text: t('Second colour') }), fColour2),
          photoBtn,
          removePhoto,
          fileIn,
        ),
        h('small.muted', { text: t('A photo stays on this device; other drivers see your helmet.') }),
      ),
    ),
    h(
      'div.pf-form-grid',
      {},
      fieldRow(t('Nickname'), fNick, signed ? t('Your account name') : ''),
      fieldRow(t('Country'), fCountry),
      fieldRow(t('Car number'), fNum),
      fieldRow(t('Code'), fAbbr, t('Three letters, as on the timing screens')),
      fieldRow(t('Profile banner'), fBanner),
      fieldRow(t('Speed units'), fUnits),
      fieldRow(t('Your car'), fCar, t('Picked for you in every lobby')),
    ),
    err,
    h('div.pf-form-foot', {}, save, signed ? h('span.muted', { html: `${ICONS.user} ${t('Saved to your account and this device')}` }) : null),
  );

  drawPicker();
  fNum.addEventListener('input', drawPicker);
  return h('div.pf', {}, card, h('div.pf-cols', {}, h('div.pf-col', {}, stats, achievements, online, results), h('div.pf-col', {}, form, players)));
}

/** The drivers you raced online lately (the consoles' "recent players"), to add as friends when signed in. */
export function recentPlayersPanel(tracks: TrackChoice[]): HTMLElement {
  const signed = acc.account();
  const trackName = (id: string) => t(tracks.find((x) => x.id === id)?.name ?? id);
  const recent = loadRecentPlayers();
  return h(
    'section.pf-players',
    {},
    h('h3', { text: t('Recent players') }),
    recent.length
      ? h(
          'div.pf-plist',
          {},
          ...recent.slice(0, 10).map((p) =>
            h(
              'div.pf-player',
              {},
              flagImg(p.country, 18) ?? h('span.pf-noflag'),
              h('span', {}, h('b', { text: p.nick }), h('small', { text: trackName(p.trackId) })),
              signed
                ? h('button.small', {
                    type: 'button',
                    text: t('Add friend'),
                    onclick: async (e: Event) => {
                      const b = e.currentTarget as HTMLButtonElement;
                      b.disabled = true;
                      try {
                        await acc.addFriend(p.nick);
                        b.textContent = t('Request sent');
                      } catch (x) {
                        b.disabled = false;
                        toast(t((x as Error).message));
                      }
                    },
                  })
                : null,
            ),
          ),
        )
      : h('p.muted', { text: t('People you race online show here, to add them as friends.') }),
  );
}
