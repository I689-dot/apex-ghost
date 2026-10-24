import { FINISH_TIMEOUT_MS, MAX_PLAUSIBLE_SPEED_MS, RACE_LAPS } from './constants';
import { crossesGate, nearestCenterlineIndex, progressAt, wrapDelta, type TrackRaceData } from './track';

export type RaceEvent =
  | {
      type: 'lap';
      playerId: string;
      lap: number;
      /** Lap time including penalties (what counts). */
      lapMs: number;
      /** Time penalties added to this lap. */
      penaltyMs: number;
      sectors: number[];
      best: boolean;
      /** Timed and plausible: false only for the out lap and impossibly fast laps. */
      valid: boolean;
      outLap: boolean;
    }
  | {
      type: 'penalty';
      playerId: string;
      reason: PenaltyReason;
      /** Time added (0 for a warning or an excursion without advantage). */
      ms: number;
      lapPenaltyMs: number;
      /** Track-limits warning number (1…PENALTY.limitsWarnings), when this excursion was only a warning. */
      warning?: number;
      /** Off but slower: no advantage gained, no penalty. */
      noAdvantage?: boolean;
      /** Race control: a drive-through to serve (ms is 0 until it is converted into time). */
      driveThrough?: boolean;
    }
  | { type: 'sector'; playerId: string; sector: number; ms: number }
  | { type: 'finish'; playerId: string; totalMs: number }
  /** A drive-through served, or the mandatory stop (with the driver change) made inside the pit window. */
  | { type: 'served'; playerId: string; what: 'drive-through' | 'stop' }
  | { type: 'flag' }
  | { type: 'rejected'; playerId: string; reason: string };

export type PenaltyReason =
  | 'track-limits'
  | 'reset'
  | 'shortcut'
  /** Race control (raceControl.ts): overtaking under the safety car, a full-course yellow or a yellow flag. */
  | 'overtake-sc'
  | 'overtake-fcy'
  | 'overtake-yellow'
  /** Overtook the safety car itself. */
  | 'passed-sc'
  /** Held up the cars lapping it for too long under blue flags. */
  | 'blue-flags'
  /** No mandatory stop in the pit window (race with the pit-window rule). */
  | 'missed-stop'
  /** A drive-through not served within PENALTY.serveLaps laps (or given too late to serve): converted into time. */
  | 'unserved';

/**
 * Time penalties instead of deleted laps (a game choice: real GT3 qualifying cancels a lap beyond track limits).
 * Sized like the advantage they stop, after real race practice and the F1 games:
 *  - track limits (all four wheels beyond the painted white line, held 0.4 s): as in real races the first
 *    excursions of a session are only warnings (limitsWarnings); after that 0.5 s + 1 s per second off, ≤ 3 s;
 *    an excursion where the car lost more than a fifth of its speed gained nothing and costs nothing;
 *  - reset to the track: 5 s (on top of the time lost going back to the last checkpoint);
 *  - shortcut (checkpoints skipped): 5 s + 0.05 s per metre of track skipped (a 70 m chicane: ~8.5 s).
 */
export const PENALTY = {
  limitsWarnings: 3,
  limitsBaseMs: 500,
  limitsPerSecMs: 1000,
  limitsMaxMs: 3000,
  /** Lost more than this share of the speed while off: no advantage. */
  noAdvantageSlowdown: 0.2,
  resetMs: 5000,
  shortcutBaseMs: 5000,
  shortcutPerMeterMs: 50,
  /** A checkpoint up to this far ahead (m of track) is accepted, the ones in between count as skipped; a bigger
   * jump is not a shortcut but a teleport/cheat and gets no credit at all. */
  maxSkipM: 300,
  /** Drive-throughs must be served within this many laps (SRO and FIA practice: three); later or in the last laps
   * of the race they become time: the drive-through's cost (driveThroughCostMs), plus this when left unserved. */
  serveLaps: 3,
  unservedExtraMs: 10_000,
  /** No stop in the pit window: more than any stop costs (the real rule disqualifies). */
  missedStopMs: 90_000,
  /** A pit-lane pass that stops longer than this is a stop, not a drive-through. */
  driveThroughMaxStopMs: 1500,
};

/**
 * The mandatory stop of the pit-window rule, after GT World Challenge Sprint: one stop with a driver change, in a
 * window around mid-race (there 25–35 min of a 60 min race). Here by laps: the stop must start on a lap from `open`
 * to `close` (the lap in progress, 1-based), never on the last lap. `minStopMs`: how long the car has to stand in
 * its box (the driver change; the crew changes tyres meanwhile).
 */
export const PIT_WINDOW = {
  openShare: 0.4,
  closeShare: 0.6,
  minStopMs: 20_000,
  /** Position samples are 50 ms apart and the car rolls into its box: a 20 s driver change measures a little short. */
  toleranceMs: 1500,
};

export function pitWindowLaps(laps: number): { open: number; close: number } {
  const open = Math.max(1, Math.floor(laps * PIT_WINDOW.openShare));
  return { open, close: Math.max(open, Math.min(laps - 1, Math.ceil(laps * PIT_WINDOW.closeShare))) };
}

/**
 * After the winner of a lap-count race finishes, the others finish the lap they are on: they get 1.3 of the winner's
 * average lap, and FINISH_TIMEOUT_MS at least (a flat minute cut off a car one pit stop behind at the Nürburgring).
 */
export function finishGraceMs(winnerMs: number, laps: number): number {
  return Math.max(FINISH_TIMEOUT_MS, laps > 0 ? (winnerMs / laps) * 1.3 : 0);
}

/** Time a drive-through costs (ms): the pit lane at the limiter instead of the track at racing speed, plus slowing
 * down and accelerating again. Nürburgring GP (770 m lane, 60 km/h): ~33 s. */
export function driveThroughCostMs(track: TrackRaceData): number {
  const lane = track.pitLaneM ?? 0;
  if (lane <= 0) return 30_000;
  const s = lane / (60 / 3.6) - lane / 50 + 2;
  return Math.round(Math.min(45, Math.max(15, s))) * 1000;
}

export interface PlayerRaceState {
  id: string;
  /** Laps completed, the out lap included. */
  laps: number;
  /** Time penalties collected on the lap in progress (ms). */
  lapPenaltyMs: number;
  /** Start of the current track-limits excursion (server ms), or null when on track. */
  offSince: number | null;
  /** Last time an off-track sample was seen. */
  offLast: number;
  /** Speed when the excursion began, and the lowest during it (m/s). */
  offSpeed0: number;
  offMinSpeed: number;
  /** Track-limits warnings used this session. */
  limitWarnings: number;
  /** Speed from the last two samples (m/s). */
  speed: number;
  /** The lap in progress is an out lap (from the grid or from the pits): never timed. */
  outLap: boolean;
  /** In the garage (pit stop). */
  inPit: boolean;
  pitStops: number;
  /** Lap in progress (1-based) when the car entered the pit lane, and how long it has stood still in it (ms). */
  pitLap: number;
  stoppedMs: number;
  /** Pit-window rule: the mandatory stop is done. */
  stopDone: boolean;
  /** Drive-throughs to serve, with the lap count when each was given. */
  driveThroughs: { reason: PenaltyReason; lap: number }[];
  /** In the pit lane to serve one. */
  servingDt: boolean;
  validLaps: number;
  nextGate: number;
  /** Non-zero gates passed in the current lap (-1 before the first line crossing). */
  passed: number;
  lapStartMs: number;
  sectorStartMs: number;
  sectors: number[];
  lastLapMs: number | null;
  bestLapMs: number | null;
  bestSectors: number[];
  finishedMs: number | null;
  dnf: boolean;
  penaltyMs: number;
  resets: number;
  suspicious: number;
  /** Last accepted sample. */
  hasPos: boolean;
  lx: number;
  ly: number;
  lz: number;
  lt: number;
  clIndex: number;
  progressS: number;
  raceDist: number;
}

export interface Standing {
  id: string;
  position: number;
  laps: number;
  raceDist: number;
  lastLapMs: number | null;
  /** Best valid timed lap: this decides the classification. */
  bestLapMs: number | null;
  finishedMs: number | null;
  dnf: boolean;
  penaltyMs: number;
  /** Gap of the best lap to the session's best lap. */
  gapMs: number | null;
  validLaps: number;
  /** Penalties on the lap in progress (ms). */
  lapPenaltyMs: number;
  inPit: boolean;
  /** On an out lap (from the grid or the pits): not timed. */
  outLap: boolean;
  /** Sector times of the best lap (ms). */
  bestSectors: number[];
  /** Drive-throughs still to serve. */
  driveThroughs: number;
  /** Pit-window rule: the mandatory stop is done. */
  stopDone: boolean;
}

/**
 * Server-authoritative session logic (qualifying format, as in GT3 championships):
 *  - lap 1 from the grid is an untimed out lap, so grid position never matters;
 *  - a timed session: drive as many laps as you like until the chequered flag (`sessionMs`), then finish the lap
 *    you are on; the best *valid* lap decides the order. (A lap-count mode, `laps`, remains for tests.)
 *  - pit stops: the car goes to the garage, the next lap is an out lap; the session clock keeps running;
 *  - laps always count: track limits, resets and shortcuts add time penalties (PENALTY) instead;
 *  - checkpoints (gates every ~35 m) are crossed in order; one up to PENALTY.maxSkipM ahead is accepted and the
 *    skipped ones are a shortcut, so a missed checkpoint never freezes the lap.
 * Consumes position samples (server-clock time), detects gate crossings in order, times laps and sectors.
 * Clients never report laps; they can only send positions (and the off-track flag).
 */
export class RaceTracker {
  readonly players = new Map<string, PlayerRaceState>();
  /** Lap-count mode: timed laps after the out lap (0 = timed session). */
  readonly laps: number;
  /** Timed session: when the chequered flag falls (server clock), or null in lap-count mode. */
  readonly flagAt: number | null;
  firstFinishMs: number | null = null;
  flagShown = false;
  /** Race (after qualifying): no out lap, finish after `laps`, everyone finishes on the lap the leader does. */
  readonly isRace: boolean = false;
  /** Race with the pit-window rule: its laps, or null. */
  readonly pitWindow: { open: number; close: number } | null = null;
  readonly driveThroughMs: number;

  constructor(
    readonly track: TrackRaceData,
    readonly startMs: number,
    mode: number | { sessionMs: number } | { raceLaps: number; pitWindow?: boolean } = RACE_LAPS,
  ) {
    this.driveThroughMs = driveThroughCostMs(track);
    if (typeof mode === 'number') {
      this.laps = mode;
      this.flagAt = null;
    } else if ('raceLaps' in mode) {
      // the race: standing start, every lap timed from the green light, finish after raceLaps
      this.laps = mode.raceLaps;
      this.flagAt = null;
      this.isRace = true;
      if (mode.pitWindow && mode.raceLaps >= 2) this.pitWindow = pitWindowLaps(mode.raceLaps);
    } else {
      this.laps = 0;
      this.flagAt = startMs + mode.sessionMs;
    }
  }

  /**
   * The car enters the pit lane: the lap in progress is lost, gates are ignored inside the lane (it runs
   * beside the circuit) and the lap after the pit exit is an out lap.
   */
  pitIn(id: string, t: number, out: RaceEvent[] = []): RaceEvent[] {
    const p = this.players.get(id);
    if (!p || p.dnf || p.finishedMs !== null || p.inPit) return out;
    // only where the lane leaves the track (pit in / out anywhere else would be free laps: each pass of the lane
    // completes a race lap)
    if (!this.near(p, this.track.pitEntryS, -60, 450)) return out;
    p.inPit = true;
    p.pitStops++;
    p.pitLap = p.laps + 1;
    p.stoppedMs = 0;
    p.servingDt = this.isRace && p.driveThroughs.length > 0;
    if (!this.isRace) {
      // qualifying: the lap in progress is lost, the next one is an out lap
      p.outLap = true;
      p.lapPenaltyMs = 0;
    }
    p.offSince = null;
    p.sectors = [];
    // after the flag, coming into the pits ends the session
    if (this.flagAt !== null && t >= this.flagAt) this.finish(p, t, out);
    return out;
  }

  /** The car leaves the pit lane at lap distance `exitS`: the out lap continues from the next gate. */
  pitOut(id: string, exitS: number, t?: number, out: RaceEvent[] = []): void {
    const p = this.players.get(id);
    if (!p || !p.inPit) return;
    if (!this.near(p, exitS, -450, 60)) {
      // left the lane before its end (back onto the track): no lap through the pits, the gates go on from here
      p.inPit = false;
      p.servingDt = false;
      return;
    }
    const gates = this.track.gates;
    let gi = gates.findIndex((g, i) => i > 0 && g.s > exitS + 5);
    if (gi < 0) gi = 0;
    p.inPit = false;
    p.nextGate = gi;
    p.passed = gi === 0 ? gates.length - 1 : gi - 1;
    p.hasPos = false;
    // straight through the lane serves a drive-through; a stop in the window (long enough to change drivers) is
    // the mandatory stop (both judged from the car's own positions: it has to stand still in its box)
    if (p.servingDt && p.stoppedMs < PENALTY.driveThroughMaxStopMs) {
      p.driveThroughs.shift();
      out.push({ type: 'served', playerId: p.id, what: 'drive-through' });
    }
    p.servingDt = false;
    const w = this.pitWindow;
    if (w && !p.stopDone && p.pitLap >= w.open && p.pitLap <= w.close && p.stoppedMs >= PIT_WINDOW.minStopMs - PIT_WINDOW.toleranceMs) {
      p.stopDone = true;
      out.push({ type: 'served', playerId: p.id, what: 'stop' });
    }
    // the race: the pit lane runs past the line, so the lap of the stop ends here
    if (this.isRace && t !== undefined && p.finishedMs === null) {
      const lapMs = t - p.lapStartMs;
      p.laps++;
      p.lastLapMs = lapMs + p.lapPenaltyMs;
      out.push({
        type: 'lap',
        playerId: p.id,
        lap: p.laps,
        lapMs: p.lastLapMs,
        penaltyMs: p.lapPenaltyMs,
        sectors: [],
        best: false,
        valid: true,
        outLap: false,
      });
      p.lapStartMs = t;
      p.sectorStartMs = t;
      p.sectors = [];
      p.lapPenaltyMs = 0;
      if (p.laps >= this.laps || (this.firstFinishMs !== null && t >= this.firstFinishMs)) this.finish(p, t, out);
    }
  }

  /** The car's last known lap distance is from `before` to `after` metres around s (true without s or a position). */
  private near(p: PlayerRaceState, s: number | null | undefined, before: number, after: number): boolean {
    if (s === null || s === undefined || !p.hasPos) return true;
    const d = wrapDelta(s, p.progressS, this.track.length);
    return d >= before && d <= after;
  }

  private finish(p: PlayerRaceState, t: number, out: RaceEvent[]): void {
    if (p.finishedMs !== null) return;
    p.finishedMs = t - this.startMs;
    if (this.isRace) {
      // drive-throughs that could not be served any more become their cost in time; no mandatory stop: a big one
      for (const d of p.driveThroughs) this.addPenalty(p, d.reason, this.driveThroughMs, out);
      p.driveThroughs = [];
      if (this.pitWindow && !p.stopDone) this.addPenalty(p, 'missed-stop', PENALTY.missedStopMs, out);
    }
    if (this.firstFinishMs === null) this.firstFinishMs = t;
    out.push({ type: 'finish', playerId: p.id, totalMs: p.finishedMs });
  }

  /**
   * Call regularly with the server time: shows the chequered flag once, and finishes the session for cars
   * that are in the garage when it falls.
   */
  checkFlag(t: number, out: RaceEvent[] = []): RaceEvent[] {
    if (this.flagAt === null || t < this.flagAt) return out;
    if (!this.flagShown) {
      this.flagShown = true;
      out.push({ type: 'flag' });
    }
    for (const p of this.players.values()) if (p.inPit && !p.dnf) this.finish(p, t, out);
    return out;
  }

  addPlayer(id: string): PlayerRaceState {
    const g = this.track.firstGate;
    const p: PlayerRaceState = {
      id,
      laps: 0,
      lapPenaltyMs: 0,
      offSince: null,
      offLast: 0,
      offSpeed0: 0,
      offMinSpeed: 0,
      limitWarnings: 0,
      speed: 0,
      outLap: true,
      inPit: false,
      pitStops: 0,
      pitLap: 0,
      stoppedMs: 0,
      stopDone: false,
      driveThroughs: [],
      servingDt: false,
      validLaps: 0,
      nextGate: g,
      passed: g === 0 ? -1 : g - 1,
      lapStartMs: this.startMs,
      sectorStartMs: this.startMs,
      sectors: [],
      lastLapMs: null,
      bestLapMs: null,
      bestSectors: [],
      finishedMs: null,
      dnf: false,
      penaltyMs: 0,
      resets: 0,
      suspicious: 0,
      hasPos: false,
      lx: 0,
      ly: 0,
      lz: 0,
      lt: 0,
      clIndex: -1,
      progressS: 0,
      raceDist: -1e6,
    };
    if (this.isRace) p.outLap = false;
    this.players.set(id, p);
    return p;
  }

  markDnf(id: string): void {
    const p = this.players.get(id);
    if (p && p.finishedMs === null) p.dnf = true;
  }

  /**
   * Feed one position sample. `reset` = the client teleported back to its last checkpoint;
   * `offTrack` = all four wheels beyond the track limits in this sample.
   * Returns events (laps, sectors, finish). Allocation only happens when an event fires.
   */
  ingest(id: string, t: number, x: number, y: number, z: number, reset: boolean, out: RaceEvent[] = [], offTrack = false): RaceEvent[] {
    const p = this.players.get(id);
    if (!p || p.dnf || p.finishedMs !== null) return out;
    if (t < this.startMs - 10_000) return out;
    if (p.hasPos && t > p.lt) {
      p.speed = Math.hypot(x - p.lx, z - p.lz) / ((t - p.lt) / 1000);
      if (p.inPit && p.speed < 1) p.stoppedMs += t - p.lt;
    }
    if (t >= this.startMs && !p.inPit) {
      if (offTrack) {
        if (p.offSince === null) {
          p.offSince = t;
          p.offSpeed0 = p.speed;
          p.offMinSpeed = p.speed;
        }
        p.offLast = t;
        p.offMinSpeed = Math.min(p.offMinSpeed, p.speed);
      } else if (p.offSince !== null) this.closeExcursion(p, out);
    }
    const tr = this.track;
    const n = tr.gates.length;

    if (!p.hasPos || p.inPit) {
      // in the pit lane only the position is tracked (it runs beside the circuit: no gate credit)
      this.place(p, t, x, y, z, !p.hasPos);
      return out;
    }
    const dt = (t - p.lt) / 1000;
    if (dt <= 0) return out; // out-of-order or duplicate
    const dx = x - p.lx;
    const dy = y - p.ly;
    const dz = z - p.lz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (reset) {
      // Resets may only bring the car back to (near) the last gate it legitimately passed.
      const last = tr.gates[(p.nextGate - 1 + n) % n];
      const ex = x - last.p[0];
      const ez = z - last.p[2];
      if (p.passed >= 0 && ex * ex + ez * ez > 40 * 40 && dist > 5) {
        p.suspicious++;
        out.push({ type: 'rejected', playerId: id, reason: 'reset-far-from-checkpoint' });
      }
      p.resets++;
      p.offSince = null;
      if (t >= this.startMs && !p.outLap) this.addPenalty(p, 'reset', PENALTY.resetMs, out);
      this.place(p, t, x, y, z, true);
      return out;
    }

    if (dist / Math.max(dt, 0.02) > MAX_PLAUSIBLE_SPEED_MS && dist > 8) {
      // Teleport / speed hack: accept the new position but give no gate credit for the jump.
      p.suspicious++;
      out.push({ type: 'rejected', playerId: id, reason: 'implausible-speed' });
      this.place(p, t, x, y, z, true);
      return out;
    }

    // Cross as many gates as the segment covers (packet loss can skip several samples).
    let sNew: number | undefined;
    let ax = p.lx;
    let ay = p.ly;
    let az = p.lz;
    let at = p.lt;
    for (let guard = 0; guard < n; guard++) {
      let gi = p.nextGate;
      let f = crossesGate(tr.gates[gi], ax, ay, az, x, y, z);
      if (f < 0) {
        // a checkpoint further on (a cut, or a missed sample): accept it if the car really is there along the
        // track (in a hairpin a later gate can lie right beside it), the ones in between were skipped
        sNew ??= progressAt(tr, nearestCenterlineIndex(tr, x, y, z, p.clIndex), x, z);
        for (let k = 1; k < n && f < 0; k++) {
          const cand = (p.nextGate + k) % n;
          const ahead = wrapDelta(tr.gates[p.nextGate].s, tr.gates[cand].s, tr.length);
          if (ahead > PENALTY.maxSkipM || ahead < 0) break;
          const off = wrapDelta(tr.gates[cand].s, sNew, tr.length);
          if (off < -15 || off > 60) continue;
          const fc = crossesGate(tr.gates[cand], ax, ay, az, x, y, z);
          if (fc >= 0) {
            gi = cand;
            f = fc;
          }
        }
        if (f < 0) break;
      }
      const g = tr.gates[gi];
      const tc = at + (t - at) * f;
      if (gi !== p.nextGate) {
        const skipped = wrapDelta(tr.gates[p.nextGate].s, g.s, tr.length);
        const counts = !p.outLap && p.passed >= 0;
        for (let k = p.nextGate; k !== gi; k = (k + 1) % n) this.onGate(p, k, tc, out);
        if (counts) this.addPenalty(p, 'shortcut', Math.round((PENALTY.shortcutBaseMs + PENALTY.shortcutPerMeterMs * Math.max(0, skipped)) / 100) * 100, out);
      }
      this.onGate(p, gi, tc, out);
      if (p.finishedMs !== null) break;
      // continue from the crossing point
      ax = ax + (x - ax) * f;
      ay = ay + (y - ay) * f;
      az = az + (z - az) * f;
      at = tc;
      // nudge past the plane to avoid re-crossing the same gate
      ax += g.d[0] * 1e-3;
      az += g.d[2] * 1e-3;
    }
    this.place(p, t, x, y, z, false);
    return out;
  }

  private onGate(p: PlayerRaceState, gi: number, tc: number, out: RaceEvent[]): void {
    const tr = this.track;
    const n = tr.gates.length;
    if (gi === 0) {
      if (p.passed === n - 1) {
        // lap complete
        const lapMs = tc - p.lapStartMs;
        const s3 = tc - p.sectorStartMs;
        p.sectors.push(s3);
        out.push({ type: 'sector', playerId: p.id, sector: 2, ms: s3 });
        if (lapMs < tr.minLapMs) {
          p.suspicious++;
          out.push({ type: 'rejected', playerId: p.id, reason: 'lap-too-fast' });
        }
        const outLap = p.outLap;
        // an excursion still going at the line is charged to this lap
        if (p.offSince !== null) this.closeExcursion(p, out);
        const penaltyMs = outLap ? 0 : p.lapPenaltyMs;
        const timed = lapMs + penaltyMs;
        const valid = !outLap && lapMs >= tr.minLapMs;
        const best = valid && (p.bestLapMs === null || timed < p.bestLapMs);
        if (best) {
          p.bestLapMs = timed;
          p.bestSectors = p.sectors.slice();
        }
        if (valid) p.validLaps++;
        p.lastLapMs = outLap ? lapMs : timed;
        p.laps++;
        out.push({ type: 'lap', playerId: p.id, lap: p.laps, lapMs: timed, penaltyMs, sectors: p.sectors.slice(), best, valid, outLap });
        p.lapStartMs = tc;
        p.sectorStartMs = tc;
        p.sectors = [];
        p.passed = 0;
        p.lapPenaltyMs = 0;
        p.outLap = false;
        // drive-throughs not served in time become time (with a surcharge)
        while (p.driveThroughs.length && p.laps - p.driveThroughs[0].lap >= PENALTY.serveLaps) {
          p.driveThroughs.shift();
          this.addPenalty(p, 'unserved', this.driveThroughMs + PENALTY.unservedExtraMs, out);
        }
        // the race: the chequered flag is shown to the leader after `laps`; everyone else finishes the lap they are on
        const lapsDone = this.isRace
          ? p.laps >= this.laps || (this.firstFinishMs !== null && tc >= this.firstFinishMs)
          : this.laps > 0 && p.laps >= this.laps + 1;
        const flagged = this.flagAt !== null && tc >= this.flagAt;
        if (lapsDone || flagged) this.finish(p, tc, out);
      } else {
        // first crossing after the grid or the pit exit: the out lap ends here and the timed lap starts
        p.passed = 0;
        if (p.outLap && p.laps > 0) {
          p.outLap = false;
          p.lapPenaltyMs = 0;
          p.offSince = null;
          p.lapStartMs = tc;
          p.sectorStartMs = tc;
          p.sectors = [];
          if (this.flagAt !== null && tc >= this.flagAt) this.finish(p, tc, out);
        }
      }
    } else {
      p.passed++;
      const si = gi === tr.sectorGates[0] ? 0 : gi === tr.sectorGates[1] ? 1 : -1;
      if (si >= 0 && p.passed >= 0) {
        const ms = tc - p.sectorStartMs;
        p.sectors[si] = ms;
        p.sectorStartMs = tc;
        out.push({ type: 'sector', playerId: p.id, sector: si, ms });
      }
    }
    p.nextGate = (gi + 1) % n;
  }

  private addPenalty(p: PlayerRaceState, reason: PenaltyReason, ms: number, out: RaceEvent[]): void {
    if (p.outLap || ms <= 0) return;
    p.lapPenaltyMs += ms;
    p.penaltyMs += ms;
    out.push({ type: 'penalty', playerId: p.id, reason, ms, lapPenaltyMs: p.lapPenaltyMs });
  }

  /**
   * Race control's drive-through (the race only). Given with fewer than PENALTY.serveLaps laps to go it could not
   * be served: it becomes its cost in time at once, as series do in the closing laps.
   */
  addDriveThrough(id: string, reason: PenaltyReason, out: RaceEvent[] = []): RaceEvent[] {
    const p = this.players.get(id);
    if (!this.isRace || !p || p.dnf || p.finishedMs !== null) return out;
    if (this.laps - p.laps <= PENALTY.serveLaps) {
      this.addPenalty(p, reason, this.driveThroughMs, out);
      return out;
    }
    p.driveThroughs.push({ reason, lap: p.laps });
    out.push({ type: 'penalty', playerId: p.id, reason, ms: 0, lapPenaltyMs: p.lapPenaltyMs, driveThrough: true });
    return out;
  }

  /**
   * End of a track-limits excursion. No advantage (the car lost more than a fifth of its speed): nothing. The
   * first ones of the session: a warning. Then 0.5 s + 1 s per second beyond the limits, at most 3 s.
   */
  private closeExcursion(p: PlayerRaceState, out: RaceEvent[]): void {
    if (p.offSince === null) return;
    const dur = Math.max(0, p.offLast - p.offSince) / 1000;
    p.offSince = null;
    if (p.outLap) return;
    const base = { type: 'penalty' as const, playerId: p.id, reason: 'track-limits' as const, ms: 0, lapPenaltyMs: p.lapPenaltyMs };
    if (p.offSpeed0 > 5 && p.offMinSpeed < p.offSpeed0 * (1 - PENALTY.noAdvantageSlowdown)) {
      out.push({ ...base, noAdvantage: true });
      return;
    }
    if (p.limitWarnings < PENALTY.limitsWarnings) {
      p.limitWarnings++;
      out.push({ ...base, warning: p.limitWarnings });
      return;
    }
    const ms = Math.min(PENALTY.limitsMaxMs, PENALTY.limitsBaseMs + PENALTY.limitsPerSecMs * dur);
    this.addPenalty(p, 'track-limits', Math.round(ms / 100) * 100, out);
  }

  private place(p: PlayerRaceState, t: number, x: number, y: number, z: number, fullSearch: boolean): void {
    const tr = this.track;
    p.hasPos = true;
    p.lx = x;
    p.ly = y;
    p.lz = z;
    p.lt = t;
    p.clIndex = nearestCenterlineIndex(tr, x, y, z, fullSearch ? -1 : p.clIndex);
    p.progressS = progressAt(tr, p.clIndex, x, z);
    p.raceDist = this.raceDistance(p);
  }

  /** Total distance covered: laps * length + distance into the current lap, gate-anchored. */
  raceDistance(p: PlayerRaceState): number {
    const tr = this.track;
    const L = tr.length;
    const n = tr.gates.length;
    if (p.passed < 0) {
      // still behind the start line on the grid
      const d = wrapDelta(0, p.progressS, L);
      return Math.min(0, d);
    }
    const lastGi = (p.nextGate - 1 + n) % n;
    const lastS = lastGi === 0 ? 0 : tr.gates[lastGi].s;
    const nextS = p.nextGate === 0 ? L : tr.gates[p.nextGate].s;
    let into = wrapDelta(lastS, p.progressS, L);
    // slightly behind the last gate (e.g. the back of the grid) still orders correctly
    if (into < -80) into = -80;
    if (into > nextS - lastS + 20) into = nextS - lastS + 20;
    return p.laps * L + lastS + into;
  }

  /**
   * Official order, as in qualifying: by best valid lap. Drivers without a time follow; in a timed session in
   * join order (they have no position yet, so they don't shuffle around as they pass each other on the out
   * lap), in a fixed-lap race by distance covered. Equal times:
   * whoever set it first stays ahead (stable sort on join order).
   */
  standings(): Standing[] {
    const list = [...this.players.values()];
    if (this.isRace) {
      // the race: finishers by race time + penalties, then the rest by distance covered; retirements last
      list.sort((a, b) => {
        if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
        const af = a.finishedMs !== null;
        const bf = b.finishedMs !== null;
        if (af && bf) return b.laps - a.laps || (a.finishedMs as number) + a.penaltyMs - ((b.finishedMs as number) + b.penaltyMs);
        if (af !== bf) return af ? -1 : 1;
        return b.raceDist - a.raceDist;
      });
    } else
      list.sort((a, b) => {
        const at = a.bestLapMs !== null;
        const bt = b.bestLapMs !== null;
        if (at && bt) return (a.bestLapMs as number) - (b.bestLapMs as number);
        if (at !== bt) return at ? -1 : 1;
        if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
        // fixed-lap test mode: by distance covered; timed session: untimed drivers keep join order
        return this.flagAt === null ? b.raceDist - a.raceDist : 0;
      });
    const leader = list[0];
    return list.map((p, i) => ({
      id: p.id,
      position: i + 1,
      laps: p.laps,
      raceDist: p.raceDist,
      lastLapMs: p.lastLapMs,
      bestLapMs: p.bestLapMs,
      finishedMs: p.finishedMs,
      dnf: p.dnf,
      penaltyMs: p.penaltyMs,
      gapMs: this.isRace ? this.raceGap(leader, p) : leader && leader.bestLapMs !== null && p.bestLapMs !== null ? p.bestLapMs - leader.bestLapMs : null,
      validLaps: p.validLaps,
      lapPenaltyMs: p.lapPenaltyMs,
      inPit: p.inPit,
      outLap: p.outLap,
      bestSectors: p.bestSectors.slice(),
      driveThroughs: p.driveThroughs.length,
      stopDone: p.stopDone,
    }));
  }

  /**
   * Race gap to the leader (ms): finish time + penalties for finishers; on track, the distance behind at the
   * leader's average speed, plus the penalty difference.
   */
  private raceGap(leader: PlayerRaceState | undefined, p: PlayerRaceState): number | null {
    if (!leader || p === leader || p.dnf) return p === leader ? 0 : null;
    if (leader.finishedMs !== null && p.finishedMs !== null) return p.finishedMs + p.penaltyMs - (leader.finishedMs + leader.penaltyMs);
    const elapsed = Math.max(1, (leader.lt - this.startMs) / 1000);
    const speed = Math.max(10, leader.raceDist / elapsed);
    return Math.max(0, ((leader.raceDist - p.raceDist) / speed) * 1000) + p.penaltyMs - leader.penaltyMs;
  }

  allDone(): boolean {
    for (const p of this.players.values()) if (!p.dnf && p.finishedMs === null) return false;
    return true;
  }
}
