/**
 * Car status instrument (as on a GT3 dash / F1 game HUD): a top-down car with
 *  - the four tyres coloured by temperature, the temperature in °C next to each;
 *  - body zones (front, rear, sides, engine) tinted by damage;
 * plus ABS and traction-control warning lamps with their standard dashboard symbols.
 * Pure inline SVG: crisp at any size, no image files. Only touches the DOM when a value changes.
 */
import { COMPOUNDS, type CompoundId } from '../physics/tyres';
import { t } from '../i18n';

const NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...kids: SVGElement[]): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  e.append(...kids);
  return e;
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

  constructor() {
    // car, front up. viewBox 0..120 × 0..110; body centred at x = 60
    const svg = el('svg', { viewBox: '0 0 120 110', class: 'car-status-svg', 'aria-label': t('Tyres and damage') });
    const body = 'M48 8 Q60 3 72 8 L77 22 L78 86 Q78 98 60 100 Q42 98 42 86 L43 22 Z';
    svg.append(el('path', { d: body, class: 'cs-body' }));
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
    for (const [x, y, w, h] of zoneRects) {
      const r = el('rect', { x, y, width: w, height: h, fill: 'transparent', class: 'cs-zone' });
      this.zones.push(r);
      zg.append(r);
    }
    svg.append(zg);
    // cockpit glass and rear wing for readability
    svg.append(el('path', { d: 'M50 30 Q60 26 70 30 L68 50 L52 50 Z', class: 'cs-glass' }));
    svg.append(el('rect', { x: 40, y: 97, width: 40, height: 4, rx: 1.5, class: 'cs-wing' }));
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
      this.treads[i].setAttribute('height', String(16 * Math.min(1, wr[i] / 50)));
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
