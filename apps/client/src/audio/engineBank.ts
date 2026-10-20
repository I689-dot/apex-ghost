import type { EngineBank } from './engine-worklet.js';
import { assetFetch } from '../mobile/assetCache';

/** engine_<name>.json as written by tools/asset-pipeline/engine_bank.py */
export interface EngineBankMeta {
  sampleRate: number;
  order: number;
  cyl: number;
  source: string;
  loops: { rpm: number; on: [number, number]; off: [number, number] }[];
}

/** Turns the int16 PCM file and its index into loops, resampled to the audio context's rate if needed. */
export function decodeBank(meta: EngineBankMeta, pcm: ArrayBuffer, sampleRate: number): EngineBank {
  const all = new Int16Array(pcm);
  const ratio = meta.sampleRate / sampleRate;
  const take = ([off, len]: [number, number]): Float32Array => {
    const src = all.subarray(off, off + len);
    // whole loops stay whole: the new length is rounded and the read step adjusted to it
    const n = Math.round(len / ratio);
    const out = new Float32Array(n);
    const step = len / n;
    for (let i = 0; i < n; i++) {
      const x = i * step;
      const j = Math.floor(x);
      const f = x - j;
      const a = src[j];
      const b = src[j + 1 < len ? j + 1 : 0];
      out[i] = (a + (b - a) * f) / 32767;
    }
    return out;
  };
  const loops = meta.loops.map((l) => ({ rpm: l.rpm, on: take(l.on), off: take(l.off) }));
  // every bank at the same full-throttle loudness (the files are peak-normalised, and recordings differ in
  // crest factor): per-car balance is then only sampleGain
  let sum = 0;
  let cnt = 0;
  for (const l of loops) {
    for (const v of l.on) sum += v * v;
    cnt += l.on.length;
  }
  const k = 0.2 / Math.sqrt(sum / Math.max(1, cnt));
  for (const l of loops) for (const b of [l.on, l.off]) for (let i = 0; i < b.length; i++) b[i] *= k;
  return { order: meta.order, cyl: meta.cyl, loops };
}

const cache = new Map<string, Promise<EngineBank | null>>();

/** Fetches (once per bank and rate) a recorded engine bank from public/assets/audio. */
export function loadBank(name: string, sampleRate: number, base: string): Promise<EngineBank | null> {
  const key = `${name}@${sampleRate}`;
  let p = cache.get(key);
  if (!p) {
    p = Promise.all([
      assetFetch(`${base}assets/audio/engine_${name}.json`).then((r) => r.json()),
      assetFetch(`${base}assets/audio/engine_${name}.bin`).then((r) => r.arrayBuffer()),
    ])
      .then(([meta, pcm]) => decodeBank(meta as EngineBankMeta, pcm, sampleRate))
      .catch((e) => {
        console.warn(`engine bank ${name} unavailable, procedural engine only`, e);
        return null;
      });
    cache.set(key, p);
  }
  return p;
}
