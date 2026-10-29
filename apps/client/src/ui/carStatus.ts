/**
 * Car status instrument (as on a GT3 dash / F1 game HUD): your own car seen from above (its real model, rendered at
 * load: topView.ts; a drawn outline until then) with
 *  - the four tyres coloured by temperature, the temperature in °C next to each;
 *  - body zones (front, rear, sides, engine) tinted by damage;
 * plus ABS and traction-control warning lamps with their standard dashboard symbols.
 * Pure inline SVG: crisp at any size, no image files. Only touches the DOM when a value changes.
 */
import type { CarEntry } from '@apex/shared';
import { COMPOUNDS, type CompoundId } from '../physics/tyres';
import type { TopView } from '../game/topView';
import { t } from '../i18n';

const NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...kids: SVGElement[]): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  e.append(...kids);
  return e;
}

/** Where the engine sits: front-engined (BMW, Mercedes, Aston, Ford, Lexus), rear (911), the rest mid-engined. */
function engineAt(id: string): 'front' | 'mid' | 'rear' {
  if (/porsche/.test(id)) return 'rear';
  if (/bmw|mercedes_amg_gt3|amg_gt3|vantage|aston|mustang|lexus/.test(id)) return 'front';
  return 'mid';
}

const TYRE_COLOURS = { cold: '#3a86ff', warm: '#5ec8ff', ok: '#30d158', hot: '#ff453a' };
/** Around the compound's own window (Medium 85 °C: blue below 65, green 77–103; wets 60 °C), not fixed numbers:
 * wets at their best showed blue, and Hards green while still short of theirs. */
function tyreColour(t: number, optimumC: number): string {
  return t < optimumC - 20 ? TYRE_COLOURS.cold : t < optimumC - 8 ? TYRE_COLOURS.warm : t <= optimumC + 18 ? TYRE_COLOURS.ok : TYRE_COLOURS.hot;
}
function damageColour(d: number): string {
  return d < 0.05 ? 'transparent' : d < 0.3 ? '#ffd60a' : d < 0.6 ? '#ff9f0a' : '#ff453a';
}

export class CarStatus {
  readonly el: HTMLElement;
  private tyres: SVGRectElement[] = [];
  private temps: SVGTextElement[] = [];
  private zones: SVGElement[] = [];
  private treads: SVGRectElement[] = [];
  private brakes: SVGCircleElement[] = [];
  private badge: SVGCircleElement;
  private badgeText: SVGTextElement;
  private abs: SVGGElement;
  private tc: SVGGElement;
  private key = '';
  private svg: SVGSVGElement;
  private drawn: SVGElement[] = [];
  private zg: SVGGElement;
  private labels: SVGTextElement[] = [];

  constructor() {
    // car, front up. viewBox 0..120 × 0..110; body centred at x = 60
    const svg = el('svg', { viewBox: '0 0 120 110', class: 'car-status-svg', 'aria-label': t('Tyres and damage') });
    this.svg = svg;
    const body = 'M48 8 Q60 3 72 8 L77 22 L78 86 Q78 98 60 100 Q42 98 42 86 L43 22 Z';
    const bodyPath = el('path', { d: body, class: 'cs-body' });
    svg.append(bodyPath);
    this.drawn.push(bodyPath);
    // damage zones, clipped to the body outline
    const clip = el('clipPath', { id: 'cs-clip' }, el('path', { d: body }));
    svg.append(el('defs', {}, clip));
    const zoneRects: [number, number, number, number][] = [
      [40, 2, 40, 18], // front
      [40, 84, 40, 18], // rear
      [40, 20, 9, 64], // left (the car's left is on the left when seen from above, nose up)
      [71, 20, 9, 64], // right
      [52, 62, 16, 18], // engine (mid/rear for most GT3s; for the zone it is only a symbol)
    ];
    const zg = el('g', { 'clip-path': 'url(#cs-clip)' });
    this.zg = zg;
    for (const [x, y, w, h] of zoneRects) {
      const r = el('rect', { x, y, width: w, height: h, fill: 'transparent', class: 'cs-zone' });
      this.zones.push(r);
      zg.append(r);
    }
    svg.append(zg);
    // cockpit glass and rear wing for readability
    const glass = el('path', { d: 'M50 30 Q60 26 70 30 L68 50 L52 50 Z', class: 'cs-glass' });
    const wing = el('rect', { x: 40, y: 97, width: 40, height: 4, rx: 1.5, class: 'cs-wing' });
    svg.append(glass, wing);
    this.drawn.push(glass, wing);
    // tyres + temperatures
    const tyrePos: [number, number, 'start' | 'end'][] = [
      [33, 18, 'end'], // FL
      [79, 18, 'start'], // FR
      [33, 68, 'end'], // RL
      [79, 68, 'start'], // RR
    ];
    for (const [x, y, anchor] of tyrePos) {
      const r = el('rect', { x, y, width: 8, height: 18, rx: 2.5, class: 'cs-tyre', fill: TYRE_COLOURS.cold });
      this.tyres.push(r);
      // tread left: a dark bar that grows from the top as the tyre wears
      const tr = el('rect', { x: x + 1, y: y + 1, width: 6, height: 0, rx: 1.5, class: 'cs-wear' });
      this.treads.push(tr);
      const tx = anchor === 'end' ? x - 3 : x + 11;
      const t = el('text', { x: tx, y: y + 13, 'text-anchor': anchor, class: 'cs-temp' });
      t.textContent = '--';
      this.temps.push(t);
      this.labels.push(t);
      // brake disc: a dot on the hub, coloured by its temperature
      const bd = el('circle', { cx: x + 4, cy: y + 9, r: 2.2, class: 'cs-brake' });
      this.brakes.push(bd);
      svg.append(r, tr, bd, t);
    }
    // fitted compound: Pirelli-style coloured ring with its letter, in the middle of the car
    this.badge = el('circle', { cx: 60, cy: 62, r: 7, class: 'cs-badge' });
    this.badgeText = el('text', { x: 60, y: 65.5, 'text-anchor': 'middle', class: 'cs-badge-text' });
    this.badgeText.textContent = 'M';
    svg.append(this.badge, this.badgeText);
    // ABS lamp: the ISO symbol, "ABS" in a circle between brackets
    this.abs = el(
      'g',
      { class: 'cs-lamp', transform: 'translate(4 92)' },
      el('circle', { cx: 9, cy: 9, r: 7, class: 'cs-lamp-line' }),
      el('path', { d: 'M1.5 3 Q-1.5 9 1.5 15 M16.5 3 Q19.5 9 16.5 15', class: 'cs-lamp-line' }),
    );
    const absText = el('text', { x: 9, y: 11.5, 'text-anchor': 'middle', class: 'cs-lamp-text' });
    absText.textContent = t('ABS');
    this.abs.append(absText);
    // traction control lamp: a car with skid lines underneath
    this.tc = el(
      'g',
      { class: 'cs-lamp', transform: 'translate(98 92)' },
      el('path', { d: 'M3 9 L5 4 L13 4 L15 9 L15 12 L3 12 Z', class: 'cs-lamp-line' }),
      el('path', { d: 'M4 14 q2 2 0 4 M9 14 q2 2 0 4 M14 14 q2 2 0 4', class: 'cs-lamp-line' }),
    );
    svg.append(this.abs, this.tc);
    this.el = document.createElement('div');
    this.el.className = 'car-status';
    this.el.title = t(
      'Tyre temperatures (°C; blue cold, green 75–105, red hot), tread worn (dark bar), brake discs (hub dot: blue cold, green ok, orange hot, red fading), fitted compound and damage',
    );
    const cap = document.createElement('div');
    cap.className = 'cs-caption';
    cap.textContent = t('TYRES °C · DAMAGE');
    this.el.append(svg, cap);
  }

  /**
   * The car you drive: its picture from above (null: keep the drawn outline), and the tyres, brakes and damage
   * zones where that car has them (track, wheelbase, tyre sizes, the engine's place).
   */
  setCar(entry: CarEntry, view: TopView | null): void {
    if (!view) return;
    // nose up, 94 units long, centred at x = 60 (the car's left on the left)
    const len = view.maxZ - view.minZ;
    const k = Math.min(94 / len, 70 / (view.maxX - view.minX));
    const sx = (x: number) => 60 - (x - (view.minX + view.maxX) / 2) * k;
    const sy = (z: number) => 4 + (view.maxZ - z) * k;
    const w = (view.maxX - view.minX) * k;
    const top = sy(view.maxZ);
    const left = sx(view.maxX);
    for (const d of this.drawn) d.remove();
    const NSX = 'http://www.w3.org/1999/xlink';
    const img = el('image', { x: left, y: top, width: w, height: len * k, class: 'cs-car', preserveAspectRatio: 'none' });
    img.setAttribute('href', view.url);
    img.setAttributeNS(NSX, 'xlink:href', view.url);
    // damage zones only over the car itself: masked by the picture's alpha
    const maskImg = el('image', { x: left, y: top, width: w, height: len * k, preserveAspectRatio: 'none' });
    maskImg.setAttribute('href', view.url);
    const mask = el('mask', { id: 'cs-car-mask', style: 'mask-type: alpha' }, maskImg);
    // drawn as the outline was, not as a picture: the car's shape (its picture's alpha) filled white at 10 % with a
    // white outline traced round it, so it stays see-through over the cockpit and the livery adds no colour
    const silhouette = el(
      'filter',
      { id: 'cs-silhouette', x: '-5%', y: '-5%', width: '110%', height: '110%' },
      el('feMorphology', { in: 'SourceAlpha', operator: 'dilate', radius: 0.7, result: 'grown' }),
      el('feComposite', { in: 'grown', in2: 'SourceAlpha', operator: 'out', result: 'ring' }),
      el('feFlood', { 'flood-color': '#ffffff', 'flood-opacity': 0.75, result: 'white' }),
      el('feComposite', { in: 'white', in2: 'ring', operator: 'in', result: 'line' }),
      el('feFlood', { 'flood-color': '#ffffff', 'flood-opacity': 0.1, result: 'tint' }),
      el('feComposite', { in: 'tint', in2: 'SourceAlpha', operator: 'in', result: 'fill' }),
      el('feMerge', {}, el('feMergeNode', { in: 'fill' }), el('feMergeNode', { in: 'line' })),
    );
    this.svg.querySelector('defs')?.append(mask, silhouette);
    img.setAttribute('filter', 'url(#cs-silhouette)');
    this.svg.insertBefore(img, this.zg);
    this.zg.removeAttribute('clip-path');
    this.zg.setAttribute('mask', 'url(#cs-car-mask)');
    const z0 = sy(view.maxZ);
    const L = len * k;
    const eng = engineAt(entry.id);
    const ey = eng === 'front' ? z0 + L * 0.1 : eng === 'rear' ? z0 + L * 0.76 : z0 + L * 0.52;
    const rects: [number, number, number, number][] = [
      [left, z0, w, L * 0.2],
      [left, z0 + L * 0.8, w, L * 0.2],
      [left, z0 + L * 0.2, w * 0.24, L * 0.6],
      [left + w * 0.76, z0 + L * 0.2, w * 0.24, L * 0.6],
      [60 - w * 0.18, ey, w * 0.36, L * 0.2],
    ];
    rects.forEach(([x, y, rw, rh], i) => {
      const r = this.zones[i];
      r.setAttribute('x', String(x));
      r.setAttribute('y', String(y));
      r.setAttribute('width', String(rw));
      r.setAttribute('height', String(rh));
    });
    // tyres at the model's wheels, sized as its tyres (≈ 0.3 m wide), drawn over the picture's own wheels
    const keys = ['FL', 'FR', 'RL', 'RR'] as const;
    keys.forEach((key, i) => {
      const wg = entry.wheels[key];
      const tw = Math.max(5, 0.32 * k);
      const th = 2 * wg.radius * k;
      const cx = sx(wg.position[0]);
      const cy = sy(wg.position[2]);
      const x = cx - tw / 2;
      const y = cy - th / 2;
      this.tyres[i].setAttribute('x', String(x));
      this.tyres[i].setAttribute('y', String(y));
      this.tyres[i].setAttribute('width', String(tw));
      this.tyres[i].setAttribute('height', String(th));
      this.treads[i].setAttribute('x', String(x + 1));
      this.treads[i].setAttribute('y', String(y + 1));
      this.treads[i].setAttribute('width', String(tw - 2));
      this.brakes[i].setAttribute('cx', String(cx));
      this.brakes[i].setAttribute('cy', String(cy));
      const leftSide = key[1] === 'L';
      const lx = leftSide ? Math.min(x - 2, left - 1) : Math.max(x + tw + 2, left + w + 1);
      this.labels[i].setAttribute('x', String(lx));
      this.labels[i].setAttribute('y', String(cy + 3));
      this.treadH[i] = th - 2;
    });
    // the compound badge where the engine isn't
    const by = eng === 'front' ? z0 + L * 0.62 : z0 + L * 0.36;
    this.badge.setAttribute('cy', String(by));
    this.badgeText.setAttribute('y', String(by + 3.5));
    this.key = '';
  }

  private treadH = [16, 16, 16, 16];

  /** temps: FL, FR, RL, RR (°C); zones: front, rear, left, right, engine (0..1). */
  update(temps: number[], zones: ArrayLike<number>, abs: boolean, tc: boolean, compound: CompoundId, wear: number[], brakes: number[] = []): void {
    const t = temps.map((x) => Math.round(x));
    const z = Array.from({ length: 5 }, (_, i) => Math.round((zones[i] ?? 0) * 20));
    const wr = wear.map((x) => Math.round(x * 50));
    const bk = brakes.map((b) => (b < 200 ? 'c' : b <= 700 ? 'o' : b <= 850 ? 'h' : 'f'));
    const key = `${t.join(',')}|${z.join(',')}|${abs ? 1 : 0}${tc ? 1 : 0}|${compound}|${wr.join(',')}|${bk.join('')}`;
    if (key === this.key) return;
    this.key = key;
    const opt = COMPOUNDS[compound].optimumC;
    for (let i = 0; i < 4; i++) {
      this.tyres[i].setAttribute('fill', tyreColour(t[i], opt));
      this.temps[i].textContent = `${t[i]}°`;
      this.treads[i].setAttribute('height', String(this.treadH[i] * Math.min(1, wr[i] / 50)));
      this.brakes[i].setAttribute('fill', { c: '#5ec8ff', o: '#30d158', h: '#ff9f0a', f: '#ff453a' }[bk[i] ?? 'c'] ?? '#5ec8ff');
    }
    const c = COMPOUNDS[compound];
    this.badge.setAttribute('stroke', c.colour);
    this.badgeText.textContent = c.letter;
    this.badgeText.setAttribute('fill', c.colour);
    for (let i = 0; i < 5; i++) {
      const d = z[i] / 20;
      this.zones[i].setAttribute('fill', damageColour(d));
      this.zones[i].setAttribute('fill-opacity', String(0.35 + 0.5 * d));
    }
    this.abs.classList.toggle('on', abs);
    this.tc.classList.toggle('on', tc);
  }
}
