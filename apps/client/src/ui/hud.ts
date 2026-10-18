import type { Standing, TrackData } from '@apex/shared';
import { settings } from '../settings';
import type { CompoundId } from '../physics/tyres';
import { CarStatus } from './carStatus';
import { LazyText, fmtDelta, fmtTime, h } from './dom';
import { t } from '../i18n';

export interface HudState {
  speedMs: number;
  rpm: number;
  redline: number;
  limiter: number;
  gear: number;
  manual: boolean;
  /** "OUT", "2/3" or "FIN" */
  lapLabel: string;
  /** Time penalties on the lap in progress (ms). */
  lapPenaltyMs: number;
  /** Live delta to the personal best (ms), null without a reference lap. */
  liveDelta: number | null;
  position: number;
  total: number;
  currentLapMs: number;
  bestLapMs: number | null;
  lastLapMs: number | null;
  sectorDelta: number | null;
  damage: number;
  /** front, rear, left, right, engine (0..1) */
  damageZones: ArrayLike<number>;
  wrongWay: boolean;
  abs: boolean;
  tc: boolean;
  message: string;
  /** "SESSION 7:42" / "CHEQUERED FLAG · LAST LAP" */
  sessionText: string;
  /** "PIT LANE · LIMITER 60" / "PIT BOX" / "" */
  pitText: string;
  compound: CompoundId;
  /** FL, FR, RL, RR tread worn 0..1 */
  tyreWear: number[];
  /** FL, FR, RL, RR brake disc °C */
  brakeTemps: number[];
  /** Slipstream strength 0..1 */
  slipstream: number;
  resetHint: boolean;
  /** FL, FR, RL, RR (°C) */
  tyreTemps: number[];
}

interface MapDot {
  x: number;
  z: number;
  me: boolean;
  color: string;
}

/** Minimal cockpit-friendly HUD. Only writes to the DOM when values change. */
export class Hud {
  readonly el: HTMLElement;
  private speed: LazyText;
  private unit: LazyText;
  private gear: LazyText;
  private lap: LazyText;
  private pos: LazyText;
  private cur: LazyText;
  private best: LazyText;
  private last: LazyText;
  private delta: LazyText;
  private msg: LazyText;
  private fin: LazyText;
  private pitBanner: LazyText;
  private draft: HTMLElement = h('div.hud-draft', { text: t('SLIPSTREAM') });
  private rpmFill: HTMLElement;
  private rpmLeds: HTMLElement[] = [];
  private wrong: HTMLElement;
  private status = new CarStatus();
  private resetEl: HTMLElement;
  private lapTag: HTMLElement = h('label', { text: t('LAP') });

  private lastPenalty = 0;
  private board: HTMLElement;
  private boardKey = '';
  private map: HTMLCanvasElement;
  private mapCtx: CanvasRenderingContext2D;
  private lastRpmPct = -1;

  constructor() {
    this.speed = new LazyText(h('span.hud-speed', { text: '0' }));
    this.unit = new LazyText(h('span.hud-unit', { text: settings.units === 'mph' ? 'MPH' : 'KM/H' }));
    this.gear = new LazyText(h('div.hud-gear', { text: 'N' }));
    this.rpmFill = h('div.hud-rpm-fill');
    const leds = h('div.hud-leds');
    for (let i = 0; i < 10; i++) {
      const l = h('i');
      this.rpmLeds.push(l);
      leds.append(l);
    }
    this.lap = new LazyText(h('div.hud-big', { text: t('OUT') }));
    this.pos = new LazyText(h('div.hud-big', { text: '1/1' }));
    this.cur = new LazyText(h('span'));
    this.best = new LazyText(h('span'));
    this.last = new LazyText(h('span'));
    this.delta = new LazyText(h('div.hud-delta'));
    this.msg = new LazyText(h('div.hud-msg'));
    this.fin = new LazyText(h('div.hud-finish'));
    this.pitBanner = new LazyText(h('div.hud-pit'));
    this.wrong = h('div.hud-wrong', { text: t('WRONG WAY') });
    this.resetEl = h('div.hud-reset', { text: t('Press R to reset to the track') });
    this.board = h('div.hud-board');
    this.map = h('canvas.hud-map', { width: 220, height: 220 });
    this.mapCtx = this.map.getContext('2d') as CanvasRenderingContext2D;

    this.el = h(
      'div.hud',
      {},
      h(
        'div.hud-tl',
        {},
        h('div.hud-block', {}, h('label', { text: t('LAP') }), this.lap.el),
        h('div.hud-block', {}, h('label', { text: t('POS') }), this.pos.el),
        this.board,
      ),
      h(
        'div.hud-tr',
        {},
        h('div.hud-times', {}, this.lapTag, this.cur.el, h('label', { text: t('BEST') }), this.best.el, h('label', { text: t('LAST') }), this.last.el),
        this.delta.el,
      ),
      h('div.hud-bc', {}, leds, h('div.hud-rpm', {}, this.rpmFill), h('div.hud-speedo', {}, this.gear.el, h('div.hud-sp', {}, this.speed.el, this.unit.el))),
      h('div.hud-br', {}, this.map),
      h('div.hud-bl', {}, this.status.el),
      this.wrong,
      this.msg.el,
      this.fin.el,
      this.pitBanner.el,
      this.draft,
      this.resetEl,
    );
  }

  private trackPath: Path2D | null = null;
  private pitPath: Path2D | null = null;
  private boxPath: Path2D | null = null;
  private startLine: { x: number; z: number } | null = null;
  /** Minimap radius in metres: zoomed in, centred on you and rotating with your heading. */
  private static readonly MAP_RANGE_M = 320;

  /** Cache the track outline as a path in world coordinates (metres, x right, z down). */
  setTrack(t: TrackData): void {
    const cl = t.centerline;
    const path = new Path2D();
    for (let i = 0; i < cl.length; i += 3) {
      if (i === 0) path.moveTo(cl[i], cl[i + 2]);
      else path.lineTo(cl[i], cl[i + 2]);
    }
    path.closePath();
    this.trackPath = path;
    const pl = t.pitLane;
    if (pl) {
      const pp = new Path2D();
      pl.points.forEach((p, i) => (i === 0 ? pp.moveTo(p[0], p[2]) : pp.lineTo(p[0], p[2])));
      this.pitPath = pp;
      const bx = new Path2D();
      for (let i = pl.boxFrom; i <= pl.boxTo; i++) {
        const p = pl.points[i];
        if (i === pl.boxFrom) bx.moveTo(p[0], p[2]);
        else bx.lineTo(p[0], p[2]);
      }
      this.boxPath = bx;
    }
    this.startLine = { x: cl[0], z: cl[2] };
  }

  /** Draw the map around (meX, meZ) with the car's forward (fx, fz) pointing up. */
  drawMap(dots: MapDot[], meX: number, meZ: number, fx: number, fz: number): void {
    const g = this.mapCtx;
    const size = 220;
    const r = size / 2;
    const s = (r - 6) / Hud.MAP_RANGE_M; // px per metre
    g.clearRect(0, 0, size, size);
    if (!this.trackPath) return;
    g.save();
    g.beginPath();
    g.arc(r, r, r - 2, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, 0, size, size);
    g.translate(r, r);
    g.rotate(-Math.atan2(fx, -fz)); // forward → up
    g.scale(s, s);
    g.translate(-meX, -meZ);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 22;
    g.stroke(this.trackPath);
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 12;
    g.stroke(this.trackPath);
    if (this.pitPath && this.boxPath) {
      g.strokeStyle = 'rgba(255,255,255,0.45)';
      g.lineWidth = 6;
      g.stroke(this.pitPath);
      g.strokeStyle = '#ffd60a';
      g.lineWidth = 7;
      g.stroke(this.boxPath);
    }
    if (this.startLine) {
      g.fillStyle = '#ff3b30';
      g.fillRect(this.startLine.x - 8, this.startLine.z - 8, 16, 16);
    }
    for (const d of dots) {
      g.beginPath();
      g.arc(d.x, d.z, (d.me ? 6.5 : 5) / s, 0, Math.PI * 2);
      g.fillStyle = d.me ? '#ffd60a' : d.color;
      g.fill();
      g.lineWidth = 1.5 / s;
      g.strokeStyle = '#000';
      g.stroke();
    }
    g.restore();
    // your car: a fixed arrow in the centre pointing up
    g.beginPath();
    g.moveTo(r, r - 9);
    g.lineTo(r + 6, r + 6);
    g.lineTo(r, r + 2);
    g.lineTo(r - 6, r + 6);
    g.closePath();
    g.fillStyle = '#ffd60a';
    g.fill();
    g.strokeStyle = '#000';
    g.lineWidth = 1.5;
    g.stroke();
  }

  update(s: HudState): void {
    const v = settings.units === 'mph' ? s.speedMs * 2.23694 : s.speedMs * 3.6;
    this.speed.set(String(Math.round(Math.abs(v))));
    this.gear.set(s.gear < 0 ? 'R' : s.gear === 0 ? 'N' : String(s.gear));
    this.gear.el.classList.toggle('manual', s.manual);
    const pct = Math.round(Math.min(1, s.rpm / s.limiter) * 100);
    if (pct !== this.lastRpmPct) {
      this.lastRpmPct = pct;
      this.rpmFill.style.transform = `scaleX(${pct / 100})`;
      const lit = Math.max(0, Math.min(10, Math.round(((s.rpm / s.redline - 0.75) / 0.25) * 10)));
      this.rpmLeds.forEach((l, i) => (l.className = i < lit ? (i < 4 ? 'g' : i < 8 ? 'r' : 'b') : ''));
    }
    this.lap.set(s.lapLabel);
    if (s.lapPenaltyMs !== this.lastPenalty) {
      this.lastPenalty = s.lapPenaltyMs;
      const pen = s.lapPenaltyMs > 0;
      this.lapTag.textContent = pen ? `${t('PEN')} +${(s.lapPenaltyMs / 1000).toFixed(1)} s` : t('LAP');
      this.lapTag.classList.toggle('invalid', pen);
      this.cur.el.classList.toggle('invalid', pen);
    }
    this.pos.set(`${s.bestLapMs === null ? '–' : s.position}/${s.total}`);
    this.cur.set(fmtTime(s.currentLapMs));
    this.best.set(fmtTime(s.bestLapMs));
    this.last.set(fmtTime(s.lastLapMs));
    const d = s.liveDelta ?? s.sectorDelta;
    if (d === null) this.delta.set('');
    else {
      // tenths are enough while driving (hundredths flicker unreadably)
      this.delta.set(fmtDelta(Math.round(d / 10) * 10));
      this.delta.el.className = `hud-delta ${d <= 0 ? 'good' : 'bad'}${s.lapPenaltyMs > 0 ? ' void' : ''}`;
    }
    this.wrong.classList.toggle('show', s.wrongWay);
    this.status.update(s.tyreTemps, s.damageZones, s.abs, s.tc, s.compound, s.tyreWear, s.brakeTemps);
    this.draft.classList.toggle('show', s.slipstream > 0.25);
    this.msg.set(s.message);
    this.fin.set(s.sessionText);
    this.fin.el.classList.toggle('flag', s.sessionText === t('CHEQUERED FLAG · LAST LAP'));
    this.pitBanner.set(s.pitText);
    this.resetEl.classList.toggle('show', s.resetHint);
  }

  /** Timing screen around the player's position: best lap for the leader, gaps for the others. */
  setBoard(list: Standing[], me: string, names: Map<string, string>): void {
    const i = list.findIndex((x) => x.id === me);
    const from = Math.max(0, Math.min(i - 2, list.length - 5));
    const rows = list.slice(from, from + 5);
    const key = rows.map((r) => `${r.id}${r.position}${r.bestLapMs ?? ''}${r.finishedMs ?? ''}${r.dnf}${r.inPit}${r.outLap}${r.lapPenaltyMs}`).join('|');
    if (key === this.boardKey) return;
    this.boardKey = key;
    this.board.replaceChildren(
      ...rows.map((r) =>
        h(
          `div.row${r.id === me ? '.me' : ''}`,
          {},
          h('b', { text: r.bestLapMs === null ? '–' : String(r.position) }),
          h('span', {}, names.get(r.id) ?? '?', r.inPit ? h('i.pit', { text: t('PIT') }) : null),
          h(`em${r.position === 1 && r.bestLapMs !== null ? '.p1' : ''}`, {
            text:
              r.bestLapMs === null
                ? r.dnf
                  ? t('DNF')
                  : r.inPit
                    ? t('PIT')
                    : r.outLap
                      ? t('OUT LAP')
                      : r.lapPenaltyMs > 0
                        ? `${t('PEN')} +${(r.lapPenaltyMs / 1000).toFixed(1)} s`
                        : t('ON LAP')
                : r.position === 1
                  ? fmtTime(r.bestLapMs)
                  : `+${((r.gapMs ?? 0) / 1000).toFixed(3)}`,
          }),
        ),
      ),
    );
  }
}
