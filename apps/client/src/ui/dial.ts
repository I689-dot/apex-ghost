import { h } from './dom';

const NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...kids: SVGElement[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...kids);
  return el;
}

/** What the dial shows each frame. */
export interface DialState {
  /** Speed in the player's units, and its label ("KM/H" / "MPH"). */
  speed: number;
  unit: string;
  /** −1 reverse, 0 neutral, 1…n. */
  gear: number;
  manual: boolean;
  rpm: number;
  redline: number;
  limiter: number;
  abs: boolean;
  tc: boolean;
  headlights: boolean;
  /** The engine's damage 0…1. */
  engine: number;
  /** Fuel: 0…1 of the tank, litres and laps left; null without the fuel rule. */
  fuel: { frac: number; litres: number; laps: number } | null;
  fuelLow: boolean;
}

/** The arc covers 270° from the bottom left, over the top, to the bottom right (a fraction of the full circle). */
const SWEEP = 0.75;

/**
 * The driver's dial, in the manner of the current sims and GT games: a ring of revs round a dark face with the gear
 * big in the middle and the speed under it, the headlights, assist and engine lamps beside the gear, and the fuel as
 * a bar below. The ring turns amber, then red and blue towards the limiter (the shift lights of a real wheel).
 * Only writes to the DOM when a value changes.
 */
export class Dial {
  readonly el = h('div.dial');
  private gear = h('div.dial-gear', { text: 'N' });
  private speed = h('div.dial-speed', { text: '0' });
  private unit = h('div.dial-unit', { text: 'KM/H' });
  private white = this.arc('dial-arc dial-w');
  private amber = this.arc('dial-arc dial-a');
  private blue = this.arc('dial-arc dial-b');
  private zones = [this.arc('dial-zone dial-za'), this.arc('dial-zone dial-zb')];
  private lampLights = h('i.dial-lamp.lights');
  private lampTc = h('i.dial-lamp.tc', { text: 'TC' });
  private lampAbs = h('i.dial-lamp.abs', { text: 'ABS' });
  private lampEngine = h('i.dial-lamp.engine');
  private fuelBar = h('div.dial-fuel');
  private fuelFill = h('div.dial-fuel-fill');
  private fuelText = h('span');
  private last = { pct: -1, speed: '', gear: '', unit: '', zones: '', fuel: '', flags: '' };

  constructor() {
    const ring = svg('svg', { class: 'dial-ring', viewBox: '0 0 200 200' });
    // the track of the ring and its two coloured zones near the limiter (their ends are set by update)
    ring.append(this.arc('dial-arc dial-track', 0, 100), ...this.zones, this.white, this.amber, this.blue);
    this.fuelBar.append(this.fuelFill, this.fuelText);
    this.lampLights.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M11 5C6.5 5 3 8 3 12s3.5 7 8 7c1.2 0 2-.4 2-1.2V6.2C13 5.4 12.200 5 11 5z"/><path d="M16.500 7l4.500-1.500M16.500 12H21M16.500 17l4.500 1.500"/></svg>';
    this.lampEngine.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M3 10h3l1-2h3V6h4v2h2l2 2h3v6h-3l-2 2H9l-2-2H3z"/></svg>';
    this.el.append(
      ring,
      h('div.dial-face', {}, h('div.dial-lamps', {}, this.lampLights, this.lampTc, this.lampAbs, this.lampEngine), this.gear, this.speed, this.unit),
      this.fuelBar,
    );
    this.fuelBar.hidden = true;
  }

  /** A circle that draws only the part of the ring between two percentages of the arc (set with setArc). */
  private arc(cls: string, from = 0, to = 0): SVGElement {
    const c = svg('circle', { class: cls, cx: 100, cy: 100, r: 92, pathLength: 100, transform: 'rotate(135 100 100)' });
    this.setArc(c, from, to);
    return c;
  }

  private setArc(c: SVGElement, from: number, to: number): void {
    const len = Math.max(0, to - from) * SWEEP;
    c.style.strokeDasharray = `${len} 100`;
    c.style.strokeDashoffset = String(-from * SWEEP);
  }

  update(s: DialState): void {
    const sp = String(Math.round(Math.abs(s.speed)));
    if (sp !== this.last.speed) {
      this.last.speed = sp;
      this.speed.textContent = sp;
    }
    const g = s.gear < 0 ? 'R' : s.gear === 0 ? 'N' : String(s.gear);
    const gKey = g + (s.manual ? 'm' : '');
    if (gKey !== this.last.gear) {
      this.last.gear = gKey;
      this.gear.textContent = g;
      this.gear.classList.toggle('manual', s.manual);
      this.gear.classList.toggle('neutral', s.gear === 0);
    }
    if (s.unit !== this.last.unit) {
      this.last.unit = s.unit;
      this.unit.textContent = s.unit;
    }
    // the ring: white to the shift zone, amber in it, blue at the cut
    const lim = Math.max(1, s.limiter);
    const red = Math.min(100, (s.redline / lim) * 100);
    const a = red * 0.86;
    const b = red * 0.97;
    const pct = Math.max(0, Math.min(100, (s.rpm / lim) * 100));
    const q = Math.round(pct * 2) / 2;
    if (q !== this.last.pct) {
      this.last.pct = q;
      this.setArc(this.white, 0, Math.min(q, a));
      this.setArc(this.amber, a, Math.max(a, Math.min(q, b)));
      this.setArc(this.blue, b, Math.max(b, q));
    }
    const zk = `${Math.round(red)}`;
    if (zk !== this.last.zones) {
      this.last.zones = zk;
      this.setArc(this.zones[0], a, b);
      this.setArc(this.zones[1], b, 100);
    }
    const flags = `${s.headlights ? 1 : 0}${s.tc ? 1 : 0}${s.abs ? 1 : 0}${Math.round(s.engine * 10)}`;
    if (flags !== this.last.flags) {
      this.last.flags = flags;
      this.lampLights.classList.toggle('on', s.headlights);
      this.lampTc.classList.toggle('on', s.tc);
      this.lampAbs.classList.toggle('on', s.abs);
      this.lampEngine.className = `dial-lamp engine${s.engine > 0.7 ? ' bad' : s.engine > 0.25 ? ' warn' : ''}`;
    }
    this.fuelBar.hidden = !s.fuel;
    if (s.fuel) {
      const fk = `${s.fuel.litres.toFixed(1)}|${s.fuel.laps.toFixed(1)}|${s.fuelLow ? 1 : 0}`;
      if (fk !== this.last.fuel) {
        this.last.fuel = fk;
        this.fuelFill.style.transform = `scaleX(${Math.max(0, Math.min(1, s.fuel.frac))})`;
        this.fuelText.textContent = `${s.fuel.litres.toFixed(1)} L (${s.fuel.laps.toFixed(1)} laps)`;
        this.fuelBar.classList.toggle('low', s.fuelLow);
      }
    }
  }
}
