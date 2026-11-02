import { ASSET_BASE } from '../config';
import { assetFetch } from '../mobile/assetCache';
import type { GameAudio } from './audio';

/** How urgent a call is: a higher one cuts the queue (the spotter's "car left" never waits behind a gap report). */
export type RadioPriority = 0 | 1 | 2 | 3;

interface Call {
  id: string;
  priority: RadioPriority;
  /** Dropped when it could not be said within this many seconds (old news). */
  until: number;
}

/**
 * The team radio: the race engineer and the spotter, voiced lines (tools/asset-pipeline/radio_voice.py, Piper TTS)
 * through a radio's sound: a 300-3400 Hz band, a little drive and compression, a squelch click at each end. One
 * voice at a time, the most urgent first, each kind of message rate-limited; a key silences it for 30 s (iRacing's
 * "hush" button).
 */
export class TeamRadio {
  private manifest: Record<string, number> | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private queue: Call[] = [];
  private busyUntil = 0;
  private last = new Map<string, number>();
  private mutedUntil = 0;
  private input: GainNode;
  private current: AudioBufferSourceNode | null = null;

  constructor(
    private readonly a: GameAudio,
    private readonly lang: 'en' | 'es',
  ) {
    const ctx = a.ctx;
    this.input = ctx.createGain();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 320;
    hp.Q.value = 0.8;
    const presence = ctx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 1900;
    presence.gain.value = 5;
    presence.Q.value = 0.9;
    // a soft clip: the edge a helmet microphone and a radio link give a voice
    const drive = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2) / Math.tanh(2.2);
    }
    drive.curve = curve;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3400;
    lp.Q.value = 0.7;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -22;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.12;
    this.input.connect(hp).connect(presence).connect(drive).connect(lp).connect(comp).connect(a.radioBus);
    void assetFetch(`${ASSET_BASE}assets/audio/radio/radio.json`)
      .then((r) => r.json())
      .then((m: Record<string, Record<string, number>>) => {
        this.manifest = m[lang] ?? m.en ?? null;
      })
      .catch(() => (this.manifest = null));
  }

  /**
   * Ask for a line. `key` rate-limits a kind of message (`cooldown` s between two); `ttl` s it may wait in the queue.
   */
  say(id: string, priority: RadioPriority = 1, opts: { key?: string; cooldown?: number; ttl?: number } = {}): void {
    if (!this.manifest || !(id in this.manifest)) return;
    const now = this.a.ctx.currentTime;
    const key = opts.key ?? id;
    if (now < this.mutedUntil && priority < 3) return;
    const lastAt = this.last.get(key);
    if (lastAt !== undefined && now - lastAt < (opts.cooldown ?? 20)) return;
    this.last.set(key, now);
    // the same line already waiting: once is enough
    if (this.queue.some((c) => c.id === id)) return;
    this.queue.push({ id, priority, until: now + (opts.ttl ?? 8) });
    this.queue.sort((p, q) => q.priority - p.priority);
    void this.load(id);
  }

  /** Silence for 30 s (and stop what is being said). */
  hush(): void {
    this.mutedUntil = this.a.ctx.currentTime + 30;
    this.queue.length = 0;
    try {
      this.current?.stop();
    } catch {
      /* already over */
    }
  }

  /** Every frame: the next line when the channel is free. */
  update(): void {
    const now = this.a.ctx.currentTime;
    if (now < this.busyUntil || !this.queue.length) return;
    const call = this.queue.shift() as Call;
    if (now > call.until) return;
    this.busyUntil = now + 0.2;
    void this.load(call.id).then((buf) => {
      if (!buf) return;
      const t = Math.max(this.a.ctx.currentTime, this.busyUntil - 0.2) + 0.05;
      this.click(t);
      const src = this.a.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.input);
      src.start(t + 0.06);
      this.current = src;
      this.click(t + 0.08 + buf.duration);
      // a breath between two calls
      this.busyUntil = t + buf.duration + 0.45;
    });
  }

  /** The squelch: a short burst of band-limited noise as the push-to-talk opens and closes. */
  private click(when: number): void {
    const ctx = this.a.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.a.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.16, when + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.07);
    n.connect(bp).connect(g).connect(this.a.radioBus);
    n.start(when, Math.random() * 2, 0.08);
  }

  private load(id: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(id);
    if (!p) {
      p = assetFetch(`${ASSET_BASE}assets/audio/radio/${this.lang}/${id}.webm`)
        .then((r) => r.arrayBuffer())
        .then((b) => this.a.ctx.decodeAudioData(b))
        .catch(() => null);
      this.buffers.set(id, p);
    }
    return p;
  }
}
