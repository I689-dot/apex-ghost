import type { CarEntry } from '@apex/shared';
import { t } from '../i18n';
import { steeringLockDeg } from '../physics/steeringLock';
import { h } from './dom';
import { ICONS } from './icons';
import { heroUrl } from './images';

const hp = (kw: number) => Math.round(kw * 1.341);

export interface GarageOptions {
  /** The car shown first (and marked as yours). */
  current: string | null;
  /** Header kicker and title. */
  kicker: string;
  title: string;
  /** The main button's label ("Race with this car", "Select car"). */
  cta: string;
  onPick: (id: string) => void;
  /** A back / cancel button (modal use). */
  onClose?: () => void;
  /** Other drivers on each car (a lobby: their names on the card; nothing is locked). */
  others?: Record<string, string[]>;
  /** Picking is not possible now (a lobby during a race). */
  disabled?: boolean;
  /** Called with the car shown (a 3D preview elsewhere). */
  onBrowse?: (car: CarEntry) => void;
  /** Kept across re-renders (a lobby redraws on every change): the car shown, the brand filter, the search. */
  state?: { shown: string | null; brand: string; query: string };
}

/** The team or entrant, short ("Heart of Racing (IMSA GTD, WEC LMGT3)" → "Heart of Racing"). */
function teamOf(c: CarEntry): string {
  const team = c.info?.team ? t(c.info.team) : c.manufacturer;
  return team.split(/\s[(·:]/)[0].trim() || c.manufacturer;
}

/**
 * The garage, laid out as Le Mans Ultimate's car select: the entrant big at the top left with the car's model in
 * outline letters under it and its engine / power / weight, the car large in the middle with arrows either side, its
 * numbers as bars on the right against the rest of the GT3 field, and along the bottom a dash per car (where you are
 * in the list), the makes to filter by, the cars of the make as thumbnails, and the button to go on.
 * ← → (or the arrows) step through the cars; Enter picks.
 */
export function garagePicker(cars: CarEntry[], o: GarageOptions): HTMLElement {
  const field = cars.filter((c) => c.role !== 'safety');
  const st = o.state ?? { shown: null, brand: '', query: '' };
  let shown = field.find((c) => c.id === (st.shown ?? o.current)) ?? field.find((c) => c.id === o.current) ?? field[0];
  let brand = st.brand;
  const brands = [...new Set(field.map((c) => c.manufacturer))].sort((a, b) => a.localeCompare(b));
  const list = () => field.filter((c) => !brand || c.manufacturer === brand);
  // the field's range of each number, for the bars
  const range = (f: (c: CarEntry) => number) => {
    const v = field.map(f);
    return [Math.min(...v), Math.max(...v)] as const;
  };
  const R = {
    power: range((c) => hp(c.specs.powerKw)),
    mass: range((c) => c.specs.massKg),
    ptw: range((c) => c.specs.massKg / hp(c.specs.powerKw)),
    top: range((c) => c.specs.topSpeedKmh),
  };
  /** A bar 15…100 % across the field's range (better = longer; for weight, lighter is better). */
  const bar = (label: string, value: string, v: number, [lo, hi]: readonly [number, number], lowerBetter = false) => {
    let f = hi > lo ? (v - lo) / (hi - lo) : 1;
    if (lowerBetter) f = 1 - f;
    return h(
      'div.gr-stat',
      {},
      h('div.gr-stat-head', {}, h('span', { text: label }), h('b', { text: value })),
      h('div.gr-bar', {}, h('i', { style: `width:${(15 + f * 85).toFixed(1)}%` })),
    );
  };

  const ident = h('div.gr-ident');
  const photo = h('div.gr-photo');
  const specs = h('div.gr-specs');
  const dashes = h('div.gr-dashes');
  const chips = h('div.gr-brands');
  const strip = h('div.gr-list', { role: 'listbox', 'aria-label': t('Cars') });
  const ctaBtn = h('button.gr-cta', { type: 'button', disabled: !!o.disabled });

  const show = (c: CarEntry) => {
    shown = c;
    st.shown = c.id;
    o.onBrowse?.(c);
    draw();
  };
  const step = (d: number) => {
    const l = list();
    const i = l.findIndex((c) => c.id === shown.id);
    show(l[(Math.max(0, i) + d + l.length) % l.length]);
  };

  const draw = () => {
    const c = shown;
    const mine = c.id === o.current;
    const others = o.others?.[c.id] ?? [];
    const l = list();
    ident.replaceChildren(
      h('span.gr-mark', { text: c.manufacturer }),
      h(
        'div.gr-names',
        {},
        h('h2', { text: teamOf(c) }),
        h('div.gr-outline', { text: c.name }),
        h(
          'div.gr-line',
          {},
          [c.info ? t(c.info.engine) : null, t('{n} hp', { n: hp(c.specs.powerKw) }), `${c.specs.massKg.toLocaleString()} kg`, c.year ? String(c.year) : null]
            .filter(Boolean)
            .join(' · '),
        ),
        h(
          'div.gr-tags',
          {},
          h('span.gr-class', { text: c.category }),
          mine ? h('span.gr-yours', { html: `${ICONS.check} ${t('Your car')}` }) : null,
          others.length ? h('span.gr-shared', { text: t('Also driven by {names}', { names: others.join(', ') }) }) : null,
        ),
      ),
    );
    photo.replaceChildren(
      h('button.gr-arrow.prev', { type: 'button', html: ICONS.left, title: t('Previous'), 'aria-label': t('Previous'), onclick: () => step(-1) }),
      h('img.gr-hero', {
        src: heroUrl(c),
        alt: c.name,
        draggable: 'false',
        onerror: (e: Event) => ((e.target as HTMLImageElement).src = c.thumbnail),
      }),
      h('button.gr-arrow.next', { type: 'button', html: ICONS.right, title: t('Next'), 'aria-label': t('Next'), onclick: () => step(1) }),
    );
    const ptw = c.specs.massKg / hp(c.specs.powerKw);
    specs.replaceChildren(
      bar(t('Top speed'), `${c.specs.topSpeedKmh} km/h`, c.specs.topSpeedKmh, R.top),
      bar(t('Power'), t('{n} hp', { n: hp(c.specs.powerKw) }), hp(c.specs.powerKw), R.power),
      bar(t('Weight (with driver)'), `${c.specs.massKg} kg`, c.specs.massKg, R.mass, true),
      bar(t('Power-to-weight'), `${ptw.toFixed(2)} kg/hp`, ptw, R.ptw, true),
      h(
        'dl.gr-tech',
        {},
        ...(c.info ? [h('dt', { text: t('Gearbox') }), h('dd', { text: t(c.info.gearbox) })] : []),
        h('dt', { text: t('Drivetrain') }),
        h('dd', { text: c.specs.drivetrain }),
        h('dt', { text: t('Steering lock') }),
        h('dd', { text: `${steeringLockDeg(c.id)}°` }),
      ),
    );
    dashes.replaceChildren(...l.map((x) => h(`i${x.id === c.id ? '.on' : ''}`)));
    chips.replaceChildren(
      ...['', ...brands].map((b) =>
        h(`button.gr-chip${b === brand ? '.on' : ''}`, {
          type: 'button',
          text: b || t('All'),
          onclick: () => {
            brand = b;
            st.brand = b;
            const nl = list();
            if (!nl.some((x) => x.id === shown.id)) shown = nl[0];
            st.shown = shown.id;
            draw();
          },
        }),
      ),
    );
    strip.replaceChildren(
      ...l.map((x) =>
        h(
          `button.gr-row${x.id === c.id ? '.on' : ''}${x.id === o.current ? '.mine' : ''}`,
          {
            type: 'button',
            role: 'option',
            'aria-selected': String(x.id === c.id),
            title: x.name,
            onclick: () => show(x),
            ondblclick: () => !o.disabled && o.onPick(x.id),
          },
          h('img', { src: x.thumbnail, alt: '', loading: 'lazy', draggable: 'false' }),
          h('span.gr-row-text', {}, h('b', { text: x.name })),
          x.id === o.current ? h('span.gr-row-mine', { html: ICONS.check, title: t('Your car') }) : null,
          o.others?.[x.id]?.length ? h('span.gr-row-n', { text: String(o.others[x.id].length), title: (o.others[x.id] ?? []).join(', ') }) : null,
        ),
      ),
    );
    ctaBtn.innerHTML = mine && o.cta === t('Select car') ? `${ICONS.check} ${t('Selected')}` : `${o.cta} ${ICONS.right}`;
    requestAnimationFrame(() => strip.querySelector('.gr-row.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  };

  ctaBtn.addEventListener('click', () => o.onPick(shown.id));
  const el = h(
    'section.garage',
    {
      tabindex: -1,
      onkeydown: (e: Event) => {
        const k = (e as KeyboardEvent).key;
        if ((e.target as HTMLElement).closest('input, select')) return;
        if (k === 'ArrowLeft' || k === 'ArrowRight') {
          e.preventDefault();
          step(k === 'ArrowLeft' ? -1 : 1);
        } else if (k === 'Enter' && !o.disabled && !(e.target as HTMLElement).closest('button')) o.onPick(shown.id);
      },
    },
    h(
      'header.gr-head',
      {},
      o.onClose ? h('button.gr-back', { type: 'button', html: ICONS.left, title: t('Back'), 'aria-label': t('Back'), onclick: o.onClose }) : null,
      h('div', {}, h('span.gr-kicker', { text: o.kicker }), h('h1', { text: o.title })),
    ),
    ident,
    photo,
    h('div.gr-info', {}, specs),
    h('div.gr-foot', {}, dashes, h('div.gr-foot-row', {}, chips, ctaBtn), strip),
  );
  draw();
  return el;
}

/** The garage as a full-screen step before a session ("choose your car, then race"). Resolves with the car, or null. */
export function garageModal(cars: CarEntry[], current: string | null, cta: string): Promise<string | null> {
  return new Promise((resolve) => {
    const done = (id: string | null) => {
      document.removeEventListener('keydown', esc, true);
      modal.remove();
      resolve(id);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        done(null);
      }
    };
    const picker = garagePicker(cars, {
      current,
      kicker: t('Step 1 of 2'),
      title: t('Choose your car'),
      cta,
      onPick: (id) => done(id),
      onClose: () => done(null),
    });
    const modal = h('div.garage-modal', {}, picker);
    document.addEventListener('keydown', esc, true);
    document.body.append(modal);
    picker.focus();
  });
}
