import { PROFILE_RE } from '@apex/shared';
import { h } from './dom';

/**
 * Driver avatars: a racing helmet in the driver's colours, as the timing graphics and the sims' driver cards show a
 * driver by their helmet. Sixteen paint designs (stripes, bands, a split, a chevron, stars…), each in the helmet
 * colour with a second colour; or a photo of your own (kept in this browser only: the server stores no images, so
 * others see your helmet). Stored as "h<design>:<#second colour>" (PROFILE_RE.avatar).
 */
export const AVATAR_DESIGNS = 16;
export const DEFAULT_AVATAR = 'h1:#ffffff';

export interface AvatarLook {
  avatar?: string | null;
  colour?: string | null;
  /** A picture (data URL) shown instead of the helmet. */
  photo?: string | null;
  /** Shown on the helmet's side when set (car number). */
  num?: number | null;
}

export function parseAvatar(a: string | null | undefined): { design: number; colour2: string } {
  if (a && PROFILE_RE.avatar.test(a)) {
    const [d, c] = a.split(':');
    return { design: Number(d.slice(1)), colour2: c };
  }
  return { design: 1, colour2: '#ffffff' };
}

let uid = 0;

/** The helmet as SVG markup (viewBox 64 × 64), facing right. */
export function helmetSvg(design: number, c1: string, c2: string, num?: number | null): string {
  const id = `hm${++uid}`;
  const shell = 'M9 41C9 23 21 11 35 11C49 11 57 22 57 35L57 43C57 47 54 50 50 50L18 50C12 50 9 46 9 41Z';
  const visor = 'M31 25C38 22 48 23 56.5 28L57 37C48 34.5 39 34.5 31 37C29 33 29 28 31 25Z';
  const stripes: string[] = [
    '',
    `<path d="M8 27C20 14 40 9 58 18L58 24C40 15 21 20 8 33Z" fill="${c2}"/>`,
    `<path d="M8 23C20 11 40 7 58 15L58 18C40 10 21 14 8 26Z M8 30C20 18 40 13 58 21L58 24C40 16 21 21 8 33Z" fill="${c2}"/>`,
    `<rect x="0" y="40" width="64" height="12" fill="${c2}"/>`,
    `<path d="M0 64L36 0L64 0L64 64Z" fill="${c2}"/>`,
    `<path d="M6 46L24 30L6 14" fill="none" stroke="${c2}" stroke-width="6"/>`,
    Array.from(
      { length: 8 },
      (_, i) =>
        `<rect x="${8 + i * 6}" y="${i % 2 ? 42 : 45}" width="3" height="3" fill="${c2}"/><rect x="${11 + i * 6}" y="${i % 2 ? 45 : 42}" width="3" height="3" fill="${c2}"/>`,
    ).join(''),
    `<circle cx="21" cy="35" r="9" fill="${c2}"/>`,
    `<rect x="33" y="0" width="31" height="64" fill="${c2}"/>`,
    `<path d="M24 12L14 32L22 32L16 50L32 26L24 26L30 12Z" fill="${c2}"/>`,
    [
      [18, 24],
      [26, 18],
      [16, 38],
    ]
      .map(([x, y]) => `<path transform="translate(${x} ${y})" d="M0-4L1.2-1.2L4-1L1.9 0.8L2.5 3.8L0 2.2L-2.5 3.8L-1.9 0.8L-4-1L-1.2-1.2Z" fill="${c2}"/>`)
      .join(''),
    `<path d="M4 34C14 28 22 40 32 34C42 28 50 40 62 34L62 40C50 46 42 34 32 40C22 46 14 34 4 40Z" fill="${c2}"/>`,
    Array.from({ length: 14 }, (_, i) => `<circle cx="${12 + (i % 7) * 6}" cy="${i < 7 ? 22 : 28}" r="1.7" fill="${c2}"/>`).join(''),
    `<path d="${visor}" fill="none" stroke="${c2}" stroke-width="7"/>`,
    `<rect x="8" y="0" width="9" height="64" fill="${c2}"/><rect x="17" y="0" width="9" height="64" fill="#ffffff"/>`,
    `<rect x="0" y="0" width="64" height="64" fill="url(#${id}g)"/>`,
  ];
  const art = stripes[((design % AVATAR_DESIGNS) + AVATAR_DESIGNS) % AVATAR_DESIGNS];
  const label = num
    ? `<text x="22" y="44" text-anchor="middle" font-family="Barlow Condensed, Arial Narrow, sans-serif" font-weight="800" font-style="italic" font-size="11" fill="${design === 7 ? c1 : c2}" stroke="rgba(0,0,0,.35)" stroke-width=".6">${num}</text>`
    : '';
  return (
    `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
    `<defs><clipPath id="${id}c"><path d="${shell}"/></clipPath>` +
    `<linearGradient id="${id}g" x1="0" y1="1" x2="1" y2="0"><stop offset="0.25" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>` +
    `<linearGradient id="${id}v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b6b80"/><stop offset="0.55" stop-color="#11151b"/><stop offset="1" stop-color="#05070a"/></linearGradient>` +
    `<radialGradient id="${id}s" cx="0.35" cy="0.25" r="0.75"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>` +
    `<ellipse cx="33" cy="54" rx="22" ry="3" fill="rgba(0,0,0,.35)"/>` +
    `<path d="${shell}" fill="${c1}"/>` +
    `<g clip-path="url(#${id}c)">${art}${label}</g>` +
    `<path d="${visor}" fill="url(#${id}v)" stroke="rgba(0,0,0,.6)" stroke-width="1"/>` +
    `<path d="M36 25.5C42 24.2 49 25 54 27.6" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1.3" stroke-linecap="round"/>` +
    `<path d="${shell}" fill="url(#${id}s)"/>` +
    `<path d="${shell}" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="1.2"/>` +
    `<path d="M14 49L50 49" stroke="rgba(0,0,0,.5)" stroke-width="2"/>` +
    `</svg>`
  );
}

/** An avatar badge: the photo, or the helmet on a dark disc. `size` in px. */
export function avatarEl(look: AvatarLook, size = 40, cls = ''): HTMLElement {
  const colour = look.colour && PROFILE_RE.colour.test(look.colour) ? look.colour : '#e10600';
  const el = h(`span.avatar${cls ? `.${cls}` : ''}`, { style: `--av:${size}px;--av-c:${colour}` });
  if (look.photo) el.append(h('img', { src: look.photo, alt: '', draggable: 'false' }));
  else {
    const { design, colour2 } = parseAvatar(look.avatar);
    el.innerHTML = helmetSvg(design, colour, colour2, look.num);
  }
  return el;
}

/**
 * A picture for the avatar, made small (a square crop, 160 px, JPEG): a phone photo of several MB becomes ~10 kB
 * that fits in the browser's storage. Rejects anything that is not an image.
 */
export async function photoToAvatar(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('That is not a picture.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('That picture could not be read.'));
      i.src = url;
    });
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    const c = document.createElement('canvas');
    c.width = c.height = 160;
    const g = c.getContext('2d');
    if (!g) throw new Error('That picture could not be read.');
    g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 160, 160);
    return c.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}
