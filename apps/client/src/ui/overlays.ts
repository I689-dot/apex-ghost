import { settings } from '../settings';
import { h } from './dom';
import { t } from '../i18n';
import { flagImg } from './social';

/** One car in the relative box: on the road ahead (+) or behind (−) of you. */
export interface RelativeRow {
  id: string;
  name: string;
  color: string;
  position: number;
  /** Estimated time to it on the road (s): + ahead, − behind. */
  gapS: number;
  /** In the race: a lap or more ahead of you (lapping you), behind you (you are lapping it), or on your lap. */
  lap: 'ahead' | 'behind' | 'same';
  inPit: boolean;
  me: boolean;
}

/**
 * Race overlays after iRacing and ACC, beside the HUD:
 *  - the relative box: the cars just ahead and behind on the road (not in the classification), the time to each,
 *    in iRacing's colours: you in gold, your lap white, a lap or more ahead red, a lap or more behind blue, the
 *    pit lane grey;
 *  - the delta bar: green growing left when you gain on your best lap, red right when you lose, ±1 s full;
 *  - inputs: throttle, brake and the steering wheel's angle;
 *  - the spotter: a band on the side of the screen where a car is alongside.
 * Each can be switched off in the settings. Only writes to the DOM when what it shows changes.
 */
export class RaceOverlays {
  readonly relative = h('div.ov-rel');
  readonly deltaBar = h('div.ov-delta');
  readonly inputs = h('div.ov-inputs');
  /** The delta under the rear-view mirror (iRacing puts it there). */
  readonly mirrorDelta = h('div.ov-mdelta');
  readonly spotL = h('div.ov-spot.left');
  readonly spotR = h('div.ov-spot.right');
  private deltaFill = h('div.ov-delta-fill');
  private relKey = '';
  /** Drivers' countries and numbers (set by the HUD). */
  drivers = new Map<string, { country: string | null; num: number | null }>();
  private last = { delta: 99, mdelta: '' };
  /**
   * The inputs as iRacing's widget draws them: a trace of the last seconds of throttle (green) and brake (red),
   * the two pedals as bars, the gear on yellow, the speed, the wheel turning.
   */
  private inCanvas = h('canvas.ov-in-canvas', { width: 540, height: 112 });
  private inG = this.inCanvas.getContext('2d') as CanvasRenderingContext2D;
  private trace = new Float32Array(150 * 2);
  private traceAt = 0;
  private traceT = 0;

  constructor() {
    this.deltaBar.append(h('div.ov-delta-mid'), this.deltaFill);
    this.inputs.append(this.inCanvas);
  }

  /**
   * Every frame: pedals 0…1, steering −1 (right) … +1 (left) of full lock, delta to the best lap (ms) or null,
   * gear (−1 R, 0 N), speed in the player's units with its label.
   */
  update(throttle: number, brake: number, steer: number, deltaMs: number | null, gear = 0, speed = 0, unit = 'km/h', dt = 1 / 60): void {
    const o = settings.overlays;
    this.inputs.hidden = !o.inputs;
    if (o.inputs) {
      // 30 samples a second, 5 s of trace
      this.traceT += dt;
      while (this.traceT >= 1 / 30) {
        this.traceT -= 1 / 30;
        this.trace[this.traceAt * 2] = throttle;
        this.trace[this.traceAt * 2 + 1] = brake;
        this.traceAt = (this.traceAt + 1) % 150;
      }
      this.drawInputs(throttle, brake, steer, gear, speed, unit);
    }
    this.deltaBar.hidden = !o.deltaBar || deltaMs === null;
    if (o.deltaBar && deltaMs !== null) {
      const f = Math.max(-1, Math.min(1, deltaMs / 1000));
      const q = Math.round(f * 100) / 100;
      if (q !== this.last.delta) {
        this.last.delta = q;
        // gaining (negative delta) grows left in green, losing grows right in red
        this.deltaFill.style.transform = `scaleX(${Math.abs(q)})`;
        this.deltaFill.className = `ov-delta-fill ${q <= 0 ? 'good' : 'bad'}`;
      }
    }
    const md = deltaMs === null || !settings.mirror ? '' : `${deltaMs <= 0 ? '−' : '+'}${(Math.abs(deltaMs) / 1000).toFixed(2)}`;
    if (md !== this.last.mdelta) {
      this.last.mdelta = md;
      this.mirrorDelta.textContent = md;
      this.mirrorDelta.className = `ov-mdelta${md ? (deltaMs !== null && deltaMs <= 0 ? ' good' : ' bad') : ''}`;
    }
  }

  private drawInputs(throttle: number, brake: number, steer: number, gear: number, speed: number, unit: string): void {
    const g = this.inG;
    const W = 540;
    const H = 112;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(14, 16, 20, 0.82)';
    g.beginPath();
    g.roundRect(0, 0, W, H, 14);
    g.fill();
    // the trace: oldest on the left
    const tx = 12;
    const tw = 230;
    const ty = 12;
    const th = H - 24;
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.lineWidth = 1;
    for (const f of [0.25, 0.5, 0.75]) {
      g.beginPath();
      g.moveTo(tx, ty + th * f);
      g.lineTo(tx + tw, ty + th * f);
      g.stroke();
    }
    for (const [k, colour] of [
      [0, '#30d158'],
      [1, '#ff453a'],
    ] as const) {
      g.strokeStyle = colour;
      g.lineWidth = 3;
      g.beginPath();
      for (let i = 0; i < 150; i++) {
        const v = this.trace[((this.traceAt + i) % 150) * 2 + k];
        const x = tx + (i / 149) * tw;
        const y = ty + th - v * th;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    // the pedals
    const bar = (x: number, v: number, colour: string) => {
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(x, ty, 18, th);
      g.fillStyle = colour;
      g.fillRect(x, ty + th * (1 - v), 18, th * v);
    };
    bar(tx + tw + 14, brake, '#ff453a');
    bar(tx + tw + 38, throttle, '#30d158');
    // the gear on yellow
    const gx = tx + tw + 70;
    g.fillStyle = '#ffd60a';
    g.beginPath();
    g.roundRect(gx, ty + 6, 46, th - 12, 6);
    g.fill();
    g.fillStyle = '#111';
    g.font = 'bold 56px "Barlow Condensed", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(gear < 0 ? 'R' : gear === 0 ? 'N' : String(gear), gx + 23, ty + th / 2 + 2);
    // the speed
    g.fillStyle = '#fff';
    g.font = 'bold 40px "Barlow Condensed", sans-serif';
    g.fillText(String(Math.round(Math.abs(speed))), gx + 100, ty + th / 2 - 8);
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.font = '20px "Barlow Condensed", sans-serif';
    g.fillText(unit, gx + 100, ty + th / 2 + 22);
    // the wheel, turned as far as a real one would be (±1 ≈ 270°)
    const cx = W - 52;
    const cy = H / 2;
    g.save();
    g.translate(cx, cy);
    g.rotate((-steer * 270 * Math.PI) / 180);
    g.strokeStyle = '#fff';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(0, 0, 34, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(-34, 4);
    g.lineTo(-10, 8);
    g.lineTo(10, 8);
    g.lineTo(34, 4);
    g.moveTo(0, 8);
    g.lineTo(0, 32);
    g.stroke();
    g.fillStyle = '#ff453a';
    g.fillRect(-4, -40, 8, 10);
    g.restore();
  }

  /** ~10 Hz: the relative box and the spotter. */
  setRelative(rows: RelativeRow[], left: boolean, right: boolean): void {
    const o = settings.overlays;
    this.spotL.classList.toggle('show', o.spotter && left);
    this.spotR.classList.toggle('show', o.spotter && right);
    this.relative.hidden = !o.relative || rows.length < 2;
    if (this.relative.hidden) return;
    const key = rows.map((r) => `${r.id}${r.position}${r.gapS.toFixed(1)}${r.lap}${r.inPit}`).join('|');
    if (key === this.relKey) return;
    this.relKey = key;
    this.relative.replaceChildren(
      h('div.ov-rel-head', {}, h('span', { text: t('RELATIVE') })),
      ...rows.map((r) =>
        h(
          `div.ov-rel-row.${r.lap}${r.me ? '.me' : ''}${r.inPit ? '.inpit' : ''}`,
          {},
          h('b', { text: String(r.position) }),
          h('i.chip', { style: `background:${r.color}` }),
          h(
            'span',
            {},
            this.drivers.get(r.id)?.num ? h('i.carnum', { text: String(this.drivers.get(r.id)?.num) }) : null,
            flagImg(this.drivers.get(r.id)?.country, 14),
            r.name,
            r.inPit ? h('i.pit', { text: t('PIT') }) : null,
          ),
          // as in iRacing: the time to a car ahead is negative, to one behind positive
          h('em', { text: r.me ? '' : `${r.gapS > 0 ? '−' : '+'}${Math.abs(r.gapS).toFixed(1)}` }),
        ),
      ),
    );
  }
}
