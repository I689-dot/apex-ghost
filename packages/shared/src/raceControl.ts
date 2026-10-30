import { wrapDelta, type TrackRaceData } from './track';
import type { PenaltyReason, PlayerRaceState, RaceEvent, RaceTracker } from './race';

/**
 * Race control, after SRO's GT World Challenge procedures (the host's "race control" rule):
 *  - yellow flags where a car stands on the track (from 250 m before it): no overtaking there;
 *  - full-course yellow (FCY) when a car stays stopped: 80 km/h for everyone after a 10 s warning, single file,
 *    no overtaking from the moment it is announced;
 *  - the safety car when it lasts or is serious (several cars stopped, a heavily damaged one): it joins ahead of
 *    the leader, everyone queues behind it; it peels off into the pit lane when the track is clear and the race
 *    restarts when the leader crosses the line;
 *  - blue flags for a lapped car with a leader close behind it; holding the faster car up for too long costs a
 *    drive-through, as does overtaking under yellow, FCY or the safety car (8 s to give the place back first).
 * The server runs it on the car positions it already validates (RaceTracker). The safety car's path is
 * deterministic (safetyCarAt): every client draws it at the same place from the deploy time alone.
 */
export const RACE_CONTROL = {
  /** A car this slow (m/s) away from the pits counts as stopped. */
  stoppedMs: 4,
  /** Yellow flag after a car has stood this long (ms), from this far before it to just after it (m). */
  yellowAfterMs: 2000,
  yellowBeforeM: 250,
  yellowAfterM: 60,
  /** Full-course yellow when a car stays stopped this long (ms). */
  fcyAfterMs: 12_000,
  fcyKmh: 80,
  /** Warning before the FCY speed applies (ms). */
  fcyWarningMs: 10_000,
  /** The FCY ends this long after the track is clear (ms), not before it has run this long. */
  clearForMs: 5000,
  fcyMinMs: 20_000,
  /** Safety car: the FCY's incident still there after this long, or this many cars stopped, or this damaged. */
  scAfterFcyMs: 40_000,
  scCars: 2,
  scDamage: 0.6,
  /** It joins this far ahead of the leader and stays out at least this long (ms). */
  scAheadM: 250,
  scMinMs: 75_000,
  /** Safety car pace: top speed (m/s) and lateral / braking / accelerating limits (m/s²). */
  scMaxSpeed: 150 / 3.6,
  scLatAcc: 8,
  scBrake: 7,
  scAccel: 3.5,
  /** Overtaking under a caution must be undone within this (ms), else a drive-through. */
  giveBackMs: 8000,
  /** A car slower than this (m/s) may be passed under a caution (it has a problem). */
  slowCarMs: 12,
  /** Blue flag: a car lapping this one is this close behind (m); after this long (ms) a drive-through. */
  blueM: 80,
  blueMaxMs: 25_000,
  /** No samples for this long (ms): the car is lagging or gone, not stopped on track. */
  staleMs: 3000,
  /** Rejoining from the pit exit ahead of a car is not an overtake: this long after leaving the lane (ms). */
  pitExitGraceMs: 10_000,
};

export type CourseState = 'green' | 'fcy' | 'sc' | 'sc-in';

export interface RaceControlState {
  course: CourseState;
  /** When the course state began (server ms). */
  since: number;
  /** FCY: when the speed limit applies (the end of the 10 s warning). */
  limitAt: number | null;
  /** Safety car on track: deployed at `t0` at lap distance `s0`; turns into the pit lane at `inAt`. */
  sc: { t0: number; s0: number; inAt: number | null } | null;
  /** Yellow flag zones [from, to] (lap distance, m). */
  yellows: [number, number][];
  /** Lapped cars shown the blue flag. */
  blue: string[];
}

export function greenState(t: number): RaceControlState {
  return { course: 'green', since: t, limitAt: null, sc: null, yellows: [], blue: [] };
}

/* ------------------------------------------------------------ safety car --- */

/** The safety car's pace around the centreline: speed and the time to each point from the line. */
export interface SafetyCarPath {
  length: number;
  /** Time (s) from s = 0 to centreline point i (cumS), and for the whole lap. */
  time: Float64Array;
  lapS: number;
  cumS: number[];
}

const paths = new WeakMap<TrackRaceData, SafetyCarPath>();

export function safetyCarPath(track: TrackRaceData): SafetyCarPath {
  const cached = paths.get(track);
  if (cached) return cached;
  const C = RACE_CONTROL;
  const cl = track.centerline;
  const n = cl.length / 3;
  const ds = new Float64Array(n);
  for (let i = 0; i < n; i++) ds[i] = i + 1 < n ? track.cumS[i + 1] - track.cumS[i] : track.length - track.cumS[i];
  // curvature from the heading change over ±3 points (smooths the traced centreline)
  const head = (i: number) => {
    const a = ((i % n) + n) % n;
    const b = (a + 1) % n;
    return Math.atan2(cl[b * 3] - cl[a * 3], cl[b * 3 + 2] - cl[a * 3 + 2]);
  };
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let d = head(i + 3) - head(i - 3);
    d = Math.atan2(Math.sin(d), Math.cos(d));
    let span = 0;
    for (let k = -3; k < 3; k++) span += ds[(((i + k) % n) + n) % n];
    const k = Math.abs(d) / Math.max(span, 1);
    v[i] = Math.min(C.scMaxSpeed, k > 1e-6 ? Math.sqrt(C.scLatAcc / k) : C.scMaxSpeed);
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let j = n - 1; j >= 0; j--) v[j] = Math.min(v[j], Math.sqrt(v[(j + 1) % n] ** 2 + 2 * C.scBrake * ds[j]));
    for (let i = 0; i < n; i++) v[(i + 1) % n] = Math.min(v[(i + 1) % n], Math.sqrt(v[i] ** 2 + 2 * C.scAccel * ds[i]));
  }
  const time = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) time[i + 1] = time[i] + ds[i] / Math.max(1, (v[i] + v[(i + 1) % n]) / 2);
  const p: SafetyCarPath = { length: track.length, time, lapS: time[n], cumS: track.cumS };
  paths.set(track, p);
  return p;
}

/** Time (s) from the line to lap distance s along the safety car's path. */
function timeAt(p: SafetyCarPath, s: number): number {
  const L = p.length;
  s = ((s % L) + L) % L;
  const c = p.cumS;
  let lo = 0;
  let hi = c.length - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (c[m] <= s) lo = m;
    else hi = m - 1;
  }
  const next = lo + 1 < c.length ? c[lo + 1] : L;
  const f = (s - c[lo]) / Math.max(1e-6, next - c[lo]);
  return p.time[lo] + (p.time[lo + 1] - p.time[lo]) * f;
}

/** Lap distance (m) of the safety car at server time `t` (deployed at `t0` at `s0`). */
export function safetyCarAt(p: SafetyCarPath, t0: number, s0: number, t: number): number {
  const total = timeAt(p, s0) + Math.max(0, t - t0) / 1000;
  const into = total % p.lapS;
  const tm = p.time;
  let lo = 0;
  let hi = tm.length - 2;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (tm[m] <= into) lo = m;
    else hi = m - 1;
  }
  const next = lo + 1 < p.cumS.length ? p.cumS[lo + 1] : p.length;
  const f = (into - tm[lo]) / Math.max(1e-6, tm[lo + 1] - tm[lo]);
  return p.cumS[lo] + (next - p.cumS[lo]) * f;
}

/** When (server ms) the safety car, deployed at t0/s0, next reaches lap distance `s` after time `after`. */
export function safetyCarReaches(p: SafetyCarPath, t0: number, s0: number, after: number, s: number): number {
  const now = safetyCarAt(p, t0, s0, after);
  let dt = timeAt(p, s) - timeAt(p, now);
  if (dt <= 0) dt += p.lapS;
  return after + dt * 1000;
}

/* ---------------------------------------------------------- race control --- */

interface Pass {
  by: string;
  /** The car passed, or '' for the safety car. */
  of: string;
  at: number;
  reason: PenaltyReason;
}

export class RaceControl {
  state: RaceControlState;
  /** Bumped on every change of `state` (the server broadcasts it then). */
  version = 0;
  readonly path: SafetyCarPath;
  private readonly stoppedSince = new Map<string, number>();
  private readonly damage = new Map<string, number>();
  private readonly prevDist = new Map<string, number>();
  private readonly prevScDelta = new Map<string, number>();
  private readonly blueSince = new Map<string, number>();
  private readonly inPit = new Set<string>();
  private readonly pitExitAt = new Map<string, number>();
  private passes: Pass[] = [];
  private clearSince: number | null = null;
  private fcyIncidentAt = 0;
  private restartLaps: number | null = null;

  constructor(
    private readonly tracker: RaceTracker,
    /** FCY, safety car and penalties (the race with the rule on); otherwise yellow flags only. */
    private readonly full: boolean,
  ) {
    this.state = greenState(tracker.startMs);
    this.path = safetyCarPath(tracker.track);
  }

  /** Damage reported by a car (its worst zone, 0…1): a heavily damaged car stopped on track brings the safety car. */
  setDamage(id: string, worst: number): void {
    this.damage.set(id, worst);
  }

  private set(patch: Partial<RaceControlState>): void {
    this.state = { ...this.state, ...patch };
    this.version++;
  }

  /** Call a few times a second with the server time; drive-throughs come out as tracker events. */
  update(t: number, out: RaceEvent[] = []): RaceEvent[] {
    const tr = this.tracker;
    if (t < tr.startMs) return out;
    const L = tr.track.length;
    const cars: PlayerRaceState[] = [];
    for (const p of tr.players.values()) {
      if (p.inPit) this.inPit.add(p.id);
      else if (this.inPit.delete(p.id)) this.pitExitAt.set(p.id, t);
      const live = p.hasPos && !p.dnf && p.finishedMs === null && t - p.lt < RACE_CONTROL.staleMs;
      if (live && !p.inPit) cars.push(p);
      // a car still on the grid or waiting at the pit exit has not got going: not an incident (PlayerRaceState.rolling)
      if (!live || p.inPit || !p.rolling || p.speed > RACE_CONTROL.stoppedMs) this.stoppedSince.delete(p.id);
      else if (!this.stoppedSince.has(p.id)) this.stoppedSince.set(p.id, t);
    }

    // incidents: cars standing on the track
    const yellows: [number, number][] = [];
    let fcyCars = 0;
    let serious = false;
    for (const [id, since] of this.stoppedSince) {
      const p = tr.players.get(id);
      if (!p) continue;
      const dur = t - since;
      if (dur >= RACE_CONTROL.yellowAfterMs) yellows.push([p.progressS - RACE_CONTROL.yellowBeforeM, p.progressS + RACE_CONTROL.yellowAfterM]);
      if (dur >= RACE_CONTROL.fcyAfterMs) {
        fcyCars++;
        if ((this.damage.get(id) ?? 0) >= RACE_CONTROL.scDamage) serious = true;
      }
    }
    const clear = this.stoppedSince.size === 0;
    this.clearSince = clear ? (this.clearSince ?? t) : null;
    const st = this.state;
    if (JSON.stringify(yellows.map((y) => y.map(Math.round))) !== JSON.stringify(st.yellows.map((y) => y.map(Math.round))))
      this.set({ yellows: yellows.map(([a, b]) => [Math.round(a), Math.round(b)] as [number, number]) });

    if (this.full && tr.isRace) {
      this.course(t, fcyCars, serious);
      this.blueFlags(t, cars, L, out);
    }
    this.overtakes(t, cars, L, out);
    return out;
  }

  /** Green → FCY → safety car → in this lap → green. */
  private course(t: number, fcyCars: number, serious: boolean): void {
    const st = this.state;
    const C = RACE_CONTROL;
    const tr = this.tracker;
    const leader = this.leader();
    if (st.course === 'green' && fcyCars > 0) {
      this.fcyIncidentAt = t;
      if (fcyCars >= C.scCars || serious) this.deploySc(t, leader);
      else this.set({ course: 'fcy', since: t, limitAt: t + C.fcyWarningMs, sc: null });
      return;
    }
    if (st.course === 'fcy') {
      const clearLong = this.clearSince !== null && t - this.clearSince >= C.clearForMs && t - (st.limitAt ?? t) >= C.fcyMinMs - C.fcyWarningMs;
      if (clearLong) this.set({ course: 'green', since: t, limitAt: null });
      else if (fcyCars >= C.scCars || serious || (fcyCars > 0 && t - this.fcyIncidentAt >= C.scAfterFcyMs)) this.deploySc(t, leader);
      return;
    }
    const sc = st.sc;
    if (st.course === 'sc' && sc) {
      // in when the track is clear and it has been out long enough (the field has had time to queue up)
      if (this.clearSince !== null && t - this.clearSince >= C.clearForMs && t - st.since >= C.scMinMs) {
        const entry = tr.track.pitEntryS ?? 0;
        this.set({ course: 'sc-in', sc: { ...sc, inAt: safetyCarReaches(this.path, sc.t0, sc.s0, t, entry) } });
        this.restartLaps = null;
      }
      return;
    }
    if (st.course === 'sc-in' && sc?.inAt != null && t >= sc.inAt) {
      // green when the leader crosses the line after the safety car has gone in
      if (this.restartLaps === null) this.restartLaps = leader?.laps ?? 0;
      else if (!leader || leader.laps > this.restartLaps) this.set({ course: 'green', since: t, sc: null, limitAt: null });
    }
  }

  private deploySc(t: number, leader: PlayerRaceState | undefined): void {
    const s0 = (leader?.progressS ?? 0) + RACE_CONTROL.scAheadM;
    this.set({ course: 'sc', since: t, limitAt: null, sc: { t0: t, s0, inAt: null } });
  }

  private leader(): PlayerRaceState | undefined {
    let best: PlayerRaceState | undefined;
    for (const p of this.tracker.players.values()) if (!p.dnf && p.finishedMs === null && (!best || p.raceDist > best.raceDist)) best = p;
    return best;
  }

  /** A car being lapped with a lapping car close behind it gets the blue flag; too long is a drive-through. */
  private blueFlags(t: number, cars: PlayerRaceState[], L: number, out: RaceEvent[]): void {
    const blue: string[] = [];
    for (const c of cars) {
      const behind = cars.some((f) => {
        if (f === c || f.raceDist < c.raceDist + L * 0.5) return false;
        const gap = wrapDelta(f.progressS, c.progressS, L);
        return gap > 0 && gap < RACE_CONTROL.blueM;
      });
      if (!behind) {
        this.blueSince.delete(c.id);
        continue;
      }
      blue.push(c.id);
      const since = this.blueSince.get(c.id) ?? t;
      this.blueSince.set(c.id, since);
      if (t - since >= RACE_CONTROL.blueMaxMs) {
        this.tracker.addDriveThrough(c.id, 'blue-flags', out);
        this.blueSince.set(c.id, t);
      }
    }
    if (blue.join() !== this.state.blue.join()) this.set({ blue });
  }

  /**
   * Overtaking under a caution (yellow zone, FCY from its announcement, safety car until the restart) and passing
   * the safety car: pending for RACE_CONTROL.giveBackMs; a drive-through if the place is not given back.
   */
  private overtakes(t: number, cars: PlayerRaceState[], L: number, out: RaceEvent[]): void {
    const st = this.state;
    const caution: PenaltyReason | null = st.course === 'fcy' ? 'overtake-fcy' : st.course === 'sc' || st.course === 'sc-in' ? 'overtake-sc' : null;
    const scS = st.sc && (st.sc.inAt === null || t < st.sc.inAt) ? safetyCarAt(this.path, st.sc.t0, st.sc.s0, t) : null;
    const penalise = this.full && this.tracker.isRace;
    for (const a of cars) {
      const pa = this.prevDist.get(a.id);
      for (const b of cars) {
        if (a === b || pa === undefined) continue;
        const pb = this.prevDist.get(b.id);
        if (pb === undefined || !(pa < pb && a.raceDist > b.raceDist) || b.speed < RACE_CONTROL.slowCarMs) continue;
        if (t - (this.pitExitAt.get(a.id) ?? -1e9) < RACE_CONTROL.pitExitGraceMs || t - (this.pitExitAt.get(b.id) ?? -1e9) < RACE_CONTROL.pitExitGraceMs)
          continue;
        const inYellow = st.yellows.some(([f, to]) => wrapDelta(f, b.progressS, L) >= 0 && wrapDelta(b.progressS, to, L) >= 0);
        const reason = caution ?? (inYellow ? 'overtake-yellow' : null);
        if (reason && penalise && !this.passes.some((x) => x.by === a.id && x.of === b.id)) this.passes.push({ by: a.id, of: b.id, at: t, reason });
      }
      if (scS !== null) {
        const d = wrapDelta(scS, a.progressS, L);
        const pd = this.prevScDelta.get(a.id);
        if (pd !== undefined && pd < 0 && pd > -60 && d >= 0 && d < 60 && penalise && !this.passes.some((x) => x.by === a.id && x.of === ''))
          this.passes.push({ by: a.id, of: '', at: t, reason: 'passed-sc' });
        this.prevScDelta.set(a.id, d);
      } else this.prevScDelta.delete(a.id);
    }
    for (const p of this.tracker.players.values()) this.prevDist.set(p.id, p.raceDist);
    // given back (behind again, or the other car pitted / retired) or penalised
    this.passes = this.passes.filter((x) => {
      const a = this.tracker.players.get(x.by);
      if (!a || a.dnf || a.finishedMs !== null || a.inPit) return false;
      let back: boolean;
      if (x.of === '') back = scS === null || wrapDelta(scS, a.progressS, L) < 0;
      else {
        const b = this.tracker.players.get(x.of);
        back = !b || b.dnf || b.inPit || a.raceDist < b.raceDist;
      }
      if (back) return false;
      if (t - x.at < RACE_CONTROL.giveBackMs) return true;
      this.tracker.addDriveThrough(x.by, x.reason, out);
      return false;
    });
  }
}
