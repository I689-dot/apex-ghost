import * as THREE from 'three';

const STRIDE = 8; // lapMs, x, y, z, qx, qy, qz, qw

/**
 * Your best valid lap as a ghost (time-trial style, as in GT7 and the F1 games): the current lap is recorded at
 * the state sample rate; when it becomes the new personal best it replaces the ghost, which is then replayed by
 * lap time on the following laps.
 */
export class BestLapGhost {
  private cur = new Float32Array(STRIDE * 4096);
  private n = 0;
  private best: Float32Array | null = null;
  private bestN = 0;

  record(lapMs: number, p: THREE.Vector3, q: THREE.Quaternion): void {
    if ((this.n + 1) * STRIDE > this.cur.length) {
      const grown = new Float32Array(this.cur.length * 2);
      grown.set(this.cur);
      this.cur = grown;
    }
    this.cur.set([lapMs, p.x, p.y, p.z, q.x, q.y, q.z, q.w], this.n * STRIDE);
    this.n++;
  }

  /** A lap ended: keep it when it was the new best, then start recording the next one. */
  lapEnded(newBest: boolean): void {
    if (newBest && this.n > 10) {
      this.best = this.cur.slice(0, this.n * STRIDE);
      this.bestN = this.n;
    }
    this.n = 0;
  }

  /** Discard the lap in progress (pit stop, reset). */
  abortLap(): void {
    this.n = 0;
  }

  get hasGhost(): boolean {
    return this.best !== null;
  }

  /** Pose of the best lap at `lapMs` (false outside the recorded lap). */
  pose(lapMs: number, outP: THREE.Vector3, outQ: THREE.Quaternion): boolean {
    const b = this.best;
    if (!b || this.bestN < 2 || lapMs < b[0] || lapMs > b[(this.bestN - 1) * STRIDE]) return false;
    // binary search for the sample pair around lapMs
    let lo = 0;
    let hi = this.bestN - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (b[m * STRIDE] <= lapMs) lo = m;
      else hi = m;
    }
    const a = lo * STRIDE;
    const c = hi * STRIDE;
    const f = (lapMs - b[a]) / Math.max(1, b[c] - b[a]);
    outP.set(b[a + 1] + (b[c + 1] - b[a + 1]) * f, b[a + 2] + (b[c + 2] - b[a + 2]) * f, b[a + 3] + (b[c + 3] - b[a + 3]) * f);
    _qa.set(b[a + 4], b[a + 5], b[a + 6], b[a + 7]);
    _qb.set(b[c + 4], b[c + 5], b[c + 6], b[c + 7]);
    outQ.slerpQuaternions(_qa, _qb, f);
    return true;
  }
}

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

/**
 * Slipstream: how much of a car's wake reaches a follower at `pos` moving along `vel` (0 … 1).
 * Strongest a few metres behind, gone ~45 m back or ~2–3 m to the side; the leader must be going the same way.
 */
export function wakeStrength(pos: THREE.Vector3, vel: THREE.Vector3, others: Iterable<{ pos: THREE.Vector3; vel: THREE.Vector3 }>): number {
  const speed = vel.length();
  if (speed < 15) return 0;
  _dir.copy(vel).divideScalar(speed);
  let best = 0;
  for (const o of others) {
    _rel.subVectors(o.pos, pos);
    const along = _rel.dot(_dir);
    if (along < 3 || along > 45) continue;
    if (o.vel.dot(_dir) < speed * 0.6) continue;
    const lateral = _rel.addScaledVector(_dir, -along).length();
    const width = 2.2 + along * 0.025;
    if (lateral > width) continue;
    const s = (1 - (along - 3) / 42) * (1 - lateral / width);
    if (s > best) best = s;
  }
  return best;
}

const _dir = new THREE.Vector3();
const _rel = new THREE.Vector3();
